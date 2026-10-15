import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appearanceView, closeQuestion, deleteQuestion, editFromWindow, lookFor, readEditing, savesTo, themeChoice, themeLabel, themeMenu, type Editing, type ThemeMenuEntry } from './appearance.ts';
import { DEFAULT_SERVERS } from './catalog.ts';
import { THEMES, draftOf, themeById, type Theme } from '../shared/themes.ts';
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
    assert.equal(asked!.detail, `${lostcity.name} and ${zanaris.name} go back to the app theme. Every window wearing it goes back to 2004 stone. This can't be undone.`);
    assert.ok(!asked!.detail.includes(labs.name));
    const app = deleteQuestion({ appearance: { theme: 'custom-0000000a', servers: {}, custom: [night] }, catalog, id: 'custom-0000000a' });
    assert.equal(app?.detail, "Every window wearing it goes back to 2004 stone. This can't be undone.");
    const one = deleteQuestion({ appearance: { theme: 'stone', servers: { zanaris: 'custom-0000000a' }, custom: [night] }, catalog, id: 'custom-0000000a' });
    assert.equal(one?.detail, `${zanaris.name} goes back to the app theme. This can't be undone.`);
    assert.equal(deleteQuestion({ appearance: { theme: 'stone', servers: {}, custom: [night] }, catalog, id: 'custom-0000000a' })!.detail, "This can't be undone.");
    assert.equal(deleteQuestion({ appearance: { theme: 'stone', servers: {}, custom: [] }, catalog, id: 'custom-0000000a' }), null);
});

const draftLook = { colors: themeById('zanaris').colors, background: null };

test('a report of the theme being edited is read with its look, name and whether it changed', () => {
    assert.deepEqual(readEditing({ look: draftLook, name: 'Mine', changed: true }), { look: draftLook, name: 'Mine', changed: true, forServer: null });
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
    const editing: Editing = { look: draftLook, name: 'Mine', changed: true, forServer: null };
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
    const editing: Editing = { look: draftLook, name: 'Mine', changed: true, forServer: null };
    assert.deepEqual(closeQuestion(editing, false), { message: 'Discard your changes to Mine?', detail: '' });
    assert.equal(closeQuestion({ ...editing, changed: false }, false), null);
    assert.equal(closeQuestion(editing, true), null);
    assert.equal(closeQuestion(null, false), null);
});

test('while a theme is being edited, Settings wears it, and the app theme is still named', () => {
    const view = appearanceView({ appearance: { theme: 'zanaris', servers: {}, custom: [] }, catalog, presets: [], editing: { look: { colors: themeById('wilderness').colors, background: null }, name: 'Mine', changed: true, forServer: null } });
    assert.equal(view.theme, 'zanaris');
    assert.deepEqual(view.look, { colors: themeById('wilderness').colors, background: null });
});

// ── the Theme menu ────────────────────────────────────────────────────────

const lostCity = { id: 'lostcity', name: 'Lost City' };
const items = (entries: ThemeMenuEntry[]): Extract<ThemeMenuEntry, { kind: 'item' }>[] => entries.filter((e): e is Extract<ThemeMenuEntry, { kind: 'item' }> => e.kind === 'item');
const rock: Theme = { id: 'custom-0a0b0c0d', name: 'Rock & roll', colors: themeById('lumbridge').colors, background: null };

test('a built-in is named in Title Case in a native menu, a player\'s own as typed, with an & doubled off macOS', () => {
    assert.equal(themeLabel(themeById('alkharid'), true), 'Al Kharid');
    assert.equal(themeLabel(themeById('stone'), false), '2004 Stone');
    assert.equal(themeLabel(rock, true), 'Rock & roll');
    assert.equal(themeLabel(rock, false), 'Rock && roll');
});

test('the Theme menu lists every built-in, ticks what the server wears, and offers the tick and the editor', () => {
    const entries = themeMenu({ appearance: { theme: 'zanaris', servers: {}, custom: [] }, server: lostCity, listed: true, isMac: true });
    assert.deepEqual(
        items(entries).map(e => e.label),
        ['2004 Stone', 'Zanaris', 'Wilderness', 'Al Kharid', 'Morytania', 'Lumbridge', 'Just for Lost City', 'Customise Zanaris…', 'All Themes…']
    );
    assert.deepEqual(
        items(entries)
            .filter(e => e.checked)
            .map(e => e.label),
        ['Zanaris']
    );
    assert.equal(items(entries).find(e => e.label === 'Just for Lost City')?.checked, false);
    assert.deepEqual(items(entries)[0]?.swatch, themeById('stone').colors);
    assert.equal(items(entries).find(e => e.label === 'All Themes…')?.checked, null);
    assert.equal(items(entries).find(e => e.label === 'All Themes…')?.swatch, null);
    assert.deepEqual(
        entries.map(e => e.kind),
        [...THEMES.map(() => 'item'), 'separator', 'item', 'separator', 'item', 'item']
    );
});

