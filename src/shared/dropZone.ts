import type { DropZone, Rect } from './panes.ts';

/**
 * Which part of a pane a dragged header is over. Hit-testing, the same kind of
 * question as which pane the pointer is in, so the shell asks it on every move
 * without a round trip. What a zone does, whether it is allowed and where the
 * pane would land are main's (`main/paneDrop.ts`).
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
