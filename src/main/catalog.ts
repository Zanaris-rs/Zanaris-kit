import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NewServerInput, ServerDef, WikiDef } from '../shared/catalog.ts';
import type { Bookmark } from '../shared/worlds.ts';
import { isWorldsDef } from './worlds/sources.ts';

/** LostHQ has no discoverable search endpoint (its index.php?search= returns the homepage). */
const LOSTHQ: WikiDef = { home: 'https://2004.losthq.rs/', search: null };

/** Pages LostHQ serves today, plus the tools LostKit's nav bar links to. */
const LOSTHQ_BOOKMARKS: Bookmark[] = [
    { name: 'Quest guides', url: 'https://2004.losthq.rs/?p=questguides' },
    { name: 'Skill guides', url: 'https://2004.losthq.rs/?p=skillguides' },
    { name: 'Clue help', url: 'https://2004.losthq.rs/?p=clueguides' },
    { name: 'Item database', url: 'https://2004.losthq.rs/?p=itemdb' },
    { name: 'Skills calculator', url: 'https://2004.losthq.rs/?p=calculators' },
    { name: 'Clue coordinates', url: 'https://tools.losthq.rs/cluecoordinator/' },
    { name: 'World map', url: 'https://tools.losthq.rs/map' }
];

/** What the engine was pinned to when this line was written; used only when neither source can be read. */
const LAST_KNOWN_REVISION = 274;

/** The game revision the bundled engine is, from the pin file at build time or, under tests, on disk. */
export function engineRevision(): number {
    if (typeof __ENGINE_REVISION__ === 'number') return __ENGINE_REVISION__;
    // DEFAULT_SERVERS calls this at module scope, so a throw here would take the
    // main process down before there is a window to say so in — and the path is
    // relative, so any cwd but the repo root misses it. The number is only ever
    // a label; being one revision stale beats not launching.
    try {
        return (JSON.parse(readFileSync('engine.lock.json', 'utf8')) as { revision: number }).revision;
    } catch {
        return LAST_KNOWN_REVISION;
    }
}

export const DEFAULT_SERVERS: readonly ServerDef[] = [
    {
        id: 'lostcity',
        kind: 'remote',
        name: 'Lost City',
        url: 'https://w5-2004.lostcity.rs/rs2.cgi?plugin=0&world=5&lowmem=1',
        revision: 274,
        wiki: LOSTHQ,
        map: 'https://tools.losthq.rs/map',
        hosts: ['w5-2004.lostcity.rs', '2004.losthq.rs', 'tools.losthq.rs', 'markets.lostcity.rs'],
        notes: null,
        worlds: {
            source: { kind: 'losthq', url: 'https://2004.losthq.rs/pages/api/worlds.php' },
            template: 'https://w{world}-2004.lostcity.rs/rs2.cgi?plugin=0&world={world}&lowmem={lowmem}',
            detail: true,
            defaultWorld: 5
        },
        bookmarks: [...LOSTHQ_BOOKMARKS, { name: 'Markets', url: 'https://markets.lostcity.rs' }],
        hiscores: 'https://2004.lostcity.rs/api/hiscores/player/{name}'
    },
    {
        id: 'zanaris',
        kind: 'remote',
        name: 'Zanaris',
        url: 'https://w1.04.zanaris.rs/rs2.cgi?lowmem=1',
        revision: 274,
        wiki: LOSTHQ,
        map: 'https://tools.losthq.rs/map',
        hosts: ['w1.04.zanaris.rs', '2004.losthq.rs', 'tools.losthq.rs'],
        notes: null,
        worlds: {
            source: { kind: 'zanaris', url: 'https://zanaris.rs/worlds.json' },
            template: '{url}/rs2.cgi?lowmem={lowmem}',
            detail: true,
            defaultWorld: 1
        },
        bookmarks: [...LOSTHQ_BOOKMARKS],
        hiscores: null
    },
    {
        id: 'lostcitylabs',
        kind: 'remote',
        name: 'Lost City Labs',
        url: 'https://www.lostcitylabs.com/play/world-1/',
        revision: null,
        wiki: null,
        map: null,
        hosts: ['www.lostcitylabs.com'],
        notes: 'May 2005 per Lost City Labs',
        worlds: {
            source: { kind: 'static', worlds: [1, 2, 3, 4].map(id => ({ id, name: `World ${id}`, region: 'Germany', members: true })) },
            template: 'https://www.lostcitylabs.com/play/world-{world}/',
            detail: false,
            defaultWorld: 1
        },
        bookmarks: [],
        hiscores: null
    },
    {
        id: 'singleplayer',
        kind: 'singleplayer',
        name: 'Single player',
        // The port is applied at runtime: the world is started on a free one.
        url: 'http://127.0.0.1/rs2.cgi?lowmem=1',
        revision: engineRevision(),
        wiki: LOSTHQ,
        map: 'https://tools.losthq.rs/map',
        hosts: ['127.0.0.1', '2004.losthq.rs', 'tools.losthq.rs'],
        notes: 'Runs on this computer. No account needed.',
        worlds: null,
        bookmarks: [...LOSTHQ_BOOKMARKS],
        hiscores: null
    },
    {
        id: 'local',
        kind: 'remote',
        name: 'Local server',
        url: 'http://127.0.0.1:8888/rs2.cgi?lowmem=1',
        revision: 289,
        wiki: null,
        map: null,
        hosts: ['127.0.0.1:8888'],
        notes: null,
        worlds: null,
        bookmarks: [],
        hiscores: null
    }
];

