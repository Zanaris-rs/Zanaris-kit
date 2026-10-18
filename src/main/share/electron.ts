import { app, net } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { TorMode } from '../../shared/share.ts';
import { assetFor, CLOUDFLARED_VERSION, ensureCloudflared, isInstalled, type CloudflaredAsset } from './cloudflared.ts';
import { nodeOnionIo, waitOnionReachable } from './onionReachable.ts';
import { spawnProcess, startQuickTunnel, type TunnelProcess, type TunnelSpawnSpec } from './quickTunnel.ts';
import { nodeReachableIo, waitUntilReachable } from './reachable.ts';
import { startRelay } from './relay.ts';
import type { ShareDeps, ShareTransport, ShareTunnel } from './service.ts';
import { ensureTor, TOR_BUNDLE_VERSION, torAssetFor, torExecutable, torInstalled, type TorAsset } from './tor.ts';
import { startOnion, startTorClient, type TorIo } from './torProcess.ts';

const execFileAsync = promisify(execFile);

/** The pinned build for this machine, or null where Cloudflare publishes none. */
export const shareAsset: CloudflaredAsset | null = assetFor(process.platform, process.arch);

/** The pinned Tor for this machine, or null where Tor Project publishes none. */
export const torAsset: TorAsset | null = torAssetFor(process.platform, process.arch);

/** One folder per pinned version, beside the rest of the kit's data. */
function cloudflaredDir(): string {
    return join(app.getPath('userData'), 'cloudflared', CLOUDFLARED_VERSION);
}

/** One folder per pinned version, as cloudflared's is. The checked files sit in it; each run's folders sit in its `run/`. */
function torDir(): string {
    return join(app.getPath('userData'), 'tor', TOR_BUNDLE_VERSION);
}

function torRunDir(): string {
    return join(torDir(), 'run');
}

export function cloudflaredInstalled(): Promise<boolean> {
    return shareAsset ? isInstalled({ asset: shareAsset, dir: cloudflaredDir(), platform: process.platform }) : Promise.resolve(false);
}

/** True when every file the kit keeps of Tor is on disk and matches its pin. */
export function torFilesInstalled(): Promise<boolean> {
    return torAsset ? torInstalled({ asset: torAsset, dir: torDir() }) : Promise.resolve(false);
}

/**
 * Every cloudflared and Tor started and not yet gone, the probe client
 * included. The service stops them on a normal quit; this is for the exits
 * that skip it, so no tunnel outlives the kit pointing at a relay that no
 * longer exists.
 */
const running = new Set<TunnelProcess>();
process.on('exit', () => {
    for (const child of running) child.kill('SIGKILL');
});

function spawnTracked(spec: TunnelSpawnSpec): TunnelProcess {
    const child = spawnProcess(spec);
    running.add(child);
    void child.exited.then(() => running.delete(child));
    return child;
}

/**
 * The folders under `run/` this process made and has not removed yet. The
 * sweep at the start of a share over Tor removes every other one: what a kit
 * that crashed or was killed left behind.
 */
const runFolders = new Set<string>();

async function sweepRunDir(log: (msg: string) => void): Promise<void> {
    const dir = torRunDir();
    let names: string[];
    try {
        names = await readdir(dir);
    } catch {
        return;
    }
    for (const name of names) {
        const path = join(dir, name);
        if (runFolders.has(path)) continue;
        await rm(path, { recursive: true, force: true }).catch(err => log(`[share] removing a leftover Tor folder: ${String(err)}`));
    }
}

async function makeRunFolder(prefix: string): Promise<string> {
    await mkdir(torRunDir(), { recursive: true });
    const path = await mkdtemp(join(torRunDir(), prefix));
    runFolders.add(path);
    return path;
}

async function removeRunFolder(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true });
    runFolders.delete(path);
}

/** An empty file, which Tor reads as both its torrc and its defaults: Tor refuses `/dev/null` for either. */
function emptyTorrc(): string {
    mkdirSync(torDir(), { recursive: true });
    const path = join(torDir(), 'torrc');
    if (!existsSync(path) || statSync(path).size !== 0) writeFileSync(path, '');
    return path;
}

const CHANGED_ON_DISK = "Tor's files changed on disk; try again to download them afresh";

/**
 * What runs is what was checked, every share. On macOS the checked files are
 * copied into a run folder of their own and signed ad hoc there, since an
 * unsigned binary is not allowed to run and signing changes its bytes; the
 * copies are checked against the pins too, before they are signed, so nothing
 * that changed between the check and the copy runs. Elsewhere the checked
 * folder itself runs.
 */
