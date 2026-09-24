import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendColumn, canAppendColumn, clearGame, closePane, contentOf, evenOut, halvable, keepGame, layoutTree, leaf, movePane, paneIds, parentSplitOf, refit, resetGame, seamPixels, setContent, setSeam, swapPanes, setFraction, split, splitPane, type PaneNode, type Size } from './paneTree.ts';

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

test('a split left running the same way as its parent is merged into it, keeping every pane\'s share', () => {
    // Game over a row of chat and a column of two. Closing chat collapses the
    // row into that column, which would otherwise sit as a column inside a
    // column: Even Out on it would reach only its own two panes, and its seam
    // would move both of them as one.
    const tree = split('s1', 'y', [leaf('g', { kind: 'game' }), split('s2', 'x', [leaf('c', { kind: 'empty' }), split('s3', 'y', [leaf('e1', { kind: 'empty' }), leaf('e2', { kind: 'empty' })], [0.5, 0.5])], [0.5, 0.5])], [0.6, 0.4]);
    assert.deepEqual(closePane(tree, 'c'), split('s1', 'y', [leaf('g', { kind: 'game' }), leaf('e1', { kind: 'empty' }), leaf('e2', { kind: 'empty' })], [0.6, 0.2, 0.2]));
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

test('the layout reports each split the pixels it divides, seams already taken off', () => {
    const inner = split('s2', 'y', [leaf('b', { kind: 'empty' }), leaf('c', { kind: 'empty' })], [0.5, 0.5]);
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), inner], [0.5, 0.5]);
    const { splits } = layoutTree(tree, { x: 0, y: 0, width: 1004, height: 604 });
    assert.equal(splits.get('s1'), 1000, 'the outer split divides the width less its one seam');
    assert.equal(splits.get('s2'), 600, 'the inner one divides the full height less its own seam');
});

test('a pane knows the split it sits in, and a lone pane sits in none', () => {
    const inner = split('s2', 'y', [leaf('b', { kind: 'empty' }), leaf('c', { kind: 'empty' })], [0.5, 0.5]);
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), inner], [0.5, 0.5]);
    assert.equal(parentSplitOf(tree, 'a'), 's1');
    assert.equal(parentSplitOf(tree, 'c'), 's2', 'the nearest split, not the root');
    assert.equal(parentSplitOf(leaf('only', { kind: 'empty' }), 'only'), null);
});

test('a seam reports the size its pane was drawn at, not the size its fraction asked for', () => {
    // Three panes in a container that can hold them, then one fraction driven
    // far under the floor. `allocate` pins that pane at 120; the seam must say
    // 120 too, because Grip builds its next request on what comes back — and a
    // seam that answered with the fraction's raw ask would have every later
    // key press aim from a position the pane is not at.
    // Fractions that ask for less than the floor. Reachable without any illegal
    // drag: a window shrinking renormalises nothing, so a share that was
    // comfortable at one width is under the floor at another, and `allocate`
    // pins the pane while the fraction stays where it was.
    const tree = split(
        's1',
        'x',
        [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' }), leaf('c', { kind: 'empty' }), leaf('d', { kind: 'empty' })],
        [0.1, 0.1, 0.3, 0.5]
    );
    const rect = { x: 0, y: 0, width: 512, height: 300 };
    const { panes, splits } = layoutTree(tree, rect);
    assert.equal(panes.get('a')!.width, 120, 'drawn at the floor, not at the 50 its fraction asks for');
    assert.equal(seamPixels(tree, 's1', 0, splits.get('s1')!)!.size, panes.get('a')!.width, 'and the seam reports the floor, not the fraction');
});

test('clearing the game empties the leaf that held it and leaves the rest alone', () => {
    const tree = split('s1', 'x', [leaf('g', { kind: 'game' }), leaf('c', { kind: 'tool', tool: 'chat' })], [0.7, 0.3]);
    const cleared = clearGame(tree);
    assert.deepEqual(contentOf(cleared, 'g'), { kind: 'empty' }, 'the pane survives the game leaving it');
    assert.deepEqual(contentOf(cleared, 'c'), { kind: 'tool', tool: 'chat' });
    assert.deepEqual(
        paneIds(cleared),
        ['g', 'c'],
        'and no pane is removed — the game moving out is not the pane closing'
    );
});

test('clearing the game reaches a nested pane', () => {
    const inner = split('s2', 'y', [leaf('b', { kind: 'empty' }), leaf('g', { kind: 'game' })], [0.5, 0.5]);
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), inner], [0.5, 0.5]);
    assert.deepEqual(contentOf(clearGame(tree), 'g'), { kind: 'empty' });
});

