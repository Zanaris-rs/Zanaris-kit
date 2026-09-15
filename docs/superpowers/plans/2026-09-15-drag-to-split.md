# Drag a pane onto another pane's edge to split it

> Plan as approved, with the few places the build departed from it marked **As built**.

Zanaris Kit (`Server/swiftkit`, Electron). Branch `drag-to-split` off `origin/main` (`56a38b0`, which has Timers PR #7 merged). Run `git fetch` first; the local checkout is on `timers`.

## Context

Arranging panes is awkward today:

- **Add pane** always appends a full-height column at the tab's right edge (`paneTree.appendColumn`).
- **Split Right/Down** puts an empty pane after the focused one.
- **Dragging a header** onto another pane can only **swap** the two panes' contents (`swapPanes`). The tree never changes shape.

So a pane can't be moved to a new position. If you add Chat and want it under the game, you can't get it there.

**Goal:** dragging a header over another pane offers five drop zones. The **left, right, top and bottom bands** split the target and move the dragged pane into that side. The **centre** swaps, as today. A gold preview shows exactly where the pane will land. (The owner chose "edges split, centre swaps".)

While in there, fix a bug in today's swap. Page views are keyed by pane id, but swap trades *contents*:

- Swapping two page panes swaps their header names while each page view stays put.
- Swapping a page with a tool reloads the page and loses its history.

If panes carry their ids when they move, page views, and any React state inside a tool pane, follow them without extra work.

## Design

### 1. Tree operations: `src/main/paneTree.ts` (pure, tested)

- **`halvable(extent, floor)` moves here** from `paneMenu.ts`, exported, and `paneMenu` imports it. The menu's Split items and the drop then share one rule.
- **Refactor `splitPane`** onto a private `insertBeside(node, paneId, axis, after: boolean, added: PaneNode, splitId)`.
  - Along the grain (the parent split's axis), the new pane takes half the target's share as a sibling.
  - Across the grain, or for a lone leaf, the target nests in a new split at `[0.5, 0.5]`.
  - `splitPane` becomes `insertBeside(..., true, leaf(id, empty), splitId)`. The existing split tests must pass unchanged.
- **New `movePane(node, from, to, side: 'left'|'right'|'top'|'bottom', splitId)`:**
  - Returns the **same object** when `from === to`, either id is missing, or `from` already sits directly on that side of `to` in a parent split on that axis. Identity is how the host detects a no-op, as it already does for `swapPanes`.
  - Otherwise: `moved = leaf(from, contentOf(node, from))`, then `closePane(node, from)`, then `insertBeside(..., to, axis, after = side is right or bottom, moved, splitId)`.
  - The moved leaf **keeps its paneId**.
  - Removing the source first matters: it may collapse the source's parent split, so the target's parent axis is read after removal. Example: `x[A, y[B, C]]` with A dropped right of B gives `y[x[B, A], C]`.
- **`swapPanes` trades leaves rather than contents.** Leaf `a` becomes `leaf(b, contentB)` and vice versa, so ids travel with their contents. Shape, fractions and splitIds are unchanged. Keep the same-object return for `a === b` or a missing id, and update the doc comment ("A swap rather than a lift-and-reinsert…").

### 2. Drop rules: new `src/main/paneDrop.ts` (pure, tested)

- `export type DropZone = 'centre' | 'left' | 'right' | 'top' | 'bottom'`, re-exported from `src/shared/panes.ts` the same way `PaneContent` is, together with `DropTargets = Record<paneId, Record<DropZone, Rect | null>>`.
- `dropPane(tree, from, to, zone, splitId)`: `centre` calls `swapPanes`, and any edge calls `movePane`.
- `canDrop(tree, rect, from, to, zone)`:
  - False when `from === to` or either id is missing.
  - `centre` is always allowed.
  - An edge is allowed when the target's rect in `layoutTree(closePane(tree, from), rect)` is `halvable` along that axis. Laying out the tree without the source counts the room a sibling source frees up.
- `dropTargets(tree, rect, from)`: for every pane except `from`, and each zone, give the **exact rect the dragged pane will occupy** (`layoutTree(dropPane(..., 'drop-preview'), rect).panes.get(from)`), or `null` where `canDrop` refuses. The whole table is cheap for a tab's handful of panes.

### 3. Zone hit-test: new `src/shared/dropZone.ts` (pure, tested)

- `zoneAt(rect, x, y): DropZone`. Measure the pointer's distance to each edge as a fraction of the pane's width (left/right) or height (top/bottom). If the nearest edge is within `DROP_EDGE_BAND = 0.25`, return that edge, otherwise `centre`. The centre zone is the middle 50%×50%.
- `DRAG_START_DISTANCE = 4` px. A header click that doesn't move no longer blanks the native views.
- It lives in `shared` because the renderer uses it, and it's tested under the same `src/**/*.test.ts` glob. It's pure hit-testing, like `paneAt`. Nothing about sizes is decided in the shell: landing rects come from main.

### 4. IPC and main

The `paneSwap` and `paneDragging` channels are replaced by three new ones:

| Layer | Change |
|---|---|
| **`src/shared/ipc.ts`** (with doc comments) | `paneBeginDrag` → `beginDrag(from): Promise<DropTargets \| null>` hides the native views and returns the table.<br>`paneDrop` → `drop(from, to, zone): Promise<void>` applies the drop and ends the drag in one step.<br>`paneEndDrag` → `endDrag(): Promise<void>` cancels. |
| **`src/preload/index.ts`** | Wires the three calls. |
| **`src/main/index.ts`** | Handlers type-check their arguments, and the zone is checked against the five strings. |
| **`src/main/serverWindow.ts`** | The interface and implementation swap `swapPanes`/`setDragging` for `beginPaneDrag`, `dropPane` and `endPaneDrag`. |

**`src/main/paneHost.ts`:**
- `layout(rect)` also stores the tab rect as `bounds`.
- `beginDrag(from)` sets `dragging = true`, calls `place()`, and returns `dropTargets(active(), bounds, from)`.
- `drop(from, to, zone)`:
  1. Refuses the drop unless `canDrop` allows it. This re-checks in main in case the tree changed mid-drag.
  2. Sets `dragging = false`.
  3. Computes `next = dropPane(..., split-${nextSplit++})`. If the tree changed, it calls `adopt(next)`; otherwise it calls `place()`.
  4. Calls `focus(from)`.
  - Views come back **after** the tree is adopted, which fixes today's one-frame flash of views at their old bounds.
- `endDrag()` sets `dragging = false` and calls `place()`.
- `swap` is removed.

**Capture** (`src/main/index.ts` around line 1007): the swapped step calls `first.dropPane(a, b, 'centre')`, and its log shows the ids moving. A new `-moved` step drops a pane on another pane's `bottom` edge and logs the pane count and seams.

### 5. Shell gesture and indicator (`src/renderer`)

**`Shell.tsx`, `grabFor`/`endDrag`:**
- `pointerdown` records `{from, pointerId, x, y}` and captures the pointer, but doesn't start a drag.
- The first `pointermove` past `DRAG_START_DISTANCE` starts one, and only when the tab has 2+ panes. It sets drag state, calls `beginDrag(from)`, and stores the returned targets if the drag is still the same one.
- Each move computes `over = paneAt(...)` and `zone = zoneAt(over.rect, x, y)`, and sets state only when either changes.
- `pointerup` calls `drop(from, over, zone)` when `targets[over][zone]` isn't null. Anything else calls `endDrag()`.
- **Escape** (a window keydown listener while dragging), `pointercancel` and `lostpointercapture` all cancel. The unmount cleanup calls `endDrag`.
- The header cursor is `grabbing` while dragging.

**New `src/renderer/dropIndicator.tsx`**, rendered at the Shell root above the seams, with `pointer-events-none`:

- **Edge or centre, allowed:**
  - A box at the landing rect: 2px gold border, `bg-gold/15` fill, and a short CSS transition on left/top/width/height so it slides between zones.
  - Label in `font-pixel` gold. An edge shows the dragged pane's name; the centre shows `Swap`. **As built:** the centre says `Swap with <target>`, since the dragged pane's name would sit over the pane it is not going to replace.
  - For the centre, the landing rect is the target's own rect.
- **Refused edge:** a dashed `border-faint` outline around the target, labelled "Too small to split". The drop does nothing.
- **Pane overlays:** the name overlays stay, since native views are hidden during the drag, but the target loses today's solid gold box so the preview is the one gold thing on screen. The source stays dimmed.

### 6. Docs and comments

- **`README.md`:** rewrite the drag paragraph (around lines 385–392) to cover the five zones, the preview, Escape to cancel, and "Too small to split".
- **Comments:** re-read those around every changed function in `paneTree`, `paneHost`, `Shell`, `ipc` and `paneHeader`. `CLAUDE.md` treats a stale comment as a defect.
- **Plan copy:** save this plan as `docs/superpowers/plans/2026-09-15-drag-to-split.md` with **no absolute home paths**, since history was rewritten for this before.

## Tests (TDD, `node --test`, next to the source)

**`paneTree.test.ts`**
- `movePane` edges on a lone pair, e.g. `x[A,B]` with A dropped right of B gives `x[B,A]`.
- Along the grain, the moved pane halves the target's share.
- Across the grain, the target nests.
- The source's parent collapses before insertion (the `y[x[B,A],C]` case).
- The no-op returns the same object (A already left of B).
- The moved leaf keeps its id.
- Every pane rect still tiles exactly.

**Swap trades leaves.** Rewrite the test at line 221 so it checks that ids and contents move together, and that shape, fractions and splitIds are unchanged. Keep the identity test at line 233.

**The `splitPane` tests stay unchanged** and guard the `insertBeside` refactor.

**New `paneDrop.test.ts`**
- `dropTargets` gives exact landing rects for all four edges and the centre.
- An edge is null where the target is under `2*PANE_MIN_WIDTH+SEAM` wide (243px refused, 244px allowed, matching `paneMenu.test.ts`).
- A sibling source frees room and turns a refused edge into an allowed one.
- `from` has no entry.
- `dropPane` routes the centre to swap.

**New `src/shared/dropZone.test.ts`**
- Each band, the centre, corner tie-breaks, and band edges at exactly 25%.

## Verification

1. **Automated:** `npm test`, `npm run typecheck` and `npm run build` all pass.
2. **Harness** (gitignored `.superpowers/harness/`):
   - Add `drop.html` + `drop.tsx` that mounts the real `Shell` with a stubbed `window.zanaris`. Its `beginDrag`/`drop` run the real `dropTargets`/`dropPane`/`layoutTree` on a fake three-pane tree (game, empty, page kinds) and push new state.
   - Start it with the existing `timers-harness` launch config and open `/drop.html` in the Browser pane.
   - Dispatch `pointerdown` + `pointermove` (pointerId 1) on a header over each zone and screenshot the indicator: all four edges, the centre, and a refused edge on a narrow pane.
   - Use `left_click_drag` for real end-to-end drops and confirm the resulting layout with `read_page`.
   - If synthetic pointer events don't reach the gesture, render `DropIndicator` directly as a static gallery.
   - **As built:** synthetic events reach the gesture once the harness swallows `setPointerCapture`'s refusal for a pointer that is not really down. A real `left_click_drag` exercises real capture end to end.
3. **Capture:** `caffeinate -d npm run capture`, then check the `-swapped` and `-moved` shots by looking at them and comparing hashes, not by trusting the log. If Electron has no binary, run `node node_modules/electron/install.js` first.
4. **Your manual check in the real app** (restart `electron-vite dev`, since main and preload changed):
   - Drag the game onto Chat's right edge.
   - Drag Chat onto the game's bottom edge.
   - Swap using the centre.
   - Press Escape mid-drag.
   - Open a page, click a link inside it, drag it to a new edge, and confirm Back is still enabled, which shows history survived.

## Commits

1. Tree operations and tests: `halvable` moves, `insertBeside`, `movePane`, swap trades leaves.
2. `paneDrop` and `dropZone`, with tests.
3. IPC, host, window and capture steps.
4. Shell gesture and `DropIndicator`.

**As built:** 3 and 4 went in as one commit, because the shell is the only caller of the IPC it replaces and neither half type-checks without the other.
5. README and comments, plus the plan copy.

