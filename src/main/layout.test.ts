import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, fitAxis, splitWindow, type LayoutInput } from './layout.ts';
import { ADDRESS_HEIGHT, DOCK_HEIGHT_MIN, MIN_CONTENT_HEIGHT, MIN_CONTENT_WIDTH, PANEL_WIDTH, RAIL_WIDTH, STRIP_HEIGHT } from '../shared/layout.ts';

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 };
const base = (over: Partial<LayoutInput> = {}): LayoutInput => ({
    panelOpen: false,
    activeTabKind: 'game',
    window: { x: 100, y: 100, width: 800 + RAIL_WIDTH, height: 700 },
    workArea: WORK_AREA,
    contentWidth: 800,
    contentHeight: 700 - STRIP_HEIGHT,
    dockHeight: 0,
    canResize: true,
    ...over
});

test('closed: the window is the content width plus the rail', () => {
    const r = computeLayout(base());
    assert.equal(r.mode.x, 'widen');
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
    assert.equal(open.mode.x, 'widen');
    assert.deepEqual(open.content, closed.content, 'the game area must not move or resize');
    assert.equal(open.window.width, closed.window.width + PANEL_WIDTH);
    assert.deepEqual(open.panel, { x: 800, y: STRIP_HEIGHT, width: PANEL_WIDTH, height: 700 - STRIP_HEIGHT });
    assert.equal(open.rail.x, 800 + PANEL_WIDTH);
});

test('shifts left instead of growing off the right edge', () => {
    const r = computeLayout(base({ panelOpen: true, window: { x: 1700, y: 0, width: 848, height: 700 } }));
    assert.equal(r.mode.x, 'shift');
    assert.equal(r.window.x + r.window.width, WORK_AREA.width, 'right edge sits on the work area edge');
    assert.equal(r.content.width, 800, 'content width still preserved');
});

test('stays inside a narrow display when shifting', () => {
    const narrow = { x: 0, y: 0, width: 1200, height: 800 };
    const r = computeLayout(base({ panelOpen: true, workArea: narrow, window: { x: 600, y: 0, width: 848, height: 700 } }));
    assert.equal(r.mode.x, 'shift');
    assert.ok(r.window.x >= narrow.x, 'never off the left edge');
    assert.equal(r.window.x + r.window.width, narrow.x + narrow.width, 'flush with the right edge');
    assert.equal(r.content.width, 800, 'content width still preserved');
});

test('falls back to push when the window cannot resize', () => {
    const r = computeLayout(base({ panelOpen: true, canResize: false, window: { x: 0, y: 0, width: 1200, height: 900 } }));
    assert.equal(r.mode.x, 'push');
    assert.equal(r.window.width, 1200, 'window untouched');
    assert.equal(r.content.width, 1200 - PANEL_WIDTH - RAIL_WIDTH);
    assert.equal(r.panel!.x, r.content.width);
});

test('falls back to push when the panel would not fit on the display', () => {
    const small = { x: 0, y: 0, width: 1000, height: 700 };
    const r = computeLayout(base({ panelOpen: true, workArea: small, window: { x: 0, y: 0, width: 848, height: 700 } }));
    assert.equal(r.mode.x, 'push', '800 + 368 exceeds a 1000px display');
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
    const r = splitWindow(1000, 700, false, 0, 'game');
    assert.equal(r.content.width, 1000 - RAIL_WIDTH);
    assert.equal(r.panel, null);
    assert.equal(r.rail.width, RAIL_WIDTH);
});

// ── fitAxis, the 1-D solver, tested on its own terms ────────────────────────
// These inputs are not tied to x or y: fitAxis doesn't know which axis it's on.

test('fitAxis widens when there is room', () => {
    const r = fitAxis({ origin: 100, size: 50, workOrigin: 0, workSize: 1000, content: 40, extra: 20, minContent: 10, canResize: true });
    assert.equal(r.mode, 'widen');
    assert.equal(r.origin, 100, 'origin does not move when there is room to grow in place');
    assert.equal(r.size, 60, 'size is content plus extra');
});

test('fitAxis shifts back rather than growing off the far edge', () => {
    const r = fitAxis({ origin: 950, size: 50, workOrigin: 0, workSize: 1000, content: 40, extra: 20, minContent: 10, canResize: true });
    assert.equal(r.mode, 'shift');
    assert.equal(r.size, 60, 'still grows to content plus extra');
    assert.equal(r.origin + r.size, 1000, 'flush with the far edge of the work area');
});

test('fitAxis pushes when it cannot resize', () => {
    const r = fitAxis({ origin: 100, size: 50, workOrigin: 0, workSize: 1000, content: 40, extra: 20, minContent: 10, canResize: false });
    assert.equal(r.mode, 'push');
    assert.equal(r.origin, 100, 'origin untouched');
    assert.equal(r.size, 50, 'size untouched');
});

