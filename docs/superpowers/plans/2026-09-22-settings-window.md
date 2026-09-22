# Settings Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the server list out of the `'servers'` tool pane into one Settings window for the whole app, opened from a gear, from Settings… (Cmd/Ctrl+,), and once on a fresh profile's first launch.

**Architecture:** A pure `SettingsWindowSlot` and `settingsBounds` hold the rules; `settingsView.ts` is the Electron seam that builds the window and holds none. The window loads the same renderer bundle and preload at `#settings`, and gets its state on its own channel rather than through `ShellState`. Removing the pane is mostly a revert of five files to the fork point, since every change this branch made to them existed only for the pane.

**Tech Stack:** Electron (main, preload, React renderer), TypeScript, `node --test` on pure modules, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-22-settings-window-design.md`. It replaces the surface in `docs/superpowers/specs/2026-09-20-servers-pane-design.md`; the pure rules, startup set, add/remove and built-in protection from that spec carry over unchanged.

## Global Constraints

- **Branch:** `claude/server-selection-startup-f314eb` (PR #16, pushed and open). Never force-push and never rebase it. Bring `main` in by merge (Task 5).
- **Fork point:** `1e85d81`. `origin/main` has moved to `3584544` (PR #17, capture's stale-frame fix), which touches `src/main/index.ts` and `src/main/serverWindow.ts`.
- **Never `git add -A`, `git add .` or `git commit -a`.** Stage named files only. This worktree has held uncommitted files that did not belong in this PR.
- **Nothing decidable in `serverWindow.ts`, `index.ts`, `settingsView.ts` or the renderer.** They have no test infrastructure and cannot fail in CI. Rules go in pure modules `node --test` reaches without Electron.
- **A comment that describes behaviour the code does not have is a defect in this repo, not a nit.** Any change that makes a comment untrue fixes that comment in the same commit, in any file.
- **Never route anything through `sw.state()` from inside something `state()` invokes.** On this branch that once recursed forever, and `pushState()`'s try/catch hid it.
- **The renderer sends ids and the add form's five fields, never a `ServerDef` or a path.** `createServer` in main is the one authority on whether a server is valid.
- **Style, unenforced (no prettier, no eslint):** 4 spaces, single quotes, semicolons, ~200-column lines, no trailing commas, no parens on single-parameter arrows, `/** … */` docstrings that explain *why*. `noUncheckedIndexedAccess` is on. Match each file's own import-extension habit.
- **Tests:** `import { test } from 'node:test'`, `import assert from 'node:assert/strict'`, no `describe`, lower-case prose names.
- **Identity:** commits are Zanaris274. End every commit body with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Runtime:** subagents cannot run the app (no display). Say so rather than claim runtime verification.

## Decisions taken while planning

Each of these is a ruling on something the spec left open or got wrong. They are binding here.

1. **The pane comes out by revert.** Every change this branch made to `serverWindow.ts`, `tabs.ts`, `tabs.test.ts`, `layout.ts` and `paneMenu.ts` existed for the pane. Restoring them to `1e85d81` removes it exactly and cannot leave a stale comment behind. It also makes Task 5's merge of PR #17 into `serverWindow.ts` conflict-free.
2. **Merge `origin/main` after the pane is gone and before capture** (Task 5). The capture task must use PR #17's `front()` and `ShotLedger`.
3. **`Servers.tsx` moves from `tools/` to `settings/`.** It is no longer a tool, and six of its comments say "pane".
4. **After the pane is gone, only the Settings window may call the servers handlers.** The spec says they accept a game window "as well as" Settings. That was true while both existed. Once no game window has a servers UI, accepting its calls is privilege nothing uses. Task 3 narrows the gate and amends that spec line.
5. **Settings takes `alwaysOnTop` at creation.** Beside a pinned game window, an unpinned Settings would open behind it.
6. **Cmd/Ctrl+W closes Settings.** Close Pane owns that shortcut and acts on `focusedServerWindow()`, which is `undefined` while Settings has focus, so without this the shortcut would do nothing there.
7. **`autoHideMenuBar` on Settings.** Windows and Linux hang the app menu on every window, and Split Right or Close Tab have nothing to act on in Settings. The shortcuts still fire.
8. **Capture closes Settings after shooting it.** Where it cannot sit beside a game window it opens centred, on top of one, and every later game-window shot would then trip PR #17's paint check.

---

## Task 1: The rules

**Files:**
- Create: `src/main/settingsWindow.ts`
- Create: `src/main/settingsWindow.test.ts`

**Interfaces:**
- Consumes: `Rect` from `src/shared/ipc.ts` (`{ x, y, width, height }`, line 97).
- Produces: `SettingsHandle`, `SettingsFactory<H>`, `SettingsWindowSlot<H>` with `open(anchor)`, `current()`, `isSender(contentsId)`; `Size`; `SETTINGS_GAP`; `settingsBounds(anchor, size, workArea)`.

- [ ] **Step 1: Write the failing tests** in `src/main/settingsWindow.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_GAP, SettingsWindowSlot, settingsBounds, type SettingsHandle } from './settingsWindow.ts';
import type { Rect } from '../shared/ipc.ts';

