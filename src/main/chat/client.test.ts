import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelay, IrcClient, MAX_CONVERSATIONS, type ClientOpts } from './client.ts';
import { SERVER_LOG, type ChatChannel } from '../../shared/chat.ts';
import { COMMAND_HELP } from '../../shared/chatInput.ts';

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
        nick: 'mage',
        channels: ['#04scape'],
        now: () => clock.now,
        send: line => sent.push(line),
        ...opts
    });
    // A chat pane on screen, as every test here assumes unless it says otherwise.
    client.seePings();
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
    f.client.receive(':irc.libera.chat 001 mage :Welcome to Libera.Chat, mage');
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
    assert.deepEqual(f.sent, ['CAP REQ multi-prefix', 'NICK mage', 'USER mage 0 * :Zanaris Kit']);

    f.sent.length = 0;
    f.client.receive(':irc.libera.chat 001 mage :Welcome to Libera.Chat, mage');
    assert.equal(f.client.snapshot().status, 'online');
    assert.deepEqual(f.sent, ['JOIN #04scape'], 'everything wanted is joined');
    assert.equal(f.client.snapshot().error, null);
});

test('001 takes the nick the server settled on', () => {
    const f = fake();
    f.client.connecting();
    f.client.opened();
    f.client.receive(':irc.libera.chat 001 mage2 :Welcome');
    assert.equal(f.client.snapshot().nick, 'mage2');
});

test('PING is answered with the same token', () => {
    const f = online();
    f.client.receive('PING :LAG1234567890');
    assert.deepEqual(f.sent, ['PONG LAG1234567890']);
});

test('closed reconnects or gives up, and forgets who was in the room', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 353 mage = #04scape :mage bob');
    f.client.receive(':irc.libera.chat 366 mage #04scape :End of /NAMES list');
    assert.equal(f.channel('#04scape').users.length, 2);

    f.client.closed('connection reset', true);
    assert.equal(f.client.snapshot().status, 'reconnecting');
    assert.equal(f.client.snapshot().error, 'connection reset');
    assert.deepEqual(f.channel('#04scape').users, [], 'the nick list is stale the moment the socket dies');

    f.client.closed('gave up', false);
    assert.equal(f.client.snapshot().status, 'offline');
});

test('backoff grows and is capped, so a long outage is not a hammering', () => {
    const middle = (): number => 0.5; // the unspread wait
    assert.equal(backoffDelay(1, middle), 1_000);
    assert.equal(backoffDelay(2, middle), 2_000);
    assert.equal(backoffDelay(3, middle), 4_000);
    assert.ok(backoffDelay(4, middle) > backoffDelay(3, middle));
    assert.equal(backoffDelay(20, middle), backoffDelay(6, middle), 'capped');
    assert.ok(backoffDelay(20, () => 0.999_999) <= 60_000, 'spread and all');
    assert.equal(backoffDelay(0, middle), 1_000, 'a nonsense attempt still waits');
});

test('each wait is spread by up to a quarter either way, so kits dropped together do not return together', () => {
    assert.equal(backoffDelay(1, () => 0), 750);
    assert.equal(backoffDelay(1, () => 0.999_999), 1_250);
    assert.equal(backoffDelay(3, () => 0), 3_000);
    assert.equal(backoffDelay(20, () => 0), 22_500, 'the cap is spread too, or every kit would meet at it');
    assert.equal(backoffDelay(20, () => 0.999_999), 37_500);
    const waits = new Set([0, 0.2, 0.4, 0.6, 0.8].map(r => backoffDelay(2, () => r)));
    assert.equal(waits.size, 5, 'different draws, different waits');
    assert.equal(backoffDelay(1, () => 7), 1_250, 'a random out of range is held to it');
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

test('a private message opens a conversation with whoever sent it, and always highlights', () => {
    const f = online();
    f.client.receive(':bob!~b@host PRIVMSG mage :psst, over here');
    assert.equal(f.channel('bob').unread, 1, 'a tab of its own, badged');
    assert.equal(f.client.snapshot().active, '#04scape', 'it does not take the open tab away');
    f.client.select('bob');
    const line = f.lines().at(-1);
    assert.equal(line?.kind, 'say', 'the tab says it is private, so the line need not');
    assert.equal(line?.nick, 'bob');
    assert.equal(line?.text, 'psst, over here');
    assert.equal(line?.highlight, true);
});

test('a notice is a system line', () => {
    const f = online();
    f.client.receive(':NickServ!s@services. NOTICE mage :This nickname is registered.');
    f.client.select(SERVER_LOG);
    const line = f.lines().at(-1);
    assert.equal(line?.kind, 'system');
    assert.equal(line?.nick, null);
    assert.match(line?.text ?? '', /NickServ.*registered/);
});

test('a command that is not a numeric and not handled is ignored quietly', () => {
    const f = online();
    const before = f.client.snapshot().channels.map(c => c.name).length;
    f.client.receive(':irc.libera.chat CAP mage ACK :multi-prefix');
    f.client.receive(':bob!b@h WALLOPS :nothing for us');
    f.client.select(SERVER_LOG);
    assert.deepEqual(
        f.lines().map(l => l.text),
        ['Welcome to Libera.Chat, mage'],
        'only the welcome, which the handshake already put there'
    );
    assert.equal(f.client.snapshot().channels.length, before);
});

// ── who is in the room ────────────────────────────────────────────────────

test('NAMES builds the user list, ranked first and named second, keeping every rank symbol', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 353 mage = #04scape :@zed mage +bob');
    f.client.receive(':irc.libera.chat 353 mage = #04scape :alice @+Carol ~owner');
    assert.deepEqual(f.channel('#04scape').users, [], 'nothing until the list ends');
    f.client.receive(':irc.libera.chat 366 mage #04scape :End of /NAMES list');
    assert.deepEqual(f.who('#04scape'), ['~owner', '@+Carol', '@zed', '+bob', 'alice', 'mage']);
});

test('a userhost-in-names entry is listed by its nick alone', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 353 mage = #04scape :@zed!z@host.example mage!m@elsewhere');
    f.client.receive(':irc.libera.chat 366 mage #04scape :End of /NAMES list');
    assert.deepEqual(f.who('#04scape'), ['@zed', 'mage']);
});

test('a server that says its PREFIX is (ov)@+ has no half-ops, so a % is part of a nick', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 005 mage PREFIX=(ov)@+ CHANTYPES=# :are supported by this server');
    f.client.receive(':irc.libera.chat 353 mage = #04scape :@zed %odd');
    f.client.receive(':irc.libera.chat 366 mage #04scape :End of /NAMES list');
    assert.deepEqual(f.who('#04scape'), ['@zed', '%odd']);
});

test('JOIN, PART, QUIT and NICK keep the nick list right', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 353 mage = #04scape :mage bob');
    f.client.receive(':irc.libera.chat 366 mage #04scape :End of /NAMES list');

    f.client.receive(':alice!a@h JOIN #04scape');
    assert.deepEqual(f.who('#04scape'), ['alice', 'bob', 'mage']);

    f.client.receive(':alice!a@h NICK alicia');
    assert.deepEqual(f.who('#04scape'), ['alicia', 'bob', 'mage']);

    f.client.receive(':alicia!a@h PART #04scape :bye');
    assert.deepEqual(f.who('#04scape'), ['bob', 'mage']);

    f.client.receive(':bob!b@h QUIT :Ping timeout');
    assert.deepEqual(f.who('#04scape'), ['mage']);
});

test('our own NICK follows us', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 353 mage = #04scape :mage');
    f.client.receive(':irc.libera.chat 366 mage #04scape :End of /NAMES list');
    f.client.receive(':mage!m@h NICK archmage');
    assert.equal(f.client.snapshot().nick, 'archmage');
    assert.deepEqual(f.who('#04scape'), ['archmage']);
});

