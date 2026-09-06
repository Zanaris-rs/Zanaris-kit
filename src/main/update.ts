/** The newest published release on GitHub, and whether it is newer than this build. */
export interface LatestRelease {
    latest: string;
    url: string;
    newer: boolean;
}

export const RELEASES_LATEST = 'https://api.github.com/repos/Zanaris-rs/swiftkit/releases/latest';

/** `v0.2.0` or `0.2.0` to `[0, 2, 0]`; anything else, including prereleases, to null. */
export function parseVersion(text: string): number[] | null {
    const digits = /^v?(\d+(?:\.\d+)*)$/.exec(text.trim())?.[1];
    return digits === undefined ? null : digits.split('.').map(Number);
}

/** Negative when `a` is older than `b`, zero when equal, positive when newer; null when either does not parse. */
export function compareVersions(a: string, b: string): number | null {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    if (!pa || !pb) return null;
    const length = Math.max(pa.length, pb.length);
    for (let i = 0; i < length; i++) {
        const x = pa[i] ?? 0;
        const y = pb[i] ?? 0;
        if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
}

/**
 * Reads the body of GitHub's releases/latest endpoint. Null for anything that
 * is not a release with a parseable tag: an error body, a rate-limit message,
 * a tag that is not a version. Never throws; the caller swallows everything.
 *
 * The url ends up at the OS handler, so its scheme is checked here rather than
 * trusted: a release page is always https, and remote data must not choose a
 * scheme of its own — file:// would open a local path.
 */
export function checkLatest(body: unknown, current: string): LatestRelease | null {
    if (typeof body !== 'object' || body === null) return null;
    const { tag_name: tag, html_url: url } = body as Record<string, unknown>;
    if (typeof tag !== 'string' || typeof url !== 'string') return null;
    if (!url.startsWith('https://')) return null;
    const order = compareVersions(current, tag);
    if (order === null) return null;
    return { latest: tag, url, newer: order < 0 };
}
