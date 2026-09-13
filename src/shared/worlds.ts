/** Types for a server's worlds, shared by main and the shell. */

export type Detail = 'low' | 'high';

/** A world declared in the catalog rather than fetched. */
export interface StaticWorld {
    id: number;
    name: string;
    region: string | null;
    members: boolean | null;
}

export type WorldSource =
    /** LostHQ's JSON: [{ world, location, count, p2p, hd, ld }] */
    | { kind: 'losthq'; url: string }
    /** Zanaris's JSON: [{ id, name, region, members, url }], players from <url>/world.json */
    | { kind: 'zanaris'; url: string }
    | { kind: 'static'; worlds: StaticWorld[] };

export interface WorldsDef {
    source: WorldSource;
    /** Game page for a world: {world} is its number, {url} its origin, {lowmem} is 1 for low detail and 0 for high. */
    template: string;
    /** False when the server ignores the detail parameter; the switch is then hidden. */
    detail: boolean;
    /** Opened when nothing is remembered for this server. */
    defaultWorld: number;
}

export interface Bookmark {
    name: string;
    url: string;
    /**
     * Which sprite the Guides list draws beside it. A name the renderer knows,
     * not a path: art belongs to the renderer, and a catalog full of file
     * references would be a catalog that can point at files.
     *
     * Optional because a bookmark added by hand will not have one, and an
     * unknown or missing id draws the generic page sprite rather than costing
     * the whole file its validation.
     */
    icon?: string;
}

/** One world as listed. `origin` is what `{url}` expands to; null when the source does not say. */
export interface World {
    id: number;
    name: string;
    region: string | null;
    members: boolean | null;
    players: number | null;
    origin: string | null;
}

export interface WorldRow extends World {
    latencyMs: number | null;
}

/** What the Worlds panel draws. */
export interface WorldsView {
    status: 'idle' | 'loading' | 'ready' | 'error';
    worlds: WorldRow[];
    fetchedAt: number | null;
    error: string | null;
    current: number;
    detail: Detail;
    /** False when the server ignores the detail parameter. */
    showDetail: boolean;
}

/** What is remembered per server between launches. */
export interface RememberedWorld {
    world: number;
    detail: Detail;
    url: string;
}
