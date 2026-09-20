import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';

/**
 * Downloads the kit makes of pinned files: cloudflared for sharing, and single
 * player's builds. Each is refused unless it arrives at exactly its pinned
 * size, and, where the caller asks, with its pinned sha-256.
 */

export type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

export interface DownloadOptions {
    url: string;
    /** The file's name, for messages. */
    file: string;
    /** Its pinned size in bytes: more is cut off, and anything else is refused. */
    size: number;
    to: string;
    /** main passes net.fetch, so the download follows the system proxy; tests pass Node's. */
    fetch: FetchLike;
    idleMs?: number;
    /** 0 to 1, only ever growing. */
    onProgress?: (fraction: number) => void;
}

/** How long a download may go without a byte before it is given up on. */
const IDLE_MS = 30_000;

export async function sha256File(path: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    return hash.digest('hex');
}

/** Streams `url` to `to`, refusing a stall, an HTTP error, or any size but the pinned one. */
export async function downloadFile(opts: DownloadOptions): Promise<void> {
    const idleMs = opts.idleMs ?? IDLE_MS;
    const controller = new AbortController();
    let stalled = false;
    const stall = (): void => {
        stalled = true;
        controller.abort();
    };
    // Armed before the request, so a server that never answers is caught too.
    let timer = setTimeout(stall, idleMs);
    const out = createWriteStream(opts.to);
    try {
        const response = await opts.fetch(opts.url, { signal: controller.signal });
        if (!response.ok || !response.body) throw new Error(`Downloading ${opts.file} failed: HTTP ${response.status}`);
        const reader = response.body.getReader();
        let received = 0;
        opts.onProgress?.(0);
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            clearTimeout(timer);
            timer = setTimeout(stall, idleMs);
            received += value.byteLength;
            if (received > opts.size) break;
            if (!out.write(value)) await once(out, 'drain');
            opts.onProgress?.(received / opts.size);
        }
        out.end();
        await once(out, 'close');
        if (received !== opts.size) throw new Error(`${opts.file} arrived at the wrong size (${received} bytes, expected ${opts.size})`);
    } catch (err) {
        if (stalled) throw new Error(`Downloading ${opts.file} stalled: nothing arrived for ${Math.round(idleMs / 1000)} s`);
        throw err;
    } finally {
        clearTimeout(timer);
        out.destroy();
    }
}

/** `downloadFile`, then the digest. Nothing is left at `to` unless both passed. */
export async function downloadChecked(opts: DownloadOptions & { sha256: string }): Promise<void> {
    try {
        await downloadFile(opts);
        if ((await sha256File(opts.to)) !== opts.sha256) throw new Error(`${opts.file} failed its checksum`);
    } catch (err) {
        rmSync(opts.to, { force: true });
        throw err;
    }
}

/** Unpacks a gzipped tarball with the system's tar: /usr/bin/tar on macOS, tar.exe on Windows 10 and later, tar on Linux. */
export function extractTgz(archive: string, into: string): Promise<void> {
    mkdirSync(into, { recursive: true });
    const tar = existsSync('/usr/bin/tar') ? '/usr/bin/tar' : 'tar';
    return new Promise((resolve, reject) => {
        execFile(tar, ['-xzf', archive, '-C', into], err => (err ? reject(err) : resolve()));
    });
}
