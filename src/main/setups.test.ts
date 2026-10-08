import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builtInSetups, opensWindow, openingSetup, readNewWindowSetup, readNewWindows, sameSetup } from './setups.ts';
import { instantiateLayout, writeLayout, type StoredNode } from './layoutFile.ts';
import { contentOf, layoutTree, leaf, paneIds, split, type PaneNode } from './paneTree.ts';
import { CHAT_PREFERRED_HEIGHT, GAME_PREFERRED_HEIGHT, LOSTCITY_GAME_PREFERRED_HEIGHT } from '../shared/layout.ts';
import type { ToolId } from '../shared/ipc.ts';

/** A built-in made real, and every pane's size at the size it was made for, keyed by what the pane holds. */
function drawn(tree: StoredNode, size: { width: number; height: number }, tools: readonly ToolId[]): Record<string, { width: number; height: number }> {
    let n = 1;
    const real: PaneNode = instantiateLayout(tree, { tools, links: [], nextPane: () => `pane-${n++}`, nextSplit: () => `split-${n++}` });
    const panes = layoutTree(real, { x: 0, y: 0, ...size }).panes;
    return Object.fromEntries(
        paneIds(real).map(id => {
            const content = contentOf(real, id)!;
            const rect = panes.get(id)!;
            return [content.kind === 'tool' ? content.tool : content.kind, { width: rect.width, height: rect.height }];
        })
    );
}

const ALL: ToolId[] = ['chat', 'worlds', 'hiscores', 'timers'];

test('a server with every tool has all three built-ins, in order', () => {
    const setups = builtInSetups({ tools: ALL, gameHeight: GAME_PREFERRED_HEIGHT });
    assert.deepEqual(
        setups.map(s => [s.id, s.name]),
        [
            ['game', 'Game'],
            ['game-chat', 'Game and Chat'],
            ['game-chat-tools', 'Game, Chat and Tools']
        ]
    );
});

test('Game is the game alone at its preferred size', () => {
    const [game] = builtInSetups({ tools: ALL, gameHeight: GAME_PREFERRED_HEIGHT });
    assert.deepEqual(game!.size, { width: 765, height: GAME_PREFERRED_HEIGHT });
    assert.deepEqual(drawn(game!.tree, game!.size, ALL), { game: { width: 765, height: GAME_PREFERRED_HEIGHT } });
});

test('Game and Chat is what a new window opens with', () => {
    const setup = builtInSetups({ tools: ALL, gameHeight: GAME_PREFERRED_HEIGHT })[1]!;
    assert.deepEqual(setup.size, { width: 765, height: GAME_PREFERRED_HEIGHT + 4 + CHAT_PREFERRED_HEIGHT });
    assert.deepEqual(drawn(setup.tree, setup.size, ALL), {
        game: { width: 765, height: GAME_PREFERRED_HEIGHT },
        chat: { width: 765, height: CHAT_PREFERRED_HEIGHT }
    });
});

test("Game, Chat and Tools adds a 320px column of every other tool, in the window's order, sharing its height", () => {
    const setup = builtInSetups({ tools: ALL, gameHeight: GAME_PREFERRED_HEIGHT })[2]!;
    const height = GAME_PREFERRED_HEIGHT + 4 + CHAT_PREFERRED_HEIGHT;
    assert.deepEqual(setup.size, { width: 765 + 4 + 320, height });
    const panes = drawn(setup.tree, setup.size, ALL);
    assert.deepEqual(panes.game, { width: 765, height: GAME_PREFERRED_HEIGHT });
    assert.deepEqual(panes.chat, { width: 765, height: CHAT_PREFERRED_HEIGHT });
    assert.deepEqual(Object.keys(panes), ['game', 'chat', 'worlds', 'hiscores', 'timers']);
    for (const id of ['worlds', 'hiscores', 'timers']) assert.equal(panes[id]!.width, 320);
    const heights = ['worlds', 'hiscores', 'timers'].map(id => panes[id]!.height);
    assert.equal(heights.reduce((a, b) => a + b, 0) + 8, height, 'the column fills the height');
    assert.ok(Math.max(...heights) - Math.min(...heights) <= 1, 'evenly');
});

