import { PANE_MIN_HEIGHT, PANE_MIN_WIDTH } from '../shared/layout.ts';
import { closePane, contentOf, halvable, layoutTree, movePane, paneIds, swapPanes, type PaneNode, type Rect, type Side } from './paneTree.ts';

/**
 * What a header dragged onto another pane does, and where the pane would land.
 *
 * Pure, next to `paneTree.ts`, for the reason `CLAUDE.md` gives: whether a drop
 * is allowed and what it does are rules, and the shell only draws the answer.
 * The shell decides which zone the pointer is in; everything after that is here.
 */

/** Where on a pane a header is dropped: an edge splits it, the centre swaps with it. */
export type DropZone = 'centre' | Side;

export const DROP_ZONES: readonly DropZone[] = ['centre', 'left', 'right', 'top', 'bottom'];

/**
 * For each pane a drag could land on, the rect the dragged pane would occupy
 * for each zone, or null where that drop is refused. The dragged pane has no
 * entry.
 */
export type DropTargets = Record<string, Record<DropZone, Rect | null>>;

/** The split a preview may nest in. It names a tree that is laid out and thrown away, never adopted. */
const PREVIEW_SPLIT = 'drop-preview';

/** The drop itself: the centre swaps the two panes, an edge moves the dragged one beside the target. */
export function dropPane(tree: PaneNode, from: string, to: string, zone: DropZone, splitId: string): PaneNode {
    return zone === 'centre' ? swapPanes(tree, from, to) : movePane(tree, from, to, zone, splitId);
}

/**
 * Whether a drop is allowed, in a tab laid out in `rect`.
 *
 * A swap always is, since nothing changes size. An edge is allowed when the
 * target could be halved on that axis, under the floor the menus' Split items
 * use (`halvable`). The target is measured with the dragged pane already gone,
 * because a sibling leaving gives its room to the panes beside it. So a pane
 * too narrow for Split Right can still take a drop from its neighbour.
 */
export function canDrop(tree: PaneNode, rect: Rect, from: string, to: string, zone: DropZone): boolean {
    if (from === to || !contentOf(tree, from) || !contentOf(tree, to)) return false;
    if (zone === 'centre') return true;
    const target = layoutTree(closePane(tree, from), rect).panes.get(to);
    if (!target) return false;
    return zone === 'left' || zone === 'right' ? halvable(target.width, PANE_MIN_WIDTH) : halvable(target.height, PANE_MIN_HEIGHT);
}

/**
 * Every drop a drag from `from` could make, answered once when the drag starts.
 *
 * The rect is the one the dragged pane would really be drawn at: the drop is
 * applied and the result laid out, not approximated. The shell never works out
 * a size, so the preview it draws cannot disagree with where the pane ends up.
 * A tab has a handful of panes, so the whole table is a few dozen tree walks.
 */
export function dropTargets(tree: PaneNode, rect: Rect, from: string): DropTargets {
    const targets: DropTargets = {};
    if (!contentOf(tree, from)) return targets;
    for (const to of paneIds(tree)) {
        if (to === from) continue;
        const landing = (zone: DropZone): Rect | null =>
            canDrop(tree, rect, from, to, zone) ? (layoutTree(dropPane(tree, from, to, zone, PREVIEW_SPLIT), rect).panes.get(from) ?? null) : null;
        targets[to] = { centre: landing('centre'), left: landing('left'), right: landing('right'), top: landing('top'), bottom: landing('bottom') };
    }
    return targets;
}
