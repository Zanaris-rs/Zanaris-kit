import type { SidebarMode } from '../shared/ipc';

/**
 * Sidebar layout.
 *
 * The sidebar is a always-visible rail that expands into a panel. Opening it
 * widens the *window* by the panel width so the game area stays pixel-identical
 * — the game view's bounds never change, which matters because recreating or
 * resizing that view would cost the cache, the login and the ISAAC session.
 *
 * Widening isn't always possible (maximised, fullscreen, or no room on the
 * display). Those cases fall back to 'push', where the game area shrinks
 * instead. The mode is reported to the UI rather than silently substituted.
 *
 * All rects are CONTENT bounds, not window bounds, so height is consistent
 * between the window and the views inside it.
 */

export const RAIL_WIDTH = 48;
export const PANEL_WIDTH = 280;
export const MIN_GAME_WIDTH = 480;

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface LayoutInput {
    open: boolean;
    /** Current window content bounds, in screen coordinates. */
    window: Rect;
    /** Usable area of the display the window is on. */
    workArea: Rect;
    /** The width the game area should preserve. */
    gameWidth: number;
    /** False when maximised or fullscreen — the window cannot be widened. */
    canResize: boolean;
}

export interface LayoutResult {
    mode: SidebarMode;
    /** Content bounds to apply to the window. */
    window: Rect;
    /** Bounds for the game view, relative to window content. */
    game: Rect;
    /** Bounds for the shell view, relative to window content. */
    shell: Rect;
}

export function sidebarWidth(open: boolean): number {
    return open ? RAIL_WIDTH + PANEL_WIDTH : RAIL_WIDTH;
}

export function computeLayout(input: LayoutInput): LayoutResult {
    const sw = sidebarWidth(input.open);
    const height = input.window.height;

    const pushLayout = (): LayoutResult => {
        const gameW = Math.max(MIN_GAME_WIDTH, input.window.width - sw);
        const shellW = Math.max(0, input.window.width - gameW);
        return {
            mode: 'push',
            window: { ...input.window },
            game: { x: 0, y: 0, width: gameW, height },
            shell: { x: gameW, y: 0, width: shellW, height }
        };
    };

    if (!input.canResize) return pushLayout();

    const desiredWidth = input.gameWidth + sw;
    if (desiredWidth > input.workArea.width) return pushLayout();

    // Keep the window on screen: shift left rather than growing off the edge.
    let x = input.window.x;
    const rightEdge = input.workArea.x + input.workArea.width;
    if (x + desiredWidth > rightEdge) x = rightEdge - desiredWidth;
    if (x < input.workArea.x) x = input.workArea.x;

    return {
        mode: 'widen',
        window: { x, y: input.window.y, width: desiredWidth, height },
        game: { x: 0, y: 0, width: input.gameWidth, height },
        shell: { x: input.gameWidth, y: 0, width: sw, height }
    };
}
