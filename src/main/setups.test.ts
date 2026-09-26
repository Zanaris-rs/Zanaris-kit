import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builtInSetups } from './setups.ts';
import { instantiateLayout, type StoredNode } from './layoutFile.ts';
import { contentOf, layoutTree, paneIds, type PaneNode } from './paneTree.ts';
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
