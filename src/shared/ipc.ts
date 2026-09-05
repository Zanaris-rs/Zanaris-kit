/** Channel names and payload types, shared by main and preload so they can't drift. */

export const IPC = {
    serversList: 'swiftkit:servers-list',
    serversState: 'swiftkit:servers-state',
    serverOpen: 'swiftkit:server-open',
    serverOpenUrl: 'swiftkit:server-open-url'
} as const;

export interface ServerInfo {
    id: string;
    name: string;
    url: string;
    /** True while this server has a window. */
    open: boolean;
}

export type OpenResult = { ok: true } | { ok: false; error: string };

export interface SwiftkitApi {
    servers: {
        list(): Promise<ServerInfo[]>;
        /** Opens the server's window, or focuses it if it is already open. */
        open(id: string): Promise<OpenResult>;
        /** Opens a typed address, adding it to the list if it is new. */
        openUrl(url: string): Promise<OpenResult>;
        /** Fires whenever a window opens or closes. Returns an unsubscribe. */
        onState(cb: (servers: ServerInfo[]) => void): () => void;
    };
}
