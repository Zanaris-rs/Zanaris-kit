import { themeVars, type ThemeLook } from '../shared/themes';

/** The look on the page now, so a state push that changes nothing else does not rewrite every variable. The timers push once a second. */
let applied = '';

/**
 * Puts a look on the page: every token as the `--color-*` variable
 * `styles.css` and Tailwind's utilities already read, and the picture as the
 * variables `body` paints, set on :root so they outrank the `@theme` block's
 * fallback. Main resolves which look; this only applies it.
 */
export function applyTheme(look: ThemeLook): void {
    const vars = Object.entries(themeVars(look));
    const key = vars.map(([, value]) => value).join();
    if (key === applied) return;
    applied = key;
    const root = document.documentElement.style;
    for (const [name, value] of vars) root.setProperty(name, value);
}
