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
