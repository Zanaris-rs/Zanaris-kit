import Isaac from './isaac.ts';
import { FrameSplitter, trialFrame, type FramedPacket } from './frame.ts';
import { REVISION, SERVER_PROT } from '../shared/proto/rev289.gen.ts';

/**
 * Login handshake, seed recovery, and packet decoding for one game socket.
 *
 * The ISAAC seed is four int32 words. Two arrive in plaintext (the server's
 * 8-byte session seed). The other two are Math.floor(99999999 * Math.random())
 * from two adjacent draws in Client.login, which is why the RNG observer exists.
 *
 * Candidates are verified by framing the real stream with them, not assumed —
 * a wrong seed hits an unknown opcode almost immediately, so requiring several
 * consecutive valid frames makes a false accept vanishingly unlikely.
 *
 * Byte layout verified against engine/src/engine/World.ts:2130-2200.
 */

const RANDOM_MULTIPLIER = 99999999;
const DECRYPT_OFFSET = 50; // engine: seed[i] += 50 for the server's encryptor
const VERIFY_PACKETS = 6;
const MAX_CANDIDATES = 512;

const OPCODE_UPDATE_STAT = SERVER_PROT.findIndex(p => p?.name === 'UPDATE_STAT');
const OPCODE_LOGOUT = SERVER_PROT.findIndex(p => p?.name === 'LOGOUT');

export interface RngDump {
    baseSeq: number;
    seq: number;
    values: number[];
}

export interface SessionHooks {
    onStat: (skill: number, xp: number, level: number) => void;
    onLogout: () => void;
    /** Fired once the login block is seen — the moment to grab the RNG ring. */
    onNeedRandoms: () => void;
    onKeyed: (info: {
        revision: number;
        drawIndex: number;
        totalDraws: number;
        seeds: number[];
        /** For the local-only oracle cross-check; never required to decode. */
        rsaBlock: Uint8Array | null;
    }) => void;
    onDegraded: (reason: string) => void;
    log: (msg: string) => void;
}

type Phase = 'handshake' | 'keying' | 'keyed' | 'dead';

export class SessionDecoder {
    private readonly hooks: SessionHooks;
    private readonly up: number[] = [];
    private readonly down: number[] = [];
    private phase: Phase = 'handshake';

    private serverSeedHi: number | null = null;
    private serverSeedLo: number | null = null;
    private revision: number | null = null;
    private streamStart = -1;
    private randoms: RngDump | null = null;
    private rsaBlock: Uint8Array | null = null;
    private askedForRandoms = false;
    private splitter: FrameSplitter | null = null;

    constructor(hooks: SessionHooks) {
        this.hooks = hooks;
    }

    feed(dir: 'up' | 'down', bytes: Uint8Array): void {
        if (this.phase === 'dead') return;

        if (this.phase === 'keyed') {
            if (dir === 'down') this.splitter!.push(bytes);
            this.checkDesync();
            return;
        }

        for (const b of bytes) (dir === 'up' ? this.up : this.down).push(b);
        this.parseHandshake();
        this.tryKey();
    }

    /** Supplied asynchronously after onNeedRandoms fires. */
    setRandoms(dump: RngDump | null): void {
        if (!dump) {
            this.fail('RNG observer was not installed');
            return;
        }
        this.randoms = dump;
        this.tryKey();
    }

    private fail(reason: string): void {
        this.phase = 'dead';
        this.hooks.onDegraded(reason);
    }

    private checkDesync(): void {
        if (this.splitter?.desynced) {
            this.fail(this.splitter.desyncReason ?? 'stream desync');
        }
    }

