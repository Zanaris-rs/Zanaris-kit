# Milestone 1: Server Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat launcher-and-window build with the catalog, the launcher, and one server window per open that carries the pinned game tab, an empty rail, a toggleable panel and the widen / shift / push layout engine.

**Architecture:** Main owns everything: a `Catalog` persisted to `servers.json`, a `ServerWindows` registry that hands out per-server slots, and one `ServerWindow` per open made of a full-window shell `WebContentsView` (React, preload) with the game `WebContentsView` placed on top of it inside the content rect. Pure modules (layout, catalog, slots, tabs, windows) run under `node --test`; Electron behaviour is verified by capture mode.

**Tech Stack:** Electron 44, electron-vite 5, React 19, Tailwind 4, TypeScript 7, Node 24 `node --test` with native type stripping.

**Spec:** `docs/superpowers/specs/2026-09-05-server-windows-design.md`

## Global Constraints

- Nothing is injected into a game page: the game view has no preload and no IPC.
- Every view: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
- Game view: `backgroundThrottling: false`.
- Geometry: strip 36px, address row 32px (page tabs only), rail 48px, panel 320px, minimum content 765 x 503.
- Partitions: `persist:server:<id>` for slot 1, `persist:server:<id>:<n>` for slot n ≥ 2; slots are reused after close.
- Catalog file: `<userData>/servers.json`, `{ version: 1, servers: [...] }`; an unreadable file is renamed aside and the defaults written.
- Built-in servers: Zanaris W1 (rev 274, losthq), Lost City W5 (rev 274, losthq), Lost City Labs W1 (revision null, note "May 2005 per Lost City Labs"), Local (rev 289).
- Tests import sibling modules with the `.ts` extension; Node's type stripping needs it. No `enum`, no parameter properties, no `satisfies`.
- Commit after every task with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` as the last line.

---

## File structure

| File | Responsibility |
|---|---|
| `src/shared/layout.ts` | Geometry constants and the `LayoutMode` / `TabKind` types, used by main and the shell |
| `src/shared/catalog.ts` | `ServerDef`, `WikiDef`, `NewServerInput` types |
| `src/shared/ipc.ts` | Channel names, `ShellState`, `CatalogState`, the `ZanarisApi` contract |
| `src/main/layout.ts` | Pure: window rect and view rects from panel state, tab kind and screen |
| `src/main/catalog.ts` | Pure validation and `createServer`; `Catalog` class with file load / save / recover |
| `src/main/slots.ts` | Pure: per-server slot numbers, partition names, window titles |
| `src/main/tabs.ts` | Pure: the pinned game tab and page tabs (open / activate / close) |
| `src/main/windows.ts` | Pure: registry of open server windows over an injected factory |
| `src/main/renderer.ts` | Electron: preload path and "load the renderer as launcher or shell" |
| `src/main/serverWindow.ts` | Electron: one server window (shell view + game view, layout, guards, offline, confirm) |
| `src/main/launcher.ts` | Electron: the launcher window |
| `src/main/menu.ts` | Electron: application menu and shortcuts |
| `src/main/index.ts` | Electron: wiring, IPC handlers, capture mode |
| `src/preload/index.ts` | The `window.zanaris` bridge |
| `src/renderer/main.tsx` | Picks `Launcher` or `Shell` from `?view=` |
| `src/renderer/Launcher.tsx` | Catalog list, open buttons, add form |
| `src/renderer/Shell.tsx` | Tab strip, rail, panel placeholder |

Deleted: `src/main/servers.ts`, `src/main/servers.test.ts`, `src/main/registry.ts`, `src/main/registry.test.ts`, `src/main/gameWindow.ts`, `src/renderer/App.tsx`.

---

### Task 1: Layout engine

**Files:**
- Create: `src/shared/layout.ts`
- Create: `src/main/layout.ts`
- Test: `src/main/layout.test.ts`

**Interfaces:**
- Produces: `computeLayout(input: LayoutInput): LayoutResult`, `splitWindow(width, height, panelOpen, activeTabKind): Rects`, `sideWidth(panelOpen): number`, `Rect`, `Rects`, and the constants `STRIP_HEIGHT`, `ADDRESS_HEIGHT`, `RAIL_WIDTH`, `PANEL_WIDTH`, `MIN_CONTENT_WIDTH`, `MIN_CONTENT_HEIGHT`, types `LayoutMode`, `TabKind`.

- [ ] **Step 1: Write the constants**

```ts
// src/shared/layout.ts
/** Geometry shared by main, which positions views, and the shell, which draws the chrome around them. */
export const STRIP_HEIGHT = 36;
export const ADDRESS_HEIGHT = 32;
export const RAIL_WIDTH = 48;
export const PANEL_WIDTH = 320;
/** The stock client canvas. The content area never drops below it unless the user shrinks the window. */
export const MIN_CONTENT_WIDTH = 765;
export const MIN_CONTENT_HEIGHT = 503;

/** How the panel was accommodated: the window grew, grew and moved left, or the content area gave way. */
export type LayoutMode = 'widen' | 'shift' | 'push';
export type TabKind = 'game' | 'page';
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/main/layout.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, splitWindow, type LayoutInput } from './layout.ts';
import { ADDRESS_HEIGHT, MIN_CONTENT_WIDTH, PANEL_WIDTH, RAIL_WIDTH, STRIP_HEIGHT } from '../shared/layout.ts';

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 };
const base = (over: Partial<LayoutInput> = {}): LayoutInput => ({
    panelOpen: false,
    activeTabKind: 'game',
    window: { x: 100, y: 100, width: 800 + RAIL_WIDTH, height: 700 },
    workArea: WORK_AREA,
    contentWidth: 800,
    canResize: true,
    ...over
});

test('closed: the window is the content width plus the rail', () => {
    const r = computeLayout(base());
    assert.equal(r.mode, 'widen');
    assert.equal(r.window.width, 800 + RAIL_WIDTH);
    assert.equal(r.content.width, 800);
    assert.equal(r.rail.width, RAIL_WIDTH);
    assert.equal(r.panel, null);
});

test('the strip spans the full width and the content starts beneath it', () => {
    const r = computeLayout(base());
    assert.deepEqual(r.strip, { x: 0, y: 0, width: r.window.width, height: STRIP_HEIGHT });
    assert.equal(r.content.y, STRIP_HEIGHT);
    assert.equal(r.content.height, r.window.height - STRIP_HEIGHT);
    assert.equal(r.address, null, 'a game tab has no address row');
});

test('a page tab puts the address row between the strip and the content', () => {
    const r = computeLayout(base({ activeTabKind: 'page' }));
    assert.deepEqual(r.address, { x: 0, y: STRIP_HEIGHT, width: 800, height: ADDRESS_HEIGHT });
    assert.equal(r.content.y, STRIP_HEIGHT + ADDRESS_HEIGHT);
});

test('opening the panel widens the window and leaves the content untouched', () => {
    const closed = computeLayout(base());
    const open = computeLayout(base({ panelOpen: true }));
    assert.equal(open.mode, 'widen');
    assert.deepEqual(open.content, closed.content, 'the game area must not move or resize');
    assert.equal(open.window.width, closed.window.width + PANEL_WIDTH);
    assert.deepEqual(open.panel, { x: 800, y: STRIP_HEIGHT, width: PANEL_WIDTH, height: 700 - STRIP_HEIGHT });
    assert.equal(open.rail.x, 800 + PANEL_WIDTH);
});

test('shifts left instead of growing off the right edge', () => {
    const r = computeLayout(base({ panelOpen: true, window: { x: 1700, y: 0, width: 848, height: 700 } }));
    assert.equal(r.mode, 'shift');
    assert.equal(r.window.x + r.window.width, WORK_AREA.width, 'right edge sits on the work area edge');
    assert.equal(r.content.width, 800, 'content width still preserved');
});

test('clamps to the left edge of a narrow display', () => {
    const narrow = { x: 0, y: 0, width: 1200, height: 800 };
    const r = computeLayout(base({ panelOpen: true, workArea: narrow, window: { x: 600, y: 0, width: 848, height: 700 } }));
    assert.equal(r.mode, 'shift');
    assert.equal(r.window.x, narrow.x, 'never positioned off the left edge');
});

test('falls back to push when the window cannot resize', () => {
    const r = computeLayout(base({ panelOpen: true, canResize: false, window: { x: 0, y: 0, width: 1200, height: 900 } }));
    assert.equal(r.mode, 'push');
    assert.equal(r.window.width, 1200, 'window untouched');
    assert.equal(r.content.width, 1200 - PANEL_WIDTH - RAIL_WIDTH);
    assert.equal(r.panel!.x, r.content.width);
});

test('falls back to push when the panel would not fit on the display', () => {
    const small = { x: 0, y: 0, width: 1000, height: 700 };
    const r = computeLayout(base({ panelOpen: true, workArea: small, window: { x: 0, y: 0, width: 848, height: 700 } }));
    assert.equal(r.mode, 'push', '800 + 368 exceeds a 1000px display');
});

test('push never shrinks the content below the canvas width', () => {
    const r = computeLayout(base({ panelOpen: true, canResize: false, window: { x: 0, y: 0, width: 900, height: 700 } }));
    assert.equal(r.content.width, MIN_CONTENT_WIDTH);
    assert.equal(r.rail.width, RAIL_WIDTH, 'the rail keeps its width');
    assert.equal(r.panel!.width, 900 - MIN_CONTENT_WIDTH - RAIL_WIDTH, 'the panel is what gives way');
});

test('rects tile the width exactly in every mode', () => {
    for (const input of [base(), base({ panelOpen: true }), base({ panelOpen: true, canResize: false }), base({ activeTabKind: 'page', panelOpen: true })]) {
        const r = computeLayout(input);
        const panelW = r.panel?.width ?? 0;
        assert.equal(r.content.x, 0);
        if (r.panel) assert.equal(r.panel.x, r.content.width);
        assert.equal(r.rail.x, r.content.width + panelW, 'rail starts where the panel ends');
        assert.equal(r.rail.x + r.rail.width, r.window.width, 'no gap on the right');
    }
});

