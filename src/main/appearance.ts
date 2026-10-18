import type { ServerDef } from '../shared/catalog.ts';
import { THEMES, THEME_NAME_MAX, draftOf, isThemeId, readBackground, readColors, serverOverride, themeFor, type Appearance, type Theme, type ThemeColors, type ThemeDraft, type ThemeLook } from '../shared/themes.ts';
import type { PresetCard } from './presets.ts';

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
    /** The server the editor's Save makes the theme its own for, or null when Save makes it the app theme (`savesTo`). The editor says so only when it is a server. */
    savesTo: { id: string; name: string } | null;
    /** The built-ins, then the player's own in the order they were made. */
    themes: ThemeCard[];
    servers: ServerThemeRow[];
    /** The kit's own pictures, for the editor's gallery, in the order it shows them. */
    presets: PresetCard[];
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
    if (wearing.length > 0) lines.push(`${listed(wearing)} ${wearing.length === 1 ? 'goes' : 'go'} back to the app theme.`);
    if (opts.appearance.theme === opts.id) lines.push('Every window wearing it goes back to 2004 stone.');
    lines.push("This can't be undone.");
    return { message: `Delete ${theme.name}?`, detail: lines.join(' ') };
}

/**
 * The theme being edited, as Settings reports it while its editor is open:
 * the draft's look, which every window wears until the editor closes, its name
 * for the question closing Settings asks, whether it differs from what the
 * editor opened on, and the server whose window opened it from its Theme menu
 * while that server kept its own theme — null otherwise, and always from a
 * card in Settings.
 */
export interface Editing {
    look: ThemeLook;
    name: string;
    changed: boolean;
    forServer: string | null;
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
    if (e.forServer !== undefined && e.forServer !== null && typeof e.forServer !== 'string') return null;
    const look = e.look as Record<string, unknown>;
    const colors = readColors(look.colors);
    if (colors === null) return null;
    const background = look.background === null || look.background === undefined ? null : readBackground(look.background);
    if (look.background !== null && look.background !== undefined && background === null) return null;
    const name = e.name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, THEME_NAME_MAX).trim();
    return { look: { colors, background }, name: name || 'this theme', changed: e.changed, forServer: typeof e.forServer === 'string' ? e.forServer : null };
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
 * Where the editor's Save puts the theme it keeps: the server whose window
 * opened the editor, while that server is still in the catalog and still
 * keeps its own theme, or null for the app theme. Without it, saving from a
 * window with its own theme would leave that window in its old theme the
 * moment the draft ended. Main's Save and the editor's line both read this.
 */
export function savesTo(appearance: Appearance, catalog: readonly ServerDef[], editing: Editing | null): { id: string; name: string } | null {
    const id = editing?.forServer;
    if (!id) return null;
    const server = catalog.find(s => s.id === id);
    if (!server || serverOverride(appearance, id) === null) return null;
    return { id, name: server.name };
}

/**
 * What closing Settings asks before it goes, or null to let it close: only
 * when a draft differs from what its editor opened on, and never while the
 * app is quitting, which Settings does not hold up.
 */
export function closeQuestion(editing: Editing | null, quitting: boolean): { message: string; detail: string } | null {
    if (!editing || !editing.changed || quitting) return null;
    // No detail: an empty one shows nothing under the message.
    return { message: `Discard your changes to ${editing.name}?`, detail: '' };
}

/**
 * Pure, beside `serversView`: main builds it with every Settings push, handing
 * it the presets it read once from their files and the theme being edited, if any.
 */
export function appearanceView(opts: { appearance: Appearance; catalog: readonly ServerDef[]; presets: readonly PresetCard[]; editing?: Editing | null }): AppearanceView {
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
        savesTo: savesTo(opts.appearance, opts.catalog, opts.editing ?? null),
        themes: [...THEMES.map(theme => card(theme, false)), ...opts.appearance.custom.map(theme => card(theme, true))],
        servers: opts.catalog.map(server => ({ id: server.id, name: server.name, theme: serverOverride(opts.appearance, server.id) })),
        presets: opts.presets.map(preset => ({ ...preset }))
    };
}

// ── a game window's Theme menu ────────────────────────────────────────────

/** Native menus are Title Case; a built-in's name is sentence case, as the renderer draws it. */
const titleCase = (name: string): string => name.replace(/(^|\s)\S/g, c => c.toUpperCase());

/** Words a player typed, in a native menu: Windows and Linux read an `&` as the mark for the next letter's shortcut, so there one is doubled to show as itself. */
const menuText = (text: string, isMac: boolean): string => (isMac ? text : text.replace(/&/g, '&&'));

/** A theme as a native menu names it: a built-in title-cased, a player's own as they typed it. */
export function themeLabel(theme: Theme, isMac: boolean): string {
    if (THEMES.some(builtIn => builtIn.id === theme.id)) return titleCase(theme.name);
    return menuText(theme.name, isMac);
}

