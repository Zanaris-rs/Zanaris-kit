# Servers Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the server catalog a tool pane reachable from any window — listing, opening, adding and removing servers, and choosing which ones a launch opens.

**Architecture:** A new `'servers'` tool id, ungated so every window offers it. All decidable rules live in one new pure module `src/main/servers.ts` plus `appState.ts` and `tabs.ts`, because `serverWindow.ts`, `index.ts` and the renderer have no test infrastructure. The already-written-but-unreachable `createServer` / `Catalog.add` / `Catalog.remove` are wired up rather than rewritten.

**Spec:** `docs/superpowers/specs/2026-09-20-servers-pane-design.md`

---

## Context

The kit opens into Lost City and never mentions it knows anything else. Startup is one line — `index.ts:1662` calls `actions.newWindow()`, which with no window focused takes `catalog.list()[0]` (`index.ts:423`), first in `DEFAULT_SERVERS`. The rest of the catalog appears only in File > New Window For and the macOS dock menu, so somebody who never opens that menu never learns the kit is not a Lost City client.

The goal here is **discovery**, not convenience. A first-run chooser with a "don't ask again" tick was the original request and is the wrong shape for it: it spends the one moment of attention and then hides forever. So the catalog becomes a pane that is always reachable, and the startup set is a per-server toggle inside it.

Half the work is already written and unreachable: `createServer` (`catalog.ts:225`), `Catalog.add` (`catalog.ts:653`), `Catalog.remove` (`catalog.ts:662`), all tested. `NewServerInput`'s comment already calls itself "what the launcher's add form collects" — a form that has never existed.

---

## Global Constraints

- **Nothing decidable in `serverWindow.ts`, `index.ts` or the renderer.** Rules go in pure modules reachable by `node --test` without Electron.
- **`TOOL_IDS` is append-only.** Saved layout files carry tool ids between people; a kit that stopped knowing one would turn those panes into launchers.
- **Built-in entries cannot be removed.** Verified: at version 5 `migrateCatalog` (`catalog.ts:350`) only validates, and `load()`'s four refresh functions touch only entries already present — so a removed built-in never comes back.
- **The default launch does not change.** An empty or fully-stale startup list resolves to the first catalog entry.
- **No first-run modal, no "don't ask again"** anywhere.
- **No edit form.** Add and remove only.
- **The renderer sends ids and the five `NewServerInput` fields, never a `ServerDef` and never a path.** Main judges all of it.
- **A comment describing behaviour the code does not have is a defect.** Re-read comments around anything you change.
- **Style (unenforced — there is no prettier or eslint; CI runs only `typecheck`, `test`, `build`):** 4 spaces, single quotes, semicolons, ~200-col lines, no trailing commas, no parens on single-param arrows, `/** … */` docstrings that explain *why*.
- **`noUncheckedIndexedAccess` is on** — index access needs `!`. Import specifiers carry the `.ts` extension.
- Identity: commits are **Zanaris274**. `gh` needs `GH_TOKEN=$(gh auth token -u Zanaris274)`.

### Two traps the exploration surfaced

1. **`paneMenu.ts:49` `TOOL_NAMES: Record<ToolId, string>` is the only hard compile break.** Everything else is silent.
2. **`Shell.tsx:57-68`'s inner `switch (pane.content.tool)` has no `default`.** Its return type includes `undefined`, so a missing case **compiles silently and renders an empty pane**. There is no `assertNever` helper in the repo and no lint. This is the most likely silent bug in the whole change.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/main/servers.ts` | **New, pure.** Startup-set resolution, the row model, the removable rule, the IPC input reader. |
| `src/main/servers.test.ts` | **New.** All of the above. |
| `src/main/appState.ts` | Stores the startup list; reports whether the profile is fresh. |
| `src/main/tabs.ts` | `openWindowTabs` takes which tool the bottom pane holds. |
| `src/shared/ipc.ts` | `'servers'` in `TOOL_IDS`; `ServersView` on `ShellState`; four channels; the preload API. |
| `src/main/paneMenu.ts` | `TOOL_NAMES.servers`. |
| `src/main/serverWindow.ts` | Pushes `'servers'` into every window's tools; carries the view. |
| `src/main/index.ts` | IPC handlers, catalog fan-out, startup loop, first-launch flag, capture block. |
| `src/preload/index.ts` | `zanaris.servers.*`. |
| `src/renderer/tools/Servers.tsx` | **New.** The list, the toggles, the add form. |
| `src/renderer/Shell.tsx` | One `case 'servers':`. |

