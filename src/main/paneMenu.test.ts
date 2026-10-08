import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaf, split } from './paneTree.ts';
import { addPaneItems, canClosePane, paneContentItems, paneDropdown, paneHolding, paneMenuItems, paneName, showsClocks, splitContentItems, splitMenus } from './paneMenu.ts';

const roomy = { width: 800, height: 600 };
/** A tab the size of the one pane in it, and the size the game opens at. */
const sizes = { tab: roomy, game: { width: 765, height: 567 } };
const byId = (items: ReturnType<typeof paneMenuItems>, id: string): (typeof items)[number] => items.find(i => i.id === id)!;

test('a roomy pane offers both splits', () => {
    const items = paneMenuItems(leaf('a', { kind: 'empty' }), 'a', roomy, sizes);
    assert.equal(byId(items, 'split-x').enabled, true);
    assert.equal(byId(items, 'split-y').enabled, true);
});

test('a pane too narrow to halve cannot be split across, but can still be split down', () => {
    // 243 is one pixel short of two 120s and the 4px seam between them.
    const items = paneMenuItems(leaf('a', { kind: 'empty' }), 'a', { width: 243, height: 600 }, sizes);
    assert.equal(byId(items, 'split-x').enabled, false, 'neither half could be drawn');
    assert.equal(byId(items, 'split-y').enabled, true, 'the other axis is unaffected');
});

test('a pane too short to halve cannot be split down', () => {
    const items = paneMenuItems(leaf('a', { kind: 'empty' }), 'a', { width: 800, height: 163 }, sizes);
    assert.equal(byId(items, 'split-y').enabled, false);
});

test("a split too narrow to halve is greyed in the dropdown's submenus by the right-click menu's own test", () => {
    const tree = leaf('a', { kind: 'empty' });
    const narrow = { width: 243, height: 600 };
    const menus = splitMenus({ tree, trees: [tree], paneId: 'a', tools: ['chat'], links: [], rect: narrow, sizes });
    assert.deepEqual(
        menus.map(m => [m.id, m.label, m.enabled]),
        paneMenuItems(tree, 'a', narrow, sizes)
            .slice(0, 2)
            .map(i => [i.id, i.label, i.enabled]),
        'the same splits, not a second opinion about them'
    );
    assert.equal(menus[0]!.enabled, false, 'too narrow to halve across');
    assert.equal(menus[1]!.enabled, true);
});

test("the game's header dropdown offers Reset Game Size too, the same item the right-click menu does", () => {
    const tree = split('s1', 'y', [leaf('a', { kind: 'game' }), leaf('b', { kind: 'tool', tool: 'chat' })], [0.5, 0.5]);
    const tab = { tab: { width: 765, height: 1003 }, game: sizes.game };
    const rect = { width: 765, height: 500 };
    const dropdown = paneDropdown({ tree, trees: [tree], paneId: 'a', tools: ['chat'], links: [], rect, sizes: tab });
    assert.deepEqual(dropdown.gestures, [byId(paneMenuItems(tree, 'a', rect, tab), 'reset-game')]);
    const chat = paneDropdown({ tree, trees: [tree], paneId: 'b', tools: ['chat'], links: [], rect, sizes: tab });
    assert.deepEqual(chat.gestures, [], 'a pane that is not the game has none');
});

test('every gesture a popup runs itself shows the View menu\'s shortcut for it, and the splits, which open lists, show none', () => {
    const items = paneMenuItems(leaf('a', { kind: 'game' }), 'a', roomy, sizes);
    assert.deepEqual(
        items.map(i => [i.id, i.accelerator]),
        [
            ['split-x', undefined],
            ['split-y', undefined],
            ['even-out', 'CmdOrCtrl+Alt+='],
            ['reset-game', undefined],
            ['close', 'CmdOrCtrl+W']
        ]
    );
});

