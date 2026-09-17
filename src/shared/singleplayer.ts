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
    /** What the player chose for the world; see SinglePlayerSettings. */
    settings: SinglePlayerSettings;
    /** The saves folder, newest first, as last read. A character being played shows its last save. */
    characters: CharacterInfo[];
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

/** A save problem, or a file the kit could not read at all. */
export type FileProblem = SaveProblem | 'unreadable';

/** What the Characters section says about a file it cannot use, as a sentence. */
export const PROBLEM_TEXT: Readonly<Record<FileProblem, string>> = {
    'not-a-save': "That file isn't a character save.",
    'too-new': 'That save comes from a newer game than this kit runs.',
    corrupt: 'That save is damaged or cut short.',
    unreadable: "That file couldn't be read."
};

/** The same, short enough for a row of the list. */
export const PROBLEM_LABEL: Readonly<Record<FileProblem, string>> = {
    'not-a-save': 'Not a save',
    'too-new': 'From a newer game',
    corrupt: 'Damaged',
    unreadable: "Can't be read"
};

/** One file in the saves folder. */
export interface CharacterInfo {
    /** The file's name less `.sav`, which is the name to log in with. Always a safe name. */
    name: string;
    /** The name as the game writes it. */
    displayName: string;
    /** When the file was last written, in ms since the epoch. */
    modified: number;
    /** Null when `problem` says why the file cannot be read as a save. */
    summary: SaveSummary | null;
    problem: FileProblem | null;
}

/** The first half of an import: the picked file, read, and a token to name it by. */
export type ImportPick = { ok: true; token: string; suggestedName: string; summary: SaveSummary } | { ok: false; problem: FileProblem };

/** How a change to a character ended. */
export type CharacterOutcome = { kind: 'done'; name: string } | { kind: 'cancelled' } | { kind: 'refused'; message: string };

/** Play time as the list shows it. The engine counts it in ticks of 600 ms. */
export function formatPlaytime(ticks: number): string {
    const minutes = Math.floor((ticks * 600) / 60_000);
    if (minutes < 1) return 'under a minute';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
