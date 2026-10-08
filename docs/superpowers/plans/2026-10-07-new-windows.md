# New windows: setup and place — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new game window opens with the setup chosen for its server's new windows, at the place its window number was last closed at.

**Architecture:** Two new pure decisions, made before the window exists: `setups.openingSetup` (which tree and tab size) and `windowPlace.openingFrame` (which frame). `tabs.openWindowTabs` turns the instantiated tree into the first tab; `paneHost` starts that tab's fit from the setup's size so the first layout holds the game. `appState` stores the per-server choice and the per-server-and-slot place; `serverWindow` records the place as the window closes and offers the choice in the Setups menu.

**Tech Stack:** Electron 44, TypeScript, `node --test` on pure modules, `npm run capture` for the wiring.

**Spec:** `docs/superpowers/specs/2026-10-07-new-windows-design.md`

## Global Constraints

- Pure modules import siblings with the `.ts` extension (`'./paneTree.ts'`); `serverWindow.ts` and `index.ts` import without it (`'./paneTree'`). Match the file you are in.
- `serverWindow.ts`, `index.ts` and the renderer have no tests. Anything decidable goes in a pure module with a test (`CLAUDE.md`, "Where logic is allowed to live").
- Comments are load-bearing: fix any comment this change makes untrue, in any file, in the same commit.
- No literal colours in the renderer (none are needed here).
- No migration for `state.json`: a file without the new blocks reads as no choices and no places.
- Write paths from the repository root; never a home directory.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `npm test` runs every test; a single file runs with `node --test src/main/<file>.test.ts`.

## Review Focus

1. **A display left of or above the main one** — negative coordinates. A window remembered there must come back there, not be treated as off screen. (Task 1 test.)
2. **A display whose resolution dropped since the window was there** — the window should come back on that display, pulled in from its right and bottom edges, not thrown back to the cascade. (Task 1 test.)
3. **A chosen saved setup renamed or deleted in Finder** — the next window opens as Game and Chat, the log says why, and the menu ticks Game and Chat. (Task 2 test; menu in Task 5.)
4. **A hand-edited `state.json` naming `../../state.json` or `sub/x.json` as the setup** — dropped on read, never joined into a path. (Task 2 and Task 3 tests.)
5. **Closing a window, then pressing Cancel on its confirm** — nothing recorded; only a confirmed close records the place. (Task 5 code, checked in review: the record is after `confirmClose` returns true.)

---

### Task 1: `windowPlace.ts` — where a window opens

**Files:**
- Create: `src/main/windowPlace.ts`
- Test: `src/main/windowPlace.test.ts`

**Interfaces:**
- Consumes: `grownFrame(frame: Rect, workArea: Rect, by: Size): Rect` from `./windowRoom.ts`; `Rect`, `Size` from `./paneTree.ts`; `PANE_MIN_HEIGHT`, `PANE_MIN_WIDTH`, `TAB_BAR_HEIGHT` from `../shared/layout.ts`.
- Produces:
  - `export const FRAME_ALLOWANCE = 40`
  - `export const PLACE_SLOTS_MAX = 16`
  - `export interface Place { x: number; y: number; maximized: boolean; fullScreen: boolean }`
  - `export interface Opening { frame: Rect; maximized: boolean; fullScreen: boolean }`
  - `export function placeOf(normal: Rect, maximized: boolean, fullScreen: boolean): Place`
  - `export function readPlace(x: unknown): Place | null`
  - `export function readPlaces(x: unknown): Map<string, Map<number, Place>>`
  - `export function openingFrame(opts: { content: Size; remembered: Place | null; cascade: { x: number; y: number } | null; workAreas: readonly Rect[]; cursor: Rect }): Opening`

- [ ] **Step 1: Write the failing tests**

`src/main/windowPlace.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLACE_SLOTS_MAX, openingFrame, placeOf, readPlace, readPlaces, type Place } from './windowPlace.ts';
import { PANE_MIN_HEIGHT, PANE_MIN_WIDTH, TAB_BAR_HEIGHT } from '../shared/layout.ts';

/** A laptop below a 25px menu bar, a big display to its right, and one to its left at negative coordinates. */
const laptop = { x: 0, y: 25, width: 1440, height: 875 };
const right = { x: 1440, y: 0, width: 2560, height: 1440 };
const left = { x: -1920, y: 0, width: 1920, height: 1080 };
/** The game alone, under the tab bar. */
const content = { width: 765, height: 607 };
const place = (x: number, y: number, flags: Partial<Place> = {}): Place => ({ x, y, maximized: false, fullScreen: false, ...flags });

test('a remembered place on a display still there is where the window opens', () => {
    const opening = openingFrame({ content, remembered: place(2240, 120), cascade: null, workAreas: [laptop, right], cursor: laptop });
    assert.deepEqual(opening, { frame: { x: 2240, y: 120, width: 765, height: 607 }, maximized: false, fullScreen: false });
});

test('a display to the left, at negative coordinates, keeps its windows', () => {
    const opening = openingFrame({ content, remembered: place(-1800, 100), cascade: null, workAreas: [laptop, left], cursor: laptop });
    assert.deepEqual(opening.frame, { x: -1800, y: 100, width: 765, height: 607 });
});

test('a place on a display no longer there falls back to the cascade', () => {
    const opening = openingFrame({ content, remembered: place(2240, 120), cascade: { x: 132, y: 157 }, workAreas: [laptop], cursor: laptop });
    assert.deepEqual(opening.frame, { x: 132, y: 157, width: 765, height: 607 });
});

test('with neither a place nor a window to cascade from, the window is centred on the display under the cursor', () => {
    const opening = openingFrame({ content, remembered: null, cascade: null, workAreas: [laptop, right], cursor: right });
    assert.deepEqual(opening.frame, { x: 1440 + Math.floor((2560 - 765) / 2), y: Math.floor((1440 - 607) / 2), width: 765, height: 607 });
});

test('a tab bar above the top of its display cannot be reached, so the place is not used', () => {
    const opening = openingFrame({ content, remembered: place(100, 10), cascade: null, workAreas: [laptop], cursor: laptop });
    assert.deepEqual(opening.frame, { x: Math.floor((1440 - 765) / 2), y: 25 + Math.floor((875 - 607) / 2), width: 765, height: 607 });
});

test('a window hanging off the left edge is kept, and left there, while a pane width of its tab bar shows', () => {
    const kept = openingFrame({ content, remembered: place(PANE_MIN_WIDTH - 765, 100), cascade: null, workAreas: [laptop], cursor: laptop });
    assert.equal(kept.frame.x, PANE_MIN_WIDTH - 765, 'the player put it there');
    const lost = openingFrame({ content, remembered: place(PANE_MIN_WIDTH - 766, 100), cascade: null, workAreas: [laptop], cursor: laptop });
    assert.equal(lost.frame.x, Math.floor((1440 - 765) / 2), 'one pixel less and it is out of reach');
});

test('a display that shrank since keeps its window, moved back in from its right and bottom edges', () => {
    const smaller = { x: 1440, y: 0, width: 1920, height: 1080 };
    const opening = openingFrame({ content, remembered: place(3000, 900), cascade: null, workAreas: [laptop, smaller], cursor: laptop });
    assert.deepEqual(opening.frame, { x: 1440 + 1920 - 765, y: 1080 - 607, width: 765, height: 607 });
});

test('a cascade stays on the display it lands on', () => {
    const opening = openingFrame({ content, remembered: null, cascade: { x: 1400, y: 500 }, workAreas: [laptop], cursor: laptop });
    assert.deepEqual(opening.frame, { x: 1440 - 765, y: 25 + 875 - 607, width: 765, height: 607 });
});

test('a setup bigger than its display is held to it, the height leaving room for a frame', () => {
    const opening = openingFrame({ content: { width: 2000, height: 1000 }, remembered: null, cascade: null, workAreas: [laptop], cursor: laptop });
    assert.deepEqual(opening.frame, { x: 0, y: 45, width: 1440, height: 835 });
});

test('never smaller than one pane under the tab bar', () => {
    const tiny = { x: 0, y: 0, width: 100, height: 100 };
    const opening = openingFrame({ content, remembered: null, cascade: null, workAreas: [tiny], cursor: tiny });
    assert.equal(opening.frame.width, PANE_MIN_WIDTH);
    assert.equal(opening.frame.height, TAB_BAR_HEIGHT + PANE_MIN_HEIGHT);
});

test('maximised and full screen come back with their place, and not without it', () => {
    const both = place(2240, 120, { maximized: true, fullScreen: true });
    const kept = openingFrame({ content, remembered: both, cascade: null, workAreas: [laptop, right], cursor: laptop });
    assert.deepEqual([kept.maximized, kept.fullScreen], [true, true]);
    const gone = openingFrame({ content, remembered: both, cascade: null, workAreas: [laptop], cursor: laptop });
    assert.deepEqual([gone.maximized, gone.fullScreen], [false, false]);
});

test('a place is the normal frame’s corner in whole pixels, and its two states', () => {
    assert.deepEqual(placeOf({ x: 10.6, y: -3.2, width: 9, height: 9 }, true, false), { x: 11, y: -3, maximized: true, fullScreen: false });
});

test('a stored place is read whole or not at all', () => {
    assert.deepEqual(readPlace(place(-1800, 100)), place(-1800, 100));
    assert.equal(readPlace({ x: 1.5, y: 0, maximized: false, fullScreen: false }), null, 'not a pixel');
    assert.equal(readPlace({ x: 100_001, y: 0, maximized: false, fullScreen: false }), null, 'past any display');
    assert.equal(readPlace({ x: 0, y: 0, maximized: 'yes', fullScreen: false }), null);
    assert.equal(readPlace({ x: 0, y: 0, maximized: false }), null);
    assert.equal(readPlace('0,0'), null);
    assert.equal(readPlace(null), null);
});

test('stored places are read one entry at a time, and only for slots a window can have', () => {
    const read = readPlaces({
        lostcity: { '1': place(10, 20), '2': place(30, 40), [String(PLACE_SLOTS_MAX)]: place(1, 1), [String(PLACE_SLOTS_MAX + 1)]: place(1, 1), '0': place(1, 1), x: place(1, 1), '3': { x: 'no' } },
        '': { '1': place(1, 1) },
        zanaris: 'nope'
    });
    assert.deepEqual([...read.keys()], ['lostcity']);
    assert.deepEqual([...read.get('lostcity')!.entries()], [
        [1, place(10, 20)],
        [2, place(30, 40)],
        [PLACE_SLOTS_MAX, place(1, 1)]
    ]);
    assert.equal(readPlaces(undefined).size, 0);
    assert.equal(readPlaces([place(1, 1)]).size, 0, 'an array is not a block of servers');
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test src/main/windowPlace.test.ts`
Expected: FAIL, `Cannot find module` for `./windowPlace.ts`.

