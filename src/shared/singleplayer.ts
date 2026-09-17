/** The single-player world, as the shell draws it. */

export type SinglePlayerStatus = 'stopped' | 'preparing' | 'starting' | 'ready' | 'stopping' | 'failed';

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
