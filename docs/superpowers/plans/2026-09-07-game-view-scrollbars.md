# Fix the game-view scrollbars in Zanaris Kit

## Context

Zanaris Kit windows show a vertical **and** a horizontal scrollbar around the game
area (screenshot 1). The scrollbars are not drawn by the kit — the kit's own shell
renderer is hard-locked to `overflow: hidden` (`src/renderer/styles.css:91`). They
belong to the **client page itself** (`view/client.ejs`), which every server serves:
Lost City, Zanaris, Labs, single player and local all load the same template.

The page's layout is:

```css
body   { overflow: auto; }                 /* propagates to the viewport      */
center { min-height: 100vh; justify-content: center; }
canvas { width: 765px; height: 503px; }    /* fixed                           */
#controls { margin: .5vh 0; height: max(2vh, 24px); }   /* the strip below it */
```

So the page's natural height is `503 + .5vh + max(2vh,24px) + .5vh`, i.e. **≥ 533px**
at the sizes this app opens at — about 30px taller than the canvas.

The kit's window floor is `MIN_CONTENT_WIDTH/HEIGHT = 765 × 503`
(`src/shared/layout.ts:7-8`) — *exactly* the canvas, with zero room for that strip.
Drag the window to its minimum and the game view is 765×503, the page needs ~533,
a vertical scrollbar appears, `100vh` in Chromium ignores the scrollbar gutter so
the container is now taller than the visible area, 15px of width is stolen, and a
horizontal scrollbar appears too. That mutual induction is screenshot 1 exactly
(measured: its content rect is ~813×540, i.e. the window at its minimum height).

Screenshot 2 — the target — is a content rect of **813×571**: rail (48) + canvas
(765) wide, strip (36) + canvas (503) + controls strip (~32) tall. The current
default is a loose `800×640` game area (`src/main/serverWindow.ts:22`), which fits
but is not tight.

**Intended outcome:** every server window opens tight to the game — canvas plus the
kit's strip above and the page's controls below — and no scrollbar is ever visible,
at any window size, on any server.

### Decisions taken

- **Minimum stays the bare canvas, 765×503.** `MIN_CONTENT_WIDTH/HEIGHT` are not
  changed. The user can still shrink a window to just the game screen.
- **The kit suppresses the page's scrollbars** by injecting CSS into the game view.
  This is the only hook that reaches remote servers, whose page we don't control.
- **Kit only.** There is one `BrowserWindow` and one `createServerWindow` path for
  all catalog kinds (`serverWindow.ts:160`), so a kit-side fix covers every server
  automatically. `Server/engine/view/client.ejs` is left alone.

---

## Change 1 — a tight default window size

**`src/shared/layout.ts`** — add the page's controls strip as a named constant next
to the existing canvas constants, so the derivation is documented once:

```ts
/**
 * The client page's controls strip below the canvas: `max(2vh, 24px)` tall with
 * .5vh margins above and below. At the heights this app opens at the max() floor
 * bites, so 24 + ~6 rounds to 32 with a couple of pixels of slack — a content
 * height of 535 satisfies `h >= 503 + h/100 + 24` (which needs 532.33).
 */
export const PAGE_CONTROLS_HEIGHT = 32;
```

**`src/main/serverWindow.ts:21-22`** — derive the default from it instead of the
hand-picked `800 × 640`:

```ts
/** The content area a new window opens with: the canvas plus the page's controls strip. */
const DEFAULT_CONTENT = { width: MIN_CONTENT_WIDTH, height: MIN_CONTENT_HEIGHT + PAGE_CONTROLS_HEIGHT };
```

That is 765×535, giving a window content rect of **813×571** — screenshot 2. Add
`PAGE_CONTROLS_HEIGHT` to the existing `../shared/layout` import at line 4.

Nothing else needs touching: the `BrowserWindow` options (161-162), the initial
`splitWindow` seed (152) and the `contentWidth`/`contentHeight` seeds (153-154) all
already read `DEFAULT_CONTENT`.

The default is now 32px taller than the minimum on y and equal to it on x. That is
intended — the window opens tight and can still be dragged down to the bare canvas.

## Change 2 — never show a scrollbar in the game view

**`src/main/serverWindow.ts`**, beside the `gameView` construction (198-212). Add a
module constant and a `dom-ready` listener:

```ts
/**
 * Injected into every game page. The stock client is `body{overflow:auto}` around
 * a fixed 765x503 canvas plus a controls strip, inside a `center{min-height:100vh}`
 * flex column — and Chromium's vh ignores the scrollbar gutter, so one scrollbar
 * induces the other. Three fixes, in order: hide the bars so they never take a
 * gutter (which alone breaks the induction), swap 100vh for a percentage of a
 * definite height, and make the centring `safe` so an overflowing page clips its
 * controls strip at the bottom instead of shaving the top off the canvas.
 * Scrolling still works, so 2x/3x Size stay pannable by wheel and trackpad.
 */
const GAME_PAGE_CSS = `
    html, body { height: 100% !important; }
    body { scrollbar-width: none !important; }
    body::-webkit-scrollbar, html::-webkit-scrollbar { display: none !important; }
    center { min-height: 100% !important; justify-content: safe center !important; }
`;
```

```ts
gameView.webContents.on('dom-ready', () => {
    // The kit's own offline and starting pages are already sized to fit; this is for the client.
    if (gameView.webContents.getURL().startsWith('file:')) return;
    void gameView.webContents.insertCSS(GAME_PAGE_CSS);
});
```

Notes on the mechanics:

- `insertCSS` is per-document, so it must be re-applied on every navigation.
  `dom-ready` fires per main-frame document and is early enough to land before
  first paint; `did-finish-load` (already used at 553 for the load waiter) is too
  late and would flash a scrollbar.
- The `file:` guard keeps `OFFLINE_PAGE` and `STARTING_PAGE` (19-20) untouched —
  they use `static/page.css`, not this layout.
- `!important` because this is an author-origin sheet injected into a page we do
  not control; the remote template may change under us.
- World hopping and detail switching are `loadURL` in the same view
  (`switchWorld`, 635-650), so they re-fire `dom-ready` and re-inject. Nothing
  server-specific is needed.

This also closes the one case the sizing change cannot: with the chat dock open
while maximised or fullscreen, `splitWindow` (`src/main/layout.ts:132-133`)
deliberately lets the content rect fall below `MIN_CONTENT_HEIGHT` rather than drop
the dock. That behaviour is correct and stays; it simply no longer produces
scrollbars.

## Change 3 — documentation

**`README.md:227-241`** — the layout section states the content-rect rule. Add that
a window opens at 765×535 (canvas plus the page's controls strip), that the floor
remains the bare 765×503 canvas, and that the kit injects a small stylesheet into
the game page so it never scrolls.

---

## Files touched

| File | Change |
|---|---|
| `swiftkit/src/shared/layout.ts` | add `PAGE_CONTROLS_HEIGHT = 32` |
| `swiftkit/src/main/serverWindow.ts` | derive `DEFAULT_CONTENT`; add `GAME_PAGE_CSS` + `dom-ready` `insertCSS` |
| `swiftkit/README.md` | document the new default and the injected stylesheet |

`src/main/layout.ts` and `src/main/layout.test.ts` need **no** change:
`MIN_CONTENT_WIDTH/HEIGHT` are unchanged, and the tests' one literal (`height: 539`
at `layout.test.ts:194`) is `STRIP_HEIGHT + MIN_CONTENT_HEIGHT`, still correct.

## Verification

Run everything from `/Users/matthewgould/Projects/2004scape/Server/swiftkit`.

1. **Static checks** — `npm run typecheck` and `npm test` (the node:test suite,
   including `src/main/layout.test.ts`) both green.
2. **Default size.** `npm run dev`, open a Lost City window. Confirm via the main
   process (or a screenshot measured against the title bar) that the content rect is
   **813×571** and the game view **765×535**: the "1x Size / Auto Scaling" bar sits
   flush at the bottom with no black gutter, matching screenshot 2. No scrollbars.
3. **The failing case from screenshot 1.** Drag the window to its minimum
   (813×539). Confirm no scrollbar appears, the canvas is intact from the top, and
   only the bottom of the controls strip is clipped — and that a wheel scroll still
   reveals it.
4. **Dock + maximised.** Maximise, open the chat dock, drag it to its floor so the
   content rect is pushed under 503. Confirm still no scrollbars.
5. **2x Size.** Choose "2x Size" in the page's dropdown at the default window size
   and confirm the canvas is still pannable by wheel/trackpad (scrolling works, the
   bars are just invisible).
6. **Every server kind.** Repeat step 2 for single player (which boots
   `static/starting.html` first) and for one remote world hop (World 1 → World 2),
   confirming the injected CSS re-applies after `loadURL`. Also confirm the offline
   page still renders correctly (point a `local` entry at a dead port).
7. **Capture.** `npm run capture` writes `captures/*.png` from `capturePage()` of
   the game view only — a good before/after artefact for the tight default.
