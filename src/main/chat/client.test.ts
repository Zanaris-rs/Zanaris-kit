import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelay, IrcClient, type ClientOpts } from './client.ts';
import { SERVER_LOG, type ChatChannel } from '../../shared/chat.ts';

const CTCP = '\u0001'; // the CTCP delimiter, written as an escape so it survives a copy-paste

interface Fake {
    client: IrcClient;
    sent: string[];
    clock: { now: number };
    /** The lines of whichever channel is active, since that is all a snapshot carries. */
    lines: () => ReturnType<IrcClient['snapshot']>['lines'];
    channel: (name: string) => ChatChannel;
    /** Who is in a channel, as the panel lists them: the rank symbols, then the nick. */
    who: (name: string) => string[];
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
        },
        who: name => {
            const found = client.snapshot().channels.find(c => c.name === name);
            assert.ok(found, `no channel ${name}`);
            return found.users.map(u => `${u.prefixes}${u.nick}`);
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
    assert.deepEqual(f.sent, ['CAP REQ multi-prefix', 'NICK matt', 'USER matt 0 * :Zanaris Kit']);

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
    assert.equal(f.channel('#04scape').users.length, 2);

    f.client.closed('connection reset', true);
    assert.equal(f.client.snapshot().status, 'reconnecting');
    assert.equal(f.client.snapshot().error, 'connection reset');
    assert.deepEqual(f.channel('#04scape').users, [], 'the nick list is stale the moment the socket dies');

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

test('a command that is not a numeric and not handled is ignored quietly', () => {
    const f = online();
    const before = f.client.snapshot().channels.map(c => c.name).length;
    f.client.receive(':irc.libera.chat CAP matt ACK :multi-prefix');
    f.client.receive(':bob!b@h WALLOPS :nothing for us');
    f.client.select(SERVER_LOG);
    assert.deepEqual(
        f.lines().map(l => l.text),
        ['Welcome to Libera.Chat, matt'],
        'only the welcome, which the handshake already put there'
    );
    assert.equal(f.client.snapshot().channels.length, before);
});

// ── who is in the room ────────────────────────────────────────────────────

test('NAMES builds the user list, ranked first and named second, keeping every rank symbol', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 353 matt = #04scape :@zed matt +bob');
    f.client.receive(':irc.libera.chat 353 matt = #04scape :alice @+Carol ~owner');
    assert.deepEqual(f.channel('#04scape').users, [], 'nothing until the list ends');
    f.client.receive(':irc.libera.chat 366 matt #04scape :End of /NAMES list');
    assert.deepEqual(f.who('#04scape'), ['~owner', '@+Carol', '@zed', '+bob', 'alice', 'matt']);
});

test('a userhost-in-names entry is listed by its nick alone', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 353 matt = #04scape :@zed!z@host.example matt!m@elsewhere');
    f.client.receive(':irc.libera.chat 366 matt #04scape :End of /NAMES list');
    assert.deepEqual(f.who('#04scape'), ['@zed', 'matt']);
});

test('a server that says its PREFIX is (ov)@+ has no half-ops, so a % is part of a nick', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 005 matt PREFIX=(ov)@+ CHANTYPES=# :are supported by this server');
    f.client.receive(':irc.libera.chat 353 matt = #04scape :@zed %odd');
    f.client.receive(':irc.libera.chat 366 matt #04scape :End of /NAMES list');
    assert.deepEqual(f.who('#04scape'), ['@zed', '%odd']);
});

test('JOIN, PART, QUIT and NICK keep the nick list right', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 353 matt = #04scape :matt bob');
    f.client.receive(':irc.libera.chat 366 matt #04scape :End of /NAMES list');

    f.client.receive(':alice!a@h JOIN #04scape');
    assert.deepEqual(f.who('#04scape'), ['alice', 'bob', 'matt']);

    f.client.receive(':alice!a@h NICK alicia');
    assert.deepEqual(f.who('#04scape'), ['alicia', 'bob', 'matt']);

    f.client.receive(':alicia!a@h PART #04scape :bye');
    assert.deepEqual(f.who('#04scape'), ['bob', 'matt']);

    f.client.receive(':bob!b@h QUIT :Ping timeout');
    assert.deepEqual(f.who('#04scape'), ['matt']);
});