test('clearing a tree with no game in it changes nothing, by identity', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' })], [0.5, 0.5]);
    assert.equal(clearGame(tree), tree, 'the same object, so a caller can tell nothing moved');
});

test('two panes trade places, each keeping its id, and the slots they trade keep their shape', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'game' }), split('s2', 'y', [leaf('b', { kind: 'empty' }), leaf('c', { kind: 'page', bookmark: 'u' })], [0.3, 0.7])], [0.4, 0.6]);
    // The shape is the whole promise of a swap: every slot keeps its size and
    // its seams, and only the two panes in them move. The ids move with them,
    // because a page view is keyed by its pane's id — trading contents under
    // fixed ids left each page's view where it was and swapped only the names.
    assert.deepEqual(
        swapPanes(tree, 'a', 'c'),
        split('s1', 'x', [leaf('c', { kind: 'page', bookmark: 'u' }), split('s2', 'y', [leaf('b', { kind: 'empty' }), leaf('a', { kind: 'game' })], [0.3, 0.7])], [0.4, 0.6])
    );
});

test('a swap that names one pane twice, or a pane that is not there, changes nothing', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'game' }), leaf('b', { kind: 'empty' })], [0.5, 0.5]);
    assert.equal(swapPanes(tree, 'a', 'a'), tree, 'the same object, so nothing downstream repaints');
    assert.equal(swapPanes(tree, 'a', 'gone'), tree);
});

test('an extent can be halved only when both halves and the seam between them fit', () => {
    // Two 120s and the 4px seam.
    assert.equal(halvable(243, 120), false);
    assert.equal(halvable(244, 120), true);
});

test('a pane dropped on the far side of its only neighbour trades sides with it, at even halves', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'game' }), leaf('b', { kind: 'tool', tool: 'chat' })], [0.7, 0.3]);
    // Lifting a out collapses s1 into b, so b is split afresh and a keeps its id.
    assert.deepEqual(movePane(tree, 'a', 'b', 'right', 's-new'), split('s-new', 'x', [leaf('b', { kind: 'tool', tool: 'chat' }), leaf('a', { kind: 'game' })], [0.5, 0.5]));
});

test('a pane dropped along its target\'s split joins it, halving only the target\'s share', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' }), leaf('c', { kind: 'empty' })], [0.4, 0.4, 0.2]);
    // c leaves first and a and b share its fifth, so each has half; c then takes half of a's.
    const next = movePane(tree, 'c', 'a', 'left', 's-new');
    assert.deepEqual(next, split('s1', 'x', [leaf('c', { kind: 'empty' }), leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' })], [0.25, 0.25, 0.5]), 'no new split — the row stays flat');
});

test('a pane dropped across its target\'s split nests the target with it', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'game' }), leaf('b', { kind: 'empty' }), leaf('c', { kind: 'tool', tool: 'chat' })], [0.4, 0.4, 0.2]);
    assert.deepEqual(
        movePane(tree, 'c', 'a', 'bottom', 's-new'),
        split('s1', 'x', [split('s-new', 'y', [leaf('a', { kind: 'game' }), leaf('c', { kind: 'tool', tool: 'chat' })], [0.5, 0.5]), leaf('b', { kind: 'empty' })], [0.5, 0.5])
    );
});

