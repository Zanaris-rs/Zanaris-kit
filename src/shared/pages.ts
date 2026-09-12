/** What the reference pane shows, as the shell needs to draw it. */

export interface PageTabInfo {
    id: string;
    /** The catalog link this tab was opened from. The Guides list marks its own rows with it. */
    bookmark: string;
    /** The link's curated name. The strip shows this, never the page's own title: eight of LostHQ's eleven pages call themselves the same thing. */
    label: string;
    active: boolean;
}

/** The active page, as its toolbar reads it. */
export interface PageView {
    title: string;
    url: string;
    canGoBack: boolean;
    canGoForward: boolean;
    loading: boolean;
}

export interface PagesView {
    tabs: PageTabInfo[];
    /** Hidden but alive: the views are still there and nothing has reloaded. */
    collapsed: boolean;
    /**
     * The width the pane is actually drawn at, which is not always the width
     * asked for: a display too narrow for game, pane, panel and rail at once
     * has the layout claw some of it back. The seam shows and moves this one,
     * or its first drag would spend itself asking for widths already refused.
     */
    width: number;
    /** The widest main will allow on this window's display, so the seam can announce a real ceiling rather than estimate one. */
    maxWidth: number;
    /** Null while the pane is closed or collapsed. */
    active: PageView | null;
}
