# New windows: the setup they open with, and where they open

**Date:** 2026-10-07
**Status:** approved in chat, building on `claude/panes-windows-management-4c823a`

## Why

A general pass on panes and windows before 1.0 found two things every player
pays for on every launch.

- **A new window always opens as game over chat.** A player who plays in
  Game, Chat and Tools, or in a setup of their own, picks it from Setups in
  every window they open, every time.
- **A window does not remember where it was.** `state.json` holds no frame.
  The first window opens where Electron puts it, the rest cascade 32px from
  the focused one, so a player on two displays drags every window back where
  it lives on every launch.

## The owner's calls

1. **Chosen from the Setups menu**, not from Settings: an Open New Windows
   With submenu at its foot. That is where setups are made and opened.
2. **A window remembers its place, not its size.** The size is the setup's,
   built around the game. A size worth keeping is a saved setup, which
   already records it; a window dragged larger by accident does not come
   back larger.
3. **Maximised and full screen are restored too.** A window closed full
   screen opens full screen, which on macOS is a Space of its own at launch.

## What stays true

- **Nothing about the arrangement is saved on its own.** A new window opens
  with a setup the player chose on purpose, and never with the last accident.
  The only thing recorded without being asked for is where the window was.
- **A game window opens onto its game.** A setup with no game in it cannot
  be what new windows open with.
- **Opening a window resizes nothing after it opens.** It is created at its
  setup's size and place, and the three things `CLAUDE.md` lists remain the
  only things that resize a window.

## 1. Open New Windows With

### What the player sees

The Setups menu gains a last group:

```
Setups ▾
  Game
  Game and Chat
  Game, Chat and Tools
  ─────────────
  my-pking
  skilling
  ─────────────
  Save This Tab as a Setup…
  Open Setups Folder
  ─────────────
  Open New Windows With ▸
      Game
    ✓ Game and Chat
      Game, Chat and Tools
      ─────────────
      my-pking
      skilling
```

- The submenu lists the built-ins this window offers, then the saved setups
  in the folder, in the order the menu above lists them.
- **The tick is what the next window of this server will open with**: the
  same answer a window opening now would act on, not the stored choice read
  back. So a choice whose file has gone, or no longer holds a game, ticks
  Game and Chat, because that is what a window would open as.
- **A saved setup that cannot open a window is greyed**: one with no game in
  it, one that is not a setup, or one too large to be one. Each is read when
  the menu opens, sized before it is read as the menu's own open already is.
- Choosing one stores it for this server and changes nothing on screen. Every
  window of that server already open is left as it is.

### Which windows it covers

Every new window of that server: a launch's, File > New Window and New Window
For, Settings' Open button, the dock menu, a second launch with no window
left. Not New Tab, which still opens one empty pane.

### What is stored

`state.json` gains `newWindows`, per server id:

```json
"newWindows": {
  "lostcity": { "builtIn": "game-chat-tools" },
  "zanaris": { "file": "skilling.json" }
}
```

A server with no entry opens with Game and Chat, which is what every window
opens with today, so nobody who never picks one sees anything change. The
player's pick is stored as picked, Game and Chat included.

A file is stored by its name in the folder, never as a path, and is never
joined into one: the window looks the stored name up in the folder's own
listing (`layoutFile.layoutEntries`) and opens only an entry that listing
returned. A stored name with a separator in it, a hidden one, one not ending
in `.json`, or one longer than a file name can be is dropped when
`state.json` is read, as any bad field there is.

### Opening a window with it

The file is read when each window opens, not when it is chosen, so editing or
replacing the file changes what the next window opens with, as it changes
what the menu above opens.

A built-in opens with the game at its preferred size, as the menu's built-ins
do. A saved setup opens with every pane at the pixels it was saved with, the
game included (`paneTree.arrangeForGame` with no running game to hold). A
saved setup with no size, from before setups carried one, opens at the size
a window opens Game and Chat at, laid out by its fractions.

