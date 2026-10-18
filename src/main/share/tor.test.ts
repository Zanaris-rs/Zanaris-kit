import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureTor, TOR_ASSETS, TOR_BUNDLE_VERSION, torAssetFor, torDownloadUrl, torExecutable, torInstalled, type TorAsset } from './tor.ts';

const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

function tempDir(): string {
    return mkdtempSync(join(tmpdir(), 'share-tor-'));
}

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
        url: `http://127.0.0.1:${port}/tor`,
        hits: () => hits,
        close: () =>
            new Promise(resolve => {
                server.closeAllConnections();
                server.close(() => resolve());
            })
    };
}

const KEPT = { tor: Buffer.from('pretend tor'), 'libevent-2.1.so.7': Buffer.from('pretend libevent') };

/**
 * A real .tar.gz laid out as Tor Project's are: tor/ with the kept files and
 * extras that must not be kept, and a data/ folder beside it.
 */
function fakeBundle(parent: string, kept: Record<string, Buffer> = KEPT, withTorFolder = true): { archive: Buffer; asset: TorAsset } {
    const src = join(parent, 'src');
    mkdirSync(join(src, 'data'), { recursive: true });
    writeFileSync(join(src, 'data', 'geoip'), 'countries');
    if (withTorFolder) {
        mkdirSync(join(src, 'tor', 'pluggable_transports'), { recursive: true });
        for (const [name, bytes] of Object.entries(kept)) writeFileSync(join(src, 'tor', name), bytes);
        writeFileSync(join(src, 'tor', 'pluggable_transports', 'lyrebird'), 'transport');
        writeFileSync(join(src, 'tor', 'tor-gencert.exe'), 'gencert');
    }
    const tgz = join(parent, 'bundle.tar.gz');
    execFileSync('tar', ['-czf', tgz, '-C', src, ...readdirSync(src)]);
    const archive = readFileSync(tgz);
    const files = Object.fromEntries(Object.entries(KEPT).map(([name, bytes]) => [name, sha(bytes)]));
    return { archive, asset: { file: 'tor-expert-bundle-test.tar.gz', size: archive.length, sha256: sha(archive), files } };
}

/** Nothing but the kept files in `dir`: no partial, no scratch. */
function assertNothingExtra(dir: string, kept: string[]): void {
    assert.deepEqual(readdirSync(dir).sort(), [...kept].sort());
}

test('each platform Tor Project builds for maps to its bundle, Windows on arm runs the x64 one, and linux arm64 has none', () => {
    assert.equal(torAssetFor('darwin', 'arm64')?.file, `tor-expert-bundle-macos-aarch64-${TOR_BUNDLE_VERSION}.tar.gz`);
    assert.equal(torAssetFor('darwin', 'x64')?.file, `tor-expert-bundle-macos-x86_64-${TOR_BUNDLE_VERSION}.tar.gz`);
    assert.equal(torAssetFor('linux', 'x64')?.file, `tor-expert-bundle-linux-x86_64-${TOR_BUNDLE_VERSION}.tar.gz`);
    assert.equal(torAssetFor('linux', 'arm64'), null);
    assert.equal(torAssetFor('win32', 'arm64'), torAssetFor('win32', 'x64'));
    assert.ok(torAssetFor('win32', 'x64'));
});

test('the download comes from the pinned version in Tor Project\'s package archive', () => {
    assert.equal(
        torDownloadUrl(torAssetFor('darwin', 'arm64')!),
        'https://archive.torproject.org/tor-package-archive/torbrowser/15.0.25/tor-expert-bundle-macos-aarch64-15.0.25.tar.gz'
    );
});

test('every pin is a size and sha-256 digests, and the first kept file is the executable', () => {
    for (const [key, asset] of Object.entries(TOR_ASSETS)) {
        assert.ok(asset.size > 1_000_000, key);
        assert.match(asset.sha256, /^[0-9a-f]{64}$/, key);
        const names = Object.keys(asset.files);
        assert.ok(names[0] === 'tor' || names[0] === 'tor.exe', key);
        assert.equal(torExecutable(asset), names[0], key);
        for (const digest of Object.values(asset.files)) assert.match(digest, /^[0-9a-f]{64}$/, key);
    }
});

