import { join } from 'node:path';
import type { WebContents } from 'electron';

const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL;

export function preloadPath(): string {
    return join(__dirname, '../preload/index.js');
}

/** The renderer bundle is the shell; every server window loads it. */
export function loadShell(contents: WebContents): void {
    if (RENDERER_DEV_URL) void contents.loadURL(RENDERER_DEV_URL);
    else void contents.loadFile(join(__dirname, '../renderer/index.html'));
}
