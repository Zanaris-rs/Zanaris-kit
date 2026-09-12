import { leaf, type PaneNode } from './paneTree.ts';

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

/** The set a new window starts with: one tab holding one empty pane. */
export function openTabs(tabId: string, paneId: string): TabSet {
    return { tabs: [{ id: tabId, tree: leaf(paneId, { kind: 'empty' }), focusedPaneId: paneId }], activeId: tabId };
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