A stored choice that cannot be used — a built-in this window does not offer,
a file gone from the folder, one that is not a setup or holds no game — opens
the window as Game and Chat, and the log says which and why. No sheet: a
launch is never interrupted, and the Setups menu's tick already shows what
new windows open with.

Reset Game Size still goes back to the game's preferred size, not to the size
a saved setup opened it at. The README sentence that calls that size "what
the window opens at" is corrected to say so.

## 2. Where a window opens

### What is remembered

Per server and per window number (slot), so Lost City and Lost City (2) each
come back to their own place:

```json
"places": {
  "lostcity": { "1": { "x": 2240, "y": 120, "maximized": false, "fullScreen": false } }
}
```

- `x` and `y` are the top-left of the window's **normal** frame
  (`BrowserWindow.getNormalBounds`), so a window closed maximised, full
  screen or minimised still knows where it goes when it is none of those.
- `maximized` and `fullScreen` are whether it was. Minimised is not kept: a
  window comes back shown.
- No size. The size is the setup's.

Slots run from 1 to 16; a window numbered past that opens where it would
have anyway and is not recorded. Numbers that are not integers in reach of
any display, and anything else malformed, are dropped when `state.json` is
read, one entry at a time.

### When it is written

As the window closes, once its close has been confirmed: the 'close' event,
after `confirmClose` has said yes and while the window can still be asked
where it is. Quitting closes every window through that event, so a quit
records every open window. A window closed and reopened in the same session
comes back where it was closed. A crash, or `kill -9`, records nothing: the
next launch opens where the session before it left the windows.

### Where it opens

The frame is worked out before the window exists, by a pure function in
`src/main/windowPlace.ts`, from the size its setup wants, the remembered
place for its slot, the cascade point, and every display's work area.

