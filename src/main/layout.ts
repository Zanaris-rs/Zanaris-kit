import {
    ADDRESS_HEIGHT,
    DOCK_HEIGHT_MIN,
    MIN_CONTENT_HEIGHT,
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
 * Opening chrome widens the *window* instead of shrinking the content area, so
 * the game view's bounds stay pixel-identical: reloading or scaling that view
 * costs the login. That protection runs independently on both axes — the side
 * panel grows the window rightward, a bottom dock grows it downward — via one
 * 1-D solver, `fitAxis`, called once per axis. Widening is not always possible
 * (maximised, fullscreen, or no room on the display), and then the content
 * area gives way instead. Each axis reports its own mode to the UI rather than
 * silently substituting.
 *
 * All rects are CONTENT bounds, relative to the window's content area.
 */

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** One axis' worth of `fitAxis` input: the window and work area reduced to a single dimension. */
export interface AxisInput {
    origin: number; // the window's x or y
    size: number; // the window's width or height
    workOrigin: number; // the work area's x or y
    workSize: number; // the work area's width or height
    content: number; // the content extent to preserve on this axis
    extra: number; // chrome on this axis
    minContent: number; // unused by fitAxis itself, by design: floor logic lives in splitWindow, not here
    canResize: boolean;
}

export interface AxisResult {
    mode: LayoutMode;
    origin: number;
    size: number;
}

/**
 * Fits `extra` px of chrome onto one axis: grow the window to hold content
 * plus chrome, sliding back onto the screen if it would otherwise run off the
 * far edge, or leave the window alone and let the content area give way. The
 * ladder is identical for x and y — it is written once here and called twice
 * by `computeLayout` rather than duplicated per axis, which is the shape that
 * drifts.
 */
export function fitAxis(input: AxisInput): AxisResult {
    const desired = input.content + input.extra;
    if (!input.canResize || desired > input.workSize) {
        return { mode: 'push', origin: input.origin, size: input.size };
    }

    // Keep the window on screen: slide back rather than growing off the far edge.
    const workEnd = input.workOrigin + input.workSize;
    let origin = input.origin;
    if (origin + desired > workEnd) origin = workEnd - desired;
    if (origin < input.workOrigin) origin = input.workOrigin;

    return { mode: origin === input.origin ? 'widen' : 'shift', origin, size: desired };
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
    /** The content height to preserve across dock toggles. */
    contentHeight: number;
    /** Height of the bottom dock; 0 when it is closed. */
    dockHeight: number;
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
    /** Only while the dock is open (dockHeight > 0). Never dropped for want of room — the content gives way instead. */
    dock: Rect | null;
}

export interface LayoutResult extends Rects {
    mode: { x: LayoutMode; y: LayoutMode };
    /** Content bounds to apply to the window. */
    window: Rect;
}

export function sideWidth(panelOpen: boolean): number {
    return panelOpen ? PANEL_WIDTH + RAIL_WIDTH : RAIL_WIDTH;
}

/** Splits a window of the given content size into strip, address row, content, dock, panel and rail. */
export function splitWindow(width: number, height: number, panelOpen: boolean, dockHeight: number, activeTabKind: TabKind): Rects {
    const contentW = Math.max(MIN_CONTENT_WIDTH, width - sideWidth(panelOpen));
    const sideW = Math.max(0, width - contentW);
    const railW = Math.min(RAIL_WIDTH, sideW);
    const panelW = panelOpen ? Math.max(0, sideW - railW) : 0;
    const addressH = activeTabKind === 'page' ? ADDRESS_HEIGHT : 0;
    const top = STRIP_HEIGHT + addressH;
    const below = Math.max(0, height - STRIP_HEIGHT);

    // Unlike x, where the panel is one of several tools and gives way first,
    // the dock is the conversation the user just asked to see: a chat window
    // silently reduced to nothing is worse than a game canvas scaled down by
    // the pixels involved. So the dock shrinks from its request first, but
    // never below DOCK_HEIGHT_MIN, while content holds at MIN_CONTENT_HEIGHT;
    // only once the dock is at its own floor does content give way below its.
    const belowTop = Math.max(0, height - top);
    const dockH = dockHeight === 0 ? 0 : Math.max(DOCK_HEIGHT_MIN, Math.min(dockHeight, belowTop - MIN_CONTENT_HEIGHT));
    const contentH = Math.max(0, belowTop - dockH);

    return {
        strip: { x: 0, y: 0, width, height: STRIP_HEIGHT },
        address: addressH > 0 ? { x: 0, y: STRIP_HEIGHT, width: contentW, height: addressH } : null,
        content: { x: 0, y: top, width: contentW, height: contentH },
        panel: panelW > 0 ? { x: contentW, y: STRIP_HEIGHT, width: panelW, height: below } : null,
        rail: { x: contentW + panelW, y: STRIP_HEIGHT, width: railW, height: below },
        dock: dockH > 0 ? { x: 0, y: top + contentH, width: contentW + panelW, height: dockH } : null
    };
}

export function computeLayout(input: LayoutInput): LayoutResult {
    const addressHeight = input.activeTabKind === 'page' ? ADDRESS_HEIGHT : 0;

    const x = fitAxis({
        origin: input.window.x,
        size: input.window.width,
        workOrigin: input.workArea.x,
        workSize: input.workArea.width,
        content: input.contentWidth,
        extra: sideWidth(input.panelOpen),
        minContent: MIN_CONTENT_WIDTH,
        canResize: input.canResize
    });

    const y = fitAxis({
        origin: input.window.y,
        size: input.window.height,
        workOrigin: input.workArea.y,
        workSize: input.workArea.height,
        content: input.contentHeight,
        extra: STRIP_HEIGHT + addressHeight + input.dockHeight,
        minContent: MIN_CONTENT_HEIGHT,
        canResize: input.canResize
    });

    const window: Rect = { x: x.origin, y: y.origin, width: x.size, height: y.size };

    return {
        mode: { x: x.mode, y: y.mode },
        window,
        ...splitWindow(window.width, window.height, input.panelOpen, input.dockHeight, input.activeTabKind)
    };
}
