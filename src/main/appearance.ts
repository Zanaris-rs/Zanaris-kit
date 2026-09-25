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

/** "A", "A and B", "A, B and C". */
function listed(names: readonly string[]): string {
    return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * What Delete asks, before it goes: the theme by name, and who wears it and
 * what each will wear instead. Null when there is no such custom theme.
 */
export function deleteQuestion(opts: { appearance: Appearance; catalog: readonly ServerDef[]; id: string }): { message: string; detail: string } | null {
    const theme = opts.appearance.custom.find(t => t.id === opts.id);
    if (!theme) return null;
    const wearing = opts.catalog.filter(server => serverOverride(opts.appearance, server.id) === opts.id).map(server => server.name);
    const lines: string[] = [];
    if (wearing.length > 0) lines.push(`${listed(wearing)} ${wearing.length === 1 ? 'wears' : 'wear'} it, and will follow the app theme.`);
    if (opts.appearance.theme === opts.id) lines.push('It is the app theme: Settings, and every server without its own, will wear 2004 stone.');
    if (lines.length === 0) lines.push('Nothing wears it.');
    lines.push('Export it first to keep a copy: this cannot be undone.');
    return { message: `Delete ${theme.name}?`, detail: lines.join(' ') };
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
