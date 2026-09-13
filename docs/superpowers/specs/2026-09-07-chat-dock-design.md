# Zanaris Kit: chat in a bottom dock

**Status:** proposed, 2026-09-07. Extends the layout described in
`2026-09-05-server-windows-design.md`, which gave the window one 320px panel
column on the right and one tool open in it at a time.

## Goal

Chat opens along the bottom of the window by default, wide and short, and can
be moved to the side panel and back. Nothing else about the kit's layout
changes: the game view still never resizes when chrome opens, the rail still
runs full height on the right, and the other tools still live in the side
column.

The motivating observation is proportion. `Chat.tsx` was drawn for 320px wide
by full height. A conversation is a column of short lines, and that shape wraps
almost every one of them. Along the bottom at ~735px, six rows of log hold
roughly what eleven hold in the panel, and the game keeps the middle of the
screen.

## Decisions taken

Four gates were settled before this was written, and the rest of the design
follows from them:

| Question | Answer |
|---|---|
| Which tools can dock at the bottom? | Chat only. Worlds and Single player are side-only and show no move control. |
| How are rooms drawn in a wide dock? | As interface tabs on the dock's own header — the object the window strip already draws. |
| Can the dock and the side panel be open at once? | Yes. They are independent regions. |
| Is the dock height fixed? | Draggable by its top edge, clamped, remembered. |

## Model: chat has a home

Chat stops being "the tool that happens to be selected" and becomes a thing
with a home.

```ts
// shared/chat.ts
export type ChatHome = 'bottom' | 'side';
```

`ToolId` keeps all three members. Chat is still a legal occupant of the side
column, so `tools`, the rail and `selectTool` need no surgery — what changes is
where the rail's Chat button routes.

`ShellState` (`shared/ipc.ts`) gains:

```ts
chatHome: ChatHome;      // 'bottom' by default
dockOpen: boolean;       // meaningful only while chatHome === 'bottom'
dockHeight: number;      // the remembered drag height, in px
rects: { …, dock: Rect | null }   // null means closed, and nothing else
```

### The invariant

Chat occupies the side column **or** the dock, never both, and never neither
when it is open. The side column has exactly one occupant, as it does today.

| Action | Effect |
|---|---|
| Rail Chat tab, home `bottom` | Toggles `dockOpen`. The side panel is untouched. |
| Rail Chat tab, home `side` | Today's behaviour exactly: `selectTool('chat')`. |
| Move down (`→\|` in the side panel) | `chatHome = 'bottom'`, `dockOpen = true`, the side panel closes. |
| Move up (`→\|` in the dock header) | `chatHome = 'side'`, `dockOpen = false`, chat evicts the column's occupant. |
| Rail Worlds tab while the dock is open | Opens Worlds on the side. The dock stays open. |

These rules live in their own pure module rather than inside `serverWindow.ts`:
a transition function over `{ chatHome, dockOpen, activeTool }`. It has no
Electron in it, it is the part of this design most likely to grow a wrong
corner, and `npm test` can prove it.

### Persistence

`dock` and `dockHeight` join the existing `chat` block of `state.json`, beside
`nick`:

```json
"chat": { "nick": "Whoosh", "server": "irc.libera.chat", "port": 6697,
          "dock": "bottom", "dockHeight": 260 }
```

`readChat` in `appState.ts` already reads that block one field at a time, so a
garbage `dock` costs only the dock position and a garbage `dockHeight` only the
height. `dockHeight` is clamped on read as well as on write, since the file is
user-editable.

The home is **app-wide, not per-window**. Chat is one connection showing one
conversation in every window; a dock that sat at the bottom in one window and
the side in another would be two chats in the user's head.

## Geometry

### One solver, two axes

`computeLayout` currently grows the window by a scalar on one axis. Rather than
grow it into a two-axis function with two similar-but-not-identical blocks of
arithmetic, the ladder is extracted to a pure 1-D solver and called twice:

```ts
/** Fit `extra` px of chrome onto one axis: grow, or grow and slide back, or make content give way. */
function fitAxis(input: {
    origin: number; size: number;            // the window, on this axis
    workOrigin: number; workSize: number;    // the display work area, on this axis
    content: number;                         // the content extent to preserve
    extra: number;                           // chrome on this axis
    minContent: number;
    canResize: boolean;
}): { mode: LayoutMode; origin: number; size: number };
```

- **x**: `extra = sideWidth(panelOpen)`, `minContent = MIN_CONTENT_WIDTH`
- **y**: `extra = STRIP_HEIGHT + addressHeight + dockHeight`, `minContent = MIN_CONTENT_HEIGHT`

`widen | shift | push` then becomes literally the same code on both axes, which
is the property the design wants to be true rather than merely intends.
`MIN_CONTENT_HEIGHT` is today read in exactly one place — `serverWindow.ts`
sets the window's `minHeight` from it — and never by the solver, because until
now no chrome competed with the content for height. It becomes a solver input
for the first time.

