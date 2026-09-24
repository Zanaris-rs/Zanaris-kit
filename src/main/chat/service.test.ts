import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANSWER_MS, ChatService, offlineChat, SILENCE_MS, splitLines, type ChatIo, type ChatSocket, type ChatStart, type SocketHandlers } from './service.ts';
import { SERVER_LOG } from '../../shared/chat.ts';

const LOBBY = '#LostHQ';
const SETTINGS: ChatStart = { nick: null, server: 'irc.swiftirc.net', port: 6697, autoJoin: [LOBBY], autoConnect: true, ignore: [], notify: true, password: null, canSavePassword: true };

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

// ── the offline view ──────────────────────────────────────────────────────

test('the offline view asks for a nick only when there is none, and shows the default list when nothing is saved', () => {
    assert.equal(offlineChat(null).needsNick, true);
    assert.equal(offlineChat('matt').needsNick, false);
    assert.equal(offlineChat('matt').status, 'offline');
    assert.deepEqual(offlineChat(null).settings.autoJoin, ['#2004scape', '#LostHQ', '#Zanaris']);
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
    service.send('hello?');
    service.select(LOBBY);
    service.connect();

    assert.deepEqual(f.connects, [], 'no socket without a nick, even when asked');
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

test('a remembered nick stays offline when the user last pressed Disconnect', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt', autoConnect: false }, f.io);
    assert.deepEqual(f.connects, []);
    assert.equal(service.view().status, 'offline');
    assert.equal(service.view().needsNick, false);

    service.connect();
    assert.deepEqual(f.connects, ['irc.swiftirc.net:6697'], 'until Connect is pressed');
});

test('registering joins every channel on the auto-join list, and nothing else', () => {
    const f = fake();
    new ChatService({ ...SETTINGS, nick: 'matt', autoJoin: ['#2004scape', '#LostHQ', '#Zanaris'] }, f.io);
    f.register();
    assert.deepEqual(
        f.sent.filter(line => line.startsWith('JOIN')),
        ['JOIN #2004scape', 'JOIN #LostHQ', 'JOIN #Zanaris']
    );
});

test('an empty auto-join list joins nothing and leaves Status open', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt', autoJoin: [] }, f.io);
    f.register();
    assert.deepEqual(f.sent.filter(line => line.startsWith('JOIN')), []);
    assert.equal(service.view().active, SERVER_LOG);
});

test('a saved password identifies before the joins', () => {
    const f = fake();
    new ChatService({ ...SETTINGS, nick: 'matt', password: 'hunter2' }, f.io);
    f.register();
    assert.deepEqual(f.sent.slice(3), ['PRIVMSG NickServ :IDENTIFY matt hunter2', `JOIN ${LOBBY}`]);
});

// ── connect and disconnect ────────────────────────────────────────────────

test('disconnect says goodbye, closes the socket, and nothing tries to come back', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    f.sent.length = 0;

    service.disconnect();
    assert.deepEqual(f.sent, ['QUIT :Zanaris Kit']);
    assert.equal(f.closes, 1);
    assert.equal(service.view().status, 'offline');
    assert.equal(service.view().error, null, 'a disconnect asked for is not a fault');

    f.drop('closed by us');
    assert.deepEqual(f.timers.filter(t => !t.cancelled), [], 'the close we caused schedules no retry');
    assert.equal(f.connects.length, 1);
});

test('disconnect while waiting to reconnect cancels the wait and sends nothing', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    f.drop();
    f.sent.length = 0;

    service.disconnect();
    assert.deepEqual(f.sent, [], 'no socket to say goodbye on');
    assert.deepEqual(f.timers.filter(t => !t.cancelled), []);
    assert.equal(service.view().status, 'offline');
});

test('the tabs and their logs stay after a disconnect, and connect picks the conversation back up', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    service.send('/join #rscape');
    f.line(`:bob!b@h PRIVMSG ${LOBBY} :hello world`);
    service.select(LOBBY);

    service.disconnect();
    assert.deepEqual(service.view().channels.map(c => c.name), [SERVER_LOG, LOBBY, '#rscape']);
    assert.deepEqual(service.view().lines.map(l => l.text), ['hello world']);

    service.connect();
    assert.equal(f.connects.length, 2);
    f.sent.length = 0;
    f.register();
    assert.deepEqual(
        f.sent.filter(line => line.startsWith('JOIN')),
        [`JOIN ${LOBBY}`, 'JOIN #rscape'],
        'the auto-join list and the tabs still open'
    );
    assert.deepEqual(service.view().lines.map(l => l.text), ['hello world']);
});

