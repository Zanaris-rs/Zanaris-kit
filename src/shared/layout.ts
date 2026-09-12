/** Geometry shared by main, which positions views, and the shell, which draws the chrome around them. */
export const STRIP_HEIGHT = 36;
export const RAIL_WIDTH = 48;
export const PANEL_WIDTH = 320;
/**
 * Floor on the side panel, and the x-axis twin of DOCK_HEIGHT_MIN: a sidebar
 * the user has just opened is never silently dropped, so once it reaches this
 * width a window too narrow for it takes the rest out of the game instead.
 *
 * 240 is what the widest thing the panel holds still needs. Hiscores lays out
 * three fixed numeric columns — 66 + 44 + 92 — because tabular figures only
 * line up across rows if every row gets the same box, and a column too narrow
 * for its number overflows across its neighbour rather than wrapping. That
 * leaves the skill name a column of its own to truncate in, which is what it
 * is built to do. Below this the panel stops being a panel and becomes a
 * sliver, and a sliver is worse than a game the user can scroll.
 */
export const PANEL_WIDTH_MIN = 240;
/** The stock client canvas. The content area never drops below it unless the user shrinks the window. */
export const MIN_CONTENT_WIDTH = 765;
export const MIN_CONTENT_HEIGHT = 503;
/**
 * The floor the game window may be dragged to, in content pixels — deliberately
 * far below the canvas above.
 *
 * These are two different jobs that used to be one number. MIN_CONTENT_* is the
 * canvas the layout protects *within* a window: what the game claws back out of
 * the panel and the pane whenever there is room to claw. This is how small the
 * window itself may get, and the answer is "small", because the client has
 * answers of its own for a view shorter than its page — scrolling reaches the
 * canvas bottom, and "Auto Sizing" under the game scales the page to fit — and
 * a floor at the canvas denies them to someone who wants the game in a corner
 * of their screen. What it still clears is the chrome that never gives way: the
 * rail's width and the strip's height.
 *
 * The defaults are untouched by this. The window still opens at the canvas, and
 * still grows back to it whenever the chrome it is asked to fit leaves room.
 */
export const MIN_WINDOW_CONTENT_WIDTH = 256;
export const MIN_WINDOW_CONTENT_HEIGHT = 144;
/**
 * The client page's controls strip below the canvas: `max(2vh, 24px)` tall with
 * .5vh margins above and below. At the heights this app opens at the max() floor
 * bites, so 24 + ~6 rounds to 32 with a couple of pixels of slack — a content
 * height of 535 satisfies `h >= 503 + h/100 + 24` (which needs 532.33).
 */
export const PAGE_CONTROLS_HEIGHT = 32;
/** Default height of the bottom chat dock. */
export const DOCK_HEIGHT_DEFAULT = 200;
/** Floor on the dock, both as a drag preference and as the fit's own minimum: the dock is never silently dropped, so once it reaches this floor a too-short window shrinks the content below MIN_CONTENT_HEIGHT instead. */
export const DOCK_HEIGHT_MIN = 120;

/**
 * The reference pane: LostHQ beside the game, not in front of it.
 *
 * 720 is what LostHQ's own pages want — their tables run to about 900 and
 * degrade by wrapping rather than clipping — minus the width a 1440px laptop
 * can actually spare. The floor is the width below which those tables stop
 * being readable at all, and is where the seam's drag stops.
 */
export const PAGE_WIDTH_DEFAULT = 720;
export const PAGE_WIDTH_MIN = 480;
/** The pane's own toolbar: back, forward, reload, title. Costs the pane's height, never the window's. */
export const PAGE_TOOLBAR_HEIGHT = 32;
/**
 * The draggable seam between the game and the pane.
 *
 * It has to be real pixels of its own rather than a hairline drawn over the
 * edge of either view: both sides are native WebContentsViews stacked above
 * everything the shell draws, so a grip painted on top of one would never see
 * a pointer. This is the strip of shell left showing between them, and it is
 * the only thing there is to grab.
 */
export const PAGE_SEAM = 4;

/** How one axis accommodated its chrome: the window grew, grew and slid back onto the screen, or the content area gave way. */
export type LayoutMode = 'widen' | 'shift' | 'push';
