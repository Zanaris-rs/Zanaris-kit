import { BrowserWindow, WebContentsView, screen, shell, type NativeImage } from 'electron';
import { join } from 'node:path';
import { IPC, type ShellState, type ToolId } from '../shared/ipc';
import {
    MIN_CONTENT_HEIGHT,
    MIN_CONTENT_WIDTH,
    MIN_WINDOW_CONTENT_HEIGHT,
    MIN_WINDOW_CONTENT_WIDTH,
    PAGE_CONTROLS_HEIGHT,
    PAGE_SEAM,
    PAGE_WIDTH_MIN,
    RAIL_WIDTH,
    STRIP_HEIGHT,
    type LayoutMode
} from '../shared/layout';
import type { ChatHome, ChatView } from '../shared/chat';
import type { Detail, RememberedWorld, WorldsView } from '../shared/worlds';
import type { SinglePlayerView } from '../shared/singleplayer';
import type { PagesView } from '../shared/pages';
import { computeLayout, dockOnFloor, paneWidth, preservedHeight, preservedWidth, sideWidth, splitWindow, type Rect, type Rects } from './layout';
import { firstLegalSideOccupant, reduce, type Action, type Placement } from './chatDock';
import { decideNavigation, decidePageNavigation } from './guard';
import { activeTab, initialPane, paneLayoutWidth, paneOpen, reduce as reducePane, type PaneAction, type PaneState } from './pagePane';
import { loadShell, preloadPath } from './renderer';
import { windowTitle } from './slots';
import { WorldSwitch } from './worlds/switch';
import { worldEndpoint } from './worlds/sources';
import type { WorldsService } from './worlds/service';
import type { HiscoresService } from './hiscores/service';
import type { ServerWindowHandle, WindowSpec } from './windows';

const OFFLINE_PAGE = join(__dirname, '../../static/offline.html');
const STARTING_PAGE = join(__dirname, '../../static/starting.html');
/** The content area a new window opens with: the canvas plus the page's controls strip. */
const DEFAULT_CONTENT = { width: MIN_CONTENT_WIDTH, height: MIN_CONTENT_HEIGHT + PAGE_CONTROLS_HEIGHT };
const PROBE_EVERY_MS = 10_000;
const PROBE_TIMEOUT_MS = 3_000;

/**
 * Injected into every game page. The stock client is `body{overflow:auto}` around
 * a fixed 765x503 canvas plus a controls strip, inside a `center{min-height:100vh}`
 * flex column — and Chromium's vh ignores the scrollbar gutter, so one scrollbar
 * induces the other. Hiding the bars is the actual fix: a bar with no box reserves
 * no gutter, so there is nothing left for the other axis to react to.
 *
 * The other two rules do not touch that fix. `html, body { height: 100% }` and
 * `center { min-height: 100% }` replace the stock `100vh` with a percentage chain
 * — which needs a definite ancestor height to resolve at all, hence the
 * `height: 100%` — so the pre-existing "canvas centred in an oversized window"
 * look survives the swap. `justify-content: safe` is, on the current markup, a
 * no-op: `center` is body's only child and only ever carries `min-height`, never a
 * smaller fixed height, so it can never end up shorter than its own content for
 * `safe` to redirect. It stays as a guard against a future markup change, not
 * because it does anything today. When the page does overflow, it clips at the
 * bottom rather than the top for an unrelated, pre-existing reason: `overflow:
 * auto`'s resting scroll position is zero, so the visible window onto the content
 * starts at its top edge regardless of any of this.
 *
 * Scrolling still works, so 2x/3x Size stay pannable by wheel and trackpad.
 */
const GAME_PAGE_CSS = `
    html, body { height: 100% !important; }
    body { scrollbar-width: none !important; }
    body::-webkit-scrollbar, html::-webkit-scrollbar { display: none !important; }
    center { min-height: 100% !important; justify-content: safe center !important; }
`;

export type LoadResult = 'loaded' | 'failed';

/** What a single-player window needs of the service; the service itself satisfies it. */
export interface SinglePlayerHandle {
    view(): SinglePlayerView;
    subscribe(fn: () => void): () => void;
    acquire(): Promise<string>;
    release(): void;
    retry(): Promise<string>;
}

const STATUS_WORD: Record<SinglePlayerView['status'], string> = {
    stopped: 'stopped',
    preparing: 'getting ready',
    starting: 'starting',
    ready: 'running',
    stopping: 'stopping',
    failed: 'failed'
};

function statusWord(status: SinglePlayerView['status']): string {
    return STATUS_WORD[status];
}

export interface ServerWindowDeps {
    log: (msg: string) => void;
    /** Return false to keep the window open. Main returns true without asking while quitting. */
    confirmClose: (title: string) => boolean;
    position: { x: number; y: number } | null;
    /** The server's shared world list and latency, or null when the server has one page. */
    worlds: WorldsService | null;
    /** The server's shared hiscores lookup, or null when it offers none — which is what keeps the tool off a single-player window's rail. */
    hiscores: HiscoresService | null;
    /**
     * The one conversation, which is the app's rather than this window's: every
     * window shows the same one. A getter rather than the service itself, since
     * the window only ever reads it — main pushes when it changes.
     */
    chat: () => ChatView;
    /**
     * Where chat lives and how tall its dock is. Read through functions rather
     * than passed as values: both are the app's rather than this window's, and
     * they change under the window's feet while it is open.
     */
    chatHome: () => ChatHome;
    chatDockHeight: () => number;
    /** The width a newly opened reference pane starts at, as the last seam drag anywhere left it. */
    pageWidth: () => number;
    /** Whether a window opened now should float above other apps, as the last choice anywhere left it. */
    alwaysOnTop: () => boolean;
    /** Remembers a seam drag. Staged, not written: a drag lands one of these per animation frame. */
    rememberPageWidth: (px: number) => void;
    /** What this server remembered from last time, if anything. */
    remembered: RememberedWorld | null;
    /** Called whenever this window's world or detail changes. */
    remember: (remembered: RememberedWorld) => void;
    /** Latency of one host, for the current world's readout. */
    probe: (host: string, port: number, timeoutMs: number) => Promise<number | null>;
    /** The world this computer runs, for a window of kind singleplayer; null otherwise. */
    singlePlayer: SinglePlayerHandle | null;
}

