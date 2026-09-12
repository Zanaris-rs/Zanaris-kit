import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaf, split } from './paneTree.ts';
import { paneMenuItems } from './paneMenu.ts';

const roomy = { width: 800, height: 600 };
const byId = (items: ReturnType<typeof paneMenuItems>, id: string): (typeof items)[number] => items.find(i => i.id === id)!;

test('a roomy pane offers both splits', () => {
    const items = paneMenuItems(leaf('a', { kind: 'empty' }), 'a', roomy);
    assert.equal(byId(items, 'split-x').enabled, true);
    assert.equal(byId(items, 'split-y').enabled, true);
});

test('a pane too narrow to halve cannot be split across, but can still be split down', () => {
    // 243 is one pixel short of two 120s and the 4px seam between them.
    const items = paneMenuItems(leaf('a', { kind: 'empty' }), 'a', { width: 243, height: 600 });
    assert.equal(byId(items, 'split-x').enabled, false, 'neither half could be drawn');
    assert.equal(byId(items, 'split-y').enabled, true, 'the other axis is unaffected');
});

test('a pane too short to halve cannot be split down', () => {
    const items = paneMenuItems(leaf('a', { kind: 'empty' }), 'a', { width: 800, height: 163 });
    assert.equal(byId(items, 'split-y').enabled, false);
});

test('even out is offered only to a pane that has siblings to even out with', () => {
    assert.equal(byId(paneMenuItems(leaf('a', { kind: 'empty' }), 'a', roomy), 'even-out').enabled, false);
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' })], [0.5, 0.5]);
    assert.equal(byId(paneMenuItems(tree, 'a', roomy), 'even-out').enabled, true);
});

test("the game's close says what it costs, and every other pane's does not", () => {
    assert.equal(byId(paneMenuItems(leaf('a', { kind: 'game' }), 'a', roomy), 'close').label, 'Close Game');
    assert.equal(byId(paneMenuItems(leaf('a', { kind: 'empty' }), 'a', roomy), 'close').label, 'Close Pane');
});

test('the only pane in a tab can still be closed — it empties rather than vanishing', () => {
    assert.equal(byId(paneMenuItems(leaf('a', { kind: 'game' }), 'a', roomy), 'close').enabled, true);
});
