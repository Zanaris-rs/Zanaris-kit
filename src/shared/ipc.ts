/** Channel names and payload types, shared by main, preload and the renderer so they can't drift. */
import type { ServerDef } from './catalog';
import type { LayoutMode, TabKind } from './layout';
import type { Detail, WorldsView } from './worlds';
import type { ChatHome, ChatView } from './chat';
import type { SinglePlayerView } from './singleplayer';

export const IPC = {
    shellState: 'zanaris:shell-state',
    shellGet: 'zanaris:shell-get',
    shellTogglePanel: 'zanaris:shell-toggle-panel',
    shellSelectTool: 'zanaris:shell-select-tool',
    worldsRefresh: 'zanaris:worlds-refresh',
    worldsSwitch: 'zanaris:worlds-switch',
    worldsSetDetail: 'zanaris:worlds-set-detail',
    chatState: 'zanaris:chat-state',
    chatGet: 'zanaris:chat-get',
    chatSend: 'zanaris:chat-send',
    chatSelect: 'zanaris:chat-select',
    chatSetNick: 'zanaris:chat-set-nick',
    chatSetHome: 'zanaris:chat-set-home',
    chatSetDockHeight: 'zanaris:chat-set-dock-height',
    singlePlayerSetCheats: 'zanaris:singleplayer-set-cheats',
    singlePlayerRetry: 'zanaris:singleplayer-retry',
    singlePlayerOpenSaves: 'zanaris:singleplayer-open-saves',
    singlePlayerShowLog: 'zanaris:singleplayer-show-log'
} as const;

/** The tools a window can offer. Three so far; a registry is worth it when the list grows. */
export const TOOL_IDS = ['worlds', 'chat', 'singleplayer'] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface TabInfo {
    id: string;
    kind: TabKind;
    title: string;
    url: string;
    active: boolean;
}

export interface ShellState {
    windowId: number;
    server: ServerDef;
    slot: number;
    /** The window's title, which follows the world. */
    title: string;
    tabs: TabInfo[];
    panelOpen: boolean;
    /** How each axis accommodated its chrome. The window moving and the game shrinking are different sentences, so both axes are kept rather than collapsed into one. */
    mode: { x: LayoutMode; y: LayoutMode };
    /** Where main placed things, relative to the window's content area, so the shell draws exactly there. */
    rects: {
        strip: Rect;
        address: Rect | null;
        content: Rect;
        panel: Rect | null;
        rail: Rect;
        /** Only while the dock is open. Null while chat's home is the side column. */
        dock: Rect | null;
    };
    /** Tools this window offers, in rail order. */
    tools: ToolId[];
    activeTool: ToolId | null;
    /** Null when the server has one page. */
    worlds: WorldsView | null;
    /** One connection serves every window, so this is the same in all of them. */
    chat: ChatView;
    /** Where chat lives. App-wide: every window agrees. */
    chatHome: ChatHome;
    /** Whether the bottom dock is open. Meaningful only while chatHome is 'bottom'. */
    dockOpen: boolean;
    /** The remembered dock height in px, whether or not the dock is open. */
    dockHeight: number;
    /** The world this computer runs; null for every other kind of window. */
    singlePlayer: SinglePlayerView | null;
}

export interface ZanarisApi {
    shell: {
        /** Null when the calling view is not a server window's shell. */
        get(): Promise<ShellState | null>;
        togglePanel(): Promise<void>;
        /** Opens the panel on a tool, closing it again when that tool is the one already on show. Null only closes. Chat is routed by where it lives: while it is at the bottom, asking for it opens or closes the dock instead. */
        selectTool(id: ToolId | null): Promise<void>;
        onState(cb: (state: ShellState) => void): () => void;
    };
    chat: {
        /** Sends a line. Text beginning with / is a command: /me, /msg, /nick, /join, /part. */
        send(text: string): Promise<void>;
        /** Shows a channel in the panel and marks it read. */
        select(channel: string): Promise<void>;
        /** Chooses the nick and connects. */
        setNick(nick: string): Promise<void>;
        /** Moves chat between the bottom dock and the side column. App-wide. */
        setHome(home: ChatHome): Promise<void>;
        /** Sets the dock's height in px. Clamped by main. */
        setDockHeight(px: number): Promise<void>;
    };
    worlds: {
        refresh(): Promise<void>;
        /** Loads the given world in this window. Logs the player out. */
        switch(world: number): Promise<void>;
        /** Reloads the current world at the given detail. */
        setDetail(detail: Detail): Promise<void>;
    };
    singlePlayer: {
        /** Asks first when the world is running, since it restarts. */
        setCheats(on: boolean): Promise<void>;
        retry(): Promise<void>;
        openSaves(): Promise<void>;
        showLog(): Promise<void>;
    };
}
