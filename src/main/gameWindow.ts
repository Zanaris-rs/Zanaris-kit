import { BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { originOf, partitionFor, type ServerDef } from './servers';
import type { GameWindowHandle } from './registry';

const OFFLINE_PAGE = join(__dirname, '../../static/offline.html');

/** The stock client canvas is 765x503; the pages add a controls strip beneath it. */
const CONTENT_WIDTH = 800;
const CONTENT_HEIGHT = 640;

export interface GameWindow extends GameWindowHandle {
    readonly window: BrowserWindow;
}

/**
 * One plain window per server, loading the server's own page unmodified: no
 * preload, no injected code, its own persistent partition. The only things the
 * wrapper adds are a navigation guard and an offline page.
 *
 * `backgroundThrottling: false` is what makes "play all of them at once"
 * true rather than nominal. The clients run their loop on setTimeout, which
 * Chromium would otherwise slow to once a second in any window that is not in
 * front, and the game would stall the moment you looked at another one.
 */
export function createGameWindow(
    server: ServerDef,
    position: { x: number; y: number } | null,
    onClosed: () => void,
    log: (msg: string) => void
): GameWindow {
    const win = new BrowserWindow({
        width: CONTENT_WIDTH,
        height: CONTENT_HEIGHT,
        minWidth: 765,
        minHeight: 503,
        useContentSize: true,
        ...(position ?? {}),
        title: server.name,
        backgroundColor: '#000000',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            partition: partitionFor(server.id),
            backgroundThrottling: false
        }
    });

    const origin = originOf(server.url);
    const tag = `[${server.id}]`;

    // The window is for this server only. Anything else the page tries to
    // navigate to goes to the system browser instead of replacing the game.
    win.webContents.on('will-navigate', (event, url) => {
        if (url === origin || url.startsWith(`${origin}/`)) return;
        event.preventDefault();
        log(`${tag} sent ${url} to the system browser`);
        if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url)) void shell.openExternal(url);
        return { action: 'deny' };
    });

    // The page keeps its own title; the window keeps the server's name.
    win.on('page-title-updated', event => event.preventDefault());

    win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
        // -3 is ERR_ABORTED: a load superseded by another, not a failure.
        if (!isMainFrame || code === -3) return;
        log(`${tag} could not load ${url}: ${description} (${code})`);
        void win.loadFile(OFFLINE_PAGE, {
            query: { url: server.url, name: server.name, reason: description }
        });
    });
    win.webContents.on('did-finish-load', () => {
        if (win.webContents.getURL().startsWith(origin)) log(`${tag} loaded ${win.webContents.getURL()}`);
    });

    win.on('closed', onClosed);
    void win.loadURL(server.url);

    return {
        window: win,
        focus: () => {
            if (win.isMinimized()) win.restore();
            win.focus();
        },
        close: () => win.close()
    };
}
