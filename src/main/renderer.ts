import { join } from 'node:path';
import type { WebContents } from 'electron';
import { decideShellNavigation } from './guard';

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
 */
export function loadShell(contents: WebContents, hash?: string): void {
    contents.on('will-navigate', (event, url) => {
        if (decideShellNavigation({ current: contents.getURL(), target: url }) === 'block') event.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    if (RENDERER_DEV_URL) void contents.loadURL(hash ? `${RENDERER_DEV_URL}#${hash}` : RENDERER_DEV_URL);
    else void contents.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined);
}
