import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appearanceView, closeQuestion, deleteQuestion, lookFor, readEditing } from './appearance.ts';
import { DEFAULT_SERVERS } from './catalog.ts';
import { THEMES, themeById, type Theme } from '../shared/themes.ts';
import type { ServerDef } from '../shared/catalog.ts';

const catalog = DEFAULT_SERVERS.map(s => ({ ...s }) as ServerDef);

test('the view names the app theme and carries its look, for Settings to wear', () => {
    const view = appearanceView({ appearance: { theme: 'zanaris', servers: {}, custom: [] }, catalog, presets: [] });
    assert.equal(view.theme, 'zanaris');
    assert.deepEqual(view.look, { colors: themeById('zanaris').colors, background: null });
});

test('an app theme the kit does not know is named as the stone it falls back to', () => {
    const view = appearanceView({ appearance: { theme: 'parchment', servers: {}, custom: [] }, catalog, presets: [] });
    assert.equal(view.theme, 'stone');
});

test('every theme is offered, in order', () => {
    const view = appearanceView({ appearance: { theme: 'stone', servers: {}, custom: [] }, catalog, presets: [] });
    assert.deepEqual(
        view.themes.map(t => t.id),
        THEMES.map(t => t.id)
    );
    assert.deepEqual(view.themes[1]?.colors, themeById('zanaris').colors);
});

test('every catalog server is listed in catalog order, with its own theme or null to follow the app', () => {
    const view = appearanceView({ appearance: { theme: 'stone', servers: { zanaris: 'zanaris' }, custom: [] }, catalog, presets: [] });
    assert.deepEqual(
        view.servers.map(s => s.id),
        catalog.map(s => s.id)
    );
    assert.equal(view.servers.find(s => s.id === 'zanaris')?.theme, 'zanaris');
    assert.equal(view.servers.find(s => s.id === 'lostcity')?.theme, null);
    assert.equal(view.servers.find(s => s.id === 'lostcity')?.name, catalog.find(s => s.id === 'lostcity')?.name);
});

test('an override for a server the catalog no longer holds is not listed', () => {
    const view = appearanceView({ appearance: { theme: 'stone', servers: { gone: 'wilderness' }, custom: [] }, catalog, presets: [] });
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
    const view = appearanceView({ appearance: { theme: 'custom-0000000a', servers: { lostcity: 'custom-0000000a' }, custom: [night] }, catalog, presets: [] });
    assert.deepEqual(
        view.themes.map(t => [t.id, t.custom]),
        [...THEMES.map(t => [t.id, false]), ['custom-0000000a', true]]
    );
    assert.deepEqual(view.themes.at(-1)?.background, night.background);
    assert.equal(view.theme, 'custom-0000000a');
    assert.deepEqual(view.look, { colors: night.colors, background: night.background });
    assert.equal(view.servers.find(s => s.id === 'lostcity')?.theme, 'custom-0000000a');
});

test("the kit's own pictures travel as they are given, for the editor's gallery", () => {
    const presets = [{ id: 'lava', name: 'Lava', fit: 'tile' as const, picture: `${'a'.repeat(64)}.png` }];
    const view = appearanceView({ appearance: { theme: 'stone', servers: {}, custom: [] }, catalog, presets });
    assert.deepEqual(view.presets, presets);
    assert.notEqual(view.presets[0], presets[0]);
});

test('the delete question says who wears the theme and what they will wear instead', () => {
    const labs = catalog.find(s => s.id === 'lostcitylabs')!;
    const lostcity = catalog.find(s => s.id === 'lostcity')!;
    const zanaris = catalog.find(s => s.id === 'zanaris')!;
    const worn = { theme: 'custom-0000000a', servers: { lostcity: 'custom-0000000a', zanaris: 'custom-0000000a', lostcitylabs: 'stone' }, custom: [night] };
    const asked = deleteQuestion({ appearance: worn, catalog, id: 'custom-0000000a' });
    assert.equal(asked?.message, 'Delete Night?');
    assert.match(asked!.detail, /It is the app theme: Settings, and every server without its own, will wear 2004 stone\./);
    assert.ok(asked!.detail.includes(`${lostcity.name} and ${zanaris.name} wear it, and will follow the app theme.`));
    assert.ok(!asked!.detail.includes(labs.name));
    const one = deleteQuestion({ appearance: { theme: 'stone', servers: { zanaris: 'custom-0000000a' }, custom: [night] }, catalog, id: 'custom-0000000a' });
    assert.ok(one?.detail.startsWith(`${zanaris.name} wears it`));
    assert.match(deleteQuestion({ appearance: { theme: 'stone', servers: {}, custom: [night] }, catalog, id: 'custom-0000000a' })!.detail, /^Nothing wears it\./);
    assert.equal(deleteQuestion({ appearance: { theme: 'stone', servers: {}, custom: [] }, catalog, id: 'custom-0000000a' }), null);
});