test('only the game pane offers Reset Game Size', () => {
    const tree = split('s1', 'y', [leaf('a', { kind: 'game' }), leaf('b', { kind: 'tool', tool: 'chat' })], [0.5, 0.5]);
    const tab = { tab: { width: 765, height: 1003 }, game: sizes.game };
    assert.equal(byId(paneMenuItems(tree, 'a', { width: 765, height: 500 }, tab), 'reset-game').label, 'Reset Game Size');
    assert.equal(byId(paneMenuItems(tree, 'b', { width: 765, height: 499 }, tab), 'reset-game'), undefined, 'chat has no game to reset');
});

test('Reset Game Size is offered only when it would move the game', () => {
    const tree = split('s1', 'y', [leaf('a', { kind: 'game' }), leaf('b', { kind: 'tool', tool: 'chat' })], [0.5, 0.5]);
    const tall = { tab: { width: 765, height: 1003 }, game: sizes.game };
    assert.equal(byId(paneMenuItems(tree, 'a', { width: 765, height: 500 }, tall), 'reset-game').enabled, true, 'half of a tall window is not the size the game opens at');
    const tight = { tab: { width: 765, height: 1138 }, game: sizes.game };
    assert.equal(byId(paneMenuItems(tree, 'a', { width: 765, height: 567 }, tight), 'reset-game').enabled, false, 'already at its size');
    assert.equal(byId(paneMenuItems(leaf('a', { kind: 'game' }), 'a', roomy, sizes), 'reset-game').enabled, false, 'alone in its tab, with nothing to trade space with');
});

test('even out is offered only to a pane that has siblings to even out with', () => {
    assert.equal(byId(paneMenuItems(leaf('a', { kind: 'empty' }), 'a', roomy, sizes), 'even-out').enabled, false);
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' })], [0.5, 0.5]);
    assert.equal(byId(paneMenuItems(tree, 'a', roomy, sizes), 'even-out').enabled, true);
});

test("the game's close says what it costs, and every other pane's does not", () => {
    assert.equal(byId(paneMenuItems(leaf('a', { kind: 'game' }), 'a', roomy, sizes), 'close').label, 'Close Game');
    assert.equal(byId(paneMenuItems(leaf('a', { kind: 'empty' }), 'a', roomy, sizes), 'close').label, 'Close Pane');
});

test('the only pane in a tab can still be closed — it empties rather than vanishing', () => {
    assert.equal(byId(paneMenuItems(leaf('a', { kind: 'game' }), 'a', roomy, sizes), 'close').enabled, true);
});

test('the only pane in a tab, already empty, has nothing to close', () => {
    assert.equal(canClosePane(leaf('a', { kind: 'empty' }), 'a'), false, 'closing it would empty an empty pane');
    assert.equal(byId(paneMenuItems(leaf('a', { kind: 'empty' }), 'a', roomy, sizes), 'close').enabled, false, 'the menu and the header agree');
});

test('an empty pane beside another can be closed, and so can a lone pane holding anything', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), leaf('b', { kind: 'empty' })], [0.5, 0.5]);
    assert.equal(canClosePane(tree, 'a'), true);
    assert.equal(canClosePane(leaf('a', { kind: 'tool', tool: 'chat' }), 'a'), true);
    assert.equal(canClosePane(leaf('a', { kind: 'page', bookmark: 'https://2004.losthq.rs/' }), 'a'), true);
});

test('a pane the tree does not hold cannot be closed', () => {
    assert.equal(canClosePane(leaf('a', { kind: 'game' }), 'nope'), false);
});

const LINKS = [
    { url: 'https://2004.losthq.rs/', name: 'Forums' },
    { url: 'https://tools.losthq.rs/map', name: 'World Map' }
];

test('a pane is named for what it holds', () => {
    assert.equal(paneName({ kind: 'empty' }), 'Empty');
    assert.equal(paneName({ kind: 'game' }), 'Game');
    assert.equal(paneName({ kind: 'tool', tool: 'hiscores' }), 'Hiscores');
    assert.equal(paneName({ kind: 'tool', tool: 'singleplayer' }), 'Home server', 'the name people read, not the stored id');
    assert.equal(paneName({ kind: 'page', bookmark: LINKS[1]!.url }, LINKS), 'World Map', "the catalog's curated name, not the page's own title");
});

