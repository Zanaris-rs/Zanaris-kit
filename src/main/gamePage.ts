import { THEME_TOKENS, type ThemeLook } from '../shared/themes.ts';

/**
 * The theme on the game view's pages: the sheets `serverWindow` puts in the
 * page the game pane shows, swapped whole whenever the look changes, the
 * editor's draft included. CSS and nothing else — the page carries no code of
 * the kit's, and the canvas and everything the client draws on it are the
 * game's own art, which no theme reaches. Flat colours only: a theme's
 * picture is served on the default session, and the game's partitions must
 * never be able to ask for one.
 *
 * Spec: docs/superpowers/specs/2026-10-15-theme-button-and-game-page-design.md.
 */

/** The hard black shadow the kit puts under every glyph on its stone. */
const SHADOW = '1px 1px 0 rgba(0, 0, 0, 0.78)';

/**
 * A client page — the template every server serves: the ground around the
 * canvas, the controls strip under it as a raised band of the theme's stone,
 * its dropdowns sunk into it, its words and icons in the theme's text.
 *
 * The page's geometry is not the theme's to change. The game pane's
 * preferred sizes are measured off the stock page, Lost City's with a pixel
 * or two of slack, so nothing here touches a border, margin, padding or
 * height that sets the page's height: the bevels are inset shadows. A
 * dropdown's own line height drops below the strip's 32px, which leaves the
 * strip's line, and so the strip, as tall as it was: the strut keeps it, and
 * the dropdowns' inline flex row centres them in it.
 *
 * Each rule leads with `html`, to outrank the template's own selectors, and
 * is `!important`, to outrank the one rule there that is — the full-screen
 * ground. The dropdown and green-text rules stand on their own, so a page
 * with no `#controls` still has its ground, dropdowns and words follow. A
 * dropdown loses the system's look, which an older template leaves on: drawn
 * natively it stays light under the theme's cream text. Its arrow, two
 * small gradients, is placed and sized here, since only Lost City's page
 * places it: left to a page that does not, the gradients fill the whole box.
 * Only the strip's own dropdowns change height, where the strut is known to
 * hold the line; a page the kit does not know keeps its lines as they were,
 * and its dropdowns change only their width.
 */
export function clientPageCss(look: ThemeLook): string {
    const c = look.colors;
    return `html:root, html:root body, html:root:-webkit-full-screen { background-color: ${c.window} !important; }
html #controls {
    background-color: ${c.stone} !important;
    box-shadow: inset 2px 2px 0 ${c['edge-lit']}, inset -2px -2px 0 ${c['edge-dark']} !important;
    color: ${c.cream} !important;
    text-shadow: ${SHADOW} !important;
}
html .green, html .icon-control { color: ${c.cream} !important; }
html a.green:hover, html .icon-control:hover { color: ${c.gold} !important; }
html select {
    appearance: none !important;
    -webkit-appearance: none !important;
    background-color: ${c.well} !important;
    background-image: linear-gradient(45deg, transparent 50%, ${c.cream} 50%), linear-gradient(135deg, ${c.cream} 50%, transparent 50%) !important;
    background-position: calc(100% - 0.6em) center, calc(100% - 0.3em) center !important;
    background-size: 0.3em 0.3em !important;
    background-repeat: no-repeat !important;
    box-shadow: inset 2px 2px 0 ${c['edge-dark']}, inset -2px -2px 0 ${c['edge-lit']} !important;
    color: ${c.cream} !important;
    text-shadow: ${SHADOW} !important;
    padding-left: 6px !important;
    padding-right: 1.3em !important;
}
html #controls select { line-height: 24px !important; }
html option, html optgroup { background-color: ${c.well} !important; color: ${c.cream} !important; }
`;
}

/**
 * The kit's own pages in the game pane, offline and starting: `page.css`
 * reads every colour from one of these, with 2004 stone's as its fallback, so
 * they wear the theme the moment the sheet lands and stone before it does.
 */
export function kitPageCss(look: ThemeLook): string {
    return `:root { ${THEME_TOKENS.map(token => `--zk-${token}: ${look.colors[token]};`).join(' ')} }`;
}