---

## Task 1: The pure rules

**Files:** Create `src/main/servers.ts`, `src/main/servers.test.ts`

**Produces:** `startupServers`, `isRemovable`, `serversView`, `readNewServerInput`, types `ServerRow` / `ServersView`.

- [ ] **Step 1: Write the failing tests.** `src/main/servers.test.ts`, matching house style — `import { test } from 'node:test'`, `import assert from 'node:assert/strict'`, no `describe`, lower-case prose names, third assert argument explaining why.

```ts
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

test('a row carries what the pane draws, and marks the ones a launch opens', () => {
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
```

- [ ] **Step 2: Run them and watch them fail.** `npm test` — expect "Cannot find module './servers.ts'".

- [ ] **Step 3: Write `src/main/servers.ts`.**

```ts
import { DEFAULT_SERVERS } from './catalog.ts';
import type { NewServerInput, ServerDef } from '../shared/catalog.ts';

/**
 * The rules behind the Servers pane, kept here rather than in the window or
 * the renderer for the reason every rule in this kit is: `node --test` reaches
 * this file without Electron, and reaches neither of those.
 */

/** One row of the pane, already named and counted so the renderer works nothing out. */
export interface ServerRow {
    id: string;
    name: string;
    revision: number | null;
    notes: string | null;
    /** How many windows of this server are open, so a row can say so. */
    open: number;
    /** Whether a launch opens this one. */
    atStartup: boolean;
    removable: boolean;
}

export interface ServersView {
    rows: ServerRow[];
}

/**
 * Whether the pane may offer Remove.
 *
 * Never for a built-in. `Catalog.load` does not put a missing built-in back —
 * at version 5 `migrateCatalog` only validates, and the four refresh functions
 * touch only entries already present — so removing one is permanent short of
 * deleting `servers.json`, and there is nothing in the app that would undo it.
 *
 * Judged on the id alone, which is deliberately the conservative direction: a
 * hand-edited file could hold a user's own entry under a built-in's id, and
 * refusing to remove that one costs a trip to the file, while removing a real
 * built-in costs the entry for good.
 */
export function isRemovable(id: string): boolean {
    return !DEFAULT_SERVERS.some(server => server.id === id);
}

/**
 * Which servers a launch opens.
 *
 * Filtering the catalog rather than mapping the stored list does three things
 * at once: an id the catalog no longer holds is dropped, a list naming one
 * twice yields it once, and the windows open in catalog order however the file
 * happened to store them.
 *
 * An empty answer falls back to the first entry, which is exactly what a launch
 * has always done (`index.ts`'s `actions.newWindow`). That is what makes it
 * impossible to launch into no windows at all — whether the list was never set
 * or every server in it has since been removed.
 */
export function startupServers(stored: readonly string[], catalog: readonly ServerDef[]): ServerDef[] {
    const wanted = new Set(stored);
    const chosen = catalog.filter(server => wanted.has(server.id));
    if (chosen.length > 0) return chosen;
    const first = catalog[0];
    return first ? [first] : [];
}

/** Every catalog entry as a row. The pane lists them all; only Remove is ever withheld. */
export function serversView(opts: { catalog: readonly ServerDef[]; startup: readonly string[]; openCounts: ReadonlyMap<string, number> }): ServersView {
    const wanted = new Set(opts.startup);
    return {
        rows: opts.catalog.map(server => ({
            id: server.id,
            name: server.name,
            revision: server.revision,
            notes: server.notes,
            open: opts.openCounts.get(server.id) ?? 0,
            atStartup: wanted.has(server.id),
            removable: isRemovable(server.id)
        }))
    };
}

/**
 * The add form as it arrives over IPC, or null.
 *
 * Shape only. What the values *mean* is `createServer`'s, which the handler
 * runs next and which the form has already run itself — the same function on
 * both sides, as the chat settings and timer forms do it, so the refusal the
 * user sees and the refusal main gives cannot drift apart.
 */
export function readNewServerInput(x: unknown): NewServerInput | null {
    if (typeof x !== 'object' || x === null) return null;
    const i = x as Record<string, unknown>;
    if (typeof i.name !== 'string' || typeof i.url !== 'string') return null;
    if (i.revision !== null && typeof i.revision !== 'number') return null;
    if (i.wikiHome !== null && typeof i.wikiHome !== 'string') return null;
    if (i.notes !== null && typeof i.notes !== 'string') return null;
    return { name: i.name, url: i.url, revision: i.revision, wikiHome: i.wikiHome, notes: i.notes };
}
```

