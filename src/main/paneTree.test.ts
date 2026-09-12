import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closePane, contentOf, evenOut, layoutTree, leaf, paneIds, seamPixels, setContent, setSeam, setFraction, split, splitPane } from './paneTree.ts';

test('a lone leaf fills the rect it is given', () => {
    const { panes, seams } = layoutTree(leaf('p1', { kind: 'empty' }), { x: 0, y: 0, width: 800, height: 600 });
    assert.deepEqual(panes.get('p1'), { x: 0, y: 0, width: 800, height: 600 });
    assert.deepEqual(seams, [], 'one pane has no seams');
});

test('an x split of two halves divides the rect, with a seam between them', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' })], [0.5, 0.5]);
    // 804 = 800 of pane plus the one 4px seam, so each half is a round 400.
    const { panes, seams } = layoutTree(tree, { x: 0, y: 0, width: 804, height: 600 });
    assert.deepEqual(panes.get('a'), { x: 0, y: 0, width: 400, height: 600 });
    assert.deepEqual(panes.get('b'), { x: 404, y: 0, width: 400, height: 600 });
    assert.deepEqual(seams, [{ axis: 'x', rect: { x: 400, y: 0, width: 4, height: 600 }, splitId: 's1', index: 0 }]);
});

test('children tile their container exactly, whatever the fractions round to', () => {
    const third = 1 / 3;
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' }), leaf('c', { kind: 'empty' })], [third, third, third]);
    for (const width of [1000, 1001, 1002, 803, 640]) {
        const { panes, seams } = layoutTree(tree, { x: 0, y: 0, width, height: 100 });
        const last = panes.get('c')!;
        assert.equal(last.x + last.width, width, `the last pane ends at the container's edge at width ${width}`);
        const covered = ['a', 'b', 'c'].reduce((sum, id) => sum + panes.get(id)!.width, 0) + seams.length * 4;
        assert.equal(covered, width, `panes and seams cover the container with no gap or overlap at width ${width}`);
    }
});

test('a pane squeezed by its fraction is held at the minimum, and its sibling gives way', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' })], [0.98, 0.02]);
    // gross 1000: b's fraction asks for 20, which is below the 120 floor.
    const { panes } = layoutTree(tree, { x: 0, y: 0, width: 1004, height: 400 });
    assert.equal(panes.get('b')!.width, 120, 'held at the floor');
    assert.equal(panes.get('a')!.width, 880, 'the sibling pays for it');
});

test("a split's minimum is what all its children and seams need, not one pane's", () => {
    const inner = split('s2', 'x', [leaf('b1', { kind: 'empty' }), leaf('b2', { kind: 'empty' }), leaf('b3', { kind: 'empty' })], [1 / 3, 1 / 3, 1 / 3]);
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), inner], [0.9, 0.1]);
    // gross 1000: the inner split's fraction asks for 100, but three panes and
    // two seams cannot be drawn in less than 3 * 120 + 2 * 4 = 368.
    const { panes } = layoutTree(tree, { x: 0, y: 0, width: 1004, height: 400 });
    const inners = ['b1', 'b2', 'b3'].reduce((sum, id) => sum + panes.get(id)!.width, 0);
    assert.equal(inners + 2 * 4, 368, 'the subtree is held at what it actually needs');
    // 1000 of gross less the subtree's 368 — the outer seam is already out of gross.
    assert.equal(panes.get('a')!.width, 632, 'the sibling pays for the whole subtree');
    assert.equal(panes.get('b3')!.x + panes.get('b3')!.width, 1004, 'and the row still tiles the container');
});

test('splitting a lone leaf nests a split of two equal halves, the new one empty', () => {
    const next = splitPane(leaf('a', { kind: 'game' }), 'a', 'x', { paneId: 'b', splitId: 's1' });
    assert.deepEqual(next, split('s1', 'x', [leaf('a', { kind: 'game' }), leaf('b', { kind: 'empty' })], [0.5, 0.5]));
});

test("splitting along the parent's own axis appends a sibling and halves only that pane's share", () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' })], [0.6, 0.4]);
    const next = splitPane(tree, 'a', 'x', { paneId: 'c', splitId: 's2' });
    assert.equal(next.kind, 'split');
    assert.equal(next.kind === 'split' && next.splitId, 's1', 'no new split node — the tree stays flat');
    assert.deepEqual(next.kind === 'split' && next.children.map(c => c.kind === 'leaf' && c.paneId), ['a', 'c', 'b']);
    assert.deepEqual(next.kind === 'split' && next.fractions, [0.3, 0.3, 0.4], "b's share is untouched");
});

test('closing a pane gives its share to its siblings in proportion', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' }), leaf('c', { kind: 'empty' })], [0.5, 0.25, 0.25]);
    const next = closePane(tree, 'b');
    assert.equal(next.kind, 'split');
    assert.deepEqual(next.kind === 'split' && next.children.map(c => c.kind === 'leaf' && c.paneId), ['a', 'c']);
    assert.deepEqual(next.kind === 'split' && next.fractions, [0.5 / 0.75, 0.25 / 0.75]);
});

test('a split left holding one child is replaced by that child', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'game' }), leaf('b', { kind: 'empty' })], [0.5, 0.5]);
    assert.deepEqual(closePane(tree, 'b'), leaf('a', { kind: 'game' }), 'no single-child split is left behind');
});

