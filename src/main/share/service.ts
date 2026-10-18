import type { ShareStart, ShareStatus, ShareView, ShareWay, TorMode } from '../../shared/share.ts';

export interface ShareRelay {
    readonly port: number;
    /** The path the relay answers itself, and its answer: how the check knows a request came through. */
    readonly probe: { path: string; token: string };
    close(): Promise<void>;
}

export interface ShareTunnel {
    /** The program behind it, which a failure names: `cloudflared` or `tor`. */
    readonly program: string;
    /** The link's origin, with no path: `https://….trycloudflare.com` or `http://….onion`. */
    readonly url: string;
    readonly exited: Promise<number | null>;
    stop(): Promise<void>;
    logs(): string[];
}

/** One way of putting the relay on a link: its program, how it starts, and how its link is known to work. */
export interface ShareTransport {
    /** Which program it runs. Downloads are shared by program, so two shares never write the same file at once. */
    program: 'cloudflared' | 'tor';
    /** The checked binary's path, downloading it first if it is not on disk. */
    ensureBinary(onProgress: (fraction: number) => void): Promise<string>;
    /** Rejects when `signal` aborts before the tunnel has its link. */
    startTunnel(binary: string, relayPort: number, signal: AbortSignal): Promise<ShareTunnel>;
    /** Resolves once the tunnel's link reaches the relay from the internet. Rejects when it does not in time, or when `signal` aborts. */
    waitReachable(tunnel: ShareTunnel, probe: ShareRelay['probe'], signal: AbortSignal): Promise<void>;
}

export interface ShareDeps {
    /** Sharing by a Cloudflare quick tunnel, or null where Cloudflare publishes no cloudflared for this platform. */
    cloudflare: ShareTransport | null;
    /** Sharing by a Tor onion service run in `mode`, or null where Tor Project publishes no Tor for this platform. Asked once per start. */
    tor: ((mode: TorMode) => ShareTransport) | null;
    startRelay(target: () => number | null): Promise<ShareRelay>;
    /** The world's web port while it is ready, otherwise null. */
    worldPort(): number | null;
    log(msg: string): void;
}

