import {
    DOCK_HEIGHT_MIN,
    MIN_CONTENT_HEIGHT,
    MIN_CONTENT_WIDTH,
    MIN_WINDOW_CONTENT_HEIGHT,
    MIN_WINDOW_CONTENT_WIDTH,
    PAGE_SEAM,
    PAGE_TOOLBAR_HEIGHT,
    PAGE_WIDTH_MIN,
    PANEL_WIDTH,
    PANEL_WIDTH_MIN,
    RAIL_WIDTH,
    STRIP_HEIGHT,
    type LayoutMode
} from '../shared/layout.ts';

/**
 * Window layout.
 *
 * Opening chrome widens the *window* instead of shrinking the content area, so
 * the game view's bounds stay pixel-identical: reloading or scaling that view
 * costs the login. That protection runs independently on both axes — the side
 * panel and the reference pane grow the window rightward, a bottom dock grows
 * it downward — via one 1-D solver, `fitAxis`, called once per axis. Widening is not always possible
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
    /** The reference pane's view width; 0 while it is closed or collapsed. */
    pageWidth: number;
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
    content: Rect;
    /** The grabbable strip of shell between the game and the pane. Null with the pane closed. */
    seam: Rect | null;
    /** Back, forward, reload and the page's title, above the pane. Null with the pane closed. */
    pageToolbar: Rect | null;
    /** The active reference page's view. Null while the pane is closed or collapsed. */
    page: Rect | null;
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

/** What the reference pane costs the window: its view plus the seam, or nothing at all. */
export function paneWidth(pageWidth: number): number {
    return pageWidth > 0 ? pageWidth + PAGE_SEAM : 0;
}

/**
 * The content extent a resize should record as the one to preserve across
 * chrome toggles: the window the user just dragged, less the chrome that is
 * standing in it. `extra` is the same quantity `fitAxis` adds back, so the two
 * have to be given the same chrome or a resize hands the game the panel's
 * pixels and the next layout grows the window by them again.
 *
 * The floor is the window's, not the canvas's, and that is the whole of why
 * these are functions rather than two `Math.max` calls at the call site. Floored
 * at the canvas, a window dragged below it records an extent larger than the
 * window it came from, and `fitAxis` — asked for a window that holds that
 * extent plus its chrome — dutifully grows the window back on the very next
 * layout. The drag springs back, and no minimum low enough to permit it makes
 * any difference.
 */
export function preservedWidth(windowWidth: number, extra: number): number {
    return Math.max(MIN_WINDOW_CONTENT_WIDTH, windowWidth - extra);
}

export function preservedHeight(windowHeight: number, extra: number): number {
    return Math.max(MIN_WINDOW_CONTENT_HEIGHT, windowHeight - extra);
}

/**
 * Splits a window of the given content size into strip, game, seam, pane,
 * panel, rail and dock.
 *
 * The columns are allocated in the order the window is asked to accommodate
 * them — rail, panel, seam, pane, and the game takes what is left — and then
 * the game claws pixels back until it has its canvas. Which column it claws
 * them from is the whole of the give-way rule, and the order is the reverse of
 * how much the user asked for what is in it:
 *
 *   1. The panel first, down to PANEL_WIDTH_MIN but no further. It is a menu:
 *      the Guides list is how a page got opened, and shutting it is one click
 *      on the rail. What it will not do is vanish while the user has it open —
 *      the rail tool would sit lit with nothing beside it, which reads as a
 *      broken window rather than a full one.
 *   2. Then the pane's slack, down to PAGE_WIDTH_MIN but no further. Past that
 *      it stops being a page anyone can read, and a pane reduced to a sliver
 *      is worse than a game the player can scroll.
 *   3. Past that the game gives way below its canvas, and the shell's push
 *      note says so. Collapsing the pane is the way back, and is a click.
 *
 * What the game is owed is `contentWidth`, capped at its canvas — and the cap
 * is the whole of why that argument is here. A flat MIN_CONTENT_WIDTH cannot
 * tell "the panel has taken the game's canvas" from "the user chose a window
 * smaller than the canvas", and bills the panel for both: open the sidebar in
 * a window dragged under 765 and the window would grow by PANEL_WIDTH to make
 * room, the claw would take all of it straight back, and the sidebar the user
 * just asked for would be 0 wide. Asking only to be made whole leaves those
 * pixels where they were widened to go.
 *
 * With the pane closed this is the arithmetic that was here before it —
 * `max(MIN_CONTENT_WIDTH, width - sideWidth(panelOpen))` for the game, the
 * rest to the panel — for any window at least `MIN_CONTENT_WIDTH + RAIL_WIDTH`
 * wide. Below that the two part company: the old formula handed the game its
 * full canvas and left the rail whatever was left over, including nothing,
 * while this allocates the rail first and lets the game come out under its
 * floor. That is not a hypothetical range — `MIN_WINDOW_CONTENT_WIDTH` puts
 * the window's own floor well inside it — and it is why the rail is allocated
 * first: it is the only way back to any of the chrome, so it is the one column
 * that never gives way.
 */