test('connect brings back an auto-join channel whose tab was closed; a closed channel off the list stays closed', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    service.send('/join #rscape');
    service.closeRoom(LOBBY);
    service.closeRoom('#rscape');

    service.disconnect();
    service.connect();
    f.sent.length = 0;
    f.register();
    assert.deepEqual(f.sent.filter(line => line.startsWith('JOIN')), [`JOIN ${LOBBY}`]);
});

test('connect while waiting out a backoff connects now rather than when the timer says', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    f.drop();
    assert.equal(f.connects.length, 1);

    service.connect();
    assert.equal(f.connects.length, 2);
    assert.deepEqual(
        f.timers.filter(t => !t.cancelled).map(t => t.ms),
        [SILENCE_MS],
        'the waiting retry is dropped, not left to open a second socket; only the new socket is watched'
    );
});

test('connect on a live connection does not open another', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    service.connect();
    assert.equal(f.connects.length, 1);
});

// ── settings ──────────────────────────────────────────────────────────────

test('the view carries the saved auto-join list and whether a password is held, never the password', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt', password: 'hunter2', canSavePassword: false }, f.io);
    const settings = service.view().settings;
    assert.deepEqual(settings, { nick: 'matt', autoJoin: [LOBBY], ignore: [], notify: true, hasPassword: true, canSavePassword: false });
    assert.ok(!JSON.stringify(service.view()).includes('hunter2'));
});

test('a first nick saved from Settings waits for Connect', () => {
    const f = fake();
    const service = new ChatService(SETTINGS, f.io);
    service.applySettings({ nick: 'Whoosh', autoJoin: ['#2004scape'] });
    assert.deepEqual(f.connects, [], 'saving is not connecting');
    assert.equal(service.view().needsNick, false);
    assert.equal(service.view().nick, 'Whoosh');

    service.connect();
    f.open();
    assert.deepEqual(f.sent, ['CAP REQ multi-prefix', 'NICK Whoosh', 'USER Whoosh 0 * :Zanaris Kit']);
    f.sent.length = 0;
    f.line(':irc.swiftirc.net 001 Whoosh :Welcome');
    assert.deepEqual(f.sent, ['JOIN #2004scape']);
});

test('a new nick on a live connection is asked for, not reconnected for', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    f.sent.length = 0;

    service.applySettings({ nick: 'matthew', autoJoin: [LOBBY] });
    assert.deepEqual(f.sent, ['NICK matthew']);
    assert.equal(f.connects.length, 1);
    assert.equal(service.view().nick, 'matt', 'the server has not agreed yet');
    f.line(':matt!m@h NICK matthew');
    assert.equal(service.view().nick, 'matthew');
});

test('a new nick while reconnecting is the one the next registration uses, and the log is kept', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    f.line(`:bob!b@h PRIVMSG ${LOBBY} :hello world`);
    service.select(LOBBY);
    f.drop();

    service.applySettings({ nick: 'matt2', autoJoin: [LOBBY] });
    assert.equal(f.connects.length, 1, 'no restart: the waiting retry will do');
    f.fire();
    f.sent.length = 0;
    f.open();
    assert.deepEqual(f.sent, ['CAP REQ multi-prefix', 'NICK matt2', 'USER matt2 0 * :Zanaris Kit']);
    assert.deepEqual(service.view().lines.map(l => l.text), ['hello world']);
});

test('saving the stored nick after a refused registration puts the underscored claim right', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.open();
    for (const taken of ['matt', 'matt_', 'matt__', 'matt___']) f.line(`:irc.swiftirc.net 433 * ${taken} :Nickname is already in use`);
    assert.equal(service.view().nick, 'matt___');
    f.drop();

    service.applySettings({ nick: 'matt', autoJoin: [LOBBY] });
    assert.equal(service.view().nick, 'matt', 'the claim is dropped even though matt is already the saved nick');
    f.fire();
    f.sent.length = 0;
    f.open();
    assert.deepEqual(f.sent, ['CAP REQ multi-prefix', 'NICK matt', 'USER matt 0 * :Zanaris Kit']);
});

