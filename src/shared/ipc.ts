/** Channel names and payload types, shared by main, preload and the renderer so they can't drift. */
import type { ServerDef } from './catalog';
import type { Detail, WorldsView } from './worlds';
import type { ChatView } from './chat';
import type { SettingsSave } from './chatSettings';
import type { HiscoresView } from './hiscores';
import type { DropTargets, DropZone, PaneView, SeamView, TabView } from './panes';
import type { PaneContent } from '../main/paneTree';
import type { CharacterOutcome, ImportPick, SinglePlayerSettings, SinglePlayerView } from './singleplayer';
import type { CommandRef } from './commands';
import type { ShareView } from './share';
import type { TimerAlert, TimerSaveInput, TimersView } from './timers';

export const IPC = {
    shellState: 'zanaris:shell-state',
    shellGet: 'zanaris:shell-get',
    paneSplit: 'zanaris:pane-split',
    paneClose: 'zanaris:pane-close',
    paneSetContent: 'zanaris:pane-set-content',
    paneFocus: 'zanaris:pane-focus',
    paneSetSeam: 'zanaris:pane-set-seam',
    paneEvenOut: 'zanaris:pane-even-out',
    paneGo: 'zanaris:pane-go',
    paneContextMenu: 'zanaris:pane-context-menu',
    paneBeginDrag: 'zanaris:pane-begin-drag',
    paneDrop: 'zanaris:pane-drop',
    paneEndDrag: 'zanaris:pane-end-drag',
    paneContentMenu: 'zanaris:pane-content-menu',
    tabNew: 'zanaris:tab-new',
    tabClose: 'zanaris:tab-close',
    tabSelect: 'zanaris:tab-select',
    tabContextMenu: 'zanaris:tab-context-menu',
    tabAddPaneMenu: 'zanaris:tab-add-pane-menu',
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
    chatSaveSettings: 'zanaris:chat-save-settings',
    chatConnect: 'zanaris:chat-connect',
    chatDisconnect: 'zanaris:chat-disconnect',
    singlePlayerSetSetting: 'zanaris:singleplayer-set-setting',
    singlePlayerRetry: 'zanaris:singleplayer-retry',
    singlePlayerOpenSaves: 'zanaris:singleplayer-open-saves',
    singlePlayerShowLog: 'zanaris:singleplayer-show-log',
    singlePlayerPickImport: 'zanaris:singleplayer-pick-import',
    singlePlayerImport: 'zanaris:singleplayer-import',
    singlePlayerExport: 'zanaris:singleplayer-export',
    singlePlayerRename: 'zanaris:singleplayer-rename',
    singlePlayerDuplicate: 'zanaris:singleplayer-duplicate',
    singlePlayerDelete: 'zanaris:singleplayer-delete',
    singlePlayerCommands: 'zanaris:singleplayer-commands',
    singlePlayerCopyTo: 'zanaris:singleplayer-copy-to',
    singlePlayerUseBuild: 'zanaris:singleplayer-use-build',
    singlePlayerDownloadBuild: 'zanaris:singleplayer-download-build',
    singlePlayerRemoveBuild: 'zanaris:singleplayer-remove-build',
    shareStart: 'zanaris:share-start',
    shareStop: 'zanaris:share-stop',
    shareCopy: 'zanaris:share-copy',
    shareOpen: 'zanaris:share-open',
    timersStart: 'zanaris:timers-start',
    timersPause: 'zanaris:timers-pause',
    timersReset: 'zanaris:timers-reset',
    timersSave: 'zanaris:timers-save',
    timersDelete: 'zanaris:timers-delete',
    timersRestore: 'zanaris:timers-restore',
    timersSound: 'zanaris:timers-sound',
    timersAlert: 'zanaris:timers-alert'
} as const;

/**
 * The tools a window can offer. Five: `guides` stopped being one when an empty
 * pane started showing a launcher that lists this server's links beside the
 * tools, leaving the Guides panel with no separate job, and `timers` joined. A
 * registry is worth it when the list grows. This is the set, not the menu
 * order — which tools a given window offers and in what order is
 * `serverWindow`'s to say, and it is deliberately not spelled out again here:
 * that order already lives in three places that have to be edited together,
 * and a fourth copy sitting in a docstring none of them cross-reference is the
 * one that would go stale first and be believed longest.
 */
export const TOOL_IDS = ['worlds', 'hiscores', 'chat', 'singleplayer', 'timers'] as const;
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
        /** The region the active tab's panes are laid out in: everything below the bar. */
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
    /** Tools this window offers, in the order its menus list them. */
    tools: ToolId[];
    /** Null when the server has one page. */
    worlds: WorldsView | null;
    /** Null when the server offers no hiscores — single player above all, where a one-player world has nothing to rank. */
    hiscores: HiscoresView | null;
    /** One connection serves every window, so this is the same in all of them. */
    chat: ChatView;
    /** The world this computer runs; null for every other kind of window. */
    singlePlayer: SinglePlayerView | null;
    /** Whether that world is shared with a link; null wherever `singlePlayer` is. */
    share: ShareView | null;
    /** This window's clocks. Every window has them: the built-ins are on every server and the player's own are app-wide. */
    timers: TimersView;
}