export function splitWindow(width: number, height: number, panelOpen: boolean, dockHeight: number, pageWidth: number, contentWidth: number): Rects {
    // Allocated in priority order out of one running remainder, so the columns
    // always sum to the window exactly and none of them can come out negative.
    const railW = Math.min(RAIL_WIDTH, width);
    let left = Math.max(0, width - railW);
    let panelW = panelOpen ? Math.min(PANEL_WIDTH, left) : 0;
    left -= panelW;
    const seamW = pageWidth > 0 ? Math.min(PAGE_SEAM, left) : 0;
    left -= seamW;
    let pageW = seamW > 0 ? Math.min(Math.max(0, pageWidth), left) : 0;
    left -= pageW;
    let gameW = left;

    const owed = Math.min(MIN_CONTENT_WIDTH, contentWidth);
    const claw = (from: number, floor: number): number => {
        if (gameW >= owed || from <= floor) return from;
        const give = Math.min(owed - gameW, from - floor);
        gameW += give;
        return from - give;
    };
    panelW = claw(panelW, PANEL_WIDTH_MIN);
    pageW = claw(pageW, PAGE_WIDTH_MIN);

    const below = Math.max(0, height - STRIP_HEIGHT);

    // Unlike x, where the panel is one of several tools and gives way first,
    // the dock is the conversation the user just asked to see: a chat window
    // silently reduced to nothing is worse than a game canvas shorter by
    // the pixels involved. So the dock shrinks from its request first, but
    // never below DOCK_HEIGHT_MIN, while content holds at MIN_CONTENT_HEIGHT;
    // only once the dock is at its own floor does content give way below its.
    const dockH = dockHeight === 0 ? 0 : Math.max(DOCK_HEIGHT_MIN, Math.min(dockHeight, below - MIN_CONTENT_HEIGHT));
    // The dock spans under the pane and the panel as well as the game (it
    // stops at the rail), so both are shortened to make room for it or they
    // would paint on top of each other. The rail is beside the dock rather
    // than above it, so it alone keeps its full height.
    const contentH = Math.max(0, below - dockH);

    const pageX = gameW + seamW;
    // The toolbar comes out of the pane's own height rather than the window's,
    // which is what keeps the game rect identical whether the pane is open or
    // shut — the promise the whole side-by-side layout is for.
    const toolbarH = Math.min(PAGE_TOOLBAR_HEIGHT, contentH);

    return {
        strip: { x: 0, y: 0, width, height: STRIP_HEIGHT },
        content: { x: 0, y: STRIP_HEIGHT, width: gameW, height: contentH },
        seam: seamW > 0 ? { x: gameW, y: STRIP_HEIGHT, width: seamW, height: contentH } : null,
        pageToolbar: pageW > 0 ? { x: pageX, y: STRIP_HEIGHT, width: pageW, height: toolbarH } : null,
        page: pageW > 0 ? { x: pageX, y: STRIP_HEIGHT + toolbarH, width: pageW, height: contentH - toolbarH } : null,
        panel: panelW > 0 ? { x: pageX + pageW, y: STRIP_HEIGHT, width: panelW, height: contentH } : null,
        rail: { x: pageX + pageW + panelW, y: STRIP_HEIGHT, width: railW, height: below },
        dock: dockH > 0 ? { x: 0, y: STRIP_HEIGHT + contentH, width: width - railW, height: dockH } : null
    };
}

/**
 * How much of the dock a window's minimum *height* may carry.
 *
 * That minimum exists for one reason: to stop the window being dragged short
 * enough to crush the content below MIN_WINDOW_CONTENT_HEIGHT while the dock
 * holds pixels of its own. The base here is the window's floor and not the
 * canvas because that is the base serverWindow.ts adds the result to: give the
 * two different bases and the floor can come out standing above the window's
 * own height, which is a window that can no longer be shrunk at all. So it is
 * built from the dock the layout actually granted
 * — `splitWindow` above clamps the request whenever the window is too short
 * for it — and never from more room than the window it just produced has
 * above that floor.
 *
 * Both halves bite on a short display. A 1366x768 screen with a taskbar
 * leaves about 728px of window: the default 200px dock cannot fit, so the fit
 * lands in `push` and the grant is 137, exactly the slack the window has. A
 * floor built from the 200 would stand some 40px taller than the whole work
 * area, and the next drag would carry the composer and the grip off the
 * bottom of the screen. Shorter still and the content is already at the window
 * floor — on y the dock outranks it — and a floor cannot protect a floor that
 * has already given way, so the shortfall comes off the dock's share rather
 * than out of the screen.
 */
export function dockOnFloor(dockHeight: number, windowHeight: number): number {
    return Math.max(0, Math.min(dockHeight, windowHeight - STRIP_HEIGHT - MIN_WINDOW_CONTENT_HEIGHT));
}

export function computeLayout(input: LayoutInput): LayoutResult {
    const x = fitAxis({
        origin: input.window.x,
        size: input.window.width,
        workOrigin: input.workArea.x,
        workSize: input.workArea.width,
        content: input.contentWidth,
        extra: sideWidth(input.panelOpen) + paneWidth(input.pageWidth),
        minContent: MIN_CONTENT_WIDTH,
        canResize: input.canResize
    });

    const y = fitAxis({
        origin: input.window.y,
        size: input.window.height,
        workOrigin: input.workArea.y,
        workSize: input.workArea.height,
        content: input.contentHeight,
        extra: STRIP_HEIGHT + input.dockHeight,
        minContent: MIN_CONTENT_HEIGHT,
        canResize: input.canResize
    });

    const window: Rect = { x: x.origin, y: y.origin, width: x.size, height: y.size };

    return {
        mode: { x: x.mode, y: y.mode },
        window,
        ...splitWindow(window.width, window.height, input.panelOpen, input.dockHeight, input.pageWidth, input.contentWidth)
    };
}