test('the saved nick stays what Settings saved while the connection is called something else', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.open();
    f.line(':irc.swiftirc.net 433 * matt :Nickname is already in use');
    f.line(':irc.swiftirc.net 001 matt_ :Welcome');
    f.line(':matt_!m@h NICK Guest12345');
    assert.equal(service.view().nick, 'Guest12345');
    assert.equal(service.view().settings.nick, 'matt', 'a services rename is the session\'s, not the saved nick');
    service.send('/nick someone');
    f.line(':Guest12345!m@h NICK someone');
    assert.equal(service.view().settings.nick, 'matt', 'and so is a typed /nick');
});

test('a new nick and password saved together on a live connection identify the new account before the rename', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    f.sent.length = 0;
    service.applySettings({ nick: 'Whoosh', autoJoin: [LOBBY], password: 'correct horse' });
    assert.deepEqual(f.sent, ['PRIVMSG NickServ :IDENTIFY Whoosh correct horse', 'NICK Whoosh']);
});

test('a channel added to the list while connecting or reconnecting is joined when the connection is up', () => {
    for (const settle of ['connecting', 'reconnecting'] as const) {
        const f = fake();
        const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
        if (settle === 'reconnecting') {
            f.register();
            f.drop();
        }
        service.applySettings({ nick: 'matt', autoJoin: [LOBBY, '#Zanaris'] });
        if (settle === 'reconnecting') f.fire();
        f.sent.length = 0;
        f.register();
        assert.deepEqual(f.sent.filter(line => line.startsWith('JOIN')), [`JOIN ${LOBBY}`, 'JOIN #Zanaris'], settle);
    }
});

test('a channel added to the list is joined now, and one taken off is not parted', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt', autoJoin: [LOBBY, '#2004scape'] }, f.io);
    f.register();
    f.sent.length = 0;

    service.applySettings({ nick: 'matt', autoJoin: ['#2004SCAPE', '#Zanaris'] });
    assert.deepEqual(f.sent, ['JOIN #Zanaris'], 'a case-only difference is the same channel, and #LostHQ is left alone');
    assert.deepEqual(service.view().settings.autoJoin, ['#2004SCAPE', '#Zanaris']);
    assert.ok(service.view().channels.some(c => c.name === LOBBY), 'still in #LostHQ until its tab is closed');
});

test('a channel added to the list while offline waits for the next connect', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt', autoConnect: false }, f.io);
    service.applySettings({ nick: 'matt', autoJoin: [LOBBY, '#Zanaris'] });
    assert.equal(f.sent.length, 0, 'nothing to send it on');
    service.connect();
    f.register();
    assert.deepEqual(f.sent.filter(line => line.startsWith('JOIN')), [`JOIN ${LOBBY}`, 'JOIN #Zanaris']);
});

test('a password saved on a live connection identifies at once; left out, the saved one is kept; null forgets it', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    f.sent.length = 0;

    service.applySettings({ nick: 'matt', autoJoin: [LOBBY], password: 'hunter2' });
    assert.deepEqual(f.sent, ['PRIVMSG NickServ :IDENTIFY matt hunter2']);
    assert.equal(service.view().settings.hasPassword, true);

    f.sent.length = 0;
    service.applySettings({ nick: 'matt', autoJoin: [LOBBY] });
    assert.deepEqual(f.sent, []);
    assert.equal(service.view().settings.hasPassword, true);

    service.applySettings({ nick: 'matt', autoJoin: [LOBBY], password: null });
    assert.equal(service.view().settings.hasPassword, false);
});

// ── closing ───────────────────────────────────────────────────────────────

test('any channel can be closed, including one from the auto-join list, and it is parted', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt', autoJoin: [LOBBY, '#2004scape'] }, f.io);
    f.register();
    service.send('/join #rscape');

    const closable = new Map(service.view().channels.map(c => [c.name, c.closable]));
    assert.deepEqual(Object.fromEntries(closable), { [SERVER_LOG]: false, [LOBBY]: true, '#2004scape': true, '#rscape': true });

    f.sent.length = 0;
    assert.equal(service.closeRoom(LOBBY), true);
    assert.deepEqual(f.sent, [`PART ${LOBBY}`]);
    assert.equal(service.view().channels.some(c => c.name === LOBBY), false);
    assert.deepEqual(service.view().settings.autoJoin, [LOBBY, '#2004scape'], 'closing a tab does not edit the saved list');
});

test('Status cannot be closed, nor a channel that is not open', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    f.sent.length = 0;
    assert.equal(service.closeRoom(SERVER_LOG), false);
    assert.equal(service.closeRoom('#nowhere'), false);
    assert.deepEqual(f.sent, []);
});

