/** Channel names and payload types, shared by main, preload and the renderer so they can't drift. */
import type { ServerDef } from './catalog';
import type { Detail, WorldsView } from './worlds';
import type { ChatView } from './chat';
import type { HiscoresView } from './hiscores';
import type { PaneView, SeamView, TabView } from './panes';
import type { PaneContent } from '../main/paneTree';
import type { SinglePlayerView } from './singleplayer';

export const IPC = {
    shellState: 'zanaris:shell-state',
    shellGet: 'zanaris:shell-get',
    shellSelectTool: 'zanaris:shell-select-tool',
    paneSplit: 'zanaris:pane-split',
    paneClose: 'zanaris:pane-close',
    paneSetContent: 'zanaris:pane-set-content',
    paneFocus: 'zanaris:pane-focus',
    paneSetSeam: 'zanaris:pane-set-seam',
    paneEvenOut: 'zanaris:pane-even-out',
    paneGo: 'zanaris:pane-go',
    paneContextMenu: 'zanaris:pane-context-menu',
    paneSwap: 'zanaris:pane-swap',
    paneDragging: 'zanaris:pane-dragging',
    paneContentMenu: 'zanaris:pane-content-menu',
    tabNew: 'zanaris:tab-new',
    tabClose: 'zanaris:tab-close',
    tabSelect: 'zanaris:tab-select',
    tabContextMenu: 'zanaris:tab-context-menu',
    paneOpenExternal: 'zanaris:pane-open-external',
    worldsRefresh: 'zanaris:worlds-refresh',
    worldsSwitch: 'zanaris:worlds-switch',
    worldsSetDetail: 'zanaris:worlds-set-detail',
    hiscoresLookup: 'zanaris:hiscores-lookup',
    hiscoresOpenSite: 'zanaris:hiscores-open-site',
    chatState: 'zanaris:chat-state',
    chatGet: 'zanaris:chat-get',
    chatSend: 'zanaris:chat-send',
    chatSelect: 'zanaris:chat-select',
    chatCloseRoom: 'zanaris:chat-close-room',
    chatSetNick: 'zanaris:chat-set-nick',
    singlePlayerSetCheats: 'zanaris:singleplayer-set-cheats',
    singlePlayerRetry: 'zanaris:singleplayer-retry',
    singlePlayerOpenSaves: 'zanaris:singleplayer-open-saves',
    singlePlayerShowLog: 'zanaris:singleplayer-show-log'
} as const;

/**
 * The tools a window can offer. Four, since `guides` stopped being one: with
 * an empty pane showing a launcher that lists this server's links beside the
 * tools, the Guides panel had no separate job left. A registry is worth it when the
 * list grows. This is the set, not the rail order — which tools a given window
 * offers and in what order is `serverWindow`'s to say, and it is deliberately
 * not spelled out again here: that order already lives in three places that
 * have to be edited together, and a fourth copy sitting in a docstring none of
 * them cross-reference is the one that would go stale first and be believed
 * longest.
 */
export const TOOL_IDS = ['worlds', 'hiscores', 'chat', 'singleplayer'] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ShellState {
    windowId: number;
    server: ServerDef;
    slot: number;
    /** The window's title, which follows the world. */
    title: string;
    /**
     * What the strip says about the game: the server, its world, its detail
     * and its latency. A read-out where a pinned game tab used to be — the
     * game is never behind anything now, so there was nothing left to switch
     * to and nothing for a tab to mean.
     */
    gameLabel: string;
    /** Where main placed the window's own chrome, relative to its content area, so the shell draws exactly there. */
    rects: {
        tabBar: Rect;
        rail: Rect;
        /** The region the active tab's panes are laid out in: everything below the bar and left of the rail. */
        tree: Rect;
    };
    /** This window's workspace tabs. Each is a whole arrangement of the same server's things, not a different server. */
    tabs: TabView[];
    /**
     * Every pane of the active tab, in reading order. The shell draws the tool
     * and empty ones and leaves the game and page rects alone — those are
     * native views main has already positioned.
     */
    panes: PaneView[];
    /** The grabbable gaps between them, each already carrying its own pixel range. */
    seams: SeamView[];
    /** Tools this window offers, in rail order. */
    tools: ToolId[];
    /** Which of them are placed in a pane somewhere in this tab, so the rail can light them. */
    openTools: ToolId[];
    /** Null when the server has one page. */
    worlds: WorldsView | null;
    /** Null when the server offers no hiscores — single player above all, where a one-player world has nothing to rank. */
    hiscores: HiscoresView | null;
    /** One connection serves every window, so this is the same in all of them. */
    chat: ChatView;
    /** The world this computer runs; null for every other kind of window. */
    singlePlayer: SinglePlayerView | null;
}

