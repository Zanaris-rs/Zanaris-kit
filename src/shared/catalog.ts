import type { Bookmark, WorldsDef } from './worlds';

/** A wiki the server's page tabs may browse. */
export interface WikiDef {
    home: string;
    /** Search URL with `{query}` in it, or null when the site has no known search endpoint. */
    search: string | null;
}

/** One entry in the server catalog. `id` names windows, partitions and screenshot folders. */
export interface ServerDef {
    id: string;
    name: string;
    /** The game page. */
    url: string;
    /** Null when the server does not say. */
    revision: number | null;
    wiki: WikiDef | null;
    /** A URL the map tool opens as a page tab. */
    map: string | null;
    /** Hosts page tabs may visit. Always includes the game host and the wiki host. */
    hosts: string[];
    /** Free text shown beside the server. */
    notes: string | null;
    /** How to list and address this server's worlds; null when it has one page. */
    worlds: WorldsDef | null;
    /** Reference pages offered by the page-tab "+" menu. */
    bookmarks: Bookmark[];
    /** Player lookup API with {name} in it, or null. */
    hiscores: string | null;
}

/** What the launcher's add form collects. */
export interface NewServerInput {
    name: string;
    url: string;
    revision: number | null;
    wikiHome: string | null;
    notes: string | null;
}