test('closing a channel while offline is refused rather than throwing', () => {
    const f = fake();
    const service = new ChatService(SETTINGS, f.io);
    assert.equal(service.closeRoom(LOBBY), false);
});

test('closing a channel asked for in a different case parts it under the name given', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    service.send('/join RSCape');
    f.sent.length = 0;
    assert.equal(service.closeRoom('#rscape'), true);
    assert.deepEqual(f.sent, ['PART #rscape']);
    assert.equal(service.view().channels.some(c => c.name === '#RSCape'), false);
});

test('/join lasts for the session: it never reaches the saved list', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    service.send('/join #rscape');
    assert.deepEqual(service.view().settings.autoJoin, [LOBBY]);
});

test('select recognizes a channel even when asked for in a different case than it was joined', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt', autoJoin: ['#LostCity'] }, f.io);
    f.register();
    service.select(SERVER_LOG);
    service.select('#lostcity');
    assert.equal(service.view().active, '#LostCity');
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

test('/quit is a disconnect: goodbye with the reason, no retry, and remembered like the button', () => {
    const f = fake();
    const wanted: boolean[] = [];
    const service = new ChatService({ ...SETTINGS, nick: 'matt', onConnectionWanted: on => wanted.push(on) }, f.io);
    f.register();
    f.sent.length = 0;

    service.send('/quit gone fishing');
    assert.deepEqual(f.sent, ['QUIT :gone fishing']);
    assert.equal(f.closes, 1);
    assert.equal(service.view().status, 'offline');
    assert.deepEqual(wanted, [false]);

    f.drop('closed by us');
    assert.deepEqual(f.timers.filter(t => !t.cancelled), [], 'the server closing behind the QUIT brings nothing back');
    assert.equal(f.connects.length, 1);
});

test('/quit while offline is still a disconnect, so a waiting retry stops and the next launch stays offline', () => {
    const f = fake();
    const wanted: boolean[] = [];
    const service = new ChatService({ ...SETTINGS, nick: 'matt', onConnectionWanted: on => wanted.push(on) }, f.io);
    f.register();
    f.drop();
    f.sent.length = 0;

    service.send('/quit');
    assert.deepEqual(f.sent, [], 'no socket to say goodbye on');
    assert.deepEqual(f.timers.filter(t => !t.cancelled), []);
    assert.deepEqual(wanted, [false]);
});

test('connect and disconnect say whether a connection is wanted; stop, for the app quitting, does not', () => {
    const f = fake();
    const wanted: boolean[] = [];
    const service = new ChatService({ ...SETTINGS, nick: 'matt', autoConnect: false, onConnectionWanted: on => wanted.push(on) }, f.io);
    service.connect();
    f.register();
    service.disconnect();
    service.connect();
    service.stop();
    assert.deepEqual(wanted, [true, false, true], 'quitting the app while connected must reconnect on the next launch');
});

test('stop says goodbye, closes the socket and does not reconnect', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    f.sent.length = 0;

    service.stop();
    assert.deepEqual(f.sent, ['QUIT :Zanaris Kit']);
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
    const service = new ChatService({ ...SETTINGS, nick: 'matt', autoJoin: [LOBBY, '#LostCity'] }, f.io);
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

// ── a connection that died without closing ────────────────────────────────
//
// A laptop that slept, or a network that changed under it, can leave a socket
// that never errors and never closes: the panel says online while nothing
// arrives. The only way to know is to ask the server and hear nothing back.

/** The watchdog's timers still waiting, by how long they wait. */
function watching(f: Fake): number[] {
    return f.timers.filter(t => !t.cancelled && (t.ms === SILENCE_MS || t.ms === ANSWER_MS)).map(t => t.ms);
}

test('a server silent for a while is pinged, and any answer keeps the connection', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    f.sent.length = 0;
    assert.deepEqual(watching(f), [SILENCE_MS], 'online, the silence is being counted');

    assert.equal(f.fire(), SILENCE_MS);
    assert.equal(f.sent.length, 1);
    assert.match(f.sent[0]!, /^PING /, 'the server is asked for a sign of life');
    assert.deepEqual(watching(f), [ANSWER_MS]);

    f.line(':irc.swiftirc.net PONG irc.swiftirc.net :zanaris');
    assert.deepEqual(watching(f), [SILENCE_MS], 'the answer starts the count over');
    assert.equal(service.view().status, 'online');
    assert.equal(f.closes, 0);
    assert.deepEqual(service.view().lines, [], 'the PONG is not a line in Status');
});

test('anything the server sends starts the silence count over', () => {
    const f = fake();
    new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    f.chunk(':bob!b@h PRIVMSG #LostHQ :hal');
    assert.deepEqual(watching(f), [SILENCE_MS], 'even half a line: the socket is alive');
    assert.equal(f.timers.filter(t => t.ms === SILENCE_MS).length, 4, 'one count per arrival: connect, opened, 001, and this');
});

test('a ping nobody answers drops the socket and reconnects', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();

    f.fire(); // the silence
    f.fire(); // the wait for an answer
    assert.equal(f.closes, 1, 'the dead socket is let go');
    assert.equal(service.view().status, 'reconnecting');
    assert.match(service.view().error ?? '', /stopped answering/);

    // The dropped socket may still report its close, late; it is not ours any more.
    f.drop('closed by us');
    assert.equal(f.fire(), 1_000, 'one reconnect, counted once');
    assert.equal(f.connects.length, 2);
});