const draftLook = { colors: themeById('zanaris').colors, background: null };

test('a report of the theme being edited is read with its look, name and whether it changed', () => {
    assert.deepEqual(readEditing({ look: draftLook, name: 'Mine', changed: true }), { look: draftLook, name: 'Mine', changed: true });
});

test('a report with a colour or a picture that cannot be read is ignored', () => {
    assert.equal(readEditing({ look: { colors: { ...draftLook.colors, ink: 'red' }, background: null }, name: 'Mine', changed: true }), null);
    assert.equal(readEditing({ look: { colors: draftLook.colors, background: { picture: '../../etc/passwd', fit: 'cover', show: 0.3 } }, name: 'Mine', changed: true }), null);
    assert.equal(readEditing({ look: draftLook, name: 'Mine', changed: 'yes' }), null);
    assert.equal(readEditing({ look: draftLook, changed: true }), null);
    assert.equal(readEditing(null), null);
});

test('a picture that can be read is kept', () => {
    const background = { picture: `${'a'.repeat(64)}.png`, fit: 'tile' as const, show: 0.3 };
    assert.deepEqual(readEditing({ look: { colors: draftLook.colors, background }, name: 'Mine', changed: false })?.look.background, background);
});

test('a long name is cut, and an empty one reads as "this theme"', () => {
    assert.equal(readEditing({ look: draftLook, name: 'x'.repeat(100), changed: true })?.name.length, 40);
    assert.equal(readEditing({ look: draftLook, name: '   ', changed: true })?.name, 'this theme');
});

test('while a theme is being edited, every window wears it, a server with its own theme included', () => {
    const appearance = { theme: 'stone', servers: { lostcity: 'wilderness' }, custom: [] };
    const editing = { look: draftLook, name: 'Mine', changed: true };
    assert.deepEqual(lookFor(appearance, null, editing), draftLook);
    assert.deepEqual(lookFor(appearance, 'lostcity', editing), draftLook);
});

test("with nothing being edited, a window wears its own theme or the app's", () => {
    const appearance = { theme: 'zanaris', servers: { lostcity: 'wilderness' }, custom: [] };
    assert.deepEqual(lookFor(appearance, 'lostcity', null), { colors: themeById('wilderness').colors, background: null });
    assert.deepEqual(lookFor(appearance, 'other', null), { colors: themeById('zanaris').colors, background: null });
    assert.deepEqual(lookFor(appearance, null, null), { colors: themeById('zanaris').colors, background: null });
});

test('closing Settings asks only about a draft with changes, and never while quitting', () => {
    const editing = { look: draftLook, name: 'Mine', changed: true };
    assert.deepEqual(closeQuestion(editing, false), { message: 'Discard your changes to Mine?', detail: 'Every window goes back to the theme it wore before.' });
    assert.equal(closeQuestion({ ...editing, changed: false }, false), null);
    assert.equal(closeQuestion(editing, true), null);
    assert.equal(closeQuestion(null, false), null);
});

test('while a theme is being edited, Settings wears it, and the app theme is still named', () => {
    const view = appearanceView({ appearance: { theme: 'zanaris', servers: {}, custom: [] }, catalog, presets: [], editing: { look: { colors: themeById('wilderness').colors, background: null }, name: 'Mine', changed: true } });
    assert.equal(view.theme, 'zanaris');
    assert.deepEqual(view.look, { colors: themeById('wilderness').colors, background: null });
});