- [ ] **Step 3: Write `src/main/windowPlace.ts`**

```ts
import { PANE_MIN_HEIGHT, PANE_MIN_WIDTH, TAB_BAR_HEIGHT } from '../shared/layout.ts';
import type { Rect, Size } from './paneTree.ts';
import { grownFrame } from './windowRoom.ts';

/**
 * Where a new game window opens, and what a closing one leaves behind to say
 * where it was.
 *
 * Pure, for the reason `CLAUDE.md` gives: `serverWindow` cannot be tested, so
 * the decision is made here and the window is only built at the answer. Its
 * size is never remembered — that is the setup's (`setups.openingSetup`) —
 * only its place, per server and window number, since the place is the one
 * thing about a window a player sets once and wants every launch.
 */

/**
 * Room left on the display for the window's own frame, which a content size
 * does not include: a caption and borders on Linux. macOS and Windows draw no
 * caption, since the tab bar stands in for their title bars
 * (`windowFrame.ts`), and the allowance there is only room to spare. Generous
 * rather than measured, since the frame cannot be asked for before the window
 * exists and an opening size a few pixels short costs nothing.
 */
export const FRAME_ALLOWANCE = 40;

/** The window numbers a place is kept for. A window numbered past this opens where it would have anyway, and is not recorded. */
export const PLACE_SLOTS_MAX = 16;

/** Further from the origin than any arrangement of displays reaches: a stored coordinate past it was not written by a window. */
const REACH = 100_000;

/** Where a window was: its normal frame's top-left, and whether it was maximised or full screen. */
export interface Place {
    x: number;
    y: number;
    maximized: boolean;
    fullScreen: boolean;
}

/** What a window opens at: its frame, with the content size `useContentSize` takes, and the two states to put it in as it is shown. */
export interface Opening {
    frame: Rect;
    maximized: boolean;
    fullScreen: boolean;
}

/**
 * A closing window's place. `normal` is `getNormalBounds()`, the frame it
 * goes back to when it is not maximised, full screen or minimised, so a
 * window closed in any of those still records where it lives.
 */
export function placeOf(normal: Rect, maximized: boolean, fullScreen: boolean): Place {
    return { x: Math.round(normal.x), y: Math.round(normal.y), maximized, fullScreen };
}

/** One stored place, whole or not at all. */
export function readPlace(x: unknown): Place | null {
    if (typeof x !== 'object' || x === null) return null;
    const p = x as Record<string, unknown>;
    const coordinate = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && Math.abs(n) <= REACH;
    if (!coordinate(p.x) || !coordinate(p.y)) return null;
    if (typeof p.maximized !== 'boolean' || typeof p.fullScreen !== 'boolean') return null;
    return { x: p.x, y: p.y, maximized: p.maximized, fullScreen: p.fullScreen };
}

/**
 * The stored places, per server id and window number, read one entry at a
 * time: a bad entry, a slot no window can have, or a server that is not a
 * block of slots costs only itself.
 */
export function readPlaces(x: unknown): Map<string, Map<number, Place>> {
    const places = new Map<string, Map<number, Place>>();
    if (typeof x !== 'object' || x === null || Array.isArray(x)) return places;
    for (const [id, slots] of Object.entries(x as Record<string, unknown>)) {
        if (id === '' || typeof slots !== 'object' || slots === null || Array.isArray(slots)) continue;
        const read = new Map<number, Place>();
        for (const [key, value] of Object.entries(slots as Record<string, unknown>)) {
            const slot = /^\d+$/.test(key) ? Number(key) : NaN;
            if (!(slot >= 1 && slot <= PLACE_SLOTS_MAX)) continue;
            const place = readPlace(value);
            if (place) read.set(slot, place);
        }
        if (read.size > 0) places.set(id, read);
    }
    return places;
}

/**
 * The work area a window at (`x`, `y`) and `width` wide can be dragged on,
 * or null: its tab bar, which is what a window is dragged by, lies inside the
 * area from top to bottom and across at least a pane's width of it.
 */
function reachable(x: number, y: number, width: number, workAreas: readonly Rect[]): Rect | null {
    return (
        workAreas.find(area => {
            const within = y >= area.y && y + TAB_BAR_HEIGHT <= area.y + area.height;
            const across = Math.min(x + width, area.x + area.width) - Math.max(x, area.x);
            return within && across >= Math.min(PANE_MIN_WIDTH, width);
        }) ?? null
    );
}

/** The work area holding a point, or null. */
function areaAt(point: { x: number; y: number }, workAreas: readonly Rect[]): Rect | null {
    return workAreas.find(area => point.x >= area.x && point.x < area.x + area.width && point.y >= area.y && point.y < area.y + area.height) ?? null;
}

/**
 * Where a new window opens.
 *
 * `content` is the size its setup wants, tab bar included. The place it goes:
 *
 * 1. `remembered`, when its tab bar can still be reached on some display
 *    (`reachable`). Its maximised and full-screen states come with it.
 * 2. Otherwise `cascade`, 32px from the focused or last window, on the
 *    display it lands on.
 * 3. Otherwise centred on `cursor`, the display under the pointer.
 *
 * The size is then held to that display — no wider than it, no taller than it
 * less `FRAME_ALLOWANCE` — and the window moved back onto it only as far as it
 * runs off the right or bottom (`windowRoom.grownFrame`), so one the player
 * left hanging off the left or top stays there.
 */
export function openingFrame(opts: {
    content: Size;
    remembered: Place | null;
    cascade: { x: number; y: number } | null;
    workAreas: readonly Rect[];
    cursor: Rect;
}): Opening {
    const remembered = opts.remembered;
    const home = remembered ? reachable(remembered.x, remembered.y, opts.content.width, opts.workAreas) : null;
    const area = home ?? (opts.cascade ? areaAt(opts.cascade, opts.workAreas) : null) ?? opts.cursor;
    const width = Math.max(PANE_MIN_WIDTH, Math.min(opts.content.width, area.width));
    const height = Math.max(TAB_BAR_HEIGHT + PANE_MIN_HEIGHT, Math.min(opts.content.height, area.height - FRAME_ALLOWANCE));
    const origin =
        home && remembered
            ? { x: remembered.x, y: remembered.y }
            : (opts.cascade ?? { x: area.x + Math.floor((area.width - width) / 2), y: area.y + Math.floor((area.height - height) / 2) });
    return {
        frame: grownFrame({ ...origin, width, height }, area, { width: 0, height: 0 }),
        maximized: home !== null && remembered !== null && remembered.maximized,
        fullScreen: home !== null && remembered !== null && remembered.fullScreen
    };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test src/main/windowPlace.test.ts`
Expected: PASS, every test.

- [ ] **Step 5: Commit**

