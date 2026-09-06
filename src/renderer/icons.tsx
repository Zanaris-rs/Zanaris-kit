import type { ReactNode } from 'react';

/*
 * The chrome's glyphs, taken from the design sheet rather than drawn here.
 *
 * The client's interface tabs are sprites: flat filled shapes sharing one dark
 * outline. Stroked outlines of even weight are the giveaway of a modern icon
 * set, and beside pixel type they read as borrowed from somewhere else. So the
 * tools are painted, not outlined, and only the chrome glyphs stay strokes.
 */

/** The outline every sprite shares, as sprite art does. */
const OUTLINE = '#3a3428';

/** Worlds. A lit sea with pale meridians, so it stays legible at 78% opacity when the tab is shut. */
export function Globe(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
            <circle cx="9" cy="9" r="7" fill="#4a7fa8" stroke={OUTLINE} strokeWidth="1.3" />
            <path d="M2 9h14" stroke="#cfe3ef" strokeWidth="1.2" />
            <path
                d="M9 2c2.6 2.6 2.6 11.4 0 14M9 2c-2.6 2.6-2.6 11.4 0 14"
                stroke="#cfe3ef"
                strokeWidth="1.2"
                fill="none"
            />
        </svg>
    );
}

/**
 * The panel toggle. Chrome rather than a tool, so it stays a stroked glyph in
 * the strip's own colour instead of becoming a sprite. It is drawn in the same
 * 18x18 box as the sprites at 1:1, which keeps its stroke the width the design
 * shows: scaling a 2px square-cut stroke is what makes it go soft.
 */
export function PanelToggle(): ReactNode {
    return (
        <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            shapeRendering="crispEdges"
        >
            <rect x="3" y="4" width="12" height="10" />
            <path d="M11.5 4v10" />
        </svg>
    );
}
