/** What a tab's panes look like to the shell, which draws the chrome around them. */
import type { PaneContent, Rect } from '../main/paneTree.ts';
import type { PaneContentItem } from '../main/paneMenu.ts';
import type { DropTargets, DropZone } from '../main/paneDrop.ts';

export type { DropTargets, DropZone, PaneContent, PaneContentItem, Rect };

/** A page pane's own navigation state, as its toolbar reads it. One per page leaf, not one per window. */
export interface PageState {
    url: string;
    title: string;
    canGoBack: boolean;
    canGoForward: boolean;
    loading: boolean;
}

export interface PaneView {
    paneId: string;
    /** Where main put it, relative to the window's content area. The shell draws tool and empty panes here and leaves game and page rects alone. */
    rect: Rect;
    content: PaneContent;
    /** What the pane's header calls it. Main's, not the shell's: resolving a page's bookmark to its curated name is a rule. */
    name: string;
    focused: boolean;
    /** Whether the header's close would do anything — false only for a tab's lone pane that is already empty. Main's, from `paneMenu.canClosePane`, which the right-click menu asks too. */
    closable: boolean;
    /** Null unless `content.kind === 'page'`. */
    page: PageState | null;
    /**
     * What this pane could become, for the launcher an empty one shows. Null
     * for every other kind, which reaches the same list through the header's
     * dropdown — that one is a native menu main builds on the spot, because a
     * list drawn by the shell would be hidden by the view below the header.
     */
    contents: PaneContentItem[] | null;
}

export interface SeamView {
    splitId: string;
    /** The seam sits after this child, so dragging it moves children `index` and `index + 1`. */
    index: number;
    axis: 'x' | 'y';
    rect: Rect;
    /**
     * The pane before the seam, in pixels: where it is now and how far it may
     * travel. `Grip` drags a boundary rather than a ratio, so the tree does the
     * conversion and the shell never has to know about fractions, minimums or
     * how many seams a split contains.
     */
    size: number;
    min: number;
    max: number;
    /** The px the split divides, seams already taken off. Sent back with a drag so main can refuse a stale one. */
    gross: number;
}

export interface TabView {
    id: string;
    /** What the tab button says: its first pane's name, as that pane's header says it. */
    label: string;
    active: boolean;
}