```bash
git add src/main/windowPlace.ts src/main/windowPlace.test.ts
git commit -m "feat: where a new window opens, decided before it exists

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `setups.ts` — what a new window opens with

**Files:**
- Modify: `src/main/setups.ts`
- Test: `src/main/setups.test.ts`

**Interfaces:**
- Consumes: `readSetup(text): { tree: StoredNode; size: Size | null } | null`, `layoutEntries(files): { name; file }[]`, `type StoredNode` from `./layoutFile.ts`; the existing `BuiltInSetup`, `BuiltInSetupId`, `builtInSetups`.
- Produces:
  - `export type NewWindowSetup = { builtIn: BuiltInSetupId } | { file: string }`
  - `export function readNewWindowSetup(x: unknown): NewWindowSetup | null`
  - `export function readNewWindows(x: unknown): Map<string, NewWindowSetup>`
  - `export function sameSetup(a: NewWindowSetup, b: NewWindowSetup): boolean`
  - `export function opensWindow(text: string): boolean`
  - `export interface OpeningSetup { tree: StoredNode; size: Size | null; name: string; used: NewWindowSetup; fellBack: string | null }`
  - `export function openingSetup(choice: NewWindowSetup | null, opts: { builtIns: readonly BuiltInSetup[]; saved: readonly { name: string; file: string }[]; read: (file: string) => string | null }): OpeningSetup`

- [ ] **Step 1: Write the failing tests**

Append to `src/main/setups.test.ts`, and extend its imports:

```ts
// at the top, replacing the two existing imports of setups.ts and layoutFile.ts:
import { builtInSetups, opensWindow, openingSetup, readNewWindowSetup, readNewWindows, sameSetup } from './setups.ts';
import { instantiateLayout, writeLayout, type StoredNode } from './layoutFile.ts';
import { contentOf, layoutTree, leaf, paneIds, split, type PaneNode } from './paneTree.ts';
```

```ts
const BUILT = builtInSetups({ tools: ALL, gameHeight: GAME_PREFERRED_HEIGHT });
/** The game with a column of timers beside it, saved at 1169x567. */
const SKILLING = writeLayout(split('s', 'x', [leaf('a', { kind: 'game' }), leaf('b', { kind: 'tool', tool: 'timers' })], [765 / 1165, 400 / 1165]), 'lostcity', { width: 1169, height: 567 });
/** A page reader with no game in it. */
const WIKI = writeLayout(leaf('a', { kind: 'empty' }), 'lostcity', { width: 400, height: 600 });
/** A setup saved before setups carried a size. */
const OLD = writeLayout(leaf('a', { kind: 'game' }), 'lostcity');
const FILES: Record<string, string> = { 'skilling.json': SKILLING, 'wiki.json': WIKI, 'old.json': OLD, 'broken.json': 'not json' };
const SAVED = ['broken.json', 'gone.json', 'old.json', 'skilling.json', 'wiki.json'].map(file => ({ name: file.replace(/\.json$/, ''), file }));
const OPTS = { builtIns: BUILT, saved: SAVED, read: (file: string): string | null => FILES[file] ?? null };
const GAME_AND_CHAT = { builtIn: 'game-chat' } as const;

test('with nothing chosen a new window opens as Game and Chat, as it always has', () => {
    const opening = openingSetup(null, OPTS);
    const gameChat = BUILT.find(s => s.id === 'game-chat')!;
    assert.deepEqual(opening, { tree: gameChat.tree, size: gameChat.size, name: 'Game and Chat', used: GAME_AND_CHAT, fellBack: null });
});

test('a built-in chosen is the one a new window opens with', () => {
    const opening = openingSetup({ builtIn: 'game-chat-tools' }, OPTS);
    assert.equal(opening.name, 'Game, Chat and Tools');
    assert.deepEqual(opening.used, { builtIn: 'game-chat-tools' });
    assert.equal(opening.fellBack, null);
});

test('a built-in this window does not offer opens Game and Chat instead, and says why', () => {
    const chatOnly = builtInSetups({ tools: ['chat'], gameHeight: GAME_PREFERRED_HEIGHT });
    const opening = openingSetup({ builtIn: 'game-chat-tools' }, { ...OPTS, builtIns: chatOnly });
    assert.deepEqual(opening.used, GAME_AND_CHAT);
    assert.match(opening.fellBack ?? '', /does not offer/);
});

test('a saved setup opens at the size it was saved at, under its file’s name', () => {
    const opening = openingSetup({ file: 'skilling.json' }, OPTS);
    assert.equal(opening.name, 'skilling');
    assert.deepEqual(opening.size, { width: 1169, height: 567 });
    assert.deepEqual(opening.used, { file: 'skilling.json' });
    assert.equal(opening.fellBack, null);
    assert.equal(opening.tree.kind, 'split');
});

test('a saved setup renamed or removed from the folder opens Game and Chat, and says it is gone', () => {
    const opening = openingSetup({ file: 'pking.json' }, OPTS);
    assert.deepEqual(opening.used, GAME_AND_CHAT);
    assert.match(opening.fellBack ?? '', /pking\.json is not in the setups folder/);
});

test('a saved setup with no game in it cannot open a game window', () => {
    const opening = openingSetup({ file: 'wiki.json' }, OPTS);
    assert.deepEqual(opening.used, GAME_AND_CHAT);
    assert.match(opening.fellBack ?? '', /holds no game/);
});

test('a file that cannot be read, or is not a setup, opens Game and Chat', () => {
    assert.match(openingSetup({ file: 'gone.json' }, OPTS).fellBack ?? '', /could not be read/);
    assert.match(openingSetup({ file: 'broken.json' }, OPTS).fellBack ?? '', /is not a setup/);
});

test('a saved setup from before setups carried a size opens with none, to be laid out by its fractions', () => {
    const opening = openingSetup({ file: 'old.json' }, OPTS);
    assert.equal(opening.size, null);
    assert.equal(opening.fellBack, null);
});

test('only a setup holding the game can be what new windows open with', () => {
    assert.equal(opensWindow(SKILLING), true);
    assert.equal(opensWindow(OLD), true);
    assert.equal(opensWindow(WIKI), false);
    assert.equal(opensWindow('not json'), false);
    assert.equal(opensWindow(''), false);
});

test('a stored choice is a built-in the kit knows, or a file name in the folder and nothing more', () => {
    assert.deepEqual(readNewWindowSetup({ builtIn: 'game' }), { builtIn: 'game' });
    assert.deepEqual(readNewWindowSetup({ file: 'skilling.json' }), { file: 'skilling.json' });
    assert.deepEqual(readNewWindowSetup({ file: `${'a'.repeat(250)}.json` }), { file: `${'a'.repeat(250)}.json` });
    for (const bad of [
        { builtIn: 'everything' },
        { file: '../../state.json' },
        { file: 'sub/x.json' },
        { file: 'sub\\x.json' },
        { file: '.hidden.json' },
        { file: 'notes.txt' },
        { file: '' },
        { file: `${'a'.repeat(251)}.json` },
        { file: 7 },
        'game',
        null
    ]) {
        assert.equal(readNewWindowSetup(bad), null, JSON.stringify(bad));
    }
});

test('stored choices are read one server at a time', () => {
    const read = readNewWindows({ lostcity: { builtIn: 'game' }, zanaris: { file: '../x.json' }, '': { builtIn: 'game' }, labs: 'game' });
    assert.deepEqual([...read.entries()], [['lostcity', { builtIn: 'game' }]]);
    assert.equal(readNewWindows(undefined).size, 0);
});