test('splitWindow with the panel closed gives the rail whatever the content does not take', () => {
    const r = splitWindow(1000, 700, false, 'game');
    assert.equal(r.content.width, 1000 - RAIL_WIDTH);
    assert.equal(r.panel, null);
    assert.equal(r.rail.width, RAIL_WIDTH);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test src/main/layout.test.ts`
Expected: FAIL with `Cannot find module .../src/main/layout.ts`

- [ ] **Step 4: Write the implementation**

```ts
// src/main/layout.ts
import {
    ADDRESS_HEIGHT,
    MIN_CONTENT_WIDTH,
    PANEL_WIDTH,
    RAIL_WIDTH,
    STRIP_HEIGHT,
    type LayoutMode,
    type TabKind
} from '../shared/layout.ts';

/**
 * Window layout.
 *
 * Opening the panel widens the *window* by the panel width so the content area
 * stays pixel-identical: the game view's bounds never change, which matters
 * because reloading or scaling that view costs the login. Widening is not
 * always possible (maximised, fullscreen, or no room on the display), and then
 * the content area gives way instead. The mode is reported to the UI rather
 * than silently substituted.
 *
 * All rects are CONTENT bounds, relative to the window's content area.
 */

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface LayoutInput {
    panelOpen: boolean;
    activeTabKind: TabKind;
    /** Current window content bounds, in screen coordinates. */
    window: Rect;
    /** Usable area of the display the window is on. */
    workArea: Rect;
    /** The content width to preserve across panel toggles. */
    contentWidth: number;
    /** False when maximised or fullscreen: the window cannot change size. */
    canResize: boolean;
}

export interface Rects {
    strip: Rect;
    /** Only while a page tab is active. */
    address: Rect | null;
    content: Rect;
    /** Only while the panel is open and has room. */
    panel: Rect | null;
    rail: Rect;
}

export interface LayoutResult extends Rects {
    mode: LayoutMode;
    /** Content bounds to apply to the window. */
    window: Rect;
}

export function sideWidth(panelOpen: boolean): number {
    return panelOpen ? PANEL_WIDTH + RAIL_WIDTH : RAIL_WIDTH;
}

/** Splits a window of the given content size into strip, address row, content, panel and rail. */
export function splitWindow(width: number, height: number, panelOpen: boolean, activeTabKind: TabKind): Rects {
    const contentW = Math.max(MIN_CONTENT_WIDTH, width - sideWidth(panelOpen));
    const sideW = Math.max(0, width - contentW);
    const railW = Math.min(RAIL_WIDTH, sideW);
    const panelW = panelOpen ? Math.max(0, sideW - railW) : 0;
    const addressH = activeTabKind === 'page' ? ADDRESS_HEIGHT : 0;
    const top = STRIP_HEIGHT + addressH;
    const below = Math.max(0, height - STRIP_HEIGHT);
    return {
        strip: { x: 0, y: 0, width, height: STRIP_HEIGHT },
        address: addressH > 0 ? { x: 0, y: STRIP_HEIGHT, width: contentW, height: addressH } : null,
        content: { x: 0, y: top, width: contentW, height: Math.max(0, height - top) },
        panel: panelW > 0 ? { x: contentW, y: STRIP_HEIGHT, width: panelW, height: below } : null,
        rail: { x: contentW + panelW, y: STRIP_HEIGHT, width: railW, height: below }
    };
}

export function computeLayout(input: LayoutInput): LayoutResult {
    const desiredWidth = input.contentWidth + sideWidth(input.panelOpen);
    let mode: LayoutMode;
    let window: Rect;

    if (!input.canResize || desiredWidth > input.workArea.width) {
        mode = 'push';
        window = { ...input.window };
    } else {
        // Keep the window on screen: shift left rather than growing off the edge.
        const rightEdge = input.workArea.x + input.workArea.width;
        let x = input.window.x;
        if (x + desiredWidth > rightEdge) x = rightEdge - desiredWidth;
        if (x < input.workArea.x) x = input.workArea.x;
        mode = x === input.window.x ? 'widen' : 'shift';
        window = { x, y: input.window.y, width: desiredWidth, height: input.window.height };
    }

    return { mode, window, ...splitWindow(window.width, window.height, input.panelOpen, input.activeTabKind) };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test src/main/layout.test.ts`
Expected: 11 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add src/shared/layout.ts src/main/layout.ts src/main/layout.test.ts
git commit -m "feat: layout engine with widen, shift and push"
```

---

### Task 2: Catalog validation and defaults

**Files:**
- Create: `src/shared/catalog.ts`
- Create: `src/main/catalog.ts` (pure half)
- Test: `src/main/catalog.test.ts`
- Delete: `src/main/servers.ts`, `src/main/servers.test.ts`

**Interfaces:**
- Produces: `ServerDef`, `WikiDef`, `NewServerInput` (shared); `DEFAULT_SERVERS`, `parseServerUrl(input): ParsedUrl`, `originOf(url)`, `hostOf(url)`, `slugify(name)`, `uniqueId(base, taken)`, `createServer(input, existing): CreateResult`, `isServerDef(x): x is ServerDef`.

- [ ] **Step 1: Write the shared types**

```ts
// src/shared/catalog.ts
/** A wiki the server's page tabs may browse. */
export interface WikiDef {
    home: string;
    /** Search URL with `{query}` in it, or null when the site has no known search endpoint. */
    search: string | null;
}

/** One entry in the server catalog. `id` names windows, partitions and screenshot folders. */
export interface ServerDef {
    id: string;
    name: string;
    /** The game page. */
    url: string;
    /** Null when the server does not say. */
    revision: number | null;
    wiki: WikiDef | null;
    /** A URL the map tool opens as a page tab. */
    map: string | null;
    /** Hosts page tabs may visit. Always includes the game host and the wiki host. */
    hosts: string[];
    /** Free text shown in the launcher. */
    notes: string | null;
}

/** What the launcher's add form collects. */
export interface NewServerInput {
    name: string;
    url: string;
    revision: number | null;
    wikiHome: string | null;
    notes: string | null;
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/main/catalog.test.ts
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    DEFAULT_SERVERS,
    parseServerUrl,
    originOf,
    hostOf,
    slugify,
    uniqueId,
    createServer,
    isServerDef,
    Catalog
} from './catalog.ts';
import type { NewServerInput } from '../shared/catalog.ts';

const input = (over: Partial<NewServerInput> = {}): NewServerInput => ({
    name: 'My Server',
    url: 'https://play.example.com/rs2.cgi?lowmem=1',
    revision: 274,
    wikiHome: null,
    notes: null,
    ...over
});

test('the built-in list has the four servers with the settled revisions', () => {
    const byId = Object.fromEntries(DEFAULT_SERVERS.map(s => [s.id, s]));
    assert.equal(byId['zanaris-w1']!.revision, 274);
    assert.equal(byId['lostcity-w5']!.revision, 274);
    assert.equal(byId['lostcitylabs-w1']!.revision, null);
    assert.equal(byId['lostcitylabs-w1']!.notes, 'May 2005 per Lost City Labs');
    assert.equal(byId['local']!.revision, 289);
    assert.equal(byId['zanaris-w1']!.wiki?.home, 'https://2004.losthq.rs/');
    assert.equal(byId['lostcity-w5']!.wiki?.home, 'https://2004.losthq.rs/');
    assert.equal(byId['lostcitylabs-w1']!.wiki, null);
});

test('every built-in entry validates and lists its own game host', () => {
    const ids = DEFAULT_SERVERS.map(s => s.id);
    assert.equal(new Set(ids).size, ids.length, 'ids are unique');
    for (const server of DEFAULT_SERVERS) {
        assert.ok(isServerDef(server), `${server.id} must validate`);
        assert.ok(server.hosts.includes(hostOf(server.url)), `${server.id} must allow its own host`);
        if (server.wiki) assert.ok(server.hosts.includes(hostOf(server.wiki.home)), `${server.id} must allow its wiki host`);
    }
});

test('parseServerUrl accepts https as-is, assumes https without a scheme, and trims', () => {
    assert.deepEqual(parseServerUrl('https://a.example/rs2.cgi?x=1'), { ok: true, url: 'https://a.example/rs2.cgi?x=1' });
    assert.deepEqual(parseServerUrl('w1.04.zanaris.rs/rs2.cgi?lowmem=1'), { ok: true, url: 'https://w1.04.zanaris.rs/rs2.cgi?lowmem=1' });
    assert.deepEqual(parseServerUrl('  http://127.0.0.1:8888/rs2.cgi \n'), { ok: true, url: 'http://127.0.0.1:8888/rs2.cgi' });
});

test('parseServerUrl rejects non-web schemes, empty input and garbage', () => {
    for (const bad of ['javascript:alert(1)', 'ftp://x.example/', 'file:///etc/passwd', 'about:blank', '', '   ', 'not a url', 'https://']) {
        const r = parseServerUrl(bad);
        assert.equal(r.ok, false, `${JSON.stringify(bad)} must be rejected`);
    }
});

test('originOf and hostOf', () => {
    assert.equal(originOf('https://w5-2004.lostcity.rs/rs2.cgi?plugin=0'), 'https://w5-2004.lostcity.rs');
    assert.equal(hostOf('http://127.0.0.1:8888/rs2.cgi'), '127.0.0.1:8888');
});

test('slugify and uniqueId', () => {
    assert.equal(slugify('Zanaris — World 1'), 'zanaris-world-1');
    assert.equal(slugify('   '), 'server');
    assert.equal(uniqueId('x', new Set()), 'x');
    assert.equal(uniqueId('x', new Set(['x'])), 'x-2');
    assert.equal(uniqueId('x', new Set(['x', 'x-2'])), 'x-3');
});

test('createServer builds a valid entry from the form', () => {
    const r = createServer(input(), []);
    assert.ok(r.ok);
    assert.equal(r.server.id, 'my-server');
    assert.equal(r.server.name, 'My Server');
    assert.equal(r.server.revision, 274);
    assert.equal(r.server.wiki, null);
    assert.deepEqual(r.server.hosts, ['play.example.com']);
    assert.equal(r.server.map, null);
    assert.equal(r.server.notes, null);
    assert.ok(isServerDef(r.server));
});

test('createServer adds the wiki host and leaves search unknown', () => {
    const r = createServer(input({ wikiHome: '2004.losthq.rs' }), []);
    assert.ok(r.ok);
    assert.deepEqual(r.server.wiki, { home: 'https://2004.losthq.rs/', search: null });
    assert.deepEqual(r.server.hosts, ['play.example.com', '2004.losthq.rs']);
});

test('createServer keeps ids unique and trims notes', () => {
    const first = createServer(input(), []);
    assert.ok(first.ok);
    const second = createServer(input({ notes: '  May 2005  ' }), [first.server]);
    assert.ok(second.ok);
    assert.equal(second.server.id, 'my-server-2');
    assert.equal(second.server.notes, 'May 2005');
});

test('createServer rejects bad input with a reason', () => {
    for (const bad of [input({ name: ' ' }), input({ url: 'javascript:1' }), input({ revision: 0 }), input({ revision: 1.5 }), input({ wikiHome: 'ftp://x.example/' })]) {
        const r = createServer(bad, []);
        assert.equal(r.ok, false);
        if (!r.ok) assert.ok(r.error.length > 0);
    }
});

test('isServerDef rejects junk', () => {
    for (const bad of [null, 1, {}, { id: 'a', name: 'b', url: 'x' }, { ...DEFAULT_SERVERS[0], revision: 'x' }, { ...DEFAULT_SERVERS[0], hosts: 'nope' }]) {
        assert.equal(isServerDef(bad), false);
    }
});

// ── the file ──────────────────────────────────────────────────────────────

const dirs: string[] = [];
const tempFile = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'zanaris-kit-catalog-'));
    dirs.push(dir);
    return join(dir, 'servers.json');
};
afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('load writes the defaults when there is no file', () => {
    const file = tempFile();
    const catalog = new Catalog(file);
    catalog.load();
    assert.equal(catalog.recovered, false);
    assert.deepEqual(catalog.list().map(s => s.id), DEFAULT_SERVERS.map(s => s.id));
    assert.ok(existsSync(file));
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 1);
});

test('add persists and a fresh load sees it', () => {
    const file = tempFile();
    const a = new Catalog(file);
    a.load();
    const r = a.add(input());
    assert.ok(r.ok);
    const b = new Catalog(file);
    b.load();
    assert.ok(b.get('my-server'));
    assert.equal(b.list().length, DEFAULT_SERVERS.length + 1);
});

test('remove persists and reports unknown ids', () => {
    const file = tempFile();
    const a = new Catalog(file);
    a.load();
    assert.equal(a.remove('local'), true);
    assert.equal(a.remove('local'), false);
    const b = new Catalog(file);
    b.load();
    assert.equal(b.get('local'), undefined);
});

test('an unreadable file is renamed aside and the defaults restored', () => {
    const file = tempFile();
    writeFileSync(file, '{ not json');
    const catalog = new Catalog(file);
    catalog.load();
    assert.equal(catalog.recovered, true);
    assert.deepEqual(catalog.list().map(s => s.id), DEFAULT_SERVERS.map(s => s.id));
    const names = readdirSync(join(file, '..'));
    assert.ok(names.some(n => n.startsWith('servers.json.broken-')), `kept the broken file: ${names}`);
});

test('a file with an invalid or duplicated entry counts as unreadable', () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ version: 1, servers: [DEFAULT_SERVERS[0], DEFAULT_SERVERS[0]] }));
    const catalog = new Catalog(file);
    catalog.load();
    assert.equal(catalog.recovered, true);
});

test('list returns copies', () => {
    const catalog = new Catalog(tempFile());
    catalog.load();
    catalog.list()[0]!.hosts.push('evil.example');
    assert.equal(catalog.list()[0]!.hosts.includes('evil.example'), false);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test src/main/catalog.test.ts`
Expected: FAIL with `Cannot find module .../src/main/catalog.ts`

- [ ] **Step 4: Write the implementation (both halves; Task 3 only adds tests for the file half)**

```ts
// src/main/catalog.ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NewServerInput, ServerDef, WikiDef } from '../shared/catalog.ts';

/** LostHQ has no discoverable search endpoint (its index.php?search= returns the homepage). */
const LOSTHQ: WikiDef = { home: 'https://2004.losthq.rs/', search: null };

export const DEFAULT_SERVERS: readonly ServerDef[] = [
    {
        id: 'zanaris-w1',
        name: 'Zanaris — World 1',
        url: 'https://w1.04.zanaris.rs/rs2.cgi?lowmem=1',
        revision: 274,
        wiki: LOSTHQ,
        map: null,
        hosts: ['w1.04.zanaris.rs', '2004.losthq.rs'],
        notes: null
    },
    {
        id: 'lostcity-w5',
        name: 'Lost City — World 5',
        url: 'https://w5-2004.lostcity.rs/rs2.cgi?plugin=0&world=5&lowmem=1',
        revision: 274,
        wiki: LOSTHQ,
        map: null,
        hosts: ['w5-2004.lostcity.rs', '2004.losthq.rs'],
        notes: null
    },
    {
        id: 'lostcitylabs-w1',
        name: 'Lost City Labs — World 1',
        url: 'https://www.lostcitylabs.com/play/world-1/',
        revision: null,
        wiki: null,
        map: null,
        hosts: ['www.lostcitylabs.com'],
        notes: 'May 2005 per Lost City Labs'
    },
    {
        id: 'local',
        name: 'Local server',
        url: 'http://127.0.0.1:8888/rs2.cgi?lowmem=1',
        revision: 289,
        wiki: null,
        map: null,
        hosts: ['127.0.0.1:8888'],
        notes: null
    }
];

export type ParsedUrl = { ok: true; url: string } | { ok: false; error: string };

/**
 * Normalises a typed address into an absolute http(s) URL. A missing scheme is
 * read as https; anything that is not a web URL is rejected so a view can never
 * be pointed at file: or javascript: content.
 */
export function parseServerUrl(input: string): ParsedUrl {
    const text = input.trim();
    if (!text) return { ok: false, error: 'Enter an address.' };

    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text);
    let url: URL;
    try {
        url = new URL(hasScheme ? text : `https://${text}`);
    } catch {
        return { ok: false, error: `Not a valid address: ${text}` };
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, error: `Only http and https are supported, not ${url.protocol.slice(0, -1)}.` };
    }
    if (!url.hostname) return { ok: false, error: 'The address needs a host name.' };
    return { ok: true, url: url.href };
}

