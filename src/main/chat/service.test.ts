import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatService, offlineChat, splitLines, wantedChannels, type ChatIo, type ChatSocket, type SocketHandlers } from './service.ts';
import { LOBBY, type ChatSettings } from '../../shared/chat.ts';

const SETTINGS: ChatSettings = { nick: null, server: 'irc.swiftirc.net', port: 6697, dock: 'bottom', dockHeight: 200 };

// ── the stream ────────────────────────────────────────────────────────────
//
// The one place this code has to reassemble anything, and the one that breaks
// silently when it is wrong: a half-arrived line is not a malformed line.

test('a chunk of whole lines is split into them', () => {
    const { lines, rest } = splitLines('', 'PING :one\r\n:irc 001 matt :hi\r\nNOTICE :three\r\n');
    assert.deepEqual(lines, ['PING :one', ':irc 001 matt :hi', 'NOTICE :three']);
    assert.equal(rest, '', 'nothing was left over');
});

test('a line split across two chunks is delivered once, whole', () => {
    const first = splitLines('', ':bob!b@h PRIVMSG #LostHQ :hello ');
    assert.deepEqual(first.lines, [], 'half a line is not a line');
    assert.equal(first.rest, ':bob!b@h PRIVMSG #LostHQ :hello ');

    const second = splitLines(first.rest, 'world\r\n');
    assert.deepEqual(second.lines, [':bob!b@h PRIVMSG #LostHQ :hello world']);
    assert.equal(second.rest, '');
});

test('a chunk ending on the boundary leaves nothing pending', () => {
    const { lines, rest } = splitLines('', 'PING :token\r\n');
    assert.deepEqual(lines, ['PING :token']);
    assert.equal(rest, '');
    // And the next chunk starts a fresh line rather than continuing one.
    assert.deepEqual(splitLines(rest, 'PONG :token\r\n').lines, ['PONG :token']);
});

test('an empty chunk keeps what was pending and yields nothing', () => {
    const { lines, rest } = splitLines('PING :tok', '');
    assert.deepEqual(lines, []);
    assert.equal(rest, 'PING :tok');
});

test('a bare newline ends a line as surely as a CRLF', () => {
    const { lines, rest } = splitLines('', 'PING :one\nPING :two\r\nPING :thr');
    assert.deepEqual(lines, ['PING :one', 'PING :two']);
    assert.equal(rest, 'PING :thr');
});

test('blank lines are not lines', () => {
    const { lines, rest } = splitLines('', '\r\n\r\nPING :one\r\n\r\n');
    assert.deepEqual(lines, ['PING :one']);
    assert.equal(rest, '');
});

// ── the channel set ───────────────────────────────────────────────────────

test('the lobby is always wanted, and each hosted server adds its room once', () => {
    assert.deepEqual(wantedChannels([]), [LOBBY]);
    assert.deepEqual(wantedChannels(['lostcity']), [LOBBY, '#LostCity']);
    assert.deepEqual(wantedChannels(['lostcity', 'lostcity']), [LOBBY, '#LostCity'], 'two windows share one room');
    assert.deepEqual(wantedChannels(['zanaris', 'local', 'my-own-server']), [LOBBY], 'none of these have a room, zanaris included');
});

test('the offline view asks for a nick only when there is none', () => {
    assert.equal(offlineChat(null).needsNick, true);
    assert.equal(offlineChat('matt').needsNick, false);
    assert.equal(offlineChat('matt').status, 'offline');
});

// ── the service, over a fake transport ────────────────────────────────────

interface Timer {
    ms: number;
    fn: () => void;
    cancelled: boolean;
}

interface Fake {
    io: ChatIo;
    /** One entry per connect, as "host:port". */
    connects: string[];
    /** Lines written to the live socket. */
    sent: string[];
    timers: Timer[];
    closes: number;
    /** Completes the handshake and registration, so the client reaches online. */
    register: (nick?: string) => void;
    open: () => void;
    /** Whatever bytes the server sent, which need not be a whole line. */
    chunk: (text: string) => void;
    line: (text: string) => void;
    drop: (reason?: string) => void;
    /** Runs the pending reconnect timer and reports how long it waited. */
    fire: () => number;
}