async function prepareTor(asset: TorAsset, checkedDir: string, signal: AbortSignal): Promise<{ exe: string; libDir: string; release(): Promise<void> }> {
    if (!(await torInstalled({ asset, dir: checkedDir }))) throw new Error(CHANGED_ON_DISK);
    const exeName = torExecutable(asset);
    if (process.platform !== 'darwin') return { exe: join(checkedDir, exeName), libDir: checkedDir, release: async () => {} };
    const run = await makeRunFolder('bin-');
    try {
        const names = Object.keys(asset.files);
        for (const name of names) await copyFile(join(checkedDir, name), join(run, name));
        if (!(await torInstalled({ asset, dir: run }))) throw new Error(CHANGED_ON_DISK);
        await chmod(join(run, exeName), 0o755);
        for (const name of names) await execFileAsync('/usr/bin/codesign', ['--sign', '-', '--force', join(run, name)], { signal });
    } catch (err) {
        await removeRunFolder(run).catch(() => {});
        throw err;
    }
    return { exe: join(run, exeName), libDir: run, release: () => removeRunFolder(run) };
}

function torIo(asset: TorAsset): TorIo {
    return {
        env: process.env,
        platform: process.platform,
        spawn: spawnTracked,
        makeDataDir: async () => {
            const dir = await makeRunFolder('data-');
            // Tor refuses a data folder anyone else can read.
            await chmod(dir, 0o700);
            return dir;
        },
        removeDir: removeRunFolder,
        readHostname: async dataDir => {
            try {
                return await readFile(join(dataDir, 'hs', 'hostname'), 'utf8');
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
                throw err;
            }
        },
        prepare: (checkedDir, signal) => prepareTor(asset, checkedDir, signal)
    };
}

function cloudflareTransport(asset: CloudflaredAsset, log: (msg: string) => void): ShareTransport {
    const dir = cloudflaredDir();
    return {
        program: 'cloudflared',
        // net.fetch rather than Node's: it follows the system proxy, as the rest of the kit's requests do.
        ensureBinary: onProgress => ensureCloudflared({ asset, dir, platform: process.platform, fetch: (url, init) => net.fetch(url, init), onProgress }),
        startTunnel: async (binary, port, signal): Promise<ShareTunnel> => {
            mkdirSync(dir, { recursive: true });
            const configPath = join(dir, 'quick.yml');
            if (!existsSync(configPath)) writeFileSync(configPath, '{}\n');
            const tunnel = await startQuickTunnel({ env: process.env, spawn: spawnTracked }, { binary, port, configPath, signal });
            return { program: 'cloudflared', url: tunnel.url, exited: tunnel.exited, stop: tunnel.stop, logs: tunnel.logs };
        },
        waitReachable: (tunnel, probe, signal) => waitUntilReachable(nodeReachableIo(), { url: tunnel.url, probe, signal, log })
    };
}

/** What an onion tunnel's check needs beyond the tunnel itself. */
interface OnionInfo {
    checkedDir: string;
    /** The service Tor's own SOCKS port, under Hide me; null under Faster, which may have none. */
    socksPort: number | null;
}

function torTransport(asset: TorAsset, mode: TorMode, log: (msg: string) => void): ShareTransport {
    const io = torIo(asset);
    const onions = new WeakMap<ShareTunnel, OnionInfo>();
    return {
        program: 'tor',
        ensureBinary: async onProgress => {
            await sweepRunDir(log);
            // net.fetch rather than Node's: it follows the system proxy, as the rest of the kit's requests do.
            return ensureTor({ asset, dir: torDir(), fetch: (url, init) => net.fetch(url, init), onProgress });
        },
        startTunnel: async (checkedDir, relayPort, signal): Promise<ShareTunnel> => {
            const onion = await startOnion(io, { checkedDir, empty: emptyTorrc(), mode, relayPort, signal });
            const tunnel: ShareTunnel = { program: 'tor', url: onion.url, exited: onion.exited, stop: onion.stop, logs: onion.logs };
            onions.set(tunnel, { checkedDir, socksPort: onion.socksPort });
            return tunnel;
        },
        waitReachable: async (tunnel, probe, signal) => {
            const info = onions.get(tunnel);
            if (!info) throw new Error('That tunnel was not started over Tor');
            if (mode === 'full') {
                if (info.socksPort === null) throw new Error('Tor opened no SOCKS port to check the link through');
                return waitOnionReachable(nodeOnionIo(), { url: tunnel.url, socksPort: info.socksPort, probe, signal, log });
            }
            // A single-hop service cannot be a client, so a second Tor checks the link, and goes as soon as it has.
            const client = await startTorClient(io, { checkedDir: info.checkedDir, empty: emptyTorrc(), signal });
            try {
                await waitOnionReachable(nodeOnionIo(), { url: tunnel.url, socksPort: client.socksPort, probe, signal, log });
            } finally {
                await client.stop().catch(err => log(`[share] stopping Tor's probe client: ${String(err)}`));
            }
        }
    };
}

export function shareDeps(over: { worldPort: () => number | null; log: (msg: string) => void }): ShareDeps {
    const tor = torAsset;
    return {
        cloudflare: shareAsset ? cloudflareTransport(shareAsset, over.log) : null,
        tor: tor ? mode => torTransport(tor, mode, over.log) : null,
        startRelay: target => startRelay({ target }),
        worldPort: over.worldPort,
        log: over.log
    };
}
