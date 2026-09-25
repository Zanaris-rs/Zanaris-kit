import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appearanceView } from './appearance.ts';
import { DEFAULT_SERVERS } from './catalog.ts';
import { THEMES, themeById } from '../shared/themes.ts';
import type { ServerDef } from '../shared/catalog.ts';

const catalog = DEFAULT_SERVERS.map(s => ({ ...s }) as ServerDef);

test('the view names the app theme and carries its colours, for Settings to wear', () => {
    const view = appearanceView({ appearance: { theme: 'zanaris', servers: {} }, catalog });
    assert.equal(view.theme, 'zanaris');
    assert.deepEqual(view.colors, themeById('zanaris').colors);
});

test('an app theme the kit does not know is named as the stone it falls back to', () => {
    const view = appearanceView({ appearance: { theme: 'parchment', servers: {} }, catalog });
    assert.equal(view.theme, 'stone');
});

test('every theme is offered, in order', () => {
    const view = appearanceView({ appearance: { theme: 'stone', servers: {} }, catalog });
    assert.deepEqual(
        view.themes.map(t => t.id),
        THEMES.map(t => t.id)
    );
    assert.deepEqual(view.themes[1]?.colors, themeById('zanaris').colors);
});

test('every catalog server is listed in catalog order, with its own theme or null to follow the app', () => {
    const view = appearanceView({ appearance: { theme: 'stone', servers: { zanaris: 'zanaris' } }, catalog });
    assert.deepEqual(
        view.servers.map(s => s.id),
        catalog.map(s => s.id)
    );
    assert.equal(view.servers.find(s => s.id === 'zanaris')?.theme, 'zanaris');
    assert.equal(view.servers.find(s => s.id === 'lostcity')?.theme, null);
    assert.equal(view.servers.find(s => s.id === 'lostcity')?.name, catalog.find(s => s.id === 'lostcity')?.name);
});

test('an override for a server the catalog no longer holds is not listed', () => {
    const view = appearanceView({ appearance: { theme: 'stone', servers: { gone: 'wilderness' } }, catalog });
    assert.equal(
        view.servers.some(s => s.id === 'gone'),
        false
    );
});
