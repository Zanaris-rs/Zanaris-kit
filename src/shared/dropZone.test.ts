import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draggedFar, zoneAt } from './dropZone.ts';

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
