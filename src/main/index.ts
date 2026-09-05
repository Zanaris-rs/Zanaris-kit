import { app, BrowserWindow, dialog, ipcMain, shell, type NativeImage, type WebContents } from 'electron';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerDef } from '../shared/catalog';
import { IPC, type ShellState } from '../shared/ipc';
import { Catalog } from './catalog';
import { ServerWindows } from './windows';
import { createServerWindow, type ServerWindow } from './serverWindow';
import { installMenu, type MenuActions } from './menu';

/** Dev-only: open every server, screenshot every view, and exit. See captureAndExit(). */
const CAPTURE_DIR = process.env.SWIFTKIT_CAPTURE;

const log = (msg: string): void => console.log(msg);

let quitting = false;
const catalog = new Catalog(join(app.getPath('userData'), 'servers.json'));
/** Modification time of servers.json at the last load, so a focus change only re-reads it when it changed. */
let catalogSeen = 0;
const serverWindows = new Map<number, ServerWindow>();
const byShell = new Map<number, ServerWindow>();

// ── windows ───────────────────────────────────────────────────────────────

function focusedServerWindow(): ServerWindow | undefined {
    const focused = BrowserWindow.getFocusedWindow();
    return [...serverWindows.values()].find(sw => sw.window === focused);
}

/** New windows cascade from the focused one, so several can open without stacking exactly. */
function nextPosition(): { x: number; y: number } | null {
    const anchor = focusedServerWindow() ?? [...serverWindows.values()].at(-1);
    if (!anchor || anchor.window.isDestroyed()) return null;
    const { x, y } = anchor.window.getBounds();
    return { x: x + 32, y: y + 32 };
}

