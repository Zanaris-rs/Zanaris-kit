import { BrowserWindow, Menu, WebContentsView, screen, shell, type NativeImage } from 'electron';
import { join } from 'node:path';
import { IPC, type ShellState, type ToolId } from '../shared/ipc';
import { GAME_PREFERRED_HEIGHT, GAME_PREFERRED_WIDTH, PANE_HEADER_HEIGHT, PANE_MIN_HEIGHT, PANE_MIN_WIDTH, RAIL_WIDTH, TAB_BAR_HEIGHT, TREE_INSET } from '../shared/layout';
import type { ChatView } from '../shared/chat';
import type { Detail, RememberedWorld, WorldsView } from '../shared/worlds';
import type { SinglePlayerView } from '../shared/singleplayer';
import type { PaneView, SeamView } from '../shared/panes';
import { decideNavigation } from './guard';
import { createPaneHost, type PaneHost } from './paneHost';
import { paneContentItems, paneMenuItems } from './paneMenu';
import { contentOf, paneIds, parentSplitOf, type PaneContent, type Rect } from './paneTree';
import type { TabSet } from './tabs';
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
 * The content area a new window opens with: a game pane at its preferred size,
 * plus the pixel of shell the tree is inset by on each side so the focus ring
 * has somewhere to land. Without the inset the window would open two pixels
 * short of the size the game pane asks for, and clip the bottom of the canvas
 * at the one size nobody chose.
 */
const DEFAULT_CONTENT = { width: GAME_PREFERRED_WIDTH + TREE_INSET * 2, height: GAME_PREFERRED_HEIGHT + TREE_INSET * 2 };
const PROBE_EVERY_MS = 10_000;
const PROBE_TIMEOUT_MS = 3_000;

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

/** What a single-player window needs of the service; the service itself satisfies it. */
export interface SinglePlayerHandle {
    view(): SinglePlayerView;
    subscribe(fn: () => void): () => void;
    acquire(): Promise<string>;
    release(): void;
    retry(): Promise<string>;
}

const STATUS_WORD: Record<SinglePlayerView['status'], string> = {
    stopped: 'stopped',
    preparing: 'getting ready',
    starting: 'starting',
    ready: 'running',
    stopping: 'stopping',
    failed: 'failed'
};

function statusWord(status: SinglePlayerView['status']): string {
    return STATUS_WORD[status];
}

export interface ServerWindowDeps {
    log: (msg: string) => void;
    /** Return false to keep the window open. Main returns true without asking while quitting. */
    confirmClose: (title: string) => boolean;
    position: { x: number; y: number } | null;
    /** The server's shared world list and latency, or null when the server has one page. */
    worlds: WorldsService | null;
    /** The server's shared hiscores lookup, or null when it offers none — which is what keeps the tool off a single-player window's rail. */
    hiscores: HiscoresService | null;
    /**
     * The one conversation, which is the app's rather than this window's: every
     * window shows the same one. A getter rather than the service itself, since
     * the window only ever reads it — main pushes when it changes.
     */
    chat: () => ChatView;
    /**
     * Whether a window opened now should float above other apps, as the last
     * choice anywhere left it.
     */
    alwaysOnTop: () => boolean;
    /**
     * Asks before the game is closed — its pane, or a tab holding it — since
     * either destroys the view and disconnects the player. False keeps it. Main
     * returns true without asking when the user has turned the warning off.
     */
    confirmCloseGame: (via: 'pane' | 'tab') => Promise<boolean>;
    /** The pane layout this server's windows were last left in, or null to open fresh on the game. */
    rememberedLayout: TabSet | null;
    /** Remembers an arrangement. Staged, not written: a seam drag lands one of these per animation frame. */
    rememberLayout: (set: TabSet) => void;
    /** What this server remembered from last time, if anything. */
    remembered: RememberedWorld | null;
    /** Called whenever this window's world or detail changes. */
    remember: (remembered: RememberedWorld) => void;
    /** Latency of one host, for the current world's readout. */
    probe: (host: string, port: number, timeoutMs: number) => Promise<number | null>;
    /** The world this computer runs, for a window of kind singleplayer; null otherwise. */
    singlePlayer: SinglePlayerHandle | null;
}

