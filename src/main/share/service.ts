import type { ShareStatus, ShareView } from '../../shared/share.ts';
import type { CloudflaredAsset } from './cloudflared.ts';

export interface ShareRelay {
    readonly port: number;
    close(): Promise<void>;
}

export interface ShareTunnel {
    readonly url: string;
    readonly exited: Promise<number | null>;
    stop(): Promise<void>;
    logs(): string[];
}

export interface ShareDeps {
    /** The pinned build for this platform, or null where Cloudflare publishes none. */
    asset: CloudflaredAsset | null;
    /** The checked binary's path, downloading it first if it is not on disk. */
    ensureBinary(onProgress: (fraction: number) => void): Promise<string>;
    startRelay(target: () => number | null): Promise<ShareRelay>;
    /** Rejects when `signal` aborts before the tunnel is live. */
    startTunnel(binary: string, port: number, signal: AbortSignal): Promise<ShareTunnel>;
    /** The world's web port while it is ready, otherwise null. */
    worldPort(): number | null;
    log(msg: string): void;
}

/**
 * Sharing the single-player world: a relay in front of it and a quick tunnel
 * in front of that. One share for every single-player window, counted like
 * the world is — each window acquires it, and the last release stops it.
 *
 * It never watches the world's status. A restart passes through `stopped` on
 * its way back to `ready`, and ending the share there would cost the link on
 * every cheats toggle; the relay answers 503 while the world is down instead.
 */
export class ShareService {
    private status: ShareStatus = 'off';
    private url: string | null = null;
    private progress: number | null = null;
    private reason: string | null = null;
    private windows = 0;
    private relay: ShareRelay | null = null;
    private tunnel: ShareTunnel | null = null;
    private controller: AbortController | null = null;
    private starting: Promise<void> | null = null;
    private stopping: Promise<void> | null = null;
    /** One download at a time. A share stopped mid-download leaves it running, and the next share waits on it rather than writing the same file twice. */
    private binary: Promise<string> | null = null;
    /** Bumped by every start and stop, so a start can tell it has been overtaken. */
    private generation = 0;
    private readonly listeners = new Set<() => void>();
    private readonly deps: ShareDeps;

    constructor(deps: ShareDeps) {
        this.deps = deps;
    }

    view(): ShareView {
        return {
            status: this.status,
            url: this.status === 'live' ? this.url : null,
            progress: this.status === 'downloading' ? this.progress : null,
            reason: this.status === 'failed' ? this.reason : null,
            available: this.deps.asset !== null
        };
    }

    subscribe(fn: () => void): () => void {
        this.listeners.add(fn);
        return () => void this.listeners.delete(fn);
    }

    acquire(): void {
        this.windows++;
    }

    /** The last single-player window is gone: nobody is left to see the link, or to stop it. */
    release(): void {
        this.windows = Math.max(0, this.windows - 1);
        if (this.windows === 0) void this.stop();
    }

    /** From off or failed. A share on its way, or live, is left as it is. */
    start(): Promise<void> {
        if (this.deps.asset === null || this.status === 'live') return Promise.resolve();
        if (this.starting) return this.starting;
        if (this.stopping) return this.stopping.then(() => this.start());
        const run = this.run(++this.generation);
        this.starting = run;
        void run.finally(() => {
            if (this.starting === run) this.starting = null;
        });
        return run;
    }

    /**
     * Ends the share straight away as far as anyone can see — the link goes
     * from the panel at once — and resolves once cloudflared and the relay are
     * gone. Every caller while it runs shares the one stop.
     */
    stop(): Promise<void> {
        if (this.stopping) return this.stopping;
        if (this.status === 'off') return Promise.resolve();
        this.generation++;
        this.controller?.abort();
        this.controller = null;
        this.starting = null;
        const { tunnel, relay } = this;
        this.tunnel = null;
        this.relay = null;
        this.url = null;
        this.progress = null;
        this.reason = null;
        this.set('off');
        const stopping = (async () => {
            await tunnel?.stop().catch(err => this.deps.log(`[share] stopping the tunnel: ${String(err)}`));
            await relay?.close().catch(err => this.deps.log(`[share] closing the relay: ${String(err)}`));
        })();
        this.stopping = stopping.finally(() => {
            this.stopping = null;
        });
        return this.stopping;
    }

    // ── internals ────────────────────────────────────────────────────────

