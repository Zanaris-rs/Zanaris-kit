import { join } from 'node:path';
import type { TorMode } from '../../shared/share.ts';
import { stopper, TunnelError, type TunnelProcess, type TunnelSpawnSpec } from './quickTunnel.ts';

/**
 * Tor, run once per share: as an onion service forwarding to the relay, or as
 * a client whose only job is a SOCKS port the kit checks the link through.
 * The rules for running it are here, pure over an injected io; `prepare`
 * hands over the checked executable, which on macOS is a signed copy in a run
 * folder of its own.
 */

export interface TorIo {
    /** The environment Tor would inherit, before `torEnv`. */
    env: Record<string, string | undefined>;
    platform: string;
    /** The kit's own process id, which every Tor is told to outlive by no more than a poll. */
    pid: number;
    spawn(spec: TunnelSpawnSpec): TunnelProcess;
    /** A fresh, empty folder, mode 700, for one run's `--DataDirectory`. */
    makeDataDir(): Promise<string>;
    /**
     * The kept `--CacheDirectory` of this kind, once no other Tor holds it:
     * `cacheLeases` over a folder of each kind. Rejects if `signal` aborts
     * while it waits.
     */
    leaseCache(kind: TorCacheKind, signal: AbortSignal): Promise<CacheLease>;
    removeDir(dir: string): Promise<void>;
    /** The contents of `<dataDir>/hs/hostname`, or null while Tor has not written it. */
    readHostname(dataDir: string): Promise<string | null>;
    /** The executable to run from the checked files in `checkedDir`, and the folder its libraries are in. */
    prepare(checkedDir: string, signal: AbortSignal): Promise<{ exe: string; libDir: string; release(): Promise<void> }>;
}

export interface TorHandle {
    /** Settles when Tor ends, whether stopped or not. */
    readonly exited: Promise<number | null>;
    /** Asks Tor to stop and kills it after the grace period, then removes its data folder and the run folder. Safe to call again. */
    stop(): Promise<void>;
    /** The last lines Tor printed. */
    logs(): string[];
    /** The last line Tor printed, without its timestamp and level. */
    lastLine(): string;
}

/** Whose cache a Tor keeps: the onion service's, or the link checker's. */
export type TorCacheKind = 'service' | 'client';

export interface CacheLease {
    dir: string;
    /** Lets the next Tor of this kind have the folder. Safe to call again. */
    release(): void;
}

/**
 * Hands out each kind's cache folder to one Tor at a time. Tor locks the
 * folder while it runs, so a second Tor given it refuses to start; the next
 * lease of a kind waits until the last one is released, which a run does once
 * its Tor has exited. `make` answers the folder, creating it as Tor wants it.
 */
export function cacheLeases(make: (kind: TorCacheKind) => Promise<string>): (kind: TorCacheKind, signal: AbortSignal) => Promise<CacheLease> {
    const tails = new Map<TorCacheKind, Promise<void>>();
    return async (kind, signal) => {
        const before = tails.get(kind) ?? Promise.resolve();
        let release!: () => void;
        const mine = new Promise<void>(resolve => {
            release = resolve;
        });
        tails.set(kind, before.then(() => mine));
        try {
            await unlessAborted(before, signal);
            return { dir: await make(kind), release };
        } catch (err) {
            // The next lease still waits for the one before this, which `tails` chains it behind.
            release();
            throw err;
        }
    };
}

function unlessAborted(wait: Promise<void>, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new Error('aborted'));
    return new Promise((resolve, reject) => {
        const onAbort = (): void => reject(new Error('aborted'));
        signal.addEventListener('abort', onAbort, { once: true });
        void wait.then(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        });
    });
}

const LOG_LINES = 200;
/** One run on the owner's Mac reached its full onion 55 s after start; a Tor not bootstrapped by twice that is not going to be. */
const BOOT_TIMEOUT_MS = 120_000;
/**
 * The link checker's, longer: with no directory cache yet it can take minutes
 * to load the ~9000 relay descriptors it needs, and a cold first share has
 * none. The cache is kept after that, so later checkers bootstrap in seconds.
 * The check starts only once the checker is ready, so this time comes before
 * the check's own five minutes, not out of them.
 */
