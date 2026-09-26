import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAC_BUTTON, MAC_BUTTONS_AT, MAC_BUTTONS_CLEAR, frameOptions, windowFrame } from './windowFrame.ts';
import { TAB_BAR_HEIGHT } from '../shared/layout.ts';

test('macOS draws no title bar, and puts its window buttons where the kit says', () => {
    assert.deepEqual(frameOptions('darwin'), { titleBarStyle: 'hidden', trafficLightPosition: MAC_BUTTONS_AT });
});

test('Windows and Linux keep the system frame, which holds their menu bar', () => {
    assert.deepEqual(frameOptions('win32'), {});
    assert.deepEqual(frameOptions('linux'), {});
});

test("on macOS the top row is the title bar, and starts clear of the window's buttons", () => {
    assert.deepEqual(windowFrame('darwin', false), { ownTitleBar: true, buttonsInset: MAC_BUTTONS_CLEAR });
});

test('in full screen macOS takes its buttons away, so the row starts at the edge again', () => {
    assert.deepEqual(windowFrame('darwin', true), { ownTitleBar: true, buttonsInset: 0 });
});

test('elsewhere the top row is only a row, full screen or not', () => {
    for (const platform of ['win32', 'linux'] as const) {
        for (const fullScreen of [false, true]) {
            assert.deepEqual(windowFrame(platform, fullScreen), { ownTitleBar: false, buttonsInset: 0 });
        }
    }
});

test('the buttons end before the first control begins', () => {
    const zoomRight = MAC_BUTTONS_AT.x + 2 * MAC_BUTTON.pitch + MAC_BUTTON.size;
    assert.ok(zoomRight < MAC_BUTTONS_CLEAR, `zoom ends at ${zoomRight}, the row starts at ${MAC_BUTTONS_CLEAR}`);
});

test("the buttons sit inside the strip, level with its tabs", () => {
    // The strip is the bar less its 2px rule, and its 2px bevelled underside
    // below the tabs; the tabs are centred in what is left.
    const tabsMiddle = (TAB_BAR_HEIGHT - 4) / 2;
    assert.equal(MAC_BUTTONS_AT.y + MAC_BUTTON.size / 2, tabsMiddle);
    assert.ok(MAC_BUTTONS_AT.y >= 0 && MAC_BUTTONS_AT.y + MAC_BUTTON.size <= TAB_BAR_HEIGHT - 4);
});
