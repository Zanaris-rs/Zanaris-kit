import type { HiscoresDef } from './hiscores';
import type { TimerDef } from './timers';
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
    /** A remote server's page, or the world the kit runs on this computer. */
    kind: 'remote' | 'singleplayer';
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
    /** How to look a player up, and where the server's own hiscores page is; null when it offers neither. */
    hiscores: HiscoresDef | null;
    /**
     * This server's built-in countdowns and timers. The kit's, like `hiscores`:
     * re-adopted from the defaults on every launch, while the player's changes
     * to them live in state.json as edits on top.
     */
    timers: TimerDef[];
}

/**
 * What the Servers section's add form collects. `createServer`, in main, turns
 * it into an entry or says why it cannot; the form shows that answer rather
 * than deciding for itself, since `catalog.ts` reaches the file system and
 * the renderer cannot import it.
 */
export interface NewServerInput {
    name: string;
    url: string;
    revision: number | null;
    wikiHome: string | null;
    notes: string | null;
}