test('our own PART closes the channel', () => {
    const f = online();
    f.client.receive(':mage!m@h PART #04scape :bye');
    assert.deepEqual(
        f.client.snapshot().channels.map(c => c.name),
        [SERVER_LOG]
    );
});

// ── badges ────────────────────────────────────────────────────────────────

test('a line naming you is highlighted and counted', () => {
    const f = online();
    f.client.receive(':bob!b@h PRIVMSG #04scape :mage: look at this');
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
    f.client.receive(':bob!b@h PRIVMSG #swiftkit :mage: and again');
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

test('a mention seen while its tab was open does not colour the tab once it is left', () => {
    const f = online({ channels: ['#04scape', '#other'] });
    f.client.receive(':bob!b@h PRIVMSG #04scape :mage: look');
    f.client.select('#other');
    f.client.receive(':bob!b@h PRIVMSG #04scape :plain');
    assert.equal(f.channel('#04scape').unread, 1);
    assert.equal(f.channel('#04scape').highlights, 0);
});

// ── pings ─────────────────────────────────────────────────────────────────

test('a ping is the newest line for you, with how many more are waiting', () => {
    const f = online({ channels: ['#04scape', '#swiftkit'] });
    f.client.receive(':bob!b@h PRIVMSG #04scape :mage: look at this');
    f.client.receive(':bob!b@h PRIVMSG #04scape :nothing to see');
    f.client.receive(':carol!c@h PRIVMSG #swiftkit :mage, you there?');
    const ping = f.client.snapshot().ping;
    assert.equal(ping?.line.nick, 'carol');
    assert.equal(ping?.line.text, 'mage, you there?');
    assert.equal(ping?.more, 1, "bob's, and not the line that named nobody");
});

test('a plain line is never a ping', () => {
    const f = online();
    f.client.receive(':bob!b@h PRIVMSG #04scape :nothing to see');
    assert.equal(f.client.snapshot().ping, null);
});

test('a ping said to you alone is private, and one naming you in a channel is not', () => {
    const f = online();
    f.client.receive(':bob!b@h PRIVMSG #04scape :mage: look');
    assert.equal(f.client.snapshot().ping?.private, false);
    f.client.receive(':bob!b@h PRIVMSG mage :psst');
    assert.equal(f.client.snapshot().ping?.private, true);
});

test('a private message past the most conversations is still private, though it lands in Status', () => {
    const f = online();
    for (let i = 0; i < MAX_CONVERSATIONS; i++) f.client.receive(`:n${i}!u@h PRIVMSG mage :hi`);
    f.client.receive(':late!l@h PRIVMSG mage :me too');
    const ping = f.client.snapshot().ping;
    assert.equal(ping?.line.channel, SERVER_LOG);
    assert.equal(ping?.private, true);
});

test('seeing chat on screen reads every ping, in every room, and says whether there was one', () => {
    const f = online({ channels: ['#04scape', '#swiftkit'] });
    f.client.receive(':bob!b@h PRIVMSG #04scape :mage: look');
    f.client.receive(':carol!c@h PRIVMSG #swiftkit :mage: and here');
    assert.equal(f.client.seePings(), true);
    assert.equal(f.client.snapshot().ping, null);
    assert.equal(f.client.seePings(), false, 'nothing new since');
    assert.equal(f.channel('#swiftkit').highlights, 1, "the room's own count is chat's, and is read when the room is opened");
});

test('a ping after chat was on screen is the only one waiting', () => {
    const f = online();
    f.client.receive(':bob!b@h PRIVMSG #04scape :mage: look');
    f.client.seePings();
    f.client.receive(':bob!b@h PRIVMSG #04scape :mage: again');
    const ping = f.client.snapshot().ping;
    assert.equal(ping?.line.text, 'mage: again');
    assert.equal(ping?.more, 0, 'the first was seen, though the room open in chat still counts it until it is left');
});

test('opening the room a ping came in reads it', () => {
    const f = online({ channels: ['#04scape', '#swiftkit'] });
    f.client.receive(':carol!c@h PRIVMSG #swiftkit :mage: over here');
    f.client.select('#swiftkit');
    assert.equal(f.client.snapshot().ping, null);
});

test('closing the room a ping came in takes the ping with it', () => {
    const f = online();
    f.client.receive(':bob!b@h PRIVMSG mage :psst');
    f.client.close('bob');
    assert.equal(f.client.snapshot().ping, null);
});

// ── chat out of sight ─────────────────────────────────────────────────────

test('a new client has seen nothing until a chat pane is on screen', () => {
    const client = new IrcClient({ nick: 'mage', channels: ['#04scape'], now: () => 0, send: () => {} });
    client.connecting();
    client.opened();
    client.receive(':irc.libera.chat 001 mage :Welcome');
    client.receive(':bob!b@h PRIVMSG #04scape :before anyone looked');
    assert.equal(client.snapshot().channels.find(c => c.name === '#04scape')?.unread, 1);
});

test('while chat is out of sight the open room counts what arrives, and chat on screen marks where it begins', () => {
    const f = online();
    f.client.receive(':bob!b@h PRIVMSG #04scape :read on screen');
    f.client.lookAway();
    f.client.receive(':bob!b@h PRIVMSG #04scape :while nobody looked');
    f.client.receive(':bob!b@h PRIVMSG #04scape :and again');
    assert.equal(f.channel('#04scape').unread, 2);

    f.client.seePings();
    assert.equal(f.channel('#04scape').unread, 0, 'read by being on screen');
    assert.equal(f.client.snapshot().newFrom, f.lines().find(l => l.text === 'while nobody looked')?.id);
});

test('a mention in the open room while chat is out of sight is still counted after a ping elsewhere opens chat', () => {
    const f = online({ channels: ['#LostHQ'] });
    f.client.lookAway();
    f.client.receive(':bob!b@h PRIVMSG #LostHQ :mage: are you there?');
    f.client.receive(':Zezima!z@h PRIVMSG mage :psst');
    assert.equal(f.client.snapshot().ping?.more, 1);

    // The ping clicked: main opens chat on Zezima's conversation, then shows it.
    f.client.select('Zezima');
    f.client.seePings();
    assert.equal(f.channel('Zezima').unread, 0);
    assert.equal(f.client.snapshot().newFrom, f.lines().find(l => l.text === 'psst')?.id);
    assert.equal(f.channel('#LostHQ').unread, 1);
    assert.equal(f.channel('#LostHQ').highlights, 1, 'gold on the rail');

    f.client.select('#LostHQ');
    assert.equal(f.client.snapshot().newFrom, f.lines().find(l => l.text === 'mage: are you there?')?.id);
});

test('a room opened while chat is out of sight is read only once chat is on screen', () => {
    const f = online({ channels: ['#04scape', '#other'] });
    f.client.lookAway();
    f.client.receive(':bob!b@h PRIVMSG #other :mage: over here');
    f.client.select('#other');
    f.client.receive(':bob!b@h PRIVMSG #other :still here');
    assert.equal(f.channel('#other').unread, 2);
    assert.equal(f.channel('#other').highlights, 1);
    assert.notEqual(f.client.snapshot().ping, null, 'still waiting in the game header');

    f.client.seePings();
    assert.equal(f.channel('#other').unread, 0);
    assert.equal(f.channel('#other').highlights, 0);
    assert.equal(f.client.snapshot().newFrom, f.lines().find(l => l.text === 'mage: over here')?.id);
});

test('chat looking away again changes nothing about where the open room was left', () => {
    const f = online();
    f.client.lookAway();
    f.client.receive(':bob!b@h PRIVMSG #04scape :first while away');
    f.client.lookAway();
    f.client.receive(':bob!b@h PRIVMSG #04scape :second');
    f.client.seePings();
    assert.equal(f.client.snapshot().newFrom, f.lines().find(l => l.text === 'first while away')?.id);
});

test('chat seen again while already on screen leaves the divider where it was', () => {
    const f = online({ channels: ['#04scape', '#other'] });
    f.client.receive(':bob!b@h PRIVMSG #other :while you were away');
    f.client.select('#other');
    const divider = f.client.snapshot().newFrom;
    assert.notEqual(divider, null);
    f.client.receive(':bob!b@h PRIVMSG #other :and now');
    f.client.seePings();
    assert.equal(f.client.snapshot().newFrom, divider);
});

test('chat out of sight and back with nothing new draws no divider, as leaving a room and coming back does', () => {
    const f = online({ channels: ['#04scape', '#other'] });
    f.client.receive(':bob!b@h PRIVMSG #other :hi');
    f.client.select('#other');
    assert.notEqual(f.client.snapshot().newFrom, null);
    f.client.lookAway();
    f.client.seePings();
    assert.equal(f.client.snapshot().newFrom, null);
});

test('a mention read in the open room is not counted once chat is out of sight', () => {
    const f = online({ channels: ['#04scape', '#other'] });
    f.client.receive(':bob!b@h PRIVMSG #04scape :mage: look');
    f.client.lookAway();
    f.client.select('#other');
    assert.equal(f.channel('#04scape').unread, 0);
    assert.equal(f.channel('#04scape').highlights, 0);
});

test("the kit's own word in Status counts while chat is out of sight, though Status is open", () => {
    const f = fake({ channels: [] });
    f.client.lookAway();
    f.client.connecting();
    f.client.opened();
    f.client.receive(':irc.libera.chat 432 * mage :Erroneous Nickname');
    assert.equal(f.client.snapshot().active, SERVER_LOG);
    assert.equal(f.channel(SERVER_LOG).unread, 1);
});

test('a room taken away while chat is out of sight hands over to Status without reading it', () => {
    const f = online({ channels: ['#04scape', '#other'] });
    f.client.select(SERVER_LOG);
    f.client.select('#04scape');
    f.client.lookAway();
    f.client.receive(':irc.libera.chat NOTICE mage :maintenance at noon');
    f.client.receive(':mage!m@h PART #04scape');
    assert.equal(f.client.snapshot().active, SERVER_LOG);
    assert.equal(f.channel(SERVER_LOG).unread, 1);

    f.client.seePings();
    assert.equal(f.channel(SERVER_LOG).unread, 0);
    assert.equal(f.client.snapshot().newFrom, f.lines().find(l => l.text.includes('maintenance at noon'))?.id);
});

// ── churn and the New divider ─────────────────────────────────────────────

test('churn in a channel is marked as presence, and a kick or a private quit is not', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 353 mage = #04scape :mage bob carl');
    f.client.receive(':irc.libera.chat 366 mage #04scape :End of /NAMES list');
    f.client.receive(':alice!a@h JOIN #04scape');
    f.client.receive(':alice!a@h NICK alicia');
    f.client.receive(':alicia!a@h PART #04scape :bye');
    f.client.receive(':bob!b@h QUIT :Ping timeout');
    f.client.receive(':zed!z@h KICK #04scape carl :spam');
    assert.deepEqual(
        f.lines().map(l => l.presence),
        ['join', 'nick', 'part', 'quit', undefined]
    );
    assert.ok(!('presence' in f.lines().at(-1)!), 'absent, not undefined');

    f.client.receive(':dave!d@h PRIVMSG mage :hi');
    f.client.select('dave');
    f.client.receive(':dave!d@h QUIT :gone');
    assert.equal(f.lines().at(-1)?.text, 'dave quit (gone)');
    assert.ok(!('presence' in f.lines().at(-1)!), 'the one person you are talking to leaving is news');
});

test('coming back to a tab marks where what arrived while it was left begins', () => {
    const f = online({ channels: ['#04scape', '#other'] });
    f.client.receive(':bob!b@h PRIVMSG #04scape :before');
    f.client.select('#other');
    assert.equal(f.client.snapshot().newFrom, null, 'nothing unread in #other');
    f.client.receive(':bob!b@h JOIN #04scape');
    f.client.select('#04scape');
    assert.equal(f.client.snapshot().newFrom, null, 'churn alone draws no divider');

    f.client.select('#other');
    f.client.receive(':carl!c@h JOIN #04scape');
    f.client.receive(':bob!b@h PRIVMSG #04scape :while you were away');
    f.client.select('#04scape');
    const joined = f.lines().at(-2)!;
    assert.equal(joined.text, 'carl joined');
    assert.equal(f.client.snapshot().newFrom, joined.id, 'above the first line of any kind since the tab was left');

    f.client.receive(':bob!b@h PRIVMSG #04scape :and now');
    f.client.select('#04scape');
    assert.equal(f.client.snapshot().newFrom, joined.id, 'it stays while you stay, reselecting included');

    f.client.select('#other');
    f.client.select('#04scape');
    assert.equal(f.client.snapshot().newFrom, null, 'leaving clears it, and nothing arrived since');
});

test('our own rename is news, not churn', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 353 mage = #04scape :mage bob');
    f.client.receive(':irc.libera.chat 366 mage #04scape :End of /NAMES list');
    f.client.receive(':mage!m@h NICK Guest123');
    assert.equal(f.lines().at(-1)?.text, 'mage is now known as Guest123');
    assert.ok(!('presence' in f.lines().at(-1)!), 'a services rename to a guest nick must not fold away');
});

