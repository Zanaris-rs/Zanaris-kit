# Zanaris Kit: split panes and workspace tabs

**Status:** proposed, 2026-09-12. Replaces the fixed column layout described in
`2026-09-05-server-windows-design.md` and the bottom dock of
`2026-09-07-chat-dock-design.md`. Both of those specs describe geometry this
one deletes; their reasoning about *what* the tools are and *why* chat is wide
and short still stands.

## Goal

A window behaves like an iTerm window. Any pane can be split left/right or
up/down, every seam between panes drags on both axes, any pane can be closed,
and a window holds several tabs — each tab a whole configurable workspace with
its own tree of panes, rather than a page in a strip.

The motivating observation is that the current window offers exactly one
arrangement. There is one game, one 320px panel on the right, one reference
pane beside the game, and one dock along the bottom, and the only thing the
user can change is how wide two of them are. Every question the layout engine
answers — which column gives way first, how much the dock may keep, whether
the window widens or the game gives — is a question that only exists because
the arrangement is fixed and the pieces have to fight over it.

## Decisions taken

Six gates were settled before this was written, and nearly everything below
follows from them:

| Question | Answer |
|---|---|
| Is the game view resized by a split? | Yes. It is a pane like any other. |
| What may live in a pane? | Everything: game, guide page, and every rail tool. The 320px panel and the bottom dock stop existing. |
| What owns the server binding? | The window, as today. Tabs are arrangements of one server's things. |
| One level of tabs or two? | One. A pane holds exactly one thing; today's per-pane tab strip goes. |
| What is in a freshly split pane? | Nothing — it shows a launcher and the user picks. |
| Closing the game pane? | Destroys the view, behind a confirm. A hidden-but-alive game is a character dying to events nobody can see. |

### The invariant that goes

> Opening chrome must never resize the game view. Reloading or rescaling that
> view costs the player their login.

The first sentence is deleted along with the chrome that motivated it: nothing
opens *beside* the game any more, splits divide space that is already
allocated, and the user asked for a game that resizes with everything else.

The second sentence was **never true of resizing**, and its comment at
`main/layout.ts:22` is a defect by the standard `CLAUDE.md` sets for comments.
`applyLayout` calls `gameView.setBounds(...)` and nothing else; a `setBounds`
does not reload a `WebContentsView`. What costs the login is `loadURL` — a
world switch, a detail switch, a cheats restart — and each of those already
warns. The real cost of a small game pane is that the canvas **clips**, because
the served page rescales only for someone who picked Auto Sizing, which is the
behaviour the README already documents for the `push` path.

### The invariant that replaces it

**A game that is running is either visible or obviously suspended, never
silently hidden by a gesture that reads as final.** Closing the game pane
destroys the view and says so first. Switching tabs hides it and keeps it
running — which is exactly what already happens when the window goes behind
another application, and `backgroundThrottling: false` exists to support.

## What this deletes

Roughly 1,600 lines, against perhaps 250 of new solver:

| File | Lines | Fate |
|---|---|---|
| `main/layout.ts` | 307 | `fitAxis`, `computeLayout`, `splitWindow`, `sideWidth`, `paneWidth`, `preservedWidth/Height`, `dockOnFloor` all go. What survives is small enough to live in `paneTree.ts`. |
| `main/layout.test.ts` | 521 | Goes with it; replaced by `paneTree.test.ts`. |
| `main/chatDock.ts` | 149 | Goes. Chat has no home to be placed in when every pane is a home. |
| `main/chatDock.test.ts` | 362 | Goes. |
| `main/pagePane.ts` | 174 | Goes. A pane holds one page; there is no tab list to reduce over. |
| `main/pagePane.test.ts` | 162 | Goes. |

`shared/layout.ts` loses `PANEL_WIDTH`, `PANEL_WIDTH_MIN`, `MIN_CONTENT_WIDTH`,
`MIN_CONTENT_HEIGHT`, `MIN_WINDOW_CONTENT_WIDTH`, `MIN_WINDOW_CONTENT_HEIGHT`,
`DOCK_HEIGHT_DEFAULT`, `DOCK_HEIGHT_MIN`, `PAGE_WIDTH_DEFAULT`,
`PAGE_WIDTH_MIN` and `LayoutMode`.

`ShellState` loses `panelOpen`, `panelAvailable`, `mode`, `dockOpen`,
`dockHeight` and `pages`. The `mode: { x, y }` pair and both push notes in the
UI go with them: there is no widen/shift/push ladder left to report, because
the window never grows itself to accommodate anything.

