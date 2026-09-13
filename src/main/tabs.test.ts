import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentOf, leaf, paneIds, split } from './paneTree.ts';
import { closeTab, closingTab, labelOfTab, moveGame, newTab, nextIds, openTabs, readTabSet, selectTab } from './tabs.ts';

test('a window opens on whatever it was given — the game, not a launcher', () => {
    const set = openTabs('tab-1', 'pane-1', { kind: 'game' });
    assert.deepEqual(set.tabs[0]!.tree, leaf('pane-1', { kind: 'game' }));
});

test('a new tab holds one empty pane and comes to the front', () => {
    const set = openTabs('tab-1', 'pane-1', { kind: 'game' });
    const next = newTab(set, 'tab-2', 'pane-2');
    assert.deepEqual(
        next.tabs.map(t => t.id),
        ['tab-1', 'tab-2']
    );
    assert.equal(next.activeId, 'tab-2');
    assert.deepEqual(next.tabs[1]!.tree, leaf('pane-2', { kind: 'empty' }));
    assert.equal(next.tabs[1]!.focusedPaneId, 'pane-2');
});

const three = (): ReturnType<typeof openTabs> => newTab(newTab(openTabs('a', 'p1', { kind: 'empty' }), 'b', 'p2'), 'c', 'p3');

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
    assert.equal(closeTab(openTabs('a', 'p1', { kind: 'empty' }), 'a'), null);
});

test('closing a tab that holds the game is the case that asks first', () => {
    const set = newTab(openTabs('a', 'p1', { kind: 'game' }), 'b', 'p2');
    assert.equal(closingTab(set, 'a'), 'game', 'from another tab as much as from its own');
    assert.equal(closingTab(selectTab(set, 'a'), 'a'), 'game');
    assert.equal(closingTab(set, 'b'), 'tab', 'a tab without the game closes without asking');
});

test('the warning follows the game when it moves between tabs', () => {
    const set = moveGame(newTab(openTabs('a', 'p1', { kind: 'empty' }), 'b', 'p2'), 'p2');
    assert.equal(closingTab(set, 'b'), 'game');
    assert.equal(closingTab(set, 'a'), 'tab', 'the tab the game moved out of holds nothing to warn about');
});

test("closing the only tab is the window's close, game or not", () => {
    assert.equal(closingTab(openTabs('a', 'p1', { kind: 'game' }), 'a'), 'window', "the window's own confirm already says the player is logged out");
    assert.equal(closingTab(openTabs('a', 'p1', { kind: 'empty' }), 'a'), 'window');
});

test('closing a tab that is not there is nothing', () => {
    assert.equal(closingTab(three(), 'nope'), 'missing');
});

test('selecting a tab that is not there changes nothing', () => {
    const set = three();
    assert.equal(selectTab(set, 'nope'), set, 'the same object, so nothing downstream repaints');
});

test('a tab is named for its first pane', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'tool', tool: 'hiscores' }), leaf('b', { kind: 'empty' })], [0.5, 0.5]);
    assert.equal(labelOfTab(tree), 'Hiscores');
    assert.equal(labelOfTab(leaf('e', { kind: 'empty' })), 'Empty');
});

test('the game does not name a tab it is not first in', () => {
    const tree = split('s1', 'x', [leaf('c', { kind: 'tool', tool: 'chat' }), leaf('g', { kind: 'game' })], [0.5, 0.5]);
    assert.equal(labelOfTab(tree), 'Chat');
});

test('the first pane is the top-left one, however deep the splits nest', () => {
    const inner = split('s2', 'y', [leaf('w', { kind: 'tool', tool: 'worlds' }), leaf('g', { kind: 'game' })], [0.5, 0.5]);
    assert.equal(labelOfTab(split('s1', 'x', [inner, leaf('c', { kind: 'tool', tool: 'chat' })], [0.5, 0.5])), 'Worlds');
});

test("a tab led by a page is named for the catalog's link", () => {
    const links = [{ url: 'https://tools.losthq.rs/skills', name: 'Skill Guides' }];
    const tree = split('s1', 'x', [leaf('p', { kind: 'page', bookmark: links[0]!.url }), leaf('h', { kind: 'tool', tool: 'hiscores' })], [0.5, 0.5]);
    assert.equal(labelOfTab(tree, links), 'Skill Guides');
});

test('a stored layout round-trips', () => {
    const set = newTab(openTabs('tab-1', 'pane-1', { kind: 'game' }), 'tab-2', 'pane-2');
    assert.deepEqual(readTabSet(JSON.parse(JSON.stringify(set))), set);
});

