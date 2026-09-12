import { contentOf, leaf, paneIds, type PaneContent, type PaneNode } from './paneTree.ts';

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
