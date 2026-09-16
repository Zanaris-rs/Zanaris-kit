import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { chmodSync, createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * cloudflared, the program that holds a Cloudflare quick tunnel open. The kit
 * does not ship it: the first share downloads the one build this file pins,
 * from Cloudflare's own GitHub release, and refuses anything whose size or
 * digest differs.
 */
export const CLOUDFLARED_VERSION = '2026.9.1';

export interface CloudflaredAsset {
    /** The release asset's file name. */
    file: string;
    /** Its size in bytes, as GitHub reports it. */
    size: number;
    /** GitHub's sha-256 digest of the asset. */
    sha256: string;
    /** macOS builds come as a gzipped tarball holding the one binary; the others are the binary. */
    archive: 'tgz' | null;
    /** The binary's own sha-256: the asset's, unless the asset is an archive. */
    binarySha256: string;
}

function binary(file: string, size: number, sha256: string): CloudflaredAsset {
    return { file, size, sha256, archive: null, binarySha256: sha256 };
}

/*
 * The archives' digests are GitHub's. The release notes list different ones
 * for the two .tgz files: cloudflared's github_release.py unpacks a .tgz and
 * hashes the binary inside, and github_message.py writes those hashes into the
 * notes. binarySha256 holds them.
 */
const WINDOWS = binary('cloudflared-windows-amd64.exe', 54_976_432, '2837888cc0f5d58f15b6dc478376de90b4d3ba5241c7947455d1e0a0df429712');

/** Keyed `${process.platform}-${process.arch}`. */
export const ASSETS: Readonly<Record<string, CloudflaredAsset>> = {
    'darwin-arm64': {
        file: 'cloudflared-darwin-arm64.tgz',
        size: 19_217_478,
        sha256: 'c27ab8fd0aa489449e3d201eb02f957ef460a13b613662928b1b23394bf1bcfe',
        archive: 'tgz',
        binarySha256: '9a0b19f67dc7a3011bc6b972c7ce06a5fcea8784ac6bd599ffa382ea4aeb5a6e'
    },
    'darwin-x64': {
        file: 'cloudflared-darwin-amd64.tgz',
        size: 21_118_723,
        sha256: 'ff0d3b51d5ff70eceef89d6b32145fee985018a2174596a5dbe405e2766e2ac4',
        archive: 'tgz',
        binarySha256: '1ea07ae775b03236bd6be18ca1848d6bdc4af2f4f3bce398823b5a36e5761b75'
    },
    'linux-x64': binary('cloudflared-linux-amd64', 39_838_488, '03f1f25d1cc93b9ad6c60569d44060bc4f17ed97075760ed8cfca4b12dcd68cc'),
    'linux-arm64': binary('cloudflared-linux-arm64', 37_466_252, '3d97437c71848bd8df68041e12436b484a661d95073ea1937f01a845ce88faa3'),
    'win32-x64': WINDOWS,
    // Cloudflare publishes no Windows arm64 build; Windows on Arm runs the x64 one under emulation.
    'win32-arm64': WINDOWS
};

export function assetFor(platform: string, arch: string): CloudflaredAsset | null {
    return ASSETS[`${platform}-${arch}`] ?? null;
}

export function downloadUrl(asset: CloudflaredAsset): string {
    return `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${asset.file}`;
}

export function binaryPath(dir: string, platform: string): string {
    return join(dir, platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
}

/** How long a download may go without a byte before it is given up on. */
const IDLE_MS = 30_000;
/** Where an archive is unpacked before its binary is checked and moved into place. */
const EXTRACT_DIR = '.extract';

export interface InstalledQuery {
    asset: CloudflaredAsset;
    /** One directory per pinned version, so a version bump downloads afresh. */
    dir: string;
    platform: string;
}

export interface EnsureOptions extends InstalledQuery {
    /** Defaults to the release; tests point it at loopback. */
    url?: string;
    fetch: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
    /** Unpacks a macOS archive. Defaults to `extractTgz`. */
    extract?: (archive: string, into: string) => Promise<void>;
    idleMs?: number;
    /** 0 to 1, only ever growing. */
    onProgress?: (fraction: number) => void;
}

async function sha256File(path: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    return hash.digest('hex');
}

/** True when the pinned binary is already on disk, byte for byte. */
export async function isInstalled(query: InstalledQuery): Promise<boolean> {
    const path = binaryPath(query.dir, query.platform);
    return existsSync(path) && (await sha256File(path)) === query.asset.binarySha256;
}

/**
 * The path of a pinned, checked cloudflared, downloading it when the one on
 * disk is missing or no longer matches. Nothing unchecked is ever left where
 * the binary goes: the download and any unpacking happen beside it and are
 * removed whether or not they succeed.
 */
export async function ensureCloudflared(opts: EnsureOptions): Promise<string> {
    const { asset, dir, platform } = opts;
    const target = binaryPath(dir, platform);
    if (await isInstalled(opts)) return target;
    mkdirSync(dir, { recursive: true });
    rmSync(target, { force: true });
    const partial = join(dir, `${asset.file}.partial`);
    const extractDir = join(dir, EXTRACT_DIR);
    try {
        await download(opts, opts.url ?? downloadUrl(asset), partial);
        if ((await sha256File(partial)) !== asset.sha256) throw new Error(`${asset.file} failed its checksum`);
        let unpacked = partial;
        if (asset.archive === 'tgz') {
            rmSync(extractDir, { recursive: true, force: true });
            await (opts.extract ?? extractTgz)(partial, extractDir);
            unpacked = join(extractDir, 'cloudflared');
            if (!existsSync(unpacked)) throw new Error(`${asset.file} holds no cloudflared`);
            if ((await sha256File(unpacked)) !== asset.binarySha256) throw new Error(`The cloudflared inside ${asset.file} failed its checksum`);
        }
        if (platform !== 'win32') chmodSync(unpacked, 0o755);
        renameSync(unpacked, target);
        return target;
    } finally {
        rmSync(partial, { force: true });
        rmSync(extractDir, { recursive: true, force: true });
    }
}

async function download(opts: EnsureOptions, url: string, to: string): Promise<void> {
    const { asset } = opts;
    const idleMs = opts.idleMs ?? IDLE_MS;
    const controller = new AbortController();
    let stalled = false;
    const stall = (): void => {
        stalled = true;
        controller.abort();
    };
    // Armed before the request, so a server that never answers is caught too.
    let timer = setTimeout(stall, idleMs);
    const out = createWriteStream(to);
    try {
        const response = await opts.fetch(url, { signal: controller.signal });
        if (!response.ok || !response.body) throw new Error(`Downloading ${asset.file} failed: HTTP ${response.status}`);
        const reader = response.body.getReader();
        let received = 0;
        opts.onProgress?.(0);
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            clearTimeout(timer);
            timer = setTimeout(stall, idleMs);
            received += value.byteLength;
            if (received > asset.size) break;
            if (!out.write(value)) await once(out, 'drain');
            opts.onProgress?.(received / asset.size);
        }
        out.end();
        await once(out, 'close');
        if (received !== asset.size) throw new Error(`${asset.file} arrived at the wrong size (${received} bytes, expected ${asset.size})`);
    } catch (err) {
        if (stalled) throw new Error(`Downloading ${asset.file} stalled: nothing arrived for ${Math.round(idleMs / 1000)} s`);
        throw err;
    } finally {
        clearTimeout(timer);
        out.destroy();
    }
}

/** Unpacks a gzipped tarball with the system's tar, which every macOS has at /usr/bin/tar. */
export function extractTgz(archive: string, into: string): Promise<void> {
    mkdirSync(into, { recursive: true });
    const tar = existsSync('/usr/bin/tar') ? '/usr/bin/tar' : 'tar';
    return new Promise((resolve, reject) => {
        execFile(tar, ['-xzf', archive, '-C', into], err => (err ? reject(err) : resolve()));
    });
}