    private parseHandshake(): void {
        // Client sends [16|18][len][255][u16 revision] — the revision is plaintext.
        if (this.revision === null && this.up.length >= 7) {
            const opcode = this.up[2]!;
            if (opcode !== 16 && opcode !== 18) {
                this.fail(`unexpected login opcode ${opcode}`);
                return;
            }
            if (this.up[4] !== 255) {
                this.fail('login block layout mismatch');
                return;
            }
            this.revision = (this.up[5]! << 8) | this.up[6]!;
            if (this.revision !== REVISION) {
                this.fail(`server is revision ${this.revision}, decoder is ${REVISION}`);
                return;
            }
            // [255][u16 rev][info][36 crc][rsaLen][rsa...] — captured so a local
            // private key can independently confirm the recovered seed.
            if (this.rsaBlock === null && this.up.length >= 45) {
                const rsaLen = this.up[44]!;
                if (this.up.length >= 45 + rsaLen) {
                    this.rsaBlock = Uint8Array.from(this.up.slice(45, 45 + rsaLen));
                }
            }

            if (!this.askedForRandoms) {
                this.askedForRandoms = true;
                this.hooks.onNeedRandoms();
            }
        }

        if (this.revision !== null && this.rsaBlock === null && this.up.length >= 45) {
            const rsaLen = this.up[44]!;
            if (this.up.length >= 45 + rsaLen) {
                this.rsaBlock = Uint8Array.from(this.up.slice(45, 45 + rsaLen));
            }
        }

        // Server sends 8 ignore bytes, a response code, then the 8-byte seed.
        if (this.serverSeedHi === null && this.down.length >= 17) {
            if (this.down[8] !== 0) {
                this.fail(`server refused login with code ${this.down[8]}`);
                return;
            }
            const seed = Buffer.from(this.down.slice(9, 17));
            this.serverSeedHi = seed.readUInt32BE(0) | 0;
            this.serverSeedLo = seed.readUInt32BE(4) | 0;
        }

        // Then the login reply, and the encrypted stream begins.
        if (this.streamStart < 0 && this.serverSeedHi !== null && this.down.length >= 18) {
            const reply = this.down[17]!;
            if (reply === 2) {
                if (this.down.length < 20) return;
                this.streamStart = 20; // [staffLevel][mouseTracking] follow
            } else if (reply === 15) {
                this.streamStart = 18; // reconnect: straight into the stream
            } else {
                this.fail(`login rejected with code ${reply}`);
            }
        }
    }

    private tryKey(): void {
        if (this.phase !== 'handshake') return;
        if (this.streamStart < 0 || this.serverSeedHi === null || !this.randoms) return;

        const stream = Uint8Array.from(this.down.slice(this.streamStart));
        if (stream.length < 24) return; // not enough to verify against yet

        const values = this.randoms.values;
        let sawNeedMore = false;

        // The two draws are the last two before the login block goes out, so
        // scan backwards — the first candidate is almost always the answer.
        const limit = Math.max(0, values.length - 1 - MAX_CANDIDATES);
        for (let i = values.length - 2; i >= limit; i--) {
            const seeds = [
                Math.floor(RANDOM_MULTIPLIER * values[i]!) | 0,
                Math.floor(RANDOM_MULTIPLIER * values[i + 1]!) | 0,
                this.serverSeedHi,
                this.serverSeedLo!
            ];
            const decrypt = seeds.map(w => (w + DECRYPT_OFFSET) | 0);
            const outcome = trialFrame(stream, decrypt, VERIFY_PACKETS);
            if (outcome === 'ok') {
                this.key(decrypt, stream, this.randoms.baseSeq + i, seeds);
                return;
            }
            if (outcome === 'need-more') sawNeedMore = true;
        }

        if (!sawNeedMore) {
            this.fail(`seed not recoverable from ${values.length} observed draws`);
        }
    }

    private key(decryptSeed: number[], stream: Uint8Array, drawIndex: number, seeds: number[]): void {
        this.splitter = new FrameSplitter(new Isaac(decryptSeed), p => this.onPacket(p));
        this.phase = 'keyed';
        this.hooks.onKeyed({
            revision: this.revision!,
            drawIndex,
            totalDraws: this.randoms!.seq,
            seeds,
            rsaBlock: this.rsaBlock
        });
        this.splitter.push(stream);
        this.checkDesync();
    }

    private onPacket(p: FramedPacket): void {
        if (p.opcode === OPCODE_UPDATE_STAT) {
            const buf = Buffer.from(p.payload);
            this.hooks.onStat(buf.readUInt8(0), buf.readUInt32BE(1), buf.readUInt8(5));
        } else if (p.opcode === OPCODE_LOGOUT) {
            this.hooks.onLogout();
        }
    }
}
