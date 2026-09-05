/** A server the launcher can open. `id` names the window and its storage partition. */
export interface ServerDef {
    id: string;
    name: string;
    url: string;
}

/**
 * The built-in list. Each is a different flavour of 04scape server: our own
 * fleet, upstream Lost City, and Lost City Labs — the point of the wrapper is
 * that one client can open any of them, at the same time.
 */
export const DEFAULT_SERVERS: readonly ServerDef[] = [
    { id: 'zanaris-w1', name: 'Zanaris — World 1', url: 'https://w1.04.zanaris.rs/rs2.cgi?lowmem=1' },
    {
        id: 'lostcity-w5',
        name: 'Lost City — World 5',
        url: 'https://w5-2004.lostcity.rs/rs2.cgi?plugin=0&world=5&lowmem=1'
    },
    { id: 'lostcitylabs-w1', name: 'Lost City Labs — World 1', url: 'https://www.lostcitylabs.com/play/world-1/' },
    { id: 'local', name: 'Local server', url: 'http://127.0.0.1:8888/rs2.cgi?lowmem=1' }
];

export type ParsedUrl = { ok: true; url: string } | { ok: false; error: string };

/**
 * Normalises a typed address into an absolute http(s) URL. A missing scheme is
 * read as https, since that is what every hosted server speaks; anything that
 * is not a web URL is rejected so a window can never be pointed at file: or
 * javascript: content.
 */
export function parseServerUrl(input: string): ParsedUrl {
    const text = input.trim();
    if (!text) return { ok: false, error: 'Enter a server address.' };

    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text);
    let url: URL;
    try {
        url = new URL(hasScheme ? text : `https://${text}`);
    } catch {
        return { ok: false, error: `Not a valid address: ${text}` };
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, error: `Only http and https servers are supported, not ${url.protocol.slice(0, -1)}.` };
    }
    if (!url.hostname) return { ok: false, error: 'The address needs a host name.' };

    return { ok: true, url: url.href };
}

export function originOf(url: string): string {
    return new URL(url).origin;
}

/**
 * One persistent partition per server, so logins, cookies, client prefs and
 * the IndexedDB asset cache never bleed between servers and survive relaunch.
 */
export function partitionFor(id: string): string {
    return `persist:server:${id.replace(/[^a-z0-9._-]+/gi, '-')}`;
}

/** Builds a list entry for a user-typed URL. The id is a slug of the URL, so the same address always maps to the same window. */
export function customServer(url: string): ServerDef {
    const u = new URL(url);
    const slug = `${u.host}${u.pathname}${u.search}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    return { id: `custom:${slug}`, name: u.host, url: u.href };
}
