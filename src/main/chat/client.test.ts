import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelay, IrcClient, type ClientOpts } from './client.ts';
import { SERVER_LOG } from '../../shared/chat.ts';

const CTCP = '\u0001'; // the CTCP delimiter, written as an escape so it survives a copy-paste

interface Fake {
    client: IrcClient;
    sent: string[];
    clock: { now: number };
    /** The lines of whichever channel is active, since that is all a snapshot carries. */
    lines: () => ReturnType<IrcClient['snapshot']>['lines'];
    channel: (name: string) => { name: string; nicks: string[]; unread: number; highlights: number };
}

function fake(opts: Partial<ClientOpts> = {}): Fake {
    const sent: string[] = [];
    const clock = { now: 1_700_000_000_000 };
    const client = new IrcClient({
        nick: 'matt',
        channels: ['#04scape'],
        now: () => clock.now,
        send: line => sent.push(line),
        ...opts
    });
    return {
        client,
        sent,
        clock,
        lines: () => client.snapshot().lines,
        channel: name => {
            const found = client.snapshot().channels.find(c => c.name === name);
            assert.ok(found, `no channel ${name}`);
            return found;
        }
    };
}

/** Takes a fresh client all the way to online, leaving `sent` empty for the assertions that follow. */
function online(opts: Partial<ClientOpts> = {}): Fake {
    const f = fake(opts);
    f.client.connecting();
    f.client.opened();
    f.client.receive(':irc.libera.chat 001 matt :Welcome to Libera.Chat, matt');
    f.sent.length = 0;
    return f;
}

// ── connecting ────────────────────────────────────────────────────────────

test('the handshake registers, then joins on 001', () => {
    const f = fake();
    assert.equal(f.client.snapshot().status, 'offline');

    f.client.connecting();
    assert.equal(f.client.snapshot().status, 'connecting');
    assert.deepEqual(f.sent, [], 'nothing is sent before the socket opens');

    f.client.opened();
    assert.equal(f.client.snapshot().status, 'registering');
    assert.deepEqual(f.sent, ['NICK matt', 'USER matt 0 * :Zanaris Kit']);

    f.sent.length = 0;
    f.client.receive(':irc.libera.chat 001 matt :Welcome to Libera.Chat, matt');
    assert.equal(f.client.snapshot().status, 'online');
    assert.deepEqual(f.sent, ['JOIN #04scape'], 'everything wanted is joined');
    assert.equal(f.client.snapshot().error, null);
});

test('001 takes the nick the server settled on', () => {
    const f = fake();
    f.client.connecting();
    f.client.opened();
    f.client.receive(':irc.libera.chat 001 matt2 :Welcome');
    assert.equal(f.client.snapshot().nick, 'matt2');
});

test('PING is answered with the same token', () => {
    const f = online();
    f.client.receive('PING :LAG1234567890');
    assert.deepEqual(f.sent, ['PONG LAG1234567890']);
});

test('closed reconnects or gives up, and forgets who was in the room', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 353 matt = #04scape :matt bob');
    f.client.receive(':irc.libera.chat 366 matt #04scape :End of /NAMES list');
    assert.equal(f.channel('#04scape').nicks.length, 2);

    f.client.closed('connection reset', true);
    assert.equal(f.client.snapshot().status, 'reconnecting');
    assert.equal(f.client.snapshot().error, 'connection reset');
    assert.deepEqual(f.channel('#04scape').nicks, [], 'the nick list is stale the moment the socket dies');

    f.client.closed('gave up', false);
    assert.equal(f.client.snapshot().status, 'offline');
});

test('backoff grows and is capped, so a long outage is not a hammering', () => {
    assert.equal(backoffDelay(1), 1_000);
    assert.equal(backoffDelay(2), 2_000);
    assert.equal(backoffDelay(3), 4_000);
    assert.ok(backoffDelay(4) > backoffDelay(3));
    assert.equal(backoffDelay(20), backoffDelay(6), 'capped');
    assert.ok(backoffDelay(20) <= 60_000);
    assert.equal(backoffDelay(0), 1_000, 'a nonsense attempt still waits');
});

// ── messages ──────────────────────────────────────────────────────────────

