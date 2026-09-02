import Isaac from './isaac.ts';
import { SERVER_PROT, type PacketDef } from '../shared/proto/rev289.gen.ts';

/**
 * Splits the server->client byte stream into packets.
 *
 * Each packet's opcode byte is obfuscated by exactly one isaac.nextInt(), so
 * ISAAC must be consumed once per packet and never speculatively — that is why
 * the opcode is only decrypted once its byte is actually available, and the
 * pending state is carried across chunks.
 *
 * WebSocket message boundaries are not packet boundaries. Today the engine
 * happens to send one packet per frame, but the buffer never assumes it.
 *
 * Because every packet is length-delimited, a bug decoding a packet *body* can
 * never desync the stream — only an unknown opcode can, and that is reported
 * rather than guessed at.
 */

export interface FramedPacket {
    opcode: number;
    def: PacketDef;
    payload: Uint8Array;
}

export class FrameSplitter {
    private buf: Buffer = Buffer.alloc(0);
    private pos = 0;
    private pendingOpcode: number | null = null;
    private pendingDef: PacketDef | null = null;
    private pendingLen: number | null = null;

    desynced = false;
    desyncReason: string | null = null;
    packets = 0;

    // Node's strip-only type mode rejects parameter properties, and this file is
    // imported directly by the tests, so the fields are declared explicitly.
    private readonly isaac: Isaac;
    private readonly onPacket: (p: FramedPacket) => void;

    constructor(isaac: Isaac, onPacket: (p: FramedPacket) => void) {
        this.isaac = isaac;
        this.onPacket = onPacket;
    }

    push(bytes: Uint8Array): void {
        if (this.desynced) return;
        const remaining = this.buf.subarray(this.pos);
        this.buf = remaining.length === 0 ? Buffer.from(bytes) : Buffer.concat([remaining, bytes]);
        this.pos = 0;
        this.run();
        // Compact: everything before pos is consumed.
        if (this.pos > 0) {
            this.buf = this.buf.subarray(this.pos);
            this.pos = 0;
        }
    }

    private get available(): number {
        return this.buf.length - this.pos;
    }

    private run(): void {
        for (;;) {
            if (this.pendingOpcode === null) {
                if (this.available < 1) return;
                const raw = this.buf[this.pos]!;
                this.pos += 1;
                const opcode = (raw - this.isaac.nextInt()) & 0xff;
                const def = SERVER_PROT[opcode];
                if (!def) {
                    this.desynced = true;
                    this.desyncReason = `unknown opcode ${opcode} after ${this.packets} packets`;
                    return;
                }
                this.pendingOpcode = opcode;
                this.pendingDef = def;
                this.pendingLen = def.length >= 0 ? def.length : null;
            }

            if (this.pendingLen === null) {
                const need = this.pendingDef!.length === -1 ? 1 : 2;
                if (this.available < need) return;
                this.pendingLen = need === 1 ? this.buf[this.pos]! : this.buf.readUInt16BE(this.pos);
                this.pos += need;
            }

            if (this.available < this.pendingLen) return;
            const payload = Uint8Array.prototype.slice.call(this.buf, this.pos, this.pos + this.pendingLen);
            this.pos += this.pendingLen;
            this.packets += 1;
            this.onPacket({ opcode: this.pendingOpcode, def: this.pendingDef!, payload });
            this.pendingOpcode = null;
            this.pendingDef = null;
            this.pendingLen = null;
        }
    }
}

export type TrialOutcome = 'ok' | 'need-more' | 'fail';

/**
 * Test a candidate seed by framing the real stream with it.
 *
 * A wrong seed produces an unknown opcode almost immediately; requiring several
 * consecutive valid frames puts a false accept somewhere around 2^-60, so the
 * seed is verified rather than assumed.
 */
export function trialFrame(stream: Uint8Array, seed: number[], want: number): TrialOutcome {
    const isaac = new Isaac([...seed]);
    let framed = 0;
    const splitter = new FrameSplitter(isaac, () => {
        framed += 1;
    });
    splitter.push(stream);
    if (splitter.desynced) return 'fail';
    return framed >= want ? 'ok' : 'need-more';
}
