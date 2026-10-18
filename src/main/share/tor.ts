import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { downloadFile, extractTgz, sha256File, type FetchLike } from '../download.ts';

/**
 * Tor's Expert Bundle, the program that holds an onion service open. The kit
 * does not ship it: the first share over Tor downloads the one build this file
 * pins and refuses anything whose size or digest differs. The URL is Tor
 * Project's package archive rather than dist.torproject.org, which keeps only
 * the newest few releases and would stop serving a pinned one.
 */
export const TOR_BUNDLE_VERSION = '15.0.25';

export interface TorAsset {
    /** The archive's file name. */
    file: string;
    /** Its size in bytes. */
    size: number;
    /** The archive's sha-256. */
    sha256: string;
    /**
     * The files kept from the archive's `tor/` folder, by name, each with its
     * sha-256 as Tor Project shipped it. The first is the executable. Nothing
     * else in the bundle is kept: the rest (pluggable transports, geoip data,
     * docs) is not used here.
     */
    files: Readonly<Record<string, string>>;
}

const WINDOWS: TorAsset = {
    file: `tor-expert-bundle-windows-x86_64-${TOR_BUNDLE_VERSION}.tar.gz`,
    size: 22_507_599,
    sha256: 'c1988c701de2f24f7d098d1d6d7f507b58f27740d097f29c246e0524d639b252',
    files: { 'tor.exe': '8c38513b3c4584154158e7c584f4144849dc679a64cd679553d72dad28230c54' }
};

/** Keyed `${process.platform}-${process.arch}`. */
export const TOR_ASSETS: Readonly<Record<string, TorAsset>> = {
    'darwin-arm64': {
        file: `tor-expert-bundle-macos-aarch64-${TOR_BUNDLE_VERSION}.tar.gz`,
        size: 18_793_521,
        sha256: 'a3febb6179152b0b4f56a0f5cc57bf5cc8ecef7db35e7c3e9d5a044c8158c26c',
        files: {
            tor: '7d5a89b6cec99aab47420040ad86dd5fd5174192e71b6c201b0b10170ba57ebb',
            'libevent-2.1.7.dylib': '6dde3faf59255b7cf0cc20d0b3cdf78622266fbf13c534300b8884c76d89b739'
        }
    },
    'darwin-x64': {
        file: `tor-expert-bundle-macos-x86_64-${TOR_BUNDLE_VERSION}.tar.gz`,
        size: 19_422_031,
        sha256: 'e1ae4d4a734d28bb590839188511deb3cebc26fcbce9df66d01b2c452060fe95',
        files: {
            tor: 'e249a521aa5b0ff44a39c1dc4b5707ae8cb109d8a26c637b6acbbf6832bf2f14',
            'libevent-2.1.7.dylib': '38aea0316e01e1fc52a15941bf523c8bc018ca90655cfa90de568b4a86a82b4b'
        }
    },
    'linux-x64': {
        file: `tor-expert-bundle-linux-x86_64-${TOR_BUNDLE_VERSION}.tar.gz`,
        size: 32_448_097,
        sha256: '19cf18726eecb362e0f21d27afa9ea9efe5da928bfdfbb1ceb5fe54519e87f4a',
        files: {
            tor: '39c9db0654d2ec218892bd00f75eccb5b641a7222754436c2e4a8d2f764a57d3',
            'libevent-2.1.so.7': 'b51ca562ec232785856c454ce4f3621d957f39d0db87919e237590b0331544ff',
            'libssl.so.3': '9c2438d086d6c299db04b0bc337bbc8c0acd26c19c71eada2173a5b2ef7cecac',
            'libcrypto.so.3': '418208c5c738864cb5653f3eeab650debcc71afbe50d08b0bd5a04b20f1d3c05'
        }
    },
    'win32-x64': WINDOWS,
    // Tor Project publishes no Windows arm64 bundle; Windows on Arm runs the x64 one under emulation.
    'win32-arm64': WINDOWS
};

export function torAssetFor(platform: string, arch: string): TorAsset | null {
    return TOR_ASSETS[`${platform}-${arch}`] ?? null;
}

export function torDownloadUrl(asset: TorAsset): string {
    return `https://archive.torproject.org/tor-package-archive/torbrowser/${TOR_BUNDLE_VERSION}/${asset.file}`;
}

/** The executable's file name: the first kept file. */
export function torExecutable(asset: TorAsset): string {
    return Object.keys(asset.files)[0]!;
}

/** Where an archive is unpacked before its files are checked and moved into place. */
const EXTRACT_DIR = '.extract';

export interface TorQuery {
    asset: TorAsset;
    /** One directory per pinned version, so a version bump downloads afresh. */
    dir: string;
}

/** True when every kept file is on disk, byte for byte. */
export async function torInstalled(q: TorQuery): Promise<boolean> {
    for (const [name, sha256] of Object.entries(q.asset.files)) {
        const path = join(q.dir, name);
        if (!existsSync(path) || (await sha256File(path)) !== sha256) return false;
    }
    return true;
}

export interface EnsureTorOptions extends TorQuery {
    /** Defaults to the archive; tests point it at loopback. */
    url?: string;
    fetch: FetchLike;
    /** Unpacks the archive. Defaults to `extractTgz`. */
    extract?: (archive: string, into: string) => Promise<void>;
    idleMs?: number;
    /** 0 to 1, only ever growing. */
    onProgress?: (fraction: number) => void;
}

/**
 * The folder holding a pinned, checked Tor, downloading it when what is on
 * disk is missing or no longer matches. Nothing unchecked is ever left where
 * Tor goes: the download and unpacking happen beside it, every kept file is
 * checked in the scratch folder before any is moved in, and a failure removes
 * whatever had been moved. The scratch is removed whether or not it succeeds.
 */
export async function ensureTor(opts: EnsureTorOptions): Promise<string> {
    const { asset, dir } = opts;
    if (await torInstalled(opts)) return dir;
    mkdirSync(dir, { recursive: true });
    const names = Object.keys(asset.files);
    const removeKept = (): void => {
        for (const name of names) rmSync(join(dir, name), { force: true });
    };
    removeKept();
    const partial = join(dir, `${asset.file}.partial`);
    const extractDir = join(dir, EXTRACT_DIR);
    try {
        await downloadFile({ url: opts.url ?? torDownloadUrl(asset), file: asset.file, size: asset.size, to: partial, fetch: opts.fetch, idleMs: opts.idleMs, onProgress: opts.onProgress });
        if ((await sha256File(partial)) !== asset.sha256) throw new Error(`${asset.file} failed its checksum`);
        rmSync(extractDir, { recursive: true, force: true });
        await (opts.extract ?? extractTgz)(partial, extractDir);
        const from = (name: string): string => join(extractDir, 'tor', name);
        if (!existsSync(join(extractDir, 'tor'))) throw new Error(`${asset.file} holds no tor folder`);
        for (const [name, sha256] of Object.entries(asset.files)) {
            if (!existsSync(from(name))) throw new Error(`${asset.file} holds no ${name}`);
            if ((await sha256File(from(name))) !== sha256) throw new Error(`The ${name} inside ${asset.file} failed its checksum`);
        }
        const executable = torExecutable(asset);
        if (!executable.endsWith('.exe')) chmodSync(from(executable), 0o755);
        for (const name of names) renameSync(from(name), join(dir, name));
        return dir;
    } catch (error) {
        removeKept();
        throw error;
    } finally {
        rmSync(partial, { force: true });
        rmSync(extractDir, { recursive: true, force: true });
    }
}
