import { readFileSync } from 'node:fs';

/**
 * Textbook (unpadded) RSA decrypt of the login block, mirroring
 * engine/src/io/Packet.ts rsadec(). Used ONLY as a verification oracle:
 * it proves the seed we recover by observing Math.random is the real one.
 *
 * The shipping path must not depend on this — it needs the server's private
 * key, which only exists for servers we run.
 */

function bytesToBigInt(b: Uint8Array): bigint {
    let v = 0n;
    for (const byte of b) {
        v = (v << 8n) | BigInt(byte);
    }
    return v;
}

function bigIntToBytes(v: bigint): Buffer {
    if (v === 0n) return Buffer.from([0]);
    const out: number[] = [];
    while (v > 0n) {
        out.unshift(Number(v & 0xffn));
        v >>= 8n;
    }
    return Buffer.from(out);
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
    let result = 1n;
    let b = base % mod;
    let e = exp;
    while (e > 0n) {
        if (e & 1n) result = (result * b) % mod;
        b = (b * b) % mod;
        e >>= 1n;
    }
    return result;
}

export interface PrivateKeyParts {
    n: bigint;
    d: bigint;
}

interface Tlv {
    tag: number;
    valueStart: number;
    valueEnd: number;
}

function readTlv(buf: Buffer, pos: number): Tlv {
    const tag = buf[pos]!;
    let p = pos + 1;
    let len = buf[p]!;
    p += 1;
    if (len & 0x80) {
        const count = len & 0x7f;
        len = 0;
        for (let i = 0; i < count; i++) {
            len = (len << 8) | buf[p]!;
            p += 1;
        }
    }
    return { tag, valueStart: p, valueEnd: p + len };
}

function readDerInt(buf: Buffer, pos: number): { value: bigint; next: number } {
    const t = readTlv(buf, pos);
    return { value: bytesToBigInt(buf.subarray(t.valueStart, t.valueEnd)), next: t.valueEnd };
}

/**
 * Parse the PEM by hand rather than via node:crypto.
 *
 * Electron ships BoringSSL, which rejects these keys with BAD_E_VALUE because
 * the RuneScape convention uses a huge public exponent rather than 65537. Plain
 * Node's OpenSSL accepts them, so this only fails inside Electron — a genuinely
 * confusing difference if you hit it without knowing. Reading the DER directly
 * sidesteps the validation entirely; we only need n and d.
 */
export function loadPrivateKey(pemPath: string): PrivateKeyParts {
    const pem = readFileSync(pemPath, 'utf8');
    const der = Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64');
    const pkcs1 = pem.includes('BEGIN RSA PRIVATE KEY');

    let body = der;
    if (!pkcs1) {
        // PKCS#8: SEQUENCE { version, AlgorithmIdentifier, OCTET STRING { RSAPrivateKey } }
        const outer = readTlv(der, 0);
        let p = outer.valueStart;
        p = readTlv(der, p).valueEnd; // version
        p = readTlv(der, p).valueEnd; // AlgorithmIdentifier
        const octet = readTlv(der, p);
        body = der.subarray(octet.valueStart, octet.valueEnd);
    }

    // RSAPrivateKey ::= SEQUENCE { version, modulus, publicExponent, privateExponent, ... }
    const seq = readTlv(body, 0);
    let q = seq.valueStart;
    q = readTlv(body, q).valueEnd; // version
    const n = readDerInt(body, q);
    const e = readDerInt(body, n.next);
    const d = readDerInt(body, e.next);

    return { n: n.value, d: d.value };
}

export interface DecryptedLogin {
    magic: number;
    /** The four ISAAC seed words, as signed int32 (engine reads them with g4s). */
    seeds: [number, number, number, number];
}

export function decryptLoginBlock(rsaBlock: Uint8Array, key: PrivateKeyParts): DecryptedLogin {
    const plain = bigIntToBytes(modPow(bytesToBigInt(rsaBlock), key.d, key.n));
    return {
        magic: plain[0]!,
        seeds: [plain.readInt32BE(1), plain.readInt32BE(5), plain.readInt32BE(9), plain.readInt32BE(13)]
    };
}