/**
 * Sharing your home server: a relay in front of it and a tunnel in front of
 * that — a Cloudflare quick tunnel or a Tor onion service, whichever way the
 * share was started. One share for every window running your home server, counted like
 * the world is — each window acquires it, and the last release stops it.
 * The link is shown only once it works: a tunnel registers some time before
 * its link reaches it, and a link opened early can stay broken for the
 * person who opened it long after it works.
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
    /** The way the share goes and, over Tor, its mode: set by every start, cleared by a stop. */
    private way: ShareWay | null = null;
    private torMode: TorMode | null = null;
    /** The program this share's download is of, so another's abandoned download does not move its progress. */
    private program: ShareTransport['program'] | null = null;
    private windows = 0;
    private relay: ShareRelay | null = null;
    private tunnel: ShareTunnel | null = null;
    private controller: AbortController | null = null;
    private starting: Promise<void> | null = null;
    private stopping: Promise<void> | null = null;
    /**
     * One download at a time per program. A share stopped mid-download leaves
     * it running, and the next share of that program waits on it rather than
     * writing the same file twice; one of the other program downloads beside it.
     */
    private readonly binaries = new Map<ShareTransport['program'], Promise<string>>();
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
            offered: { cloudflare: this.deps.cloudflare !== null, tor: this.deps.tor !== null },
            way: this.status === 'off' ? null : this.way,
            torMode: this.status === 'off' ? null : this.torMode
        };
    }

    subscribe(fn: () => void): () => void {
        this.listeners.add(fn);
        return () => void this.listeners.delete(fn);
    }

    acquire(): void {
        this.windows++;
    }

    /** The last window running your home server is gone: nobody is left to see the link, or to stop it. */
    release(): void {
        this.windows = Math.max(0, this.windows - 1);
        if (this.windows === 0) void this.stop();
    }

    /**
     * From off or failed, either way. A share on its way, or live, is left as
     * it is, and so is a way this platform does not offer.
     */
    start(how: ShareStart): Promise<void> {
        const offered = how.way === 'cloudflare' ? this.deps.cloudflare !== null : this.deps.tor !== null;
        if (!offered || this.status === 'live') return Promise.resolve();
        if (this.starting) return this.starting;
        if (this.stopping) return this.stopping.then(() => this.start(how));
        const transport = how.way === 'cloudflare' ? this.deps.cloudflare! : this.deps.tor!(how.mode);
        this.way = how.way;
        this.torMode = how.way === 'tor' ? how.mode : null;
        this.program = transport.program;
        const run = this.run(++this.generation, transport);
        this.starting = run;
        void run.finally(() => {
            if (this.starting === run) this.starting = null;
        });
        return run;
    }

    /**
     * Ends the share straight away as far as anyone can see — the link goes
     * from the panel at once — and resolves once the tunnel's program and the
     * relay are gone. Every caller while it runs shares the one stop.
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
        this.way = null;
        this.torMode = null;
        this.program = null;
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

    private async run(generation: number, transport: ShareTransport): Promise<void> {
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
            const binary = await this.fetchBinary(transport);
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

            const tunnel = await transport.startTunnel(binary, relay.port, controller.signal);
            if (!current()) {
                await tunnel.stop();
                return;
            }
            // From here a stop owns the tunnel too, and its exit ends the share.
            this.tunnel = tunnel;
            void tunnel.exited.then(code => this.onTunnelExit(tunnel, code));

            this.set('checking');
            await transport.waitReachable(tunnel, relay.probe, controller.signal);
            if (!current()) return;
            this.url = `${tunnel.url}/rs2.cgi`;
            this.set('live');
            deps.log(`[share] live at ${this.url}`);
        } catch (err) {
            if (!current()) return;
            // Nothing is left running behind a failure. The tunnel is let go of
            // first, so the exit this causes is not reported as a second one.
            const tunnel = this.tunnel;
            this.tunnel = null;
            this.relay = null;
            this.fail(err instanceof Error ? err.message : String(err));
            void tunnel?.stop().catch(stopErr => deps.log(`[share] stopping the tunnel: ${String(stopErr)}`));
            void relay?.close().catch(() => undefined);
        } finally {
            if (this.controller === controller) this.controller = null;
        }
    }

    private fetchBinary(transport: ShareTransport): Promise<string> {
        const { program } = transport;
        let binary = this.binaries.get(program);
        if (!binary) {
            const started = transport.ensureBinary(fraction => this.onProgress(program, fraction));
            binary = started;
            this.binaries.set(program, started);
            const forget = (): void => {
                if (this.binaries.get(program) === started) this.binaries.delete(program);
            };
            void started.then(forget, forget);
        }
        return binary;
    }

    /** Every chunk reports, and a push per chunk would be thousands of them: windows hear of each whole percent. */
    private onProgress(program: ShareTransport['program'], fraction: number): void {
        if (this.status !== 'downloading' || this.program !== program) return;
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
        // A link still being checked has nothing left to check.
        this.controller?.abort();
        this.controller = null;
        const last = lastLine(tunnel.logs());
        this.fail(`The link closed unexpectedly (${tunnel.program} exited with code ${code})${last ? `: ${last}` : ''}`);
        // The program is gone, but what it left is not: Tor's stop removes its data folder.
        void tunnel.stop().catch(err => this.deps.log(`[share] stopping the tunnel: ${String(err)}`));
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

/** The program's last line, without cloudflared's timestamp and level. */
function lastLine(logs: string[]): string {
    const line = logs.at(-1);
    return line ? line.replace(/^\S+Z\s+[A-Z]{3}\s+/, '').trim() : '';
}

export interface ShareDialog {
    kind: 'download' | 'share';
    message: string;
    detail: string;
    /** The buttons that go ahead, in order; Cancel is added after them. */
    buttons: string[];
}

const TOR_MODE_BUTTONS = { full: 'Hide me', single: 'Faster' } as const;

/**
 * What to ask before a share, in order: the download when `download` names
 * one, then the share itself every time. Over Tor the share asks which mode,
 * the one picked last first.
 */
export function shareDialogs(opts: { way: ShareWay; download: { file: string; size: number } | null; cheats: boolean; lastTorMode: TorMode }): ShareDialog[] {
    const dialogs: ShareDialog[] = [];
    const tor = opts.way === 'tor';
    if (opts.download) {
        const megabytes = (opts.download.size / 1_000_000).toFixed(1);
        dialogs.push({
            kind: 'download',
            message: tor ? "Sharing over Tor needs Tor Project's Tor program." : "Sharing needs Cloudflare's tunnel program.",
            detail: `Downloads ${opts.download.file} (${megabytes} MB) from ${tor ? 'torproject.org' : "Cloudflare's GitHub"}, once.`,
            buttons: ['Download']
        });
    }
    const warning = `Anyone with the link can log in as any character, yours included. Only share it with people you trust.${opts.cheats ? ' Cheats work for them too.' : ''} The link ends when you stop sharing or quit.`;
    if (tor) {
        const other: TorMode = opts.lastTorMode === 'full' ? 'single' : 'full';
        dialogs.push({
            kind: 'share',
            message: 'Share your home server over Tor?',
            detail: `${warning} Hide me keeps your address hidden, and is slower. Faster hides only your friends. Friends need Tor Browser.`,
            buttons: [TOR_MODE_BUTTONS[opts.lastTorMode], TOR_MODE_BUTTONS[other]]
        });
    } else {
        dialogs.push({ kind: 'share', message: 'Share your home server with a link?', detail: warning, buttons: ['Share'] });
    }
    return dialogs;
}