`IPC` loses `shellTogglePanel`, `pagesActivate`, `pagesClose`,
`pagesSetCollapsed`, `pagesSetWidth`, `chatSetHome` and `chatSetDockHeight`.

## Model

All of it pure, in a new `src/main/paneTree.ts`, reached by `node --test`
without Electron — the same rule `CLAUDE.md` sets for everything decidable.

```ts
export type PaneContent =
    | { kind: 'empty' }                    // shows the launcher
    | { kind: 'game' }                     // at most one per window
    | { kind: 'page'; bookmark: string }   // one of this server's links
    | { kind: 'tool'; tool: ToolId };      // worlds | hiscores | chat | singleplayer

export type PaneNode =
    | { kind: 'leaf'; paneId: string; content: PaneContent }
    | { kind: 'split'; splitId: string; axis: 'x' | 'y'; children: PaneNode[]; fractions: number[] };

export interface Tab {
    id: string;
    tree: PaneNode;
    focusedPaneId: string;
}
```

`fractions` sums to 1 and is the same length as `children`. An `'x'` split
divides its rect left-to-right; a `'y'` split divides it top-to-bottom.

### `guides` stops being a tool

With an empty pane showing a launcher, and that launcher listing this server's
links alongside the four remaining tools, the Guides panel has no separate job
left. `TOOL_IDS` becomes `['worlds', 'hiscores', 'chat', 'singleplayer']`. The
catalog's `links` are unchanged — they are what the launcher lists.

### Splits are n-ary, and a split halves the pane you split

Splitting a leaf whose parent already runs on the requested axis inserts a
sibling *next to it* rather than nesting a new split node. The new pane takes
half of the split pane's own share:

```
fractions[i] → fractions[i] / 2, and a sibling of fractions[i] / 2 after it
```

Only a split across the grain of its parent creates a new `split` node.

This is worth being exact about, because an earlier draft of this design
claimed n-ary splits exist so that repeated splits give evenly-sized panes.
They do not, in iTerm or in tmux or here: repeated splitting halves each time,
giving 1/2, 1/4, 1/8, 1/8. The actual reasons to keep the tree flat are that a
seam drag then moves exactly the two panes either side of it rather than
reproportioning a whole subtree, and that the tree stays shallow enough to read
in a debugger. An **Even out** command in the View menu resets one split's
fractions to equal shares, which is the thing the even-sizing argument was
really reaching for.

### Closing collapses

Closing a leaf removes it and renormalises its parent's remaining fractions
proportionally. A split left holding one child is **replaced by that child**,
so the tree never accumulates single-child splits — without this, close-then-
split stops behaving like split on a fresh pane and the seams drift.

Closing the last pane in a tab does **not** close the tab: it leaves one empty
pane showing the launcher. Closing a tab is its own gesture. This is
deliberate — with the game as an ordinary pane, a close that cascades pane →
tab → window would turn one keystroke into a disconnect.

## Geometry

### Constants

`shared/layout.ts`, after the deletions above:

```ts
export const TAB_BAR_HEIGHT = 36;   // was STRIP_HEIGHT, same pixels, new job
export const RAIL_WIDTH = 48;       // unchanged
export const SEAM = 4;              // was PAGE_SEAM, same 4px
export const PANE_MIN_WIDTH = 120;
export const PANE_MIN_HEIGHT = 80;
export const PAGE_TOOLBAR_HEIGHT = 32;      // unchanged, now per page leaf
export const GAME_PREFERRED_WIDTH = 765;    // was MIN_CONTENT_WIDTH
export const GAME_PREFERRED_HEIGHT = 535;   // 503 canvas + PAGE_CONTROLS_HEIGHT
```

`SEAM` stays at 4, and it is worth recording that it was questioned and kept.
A seam is the only pointer target there is: both sides of it are native
`WebContentsView`s stacked above everything the shell draws, so a grip cannot
have a hit area wider than its visual — the neighbouring view would eat the
pointer. Widening it was rejected because 4px is what the one existing seam has
always been and it drags fine; a window full of 6px gutters also costs real
pixels on every split, and the `Grip` keyboard path is the accessible answer
for anyone the 4px target does not serve.

`GAME_PREFERRED_*` is demoted from a floor the layout protected to a size the
game leaf *asks for* when first placed, and the size a double-click on a seam
snaps it back to. Nothing enforces it any more.

### The solver

```ts
export function layoutTree(node: PaneNode, rect: Rect): {
    panes: Map<string, Rect>;
    seams: Seam[];   // { axis, rect, splitId, index } — index is the seam's left/upper neighbour
}
```

