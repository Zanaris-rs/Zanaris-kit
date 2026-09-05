/** Geometry shared by main, which positions views, and the shell, which draws the chrome around them. */
export const STRIP_HEIGHT = 36;
export const ADDRESS_HEIGHT = 32;
export const RAIL_WIDTH = 48;
export const PANEL_WIDTH = 320;
/** The stock client canvas. The content area never drops below it unless the user shrinks the window. */
export const MIN_CONTENT_WIDTH = 765;
export const MIN_CONTENT_HEIGHT = 503;

/** How the panel was accommodated: the window grew, grew and moved left, or the content area gave way. */
export type LayoutMode = 'widen' | 'shift' | 'push';
export type TabKind = 'game' | 'page';
