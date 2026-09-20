import { DEFAULT_SERVERS } from './catalog.ts';
import type { NewServerInput, ServerDef } from '../shared/catalog.ts';

/**
 * The rules behind the Servers pane, kept here rather than in the window or
 * the renderer for the reason every rule in this kit is: `node --test` reaches
 * this file without Electron, and reaches neither of those.
 */

/** One row of the pane, already named and counted so the renderer works nothing out. */
export interface ServerRow {
    id: string;
    name: string;
    revision: number | null;
    notes: string | null;
    /** How many windows of this server are open, so a row can say so. */
    open: number;
    /** Whether a launch opens this one. */
    atStartup: boolean;
    removable: boolean;
}

export interface ServersView {
    rows: ServerRow[];
}

/**
 * Whether the pane may offer Remove.
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

/** Every catalog entry as a row. The pane lists them all; only Remove is ever withheld. */
export function serversView(opts: { catalog: readonly ServerDef[]; startup: readonly string[]; openCounts: ReadonlyMap<string, number> }): ServersView {
    const wanted = new Set(opts.startup);
    return {
        rows: opts.catalog.map(server => ({
            id: server.id,
            name: server.name,
            revision: server.revision,
            notes: server.notes,
            open: opts.openCounts.get(server.id) ?? 0,
            atStartup: wanted.has(server.id),
            removable: isRemovable(server.id)
        }))
    };
}

/**
 * The add form as it arrives over IPC, or null.
 *
 * Shape only. What the values *mean* is `createServer`'s, which the handler
 * runs next and which the form has already run itself — the same function on
 * both sides, as the chat settings and timer forms do it, so the refusal the
 * user sees and the refusal main gives cannot drift apart.
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