One recursive function. For a leaf, the rect is the pane's. For a split of `n`
children:

1. `gross = rect.size - SEAM * (n - 1)` on the split's axis.
2. If `gross < sum(minimums)`, every child gets its minimum scaled by
   `gross / sum(minimums)`: everything clips proportionally. This is reachable
   only at the window's own floor, and clipping everything a little is better
   than clipping one pane to nothing.
3. Otherwise assign `fractions[i] * gross`, pin any child that lands under its
   minimum, and redistribute the deficit among the unpinned by their
   renormalised fractions. Repeat until stable — at most `n` passes.
4. Round with largest-remainder, so the children sum to `gross` **exactly**.

Step 4 preserves the property the current `splitWindow` is careful about: the
regions always tile their container exactly, and none can come out negative.
It is the one place where a plain `Math.round` per child would leave a
one-pixel seam of window showing through at some sizes and not others.

A leaf's minimum is `PANE_MIN_WIDTH × PANE_MIN_HEIGHT`. A split's, along its
axis, is the sum of its children's **plus `SEAM * (n - 1)`** — the seams are
part of what the container has to hold, and a minimum that omits them lets a
deep tree report a floor it cannot actually be drawn at. Across its axis it is
the largest of its children's.

### Where the tree sits

```
window content rect
├── tab bar        full width, TAB_BAR_HEIGHT, at the top
├── rail           RAIL_WIDTH, full remaining height, on the right
└── tree rect      everything else — the active tab's tree
```

The rail stays. It is window chrome rather than a pane, and it is how a tool
gets into a pane when every pane is already full: clicking a tool puts it in
the focused pane, or — when the focused pane is the game — splits the game and
puts it in the new half. The launcher inside an empty pane is the same list in
a different dress.

The window's minimum content size becomes `RAIL_WIDTH + PANE_MIN_WIDTH` by
`TAB_BAR_HEIGHT + PANE_MIN_HEIGHT`. It is a constant, replacing the
`syncMinimumSize` / `dockOnFloor` machinery, which existed only to stop a drag
crushing a dock the layout was also protecting.

### Native views and shell regions

Unchanged in shape from today, which is why this is a better data structure
rather than a different architecture. Main's output per layout is a
`Map<paneId, Rect>` and a seam list. Of the four content kinds:

- `game` and `page` are `WebContentsView`s that **main** positions.
- `tool` and `empty` are regions the **shell** paints, exactly as it paints the
  panel today. `renderer/tools/*.tsx` carry over almost unchanged: each takes a
  rect from the tree instead of a fixed 320px column.

A `page` leaf carries its own `PAGE_TOOLBAR_HEIGHT` toolbar — back, forward,
reload, title — inside its own rect, out of the pane's height rather than the
window's. Same rule as today, applied per pane instead of once.

## The game pane

One `WebContentsView`, created with the window, because the server binding is
the window's and there is exactly one game.

- **Placing it** — the game may be in at most one leaf of one tab. Moving it
  means closing it and opening it elsewhere, which is a reload; the launcher's
  Game entry is disabled in every tab while a live game pane exists, and says
  why.
- **Closing it** destroys the view, behind the dialog `confirmSwitch`
  (`main/index.ts:434`) already puts in front of a world switch: a sheet on the
  window rather than an app-modal box, so other windows keep running, with a
  don't-ask-again that is honoured whichever button was pressed and reversible
  from View > Warn Before Switching Worlds. `SwitchIntent`
  (`main/worlds/warning.ts`) gains a third variant beside `world` and `detail`,
  and `switchWarning` gains its sentence — the text stays in the pure module
  that is already tested for exactly these strings.
- **Hiding it** — by a tab switch — keeps it running with `setVisible(false)`,
  the mechanism `syncPageBounds` already uses. The tab holding the game carries
  a dot in the tab bar so it is always findable.

  > Built on 2026-09-24 as the game's minimap flag, and only while the tab is
  > in the background, because by then a gold dot meant the focused pane. The
  > same mark covers a live link to Your world. See `tabs.marksOfTab`.
- **Reopening it** from the launcher is a `loadURL` of the remembered world at
  the remembered detail, which is an ordinary fresh login.

## Focus

Main holds `focusedPaneId` per tab. Splits, closes, launcher clicks and rail
clicks all act on it.

Two sources, because there are two kinds of pane:

- Shell-painted panes (`tool`, `empty`) report a click over IPC.
- Native panes (`game`, `page`) are reported by `webContents.on('focus')` on
  their own view.

