import type { Rect } from '../shared/ipc.ts';

/**
 * The Settings window's rules, kept here rather than beside the window for
 * the reason every rule in this kit is: `node --test` reaches this file
 * without Electron. `settingsView.ts` builds the window and holds no rules of
 * its own, as `paneHost.ts` does for panes.
 */

/** What the slot needs from a window: enough to bring it forward, and to know whether an IPC call came from it. */
export interface SettingsHandle {
    focus(): void;
    readonly contentsId: number;
}

/** Creates the window. Must call `onClosed` once, asynchronously, after the window is gone. */
export type SettingsFactory<H extends SettingsHandle> = (anchor: Rect | null, onClosed: () => void) => H;

/**
 * The one Settings window the app has, or none.
 *
 * Opening it when it is already open brings it forward instead of making a
 * second: everything in it is app-wide, so two would be two copies of one
 * thing, each able to disagree with the other about what was just saved.
 */
export class SettingsWindowSlot<H extends SettingsHandle> {
    private handle: H | null = null;
    private readonly factory: SettingsFactory<H>;

    constructor(factory: SettingsFactory<H>) {
        this.factory = factory;
    }

    /** The open window brought forward, or a new one placed by `anchor`. */
    open(anchor: Rect | null): H {
        if (this.handle) {
            this.handle.focus();
            return this.handle;
        }
        // Compared before clearing, so a close that arrives more than once, or
        // late, cannot empty the slot of a window opened since.
        const handle: H = this.factory(anchor, () => {
            if (this.handle === handle) this.handle = null;
        });
        this.handle = handle;
        return handle;
    }

    current(): H | null {
        return this.handle;
    }

    /** Whether an IPC call came from the open Settings window. */
    isSender(contentsId: number): boolean {
        return this.handle !== null && this.handle.contentsId === contentsId;
    }
}

export interface Size {
    width: number;
    height: number;
}

/** The gap left between a game window and Settings when they sit side by side. */
export const SETTINGS_GAP = 12;

/**
 * Where the Settings window opens.
 *
 * Beside the window that asked for it, top edges level: to its right when the
 * display has room there, else to its left when the display has room there.
 * A game window sitting near the middle of a laptop-sized display leaves no
 * room on either side — the first window of a launch is centred, since
 * `nextPosition()` has nothing to cascade from — so the last resort is
 * against the work area's edge: the side
 * with more free space, so Settings covers as little of the game window as it
 * can, rather than centring over its middle. Centred on the display only when
 * no window asked. Never larger than the display's work area, and never off
 * it — including beside or against a window whose top edge sits too high or
 * too low for Settings to fit there level, when `y` is clamped to the work
 * area instead.
 */
export function settingsBounds(anchor: Rect | null, size: Size, workArea: Rect): Rect {
    const width = Math.min(size.width, workArea.width);
    const height = Math.min(size.height, workArea.height);
    const left = workArea.x;
    const right = workArea.x + workArea.width;
    if (anchor) {
        const y = Math.min(Math.max(anchor.y, workArea.y), workArea.y + workArea.height - height);
        const besideRight = anchor.x + anchor.width + SETTINGS_GAP;
        if (besideRight >= left && besideRight + width <= right) return { x: besideRight, y, width, height };
        const besideLeft = anchor.x - SETTINGS_GAP - width;
        if (besideLeft >= left && besideLeft + width <= right) return { x: besideLeft, y, width, height };
        // No room on either side: against the edge with more free space, so it
        // covers as little of the window as it can.
        const roomRight = right - (anchor.x + anchor.width);
        const roomLeft = anchor.x - left;
        return { x: roomRight >= roomLeft ? right - width : left, y, width, height };
    }
    return {
        x: left + Math.round((workArea.width - width) / 2),
        y: workArea.y + Math.round((workArea.height - height) / 2),
        width,
        height
    };
}