const CHECKER_BOOT_TIMEOUT_MS = 180_000;
const STOP_GRACE_MS = 5_000;
/** How often the hostname file is looked for between log lines. */
const POLL_MS = 500;
const BOOTSTRAPPED = /\bBootstrapped 100%/;
const SOCKS_READY = /Opened Socks listener connection \(ready\) on 127\.0\.0\.1:(\d+)/;
/** A v3 onion address: 56 base32 characters. */
const ONION = /^[a-z2-7]{56}\.onion$/;
/** `Oct 18 19:36:15.000 [notice] `, the front of every line Tor logs. */
const STAMP = /^[A-Z][a-z]{2} +\d+ [\d:.]+ \[\w+\] /;

/**
 * - `-f` and `--defaults-torrc` name an empty file, so no system or user
 *   torrc is read. Tor refuses `/dev/null` for either.
 * - `--DataDirectory` is fresh per run, and the service's keys live inside
 *   it, so every share has a new address.
 * - `--CacheDirectory` is kept between runs, one for the onion service and
 *   one for the link checker. It holds the directory Tor downloads before it
 *   can do anything — the consensus and the relays' descriptors, public and
 *   the same for every Tor — so a start with it warm skips most of a
 *   bootstrap. Nothing in it says who ran it or which address it served: the
 *   keys stay in the data folder, which goes with its share.
 * - `__OwningControllerProcess` names the kit's process, which Tor polls and
 *   exits once it has gone, so a kit that crashed or was killed leaves no Tor
 *   running. It needs no control port.
 * - `--SocksPort auto` binds a free port on 127.0.0.1. The single-hop mode
 *   refuses to start with a SOCKS port, so it has `0`.
 * - `--HiddenServicePort` is one argument: the virtual port and the target.
 */
export function buildTorArgs(opts: { empty: string; dataDir: string; cacheDir: string; ownerPid: number; mode: TorMode | 'client'; relayPort?: number }): string[] {
    const args = [
        '-f',
        opts.empty,
        '--defaults-torrc',
        opts.empty,
        '--DataDirectory',
        opts.dataDir,
        '--CacheDirectory',
        opts.cacheDir,
        '__OwningControllerProcess',
        String(opts.ownerPid),
        '--Log',
        'notice stdout'
    ];
    if (opts.mode === 'client') return [...args, '--SocksPort', 'auto'];
    if (opts.relayPort === undefined) throw new Error('An onion service needs the relay port');
    args.push('--SocksPort', opts.mode === 'single' ? '0' : 'auto');
    args.push('--HiddenServiceDir', join(opts.dataDir, 'hs'), '--HiddenServicePort', `80 127.0.0.1:${opts.relayPort}`);
    if (opts.mode === 'single') args.push('--HiddenServiceSingleHopMode', '1', '--HiddenServiceNonAnonymousMode', '1');
    return args;
}

/**
 * Tor's settings all come from its torrc and command line, which
 * `buildTorArgs` decides; the variables that could still change what runs
 * are the dynamic loader's, so every `LD_*` and `DYLD_*` is dropped. The
 * Linux build then needs `LD_LIBRARY_PATH` to find the libevent beside it,
 * having no `$ORIGIN` runpath; the macOS one finds its dylib through
 * `@executable_path`, and Windows looks beside the executable.
 */
export function torEnv(env: Record<string, string | undefined>, platform: string, libDir: string): Record<string, string> {
    const kept: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        if (value === undefined) continue;
        const upper = key.toUpperCase();
        if (upper.startsWith('LD_') || upper.startsWith('DYLD_')) continue;
        kept[key] = value;
    }
    if (platform === 'linux') kept.LD_LIBRARY_PATH = libDir;
    return kept;
}