export type ParsedUrl = { ok: true; url: string } | { ok: false; error: string };

/**
 * Normalises a typed address into an absolute http(s) URL. A missing scheme is
 * read as https; anything that is not a web URL is rejected so a view can never
 * be pointed at file: or javascript: content.
 */
export function parseServerUrl(input: string): ParsedUrl {
    const text = input.trim();
    if (!text) return { ok: false, error: 'Enter an address.' };

    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text);
    let url: URL;
    try {
        url = new URL(hasScheme ? text : `https://${text}`);
    } catch {
        return { ok: false, error: `Not a valid address: ${text}` };
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, error: `Only http and https are supported, not ${url.protocol.slice(0, -1)}.` };
    }
    if (!url.hostname) return { ok: false, error: 'The address needs a host name.' };
    return { ok: true, url: url.href };
}

export function originOf(url: string): string {
    return new URL(url).origin;
}

export function hostOf(url: string): string {
    return new URL(url).host;
}

export function slugify(name: string): string {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || 'server';
}

export function uniqueId(base: string, taken: ReadonlySet<string>): string {
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) {
        const id = `${base}-${n}`;
        if (!taken.has(id)) return id;
    }
}

/** How a server reads in a menu: the name, plus its revision when known. */
export function serverMenuLabel(server: Pick<ServerDef, 'name' | 'revision'>): string {
    return server.revision === null ? server.name : `${server.name} (rev ${server.revision})`;
}

export type CreateResult = { ok: true; server: ServerDef } | { ok: false; error: string };

/** Turns the add form into a catalog entry, or says what is wrong with it. */
export function createServer(input: NewServerInput, existing: readonly ServerDef[]): CreateResult {
    const name = input.name.trim();
    if (!name) return { ok: false, error: 'Enter a name.' };

    const url = parseServerUrl(input.url);
    if (!url.ok) return url;

    if (input.revision !== null && (!Number.isInteger(input.revision) || input.revision <= 0)) {
        return { ok: false, error: 'Revision must be a whole number, or left blank.' };
    }

    let wiki: WikiDef | null = null;
    if (input.wikiHome !== null && input.wikiHome.trim() !== '') {
        const home = parseServerUrl(input.wikiHome);
        if (!home.ok) return { ok: false, error: `Wiki address: ${home.error}` };
        wiki = { home: home.url, search: null };
    }

    const hosts = [...new Set([hostOf(url.url), ...(wiki ? [hostOf(wiki.home)] : [])])];
    const id = uniqueId(slugify(name), new Set(existing.map(s => s.id)));
    const notes = input.notes && input.notes.trim() ? input.notes.trim() : null;

    return {
        ok: true,
        server: { id, kind: 'remote', name, url: url.url, revision: input.revision, wiki, map: null, hosts, notes, worlds: null, bookmarks: [], hiscores: null }
    };
}