export interface ServerWindow extends ServerWindowHandle {
    readonly id: number;
    readonly window: BrowserWindow;
    /** The shell view's webContents id, so IPC handlers can find the window from `event.sender`. */
    readonly shellContentsId: number;
    /** The rail: puts a tool in the focused pane, splitting the game's rather than replacing it. */
    selectTool(id: ToolId): void;
    /** Whether this window floats above other apps. Read back from the window itself, not from a flag kept beside it. */
    alwaysOnTop(): boolean;
    setAlwaysOnTop(on: boolean): void;
    /** Splits a pane, putting an empty one showing the launcher in the new half. */
    splitPane(paneId: string, axis: 'x' | 'y'): void;
    /** Closes a pane. Asks first when it is the game's, since that disconnects the player. */
    closePane(paneId: string): Promise<void>;
    /** Puts something in a pane. A page must be one of this server's links; asking for the game moves it out of whatever pane held it. */
    setPaneContent(paneId: string, content: PaneContent): void;
    focusPane(paneId: string): void;
    /** Trades what two panes hold, for a header dragged onto another pane. */
    swapPanes(a: string, b: string): void;
    /** Hides every native view for the length of a drag, so the shell can draw over their rects. */
    setDragging(on: boolean): void;
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
    newTab(): void;
    /**
     * Closes a tab and everything in it. Asks first when the tab holds the
     * game, since that disconnects the player; closing the last one closes the
     * window, as it always has, behind the window's own confirm.
     */
    closeTab(tabId: string): Promise<void>;
    selectTab(tabId: string): void;
    /** Re-runs the layout and pushes the result. For app-wide changes that move things, where pushState alone would only repaint the old geometry. */
    relayout(): void;
    state(): ShellState;
    /** Sends the current state to the shell. For app-wide changes main hears about, not the window. */
    pushState(): void;
    /** Resolves when the most recent load finished, or failed over to the offline page. */
    whenGameLoaded(): Promise<LoadResult>;
    switchWorld(world: number): Promise<LoadResult | 'unknown'>;
    setDetail(detail: Detail): Promise<LoadResult | 'unchanged'>;
    refreshWorlds(): Promise<void>;
    /**
     * Resolves once the shell has actually painted what main last pushed.
     * capturePage hands back the last composited frame, so without this a
     * capture taken right after a state change photographs the previous one —
     * which had capture mode reporting a stale panel three times over.
     */
    settle(): Promise<void>;
    /** Page content of one view, for capture mode. A window's own webContents holds nothing. */
    captureShell(): Promise<NativeImage>;
    captureGame(): Promise<NativeImage>;
    /** The focused page pane, for capture mode. Resolves with null when no pane holds a page: there is no view to shoot. */
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
    const single = server.kind === 'singleplayer' ? deps.singlePlayer : null;
    /**
     * The rail this window offers. Chat is app-scoped, so every window offers
     * it, and first: it is there whether or not the server has worlds to hop
     * between. Everything after it is this window's server's, which is where
     * the rail draws its divider — worlds to hop between, hiscores to look a
     * player up on, the world this computer runs.
     *
     * Each of the three is offered because the window was *given* the thing
     * behind it, rather than because of what kind of server this is: no
     * hiscores def means no service, no service means no tool, and single
     * player is the case that matters — a one-player world has nothing to
     * rank, and its catalog entry carries no hiscores, so the tool never
     * reaches its rail without anything here naming it.
     *
     * The rail's order is declared in three places nothing links together:
     * this builder, which feeds `firstLegalSideOccupant` and so
     * `panelAvailable`; `TOOLS` in `renderer/Shell.tsx`, which decides what is
     * drawn; and `RAIL` in `chatDock.test.ts`, which stands in for this
     * builder. They agree today, and no test would notice if they stopped —
     * reorder one and the other two want the same edit. It matters in a way it
     * did not before hiscores: every remote window now offers two server tools
     * at once, so which of them comes first is a real question.
     */
    const tools: ToolId[] = ['chat'];
    if (worldSwitch) tools.push('worlds');
    if (deps.hiscores) tools.push('hiscores');
    if (single) tools.push('singleplayer');
    // Which tools a window came up with is otherwise only visible by looking at
    // the rail, and a tool missing from it looks the same as a tool that drew
    // nothing. One line at open says which of the two happened.
    deps.log(`${tag} rail: ${tools.join(' · ')}`);