export interface ZanarisApi {
    shell: {
        /** Null when the calling view is not a server window's shell. */
        get(): Promise<ShellState | null>;
        onState(cb: (state: ShellState) => void): () => void;
    };
    chat: {
        /** Sends a line. Text beginning with / is a command: /me, /msg, /nick, /join and /part are read here, and anything else goes to the server as typed. */
        send(text: string): Promise<void>;
        /** Shows a channel in the panel and marks it read. */
        select(channel: string): Promise<void>;
        /**
         * Leaves a channel for the rest of the session. The saved auto-join
         * list is not touched, so an auto-join channel comes back on the next
         * connect. Main refuses Status, which is not a channel.
         */
        closeRoom(channel: string): Promise<void>;
        /**
         * Saves the Settings form and applies what it can to the connection as
         * it is. Resolves to null when saved, or to why it was refused — main
         * checks the form again, whatever the shell already checked.
         */
        saveSettings(save: SettingsSave): Promise<string | null>;
        /** Connects with the saved settings, and remembers to connect on the next launch. */
        connect(): Promise<void>;
        /** Says goodbye and stays offline, this launch and the next, until connect. */
        disconnect(): Promise<void>;
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
         * Starts a header drag from `from`. Main hides every native view until
         * the drag ends, because the shell cannot draw a drop target over a game
         * or a page — those views sit above it. Nothing reloads: this is the
         * same hiding a tab switch does.
         *
         * Resolves with every drop the drag could make: for each other pane and
         * each zone, the rect the dragged pane would be drawn at, or null where
         * that drop is refused. Null when the active tab has no such pane.
         */
        beginDrag(from: string): Promise<DropTargets | null>;
        /**
         * Drops the dragged pane on `to`. The centre swaps the two panes; an
         * edge moves the dragged pane beside `to`, splitting it on that side.
         * Ends the drag in the same step, so the views come back already where
         * the drop put them. Main asks again whether the drop is allowed and
         * changes nothing when it is not.
         */
        drop(from: string, to: string, zone: DropZone): Promise<void>;
        /** Ends a drag without dropping: Escape, a cancelled pointer, or a release over nothing that takes a drop. */
        endDrag(): Promise<void>;
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
        /**
         * Raises the tab bar's Add pane menu: everything a new pane could hold.
         * Choosing one adds a column down the active tab's right edge, or goes
         * to the pane in this tab already holding it. Native and built in main
         * like the pane menus, since it drops down over native views.
         * Coordinates are the window's.
         */
        addPaneMenu(x: number, y: number): Promise<void>;
        /** Opens one of this server's links in the system browser instead of a pane. Refused, like `setContent`, for anything that is not one of them. */
        openExternal(url: string): Promise<void>;
    };
    singlePlayer: {
        /** Changes one of the world's settings. Asks first when the world is running, since the change restarts it. */
        setSetting<K extends keyof SinglePlayerSettings>(key: K, value: SinglePlayerSettings[K]): Promise<void>;
        retry(): Promise<void>;
        openSaves(): Promise<void>;
        showLog(): Promise<void>;
        /** Opens a file dialog and reads the save picked. Null when the dialog was cancelled. */
        pickImport(): Promise<ImportPick | null>;
        /**
         * Files a picked save under a name. Main checks the name and reads the
         * file again, and asks first when that replaces a character or the
         * world is running.
         */
        importAs(token: string, name: string): Promise<CharacterOutcome>;
        /** Copies a character's save to where a save dialog says. */
        exportCharacter(name: string): Promise<CharacterOutcome>;
        /** Asks first when that replaces a character or the world is running. */
        rename(from: string, to: string): Promise<CharacterOutcome>;
        /** Asks first when that replaces a character or the world is running. */
        duplicate(from: string, to: string): Promise<CharacterOutcome>;
        /** Moves a character's save to the system trash, after asking. */
        remove(name: string): Promise<CharacterOutcome>;
        /** Copies a character into another revision's world, after asking. Never replaces one there. */
        copyTo(name: string, revision: number): Promise<CharacterOutcome>;
        /**
         * Makes a build line the one the world runs, downloading it first if it
         * is not here. Asks first when the world is running, since it restarts.
         */
        useBuild(id: string): Promise<void>;
        /** Downloads a line's build. The button that calls this says what and how big. */
        downloadBuild(id: string): Promise<void>;
        /** Deletes a line's build after asking. Resolves with why not when it could not, else null. */
        removeBuild(id: string): Promise<string | null>;
        /**
         * The content's debug procs, from the selected build's COMMANDS.json.
         * Null when that build has none, or is not downloaded. Asked for by the
         * Commands section once per build rather than carried in ShellState:
         * some 250 entries that change only with the build, which the shell
         * state would push to every window on every layout.
         */
        commands(): Promise<CommandRef[] | null>;
    };
    share: {
        /** Asks first: to download cloudflared if it is not here yet, then to share. */
        start(): Promise<void>;
        stop(): Promise<void>;
        /** Main copies the link it holds; the renderer never supplies one. */
        copyLink(): Promise<void>;
        /** Opens the link in the system browser, to see what friends see. */
        openLink(): Promise<void>;
    };
    timers: {
        start(id: string): Promise<void>;
        pause(id: string): Promise<void>;
        /** Back to the beginning, and running. */
        reset(id: string): Promise<void>;
        /** Saves a clock for every window. Resolves with what main refused it for, or null once it is saved. */
        save(input: TimerSaveInput): Promise<string | null>;
        /** Custom clocks only. Resolves like `save`. */
        delete(id: string): Promise<string | null>;
        /** Built-ins only: clears the player's changes. Resolves like `save`. */
        restore(id: string): Promise<string | null>;
        /** The alert sound's bytes: the one bundled sound every alert plays. Null when the caller is not a server window's shell. */
        sound(): Promise<Uint8Array | null>;
        /** Main asking this window to play the alert. Returns an unsubscribe. */
        onAlert(cb: (alert: TimerAlert) => void): () => void;
    };
}
