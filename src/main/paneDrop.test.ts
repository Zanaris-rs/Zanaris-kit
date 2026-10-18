import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDrop, canInsert, dropPane, dropTargets, insertTargets } from './paneDrop.ts';
import { halvable, insertPane, layoutTree, leaf, movePane, split, swapPanes, type PaneContent, type Rect } from './paneTree.ts';
import { PANE_MIN_WIDTH, SEAM } from '../shared/layout.ts';

const empty = { kind: 'empty' } as const;

test('every other pane offers where the dragged pane would land for each zone, and the dragged pane offers nothing', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'game' }), leaf('b', { kind: 'tool', tool: 'chat' })], [0.5, 0.5]);
    // 1004x604: two 500s and a seam across, and a column 600 high split into two 300s and a seam.
    const targets = dropTargets(tree, { x: 0, y: 0, width: 1004, height: 604 }, 'a');
    assert.deepEqual(Object.keys(targets), ['b']);
    assert.deepEqual(targets.b, {
        centre: { x: 504, y: 0, width: 500, height: 604 },
        left: { x: 0, y: 0, width: 500, height: 604 },
        right: { x: 504, y: 0, width: 500, height: 604 },
        top: { x: 0, y: 0, width: 1004, height: 300 },
        bottom: { x: 0, y: 304, width: 1004, height: 300 }
    });
});

test('an edge too narrow to halve is refused, while the other axis and the centre are still offered', () => {
    // a over a row of b and c. b is 243 wide, one pixel short of two 120s and a seam.
    const tree = split('s1', 'y', [leaf('a', empty), split('s2', 'x', [leaf('b', empty), leaf('c', empty)], [0.5, 0.5])], [0.5, 0.5]);
    const narrow = dropTargets(tree, { x: 0, y: 0, width: 490, height: 604 }, 'a').b!;
    assert.equal(narrow.left, null);
    assert.equal(narrow.right, null);
    assert.notEqual(narrow.top, null, 'b is tall enough to halve');
    assert.notEqual(narrow.centre, null, 'a swap needs no room');
    const wide = dropTargets(tree, { x: 0, y: 0, width: 492, height: 604 }, 'a').b!;
    assert.notEqual(wide.left, null, 'at 244 it fits');
});

test('a sibling that leaves frees the room it held, so a pane too narrow for the menu to split can take a drop', () => {
    const tree = split('s1', 'x', [leaf('a', empty), leaf('b', empty), leaf('c', empty)], [0.4, 0.2, 0.4]);
    const rect = { x: 0, y: 0, width: 1008, height: 600 };
    assert.equal(halvable(layoutTree(tree, rect).panes.get('b')!.width, 120), false, 'b is 200 wide, too narrow for Split Right');
    // Once a has gone, b has a third of the row.
    assert.notEqual(dropTargets(tree, rect, 'a').b!.right, null);
});

test('a drop in the centre swaps, and a drop on an edge moves', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'game' }), leaf('b', empty), leaf('c', empty)], [0.4, 0.3, 0.3]);
    assert.deepEqual(dropPane(tree, 'a', 'c', 'centre', 's-new'), swapPanes(tree, 'a', 'c'));
    assert.deepEqual(dropPane(tree, 'a', 'c', 'bottom', 's-new'), movePane(tree, 'a', 'c', 'bottom', 's-new'));
});

test('nothing can be dropped on itself or on a pane that is not there', () => {
    const tree = split('s1', 'x', [leaf('a', empty), leaf('b', empty)], [0.5, 0.5]);
    const rect = { x: 0, y: 0, width: 1004, height: 604 };
    assert.equal(canDrop(tree, rect, 'a', 'a', 'centre'), false);
    assert.equal(canDrop(tree, rect, 'a', 'gone', 'centre'), false);
    assert.equal(canDrop(tree, rect, 'gone', 'a', 'left'), false);
    assert.deepEqual(dropTargets(tree, rect, 'gone'), {}, 'a drag from a pane this tab does not have offers nothing');
});

test('a lone pane has nowhere to go', () => {
    assert.deepEqual(dropTargets(leaf('a', { kind: 'game' }), { x: 0, y: 0, width: 800, height: 600 }, 'a'), {});
});

const room: PaneContent = { kind: 'tool', tool: 'chat', room: '#LostHQ' };

test('a room can land on any edge, never the centre', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'game' }), leaf('b', { kind: 'tool', tool: 'chat' })], [0.5, 0.5]);
    const rect = { x: 0, y: 0, width: 1004, height: 604 };
    const targets = insertTargets(tree, rect, room);
    assert.deepEqual(Object.keys(targets).sort(), ['a', 'b'], 'no pane is the dragged one, so every pane is a target');
    for (const to of ['a', 'b']) {
        assert.equal(targets[to]!.centre, null, `${to}: a room has nothing to swap with`);
        for (const zone of ['left', 'right', 'top', 'bottom'] as const) {
            const landed: Rect | undefined = layoutTree(insertPane(tree, to, zone, { paneId: 'new', splitId: 's-new' }, room), rect).panes.get('new');
            assert.deepEqual(targets[to]![zone], landed, `${to} ${zone}: the half layoutTree gives`);
        }
    }
    // Across the row's grain the new pane takes half the target's height and all its width.
    assert.deepEqual(targets.a!.top, { x: 0, y: 0, width: 500, height: 300 });
    assert.deepEqual(targets.b!.bottom, { x: 504, y: 304, width: 500, height: 300 });
});

test('a pane too small to halve refuses a room on that axis', () => {
    const rect = { x: 0, y: 0, width: PANE_MIN_WIDTH * 2 - 1, height: 604 };
    const lone = leaf('a', { kind: 'game' });
    const targets = insertTargets(lone, rect, room).a!;
    assert.equal(targets.left, null);
    assert.equal(targets.right, null);
    assert.notEqual(targets.top, null, 'the other axis is tall enough');
    assert.notEqual(targets.bottom, null);
    assert.equal(canInsert(lone, rect, 'a', 'left'), false);
    assert.equal(canInsert(lone, rect, 'a', 'right'), false);
    assert.equal(canInsert(lone, { ...rect, width: PANE_MIN_WIDTH * 2 + SEAM }, 'a', 'left'), true, 'two floors and a seam is enough');
});

test('a room is measured against the target as it is, since no pane leaves first', () => {
    // b is 200 wide: too narrow to halve, and a drag of a would free a share of its row for it (see canDrop). A room has no source pane to free any.
    const tree = split('s1', 'x', [leaf('a', empty), leaf('b', empty), leaf('c', empty)], [0.4, 0.2, 0.4]);
    const rect = { x: 0, y: 0, width: 1008, height: 600 };
    assert.equal(canDrop(tree, rect, 'a', 'b', 'right'), true);
    assert.equal(canInsert(tree, rect, 'b', 'right'), false);
    assert.equal(insertTargets(tree, rect, room).b!.right, null);
});

test('a room cannot land in the centre, or beside a pane that is not there', () => {
    const tree = split('s1', 'x', [leaf('a', empty), leaf('b', empty)], [0.5, 0.5]);
    const rect = { x: 0, y: 0, width: 1004, height: 604 };
    assert.equal(canInsert(tree, rect, 'a', 'centre'), false);
    assert.equal(canInsert(tree, rect, 'gone', 'left'), false);
    assert.deepEqual(insertTargets(leaf('a', empty), { x: 0, y: 0, width: 800, height: 600 }, room).a!.centre, null, 'even a lone pane takes a room on its edges');
});