test('closing the open tab opens Status as selecting it would, so its count is read', () => {
    const f = online({ channels: ['#04scape', '#other'] });
    f.client.select(SERVER_LOG);
    f.client.select('#04scape');
    f.client.receive(':irc.libera.chat NOTICE mage :maintenance at noon');
    assert.equal(f.channel(SERVER_LOG).unread, 1);

    f.client.close('#04scape');
    assert.equal(f.client.snapshot().active, SERVER_LOG);
    assert.equal(f.channel(SERVER_LOG).unread, 0, 'read by being open');
    const notice = f.lines().find(l => l.text.includes('maintenance at noon'));
    assert.equal(f.client.snapshot().newFrom, notice?.id, 'what arrived while it was left is marked');

    f.client.select('#other');
    f.client.receive(':mage!m@h MODE mage :+i');
    f.client.select(SERVER_LOG);
    assert.equal(f.client.snapshot().newFrom, null, 'no stale count to draw a divider over a line that never counted');
});

test('a tab closed while open hands over to Status with no divider', () => {
    const f = online({ channels: ['#04scape', '#other'] });
    f.client.receive(':bob!b@h PRIVMSG #other :hi');
    f.client.select('#other');
    assert.notEqual(f.client.snapshot().newFrom, null);
    f.client.close('#other');
    assert.equal(f.client.snapshot().active, SERVER_LOG);
    assert.equal(f.client.snapshot().newFrom, null);
});

// ── nick collisions ───────────────────────────────────────────────────────

test('433 tries again with an underscore, and gives up rather than looping', () => {
    const f = fake();
    f.client.connecting();
    f.client.opened();
    f.sent.length = 0;

    for (const taken of ['mage', 'mage_', 'mage__', 'mage___', 'mage____']) {
        f.client.receive(`:irc.libera.chat 433 * ${taken} :Nickname is already in use.`);
    }
    assert.deepEqual(f.sent, ['NICK mage_', 'NICK mage__', 'NICK mage___'], 'three tries, then it stops asking');

    f.client.select(SERVER_LOG);
    assert.match(f.lines().at(-1)?.text ?? '', /nick/i, 'the panel is told why the nick is not the one asked for');
});

