import { app, BrowserWindow, shell, session } from 'electron';
import { resolve } from 'node:path';
import { resolveServerTarget, isReachable, type ServerTarget } from './serverUrl';
import { WebSocketTap } from './tap';

const OFFLINE_PAGE = resolve(__dirname, '../../static/offline.html');
const SEAM_ENABLED = process.env.SWIFTKIT_SEAM !== '0';

function log(msg: string): void {
    console.log(msg);
}

let win: BrowserWindow | null = null;
let tap: WebSocketTap | null = null;
let target: ServerTarget;
let pollTimer: NodeJS.Timeout | null = null;

function createWindow(): BrowserWindow {
    // Own partition so the game page keeps its localStorage prefs (canvasSize,
    // filtering, hideControls) and its IndexedDB asset cache across launches.
    const gameSession = session.fromPartition('persist:swiftkit-game');

    const w = new BrowserWindow({
        width: 800,
        height: 700,
        minWidth: 640,
        minHeight: 480,
        title: 'SwiftKit',
        backgroundColor: '#000000',
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            session: gameSession
        }
    });

    w.once('ready-to-show', () => w.show());

    // v1 is localhost-only and should refuse to be steered anywhere else.
    const allowedOrigin = `http://127.0.0.1:${target.port}`;
    w.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(allowedOrigin) && !url.startsWith('file://')) {
            event.preventDefault();
            log(`[nav] blocked navigation to ${url}`);
        }
    });
    w.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            void shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    return w;
}

/** Show the offline page and poll until the server comes up, then load the game. */
async function loadWhenReady(w: BrowserWindow): Promise<void> {
    if (await isReachable(target.url)) {
        log(`[main] server reachable — loading ${target.url}`);
        await w.loadURL(target.url);
        return;
    }

    log(`[main] server not reachable at ${target.url} — waiting`);
    await w.loadFile(OFFLINE_PAGE, { query: { url: target.url } });

    pollTimer = setInterval(async () => {
        if (!win || win.isDestroyed()) return;
        if (await isReachable(target.url)) {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
            log(`[main] server came up — loading ${target.url}`);
            await win.loadURL(target.url);
        }
    }, 2000);
}

app.whenReady().then(async () => {
    target = resolveServerTarget();

    log('');
    log('  SwiftKit v1 — Electron wrapper walking skeleton');
    log(`  server root : ${target.serverRoot}`);
    log(`  web.port    : ${target.port}`);
    log(`  port source : ${target.source}`);
    log(`  target      : ${target.url}`);
    log(`  seam        : ${SEAM_ENABLED ? 'ON (CDP, observe-only)' : 'OFF'}`);
    log('');

    win = createWindow();

    if (SEAM_ENABLED) {
        // Attach before any page loads so the very first frame is observed.
        // Note: while the debugger is attached, DevTools cannot be opened on this
        // webContents. Run `npm run seam:off` if you need them.
        tap = new WebSocketTap(win.webContents, log);
        tap.attach();
    }

    win.on('closed', () => {
        win = null;
    });

    await loadWhenReady(win);
});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('before-quit', () => {
    if (pollTimer) clearInterval(pollTimer);
    tap?.detach();
});
