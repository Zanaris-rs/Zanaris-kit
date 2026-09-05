import type { Detail, WorldRow, WorldsDef } from '../../shared/worlds.ts';
import { listWorlds, worldEndpoint, worldUrl } from './sources.ts';

/** Everything the service needs from the outside, so it runs under node --test with fakes. */
export interface WorldsIo {
    fetchJson(url: string): Promise<unknown>;
    probe(host: string, port: number, timeoutMs: number): Promise<number | null>;
    now(): number;
}

export interface ServiceView {
    status: 'idle' | 'loading' | 'ready' | 'error';
    worlds: WorldRow[];
    fetchedAt: number | null;
    error: string | null;
}

/**
 * One per server, shared by every window of that server: the world list,
 * cached for a while, and the latency of each world's host. A failed refresh
 * keeps the last good list so the panel is never empty; an error is reported
 * beside it. Intervals belong to the caller.
 */
export class WorldsService {
    private readonly def: WorldsDef;
    private readonly io: WorldsIo;
    private readonly cacheMs: number;
    private readonly probeTimeoutMs: number;
    private status: ServiceView['status'] = 'idle';
    private rows: WorldRow[] = [];
    private fetchedAt: number | null = null;
    private error: string | null = null;
    private inFlight: Promise<ServiceView> | null = null;
    private probing: Promise<void> | null = null;
    private readonly subscribers = new Set<(view: ServiceView) => void>();

    constructor(def: WorldsDef, io: WorldsIo, opts: { cacheMs?: number; probeTimeoutMs?: number } = {}) {
        this.def = def;
        this.io = io;
        this.cacheMs = opts.cacheMs ?? 30_000;
        this.probeTimeoutMs = opts.probeTimeoutMs ?? 3_000;
    }

    view(): ServiceView {
        return { status: this.status, worlds: this.rows.map(r => ({ ...r })), fetchedAt: this.fetchedAt, error: this.error };
    }

    /** Fetches the list unless a fresh one is cached. Concurrent callers share the fetch. */
    list(force = false): Promise<ServiceView> {
        if (this.inFlight) return this.inFlight;
        const fresh = this.fetchedAt !== null && this.io.now() - this.fetchedAt < this.cacheMs;
        if (!force && fresh && this.status === 'ready') return Promise.resolve(this.view());

        this.status = 'loading';
        this.emit();
        this.inFlight = (async () => {
            try {
                const worlds = await listWorlds(this.def, this.io.fetchJson);
                const latency = new Map(this.rows.map(r => [r.id, r.latencyMs]));
                this.rows = worlds.map(w => ({ ...w, latencyMs: latency.get(w.id) ?? null }));
                this.fetchedAt = this.io.now();
                this.status = 'ready';
                this.error = null;
            } catch (err) {
                this.status = 'error';
                this.error = err instanceof Error ? err.message : String(err);
            } finally {
                this.inFlight = null;
            }
            this.emit();
            return this.view();
        })();
        return this.inFlight;
    }

    /** Measures every distinct host once and lands the figures on the rows. A pass already running is shared. */
    probeAll(detail: Detail): Promise<void> {
        if (this.probing) return this.probing;
        this.probing = (async () => {
            const targets = new Map<string, { host: string; port: number; ids: number[] }>();
            for (const row of this.rows) {
                let url: string;
                try {
                    url = worldUrl(this.def, row, detail);
                } catch {
                    continue;
                }
                const { host, port } = worldEndpoint(url);
                const key = `${host}:${port}`;
                const target = targets.get(key) ?? { host, port, ids: [] };
                target.ids.push(row.id);
                targets.set(key, target);
            }
            const results = await Promise.allSettled(
                [...targets.values()].map(async target => ({ target, ms: await this.io.probe(target.host, target.port, this.probeTimeoutMs) }))
            );
            const byId = new Map<number, number | null>();
            for (const result of results) {
                if (result.status !== 'fulfilled') continue;
                for (const id of result.value.target.ids) byId.set(id, result.value.ms);
            }
            this.rows = this.rows.map(r => (byId.has(r.id) ? { ...r, latencyMs: byId.get(r.id) ?? null } : r));
            this.probing = null;
            this.emit();
        })();
        return this.probing;
    }

    subscribe(cb: (view: ServiceView) => void): () => void {
        this.subscribers.add(cb);
        return () => {
            this.subscribers.delete(cb);
        };
    }

    private emit(): void {
        const view = this.view();
        for (const cb of this.subscribers) cb(view);
    }
}
