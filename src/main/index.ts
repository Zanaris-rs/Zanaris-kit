import { app, BrowserWindow, dialog, ipcMain, net, screen, shell, type NativeImage, type WebContents } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ServerDef } from '../shared/catalog';
import type { ChatView } from '../shared/chat';
import { IPC, TOOL_IDS, type ShellState, type ToolId } from '../shared/ipc';
import { DOCK_HEIGHT_MIN } from '../shared/layout';
import { Catalog } from './catalog';
import { AppState } from './appState';
import { ServerWindows } from './windows';
import { createServerWindow, type ServerWindow } from './serverWindow';
import { installMenu, type MenuActions } from './menu';
import { WorldsService } from './worlds/service';
import { ChatService, offlineChat, tlsConnect } from './chat/service';
import { probeLatency } from './worlds/probe';
import { switchWarning, type SwitchIntent } from './worlds/warning';
import { migrationPlan } from './migrate';
import { checkLatest, RELEASES_LATEST, type LatestRelease } from './update';
import { SinglePlayerService } from './singleplayer/service';
import { electronDeps, engineResources, singlePlayerHome } from './singleplayer/electron';

const log = (msg: string): void => console.log(msg);

// ── one instance ──────────────────────────────────────────────────────────
//
// Two instances would share one world. Both resolve the same
// <userData>/singleplayer, both write data/config/world.json over each other,
// both spawn an engine with that working directory, and both save the same
// character into data/players/main — two worlds, one set of saves, last
// logout wins, and nothing tells the player. The userData move below and
// servers.json have the same problem in miniature. macOS refuses the second
// launch itself; Windows and Linux happily run two.
//
// app.exit rather than quit-and-return: a module body cannot return, and
// app.quit() is a request — it comes back, and everything below would run in
// an instance that is on its way out, moving the profile's files and touching
// the world directory before it goes. exit(0) leaves immediately, which is
// what an instance owning nothing should do.
if (!app.requestSingleInstanceLock()) app.exit(0);

// ── the userData move, from the old name to this one ──────────────────────
//
// Electron derives app.getPath('userData') from the package name, so calling
// the app zanaris-kit instead of swiftkit points it at a directory with
// nothing of the user's in it. Everything they have is in the old one:
// servers.json, the worlds and the warning preference in state.json, and —
// under Partitions/ — the game session cookies that keep them logged in and
// the client each server downloaded. Left alone they would find a fresh app:
// empty server list, logged out of every world, every asset re-fetched.
//
// This moves entry by entry rather than renaming the whole directory across,
// because the new directory cannot be assumed absent. Electron and Chromium
// build it during their own startup, before this module runs: a launch on the
// renamed package left a zanaris-kit holding a defaults servers.json and five
// partition entries. There is no moment at which the new directory is
// reliably missing, so a whole-directory rename would simply never fire — and
// renameSync onto a directory with anything in it fails anyway.
//
// Per entry holds whatever Chromium has already scaffolded, and degrades the
// way you would want: a user who has built up a new profile keeps it, while
// anything they have not got yet comes across. renameSync moves Partitions
// exactly as it moves the two files, and each entry gets its own try/catch so
// one failure does not abandon the rest. A partly fresh profile is
// survivable; refusing to launch over it would not be.
//
// It still runs at module load, above the constants below, because those name
// servers.json and state.json — the entries have to be in place before
// anything reads them.
const userData = app.getPath('userData');
const legacyUserData = join(dirname(userData), 'swiftkit');
const migrated: string[] = [];
for (const entry of migrationPlan(legacyUserData, userData, existsSync)) {
    try {
        // Normally Chromium has already made it; recursive, so a no-op when it has.
        mkdirSync(userData, { recursive: true });
        renameSync(join(legacyUserData, entry), join(userData, entry));
        migrated.push(entry);
    } catch (err) {
        log(`[main] could not move ${entry} from ${legacyUserData}: ${(err as Error).message}`);
    }
}
if (migrated.length > 0) log(`[main] moved ${migrated.join(', ')} from ${legacyUserData} into ${userData}`);

