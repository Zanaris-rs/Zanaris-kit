import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSETS, assetFor, CLOUDFLARED_VERSION, downloadUrl, ensureCloudflared, isInstalled, type CloudflaredAsset } from './cloudflared.ts';
import { extractTgz } from '../download.ts';

const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

function tempDir(): string {
    return mkdtempSync(join(tmpdir(), 'share-cf-'));
}

/** A loopback server answering one path, however the test wants. */
async function serve(handler: Parameters<typeof createServer>[1]): Promise<{ url: string; hits: () => number; close: () => Promise<void> }> {
    let hits = 0;
    const server: Server = createServer((req, res) => {
        hits++;
        handler!(req, res);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return {
        url: `http://127.0.0.1:${port}/cloudflared`,
        hits: () => hits,
        close: () =>
            new Promise(resolve => {
                server.closeAllConnections();
                server.close(() => resolve());
            })
    };
}

function plainAsset(body: Buffer): CloudflaredAsset {
    return { file: 'cloudflared-linux-amd64', size: body.length, sha256: sha(body), archive: null, binarySha256: sha(body) };
}

test('each platform Cloudflare builds for maps to its release file, and Windows on arm runs the x64 build', () => {
    assert.equal(assetFor('darwin', 'arm64')?.file, 'cloudflared-darwin-arm64.tgz');
    assert.equal(assetFor('darwin', 'x64')?.file, 'cloudflared-darwin-amd64.tgz');
    assert.equal(assetFor('linux', 'x64')?.file, 'cloudflared-linux-amd64');
    assert.equal(assetFor('linux', 'arm64')?.file, 'cloudflared-linux-arm64');
    assert.equal(assetFor('win32', 'x64')?.file, 'cloudflared-windows-amd64.exe');
    assert.equal(assetFor('win32', 'arm64')?.file, 'cloudflared-windows-amd64.exe');
});

test('a platform with no pinned build has no asset, so sharing can say it is unavailable', () => {
    assert.equal(assetFor('linux', 'ia32'), null);
    assert.equal(assetFor('freebsd', 'x64'), null);
    assert.equal(assetFor('win32', 'ia32'), null);
});

test('every pin is a size and two sha-256 digests, and only the macOS archives differ between them', () => {
    for (const [key, asset] of Object.entries(ASSETS)) {
        assert.ok(asset.size > 1_000_000, key);
        assert.match(asset.sha256, /^[0-9a-f]{64}$/, key);
        assert.match(asset.binarySha256, /^[0-9a-f]{64}$/, key);
        if (asset.archive === 'tgz') assert.notEqual(asset.sha256, asset.binarySha256, key);
        else assert.equal(asset.sha256, asset.binarySha256, key);
    }
});

test('the download comes from the pinned version of Cloudflare\'s own GitHub release', () => {
    const asset = assetFor('linux', 'x64')!;
    assert.equal(downloadUrl(asset), `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-amd64`);
});

test('a missing binary is downloaded, checked and made executable, reporting progress to the end', async t => {
    const body = Buffer.alloc(300_000, 7);
    const server = await serve((_req, res) => {
        res.writeHead(200, { 'content-length': body.length });
        res.write(body.subarray(0, 100_000));
        setImmediate(() => res.end(body.subarray(100_000)));
    });
    const dir = tempDir();
    t.after(() => server.close());
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const progress: number[] = [];
    const path = await ensureCloudflared({ asset: plainAsset(body), dir, platform: 'linux', url: server.url, fetch, onProgress: p => progress.push(p) });
    assert.equal(path, join(dir, 'cloudflared'));
    assert.deepEqual(readFileSync(path), body);
    assert.ok((statSync(path).mode & 0o111) !== 0, 'executable');
    assert.equal(progress.at(-1), 1);
    assert.ok(progress.every((p, i) => i === 0 || p >= progress[i - 1]!), 'progress only grows');
    assert.deepEqual(readdirSync(dir), ['cloudflared']);
});

test('a cached binary with the pinned hash is used without downloading anything', async t => {
    const body = Buffer.from('already here');
    const server = await serve((_req, res) => res.end(body));
    const dir = tempDir();
    t.after(() => server.close());
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, 'cloudflared'), body);
    const asset = plainAsset(body);
    assert.equal(await isInstalled({ asset, dir, platform: 'linux' }), true);
    assert.equal(await ensureCloudflared({ asset, dir, platform: 'linux', url: server.url, fetch }), join(dir, 'cloudflared'));
    assert.equal(server.hits(), 0);
});

