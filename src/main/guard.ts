export type NavigationDecision = 'allow' | 'open-external' | 'block' | 'retry';

/** The starting page's Retry button navigates to itself with ?retry=1; main answers it. */
function isRetry(target: string): boolean {
    try {
        const url = new URL(target);
        return url.protocol === 'file:' && url.pathname.endsWith('/starting.html') && url.searchParams.get('retry') === '1';
    } catch {
        return false;
    }
}

/**
 * What to do with a navigation the game page started itself.
 *
 * The page may never replace the game: the only way the game view changes
 * page is main calling loadURL. The one exception is the offline page, which
 * is ours, returning to the page main last asked for. The other exception is
 * the starting page asking for a retry, which is a request to main, not a
 * navigation. Targets on the game's own origin are dropped rather than sent
 * to the browser, since opening the game outside the client is never what
 * anyone wants; other web links go to the system browser; anything else is
 * dropped.
 */
export function decideNavigation(nav: { current: string; target: string; expected: string }): NavigationDecision {
    if (nav.current.startsWith('file:') && nav.target === nav.expected) return 'allow';
    if (nav.current.startsWith('file:') && isRetry(nav.target)) return 'retry';

    let target: URL;
    try {
        target = new URL(nav.target);
    } catch {
        return 'block';
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return 'block';

    let expectedOrigin: string | null = null;
    try {
        expectedOrigin = new URL(nav.expected).origin;
    } catch {
        expectedOrigin = null;
    }
    if (expectedOrigin !== null && target.origin === expectedOrigin) return 'block';
    return 'open-external';
}

/**
 * What to do with a navigation a reference page started.
 *
 * A page tab is a browser, so within the server's allowlist it simply browses:
 * LostHQ's guides link to each other constantly, and a clue page that could
 * not reach the next clue page would not be worth opening. Everything else
 * goes to the system browser rather than being followed here, where the
 * session is shared by every window's pages and nothing has asked the user
 * whether they meant to leave.
 *
 * The match is on `URL.host` — port included — and is exact. `hosts` has
 * always enumerated hosts one by one, and a wildcard would quietly hand a
 * whole domain to whoever can get a subdomain on it; the `local` entry's host
 * carries a port, which `hostname` would drop.
 */
export function decidePageNavigation(nav: { target: string; hosts: readonly string[] }): 'allow' | 'open-external' | 'block' {
    let target: URL;
    try {
        target = new URL(nav.target);
    } catch {
        return 'block';
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return 'block';
    const host = target.host.toLowerCase();
    return nav.hosts.some(allowed => allowed.toLowerCase() === host) ? 'allow' : 'open-external';
}
