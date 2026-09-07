import type { HiscoresSource, PlayerSkill } from '../../shared/hiscores.ts';
import { normaliseName } from '../../shared/hiscores.ts';

/**
 * One URL builder, one parser, three servers' quirks. Pure: fetching is
 * injected by the caller, so every parser here is exercised against the
 * real payloads saved under fixtures/ rather than a live socket.
 */

// ── url ───────────────────────────────────────────────────────────────────

/**
 * The endpoint for one lookup. `{name}` sits in a path segment for Lost City
 * and Zanaris, and in a query string for Labs, but one substitution serves
 * all three: `normaliseName`'s output is confined to `[a-z0-9_]`, so it can
 * never contain a `/`, `?`, `#` or `%` for either position to trip over.
 * That is the whole reason no escaping appears anywhere in this file.
 */
export function lookupUrl(source: HiscoresSource, name: string): string {
    return source.url.replace('{name}', normaliseName(name));
}

// ── not found ─────────────────────────────────────────────────────────────

/** A lookup that reached the server and found nobody. Distinct from a failure. */
export const NOT_FOUND = Symbol('hiscores:not-found');

// ── row validation ───────────────────────────────────────────────────────

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function asNumber(value: unknown, where: string, field: string): number {
    if (typeof value !== 'number') throw new Error(`${where}: ${field} must be a number`);
    return value;
}

/** The `skills` array shared by Zanaris and Labs, once past their differing not-found status. */
function skillsArray(json: unknown, where: string): unknown[] {
    if (!isRecord(json)) throw new Error(`${where}: expected an object`);
    if (!Array.isArray(json.skills)) throw new Error(`${where}: expected a skills array`);
    return json.skills;
}

// ── Lost City ─────────────────────────────────────────────────────────────

/**
 * Lost City's rows carry xp as tenths in `value` — confirmed by reading the
 * engine (`Player.ts`): `levelExperience[i]` is accumulated as
 * `Math.floor(acc / 4) * 10`, a genuine fixed-point value with one decimal
 * of precision the client keeps internally. Verified live too: a maxed
 * account's Attack row (level 99, roughly 13.07m xp) came back as
 * `value: 130731598`, which is not a multiple of ten — that decimal is real
 * and non-multiples are the common case at high xp, not malformed data.
 *
 * Nothing in this feature reads that decimal: there is no xp-to-next-level
 * bar in scope, and `toLocaleString` would render it as a stray
 * "13,073,159.8" that no hiscores site shows. So it is discarded here,
 * once, rather than left for the panel to notice and floor on its own —
 * `Math.floor(value / 10)` keeps `PlayerSkill.xp` a whole number from all
 * three sources, matching Zanaris and Labs, which already send whole xp.
 */
function parseLostCityPlayer(status: number, json: unknown): PlayerSkill[] | typeof NOT_FOUND {
    // Lost City has no not-found status of its own — a missing player is a
    // 200 with an empty list, so 200 is the only status this function ever
    // interprets. A 429 (Lost City rate-limits after a handful of requests
    // inside a minute, verified live), a 5xx, or a proxy's HTML error page
    // all fall through to the throw below; turning that into a message is
    // H3's job, not this file's.
    if (status !== 200) throw new Error(`Lost City hiscores: unexpected status ${status}`);
    if (!Array.isArray(json)) throw new Error('Lost City hiscores: expected a list');
    if (json.length === 0) return NOT_FOUND;
    return json.map((row, i): PlayerSkill => {
        const where = `Lost City hiscores[${i}]`;
        if (!isRecord(row)) throw new Error(`${where}: expected an object`);
        const value = asNumber(row.value, where, 'value');
        return {
            type: asNumber(row.type, where, 'type'),
            rank: asNumber(row.rank, where, 'rank'),
            level: asNumber(row.level, where, 'level'),
            xp: Math.floor(value / 10)
        };
    });
}

// ── Zanaris ───────────────────────────────────────────────────────────────

/** Zanaris indexes its rows by `category`, not `type` — verified live; not a typo. */
function parseZanarisPlayer(status: number, json: unknown): PlayerSkill[] | typeof NOT_FOUND {
    if (status === 404) return NOT_FOUND;
    // Only 200 and 404 carry an answer; a 429, a 5xx, or a proxy's HTML
    // error page fall through to this throw, for H3 to turn into a message.
    if (status !== 200) throw new Error(`Zanaris hiscores: unexpected status ${status}`);
    const skills = skillsArray(json, 'Zanaris hiscores');
    return skills.map((row, i): PlayerSkill => {
        const where = `Zanaris hiscores.skills[${i}]`;
        if (!isRecord(row)) throw new Error(`${where}: expected an object`);
        return {
            type: asNumber(row.category, where, 'category'),
            rank: asNumber(row.rank, where, 'rank'),
            level: asNumber(row.level, where, 'level'),
            xp: asNumber(row.xp, where, 'xp')
        };
    });
}

// ── Labs ──────────────────────────────────────────────────────────────────

/**
 * Labs indexes its rows by `type`, matching the shared skill table's own
 * key. It also returns `kills`, `mode` and `board` alongside `skills` — all
 * out of scope for v1 (see the plan) — so this function reads past them
 * without validating or touching them at all; a malformed `kills` or an
 * unexpected `mode` must never trip a parser that never looks at either.
 */
function parseLabsPlayer(status: number, json: unknown): PlayerSkill[] | typeof NOT_FOUND {
    if (status === 404) return NOT_FOUND;
    // Only 200 and 404 carry an answer; a 429, a 5xx, or a proxy's HTML
    // error page fall through to this throw, for H3 to turn into a message.
    if (status !== 200) throw new Error(`Labs hiscores: unexpected status ${status}`);
    const skills = skillsArray(json, 'Labs hiscores');
    return skills.map((row, i): PlayerSkill => {
        const where = `Labs hiscores.skills[${i}]`;
        if (!isRecord(row)) throw new Error(`${where}: expected an object`);
        return {
            type: asNumber(row.type, where, 'type'),
            rank: asNumber(row.rank, where, 'rank'),
            level: asNumber(row.level, where, 'level'),
            xp: asNumber(row.xp, where, 'xp')
        };
    });
}

// ── the dispatcher ────────────────────────────────────────────────────────

/**
 * One server's answer, as rows. NOT_FOUND when the server said so in its own
 * way — Lost City's empty 200, or a 404 from Zanaris or Labs. Throws when
 * the body is not the shape this server promises, or when the status is
 * neither a success nor this server's own not-found (a 429, a 5xx, a
 * proxy's HTML error page): none of those carry an answer, so guessing at
 * one here would only hide the problem from H3, which is where it belongs.
 */
export function parsePlayer(source: HiscoresSource, status: number, json: unknown): PlayerSkill[] | typeof NOT_FOUND {
    switch (source.kind) {
        case 'lostcity':
            return parseLostCityPlayer(status, json);
        case 'zanaris':
            return parseZanarisPlayer(status, json);
        case 'labs':
            return parseLabsPlayer(status, json);
    }
}
