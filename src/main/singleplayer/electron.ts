import { app, net, utilityProcess } from 'electron';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { SinglePlayerDeps, SpawnSpec, WorldProcess } from './service.ts';

/** The staged engine: beside the app's asar when packaged, engine-dist/ in dev. */
export function engineResources(): string {
    return app.isPackaged ? join(process.resourcesPath, 'engine') : join(app.getAppPath(), 'engine-dist');
}

/** Where the world runs and the saves live. */
export function singlePlayerHome(): string {
    return join(app.getPath('userData'), 'singleplayer');
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

export function electronDeps(over: { baseUrl: string; cheats: SinglePlayerDeps['cheats']; log: (msg: string) => void }): SinglePlayerDeps {
    return {
        resources: engineResources(),
        home: singlePlayerHome(),
        baseUrl: over.baseUrl,
        cheats: over.cheats,
        join,
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
            copyDir: (from, to) => cp(from, to, { recursive: true })
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
