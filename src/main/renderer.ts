import { join } from 'node:path';
import type { WebContents } from 'electron';
import { decideShellNavigation } from './guard';
import { Recoveries } from './recovery';

const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL;

export function preloadPath(): string {
    return join(__dirname, '../preload/index.js');
}

/**
 * Loads the renderer bundle: the shell every server window shows, or, given
 * `hash`, another page of the same bundle, which `main.tsx` tells apart. The
 * one other page is Settings, at `#settings`.
 *
 * It also holds the contents to that page, since every page this loads
 * carries the preload: `decideShellNavigation` says why and what gets
 * through. Call it once per contents, as each caller does, or the handlers
 * stack.
 *
 * No windows open from it either. Without a handler Electron opens one for
 * any `window.open` or middle-clicked link, as a bare window in the default
 * session with none of the kit's guards. A middle click never reaches chat's
 * `onClick`, so a link in the chat log, middle-clicked, opened one.
 *
 * And it is reloaded when its renderer goes. A game window whose shell has
 * crashed has no tab bar and no pane headers — nothing to offer a way back
 * from — while the game under it keeps running; Settings would be a blank
 * window. So neither asks: the page is reloaded, as often as `Recoveries`
 * allows, and a page that keeps crashing is left for the window's own close.
 */
export function loadShell(contents: WebContents, hash?: string): void {
    contents.on('will-navigate', (event, url) => {
        if (decideShellNavigation({ current: contents.getURL(), target: url }) === 'block') event.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const recoveries = new Recoveries();
    contents.on('render-process-gone', (_event, details) => {
        if (details.reason === 'clean-exit' || contents.isDestroyed()) return;
        if (!recoveries.allow(Date.now())) {
            console.log(`[main] ${hash ?? 'shell'} page gone again (${details.reason}); not reloading it again this minute`);
            return;
        }
        console.log(`[main] ${hash ?? 'shell'} page gone (${details.reason}); reloading it`);
        contents.reload();
    });
    if (RENDERER_DEV_URL) void contents.loadURL(hash ? `${RENDERER_DEV_URL}#${hash}` : RENDERER_DEV_URL);
    else void contents.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined);
}
