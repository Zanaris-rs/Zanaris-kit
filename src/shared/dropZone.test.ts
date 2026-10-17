import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draggedFar, pressEnded, zoneAt } from './dropZone.ts';

// 400x200 at (100, 50), so a quarter is 100 across and 50 down.
const rect = { x: 100, y: 50, width: 400, height: 200 };

test('a pointer near an edge picks that edge', () => {
    assert.equal(zoneAt(rect, 120, 150), 'left');
    assert.equal(zoneAt(rect, 480, 150), 'right');
    assert.equal(zoneAt(rect, 300, 60), 'top');
    assert.equal(zoneAt(rect, 300, 240), 'bottom');
});

test('the middle half each way is the centre', () => {
    assert.equal(zoneAt(rect, 300, 150), 'centre');
    assert.equal(zoneAt(rect, 201, 101), 'centre');
    assert.equal(zoneAt(rect, 399, 199), 'centre');
});

test('an edge band is a quarter of the pane, measured along the axis that edge faces', () => {
    assert.equal(zoneAt(rect, 199, 150), 'left', 'just inside the quarter');
    assert.equal(zoneAt(rect, 200, 150), 'centre', 'exactly a quarter in is the centre');
    assert.equal(zoneAt(rect, 300, 99), 'top');
    assert.equal(zoneAt(rect, 300, 100), 'centre');
});

test('in a corner the nearer edge wins, measured as a share of the pane', () => {
    // 10% from the left and 20% from the top.
    assert.equal(zoneAt(rect, 140, 90), 'left');
    // 20% from the left and 10% from the top.
    assert.equal(zoneAt(rect, 180, 70), 'top');
});

test('a pane with no area is all centre rather than a division by zero', () => {
    assert.equal(zoneAt({ x: 0, y: 0, width: 0, height: 100 }, 0, 50), 'centre');
});

test('a press becomes a drag only once the pointer has moved a few pixels', () => {
    assert.equal(draggedFar({ x: 10, y: 10 }, { x: 12, y: 12 }), false, 'a click that wobbles is still a click');
    assert.equal(draggedFar({ x: 10, y: 10 }, { x: 14, y: 10 }), true);
    assert.equal(draggedFar({ x: 10, y: 10 }, { x: 13, y: 13 }), true, 'measured as a distance, not per axis');
});

test('a press ends on a move with no button down, a drag or not yet one, a header\'s or a tab\'s', () => {
    const now = { layout: 'a', rows: ['#a'], buttons: 0 };
    assert.equal(pressEnded({ room: null, dragging: false, layout: '' }, now), true, 'a header pressed, its release lost');
    assert.equal(pressEnded({ room: '#a', dragging: false, layout: '' }, now), true, 'a tab pressed, its release lost');
    assert.equal(pressEnded({ room: '#a', dragging: true, layout: 'a' }, now), true);
    assert.equal(pressEnded({ room: null, dragging: true, layout: 'a' }, { ...now, buttons: 1 }), false, 'a button held is a press still going');
    assert.equal(pressEnded({ room: null, dragging: false, layout: '' }, { ...now, buttons: null }), false, 'no event read, nothing said about buttons');
});

test('a room\'s press ends once no row lists its tab, whether or not it was dragging yet', () => {
    const gone = { layout: 'a', rows: ['*', '#b'], buttons: null };
    assert.equal(pressEnded({ room: '#a', dragging: false, layout: '' }, gone), true);
    assert.equal(pressEnded({ room: '#a', dragging: true, layout: 'a' }, gone), true);
    assert.equal(pressEnded({ room: '#b', dragging: false, layout: '' }, gone), false);
    assert.equal(pressEnded({ room: null, dragging: false, layout: '' }, { ...gone, rows: [] }), false, 'a header has no tab to lose');
});

test('a drag ends when the layout it was aimed at changes, and a press not yet dragging does not', () => {
    const moved = { layout: 'b', rows: ['#a'], buttons: null };
    assert.equal(pressEnded({ room: null, dragging: true, layout: 'a' }, moved), true);
    assert.equal(pressEnded({ room: '#a', dragging: true, layout: 'a' }, moved), true);
    assert.equal(pressEnded({ room: null, dragging: false, layout: '' }, moved), false, 'its layout is taken when it starts dragging');
    assert.equal(pressEnded({ room: null, dragging: true, layout: 'b' }, moved), false);
});
