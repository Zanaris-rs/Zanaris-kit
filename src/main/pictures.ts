import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PICTURE_NAME } from '../shared/themes.ts';

/**
 * The pictures themes carry, kept in `<userData>/backgrounds/`.
 *
 * A picture comes from a file the player picked, or from a theme file
 * somebody else made, so nothing about it is taken on trust. Its type is read
 * off its first bytes rather than its name, and only four types are kept:
 * PNG, JPEG, WebP and GIF. SVG never is, since an SVG can carry script. Each
 * is stored under its sha-256, so the same picture twice is one file, and a
 * name is all anything outside this file ever holds — the page asks for a
 * picture by name through the `zanaris-bg:` scheme, and `path` answers only
 * for a name shaped exactly as this store makes them, so no name can reach
 * outside the folder.
 * Spec: docs/superpowers/specs/2026-09-25-custom-themes-and-pictures-design.md.
 */

export type PictureType = 'png' | 'jpg' | 'webp' | 'gif';

/** A picture a theme can carry: big enough for any screen, small enough that a theme file stays something to pass around. */
export const PICTURE_MAX = 10 * 1024 * 1024;

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
        const type = pictureType(bytes);
        if (type === null) return { error: "That isn't a PNG, JPEG, WebP or GIF picture." };
        const picture = `${createHash('sha256').update(bytes).digest('hex')}.${type}`;
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
     * written. Leaves alone anything this store did not name.
     */
    prune(keep: ReadonlySet<string>): void {
        if (!existsSync(this.dir)) return;
        for (const name of readdirSync(this.dir)) {
            if (STORED.test(name) && !keep.has(name)) rmSync(join(this.dir, name), { force: true });
        }
    }
}
