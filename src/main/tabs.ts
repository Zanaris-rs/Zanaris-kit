import { contentOf, leaf, paneIds, type PaneContent, type PaneNode } from './paneTree.ts';
import { TOOL_IDS, type ToolId } from '../shared/ipc.ts';

/**
 * A window's workspace tabs.
 *
 * Each is a whole arrangement — its own tree of panes and its own focus —
 * rather than a page in a strip. The window stays bound to one server for its
 * life, so a tab is a different *layout* of that server's things, not a
 * different server.
 *
 * Pure, like `paneTree` beside it, and for the same reason: which tab a close
 * lands on and what happens to the last one are exactly the corners a user
 * finds and a test should have.
 */

export interface Tab {
    id: string;
    tree: PaneNode;
    focusedPaneId: string;
}

export interface TabSet {
    tabs: Tab[];
    activeId: string;
}

/**
 * The set a new window starts with: one tab holding one pane.
 *
 * The content is handed in rather than assumed empty, because a window opens on
 * the game. There is no launcher window in this kit and never has been — the
 * File menu makes windows, and every one of them is a game window — so a new
 * window that came up showing a chooser would be a new kind of thing to
 * explain. A *tab* is the opposite case and does start empty: the arrangement
 * is the point of making one.
 */
export function openTabs(tabId: string, paneId: string, content: PaneContent): TabSet {
    return { tabs: [{ id: tabId, tree: leaf(paneId, content), focusedPaneId: paneId }], activeId: tabId };
}

export function newTab(set: TabSet, tabId: string, paneId: string): TabSet {
    return { tabs: [...set.tabs, { id: tabId, tree: leaf(paneId, { kind: 'empty' }), focusedPaneId: paneId }], activeId: tabId };
}

export function selectTab(set: TabSet, tabId: string): TabSet {
    if (set.activeId === tabId || !set.tabs.some(t => t.id === tabId)) return set;
    return { ...set, activeId: tabId };
}

export function closeTab(set: TabSet, tabId: string): TabSet | null {
    const at = set.tabs.findIndex(t => t.id === tabId);
    if (at < 0) return set;
    // The last tab closing is the window closing. Said by returning nothing
    // rather than by leaving an empty set, which would be a window with no
    // arrangement at all and nothing to draw.
    if (set.tabs.length === 1) return null;
    const tabs = set.tabs.filter(t => t.id !== tabId);
    if (set.activeId !== tabId) return { ...set, tabs };
    // The tab that took its place, or the one to its left when it was last.
    // One of the two always exists, because the list is not empty.
    const next = tabs[at] ?? tabs[at - 1]!;
    return { tabs, activeId: next.id };
}

/**
 * What a tab button says.
 *
 * A tab holding the game is named for it whatever has focus. Naming every tab
 * after its focused pane reads fine until you use one: clicking between the
 * game and the chat beside it renamed the tab on every click, which makes the
 * bar move under the pointer for no reason the user asked for. The game is the
 * one thing in a tab stable enough to name it after, and the dot beside the
 * name is for finding it from another tab rather than for reading this one.
 */
export function labelOfTab(tree: PaneNode, focusedPaneId: string): string {
    if (paneIds(tree).some(id => contentOf(tree, id)?.kind === 'game')) return 'Game';
    const content = contentOf(tree, focusedPaneId);
    switch (content?.kind) {
        case 'tool':
            return content.tool === 'singleplayer' ? 'Single player' : content.tool[0]!.toUpperCase() + content.tool.slice(1);
        case 'page':
            return 'Page';
        default:
            return 'Empty';
    }
}

/**
 * A stored layout, or null when anything at all about it is wrong.
 *
 * Null rather than a repair, and one null for the whole file rather than per
 * tab: this runs before the first window paints, so a half-understood layout is
 * a window that opens wrong with nothing to say about why. A fresh game window
 * is a fine thing to fall back to and an obvious one to notice. `state.json` is
 * also a file the user is invited to edit by hand, so it is untrusted input in
 * the ordinary sense as well.
 *
 * The refusals that are not merely shape: a pane id must be unique, because a
 * view is keyed by it and two panes claiming one would share a view; and one
 * game at most, because the window has exactly one game view and a second leaf
 * would point at nothing.
 */