- [ ] **Step 4: Run tests and typecheck.** `npm test && npm run typecheck` — all pass.

- [ ] **Step 5: Add the missing coverage this rule depends on.** Append to `src/main/catalog.test.ts` — there is no test today asserting a removed built-in stays gone, and `isRemovable` exists entirely because of it. Reuse that file's existing `tempFile()` helper.

```ts
test('a removed built-in does not come back on the next load, which is why the pane will not offer Remove for one', () => {
    const file = tempFile();
    const a = new Catalog(file);
    a.load();
    assert.equal(a.remove('lostcity'), true);
    const b = new Catalog(file);
    b.load();
    assert.equal(b.get('lostcity'), undefined, 'nothing in load() re-adopts a missing built-in');
});
```

> Leave `Catalog.remove` itself alone. `catalog.test.ts:736` already removes `lostcitylabs` — a built-in — successfully, and that is correct for a primitive. The rule belongs in `isRemovable`, where it is pure and tested; the handler in Task 6 enforces it.

- [ ] **Step 6: Commit.**

```bash
git add src/main/servers.ts src/main/servers.test.ts src/main/catalog.test.ts
git commit -m "feat: the rules behind a servers pane"
```

---

## Task 2: The stored startup list

**Files:** Modify `src/main/appState.ts`, `src/main/appState.test.ts`

**Consumes:** nothing. **Produces:** `AppState.startupIds(): string[]`, `AppState.setStartupServer(id, on)`, `AppState.fresh(): boolean`.

- [ ] **Step 1: Write the failing tests.** Append to `src/main/appState.test.ts`, reusing its `tempFile()` helper and `afterEach` cleanup.

```ts
test('the startup list saves, and a fresh instance reads it back', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    a.setStartupServer('zanaris', true);
    a.setStartupServer('lostcity', true);
    const b = new AppState(file);
    b.load();
    assert.deepEqual(b.startupIds(), ['zanaris', 'lostcity']);
});

test('setting a server off removes it, and setting one on twice does not duplicate it', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    a.setStartupServer('zanaris', true);
    a.setStartupServer('zanaris', true);
    assert.deepEqual(a.startupIds(), ['zanaris']);
    a.setStartupServer('zanaris', false);
    assert.deepEqual(a.startupIds(), []);
});

test('a hand-edited startup entry that is not a string costs its own row and not the file', () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ version: 1, worlds: {}, startup: ['zanaris', 7, '', 'lostcity'] }));
    const state = new AppState(file);
    state.load();
    assert.deepEqual(state.startupIds(), ['zanaris', 'lostcity']);
});

test('a profile is fresh only when there was no state file at all', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    assert.equal(a.fresh(), true);
    a.setWarnOnSwitch(false);
    const b = new AppState(file);
    b.load();
    assert.equal(b.fresh(), false);
});
```

- [ ] **Step 2: Run them and watch them fail.** `npm test` — `setStartupServer is not a function`.

- [ ] **Step 3: Implement.** In `src/main/appState.ts`:

1. Add `startup: string[];` to the `StateFile` interface, with a docstring: *"Which servers a launch opens, in the order they were ticked. Empty, or absent, means the first catalog entry — what a launch has always done."*
2. Add a cap beside `HISCORES_NAME_MAX`, following the `AUTO_JOIN_MAX` precedent:

```ts
// The catalog a person curates by hand is small; this only stops a hand-edited
// file from naming thousands of windows to open at once.
const STARTUP_MAX = 16;
```

3. Add the defensive reader beside `readHiscores`:

```ts
/**
 * Reads a stored startup list one entry at a time, for the same reason as
 * readChat and readHiscores: one bad entry must not cost the user their
 * remembered worlds. Ids are not checked against the catalog here — that is
 * `startupServers`' job at launch, and the catalog is not loaded yet.
 */
function readStartup(x: unknown): string[] {
    if (!Array.isArray(x)) return [];
    const startup: string[] = [];
    for (const id of x) {
        if (startup.length >= STARTUP_MAX) break;
        if (typeof id === 'string' && id !== '' && !startup.includes(id)) startup.push(id);
    }
    return startup;
}
```

4. Add the fields, reset them in `load()`, and set `fresh` **before** the early return:

```ts
private startup: string[] = [];
private freshProfile = true;
```

In `load()`, beside the other resets add `this.startup = [];`, then change the existence check to:

```ts
this.freshProfile = !existsSync(this.file);
if (this.freshProfile) return;
```

and inside the `try`, beside the other reads: `this.startup = readStartup(parsed?.startup);`

5. Add the accessors, and `startup: [...this.startup]` to the object built in `save()`:

```ts
/** The ids a launch opens, in the order ticked. Named for ids, not servers, so it does not read as the pure `startupServers` that resolves them. A copy. */
startupIds(): string[] {
    return [...this.startup];
}

setStartupServer(id: string, on: boolean): void {
    const at = this.startup.indexOf(id);
    if (on && at < 0) this.startup.push(id);
    else if (!on && at >= 0) this.startup.splice(at, 1);
    else return;
    this.save();
}

/**
 * Whether this launch is the first on this profile — no state file existed.
 * A file that was broken and set aside does not count: somebody who has one
 * has used the kit before, and showing them the first-launch arrangement
 * again would be telling them something they already know.
 */
fresh(): boolean {
    return this.freshProfile;
}
```

- [ ] **Step 4: Run tests and typecheck.** `npm test && npm run typecheck`.

- [ ] **Step 5: Commit.**

```bash
git add src/main/appState.ts src/main/appState.test.ts
git commit -m "feat: state.json remembers which servers a launch opens"
```

---

## Task 3: The bottom pane becomes a choice

**Files:** Modify `src/main/tabs.ts`, `src/main/tabs.test.ts`

**Produces:** `openWindowTabs(treeHeight, gameHeight?, bottomTool?)`.

- [ ] **Step 1: Write the failing tests.** Append to `src/main/tabs.test.ts`.

```ts
test('a window opens with chat below the game unless asked otherwise', () => {
    const set = openWindowTabs(800);
    assert.deepEqual(contentOf(set.tabs[0]!.tree, 'pane-2'), { kind: 'tool', tool: 'chat' });
});

test('the bottom pane can be another tool, which is how a first launch shows the servers', () => {
    const set = openWindowTabs(800, undefined, 'servers');
    assert.deepEqual(contentOf(set.tabs[0]!.tree, 'pane-2'), { kind: 'tool', tool: 'servers' });
    assert.deepEqual(contentOf(set.tabs[0]!.tree, 'pane-1'), { kind: 'game' }, 'the game keeps its pane and its focus');
    assert.equal(set.tabs[0]!.focusedPaneId, 'pane-1');
});
```

- [ ] **Step 2: Run them and watch them fail.** `npm test` — the second asserts `chat` where `servers` is expected.

- [ ] **Step 3: Implement.** In `src/main/tabs.ts`, add `import type { ToolId } from '../shared/ipc.ts';` and change the signature and the leaf:

```ts
export function openWindowTabs(treeHeight: number, gameHeight: number = GAME_PREFERRED_HEIGHT, bottomTool: ToolId = 'chat'): TabSet {
```

```ts
[leaf('pane-1', { kind: 'game' }), leaf('pane-2', { kind: 'tool', tool: bottomTool })],
```

- [ ] **Step 4: Rewrite the docstring.** It currently says chat is below the game and explains why, which stops being the whole truth. Replace the second paragraph of the comment at `tabs.ts:38-42` with:

```
 * With chat under it by default, because chat is the kit's own reason to be
 * open instead of a browser tab, and a pane nobody knows is there is a pane
 * nobody opens. Below rather than beside, where the 2004 client keeps its own
 * chat box, so the conversation gets the game's full width.
 *
 * `bottomTool` is what goes there, and the one caller that passes anything
 * else is the first launch on a fresh profile, which puts the Servers pane
 * there instead — for exactly the reason chat is there the rest of the time.
```

- [ ] **Step 5: Run tests and typecheck.** `npm test && npm run typecheck`.

- [ ] **Step 6: Commit.**

```bash
git add src/main/tabs.ts src/main/tabs.test.ts
git commit -m "feat: a window's bottom pane is a choice, not always chat"
```

---

## Task 4: The tool exists and draws

**Files:** Modify `src/shared/ipc.ts`, `src/main/paneMenu.ts`, `src/main/serverWindow.ts`, `src/renderer/Shell.tsx`; Create `src/renderer/tools/Servers.tsx`

**Consumes:** `ServersView`, `serversView` (Task 1). **Produces:** a Servers pane offered in every window, drawing a read-only list.

- [ ] **Step 1: Add the id and the view type.** In `src/shared/ipc.ts`:

```ts
export const TOOL_IDS = ['worlds', 'hiscores', 'chat', 'singleplayer', 'timers', 'servers'] as const;
```