test('two choices are the same when they name the same built-in or the same file', () => {
    assert.equal(sameSetup({ builtIn: 'game' }, { builtIn: 'game' }), true);
    assert.equal(sameSetup({ builtIn: 'game' }, { builtIn: 'game-chat' }), false);
    assert.equal(sameSetup({ file: 'a.json' }, { file: 'a.json' }), true);
    assert.equal(sameSetup({ file: 'a.json' }, { builtIn: 'game' }), false);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test src/main/setups.test.ts`
Expected: FAIL, `openingSetup` (and the others) not exported.

- [ ] **Step 3: Add to `src/main/setups.ts`**

Replace its first import with:

```ts
import { layoutEntries, readSetup, type StoredNode } from './layoutFile.ts';
```

Append:

```ts
/**
 * What new windows of a server open with: a built-in, or a saved setup by
 * its name in that server's setups folder. Stored per server in `state.json`
 * (`AppState.newWindowSetup`), and chosen from the Setups menu's Open New
 * Windows With. A server with none opens Game and Chat.
 *
 * A file is a name, never a path. It is looked up in the folder's own
 * listing when a window opens (`openingSetup`), so nothing stored is ever
 * joined into a path, and a name that could reach outside the folder is
 * dropped as `state.json` is read.
 */
export type NewWindowSetup = { builtIn: BuiltInSetupId } | { file: string };

const BUILT_IN_IDS: readonly BuiltInSetupId[] = ['game', 'game-chat', 'game-chat-tools'];
/** The longest file name the three platforms' file systems allow. */
const FILE_NAME_MAX = 255;

/** One stored choice, or null when it is not one: a built-in this kit does not know, or a name the folder's listing would never return. */
export function readNewWindowSetup(x: unknown): NewWindowSetup | null {
    if (typeof x !== 'object' || x === null) return null;
    const choice = x as Record<string, unknown>;
    if (typeof choice.builtIn === 'string') return (BUILT_IN_IDS as readonly string[]).includes(choice.builtIn) ? { builtIn: choice.builtIn as BuiltInSetupId } : null;
    const file = choice.file;
    if (typeof file !== 'string' || file.length > FILE_NAME_MAX || /[/\\\u0000]/.test(file)) return null;
    return layoutEntries([file]).length === 1 ? { file } : null;
}

/** The stored choices, per server id, read one server at a time. */
export function readNewWindows(x: unknown): Map<string, NewWindowSetup> {
    const choices = new Map<string, NewWindowSetup>();
    if (typeof x !== 'object' || x === null || Array.isArray(x)) return choices;
    for (const [id, value] of Object.entries(x as Record<string, unknown>)) {
        const choice = id === '' ? null : readNewWindowSetup(value);
        if (choice) choices.set(id, choice);
    }
    return choices;
}

export function sameSetup(a: NewWindowSetup, b: NewWindowSetup): boolean {
    if ('builtIn' in a) return 'builtIn' in b && a.builtIn === b.builtIn;
    return 'file' in b && a.file === b.file;
}

function holdsGame(node: StoredNode): boolean {
    return node.kind === 'leaf' ? node.content.kind === 'game' : node.children.some(holdsGame);
}

/** Whether a saved setup's text can be what new windows open with: a setup, holding the game, since a game window opens onto its game. */
export function opensWindow(text: string): boolean {
    const setup = readSetup(text);
    return setup !== null && holdsGame(setup.tree);
}

/** What a new window opens with. */
export interface OpeningSetup {
    tree: StoredNode;
    /** The tab size it was made at, or null for a saved setup from before setups carried one, laid out by its fractions. */
    size: Size | null;
    /** As the log names it: a built-in's name, or the file's without `.json`. */
    name: string;
    /** The choice it opened with: the one asked for, or Game and Chat when that could not be used. What the menu ticks. */
    used: NewWindowSetup;
    /** Why the choice asked for could not be used, or null when it was. */
    fellBack: string | null;
}

/**
 * The setup a new window opens with, from its server's stored `choice`.
 *
 * `saved` is the folder's listing (`layoutFile.layoutEntries`), and `read`
 * reads one of its entries, null when it cannot: injected, so a test never
 * touches a folder, and so a stored name is only ever opened as an entry the
 * listing returned. Anything that cannot be used — a built-in this window
 * does not offer, a file gone from the folder, one that is not a setup or
 * holds no game — opens Game and Chat, with the reason.
 */
export function openingSetup(
    choice: NewWindowSetup | null,
    opts: { builtIns: readonly BuiltInSetup[]; saved: readonly { name: string; file: string }[]; read: (file: string) => string | null }
): OpeningSetup {
    const builtIn = (setup: BuiltInSetup, fellBack: string | null): OpeningSetup => ({ tree: setup.tree, size: setup.size, name: setup.name, used: { builtIn: setup.id }, fellBack });
    // Every window has chat, so Game and Chat is always there; Game, which is
    // always first, only stands in should a window ever have no chat.
    const fallback = (reason: string | null): OpeningSetup => builtIn(opts.builtIns.find(s => s.id === 'game-chat') ?? opts.builtIns[0]!, reason);
    if (choice === null) return fallback(null);
    if ('builtIn' in choice) {
        const setup = opts.builtIns.find(s => s.id === choice.builtIn);
        return setup ? builtIn(setup, null) : fallback(`this window does not offer ${choice.builtIn}`);
    }
    const entry = opts.saved.find(e => e.file === choice.file);
    if (!entry) return fallback(`${choice.file} is not in the setups folder`);
    const text = opts.read(entry.file);
    if (text === null) return fallback(`${entry.file} could not be read`);
    const setup = readSetup(text);
    if (!setup) return fallback(`${entry.file} is not a setup`);
    if (!holdsGame(setup.tree)) return fallback(`${entry.file} holds no game`);
    return { tree: setup.tree, size: setup.size, name: entry.name, used: { file: entry.file }, fellBack: null };
}
```

`Size` is already imported in `setups.ts` (`import type { Size } from './paneTree.ts'`). Update the module's top comment: after the paragraph ending "exactly as a saved setup's own size does.", add:

```ts
 *
 * Any of them, or a saved setup, can be what new windows of a server open
 * with (`openingSetup`), which is decided here for the same reason.
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test src/main/setups.test.ts`
Expected: PASS, the old tests and the new.

- [ ] **Step 5: Commit**

```bash
git add src/main/setups.ts src/main/setups.test.ts
git commit -m "feat: what a new window opens with, and when that cannot be used

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `appState.ts` — the choice and the places, kept

**Files:**
- Modify: `src/main/appState.ts`
- Test: `src/main/appState.test.ts`

**Interfaces:**
- Consumes: `NewWindowSetup`, `readNewWindowSetup`, `readNewWindows` from `./setups.ts`; `Place`, `PLACE_SLOTS_MAX`, `readPlace`, `readPlaces` from `./windowPlace.ts`.
- Produces on `AppState`:
  - `newWindowSetup(serverId: string): NewWindowSetup | null`
  - `setNewWindowSetup(serverId: string, choice: NewWindowSetup | null): void` — null clears; an invalid choice changes nothing
  - `place(serverId: string, slot: number): Place | null`
  - `setPlace(serverId: string, slot: number, place: Place): void` — a slot outside 1..`PLACE_SLOTS_MAX` or an invalid place changes nothing

- [ ] **Step 1: Write the failing tests**

Append to `src/main/appState.test.ts`:

```ts
const PLACE = { x: -1800, y: 100, maximized: true, fullScreen: false };

test('new windows open with nothing chosen until a choice is saved, and a fresh instance reads it back', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    assert.equal(a.newWindowSetup('lostcity'), null);
    a.setNewWindowSetup('lostcity', { builtIn: 'game-chat-tools' });
    a.setNewWindowSetup('zanaris', { file: 'skilling.json' });
    const b = new AppState(file);
    b.load();
    assert.deepEqual(b.newWindowSetup('lostcity'), { builtIn: 'game-chat-tools' });
    assert.deepEqual(b.newWindowSetup('zanaris'), { file: 'skilling.json' });
    assert.equal(b.newWindowSetup('lostcitylabs'), null);
});

test('a choice cleared goes back to nothing, and one that is not a choice changes nothing', () => {
    const a = new AppState(tempFile());
    a.load();
    a.setNewWindowSetup('lostcity', { builtIn: 'game' });
    a.setNewWindowSetup('lostcity', { file: '../state.json' });
    assert.deepEqual(a.newWindowSetup('lostcity'), { builtIn: 'game' });
    a.setNewWindowSetup('lostcity', null);
    assert.equal(a.newWindowSetup('lostcity'), null);
});

test('a stored choice naming a path, or a built-in the kit does not know, is dropped while the rest load', () => {
    const file = tempFile();
    writeFileSync(
        file,
        JSON.stringify({
            version: 1,
            worlds: { lostcity: REMEMBERED },
            newWindows: { lostcity: { builtIn: 'game' }, zanaris: { file: '../../state.json' }, labs: { builtIn: 'everything' } }
        })
    );
    const a = new AppState(file);
    a.load();
    assert.deepEqual(a.newWindowSetup('lostcity'), { builtIn: 'game' });
    assert.equal(a.newWindowSetup('zanaris'), null);
    assert.equal(a.newWindowSetup('labs'), null);
    assert.deepEqual(a.world('lostcity'), REMEMBERED);
});

test('a place saves per server and window number, and a fresh instance reads it back', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    a.setPlace('lostcity', 1, PLACE);
    a.setPlace('lostcity', 2, { ...PLACE, x: 40, maximized: false });
    const b = new AppState(file);
    b.load();
    assert.deepEqual(b.place('lostcity', 1), PLACE);
    assert.deepEqual(b.place('lostcity', 2), { ...PLACE, x: 40, maximized: false });
    assert.equal(b.place('lostcity', 3), null);
    assert.equal(b.place('zanaris', 1), null);
});

test('a window numbered past the last one kept, or a place that is not one, is not recorded', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    a.setPlace('lostcity', 17, PLACE);
    a.setPlace('lostcity', 0, PLACE);
    a.setPlace('lostcity', 1, { ...PLACE, x: 1.5 });
    a.setPlace('', 1, PLACE);
    assert.equal(a.place('lostcity', 17), null);
    assert.equal(a.place('lostcity', 1), null);
    a.setPlace('lostcity', 16, PLACE);
    const b = new AppState(file);
    b.load();
    assert.deepEqual(b.place('lostcity', 16), PLACE);
});

test('a bad stored place costs only itself', () => {
    const file = tempFile();
    writeFileSync(
        file,
        JSON.stringify({ version: 1, worlds: {}, places: { lostcity: { '1': PLACE, '2': { x: 'left' } }, zanaris: [PLACE] } })
    );
    const a = new AppState(file);
    a.load();
    assert.deepEqual(a.place('lostcity', 1), PLACE);
    assert.equal(a.place('lostcity', 2), null);
    assert.equal(a.place('zanaris', 1), null);
});

test('a file written before either existed loads with no choices and no places', () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ version: 1, worlds: { lostcity: REMEMBERED } }));
    const a = new AppState(file);
    a.load();
    assert.equal(a.newWindowSetup('lostcity'), null);
    assert.equal(a.place('lostcity', 1), null);
});

test('what a place getter hands back is a copy', () => {
    const a = new AppState(tempFile());
    a.load();
    a.setPlace('lostcity', 1, PLACE);
    a.place('lostcity', 1)!.x = 0;
    assert.deepEqual(a.place('lostcity', 1), PLACE);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test src/main/appState.test.ts`
Expected: FAIL, `a.newWindowSetup is not a function`.

- [ ] **Step 3: Implement in `src/main/appState.ts`**

Imports, after the `picturesNamedIn` import:

```ts
import { readNewWindowSetup, readNewWindows, type NewWindowSetup } from './setups.ts';
import { PLACE_SLOTS_MAX, readPlace, readPlaces, type Place } from './windowPlace.ts';
```

`StateFile`, after `appearance`:

```ts
    /** What new windows of each server open with, by server id (`setups.NewWindowSetup`). A server with none opens Game and Chat. */
    newWindows: Record<string, NewWindowSetup>;
    /** Where each server's windows were when they last closed, by server id and window number (`windowPlace.Place`). */
    places: Record<string, Record<string, Place>>;
```

Fields, after `private appearanceState ...`:

```ts
    // Per server, the setup its new windows open with; none is Game and Chat.
    private newWindows = new Map<string, NewWindowSetup>();
    // Per server and window number, where that window last closed.
    private places = new Map<string, Map<number, Place>>();
```

In `load()`, after `this.appearanceState = defaultAppearance();`:

```ts
        this.newWindows = new Map();
        this.places = new Map();
```

In `readFields`, after `this.appearanceState = readAppearance(parsed?.appearance);`:

```ts
        this.newWindows = readNewWindows(parsed?.newWindows);
        this.places = readPlaces(parsed?.places);
```

Accessors, after `setStartupServer`:

```ts
    /** What new windows of this server open with, or null for Game and Chat. A copy. */
    newWindowSetup(serverId: string): NewWindowSetup | null {
        const choice = this.newWindows.get(serverId);
        return choice ? { ...choice } : null;
    }

    /** Read back through `readNewWindowSetup` on the way in, as a file would be, so nothing stored here is something a later load would drop. Null clears it. */
    setNewWindowSetup(serverId: string, choice: NewWindowSetup | null): void {
        if (serverId === '') return;
        if (choice === null) {
            if (!this.newWindows.delete(serverId)) return;
        } else {
            const read = readNewWindowSetup(choice);
            if (!read) return;
            this.newWindows.set(serverId, read);
        }
        this.save();
    }

    /** Where this server's window of this number last closed, or null. A copy. */
    place(serverId: string, slot: number): Place | null {
        const place = this.places.get(serverId)?.get(slot);
        return place ? { ...place } : null;
    }

    /**
     * Written as a window closes, which a quit does to every window. A slot
     * past `PLACE_SLOTS_MAX`, or a place a load would not read back, changes
     * nothing; the same place again writes nothing.
     */
    setPlace(serverId: string, slot: number, place: Place): void {
        const read = readPlace(place);
        if (serverId === '' || !read || !Number.isInteger(slot) || slot < 1 || slot > PLACE_SLOTS_MAX) return;
        const slots = this.places.get(serverId) ?? new Map<number, Place>();
        const was = slots.get(slot);
        if (was && was.x === read.x && was.y === read.y && was.maximized === read.maximized && was.fullScreen === read.fullScreen) return;
        slots.set(slot, read);
        this.places.set(serverId, slots);
        this.save();
    }
```

In `save()`, after `appearance: this.appearance()`:

```ts
            newWindows: Object.fromEntries(this.newWindows),
            places: Object.fromEntries([...this.places].map(([id, slots]) => [id, Object.fromEntries(slots)]))
```

The class comment (above `export class AppState`) lists what the file holds. After "which servers a launch opens," add "what each server's new windows open with and where each of its windows last closed,".

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test src/main/appState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/appState.ts src/main/appState.test.ts
git commit -m "feat: state.json keeps new windows' setup and each window's place

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: A window opens with its setup, at its place

**Files:**
- Modify: `src/main/tabs.ts` (`openWindowTabs`), `src/main/tabs.test.ts`
- Modify: `src/main/paneHost.ts` (`PaneHostDeps.initialSize`)
- Modify: `src/main/serverWindow.ts` (window construction, deps)
- Modify: `src/main/index.ts` (deps)

**Interfaces:**
- Consumes: Task 1's `openingFrame`, `Place`; Task 2's `openingSetup`, `NewWindowSetup`; Task 3's `appState.place`, `appState.newWindowSetup`; `arrangeForGame(tree: PaneNode, saved: Size | null, want: Size | null): { tree: PaneNode; size: Size | null }`, `arrangedAt(tree, at): Fitted`, `refit`, `instantiateLayout(stored, { tools, links, nextPane, nextSplit })`.
- Produces:
  - `openWindowTabs(tree: PaneNode, saved: Size | null): { set: TabSet; size: Size | null }`
  - `PaneHostDeps.initialSize: Size | null`
  - `ServerWindowDeps.place: Place | null`, `.cascade: { x: number; y: number } | null`, `.newWindowSetup: () => NewWindowSetup | null` (and `position` removed)

- [ ] **Step 1: Rewrite `openWindowTabs`'s tests in `src/main/tabs.test.ts`**

Replace the imports and everything from `/** The game's and chat's heights ...` through the test `"a split made inside the window's opening arrangement gets an id of its own"` with:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangedAt, contentOf, layoutTree, leaf, paneIds, refit, split, type PaneNode } from './paneTree.ts';
import { closeTab, closingTab, labelOfTab, loadingLayout, marksOfTab, moveGame, newTab, nextIds, openTabs, openWindowTabs, selectTab, sharingWithoutPane } from './tabs.ts';
import { builtInSetups } from './setups.ts';
import { instantiateLayout } from './layoutFile.ts';
import { CHAT_PREFERRED_HEIGHT, GAME_PREFERRED_HEIGHT, LOSTCITY_GAME_PREFERRED_HEIGHT, PANE_MIN_HEIGHT, SEAM } from '../shared/layout.ts';

test('a one-pane set holds whatever it was given', () => {
    const set = openTabs('tab-1', 'pane-1', { kind: 'game' });
    assert.deepEqual(set.tabs[0]!.tree, leaf('pane-1', { kind: 'game' }));
});

/** Game and Chat made real as a window makes it, with the window's own counters. */
function gameAndChat(gameHeight: number = GAME_PREFERRED_HEIGHT): ReturnType<typeof openWindowTabs> {
    const setup = builtInSetups({ tools: ['chat'], gameHeight }).find(s => s.id === 'game-chat')!;
    let pane = 1;
    let splitN = 1;
    const tree = instantiateLayout(setup.tree, { tools: ['chat'], links: [], nextPane: () => `pane-${pane++}`, nextSplit: () => `split-${splitN++}` });
    return openWindowTabs(tree, setup.size);
}

/** The game's and chat's heights in a window whose tree is this tall, fitted as the host fits the first layout. */
function heights(treeHeight: number, gameHeight: number = GAME_PREFERRED_HEIGHT): { game: number; chat: number } {
    const { set, size } = gameAndChat(gameHeight);
    const tree = set.tabs[0]!.tree;
    const shown = refit(arrangedAt(tree, size!), tree, { width: 765, height: treeHeight }).shown;
    const rects = layoutTree(shown, { x: 0, y: 0, width: 765, height: treeHeight }).panes;
    return { game: rects.get('pane-1')!.height, chat: rects.get('pane-2')!.height };
}

test('a new window opens on the game with chat below it, the game focused', () => {
    const { set } = gameAndChat();
    const tree = set.tabs[0]!.tree;
    assert.equal(tree.kind === 'split' && tree.axis, 'y', 'stacked, not side by side');
    assert.deepEqual(
        paneIds(tree).map(id => contentOf(tree, id)),
        [{ kind: 'game' }, { kind: 'tool', tool: 'chat' }]
    );
    assert.equal(set.tabs[0]!.focusedPaneId, 'pane-1', 'so a split starts from the game rather than from chat');
});

test('at the size a window opens at, the game and chat each get exactly what they ask for', () => {
    assert.deepEqual(gameAndChat().size, { width: 765, height: GAME_PREFERRED_HEIGHT + SEAM + CHAT_PREFERRED_HEIGHT });
    assert.deepEqual(heights(GAME_PREFERRED_HEIGHT + SEAM + CHAT_PREFERRED_HEIGHT), { game: GAME_PREFERRED_HEIGHT, chat: CHAT_PREFERRED_HEIGHT });
});

test("a server whose client page is taller gets its own game height, and chat still gets what it asks for", () => {
    assert.deepEqual(heights(LOSTCITY_GAME_PREFERRED_HEIGHT + SEAM + CHAT_PREFERRED_HEIGHT, LOSTCITY_GAME_PREFERRED_HEIGHT), {
        game: LOSTCITY_GAME_PREFERRED_HEIGHT,
        chat: CHAT_PREFERRED_HEIGHT
    });
});

test('on a short display chat gives way first, down to its floor, and the game keeps its height', () => {
    assert.deepEqual(heights(GAME_PREFERRED_HEIGHT + SEAM + 120), { game: GAME_PREFERRED_HEIGHT, chat: 120 });
    assert.deepEqual(heights(GAME_PREFERRED_HEIGHT + SEAM + PANE_MIN_HEIGHT), { game: GAME_PREFERRED_HEIGHT, chat: PANE_MIN_HEIGHT });
});

test('shorter still, the game gives way and chat holds its floor', () => {
    assert.deepEqual(heights(500), { game: 500 - SEAM - PANE_MIN_HEIGHT, chat: PANE_MIN_HEIGHT });
});

test('below two floors the two are shared in proportion, and nothing is negative', () => {
    const tiny = heights(120);
    assert.equal(tiny.game + tiny.chat, 120 - SEAM);
    assert.ok(tiny.game > 0 && tiny.chat > 0);
    const { game, chat } = heights(0);
    assert.ok(game >= 0 && chat >= 0);
});

test("a split made inside the window's opening arrangement gets an id of its own", () => {
    assert.deepEqual(nextIds(gameAndChat().set), { pane: 3, tab: 2, split: 2 });
});

test('a window opens focused on its game wherever the setup put it', () => {
    const tree: PaneNode = split('split-1', 'x', [leaf('pane-1', { kind: 'tool', tool: 'timers' }), leaf('pane-2', { kind: 'game' })], [0.3, 0.7]);
    assert.equal(openWindowTabs(tree, { width: 1100, height: 600 }).set.tabs[0]!.focusedPaneId, 'pane-2');
});

test('a setup with no size opens with none, to be laid out by its fractions', () => {
    const tree: PaneNode = leaf('pane-1', { kind: 'game' });
    assert.equal(openWindowTabs(tree, null).size, null);
});

test('a saved size under the tree’s floor is raised to it', () => {
    const tree: PaneNode = split('split-1', 'y', [leaf('pane-1', { kind: 'game' }), leaf('pane-2', { kind: 'tool', tool: 'chat' })], [0.5, 0.5]);
    assert.deepEqual(openWindowTabs(tree, { width: 10, height: 10 }).size, { width: 120, height: PANE_MIN_HEIGHT * 2 + SEAM });
});
```

(`split` and `PaneNode` were not imported before; the rest of the file's tests are unchanged and keep using `openTabs`, `newTab` and the others.)

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test src/main/tabs.test.ts`
Expected: FAIL — `openWindowTabs` still takes `(treeHeight, gameHeight)`, so `gameAndChat().size` is undefined.

- [ ] **Step 3: Rewrite `openWindowTabs` in `src/main/tabs.ts`**

Imports: replace the first two lines with

```ts
import { arrangeForGame, clearGame, contentOf, leaf, paneIds, setContent, type PaneContent, type PaneNode, type Size } from './paneTree.ts';
```

(`split`, `CHAT_PREFERRED_HEIGHT`, `GAME_PREFERRED_HEIGHT`, `PANE_MIN_HEIGHT` and `SEAM` were only `openWindowTabs`'s; check with `grep -n 'split(\|SEAM\|PANE_MIN_HEIGHT\|GAME_PREFERRED\|CHAT_PREFERRED' src/main/tabs.ts` after the edit and keep any still used.)

Replace the whole comment and body of `openWindowTabs` with:

```ts
/**
 * The tab a new window opens with: one tab holding `tree`, the setup its
 * server's new windows open with made real in this window
 * (`setups.openingSetup`), focused on the game, so Cmd/Ctrl+D and a
 * right-click's splits start from the pane the player is looking at.
 *
 * `saved` is the tab size the setup was made at. The tree comes back
 * arranged at that size, raised to the tree's own floor
 * (`paneTree.arrangeForGame`), with the size it was arranged at: the window
 * is built to hold it, and the host fits the first layout from it, so on a
 * display too small for the setup the other panes give way to their floors
 * before the game does. Game and Chat on a short display is chat giving way
 * first, as it always was. A null `saved`, a setup from before setups
 * carried a size, comes back null: laid out by its fractions.
 *
 * Every setup a window opens with holds the game; with none, it would focus
 * the first pane.
 */
export function openWindowTabs(tree: PaneNode, saved: Size | null): { set: TabSet; size: Size | null } {
    const arranged = arrangeForGame(tree, saved, null);
    const ids = paneIds(arranged.tree);
    const focus = ids.find(id => contentOf(arranged.tree, id)?.kind === 'game') ?? ids[0]!;
    return { set: { tabs: [{ id: 'tab-1', tree: arranged.tree, focusedPaneId: focus }], activeId: 'tab-1' }, size: arranged.size };
}
```

Also fix `openTabs`'s comment, which says it is "the one a window opened on before it opened on the game and chat together" — still true; leave it.

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test src/main/tabs.test.ts`
Expected: PASS. If a short-display test fails, stop: the spec says `openWindowTabs`'s old numbers must hold, and a difference means `refit` does not do what it did. Report it rather than changing the expected numbers.

- [ ] **Step 5: `paneHost.ts` takes the size the first tab was arranged at**

In `PaneHostDeps`, replace the `initial` doc comment and add `initialSize`:

```ts
    /**
     * The tab a window opens with: the setup its server's new windows open
     * with (`tabs.openWindowTabs`). Nothing is carried over from last time on
     * its own — a setup is chosen, or saved and opened, from the tab bar's
     * Setups menu.
     */
    initial: TabSet;
    /**
     * The size `initial`'s tab was arranged at, or null to lay it out by its
     * fractions. The first layout is fitted from it as a resize is, so a
     * window its display held smaller than its setup keeps the game.
     */
    initialSize: Size | null;
```

After `const fits = new Map<string, Fitted>();` add:

```ts
    if (deps.initialSize) fits.set(set.activeId, arrangedAt(active(), deps.initialSize));
```

(`arrangedAt` and `Size` are already imported in `paneHost.ts`.)

- [ ] **Step 6: `serverWindow.ts` builds the window at its setup and place**

Imports — change these lines:

```ts
import { SETUP_PANES_MAX, instantiateLayout, layoutEntries, layoutFileName, readSetup, writeLayout, type StoredNode } from './layoutFile';
import { builtInSetups, openingSetup, type BuiltInSetupId, type NewWindowSetup } from './setups';
import { openingFrame, type Place } from './windowPlace';
```

Remove `FRAME_ALLOWANCE` and its comment (lines 48-56; it now lives in `windowPlace.ts`).

In `ServerWindowDeps`, replace `position: { x: number; y: number } | null;` with:

```ts
    /**
     * Where this server's window of this number last closed, or null: none
     * recorded, or a capture, which reads none. `windowPlace.openingFrame`
     * decides whether it can still be used.
     */
    place: Place | null;
    /** 32px from the focused or last-opened game window, for when there is no place to go back to; null when none is open. */
    cascade: { x: number; y: number } | null;
    /** What new windows of this server open with, as stored, or null for Game and Chat. A getter: the Setups menu reads it again each time it opens. */
    newWindowSetup: () => NewWindowSetup | null;
```

Replace the block from the comment `/* The game and chat together are taller than some laptop displays can show, ...` through `const openHeight = ...;` with:

```ts
    /*
     * What the window opens with and where, both decided before it exists
     * (`setups.openingSetup`, `windowPlace.openingFrame`): the setup chosen for
     * this server's new windows, or Game and Chat, at the place this window's
     * number last closed at if its tab bar can still be reached. So the window
     * is built at its size and place rather than opened and then moved, and
     * opening it is not one of the things that resize a window. The size is
     * held to the display it opens on, and the first layout is fitted to the
     * size it got as a resize is (`tabs.openWindowTabs`).
     */
    const content = defaultContent(server.id);
    const opening = openingSetup(deps.newWindowSetup(), { builtIns: builtInSetups({ tools, gameHeight: content.game }), saved: savedSetups(), read: readSaved });
    deps.log(`${tag} opens with ${opening.name}${opening.fellBack ? `, not the setup chosen: ${opening.fellBack}` : ''}`);
    let openingPane = 1;
    let openingSplit = 1;
    const start = openWindowTabs(
        instantiateLayout(opening.tree, { tools, links: server.bookmarks, nextPane: () => `pane-${openingPane++}`, nextSplit: () => `split-${openingSplit++}` }),
        opening.size
    );
    // A saved setup from before setups carried a size opens at Game and Chat's, laid out by its fractions.
    const tab = start.size ?? { width: content.width, height: content.height };
    const opened = openingFrame({
        content: { width: tab.width, height: TAB_BAR_HEIGHT + tab.height },
        remembered: deps.place,
        cascade: deps.cascade,
        workAreas: screen.getAllDisplays().map(display => display.workArea),
        cursor: screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    });
```

In the `new BrowserWindow({...})` options, replace `width: content.width,` and `height: openHeight,` with `...opened.frame,` and delete `...(deps.position ?? {}),`.

In `createPaneHost({...})`, replace `initial: openWindowTabs(win.getContentBounds().height - TAB_BAR_HEIGHT, content.game),` with:

```ts
        initial: start.set,
        initialSize: start.size,
```

Add a reader beside `savedSetups()` and use it in `openSetupFrom`:

```ts
    /** A setup file's text, sized before it is read: a setup is a few kilobytes, and anything dropped into the folder is listed. Throws when it cannot be read. */
    function readSetupText(path: string): string {
        if (statSync(path).size > SETUP_FILE_MAX) throw new Error('far larger than any setup');
        return readFileSync(path, 'utf8');
    }

    /** One of the folder's entries as `setups.openingSetup` reads it: its text, or null, logged, when it cannot be read. */
    function readSaved(file: string): string | null {
        try {
            return readSetupText(join(deps.setupsDir, file));
        } catch (err) {
            deps.log(`${tag} could not read ${file}: ${(err as Error).message}`);
            return null;
        }
    }
```

and in `openSetupFrom`, replace the two lines inside its `try` (the comment, `if (statSync(path).size > SETUP_FILE_MAX) ...` and `text = readFileSync(path, 'utf8');`) with `text = readSetupText(path);`.

`savedSetups`, `readSetupText` and `readSaved` are function declarations inside `createServerWindow`, so they are hoisted above the construction that calls them; they read only `deps` and `tag`, both set before it.

`content.game` is still what the Setups menu's built-ins and Reset Game Size use: leave those.

- [ ] **Step 7: `index.ts` hands the window its place and its server's choice**

In the deps passed to `createServerWindow`, replace `position: nextPosition(),` with:

```ts
                place: CAPTURE_DIR ? null : appState.place(spec.server.id, spec.slot),
                cascade: nextPosition(),
                newWindowSetup: () => appState.newWindowSetup(spec.server.id),
```

and replace `nextPosition`'s comment `/** New windows cascade from the focused one, so several can open without stacking exactly. */` with:

```ts
/**
 * Where a new window cascades to when it has no place of its own to go back
 * to (`windowPlace.openingFrame`): 32px from the focused one, so several can
 * open without stacking exactly.
 */
```

- [ ] **Step 8: Typecheck and test**

Run: `npm run typecheck && npm test`
Expected: no type errors; every test passes.

- [ ] **Step 9: Commit**

```bash
git add src/main/tabs.ts src/main/tabs.test.ts src/main/paneHost.ts src/main/serverWindow.ts src/main/index.ts
git commit -m "feat: a window opens with its server's setup, at its place

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Choosing the setup, recording the place, restoring the states

**Files:**
- Modify: `src/main/serverWindow.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `opensWindow`, `sameSetup`, `openingSetup`, `NewWindowSetup` (Task 2); `placeOf`, `Place` (Task 1); `appState.setNewWindowSetup`, `appState.setPlace` (Task 3); `opened` and `start` from Task 4's construction.
- Produces: `ServerWindowDeps.setNewWindowSetup: (choice: NewWindowSetup) => void`, `ServerWindowDeps.rememberPlace: (place: Place) => void`.

- [ ] **Step 1: Deps**

In `ServerWindowDeps`, after `newWindowSetup`:

```ts
    /** Stores what new windows of this server open with: the Setups menu's Open New Windows With. */
    setNewWindowSetup: (choice: NewWindowSetup) => void;
    /** Records where this window is as its close goes through, for the next window of its server and number. Main drops it in a capture. */
    rememberPlace: (place: Place) => void;
```

Imports: `import { builtInSetups, openingSetup, opensWindow, sameSetup, type BuiltInSetupId, type NewWindowSetup } from './setups';` and `import { openingFrame, placeOf, type Place } from './windowPlace';`.

- [ ] **Step 2: Record the place as the close goes through**

Replace

```ts
    win.on('close', event => {
        if (!deps.confirmClose(spec.title)) event.preventDefault();
    });
```

with

```ts
    win.on('close', event => {
        if (!deps.confirmClose(spec.title)) {
            event.preventDefault();
            return;
        }
        // Here rather than in 'closed', where the window can no longer say
        // where it is; and only once the close is going through, so a
        // Cancel records nothing. A quit closes every window this way. The
        // normal bounds, so a window closed maximised, full screen or
        // minimised records where it goes back to when it is none of those.
        deps.rememberPlace(placeOf(win.getNormalBounds(), win.isMaximized(), win.isFullScreen()));
    });
```

- [ ] **Step 3: Restore maximised and full screen as the window is shown**

Replace

```ts
    shellView.webContents.once('did-finish-load', () => {
        if (win.isDestroyed()) return;
        applyLayout();
        if (!deps.headless) win.show();
    });
```

with

```ts
    shellView.webContents.once('did-finish-load', () => {
        if (win.isDestroyed()) return;
        applyLayout();
        // A capture's window is never shown, so never maximised or made full
        // screen here either: maximising shows a hidden window.
        if (deps.headless) return;
        // Maximised before it is shown, so it never draws at its normal size
        // first, and unmaximising it puts it at its place. `show` still gives
        // it focus. Full screen is asked for once the window is on screen.
        if (opened.maximized) win.maximize();
        win.show();
        if (opened.fullScreen) win.setFullScreen(true);
    });
```

- [ ] **Step 4: The Setups menu's Open New Windows With**

In `showSetupsMenu`, after `{ label: 'Open Setups Folder', click: () => void openSetupsFolder() }` add:

```ts
            { type: 'separator' },
            { label: 'Open New Windows With', submenu: newWindowsItems() }
```

and add, after `showSetupsMenu`:

```ts
    /**
     * Open New Windows With: the built-ins, then the saved setups, with the
     * one the next window of this server would open with ticked. The tick is
     * `openingSetup`'s answer, the one a window opening now would act on, so a
     * choice that can no longer be used ticks Game and Chat, which is what
     * would open instead. A saved setup that cannot be a new window's — no
     * game in it, or not a setup — is greyed. Checkboxes rather than radios,
     * for the reason the View menu's Server Theme gives: the separator makes
     * two radio groups, and Electron ticks the first of a group with none.
     */
    function newWindowsItems(): MenuItemConstructorOptions[] {
        const builtIns = builtInSetups({ tools, gameHeight: content.game });
        const saved = savedSetups();
        const texts = new Map(saved.map(entry => [entry.file, readSaved(entry.file)]));
        const ticked = openingSetup(deps.newWindowSetup(), { builtIns, saved, read: file => texts.get(file) ?? null }).used;
        const item = (label: string, choice: NewWindowSetup, enabled: boolean): MenuItemConstructorOptions => ({
            label,
            type: 'checkbox',
            checked: sameSetup(ticked, choice),
            enabled,
            click: () => deps.setNewWindowSetup(choice)
        });
        return [
            ...builtIns.map(setup => item(setup.name, { builtIn: setup.id }, true)),
            ...(saved.length === 0 ? [] : [{ type: 'separator' as const }, ...saved.map(entry => item(entry.name, { file: entry.file }, opensWindow(texts.get(entry.file) ?? '')))])
        ];
    }
```

Update `showSetupsMenu`'s comment, which says "Whatever you pick replaces the panes of the tab in front": add a sentence, "Except Open New Windows With, which changes nothing on screen: it is what this server's next windows open with."

- [ ] **Step 5: `index.ts` stores both**

In the deps, after `newWindowSetup: ...`:

```ts
                setNewWindowSetup: choice => appState.setNewWindowSetup(spec.server.id, choice),
                // A capture records nowhere: no run depends on where the
                // last one left its windows. A failed write is logged, and
                // the window still closes.
                rememberPlace: place => {
                    if (CAPTURE_DIR) return;
                    try {
                        appState.setPlace(spec.server.id, spec.slot, place);
                    } catch (err) {
                        log(`[main] could not remember where ${spec.title} was: ${(err as Error).message}`);
                    }
                },
```

- [ ] **Step 6: Typecheck and test**

Run: `npm run typecheck && npm test`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/main/serverWindow.ts src/main/index.ts
git commit -m "feat: Open New Windows With, and a window's place recorded as it closes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Capture drives both

**Files:**
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: everything above; capture's own `openServer`, `loaded`, `shoot`, `panesOf`, `wait`, `fault`, `settleMs`, `first`.
- Produces: a module-level `let capturePlace: Place | null` read by the deps in a capture.

- [ ] **Step 1: A place a capture can hand a window**

Near `const CAPTURE_DIR = process.env.ZANARIS_CAPTURE;`, after the `appendSwitch` line, add:

```ts
/**
 * The place a capture hands the next window it opens, through the same deps a
 * remembered one comes by, so a run can check a window opens at its place
 * without reading or writing the profile's own.
 */
let capturePlace: Place | null = null;
```

and in the deps change `place: CAPTURE_DIR ? null : appState.place(...)` to `place: CAPTURE_DIR ? capturePlace : appState.place(spec.server.id, spec.slot),`.

Imports in `index.ts`: `import { leaf, split, type PaneContent } from './paneTree';` (replacing the type-only import), `import { writeLayout } from './layoutFile';` (check it is not imported already), `import type { NewWindowSetup } from './setups';`, `import type { Place } from './windowPlace';`, and add `GAME_PREFERRED_HEIGHT` to the existing `../shared/layout` import.

- [ ] **Step 2: Start every capture from no choices**

In `captureAndExit`, after `prunePictures();` in the reset at the top of its `try`:

```ts
        // Every window a capture opens is Game and Chat unless a step below
        // says otherwise, whatever a run that died mid-step left chosen.
        for (const server of catalog.list()) appState.setNewWindowSetup(server.id, null);
```

- [ ] **Step 3: The steps**

After the setup block's `finally { rmSync(setupPath, { force: true }); }` and before the `// Themes.` comment:

```ts
        // What new windows open with, and where. Each is opened as File >
        // New Window opens one, read back, and destroyed — `close` would
        // raise a confirm nothing here can answer. The choices are set on the
        // state, since the Setups menu is native, and cleared after.
        {
            const server = first.state().server;
            const made: ServerWindow[] = [];
            const sized = (sw: ServerWindow): string => {
                const { width, height } = sw.window.getContentBounds();
                return `${width}x${height}`;
            };
            const openWith = async (choice: NewWindowSetup | null, shot: string | null): Promise<ServerWindow> => {
                appState.setNewWindowSetup(server.id, choice);
                const sw = openServer(server);
                made.push(sw);
                log(`[capture] ${sw.state().title}: new window with ${choice ? JSON.stringify(choice) : 'nothing chosen'} — "${panesOf(sw)}" at ${sized(sw)}`);
                if (shot) {
                    log(`[capture] ${sw.state().title}: ${await loaded(sw)}`);
                    await wait(Math.min(settleMs, 8_000));
                    await shoot(shot, sw);
                }
                return sw;
            };
            const setupsDir = join(userData, 'setups', slugify(server.id));
            const savedFile = 'capture-game-and-timers.json';
            try {
                const tools = await openWith({ builtIn: 'game-chat-tools' }, `${server.id}-new-tools`);
                if (panesOf(tools) === 'game over chat') fault(`new window: Game, Chat and Tools opened as Game and Chat`);

                mkdirSync(setupsDir, { recursive: true });
                const width = GAME_PREFERRED_WIDTH + SEAM + 400;
                const gameAndTimers = split('split-1', 'x', [leaf('pane-1', { kind: 'game' }), leaf('pane-2', { kind: 'tool', tool: 'timers' })], [GAME_PREFERRED_WIDTH / (width - SEAM), 400 / (width - SEAM)]);
                writeFileSync(join(setupsDir, savedFile), writeLayout(gameAndTimers, server.id, { width, height: GAME_PREFERRED_HEIGHT }));
                const saved = await openWith({ file: savedFile }, `${server.id}-new-saved`);
                if (panesOf(saved) !== 'game over timers') fault(`new window: the saved setup opened as "${panesOf(saved)}"`);
                if (sized(saved) !== `${width}x${TAB_BAR_HEIGHT + GAME_PREFERRED_HEIGHT}`) log(`[capture] new window: the saved setup is ${sized(saved)}, not ${width}x${TAB_BAR_HEIGHT + GAME_PREFERRED_HEIGHT} — expected only on a display too small for it`);

                const missing = await openWith({ file: 'capture-no-such-setup.json' }, null);
                if (panesOf(missing) !== 'game over chat') fault(`new window: a missing setup opened as "${panesOf(missing)}", not Game and Chat`);

                const area = screen.getPrimaryDisplay().workArea;
                capturePlace = { x: area.x + 48, y: area.y + 36, maximized: false, fullScreen: false };
                const placed = await openWith(null, null);
                const at = placed.window.getBounds();
                log(`[capture] ${placed.state().title}: opened at ${at.x},${at.y} for a place at ${capturePlace.x},${capturePlace.y}`);
                if (at.x !== capturePlace.x || at.y !== capturePlace.y) fault(`place: ${placed.state().title} opened at ${at.x},${at.y}, not at its place ${capturePlace.x},${capturePlace.y}`);

                capturePlace = { x: -100_000, y: -100_000, maximized: false, fullScreen: false };
                const lost = await openWith(null, null);
                const fell = lost.window.getBounds();
                log(`[capture] ${lost.state().title}: a place on no display opened it at ${fell.x},${fell.y}`);
                if (fell.x === capturePlace.x || fell.y === capturePlace.y) fault(`place: ${lost.state().title} opened on no display`);
            } finally {
                capturePlace = null;
                appState.setNewWindowSetup(server.id, null);
                rmSync(join(setupsDir, savedFile), { force: true });
                for (const sw of made) if (!sw.window.isDestroyed()) sw.window.destroy();
                await wait(500);
            }
        }
```

Check each name against `index.ts` before using it: `GAME_PREFERRED_WIDTH`, `TAB_BAR_HEIGHT` and `SEAM` from `../shared/layout` (add what is missing to the import), `mkdirSync`/`writeFileSync`/`rmSync` from `node:fs`, `userData`, `slugify`, `screen`. `panesOf` joins every pane's kind or tool with " over " whatever the axis, so a side-by-side game and timers reads "game over timers".

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "test: capture opens new windows with a built-in, a saved setup, a missing one, and at a place

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: README, the catalog section**

Replace

> `<userData>/state.json` remembers the last world and detail per server, and
> whether the switch confirmation still shows. It is
> not configuration and never interrupts a launch: a broken file is kept aside
> and the state starts empty. It does not remember how the panes were arranged:
> that is saved only when you ask, as a setup (see Layout below).

with

> `<userData>/state.json` remembers the last world and detail per server,
> whether the switch confirmation still shows, which setup each server's new
> windows open with, and where each window was when it last closed. It is
> not configuration and never interrupts a launch: a broken file is kept aside
> and the state starts empty. It does not remember how the panes were arranged:
> that is saved only when you ask, as a setup (see Layout below).

- [ ] **Step 2: README, Layout — Reset Game Size and the game's opening size**

In the paragraph beginning "Resizing the window leaves the game alone.", replace "moves the seams around the game until it is back at the size a window opens it at" with "moves the seams around the game until it is back at its preferred size, the size the kit's own setups open it at".

In the paragraph beginning "What a small game pane costs", replace "is what a game pane *asks for* when it is first placed, what the window opens at and what Reset Game Size goes back to, not a floor anything protects." with "is what a game pane *asks for*: the size the kit's own setups place it at and what Reset Game Size goes back to, not a floor anything protects."

- [ ] **Step 3: README, Layout — what a new window opens with, and where**

Replace the paragraph beginning "Nothing about the arrangement is saved on its own." (through "before the game loses any height.") with:

> Nothing about the arrangement is saved on its own. A new window opens with
> the setup chosen for its server's new windows (Setups, below), or Game and
> Chat when none is: the game at its full 765x567 (765x573 on Lost City, whose
> client page has a taller controls strip and drew scrollbars at the stock
> size), a 232px chat pane below it, and the game's pane focused, so a split
> starts from the game rather than from chat. The window is built at the
> setup's size, no bigger than the display it opens on; on a display too
> short, the other panes give way to their floors before the game loses any
> height, as a resize does.
>
> **Where it opens** is the one thing remembered without asking. Each window
> records its place as it closes — a quit closes every window — per server and
> window number, so Lost City and Lost City (2) each come back to their own
> place, maximised or full screen if they were. Only the place: the size is the
> setup's, so a window dragged larger by hand comes back at its setup's size,
> and a size worth keeping is a saved setup. A place whose tab bar would land on
> no display — a monitor since unplugged — is passed over for the usual
> cascade, 32px from the window in front, or the centre of the display under
> the pointer. A capture neither reads nor writes places.

- [ ] **Step 4: README, Layout — Setups**

After the bullet beginning "**Open Setups Folder**", add:

> - **Open New Windows With** chooses what this server's new windows open
>   with — at launch, from the File menu, from Settings and from the dock:
>   any of the kit's own, or a saved setup holding the game. A saved setup
>   without the game is greyed, since a game window opens onto its game. The
>   tick is what the next window will open with: a choice whose file has since
>   gone, or no longer holds the game, ticks Game and Chat, which is what opens
>   instead. The file is read as each window opens, so editing it changes the
>   next window. Choosing changes nothing already open.

- [ ] **Step 5: README, Layout of the source and Next**

In "Layout of the source", after the `src/main/windowFrame.ts` row (two lines), add a row in the same column layout:

```
src/main/windowPlace.ts     pure: where a new window opens, and what a closing
                            one records                                             (tested)
```

and change the `src/main/setups.ts` row to `pure: the built-in setups, and what a new window opens with (tested)` keeping the column alignment of its neighbours (wrap onto a second line as the `tabs.ts` row does if it is too long).

In "Next", item 3, delete " (Reopening what was open at quit landed with the pane tree.)".

- [ ] **Step 6: CLAUDE.md, the layout invariant**

After the line "Those three are the only things that resize the window — not Reset Game Size, not a drop.", add:

> Opening a window is not one of them either: a new window is built at the
> size of the setup its server's new windows open with and at the place its
> number last closed at, both decided before it exists
> (`setups.openingSetup`, `windowPlace.openingFrame`), never opened and then
> moved. Only the place is recorded without being asked for; the size is
> always the setup's.

- [ ] **Step 7: Identity test**

Run: `node --test src/shared/identity.test.ts`
Expected: PASS (no home-directory paths in the docs).

- [ ] **Step 8: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: what new windows open with, and where

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Verify

- [ ] **Step 1:** `npm run typecheck && npm test` — clean.
- [ ] **Step 2:** `caffeinate -d npm run capture`. Exit 0. Grep the log for `opens with`, `new window`, `place`, `could not push state`, `Maximum call stack`. Open `captures/<server>-new-tools-shell.png`, `-new-tools-game.png`, `-new-saved-shell.png`: the first shows a column of tools beside game over chat, the second the game with Timers beside it.
- [ ] **Step 3:** A development run (`npm run dev`, its own profile): open a window, maximise it, quit, launch — it opens maximised, and unmaximising puts it at its place. The same with full screen. Move a window to a second display if there is one, quit, launch — it comes back there.
- [ ] **Step 4:** An independent review of the branch (`superpowers:requesting-code-review`), asked specifically: does a window record its place on every way it can close (tab close, File > Close Window, quit, a crash of the shell), and on none it should not (a Cancel)?