function fake(): Fake {
    const connects: string[] = [];
    const sent: string[] = [];
    const timers: Timer[] = [];
    let handlers: SocketHandlers | null = null;
    let closes = 0;
    const io: ChatIo = {
        connect: (host, port, h) => {
            connects.push(`${host}:${port}`);
            handlers = h;
            const socket: ChatSocket = {
                send: line => sent.push(line),
                close: () => {
                    closes++;
                }
            };
            return socket;
        },
        now: () => 1_700_000_000_000,
        setTimer: (fn, ms) => {
            const timer: Timer = { ms, fn, cancelled: false };
            timers.push(timer);
            return () => {
                timer.cancelled = true;
            };
        }
    };
    const pending = (): Timer => {
        const timer = timers.filter(t => !t.cancelled).at(-1);
        assert.ok(timer, 'no timer was scheduled');
        return timer;
    };
    const f: Fake = {
        io,
        connects,
        sent,
        timers,
        get closes() {
            return closes;
        },
        open: () => handlers?.opened(),
        chunk: text => handlers?.data(text),
        line: text => handlers?.data(`${text}\r\n`),
        drop: (reason = 'connection reset') => handlers?.closed(reason),
        register: (nick = 'matt') => {
            handlers?.opened();
            handlers?.data(`:irc.swiftirc.net 001 ${nick} :Welcome to SwiftIRC, ${nick}\r\n`);
        },
        fire: () => {
            const timer = pending();
            timer.cancelled = true;
            timer.fn();
            return timer.ms;
        }
    };
    return f;
}

test('with no nick the service stays offline and opens nothing', () => {
    const f = fake();
    const service = new ChatService(SETTINGS, f.io);
    service.setServers(['lostcity']);
    service.send('hello?');
    service.select(LOBBY);

    assert.deepEqual(f.connects, [], 'no socket without a nick');
    const view = service.view();
    assert.equal(view.needsNick, true);
    assert.equal(view.status, 'offline');
    assert.deepEqual(view.lines, []);
});

test('a remembered nick connects as soon as the service is built', () => {
    const f = fake();
    new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    assert.deepEqual(f.connects, ['irc.swiftirc.net:6697']);
});

test('setNick connects once and registers with it', () => {
    const f = fake();
    const service = new ChatService(SETTINGS, f.io);
    service.setNick('matt');
    assert.deepEqual(f.connects, ['irc.swiftirc.net:6697']);
    assert.equal(service.view().needsNick, false);
    assert.equal(service.view().status, 'connecting');

    f.open();
    assert.deepEqual(f.sent, ['NICK matt', 'USER matt 0 * :Zanaris Kit']);
    assert.equal(service.view().status, 'registering');

    service.setNick('matt');
    assert.deepEqual(f.connects, ['irc.swiftirc.net:6697'], 'the same nick again is not a second connection');
});

test('registering joins the lobby and every mapped server room', () => {
    const f = fake();
    const service = new ChatService(SETTINGS, f.io);
    service.setServers(['lostcity', 'local', 'zanaris']);
    service.setNick('matt');
    f.register();

    assert.deepEqual(
        f.sent.filter(line => line.startsWith('JOIN')),
        [`JOIN ${LOBBY}`, 'JOIN #LostCity'],
        'the lobby plus #LostCity for the one hosted server with a room, and nothing for local or zanaris'
    );
    assert.equal(service.view().status, 'online');
});

test('setServers joins and parts the difference without reconnecting', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    f.sent.length = 0;

    service.setServers(['lostcity']);
    assert.deepEqual(f.sent, ['JOIN #LostCity'], 'only the new room');

    f.sent.length = 0;
    service.setServers(['lostcity', 'zanaris']);
    assert.deepEqual(f.sent, [], 'a server without a room changes nothing');

    /*
     * #LostCity is still open at this point, so closing everything has to
     * part it — if the diff or the lobby guard were broken this would come
     * back empty (nothing parted) or carry a PART for the lobby too.
     */
    f.sent.length = 0;
    service.setServers([]);
    assert.deepEqual(f.sent, ['PART #LostCity'], 'the mapped room closes, and the lobby is never parted');

    assert.deepEqual(f.connects, ['irc.swiftirc.net:6697'], 'one connection throughout');
});

test('a room the user joined by hand is not parted by a window closing', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    service.setServers(['lostcity']);
    f.register();
    service.send('/join #rscape');
    f.sent.length = 0;

    service.setServers([]);
    assert.deepEqual(f.sent, ['PART #LostCity'], 'only the mapped room goes');
    assert.ok(
        service.view().channels.some(c => c.name === '#rscape'),
        'the channel the user asked for is still there'
    );
});

