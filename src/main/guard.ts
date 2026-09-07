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