test('our own NICK follows us', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 353 matt = #04scape :matt');
    f.client.receive(':irc.libera.chat 366 matt #04scape :End of /NAMES list');
    f.client.receive(':matt!m@h NICK matthew');
    assert.equal(f.client.snapshot().nick, 'matthew');
    assert.deepEqual(f.who('#04scape'), ['matthew']);
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
    // After the welcome, which the handshake already put in Status.
    const texts = f.lines().slice(1).map(l => l.text);
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
        f.lines().slice(1).map(l => [l.kind, l.nick, l.text]),
        [['private', 'matt', 'hi there']],
        'after the welcome'
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

test('a command this client does not read itself goes to the server as typed, uppercased', () => {
    const f = online();
    f.client.input('/invite bob #LostHQ');
    f.client.input('/whois bob');
    f.client.input('/topic #04scape :hello there');
    f.client.input('/away');
    assert.deepEqual(f.sent, ['INVITE bob #LostHQ', 'WHOIS bob', 'TOPIC #04scape :hello there', 'AWAY']);
    assert.deepEqual(f.lines(), [], 'the server answers in Status; the client does not echo what it does not understand');
});

test('a passed-through command while not connected says so instead of being dropped silently', () => {
    const f = fake();
    f.client.input('/invite bob #04scape');
    assert.deepEqual(f.sent, []);
    assert.equal(f.lines().at(-1)?.kind, 'system');
    assert.match(f.lines().at(-1)?.text ?? '', /not connected/);
});

test('a slash that names no command is answered in the log, not on the wire', () => {
    const f = online();
    f.client.input('/123 go');
    assert.deepEqual(f.sent, []);
    assert.match(f.lines().at(-1)?.text ?? '', /123/);
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

// ── NickServ ──────────────────────────────────────────────────────────────

test('a password identifies to NickServ on the welcome, before any join, and never reaches the log', () => {
    const f = fake({ password: 'hunter2 with spaces' });
    f.client.connecting();
    f.client.opened();
    f.sent.length = 0;
    f.client.receive(':irc.swiftirc.net 001 matt :Welcome to SwiftIRC, matt');
    assert.deepEqual(f.sent, ['PRIVMSG NickServ :IDENTIFY matt hunter2 with spaces', 'JOIN #04scape'], 'named, so the spaces stay in the password');

    const everyLine = f.client.snapshot().channels.flatMap(c => {
        f.client.select(c.name);
        return f.lines().map(l => l.text);
    });
    assert.ok(!everyLine.some(text => text.includes('hunter2')), 'no log line anywhere carries it');
});

test('no password sends nothing to NickServ', () => {
    const f = fake();
    f.client.connecting();
    f.client.opened();
    f.sent.length = 0;
    f.client.receive(':irc.swiftirc.net 001 matt :Welcome');
    assert.deepEqual(f.sent, ['JOIN #04scape']);
});

test('a password given on a live connection identifies at once, and a cleared one is not sent on the next welcome', () => {
    const f = online();
    f.client.setCredentials('matt', 'hunter2');
    assert.deepEqual(f.sent, ['PRIVMSG NickServ :IDENTIFY matt hunter2']);
    f.client.setCredentials('matt', 'hunter2');
    assert.equal(f.sent.length, 1, 'the same credentials again are not re-sent');

    f.client.setCredentials('matt', null);
    f.client.closed('', true);
    f.client.connecting();
    f.client.opened();
    f.sent.length = 0;
    f.client.receive(':irc.swiftirc.net 001 matt :Welcome');
    assert.deepEqual(f.sent, ['JOIN #04scape']);
});

test('a password given while offline waits for the welcome', () => {
    const f = fake();
    f.client.setCredentials('matt', 'hunter2');
    assert.deepEqual(f.sent, []);
    f.client.connecting();
    f.client.opened();
    f.sent.length = 0;
    f.client.receive(':irc.swiftirc.net 001 matt :Welcome');
    assert.equal(f.sent[0], 'PRIVMSG NickServ :IDENTIFY matt hunter2');
});

// ── ranks and modes ───────────────────────────────────────────────────────

test('a MODE giving and taking ranks moves people up and down the list, and is said in the room', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 353 matt = #04scape :matt bob alice');
    f.client.receive(':irc.libera.chat 366 matt #04scape :End of /NAMES list');

    f.client.receive(':ChanServ!s@services. MODE #04scape +ov bob alice');
    assert.deepEqual(f.who('#04scape'), ['@bob', '+alice', 'matt']);

    f.client.receive(':ChanServ!s@services. MODE #04scape +v bob');
    assert.deepEqual(f.who('#04scape'), ['@+bob', '+alice', 'matt'], 'a second rank is kept below the first');

    f.client.receive(':ChanServ!s@services. MODE #04scape -o+l bob 50');
    assert.deepEqual(f.who('#04scape'), ['+alice', '+bob', 'matt'], 'losing op leaves the voice, and the limit takes its own parameter');

    assert.deepEqual(
        f.lines().map(l => l.text),
        ['ChanServ sets mode +ov bob alice', 'ChanServ sets mode +v bob', 'ChanServ sets mode -o+l bob 50']
    );
});

test('a nick change keeps its rank', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 353 matt = #04scape :@zed matt');
    f.client.receive(':irc.libera.chat 366 matt #04scape :End of /NAMES list');
    f.client.receive(':zed!z@h NICK aaron');
    assert.deepEqual(f.who('#04scape'), ['@aaron', 'matt']);
});

test('joining asks for the channel modes, and 324 and 329 fill them in, flags only', () => {
    const f = online();
    f.client.receive(':matt!m@h JOIN #swiftkit');
    assert.deepEqual(f.sent, ['MODE #swiftkit']);
    assert.equal(f.channel('#swiftkit').modes, null, 'not known until the server says');

    f.client.receive(':irc.libera.chat 324 matt #swiftkit +ntkl sekrit 50');
    f.client.receive(':irc.libera.chat 329 matt #swiftkit 1757478015');
    assert.equal(f.channel('#swiftkit').modes, '+ntkl', 'the key itself is not shown');
    assert.equal(f.channel('#swiftkit').createdAt, 1_757_478_015_000);

    f.client.receive(':op!o@h MODE #swiftkit -k+m sekrit');
    assert.equal(f.channel('#swiftkit').modes, '+ntlm');
    f.client.receive(':op!o@h MODE #swiftkit +b *!*@bad');
    assert.equal(f.channel('#swiftkit').modes, '+ntlm', 'a ban is a list entry, not a flag');
});

test('our own user modes are said in Status', () => {
    const f = online();
    f.client.receive(':matt MODE matt :+ixz');
    f.client.receive(':irc.swiftirc.net 221 matt +ixz');
    f.client.select(SERVER_LOG);
    assert.deepEqual(f.lines().slice(-2).map(l => l.text), ['matt sets mode +ixz on matt', 'your modes are +ixz']);
});

// ── topics ────────────────────────────────────────────────────────────────

test('332 and 333 give the topic, who set it and when, without a line in the room', () => {
    const f = online();
    const bold = String.fromCharCode(2);
    f.client.receive(`:irc.swiftirc.net 332 matt #04scape :${bold}Migrating channels${bold}, please join #LostCity`);
    f.client.receive(':irc.swiftirc.net 333 matt #04scape Collin!c@host.example 1786319756');
    assert.deepEqual(f.channel('#04scape').topic, { text: 'Migrating channels, please join #LostCity', setBy: 'Collin', setAt: 1_786_319_756_000 });
    f.client.receive(':irc.swiftirc.net 333 matt #04scape Collin 1786319756');
    assert.equal(f.channel('#04scape').topic?.setBy, 'Collin', 'a server that sends the bare nick is read the same');
    assert.deepEqual(f.lines(), []);
});

test('a TOPIC while we are there changes the topic and says so, and an empty one clears it', () => {
    const f = online();
    f.clock.now = 1_700_000_500_000;
    f.client.receive(':bob!b@h TOPIC #04scape :Welcome back');
    assert.deepEqual(f.channel('#04scape').topic, { text: 'Welcome back', setBy: 'bob', setAt: 1_700_000_500_000 });
    f.client.receive(':bob!b@h TOPIC #04scape :');
    assert.equal(f.channel('#04scape').topic, null);
    assert.deepEqual(
        f.lines().map(l => l.text),
        ['bob changed the topic to: Welcome back', 'bob cleared the topic']
    );
});

test('the topic and modes outlive a dropped connection; the user list does not', () => {
    const f = online();
    f.client.receive(':irc.swiftirc.net 332 matt #04scape :Hello');
    f.client.receive(':irc.swiftirc.net 324 matt #04scape +nt');
    f.client.receive(':irc.libera.chat 353 matt = #04scape :matt');
    f.client.receive(':irc.libera.chat 366 matt #04scape :End');
    f.client.closed('reset', true);
    assert.equal(f.channel('#04scape').topic?.text, 'Hello');
    assert.equal(f.channel('#04scape').modes, '+nt');
    assert.deepEqual(f.channel('#04scape').users, []);
});

// ── kicks ─────────────────────────────────────────────────────────────────

test('someone else kicked leaves the list, with who and why said in the room', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 353 matt = #04scape :@op matt bob');
    f.client.receive(':irc.libera.chat 366 matt #04scape :End');
    f.client.receive(':op!o@h KICK #04scape bob :spamming');
    assert.deepEqual(f.who('#04scape'), ['@op', 'matt']);
    assert.equal(f.lines().at(-1)?.text, 'bob was kicked by op (spamming)');
});

