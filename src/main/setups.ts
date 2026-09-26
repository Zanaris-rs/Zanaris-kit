import type { StoredNode } from './layoutFile.ts';
import type { Size } from './paneTree.ts';
import type { ToolId } from '../shared/ipc.ts';
import { CHAT_PREFERRED_HEIGHT, COLUMN_PREFERRED_WIDTH, GAME_PREFERRED_WIDTH, SEAM } from '../shared/layout.ts';

/**
 * The setups the kit ships: the shapes a window is most often wanted in,
 * one click from the tab bar's Setups menu.
 *
 * Pure, and made per window rather than fixed, because what a built-in holds
 * depends on what the window offers. A built-in leaves out a tool the window
 * does not have — Hiscores on a server with no lookup — rather than showing an
 * empty pane where it would have been: a built-in is the kit's promise of a
 * shape, and a hole in it would read as broken. A saved setup is somebody's
 * file and keeps `instantiateLayout`'s empty pane, which says what is missing.
 *
 * Each comes with the size of tab it was drawn for, in pixels, so opening one
 * can size the window around the game (`paneTree.arrangeForGame`) exactly as
 * a saved setup's own size does.
 */

export type BuiltInSetupId = 'game' | 'game-chat' | 'game-chat-tools';

export interface BuiltInSetup {
    id: BuiltInSetupId;
    /** As the Setups menu shows it. */
    name: string;
    tree: StoredNode;
    size: Size;
}

const GAME: StoredNode = { kind: 'leaf', content: { kind: 'game' } };
const tool = (id: ToolId): StoredNode => ({ kind: 'leaf', content: { kind: 'tool', tool: id } });

/** Children laid along one axis at these pixel sizes, as a split whose fractions lay them out at exactly those sizes. One child is that child. */
function stack(axis: 'x' | 'y', children: StoredNode[], sizes: number[]): StoredNode {
    if (children.length === 1) return children[0]!;
    const gross = sizes.reduce((sum, px) => sum + px, 0);
    return { kind: 'split', axis, children, fractions: sizes.map(px => px / gross) };
}

/**
 * The built-ins this window can offer, in the menu's order.
 *
 * - **Game**: the game alone, at its preferred size.
 * - **Game and Chat**: the game over chat, as a new window opens.
 * - **Game, Chat and Tools**: that, with a column down its right holding every
 *   other tool the window offers, in the window's own order, sharing the
 *   column's height evenly.
 *
 * `gameHeight` is the game pane's preferred height, which is the stock one
 * unless the server's client page needs more. A window without chat has no
 * Game and Chat, and its tools setup puts the column beside the game alone; a
 * window with no tool but chat has no tools setup.
 */
export function builtInSetups(opts: { tools: readonly ToolId[]; gameHeight: number }): BuiltInSetup[] {
    const width = GAME_PREFERRED_WIDTH;
    const chat = opts.tools.includes('chat');
    const left = chat ? stack('y', [GAME, tool('chat')], [opts.gameHeight, CHAT_PREFERRED_HEIGHT]) : GAME;
    const height = chat ? opts.gameHeight + SEAM + CHAT_PREFERRED_HEIGHT : opts.gameHeight;
    const others = opts.tools.filter(id => id !== 'chat');
    const setups: BuiltInSetup[] = [{ id: 'game', name: 'Game', tree: GAME, size: { width, height: opts.gameHeight } }];
    if (chat) setups.push({ id: 'game-chat', name: 'Game and Chat', tree: left, size: { width, height } });
    if (others.length > 0) {
        const gross = height - SEAM * (others.length - 1);
        const column = stack('y', others.map(tool), others.map(() => gross / others.length));
        setups.push({
            id: 'game-chat-tools',
            name: chat ? 'Game, Chat and Tools' : 'Game and Tools',
            tree: stack('x', [left, column], [width, COLUMN_PREFERRED_WIDTH]),
            size: { width: width + SEAM + COLUMN_PREFERRED_WIDTH, height }
        });
    }
    return setups;
}
