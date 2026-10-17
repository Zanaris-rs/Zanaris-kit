# Theme Button and Game Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A worded Theme menu in every game window's tab bar, Customise from a window landing in Settings' editor, and the game pane's page wearing the theme by CSS alone.

**Architecture:** Every rule is pure and tested — the menu's entries and what each writes (`appearance.ts`), where Save goes (`savesTo`), the swatch (`swatch.ts`), the page sheets (`gamePage.ts`). Main turns them into a native menu, a held request Settings takes, and stylesheets swapped in the game view. The shell gains one button; Settings gains one request it takes.

**Tech Stack:** Electron 44, TypeScript, React, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-15-theme-button-and-game-page-design.md`

## Global Constraints

- Bar order: Setups, Theme, Add pane, then the gear.
- Native menu labels are Title Case for built-ins, as typed for the player's own, with `&` doubled off macOS (`themeLabel`).
- Nothing but CSS reaches a game page; no `url(`, no `@import`.
- The theme sheet sets no `border`, `margin`, `padding`, `height`, `min-height` or `line-height` on `#controls`, `html` or `body`. Bevels are inset `box-shadow`.
- Every colour a sheet writes is the worn look's, apart from the glyph shadow `rgba(0, 0, 0, 0.78)`.
- Only Settings calls the `appearance.*` handlers; the Theme menu acts in main.
- IPC channels are `zanaris:<area>-<verb>`: `zanaris:tab-theme-menu`, `zanaris:settings-take-show`, `zanaris:settings-show`.
- A literal colour in `src/renderer` fails `themes.test.ts`.
- Every comment a change makes untrue is fixed in the same commit.

## Review Focus

- A server removed from the catalog with its window still open: Just for greyed, a pick sets the app theme, Customise saves to the app — `themeMenu`/`themeChoice`/`savesTo` tests with `listed: false`.
- Customise while the editor already holds a draft: the draft stays — main sends `edit: null`, and Settings keeps an editor it has (`e ?? …`).
- Rapid colour drags in the editor: game-page sheet swaps overtaking each other leave one sheet, not a pile — the turn counter in `dressGamePage`.
- A server's own theme removed while an editor opened from its window is open: Save goes to the app — `savesTo` test.
- A page without `#controls`: the generic rules still apply and nothing errors — `clientPageCss` test asserts the `select` and `.green` rules stand alone.

---

### Task 1: `draftOf` in `themes.ts`

**Files:**
- Modify: `src/shared/themes.ts` (after `uniqueName`)
- Modify: `src/renderer/settings/Appearance.tsx` (drop its local `draftOf`)
- Test: `src/shared/themes.test.ts`

**Interfaces:**
- Produces: `draftOf(theme: Theme, custom: boolean): ThemeDraft`

- [ ] **Step 1: Write the failing tests**

```ts
test('a built-in opens in the editor as a copy, named as one, with no picture', () => {
    const stone = themeById('stone');
    assert.deepEqual(draftOf(stone, false), { id: null, name: '2004 stone (copy)', colors: stone.colors, background: null });
});

test("a player's own opens as it is, picture and all", () => {
    const own: Theme = { id: 'custom-0a0b0c0d', name: 'Mine', colors: themeById('zanaris').colors, background: { picture: `${'a'.repeat(64)}.png`, fit: 'tile', show: 0.3 } };
    const draft = draftOf(own, true);
    assert.deepEqual(draft, { id: own.id, name: 'Mine', colors: own.colors, background: own.background });
    assert.notEqual(draft.colors, own.colors);
});
```

- [ ] **Step 2: Run** `node --test src/shared/themes.test.ts` — FAIL, `draftOf` not exported.
- [ ] **Step 3: Implement**

```ts
/** What the editor opens on: a built-in as a copy, named as one and with no picture; one of the player's own as it is. Copied either way, so the draft is the editor's own. */
export function draftOf(theme: Theme, custom: boolean): ThemeDraft {
    return custom
        ? { id: theme.id, name: theme.name, colors: { ...theme.colors }, background: theme.background ? { ...theme.background } : null }
        : { id: null, name: `${theme.name} (copy)`, colors: { ...theme.colors }, background: null };
}
```

In `Appearance.tsx` delete the local `draftOf` and call `draftOf(theme, theme.custom)`.

- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `refactor: the editor's draftOf in themes.ts, for main to open it too`

### Task 2: The Theme menu's rules

**Files:**
- Modify: `src/main/appearance.ts`
- Modify: `src/main/menu.ts` (import `themeLabel` from `appearance.ts`, drop its own and `menuName`)
- Test: `src/main/appearance.test.ts`

**Interfaces:**
- Consumes: `draftOf` (Task 1), `serverOverride`, `themeFor`, `isThemeId`, `THEMES` from `themes.ts`
- Produces:
  - `themeLabel(theme: Theme, isMac: boolean): string`
  - `type ThemeMenuAction = { kind: 'wear'; theme: string } | { kind: 'own'; on: boolean } | { kind: 'customise' } | { kind: 'all' }`
  - `type ThemeMenuEntry = { kind: 'separator' } | { kind: 'item'; label: string; checked: boolean | null; enabled: boolean; swatch: ThemeColors | null; action: ThemeMenuAction }`
  - `themeMenu(opts: { appearance: Appearance; server: { id: string; name: string }; listed: boolean; isMac: boolean }): ThemeMenuEntry[]`
  - `type ThemeChange = { theme: string } | { server: string; theme: string | null }`
  - `themeChoice(appearance: Appearance, serverId: string, listed: boolean, action: ThemeMenuAction): ThemeChange | null`
  - `editFromWindow(appearance: Appearance, serverId: string, listed: boolean): { draft: ThemeDraft; forServer: string | null }`

- [ ] **Step 1: Write the failing tests**

```ts
const lostCity = { id: 'lostcity', name: 'Lost City' };
const items = (entries: ThemeMenuEntry[]) => entries.filter((e): e is Extract<ThemeMenuEntry, { kind: 'item' }> => e.kind === 'item');
const own: Theme = { id: 'custom-0a0b0c0d', name: 'Rock & roll', colors: themeById('lumbridge').colors, background: null };

test('the menu lists every built-in, ticks what the server wears, and offers the tick and the editor', () => {
    const entries = themeMenu({ appearance: { theme: 'zanaris', servers: {}, custom: [] }, server: lostCity, listed: true, isMac: true });
    const labels = items(entries).map(e => e.label);
    assert.deepEqual(labels, ['2004 Stone', 'Zanaris', 'Wilderness', 'Al Kharid', 'Morytania', 'Lumbridge', 'Just for Lost City', 'Customise Zanaris…', 'All Themes…']);
    assert.deepEqual(items(entries).filter(e => e.checked).map(e => e.label), ['Zanaris']);
    assert.equal(items(entries).find(e => e.label === 'Just for Lost City')?.checked, false);
    assert.deepEqual(items(entries)[0]?.swatch, themeById('stone').colors);
    assert.equal(items(entries).find(e => e.label === 'All Themes…')?.checked, null);
});

test("a server with its own theme has it ticked and Just for ticked; the player's own follow a separator, Edit for one of theirs", () => {
    const entries = themeMenu({ appearance: { theme: 'stone', servers: { lostcity: own.id }, custom: [own] }, server: lostCity, listed: true, isMac: false });
    assert.deepEqual(items(entries).filter(e => e.checked).map(e => e.label), ['Rock && roll', 'Just for Lost City']);
    assert.ok(items(entries).some(e => e.label === 'Edit Rock && roll…'));
    const firstOwn = entries.findIndex(e => e.kind === 'item' && e.label === 'Rock && roll');
    assert.equal(entries[firstOwn - 1]?.kind, 'separator');
});

test('a window whose server was removed greys Just for', () => {
    const entries = themeMenu({ appearance: { theme: 'stone', servers: {}, custom: [] }, server: lostCity, listed: false, isMac: true });
    assert.equal(items(entries).find(e => e.label === 'Just for Lost City')?.enabled, false);
});

test('a pick sets the app theme, or the server\'s own while it keeps one', () => {
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
});

test('Customise from a window opens on what it wears, saving to its server only while it keeps its own', () => {
    assert.deepEqual(editFromWindow({ theme: 'zanaris', servers: {}, custom: [] }, 'lostcity', true), { draft: draftOf(themeById('zanaris'), false), forServer: null });
    const kept = editFromWindow({ theme: 'stone', servers: { lostcity: own.id }, custom: [own] }, 'lostcity', true);
    assert.deepEqual(kept, { draft: draftOf(own, true), forServer: 'lostcity' });
});
```

- [ ] **Step 2: Run** `node --test src/main/appearance.test.ts` — FAIL, missing exports.
- [ ] **Step 3: Implement** in `appearance.ts`:

```ts
/** Native menus are Title Case; a built-in's name is sentence case, as the renderer draws it. */
const titleCase = (name: string): string => name.replace(/(^|\s)\S/g, c => c.toUpperCase());

/** Words a player typed, shown in a native menu: Windows and Linux read an `&` as the mark for the next letter's shortcut, so one is doubled there to show as itself. */
const menuText = (text: string, isMac: boolean): string => (isMac ? text : text.replace(/&/g, '&&'));

/** A theme as a native menu names it: a built-in title-cased, a player's own as they typed it. */
export function themeLabel(theme: Theme, isMac: boolean): string {
    if (THEMES.some(builtIn => builtIn.id === theme.id)) return titleCase(theme.name);
    return menuText(theme.name, isMac);
}

export type ThemeMenuAction = { kind: 'wear'; theme: string } | { kind: 'own'; on: boolean } | { kind: 'customise' } | { kind: 'all' };

export type ThemeMenuEntry =
    | { kind: 'separator' }
    | { kind: 'item'; label: string; checked: boolean | null; enabled: boolean; swatch: ThemeColors | null; action: ThemeMenuAction };

const SEPARATOR: ThemeMenuEntry = { kind: 'separator' };

export function themeMenu(opts: { appearance: Appearance; server: { id: string; name: string }; listed: boolean; isMac: boolean }): ThemeMenuEntry[] {
    const { appearance, server, listed, isMac } = opts;
    const own = listed ? serverOverride(appearance, server.id) : null;
    const worn = themeFor(appearance, server.id);
    const wear = (theme: Theme): ThemeMenuEntry => ({ kind: 'item', label: themeLabel(theme, isMac), checked: theme.id === worn.id, enabled: true, swatch: theme.colors, action: { kind: 'wear', theme: theme.id } });
    const plain = (label: string, action: ThemeMenuAction): ThemeMenuEntry => ({ kind: 'item', label, checked: null, enabled: true, swatch: null, action });
    const custom = appearance.custom.some(theme => theme.id === worn.id);
    return [
        ...THEMES.map(wear),
        ...(appearance.custom.length > 0 ? [SEPARATOR, ...appearance.custom.map(wear)] : []),
        SEPARATOR,
        { kind: 'item', label: `Just for ${menuText(server.name, isMac)}`, checked: own !== null, enabled: listed, swatch: null, action: { kind: 'own', on: own === null } },
        SEPARATOR,
        plain(`${custom ? 'Edit' : 'Customise'} ${themeLabel(worn, isMac)}…`, { kind: 'customise' }),
        plain('All Themes…', { kind: 'all' })
    ];
}

export type ThemeChange = { theme: string } | { server: string; theme: string | null };

export function themeChoice(appearance: Appearance, serverId: string, listed: boolean, action: ThemeMenuAction): ThemeChange | null {
    const own = listed ? serverOverride(appearance, serverId) : null;
    if (action.kind === 'wear') {
        if (!isThemeId(action.theme, appearance.custom)) return null;
        return own !== null ? { server: serverId, theme: action.theme } : { theme: action.theme };
    }
    if (action.kind === 'own' && listed) return { server: serverId, theme: action.on ? themeFor(appearance, null).id : null };
    return null;
}

export function editFromWindow(appearance: Appearance, serverId: string, listed: boolean): { draft: ThemeDraft; forServer: string | null } {
    const theme = themeFor(appearance, serverId);
    const custom = appearance.custom.some(t => t.id === theme.id);
    const own = listed ? serverOverride(appearance, serverId) : null;
    return { draft: draftOf(theme, custom), forServer: own !== null ? serverId : null };
}
```

`menu.ts`: delete `menuName` and `themeLabel`, `import { themeLabel } from './appearance.ts'`.

- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat: the Theme menu's rules — what it lists, ticks, and what each item writes`

### Task 3: Where Save goes

**Files:**
- Modify: `src/main/appearance.ts` (`Editing`, `readEditing`, `savesTo`, `AppearanceView`, `appearanceView`)
- Test: `src/main/appearance.test.ts`

**Interfaces:**
- Produces: `Editing.forServer: string | null`; `savesTo(appearance: Appearance, catalog: readonly ServerDef[], editing: Editing | null): { id: string; name: string } | null`; `AppearanceView.savesTo` of the same type.

- [ ] **Step 1: Write the failing tests**

```ts
const editingFor = (forServer: string | null): Editing => ({ look: { colors: themeById('stone').colors, background: null }, name: 'x', changed: false, forServer });

test("Save goes to the server whose window opened the editor while it keeps its own theme, else the app", () => {
    const kept = { theme: 'stone', servers: { lostcity: 'wilderness' }, custom: [] };
    assert.deepEqual(savesTo(kept, catalog, editingFor('lostcity')), { id: 'lostcity', name: catalog.find(s => s.id === 'lostcity')!.name });
    assert.equal(savesTo({ theme: 'stone', servers: {}, custom: [] }, catalog, editingFor('lostcity')), null);
    assert.equal(savesTo(kept, catalog.filter(s => s.id !== 'lostcity'), editingFor('lostcity')), null);
    assert.equal(savesTo(kept, catalog, editingFor(null)), null);
    assert.equal(savesTo(kept, catalog, null), null);
});

test('the editing report carries the server it saves for, and refuses one that is not a string', () => {
    const look = { colors: themeById('stone').colors, background: null };
    assert.equal(readEditing({ look, name: 'a', changed: false, forServer: 'lostcity' })?.forServer, 'lostcity');
    assert.equal(readEditing({ look, name: 'a', changed: false })?.forServer, null);
    assert.equal(readEditing({ look, name: 'a', changed: false, forServer: 7 }), null);
});

test('the view says where Save goes', () => {
    const view = appearanceView({ appearance: { theme: 'stone', servers: { lostcity: 'wilderness' }, custom: [] }, catalog, presets: [], editing: editingFor('lostcity') });
    assert.equal(view.savesTo?.id, 'lostcity');
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: `Editing` gains `forServer: string | null` (doc: the server whose window opened the editor while it kept its own theme, or null). In `readEditing`, before building: `if (e.forServer !== undefined && e.forServer !== null && typeof e.forServer !== 'string') return null;` and return `forServer: typeof e.forServer === 'string' ? e.forServer : null`.

```ts
export function savesTo(appearance: Appearance, catalog: readonly ServerDef[], editing: Editing | null): { id: string; name: string } | null {
    const id = editing?.forServer;
    if (!id) return null;
    const server = catalog.find(s => s.id === id);
    if (!server || serverOverride(appearance, id) === null) return null;
    return { id, name: server.name };
}
```

`AppearanceView` gains `savesTo: { id: string; name: string } | null`; `appearanceView` sets `savesTo: savesTo(opts.appearance, opts.catalog, opts.editing ?? null)`.

- [ ] **Step 4: Run** `npm test`, `npm run typecheck` — the renderer's `useReportEditing` fails typecheck until Task 7 adds `forServer`; add `forServer: null` there now so this task's commit typechecks.
- [ ] **Step 5: Commit** `feat: Save goes to the server whose window opened the editor, while it keeps its own theme`

### Task 4: The swatch

**Files:**
- Create: `src/main/swatch.ts`
- Test: `src/main/swatch.test.ts`

**Interfaces:**
- Produces: `swatchPixels(colors: ThemeColors, scale: number): { size: number; rgba: Uint8Array }`, `pngOf(width: number, height: number, rgba: Uint8Array): Buffer`, `swatchPng(colors: ThemeColors, scale: number): Buffer`. RGBA, encoded as PNG, so `nativeImage.createFromBuffer` reads it the same on every system — `createFromBitmap`'s byte order is the platform's.

- [ ] **Step 1: Write the failing tests**

```ts
import { inflateSync } from 'node:zlib';
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const at = (s: { size: number; rgba: Uint8Array }, x: number, y: number) => [...s.rgba.slice((y * s.size + x) * 4, (y * s.size + x) * 4 + 3)];

test('the swatch is the stone, lit above and left, dark below and right', () => {
    const c = themeById('wilderness').colors;
    const s = swatchPixels(c, 2);
    assert.equal(s.size, 32);
    assert.deepEqual(at(s, 16, 16), rgb(c.stone));
    assert.deepEqual(at(s, 16, 0), rgb(c['edge-lit']));
    assert.deepEqual(at(s, 0, 16), rgb(c['edge-lit']));
    assert.deepEqual(at(s, 16, 31), rgb(c['edge-dark']));
    assert.deepEqual(at(s, 31, 16), rgb(c['edge-dark']));
    assert.equal(s.rgba[3], 255);
});

test('the PNG carries the pixels row by row, unfiltered', () => {
    const s = swatchPixels(themeById('stone').colors, 1);
    const png = pngOf(s.size, s.size, s.rgba);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), 16);
    const idat = png.indexOf('IDAT');
    const raw = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)));
    assert.equal(raw.length, 16 * (1 + 16 * 4));
    assert.equal(raw[0], 0);
    assert.deepEqual([...raw.subarray(1, 5)], [...s.rgba.subarray(0, 4)]);
});
```

- [ ] **Step 2: Run** — FAIL, no module.
- [ ] **Step 3: Implement** `swatch.ts`: a 16-point square at `scale`; bevel `2 * scale` px; a pixel is face when all four edge distances are at least the bevel, else lit when `min(top, left) <= min(bottom, right)`, else dark. `pngOf` writes signature, IHDR (8-bit RGBA, colour type 6), one IDAT of `deflateSync` over rows each led by filter byte 0, IEND, each chunk with its CRC-32 (table built once).
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat: a theme's swatch, as the PNG the Theme menu shows beside its name`