1. **The remembered place, if its tab bar can be reached.** The tab bar is
   what a window is dragged by (on Linux, the system's caption above it), so
   the place is kept when the strip along the window's top, `TAB_BAR_HEIGHT`
   tall, lies inside one display's work area from top to bottom and across at
   least `PANE_MIN_WIDTH` of its width. That display is the one it opens on.
2. **Otherwise the cascade, as now:** 32px right and down from the focused
   game window, or the last one opened, on that window's display.
3. **Otherwise centred** on the display under the cursor. Today a first
   window is centred wherever Electron puts it while its height is held to
   the cursor's display; centring it on the display its height was measured
   against makes the two agree.

The window's size is then held to that display's work area: no wider than
it, and no taller than it less `FRAME_ALLOWANCE`, as the height already is.
Then the window is moved back onto the work area only as far as it runs off
its right or bottom edge, the rule `windowRoom.grownFrame` already keeps for
a window growing: a window the player left hanging off the left or top stays
there. When the setup's size had to be held, the tree is fitted to the size
the window got the way a resize fits it, the game keeping its pixels while
the other panes give way to their floors (`paneTree.refit` from the setup's
own size), which is what `openWindowTabs` did for game over chat on a short
display, now for every setup.

**Maximised or full screen.** The window is created at its normal place and
setup size, then maximised or made full screen as it is shown, so
unmaximising it later puts it at the remembered place. The tree is fitted to
the bigger size as any maximise fits it. A window that is not shown — a
capture's — is never maximised or made full screen this way.

### What does not change

- **Settings** opens where it does now, anchored to the window that asked.
- **A capture neither reads nor writes places.** Its windows open as a
  window with nothing remembered does, so no run depends on where the last
  one left its windows, and it never needs to show a window to restore one.
  It still uses `newWindows`, which it sets for itself (Verification).

## How it is built

### `windowPlace.ts`, new and pure

- `Place`: `{ x, y, maximized, fullScreen }`.
- `openingFrame(...)`: the frame and the two flags a window opens with,
  from the content size its setup wants, the remembered place or null, the
  cascade point or null, every display's work area, and the cursor's display.
  Rules as above. `FRAME_ALLOWANCE` moves here from `serverWindow.ts`.
- `readPlaces` / the validation `appState` uses for each entry.

### `setups.ts`

- `NewWindowSetup`: `{ builtIn: BuiltInSetupId } | { file: string }`.
- `openingSetup(choice, builtIns, saved, read)`: the stored tree, the size it
  opens at, its name, the choice it actually used (what the menu ticks), and
  the reason it fell back, if it did. `read` is injected, so the folder is
  never touched in a test.
- `opensWindow(text)`: whether a saved setup's text can be a new window's
  setup, for the menu's greying.

### `tabs.ts`

`openWindowTabs` takes the window's first tree, already instantiated, and
returns one tab holding it, focused on its game. The numbers it worked out
for game over chat go: they are Game and Chat's built-in now, and the
short-display rule is `refit`'s. Its tests move across with their numbers
unchanged and are run against the new path: game over chat at its own size,
Lost City's taller game, chat giving way to its floor first, the game giving
way after, and nothing negative below two floors.

### `paneHost.ts`

`PaneHostDeps` gains the size the first tab was arranged at. The host starts
that tab's fit as `arrangedAt(tree, size)`, so the first layout is a refit
from the setup's size to the window's, not a layout by fractions.

### `appState.ts`

Two new blocks, `newWindows` and `places`, read entry by entry the way
`startup` and `hiscores` are, so one bad entry costs only itself. Getters and
setters per server. No migration: the licence in `CLAUDE.md` still holds,
and a file without the blocks reads as no choices and no places.

### `serverWindow.ts`

Before the window is built: the tools are known, so the window asks
`openingSetup` for its first tab, reading its setups folder through the same
sized read the menu uses, then `openingFrame` for its frame, and builds the
window at it. The 'close' handler records the place once the close is
confirmed. The Setups menu gains the submenu. The deps lose `position` and
gain the remembered place and cascade point, the new-window choice for this
server, a setter for it, and a callback to record the place.

### `index.ts`

`nextPosition` becomes the cascade point it hands over. It binds each
window's deps to its server and slot, and in a capture passes no place and
records none.

## Docs

- **README, Layout:** "Nothing about the arrangement is saved on its own"
  gains what new windows open with and where; the paragraph on what a new
  window opens with says a setup can be chosen; Setups gains Open New
  Windows With; Reset Game Size's sentence is corrected. The catalog
  section's note that `state.json` "does not remember how the panes were
  arranged" stays true and gains what it does remember.
- **README, Next:** the stale "Reopening what was open at quit landed with
  the pane tree" goes. It never did, and the README's own Layout section says
  so.
- **CLAUDE.md, the layout invariant:** opening a window is not a resize, and
  the list of three things that resize a window stays three. One sentence
  says a new window is built at its setup's size and place.

## Verification

`npm test` and `npm run typecheck` cover the pure modules. The wiring in
`serverWindow.ts` and `index.ts` cannot fail in CI, so `npm run capture`
exercises it, and the PNGs are opened rather than the log trusted:

- **A new window with a built-in.** Capture sets Lost City's choice to Game,
  Chat and Tools, opens a window, logs its panes and its content size, and
  shoots it. Then sets it back.
- **A new window with a saved setup.** It writes a setup file into the
  capture profile's folder for that server, chooses it, opens a window,
  shoots it, and removes the file and the choice.
- **A choice that falls back.** A stored file name with no file behind it:
  the window opens as Game and Chat and the log says why.
- **A place.** A window opened with a place handed to it, through the same
  deps a remembered one comes by, lands there; one whose place is on no
  display falls back to the cascade. Logged from `getBounds`.

Maximised and full-screen restore show a window, which a capture must not, so
they are checked by hand in a development run: maximise a window, quit, open
again; the same full screen; the same with a window on a second display, then
with that display unplugged.

## Out of scope

The rest of the pass, each its own design if it comes: moving any pane to
another tab, reordering tabs and cycling them by keyboard, focusing panes by
keyboard, zooming a pane, reopening a closed pane or tab, and tearing a pane
off into its own window.