/** Dev-only: open every server, screenshot every view, and exit. See captureAndExit(). */
const CAPTURE_DIR = process.env.ZANARIS_CAPTURE;

let quitting = false;
const catalog = new Catalog(join(userData, 'servers.json'));
/** Capture mode keeps its state beside its screenshots, so a test switch never changes what the next real launch opens. */
const appState = new AppState(join(CAPTURE_DIR ?? userData, 'state.json'));
/** One world list per server, shared by every window of that server. Built lazily: net.fetch needs the app ready. */
const worldsServices = new Map<string, WorldsService>();
/** One chat connection for the whole app, built at ready because its nick comes out of the profile. */
let chat: ChatService | null = null;

/** The newer release the update check found, if any; the menu shows it. */
let update: LatestRelease | null = null;

/** The one world this computer runs; built at ready, when the paths and the catalog exist. */
let singlePlayer: SinglePlayerService | null = null;

/** The one way the menu is (re)built, so every rebuild carries the same inputs. */
function installAppMenu(): void {
    installMenu(catalog.list(), actions, appState.warnOnSwitch(), update);
}

/**
 * One request per launch for the newest release. Every failure is swallowed:
 * offline, rate limited, malformed. Nothing is downloaded; the Help menu
 * gets an item that opens the release page.
 */
async function checkForUpdate(): Promise<void> {
    if (CAPTURE_DIR || process.env.ZANARIS_NO_UPDATE_CHECK) return;
    try {
        const res = await net.fetch(RELEASES_LATEST, {
            signal: AbortSignal.timeout(5000),
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': `zanaris-kit/${app.getVersion()}` }
        });
        if (!res.ok) return;
        const found = checkLatest(await res.json(), app.getVersion());
        if (!found?.newer) return;
        update = found;
        installAppMenu();
        log(`[main] update available: ${found.latest} (this is ${app.getVersion()})`);
    } catch (err) {
        // String(err), not .message: a rejection need not be an Error, and a
        // check that swallows everything must not throw out of its own catch.
        log(`[main] update check failed: ${String(err)}`);
    }
}

/** The conversation as it stands. Nothing opens a window before the service exists, but state() always needs a view. */
function chatView(): ChatView {
    return chat?.view() ?? offlineChat(null);
}

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
            chat: chatView,
            chatHome: () => appState.chat().dock,
            chatDockHeight: () => appState.chat().dockHeight,
            remembered: appState.world(spec.server.id),
            remember: remembered => appState.setWorld(spec.server.id, remembered),
            probe: probeLatency,
            singlePlayer
        }
    );
    serverWindows.set(spec.id, sw);
    byShell.set(sw.shellContentsId, sw);
    log(`[main] opened ${spec.title} — ${spec.server.url} (${spec.partition})`);
    return sw;
}, syncChatChannels);

/**
 * Chat follows the windows: the rooms are those of the servers currently open,
 * alongside the lobby. Called on every open and close, so a room is joined with
 * the first window on its server and left with the last.
 */
function syncChatChannels(): void {
    chat?.setServers(windows.list().map(w => w.serverId));
}

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
    installAppMenu();
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

/** The one writer of the preference: saves it, then rebuilds the menu so its checkbox agrees. */
function setWarnOnSwitch(value: boolean): void {
    appState.setWarnOnSwitch(value);
    installAppMenu();
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
    togglePanel: () => focusedServerWindow()?.togglePanel(),
    setWarnOnSwitch,
    // Only https reaches the system browser, as in serverWindow's window-open
    // handler: this opens whatever the menu carries, and the update item's url
    // came off the network.
    openExternal: url => {
        if (!/^https:\/\//.test(url)) {
            log(`[main] refused to open ${url}: not https`);
            return;
        }
        void shell.openExternal(url);
    }
};

// ── ipc ───────────────────────────────────────────────────────────────────

ipcMain.handle(IPC.shellGet, (event): ShellState | null => windowFor(event.sender)?.state() ?? null);

