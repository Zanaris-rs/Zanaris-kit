import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, dockOnFloor, fitAxis, paneWidth, preservedHeight, preservedWidth, sideWidth, splitWindow, type LayoutInput } from './layout.ts';
import {
    DOCK_HEIGHT_MIN,
    MIN_CONTENT_HEIGHT,
    MIN_CONTENT_WIDTH,
    MIN_WINDOW_CONTENT_HEIGHT,
    MIN_WINDOW_CONTENT_WIDTH,
    PAGE_SEAM,
    PAGE_TOOLBAR_HEIGHT,
    PAGE_WIDTH_DEFAULT,
    PAGE_WIDTH_MIN,
    PANEL_WIDTH,
    PANEL_WIDTH_MIN,
    RAIL_WIDTH,
    STRIP_HEIGHT
} from '../shared/layout.ts';

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 };
const base = (over: Partial<LayoutInput> = {}): LayoutInput => ({
    panelOpen: false,
    pageWidth: 0,
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
    assert.equal(r.page, null, 'a window with no reference page open has no pane');
    assert.equal(r.seam, null);
    assert.equal(r.pageToolbar, null);
});

// ── the reference pane, beside the game rather than in front of it ──────────

test('opening the pane widens the window and leaves the game untouched', () => {
    const closed = computeLayout(base());
    const open = computeLayout(base({ pageWidth: PAGE_WIDTH_DEFAULT }));
    assert.equal(open.mode.x, 'widen');
    assert.deepEqual(open.content, closed.content, 'the game area must not move or resize');
    assert.equal(open.window.width, closed.window.width + PAGE_WIDTH_DEFAULT + PAGE_SEAM);
    assert.equal(open.window.height, closed.window.height, 'the pane costs nothing on the y axis');
});

test('the pane column is seam, toolbar and page, and the toolbar comes out of the pane', () => {
    const r = computeLayout(base({ pageWidth: PAGE_WIDTH_DEFAULT }));
    assert.deepEqual(r.seam, { x: 800, y: STRIP_HEIGHT, width: PAGE_SEAM, height: r.content.height });
    assert.deepEqual(r.pageToolbar, { x: 800 + PAGE_SEAM, y: STRIP_HEIGHT, width: PAGE_WIDTH_DEFAULT, height: PAGE_TOOLBAR_HEIGHT });
    assert.deepEqual(r.page, {
        x: 800 + PAGE_SEAM,
        y: STRIP_HEIGHT + PAGE_TOOLBAR_HEIGHT,
        width: PAGE_WIDTH_DEFAULT,
        height: r.content.height - PAGE_TOOLBAR_HEIGHT
    });
});

test('the pane sits between the game and the panel, with the rail still last', () => {
    // From x = 0: game, seam, pane, panel and rail come to 1857, and from the
    // default origin of 100 that would run off a 1920px work area and shift.
    const r = computeLayout(base({ panelOpen: true, pageWidth: PAGE_WIDTH_DEFAULT, window: { x: 0, y: 100, width: 800 + RAIL_WIDTH, height: 700 } }));
    assert.equal(r.mode.x, 'widen');
    assert.equal(r.content.width, 800);
    assert.equal(r.page!.x, 800 + PAGE_SEAM);
    assert.equal(r.panel!.x, 800 + PAGE_SEAM + PAGE_WIDTH_DEFAULT);
    assert.equal(r.rail.x, 800 + PAGE_SEAM + PAGE_WIDTH_DEFAULT + PANEL_WIDTH);
});