Append to it — the docstring above already says this is the set, not the menu order. Then add `servers: ServersView;` to `ShellState`, beside `timers`, with the comment *"Never null: every window offers the catalog, because 'what else can I play' is not a question any one server answers."* Import `ServersView` from `../main/servers.ts` (the file already imports main-side types this way).

- [ ] **Step 2: Add the name.** `src/main/paneMenu.ts:49` — this is the one hard compile break:

```ts
const TOOL_NAMES: Record<ToolId, string> = { chat: 'Chat', worlds: 'Worlds', hiscores: 'Hiscores', singleplayer: 'Your world', timers: 'Timers', servers: 'Servers' };
```

- [ ] **Step 3: Offer it in every window and carry the view.** In `src/main/serverWindow.ts`:

At `:296-300`, after `tools.push('timers');`, add `tools.push('servers');` — unconditional, like Timers. Add a `servers: () => ServersView;` getter to `ServerWindowDeps` beside `chat` and `timers`, and add `servers: deps.servers()` to the object `state()` returns at `:476`.

- [ ] **Step 4: Wire the getter.** In `src/main/index.ts`, where the window factory builds deps (beside `timers:` at `:345-348`):

```ts
servers: () => serversView({ catalog: catalog.list(), startup: appState.startupIds(), openCounts: windowCounts() }),
```

and a small helper near `focusedServerWindow`:

```ts
/**
 * How many windows each server has open, for the Servers pane's rows.
 *
 * Counted from `windows.list()`, which reads each window's spec, and never
 * from `sw.state()`. `state()` now carries the Servers view, the view is built
 * with these counts, so a count taken through `state()` would call the very
 * function that called it — one window is enough to recurse forever.
 */
function windowCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const open of windows.list()) counts.set(open.serverId, (counts.get(open.serverId) ?? 0) + 1);
    return counts;
}
```

- [ ] **Step 5: Write the component, read-only for now.** `src/renderer/tools/Servers.tsx`. Match the house idioms exactly (lifted from `Timers.tsx` / `ChatSettings.tsx`): root `"flex min-h-0 flex-1 flex-col"`, scrolling list `"sunk mx-2.5 min-h-0 flex-1 overflow-y-auto"`, row `"border-b border-edge-dark px-2 py-1.5 last:border-b-0"`, secondary text `"text-[12px] text-dim"`. Props are `{ view }: { view: ServersView }` — pure props-down, no subscription, no copy of server data.

Each row: name, `rev N` when `revision !== null` as a badge (`"shrink-0 border border-edge-lit px-[3px] text-[10px] leading-[13px] text-dim"`), notes on a second line in `text-[12px] text-dim`, and the open count as `"2 windows open"` when `open > 0`.

- [ ] **Step 6: Add the case — the silent trap.** `src/renderer/Shell.tsx`, inner switch at `:57-68`:

```tsx
case 'servers':     return <Servers view={state.servers} />;
```

Non-nullable, so no `state.x ? … : null` guard. **Verify by eye that the case is present** — the switch has no `default`, so omitting it compiles clean and silently renders an empty pane.

- [ ] **Step 7: Verify.** `npm run typecheck && npm test`, then `npm run dev`. Open Add pane — Servers is in the list in every window, including Your world's. Check the log line at window open reads `tools: chat · worlds · timers · servers`; that line exists precisely to catch a missed push.

- [ ] **Step 8: Commit.**

```bash
git add src/shared/ipc.ts src/main/paneMenu.ts src/main/serverWindow.ts src/main/index.ts src/renderer/Shell.tsx src/renderer/tools/Servers.tsx
git commit -m "feat: every window offers a servers pane"
```

---

## Task 5: Open, and open at startup

**Files:** Modify `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/renderer/tools/Servers.tsx`

- [ ] **Step 1: Add the channels.** `src/shared/ipc.ts`, in the flat `IPC` object, every value prefixed `zanaris:`:

```ts
serversOpen: 'zanaris:servers:open',
serversStartup: 'zanaris:servers:startup',
serversAdd: 'zanaris:servers:add',
serversRemove: 'zanaris:servers:remove',
```

No `servers:list` channel — the view rides `ShellState`, as chat's does. (`IPC.chatState` is a dead constant for exactly this reason; do not copy it.)

Then the API on `ZanarisApi`:

```ts
servers: {
    open(id: string): Promise<void>;
    setStartup(id: string, on: boolean): Promise<void>;
    /** Null when it was added; a sentence saying why not otherwise. */
    add(input: NewServerInput): Promise<string | null>;
    remove(id: string): Promise<string | null>;
};
```

- [ ] **Step 2: Wire preload.** `src/preload/index.ts` — all `invoke`, no `send`, no raw `ipcRenderer` escaping the module:

```ts
servers: {
    open: id => ipcRenderer.invoke(IPC.serversOpen, id),
    setStartup: (id, on) => ipcRenderer.invoke(IPC.serversStartup, id, on),
    add: input => ipcRenderer.invoke(IPC.serversAdd, input),
    remove: id => ipcRenderer.invoke(IPC.serversRemove, id)
},
```

- [ ] **Step 3: Add the two handlers and the fan-out helper.** `src/main/index.ts`. Each gates on the sender as the timers handlers do, even where the answer is window-independent:

```ts
/**
 * Everything that must happen after the catalog or the startup set changes
 * from inside a pane. The menu is rebuilt so File > New Window For agrees,
 * every window is pushed because this one's change is app-wide, and
 * `catalogSeen` is refreshed so the on-focus reload does not mistake our own
 * write for somebody editing servers.json underneath us.
 */
function catalogChanged(): void {
    catalogSeen = catalogMtime();
    installAppMenu();
    for (const sw of serverWindows.values()) sw.pushState();
}

ipcMain.handle(IPC.serversOpen, (event, id: unknown) => {
    if (!windowFor(event.sender) || typeof id !== 'string') return;
    const server = catalog.get(id);
    if (server) openServer(server);
});

ipcMain.handle(IPC.serversStartup, (event, id: unknown, on: unknown) => {
    if (!windowFor(event.sender) || typeof id !== 'string' || typeof on !== 'boolean') return;
    if (!catalog.get(id)) return;
    appState.setStartupServer(id, on);
    for (const sw of serverWindows.values()) sw.pushState();
});
```

- [ ] **Step 4: Give the rows their controls.** In `Servers.tsx`, call `window.zanaris.*` at the click site — no callback props, matching `Timers.tsx:154`:

```tsx
<button type="button" style={BUTTON_SIZE} className="btn" onClick={() => void window.zanaris.servers.open(row.id)}>Open</button>
```

```tsx
<label className="flex items-center gap-2 text-cream">
    <input type="checkbox" checked={row.atStartup} style={ACCENT} onChange={e => void window.zanaris.servers.setStartup(row.id, e.target.checked)} />
    Open at startup
</label>
```

with the shared constants copied from `Timers.tsx:6-17` (`BUTTON_SIZE`, `ACCENT`) — they exist because unlayered `.btn` CSS beats equal-specificity Tailwind.

- [ ] **Step 5: Verify by hand.** `npm run dev`. Open Servers, press Open on Zanaris — a second window appears and **both panes' open counts update**, which is the fan-out working. Tick a startup box and confirm `startup` appears in `state.json`.

- [ ] **Step 6: Commit.**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/index.ts src/renderer/tools/Servers.tsx
git commit -m "feat: the servers pane opens windows and picks the startup set"
```

---

## Task 6: Add and remove

**Files:** Modify `src/main/index.ts`, `src/renderer/tools/Servers.tsx`, `src/shared/catalog.ts`

- [ ] **Step 1: Add the handlers.** `src/main/index.ts`, using `readNewServerInput` from Task 1 and then the *same* `createServer` the form runs:

```ts
ipcMain.handle(IPC.serversAdd, (event, raw: unknown): string | null => {
    if (!windowFor(event.sender)) return null;
    const input = readNewServerInput(raw);
    if (!input) return 'That is not a server the kit can add.';
    const result = catalog.add(input);
    if (!result.ok) return result.error;
    catalogChanged();
    return null;
});