interface Fake extends SettingsHandle {
    focused: number;
    close: () => void;
}

/** A slot over a factory that records what it made and where, so a test can close a window by hand. */
function fixture(): { slot: SettingsWindowSlot<Fake>; made: Fake[]; anchors: (Rect | null)[] } {
    const made: Fake[] = [];
    const anchors: (Rect | null)[] = [];
    const slot = new SettingsWindowSlot<Fake>((anchor, onClosed) => {
        anchors.push(anchor);
        const fake: Fake = {
            contentsId: 100 + made.length,
            focused: 0,
            focus: () => {
                fake.focused++;
            },
            close: onClosed
        };
        made.push(fake);
        return fake;
    });
    return { slot, made, anchors };
}

test('opening with no window open makes one, placed by the anchor it was given', () => {
    const { slot, made, anchors } = fixture();
    const anchor = { x: 10, y: 20, width: 765, height: 803 };
    const opened = slot.open(anchor);
    assert.equal(made.length, 1);
    assert.equal(opened, made[0]);
    assert.deepEqual(anchors, [anchor]);
    assert.equal(slot.current(), opened);
});

test('opening again brings the open window forward and makes no second one', () => {
    const { slot, made } = fixture();
    const first = slot.open(null);
    const again = slot.open(null);
    assert.equal(again, first);
    assert.equal(made.length, 1, 'everything in Settings is app-wide, so a second window would be a second copy');
    assert.equal(first.focused, 1);
});

test('closing empties the slot, and the next open makes a fresh window', () => {
    const { slot, made } = fixture();
    slot.open(null);
    made[0]!.close();
    assert.equal(slot.current(), null);
    const next = slot.open(null);
    assert.equal(made.length, 2);
    assert.equal(next, made[1]);
});

test('a close that arrives again after a newer window opened does not empty the slot', () => {
    const { slot, made } = fixture();
    slot.open(null);
    made[0]!.close();
    const newer = slot.open(null);
    made[0]!.close();
    assert.equal(slot.current(), newer, 'only the open window closing may empty the slot');
});

test('isSender recognises the open window and nothing else', () => {
    const { slot, made } = fixture();
    assert.equal(slot.isSender(100), false, 'no window is open yet');
    slot.open(null);
    assert.equal(slot.isSender(100), true);
    assert.equal(slot.isSender(7), false);
    made[0]!.close();
    assert.equal(slot.isSender(100), false, 'a closed window is no longer a sender');
});

const WORK: Rect = { x: 0, y: 25, width: 1920, height: 1055 };
const SIZE = { width: 520, height: 640 };

test('settings opens beside the window that asked when the display has room', () => {
    const anchor = { x: 100, y: 80, width: 765, height: 803 };
    assert.deepEqual(settingsBounds(anchor, SIZE, WORK), { x: 100 + 765 + SETTINGS_GAP, y: 80, width: 520, height: 640 });
});

test('settings is centred when the display has no room beside the window', () => {
    const anchor = { x: 1200, y: 80, width: 765, height: 803 };
    assert.deepEqual(settingsBounds(anchor, SIZE, WORK), { x: 700, y: 233, width: 520, height: 640 });
});

test('settings is centred when no window asked for it', () => {
    assert.deepEqual(settingsBounds(null, SIZE, WORK), { x: 700, y: 233, width: 520, height: 640 });
});

test('beside a window low on the display, settings is lifted to stay on it', () => {
    const anchor = { x: 100, y: 700, width: 765, height: 300 };
    assert.deepEqual(settingsBounds(anchor, SIZE, WORK), { x: 877, y: 440, width: 520, height: 640 });
});

test('on a display smaller than settings, it shrinks to the work area', () => {
    const small: Rect = { x: 0, y: 0, width: 400, height: 500 };
    assert.deepEqual(settingsBounds(null, SIZE, small), { x: 0, y: 0, width: 400, height: 500 });
});
```

- [ ] **Step 2: Run them and watch them fail.** `npm test`. Expected: "Cannot find module './settingsWindow.ts'".

- [ ] **Step 3: Write `src/main/settingsWindow.ts`:**

```ts
import type { Rect } from '../shared/ipc.ts';

/**
 * The Settings window's rules, kept here rather than beside the window for
 * the reason every rule in this kit is: `node --test` reaches this file
 * without Electron. `settingsView.ts` builds the window and holds no rules of
 * its own, as `paneHost.ts` does for panes.
 */

/** What the slot needs from a window: enough to bring it forward, and to know whether an IPC call came from it. */
export interface SettingsHandle {
    focus(): void;
    readonly contentsId: number;
}

/** Creates the window. Must call `onClosed` once, when the window is gone. */
export type SettingsFactory<H extends SettingsHandle> = (anchor: Rect | null, onClosed: () => void) => H;

/**
 * The one Settings window the app has, or none.
 *
 * Opening it when it is already open brings it forward instead of making a
 * second: everything in it is app-wide, so two would be two copies of one
 * thing, each able to disagree with the other about what was just saved.
 */
export class SettingsWindowSlot<H extends SettingsHandle> {
    private handle: H | null = null;
    private readonly factory: SettingsFactory<H>;

