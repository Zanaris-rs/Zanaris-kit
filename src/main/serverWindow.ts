import { BrowserWindow, Menu, WebContentsView, dialog, screen, shell, type MenuItemConstructorOptions, type NativeImage, type WebContents } from 'electron';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { IPC, type ShellState, type ToolId, type UpdateButton } from '../shared/ipc';
import { CHAT_PREFERRED_HEIGHT, GAME_PREFERRED_HEIGHT, GAME_PREFERRED_WIDTH, LOSTCITY_GAME_PREFERRED_HEIGHT, PANE_HEADER_HEIGHT, PANE_MIN_HEIGHT, PANE_MIN_WIDTH, SEAM, TAB_BAR_HEIGHT } from '../shared/layout';
import type { ChatPage, ChatView } from '../shared/chat';
import { firstPage } from '../shared/chatSettings';
import type { Detail, RememberedWorld, WorldsView } from '../shared/worlds';
import { lineTitle, type HomeServerView } from '../shared/homeserver';
import type { ShareView } from '../shared/share';
import type { DropTargets, DropZone, PaneView, SeamView } from '../shared/panes';
import { alertTitle, type TimerDef } from '../shared/timers';
import type { ThemeLook } from '../shared/themes';
import type { PaneTrouble } from '../shared/paneNotice';
import type { ListedTimer } from './timers/defs';
import { TimersRunner, isGameInput } from './timers/runner';
import { showAlertBanner } from './timers/electron';
import { allowPermission, decideNavigation, isPress, mayOpenBrowser } from './guard';
import { createPaneHost, type PaneHost } from './paneHost';
import { addPaneItems, paneContentItems, paneHeaderItems, paneHolding, paneMenuItems, type GameSizes, type PaneMenuItem } from './paneMenu';
import { arrangeForGame, canAppendColumn, contentOf, paneIds, parentSplitOf, type Edge, type PaneContent, type Rect, type Size } from './paneTree';
import { grownFrame, roomFor, shrunkFrame, sizedBy } from './windowRoom';
import { frameOptions, overlayFor, windowFrame } from './windowFrame';
import { chatPages, holdsGame, openWindowTabs, readsChat, sharingWithoutPane } from './tabs';
import { SETUP_PANES_MAX, instantiateLayout, layoutEntries, layoutFileName, readSetup, writeLayout, type StoredNode } from './layoutFile';
import { builtInSetups, openingSetup, opensWindow, sameSetup, type BuiltInSetupId, type NewWindowSetup } from './setups';
import { openingFrame, placeOf, type Place } from './windowPlace';
import { loadShell, preloadPath } from './renderer';
import { windowTitle } from './slots';
import { WorldSwitch } from './worlds/switch';
import { worldEndpoint } from './worlds/sources';
import type { WorldsService } from './worlds/service';
import type { HiscoresService } from './hiscores/service';
import type { ServerWindowHandle, WindowSpec } from './windows';

const OFFLINE_PAGE = join(__dirname, '../../static/offline.html');
const STARTING_PAGE = join(__dirname, '../../static/starting.html');
/**
 * Game and Chat's content area: the game at its preferred size and the chat
 * pane below it at its own, with the seam between them — the numbers
 * `setups.builtInSetups` gives Game and Chat, and the size a saved setup from
 * before setups carried one opens at. The tree fills the content area below the bar
 * exactly, so anything short of this would clip the bottom of the
 * canvas at the one size nobody chose. Lost City's page is taller than the
 * stock client's, so its windows open on its own game height.
 */
function defaultContent(serverId: string): { width: number; height: number; game: number } {
    const game = serverId === 'lostcity' ? LOSTCITY_GAME_PREFERRED_HEIGHT : GAME_PREFERRED_HEIGHT;
    return { width: GAME_PREFERRED_WIDTH, height: game + SEAM + CHAT_PREFERRED_HEIGHT, game };
}
/**
 * How often a latency is measured again while something shows it: the game's
 * header, or a Worlds pane. Each is also measured once when it opens — a game
 * as it loads, Worlds as its pane does — and Refresh measures on demand.
 *
 * Every probe is a TCP connect to a server somebody else runs, and every open
 * kit makes them: every ten seconds, as this once was, a thousand idle kits
 * sent Lost City's world hosts about a hundred connects a second. A figure a
 * quarter of an hour old still says which world is near.
 */
const PROBE_EVERY_MS = 15 * 60_000;
const PROBE_TIMEOUT_MS = 3_000;
/** Past this a file in the setups folder is refused unread. Ten panes of the longest bookmark come to a few kilobytes. */
const SETUP_FILE_MAX = 256 * 1024;

/**
 * Injected into every game page. The stock client is `body{overflow:auto}` around
 * a fixed 765x503 canvas plus a controls strip, inside a `center{min-height:100vh}`
 * flex column — and Chromium's vh ignores the scrollbar gutter, so one scrollbar
 * induces the other. Hiding the bars is the actual fix: a bar with no box reserves
 * no gutter, so there is nothing left for the other axis to react to.
 *
 * The other two rules do not touch that fix. `html, body { height: 100% }` and
 * `center { min-height: 100% }` replace the stock `100vh` with a percentage chain
 * — which needs a definite ancestor height to resolve at all, hence the
 * `height: 100%` — so the pre-existing "canvas centred in an oversized window"
 * look survives the swap. `justify-content: safe` is, on the current markup, a
 * no-op: `center` is body's only child and only ever carries `min-height`, never a
 * smaller fixed height, so it can never end up shorter than its own content for
 * `safe` to redirect. It stays as a guard against a future markup change, not
 * because it does anything today. When the page does overflow, it clips at the
 * bottom rather than the top for an unrelated, pre-existing reason: `overflow:
 * auto`'s resting scroll position is zero, so the visible window onto the content
 * starts at its top edge regardless of any of this.
 *
 * Scrolling still works, so 2x/3x Size stay pannable by wheel and trackpad.
 */
const GAME_PAGE_CSS = `
    html, body { height: 100% !important; }
    body { scrollbar-width: none !important; }
    body::-webkit-scrollbar, html::-webkit-scrollbar { display: none !important; }
    center { min-height: 100% !important; justify-content: safe center !important; }
`;

export type LoadResult = 'loaded' | 'failed';

/** What a window running your home server needs of the service; the service itself satisfies it. */
export interface HomeServerHandle {
    view(): HomeServerView;
    subscribe(fn: () => void): () => void;
    acquire(): Promise<string>;
    release(): void;
    retry(): Promise<string>;
    /** The selected line's build, asked for from the starting page. */
    download(): Promise<void>;
}

/** What a window running your home server needs of sharing: a view to draw, and a count of the windows that can stop it. */
export interface ShareHandle {
    view(): ShareView;
    acquire(): void;
    release(): void;
}

const STATUS_WORD: Record<HomeServerView['status'], string> = {
    stopped: 'stopped',
    missing: 'not downloaded',
    downloading: 'downloading',
    preparing: 'getting ready',
    starting: 'starting',
    ready: 'running',
    stopping: 'stopping',
    failed: 'failed'
};

function statusWord(status: HomeServerView['status']): string {
    return STATUS_WORD[status];
}

/**
 * Whether a view composites two frames within a second and a half, for
 * capture mode. Two frames: the first schedules the render, the second proves
 * it composited. Raced against a timeout because requestAnimationFrame does
 * not fire at all in a page that is not painting — a covered window's did
 * not, before capture's switch, and a window hidden once shown still does
 * not — so waiting on it alone hangs forever, which is exactly what it did,
 * and the timeout answers false, because a view that is not painting leaves
 * capturePage its last frame.
 */
export async function paintsFrames(contents: WebContents): Promise<boolean> {
    const frames = contents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))').then(
        () => true,
        () => false
    );
    return Promise.race([frames, new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1_500))]);
}

export interface ServerWindowDeps {
    log: (msg: string) => void;
    /** Return false to keep the window open. Main returns true without asking while quitting. */
    confirmClose: (title: string) => boolean;
    /**
     * Where this server's window of this number last closed, or null: none
     * recorded, or a capture, which reads none. `windowPlace.openingFrame`
     * decides whether it can still be used.
     */
    place: Place | null;
    /** 32px from the focused or last-opened game window, for when there is no place to go back to; null when none is open. */
    cascade: { x: number; y: number } | null;
    /** What new windows of this server open with, as stored, or null for Game and Chat. A getter: the Setups menu reads it again each time it opens. */
    newWindowSetup: () => NewWindowSetup | null;
    /** Stores what new windows of this server open with: the Setups menu's Open New Windows With. */
    setNewWindowSetup: (choice: NewWindowSetup) => void;
    /** Records where this window is as its close goes through, for the next window of its server and number. Main drops it in a capture. */
    rememberPlace: (place: Place) => void;
    /** The server's shared world list and latency, or null when the server has one page. */
    worlds: WorldsService | null;
    /** The server's shared hiscores lookup, or null when it offers none — which is what keeps the tool out of the menus of a window running your home server. */
    hiscores: HiscoresService | null;
    /**
     * The one conversation, which is the app's rather than this window's: every
     * window shows the same one. A getter rather than the service itself, since
     * the window only ever reads it — main pushes when it changes.
     */
    chat: () => ChatView;
    /**
     * Told as this window's state goes out with a chat pane showing the
     * conversation in its front tab, before `chat` is read: whatever pinged
     * you has been seen, so no game header, here or in another window, should
     * still show it, and the room chat has open is being read. Told from the
     * window's first layout on, which runs before main has the window in its
     * map.
     */
    chatShown: () => void;
    /**
     * Told as this window's state goes out with no chat pane showing the
     * conversation in its front tab: none at all, or only ones on their
     * Settings page. If no other window shows it either, the room chat has
     * open is no longer being read, and counts what arrives as any other room
     * does.
     */
    chatHidden: () => void;
    /**
     * Whether a window opened now should float above other apps, as the last
     * choice anywhere left it.
     */
    alwaysOnTop: () => boolean;
    /**
     * Asks before the game is closed — its pane, a tab holding it, or a setup
     * opened over the tab holding it — since each destroys the view and
     * disconnects the player. False keeps it. Main
     * returns true without asking when the user has turned the warning off.
     */
    confirmCloseGame: (via: 'pane' | 'tab' | 'setup') => Promise<boolean>;
    /**
     * This server's saved setups: the folder Save This Tab as a Setup…
     * writes into, the Setups menu lists, and Open Setups Folder opens.
     * Created when first needed, not before — a player who never saves a
     * setup gets no empty folder.
     */
    setupsDir: string;
    /** What this server remembered from last time, if anything. */
    remembered: RememberedWorld | null;
    /** Called whenever this window's world or detail changes. */
    remember: (remembered: RememberedWorld) => void;
    /** Latency of one host, for the current world's readout. */
    probe: (host: string, port: number, timeoutMs: number) => Promise<number | null>;
    /** The world this computer runs, for a window of kind singleplayer; null otherwise. */
    homeServer: HomeServerHandle | null;
    /** Sharing that world. Only a window running your home server takes it. */
    share: ShareHandle | null;
    /**
     * This window's clock definitions — its server's built-ins with the
     * player's edits, then the player's own — and whether the player is at
     * the most custom clocks. A getter: main calls `timersChanged` when the
     * app-wide definitions move, and the window reads them again.
     */
    timers: () => { listed: ListedTimer[]; customsFull: boolean };
    /**
     * The look this window wears: the theme being edited while Settings'
     * editor is open, and otherwise its server's own or the app's
     * (`appearance.lookFor`). A getter: any of those can change while the
     * window is open, and main calls `themeChanged` when one does. It reads
     * the app's state and nothing of this window's — never `state()`, which
     * reads it.
     */
    theme: () => ThemeLook;
    /** The tab bar's update button: `UpdateService.button()`. A getter, since main pushes every window when it changes. */
    update: () => UpdateButton | null;
    /**
     * A capture's window, which is not shown when it loads and raises no
     * banners: only capture's maximised shot puts one on screen. Its pages
     * paint anyway, by the Chromium switch capture mode sets in index.ts.
     * Shown and then hidden, the window would stop painting even with the
     * switch, and a banner from a window nobody is meant to see would land on
     * whatever the owner is doing.
     */
    headless: boolean;
}

