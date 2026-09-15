import type { ReactNode } from 'react';
import type { DropZone, Rect } from '../shared/panes';

/**
 * Where a dragged pane will land if it is let go now.
 *
 * The box is the pane's real rect after the drop, as main laid it out when the
 * drag began, so the preview and the result cannot disagree. An edge shows the
 * half of the target the pane will take; the centre covers the whole target,
 * since a swap puts it exactly there. It is the only gold box on screen during
 * a drag, so there is one thing to look at.
 *
 * A refused edge outlines the whole target instead, in the dim dashed line of
 * something unavailable, and says why. The drop does nothing there, and a box
 * that looked like the others would promise a split that is not coming.
 *
 * One element whatever the zone, so moving between zones slides the box rather
 * than replacing it.
 */
export default function DropIndicator({
    target,
    targetName,
    landing,
    zone,
    dragged
}: {
    target: Rect;
    targetName: string;
    /** Null where the drop is refused. */
    landing: Rect | null;
    zone: DropZone;
    /** The dragged pane's name. */
    dragged: string;
}): ReactNode {
    const box = landing ?? target;
    return (
        <div
            aria-hidden="true"
            style={{ position: 'absolute', left: box.x, top: box.y, width: box.width, height: box.height }}
            className={`pointer-events-none flex items-center justify-center transition-[left,top,width,height] duration-100 ease-out ${
                landing ? 'border-2 border-gold bg-gold/15' : 'border-2 border-dashed border-faint bg-ink/30'
            }`}
        >
            <span className={`max-w-full truncate bg-ink/85 px-2 py-[2px] font-pixel text-[15px] ${landing ? 'text-gold' : 'text-faint'}`}>
                {landing ? (zone === 'centre' ? `Swap with ${targetName}` : dragged) : 'Too small to split'}
            </span>
        </div>
    );
}
