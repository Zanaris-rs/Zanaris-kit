// Pure helpers for scripts/stage-engine.mjs, kept apart so they can be tested
// over fixtures without cloning or packing anything.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * The engine starts its worker threads with new Worker(new URL('./x.ts',
 * import.meta.url)). After transpiling, those files are .js. Only the path
 * inside a new URL( call is touched; any other '.ts' string is left alone.
 */
export function rewriteWorkerUrls(code) {
    return code.replace(/new URL\((\s*)(['"`])([^'"`]+?)\.ts\2/g, (_m, ws, q, path) => `new URL(${ws}${q}${path}.js${q}`);
}

/** True when a new URL( call still names a .ts file. */
export function hasTsUrl(code) {
    return /new URL\(\s*['"`][^'"`]+\.ts['"`]/.test(code);
}

/**
 * What to do with one file under src/ or tools/, by its path relative to that root:
 * 'transform' every .ts, 'copy' everything else.
 *
 * .d.ts files are transformed like any other .ts rather than skipped, because the
 * engine's are not ambient declarations: World imports the login response type
 * guards as values from '#/server/login/index.d.js', so that file has to ship as
 * JavaScript. A types-only declaration transpiles to an empty module, which is
 * harmless - `index.d.ts` becomes the `index.d.js` the imports already name.
 */
export function classify(relPath) {
    if (relPath.endsWith('.ts')) return 'transform';
    return 'copy';
}

/**
 * The checks the fleet's build.sh makes before it trusts a pack: nine
 * archives in idx0 (six bytes each), the server scripts, the server maps.
 */
export function assertPack(packDir, fs = { existsSync, statSync }) {
    const idx0 = join(packDir, 'main_file_cache.idx0');
    if (!fs.existsSync(idx0)) throw new Error(`missing ${idx0} - did the pack fail?`);
    const size = fs.statSync(idx0).size;
    if (size % 6 !== 0) throw new Error(`${idx0} is ${size} bytes, not a multiple of 6`);
    const archives = size / 6;
    if (archives !== 9) throw new Error(`expected 9 cache archives in idx0, found ${archives}`);
    for (const required of [join('server', 'script.dat'), join('.cache', 'maps-server.zip')]) {
        const path = join(packDir, required);
        if (!fs.existsSync(path)) throw new Error(`missing ${path}`);
    }
    return { archives };
}

/** Every *.node under dir, as forward-slash paths relative to dir. Empty means no native modules. */
export function findNativeModules(dir) {
    const found = [];
    const walk = current => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const path = join(current, entry.name);
            if (entry.isDirectory()) walk(path);
            else if (entry.name.endsWith('.node')) found.push(relative(dir, path).split(sep).join('/'));
        }
    };
    walk(dir);
    return found;
}

/**
 * Every symbolic link under dir, as forward-slash paths relative to dir, none
 * of them followed. Empty means the tree can be archived and unpacked the same
 * everywhere: Windows' tar cannot make a link without the privilege to.
 */
export function findSymlinks(dir) {
    const found = [];
    const walk = current => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const path = join(current, entry.name);
            if (entry.isSymbolicLink()) found.push(relative(dir, path).split(sep).join('/'));
            else if (entry.isDirectory()) walk(path);
        }
    };
    walk(dir);
    return found;
}

/**
 * The static NPC count from a booted world's output, or null when the world never
 * loaded a game map. GameMap.init() prints "<added>/<max> static NPCs added" as its
 * last act; when `<build.srcDir>/maps` is missing it returns before any of that, and
 * the world still serves /rs2.cgi and reports itself ready with nothing in it.
 *
 * The last match wins, so a re-read of the map cannot be mistaken for the first.
 */
export function staticNpcs(output) {
    const matches = [...output.matchAll(/(\d+)\s*\/\s*\d+\s+static NPCs added/g)];
    if (matches.length === 0) return null;
    return Number(matches[matches.length - 1][1]);
}

/**
 * Every *.patch in dir, sorted by name, as { name, sha256 }. The order is the
 * order they are applied in, so it has to be the sorted one and not the
 * directory's. A missing directory is no patches, not an error: the day Lost
 * City merges these upstream, the directory goes away.
 */
export function readPatches(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter(name => name.endsWith('.patch'))
        .sort()
        .map(name => ({ name, sha256: createHash('sha256').update(readFileSync(join(dir, name))).digest('hex') }));
}

/**
 * One line identifying a patch set, written beside the engine checkout and
 * compared on the next run. An edited patch changes the digest, which throws
 * the checkout away rather than applying the new patch on top of the old one.
 */
export function patchStamp(patches) {
    return patches.map(({ name, sha256 }) => `${name} ${sha256}`).join('\n');
}

/** The patch set in eight hex digits, for a build's tag: the start of the stamp's sha-256. */
export function patchHash(patches) {
    return createHash('sha256').update(patchStamp(patches)).digest('hex').slice(0, 8);
}

/**
 * A debug proc declaration: `[debugproc,name]` at the start of a line, then
 * perhaps `(type $name, ...)`, then the rest of the line. A few procs are one
 * line long, with their code after the brackets.
 */
const DEBUGPROC = /^\[debugproc,([a-z0-9_]+)\](?:\(([^)]*)\))?(.*)$/;

/** Folders under content/scripts/_test/scripts, most useful first; any other group follows them. */
const GROUP_ORDER = ['cheats', 'debug', 'engine'];

/**
 * The debug procs one .rs2 file declares, as { kind, name, params, note, group }.
 * `file` is the script's path under content/scripts with forward slashes, and
 * gives the group. A note is whatever follows `//` on the declaring line.
 */
export function parseDebugprocs(text, file) {
    const group = debugprocGroup(file);
    const found = [];
    for (const line of text.split(/\r?\n/)) {
        const match = DEBUGPROC.exec(line);
        if (!match) continue;
        const [, name, params = '', rest] = match;
        const at = rest.indexOf('//');
        const note = at === -1 ? null : rest.slice(at + 2).trim() || null;
        found.push({ kind: 'debugproc', name, params: parseParams(params), note, group });
    }
    return found;
}

/** `stat $stat, int $amount` as [{ type, name }]; anything else is kept whole as the name. */
function parseParams(text) {
    return text
        .split(',')
        .map(part => part.trim())
        .filter(part => part !== '')
        .map(part => {
            const match = /^(\S+)\s+\$(\S+)$/.exec(part);
            return match ? { type: match[1], name: match[2] } : { type: 'value', name: part };
        });
}

/** The folder under `_test/scripts/` for the test scripts (cheats, debug, engine), and the first folder for anything else (quests). */
export function debugprocGroup(file) {
    const parts = file.split('/');
    if (parts[0] === '_test' && parts[1] === 'scripts' && parts.length > 3) return parts[2];
    return parts[0];
}

/**
 * COMMANDS.json's text: every debug proc, cheats first, then the other test
 * folders, then the rest, each group by name. The content compiler refuses a
 * name declared twice, so meeting one here means this parser misread a file.
 */
export function commandsJson(procs) {
    const seen = new Set();
    for (const proc of procs) {
        if (seen.has(proc.name)) throw new Error(`debugproc ${proc.name} is declared twice`);
        seen.add(proc.name);
    }
    const rank = group => {
        const at = GROUP_ORDER.indexOf(group);
        return at === -1 ? GROUP_ORDER.length : at;
    };
    const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    const sorted = [...procs].sort((a, b) => rank(a.group) - rank(b.group) || byCode(a.group, b.group) || byCode(a.name, b.name));
    return `${JSON.stringify({ version: 1, debugprocs: sorted }, null, 4)}\n`;
}