    /** The URL main last asked the game view to load. The offline page may return to it; nothing else may navigate. */
    let expected = worldSwitch ? worldSwitch.url : server.url;
    let currentLatency: number | null = null;
    /** Where the window's own chrome sits. The panes' rects belong to the host. */
    let rects = { tabBar: { x: 0, y: 0, width: 0, height: 0 }, rail: { x: 0, y: 0, width: 0, height: 0 }, tree: { x: 0, y: 0, width: 0, height: 0 } };
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
    let failedOver = false;
    let loadWaiter: ((result: LoadResult) => void) | null = null;
    let loadPromise: Promise<LoadResult> = Promise.resolve('loaded');
    /** True between a loadGame and its result, so a kit page can tell it is superseding one. */
    let gameLoadPending = false;

    const win = new BrowserWindow({
        width: DEFAULT_CONTENT.width + RAIL_WIDTH,
        height: TAB_BAR_HEIGHT + DEFAULT_CONTENT.height,
        // One pane's floor plus the chrome that never gives way. A constant
        // now: the old minimum moved as the dock opened and closed, because it
        // was protecting a region the layout was also protecting. Nothing is
        // protected any more — every pane gives way together — so there is
        // nothing left for the floor to track.
        minWidth: PANE_MIN_WIDTH + RAIL_WIDTH,
        minHeight: TAB_BAR_HEIGHT + PANE_MIN_HEIGHT,
        useContentSize: true,
        ...(deps.position ?? {}),
        title: spec.title,
        backgroundColor: '#17120d',
        show: false,
        // The last choice made anywhere, so a window opened while the app is
        // pinned comes up pinned rather than needing the menu again.
        alwaysOnTop: deps.alwaysOnTop()
    });

    const shellView = new WebContentsView({
        webPreferences: {
            preload: preloadPath(),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true
        }
    });
    shellView.setBackgroundColor('#17120d');

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

    win.contentView.addChildView(shellView);
    gameView = makeGameView();

    /**
     * The active tab's panes and the views inside them. Every rule about the
     * tree is in `paneTree`, which is pure and tested; this end of it only
     * names the gesture and lets the window lay out around the answer.
     */
    const host: PaneHost = createPaneHost({
        window: win,
        gameView: () => gameView,
        bookmarks: () => server.bookmarks,
        tools: () => tools,
        hosts: () => server.hosts,
        log: line => deps.log(`${tag} ${line}`),
        remembered: deps.rememberedLayout,
        changed: () => applyLayout(),
        remember: set => deps.rememberLayout(set),
        contextMenu: (paneId, x, y) => showPaneMenu(paneId, x, y),
        touched: () => pushState()
    });

    // ── labels ───────────────────────────────────────────────────────────