    constructor(factory: SettingsFactory<H>) {
        this.factory = factory;
    }

    /** The open window brought forward, or a new one placed by `anchor`. */
    open(anchor: Rect | null): H {
        if (this.handle) {
            this.handle.focus();
            return this.handle;
        }
        // Compared before clearing, so a close that arrives more than once, or
        // late, cannot empty the slot of a window opened since.
        const handle: H = this.factory(anchor, () => {
            if (this.handle === handle) this.handle = null;
        });
        this.handle = handle;
        return handle;
    }

    current(): H | null {
        return this.handle;
    }

    /** Whether an IPC call came from the open Settings window. */
    isSender(contentsId: number): boolean {
        return this.handle !== null && this.handle.contentsId === contentsId;
    }
}

export interface Size {
    width: number;
    height: number;
}

/** The gap left between a game window and Settings when they sit side by side. */
export const SETTINGS_GAP = 12;

/**
 * Where the Settings window opens.
 *
 * To the right of the window that asked for it, top edges level, when the
 * display has room there, so on a first launch it sits beside the game the
 * player just opened rather than on top of it. Centred on the display when
 * there is no room, or no window asked. Never larger than the display's work
 * area, and never off it.
 */
export function settingsBounds(anchor: Rect | null, size: Size, workArea: Rect): Rect {
    const width = Math.min(size.width, workArea.width);
    const height = Math.min(size.height, workArea.height);
    if (anchor) {
        const x = anchor.x + anchor.width + SETTINGS_GAP;
        if (x >= workArea.x && x + width <= workArea.x + workArea.width) {
            const y = Math.min(Math.max(anchor.y, workArea.y), workArea.y + workArea.height - height);
            return { x, y, width, height };
        }
    }
    return {
        x: workArea.x + Math.round((workArea.width - width) / 2),
        y: workArea.y + Math.round((workArea.height - height) / 2),
        width,
        height
    };
}
```

- [ ] **Step 4:** `npm test && npm run typecheck`. All pass.

- [ ] **Step 5: Commit.**

```bash
git add src/main/settingsWindow.ts src/main/settingsWindow.test.ts
git commit -m "feat: the rules behind one Settings window"
```

---

## Task 2: The Settings window, reachable, beside the pane

The pane stays in this task, so every commit builds and runs. Settings gets the Servers section, the gear, the menu item, its own channel, and every push the pane gets.

**Files:**
- Create: `src/main/settingsView.ts`, `src/renderer/Settings.tsx`
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/renderer.ts`, `src/main/menu.ts`, `src/main/index.ts`, `src/renderer/main.tsx`, `src/renderer/Shell.tsx`, `src/renderer/icons.tsx`

**Interfaces:**
- Consumes: Task 1's `SettingsWindowSlot`, `SettingsHandle`, `settingsBounds`. Existing `serversView`, `windowCounts()`, `catalogChanged()`, `focusedServerWindow()`, `windowFor()`.
- Produces: `IPC.settingsGet`, `IPC.settingsState`, `IPC.settingsOpen`; `SettingsState { servers: ServersView }`; `ZanarisApi.settings.{get,onState,open}`; `SettingsWindow` (`SettingsHandle` plus `window: BrowserWindow`, `push(state)`); in `index.ts`: `settings`, `settingsState()`, `pushSettings()`, `openSettings(anchor?)`, `mayManageServers(sender)`; `MenuActions.openSettings()`; `loadShell(contents, hash?)`.

- [ ] **Step 1: The channel.** In `src/shared/ipc.ts`, give the last entry of `IPC` (`serversRemove`) a trailing comma, then append:

```ts
    settingsGet: 'zanaris:settings-get',
    settingsState: 'zanaris:settings-state',
    settingsOpen: 'zanaris:settings-open'
```

After the `ShellState` interface, add:

```ts
/**
 * What the Settings window draws. Its own channel rather than a field on
 * `ShellState`: it is not a game window, and no game window draws any of it.
 */
export interface SettingsState {
    servers: ServersView;
}
```

In `ZanarisApi`, after `servers`:

```ts
    settings: {
        /** Null when the calling page is not the Settings window. */
        get(): Promise<SettingsState | null>;
        onState(cb: (state: SettingsState) => void): () => void;
        /** Opens the Settings window, or brings the open one forward. */
        open(): Promise<void>;
    };
```

- [ ] **Step 2: Preload.** In `src/preload/index.ts`, import `type SettingsState` beside `ShellState`, and after `servers` add:

```ts
    settings: {
        get: () => ipcRenderer.invoke(IPC.settingsGet),
        onState: cb => {
            const handler = (_event: unknown, state: SettingsState): void => cb(state);
            ipcRenderer.on(IPC.settingsState, handler);
            return () => {
                ipcRenderer.off(IPC.settingsState, handler);
            };
        },
        open: () => ipcRenderer.invoke(IPC.settingsOpen)
    }
```

- [ ] **Step 3: A page by hash.** Replace `loadShell` and its docstring in `src/main/renderer.ts`:

```ts
/**
 * Loads the renderer bundle: the shell every server window shows, or, given
 * `hash`, another page of the same bundle, which `main.tsx` tells apart. The
 * one other page is Settings, at `#settings`.
 */
export function loadShell(contents: WebContents, hash?: string): void {
    if (RENDERER_DEV_URL) void contents.loadURL(hash ? `${RENDERER_DEV_URL}#${hash}` : RENDERER_DEV_URL);
    else void contents.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined);
}
```

- [ ] **Step 4: The window.** Create `src/main/settingsView.ts`:

```ts
import { BrowserWindow, screen } from 'electron';
import { IPC, type Rect, type SettingsState } from '../shared/ipc';
import { loadShell, preloadPath } from './renderer';
import { settingsBounds, type SettingsHandle } from './settingsWindow';

/** What Settings asks for: room for four servers and the add form without scrolling. */
const SIZE = { width: 520, height: 640 };

export interface SettingsWindow extends SettingsHandle {
    readonly window: BrowserWindow;
    /** Sends Settings its state. A no-op once the page is gone. */
    push(state: SettingsState): void;
}

/**
 * Builds the Settings window: the seam between the rules in
 * `settingsWindow.ts` and Electron, holding none of its own, as `paneHost.ts`
 * does for panes.
 *
 * No parent: parented to a game window it would close with that window, and
 * it belongs to no one window.
 */
export function createSettingsWindow(opts: { anchor: Rect | null; alwaysOnTop: boolean; onClosed: () => void }): SettingsWindow {
    const display = opts.anchor ? screen.getDisplayMatching(opts.anchor) : screen.getPrimaryDisplay();
    const win = new BrowserWindow({
        ...settingsBounds(opts.anchor, SIZE, display.workArea),
        minWidth: 380,
        minHeight: 420,
        title: 'Settings',
        backgroundColor: '#17120d',
        show: false,
        // Beside a pinned game window, an unpinned Settings would open behind it.
        alwaysOnTop: opts.alwaysOnTop,
        // Windows and Linux hang the app menu on every window, and nothing in it
        // but Settings… acts here. Its shortcuts still fire.
        autoHideMenuBar: true,
        webPreferences: {
            preload: preloadPath(),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true
        }
    });
    // The page is the kit's own, but the names and notes on it come from
    // servers.json, which people edit by hand. React renders them as text; this
    // is the line behind that, and the shell has no need of it because it shows
    // nothing of the kind.
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // Keep "Settings": the page's own <title> is the shell's.
    win.on('page-title-updated', event => event.preventDefault());
    win.once('ready-to-show', () => win.show());
    win.on('closed', opts.onClosed);
    // Read now: once the window closes its contents are destroyed and the id with them.
    const contentsId = win.webContents.id;
    loadShell(win.webContents, 'settings');
    return {
        window: win,
        contentsId,
        focus: () => {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
        },
        push: state => {
            if (win.isDestroyed() || win.webContents.isDestroyed()) return;
            win.webContents.send(IPC.settingsState, state);
        }
    };
}
```

- [ ] **Step 5: Wiring in `src/main/index.ts`.**

Imports, matching the file's extensionless style: add `type SettingsState` to the `../shared/ipc` import, plus:

```ts
import { SettingsWindowSlot } from './settingsWindow';
import { createSettingsWindow, type SettingsWindow } from './settingsView';
```

Directly after `function openServer(…)`, add a section:

```ts
// ── settings ──────────────────────────────────────────────────────────────

/** The one Settings window, or none. Its rules are `settingsWindow.ts`'s; this only builds it. */
const settings = new SettingsWindowSlot<SettingsWindow>((anchor, onClosed) => createSettingsWindow({ anchor, alwaysOnTop: appState.alwaysOnTop(), onClosed }));

/** What Settings draws, built when asked for, like a shell's state. */
function settingsState(): SettingsState {
    return { servers: serversView({ catalog: catalog.list(), startup: appState.startupIds(), openCounts: windowCounts() }) };
}

/** Sends Settings its state when it is open. Every change to the catalog, the startup set or which windows are open comes through here. */
function pushSettings(): void {
    settings.current()?.push(settingsState());
}

/**
 * Opens Settings, or brings it forward. Placed beside `anchor` when there is
 * room: the window whose gear was pressed, or on a first launch the game
 * window just opened. With no anchor, beside whichever game window has focus.
 */
function openSettings(anchor: ServerWindow | undefined = focusedServerWindow()): void {
    settings.open(anchor && !anchor.window.isDestroyed() ? anchor.window.getBounds() : null);
}

/** Whether an IPC call may manage the catalog: the Settings window, or a game window's Servers pane while that still exists. */
function mayManageServers(sender: WebContents): boolean {
    return settings.isSender(sender.id) || windowFor(sender) !== undefined;
}
```

In the four servers handlers (`IPC.serversOpen`, `serversStartup`, `serversAdd`, `serversRemove`), replace each `windowFor(event.sender)` sender check with `mayManageServers(event.sender)`, keeping each handler's own early-return value.

Add `pushSettings();` next to each existing game-window push that exists for the pane: the `ServerWindows` `onChange` closure, `loadCatalog()`, `catalogChanged()`, and the `serversStartup` handler. Update the comment or docstring above each to say Settings is pushed too.

Add the two handlers near `IPC.shellGet`:

```ts
ipcMain.handle(IPC.settingsGet, (event): SettingsState | null => (settings.isSender(event.sender.id) ? settingsState() : null));

