import { app, BrowserWindow, WebContentsView, ipcMain, screen, session, shell } from 'electron';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveServerTarget, isReachable, type ServerTarget } from './serverUrl';
import { WebSocketTap } from './tap';
import { SessionDecoder, type RngDump } from './session';
import { XpTracker } from './xp';
import { loadPrivateKey, decryptLoginBlock } from './rsa';
import { computeLayout, sidebarWidth, MIN_GAME_WIDTH, RAIL_WIDTH } from './layout';
import { IPC, type SidebarState, type SessionState, type SidebarMode, type XpState } from '../shared/ipc';

const SEAM_ENABLED = process.env.SWIFTKIT_SEAM !== '0';
const RNG_PROBE_ENABLED = process.env.SWIFTKIT_RNG !== '0';
const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL;
/** Dev-only: capture the sidebar to PNGs and exit. See captureAndExit(). */
const CAPTURE_DIR = process.env.SWIFTKIT_CAPTURE;

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

const xp = new XpTracker();
let decoder: SessionDecoder | null = null;
let xpKeyed = false;
let xpDegraded: string | null = null;

function pushXpState(): void {
    if (!shellView || shellView.webContents.isDestroyed()) return;
    const state: XpState = {
        rows: xp.rows(),
        totalGained: xp.totalGained(),
        keyed: xpKeyed,
        degraded: xpDegraded
    };
    shellView.webContents.send(IPC.xpState, state);
}

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

// ── decoding ──────────────────────────────────────────────────────────────

/**
 * Local-only sanity check: if the server's private key is on disk, decrypt the
 * login block and confirm the seed we recovered by observing Math.random is the
 * real one. Never required to decode — it exists so the XP numbers are trusted
 * rather than assumed, and it silently does nothing for servers we don't run.
 */
function crossCheckSeed(seeds: number[], rsaBlock: Uint8Array | null): void {
    if (!rsaBlock) return;
    const pemPath = resolve(target.serverRoot, 'engine/data/config/private.pem');
    if (!existsSync(pemPath)) return;
    try {
        const { magic, seeds: truth } = decryptLoginBlock(rsaBlock, loadPrivateKey(pemPath));
        const match = magic === 10 && truth.every((w, i) => w === seeds[i]);
        log(`[seed] oracle cross-check: ${match ? 'MATCH' : `MISMATCH recovered ${seeds} vs true ${truth}`}`);
    } catch (err) {
        log(`[seed] oracle unavailable: ${(err as Error).message}`);
    }
}

function createDecoder(): SessionDecoder {
    return new SessionDecoder({
        log,
        onNeedRandoms: () => {
            void (async () => {
                let dump: RngDump | null = null;
                try {
                    dump = (await gameView!.webContents.executeJavaScript(
                        'window.__swiftkitRng ? window.__swiftkitRng.dump() : null'
                    )) as RngDump | null;
                } catch {
                    /* page gone */
                }
                decoder?.setRandoms(dump);
                // The observer is only needed across the login window.
                try {
                    await gameView!.webContents.executeJavaScript('window.__swiftkitRng && window.__swiftkitRng.disarm()');
                } catch {
                    /* page gone */
                }
            })();
        },
        onKeyed: info => {
            xpKeyed = true;
            xpDegraded = null;
            session_.revision = info.revision;
            session_.seedRecovered = true;
            log(`[seed] keyed on revision ${info.revision} from draw #${info.drawIndex} of ${info.totalDraws}`);
            crossCheckSeed(info.seeds, info.rsaBlock);
            pushSessionState();
            pushXpState();
        },
        onStat: (skill, exp, level) => {
            xp.update(skill, exp, level);
            pushXpState();
        },
        onLogout: () => {
            log('[session] logout');
            xpKeyed = false;
            pushXpState();
        },
        onDegraded: reason => {
            xpKeyed = false;
            xpDegraded = reason;
            session_.seedRecovered = false;
            log(`[session] degraded: ${reason}`);
            pushSessionState();
            pushXpState();
        }
    });
}

// ── dev capture ───────────────────────────────────────────────────────────

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Render the sidebar to PNGs and quit. Uses webContents.capturePage(), which
 * captures page content rather than the screen, so it works regardless of which
 * Space the window is on or whether it is occluded.
 */
async function captureAndExit(dir: string): Promise<void> {
    if (!shellView) return;
    mkdirSync(dir, { recursive: true });

    const shot = async (name: string): Promise<void> => {
        const image = await shellView!.webContents.capturePage();
        writeFileSync(join(dir, `${name}.png`), image.toPNG());
        log(`[capture] ${name}.png`);
    };

    sidebarOpen = false;
    applyLayout();
    await wait(350);
    await shot('rail-closed');

    sidebarOpen = true;
    applyLayout();
    await wait(350);
    await shot('panel-empty');

    const populated: SessionState = {
        serverUrl: target.url,
        socketOpen: true,
        txFrames: 773,
        rxFrames: 2694,
        txBytes: 2100,
        rxBytes: 11909,
        revision: 289,
        seedRecovered: true
    };
    shellView.webContents.send(IPC.sessionState, populated);

    // Two passes: the first sets the baseline the way a login does, the second
    // is the gain. One pass would correctly show zero everywhere.
    const fixture = [[0, 4320, 42], [2, 1180, 38], [3, 1440, 44], [7, 275, 21], [14, 9860, 51]] as const;
    for (const [id, , level] of fixture) xp.update(id, 100_000, level);
    for (const [id, gained, level] of fixture) xp.update(id, 100_000 + gained, level);
    xpKeyed = true;
    pushXpState();
    await wait(350);
    await shot('panel-live');

    await shellView.webContents.executeJavaScript(
        "document.querySelectorAll('[role=tab]')[1].click()"
    );
    await wait(250);
    await shot('panel-xp');

    app.quit();
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
        pushXpState();
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
        decoder = createDecoder();
        tap.onGameFrame = (dir, bytes) => decoder?.feed(dir, bytes);
        tap.onGameSocketOpen = () => {
            // Each connection gets fresh seeds, so start a fresh decoder.
            decoder = createDecoder();
            xp.reset();
            xpKeyed = false;
            xpDegraded = null;
            pushXpState();
        };
        await tap.attach();
    }

    if (CAPTURE_DIR) {
        await new Promise<void>(resolve => shellView!.webContents.once('did-finish-load', () => resolve()));
        await captureAndExit(CAPTURE_DIR);
        return;
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
