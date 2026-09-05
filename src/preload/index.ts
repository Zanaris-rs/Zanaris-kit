import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type CatalogState, type ShellState, type SwiftkitApi } from '../shared/ipc';

/**
 * The only bridge between a renderer and main. Deliberately narrow: no raw
 * ipcRenderer, no channel names, no send passthrough. Every push returns an
 * unsubscribe closure so React effects can clean up.
 *
 * Game views get no preload at all. This file is never loaded into them.
 */
function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
    const handler = (_event: unknown, value: T): void => cb(value);
    ipcRenderer.on(channel, handler);
    return () => {
        ipcRenderer.off(channel, handler);
    };
}

const api: SwiftkitApi = {
    launcher: {
        get: () => ipcRenderer.invoke(IPC.catalogGet),
        add: input => ipcRenderer.invoke(IPC.catalogAdd, input),
        remove: id => ipcRenderer.invoke(IPC.catalogRemove, id),
        open: serverId => ipcRenderer.invoke(IPC.windowOpen, serverId),
        onState: cb => subscribe<CatalogState>(IPC.catalogState, cb)
    },
    shell: {
        get: () => ipcRenderer.invoke(IPC.shellGet),
        togglePanel: () => ipcRenderer.invoke(IPC.shellTogglePanel),
        newWindow: () => ipcRenderer.invoke(IPC.launcherShow),
        onState: cb => subscribe<ShellState>(IPC.shellState, cb)
    }
};

contextBridge.exposeInMainWorld('swiftkit', api);