The focused pane draws a 1px lit border in the shell. A native view cannot be
outlined from inside itself, so that border is painted on the shell *around*
the view's rect — which means there has to be shell showing there. Two things
give it somewhere to land, and neither is a per-leaf reservation the solver
would have to know about: between panes there is the seam, and at the
container's edge the **tree rect is inset by 1px** from the content area.
`layoutTree` is handed the inset rect and is otherwise unaware of any of this.

## Drag

`renderer/grip.tsx` is reused per seam, essentially unchanged. It already
takes an axis, already inverts both the same way, already learns the true
ceiling from main's clamp rather than guessing, and already survives an echo
landing mid-drag. What changes is that there are now many of them and each is
identified by its seam id.

Dragging seam `i` of a split adjusts `fractions[i]` and `fractions[i+1]` only,
leaving every other child where it is. Main clamps against the minimums and
replies with the fractions it actually applied, which is the contract `Grip`
is already written against.

Double-clicking a seam snaps the two panes either side of it to equal shares —
or, when one of them is the game, to `GAME_PREFERRED_*` if there is room.

## Tabs

Milestone 2. A window holds `tabs: Tab[]` and `activeTabId`.

The tab bar replaces today's strip in the same 36px. The game read-out —
"Lost City · W5 · low · 294 ms" — keeps its place at the **left of the bar**,
before the tabs, because it is window-level information: the window is bound to
one server and has one game, so it does not belong to any single tab.

A tab switch sets `setVisible(false)` on every native view outside the
incoming tab and gives bounds only to the views about to show, generalising
the optimisation already in `syncPageBounds` — a hidden Chromium view still
does the work of a resize, and that cost should not be paid per tab per frame
during a drag.

New tabs open with a single empty pane. Tabs can be closed, and closing the
last tab closes the window. Tabs reorder by drag.

## IPC

Added to `shared/ipc.ts`, following the existing `zanaris:<area>-<verb>`:

```
zanaris:pane-split          { paneId, axis }
zanaris:pane-close          { paneId }
zanaris:pane-set-content    { paneId, content }
zanaris:pane-focus          { paneId }
zanaris:pane-set-fractions  { splitId, fractions } → the fractions applied
zanaris:pane-even-out       { splitId }
zanaris:tab-new
zanaris:tab-close           { tabId }
zanaris:tab-select          { tabId }
zanaris:tab-move            { tabId, index }
```

`ShellState` gains `tabs: TabView[]`, `activeTabId`, `panes: PaneView[]`
(each `{ paneId, rect, content, focused }`) and `seams: SeamView[]`. Handlers
identify the window from `event.sender` as they do now, never from a value the
renderer supplies, and `pane-set-content` checks a `page` bookmark against the
window's own catalog links exactly as `pages.open` does today — there is still
no address box, so the shell still has no business naming an arbitrary page.

## Keyboard and menu

Menu accelerators, so they work wherever focus is:

| | |
|---|---|
| Cmd/Ctrl+D | Split right |
| Cmd/Ctrl+Shift+D | Split down |
| Cmd/Ctrl+W | Close focused pane |
| Cmd/Ctrl+Shift+W | Close tab |
| Cmd/Ctrl+T | New tab |
| Cmd/Ctrl+1…9 | Select tab |
| Cmd/Ctrl+Alt+arrows | Move focus |

**These must be checked against the 274 client's own key handling before they
ship**, on Windows and Linux especially: a menu accelerator fires before the
page sees the key, so any collision is one the game loses silently. macOS is
safe by construction — the client binds nothing to Cmd.

## Persistence

`state.json` gains, per window, `{ tabs, activeTabId }` — trees, fractions and
pane contents. Restoring recreates page views from their bookmarks and the game
from the remembered world.

`CLAUDE.md` records that nobody has installed this client yet, so the shape may
change outright with no migration path. That licence is used here and should be
deleted from `CLAUDE.md` at first release, not inherited.

This makes "reopening the pages that were open at quit" — item 3 on the
README's Next list — fall out for free rather than needing its own work.

## Edge cases

| Case | Behaviour |
|---|---|
| Split a pane too small to halve | Refused; the pane flashes its border and the View item is disabled. Better than two panes neither of which shows anything. |
| Close the only pane in a tab | Becomes an empty pane. The tab survives. |
| Close the last tab | Closes the window, as today. |
| Window dragged below the tree's total minimum | Everything clips proportionally (solver step 2). No pane is dropped. |
| A `page` leaf whose bookmark the server no longer offers | Imports/restores as `empty`. Visible hole, working layout. |
| Launcher's Game entry while a game pane lives | Disabled, with the reason. |
| Two `game` leaves | Unrepresentable: `pane-set-content` refuses a second one. |