`LayoutResult.mode` becomes `{ x: LayoutMode; y: LayoutMode }`. `MODE_NOTE` in
`Shell.tsx` composes the two rather than picking one: "the window moved left"
and "the game is scaled down to fit the dock" are different sentences and a
user hitting both deserves both.

### Constants

```ts
// shared/layout.ts
export const DOCK_HEIGHT_DEFAULT = 200;
export const DOCK_HEIGHT_MIN = 120;   // header + two lines + composer
// max is computed, not constant: workArea.height / 2
```

`DOCK_HEIGHT_MIN` is a floor on the drag preference **and** on the fit — an
earlier draft of this spec said "not on the fit", which cannot be reconciled
with the sentence that follows it. The dock is never silently dropped, so
something has to stop it shrinking, and this is it.

The order in which a too-short window gives way is therefore:

1. The dock shrinks from its requested height, but never below
   `DOCK_HEIGHT_MIN`, while content holds at `MIN_CONTENT_HEIGHT`.
2. Once the dock is at its floor, the **content** gives way below
   `MIN_CONTENT_HEIGHT` — which is exactly what `push` already means on the x
   axis, page auto-scaling and all.

This is deliberately the opposite of the x axis, where the panel is sacrificed
to protect the content. On x the panel is one of several tools competing for a
column and can be closed; on y the dock is the conversation the user just
asked to see, and a chat window that silently becomes nothing is worse than a
game canvas that scales down by the few pixels involved.

`rects.dock` is `null` when the dock is closed, and for no other reason.

### The dock's extent

The dock spans content **plus** side-panel width and stops at the rail, which
runs full height. That keeps the rail's Chat tab over the rail rather than
floating above a corner, and it means opening Worlds while the dock is open
widens both the content area and the dock together.

### Bevels

The rail carries a documented exception in `styles.css`: its left edge meets
the panel rather than the window, so a lit highlight there would draw a bright
seam down the middle of the chrome, and it gets a dark border plus an inset
groove instead. The dock has the mirror of that problem on its **top** edge,
where it meets the content, and takes the mirror of the fix:
`inset 0 2px 0 rgba(0, 0, 0, 0.28)`, keeping its lit edge on the left only.

## The shell and `Chat.tsx`

`Shell.tsx` draws a second region beside the existing `<aside>` for
`rects.panel`, in the same way: exactly where main says it is, nothing
computed in the renderer.

`Chat.tsx` splits by chrome, not by conversation. The log and the composer are
identical in both homes; only the furniture above them differs.

```
Chat({ view, home })
├─ NickPrompt                       unchanged
└─ Conversation
   ├─ home === 'bottom' ? <DockHeader/>                        // room tabs · Chat · →|
   │                    : <h2 class="title">Chat</h2> + <Channels/>   // today, verbatim
   ├─ <Status/>        unchanged, still empty:hidden, still aria-live
   ├─ <Log/>           shared
   └─ <Composer/>      shared
```

### The dock header

One row, ~33px: room tabs from the left, then the gold `Chat` title, then the
move control. It earns its height twice over by carrying the title and the move
control out of the body — in the side panel those cost 31px of centred title
plus a wrapping chip row, which is affordable in 600px of height and is not
affordable in 200px.

Tabs sit in **join order and never reorder**. An unread count changes inside a
tab that stays put; a room list that reshuffles as people talk is a room list
you cannot aim at.

### One refactor

`Shell.tsx` already solves the text-bearing tab for the window strip, with
`TAB_BOX = { height: 26, width: 'auto' }` overriding `.tab`'s 36×34 square. The
dock header is the same object. Rather than copy that override into
`Chat.tsx`, the tab button moves to `src/renderer/tab.tsx` and both use it.
This is the only refactoring in this design and it is in scope because the two
rows must not be able to drift apart.

### Details

- **Room labels keep the `#04scape-` shortening in both homes.** The comment in
  `Chat.tsx` justifies the trim by the 320px panel, which stops being true —
  but short labels still fit more tabs, and a room whose name changes when you
  move the dock is worse than one that is always short. The label stays; the
  comment's stated reason must be rewritten, because it is about to be false.
- **`NickPrompt` gets better.** First run now shows it at ~735px instead of
  320px, so its two paragraphs land in three or four lines rather than a
  column. No change; a capture confirms it.
- **One new icon** in `icons.tsx` for the move control, a flat sprite on a dark
  outline like the rest. Its `aria-label` names the destination, not the
  direction: "Move chat to the side" / "Move chat to the bottom".

## Drag

A 4px strip along the dock's top edge, in the shell. `pointerdown` captures,
`pointermove` sends `chat.setDockHeight(px)` throttled to one
`requestAnimationFrame`, `pointerup` releases and writes through to
`state.json`. The resize is live rather than a preview line that snaps at the
end: the point of a draggable dock is judging how much chat you want while
looking at it.

**`applying` must cover dock drags.** `applyLayout` calls
`win.setContentBounds`, which fires `win.on('resize')`, which re-derives the
content extent. The `applying` flag in `serverWindow.ts` exists for exactly
this and must be set during drag-driven layouts too, or every drag frame fights
the resize handler for ownership of `contentHeight`.

