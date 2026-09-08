import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatChanges, persistedRooms, type PersistedChat } from './chatPersist.ts';
import { ChatService, type ChatIo, type SocketHandlers } from './chat/service.ts';
import { LOBBY, SERVER_LOG, type ChatSettings, type ChatStatus, type ChatView, type ViewChannel } from '../shared/chat.ts';

/** A channel as the service stamps it: closable only when the user joined it by hand. */
const chan = (name: string, closable = false): ViewChannel => ({ name, nicks: [], unread: 0, highlights: 0, closable });

/**
 * A view of a live connection. Every one of these carries the server-log tab,
 * because a real client always has one — the empty-channels case below is the
 * offline placeholder, and is the only view that legitimately has none.
 */
const view = (over: Partial<ChatView> = {}): ChatView => ({
    status: 'online',
    nick: 'matt',
    channels: [chan(SERVER_LOG), chan(LOBBY)],
    active: LOBBY,
    lines: [],
    error: null,
    needsNick: false,
    ...over
});

const stored = (over: Partial<PersistedChat> = {}): PersistedChat => ({ nick: 'matt', rooms: [], ...over });

// ── the rooms ─────────────────────────────────────────────────────────────

test('the hand-joined rooms are the closable ones', () => {
    const channels = [chan(SERVER_LOG), chan(LOBBY), chan('#lostcity'), chan('#somewhere', true)];
    assert.deepEqual(persistedRooms([], view({ channels })), ['#somewhere']);
});

test('a view that matches the profile is not worth a write', () => {
    assert.equal(chatChanges(stored(), view()), null);
});

test('a room joined by hand is written', () => {
    const channels = [chan(SERVER_LOG), chan(LOBBY), chan('#somewhere', true)];
    assert.deepEqual(chatChanges(stored(), view({ channels })), { rooms: ['#somewhere'] });
});

test('a room closed is written as its absence', () => {
    assert.deepEqual(chatChanges(stored({ rooms: ['#somewhere'] }), view()), { rooms: [] });
});

test('an auto-joined room is never written, however many there are', () => {
    const channels = [chan(SERVER_LOG), chan(LOBBY), chan('#lostcity')];
    assert.equal(chatChanges(stored(), view({ channels })), null);
});

test('a stored room the auto set has absorbed is kept, not dropped', () => {
    // Hand-joined with no Lost City window open, then a window opens: the room
    // is still joined and still the user's, only no longer theirs to close.
    const channels = [chan(SERVER_LOG), chan(LOBBY), chan('#lostcity')];
    assert.equal(chatChanges(stored({ rooms: ['#lostcity'] }), view({ channels })), null);
});

test('a stored room that left the channel list is dropped, whatever closed it', () => {
    const channels = [chan(SERVER_LOG), chan(LOBBY)];
    assert.deepEqual(chatChanges(stored({ rooms: ['#lostcity'] }), view({ channels })), { rooms: [] });
});

test('a stored room that differs only in case is the same room', () => {
    const channels = [chan(SERVER_LOG), chan(LOBBY), chan('#SomeWhere', true)];
    assert.equal(chatChanges(stored({ rooms: ['#somewhere'] }), view({ channels })), null);
});

test('the same rooms in a different order are not a change', () => {
    const channels = [chan(SERVER_LOG), chan(LOBBY), chan('#b', true), chan('#a', true)];
    assert.equal(chatChanges(stored({ rooms: ['#a', '#b'] }), view({ channels })), null);
});

test('a stored list naming one room twice cannot hide a new one', () => {
    const channels = [chan(SERVER_LOG), chan(LOBBY), chan('#a', true), chan('#b', true)];
    assert.deepEqual(chatChanges(stored({ rooms: ['#a', '#A'] }), view({ channels })), { rooms: ['#a', '#b'] });
});

// ── the nick ──────────────────────────────────────────────────────────────

test('a nick the connection came online with is written', () => {
    assert.deepEqual(chatChanges(stored(), view({ nick: 'matt_' })), { nick: 'matt_' });
});

test('a nick refused at registration never replaces the stored one', () => {
    const refused = view({ status: 'registering', nick: 'matt_' });
    assert.equal(chatChanges(stored(), refused), null, 'matt still works; matt_ is only what the client is claiming');
});

test('a refused nick cannot ride a reconnect into the profile', () => {
    // Where the underscore-per-launch drift used to come from: the cascade
    // leaves its claim in the view, and a dropped connection re-emits it.
    for (const status of ['connecting', 'reconnecting', 'offline'] as ChatStatus[]) {
        assert.equal(chatChanges(stored(), view({ status, nick: 'matt___' })), null, status);
    }
});

test('a first nick is written before the server has confirmed it', () => {
    // The prompt's own case: nothing is stored, so there is nothing to lose,
    // and a server that never answers must not cost the user their choice.
    assert.deepEqual(chatChanges(stored({ nick: null }), view({ status: 'connecting', nick: 'matt' })), { nick: 'matt' });
});

test('a first nick is written even when the connection failed outright', () => {
    const failed = view({ status: 'reconnecting', nick: 'matt', error: 'the connection closed' });
    assert.deepEqual(chatChanges(stored({ nick: null }), failed), { nick: 'matt' });
});

test('a stored nick is never erased by a view that has none', () => {
    assert.equal(chatChanges(stored(), view({ status: 'reconnecting', nick: null })), null);
});

test('both fields change at once', () => {
    const channels = [chan(SERVER_LOG), chan(LOBBY), chan('#somewhere', true)];
    assert.deepEqual(chatChanges(stored(), view({ nick: 'dave', channels })), { nick: 'dave', rooms: ['#somewhere'] });
});