export function originOf(url: string): string {
    return new URL(url).origin;
}

export function hostOf(url: string): string {
    return new URL(url).host;
}

export function slugify(name: string): string {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || 'server';
}

export function uniqueId(base: string, taken: ReadonlySet<string>): string {
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) {
        const id = `${base}-${n}`;
        if (!taken.has(id)) return id;
    }
}

export type CreateResult = { ok: true; server: ServerDef } | { ok: false; error: string };

/** Turns the add form into a catalog entry, or says what is wrong with it. */
export function createServer(input: NewServerInput, existing: readonly ServerDef[]): CreateResult {
    const name = input.name.trim();
    if (!name) return { ok: false, error: 'Enter a name.' };

    const url = parseServerUrl(input.url);
    if (!url.ok) return url;

    if (input.revision !== null && (!Number.isInteger(input.revision) || input.revision <= 0)) {
        return { ok: false, error: 'Revision must be a whole number, or left blank.' };
    }

    let wiki: WikiDef | null = null;
    if (input.wikiHome !== null && input.wikiHome.trim() !== '') {
        const home = parseServerUrl(input.wikiHome);
        if (!home.ok) return { ok: false, error: `Wiki address: ${home.error}` };
        wiki = { home: home.url, search: null };
    }

    const hosts = [...new Set([hostOf(url.url), ...(wiki ? [hostOf(wiki.home)] : [])])];
    const id = uniqueId(slugify(name), new Set(existing.map(s => s.id)));
    const notes = input.notes && input.notes.trim() ? input.notes.trim() : null;

    return { ok: true, server: { id, name, url: url.url, revision: input.revision, wiki, map: null, hosts, notes } };
}

const isString = (x: unknown): x is string => typeof x === 'string';
const isNullableString = (x: unknown): x is string | null => x === null || typeof x === 'string';

export function isServerDef(x: unknown): x is ServerDef {
    if (typeof x !== 'object' || x === null) return false;
    const s = x as Record<string, unknown>;
    if (!isString(s.id) || s.id === '' || !isString(s.name) || !isString(s.url)) return false;
    if (!parseServerUrl(s.url).ok) return false;
    if (s.revision !== null && !(typeof s.revision === 'number' && Number.isInteger(s.revision) && s.revision > 0)) return false;
    if (s.wiki !== null) {
        if (typeof s.wiki !== 'object' || s.wiki === null) return false;
        const w = s.wiki as Record<string, unknown>;
        if (!isString(w.home) || !isNullableString(w.search)) return false;
    }
    if (!isNullableString(s.map) || !isNullableString(s.notes)) return false;
    if (!Array.isArray(s.hosts) || !s.hosts.every(isString)) return false;
    return true;
}

interface CatalogFile {
    version: 1;
    servers: ServerDef[];
}

/**
 * The server list on disk. Loading never fails: a missing file gets the
 * defaults, and a file that cannot be used is renamed aside (kept, not lost)
 * and replaced with the defaults, with `recovered` set so the launcher can say
 * so.
 */
export class Catalog {
    readonly file: string;
    /** True when the file on disk could not be used and the defaults were written in its place. */
    recovered = false;
    private servers: ServerDef[] = [];

    constructor(file: string) {
        this.file = file;
    }

