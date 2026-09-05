import { app, BrowserWindow, dialog, ipcMain, net, shell, type NativeImage, type WebContents } from 'electron';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerDef } from '../shared/catalog';
import { IPC, TOOL_IDS, type ShellState, type ToolId } from '../shared/ipc';
import { Catalog } from './catalog';
import { AppState } from './appState';
import { ServerWindows } from './windows';
import { createServerWindow, type ServerWindow } from './serverWindow';
import { installMenu, type MenuActions } from './menu';
import { WorldsService } from './worlds/service';
import { probeLatency } from './worlds/probe';

/** Dev-only: open every server, screenshot every view, and exit. See captureAndExit(). */
const CAPTURE_DIR = process.env.SWIFTKIT_CAPTURE;

const log = (msg: string): void => console.log(msg);

let quitting = false;
const catalog = new Catalog(join(app.getPath('userData'), 'servers.json'));
/** Capture mode keeps its state beside its screenshots, so a test switch never changes what the next real launch opens. */
const appState = new AppState(join(CAPTURE_DIR ?? app.getPath('userData'), 'state.json'));
/** One world list per server, shared by every window of that server. Built lazily: net.fetch needs the app ready. */
const worldsServices = new Map<string, WorldsService>();

async function fetchJson(url: string): Promise<unknown> {
    const response = await net.fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

function worldsServiceFor(server: ServerDef): WorldsService | null {
    if (!server.worlds) return null;
    let service = worldsServices.get(server.id);
    if (!service) {
        service = new WorldsService(server.worlds, { fetchJson, probe: probeLatency, now: Date.now });
        worldsServices.set(server.id, service);
    }
    return service;
}
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
        {
            log,
            confirmClose,
            position: nextPosition(),
            worlds: worldsServiceFor(spec.server),
            remembered: appState.world(spec.server.id),
            remember: remembered => appState.setWorld(spec.server.id, remembered),
            probe: probeLatency
        }
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

ipcMain.handle(IPC.shellSelectTool, (event, id: unknown) => {
    if (id !== null && !(TOOL_IDS as readonly string[]).includes(id as string)) return;
    windowFor(event.sender)?.selectTool(id as ToolId | null);
});

ipcMain.handle(IPC.worldsRefresh, event => windowFor(event.sender)?.refreshWorlds());

ipcMain.handle(IPC.worldsSwitch, async (event, world: unknown) => {
    if (typeof world !== 'number' || !Number.isInteger(world)) return;
    await windowFor(event.sender)?.switchWorld(world);
});

ipcMain.handle(IPC.worldsSetDetail, async (event, detail: unknown) => {
    if (detail !== 'low' && detail !== 'high') return;
    await windowFor(event.sender)?.setDetail(detail);
});

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
        let lastError: unknown = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const image = await capture();
                writeFileSync(join(dir, `${name}.png`), image.toPNG());
                const { width, height } = image.getSize();
                log(`[capture] ${name}.png ${width}x${height}${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
                return;
            } catch (err) {
                lastError = err;
                await wait(1_500);
            }
        }
        log(`[capture] ${name}.png skipped: ${(lastError as Error).message}`);
    };
    const shoot = async (name: string, sw: ServerWindow): Promise<void> => {
        // Front the window first: macOS refuses to capture an occluded surface,
        // and a page that is not painting would hand back a stale frame anyway.
        sw.window.moveTop();
        sw.focus();
        await wait(400);
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

        // The Worlds tool: open it on a loaded window that has worlds, wait for
        // the list, capture it, switch to another world, capture that. The
        // window goes to the front first: a page in an occluded window stops
        // painting, and capturePage would return its last frame.
        const hopper = opened.find((sw, i) => results[i] === 'loaded' && sw.state().worlds !== null);
        if (hopper) {
            const id = hopper.state().server.id;
            hopper.window.moveTop();
            hopper.focus();
            await wait(500);
            hopper.selectTool('worlds');
            const until = Date.now() + 20_000;
            while (Date.now() < until && hopper.state().worlds?.status === 'loading') await wait(250);
            await wait(4_000);
            const view = hopper.state().worlds;
            log(`[capture] ${id} worlds: ${view?.status} ${view?.worlds.map(w => `W${w.id}=${w.players ?? '?'}p/${w.latencyMs ?? '?'}ms`).join(' ')}${view?.error ? ` error: ${view.error}` : ''}`);
            await shoot(`${id}-worlds`, hopper);
            const target = view?.worlds.find(w => w.id !== view.current);
            if (target) {
                const result = await Promise.race([hopper.switchWorld(target.id), wait(loadTimeoutMs).then((): 'timeout' => 'timeout')]);
                log(`[capture] ${id} switched to world ${target.id}: ${result}`);
                await wait(Math.min(settleMs, 8_000));
                await shoot(`${id}-w${target.id}`, hopper);
                log(`[capture] tab now reads "${hopper.state().tabs[0]?.title}", title "${hopper.window.getTitle()}"`);
                log(`[capture] state file: ${existsSync(appState.file) ? readFileSync(appState.file, 'utf8').replace(/\s+/g, ' ') : '(none)'}`);
            }
        }

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
    appState.load();

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
