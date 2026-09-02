import { app, BrowserWindow, WebContentsView, ipcMain, screen, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveServerTarget, isReachable, type ServerTarget } from './serverUrl';
import { WebSocketTap } from './tap';
import { HandshakeReader, type Handshake } from './seedProbe';
import { findAdjacentPair, type RngDump } from './rngProbe';
import { loadPrivateKey, decryptLoginBlock } from './rsa';
import { computeLayout, sidebarWidth, MIN_GAME_WIDTH, RAIL_WIDTH } from './layout';
import { IPC, type SidebarState, type SessionState, type SidebarMode } from '../shared/ipc';

const SEAM_ENABLED = process.env.SWIFTKIT_SEAM !== '0';
const RNG_PROBE_ENABLED = process.env.SWIFTKIT_RNG !== '0';
const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL;

const log = (msg: string): void => console.log(msg);

let win: BrowserWindow | null = null;
let gameView: WebContentsView | null = null;
let shellView: WebContentsView | null = null;
let tap: WebSocketTap | null = null;
let target: ServerTarget;
let pollTimer: NodeJS.Timeout | null = null;
let statsTimer: NodeJS.Timeout | null = null;

let sidebarOpen = false;
let sidebarMode: SidebarMode = 'widen';
/** The width the game area should preserve across sidebar toggles. */
let gameWidth = 800;
let applyingLayout = false;

const session_: { revision: number | null; seedRecovered: boolean | null } = {
    revision: null,
    seedRecovered: null
};

// ── layout ────────────────────────────────────────────────────────────────

function applyLayout(): void {
    if (!win || !gameView || !shellView || win.isDestroyed()) return;

    const current = win.getContentBounds();
    const display = screen.getDisplayMatching(win.getBounds());
    const result = computeLayout({
        open: sidebarOpen,
        window: current,
        workArea: display.workArea,
        gameWidth,
        canResize: !win.isMaximized() && !win.isFullScreen()
    });

    sidebarMode = result.mode;

    const w = result.window;
    if (w.x !== current.x || w.y !== current.y || w.width !== current.width || w.height !== current.height) {
        applyingLayout = true;
        win.setContentBounds(w);
        applyingLayout = false;
    }

    gameView.setBounds(result.game);
    shellView.setBounds(result.shell);
    pushSidebarState();
}

function sidebarState(): SidebarState {
    return { open: sidebarOpen, mode: sidebarMode };
}

function pushSidebarState(): void {
    shellView?.webContents.send(IPC.sidebarState, sidebarState());
}

function pushSessionState(): void {
    if (!shellView || shellView.webContents.isDestroyed()) return;
    const stats = tap?.gameStats() ?? { open: false, txFrames: 0, rxFrames: 0, txBytes: 0, rxBytes: 0 };
    const state: SessionState = {
        serverUrl: target.url,
        socketOpen: stats.open,
        txFrames: stats.txFrames,
        rxFrames: stats.rxFrames,
        txBytes: stats.txBytes,
        rxBytes: stats.rxBytes,
        revision: session_.revision,
        seedRecovered: session_.seedRecovered
    };
    shellView.webContents.send(IPC.sessionState, state);
}

// ── seed recovery (spike, retained as the session readout) ────────────────

async function verifySeedRecovery(h: Handshake): Promise<void> {
    session_.revision = h.revision;
    log(`[seed] revision ${h.revision}, server seed ${h.serverSeedHi}/${h.serverSeedLo}`);

    let dump: RngDump | null = null;
    try {
        dump = (await gameView!.webContents.executeJavaScript(
            'window.__swiftkitRng ? window.__swiftkitRng.dump() : null'
        )) as RngDump | null;
    } catch {
        /* probe unavailable */
    }
    if (!dump) {
        log('[seed] RNG probe not installed — cannot recover');
        session_.seedRecovered = false;
        pushSessionState();
        return;
    }

    const pemPath = resolve(target.serverRoot, 'engine/data/config/private.pem');
    if (!existsSync(pemPath)) {
        log('[seed] no private.pem — skipping oracle verification');
        pushSessionState();
        return;
    }

    try {
        const { magic, seeds } = decryptLoginBlock(h.rsaBlock, loadPrivateKey(pemPath));
        const plaintextMatch = seeds[2] === h.serverSeedHi && seeds[3] === h.serverSeedLo;
        const pair = findAdjacentPair(dump, seeds[0], seeds[1]);
        session_.seedRecovered = magic === 10 && plaintextMatch && pair.found;
        log(
            `[seed] recovered=${session_.seedRecovered} (magic ${magic}, plaintext ${plaintextMatch}, ` +
                `pair ${pair.found ? `at draw #${pair.index}/${dump.seq}` : 'not found'})`
        );
    } catch (err) {
        session_.seedRecovered = false;
        log(`[seed] verification failed: ${(err as Error).message}`);
    }

    try {
        await gameView!.webContents.executeJavaScript('window.__swiftkitRng.disarm()');
        log('[rng] disarmed — Math.random restored to native');
    } catch {
        /* page gone */
    }
    pushSessionState();
}

