import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SaveProblem } from '../../shared/yourworld.ts';
import { combatLevel, crc32, levelFromXp, readSave, SaveError, totalLevel, xpForLevel } from './save.ts';
import { buildSave, fixtureSave, withChecksum } from './testSaves.ts';

const kindOf = (data: Uint8Array): SaveProblem | 'read' => {
    try {
        readSave(data);
        return 'read';
    } catch (err) {
        if (err instanceof SaveError) return err.kind;
        throw err;
    }
};

/** Base levels in PlayerStat order: a new character's, with some changed. */
const levels = (changes: Record<number, number> = {}): number[] => {
    const base = new Array<number>(21).fill(1);
    base[3] = 10;
    for (const [stat, level] of Object.entries(changes)) base[Number(stat)] = level;
    return base;
};

test('crc32 is the engine\'s: it reproduces the fixture\'s stored checksum, signed', () => {
    const save = fixtureSave();
    const stored = new DataView(save.buffer, save.byteOffset, save.byteLength).getInt32(save.length - 4);
    assert.equal(stored, -858711323);
    assert.equal(crc32(save, 0, save.length - 4), stored);
});

test('crc32 is the standard CRC-32: 0 for nothing, cbf43926 for the check string', () => {
    assert.equal(crc32(new Uint8Array(0), 0, 0), 0);
    assert.equal(crc32(new TextEncoder().encode('123456789'), 0, 9), 0xcbf43926 | 0);
    assert.equal(crc32(new TextEncoder().encode('xx123456789'), 2, 11), 0xcbf43926 | 0, 'from an offset up to an end, not a length');
});

test('the level table is the engine\'s, in tenths of a point', () => {
    assert.equal(xpForLevel(2), 830);
    assert.equal(xpForLevel(10), 11_540);
    assert.equal(xpForLevel(92), 65_172_530);
    assert.equal(xpForLevel(99), 130_344_310);
});

test('levelFromXp: each threshold, the floor, and the 200m cap', () => {
    assert.equal(levelFromXp(-1), 1);
    assert.equal(levelFromXp(0), 1);
    assert.equal(levelFromXp(829), 1);
    assert.equal(levelFromXp(830), 2);
    assert.equal(levelFromXp(65_172_529), 91);
    assert.equal(levelFromXp(65_172_530), 92);
    assert.equal(levelFromXp(130_344_309), 98);
    assert.equal(levelFromXp(130_344_310), 99);
    assert.equal(levelFromXp(2_000_000_000), 99);
});

test('combatLevel is Player.getCombatLevel: the best of melee, ranged and magic over the defensive base', () => {
    assert.equal(combatLevel(levels()), 3);
    assert.equal(combatLevel(new Array<number>(21).fill(99)), 126);
    assert.equal(combatLevel(levels({ 0: 60, 2: 70, 1: 50, 3: 65, 5: 43 })), 76);
    assert.equal(combatLevel(levels({ 4: 99 })), 50);
    assert.equal(combatLevel(levels({ 6: 99, 5: 52 })), 57);
});

test('totalLevel sums the skills the client counts, and not the two unused stats', () => {
    assert.equal(totalLevel(levels()), 28);
    assert.equal(totalLevel(new Array<number>(21).fill(99)), 1881);
    assert.equal(totalLevel(levels({ 18: 99, 19: 99 })), 28);
});

test('readSave reads the fixture as the engine does', () => {
    assert.deepEqual(readSave(fixtureSave()), { version: 7, combatLevel: 126, totalLevel: 1881, playtimeTicks: 3529 });
});

test('an empty file is a new character, as PlayerLoading makes one', () => {
    const fresh = { version: 0, combatLevel: 3, totalLevel: 28, playtimeTicks: 0 };
    assert.deepEqual(readSave(new Uint8Array(0)), fresh);
    assert.deepEqual(readSave(new Uint8Array([0x20])), fresh);
});

test('a built save reads back, and the play time is two bytes before version 2', () => {
    assert.deepEqual(readSave(buildSave()), { version: 7, combatLevel: 3, totalLevel: 28, playtimeTicks: 0 });
    assert.deepEqual(readSave(buildSave({ version: 2, playtime: 100_000 })), { version: 2, combatLevel: 3, totalLevel: 28, playtimeTicks: 100_000 });
    const maxed = new Array<number>(21).fill(130_344_310);
    assert.deepEqual(readSave(buildSave({ version: 1, playtime: 65_535, xp: maxed })), { version: 1, combatLevel: 126, totalLevel: 1881, playtimeTicks: 65_535 });
});

test('the engine\'s checks, in its order', () => {
    assert.equal(kindOf(new TextEncoder().encode('hello, world')), 'not-a-save');
    assert.equal(kindOf(buildSave({ magic: 0x2005 })), 'not-a-save');
    // The version is checked before the checksum, so a newer save is named as one even when the sum is off.
    const newer = buildSave({ version: 8 });
    newer[20] = newer[20]! ^ 0xff;
    assert.equal(kindOf(newer), 'too-new');
    const flipped = fixtureSave();
    flipped[100] = flipped[100]! ^ 0x01;
    assert.equal(kindOf(flipped), 'corrupt');
    assert.equal(kindOf(fixtureSave().slice(0, 100)), 'corrupt');
    assert.equal(kindOf(new Uint8Array([0x20, 0x04, 0x00])), 'corrupt', 'the magic, then too little for a version');
});

test('a checksum that matches over a file too short for its stats is still refused', () => {
    const short = withChecksum(buildSave().slice(0, 60));
    assert.equal(kindOf(short), 'corrupt');
});
