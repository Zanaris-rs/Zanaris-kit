import { themeVars, type ThemeColors } from '../shared/themes';

/** The palette on the page now, so a state push that changes nothing else does not rewrite every variable. The timers push once a second. */
let applied = '';

/**
 * Puts a palette on the page: every token as the `--color-*` variable
 * `styles.css` and Tailwind's utilities already read, set on :root so it
 * outranks the `@theme` block's fallback. Main resolves which palette; this
 * only applies it.
 */
export function applyTheme(colors: ThemeColors): void {
    const vars = Object.entries(themeVars(colors));
    const key = vars.map(([, value]) => value).join();
    if (key === applied) return;
    applied = key;
    const root = document.documentElement.style;
    for (const [name, value] of vars) root.setProperty(name, value);
}
