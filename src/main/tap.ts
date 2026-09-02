import type { WebContents } from 'electron';

/**
 * Observe-only WebSocket tap via the Chrome DevTools Protocol.
 *
 * This injects nothing into the page. The client that runs is byte-for-byte the
 * client the server served, and no wrapper sits in the data path — CDP's Network
 * domain is a passive observer. That matters: the whole point is to prove we can
 * attach without modifying the client.
 *
 * v1 counts frames and bytes only. No parsing, no decoding, no ISAAC.
 */

type SocketKind = 'game' | 'ondemand' | 'unknown';

interface SocketStat {
    id: string;
    url: string;
    kind: SocketKind;
    txFrames: number;
    rxFrames: number;
    txBytes: number;
    rxBytes: number;
}

interface CdpFrame {
    requestId: string;
    response?: { opcode?: number; payloadData?: string };
}

interface CdpCreated {
    requestId: string;
    url: string;
}

// The client's very first byte identifies the socket:
//   14 -> game login, 15 -> on-demand cache.
// engine/src/engine/World.ts:2103,2254
const OPCODE_GAME_LOGIN = 14;
const OPCODE_ONDEMAND = 15;

function payloadLength(response: CdpFrame['response']): number {
    const data = response?.payloadData;
    if (!data) return 0;
    // opcode 1 = text, 2 = binary (base64-encoded by CDP)
    if (response?.opcode === 1) return Buffer.byteLength(data, 'utf8');
    return Buffer.from(data, 'base64').length;
}

function firstByte(response: CdpFrame['response']): number | null {
    const data = response?.payloadData;
    if (!data || response?.opcode === 1) return null;
    const buf = Buffer.from(data, 'base64');
    return buf.length > 0 ? buf[0]! : null;
}

export class WebSocketTap {
    private readonly sockets = new Map<string, SocketStat>();
    private reportTimer: NodeJS.Timeout | null = null;
    private attached = false;

    constructor(
        private readonly wc: WebContents,
        private readonly log: (msg: string) => void
    ) {}

    attach(): void {
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
            this.onCdpMessage(method, params);
        });

        this.wc.debugger
            .sendCommand('Network.enable')
            .then(() => this.log('[tap] attached — Network domain enabled, observe-only'))
            .catch((err: Error) => this.log(`[tap] Network.enable failed: ${err.message}`));

        this.reportTimer = setInterval(() => this.report(), 3000);
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

    private onCdpMessage(method: string, params: unknown): void {
        switch (method) {
            case 'Network.webSocketCreated': {
                const p = params as CdpCreated;
                this.sockets.set(p.requestId, {
                    id: p.requestId,
                    url: p.url,
                    kind: 'unknown',
                    txFrames: 0,
                    rxFrames: 0,
                    txBytes: 0,
                    rxBytes: 0
                });
                this.log(`[tap] socket opened: ${p.url}`);
                break;
            }
            case 'Network.webSocketFrameSent': {
                const p = params as CdpFrame;
                const s = this.sockets.get(p.requestId);
                if (!s) break;
                if (s.kind === 'unknown') {
                    const b = firstByte(p.response);
                    if (b === OPCODE_GAME_LOGIN) {
                        s.kind = 'game';
                        this.log('[tap] socket classified: game (first client byte 14)');
                    } else if (b === OPCODE_ONDEMAND) {
                        s.kind = 'ondemand';
                        this.log('[tap] socket classified: ondemand (first client byte 15)');
                    }
                }
                s.txFrames++;
                s.txBytes += payloadLength(p.response);
                break;
            }
            case 'Network.webSocketFrameReceived': {
                const p = params as CdpFrame;
                const s = this.sockets.get(p.requestId);
                if (!s) break;
                s.rxFrames++;
                s.rxBytes += payloadLength(p.response);
                break;
            }
            case 'Network.webSocketClosed': {
                const p = params as { requestId: string };
                const s = this.sockets.get(p.requestId);
                if (s) this.log(`[tap] socket closed: ${s.kind} (${s.url})`);
                break;
            }
        }
    }

    private report(): void {
        if (this.sockets.size === 0) return;
        const lines = [...this.sockets.values()].map(
            s =>
                `  ${s.kind.padEnd(8)} tx ${String(s.txFrames).padStart(6)} frames / ${String(s.txBytes).padStart(9)} B` +
                `   rx ${String(s.rxFrames).padStart(6)} frames / ${String(s.rxBytes).padStart(9)} B`
        );
        this.log(`[tap] ${this.sockets.size} socket(s)\n${lines.join('\n')}`);
    }
}
