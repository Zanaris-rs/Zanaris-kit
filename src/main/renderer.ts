import { join } from 'node:path';
import type { WebContents } from 'electron';

const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL;

export function preloadPath(): string {
    return join(__dirname, '../preload/index.js');
}

/** One renderer bundle serves both windows; `?view=` picks which React tree mounts. */
export function loadRenderer(contents: WebContents, view: 'shell' | 'launcher'): void {
    if (RENDERER_DEV_URL) void contents.loadURL(`${RENDERER_DEV_URL}?view=${view}`);
    else void contents.loadFile(join(__dirname, '../renderer/index.html'), { query: { view } });
}