test("a server with its own theme has it ticked and Just for ticked; the player's own follow a separator, and one of theirs is Edit", () => {
    const entries = themeMenu({ appearance: { theme: 'stone', servers: { lostcity: rock.id }, custom: [rock] }, server: lostCity, listed: true, isMac: false });
    assert.deepEqual(
        items(entries)
            .filter(e => e.checked)
            .map(e => e.label),
        ['Rock && roll', 'Just for Lost City']
    );
    assert.ok(items(entries).some(e => e.label === 'Edit Rock && roll…'));
    const firstOwn = entries.findIndex(e => e.kind === 'item' && e.label === 'Rock && roll');
    assert.equal(entries[firstOwn - 1]?.kind, 'separator');
    assert.deepEqual(items(entries).find(e => e.label === 'Just for Lost City')?.action, { kind: 'own', on: false });
});

test('a window whose server was removed from the list greys Just for', () => {
    const entries = themeMenu({ appearance: { theme: 'stone', servers: {}, custom: [] }, server: lostCity, listed: false, isMac: true });
    assert.equal(items(entries).find(e => e.label === 'Just for Lost City')?.enabled, false);
    assert.ok(items(entries).filter(e => e.label !== 'Just for Lost City').every(e => e.enabled));
});

test("a pick sets the app theme, or the server's own while it keeps one", () => {
    const app = { theme: 'stone', servers: {}, custom: [] };
    assert.deepEqual(themeChoice(app, 'lostcity', true, { kind: 'wear', theme: 'zanaris' }), { theme: 'zanaris' });
    const kept = { theme: 'stone', servers: { lostcity: 'wilderness' }, custom: [] };
    assert.deepEqual(themeChoice(kept, 'lostcity', true, { kind: 'wear', theme: 'zanaris' }), { server: 'lostcity', theme: 'zanaris' });
    assert.deepEqual(themeChoice(kept, 'lostcity', false, { kind: 'wear', theme: 'zanaris' }), { theme: 'zanaris' });
    assert.equal(themeChoice(app, 'lostcity', true, { kind: 'wear', theme: 'parchment' }), null);
});

test('the tick gives the server the app theme as its own, and takes it back', () => {
    const app = { theme: 'morytania', servers: {}, custom: [] };
    assert.deepEqual(themeChoice(app, 'lostcity', true, { kind: 'own', on: true }), { server: 'lostcity', theme: 'morytania' });
    assert.deepEqual(themeChoice(app, 'lostcity', true, { kind: 'own', on: false }), { server: 'lostcity', theme: null });
    assert.equal(themeChoice(app, 'lostcity', false, { kind: 'own', on: true }), null);
    assert.equal(themeChoice(app, 'lostcity', true, { kind: 'customise' }), null);
    assert.equal(themeChoice(app, 'lostcity', true, { kind: 'all' }), null);
});

test('an app theme the kit does not know is given to the server as the stone it falls back to', () => {
    assert.deepEqual(themeChoice({ theme: 'parchment', servers: {}, custom: [] }, 'lostcity', true, { kind: 'own', on: true }), { server: 'lostcity', theme: 'stone' });
});

test('Customise from a window opens on what it wears, saving to its server only while it keeps its own', () => {
    assert.deepEqual(editFromWindow({ theme: 'zanaris', servers: {}, custom: [] }, 'lostcity', true), { draft: draftOf(themeById('zanaris'), false), forServer: null });
    assert.deepEqual(editFromWindow({ theme: 'stone', servers: { lostcity: rock.id }, custom: [rock] }, 'lostcity', true), { draft: draftOf(rock, true), forServer: 'lostcity' });
    assert.equal(editFromWindow({ theme: 'stone', servers: { lostcity: 'wilderness' }, custom: [] }, 'lostcity', false).forServer, null);
});

// ── where the editor's Save goes ──────────────────────────────────────────

const editingFor = (forServer: string | null): Editing => ({ look: { colors: themeById('stone').colors, background: null }, name: 'x', changed: false, forServer });

test('Save goes to the server whose window opened the editor while it keeps its own theme, else the app', () => {
    const kept = { theme: 'stone', servers: { lostcity: 'wilderness' }, custom: [] };
    assert.deepEqual(savesTo(kept, catalog, editingFor('lostcity')), { id: 'lostcity', name: catalog.find(s => s.id === 'lostcity')!.name });
    assert.equal(savesTo({ theme: 'stone', servers: {}, custom: [] }, catalog, editingFor('lostcity')), null);
    assert.equal(
        savesTo(
            kept,
            catalog.filter(s => s.id !== 'lostcity'),
            editingFor('lostcity')
        ),
        null
    );
    assert.equal(savesTo(kept, catalog, editingFor(null)), null);
    assert.equal(savesTo(kept, catalog, null), null);
});

test('the editing report carries the server it saves for, and refuses one that is not a string', () => {
    const look = { colors: themeById('stone').colors, background: null };
    assert.equal(readEditing({ look, name: 'a', changed: false, forServer: 'lostcity' })?.forServer, 'lostcity');
    assert.equal(readEditing({ look, name: 'a', changed: false, forServer: null })?.forServer, null);
    assert.equal(readEditing({ look, name: 'a', changed: false })?.forServer, null);
    assert.equal(readEditing({ look, name: 'a', changed: false, forServer: 7 }), null);
});

test('the view says where Save goes', () => {
    const view = appearanceView({ appearance: { theme: 'stone', servers: { lostcity: 'wilderness' }, custom: [] }, catalog, presets: [], editing: editingFor('lostcity') });
    assert.equal(view.savesTo?.id, 'lostcity');
    assert.equal(appearanceView({ appearance: { theme: 'stone', servers: {}, custom: [] }, catalog, presets: [] }).savesTo, null);
});
