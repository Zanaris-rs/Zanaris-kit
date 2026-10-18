import { deflateSync } from 'node:zlib';
import type { ThemeColors } from '../shared/themes.ts';

/**
 * A theme's swatch: the icon beside its name in a game window's Theme menu.
 * A square of the theme's stone with the bevel every raised surface in the
 * kit has, lit edge above and left and dark edge below and right — the trim
 * is what tells the places apart, since every built-in's stone is a dark
 * shade of its ground.
 *
 * Made here as a PNG rather than handed to `nativeImage.createFromBitmap`,
 * whose byte order is the platform's: a PNG reads the same everywhere, and
 * `node --test` can check one.
 */

/** The swatch's side in points, as a native menu draws an item's icon. */
export const SWATCH_POINTS = 16;
/** The bevel's width in points. */
const BEVEL_POINTS = 2;

const rgbOf = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/**
 * The swatch's pixels, RGBA, `scale` pixels to the point. A pixel within the
 * bevel's width of an edge belongs to the nearest edge, the top and left
 * taking a tie, so the corners are mitred as a CSS border's are.
 */
export function swatchPixels(colors: ThemeColors, scale: number): { size: number; rgba: Uint8Array } {
    const size = SWATCH_POINTS * scale;
    const bevel = BEVEL_POINTS * scale;
    const face = rgbOf(colors.stone);
    const lit = rgbOf(colors['edge-lit']);
    const dark = rgbOf(colors['edge-dark']);
    const rgba = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const nearLit = Math.min(y, x);
            const nearDark = Math.min(size - 1 - y, size - 1 - x);
            const [r, g, b] = Math.min(nearLit, nearDark) >= bevel ? face : nearLit <= nearDark ? lit : dark;
            const i = (y * size + x) * 4;
            rgba[i] = r;
            rgba[i + 1] = g;
            rgba[i + 2] = b;
            rgba[i + 3] = 255;
        }
    }
    return { size, rgba };
}

/** PNG's CRC-32 table, made once. */
const CRC_TABLE = Array.from({ length: 256 }, (_unused, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/** One chunk: its data's length, its type, the data, and the CRC of type and data. */
function chunk(type: string, data: Uint8Array): Buffer {
    const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    typed.copy(out, 4);
    out.writeUInt32BE(crc32(typed), 8 + data.length);
    return out;
}

/** A PNG of 8-bit RGBA pixels: one IDAT, every row unfiltered. */
export function pngOf(width: number, height: number, rgba: Uint8Array): Buffer {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8; // bits per channel
    header[9] = 6; // RGBA
    const rows = Buffer.alloc(height * (1 + width * 4));
    for (let y = 0; y < height; y++) {
        // Each row's first byte is its filter, 0 for none.
        rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
    }
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', new Uint8Array(0))]);
}

/** The swatch as a PNG, `scale` pixels to the point: main reads it with that scale factor. */
export function swatchPng(colors: ThemeColors, scale: number): Buffer {
    const { size, rgba } = swatchPixels(colors, scale);
    return pngOf(size, size, rgba);
}
