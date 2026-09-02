/** Channel names and payload types, shared by main and preload so they can't drift. */

export const IPC = {
    sidebarToggle: 'swiftkit:sidebar-toggle',
    sidebarSetOpen: 'swiftkit:sidebar-set-open',
    sidebarState: 'swiftkit:sidebar-state',
    sessionState: 'swiftkit:session-state',
    xpState: 'swiftkit:xp-state'
} as const;

export type SidebarMode = 'widen' | 'push';

export interface SidebarState {
    open: boolean;
    /** What actually happened — 'push' means the window could not be widened. */
    mode: SidebarMode;
}

export interface SessionState {
    serverUrl: string;
    socketOpen: boolean;
    txFrames: number;
    rxFrames: number;
    txBytes: number;
    rxBytes: number;
    revision: number | null;
    seedRecovered: boolean | null;
}

export interface SkillRow {
    id: number;
    name: string;
    xp: number;
    level: number;
    gained: number;
    /** False until the server has sent this skill at least once. */
    seen: boolean;
}

export interface XpState {
    rows: SkillRow[];
    totalGained: number;
    keyed: boolean;
    /** Set when decoding stopped — the reason is shown rather than guessed numbers. */
    degraded: string | null;
}

export interface SwiftkitApi {
    sidebar: {
        toggle(): Promise<SidebarState>;
        setOpen(open: boolean): Promise<SidebarState>;
        onState(cb: (s: SidebarState) => void): () => void;
    };
    session: {
        onState(cb: (s: SessionState) => void): () => void;
    };
    xp: {
        onState(cb: (s: XpState) => void): () => void;
    };
}
