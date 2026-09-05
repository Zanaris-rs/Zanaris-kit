import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SERVERS } from './servers';
import { ServerRegistry } from './registry';
import { createGameWindow } from './gameWindow';
import { IPC, type OpenResult } from '../shared/ipc';

const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL;
/** Dev-only: open every server, screenshot each window, and exit. See captureAndExit(). */
const CAPTURE_DIR = process.env.SWIFTKIT_CAPTURE;

const log = (msg: string): void => console.log(msg);

let launcher: BrowserWindow | null = null;
const gameWindows = new Map<string, BrowserWindow>();

function pushState(): void {
    if (!launcher || launcher.isDestroyed()) return;
    launcher.webContents.send(IPC.serversState, registry.list());
}

/** Game windows cascade from the launcher so several can open without stacking exactly. */
function nextPosition(): { x: number; y: number } | null {
    if (!launcher) return null;
    const { x, y, width } = launcher.getBounds();
    const step = 32 * gameWindows.size;
    return { x: x + width + 16 + step, y: y + step };
}

const registry = new ServerRegistry(
    DEFAULT_SERVERS,
    (server, onClosed) => {
        const gw = createGameWindow(
            server,
            nextPosition(),
            () => {
                gameWindows.delete(server.id);
                log(`[main] closed ${server.id}`);
                onClosed();
            },
            log
        );
        gameWindows.set(server.id, gw.window);
        log(`[main] opened ${server.id} — ${server.url}`);
        return gw;
    },
    pushState
);

function createLauncher(): BrowserWindow {
    const win = new BrowserWindow({
        width: 440,
        height: 520,
        minWidth: 380,
        minHeight: 360,
        useContentSize: true,
        title: 'SwiftKit',
        backgroundColor: '#17120d',
        show: false,
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true
        }
    });
    win.once('ready-to-show', () => win.show());
    win.webContents.once('did-finish-load', pushState);
    win.on('closed', () => {
        launcher = null;
    });
    if (RENDERER_DEV_URL) void win.loadURL(RENDERER_DEV_URL);
    else void win.loadFile(join(__dirname, '../renderer/index.html'));
    return win;
}

// ── ipc ───────────────────────────────────────────────────────────────────

ipcMain.handle(IPC.serversList, () => registry.list());

ipcMain.handle(IPC.serverOpen, (_event, id: unknown): OpenResult => {
    if (typeof id !== 'string') return { ok: false, error: 'Bad server id.' };
    return registry.open(id) === 'unknown' ? { ok: false, error: `Unknown server: ${id}` } : { ok: true };
});

ipcMain.handle(IPC.serverOpenUrl, (_event, url: unknown): OpenResult => {
    if (typeof url !== 'string') return { ok: false, error: 'Bad address.' };
    const result = registry.openUrl(url);
    return result.ok ? { ok: true } : result;
});

// ── dev capture ───────────────────────────────────────────────────────────

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Open every built-in server, wait for each to load (or fail over to the
 * offline page), give the clients time to draw their title screens, then
 * write one PNG per window and quit. capturePage() captures page content, so
 * overlapping windows don't matter.
 *
 * This is the objective check that the servers load side by side: a window
 * that stalled would show a black canvas or the "Loading..." placeholder.
 */
async function captureAndExit(dir: string): Promise<void> {
    mkdirSync(dir, { recursive: true });
    const settleMs = Number(process.env.SWIFTKIT_CAPTURE_WAIT) || 15_000;

    for (const server of DEFAULT_SERVERS) registry.open(server.id);

    await Promise.all(
        [...gameWindows].map(
            ([id, win]) =>
                new Promise<void>(resolve => {
                    const done = (what: string): void => {
                        log(`[capture] ${id}: ${what}`);
                        resolve();
                    };
                    win.webContents.once('did-finish-load', () => done('loaded'));
                    win.webContents.once('did-fail-load', (_e, code, desc) => done(`failed — ${desc} (${code})`));
                })
        )
    );
    log(`[capture] settling for ${settleMs}ms`);
    await wait(settleMs);

    const shot = async (name: string, win: BrowserWindow): Promise<void> => {
        const image = await win.webContents.capturePage();
        writeFileSync(join(dir, `${name}.png`), image.toPNG());
        const { width, height } = image.getSize();
        log(`[capture] ${name}.png ${width}x${height}`);
    };
    if (launcher) await shot('launcher', launcher);
    for (const [id, win] of gameWindows) await shot(id, win);

    app.quit();
}

// ── app ───────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
    log('');
    log('  SwiftKit');
    for (const server of DEFAULT_SERVERS) log(`  ${server.id.padEnd(16)} ${server.url}`);
    log('');

    launcher = createLauncher();

    if (CAPTURE_DIR) await captureAndExit(CAPTURE_DIR);
});

app.on('activate', () => {
    if (!launcher) launcher = createLauncher();
});

app.on('window-all-closed', () => app.quit());