test('kicked ourselves, the tab stays to say why, empty, and a reconnect does not rejoin it', () => {
    const f = online({ channels: ['#04scape', '#swiftkit'] });
    f.client.receive(':irc.libera.chat 353 matt = #swiftkit :@op matt');
    f.client.receive(':irc.libera.chat 366 matt #swiftkit :End');
    f.client.receive(':op!o@h KICK #swiftkit matt :bye');

    assert.deepEqual(f.channel('#swiftkit').users, []);
    assert.equal(f.channel('#swiftkit').highlights, 1, 'being kicked is worth a badge');
    f.client.select('#swiftkit');
    assert.equal(f.lines().at(-1)?.text, 'you were kicked by op (bye)');
    assert.deepEqual(f.client.wanted(), ['#04scape']);

    f.client.closed('', true);
    f.client.connecting();
    f.client.opened();
    f.sent.length = 0;
    f.client.receive(':irc.libera.chat 001 matt :Welcome');
    assert.deepEqual(f.sent, ['JOIN #04scape']);
});

test('closing the tab of a channel we were kicked from forgets it without a PART the server would refuse', () => {
    const f = online({ channels: ['#04scape', '#swiftkit'] });
    f.client.receive(':op!o@h KICK #swiftkit matt :bye');
    f.sent.length = 0;
    f.client.part('#swiftkit');
    assert.deepEqual(f.sent, []);
    assert.equal(f.client.snapshot().channels.some(c => c.name === '#swiftkit'), false);
});