ipcMain.handle(IPC.serversRemove, (event, id: unknown): string | null => {
    if (!windowFor(event.sender)) return null;
    if (typeof id !== 'string') return 'That is not a server.';
    // The guard is here and in the row's `removable`, both from `isRemovable`:
    // nothing in the app puts a removed built-in back.
    if (!isRemovable(id)) return 'That server came with the kit and cannot be removed.';
    if (!catalog.remove(id)) return 'That server is no longer in the list.';
    catalogChanged();
    return null;
});
```

- [ ] **Step 2: Build the form.** Below the list in `Servers.tsx`. Five fields — name, address, revision, wiki, notes — laid out with `"flex min-w-0 flex-col gap-0.5"` per field, labels `"text-[12px] text-dim"`, inputs the shared `FIELD` constant (`'sunk w-full min-w-0 px-[7px] py-[3px] font-sans text-[13px] text-cream placeholder:text-faint'`), unique ids via `useId()`.

Use the canonical refusal round-trip from `Timers.tsx:190-199` verbatim:

```tsx
const send = async (request: Promise<string | null>): Promise<void> => {
    setBusy(true);
    try {
        const refused = await request;
        if (refused === null) setDraft(EMPTY);
        else setRefusal(refused);
    } finally { setBusy(false); }
};
```

Surface `refusal` in `<p role="alert" className="text-[12px] text-warn">`. Exactly one gold `.btn` in the pane at a time — Save is it.

- [ ] **Step 3: Remove as text, never a red slab.** On removable rows only, following `Timers.tsx:307-309`:

```tsx
{row.removable && (
    <button type="button" className="group ml-auto" onClick={() => void send(window.zanaris.servers.remove(row.id))}>
        <span className="text-[12px] text-dim underline-offset-2 group-hover:text-alarm group-hover:underline">Remove</span>
    </button>
)}
```

- [ ] **Step 4: One authority for validation, and two comments that must say so.**

`main/catalog.ts` imports `node:fs` on its first line, so the renderer cannot import `createServer`, and no renderer file imports runtime code from `main/` today. The form therefore does **not** re-run `createServer`. It submits, and surfaces main's refusal through the `send` round-trip above — which is what `ChatSettings` does with its refusals anyway. Save is disabled only while name or address is blank; that is a blank check, not a second copy of the rules.

Two comments have to match that:

1. `src/shared/catalog.ts:44` — `NewServerInput` is documented as "What the launcher's add form collects", naming a launcher that does not exist. Change to: *"What the Servers pane's add form collects. `createServer`, in main, turns it into an entry or says why it cannot; the form shows that answer rather than deciding for itself, since `catalog.ts` reaches the file system and the renderer cannot import it."*
2. `src/main/servers.ts` — `readNewServerInput`'s docstring currently claims the form "has already run itself" the same function, "as the chat settings and timer forms do it". That is now false and, by this repo's own rule, a defect. Cut that clause: the docstring should say the reader checks shape only, and that `createServer` in main is the single authority on what the values mean.

- [ ] **Step 5: Verify by hand.** `npm run dev`. Add a server with a bad address and confirm the refusal is the same sentence `createServer` gives. Add a good one, confirm it appears in every open pane and in File > New Window For without changing focus. Confirm built-in rows have no Remove.

- [ ] **Step 6: Commit.**

```bash
git add src/main/index.ts src/renderer/tools/Servers.tsx src/shared/catalog.ts
git commit -m "feat: the servers pane adds and removes servers"
```

---

## Task 7: Launch opens the set

**Files:** Modify `src/main/index.ts`

- [ ] **Step 1: Hold the first-launch flag.** Near `catalogSeen` at `:284`:

```ts
/**
 * Consumed by the first window of a first launch, which shows the Servers
 * pane where chat normally sits. One-shot: the factory runs per window, and
 * only the first one on a profile that had no state file is meant.
 */
