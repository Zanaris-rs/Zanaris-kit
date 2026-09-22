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
 * To the right of the window that asked for it, top edges level, when the
 * display has room there, so on a first launch it sits beside the game the
 * player just opened rather than on top of it. Centred on the display when
 * there is no room, or no window asked. Never larger than the display's work
 * area, and never off it — including beside a window whose top edge sits too
 * high or too low for Settings to fit there level, when `y` is clamped to the
 * work area instead.
 */
export function settingsBounds(anchor: Rect | null, size: Size, workArea: Rect): Rect {
    const width = Math.min(size.width, workArea.width);
    const height = Math.min(size.height, workArea.height);
    if (anchor) {
        const x = anchor.x + anchor.width + SETTINGS_GAP;
        if (x >= workArea.x && x + width <= workArea.x + workArea.width) {
            const y = Math.min(Math.max(anchor.y, workArea.y), workArea.y + workArea.height - height);
            return { x, y, width, height };
        }
    }
    return {
        x: workArea.x + Math.round((workArea.width - width) / 2),
        y: workArea.y + Math.round((workArea.height - height) / 2),
        width,
        height
    };
}
