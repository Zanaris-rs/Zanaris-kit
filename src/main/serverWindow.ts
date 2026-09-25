import { BrowserWindow, Menu, WebContentsView, dialog, screen, shell, type MenuItemConstructorOptions, type NativeImage, type WebContents } from 'electron';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { IPC, type ShellState, type ToolId } from '../shared/ipc';
import { CHAT_PREFERRED_HEIGHT, GAME_PREFERRED_HEIGHT, GAME_PREFERRED_WIDTH, LOSTCITY_GAME_PREFERRED_HEIGHT, PANE_HEADER_HEIGHT, PANE_MIN_HEIGHT, PANE_MIN_WIDTH, SEAM, TAB_BAR_HEIGHT } from '../shared/layout';
import type { ChatView } from '../shared/chat';
import type { Detail, RememberedWorld, WorldsView } from '../shared/worlds';
import type { YourWorldView } from '../shared/yourworld';
import type { ShareView } from '../shared/share';
import type { DropTargets, DropZone, PaneView, SeamView } from '../shared/panes';
import { alertTitle, type TimerDef } from '../shared/timers';
import type { Theme } from '../shared/themes';
import type { ListedTimer } from './timers/defs';
import { TimersRunner, isGameInput } from './timers/runner';
import { showAlertBanner } from './timers/electron';
import { decideNavigation } from './guard';
import { createPaneHost, type PaneHost } from './paneHost';
import { addPaneItems, paneContentItems, paneHeaderItems, paneHolding, paneMenuItems, type GameSizes, type PaneMenuItem } from './paneMenu';
import { canAppendColumn, contentOf, paneIds, parentSplitOf, type PaneContent, type Rect, type Size } from './paneTree';
import { grownFrame, roomFor } from './windowRoom';
import { holdsGame, openWindowTabs, sharingWithoutPane } from './tabs';
import { layoutEntries, layoutFileName, readLayout, writeLayout } from './layoutFile';
import { loadShell, preloadPath } from './renderer';
import { windowTitle } from './slots';
import { WorldSwitch } from './worlds/switch';
import { worldEndpoint } from './worlds/sources';
import type { WorldsService } from './worlds/service';
import type { HiscoresService } from './hiscores/service';
import type { ServerWindowHandle, WindowSpec } from './windows';

const OFFLINE_PAGE = join(__dirname, '../../static/offline.html');
const STARTING_PAGE = join(__dirname, '../../static/starting.html');
/**
 * The content area a new window opens with: the game at its preferred size and
 * the chat pane below it at its own, with the seam between them
 * (`tabs.openWindowTabs`). The tree fills the content area below the bar
 * exactly, so anything short of this would clip the bottom of the
 * canvas at the one size nobody chose. Lost City's page is taller than the
 * stock client's, so its windows open on its own game height.
 */
function defaultContent(serverId: string): { width: number; height: number; game: number } {
    const game = serverId === 'lostcity' ? LOSTCITY_GAME_PREFERRED_HEIGHT : GAME_PREFERRED_HEIGHT;
    return { width: GAME_PREFERRED_WIDTH, height: game + SEAM + CHAT_PREFERRED_HEIGHT, game };
}
/**
 * Room left on the display for the window's own frame, which a content size
 * does not include: a title bar on macOS, a caption and borders on Windows.
 * Generous rather than measured, since the frame cannot be asked for before the
 * window exists and an opening size a few pixels short costs nothing.
 */
const FRAME_ALLOWANCE = 40;
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

/** What a window running your world needs of the service; the service itself satisfies it. */
export interface YourWorldHandle {
    view(): YourWorldView;
    subscribe(fn: () => void): () => void;
    acquire(): Promise<string>;
    release(): void;
    retry(): Promise<string>;
    /** The selected line's build, asked for from the starting page. */
    download(): Promise<void>;
}

/** What a window running your world needs of sharing: a view to draw, and a count of the windows that can stop it. */
export interface ShareHandle {
    view(): ShareView;
    acquire(): void;
    release(): void;
}

const STATUS_WORD: Record<YourWorldView['status'], string> = {
    stopped: 'stopped',
    missing: 'not downloaded',
    downloading: 'downloading',
    preparing: 'getting ready',
    starting: 'starting',
    ready: 'running',
    stopping: 'stopping',
    failed: 'failed'
};

function statusWord(status: YourWorldView['status']): string {
    return STATUS_WORD[status];
}

/**
 * Whether a view composites two frames within a second and a half, for
 * capture mode. Two frames: the first schedules the render, the second proves
 * it composited. Raced against a timeout because requestAnimationFrame does
 * not fire at all in a window that is covered — waiting on it alone hangs
 * forever, which is exactly what it did — and the timeout answers false,
 * because a view that is not painting leaves capturePage its last frame.
 */
export async function paintsFrames(contents: WebContents): Promise<boolean> {
    const frames = contents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))').then(
        () => true,
        () => false
    );
    return Promise.race([frames, new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1_500))]);
}

export interface ServerWindowDeps {
    log: (msg: string) => void;
    /** Return false to keep the window open. Main returns true without asking while quitting. */
    confirmClose: (title: string) => boolean;
    position: { x: number; y: number } | null;
    /** The server's shared world list and latency, or null when the server has one page. */
    worlds: WorldsService | null;
    /** The server's shared hiscores lookup, or null when it offers none — which is what keeps the tool out of the menus of a window running your world. */
    hiscores: HiscoresService | null;
    /**
     * The one conversation, which is the app's rather than this window's: every
     * window shows the same one. A getter rather than the service itself, since
     * the window only ever reads it — main pushes when it changes.
     */
    chat: () => ChatView;
    /**
     * Whether a window opened now should float above other apps, as the last
     * choice anywhere left it.
     */
    alwaysOnTop: () => boolean;
    /**
     * Asks before the game is closed — its pane, a tab holding it, or a layout
     * loaded over the tab holding it — since each destroys the view and
     * disconnects the player. False keeps it. Main
     * returns true without asking when the user has turned the warning off.
     */
    confirmCloseGame: (via: 'pane' | 'tab' | 'layout') => Promise<boolean>;
    /**
     * This server's saved layouts: the folder Save Layout writes into, Load
     * Layout lists and Open Layouts Folder opens. Created when first needed,
     * not before — a player who never saves a layout gets no empty folder.
     */
    layoutsDir: string;
    /** What this server remembered from last time, if anything. */
    remembered: RememberedWorld | null;
    /** Called whenever this window's world or detail changes. */
    remember: (remembered: RememberedWorld) => void;
    /** Latency of one host, for the current world's readout. */
    probe: (host: string, port: number, timeoutMs: number) => Promise<number | null>;
    /** The world this computer runs, for a window of kind singleplayer; null otherwise. */
    yourWorld: YourWorldHandle | null;
    /** Sharing that world. Only a window running your world takes it. */
    share: ShareHandle | null;
    /**
     * This window's clock definitions — its server's built-ins with the
     * player's edits, then the player's own — and whether the player is at
     * the most custom clocks. A getter: main calls `timersChanged` when the
     * app-wide definitions move, and the window reads them again.
     */
    timers: () => { listed: ListedTimer[]; customsFull: boolean };
    /**
     * The theme this window wears: its server's own, or the app's. A getter:
     * either can change while the window is open, and main calls
     * `themeChanged` when one does. It reads the app's state and nothing of
     * this window's — never `state()`, which reads it.
     */
    theme: () => Theme;
}

