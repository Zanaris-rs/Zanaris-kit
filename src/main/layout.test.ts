import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, RAIL_WIDTH, PANEL_WIDTH, MIN_GAME_WIDTH, type LayoutInput } from './layout.ts';

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 };
const base = (over: Partial<LayoutInput> = {}): LayoutInput => ({
    open: false,
    window: { x: 100, y: 100, width: 800 + RAIL_WIDTH, height: 700 },
    workArea: WORK_AREA,
    gameWidth: 800,
    canResize: true,
    ...over
});

test('closed: window is game width plus the rail', () => {
    const r = computeLayout(base());
    assert.equal(r.mode, 'widen');
    assert.equal(r.window.width, 800 + RAIL_WIDTH);
    assert.equal(r.game.width, 800);
    assert.equal(r.shell.width, RAIL_WIDTH);
});

test('opening widens the window and leaves the game area untouched', () => {
    const closed = computeLayout(base());
    const open = computeLayout(base({ open: true }));
    assert.equal(open.mode, 'widen');
    assert.equal(open.game.width, closed.game.width, 'game width must not change');
    assert.equal(open.window.width, closed.window.width + PANEL_WIDTH);
    assert.equal(open.shell.width, RAIL_WIDTH + PANEL_WIDTH);
    assert.equal(open.shell.x, 800);
});

test('shifts left instead of growing off the right edge', () => {
    const r = computeLayout(base({ open: true, window: { x: 1700, y: 0, width: 848, height: 700 } }));
    assert.equal(r.mode, 'widen');
    assert.equal(r.window.x + r.window.width, WORK_AREA.width, 'right edge should sit on the work area edge');
    assert.equal(r.game.width, 800, 'game width still preserved');
});

test('clamps to the left edge when the display is narrow', () => {
    const narrow = { x: 0, y: 0, width: 1000, height: 800 };
    const r = computeLayout(base({ open: true, workArea: narrow, window: { x: 600, y: 0, width: 848, height: 700 } }));
    assert.ok(r.window.x >= narrow.x, 'never positioned off the left edge');
});

test('falls back to push when maximised', () => {
    const r = computeLayout(base({ open: true, canResize: false, window: { x: 0, y: 0, width: 1200, height: 900 } }));
    assert.equal(r.mode, 'push');
    assert.equal(r.window.width, 1200, 'window untouched when it cannot resize');
    assert.equal(r.game.width, 1200 - (RAIL_WIDTH + PANEL_WIDTH));
    assert.equal(r.shell.x, r.game.width);
});

test('falls back to push when the sidebar would not fit on the display', () => {
    const tiny = { x: 0, y: 0, width: 900, height: 700 };
    const r = computeLayout(base({ open: true, workArea: tiny, gameWidth: 800, window: { x: 0, y: 0, width: 848, height: 700 } }));
    assert.equal(r.mode, 'push', '800 + 328 exceeds a 900px display');
});

test('push never shrinks the game below the minimum', () => {
    const r = computeLayout(base({ open: true, canResize: false, window: { x: 0, y: 0, width: 600, height: 700 } }));
    assert.equal(r.mode, 'push');
    assert.equal(r.game.width, MIN_GAME_WIDTH);
    assert.equal(r.shell.width, 600 - MIN_GAME_WIDTH);
});

test('views tile the content area exactly, in every mode', () => {
    for (const input of [base(), base({ open: true }), base({ open: true, canResize: false })]) {
        const r = computeLayout(input);
        assert.equal(r.game.x, 0);
        assert.equal(r.shell.x, r.game.width, 'shell starts where the game ends');
        assert.equal(r.game.width + r.shell.width, r.window.width, 'no gap, no overlap');
        assert.equal(r.game.height, r.window.height);
        assert.equal(r.shell.height, r.window.height);
    }
});