    load(): void {
        if (!existsSync(this.file)) {
            this.servers = DEFAULT_SERVERS.map(copy);
            this.save();
            return;
        }
        try {
            const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<CatalogFile> | null;
            const servers = parsed?.servers;
            if (!Array.isArray(servers) || !servers.every(isServerDef)) throw new Error('not a catalog');
            if (new Set(servers.map(s => s.id)).size !== servers.length) throw new Error('duplicate ids');
            this.servers = servers.map(copy);
        } catch {
            renameSync(this.file, `${this.file}.broken-${Date.now()}`);
            this.servers = DEFAULT_SERVERS.map(copy);
            this.recovered = true;
            this.save();
        }
    }

    list(): ServerDef[] {
        return this.servers.map(copy);
    }

    get(id: string): ServerDef | undefined {
        const found = this.servers.find(s => s.id === id);
        return found ? copy(found) : undefined;
    }

    add(input: NewServerInput): CreateResult {
        const result = createServer(input, this.servers);
        if (result.ok) {
            this.servers.push(result.server);
            this.save();
        }
        return result;
    }

    remove(id: string): boolean {
        const index = this.servers.findIndex(s => s.id === id);
        if (index < 0) return false;
        this.servers.splice(index, 1);
        this.save();
        return true;
    }

    private save(): void {
        mkdirSync(dirname(this.file), { recursive: true });
        const data: CatalogFile = { version: 1, servers: this.servers };
        writeFileSync(this.file, `${JSON.stringify(data, null, 2)}\n`);
    }
}

function copy(s: ServerDef): ServerDef {
    return { ...s, hosts: [...s.hosts], wiki: s.wiki ? { ...s.wiki } : null };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test src/main/catalog.test.ts`
Expected: 18 pass, 0 fail.

- [ ] **Step 6: Delete the superseded module and commit**

```bash
git rm -q src/main/servers.ts src/main/servers.test.ts
git add src/shared/catalog.ts src/main/catalog.ts src/main/catalog.test.ts
git commit -m "feat: server catalog with validation and a recoverable file"
```

(`registry.ts` and `gameWindow.ts` still import `servers.ts`; they go in Tasks 4 and 6. `npm test` will not be green again until Task 4 removes `registry.test.ts`.)

---

### Task 3: Slots

**Files:**
- Create: `src/main/slots.ts`
- Test: `src/main/slots.test.ts`

**Interfaces:**
- Produces: `class SlotAllocator { acquire(serverId): number; release(serverId, slot): void; count(serverId): number }`, `partitionFor(serverId, slot): string`, `windowTitle(name, slot): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/slots.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlotAllocator, partitionFor, windowTitle } from './slots.ts';

test('the first instance of a server gets slot 1, the next gets 2', () => {
    const slots = new SlotAllocator();
    assert.equal(slots.acquire('a'), 1);
    assert.equal(slots.acquire('a'), 2);
    assert.equal(slots.count('a'), 2);
});

test('servers do not share slots', () => {
    const slots = new SlotAllocator();
    slots.acquire('a');
    assert.equal(slots.acquire('b'), 1);
    assert.equal(slots.count('b'), 1);
});

test('a released slot is reused before a new one is handed out', () => {
    const slots = new SlotAllocator();
    slots.acquire('a');
    slots.acquire('a');
    slots.release('a', 1);
    assert.equal(slots.count('a'), 1);
    assert.equal(slots.acquire('a'), 1, 'the gap is filled first');
    assert.equal(slots.acquire('a'), 3);
});

test('releasing an unknown slot is harmless', () => {
    const slots = new SlotAllocator();
    slots.release('a', 4);
    assert.equal(slots.count('a'), 0);
});

test('slot 1 keeps the plain partition name; later slots are suffixed', () => {
    assert.equal(partitionFor('zanaris-w1', 1), 'persist:server:zanaris-w1');
    assert.equal(partitionFor('zanaris-w1', 2), 'persist:server:zanaris-w1:2');
    assert.equal(partitionFor('odd id!', 1), 'persist:server:odd-id-', 'partition names are sanitised');
});