export interface ServerWindow extends ServerWindowHandle {
    readonly id: number;
    readonly window: BrowserWindow;
    /** The shell view's webContents id, so IPC handlers can find the window from `event.sender`. */
    readonly shellContentsId: number;
    /**
     * The tab bar's Add pane: goes to the pane in this tab already holding
     * `content`, or adds a column down the tab's right edge holding it. The
     * game is moved rather than duplicated. Does nothing when a column is
     * needed and there is no room for one.
     */
    addPane(content: PaneContent): void;
    /**
     * The bar's Sharing button: Home server's pane, added as `addPane` adds one,
     * or in a new tab of its own when the active tab has no room for a column.
     * Nothing on a window that is not Home server's.
     */
    showHomeServer(): void;
    /**
     * The game header's ping, clicked: chat's pane, added as `addPane` adds
     * one, or in a new tab of its own when the active tab has no room for a
     * column, and on the conversation whichever page it was on.
     */
    showChat(): void;
    /** A chat pane's gear, a room in its tabs, or Connect on its Settings: that pane shows Settings or the conversation. Nothing for a pane that holds no chat. */
    showChatPage(paneId: string, page: ChatPage): void;
    /** Raises the tab bar's Add pane menu at a point in the window. */
    showAddPaneMenu(x: number, y: number): void;
    /** Raises the tab bar's Setups menu at a point in the window. */
    showSetupsMenu(x: number, y: number): void;
    /** One of the built-in setups, into the tab in front, as its menu item does. `missing` when this window does not offer it. */
    openBuiltInSetup(id: BuiltInSetupId): Promise<'opened' | 'cancelled' | 'missing'>;
    /** Whether this window floats above other apps. Read back from the window itself, not from a flag kept beside it. */
    alwaysOnTop(): boolean;
    setAlwaysOnTop(on: boolean): void;
    startTimer(id: string): void;
    pauseTimer(id: string): void;
    /** Back to the beginning, and running. */
    resetTimer(id: string): void;
    /** The app-wide definitions changed: this window's runner takes the new list. */
    timersChanged(): void;
    /** Judges this window's clocks at this moment: for a wake from sleep, when the runner's pending timeout is late. */
    settleTimers(): void;
    /** Splits a pane, putting an empty one showing the launcher in the new half. */
    splitPane(paneId: string, axis: 'x' | 'y'): void;
    /** Reset Game Size, as the game pane's menus run it. */
    resetGameSize(): void;
    /** Closes a pane. Asks first when it is the game's, since that disconnects the player. */
    closePane(paneId: string): Promise<void>;
    /** Puts something in a pane. A page must be one of this server's links; asking for the game moves it out of whatever pane held it. */
    setPaneContent(paneId: string, content: PaneContent): void;
    focusPane(paneId: string): void;
    /** Starts a header drag: hides every native view so the shell can draw drop targets over their rects, and answers where each drop would land. Null when the active tab has no such pane. */
    beginPaneDrag(from: string): DropTargets | null;
    /** Drops a dragged pane on another and ends the drag. The centre swaps the two; an edge moves the dragged pane beside the other, splitting it. */
    dropPane(from: string, to: string, zone: DropZone): void;
    /** Ends a drag without dropping. */
    endPaneDrag(): void;
    /** Raises the pane menu at a point in the window. */
    showPaneMenu(paneId: string, x: number, y: number): void;
    /** Raises a pane header's dropdown — everything that pane could become — at a point in the window. */
    showPaneContentMenu(paneId: string, x: number, y: number): void;
    /** Drags a seam. Returns the position actually applied, on every path including the one that changes nothing. */
    setSeam(splitId: string, index: number, px: number): number;
    evenOut(splitId: string): void;
    /** Even out the split the focused pane sits in. The View menu's item, which has a pane rather than a split to go on. */
    evenOutFocused(): void;
    /** The focused page pane's toolbar. */
    pageGo(where: 'back' | 'forward' | 'reload'): void;
    /** A button on a pane's notice: reload the game or page that stopped, wait for one that hung, or close the pane. */
    paneNotice(paneId: string, action: 'reload' | 'wait' | 'close'): void;
    newTab(): void;
    /**
     * Closes a tab and everything in it. Asks first when the tab holds the
     * game, since that disconnects the player; closing the last one closes the
     * window, as it always has, behind the window's own confirm.
     */
    closeTab(tabId: string): Promise<void>;
    selectTab(tabId: string): void;
    /** Raises a tab's menu, which is Close Tab, at a point in the window. Setups are the tab bar's Setups menu. */
    showTabMenu(tabId: string, x: number, y: number): void;
    /**
     * Writes the tab in front's panes to a setup file, with the size of tab
     * they are drawn at. Throws when the file cannot be written, and when
     * `tabId` is not the tab in front, whose size is the only one the window
     * has; the menu reports that, capture mode fails on it.
     */
    saveSetupTo(tabId: string, path: string): void;
    /**
     * Opens a setup file into a tab, asking first when that closes the game,
     * and sizes the window around the game when the setup holds one and was
     * saved with a size. `unreadable` is a file that could not be read or is
     * not a setup, and leaves the tab as it was.
     */
    openSetupFrom(tabId: string, path: string): Promise<'opened' | 'unreadable' | 'cancelled' | 'missing'>;
    /** Re-runs the layout and pushes the result. For app-wide changes that move things, where pushState alone would only repaint the old geometry. */
    relayout(): void;
    state(): ShellState;
    /** Sends the current state to the shell. For app-wide changes main hears about, not the window. */
    pushState(): void;
    /** What this window wears changed — the app theme, this server's, or the theme being edited: repaint the native grounds and send the shell its new palette. Nothing reloads. */
    themeChanged(): void;
    /** Resolves when the most recent load finished, or failed over to the offline page. */
    whenGameLoaded(): Promise<LoadResult>;
    switchWorld(world: number): Promise<LoadResult | 'unknown'>;
    setDetail(detail: Detail): Promise<LoadResult | 'unchanged'>;
    refreshWorlds(): Promise<void>;
    /**
     * Whether the shell is painting: true once it has composited two frames
     * since the call, false if it has not within a second and a half.
     * capturePage hands back the last composited frame, so a shot of a shell
     * that is not painting photographs whatever it last drew, and reads as
     * correct in the log. A shell in a window another app's covered did
     * exactly that until capture's switch kept such a window painting, and
     * had capture mode reporting a stale panel three times over, and writing
     * byte-identical shots of different steps.
     */
    settle(): Promise<boolean>;
    /** Page content of one view, for capture mode. A window's own webContents holds nothing. */
    captureShell(): Promise<NativeImage>;
    captureGame(): Promise<NativeImage>;
    /** Capture mode only: kills a view's renderer, as a crash would, to show what the window does about it. */
    crashForCapture(what: 'game' | 'shell' | 'page'): void;
    /**
     * The focused page pane, for capture mode. Resolves with null when no pane
     * holds a page: there is no view to shoot. Rejects when the page is not
     * painting, rather than hand back the frame it last drew.
     */
    capturePage(): Promise<NativeImage | null>;
}

/**
 * One server window: a full-window shell view (React, preload) with the game
 * view placed on top of it inside the content rect. Main owns all geometry;
 * the shell only draws where main says things are.
 *
 * The game view has no preload and no IPC. Its page is byte-for-byte what the
 * server served, and nothing the page does can replace it: the only way it
 * changes page is `loadGame` here. `backgroundThrottling: false` keeps its
 * setTimeout-driven loop at full rate while another window is in front.
 */