ipcMain.handle(IPC.settingsOpen, event => {
    const sw = windowFor(event.sender);
    if (sw) openSettings(sw);
});
```

In `actions`, add `openSettings: () => openSettings(),` and replace `closePane` with:

```ts
    closePane: () => {
        const sw = focusedServerWindow();
        if (sw) {
            void sw.closePane(sw.state().panes.find(p => p.focused)?.paneId ?? '');
            return;
        }
        // Cmd/Ctrl+W is Close Pane's. Settings has no panes, so there it closes
        // the window, as the same keys would anywhere else.
        const open = settings.current();
        if (open?.window.isFocused()) open.window.close();
    },
```

- [ ] **Step 6: The menu.** In `src/main/menu.ts`, add to `MenuActions`:

```ts
    /** Opens the Settings window, or brings the open one forward. */
    openSettings(): void;
```

Inside `installMenu`, before `template`:

```ts
    const settingsItem: MenuItemConstructorOptions = { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => actions.openSettings() };
    // Spelled out rather than `role: 'appMenu'`, which cannot take an item of
    // ours, because Settings belongs in the app menu on macOS.
    const appMenu: MenuItemConstructorOptions = {
        label: app.name,
        submenu: [
            { role: 'about' },
            { type: 'separator' },
            settingsItem,
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
        ]
    };
```

Replace `...(isMac ? [{ role: 'appMenu' as const }] : []),` with `...(isMac ? [appMenu] : []),`. In File, after `Reload Server List`, add `...(isMac ? [] : [settingsItem]),` so Windows and Linux find it there.

- [ ] **Step 7: The page.** `src/renderer/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Settings from './Settings';
import Shell from './Shell';
import './styles.css';

// One bundle, two pages: a server window's shell, and the Settings window at #settings.
const Page = location.hash === '#settings' ? Settings : Shell;

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <Page />
    </StrictMode>
);
```

Create `src/renderer/Settings.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import type { SettingsState } from '../shared/ipc';
import Servers from './tools/Servers';

/**
 * The Settings window's page. One window for the whole app, so everything on
 * it is app-wide. One section today, Servers. A section menu arrives with the
 * second section, since a menu listing one entry would be decoration.
 */
export default function Settings(): ReactNode {
    const [state, setState] = useState<SettingsState | null>(null);

    useEffect(() => {
        let alive = true;
        void window.zanaris.settings.get().then(s => {
            if (alive && s) setState(s);
        });
        const unsubscribe = window.zanaris.settings.onState(setState);
        return () => {
            alive = false;
            unsubscribe();
        };
    }, []);

    return (
        <div className="flex h-full flex-col bg-ink text-cream">
            <h1 className="px-2.5 pt-2.5 pb-1.5 font-pixel text-[15px] text-gold">Servers</h1>
            {state && <Servers view={state.servers} />}
        </div>
    );
}
```

- [ ] **Step 8: The gear.** In `src/renderer/icons.tsx`, after `OpenExternal`:

```tsx
/** Settings: a gear, stroked in the button's own colour like the other chrome glyphs. */
export function Gear(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
            <path d="M7.6 2.2h2.8l.4 1.9 1.4.6 1.6-1.1 2 2-1.1 1.6.6 1.4 1.9.4v2.8l-1.9.4-.6 1.4 1.1 1.6-2 2-1.6-1.1-1.4.6-.4 1.9H7.6l-.4-1.9-1.4-.6-1.6 1.1-2-2 1.1-1.6-.6-1.4-1.9-.4V7.6l1.9-.4.6-1.4-1.1-1.6 2-2 1.6 1.1 1.4-.6Z" />
            <circle cx="9" cy="9" r="2.3" />
        </svg>
    );
}
```

In `src/renderer/Shell.tsx`, import `Gear` beside `Caret, Plus`. Beside `ADD_PANE_BOX`, add:

```ts
/** The tabs' height and a square face for one glyph. Inline for the same reason as the boxes above. */
const GEAR_BOX: CSSProperties = { height: 26, width: 28, padding: 0 };
```

Immediately before the Add pane `<button>`, add:

```tsx
                    {/*
                     * Settings: a window of its own rather than a pane, since
                     * everything in it is the app's rather than this window's. A
                     * gear and no word, beside a button that already has one; its
                     * name is on the tooltip and the label.
                     */}
                    <button
                        type="button"
                        title="Settings"
                        aria-label="Settings"
                        onClick={() => void window.zanaris.settings.open()}
                        style={GEAR_BOX}
                        className="btn shrink-0 justify-center"
                    >
                        <Gear />
                    </button>
```

The comment at the top of the tab bar says "Tabs and the control that makes one, then Add pane at the far end, and nothing else." Make it name Settings too.

- [ ] **Step 9:** `npm test && npm run typecheck && npm run build`.

- [ ] **Step 10: Commit.**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/renderer.ts src/main/settingsView.ts src/main/index.ts src/main/menu.ts src/renderer/main.tsx src/renderer/Settings.tsx src/renderer/Shell.tsx src/renderer/icons.tsx
git commit -m "feat: one Settings window, opened from a gear and Settings…, holding the server list"
```

