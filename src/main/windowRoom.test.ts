import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grownFrame, roomFor, shrunkFrame } from './windowRoom.ts';
import type { Edge } from './paneTree.ts';

/** A laptop display's work area, below a 25px menu bar. */
const workArea = { x: 0, y: 25, width: 1440, height: 875 };

test('a window may grow until it is as big as its display, wherever on it it sits', () => {
    assert.deepEqual(roomFor({ x: 100, y: 50, width: 765, height: 839 }, workArea), { width: 675, height: 36 });
    assert.deepEqual(roomFor({ x: 600, y: 50, width: 765, height: 839 }, workArea), { width: 675, height: 36 }, 'moving it is part of the room');
});

test('a window already as big as its display, or bigger, has no room', () => {
    assert.deepEqual(roomFor({ x: 0, y: 25, width: 1440, height: 875 }, workArea), { width: 0, height: 0 });
    assert.deepEqual(roomFor({ x: -40, y: 25, width: 1600, height: 900 }, workArea), { width: 0, height: 0 });
});

test('a window with space to its right and below grows there, and stays where it is', () => {
    const frame = { x: 100, y: 50, width: 765, height: 600 };
    assert.deepEqual(grownFrame(frame, workArea, { width: 324, height: 100 }), { x: 100, y: 50, width: 1089, height: 700 });
});

test('a window that would run off its display moves back onto it', () => {
    const frame = { x: 600, y: 300, width: 765, height: 500 };
    const grown = grownFrame(frame, workArea, { width: 324, height: 200 });
    assert.deepEqual(grown, { x: 351, y: 200, width: 1089, height: 700 });
    assert.equal(grown.x + grown.width, workArea.x + workArea.width, 'flush with the right edge');
    assert.equal(grown.y + grown.height, workArea.y + workArea.height, 'and with the bottom');
});

test('a window already hanging off the left or top is not pulled any further off', () => {
    const frame = { x: -50, y: 0, width: 765, height: 500 };
    assert.deepEqual(grownFrame(frame, workArea, { width: 100, height: 100 }), { x: -50, y: 0, width: 865, height: 600 });
});

test('a pane closed right of the game, or below it, takes the right or bottom edge in', () => {
    const frame = { x: 100, y: 50, width: 1089, height: 839 };
    assert.deepEqual(shrunkFrame(frame, { width: 324, height: 0 }, 'right'), { x: 100, y: 50, width: 765, height: 839 });
    assert.deepEqual(shrunkFrame(frame, { width: 0, height: 236 }, 'bottom'), { x: 100, y: 50, width: 1089, height: 603 });
});

test('a pane closed left of the game, or above it, moves the left or top edge in, so the game stays put', () => {
    const frame = { x: 100, y: 50, width: 1089, height: 839 };
    assert.deepEqual(shrunkFrame(frame, { width: 324, height: 0 }, 'left'), { x: 424, y: 50, width: 765, height: 839 });
    assert.deepEqual(shrunkFrame(frame, { width: 0, height: 236 }, 'top'), { x: 100, y: 286, width: 1089, height: 603 });
});

test('a window grown by a negative amount shrinks from its right and bottom, where it is', () => {
    const frame = { x: 100, y: 50, width: 1089, height: 839 };
    assert.deepEqual(grownFrame(frame, workArea, { width: -324, height: -36 }), { x: 100, y: 50, width: 765, height: 803 });
});