export interface ServerWindow extends ServerWindowHandle {
    readonly id: number;
    readonly window: BrowserWindow;
    /** The shell view's webContents id, so IPC handlers can find the window from `event.sender`. */
    readonly shellContentsId: number;
    togglePanel(): void;
    /** The rail's tabs: opens the panel on a tool, closing it again when that tool is the one already on show. Null only closes. The Chat tab is routed by where chat lives: at the bottom it opens or closes the dock instead. */
    selectTool(id: ToolId | null): void;
    /** The →| control in this window: chat moves home, and this window's chrome rearranges around it. */
    moveChat(home: ChatHome): void;
    /** Whether this window floats above other apps. Read back from the window itself, not from a flag kept beside it. */
    alwaysOnTop(): boolean;
    setAlwaysOnTop(on: boolean): void;
    /** Opens one of this server's links in the reference pane, or focuses it when it is already open. Anything not in `server.bookmarks` is refused. */
    openPage(url: string): void;
    activatePage(id: string): void;
    closePage(id: string): void;
    /** Hides the pane without destroying its views, so nothing reloads when it comes back. */
    setPaneCollapsed(collapsed: boolean): void;
    /** Sets the pane's width, clamped here. Returns the width actually applied, on every path including the one that changes nothing. */
    setPaneWidth(px: number): number;
    /** The pane's toolbar, acting on the tab in front. */
    pageGo(where: 'back' | 'forward' | 'reload'): void;
    /** The echo of a move made in another window: this one learns where chat goes without losing what it has open. */
    syncChatHome(home: ChatHome): void;
    /** Re-runs the layout and pushes the result. For app-wide changes that move things, where pushState alone would only repaint the old geometry. */
    relayout(): void;
    state(): ShellState;
    /** Sends the current state to the shell. For app-wide changes main hears about, not the window. */
    pushState(): void;
    /** Resolves when the most recent load finished, or failed over to the offline page. */
    whenGameLoaded(): Promise<LoadResult>;
    switchWorld(world: number): Promise<LoadResult | 'unknown'>;
    setDetail(detail: Detail): Promise<LoadResult | 'unchanged'>;
    refreshWorlds(): Promise<void>;
    /**
     * Resolves once the shell has actually painted what main last pushed.
     * capturePage hands back the last composited frame, so without this a
     * capture taken right after a state change photographs the previous one —
     * which had capture mode reporting a stale panel three times over.
     */
    settle(): Promise<void>;
    /** Page content of one view, for capture mode. A window's own webContents holds nothing. */
    captureShell(): Promise<NativeImage>;
    captureGame(): Promise<NativeImage>;
    /** The reference page in front, for capture mode. Resolves with null when the pane is closed or collapsed: there is no view to shoot. */
    capturePage(): Promise<NativeImage | null>;
}

/**
 * One server window: a full-window shell view (React, preload) with the game
 * view placed on top of it inside the content rect. Main owns all geometry;
 * the shell only draws where main says things are.
 *
 * The game view has no preload and no IPC. Its page is byte-for-byte what the
 * server served, and nothing the page does can replace it: the only way it
 * changes page is `loadGame` here. `backgroundThrottling: false` keeps its
 * setTimeout-driven loop at full rate while another window is in front.
 */