export interface ServerWindow extends ServerWindowHandle {
    readonly id: number;
    readonly window: BrowserWindow;
    /** The shell view's webContents id, so IPC handlers can find the window from `event.sender`. */
    readonly shellContentsId: number;
    /**
     * The tab bar's Add pane: goes to the pane in this tab already holding
     * `content`, or adds a column down the tab's right edge holding it. The
     * game is moved rather than duplicated. Does nothing when a column is
     * needed and there is no room for one.
     */
    addPane(content: PaneContent): void;
    /**
     * The bar's Sharing button: Your world's pane, added as `addPane` adds one,
     * or in a new tab of its own when the active tab has no room for a column.
     * Nothing on a window that is not Your world's.
     */
    showYourWorld(): void;
    /** Raises the tab bar's Add pane menu at a point in the window. */
    showAddPaneMenu(x: number, y: number): void;
    /** Whether this window floats above other apps. Read back from the window itself, not from a flag kept beside it. */
    alwaysOnTop(): boolean;
    setAlwaysOnTop(on: boolean): void;
    startTimer(id: string): void;
    pauseTimer(id: string): void;
    /** Back to the beginning, and running. */
    resetTimer(id: string): void;
    /** The app-wide definitions changed: this window's runner takes the new list. */
    timersChanged(): void;
    /** Judges this window's clocks at this moment: for a wake from sleep, when the runner's pending timeout is late. */
    settleTimers(): void;
    /** Splits a pane, putting an empty one showing the launcher in the new half. */
    splitPane(paneId: string, axis: 'x' | 'y'): void;
    /** Closes a pane. Asks first when it is the game's, since that disconnects the player. */
    closePane(paneId: string): Promise<void>;
    /** Puts something in a pane. A page must be one of this server's links; asking for the game moves it out of whatever pane held it. */
    setPaneContent(paneId: string, content: PaneContent): void;
    focusPane(paneId: string): void;
    /** Starts a header drag: hides every native view so the shell can draw drop targets over their rects, and answers where each drop would land. Null when the active tab has no such pane. */
    beginPaneDrag(from: string): DropTargets | null;
    /** Drops a dragged pane on another and ends the drag. The centre swaps the two; an edge moves the dragged pane beside the other, splitting it. */
    dropPane(from: string, to: string, zone: DropZone): void;
    /** Ends a drag without dropping. */
    endPaneDrag(): void;
    /** Raises the pane menu at a point in the window. */
    showPaneMenu(paneId: string, x: number, y: number): void;
    /** Raises a pane header's dropdown — everything that pane could become — at a point in the window. */
    showPaneContentMenu(paneId: string, x: number, y: number): void;
    /** Drags a seam. Returns the position actually applied, on every path including the one that changes nothing. */
    setSeam(splitId: string, index: number, px: number): number;
    evenOut(splitId: string): void;
    /** Even out the split the focused pane sits in. The View menu's item, which has a pane rather than a split to go on. */
    evenOutFocused(): void;
    /** The focused page pane's toolbar. */
    pageGo(where: 'back' | 'forward' | 'reload'): void;
    newTab(): void;
    /**
     * Closes a tab and everything in it. Asks first when the tab holds the
     * game, since that disconnects the player; closing the last one closes the
     * window, as it always has, behind the window's own confirm.
     */
    closeTab(tabId: string): Promise<void>;
    selectTab(tabId: string): void;
    /** Raises a tab's menu — save its panes as a layout, load one into it, open the folder — at a point in the window. */
    showTabMenu(tabId: string, x: number, y: number): void;
    /** Writes a tab's panes to a layout file. Throws when the file cannot be written; the menu reports that, capture mode fails on it. */
    saveLayoutTo(tabId: string, path: string): void;
    /**
     * Loads a layout file into a tab, asking first when that closes the game.
     * `unreadable` is a file that could not be read or is not a layout, and
     * leaves the tab as it was.
     */
    loadLayoutFrom(tabId: string, path: string): Promise<'loaded' | 'unreadable' | 'cancelled' | 'missing'>;
    /** Re-runs the layout and pushes the result. For app-wide changes that move things, where pushState alone would only repaint the old geometry. */
    relayout(): void;
    state(): ShellState;
    /** Sends the current state to the shell. For app-wide changes main hears about, not the window. */
    pushState(): void;
    /** The app theme or this server's changed: repaint the native grounds and send the shell its new palette. Nothing reloads. */
    themeChanged(): void;
    /** Resolves when the most recent load finished, or failed over to the offline page. */
    whenGameLoaded(): Promise<LoadResult>;
    switchWorld(world: number): Promise<LoadResult | 'unknown'>;
    setDetail(detail: Detail): Promise<LoadResult | 'unchanged'>;
    refreshWorlds(): Promise<void>;
    /**
     * Whether the shell is painting: true once it has composited two frames
     * since the call, false if it has not within a second and a half.
     * capturePage hands back the last composited frame, so a shot of a shell
     * that is not painting — its window covered by another app's —
     * photographs whatever it last drew, and reads as correct in the log.
     * That had capture mode reporting a stale panel three times over, and
     * writing byte-identical shots of different steps.
     */
    settle(): Promise<boolean>;
    /** Page content of one view, for capture mode. A window's own webContents holds nothing. */
    captureShell(): Promise<NativeImage>;
    captureGame(): Promise<NativeImage>;
    /**
     * The focused page pane, for capture mode. Resolves with null when no pane
     * holds a page: there is no view to shoot. Rejects when the page is not
     * painting, rather than hand back the frame it last drew.
     */
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
    const single = server.kind === 'singleplayer' ? deps.yourWorld : null;
    const shared = single ? deps.share : null;
    /**
     * The tools this window offers. Chat is app-scoped, so every window offers
     * it, and first: it is there whether or not the server has worlds to hop
     * between. Everything after it is this window's server's — worlds to hop
     * between, hiscores to look a player up on, the world this computer runs.
     *
     * Each of the three is offered because the window was *given* the thing
     * behind it, rather than because of what kind of server this is: no
     * hiscores def means no service, no service means no tool, and single
     * player is the case that matters — a one-player world has nothing to
     * rank, and its catalog entry carries no hiscores, so the tool never
     * reaches its menus without anything here naming it.
     *
     * The order declared here is the order every menu lists them in — a
     * pane's dropdown, the launcher and Add pane all take it from
     * `paneMenu.ts`, which takes it from this.
     *
     * Timers is offered in every window: every server carries the built-in
     * clocks, and the player's own are app-wide.
     */
    const tools: ToolId[] = ['chat'];
    if (worldSwitch) tools.push('worlds');
    if (deps.hiscores) tools.push('hiscores');
    tools.push('timers');
    if (single) tools.push('singleplayer');
    // Which tools a window came up with is otherwise only visible by opening a
    // menu, and a tool missing from it looks the same as a tool that drew
    // nothing. One line at open says which of the two happened.
    deps.log(`${tag} tools: ${tools.join(' · ')}`);