/** What one of the Theme menu's items does: wear a theme, give the server its own or take it back, open the editor, or open Appearance. */
export type ThemeMenuAction = { kind: 'wear'; theme: string } | { kind: 'own'; on: boolean } | { kind: 'customise' } | { kind: 'all' };

/**
 * One line of the Theme menu. `checked` is null for an item that is not a
 * checkbox; `swatch` is the theme's colours for a theme's line on macOS,
 * which main draws as its icon (`swatch.ts`), and null otherwise. Off macOS
 * there is none: Windows' and GTK's menus are reported to draw an item's
 * check or its image, not both, and the tick is the one that means something.
 */
export type ThemeMenuEntry =
    | { kind: 'separator' }
    | { kind: 'item'; label: string; checked: boolean | null; enabled: boolean; swatch: ThemeColors | null; action: ThemeMenuAction };

const SEPARATOR: ThemeMenuEntry = { kind: 'separator' };

/**
 * The tab bar's Theme menu, for a window of `server`: every built-in, the
 * player's own after a separator, Just for the server, then the editor and
 * Appearance. The tick is on what the server is set to wear — its own theme
 * while it has one, else the app's — the stored choice, so a draft open in
 * the editor moves no tick, as View > Server Theme behaves. `listed` is false
 * for a window whose server Settings has removed: Just for is greyed there,
 * and a pick sets the app theme (`themeChoice`).
 *
 * `drafting` is the name of the theme Settings' editor holds, or null. Every
 * window wears a draft over whatever it is set to wear, so a pick then would
 * change nothing on screen: the picks and Just for are greyed, ticks and all,
 * and Customise becomes Back to Editing, which brings the editor forward.
 */
export function themeMenu(opts: { appearance: Appearance; server: { id: string; name: string }; listed: boolean; isMac: boolean; drafting: string | null }): ThemeMenuEntry[] {
    const { appearance, server, listed, isMac, drafting } = opts;
    const free = drafting === null;
    const own = listed ? serverOverride(appearance, server.id) : null;
    const worn = themeFor(appearance, server.id);
    const wear = (theme: Theme): ThemeMenuEntry => ({
        kind: 'item',
        label: themeLabel(theme, isMac),
        checked: theme.id === worn.id,
        enabled: free,
        swatch: isMac ? theme.colors : null,
        action: { kind: 'wear', theme: theme.id }
    });
    const plain = (label: string, action: ThemeMenuAction): ThemeMenuEntry => ({ kind: 'item', label, checked: null, enabled: true, swatch: null, action });
    const custom = appearance.custom.some(theme => theme.id === worn.id);
    return [
        ...THEMES.map(wear),
        ...(appearance.custom.length > 0 ? [SEPARATOR, ...appearance.custom.map(wear)] : []),
        SEPARATOR,
        { kind: 'item', label: `Just for ${menuText(server.name, isMac)}`, checked: own !== null, enabled: listed && free, swatch: null, action: { kind: 'own', on: own === null } },
        SEPARATOR,
        plain(drafting !== null ? `Back to Editing ${menuText(drafting, isMac)}…` : `${custom ? 'Edit' : 'Customise'} ${themeLabel(worn, isMac)}…`, { kind: 'customise' }),
        plain('All Themes…', { kind: 'all' })
    ];
}

/** What a choice in the Theme menu writes: the app theme, or a server's own — null to follow the app again. */
export type ThemeChange = { theme: string } | { server: string; theme: string | null };

/**
 * What a pick or the tick writes, or null for an item that writes nothing
 * here. A pick is the server's own while it keeps one, else the app's. The
 * tick on gives the server the app theme as its own, so nothing on screen
 * changes; off puts it back on the app's. A window whose server is not
 * `listed` has no own theme to keep: its picks set the app theme and its
 * tick does nothing.
 */
export function themeChoice(appearance: Appearance, serverId: string, listed: boolean, action: ThemeMenuAction): ThemeChange | null {
    const own = listed ? serverOverride(appearance, serverId) : null;
    if (action.kind === 'wear') {
        if (!isThemeId(action.theme, appearance.custom)) return null;
        return own !== null ? { server: serverId, theme: action.theme } : { theme: action.theme };
    }
    if (action.kind === 'own' && listed) return { server: serverId, theme: action.on ? themeFor(appearance, null).id : null };
    return null;
}

/**
 * What Customise in a window's Theme menu opens the editor on: the theme its
 * server is set to wear, as a card's Customise or Edit would (`draftOf`), and
 * the server Save goes to — this one while it keeps its own theme, else none,
 * and Save makes it the app theme (`savesTo`).
 */
export function editFromWindow(appearance: Appearance, serverId: string, listed: boolean): { draft: ThemeDraft; forServer: string | null } {
    const theme = themeFor(appearance, serverId);
    const custom = appearance.custom.some(t => t.id === theme.id);
    const own = listed ? serverOverride(appearance, serverId) : null;
    return { draft: draftOf(theme, custom), forServer: own !== null ? serverId : null };
}