export function createServerWindow(spec: WindowSpec, onClosed: () => void, deps: ServerWindowDeps): ServerWindow {
    const { server } = spec;
    const tag = `[${spec.title}]`;
    const worldSwitch = server.worlds && deps.worlds ? new WorldSwitch(server.worlds, server.url, deps.remembered) : null;
    const single = server.kind === 'singleplayer' ? deps.singlePlayer : null;
    /**
     * The rail this window offers. Chat is app-scoped, so every window offers
     * it, and first: it is there whether or not the server has worlds to hop
     * between. Everything after it is this window's server's, which is where
     * the rail draws its divider — worlds to hop between, hiscores to look a
     * player up on, the world this computer runs.
     *
     * Each of the three is offered because the window was *given* the thing
     * behind it, rather than because of what kind of server this is: no
     * hiscores def means no service, no service means no tool, and single
     * player is the case that matters — a one-player world has nothing to
     * rank, and its catalog entry carries no hiscores, so the tool never
     * reaches its rail without anything here naming it.
     *
     * The rail's order is declared in three places nothing links together:
     * this builder, which feeds `firstLegalSideOccupant` and so
     * `panelAvailable`; `TOOLS` in `renderer/Shell.tsx`, which decides what is
     * drawn; and `RAIL` in `chatDock.test.ts`, which stands in for this
     * builder. They agree today, and no test would notice if they stopped —
     * reorder one and the other two want the same edit. It matters in a way it
     * did not before hiscores: every remote window now offers two server tools
     * at once, so which of them comes first is a real question.
     */
    const tools: ToolId[] = ['chat'];
    if (worldSwitch) tools.push('worlds');
    if (deps.hiscores) tools.push('hiscores');
    // The whole of the per-server gating for the reference links: a window
    // offers Guides exactly when its catalog entry has links to offer, so
    // which servers get them is data rather than a condition written here.
    if (server.bookmarks.length > 0) tools.push('guides');
    if (single) tools.push('singleplayer');
    // Which tools a window came up with is otherwise only visible by looking at
    // the rail, and a tool missing from it looks the same as a tool that drew
    // nothing. One line at open says which of the two happened.
    deps.log(`${tag} rail: ${tools.join(' · ')}`);

    /** The URL main last asked the game view to load. The offline page may return to it; nothing else may navigate. */
    let expected = worldSwitch ? worldSwitch.url : server.url;
    let currentLatency: number | null = null;
    /**
     * Where chat is and what the side column holds. Every transition of it goes
     * through `reduce`, which owns the rules and is tested on its own.
     *
     * The dock starts closed on every launch, whatever home the profile
     * remembers. Chat does not connect until someone opens it and picks a nick
     * — the property that keeps a capture run from ever opening a socket — so a
     * dock that opened itself would either break that or greet a new user with
     * a nick prompt they never asked for. Opening chat stays a deliberate act;
     * only where it opens changed.
     */
    let placement: Placement = { home: deps.chatHome(), dockOpen: false, activeTool: null, panelOpen: false };
    /**
     * The reference pane: which LostHQ pages this window has open and how it is
     * showing them. Every transition goes through `reducePane`, which owns the
     * rules and is tested on its own; `syncPageViews` below is the only thing
     * that creates or destroys a view, and it does so purely by following this.
     */
    let pane: PaneState = initialPane(deps.pageWidth());
    /** One long-lived view per open tab, keyed by tab id. Switching tabs only moves visibility. */
    const pageViews = new Map<string, WebContentsView>();
    let mode: { x: LayoutMode; y: LayoutMode } = { x: 'widen', y: 'widen' };
    let rects: Rects = splitWindow(DEFAULT_CONTENT.width + RAIL_WIDTH, STRIP_HEIGHT + DEFAULT_CONTENT.height, false, 0, 0, DEFAULT_CONTENT.width);
    let contentWidth = DEFAULT_CONTENT.width;
    let contentHeight = DEFAULT_CONTENT.height;
    let applying = false;
    let failedOver = false;
    let loadWaiter: ((result: LoadResult) => void) | null = null;
    let loadPromise: Promise<LoadResult> = Promise.resolve('loaded');
    /** True between a loadGame and its result, so a kit page can tell it is superseding one. */
    let gameLoadPending = false;

    const win = new BrowserWindow({
        width: DEFAULT_CONTENT.width + RAIL_WIDTH,
        height: STRIP_HEIGHT + DEFAULT_CONTENT.height,
        // The floor is MIN_WINDOW_CONTENT_* and not the canvas the window opens
        // at: the window may be dragged well under the game's own size, and the
        // client has its own answers for that. See the constants.
        minWidth: MIN_WINDOW_CONTENT_WIDTH + RAIL_WIDTH,
        minHeight: STRIP_HEIGHT + MIN_WINDOW_CONTENT_HEIGHT,
        useContentSize: true,
        ...(deps.position ?? {}),
        title: spec.title,
        backgroundColor: '#17120d',
        show: false,
        // The last choice made anywhere, so a window opened while the app is
        // pinned comes up pinned rather than needing the menu again.
        alwaysOnTop: deps.alwaysOnTop()
    });

    /**
     * The floor the window may be dragged to, in the units setMinimumSize
     * speaks. `useContentSize` made the constructor's minWidth and minHeight
     * *content* constraints, while setMinimumSize takes a *window* size, frame
     * and all — so rather than guess at the frame, this reads back what
     * Electron made of the constructor's numbers and offsets from it. The dock
     * is the same number of pixels in either space.
     */
    const minimum = win.getMinimumSize();
    // The fallbacks are the two numbers just passed in, and are there only for the index type: Electron always returns both.
    const minWindowWidth = minimum[0] ?? MIN_WINDOW_CONTENT_WIDTH + RAIL_WIDTH;
    const minWindowHeight = minimum[1] ?? STRIP_HEIGHT + MIN_WINDOW_CONTENT_HEIGHT;
    /** How much of the dock the current minimum already accounts for, so it is only set when it moves. */
    let minimumDock = 0;

    const shellView = new WebContentsView({
        webPreferences: {
            preload: preloadPath(),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true
        }
    });
    shellView.setBackgroundColor('#17120d');

    const gameView = new WebContentsView({
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            partition: spec.partition,
            backgroundThrottling: false
        }
    });
    gameView.setBackgroundColor('#000000');

    // Order matters: later children draw on top. The game sits over the shell's empty content area.
    win.contentView.addChildView(shellView);
    win.contentView.addChildView(gameView);

    // ── labels ───────────────────────────────────────────────────────────

    function gameLabel(): string {
        if (single) return `${server.name} · rev ${server.revision ?? '?'} · ${statusWord(single.view().status)}`;
        return worldSwitch ? worldSwitch.label(server.name, currentLatency) : server.name;
    }

    function title(): string {
        return worldSwitch ? windowTitle(worldSwitch.title(server.name), spec.slot) : spec.title;
    }

    function refreshLabels(): void {
        if (!win.isDestroyed()) win.setTitle(title());
    }

    // ── state ────────────────────────────────────────────────────────────

    function worldsView(): WorldsView | null {
        if (!worldSwitch || !deps.worlds || !server.worlds) return null;
        return { ...deps.worlds.view(), current: worldSwitch.world, detail: worldSwitch.detail, showDetail: server.worlds.detail };
    }

    function pagesView(): PagesView {
        const active = activeTab(pane);
        return {
            tabs: pane.tabs.map(t => ({ id: t.id, bookmark: t.bookmark, label: t.label, active: t.id === pane.activeId })),
            collapsed: pane.collapsed,
            width: rects.page?.width ?? pane.width,
            maxWidth: paneCeiling(),
            active:
                active && !pane.collapsed
                    ? { title: active.title, url: active.url, canGoBack: active.canGoBack, canGoForward: active.canGoForward, loading: active.loading }
                    : null
        };
    }

    function state(): ShellState {
        return {
            windowId: spec.id,
            server,
            slot: spec.slot,
            title: title(),
            gameLabel: gameLabel(),
            panelOpen: placement.panelOpen,
            mode,
            rects,
            tools,
            activeTool: placement.activeTool,
            panelAvailable: firstLegalSideOccupant(tools, placement.home) !== null,
            worlds: worldsView(),
            hiscores: deps.hiscores?.view() ?? null,
            pages: pagesView(),
            chat: deps.chat(),
            chatHome: placement.home,
            dockOpen: placement.dockOpen,
            dockHeight: deps.chatDockHeight(),
            singlePlayer: single?.view() ?? null
        };
    }

    function pushState(): void {
        if (shellView.webContents.isDestroyed()) return;
        try {
            shellView.webContents.send(IPC.shellState, state());
        } catch (err) {
            deps.log(`${tag} could not push state: ${(err as Error).message}`);
        }
    }

    // ── layout ───────────────────────────────────────────────────────────

    /** What the dock takes from the window: its remembered height while it is open, nothing while it is not. */
    function dockHeight(): number {
        return placement.dockOpen ? deps.chatDockHeight() : 0;
    }

    /**
     * The window's floor has to carry the dock too. Left alone at the
     * construction-time height, dragging the window short with the dock open
     * would crush the game below MIN_WINDOW_CONTENT_HEIGHT — the one thing the
     * floor exists to prevent.
     *
     * What it carries is the dock the layout *granted*, in the window the
     * layout granted it in — not the height the drag asked for. `dockOnFloor`
     * has the arithmetic and the reason: a floor built from the request is a
     * floor taller than the whole work area on any display too short for the
     * dock, and the next drag would take the composer and the grip under the
     * taskbar.
     */
    function syncMinimumSize(granted: number, windowHeight: number): void {
        const dock = dockOnFloor(granted, windowHeight);
        if (dock === minimumDock) return;
        minimumDock = dock;
        // Under `applying` for the same reason setContentBounds is. macOS does
        // not resize a live window onto a new minimum — measured, not assumed —
        // but nothing promises the other platforms do not, and such a resize
        // would arrive at the handler below as the user's own: it would take
        // the half-grown window for the height they asked for and hand the
        // content the dock's pixels.
        applying = true;
        win.setMinimumSize(minWindowWidth, minWindowHeight + dock);
        applying = false;
    }

    function applyLayout(): void {
        if (win.isDestroyed()) return;
        const dock = dockHeight();
        const current = win.getContentBounds();
        const display = screen.getDisplayMatching(win.getBounds());
        const result = computeLayout({
            panelOpen: placement.panelOpen,
            pageWidth: paneLayoutWidth(pane),
            window: current,
            workArea: display.workArea,
            contentWidth,
            contentHeight,
            dockHeight: dock,
            canResize: !win.isMaximized() && !win.isFullScreen()
        });

        mode = result.mode;
        rects = result;
        const w = result.window;
        // The floor moves before the bounds are set and after they are solved:
        // closing the dock has to lower it first, or the minimum that was
        // carrying the dock clamps setContentBounds and the window never
        // shrinks back — and only the solved layout knows how much dock there
        // turned out to be room for.
        syncMinimumSize(result.dock?.height ?? 0, w.height);
        if (w.x !== current.x || w.y !== current.y || w.width !== current.width || w.height !== current.height) {
            applying = true;
            win.setContentBounds(w);
            applying = false;
        }
        shellView.setBounds({ x: 0, y: 0, width: w.width, height: w.height });
        gameView.setBounds(result.content);
        syncPageBounds(result.page);
        pushState();
    }

    win.on('resize', () => {
        if (applying) return;
        const bounds = win.getContentBounds();
        // The pane comes off here exactly as it is added in applyLayout, or a
        // resize with a page open would hand the pane's pixels to the game and
        // grow the window by them again on the next layout.
        contentWidth = preservedWidth(bounds.width, sideWidth(placement.panelOpen) + paneWidth(paneLayoutWidth(pane)));
        // The y-axis twin of the line above: without it contentHeight would sit
        // stale at its construction-time value forever, and computeLayout would
        // fit the window back to that stale height on every layout event,
        // fighting the user's own resize. The dock comes off here exactly as it
        // is added in applyLayout, or a resize with the dock open would hand
        // the dock's pixels to the content and grow the window by them again.
        contentHeight = preservedHeight(bounds.height, STRIP_HEIGHT + dockHeight());
        applyLayout();
    });
    // These change whether the window can be widened, so re-run the layout.
    win.on('maximize', () => applyLayout());
    win.on('unmaximize', () => applyLayout());
    win.on('enter-full-screen', () => applyLayout());
    win.on('leave-full-screen', () => applyLayout());

    // ── the panel and its tool ───────────────────────────────────────────

    let panelProbe: NodeJS.Timeout | null = null;

    /** The whole list is probed only while this window shows the Worlds panel. */
    function syncPanelProbe(): void {
        const wanted = placement.panelOpen && placement.activeTool === 'worlds' && worldSwitch !== null && deps.worlds !== null;
        if (wanted && !panelProbe) {
            const probeAll = (): void => {
                if (deps.worlds && worldSwitch) void deps.worlds.probeAll(worldSwitch.detail);
            };
            void deps.worlds!.list().then(probeAll);
            panelProbe = setInterval(probeAll, PROBE_EVERY_MS);
        } else if (!wanted && panelProbe) {
            clearInterval(panelProbe);
            panelProbe = null;
        }
    }

    /**
     * The one way placement moves. Every rule about which region chat ends up
     * in lives in `reduce`; this end of it only names the gesture and redraws.
     */
    function place(action: Action): void {
        placement = reduce(placement, action, tools);
        applyLayout();
        syncPanelProbe();
    }

    function selectTool(id: ToolId | null): void {
        // Null is the shell asking for the panel shut: it works out the toggle
        // itself and sends null rather than the tool already on show.
        if (id === null) {
            if (placement.panelOpen) place({ kind: 'toggle-panel' });
            return;
        }
        if (!tools.includes(id)) return;
        if (id !== 'chat') {
            place({ kind: 'rail-tool', tool: id });
            return;
        }
        // The one rail tab whose meaning depends on where chat lives — the dock
        // while chat is at the bottom, the panel while it is on the side — so
        // the log says which of the two it just did. Which it is belongs to the
        // rules, not here.
        place({ kind: 'rail-chat' });
        deps.log(`${tag} chat tab: dock ${placement.dockOpen ? 'open' : 'closed'}, panel ${placement.panelOpen ? 'open' : 'closed'}`);
    }

    function togglePanel(): void {
        place({ kind: 'toggle-panel' });
        deps.log(`${tag} panel ${placement.panelOpen ? 'opened' : 'closed'}`);
    }

    /**
     * The two halves of an app-wide home change. Where chat goes is the app's,
     * so every window hears about it; whether chat is open here is this
     * window's, so only the window whose control was clicked rearranges around
     * it. Which of the two a window gets is main's to decide, and the
     * difference between them is the rules module's.
     */
    function moveChat(home: ChatHome): void {
        place({ kind: 'move', to: home });
        deps.log(`${tag} chat moved to the ${home}`);
    }

    function syncChatHome(home: ChatHome): void {
        place({ kind: 'sync-home', to: home });
        deps.log(`${tag} chat now lives at the ${home}`);
    }

    // ── the reference pane ───────────────────────────────────────────────

    /**
     * One session for every reference page in every window, so a LostHQ login
     * is shared rather than asked for again per window. It is deliberately not
     * the game's partition: nothing a guide page does should be able to touch
     * the cookies the player is logged in with.
     */
    const PAGES_PARTITION = 'persist:pages';

    /**
     * The widest the pane can be dragged while the game still has its canvas on
     * this display. The floor wins a tie — on a display too narrow for both,
     * this comes out under PAGE_WIDTH_MIN and the reducer's own clamp keeps the
     * pane at its floor, leaving `splitWindow` to decide what gives way.
     */
    function paneCeiling(): number {
        const work = screen.getDisplayMatching(win.getBounds()).workArea;
        return Math.max(PAGE_WIDTH_MIN, work.width - MIN_CONTENT_WIDTH - sideWidth(placement.panelOpen) - PAGE_SEAM);
    }

    /**
     * Bounds and visibility for the open pages.
     *
     * Only the view about to show is given bounds. A hidden Chromium view still
     * does the work of a resize, and during a seam drag that would be one per
     * open tab per animation frame; the cost of waiting is a single reflow when
     * a tab that was hidden through a resize comes back.
     */
    function syncPageBounds(page: Rect | null): void {
        for (const [id, view] of pageViews) {
            const visible = page !== null && id === pane.activeId;
            if (visible) view.setBounds(page);
            view.setVisible(visible);
        }
    }

    /**
     * The views, reconciled against the tabs.
     *
     * This is the only thing that creates or destroys one, and it does so
     * purely by following `pane.tabs` — so a tab switch, which only moves
     * `activeId`, cannot reload a page, because there is no path here that
     * would. That is the pane's whole promise, and it is structural rather
     * than remembered.
     */
    function syncPageViews(): void {
        for (const tab of pane.tabs) {
            if (!pageViews.has(tab.id)) createPageView(tab.id, tab.bookmark);
        }
        for (const id of [...pageViews.keys()]) {
            if (!pane.tabs.some(t => t.id === id)) destroyPageView(id);
        }
    }

    function destroyPageView(id: string): void {
        const view = pageViews.get(id);
        if (!view) return;
        pageViews.delete(id);
        if (!win.isDestroyed()) win.contentView.removeChildView(view);
        if (!view.webContents.isDestroyed()) view.webContents.close();
    }

    function createPageView(id: string, url: string): void {
        const view = new WebContentsView({
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                webSecurity: true,
                partition: PAGES_PARTITION
                // backgroundThrottling is left at Chromium's default, unlike
                // the game view: a reference page nobody is looking at should
                // cost nothing, and none of them has a loop that has to keep
                // running. A hidden page mid-boot does boot more slowly for it
                // — Lost City's forums are Discourse, which keeps working long
                // after its document is complete — but it does get there, which
                // was checked rather than assumed.
            }
        });
        view.setBackgroundColor('#17120d');
        view.setVisible(false);
        win.contentView.addChildView(view);
        pageViews.set(id, view);

        const wc = view.webContents;
        // The toolbar's whole state, read from main rather than reported by a
        // preload: these views get none, which keeps "the shell is the only
        // view with a preload" true of the pane as well as of the game.
        const report = (): void => {
            if (win.isDestroyed() || wc.isDestroyed()) return;
            placePane({
                kind: 'navigated',
                id,
                url: wc.getURL(),
                title: wc.getTitle(),
                canGoBack: wc.navigationHistory.canGoBack(),
                canGoForward: wc.navigationHistory.canGoForward()
            });
        };
        wc.on('page-title-updated', report);
        wc.on('did-navigate', report);
        // Fires on every hash change, and the clue coordinator changes its hash
        // as you click around the map. The reducer answers an update that says
        // nothing new with the state it already had, so these cost nothing.
        wc.on('did-navigate-in-page', report);
        wc.on('did-start-loading', () => placePane({ kind: 'loading', id, loading: true }));
        wc.on('did-stop-loading', () => {
            placePane({ kind: 'loading', id, loading: false });
            report();
        });
        wc.on('did-fail-load', (_event, code, description, failed, isMainFrame) => {
            // -3 is ERR_ABORTED: a load superseded by another, not a failure.
            if (!isMainFrame || code === -3) return;
            deps.log(`${tag} page ${id} could not load ${failed}: ${description} (${code})`);
        });

        const policy = (event: { preventDefault: () => void }, target: string): void => {
            const decision = decidePageNavigation({ target, hosts: server.hosts });
            if (decision === 'allow') return;
            event.preventDefault();
            if (decision === 'open-external') {
                deps.log(`${tag} sent ${target} to the system browser`);
                void shell.openExternal(target);
            } else {
                deps.log(`${tag} blocked ${target}`);
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

    /**
     * The one way the pane moves. Every rule about which tab is in front and
     * what that costs the layout lives in `reducePane`; this end of it only
     * names the gesture, reconciles the views and redraws.
     *
     * A no-op action stops here. The state is pushed on every layout, and
     * `did-navigate-in-page` alone would otherwise have main serialising a
     * whole ShellState per click on a map.
     */
    function placePane(action: PaneAction): void {
        if (win.isDestroyed()) return;
        const next = reducePane(pane, action, { maxWidth: paneCeiling() });
        if (next === pane) return;
        const wasWidth = paneLayoutWidth(pane);
        const wasShowing = pane.collapsed ? null : pane.activeId;
        pane = next;
        syncPageViews();
        // Three different costs, and most updates owe only the last of them.
        // A change in what the pane takes from the window needs the window
        // laid out again; a change in which view is in front needs bounds and
        // visibility; a title or a back button going grey needs neither, and
        // `did-navigate-in-page` fires one of those on every hash change —
        // the clue coordinator emits one per click on its map.
        if (paneLayoutWidth(pane) !== wasWidth) {
            applyLayout();
            return;
        }
        if ((pane.collapsed ? null : pane.activeId) !== wasShowing) syncPageBounds(rects.page);
        pushState();
    }

    function openPage(url: string): void {
        // There is no address box, so the shell has no legitimate reason to
        // name a page that is not one of this server's own links — and a page
        // view lives in a session shared with every other window's.
        const link = server.bookmarks.find(b => b.url === url);
        if (!link) {
            deps.log(`${tag} refused to open ${url}: not one of this server's links`);
            return;
        }
        const had = pane.tabs.some(t => t.bookmark === link.url);
        placePane({ kind: 'open', bookmark: link.url, label: link.name });
        deps.log(`${tag} ${had ? 'brought' : 'opened'} ${link.name} ${had ? 'to the front of' : 'in'} the pane`);
    }

    function setPaneWidth(px: number): number {
        if (typeof px !== 'number' || !Number.isFinite(px)) return rects.page?.width ?? pane.width;
        placePane({ kind: 'resize', width: px });
        // Written even when the clamp landed where the pane already was: the
        // number is app-wide, and another window opening a pane next should get
        // the width this drag actually reached.
        deps.rememberPageWidth(pane.width);
        // The width the pane was *drawn* at, not the one it asked for. The two
        // part company whenever the window is too narrow for everything at once
        // — `splitWindow` claws pixels back after the reducer has had its say —
        // and the grip is showing the drawn one. Answering with the request
        // would have every frame of a drag aim from a number the seam is not at.
        return rects.page?.width ?? pane.width;
    }

    function pageGo(where: 'back' | 'forward' | 'reload'): void {
        const active = activeTab(pane);
        const view = active ? pageViews.get(active.id) : undefined;
        if (!view || view.webContents.isDestroyed()) return;
        const history = view.webContents.navigationHistory;
        if (where === 'back') {
            if (history.canGoBack()) history.goBack();
        } else if (where === 'forward') {
            if (history.canGoForward()) history.goForward();
        } else {
            view.webContents.reload();
        }
    }

    // ── the game view ────────────────────────────────────────────────────

    /**
     * The one way the game view changes page. Each load gets its own promise,
     * and settles the one before it: a waiter left pending by a load this one
     * supersedes — the starting page, then the game — is settled by this
     * load's result rather than left hanging.
     */
    function loadGame(url: string): Promise<LoadResult> {
        expected = url;
        failedOver = false;
        gameLoadPending = true;
        const previous = loadWaiter;
        loadPromise = new Promise<LoadResult>(resolve => {
            loadWaiter = result => {
                resolve(result);
                previous?.(result);
            };
        });
        refreshLabels();
        pushState();
        void gameView.webContents.loadURL(url);
        return loadPromise;
    }

    /**
     * The starting page in the state the service is in. Only a single-player
     * window shows it. `pagefailed` is the page's own state, not the world's:
     * the world is up and its page is what would not load.
     */
    function showStarting(override?: { state: SinglePlayerView['status'] | 'pagefailed'; reason: string }): void {
        if (!single || win.isDestroyed()) return;
        const view = single.view();
        const version = view.version ? `engine ${view.version.engine.slice(0, 8)} · content ${view.version.content.slice(0, 8)} · rev ${view.version.revision}` : '';
        // This page supersedes a game load still in flight — the world died between
        // becoming ready and the page finishing. Chromium reports the superseded load
        // as ERR_ABORTED, which did-fail-load ignores, and this page's own
        // did-finish-load settles nothing, so the waiter would wait forever.
        if (gameLoadPending) settleLoad('failed');
        failedOver = true;
        void gameView.webContents.loadFile(STARTING_PAGE, {
            query: {
                state: override?.state ?? view.status,
                version,
                reason: override?.reason ?? view.reason ?? '',
                log: view.logTail.slice(-20).join('\n')
            }
        });
    }

    /** The world changed state: load the game when it is ready, show the page otherwise. */
    let loadedGameUrl: string | null = null;
    function syncSinglePlayer(): void {
        if (!single) return;
        const view = single.view();
        refreshLabels();
        pushState();
        if (view.status === 'ready' && view.url) {
            if (loadedGameUrl !== view.url) {
                loadedGameUrl = view.url;
                void loadGame(view.url);
            }
            return;
        }
        loadedGameUrl = null;
        showStarting();
    }

    function settleLoad(result: LoadResult): void {
        const waiter = loadWaiter;
        loadWaiter = null;
        gameLoadPending = false;
        waiter?.(result);
    }

    // Nothing the page does may replace the game. The one exception is our
    // own offline page returning to the page main asked for.
    gameView.webContents.on('will-navigate', (event, url) => {
        const decision = decideNavigation({ current: gameView.webContents.getURL(), target: url, expected });
        if (decision === 'allow') return;
        event.preventDefault();
        if (decision === 'retry') {
            deps.log(`${tag} retrying the world`);
            // Forgetting the url is what lets the same one be loaded again: when the
            // world is already up and only its page failed, retry() resolves off the
            // ready status without changing it, so nothing notifies and syncSinglePlayer
            // would otherwise see the url it has already loaded and do nothing.
            loadedGameUrl = null;
            void single?.retry().then(
                () => syncSinglePlayer(),
                () => syncSinglePlayer()
            );
            return;
        }
        if (decision === 'open-external') {
            deps.log(`${tag} sent ${url} to the system browser`);
            void shell.openExternal(url);
        } else {
            deps.log(`${tag} blocked navigation to ${url}`);
        }
    });
    gameView.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url)) void shell.openExternal(url);
        return { action: 'deny' };
    });
    gameView.webContents.on('context-menu', event => event.preventDefault());
    // Mouse back and forward buttons would walk the history of world switches.
    win.on('app-command', (event, command) => {
        if (command === 'browser-backward' || command === 'browser-forward') event.preventDefault();
    });

    gameView.webContents.on('did-start-navigation', (_event, url) => {
        // A retry from the offline page is a fresh attempt.
        if (!url.startsWith('file:')) failedOver = false;
    });
    gameView.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
        // -3 is ERR_ABORTED: a load superseded by another, not a failure.
        if (!isMainFrame || code === -3) return;
        failedOver = true;
        deps.log(`${tag} could not load ${url}: ${description} (${code})`);
        settleLoad('failed');
        if (single) {
            // The service's own view says why the world is not there. When it says
            // the world is running, the page itself is what failed, and the starting
            // page has to say so rather than claim the world is up.
            const running = single.view().status === 'ready';
            showStarting(running ? { state: 'pagefailed', reason: 'The game page did not load, though the world is running.' } : undefined);
            return;
        }
        void gameView.webContents.loadFile(OFFLINE_PAGE, {
            query: { url: expected, name: gameLabel(), reason: description }
        });
    });
    // `insertCSS` is per-document, so it must be re-applied on every navigation. `dom-ready`
    // (Chromium's DOMContentLoaded) is the earliest hook Electron exposes for that;
    // `did-finish-load` (below, used for the load waiter) waits for the 'load' event — every
    // subresource — and is much later. dom-ready is *not* guaranteed ahead of first paint here:
    // the client's own game code is a deferred `type="module"` script, which delays
    // DOMContentLoaded until it has fetched and run, while Chromium can paint the
    // already-parsed, already-styled page before that finishes. So a brief flash is possible —
    // but only at sizes where the page actually overflows its view (the bare-canvas floor, or
    // the dock pushing content below it; the default size never overflows) — and it is still
    // strictly earlier than did-finish-load. World hopping and detail switching both funnel
    // through `loadGame`'s `loadURL` on this same view, so they re-fire `dom-ready` and
    // re-inject too — nothing server-specific is needed here.
    gameView.webContents.on('dom-ready', () => {
        // The kit's own offline and starting pages are already sized to fit; this is for the client.
        if (gameView.webContents.getURL().startsWith('file:')) return;
        void gameView.webContents.insertCSS(GAME_PAGE_CSS);
    });
    gameView.webContents.on('did-finish-load', () => {
        const url = gameView.webContents.getURL();
        if (url.startsWith('file:')) {
            deps.log(`${tag} showing a kit page`);
            return;
        }
        // Chromium commits its own error page under the failed URL before the offline page replaces it.
        if (failedOver) return;
        deps.log(`${tag} loaded ${url}`);
        // Every load adds a history entry; none of them is somewhere to go back to.
        gameView.webContents.navigationHistory.clear();
        settleLoad('loaded');
        void probeCurrent();
    });

    // ── the current world's latency ──────────────────────────────────────

    let currentProbe: NodeJS.Timeout | null = null;
    let probingCurrent = false;

    async function probeCurrent(): Promise<void> {
        if (!worldSwitch || probingCurrent || win.isDestroyed()) return;
        probingCurrent = true;
        try {
            const { host, port } = worldEndpoint(expected);
            currentLatency = await deps.probe(host, port, PROBE_TIMEOUT_MS);
        } catch {
            currentLatency = null;
        } finally {
            probingCurrent = false;
        }
        if (win.isDestroyed()) return;
        refreshLabels();
        pushState();
    }

    if (worldSwitch) currentProbe = setInterval(() => void probeCurrent(), PROBE_EVERY_MS);
    const unsubscribeWorlds = deps.worlds?.subscribe(() => pushState()) ?? null;

    // ── lifecycle ────────────────────────────────────────────────────────

    // The page keeps its own title; the window keeps the server's name and world.
    win.on('page-title-updated', event => event.preventDefault());
    win.on('close', event => {
        if (!deps.confirmClose(spec.title)) event.preventDefault();
    });
    win.on('closed', () => {
        if (currentProbe) clearInterval(currentProbe);
        if (panelProbe) clearInterval(panelProbe);
        // The views go with the window; the `persist:pages` session does not, so
        // a LostHQ login outlives both this window and this launch.
        for (const id of [...pageViews.keys()]) destroyPageView(id);
        unsubscribeWorlds?.();
        unsubscribeSingle?.();
        single?.release();
        onClosed();
    });

    shellView.webContents.once('did-finish-load', () => {
        if (win.isDestroyed()) return;
        applyLayout();
        win.show();
    });

    applyLayout();
    refreshLabels();
    loadShell(shellView.webContents);

    let unsubscribeSingle: (() => void) | null = null;
    if (single) {
        // The load promise stays pending until the game itself loads, or the world fails.
        loadPromise = new Promise<LoadResult>(resolve => {
            loadWaiter = resolve;
        });
        unsubscribeSingle = single.subscribe(syncSinglePlayer);
        showStarting();
        void single.acquire().then(
            () => syncSinglePlayer(),
            () => {
                syncSinglePlayer();
                settleLoad('failed');
            }
        );
    } else {
        void loadGame(expected);
    }

    return {
        id: spec.id,
        window: win,
        shellContentsId: shellView.webContents.id,
        focus: () => {
            if (win.isMinimized()) win.restore();
            win.focus();
        },
        close: () => win.close(),
        togglePanel,
        selectTool,
        moveChat,
        syncChatHome,
        // Asked of the window rather than answered from a flag kept alongside
        // it. The window is where the state actually lives, so a copy here
        // would be a second one to keep in step, and the menu is built from
        // whichever window has focus — a place where the copy that went stale
        // would be checked against a different window entirely. It also answers
        // honestly for a window on its way out, where a remembered `true` would
        // tick the box for something already gone. (macOS keeps the level
        // across fullscreen, checked rather than assumed, so there is no
        // platform surprise for this to be guarding against — only the two
        // reasons above.)
        alwaysOnTop: () => !win.isDestroyed() && win.isAlwaysOnTop(),
        setAlwaysOnTop: on => {
            if (win.isDestroyed()) return;
            win.setAlwaysOnTop(on);
            deps.log(`${tag} ${on ? 'pinned above other windows' : 'unpinned'}`);
        },
        openPage,
        activatePage: id => placePane({ kind: 'activate', id }),
        closePage: id => placePane({ kind: 'close', id }),
        setPaneCollapsed: collapsed => placePane({ kind: 'set-collapsed', collapsed }),
        setPaneWidth,
        pageGo,
        relayout: applyLayout,
        state,
        pushState,
        whenGameLoaded: () => loadPromise,
        switchWorld: async world => {
            if (!worldSwitch || !deps.worlds) return 'unknown';
            const target = deps.worlds.view().worlds.find(w => w.id === world);
            if (!target) return 'unknown';
            let url: string;
            try {
                url = worldSwitch.select(target);
            } catch (err) {
                deps.log(`${tag} cannot address world ${world}: ${(err as Error).message}`);
                return 'unknown';
            }
            currentLatency = null;
            deps.remember(worldSwitch.remembered());
            deps.log(`${tag} switching to world ${world} (${worldSwitch.detail}) — ${url}`);
            return loadGame(url);
        },
        setDetail: async detail => {
            if (!worldSwitch) return 'unchanged';
            const url = worldSwitch.setDetail(detail);
            if (!url) return 'unchanged';
            deps.remember(worldSwitch.remembered());
            deps.log(`${tag} reloading world ${worldSwitch.world} at ${detail} detail`);
            return loadGame(url);
        },
        refreshWorlds: async () => {
            if (!deps.worlds || !worldSwitch) return;
            await deps.worlds.list(true);
            await deps.worlds.probeAll(worldSwitch.detail);
        },
        settle: async () => {
            // Two frames: the first schedules the render, the second proves it
            // composited. Raced against a timeout because requestAnimationFrame
            // does not fire at all in an occluded window — waiting on it alone
            // hangs forever, which is exactly what it did.
            const painted = shellView.webContents
                .executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
                .catch(() => undefined);
            await Promise.race([painted, new Promise(resolve => setTimeout(resolve, 1_500))]);
        },
        captureShell: () => shellView.webContents.capturePage(),
        captureGame: () => gameView.webContents.capturePage(),
        capturePage: async () => {
            const active = activeTab(pane);
            const view = active && !pane.collapsed ? pageViews.get(active.id) : undefined;
            if (!view || view.webContents.isDestroyed()) return null;
            // Two frames, exactly as `settle` does for the shell, and for a
            // reason this feature demonstrated: a view that has just been shown
            // has not composited since, so capturePage hands back the frame it
            // was hidden on. That photographed a forum that had long since
            // finished booting as a page still showing its loading spinner —
            // a stale frame reported as a broken feature, which is the whole
            // hazard the shell's own settle exists for.
            const painted = view.webContents
                .executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
                .catch(() => undefined);
            await Promise.race([painted, new Promise(resolve => setTimeout(resolve, 1_500))]);
            return view.webContents.capturePage();
        }
    };
}
