# Live themes, pane padding, closing and setups

The owner's design of 2026-09-26, in four parts on one branch:

1. **The theme editor works on the real app.** Edits show on every window as
   they are made, and the preview inside the editor goes.
2. **Every pane is padded the same.**
3. **Closing a pane gives its space back to the screen,** so the game keeps
   its size and nothing has to be rearranged.
4. **Setups.** A set of panes in a shape, opened from the tab bar in one
   click.

The owner asked for the four, answered four questions, and approved the
design as a whole.

## Decisions

These were taken while designing, and override anything below that disagrees.

1. **While the editor is open, every window wears the draft.** That means
   Settings and every game window, whatever theme each would otherwise wear.
   Cancel puts them all back. This replaces Decision 3 of
   `2026-09-25-custom-themes-and-pictures-design.md` ("Windows change on
   Save", with a preview of the editor's own). That preview was a small mock,
   not the app, and it scrolled out of sight below the colours it was
   showing.
2. **Save makes the theme the app theme.** Save also ends the draft. Every
   window has been wearing the theme, and flipping back to something else
   the moment it is kept would read as Save undoing the work. A server with
   its own theme goes back to that one.
3. **Closing Settings with unsaved changes asks.** The question is "Discard
   your changes to <name>?", with Keep Editing and Discard. Quitting the app
   discards without asking, because Settings never holds up a quit.
4. **Export writes the draft.** An unsaved theme can be exported, whether it
   is a new one or has changes. The file is whatever the editor holds.
5. **Closing a pane shrinks the window along both axes.** The window gives
   up a pane beside the game (width) or below it (height). This is the
   mirror of `makeRoom`.
6. **The window gives up the closed pane's own side.** A pane that was left
   of the game moves the window's left edge in, so the game does not move on
   screen.
7. **Setups is a button in the tab bar.** Picking a setup replaces the
   current tab's panes, and sizes the window so the game keeps its pixels.
   Setups take the place of the tab menu's Save Layout and Load Layout.
8. **Three built-in setups:** Game; Game and Chat; Game, Chat and Tools.

## 1. The theme editor

### What the player sees

- **The Appearance section.** Each card's Customise or Edit is a raised
  `.btn` as wide as the card, instead of dim underlined text beneath it.
  Clicking the card itself still makes it the app theme.
- **The editor**, top to bottom:
  - The name field.
  - The contrast warnings, when there are any.
  - Picture.
  - The four colour groups.
- **The preview is gone.**
- **The action bar.** Save (the one gold button), Cancel, Export… and, for a
  theme already saved, Delete sit in a bar pinned to the bottom of the
  window. The bar never scrolls, and says "Unsaved changes" when the draft
  differs from what the editor opened on.
- **The draft survives a section switch.** The draft lives in `Settings.tsx`
  rather than in the editor. Going to Servers and back returns to the editor
  as it was, and every window keeps wearing the draft in the meantime.

### How a draft is worn

- **What Settings sends.** While the editor is open, Settings sends main
  `appearance.editing({ look, name, changed })` on every change, and `null`
  when the editor closes:
  - `look` is the draft's `{ colors, background }`.
  - `name` is only for the close question.
  - `changed` is whether the draft differs from what the editor opened on.
- **Pacing.** One send is in flight at a time, and the latest wins. A colour
  well fires continuously while it is dragged, and each send makes main push
  every window's state. So Settings keeps the newest draft aside and sends
  it once the previous send has been answered, never queueing the ones in
  between.
- **How main reads it.** Main reads the payload through `readEditing` (pure,
  `src/main/appearance.ts`):
  - the colours through `readColors`;
  - the background through `readBackground`, where one that is present but
    unreadable refuses the payload, as it refuses a draft;
  - the name as any string, cut to `THEME_NAME_MAX`, with an empty name
    standing as "this theme";
  - `changed` as a boolean.

  A bad payload is ignored. Main holds what it read in memory, and it is
  never written to `state.json`.
- **Who may send it.** Only Settings (`settings.isSender`), as with every
  appearance handler.
- **Resolution.** `lookFor(appearance, serverId, editing)` (pure,
  `appearance.ts`) is `editing.look` when there is a draft, and otherwise
  `themeFor(appearance, serverId)`'s look.
  - Every game window's `deps.theme` goes through it, and so does
    `AppearanceView.look`, which Settings wears.
  - `appearanceChanged()` runs on every accepted send, so each window
    restyles and repaints its ground.
  - `ServerWindowDeps.theme` becomes `() => ThemeLook`, since nothing in a
    window reads a theme's id or name.
- **What ends a draft:**
  - **Save.** `appearanceSaveCustom` stores the theme, makes it the app theme
    (`appState.setTheme`), then clears the draft.
  - **Cancel and Delete.** The editor closes and sends `null`.
  - **Settings closing.** The window's `closed` clears it.
  - **Settings' page loading again.** `did-finish-load` clears it. A reload
    (Vite's, or a crashed page's) starts the page with no editor open, and a
    draft left behind would be worn by every window with nothing on screen to
    end it.
- **The close question.** Settings' `close` event asks when `closeQuestion`
  (pure, `appearance.ts`) answers one. It answers when there is a draft
  that has `changed` and the app is not quitting:
  - The message is "Discard your changes to <name>?".
  - The detail is "Every window goes back to the theme it wore before."
  - The buttons are Keep Editing (the default and the cancel) and Discard.

  Discard clears the draft, restyles, and closes the window. The quit path
  is `index.ts`'s existing `quitting` flag.

### Export

`appearanceExportTheme` takes the draft instead of an id:

- It reads the draft through `readThemeDraft` as strictly as Save does, and
  refuses with a sentence when that fails, for example when the name is
  empty.
- It writes `writeThemeFile(draft, picture)`, with the picture's bytes from
  the store.
- It is enabled whenever nothing is busy. The note "Save to export these
  changes" goes.

### Pictures and pruning

A picture chosen in the editor is stored as before, and every window now
shows it while the draft is worn. Pruning is unchanged: at launch, and after
a save or a delete.

- **A draft can't lose its picture to a prune.** A save or delete ends the
  draft first, and nothing else in Settings prunes while the editor is open.
  Servers prunes nothing, and Import is on the cards, which the editor
  replaces.
- **An abandoned picture goes at the next prune.** When the editor closes
  without saving, its picture belongs to no theme and goes at the next prune,
  as it did before.

## 2. Pane padding

- **One wrapper does it.** The shell wraps every pane body it draws itself
  (every tool, and the empty pane's launcher) in one box, padded 10px on all
  four sides (`p-2.5`, the inset most tools already used on some of their
  rows).
- **Tools drop their own inset.** Each tool drops its own outer inset: the
  `px-2.5`/`mx-2.5` on its top-level rows, and the `pt`/`pb` at its first and
  last. It spaces its top-level blocks with one gap of 8px (`gap-2`).
- **What it fixes:**
  - content sitting flush under the header;
  - Worlds' latencies running into the pane's right border;
  - insets that differed from tool to tool.
- **What it leaves alone.** Rows inside a well keep their own padding, since
  that is the well's, not the pane's.
- **Chat's width.** Chat is handed `pane.rect.width` for its narrow-pane
  rules. Those rules are re-read against the padded width.

The renderer has no tests. This is checked by capture, with the tool shots
opened.

## 3. Closing a pane gives its space back

### The rule

`closeGivingBack(node, paneId, size, room)` in `paneTree.ts` (pure) returns
`{ tree, shrunk, edge }`.

- **When it shrinks.** Only when the close would grow the game. That happens
  when the game lies inside the closed pane's parent split, in another child,
  so `closePane` would hand it part of the closed pane's share along that
  split's axis. It is judged by laying out `node` and `closePane(node)` at
  `size` and comparing the game's rect.
- **By how much.** Along that axis the window shrinks by the closed pane's
  extent plus its seam. That is capped by:
  - `room` along the axis, which is how far the window may shrink;
  - `size` less `minimumOf(tree, axis)`.
- **The tree.** It is `closePane`'s tree, arranged at the smaller size so
  that every remaining pane keeps the pixels it had along the axis. Only
  panes that span the axis (chat under a row, say) change, because they
  follow the window.
  - When the cap leaves some of the closed pane's space unpaid, that
    remainder is shared by the closed pane's siblings in proportion, as
    `closePane` shares it today.
  - With no room at all, the tree is exactly `closePane(node, paneId)`.
- **The edge.** It is the side of the window that moves in: `left` or `top`
  when the closed pane lay before the game along the axis, otherwise `right`
  or `bottom`. It is null when nothing shrank.
- **When it does nothing.** No game in the tab, the game itself being
  closed, or a close that leaves the game's size alone (a pane in a column
  beside the game, say) all return `closePane`'s tree and nothing shrunk.

`shrunkFrame(frame, by, edge)` in `windowRoom.ts` (pure) takes `by` off the
frame's width or height, and moves `x` or `y` in by the same amount when the
edge is `left` or `top`.

### Who uses it

- **Only the explicit close.** That means `serverWindow.closePane`, reached
  from the pane menus, the header's close and the keyboard. Every edge drop
  also goes through `paneTree.closePane`, and a drop must not resize the
  window, so `closePane` itself is unchanged.
- **The host's close.** `PaneHost.close(paneId, room)` adopts
  `closeGivingBack`'s tree. When something shrank, it records the tree as
  arranged at the smaller size (`arrangedAt`), as `adoptAdded` does for
  growth. It returns the shrink and the edge for the window to act on.
- **The window's room.** `roomToShrink()` is the window's content size less
  its own floors, and nothing while it is maximised or full screen.
  `shrinkWindow(by, edge)` sets the frame from `shrunkFrame`.
- **Closing the game's own pane** destroys the view first, as before, so the
  tree it closes holds no game and nothing shrinks.

### What changes in `CLAUDE.md`

The layout invariant's last bullet ends "The window grows itself for nothing
else — not Reset Game Size, not a drop — and never shrinks itself back". It
becomes:

> The window is resized for three things: a pane added (it grows,
> `makeRoom`), a pane closed beside the game (it shrinks,
> `closeGivingBack`), and a setup opened (it is sized to hold the game at
> its pixels, `arrangeForGame`). Nothing else resizes it — not Reset Game
> Size, not a drop.

## 4. Setups

### What the player sees

A **Setups ▾** button sits in the tab bar, between the gear and Add pane. It
is drawn as Add pane is, a raised `.btn` with a caret, and it pops a native
menu of main's under itself:

```
Game
Game and Chat
Game, Chat and Tools
─────────────
<each saved setup, by file name>      (or "No Saved Setups", greyed)
─────────────
Save This Tab as a Setup…
Open Setup File…
Open Setups Folder
```

- **Choosing a setup** replaces the active tab's panes. The tab's
  right-click menu keeps only Close Tab.
- **Game, Chat and Tools** is left off the menu in a window that offers no
  tool other than chat.

### Built-in setups

`src/main/setups.ts` (pure). `builtInSetups(opts: { tools, gameHeight })`
answers `{ id, name, tree: StoredNode, size: Size }[]`:

- **Game.** The game alone. Size: `GAME_PREFERRED_WIDTH` × `gameHeight`.
- **Game and Chat.** Game over chat, as a new window opens: game at
  `gameHeight`, a seam, chat at `CHAT_PREFERRED_HEIGHT`. Width
  `GAME_PREFERRED_WIDTH`.
- **Game, Chat and Tools.** Game and Chat, with a column to its right
  `COLUMN_PREFERRED_WIDTH` wide. The column stacks every tool the window
  offers other than chat, in the window's own order: Worlds, Hiscores,
  Timers, then Your world in its own window. The tools share the column's
  height evenly.
  - It is not offered when there is no such tool.
  - When chat is not offered, chat is left out, and the game spans the
    height.

A built-in leaves out what the window does not offer, rather than showing an
empty pane. A built-in is the kit's promise of a shape, and an empty pane in
it would look broken. A saved setup keeps `instantiateLayout`'s empty-pane
fallback.

### Sizing

`arrangeForGame(tree, saved, want)` in `paneTree.ts` (pure) returns
`{ tree, size }`:

- `saved` is the size the setup was made at.
- `want` is the game's current pixels, or null when no game is running.
- **With a game and a saved size:**
  - `delta` is `want` (or the saved game's own size when `want` is null)
    less the game's size in `tree` at `saved`.
  - The tree is held so that the game's side of each split gets `delta`, and
    every other pane keeps its saved pixels. This is the same walk
    `keepGame` makes, `holdGame`.
  - `size` is `saved + delta`, raised to the tree's own minimum.
- **With no game, or no saved size:** `{ tree, size: null }`, and the tree
  is fitted to the window as it is.

The window then:

1. Asks as Load Layout does. When the tab being replaced holds the game and
   the setup has none, that closes the game, and the window confirms and
   destroys the view (`tabs.loadingLayout`).
2. Replaces the tab (`PaneHost.replaceTab(tabId, tree, size)`), recording
   the tree as arranged at `size` when there is one.
3. Resizes itself toward `size` plus the tab bar:
   - It grows up to its display (`roomFor`), and moves back on screen
     (`grownFrame`, which also takes a negative `by`).
   - It shrinks only down to what the tree needs.
   - It does not resize at all while maximised or full screen. The tree is
     then fitted from `size` to the window by the usual resize fit, which
     holds the game.

**The game's current pixels** are its rect in whichever tab holds it, laid
out at the window's current tree size (`gameSizeIn`). A game in a background
tab has not been fitted since, and is near enough.

### Files

- **The folder.** Saved setups are the layout files, in
  `<userData>/setups/<server>/` rather than `layouts/<server>/`. That rename
  is under the no-migrations licence.
- **The file** keeps `kind: "zanaris-kit-layout"`, version 1, and gains
  `size: { width, height }`: the active tab's tree size when it was saved.
- **Reading it.** `readSetup` answers `{ tree, size }`, where `size` is
  null when the file has none.
  - Integers from 1 to 16384 are accepted.
  - Anything else in `size` refuses the whole file, as every other bad field
    does.
- **The rest is as it was.** Save writes it through the save dialog, Open
  Setup File… is the open dialog, and the folder item opens the folder.
- **`TOOL_IDS`** stays append-only for the reason `CLAUDE.md` gives.

### Main

- **IPC.** `IPC.tabSetupsMenu` (`zanaris:tab-setups-menu`), with the shell
  calling `panes.setupsMenu(x, y)`, in the shape of `tabAddPaneMenu`.
- **`serverWindow`:**
  - `showSetupsMenu(x, y)` builds the menu above.
  - `applySetup(stored, saved)` replaces `loadLayoutFrom`'s tail, and both
    the built-ins and the files go through it.
  - `saveSetupAs()` writes the active tab.
  - `showTabMenu` keeps Close Tab.

## Docs

- **`CLAUDE.md`:**
  - the layout invariant's resize sentence (above);
  - "saved layout" becomes "saved setup" where it names the feature;
  - Settings' close question;
  - a draft theme worn app-wide, held in memory only, and what ends it.
- **The custom-themes spec.** A note at Decision 3 that this spec replaced
  it.
- **`README.md`.** The editor, the setups, the close, and the layout
  section's resize rules.

## Verification

`node --test`, for everything pure:

- `readEditing`: a good payload; bad colours or background; a long name cut,
  an empty one named.
- `lookFor`: draft over app, draft over a server's own, no draft.
- `closeQuestion`: changed, unchanged, quitting, no draft.
- `closeGivingBack`:
  - a column right of the game, and left (the edge);
  - three columns, where the game and the middle keep their pixels;
  - chat under a row, where the height shrinks;
  - a pane in a column beside the game, where nothing shrinks;
  - no room, which equals `closePane`;
  - partial room;
  - no game;
  - the tree's floor.
- `shrunkFrame`: each edge.
- `builtInSetups`: shapes and sizes per tool set; the tools setup is absent
  with only chat; Lost City's game height.
- `arrangeForGame`:
  - the game held at `want` while the others keep their saved pixels;
  - a null `want`;
  - no game;
  - no size;
  - the minimum.
- `readSetup` and `writeLayout`: size round trip, missing, and each bad
  size.
- `grownFrame` with a negative `by`.

`caffeinate -d npm run capture`, with the PNGs opened. It must show:

- every tool pane at the new padding;
- Settings' Appearance with its buttons;
- the editor with its bar.

The editor shot shows the bar pinned with the colours scrolled.

By hand in `npm run dev`, since capture cannot see the following:

- Editing a colour restyles a game window live.
- Cancel restores it.
- Closing Settings mid-edit asks.
- Closing a column beside the game shrinks the window and leaves the game
  where it was.
- Each built-in setup opens at the game's size.

## Out of scope

- Setups that span several tabs, or carry a theme.
- A setup's own keyboard shortcut.
- Previewing a theme on only some windows.
- Shrinking the window for a tab close.
