export type NavigationDecision = 'allow' | 'open-external' | 'block' | 'retry' | 'download';

/**
 * The starting page's buttons navigate to the page itself with a request in
 * the query — ?retry=1 for Try again, ?download=1 for Download — and main
 * answers the request instead of letting the page load.
 */
function isStartingRequest(target: string, request: 'retry' | 'download'): boolean {
    try {
        const url = new URL(target);
        return url.protocol === 'file:' && url.pathname.endsWith('/starting.html') && url.searchParams.get(request) === '1';
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
 * the starting page asking for a retry or a download, each a request to main,
 * not a navigation. Targets on the game's own origin are dropped rather than
 * sent to the browser, since opening the game outside the client is never
 * what anyone wants; other web links go to the system browser; anything else
 * is dropped.
 */
export function decideNavigation(nav: { current: string; target: string; expected: string }): NavigationDecision {
    if (nav.current.startsWith('file:') && nav.target === nav.expected) return 'allow';
    if (nav.current.startsWith('file:') && isStartingRequest(nav.target, 'retry')) return 'retry';
    if (nav.current.startsWith('file:') && isStartingRequest(nav.target, 'download')) return 'download';

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

/**
 * What to do with a navigation one of the kit's own pages started: a game
 * window's shell, or Settings.
 *
 * Both carry the preload, and main answers its calls by `event.sender`, so
 * whatever a navigation brought into the view would be answered as that
 * window. Both show writing that is not the kit's, too: chat's lines are
 * strangers', and Settings' names and notes come from a servers.json people
 * edit by hand. React renders it all as text; this is the line behind that.
 *
 * So nothing replaces the page but the page itself. A reload keeps the URL it
 * has, and in development it is how Vite's full reload arrives, so it is let
 * through. Anything else is dropped, not sent to the system browser: the
 * shell's one kind of link, chat's, already goes there through
 * `chat.openLink`, which main checks.
 */
export function decideShellNavigation(nav: { current: string; target: string }): 'allow' | 'block' {
    return nav.target === nav.current ? 'allow' : 'block';
}

/**
 * Whether a game or reference page may have a web permission it asked for.
 *
 * Electron grants every permission a session has no handler for, without a
 * prompt, so the answer here is no unless there is a reason. There are two,
 * both a game's: the full-screen button in the controls strip under the
 * client, which worked before there was a handler and must keep working, and
 * copying to the clipboard, which puts only what the browser has sanitised
 * there and reads nothing back. Everything else a browser would ask about is
 * refused:
 * reading the clipboard, where players paste passwords; notifications that
 * would appear as the kit's; the camera, microphone and location, which the
 * OS would ask for in the kit's name; and `openExternal`, which is how a
 * frame could hand a URL of any scheme to whatever app the OS has for it.
 *
 * Reference pages get nothing, as they always have: they are somebody
 * else's pages, shown with the web and nothing more.
 */
export function allowPermission(permission: string, view: 'game' | 'page'): boolean {
    return view === 'game' && (permission === 'fullscreen' || permission === 'clipboard-sanitized-write');
}

/**
 * How recently the player must have pressed something in a view for a link
 * it opens to be theirs. Chromium's own: a press lends a page five seconds of
 * "the user did this", long enough for a click that fetches something first.
 * One press lends it once (`mayOpenBrowser`'s caller spends it), so the five
 * seconds are not a window for a page to open as many tabs as it likes.
 */
export const PRESS_MS = 5_000;

/**
 * The same, for a redirect: a link pressed to a page on the allowlist that
 * the server then sends somewhere else arrives as a redirect after the
 * request's round trip, not straight after the press.
 */
export const REDIRECT_PRESS_MS = 10_000;

/** Whether an `input-event` is the player pressing something, which is what lets a view open the browser. Movement and scrolling are not. */
export function isPress(type: string): boolean {
    return type === 'mouseDown' || type === 'mouseUp' || type === 'rawKeyDown' || type === 'keyDown' || type === 'char' || type === 'gestureTap' || type === 'touchEnd';
}

/**
 * Whether a game or a page may send a web link to the system browser now,
 * given how long ago the player last pressed anything in it.
 *
 * Only as the answer to a press. The browser is where the player is logged
 * in to everything, and a page that could open it at will — a `window.open`
 * on a timer, an ad's frame redirecting — could put anything in front of
 * them there, as often as it liked, with nothing on screen to say it came
 * from the kit. Chromium's own popup blocker is a browser's, not Electron's,
 * so this stands in for it.
 *
 * A redirect gets the longer window, and only in the main frame. A frame's
 * redirect never opens the browser at all: it stays in its frame, as a
 * frame's navigation always has.
 *
 * A press answers one link. Whoever asks this spends it when the answer is
 * yes, as a popup blocker does: a page whose one click tried to open ten
 * tabs gets the first.
 */
export function mayOpenBrowser(opts: { via: 'window-open' | 'navigate' | 'redirect'; mainFrame: boolean; sincePress: number }): boolean {
    if (opts.via === 'redirect' && !opts.mainFrame) return false;
    return opts.sincePress >= 0 && opts.sincePress <= (opts.via === 'redirect' ? REDIRECT_PRESS_MS : PRESS_MS);
}
