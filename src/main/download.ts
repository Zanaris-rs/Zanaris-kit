import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, type WriteStream } from 'node:fs';

/**
 * Downloads the kit makes of files whose size and sha-256 it knows before it
 * starts: cloudflared for sharing and your home server's builds, pinned in
 * the kit, and the kit's own updates, at what GitHub lists for them. Each is
 * refused unless it arrives at exactly that size, and, where the caller asks,
 * with that sha-256.
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
    /** Cancels the download: Cancel Download on an update. */
    signal?: AbortSignal;
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
    const cancel = (): void => controller.abort();
    opts.signal?.addEventListener('abort', cancel, { once: true });
    if (opts.signal?.aborted) controller.abort();
    /*
     * Opened only once there is a body to write, and never before the answer.
     * `createWriteStream` queues its own open rather than opening where it is
     * called, so a stream made ahead of the response is one whose open lands
     * after a refusal has already been thrown — writing the file this download
     * just refused to make, or failing against a directory the caller has since
     * cleaned up, by which point nothing is left to catch it. That is an
     * uncaught ENOENT: it failed CI from a test that had already passed.
     */
    let out: WriteStream | null = null;
    try {
        const response = await opts.fetch(opts.url, { signal: controller.signal });
        if (!response.ok || !response.body) throw new Error(`Downloading ${opts.file} failed: HTTP ${response.status}`);
        const stream = createWriteStream(opts.to);
        out = stream;
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
            if (!stream.write(value)) await once(stream, 'drain');
            opts.onProgress?.(received / opts.size);
        }
        stream.end();
        await once(stream, 'close');
        if (received !== opts.size) throw new Error(`${opts.file} arrived at the wrong size (${received} bytes, expected ${opts.size})`);
    } catch (err) {
        if (stalled) throw new Error(`Downloading ${opts.file} stalled: nothing arrived for ${Math.round(idleMs / 1000)} s`);
        if (opts.signal?.aborted) throw new Error(`Downloading ${opts.file} was cancelled`);
        throw err;
    } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', cancel);
        if (out && !out.closed) await destroyed(out);
    }
}

/**
 * Destroys a write stream and waits for it to close. Its open is queued, and
 * a stream destroyed before the open lands still opens its file and then
 * closes it — so returning straight after `destroy` let a download cancelled
 * at its first chunk reach its caller first, the caller clean up the folder,
 * and the open land on nothing, as an uncaught ENOENT. An error the stream
 * raises on its way down is dropped: the download has already failed.
 */
function destroyed(stream: WriteStream): Promise<void> {
    const done = new Promise<void>(resolve => stream.once('close', () => resolve()));
    stream.on('error', () => {});
    stream.destroy();
    return done;
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
