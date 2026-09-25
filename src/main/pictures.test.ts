import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PICTURE_MAX, PictureStore, pictureType } from './pictures.ts';

const dirs: string[] = [];
const tempDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'zanaris-kit-pictures-'));
    dirs.push(dir);
    return join(dir, 'backgrounds');
};
afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const bytes = (...head: number[]): Uint8Array => Uint8Array.from([...head, 1, 2, 3, 4, 5, 6, 7, 8]);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const GIF87 = bytes(0x47, 0x49, 0x46, 0x38, 0x37, 0x61);
const GIF89 = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50);
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

test('pictureType reads the type off the first bytes, never the name', () => {
    assert.equal(pictureType(PNG), 'png');
    assert.equal(pictureType(JPEG), 'jpg');
    assert.equal(pictureType(GIF87), 'gif');
    assert.equal(pictureType(GIF89), 'gif');
    assert.equal(pictureType(WEBP), 'webp');
});

test('pictureType refuses SVG, text, a RIFF that is not WebP, and too few bytes', () => {
    assert.equal(pictureType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>')), null);
    assert.equal(pictureType(new TextEncoder().encode('hello')), null);
    assert.equal(pictureType(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45)), null);
    assert.equal(pictureType(Uint8Array.from([0x89, 0x50])), null);
    assert.equal(pictureType(new Uint8Array(0)), null);
});

test('add names a picture by its sha-256 and its type, and the same picture twice is one file', () => {
    const store = new PictureStore(tempDir());
    const first = store.add(PNG);
    assert.deepEqual(first, { picture: `${sha(PNG)}.png` });
    assert.deepEqual(store.add(PNG), first);
    assert.deepEqual(readdirSync(store.dir), [`${sha(PNG)}.png`]);
    assert.deepEqual(store.add(WEBP), { picture: `${sha(WEBP)}.webp` });
});

test('add refuses what is not a picture, and a picture over the limit, storing nothing', () => {
    const store = new PictureStore(tempDir());
    assert.ok('error' in store.add(new TextEncoder().encode('<svg/>')));
    const big = new Uint8Array(PICTURE_MAX + 1);
    big.set(PNG);
    const refused = store.add(big);
    assert.ok('error' in refused && /10 MB/.test(refused.error));
    assert.equal(existsSync(store.dir), false);
});

test('read answers only for a stored picture named as the store names them', () => {
    const store = new PictureStore(tempDir());
    const added = store.add(JPEG);
    assert.ok('picture' in added);
    assert.deepEqual(store.read(added.picture), { bytes: Buffer.from(JPEG), type: 'jpg' });
    assert.equal(store.read(`${'0'.repeat(64)}.jpg`), null);
    assert.equal(store.read('../state.json'), null);
    assert.equal(store.read(added.picture.toUpperCase()), null);
    assert.equal(store.read(`${sha(JPEG)}.svg`), null);
    assert.equal(store.path('../../x.png'), null);
});

test('prune removes the pictures nothing keeps, and leaves every other file alone', () => {
    const store = new PictureStore(tempDir());
    const kept = store.add(PNG);
    const dropped = store.add(GIF89);
    assert.ok('picture' in kept && 'picture' in dropped);
    writeFileSync(join(store.dir, 'notes.txt'), 'mine');
    // Shaped like a stored picture but not one of the store's names: not the store's to delete.
    writeFileSync(join(store.dir, `copy-of-${dropped.picture}`), 'mine too');
    writeFileSync(join(store.dir, `${dropped.picture}.incoming`), 'half written');
    store.prune(new Set([kept.picture]));
    assert.deepEqual(readdirSync(store.dir).sort(), [kept.picture, `copy-of-${dropped.picture}`, 'notes.txt'].sort());
});

test('prune with no folder yet does nothing', () => {
    const store = new PictureStore(tempDir());
    store.prune(new Set());
    assert.equal(existsSync(store.dir), false);
});
