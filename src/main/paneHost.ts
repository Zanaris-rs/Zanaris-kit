import { WebContentsView, shell, type BrowserWindow } from 'electron';
import { decidePageNavigation } from './guard.ts';
import {
    closePane,
    contentOf,
    evenOut,
    layoutTree,
    leaf,
    paneIds,
    seamPixels,
    setContent,
    setSeam,
    splitPane,
    type PaneContent,
    type PaneNode,
    type Rect
} from './paneTree.ts';
import { PANE_HEADER_HEIGHT } from '../shared/layout.ts';
import { paneContentItems, paneName } from './paneMenu.ts';
import { closeTab, labelOfTab, moveGame, newTab, nextIds, openTabs, selectTab, type TabSet } from './tabs.ts';
import type { ToolId } from '../shared/ipc.ts';
import type { PageState, PaneView, SeamView, TabView } from '../shared/panes.ts';

/**
 * One tab's panes, and the native views inside them.
 *
 * The tree and every rule about it live in `paneTree.ts`, which is pure and
 * tested; this is the half that cannot be — it creates `WebContentsView`s,
 * gives them bounds, and destroys them. The division is the same one
 * `CLAUDE.md` asks for everywhere else: anything decidable is next door, and
 * what is left here is reconciliation.
 *
 * A page view is created when a page leaf appears in the tree and destroyed
 * when it leaves, and nothing else touches one. So moving focus, dragging a
 * seam or switching tab cannot reload a page, because there is no code path
 * here that would — the guarantee is structural rather than remembered, which
 * is what `pagePane.ts` bought before this and what this has to keep.
 */

/**
 * One session for every reference page in every window, so a LostHQ login is
 * shared rather than asked for again per window. It is deliberately not the
 * game's partition: nothing a guide page does should be able to touch the
 * cookies the player is logged in with.
 */
const PAGES_PARTITION = 'persist:pages';

export interface PaneHostDeps {
    window: BrowserWindow;
    /** The live game view, or null when there is no game running. Positioned here, owned by the window. */
    gameView: () => WebContentsView | null;
    /** This server's own links. A page pane may hold nothing else. */
    bookmarks: () => readonly { url: string; name: string }[];
    /** The tools this window offers, in rail order — the first half of what a pane's header offers to become. */
    tools: () => readonly ToolId[];
    hosts: () => readonly string[];
    log: (line: string) => void;
    /** The layout this server's windows were last left in, or null to open fresh on the game. */
    remembered: TabSet | null;
    /** The tree's shape changed: lay the window out again and push state. */
    changed: () => void;
    /** The arrangement moved. Staged, not written: a seam drag lands one of these per animation frame. */
    remember: (set: TabSet) => void;
    /** Nothing geometric moved — a title, a back button. Push state only. */
    touched: () => void;
    /** A right-click landed on a pane, in window coordinates. */
    contextMenu: (paneId: string, x: number, y: number) => void;
}

