import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ServerInfo, type SwiftkitApi } from '../shared/ipc';

/**
 * The launcher's only bridge to main. Deliberately narrow: no raw ipcRenderer,
 * no channel names, no send passthrough.
 *
 * Game windows get no preload at all — this file is never loaded into them.
 */
const api: SwiftkitApi = {
    servers: {
        list: () => ipcRenderer.invoke(IPC.serversList),
        open: id => ipcRenderer.invoke(IPC.serverOpen, id),
        openUrl: url => ipcRenderer.invoke(IPC.serverOpenUrl, url),
        onState: cb => {
            const handler = (_e: unknown, servers: ServerInfo[]): void => cb(servers);
            ipcRenderer.on(IPC.serversState, handler);
            return () => {
                ipcRenderer.off(IPC.serversState, handler);
            };
        }
    }
};

contextBridge.exposeInMainWorld('swiftkit', api);
