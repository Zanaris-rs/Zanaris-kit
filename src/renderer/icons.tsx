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
 * Hiscores. Three bars climbing to the right, sharing one baseline, with the
 * tallest in gold — a table read at a glance rather than a trophy or a crown,
 * neither of which the client has a sprite for. Flat fills on the shared
 * outline, like the rest of the tools.
 */
export function Bars(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
            <rect x="2.5" y="10" width="3.6" height="5.5" fill="#ece7dc" stroke={OUTLINE} strokeWidth="1.3" strokeLinejoin="round" />
            <rect x="7.2" y="7" width="3.6" height="8.5" fill="#ece7dc" stroke={OUTLINE} strokeWidth="1.3" strokeLinejoin="round" />
            <rect x="11.9" y="4" width="3.6" height="11.5" fill="#ffe139" stroke={OUTLINE} strokeWidth="1.3" strokeLinejoin="round" />
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
 * Close a room. A filled diagonal cross on the shared outline, a sprite like
 * the tools rather than a stroked chrome glyph, because it sits among the
 * dock's own furniture beside the move control rather than in the strip.
 *
 * It fills about ten of its eighteen pixels. The other sprites run edge to
 * edge because they are pictures of things; this one is a mark, and a mark
 * drawn to the same bounds as a globe reads as heavier than everything it
 * sits beside rather than as the smallest control in the row.
 */
export function CloseRoom(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
            <path
                d="M6.3 3.6L9 6.3L11.7 3.6L14.4 6.3L11.7 9L14.4 11.7L11.7 14.4L9 11.7L6.3 14.4L3.6 11.7L6.3 9L3.6 6.3Z"
                fill="#ece7dc"
                stroke={OUTLINE}
                strokeWidth="1.3"
                strokeLinejoin="round"
            />
        </svg>
    );
}

/*
 * ── the reference links ────────────────────────────────────────────────────
 *
 * One sprite per link in the Guides list, in the same flat-fill-on-one-outline
 * language as the rail's tools. Four of them are lifted from the design sheet
 * rather than redrawn — the open book, the folded map, the item cabinet and
 * the ruled page are `design/Rail.dc.html`'s own paths — and the rest are
 * built from the same vocabulary: parchment cream, gold for the thing being
 * counted, one 1.2–1.3px outline, nothing stroked that could be filled.
 */

/** Forums. A notice pinned to a board — not a speech bubble, which Chat already owns. */
function Forums(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
            <rect x="2" y="3.5" width="14" height="11" fill="#5a4a38" stroke={OUTLINE} strokeWidth="1.2" />
            <rect x="4" y="5.5" width="7" height="7" fill="#ece7dc" stroke={OUTLINE} strokeWidth="1.1" />
            <path d="M5.5 8h4M5.5 10.2h2.5" stroke={OUTLINE} strokeWidth="1.1" />
            <circle cx="13.5" cy="7" r="1.4" fill="#a70700" stroke={OUTLINE} strokeWidth="1" />
        </svg>
    );
}

/** Coordinates. A sextant's reticle: a gold disc scored north-south and east-west. */
function Coordinates(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
            <circle cx="9" cy="9" r="6.3" fill="#c8a86a" stroke={OUTLINE} strokeWidth="1.3" />
            <path d="M9 1.8v14.4M1.8 9h14.4" stroke={OUTLINE} strokeWidth="1.2" />
            <circle cx="9" cy="9" r="1.7" fill="#a70700" stroke={OUTLINE} strokeWidth="1" />
        </svg>
    );
}

/** Clue help. A rolled scroll with its two rods, the shape the clue itself comes on. */
function ClueHelp(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
            <rect x="4.5" y="2.5" width="9" height="13" fill="#ece7dc" stroke={OUTLINE} strokeWidth="1.2" />
            <path d="M6.5 6h5M6.5 9h5M6.5 12h3" stroke={OUTLINE} strokeWidth="1.2" />
            <rect x="2.5" y="1.5" width="13" height="2" rx="1" fill="#c8a86a" stroke={OUTLINE} strokeWidth="1.1" />
            <rect x="2.5" y="14.5" width="13" height="2" rx="1" fill="#c8a86a" stroke={OUTLINE} strokeWidth="1.1" />
        </svg>
    );
}

/** Puzzle solver. The sliding-tile box, one tile short of solved. */
function Puzzle(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
            <rect x="2.5" y="2.5" width="13" height="13" fill="#5a4a38" stroke={OUTLINE} strokeWidth="1.2" />
            <rect x="4" y="4" width="4.5" height="4.5" fill="#ece7dc" stroke={OUTLINE} strokeWidth="1" />
            <rect x="9.5" y="4" width="4.5" height="4.5" fill="#ece7dc" stroke={OUTLINE} strokeWidth="1" />
            <rect x="4" y="9.5" width="4.5" height="4.5" fill="#ece7dc" stroke={OUTLINE} strokeWidth="1" />
        </svg>
    );
}

/** World map. The folded map from the design sheet, creases and all. */
function WorldMap(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
            <path d="M2 4l4.5-2 5 2 4.5-2v12l-4.5 2-5-2L2 16z" fill="#c8a86a" stroke={OUTLINE} strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M6.5 2v12M11.5 4v12" stroke={OUTLINE} strokeWidth="1.2" />
        </svg>
    );
}

/** Markets. A stack of coins, which is what the page is a price for. */
function Markets(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
            <ellipse cx="9" cy="13" rx="6" ry="2.4" fill="#ffe139" stroke={OUTLINE} strokeWidth="1.2" />
            <ellipse cx="9" cy="9.5" rx="6" ry="2.4" fill="#ffe139" stroke={OUTLINE} strokeWidth="1.2" />
            <ellipse cx="9" cy="6" rx="6" ry="2.4" fill="#ffe139" stroke={OUTLINE} strokeWidth="1.2" />
        </svg>
    );
}