export function createPaneHost(deps: PaneHostDeps): PaneHost {
    let set: TabSet = deps.remembered ?? openTabs('tab-1', 'pane-1', { kind: 'game' });
    const resume = nextIds(set);
    let nextPane = resume.pane;
    let nextSplit = resume.split;
    let nextTab = resume.tab;

    const active = (): PaneNode => set.tabs.find(t => t.id === set.activeId)!.tree;
    const focused = (): string => set.tabs.find(t => t.id === set.activeId)!.focusedPaneId;
    /** Every pane in every tab. View reconciliation works over this, not over the active tab: a page in a background tab stays alive, which is the whole point of a tab. */
    const allPaneIds = (): string[] => set.tabs.flatMap(tab => paneIds(tab.tree));
    const contentAnywhere = (paneId: string): PaneContent | null => {
        for (const tab of set.tabs) {
            const found = contentOf(tab.tree, paneId);
            if (found) return found;
        }
        return null;
    };
    /** Replaces the active tab's tree, leaving the others untouched. */
    const withActive = (tree: PaneNode, focus?: string): TabSet => ({
        ...set,
        tabs: set.tabs.map(tab => (tab.id === set.activeId ? { ...tab, tree, focusedPaneId: focus ?? tab.focusedPaneId } : tab))
    });

    const pageViews = new Map<string, WebContentsView>();
    const pageStates = new Map<string, PageState>();
    let rects = new Map<string, Rect>();
    let seams: SeamView[] = [];

    /**
     * Bounds and visibility for every native view.
     *
     * Only a view that is about to show is given bounds. A hidden Chromium view
     * still does the work of a resize, and during a seam drag that would be one
     * per open page per animation frame; the cost of waiting is a single reflow
     * when a pane that was hidden through a drag comes back.
     */
    function place(): void {
        const game = deps.gameView();
        const tree = active();
        const gamePane = paneIds(tree).find(id => contentOf(tree, id)?.kind === 'game');
        if (game) {
            // A game in a background tab has no rect, so it is hidden — and
            // keeps running, exactly as it does when the whole window is behind
            // another application. That is what `backgroundThrottling: false`
            // is for, and it is the one thing the tab design rests on that no
            // test here can prove.
            const rect = gamePane ? rects.get(gamePane) : undefined;
            if (rect) game.setBounds(below(rect));
            game.setVisible(Boolean(rect));
        }
        for (const [paneId, view] of pageViews) {
            const rect = rects.get(paneId);
            if (rect) view.setBounds(below(rect));
            view.setVisible(Boolean(rect));
        }
    }

    /**
     * A pane's rect less its header, which is the strip of shell drawn at the
     * top of it. Every native view is inset by this — the game's as much as a
     * page's — so the header always has the pane it names to sit in, and that
     * cost comes out of the pane rather than out of the window.
     *
     * Clamped, because a pane can end up shorter than its own header: under the
     * window's own floor the solver cuts every pane proportionally, and a
     * negative height is not something to hand `setBounds`.
     */
    function below(rect: Rect): Rect {
        const header = Math.min(PANE_HEADER_HEIGHT, rect.height);
        return { x: rect.x, y: rect.y + header, width: rect.width, height: rect.height - header };
    }

    /** The views, reconciled against the page leaves. The only thing that creates or destroys one. */
    function syncViews(): void {
        for (const paneId of allPaneIds()) {
            const content = contentAnywhere(paneId);
            if (content?.kind !== 'page' || pageViews.has(paneId)) continue;
            createPageView(paneId, content.bookmark);
        }
        for (const paneId of [...pageViews.keys()]) {
            if (contentAnywhere(paneId)?.kind !== 'page') destroyPageView(paneId);
        }
    }

    function destroyPageView(paneId: string): void {
        const view = pageViews.get(paneId);
        if (!view) return;
        pageViews.delete(paneId);
        pageStates.delete(paneId);
        if (!deps.window.isDestroyed()) deps.window.contentView.removeChildView(view);
        if (!view.webContents.isDestroyed()) view.webContents.close();
    }

    function createPageView(paneId: string, url: string): void {
        const view = new WebContentsView({
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                webSecurity: true,
                partition: PAGES_PARTITION
                // backgroundThrottling is left at Chromium's default, unlike the
                // game view: a reference page nobody is looking at should cost
                // nothing, and none of them has a loop that has to keep running.
            }
        });
        view.setBackgroundColor('#17120d');
        view.setVisible(false);
        deps.window.contentView.addChildView(view);
        pageViews.set(paneId, view);
        pageStates.set(paneId, { url, title: paneName({ kind: 'page', bookmark: url }, deps.bookmarks()), canGoBack: false, canGoForward: false, loading: true });

        const wc = view.webContents;
        // The toolbar's whole state, read from main rather than reported by a
        // preload: these views get none, which keeps "the shell is the only view
        // with a preload" true of the panes as well as of the game.
        const patch = (fields: Partial<PageState>): void => {
            const was = pageStates.get(paneId);
            if (!was) return;
            const moved = Object.entries(fields).filter(([key, value]) => value !== undefined && was[key as keyof PageState] !== value);
            if (moved.length === 0) return;
            pageStates.set(paneId, { ...was, ...Object.fromEntries(moved) });
            deps.touched();
        };
        const report = (): void => {
            if (deps.window.isDestroyed() || wc.isDestroyed()) return;
            patch({ url: wc.getURL(), title: wc.getTitle(), canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward() });
        };
        wc.on('page-title-updated', report);
        wc.on('did-navigate', report);
        // Fires on every hash change, and the clue coordinator changes its hash
        // as you click around the map. `patch` answers an update that says
        // nothing new by doing nothing, so these cost nothing.
        wc.on('did-navigate-in-page', report);
        wc.on('did-start-loading', () => patch({ loading: true }));
        wc.on('did-stop-loading', () => {
            patch({ loading: false });
            report();
        });
        wc.on('did-fail-load', (_event, code, description, failed, isMainFrame) => {
            // -3 is ERR_ABORTED: a load superseded by another, not a failure.
            if (!isMainFrame || code === -3) return;
            deps.log(`pane ${paneId} could not load ${failed}: ${description} (${code})`);
        });
        wc.on('focus', () => focus(paneId));
        // A right-click on a page never reaches the shell — this view is
        // stacked above it — so the pane menu is raised from here instead, with
        // the view's own coordinates put back into the window's. The header
        // above it is shell, and the view starts below it, so that inset is
        // part of the offset.
        wc.on('context-menu', (_event, params) => {
            const rect = rects.get(paneId);
            if (!rect) return;
            const view = below(rect);
            deps.contextMenu(paneId, view.x + params.x, view.y + params.y);
        });

        const policy = (event: { preventDefault: () => void }, target: string): void => {
            const decision = decidePageNavigation({ target, hosts: deps.hosts() });
            if (decision === 'allow') return;
            event.preventDefault();
            if (decision === 'open-external') {
                deps.log(`sent ${target} to the system browser`);
                void shell.openExternal(target);
            } else {
                deps.log(`blocked ${target}`);
            }
        };
        wc.on('will-navigate', policy);
        // Not optional: `tools.losthq.rs/map` answers a 301 and LostHQ's
        // bestiary a 302, so a redirect is the ordinary case rather than the
        // exotic one, and a policy that only saw `will-navigate` would let a
        // redirect carry a page anywhere.
        wc.on('will-redirect', policy);
        wc.setWindowOpenHandler(({ url: target }) => {
            if (/^https?:\/\//.test(target)) void shell.openExternal(target);
            return { action: 'deny' };
        });

        void wc.loadURL(url);
    }

    function focus(paneId: string): void {
        if (focused() === paneId || !paneIds(active()).includes(paneId)) return;
        set = withActive(active(), paneId);
        deps.touched();
    }

    /** Applies a new tree: reconcile the views, then let the window lay out around it. */
    function adopt(next: PaneNode): void {
        if (next === active()) return;
        const survives = paneIds(next).includes(focused());
        set = withActive(next, survives ? undefined : paneIds(next)[0]);
        syncViews();
        deps.remember(set);
        deps.changed();
    }

    return {
        tree: active,
        trees: () => set.tabs.map(tab => tab.tree),
        focusedPaneId: focused,

        layout(rect: Rect): void {
            const solved = layoutTree(active(), rect);
            rects = solved.panes;
            seams = solved.seams.map(seam => {
                const gross = solved.splits.get(seam.splitId) ?? 0;
                const px = seamPixels(active(), seam.splitId, seam.index, gross);
                return { splitId: seam.splitId, index: seam.index, axis: seam.axis, rect: seam.rect, gross, size: px?.size ?? 0, min: px?.min ?? 0, max: px?.max ?? 0 };
            });
            place();
        },

        panes(): PaneView[] {
            const tree = active();
            const trees = set.tabs.map(tab => tab.tree);
            return paneIds(tree).map(paneId => {
                const content = contentOf(tree, paneId) ?? ({ kind: 'empty' } as PaneContent);
                return {
                    paneId,
                    rect: rects.get(paneId) ?? { x: 0, y: 0, width: 0, height: 0 },
                    content,
                    name: paneName(content, deps.bookmarks()),
                    focused: paneId === focused(),
                    page: pageStates.get(paneId) ?? null,
                    // Only the launcher draws a list; every other pane reaches
                    // the same one through its header, which main pops as a
                    // native menu and builds on the spot.
                    contents: content.kind === 'empty' ? paneContentItems({ trees, paneId, tools: deps.tools(), links: deps.bookmarks() }) : null
                };
            });
        },

        tabs(): TabView[] {
            return set.tabs.map(tab => ({
                id: tab.id,
                label: labelOfTab(tab.tree, tab.focusedPaneId),
                active: tab.id === set.activeId,
                hasGame: paneIds(tab.tree).some(id => contentOf(tab.tree, id)?.kind === 'game')
            }));
        },

        seams: () => seams,
        focus,
        rectOf: (paneId: string) => rects.get(paneId) ?? null,

        newTab(): void {
            set = newTab(set, `tab-${nextTab++}`, `pane-${nextPane++}`);
            deps.remember(set);
            deps.changed();
        },

        /** Returns false when that was the last tab — the window's cue to close. */
        closeTab(tabId: string): boolean {
            const next = closeTab(set, tabId);
            if (next === null) return false;
            if (next === set) return true;
            set = next;
            deps.remember(set);
            // The tab's panes went with it, so its page views have nothing left
            // pointing at them. Reconciled rather than tracked: `syncViews`
            // follows the tabs, and a view whose pane is gone from every tab is
            // exactly what it destroys.
            syncViews();
            deps.changed();
            return true;
        },

        selectTab(tabId: string): void {
            const next = selectTab(set, tabId);
            if (next === set) return;
            set = next;
            deps.remember(set);
            deps.changed();
        },

        split(paneId: string, axis: 'x' | 'y'): void {
            const born = `pane-${nextPane++}`;
            adopt(splitPane(active(), paneId, axis, { paneId: born, splitId: `split-${nextSplit++}` }));
            focus(born);
        },

        close(paneId: string): void {
            adopt(closePane(active(), paneId));
        },

        setContent(paneId: string, content: PaneContent): void {
            adopt(setContent(active(), paneId, content));
        },

        /**
         * The game, into this pane, out of wherever it was.
         *
         * Not `adopt`, which replaces the active tab's tree only: the game may
         * be in another tab, and the pane it leaves there has to be emptied in
         * the same breath or the window would claim two games and have one
         * view. No view is created or destroyed either way — the game's belongs
         * to the window, and the only leaves this touches are game and empty —
         * so all the move costs is the `setBounds` `place` gives it on the next
         * layout, and the login survives it.
         */
        moveGame(paneId: string): void {
            const next = moveGame(set, paneId);
            if (next === set) return;
            set = next;
            syncViews();
            deps.remember(set);
            deps.changed();
        },

        evenOut(splitId: string): void {
            adopt(evenOut(active(), splitId));
        },

        dragSeam(splitId: string, index: number, px: number): number {
            const seam = seams.find(s => s.splitId === splitId && s.index === index);
            if (!seam) return 0;
            const next = setSeam(active(), splitId, index, px, seam.gross);
            // Adopted without reconciling views: a drag cannot change which
            // panes exist, only how big they are.
            if (next !== active()) {
                set = withActive(next);
                deps.remember(set);
                deps.changed();
            }
            // The size the seam was *drawn* at, not the one it asked for. The
            // two part company at either end of the range, and `Grip` builds
            // its next request on whatever comes back — answering with the
            // request would have every later key press aim from a number the
            // seam is not at.
            return seams.find(s => s.splitId === splitId && s.index === index)?.size ?? seam.size;
        },

        /** The view of the focused page pane, or of the only one, for capture mode. */
        pageWebContents(): WebContentsView | null {
            const own = pageViews.get(focused());
            if (own) return own;
            const first = paneIds(active()).find(id => pageViews.has(id));
            return first ? pageViews.get(first) ?? null : null;
        },

        go(where: 'back' | 'forward' | 'reload'): void {
            const view = pageViews.get(focused());
            if (!view || view.webContents.isDestroyed()) return;
            const history = view.webContents.navigationHistory;
            if (where === 'back') {
                if (history.canGoBack()) history.goBack();
            } else if (where === 'forward') {
                if (history.canGoForward()) history.goForward();
            } else {
                view.webContents.reload();
            }
        },

        destroy(): void {
            for (const paneId of [...pageViews.keys()]) destroyPageView(paneId);
        }
    };
}

export interface PaneHost {
    tree: () => PaneNode;
    /** Every tab's tree. What a pane may become depends on all of them, since the game can be moved out of any. */
    trees: () => PaneNode[];
    focusedPaneId: () => string;
    layout: (rect: Rect) => void;
    panes: () => PaneView[];
    tabs: () => TabView[];
    seams: () => SeamView[];
    focus: (paneId: string) => void;
    /** Where a pane was last drawn, for anything that needs its size — the context menu asks whether it can still be halved. */
    rectOf: (paneId: string) => Rect | null;
    newTab: () => void;
    /** False when that was the last tab, which is the window's cue to close. */
    closeTab: (tabId: string) => boolean;
    selectTab: (tabId: string) => void;
    split: (paneId: string, axis: 'x' | 'y') => void;
    close: (paneId: string) => void;
    setContent: (paneId: string, content: PaneContent) => void;
    /** Moves the game into a pane, emptying the one it was in, in whichever tab that was. */
    moveGame: (paneId: string) => void;
    evenOut: (splitId: string) => void;
    dragSeam: (splitId: string, index: number, px: number) => number;
    pageWebContents: () => WebContentsView | null;
    go: (where: 'back' | 'forward' | 'reload') => void;
    destroy: () => void;
}
