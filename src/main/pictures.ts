import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PICTURE_NAME } from '../shared/themes.ts';

/**
 * The pictures themes carry, kept in `<userData>/backgrounds/`.
 *
 * A picture comes from a file the player picked, from a theme file somebody
 * else made, or from the kit's own (`presets.ts`). The first two are
 * strangers' bytes, so nothing about a picture is taken on trust, and the
 * kit's own go through the same checks rather than a way in of their own. Its
 * type is read off its first bytes rather than its name, and only four types
 * are kept: PNG, JPEG, WebP and GIF. SVG never is, since an SVG can carry
 * script. Each is stored under its sha-256, so the same picture twice is one
 * file, and a name is all anything outside this file ever holds — the page
 * asks for a picture by name through the `zanaris-bg:` scheme, and `path`
 * answers only for a name shaped exactly as this store makes them, so no name
 * can reach outside the folder.
 * Spec: docs/superpowers/specs/2026-09-25-custom-themes-and-pictures-design.md.
 */

export type PictureType = 'png' | 'jpg' | 'webp' | 'gif';

/** A picture a theme can carry: big enough for any screen, small enough that a theme file stays something to pass around. */
export const PICTURE_MAX = 10 * 1024 * 1024;

/**
 * The most pixels a picture may have: a 5K screen's worth, about 59 MB once
 * decoded. The file limit says nothing about this — a single-colour PNG of
 * 20000×20000 fits in 10 MB and decodes to 1.6 GB, in every page that shows
 * it — so the header's own size is checked too.
 */
export const PICTURE_PIXELS_MAX = 5120 * 2880;
/** Either side may be long, for a panorama, but not past this. */
export const PICTURE_SIDE_MAX = 8192;

export const MIME: Readonly<Record<PictureType, string>> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

const at = (bytes: Uint8Array, offset: number, signature: readonly number[]): boolean => signature.every((b, i) => bytes[offset + i] === b);