test('the target\'s split is read after the pane has left, since leaving can collapse it', () => {
    // a is dropped right of b. Before a leaves, b's parent runs top to bottom
    // under a row; once a has gone the row collapses away, and b is nested in
    // a new row inside what is left.
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), split('s2', 'y', [leaf('b', { kind: 'empty' }), leaf('c', { kind: 'empty' })], [0.5, 0.5])], [0.5, 0.5]);
    assert.deepEqual(
        movePane(tree, 'a', 'b', 'right', 's-new'),
        split('s2', 'y', [split('s-new', 'x', [leaf('b', { kind: 'empty' }), leaf('a', { kind: 'empty' })], [0.5, 0.5]), leaf('c', { kind: 'empty' })], [0.5, 0.5])
    );
});

test('a pane moved out of a split that collapses into its parent\'s column joins that column flat', () => {
    // Chat, beside a column of two under the game, dropped on the game's bottom
    // edge: the game, chat and the two panes end up as one column of four.
    const tree = split('s1', 'y', [leaf('g', { kind: 'game' }), split('s2', 'x', [leaf('c', { kind: 'empty' }), split('s3', 'y', [leaf('e1', { kind: 'empty' }), leaf('e2', { kind: 'empty' })], [0.5, 0.5])], [0.5, 0.5])], [0.6, 0.4]);
    const next = movePane(tree, 'c', 'g', 'bottom', 's-new');
    assert.deepEqual(next, split('s1', 'y', [leaf('g', { kind: 'game' }), leaf('c', { kind: 'empty' }), leaf('e1', { kind: 'empty' }), leaf('e2', { kind: 'empty' })], [0.3, 0.3, 0.2, 0.2]));
    assert.equal(movePane(next, 'e1', 'c', 'bottom', 's-new'), next, 'and e1, already directly below chat, stays put when dropped there');
});

test('a pane dropped where it already is changes nothing, by identity', () => {
    const row = split('s1', 'x', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' })], [0.3, 0.7]);
    assert.equal(movePane(row, 'a', 'b', 'left', 's-new'), row, 'a is already directly left of b, so its share is not halved behind the player\'s back');
    const column = split('s1', 'y', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' })], [0.3, 0.7]);
    assert.equal(movePane(column, 'a', 'b', 'top', 's-new'), column);
    assert.equal(movePane(row, 'a', 'a', 'right', 's-new'), row, 'onto itself');
    assert.equal(movePane(row, 'a', 'gone', 'right', 's-new'), row, 'onto a pane that is not there');
    assert.notEqual(movePane(row, 'a', 'b', 'top', 's-new'), row, 'beside, but the other way, is a real move');
});

test('a pane that is beside its target but not next to it still moves', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' }), leaf('c', { kind: 'empty' })], [0.25, 0.25, 0.5]);
    assert.deepEqual(paneIds(movePane(tree, 'a', 'c', 'left', 's-new')), ['b', 'a', 'c']);
});

test('after a move every pane and seam still tiles the tab exactly', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'game' }), split('s2', 'y', [leaf('b', { kind: 'empty' }), leaf('c', { kind: 'empty' }), leaf('d', { kind: 'empty' })], [0.2, 0.5, 0.3])], [0.6, 0.4]);
    const next = movePane(tree, 'd', 'a', 'top', 's-new');
    assert.deepEqual([...paneIds(next)].sort(), ['a', 'b', 'c', 'd'], 'nothing gained or lost');
    for (const [width, height] of [[1003, 701], [800, 600], [1281, 777]] as const) {
        const { panes, seams } = layoutTree(next, { x: 0, y: 0, width, height });
        const area = [...panes.values(), ...seams.map(s => s.rect)].reduce((sum, r) => sum + r.width * r.height, 0);
        assert.equal(area, width * height, `no gap or overlap at ${width}x${height}`);
    }
});

const worlds = { kind: 'tool', tool: 'worlds' } as const;
const born = { paneId: 'new', splitId: 's-new' };