test('433s past the last underscore end the attempt, naming the nick asked for and where to pick another', () => {
    const f = fake();
    f.client.connecting();
    f.client.opened();
    for (const taken of ['mage', 'mage_', 'mage__']) f.client.receive(`:irc.swiftirc.net 433 * ${taken} :Nickname is already in use.`);
    assert.equal(f.client.turnedAway(), null, 'still trying');

    f.client.receive(':irc.swiftirc.net 433 * mage___ :Nickname is already in use.');
    const why = f.client.turnedAway();
    assert.match(why ?? '', /The nick mage is taken\. Pick another in chat's Settings tab\./);
    assert.equal(f.client.snapshot().error, why);

    // The close the holder of the socket makes next keeps the reason rather than clearing it.
    f.client.closed('', false);
    assert.equal(f.client.snapshot().status, 'offline');
    assert.equal(f.client.snapshot().error, why);

    // And a new connection starts clean.
    f.client.connecting();
    assert.equal(f.client.turnedAway(), null);
    assert.equal(f.client.snapshot().error, null);
});

test('437, a nick held for a while, is tried again with an underscore as a taken one is', () => {
    const f = fake();
    f.client.connecting();
    f.client.opened();
    f.sent.length = 0;
    f.client.receive(':irc.swiftirc.net 437 * mage :Nick/channel is temporarily unavailable');
    assert.deepEqual(f.sent, ['NICK mage_']);
    for (const held of ['mage_', 'mage__', 'mage___']) f.client.receive(`:irc.swiftirc.net 437 * ${held} :Nick/channel is temporarily unavailable`);
    assert.deepEqual(f.sent, ['NICK mage_', 'NICK mage__', 'NICK mage___']);
    assert.match(f.client.turnedAway() ?? '', /mage is taken/);

    // A 437 about a channel is still a join refused, and nothing to do with the nick.
    const g = online();
    g.client.receive(':irc.swiftirc.net 437 mage #held :Nick/channel is temporarily unavailable');
    assert.equal(g.client.turnedAway(), null);
    g.client.select(SERVER_LOG);
    assert.equal(g.lines().at(-1)?.text, 'cannot join #held: it is temporarily unavailable');
});

test('432 during registration ends the attempt at once, with the server\'s reason in Status', () => {
    const seen: string[] = [];
    const f = fake({ nick: 'averyveryverylongnickname', onHighlight: line => seen.push(line.text) });
    f.client.connecting();
    f.client.opened();
    f.sent.length = 0;
    f.client.receive(':irc.swiftirc.net 432 * averyveryverylongnickname :Erroneous Nickname');
    assert.deepEqual(f.sent, [], 'no underscore: a longer nick is no more acceptable');
    assert.match(f.client.turnedAway() ?? '', /won't take the nick averyveryverylongnickname\..*Pick another in chat's Settings tab\./);
    assert.equal(f.channel(SERVER_LOG).unread, 1, 'badged');
    assert.deepEqual(seen, [], 'but not a mention, though it names our nick');
    f.client.select(SERVER_LOG);
    assert.match(f.lines().at(-1)?.text ?? '', /averyveryverylongnickname \(Erroneous Nickname\)/);
    assert.equal(f.lines().at(-1)?.highlight, false);
});

test('a 432 for an underscored try is the length it added: the nick asked for is still the taken one', () => {
    const f = fake();
    f.client.connecting();
    f.client.opened();
    f.client.receive(':irc.swiftirc.net 433 * mage :Nickname is already in use.');
    f.client.receive(':irc.swiftirc.net 432 * mage_ :Erroneous Nickname');
    assert.match(f.client.turnedAway() ?? '', /^The nick mage is taken\./);
});

test('once given up, the answers to NICKs still on the wire change nothing', () => {
    const f = fake();
    f.client.connecting();
    f.client.opened();
    f.client.receive(':irc.swiftirc.net 432 * mage :Erroneous Nickname');
    const why = f.client.turnedAway();
    f.sent.length = 0;
    f.client.receive(':irc.swiftirc.net 433 * mage :Nickname is already in use.');
    assert.deepEqual(f.sent, []);
    assert.equal(f.client.turnedAway(), why);
});

test('432 and 437 answering a live rename are reported and leave the connection alone', () => {
    const f = online();
    f.client.receive(':irc.swiftirc.net 432 mage NickServ :Invalid nickname: Reserved for services');
    f.client.receive(':irc.swiftirc.net 437 mage held :Nick/channel is temporarily unavailable');
    assert.deepEqual(f.sent, []);
    assert.equal(f.client.turnedAway(), null);
    assert.equal(f.client.snapshot().status, 'online');
    f.client.select(SERVER_LOG);
    assert.deepEqual(f.lines().slice(1).map(l => l.text), [
        'the nick NickServ is not allowed (Invalid nickname: Reserved for services)',
        'the nick held is unavailable right now'
    ]);
});

test('every registration starts from the nick chosen, not the underscores or the rename the last one ended on', () => {
    const f = fake();
    f.client.connecting();
    f.client.opened();
    for (const taken of ['mage', 'mage_', 'mage__', 'mage___']) f.client.receive(`:irc.swiftirc.net 433 * ${taken} :Nickname is already in use.`);
    f.client.closed('', false);

    f.client.connecting();
    f.sent.length = 0;
    f.client.opened();
    assert.deepEqual(f.sent.slice(1), ['NICK mage', 'USER mage 0 * :Zanaris Kit'], 'not mage____');

    f.client.receive(':irc.swiftirc.net 001 mage :Welcome');
    f.client.receive(':mage!m@h NICK Guest12345');
    f.client.closed('connection reset', true);
    f.client.connecting();
    f.sent.length = 0;
    f.client.opened();
    assert.deepEqual(f.sent.slice(1), ['NICK mage', 'USER mage 0 * :Zanaris Kit'], 'a services rename was that connection\'s, not the next one\'s');
});

test('a 433 answering a live rename reports the refusal and leaves the working nick and the cascade alone', () => {
    const f = online(); // registered as mage, sent cleared
    f.client.input('/nick taken');
    assert.deepEqual(f.sent, ['NICK taken']);
    f.sent.length = 0;

    f.client.receive(':irc.libera.chat 433 mage taken :Nickname is already in use.');
    assert.deepEqual(f.sent, [], 'nothing is retried: mage is still registered and working');
    assert.equal(f.client.snapshot().nick, 'mage', 'the working nick is untouched by the refusal');
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
    for (const again of ['mage', 'mage_', 'mage__', 'mage___', 'mage____']) {
        f.client.receive(`:irc.libera.chat 433 * ${again} :Nickname is already in use.`);
    }
    assert.deepEqual(f.sent, ['NICK mage_', 'NICK mage__', 'NICK mage___'], 'a fresh registration still runs the full cascade');
});

// ── failed joins ──────────────────────────────────────────────────────────

test('a refused join says which channel and why', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 403 mage #nope :No such channel');
    f.client.receive(':irc.libera.chat 473 mage #invite :Cannot join channel (+i)');
    f.client.receive(':irc.libera.chat 474 mage #banned :Cannot join channel (+b)');
    f.client.receive(':irc.libera.chat 475 mage #keyed :Cannot join channel (+k)');
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
        [['say', 'mage', 'hello world']]
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
        [['private', 'mage', 'hi there']],
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
    f.client.receive(':irc.libera.chat 001 mage :Welcome');
    assert.deepEqual(f.sent, ['JOIN #04scape']);
});

test('a command this client does not read itself goes to the server as typed, uppercased', () => {
    const f = online();
    f.client.input('/mode #04scape +m');
    f.client.input('/who #04scape');
    assert.deepEqual(f.sent, ['MODE #04scape +m', 'WHO #04scape']);
    assert.deepEqual(f.lines(), [], 'the server answers in Status; the client does not echo what it does not understand');
});

test('a passed-through command while not connected says so instead of being dropped silently', () => {
    const f = fake();
    f.client.input('/mode #04scape +m');
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
    f.client.input('/nick archmage');
    assert.deepEqual(f.sent, ['NICK archmage']);
    assert.equal(f.client.snapshot().nick, 'mage', 'still the old nick until the server says otherwise');
    f.client.receive(':mage!m@h NICK archmage');
    assert.equal(f.client.snapshot().nick, 'archmage');
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
    f.client.receive(':irc.swiftirc.net 001 mage :Welcome to SwiftIRC, mage');
    assert.deepEqual(f.sent, ['PRIVMSG NickServ :IDENTIFY mage hunter2 with spaces', 'JOIN #04scape'], 'named, so the spaces stay in the password');

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
    f.client.receive(':irc.swiftirc.net 001 mage :Welcome');
    assert.deepEqual(f.sent, ['JOIN #04scape']);
});

