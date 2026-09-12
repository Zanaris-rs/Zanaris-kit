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
import type { PageState, PaneView, SeamView } from '../shared/panes.ts';

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
    hosts: () => readonly string[];
    log: (line: string) => void;
    /** The tree's shape changed: lay the window out again and push state. */
    changed: () => void;
    /** Nothing geometric moved — a title, a back button. Push state only. */
    touched: () => void;
}

export function createPaneHost(deps: PaneHostDeps): PaneHost {
    let tree: PaneNode = leaf('pane-1', { kind: 'empty' });
    let focusedPaneId = 'pane-1';
    let nextPane = 2;
    let nextSplit = 1;

    const pageViews = new Map<string, WebContentsView>();
    const pageStates = new Map<string, PageState>();
    let rects = new Map<string, Rect>();
    let seams: SeamView[] = [];

    function label(content: PaneContent): string {
        switch (content.kind) {
            case 'empty':
                return 'Empty';
            case 'game':
                return 'Game';
            case 'tool':
                return content.tool;
            case 'page':
                return deps.bookmarks().find(b => b.url === content.bookmark)?.name ?? content.bookmark;
        }
    }

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
        const gamePane = paneIds(tree).find(id => contentOf(tree, id)?.kind === 'game');
        if (game) {
            const rect = gamePane ? rects.get(gamePane) : undefined;
            if (rect) game.setBounds(rect);
            game.setVisible(Boolean(rect));
        }
        for (const [paneId, view] of pageViews) {
            const rect = rects.get(paneId);
            if (rect) view.setBounds(rect);
            view.setVisible(Boolean(rect));
        }
    }

    /** The views, reconciled against the page leaves. The only thing that creates or destroys one. */
    function syncViews(): void {
        for (const paneId of paneIds(tree)) {
            const content = contentOf(tree, paneId);
            if (content?.kind !== 'page' || pageViews.has(paneId)) continue;
            createPageView(paneId, content.bookmark);
        }
        for (const paneId of [...pageViews.keys()]) {
            if (contentOf(tree, paneId)?.kind !== 'page') destroyPageView(paneId);
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
        pageStates.set(paneId, { url, title: label({ kind: 'page', bookmark: url }), canGoBack: false, canGoForward: false, loading: true });

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
        if (focusedPaneId === paneId || !paneIds(tree).includes(paneId)) return;
        focusedPaneId = paneId;
        deps.touched();
    }

    /** Applies a new tree: reconcile the views, then let the window lay out around it. */
    function adopt(next: PaneNode): void {
        if (next === tree) return;
        tree = next;
        if (!paneIds(tree).includes(focusedPaneId)) focusedPaneId = paneIds(tree)[0] ?? focusedPaneId;
        syncViews();
        deps.changed();
    }

    return {
        tree: () => tree,
        focusedPaneId: () => focusedPaneId,
        hasGame: () => paneIds(tree).some(id => contentOf(tree, id)?.kind === 'game'),

        layout(rect: Rect): void {
            const solved = layoutTree(tree, rect);
            rects = solved.panes;
            seams = solved.seams.map(seam => {
                const gross = solved.splits.get(seam.splitId) ?? 0;
                const px = seamPixels(tree, seam.splitId, seam.index, gross);
                return { splitId: seam.splitId, index: seam.index, axis: seam.axis, rect: seam.rect, gross, size: px?.size ?? 0, min: px?.min ?? 0, max: px?.max ?? 0 };
            });
            place();
        },

        panes(): PaneView[] {
            return paneIds(tree).map(paneId => ({
                paneId,
                rect: rects.get(paneId) ?? { x: 0, y: 0, width: 0, height: 0 },
                content: contentOf(tree, paneId) ?? { kind: 'empty' },
                focused: paneId === focusedPaneId,
                page: pageStates.get(paneId) ?? null
            }));
        },

        seams: () => seams,
        focus,

        split(paneId: string, axis: 'x' | 'y'): void {
            const born = `pane-${nextPane++}`;
            adopt(splitPane(tree, paneId, axis, { paneId: born, splitId: `split-${nextSplit++}` }));
            focus(born);
        },

        close(paneId: string): void {
            adopt(closePane(tree, paneId));
        },

        setContent(paneId: string, content: PaneContent): void {
            adopt(setContent(tree, paneId, content));
        },

        evenOut(splitId: string): void {
            adopt(evenOut(tree, splitId));
        },

        dragSeam(splitId: string, index: number, px: number): number {
            const seam = seams.find(s => s.splitId === splitId && s.index === index);
            if (!seam) return 0;
            const next = setSeam(tree, splitId, index, px, seam.gross);
            // The tree is adopted without reconciling views: a drag cannot
            // change which panes exist, only how big they are.
            if (next !== tree) {
                tree = next;
                deps.changed();
            }
            // The size the seam was *drawn* at, not the one it asked for. The
            // two part company at either end of the range, and `Grip` builds
            // its next request on whatever comes back — answering with the
            // request would have every later key press aim from a number the
            // seam is not at.
            return seams.find(s => s.splitId === splitId && s.index === index)?.size ?? seam.size;
        },

        go(where: 'back' | 'forward' | 'reload'): void {
            const view = pageViews.get(focusedPaneId);
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
    focusedPaneId: () => string;
    hasGame: () => boolean;
    layout: (rect: Rect) => void;
    panes: () => PaneView[];
    seams: () => SeamView[];
    focus: (paneId: string) => void;
    split: (paneId: string, axis: 'x' | 'y') => void;
    close: (paneId: string) => void;
    setContent: (paneId: string, content: PaneContent) => void;
    evenOut: (splitId: string) => void;
    dragSeam: (splitId: string, index: number, px: number) => number;
    go: (where: 'back' | 'forward' | 'reload') => void;
    destroy: () => void;
}
