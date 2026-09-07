import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lookupUrl, parsePlayer, NOT_FOUND } from './sources.ts';
import type { HiscoresSource, PlayerSkill } from '../../shared/hiscores.ts';

const fixture = (name: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8'));

/** Narrows away NOT_FOUND for the tests that expect an actual answer. */
function rowsOrThrow(result: PlayerSkill[] | typeof NOT_FOUND): PlayerSkill[] {
    if (result === NOT_FOUND) throw new Error('expected rows, got NOT_FOUND');
    return result;
}

const LOSTCITY: HiscoresSource = { kind: 'lostcity', url: 'https://2004.lostcity.rs/api/hiscores/player/{name}' };
const ZANARIS: HiscoresSource = { kind: 'zanaris', url: 'https://zanaris.rs/api/hiscores/player/{name}' };
const LABS: HiscoresSource = { kind: 'labs', url: 'https://www.lostcitylabs.com/hiscores/player?name={name}' };

// ── lookupUrl ─────────────────────────────────────────────────────────────

test('lookupUrl builds Lost City\'s path, normalising the name first', () => {
    assert.equal(lookupUrl(LOSTCITY, 'granny_grunt'), 'https://2004.lostcity.rs/api/hiscores/player/granny_grunt');
    assert.equal(lookupUrl(LOSTCITY, 'granny grunt'), 'https://2004.lostcity.rs/api/hiscores/player/granny_grunt');
    assert.equal(lookupUrl(LOSTCITY, 'GRANNY_GRUNT'), 'https://2004.lostcity.rs/api/hiscores/player/granny_grunt');
    assert.equal(lookupUrl(LOSTCITY, 'Granny-Grunt!'), 'https://2004.lostcity.rs/api/hiscores/player/grannygrunt');
});

test('lookupUrl builds Zanaris\'s path the same way', () => {
    assert.equal(lookupUrl(ZANARIS, 'iron_fox'), 'https://zanaris.rs/api/hiscores/player/iron_fox');
    assert.equal(lookupUrl(ZANARIS, 'iron fox'), 'https://zanaris.rs/api/hiscores/player/iron_fox');
    assert.equal(lookupUrl(ZANARIS, 'IRON_FOX'), 'https://zanaris.rs/api/hiscores/player/iron_fox');
    assert.equal(lookupUrl(ZANARIS, "Iron Fox's!"), 'https://zanaris.rs/api/hiscores/player/iron_foxs');
});

test('lookupUrl substitutes into Labs\' query string, not a path segment', () => {
    assert.equal(lookupUrl(LABS, 'knight'), 'https://www.lostcitylabs.com/hiscores/player?name=knight');
    assert.equal(lookupUrl(LABS, 'sir knight'), 'https://www.lostcitylabs.com/hiscores/player?name=sir_knight');
    assert.equal(lookupUrl(LABS, 'KNIGHT'), 'https://www.lostcitylabs.com/hiscores/player?name=knight');
    assert.equal(lookupUrl(LABS, 'Kn!ght'), 'https://www.lostcitylabs.com/hiscores/player?name=knght');
});

// ── Lost City ─────────────────────────────────────────────────────────────
// Real capture: `curl https://2004.lostcity.rs/api/hiscores/player/granny_grunt`.

test('parsePlayer reads Lost City\'s real payload, dividing value by ten for xp', () => {
    const rows = rowsOrThrow(parsePlayer(LOSTCITY, 200, fixture('lostcity-player.json')));
    assert.equal(rows.length, 20, 'granny_grunt has 20 rows: types 0-18 plus 21, since 274 sends neither Slayer nor Farming');

    const raw = fixture('lostcity-player.json') as { type: number; level: number; value: number; rank: number }[];
    const attack = rows.find(r => r.type === 1)!;
    const rawAttack = raw.find(r => r.type === 1)!;
    assert.equal(rawAttack.value, 130731598, 'sanity check on the fixture itself: this is the row the divisibility question turned on');
    assert.deepEqual(attack, { type: 1, rank: rawAttack.rank, level: rawAttack.level, xp: 13073159 });
    // The assertion this whole file exists for: a mutation turning `value / 10`
    // back into plain `value` (or dropping the floor) must fail this line, not
    // just look slightly off. 130731598 / 10 is 13073159.8 — floored, not rounded.
    assert.equal(attack.xp, Math.floor(rawAttack.value / 10));
});

test('Lost City\'s value is not always a multiple of ten, and parsing it is not an error', () => {
    // Verified live: granny_grunt's Attack row is level 99 (~13.07m xp) with
    // value 130731598 — one decimal place of xp, not a whole ten. The engine
    // (Player.ts) confirms this decimal is genuine fixed-point precision, not
    // noise, so rejecting or rounding a value like this would reject data the
    // live server itself considers valid. This catches a stricter parser that
    // throws on the remainder instead of flooring past it.
    const raw = fixture('lostcity-player.json') as { type: number; value: number }[];
    const attack = raw.find(r => r.type === 1)!;
    assert.notEqual(attack.value % 10, 0);
    assert.doesNotThrow(() => parsePlayer(LOSTCITY, 200, fixture('lostcity-player.json')));
});

test('Lost City: a 200 with an empty list is NOT_FOUND, not an empty player', () => {
    assert.equal(parsePlayer(LOSTCITY, 200, []), NOT_FOUND);
});

test('Lost City: a status that is neither 200 nor this server\'s not-found throws', () => {
    // Lost City rate-limits (verified live); 429 has no answer to parse and must throw.
    assert.throws(() => parsePlayer(LOSTCITY, 429, []), /status/);
    assert.throws(() => parsePlayer(LOSTCITY, 500, []), /status/);
    assert.throws(() => parsePlayer(LOSTCITY, 200, '<html>rate limited</html>'), /list/);
});

test('Lost City: malformed bodies throw instead of coercing', () => {
    assert.throws(() => parsePlayer(LOSTCITY, 200, { not: 'a list' }), /expected a list/);
    assert.throws(() => parsePlayer(LOSTCITY, 200, [{ type: 0, level: 1, value: 10 }]), /rank/, 'a row missing rank must throw');
    assert.throws(() => parsePlayer(LOSTCITY, 200, [{ type: 0, level: '1', value: 10, rank: 1 }]), /level/, 'a string level must throw, not be coerced to a number');
});

// ── Zanaris ───────────────────────────────────────────────────────────────
// zanaris-player.json is hand-built: no player was found to capture a real
// success body from, so it is constructed from the plan's documented shape.
// It deliberately carries only 4 of the ~22 possible skill rows — enough to
// exercise the parser, not a snapshot of a real account, so its row count
// should never be compared against the two real captures below.
// zanaris-player-notfound.json IS a real capture (404 for a name that does
// not exist on the live server).

test('parsePlayer reads Zanaris\'s skills, indexed by category (not type)', () => {
    const rows = rowsOrThrow(parsePlayer(ZANARIS, 200, fixture('zanaris-player.json')));
    const raw = fixture('zanaris-player.json') as { skills: { category: number; rank: number; level: number; xp: number }[] };
    assert.equal(rows.length, raw.skills.length);
    assert.deepEqual(rows[0], { type: raw.skills[0]!.category, rank: raw.skills[0]!.rank, level: raw.skills[0]!.level, xp: raw.skills[0]!.xp });
});

test('Zanaris: a real 404 body is NOT_FOUND', () => {
    assert.equal(parsePlayer(ZANARIS, 404, fixture('zanaris-player-notfound.json')), NOT_FOUND);
});

test('Zanaris: a status that is neither 200 nor 404 throws', () => {
    assert.throws(() => parsePlayer(ZANARIS, 500, {}), /status/);
    assert.throws(() => parsePlayer(ZANARIS, 429, {}), /status/);
});

test('Zanaris: malformed bodies throw instead of coercing', () => {
    assert.throws(() => parsePlayer(ZANARIS, 200, null), /expected an object/);
    assert.throws(() => parsePlayer(ZANARIS, 200, []), /expected an object/);
    assert.throws(() => parsePlayer(ZANARIS, 200, { skills: 'nope' }), /expected a skills array/);
    assert.throws(() => parsePlayer(ZANARIS, 200, { skills: [{ category: 0, level: 1, xp: 2 }] }), /rank/, 'a row missing rank must throw');
    assert.throws(() => parsePlayer(ZANARIS, 200, { skills: [{ category: 0, rank: 1, level: '1', xp: 2 }] }), /level/, 'a string level must throw');
});

// ── Labs ──────────────────────────────────────────────────────────────────
// Real capture: `curl https://www.lostcitylabs.com/hiscores/player?name=knight`.

test('parsePlayer reads Labs\' real payload, indexed by type, ignoring kills and mode', () => {
    const rows = rowsOrThrow(parsePlayer(LABS, 200, fixture('labs-player.json')));
    assert.equal(rows.length, 22, 'knight has 22 rows: types 0-21, Labs runs a later revision that sends Slayer and Farming too');

    const raw = fixture('labs-player.json') as { skills: { type: number; rank: number; level: number; xp: number }[] };
    const overall = rows.find(r => r.type === 0)!;
    const rawOverall = raw.skills.find(s => s.type === 0)!;
    assert.deepEqual(overall, { type: 0, rank: rawOverall.rank, level: rawOverall.level, xp: rawOverall.xp });
});

test('Labs: kills, mode and board are ignored rather than tripping the parser', () => {
    const raw = fixture('labs-player.json') as Record<string, unknown>;
    const mutated = { ...raw, kills: 'not even a list', mode: null, board: { nonsense: true } };
    const rows = rowsOrThrow(parsePlayer(LABS, 200, mutated));
    assert.equal(rows.length, 22);
});

test('Labs: a real 404 body is NOT_FOUND', () => {
    assert.equal(parsePlayer(LABS, 404, { error: 'Unknown player.' }), NOT_FOUND);
});

test('Labs: a status that is neither 200 nor 404 throws', () => {
    assert.throws(() => parsePlayer(LABS, 503, {}), /status/);
});

test('Labs: malformed bodies throw instead of coercing', () => {
    assert.throws(() => parsePlayer(LABS, 200, 'nope'), /expected an object/);
    assert.throws(() => parsePlayer(LABS, 200, { skills: {} }), /expected a skills array/);
    assert.throws(() => parsePlayer(LABS, 200, { skills: [{ type: 0, level: 1, xp: 2 }] }), /rank/, 'a row missing rank must throw');
    assert.throws(() => parsePlayer(LABS, 200, { skills: [{ type: 0, rank: 1, level: '1', xp: 2 }] }), /level/, 'a string level must throw');
});
