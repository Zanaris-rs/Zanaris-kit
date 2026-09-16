import { app, BrowserWindow, dialog, ipcMain, net, powerMonitor, safeStorage, screen, session, shell, type NativeImage, type WebContents } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { ServerDef } from '../shared/catalog';
import type { ChatView } from '../shared/chat';
import { passwordProblem, readSettingsDraft, type SettingsSave } from '../shared/chatSettings';
import { normaliseName } from '../shared/hiscores';
import { IPC, type ShellState, type ToolId } from '../shared/ipc';
import { CUSTOM_TIMERS_MAX } from '../shared/timers';
import type { PaneContent } from './paneTree';
import { DROP_ZONES, type DropTargets, type DropZone } from './paneDrop';
import { Catalog, slugify } from './catalog';
import { AppState } from './appState';
import { ServerWindows, type WindowSpec } from './windows';
import { createServerWindow, type ServerWindow } from './serverWindow';
import { installMenu, type MenuActions, type MenuWindowState } from './menu';
import { WorldsService } from './worlds/service';
import { HiscoresService } from './hiscores/service';
import { ChatService, offlineChat, tlsConnect, type SettingsChange } from './chat/service';
import { canSeal, open as openSecret, seal } from './chat/secret';
import { probeLatency } from './worlds/probe';
import { switchWarning, type SwitchIntent } from './worlds/warning';
import { migrationPlan } from './migrate';
import { checkLatest, RELEASES_LATEST, type LatestRelease } from './update';
import { SinglePlayerService } from './singleplayer/service';
import { electronDeps, engineResources, singlePlayerHome } from './singleplayer/electron';
import { deleteTimer, newCustomId, readSaveInput, restoreTimer, saveTimer, timersFor, type TimersChange } from './timers/defs';
import { readAlertSound } from './timers/electron';

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
/*
 * A capture run gets a profile of its own, before either the lock below or the
 * userData move underneath it can read the default one.
 *
 * Two reasons, and the second is the one that made it necessary. A capture is
 * meant to photograph the app as a new user finds it, and running it against a
 * real profile shows whatever that user happens to have — their servers.json,
 * their remembered worlds, their nick. And an ordinary instance already holding
 * the single-instance lock makes every capture launch exit(0) immediately,
 * writing no frames and — because electron-vite does not forward the child's
 * stdout — saying nothing about why. That is a silent no-op with a green exit
 * code, which is exactly the failure the capture hazard in README.md warns
 * about wearing a different face.
 */
if (process.env.ZANARIS_CAPTURE) app.setPath('userData', join(app.getPath('appData'), 'zanaris-kit-capture'));

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
// Not `CAPTURE_DIR` any more. Capture mode used to redirect this one file into
// the screenshots folder so a run could not touch the real profile; it now
// takes a whole profile of its own, above, which covers servers.json, the
// single-instance lock and Chromium's own data as well. Keeping both split a
// capture's state across two places for no remaining reason.
const appState = new AppState(join(userData, 'state.json'));
/** One world list per server, shared by every window of that server. Built lazily: net.fetch needs the app ready. */
const worldsServices = new Map<string, WorldsService>();
/** One hiscores lookup per server, shared the same way, so a name looked up in one window is on the table in the others. */
const hiscoresServices = new Map<string, HiscoresService>();
/** One chat connection for the whole app, built at ready because its nick comes out of the profile. */
let chat: ChatService | null = null;

/** The newer release the update check found, if any; the menu shows it. */
let update: LatestRelease | null = null;

/** The one world this computer runs; built at ready, when the paths and the catalog exist. */
let singlePlayer: SinglePlayerService | null = null;

/**
 * The two menu items that belong to the focused window rather than to the app.
 *
 * Whether the panel could open at all is main's decision, from the same rules
 * that would refuse the open — a window whose only tool is chat, with chat
 * living in the dock, has no legal occupant for the side column — and both the
 * strip's toggle and the menu item take their enabled state from it rather than
 * working it out a second time. Whether the window is pinned is asked of the
 * window itself, for the reason `alwaysOnTop` gives there.
 *
 * Both read false with nothing focused, which is what disables the two items:
 * each acts on the focused window, and there is then no window to act on.
 */
function menuWindowState(): MenuWindowState {
    const focused = focusedServerWindow();
    return { alwaysOnTop: focused?.alwaysOnTop() ?? false };
}

/** What the menu was last built with, so the rebuild below only runs when an item would actually change. */
let menuWindow: MenuWindowState = { alwaysOnTop: false };

/** The one way the menu is (re)built, so every rebuild carries the same inputs. */
function installAppMenu(): void {
    menuWindow = menuWindowState();
    installMenu(catalog.list(), actions, appState.warnOnSwitch(), update, menuWindow);
}

/**
 * One menu, many windows: Toggle Panel and Always on Top both belong to
 * whichever window has focus, so they are re-examined when focus moves, when a
 * window closes out from under them, and when chat's home changes app-wide —
 * the ways either answer moves without the catalog, the warning or the update
 * doing anything.
 */