const isString = (x: unknown): x is string => typeof x === 'string';
const isNullableString = (x: unknown): x is string | null => x === null || typeof x === 'string';

export function isServerDef(x: unknown): x is ServerDef {
    if (typeof x !== 'object' || x === null) return false;
    const s = x as Record<string, unknown>;
    if (!isString(s.id) || s.id === '' || !isString(s.name) || !isString(s.url)) return false;
    if (s.kind !== 'remote' && s.kind !== 'singleplayer') return false;
    if (!parseServerUrl(s.url).ok) return false;
    if (s.revision !== null && !(typeof s.revision === 'number' && Number.isInteger(s.revision) && s.revision > 0)) return false;
    if (s.wiki !== null) {
        if (typeof s.wiki !== 'object' || s.wiki === null) return false;
        const w = s.wiki as Record<string, unknown>;
        if (!isString(w.home) || !isNullableString(w.search)) return false;
    }
    if (!isNullableString(s.map) || !isNullableString(s.notes)) return false;
    if (!Array.isArray(s.hosts) || !s.hosts.every(isString)) return false;
    if (s.worlds !== null && !isWorldsDef(s.worlds)) return false;
    if (!Array.isArray(s.bookmarks) || !s.bookmarks.every(isBookmark)) return false;
    if (s.hiscores !== null && !(isString(s.hiscores) && s.hiscores.includes('{name}') && parseServerUrl(s.hiscores).ok)) return false;
    return true;
}

function isBookmark(x: unknown): x is Bookmark {
    if (typeof x !== 'object' || x === null) return false;
    const b = x as Record<string, unknown>;
    return isString(b.name) && b.name.trim() !== '' && isString(b.url) && parseServerUrl(b.url).ok;
}

interface CatalogFile {
    version: 3;
    servers: ServerDef[];
}

/** The ids the launcher-era catalog used, one per world. Each maps to the per-server entry that replaces it. */
const LEGACY_IDS: Record<string, string> = {
    'zanaris-w1': 'zanaris',
    'lostcity-w5': 'lostcity',
    'lostcitylabs-w1': 'lostcitylabs',
    local: 'local'
};

function uniqueIds(servers: readonly ServerDef[]): boolean {
    return new Set(servers.map(s => s.id)).size === servers.length;
}

/**
 * Turns whatever was on disk into a usable list, or null when it cannot be
 * used. A version 1 file (per-world entries, no worlds block) has its
 * built-in entries replaced by the current built-ins, in default order, and
 * keeps any custom entries with the new fields empty. A missing version is 1.
 * An older file's entries are remote unless they say otherwise, and gain the
 * built-in single-player entry.
 */
export function migrateCatalog(parsed: unknown): ServerDef[] | null {
    if (typeof parsed !== 'object' || parsed === null) return null;
    const file = parsed as Record<string, unknown>;
    const version = file.version === undefined ? 1 : file.version;
    if (!Array.isArray(file.servers)) return null;

    if (version === 3) {
        return file.servers.every(isServerDef) && uniqueIds(file.servers) ? file.servers.map(copy) : null;
    }
    if (version === 2) {
        const upgraded: ServerDef[] = [];
        for (const entry of file.servers) {
            const withKind = typeof entry === 'object' && entry !== null ? { kind: 'remote', ...(entry as object) } : entry;
            if (!isServerDef(withKind)) return null;
            upgraded.push(copy(withKind));
        }
        return uniqueIds(upgraded) ? withSinglePlayer(upgraded) : null;
    }
    if (version !== 1) return null;

    const builtIn = new Set<string>();
    const custom: ServerDef[] = [];
    for (const entry of file.servers) {
        if (typeof entry !== 'object' || entry === null) return null;
        const e = entry as Record<string, unknown>;
        const replacement = typeof e.id === 'string' ? LEGACY_IDS[e.id] : undefined;
        if (replacement) {
            builtIn.add(replacement);
            continue;
        }
        const upgraded = { kind: 'remote', ...e, worlds: null, bookmarks: [], hiscores: null };
        if (!isServerDef(upgraded)) return null;
        custom.push(copy(upgraded));
    }
    const servers = [...DEFAULT_SERVERS.filter(s => builtIn.has(s.id)).map(copy), ...custom];
    return uniqueIds(servers) ? withSinglePlayer(servers) : null;
}

