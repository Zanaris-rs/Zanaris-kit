/**
 * What a pane says when what it shows has stopped: the game or a page whose
 * renderer crashed or hung, or a tool that failed to draw. One shape for all
 * of them, drawn by one component (`renderer/paneNotice.tsx`), so every pane
 * that can go wrong says so the same way and offers the same ways back.
 *
 * The words are here rather than in the renderer because main decides the
 * game's and a page's — it is the one that sees their renderers go — and the
 * shell decides a tool's, and neither should have a copy of the other's.
 */

/** What went wrong with a native view. `reason` is Electron's `render-process-gone` reason. */
export type PaneTrouble = { kind: 'crashed'; reason: string } | { kind: 'unresponsive' };

/**
 * The ways back a notice can offer. `reload`, `wait` and `close` go to main,
 * which owns the views; `retry` is the shell's own, drawing a tool again.
 */
export type PaneNoticeAction = 'reload' | 'wait' | 'close' | 'retry';

export interface PaneNotice {
    title: string;
    detail: string;
    /** The buttons, in order. The first is the one to press. */
    actions: { id: PaneNoticeAction; label: string }[];
}

/** Why a renderer went, in words: Electron's reasons are for logs. */
function goneBecause(reason: string): string {
    switch (reason) {
        case 'oom':
            return 'It ran out of memory and closed.';
        case 'memory-eviction':
            return 'The system closed it to free memory.';
        case 'killed':
            return 'Something outside the kit closed it.';
        case 'launch-failed':
            return "It couldn't start.";
        default:
            return 'It closed unexpectedly.';
    }
}

/**
 * A game or a page that crashed or stopped responding. The game's detail
 * says a reload is a fresh login, because it is: whatever was on screen is
 * gone either way, and the player should not press it expecting otherwise.
 */
export function troubleNotice(subject: 'game' | 'page', trouble: PaneTrouble): PaneNotice {
    const game = subject === 'game';
    const reload = { id: 'reload' as const, label: game ? 'Reload game' : 'Reload page' };
    const login = game ? ' Reloading it is a fresh login.' : '';
    if (trouble.kind === 'unresponsive') {
        return {
            title: game ? "The game isn't responding" : "This page isn't responding",
            detail: `It may come back on its own.${login}`,
            actions: [{ id: 'wait', label: 'Wait' }, reload]
        };
    }
    return {
        title: game ? 'The game stopped' : 'This page stopped',
        detail: `${goneBecause(trouble.reason)}${login}`,
        actions: [reload, { id: 'close', label: 'Close pane' }]
    };
}

/** A tool the shell failed to draw. Its state is main's, so drawing it again loses nothing but what was typed into it. */
export function toolNotice(name: string): PaneNotice {
    return {
        title: `${name} stopped working`,
        detail: 'Something went wrong while drawing it. Opening it again draws it fresh.',
        actions: [
            { id: 'retry', label: 'Open again' },
            { id: 'close', label: 'Close pane' }
        ]
    };
}

/**
 * The whole page failed to draw: a game window's shell, or Settings. The
 * game is a view of its own and keeps running under a shell that is redrawn.
 */
export function windowNotice(page: 'shell' | 'settings'): PaneNotice {
    return {
        title: 'Something went wrong in this window',
        detail: page === 'shell' ? 'Reloading draws it again. The game keeps running.' : 'Reloading draws it again.',
        actions: [{ id: 'reload', label: 'Reload' }]
    };
}

/** An action as it arrives over IPC, or null. Only the three main answers: `retry` never leaves the shell. */
export function readNoticeAction(x: unknown): 'reload' | 'wait' | 'close' | null {
    return x === 'reload' || x === 'wait' || x === 'close' ? x : null;
}
