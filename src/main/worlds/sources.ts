import type { Detail, StaticWorld, World, WorldsDef } from '../../shared/worlds.ts';

/**
 * Where a server's worlds come from and how a world becomes a URL. Pure:
 * fetching is injected, so every parser is tested against the real payloads
 * saved under fixtures/.
 */

// ── templates ─────────────────────────────────────────────────────────────

/** Expands {world}, {url} and {lowmem}. Refuses to guess an origin the template needs. */
export function expandTemplate(template: string, vars: { world: number; origin: string | null; detail: Detail }): string {
    if (template.includes('{url}') && vars.origin === null) {
        throw new Error('the template needs the world origin, which is unknown');
    }
    return template
        .replaceAll('{world}', String(vars.world))
        .replaceAll('{url}', vars.origin ?? '')
        .replaceAll('{lowmem}', vars.detail === 'low' ? '1' : '0');
}

export function worldUrl(def: WorldsDef, world: { id: number; origin: string | null }, detail: Detail): string {
    return expandTemplate(def.template, { world: world.id, origin: world.origin, detail });
}

/** The host and port a latency probe should connect to for a world page. */
export function worldEndpoint(url: string): { host: string; port: number } {
    const u = new URL(url);
    const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
    return { host: u.hostname, port };
}

// ── parsers ───────────────────────────────────────────────────────────────

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function asId(value: unknown, where: string): number {
    const n = typeof value === 'string' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) throw new Error(`${where}: world id must be a positive integer`);
    return n;
}

function webOrigin(value: unknown, where: string): string {
    if (typeof value !== 'string') throw new Error(`${where}: expected a url`);
    let u: URL;
    try {
        u = new URL(value);
    } catch {
        throw new Error(`${where}: not a url: ${value}`);
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`${where}: not a web url: ${value}`);
    return u.origin;
}

function finish(worlds: World[], where: string): World[] {
    const sorted = [...worlds].sort((a, b) => a.id - b.id);
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i]!.id === sorted[i - 1]!.id) throw new Error(`${where}: world ${sorted[i]!.id} is listed twice`);
    }
    return sorted;
}

/** LostHQ's list: ids arrive as strings with gaps, and each entry carries both detail urls. */
export function parseLosthqWorlds(json: unknown): World[] {
    if (!Array.isArray(json)) throw new Error('LostHQ worlds: expected a list');
    const worlds = json.map((entry, i): World => {
        const where = `LostHQ worlds[${i}]`;
        if (!isRecord(entry)) throw new Error(`${where}: expected an object`);
        const id = asId(entry.world, where);
        return {
            id,
            name: `World ${id}`,
            region: typeof entry.location === 'string' ? entry.location : null,
            members: typeof entry.p2p === 'boolean' ? entry.p2p : null,
            players: typeof entry.count === 'number' ? entry.count : null,
            origin: webOrigin(entry.ld, where)
        };
    });
    return finish(worlds, 'LostHQ worlds');
}

/** Zanaris's worlds.json. Player counts come separately, from each world's world.json. */
export function parseZanarisWorlds(json: unknown): World[] {
    if (!Array.isArray(json)) throw new Error('Zanaris worlds: expected a list');
    const worlds = json.map((entry, i): World => {
        const where = `Zanaris worlds[${i}]`;
        if (!isRecord(entry)) throw new Error(`${where}: expected an object`);
        const id = asId(entry.id, where);
        if (typeof entry.name !== 'string') throw new Error(`${where}: expected a name`);
        return {
            id,
            name: entry.name,
            region: typeof entry.region === 'string' ? entry.region : null,
            members: typeof entry.members === 'boolean' ? entry.members : null,
            players: null,
            origin: webOrigin(entry.url, where)
        };
    });
    return finish(worlds, 'Zanaris worlds');
}

export function parseZanarisWorldInfo(json: unknown): { players: number; maxPlayers: number } {
    if (!isRecord(json) || typeof json.players !== 'number' || typeof json.maxPlayers !== 'number') {
        throw new Error('world.json: expected players and maxPlayers');
    }
    return { players: json.players, maxPlayers: json.maxPlayers };
}

export function staticWorlds(source: { worlds: StaticWorld[] }): World[] {
    return source.worlds.map(w => ({ ...w, players: null, origin: null }));
}

// ── the dispatcher ────────────────────────────────────────────────────────

export type FetchJson = (url: string) => Promise<unknown>;

/** Lists a server's worlds. A failed player count leaves the world listed; a failed list rejects. */
export async function listWorlds(def: WorldsDef, fetchJson: FetchJson): Promise<World[]> {
    const { source } = def;
    switch (source.kind) {
        case 'static':
            return staticWorlds(source);
        case 'losthq':
            return parseLosthqWorlds(await fetchJson(source.url));
        case 'zanaris': {
            const worlds = parseZanarisWorlds(await fetchJson(source.url));
            return Promise.all(
                worlds.map(async world => {
                    try {
                        const info = parseZanarisWorldInfo(await fetchJson(`${world.origin}/world.json`));
                        return { ...world, players: info.players };
                    } catch {
                        return world;
                    }
                })
            );
        }
    }
}

// ── validation ────────────────────────────────────────────────────────────

function isStaticWorld(w: unknown): w is StaticWorld {
    return (
        isRecord(w) &&
        typeof w.id === 'number' &&
        Number.isInteger(w.id) &&
        typeof w.name === 'string' &&
        (w.region === null || typeof w.region === 'string') &&
        (w.members === null || typeof w.members === 'boolean')
    );
}

function isWebUrl(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    try {
        const u = new URL(value);
        return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
        return false;
    }
}

/** A worlds block that can actually be used: the template matches the source and the switch, and the default world exists. */
export function isWorldsDef(x: unknown): x is WorldsDef {
    if (!isRecord(x)) return false;
    if (typeof x.template !== 'string' || typeof x.detail !== 'boolean') return false;
    if (typeof x.defaultWorld !== 'number' || !Number.isInteger(x.defaultWorld) || x.defaultWorld <= 0) return false;
    const source = x.source;
    if (!isRecord(source)) return false;
    if (x.detail && !x.template.includes('{lowmem}')) return false;
    if (x.template.includes('{url}') && source.kind !== 'zanaris') return false;
    switch (source.kind) {
        case 'losthq':
        case 'zanaris':
            return isWebUrl(source.url);
        case 'static': {
            if (!Array.isArray(source.worlds) || source.worlds.length === 0) return false;
            if (!source.worlds.every(isStaticWorld)) return false;
            return source.worlds.some(w => w.id === x.defaultWorld);
        }
        default:
            return false;
    }
}