test('a column added to a lone pane opens beside it at its preferred width', () => {
    // 804 = 800 of pane plus the new seam; 320 of it is the column's.
    const tree = appendColumn(leaf('a', { kind: 'game' }), worlds, 804, born);
    assert.equal(tree.kind === 'split' && tree.axis, 'x');
    assert.deepEqual(paneIds(tree), ['a', 'new'], 'the new pane is the rightmost');
    assert.deepEqual(contentOf(tree, 'new'), worlds, 'holding what was asked for, not an empty pane');
    const { panes } = layoutTree(tree, { x: 0, y: 0, width: 804, height: 600 });
    assert.equal(panes.get('new')!.width, 320);
    assert.equal(panes.get('a')!.width, 480, 'the pane already there gives up the rest');
});

test('a column added to a tab split top and bottom runs the full height beside both', () => {
    const rows = split('s1', 'y', [leaf('g', { kind: 'game' }), leaf('c', { kind: 'tool', tool: 'chat' })], [0.7, 0.3]);
    const tree = appendColumn(rows, worlds, 1104, born);
    assert.equal(tree.kind === 'split' && tree.splitId, 's-new', 'wrapped in a new row, since the old root runs the other way');
    assert.equal(tree.kind === 'split' && tree.children[0], rows, 'the game and chat keep their own split untouched');
    const { panes } = layoutTree(tree, { x: 0, y: 0, width: 1104, height: 800 });
    assert.equal(panes.get('new')!.height, 800, 'beside both rows, not under one of them');
    assert.equal(panes.get('new')!.x, 784, 'at the right edge');
});

