import type { ServerInfo } from '../shared/ipc.ts';
import { customServer, parseServerUrl, type ServerDef } from './servers.ts';

/** The little the registry needs from a window — enough to focus or close it. */
export interface GameWindowHandle {
    focus(): void;
    close(): void;
}

/** Creates the window for a server. Must call `onClosed` once, when the window is gone. */
export type WindowFactory = (server: ServerDef, onClosed: () => void) => GameWindowHandle;

/**
 * Which servers exist and which of them currently have a window. Pure
 * bookkeeping: the Electron side is injected as a factory, so this is tested
 * without launching anything.
 *
 * At most one window per server. Opening an open server focuses it instead.
 */
export class ServerRegistry {
    private readonly servers: ServerDef[];
    private readonly windows = new Map<string, GameWindowHandle>();
    private readonly factory: WindowFactory;
    private readonly onChange: () => void;

    constructor(servers: readonly ServerDef[], factory: WindowFactory, onChange: () => void = () => {}) {
        this.servers = [...servers];
        this.factory = factory;
        this.onChange = onChange;
    }

    list(): ServerInfo[] {
        return this.servers.map(s => ({ ...s, open: this.windows.has(s.id) }));
    }

    open(id: string): 'opened' | 'focused' | 'unknown' {
        const server = this.servers.find(s => s.id === id);
        if (!server) return 'unknown';

        const existing = this.windows.get(id);
        if (existing) {
            existing.focus();
            return 'focused';
        }

        // Identity-checked so a late 'closed' from an old window can never
        // evict a newer one opened for the same server.
        const slot: { handle: GameWindowHandle | null } = { handle: null };
        slot.handle = this.factory(server, () => {
            if (slot.handle && this.windows.get(id) === slot.handle) {
                this.windows.delete(id);
                this.onChange();
            }
        });
        this.windows.set(id, slot.handle);
        this.onChange();
        return 'opened';
    }

    /** Opens a typed address, adding it to the list if it is new. */
    openUrl(input: string): { ok: true; id: string } | { ok: false; error: string } {
        const parsed = parseServerUrl(input);
        if (!parsed.ok) return parsed;

        // An address that is already listed — built-in or custom — is that server.
        let server = this.servers.find(s => s.url === parsed.url);
        if (!server) {
            server = customServer(parsed.url);
            const byId = this.servers.find(s => s.id === server!.id);
            if (byId) server = byId;
            else this.servers.push(server);
        }

        this.open(server.id);
        return { ok: true, id: server.id };
    }

    closeAll(): void {
        for (const handle of [...this.windows.values()]) handle.close();
    }
}
