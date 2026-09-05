import type { ServerDef } from '../shared/catalog.ts';
import { SlotAllocator, partitionFor, windowTitle } from './slots.ts';

/** The little the registry needs from a window: enough to focus or close it. */
export interface ServerWindowHandle {
    focus(): void;
    close(): void;
}

/** Everything a window needs to know about itself at creation. It never changes. */
export interface WindowSpec {
    id: number;
    server: ServerDef;
    slot: number;
    title: string;
    partition: string;
}

/** Creates the window. Must call `onClosed` once, when the window is gone. */
export type ServerWindowFactory = (spec: WindowSpec, onClosed: () => void) => ServerWindowHandle;

export interface OpenWindow {
    id: number;
    serverId: string;
    slot: number;
    title: string;
}

/**
 * Which server windows exist. Pure bookkeeping over an injected factory, so it
 * is tested without Electron. Every open makes a new window; the same server
 * can be open any number of times, each in its own slot.
 */
export class ServerWindows {
    private readonly open_ = new Map<number, { spec: WindowSpec; handle: ServerWindowHandle }>();
    private readonly slots = new SlotAllocator();
    private nextId = 1;
    private readonly factory: ServerWindowFactory;
    private readonly onChange: () => void;

    constructor(factory: ServerWindowFactory, onChange: () => void = () => {}) {
        this.factory = factory;
        this.onChange = onChange;
    }

    open(server: ServerDef): OpenWindow {
        const slot = this.slots.acquire(server.id);
        const spec: WindowSpec = {
            id: this.nextId++,
            server,
            slot,
            title: windowTitle(server.name, slot),
            partition: partitionFor(server.id, slot)
        };
        const handle = this.factory(spec, () => {
            if (!this.open_.delete(spec.id)) return;
            this.slots.release(server.id, slot);
            this.onChange();
        });
        this.open_.set(spec.id, { spec, handle });
        this.onChange();
        return describe(spec);
    }

    list(): OpenWindow[] {
        return [...this.open_.values()].map(entry => describe(entry.spec));
    }

    countFor(serverId: string): number {
        return this.slots.count(serverId);
    }

    get(id: number): ServerWindowHandle | undefined {
        return this.open_.get(id)?.handle;
    }

    closeAll(): void {
        for (const entry of [...this.open_.values()]) entry.handle.close();
    }
}

function describe(spec: WindowSpec): OpenWindow {
    return { id: spec.id, serverId: spec.server.id, slot: spec.slot, title: spec.title };
}
