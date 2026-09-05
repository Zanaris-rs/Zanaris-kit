import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, splitWindow, type LayoutInput } from './layout.ts';
import { ADDRESS_HEIGHT, MIN_CONTENT_WIDTH, PANEL_WIDTH, RAIL_WIDTH, STRIP_HEIGHT } from '../shared/layout.ts';

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 };
const base = (over: Partial<LayoutInput> = {}): LayoutInput => ({
    panelOpen: false,
    activeTabKind: 'game',
    window: { x: 100, y: 100, width: 800 + RAIL_WIDTH, height: 700 },
    workArea: WORK_AREA,
    contentWidth: 800,
    canResize: true,
    ...over
});

test('closed: the window is the content width plus the rail', () => {
    const r = computeLayout(base());
    assert.equal(r.mode, 'widen');
    assert.equal(r.window.width, 800 + RAIL_WIDTH);
    assert.equal(r.content.width, 800);
    assert.equal(r.rail.width, RAIL_WIDTH);
    assert.equal(r.panel, null);
});

test('the strip spans the full width and the content starts beneath it', () => {
    const r = computeLayout(base());
    assert.deepEqual(r.strip, { x: 0, y: 0, width: r.window.width, height: STRIP_HEIGHT });
    assert.equal(r.content.y, STRIP_HEIGHT);
    assert.equal(r.content.height, r.window.height - STRIP_HEIGHT);
    assert.equal(r.address, null, 'a game tab has no address row');
});

test('a page tab puts the address row between the strip and the content', () => {
    const r = computeLayout(base({ activeTabKind: 'page' }));
    assert.deepEqual(r.address, { x: 0, y: STRIP_HEIGHT, width: 800, height: ADDRESS_HEIGHT });
    assert.equal(r.content.y, STRIP_HEIGHT + ADDRESS_HEIGHT);
});

test('opening the panel widens the window and leaves the content untouched', () => {
    const closed = computeLayout(base());
    const open = computeLayout(base({ panelOpen: true }));
    assert.equal(open.mode, 'widen');
    assert.deepEqual(open.content, closed.content, 'the game area must not move or resize');
    assert.equal(open.window.width, closed.window.width + PANEL_WIDTH);
    assert.deepEqual(open.panel, { x: 800, y: STRIP_HEIGHT, width: PANEL_WIDTH, height: 700 - STRIP_HEIGHT });
    assert.equal(open.rail.x, 800 + PANEL_WIDTH);
});

test('shifts left instead of growing off the right edge', () => {
    const r = computeLayout(base({ panelOpen: true, window: { x: 1700, y: 0, width: 848, height: 700 } }));
    assert.equal(r.mode, 'shift');
    assert.equal(r.window.x + r.window.width, WORK_AREA.width, 'right edge sits on the work area edge');
    assert.equal(r.content.width, 800, 'content width still preserved');
});

test('stays inside a narrow display when shifting', () => {
    const narrow = { x: 0, y: 0, width: 1200, height: 800 };
    const r = computeLayout(base({ panelOpen: true, workArea: narrow, window: { x: 600, y: 0, width: 848, height: 700 } }));
    assert.equal(r.mode, 'shift');
    assert.ok(r.window.x >= narrow.x, 'never off the left edge');
    assert.equal(r.window.x + r.window.width, narrow.x + narrow.width, 'flush with the right edge');
    assert.equal(r.content.width, 800, 'content width still preserved');
});

test('falls back to push when the window cannot resize', () => {
    const r = computeLayout(base({ panelOpen: true, canResize: false, window: { x: 0, y: 0, width: 1200, height: 900 } }));
    assert.equal(r.mode, 'push');
    assert.equal(r.window.width, 1200, 'window untouched');
    assert.equal(r.content.width, 1200 - PANEL_WIDTH - RAIL_WIDTH);
    assert.equal(r.panel!.x, r.content.width);
});

test('falls back to push when the panel would not fit on the display', () => {
    const small = { x: 0, y: 0, width: 1000, height: 700 };
    const r = computeLayout(base({ panelOpen: true, workArea: small, window: { x: 0, y: 0, width: 848, height: 700 } }));
    assert.equal(r.mode, 'push', '800 + 368 exceeds a 1000px display');
});

test('push never shrinks the content below the canvas width', () => {
    const r = computeLayout(base({ panelOpen: true, canResize: false, window: { x: 0, y: 0, width: 900, height: 700 } }));
    assert.equal(r.content.width, MIN_CONTENT_WIDTH);
    assert.equal(r.rail.width, RAIL_WIDTH, 'the rail keeps its width');
    assert.equal(r.panel!.width, 900 - MIN_CONTENT_WIDTH - RAIL_WIDTH, 'the panel is what gives way');
});

test('rects tile the width exactly in every mode', () => {
    for (const input of [base(), base({ panelOpen: true }), base({ panelOpen: true, canResize: false }), base({ activeTabKind: 'page', panelOpen: true })]) {
        const r = computeLayout(input);
        const panelW = r.panel?.width ?? 0;
        assert.equal(r.content.x, 0);
        if (r.panel) assert.equal(r.panel.x, r.content.width);
        assert.equal(r.rail.x, r.content.width + panelW, 'rail starts where the panel ends');
        assert.equal(r.rail.x + r.rail.width, r.window.width, 'no gap on the right');
    }
});

test('splitWindow with the panel closed gives the rail whatever the content does not take', () => {
    const r = splitWindow(1000, 700, false, 'game');
    assert.equal(r.content.width, 1000 - RAIL_WIDTH);
    assert.equal(r.panel, null);
    assert.equal(r.rail.width, RAIL_WIDTH);
});
