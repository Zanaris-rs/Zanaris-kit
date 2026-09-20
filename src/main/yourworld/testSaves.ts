import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, SAV_MAGIC } from './save.ts';

/**
 * The fleet engine's own version 7 fixture (`test/fixtures/save-v7.sav`
 * there): a character with every stat at 99, standing in Lumbridge.
 */
export function fixtureSave(): Uint8Array {
    return new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures', 'save-v7.sav')));
}

export interface SaveSpec {
    magic?: number;
    version?: number;
    playtime?: number;
    /** 21 raw xp values in PlayerStat order. Defaults to a new character's: 0, and hitpoints at level 10. */
    xp?: number[];
}

/**
 * The part of a save that readSave reads: the header and the 21 stats, then
 * empty varp and inventory counts and a correct checksum. That is not a save
 * the engine could load, because a version 7 save carries more after the
 * inventories. It exists for the kit's own reader and nothing else. With no
 * varps, the version 7 and older varp layouts are the same bytes.
 */
export function buildSave(spec: SaveSpec = {}): Uint8Array {
    const version = spec.version ?? 7;
    const bytes: number[] = [];
    const u1 = (v: number): void => void bytes.push(v & 0xff);
    const u2 = (v: number): void => {
        u1(v >> 8);
        u1(v);
    };
    const i4 = (v: number): void => {
        u1(v >> 24);
        u1(v >> 16);
        u1(v >> 8);
        u1(v);
    };
    u2(spec.magic ?? SAV_MAGIC);
    u2(version);
    u2(3222);
    u2(3218);
    u1(0);
    for (let i = 0; i < 13; i++) u1(0);
    u2(10_000);
    if (version >= 2) i4(spec.playtime ?? 0);
    else u2(spec.playtime ?? 0);
    const xp = spec.xp ?? Array.from({ length: 21 }, (_, i) => (i === 3 ? 11_540 : 0));
    for (let i = 0; i < 21; i++) {
        i4(xp[i] ?? 0);
        u1(1);
    }
    u2(0);
    u1(0);
    return withChecksum(Uint8Array.from(bytes));
}

/** `body` with the engine's trailing checksum of it appended. */
export function withChecksum(body: Uint8Array): Uint8Array {
    const out = new Uint8Array(body.length + 4);
    out.set(body);
    new DataView(out.buffer).setInt32(body.length, crc32(body, 0, body.length));
    return out;
}