    /** The URL main last asked the game view to load. The offline page may return to it; nothing else may navigate. */
    let expected = worldSwitch ? worldSwitch.url : server.url;
    let currentLatency: number | null = null;
    /** Where the window's own chrome sits. The panes' rects belong to the host. */
    let rects = { tabBar: { x: 0, y: 0, width: 0, height: 0 }, tree: { x: 0, y: 0, width: 0, height: 0 } };
    /**
     * The live game view, or null once it has been closed.
     *
     * Closing the game pane, or the tab it is in, destroys it rather than
     * hiding it. A view kept alive behind a closed pane is a character still
     * standing in the world with nobody watching it, which is a worse failure
     * than the fresh login that reopening costs — and the confirm in
     * `index.ts` says so first.
     */
    let gameView: WebContentsView | null = null;
    let failedOver = false;
    let loadWaiter: ((result: LoadResult) => void) | null = null;
    let loadPromise: Promise<LoadResult> = Promise.resolve('loaded');
    /** True between a loadGame and its result, so a kit page can tell it is superseding one. */
    let gameLoadPending = false;

    /*
     * The game and chat together are taller than some laptop displays can show,
     * and a window opened past the bottom of the screen hides the very pane it
     * opened to show. So the height is held to the display it will open on, and
     * the split's shares are worked out from the height the window actually got
     * (see `openWindowTabs`).
     */
    const display = screen.getDisplayNearestPoint(deps.position ?? screen.getCursorScreenPoint());
    const content = defaultContent(server.id);
    const openHeight = Math.max(TAB_BAR_HEIGHT + PANE_MIN_HEIGHT, Math.min(TAB_BAR_HEIGHT + content.height, display.workArea.height - FRAME_ALLOWANCE));
    const win = new BrowserWindow({
        width: content.width,
        height: openHeight,
        // One pane's floor plus the chrome that never gives way. A constant
        // now: the old minimum moved as the dock opened and closed, because it
        // was protecting a region the layout was also protecting. Nothing is
        // protected any more — every pane gives way together — so there is
        // nothing left for the floor to track.
        minWidth: PANE_MIN_WIDTH,
        minHeight: TAB_BAR_HEIGHT + PANE_MIN_HEIGHT,
        useContentSize: true,
        ...(deps.position ?? {}),
        title: spec.title,
        // The theme's ground, which shows only until the shell draws.
        backgroundColor: deps.theme().colors.window,
        show: false,
        // The last choice made anywhere, so a window opened while the app is
        // pinned comes up pinned rather than needing the menu again.
        alwaysOnTop: deps.alwaysOnTop()
    });

    // The one view here with the preload, and so with every call main answers
    // as this window. `loadShell` holds it to its page.
    const shellView = new WebContentsView({
        webPreferences: {
            preload: preloadPath(),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true
        }
    });
    shellView.setBackgroundColor(deps.theme().colors.window);