export function createServerWindow(spec: WindowSpec, onClosed: () => void, deps: ServerWindowDeps): ServerWindow {
    const { server } = spec;
    const tag = `[${spec.title}]`;
    const worldSwitch = server.worlds && deps.worlds ? new WorldSwitch(server.worlds, server.url, deps.remembered) : null;
    const single = server.kind === 'singleplayer' ? deps.homeServer : null;
    const shared = single ? deps.share : null;
    /**
     * The tools this window offers. Chat is app-scoped, so every window offers
     * it, and first: it is there whether or not the server has worlds to hop
     * between. Everything after it is this window's server's — worlds to hop
     * between, hiscores to look a player up on, the world this computer runs.
     *
     * Each of the three is offered because the window was *given* the thing
     * behind it, rather than because of what kind of server this is: no
     * hiscores def means no service, no service means no tool, and single
     * player is the case that matters — a one-player world has nothing to
     * rank, and its catalog entry carries no hiscores, so the tool never
     * reaches its menus without anything here naming it.
     *
     * The order declared here is the order every menu lists them in — a
     * pane's dropdown, the launcher and Add pane all take it from
     * `paneMenu.ts`, which takes it from this.
     *
     * Timers is offered in every window: every server carries the built-in
     * clocks, and the player's own are app-wide.
     */
    const tools: ToolId[] = ['chat'];
    if (worldSwitch) tools.push('worlds');
    if (deps.hiscores) tools.push('hiscores');
    tools.push('timers');
    if (single) tools.push('singleplayer');
    // Which tools a window came up with is otherwise only visible by opening a
    // menu, and a tool missing from it looks the same as a tool that drew
    // nothing. One line at open says which of the two happened.
    deps.log(`${tag} tools: ${tools.join(' · ')}`);

    /** The URL main last asked the game view to load. The offline page may return to it; nothing else may navigate. */
    let expected = worldSwitch ? worldSwitch.url : server.url;
    let currentLatency: number | null = null;
    /** Where the window's own chrome sits. The panes' rects belong to the host. */
    let rects = { tabBar: { x: 0, y: 0, width: 0, height: 0 }, tree: { x: 0, y: 0, width: 0, height: 0 } };
    /**
     * The live game view, or null once it has been closed.
     *
     * Closing the game pane, or the tab it is in, destroys it rather than
     * hiding it. A view kept alive behind a closed pane is a character still
     * standing in the world with nobody watching it, which is a worse failure
     * than the fresh login that reopening costs — and the confirm in
     * `index.ts` says so first.
     */
    let gameView: WebContentsView | null = null;
    /**
     * The game's renderer crashed or hung. Its view is hidden while this is
     * set and its pane shows a notice instead (`paneNotice.troubleNotice`),
     * so a game that has stopped reads as stopped rather than as a frozen
     * frame or an empty pane — the layout invariant's "obviously suspended".
     */
    let gameTrouble: PaneTrouble | null = null;
    /**
     * The game's renderer is about to go because the kit killed a hung one to
     * reload it, so the next `render-process-gone` is not a crash. Once only,
     * and only within a few seconds: a fresh renderer that then crashes for
     * real is reported like any other.
     */
    let expectGameGoneUntil = 0;
    let failedOver = false;
    let loadWaiter: ((result: LoadResult) => void) | null = null;
    let loadPromise: Promise<LoadResult> = Promise.resolve('loaded');
    /** True between a loadGame and its result, so a kit page can tell it is superseding one. */
    let gameLoadPending = false;

    /*
     * What the window opens with and where, both decided before it exists
     * (`setups.openingSetup`, `windowPlace.openingFrame`): the setup chosen for
     * this server's new windows, or Game and Chat, at the place this window's
     * number last closed at if its tab bar can still be reached. So the window
     * is built at its size and place rather than opened and then moved, and
     * opening it is not one of the things that resize a window; one that
     * closed maximised or full screen is made so again as it is shown, below,
     * which puts back the player's state rather than sizing it. The size is
     * held to the display it opens on, and the first layout is fitted to the
     * size it got as a resize is (`tabs.openWindowTabs`).
     */
    const content = defaultContent(server.id);
    const opening = openingSetup(deps.newWindowSetup(), { builtIns: builtInSetups({ tools, gameHeight: content.game }), saved: savedSetups(), read: readSaved });
    deps.log(`${tag} opens with ${opening.name}${opening.fellBack ? `, not the setup chosen: ${opening.fellBack}` : ''}`);
    let openingPane = 1;
    let openingSplit = 1;
    const start = openWindowTabs(
        instantiateLayout(opening.tree, { tools, links: server.bookmarks, nextPane: () => `pane-${openingPane++}`, nextSplit: () => `split-${openingSplit++}` }),
        opening.size
    );
    // A saved setup from before setups carried a size opens at Game and Chat's, laid out by its fractions.
    const tab = start.size ?? { width: content.width, height: content.height };
    const opened = openingFrame({
        content: { width: tab.width, height: TAB_BAR_HEIGHT + tab.height },
        remembered: deps.place,
        cascade: deps.cascade,
        workAreas: screen.getAllDisplays().map(display => display.workArea),
        cursor: screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    });
    const win = new BrowserWindow({
        ...opened.frame,
        // One pane's floor plus the chrome that never gives way. A constant
        // now: the old minimum moved as the dock opened and closed, because it
        // was protecting a region the layout was also protecting. Nothing is
        // protected any more — every pane gives way together — so there is
        // nothing left for the floor to track.
        minWidth: PANE_MIN_WIDTH,
        minHeight: TAB_BAR_HEIGHT + PANE_MIN_HEIGHT,
        useContentSize: true,
        title: spec.title,
        // No title bar on macOS or Windows: the tab bar stands in for it (`windowFrame.ts`).
        ...frameOptions(process.platform, deps.theme()),
        // The theme's ground, which shows only until the shell draws.
        backgroundColor: deps.theme().colors.window,
        show: false,
        // The last choice made anywhere, so a window opened while the app is
        // pinned comes up pinned rather than needing the menu again.
        alwaysOnTop: deps.alwaysOnTop()
    });

    // The one view here with the preload, and so with every call main answers
    // as this window. `loadShell` holds it to its page.
    const shellView = new WebContentsView({
        webPreferences: {
            preload: preloadPath(),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true
        }
    });
    shellView.setBackgroundColor(deps.theme().colors.window);

    /**
     * Builds the game view and puts it in the window.
     *
     * `backgroundThrottling: false` is why a game keeps playing while it is not
     * the tab in front, exactly as it already keeps playing with the whole
     * window behind another app. That is the one thing the tab design rests on
     * that no test here can prove.
     */
    function makeGameView(): WebContentsView {
        const view = new WebContentsView({
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                webSecurity: true,
                partition: spec.partition,
                backgroundThrottling: false
            }
        });
        view.setBackgroundColor('#000000');
        // Order matters: later children draw on top. Every game and page view
        // sits over the shell, which draws the chrome and leaves their rects empty.
        win.contentView.addChildView(view);
        wireGameView(view);
        return view;
    }

    /**
     * This window's clocks. The runner holds every rule; this end gives it a
     * clock and a timer, and turns its alerts into a banner and a sound. Each
     * window has its own, because each game is its own login with its own
     * idle timer.
     */
    const firstTimers = deps.timers();
    let customsFull = firstTimers.customsFull;
    const clocks = new TimersRunner(firstTimers.listed, {
        now: Date.now,
        setTimer: (fn, ms) => {
            const timer = setTimeout(fn, ms);
            return () => clearTimeout(timer);
        },
        alert: (def, at) => alertClock(def, at),
        changed: () => pushState()
    });

    /** A banner only when the window is not focused: in front of the player, the pane and the sound are already enough. Never in a capture, whose window is never focused. */
    function alertClock(def: TimerDef, at: 'threshold' | 'zero'): void {
        const heading = alertTitle(def, at);
        deps.log(`${tag} ${heading}`);
        if (win.isDestroyed()) return;
        if (!win.isFocused() && !deps.headless) showAlertBanner(win, heading, title());
        if (def.volume > 0 && !shellView.webContents.isDestroyed()) shellView.webContents.send(IPC.timersAlert, { volume: def.volume });
    }

    win.contentView.addChildView(shellView);
    // A shell that goes mid-drag is reloaded (`loadShell`) with no drag of its
    // own to end, and every native view stays hidden until one ends — the
    // game out of sight with nothing saying why. So its going ends the drag.
    shellView.webContents.on('render-process-gone', () => host.endDrag());
    gameView = makeGameView();

    /**
     * Each chat pane's page, Settings or the conversation, in every tab: the
     * shell shows it, and a pane on Settings is chat out of sight. Read only
     * through `currentChatPages`, which brings it up to date with the tabs
     * first (`tabs.chatPages`), so a chat pane new since starts on chat's
     * `firstPage` and one gone drops out.
     */
    let chatPageOf = new Map<string, ChatPage>();

    function currentChatPages(): ReadonlyMap<string, ChatPage> {
        chatPageOf = chatPages(host.trees(), chatPageOf, () => firstPage(deps.chat()));
        return chatPageOf;
    }

    /**
     * The active tab's panes and the views inside them. Every rule about the
     * tree is in `paneTree`, which is pure and tested; this end of it only
     * names the gesture and lets the window lay out around the answer.
     */
    const host: PaneHost = createPaneHost({
        window: win,
        gameView: () => gameView,
        gameTrouble: () => gameTrouble,
        bookmarks: () => server.bookmarks,
        tools: () => tools,
        hosts: () => server.hosts,
        sharing: () => linkLive(),
        log: line => deps.log(`${tag} ${line}`),
        initial: start.set,
        initialSize: start.size,
        changed: () => applyLayout(),
        contextMenu: (paneId, x, y) => showPaneMenu(paneId, x, y),
        touched: () => pushState(),
        background: () => deps.theme().colors.window,
        chatPage: paneId => currentChatPages().get(paneId) ?? null
    });

    // ── labels ───────────────────────────────────────────────────────────

    function gameLabel(): string {
        // The revision of the line the world runs, which a switch changes under an open window.
        if (single) return `${server.name} · rev ${single.view().revision} · ${statusWord(single.view().status)}`;
        return worldSwitch ? worldSwitch.label(server.name, currentLatency) : server.name;
    }

    function title(): string {
        return worldSwitch ? windowTitle(worldSwitch.title(server.name), spec.slot) : spec.title;
    }

    function refreshLabels(): void {
        if (!win.isDestroyed()) win.setTitle(title());
    }

    // ── state ────────────────────────────────────────────────────────────

    function worldsView(): WorldsView | null {
        if (!worldSwitch || !deps.worlds || !server.worlds) return null;
        return { ...deps.worlds.view(), current: worldSwitch.world, detail: worldSwitch.detail, showDetail: server.worlds.detail };
    }

    /** Whether anyone with the link can reach this world right now. Before `live` the link does not work yet, so there is nothing to mark. */
    function linkLive(): boolean {
        return shared?.view().status === 'live';
    }

    function state(): ShellState {
        return {
            windowId: spec.id,
            server,
            slot: spec.slot,
            title: title(),
            gameLabel: gameLabel(),
            rects,
            frame: windowFrame(process.platform, !win.isDestroyed() && win.isFullScreen()),
            tabs: host.tabs(),
            panes: host.panes(),
            seams: host.seams(),
            tools,
            worlds: worldsView(),
            hiscores: deps.hiscores?.view() ?? null,
            chat: deps.chat(),
            homeServer: single?.view() ?? null,
            share: shared?.view() ?? null,
            sharingWithoutPane: sharingWithoutPane(host.trees(), linkLive()),
            update: deps.update(),
            timers: { clocks: clocks.view(), customsFull },
            theme: { colors: deps.theme().colors, background: deps.theme().background }
        };
    }

    function pushState(): void {
        if (shellView.webContents.isDestroyed()) return;
        if (readsChat(host.tree(), currentChatPages())) deps.chatShown();
        else deps.chatHidden();
        try {
            shellView.webContents.send(IPC.shellState, state());
        } catch (err) {
            deps.log(`${tag} could not push state: ${(err as Error).message}`);
        }
    }

    /**
     * Repaints what main paints — the window, the shell view and every page
     * view, in the theme's ground, and on Windows the window buttons' glyphs,
     * in its text colour — and sends the shell its palette. The game view
     * keeps its black: that is the game's own ground, never themed.
     */
    function themeChanged(): void {
        if (win.isDestroyed()) return;
        const look = deps.theme();
        const ground = look.colors.window;
        win.setBackgroundColor(ground);
        shellView.setBackgroundColor(ground);
        const overlay = overlayFor(process.platform, look);
        if (overlay) win.setTitleBarOverlay(overlay);
        host.repaintBackground();
        pushState();
    }

    // ── layout ───────────────────────────────────────────────────────────

    /**
     * Where everything goes.
     *
     * The bar across the top and the tree in the rest. The widen / shift /
     * push ladder, the content extent carried across a chrome toggle and the
     * per-axis mode the shell used to report all went with the fixed chrome
     * that motivated them, and so did the tool rail down the right; the bar's
     * Add pane is how a pane is added. The window resizes itself for four
     * things: a pane added where the game would otherwise have paid for it
     * (`paneTree.makeRoom`, through `growWindow`), a pane closed in the
     * game's own row or column giving that room back
     * (`paneTree.closeGivingBack`, through `shrinkWindow`), a setup opened
     * that holds the game and carries a size, sized to hold the game at its
     * pixels and every other pane at the ones it was saved with
     * (`paneTree.arrangeForGame`, through `sizeWindow`), and Reset Game Size,
     * sized the same way around the game at its preferred size
     * (`paneTree.resetAround`, through `sizeWindow`). Each way it is the
     * resize that lays everything out again, through here.
     *
     * The tree runs to the window's edges. It used to be inset by a pixel so a
     * gold ring round the focused pane had shell to land on; focus is a dot in
     * the pane's header now, and a border of ink round every window was all
     * that pixel had left to do.
     */
    function applyLayout(): void {
        if (win.isDestroyed()) return;
        const { width, height } = win.getContentBounds();
        rects = {
            tabBar: { x: 0, y: 0, width, height: Math.min(TAB_BAR_HEIGHT, height) },
            tree: { x: 0, y: TAB_BAR_HEIGHT, width, height: Math.max(0, height - TAB_BAR_HEIGHT) }
        };
        shellView.setBounds({ x: 0, y: 0, width, height });
        host.layout(rects.tree);
        pushState();
    }

    win.on('resize', () => applyLayout());
    // A maximise or a fullscreen changes the content bounds without a resize
    // event on every platform, so the layout is re-run for both. Full screen
    // is also where macOS takes its window buttons off the tab bar, and the
    // state the layout pushes carries that (`windowFrame`).
    win.on('maximize', () => applyLayout());
    win.on('unmaximize', () => applyLayout());
    win.on('enter-full-screen', () => applyLayout());
    win.on('leave-full-screen', () => applyLayout());

    // ── the panes ────────────────────────────────────────────────────────

    let panelProbe: NodeJS.Timeout | null = null;

    /**
     * The whole list is probed only while a Worlds pane is open somewhere in
     * this window, in any tab: once as it opens, then every `PROBE_EVERY_MS`.
     * Any tab rather than the one in front, so switching tabs neither starts a
     * pass nor leaves a Worlds pane unmeasured when its tab comes back.
     */
    function syncPanelProbe(): void {
        const worlds = deps.worlds;
        const anywhere = host.trees().some(tree => paneIds(tree).some(id => {
            const content = contentOf(tree, id);
            return content?.kind === 'tool' && content.tool === 'worlds';
        }));
        const wanted = anywhere && worldSwitch !== null && worlds !== null;
        if (wanted && worlds && !panelProbe) {
            const probeAll = (): void => {
                void worlds.probeAll(worldSwitch!.detail);
            };
            // The list first, then latencies over it. `probeAll` has nothing to
            // probe until the worlds are known, so an open that only probed
            // left the pane reading "idle" until someone pressed Refresh —
            // which is exactly what dropping this line did.
            void worlds.list().then(probeAll);
            panelProbe = setInterval(probeAll, PROBE_EVERY_MS);
        } else if (!wanted && panelProbe) {
            clearInterval(panelProbe);
            panelProbe = null;
        }
    }

    /**
     * The tab bar's Add pane. Something already in this tab is brought into
     * focus instead of opened a second time — the menu ticks it, so that is
     * what the player was told would happen — and anything else gets a new
     * column down the tab's right edge (`paneTree.appendColumn`), with the
     * window grown by what the column would have taken from the game
     * (`split` does the same). Nothing already on screen is replaced, which
     * is the difference from a pane's own dropdown: that one changes a pane,
     * this one adds one.
     *
     * The game goes in through `setPaneContent` rather than straight into the
     * column, because it is a move: the window has one game view, and the pane
     * it leaves in another tab has to be emptied in the same breath.
     */
    function addPane(content: PaneContent): void {
        if (content.kind === 'tool' && !tools.includes(content.tool)) return;
        if (content.kind === 'page' && !server.bookmarks.some(b => b.url === content.bookmark)) return;
        const open = paneHolding(host.tree(), content);
        if (open) {
            host.focus(open);
            return;
        }
        if (!canAppendColumn(host.tree(), rects.tree.width)) {
            deps.log(`${tag} no room to add a pane`);
            return;
        }
        const born = host.appendColumn(content.kind === 'game' ? { kind: 'empty' } : content, rects.tree.width, roomToGrow());
        growWindow(born.grown);
        if (content.kind === 'game') setPaneContent(born.paneId, content);
        syncPanelProbe();
    }

    /** Split Right and Split Down, from the menus, the header's dropdown and the keyboard alike. */
    function split(paneId: string, axis: 'x' | 'y'): void {
        growWindow(host.split(paneId, axis, roomToGrow()));
    }

    /**
     * How much the window may grow for a pane the game would otherwise pay
     * for (`paneTree.makeRoom`): up to the size of its display, and not at all
     * while it is maximised or full screen, since it already fills the screen
     * and a resize would only take it out of that.
     */
    function roomToGrow(): Size {
        if (win.isDestroyed() || win.isFullScreen() || win.isMaximized()) return { width: 0, height: 0 };
        const frame = win.getBounds();
        return roomFor(frame, screen.getDisplayMatching(frame).workArea);
    }

    /** The window grown by what a new pane needed, kept on its display (`windowRoom.grownFrame`). Its resize lays everything out again. */
    function growWindow(by: Size): void {
        if (win.isDestroyed() || (by.width <= 0 && by.height <= 0)) return;
        const frame = win.getBounds();
        win.setBounds(grownFrame(frame, screen.getDisplayMatching(frame).workArea, by));
    }

    /**
     * How far the window may shrink to give a closed pane's room back
     * (`paneTree.closeGivingBack`): as far as its tree reaches, which the
     * tree's own floor then limits, and not at all while it is maximised or
     * full screen, since it fills the screen and a resize would only take it
     * out of that.
     */
    function roomToShrink(): Size {
        if (win.isDestroyed() || win.isFullScreen() || win.isMaximized()) return { width: 0, height: 0 };
        return { width: rects.tree.width, height: rects.tree.height };
    }

    /** The window less a closed pane's room, taken off at that pane's side (`windowRoom.shrunkFrame`). Its resize lays everything out again. */
    function shrinkWindow(by: Size, edge: Edge): void {
        if (win.isDestroyed() || (by.width <= 0 && by.height <= 0)) return;
        win.setBounds(shrunkFrame(win.getBounds(), by, edge));
    }

    /** A tool's pane, added as `addPane` adds one, or in a new tab of its own when the active tab has no room for a column. */
    function showTool(tool: ToolId): void {
        const content: PaneContent = { kind: 'tool', tool };
        if (paneHolding(host.tree(), content) || canAppendColumn(host.tree(), rects.tree.width)) {
            addPane(content);
            return;
        }
        host.newTab();
        host.setContent(host.focusedPaneId(), content);
    }

    function showHomeServer(): void {
        if (single) showTool('singleplayer');
    }

    function showChat(): void {
        showTool('chat');
        const shown = paneHolding(host.tree(), { kind: 'tool', tool: 'chat' });
        if (shown !== null) showChatPage(shown, 'chat');
    }

    function showChatPage(paneId: string, page: ChatPage): void {
        const pages = currentChatPages();
        if (!pages.has(paneId) || pages.get(paneId) === page) return;
        chatPageOf.set(paneId, page);
        pushState();
    }

    /**
     * The menu under the tab bar's Add pane: everything a new column could
     * hold, from `paneMenu.addPaneItems`, which is the dropdown's list with
     * two differences it works out and tests — what is already in this tab is
     * ticked, and everything else is greyed when the tab has no room for
     * another column.
     *
     * Native and built here for the reason the pane menus are: it drops down
     * over the panes, and a list the shell drew would open behind a game or a
     * page view.
     */
    function showAddPaneMenu(x: number, y: number): void {
        if (win.isDestroyed()) return;
        const items = addPaneItems({ tree: host.tree(), trees: host.trees(), tools, links: server.bookmarks, width: rects.tree.width });
        const template: MenuItemConstructorOptions[] = items.flatMap((item, i): MenuItemConstructorOptions[] => [
            ...(i > 0 && item.group === 'link' && items[i - 1]!.group !== 'link' ? [{ type: 'separator' as const }] : []),
            {
                label: item.label,
                // Ticked the way a Window menu ticks the window already open:
                // choosing it goes there rather than opening another.
                type: 'checkbox' as const,
                checked: item.openIn !== null,
                enabled: item.enabled,
                click: () => addPane(item.content)
            }
        ]);
        Menu.buildFromTemplate(template).popup({ window: win, x: Math.round(x), y: Math.round(y) });
    }

    /**
     * Puts something in a pane, with the one refusal main owes the shell and
     * the one thing it does instead of refusing.
     *
     * A page may only be one of this server's own links: there is no address
     * box, so the shell has no legitimate reason to name anything else, and a
     * page view lives in a session shared with every other window's.
     *
     * The game is not refused; it *moves*. Two game leaves stay
     * unrepresentable — the window is bound to one server and has one game
     * view — but asking for the game in a second pane now empties the pane it
     * was in, in whichever tab that was, rather than being ignored. It costs
     * nothing: the view is repositioned by the next layout and never reloaded,
     * so the login survives a move exactly as it survives a seam drag. Only a
     * window with no game at all pays a login, and that is a fresh one being
     * opened rather than one being moved.
     */
    function setPaneContent(paneId: string, content: PaneContent): void {
        if (content.kind === 'page' && !server.bookmarks.some(b => b.url === content.bookmark)) {
            deps.log(`${tag} refused to open ${content.bookmark}: not one of this server's links`);
            return;
        }
        if (content.kind === 'game') {
            if (!gameView) {
                gameView = makeGameView();
                void loadGame(expected);
            }
            host.moveGame(paneId);
        } else {
            host.setContent(paneId, content);
        }
        syncPanelProbe();
    }

    /**
     * What Reset Game Size puts the game back to: its preferred size, the one
     * the built-in setups open it at on this server, Lost City's taller page
     * included — not the size a saved setup opened it at, which is that
     * setup's — against the rect the tab is laid out in now; how far the
     * window may grow on its display; and whether it may be resized at all,
     * which it may not while maximised or full screen, where Reset Game Size
     * only moves seams.
     */
    function gameSizes(): GameSizes {
        return { tab: rects.tree, game: { width: GAME_PREFERRED_WIDTH, height: content.game }, resizable: !win.isMaximized() && !win.isFullScreen() };
    }

    /**
     * Reset Game Size: the game back at its size, the window resized by what
     * it changed and every other pane keeping its pixels (`paneHost.resetGame`,
     * `sizeWindow`), as a setup opened around the game is. Maximised or full
     * screen, the seams around the game move instead.
     */
    function resetGameSize(): void {
        const sizes = gameSizes();
        const size = host.resetGame(sizes.game, sizes.resizable);
        if (size) sizeWindow(size);
    }

    /**
     * The pane menu, raised by a right-click anywhere in a pane.
     *
     * Built in main rather than drawn by the shell because a right-click on a
     * game or a page never reaches the shell — those are native views stacked
     * above it, and only they see the pointer. One builder with three callers
     * is the only way the menu is the same object everywhere; a shell-drawn one
     * would have had to be a second menu for the two kinds of pane it cannot
     * cover, and two menus are two menus that drift.
     *
     * Which items are legal is `paneMenu.ts`, which is pure and tested against
     * the same minimums the solver enforces — an item offered and then refused
     * is worse than one never offered.
     */
    function showPaneMenu(paneId: string, x: number, y: number): void {
        if (win.isDestroyed()) return;
        const rect = host.rectOf(paneId);
        if (!rect) return;
        // Right-clicking a pane focuses it first, so the menu acts on what was
        // clicked rather than on whatever happened to have focus — every item
        // below names the pane, but Even Out and the accelerators do not.
        host.focus(paneId);
        const menu = Menu.buildFromTemplate(paneMenuItems(host.tree(), paneId, rect, gameSizes()).map(item => gestureItem(paneId, item)));
        menu.popup({ window: win, x: Math.round(x), y: Math.round(y) });
    }

    /** One gesture as a native menu item, for both menus that carry gestures. */
    function gestureItem(paneId: string, item: PaneMenuItem): MenuItemConstructorOptions {
        return {
            label: item.label,
            enabled: item.enabled,
            accelerator: item.accelerator,
            registerAccelerator: false,
            click: () => {
                if (item.id === 'split-x') split(paneId, 'x');
                else if (item.id === 'split-y') split(paneId, 'y');
                else if (item.id === 'close') void closePane(paneId);
                else if (item.id === 'reset-game') resetGameSize();
                else {
                    const splitId = parentSplitOf(host.tree(), paneId);
                    if (splitId) host.evenOut(splitId);
                }
            }
        };
    }

    /**
     * The dropdown in a pane's header: everything that pane could become, and
     * then, under a rule, the two ways to split it — which `paneSplitItems`
     * takes from the right-click menu, because nothing on screen says that
     * menu exists and the arrow is the control a player will actually try.
     *
     * Native, and built here, for the reason the gesture menu above is: the
     * header of a game or a page pane sits directly over a native view, and a
     * list the shell drew would open behind it. Building it in main is also
     * what lets one object serve all four kinds of pane — the launcher an empty
     * pane shows is the same list from the same function, wearing the stone
     * instead of the system's chrome.
     *
     * Which items exist, what they are called and which one is already showing
     * are `paneMenu.ts`'s, not this function's and certainly not the shell's.
     * The game's label is the one that moves: it reads "Move game here" while
     * the game is in some other pane of this window, in this tab or another.
     */
    function showPaneContentMenu(paneId: string, x: number, y: number): void {
        if (win.isDestroyed()) return;
        host.focus(paneId);
        const items = paneContentItems({ trees: host.trees(), paneId, tools, links: server.bookmarks });
        const template: MenuItemConstructorOptions[] = items.flatMap((item, i): MenuItemConstructorOptions[] => [
            // The links are a different kind of destination from the window's
            // own things, and the group each item arrives in is what says where
            // that line falls — the same rule the launcher draws.
            ...(i > 0 && item.group === 'link' && items[i - 1]!.group !== 'link' ? [{ type: 'separator' as const }] : []),
            {
                label: item.label,
                // A radio rather than a checkbox: a pane holds exactly one
                // thing, so these are alternatives rather than a set of toggles.
                type: 'radio' as const,
                checked: item.current,
                click: () => setPaneContent(paneId, item.content)
            }
        ]);
        const rect = host.rectOf(paneId);
        const gestures = rect ? paneHeaderItems(host.tree(), paneId, rect, gameSizes()) : [];
        if (gestures.length > 0) template.push({ type: 'separator' }, ...gestures.map(item => gestureItem(paneId, item)));
        Menu.buildFromTemplate(template).popup({ window: win, x: Math.round(x), y: Math.round(y) });
    }

    /**
     * Closes a pane, asking first when it is the game's.
     *
     * Closing the game destroys its view, which disconnects the player. The
     * alternative — keeping it alive behind a closed pane — is worse than the
     * fresh login reopening costs: a character still standing in the world with
     * nobody watching it dies to events its player cannot see. So the view goes,
     * and the confirm says so before it does.
     *
     * A pane closed in the game's own row or column gives its room back to
     * the screen (`paneTree.closeGivingBack`, through `shrinkWindow`), so the
     * game keeps its size and stays where it is.
     */
    async function closePane(paneId: string): Promise<void> {
        const isGame = contentOf(host.tree(), paneId)?.kind === 'game';
        if (isGame) {
            // A game whose renderer has gone is already disconnected, so there
            // is no login left for the question to protect.
            if (gameTrouble?.kind !== 'crashed' && !(await deps.confirmCloseGame('pane'))) return;
            destroyGame('pane');
        }
        const given = host.close(paneId, roomToShrink());
        if (given.edge) shrinkWindow(given.shrunk, given.edge);
        syncPanelProbe();
    }

    /**
     * Closes a tab, asking first when the game is in it.
     *
     * The same cost as closing the game's pane and the same answer: the view is
     * destroyed rather than left running with no pane to show it in. Before
     * this asked, closing a game's tab removed the leaf and kept the view — a
     * character still logged in behind a window that no longer had anywhere to
     * put it, reachable only by moving the game back, which is exactly the
     * silently hidden game `CLAUDE.md`'s invariant rules out.
     *
     * The last tab is the window, and goes through `win.close()` so the
     * window's own confirm — which already says the player will be logged out —
     * is the only one asked; a second sheet about the same disconnect would be
     * one too many.
     */
    async function closeTab(tabId: string): Promise<void> {
        const closing = host.closing(tabId);
        if (closing === 'missing') return;
        if (closing === 'window') {
            win.close();
            return;
        }
        if (closing === 'game') {
            if (!(await deps.confirmCloseGame('tab'))) return;
            if (win.isDestroyed()) return;
            // The sheet is window-modal but the menu's accelerators are not, so
            // the game may have moved, or the tab gone, while it was up. Ask
            // again rather than acting on what the tabs said before it opened.
            const now = host.closing(tabId);
            if (now === 'missing') return;
            if (now === 'game') destroyGame('tab');
        }
        if (!host.closeTab(tabId)) win.close();
        syncPanelProbe();
    }

    /** Destroys the game view — never hides it — for a close the user has confirmed. */
    function destroyGame(via: 'pane' | 'tab' | 'setup'): void {
        if (gameView) {
            win.contentView.removeChildView(gameView);
            if (!gameView.webContents.isDestroyed()) gameView.webContents.close();
            gameView = null;
            gameTrouble = null;
            clocks.gameGone();
        }
        deps.log(`${tag} closed the game ${via === 'setup' ? 'to open a setup' : via} and disconnected`);
    }

    function setGameTrouble(trouble: PaneTrouble | null): void {
        gameTrouble = trouble;
        applyLayout();
    }

    /**
     * A button on a pane's notice. Close is the pane's own close, which asks
     * first for a game that may still be connected. A page's reload and wait
     * are the host's, which owns page views; the game's are here.
     *
     * A reload of the game is a load like any other — Home server's through the
     * service's state, so a world that is not ready shows its starting page —
     * and a hung renderer is killed first, which Electron documents as the way
     * to reload one.
     */
    function paneNotice(paneId: string, action: 'reload' | 'wait' | 'close'): void {
        if (action === 'close') {
            void closePane(paneId);
            return;
        }
        const content = contentOf(host.tree(), paneId);
        if (content?.kind === 'page') {
            host.pageNotice(paneId, action);
            return;
        }
        if (content?.kind !== 'game' || !gameView || !gameTrouble || gameView.webContents.isDestroyed()) return;
        if (action === 'wait') {
            if (gameTrouble.kind === 'unresponsive') setGameTrouble(null);
            return;
        }
        if (gameTrouble.kind === 'unresponsive') {
            expectGameGoneUntil = Date.now() + 5_000;
            gameView.webContents.forcefullyCrashRenderer();
        }
        deps.log(`${tag} reloading the game after it stopped`);
        // The load below ends the trouble, as any load into the view does.
        if (single) {
            // Forgotten, both, so the page the world is on is loaded again
            // rather than recognised as already showing.
            loadedGameUrl = null;
            shownStarting = null;
            syncHomeServer();
        } else {
            void loadGame(expected);
        }
    }

    /**
     * A load into the game view ends whatever it was in trouble with: a
     * reload from the notice, and equally a world picked in Worlds or Your
     * world's page changing, either of which would otherwise load into a view
     * still hidden under "The game stopped".
     */
    function troubleEnds(): void {
        if (!gameTrouble) return;
        gameTrouble = null;
        applyLayout();
    }

    // ── setups ───────────────────────────────────────────────────────────

    /**
     * The menu a right-click on a tab raises, which is Close Tab.
     *
     * Setups are not on it: they live in the tab bar's Setups menu, because a
     * setup is opened into whichever tab is in front. The tab is brought to
     * the front first, for the reason a right-clicked pane is focused first:
     * what the menu acts on should be what is on screen.
     */
    function showTabMenu(tabId: string, x: number, y: number): void {
        if (win.isDestroyed() || !host.treeOf(tabId)) return;
        host.selectTab(tabId);
        const template: MenuItemConstructorOptions[] = [{ label: 'Close Tab', click: () => void closeTab(tabId) }];
        Menu.buildFromTemplate(template).popup({ window: win, x: Math.round(x), y: Math.round(y) });
    }

    /** The tab in front: what the Setups menu opens into and saves. */
    function activeTabId(): string {
        return host.tabs().find(tab => tab.active)!.id;
    }

    /**
     * The menu under the tab bar's Setups: the built-in shapes this window can
     * offer (`setups.builtInSetups`), the setups saved for this server, and
     * saving the tab in front as one. A setup chosen from it replaces the
     * panes of the tab in front, which is the tab the menu was opened over.
     * Except Open New Windows With, which changes nothing on screen: it is
     * what this server's next windows open with.
     *
     * Native and built here for the reason Add pane's is: it drops down over
     * the panes, and a list the shell drew would open behind a game or a page
     * view.
     *
     * Nothing is saved unless the player asks. The window used to write its
     * arrangement after every split and seam drag, and that made the last
     * accident the thing a new window opened with.
     */
    function showSetupsMenu(x: number, y: number): void {
        if (win.isDestroyed()) return;
        const tabId = activeTabId();
        const saved = savedSetups();
        const template: MenuItemConstructorOptions[] = [
            ...builtInSetups({ tools, gameHeight: content.game }).map(setup => ({
                label: setup.name,
                click: () => void openSetup(tabId, setup.tree, setup.size, setup.name)
            })),
            { type: 'separator' },
            ...(saved.length === 0
                ? [{ label: 'No Saved Setups', enabled: false }]
                : saved.map(entry => ({ label: entry.name, click: () => void openSetupChosen(tabId, join(deps.setupsDir, entry.file)) }))),
            { type: 'separator' },
            { label: 'Save This Tab as a Setup…', click: () => void saveSetupAs(tabId) },
            // A setup somebody sent is dropped into this folder, and is then
            // listed above like any other.
            { label: 'Open Setups Folder', click: () => void openSetupsFolder() },
            { type: 'separator' },
            { label: 'Open New Windows With', submenu: newWindowsItems() }
        ];
        Menu.buildFromTemplate(template).popup({ window: win, x: Math.round(x), y: Math.round(y) });
    }

    /**
     * Open New Windows With: the built-ins, then the saved setups, with the
     * one the next window of this server would open with ticked. The tick is
     * `openingSetup`'s answer, the one a window opening now would act on, so a
     * choice that can no longer be used ticks Game and Chat, which is what
     * would open instead. A saved setup that cannot be a new window's — no
     * game in it, or not a setup — is greyed. Checkboxes rather than radios,
     * for the reason the View menu's Server Theme gives: the separator makes
     * two radio groups, and Electron ticks the first of a group with none.
     */
    function newWindowsItems(): MenuItemConstructorOptions[] {
        const builtIns = builtInSetups({ tools, gameHeight: content.game });
        const saved = savedSetups();
        const texts = new Map(saved.map(entry => [entry.file, readSaved(entry.file)]));
        const ticked = openingSetup(deps.newWindowSetup(), { builtIns, saved, read: file => texts.get(file) ?? null }).used;
        const item = (label: string, choice: NewWindowSetup, enabled: boolean): MenuItemConstructorOptions => ({
            label,
            type: 'checkbox',
            checked: sameSetup(ticked, choice),
            enabled,
            click: () => deps.setNewWindowSetup(choice)
        });
        return [
            ...builtIns.map(setup => item(setup.name, { builtIn: setup.id }, true)),
            ...(saved.length === 0 ? [] : [{ type: 'separator' as const }, ...saved.map(entry => item(entry.name, { file: entry.file }, opensWindow(texts.get(entry.file) ?? '')))])
        ];
    }

    /** The folder's setups, or none when there is no folder yet. */
    function savedSetups(): { name: string; file: string }[] {
        try {
            return layoutEntries(readdirSync(deps.setupsDir));
        } catch {
            return [];
        }
    }

    /** A setup file's text, sized before it is read: a setup is a few kilobytes, and anything dropped into the folder is listed. Throws when it cannot be read. */
    function readSetupText(path: string): string {
        if (statSync(path).size > SETUP_FILE_MAX) throw new Error('far larger than any setup');
        return readFileSync(path, 'utf8');
    }

    /** One of the folder's entries as `setups.openingSetup` reads it: its text, or null, logged, when it cannot be read. */
    function readSaved(file: string): string | null {
        try {
            return readSetupText(join(deps.setupsDir, file));
        } catch (err) {
            deps.log(`${tag} could not read ${file}: ${(err as Error).message}`);
            return null;
        }
    }

    async function saveSetupAs(tabId: string): Promise<void> {
        const label = host.tabs().find(tab => tab.id === tabId)?.label;
        if (label === undefined) return;
        // Refused before the dialog, not after: a file of more panes than a
        // setup holds is one no kit would open (`layoutFile.SETUP_PANES_MAX`).
        const tree = host.treeOf(tabId);
        const panes = tree ? paneIds(tree).length : 0;
        if (panes > SETUP_PANES_MAX) {
            await dialog.showMessageBox(win, {
                type: 'info',
                message: `A setup holds up to ${SETUP_PANES_MAX} panes, and this tab has ${panes}.`,
                detail: 'Close a few of its panes, then save it again.'
            });
            return;
        }
        try {
            mkdirSync(deps.setupsDir, { recursive: true });
            const { canceled, filePath } = await dialog.showSaveDialog(win, {
                title: 'Save Setup',
                defaultPath: join(deps.setupsDir, layoutFileName(label)),
                filters: [{ name: 'Zanaris Kit setup', extensions: ['json'] }]
            });
            if (canceled || !filePath || win.isDestroyed()) return;
            saveSetupTo(tabId, filePath);
        } catch (err) {
            deps.log(`${tag} could not save a setup: ${(err as Error).message}`);
            if (!win.isDestroyed()) await dialog.showMessageBox(win, { type: 'warning', message: 'The setup could not be saved.', detail: (err as Error).message });
        }
    }

    /**
     * Writes a tab's panes, with the size of tab they are drawn at, so the
     * setup opens with every pane at these pixels again. Reads the tab when the
     * file is written rather than when the menu opened: the dialog was up in
     * between.
     *
     * Only the tab in front. Its tree is the one laid out at the window's tab
     * size now; a tab behind it was last fitted at whatever size the window
     * had when it was in front, so its tree and this size need not agree, and
     * a file pairing them would open at pixels it was never drawn at. The
     * dialog is a sheet, but a tab can still be switched by its shortcut
     * while it is up, so this is refused rather than assumed.
     */
    function saveSetupTo(tabId: string, path: string): void {
        const tree = host.treeOf(tabId);
        if (!tree) throw new Error('that tab has closed');
        if (tabId !== activeTabId()) throw new Error('that tab is no longer the one in front, so its size is not known; bring it to the front and save it again');
        writeFileSync(path, writeLayout(tree, server.id, { width: rects.tree.width, height: rects.tree.height }));
        deps.log(`${tag} saved setup ${basename(path)}`);
    }

    /** Opening from the menu: the same open, and a sheet rather than silence when the file was not a setup. */
    async function openSetupChosen(tabId: string, path: string): Promise<void> {
        if ((await openSetupFrom(tabId, path)) !== 'unreadable' || win.isDestroyed()) return;
        await dialog.showMessageBox(win, {
            type: 'warning',
            message: "That file isn't a Zanaris Kit setup.",
            detail: `${basename(path)} could not be read as a setup, so the tab was left as it was.`
        });
    }

    /** A setup file, into a tab. `unreadable` is a file that could not be read or is not a setup, and leaves the tab as it was. */
    async function openSetupFrom(tabId: string, path: string): Promise<'opened' | 'unreadable' | 'cancelled' | 'missing'> {
        let text: string;
        try {
            text = readSetupText(path);
        } catch (err) {
            deps.log(`${tag} could not read ${path}: ${(err as Error).message}`);
            return 'unreadable';
        }
        const read = readSetup(text);
        if (!read) {
            deps.log(`${tag} refused ${basename(path)}: not a Zanaris Kit setup`);
            return 'unreadable';
        }
        return openSetup(tabId, read.tree, read.size, basename(path));
    }

    /** One of the built-ins, into the tab in front, as its menu item does. `missing` when this window does not offer it. */
    function openBuiltInSetup(id: BuiltInSetupId): Promise<'opened' | 'cancelled' | 'missing'> {
        const setup = builtInSetups({ tools, gameHeight: content.game }).find(s => s.id === id);
        return setup ? openSetup(activeTabId(), setup.tree, setup.size, setup.name) : Promise.resolve('missing');
    }

    /**
     * A setup, into a tab: a built-in or a file's, replacing the tab's panes
     * and sizing the window around the game.
     *
     * What it costs is `tabs.loadingLayout`'s answer, which is pure and
     * tested; this asks the question it raises and acts. When the setup would
     * take the game's leaf away, that is closing the game, so it asks first
     * and destroys the view — the layout invariant in `CLAUDE.md`, and the
     * same order `closeTab` keeps, including asking the tabs again once the
     * sheet is down, since the game may have moved while it was up. When the
     * setup wants a game and the window has none left, one is made and
     * loaded, as choosing the game in an empty pane does.
     *
     * The game keeps the pixels it has now and every other pane gets the ones
     * the setup was saved with (`paneTree.arrangeForGame`): the window grows or
     * shrinks to hold them (`sizeWindow`). A setup with no game, or a file
     * saved with no size, is fitted to the tab as it is and leaves the window
     * alone.
     */
    async function openSetup(tabId: string, stored: StoredNode, saved: Size | null, name: string): Promise<'opened' | 'cancelled' | 'missing'> {
        const want = gameView ? host.gameSize() : null;
        const tree = host.instantiate(stored);
        const loading = host.loading(tabId, tree);
        if (!loading) return 'missing';
        if (loading.dropsGame) {
            if (!(await deps.confirmCloseGame('setup'))) return 'cancelled';
            if (win.isDestroyed()) return 'missing';
            const now = host.loading(tabId, tree);
            if (!now) return 'missing';
            if (now.dropsGame) destroyGame('setup');
        }
        if (holdsGame(tree) && !gameView) {
            gameView = makeGameView();
            void loadGame(expected);
        }
        const arranged = arrangeForGame(tree, saved, want);
        if (!host.replaceTab(tabId, arranged.tree, arranged.size)) return 'missing';
        if (arranged.size) sizeWindow(arranged.size);
        syncPanelProbe();
        deps.log(`${tag} opened setup ${name}${arranged.size ? ` at ${arranged.size.width}x${arranged.size.height}` : ''}`);
        return 'opened';
    }

    /**
     * The window sized so its tab is `size`: grown as far as its display
     * allows and moved back onto it, or shrunk from the right and the bottom
     * (`windowRoom.sizedBy` works out how far, and `windowRoom.grownFrame`
     * takes both). Not while it is maximised or full screen, where a resize
     * would only take it out of that; the tab's fit holds the game instead.
     * Its resize lays everything out again.
     */
    function sizeWindow(size: Size): void {
        if (win.isDestroyed() || win.isFullScreen() || win.isMaximized()) return;
        const frame = win.getBounds();
        const workArea = screen.getDisplayMatching(frame).workArea;
        const by = sizedBy({ width: rects.tree.width, height: rects.tree.height }, size, roomFor(frame, workArea));
        if (by.width === 0 && by.height === 0) return;
        win.setBounds(grownFrame(frame, workArea, by));
    }

    async function openSetupsFolder(): Promise<void> {
        try {
            mkdirSync(deps.setupsDir, { recursive: true });
        } catch (err) {
            deps.log(`${tag} could not make ${deps.setupsDir}: ${(err as Error).message}`);
            return;
        }
        const failed = await shell.openPath(deps.setupsDir);
        if (failed) deps.log(`${tag} could not open ${deps.setupsDir}: ${failed}`);
    }

    // ── the game view ────────────────────────────────────────────────────

    /**
     * The one way the game view changes page. Each load gets its own promise,
     * and settles the one before it: a waiter left pending by a load this one
     * supersedes — the starting page, then the game — is settled by this
     * load's result rather than left hanging.
     */
    function loadGame(url: string): Promise<LoadResult> {
        troubleEnds();
        expected = url;
        failedOver = false;
        gameLoadPending = true;
        const previous = loadWaiter;
        loadPromise = new Promise<LoadResult>(resolve => {
            loadWaiter = result => {
                resolve(result);
                previous?.(result);
            };
        });
        refreshLabels();
        pushState();
        void gameView?.webContents.loadURL(url);
        return loadPromise;
    }

    /**
     * The starting page in the state the service is in. Only a window
     * running your home server shows it. `pagefailed` is the page's own state, not the world's:
     * the world is up and its page is what would not load.
     */
    function showStarting(override?: { state: HomeServerView['status'] | 'pagefailed'; reason: string }): void {
        if (!single || win.isDestroyed()) return;
        const view = single.view();
        const line = view.builds.find(l => l.id === view.selected);
        const version = view.version ? `engine ${view.version.engine.slice(0, 8)} · content ${view.version.content.slice(0, 8)} · rev ${view.version.revision}` : '';
        const query = {
            state: override?.state ?? view.status,
            version,
            reason: override?.reason ?? view.reason ?? '',
            log: view.logTail.slice(-20).join('\n'),
            // What a missing world would download, and how far it has got, in tens
            // of percent: finer, and a 50 MB download would reload this page a
            // hundred times.
            build: line ? lineTitle(line) : '',
            size: line?.size != null ? String(Math.round(line.size / 1_000_000)) : '',
            available: line && line.size !== null && line.state !== 'unavailable' ? '1' : '',
            progress: line?.progress != null ? String(Math.floor(line.progress * 10) * 10) : ''
        };
        // Every change to the service lands here while the world is not ready,
        // the store's progress included. The same page already showing is left alone.
        const key = JSON.stringify(query);
        if (key === shownStarting && gameView?.webContents.getURL().includes('starting.html')) return;
        shownStarting = key;
        // This page supersedes a game load still in flight — the world died between
        // becoming ready and the page finishing. Chromium reports the superseded load
        // as ERR_ABORTED, which did-fail-load ignores, and this page's own
        // did-finish-load settles nothing, so the waiter would wait forever.
        if (gameLoadPending) settleLoad('failed');
        failedOver = true;
        troubleEnds();
        void gameView?.webContents.loadFile(STARTING_PAGE, { query });
    }
    /** The query of the starting page last loaded, so an identical one is not loaded again. */
    let shownStarting: string | null = null;

    /** The world changed state: load the game when it is ready, show the page otherwise. */
    let loadedGameUrl: string | null = null;
    function syncHomeServer(): void {
        if (!single) return;
        const view = single.view();
        refreshLabels();
        pushState();
        if (view.status === 'ready' && view.url) {
            if (loadedGameUrl !== view.url) {
                loadedGameUrl = view.url;
                void loadGame(view.url);
            }
            return;
        }
        loadedGameUrl = null;
        showStarting();
    }

    function settleLoad(result: LoadResult): void {
        const waiter = loadWaiter;
        loadWaiter = null;
        gameLoadPending = false;
        waiter?.(result);
    }

    /**
     * The game view's own handlers, wired to the view they belong to rather
     * than to whichever one happened to exist at construction.
     *
     * This is a function because the game view is no longer permanent: closing
     * its pane destroys it, and opening one builds another. Registering these
     * once against the outer binding would leave a rebuilt view with no
     * navigation guard at all — which is the one view in the app that must
     * never accept a page-initiated navigation.
     */
    function wireGameView(view: WebContentsView): void {
        const wc = view.webContents;
        /** When the player last pressed anything in this view, which is what lets it open the browser. */
        let lastPress = -Infinity;
        // Crashes and hangs, which hide the view under its pane's notice
        // until the player chooses what to do (`paneNotice`). Only this view's,
        // and only while it is still the window's game.
        wc.on('render-process-gone', (_event, details) => {
            if (details.reason === 'clean-exit' || view !== gameView) return;
            if (Date.now() < expectGameGoneUntil) {
                expectGameGoneUntil = 0;
                return;
            }
            deps.log(`${tag} the game stopped: ${details.reason}`);
            if (gameLoadPending) settleLoad('failed');
            // The login went with the renderer, and its idle timer with it.
            clocks.gameGone();
            setGameTrouble({ kind: 'crashed', reason: details.reason });
        });
        wc.on('unresponsive', () => {
            if (view !== gameView || gameTrouble) return;
            deps.log(`${tag} the game stopped responding`);
            setGameTrouble({ kind: 'unresponsive' });
        });
        wc.on('responsive', () => {
            if (view === gameView && gameTrouble?.kind === 'unresponsive') setGameTrouble(null);
        });
        // The game's partition has no handler until this one, and a session
        // with none grants every permission unasked (`guard.allowPermission`).
        // Set again for each game view, which replaces rather than adds: the
        // partition is this window's slot, and outlives any one view.
        wc.session.setPermissionRequestHandler((_contents, permission, callback) => {
            const allowed = allowPermission(permission, 'game');
            if (!allowed) deps.log(`${tag} refused the game's request for ${permission}`);
            callback(allowed);
        });
        wc.session.setPermissionCheckHandler((_contents, permission) => allowPermission(permission, 'game'));
        // Nothing the page does may replace the game. The one exception is our
        // own offline page returning to the page main asked for.
        wc.on('will-navigate', (event, url) => {
            const decision = decideNavigation({ current: wc.getURL(), target: url, expected });
            if (decision === 'allow') return;
            event.preventDefault();
            if (decision === 'download') {
                deps.log(`${tag} downloading the world's build`);
                void single?.download();
                return;
            }
            if (decision === 'retry') {
                deps.log(`${tag} retrying the world`);
                // Forgetting the url is what lets the same one be loaded again: when the
                // world is already up and only its page failed, retry() resolves off the
                // ready status without changing it, so nothing notifies and syncHomeServer
                // would otherwise see the url it has already loaded and do nothing.
                loadedGameUrl = null;
                void single?.retry().then(
                    () => syncHomeServer(),
                    () => syncHomeServer()
                );
                return;
            }
            if (decision === 'open-external' && mayOpenBrowser({ via: 'navigate', mainFrame: true, sincePress: Date.now() - lastPress })) {
                lastPress = -Infinity;
                deps.log(`${tag} sent ${url} to the system browser`);
                void shell.openExternal(url);
            } else {
                deps.log(`${tag} blocked navigation to ${url}${decision === 'open-external' ? ', which no press asked for' : ''}`);
            }
        });
        // A new window is a web link for the system browser, and only when the
        // player has just pressed something (`guard.mayOpenBrowser`).
        wc.setWindowOpenHandler(({ url }) => {
            if (/^https?:\/\//.test(url) && mayOpenBrowser({ via: 'window-open', mainFrame: true, sincePress: Date.now() - lastPress })) {
                lastPress = -Infinity;
                void shell.openExternal(url);
            } else {
                deps.log(`${tag} refused a new window for ${url}`);
            }
            return { action: 'deny' };
        });
        // The game's own menu is refused — nothing Chromium offers on a canvas
        // is any use, and Inspect Element on a game page is not something to
        // hand a player by accident — and the pane menu takes its place. The
        // view's coordinates go back into the window's, which is where popup
        // wants them.
        wc.on('context-menu', (event, params) => {
            event.preventDefault();
            const tree = host.tree();
            const gamePane = paneIds(tree).find(id => contentOf(tree, id)?.kind === 'game');
            const rect = gamePane ? host.rectOf(gamePane) : null;
            // The view starts below the pane's header, so that inset is part of
            // putting the view's coordinates back into the window's.
            if (gamePane && rect) showPaneMenu(gamePane, rect.x + params.x, rect.y + Math.min(PANE_HEADER_HEIGHT, rect.height) + params.y);
        });
        wc.on('did-start-navigation', (_event, url) => {
            // A retry from the offline page is a fresh attempt.
            if (!url.startsWith('file:')) failedOver = false;
        });
        // A mouse down or key down anywhere in the game view restarts the AFK
        // clocks; `isGameInput` decides which input counts. That is not the
        // client's idle timer exactly: the client also counts mouse movement,
        // so these can warn early, and counts only input on its canvas, so a
        // click beside the canvas restarts these while the client's timer runs
        // on, and they can warn late.
        wc.on('input-event', (_event, input) => {
            if (isPress(input.type)) lastPress = Date.now();
            if (isGameInput(input.type, wc.getURL())) clocks.input();
        });
        // `input-event` sees only the page's own frame. These two are asked
        // of the whole page before it is handed anything, so a press in one
        // of its frames counts too, as far as Electron reports one.
        wc.on('before-mouse-event', (_event, mouse) => {
            if (isPress(mouse.type)) lastPress = Date.now();
        });
        wc.on('before-input-event', (_event, input) => {
            if (isPress(input.type)) lastPress = Date.now();
        });
        // A page that actually loads in the game view — a world switch, a
        // detail switch, a retry, the kit's offline or starting page — ends
        // that login's idle timer. `did-navigate` fires only once a main-frame
        // navigation commits, so one the guard above cancels — a link the
        // player clicked, sent to the system browser instead — never reaches
        // this at all: it loaded nothing, so it resets nothing, and the
        // player's AFK clocks keep running while they are still logged in. An
        // in-page navigation (a hash change, pushState) is a different event
        // and does not fire this one either.
        wc.on('did-navigate', () => clocks.gameGone());
        wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
            // -3 is ERR_ABORTED: a load superseded by another, not a failure.
            if (!isMainFrame || code === -3) return;
            failedOver = true;
            deps.log(`${tag} could not load ${url}: ${description} (${code})`);
            settleLoad('failed');
            if (single) {
                // The service's own view says why the world is not there. When it says
                // the world is running, the page itself is what failed, and the starting
                // page has to say so rather than claim the world is up.
                const running = single.view().status === 'ready';
                showStarting(running ? { state: 'pagefailed', reason: 'The game page did not load, though the world is running.' } : undefined);
                return;
            }
            void wc.loadFile(OFFLINE_PAGE, {
                query: { url: expected, name: gameLabel(), reason: description }
            });
        });
        // `insertCSS` is per-document, so it must be re-applied on every navigation. `dom-ready`
        // (Chromium's DOMContentLoaded) is the earliest hook Electron exposes for that;
        // `did-finish-load` (below, used for the load waiter) waits for the 'load' event — every
        // subresource — and is much later. dom-ready is *not* guaranteed ahead of first paint here:
        // the client's own game code is a deferred `type="module"` script, which delays
        // DOMContentLoaded until it has fetched and run, while Chromium can paint the
        // already-parsed, already-styled page before that finishes. So a brief flash is possible —
        // but only at sizes where the page actually overflows its view (the bare-canvas floor, or
        // the dock pushing content below it; the default size never overflows) — and it is still
        // strictly earlier than did-finish-load. World hopping and detail switching both funnel
        // through `loadGame`'s `loadURL` on this same view, so they re-fire `dom-ready` and
        // re-inject too — nothing server-specific is needed here.
        wc.on('dom-ready', () => {
            // The kit's own offline and starting pages are already sized to fit; this is for the client.
            if (wc.getURL().startsWith('file:')) return;
            void wc.insertCSS(GAME_PAGE_CSS);
        });
        wc.on('did-finish-load', () => {
            const url = wc.getURL();
            if (url.startsWith('file:')) {
                deps.log(`${tag} showing a kit page`);
                return;
            }
            // Chromium commits its own error page under the failed URL before the offline page replaces it.
            if (failedOver) return;
            deps.log(`${tag} loaded ${url}`);
            // Every load adds a history entry; none of them is somewhere to go back to.
            wc.navigationHistory.clear();
            settleLoad('loaded');
            void probeCurrent();
        });
    }

    // ── the current world's latency ──────────────────────────────────────

    let currentProbe: NodeJS.Timeout | null = null;
    let probingCurrent = false;

    async function probeCurrent(): Promise<void> {
        if (!worldSwitch || probingCurrent || win.isDestroyed()) return;
        probingCurrent = true;
        try {
            const { host, port } = worldEndpoint(expected);
            currentLatency = await deps.probe(host, port, PROBE_TIMEOUT_MS);
        } catch {
            currentLatency = null;
        } finally {
            probingCurrent = false;
        }
        if (win.isDestroyed()) return;
        refreshLabels();
        pushState();
    }

    // Only while there is a game to read it beside: with the game's pane
    // closed nothing shows the figure, so nothing measures it. The game's
    // load measures it at once when it comes back.
    if (worldSwitch) currentProbe = setInterval(() => {
        if (gameView) void probeCurrent();
    }, PROBE_EVERY_MS);
    const unsubscribeWorlds = deps.worlds?.subscribe(() => pushState()) ?? null;

    // ── lifecycle ────────────────────────────────────────────────────────

    // The page keeps its own title; the window keeps the server's name and world.
    win.on('page-title-updated', event => event.preventDefault());
    // Mouse back and forward buttons would walk the history of world switches.
    // Once per window, not per game view: a game closed and chosen again is
    // a new view, and each used to add another of these.
    win.on('app-command', (event, command) => {
        if (command === 'browser-backward' || command === 'browser-forward') event.preventDefault();
    });
    win.on('close', event => {
        if (!deps.confirmClose(spec.title)) {
            event.preventDefault();
            return;
        }
        // Here rather than in 'closed', where the window can no longer say
        // where it is; and only once the close is going through, so a
        // Cancel records nothing. A quit closes every window this way. The
        // normal bounds, so a window closed maximised, full screen or
        // minimised records where it goes back to when it is none of those.
        deps.rememberPlace(placeOf(win.getNormalBounds(), win.isMaximized(), win.isFullScreen()));
    });
    win.on('closed', () => {
        clocks.dispose();
        if (currentProbe) clearInterval(currentProbe);
        if (panelProbe) clearInterval(panelProbe);
        // A view does not go with its window: Electron leaves a closed
        // window's views running, and a game left running is a character
        // still standing in the world after the confirm said it would be
        // logged out. So every view is closed here — the game, the shell and,
        // in `host.destroy`, the pages. The `persist:pages` session is not,
        // so a LostHQ login outlives both this window and this launch.
        if (gameView && !gameView.webContents.isDestroyed()) gameView.webContents.close();
        gameView = null;
        if (!shellView.webContents.isDestroyed()) shellView.webContents.close();
        host.destroy();
        unsubscribeWorlds?.();
        unsubscribeSingle?.();
        single?.release();
        shared?.release();
        onClosed();
    });

    shellView.webContents.once('did-finish-load', () => {
        if (win.isDestroyed()) return;
        applyLayout();
        // A capture's window is never shown, so never maximised or made full
        // screen here either: maximising shows a hidden window.
        if (deps.headless) return;
        // Maximised before it is shown, so it never draws at its normal size
        // first, and unmaximising it puts it at its place. `show` still gives
        // it focus. Full screen is asked for once the window is on screen.
        if (opened.maximized) win.maximize();
        win.show();
        if (opened.fullScreen) win.setFullScreen(true);
    });

    applyLayout();
    refreshLabels();
    loadShell(shellView.webContents);

    let unsubscribeSingle: (() => void) | null = null;
    shared?.acquire();
    if (single) {
        // The load promise stays pending until the game itself loads, or the world fails.
        loadPromise = new Promise<LoadResult>(resolve => {
            loadWaiter = resolve;
        });
        unsubscribeSingle = single.subscribe(syncHomeServer);
        showStarting();
        void single.acquire().then(
            () => syncHomeServer(),
            () => {
                syncHomeServer();
                settleLoad('failed');
            }
        );
    } else {
        void loadGame(expected);
    }

    return {
        id: spec.id,
        window: win,
        shellContentsId: shellView.webContents.id,
        focus: () => {
            if (win.isMinimized()) win.restore();
            win.focus();
        },
        close: () => win.close(),
        addPane,
        showHomeServer,
        showChat,
        showChatPage,
        showAddPaneMenu,
        // Asked of the window rather than answered from a flag kept alongside
        // it. The window is where the state actually lives, so a copy here
        // would be a second one to keep in step, and the menu is built from
        // whichever window has focus — a place where the copy that went stale
        // would be checked against a different window entirely. It also answers
        // honestly for a window on its way out, where a remembered `true` would
        // tick the box for something already gone. (macOS keeps the level
        // across fullscreen, checked rather than assumed, so there is no
        // platform surprise for this to be guarding against — only the two
        // reasons above.)
        alwaysOnTop: () => !win.isDestroyed() && win.isAlwaysOnTop(),
        setAlwaysOnTop: on => {
            if (win.isDestroyed()) return;
            win.setAlwaysOnTop(on);
            deps.log(`${tag} ${on ? 'pinned above other windows' : 'unpinned'}`);
        },
        startTimer: id => clocks.start(id),
        pauseTimer: id => clocks.pause(id),
        resetTimer: id => clocks.reset(id),
        timersChanged: () => {
            const next = deps.timers();
            customsFull = next.customsFull;
            clocks.setDefs(next.listed);
        },
        settleTimers: () => clocks.settle(),
        splitPane: split,
        resetGameSize,
        closePane,
        setPaneContent,
        focusPane: paneId => host.focus(paneId),
        beginPaneDrag: from => host.beginDrag(from),
        dropPane: (from, to, zone) => host.drop(from, to, zone),
        endPaneDrag: () => host.endDrag(),
        showPaneMenu,
        showPaneContentMenu,
        setSeam: (splitId, index, px) => host.dragSeam(splitId, index, px),
        evenOut: splitId => host.evenOut(splitId),
        evenOutFocused: () => {
            const splitId = parentSplitOf(host.tree(), host.focusedPaneId());
            if (splitId) host.evenOut(splitId);
        },
        pageGo: where => host.go(where),
        paneNotice,
        newTab: () => host.newTab(),
        closeTab,
        selectTab: tabId => host.selectTab(tabId),
        showTabMenu,
        showSetupsMenu,
        openBuiltInSetup,
        saveSetupTo,
        openSetupFrom,
        relayout: applyLayout,
        state,
        pushState,
        themeChanged,
        whenGameLoaded: () => loadPromise,
        switchWorld: async world => {
            if (!worldSwitch || !deps.worlds) return 'unknown';
            const target = deps.worlds.view().worlds.find(w => w.id === world);
            if (!target) return 'unknown';
            let url: string;
            try {
                url = worldSwitch.select(target);
            } catch (err) {
                deps.log(`${tag} cannot address world ${world}: ${(err as Error).message}`);
                return 'unknown';
            }
            currentLatency = null;
            deps.remember(worldSwitch.remembered());
            deps.log(`${tag} switching to world ${world} (${worldSwitch.detail}) — ${url}`);
            return loadGame(url);
        },
        setDetail: async detail => {
            if (!worldSwitch) return 'unchanged';
            const url = worldSwitch.setDetail(detail);
            if (!url) return 'unchanged';
            deps.remember(worldSwitch.remembered());
            deps.log(`${tag} reloading world ${worldSwitch.world} at ${detail} detail`);
            return loadGame(url);
        },
        refreshWorlds: async () => {
            if (!deps.worlds || !worldSwitch) return;
            await deps.worlds.list(true);
            await deps.worlds.probeAll(worldSwitch.detail);
        },
        settle: () => paintsFrames(shellView.webContents),
        captureShell: () => shellView.webContents.capturePage(),
        captureGame: () => gameView?.webContents.capturePage() ?? Promise.reject(new Error('no game view')),
        crashForCapture: what => {
            const view = what === 'game' ? gameView : what === 'shell' ? shellView : host.pageWebContents();
            if (view && !view.webContents.isDestroyed()) view.webContents.forcefullyCrashRenderer();
        },
        capturePage: async () => {
            const view = host.pageWebContents();
            if (!view || view.webContents.isDestroyed()) return null;
            // Two frames, exactly as `settle` does for the shell, and for a
            // reason this feature demonstrated: a view that has just been shown
            // has not composited since, so capturePage hands back the frame it
            // was hidden on. That photographed a forum that had long since
            // finished booting as a page still showing its loading spinner —
            // a stale frame reported as a broken feature, which is the whole
            // hazard the shell's own settle exists for. A page that paints
            // nothing is refused rather than shot, for the same reason.
            if (!(await paintsFrames(view.webContents))) throw new Error('the page is not painting');
            return view.webContents.capturePage();
        }
    };
}