    private async run(generation: number): Promise<void> {
        const { deps } = this;
        const current = (): boolean => this.generation === generation;
        const controller = new AbortController();
        this.controller = controller;
        let relay: ShareRelay | null = null;
        try {
            this.reason = null;
            this.url = null;
            this.progress = 0;
            this.set('downloading');
            const binary = await this.fetchBinary();
            if (!current()) return;

            this.progress = null;
            this.set('connecting');
            relay = await deps.startRelay(() => deps.worldPort());
            if (!current()) {
                await relay.close();
                return;
            }
            // From here a stop owns the relay and closes it.
            this.relay = relay;

            const tunnel = await deps.startTunnel(binary, relay.port, controller.signal);
            if (!current()) {
                await tunnel.stop();
                return;
            }
            this.tunnel = tunnel;
            this.url = `${tunnel.url}/rs2.cgi`;
            this.set('live');
            deps.log(`[share] live at ${this.url}`);
            void tunnel.exited.then(code => this.onTunnelExit(tunnel, code));
        } catch (err) {
            if (!current()) return;
            if (this.relay === relay) this.relay = null;
            await relay?.close().catch(() => undefined);
            this.fail(err instanceof Error ? err.message : String(err));
        } finally {
            if (this.controller === controller) this.controller = null;
        }
    }

    private fetchBinary(): Promise<string> {
        if (!this.binary) {
            const binary = this.deps.ensureBinary(fraction => this.onProgress(fraction));
            this.binary = binary;
            void binary.then(
                () => this.forget(binary),
                () => this.forget(binary)
            );
        }
        return this.binary;
    }

    private forget(binary: Promise<string>): void {
        if (this.binary === binary) this.binary = null;
    }

    /** Every chunk reports, and a push per chunk would be thousands of them: windows hear of each whole percent. */
    private onProgress(fraction: number): void {
        if (this.status !== 'downloading') return;
        const before = Math.floor((this.progress ?? 0) * 100);
        this.progress = fraction;
        if (Math.floor(fraction * 100) !== before) this.notify();
    }

    private onTunnelExit(tunnel: ShareTunnel, code: number | null): void {
        // A stop takes the tunnel first, so an exit it caused is not a failure.
        if (this.tunnel !== tunnel) return;
        this.tunnel = null;
        const relay = this.relay;
        this.relay = null;
        this.generation++;
        const last = lastLine(tunnel.logs());
        this.fail(`The link closed unexpectedly (cloudflared exited with code ${code})${last ? `: ${last}` : ''}`);
        void relay?.close().catch(() => undefined);
    }

    private fail(reason: string): void {
        this.reason = reason;
        this.url = null;
        this.progress = null;
        this.set('failed');
        this.deps.log(`[share] ${reason}`);
    }

    private set(status: ShareStatus): void {
        this.status = status;
        this.notify();
    }

    private notify(): void {
        for (const fn of this.listeners) {
            // A window that went away mid-send must not stop the others hearing.
            try {
                fn();
            } catch (err) {
                this.deps.log(`[share] a status listener threw: ${String(err)}`);
            }
        }
    }
}

/** cloudflared's last line, without its timestamp and level. */
function lastLine(logs: string[]): string {
    const line = logs.at(-1);
    return line ? line.replace(/^\S+Z\s+[A-Z]{3}\s+/, '').trim() : '';
}

export interface ShareDialog {
    kind: 'download' | 'share';
    message: string;
    detail: string;
    /** The button that goes ahead; the other is Cancel. */
    confirm: string;
}

/** What to ask before a share, in order: the download the first time, then the share itself every time. */
export function shareDialogs(opts: { asset: CloudflaredAsset; installed: boolean; cheats: boolean }): ShareDialog[] {
    const dialogs: ShareDialog[] = [];
    if (!opts.installed) {
        const megabytes = (opts.asset.size / 1_000_000).toFixed(1);
        dialogs.push({
            kind: 'download',
            message: "Sharing needs Cloudflare's tunnel program.",
            detail: `Zanaris Kit will download ${opts.asset.file} (${megabytes} MB) from github.com/cloudflare/cloudflared, check it against the checksum this version of the kit expects, and keep it for next time.`,
            confirm: 'Download'
        });
    }
    dialogs.push({
        kind: 'share',
        message: 'Share your world with a link?',
        detail: [
            'Anyone who has the link can join your world and log in as any character, yours included: a world on this computer checks no passwords. Only give it to people you trust.',
            ...(opts.cheats ? ['Cheats are on, so everyone who joins can use them too.'] : []),
            'The link changes every time you share. It closes when you stop sharing, close the last Single player window, or quit.'
        ].join('\n\n'),
        confirm: 'Share'
    });
    return dialogs;
}
