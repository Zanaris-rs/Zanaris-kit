/**
 * Main-world Math.random observer.
 *
 * Two of the four ISAAC seed words are drawn by two adjacent Math.random()
 * calls inside a single synchronous expression in Client.login. Recording the
 * RNG output through the login window lets us recover them without the
 * server's private key — which is what makes this work against servers we
 * don't control.
 *
 * Strictly pass-through: the original is called exactly once per invocation and
 * its return value is handed back unmodified. Nothing else is touched.
 *
 * Injected via CDP Page.addScriptToEvaluateOnNewDocument, which runs in the
 * page's main world before any page script — so no preload is needed and
 * Electron's isolated-world boundary never comes into it.
 */
export const RNG_PROBE_SOURCE = `(() => {
    if (window.__swiftkitRng) return;
    const orig = Math.random;
    const N = 65536;
    const ring = new Float64Array(N);
    let seq = 0;
    const patched = function random() {
        const v = orig();
        ring[seq % N] = v;
        seq++;
        return v;
    };
    window.__swiftkitRng = {
        installed: true,
        get seq() { return seq; },
        patched: () => Math.random === patched,
        dump(tail) {
            const want = tail || 16384;
            const start = Math.max(0, seq - Math.min(want, N));
            const values = [];
            for (let i = start; i < seq; i++) values.push(ring[i % N]);
            return { baseSeq: start, seq, values };
        },
        disarm() { Math.random = orig; return seq; }
    };
    Math.random = patched;
})();`;

export interface RngDump {
    baseSeq: number;
    seq: number;
    values: number[];
}

/** The client computes each seed word as Math.floor(99999999 * Math.random()). */
export const RANDOM_MULTIPLIER = 99999999;

export function seedWordFromRandom(r: number): number {
    return Math.floor(RANDOM_MULTIPLIER * r) | 0;
}

export interface PairSearchResult {
    found: boolean;
    /** Absolute sequence index of the first of the two adjacent draws. */
    index: number | null;
    /** How many consecutive pairs sat in the search window. */
    candidates: number;
}

/**
 * The two client seed words come from adjacent draws, so only consecutive
 * pairs are candidates — O(window), not O(window^2).
 */
export function findAdjacentPair(dump: RngDump, want0: number, want1: number): PairSearchResult {
    const v = dump.values;
    for (let i = 0; i + 1 < v.length; i++) {
        if (seedWordFromRandom(v[i]!) === want0 && seedWordFromRandom(v[i + 1]!) === want1) {
            return { found: true, index: dump.baseSeq + i, candidates: Math.max(v.length - 1, 0) };
        }
    }
    return { found: false, index: null, candidates: Math.max(v.length - 1, 0) };
}
