import type { Edge, Rect, Size } from './paneTree.ts';

/**
 * How a window grows to hold a pane it has just been given, shrinks to give a
 * closed one's room back, or is sized around a setup, on the display it is on.
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
 * new pane on screen, not for tidying the window. A negative `by` shrinks it
 * from the right and the bottom, where it is (`serverWindow.sizeWindow` relies
 * on this).
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

/**
 * How much a window whose tab is `tree` has to change for its tab to be `want`
 * — what opening a setup sizes it by (`paneTree.arrangeForGame`), for
 * `grownFrame` to act on.
 *
 * Each side grows no further than `room`, the display's (`roomFor`), and
 * shrinks as far as `want` asks: shrinking always fits. A negative answer is
 * a shrink, which `grownFrame` takes from the right and the bottom.
 */
export function sizedBy(tree: Size, want: Size, room: Size): Size {
    return { width: Math.min(want.width - tree.width, room.width), height: Math.min(want.height - tree.height, room.height) };
}

/**
 * `frame` less `by`, taken off at `edge`: the window giving back a closed
 * pane's room (`paneTree.closeGivingBack`). A pane that was left of the game, or
 * above it, moves the window's left or top edge in, so the game stays where it
 * was on screen; one right of it or below moves the right or bottom edge.
 */
export function shrunkFrame(frame: Rect, by: Size, edge: Edge): Rect {
    return {
        x: edge === 'left' ? frame.x + by.width : frame.x,
        y: edge === 'top' ? frame.y + by.height : frame.y,
        width: frame.width - by.width,
        height: frame.height - by.height
    };
}
