/**
 * ISAAC CSPRNG — port of engine/src/io/Isaac.ts.
 *
 * Server->client opcodes are obfuscated by adding one nextInt() per packet, so
 * this must be bit-exact or the stream desyncs permanently. Int32Array storage
 * is load-bearing: the decrypt seed is the login seed with 50 added per word,
 * which can push a word past 2^31, and both the engine and the client rely on
 * the same int32 wraparound. isaac.test.ts checks this against the engine's own
 * implementation rather than against a fixture I wrote.
 */
export default class Isaac {
    private count = 0;
    private readonly rsl = new Int32Array(256);
    private readonly mem = new Int32Array(256);
    private a = 0;
    private b = 0;
    private c = 0;

    constructor(seed: number[] = [0, 0, 0, 0]) {
        for (let i = 0; i < seed.length; i++) {
            this.rsl[i] = seed[i]!;
        }
        this.init();
    }

    // prettier-ignore
    private init(): void {
        let a = 0x9e3779b9, b = 0x9e3779b9, c = 0x9e3779b9, d = 0x9e3779b9,
            e = 0x9e3779b9, f = 0x9e3779b9, g = 0x9e3779b9, h = 0x9e3779b9;

        const mix = (): void => {
            a ^= b << 11; d += a; b += c;
            b ^= c >>> 2;  e += b; c += d;
            c ^= d << 8;   f += c; d += e;
            d ^= e >>> 16; g += d; e += f;
            e ^= f << 10;  h += e; f += g;
            f ^= g >>> 4;  a += f; g += h;
            g ^= h << 8;   b += g; h += a;
            h ^= a >>> 9;  c += h; a += b;
        };

        for (let i = 0; i < 4; i++) mix();

        for (let i = 0; i < 256; i += 8) {
            a += this.rsl[i]!;     b += this.rsl[i + 1]!;
            c += this.rsl[i + 2]!; d += this.rsl[i + 3]!;
            e += this.rsl[i + 4]!; f += this.rsl[i + 5]!;
            g += this.rsl[i + 6]!; h += this.rsl[i + 7]!;
            mix();
            this.mem[i] = a;     this.mem[i + 1] = b;
            this.mem[i + 2] = c; this.mem[i + 3] = d;
            this.mem[i + 4] = e; this.mem[i + 5] = f;
            this.mem[i + 6] = g; this.mem[i + 7] = h;
        }

        for (let i = 0; i < 256; i += 8) {
            a += this.mem[i]!;     b += this.mem[i + 1]!;
            c += this.mem[i + 2]!; d += this.mem[i + 3]!;
            e += this.mem[i + 4]!; f += this.mem[i + 5]!;
            g += this.mem[i + 6]!; h += this.mem[i + 7]!;
            mix();
            this.mem[i] = a;     this.mem[i + 1] = b;
            this.mem[i + 2] = c; this.mem[i + 3] = d;
            this.mem[i + 4] = e; this.mem[i + 5] = f;
            this.mem[i + 6] = g; this.mem[i + 7] = h;
        }

        this.isaac();
        this.count = 256;
    }

    private isaac(): void {
        this.c++;
        this.b += this.c;

        for (let i = 0; i < 256; i++) {
            const x = this.mem[i]!;

            switch (i & 3) {
                case 0: this.a ^= this.a << 13; break;
                case 1: this.a ^= this.a >>> 6; break;
                case 2: this.a ^= this.a << 2; break;
                case 3: this.a ^= this.a >>> 16; break;
            }

            this.a += this.mem[(i + 128) & 0xff]!;

            const y = (this.mem[i] = this.mem[(x >>> 2) & 0xff]! + this.a + this.b);
            this.rsl[i] = this.b = this.mem[((y >>> 8) >>> 2) & 0xff]! + x;
        }
    }

    nextInt(): number {
        if (this.count-- === 0) {
            this.isaac();
            this.count = 255;
        }
        return this.rsl[this.count]!;
    }
}