### Task 5: The page sheets

**Files:**
- Create: `src/main/gamePage.ts`
- Test: `src/main/gamePage.test.ts`
- Modify: `static/page.css` (each colour read from `--zk-<token>` with its stone value as fallback)

**Interfaces:**
- Produces: `clientPageCss(look: ThemeLook): string`, `kitPageCss(look: ThemeLook): string`

- [ ] **Step 1: Write the failing tests** — a look whose 21 colours are all different (`#0000` + two hex digits of the token's index), then:

```ts
test('every colour the client sheet writes is the look\'s, or the glyph shadow\'s black', () => {
    const css = clientPageCss(look);
    const values = new Set(Object.values(look.colors));
    for (const hex of css.match(/#[0-9a-f]{6}\b/gi) ?? []) assert.ok(values.has(hex), hex);
    for (const fn of css.match(/rgba?\([^)]*\)/g) ?? []) assert.equal(fn, 'rgba(0, 0, 0, 0.78)');
    assert.doesNotMatch(css, /url\(|@import|<|expression/i);
});

test('the sheet moves nothing that sets the page\'s height', () => {
    const css = clientPageCss(look);
    const sizing = /^(html(:root)?(:-webkit-full-screen)?|html:root body|html #controls)$/;
    let checked = 0;
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        if (!selector!.split(',').some(part => sizing.test(part.trim()))) continue;
        checked++;
        assert.doesNotMatch(body!, /(^|;|\s)(border|margin|padding|height|min-height|line-height)\s*:/, selector);
    }
    assert.equal(checked, 2);
});

test('the dropdowns and green text follow on a page with no strip', () => {
    const css = clientPageCss(look);
    assert.match(css, /html select\s*\{[^}]*background-color:\s*#000004/);
    assert.match(css, /html \.green[^{]*\{[^}]*color:\s*#000007/);
});

test('the kit sheet sets a variable for every token', () => {
    const css = kitPageCss(look);
    for (const token of THEME_TOKENS) assert.ok(css.includes(`--zk-${token}: ${look.colors[token]};`), token);
});
```

(`#000004` is `well`, index 4; `#000007` is `cream`, index 7 — derived from `THEME_TOKENS` order in the test, not typed.)

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**

```ts
const SHADOW = '1px 1px 0 rgba(0, 0, 0, 0.78)';

export function clientPageCss(look: ThemeLook): string {
    const c = look.colors;
    return `
html:root, html:root body, html:root:-webkit-full-screen { background-color: ${c.window} !important; }
html #controls {
    background-color: ${c.stone} !important;
    box-shadow: inset 2px 2px 0 ${c['edge-lit']}, inset -2px -2px 0 ${c['edge-dark']} !important;
    color: ${c.cream} !important;
    text-shadow: ${SHADOW} !important;
}
html .green, html .icon-control { color: ${c.cream} !important; }
html a.green:hover, html .icon-control:hover { color: ${c.gold} !important; }
html select {
    background-color: ${c.well} !important;
    background-image: linear-gradient(45deg, transparent 50%, ${c.cream} 50%), linear-gradient(135deg, ${c.cream} 50%, transparent 50%) !important;
    box-shadow: inset 2px 2px 0 ${c['edge-dark']}, inset -2px -2px 0 ${c['edge-lit']} !important;
    color: ${c.cream} !important;
    text-shadow: ${SHADOW} !important;
    line-height: 24px !important;
    padding-left: 6px !important;
    padding-right: 1.3em !important;
}
html option, html optgroup { background-color: ${c.well} !important; color: ${c.cream} !important; }
`;
}

export function kitPageCss(look: ThemeLook): string {
    return `:root { ${THEME_TOKENS.map(token => `--zk-${token}: ${look.colors[token]};`).join(' ')} }`;
}
```