ipcMain.handle(IPC.shellTogglePanel, event => windowFor(event.sender)?.togglePanel());

ipcMain.handle(IPC.shellSelectTool, (event, id: unknown) => {
    if (id !== null && !(TOOL_IDS as readonly string[]).includes(id as string)) return;
    windowFor(event.sender)?.selectTool(id as ToolId | null);
});

ipcMain.handle(IPC.shellToggleDock, event => windowFor(event.sender)?.toggleDock());

ipcMain.handle(IPC.worldsRefresh, event => windowFor(event.sender)?.refreshWorlds());

/**
 * Ask before a switch reloads the game and throws the player out. A sheet on
 * the window, not an app-modal box, so the other windows keep running. The
 * checkbox says what the user wants of the warning rather than of this switch,
 * so it is honoured whichever button they pressed. Capture mode never arrives
 * here: it drives switchWorld directly rather than over IPC.
 */
async function confirmSwitch(sw: ServerWindow, intent: SwitchIntent): Promise<boolean> {
    if (!appState.warnOnSwitch()) return true;
    const { message, detail } = switchWarning(intent);
    const { response, checkboxChecked } = await dialog.showMessageBox(sw.window, {
        type: 'question',
        buttons: ['Switch', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        message,
        detail,
        checkboxLabel: "Don't ask again",
        checkboxChecked: false
    });
    if (checkboxChecked) setWarnOnSwitch(false);
    return response === 0;
}

ipcMain.handle(IPC.worldsSwitch, async (event, world: unknown) => {
    if (typeof world !== 'number' || !Number.isInteger(world)) return;
    const sw = windowFor(event.sender);
    const worlds = sw?.state().worlds;
    // Nothing to confirm when the window has no worlds, or is on that world already.
    if (!sw || !worlds || worlds.current === world) return;
    if (!(await confirmSwitch(sw, { kind: 'world', to: world, from: worlds.current }))) return;
    await sw.switchWorld(world);
});

ipcMain.handle(IPC.worldsSetDetail, async (event, detail: unknown) => {
    if (detail !== 'low' && detail !== 'high') return;
    const sw = windowFor(event.sender);
    const worlds = sw?.state().worlds;
    if (!sw || !worlds || worlds.detail === detail) return;
    if (!(await confirmSwitch(sw, { kind: 'detail', to: detail, world: worlds.current }))) return;
    await sw.setDetail(detail);
});

// ── chat ──────────────────────────────────────────────────────────────────
//
// One conversation for the app, so these take no window: any window's panel
// drives the same connection, and every window is shown the result.

ipcMain.handle(IPC.chatGet, (): ChatView => chatView());

ipcMain.handle(IPC.chatSend, (_event, text: unknown) => {
    if (typeof text !== 'string') return;
    chat?.send(text);
});

ipcMain.handle(IPC.chatSelect, (_event, channel: unknown) => {
    if (typeof channel !== 'string') return;
    chat?.select(channel);
});

ipcMain.handle(IPC.chatSetNick, (_event, nick: unknown) => {
    if (typeof nick !== 'string' || nick.trim() === '') return;
    const chosen = nick.trim();
    // Remembered, so the next launch connects without asking again.
    appState.setChat({ nick: chosen });
    chat?.setNick(chosen);
});

/**
 * Where chat lives, for the whole app: one conversation cannot be at the bottom
 * of one window and down the side of another without being two chats in the
 * user's head. What is app-wide is where chat *goes*, though, not whether it is
 * open — that was always per-window. So only the window whose →| was clicked
 * rearranges around the move; the rest are told where chat now goes and keep
 * whatever they had open, or a user with the world list up in another window
 * would lose it to a click they made over here.
 *
 * The window that asked is the one whose shell sent this, which is the shell
 * the control is drawn in. Moving it changes geometry rather than only what is
 * drawn, and both of these lay the window out again — which pushes the new
 * state itself, so nothing here follows them with a pushState.
 */
ipcMain.handle(IPC.chatSetHome, (event, home: unknown) => {
    if (home !== 'bottom' && home !== 'side') return;
    appState.setChat({ dock: home });
    const asked = windowFor(event.sender);
    for (const sw of serverWindows.values()) {
        if (sw === asked) sw.moveChat(home);
        else sw.syncChatHome(home);
    }
});

/**
 * The dock's height, as the user drags its top edge. Clamping is main's job —
 * the preload passes the number through untouched, and a renderer is not
 * something to take arithmetic on trust from. The ceiling is half the work area
 * of the display the dragging window is on, since that is the only screen this
 * request has anything to do with.
 */
ipcMain.handle(IPC.chatSetDockHeight, (event, px: unknown) => {
    if (typeof px !== 'number' || !Number.isFinite(px)) return;
    const sw = windowFor(event.sender);
    if (!sw) return;
    const workArea = screen.getDisplayMatching(sw.window.getBounds()).workArea;
    const height = Math.round(Math.min(Math.max(px, DOCK_HEIGHT_MIN), workArea.height / 2));
    if (height === appState.chat().dockHeight) return;
    appState.setChat({ dockHeight: height });
    for (const other of serverWindows.values()) other.relayout();
});

// ── single player ─────────────────────────────────────────────────────────

async function confirmCheats(sw: ServerWindow, on: boolean): Promise<boolean> {
    const { response } = await dialog.showMessageBox(sw.window, {
        type: 'question',
        buttons: ['Restart', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        message: `Turning cheats ${on ? 'on' : 'off'} restarts your world and logs you out.`,
        detail: on ? 'Developer commands such as ::tele and ::give will work.' : 'The world will play as the servers do.'
    });
    return response === 0;
}

ipcMain.handle(IPC.singlePlayerSetCheats, async (event, on: unknown) => {
    if (typeof on !== 'boolean' || !singlePlayer) return;
    const sw = windowFor(event.sender);
    if (!sw || sw.state().server.kind !== 'singleplayer') return;
    if (singlePlayer.view().cheats === on) return;
    const running = singlePlayer.view().status !== 'stopped' && singlePlayer.view().status !== 'failed';
    if (running && !(await confirmCheats(sw, on))) return;
    await singlePlayer.setCheats(on);
});

ipcMain.handle(IPC.singlePlayerRetry, async event => {
    const sw = windowFor(event.sender);
    if (!sw || sw.state().server.kind !== 'singleplayer' || !singlePlayer) return;
    await singlePlayer.retry().catch(() => undefined);
});

ipcMain.handle(IPC.singlePlayerOpenSaves, async () => {
    const saves = join(singlePlayerHome(), 'data', 'players', 'main');
    mkdirSync(saves, { recursive: true });
    await shell.openPath(saves);
});

ipcMain.handle(IPC.singlePlayerShowLog, async () => {
    const logPath = join(singlePlayerHome(), 'world.log');
    if (!existsSync(logPath)) writeFileSync(logPath, '');
    await shell.openPath(logPath);
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
    const settleMs = Number(process.env.ZANARIS_CAPTURE_WAIT) || 15_000;
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
        // The wait is generous because an occluded shell can be several state
        // pushes behind — a shorter one caught the world list mid-load.
        sw.window.moveTop();
        sw.focus();
        await wait(400);
        await sw.settle();
        await save(`${name}-shell`, () => sw.captureShell());
        await save(`${name}-game`, () => sw.captureGame());
    };
    /**
     * Open the panel on a tool the way the rail does — which toggles, so asking
     * for the tool already on show would close the panel this run came to
     * photograph. The panel capture below opens the panel on whatever tool can
     * legally hold the column, which is often this one.
     */
    const showTool = (sw: ServerWindow, tool: ToolId): void => {
        const state = sw.state();
        if (state.panelOpen && state.activeTool === tool) return;
        sw.selectTool(tool);
    };
    const loaded = (sw: ServerWindow): Promise<'loaded' | 'failed' | 'timeout'> =>
        Promise.race([sw.whenGameLoaded(), wait(loadTimeoutMs).then((): 'timeout' => 'timeout')]);

    try {
        const started = Date.now();
        // Single player needs the engine staged; on a machine where it is not,
        // the entry is dropped rather than left to fail the run.
        const servers = catalog.list().filter(s => s.kind !== 'singleplayer' || existsSync(join(engineResources(), 'VERSION.json')));
        if (servers.length < catalog.list().length) log('[capture] singleplayer skipped: engine not staged');
        const opened = servers.map(openServer);
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
        // The strip's toggle is a no-op on a window whose column has no legal
        // occupant — chat alone, living at the bottom — so this reports what
        // the panel actually did rather than assuming it opened.
        const toggled = first.state();
        log(`[capture] ${toggled.title}: panel ${toggled.panelOpen ? `open on ${toggled.activeTool}` : 'stayed closed'}, mode x ${toggled.mode.x}, y ${toggled.mode.y}`);
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
            showTool(hopper, 'worlds');
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

        // The Single player tool: the world is up by the time the game loaded,
        // so this is the panel as a player finds it — status, port and cheats.
        const single = opened.find((sw, i) => results[i] === 'loaded' && sw.state().server.kind === 'singleplayer');
        if (single) {
            // Fronted before the tool opens, as the Worlds tool is: the panel's
            // pixel font is only fetched once the shell paints, and until it
            // arrives `font-display: block` leaves every label blank.
            single.window.moveTop();
            single.focus();
            await wait(500);
            showTool(single, 'singleplayer');
            await wait(500);
            await shoot('singleplayer-tool', single);
            log(`[capture] singleplayer: ${single.state().singlePlayer?.status} on port ${single.state().singlePlayer?.port}`);
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
    // Before loadCatalog: it builds the menu, which draws the switch-warning preference.
    appState.load();
    // Offline until a nick is set, which is why a capture run — whose profile has
    // none — never opens a socket.
    chat = new ChatService(appState.chat(), {
        connect: tlsConnect,
        now: Date.now,
        setTimer: (fn, ms) => {
            const timer = setTimeout(fn, ms);
            return () => clearTimeout(timer);
        }
    });
    chat.subscribe(() => {
        for (const sw of serverWindows.values()) sw.pushState();
    });
    loadCatalog();
    singlePlayer = new SinglePlayerService(
        electronDeps({
            baseUrl: catalog.get('singleplayer')?.url ?? 'http://127.0.0.1/rs2.cgi?lowmem=1',
            cheats: { get: () => appState.singlePlayerCheats(), set: on => appState.setSinglePlayerCheats(on) },
            log
        })
    );
    singlePlayer.subscribe(() => {
        for (const sw of serverWindows.values()) if (sw.state().server.kind === 'singleplayer') sw.pushState();
    });
    void checkForUpdate();

    log('');
    log('  Zanaris Kit');
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

/**
 * Someone launched the kit again while this instance holds the lock. That
 * launch has already exited, so surface this one rather than let the click do
 * nothing: the window they were last on, restored if they had minimised it.
 */
app.on('second-instance', () => {
    const window = (focusedServerWindow() ?? [...serverWindows.values()].at(-1))?.window ?? BrowserWindow.getAllWindows()[0];
    if (!window || window.isDestroyed()) {
        actions.newWindow();
        return;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
});

app.on('browser-window-focus', () => reloadCatalogIfChanged());

/** Set once the world has been stopped for the quit, so the second quit goes through. */
let worldStoppedForQuit = false;
app.on('before-quit', event => {
    quitting = true;
    // Our own close, so nothing waits to reconnect a connection the app is leaving.
    chat?.stop();
    // The world writes the player's saves as it shuts down, so the quit waits for
    // it — bounded by the service's own ten-second grace before it kills the world.
    const status = singlePlayer?.view().status;
    if (singlePlayer && !worldStoppedForQuit && status !== 'stopped' && status !== 'failed' && status !== undefined) {
        event.preventDefault();
        void singlePlayer.stop().finally(() => {
            worldStoppedForQuit = true;
            app.quit();
        });
    }
});

// macOS keeps running with no windows; the menu and the dock open the next one.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
