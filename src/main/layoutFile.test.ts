import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentOf, leaf, paneIds, split, type PaneNode } from './paneTree.ts';
import { instantiateLayout, layoutEntries, layoutFileName, readLayout, readSetup, storeTree, writeLayout, type StoredNode } from './layoutFile.ts';
import type { ToolId } from '../shared/ipc.ts';

const LINKS = [
    { url: 'https://2004.losthq.rs/', name: 'Forums' },
    { url: 'https://tools.losthq.rs/map', name: 'World Map' }
];
const TOOLS: ToolId[] = ['chat', 'worlds', 'hiscores'];

/** Hands out ids the way a window's counters do. */
function counters(pane = 1, splitAt = 1): { nextPane: () => string; nextSplit: () => string } {
    return { nextPane: () => `pane-${pane++}`, nextSplit: () => `split-${splitAt++}` };
}

const arranged: PaneNode = split(
    'split-4',
    'y',
    [split('split-2', 'x', [leaf('pane-1', { kind: 'game' }), leaf('pane-3', { kind: 'page', bookmark: LINKS[1]!.url })], [0.7, 0.3]), leaf('pane-2', { kind: 'tool', tool: 'chat' })],
    [0.75, 0.25]
);

const file = (tree: unknown, extra: Record<string, unknown> = {}): string => JSON.stringify({ kind: 'zanaris-kit-layout', version: 1, server: 'lostcity', tree, ...extra });

test('a layout round-trips through its file: shape, seams and contents', () => {
    assert.deepEqual(readLayout(writeLayout(arranged, 'lostcity')), storeTree(arranged));
});

test('a file carries no pane or split ids — those belong to the window that loads it', () => {
    const text = writeLayout(arranged, 'lostcity');
    assert.doesNotMatch(text, /pane-|split-|paneId|splitId/);
    assert.equal(JSON.parse(text).server, 'lostcity', 'where it was made is noted');
});

test('something that is not a layout file is refused rather than half-read', () => {
    const good = storeTree(arranged);
    for (const text of ['', '{ nope', 'null', '42', '[]', JSON.stringify({ tree: good }), file(good, { kind: 'something-else' }), file(good, { version: 2 }), file(null)]) {
        assert.equal(readLayout(text), null, `expected ${text.slice(0, 60)} to be refused`);
    }
});

test('a split that could not have been made is refused', () => {
    const one: StoredNode = { kind: 'leaf', content: { kind: 'empty' } };
    assert.equal(readLayout(file({ kind: 'split', axis: 'x', children: [one], fractions: [1] })), null, 'one child');
    assert.equal(readLayout(file({ kind: 'split', axis: 'z', children: [one, one], fractions: [1, 1] })), null, 'no such axis');
    assert.equal(readLayout(file({ kind: 'split', axis: 'x', children: [one, one], fractions: [1] })), null, 'fractions short of children');
    assert.equal(readLayout(file({ kind: 'split', axis: 'x', children: [one, one], fractions: [1, 0] })), null, 'a zero share');
    assert.equal(readLayout(file({ kind: 'split', axis: 'x', children: [one, one], fractions: [1, 'half'] })), null, 'a share that is not a number');
});

test('contents the kit does not know are refused', () => {
    assert.equal(readLayout(file({ kind: 'leaf', content: { kind: 'tool', tool: 'telescope' } })), null);
    assert.equal(readLayout(file({ kind: 'leaf', content: { kind: 'page', bookmark: '' } })), null);
    assert.equal(readLayout(file({ kind: 'leaf', content: { kind: 'window' } })), null);
});

test('a second game is refused — the window has one game view', () => {
    const game: StoredNode = { kind: 'leaf', content: { kind: 'game' } };
    assert.equal(readLayout(file({ kind: 'split', axis: 'x', children: [game, game], fractions: [1, 1] })), null);
});

