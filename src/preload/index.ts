import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ShellState, type SwiftkitApi } from '../shared/ipc';

/**
 * The only bridge between the shell and main. Deliberately narrow: no raw
 * ipcRenderer, no channel names, no send passthrough. The push returns an
 * unsubscribe closure so React effects can clean up.
 *
 * Game views get no preload at all. This file is never loaded into them.
 */
const api: SwiftkitApi = {
    shell: {
        get: () => ipcRenderer.invoke(IPC.shellGet),
        togglePanel: () => ipcRenderer.invoke(IPC.shellTogglePanel),
        onState: cb => {
            const handler = (_event: unknown, state: ShellState): void => cb(state);
            ipcRenderer.on(IPC.shellState, handler);
            return () => {
                ipcRenderer.off(IPC.shellState, handler);
            };
        }
    }
};

contextBridge.exposeInMainWorld('swiftkit', api);
