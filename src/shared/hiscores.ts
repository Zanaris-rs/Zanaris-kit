/**
 * Hiscores types, shared by main and the shell.
 *
 * Lookups are per server rather than per connection like chat: there is no
 * ongoing session here, just a name typed into a box and a table filled in
 * from whichever of the three remote servers' APIs the window belongs to.
 */

export type HiscoresSource =
    | { kind: 'lostcity'; url: string } // .../api/hiscores/player/{name}
    | { kind: 'zanaris'; url: string }
    | { kind: 'labs'; url: string }; // .../hiscores/player?name={name}

export interface HiscoresDef {
    source: HiscoresSource;
    /** Opened by "Full hiscores" at the foot of the panel; null when there is no such page. */
    site: string | null;
}

/**
 * Hiscores type → skill name. Type 0 is Overall, so every skill's type is the
 * engine's own PlayerStat index plus one — checked against
 * engine/src/engine/entity/PlayerStat.ts, whose enum order and disabled flags
 * (indices 18 and 19, Slayer and Farming) this table matches exactly.
 *
 * Lost City Labs runs a later revision than 274 and returns Slayer and
 * Farming rows that 274 never sends; both are listed here so the table is
 * complete for either revision, even though the renderer only ever draws the
 * types a given lookup actually returned.
 */
export const HISCORES_SKILLS: readonly string[] = Object.freeze([
    'Overall',
    'Attack',
    'Defence',
    'Strength',
    'Hitpoints',
    'Ranged',
    'Prayer',
    'Magic',
    'Cooking',
    'Woodcutting',
    'Fletching',
    'Fishing',
    'Firemaking',
    'Crafting',
    'Smithing',
    'Mining',
    'Herblore',
    'Agility',
    'Thieving',
    'Slayer',
    'Farming',
    'Runecraft'
]);

/**
 * The name for a hiscores type, or a placeholder built from the number
 * itself when a server sends a type this table has never heard of. A future
 * skill added to a later revision must render as an odd-looking row, not a
 * crash — this is the one place that decision is made, so every caller gets
 * it for free instead of guessing its own fallback.
 */
export function hiscoresSkillName(type: number): string {
    return HISCORES_SKILLS[type] ?? `Skill ${type}`;
}

export type HiscoresStatus = 'idle' | 'loading' | 'ready' | 'notFound' | 'error';

export interface PlayerSkill {
    type: number;
    rank: number;
    level: number;
    xp: number;
}

/** What the Hiscores panel draws. */
export interface HiscoresView {
    status: HiscoresStatus;
    /** The name in the box: the remembered one at first, then whatever was last looked up. */
    name: string;
    /** The last successful lookup's rows. Kept on screen when a later lookup fails. */
    skills: PlayerSkill[];
    /** Whose rows `skills` are. May differ from `name` while a lookup is in flight or has failed. */
    shown: string | null;
    error: string | null;
    /** The server's full hiscores page, when it has one. */
    site: string | null;
}

/**
 * Names are stored base37: lowercase, spaces as underscores. `granny grunt`
 * does not resolve; `granny_grunt` does.
 *
 * A real name is only ever letters, digits and spaces, so anything else in
 * the box cannot belong to a player and is dropped rather than passed
 * through. That is what makes this safe to drop straight into a URL: the
 * result can never contain a `/`, `?`, `#` or `%` for a later `lookupUrl` to
 * trip over, and no caller needs to remember to encode it.
 */
export function normaliseName(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
}
