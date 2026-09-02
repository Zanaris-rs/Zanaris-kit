/**
 * Login-handshake parser.
 *
 * Reconstructs the byte layout of the pre-ISAAC exchange from the tapped game
 * socket, so the spike can extract the server's plaintext session seed and the
 * RSA login block.
 *
 *   c2s  [14][nameHashNibble]
 *   s2c  8 ignore bytes, [responseCode], [8-byte session seed]
 *   c2s  [16|18][len][255][u16 revision][info][36 crc][rsaLen][rsa...]
 *   s2c  [responseCode]  (2 = success, then [staffLevel][mouseTracking])
 *
 * Layout verified against engine/src/engine/World.ts:2130-2200.
 */

export interface Handshake {
    /** seed[2] — high word of the server's 8-byte session seed, plaintext. */
    serverSeedHi: number;
    /** seed[3] — low word. */
    serverSeedLo: number;
    revision: number;
    reconnect: boolean;
    rsaBlock: Uint8Array;
}

const S2C_SEED_OFFSET = 9; // 8 ignore bytes + 1 response code
const C2S_LOGIN_OFFSET = 2; // after [14][nameHashNibble]

export class HandshakeReader {
    private readonly up: number[] = [];
    private readonly down: number[] = [];
    private done = false;

    constructor(private readonly onComplete: (h: Handshake) => void, private readonly log: (m: string) => void) {}

    feed(dir: 'up' | 'down', bytes: Uint8Array): void {
        if (this.done) return;
        const sink = dir === 'up' ? this.up : this.down;
        for (const b of bytes) sink.push(b);
        this.tryParse();
    }

    private tryParse(): void {
        // Need the server seed (17 bytes down) and a complete login block up.
        if (this.down.length < S2C_SEED_OFFSET + 8) return;
        if (this.up.length < C2S_LOGIN_OFFSET + 45) return;

        const responseCode = this.down[8]!;
        if (responseCode !== 0) {
            this.log(`[seed] server refused login with code ${responseCode} — no seed exchanged`);
            this.done = true;
            return;
        }

        const seedBytes = Buffer.from(this.down.slice(S2C_SEED_OFFSET, S2C_SEED_OFFSET + 8));
        const serverSeedHi = seedBytes.readUInt32BE(0) | 0;
        const serverSeedLo = seedBytes.readUInt32BE(4) | 0;

        const up = Buffer.from(this.up);
        const opcode = up[C2S_LOGIN_OFFSET]!;
        if (opcode !== 16 && opcode !== 18) {
            this.log(`[seed] unexpected login opcode ${opcode} at offset ${C2S_LOGIN_OFFSET} — layout mismatch`);
            this.done = true;
            return;
        }

        let p = C2S_LOGIN_OFFSET + 2; // skip opcode + length
        const marker = up[p]!;
        p += 1;
        if (marker !== 255) {
            this.log(`[seed] expected 255 revision marker, got ${marker} — layout mismatch`);
            this.done = true;
            return;
        }
        const revision = up.readUInt16BE(p);
        p += 2;
        p += 1; // info byte (lowmem flag)
        p += 36; // 9 CRCs

        const rsaLen = up[p]!;
        p += 1;
        if (up.length < p + rsaLen) return; // login block still arriving

        const rsaBlock = up.subarray(p, p + rsaLen);
        this.done = true;
        this.onComplete({ serverSeedHi, serverSeedLo, revision, reconnect: opcode === 18, rsaBlock });
    }
}
