import { app, BrowserWindow, dialog, ipcMain, net, screen, shell, type NativeImage, type WebContents } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ServerDef } from '../shared/catalog';
import type { ChatView } from '../shared/chat';
import { normaliseName } from '../shared/hiscores';
import { IPC, TOOL_IDS, type ShellState, type ToolId } from '../shared/ipc';
import { DOCK_HEIGHT_MIN } from '../shared/layout';
import { Catalog } from './catalog';
import { AppState } from './appState';
import { ServerWindows } from './windows';
import { createServerWindow, type ServerWindow } from './serverWindow';
import { installMenu, type MenuActions } from './menu';
import { WorldsService } from './worlds/service';
import { HiscoresService } from './hiscores/service';
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
/** One hiscores lookup per server, shared the same way, so a name looked up in one window is on the table in the others. */
const hiscoresServices = new Map<string, HiscoresService>();
/** One chat connection for the whole app, built at ready because its nick comes out of the profile. */
let chat: ChatService | null = null;

/** The newer release the update check found, if any; the menu shows it. */
let update: LatestRelease | null = null;

/** The one world this computer runs; built at ready, when the paths and the catalog exist. */
let singlePlayer: SinglePlayerService | null = null;

/**
 * Whether the focused window's panel could open at all. Main decides it, from
 * the same rules that would refuse the open — a window whose only tool is chat,
 * with chat living in the dock, has no legal occupant for the side column — and
 * both the strip's toggle and the menu item below take their enabled state from
 * it rather than working it out a second time.
 */
function panelAvailable(): boolean {
    return focusedServerWindow()?.state().panelAvailable ?? false;
}

/** What the menu was last built with, so the rebuild below only runs when the item would actually change. */
let menuPanelAvailable = false;

/** The one way the menu is (re)built, so every rebuild carries the same inputs. */
function installAppMenu(): void {
    menuPanelAvailable = panelAvailable();
    installMenu(catalog.list(), actions, appState.warnOnSwitch(), update, menuPanelAvailable);
}

/**
 * One menu, many windows: the Toggle Panel item belongs to whichever window has
 * focus, so it is re-examined when focus moves, when a window closes out from
 * under it, and when chat's home changes app-wide — the three ways the answer
 * moves without the catalog, the warning or the update doing anything.
 */
