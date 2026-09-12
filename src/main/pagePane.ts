import { PAGE_WIDTH_MIN } from '../shared/layout.ts';

/**
 * The reference pane: which LostHQ pages this window has open, which one is in
 * front, whether the pane is showing at all, and how wide it is.
 *
 * It is a pure reducer over a small state, in a file with no Electron import,
 * for the same reason `chatDock.ts` is: the rules have corners, and a corner
 * found by a user instead of a test is a window that looks broken for no
 * reason anyone can point at. Closing the leftmost tab, clicking a link that
 * is already open, collapsing and restoring — each is one line here and one
 * assertion in the test beside it.
 *
 * The other half of the reason is the feature's whole promise. A tab's view is
 * created when its id appears here and destroyed when its id leaves, and
 * nothing else touches it; switching tabs only moves `activeId`. So a page
 * cannot reload on a switch, because there is no code path that would reload
 * it — the guarantee is structural rather than remembered.
 */

export interface PageTab {
    id: string;
    /**
     * The catalog bookmark this tab was opened from. Immutable, and the key
     * clicking a link dedupes on — never the live url, which drifts: LostHQ
     * answers `?p=droptables` with a redirect to `?p=npcdb`, and
     * `tools.losthq.rs/map` with one to `/map/`, so a second click would open
     * a second tab on the same page.
     */
    bookmark: string;
    /** The link's curated name. What the strip shows, whatever the page calls itself. */
    label: string;
    /** Where the view actually is now, and what the page calls itself. The toolbar's, not the strip's. */
    url: string;
    title: string;
    canGoBack: boolean;
    canGoForward: boolean;
    loading: boolean;
}

export interface PaneState {
    tabs: PageTab[];
    activeId: string | null;
    /** Hidden, not closed: the views stay alive and the pane costs the layout nothing. */
    collapsed: boolean;
    width: number;
    /** Monotonic, so a closed tab's id is never handed to a later one. */
    nextId: number;
}

export type PaneAction =
    | { kind: 'open'; bookmark: string; label: string }
    | { kind: 'activate'; id: string }
    | { kind: 'close'; id: string }
    | { kind: 'set-collapsed'; collapsed: boolean }
    | { kind: 'resize'; width: number }
    | { kind: 'navigated'; id: string; url: string; title: string; canGoBack: boolean; canGoForward: boolean }
    | { kind: 'loading'; id: string; loading: boolean };

export function initialPane(width: number): PaneState {
    return { tabs: [], activeId: null, collapsed: false, width, nextId: 1 };
}

/** The pane is open exactly while it has a tab. There is no second flag to drift from that. */
export function paneOpen(state: PaneState): boolean {
    return state.tabs.length > 0;
}

/** What the pane costs the layout: its width while it is showing, nothing while it is closed or collapsed. */
export function paneLayoutWidth(state: PaneState): number {
    return paneOpen(state) && !state.collapsed ? state.width : 0;
}

export function activeTab(state: PaneState): PageTab | null {
    return state.tabs.find(t => t.id === state.activeId) ?? null;
}

/**
 * Replaces one tab, or returns the state untouched when the named tab is gone
 * or the fields already say what the update says.
 *
 * The second half is not a nicety. `did-navigate-in-page` fires on every hash
 * change, and the clue coordinator changes its hash as you click around the
 * map, so a reducer that returned a fresh object each time would have main
 * serialising and pushing a whole ShellState per click.
 */
function patch(state: PaneState, id: string, fields: Partial<PageTab>): PaneState {
    const index = state.tabs.findIndex(t => t.id === id);
    if (index < 0) return state;
    const tab = state.tabs[index]!;
    // Undefined means "this update says nothing about that field", which is
    // what Partial reads as everywhere else — not "blank it". Spreading the
    // object raw would blank it, and the equality guard above would wave the
    // blanking through on any tab that happened to be undefined already.
    const moved = Object.entries(fields).filter(([key, value]) => value !== undefined && tab[key as keyof PageTab] !== value);
    if (moved.length === 0) return state;
    const tabs = [...state.tabs];
    tabs[index] = { ...tab, ...Object.fromEntries(moved) };
    return { ...state, tabs };
}

/** `limits.maxWidth` is main's: only main can see which display the window is on. */
export function reduce(state: PaneState, action: PaneAction, limits: { maxWidth: number }): PaneState {
    switch (action.kind) {
        case 'open': {
            // Clicking a link already open brings it to the front rather than
            // opening a second copy of it — the list is a set of destinations,
            // not a queue of requests.
            const existing = state.tabs.find(t => t.bookmark === action.bookmark);
            if (existing) {
                if (state.activeId === existing.id && !state.collapsed) return state;
                return { ...state, activeId: existing.id, collapsed: false };
            }
            const tab: PageTab = {
                id: `page-${state.nextId}`,
                bookmark: action.bookmark,
                label: action.label,
                url: action.bookmark,
                title: action.label,
                canGoBack: false,
                canGoForward: false,
                loading: true
            };
            return { ...state, tabs: [...state.tabs, tab], activeId: tab.id, nextId: state.nextId + 1, collapsed: false };
        }

        case 'activate': {
            if (!state.tabs.some(t => t.id === action.id)) return state;
            if (state.activeId === action.id && !state.collapsed) return state;
            return { ...state, activeId: action.id, collapsed: false };
        }

        case 'close': {
            const index = state.tabs.findIndex(t => t.id === action.id);
            if (index < 0) return state;
            const tabs = state.tabs.filter(t => t.id !== action.id);
            if (tabs.length === 0) {
                // The pane is gone, so a collapse it was carrying goes with it:
                // the next link opened must not arrive already hidden.
                return { ...state, tabs, activeId: null, collapsed: false };
            }
            if (state.activeId !== action.id) return { ...state, tabs };
            // The tab that took its place, or the one to its left when it was
            // the last in the row. One of the two always exists, because the
            // list is not empty.
            const next = tabs[index] ?? tabs[index - 1]!;
            return { ...state, tabs, activeId: next.id };
        }

        case 'set-collapsed':
            // A pane with no tabs has nothing to hide, and letting it hold a
            // collapse would leave the one state this file exists to prevent:
            // the next link opened arriving already hidden. `open` clears it
            // anyway; refusing it here means it is never reachable at all.
            if (state.tabs.length === 0 || state.collapsed === action.collapsed) return state;
            return { ...state, collapsed: action.collapsed };

        case 'resize': {
            const width = Math.round(Math.min(Math.max(action.width, PAGE_WIDTH_MIN), Math.max(PAGE_WIDTH_MIN, limits.maxWidth)));
            return width === state.width ? state : { ...state, width };
        }

        case 'navigated':
            return patch(state, action.id, {
                url: action.url,
                title: action.title,
                canGoBack: action.canGoBack,
                canGoForward: action.canGoForward
            });

        case 'loading':
            return patch(state, action.id, { loading: action.loading });
    }
}