test('a handshake that never completes is given up on without a ping', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    assert.deepEqual(watching(f), [SILENCE_MS]);

    f.fire();
    assert.deepEqual(f.sent, [], 'there is no connection to ping on');
    assert.equal(f.closes, 1);
    assert.equal(service.view().status, 'reconnecting');
    assert.match(service.view().error ?? '', /did not answer/);
});

test('nothing is watched once the connection is closed, whoever closed it', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    f.drop();
    assert.deepEqual(watching(f), [], 'a dropped connection has no silence to count');

    f.fire();
    f.register();
    service.disconnect();
    assert.deepEqual(watching(f), []);
});

test('a wake asks the server at once rather than waiting out the silence', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    f.sent.length = 0;

    service.wake();
    assert.equal(f.sent.length, 1);
    assert.match(f.sent[0]!, /^PING /);
    assert.deepEqual(watching(f), [ANSWER_MS]);

    f.fire();
    assert.equal(service.view().status, 'reconnecting', 'slept through its connection, it gets a new one');
});

test('a wake with no connection up sends nothing and changes nothing', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    service.wake(); // still connecting
    assert.deepEqual(f.sent, []);
    assert.deepEqual(watching(f), [SILENCE_MS]);

    f.register();
    service.disconnect();
    f.sent.length = 0;
    service.wake();
    assert.deepEqual(f.sent, []);
    assert.deepEqual(watching(f), []);
});

// ── ignoring, mentions and conversations ──────────────────────────────────

test('/ignore is kept for the next launch, and shown in the view', () => {
    const f = fake();
    const kept: string[][] = [];
    const service = new ChatService({ ...SETTINGS, nick: 'matt', onIgnoreChanged: list => kept.push(list) }, f.io);
    f.register();
    service.send('/ignore spammer');
    assert.deepEqual(kept, [['spammer']]);
    assert.deepEqual(service.view().settings.ignore, ['spammer']);
});

test('a saved ignore list applies to the connection at once', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    service.select(LOBBY);
    service.applySettings({ nick: 'matt', autoJoin: [LOBBY], ignore: ['spammer'] });
    f.line(`:spammer!s@h PRIVMSG ${LOBBY} :buy gold`);
    assert.deepEqual(service.view().lines, []);
    assert.deepEqual(service.view().settings.ignore, ['spammer']);
});

test('a mention is passed on while notifications are on, and not once they are off', () => {
    const f = fake();
    const seen: string[] = [];
    const service = new ChatService({ ...SETTINGS, nick: 'matt', onMention: line => seen.push(line.text) }, f.io);
    f.register();
    f.line(`:bob!b@h PRIVMSG ${LOBBY} :matt: look`);
    f.line(':bob!b@h PRIVMSG matt :psst');
    service.applySettings({ nick: 'matt', autoJoin: [LOBBY], notify: false });
    f.line(':bob!b@h PRIVMSG matt :again');
    assert.deepEqual(seen, ['matt: look', 'psst']);
    assert.equal(service.view().settings.notify, false);
});

test('a conversation can be closed like a channel, and is never parted', () => {
    const f = fake();
    const service = new ChatService({ ...SETTINGS, nick: 'matt' }, f.io);
    f.register();
    f.line(':bob!b@h PRIVMSG matt :hi');
    const bob = service.view().channels.find(c => c.name === 'bob');
    assert.equal(bob?.closable, true);
    f.sent.length = 0;
    assert.equal(service.closeRoom('bob'), true);
    assert.deepEqual(f.sent, []);
    assert.equal(service.view().channels.some(c => c.name === 'bob'), false);
});