test('a page whose link the server no longer offers is named for its url rather than blank', () => {
    assert.equal(paneName({ kind: 'page', bookmark: 'https://gone.example/' }, LINKS), 'https://gone.example/');
});

const items = (tree: ReturnType<typeof leaf>, paneId: string, more: ReturnType<typeof leaf>[] = []): ReturnType<typeof paneContentItems> =>
    paneContentItems({ trees: [tree, ...more], paneId, tools: ['chat', 'worlds'], links: LINKS });

test("a pane may become one of this window's tools, the game, or one of this server's links", () => {
    const list = items(leaf('a', { kind: 'empty' }), 'a');
    assert.deepEqual(
        list.map(item => item.label),
        ['Chat', 'Worlds', 'Game', 'Forums', 'World Map'],
        "tools in the window's order, then the game, then the links in catalog order"
    );
    assert.deepEqual(
        list.map(item => item.group),
        ['tool', 'tool', 'game', 'link', 'link']
    );
    assert.deepEqual(list[4]!.content, { kind: 'page', bookmark: LINKS[1]!.url });
});

test('the game says it will move when it is somewhere else, in this tab or another', () => {
    const here = leaf('a', { kind: 'empty' });
    const elsewhere = leaf('g', { kind: 'game' });
    const game = (list: ReturnType<typeof paneContentItems>): (typeof list)[number] => list.find(item => item.group === 'game')!;
    assert.equal(game(items(here, 'a', [elsewhere])).label, 'Move game here', 'a game in another tab is still a move, not a refusal');
    assert.equal(game(items(split('s', 'x', [here, elsewhere], [0.5, 0.5]), 'a')).label, 'Move game here');
    assert.equal(game(items(here, 'a')).label, 'Game', 'nothing to move when the window has no game running');
    assert.equal(game(items(elsewhere, 'g')).label, 'Game', 'nor when this is the pane it is already in');
});

test('the item a pane already holds is marked, and nothing else is', () => {
    const tree = split('s', 'x', [leaf('a', { kind: 'tool', tool: 'worlds' }), leaf('b', { kind: 'empty' })], [0.5, 0.5]);
    const list = paneContentItems({ trees: [tree], paneId: 'a', tools: ['chat', 'worlds'], links: LINKS });
    assert.deepEqual(
        list.filter(item => item.current).map(item => item.label),
        ['Worlds']
    );
});

test('a page pane marks the link it is showing, not another of them', () => {
    const list = paneContentItems({ trees: [leaf('a', { kind: 'page', bookmark: LINKS[0]!.url })], paneId: 'a', tools: [], links: LINKS });
    assert.deepEqual(
        list.filter(item => item.current).map(item => item.label),
        ['Forums']
    );
});

test('the game item is marked in the pane that holds it', () => {
    const list = paneContentItems({ trees: [leaf('a', { kind: 'game' })], paneId: 'a', tools: [], links: [] });
    assert.deepEqual(
        list.filter(item => item.current).map(item => item.label),
        ['Game']
    );
});

const adds = (opts: { tree: ReturnType<typeof leaf>; others?: ReturnType<typeof leaf>[]; width?: number }): ReturnType<typeof addPaneItems> =>
    addPaneItems({ tree: opts.tree, trees: [opts.tree, ...(opts.others ?? [])], tools: ['chat', 'worlds'], links: LINKS, width: opts.width ?? 1200 });
const named = (list: ReturnType<typeof addPaneItems>, label: string): (typeof list)[number] => list.find(item => item.label === label)!;

test("the tab bar's Add pane offers what a pane's dropdown does, in the same order", () => {
    const list = adds({ tree: leaf('a', { kind: 'empty' }) });
    const dropdown = items(leaf('a', { kind: 'empty' }), 'a');
    assert.deepEqual(
        list.map(item => [item.label, item.group, item.content]),
        dropdown.map(item => [item.label, item.group, item.content]),
        'one list, so the two menus cannot come to offer different things'
    );
});