test('a tool the window does not offer is left out, not left empty', () => {
    const tools: ToolId[] = ['chat', 'timers', 'singleplayer'];
    const setup = builtInSetups({ tools, gameHeight: GAME_PREFERRED_HEIGHT }).find(s => s.id === 'game-chat-tools')!;
    assert.deepEqual(Object.keys(drawn(setup.tree, setup.size, tools)), ['game', 'chat', 'timers', 'singleplayer']);
});

test('one other tool is the column itself', () => {
    const tools: ToolId[] = ['chat', 'timers'];
    const setup = builtInSetups({ tools, gameHeight: GAME_PREFERRED_HEIGHT }).find(s => s.id === 'game-chat-tools')!;
    const panes = drawn(setup.tree, setup.size, tools);
    assert.deepEqual(panes.timers, { width: 320, height: setup.size.height });
});

test('a window with no tool but chat has no tools setup', () => {
    assert.deepEqual(
        builtInSetups({ tools: ['chat'], gameHeight: GAME_PREFERRED_HEIGHT }).map(s => s.id),
        ['game', 'game-chat']
    );
});

test('a window without chat has no Game and Chat, and puts its tools beside the game', () => {
    const tools: ToolId[] = ['timers'];
    const setups = builtInSetups({ tools, gameHeight: GAME_PREFERRED_HEIGHT });
    assert.deepEqual(setups.map(s => s.name), ['Game', 'Game and Tools']);
    const panes = drawn(setups[1]!.tree, setups[1]!.size, tools);
    assert.deepEqual(panes, { game: { width: 765, height: GAME_PREFERRED_HEIGHT }, timers: { width: 320, height: GAME_PREFERRED_HEIGHT } });
});

test("Lost City's built-ins are drawn for its taller game", () => {
    const setups = builtInSetups({ tools: ALL, gameHeight: LOSTCITY_GAME_PREFERRED_HEIGHT });
    for (const setup of setups) assert.equal(drawn(setup.tree, setup.size, ALL).game!.height, LOSTCITY_GAME_PREFERRED_HEIGHT, setup.id);
});

const BUILT = builtInSetups({ tools: ALL, gameHeight: GAME_PREFERRED_HEIGHT });
/** The game with a column of timers beside it, saved at 1169x567. */
const SKILLING = writeLayout(split('s', 'x', [leaf('a', { kind: 'game' }), leaf('b', { kind: 'tool', tool: 'timers' })], [765 / 1165, 400 / 1165]), 'lostcity', { width: 1169, height: 567 });
/** A page reader with no game in it. */
const WIKI = writeLayout(leaf('a', { kind: 'empty' }), 'lostcity', { width: 400, height: 600 });
/** A setup saved before setups carried a size. */
const OLD = writeLayout(leaf('a', { kind: 'game' }), 'lostcity');
const FILES: Record<string, string> = { 'skilling.json': SKILLING, 'wiki.json': WIKI, 'old.json': OLD, 'broken.json': 'not json' };
const SAVED = ['broken.json', 'gone.json', 'old.json', 'skilling.json', 'wiki.json'].map(file => ({ name: file.replace(/\.json$/, ''), file }));
const OPTS = { builtIns: BUILT, saved: SAVED, read: (file: string): string | null => FILES[file] ?? null };
const GAME_AND_CHAT = { builtIn: 'game-chat' } as const;

test('with nothing chosen a new window opens as Game and Chat, as it always has', () => {
    const opening = openingSetup(null, OPTS);
    const gameChat = BUILT.find(s => s.id === 'game-chat')!;
    assert.deepEqual(opening, { tree: gameChat.tree, size: gameChat.size, name: 'Game and Chat', used: GAME_AND_CHAT, fellBack: null });
});

test('a built-in chosen is the one a new window opens with', () => {
    const opening = openingSetup({ builtIn: 'game-chat-tools' }, OPTS);
    assert.equal(opening.name, 'Game, Chat and Tools');
    assert.deepEqual(opening.used, { builtIn: 'game-chat-tools' });
    assert.equal(opening.fellBack, null);
});

