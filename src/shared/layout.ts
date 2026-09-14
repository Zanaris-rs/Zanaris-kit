/** Geometry shared by main, which positions views, and the shell, which draws the chrome around them. */

/** The bar of workspace tabs across the top, and the Add pane control at its right. */
export const TAB_BAR_HEIGHT = 36;

/**
 * The draggable gap between two panes.
 *
 * It has to be real pixels of its own rather than a hairline drawn over the
 * edge of either side: panes are native WebContentsViews stacked above
 * everything the shell draws, so a grip painted on top of one would never see
 * a pointer. This is the strip of shell left showing between them, and it is
 * the only thing there is to grab — which also caps a grip's hit area at its
 * own width, since anything wider would be over a view that eats the pointer.
 *
 * Kept at the 4 the reference pane's single seam always had. A window full of
 * wider gutters costs real pixels at every split, and the keyboard path in
 * `grip.tsx` is the answer for anyone a 4px target does not serve.
 */
export const SEAM = 4;

/**
 * The floor on any pane, on either axis.
 *
 * Deliberately far below anything useful: it is the point at which a pane
 * stops being able to show that it exists, not the point at which its content
 * is comfortable. A user splitting a window into slivers is allowed to do
 * that. What a given content *wants* is its preferred size, honoured when the
 * pane is first placed and forgotten thereafter.
 */
export const PANE_MIN_WIDTH = 120;
export const PANE_MIN_HEIGHT = 80;

/**
 * What a pane added from the tab bar asks for: a new column down the tab's
 * right edge, 320px wide — the width the tools were drawn for when they lived
 * in a fixed side panel.
 *
 * A preference, like the game's. The column never takes more than an even
 * share of the row it joins, so on a narrow window it is the columns' equal
 * rather than most of the window, and once placed it is an ordinary pane
 * whose seam the player drags.
 */
export const COLUMN_PREFERRED_WIDTH = 320;

/**
 * Every pane's own header: what the pane is called, whatever controls belong to
 * that one thing, and the dropdown that changes what the pane holds.
 *
 * On all four kinds, not only on pages. A pane that could not say what it was
 * relied on its content to introduce itself, which the game and a reference page
 * cannot do at all — they are native views with nothing of ours drawn in them —
 * and which cost the tools a heading apiece in a window where every pane already
 * has an edge. The game and page views are inset below it by
 * this much, so it costs that pane's own height and never the window's.
 */
export const PANE_HEADER_HEIGHT = 32;

/**
 * The client page's controls strip below the canvas: `max(2vh, 24px)` tall with
 * .5vh margins above and below. At the heights this app opens at the max() floor
 * bites, so 24 + ~6 rounds to 32 with a couple of pixels of slack.
 */
export const PAGE_CONTROLS_HEIGHT = 32;

/**
 * What a game pane asks for when it is first placed, and what a double-click on
 * its seam snaps it back to.
 *
 * Three bands make up the height, and each is there because something would be
 * cut off without it: the stock 503px canvas, the client page's own controls
 * strip below it, and the pane header above it, which the view is inset by. The
 * header was the last to arrive and is why this grew from 535 — a pane asking
 * for exactly the canvas and the strip would have had the header eat the bottom
 * of the canvas at the size the window opens at, which is the one size nobody
 * chose and everybody sees.
 *
 * A preference, not a floor. Nothing protects it once the user has dragged a
 * seam past it — the game is an ordinary pane now, and a pane smaller than its
 * content simply clips it. The served page does not rescale to follow unless
 * the player picked Auto Sizing from the controls under the game, so what a
 * small game pane costs is the bottom of the canvas, still reachable by
 * scrolling.
 */
export const GAME_PREFERRED_WIDTH = 765;
export const GAME_PREFERRED_HEIGHT = 503 + PAGE_CONTROLS_HEIGHT + PANE_HEADER_HEIGHT;

/**
 * What the chat pane below the game asks for in the arrangement a new window
 * opens with: the old chat dock's default height of 200, plus the header every
 * pane now has. A new window opens tall enough for both, so neither pays for the
 * other at the size nobody chose.
 */
export const CHAT_PREFERRED_HEIGHT = 200 + PANE_HEADER_HEIGHT;
