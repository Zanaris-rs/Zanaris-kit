/** Channel names and payload types, shared by main, preload and the renderer so they can't drift. */
import type { ServerDef } from './catalog';
import type { LayoutMode, TabKind } from './layout';

export const IPC = {
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

export interface SwiftkitApi {
    shell: {
        /** Null when the calling view is not a server window's shell. */
        get(): Promise<ShellState | null>;
        togglePanel(): Promise<void>;
        onState(cb: (state: ShellState) => void): () => void;
    };
}
