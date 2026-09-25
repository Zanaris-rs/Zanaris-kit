import type { ServerDef } from '../shared/catalog.ts';
import { THEMES, serverOverride, themeFor, type Appearance, type Theme, type ThemeColors } from '../shared/themes.ts';

/** One catalog server in the Appearance section: its own theme, or null when it follows the app. */
export interface ServerThemeRow {
    id: string;
    name: string;
    theme: string | null;
}

/**
 * What Settings' Appearance section draws. Every theme travels as its whole
 * palette rather than an id, so the swatches draw from what they are sent and
 * custom themes can arrive later without a new shape. `colors` is the app
 * theme's, which Settings itself wears.
 */
export interface AppearanceView {
    theme: string;
    colors: ThemeColors;
    themes: Theme[];
    servers: ServerThemeRow[];
}

/** Pure, beside `serversView`: main builds it with every Settings push. */
export function appearanceView(opts: { appearance: Appearance; catalog: readonly ServerDef[] }): AppearanceView {
    const app = themeFor(opts.appearance, null);
    return {
        theme: app.id,
        colors: app.colors,
        themes: THEMES.map(theme => ({ id: theme.id, name: theme.name, colors: { ...theme.colors } })),
        servers: opts.catalog.map(server => ({ id: server.id, name: server.name, theme: serverOverride(opts.appearance, server.id) }))
    };
}
