/** Channel names and payload types, shared by main, preload and the renderer so they can't drift. */
import type { NewServerInput, ServerDef } from './catalog';
import type { LayoutMode, TabKind } from './layout';

export const IPC = {
    catalogState: 'swiftkit:catalog-state',
    catalogGet: 'swiftkit:catalog-get',
    catalogAdd: 'swiftkit:catalog-add',
    catalogRemove: 'swiftkit:catalog-remove',
    windowOpen: 'swiftkit:window-open',
    launcherShow: 'swiftkit:launcher-show',
    shellState: 'swiftkit:shell-state',
    shellGet: 'swiftkit:shell-get',
    shellTogglePanel: 'swiftkit:shell-toggle-panel'
} as const;

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ServerInfo extends ServerDef {
    /** How many windows of this server are open right now. */
    openCount: number;
}

export interface CatalogState {
    servers: ServerInfo[];
    /** True when servers.json could not be read and the defaults were restored. */
    recovered: boolean;
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
}

export type Result = { ok: true } | { ok: false; error: string };

export interface SwiftkitApi {
    launcher: {
        get(): Promise<CatalogState>;
        /** Adds the server and opens a window for it. */
        add(input: NewServerInput): Promise<Result>;
        /** Refused while the server has open windows. */
        remove(id: string): Promise<Result>;
        /** Opens a new window for the server, every time. */
        open(serverId: string): Promise<Result>;
        onState(cb: (state: CatalogState) => void): () => void;
    };
    shell: {
        /** Null when the calling view is not a server window's shell. */
        get(): Promise<ShellState | null>;
        togglePanel(): Promise<void>;
        /** Shows the launcher. */
        newWindow(): Promise<void>;
        onState(cb: (state: ShellState) => void): () => void;
    };
}