The select's own `line-height` is lower than the strip's 32px strut, so the line box, and the strip, keep their height; `#control-dropdowns` is an inline flex box that centres them.

`static/page.css`: `#1a1710` → `var(--zk-ink, #1a1710)`, `#ece7dc` → cream, `#443d31` → stone, `#211d16` → edge-dark, `#7d7463` → edge-lit, `#ffe139` → gold, `#37311f` → well, `#90c040` → link, `#a89c86` → dim, `#a70700` → red, `#570700` → red-edge, `#c8503f` → red-lit. `#fff` stays.

- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat: the sheets that put the theme on the game page and the kit's own pages`

### Task 6: The game view wears its sheet

**Files:**
- Modify: `src/main/serverWindow.ts` (`dom-ready` in `wireGameView`, `themeChanged`, a new `dressGamePage`)

**Interfaces:**
- Consumes: `clientPageCss`, `kitPageCss` (Task 5); `deps.theme()`

- [ ] **Step 1: Implement** beside `loadGame`:

```ts
let pageSheet: string | null = null;
let pageSheetTurn = 0;

function dressGamePage(wc: WebContents): void {
    if (wc.isDestroyed()) return;
    const turn = ++pageSheetTurn;
    const look = deps.theme();
    const css = wc.getURL().startsWith('file:') ? kitPageCss(look) : clientPageCss(look);
    wc.insertCSS(css).then(
        key => {
            if (wc.isDestroyed()) return;
            if (turn !== pageSheetTurn) {
                void wc.removeInsertedCSS(key).catch(() => undefined);
                return;
            }
            const before = pageSheet;
            pageSheet = key;
            if (before) void wc.removeInsertedCSS(before).catch(() => undefined);
        },
        () => undefined
    );
}
```

