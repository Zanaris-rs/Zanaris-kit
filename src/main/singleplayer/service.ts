import type { SinglePlayerStatus, SinglePlayerVersion, SinglePlayerView } from '../../shared/singleplayer.ts';
import { gameUrl, LOG_TAIL_LINES, parseVersion, stampMatches, worldJson, type WorldPorts } from './config.ts';

export interface WorldProcess {
    /** Resolves with the exit code, null when killed, once the process is gone. */
    readonly exited: Promise<number | null>;
    kill(): void;
}

export interface SpawnSpec {
    entry: string;
    cwd: string;
    onLine: (line: string) => void;
}

export interface SinglePlayerDeps {
    /** resources/engine, or engine-dist in dev. */
    resources: string;
    /** <userData>/singleplayer */
    home: string;
    /** The catalog entry's url; the port is applied at start. */
    baseUrl: string;
    cheats: { get(): boolean; set(on: boolean): void };
    join(...parts: string[]): string;
    fs: {
        exists(path: string): boolean;
        readText(path: string): string;
        writeText(path: string, text: string): void;
        appendText(path: string, text: string): void;
        mkdir(path: string): void;
        /** Recursive, and quiet when the path is absent. */
        rm(path: string): void;
        rename(from: string, to: string): void;
        /** Asynchronous: the trees are tens of megabytes, and the main process has to stay live. */
        copyDir(from: string, to: string): Promise<void>;
    };
    freePort(): Promise<number>;
    spawn(spec: SpawnSpec): WorldProcess;
    httpStatus(url: string): Promise<number | null>;
    httpPost(url: string): Promise<number | null>;
    sleep(ms: number): Promise<void>;
    now(): number;
    log(msg: string): void;
}

const ASSET_TREES = ['data/pack', 'data/raw', 'public', 'view'];
/** One name, not a timestamped one: a copy that died leaves this behind, and the next prepare removes it. */
const STAGING_DIR = '.staging';
const PEMS = ['data/config/private.pem', 'data/config/public.pem'];
const READY_TIMEOUT_MS = 60_000;
const POLL_MS = 250;
const STOP_GRACE_MS = 10_000;

class Failure extends Error {}

/**
 * One world for every single-player window. Windows acquire and release;
 * the first acquire starts the world, the last release stops it. Pure over
 * the deps so the whole lifecycle runs under node:test with fakes.
 */
export class SinglePlayerService {
    private status: SinglePlayerStatus = 'stopped';
    private ports: WorldPorts | null = null;
    private url: string | null = null;
    private reason: string | null = null;
    private logTail: string[] = [];
    private version: SinglePlayerVersion | null = null;
    private process: WorldProcess | null = null;
    private windows = 0;
    private starting: Promise<string> | null = null;
    private stopping: Promise<void> | null = null;
    /** Bumped by every start, so a stop can tell whether the world is still the one it took. */
    private generation = 0;
    private readonly listeners = new Set<() => void>();
    private readonly deps: SinglePlayerDeps;

    constructor(deps: SinglePlayerDeps) {
        this.deps = deps;
    }

    view(): SinglePlayerView {
        return {
            status: this.status,
            port: this.ports?.web ?? null,
            url: this.status === 'ready' ? this.url : null,
            reason: this.status === 'failed' ? this.reason : null,
            logTail: [...this.logTail],
            version: this.version,
            cheats: this.deps.cheats.get()
        };
    }

    subscribe(fn: () => void): () => void {
        this.listeners.add(fn);
        return () => void this.listeners.delete(fn);
    }

    /** A window wants the world. Resolves with the game url; rejects when it cannot start. */
    async acquire(): Promise<string> {
        this.windows++;
        return this.ensure();
    }

    /** That window is gone. The last one stops the world. */
    release(): void {
        this.windows = Math.max(0, this.windows - 1);
        if (this.windows === 0 && this.status !== 'stopped' && this.status !== 'failed') void this.stop();
    }

    /** From failed: try again for the windows already counted. */
    retry(): Promise<string> {
        return this.ensure();
    }