test('a view of no connection never erases the stored rooms', () => {
    const offline: ChatView = { status: 'offline', nick: null, channels: [], active: SERVER_LOG, lines: [], error: null, needsNick: true };
    assert.equal(chatChanges(stored({ nick: 'matt', rooms: ['#somewhere'] }), offline), null);
});

// ── driven against the real client ────────────────────────────────────────
//
// Everything above is written against a ChatView built by hand, so it is only
// as good as the views IrcClient really produces. These drive the actual
// service over a fake socket and apply chatChanges exactly as index.ts does,
// counting the writes the profile would take. The profile is an object rather
// than a file: AppState is proven elsewhere, and what is under test here is
// how many times it would be asked to write.

const SETTINGS: ChatSettings = { nick: null, server: 'irc.example', port: 6697, dock: 'bottom', dockHeight: 200, rooms: [] };

interface Driven {
    service: ChatService;
    profile: PersistedChat;
    writes: () => number;
    /** The socket is up, so the client registers. */
    open: () => void;
    line: (text: string) => void;
    drop: () => void;
    /** Runs the pending reconnect timer. */
    retry: () => void;
}

function driven(over: Partial<ChatSettings> = {}): Driven {
    let handlers: SocketHandlers | null = null;
    let retry: (() => void) | null = null;
    const io: ChatIo = {
        connect: (_host, _port, h) => {
            handlers = h;
            return { send: () => {}, close: () => {} };
        },
        now: () => 1_700_000_000_000,
        setTimer: fn => {
            retry = fn;
            return () => {
                retry = null;
            };
        }
    };
    const settings: ChatSettings = { ...SETTINGS, ...over };
    const profile: PersistedChat = { nick: settings.nick, rooms: [...settings.rooms] };
    let writes = 0;
    const service = new ChatService(settings, io);
    // index.ts's subscriber, with the profile in memory rather than on disk.
    service.subscribe(v => {
        const patch = chatChanges(profile, v);
        if (patch === null) return;
        writes++;
        Object.assign(profile, patch);
    });
    return {
        service,
        profile,
        writes: () => writes,
        open: () => handlers?.opened(),
        line: text => handlers?.data(`${text}\r\n`),
        drop: () => handlers?.closed('the connection closed'),
        retry: () => retry?.()
    };
}

test('a nick refused over and over at registration never reaches the profile', () => {
    const d = driven({ nick: 'matt' });
    d.open();
    // The client answers each 433 by claiming the next underscore, and stops
    // claiming after three; none of those names is one the server allowed.
    for (const attempted of ['matt', 'matt_', 'matt__', 'matt___']) {
        d.line(`:irc.example 433 * ${attempted} :Nickname is already in use`);
    }
    assert.equal(d.writes(), 0);
    assert.equal(d.profile.nick, 'matt', 'the name the next launch registers with is still the one that might work');

    // And the claim must not reach the profile by outliving the connection.
    d.drop();
    d.retry();
    d.open();
    assert.equal(d.writes(), 0);
    assert.equal(d.profile.nick, 'matt');
});

test('the nick a refused registration finally settles on is written', () => {
    const d = driven({ nick: 'matt' });
    d.open();
    d.line(':irc.example 433 * matt :Nickname is already in use');
    d.line(':irc.example 001 matt_ :Welcome to the network, matt_');
    assert.equal(d.profile.nick, 'matt_', 'the server named us in the 001, so this one is real');
    assert.equal(d.writes(), 1);
});

test('a room joined by hand and then closed is exactly two writes', () => {
    const d = driven({ nick: 'matt' });
    d.open();
    d.line(':irc.example 001 matt :Welcome to the network, matt');
    const before = d.writes();

    d.service.send('/join #somewhere');
    assert.deepEqual(d.profile.rooms, ['#somewhere']);
    d.service.closeRoom('#somewhere');
    assert.deepEqual(d.profile.rooms, []);
    assert.equal(d.writes() - before, 2);
});

test('closing a room the user did not join writes nothing', () => {
    const d = driven({ nick: 'matt' });
    d.open();
    d.line(':irc.example 001 matt :Welcome to the network, matt');
    const before = d.writes();
    assert.equal(d.service.closeRoom(LOBBY), false);
    assert.equal(d.writes() - before, 0);
});

test('a conversation is never worth a write', () => {
    const d = driven({ nick: 'matt', rooms: ['#somewhere'] });
    d.open();
    d.line(':irc.example 001 matt :Welcome to the network, matt');
    d.line(':matt!m@h JOIN #somewhere');
    const before = d.writes();

    for (let i = 0; i < 200; i++) {
        d.line(`:bob!b@h PRIVMSG #somewhere :message ${i}`);
        d.line(`:carol!c@h PRIVMSG ${LOBBY} :matt: look at this ${i}`);
        d.line(':dave!d@h JOIN #somewhere');
        d.line(':dave!d@h PART #somewhere :bye');
        d.service.send(`something ${i}`);
        d.service.select(i % 2 === 0 ? '#somewhere' : LOBBY);
    }
    assert.equal(d.writes() - before, 0, '1200 lines, 200 sends and 200 selects');
});

test('a connection lost and remade is never worth a write', () => {
    const d = driven({ nick: 'matt', rooms: ['#somewhere'] });
    d.open();
    d.line(':irc.example 001 matt :Welcome to the network, matt');
    const before = d.writes();

    d.drop();
    d.retry();
    d.open();
    // The rejoin comes back in whatever case the server echoes it.
    d.line(':irc.example 001 matt :Welcome to the network, matt');
    d.line(':matt!m@h JOIN #SomeWhere');
    assert.equal(d.writes() - before, 0);
    assert.deepEqual(d.profile.rooms, ['#somewhere']);
});