test('a password given on a live connection identifies at once, and a cleared one is not sent on the next welcome', () => {
    const f = online();
    f.client.setCredentials('mage', 'hunter2');
    assert.deepEqual(f.sent, ['PRIVMSG NickServ :IDENTIFY mage hunter2']);
    f.client.setCredentials('mage', 'hunter2');
    assert.equal(f.sent.length, 1, 'the same credentials again are not re-sent');

    f.client.setCredentials('mage', null);
    f.client.closed('', true);
    f.client.connecting();
    f.client.opened();
    f.sent.length = 0;
    f.client.receive(':irc.swiftirc.net 001 mage :Welcome');
    assert.deepEqual(f.sent, ['JOIN #04scape']);
});

test('a password given while offline waits for the welcome', () => {
    const f = fake();
    f.client.setCredentials('mage', 'hunter2');
    assert.deepEqual(f.sent, []);
    f.client.connecting();
    f.client.opened();
    f.sent.length = 0;
    f.client.receive(':irc.swiftirc.net 001 mage :Welcome');
    assert.equal(f.sent[0], 'PRIVMSG NickServ :IDENTIFY mage hunter2');
});

// ── ranks and modes ───────────────────────────────────────────────────────

test('a MODE giving and taking ranks moves people up and down the list, and is said in the room', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 353 mage = #04scape :mage bob alice');
    f.client.receive(':irc.libera.chat 366 mage #04scape :End of /NAMES list');

    f.client.receive(':ChanServ!s@services. MODE #04scape +ov bob alice');
    assert.deepEqual(f.who('#04scape'), ['@bob', '+alice', 'mage']);

    f.client.receive(':ChanServ!s@services. MODE #04scape +v bob');
    assert.deepEqual(f.who('#04scape'), ['@+bob', '+alice', 'mage'], 'a second rank is kept below the first');

    f.client.receive(':ChanServ!s@services. MODE #04scape -o+l bob 50');
    assert.deepEqual(f.who('#04scape'), ['+alice', '+bob', 'mage'], 'losing op leaves the voice, and the limit takes its own parameter');

    assert.deepEqual(
        f.lines().map(l => l.text),
        ['ChanServ sets mode +ov bob alice', 'ChanServ sets mode +v bob', 'ChanServ sets mode -o+l bob 50']
    );
});

test('a nick change keeps its rank', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 353 mage = #04scape :@zed mage');
    f.client.receive(':irc.libera.chat 366 mage #04scape :End of /NAMES list');
    f.client.receive(':zed!z@h NICK aaron');
    assert.deepEqual(f.who('#04scape'), ['@aaron', 'mage']);
});

test('joining asks for the channel modes, and 324 and 329 fill them in, flags only', () => {
    const f = online();
    f.client.receive(':mage!m@h JOIN #swiftkit');
    assert.deepEqual(f.sent, ['MODE #swiftkit']);
    assert.equal(f.channel('#swiftkit').modes, null, 'not known until the server says');

    f.client.receive(':irc.libera.chat 324 mage #swiftkit +ntkl sekrit 50');
    f.client.receive(':irc.libera.chat 329 mage #swiftkit 1757478015');
    assert.equal(f.channel('#swiftkit').modes, '+ntkl', 'the key itself is not shown');
    assert.equal(f.channel('#swiftkit').createdAt, 1_757_478_015_000);

    f.client.receive(':op!o@h MODE #swiftkit -k+m sekrit');
    assert.equal(f.channel('#swiftkit').modes, '+ntlm');
    f.client.receive(':op!o@h MODE #swiftkit +b *!*@bad');
    assert.equal(f.channel('#swiftkit').modes, '+ntlm', 'a ban is a list entry, not a flag');
});

test('our own user modes are said in Status', () => {
    const f = online();
    f.client.receive(':mage MODE mage :+ixz');
    f.client.receive(':irc.swiftirc.net 221 mage +ixz');
    f.client.select(SERVER_LOG);
    assert.deepEqual(f.lines().slice(-2).map(l => l.text), ['mage sets mode +ixz on mage', 'your modes are +ixz']);
});

// ── topics ────────────────────────────────────────────────────────────────

test('332 and 333 give the topic, who set it and when, without a line in the room', () => {
    const f = online();
    const bold = String.fromCharCode(2);
    f.client.receive(`:irc.swiftirc.net 332 mage #04scape :${bold}Migrating channels${bold}, please join #LostCity`);
    f.client.receive(':irc.swiftirc.net 333 mage #04scape Collin!c@host.example 1786319756');
    assert.deepEqual(f.channel('#04scape').topic, { text: 'Migrating channels, please join #LostCity', setBy: 'Collin', setAt: 1_786_319_756_000 });
    f.client.receive(':irc.swiftirc.net 333 mage #04scape Collin 1786319756');
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
    f.client.receive(':irc.swiftirc.net 332 mage #04scape :Hello');
    f.client.receive(':irc.swiftirc.net 324 mage #04scape +nt');
    f.client.receive(':irc.libera.chat 353 mage = #04scape :mage');
    f.client.receive(':irc.libera.chat 366 mage #04scape :End');
    f.client.closed('reset', true);
    assert.equal(f.channel('#04scape').topic?.text, 'Hello');
    assert.equal(f.channel('#04scape').modes, '+nt');
    assert.deepEqual(f.channel('#04scape').users, []);
});

// ── kicks ─────────────────────────────────────────────────────────────────

test('someone else kicked leaves the list, with who and why said in the room', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 353 mage = #04scape :@op mage bob');
    f.client.receive(':irc.libera.chat 366 mage #04scape :End');
    f.client.receive(':op!o@h KICK #04scape bob :spamming');
    assert.deepEqual(f.who('#04scape'), ['@op', 'mage']);
    assert.equal(f.lines().at(-1)?.text, 'bob was kicked by op (spamming)');
});

test('kicked ourselves, the tab stays to say why, empty, and a reconnect does not rejoin it', () => {
    const f = online({ channels: ['#04scape', '#swiftkit'] });
    f.client.receive(':irc.libera.chat 353 mage = #swiftkit :@op mage');
    f.client.receive(':irc.libera.chat 366 mage #swiftkit :End');
    f.client.receive(':op!o@h KICK #swiftkit mage :bye');

    assert.deepEqual(f.channel('#swiftkit').users, []);
    assert.equal(f.channel('#swiftkit').highlights, 1, 'being kicked is worth a badge');
    f.client.select('#swiftkit');
    assert.equal(f.lines().at(-1)?.text, 'you were kicked by op (bye)');
    assert.deepEqual(f.client.wanted(), ['#04scape']);

    f.client.closed('', true);
    f.client.connecting();
    f.client.opened();
    f.sent.length = 0;
    f.client.receive(':irc.libera.chat 001 mage :Welcome');
    assert.deepEqual(f.sent, ['JOIN #04scape']);
});