test('window titles number the later instances only', () => {
    assert.equal(windowTitle('Zanaris — World 1', 1), 'Zanaris — World 1');
    assert.equal(windowTitle('Zanaris — World 1', 2), 'Zanaris — World 1 (2)');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/main/slots.test.ts`
Expected: FAIL with `Cannot find module .../src/main/slots.ts`

- [ ] **Step 3: Write the implementation**

```ts
// src/main/slots.ts
/**
 * Concurrent instances of one server are numbered from 1. The number picks the
 * storage partition, so two accounts on one server never share cookies or
 * client prefs, and it is reused once a window closes so partitions (and their
 * asset caches) are not created without bound.
 */
export class SlotAllocator {
    private readonly used = new Map<string, Set<number>>();

    acquire(serverId: string): number {
        const set = this.used.get(serverId) ?? new Set<number>();
        let slot = 1;
        while (set.has(slot)) slot += 1;
        set.add(slot);
        this.used.set(serverId, set);
        return slot;
    }

    release(serverId: string, slot: number): void {
        const set = this.used.get(serverId);
        if (!set) return;
        set.delete(slot);
        if (set.size === 0) this.used.delete(serverId);
    }

    count(serverId: string): number {
        return this.used.get(serverId)?.size ?? 0;
    }
}

/** Slot 1 keeps the name the launcher-only build used, so existing caches carry over. */
export function partitionFor(serverId: string, slot: number): string {
    const safe = serverId.replace(/[^a-z0-9._-]+/gi, '-');
    return slot === 1 ? `persist:server:${safe}` : `persist:server:${safe}:${slot}`;
}

export function windowTitle(name: string, slot: number): string {
    return slot === 1 ? name : `${name} (${slot})`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/main/slots.test.ts`
Expected: 6 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/main/slots.ts src/main/slots.test.ts
git commit -m "feat: per-server slots, partitions and titles"
```

---

### Task 4: Window registry

**Files:**
- Create: `src/main/windows.ts`
- Test: `src/main/windows.test.ts`
- Delete: `src/main/registry.ts`, `src/main/registry.test.ts`

**Interfaces:**
- Consumes: `ServerDef` (Task 2), `SlotAllocator`, `partitionFor`, `windowTitle` (Task 3).
- Produces: `ServerWindowHandle { focus(); close() }`, `WindowSpec { id; server; slot; title; partition }`, `ServerWindowFactory`, `OpenWindow { id; serverId; slot; title }`, `class ServerWindows { open(server): OpenWindow; list(): OpenWindow[]; countFor(serverId): number; get(id): ServerWindowHandle | undefined; closeAll(): void }`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/windows.test.ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/main/windows.test.ts`
Expected: FAIL with `Cannot find module .../src/main/windows.ts`

- [ ] **Step 3: Write the implementation**

```ts
// src/main/windows.ts
import type { ServerDef } from '../shared/catalog.ts';
import { SlotAllocator, partitionFor, windowTitle } from './slots.ts';

/** The little the registry needs from a window: enough to focus or close it. */
export interface ServerWindowHandle {
    focus(): void;
    close(): void;
}

/** Everything a window needs to know about itself at creation. It never changes. */
export interface WindowSpec {
    id: number;
    server: ServerDef;
    slot: number;
    title: string;
    partition: string;
}

/** Creates the window. Must call `onClosed` once, when the window is gone. */
export type ServerWindowFactory = (spec: WindowSpec, onClosed: () => void) => ServerWindowHandle;

export interface OpenWindow {
    id: number;
    serverId: string;
    slot: number;
    title: string;
}

/**
 * Which server windows exist. Pure bookkeeping over an injected factory, so it
 * is tested without Electron. Every open makes a new window; the same server
 * can be open any number of times, each in its own slot.
 */
export class ServerWindows {
    private readonly open_ = new Map<number, { spec: WindowSpec; handle: ServerWindowHandle }>();
    private readonly slots = new SlotAllocator();
    private nextId = 1;
    private readonly factory: ServerWindowFactory;
    private readonly onChange: () => void;

    constructor(factory: ServerWindowFactory, onChange: () => void = () => {}) {
        this.factory = factory;
        this.onChange = onChange;
    }

    open(server: ServerDef): OpenWindow {
        const slot = this.slots.acquire(server.id);
        const spec: WindowSpec = {
            id: this.nextId++,
            server,
            slot,
            title: windowTitle(server.name, slot),
            partition: partitionFor(server.id, slot)
        };
        const handle = this.factory(spec, () => {
            if (!this.open_.delete(spec.id)) return;
            this.slots.release(server.id, slot);
            this.onChange();
        });
        this.open_.set(spec.id, { spec, handle });
        this.onChange();
        return describe(spec);
    }

    list(): OpenWindow[] {
        return [...this.open_.values()].map(entry => describe(entry.spec));
    }

    countFor(serverId: string): number {
        return this.slots.count(serverId);
    }

    get(id: number): ServerWindowHandle | undefined {
        return this.open_.get(id)?.handle;
    }

    closeAll(): void {
        for (const entry of [...this.open_.values()]) entry.handle.close();
    }
}

function describe(spec: WindowSpec): OpenWindow {
    return { id: spec.id, serverId: spec.server.id, slot: spec.slot, title: spec.title };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/main/windows.test.ts`
Expected: 7 pass, 0 fail.

- [ ] **Step 5: Delete the old registry and confirm the suite is green**

```bash
git rm -q src/main/registry.ts src/main/registry.test.ts
npm test
```
Expected: every test file passes (layout 11, catalog 18, slots 6, windows 7).

- [ ] **Step 6: Commit**

```bash
git add src/main/windows.ts src/main/windows.test.ts
git commit -m "feat: window registry with per-server slots"
```

---

### Task 5: Tab model

**Files:**
- Create: `src/main/tabs.ts`
- Test: `src/main/tabs.test.ts`

**Interfaces:**
- Consumes: `TabKind` (Task 1).
- Produces: `GAME_TAB_ID = 'game'`, `Tab { id; kind; title; url }`, `class TabModel { constructor(game: { title; url }); list(): Tab[]; get active(): Tab; open(page: { title; url }): Tab; activate(id): boolean; close(id): 'closed' | 'pinned' | 'unknown'; setTitle(id, title): boolean }`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/tabs.test.ts
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

test('list returns copies', () => {
    const tabs = model();
    tabs.list()[0]!.title = 'changed';
    assert.equal(tabs.list()[0]!.title, 'Zanaris — World 1');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/main/tabs.test.ts`
Expected: FAIL with `Cannot find module .../src/main/tabs.ts`

- [ ] **Step 3: Write the implementation**

```ts
// src/main/tabs.ts
import type { TabKind } from '../shared/layout.ts';

export interface Tab {
    id: string;
    kind: TabKind;
    title: string;
    url: string;
}

export const GAME_TAB_ID = 'game';

/**
 * The tab strip's model. The game tab is created with the window, sits first,
 * and cannot be closed or moved. Page tabs come after it. Closing the active
 * tab activates the one to its left, which is always there because the game
 * tab is.
 */
export class TabModel {
    private readonly tabs: Tab[];
    private activeId: string = GAME_TAB_ID;
    private nextPage = 1;

    constructor(game: { title: string; url: string }) {
        this.tabs = [{ id: GAME_TAB_ID, kind: 'game', title: game.title, url: game.url }];
    }

    list(): Tab[] {
        return this.tabs.map(t => ({ ...t }));
    }

    get active(): Tab {
        const tab = this.tabs.find(t => t.id === this.activeId) ?? this.tabs[0]!;
        return { ...tab };
    }

    open(page: { title: string; url: string }): Tab {
        const tab: Tab = { id: `page-${this.nextPage++}`, kind: 'page', title: page.title, url: page.url };
        this.tabs.push(tab);
        this.activeId = tab.id;
        return { ...tab };
    }

    activate(id: string): boolean {
        if (!this.tabs.some(t => t.id === id)) return false;
        this.activeId = id;
        return true;
    }

    close(id: string): 'closed' | 'pinned' | 'unknown' {
        if (id === GAME_TAB_ID) return 'pinned';
        const index = this.tabs.findIndex(t => t.id === id);
        if (index < 0) return 'unknown';
        this.tabs.splice(index, 1);
        if (this.activeId === id) this.activeId = this.tabs[index - 1]!.id;
        return 'closed';
    }

    setTitle(id: string, title: string): boolean {
        const tab = this.tabs.find(t => t.id === id);
        if (!tab) return false;
        tab.title = title;
        return true;
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/main/tabs.test.ts`
Expected: 9 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/main/tabs.ts src/main/tabs.test.ts
git commit -m "feat: tab model with a pinned game tab"
```

---

### Task 6: IPC contract, preload and renderer routing

**Files:**
- Rewrite: `src/shared/ipc.ts`
- Rewrite: `src/preload/index.ts`
- Rewrite: `src/renderer/main.tsx`
- Create: `src/renderer/Launcher.tsx` (stub), `src/renderer/Shell.tsx` (stub)
- Delete: `src/renderer/App.tsx`

**Interfaces:**
- Consumes: `ServerDef`, `NewServerInput` (Task 2); `LayoutMode`, `TabKind` (Task 1); `Rects` (Task 1).
- Produces: `IPC` channel names, `ServerInfo`, `CatalogState`, `TabInfo`, `ShellState`, `Result`, `ZanarisApi`; `window.zanaris.launcher.*` and `window.zanaris.shell.*`.

No unit test: the check is `npm run typecheck`.

- [ ] **Step 1: Write the contract**

```ts
// src/shared/ipc.ts
/** Channel names and payload types, shared by main, preload and the renderer so they can't drift. */
import type { NewServerInput, ServerDef } from './catalog';
import type { LayoutMode, TabKind } from './layout';

export const IPC = {
    catalogState: 'zanaris:catalog-state',
    catalogGet: 'zanaris:catalog-get',
    catalogAdd: 'zanaris:catalog-add',
    catalogRemove: 'zanaris:catalog-remove',
    windowOpen: 'zanaris:window-open',
    launcherShow: 'zanaris:launcher-show',
    shellState: 'zanaris:shell-state',
    shellGet: 'zanaris:shell-get',
    shellTogglePanel: 'zanaris:shell-toggle-panel'
} as const;

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ServerInfo extends ServerDef {
    /** How many windows of this server are open right now. */
    openCount: number;
}

export interface CatalogState {
    servers: ServerInfo[];
    /** True when servers.json could not be read and the defaults were restored. */
    recovered: boolean;
}

export interface TabInfo {
    id: string;
    kind: TabKind;
    title: string;
    url: string;
    active: boolean;
}

export interface ShellState {
    windowId: number;
    server: ServerDef;
    slot: number;
    title: string;
    tabs: TabInfo[];
    panelOpen: boolean;
    mode: LayoutMode;
    /** Where main placed things, relative to the window's content area, so the shell draws exactly there. */
    rects: {
        strip: Rect;
        address: Rect | null;
        content: Rect;
        panel: Rect | null;
        rail: Rect;
    };
}

export type Result = { ok: true } | { ok: false; error: string };

export interface ZanarisApi {
    launcher: {
        get(): Promise<CatalogState>;
        /** Adds the server and opens a window for it. */
        add(input: NewServerInput): Promise<Result>;
        /** Refused while the server has open windows. */
        remove(id: string): Promise<Result>;
        /** Opens a new window for the server, every time. */
        open(serverId: string): Promise<Result>;
        onState(cb: (state: CatalogState) => void): () => void;
    };
    shell: {
        /** Null when the calling view is not a server window's shell. */
        get(): Promise<ShellState | null>;
        togglePanel(): Promise<void>;
        /** Shows the launcher. */
        newWindow(): Promise<void>;
        onState(cb: (state: ShellState) => void): () => void;
    };
}
```

- [ ] **Step 2: Write the preload**

```ts
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type CatalogState, type ShellState, type ZanarisApi } from '../shared/ipc';

/**
 * The only bridge between a renderer and main. Deliberately narrow: no raw
 * ipcRenderer, no channel names, no send passthrough. Every push returns an
 * unsubscribe closure so React effects can clean up.
 *
 * Game views get no preload at all. This file is never loaded into them.
 */
function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
    const handler = (_event: unknown, value: T): void => cb(value);
    ipcRenderer.on(channel, handler);
    return () => {
        ipcRenderer.off(channel, handler);
    };
}

const api: ZanarisApi = {
    launcher: {
        get: () => ipcRenderer.invoke(IPC.catalogGet),
        add: input => ipcRenderer.invoke(IPC.catalogAdd, input),
        remove: id => ipcRenderer.invoke(IPC.catalogRemove, id),
        open: serverId => ipcRenderer.invoke(IPC.windowOpen, serverId),
        onState: cb => subscribe<CatalogState>(IPC.catalogState, cb)
    },
    shell: {
        get: () => ipcRenderer.invoke(IPC.shellGet),
        togglePanel: () => ipcRenderer.invoke(IPC.shellTogglePanel),
        newWindow: () => ipcRenderer.invoke(IPC.launcherShow),
        onState: cb => subscribe<ShellState>(IPC.shellState, cb)
    }
};

contextBridge.exposeInMainWorld('zanaris', api);
```

- [ ] **Step 3: Route the renderer and stub both views**

```tsx
// src/renderer/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Launcher from './Launcher';
import Shell from './Shell';
import './styles.css';

/** Main loads the same bundle as `?view=launcher` or `?view=shell`. */
const view = new URLSearchParams(location.search).get('view');

createRoot(document.getElementById('root')!).render(<StrictMode>{view === 'shell' ? <Shell /> : <Launcher />}</StrictMode>);
```

```tsx
// src/renderer/Launcher.tsx
import type { ReactNode } from 'react';

export default function Launcher(): ReactNode {
    return <div className="p-4 text-dim">Launcher</div>;
}
```

```tsx
// src/renderer/Shell.tsx
import type { ReactNode } from 'react';

export default function Shell(): ReactNode {
    return <div className="p-4 text-dim">Shell</div>;
}
```

- [ ] **Step 4: Typecheck**

```bash
git rm -q src/renderer/App.tsx
npm run typecheck
```
Expected: errors only in `src/main/index.ts` and `src/main/gameWindow.ts` (they still reference the old API); none in `shared/`, `preload/`, `renderer/`. Those two files are rewritten in Tasks 7 and 8.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/renderer/main.tsx src/renderer/Launcher.tsx src/renderer/Shell.tsx
git commit -m "feat: IPC contract for launcher and shell"
```

---

### Task 7: The server window and its shell

**Files:**
- Create: `src/main/renderer.ts`
- Create: `src/main/serverWindow.ts`
- Rewrite: `src/renderer/Shell.tsx`
- Modify: `src/renderer/styles.css` (add one rule)
- Delete: `src/main/gameWindow.ts`

**Interfaces:**
- Consumes: `computeLayout`, `sideWidth` (Task 1); `originOf` (Task 2); `TabModel` (Task 5); `WindowSpec`, `ServerWindowHandle` (Task 4); `IPC`, `ShellState` (Task 6).
- Produces: `preloadPath()`, `loadRenderer(contents, 'shell' | 'launcher')`; `ServerWindowDeps { log; confirmClose(title): boolean; position }`; `ServerWindow extends ServerWindowHandle { id; window; shellContentsId; togglePanel(); state(): ShellState; whenGameLoaded(): Promise<'loaded' | 'failed'>; captureViews(): Promise<{ shell: NativeImage; game: NativeImage }> }`; `createServerWindow(spec, onClosed, deps): ServerWindow`.

No unit test: verified by capture mode in Task 8.

- [ ] **Step 1: The renderer helper**

```ts
// src/main/renderer.ts
import { join } from 'node:path';
import type { WebContents } from 'electron';

const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL;

export function preloadPath(): string {
    return join(__dirname, '../preload/index.js');
}

/** One renderer bundle serves both windows; `?view=` picks which React tree mounts. */
export function loadRenderer(contents: WebContents, view: 'shell' | 'launcher'): void {
    if (RENDERER_DEV_URL) void contents.loadURL(`${RENDERER_DEV_URL}?view=${view}`);
    else void contents.loadFile(join(__dirname, '../renderer/index.html'), { query: { view } });
}
```

- [ ] **Step 2: The server window**

```ts
// src/main/serverWindow.ts
import { BrowserWindow, WebContentsView, screen, shell, type NativeImage } from 'electron';
import { join } from 'node:path';
import { IPC, type ShellState } from '../shared/ipc';
import { MIN_CONTENT_HEIGHT, MIN_CONTENT_WIDTH, RAIL_WIDTH, STRIP_HEIGHT, type LayoutMode } from '../shared/layout';
import { computeLayout, sideWidth, splitWindow, type Rects } from './layout';
import { originOf } from './catalog';
import { TabModel } from './tabs';
import { loadRenderer, preloadPath } from './renderer';
import type { ServerWindowHandle, WindowSpec } from './windows';

const OFFLINE_PAGE = join(__dirname, '../../static/offline.html');
/** The content area a new window opens with: the canvas plus the page's controls strip. */
const DEFAULT_CONTENT = { width: 800, height: 640 };

export interface ServerWindowDeps {
    log: (msg: string) => void;
    /** Return false to keep the window open. Main returns true without asking while quitting. */
    confirmClose: (title: string) => boolean;
    position: { x: number; y: number } | null;
}

export interface ServerWindow extends ServerWindowHandle {
    readonly id: number;
    readonly window: BrowserWindow;
    /** The shell view's webContents id, so IPC handlers can find the window from `event.sender`. */
    readonly shellContentsId: number;
    togglePanel(): void;
    state(): ShellState;
    /** Resolves when the game page finished loading, or failed over to the offline page. */
    whenGameLoaded(): Promise<'loaded' | 'failed'>;
    /** Page content of each view, for capture mode. A window's own webContents holds nothing. */
    captureViews(): Promise<{ shell: NativeImage; game: NativeImage }>;
}

/**
 * One server window: a full-window shell view (React, preload) with the game
 * view placed on top of it inside the content rect. Main owns all geometry;
 * the shell only draws where main says things are.
 *
 * The game view has no preload and no IPC. Its page is byte-for-byte what the
 * server served. `backgroundThrottling: false` keeps its setTimeout-driven loop
 * at full rate while another window or tab is in front.
 */
export function createServerWindow(spec: WindowSpec, onClosed: () => void, deps: ServerWindowDeps): ServerWindow {
    const { server } = spec;
    const tag = `[${spec.title}]`;
    const origin = originOf(server.url);
    const tabs = new TabModel({ title: server.name, url: server.url });

    let panelOpen = false;
    let mode: LayoutMode = 'widen';
    let rects: Rects = splitWindow(DEFAULT_CONTENT.width + RAIL_WIDTH, STRIP_HEIGHT + DEFAULT_CONTENT.height, false, 'game');
    let contentWidth = DEFAULT_CONTENT.width;
    let applying = false;

    const win = new BrowserWindow({
        width: DEFAULT_CONTENT.width + RAIL_WIDTH,
        height: STRIP_HEIGHT + DEFAULT_CONTENT.height,
        minWidth: MIN_CONTENT_WIDTH + RAIL_WIDTH,
        minHeight: STRIP_HEIGHT + MIN_CONTENT_HEIGHT,
        useContentSize: true,
        ...(deps.position ?? {}),
        title: spec.title,
        backgroundColor: '#17120d',
        show: false
    });

    const shellView = new WebContentsView({
        webPreferences: {
            preload: preloadPath(),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true
        }
    });
    shellView.setBackgroundColor('#17120d');

    const gameView = new WebContentsView({
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            partition: spec.partition,
            backgroundThrottling: false
        }
    });
    gameView.setBackgroundColor('#000000');

    // Order matters: later children draw on top. The game sits over the shell's empty content area.
    win.contentView.addChildView(shellView);
    win.contentView.addChildView(gameView);

    // ── state ────────────────────────────────────────────────────────────

    function state(): ShellState {
        const active = tabs.active.id;
        return {
            windowId: spec.id,
            server,
            slot: spec.slot,
            title: spec.title,
            tabs: tabs.list().map(t => ({ ...t, active: t.id === active })),
            panelOpen,
            mode,
            rects
        };
    }

    function pushState(): void {
        if (!shellView.webContents.isDestroyed()) shellView.webContents.send(IPC.shellState, state());
    }

    // ── layout ───────────────────────────────────────────────────────────

    function applyLayout(): void {
        if (win.isDestroyed()) return;
        const current = win.getContentBounds();
        const display = screen.getDisplayMatching(win.getBounds());
        const result = computeLayout({
            panelOpen,
            activeTabKind: tabs.active.kind,
            window: current,
            workArea: display.workArea,
            contentWidth,
            canResize: !win.isMaximized() && !win.isFullScreen()
        });

        mode = result.mode;
        rects = result;
        const w = result.window;
        if (w.x !== current.x || w.y !== current.y || w.width !== current.width || w.height !== current.height) {
            applying = true;
            win.setContentBounds(w);
            applying = false;
        }
        shellView.setBounds({ x: 0, y: 0, width: w.width, height: w.height });
        gameView.setBounds(result.content);
        pushState();
    }

    win.on('resize', () => {
        if (applying) return;
        contentWidth = Math.max(MIN_CONTENT_WIDTH, win.getContentBounds().width - sideWidth(panelOpen));
        applyLayout();
    });
    // These change whether the window can be widened, so re-run the layout.
    win.on('maximize', () => applyLayout());
    win.on('unmaximize', () => applyLayout());
    win.on('enter-full-screen', () => applyLayout());
    win.on('leave-full-screen', () => applyLayout());

    // ── lifecycle ────────────────────────────────────────────────────────

    // The page keeps its own title; the window keeps the server's name.
    win.on('page-title-updated', event => event.preventDefault());
    win.on('close', event => {
        if (!deps.confirmClose(spec.title)) event.preventDefault();
    });
    win.on('closed', onClosed);

    shellView.webContents.once('did-finish-load', () => {
        if (win.isDestroyed()) return;
        applyLayout();
        win.show();
    });

    // ── the game view ────────────────────────────────────────────────────

    // The view is for this server only. Anything else the page tries to
    // navigate to goes to the system browser instead of replacing the game.
    gameView.webContents.on('will-navigate', (event, url) => {
        if (url === origin || url.startsWith(`${origin}/`)) return;
        event.preventDefault();
        deps.log(`${tag} sent ${url} to the system browser`);
        if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    });
    gameView.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url)) void shell.openExternal(url);
        return { action: 'deny' };
    });

    const gameLoaded = new Promise<'loaded' | 'failed'>(resolve => {
        gameView.webContents.once('did-finish-load', () => resolve('loaded'));
        gameView.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
            if (isMainFrame && code !== -3) resolve('failed');
        });
    });
    gameView.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
        // -3 is ERR_ABORTED: a load superseded by another, not a failure.
        if (!isMainFrame || code === -3) return;
        deps.log(`${tag} could not load ${url}: ${description} (${code})`);
        void gameView.webContents.loadFile(OFFLINE_PAGE, {
            query: { url: server.url, name: server.name, reason: description }
        });
    });
    gameView.webContents.on('did-finish-load', () => {
        const url = gameView.webContents.getURL();
        if (url.startsWith(origin)) deps.log(`${tag} loaded ${url}`);
    });

    applyLayout();
    loadRenderer(shellView.webContents, 'shell');
    void gameView.webContents.loadURL(server.url);

    return {
        id: spec.id,
        window: win,
        shellContentsId: shellView.webContents.id,
        focus: () => {
            if (win.isMinimized()) win.restore();
            win.focus();
        },
        close: () => win.close(),
        togglePanel: () => {
            panelOpen = !panelOpen;
            applyLayout();
        },
        state,
        whenGameLoaded: () => gameLoaded,
        captureViews: async () => ({
            shell: await shellView.webContents.capturePage(),
            game: await gameView.webContents.capturePage()
        })
    };
}
```

- [ ] **Step 3: The shell**

```tsx
// src/renderer/Shell.tsx
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { Rect, ShellState, TabInfo } from '../shared/ipc';

const at = (r: Rect): CSSProperties => ({ position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height });

function revisionOf(state: ShellState): string {
    return state.server.revision === null ? 'rev unknown' : `rev ${state.server.revision}`;
}

function Tab({ tab, revision }: { tab: TabInfo; revision: string }): ReactNode {
    return (
        <div
            role="tab"
            aria-selected={tab.active}
            className={`flex h-[26px] items-center gap-2 border px-3 text-[12px] ${
                tab.active ? 'border-line bg-surface text-bone' : 'border-transparent text-dim'
            }`}
        >
            <span className="truncate">{tab.title}</span>
            {tab.kind === 'game' && <span className="shrink-0 text-[11px] text-dim">{revision}</span>}
        </div>
    );
}

const MODE_NOTE: Record<ShellState['mode'], string | null> = {
    widen: null,
    shift: 'The window moved left to make room.',
    push: 'No room to widen, so the game area is narrower than the canvas and the page scales it down.'
};

/**
 * The chrome around the game: strip, rail and panel, drawn exactly where main
 * placed them. The content rect is left empty; the game view sits on top of it.
 */
export default function Shell(): ReactNode {
    const [state, setState] = useState<ShellState | null>(null);

    useEffect(() => {
        let alive = true;
        void window.zanaris.shell.get().then(s => {
            if (alive && s) setState(s);
        });
        const unsubscribe = window.zanaris.shell.onState(setState);
        return () => {
            alive = false;
            unsubscribe();
        };
    }, []);

    if (!state) return <div className="h-full bg-ink" />;

    const { rects } = state;
    const note = MODE_NOTE[state.mode];

    return (
        <div className="relative h-full overflow-hidden bg-ink text-bone">
            <header style={at(rects.strip)} className="flex items-center gap-1 border-b border-line px-2" role="tablist">
                {state.tabs.map(tab => (
                    <Tab key={tab.id} tab={tab} revision={revisionOf(state)} />
                ))}
                <button
                    type="button"
                    onClick={() => void window.zanaris.shell.togglePanel()}
                    aria-label={state.panelOpen ? 'Close panel' : 'Open panel'}
                    aria-pressed={state.panelOpen}
                    className="ml-auto flex h-[26px] w-[30px] items-center justify-center border border-transparent text-dim hover:border-line hover:text-bone"
                >
                    <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="0.75" y="0.75" width="12.5" height="10.5" />
                        <path d="M9.5 0.75v10.5" />
                    </svg>
                </button>
            </header>

            <div style={at(rects.content)} className="bg-black" aria-hidden="true" />

            {rects.panel && (
                <aside style={at(rects.panel)} className="flex flex-col border-l border-line px-4 py-3">
                    <h2 className="font-medium text-bone">Tools</h2>
                    <p className="mt-1 text-[12px] text-dim">Nothing here yet. Chat, timers and screenshots arrive with the next milestones.</p>
                    {note && <p className="mt-3 text-[12px] text-brass">{note}</p>}
                </aside>
            )}

            <nav style={at(rects.rail)} className="border-l border-line" aria-label="Tools" />
        </div>
    );
}
```

Add to `src/renderer/styles.css`, after the `body` rule:

```css
button {
    font: inherit;
    color: inherit;
    background: none;
    border: 0;
    padding: 0;
    cursor: default;
}
```

- [ ] **Step 4: Delete the old window and typecheck**

```bash
git rm -q src/main/gameWindow.ts
npm run typecheck
```
Expected: errors only in `src/main/index.ts` (rewritten in Task 8).

- [ ] **Step 5: Commit**

```bash
git add src/main/renderer.ts src/main/serverWindow.ts src/renderer/Shell.tsx src/renderer/styles.css
git commit -m "feat: server window with a shell view over the game view"
```

---

### Task 8: Launcher, menu, wiring and capture mode

**Files:**
- Create: `src/main/launcher.ts`, `src/main/menu.ts`
- Rewrite: `src/main/index.ts`
- Rewrite: `src/renderer/Launcher.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces: a runnable app. `ZANARIS_CAPTURE=<dir>` opens every catalog server, captures each window's two views, opens the panel on the first, opens a second instance of the first server, and exits.

- [ ] **Step 1: The launcher window**

```ts
// src/main/launcher.ts
import { BrowserWindow } from 'electron';
import { loadRenderer, preloadPath } from './renderer';

export function createLauncherWindow(onClosed: () => void): BrowserWindow {
    const win = new BrowserWindow({
        width: 460,
        height: 620,
        minWidth: 400,
        minHeight: 440,
        useContentSize: true,
        title: 'Zanaris Kit',
        backgroundColor: '#17120d',
        show: false,
        webPreferences: {
            preload: preloadPath(),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true
        }
    });
    win.once('ready-to-show', () => win.show());
    win.on('closed', onClosed);
    loadRenderer(win.webContents, 'launcher');
    return win;
}
```

- [ ] **Step 2: The menu**

```ts
// src/main/menu.ts
import { Menu, type MenuItemConstructorOptions } from 'electron';

export interface MenuActions {
    newWindow(): void;
    togglePanel(): void;
}

/** Native menus follow the platform's Title Case; everything the renderer draws is sentence case. */
export function installMenu(actions: MenuActions): void {
    const isMac = process.platform === 'darwin';
    const template: MenuItemConstructorOptions[] = [
        ...(isMac ? [{ role: 'appMenu' as const }] : []),
        {
            label: 'File',
            submenu: [
                { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => actions.newWindow() },
                { type: 'separator' },
                { role: 'close' }
            ]
        },
        { role: 'editMenu' },
        {
            label: 'View',
            submenu: [
                { label: 'Toggle Panel', accelerator: 'CmdOrCtrl+\\', click: () => actions.togglePanel() },
                { type: 'separator' },
                { role: 'togglefullscreen' },
                { role: 'toggleDevTools' }
            ]
        },
        { role: 'windowMenu' }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
```

- [ ] **Step 3: Main**

```ts
// src/main/index.ts
import { app, BrowserWindow, dialog, ipcMain, type NativeImage, type WebContents } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NewServerInput } from '../shared/catalog';
import { IPC, type CatalogState, type Result, type ShellState } from '../shared/ipc';
import { Catalog } from './catalog';
import { ServerWindows } from './windows';
import { createServerWindow, type ServerWindow } from './serverWindow';
import { createLauncherWindow } from './launcher';
import { installMenu } from './menu';

/** Dev-only: open every server, screenshot every view, and exit. See captureAndExit(). */
const CAPTURE_DIR = process.env.ZANARIS_CAPTURE;

const log = (msg: string): void => console.log(msg);

let quitting = false;
let launcher: BrowserWindow | null = null;
const catalog = new Catalog(join(app.getPath('userData'), 'servers.json'));
const serverWindows = new Map<number, ServerWindow>();
const byShell = new Map<number, ServerWindow>();

// ── catalog state ─────────────────────────────────────────────────────────

function catalogState(): CatalogState {
    return {
        servers: catalog.list().map(s => ({ ...s, openCount: windows.countFor(s.id) })),
        recovered: catalog.recovered
    };
}

function pushCatalog(): void {
    if (launcher && !launcher.isDestroyed()) launcher.webContents.send(IPC.catalogState, catalogState());
}

// ── windows ───────────────────────────────────────────────────────────────

/** New windows cascade from the launcher so several can open without stacking exactly. */
function nextPosition(): { x: number; y: number } | null {
    const anchor = launcher && !launcher.isDestroyed() ? launcher : null;
    if (!anchor) return null;
    const { x, y, width } = anchor.getBounds();
    const step = 32 * serverWindows.size;
    return { x: x + width + 16 + step, y: y + step };
}

function confirmClose(title: string): boolean {
    if (quitting) return true;
    const choice = dialog.showMessageBoxSync({
        type: 'question',
        buttons: ['Close', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `Close ${title}?`,
        detail: "You'll be logged out."
    });
    return choice === 0;
}

const windows = new ServerWindows(
    (spec, onClosed) => {
        const sw = createServerWindow(
            spec,
            () => {
                serverWindows.delete(spec.id);
                byShell.delete(sw.shellContentsId);
                log(`[main] closed ${spec.title}`);
                onClosed();
            },
            { log, confirmClose, position: nextPosition() }
        );
        serverWindows.set(spec.id, sw);
        byShell.set(sw.shellContentsId, sw);
        log(`[main] opened ${spec.title} — ${spec.server.url} (${spec.partition})`);
        return sw;
    },
    () => {
        pushCatalog();
        if (windows.list().length === 0 && !quitting) showLauncher();
    }
);

function showLauncher(): void {
    if (launcher && !launcher.isDestroyed()) {
        launcher.show();
        launcher.focus();
        return;
    }
    launcher = createLauncherWindow(() => {
        launcher = null;
    });
    launcher.webContents.once('did-finish-load', pushCatalog);
}

function windowFor(sender: WebContents): ServerWindow | undefined {
    return byShell.get(sender.id);
}

function focusedServerWindow(): ServerWindow | undefined {
    const focused = BrowserWindow.getFocusedWindow();
    return [...serverWindows.values()].find(sw => sw.window === focused);
}

function isNewServerInput(x: unknown): x is NewServerInput {
    if (typeof x !== 'object' || x === null) return false;
    const i = x as Record<string, unknown>;
    const nullableString = (v: unknown): boolean => v === null || typeof v === 'string';
    return (
        typeof i.name === 'string' &&
        typeof i.url === 'string' &&
        (i.revision === null || typeof i.revision === 'number') &&
        nullableString(i.wikiHome) &&
        nullableString(i.notes)
    );
}

// ── ipc ───────────────────────────────────────────────────────────────────

ipcMain.handle(IPC.catalogGet, (): CatalogState => catalogState());

ipcMain.handle(IPC.catalogAdd, (_event, input: unknown): Result => {
    if (!isNewServerInput(input)) return { ok: false, error: 'Bad input.' };
    const result = catalog.add(input);
    if (!result.ok) return result;
    pushCatalog();
    windows.open(result.server);
    return { ok: true };
});

ipcMain.handle(IPC.catalogRemove, (_event, id: unknown): Result => {
    if (typeof id !== 'string') return { ok: false, error: 'Bad server id.' };
    if (windows.countFor(id) > 0) return { ok: false, error: 'Close its windows first.' };
    if (!catalog.remove(id)) return { ok: false, error: 'Unknown server.' };
    pushCatalog();
    return { ok: true };
});

ipcMain.handle(IPC.windowOpen, (_event, id: unknown): Result => {
    const server = typeof id === 'string' ? catalog.get(id) : undefined;
    if (!server) return { ok: false, error: 'Unknown server.' };
    windows.open(server);
    return { ok: true };
});

ipcMain.handle(IPC.launcherShow, () => showLauncher());

ipcMain.handle(IPC.shellGet, (event): ShellState | null => windowFor(event.sender)?.state() ?? null);

ipcMain.handle(IPC.shellTogglePanel, event => windowFor(event.sender)?.togglePanel());

// ── dev capture ───────────────────────────────────────────────────────────

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Open every catalog server, wait for each game to load (or fail over to the
 * offline page), let the clients draw, then write each window's shell and game
 * views as PNGs. Then open the panel on the first window and capture it again
 * (the layout engine), and open a second instance of the first server (slots
 * and partitions). A window's own webContents holds nothing, so the views are
 * captured one by one.
 */
async function captureAndExit(dir: string): Promise<void> {
    mkdirSync(dir, { recursive: true });
    const settleMs = Number(process.env.ZANARIS_CAPTURE_WAIT) || 15_000;

    const save = (name: string, image: NativeImage): void => {
        writeFileSync(join(dir, `${name}.png`), image.toPNG());
        const { width, height } = image.getSize();
        log(`[capture] ${name}.png ${width}x${height}`);
    };
    const shoot = async (name: string, sw: ServerWindow): Promise<void> => {
        const views = await sw.captureViews();
        save(`${name}-shell`, views.shell);
        save(`${name}-game`, views.game);
    };

    const opened = catalog.list().map(s => serverWindows.get(windows.open(s).id)!);
    await Promise.all(opened.map(async sw => log(`[capture] ${sw.state().title}: ${await sw.whenGameLoaded()}`)));
    log(`[capture] settling for ${settleMs}ms`);
    await wait(settleMs);

    if (launcher) save('launcher', await launcher.webContents.capturePage());
    for (const sw of opened) await shoot(sw.state().server.id, sw);

    const first = opened[0]!;
    first.togglePanel();
    await wait(500);
    log(`[capture] panel open on ${first.state().title}: mode ${first.state().mode}`);
    await shoot(`${first.state().server.id}-panel`, first);

    const second = serverWindows.get(windows.open(first.state().server).id)!;
    log(`[capture] ${second.state().title}: ${await second.whenGameLoaded()}`);
    await wait(Math.min(settleMs, 8_000));
    await shoot(`${first.state().server.id}-2`, second);

    quitting = true;
    app.quit();
}

// ── app ───────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
    catalog.load();

    log('');
    log('  Zanaris Kit');
    log(`  catalog : ${catalog.file}${catalog.recovered ? ' (recovered — the old file was kept beside it)' : ''}`);
    for (const server of catalog.list()) {
        log(`  ${server.id.padEnd(16)} rev ${String(server.revision ?? '?').padEnd(4)} ${server.url}`);
    }
    log('');

    installMenu({
        newWindow: showLauncher,
        togglePanel: () => focusedServerWindow()?.togglePanel()
    });
    showLauncher();

    if (CAPTURE_DIR) await captureAndExit(CAPTURE_DIR);
});

app.on('activate', () => {
    if (windows.list().length === 0) showLauncher();
});

app.on('before-quit', () => {
    quitting = true;
});

app.on('window-all-closed', () => app.quit());
```

- [ ] **Step 4: The launcher UI**

```tsx
// src/renderer/Launcher.tsx
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { CatalogState, ServerInfo } from '../shared/ipc';

function hostOf(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

function describe(server: ServerInfo): string {
    const parts = [server.revision === null ? 'rev unknown' : `rev ${server.revision}`];
    parts.push(server.wiki ? `${hostOf(server.wiki.home)} wiki` : 'no wiki');
    if (server.notes) parts.push(server.notes);
    if (server.openCount > 0) parts.push(server.openCount === 1 ? '1 window open' : `${server.openCount} windows open`);
    return parts.join(' · ');
}

function ServerRow({ server, onOpen, onRemove }: { server: ServerInfo; onOpen: () => void; onRemove: () => void }): ReactNode {
    return (
        <li className="flex items-center gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0 flex-1">
                <div className="truncate text-bone">{server.name}</div>
                <div className="truncate text-[11px] text-dim">{describe(server)}</div>
                <div className="truncate font-mono text-[11px] text-dim/70">{hostOf(server.url)}</div>
            </div>
            {server.openCount === 0 && (
                <button type="button" onClick={onRemove} className="shrink-0 text-[11px] text-dim hover:text-brass">
                    Remove
                </button>
            )}
            <button
                type="button"
                onClick={onOpen}
                className="shrink-0 border border-brass px-3 py-1 text-[12px] text-brass hover:bg-brass hover:text-ink"
            >
                {server.openCount > 0 ? 'Open another' : 'Open'}
            </button>
        </li>
    );
}

const field = 'min-w-0 border border-line bg-surface px-2 py-1 text-[12px] text-bone placeholder:text-dim/60 focus:border-brass';

export default function Launcher(): ReactNode {
    const [state, setState] = useState<CatalogState | null>(null);
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');
    const [revision, setRevision] = useState('');
    const [wiki, setWiki] = useState('');
    const [notes, setNotes] = useState('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        void window.zanaris.launcher.get().then(s => {
            if (alive) setState(s);
        });
        const unsubscribe = window.zanaris.launcher.onState(setState);
        return () => {
            alive = false;
            unsubscribe();
        };
    }, []);

    const run = async (action: Promise<{ ok: true } | { ok: false; error: string }>): Promise<boolean> => {
        const result = await action;
        setError(result.ok ? null : result.error);
        return result.ok;
    };

    const submit = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        const rev = revision.trim();
        const ok = await run(
            window.zanaris.launcher.add({
                name,
                url,
                revision: rev === '' ? null : Number(rev),
                wikiHome: wiki.trim() === '' ? null : wiki,
                notes: notes.trim() === '' ? null : notes
            })
        );
        if (ok) {
            setName('');
            setUrl('');
            setRevision('');
            setWiki('');
            setNotes('');
        }
    };

    return (
        <div className="flex h-full flex-col">
            <header className="border-b border-line px-4 pt-4 pb-3">
                <h1 className="text-[15px] font-medium text-bone">Zanaris Kit</h1>
                <p className="mt-1 text-[12px] text-dim">Open a server in a new window. Each window knows its server and keeps playing while you use the others.</p>
                {state?.recovered && (
                    <p className="mt-2 border border-brass/50 px-2 py-1 text-[11px] text-brass">
                        Your server list couldn't be read and was reset to the defaults. The old file was kept beside it.
                    </p>
                )}
            </header>

            <ul className="min-h-0 flex-1 overflow-y-auto">
                {state?.servers.map(server => (
                    <ServerRow
                        key={server.id}
                        server={server}
                        onOpen={() => void run(window.zanaris.launcher.open(server.id))}
                        onRemove={() => void run(window.zanaris.launcher.remove(server.id))}
                    />
                ))}
            </ul>

            <form onSubmit={submit} className="border-t border-line px-4 py-3">
                <h2 className="mb-2 text-[12px] font-medium text-bone">Add a server</h2>
                <div className="grid grid-cols-[1fr_96px] gap-2">
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" spellCheck={false} className={field} />
                    <input value={revision} onChange={e => setRevision(e.target.value)} placeholder="Revision" inputMode="numeric" className={field} />
                    <input value={url} onChange={e => setUrl(e.target.value)} placeholder="host/rs2.cgi?lowmem=1" spellCheck={false} autoComplete="off" className={`col-span-2 font-mono ${field}`} />
                    <input value={wiki} onChange={e => setWiki(e.target.value)} placeholder="Wiki address, optional" spellCheck={false} autoComplete="off" className={`col-span-2 font-mono ${field}`} />
                    <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes, optional" className={`col-span-2 ${field}`} />
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="min-h-[1.2em] text-[11px]" aria-live="polite">
                        {error ? <span className="text-brass">{error}</span> : <span className="text-dim">Revision and wiki can be left blank.</span>}
                    </p>
                    <button type="submit" className="shrink-0 border border-line px-3 py-1 text-[12px] text-bone hover:border-brass hover:text-brass">
                        Add and open
                    </button>
                </div>
            </form>
        </div>
    );
}
```

- [ ] **Step 5: Typecheck, test, build**

```bash
npm run typecheck && npm test && npm run build
```
Expected: no type errors; 51 tests pass; `out/main/index.js`, `out/preload/index.js`, `out/renderer/` written.

- [ ] **Step 6: Run capture mode and inspect**

```bash
ZANARIS_CAPTURE=/tmp/zanaris-kit-captures npx electron .
```
Expected log lines: one `[main] opened … (persist:server:…)` per catalog entry; `[capture] <title>: loaded` for the three remote servers and `failed` for Local; `[capture] panel open on Zanaris — World 1: mode widen`; `[main] opened Zanaris — World 1 (2) … (persist:server:zanaris-w1:2)`. Open the PNGs: every `*-shell.png` shows the strip with the game tab and revision, `zanaris-w1-panel-shell.png` shows the panel, every remote `*-game.png` shows a title screen, `local-game.png` shows the offline page.

- [ ] **Step 7: Commit**

```bash
git add src/main/launcher.ts src/main/menu.ts src/main/index.ts src/renderer/Launcher.tsx
git commit -m "feat: launcher, menu and capture mode for server windows"
```

---

### Task 9: README

**Files:**
- Rewrite: `README.md`

- [ ] **Step 1: Rewrite the README** to describe: what the app is now (launcher, one window per open, the strip with the pinned game tab, empty rail, panel toggle), the catalog file and its recovery, slots and partitions, the layout modes, how to run (`npm start`, `npm test`, `npm run typecheck`, `npm run capture`), what capture mode verified (paste the observed table), the security posture, the layout of `src/`, what is on `main`, and what the next milestones add (page tabs, then shared tools, chat, server tools). Keep the "Why a window keeps playing when it is not in front" section as is. Remove anything that describes the launcher-only build.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README for milestone one"
```

