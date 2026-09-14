import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentOf, layoutTree, leaf, paneIds, split } from './paneTree.ts';
import { closeTab, closingTab, labelOfTab, loadingLayout, moveGame, newTab, nextIds, openTabs, openWindowTabs, selectTab } from './tabs.ts';
import { CHAT_PREFERRED_HEIGHT, GAME_PREFERRED_HEIGHT, LOSTCITY_GAME_PREFERRED_HEIGHT, PANE_MIN_HEIGHT, SEAM } from '../shared/layout.ts';

test('a one-pane set holds whatever it was given', () => {
    const set = openTabs('tab-1', 'pane-1', { kind: 'game' });
    assert.deepEqual(set.tabs[0]!.tree, leaf('pane-1', { kind: 'game' }));
});

/** The game's and chat's heights as the solver draws them in a tree of this height. */
function heights(treeHeight: number): { game: number; chat: number } {
    const tree = openWindowTabs(treeHeight).tabs[0]!.tree;
    const rects = layoutTree(tree, { x: 0, y: 0, width: 765, height: treeHeight }).panes;
    return { game: rects.get('pane-1')!.height, chat: rects.get('pane-2')!.height };
}

test('a new window opens on the game with chat below it, the game focused', () => {
    const set = openWindowTabs(GAME_PREFERRED_HEIGHT + SEAM + CHAT_PREFERRED_HEIGHT);
    const tree = set.tabs[0]!.tree;
    assert.equal(tree.kind === 'split' && tree.axis, 'y', 'stacked, not side by side');
    assert.deepEqual(
        paneIds(tree).map(id => contentOf(tree, id)),
        [{ kind: 'game' }, { kind: 'tool', tool: 'chat' }]
    );
    assert.equal(set.tabs[0]!.focusedPaneId, 'pane-1', 'so a split starts from the game rather than from chat');
});

test('at the size a window opens at, the game and chat each get exactly what they ask for', () => {
    assert.deepEqual(heights(GAME_PREFERRED_HEIGHT + SEAM + CHAT_PREFERRED_HEIGHT), { game: GAME_PREFERRED_HEIGHT, chat: CHAT_PREFERRED_HEIGHT });
});

test("a server whose client page is taller gets its own game height, and chat still gets what it asks for", () => {
    const tree = openWindowTabs(LOSTCITY_GAME_PREFERRED_HEIGHT + SEAM + CHAT_PREFERRED_HEIGHT, LOSTCITY_GAME_PREFERRED_HEIGHT).tabs[0]!.tree;
    const rects = layoutTree(tree, { x: 0, y: 0, width: 765, height: LOSTCITY_GAME_PREFERRED_HEIGHT + SEAM + CHAT_PREFERRED_HEIGHT }).panes;
    assert.equal(rects.get('pane-1')!.height, LOSTCITY_GAME_PREFERRED_HEIGHT);
    assert.equal(rects.get('pane-2')!.height, CHAT_PREFERRED_HEIGHT);
});

test('on a short display chat gives way first, down to its floor, and the game keeps its height', () => {
    assert.deepEqual(heights(GAME_PREFERRED_HEIGHT + SEAM + 120), { game: GAME_PREFERRED_HEIGHT, chat: 120 });
    assert.deepEqual(heights(GAME_PREFERRED_HEIGHT + SEAM + PANE_MIN_HEIGHT), { game: GAME_PREFERRED_HEIGHT, chat: PANE_MIN_HEIGHT });
});

test('shorter still, the game gives way and chat holds its floor', () => {
    assert.deepEqual(heights(500), { game: 500 - SEAM - PANE_MIN_HEIGHT, chat: PANE_MIN_HEIGHT });
});

test('below two floors the two are shared in proportion, and nothing is negative', () => {
    const tiny = heights(120);
    assert.equal(tiny.game + tiny.chat, 120 - SEAM);
    assert.ok(tiny.game > 0 && tiny.chat > 0);
    const { game, chat } = heights(0);
    assert.ok(game >= 0 && chat >= 0);
});

