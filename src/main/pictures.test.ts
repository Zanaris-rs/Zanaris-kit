import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PICTURE_MAX, PICTURE_PIXELS_MAX, PictureStore, pictureSize, pictureType } from './pictures.ts';

const dirs: string[] = [];
const tempDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'zanaris-kit-pictures-'));
    dirs.push(dir);
    return join(dir, 'backgrounds');
};
afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Headers only — enough for `pictureSize`, which never decodes a pixel. */
const u16be = (n: number): number[] => [(n >> 8) & 255, n & 255];
const u16le = (n: number): number[] => [n & 255, (n >> 8) & 255];
const u32be = (n: number): number[] => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const u24le = (n: number): number[] => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const pngOf = (w: number, h: number): Uint8Array => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...u32be(w), ...u32be(h), 8, 6, 0, 0, 0]);
const gifOf = (w: number, h: number): Uint8Array => Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...u16le(w), ...u16le(h), 0, 0, 0]);
const jpegOf = (w: number, h: number): Uint8Array =>
    Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...u16be(16), ...new Array(14).fill(0), 0xff, 0xdb, ...u16be(4), 0, 0, 0xff, 0xc2, ...u16be(11), 8, ...u16be(h), ...u16be(w), 3, 0, 0]);
const riff = (chunk: string, body: number[]): Uint8Array =>
    Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, ...[...chunk].map(c => c.charCodeAt(0)), 0, 0, 0, 0, ...body]);
const webpLossy = (w: number, h: number): Uint8Array => riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(w), ...u16le(h)]);
const webpLossless = (w: number, h: number): Uint8Array => {
    const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
    return riff('VP8L', [0x2f, bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >>> 24) & 255]);
};
const webpExtended = (w: number, h: number): Uint8Array => riff('VP8X', [0, 0, 0, 0, ...u24le(w - 1), ...u24le(h - 1)]);

const bytes = (...head: number[]): Uint8Array => Uint8Array.from([...head, 1, 2, 3, 4, 5, 6, 7, 8]);
const PNG = pngOf(64, 32);
const JPEG = jpegOf(64, 32);
const GIF87 = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, ...u16le(64), ...u16le(32), 0]);
const GIF89 = gifOf(64, 32);
const WEBP = webpLossy(64, 32);
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

test('pictureSize reads the width and height off each kind of header', () => {
    assert.deepEqual(pictureSize(pngOf(1920, 1080)), { width: 1920, height: 1080 });
    assert.deepEqual(pictureSize(gifOf(320, 200)), { width: 320, height: 200 });
    assert.deepEqual(pictureSize(jpegOf(2560, 1440)), { width: 2560, height: 1440 });
    assert.deepEqual(pictureSize(webpLossy(800, 600)), { width: 800, height: 600 });
    assert.deepEqual(pictureSize(webpLossless(1024, 768)), { width: 1024, height: 768 });
    assert.deepEqual(pictureSize(webpExtended(5000, 3000)), { width: 5000, height: 3000 });
    assert.equal(pictureSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 2])), null);
    assert.equal(pictureSize(new TextEncoder().encode('<svg/>')), null);
});

test('add refuses a picture with more pixels than a screen needs, however small its file', () => {
    const store = new PictureStore(tempDir());
    // A single-colour 20000x20000 PNG compresses to well under 10 MB and decodes to 1.6 GB.
    const refused = store.add(pngOf(20000, 20000));
    assert.ok('error' in refused && /pixels/.test(refused.error));
    assert.ok('picture' in store.add(pngOf(5120, 2880)));
    assert.ok(5120 * 2880 <= PICTURE_PIXELS_MAX);
    assert.ok('error' in store.add(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 2])));
});

test('prune goes on past a file it cannot delete, and never throws', () => {
    const store = new PictureStore(tempDir());
    const kept = store.add(PNG);
    const dropped = store.add(JPEG);
    assert.ok('picture' in kept && 'picture' in dropped);
    // A folder where a picture would be: rmSync refuses it without recursive, as a locked file would be refused.
    mkdirSync(join(store.dir, `${'0'.repeat(64)}.png`));
    assert.doesNotThrow(() => store.prune(new Set([kept.picture])));
    assert.deepEqual(readdirSync(store.dir).sort(), [`${'0'.repeat(64)}.png`, kept.picture].sort());
});
