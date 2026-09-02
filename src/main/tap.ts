import type { WebContents } from 'electron';
import { RNG_PROBE_SOURCE } from './rngProbe';

/**
 * Observe-only instrumentation via the Chrome DevTools Protocol.
 *
 * Two jobs, one mechanism:
 *   - Network domain    -> mirror WebSocket frames (no wrapper in the data path)
 *   - Page domain       -> inject the Math.random observer at document_start,
 *                          in the main world, before any page script runs
 *
 * Nothing is injected into the page except the RNG observer, which is strictly
 * pass-through. The client bytes are untouched.
 */

type SocketKind = 'game' | 'ondemand' | 'unknown';
export type Direction = 'up' | 'down';

interface SocketStat {
    id: string;
    url: string;
    kind: SocketKind;
    txFrames: number;
    rxFrames: number;
    txBytes: number;
    rxBytes: number;
    closed: boolean;
    /** Frames held until the socket is classified, then replayed. */
    pending: Array<{ dir: Direction; bytes: Uint8Array }>;
}

interface CdpFrame {
    requestId: string;
    response?: { opcode?: number; payloadData?: string };
}

// The client's first byte identifies the socket. engine/src/engine/World.ts:2103,2254
const OPCODE_GAME_LOGIN = 14;
const OPCODE_ONDEMAND = 15;

function frameBytes(response: CdpFrame['response']): Uint8Array {
    const data = response?.payloadData;
    if (!data) return new Uint8Array(0);
    if (response?.opcode === 1) return new Uint8Array(Buffer.from(data, 'utf8'));
    return new Uint8Array(Buffer.from(data, 'base64'));
}

export class WebSocketTap {
    private readonly sockets = new Map<string, SocketStat>();
    private reportTimer: NodeJS.Timeout | null = null;
    private attached = false;

    /** Called for every game-socket frame, in order, once the socket is classified. */
    onGameFrame: ((dir: Direction, bytes: Uint8Array) => void) | null = null;

    /** Fired when a new game socket opens, so decode state can be reset. */
    onGameSocketOpen: (() => void) | null = null;

    constructor(
        private readonly wc: WebContents,
        private readonly log: (msg: string) => void,
        private readonly injectRngProbe: boolean
    ) {}

    /** Snapshot of the game socket, for the sidebar's connection panel. */
    gameStats(): { open: boolean; txFrames: number; rxFrames: number; txBytes: number; rxBytes: number } {
        for (const s of this.sockets.values()) {
            if (s.kind === 'game') {
                return {
                    open: !s.closed,
                    txFrames: s.txFrames,
                    rxFrames: s.rxFrames,
                    txBytes: s.txBytes,
                    rxBytes: s.rxBytes
                };
            }
        }
        return { open: false, txFrames: 0, rxFrames: 0, txBytes: 0, rxBytes: 0 };
    }

    async attach(): Promise<void> {
        try {
            this.wc.debugger.attach('1.3');
        } catch (err) {
            this.log(`[tap] FAILED to attach debugger: ${(err as Error).message}`);
            return;
        }
        this.attached = true;

        this.wc.debugger.on('detach', (_e, reason) => {
            this.attached = false;
            this.log(`[tap] debugger detached: ${reason}`);
        });
        this.wc.debugger.on('message', (_event, method, params) => {
            try {
                this.onCdpMessage(method, params);
            } catch (err) {
                this.log(`[tap] handler error (swallowed): ${(err as Error).message}`);
            }
        });

        await this.wc.debugger.sendCommand('Network.enable');
        this.log('[tap] Network domain enabled — frame mirroring active');

        if (this.injectRngProbe) {
            await this.wc.debugger.sendCommand('Page.enable');
            await this.wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
                source: RNG_PROBE_SOURCE
            });
            this.log('[tap] RNG probe registered for document_start (main world)');
        }

        this.reportTimer = setInterval(() => this.report(), 5000);
    }

    detach(): void {
        if (this.reportTimer) {
            clearInterval(this.reportTimer);
            this.reportTimer = null;
        }
        if (this.attached) {
            try {
                this.wc.debugger.detach();
            } catch {
                /* already gone */
            }
        }
    }

    private classify(s: SocketStat, first: number): void {
        if (first === OPCODE_GAME_LOGIN) {
            s.kind = 'game';
            this.log('[tap] socket classified: game (first client byte 14)');
        } else if (first === OPCODE_ONDEMAND) {
            s.kind = 'ondemand';
            this.log('[tap] socket classified: ondemand (first client byte 15) — ignored');
        } else {
            return;
        }
        if (s.kind === 'game') {
            this.onGameSocketOpen?.();
            for (const f of s.pending) this.onGameFrame?.(f.dir, f.bytes);
        }
        s.pending.length = 0;
    }

    private record(s: SocketStat, dir: Direction, bytes: Uint8Array): void {
        if (s.kind === 'unknown') {
            s.pending.push({ dir, bytes });
        } else if (s.kind === 'game') {
            this.onGameFrame?.(dir, bytes);
        }
    }

    private onCdpMessage(method: string, params: unknown): void {
        switch (method) {
            case 'Network.webSocketCreated': {
                const p = params as { requestId: string; url: string };
                this.sockets.set(p.requestId, {
                    id: p.requestId,
                    url: p.url,
                    kind: 'unknown',
                    txFrames: 0,
                    rxFrames: 0,
                    txBytes: 0,
                    rxBytes: 0,
                    closed: false,
                    pending: []
                });
                this.log(`[tap] socket opened: ${p.url}`);
                break;
            }
            case 'Network.webSocketFrameSent': {
                const p = params as CdpFrame;
                const s = this.sockets.get(p.requestId);
                if (!s) break;
                const bytes = frameBytes(p.response);
                if (s.kind === 'unknown' && bytes.length > 0) this.classify(s, bytes[0]!);
                s.txFrames++;
                s.txBytes += bytes.length;
                this.record(s, 'up', bytes);
                break;
            }
            case 'Network.webSocketFrameReceived': {
                const p = params as CdpFrame;
                const s = this.sockets.get(p.requestId);
                if (!s) break;
                const bytes = frameBytes(p.response);
                s.rxFrames++;
                s.rxBytes += bytes.length;
                this.record(s, 'down', bytes);
                break;
            }
            case 'Network.webSocketClosed': {
                const p = params as { requestId: string };
                const s = this.sockets.get(p.requestId);
                if (s) {
                    s.closed = true;
                    this.log(`[tap] socket closed: ${s.kind}`);
                }
                break;
            }
        }
    }

    private report(): void {
        if (this.sockets.size === 0) return;
        const lines = [...this.sockets.values()].map(
            s =>
                `  ${s.kind.padEnd(8)} tx ${String(s.txFrames).padStart(6)} / ${String(s.txBytes).padStart(9)} B` +
                `   rx ${String(s.rxFrames).padStart(6)} / ${String(s.rxBytes).padStart(9)} B`
        );
        this.log(`[tap] ${this.sockets.size} socket(s)\n${lines.join('\n')}`);
    }
}
