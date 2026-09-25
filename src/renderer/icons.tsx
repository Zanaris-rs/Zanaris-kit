import type { ReactNode } from 'react';

/*
 * The chrome's glyphs, taken from the design sheet rather than drawn here.
 *
 * The client's interface tabs are sprites: flat filled shapes sharing one dark
 * outline. Stroked outlines of even weight are the giveaway of a modern icon
 * set, and beside pixel type they read as borrowed from somewhere else. So the
 * sprites are painted, not outlined, and only the chrome glyphs stay strokes.
 *
 * Pictures of things — the launcher's links and tools — are not drawn here at
 * all: they are the game's own item sprites, in `sprites.tsx`.
 */

/*
 * The two sprites below fill with cream on the outline every sprite shares, as
 * sprite art does. Both are theme tokens, set as classes (`fill-cream`,
 * `stroke-outline`) so a theme reaches them: a class is a CSS rule, which
 * outranks the `fill="none"` on the <svg>, where a presentation attribute is
 * no place to rely on `var()`.
 */

/** The new-tab control. Drawn as the same thick, outlined cross the close is, turned a quarter — they are the same pair of gestures and should read as a pair. */
export function Plus(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
            <path d="M7.2 3.2h3.6v4h4v3.6h-4v4H7.2v-4h-4V7.2h4Z" className="fill-cream stroke-outline" strokeWidth="1.3" strokeLinejoin="round" />
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
                className="fill-cream stroke-outline"
                strokeWidth="1.3"
                strokeLinejoin="round"
            />
        </svg>
    );
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
            <path d="M7.5 3.9L7.9 1.8L10.1 1.8L10.5 3.9L11.5 4.3L13.3 3.1L14.9 4.7L13.7 6.5L14.1 7.5L16.2 7.9L16.2 10.1L14.1 10.5L13.7 11.5L14.9 13.3L13.3 14.9L11.5 13.7L10.5 14.1L10.1 16.2L7.9 16.2L7.5 14.1L6.5 13.7L4.7 14.9L3.1 13.3L4.3 11.5L3.9 10.5L1.8 10.1L1.8 7.9L3.9 7.5L4.3 6.5L3.1 4.7L4.7 3.1L6.5 4.3Z" />
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
