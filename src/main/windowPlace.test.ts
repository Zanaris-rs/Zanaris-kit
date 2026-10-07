import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLACE_SLOTS_MAX, openingFrame, placeOf, readPlace, readPlaces, type Place } from './windowPlace.ts';
import { PANE_MIN_HEIGHT, PANE_MIN_WIDTH, TAB_BAR_HEIGHT } from '../shared/layout.ts';

/** A laptop below a 25px menu bar, a big display to its right, and one to its left at negative coordinates. */
const laptop = { x: 0, y: 25, width: 1440, height: 875 };
const right = { x: 1440, y: 0, width: 2560, height: 1440 };
const left = { x: -1920, y: 0, width: 1920, height: 1080 };
/** The game alone, under the tab bar. */
const content = { width: 765, height: 607 };
const place = (x: number, y: number, flags: Partial<Place> = {}): Place => ({ x, y, maximized: false, fullScreen: false, ...flags });

test('a remembered place on a display still there is where the window opens', () => {
    const opening = openingFrame({ content, remembered: place(2240, 120), cascade: null, workAreas: [laptop, right], cursor: laptop });
    assert.deepEqual(opening, { frame: { x: 2240, y: 120, width: 765, height: 607 }, maximized: false, fullScreen: false });
});

test('a display to the left, at negative coordinates, keeps its windows', () => {
    const opening = openingFrame({ content, remembered: place(-1800, 100), cascade: null, workAreas: [laptop, left], cursor: laptop });
    assert.deepEqual(opening.frame, { x: -1800, y: 100, width: 765, height: 607 });
});

test('a place on a display no longer there falls back to the cascade', () => {
    const opening = openingFrame({ content, remembered: place(2240, 120), cascade: { x: 132, y: 157 }, workAreas: [laptop], cursor: laptop });
    assert.deepEqual(opening.frame, { x: 132, y: 157, width: 765, height: 607 });
});

test('with neither a place nor a window to cascade from, the window is centred on the display under the cursor', () => {
    const opening = openingFrame({ content, remembered: null, cascade: null, workAreas: [laptop, right], cursor: right });
    assert.deepEqual(opening.frame, { x: 1440 + Math.floor((2560 - 765) / 2), y: Math.floor((1440 - 607) / 2), width: 765, height: 607 });
});

test('a tab bar above the top of its display cannot be reached, so the place is not used', () => {
    const opening = openingFrame({ content, remembered: place(100, 10), cascade: null, workAreas: [laptop], cursor: laptop });
    assert.deepEqual(opening.frame, { x: Math.floor((1440 - 765) / 2), y: 25 + Math.floor((875 - 607) / 2), width: 765, height: 607 });
});

test('a window hanging off the left edge is kept, and left there, while a pane width of its tab bar shows', () => {
    const kept = openingFrame({ content, remembered: place(PANE_MIN_WIDTH - 765, 100), cascade: null, workAreas: [laptop], cursor: laptop });
    assert.equal(kept.frame.x, PANE_MIN_WIDTH - 765, 'the player put it there');
    const lost = openingFrame({ content, remembered: place(PANE_MIN_WIDTH - 766, 100), cascade: null, workAreas: [laptop], cursor: laptop });
    assert.equal(lost.frame.x, Math.floor((1440 - 765) / 2), 'one pixel less and it is out of reach');
});

test('a display that shrank since keeps its window, moved back in from its right and bottom edges', () => {
    const smaller = { x: 1440, y: 0, width: 1920, height: 1080 };
    const opening = openingFrame({ content, remembered: place(3000, 900), cascade: null, workAreas: [laptop, smaller], cursor: laptop });
    assert.deepEqual(opening.frame, { x: 1440 + 1920 - 765, y: 1080 - 607, width: 765, height: 607 });
});

test('a cascade stays on the display it lands on', () => {
    const opening = openingFrame({ content, remembered: null, cascade: { x: 1400, y: 500 }, workAreas: [laptop], cursor: laptop });
    assert.deepEqual(opening.frame, { x: 1440 - 765, y: 25 + 875 - 607, width: 765, height: 607 });
});

test('a setup bigger than its display is held to it, the height leaving room for a frame', () => {
    const opening = openingFrame({ content: { width: 2000, height: 1000 }, remembered: null, cascade: null, workAreas: [laptop], cursor: laptop });
    assert.deepEqual(opening.frame, { x: 0, y: 45, width: 1440, height: 835 });
});

test('never smaller than one pane under the tab bar', () => {
    const tiny = { x: 0, y: 0, width: 100, height: 100 };
    const opening = openingFrame({ content, remembered: null, cascade: null, workAreas: [tiny], cursor: tiny });
    assert.equal(opening.frame.width, PANE_MIN_WIDTH);
    assert.equal(opening.frame.height, TAB_BAR_HEIGHT + PANE_MIN_HEIGHT);
});

test('maximised and full screen come back with their place, and not without it', () => {
    const both = place(2240, 120, { maximized: true, fullScreen: true });
    const kept = openingFrame({ content, remembered: both, cascade: null, workAreas: [laptop, right], cursor: laptop });
    assert.deepEqual([kept.maximized, kept.fullScreen], [true, true]);
    const gone = openingFrame({ content, remembered: both, cascade: null, workAreas: [laptop], cursor: laptop });
    assert.deepEqual([gone.maximized, gone.fullScreen], [false, false]);
});

test('a place is the normal frame’s corner in whole pixels, and its two states', () => {
    assert.deepEqual(placeOf({ x: 10.6, y: -3.2, width: 9, height: 9 }, true, false), { x: 11, y: -3, maximized: true, fullScreen: false });
});

test('a stored place is read whole or not at all', () => {
    assert.deepEqual(readPlace(place(-1800, 100)), place(-1800, 100));
    assert.equal(readPlace({ x: 1.5, y: 0, maximized: false, fullScreen: false }), null, 'not a pixel');
    assert.equal(readPlace({ x: 100_001, y: 0, maximized: false, fullScreen: false }), null, 'past any display');
    assert.equal(readPlace({ x: 0, y: 0, maximized: 'yes', fullScreen: false }), null);
    assert.equal(readPlace({ x: 0, y: 0, maximized: false }), null);
    assert.equal(readPlace('0,0'), null);
    assert.equal(readPlace(null), null);
});

test('stored places are read one entry at a time, and only for slots a window can have', () => {
    const read = readPlaces({
        lostcity: { '1': place(10, 20), '2': place(30, 40), [String(PLACE_SLOTS_MAX)]: place(1, 1), [String(PLACE_SLOTS_MAX + 1)]: place(1, 1), '0': place(1, 1), x: place(1, 1), '3': { x: 'no' } },
        '': { '1': place(1, 1) },
        zanaris: 'nope'
    });
    assert.deepEqual([...read.keys()], ['lostcity']);
    assert.deepEqual([...read.get('lostcity')!.entries()], [
        [1, place(10, 20)],
        [2, place(30, 40)],
        [PLACE_SLOTS_MAX, place(1, 1)]
    ]);
    assert.equal(readPlaces(undefined).size, 0);
    assert.equal(readPlaces([place(1, 1)]).size, 0, 'an array is not a block of servers');
});
