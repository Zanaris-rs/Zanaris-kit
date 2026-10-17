import type { DropZone, Rect } from './panes.ts';

/**
 * Which part of a pane a dragged header is over, when a press is a drag, and
 * when it has ended without a drop. Hit-testing and the pointer's own
 * gesture, the same kind of question as which pane the pointer is in, so the
 * shell asks them on every move without a round trip. What a zone does,
 * whether it is allowed and where the pane would land are main's
 * (`main/paneDrop.ts`).
 */

/**
 * How far in from an edge, as a share of the pane, a drop still splits on
 * that edge. A quarter leaves the middle half each way for a swap, which keeps
 * both easy to hit: splitting has most of the pane, and the centre is still
 * the biggest single zone.
 */
export const DROP_EDGE_BAND = 0.25;

/** Pixels a pressed header has to travel before the press is a drag rather than a click. */
export const DRAG_START_DISTANCE = 4;

/**
 * The zone under a point: the nearest edge when it is within the band, the
 * centre otherwise. Distances are shares of the pane along the axis each edge
 * faces, so a wide pane's side bands are as easy to find as its top and bottom.
 */
export function zoneAt(rect: Rect, x: number, y: number): DropZone {
    if (rect.width <= 0 || rect.height <= 0) return 'centre';
    const across = (x - rect.x) / rect.width;
    const down = (y - rect.y) / rect.height;
    const edges: [DropZone, number][] = [
        ['left', across],
        ['right', 1 - across],
        ['top', down],
        ['bottom', 1 - down]
    ];
    const [zone, distance] = edges.reduce((best, edge) => (edge[1] < best[1] ? edge : best));
    return distance < DROP_EDGE_BAND ? zone : 'centre';
}

/** Whether a pointer pressed at `start` has moved far enough to be dragging. */
export function draggedFar(start: { x: number; y: number }, now: { x: number; y: number }): boolean {
    return Math.hypot(now.x - start.x, now.y - start.y) >= DRAG_START_DISTANCE;
}

/**
 * Whether a press held on a drag handle — a pane's header or a room's tab, a
 * drag or not yet one — has ended without a drop, for one of three reasons:
 *
 * - A move came with no button down (`buttons` 0). Its release never reached
 *   the shell: the handle went while it was held, or a fast flick let go over
 *   a game or a page, whose view takes the pointer. Left held, the press
 *   would start a drag on the next hover and hide every view, the game's
 *   included, with nothing pressed.
 * - It is a room's tab's, and no row on screen lists the room any more: it
 *   closed, or its person took a new name. The tab held the pointer, and its
 *   events went with it.
 * - It is a drag, and the panes are no longer laid out as when it began
 *   (`layout`): its targets were answered for the old rects.
 *
 * `buttons` is null where no pointer event is being read, as when the layout
 * or the rows change.
 */
export function pressEnded(
    press: { room: string | null; dragging: boolean; layout: string },
    now: { layout: string; rows: readonly string[]; buttons: number | null }
): boolean {
    if (now.buttons === 0) return true;
    if (press.room !== null && !now.rows.includes(press.room)) return true;
    return press.dragging && press.layout !== now.layout;
}
