/** The single-player world, as the shell draws it. */

export type SinglePlayerStatus = 'stopped' | 'preparing' | 'starting' | 'ready' | 'stopping' | 'failed';

/**
 * True while a world may be running or on its way up or down: every status
 * but stopped and failed. A change that costs a restart, or that a logout
 * could write over, asks first while this holds.
 */
export function worldRunning(status: SinglePlayerStatus): boolean {
    return status !== 'stopped' && status !== 'failed';
}

/** The XP multipliers the World section offers. The engine multiplies the xp content gives by `node.xpRate` (Player.addXp). */
export const XP_RATES = [1, 2, 5, 10] as const;
export type XpRate = (typeof XP_RATES)[number];

export function isXpRate(value: unknown): value is XpRate {
    return XP_RATES.some(rate => rate === value);
}

/** What the player chooses about their world. Each one is written into world.json, so a change takes a restart. */
export interface SinglePlayerSettings {
    /** node.localStaffLevel: 4 on, 0 off. */
    cheats: boolean;
    /** node.xpRate. */
    xpRate: XpRate;
    /** node.members. Off makes the world a free one. */
    members: boolean;
}

export const DEFAULT_SINGLE_PLAYER_SETTINGS: Readonly<SinglePlayerSettings> = Object.freeze({ cheats: false, xpRate: 1, members: true });

/** What the bundled engine is, from resources/engine/VERSION.json. */
export interface SinglePlayerVersion {
    engine: string;
    content: string;
    revision: number;
    built: string;
}

export interface SinglePlayerView {
    status: SinglePlayerStatus;
    /** The web port while starting or ready. */
    port: number | null;
    /** The game URL while ready. */
    url: string | null;
    /** Why it failed, while failed. */
    reason: string | null;
    /** The last lines the world printed. */
    logTail: string[];
    version: SinglePlayerVersion | null;
    cheats: boolean;
}

/** What the kit reads from the head of a save. */
export interface SaveSummary {
    /** The save format, 0 for a new character's empty file. */
    version: number;
    combatLevel: number;
    /** The skills tab's Total Lvl. */
    totalLevel: number;
    /** Game ticks logged in, 600 ms each. */
    playtimeTicks: number;
}

/** Which of the engine's checks a file fails: not a save at all, a newer format, or a checksum that does not match. */
export type SaveProblem = 'not-a-save' | 'too-new' | 'corrupt';
