import type { ServerDef } from '../shared/catalog.ts';
import { THEMES, serverOverride, themeFor, type Appearance, type Theme, type ThemeLook } from '../shared/themes.ts';

/** One catalog server in the Appearance section: its own theme, or null when it follows the app. */
export interface ServerThemeRow {
    id: string;
    name: string;
    theme: string | null;
}

/** A theme as a card in the Appearance section: the whole theme, and whether it is the player's own — Edit rather than Customise, and Delete. */
export interface ThemeCard extends Theme {
    custom: boolean;
}

/**
 * What Settings' Appearance section draws. Every theme travels whole —
 * palette, picture and all — rather than as an id, so the cards and the
 * editor draw from what they are sent. `look` is the app theme's, which
 * Settings itself wears.
 */
export interface AppearanceView {
    theme: string;
    look: ThemeLook;
    /** The built-ins, then the player's own in the order they were made. */
    themes: ThemeCard[];
    servers: ServerThemeRow[];
}

/** Pure, beside `serversView`: main builds it with every Settings push. */
export function appearanceView(opts: { appearance: Appearance; catalog: readonly ServerDef[] }): AppearanceView {
    const app = themeFor(opts.appearance, null);
    const card = (theme: Theme, custom: boolean): ThemeCard => ({
        id: theme.id,
        name: theme.name,
        colors: { ...theme.colors },
        background: theme.background ? { ...theme.background } : null,
        custom
    });
    return {
        theme: app.id,
        look: { colors: app.colors, background: app.background },
        themes: [...THEMES.map(theme => card(theme, false)), ...opts.appearance.custom.map(theme => card(theme, true))],
        servers: opts.catalog.map(server => ({ id: server.id, name: server.name, theme: serverOverride(opts.appearance, server.id) }))
    };
}
