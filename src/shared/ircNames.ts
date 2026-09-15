/**
 * What an IRC name is, shared by main's protocol code and the chat Settings
 * form, which has to judge a channel list the same way the client will.
 */

export function isChannel(target: string): boolean {
    return target.startsWith('#') || target.startsWith('&');
}

/** A channel the user named without its prefix is one they meant to hash. */
export function asChannel(name: string): string {
    return isChannel(name) ? name : `#${name}`;
}

/**
 * IRC names — nicks and channels alike — are case-insensitive on the wire, so
 * "#LostCity" and "#lostcity" name the same channel. This is the one place
 * that fact lives; every identity comparison in this codebase folds through
 * here rather than repeating its own `.toLowerCase()`. Display case is a
 * separate concern and is never touched by this — fold only to compare.
 */
export function foldName(name: string): string {
    return name.toLowerCase();
}

/** Whether two IRC names — nicks or channels — are the same, case folded. */
export function sameName(a: string, b: string): boolean {
    return foldName(a) === foldName(b);
}