test('closing the tab of a channel we were kicked from forgets it without a PART the server would refuse', () => {
    const f = online({ channels: ['#04scape', '#swiftkit'] });
    f.client.receive(':op!o@h KICK #swiftkit mage :bye');
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
        ':irc.swiftirc.net 001 mage :Welcome to the SwiftIRC IRC Network mage!m@host',
        ':irc.swiftirc.net 002 mage :Your host is irc.swiftirc.net',
        ':irc.swiftirc.net 004 mage irc.swiftirc.net InspIRCd-3 iosw biklmnopstv',
        ':irc.swiftirc.net 005 mage AWAYLEN=200 PREFIX=(qaohv)~&@%+ :are supported by this server',
        ':irc.swiftirc.net 251 mage :There are 120 users and 3000 invisible on 9 servers',
        ':irc.swiftirc.net 375 mage :irc.swiftirc.net message of the day',
        ':irc.swiftirc.net 372 mage :- Happy chatting!',
        ':irc.swiftirc.net 376 mage :End of message of the day.'
    ]) {
        f.client.receive(line);
    }
    assert.equal(f.channel(SERVER_LOG).unread, 0);
    f.client.select(SERVER_LOG);
    assert.deepEqual(
        f.lines().map(l => l.text),
        [
            'Welcome to the SwiftIRC IRC Network mage!m@host',
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
    assert.equal(f.client.snapshot().nick, 'mage');
    assert.deepEqual(f.sent, []);
});

test('quit says goodbye only to a server that is listening, with the reason given or the kit\'s own', () => {
    const offline = fake();
    offline.client.quit();
    offline.client.input('/quit bye');
    assert.deepEqual(offline.sent, []);

    const f = online();
    f.client.quit();
    f.client.quit('gone fishing');
    f.client.input('/quit bye');
    assert.deepEqual(f.sent, ['QUIT :Zanaris Kit', 'QUIT :gone fishing', 'QUIT bye']);
});

// ── what the review found ─────────────────────────────────────────────────

test('a registration that settled on an underscore still identifies the account, not the nick it holds', () => {
    const f = fake({ password: 'hunter2' });
    f.client.connecting();
    f.client.opened();
    f.client.receive(':irc.swiftirc.net 433 * mage :Nickname is already in use.');
    f.sent.length = 0;
    f.client.receive(':irc.swiftirc.net 001 mage_ :Welcome');
    assert.equal(f.sent[0], 'PRIVMSG NickServ :IDENTIFY mage hunter2');
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
    f.client.receive(':irc.swiftirc.net 001 mage :Welcome');
    f.sent.length = 0;
    f.client.receive(':irc.swiftirc.net CAP mage ACK :multi-prefix');
    assert.deepEqual(f.sent, [], 'registration is already over');
});

test('closing a channel the server put us in, unasked, still parts it', () => {
    const f = online();
    f.client.receive(':mage!m@h JOIN #redirected');
    f.sent.length = 0;
    f.client.part('#redirected');
    assert.deepEqual(f.sent, ['PART #redirected']);
});

test('rejoining a channel we were kicked from makes its close a real PART again', () => {
    const f = online({ channels: ['#04scape', '#swiftkit'] });
    f.client.receive(':op!o@h KICK #swiftkit mage :bye');
    f.client.input('/join #swiftkit');
    f.client.receive(':mage!m@h JOIN #swiftkit');
    f.sent.length = 0;
    f.client.part('#swiftkit');
    assert.deepEqual(f.sent, ['PART #swiftkit']);
});

test('a typed IDENTIFY to NickServ is sent whole but echoed without the password', () => {
    const f = online();
    f.client.input('/msg NickServ IDENTIFY mage hunter2');
    f.client.input('/msg nickserv register hunter2 me@example.com');
    f.client.input('/msg NickServ SET PASSWORD hunter3');
    f.client.input('/msg NickServ HELP');
    assert.deepEqual(f.sent, ['PRIVMSG NickServ :IDENTIFY mage hunter2', 'PRIVMSG nickserv :register hunter2 me@example.com', 'PRIVMSG NickServ :SET PASSWORD hunter3', 'PRIVMSG NickServ HELP']);
    f.client.select(SERVER_LOG);
    const echoed = f.lines().slice(1).map(l => l.text);
    assert.deepEqual(echoed, ['IDENTIFY (hidden)', 'register (hidden)', 'SET PASSWORD (hidden)', 'HELP']);
});

test('an invite badges Status, since it is addressed to you', () => {
    const f = online();
    f.client.receive(':bob!b@h INVITE mage #secret');
    assert.equal(f.channel(SERVER_LOG).unread, 1);
});

// ── private conversations ─────────────────────────────────────────────────

test('/query opens a conversation and shows it, and lines typed there go to that person', () => {
    const f = online();
    f.client.input('/query bob');
    assert.equal(f.client.snapshot().active, 'bob');
    assert.deepEqual(f.sent, [], 'a conversation is ours alone until something is said');

    f.client.input('hello bob');
    f.client.input('/me waves');
    assert.deepEqual(f.sent, ['PRIVMSG bob :hello bob', `PRIVMSG bob :${CTCP}ACTION waves${CTCP}`]);
    assert.deepEqual(
        f.lines().map(l => [l.kind, l.nick, l.text]),
        [
            ['say', 'mage', 'hello bob'],
            ['action', 'mage', 'waves']
        ]
    );
});

test('/query with text says it at once; a name that is no nick opens nothing', () => {
    const f = online();
    f.client.input('/query bob are you there?');
    assert.deepEqual(f.sent, ['PRIVMSG bob :are you there?']);
    f.client.input('/query bob,alice');
    assert.equal(f.client.snapshot().channels.some(c => c.name === 'bob,alice'), false);
    assert.match(f.lines().at(-1)?.text ?? '', /not a nick/);
});

test('a /msg to someone with a conversation open is echoed there; to NickServ it stays in Status and hides the password', () => {
    const f = online();
    f.client.input('/query bob');
    f.client.input('/msg bob from afar');
    assert.equal(f.lines().at(-1)?.text, 'from afar');
    f.client.input('/msg NickServ IDENTIFY mage hunter2');
    assert.equal(f.client.snapshot().channels.some(c => c.name === 'NickServ'), false, 'services get no tab of their own');
    f.client.select(SERVER_LOG);
    assert.equal(f.lines().at(-1)?.text, 'IDENTIFY (hidden)');
});

test('a password typed into a conversation with NickServ is not written into it', () => {
    const f = online();
    f.client.input('/query NickServ');
    f.client.input('identify mage hunter2');
    assert.deepEqual(f.sent, ['PRIVMSG NickServ :identify mage hunter2']);
    assert.equal(f.lines().at(-1)?.text, 'identify (hidden)');
});

test('a notice goes to the conversation with its sender when one is open, and never opens one', () => {
    const f = online();
    f.client.receive(':NickServ!s@services. NOTICE mage :You are now identified.');
    assert.equal(f.client.snapshot().channels.some(c => c.name === 'NickServ'), false);
    f.client.input('/query bob');
    f.client.receive(':bob!b@h NOTICE mage :psst');
    assert.equal(f.lines().at(-1)?.text, '-bob- psst');
});

test('a conversation follows its person to a new name, in the same place in the row', () => {
    const f = online();
    f.client.receive(':bob!b@h PRIVMSG mage :hi');
    f.client.receive(':alice!a@h PRIVMSG mage :hey');
    f.client.select('bob');
    f.client.receive(':bob!b@h NICK :robert');
    assert.deepEqual(
        f.client.snapshot().channels.map(c => c.name),
        [SERVER_LOG, '#04scape', 'robert', 'alice']
    );
    assert.equal(f.client.snapshot().active, 'robert');
    assert.deepEqual(
        f.lines().map(l => l.text),
        ['hi', 'bob is now known as robert']
    );
    f.client.input('still there?');
    assert.equal(f.sent.at(-1), 'PRIVMSG robert :still there?');
});

test('someone quitting says so in the conversation with them', () => {
    const f = online();
    f.client.input('/query bob');
    f.client.receive(':bob!b@h QUIT :bye');
    assert.equal(f.lines().at(-1)?.text, 'bob quit (bye)');
});

test('/close ends a conversation and parts a channel; Status stays', () => {
    const f = online();
    f.client.input('/query bob');
    f.client.input('/close');
    assert.equal(f.client.snapshot().channels.some(c => c.name === 'bob'), false);
    assert.deepEqual(f.sent, [], 'the server never knew the conversation was open');

    f.client.select('#04scape');
    f.client.input('/close');
    assert.deepEqual(f.sent, ['PART #04scape']);

    f.client.input('/close');
    assert.match(f.lines().at(-1)?.text ?? '', /Status cannot be closed/);
});

