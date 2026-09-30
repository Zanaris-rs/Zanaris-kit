# Windows Title Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Windows, the kit's tab bar becomes the window's title bar: no system title bar or menu row, Windows' own buttons over the bar's right end on a transparent ground, and a ≡ at its left end that opens the application menu.

**Architecture:** `src/main/windowFrame.ts` stays the one pure, tested rule for how a window is framed; it gains Windows (`titleBarStyle: 'hidden'` plus a transparent `titleBarOverlay` whose glyphs wear the theme's `cream`) and a `menuButton` flag. Main applies it when a window opens and again on every theme change. The shell's `TopBar` clears the overlay by reading its rect from `env(titlebar-area-*)`, and a ≡ asks main to pop `Menu.getApplicationMenu()`.

**Tech Stack:** Electron 44.5.0, React, TypeScript, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-30-windows-title-bar-design.md`

## Global Constraints

- Electron **44.4.0 or later** (electron/electron#53639 gives a `WebContentsView` the overlay's rect); install **44.5.0**.
- macOS and Linux behave exactly as before. `frameOptions('darwin', …)` and `windowFrame('darwin', …)` keep today's values; Linux keeps the system frame.
- The overlay: colour `#00000000`, symbol colour the look's `colors.cream`, height `TAB_BAR_HEIGHT - 2` (38).
- No literal colour in `src/renderer` (`themes.test.ts` fails on hex, `rgb()`, `hsl()`); main may hold `#00000000`.
- Comments are load-bearing: fix every comment this change makes untrue, in any file, and re-read the comments around each edit before committing.
- IPC channels are `zanaris:<area>-<verb>`; the new one is `tabAppMenu: 'zanaris:tab-app-menu'`.
- Files under `src/main` import their neighbours without an extension, except `windowFrame.ts`, which `node --test` loads directly and so imports with `.ts`.
- No absolute home-directory path in any file (`src/shared/identity.test.ts`).
- `gh` against `Zanaris-rs` only as `GH_TOKEN=$(gh auth token -u Zanaris274) gh …`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Electron 44.5.0

**Files:**
- Modify: `package.json` (the `electron` devDependency), `package-lock.json`

**Interfaces:**
- Produces: `env(titlebar-area-*)` in the shell's `WebContentsView` on Windows, which Task 3 relies on.

- [ ] **Step 1: Install**

Run: `npm install --save-dev electron@44.5.0`
Expected: `package.json` reads `"electron": "^44.5.0"`; `node -p "require('./node_modules/electron/package.json').version"` prints `44.5.0`.

- [ ] **Step 2: Check nothing else moved**

Run: `git diff --stat`
Expected: only `package.json` and `package-lock.json`.

- [ ] **Step 3: Static checks**

Run: `npm run typecheck && npm test`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: Electron 44.5.0, which tells a WebContentsView where Windows' buttons are

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Windows' frame in main

**Files:**
- Modify: `src/main/windowFrame.ts`
- Test: `src/main/windowFrame.test.ts`
- Modify: `src/shared/ipc.ts` (the `WindowFrame` interface and the two `frame` field docs)
- Modify: `src/main/serverWindow.ts` (imports; `FRAME_ALLOWANCE` comment; the `BrowserWindow` options; `themeChanged`; the full-screen comment near `enter-full-screen`)
- Modify: `src/main/settingsView.ts` (imports; `SettingsWindow.setBackground` → `setLook`; `opts.background` → `opts.look`; the `BrowserWindow` options and the `autoHideMenuBar` comment)
- Modify: `src/main/index.ts` (the `createSettingsWindow` call; `restyle`)

**Interfaces:**
- Produces:
  - `overlayFor(platform: NodeJS.Platform, look: ThemeLook): TitleBarOverlay | null`
  - `frameOptions(platform: NodeJS.Platform, look: ThemeLook): { titleBarStyle?: 'hidden'; trafficLightPosition?: { x: number; y: number }; titleBarOverlay?: TitleBarOverlay }`
  - `windowFrame(platform, fullScreen): WindowFrame`, where `WindowFrame` is `{ ownTitleBar: boolean; buttonsInset: number; menuButton: boolean }`
  - `SettingsWindow.setLook(look: ThemeLook): void`, and `createSettingsWindow`'s `look: ThemeLook` option in place of `background: string`

- [ ] **Step 1: Write the failing tests**

Replace `src/main/windowFrame.test.ts` with:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAC_BUTTON, MAC_BUTTONS_AT, MAC_BUTTONS_CLEAR, frameOptions, overlayFor, windowFrame } from './windowFrame.ts';
import { TAB_BAR_HEIGHT } from '../shared/layout.ts';
import { THEMES, type ThemeLook } from '../shared/themes.ts';

