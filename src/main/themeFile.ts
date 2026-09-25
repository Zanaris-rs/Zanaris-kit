import { FITS, SHOW_MAX, readColors, readThemeName, type Fit, type Theme, type ThemeColors } from '../shared/themes.ts';
import { PICTURE_MAX, pictureType, type PictureType } from './pictures.ts';

/**
 * A theme as a file one player hands another: `<name>.zktheme`, one JSON
 * object carrying the look and nothing else — no id, no server, no layout —
 * with its picture inline as base64, so a theme is one file with no zip and
 * no dependency, as Milestone 3 of the panes design planned.
 *
 * A theme file is somebody else's writing, so reading one is strict: every
 * colour a colour, the name a name, the picture one of the four types by its
 * own bytes and within the limit. Anything else is refused with a sentence
 * saying what, and nothing is half-imported.
 * Spec: docs/superpowers/specs/2026-09-25-custom-themes-and-pictures-design.md.
 */

export const THEME_FILE_VERSION = 1;
export const THEME_FILE_EXTENSION = 'zktheme';
/** A 10 MB picture is about 13.4 MB as base64; past this a file is not one this kit wrote. Checked before the file is read. */
export const THEME_FILE_MAX = 16 * 1024 * 1024;

/** A theme as a file hands it over: its look, with the picture's bytes rather than a stored name. */
export interface ThemeFromFile {
    name: string;
    colors: ThemeColors;
    background: { bytes: Buffer; fit: Fit; show: number } | null;
}

const NOT_A_THEME = "That file isn't a Zanaris Kit theme.";
/**
 * Base64 as one character class and a length rule, never a repeated group: a
 * group repeated over a 13 MB string overflows the regex engine's stack, so a
 * theme file could crash an import just by being big.
 */
const BASE64_CHARS = /^[A-Za-z0-9+/]*={0,2}$/;
const isBase64 = (data: string): boolean => data.length % 4 === 0 && BASE64_CHARS.test(data);

type Read<T> = { ok: true; value: T } | { ok: false; error: string };

function readPicture(x: unknown): Read<ThemeFromFile['background']> {
    if (x === null || x === undefined) return { ok: true, value: null };
    if (typeof x !== 'object') return { ok: false, error: "That theme's picture can't be read." };
    const b = x as Record<string, unknown>;
    const fit = FITS.find(f => f === b.fit);
    const show = b.show;
    if (fit === undefined || typeof show !== 'number' || !Number.isFinite(show) || show < 0 || show > SHOW_MAX || typeof b.data !== 'string') {
        return { ok: false, error: "That theme's picture can't be read." };
    }
    // Sized from its length before it is decoded, so an oversized picture costs nothing to refuse.
    const size = Math.floor((b.data.length * 3) / 4) - (b.data.endsWith('==') ? 2 : b.data.endsWith('=') ? 1 : 0);
    if (size > PICTURE_MAX) return { ok: false, error: `That theme's picture is ${(size / 1024 / 1024).toFixed(1)} MB. A theme can carry one of up to 10 MB.` };
    if (!isBase64(b.data)) return { ok: false, error: "That theme's picture can't be read." };
    const bytes = Buffer.from(b.data, 'base64');
    // Typed by its bytes, never by what the file says: `type` is only a note for a person reading the file.
    if (pictureType(bytes) === null) return { ok: false, error: "That theme's picture isn't a PNG, JPEG, WebP or GIF." };
    return { ok: true, value: { bytes, fit, show } };
}

export function readThemeFile(text: string): { ok: true; theme: ThemeFromFile } | { ok: false; error: string } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, error: NOT_A_THEME };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false, error: NOT_A_THEME };
    const f = parsed as Record<string, unknown>;
    if (typeof f.zanarisKitTheme !== 'number') return { ok: false, error: NOT_A_THEME };
    if (f.zanarisKitTheme > THEME_FILE_VERSION) return { ok: false, error: 'That theme was made by a newer Zanaris Kit. Update the kit to open it.' };
    if (f.zanarisKitTheme !== THEME_FILE_VERSION) return { ok: false, error: NOT_A_THEME };
    const name = readThemeName(f.name);
    if (name === null) return { ok: false, error: "That theme has no name the kit can use: it needs one of 1 to 40 characters, on one line." };
    const colors = readColors(f.colors);
    if (colors === null) return { ok: false, error: "One of that theme's colours isn't a #rrggbb colour." };
    const background = readPicture(f.background);
    if (!background.ok) return background;
    return { ok: true, theme: { name, colors, background: background.value } };
}

/**
 * A theme as its file. `picture` is its stored picture's bytes and type, or
 * null — for a theme with no picture, or one whose picture is gone from the
 * store, which is written without one rather than with a name nobody else
 * could open.
 */
export function writeThemeFile(theme: Pick<Theme, 'name' | 'colors' | 'background'>, picture: { bytes: Uint8Array; type: PictureType } | null): string {
    const background =
        theme.background && picture
            ? { type: picture.type, fit: theme.background.fit, show: theme.background.show, data: Buffer.from(picture.bytes).toString('base64') }
            : null;
    return `${JSON.stringify({ zanarisKitTheme: THEME_FILE_VERSION, name: theme.name, colors: theme.colors, background }, null, 2)}\n`;
}

/**
 * What Export suggests calling the file: the theme's name made safe on all
 * three platforms, as `layoutFileName` makes a tab's. The save dialog lets
 * the player rename it anyway.
 */
export function themeFileName(name: string): string {
    const safe = name
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\.+/, '')
        .replace(/[. ]+$/, '')
        .slice(0, 80)
        .trim();
    return `${safe || 'Theme'}.${THEME_FILE_EXTENSION}`;
}
