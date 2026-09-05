import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TabModel, GAME_TAB_ID } from './tabs.ts';

const model = (): TabModel => new TabModel({ title: 'Zanaris — World 1', url: 'https://w1.04.zanaris.rs/rs2.cgi?lowmem=1' });

test('starts with the pinned game tab, active', () => {
    const tabs = model();
    assert.deepEqual(tabs.list(), [{ id: GAME_TAB_ID, kind: 'game', title: 'Zanaris — World 1', url: 'https://w1.04.zanaris.rs/rs2.cgi?lowmem=1' }]);
    assert.equal(tabs.active.id, GAME_TAB_ID);
});

test('opening a page appends it after the game tab and activates it', () => {
    const tabs = model();
    const page = tabs.open({ title: 'Clue scroll', url: 'https://2004.losthq.rs/clue' });
    assert.equal(page.kind, 'page');
    assert.deepEqual(
        tabs.list().map(t => t.id),
        [GAME_TAB_ID, page.id]
    );
    assert.equal(tabs.active.id, page.id);
});

test('page ids never repeat, even after a close', () => {
    const tabs = model();
    const a = tabs.open({ title: 'a', url: 'https://x.example/a' });
    tabs.close(a.id);
    const b = tabs.open({ title: 'b', url: 'https://x.example/b' });
    assert.notEqual(a.id, b.id);
});

test('activate switches tabs and rejects unknown ids', () => {
    const tabs = model();
    const page = tabs.open({ title: 'a', url: 'https://x.example/a' });
    assert.equal(tabs.activate(GAME_TAB_ID), true);
    assert.equal(tabs.active.id, GAME_TAB_ID);
    assert.equal(tabs.activate(page.id), true);
    assert.equal(tabs.activate('nope'), false);
    assert.equal(tabs.active.id, page.id);
});

test('closing the active tab activates its left neighbour', () => {
    const tabs = model();
    const a = tabs.open({ title: 'a', url: 'https://x.example/a' });
    const b = tabs.open({ title: 'b', url: 'https://x.example/b' });
    assert.equal(tabs.close(b.id), 'closed');
    assert.equal(tabs.active.id, a.id);
    assert.equal(tabs.close(a.id), 'closed');
    assert.equal(tabs.active.id, GAME_TAB_ID);
});

test('closing a background tab leaves the active one alone', () => {
    const tabs = model();
    const a = tabs.open({ title: 'a', url: 'https://x.example/a' });
    const b = tabs.open({ title: 'b', url: 'https://x.example/b' });
    tabs.close(a.id);
    assert.equal(tabs.active.id, b.id);
    assert.deepEqual(
        tabs.list().map(t => t.id),
        [GAME_TAB_ID, b.id]
    );
});

test('the game tab cannot be closed', () => {
    const tabs = model();
    assert.equal(tabs.close(GAME_TAB_ID), 'pinned');
    assert.equal(tabs.list().length, 1);
    assert.equal(tabs.close('nope'), 'unknown');
});

test('setTitle renames a tab', () => {
    const tabs = model();
    const page = tabs.open({ title: 'Loading', url: 'https://x.example/a' });
    assert.equal(tabs.setTitle(page.id, 'Clue scroll'), true);
    assert.equal(tabs.list()[1]!.title, 'Clue scroll');
    assert.equal(tabs.setTitle('nope', 'x'), false);
});

test('setUrl updates a tab so a world switch does not leave it stale', () => {
    const tabs = model();
    assert.equal(tabs.setUrl(GAME_TAB_ID, 'https://w7-2004.lostcity.rs/rs2.cgi?world=7'), true);
    assert.equal(tabs.list()[0]!.url, 'https://w7-2004.lostcity.rs/rs2.cgi?world=7');
    assert.equal(tabs.setUrl('nope', 'https://x'), false);
});

test('list returns copies', () => {
    const tabs = model();
    tabs.list()[0]!.title = 'changed';
    assert.equal(tabs.list()[0]!.title, 'Zanaris — World 1');
});
