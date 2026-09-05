import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NewServerInput, ServerDef, WikiDef } from '../shared/catalog.ts';

/** LostHQ has no discoverable search endpoint (its index.php?search= returns the homepage). */
const LOSTHQ: WikiDef = { home: 'https://2004.losthq.rs/', search: null };

export const DEFAULT_SERVERS: readonly ServerDef[] = [
    {
        id: 'zanaris-w1',
        name: 'Zanaris — World 1',
        url: 'https://w1.04.zanaris.rs/rs2.cgi?lowmem=1',
        revision: 274,
        wiki: LOSTHQ,
        map: null,
        hosts: ['w1.04.zanaris.rs', '2004.losthq.rs'],
        notes: null
    },
    {
        id: 'lostcity-w5',
        name: 'Lost City — World 5',
        url: 'https://w5-2004.lostcity.rs/rs2.cgi?plugin=0&world=5&lowmem=1',
        revision: 274,
        wiki: LOSTHQ,
        map: null,
        hosts: ['w5-2004.lostcity.rs', '2004.losthq.rs'],
        notes: null
    },
    {
        id: 'lostcitylabs-w1',
        name: 'Lost City Labs — World 1',
        url: 'https://www.lostcitylabs.com/play/world-1/',
        revision: null,
        wiki: null,
        map: null,
        hosts: ['www.lostcitylabs.com'],
        notes: 'May 2005 per Lost City Labs'
    },
    {
        id: 'local',
        name: 'Local server',
        url: 'http://127.0.0.1:8888/rs2.cgi?lowmem=1',
        revision: 289,
        wiki: null,
        map: null,
        hosts: ['127.0.0.1:8888'],
        notes: null
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

    return { ok: true, server: { id, name, url: url.url, revision: input.revision, wiki, map: null, hosts, notes } };
}

const isString = (x: unknown): x is string => typeof x === 'string';
const isNullableString = (x: unknown): x is string | null => x === null || typeof x === 'string';

export function isServerDef(x: unknown): x is ServerDef {
    if (typeof x !== 'object' || x === null) return false;
    const s = x as Record<string, unknown>;
    if (!isString(s.id) || s.id === '' || !isString(s.name) || !isString(s.url)) return false;
    if (!parseServerUrl(s.url).ok) return false;
    if (s.revision !== null && !(typeof s.revision === 'number' && Number.isInteger(s.revision) && s.revision > 0)) return false;
    if (s.wiki !== null) {
        if (typeof s.wiki !== 'object' || s.wiki === null) return false;
        const w = s.wiki as Record<string, unknown>;
        if (!isString(w.home) || !isNullableString(w.search)) return false;
    }
    if (!isNullableString(s.map) || !isNullableString(s.notes)) return false;
    if (!Array.isArray(s.hosts) || !s.hosts.every(isString)) return false;
    return true;
}

interface CatalogFile {
    version: 1;
    servers: ServerDef[];
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
            const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<CatalogFile> | null;
            const servers = parsed?.servers;
            if (!Array.isArray(servers) || !servers.every(isServerDef)) throw new Error('not a catalog');
            if (new Set(servers.map(s => s.id)).size !== servers.length) throw new Error('duplicate ids');
            this.servers = servers.map(copy);
        } catch {
            renameSync(this.file, `${this.file}.broken-${Date.now()}`);
            this.servers = DEFAULT_SERVERS.map(copy);
            this.recovered = true;
            this.save();
        }
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
        const data: CatalogFile = { version: 1, servers: this.servers };
        writeFileSync(this.file, `${JSON.stringify(data, null, 2)}\n`);
    }
}

function copy(s: ServerDef): ServerDef {
    return { ...s, hosts: [...s.hosts], wiki: s.wiki ? { ...s.wiki } : null };
}
