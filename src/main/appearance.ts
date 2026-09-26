import type { ServerDef } from '../shared/catalog.ts';
import { THEMES, THEME_NAME_MAX, readBackground, readColors, serverOverride, themeFor, type Appearance, type Theme, type ThemeLook } from '../shared/themes.ts';

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
 * editor draw from what they are sent. `look` is what Settings wears:
 * the theme being edited while there is one, and otherwise the app theme's look.
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

/**
 * The theme being edited, as Settings reports it while its editor is open:
 * the draft's look, which every window wears until the editor closes, its name
 * for the question closing Settings asks, and whether it differs from what the
 * editor opened on.
 */
export interface Editing {
    look: ThemeLook;
    name: string;
    changed: boolean;
}

/**
 * What Settings sent, read as strictly as a draft's look is on Save — colours
 * through `readColors`, and a picture that is there but cannot be read refuses
 * the whole report rather than being dropped from it, since every window would
 * then wear a draft without the picture its editor shows. The name is only
 * ever read back in a question, so any string will do, cut to a theme name's
 * length; an empty one is "this theme". Null for anything else, which main
 * ignores.
 */
export function readEditing(x: unknown): Editing | null {
    if (typeof x !== 'object' || x === null) return null;
    const e = x as Record<string, unknown>;
    if (typeof e.look !== 'object' || e.look === null || typeof e.name !== 'string' || typeof e.changed !== 'boolean') return null;
    const look = e.look as Record<string, unknown>;
    const colors = readColors(look.colors);
    if (colors === null) return null;
    const background = look.background === null || look.background === undefined ? null : readBackground(look.background);
    if (look.background !== null && look.background !== undefined && background === null) return null;
    const name = e.name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, THEME_NAME_MAX).trim();
    return { look: { colors, background }, name: name || 'this theme', changed: e.changed };
}

/**
 * The look a window wears: the theme being edited while there is one, over
 * everything, and otherwise its server's own theme or the app's. `serverId`
 * null is Settings, which wears the app theme. Every window wears a draft,
 * whatever it would otherwise wear, so the editor's changes can be seen on the
 * window the player is looking at rather than on the one that happens to wear
 * the theme.
 */
export function lookFor(appearance: Appearance, serverId: string | null, editing: Editing | null): ThemeLook {
    if (editing) return editing.look;
    const theme = themeFor(appearance, serverId);
    return { colors: theme.colors, background: theme.background };
}

/**
 * What closing Settings asks before it goes, or null to let it close: only
 * when a draft differs from what its editor opened on, and never while the
 * app is quitting, which Settings does not hold up.
 */
export function closeQuestion(editing: Editing | null, quitting: boolean): { message: string; detail: string } | null {
    if (!editing || !editing.changed || quitting) return null;
    return { message: `Discard your changes to ${editing.name}?`, detail: 'Every window goes back to the theme it wore before.' };
}

/** Pure, beside `serversView`: main builds it with every Settings push. */
export function appearanceView(opts: { appearance: Appearance; catalog: readonly ServerDef[]; editing?: Editing | null }): AppearanceView {
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
        look: lookFor(opts.appearance, null, opts.editing ?? null),
        themes: [...THEMES.map(theme => card(theme, false)), ...opts.appearance.custom.map(theme => card(theme, true))],
        servers: opts.catalog.map(server => ({ id: server.id, name: server.name, theme: serverOverride(opts.appearance, server.id) }))
    };
}