test('squeezed: the panel is spent to its floor first, then the pane, then the game', () => {
    // A 1440px display, maximised, panel open, pane asking for its default:
    // 765 + 4 + 720 + 320 + 48 is 1857, so something has to give.
    const workArea = { x: 0, y: 0, width: 1440, height: 900 };
    const r = computeLayout(
        base({ panelOpen: true, pageWidth: PAGE_WIDTH_DEFAULT, canResize: false, workArea, window: { x: 0, y: 0, width: 1440, height: 900 } })
    );
    assert.equal(r.mode.x, 'push');
    assert.equal(r.panel?.width, PANEL_WIDTH_MIN, 'the panel gives way first, down to its floor');
    assert.equal(r.page!.width, PAGE_WIDTH_MIN, 'then the pane, which lands on its own floor here');
    assert.equal(r.content.width, 1440 - RAIL_WIDTH - PANEL_WIDTH_MIN - PAGE_SEAM - PAGE_WIDTH_MIN, 'and only then the game, which is what is left');
    assert.ok(r.content.width < MIN_CONTENT_WIDTH, 'under its canvas — there is no arrangement of 1440px that is not');
});

test('squeezed further: the pane holds at its floor and the game is what gives way', () => {
    const r = computeLayout(
        base({ pageWidth: PAGE_WIDTH_DEFAULT, canResize: false, window: { x: 0, y: 0, width: 1000, height: 700 } })
    );
    assert.equal(r.page!.width, PAGE_WIDTH_MIN, 'the pane stops at the width a page is still readable at');
    assert.equal(r.content.width, 1000 - RAIL_WIDTH - PAGE_SEAM - PAGE_WIDTH_MIN);
    assert.ok(r.content.width < MIN_CONTENT_WIDTH, 'past the pane floor the game is the one that gives');
});

test('a collapsed pane costs nothing: with pageWidth 0 the game is exactly what the old formula gave it', () => {
    // The arithmetic that was here before the pane, written out rather than
    // referenced, so this is an oracle and not a restatement of the code. It
    // holds wherever the window has room for the canvas and its chrome both,
    // and deliberately not below that: there the rail takes its width before
    // the game does, and the panel holds at PANEL_WIDTH_MIN rather than being
    // spent to the last pixel. Those windows are reachable — the floor is
    // MIN_WINDOW_CONTENT_WIDTH — and have tests of their own below.
    const old = (width: number, panelOpen: boolean): number => Math.max(MIN_CONTENT_WIDTH, width - sideWidth(panelOpen));
    for (const panelOpen of [false, true]) {
        for (let width = MIN_CONTENT_WIDTH + sideWidth(panelOpen); width <= 2400; width += 7) {
            const r = splitWindow(width, 700, panelOpen, 0, 0, MIN_CONTENT_WIDTH);
            assert.equal(r.content.width, old(width, panelOpen), `width ${width}, panel ${panelOpen}`);
            assert.equal(r.page, null);
            assert.equal(r.seam, null);
            assert.equal(r.content.width + (r.panel?.width ?? 0) + r.rail.width, width, 'and the columns still tile it exactly');
        }
    }
});