---

## Task 3: The pane goes

**Files:**
- Revert to `1e85d81`: `src/main/serverWindow.ts`, `src/main/tabs.ts`, `src/main/tabs.test.ts`, `src/shared/layout.ts`, `src/main/paneMenu.ts`
- Move: `src/renderer/tools/Servers.tsx` → `src/renderer/settings/Servers.tsx`
- Modify: `src/shared/ipc.ts`, `src/renderer/Shell.tsx`, `src/renderer/Settings.tsx`, `src/main/index.ts`, `docs/superpowers/specs/2026-09-22-settings-window-design.md`

**Interfaces:**
- Consumes: Task 2's `pushSettings()`, `mayManageServers()`, `settings`.
- Produces: no `'servers'` tool anywhere, and `ShellState` without `servers`. `ServerWindowDeps` has neither `servers` nor `bottomTool`. `openWindowTabs(treeHeight, gameHeight?)` as it was.

- [ ] **Step 1: Confirm the revert takes only the pane.** Run `git diff 1e85d81 -- src/main/serverWindow.ts src/main/tabs.ts src/main/tabs.test.ts src/shared/layout.ts src/main/paneMenu.ts`. Every hunk must be about the Servers pane: the `servers` and `bottomTool` deps, `tools.push('servers')`, `TOOL_NAMES.servers`, the `bottomTool` parameter and its test, and the "bottom pane" docstring nouns. If any hunk is not, stop and report it instead of reverting.

- [ ] **Step 2: Revert.**

```bash
git checkout 1e85d81 -- src/main/serverWindow.ts src/main/tabs.ts src/main/tabs.test.ts src/shared/layout.ts src/main/paneMenu.ts
```

- [ ] **Step 3: `src/shared/ipc.ts`.** Restore the `TOOL_IDS` docstring and array exactly as at `1e85d81` (`git show 1e85d81:src/shared/ipc.ts`): five ids, and the docstring that says "Five" without the `servers` clause. Remove `servers: ServersView;` and its docstring from `ShellState`. Keep the `ServersView` import, which `SettingsState` uses.

- [ ] **Step 4: Move the component.**

```bash
mkdir -p src/renderer/settings && git mv src/renderer/tools/Servers.tsx src/renderer/settings/Servers.tsx
```

Fix its relative imports (`../../shared/…`, `../../main/…` stay two levels up) and point `Settings.tsx` at `./settings/Servers`. Its comments say "pane" in six places ("the pane's single primary action", "the pane's next state arrives", "the loudest thing in the pane", "The Servers tool:", "Exactly one gold `.btn` in the pane"). Reword each for a section of the Settings window, keeping what each says about behaviour.

- [ ] **Step 5: `src/renderer/Shell.tsx`.** Remove `import Servers from './tools/Servers';` and the `case 'servers':` branch. Keep the gear.

- [ ] **Step 6: `src/main/index.ts`.**
- In the `ServerWindows` factory's deps, delete `servers: …` and the whole `bottomTool: …` closure. The reverted `ServerWindowDeps` no longer has them, so leaving them is a type error.
- Delete `firstLaunchPane`: its declaration and docstring near `catalogSeen`, and in `whenReady` both its assignment and the comment above it. Task 4 brings a flag back under a name that says what it now does.
- The `ServerWindows` `onChange` closure, `loadCatalog()`, `catalogChanged()` and the `serversStartup` handler each push every game window for the pane. Remove those game-window pushes and keep `pushSettings()`. Rewrite each docstring or comment to say what is pushed now and why. The `onChange` docstring is about the Servers pane's counts, so it must now be about Settings'. `catalogChanged`'s docstring still needs to say it rebuilds the menu and refreshes `catalogSeen`.
- `windowCounts()`'s docstring warns that counting through `sw.state()` would recurse because `state()` carries the Servers view. `state()` no longer does. Keep the rule of counting from `windows.list()`, which is cheap and asks nothing of a window, and say that instead.
- `mayManageServers` becomes Settings only (Decision 4):

```ts
/** Whether an IPC call may manage the catalog: only the Settings window, the one page that has a servers UI. */
function mayManageServers(sender: WebContents): boolean {
    return settings.isSender(sender.id);
}
```

- In `captureAndExit`, delete the block that opens `serversWindow` and shoots the Servers pane, including its `[capture] servers pane lists …` log line.

- [ ] **Step 7: Amend the spec line** in `docs/superpowers/specs/2026-09-22-settings-window-design.md`, under "State and IPC". It says the servers handlers accept the Settings window "as a sender as well as a game window". Make it say they accept the Settings window only, since once the pane is gone no game window has a servers UI.

- [ ] **Step 8: Check nothing of the pane survives.** `grep -rn "'servers'" src/` must match nothing (the IPC channel strings are `servers-…`). `grep -rn "bottomTool\|firstLaunchPane\|Servers pane\|tools/Servers" src/` must match nothing.

