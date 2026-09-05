import { BrowserWindow, WebContentsView, screen, shell, type NativeImage } from 'electron';
import { join } from 'node:path';
import { IPC, type ShellState } from '../shared/ipc';
import { MIN_CONTENT_HEIGHT, MIN_CONTENT_WIDTH, RAIL_WIDTH, STRIP_HEIGHT, type LayoutMode } from '../shared/layout';
import { computeLayout, sideWidth, splitWindow, type Rects } from './layout';
import { originOf } from './catalog';
import { TabModel } from './tabs';
import { loadRenderer, preloadPath } from './renderer';
import type { ServerWindowHandle, WindowSpec } from './windows';

const OFFLINE_PAGE = join(__dirname, '../../static/offline.html');
/** The content area a new window opens with: the canvas plus the page's controls strip. */
const DEFAULT_CONTENT = { width: 800, height: 640 };

export interface ServerWindowDeps {
    log: (msg: string) => void;
    /** Return false to keep the window open. Main returns true without asking while quitting. */
    confirmClose: (title: string) => boolean;
    position: { x: number; y: number } | null;
}

export interface ServerWindow extends ServerWindowHandle {
    readonly id: number;
    readonly window: BrowserWindow;
    /** The shell view's webContents id, so IPC handlers can find the window from `event.sender`. */
    readonly shellContentsId: number;
    togglePanel(): void;
    state(): ShellState;
    /** Resolves when the game page finished loading, or failed over to the offline page. */
    whenGameLoaded(): Promise<'loaded' | 'failed'>;
    /** Page content of each view, for capture mode. A window's own webContents holds nothing. */
    captureViews(): Promise<{ shell: NativeImage; game: NativeImage }>;
}

/**
 * One server window: a full-window shell view (React, preload) with the game
 * view placed on top of it inside the content rect. Main owns all geometry;
 * the shell only draws where main says things are.
 *
 * The game view has no preload and no IPC. Its page is byte-for-byte what the
 * server served. `backgroundThrottling: false` keeps its setTimeout-driven loop
 * at full rate while another window or tab is in front.
 */
export function createServerWindow(spec: WindowSpec, onClosed: () => void, deps: ServerWindowDeps): ServerWindow {
    const { server } = spec;
    const tag = `[${spec.title}]`;
    const origin = originOf(server.url);
    const tabs = new TabModel({ title: server.name, url: server.url });

    let panelOpen = false;
    let mode: LayoutMode = 'widen';
    let rects: Rects = splitWindow(DEFAULT_CONTENT.width + RAIL_WIDTH, STRIP_HEIGHT + DEFAULT_CONTENT.height, false, 'game');
    let contentWidth = DEFAULT_CONTENT.width;
    let applying = false;

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

    // ── state ────────────────────────────────────────────────────────────

    function state(): ShellState {
        const active = tabs.active.id;
        return {
            windowId: spec.id,
            server,
            slot: spec.slot,
            title: spec.title,
            tabs: tabs.list().map(t => ({ ...t, active: t.id === active })),
            panelOpen,
            mode,
            rects
        };
    }

    function pushState(): void {
        if (!shellView.webContents.isDestroyed()) shellView.webContents.send(IPC.shellState, state());
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

    // ── lifecycle ────────────────────────────────────────────────────────

    // The page keeps its own title; the window keeps the server's name.
    win.on('page-title-updated', event => event.preventDefault());
    win.on('close', event => {
        if (!deps.confirmClose(spec.title)) event.preventDefault();
    });
    win.on('closed', onClosed);

    shellView.webContents.once('did-finish-load', () => {
        if (win.isDestroyed()) return;
        applyLayout();
        win.show();
    });

    // ── the game view ────────────────────────────────────────────────────

    // The view is for this server only. Anything else the page tries to
    // navigate to goes to the system browser instead of replacing the game.
    gameView.webContents.on('will-navigate', (event, url) => {
        if (url === origin || url.startsWith(`${origin}/`)) return;
        event.preventDefault();
        deps.log(`${tag} sent ${url} to the system browser`);
        if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    });
    gameView.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url)) void shell.openExternal(url);
        return { action: 'deny' };
    });

    const gameLoaded = new Promise<'loaded' | 'failed'>(resolve => {
        gameView.webContents.once('did-finish-load', () => resolve('loaded'));
        gameView.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
            if (isMainFrame && code !== -3) resolve('failed');
        });
    });
    gameView.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
        // -3 is ERR_ABORTED: a load superseded by another, not a failure.
        if (!isMainFrame || code === -3) return;
        deps.log(`${tag} could not load ${url}: ${description} (${code})`);
        void gameView.webContents.loadFile(OFFLINE_PAGE, {
            query: { url: server.url, name: server.name, reason: description }
        });
    });
    gameView.webContents.on('did-finish-load', () => {
        const url = gameView.webContents.getURL();
        if (url.startsWith(origin)) deps.log(`${tag} loaded ${url}`);
    });

    applyLayout();
    loadRenderer(shellView.webContents, 'shell');
    void gameView.webContents.loadURL(server.url);

    return {
        id: spec.id,
        window: win,
        shellContentsId: shellView.webContents.id,
        focus: () => {
            if (win.isMinimized()) win.restore();
            win.focus();
        },
        close: () => win.close(),
        togglePanel: () => {
            panelOpen = !panelOpen;
            applyLayout();
        },
        state,
        whenGameLoaded: () => gameLoaded,
        captureViews: async () => ({
            shell: await shellView.webContents.capturePage(),
            game: await gameView.webContents.capturePage()
        })
    };
}
