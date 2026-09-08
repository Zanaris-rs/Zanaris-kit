import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatChanges, persistedRooms, type PersistedChat } from './chatPersist.ts';
import { LOBBY, SERVER_LOG, type ChatView, type ViewChannel } from '../shared/chat.ts';

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

test('the hand-joined rooms are the closable ones', () => {
    const channels = [chan(SERVER_LOG), chan(LOBBY), chan('#lostcity'), chan('#somewhere', true)];
    assert.deepEqual(persistedRooms(view({ channels })), ['#somewhere']);
});

test('a view that matches the profile is not worth a write', () => {
    assert.equal(chatChanges(stored(), view()), null);
});

test('the confirmed nick is written when it differs', () => {
    assert.deepEqual(chatChanges(stored(), view({ nick: 'matt_' })), { nick: 'matt_' });
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

test('a stored room that differs only in case is the same room', () => {
    const channels = [chan(SERVER_LOG), chan(LOBBY), chan('#SomeWhere', true)];
    assert.equal(chatChanges(stored({ rooms: ['#somewhere'] }), view({ channels })), null);
});

test('the same rooms in a different order are not a change', () => {
    const channels = [chan(SERVER_LOG), chan(LOBBY), chan('#b', true), chan('#a', true)];
    assert.equal(chatChanges(stored({ rooms: ['#a', '#b'] }), view({ channels })), null);
});

test('both fields change at once', () => {
    const channels = [chan(SERVER_LOG), chan(LOBBY), chan('#somewhere', true)];
    assert.deepEqual(chatChanges(stored(), view({ nick: 'dave', channels })), { nick: 'dave', rooms: ['#somewhere'] });
});

test('a view of no connection never erases the stored rooms', () => {
    const offline: ChatView = { status: 'offline', nick: null, channels: [], active: SERVER_LOG, lines: [], error: null, needsNick: true };
    assert.equal(chatChanges(stored({ nick: 'matt', rooms: ['#somewhere'] }), offline), null);
});

test('a nick dropped on a live connection is written, since only a client with no nick reports one', () => {
    // Not reachable today — IrcClient only holds a null nick when it was built
    // with an empty one — but the rule is "the view is the truth", and a
    // special case for null would be a second rule with nothing asking for it.
    assert.deepEqual(chatChanges(stored(), view({ nick: null })), { nick: null });
});
