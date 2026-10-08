import { layoutEntries, readSetup, type StoredNode } from './layoutFile.ts';
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
 *
 * Any of them, or a saved setup, can be what new windows of a server open
 * with (`openingSetup`), which is decided here for the same reason.
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
 * - **Game and Chat**: the game over chat, which a new window opens with when
 *   no other setup is chosen for it (`openingSetup`).
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

/**
 * What new windows of a server open with: a built-in, or a saved setup by
 * its name in that server's setups folder. Stored per server in `state.json`
 * (`AppState.newWindowSetup`), and chosen from the Setups menu's Open New
 * Windows With. A server with none opens Game and Chat.
 *
 * A file is a name, never a path. It is looked up in the folder's own
 * listing when a window opens (`openingSetup`), so nothing stored is ever
 * joined into a path, and a name that could reach outside the folder is
 * dropped as `state.json` is read.
 */
export type NewWindowSetup = { builtIn: BuiltInSetupId } | { file: string };

const BUILT_IN_IDS: readonly BuiltInSetupId[] = ['game', 'game-chat', 'game-chat-tools'];
/** The longest file name the three platforms' file systems allow. */
const FILE_NAME_MAX = 255;

/** One stored choice, or null when it is not one: a built-in this kit does not know, or a name the folder's listing would never return. */
export function readNewWindowSetup(x: unknown): NewWindowSetup | null {
    if (typeof x !== 'object' || x === null) return null;
    const choice = x as Record<string, unknown>;
    if (typeof choice.builtIn === 'string') return (BUILT_IN_IDS as readonly string[]).includes(choice.builtIn) ? { builtIn: choice.builtIn as BuiltInSetupId } : null;
    const file = choice.file;
    if (typeof file !== 'string' || file.length > FILE_NAME_MAX || /[/\\\u0000]/.test(file)) return null;
    return layoutEntries([file]).length === 1 ? { file } : null;
}

/** The stored choices, per server id, read one server at a time. */
export function readNewWindows(x: unknown): Map<string, NewWindowSetup> {
    const choices = new Map<string, NewWindowSetup>();
    if (typeof x !== 'object' || x === null || Array.isArray(x)) return choices;
    for (const [id, value] of Object.entries(x as Record<string, unknown>)) {
        const choice = id === '' ? null : readNewWindowSetup(value);
        if (choice) choices.set(id, choice);
    }
    return choices;
}

export function sameSetup(a: NewWindowSetup, b: NewWindowSetup): boolean {
    if ('builtIn' in a) return 'builtIn' in b && a.builtIn === b.builtIn;
    return 'file' in b && a.file === b.file;
}

function holdsGame(node: StoredNode): boolean {
    return node.kind === 'leaf' ? node.content.kind === 'game' : node.children.some(holdsGame);
}

/** Whether a saved setup's text can be what new windows open with: a setup, holding the game, since a game window opens onto its game. */
export function opensWindow(text: string): boolean {
    const setup = readSetup(text);
    return setup !== null && holdsGame(setup.tree);
}

/** What a new window opens with. */
export interface OpeningSetup {
    tree: StoredNode;
    /** The tab size it was made at, or null for a saved setup from before setups carried one, laid out by its fractions. */
    size: Size | null;
    /** As the log names it: a built-in's name, or the file's without `.json`. */
    name: string;
    /** The choice it opened with: the one asked for, or Game and Chat when that could not be used. What the menu ticks. */
    used: NewWindowSetup;
    /** Why the choice asked for could not be used, or null when it was. */
    fellBack: string | null;
}

/**
 * The setup a new window opens with, from its server's stored `choice`.
 *
 * `saved` is the folder's listing (`layoutFile.layoutEntries`), and `read`
 * reads one of its entries, null when it cannot: injected, so a test never
 * touches a folder, and so a stored name is only ever opened as an entry the
 * listing returned. Anything that cannot be used — a built-in this window
 * does not offer, a file gone from the folder, one that is not a setup or
 * holds no game — opens Game and Chat, with the reason.
 */
export function openingSetup(
    choice: NewWindowSetup | null,
    opts: { builtIns: readonly BuiltInSetup[]; saved: readonly { name: string; file: string }[]; read: (file: string) => string | null }
): OpeningSetup {
    const builtIn = (setup: BuiltInSetup, fellBack: string | null): OpeningSetup => ({ tree: setup.tree, size: setup.size, name: setup.name, used: { builtIn: setup.id }, fellBack });
    // Every window has chat, so Game and Chat is always there; Game, which is
    // always first, only stands in should a window ever have no chat.
    const fallback = (reason: string | null): OpeningSetup => builtIn(opts.builtIns.find(s => s.id === 'game-chat') ?? opts.builtIns[0]!, reason);
    if (choice === null) return fallback(null);
    if ('builtIn' in choice) {
        const setup = opts.builtIns.find(s => s.id === choice.builtIn);
        return setup ? builtIn(setup, null) : fallback(`this window does not offer ${choice.builtIn}`);
    }
    const entry = opts.saved.find(e => e.file === choice.file);
    if (!entry) return fallback(`${choice.file} is not in the setups folder`);
    const text = opts.read(entry.file);
    if (text === null) return fallback(`${entry.file} could not be read`);
    const setup = readSetup(text);
    if (!setup) return fallback(`${entry.file} is not a setup`);
    if (!holdsGame(setup.tree)) return fallback(`${entry.file} holds no game`);
    return { tree: setup.tree, size: setup.size, name: entry.name, used: { file: entry.file }, fellBack: null };
}
