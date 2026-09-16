import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ShellState, type ZanarisApi } from '../shared/ipc';
import type { TimerAlert } from '../shared/timers';

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
        saveSettings: save => ipcRenderer.invoke(IPC.chatSaveSettings, save),
        connect: () => ipcRenderer.invoke(IPC.chatConnect),
        disconnect: () => ipcRenderer.invoke(IPC.chatDisconnect)
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
    panes: {
        split: (paneId, axis) => ipcRenderer.invoke(IPC.paneSplit, paneId, axis),
        close: paneId => ipcRenderer.invoke(IPC.paneClose, paneId),
        setContent: (paneId, content) => ipcRenderer.invoke(IPC.paneSetContent, paneId, content),
        focus: paneId => ipcRenderer.invoke(IPC.paneFocus, paneId),
        setSeam: (splitId, index, px) => ipcRenderer.invoke(IPC.paneSetSeam, splitId, index, px),
        evenOut: splitId => ipcRenderer.invoke(IPC.paneEvenOut, splitId),
        go: where => ipcRenderer.invoke(IPC.paneGo, where),
        contextMenu: (paneId, x, y) => ipcRenderer.invoke(IPC.paneContextMenu, paneId, x, y),
        beginDrag: from => ipcRenderer.invoke(IPC.paneBeginDrag, from),
        drop: (from, to, zone) => ipcRenderer.invoke(IPC.paneDrop, from, to, zone),
        endDrag: () => ipcRenderer.invoke(IPC.paneEndDrag),
        contentMenu: (paneId, x, y) => ipcRenderer.invoke(IPC.paneContentMenu, paneId, x, y),
        newTab: () => ipcRenderer.invoke(IPC.tabNew),
        closeTab: tabId => ipcRenderer.invoke(IPC.tabClose, tabId),
        selectTab: tabId => ipcRenderer.invoke(IPC.tabSelect, tabId),
        tabMenu: (tabId, x, y) => ipcRenderer.invoke(IPC.tabContextMenu, tabId, x, y),
        addPaneMenu: (x, y) => ipcRenderer.invoke(IPC.tabAddPaneMenu, x, y),
        openExternal: url => ipcRenderer.invoke(IPC.paneOpenExternal, url)
    },
    singlePlayer: {
        setCheats: on => ipcRenderer.invoke(IPC.singlePlayerSetCheats, on),
        retry: () => ipcRenderer.invoke(IPC.singlePlayerRetry),
        openSaves: () => ipcRenderer.invoke(IPC.singlePlayerOpenSaves),
        showLog: () => ipcRenderer.invoke(IPC.singlePlayerShowLog)
    },
    share: {
        start: () => ipcRenderer.invoke(IPC.shareStart),
        stop: () => ipcRenderer.invoke(IPC.shareStop),
        copyLink: () => ipcRenderer.invoke(IPC.shareCopy),
        openLink: () => ipcRenderer.invoke(IPC.shareOpen)
    },
    timers: {
        start: id => ipcRenderer.invoke(IPC.timersStart, id),
        pause: id => ipcRenderer.invoke(IPC.timersPause, id),
        reset: id => ipcRenderer.invoke(IPC.timersReset, id),
        save: input => ipcRenderer.invoke(IPC.timersSave, input),
        delete: id => ipcRenderer.invoke(IPC.timersDelete, id),
        restore: id => ipcRenderer.invoke(IPC.timersRestore, id),
        sound: () => ipcRenderer.invoke(IPC.timersSound),
        onAlert: cb => {
            const handler = (_event: unknown, alert: TimerAlert): void => cb(alert);
            ipcRenderer.on(IPC.timersAlert, handler);
            return () => {
                ipcRenderer.off(IPC.timersAlert, handler);
            };
        }
    }
};

contextBridge.exposeInMainWorld('zanaris', api);