export function readTabSet(x: unknown): TabSet | null {
    if (typeof x !== 'object' || x === null) return null;
    const { tabs, activeId } = x as { tabs?: unknown; activeId?: unknown };
    if (!Array.isArray(tabs) || tabs.length === 0 || typeof activeId !== 'string') return null;

    const seen = new Set<string>();
    let games = 0;
    const read: Tab[] = [];
    for (const raw of tabs) {
        if (typeof raw !== 'object' || raw === null) return null;
        const { id, tree, focusedPaneId } = raw as { id?: unknown; tree?: unknown; focusedPaneId?: unknown };
        if (typeof id !== 'string' || id === '' || typeof focusedPaneId !== 'string') return null;
        const node = readNode(tree, seen, () => games++);
        if (!node || !paneIds(node).includes(focusedPaneId)) return null;
        read.push({ id, tree: node, focusedPaneId });
    }
    if (games > 1) return null;
    if (!read.some(tab => tab.id === activeId)) return null;
    // Two tabs answering to one id would make `selectTab` ambiguous.
    if (new Set(read.map(tab => tab.id)).size !== read.length) return null;
    return { tabs: read, activeId };
}

function readNode(x: unknown, seen: Set<string>, countGame: () => void): PaneNode | null {
    if (typeof x !== 'object' || x === null) return null;
    const node = x as Record<string, unknown>;

    if (node.kind === 'leaf') {
        const { paneId, content } = node as { paneId?: unknown; content?: unknown };
        if (typeof paneId !== 'string' || paneId === '' || seen.has(paneId)) return null;
        seen.add(paneId);
        const read = readContent(content);
        if (!read) return null;
        if (read.kind === 'game') countGame();
        return leaf(paneId, read);
    }

    if (node.kind !== 'split') return null;
    const { splitId, axis, children, fractions } = node as { splitId?: unknown; axis?: unknown; children?: unknown; fractions?: unknown };
    if (typeof splitId !== 'string' || splitId === '' || (axis !== 'x' && axis !== 'y')) return null;
    // Two children at least: a split of one is the thing `collapse` exists to
    // prevent, so one arriving off disk is a file that has been edited into a
    // state the app cannot reach on its own.
    if (!Array.isArray(children) || children.length < 2) return null;
    if (!Array.isArray(fractions) || fractions.length !== children.length) return null;
    if (!fractions.every(f => typeof f === 'number' && Number.isFinite(f) && f > 0)) return null;
    const read: PaneNode[] = [];
    for (const child of children) {
        const node = readNode(child, seen, countGame);
        if (!node) return null;
        read.push(node);
    }
    // Renormalised rather than required to sum to 1: floats that went through
    // JSON need not come back summing to exactly 1, and the solver wants a
    // proportion rather than a total.
    const total = fractions.reduce((sum: number, f: number) => sum + f, 0);
    return { kind: 'split', splitId, axis, children: read, fractions: fractions.map((f: number) => f / total) };
}

function readContent(x: unknown): PaneContent | null {
    if (typeof x !== 'object' || x === null) return null;
    const content = x as Record<string, unknown>;
    if (content.kind === 'empty' || content.kind === 'game') return { kind: content.kind };
    if (content.kind === 'page') return typeof content.bookmark === 'string' && content.bookmark !== '' ? { kind: 'page', bookmark: content.bookmark } : null;
    if (content.kind !== 'tool') return null;
    return (TOOL_IDS as readonly string[]).includes(content.tool as string) ? { kind: 'tool', tool: content.tool as ToolId } : null;
}

/**
 * Where the id counters have to resume so a restored layout cannot be handed an
 * id something in it already answers to.
 *
 * Splits start from 1 regardless: `splitId` is only ever matched against the
 * tree the shell was just sent, so a collision with a restored one would need a
 * seam drag to arrive naming a split that had been replaced between the push
 * and the click. Panes and tabs are different — a view is keyed by a pane id for
 * as long as it lives.
 */
export function nextIds(set: TabSet): { pane: number; tab: number; split: number } {
    const after = (values: string[], prefix: string): number =>
        values.reduce((top, value) => {
            const n = value.startsWith(prefix) ? Number(value.slice(prefix.length)) : NaN;
            return Number.isInteger(n) && n >= top ? n + 1 : top;
        }, 1);
    return {
        pane: after(set.tabs.flatMap(tab => paneIds(tab.tree)), 'pane-'),
        tab: after(set.tabs.map(tab => tab.id), 'tab-'),
        split: 1
    };
}
