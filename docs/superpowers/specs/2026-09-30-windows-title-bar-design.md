# Windows: the tab bar is the title bar

**Date:** 2026-09-30
**Status:** approved in chat, building on `claude/windows-information-overload-9719de`

## Why

On Windows the game sat under four rows of chrome. Measured off the owner's
screenshot at 100% scaling: the system's title bar (30px, "Zanaris — World 1"
and the window buttons), the menu bar (26px, File Edit View Window Help), the
kit's tab bar (40px) and the game pane's header (32px). On macOS the first two
are not in the window at all: the tab bar stands in for the title bar
(`src/main/windowFrame.ts`), and the menu is at the top of the screen. The
owner's word for the Windows window was "way too much information".

The first two rows were there only because `frameOptions` kept the system's
frame everywhere but macOS, on the grounds that the frame holds the menu bar.

## The owner's calls

1. **Only Windows' frame changes.** The tab bar and the pane header stay as
   they are, on every platform. Linux keeps the system's frame: its window
   managers treat a hidden title bar unevenly, and nobody has asked.
2. **The tab bar is the title bar on Windows, as on macOS.** Windows' title
   bar and the menu row go, 56px given back to the game at any window size.
3. **The menu lives behind a button at the row's left end**, where macOS
   keeps room for its traffic lights, rather than folded into the gear or on
   Alt alone.
4. **Windows' own minimise, maximise and close** sit over the row's right
   end, drawn by Windows, with no ground of their own.

## What a Windows player sees

- **No title bar and no menu row.** The tab bar runs to the window's top
  edge, as on macOS.
- **The window buttons** sit over the tab bar's right end, on the stone,
  with no box of their own, so the stone and a theme's picture show behind
  them. Their glyphs are the theme's text colour and follow the theme — the
  app's, a server's, and a draft being edited in Settings. Close still
  turns red under the pointer, and on Windows 11 hovering maximise still
  offers the snap layouts. Minimise and maximise hover in a tenth of
  Windows' own caption colour, which the kit cannot set.
- **Setups, Add pane and the gear** move left to clear the buttons. The gear
  ends `BAR_END` (12px) short of them, as it ends 12px short of the window's
  edge wherever there are none. The mockup the owner approved had 5; the
  same 12 everywhere keeps the one rule and costs 7px.
- **A ≡ starts the row.** It opens the whole application menu where it is —
  File, Edit, View, Window and Help as submenus — the same menu the shortcuts
  belong to, since it is the one `menu.ts` builds.
- **The row moves the window.** Pressing its empty stone and dragging moves
  the window; a double-click maximises; dragging to a screen edge snaps; a
  right-click gives Windows' own window menu. Tabs and buttons keep their
  clicks.
- **Settings** gets the same frame: its row of sections is its title bar,
  with Windows' buttons at its right end. It has no ≡: its menu bar was
  hidden already, and nearly everything in the menu acts on a game window.
- **What goes:** the window's title inside the window (it is still on the
  taskbar and in Alt+Tab, and the game pane's header names the world), and
  Alt reaching the menu, since there is no menu bar left to reach.

macOS and Linux are exactly as they were.

## How it is built

### Electron 44.4 or later