test('a nested split collapses too, so close-then-split behaves like a fresh split', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), split('s2', 'y', [leaf('b', { kind: 'empty' }), leaf('c', { kind: 'page', bookmark: 'u' })], [0.5, 0.5])], [0.5, 0.5]);
    const next = closePane(tree, 'b');
    assert.deepEqual(next, split('s1', 'x', [leaf('a', { kind: 'empty' }), leaf('c', { kind: 'page', bookmark: 'u' })], [0.5, 0.5]));
});

test('closing the only pane leaves an empty one rather than nothing', () => {
    assert.deepEqual(closePane(leaf('a', { kind: 'game' }), 'a'), leaf('a', { kind: 'empty' }), 'the tab survives its last pane');
});

test('dragging a seam moves only the two panes either side of it', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' }), leaf('c', { kind: 'empty' })], [0.4, 0.3, 0.3]);
    // Seam 1 sits after child 1, so it moves b and c. a must not feel it.
    // 2000 of gross keeps 0.1 well clear of the 120px floor, so this tests the
    // drag rather than the clamp the test below covers.
    const next = setFraction(tree, 's1', 1, 0.1, 2000);
    assert.deepEqual(next.kind === 'split' && next.fractions, [0.4, 0.1, 0.5]);
});

test('a seam dragged past a pane\'s minimum stops at it', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' })], [0.5, 0.5]);
    // 120 of 1000 is the floor, so 0.01 is refused down to 0.12.
    const next = setFraction(tree, 's1', 0, 0.01, 1000);
    assert.deepEqual(next.kind === 'split' && next.fractions, [0.12, 0.88]);
});

test('a container too small for every minimum clips everything proportionally', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' }), leaf('c', { kind: 'empty' })], [0.8, 0.1, 0.1]);
    // gross 192 against a floor of 3 * 120: nobody can have their minimum, so
    // everyone is cut by the same proportion rather than one pane going to nothing.
    const { panes } = layoutTree(tree, { x: 0, y: 0, width: 200, height: 300 });
    assert.deepEqual(['a', 'b', 'c'].map(id => panes.get(id)!.width), [64, 64, 64]);
    assert.equal(panes.get('c')!.x + panes.get('c')!.width, 200, 'and it still tiles');
});

test('the launcher fills a pane by replacing its content, touching nothing else', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'game' }), leaf('b', { kind: 'empty' })], [0.5, 0.5]);
    const next = setContent(tree, 'b', { kind: 'tool', tool: 'worlds' });
    assert.deepEqual(next, split('s1', 'x', [leaf('a', { kind: 'game' }), leaf('b', { kind: 'tool', tool: 'worlds' })], [0.5, 0.5]));
});

test('the tree lists its panes in reading order', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), split('s2', 'y', [leaf('b', { kind: 'empty' }), leaf('c', { kind: 'empty' })], [0.5, 0.5])], [0.5, 0.5]);
    assert.deepEqual(paneIds(tree), ['a', 'b', 'c']);
});

test('a pane reports what it holds, and an unknown pane reports nothing', () => {
    // Nested, so the lookup has to actually recurse rather than glance at the
    // children it was handed.
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), split('s2', 'y', [leaf('b', { kind: 'page', bookmark: 'u' }), leaf('c', { kind: 'game' })], [0.5, 0.5])], [0.5, 0.5]);
    assert.deepEqual(contentOf(tree, 'b'), { kind: 'page', bookmark: 'u' });
    assert.deepEqual(contentOf(tree, 'c'), { kind: 'game' });
    assert.equal(contentOf(tree, 'nope'), null);
});

test('evening out a split gives every child the same share, leaving other splits alone', () => {
    const inner = split('s2', 'y', [leaf('b', { kind: 'empty' }), leaf('c', { kind: 'empty' })], [0.9, 0.1]);
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), inner], [0.8, 0.2]);
    const next = evenOut(tree, 's1');
    assert.deepEqual(next.kind === 'split' && next.fractions, [0.5, 0.5]);
    assert.deepEqual(next.kind === 'split' && next.children[1]!.kind === 'split' && next.children[1]!.fractions, [0.9, 0.1], 'the nested split is untouched');
});

test('a seam reports where it is and how far it may travel, in pixels', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' })], [0.4, 0.6]);
    // 1000 of gross: a is at 400, and the pair may run from a's own 120 floor
    // up to 1000 less b's 120.
    assert.deepEqual(seamPixels(tree, 's1', 0, 1000), { size: 400, min: 120, max: 880 });
});

test('a seam in a split that is not there reports nothing', () => {
    assert.equal(seamPixels(leaf('a', { kind: 'empty' }), 'nope', 0, 1000), null);
});

test('a seam moved in pixels lands there, and is clamped the same way a fraction is', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' })], [0.5, 0.5]);
    assert.equal(seamPixels(setSeam(tree, 's1', 0, 300, 1000), 's1', 0, 1000)!.size, 300);
    assert.equal(seamPixels(setSeam(tree, 's1', 0, 10, 1000), 's1', 0, 1000)!.size, 120, 'clamped at the floor, not obeyed');
});