/** Adds the built-in single-player entry to a list that lacks it, before `local` when present. */
function withSinglePlayer(servers: ServerDef[]): ServerDef[] {
    if (servers.some(s => s.id === 'singleplayer')) return servers;
    const entry = copy(DEFAULT_SERVERS.find(s => s.id === 'singleplayer')!);
    const local = servers.findIndex(s => s.id === 'local');
    if (local < 0) return [...servers, entry];
    return [...servers.slice(0, local), entry, ...servers.slice(local)];
}

/**
 * The server list on disk. Loading never fails: a missing file gets the
 * defaults, and a file that cannot be used is renamed aside (kept, not lost)
 * and replaced with the defaults, with `recovered` set so the launcher can say
 * so.
 */
export class Catalog {
    readonly file: string;
    /** True when the file on disk could not be used and the defaults were written in its place. */
    recovered = false;
    private servers: ServerDef[] = [];

    constructor(file: string) {
        this.file = file;
    }

    load(): void {
        this.recovered = false;
        if (!existsSync(this.file)) {
            this.servers = DEFAULT_SERVERS.map(copy);
            this.save();
            return;
        }
        try {
            const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
            const migrated = migrateCatalog(parsed);
            if (!migrated) throw new Error('not a catalog');
            this.servers = migrated;
            const refreshed = this.refreshSinglePlayer();
            // An older file is rewritten in the current shape; that is an upgrade, not a recovery.
            if (refreshed || (parsed as { version?: unknown }).version !== 3) this.save();
        } catch {
            renameSync(this.file, `${this.file}.broken-${Date.now()}`);
            this.servers = DEFAULT_SERVERS.map(copy);
            this.recovered = true;
            this.save();
        }
    }

    /**
     * The world this computer runs is whatever engine ships with the kit, so the
     * stored entry must not freeze the revision the file was written under: the
     * File menu, the window strip and the tab would keep naming the old one while
     * the panel and the starting page read the new one out of VERSION.json. The
     * revision and the url come back from the built-in; everything else the entry
     * carries, the user's own bookmarks included, is left as they left it.
     * Answers whether anything changed, so the file is only rewritten when it did.
     */
    private refreshSinglePlayer(): boolean {
        const builtIn = DEFAULT_SERVERS.find(s => s.id === 'singleplayer');
        const stored = this.servers.find(s => s.id === 'singleplayer' && s.kind === 'singleplayer');
        if (!builtIn || !stored) return false;
        let changed = false;
        if (stored.revision !== builtIn.revision) {
            stored.revision = builtIn.revision;
            changed = true;
        }
        if (stored.url !== builtIn.url) {
            stored.url = builtIn.url;
            changed = true;
        }
        return changed;
    }

    list(): ServerDef[] {
        return this.servers.map(copy);
    }

    get(id: string): ServerDef | undefined {
        const found = this.servers.find(s => s.id === id);
        return found ? copy(found) : undefined;
    }

    add(input: NewServerInput): CreateResult {
        const result = createServer(input, this.servers);
        if (result.ok) {
            this.servers.push(result.server);
            this.save();
        }
        return result;
    }

    remove(id: string): boolean {
        const index = this.servers.findIndex(s => s.id === id);
        if (index < 0) return false;
        this.servers.splice(index, 1);
        this.save();
        return true;
    }

    private save(): void {
        mkdirSync(dirname(this.file), { recursive: true });
        const data: CatalogFile = { version: 3, servers: this.servers };
        writeFileSync(this.file, `${JSON.stringify(data, null, 2)}\n`);
    }
}

function copy(s: ServerDef): ServerDef {
    return structuredClone(s);
}
