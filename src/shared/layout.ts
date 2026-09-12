/** Geometry shared by main, which positions views, and the shell, which draws the chrome around them. */

/** The bar of workspace tabs across the top, and the read-out that sits at its left. */
export const TAB_BAR_HEIGHT = 36;
/** The tool rail down the right edge. Window chrome rather than a pane: it is the way a tool gets into one. */
export const RAIL_WIDTH = 48;

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

/** A page pane's own toolbar: back, forward, reload, title. Costs that pane's height, never the window's. */
export const PAGE_TOOLBAR_HEIGHT = 32;

/**
 * The client page's controls strip below the canvas: `max(2vh, 24px)` tall with
 * .5vh margins above and below. At the heights this app opens at the max() floor
 * bites, so 24 + ~6 rounds to 32 with a couple of pixels of slack.
 */
export const PAGE_CONTROLS_HEIGHT = 32;

/**
 * What a game pane asks for when it is first placed, and what a double-click on
 * its seam snaps it back to: the stock 765x503 canvas plus the client page's own
 * controls strip below it.
 *
 * A preference, not a floor. Nothing protects it once the user has dragged a
 * seam past it — the game is an ordinary pane now, and a pane smaller than its
 * content simply clips it. The served page does not rescale to follow unless
 * the player picked Auto Sizing from the controls under the game, so what a
 * small game pane costs is the bottom of the canvas, still reachable by
 * scrolling.
 */
export const GAME_PREFERRED_WIDTH = 765;
export const GAME_PREFERRED_HEIGHT = 503 + PAGE_CONTROLS_HEIGHT;
