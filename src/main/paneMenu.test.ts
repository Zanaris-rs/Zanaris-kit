import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaf, split } from './paneTree.ts';
import { canClosePane, paneContentItems, paneMenuItems, paneName } from './paneMenu.ts';

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

test('the only pane in a tab, already empty, has nothing to close', () => {
    assert.equal(canClosePane(leaf('a', { kind: 'empty' }), 'a'), false, 'closing it would empty an empty pane');
    assert.equal(byId(paneMenuItems(leaf('a', { kind: 'empty' }), 'a', roomy), 'close').enabled, false, 'the menu and the header agree');
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
    assert.equal(paneName({ kind: 'tool', tool: 'singleplayer' }), 'Single player', 'two words, not a capitalised id');
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
        'tools in rail order, then the game, then the links in catalog order'
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