function syncMenuWindowItems(): void {
    const now = menuWindowState();
    if (now.alwaysOnTop !== menuWindow.alwaysOnTop) installAppMenu();
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

/**
 * The same request, with the status kept rather than thrown. `fetchJson` above
 * treats any non-2xx as a failure, which is right for a world list — there is
 * no such thing as a useful 404 there — and wrong for a hiscores lookup, where
 * a 404 *is* the answer: two of the three servers say "no such player" with
 * one, and only the body tells that apart from a proxy having a bad day. So
 * both halves come back together and the parser, which knows each server's
 * quirks, decides what they mean.
 *
 * A body that is not JSON resolves as undefined rather than throwing, for the
 * same reason: an HTML error page from something in front of the server
 * arrives with its own status, and the service has words for that status. A
 * throw here would replace them with a parser message no player can act on.
 * Only a transport failure — no route, no name, no answer inside the same 8s
 * `fetchJson` allows — rejects.
 */
async function fetchStatus(url: string): Promise<{ status: number; json: unknown }> {
    const response = await net.fetch(url, { signal: AbortSignal.timeout(8_000) });
    const json = await response.json().catch(() => undefined);
    return { status: response.status, json };
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

/**
 * One lookup per server, built on the first window that server opens and kept
 * for the app's life, exactly as the world list above is. The subscription
 * fans out to that server's windows and no others: a name looked up in one
 * Lost City window fills the table in the second one, while a Zanaris window
 * beside them is not showing this server's hiscores at all. A lookup moves no
 * chrome, so this is pushState rather than relayout — nothing to lay out
 * again, only new rows to draw.
 */
function hiscoresServiceFor(server: ServerDef): HiscoresService | null {
    if (!server.hiscores) return null;
    let service = hiscoresServices.get(server.id);
    if (!service) {
        // Seeded with the name last looked up on this server, so the box opens
        // on it rather than empty — the service holds the name the panel
        // prefills from, and this is the only moment it can be handed one.
        service = new HiscoresService(server.hiscores, { fetch: fetchStatus }, appState.hiscoresName(server.id) ?? '');
        hiscoresServices.set(server.id, service);
        service.subscribe(() => {
            for (const sw of serverWindows.values()) if (sw.state().server.id === server.id) sw.pushState();
        });
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
            // Focus lands somewhere else, or nowhere, and the menu's panel item
            // belongs to whoever has it now. Closing the last window on macOS
            // fires no focus event at all, so it is done here as well.
            syncMenuWindowItems();
        },
        {
            log,
            confirmClose,
            position: nextPosition(),
            worlds: worldsServiceFor(spec.server),
            hiscores: hiscoresServiceFor(spec.server),
            chat: chatView,
            alwaysOnTop: () => appState.alwaysOnTop(),
            confirmCloseGame: via => confirmCloseGame(spec, via),
            layoutsDir: join(userData, 'layouts', slugify(spec.server.id)),
            remembered: appState.world(spec.server.id),
            remember: remembered => appState.setWorld(spec.server.id, remembered),
            probe: probeLatency,
            singlePlayer,
            timers: () => {
                const state = appState.timers();
                return { listed: timersFor(spec.server.timers, state), customsFull: state.custom.length >= CUSTOM_TIMERS_MAX };
            }
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

/**
 * Pins the focused window, and remembers the choice for the windows opened
 * after it. The doing is per window — four windows all claiming the top is four
 * windows covering whatever each was pinned above — while what is written down
 * is simply the last thing asked for anywhere, which is what a new window and
 * the next launch start with.
 *
 * The menu is rebuilt from the window rather than from the number just saved:
 * a window that refused the pin, or was destroyed between the click and here,
 * must leave the checkbox unticked rather than claiming a state nothing is in.
 */
function setAlwaysOnTop(value: boolean): void {
    focusedServerWindow()?.setAlwaysOnTop(value);
    appState.setAlwaysOnTop(value);
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
    setWarnOnSwitch,
    setAlwaysOnTop,
    splitPane: axis => {
        const sw = focusedServerWindow();
        if (sw) sw.splitPane(sw.state().panes.find(p => p.focused)?.paneId ?? '', axis);
    },
    closePane: () => {
        const sw = focusedServerWindow();
        if (sw) void sw.closePane(sw.state().panes.find(p => p.focused)?.paneId ?? '');
    },
    evenOut: () => focusedServerWindow()?.evenOutFocused(),
    newTab: () => focusedServerWindow()?.newTab(),
    closeTab: () => {
        const sw = focusedServerWindow();
        const active = sw?.state().tabs.find(t => t.active);
        if (sw && active) void sw.closeTab(active.id);
    },
    selectTabAt: index => {
        const sw = focusedServerWindow();
        const tab = sw?.state().tabs[index];
        if (sw && tab) sw.selectTab(tab.id);
    },
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

// ── hiscores ──────────────────────────────────────────────────────────────
//
// Per server rather than per app, so each of these starts from the window that
// asked and works out which server that is. A window whose server offers no
// hiscores has no service and no tool to send these from, so every one of them
// is a no-op there rather than an error.

/**
 * The longest name a lookup will carry, deliberately the same number
 * `appState` refuses to store a remembered name past. Agreeing is the whole
 * point: a longer name would be looked up and kept in the box for the rest of
 * the session, then quietly dropped when the profile is read back on the next
 * launch, and the prefill would go missing with nothing to explain it. The two
 * caps answer different questions — what may be stored, and what may be asked
 * of a server — so each states its own number where it enforces it.
 */
const HISCORES_NAME_MAX = 30;

// ── the reference pane ────────────────────────────────────────────────────

/**
 * Every gesture a pane offers: splitting it, closing it, filling it, dragging
 * its seams, and both of the menus it raises.
 *
 * Each belongs to one window, so each finds its window from the sender and goes
 * no further: a pane belongs to the window it is in, and a drag here has no
 * business resizing a pane over there.
 *
 * A `page` carries a url, which the window checks against its own bookmarks.
 * There is no address box anywhere in the shell, so a url that is not one of
 * the server's links can only be a bug or a compromised renderer, and a page
 * view lives in a session shared with every other window's pages.
 */
ipcMain.handle(IPC.paneSplit, (event, paneId: unknown, axis: unknown) => {
    if (typeof paneId !== 'string' || (axis !== 'x' && axis !== 'y')) return;
    windowFor(event.sender)?.splitPane(paneId, axis);
});

ipcMain.handle(IPC.paneClose, async (event, paneId: unknown) => {
    if (typeof paneId !== 'string') return;
    await windowFor(event.sender)?.closePane(paneId);
});

/**
 * What goes in a pane.
 *
 * The window checks a `page` against its own bookmarks, and moves the game
 * rather than placing a second one; this end only checks the shape, since
 * anything richer would be the placement rules written a second time in a
 * second place. What it will not do is trust the shape: `content` arrives from
 * a renderer, so a value that is not one of the four kinds is dropped rather
 * than handed on.
 */
ipcMain.handle(IPC.paneSetContent, (event, paneId: unknown, content: unknown) => {
    if (typeof paneId !== 'string' || typeof content !== 'object' || content === null) return;
    const kind = (content as { kind?: unknown }).kind;
    if (kind !== 'empty' && kind !== 'game' && kind !== 'page' && kind !== 'tool') return;
    windowFor(event.sender)?.setPaneContent(paneId, content as PaneContent);
});

ipcMain.handle(IPC.paneFocus, (event, paneId: unknown) => {
    if (typeof paneId !== 'string') return;
    windowFor(event.sender)?.focusPane(paneId);
});

/**
 * A seam drag. Clamping is main's, as it was for the pane and the dock before
 * it: a renderer is not something to take arithmetic on trust from, and the
 * range depends on a tree the shell deliberately knows nothing about.
 *
 * The applied position comes back on every path, including the ones that change
 * nothing. A grip sitting at a boundary already reached has no way to tell its
 * own guess was out of range unless it is told, and without the answer it would
 * keep building the next request on a number main never held.
 */
ipcMain.handle(IPC.paneSetSeam, (event, splitId: unknown, index: unknown, px: unknown): number => {
    const sw = windowFor(event.sender);
    if (!sw || typeof splitId !== 'string' || typeof index !== 'number' || !Number.isInteger(index)) return 0;
    if (typeof px !== 'number' || !Number.isFinite(px)) return 0;
    return sw.setSeam(splitId, index, px);
});

ipcMain.handle(IPC.paneEvenOut, (event, splitId: unknown) => {
    if (typeof splitId !== 'string') return;
    windowFor(event.sender)?.evenOut(splitId);
});

ipcMain.handle(IPC.paneGo, (event, where: unknown) => {
    if (where !== 'back' && where !== 'forward' && where !== 'reload') return;
    windowFor(event.sender)?.pageGo(where);
});

ipcMain.handle(IPC.paneContextMenu, (event, paneId: unknown, x: unknown, y: unknown) => {
    if (typeof paneId !== 'string' || typeof x !== 'number' || typeof y !== 'number') return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    windowFor(event.sender)?.showPaneMenu(paneId, x, y);
});

ipcMain.handle(IPC.paneContentMenu, (event, paneId: unknown, x: unknown, y: unknown) => {
    if (typeof paneId !== 'string' || typeof x !== 'number' || typeof y !== 'number') return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    windowFor(event.sender)?.showPaneContentMenu(paneId, x, y);
});

ipcMain.handle(IPC.paneBeginDrag, (event, from: unknown): DropTargets | null => {
    if (typeof from !== 'string') return null;
    return windowFor(event.sender)?.beginPaneDrag(from) ?? null;
});

/**
 * A malformed drop still ends the drag. The shell sends this instead of
 * `endDrag` whenever it drops, so refusing it outright would leave every native
 * view hidden with no gesture left to bring them back.
 */
ipcMain.handle(IPC.paneDrop, (event, from: unknown, to: unknown, zone: unknown) => {
    const sw = windowFor(event.sender);
    if (!sw) return;
    if (typeof from !== 'string' || typeof to !== 'string' || !DROP_ZONES.includes(zone as DropZone)) {
        sw.endPaneDrag();
        return;
    }
    sw.dropPane(from, to, zone as DropZone);
});

ipcMain.handle(IPC.paneEndDrag, event => windowFor(event.sender)?.endPaneDrag());

ipcMain.handle(IPC.tabNew, event => windowFor(event.sender)?.newTab());

ipcMain.handle(IPC.tabContextMenu, (event, tabId: unknown, x: unknown, y: unknown) => {
    if (typeof tabId !== 'string' || typeof x !== 'number' || typeof y !== 'number') return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    windowFor(event.sender)?.showTabMenu(tabId, x, y);
});

ipcMain.handle(IPC.tabAddPaneMenu, (event, x: unknown, y: unknown) => {
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    windowFor(event.sender)?.showAddPaneMenu(x, y);
});

ipcMain.handle(IPC.tabClose, async (event, tabId: unknown) => {
    if (typeof tabId !== 'string') return;
    await windowFor(event.sender)?.closeTab(tabId);
});

ipcMain.handle(IPC.tabSelect, (event, tabId: unknown) => {
    if (typeof tabId !== 'string') return;
    windowFor(event.sender)?.selectTab(tabId);
});

ipcMain.handle(IPC.paneOpenExternal, (event, url: unknown) => {
    if (typeof url !== 'string') return;
    const server = windowFor(event.sender)?.state().server;
    if (!server?.bookmarks.some(b => b.url === url)) {
        log(`[main] refused to open ${String(url)}: not one of that server's links`);
        return;
    }
    if (!/^https:\/\//.test(url)) {
        log(`[main] refused to open ${url}: not https`);
        return;
    }
    void shell.openExternal(url);
});

/**
 * Awaited rather than fired and forgotten, though nothing is waiting on it
 * today. Nothing comes back over the wire — every row the panel draws arrives
 * by pushState — and the panel does not hold this promise at all: it `void`s
 * the call and gates the Look up button, and the submit behind it, on
 * `loading` from the pushed view. What the await buys is that the handler's
 * own promise means what the channel name says, settling when the lookup is
 * over rather than the moment the request goes out. It is what the handlers
 * around it that do real work do — `worldsRefresh` hands back
 * `refreshWorlds()`'s promise, the switch and single-player handlers await
 * theirs — and one layer down capture mode leans on that settle directly,
 * awaiting `service.lookup` because it is the only "the lookup has finished"
 * this feature has to offer.
 *
 * A box with no name in it is not a lookup, and the test for that is
 * `normaliseName`'s own: it keeps only [a-z0-9_], so `   ` and `!!!` alike come
 * out empty and would otherwise send a request to a nameless URL — a round trip
 * spent on nothing against a server that rate-limits after a handful of them,
 * answered with a parse failure the player cannot act on, and `!!!` written
 * into the profile as the name to open the box on next time. Asking the same
 * function the URL is built from is what keeps this guard and that URL from
 * ever disagreeing about what counts as a name.
 *
 * Too long is refused rather than shortened, as `appState` refuses rather than
 * truncates: a name cut to fit is a different, still-plausible player.
 */
ipcMain.handle(IPC.hiscoresLookup, async (event, name: unknown) => {
    if (typeof name !== 'string') return;
    const wanted = name.trim();
    if (normaliseName(wanted) === '' || wanted.length > HISCORES_NAME_MAX) return;
    const server = windowFor(event.sender)?.state().server;
    if (!server) return;
    const service = hiscoresServiceFor(server);
    if (!service) return;
    // Remembered before the request rather than after it, and whatever the
    // server answers: the box keeps the name that was looked up even when
    // nobody by that name exists, so the profile keeps the same thing the box
    // does. Waiting for a reply would only mean a name typed just before the
    // app quits is the one that goes missing.
    appState.setHiscoresName(server.id, wanted);
    await service.lookup(wanted);
});

/**
 * "Full hiscores" opens the server's own page in the system browser.
 *
 * The reference pane could hold it now, but it deliberately does not: the pane
 * shows the server's own curated links, and a hiscores page is not one of them
 * — `openPage` refuses any url that is not in `server.bookmarks`, and widening
 * that to "anything on an allowed host" would give the shell an address box it
 * does not have. So the page opens outside the kit, and the panel's own label
 * says where the link goes rather than letting the browser window be how the
 * user finds out.
 *
 * https only, as in `openExternal` above and serverWindow's window-open
 * handler: `servers.json` is a file the user edits by hand, so this URL is no
 * more trusted than the update feed's.
 */
ipcMain.handle(IPC.hiscoresOpenSite, event => {
    const site = windowFor(event.sender)?.state().server.hiscores?.site ?? null;
    if (!site) return;
    if (!/^https:\/\//.test(site)) {
        log(`[main] refused to open ${site}: not https`);
        return;
    }
    void shell.openExternal(site);
});

// ── chat ──────────────────────────────────────────────────────────────────
//
// One conversation for the app, so these take no window: any window's panel
// drives the same connection, and every window is shown the result.

/** The Settings form off the wire, or null when it is not one. Its contents are judged next, by the same rules the form used. */
function readSettingsSave(x: unknown): SettingsSave | null {
    if (typeof x !== 'object' || x === null) return null;
    const form = x as Record<string, unknown>;
    if (typeof form.nick !== 'string' || typeof form.channels !== 'string') return null;
    if (form.password !== undefined && form.password !== null && typeof form.password !== 'string') return null;
    return { nick: form.nick, channels: form.channels, ...(form.password === undefined ? {} : { password: form.password as string | null }) };
}

ipcMain.handle(IPC.chatGet, (): ChatView => chatView());

ipcMain.handle(IPC.chatSend, (_event, text: unknown) => {
    if (typeof text !== 'string') return;
    chat?.send(text);
});

ipcMain.handle(IPC.chatSelect, (_event, channel: unknown) => {
    if (typeof channel !== 'string') return;
    chat?.select(channel);
});

/** Any channel may be closed, for the session; the service refuses Status, and a channel that is not open. */
ipcMain.handle(IPC.chatCloseRoom, (_event, channel: unknown) => {
    if (typeof channel !== 'string') return;
    chat?.closeRoom(channel);
});

/**
 * A save from the Settings tab. The form is checked again here, since what
 * arrives over IPC is only as trustworthy as the renderer that sent it, and
 * then written and applied.
 *
 * Settings is the only writer of chat's saved nick and list. Nothing learnt
 * from the connection is saved: a /nick, a taken nick's underscore and a
 * services rename to a guest nick all last for the session, the way closing a
 * tab and /join do — and the guest nick is exactly the one that must never
 * become what the next launch registers with.
 *
 * The password is sealed by the OS store when there is one; where there is
 * not, it is held by the service for this run and nothing is written, and the
 * tab says so.
 */
ipcMain.handle(IPC.chatSaveSettings, (_event, input: unknown): string | null => {
    const service = chat;
    if (service === null) return 'Chat is still starting. Try again in a moment.';
    const form = readSettingsSave(input);
    if (form === null) return 'Those settings could not be read.';
    const reading = readSettingsDraft(form);
    if (!reading.ok) return reading.problem.message;
    if (typeof form.password === 'string') {
        const problem = passwordProblem(form.password);
        if (problem !== null) return problem;
    }

    const { draft } = reading;
    appState.setChat({ nick: draft.nick, autoJoin: draft.autoJoin });
    const change: SettingsChange = { nick: draft.nick, autoJoin: draft.autoJoin };
    if (form.password !== undefined) {
        change.password = form.password;
        appState.setNickservSealed(form.password === null ? null : seal(form.password, safeStorage, process.platform));
    }
    service.applySettings(change);
    return null;
});

/** Connect, and connect on the next launch too — the service tells `appState` so. */
ipcMain.handle(IPC.chatConnect, () => {
    chat?.connect();
});

/** Disconnect, and stay offline on the next launch until Connect — the service tells `appState` so. */
ipcMain.handle(IPC.chatDisconnect, () => {
    chat?.disconnect();
});

// ── single player ─────────────────────────────────────────────────────────

/**
 * Ask before closing the game — its pane, or a tab holding it — which destroys
 * the view and disconnects the player.
 *
 * The same shape as `confirmSwitch`: a sheet on the window rather than an
 * app-modal box, so other windows keep running, and the same "don't ask again"
 * the switch warning uses — it is the same preference, since it answers the same
 * question about the same cost. Capture mode never arrives here.
 */
async function confirmCloseGame(spec: WindowSpec, via: 'pane' | 'tab' | 'layout'): Promise<boolean> {
    const sw = serverWindows.get(spec.id);
    if (!sw || quitting) return true;
    if (!appState.warnOnSwitch()) return true;
    const { response, checkboxChecked } = await dialog.showMessageBox(sw.window, {
        type: 'question',
        buttons: ['Close', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: via === 'tab' ? 'Close this tab and the game in it?' : via === 'layout' ? 'Load this layout and close the game?' : 'Close the game?',
        detail: `Zanaris Kit disconnects from ${spec.server.name} straight away, whether or not you are logged in. If you are in game, that logs you out. Opening the game again is a fresh login.`,
        checkboxLabel: "Don't ask again",
        checkboxChecked: false
    });
    if (checkboxChecked) setWarnOnSwitch(false);
    return response === 0;
}

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

// ── timers ────────────────────────────────────────────────────────────────

ipcMain.handle(IPC.timersStart, (event, id: unknown) => {
    if (typeof id === 'string') windowFor(event.sender)?.startTimer(id);
});
ipcMain.handle(IPC.timersPause, (event, id: unknown) => {
    if (typeof id === 'string') windowFor(event.sender)?.pauseTimer(id);
});
ipcMain.handle(IPC.timersReset, (event, id: unknown) => {
    if (typeof id === 'string') windowFor(event.sender)?.resetTimer(id);
});

/**
 * Stores a change to the app-wide definitions and hands every window its new
 * list. Answers what to tell the player when the change was refused, or null.
 */
function applyTimers(change: TimersChange): string | null {
    if (!change.ok) return change.error;
    appState.setTimers(change.state);
    for (const sw of serverWindows.values()) sw.timersChanged();
    return null;
}

/**
 * A save is judged against the calling window's own server, because an edit
 * to a built-in stores only what differs from that server's definition of it.
 */
ipcMain.handle(IPC.timersSave, (event, raw: unknown): string | null => {
    const sw = windowFor(event.sender);
    if (!sw) return null;
    const input = readSaveInput(raw);
    if (!input) return 'That is not a clock the kit can save.';
    const state = appState.timers();
    const taken = new Set(state.custom.map(def => def.id));
    return applyTimers(saveTimer(state, sw.state().server.timers, input, () => newCustomId(() => randomBytes(4).toString('hex'), taken)));
});
ipcMain.handle(IPC.timersDelete, (event, id: unknown): string | null => {
    if (typeof id !== 'string' || !windowFor(event.sender)) return null;
    return applyTimers(deleteTimer(appState.timers(), id));
});
ipcMain.handle(IPC.timersRestore, (event, id: unknown): string | null => {
    if (typeof id !== 'string' || !windowFor(event.sender)) return null;
    return applyTimers(restoreTimer(appState.timers(), id));
});
ipcMain.handle(IPC.timersSound, async (event): Promise<Uint8Array | null> => {
    if (!windowFor(event.sender)) return null;
    return readAlertSound();
});

// ── dev capture ───────────────────────────────────────────────────────────

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** `save` wants a capture that either produces an image or throws; a pane with nothing in it produces neither. */
const shotOfThePage =
    (sw: ServerWindow) =>
    async (): Promise<NativeImage> => {
        const image = await sw.capturePage();
        if (!image) throw new Error('the pane is not showing a page');
        return image;
    };

/**
 * Open every catalog server, wait for each game to load (or fail over to the
 * offline page), let the clients draw, then write each window's shell and game
 * views as PNGs. Then open the panel on a loaded window and capture it again
 * (the layout engine), and open a second instance of that server (slots and
 * partitions). A window's own webContents holds nothing, so the views are
 * captured one by one, and a view with no frame yet is skipped rather than
 * allowed to abort the run. Last comes the reference pane: the Guides list,
 * two pages open beside the game, and the first of them brought back to prove
 * a tab switch did not reload it.
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
     * Put a tool in a pane the way the tab bar's Add pane does. Idempotent by
     * construction — `addPane` focuses a tool already in the tab rather than
     * opening a second copy — so this needs none of the toggle-avoidance the
     * panel version did.
     */
    const showTool = (sw: ServerWindow, tool: ToolId): void => sw.addPane({ kind: 'tool', tool });
    /** The focused pane, which is what every split and close below acts on. */
    const focused = (sw: ServerWindow): string => sw.state().panes.find(p => p.focused)?.paneId ?? '';
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
        // A split across the game's pane, which a window opens focused on — so
        // the shot has three panes, the game and an empty one side by side over
        // the chat every window opens with, and the new pane's header is the
        // one carrying the focus dot. Splitting the game's pane is the
        // interesting case, since that is the one the old layout refused to do
        // at all.
        first.splitPane(focused(first), 'x');
        await wait(500);
        const split = first.state();
        log(`[capture] ${split.title}: ${split.panes.length} pane(s), ${split.seams.length} seam(s), focus on ${split.panes.find(p => p.focused)?.content.kind}`);
        await shoot(`${first.state().server.id}-split`, first);

        // And swapped: what dropping a dragged header in the middle of another
        // pane does. Driven on the window rather than through the pointer, as
        // everything else here is — there is no renderer to drag from. It
        // evidences the tree operation and the views following it; the gesture
        // that reaches it, and the preview it draws, cannot be shot from here.
        const order = (panes: readonly { paneId: string; content: PaneContent }[]): string => panes.map(p => `${p.paneId}:${p.content.kind}`).join(' ');
        const pair = first.state().panes;
        const a = pair[0];
        const b = pair[1];
        if (a && b) {
            first.beginPaneDrag(a.paneId);
            first.dropPane(a.paneId, b.paneId, 'centre');
            await wait(500);
            log(`[capture] ${first.state().title}: swapped — reading order was ${order(pair)}, now ${order(first.state().panes)}`);
            await shoot(`${first.state().server.id}-swapped`, first);

            // And moved: the last pane in reading order dropped on the right
            // edge of the one just swapped, which splits that pane and gives
            // the dropped one its right half. A window opens on the game over
            // chat, so this is chat moved up beside the game.
            const before = first.state().panes;
            const last = before[before.length - 1];
            if (last && last.paneId !== a.paneId) {
                first.beginPaneDrag(last.paneId);
                first.dropPane(last.paneId, a.paneId, 'right');
                await wait(500);
                const moved = first.state();
                log(`[capture] ${moved.title}: moved — reading order was ${order(before)}, now ${order(moved.panes)}, ${moved.seams.length} seam(s), focus on ${moved.panes.find(p => p.focused)?.paneId}`);
                await shoot(`${moved.server.id}-moved`, first);
            }
        }

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

            // Chat beside the still-open Worlds column: two tools and the game
            // laid out at once, which is the arrangement the whole tree exists
            // to allow and which the fixed column could not express at all.
            // Every window opens with chat already there, so this only focuses
            // it — `addPane` never opens a second copy — and Worlds stays
            // exactly as the shot above left it.
            showTool(hopper, 'chat');
            await wait(500);
            // Maximised, which is now simply a bigger rect for the tree to
            // divide rather than the state that forced the old ladder into
            // 'push' on both axes. It is still the shot worth having: every
            // pane's share is a fraction, so maximising is what proves they
            // scale together instead of one of them absorbing the difference.
            // Waited out rather than assumed:
            // macOS's zoom is an animated, OS-driven transition, and
            // proceeding while it is still in flight left a genuinely racy
            // run — one in several — with a stray maximize/resize event
            // landing after `second` opened a few steps below, and this
            // shot's PNG showed it: a brand new window neither this function
            // nor `reduce` ever touched came up with its own dock open.
            // isMaximized() polled to true is what "settled" actually means
            // here; a fixed wait is a guess at how long that takes.
            hopper.window.maximize();
            const maximised = Date.now() + 5_000;
            while (Date.now() < maximised && !hopper.window.isMaximized()) await wait(100);
            await wait(500);
            const maximisedState = hopper.state();
            log(`[capture] ${maximisedState.title}: maximised with ${maximisedState.panes.length} panes — ${maximisedState.panes.map(p => `${p.content.kind} ${p.rect.width}x${p.rect.height}`).join(', ')}`);
            await shoot(`${id}-maximised`, hopper);
            // Undone immediately, and waited out the same way: the shots
            // below must start from a genuinely restored window, not one
            // mid-animation back down, or the same race runs again on
            // whatever opens next.
            hopper.window.unmaximize();
            const restored = Date.now() + 5_000;
            while (Date.now() < restored && hopper.window.isMaximized()) await wait(100);
            showTool(hopper, 'chat');
            await wait(500);

            const target = view?.worlds.find(w => w.id !== view.current);
            if (target) {
                const result = await Promise.race([hopper.switchWorld(target.id), wait(loadTimeoutMs).then((): 'timeout' => 'timeout')]);
                log(`[capture] ${id} switched to world ${target.id}: ${result}`);
                await wait(Math.min(settleMs, 8_000));
                await shoot(`${id}-w${target.id}`, hopper);
                log(`[capture] the game pane's header now reads "${hopper.state().gameLabel}", title "${hopper.window.getTitle()}"`);
                log(`[capture] state file: ${existsSync(appState.file) ? readFileSync(appState.file, 'utf8').replace(/\s+/g, ' ') : '(none)'}`);
            }

            // A split down rather than across: the one arrangement a reader
            // cannot infer from the shots above, and the axis the fixed column
            // layout had no way to express at all. Fronted first, as the Worlds
            // tool is above: the pixel font is only fetched once the shell
            // paints, and font-display: block leaves labels blank until it lands.
            hopper.window.moveTop();
            hopper.focus();
            await wait(500);
            hopper.splitPane(focused(hopper), 'y');
            await wait(500);
            const stacked = hopper.state();
            log(`[capture] ${stacked.title}: split down — ${stacked.seams.map(seam => `${seam.axis} seam at ${seam.size}px of ${seam.gross}`).join(', ')}`);
            await shoot(`${stacked.server.id}-split-down`, hopper);
        } else {
            log('[capture] split-down skipped: no window had worlds open');
        }

        // The Hiscores tool: unlike chat below, a lookup needs no nick, only a
        // public GET, so this is the first capture of a working panel on this
        // branch. One lookup per server and never more — Lost City rate-limits
        // after a handful of requests inside a minute, and a second round trip
        // here would spend budget this run has no use for. `granny_grunt` and
        // `knight` are known to resolve on Lost City and Labs; Zanaris gets a
        // plausible guess, and if it comes back notFound that panel is
        // captured and logged exactly as honestly as a hit would be, rather
        // than swapped for a friendlier name.
        const HISCORES_LOOKUP: Record<string, string> = { lostcity: 'granny_grunt', zanaris: 'zezima', lostcitylabs: 'knight' };
        for (const sw of opened) {
            const server = sw.state().server;
            if (!server.hiscores) continue;
            const name = HISCORES_LOOKUP[server.id];
            const service = name && hiscoresServiceFor(server);
            if (!name || !service) continue;
            // Fronted before the tool opens, as the Worlds tool is above: the
            // panel's pixel font is only fetched once the shell paints, and
            // until it arrives font-display: block leaves every label blank.
            sw.window.moveTop();
            sw.focus();
            await wait(500);
            showTool(sw, 'hiscores');
            // Driven directly on the service, as switchWorld is above, rather
            // than over IPC — there is no renderer here to send the request.
            // The promise settles only once the lookup has left 'loading', so
            // there is nothing here to poll for.
            const view = await service.lookup(name);
            await wait(500);
            log(`[capture] ${server.id} hiscores: ${view.status} "${name}" ${view.skills.length} row(s)${view.error ? ` error: ${view.error}` : ''}`);
            await shoot(`${server.id}-hiscores`, sw);
        }

        // The Timers tool as a player finds it after a minute of play: AFK
        // running, Thieving idle, and one clock of the capture's own past its
        // threshold so the red can be seen. That clock is saved through the
        // same `saveTimer` the IPC handler uses — into this capture profile's
        // state.json, never the owner's — at volume 0 so the run makes no
        // sound, and deleted again after the shot.
        {
            const sw = first;
            sw.window.moveTop();
            sw.focus();
            await wait(500);
            showTool(sw, 'timers');
            const refused = applyTimers(
                saveTimer(appState.timers(), sw.state().server.timers, { id: null, name: 'Capture', kind: 'countdown', durationMs: 5_000, thresholdMs: 4_000, volume: 0, afk: false }, () => 'custom-capture')
            );
            if (refused) log(`[capture] timers: could not add the capture clock: ${refused}`);
            sw.startTimer('afk');
            sw.startTimer('custom-capture');
            await wait(1_500);
            const clocks = sw.state().timers.clocks.map(c => `${c.def.id}=${c.phase}${c.alerted ? '!' : ''}`).join(' ');
            log(`[capture] ${sw.state().server.id} timers: ${clocks}`);
            await shoot(`${sw.state().server.id}-timers`, sw);
            applyTimers(deleteTimer(appState.timers(), 'custom-capture'));
        }

        // Chat: this profile has no nick — see the chat block in
        // app.whenReady, above — so chat never opens a socket here, and every
        // shot below lands on the Settings tab rather than a conversation.
        // That is the correct thing to capture, not a bug to paper over: log
        // it plainly so nobody later mistakes offline chat for broken chat,
        // and never fake a connection just to get a prettier screenshot.
        log('[capture] chat: no nick in this profile, so chat captures its Settings tab, not a conversation');

        // A seam dragged without a pointer: the same clamp `paneSetSeam`
        // applies, driven directly the way this whole function drives
        // ServerWindow rather than over IPC — there is no renderer here to send
        // the request. Proves the drag path end to end: the conversion from
        // pixels, the clamp against both neighbours' minimums, and the window
        // laying out around the answer.
        //
        // Fronted first, as the Worlds tool is: the pixel font is only fetched
        // once the shell paints, and font-display: block leaves labels blank
        // until it lands.
        first.window.moveTop();
        first.focus();
        await wait(500);
        const seam = first.state().seams[0];
        if (seam) {
            const asked = Math.round(seam.gross * 0.25);
            const applied = first.setSeam(seam.splitId, seam.index, asked);
            await wait(500);
            log(`[capture] ${first.state().title}: seam asked for ${asked}px of ${seam.gross}, got ${applied}${applied === asked ? '' : ' (clamped)'}`);
            await shoot(`${first.state().server.id}-seam-dragged`, first);

            // And closed again: the sibling takes the space back and the split
            // collapses, which is the half of the tree's behaviour no shot
            // above evidences.
            await first.closePane(focused(first));
            await wait(500);
            const closed = first.state();
            log(`[capture] ${closed.title}: after close — ${closed.panes.length} pane(s), ${closed.seams.length} seam(s)`);
            await shoot(`${closed.server.id}-pane-closed`, first);
        } else {
            log('[capture] seam drag skipped: the window had no split to drag');
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

        // The reference pane. Last, because it is the one thing here that
        // changes the window's width as well as its chrome, and every shot
        // above is of a window whose game rect the pane has not touched.
        //
        // Three shots, because three separate claims are being made: the
        // Guides list is a menu of this server's own links; a page renders
        // beside the game rather than in front of it; and switching tabs does
        // not reload — the last shot is the first page again, and its view was
        // never destroyed, so what it photographs is the page as it was left.
        // The reload claim is the pane's whole reason to exist and nothing
        // else here can evidence it.
        // Deliberately not `first` or `hopper` when another window will do.
        // Those two have been split several times by the passes above, and a
        // tree that deep in a 760px window puts every pane on its 120px floor —
        // which is honest about what the layout does, and useless as a
        // photograph of a page. A window that has not been split yet shows the
        // launcher and two pages at a size someone can actually read.
        const readers = opened.filter((sw, i) => results[i] === 'loaded' && sw.state().server.bookmarks.length > 0);
        const reader = readers.find(sw => sw !== first && sw !== hopper) ?? readers[0];
        if (reader) {
            const id = reader.state().server.id;
            reader.window.moveTop();
            reader.focus();
            await wait(500);

            // The launcher, which is what an empty pane shows and what replaced
            // the Guides panel: split a pane and photograph what the new half
            // offers before anything is chosen.
            reader.splitPane(focused(reader), 'x');
            await wait(500);
            // The list the launcher actually draws rather than the catalog it is
            // built from: what a pane may become is main's answer, and the game
            // row is the half of it the catalog cannot show — it reads "Move
            // game here" while the game is in some other pane of this window.
            const offered = reader.state().panes.find(pane => pane.content.kind === 'empty')?.contents;
            log(`[capture] ${id} launcher offers: ${offered?.map(item => item.label).join(' · ') ?? 'nothing — no empty pane'}`);
            await shoot(`${id}-launcher`, reader);

            // Two pages in two panes, side by side — which is the arrangement
            // the single reference pane could not hold at all. Driven on the
            // window rather than over IPC, as everything else here is: there is
            // no renderer to send the request from.
            const links = reader.state().server.bookmarks.slice(0, 2);
            const firstLink = links[0];
            if (firstLink) {
                reader.setPaneContent(focused(reader), { kind: 'page', bookmark: firstLink.url });
                await wait(Math.min(settleMs, 8_000));
            }
            const secondLink = links[1];
            if (secondLink) {
                reader.splitPane(focused(reader), 'y');
                reader.setPaneContent(focused(reader), { kind: 'page', bookmark: secondLink.url });
                await wait(Math.min(settleMs, 8_000));
            }
            const pages = reader.state().panes.filter(p => p.content.kind === 'page');
            log(`[capture] ${id} pages: ${pages.map(p => `"${p.page?.title ?? 'nothing'}" (${p.page?.url ?? '—'}) at ${p.rect.width}x${p.rect.height}${p.page?.loading ? ', loading' : ''}`).join(' · ')}`);
            await shoot(`${id}-pages`, reader);
            // A page's own view, which neither half of shoot() reaches: the
            // shell leaves a page pane's rect empty and captureGame is the game.
            // Without this the run could only claim a page loaded, never show one.
            await save(`${id}-page`, shotOfThePage(reader));

            // Focus back to the first page and shoot again. Its view was never
            // destroyed — nothing here creates or destroys one except a change
            // in which panes hold pages — so what this photographs is the page
            // exactly as it was left. That no-reload claim is the pane system's
            // whole reason to exist and nothing else in this run evidences it.
            const firstPage = pages[0];
            if (firstPage) {
                reader.focusPane(firstPage.paneId);
                // Generous, and not only for the page: capturePage hands back
                // the last composited frame, and a view that has just been
                // shown has not composited one yet.
                await wait(Math.min(settleMs, 8_000));
                const shown = reader.state().panes.find(p => p.paneId === firstPage.paneId)?.page;
                log(`[capture] ${id} focused back on ${firstPage.paneId}: "${shown?.title ?? 'nothing'}" (${shown?.url ?? '—'}), ${shown?.loading ? 'still loading' : 'loaded'}`);
                await shoot(`${id}-pages-back`, reader);
                await save(`${id}-page-back`, shotOfThePage(reader));
            }
        } else {
            log('[capture] pages skipped: no loaded window offers any links');
        }

        const second = openServer(first.state().server);
        log(`[capture] ${second.state().title}: ${await loaded(second)}`);
        await wait(Math.min(settleMs, 8_000));
        await shoot(`${first.state().server.id}-2`, second);

        // A layout saved and loaded, driven on the window rather than through
        // the tab menu — the save and open dialogs are native sheets nothing
        // here can click. The fresh window's game-and-chat tab is written to a
        // file, a new empty tab is opened, and the file loaded into it: the
        // game should move into the new tab's game pane without a reload, and
        // the first tab's game pane should be left empty. Written to the temp
        // directory and removed, so a run leaves nothing in the layouts folder.
        const activeTab = (sw: ServerWindow): string => sw.state().tabs.find(tab => tab.active)?.id ?? '';
        const panesOf = (sw: ServerWindow): string => sw.state().panes.map(p => (p.content.kind === 'tool' ? p.content.tool : p.content.kind)).join(' over ');
        const layoutPath = join(app.getPath('temp'), `zanaris-kit-capture-${Date.now()}.json`);
        try {
            const saved = panesOf(second);
            second.saveLayoutTo(activeTab(second), layoutPath);
            second.newTab();
            await wait(300);
            const result = await second.loadLayoutFrom(activeTab(second), layoutPath);
            await wait(500);
            const tabs = second.state().tabs.map(tab => tab.label).join(', ');
            log(`[capture] ${second.state().title}: saved "${saved}", loaded into a new tab: ${result} — now "${panesOf(second)}", tabs ${tabs}`);
            await shoot(`${first.state().server.id}-layout-loaded`, second);
        } finally {
            rmSync(layoutPath, { force: true });
        }
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
    // A timeout does not count the time asleep, so on a wake every window's clocks are judged at once rather than when theirs fires.
    powerMonitor.on('resume', () => {
        for (const sw of serverWindows.values()) sw.settleTimers();
    });
    // The reference pages' shared session. They are somebody else's pages shown
    // inside the kit, so they get the web and nothing else: no file the user
    // did not ask for, and none of the permissions a browser would prompt over.
    const pages = session.fromPartition('persist:pages');
    pages.on('will-download', event => event.preventDefault());
    pages.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    // Offline until a nick is set, which is why a capture run — whose profile has
    // none — never opens a socket. The password is opened here, after ready,
    // because the OS store is not available before it.
    chat = new ChatService(
        {
            ...appState.chat(),
            password: openSecret(appState.sealedNickserv(), safeStorage, process.platform),
            canSavePassword: canSeal(safeStorage, process.platform),
            // Connect, Disconnect and /quit all land here, so the next launch does what the user last asked.
            onConnectionWanted: wanted => appState.setChat({ autoConnect: wanted })
        },
        {
            connect: tlsConnect,
            now: Date.now,
            setTimer: (fn, ms) => {
                const timer = setTimeout(fn, ms);
                return () => clearTimeout(timer);
            }
        }
    );
    // Every window's panel follows the one connection. Nothing is saved from
    // here: chat's saved settings change only in the Settings tab.
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

app.on('browser-window-focus', () => {
    reloadCatalogIfChanged();
    syncMenuWindowItems();
});

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