test('a built-in this window does not offer opens Game and Chat instead, and says why', () => {
    const chatOnly = builtInSetups({ tools: ['chat'], gameHeight: GAME_PREFERRED_HEIGHT });
    const opening = openingSetup({ builtIn: 'game-chat-tools' }, { ...OPTS, builtIns: chatOnly });
    assert.deepEqual(opening.used, GAME_AND_CHAT);
    assert.match(opening.fellBack ?? '', /does not offer/);
});

test('a saved setup opens at the size it was saved at, under its file’s name', () => {
    const opening = openingSetup({ file: 'skilling.json' }, OPTS);
    assert.equal(opening.name, 'skilling');
    assert.deepEqual(opening.size, { width: 1169, height: 567 });
    assert.deepEqual(opening.used, { file: 'skilling.json' });
    assert.equal(opening.fellBack, null);
    assert.equal(opening.tree.kind, 'split');
});

test('a saved setup renamed or removed from the folder opens Game and Chat, and says it is gone', () => {
    const opening = openingSetup({ file: 'pking.json' }, OPTS);
    assert.deepEqual(opening.used, GAME_AND_CHAT);
    assert.match(opening.fellBack ?? '', /pking\.json is not in the setups folder/);
});

test('a saved setup with no game in it cannot open a game window', () => {
    const opening = openingSetup({ file: 'wiki.json' }, OPTS);
    assert.deepEqual(opening.used, GAME_AND_CHAT);
    assert.match(opening.fellBack ?? '', /holds no game/);
});

test('a file that cannot be read, or is not a setup, opens Game and Chat', () => {
    assert.match(openingSetup({ file: 'gone.json' }, OPTS).fellBack ?? '', /could not be read/);
    assert.match(openingSetup({ file: 'broken.json' }, OPTS).fellBack ?? '', /is not a setup/);
});

test('a saved setup from before setups carried a size opens with none, to be laid out by its fractions', () => {
    const opening = openingSetup({ file: 'old.json' }, OPTS);
    assert.equal(opening.size, null);
    assert.equal(opening.fellBack, null);
});

test('only a setup holding the game can be what new windows open with', () => {
    assert.equal(opensWindow(SKILLING), true);
    assert.equal(opensWindow(OLD), true);
    assert.equal(opensWindow(WIKI), false);
    assert.equal(opensWindow('not json'), false);
    assert.equal(opensWindow(''), false);
});

test('a stored choice is a built-in the kit knows, or a file name in the folder and nothing more', () => {
    assert.deepEqual(readNewWindowSetup({ builtIn: 'game' }), { builtIn: 'game' });
    assert.deepEqual(readNewWindowSetup({ file: 'skilling.json' }), { file: 'skilling.json' });
    assert.deepEqual(readNewWindowSetup({ file: `${'a'.repeat(250)}.json` }), { file: `${'a'.repeat(250)}.json` });
    for (const bad of [
        { builtIn: 'everything' },
        { file: '../../state.json' },
        { file: 'sub/x.json' },
        { file: 'sub\\x.json' },
        { file: '.hidden.json' },
        { file: 'notes.txt' },
        { file: '' },
        { file: `${'a'.repeat(251)}.json` },
        { file: 7 },
        'game',
        null
    ]) {
        assert.equal(readNewWindowSetup(bad), null, JSON.stringify(bad));
    }
});

test('stored choices are read one server at a time', () => {
    const read = readNewWindows({ lostcity: { builtIn: 'game' }, zanaris: { file: '../x.json' }, '': { builtIn: 'game' }, labs: 'game' });
    assert.deepEqual([...read.entries()], [['lostcity', { builtIn: 'game' }]]);
    assert.equal(readNewWindows(undefined).size, 0);
});

test('two choices are the same when they name the same built-in or the same file', () => {
    assert.equal(sameSetup({ builtIn: 'game' }, { builtIn: 'game' }), true);
    assert.equal(sameSetup({ builtIn: 'game' }, { builtIn: 'game-chat' }), false);
    assert.equal(sameSetup({ file: 'a.json' }, { file: 'a.json' }), true);
    assert.equal(sameSetup({ file: 'a.json' }, { builtIn: 'game' }), false);
});
