import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ShellState, type ZanarisApi } from '../shared/ipc';

/**
 * The only bridge between the shell and main. Deliberately narrow: no raw
 * ipcRenderer, no channel names, no send passthrough. The push returns an
 * unsubscribe closure so React effects can clean up.
 *
 * Game views get no preload at all. This file is never loaded into them.
 */
const api: ZanarisApi = {
    shell: {
        get: () => ipcRenderer.invoke(IPC.shellGet),
        togglePanel: () => ipcRenderer.invoke(IPC.shellTogglePanel),
        selectTool: id => ipcRenderer.invoke(IPC.shellSelectTool, id),
        onState: cb => {
            const handler = (_event: unknown, state: ShellState): void => cb(state);
            ipcRenderer.on(IPC.shellState, handler);
            return () => {
                ipcRenderer.off(IPC.shellState, handler);
            };
        }
    },
    chat: {
        send: text => ipcRenderer.invoke(IPC.chatSend, text),
        select: channel => ipcRenderer.invoke(IPC.chatSelect, channel),
        closeRoom: channel => ipcRenderer.invoke(IPC.chatCloseRoom, channel),
        setNick: nick => ipcRenderer.invoke(IPC.chatSetNick, nick),
        setHome: home => ipcRenderer.invoke(IPC.chatSetHome, home),
        setDockHeight: px => ipcRenderer.invoke(IPC.chatSetDockHeight, px)
    },
    worlds: {
        refresh: () => ipcRenderer.invoke(IPC.worldsRefresh),
        switch: world => ipcRenderer.invoke(IPC.worldsSwitch, world),
        setDetail: detail => ipcRenderer.invoke(IPC.worldsSetDetail, detail)
    },
    hiscores: {
        lookup: name => ipcRenderer.invoke(IPC.hiscoresLookup, name),
        openSite: () => ipcRenderer.invoke(IPC.hiscoresOpenSite)
    },
    singlePlayer: {
        setCheats: on => ipcRenderer.invoke(IPC.singlePlayerSetCheats, on),
        retry: () => ipcRenderer.invoke(IPC.singlePlayerRetry),
        openSaves: () => ipcRenderer.invoke(IPC.singlePlayerOpenSaves),
        showLog: () => ipcRenderer.invoke(IPC.singlePlayerShowLog)
    }
};

contextBridge.exposeInMainWorld('zanaris', api);