let firstLaunchPane = false;
```

Set it in `whenReady` immediately after `appState.load()`: `firstLaunchPane = appState.fresh();`

- [ ] **Step 2: Declare and consume the dep.** Add to `ServerWindowDeps` in `src/main/serverWindow.ts`, beside the other getters:

```ts
/** Which tool the window's first tab puts under the game. Asked once, at open. */
bottomTool: () => ToolId;
```

Change the call at `serverWindow.ts:437` to pass it through:

```ts
initial: openWindowTabs(win.getContentBounds().height - TAB_BAR_HEIGHT, content.game, deps.bottomTool()),
```

Then supply it from `src/main/index.ts`'s factory, beside `servers:` from Task 4 — one-shot, so only the first window of a first launch gets it:

```ts
bottomTool: () => {
    if (!firstLaunchPane) return 'chat' as const;
    firstLaunchPane = false;
    return 'servers' as const;
},
```

- [ ] **Step 3: Open the set.** Replace the lone `actions.newWindow();` at `:1662`:

```ts
for (const server of startupServers(appState.startupIds(), catalog.list())) openServer(server);
```

Leave `app.on('activate')` and `second-instance` calling `actions.newWindow()` — those are "give me a window", not "start the app".

- [ ] **Step 4: Verify by hand.** Move your real profile aside first so a fresh one is genuinely fresh:

```bash
mv ~/Library/Application\ Support/zanaris-kit ~/Library/Application\ Support/zanaris-kit.bak
```

Launch: one window, Servers below the game. Quit, launch again: chat is back. Tick two servers, quit, launch: two windows, cascaded. Untick both, launch: one window, Lost City. Then restore the profile.

- [ ] **Step 5: Commit.**

```bash
git add src/main/index.ts
git commit -m "feat: a launch opens the servers you chose"
```

---

## Task 8: Documentation and capture

**Files:** Modify `README.md`, `CLAUDE.md`, `src/main/index.ts`

- [ ] **Step 1: Fix the README.** Two sentences in "What it does" are now false: *"There is no launcher or management window; there are only game windows"* stays true and should stay — but *"At startup the app opens the first server in the catalog, Lost City"* does not. Replace with a short paragraph: the catalog is a Servers pane in every window, from Add pane; it opens windows, adds and removes servers, and each row can be ticked to open at launch; a launch with nothing ticked still opens the first entry.

- [ ] **Step 1b: Finish the `openWindowTabs` docstring.** Its height-solver paragraph (`src/main/tabs.ts`, the one beginning "The game keeps its preferred height") still calls the bottom pane "a chat pane" and says "chat gives way down to the floor first". The sizing is identical whatever tool sits there — only the noun is over-specific — so make it "the bottom pane" and "it gives way". Deferred here from Task 3 rather than spending a fix round on two words; the behaviour described was never wrong.

- [ ] **Step 2: Note the invariant in CLAUDE.md.** Add to the layout section: `TOOL_IDS` is append-only, because saved layout files carry tool ids between people and `instantiateLayout` silently degrades an unknown one to an empty pane. Note too that built-in catalog entries are not removable from the pane, and why.

- [ ] **Step 3: Add the capture block.** In `captureAndExit`, before the reference-pane section around `:1444`, copying the Your-world block's two conventions — front the window *before* opening the tool, because the pixel font is only fetched once the shell paints and `font-display: block` leaves every label blank until it arrives; and log one `[capture]` line naming the state being photographed:

```ts
// The Servers pane: the catalog as a newcomer meets it, with Lost City's
// row showing an open window and the add form below the list.
const first = opened[0];
if (first) {
    first.window.moveTop();
    first.focus();
    await wait(500);
    showTool(first, 'servers');
    await wait(500);
    await shoot(`${first.state().server.id}-servers`, first);
    log(`[capture] servers pane lists ${first.state().servers.rows.length} servers`);
}
```

- [ ] **Step 4: Run capture, and distrust it.**

```bash
caffeinate -d npm run capture
```

Then compare hashes against the previous run before believing any of it — a sleeping display returns a byte-identical stale frame under a green log:

```bash
shasum captures/*.png
```

- [ ] **Step 5: Commit.**

```bash
git add README.md CLAUDE.md src/main/index.ts
git commit -m "docs: the server list is a pane, and the README says so"
```

---

## Verification

Run throughout: `npm test`, `npm run typecheck`. CI runs `typecheck`, `test`, `build` on Node 24, in that order.

End to end, by hand:

1. **Fresh profile** (`state.json` absent) opens one window with Servers below the game; a second launch puts chat back.
2. **Ticking two servers** and relaunching opens two windows, cascaded. Unticking both opens one, Lost City.
3. **Removing every startup server** from the catalog and relaunching opens one window rather than none.
4. **Adding a server** updates every open Servers pane *and* File > New Window For with no focus change.
5. **A bad address** in the add form gives the sentence `createServer` returns, surfaced after Save — there is no second copy of the rules in the renderer to diverge from it.
6. **Built-in rows offer no Remove**, and `Catalog.remove` is still free to remove anything when called directly.
7. **A layout file** saved with a Servers pane loads into another window as a Servers pane, not a launcher.
8. **Your world's window** offers the Servers pane like any other.
9. **`npm run capture`** under `caffeinate -d`, hashes compared.

---

## Your world needs no special case

Ticking Your world opens its window at launch, and **the world starts with it** —
`serverWindow.ts:1267` calls `single.acquire()` when a Your world window opens,
and `release()` on close stops the world once the last one goes. A build that is
not downloaded yet is already handled there: the window shows the starting page,
and `onBuilds` starts the world once the build lands.

So there is nothing to add. An earlier draft of this plan asked whether ticking
Your world should "also start the world"; it already does, and the row needs no
special case, no extra task and no startup-time boot of its own.