/** Reads bootstrap, the SOCKS port Tor picked, and its last line without the timestamp and level. */
export function createTorLogParser(): { push(line: string): void; bootstrapped(): boolean; socksPort(): number | null; lastLine(): string } {
    let bootstrapped = false;
    let socksPort: number | null = null;
    let last = '';
    return {
        push(raw) {
            const line = raw.replace(/\r$/, '');
            if (BOOTSTRAPPED.test(line)) bootstrapped = true;
            const socks = SOCKS_READY.exec(line);
            if (socks && socksPort === null) socksPort = Number(socks[1]);
            const trimmed = line.replace(STAMP, '').trim();
            if (trimmed) last = trimmed;
        },
        bootstrapped: () => bootstrapped,
        socksPort: () => socksPort,
        lastLine: () => last
    };
}

interface RunOptions {
    checkedDir: string;
    empty: string;
    signal: AbortSignal;
    bootTimeoutMs?: number;
    stopGraceMs?: number;
}

/**
 * Starts an onion service forwarding port 80 to `127.0.0.1:<relayPort>`,
 * resolving once Tor has written the address and bootstrapped. `full` also
 * reports its SOCKS port, which the kit checks the link through.
 */
export async function startOnion(
    io: TorIo,
    opts: RunOptions & { mode: TorMode; relayPort: number }
): Promise<TorHandle & { url: string; socksPort: number | null }> {
    const run = await runTor(io, opts, opts.mode, opts.relayPort);
    return { ...run.handle, url: `http://${run.hostname!}`, socksPort: run.socksPort };
}

/** Starts the link checker, a Tor with no service, resolving with its SOCKS port once it has bootstrapped. */
export async function startTorClient(io: TorIo, opts: RunOptions): Promise<TorHandle & { socksPort: number }> {
    const run = await runTor(io, { ...opts, bootTimeoutMs: opts.bootTimeoutMs ?? CHECKER_BOOT_TIMEOUT_MS }, 'client');
    return { ...run.handle, socksPort: run.socksPort! };
}

/**
 * Checks an onion link through a link checker of its own, which goes as soon
 * as `wait` settles: `wait` is handed the checker's SOCKS port and a signal
 * that aborts with `opts.signal` or when the checker ends. A checker that
 * exits while the link is checked fails the check at once, rather than
 * leaving `wait` to ask a closed port until its deadline.
 */
export async function checkThroughClient(
    io: TorIo,
    opts: RunOptions & { wait(socksPort: number, signal: AbortSignal): Promise<void>; log(msg: string): void }
): Promise<void> {
    const client = await startTorClient(io, opts);
    const checking = new AbortController();
    const cancel = (): void => checking.abort();
    if (opts.signal.aborted) cancel();
    opts.signal.addEventListener('abort', cancel, { once: true });
    const exited = client.exited.then(code => {
        throw new TunnelError(`Tor's link checker exited (code ${code})${client.lastLine() ? `: ${client.lastLine()}` : ''}`, client.logs());
    });
    const waiting = opts.wait(client.socksPort, checking.signal);
    // Whichever loses the race settles later, with nobody listening.
    exited.catch(() => {});
    waiting.catch(() => {});
    try {
        await Promise.race([waiting, exited]);
    } finally {
        opts.signal.removeEventListener('abort', cancel);
        checking.abort();
        await client.stop().catch(err => opts.log(`[share] stopping Tor's link checker: ${String(err)}`));
    }
}

interface Run {
    handle: TorHandle;
    hostname: string | null;
    socksPort: number | null;
}

