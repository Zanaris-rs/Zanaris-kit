/** Geometry shared by main, which positions views, and the shell, which draws the chrome around them. */
export const STRIP_HEIGHT = 36;
export const ADDRESS_HEIGHT = 32;
export const RAIL_WIDTH = 48;
export const PANEL_WIDTH = 320;
/** The stock client canvas. The content area never drops below it unless the user shrinks the window. */
export const MIN_CONTENT_WIDTH = 765;
export const MIN_CONTENT_HEIGHT = 503;
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

/** How one axis accommodated its chrome: the window grew, grew and slid back onto the screen, or the content area gave way. */
export type LayoutMode = 'widen' | 'shift' | 'push';
export type TabKind = 'game' | 'page';