/** Skill guides. The ruled page from the design sheet, with its corner turned. */
function SkillGuides(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
            <path d="M4 2h6.5L14 5.2V16H4z" fill="#ece7dc" stroke={OUTLINE} strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M6.5 8h5M6.5 11h5" stroke={OUTLINE} strokeWidth="1.3" />
        </svg>
    );
}

/** Skills calculator. An abacus: a gold bead on each of three wires. */
function Calculator(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
            <rect x="2.5" y="2.5" width="13" height="13" fill="#5a4a38" stroke={OUTLINE} strokeWidth="1.2" />
            <path d="M4 6h10M4 9h10M4 12h10" stroke={OUTLINE} strokeWidth="1.1" />
            <rect x="5" y="4.7" width="2.6" height="2.6" fill="#ffe139" stroke={OUTLINE} strokeWidth="1" />
            <rect x="9.5" y="7.7" width="2.6" height="2.6" fill="#ffe139" stroke={OUTLINE} strokeWidth="1" />
            <rect x="6.5" y="10.7" width="2.6" height="2.6" fill="#ffe139" stroke={OUTLINE} strokeWidth="1" />
        </svg>
    );
}

/** Bestiary. A horned head, which is the one thing every drop table has in common. */
function Bestiary(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
            <path d="M3 2.5c1.6.4 2.6 1.6 3 3M15 2.5c-1.6.4-2.6 1.6-3 3" stroke={OUTLINE} strokeWidth="1.6" fill="none" />
            <path d="M4.5 7.5A4.5 4.5 0 0 1 9 5a4.5 4.5 0 0 1 4.5 2.5c0 4-2 8-4.5 8s-4.5-4-4.5-8z" fill="#a89c86" stroke={OUTLINE} strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M7 8.5h1.2M9.8 8.5H11" stroke="#a70700" strokeWidth="1.8" />
        </svg>
    );
}

/** Item database. The item cabinet from the design sheet, drawers and all. */
function ItemDb(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
            <rect x="3.5" y="2" width="11" height="14" fill="#a89c86" stroke={OUTLINE} strokeWidth="1.2" />
            <rect x="5.5" y="4" width="7" height="3" fill={OUTLINE} />
            <path d="M6 10.5h1.5M10.5 10.5h1.5M6 13.5h1.5M10.5 13.5h1.5" stroke={OUTLINE} strokeWidth="1.6" />
        </svg>
    );
}

/** Whatever the catalog did not name: a plain page, so a hand-added link still has a row that lines up. */
function PageLink(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
            <rect x="3.5" y="2.5" width="11" height="13" fill="#ece7dc" stroke={OUTLINE} strokeWidth="1.2" />
            <path d="M6 6h6M6 9h6M6 12h3.5" stroke={OUTLINE} strokeWidth="1.2" />
        </svg>
    );
}

export function Book(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
            <path
                d="M9 4.5C7.6 3 5.6 2.6 2.5 3v10.5c3-.4 5 0 6.5 1.5 1.5-1.5 3.5-1.9 6.5-1.5V3c-3.1-.4-5.1 0-6.5 1.5z"
                fill="#ece7dc"
                stroke={OUTLINE}
                strokeWidth="1.2"
                strokeLinejoin="round"
            />
            <path d="M9 4.5v10.5" stroke={OUTLINE} strokeWidth="1.2" />
        </svg>
    );
}

const LINK_ICONS: Record<string, () => ReactNode> = {
    forums: Forums,
    coordinates: Coordinates,
    cluehelp: ClueHelp,
    puzzle: Puzzle,
    worldmap: WorldMap,
    markets: Markets,
    questguides: Book,
    skillguides: SkillGuides,
    calculator: Calculator,
    bestiary: Bestiary,
    itemdb: ItemDb
};

/** The sprite a catalog link names, or the plain page when it names nothing this kit knows. */
export function linkIcon(icon: string | undefined): ReactNode {
    const Sprite = (icon === undefined ? undefined : LINK_ICONS[icon]) ?? PageLink;
    return <Sprite />;
}

/*
 * ── the pane's chrome ──────────────────────────────────────────────────────
 *
 * Stroked in `currentColor`, like the panel toggle and unlike the sprites:
 * these are controls on the stone rather than pictures of things, and they
 * take the colour of the row they sit in so a disabled one goes quiet with it.
 */

/** Back and forward: one triangle, turned. Two near-identical glyphs would be two to keep in step. */
export function NavArrow({ forward = false }: { forward?: boolean }): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={forward ? { transform: 'scaleX(-1)' } : undefined}>
            <path d="M11.5 3.5L5 9l6.5 5.5z" fill="currentColor" />
        </svg>
    );
}

/** Reload. An open circle with an arrowhead on the end it leaves, which is what makes it a cycle rather than a ring. */
export function Reload(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M14 9a5 5 0 1 1-1.6-3.7" strokeLinecap="round" />
            <path d="M14.3 2.6V6h-3.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

/** Open this link outside the kit. An arrow leaving a frame — the browser's own sign for it, drawn in the stone's stroke. */
export function OpenExternal(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" shapeRendering="crispEdges">
            <path d="M9 4H4v10h10V9" strokeLinecap="round" />
            <path d="M10.5 3.5H14.5V7.5M14 4l-5 5" strokeLinecap="round" strokeLinejoin="round" shapeRendering="geometricPrecision" />
        </svg>
    );
}
