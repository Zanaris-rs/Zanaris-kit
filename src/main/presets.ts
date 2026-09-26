import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Fit } from '../shared/themes.ts';
import { pictureName, pictureType, type PictureType } from './pictures.ts';

/**
 * The kit's own pictures: what a theme's picture can be without a file of the
 * player's. Each is the game's own art, made from the 274 content pin
 * (32019eb) into `static/pictures/` by `scripts/make-pictures.mjs`, which
 * reads this list, so what is made and what is offered are one list.
 *
 * Picking one stores its bytes through `PictureStore`, as a file of the
 * player's is stored, so a theme names a stored picture and never one of
 * these. No id here is ever saved, and the set can change between releases.
 *
 * Imported by that script under Electron's own Node as well as bundled into
 * main, so its imports name their `.ts` files.
 * Spec: docs/superpowers/specs/2026-09-26-kit-pictures-design.md.
 */

export interface Preset {
    /** What Settings asks for one by. Lower-case letters only, so it sits in a URL as it is. */
    id: string;
    /** Sentence case, as the renderer draws everything. */
    name: string;
    fit: Fit;
    /** Its file in `static/pictures/`. */
    file: string;
    /** What it was made from, in the content checkout. */
    from: string;
    /**
     * How it was made: `mirror` sets the source beside its own mirror image,
     * as the 274 client draws its title screen; `double` scales a texture to
     * twice its size by nearest neighbour, so it tiles large enough to read as
     * what it is behind a panel, and its pixels stay hard.
     */
    make: 'mirror' | 'double';
}

export const PRESETS: readonly Preset[] = [
    { id: 'title', name: 'Title screen', fit: 'cover', file: 'title.jpg', from: 'binary/title.jpg', make: 'mirror' },
    { id: 'lava', name: 'Lava', fit: 'tile', file: 'lava.png', from: 'textures/lava.png', make: 'double' },
    { id: 'water', name: 'Water', fit: 'tile', file: 'water.png', from: 'textures/water.png', make: 'double' },
    { id: 'swamp', name: 'Swamp', fit: 'tile', file: 'swamp.png', from: 'textures/gungywater.png', make: 'double' },
    { id: 'marble', name: 'Marble', fit: 'tile', file: 'marble.png', from: 'textures/marble.png', make: 'double' },
    // The brick is called planks in the content, whatever it looks like.
    { id: 'brick', name: 'Brick', fit: 'tile', file: 'brick.png', from: 'textures/planks.png', make: 'double' },
    { id: 'cobbles', name: 'Cobbles', fit: 'tile', file: 'cobbles.png', from: 'textures/pebblefloor.png', make: 'double' },
    { id: 'sandstone', name: 'Sandstone', fit: 'tile', file: 'sandstone.png', from: 'textures/elfbrick.png', make: 'double' },
    { id: 'rock', name: 'Rock', fit: 'tile', file: 'rock.png', from: 'textures/rockwall.png', make: 'double' },
    { id: 'roof', name: 'Roof tiles', fit: 'tile', file: 'roof.png', from: 'textures/roof.png', make: 'double' },
    { id: 'thatch', name: 'Thatch', fit: 'tile', file: 'thatch.png', from: 'textures/thatched.png', make: 'double' },
    { id: 'oak', name: 'Oak', fit: 'tile', file: 'oak.png', from: 'textures/wood2.png', make: 'double' }
];

/** What Settings is sent for a preset: enough to draw its thumbnail, and the name `PictureStore` will keep it under, to mark the one a draft wears. */
export interface PresetCard {
    id: string;
    name: string;
    fit: Fit;
    picture: string;
}

/**
 * A preset's bytes, read from `dir`, or null for an id the list does not
 * have or a file that cannot be read. The id is only ever looked up in the
 * list; it never becomes part of a path.
 */
export function readPreset(dir: string, id: unknown): Uint8Array | null {
    const preset = PRESETS.find(p => p.id === id);
    if (!preset) return null;
    try {
        return readFileSync(join(dir, preset.file));
    } catch {
        return null;
    }
}

/** A preset's bytes and the type they say they are, for the scheme's `preset` host, which draws the gallery's thumbnails. Null for an id the list does not have, or a file that is not a picture. */
export function presetFile(dir: string, id: unknown): { bytes: Uint8Array; type: PictureType } | null {
    const bytes = readPreset(dir, id);
    const type = bytes && pictureType(bytes);
    return bytes && type ? { bytes, type } : null;
}

/** Every preset whose file reads as a picture, as Settings draws it. One whose file is missing is left out, rather than offered and then refused. */
export function presetCards(dir: string): PresetCard[] {
    const cards: PresetCard[] = [];
    for (const preset of PRESETS) {
        const bytes = readPreset(dir, preset.id);
        const picture = bytes && pictureName(bytes);
        if (picture) cards.push({ id: preset.id, name: preset.name, fit: preset.fit, picture });
    }
    return cards;
}