test('a channel message is logged against its channel', () => {
    const f = online();
    f.client.receive(':bob!~b@host PRIVMSG #04scape :hello world');
    const [line] = f.lines();
    assert.deepEqual(
        { channel: line?.channel, kind: line?.kind, nick: line?.nick, text: line?.text, highlight: line?.highlight, at: line?.at },
        { channel: '#04scape', kind: 'say', nick: 'bob', text: 'hello world', highlight: false, at: 1_700_000_000_000 }
    );
    assert.equal(typeof line?.id, 'number');
});

test('CTCP ACTION is an action, and other CTCP is ignored', () => {
    const f = online();
    f.client.receive(`:bob!~b@host PRIVMSG #04scape :${CTCP}ACTION waves at the lobby${CTCP}`);
    f.client.receive(`:bob!~b@host PRIVMSG #04scape :${CTCP}VERSION${CTCP}`);
    assert.deepEqual(
        f.lines().map(l => [l.kind, l.text]),
        [['action', 'waves at the lobby']]
    );
});

test('a private message lands in the server log and always highlights', () => {
    const f = online();
    f.client.receive(':bob!~b@host PRIVMSG matt :psst, over here');
    f.client.select(SERVER_LOG);
    const line = f.lines().at(-1);
    assert.equal(line?.kind, 'private');
    assert.equal(line?.nick, 'bob');
    assert.equal(line?.text, 'psst, over here');
    assert.equal(line?.highlight, true);
});

test('a notice is a system line', () => {
    const f = online();
    f.client.receive(':NickServ!s@services. NOTICE matt :This nickname is registered.');
    f.client.select(SERVER_LOG);
    const line = f.lines().at(-1);
    assert.equal(line?.kind, 'system');
    assert.equal(line?.nick, null);
    assert.match(line?.text ?? '', /NickServ.*registered/);
});

test('an unrecognised command is ignored quietly', () => {
    const f = online();
    const before = f.client.snapshot().channels.map(c => c.name).length;
    f.client.receive(':irc.libera.chat 042 matt XYZZY :your unique ID');
    f.client.receive(':bob!b@h MODE #04scape +o bob');
    f.client.select(SERVER_LOG);
    assert.deepEqual(f.lines(), [], 'no noise in the server log');
    assert.equal(f.client.snapshot().channels.length, before);
});

// ── who is in the room ────────────────────────────────────────────────────

test('NAMES builds a sorted nick list, stripping op and voice prefixes', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 353 matt = #04scape :@zed matt +bob');
    f.client.receive(':irc.libera.chat 353 matt = #04scape :alice');
    assert.deepEqual(f.channel('#04scape').nicks, [], 'nothing until the list ends');
    f.client.receive(':irc.libera.chat 366 matt #04scape :End of /NAMES list');
    assert.deepEqual(f.channel('#04scape').nicks, ['alice', 'bob', 'matt', 'zed']);
});

test('JOIN, PART, QUIT and NICK keep the nick list right', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 353 matt = #04scape :matt bob');
    f.client.receive(':irc.libera.chat 366 matt #04scape :End of /NAMES list');

    f.client.receive(':alice!a@h JOIN #04scape');
    assert.deepEqual(f.channel('#04scape').nicks, ['alice', 'bob', 'matt']);

    f.client.receive(':alice!a@h NICK alicia');
    assert.deepEqual(f.channel('#04scape').nicks, ['alicia', 'bob', 'matt']);

    f.client.receive(':alicia!a@h PART #04scape :bye');
    assert.deepEqual(f.channel('#04scape').nicks, ['bob', 'matt']);

    f.client.receive(':bob!b@h QUIT :Ping timeout');
    assert.deepEqual(f.channel('#04scape').nicks, ['matt']);
});

test('our own NICK follows us', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 353 matt = #04scape :matt');
    f.client.receive(':irc.libera.chat 366 matt #04scape :End of /NAMES list');
    f.client.receive(':matt!m@h NICK matthew');
    assert.equal(f.client.snapshot().nick, 'matthew');
    assert.deepEqual(f.channel('#04scape').nicks, ['matthew']);
});

test('our own PART closes the channel', () => {
    const f = online();
    f.client.receive(':matt!m@h PART #04scape :bye');
    assert.deepEqual(
        f.client.snapshot().channels.map(c => c.name),
        [SERVER_LOG]
    );
});