    function gameLabel(): string {
        if (single) return `${server.name} · rev ${server.revision ?? '?'} · ${statusWord(single.view().status)}`;
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

    /** Which tools are placed in a pane somewhere, so the rail can light them rather than guess. */
    function openTools(): ToolId[] {
        const tree = host.tree();
        const placed = paneIds(tree)
            .map(id => contentOf(tree, id))
            .filter(content => content?.kind === 'tool')
            .map(content => (content as { kind: 'tool'; tool: ToolId }).tool);
        return tools.filter(id => placed.includes(id));
    }

    function state(): ShellState {
        return {
            windowId: spec.id,
            server,
            slot: spec.slot,
            title: title(),
            gameLabel: gameLabel(),
            rects,
            tabs: host.tabs(),
            panes: host.panes(),
            seams: host.seams(),
            tools,
            openTools: openTools(),
            worlds: worldsView(),
            hiscores: deps.hiscores?.view() ?? null,
            chat: deps.chat(),
            singlePlayer: single?.view() ?? null
        };
    }

    function pushState(): void {
        if (shellView.webContents.isDestroyed()) return;
        try {
            shellView.webContents.send(IPC.shellState, state());
        } catch (err) {
            deps.log(`${tag} could not push state: ${(err as Error).message}`);
        }
    }

    // ── layout ───────────────────────────────────────────────────────────

    /**
     * Where everything goes.
     *
     * The window no longer grows to accommodate what opens inside it. Nothing
     * opens *beside* anything now — a split divides space that is already
     * allocated — so the widen / shift / push ladder, the content extent
     * carried across a chrome toggle and the per-axis mode the shell used to
     * report all went with the chrome that motivated them. What is left is: the
     * bar across the top, the rail down the right, and the tree in the rest.
     *
     * The tree's rect is inset by a pixel so the focus border has shell to be
     * drawn on at the container's edge. Between panes it has the seam. A native
     * view cannot be outlined from inside itself, and `layoutTree` is
     * deliberately unaware that either of those is what the gap is for.
     */
    function applyLayout(): void {
        if (win.isDestroyed()) return;
        const { width, height } = win.getContentBounds();
        const railW = Math.min(RAIL_WIDTH, width);
        const below = Math.max(0, height - TAB_BAR_HEIGHT);
        rects = {
            tabBar: { x: 0, y: 0, width, height: Math.min(TAB_BAR_HEIGHT, height) },
            rail: { x: width - railW, y: TAB_BAR_HEIGHT, width: railW, height: below },
            tree: {
                x: TREE_INSET,
                y: TAB_BAR_HEIGHT + TREE_INSET,
                width: Math.max(0, width - railW - TREE_INSET * 2),
                height: Math.max(0, below - TREE_INSET * 2)
            }
        };
        shellView.setBounds({ x: 0, y: 0, width, height });
        host.layout(rects.tree);
        pushState();
    }

    win.on('resize', () => applyLayout());
    // A maximise or a fullscreen changes the content bounds without a resize
    // event on every platform, so the layout is re-run for both.
    win.on('maximize', () => applyLayout());
    win.on('unmaximize', () => applyLayout());
    win.on('enter-full-screen', () => applyLayout());
    win.on('leave-full-screen', () => applyLayout());

    // ── the panes ────────────────────────────────────────────────────────

    let panelProbe: NodeJS.Timeout | null = null;

    /** The whole list is probed only while a Worlds pane is open somewhere in this window. */
    function syncPanelProbe(): void {
        const worlds = deps.worlds;
        const wanted = openTools().includes('worlds') && worldSwitch !== null && worlds !== null;
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
     * The rail. Puts a tool in the focused pane — or splits that pane and uses
     * the new half when it holds the game, so a click on the rail can never
     * cost the player their view of the game. A tool already placed is brought
     * into focus instead of opened a second time: the rail is a set of
     * destinations, not a queue of requests.
     */
    function selectTool(id: ToolId): void {
        if (!tools.includes(id)) return;
        const tree = host.tree();
        const already = paneIds(tree).find(paneId => {
            const content = contentOf(tree, paneId);
            return content?.kind === 'tool' && content.tool === id;
        });
        if (already) {
            host.focus(already);
            return;
        }
        const target = host.focusedPaneId();
        if (contentOf(tree, target)?.kind === 'game') {
            host.split(target, 'x');
            host.setContent(host.focusedPaneId(), { kind: 'tool', tool: id });
        } else {
            host.setContent(target, { kind: 'tool', tool: id });
        }
        deps.log(`${tag} opened ${id} in a pane`);
        syncPanelProbe();
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
        const menu = Menu.buildFromTemplate(
            paneMenuItems(host.tree(), paneId, rect).map(item => ({
                label: item.label,
                enabled: item.enabled,
                click: () => {
                    if (item.id === 'split-x') host.split(paneId, 'x');
                    else if (item.id === 'split-y') host.split(paneId, 'y');
                    else if (item.id === 'close') void closePane(paneId);
                    else {
                        const splitId = parentSplitOf(host.tree(), paneId);
                        if (splitId) host.evenOut(splitId);
                    }
                }
            }))
        );
        menu.popup({ window: win, x: Math.round(x), y: Math.round(y) });
    }

    /**
     * The dropdown in a pane's header: everything that pane could become.
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
        const template = items.flatMap((item, i) => [
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
     */
    async function closePane(paneId: string): Promise<void> {
        const isGame = contentOf(host.tree(), paneId)?.kind === 'game';
        if (isGame) {
            if (!(await deps.confirmCloseGame('pane'))) return;
            destroyGame('pane');
        }
        host.close(paneId);
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
    function destroyGame(via: 'pane' | 'tab'): void {
        if (gameView) {
            win.contentView.removeChildView(gameView);
            if (!gameView.webContents.isDestroyed()) gameView.webContents.close();
            gameView = null;
        }
        deps.log(`${tag} closed the game ${via} and disconnected`);
    }

    // ── the game view ────────────────────────────────────────────────────

    /**
     * The one way the game view changes page. Each load gets its own promise,
     * and settles the one before it: a waiter left pending by a load this one
     * supersedes — the starting page, then the game — is settled by this
     * load's result rather than left hanging.
     */
    function loadGame(url: string): Promise<LoadResult> {
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
     * The starting page in the state the service is in. Only a single-player
     * window shows it. `pagefailed` is the page's own state, not the world's:
     * the world is up and its page is what would not load.
     */
    function showStarting(override?: { state: SinglePlayerView['status'] | 'pagefailed'; reason: string }): void {
        if (!single || win.isDestroyed()) return;
        const view = single.view();
        const version = view.version ? `engine ${view.version.engine.slice(0, 8)} · content ${view.version.content.slice(0, 8)} · rev ${view.version.revision}` : '';
        // This page supersedes a game load still in flight — the world died between
        // becoming ready and the page finishing. Chromium reports the superseded load
        // as ERR_ABORTED, which did-fail-load ignores, and this page's own
        // did-finish-load settles nothing, so the waiter would wait forever.
        if (gameLoadPending) settleLoad('failed');
        failedOver = true;
        void gameView?.webContents.loadFile(STARTING_PAGE, {
            query: {
                state: override?.state ?? view.status,
                version,
                reason: override?.reason ?? view.reason ?? '',
                log: view.logTail.slice(-20).join('\n')
            }
        });
    }

    /** The world changed state: load the game when it is ready, show the page otherwise. */
    let loadedGameUrl: string | null = null;
    function syncSinglePlayer(): void {
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
        // Nothing the page does may replace the game. The one exception is our
        // own offline page returning to the page main asked for.
        wc.on('will-navigate', (event, url) => {
            const decision = decideNavigation({ current: wc.getURL(), target: url, expected });
            if (decision === 'allow') return;
            event.preventDefault();
            if (decision === 'retry') {
                deps.log(`${tag} retrying the world`);
                // Forgetting the url is what lets the same one be loaded again: when the
                // world is already up and only its page failed, retry() resolves off the
                // ready status without changing it, so nothing notifies and syncSinglePlayer
                // would otherwise see the url it has already loaded and do nothing.
                loadedGameUrl = null;
                void single?.retry().then(
                    () => syncSinglePlayer(),
                    () => syncSinglePlayer()
                );
                return;
            }
            if (decision === 'open-external') {
                deps.log(`${tag} sent ${url} to the system browser`);
                void shell.openExternal(url);
            } else {
                deps.log(`${tag} blocked navigation to ${url}`);
            }
        });
        wc.setWindowOpenHandler(({ url }) => {
            if (/^https?:\/\//.test(url)) void shell.openExternal(url);
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
        // Mouse back and forward buttons would walk the history of world switches.
        win.on('app-command', (event, command) => {
            if (command === 'browser-backward' || command === 'browser-forward') event.preventDefault();
        });

        wc.on('did-start-navigation', (_event, url) => {
            // A retry from the offline page is a fresh attempt.
            if (!url.startsWith('file:')) failedOver = false;
        });
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

    if (worldSwitch) currentProbe = setInterval(() => void probeCurrent(), PROBE_EVERY_MS);
    const unsubscribeWorlds = deps.worlds?.subscribe(() => pushState()) ?? null;

    // ── lifecycle ────────────────────────────────────────────────────────

    // The page keeps its own title; the window keeps the server's name and world.
    win.on('page-title-updated', event => event.preventDefault());
    win.on('close', event => {
        if (!deps.confirmClose(spec.title)) event.preventDefault();
    });
    win.on('closed', () => {
        if (currentProbe) clearInterval(currentProbe);
        if (panelProbe) clearInterval(panelProbe);
        // The views go with the window; the `persist:pages` session does not, so
        // a LostHQ login outlives both this window and this launch.
        host.destroy();
        unsubscribeWorlds?.();
        unsubscribeSingle?.();
        single?.release();
        onClosed();
    });

    shellView.webContents.once('did-finish-load', () => {
        if (win.isDestroyed()) return;
        applyLayout();
        win.show();
    });

    applyLayout();
    refreshLabels();
    loadShell(shellView.webContents);

    let unsubscribeSingle: (() => void) | null = null;
    if (single) {
        // The load promise stays pending until the game itself loads, or the world fails.
        loadPromise = new Promise<LoadResult>(resolve => {
            loadWaiter = resolve;
        });
        unsubscribeSingle = single.subscribe(syncSinglePlayer);
        showStarting();
        void single.acquire().then(
            () => syncSinglePlayer(),
            () => {
                syncSinglePlayer();
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
        selectTool,
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
        splitPane: (paneId, axis) => host.split(paneId, axis),
        closePane,
        setPaneContent,
        focusPane: paneId => host.focus(paneId),
        swapPanes: (a, b) => host.swap(a, b),
        setDragging: on => host.setDragging(on),
        showPaneMenu,
        showPaneContentMenu,
        setSeam: (splitId, index, px) => host.dragSeam(splitId, index, px),
        evenOut: splitId => host.evenOut(splitId),
        evenOutFocused: () => {
            const splitId = parentSplitOf(host.tree(), host.focusedPaneId());
            if (splitId) host.evenOut(splitId);
        },
        pageGo: where => host.go(where),
        newTab: () => host.newTab(),
        closeTab,
        selectTab: tabId => host.selectTab(tabId),
        relayout: applyLayout,
        state,
        pushState,
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
        settle: async () => {
            // Two frames: the first schedules the render, the second proves it
            // composited. Raced against a timeout because requestAnimationFrame
            // does not fire at all in an occluded window — waiting on it alone
            // hangs forever, which is exactly what it did.
            const painted = shellView.webContents
                .executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
                .catch(() => undefined);
            await Promise.race([painted, new Promise(resolve => setTimeout(resolve, 1_500))]);
        },
        captureShell: () => shellView.webContents.capturePage(),
        captureGame: () => gameView?.webContents.capturePage() ?? Promise.reject(new Error('no game view')),
        capturePage: async () => {
            const view = host.pageWebContents();
            if (!view || view.webContents.isDestroyed()) return null;
            // Two frames, exactly as `settle` does for the shell, and for a
            // reason this feature demonstrated: a view that has just been shown
            // has not composited since, so capturePage hands back the frame it
            // was hidden on. That photographed a forum that had long since
            // finished booting as a page still showing its loading spinner —
            // a stale frame reported as a broken feature, which is the whole
            // hazard the shell's own settle exists for.
            const painted = view.webContents
                .executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
                .catch(() => undefined);
            await Promise.race([painted, new Promise(resolve => setTimeout(resolve, 1_500))]);
            return view.webContents.capturePage();
        }
    };
}