## Testing

`paneTree.test.ts`, pure, no Electron. The invariants worth asserting directly:

- **Tiling.** For any tree and any rect, the pane rects plus the seam rects
  cover the container exactly, with no overlap and no gap. Worth a small
  generator over random trees rather than a handful of fixed cases — it is the
  property every other bug shows up as.
- **Minimums.** No pane comes out under its minimum unless step 2 fired, and
  when it fires every pane is under proportionally.
- **Split.** Halves the target's share; leaves siblings untouched; nests only
  across the grain.
- **Close.** Renormalises to 1; collapses single-child splits; the last pane
  becomes empty rather than vanishing.
- **Fractions.** A drag moves exactly two neighbours; clamping reports the
  applied value even when it equals the current one, which is the contract
  `Grip` depends on and the bug that path was written for.
- **Rounding.** Children sum to `gross` exactly at a spread of container sizes,
  including ones where the fractions are not representable.

Not coverable by `node --test`, and therefore explicit manual gates:

- **A hidden game keeps playing.** Log in, switch to another tab, wait past a
  respawn or a random event, switch back. `backgroundThrottling: false` is
  expected to carry this, and the whole tab design rests on it, so it is proved
  with a real login rather than assumed.
- **Accelerators do not steal game keys.** On Windows and Linux, in game, with
  every binding in the table above.

## Build order

**Milestone 1 — the tree.** One implicit tab; no tab bar yet.

1. `paneTree.ts` and its tests, green before anything is wired.
2. `shared/layout.ts` constants; delete the dead ones.
3. `serverWindow.ts`: replace `applyLayout`'s `computeLayout` call with
   `layoutTree` and position views from the map. The `win.on('resize')` handler
   loses its `preservedWidth`/`preservedHeight` carry-across and the
   `contentWidth`/`contentHeight` fields behind it: they exist to remember what
   the game was owed across a chrome toggle, and nothing is owed anything now.
   `syncMinimumSize` goes the same way, replaced by the constant above.
4. Shell: pane regions, focus border, the launcher, seams via `Grip`.
5. Rail re-pointed at the focused pane. `guides` leaves `TOOL_IDS`.
6. Delete `chatDock.ts`, `pagePane.ts`, `layout.ts`'s ladder and their tests.
7. Menu items and accelerators for split/close/even-out.
8. Fix the comment at `layout.ts:22` — or rather, do not carry it across.

**Milestone 2 — tabs.**

9. `tabs` and `activeTabId` in the window; the tab bar; the game read-out moved
   to its left.
10. Visibility by tab; the game's tab marked.
11. New / close / select / reorder, and their accelerators.
12. `state.json` persistence and restore.

## Rejected

- **Renderer owns the tree in CSS, main mirrors it.** Flex would do the
  arithmetic for free, but a drag becomes a renderer→main round trip per frame
  and the native views visibly lag the seams they are glued to. It also puts
  placement rules in the renderer, which `CLAUDE.md` calls a defect in as many
  words.
- **Drop native views for iframes.** CSS does everything and there is no sync
  problem at all. It costs the per-server storage partitions, the sandbox
  posture, and the page toolbar's back/forward, which reads `webContents`
  navigation events a cross-origin iframe will not give up.
- **The game pinned outside the tab system.** Safest possible answer for the
  character — it can never be hidden by the kit — but it walks back the whole
  premise: the game could not be moved, closed or given the full window, and
  every tab would lose the same block of space to it.
- **Closing the game pane hides it instead of destroying it.** Preserves the
  login, which was the wrong thing to optimise for. An invisible live character
  is one standing in the wilderness while its player believes it is shut down.
- **Two levels of tabs — panes keeping their own tab strips.** VS Code's model,
  and better for eleven open guides than this is. Rejected in favour of the
  simpler tree: a leaf is one content id, with no nested strip to lay out or to
  keep legible in a narrow pane.

## Out of scope

Milestone 3, deferred entire: **look and sharing.** User background images on
empty panes (copied into `userData/backgrounds/`, cover / contain / tile, with
a dim control), and an exportable preset — a single JSON file with images
base64'd inline, no zip and no new dependency, carrying layout and look and
never identity, degrading a missing bookmark to an empty pane on import.

Recorded here rather than dropped because two decisions in this spec exist to
serve it: backgrounds are copied rather than referenced, and a `page` leaf
carries its immutable `bookmark` rather than its live url.

Also out of scope: tearing a pane off into its own window, per-pane zoom, and
an address row — all still on the README's Next list, none of them cheaper or
dearer for this change.