test('shares are renormalised, so a hand-written [2, 1] means two thirds and one third', () => {
    const one: StoredNode = { kind: 'leaf', content: { kind: 'empty' } };
    const read = readLayout(file({ kind: 'split', axis: 'x', children: [one, one], fractions: [2, 1] }));
    assert.ok(read && read.kind === 'split');
    assert.deepEqual(read.fractions, [2 / 3, 1 / 3]);
});

test('a loaded layout gets fresh ids from the window, and nothing collides', () => {
    const tree = instantiateLayout(storeTree(arranged), { tools: TOOLS, links: LINKS, ...counters(7, 3) });
    assert.deepEqual(paneIds(tree), ['pane-7', 'pane-8', 'pane-9']);
    assert.equal(tree.kind === 'split' && tree.splitId, 'split-3');
    assert.deepEqual(contentOf(tree, 'pane-7'), { kind: 'game' });
    assert.deepEqual(contentOf(tree, 'pane-8'), { kind: 'page', bookmark: LINKS[1]!.url });
    assert.deepEqual(contentOf(tree, 'pane-9'), { kind: 'tool', tool: 'chat' });
});

test("whatever this window cannot show comes up empty, and the rest of the layout survives", () => {
    const stored = storeTree(
        split(
            's',
            'x',
            [leaf('a', { kind: 'tool', tool: 'singleplayer' }), leaf('b', { kind: 'page', bookmark: 'https://elsewhere.example/' }), leaf('c', { kind: 'tool', tool: 'hiscores' })],
            [1, 1, 1]
        )
    );
    const tree = instantiateLayout(stored, { tools: TOOLS, links: LINKS, ...counters() });
    assert.deepEqual(contentOf(tree, 'pane-1'), { kind: 'empty' }, 'a tool this window does not offer');
    assert.deepEqual(contentOf(tree, 'pane-2'), { kind: 'empty' }, "a page that is not one of this server's links");
    assert.deepEqual(contentOf(tree, 'pane-3'), { kind: 'tool', tool: 'hiscores' }, 'and what it can show, it shows');
});

test('a file name is suggested from the tab label, safe on every platform', () => {
    assert.equal(layoutFileName('Game'), 'Game.json');
    assert.equal(layoutFileName('World Map'), 'World Map.json');
    assert.equal(layoutFileName('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j.json');
    assert.equal(layoutFileName('.hidden'), 'hidden.json', 'a leading dot would hide it in the folder it is meant to be copied from');
    assert.equal(layoutFileName('trailing. '), 'trailing.json', 'Windows refuses a trailing dot or space');
    assert.equal(layoutFileName('  '), 'Layout.json');
    assert.equal(layoutFileName('x'.repeat(200)).length, 80 + '.json'.length);
});

test("the Load Layout list is the folder's layout files, by name, in the order a person reads them", () => {
    assert.deepEqual(layoutEntries(['Raids 10.json', '.DS_Store', 'notes.txt', 'raids 2.JSON', 'Game.json', '.hidden.json']), [
        { name: 'Game', file: 'Game.json' },
        { name: 'raids 2', file: 'raids 2.JSON' },
        { name: 'Raids 10', file: 'Raids 10.json' }
    ]);
});

test('a setup carries the size of the tab it was saved from', () => {
    const text = writeLayout(arranged, 'lostcity', { width: 1089, height: 803 });
    assert.deepEqual(readSetup(text), { tree: storeTree(arranged), size: { width: 1089, height: 803 } });
    assert.deepEqual(readLayout(text), storeTree(arranged), 'the tree alone reads as it always did');
});

test('a file with no size reads with none', () => {
    assert.deepEqual(readSetup(writeLayout(arranged, 'lostcity')), { tree: storeTree(arranged), size: null });
});

test('a size that is there and wrong refuses the whole file', () => {
    const good = storeTree(arranged);
    for (const size of [null, 'big', { width: 0, height: 600 }, { width: 800 }, { width: 800.5, height: 600 }, { width: 800, height: 16385 }, { width: -1, height: 600 }, { width: '800', height: 600 }]) {
        assert.equal(readSetup(file(good, { size })), null, `expected size ${JSON.stringify(size)} to be refused`);
    }
});