/** What the first bytes say a picture is, or null for anything but the four kept types. */
export function pictureType(bytes: Uint8Array): PictureType | null {
    if (at(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
    if (at(bytes, 0, [0xff, 0xd8, 0xff])) return 'jpg';
    if (at(bytes, 0, [0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'gif';
    if (at(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && at(bytes, 8, [0x57, 0x45, 0x42, 0x50])) return 'webp';
    return null;
}

const u16be = (b: Uint8Array, i: number): number => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u16le = (b: Uint8Array, i: number): number => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, i: number): number => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16);
const u32be = (b: Uint8Array, i: number): number => (((b[i] ?? 0) << 24) >>> 0) + (((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0));
const u32le = (b: Uint8Array, i: number): number => (u16le(b, i) + u16le(b, i + 2) * 65536) >>> 0;

/** JPEG's start-of-frame markers, which carry the size: C0–CF except C4 (tables), C8 (reserved) and CC (arithmetic). */
const JPEG_FRAME = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
    let i = 2;
    while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null;
        const marker = b[i + 1] ?? 0;
        if (marker === 0xff) {
            i++;
            continue;
        }
        if (JPEG_FRAME.has(marker)) return { width: u16be(b, i + 7), height: u16be(b, i + 5) };
        // Markers with no length of their own.
        if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
            i += 2;
            continue;
        }
        const length = u16be(b, i + 2);
        if (length < 2) return null;
        i += 2 + length;
    }
    return null;
}

/**
 * A picture's width and height, read off its header without decoding a
 * pixel, or null when the header does not say — which `add` refuses, since a
 * size it cannot check is a size it cannot bound.
 */
export function pictureSize(bytes: Uint8Array): { width: number; height: number } | null {
    const type = pictureType(bytes);
    let size: { width: number; height: number } | null = null;
    if (type === 'png' && bytes.length >= 24) size = { width: u32be(bytes, 16), height: u32be(bytes, 20) };
    else if (type === 'gif' && bytes.length >= 10) size = { width: u16le(bytes, 6), height: u16le(bytes, 8) };
    else if (type === 'jpg') size = jpegSize(bytes);
    else if (type === 'webp' && bytes.length >= 25) {
        const chunk = String.fromCharCode(...bytes.subarray(12, 16));
        if (chunk === 'VP8 ') size = { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
        else if (chunk === 'VP8L' && bytes[20] === 0x2f) {
            const bits = u32le(bytes, 21);
            size = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
        } else if (chunk === 'VP8X') size = { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
    }
    return size && size.width > 0 && size.height > 0 ? size : null;
}

/** The name `add` keeps a picture under: its sha-256 and the type its bytes say it is. Null for a type the store does not keep. */
export function pictureName(bytes: Uint8Array): string | null {
    const type = pictureType(bytes);
    return type === null ? null : `${createHash('sha256').update(bytes).digest('hex')}.${type}`;
}

/** A name `PictureStore` made, or one about to be: its hash and type, or the same with `.incoming` while it is written. */
const STORED = new RegExp(`^(?:${PICTURE_NAME.source.slice(1, -1)})(?:\\.incoming)?$`);

export class PictureStore {
    readonly dir: string;

    constructor(dir: string) {
        this.dir = dir;
    }

    /**
     * Keeps a picture and answers its name, or says why not. Written beside
     * its final name and renamed into place, so a picture is either whole
     * or absent — never half there under a name the page will ask for.
     */
    add(bytes: Uint8Array): { picture: string } | { error: string } {
        if (bytes.length > PICTURE_MAX) {
            return { error: `That picture is ${(bytes.length / 1024 / 1024).toFixed(1)} MB. A theme can carry one of up to 10 MB.` };
        }
        const picture = pictureName(bytes);
        if (picture === null) return { error: "That isn't a PNG, JPEG, WebP or GIF picture." };
        const size = pictureSize(bytes);
        if (size === null) return { error: "That picture's size can't be read from it." };
        if (size.width > PICTURE_SIDE_MAX || size.height > PICTURE_SIDE_MAX || size.width * size.height > PICTURE_PIXELS_MAX) {
            return { error: `That picture is ${size.width}×${size.height} pixels. A theme can carry one of up to a 5K screen's worth, 5120×2880 pixels.` };
        }
        const file = join(this.dir, picture);
        if (!existsSync(file)) {
            mkdirSync(this.dir, { recursive: true });
            writeFileSync(`${file}.incoming`, bytes);
            renameSync(`${file}.incoming`, file);
        }
        return { picture };
    }

    /** Where a stored picture lives, or null for a name this store would never have made. */
    path(picture: string): string | null {
        return PICTURE_NAME.test(picture) ? join(this.dir, picture) : null;
    }

    /** A stored picture's bytes and type, or null when there is no such picture. */
    read(picture: string): { bytes: Buffer; type: PictureType } | null {
        const file = this.path(picture);
        if (file === null || !existsSync(file)) return null;
        return { bytes: readFileSync(file), type: picture.slice(picture.lastIndexOf('.') + 1) as PictureType };
    }

    /**
     * Deletes every picture no theme keeps — one whose theme was deleted, or
     * one chosen in an editor that was then cancelled — and any left half
     * written. Leaves alone anything this store did not name. Never throws: it
     * runs at launch, where a throw would stop every window opening, and a
     * picture that cannot be deleted today — held open, say — costs only disk.
     */
    prune(keep: ReadonlySet<string>): void {
        let names: string[];
        try {
            names = existsSync(this.dir) ? readdirSync(this.dir) : [];
        } catch {
            return;
        }
        for (const name of names) {
            if (!STORED.test(name) || keep.has(name)) continue;
            try {
                rmSync(join(this.dir, name), { force: true });
            } catch {
                // Tried again at the next prune.
            }
        }
    }
}