// ── badges ────────────────────────────────────────────────────────────────

test('a line naming you is highlighted and counted', () => {
    const f = online();
    f.client.receive(':bob!b@h PRIVMSG #04scape :matt: look at this');
    f.client.receive(':bob!b@h PRIVMSG #04scape :nothing to see');
    assert.deepEqual(
        f.lines().map(l => l.highlight),
        [true, false]
    );
    assert.equal(f.channel('#04scape').highlights, 1);
});

test('unread counts only what arrives away from the active channel, and select clears it', () => {
    const f = online({ channels: ['#04scape', '#swiftkit'] });
    f.client.receive(':bob!b@h PRIVMSG #04scape :in the active channel');
    assert.equal(f.channel('#04scape').unread, 0);

    f.client.receive(':bob!b@h PRIVMSG #swiftkit :over here');
    f.client.receive(':bob!b@h PRIVMSG #swiftkit :matt: and again');
    assert.equal(f.channel('#swiftkit').unread, 2);
    assert.equal(f.channel('#swiftkit').highlights, 1);

    f.client.select('#swiftkit');
    assert.equal(f.client.snapshot().active, '#swiftkit');
    assert.equal(f.channel('#swiftkit').unread, 0);
    assert.equal(f.channel('#swiftkit').highlights, 0);
});

test('joins and parts do not badge the rail', () => {
    const f = online({ channels: ['#04scape', '#swiftkit'] });
    f.client.receive(':alice!a@h JOIN #swiftkit');
    f.client.receive(':alice!a@h PART #swiftkit');
    assert.equal(f.channel('#swiftkit').unread, 0);
});

// ── nick collisions ───────────────────────────────────────────────────────

test('433 tries again with an underscore, and gives up rather than looping', () => {
    const f = fake();
    f.client.connecting();
    f.client.opened();
    f.sent.length = 0;

    for (const taken of ['matt', 'matt_', 'matt__', 'matt___', 'matt____']) {
        f.client.receive(`:irc.libera.chat 433 * ${taken} :Nickname is already in use.`);
    }
    assert.deepEqual(f.sent, ['NICK matt_', 'NICK matt__', 'NICK matt___'], 'three tries, then it stops asking');

    f.client.select(SERVER_LOG);
    assert.match(f.lines().at(-1)?.text ?? '', /nick/i, 'the panel is told why the nick is not the one asked for');
});

test('a 433 answering a live rename reports the refusal and leaves the working nick and the cascade alone', () => {
    const f = online(); // registered as matt, sent cleared
    f.client.input('/nick taken');
    assert.deepEqual(f.sent, ['NICK taken']);
    f.sent.length = 0;

    f.client.receive(':irc.libera.chat 433 matt taken :Nickname is already in use.');
    assert.deepEqual(f.sent, [], 'nothing is retried: matt is still registered and working');
    assert.equal(f.client.snapshot().nick, 'matt', 'the working nick is untouched by the refusal');
    assert.equal(f.client.snapshot().status, 'online');
    assert.equal(f.client.snapshot().error, null, 'the connection itself is fine');

    f.client.select(SERVER_LOG);
    assert.match(f.lines().at(-1)?.text ?? '', /taken/i, 'the refusal is reported');

    // The cascade itself must still be live for a later registration: a drop
    // and reconnect starts the whole exchange over, cascade included.
    f.client.closed('', true);
    f.client.connecting();
    f.client.opened();
    f.sent.length = 0;
    for (const again of ['matt', 'matt_', 'matt__', 'matt___', 'matt____']) {
        f.client.receive(`:irc.libera.chat 433 * ${again} :Nickname is already in use.`);
    }
    assert.deepEqual(f.sent, ['NICK matt_', 'NICK matt__', 'NICK matt___'], 'a fresh registration still runs the full cascade');
});

// ── failed joins ──────────────────────────────────────────────────────────

