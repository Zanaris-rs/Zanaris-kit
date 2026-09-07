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

/**
 * Chat. A cream speech bubble with its two lines cut out of the fill rather
 * than laid over it, so the glyph stays one flat shape on the shared outline —
 * the same trick the client's own sprites use to read at 18px.
 */
export function Chat(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
            <path d="M2 3h14v9H9l-4 3v-3H2z" fill="#ece7dc" stroke={OUTLINE} strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M5 6.5h8M5 9.5h5" stroke={OUTLINE} strokeWidth="1.3" />
        </svg>
    );
}

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

/** Single player. A lit hearth on the stone: a warm flame over a dark grate, one flat sprite on the shared outline. */
export function Hearth(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
            <rect x="3" y="12" width="12" height="3.5" fill="#5a4a38" stroke={OUTLINE} strokeWidth="1.3" />
            <path d="M9 2.5c1.2 2 3.6 3.4 3.6 6.2A3.6 3.6 0 0 1 9 12.2a3.6 3.6 0 0 1-3.6-3.5c0-1.4.6-2.2 1.3-3 .1 1.1.6 1.7 1.3 1.9C7.7 5.4 8.2 3.8 9 2.5z" fill="#ffe139" stroke={OUTLINE} strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M9 7.4c.6 1 1.4 1.6 1.4 2.6A1.4 1.4 0 0 1 9 11.3a1.4 1.4 0 0 1-1.4-1.3c0-.9.8-1.6 1.4-2.6z" fill="#a70700" />
        </svg>
    );
}

/**
 * Move chat to the other edge. A block arrow driving into the edge it is aimed
 * at — a sprite like the tools rather than a stroked chrome glyph, because it
 * sits among the dock's own furniture rather than in the strip.
 *
 * One sprite serves both directions: a quarter turn is the whole difference
 * between "to the side" and "to the bottom", and two near-identical arrows
 * would be two arrows to keep in step. The label names the destination; this
 * only has to point at it.
 */
export function MoveChat({ down = false }: { down?: boolean }): ReactNode {
    return (
        <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            aria-hidden="true"
            fill="none"
            style={down ? { transform: 'rotate(90deg)' } : undefined}
        >
            <path d="M2 6.5h5V3.5L12 9l-5 5.5V11.5H2z" fill="#ece7dc" stroke={OUTLINE} strokeWidth="1.3" strokeLinejoin="round" />
            <rect x="14" y="2.5" width="2" height="13" fill="#ece7dc" stroke={OUTLINE} strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
    );
}