    async setCheats(on: boolean): Promise<void> {
        this.deps.cheats.set(on);
        this.notify();
        if (this.status === 'ready' || this.status === 'starting' || this.status === 'preparing') {
            await this.stop();
            if (this.windows > 0) await this.ensure().catch(() => undefined);
        }
    }

    /** Quit, or a restart: stops whatever is running, regardless of windows. */
    async stop(): Promise<void> {
        if (this.stopping) return this.stopping;
        // 'failed' can still own a live world — an explicit stop has to be able to reap it.
        if (this.status === 'stopped' && !this.process) return;
        this.stopping = this.doStop().finally(() => {
            this.stopping = null;
        });
        return this.stopping;
    }

    // ── internals ────────────────────────────────────────────────────────

    private ensure(): Promise<string> {
        if (this.status === 'ready' && this.url) return Promise.resolve(this.url);
        if (this.starting) return this.starting;
        // A stop in flight owns the world's state until it finishes; queue behind it,
        // or its tail would clear the ports and url this start is about to establish.
        // The window that queued this can close while the stop runs, and a world
        // started for nobody would never be released — so refuse when none is left.
        if (this.stopping) return this.stopping.then(() => (this.windows === 0 ? Promise.reject(new Failure('No window is waiting for the world')) : this.ensure()));
        this.starting = this.start().finally(() => {
            this.starting = null;
        });
        return this.starting;
    }

    private set(status: SinglePlayerStatus): void {
        this.status = status;
        this.notify();
    }

    private notify(): void {
        for (const fn of this.listeners) {
            // A window that went away mid-send must not take the world down with it.
            try {
                fn();
            } catch (err) {
                this.deps.log(`[singleplayer] a status listener threw: ${String(err)}`);
            }
        }
    }

    /** True once a stop has taken the world away from a start still in flight. */
    private stopped(): boolean {
        return this.status === 'stopping' || this.status === 'stopped';
    }

    private fail(reason: string): never {
        this.reason = reason;
        this.set('failed');
        this.deps.log(`[singleplayer] ${reason}`);
        throw new Failure(reason);
    }

    private async start(): Promise<string> {
        this.generation++;
        let spawned: WorldProcess | null = null;
        try {
            const { deps } = this;
            const { fs, join } = deps;
            this.reason = null;
            this.logTail = [];

            this.set('preparing');
            const versionPath = join(deps.resources, 'VERSION.json');
            if (!fs.exists(versionPath)) this.fail('Engine not staged: run npm run stage:engine');
            const versionText = fs.readText(versionPath);
            const version = parseVersion(versionText);
            if (!version) this.fail(`${versionPath} is not a VERSION.json the kit understands`);
            this.version = version;
            const stampPath = join(deps.home, 'engine.stamp');
            const stamp = fs.exists(stampPath) ? fs.readText(stampPath) : null;
            if (!stampMatches(stamp, versionText)) {
                try {
                    await this.copyAssets(versionText);
                } catch (err) {
                    this.fail(`Could not copy the engine's files: ${String(err)}`);
                }
            }
            if (this.status !== 'preparing') throw new Failure('Stopped while getting ready');

            this.set('starting');
            const ports: WorldPorts = { web: await deps.freePort(), management: await deps.freePort(), tcp: await deps.freePort() };
            this.ports = ports;
            const url = gameUrl(deps.baseUrl, ports.web);
            fs.mkdir(join(deps.home, 'data', 'config'));
            fs.writeText(join(deps.home, 'data', 'config', 'world.json'), worldJson({ ports, cheats: deps.cheats.get(), revision: version.revision }));
            const logPath = join(deps.home, 'world.log');
            fs.writeText(logPath, '');
            const process = deps.spawn({
                entry: join(deps.resources, 'src', 'app.js'),
                cwd: deps.home,
                onLine: line => {
                    this.logTail.push(line);
                    if (this.logTail.length > LOG_TAIL_LINES) this.logTail.shift();
                    // This runs inside readline's 'line' event: a full disk, or an editor
                    // holding world.log open on Windows, would otherwise throw out of a
                    // stream handler and take the main process — every window — down.
                    // The tail above still has the line, which is what the panel shows.
                    try {
                        fs.appendText(logPath, `${line}\n`);
                    } catch {
                        // nothing to do but keep the world running
                    }
                }
            });
            spawned = process;
            this.process = process;
            let exit: number | null | undefined;
            void process.exited.then(code => {
                exit = code;
                this.onExit(process, code);
            });

            // A deliberate stop or a newer start already owns the status, so those reject
            // this start without reporting a failure; a world that died on its own does.
            // Checked both before the probe and after it answers, since the world can die
            // in that gap and a 200 from a dead world is not a world that is ready.
            const guard = (): void => {
                if (this.stopped()) throw new Failure('Stopped while starting');
                if (exit !== undefined) this.fail(`The world exited before it was ready (code ${exit})`);
                if (this.process !== process) throw new Failure('Stopped while starting');
            };
            const deadline = deps.now() + READY_TIMEOUT_MS;
            while (deps.now() < deadline) {
                guard();
                if ((await deps.httpStatus(url)) === 200) {
                    guard();
                    this.url = url;
                    this.set('ready');
                    deps.log(`[singleplayer] ready on port ${ports.web}`);
                    return url;
                }
                await deps.sleep(POLL_MS);
            }
            process.kill();
            this.process = null;
            this.fail(`The world did not answer within ${READY_TIMEOUT_MS / 1000} s`);
        } catch (err) {
            // Never leave a world behind: while this start's process is still ours, no
            // one else can reap it, and a failed status would hide it from stop().
            if (spawned && this.process === spawned) {
                this.process = null;
                spawned.kill();
            }
            if (err instanceof Failure) throw err;
            this.fail(String(err));
        }
    }

