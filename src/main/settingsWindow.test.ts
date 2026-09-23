import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_GAP, SettingsWindowSlot, settingsBounds, type SettingsHandle } from './settingsWindow.ts';
import type { Rect } from '../shared/ipc.ts';

interface Fake extends SettingsHandle {
    focused: number;
    close: () => void;
}

/** A slot over a factory that records what it made and where, so a test can close a window by hand. */
function fixture(): { slot: SettingsWindowSlot<Fake>; made: Fake[]; anchors: (Rect | null)[] } {
    const made: Fake[] = [];
    const anchors: (Rect | null)[] = [];
    const slot = new SettingsWindowSlot<Fake>((anchor, onClosed) => {
        anchors.push(anchor);
        const fake: Fake = {
            contentsId: 100 + made.length,
            focused: 0,
            focus: () => {
                fake.focused++;
            },
            close: onClosed
        };
        made.push(fake);
        return fake;
    });
    return { slot, made, anchors };
}

test('opening with no window open makes one, placed by the anchor it was given', () => {
    const { slot, made, anchors } = fixture();
    const anchor = { x: 10, y: 20, width: 765, height: 803 };
    const opened = slot.open(anchor);
    assert.equal(made.length, 1);
    assert.equal(opened, made[0]);
    assert.deepEqual(anchors, [anchor]);
    assert.equal(slot.current(), opened);
});

test('opening again brings the open window forward and makes no second one', () => {
    const { slot, made } = fixture();
    const first = slot.open(null);
    const again = slot.open(null);
    assert.equal(again, first);
    assert.equal(made.length, 1, 'everything in Settings is app-wide, so a second window would be a second copy');
    assert.equal(first.focused, 1);
});

test('closing empties the slot, and the next open makes a fresh window', () => {
    const { slot, made } = fixture();
    slot.open(null);
    made[0]!.close();
    assert.equal(slot.current(), null);
    const next = slot.open(null);
    assert.equal(made.length, 2);
    assert.equal(next, made[1]);
});

test('a close that arrives again after a newer window opened does not empty the slot', () => {
    const { slot, made } = fixture();
    slot.open(null);
    made[0]!.close();
    const newer = slot.open(null);
    made[0]!.close();
    assert.equal(slot.current(), newer, 'only the open window closing may empty the slot');
});

test('isSender recognises the open window and nothing else', () => {
    const { slot, made } = fixture();
    assert.equal(slot.isSender(100), false, 'no window is open yet');
    slot.open(null);
    assert.equal(slot.isSender(100), true);
    assert.equal(slot.isSender(7), false);
    made[0]!.close();
    assert.equal(slot.isSender(100), false, 'a closed window is no longer a sender');
});

const WORK: Rect = { x: 0, y: 25, width: 1920, height: 1055 };
const SIZE = { width: 520, height: 640 };

test('settings opens beside the window that asked when the display has room', () => {
    const anchor = { x: 100, y: 80, width: 765, height: 803 };
    assert.deepEqual(settingsBounds(anchor, SIZE, WORK), { x: 100 + 765 + SETTINGS_GAP, y: 80, width: 520, height: 640 });
});

test('settings opens beside the window on its left when there is no room to its right', () => {
    const anchor = { x: 1200, y: 80, width: 765, height: 803 };
    assert.deepEqual(settingsBounds(anchor, SIZE, WORK), { x: 668, y: 80, width: 520, height: 640 });
});

test('on a laptop-sized display, a centred first game window leaves no room on either side, so settings goes against the edge with more free space', () => {
    const work: Rect = { x: 0, y: 25, width: 1440, height: 875 };
    const anchor = { x: 337, y: 60, width: 765, height: 803 };
    assert.deepEqual(settingsBounds(anchor, SIZE, work), { x: 920, y: 60, width: 520, height: 640 });
});

test('settings is centred when no window asked for it', () => {
    assert.deepEqual(settingsBounds(null, SIZE, WORK), { x: 700, y: 233, width: 520, height: 640 });
});

test('beside a window low on the display, settings is lifted to stay on it', () => {
    const anchor = { x: 100, y: 700, width: 765, height: 300 };
    assert.deepEqual(settingsBounds(anchor, SIZE, WORK), { x: 877, y: 440, width: 520, height: 640 });
});

test('on a display smaller than settings, it shrinks to the work area', () => {
    const small: Rect = { x: 0, y: 0, width: 400, height: 500 };
    assert.deepEqual(settingsBounds(null, SIZE, small), { x: 0, y: 0, width: 400, height: 500 });
});

const RIGHT: Rect = { x: 1920, y: 0, width: 1920, height: 1080 };

test('on a second monitor to the right, both beside and centred stay on it', () => {
    const anchor = { x: 2000, y: 100, width: 765, height: 803 };
    assert.deepEqual(settingsBounds(anchor, SIZE, RIGHT), { x: 2777, y: 100, width: 520, height: 640 });
    assert.deepEqual(settingsBounds(null, SIZE, RIGHT), { x: 2620, y: 220, width: 520, height: 640 });
});

test('beside a window above the work area, settings is lowered to stay on it', () => {
    const anchor = { x: 100, y: -50, width: 765, height: 803 };
    assert.deepEqual(settingsBounds(anchor, SIZE, WORK), { x: 877, y: 25, width: 520, height: 640 });
});

test('settings goes against the right edge when the anchor sits off the left edge with no room on either side', () => {
    const anchor = { x: -1000, y: 80, width: 300, height: 803 };
    assert.deepEqual(settingsBounds(anchor, SIZE, WORK), { x: 1400, y: 80, width: 520, height: 640 });
});
