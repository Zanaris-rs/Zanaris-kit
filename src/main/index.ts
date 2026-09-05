import { app, BrowserWindow, dialog, ipcMain, type NativeImage, type WebContents } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NewServerInput } from '../shared/catalog';
import { IPC, type CatalogState, type Result, type ShellState } from '../shared/ipc';
import { Catalog } from './catalog';
import { ServerWindows } from './windows';
import { createServerWindow, type ServerWindow } from './serverWindow';
import { createLauncherWindow } from './launcher';
import { installMenu } from './menu';

/** Dev-only: open every server, screenshot every view, and exit. See captureAndExit(). */
const CAPTURE_DIR = process.env.SWIFTKIT_CAPTURE;

const log = (msg: string): void => console.log(msg);

let quitting = false;
let launcher: BrowserWindow | null = null;
const catalog = new Catalog(join(app.getPath('userData'), 'servers.json'));
const serverWindows = new Map<number, ServerWindow>();
const byShell = new Map<number, ServerWindow>();

// ── catalog state ─────────────────────────────────────────────────────────

function catalogState(): CatalogState {
    return {
        servers: catalog.list().map(s => ({ ...s, openCount: windows.countFor(s.id) })),
        recovered: catalog.recovered
    };
}

function pushCatalog(): void {
    if (launcher && !launcher.isDestroyed()) launcher.webContents.send(IPC.catalogState, catalogState());
}

// ── windows ───────────────────────────────────────────────────────────────

/** New windows cascade from the launcher so several can open without stacking exactly. */
function nextPosition(): { x: number; y: number } | null {
    const anchor = launcher && !launcher.isDestroyed() ? launcher : null;
    if (!anchor) return null;
    const { x, y, width } = anchor.getBounds();
    const step = 32 * serverWindows.size;
    return { x: x + width + 16 + step, y: y + step };
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

const windows = new ServerWindows(
    (spec, onClosed) => {
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
    },
    () => {
        pushCatalog();
        if (windows.list().length === 0 && !quitting) showLauncher();
    }
);

function showLauncher(): void {
    if (launcher && !launcher.isDestroyed()) {
        launcher.show();
        launcher.focus();
        return;
    }
    launcher = createLauncherWindow(() => {
        launcher = null;
    });
    launcher.webContents.once('did-finish-load', pushCatalog);
}

function windowFor(sender: WebContents): ServerWindow | undefined {
    return byShell.get(sender.id);
}

function focusedServerWindow(): ServerWindow | undefined {
    const focused = BrowserWindow.getFocusedWindow();
    return [...serverWindows.values()].find(sw => sw.window === focused);
}

function isNewServerInput(x: unknown): x is NewServerInput {
    if (typeof x !== 'object' || x === null) return false;
    const i = x as Record<string, unknown>;
    const nullableString = (v: unknown): boolean => v === null || typeof v === 'string';
    return (
        typeof i.name === 'string' &&
        typeof i.url === 'string' &&
        (i.revision === null || typeof i.revision === 'number') &&
        nullableString(i.wikiHome) &&
        nullableString(i.notes)
    );
}

// ── ipc ───────────────────────────────────────────────────────────────────

ipcMain.handle(IPC.catalogGet, (): CatalogState => catalogState());

ipcMain.handle(IPC.catalogAdd, (_event, input: unknown): Result => {
    if (!isNewServerInput(input)) return { ok: false, error: 'Bad input.' };
    const result = catalog.add(input);
    if (!result.ok) return result;
    pushCatalog();
    windows.open(result.server);
    return { ok: true };
});

ipcMain.handle(IPC.catalogRemove, (_event, id: unknown): Result => {
    if (typeof id !== 'string') return { ok: false, error: 'Bad server id.' };
    if (windows.countFor(id) > 0) return { ok: false, error: 'Close its windows first.' };
    if (!catalog.remove(id)) return { ok: false, error: 'Unknown server.' };
    pushCatalog();
    return { ok: true };
});

ipcMain.handle(IPC.windowOpen, (_event, id: unknown): Result => {
    const server = typeof id === 'string' ? catalog.get(id) : undefined;
    if (!server) return { ok: false, error: 'Unknown server.' };
    windows.open(server);
    return { ok: true };
});

ipcMain.handle(IPC.launcherShow, () => showLauncher());

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
        const opened = catalog.list().map(s => serverWindows.get(windows.open(s).id)!);
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

        const launcherWindow = launcher;
        if (launcherWindow) await save('launcher', () => launcherWindow.webContents.capturePage());
        for (const sw of opened) await shoot(sw.state().server.id, sw);

        // The layout and slot checks use a window whose game actually loaded, if any did.
        const first = opened[results.indexOf('loaded')] ?? opened[0]!;
        first.togglePanel();
        await wait(500);
        log(`[capture] panel open on ${first.state().title}: mode ${first.state().mode}`);
        await shoot(`${first.state().server.id}-panel`, first);

        const second = serverWindows.get(windows.open(first.state().server).id)!;
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
    catalog.load();

    log('');
    log('  SwiftKit');
    log(`  catalog : ${catalog.file}${catalog.recovered ? ' (recovered — the old file was kept beside it)' : ''}`);
    for (const server of catalog.list()) {
        log(`  ${server.id.padEnd(16)} rev ${String(server.revision ?? '?').padEnd(4)} ${server.url}`);
    }
    log('');

    installMenu({
        newWindow: showLauncher,
        togglePanel: () => focusedServerWindow()?.togglePanel()
    });
    showLauncher();

    if (CAPTURE_DIR) await captureAndExit(CAPTURE_DIR);
});

app.on('activate', () => {
    if (windows.list().length === 0) showLauncher();
});

app.on('before-quit', () => {
    quitting = true;
});

app.on('window-all-closed', () => app.quit());
