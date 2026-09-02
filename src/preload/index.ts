import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type SidebarState, type SessionState, type XpState, type SwiftkitApi } from '../shared/ipc';

/**
 * The shell renderer's only bridge to main. Deliberately narrow: no raw
 * ipcRenderer, no channel names, no send passthrough. Every push returns an
 * unsubscribe closure so React effects can clean up.
 *
 * The game view gets no preload at all — this file is never loaded into it.
 */
function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
    const handler = (_e: unknown, value: T): void => cb(value);
    ipcRenderer.on(channel, handler);
    return () => {
        ipcRenderer.off(channel, handler);
    };
}

const api: SwiftkitApi = {
    sidebar: {
        toggle: () => ipcRenderer.invoke(IPC.sidebarToggle),
        setOpen: open => ipcRenderer.invoke(IPC.sidebarSetOpen, open),
        onState: cb => subscribe<SidebarState>(IPC.sidebarState, cb)
    },
    session: {
        onState: cb => subscribe<SessionState>(IPC.sessionState, cb)
    },
    xp: {
        onState: cb => subscribe<XpState>(IPC.xpState, cb)
    }
};

contextBridge.exposeInMainWorld('swiftkit', api);
