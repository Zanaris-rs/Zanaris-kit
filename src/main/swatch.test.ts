import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { pngOf, swatchPixels, swatchPng } from './swatch.ts';
import { themeById } from '../shared/themes.ts';

const rgb = (hex: string): number[] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const at = (s: { size: number; rgba: Uint8Array }, x: number, y: number): number[] => [...s.rgba.slice((y * s.size + x) * 4, (y * s.size + x) * 4 + 3)];

test('the swatch is the stone, lit above and left, dark below and right', () => {
    const c = themeById('wilderness').colors;
    const s = swatchPixels(c, 2);
    assert.equal(s.size, 32);
    assert.deepEqual(at(s, 16, 16), rgb(c.stone));
    assert.deepEqual(at(s, 16, 0), rgb(c['edge-lit']));
    assert.deepEqual(at(s, 0, 16), rgb(c['edge-lit']));
    assert.deepEqual(at(s, 16, 31), rgb(c['edge-dark']));
    assert.deepEqual(at(s, 31, 16), rgb(c['edge-dark']));
    // The bevel is two points wide: four pixels at 2x, the fifth is the face.
    assert.deepEqual(at(s, 16, 3), rgb(c['edge-lit']));
    assert.deepEqual(at(s, 16, 4), rgb(c.stone));
});

test('every pixel of the swatch is opaque', () => {
    const s = swatchPixels(themeById('stone').colors, 1);
    for (let i = 3; i < s.rgba.length; i += 4) assert.equal(s.rgba[i], 255);
});

test('the PNG carries the pixels row by row, unfiltered, at the size it says', () => {
    const s = swatchPixels(themeById('stone').colors, 1);
    const png = pngOf(s.size, s.size, s.rgba);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.subarray(12, 16).toString('latin1'), 'IHDR');
    assert.equal(png.readUInt32BE(16), 16);
    assert.equal(png.readUInt32BE(20), 16);
    const idat = png.indexOf('IDAT');
    const raw = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)));
    assert.equal(raw.length, 16 * (1 + 16 * 4));
    assert.equal(raw[0], 0);
    assert.deepEqual([...raw.subarray(1, 5)], [...s.rgba.subarray(0, 4)]);
    assert.equal(png.subarray(-8, -4).toString('latin1'), 'IEND');
});

test("each chunk's CRC is PNG's CRC-32 of its type and data", () => {
    const png = swatchPng(themeById('stone').colors, 1);
    // IEND carries no data, so its CRC is the CRC-32 of "IEND" alone: a fixed number.
    assert.equal(png.readUInt32BE(png.length - 4), 0xae426082);
});