    /**
     * Builds the game view and puts it in the window.
     *
     * `backgroundThrottling: false` is why a game keeps playing while it is not
     * the tab in front, exactly as it already keeps playing with the whole
     * window behind another app. That is the one thing the tab design rests on
     * that no test here can prove.
     */
    function makeGameView(): WebContentsView {
        const view = new WebContentsView({
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                webSecurity: true,
                partition: spec.partition,
                backgroundThrottling: false
            }
        });
        view.setBackgroundColor('#000000');
        // Order matters: later children draw on top. Every game and page view
        // sits over the shell, which draws the chrome and leaves their rects empty.
        win.contentView.addChildView(view);
        wireGameView(view);
        return view;
    }

    /**
     * This window's clocks. The runner holds every rule; this end gives it a
     * clock and a timer, and turns its alerts into a banner and a sound. Each
     * window has its own, because each game is its own login with its own
     * idle timer.
     */
    const firstTimers = deps.timers();
    let customsFull = firstTimers.customsFull;
    const clocks = new TimersRunner(firstTimers.listed, {
        now: Date.now,
        setTimer: (fn, ms) => {
            const timer = setTimeout(fn, ms);
            return () => clearTimeout(timer);
        },
        alert: (def, at) => alertClock(def, at),
        changed: () => pushState()
    });

    /** A banner only when the window is not focused: in front of the player, the pane and the sound are already enough. */
    function alertClock(def: TimerDef, at: 'threshold' | 'zero'): void {
        const heading = alertTitle(def, at);
        deps.log(`${tag} ${heading}`);
        if (win.isDestroyed()) return;
        if (!win.isFocused()) showAlertBanner(win, heading, title());
        if (def.volume > 0 && !shellView.webContents.isDestroyed()) shellView.webContents.send(IPC.timersAlert, { volume: def.volume });
    }

    win.contentView.addChildView(shellView);
    gameView = makeGameView();

    /**
     * The active tab's panes and the views inside them. Every rule about the
     * tree is in `paneTree`, which is pure and tested; this end of it only
     * names the gesture and lets the window lay out around the answer.
     */
    const host: PaneHost = createPaneHost({
        window: win,
        gameView: () => gameView,
        bookmarks: () => server.bookmarks,
        tools: () => tools,
        hosts: () => server.hosts,
        sharing: () => linkLive(),
        log: line => deps.log(`${tag} ${line}`),
        initial: openWindowTabs(win.getContentBounds().height - TAB_BAR_HEIGHT, content.game),
        changed: () => applyLayout(),
        contextMenu: (paneId, x, y) => showPaneMenu(paneId, x, y),
        touched: () => pushState(),
        background: () => deps.theme().colors.window
    });

    // ── labels ───────────────────────────────────────────────────────────

    function gameLabel(): string {
        // The revision of the line the world runs, which a switch changes under an open window.
        if (single) return `${server.name} · rev ${single.view().revision} · ${statusWord(single.view().status)}`;
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

    /** Which tools are placed in a pane in the active tab, so the Worlds probe runs only while there is a list to show. */
    function openTools(): ToolId[] {
        const tree = host.tree();
        const placed = paneIds(tree)
            .map(id => contentOf(tree, id))
            .filter(content => content?.kind === 'tool')
            .map(content => (content as { kind: 'tool'; tool: ToolId }).tool);
        return tools.filter(id => placed.includes(id));
    }

    /** Whether anyone with the link can reach this world right now. Before `live` the link does not work yet, so there is nothing to mark. */
    function linkLive(): boolean {
        return shared?.view().status === 'live';
    }

    function state(): ShellState {
        return {
            windowId: spec.id,
            server,
            slot: spec.slot,
            title: title(),
            gameLabel: gameLabel(),
            rects,
            tabs: host.tabs(),
            panes: host.panes(),
            seams: host.seams(),
            tools,
            worlds: worldsView(),
            hiscores: deps.hiscores?.view() ?? null,
            chat: deps.chat(),
            yourWorld: single?.view() ?? null,
            share: shared?.view() ?? null,
            sharingWithoutPane: sharingWithoutPane(host.trees(), linkLive()),
            timers: { clocks: clocks.view(), customsFull },
            theme: deps.theme().colors
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

    /**
     * Repaints what main paints — the window, the shell view and every page
     * view, in the theme's ground — and sends the shell its palette. The game
     * view keeps its black: that is the game's own ground, never themed.
     */
    function themeChanged(): void {
        if (win.isDestroyed()) return;
        const ground = deps.theme().colors.window;
        win.setBackgroundColor(ground);
        shellView.setBackgroundColor(ground);
        host.repaintBackground();
        pushState();
    }

    // ── layout ───────────────────────────────────────────────────────────

    /**
     * Where everything goes.
     *
     * The bar across the top and the tree in the rest. The widen / shift /
     * push ladder, the content extent carried across a chrome toggle and the
     * per-axis mode the shell used to report all went with the fixed chrome
     * that motivated them, and so did the tool rail down the right; the bar's
     * Add pane is how a pane is added. The window grows for one thing only: a
     * pane added where the game would otherwise have paid for it
     * (`paneTree.makeRoom`, through `growWindow`), and then it is the resize
     * that lays everything out again, through here.
     *
     * The tree runs to the window's edges. It used to be inset by a pixel so a
     * gold ring round the focused pane had shell to land on; focus is a dot in
     * the pane's header now, and a border of ink round every window was all
     * that pixel had left to do.
     */
    function applyLayout(): void {
        if (win.isDestroyed()) return;
        const { width, height } = win.getContentBounds();
        rects = {
            tabBar: { x: 0, y: 0, width, height: Math.min(TAB_BAR_HEIGHT, height) },
            tree: { x: 0, y: TAB_BAR_HEIGHT, width, height: Math.max(0, height - TAB_BAR_HEIGHT) }
        };
        shellView.setBounds({ x: 0, y: 0, width, height });
        host.layout(rects.tree);
        pushState();
    }

    win.on('resize', () => applyLayout());
    // A maximise or a fullscreen changes the content bounds without a resize
    // event on every platform, so the layout is re-run for both.
    win.on('maximize', () => applyLayout());
    win.on('unmaximize', () => applyLayout());
    win.on('enter-full-screen', () => applyLayout());
    win.on('leave-full-screen', () => applyLayout());

    // ── the panes ────────────────────────────────────────────────────────

    let panelProbe: NodeJS.Timeout | null = null;

    /** The whole list is probed only while a Worlds pane is open somewhere in this window. */
    function syncPanelProbe(): void {
        const worlds = deps.worlds;
        const wanted = openTools().includes('worlds') && worldSwitch !== null && worlds !== null;
        if (wanted && worlds && !panelProbe) {
            const probeAll = (): void => {
                void worlds.probeAll(worldSwitch!.detail);
            };
            // The list first, then latencies over it. `probeAll` has nothing to
            // probe until the worlds are known, so an open that only probed
            // left the pane reading "idle" until someone pressed Refresh —
            // which is exactly what dropping this line did.
            void worlds.list().then(probeAll);
            panelProbe = setInterval(probeAll, PROBE_EVERY_MS);
        } else if (!wanted && panelProbe) {
            clearInterval(panelProbe);
            panelProbe = null;
        }
    }

    /**
     * The tab bar's Add pane. Something already in this tab is brought into
     * focus instead of opened a second time — the menu ticks it, so that is
     * what the player was told would happen — and anything else gets a new
     * column down the tab's right edge (`paneTree.appendColumn`), with the
     * window grown by what the column would have taken from the game
     * (`split` does the same). Nothing already on screen is replaced, which
     * is the difference from a pane's own dropdown: that one changes a pane,
     * this one adds one.
     *
     * The game goes in through `setPaneContent` rather than straight into the
     * column, because it is a move: the window has one game view, and the pane
     * it leaves in another tab has to be emptied in the same breath.
     */
    function addPane(content: PaneContent): void {
        if (content.kind === 'tool' && !tools.includes(content.tool)) return;
        if (content.kind === 'page' && !server.bookmarks.some(b => b.url === content.bookmark)) return;
        const open = paneHolding(host.tree(), content);
        if (open) {
            host.focus(open);
            return;
        }
        if (!canAppendColumn(host.tree(), rects.tree.width)) {
            deps.log(`${tag} no room to add a pane`);
            return;
        }
        const born = host.appendColumn(content.kind === 'game' ? { kind: 'empty' } : content, rects.tree.width, roomToGrow());
        growWindow(born.grown);
        if (content.kind === 'game') setPaneContent(born.paneId, content);
        syncPanelProbe();
    }

    /** Split Right and Split Down, from the menus, the header's dropdown and the keyboard alike. */
    function split(paneId: string, axis: 'x' | 'y'): void {
        growWindow(host.split(paneId, axis, roomToGrow()));
    }

    /**
     * How much the window may grow for a pane the game would otherwise pay
     * for (`paneTree.makeRoom`): up to the size of its display, and not at all
     * while it is maximised or full screen, since it already fills the screen
     * and a resize would only take it out of that.
     */
    function roomToGrow(): Size {
        if (win.isDestroyed() || win.isFullScreen() || win.isMaximized()) return { width: 0, height: 0 };
        const frame = win.getBounds();
        return roomFor(frame, screen.getDisplayMatching(frame).workArea);
    }

    /** The window grown by what a new pane needed, kept on its display (`windowRoom.grownFrame`). Its resize lays everything out again. */
    function growWindow(by: Size): void {
        if (win.isDestroyed() || (by.width <= 0 && by.height <= 0)) return;
        const frame = win.getBounds();
        win.setBounds(grownFrame(frame, screen.getDisplayMatching(frame).workArea, by));
    }

    function showYourWorld(): void {
        if (!single) return;
        const content: PaneContent = { kind: 'tool', tool: 'singleplayer' };
        if (paneHolding(host.tree(), content) || canAppendColumn(host.tree(), rects.tree.width)) {
            addPane(content);
            return;
        }
        host.newTab();
        host.setContent(host.focusedPaneId(), content);
    }

    /**
     * The menu under the tab bar's Add pane: everything a new column could
     * hold, from `paneMenu.addPaneItems`, which is the dropdown's list with
     * two differences it works out and tests — what is already in this tab is
     * ticked, and everything else is greyed when the tab has no room for
     * another column.
     *
     * Native and built here for the reason the pane menus are: it drops down
     * over the panes, and a list the shell drew would open behind a game or a
     * page view.
     */
    function showAddPaneMenu(x: number, y: number): void {
        if (win.isDestroyed()) return;
        const items = addPaneItems({ tree: host.tree(), trees: host.trees(), tools, links: server.bookmarks, width: rects.tree.width });
        const template: MenuItemConstructorOptions[] = items.flatMap((item, i): MenuItemConstructorOptions[] => [
            ...(i > 0 && item.group === 'link' && items[i - 1]!.group !== 'link' ? [{ type: 'separator' as const }] : []),
            {
                label: item.label,
                // Ticked the way a Window menu ticks the window already open:
                // choosing it goes there rather than opening another.
                type: 'checkbox' as const,
                checked: item.openIn !== null,
                enabled: item.enabled,
                click: () => addPane(item.content)
            }
        ]);
        Menu.buildFromTemplate(template).popup({ window: win, x: Math.round(x), y: Math.round(y) });
    }

    /**
     * Puts something in a pane, with the one refusal main owes the shell and
     * the one thing it does instead of refusing.
     *
     * A page may only be one of this server's own links: there is no address
     * box, so the shell has no legitimate reason to name anything else, and a
     * page view lives in a session shared with every other window's.
     *
     * The game is not refused; it *moves*. Two game leaves stay
     * unrepresentable — the window is bound to one server and has one game
     * view — but asking for the game in a second pane now empties the pane it
     * was in, in whichever tab that was, rather than being ignored. It costs
     * nothing: the view is repositioned by the next layout and never reloaded,
     * so the login survives a move exactly as it survives a seam drag. Only a
     * window with no game at all pays a login, and that is a fresh one being
     * opened rather than one being moved.
     */
    function setPaneContent(paneId: string, content: PaneContent): void {
        if (content.kind === 'page' && !server.bookmarks.some(b => b.url === content.bookmark)) {
            deps.log(`${tag} refused to open ${content.bookmark}: not one of this server's links`);
            return;
        }
        if (content.kind === 'game') {
            if (!gameView) {
                gameView = makeGameView();
                void loadGame(expected);
            }
            host.moveGame(paneId);
        } else {
            host.setContent(paneId, content);
        }
        syncPanelProbe();
    }

    /**
     * What Reset Game Size puts the game back to: the size a new window of this
     * server opens it at, Lost City's taller page included, against the rect
     * the tab is laid out in now.
     */
    function gameSizes(): GameSizes {
        return { tab: rects.tree, game: { width: GAME_PREFERRED_WIDTH, height: content.game } };
    }

    /**
     * The pane menu, raised by a right-click anywhere in a pane.
     *
     * Built in main rather than drawn by the shell because a right-click on a
     * game or a page never reaches the shell — those are native views stacked
     * above it, and only they see the pointer. One builder with three callers
     * is the only way the menu is the same object everywhere; a shell-drawn one
     * would have had to be a second menu for the two kinds of pane it cannot
     * cover, and two menus are two menus that drift.
     *
     * Which items are legal is `paneMenu.ts`, which is pure and tested against
     * the same minimums the solver enforces — an item offered and then refused
     * is worse than one never offered.
     */
    function showPaneMenu(paneId: string, x: number, y: number): void {
        if (win.isDestroyed()) return;
        const rect = host.rectOf(paneId);
        if (!rect) return;
        // Right-clicking a pane focuses it first, so the menu acts on what was
        // clicked rather than on whatever happened to have focus — every item
        // below names the pane, but Even Out and the accelerators do not.
        host.focus(paneId);
        const menu = Menu.buildFromTemplate(paneMenuItems(host.tree(), paneId, rect, gameSizes()).map(item => gestureItem(paneId, item)));
        menu.popup({ window: win, x: Math.round(x), y: Math.round(y) });
    }

    /** One gesture as a native menu item, for both menus that carry gestures. */
    function gestureItem(paneId: string, item: PaneMenuItem): MenuItemConstructorOptions {
        return {
            label: item.label,
            enabled: item.enabled,
            accelerator: item.accelerator,
            registerAccelerator: false,
            click: () => {
                if (item.id === 'split-x') split(paneId, 'x');
                else if (item.id === 'split-y') split(paneId, 'y');
                else if (item.id === 'close') void closePane(paneId);
                else if (item.id === 'reset-game') host.resetGame(gameSizes().game);
                else {
                    const splitId = parentSplitOf(host.tree(), paneId);
                    if (splitId) host.evenOut(splitId);
                }
            }
        };
    }

    /**
     * The dropdown in a pane's header: everything that pane could become, and
     * then, under a rule, the two ways to split it — which `paneSplitItems`
     * takes from the right-click menu, because nothing on screen says that
     * menu exists and the arrow is the control a player will actually try.
     *
     * Native, and built here, for the reason the gesture menu above is: the
     * header of a game or a page pane sits directly over a native view, and a
     * list the shell drew would open behind it. Building it in main is also
     * what lets one object serve all four kinds of pane — the launcher an empty
     * pane shows is the same list from the same function, wearing the stone
     * instead of the system's chrome.
     *
     * Which items exist, what they are called and which one is already showing
     * are `paneMenu.ts`'s, not this function's and certainly not the shell's.
     * The game's label is the one that moves: it reads "Move game here" while
     * the game is in some other pane of this window, in this tab or another.
     */
    function showPaneContentMenu(paneId: string, x: number, y: number): void {
        if (win.isDestroyed()) return;
        host.focus(paneId);
        const items = paneContentItems({ trees: host.trees(), paneId, tools, links: server.bookmarks });
        const template: MenuItemConstructorOptions[] = items.flatMap((item, i): MenuItemConstructorOptions[] => [
            // The links are a different kind of destination from the window's
            // own things, and the group each item arrives in is what says where
            // that line falls — the same rule the launcher draws.
            ...(i > 0 && item.group === 'link' && items[i - 1]!.group !== 'link' ? [{ type: 'separator' as const }] : []),
            {
                label: item.label,
                // A radio rather than a checkbox: a pane holds exactly one
                // thing, so these are alternatives rather than a set of toggles.
                type: 'radio' as const,
                checked: item.current,
                click: () => setPaneContent(paneId, item.content)
            }
        ]);
        const rect = host.rectOf(paneId);
        const gestures = rect ? paneHeaderItems(host.tree(), paneId, rect, gameSizes()) : [];
        if (gestures.length > 0) template.push({ type: 'separator' }, ...gestures.map(item => gestureItem(paneId, item)));
        Menu.buildFromTemplate(template).popup({ window: win, x: Math.round(x), y: Math.round(y) });
    }

    /**
     * Closes a pane, asking first when it is the game's.
     *
     * Closing the game destroys its view, which disconnects the player. The
     * alternative — keeping it alive behind a closed pane — is worse than the
     * fresh login reopening costs: a character still standing in the world with
     * nobody watching it dies to events its player cannot see. So the view goes,
     * and the confirm says so before it does.
     */
    async function closePane(paneId: string): Promise<void> {
        const isGame = contentOf(host.tree(), paneId)?.kind === 'game';
        if (isGame) {
            if (!(await deps.confirmCloseGame('pane'))) return;
            destroyGame('pane');
        }
        host.close(paneId);
        syncPanelProbe();
    }

    /**
     * Closes a tab, asking first when the game is in it.
     *
     * The same cost as closing the game's pane and the same answer: the view is
     * destroyed rather than left running with no pane to show it in. Before
     * this asked, closing a game's tab removed the leaf and kept the view — a
     * character still logged in behind a window that no longer had anywhere to
     * put it, reachable only by moving the game back, which is exactly the
     * silently hidden game `CLAUDE.md`'s invariant rules out.
     *
     * The last tab is the window, and goes through `win.close()` so the
     * window's own confirm — which already says the player will be logged out —
     * is the only one asked; a second sheet about the same disconnect would be
     * one too many.
     */
    async function closeTab(tabId: string): Promise<void> {
        const closing = host.closing(tabId);
        if (closing === 'missing') return;
        if (closing === 'window') {
            win.close();
            return;
        }
        if (closing === 'game') {
            if (!(await deps.confirmCloseGame('tab'))) return;
            if (win.isDestroyed()) return;
            // The sheet is window-modal but the menu's accelerators are not, so
            // the game may have moved, or the tab gone, while it was up. Ask
            // again rather than acting on what the tabs said before it opened.
            const now = host.closing(tabId);
            if (now === 'missing') return;
            if (now === 'game') destroyGame('tab');
        }
        if (!host.closeTab(tabId)) win.close();
        syncPanelProbe();
    }

    /** Destroys the game view — never hides it — for a close the user has confirmed. */
    function destroyGame(via: 'pane' | 'tab' | 'layout'): void {
        if (gameView) {
            win.contentView.removeChildView(gameView);
            if (!gameView.webContents.isDestroyed()) gameView.webContents.close();
            gameView = null;
            clocks.gameGone();
        }
        deps.log(`${tag} closed the game ${via === 'layout' ? 'to load a layout' : via} and disconnected`);
    }

    // ── saved layouts ────────────────────────────────────────────────────

    /**
     * The menu a right-click on a tab raises: save that tab's panes as a
     * layout, load one into it, or open the folder the layouts live in so they
     * can be copied and handed to someone else.
     *
     * On the tab rather than in the View menu because a layout *is* a tab's
     * panes — saving one captures exactly what that tab shows, and loading one
     * replaces exactly that — and the tab is the thing being pointed at. It is
     * brought to the front first, for the reason a right-clicked pane is
     * focused first: what the menu acts on should be what is on screen.
     *
     * Nothing here is saved unless the player asks. The window used to write
     * its arrangement after every split and seam drag, and that made the last
     * accident the thing a new window opened with.
     */
    function showTabMenu(tabId: string, x: number, y: number): void {
        if (win.isDestroyed() || !host.treeOf(tabId)) return;
        host.selectTab(tabId);
        const saved = savedLayouts();
        const template: MenuItemConstructorOptions[] = [
            { label: 'Save Layout…', click: () => void saveLayoutAs(tabId) },
            {
                label: 'Load Layout',
                submenu: [
                    ...(saved.length === 0
                        ? [{ label: 'No Saved Layouts', enabled: false }]
                        : saved.map(entry => ({ label: entry.name, click: () => void loadLayoutChosen(tabId, join(deps.layoutsDir, entry.file)) }))),
                    { type: 'separator' },
                    // A layout somebody sent, wherever it was saved to. Loading
                    // it does not copy it into the folder: that is still the
                    // player's to decide, by saving it again.
                    { label: 'From File…', click: () => void loadLayoutFromFile(tabId) }
                ]
            },
            { label: 'Open Layouts Folder', click: () => void openLayoutsFolder() },
            { type: 'separator' },
            { label: 'Close Tab', click: () => void closeTab(tabId) }
        ];
        Menu.buildFromTemplate(template).popup({ window: win, x: Math.round(x), y: Math.round(y) });
    }

    /** The folder's layouts, or none when there is no folder yet. */
    function savedLayouts(): { name: string; file: string }[] {
        try {
            return layoutEntries(readdirSync(deps.layoutsDir));
        } catch {
            return [];
        }
    }

    async function saveLayoutAs(tabId: string): Promise<void> {
        const label = host.tabs().find(tab => tab.id === tabId)?.label;
        if (label === undefined) return;
        try {
            mkdirSync(deps.layoutsDir, { recursive: true });
            const { canceled, filePath } = await dialog.showSaveDialog(win, {
                title: 'Save Layout',
                defaultPath: join(deps.layoutsDir, layoutFileName(label)),
                filters: [{ name: 'Zanaris Kit layout', extensions: ['json'] }]
            });
            if (canceled || !filePath || win.isDestroyed()) return;
            saveLayoutTo(tabId, filePath);
        } catch (err) {
            deps.log(`${tag} could not save a layout: ${(err as Error).message}`);
            if (!win.isDestroyed()) await dialog.showMessageBox(win, { type: 'warning', message: 'The layout could not be saved.', detail: (err as Error).message });
        }
    }

    /** Reads the tab when the file is written rather than when the menu opened: the dialog was up in between. */
    function saveLayoutTo(tabId: string, path: string): void {
        const tree = host.treeOf(tabId);
        if (!tree) throw new Error('that tab has closed');
        writeFileSync(path, writeLayout(tree, server.id));
        deps.log(`${tag} saved layout ${basename(path)}`);
    }

    async function loadLayoutFromFile(tabId: string): Promise<void> {
        try {
            mkdirSync(deps.layoutsDir, { recursive: true });
        } catch {
            // The folder is only where the dialog starts; a file anywhere else still loads.
        }
        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
            title: 'Load Layout',
            defaultPath: deps.layoutsDir,
            properties: ['openFile'],
            filters: [{ name: 'Zanaris Kit layout', extensions: ['json'] }]
        });
        const path = filePaths[0];
        if (canceled || !path || win.isDestroyed()) return;
        await loadLayoutChosen(tabId, path);
    }

    /** Loading from the menu: the same load, and a sheet rather than silence when the file was not a layout. */
    async function loadLayoutChosen(tabId: string, path: string): Promise<void> {
        if ((await loadLayoutFrom(tabId, path)) !== 'unreadable' || win.isDestroyed()) return;
        await dialog.showMessageBox(win, {
            type: 'warning',
            message: "That file isn't a Zanaris Kit layout.",
            detail: `${basename(path)} could not be read as a layout, so the tab was left as it was.`
        });
    }

    /**
     * A layout file, into a tab.
     *
     * What it costs is `tabs.loadingLayout`'s answer, which is pure and tested;
     * this asks the question it raises and acts. When the layout would take the
     * game's leaf away, that is closing the game, so it asks first and destroys
     * the view — the layout invariant in `CLAUDE.md`, and the same order
     * `closeTab` keeps, including asking the tabs again once the sheet is down,
     * since the game may have moved while it was up. When the layout wants a
     * game and the window has none left, one is made and loaded, as choosing
     * the game in an empty pane does.
     */
    async function loadLayoutFrom(tabId: string, path: string): Promise<'loaded' | 'unreadable' | 'cancelled' | 'missing'> {
        let text: string;
        try {
            text = readFileSync(path, 'utf8');
        } catch (err) {
            deps.log(`${tag} could not read ${path}: ${(err as Error).message}`);
            return 'unreadable';
        }
        const stored = readLayout(text);
        if (!stored) {
            deps.log(`${tag} refused ${basename(path)}: not a Zanaris Kit layout`);
            return 'unreadable';
        }
        const tree = host.instantiate(stored);
        const loading = host.loading(tabId, tree);
        if (!loading) return 'missing';
        if (loading.dropsGame) {
            if (!(await deps.confirmCloseGame('layout'))) return 'cancelled';
            if (win.isDestroyed()) return 'missing';
            const now = host.loading(tabId, tree);
            if (!now) return 'missing';
            if (now.dropsGame) destroyGame('layout');
        }
        if (holdsGame(tree) && !gameView) {
            gameView = makeGameView();
            void loadGame(expected);
        }
        if (!host.replaceTab(tabId, tree)) return 'missing';
        syncPanelProbe();
        deps.log(`${tag} loaded layout ${basename(path)}`);
        return 'loaded';
    }

    async function openLayoutsFolder(): Promise<void> {
        try {
            mkdirSync(deps.layoutsDir, { recursive: true });
        } catch (err) {
            deps.log(`${tag} could not make ${deps.layoutsDir}: ${(err as Error).message}`);
            return;
        }
        const failed = await shell.openPath(deps.layoutsDir);
        if (failed) deps.log(`${tag} could not open ${deps.layoutsDir}: ${failed}`);
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
        void gameView?.webContents.loadURL(url);
        return loadPromise;
    }

    /**
     * The starting page in the state the service is in. Only a window
     * running your world shows it. `pagefailed` is the page's own state, not the world's:
     * the world is up and its page is what would not load.
     */
    function showStarting(override?: { state: YourWorldView['status'] | 'pagefailed'; reason: string }): void {
        if (!single || win.isDestroyed()) return;
        const view = single.view();
        const line = view.builds.find(l => l.id === view.selected);
        const version = view.version ? `engine ${view.version.engine.slice(0, 8)} · content ${view.version.content.slice(0, 8)} · rev ${view.version.revision}` : '';
        const query = {
            state: override?.state ?? view.status,
            version,
            reason: override?.reason ?? view.reason ?? '',
            log: view.logTail.slice(-20).join('\n'),
            // What a missing world would download, and how far it has got, in tens
            // of percent: finer, and a 50 MB download would reload this page a
            // hundred times.
            build: line ? `${line.name} · rev ${line.revision}` : '',
            size: line?.size != null ? String(Math.round(line.size / 1_000_000)) : '',
            available: line && line.size !== null && line.state !== 'unavailable' ? '1' : '',
            progress: line?.progress != null ? String(Math.floor(line.progress * 10) * 10) : ''
        };
        // Every change to the service lands here while the world is not ready,
        // the store's progress included. The same page already showing is left alone.
        const key = JSON.stringify(query);
        if (key === shownStarting && gameView?.webContents.getURL().includes('starting.html')) return;
        shownStarting = key;
        // This page supersedes a game load still in flight — the world died between
        // becoming ready and the page finishing. Chromium reports the superseded load
        // as ERR_ABORTED, which did-fail-load ignores, and this page's own
        // did-finish-load settles nothing, so the waiter would wait forever.
        if (gameLoadPending) settleLoad('failed');
        failedOver = true;
        void gameView?.webContents.loadFile(STARTING_PAGE, { query });
    }
    /** The query of the starting page last loaded, so an identical one is not loaded again. */
    let shownStarting: string | null = null;

    /** The world changed state: load the game when it is ready, show the page otherwise. */
    let loadedGameUrl: string | null = null;
    function syncYourWorld(): void {
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

    /**
     * The game view's own handlers, wired to the view they belong to rather
     * than to whichever one happened to exist at construction.
     *
     * This is a function because the game view is no longer permanent: closing
     * its pane destroys it, and opening one builds another. Registering these
     * once against the outer binding would leave a rebuilt view with no
     * navigation guard at all — which is the one view in the app that must
     * never accept a page-initiated navigation.
     */
    function wireGameView(view: WebContentsView): void {
        const wc = view.webContents;
        // Nothing the page does may replace the game. The one exception is our
        // own offline page returning to the page main asked for.
        wc.on('will-navigate', (event, url) => {
            const decision = decideNavigation({ current: wc.getURL(), target: url, expected });
            if (decision === 'allow') return;
            event.preventDefault();
            if (decision === 'download') {
                deps.log(`${tag} downloading the world's build`);
                void single?.download();
                return;
            }
            if (decision === 'retry') {
                deps.log(`${tag} retrying the world`);
                // Forgetting the url is what lets the same one be loaded again: when the
                // world is already up and only its page failed, retry() resolves off the
                // ready status without changing it, so nothing notifies and syncYourWorld
                // would otherwise see the url it has already loaded and do nothing.
                loadedGameUrl = null;
                void single?.retry().then(
                    () => syncYourWorld(),
                    () => syncYourWorld()
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
        wc.setWindowOpenHandler(({ url }) => {
            if (/^https?:\/\//.test(url)) void shell.openExternal(url);
            return { action: 'deny' };
        });
        // The game's own menu is refused — nothing Chromium offers on a canvas
        // is any use, and Inspect Element on a game page is not something to
        // hand a player by accident — and the pane menu takes its place. The
        // view's coordinates go back into the window's, which is where popup
        // wants them.
        wc.on('context-menu', (event, params) => {
            event.preventDefault();
            const tree = host.tree();
            const gamePane = paneIds(tree).find(id => contentOf(tree, id)?.kind === 'game');
            const rect = gamePane ? host.rectOf(gamePane) : null;
            // The view starts below the pane's header, so that inset is part of
            // putting the view's coordinates back into the window's.
            if (gamePane && rect) showPaneMenu(gamePane, rect.x + params.x, rect.y + Math.min(PANE_HEADER_HEIGHT, rect.height) + params.y);
        });
        // Mouse back and forward buttons would walk the history of world switches.
        win.on('app-command', (event, command) => {
            if (command === 'browser-backward' || command === 'browser-forward') event.preventDefault();
        });

        wc.on('did-start-navigation', (_event, url) => {
            // A retry from the offline page is a fresh attempt.
            if (!url.startsWith('file:')) failedOver = false;
        });
        // A mouse down or key down anywhere in the game view restarts the AFK
        // clocks; `isGameInput` decides which input counts. That is not the
        // client's idle timer exactly: the client also counts mouse movement,
        // so these can warn early, and counts only input on its canvas, so a
        // click beside the canvas restarts these while the client's timer runs
        // on, and they can warn late.
        wc.on('input-event', (_event, input) => {
            if (isGameInput(input.type, wc.getURL())) clocks.input();
        });
        // A page that actually loads in the game view — a world switch, a
        // detail switch, a retry, the kit's offline or starting page — ends
        // that login's idle timer. `did-navigate` fires only once a main-frame
        // navigation commits, so one the guard above cancels — a link the
        // player clicked, sent to the system browser instead — never reaches
        // this at all: it loaded nothing, so it resets nothing, and the
        // player's AFK clocks keep running while they are still logged in. An
        // in-page navigation (a hash change, pushState) is a different event
        // and does not fire this one either.
        wc.on('did-navigate', () => clocks.gameGone());
        wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
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
            void wc.loadFile(OFFLINE_PAGE, {
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
        wc.on('dom-ready', () => {
            // The kit's own offline and starting pages are already sized to fit; this is for the client.
            if (wc.getURL().startsWith('file:')) return;
            void wc.insertCSS(GAME_PAGE_CSS);
        });
        wc.on('did-finish-load', () => {
            const url = wc.getURL();
            if (url.startsWith('file:')) {
                deps.log(`${tag} showing a kit page`);
                return;
            }
            // Chromium commits its own error page under the failed URL before the offline page replaces it.
            if (failedOver) return;
            deps.log(`${tag} loaded ${url}`);
            // Every load adds a history entry; none of them is somewhere to go back to.
            wc.navigationHistory.clear();
            settleLoad('loaded');
            void probeCurrent();
        });
    }

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
        clocks.dispose();
        if (currentProbe) clearInterval(currentProbe);
        if (panelProbe) clearInterval(panelProbe);
        // The views go with the window; the `persist:pages` session does not, so
        // a LostHQ login outlives both this window and this launch.
        host.destroy();
        unsubscribeWorlds?.();
        unsubscribeSingle?.();
        single?.release();
        shared?.release();
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
    shared?.acquire();
    if (single) {
        // The load promise stays pending until the game itself loads, or the world fails.
        loadPromise = new Promise<LoadResult>(resolve => {
            loadWaiter = resolve;
        });
        unsubscribeSingle = single.subscribe(syncYourWorld);
        showStarting();
        void single.acquire().then(
            () => syncYourWorld(),
            () => {
                syncYourWorld();
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
        addPane,
        showYourWorld,
        showAddPaneMenu,
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
        startTimer: id => clocks.start(id),
        pauseTimer: id => clocks.pause(id),
        resetTimer: id => clocks.reset(id),
        timersChanged: () => {
            const next = deps.timers();
            customsFull = next.customsFull;
            clocks.setDefs(next.listed);
        },
        settleTimers: () => clocks.settle(),
        splitPane: split,
        closePane,
        setPaneContent,
        focusPane: paneId => host.focus(paneId),
        beginPaneDrag: from => host.beginDrag(from),
        dropPane: (from, to, zone) => host.drop(from, to, zone),
        endPaneDrag: () => host.endDrag(),
        showPaneMenu,
        showPaneContentMenu,
        setSeam: (splitId, index, px) => host.dragSeam(splitId, index, px),
        evenOut: splitId => host.evenOut(splitId),
        evenOutFocused: () => {
            const splitId = parentSplitOf(host.tree(), host.focusedPaneId());
            if (splitId) host.evenOut(splitId);
        },
        pageGo: where => host.go(where),
        newTab: () => host.newTab(),
        closeTab,
        selectTab: tabId => host.selectTab(tabId),
        showTabMenu,
        saveLayoutTo,
        loadLayoutFrom,
        relayout: applyLayout,
        state,
        pushState,
        themeChanged,
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
        settle: () => paintsFrames(shellView.webContents),
        captureShell: () => shellView.webContents.capturePage(),
        captureGame: () => gameView?.webContents.capturePage() ?? Promise.reject(new Error('no game view')),
        capturePage: async () => {
            const view = host.pageWebContents();
            if (!view || view.webContents.isDestroyed()) return null;
            // Two frames, exactly as `settle` does for the shell, and for a
            // reason this feature demonstrated: a view that has just been shown
            // has not composited since, so capturePage hands back the frame it
            // was hidden on. That photographed a forum that had long since
            // finished booting as a page still showing its loading spinner —
            // a stale frame reported as a broken feature, which is the whole
            // hazard the shell's own settle exists for. A page that paints
            // nothing is refused rather than shot, for the same reason.
            if (!(await paintsFrames(view.webContents))) throw new Error('the page is not painting');
            return view.webContents.capturePage();
        }
    };
}
