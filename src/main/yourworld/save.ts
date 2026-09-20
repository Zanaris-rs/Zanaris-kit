import type { SaveProblem, SaveSummary } from '../../shared/yourworld.ts';

/*
 * Reads the head of a character save without the engine. The engine's reader
 * is PlayerLoading.load (src/engine/entity/PlayerLoading.ts in the pinned
 * checkout), and this makes its checks in its order: an empty file is a new
 * character, then the magic, the version and the checksum. It then reads the
 * position, the look, the run energy, the play time and the 21 stats, and
 * stops. The varps and inventories after them are the engine's business, so a
 * change there cannot break this; a change to anything before them has to be
 * made here too.
 */

export const SAV_MAGIC = 0x2004;
/** PlayerLoading.SAV_VERSION: the newest format this reads. */
export const SAV_VERSION = 7;

/** A file the engine would refuse, and which of its checks refused it. */
export class SaveError extends Error {
    readonly kind: SaveProblem;

    constructor(kind: SaveProblem, message: string) {
        super(message);
        this.kind = kind;
    }
}

const STAT_COUNT = 21;
// PlayerStat (src/engine/entity/PlayerStat.ts): the order stats are saved in.
const ATTACK = 0;
const DEFENCE = 1;
const STRENGTH = 2;
const HITPOINTS = 3;
const RANGED = 4;
const PRAYER = 5;
const MAGIC = 6;
/**
 * PlayerStatEnabled. The client's Total Lvl (its script op 9) sums the base
 * level of every stat its own Skill.used marks, and for the 21 a save holds
 * that is this list: stats 18 and 19 are unused.
 */
const STAT_ENABLED: readonly boolean[] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, false, false, true];

/** Packet.crctable: CRC-32, reflected, polynomial 0xEDB88320. */
const CRC_TABLE = ((): Int32Array => {
    const table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
        let remainder = i;
        for (let bit = 0; bit < 8; bit++) {
            remainder = (remainder & 1) === 1 ? (remainder >>> 1) ^ 0xedb88320 : remainder >>> 1;
        }
        table[i] = remainder;
    }
    return table;
})();

/**
 * Packet.getcrc: the CRC-32 of `src` from `offset` up to, not including,
 * `end` (the engine calls it `length`, and uses it as an end). Returned as a
 * signed 32-bit int, which is how a save's trailing checksum is read.
 */
export function crc32(src: Uint8Array, offset: number, end: number): number {
    let crc = 0xffffffff;
    for (let i = offset; i < end; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ src[i]!) & 0xff]!;
    return ~crc;
}

/**
 * Player.ts's levelExperience: the xp each level from 2 to 100 starts at, in
 * the tenths of a point a save stores. Level 99 starts at 130,344,310, which
 * the game shows as 13,034,431.
 */
const LEVEL_XP = ((): Int32Array => {
    const table = new Int32Array(99);
    let acc = 0;
    for (let i = 0; i < 99; i++) {
        const level = i + 1;
        acc += Math.floor(level + Math.pow(2.0, level / 7.0) * 300.0);
        table[i] = Math.floor(acc / 4) * 10;
    }
    return table;
})();

/** getLevelByExp: the base level for a save's raw xp. */
export function levelFromXp(xp: number): number {
    for (let i = 98; i >= 0; i--) {
        if (xp >= LEVEL_XP[i]!) return Math.min(i + 2, 99);
    }
    return 1;
}

/** getExpByLevel: the raw xp a level from 2 to 99 starts at. */
export function xpForLevel(level: number): number {
    return LEVEL_XP[level - 2]!;
}

/** Player.getCombatLevel, from base levels in PlayerStat order. */
export function combatLevel(base: readonly number[]): number {
    const at = (stat: number): number => base[stat] ?? 1;
    const defensive = 0.25 * (at(DEFENCE) + at(HITPOINTS) + Math.floor(at(PRAYER) / 2));
    const melee = 0.325 * (at(ATTACK) + at(STRENGTH));
    const ranged = 0.325 * (Math.floor(at(RANGED) / 2) + at(RANGED));
    const magic = 0.325 * (Math.floor(at(MAGIC) / 2) + at(MAGIC));
    return Math.floor(defensive + Math.max(melee, ranged, magic));
}

/** The skills tab's Total Lvl, from base levels in PlayerStat order. */
export function totalLevel(base: readonly number[]): number {
    let total = 0;
    for (let stat = 0; stat < STAT_COUNT; stat++) {
        if (STAT_ENABLED[stat]) total += base[stat] ?? 1;
    }
    return total;
}

/** A new character, as PlayerLoading makes one from an empty file: level 1 everywhere but hitpoints, which is 10. */
function freshSummary(): SaveSummary {
    const base = new Array<number>(STAT_COUNT).fill(1);
    base[HITPOINTS] = levelFromXp(xpForLevel(10));
    return { version: 0, combatLevel: combatLevel(base), totalLevel: totalLevel(base), playtimeTicks: 0 };
}

/** Reads a save's head. Throws a SaveError for any file the engine would refuse to log in with. */
export function readSave(data: Uint8Array): SaveSummary {
    if (data.length < 2) return freshSummary();
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let pos = 0;
    // The engine would throw a RangeError reading past the end; that is a damaged file, and says so.
    const take = (bytes: number): number => {
        if (pos + bytes > data.length) throw new SaveError('corrupt', 'The save ends early');
        const at = pos;
        pos += bytes;
        return at;
    };
    const u2 = (): number => view.getUint16(take(2));
    const i4 = (): number => view.getInt32(take(4));

    if (u2() !== SAV_MAGIC) throw new SaveError('not-a-save', 'Not a save file');
    const version = u2();
    if (version > SAV_VERSION) throw new SaveError('too-new', `Save version ${version} is newer than ${SAV_VERSION}`);
    if (view.getInt32(data.length - 4) !== crc32(data, 0, data.length - 4)) throw new SaveError('corrupt', 'The save checksum does not match');

    take(2 + 2 + 1); // x, z, level
    take(7 + 5 + 1); // body, colours, gender
    take(2); // run energy
    const playtimeTicks = version >= 2 ? i4() : u2();
    const base: number[] = [];
    for (let stat = 0; stat < STAT_COUNT; stat++) {
        base.push(levelFromXp(i4()));
        take(1); // the current, possibly boosted, level
    }
    return { version, combatLevel: combatLevel(base), totalLevel: totalLevel(base), playtimeTicks };
}
