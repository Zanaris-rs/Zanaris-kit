/** Channel names and payload types, shared by main, preload and the renderer so they can't drift. */
import type { ServerDef } from './catalog';
import type { LayoutMode, TabKind } from './layout';
import type { Detail, WorldsView } from './worlds';

export const IPC = {
    shellState: 'zanaris:shell-state',
    shellGet: 'zanaris:shell-get',
    shellTogglePanel: 'zanaris:shell-toggle-panel',
    shellSelectTool: 'zanaris:shell-select-tool',
    worldsRefresh: 'zanaris:worlds-refresh',
    worldsSwitch: 'zanaris:worlds-switch',
    worldsSetDetail: 'zanaris:worlds-set-detail'
} as const;

/** The tools a window can offer. One so far; a registry is worth it when the second lands. */
export const TOOL_IDS = ['worlds'] as const;
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
    mode: LayoutMode;
    /** Where main placed things, relative to the window's content area, so the shell draws exactly there. */
    rects: {
        strip: Rect;
        address: Rect | null;
        content: Rect;
        panel: Rect | null;
        rail: Rect;
    };
    /** Tools this window offers, in rail order. */
    tools: ToolId[];
    activeTool: ToolId | null;
    /** Null when the server has one page. */
    worlds: WorldsView | null;
}

export interface ZanarisApi {
    shell: {
        /** Null when the calling view is not a server window's shell. */
        get(): Promise<ShellState | null>;
        togglePanel(): Promise<void>;
        /** Opens the panel on a tool; null closes it. */
        selectTool(id: ToolId | null): Promise<void>;
        onState(cb: (state: ShellState) => void): () => void;
    };
    worlds: {
        refresh(): Promise<void>;
        /** Loads the given world in this window. Logs the player out. */
        switch(world: number): Promise<void>;
        /** Reloads the current world at the given detail. */
        setDetail(detail: Detail): Promise<void>;
    };
}
