import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAC_BUTTON, MAC_BUTTONS_AT, MAC_BUTTONS_CLEAR, frameOptions, overlayFor, windowFrame } from './windowFrame.ts';
import { TAB_BAR_HEIGHT } from '../shared/layout.ts';
import { themeById, type ThemeLook } from '../shared/themes.ts';

const LOOK: ThemeLook = { colors: themeById('stone').colors, background: null };
const OTHER: ThemeLook = { colors: { ...LOOK.colors, cream: '#e0ebe3' }, background: null };

test('macOS draws no title bar, and puts its window buttons where the kit says', () => {
    assert.deepEqual(frameOptions('darwin', LOOK), { titleBarStyle: 'hidden', trafficLightPosition: MAC_BUTTONS_AT });
});

test('Windows draws no title bar, and puts its own buttons over the row', () => {
    assert.deepEqual(frameOptions('win32', LOOK), {
        titleBarStyle: 'hidden',
        titleBarOverlay: { color: '#00000000', symbolColor: LOOK.colors.cream, height: TAB_BAR_HEIGHT - 2 }
    });
});

test('Linux keeps the system frame, which holds its menu bar', () => {
    assert.deepEqual(frameOptions('linux', LOOK), {});
});

test("Windows' buttons have no ground of their own, so the stone and a picture show behind them", () => {
    assert.match(overlayFor('win32', LOOK)!.color, /^#[0-9a-f]{6}00$/i);
});

test("Windows' buttons wear the theme's text colour, and follow it", () => {
    assert.equal(overlayFor('win32', LOOK)!.symbolColor, LOOK.colors.cream);
    assert.equal(overlayFor('win32', OTHER)!.symbolColor, '#e0ebe3');
});

test("Windows' buttons stand in the strip and its underside, so the rule runs on beneath them", () => {
    assert.equal(overlayFor('win32', LOOK)!.height + 2, TAB_BAR_HEIGHT);
});

test('only Windows has an overlay to restyle', () => {
    assert.equal(overlayFor('darwin', LOOK), null);
    assert.equal(overlayFor('linux', LOOK), null);
});

test("on macOS the top row is the title bar, and starts clear of the window's buttons", () => {
    assert.deepEqual(windowFrame('darwin', false), { ownTitleBar: true, buttonsInset: MAC_BUTTONS_CLEAR, menuButton: false });
});

test('in full screen macOS takes its buttons away, so the row starts at the edge again', () => {
    assert.deepEqual(windowFrame('darwin', true), { ownTitleBar: true, buttonsInset: 0, menuButton: false });
});

test('on Windows the top row is the title bar, and carries the menu the title bar held, full screen or not', () => {
    for (const fullScreen of [false, true]) {
        assert.deepEqual(windowFrame('win32', fullScreen), { ownTitleBar: true, buttonsInset: 0, menuButton: true });
    }
});

test('on Linux the top row is only a row, full screen or not', () => {
    for (const fullScreen of [false, true]) {
        assert.deepEqual(windowFrame('linux', fullScreen), { ownTitleBar: false, buttonsInset: 0, menuButton: false });
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