test('a second nick asks the server while connected, and starts over while not', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    f.sent.length = 0;

    service.setNick('matthew');
    assert.deepEqual(f.sent, ['NICK matthew'], 'the server confirms a rename; we do not reconnect for it');
    assert.equal(f.connects.length, 1);

    // Nothing has registered this one, so the new nick can only take effect by
    // registering with it.
    f.drop();
    f.sent.length = 0;
    service.setNick('matt2');
    assert.equal(f.connects.length, 2, 'a fresh connection rather than a wait');
    f.open();
    assert.deepEqual(f.sent, ['NICK matt2', 'USER matt2 0 * :Zanaris Kit']);
});

test('an unexpected close schedules a reconnect, and the wait grows until one lands', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();

    f.drop();
    assert.equal(service.view().status, 'reconnecting');
    assert.equal(service.view().error, 'connection reset');
    assert.equal(f.connects.length, 1, 'nothing reconnects before the timer fires');

    assert.equal(f.fire(), 1_000, 'the first retry is the shortest');
    assert.equal(f.connects.length, 2);

    // This attempt never registers, so the next wait is longer.
    f.drop();
    assert.equal(f.fire(), 2_000);
    f.drop();
    assert.equal(f.fire(), 4_000);

    // Reaching online again starts the backoff over.
    f.register();
    assert.equal(service.view().status, 'online');
    f.drop();
    assert.equal(f.fire(), 1_000, 'a connection that worked resets the count');
});

test('a reconnect keeps the conversation rather than starting a new one', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    f.line(`:bob!b@h PRIVMSG ${LOBBY} :hello world`);
    service.select(LOBBY);
    assert.equal(service.view().lines.length, 1);

    f.drop();
    f.fire();
    f.register();
    assert.deepEqual(
        service.view().lines.map(l => l.text),
        ['hello world'],
        'the log survives the blip'
    );
});

test('stop closes the socket and does not reconnect', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();

    service.stop();
    assert.equal(f.closes, 1);
    assert.equal(service.view().status, 'offline');
    assert.deepEqual(
        f.timers.filter(t => !t.cancelled),
        [],
        'nothing is waiting to try again'
    );

    // The socket's own close event arrives after ours, and must change nothing.
    f.drop('closed by us');
    assert.deepEqual(
        f.timers.filter(t => !t.cancelled),
        []
    );
    assert.equal(f.connects.length, 1);
    assert.equal(service.view().status, 'offline');
});

test('stop while waiting to reconnect cancels the wait', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    f.drop();
    service.stop();
    assert.deepEqual(f.timers.filter(t => !t.cancelled), []);
    assert.equal(f.connects.length, 1);
});

test('typed lines and channel selection reach the client, and subscribers hear about it', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    service.setServers(['lostcity']);
    f.register();
    f.sent.length = 0;

    const seen: string[] = [];
    const unsubscribe = service.subscribe(view => seen.push(view.active));

    service.select('#LostCity');
    service.send('hello world');
    assert.deepEqual(f.sent, ['PRIVMSG #LostCity :hello world'], 'the active channel is where talking goes');
    assert.deepEqual(seen, ['#LostCity', '#LostCity']);

    service.select('#not-a-room-we-are-in');
    assert.equal(service.view().active, '#LostCity', 'an unknown channel is not selected into existence');

    unsubscribe();
    service.send('and again');
    assert.equal(seen.length, 2, 'no more pushes after unsubscribing');
});

test('a message arriving in pieces is logged once, whole', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    service.select(LOBBY);

    f.chunk(`:bob!b@h PRIVMSG ${LOBBY} :hello `);
    assert.deepEqual(service.view().lines, [], 'half a line says nothing yet');
    f.chunk('world\r\n:bob!b@h PRIVMSG ');
    f.chunk(`${LOBBY} :and again\r\n`);
    assert.deepEqual(
        service.view().lines.map(l => l.text),
        ['hello world', 'and again']
    );
});

test('a half-arrived line does not survive the socket that was carrying it', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    service.select(LOBBY);
    f.chunk(`:bob!b@h PRIVMSG ${LOBBY} :hel`);

    f.drop();
    f.fire();
    f.register();
    f.chunk(`lo\r\n`);
    assert.deepEqual(service.view().lines, [], 'the tail of a dead connection is not the head of the next');
});
