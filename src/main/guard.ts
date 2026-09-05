export type NavigationDecision = 'allow' | 'open-external' | 'block';

/**
 * What to do with a navigation the game page started itself.
 *
 * The page may never replace the game: the only way the game view changes
 * page is main calling loadURL. The one exception is the offline page, which
 * is ours, returning to the page main last asked for. Targets on the game's
 * own origin are dropped rather than sent to the browser, since opening the
 * game outside the client is never what anyone wants; other web links go to
 * the system browser; anything else is dropped.
 */
export function decideNavigation(nav: { current: string; target: string; expected: string }): NavigationDecision {
    if (nav.current.startsWith('file:') && nav.target === nav.expected) return 'allow';

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