test('a typed /join shows the channel it joins', () => {
    const f = online();
    f.client.input('/join #LostHQ');
    assert.equal(f.client.snapshot().active, '#LostHQ');
});

// ── ignoring ──────────────────────────────────────────────────────────────

test('an ignored nick\'s messages, notices, actions and invites are dropped, whatever the case', () => {
    const f = online({ ignore: ['Spammer'] });
    f.client.receive(':spammer!s@h PRIVMSG #04scape :buy gold');
    f.client.receive(`:spammer!s@h PRIVMSG #04scape :${CTCP}ACTION buys gold${CTCP}`);
    f.client.receive(':spammer!s@h PRIVMSG mage :psst');
    f.client.receive(':spammer!s@h NOTICE mage :psst');
    f.client.receive(':spammer!s@h INVITE mage #gold');
    assert.deepEqual(f.lines(), []);
    assert.equal(f.client.snapshot().channels.some(c => c.name === 'spammer'), false);
    f.client.select(SERVER_LOG);
    assert.deepEqual(
        f.lines().map(l => l.text),
        ['Welcome to Libera.Chat, mage']
    );
});

test('/ignore and /unignore change the list and report it; /ignore alone lists it', () => {
    const changes: string[][] = [];
    const f = online({ onIgnoreChanged: list => changes.push(list) });
    f.client.input('/ignore');
    assert.equal(f.lines().at(-1)?.text, 'you are not ignoring anyone');
    f.client.input('/ignore bob');
    f.client.input('/ignore BOB');
    assert.match(f.lines().at(-1)?.text ?? '', /already ignoring/);
    f.client.receive(':bob!b@h PRIVMSG #04scape :hi');
    assert.equal(f.lines().some(l => l.text === 'hi'), false);
    f.client.input('/unignore Bob');
    f.client.receive(':bob!b@h PRIVMSG #04scape :hi again');
    assert.equal(f.lines().at(-1)?.text, 'hi again');
    assert.deepEqual(changes, [['bob'], []]);
    assert.deepEqual(f.sent, [], 'ignoring is ours, not the server\'s');
});

// ── the commands the kit reads ────────────────────────────────────────────

test('/topic with text sets the active channel\'s; alone it shows what the join said', () => {
    const f = online();
    f.client.select('#04scape');
    f.client.input('/topic');
    assert.equal(f.lines().at(-1)?.text, '#04scape has no topic');
    f.client.receive(':irc 332 mage #04scape :Welcome to 2004scape');
    f.client.receive(':irc 333 mage #04scape alice!a@h 1700000000');
    f.client.input('/topic');
    assert.equal(f.lines().at(-1)?.text, 'topic of #04scape: Welcome to 2004scape (set by alice)');
    f.client.input('/topic A new topic');
    assert.deepEqual(f.sent, ['TOPIC #04scape :A new topic']);
});

test('/kick, /invite and /op take the channel you are looking at', () => {
    const f = online();
    f.client.select('#04scape');
    f.client.input('/kick bob spamming links');
    f.client.input('/invite alice');
    f.client.input('/op a b c d');
    f.client.input('/devoice e');
    assert.deepEqual(f.sent, ['KICK #04scape bob :spamming links', 'INVITE alice #04scape', 'MODE #04scape +ooo a b c', 'MODE #04scape +o d', 'MODE #04scape -v e']);
});

test('channel commands in Status say there is no channel rather than sending', () => {
    const f = online();
    f.client.select(SERVER_LOG);
    f.client.input('/kick bob');
    f.client.input('/op bob');
    assert.deepEqual(f.sent, []);
    assert.match(f.lines().at(-1)?.text ?? '', /no channel/);
});

test('/away with a reason marks you away, and alone marks you back', () => {
    const f = online();
    f.client.input('/away gone fishing');
    f.client.input('/away');
    assert.deepEqual(f.sent, ['AWAY :gone fishing', 'AWAY']);
});

test('/clear empties the tab here only, and /help lists the commands', () => {
    const f = online();
    f.client.receive(':bob!b@h PRIVMSG #04scape :hi');
    f.client.input('/clear');
    assert.deepEqual(f.lines(), []);
    f.client.input('/help');
    const help = f.lines().map(l => l.text);
    for (const command of COMMAND_HELP) assert.ok(help.some(t => t.startsWith(`/${command.name} `)), `/help names /${command.name}`);
    assert.deepEqual(f.sent, []);
});

test('a whois answer is read into sentences in the tab it was asked from', () => {
    const f = online();
    f.clock.now = 1_700_010_000_000;
    f.client.select('#04scape');
    f.client.input('/whois bob');
    assert.deepEqual(f.sent, ['WHOIS bob']);
    f.client.receive(':irc 311 mage bob ~b host.example * :Bob Smith');
    f.client.receive(':irc 319 mage bob :@#04scape #LostHQ');
    f.client.receive(':irc 312 mage bob fiery.swiftirc.net :SwiftIRC');
    f.client.receive(':irc 301 mage bob :lunch');
    f.client.receive(':irc 330 mage bob bobacct :is logged in as');
    f.client.receive(':irc 317 mage bob 190 1700000000 :seconds idle, signon time');
    f.client.receive(':irc 378 mage bob :is connecting from *@1.2.3.4');
    f.client.receive(':irc 318 mage bob :End of /WHOIS list.');
    assert.deepEqual(
        f.lines().map(l => l.text),
        [
            'bob is ~b@host.example (Bob Smith)',
            'bob is in @#04scape #LostHQ',
            'bob is connected to fiery.swiftirc.net',
            'bob is away: lunch',
            'bob is logged in as bobacct',
            'bob has been idle 3m 10s, signed on 2h 46m ago',
            'bob is connecting from *@1.2.3.4'
        ]
    );
    f.client.receive(':irc 378 mage bob :is connecting from *@1.2.3.4');
    assert.equal(f.lines().length, 7, 'once the whois is over, the next reply is Status\'s');
});

test('someone not online says so where you were talking to them', () => {
    const f = online();
    f.client.input('/query ghost');
    f.client.input('boo');
    f.client.receive(':irc 401 mage ghost :No such nick/channel');
    assert.equal(f.lines().at(-1)?.text, 'ghost is not online');
});

test('a full, registered-only or overfull join is refused in words', () => {
    const f = online();
    f.client.receive(':irc 471 mage #full :Cannot join channel (+l)');
    f.client.receive(':irc 477 mage #regonly :Cannot join channel (+R)');
    f.client.receive(':irc 405 mage #more :You have joined too many channels');
    f.client.select(SERVER_LOG);
    assert.deepEqual(
        f.lines().slice(1).map(l => l.text),
        ['cannot join #full: the channel is full', 'cannot join #regonly: you need to be identified with NickServ', 'cannot join #more: you are in too many channels']
    );
});

test('not being an operator is said in the channel it happened in', () => {
    const f = online();
    f.client.receive(':irc 482 mage #04scape :You\'re not channel operator');
    assert.equal(f.lines().at(-1)?.text, 'you are not an operator in #04scape');
});

// ── highlights ────────────────────────────────────────────────────────────

test('each line that names you or is said to you alone is reported as it arrives, and nothing else', () => {
    const seen: string[] = [];
    const f = online({ onHighlight: line => seen.push(`${line.channel} ${line.nick} ${line.text}`) });
    f.client.receive(':bob!b@h PRIVMSG #04scape :hey mage, look');
    f.client.receive(':bob!b@h PRIVMSG #04scape :nothing to see');
    f.client.receive(':bob!b@h PRIVMSG mage :psst');
    assert.deepEqual(seen, ['#04scape bob hey mage, look', 'bob bob psst']);
});