test("a split made inside the window's opening arrangement gets an id of its own", () => {
    assert.deepEqual(nextIds(openWindowTabs(800)), { pane: 3, tab: 2, split: 2 });
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

test('the next ids carry on past whatever the window opened with', () => {
    const set = newTab(openTabs('tab-1', 'pane-1', { kind: 'game' }), 'tab-7', 'pane-4');
    assert.deepEqual(nextIds(set), { pane: 5, tab: 8, split: 1 });
});

test('split ids carry on too, so a split made inside the opening one cannot share its id', () => {
    const tree = split('split-3', 'y', [leaf('pane-1', { kind: 'game' }), split('split-1', 'x', [leaf('pane-2', { kind: 'empty' }), leaf('pane-5', { kind: 'empty' })], [0.5, 0.5])], [0.5, 0.5]);
    assert.deepEqual(nextIds({ tabs: [{ id: 'tab-1', tree, focusedPaneId: 'pane-1' }], activeId: 'tab-1' }), { pane: 6, tab: 2, split: 4 });
});

const games = (set: { tabs: { tree: Parameters<typeof paneIds>[0] }[] }): string[] =>
    set.tabs.flatMap(tab => paneIds(tab.tree).filter(id => contentOf(tab.tree, id)?.kind === 'game'));

test("loading a layout replaces that tab's panes, brings it to the front and leaves the other tabs alone", () => {
    const set = newTab(openTabs('tab-1', 'pane-1', { kind: 'tool', tool: 'chat' }), 'tab-2', 'pane-2');
    const layout = split('split-9', 'x', [leaf('pane-8', { kind: 'tool', tool: 'worlds' }), leaf('pane-9', { kind: 'empty' })], [0.5, 0.5]);
    const loaded = loadingLayout({ ...set, activeId: 'tab-2' }, 'tab-1', layout)!;
    assert.equal(loaded.set.activeId, 'tab-1');
    assert.equal(loaded.set.tabs[0]!.tree, layout);
    assert.equal(loaded.set.tabs[0]!.focusedPaneId, 'pane-8', 'focus on the first pane when there is no game to look at');
    assert.equal(loaded.set.tabs[1], set.tabs[1], 'the other tab is the same object');
    assert.equal(loaded.dropsGame, false);
});

test('a layout with a game pane takes the game from whichever tab had it, and focuses it', () => {
    const set = newTab(openTabs('tab-1', 'pane-1', { kind: 'game' }), 'tab-2', 'pane-2');
    const layout = split('split-9', 'y', [leaf('pane-8', { kind: 'tool', tool: 'chat' }), leaf('pane-9', { kind: 'game' })], [0.5, 0.5]);
    const loaded = loadingLayout(set, 'tab-2', layout)!;
    assert.deepEqual(games(loaded.set), ['pane-9'], 'one game leaf in the whole window, and it is the loaded one');
    assert.deepEqual(contentOf(loaded.set.tabs[0]!.tree, 'pane-1'), { kind: 'empty' }, 'the pane it left shows the launcher');
    assert.equal(loaded.set.tabs[1]!.focusedPaneId, 'pane-9');
    assert.equal(loaded.dropsGame, false, 'a move, not a close — nothing to ask');
});

test('a layout with a game pane loaded over the tab holding the game keeps the game', () => {
    const set = openTabs('tab-1', 'pane-1', { kind: 'game' });
    const loaded = loadingLayout(set, 'tab-1', leaf('pane-8', { kind: 'game' }))!;
    assert.equal(loaded.dropsGame, false);
    assert.deepEqual(games(loaded.set), ['pane-8']);
});

test('a layout with no game, loaded over the tab holding it, is closing the game and says so', () => {
    const set = newTab(openTabs('tab-1', 'pane-1', { kind: 'game' }), 'tab-2', 'pane-2');
    const loaded = loadingLayout(set, 'tab-1', leaf('pane-8', { kind: 'tool', tool: 'chat' }))!;
    assert.equal(loaded.dropsGame, true, 'the window must ask and destroy the view, never keep it with nowhere to show it');
    assert.deepEqual(games(loaded.set), []);
});

test('a layout with no game, loaded over some other tab, leaves the game where it is', () => {
    const set = newTab(openTabs('tab-1', 'pane-1', { kind: 'game' }), 'tab-2', 'pane-2');
    const loaded = loadingLayout(set, 'tab-2', leaf('pane-8', { kind: 'tool', tool: 'chat' }))!;
    assert.equal(loaded.dropsGame, false);
    assert.equal(loaded.set.tabs[0], set.tabs[0]);
});

test('loading into a tab that is not there does nothing', () => {
    assert.equal(loadingLayout(openTabs('tab-1', 'pane-1', { kind: 'game' }), 'gone', leaf('pane-8', { kind: 'empty' })), null);
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