`dom-ready` becomes: `pageSheet = null;` then, off `file:`, `void wc.insertCSS(GAME_PAGE_CSS);`, then `dressGamePage(wc)` for every page. `themeChanged` gains `if (gameView) dressGamePage(gameView.webContents);` and its comment says the view's own ground stays black under a page that wears the theme. `GAME_PAGE_CSS`'s and the `dom-ready` comments say there are two sheets now.

- [ ] **Step 2: Run** `npm run typecheck`, `npm test` — PASS.
- [ ] **Step 3: Commit** `feat: the game page wears the theme, the draft included`

### Task 7: The menu, Customise, and Settings taking the request

**Files:**
- Modify: `src/shared/ipc.ts` (three channels, `SettingsShow`, `panes.themeMenu`, `settings.takeShow`, `settings.onShow`)
- Modify: `src/preload/index.ts`
- Modify: `src/main/settingsView.ts` (`hasLoaded()`, `ping()`)
- Modify: `src/main/index.ts` (the menu handler, `themeMenuChose`, `customiseFrom`, `showInSettings`, `settingsTakeShow`, Save's target, clearing a held request when Settings closes)
- Modify: `src/renderer/Shell.tsx` (Theme between Setups and Add pane; the bar's comment)
- Modify: `src/renderer/Settings.tsx` (`ThemeEditing.forServer`, the report, taking requests)
- Modify: `src/renderer/settings/Appearance.tsx`, `src/renderer/settings/ThemeEditor.tsx` (`savesTo` line)

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces: `SettingsShow = { section: 'servers' | 'appearance'; edit: { draft: ThemeDraft; forServer: string | null } | null }`; `IPC.tabThemeMenu = 'zanaris:tab-theme-menu'`, `IPC.settingsTakeShow = 'zanaris:settings-take-show'`, `IPC.settingsShow = 'zanaris:settings-show'`.

- [ ] **Step 1: IPC and preload.** `panes.themeMenu: (x, y) => ipcRenderer.invoke(IPC.tabThemeMenu, x, y)`; `settings.takeShow: () => ipcRenderer.invoke(IPC.settingsTakeShow)`; `settings.onShow` subscribes to `IPC.settingsShow` as `onState` does, calling `cb()` with nothing.
- [ ] **Step 2: Settings window.** `hasLoaded()` true once the first `did-finish-load` has run — set in the `loaded` promise's `then`, which runs after `onPageReset`; `ping()` sends `IPC.settingsShow` unless destroyed or crashed.
- [ ] **Step 3: Main.** A held `settingsShow: SettingsShow | null`, cleared in the slot's `onClosed`. `showInSettings(sw, request)` holds it, calls `openSettings(sw)`, and pings once `loaded` resolves. `settingsTakeShow` answers it and clears it only for Settings' own sender once `hasLoaded()`. `customiseFrom(sw)` sends `edit: null` while `editing` is set, else `editFromWindow(...)`. The `tabThemeMenu` handler checks its numbers as `tabSetupsMenu` does, builds entries with `themeMenu`, turns them into items — `type: 'checkbox'` where `checked` is not null, `icon: nativeImage.createFromBuffer(swatchPng(swatch, 2), { scaleFactor: 2 })` — and pops them on the window. `themeMenuChose(sw, action)` does nothing for a destroyed window; `customise` → `customiseFrom`; `all` → `showInSettings(sw, { section: 'appearance', edit: null })`; otherwise `themeChoice` and `appState.setTheme` or `setServerTheme`, then `appearanceChanged()`. In the Save handler, `const target = savesTo(appState.appearance(), catalog.list(), editing)` before `editing = null`, and the second write is `target ? setServerTheme(target.id, placed.id) : setTheme(placed.id)`; its comment says so.
- [ ] **Step 4: Shell.** Between Setups and Add pane:

```tsx
<button
    type="button"
    title="Pick or customise a theme"
    aria-haspopup="menu"
    onClick={event => {
        const box = event.currentTarget.getBoundingClientRect();
        void window.zanaris.panes.themeMenu(box.left, box.bottom);
    }}
    style={ADD_PANE_BOX}
    className="btn shrink-0 gap-[3px]"
>
    Theme
    <Caret />
</button>
```

- [ ] **Step 5: Settings.** `ThemeEditing` gains `forServer: string | null`; the report sends it; a card's Customise opens with `forServer: null`; a mount effect subscribes to `onShow` and takes once, setting the section and, when `edit` is there, `setEditing(e => e ?? { initial: edit.draft, draft: edit.draft, forServer: edit.forServer })`. `ThemeEditor` takes `savesTo` and, when it is not null, shows `Save makes this {name}'s own theme.` above the actions, `text-[12px] text-cream`.
- [ ] **Step 6: Run** `npm run typecheck`, `npm test` — PASS.
- [ ] **Step 7: Commit** `feat: the Theme button, its menu, and Customise from a window`

### Task 8: Capture, docs and comments

**Files:**
- Modify: `src/main/index.ts` (capture)
- Modify: `README.md`, `CLAUDE.md`, `src/shared/themes.ts` header, `src/renderer/settings/Appearance.tsx` doc comment

- [ ] **Step 1: Capture.** Each built-in's swatch saved through `save('swatch-<id>', ...)` from `nativeImage.createFromBuffer`. In the override step, `save('theme-override-<own>-game', () => first.captureGame())` after the shell shot. A step after it: `themeMenuChose` driven through wear, own on, wear, own off on `first`, each read back from `appState.appearance()` with a `fault` on a mismatch; then `appState.setServerTheme(own, 'wilderness')`, `themeMenuChose(first, { kind: 'customise' })`, Settings' heading read until it says New theme, the line `Save makes this` found, `settings-editor-from-window` shot, Cancel clicked, Settings closed, the override cleared.
- [ ] **Step 2: Docs.** README How it looks: the Theme button and what the game page wears; Layout's injected stylesheet paragraph: two sheets. `CLAUDE.md`: what a game page may be given, and the geometry rule. Comments saying the game is never themed, wherever they are.
- [ ] **Step 3: Run** `npm test`, `npm run typecheck`, `npm run build`, then `caffeinate -d npm run capture` and open the shots.
- [ ] **Step 4: Commit** `test: capture the Theme menu's choices, Customise from a window, and the themed game page` and `docs: the Theme button and the game page wearing the theme`
