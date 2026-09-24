import type { Rect, Size } from './paneTree.ts';

/**
 * How a window grows to hold a pane it has just been given, on the display it
 * is on.
 *
 * Pure, for the reason `CLAUDE.md` gives: `serverWindow` cannot be tested, so
 * the geometry it acts on is worked out here, and all it does is ask the
 * window where it is and tell it where to go. Frames are the window's outer
 * bounds and work areas the display's less its menu bar and dock, both in
 * screen pixels.
 */

/**
 * How much bigger `frame` can get and still fit on the display.
 *
 * As big as the work area, wherever the window sits on it: `grownFrame` moves
 * a window that would run off the edge back onto it, so the room to its right
 * is not the limit, the display is.
 */
export function roomFor(frame: Rect, workArea: Rect): Size {
    return { width: Math.max(0, workArea.width - frame.width), height: Math.max(0, workArea.height - frame.height) };
}

/**
 * `frame` grown by `by`, to the right and down, then moved left and up only as
 * far as it takes to end at the work area's edge.
 *
 * A window already hanging off the left or the top is left there rather than
 * pulled further: the player put it there, and moving it is for keeping the
 * new pane on screen, not for tidying the window.
 */
export function grownFrame(frame: Rect, workArea: Rect, by: Size): Rect {
    const width = frame.width + by.width;
    const height = frame.height + by.height;
    return {
        x: Math.max(Math.min(frame.x, workArea.x + workArea.width - width), Math.min(frame.x, workArea.x)),
        y: Math.max(Math.min(frame.y, workArea.y + workArea.height - height), Math.min(frame.y, workArea.y)),
        width,
        height
    };
}