- [ ] **Step 9:** `npm test && npm run typecheck && npm run build`. `tabs.test.ts` is back to its fork-point tests, so the total drops by the one test that checked a Servers bottom pane.

- [ ] **Step 10: Commit.**

```bash
git add src/main/serverWindow.ts src/main/tabs.ts src/main/tabs.test.ts src/shared/layout.ts src/main/paneMenu.ts src/shared/ipc.ts src/renderer/Shell.tsx src/renderer/Settings.tsx src/renderer/settings/Servers.tsx src/renderer/tools/Servers.tsx src/main/index.ts docs/superpowers/specs/2026-09-22-settings-window-design.md
git commit -m "refactor: the servers pane goes, and Settings is the only place the catalog is managed"
```

---

## Task 4: A fresh profile opens Settings once

**Files:**
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `openSettings(anchor)`, `appState.fresh()`, `startupServers()`.

- [ ] **Step 1: The flag.** Beside `catalogSeen`:

```ts
/**
 * Whether this launch opens Settings once its game windows are open: only on
 * a profile that had no state file, so a newcomer sees the server list rather
 * than a Lost City client that never mentions anything else. Never during
 * capture, whose output must not depend on whether its profile happened to be
 * new.
 */
let openSettingsOnLaunch = false;
```

In `whenReady`, right after `appState.load();`:

```ts
    // Set right after load(), the only call that gives fresh() an answer.
    openSettingsOnLaunch = CAPTURE_DIR ? false : appState.fresh();
```

- [ ] **Step 2: Open it after the startup windows.** Replace the startup `else for (const server of opening) openServer(server);` with:

```ts
    else {
        const opened = opening.map(openServer);
        // Beside the first game window, so the list does not sit on the game it
        // has just opened.
        if (openSettingsOnLaunch) openSettings(opened[0]);
    }
```

Keep the empty-catalog branch (`actions.newWindow()`) and its comment as they are.

- [ ] **Step 3:** `npm test && npm run typecheck && npm run build`.

- [ ] **Step 4: Commit.**

```bash
git add src/main/index.ts
git commit -m "feat: a fresh profile's first launch opens Settings beside the game"
```

---

## Task 5: Bring main in

**Files:** a merge commit. Expect `src/main/index.ts` and `src/main/serverWindow.ts`.

- [ ] **Step 1: Fetch and merge.**

```bash
git fetch origin main
git merge --no-ff origin/main -m "Merge origin/main: capture waits for each shell to paint"
```

After Task 3, `serverWindow.ts` matches the fork point, so PR #17's change to it should apply with no conflict. `captureAndExit` in `index.ts` should also be back to the fork point's body, because Task 3 removed the only block this branch added there.

- [ ] **Step 2: If there are conflicts, resolve for both sides.** Keep PR #17's capture machinery (`front()`, `ShotLedger`, `fault()`, `save()` returning `Buffer | null`, the exit-1 on faults, `settle()` returning `boolean`) and this branch's work outside capture. Do not take either side wholesale. Report every conflicted hunk and how it was resolved.

- [ ] **Step 3: Verify.** `git diff origin/main -- src/main/serverWindow.ts` must be empty: this branch no longer changes that file. Then `npm test && npm run typecheck && npm run build`.

- [ ] **Step 4:** If Step 1 finished without conflicts, the merge commit already exists. Otherwise `git add` the resolved files by name and `git commit --no-edit`.

---

## Task 6: Capture, and docs

**Files:**
- Modify: `src/main/serverWindow.ts` (export only), `src/main/settingsView.ts`, `src/main/index.ts`, `README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: PR #17's `front()`, `save()`, `ShotLedger`, `fault()` inside `captureAndExit`; `paintsFrames(contents)` in `serverWindow.ts`.
- Produces: `SettingsWindow.settle()`, `SettingsWindow.captureShell()`, `SettingsWindow.loaded`.

- [ ] **Step 1: Share the paint check.** In `src/main/serverWindow.ts`, change `async function paintsFrames` to `export async function paintsFrames`. Nothing else in that file changes.

- [ ] **Step 2: Give Settings what a shot needs.** In `src/main/settingsView.ts`, import `type NativeImage` and `paintsFrames` from `./serverWindow`, and add to `SettingsWindow`:

```ts
    /** Resolves once the page has loaded, for capture. */
    readonly loaded: Promise<void>;
    /** Whether the page paints, as a server window's `settle` answers for its shell: a page that is not painting would hand capture its last frame. */
    settle(): Promise<boolean>;
    /** The page as it is drawn now, for capture. Named for the shot it takes, a shell shot, so capture can treat it as any other. */
    captureShell(): Promise<NativeImage>;
```

In `createSettingsWindow`, before `loadShell`:

```ts
    const loaded = new Promise<void>(resolve => win.webContents.once('did-finish-load', () => resolve()));
```

In the returned object, add `loaded,`, then `settle: () => paintsFrames(win.webContents),` and `captureShell: () => win.webContents.capturePage(),`.

- [ ] **Step 3: One shell shot for any window.** Read `captureAndExit` as merged. Change `front`'s parameter from `ServerWindow` to this type, declared just above `front`:

```ts
    /** What a shell shot needs from a window: a game window, or Settings. */
    type ShotTarget = { readonly window: BrowserWindow; focus(): void; settle(): Promise<boolean>; captureShell(): Promise<NativeImage> };