test('something already in this tab is found rather than added a second time', () => {
    const tree = split('s', 'x', [leaf('w', { kind: 'tool', tool: 'worlds' }), leaf('g', { kind: 'game' }), leaf('p', { kind: 'page', bookmark: LINKS[0]!.url })], [0.4, 0.3, 0.3]);
    const list = adds({ tree });
    assert.equal(named(list, 'Worlds').openIn, 'w');
    assert.equal(named(list, 'Game').openIn, 'g', 'nothing to move: the game is already in this tab');
    assert.equal(named(list, 'Forums').openIn, 'p');
    assert.equal(named(list, 'Chat').openIn, null);
    assert.equal(named(list, 'World Map').openIn, null, 'another link is not the one that is open');
});

test('a tool in another tab is added here, and the game in another tab is moved here', () => {
    const list = adds({ tree: leaf('a', { kind: 'empty' }), others: [split('s', 'y', [leaf('g', { kind: 'game' }), leaf('c', { kind: 'tool', tool: 'chat' })], [0.5, 0.5])] });
    assert.equal(named(list, 'Chat').openIn, null, 'only this tab is searched: another tab is out of sight');
    assert.equal(list.find(item => item.group === 'game')!.label, 'Move game here');
    assert.equal(list.find(item => item.group === 'game')!.openIn, null);
});

test('with no room for another column, only what is already open stays enabled', () => {
    // One 120 floor already there, plus a seam and another 120, is 244.
    const list = adds({ tree: leaf('w', { kind: 'tool', tool: 'worlds' }), width: 243 });
    assert.deepEqual(
        list.filter(item => item.enabled).map(item => item.label),
        ['Worlds'],
        'going to a pane that exists needs no room'
    );
    assert.equal(
        adds({ tree: leaf('w', { kind: 'tool', tool: 'worlds' }), width: 244 }).every(item => item.enabled),
        true
    );
});

test('the pane holding something is found anywhere in the tab, and nowhere else', () => {
    const tree = split('s1', 'x', [leaf('a', { kind: 'empty' }), split('s2', 'y', [leaf('b', { kind: 'game' }), leaf('c', { kind: 'tool', tool: 'chat' })], [0.5, 0.5])], [0.5, 0.5]);
    assert.equal(paneHolding(tree, { kind: 'tool', tool: 'chat' }), 'c');
    assert.equal(paneHolding(tree, { kind: 'game' }), 'b');
    assert.equal(paneHolding(tree, { kind: 'tool', tool: 'worlds' }), null);
});

test("the game's header shows the clocks while its tab has no Timers pane", () => {
    assert.equal(showsClocks(leaf('g', { kind: 'game' }), 'g'), true, 'the game alone');
    const beside = split('s1', 'y', [leaf('g', { kind: 'game' }), leaf('c', { kind: 'tool', tool: 'chat' })], [0.5, 0.5]);
    assert.equal(showsClocks(beside, 'g'), true, 'beside a pane that is not Timers');
});

test("the game's header leaves the clocks to a Timers pane anywhere in its tab", () => {
    const tree = split('s1', 'x', [leaf('g', { kind: 'game' }), split('s2', 'y', [leaf('c', { kind: 'tool', tool: 'chat' }), leaf('t', { kind: 'tool', tool: 'timers' })], [0.5, 0.5])], [0.7, 0.3]);
    assert.equal(showsClocks(tree, 'g'), false);
});

test('only the game pane shows the clocks', () => {
    const tree = split('s1', 'x', [leaf('g', { kind: 'game' }), leaf('c', { kind: 'tool', tool: 'chat' }), leaf('e', { kind: 'empty' })], [0.5, 0.25, 0.25]);
    assert.equal(showsClocks(tree, 'c'), false);
    assert.equal(showsClocks(tree, 'e'), false);
    assert.equal(showsClocks(tree, 'nope'), false, 'a pane the tree does not hold');
});