function syncMenuPanelItem(): void {
    if (panelAvailable() !== menuPanelAvailable) installAppMenu();
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
            syncMenuPanelItem();
        },
        {
            log,
            confirmClose,
            position: nextPosition(),
            worlds: worldsServiceFor(spec.server),
            hiscores: hiscoresServiceFor(spec.server),
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

/** The lookup belonging to the window that sent this, or null when that server has none. */
function hiscoresFor(sender: WebContents): HiscoresService | null {
    const sw = windowFor(sender);
    return sw ? hiscoresServiceFor(sw.state().server) : null;
}

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

/**
 * Awaited rather than fired and forgotten. Nothing comes back over the wire —
 * every row the panel draws arrives by pushState — so this promise resolving
 * is the only signal the caller gets that the lookup is over, and a panel that
 * means to stop a rate-limited server being asked twice needs one.
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

ipcMain.handle(IPC.hiscoresClear, event => hiscoresFor(event.sender)?.clear());

/**
 * "Full hiscores" opens the server's own page in the system browser.
 *
 * The plan asked for a page tab in this window, and page tabs are not built:
 * `TabModel.open` exists and is tested, but nothing calls it, there is no view
 * for a page tab's content to draw in, and the strip's + and address row are
 * not wired. Waiting for them would leave the panel with a link that does
 * nothing, so the page opens outside the kit instead — a visible deviation from
 * the plan, which is why the panel's own label says where the link goes rather
 * than letting the browser window be how the user finds out.
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
    // A home of 'bottom' takes chat out of the side column, which on a window
    // with no other tool leaves the panel with nothing it could open onto.
    syncMenuPanelItem();
});

/**
 * How long the dock's height must sit still before it is written to the
 * profile. Long enough that a drag — one height per animation frame, so around
 * sixty a second — writes once when the user lets go, short enough that
 * nothing plausible happens between the release and the write.
 */
const DOCK_HEIGHT_SETTLE_MS = 400;
let dockHeightWrite: NodeJS.Timeout | null = null;

/**
 * The height applies to every window's layout on the frame it arrives; only
 * the *write* waits for the drag to finish. AppState.save() is a synchronous
 * rewrite of the whole of state.json, and one per frame is two costs: on
 * Windows, where userData sits in a roamed and antivirus-scanned
 * AppData\Roaming, a multi-millisecond write per frame stutters the very drag
 * it is recording; and every write is a moment in which a kill truncates the
 * file, which load() then quarantines, taking the user's remembered worlds and
 * nick with it. (The write is not atomic, which is what makes that window a
 * real one — that predates the dock and is left alone here.)
 */
function writeDockHeightWhenItSettles(): void {
    if (dockHeightWrite) clearTimeout(dockHeightWrite);
    dockHeightWrite = setTimeout(() => {
        dockHeightWrite = null;
        appState.save();
    }, DOCK_HEIGHT_SETTLE_MS);
}

/** Writes a staged height now rather than on the timer. For the quit, which would otherwise leave the last drag of a session unremembered. */
function flushDockHeight(): void {
    if (!dockHeightWrite) return;
    clearTimeout(dockHeightWrite);
    dockHeightWrite = null;
    appState.save();
}

/**
 * The dock's height, as the user drags its top edge or steps it by keyboard.
 * Clamping is main's job — the preload passes the number through untouched,
 * and a renderer is not something to take arithmetic on trust from. The
 * ceiling is half the work area of the display the dragging window is on,
 * since that is the only screen this request has anything to do with.
 *
 * The clamped height is returned on every path, including the ones that skip
 * the layout work below because nothing changed. A renderer sitting at a
 * boundary already reached — one more ArrowDown at the floor, an End that was
 * already at the ceiling — has no way to tell its own guess was out of range
 * unless it is told; without the answer it would keep building the next
 * request on a number main never actually held. The skip itself stays: a
 * height equal to the one on file has no layout to redo, and relaying out
 * anyway on every one of those would be exactly the wasted work the skip
 * exists to avoid.
 */
ipcMain.handle(IPC.chatSetDockHeight, (event, px: unknown): number => {
    const current = appState.chat().dockHeight;
    if (typeof px !== 'number' || !Number.isFinite(px)) return current;
    const sw = windowFor(event.sender);
    if (!sw) return current;
    const workArea = screen.getDisplayMatching(sw.window.getBounds()).workArea;
    const height = Math.round(Math.min(Math.max(px, DOCK_HEIGHT_MIN), workArea.height / 2));
    if (height === current) return height;
    appState.stageChat({ dockHeight: height });
    for (const other of serverWindows.values()) other.relayout();
    writeDockHeightWhenItSettles();
    return height;
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

            // Dock beneath the still-open Worlds panel: the single most
            // regression-prone geometry in this feature (the dock painting
            // over the panel's bottom rows, hiding the worlds list's tail,
            // was a real bug found and fixed earlier on this branch) and no
            // other capture shows both regions open at once. selectTool('chat')
            // toggles dockOpen in place without touching panelOpen or
            // activeTool while home is 'bottom' — see the 'rail-chat' branch
            // of reduce — so Worlds stays exactly as the shot above left it.
            hopper.selectTool('chat');
            await wait(500);
            // Maximising forces canResize false, which fitAxis turns into
            // 'push' on both axes unconditionally (see fitAxis's first
            // branch), so this is the shot that carries both mode notes — and
            // the only one that shows how they are split when both regions are
            // open: the panel takes the x note, the dock takes the y one, and
            // neither sentence appears twice. Waited out rather than assumed:
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
            const withPanel = hopper.state();
            log(`[capture] ${withPanel.title}: dock ${withPanel.dockOpen ? 'open' : 'closed'} over the worlds panel, mode x ${withPanel.mode.x}, y ${withPanel.mode.y}`);
            await shoot(`${id}-dock-with-panel`, hopper);
            // Undone immediately, and waited out the same way: the shots
            // below must start from a genuinely restored window, not one
            // mid-animation back down, or the same race runs again on
            // whatever opens next.
            hopper.window.unmaximize();
            const restored = Date.now() + 5_000;
            while (Date.now() < restored && hopper.window.isMaximized()) await wait(100);
            hopper.selectTool('chat');
            await wait(500);

            const target = view?.worlds.find(w => w.id !== view.current);
            if (target) {
                const result = await Promise.race([hopper.switchWorld(target.id), wait(loadTimeoutMs).then((): 'timeout' => 'timeout')]);
                log(`[capture] ${id} switched to world ${target.id}: ${result}`);
                await wait(Math.min(settleMs, 8_000));
                await shoot(`${id}-w${target.id}`, hopper);
                log(`[capture] tab now reads "${hopper.state().tabs[0]?.title}", title "${hopper.window.getTitle()}"`);
                log(`[capture] state file: ${existsSync(appState.file) ? readFileSync(appState.file, 'utf8').replace(/\s+/g, ' ') : '(none)'}`);
            }

            // Chat on the side: the one state a reader cannot infer from the
            // other two. Captured here, while Worlds is still genuinely open
            // on `hopper` from the lines just above, so moveChat('side')
            // evicting it is a real eviction rather than a no-op — `hopper`
            // is often the same window as `first` below, and closing that
            // window's panel first (for a clean dock shot) would leave
            // nothing here to evict.
            hopper.window.moveTop();
            hopper.focus();
            await wait(500);
            hopper.moveChat('side');
            await wait(500);
            const side = hopper.state();
            log(`[capture] ${side.title}: chat moved to the side, evicting worlds; mode x ${side.mode.x}, y ${side.mode.y}`);
            await shoot(`${side.server.id}-chat-side`, hopper);
        } else {
            log('[capture] chat-side skipped: no window had worlds to evict');
        }

        // The chat dock: this profile has no nick — see the chat block in
        // app.whenReady, above — so chat never opens a socket here, and every
        // shot below lands on the nick prompt rather than a conversation.
        // That is the correct thing to capture, not a bug to paper over: log
        // it plainly so nobody later mistakes an offline dock for a broken one,
        // and never fake a connection just to get a prettier screenshot.
        log('[capture] chat: no nick in this profile, so the dock captures the nick prompt, not a conversation');

        // moveChat('bottom') rather than the rail's selectTool('chat'): it
        // lands on "dock open, default height, panel closed" unconditionally,
        // whatever `first` currently has open — including home already 'side'
        // if `first` and `hopper` are the same window and the eviction above
        // just ran on it. selectTool('chat') only opens the dock when home is
        // already 'bottom', so it cannot be trusted to recover from that.
        // Fronted first, as the Worlds tool is above: the pixel font is only
        // fetched once the shell paints, and font-display: block leaves the
        // room tabs and the title blank until it lands.
        first.window.moveTop();
        first.focus();
        await wait(500);
        first.moveChat('bottom');
        await wait(500);
        const dock1 = first.state();
        log(`[capture] ${dock1.title}: dock ${dock1.dockOpen ? 'open' : 'closed'} at ${dock1.dockHeight}px, mode x ${dock1.mode.x}, y ${dock1.mode.y}`);
        await shoot(`${dock1.server.id}-dock`, first);

        // Resized without a pointer: the same clamp chatSetDockHeight applies
        // in main, driven directly the way this whole function drives
        // ServerWindow rather than over IPC — there is no renderer here to
        // send the request. Proves the resize path end to end: the clamp, the
        // write to state.json, and every window relaying out around it.
        const dockWorkArea = screen.getDisplayMatching(first.window.getBounds()).workArea;
        const tallHeight = Math.round(Math.min(Math.max(500, DOCK_HEIGHT_MIN), dockWorkArea.height / 2));
        appState.setChat({ dockHeight: tallHeight });
        for (const sw of serverWindows.values()) sw.relayout();
        await wait(500);
        const dock2 = first.state();
        log(`[capture] ${dock2.title}: dock height set to ${dock2.dockHeight}px, mode x ${dock2.mode.x}, y ${dock2.mode.y}`);
        await shoot(`${dock2.server.id}-dock-tall`, first);

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

app.on('browser-window-focus', () => {
    reloadCatalogIfChanged();
    syncMenuPanelItem();
});

/** Set once the world has been stopped for the quit, so the second quit goes through. */
let worldStoppedForQuit = false;
app.on('before-quit', event => {
    quitting = true;
    // A height dragged and immediately quit on is still on the settle timer.
    flushDockHeight();
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
