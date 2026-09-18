import { app, net } from 'electron';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assetFor, CLOUDFLARED_VERSION, ensureCloudflared, isInstalled, type CloudflaredAsset } from './cloudflared.ts';
import { spawnProcess, startQuickTunnel, type TunnelProcess, type TunnelSpawnSpec } from './quickTunnel.ts';
import { nodeReachableIo, waitUntilReachable } from './reachable.ts';
import { startRelay } from './relay.ts';
import type { ShareDeps } from './service.ts';

/** The pinned build for this machine, or null where Cloudflare publishes none. */
export const shareAsset: CloudflaredAsset | null = assetFor(process.platform, process.arch);

/** One folder per pinned version, beside the rest of the kit's data. */
function cloudflaredDir(): string {
    return join(app.getPath('userData'), 'cloudflared', CLOUDFLARED_VERSION);
}

export function cloudflaredInstalled(): Promise<boolean> {
    return shareAsset ? isInstalled({ asset: shareAsset, dir: cloudflaredDir(), platform: process.platform }) : Promise.resolve(false);
}

/**
 * Every cloudflared started and not yet gone. The service stops them on a
 * normal quit; this is for the exits that skip it, so no tunnel outlives the
 * kit pointing at a relay that no longer exists.
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

export function shareDeps(over: { worldPort: () => number | null; log: (msg: string) => void }): ShareDeps {
    const dir = cloudflaredDir();
    return {
        asset: shareAsset,
        ensureBinary: onProgress => {
            if (!shareAsset) return Promise.reject(new Error('Cloudflare publishes no cloudflared for this system'));
            // net.fetch rather than Node's: it follows the system proxy, as the rest of the kit's requests do.
            return ensureCloudflared({ asset: shareAsset, dir, platform: process.platform, fetch: (url, init) => net.fetch(url, init), onProgress });
        },
        startRelay: target => startRelay({ target }),
        startTunnel: (binary, port, signal) => {
            mkdirSync(dir, { recursive: true });
            const configPath = join(dir, 'quick.yml');
            if (!existsSync(configPath)) writeFileSync(configPath, '{}\n');
            return startQuickTunnel({ env: process.env, spawn: spawnTracked }, { binary, port, configPath, signal });
        },
        waitReachable: (url, probe, signal) => waitUntilReachable(nodeReachableIo(), { url, probe, signal, log: over.log }),
        worldPort: over.worldPort,
        log: over.log
    };
}
