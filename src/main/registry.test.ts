import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServerRegistry, type WindowFactory } from './registry.ts';
import type { ServerDef } from './servers.ts';

const SERVERS: ServerDef[] = [
    { id: 'a', name: 'Alpha', url: 'https://a.example/rs2.cgi' },
    { id: 'b', name: 'Beta', url: 'https://b.example/rs2.cgi' }
];

interface FakeWindow {
    server: ServerDef;
    focused: number;
    closed: boolean;
    /** Simulates the user closing the window. */
    userCloses(): void;
}

/** A window factory that records what main would have created, without Electron. */
function fakeWindows(): { created: FakeWindow[]; factory: WindowFactory } {
    const created: FakeWindow[] = [];
    const factory: WindowFactory = (server, onClosed) => {
        const entry: FakeWindow = {
            server,
            focused: 0,
            closed: false,
            userCloses: () => {
                entry.closed = true;
                onClosed();
            }
        };
        created.push(entry);
        return {
            focus: () => {
                entry.focused += 1;
            },
            close: () => entry.userCloses()
        };
    };
    return { created, factory };
}

test('lists the configured servers as closed before anything is opened', () => {
    const { factory } = fakeWindows();
    const registry = new ServerRegistry(SERVERS, factory);
    assert.deepEqual(
        registry.list().map(s => [s.id, s.name, s.url, s.open]),
        [
            ['a', 'Alpha', 'https://a.example/rs2.cgi', false],
            ['b', 'Beta', 'https://b.example/rs2.cgi', false]
        ]
    );
});

test('opening a server creates exactly one window and reports it open', () => {
    const { created, factory } = fakeWindows();
    const registry = new ServerRegistry(SERVERS, factory);

    assert.equal(registry.open('a'), 'opened');

    assert.equal(created.length, 1);
    assert.equal(created[0]!.server.id, 'a');
    assert.deepEqual(
        registry.list().map(s => s.open),
        [true, false]
    );
});

test('opening a server that is already open focuses it instead of creating another', () => {
    const { created, factory } = fakeWindows();
    const registry = new ServerRegistry(SERVERS, factory);
    registry.open('a');

    assert.equal(registry.open('a'), 'focused');

    assert.equal(created.length, 1, 'no second window');
    assert.equal(created[0]!.focused, 1);
});

test('two different servers can be open at the same time', () => {
    const { created, factory } = fakeWindows();
    const registry = new ServerRegistry(SERVERS, factory);

    registry.open('a');
    registry.open('b');

    assert.deepEqual(
        created.map(w => w.server.id),
        ['a', 'b']
    );
    assert.deepEqual(
        registry.list().map(s => s.open),
        [true, true]
    );
});

test('when the user closes a window the server reads closed and can be reopened', () => {
    const { created, factory } = fakeWindows();
    const registry = new ServerRegistry(SERVERS, factory);
    registry.open('a');

    created[0]!.userCloses();
    assert.equal(registry.list()[0]!.open, false);

    assert.equal(registry.open('a'), 'opened');
    assert.equal(created.length, 2, 'a fresh window after the old one closed');
});

test('opening an unknown id creates nothing', () => {
    const { created, factory } = fakeWindows();
    const registry = new ServerRegistry(SERVERS, factory);

    assert.equal(registry.open('nope'), 'unknown');
    assert.equal(created.length, 0);
});

test('openUrl adds a custom server to the list and opens it', () => {
    const { created, factory } = fakeWindows();
    const registry = new ServerRegistry(SERVERS, factory);

    const r = registry.openUrl('https://c.example/rs2.cgi?lowmem=1');

    assert.ok(r.ok);
    assert.equal(created.length, 1);
    assert.equal(created[0]!.server.url, 'https://c.example/rs2.cgi?lowmem=1');
    const listed = registry.list().find(s => s.id === r.id);
    assert.ok(listed, 'the custom server is listed');
    assert.equal(listed.open, true);
    assert.equal(registry.list().length, 3);
});

test('openUrl with the same url twice focuses the existing window', () => {
    const { created, factory } = fakeWindows();
    const registry = new ServerRegistry(SERVERS, factory);
    registry.openUrl('c.example/rs2.cgi');

    const r = registry.openUrl('https://c.example/rs2.cgi');

    assert.ok(r.ok);
    assert.equal(created.length, 1, 'no duplicate window');
    assert.equal(created[0]!.focused, 1);
    assert.equal(registry.list().length, 3, 'no duplicate entry');
});

test('openUrl rejects a bad url and adds nothing', () => {
    const { created, factory } = fakeWindows();
    const registry = new ServerRegistry(SERVERS, factory);

    const r = registry.openUrl('javascript:alert(1)');

    assert.equal(r.ok, false);
    assert.equal(created.length, 0);
    assert.equal(registry.list().length, 2);
});

test('closeAll closes every open window', () => {
    const { created, factory } = fakeWindows();
    const registry = new ServerRegistry(SERVERS, factory);
    registry.open('a');
    registry.open('b');

    registry.closeAll();

    assert.deepEqual(
        created.map(w => w.closed),
        [true, true]
    );
    assert.deepEqual(
        registry.list().map(s => s.open),
        [false, false]
    );
});

test('onChange fires when a window opens and when it closes', () => {
    const { created, factory } = fakeWindows();
    let changes = 0;
    const registry = new ServerRegistry(SERVERS, factory, () => {
        changes += 1;
    });

    registry.open('a');
    assert.equal(changes, 1);

    registry.open('a'); // focus only — nothing changed
    assert.equal(changes, 1);

    created[0]!.userCloses();
    assert.equal(changes, 2);
});