async function runTor(io: TorIo, opts: RunOptions, mode: TorMode | 'client', relayPort?: number): Promise<Run> {
    const cancelled = (logs: string[]): TunnelError => new TunnelError('Sharing was cancelled', logs);
    if (opts.signal.aborted) throw cancelled([]);
    let prepared: Awaited<ReturnType<TorIo['prepare']>>;
    try {
        prepared = await io.prepare(opts.checkedDir, opts.signal);
    } catch (err) {
        if (opts.signal.aborted) throw cancelled([]);
        throw err;
    }
    let dataDir: string;
    try {
        dataDir = await io.makeDataDir();
    } catch (err) {
        await prepared.release().catch(() => {});
        throw err;
    }
    const service = mode !== 'client';
    let lease: CacheLease | null = null;
    // Runs once Tor is gone, or was never started: only then may the next Tor of its kind have the cache.
    const tidy = async (): Promise<void> => {
        try {
            await io.removeDir(dataDir);
        } finally {
            lease?.release();
            await prepared.release();
        }
    };
    try {
        lease = await io.leaseCache(service ? 'service' : 'client', opts.signal);
    } catch (err) {
        await tidy().catch(() => {});
        if (opts.signal.aborted) throw cancelled([]);
        throw err;
    }
    if (opts.signal.aborted) {
        await tidy().catch(() => {});
        throw cancelled([]);
    }
    const cacheDir = lease.dir;
    /** Who a failure names: the onion service is Tor itself, the client is only there to check its link. */
    const who = service ? 'Tor' : "Tor's link checker";

    const wantsSocks = mode !== 'single';
    const logs: string[] = [];
    const parser = createTorLogParser();
    let hostname: string | null = null;
    let reading = false;
    let changed = (): void => {};
    // Looks for the address once at a time; a read that finds a half-written file finds it whole on a later one.
    const look = (): void => {
        if (!service || hostname !== null || reading) return;
        reading = true;
        void io
            .readHostname(dataDir)
            .then(text => {
                const name = text?.trim() ?? '';
                if (ONION.test(name)) hostname = name;
            })
            .catch(() => {})
            .finally(() => {
                reading = false;
                changed();
            });
    };

    let proc: TunnelProcess;
    try {
        proc = io.spawn({
            command: prepared.exe,
            args: buildTorArgs({ empty: opts.empty, dataDir, cacheDir, ownerPid: io.pid, mode, relayPort }),
            env: torEnv(io.env, io.platform, prepared.libDir),
            stream: 'stdout',
            onLine: line => {
                logs.push(line);
                if (logs.length > LOG_LINES) logs.shift();
                parser.push(line);
                look();
                changed();
            }
        });
    } catch (err) {
        // Node throws rather than emitting 'error' for some bad spawns, a NUL in an argument among them.
        await tidy().catch(() => {});
        throw new TunnelError(`${who} could not be started: ${err instanceof Error ? err.message : String(err)}`, [...logs]);
    }
    const kill = stopper(proc, opts.stopGraceMs ?? STOP_GRACE_MS);
    let stopping: Promise<void> | null = null;
    const stop = (): Promise<void> => {
        stopping ??= kill().then(tidy);
        return stopping;
    };
    const handle: TorHandle = { exited: proc.exited, stop, logs: () => [...logs], lastLine: () => parser.lastLine() };
    const timeoutMs = opts.bootTimeoutMs ?? BOOT_TIMEOUT_MS;
    const ending = (): string => (parser.lastLine() ? `: ${parser.lastLine()}` : '');

    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (then: () => void): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            clearInterval(poll);
            opts.signal.removeEventListener('abort', onAbort);
            changed = () => {};
            then();
        };
        // A Tor that is not ready is never left running, or its folders on disk, behind a rejection.
        const give = (err: TunnelError): void =>
            finish(() =>
                void stop()
                    .catch(() => {})
                    .then(() => reject(err))
            );
        const timer = setTimeout(() => give(new TunnelError(`${who} was not ready within ${Math.round(timeoutMs / 1000)} s${ending()}`, [...logs])), timeoutMs);
        const poll = setInterval(look, POLL_MS);
        const onAbort = (): void => give(cancelled([...logs]));
        opts.signal.addEventListener('abort', onAbort, { once: true });
        changed = () => {
            if (!parser.bootstrapped()) return;
            if (service && hostname === null) return;
            if (wantsSocks && parser.socksPort() === null) return;
            finish(() => resolve({ handle, hostname, socksPort: parser.socksPort() }));
        };
        look();
        void proc.exited.then(code => give(new TunnelError(`${who} exited (code ${code}) before it was ready${ending()}`, [...logs])));
    });
}
