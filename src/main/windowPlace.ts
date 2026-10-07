import { PANE_MIN_HEIGHT, PANE_MIN_WIDTH, TAB_BAR_HEIGHT } from '../shared/layout.ts';
import type { Rect, Size } from './paneTree.ts';
import { grownFrame } from './windowRoom.ts';

/**
 * Where a new game window opens, and what a closing one leaves behind to say
 * where it was.
 *
 * Pure, for the reason `CLAUDE.md` gives: `serverWindow` cannot be tested, so
 * the decision is made here and the window is only built at the answer. Its
 * size is never remembered — that is the setup's (`setups.openingSetup`) —
 * only its place, per server and window number, since the place is the one
 * thing about a window a player sets once and wants every launch.
 */

/**
 * Room left on the display for the window's own frame, which a content size
 * does not include: a caption and borders on Linux. macOS and Windows draw no
 * caption, since the tab bar stands in for their title bars
 * (`windowFrame.ts`), and the allowance there is only room to spare. Generous
 * rather than measured, since the frame cannot be asked for before the window
 * exists and an opening size a few pixels short costs nothing.
 */
export const FRAME_ALLOWANCE = 40;

/** The window numbers a place is kept for. A window numbered past this opens where it would have anyway, and is not recorded. */
export const PLACE_SLOTS_MAX = 16;

/** Further from the origin than any arrangement of displays reaches: a stored coordinate past it was not written by a window. */
const REACH = 100_000;

/** Where a window was: its normal frame's top-left, and whether it was maximised or full screen. */
export interface Place {
    x: number;
    y: number;
    maximized: boolean;
    fullScreen: boolean;
}

/** What a window opens at: its frame, with the content size `useContentSize` takes, and the two states to put it in as it is shown. */
export interface Opening {
    frame: Rect;
    maximized: boolean;
    fullScreen: boolean;
}

/**
 * A closing window's place. `normal` is `getNormalBounds()`, the frame it
 * goes back to when it is not maximised, full screen or minimised, so a
 * window closed in any of those still records where it lives.
 */
export function placeOf(normal: Rect, maximized: boolean, fullScreen: boolean): Place {
    return { x: Math.round(normal.x), y: Math.round(normal.y), maximized, fullScreen };
}

/** One stored place, whole or not at all. */
export function readPlace(x: unknown): Place | null {
    if (typeof x !== 'object' || x === null) return null;
    const p = x as Record<string, unknown>;
    const coordinate = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && Math.abs(n) <= REACH;
    if (!coordinate(p.x) || !coordinate(p.y)) return null;
    if (typeof p.maximized !== 'boolean' || typeof p.fullScreen !== 'boolean') return null;
    return { x: p.x, y: p.y, maximized: p.maximized, fullScreen: p.fullScreen };
}

/**
 * The stored places, per server id and window number, read one entry at a
 * time: a bad entry, a slot no window can have, or a server that is not a
 * block of slots costs only itself.
 */
export function readPlaces(x: unknown): Map<string, Map<number, Place>> {
    const places = new Map<string, Map<number, Place>>();
    if (typeof x !== 'object' || x === null || Array.isArray(x)) return places;
    for (const [id, slots] of Object.entries(x as Record<string, unknown>)) {
        if (id === '' || typeof slots !== 'object' || slots === null || Array.isArray(slots)) continue;
        const read = new Map<number, Place>();
        for (const [key, value] of Object.entries(slots as Record<string, unknown>)) {
            const slot = /^\d+$/.test(key) ? Number(key) : NaN;
            if (!(slot >= 1 && slot <= PLACE_SLOTS_MAX)) continue;
            const place = readPlace(value);
            if (place) read.set(slot, place);
        }
        if (read.size > 0) places.set(id, read);
    }
    return places;
}

/**
 * The work area a window at (`x`, `y`) and `width` wide can be dragged on,
 * or null: its tab bar, which is what a window is dragged by, lies inside the
 * area from top to bottom and across at least a pane's width of it.
 */
function reachable(x: number, y: number, width: number, workAreas: readonly Rect[]): Rect | null {
    return (
        workAreas.find(area => {
            const within = y >= area.y && y + TAB_BAR_HEIGHT <= area.y + area.height;
            const across = Math.min(x + width, area.x + area.width) - Math.max(x, area.x);
            return within && across >= Math.min(PANE_MIN_WIDTH, width);
        }) ?? null
    );
}

/** The work area holding a point, or null. */
function areaAt(point: { x: number; y: number }, workAreas: readonly Rect[]): Rect | null {
    return workAreas.find(area => point.x >= area.x && point.x < area.x + area.width && point.y >= area.y && point.y < area.y + area.height) ?? null;
}

/**
 * Where a new window opens.
 *
 * `content` is the size its setup wants, tab bar included. The place it goes:
 *
 * 1. `remembered`, when its tab bar can still be reached on some display
 *    (`reachable`). Its maximised and full-screen states come with it.
 * 2. Otherwise `cascade`, 32px from the focused or last window, on the
 *    display it lands on.
 * 3. Otherwise centred on `cursor`, the display under the pointer.
 *
 * The size is then held to that display — no wider than it, no taller than it
 * less `FRAME_ALLOWANCE` — and the window moved back onto it only as far as it
 * runs off the right or bottom (`windowRoom.grownFrame`), so one the player
 * left hanging off the left or top stays there.
 */
export function openingFrame(opts: {
    content: Size;
    remembered: Place | null;
    cascade: { x: number; y: number } | null;
    workAreas: readonly Rect[];
    cursor: Rect;
}): Opening {
    const remembered = opts.remembered;
    const home = remembered ? reachable(remembered.x, remembered.y, opts.content.width, opts.workAreas) : null;
    const area = home ?? (opts.cascade ? areaAt(opts.cascade, opts.workAreas) : null) ?? opts.cursor;
    const width = Math.max(PANE_MIN_WIDTH, Math.min(opts.content.width, area.width));
    const height = Math.max(TAB_BAR_HEIGHT + PANE_MIN_HEIGHT, Math.min(opts.content.height, area.height - FRAME_ALLOWANCE));
    const origin =
        home && remembered
            ? { x: remembered.x, y: remembered.y }
            : (opts.cascade ?? { x: area.x + Math.floor((area.width - width) / 2), y: area.y + Math.floor((area.height - height) / 2) });
    return {
        frame: grownFrame({ ...origin, width, height }, area, { width: 0, height: 0 }),
        maximized: home !== null && remembered !== null && remembered.maximized,
        fullScreen: home !== null && remembered !== null && remembered.fullScreen
    };
}
