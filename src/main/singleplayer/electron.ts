import { app, net, shell, utilityProcess } from 'electron';
import { randomBytes } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { SinglePlayerDeps, SpawnSpec, WorldProcess } from './service.ts';
import type { BuildStoreDeps } from './buildStore.ts';
import { bundledRecipes } from './recipes.ts';
import { readCommandsFile, type CommandRef } from '../../shared/commands.ts';
import { artifactUrl } from '../../shared/engines.ts';
import { downloadChecked, extractTgz } from '../download.ts';

/** Single player's folder: the builds, and one world folder per revision holding its characters. */
export function singlePlayerHome(): string {
    return join(app.getPath('userData'), 'singleplayer');
}

/**
 * The developer's own stage, offered as a build only while the kit runs from
 * source. A packaged kit runs nothing it did not download and check.
 */
function localBuild(): string | null {
    if (app.isPackaged) return null;
    const dir = join(app.getAppPath(), 'engine-dist');
    return existsSync(join(dir, 'VERSION.json')) ? dir : null;
}

/** A build's list of the content's debug procs, or null when it has none the kit can read. */
export function readCommands(resources: string): CommandRef[] | null {
    try {
        return readCommandsFile(readFileSync(join(resources, 'COMMANDS.json'), 'utf8'));
    } catch {
        return null;
    }
}

export function buildStoreDeps(log: (msg: string) => void): BuildStoreDeps {
    return {
        dir: join(singlePlayerHome(), 'builds'),
        recipes: bundledRecipes(),
        local: localBuild(),
        join,
        fs: {
            exists: existsSync,
            readText: path => readFileSync(path, 'utf8'),
            mkdir: path => mkdirSync(path, { recursive: true }),
            rm: path => rmSync(path, { recursive: true, force: true }),
            rename: renameSync
        },
        // net.fetch rather than Node's: it follows the system proxy, as the rest of the kit's requests do.
        download: (artifact, to, onProgress) =>
            downloadChecked({ url: artifactUrl(artifact), file: artifact.file, size: artifact.size, sha256: artifact.sha256, to, fetch: (url, init) => net.fetch(url, init), onProgress }),
        extract: extractTgz,
        log
    };
}

const PORT_REUSE_WINDOW_MS = 10_000;
/** A machine that keeps handing back the same port must not spin forever; the last one is taken. */
const PORT_ATTEMPTS = 8;

/** Ports handed out lately, so the world's three ports cannot collide with each other. */
const recentPorts = new Map<number, number>();

function listenForPort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            server.close(() => resolve(port));
        });
    });
}

/**
 * A port nothing is listening on. Each socket is closed before the next one
 * binds, so the OS is free to hand the same ephemeral port back twice in a
 * row; a port returned in the last ten seconds is refused and asked for again,
 * eight times over. After that the last one is taken rather than spun on: a
 * collision costs the world one failed bind, an unbounded loop costs the launch.
 */
export async function freePort(): Promise<number> {
    for (const [port, at] of recentPorts) {
        if (Date.now() - at >= PORT_REUSE_WINDOW_MS) recentPorts.delete(port);
    }
    let port = 0;
    for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
        port = await listenForPort();
        const at = recentPorts.get(port);
        if (at === undefined || Date.now() - at >= PORT_REUSE_WINDOW_MS) break;
    }
    recentPorts.set(port, Date.now());
    return port;
}

async function httpStatus(url: string): Promise<number | null> {
    try {
        return (await net.fetch(url, { signal: AbortSignal.timeout(2_000) })).status;
    } catch {
        return null;
    }
}

async function httpPost(url: string): Promise<number | null> {
    try {
        return (await net.fetch(url, { method: 'POST', signal: AbortSignal.timeout(2_000) })).status;
    } catch {
        return null;
    }
}

/**
 * The world as a utility process: Electron's own Node, no install needed.
 * stdout and stderr are split into lines for the log tail and world.log.
 */
function spawnWorld(spec: SpawnSpec): WorldProcess {
    const child = utilityProcess.fork(spec.entry, [], { cwd: spec.cwd, stdio: 'pipe', serviceName: 'single-player-world' });
    // A V8 fault the child cannot continue from; unhandled it would throw in the main process.
    child.on('error', (type, location) => spec.onLine(`[world ${type}] ${location}`));
    for (const stream of [child.stdout, child.stderr]) {
        if (stream) createInterface({ input: stream }).on('line', spec.onLine);
    }
    const exited = new Promise<number | null>(resolve => {
        child.once('exit', code => resolve(code));
    });
    return {
        exited,
        kill: () => {
            // kill() answers false until the child has a pid, so a stop that lands
            // in the moments after the fork has to wait for 'spawn' and ask again.
            if (!child.kill()) child.once('spawn', () => { child.kill(); });
        }
    };
}

/**
 * fs.watch on one directory, which is all the saves folder is. A watch that
 * errors, when the folder is removed, is closed and reported as a change; the
 * service also reads the folder on every status change, which covers what a
 * dead or unreliable watch misses.
 */
function watchDir(path: string, onChange: () => void): () => void {
    try {
        const watcher = watch(path, { persistent: false }, () => onChange());
        watcher.on('error', () => {
            watcher.close();
            onChange();
        });
        return () => watcher.close();
    } catch {
        return () => {};
    }
}

export function electronDeps(over: Pick<SinglePlayerDeps, 'baseUrl' | 'settings' | 'builds' | 'selection' | 'log'>): SinglePlayerDeps {
    return {
        worlds: join(singlePlayerHome(), 'worlds'),
        builds: over.builds,
        selection: over.selection,
        baseUrl: over.baseUrl,
        settings: over.settings,
        join,
        token: () => randomBytes(16).toString('hex'),
        fs: {
            exists: existsSync,
            readText: path => readFileSync(path, 'utf8'),
            writeText: (path, text) => writeFileSync(path, text),
            appendText: (path, text) => appendFileSync(path, text),
            mkdir: path => mkdirSync(path, { recursive: true }),
            rm: path => rmSync(path, { recursive: true, force: true }),
            rename: renameSync,
            // Asynchronous on purpose: cpSync here froze the main process for the
            // whole of the first launch's 42 MB.
            copyDir: (from, to) => cp(from, to, { recursive: true }),
            readBytes: path => readFileSync(path),
            writeBytes: (path, bytes) => writeFileSync(path, bytes),
            copyFile: (from, to) => copyFileSync(from, to),
            list: path => {
                try {
                    return readdirSync(path);
                } catch {
                    return [];
                }
            },
            stat: path => {
                try {
                    const stat = statSync(path);
                    return { size: stat.size, modified: stat.mtimeMs, isFile: stat.isFile() };
                } catch {
                    return null;
                }
            },
            // The system's own trash, so a deleted or replaced character can be put back outside the kit.
            trash: path => shell.trashItem(path),
            watchDir
        },
        freePort,
        spawn: spawnWorld,
        httpStatus,
        httpPost,
        sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
        now: Date.now,
        log: over.log
    };
}