---

## Self-review

**Spec coverage.** Model (three kinds of thing): Tasks 4, 7, 8. Server window anatomy: strip, content, rail, panel, widen/shift/push, minimum sizes: Tasks 1, 7. Address row: Task 1 computes it; Task 7 passes the active tab kind; nothing draws it until milestone 2 opens a page tab. Views and the shell (one full-window shell, game view on top, main owns geometry): Task 7. Keyboard and menu: New Window, Close Window with confirm, Toggle Panel: Task 8. Cmd+T, Cmd+W on a page tab, Cmd+1..9 and screenshot: later milestones, as their features are. Catalog schema, storage, seeding, recovery, add form, refuse-remove-while-open: Tasks 2, 8. Data packs: reserved slot, nothing to build. Tools: none in milestone 1; the rail is empty and the panel is a placeholder. Launcher: Task 8, including the reappear-on-last-close rule and "Open another". Partitions and slots: Task 3. Process and IPC: Task 6, `windowFor(event.sender)` in Task 8. Navigation rules for the game view: Task 7. Persistence: catalog only in this milestone. Error handling: offline page for the game, catalog recovery with the launcher banner. Testing: Tasks 1 to 5 under `node --test`; capture mode in Task 8.

**Placeholders.** None. Task 9's README step is prose by nature; its content list is explicit.

**Type consistency.** `Rects` (Task 1) is the shape of `ShellState.rects` (Task 6) and is what `serverWindow.ts` stores. `WindowSpec` (Task 4) is what `createServerWindow` (Task 7) takes and what the factory in Task 8 receives. `ServerWindow.shellContentsId` is used by `byShell` in Task 8. `Result` from Task 6 is the return type of every launcher handler in Task 8. `TabInfo.active` is computed in Task 7 from `TabModel.active` (Task 5).
