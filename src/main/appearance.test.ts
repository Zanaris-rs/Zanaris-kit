import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appearanceView } from './appearance.ts';
import { DEFAULT_SERVERS } from './catalog.ts';
import { THEMES, themeById, type Theme } from '../shared/themes.ts';
import type { ServerDef } from '../shared/catalog.ts';

const catalog = DEFAULT_SERVERS.map(s => ({ ...s }) as ServerDef);

test('the view names the app theme and carries its look, for Settings to wear', () => {
    const view = appearanceView({ appearance: { theme: 'zanaris', servers: {}, custom: [] }, catalog });
    assert.equal(view.theme, 'zanaris');
    assert.deepEqual(view.look, { colors: themeById('zanaris').colors, background: null });
});

test('an app theme the kit does not know is named as the stone it falls back to', () => {
    const view = appearanceView({ appearance: { theme: 'parchment', servers: {}, custom: [] }, catalog });
    assert.equal(view.theme, 'stone');
});

test('every theme is offered, in order', () => {
    const view = appearanceView({ appearance: { theme: 'stone', servers: {}, custom: [] }, catalog });
    assert.deepEqual(
        view.themes.map(t => t.id),
        THEMES.map(t => t.id)
    );
    assert.deepEqual(view.themes[1]?.colors, themeById('zanaris').colors);
});

test('every catalog server is listed in catalog order, with its own theme or null to follow the app', () => {
    const view = appearanceView({ appearance: { theme: 'stone', servers: { zanaris: 'zanaris' }, custom: [] }, catalog });
    assert.deepEqual(
        view.servers.map(s => s.id),
        catalog.map(s => s.id)
    );
    assert.equal(view.servers.find(s => s.id === 'zanaris')?.theme, 'zanaris');
    assert.equal(view.servers.find(s => s.id === 'lostcity')?.theme, null);
    assert.equal(view.servers.find(s => s.id === 'lostcity')?.name, catalog.find(s => s.id === 'lostcity')?.name);
});

test('an override for a server the catalog no longer holds is not listed', () => {
    const view = appearanceView({ appearance: { theme: 'stone', servers: { gone: 'wilderness' }, custom: [] }, catalog });
    assert.equal(
        view.servers.some(s => s.id === 'gone'),
        false
    );
});

const night: Theme = {
    id: 'custom-0000000a',
    name: 'Night',
    colors: { ...themeById('stone').colors, stone: '#223344' },
    background: { picture: `${'ef'.repeat(32)}.webp`, fit: 'tile', show: 0.25 }
};

test('custom themes come after the built-ins, marked as custom, with their pictures', () => {
    const view = appearanceView({ appearance: { theme: 'custom-0000000a', servers: { lostcity: 'custom-0000000a' }, custom: [night] }, catalog });
    assert.deepEqual(
        view.themes.map(t => [t.id, t.custom]),
        [...THEMES.map(t => [t.id, false]), ['custom-0000000a', true]]
    );
    assert.deepEqual(view.themes.at(-1)?.background, night.background);
    assert.equal(view.theme, 'custom-0000000a');
    assert.deepEqual(view.look, { colors: night.colors, background: night.background });
    assert.equal(view.servers.find(s => s.id === 'lostcity')?.theme, 'custom-0000000a');
});