test('a refused join says which channel and why', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 403 matt #nope :No such channel');
    f.client.receive(':irc.libera.chat 473 matt #invite :Cannot join channel (+i)');
    f.client.receive(':irc.libera.chat 474 matt #banned :Cannot join channel (+b)');
    f.client.receive(':irc.libera.chat 475 matt #keyed :Cannot join channel (+k)');
    f.client.select(SERVER_LOG);
    const texts = f.lines().map(l => l.text);
    assert.equal(texts.length, 4);
    assert.match(texts[0] ?? '', /#nope/);
    assert.match(texts[1] ?? '', /#invite.*invite/i);
    assert.match(texts[2] ?? '', /#banned.*banned/i);
    assert.match(texts[3] ?? '', /#keyed.*key/i);
});

// ── what the user types ───────────────────────────────────────────────────

test('a typed message is sent and echoed, since IRC does not echo it back', () => {
    const f = online();
    f.client.input('hello world');
    assert.deepEqual(f.sent, ['PRIVMSG #04scape :hello world']);
    assert.deepEqual(
        f.lines().map(l => [l.kind, l.nick, l.text]),
        [['say', 'matt', 'hello world']]
    );
});

test('a typed action is sent as CTCP and echoed as an action', () => {
    const f = online();
    f.client.input('/me waves');
    assert.deepEqual(f.sent, [`PRIVMSG #04scape :${CTCP}ACTION waves${CTCP}`]);
    assert.deepEqual(
        f.lines().map(l => [l.kind, l.text]),
        [['action', 'waves']]
    );
});

test('a typed private message is sent and echoed to the server log', () => {
    const f = online();
    f.client.input('/msg bob hi there');
    assert.deepEqual(f.sent, ['PRIVMSG bob :hi there']);
    assert.deepEqual(f.lines(), [], 'not in the channel you were looking at');
    f.client.select(SERVER_LOG);
    assert.deepEqual(
        f.lines().map(l => [l.kind, l.nick, l.text]),
        [['private', 'matt', 'hi there']]
    );
});

test('typed joins and parts move the channel list and the wire together', () => {
    const f = online();
    f.client.input('/join swiftkit');
    assert.deepEqual(f.sent, ['JOIN #swiftkit']);
    assert.deepEqual(f.client.wanted(), ['#04scape', '#swiftkit']);

    f.sent.length = 0;
    f.client.select('#swiftkit');
    f.client.input('/part');
    assert.deepEqual(f.sent, ['PART #swiftkit'], 'no channel named means the active one');
    assert.deepEqual(f.client.wanted(), ['#04scape']);
    assert.equal(f.client.snapshot().active, SERVER_LOG);
});

test('a channel wanted while offline is joined on the next 001', () => {
    const f = fake({ channels: [] });
    f.client.join('#04scape');
    assert.deepEqual(f.sent, [], 'nothing to send yet');
    f.client.connecting();
    f.client.opened();
    f.sent.length = 0;
    f.client.receive(':irc.libera.chat 001 matt :Welcome');
    assert.deepEqual(f.sent, ['JOIN #04scape']);
});

test('an unknown command is answered in the log, not on the wire', () => {
    const f = online();
    f.client.input('/frobnicate the widget');
    assert.deepEqual(f.sent, []);
    assert.match(f.lines().at(-1)?.text ?? '', /frobnicate/);
    assert.equal(f.lines().at(-1)?.kind, 'system');
});

test('talking while offline says so instead of dropping the message', () => {
    const f = fake();
    f.client.input('hello?');
    assert.deepEqual(f.sent, []);
    assert.equal(f.lines().at(-1)?.kind, 'system');
});

test('a typed nick change waits for the server to confirm it', () => {
    const f = online();
    f.client.input('/nick matthew');
    assert.deepEqual(f.sent, ['NICK matthew']);
    assert.equal(f.client.snapshot().nick, 'matt', 'still the old nick until the server says otherwise');
    f.client.receive(':matt!m@h NICK matthew');
    assert.equal(f.client.snapshot().nick, 'matthew');
});

// ── the log ───────────────────────────────────────────────────────────────

test('the log is capped, dropping the oldest lines', () => {
    const f = online();
    for (let i = 0; i < 600; i++) f.client.receive(`:bob!b@h PRIVMSG #04scape :line ${i}`);
    const lines = f.lines();
    assert.equal(lines.length, 500);
    assert.equal(lines[0]?.text, 'line 100');
    assert.equal(lines.at(-1)?.text, 'line 599');
});

test('the server log is a channel of its own, listed first', () => {
    const f = online();
    assert.deepEqual(
        f.client.snapshot().channels.map(c => c.name),
        [SERVER_LOG, '#04scape']
    );
});
