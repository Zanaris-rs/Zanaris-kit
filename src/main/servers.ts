import { DEFAULT_SERVERS } from './catalog.ts';
import type { NewServerInput, ServerDef } from '../shared/catalog.ts';

/**
 * The rules behind the Servers section of Settings, kept here rather than in
 * the window or the renderer for the reason every rule in this kit is:
 * `node --test` reaches this file without Electron, and reaches neither of
 * those.
 */

/** One row of the list, already named and counted so the renderer works nothing out. */
export interface ServerRow {
    id: string;
    name: string;
    revision: number | null;
    notes: string | null;
    /** How many windows of this server are open, so a row can say so. */
    open: number;
    /** Whether a launch opens this one — the first entry included when nothing else is ticked, since a launch opens it then. */
    atStartup: boolean;
    /** The only server a launch opens, whose box cannot be unticked: a launch always opens one (`nextStartup`). */
    onlyStartup: boolean;
    removable: boolean;
}

export interface ServersView {
    rows: ServerRow[];
}

/**
 * Whether the Servers section may offer Remove.
 *
 * Never for a built-in. `Catalog.load` does not put a missing built-in back —
 * at version 5 `migrateCatalog` only validates, and the four refresh functions
 * touch only entries already present — so removing one is permanent short of
 * deleting `servers.json`, and there is nothing in the app that would undo it.
 *
 * Judged on the id alone, which is deliberately the conservative direction: a
 * hand-edited file could hold a user's own entry under a built-in's id, and
 * refusing to remove that one costs a trip to the file, while removing a real
 * built-in costs the entry for good.
 */
export function isRemovable(id: string): boolean {
    return !DEFAULT_SERVERS.some(server => server.id === id);
}

/**
 * Which servers a launch opens.
 *
 * Filtering the catalog rather than mapping the stored list does three things
 * at once: an id the catalog no longer holds is dropped, a list naming one
 * twice yields it once, and the windows open in catalog order however the file
 * happened to store them.
 *
 * An empty answer falls back to the first entry, which is exactly what a launch
 * has always done (`index.ts`'s `actions.newWindow`). That is what makes it
 * impossible to launch into no windows at all — whether the list was never set
 * or every server in it has since been removed.
 */
export function startupServers(stored: readonly string[], catalog: readonly ServerDef[]): ServerDef[] {
    const wanted = new Set(stored);
    const chosen = catalog.filter(server => wanted.has(server.id));
    if (chosen.length > 0) return chosen;
    const first = catalog[0];
    return first ? [first] : [];
}

/**
 * The ids to store after a startup box in Settings changes.
 *
 * The boxes show what a launch opens (`startupServers`), fallback included:
 * with nothing ticked the first entry opens, so its box is ticked, where it
 * used to show empty while Lost City opened anyway. Two rules follow. Ticking
 * another while only the fallback is in effect keeps the fallback, which was
 * shown ticked and should not untick itself. And the last server a launch
 * opens cannot be unticked, since a launch always opens one and the box would
 * only come straight back.
 *
 * The answer is the ids a launch would open, so a stale id stored earlier is
 * dropped on the way.
 */
export function nextStartup(stored: readonly string[], catalog: readonly ServerDef[], id: string, on: boolean): string[] {
    const opening = startupServers(stored, catalog).map(server => server.id);
    if (on) return opening.includes(id) || !catalog.some(server => server.id === id) ? opening : [...opening, id];
    return opening.length > 1 ? opening.filter(open => open !== id) : opening;
}

/** Every catalog entry as a row. The list holds them all; only Remove is ever withheld. */
export function serversView(opts: { catalog: readonly ServerDef[]; startup: readonly string[]; openCounts: ReadonlyMap<string, number> }): ServersView {
    const opening = new Set(startupServers(opts.startup, opts.catalog).map(server => server.id));
    return {
        rows: opts.catalog.map(server => ({
            id: server.id,
            name: server.name,
            revision: server.revision,
            notes: server.notes,
            open: opts.openCounts.get(server.id) ?? 0,
            atStartup: opening.has(server.id),
            onlyStartup: opening.size === 1 && opening.has(server.id),
            removable: isRemovable(server.id)
        }))
    };
}

/**
 * What Remove asks before it removes. Removing is permanent: the name,
 * address, revision and notes were typed by hand and nothing puts them back.
 * The windows open on it are not closed — each keeps its copy of the server
 * until it is — so the question says so rather than leaving it to be guessed.
 */
export function removeQuestion(server: { name: string }, openWindows: number): { message: string; detail: string } {
    const windows =
        openWindows === 0 ? '' : openWindows === 1 ? ' The window open on it stays open until you close it.' : ` The ${openWindows} windows open on it stay open until you close them.`;
    return {
        message: `Remove ${server.name}?`,
        detail: `Its address and notes are removed with it, and adding it again means typing them again.${windows}`
    };
}

/**
 * The add form as it arrives over IPC, or null.
 *
 * Shape only. What the values *mean* is `createServer`'s alone: `catalog.ts`
 * imports `node:fs` on its first line, so the renderer cannot import it, and
 * the form has no copy of its rules to run. It submits instead, and shows
 * whatever `createServer`, in main, refuses it for.
 */
export function readNewServerInput(x: unknown): NewServerInput | null {
    if (typeof x !== 'object' || x === null) return null;
    const i = x as Record<string, unknown>;
    if (typeof i.name !== 'string' || typeof i.url !== 'string') return null;
    if (i.revision !== null && typeof i.revision !== 'number') return null;
    if (i.wikiHome !== null && typeof i.wikiHome !== 'string') return null;
    if (i.notes !== null && typeof i.notes !== 'string') return null;
    return { name: i.name, url: i.url, revision: i.revision, wikiHome: i.wikiHome, notes: i.notes };
}