    /**
     * Copies the four trees and the pems into a staging directory, then swaps them
     * into place. The copy is asynchronous — 42 MB of it, on the first launch, would
     * otherwise freeze the main process. The swap stays synchronous: it is a handful
     * of renames, and nothing may interleave between them.
     */
    private async copyAssets(versionText: string): Promise<void> {
        const { fs, join, home, resources } = this.deps;
        const staging = join(home, STAGING_DIR);
        fs.rm(staging);
        for (const tree of ASSET_TREES) await fs.copyDir(join(resources, tree), join(staging, tree));
        for (const pem of PEMS) {
            fs.mkdir(join(staging, 'data', 'config'));
            fs.writeText(join(staging, pem), fs.readText(join(resources, pem)));
        }
        fs.mkdir(join(home, 'data', 'config'));
        for (const tree of ASSET_TREES) {
            fs.rm(join(home, tree));
            fs.rename(join(staging, tree), join(home, tree));
        }
        for (const pem of PEMS) fs.rename(join(staging, pem), join(home, pem));
        fs.writeText(join(home, 'engine.stamp'), versionText);
        fs.rm(staging);
    }

    private onExit(process: WorldProcess, code: number | null): void {
        if (this.process !== process) return;
        this.process = null;
        if (this.status === 'ready') {
            this.reason = `The world stopped unexpectedly (code ${code})`;
            this.set('failed');
            this.deps.log(`[singleplayer] ${this.reason}`);
        }
    }

    private async doStop(): Promise<void> {
        const process = this.process;
        const ports = this.ports;
        const generation = this.generation;
        this.set('stopping');
        if (process && ports && this.url) {
            this.process = null;
            await this.deps.httpPost(`http://127.0.0.1:${ports.management}/shutdown`).catch(() => null);
            const grace = this.deps.sleep(STOP_GRACE_MS).then(() => 'timeout' as const);
            const outcome = await Promise.race([process.exited.then(() => 'exited' as const), grace]);
            if (outcome === 'timeout') {
                this.deps.log('[singleplayer] the world did not stop in time; killing it');
                process.kill();
                await process.exited;
            }
        } else if (process) {
            this.process = null;
            process.kill();
            await process.exited;
        }
        // If a newer start took the world over while this stop waited, the state is
        // no longer this stop's to erase.
        if (this.generation !== generation) return;
        this.url = null;
        this.ports = null;
        this.set('stopped');
    }
}