// ── bans ──────────────────────────────────────────────────────────────────
//
// A ban answered with a reconnect is a ban answered every thirty seconds for
// as long as the kit is open. The lines here are the ones InspIRCd (which
// SwiftIRC runs) and UnrealIRCd send.

test('a G-line\'s ERROR ends the attempt, with the operator\'s reason in words and the ERROR itself in Status', () => {
    const f = online();
    f.client.receive('ERROR :Closing link: (~mage@203.0.113.9) [G-lined: Spamming links in #2004scape]');
    assert.equal(
        f.client.turnedAway(),
        "The chat server has banned you: Spamming links in #2004scape. Chat won't reconnect on its own — Status has the server's full message."
    );
    f.client.closed('the chat server closed the connection', false);
    assert.equal(f.client.snapshot().error, f.client.turnedAway(), 'the ban outlasts the close it caused');
    f.client.select(SERVER_LOG);
    assert.ok(f.lines().some(l => l.text === 'Closing link: (~mage@203.0.113.9) [G-lined: Spamming links in #2004scape]'));
});

test('a 465 ends the attempt on its own, and the ERROR after it gives the reason when it has one', () => {
    const f = fake();
    f.client.connecting();
    f.client.opened();
    f.client.receive(':irc.swiftirc.net 465 * :You are banned from this network. Email abuse@example.net for help.');
    assert.match(f.client.turnedAway() ?? '', /banned you: You are banned from this network\. Email abuse@example\.net for help\. Chat won't/);

    f.client.receive('ERROR :Closing link: (~mage@203.0.113.9) [K-lined: Ban evasion]');
    assert.match(f.client.turnedAway() ?? '', /banned you: Ban evasion\. /);

    const hidden = fake();
    hidden.client.connecting();
    hidden.client.opened();
    hidden.client.receive(':irc.swiftirc.net 465 * :You are banned from this network.');
    hidden.client.receive('ERROR :Closing link: (~mage@203.0.113.9) [K-lined]');
    assert.match(hidden.client.turnedAway() ?? '', /banned you: You are banned from this network\./, 'a hidden reason does not blank the 465\'s');
});

test('a ban with its reason hidden still says it is a ban', () => {
    const f = online();
    f.client.receive('ERROR :Closing link: (~mage@203.0.113.9) [Z-lined]');
    assert.equal(f.client.turnedAway(), "The chat server has banned you. Chat won't reconnect on its own — Status has the server's full message.");
});

test('an ERROR that is not a ban only goes to Status: a timeout, a flood, a throttle, a kill, the answer to QUIT', () => {
    for (const text of [
        'Closing link: (~mage@203.0.113.9) [Ping timeout: 240 seconds]',
        'Closing link: (~mage@203.0.113.9) [Excess Flood]',
        'Closing Link: [203.0.113.9] (Throttled: Reconnecting too fast - Email abuse@example.net for more information.)',
        'Closing link: (~mage@203.0.113.9) [No more connections allowed from your host via this connect class (local)]',
        'Closing Link: mage[203.0.113.9] (Too many connections from your IP)',
        'Closing link: (~mage@203.0.113.9) [Z-lined: Throttled]',
        'Closing link: (~mage@203.0.113.9) [Killed (Oper (you will be banned from here next time))]',
        'Closing link: (~mage@203.0.113.9) [Quit: Zanaris Kit]'
    ]) {
        const f = online();
        f.client.receive(`ERROR :${text}`);
        assert.equal(f.client.turnedAway(), null, text);
        f.client.select(SERVER_LOG);
        assert.equal(f.lines().at(-1)?.text, text);
    }
});

// ── too many conversations ────────────────────────────────────────────────

test('past the cap, someone new lands in Status, said once, and closing a conversation makes room', () => {
    const seen: string[] = [];
    const f = online({ onHighlight: line => seen.push(line.nick ?? '') });
    for (let n = 0; n < MAX_CONVERSATIONS; n++) f.client.receive(`:spam${n}!s@h PRIVMSG mage :hi`);
    const conversations = (): string[] => f.client.snapshot().channels.map(c => c.name).filter(name => name !== SERVER_LOG && !name.startsWith('#'));
    assert.equal(conversations().length, MAX_CONVERSATIONS);

    f.client.receive(':latecomer!l@h PRIVMSG mage :hello?');
    f.client.receive(':another!a@h PRIVMSG mage :me too');
    assert.equal(conversations().length, MAX_CONVERSATIONS, 'no tab past the cap');
    f.client.select(SERVER_LOG);
    const status = f.lines().slice(1);
    assert.deepEqual(
        status.map(l => [l.kind, l.nick, l.text]),
        [
            ['system', null, `${MAX_CONVERSATIONS} conversations are open, so messages from anyone new land here until you close one`],
            ['private', 'latecomer', 'hello?'],
            ['private', 'another', 'me too']
        ],
        'said once, and each message still arrives, marked private'
    );
    assert.ok(seen.includes('latecomer'), 'still a highlight');

    f.client.receive(':spam0!s@h PRIVMSG mage :still here');
    assert.equal(f.channel('spam0').unread, 2, 'someone with a conversation open still reaches it');

    f.client.close('spam0');
    f.client.receive(':latecomer!l@h PRIVMSG mage :now?');
    assert.ok(conversations().includes('latecomer'), 'a free slot opens a tab again');
    f.client.receive(':third!t@h PRIVMSG mage :and me');
    f.client.select(SERVER_LOG);
    assert.equal(f.lines().filter(l => l.kind === 'system' && /conversations are open/.test(l.text)).length, 2, 'running out again is news again');
});

test('a /query past the cap still opens: the cap is on strangers, not on you', () => {
    const f = online();
    for (let n = 0; n < MAX_CONVERSATIONS; n++) f.client.receive(`:spam${n}!s@h PRIVMSG mage :hi`);
    f.client.input('/query friend');
    assert.equal(f.client.snapshot().active, 'friend');
});

// ── the line limit ────────────────────────────────────────────────────────

test('a message is measured in bytes as the others receive it, and one too long is refused, not cut', () => {
    const f = online();
    f.client.input('a'.repeat(400));
    assert.equal(f.sent.length, 1, 'the box\'s 400 characters fit, in plain letters');

    f.sent.length = 0;
    f.client.input('é'.repeat(250));
    assert.deepEqual(f.sent, [], '250 characters, but 500 bytes: the server would cut it');
    assert.equal(f.lines().at(-1)?.kind, 'system');
    assert.match(f.lines().at(-1)?.text ?? '', /too long/);
    assert.equal(f.lines().filter(l => l.nick === 'mage').length, 1, 'no echo of what was never sent, only of the 400 letters');

    f.client.input('😀'.repeat(110));
    assert.deepEqual(f.sent, [], '220 UTF-16 units under the box\'s cap, but 440 bytes');

    f.client.input('é'.repeat(200));
    assert.equal(f.sent.length, 1, '400 bytes fit');
});

test('the budget counts the command, the target and the prefix the server adds', () => {
    const f = online();
    const room = `#${'r'.repeat(49)}`;
    f.client.join(room);
    f.client.select(room);
    f.sent.length = 0;
    // ":mage!~uuuuuuuuuu@<64 bytes> PRIVMSG #rrr… :", CRLF after: 512 - 83 - 60 - 2 leaves 367 bytes.
    f.client.input(`${'a'.repeat(365)} b`);
    assert.equal(f.sent.length, 1);
    f.client.input(`${'a'.repeat(366)} b`);
    assert.equal(f.sent.length, 1, 'one byte over is refused');

    f.sent.length = 0;
    f.client.input(`/msg bob ${'é'.repeat(250)}`);
    f.client.input(`/notice bob ${'é'.repeat(250)}`);
    f.client.input(`/me ${'é'.repeat(250)}`);
    assert.deepEqual(f.sent, [], '/msg, /notice and /me are measured too');
});