export interface ZanarisApi {
    shell: {
        /** Null when the calling view is not a server window's shell. */
        get(): Promise<ShellState | null>;
        /**
         * The rail. Puts a tool in the focused pane, or — when that pane holds
         * the game — splits it and puts the tool in the new half, so a click on
         * the rail never costs the player their view of the game.
         */
        selectTool(id: ToolId): Promise<void>;
        onState(cb: (state: ShellState) => void): () => void;
    };
    chat: {
        /** Sends a line. Text beginning with / is a command: /me, /msg, /nick, /join, /part. */
        send(text: string): Promise<void>;
        /** Shows a channel in the panel and marks it read. */
        select(channel: string): Promise<void>;
        /**
         * Leaves a room the user joined by hand, and forgets it, so it does not
         * come back on the next launch. Main refuses anything else: a
         * per-server room would be rejoined by the next window that wants it,
         * and the lobby would not come back at all, since nothing puts it back
         * into the set the client rejoins. Neither is the user's to close from
         * here.
         */
        closeRoom(channel: string): Promise<void>;
        /** Chooses the nick and connects. */
        setNick(nick: string): Promise<void>;
    };
    worlds: {
        refresh(): Promise<void>;
        /** Loads the given world in this window. Logs the player out. */
        switch(world: number): Promise<void>;
        /** Reloads the current world at the given detail. */
        setDetail(detail: Detail): Promise<void>;
    };
    hiscores: {
        /** Looks a player up on this window's server. One request per press: these servers rate-limit. */
        lookup(name: string): Promise<void>;
        /** Opens the server's own hiscores page. */
        openSite(): Promise<void>;
    };
    panes: {
        /** Splits the named pane, putting an empty pane showing the launcher in the new half. */
        split(paneId: string, axis: 'x' | 'y'): Promise<void>;
        /**
         * Closes a pane. Closing the tab's last pane empties it rather than
         * closing the tab: with the game an ordinary pane, a close that
         * cascaded pane to tab to window would turn one keystroke into a
         * disconnect.
         */
        close(paneId: string): Promise<void>;
        /**
         * Puts something in a pane. Main checks a `page` bookmark against this
         * window's own catalog links and refuses anything else — there is no
         * address box, so the shell has no business naming an arbitrary page —
         * and refuses a second `game`, which is unrepresentable.
         */
        setContent(paneId: string, content: PaneContent): Promise<void>;
        focus(paneId: string): Promise<void>;
        /**
         * Trades what two panes hold. What dropping a dragged header on another
         * pane does; the tree's shape does not change, so nothing on screen
         * moves except the contents of those two.
         */
        swap(a: string, b: string): Promise<void>;
        /**
         * Brackets a header drag. Main hides every native view while it is on,
         * because the shell cannot draw a drop target over a game or a page —
         * those views sit above it. Nothing reloads: this is the same hiding a
         * tab switch does.
         */
        setDragging(on: boolean): Promise<void>;
        /**
         * Drags a seam to a pixel position. Resolves with the position main
         * actually applied, after its own clamp — including when the request
         * landed where the seam already was, so a caller sitting at a boundary
         * always learns the true number rather than trusting its own guess.
         */
        setSeam(splitId: string, index: number, px: number): Promise<number>;
        /** Gives one split's children equal shares. Repeated splitting halves each time, so this is what answers "make these the same size". */
        evenOut(splitId: string): Promise<void>;
        /** The focused page pane's toolbar. */
        go(where: 'back' | 'forward' | 'reload'): Promise<void>;
        /**
         * Raises the pane menu, for a right-click the shell saw. Main builds it
         * — a right-click on a game or a page never reaches the shell, so the
         * menu has to exist there anyway, and one menu is the only way all
         * three kinds of pane offer the same one. Coordinates are the window's,
         * which is what the shell's own are.
         */
        contextMenu(paneId: string, x: number, y: number): Promise<void>;
        /**
         * Raises a pane header's dropdown: everything that pane could become,
         * built in main from the same list the launcher shows. Native for the
         * same reason the gesture menu is — a header sits directly over a
         * native view in a game or page pane, and a list the shell drew would
         * open behind it.
         */
        contentMenu(paneId: string, x: number, y: number): Promise<void>;
        /** A new workspace tab, holding one empty pane. */
        newTab(): Promise<void>;
        /** Closes a tab and everything in it, asking first when the game is in it. Closing the last one closes the window. */
        closeTab(tabId: string): Promise<void>;
        selectTab(tabId: string): Promise<void>;
        /**
         * Raises a tab's menu, for a right-click on it: save its panes as a
         * layout, load one into it, open the layouts folder. Native and built in
         * main like the pane menus. Coordinates are the window's.
         */
        tabMenu(tabId: string, x: number, y: number): Promise<void>;
        /** Opens one of this server's links in the system browser instead of a pane. Refused, like `setContent`, for anything that is not one of them. */
        openExternal(url: string): Promise<void>;
    };
    singlePlayer: {
        /** Asks first when the world is running, since it restarts. */
        setCheats(on: boolean): Promise<void>;
        retry(): Promise<void>;
        openSaves(): Promise<void>;
        showLog(): Promise<void>;
    };
}
