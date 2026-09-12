import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaf } from './paneTree.ts';
import { closeTab, newTab, openTabs, selectTab } from './tabs.ts';

test('a new tab holds one empty pane and comes to the front', () => {
    const set = openTabs('tab-1', 'pane-1');
    const next = newTab(set, 'tab-2', 'pane-2');
    assert.deepEqual(
        next.tabs.map(t => t.id),
        ['tab-1', 'tab-2']
    );
    assert.equal(next.activeId, 'tab-2');
    assert.deepEqual(next.tabs[1]!.tree, leaf('pane-2', { kind: 'empty' }));
    assert.equal(next.tabs[1]!.focusedPaneId, 'pane-2');
});

const three = (): ReturnType<typeof openTabs> => newTab(newTab(openTabs('a', 'p1'), 'b', 'p2'), 'c', 'p3');

test('closing the active tab activates the one that took its place', () => {
    const next = closeTab(selectTab(three(), 'b'), 'b')!;
    assert.deepEqual(
        next.tabs.map(t => t.id),
        ['a', 'c']
    );
    assert.equal(next.activeId, 'c', 'the one that slid into its index, not the one to its left');
});

test('closing the last tab in the row falls back to the one on its left', () => {
    const next = closeTab(three(), 'c')!;
    assert.equal(next.activeId, 'b');
});

test('closing a background tab leaves the active one where it is', () => {
    const next = closeTab(selectTab(three(), 'a'), 'c')!;
    assert.equal(next.activeId, 'a');
});

test('closing the only tab closes the window', () => {
    assert.equal(closeTab(openTabs('a', 'p1'), 'a'), null);
});

test('selecting a tab that is not there changes nothing', () => {
    const set = three();
    assert.equal(selectTab(set, 'nope'), set, 'the same object, so nothing downstream repaints');
});