The shell is a `WebContentsView`, not the window's own page. Electron gave
such a view the window buttons' rect — `env(titlebar-area-*)` and
`navigator.windowControlsOverlay` — only from 44.4.0
(electron/electron#53639, backported to 44); before that only a
`BrowserWindow`'s own page had it. The kit was on 44.1.1, and goes to the
latest 44. Draggable regions in a `WebContentsView` have worked since
Electron made each view a draggable-region provider.

### `windowFrame.ts`, the rule

Pure and tested, and still the one place that says how a window is framed.

- `frameOptions(platform, look)` answers, on `win32`, `titleBarStyle:
  'hidden'` and a `titleBarOverlay`: fully transparent, its glyphs the look's
  `cream`, and `TAB_BAR_HEIGHT - 2` tall — the strip and its bevelled
  underside, so the 2px rule under the bar runs unbroken beneath the
  buttons. On `darwin` it answers what it did; elsewhere nothing.
- `overlayFor(platform, look)` is that overlay alone, for a theme change, and
  null where there is none.
- `windowFrame(platform, fullScreen)` answers, on `win32`, `ownTitleBar:
  true`, `buttonsInset: 0` — the buttons are at the other end — and two new
  flags: `menuButton: true`, and `buttonsAtEnd`, true but in full screen,
  where Windows takes the buttons away. Both are false everywhere else.

A transparent overlay draws nothing of its own: Electron's caption button
fills its ground only when the colour's alpha is above zero
(`win_caption_button.cc`). Its hover is not the glyph colour: minimise and
maximise take a tenth of `kColorCaptionButtonForegroundActive`, Windows' own
caption colour, white or black by how light the system's frame is, and
close takes its fixed red. With Windows in light mode that is a tenth of
black over dark stone, which may barely show; the API cannot set it.

### The theme reaches the buttons

`serverWindow.themeChanged()` repaints a window's ground; beside that it
calls `win.setTitleBarOverlay(overlay)` when `overlayFor` answers one.
Settings' `setBackground(colour)` becomes `setLook(look)`, which does both,
and `createSettingsWindow` takes the look rather than its window colour.
Every path a theme takes to a window — the app's, a server's, a draft —
already runs through those two.

### The row's right end

Where `frame.buttonsAtEnd`, `TopBar` pads its right end by what the overlay
covers: `calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width,
100vw))` on top of its 5px. Nothing measures or hard-codes the buttons'
width, so it holds at any display scaling. Inline, beside the left inset,
so no build step can touch `env()`.

The flag, not the rect, says when: in full screen Electron still reports
the overlay's rect at the buttons' full width, with buttons of no height
(`WinFrameView::TitlebarHeight` answers 0 there, and
`LayoutWindowControlsOverlay` reports the custom height and the container's
width regardless). Read off the rect alone, the row would keep about 140px
for buttons that are gone. Both windows push their frame again on entering
and leaving full screen.

### The ≡

A new `Menu` glyph in `icons.tsx`, three bars in the button's own colour
like the gear's strokes, in a `.btn` the gear's size, first in the game
window's `TopBar` when `frame.menuButton`. A press calls a new
`window.zanaris.panes.appMenu(x, y)` with the button's bottom left, as
Setups and Add pane do, on a new channel `IPC.tabAppMenu`
(`zanaris:tab-app-menu`). Main checks the numbers as it does for theirs, and
pops `Menu.getApplicationMenu()` over the sender's window at that point.

### What else changes with it

Comments and docs that say Windows keeps the system's frame, or that its
menu hangs there, or that the row is a title bar only on macOS:
`windowFrame.ts`, `WindowFrame` in `ipc.ts`, `FRAME_ALLOWANCE` in
`serverWindow.ts`, the `autoHideMenuBar` note in `settingsView.ts` (it now
matters only on Linux), `BAR_END` and `TopBar`, the `.title-bar` rule in
`styles.css`, the README's paragraph on it and its file list, and the note
in `2026-09-25-themes-design.md`.

Known and accepted: a game window's floor is `PANE_MIN_WIDTH`, 120px, and
Windows' three buttons are about 138. Narrower than about 170px they cover
the ≡, the only way to the menu by mouse; the shortcuts still work, and at
that width the bar's own buttons have long since run off its end.

Untouched: the pane tree and window sizing — layout reads the content
bounds, and growing or shrinking a window works in deltas, so neither knows
the frame's height — `menu.ts`, the tab bar's contents, the pane header.

## Testing

**Unit** (`windowFrame.test.ts`, written first):

- On `win32`, `frameOptions` hides the title bar and sets a fully transparent
  overlay whose glyphs are the look's `cream`, `TAB_BAR_HEIGHT - 2` tall.
- `overlayFor` follows the look: two looks, two glyph colours. It is null on
  `darwin` and `linux`.
- `windowFrame('win32', …)` is its own title bar with a menu button, full
  screen or not, and ends at its buttons only out of full screen; `darwin`
  has no menu button and no buttons at the end; `linux` is as it was.
- The existing macOS tests stand unchanged.

**Static:** `npm run typecheck`, `npm test`.

**macOS unchanged, by eye:** `caffeinate -d npm run capture`, then the PNGs
opened. No ≡, the gear still 12px in, the traffic lights where they were.
The run also exercises the Electron bump.

**Windows, on the owner's machine.** The Release workflow's manual dispatch
is its dry run: all three platforms built, the artifacts on the run, no
release. Its Windows installer replaces an installed 0.9.1 and keeps the
profile; the 0.9.1 release puts it back. The owner checks:

| | |
|---|---|
| Frame | No title bar or menu row; the tab bar meets the top edge |
| Buttons | On the stone, no box; glyphs in the theme's text colour; close hovers red; maximise offers snap layouts; minimise and maximise hover visibly with Windows in light mode and in dark |
| Theme | App theme, server theme and a draft in Settings each move the glyphs; a theme's picture shows behind them |
| Clearance | Setups, Add pane and the gear clear of the buttons, at 100% and 150% scaling |
| Moving | Empty bar drags the window; double-click maximises; top-edge snap; right-click gives the window menu; tabs and buttons still click; the top border still resizes |
| ≡ | Opens File/Edit/View/Window/Help; New Window, Always on Top, Check for Updates and About work |
| Shortcuts | Ctrl+T, W, D, 1–9 and , with the game focused and with a tool pane focused |
| Full screen | Buttons gone, the row's end reaches the edge |
| Settings | Same frame, no ≡, its buttons clear |

If the gear lands under the buttons, the shell is not getting the overlay's
rect, and main would send the inset instead, measured on that machine. If
the bar does not drag, Windows is ignoring the view's drag region, which
needs finding out rather than guessing. Either comes back to the owner
before the course changes.