// ── Status ────────────────────────────────────────────────────────────────

test('the welcome, the MOTD and other numerics are read out in Status without badging it', () => {
    const f = fake();
    f.client.connecting();
    f.client.opened();
    for (const line of [
        ':irc.swiftirc.net 001 matt :Welcome to the SwiftIRC IRC Network matt!m@host',
        ':irc.swiftirc.net 002 matt :Your host is irc.swiftirc.net',
        ':irc.swiftirc.net 004 matt irc.swiftirc.net InspIRCd-3 iosw biklmnopstv',
        ':irc.swiftirc.net 005 matt AWAYLEN=200 PREFIX=(qaohv)~&@%+ :are supported by this server',
        ':irc.swiftirc.net 251 matt :There are 120 users and 3000 invisible on 9 servers',
        ':irc.swiftirc.net 375 matt :irc.swiftirc.net message of the day',
        ':irc.swiftirc.net 372 matt :- Happy chatting!',
        ':irc.swiftirc.net 376 matt :End of message of the day.'
    ]) {
        f.client.receive(line);
    }
    assert.equal(f.channel(SERVER_LOG).unread, 0);
    f.client.select(SERVER_LOG);
    assert.deepEqual(
        f.lines().map(l => l.text),
        [
            'Welcome to the SwiftIRC IRC Network matt!m@host',
            'Your host is irc.swiftirc.net',
            'irc.swiftirc.net InspIRCd-3 iosw biklmnopstv',
            'There are 120 users and 3000 invisible on 9 servers',
            'irc.swiftirc.net message of the day',
            '- Happy chatting!',
            'End of message of the day.'
        ],
        'every numeric but the ISUPPORT tokens'
    );
});

test('formatting codes are stripped from what people say', () => {
    const f = online();
    const colour = String.fromCharCode(3);
    f.client.receive(`:bob!b@h PRIVMSG #04scape :${colour}4red${colour} and plain`);
    assert.equal(f.lines().at(-1)?.text, 'red and plain');
});

// ── the user's own connection ─────────────────────────────────────────────

test('a nick taken while offline is the one the next registration uses', () => {
    const f = fake();
    f.client.rename('Whoosh');
    f.client.connecting();
    f.client.opened();
    assert.deepEqual(f.sent.slice(1), ['NICK Whoosh', 'USER Whoosh 0 * :Zanaris Kit']);
    assert.equal(f.client.snapshot().nick, 'Whoosh');
});

