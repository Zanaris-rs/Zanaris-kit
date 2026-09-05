import {
    ADDRESS_HEIGHT,
    MIN_CONTENT_WIDTH,
    PANEL_WIDTH,
    RAIL_WIDTH,
    STRIP_HEIGHT,
    type LayoutMode,
    type TabKind
} from '../shared/layout.ts';

/**
 * Window layout.
 *
 * Opening the panel widens the *window* by the panel width so the content area
 * stays pixel-identical: the game view's bounds never change, which matters
 * because reloading or scaling that view costs the login. Widening is not
 * always possible (maximised, fullscreen, or no room on the display), and then
 * the content area gives way instead. The mode is reported to the UI rather
 * than silently substituted.
 *
 * All rects are CONTENT bounds, relative to the window's content area.
 */

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface LayoutInput {
    panelOpen: boolean;
    activeTabKind: TabKind;
    /** Current window content bounds, in screen coordinates. */
    window: Rect;
    /** Usable area of the display the window is on. */
    workArea: Rect;
    /** The content width to preserve across panel toggles. */
    contentWidth: number;
    /** False when maximised or fullscreen: the window cannot change size. */
    canResize: boolean;
}

export interface Rects {
    strip: Rect;
    /** Only while a page tab is active. */
    address: Rect | null;
    content: Rect;
    /** Only while the panel is open and has room. */
    panel: Rect | null;
    rail: Rect;
}

export interface LayoutResult extends Rects {
    mode: LayoutMode;
    /** Content bounds to apply to the window. */
    window: Rect;
}

export function sideWidth(panelOpen: boolean): number {
    return panelOpen ? PANEL_WIDTH + RAIL_WIDTH : RAIL_WIDTH;
}

/** Splits a window of the given content size into strip, address row, content, panel and rail. */
export function splitWindow(width: number, height: number, panelOpen: boolean, activeTabKind: TabKind): Rects {
    const contentW = Math.max(MIN_CONTENT_WIDTH, width - sideWidth(panelOpen));
    const sideW = Math.max(0, width - contentW);
    const railW = Math.min(RAIL_WIDTH, sideW);
    const panelW = panelOpen ? Math.max(0, sideW - railW) : 0;
    const addressH = activeTabKind === 'page' ? ADDRESS_HEIGHT : 0;
    const top = STRIP_HEIGHT + addressH;
    const below = Math.max(0, height - STRIP_HEIGHT);
    return {
        strip: { x: 0, y: 0, width, height: STRIP_HEIGHT },
        address: addressH > 0 ? { x: 0, y: STRIP_HEIGHT, width: contentW, height: addressH } : null,
        content: { x: 0, y: top, width: contentW, height: Math.max(0, height - top) },
        panel: panelW > 0 ? { x: contentW, y: STRIP_HEIGHT, width: panelW, height: below } : null,
        rail: { x: contentW + panelW, y: STRIP_HEIGHT, width: railW, height: below }
    };
}

export function computeLayout(input: LayoutInput): LayoutResult {
    const desiredWidth = input.contentWidth + sideWidth(input.panelOpen);
    let mode: LayoutMode;
    let window: Rect;

    if (!input.canResize || desiredWidth > input.workArea.width) {
        mode = 'push';
        window = { ...input.window };
    } else {
        // Keep the window on screen: shift left rather than growing off the edge.
        const rightEdge = input.workArea.x + input.workArea.width;
        let x = input.window.x;
        if (x + desiredWidth > rightEdge) x = rightEdge - desiredWidth;
        if (x < input.workArea.x) x = input.workArea.x;
        mode = x === input.window.x ? 'widen' : 'shift';
        window = { x, y: input.window.y, width: desiredWidth, height: input.window.height };
    }

    return { mode, window, ...splitWindow(window.width, window.height, input.panelOpen, input.activeTabKind) };
}
