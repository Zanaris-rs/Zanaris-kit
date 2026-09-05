import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServerWindows, type ServerWindowFactory, type WindowSpec } from './windows.ts';
import { DEFAULT_SERVERS } from './catalog.ts';

const ZANARIS = DEFAULT_SERVERS[0]!;
const LOSTCITY = DEFAULT_SERVERS[1]!;

interface FakeWindow {
    spec: WindowSpec;
    focused: number;
    closed: boolean;
    userCloses(): void;
}

function fakeWindows(): { created: FakeWindow[]; factory: ServerWindowFactory } {
    const created: FakeWindow[] = [];
    const factory: ServerWindowFactory = (spec, onClosed) => {
        const entry: FakeWindow = {
            spec,
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

test('opening a server creates a window in slot 1 with the plain title and partition', () => {
    const { created, factory } = fakeWindows();
    const windows = new ServerWindows(factory);
    const opened = windows.open(ZANARIS);
    assert.equal(created.length, 1);
    assert.deepEqual(opened, { id: 1, serverId: 'zanaris-w1', slot: 1, title: 'Zanaris — World 1' });
    assert.equal(created[0]!.spec.partition, 'persist:server:zanaris-w1');
    assert.equal(created[0]!.spec.server, ZANARIS);
});

test('opening the same server again makes a second window in slot 2', () => {
    const { created, factory } = fakeWindows();
    const windows = new ServerWindows(factory);
    windows.open(ZANARIS);
    const second = windows.open(ZANARIS);
    assert.equal(created.length, 2, 'a new window, not a focus');
    assert.equal(second.slot, 2);
    assert.equal(second.title, 'Zanaris — World 1 (2)');
    assert.equal(created[1]!.spec.partition, 'persist:server:zanaris-w1:2');
    assert.equal(windows.countFor('zanaris-w1'), 2);
});

test('window ids are unique and increase', () => {
    const { factory } = fakeWindows();
    const windows = new ServerWindows(factory);
    const a = windows.open(ZANARIS);
    const b = windows.open(LOSTCITY);
    assert.notEqual(a.id, b.id);
    assert.ok(b.id > a.id);
    assert.deepEqual(
        windows.list().map(w => w.id),
        [a.id, b.id]
    );
});

test('closing frees the slot, and the next open reuses it', () => {
    const { created, factory } = fakeWindows();
    const windows = new ServerWindows(factory);
    windows.open(ZANARIS);
    windows.open(ZANARIS);
    created[0]!.userCloses();
    assert.equal(windows.countFor('zanaris-w1'), 1);
    assert.equal(windows.list().length, 1);
    const third = windows.open(ZANARIS);
    assert.equal(third.slot, 1, 'slot 1 came back');
    assert.equal(created[2]!.spec.partition, 'persist:server:zanaris-w1');
});

test('get returns the handle for an open window and nothing after it closes', () => {
    const { created, factory } = fakeWindows();
    const windows = new ServerWindows(factory);
    const opened = windows.open(ZANARIS);
    windows.get(opened.id)!.focus();
    assert.equal(created[0]!.focused, 1);
    created[0]!.userCloses();
    assert.equal(windows.get(opened.id), undefined);
});

test('closeAll closes every window', () => {
    const { created, factory } = fakeWindows();
    const windows = new ServerWindows(factory);
    windows.open(ZANARIS);
    windows.open(LOSTCITY);
    windows.closeAll();
    assert.deepEqual(
        created.map(w => w.closed),
        [true, true]
    );
    assert.equal(windows.list().length, 0);
});

test('onChange fires on open and on close, once each', () => {
    const { created, factory } = fakeWindows();
    let changes = 0;
    const windows = new ServerWindows(factory, () => {
        changes += 1;
    });
    windows.open(ZANARIS);
    assert.equal(changes, 1);
    created[0]!.userCloses();
    assert.equal(changes, 2);
    created[0]!.userCloses();
    assert.equal(changes, 2, 'a second closed event is ignored');
});