test('rename does nothing on a live connection, where the server has to agree to a new nick', () => {
    const f = online();
    f.client.rename('Whoosh');
    assert.equal(f.client.snapshot().nick, 'matt');
    assert.deepEqual(f.sent, []);
});

test('quit says goodbye only to a server that is listening', () => {
    const offline = fake();
    offline.client.quit();
    assert.deepEqual(offline.sent, []);

    const f = online();
    f.client.quit();
    assert.deepEqual(f.sent, ['QUIT :Zanaris Kit']);
});

// ── what the review found ─────────────────────────────────────────────────

test('a registration that settled on an underscore still identifies the account, not the nick it holds', () => {
    const f = fake({ password: 'hunter2' });
    f.client.connecting();
    f.client.opened();
    f.client.receive(':irc.swiftirc.net 433 * matt :Nickname is already in use.');
    f.sent.length = 0;
    f.client.receive(':irc.swiftirc.net 001 matt_ :Welcome');
    assert.equal(f.sent[0], 'PRIVMSG NickServ :IDENTIFY matt hunter2');
});

test('new credentials on a live connection identify the new account', () => {
    const f = online({ password: 'hunter2' });
    f.client.setCredentials('Whoosh', 'hunter2');
    assert.deepEqual(f.sent, ['PRIVMSG NickServ :IDENTIFY Whoosh hunter2']);
});

test('CAP END goes out once, on an ACK, a NAK, or a server that did not understand the request', () => {
    for (const answer of [':irc.swiftirc.net CAP * ACK :multi-prefix', ':irc.swiftirc.net CAP * NAK :multi-prefix', ':irc.swiftirc.net 410 * FOO :Invalid CAP command']) {
        const f = fake();
        f.client.connecting();
        f.client.opened();
        f.sent.length = 0;
        f.client.receive(answer);
        f.client.receive(answer);
        assert.deepEqual(f.sent, ['CAP END'], answer);
    }
});

test('a CAP line that is not the answer, or one after the welcome, sends nothing', () => {
    const f = fake();
    f.client.connecting();
    f.client.opened();
    f.sent.length = 0;
    f.client.receive(':irc.swiftirc.net CAP * LS :multi-prefix sasl');
    assert.deepEqual(f.sent, []);
    f.client.receive(':irc.swiftirc.net 001 matt :Welcome');
    f.sent.length = 0;
    f.client.receive(':irc.swiftirc.net CAP matt ACK :multi-prefix');
    assert.deepEqual(f.sent, [], 'registration is already over');
});

test('closing a channel the server put us in, unasked, still parts it', () => {
    const f = online();
    f.client.receive(':matt!m@h JOIN #redirected');
    f.sent.length = 0;
    f.client.part('#redirected');
    assert.deepEqual(f.sent, ['PART #redirected']);
});

test('rejoining a channel we were kicked from makes its close a real PART again', () => {
    const f = online({ channels: ['#04scape', '#swiftkit'] });
    f.client.receive(':op!o@h KICK #swiftkit matt :bye');
    f.client.input('/join #swiftkit');
    f.client.receive(':matt!m@h JOIN #swiftkit');
    f.sent.length = 0;
    f.client.part('#swiftkit');
    assert.deepEqual(f.sent, ['PART #swiftkit']);
});

test('a typed IDENTIFY to NickServ is sent whole but echoed without the password', () => {
    const f = online();
    f.client.input('/msg NickServ IDENTIFY matt hunter2');
    f.client.input('/msg nickserv register hunter2 me@example.com');
    f.client.input('/msg NickServ SET PASSWORD hunter3');
    f.client.input('/msg NickServ HELP');
    assert.deepEqual(f.sent, ['PRIVMSG NickServ :IDENTIFY matt hunter2', 'PRIVMSG nickserv :register hunter2 me@example.com', 'PRIVMSG NickServ :SET PASSWORD hunter3', 'PRIVMSG NickServ HELP']);
    f.client.select(SERVER_LOG);
    const echoed = f.lines().slice(1).map(l => l.text);
    assert.deepEqual(echoed, ['IDENTIFY (hidden)', 'register (hidden)', 'SET PASSWORD (hidden)', 'HELP']);
});

test('an invite badges Status, since it is addressed to you', () => {
    const f = online();
    f.client.receive(':bob!b@h INVITE matt #secret');
    assert.equal(f.channel(SERVER_LOG).unread, 1);
});