const LOOK: ThemeLook = { colors: THEMES[0].colors, background: null };
const OTHER: ThemeLook = { colors: { ...THEMES[0].colors, cream: '#e0ebe3' }, background: null };

test('macOS draws no title bar, and puts its window buttons where the kit says', () => {
    assert.deepEqual(frameOptions('darwin', LOOK), { titleBarStyle: 'hidden', trafficLightPosition: MAC_BUTTONS_AT });
});

test('Windows draws no title bar, and puts its own buttons over the row', () => {
    assert.deepEqual(frameOptions('win32', LOOK), {
        titleBarStyle: 'hidden',
        titleBarOverlay: { color: '#00000000', symbolColor: LOOK.colors.cream, height: TAB_BAR_HEIGHT - 2 }
    });
});

test('Linux keeps the system frame, which holds its menu bar', () => {
    assert.deepEqual(frameOptions('linux', LOOK), {});
});

test("Windows' buttons have no ground of their own, so the stone and a picture show behind them", () => {
    assert.match(overlayFor('win32', LOOK)!.color, /^#[0-9a-f]{6}00$/i);
});

test("Windows' buttons wear the theme's text colour, and follow it", () => {
    assert.equal(overlayFor('win32', LOOK)!.symbolColor, LOOK.colors.cream);
    assert.equal(overlayFor('win32', OTHER)!.symbolColor, '#e0ebe3');
});

test("Windows' buttons stand in the strip and its underside, so the rule runs on beneath them", () => {
    assert.equal(overlayFor('win32', LOOK)!.height + 2, TAB_BAR_HEIGHT);
});

test('only Windows has an overlay to restyle', () => {
    assert.equal(overlayFor('darwin', LOOK), null);
    assert.equal(overlayFor('linux', LOOK), null);
});

test("on macOS the top row is the title bar, and starts clear of the window's buttons", () => {
    assert.deepEqual(windowFrame('darwin', false), { ownTitleBar: true, buttonsInset: MAC_BUTTONS_CLEAR, menuButton: false });
});

test('in full screen macOS takes its buttons away, so the row starts at the edge again', () => {
    assert.deepEqual(windowFrame('darwin', true), { ownTitleBar: true, buttonsInset: 0, menuButton: false });
});

test('on Windows the top row is the title bar, and carries the menu the title bar held, full screen or not', () => {
    for (const fullScreen of [false, true]) {
        assert.deepEqual(windowFrame('win32', fullScreen), { ownTitleBar: true, buttonsInset: 0, menuButton: true });
    }
});

test('on Linux the top row is only a row, full screen or not', () => {
    for (const fullScreen of [false, true]) {
        assert.deepEqual(windowFrame('linux', fullScreen), { ownTitleBar: false, buttonsInset: 0, menuButton: false });
    }
});

test('the buttons end before the first control begins', () => {
    const zoomRight = MAC_BUTTONS_AT.x + 2 * MAC_BUTTON.pitch + MAC_BUTTON.size;
    assert.ok(zoomRight < MAC_BUTTONS_CLEAR, `zoom ends at ${zoomRight}, the row starts at ${MAC_BUTTONS_CLEAR}`);
});

test("the buttons sit inside the strip, level with its tabs", () => {
    // The strip is the bar less its 2px rule, and its 2px bevelled underside
    // below the tabs; the tabs are centred in what is left.
    const tabsMiddle = (TAB_BAR_HEIGHT - 4) / 2;
    assert.equal(MAC_BUTTONS_AT.y + MAC_BUTTON.size / 2, tabsMiddle);
    assert.ok(MAC_BUTTONS_AT.y >= 0 && MAC_BUTTONS_AT.y + MAC_BUTTON.size <= TAB_BAR_HEIGHT - 4);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test src/main/windowFrame.test.ts`
Expected: FAIL — `overlayFor` is not exported, and the `win32` and `menuButton` cases disagree.

- [ ] **Step 3: Write the rule**

Replace everything in `src/main/windowFrame.ts` above `MAC_BUTTON` (the imports and the header comment), and everything from `frameOptions` down, so the file reads:

```ts
import type { WindowFrame } from '../shared/ipc.ts';
import type { ThemeLook } from '../shared/themes.ts';
import { TAB_BAR_HEIGHT } from '../shared/layout.ts';

/*
 * How the OS frames the kit's windows: the rule behind `WindowFrame`, which a
 * game window's shell and Settings each draw their top row from.
 *
 * On macOS and Windows the system's title bar is not drawn. It cannot wear a
 * theme — its colour is the system's, whatever the kit's frame is — so it sat
 * as a band above every theme. With it gone, the window's own top row runs to
 * the top edge and stands in for it: macOS draws the window buttons over that
 * row's left end, and Windows over its right.
 *
 * Windows hung the app menu in its title bar, and the menu went with it, so a
 * game window's row starts with a button that opens the menu instead
 * (`menuButton`). Every shortcut still fires: Electron registers a menu's
 * accelerators whether or not it has a bar to draw it in.
 *
 * Linux keeps the system's frame, and its menu bar in it: its window managers
 * treat a hidden title bar unevenly.
 */
```

(keep `MAC_BUTTON`, `MAC_BUTTONS_AT` and `MAC_BUTTONS_CLEAR` exactly as they are), then:

```ts
/** Windows' window buttons, which Windows draws over the right end of the top row: the options `titleBarOverlay` and `setTitleBarOverlay` take. */
export interface TitleBarOverlay {
    color: string;
    symbolColor: string;
    height: number;
}

/**
 * Windows' buttons, as a window wearing `look` shows them, or null where the
 * system draws its own title bar or, on macOS, its own buttons.
 *
 * No ground of their own: Electron fills a caption button's ground only when
 * its colour has some alpha, so with none the stone shows behind them, and a
 * theme's picture through it. Their hover is a tenth of the glyph colour, and
 * close's is Windows' red. The glyphs are the theme's text colour. They stand
 * in the strip and its bevelled underside, so the 2px rule under the bar runs
 * on beneath them.
 */
export function overlayFor(platform: NodeJS.Platform, look: ThemeLook): TitleBarOverlay | null {
    if (platform !== 'win32') return null;
    return { color: '#00000000', symbolColor: look.colors.cream, height: TAB_BAR_HEIGHT - 2 };
}

/** The frame a window opens with, spread into its `BrowserWindow` options. Empty keeps the system's own. */
export function frameOptions(
    platform: NodeJS.Platform,
    look: ThemeLook
): { titleBarStyle?: 'hidden'; trafficLightPosition?: { x: number; y: number }; titleBarOverlay?: TitleBarOverlay } {
    if (platform === 'darwin') return { titleBarStyle: 'hidden', trafficLightPosition: MAC_BUTTONS_AT };
    const overlay = overlayFor(platform, look);
    return overlay ? { titleBarStyle: 'hidden', titleBarOverlay: overlay } : {};
}

/** How a window's top row is framed now. Full screen matters because macOS takes the window buttons away there. */
export function windowFrame(platform: NodeJS.Platform, fullScreen: boolean): WindowFrame {
    if (platform === 'darwin') return { ownTitleBar: true, buttonsInset: fullScreen ? 0 : MAC_BUTTONS_CLEAR, menuButton: false };
    if (platform === 'win32') return { ownTitleBar: true, buttonsInset: 0, menuButton: true };
    return { ownTitleBar: false, buttonsInset: 0, menuButton: false };
}
```

- [ ] **Step 4: The type it answers with**

In `src/shared/ipc.ts`, replace the `WindowFrame` interface's body:

```ts
export interface WindowFrame {
    /**
     * The row stands in for the OS's title bar, which is not drawn: it moves
     * the window, and the theme runs to the window's top edge. On macOS and
     * Windows; Linux keeps the system's bar, which holds its menu bar.
     */
    ownTitleBar: boolean;
    /** How far in from the window's left edge the row's first control must start, to clear the window buttons macOS draws over it. Zero where there are none to clear: off macOS, and in full screen. Windows' are at the row's other end, which the row clears by their own rect (`topBar.tsx`). */
    buttonsInset: number;
    /**
     * The app menu has no bar of its own here, so a game window's row starts
     * with a button that opens it: on Windows, whose title bar held it.
     * Settings' row draws none — its menu bar was hidden already, and nearly
     * everything in the menu acts on a game window.
     */
    menuButton: boolean;
}
```

and the two field docs that point at it:

```ts
    /** How the OS frames the tab bar, which is the window's title bar on macOS and Windows. */
    frame: WindowFrame;
```

```ts
    /** How the OS frames the row of sections, which is the window's title bar on macOS and Windows. */
    frame: WindowFrame;
```

- [ ] **Step 5: Run the tests**

Run: `node --test src/main/windowFrame.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 6: A game window opens in it, and restyles it**

In `src/main/serverWindow.ts`:

Import: `import { frameOptions, overlayFor, windowFrame } from './windowFrame';`

The `FRAME_ALLOWANCE` comment becomes:

```ts
/**
 * Room left on the display for the window's own frame, which a content size
 * does not include: a caption and borders on Linux. macOS and Windows draw no
 * caption, since the tab bar stands in for their title bars
 * (`windowFrame.ts`), and the allowance there is only room to spare. Generous
 * rather than measured, since the frame cannot be asked for before the window
 * exists and an opening size a few pixels short costs nothing.
 */
```

In the `new BrowserWindow({ … })` options:

```ts
        // No title bar on macOS or Windows: the tab bar stands in for it (`windowFrame.ts`).
        ...frameOptions(process.platform, deps.theme()),
```

`themeChanged` becomes:

```ts
    /**
     * Repaints what main paints — the window, the shell view and every page
     * view, in the theme's ground, and on Windows the window buttons' glyphs,
     * in its text colour — and sends the shell its palette. The game view
     * keeps its black: that is the game's own ground, never themed.
     */
    function themeChanged(): void {
        if (win.isDestroyed()) return;
        const look = deps.theme();
        const ground = look.colors.window;
        win.setBackgroundColor(ground);
        shellView.setBackgroundColor(ground);
        const overlay = overlayFor(process.platform, look);
        if (overlay) win.setTitleBarOverlay(overlay);
        host.repaintBackground();
        pushState();
    }
```

The comment above `win.on('maximize', …)` stays true (it names only macOS's buttons, which full screen still takes); leave it.

- [ ] **Step 7: Settings opens in it, and restyles it**

In `src/main/settingsView.ts`:

Imports: add `import type { ThemeLook } from '../shared/themes';` and change the frame import to `import { frameOptions, overlayFor } from './windowFrame';`

In `SettingsWindow`, replace `setBackground`:

```ts
    /** What Settings wears changed — the app theme, or the theme being edited: the window's own ground follows, as a game window's does in `themeChanged`, and on Windows so do its window buttons' glyphs. */
    setLook(look: ThemeLook): void;
```

In `createSettingsWindow`'s options, replace `background: string;` with:

```ts
    /** What Settings wears when it opens: the app theme, or the theme being edited. */
    look: ThemeLook;
```

In `new BrowserWindow({ … })`:

```ts
        // No title bar on macOS or Windows: the row of sections stands in
        // for it, as a game window's tab bar does (`windowFrame.ts`).
        ...frameOptions(process.platform, opts.look),
        // The ground of what Settings wears — the app theme, or the theme
        // being edited: what shows before the page draws, and at an edge a
        // resize has not yet repainted. `setLook` keeps it to the theme
        // after a change.
        backgroundColor: opts.look.colors.window,
```

and the `autoHideMenuBar` comment:

```ts
        // Linux hangs the app menu on every window; here, the pane and tab
        // items — Split, Close Pane, Close Tab, Even Out, Select Tab — have
        // nothing to act on, so it waits for Alt. Everything else still
        // does, and every shortcut still fires. Windows' menu bar went with
        // its title bar (`windowFrame.ts`), so this is Linux's alone.
        autoHideMenuBar: true,
```

In the returned object, replace `setBackground`:

```ts
        setLook: look => {
            if (win.isDestroyed()) return;
            win.setBackgroundColor(look.colors.window);
            const overlay = overlayFor(process.platform, look);
            if (overlay) win.setTitleBarOverlay(overlay);
        }
```

The `onFrameChanged` doc ("which on macOS takes the window buttons off the row of sections or puts them back") stays true; leave it.

- [ ] **Step 8: Main hands Settings the look**

In `src/main/index.ts`, in the `SettingsWindowSlot` factory:

```ts
        look: lookFor(appState.appearance(), null, editing),
```

(replacing `background: lookFor(appState.appearance(), null, editing).colors.window,`), and `restyle` becomes:

```ts
/**
 * Every game window restyled to what it now wears, and Settings' own ground
 * and window buttons with it; Settings' page follows when it is next pushed
 * its state. All of them, since working out which ones moved would only save
 * repainting a few in the colours they already wear.
 */
function restyle(): void {
    for (const sw of serverWindows.values()) sw.themeChanged();
    settings.current()?.setLook(lookFor(appState.appearance(), null, editing));
}
```

- [ ] **Step 9: Static checks**

Run: `npm run typecheck && npm test`
Expected: both pass. `grep -rn "setBackground(" src/main` finds only `setBackgroundColor` calls.

- [ ] **Step 10: Commit**

```bash
git add src/main/windowFrame.ts src/main/windowFrame.test.ts src/shared/ipc.ts src/main/serverWindow.ts src/main/settingsView.ts src/main/index.ts
git commit -m "feat: on Windows the kit draws no title bar, and Windows' buttons wear the theme

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The shell's row — clear of Windows' buttons, and the ≡

**Files:**
- Modify: `src/renderer/topBar.tsx` (right padding; the component's and `BAR_END`'s comments)
- Modify: `src/renderer/icons.tsx` (new `AppMenu` glyph, after `Gear`)
- Modify: `src/renderer/Shell.tsx` (import; `MENU_BOX`; the ≡ button; the `GEAR_BOX` comment; the row's opening comment)
- Modify: `src/renderer/Settings.tsx` (the comment above its `TopBar`)
- Modify: `src/renderer/styles.css` (the `.title-bar` comment)
- Modify: `src/shared/ipc.ts` (`IPC.tabAppMenu`; `panes.appMenu`)
- Modify: `src/preload/index.ts` (`panes.appMenu`)
- Modify: `src/main/index.ts` (the `IPC.tabAppMenu` handler)

**Interfaces:**
- Consumes: `WindowFrame.menuButton` (Task 2).
- Produces: `window.zanaris.panes.appMenu(x: number, y: number): Promise<void>`, on channel `zanaris:tab-app-menu`.

- [ ] **Step 1: The channel and the bridge**

In `src/shared/ipc.ts`, after `tabSetupsMenu: 'zanaris:tab-setups-menu',`:

```ts
    tabAppMenu: 'zanaris:tab-app-menu',
```

In the `panes` API, after `setupsMenu(x: number, y: number): Promise<void>;`:

```ts
        /**
         * Raises the application menu — File, Edit, View, Window and Help —
         * from the ≡ that starts the tab bar where the window has no menu bar
         * of its own (`WindowFrame.menuButton`). The menu is the one the
         * shortcuts belong to. Coordinates are the window's.
         */
        appMenu(x: number, y: number): Promise<void>;
```

In `src/preload/index.ts`, after `setupsMenu: …,`:

```ts
        appMenu: (x, y) => ipcRenderer.invoke(IPC.tabAppMenu, x, y),
```

- [ ] **Step 2: Main pops the menu**

In `src/main/index.ts`, after the `IPC.tabSetupsMenu` handler (`Menu` is already imported there):

```ts
/**
 * The ≡ that starts the tab bar where the window has no menu bar
 * (`windowFrame.ts`): the whole application menu, under the button. The same
 * menu the shortcuts belong to, so the two cannot disagree.
 */
ipcMain.handle(IPC.tabAppMenu, (event, x: unknown, y: unknown) => {
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const sw = windowFor(event.sender);
    if (!sw || sw.window.isDestroyed()) return;
    Menu.getApplicationMenu()?.popup({ window: sw.window, x: Math.round(x), y: Math.round(y) });
});
```

- [ ] **Step 3: The glyph**

In `src/renderer/icons.tsx`, after `Gear`:

```tsx
/** The application menu, where a window has no menu bar: three bars, stroked in the button's own colour like the gear beside them. */
export function AppMenu(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" shapeRendering="crispEdges">
            <path d="M3 5h12M3 9h12M3 13h12" />
        </svg>
    );
}
```

- [ ] **Step 4: The row clears Windows' buttons**

In `src/renderer/topBar.tsx`, before `BAR_END`:

```ts
/**
 * The row's right padding: its own 5px end, past whatever Windows' window
 * buttons cover of it. Their rect is the overlay's (`env(titlebar-area-*)`),
 * which Electron hands the shell's view from 44.4; nothing here knows how
 * wide they are, so it holds at any display scaling. Where none is drawn —
 * macOS, Linux, full screen — the fallbacks make the cover nothing. Inline,
 * as the left inset is, so no build step rewrites the `env()`.
 */
const END_PADDING = 'calc(5px + 100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))';
```

`BAR_END`'s comment becomes:

```ts
/**
 * How far in from the row's right end the bar's last control ends: the bar's
 * own 5px end and 7 more after the gear, since on macOS that end is the
 * window's rounded corner. The row ends at the window's edge, or on Windows
 * where its window buttons begin. Every pane header ends its controls as far
 * in from its own right edge, so a pane at the window's edge has its close
 * under the gear — on Windows, under the window's own close instead.
 */
```

The component's comment's second paragraph becomes:

```ts
 * Main says how the OS frames it (`windowFrame.ts`). Where the row is the
 * title bar it moves the window, and its controls keep clear of the window
 * buttons the OS draws over it: its first starts past macOS's at its left
 * end, and its last ends short of Windows' at its right. Everywhere else it
 * is only a row, as it always was.
```

and the `<header>`'s style:

```tsx
            <header style={{ ...STRIP_BAR, paddingLeft: frame.buttonsInset || undefined, paddingRight: END_PADDING }} className="tile flex flex-1 items-center gap-[5px] px-[5px]">
```

- [ ] **Step 5: The ≡ in the game window's row**

In `src/renderer/Shell.tsx`:

Import: `import { AppMenu, Caret, Gear, Plus } from './icons';`

After `GEAR_BOX`, and rewrite `GEAR_BOX`'s comment's last sentence:

```ts
/**
 * The tabs' height, and a pane header's button's width, since the close of
 * the pane under the gear sits directly below it (`BAR_END`). After the bar's
 * own 5px like the menus before it, and a wider gap after it than the bar's
 * 5px end: the row's right end is the window's rounded corner on macOS, and
 * Windows' window buttons on Windows. Inline for the same reason as the boxes
 * above.
 */
const GEAR_BOX: CSSProperties = { height: 26, width: HEADER_BUTTON_WIDTH, padding: 0, marginRight: BAR_END - 5 };
/** The gear's box, without the gap after it: the ≡ starts the row, after the bar's own 5px. Inline for the same reason as the boxes above. */
const MENU_BOX: CSSProperties = { height: 26, width: HEADER_BUTTON_WIDTH, padding: 0 };
```

The row's opening comment (inside `<TopBar …>`) starts "Tabs and the control that makes one, then Sharing…"; make its first sentence:

```
                 * The menu, where the window has no menu bar, then tabs and
                 * the control that makes one, then Sharing while a live link
                 * has no pane to mark, then the kit's own update while there
                 * is one, then the two menus that act on the tab in front,
                 * Setups and Add pane, side by side, and Settings alone in
                 * the corner, and nothing else.
```

(the rest of that comment unchanged). Then, directly before `<div role="tablist" …>` and its own comment:

```tsx
                {/*
                 * The application menu, where the window has no menu bar to
                 * hang it in: on Windows, whose title bar this row replaces
                 * (`windowFrame.ts`). First in the row, where macOS keeps
                 * room for its window buttons. Main's menu, the one the
                 * shortcuts belong to, opened under the button.
                 */}
                {state.frame.menuButton && (
                    <button
                        type="button"
                        title="Menu"
                        aria-label="Menu"
                        aria-haspopup="menu"
                        onClick={event => {
                            const box = event.currentTarget.getBoundingClientRect();
                            void window.zanaris.panes.appMenu(box.left, box.bottom);
                        }}
                        style={MENU_BOX}
                        className="btn shrink-0 justify-center"
                    >
                        <AppMenu />
                    </button>
                )}
```

- [ ] **Step 6: The comments that said "macOS"**

`src/renderer/Settings.tsx`, above its `TopBar`:

```
             * The sections are a strip across the top, as a game window's tabs
             * are, because on macOS and Windows both are their window's title
             * bar. Buttons with aria-current, as chat's and Home server's rows
             * are, since there is no tabpanel here that a tablist could point at.
```

`src/renderer/styles.css`, above `.title-bar`:

```css
/*
 * A window's top row where it stands in for the OS's title bar, on macOS and
 * Windows (`windowFrame.ts`): pressing it moves the window, as a title bar
 * does, except on a tab or a button, which keep their presses. The system
 * takes a press on a drag region before the page sees it, so anything
 * pressable left out of the exception would stop working here.
 */
```

Then grep for anything else this makes untrue:

Run: `grep -rn -i "title bar on macOS\|on macOS only\|Windows and Linux keep\|off macOS" src`
Expected: every hit still true once read — `ipc.ts`'s `buttonsInset` doc ("off macOS, and in full screen") and `menu.ts`'s notes on Electron's menus off macOS are. Fix any that is not.

- [ ] **Step 7: Static checks**

Run: `npm run typecheck && npm test`
Expected: both pass; `themes.test.ts` finds no literal colour in the renderer.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/topBar.tsx src/renderer/icons.tsx src/renderer/Shell.tsx src/renderer/Settings.tsx src/renderer/styles.css src/shared/ipc.ts src/preload/index.ts src/main/index.ts
git commit -m "feat: on Windows the tab bar clears Windows' buttons, and a ≡ opens the menu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: README and the themes spec

**Files:**
- Modify: `README.md` (the paragraph beginning "On macOS a theme runs to the window's top edge"; the file-list lines for `windowFrame.ts` and `topBar.tsx`)
- Modify: `docs/superpowers/specs/2026-09-25-themes-design.md` (the "Since changed on macOS" note)

- [ ] **Step 1: README's paragraph**

Replace it with:

```markdown
On macOS and Windows a theme runs to the window's top edge. The system's title
bar can't wear one, since its colour is the system's whatever the frame is, so
the kit's windows don't draw it: the tab bar stands in for it, and in Settings
the row of sections does. It moves the window as a title bar does. macOS's
window buttons sit at its left end, level with the tabs; Windows' sit at its
right end on the stone, in the theme's text colour. Windows hung the menu in
its title bar, so there the tab bar starts with a ≡ that opens it. Linux keeps
the system's title bar, and its menu bar in it.
```

- [ ] **Step 2: README's file list**

```
src/main/windowFrame.ts     pure: the title bar macOS and Windows don't draw, and
                            where their window buttons go                           (tested)
```

```
src/renderer/topBar.tsx     the strip across a window's top, its title bar on macOS and Windows
```

(keep each line's column alignment as the neighbouring lines have it).

- [ ] **Step 3: The themes spec's note**

```markdown
> Since changed on macOS and Windows: the kit's windows draw no title bar
> there, and the tab bar stands in for it, so a theme runs to the window's
> top edge (`src/main/windowFrame.ts`). Linux keeps the system's, which holds
> its menu bar.
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-25-themes-design.md
git commit -m "docs: the title bar Windows no longer draws

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Verify and ship

- [ ] **Step 1: Static checks, whole branch**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass.

- [ ] **Step 2: macOS unchanged, by eye**

Run: `caffeinate -d npm run capture` and leave the machine alone.
Expected: exit 0. Open the shell shots and Settings' shot in `captures/`: no ≡; the gear ends 12px in from the window's edge; the traffic lights where they were; Settings' row as before. Grep the log for `could not push state` and `Maximum call stack` (none).

- [ ] **Step 3: Independent review**

Dispatch a reviewer (superpowers:requesting-code-review) over `main..HEAD` against the spec. Fix what it finds that holds up.

- [ ] **Step 4: Push and build Windows**

```bash
git push -u origin claude/windows-information-overload-9719de
GH_TOKEN=$(gh auth token -u Zanaris274) gh workflow run release.yml --repo Zanaris-rs/Zanaris-kit --ref claude/windows-information-overload-9719de
```

The run's `zanaris-kit-windows-latest` artifact holds `Zanaris-Kit-Setup-0.9.1.exe`. Do not poll it.

- [ ] **Step 5: Open the PR**

`GH_TOKEN=$(gh auth token -u Zanaris274) gh pr create --repo Zanaris-rs/Zanaris-kit --base main …` with the spec's Windows checklist in the body, then `gh pr view <n> --json author` shows `Zanaris274`.