// ── the dock, the y-axis twin of the panel tests above ──────────────────────

test('opening the dock grows the window and leaves the content untouched', () => {
    const closed = computeLayout(base());
    const open = computeLayout(base({ dockHeight: 200 }));
    assert.equal(open.mode.y, 'widen');
    assert.deepEqual(open.content, closed.content, 'the game area must not move or resize');
    assert.equal(open.window.height, closed.window.height + 200);
    assert.deepEqual(open.dock, { x: 0, y: closed.content.y + closed.content.height, width: 800, height: 200 });
});

test('the dock spans content plus panel width and stops at the rail, panel open or closed', () => {
    for (const panelOpen of [false, true]) {
        const r = computeLayout(base({ panelOpen, dockHeight: 200 }));
        const panelW = r.panel?.width ?? 0;
        assert.ok(r.dock, 'the dock has room to open');
        assert.equal(r.dock!.x, 0);
        assert.equal(r.dock!.width, r.content.width + panelW);
        assert.equal(r.dock!.x + r.dock!.width, r.rail.x, 'the dock stops where the rail begins');
    }
});

test('the dock does not shrink the rail: it still runs from the strip to the window bottom', () => {
    const r = computeLayout(base({ dockHeight: 200 }));
    assert.equal(r.rail.height, r.window.height - STRIP_HEIGHT);
});

test('push on y when the window cannot resize: content gives way, the dock keeps its full height', () => {
    const r = computeLayout(
        base({
            canResize: false,
            dockHeight: 200,
            contentHeight: 700,
            window: { x: 0, y: 0, width: 800 + RAIL_WIDTH, height: 800 }
        })
    );
    assert.equal(r.mode.y, 'push');
    assert.equal(r.window.height, 800, 'window untouched');
    assert.equal(r.content.height, 800 - STRIP_HEIGHT - 200, 'content gives way to make room for the full dock');
    assert.equal(r.dock!.height, 200, 'the dock keeps its full requested height');
});

test('the dock shrinks toward its own floor while content holds exactly at MIN_CONTENT_HEIGHT', () => {
    const r = computeLayout(
        base({
            canResize: false,
            dockHeight: 200,
            window: { x: 0, y: 0, width: 800 + RAIL_WIDTH, height: 700 }
        })
    );
    assert.equal(r.content.height, MIN_CONTENT_HEIGHT, 'content holds at its floor rather than the dock vanishing');
    assert.equal(r.dock!.height, 700 - STRIP_HEIGHT - MIN_CONTENT_HEIGHT, 'the dock gives up only what content needs to reach its floor');
    assert.ok(r.dock!.height > DOCK_HEIGHT_MIN, 'the dock still has slack above its own floor at this height');
});

test('past the dock floor, content gives way below MIN_CONTENT_HEIGHT rather than the dock vanishing', () => {
    // At this height the old (wrong) priority gave dockH = 0 -- a requested,
    // nonzero dock reduced to nothing. The dock must hold at DOCK_HEIGHT_MIN
    // instead, with content the one that gives way further.
    const r = computeLayout(
        base({
            canResize: false,
            dockHeight: 200,
            window: { x: 0, y: 0, width: 800 + RAIL_WIDTH, height: 539 }
        })
    );
    assert.ok(r.dock, 'a requested dock is never dropped for want of room');
    assert.equal(r.dock!.height, DOCK_HEIGHT_MIN);
    assert.ok(r.content.height < MIN_CONTENT_HEIGHT, 'content is what gives way once the dock is at its floor');
});

test('the two axes fit independently: both widen when the panel and the dock are both open', () => {
    const r = computeLayout(base({ panelOpen: true, dockHeight: 200 }));
    assert.equal(r.mode.x, 'widen');
    assert.equal(r.mode.y, 'widen');
});

test('the two axes fit independently: one can push while the other widens', () => {
    const narrow = { x: 0, y: 0, width: 900, height: 1080 };
    const r = computeLayout(base({ panelOpen: true, dockHeight: 200, workArea: narrow }));
    assert.equal(r.mode.x, 'push', '800 + panel + rail exceeds a 900px-wide display');
    assert.equal(r.mode.y, 'widen', 'the display is tall enough for content plus the dock');
});

test('rects tile the height exactly in every mode', () => {
    for (const input of [
        base(),
        base({ dockHeight: 200 }),
        base({ dockHeight: 200, canResize: false }),
        base({ activeTabKind: 'page', dockHeight: 200 })
    ]) {
        const r = computeLayout(input);
        const addressH = r.address?.height ?? 0;
        const dockH = r.dock?.height ?? 0;
        assert.equal(r.strip.height + addressH + r.content.height + dockH, r.window.height, 'strip, address, content and dock account for the whole window');
    }
});
