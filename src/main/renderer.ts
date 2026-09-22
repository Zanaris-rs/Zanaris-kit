import { join } from 'node:path';
import type { WebContents } from 'electron';

const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL;

export function preloadPath(): string {
    return join(__dirname, '../preload/index.js');
}

/**
 * Loads the renderer bundle: the shell every server window shows, or, given
 * `hash`, another page of the same bundle, which `main.tsx` tells apart. The
 * one other page is Settings, at `#settings`.
 */
export function loadShell(contents: WebContents, hash?: string): void {
    if (RENDERER_DEV_URL) void contents.loadURL(hash ? `${RENDERER_DEV_URL}#${hash}` : RENDERER_DEV_URL);
    else void contents.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined);
}