function confirmClose(title: string): boolean {
    if (quitting) return true;
    const choice = dialog.showMessageBoxSync({
        type: 'question',
        buttons: ['Close', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `Close ${title}?`,
        detail: "You'll be logged out."
    });
    return choice === 0;
}

const windows = new ServerWindows((spec, onClosed) => {
    const sw = createServerWindow(
        spec,
        () => {
            serverWindows.delete(spec.id);
            byShell.delete(sw.shellContentsId);
            log(`[main] closed ${spec.title}`);
            onClosed();
        },
        { log, confirmClose, position: nextPosition() }
    );
    serverWindows.set(spec.id, sw);
    byShell.set(sw.shellContentsId, sw);
    log(`[main] opened ${spec.title} — ${spec.server.url} (${spec.partition})`);
    return sw;
});

function openServer(server: ServerDef): ServerWindow {
    return serverWindows.get(windows.open(server).id)!;
}

function windowFor(sender: WebContents): ServerWindow | undefined {
    return byShell.get(sender.id);
}

// ── the server list ───────────────────────────────────────────────────────

function catalogMtime(): number {
    return existsSync(catalog.file) ? statSync(catalog.file).mtimeMs : 0;
}

function loadCatalog(): void {
    catalog.load();
    catalogSeen = catalogMtime();
    installMenu(catalog.list(), actions);
    if (catalog.recovered) {
        log(`[main] ${catalog.file} could not be read; the defaults were written and the old file kept beside it`);
        void dialog.showMessageBox({
            type: 'warning',
            message: "Your server list couldn't be read and was reset to the defaults.",
            detail: `The old file was kept beside ${catalog.file}.`
        });
    }
}

/** Re-read servers.json if it changed since the last load. Runs when the app regains focus. */
function reloadCatalogIfChanged(): void {
    if (catalogMtime() === catalogSeen) return;
    loadCatalog();
    log(`[main] server list reloaded: ${catalog.list().length} servers`);
}

const actions: MenuActions = {
    newWindow: () => {
        const focused = focusedServerWindow();
        const server = focused ? (catalog.get(focused.state().server.id) ?? focused.state().server) : catalog.list()[0];
        if (!server) {
            void dialog.showMessageBox({ type: 'info', message: 'The server list is empty.', detail: 'Use File > Edit Server List… to add one.' });
            return;
        }
        openServer(server);
    },
    newWindowFor: id => {
        const server = catalog.get(id);
        if (server) openServer(server);
    },
    editServers: () => {
        void shell.openPath(catalog.file);
    },
    reloadServers: () => {
        loadCatalog();
        log(`[main] server list reloaded: ${catalog.list().length} servers`);
    },
    togglePanel: () => focusedServerWindow()?.togglePanel()
};

// ── ipc ───────────────────────────────────────────────────────────────────

ipcMain.handle(IPC.shellGet, (event): ShellState | null => windowFor(event.sender)?.state() ?? null);

ipcMain.handle(IPC.shellTogglePanel, event => windowFor(event.sender)?.togglePanel());

// ── dev capture ───────────────────────────────────────────────────────────

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Open every catalog server, wait for each game to load (or fail over to the
 * offline page), let the clients draw, then write each window's shell and game
 * views as PNGs. Then open the panel on a loaded window and capture it again
 * (the layout engine), and open a second instance of that server (slots and
 * partitions). A window's own webContents holds nothing, so the views are
 * captured one by one, and a view with no frame yet is skipped rather than
 * allowed to abort the run.
 */
async function captureAndExit(dir: string): Promise<void> {
    mkdirSync(dir, { recursive: true });
    const settleMs = Number(process.env.SWIFTKIT_CAPTURE_WAIT) || 15_000;
    const loadTimeoutMs = 60_000;

    const save = async (name: string, capture: () => Promise<NativeImage>): Promise<void> => {
        try {
            const image = await capture();
            writeFileSync(join(dir, `${name}.png`), image.toPNG());
            const { width, height } = image.getSize();
            log(`[capture] ${name}.png ${width}x${height}`);
        } catch (err) {
            log(`[capture] ${name}.png skipped: ${(err as Error).message}`);
        }
    };
    const shoot = async (name: string, sw: ServerWindow): Promise<void> => {
        await save(`${name}-shell`, () => sw.captureShell());
        await save(`${name}-game`, () => sw.captureGame());
    };
    const loaded = (sw: ServerWindow): Promise<'loaded' | 'failed' | 'timeout'> =>
        Promise.race([sw.whenGameLoaded(), wait(loadTimeoutMs).then((): 'timeout' => 'timeout')]);

    try {
        const started = Date.now();
        const opened = catalog.list().map(openServer);
        const results = await Promise.all(
            opened.map(async sw => {
                const result = await loaded(sw);
                const text = result === 'timeout' ? `still loading after ${loadTimeoutMs}ms` : result;
                log(`[capture] ${sw.state().title}: ${text} (+${Date.now() - started}ms)`);
                return result;
            })
        );
        log(`[capture] settling for ${settleMs}ms`);
        await wait(settleMs);

        for (const sw of opened) await shoot(sw.state().server.id, sw);

        // The layout and slot checks use a window whose game actually loaded, if any did.
        const first = opened[results.indexOf('loaded')] ?? opened[0];
        if (!first) throw new Error('the server list is empty');
        first.togglePanel();
        await wait(500);
        log(`[capture] panel open on ${first.state().title}: mode ${first.state().mode}`);
        await shoot(`${first.state().server.id}-panel`, first);

        const second = openServer(first.state().server);
        log(`[capture] ${second.state().title}: ${await loaded(second)}`);
        await wait(Math.min(settleMs, 8_000));
        await shoot(`${first.state().server.id}-2`, second);
    } catch (err) {
        log(`[capture] aborted: ${(err as Error).stack ?? String(err)}`);
    } finally {
        quitting = true;
        app.quit();
    }
}

// ── app ───────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
    loadCatalog();

    log('');
    log('  SwiftKit');
    log(`  catalog : ${catalog.file}`);
    for (const server of catalog.list()) {
        log(`  ${server.id.padEnd(16)} rev ${String(server.revision ?? '?').padEnd(4)} ${server.url}`);
    }
    log('');

    if (CAPTURE_DIR) {
        await captureAndExit(CAPTURE_DIR);
        return;
    }
    actions.newWindow();
});

app.on('activate', () => {
    if (serverWindows.size === 0) actions.newWindow();
});

app.on('browser-window-focus', () => reloadCatalogIfChanged());

app.on('before-quit', () => {
    quitting = true;
});

// macOS keeps running with no windows; the menu and the dock open the next one.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
