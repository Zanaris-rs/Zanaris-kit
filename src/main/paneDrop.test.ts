import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDrop, dropPane, dropTargets } from './paneDrop.ts';
import { halvable, layoutTree, leaf, movePane, split, swapPanes } from './paneTree.ts';

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