// ── views ─────────────────────────────────────────────────────────────────

function createGameView(): WebContentsView {
    const view = new WebContentsView({
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            // No preload. Our code stays out of the game page entirely.
            session: session.fromPartition('persist:swiftkit-game')
        }
    });

    const allowedOrigin = `http://127.0.0.1:${target.port}`;
    view.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(allowedOrigin) && !url.startsWith('about:')) {
            event.preventDefault();
            log(`[nav] blocked navigation to ${url}`);
        }
    });
    view.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url);
        return { action: 'deny' };
    });

    return view;
}

function createShellView(): WebContentsView {
    const view = new WebContentsView({
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true
        }
    });
    view.setBackgroundColor('#0d0b09');
    if (RENDERER_DEV_URL) {
        void view.webContents.loadURL(RENDERER_DEV_URL);
    } else {
        void view.webContents.loadFile(join(__dirname, '../renderer/index.html'));
    }
    return view;
}

async function loadGameWhenReady(): Promise<void> {
    if (!gameView) return;

    if (await isReachable(target.url)) {
        log(`[main] server reachable — loading ${target.url}`);
        await gameView.webContents.loadURL(target.url);
        return;
    }

    log(`[main] server not reachable at ${target.url} — waiting`);
    pollTimer = setInterval(async () => {
        if (!gameView || gameView.webContents.isDestroyed()) return;
        if (await isReachable(target.url)) {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
            log(`[main] server came up — loading ${target.url}`);
            await gameView.webContents.loadURL(target.url);
        }
    }, 2000);
}

// ── app ───────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
    target = resolveServerTarget();

    log('');
    log('  SwiftKit');
    log(`  server root : ${target.serverRoot}`);
    log(`  target      : ${target.url}`);
    log(`  seam        : ${SEAM_ENABLED ? 'ON (CDP, observe-only)' : 'OFF'}`);
    log('');

    win = new BrowserWindow({
        width: gameWidth + RAIL_WIDTH,
        height: 700,
        minWidth: MIN_GAME_WIDTH + RAIL_WIDTH,
        minHeight: 480,
        title: 'SwiftKit',
        backgroundColor: '#0d0b09',
        show: false
    });

    gameView = createGameView();
    shellView = createShellView();
    win.contentView.addChildView(gameView);
    win.contentView.addChildView(shellView);

    applyLayout();
    win.once('ready-to-show', () => win?.show());
    // The window itself has no web content, so nothing fires ready-to-show.
    shellView.webContents.once('did-finish-load', () => {
        win?.show();
        pushSidebarState();
        pushSessionState();
    });

    win.on('resize', () => {
        if (applyingLayout || !win) return;
        gameWidth = Math.max(MIN_GAME_WIDTH, win.getContentBounds().width - sidebarWidth(sidebarOpen));
        applyLayout();
    });
    // These change whether the window can be widened, so re-run the layout.
    win.on('maximize', () => applyLayout());
    win.on('unmaximize', () => applyLayout());
    win.on('enter-full-screen', () => applyLayout());
    win.on('leave-full-screen', () => applyLayout());
    win.on('closed', () => {
        win = null;
        gameView = null;
        shellView = null;
    });

    // CDP commands deadlock against a view with no renderer, so give it one first.
    await gameView.webContents.loadURL('about:blank');

    if (SEAM_ENABLED) {
        tap = new WebSocketTap(gameView.webContents, log, RNG_PROBE_ENABLED);
        const reader = new HandshakeReader(h => void verifySeedRecovery(h), log);
        tap.onGameFrame = (dir, bytes) => reader.feed(dir, bytes);
        await tap.attach();
    }

    statsTimer = setInterval(pushSessionState, 1000);
    await loadGameWhenReady();
});

ipcMain.handle(IPC.sidebarToggle, () => {
    sidebarOpen = !sidebarOpen;
    applyLayout();
    return sidebarState();
});

ipcMain.handle(IPC.sidebarSetOpen, (_e, open: unknown) => {
    sidebarOpen = open === true;
    applyLayout();
    return sidebarState();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
    if (pollTimer) clearInterval(pollTimer);
    if (statsTimer) clearInterval(statsTimer);
    tap?.detach();
});
