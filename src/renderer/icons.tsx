import type { ReactNode } from 'react';

/*
 * The chrome's glyphs, taken from the design sheet rather than drawn here.
 *
 * The client's interface tabs are sprites: flat filled shapes sharing one dark
 * outline. Stroked outlines of even weight are the giveaway of a modern icon
 * set, and beside pixel type they read as borrowed from somewhere else. So the
 * sprites are painted, not outlined, and only the chrome glyphs stay strokes.
 */

/** The outline every sprite shares, as sprite art does. */
const OUTLINE = '#3a3428';

/** The new-tab control. Drawn as the same thick, outlined cross the close is, turned a quarter — they are the same pair of gestures and should read as a pair. */
export function Plus(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
            <path d="M7.2 3.2h3.6v4h4v3.6h-4v4H7.2v-4h-4V7.2h4Z" fill="#ece7dc" stroke={OUTLINE} strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
    );
}

/**
 * Close a tab: a window strip page, or a chat channel. A filled diagonal cross
 * on the shared outline, a sprite like the links' rather than a stroked chrome
 * glyph, so it matches the Plus beside the strip's tabs.
 *
 * It fills about ten of its eighteen pixels. The other sprites run edge to
 * edge because they are pictures of things; this one is a mark, and a mark
 * drawn to the same bounds as a picture reads as heavier than everything it
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
 * One sprite per link in the launcher, in the same flat-fill-on-one-outline
 * language the old tool rail's sprites were drawn in. Four of them are lifted
 * from the design sheet rather than redrawn — the open book, the folded map,
 * the item cabinet and the ruled page are `design/Rail.dc.html`'s own paths —
 * and the rest are built from the same vocabulary: parchment cream, gold for
 * the thing being counted, one 1.2–1.3px outline, nothing stroked that could be
 * filled.
 */

/** Forums. A notice pinned to a board — not a speech bubble, which reads as chat. */
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

/** The pane header's dropdown. A solid wedge, since the menu it opens is the system's and a hairline glyph would not read at 32px of stone. */
export function Caret(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M4.5 7h9L9 12z" fill="currentColor" />
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

/** Settings: a gear, stroked in the button's own colour like the other chrome glyphs. */
export function Gear(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
            <path d="M7.6 2.2h2.8l.4 1.9 1.4.6 1.6-1.1 2 2-1.1 1.6.6 1.4 1.9.4v2.8l-1.9.4-.6 1.4 1.1 1.6-2 2-1.6-1.1-1.4.6-.4 1.9H7.6l-.4-1.9-1.4-.6-1.6 1.1-2-2 1.1-1.6-.6-1.4-1.9-.4V7.6l1.9-.4.6-1.4-1.1-1.6 2-2 1.6 1.1 1.4-.6Z" />
            <circle cx="9" cy="9" r="2.3" />
        </svg>
    );
}

/*
 * ── the Timers tool's controls ─────────────────────────────────────────────
 *
 * Chrome glyphs like the page toolbar's, in the stone's current colour, so a
 * row of clocks reads as a row of quiet controls beside the digits rather than
 * a stack of labelled buttons. Reset is `Reload`: the same cycle, back to the
 * start.
 */

/** Start a clock. The one triangle, pointing the way time goes. */
export function Play(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M6 4l8 5-8 5z" fill="currentColor" />
        </svg>
    );
}

/** Pause a clock. Two bars, the other half of the same pair. */
export function Pause(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" shapeRendering="crispEdges">
            <path d="M5 4h3v10H5zM10 4h3v10h-3z" fill="currentColor" />
        </svg>
    );
}

/** Edit a clock. A pencil drawn in the stone's stroke, point down. */
export function Pencil(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
            <path d="M11.8 3.6l2.6 2.6-7.6 7.6-3.3.7.7-3.3z" />
            <path d="M10.2 5.2l2.6 2.6" strokeLinecap="round" />
        </svg>
    );
}