**`contentHeight` must be tracked.** `win.on('resize')` re-derives
`contentWidth` and nothing else, because until now height had no chrome to
preserve it against. It needs the twin, or the height being preserved is lost
the first time the window is resized with the dock open.

**`minHeight` must follow the dock.** It is fixed at construction as
`STRIP_HEIGHT + MIN_CONTENT_HEIGHT`. With the dock open it becomes
`STRIP_HEIGHT + MIN_CONTENT_HEIGHT + dockHeight` via `win.setMinimumSize`, or
dragging the window short crushes the game below 503.

## Edge cases

| Case | Behaviour |
|---|---|
| Maximised or fullscreen | `push` on the y axis; content shrinks, the note says so |
| Window resized with the dock open | `contentHeight` re-derived like `contentWidth`; `dockHeight` preserved |
| Move side→bottom with Worlds open | Side closes, dock opens; both axes change in one `applyLayout` |
| Move bottom→side | Chat evicts the column's occupant; the rail shows chat as the active side tool |
| Home changes with several windows open | Every window re-lays out, not just repaints |
| First run | The dock starts **closed** |

The last two are load-bearing.

The fan-out in `index.ts` is `for (const sw of serverWindows.values())
sw.pushState()` — a repaint. A home change moves geometry, so `ServerWindow`
must expose `relayout()` and the chat subscription must call it.

The dock starts closed because `index.ts` records the property that a capture
run never opens a socket, since its profile has no nick. A dock that opened
itself on first launch would either break that or greet a new user with a nick
prompt they did not ask for. Opening chat stays a deliberate act; only its
default *position* changes.

## Testing

`npm test` runs the pure modules under `node --test` with no Electron, and
there is no renderer test infrastructure. The work splits accordingly.

**Proven by tests:**

- `layout.test.ts`: `fitAxis` directly — widen, shift and push on each axis
  independently. The existing horizontal cases keep every one of their
  geometry assertions — content, panel, rail, window — and those are the
  regression proof that a closed dock changes nothing. Their six
  `assert.equal(r.mode, …)` lines do change, to `r.mode.x`, because `mode`
  becomes a pair; that edit is mandated by this spec, not incidental churn.
- The home/eviction/toggle transition function, over every row of the invariant
  table.
- `appState.test.ts`: `readChat` tolerates a missing `dock`, a garbage `dock`
  and an out-of-range `height`, losing only the bad field.

**Confirmed by looking:** `npm run capture` gains a dock pass — the dock open at
default height, the nick prompt in the dock, and chat on the side with Worlds
evicted. Per the workflow the README documents, the chosen mockup becomes
`design/ChatDock.dc.html` with an entry in `design/canvas.json`, so the
artboards keep matching the app.

**Covered by nothing:** the drag itself. Pointer capture, rAF throttling and
the `applying` flag interacting with `win.on('resize')` is the riskiest code
here and has no test story. It is built last, on top of a working fixed-height
dock, so a bad drag can be reverted without taking the feature with it.

## Build order

1. `fitAxis`, and `computeLayout` rebuilt on it. No behaviour change, existing
   tests green.
2. The transition function and its tests.
3. `chatHome`, `dockOpen`, `dockHeight` through `AppState`, `ShellState` and
   the preload bridge; the dock rendered at a fixed `DOCK_HEIGHT_DEFAULT`.
4. `tab.tsx`, the dock header, the move control, the `Chat.tsx` split.
5. Multi-window `relayout()` on home change.
6. The drag handle.
7. Captures and the `design/` artboard.

Steps 1–3 are shippable on their own: a fixed-height bottom dock that can be
moved to the side. Everything after is improvement on a working feature.

## Rejected

- **A global dock position that every tool follows.** Worlds is a tall table of
  around twenty rows and is genuinely bad in a short wide strip.
- **`splitWindow` grown to two axes.** Fewer moving parts, but it puts two
  near-identical blocks of arithmetic in one function, which is the shape that
  drifts.
- **The dock as a post-pass over the existing `splitWindow`.** The smallest
  diff, and it keeps every existing test green, but the dock would not
  participate in the grow-the-window trick, so opening it would always shrink
  the game view. That is the one thing the layout exists to prevent.
- **A permanently-on dock, with no toggle and no rail tab.** Least state of all,
  but it takes ~200px of height from someone who never chats, and it breaks the
  no-socket-without-a-nick property.
- **A channel column down the left of the dock.** The tallest log of the
  options considered and a stable room list, but it spends 132px of the dock's
  best real estate on four rooms and gives `Chat.tsx` a second room-control
  shape to maintain. The stable-order property was kept; the column was not.

## Out of scope

- Docking Worlds or Single player anywhere but the side.
- A dock on the top or left edge.
- Detaching chat into its own window.
- Per-window dock positions.
- Any change to the IRC service, the protocol layer, or which rooms are joined.
