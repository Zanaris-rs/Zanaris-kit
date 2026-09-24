import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { downloadChecked, downloadFile } from './download.ts';

const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

async function serve(body: Buffer): Promise<{ url: string; close: () => Promise<void> }> {
    const server: Server = createServer((_req, res) => {
        res.writeHead(200, { 'content-length': body.length });
        res.end(body);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return {
        url: `http://127.0.0.1:${port}/engine.tar.gz`,
        close: () =>
            new Promise(resolve => {
                server.closeAllConnections();
                server.close(() => resolve());
            })
    };
}

test('a checked download whose digest matches is kept, and reports progress to the end', async t => {
    const body = Buffer.alloc(200_000, 3);
    const server = await serve(body);
    t.after(() => server.close());
    const to = join(mkdtempSync(join(tmpdir(), 'download-')), 'engine.tar.gz');
    const seen: number[] = [];
    await downloadChecked({ url: server.url, file: 'engine.tar.gz', size: body.length, sha256: sha(body), to, fetch: (url, init) => fetch(url, init), onProgress: f => seen.push(f) });
    assert.deepEqual(readFileSync(to), body);
    assert.equal(seen.at(-1), 1);
});

test('a checked download whose digest differs is refused and leaves no file', async t => {
    const body = Buffer.alloc(50_000, 4);
    const server = await serve(body);
    t.after(() => server.close());
    const to = join(mkdtempSync(join(tmpdir(), 'download-')), 'engine.tar.gz');
    await assert.rejects(
        downloadChecked({ url: server.url, file: 'engine.tar.gz', size: body.length, sha256: 'f'.repeat(64), to, fetch: (url, init) => fetch(url, init) }),
        /failed its checksum/
    );
    assert.equal(existsSync(to), false);
});

test('a checked download of the wrong size is refused and leaves no file', async t => {
    const body = Buffer.alloc(50_000, 5);
    const server = await serve(body);
    t.after(() => server.close());
    const to = join(mkdtempSync(join(tmpdir(), 'download-')), 'engine.tar.gz');
    await assert.rejects(
        downloadChecked({ url: server.url, file: 'engine.tar.gz', size: body.length + 1, sha256: sha(body), to, fetch: (url, init) => fetch(url, init) }),
        /wrong size/
    );
    assert.equal(existsSync(to), false);
});

test('a refused download opens no file at all, not even one that turns up after the refusal', async t => {
    const dir = mkdtempSync(join(tmpdir(), 'download-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const to = join(dir, 'engine.tar.gz.partial');
    // The answer arrives at once, as a stubbed fetch makes it: the refusal then
    // beats the write stream's own open, where a real round trip gives the open
    // time to land first and hides this.
    const instant404 = async (): Promise<Response> => new Response('not found', { status: 404 });
    await assert.rejects(downloadFile({ url: 'http://example.invalid/engine.tar.gz', file: 'engine.tar.gz', size: 5, to, fetch: instant404 }), /404/);
    assert.deepEqual(readdirSync(dir), []);
    // `createWriteStream` queues its open rather than opening there and then, so
    // an empty directory at the moment of the refusal proves nothing: the file
    // this download refused to make used to appear a tick later, landing on
    // whatever the caller had cleaned up by then — in CI, on a deleted
    // directory, as an ENOENT nobody was left to catch.
    await sleep(50);
    assert.deepEqual(readdirSync(dir), [], 'the partial file turned up after the refusal');
});
