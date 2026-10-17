import type { ReactNode } from 'react';
import type { DropZone, Rect } from '../shared/panes';

/**
 * Where a dragged pane, or a room's tab dragged out of chat's row, will land
 * if it is let go now.
 *
 * The box is the new rect after the drop, as main laid it out when the drag
 * began. For a pane that is moved, the preview and the result cannot
 * disagree. A room is opened as a pane added beside the target, and the
 * window may then grow for it as it does for Split Right, so its panel is the
 * size and on the side shown, but it and the game may sit further right or
 * lower. An edge shows the half of the target the pane will take; the centre
 * covers the whole target, since a swap puts it exactly there. It is the only
 * gold box on screen during a drag, so there is one thing to look at.
 *
 * A refused drop outlines the whole target instead, in the dim dashed line of
 * something unavailable, and says why. The drop does nothing there, and a box
 * that looked like the others would promise a split that is not coming. A
 * room has nothing to swap with, so its centre is always refused, and says
 * where a room goes instead.
 *
 * One element whatever the zone, so moving between zones slides the box rather
 * than replacing it.
 */
export default function DropIndicator({
    target,
    targetName,
    landing,
    zone,
    dragged,
    swaps
}: {
    target: Rect;
    targetName: string;
    /** Null where the drop is refused. */
    landing: Rect | null;
    zone: DropZone;
    /** The dragged pane's name, or the room's. */
    dragged: string;
    /** Whether the centre is a swap: true for a pane, false for a room, which has no pane to swap. */
    swaps: boolean;
}): ReactNode {
    const box = landing ?? target;
    const refused = zone === 'centre' && !swaps ? 'Drop on an edge' : 'Too small to split';
    return (
        <div
            aria-hidden="true"
            style={{ position: 'absolute', left: box.x, top: box.y, width: box.width, height: box.height }}
            className={`pointer-events-none flex items-center justify-center transition-[left,top,width,height] duration-100 ease-out ${
                landing ? 'border-2 border-gold bg-gold/15' : 'border-2 border-dashed border-faint bg-ink/30'
            }`}
        >
            <span className={`max-w-full truncate bg-ink/85 px-2 py-[2px] font-pixel text-[15px] ${landing ? 'text-gold' : 'text-faint'}`}>
                {landing ? (zone === 'centre' ? `Swap with ${targetName}` : dragged) : refused}
            </span>
        </div>
    );
}
