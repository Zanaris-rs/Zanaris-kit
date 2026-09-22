import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRemovable, readNewServerInput, serversView, startupServers } from './servers.ts';
import { DEFAULT_SERVERS } from './catalog.ts';
import type { ServerDef } from '../shared/catalog.ts';

const catalog = DEFAULT_SERVERS.map(s => ({ ...s }) as ServerDef);
const ids = (list: readonly ServerDef[]): string[] => list.map(s => s.id);

test('an empty startup list opens the first catalog entry, as a launch always has', () => {
    assert.deepEqual(ids(startupServers([], catalog)), ['lostcity']);
});

test('ids the catalog no longer holds are dropped, and what is left still opens', () => {
    assert.deepEqual(ids(startupServers(['zanaris', 'gone'], catalog)), ['zanaris']);
});

test('a list of only stale ids falls back rather than opening no windows at all', () => {
    assert.deepEqual(ids(startupServers(['gone', 'also-gone'], catalog)), ['lostcity']);
});

test('the set is de-duplicated and ordered by the catalog, not by the stored list', () => {
    assert.deepEqual(ids(startupServers(['zanaris', 'lostcity', 'zanaris'], catalog)), ['lostcity', 'zanaris']);
});

test('an empty catalog opens nothing rather than throwing', () => {
    assert.deepEqual(startupServers(['lostcity'], []), []);
});

test('built-ins are not removable, because load never puts one back', () => {
    assert.equal(isRemovable('lostcity'), false);
    assert.equal(isRemovable('singleplayer'), false);
    assert.equal(isRemovable('my-server'), true);
});

test('a row carries what Settings draws, and marks the ones a launch opens', () => {
    const view = serversView({ catalog, startup: ['zanaris'], openCounts: new Map([['lostcity', 2]]) });
    const lostcity = view.rows.find(r => r.id === 'lostcity')!;
    const zanaris = view.rows.find(r => r.id === 'zanaris')!;
    assert.equal(lostcity.open, 2);
    assert.equal(lostcity.atStartup, false);
    assert.equal(lostcity.removable, false);
    assert.equal(zanaris.atStartup, true);
    assert.equal(view.rows.length, catalog.length, 'every catalog entry gets a row, gated or not');
});

test('readNewServerInput refuses anything that is not the five fields', () => {
    assert.equal(readNewServerInput(null), null);
    assert.equal(readNewServerInput({ name: 'X' }), null);
    assert.equal(readNewServerInput({ name: 'X', url: 'x.test', revision: '274', wikiHome: null, notes: null }), null);
    assert.deepEqual(readNewServerInput({ name: 'X', url: 'x.test', revision: 274, wikiHome: null, notes: null }), {
        name: 'X',
        url: 'x.test',
        revision: 274,
        wikiHome: null,
        notes: null
    });
});