test('a layout that is not a layout is refused rather than half-loaded', () => {
    for (const junk of [null, 42, 'tabs', {}, { tabs: [], activeId: 'a' }, { tabs: [{ id: 'a' }], activeId: 'a' }]) {
        assert.equal(readTabSet(junk), null, `expected ${JSON.stringify(junk)} to be refused`);
    }
});

test('a layout whose active tab is not in it is refused', () => {
    const set = openTabs('tab-1', 'pane-1', { kind: 'game' });
    assert.equal(readTabSet({ ...set, activeId: 'gone' }), null);
});

test('a split whose fractions do not match its children is refused', () => {
    const bad = { tabs: [{ id: 't', focusedPaneId: 'a', tree: { kind: 'split', splitId: 's', axis: 'x', children: [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' })], fractions: [1] } }], activeId: 't' };
    assert.equal(readTabSet(bad), null);
});

test('two panes sharing an id are refused — a view is keyed by it', () => {
    const bad = { tabs: [{ id: 't', focusedPaneId: 'a', tree: split('s', 'x', [leaf('a', { kind: 'empty' }), leaf('a', { kind: 'empty' })], [0.5, 0.5]) }], activeId: 't' };
    assert.equal(readTabSet(bad), null);
});

test('a second game anywhere in the layout is refused — there is one view', () => {
    const bad = { tabs: [{ id: 't', focusedPaneId: 'a', tree: split('s', 'x', [leaf('a', { kind: 'game' }), leaf('b', { kind: 'game' })], [0.5, 0.5]) }], activeId: 't' };
    assert.equal(readTabSet(bad), null);
});

test('the next ids carry on past whatever was restored', () => {
    const set = newTab(openTabs('tab-1', 'pane-1', { kind: 'game' }), 'tab-7', 'pane-4');
    assert.deepEqual(nextIds(set), { pane: 5, tab: 8, split: 1 });
});

test('the game moves out of the tab it was in and into the pane asked for', () => {
    const set = newTab(openTabs('tab-1', 'pane-1', { kind: 'game' }), 'tab-2', 'pane-2');
    const moved = moveGame(set, 'pane-2');
    assert.deepEqual(contentOf(moved.tabs[0]!.tree, 'pane-1'), { kind: 'empty' }, 'the pane it left shows the launcher');
    assert.deepEqual(contentOf(moved.tabs[1]!.tree, 'pane-2'), { kind: 'game' });
    assert.equal(moved.activeId, set.activeId, 'moving the game is not a tab switch');
});

test('the game moves between two panes of one tab', () => {
    const tree = split('s1', 'x', [leaf('g', { kind: 'game' }), leaf('b', { kind: 'empty' })], [0.5, 0.5]);
    const set = { tabs: [{ id: 'tab-1', tree, focusedPaneId: 'g' }], activeId: 'tab-1' };
    const moved = moveGame(set, 'b');
    assert.deepEqual(contentOf(moved.tabs[0]!.tree, 'g'), { kind: 'empty' });
    assert.deepEqual(contentOf(moved.tabs[0]!.tree, 'b'), { kind: 'game' });
});

test('a window with no game anywhere simply gets one where it was asked for', () => {
    const set = openTabs('tab-1', 'pane-1', { kind: 'empty' });
    assert.deepEqual(contentOf(moveGame(set, 'pane-1').tabs[0]!.tree, 'pane-1'), { kind: 'game' });
});

test('moving the game onto the pane that already holds it changes nothing', () => {
    const set = openTabs('tab-1', 'pane-1', { kind: 'game' });
    assert.equal(moveGame(set, 'pane-1'), set, 'the same object, so nothing repaints and no view is touched');
});

test('moving the game to a pane no tab has leaves the game where it is', () => {
    const set = openTabs('tab-1', 'pane-1', { kind: 'game' });
    assert.equal(moveGame(set, 'gone'), set);
});

test('the game leaves only one pane, however many tabs are open', () => {
    const set = newTab(newTab(openTabs('tab-1', 'pane-1', { kind: 'game' }), 'tab-2', 'pane-2'), 'tab-3', 'pane-3');
    const moved = moveGame(set, 'pane-3');
    const games = moved.tabs.flatMap(tab => paneIds(tab.tree).filter(id => contentOf(tab.tree, id)?.kind === 'game'));
    assert.deepEqual(games, ['pane-3'], 'one game leaf in the whole window, which is all there is a view for');
});