test('the columns tile the window exactly at every width, with a pane or without', () => {
    for (const pageWidth of [0, PAGE_WIDTH_MIN, PAGE_WIDTH_DEFAULT]) {
        for (const panelOpen of [false, true]) {
            for (let width = 0; width <= 2400; width += 13) {
                const r = splitWindow(width, 700, panelOpen, 0, pageWidth, MIN_CONTENT_WIDTH);
                const parts = [r.content.width, r.seam?.width ?? 0, r.page?.width ?? 0, r.panel?.width ?? 0, r.rail.width];
                assert.ok(
                    parts.every(n => n >= 0),
                    `width ${width}, pane ${pageWidth}, panel ${panelOpen}: ${parts.join('/')} has a negative column`
                );
                assert.equal(
                    parts.reduce((a, b) => a + b, 0),
                    width,
                    `width ${width}, pane ${pageWidth}, panel ${panelOpen}: ${parts.join('/')} does not sum to the window`
                );
                assert.equal(r.rail.x + r.rail.width, width, 'and nothing is left over on the right');
            }
        }
    }
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

test('rects tile the width exactly in every mode', () => {
    for (const input of [
        base(),
        base({ panelOpen: true }),
        base({ panelOpen: true, canResize: false }),
        base({ pageWidth: PAGE_WIDTH_DEFAULT }),
        base({ pageWidth: PAGE_WIDTH_DEFAULT, panelOpen: true }),
        base({ pageWidth: PAGE_WIDTH_DEFAULT, panelOpen: true, canResize: false, window: { x: 0, y: 0, width: 1440, height: 900 } }),
        base({ pageWidth: PAGE_WIDTH_DEFAULT, canResize: false, window: { x: 0, y: 0, width: 1000, height: 700 } })
    ]) {
        const r = computeLayout(input);
        const seamW = r.seam?.width ?? 0;
        const pageW = r.page?.width ?? 0;
        const panelW = r.panel?.width ?? 0;
        assert.equal(r.content.x, 0);
        if (r.seam) assert.equal(r.seam.x, r.content.width);
        if (r.page) assert.equal(r.page.x, r.content.width + seamW);
        if (r.pageToolbar) assert.deepEqual([r.pageToolbar.x, r.pageToolbar.width], [r.page!.x, r.page!.width], 'the toolbar sits squarely over its page');
        if (r.panel) assert.equal(r.panel.x, r.content.width + seamW + pageW);
        assert.equal(r.rail.x, r.content.width + seamW + pageW + panelW, 'rail starts where the panel ends');
        assert.equal(r.rail.x + r.rail.width, r.window.width, 'no gap on the right');
    }
});

test('splitWindow with the panel closed gives the rail whatever the content does not take', () => {
    const r = splitWindow(1000, 700, false, 0, 0, MIN_CONTENT_WIDTH);
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

test('the dock spans everything but the rail, whatever else is open', () => {
    for (const panelOpen of [false, true]) {
        for (const pageWidth of [0, PAGE_WIDTH_DEFAULT]) {
            const r = computeLayout(base({ panelOpen, pageWidth, dockHeight: 200 }));
            assert.ok(r.dock, 'the dock has room to open');
            assert.equal(r.dock!.x, 0);
            assert.equal(r.dock!.x + r.dock!.width, r.rail.x, 'the dock stops where the rail begins');
        }
    }
});

test('the pane is shortened so the dock never overlaps it', () => {
    const r = computeLayout(base({ pageWidth: PAGE_WIDTH_DEFAULT, dockHeight: 200 }));
    assert.ok(r.page && r.dock, 'both the pane and the dock have room to open');
    assert.equal(r.page!.y + r.page!.height, r.dock!.y, 'the pane ends exactly where the dock begins');
});

test('the dock does not shrink the rail: it still runs from the strip to the window bottom, panel open or closed', () => {
    for (const panelOpen of [false, true]) {
        const r = computeLayout(base({ panelOpen, dockHeight: 200 }));
        assert.equal(r.rail.height, r.window.height - STRIP_HEIGHT, 'the rail is beside the dock, not above it');
    }
});

test('the panel is shortened so the dock never overlaps it', () => {
    const r = computeLayout(base({ panelOpen: true, dockHeight: 200 }));
    assert.ok(r.panel && r.dock, 'both the panel and the dock have room to open');
    assert.ok(r.panel!.y + r.panel!.height <= r.dock!.y, 'the panel ends at or above where the dock begins');
});

test('the panel column tiles exactly: strip, panel and dock account for the whole window', () => {
    const r = computeLayout(base({ panelOpen: true, dockHeight: 200 }));
    assert.equal(r.strip.height + r.panel!.height + r.dock!.height, r.window.height);
});

test('the panel height is unchanged when the dock is closed', () => {
    const r = computeLayout(base({ panelOpen: true }));
    assert.equal(r.panel!.height, r.window.height - STRIP_HEIGHT, 'nothing is subtracted from the panel when there is no dock to make room for');
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
        base({ pageWidth: PAGE_WIDTH_DEFAULT, dockHeight: 200 })
    ]) {
        const r = computeLayout(input);
        const dockH = r.dock?.height ?? 0;
        assert.equal(r.strip.height + r.content.height + dockH, r.window.height, 'strip, content and dock account for the whole window');
        if (r.page) {
            assert.equal(r.pageToolbar!.height + r.page.height, r.content.height, 'the pane column is exactly as tall as the game beside it');
            assert.equal(r.seam!.height, r.content.height);
        }
    }
});

// ── the height floor the window is given, in dock pixels ────────────────────
// What serverWindow.ts hands setMinimumSize. Tested here rather than there
// because it is arithmetic over the layout's own numbers, and serverWindow.ts
// has no Electron-free surface to test through.

test('the floor carries the dock the layout granted, not the height that was asked for', () => {
    // A 1366x768 laptop with a taskbar: about 728px of window, so the default
    // 200px dock does not fit and the fit lands in push with 137 granted.
    const workArea = { x: 0, y: 0, width: 1366, height: 728 };
    const r = computeLayout(base({ dockHeight: 200, workArea, contentHeight: 640, window: { x: 0, y: 0, width: 800 + RAIL_WIDTH, height: 640 + STRIP_HEIGHT } }));
    assert.equal(r.mode.y, 'push', '640 + 36 + 200 does not fit in 728');
    assert.equal(r.dock!.height, 137, 'the dock is granted only what the window has spare');
    assert.equal(dockOnFloor(r.dock!.height, r.window.height), 137, 'a granted dock the window has room for is carried whole');
    assert.ok(
        STRIP_HEIGHT + MIN_WINDOW_CONTENT_HEIGHT + dockOnFloor(r.dock!.height, r.window.height) <= r.window.height,
        'and the floor it builds stands inside the window the layout produced'
    );
});

test('the floor gives up the dock as the content itself drops to the window floor', () => {
    // A window dragged all the way down with chat open: the dock holds at
    // DOCK_HEIGHT_MIN and the content is already at MIN_WINDOW_CONTENT_HEIGHT,
    // so there is nothing left for the floor to protect.
    const r = computeLayout(
        base({ canResize: false, dockHeight: 200, window: { x: 0, y: 0, width: 800 + RAIL_WIDTH, height: STRIP_HEIGHT + MIN_WINDOW_CONTENT_HEIGHT } })
    );
    assert.equal(r.dock!.height, DOCK_HEIGHT_MIN, 'the dock is still drawn at its own floor');
    assert.equal(dockOnFloor(r.dock!.height, r.window.height), 0, 'but the height floor claims none of it');
    assert.equal(dockOnFloor(DOCK_HEIGHT_MIN, STRIP_HEIGHT + MIN_WINDOW_CONTENT_HEIGHT - 39), 0, 'and never goes negative on a window shorter still');
});

// ── the floor the window may be dragged to ──────────────────────────────────
// Distinct from MIN_CONTENT_*, which is the canvas the layout protects *within*
// a window. These cover the numbers serverWindow.ts hands the BrowserWindow and
// re-derives on every resize; they live here for the same reason the dock-floor
// tests above do — arithmetic over the layout's own numbers, and serverWindow.ts
// has no Electron-free surface to test through.

test('the game window floor is well below the canvas, so the window can be dragged smaller than it', () => {
    assert.ok(MIN_WINDOW_CONTENT_WIDTH < MIN_CONTENT_WIDTH, 'the window may be dragged narrower than the canvas');
    assert.ok(MIN_WINDOW_CONTENT_HEIGHT < MIN_CONTENT_HEIGHT, 'and shorter than it');
    // The rail never gives way, and the strip is drawn at a fixed height, so a
    // floor that did not clear both would hand one of them a window it cannot
    // be laid out in.
    assert.ok(MIN_WINDOW_CONTENT_WIDTH > RAIL_WIDTH, 'and still leaves the game more than the rail beside it');
    assert.ok(MIN_WINDOW_CONTENT_HEIGHT > STRIP_HEIGHT, 'and more than the strip above it');
});

test('at the floor the columns and rows still tile the window exactly', () => {
    const r = splitWindow(MIN_WINDOW_CONTENT_WIDTH + RAIL_WIDTH, STRIP_HEIGHT + MIN_WINDOW_CONTENT_HEIGHT, false, 0, 0, MIN_WINDOW_CONTENT_WIDTH);
    assert.equal(r.content.width, MIN_WINDOW_CONTENT_WIDTH, 'the game gets everything beside the rail');
    assert.equal(r.content.height, MIN_WINDOW_CONTENT_HEIGHT, 'and everything below the strip');
    assert.equal(r.rail.width, RAIL_WIDTH, 'the rail is never the column that gives way');
    assert.equal(r.content.width + r.rail.width, MIN_WINDOW_CONTENT_WIDTH + RAIL_WIDTH);
    assert.equal(r.strip.height + r.content.height, STRIP_HEIGHT + MIN_WINDOW_CONTENT_HEIGHT);
});

test('the preserved content drops to the window floor rather than the canvas', () => {
    // What the resize handler records as the extent to carry across chrome
    // toggles. Floored at the canvas it would describe a window bigger than the
    // one the user just dragged, and the next layout would grow it back.
    const window = { width: MIN_WINDOW_CONTENT_WIDTH + RAIL_WIDTH, height: STRIP_HEIGHT + MIN_WINDOW_CONTENT_HEIGHT };
    assert.equal(preservedWidth(window.width, sideWidth(false)), MIN_WINDOW_CONTENT_WIDTH);
    assert.equal(preservedHeight(window.height, STRIP_HEIGHT), MIN_WINDOW_CONTENT_HEIGHT);
});

test('the preserved content still comes off the window above the floor, chrome and all', () => {
    assert.equal(preservedWidth(1000 + RAIL_WIDTH + PANEL_WIDTH, sideWidth(true)), 1000, 'the panel and rail are not the game');
    assert.equal(preservedHeight(700 + STRIP_HEIGHT + 200, STRIP_HEIGHT + 200), 700, 'nor are the strip and the dock');
});

test('a window dragged to the floor stays there instead of springing back', () => {
    const dragged = { x: 100, y: 100, width: MIN_WINDOW_CONTENT_WIDTH + RAIL_WIDTH, height: STRIP_HEIGHT + MIN_WINDOW_CONTENT_HEIGHT };
    const r = computeLayout(
        base({
            window: dragged,
            contentWidth: preservedWidth(dragged.width, sideWidth(false) + paneWidth(0)),
            contentHeight: preservedHeight(dragged.height, STRIP_HEIGHT)
        })
    );
    assert.deepEqual(r.window, dragged, 'the layout asks for exactly the window the user dragged');
    assert.equal(r.mode.x, 'widen', 'and does not report having had to take the width out of the game');
    assert.equal(r.mode.y, 'widen');
});

test('the height floor carries the dock down to the window floor, not the canvas', () => {
    // Chat open in the smallest window there is: the floor has to stand a dock
    // taller than it, or the drag that follows crushes the composer.
    const windowHeight = STRIP_HEIGHT + MIN_WINDOW_CONTENT_HEIGHT + DOCK_HEIGHT_MIN;
    assert.equal(dockOnFloor(DOCK_HEIGHT_MIN, windowHeight), DOCK_HEIGHT_MIN, 'the whole dock is carried');
    assert.equal(STRIP_HEIGHT + MIN_WINDOW_CONTENT_HEIGHT + dockOnFloor(DOCK_HEIGHT_MIN, windowHeight), windowHeight, 'and the floor lands exactly on that window');
});

test('the floor never stands taller than the window it was computed from, at any height', () => {
    // The invariant tying dockOnFloor to the base serverWindow.ts adds it to:
    // disagree about that base and the floor can come out above the window's
    // own height, which is a window the user can no longer shrink at all.
    for (let height = STRIP_HEIGHT + MIN_WINDOW_CONTENT_HEIGHT; height <= 1200; height += 13) {
        for (const dock of [0, DOCK_HEIGHT_MIN, 200, 400]) {
            const floor = STRIP_HEIGHT + MIN_WINDOW_CONTENT_HEIGHT + dockOnFloor(dock, height);
            assert.ok(floor <= height, `dock ${dock} at height ${height} put the floor at ${floor}`);
        }
    }
});

// ── the sidebar in a window narrower than the canvas ────────────────────────
// The claw used to read "the game is under its canvas" as "the panel has taken
// the game's pixels", which is only true while the window is at least as wide
// as the canvas. Below that the game is under its canvas because the user put
// it there, and billing the panel for it hid the sidebar outright.

test('opening the sidebar in a window narrower than the canvas draws it, and the game keeps its width', () => {
    const dragged = MIN_WINDOW_CONTENT_WIDTH + 144 + RAIL_WIDTH; // a window dragged well under the canvas
    const contentWidth = preservedWidth(dragged, sideWidth(false) + paneWidth(0));
    const r = computeLayout(base({ panelOpen: true, window: { x: 100, y: 100, width: dragged, height: 700 }, contentWidth }));

    assert.equal(r.mode.x, 'widen', 'there is room on the display, so the window grows for the sidebar');
    assert.equal(r.window.width, contentWidth + PANEL_WIDTH + RAIL_WIDTH, 'by exactly the sidebar it was asked for');
    assert.equal(r.panel?.width, PANEL_WIDTH, 'and the sidebar it grew for is the one that gets drawn');
    assert.equal(r.content.width, contentWidth, 'the game keeps the width it had — the pixels were never its to claw');
});

test('the game never claws back more than the width it had before the sidebar opened', () => {
    // Maximised, so the window cannot grow: the pixels have to come from
    // somewhere. The game takes only what gets it back to where it was.
    const contentWidth = 400;
    const r = computeLayout(base({ panelOpen: true, canResize: false, contentWidth, window: { x: 0, y: 0, width: 700, height: 700 } }));
    assert.equal(r.content.width, contentWidth, 'the game is made whole and stops there');
    assert.equal(r.panel?.width, 700 - RAIL_WIDTH - contentWidth, 'the sidebar keeps every pixel the game did not need');
    assert.equal(r.content.width + r.panel!.width + r.rail.width, 700);
});

test('with no room to widen, the sidebar narrows to its floor rather than vanishing', () => {
    // The game is entitled to its whole canvas here and still cannot have it:
    // past the sidebar's floor the game is what gives way, the way the dock
    // already outranks content height on the other axis.
    const r = computeLayout(base({ panelOpen: true, canResize: false, window: { x: 0, y: 0, width: 900, height: 700 } }));
    assert.equal(r.panel?.width, PANEL_WIDTH_MIN, 'the sidebar stops at the width it is still a sidebar at');
    assert.equal(r.content.width, 900 - RAIL_WIDTH - PANEL_WIDTH_MIN, 'and the game takes what is left');
    assert.ok(r.content.width < MIN_CONTENT_WIDTH, 'which is under its canvas, and the push note says so');
    assert.equal(r.rail.width, RAIL_WIDTH, 'the rail is still the one column that never gives way');
});

test('the sidebar is never left a sliver: it is either at its floor or wider', () => {
    for (let width = MIN_WINDOW_CONTENT_WIDTH + RAIL_WIDTH; width <= 1400; width += 11) {
        for (const pageWidth of [0, PAGE_WIDTH_DEFAULT]) {
            const r = splitWindow(width, 700, true, 0, pageWidth, 800);
            const panel = r.panel?.width ?? 0;
            assert.ok(panel >= Math.min(PANEL_WIDTH_MIN, width - RAIL_WIDTH), `width ${width}, pane ${pageWidth} left the panel ${panel}`);
        }
    }
});
