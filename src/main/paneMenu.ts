import { PANE_MIN_HEIGHT, PANE_MIN_WIDTH, SEAM } from '../shared/layout.ts';
import { contentOf, parentSplitOf, type PaneNode } from './paneTree.ts';

/**
 * What a right-click on a pane offers.
 *
 * Pure and tested for the usual reason, and for one specific to a menu: an item
 * that is offered and then refused is worse than one that was never offered,
 * and whether a split is legal depends on the same minimums the solver
 * enforces. Working that out here means the menu and the layout cannot
 * disagree — the alternative is the shell guessing, which `CLAUDE.md` calls a
 * defect rather than a shortcut.
 */

export interface PaneMenuItem {
    id: 'split-x' | 'split-y' | 'even-out' | 'close';
    label: string;
    enabled: boolean;
}

/** Whether one extent can hold two panes and the seam between them. */
function halvable(extent: number, floor: number): boolean {
    return extent >= floor * 2 + SEAM;
}

export function paneMenuItems(tree: PaneNode, paneId: string, rect: { width: number; height: number }): PaneMenuItem[] {
    const isGame = contentOf(tree, paneId)?.kind === 'game';
    return [
        { id: 'split-x', label: 'Split Right', enabled: halvable(rect.width, PANE_MIN_WIDTH) },
        { id: 'split-y', label: 'Split Down', enabled: halvable(rect.height, PANE_MIN_HEIGHT) },
        // Nothing to even out when the pane is the whole tab: there are no
        // siblings to share with, and the item would be a no-op wearing the
        // same face as the working one.
        { id: 'even-out', label: 'Even Out', enabled: parentSplitOf(tree, paneId) !== null },
        {
            id: 'close',
            // Named for what it costs. Closing the game destroys its view and
            // disconnects the player — there is a confirm behind it, but a menu
            // item that reads the same as the harmless one is a menu item that
            // gets clicked by accident first and read second.
            label: isGame ? 'Close Game' : 'Close Pane',
            // Always: the last pane in a tab empties rather than vanishing, so
            // there is no state this can leave the window in that it cannot
            // draw.
            enabled: true
        }
    ];
}