test('a missing bundle is downloaded and only the checked tor/ files are kept', { skip: process.platform === 'win32' }, async t => {
    const work = tempDir();
    const dir = tempDir();
    const { archive, asset } = fakeBundle(work);
    const server = await serve((_req, res) => res.end(archive));
    t.after(() => server.close());
    t.after(() => rmSync(work, { recursive: true, force: true }));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const progress: number[] = [];
    assert.equal(await ensureTor({ asset, dir, url: server.url, fetch, onProgress: p => progress.push(p) }), dir);
    assertNothingExtra(dir, Object.keys(KEPT));
    assert.deepEqual(readFileSync(join(dir, 'tor')), KEPT.tor);
    assert.equal(await torInstalled({ asset, dir }), true);
    assert.equal(progress.at(-1), 1);
    assert.ok((statSync(join(dir, 'tor')).mode & 0o777) === 0o755, 'executable');
});

test('an installed bundle is used without downloading anything', async t => {
    const work = tempDir();
    const dir = tempDir();
    const { archive, asset } = fakeBundle(work);
    const server = await serve((_req, res) => res.end(archive));
    t.after(() => server.close());
    t.after(() => rmSync(work, { recursive: true, force: true }));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    for (const [name, bytes] of Object.entries(KEPT)) writeFileSync(join(dir, name), bytes);
    assert.equal(await ensureTor({ asset, dir, url: server.url, fetch }), dir);
    assert.equal(server.hits(), 0);
});

test('a kept file altered after install is noticed, and the next ensure downloads again and restores it', async t => {
    const work = tempDir();
    const dir = tempDir();
    const { archive, asset } = fakeBundle(work);
    const server = await serve((_req, res) => res.end(archive));
    t.after(() => server.close());
    t.after(() => rmSync(work, { recursive: true, force: true }));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    await ensureTor({ asset, dir, url: server.url, fetch });
    writeFileSync(join(dir, 'libevent-2.1.so.7'), 'tampered');
    assert.equal(await torInstalled({ asset, dir }), false);
    await ensureTor({ asset, dir, url: server.url, fetch });
    assert.equal(server.hits(), 2);
    assert.deepEqual(readFileSync(join(dir, 'libevent-2.1.so.7')), KEPT['libevent-2.1.so.7']);
    assert.equal(await torInstalled({ asset, dir }), true);
    assertNothingExtra(dir, Object.keys(KEPT));
});

test('a bundle of the wrong size is refused and leaves nothing behind', async t => {
    const work = tempDir();
    const dir = tempDir();
    const { archive, asset } = fakeBundle(work);
    const server = await serve((_req, res) => res.end(archive));
    t.after(() => server.close());
    t.after(() => rmSync(work, { recursive: true, force: true }));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    await assert.rejects(ensureTor({ asset: { ...asset, size: asset.size + 1 }, dir, url: server.url, fetch }), /size/i);
    assertNothingExtra(dir, []);
});

test('a bundle whose digest differs from the pin is refused and leaves nothing behind', async t => {
    const work = tempDir();
    const dir = tempDir();
    const { archive, asset } = fakeBundle(work);
    const server = await serve((_req, res) => res.end(archive));
    t.after(() => server.close());
    t.after(() => rmSync(work, { recursive: true, force: true }));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    await assert.rejects(ensureTor({ asset: { ...asset, sha256: sha('other') }, dir, url: server.url, fetch }), /checksum/i);
    assertNothingExtra(dir, []);
});

test('an archive without tor/ is refused and leaves nothing behind', async t => {
    const work = tempDir();
    const dir = tempDir();
    const { archive, asset } = fakeBundle(work, KEPT, false);
    const server = await serve((_req, res) => res.end(archive));
    t.after(() => server.close());
    t.after(() => rmSync(work, { recursive: true, force: true }));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    await assert.rejects(ensureTor({ asset, dir, url: server.url, fetch }), /no tor/i);
    assertNothingExtra(dir, []);
});

test('a kept file that differs from its pin is refused by name, and nothing is left in the folder', async t => {
    const work = tempDir();
    const dir = tempDir();
    const { archive, asset } = fakeBundle(work, { ...KEPT, 'libevent-2.1.so.7': Buffer.from('swapped') });
    const server = await serve((_req, res) => res.end(archive));
    t.after(() => server.close());
    t.after(() => rmSync(work, { recursive: true, force: true }));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    await assert.rejects(ensureTor({ asset, dir, url: server.url, fetch }), /libevent-2\.1\.so\.7/);
    assertNothingExtra(dir, []);
    assert.equal(existsSync(join(dir, 'tor')), false);
});