const splitList = (trees: ReturnType<typeof leaf>[], paneId: string): ReturnType<typeof splitContentItems> =>
    splitContentItems({ trees, paneId, tools: ['chat', 'worlds'], links: LINKS });

test("a split's submenu offers everything the new half could hold, with nothing marked", () => {
    const tree = split('s', 'x', [leaf('a', { kind: 'tool', tool: 'worlds' }), leaf('b', { kind: 'empty' })], [0.5, 0.5]);
    const list = splitContentItems({ trees: [tree], paneId: 'a', tools: ['chat', 'worlds'], links: LINKS });
    assert.deepEqual(
        list.map(item => item.label),
        ['Chat', 'Worlds', 'Game', 'Forums', 'World Map'],
        'the order of every other list of contents'
    );
    assert.deepEqual(
        list.map(item => item.current),
        [false, false, false, false, false],
        'the new half holds nothing yet, so Worlds in the pane being split is not marked'
    );
});

test("splitting the game's own pane does not offer the game, which is already there", () => {
    assert.deepEqual(
        splitList([leaf('g', { kind: 'game' })], 'g').map(item => item.label),
        ['Chat', 'Worlds', 'Forums', 'World Map']
    );
});

test('the game in another pane or another tab is offered as a move into the new half', () => {
    const game = (list: ReturnType<typeof splitContentItems>): string | undefined => list.find(item => item.group === 'game')?.label;
    assert.equal(game(splitList([split('s', 'x', [leaf('a', { kind: 'empty' }), leaf('g', { kind: 'game' })], [0.5, 0.5])], 'a')), 'Move game here');
    assert.equal(game(splitList([leaf('a', { kind: 'tool', tool: 'chat' }), leaf('g', { kind: 'game' })], 'a')), 'Move game here', 'from another tab');
    assert.equal(game(splitList([leaf('a', { kind: 'tool', tool: 'chat' })], 'a')), 'Game', 'with no game running, choosing it starts one');
});

const dropdown = (tree: ReturnType<typeof leaf>, paneId: string): ReturnType<typeof paneDropdown> =>
    paneDropdown({ tree, trees: [tree], paneId, tools: ['chat', 'worlds'], links: LINKS, rect: roomy, sizes });

test('the dropdown of a pane holding something adds first, and replaces from a submenu', () => {
    const tree = split('s', 'x', [leaf('a', { kind: 'tool', tool: 'worlds' }), leaf('b', { kind: 'empty' })], [0.5, 0.5]);
    const menu = dropdown(tree, 'a');
    assert.equal(menu.fill, null, 'nothing at the top level replaces what the pane holds');
    assert.deepEqual(
        menu.splits.map(m => [m.id, m.label]),
        [
            ['split-x', 'Split Right'],
            ['split-y', 'Split Down']
        ]
    );
    for (const m of menu.splits) assert.deepEqual(m.items, splitContentItems({ trees: [tree], paneId: 'a', tools: ['chat', 'worlds'], links: LINKS }));
    assert.deepEqual(menu.replace, paneContentItems({ trees: [tree], paneId: 'a', tools: ['chat', 'worlds'], links: LINKS }), 'Replace With is the list it always was, Worlds ticked');
    assert.equal(menu.replace!.find(item => item.current)?.label, 'Worlds');
});

test("an empty pane's dropdown fills it from the top level, with the splits below and nothing to replace", () => {
    const tree = split('s', 'x', [leaf('a', { kind: 'tool', tool: 'worlds' }), leaf('b', { kind: 'empty' })], [0.5, 0.5]);
    const menu = dropdown(tree, 'b');
    assert.deepEqual(menu.fill, paneContentItems({ trees: [tree], paneId: 'b', tools: ['chat', 'worlds'], links: LINKS }));
    assert.equal(menu.replace, null);
    assert.equal(menu.splits.length, 2);
});