test('a column added to a row joins it rather than nesting, and the others keep their proportions', () => {
    const row = split('s1', 'x', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' })], [0.75, 0.25]);
    // 1208 = 1200 of panes plus two seams once the column is in.
    const tree = appendColumn(row, worlds, 1208, born);
    assert.equal(tree.kind === 'split' && tree.splitId, 's1', 'the same row, one child longer');
    assert.deepEqual(paneIds(tree), ['a', 'b', 'new']);
    const { panes } = layoutTree(tree, { x: 0, y: 0, width: 1208, height: 600 });
    assert.equal(panes.get('new')!.width, 320);
    assert.equal(panes.get('a')!.width, 660, 'three quarters of what is left');
    assert.equal(panes.get('b')!.width, 220, 'and a quarter');
});

test('on a narrow window a new column takes an even share, not its preferred width', () => {
    // gross 400: 320 would leave the pane beside it 80, so both get 200.
    const tree = appendColumn(leaf('a', { kind: 'empty' }), worlds, 404, born);
    const { panes } = layoutTree(tree, { x: 0, y: 0, width: 404, height: 600 });
    assert.equal(panes.get('new')!.width, 200);
    assert.equal(panes.get('a')!.width, 200);
});

test('a column can be added only while every column, the new one included, fits above its floor', () => {
    // Two 120s and a seam.
    assert.equal(canAppendColumn(leaf('a', { kind: 'empty' }), 243), false);
    assert.equal(canAppendColumn(leaf('a', { kind: 'empty' }), 244), true);
    const row = split('s1', 'x', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' })], [0.5, 0.5]);
    // Three 120s and two seams.
    assert.equal(canAppendColumn(row, 367), false);
    assert.equal(canAppendColumn(row, 368), true);
    const rows = split('s1', 'y', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' })], [0.5, 0.5]);
    assert.equal(canAppendColumn(rows, 244), true, 'rows stacked top and bottom are one column wide');
});

// ── the game holds its size ──────────────────────────────────────────────

const game = leaf('g', { kind: 'game' });
const chat = leaf('c', { kind: 'tool', tool: 'chat' });
const drawn = (tree: PaneNode, size: Size, paneId: string): Size => {
    const rect = layoutTree(tree, { x: 0, y: 0, width: size.width, height: size.height }).panes.get(paneId)!;
    return { width: rect.width, height: rect.height };
};
/** The game over chat a new window opens with: 567 of game, a seam, 232 of chat. */
const opened = split('s1', 'y', [game, chat], [567 / 799, 232 / 799]);
const openedAt = { width: 765, height: 803 };

test('a window grown taller gives the height to the pane below the game, and none to the game', () => {
    const taller = { width: 765, height: 1003 };
    const tree = keepGame(opened, openedAt, taller);
    assert.equal(drawn(tree, taller, 'g').height, 567, 'the game keeps its height');
    assert.equal(drawn(tree, taller, 'c').height, 432, 'chat takes all 200 new pixels');
});

test('a window grown wider gives the width to the panes beside the game, in proportion to their sizes', () => {
    const a = leaf('a', { kind: 'empty' });
    const b = leaf('b', { kind: 'empty' });
    // 765 of game, 300 and 200 beside it, two seams.
    const row = split('s1', 'x', [game, a, b], [765 / 1265, 300 / 1265, 200 / 1265]);
    const from = { width: 1273, height: 600 };
    const wider = { width: 1773, height: 600 };
    const tree = keepGame(row, from, wider);
    assert.equal(drawn(tree, wider, 'g').width, 765);
    assert.equal(drawn(tree, wider, 'a').width, 600, 'three fifths of the 500 new pixels');
    assert.equal(drawn(tree, wider, 'b').width, 400, 'and two fifths');
});

test('the game keeps its size to the pixel, and the row still tiles, at any width with room for it', () => {
    const a = leaf('a', { kind: 'empty' });
    const b = leaf('b', { kind: 'empty' });
    const row = split('s1', 'x', [a, game, b], [1 / 3, 1 / 3, 1 / 3]);
    const from = { width: 1003, height: 600 };
    const held = drawn(row, from, 'g').width;
    for (let width = 700; width <= 2400; width += 37) {
        const to = { width, height: 600 };
        const tree = keepGame(row, from, to);
        assert.equal(drawn(tree, to, 'g').width, held, `the game is ${held}px wide at a ${width}px window`);
        const panes = layoutTree(tree, { x: 0, y: 0, ...to }).panes;
        assert.equal(panes.get('b')!.x + panes.get('b')!.width, width, `and the row ends at the window's edge at ${width}px`);
    }
});

test('a game nested in a column beside a row keeps both its width and its height', () => {
    const worlds = leaf('w', { kind: 'tool', tool: 'worlds' });
    // 765 of column and 331 of Worlds across; 567 of game and 232 of chat down.
    const tree = split('s1', 'x', [split('s2', 'y', [game, chat], [567 / 799, 232 / 799]), worlds], [765 / 1096, 331 / 1096]);
    const from = { width: 1100, height: 803 };
    const to = { width: 1500, height: 1000 };
    const next = keepGame(tree, from, to);
    assert.deepEqual(drawn(next, to, 'g'), { width: 765, height: 567 });
    assert.equal(drawn(next, to, 'w').width, 731, 'Worlds takes the width');
    assert.equal(drawn(next, to, 'c').height, 429, 'chat takes the height');
});

test('shrinking takes the other panes to their floor first, and only then the game', () => {
    const shorter = { width: 765, height: 600 };
    const tree = keepGame(opened, openedAt, shorter);
    assert.equal(drawn(tree, shorter, 'c').height, 80, 'chat goes to its floor');
    assert.equal(drawn(tree, shorter, 'g').height, 516, 'and the game gives up the rest');
});

test('a tree with no game in it scales every pane, as it always has', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' })], [0.5, 0.5]);
    assert.equal(keepGame(tree, { width: 804, height: 600 }, { width: 1204, height: 600 }), tree);
});

test('the same size, or a game alone in its tab, leaves the tree as it was', () => {
    assert.equal(keepGame(opened, openedAt, { ...openedAt }), opened);
    assert.equal(keepGame(game, openedAt, { width: 1200, height: 900 }), game, 'nothing beside it to take the room');
});

test('a resize is fitted from the arrangement the player left, so shrinking past the floors and growing back restores the game', () => {
    const first = refit(null, opened, openedAt);
    assert.equal(first.shown, opened, 'the first layout is the arrangement itself');
    const squeezed = refit(first, first.shown, { width: 765, height: 400 });
    assert.equal(drawn(squeezed.shown, { width: 765, height: 400 }, 'g').height, 316);
    const back = refit(squeezed, squeezed.shown, openedAt);
    assert.equal(drawn(back.shown, openedAt, 'g').height, 567, 'the game is back at the size it was left at');
    assert.equal(back.base, opened, 'fitted from the same arrangement throughout');
});

test('a change the player makes becomes the arrangement later sizes are fitted from', () => {
    const taller = { width: 765, height: 1003 };
    const first = refit(null, opened, openedAt);
    const grown = refit(first, first.shown, taller);
    // A seam drag at the taller size: the game made 700 tall.
    const dragged = setSeam(grown.shown, 's1', 0, 700, 999);
    const after = refit(grown, dragged, taller);
    assert.equal(after.base, dragged, 'the dragged tree is the new arrangement');
    assert.equal(after.shown, dragged, 'and at the size it was made at, it is what is shown');
    const shrunk = refit(after, after.shown, { width: 765, height: 900 });
    assert.equal(drawn(shrunk.shown, { width: 765, height: 900 }, 'g').height, 700, 'the game keeps the size it was dragged to');
});

test('Reset Game Size puts the game back to the size a new window opens it at', () => {
    const size = { width: 765, height: 1003 };
    const even = split('s1', 'y', [game, chat], [0.5, 0.5]);
    const tree = resetGame(even, size, { width: 765, height: 567 });
    assert.equal(drawn(tree, size, 'g').height, 567);
    assert.equal(drawn(tree, size, 'c').height, 432, 'chat has the rest');
});

test('Reset Game Size grows a game that is too small as well as shrinking one that is too big', () => {
    const worlds = leaf('w', { kind: 'tool', tool: 'worlds' });
    const size = { width: 1500, height: 600 };
    const tree = resetGame(split('s1', 'x', [game, worlds], [0.3, 0.7]), size, { width: 765, height: 567 });
    assert.equal(drawn(tree, size, 'g').width, 765);
    assert.equal(drawn(tree, size, 'g').height, 600, 'nothing is above or below the game to take the height, so it keeps it');
});

test('Reset Game Size reaches a game nested in a column, and leaves the panes around it as they were', () => {
    const a = leaf('a', { kind: 'empty' });
    const b = leaf('b', { kind: 'empty' });
    const other = split('s3', 'y', [a, b], [0.25, 0.75]);
    const tree = split('s1', 'x', [split('s2', 'y', [game, chat], [0.5, 0.5]), other], [0.5, 0.5]);
    const size = { width: 1504, height: 1000 };
    const next = resetGame(tree, size, { width: 765, height: 567 });
    assert.deepEqual(drawn(next, size, 'g'), { width: 765, height: 567 });
    assert.equal(next.kind === 'split' && next.children[1], other, 'the column beside it is the same column, only narrower');
});

test('Reset Game Size stops at the floor of the panes beside the game', () => {
    const worlds = leaf('w', { kind: 'tool', tool: 'worlds' });
    const size = { width: 880, height: 600 };
    const tree = resetGame(split('s1', 'x', [game, worlds], [0.5, 0.5]), size, { width: 765, height: 567 });
    assert.equal(drawn(tree, size, 'w').width, 120, 'Worlds goes no smaller than its floor');
    assert.equal(drawn(tree, size, 'g').width, 756, 'so the game gets as close as there is room for');
});

test('Reset Game Size leaves the tree as it was when it would change nothing', () => {
    const want = { width: 765, height: 567 };
    assert.equal(resetGame(opened, openedAt, want), opened, 'already at its size');
    assert.equal(resetGame(game, { width: 1200, height: 900 }, want), game, 'alone in its tab, with nothing to trade space with');
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' })], [0.5, 0.5]);
    assert.equal(resetGame(tree, { width: 1204, height: 600 }, want), tree, 'no game in this tab');
});
