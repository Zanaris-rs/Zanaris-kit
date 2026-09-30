/*
 * Which profile a run keeps its state in: a folder of its own under the
 * system's app-data folder, holding `state.json`, `servers.json`, the game
 * sessions and the characters.
 *
 * The installed kit's is the live one, the player's, and the one Electron
 * names after the package. A development run and a capture each keep another.
 * A development run used to share the live one, so it could not start while
 * the installed kit was open — the single-instance lock is the profile's —
 * and whatever it did to the profile, it did to the player's. A capture is
 * meant to photograph the kit as a newcomer finds it, and an instance holding
 * the live profile's lock made every capture launch exit at once.
 *
 * One thing is shared: the home server's builds, 50 MB a line and pinned and
 * checked wherever they sit, are read from the live profile by every run
 * (index.ts), rather than downloaded again into each.
 */

/** The installed kit's, which Electron derives from the package name. */
export const LIVE_PROFILE = 'zanaris-kit';
/** `npm run dev` and `npm start`: any run from a checkout rather than a packaged kit. */
export const DEV_PROFILE = 'zanaris-kit-dev';
/** `npm run capture`, whatever it runs from. */
export const CAPTURE_PROFILE = 'zanaris-kit-capture';

export function profileFor(run: { packaged: boolean; capture: boolean }): string {
    if (run.capture) return CAPTURE_PROFILE;
    return run.packaged ? LIVE_PROFILE : DEV_PROFILE;
}