test('a cached binary that no longer matches its pin is replaced by a fresh download', async t => {
    const body = Buffer.from('the real thing');
    const server = await serve((_req, res) => res.end(body));
    const dir = tempDir();
    t.after(() => server.close());
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, 'cloudflared'), 'tampered');
    const asset = plainAsset(body);
    assert.equal(await isInstalled({ asset, dir, platform: 'linux' }), false);
    await ensureCloudflared({ asset, dir, platform: 'linux', url: server.url, fetch });
    assert.equal(server.hits(), 1);
    assert.deepEqual(readFileSync(join(dir, 'cloudflared')), body);
});

test('a download of the wrong size is refused and leaves nothing behind', async t => {
    const server = await serve((_req, res) => res.end(Buffer.from('short')));
    const dir = tempDir();
    t.after(() => server.close());
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const asset = { ...plainAsset(Buffer.from('short')), size: 999 };
    await assert.rejects(ensureCloudflared({ asset, dir, platform: 'linux', url: server.url, fetch }), /size/i);
    assert.deepEqual(readdirSync(dir), []);
});

test('a download whose hash differs from the pin is refused and leaves nothing behind', async t => {
    const server = await serve((_req, res) => res.end(Buffer.from('evil!')));
    const dir = tempDir();
    t.after(() => server.close());
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const asset = plainAsset(Buffer.from('good!'));
    await assert.rejects(ensureCloudflared({ asset, dir, platform: 'linux', url: server.url, fetch }), /checksum/i);
    assert.deepEqual(readdirSync(dir), []);
});

test('an HTTP error is reported with its status and leaves nothing behind', async t => {
    const server = await serve((_req, res) => {
        res.writeHead(404);
        res.end('not found');
    });
    const dir = tempDir();
    t.after(() => server.close());
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    await assert.rejects(ensureCloudflared({ asset: plainAsset(Buffer.from('x')), dir, platform: 'linux', url: server.url, fetch }), /404/);
    assert.deepEqual(readdirSync(dir), []);
});

test('a download that stops sending is abandoned after the idle limit', async t => {
    const server = await serve((_req, res) => {
        res.writeHead(200, { 'content-length': 1000 });
        res.write(Buffer.alloc(10));
        // and then nothing, forever
    });
    const dir = tempDir();
    t.after(() => server.close());
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const asset = { ...plainAsset(Buffer.alloc(1000)) };
    await assert.rejects(ensureCloudflared({ asset, dir, platform: 'linux', url: server.url, fetch, idleMs: 100 }), /stalled/i);
    assert.deepEqual(readdirSync(dir), []);
});

test('an archive is checked, unpacked, and the binary inside checked against its own pin', async t => {
    const archive = Buffer.from('pretend tarball');
    const binary = Buffer.from('pretend binary');
    const server = await serve((_req, res) => res.end(archive));
    const dir = tempDir();
    t.after(() => server.close());
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const extracted: string[] = [];
    const asset: CloudflaredAsset = { file: 'cloudflared-darwin-arm64.tgz', size: archive.length, sha256: sha(archive), archive: 'tgz', binarySha256: sha(binary) };
    const extract = async (from: string, into: string): Promise<void> => {
        extracted.push(readFileSync(from, 'utf8'));
        mkdirSync(into, { recursive: true });
        writeFileSync(join(into, 'cloudflared'), binary);
    };
    const path = await ensureCloudflared({ asset, dir, platform: 'darwin', url: server.url, fetch, extract });
    assert.deepEqual(extracted, ['pretend tarball']);
    assert.deepEqual(readFileSync(path), binary);
    assert.deepEqual(readdirSync(dir), ['cloudflared']);
});

test('an archive holding the wrong binary is refused and leaves nothing behind', async t => {
    const archive = Buffer.from('pretend tarball');
    const server = await serve((_req, res) => res.end(archive));
    const dir = tempDir();
    t.after(() => server.close());
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const asset: CloudflaredAsset = { file: 'cloudflared-darwin-arm64.tgz', size: archive.length, sha256: sha(archive), archive: 'tgz', binarySha256: sha('expected') };
    const extract = async (_from: string, into: string): Promise<void> => {
        mkdirSync(into, { recursive: true });
        writeFileSync(join(into, 'cloudflared'), 'something else');
    };
    await assert.rejects(ensureCloudflared({ asset, dir, platform: 'darwin', url: server.url, fetch, extract }), /checksum/i);
    assert.deepEqual(readdirSync(dir), []);
});

test('extractTgz unpacks a real gzipped tarball with the system tar', { skip: process.platform === 'win32' }, async t => {
    const dir = tempDir();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'cloudflared'), 'inside');
    execFileSync('tar', ['-czf', join(dir, 'a.tgz'), '-C', join(dir, 'src'), 'cloudflared']);
    await extractTgz(join(dir, 'a.tgz'), join(dir, 'out'));
    assert.equal(readFileSync(join(dir, 'out', 'cloudflared'), 'utf8'), 'inside');
    assert.ok(existsSync(join(dir, 'out')));
});
