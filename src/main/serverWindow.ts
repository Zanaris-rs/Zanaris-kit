import { BrowserWindow, WebContentsView, screen, shell, type NativeImage } from 'electron';
import { join } from 'node:path';
import { IPC, type ShellState, type ToolId } from '../shared/ipc';
import { MIN_CONTENT_HEIGHT, MIN_CONTENT_WIDTH, RAIL_WIDTH, STRIP_HEIGHT, type LayoutMode } from '../shared/layout';
import type { ChatView } from '../shared/chat';
import type { Detail, RememberedWorld, WorldsView } from '../shared/worlds';
import type { SinglePlayerView } from '../shared/singleplayer';
import { computeLayout, sideWidth, splitWindow, type Rects } from './layout';
import { decideNavigation } from './guard';
import { GAME_TAB_ID, TabModel } from './tabs';
import { loadShell, preloadPath } from './renderer';
import { windowTitle } from './slots';
import { WorldSwitch } from './worlds/switch';
import { worldEndpoint } from './worlds/sources';
import type { WorldsService } from './worlds/service';
import type { ServerWindowHandle, WindowSpec } from './windows';

const OFFLINE_PAGE = join(__dirname, '../../static/offline.html');
const STARTING_PAGE = join(__dirname, '../../static/starting.html');
/** The content area a new window opens with: the canvas plus the page's controls strip. */
const DEFAULT_CONTENT = { width: 800, height: 640 };
const PROBE_EVERY_MS = 10_000;
const PROBE_TIMEOUT_MS = 3_000;

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
    /**
     * The one conversation, which is the app's rather than this window's: every
     * window shows the same one. A getter rather than the service itself, since
     * the window only ever reads it — main pushes when it changes.
     */
    chat: () => ChatView;
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
    /** Opens the panel on a tool; null closes it. */
    selectTool(id: ToolId | null): void;
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
    const tabs = new TabModel({ title: server.name, url: server.url });
    const worldSwitch = server.worlds && deps.worlds ? new WorldSwitch(server.worlds, server.url, deps.remembered) : null;
    // Chat is app-scoped, so every window offers it, and first: it is there
    // whether or not the server has worlds to hop between.
    const single = server.kind === 'singleplayer' ? deps.singlePlayer : null;
    const tools: ToolId[] = single ? ['chat', 'singleplayer'] : worldSwitch ? ['chat', 'worlds'] : ['chat'];

    /** The URL main last asked the game view to load. The offline page may return to it; nothing else may navigate. */
    let expected = worldSwitch ? worldSwitch.url : server.url;
    let currentLatency: number | null = null;
    let panelOpen = false;
    let activeTool: ToolId | null = null;
    let mode: LayoutMode = 'widen';
    let rects: Rects = splitWindow(DEFAULT_CONTENT.width + RAIL_WIDTH, STRIP_HEIGHT + DEFAULT_CONTENT.height, false, 'game');
    let contentWidth = DEFAULT_CONTENT.width;
    let applying = false;
    let failedOver = false;
    let loadWaiter: ((result: LoadResult) => void) | null = null;
    let loadPromise: Promise<LoadResult> = Promise.resolve('loaded');

    const win = new BrowserWindow({
        width: DEFAULT_CONTENT.width + RAIL_WIDTH,
        height: STRIP_HEIGHT + DEFAULT_CONTENT.height,
        minWidth: MIN_CONTENT_WIDTH + RAIL_WIDTH,
        minHeight: STRIP_HEIGHT + MIN_CONTENT_HEIGHT,
        useContentSize: true,
        ...(deps.position ?? {}),
        title: spec.title,
        backgroundColor: '#17120d',
        show: false
    });

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
        tabs.setTitle(GAME_TAB_ID, gameLabel());
        tabs.setUrl(GAME_TAB_ID, expected);
        if (!win.isDestroyed()) win.setTitle(title());
    }

    // ── state ────────────────────────────────────────────────────────────

    function worldsView(): WorldsView | null {
        if (!worldSwitch || !deps.worlds || !server.worlds) return null;
        return { ...deps.worlds.view(), current: worldSwitch.world, detail: worldSwitch.detail, showDetail: server.worlds.detail };
    }

    function state(): ShellState {
        const active = tabs.active.id;
        return {
            windowId: spec.id,
            server,
            slot: spec.slot,
            title: title(),
            tabs: tabs.list().map(t => ({ ...t, active: t.id === active })),
            panelOpen,
            mode,
            rects,
            tools,
            activeTool,
            worlds: worldsView(),
            chat: deps.chat(),
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

    function applyLayout(): void {
        if (win.isDestroyed()) return;
        const current = win.getContentBounds();
        const display = screen.getDisplayMatching(win.getBounds());
        const result = computeLayout({
            panelOpen,
            activeTabKind: tabs.active.kind,
            window: current,
            workArea: display.workArea,
            contentWidth,
            canResize: !win.isMaximized() && !win.isFullScreen()
        });

        mode = result.mode;
        rects = result;
        const w = result.window;
        if (w.x !== current.x || w.y !== current.y || w.width !== current.width || w.height !== current.height) {
            applying = true;
            win.setContentBounds(w);
            applying = false;
        }
        shellView.setBounds({ x: 0, y: 0, width: w.width, height: w.height });
        gameView.setBounds(result.content);
        pushState();
    }

    win.on('resize', () => {
        if (applying) return;
        contentWidth = Math.max(MIN_CONTENT_WIDTH, win.getContentBounds().width - sideWidth(panelOpen));
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
        const wanted = panelOpen && activeTool === 'worlds' && worldSwitch !== null && deps.worlds !== null;
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

    function selectTool(id: ToolId | null): void {
        if (id !== null && !tools.includes(id)) return;
        if (id === null) {
            panelOpen = false;
        } else {
            activeTool = id;
            panelOpen = true;
        }
        applyLayout();
        syncPanelProbe();
    }

    function togglePanel(): void {
        panelOpen = !panelOpen;
        if (panelOpen && activeTool === null) activeTool = tools[0] ?? null;
        deps.log(`${tag} panel ${panelOpen ? 'opened' : 'closed'}`);
        applyLayout();
        syncPanelProbe();
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

    /** The starting page in the state the service is in. Only a single-player window shows it. */
    function showStarting(override?: { state: SinglePlayerView['status']; reason: string }): void {
        if (!single || win.isDestroyed()) return;
        const view = single.view();
        const version = view.version ? `engine ${view.version.engine.slice(0, 8)} · content ${view.version.content.slice(0, 8)} · rev ${view.version.revision}` : '';
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
            void single?.retry().catch(() => undefined);
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
            showStarting(running ? { state: 'failed', reason: 'The game page did not load, though the world is running.' } : undefined);
            return;
        }
        void gameView.webContents.loadFile(OFFLINE_PAGE, {
            query: { url: expected, name: gameLabel(), reason: description }
        });
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
        captureGame: () => gameView.webContents.capturePage()
    };
}