```

Move the shell half of `shoot`, meaning everything that fronts the window, saves `${name}-shell`, records it in the `ShotLedger` and faults on a twin or a shell that did not paint, into `shootShell(name: string, target: ShotTarget)`. Move that text verbatim. Have `shoot` call `await shootShell(name, sw);` and then keep its game half exactly as merged.

- [ ] **Step 4: Shoot Settings.** After the first pass that shoots every opened game window (`for (const sw of opened) await shoot(…)`), add:

```ts
        // Settings, the one window that is not a game window. Anchored to the
        // first game window as a first launch anchors it, and closed once shot:
        // where it cannot sit beside a window it opens centred, on top of one,
        // and every later shot of that window would fail its paint check.
        {
            const settingsWindow = settings.open(opened[0]?.window.getBounds() ?? null);
            await settingsWindow.loaded;
            await wait(500);
            await shootShell('settings', settingsWindow);
            log(`[capture] settings lists ${settingsState().servers.rows.length} servers`);
            settingsWindow.window.close();
        }
```

- [ ] **Step 5: README.md.** Make four changes:

1. Replace *"There is no launcher or management window; there are only game windows. New ones come from the **File menu**:"* with *"There is no launcher. There are game windows, and one Settings window for the app; new game windows come from the **File menu**:"*. Keep the rest of that paragraph.
2. Replace the paragraph beginning *"The catalog itself is also a pane, **Servers**"* with:

> The catalog lives in **Settings**, one window for the whole app, opened from the gear at the right of every window's tab bar or from Settings… (Cmd/Ctrl+,); opening it again brings the open one forward rather than making another. Its Servers section lists every server with how many of its windows are open, an Open button that starts another, and a checkbox for whether a launch opens it: tick two servers and relaunching opens both, untick every row and a launch falls back to the catalog's first entry, exactly what an empty list has always done. The same section adds a server through a short form and removes one — except the handful the kit ships with, which nothing in the app can put back once gone, so it does not offer to take them out. A fresh profile's first launch opens Settings beside the game, because nothing else on screen ever says the kit runs more than Lost City: New Window For lists the rest of the catalog, but that is a menu nobody opens without already suspecting there is something behind it. After that, Settings opens only when asked. It is a window rather than a pane or a popover because the game is a native view drawn above the tab bar's own page, so anything that page drew over the game would sit underneath it.

3. In the chat paragraph, delete *"The one exception is a fresh profile's first window, which opens on the Servers pane instead (see What it does, above)."* Chat is under the game in every window again.
4. Replace *"The Servers pane adds and removes whole entries"* with *"Settings adds and removes whole entries"*.

- [ ] **Step 6: CLAUDE.md.** Replace *"cannot be removed from the Servers pane"* with *"cannot be removed from Settings"*. Then add this section directly after "The layout invariant" section:

```markdown
## The Settings window

One window is not a game window: Settings, which holds what belongs to the
app rather than to any one window — today the catalog and the startup set.
`SettingsWindowSlot` (`src/main/settingsWindow.ts`) keeps it to one, and
opening it again brings the open one forward, because two would be two
copies of one thing. It has no parent window, since a parent would close it
along with a game window, and it never holds up a quit.

It is a window rather than a pane or a popover because the game and pages
are native views stacked above the shell's HTML: anything the shell drew
over them would sit underneath. It takes its state on its own channel,
`settings.get` and `settings.onState`, never through `ShellState`. No game
window's `state()` builds anything for it, which is how `windowCounts()` once
came to recurse through `state()`. Only Settings may call the servers
handlers.
```

- [ ] **Step 7:** `npm test && npm run typecheck && npm run build`. You cannot run capture. Say so, and leave that to the controller.

- [ ] **Step 8: Commit.**

```bash
git add src/main/serverWindow.ts src/main/settingsView.ts src/main/index.ts README.md CLAUDE.md
git commit -m "docs: Settings in the README and CLAUDE.md, and capture shoots it"
```

---

## Verification

`npm test`, `npm run typecheck` and `npm run build` after every task. The controller runs the app at the end:

1. **`npm run capture`** exits 0. PR #17 fails the run on an unpainted or byte-identical shell. Open `captures/settings-shell.png` and confirm it shows the server list, because the log reads state, not pixels. Leave the machine alone while capture runs.
2. **Fresh profile.** Move the real profile aside, run `npm run dev`, and expect the game window with Settings beside it. Relaunch and expect no Settings. Restore the profile.
3. **The gear, Settings… and Cmd/Ctrl+,** each open the same window, and a second press brings it forward.
4. **Cmd/Ctrl+W** closes Settings when it has focus.
5. **Open, the startup ticks, add and remove** all work from Settings, and File > New Window For agrees after an add or remove.
6. **Opening and closing a game window** updates the counts in an open Settings.
7. **No game window offers a Servers pane** in Add pane or any pane's dropdown.
