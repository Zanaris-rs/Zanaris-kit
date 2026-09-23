#!/usr/bin/env node
// npm run fresh: empties the kit's profile so the next launch is a first launch,
// keeping the two things that are slow or painful to rebuild — the engine builds
// and the characters.
//
// A launch is a first launch when there is no state.json (`AppState.fresh`), so
// that file above all is what this clears. It clears the rest of the profile with
// it, since a profile holding a server list and a set of logins is not the one a
// newcomer has.
//
// Nothing is deleted. The old profile is set aside whole — in the Bin on macOS —
// and emptying the Bin is left to whoever ran this. Quit the kit first: it
// rewrites its files as it goes.
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** The package name, which is what Electron derives `app.getPath('userData')` from. */
const APP = 'zanaris-kit';

/**
 * What a reset keeps, moved back into the empty profile afterwards.
 *
 * `yourworld` holds the downloaded builds, 50 MB a line, and the characters of
 * every revision; `singleplayer` is the older tree those characters started in,
 * which CLAUDE.md leaves where it is rather than migrating. Neither is a reason
 * the next launch would not be fresh — only `state.json` decides that — and
 * losing either to a test would cost a download or somebody's save.
 */
export const KEPT = ['yourworld', 'singleplayer'];

/**
 * Where the kit's profile is, as Electron works it out from the package name.
 * Takes its platform, environment and home so the answer can be tested on a
 * machine that is none of them.
 */
export function profileDir(platform, env, home) {
    if (platform === 'darwin') return join(home, 'Library', 'Application Support', APP);
    if (platform === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), APP);
    return join(env.XDG_CONFIG_HOME ?? join(home, '.config'), APP);
}

/**
 * Where the old profile goes. The Bin on macOS, so it is one drag from being
 * back and one menu item from being gone; beside itself anywhere else, since
 * neither Windows nor Linux offers a bin a script can write to without asking
 * the desktop to do it.
 */
export function setAsidePath(platform, home, profile, at) {
    return platform === 'darwin' ? join(home, '.Trash', `${APP}-${at}`) : join(dirname(profile), `${APP}.old-${at}`);
}

/**
 * The first of `base`, `base-2`, `base-3`… that nothing holds. The stamp counts
 * seconds and a reset takes less than one, so two in a row would otherwise pick
 * the same name, and renaming onto a directory that is not empty throws.
 */
export function uniquePath(base, exists) {
    if (!exists(base)) return base;
    for (let n = 2; ; n++) {
        const path = `${base}-${n}`;
        if (!exists(path)) return path;
    }
}

/** A stamp that sorts by hand and holds nothing a file name would refuse: 2026-09-23-142530. */
export function stamp(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

// ── the reset ─────────────────────────────────────────────────────────────

if (import.meta.filename === process.argv[1]) {
    const home = homedir();
    const profile = profileDir(process.platform, process.env, home);

    if (!existsSync(profile)) {
        console.log(`[fresh] no profile at ${profile}`);
        console.log('[fresh] the next launch is already a first launch');
        process.exit(0);
    }

    const aside = uniquePath(setAsidePath(process.platform, home, profile, stamp(new Date())), existsSync);
    mkdirSync(dirname(aside), { recursive: true });
    // The whole profile moves first, so a failure below leaves it whole in one
    // place rather than half of it in two.
    renameSync(profile, aside);
    mkdirSync(profile, { recursive: true });

    const kept = [];
    for (const name of KEPT) {
        if (!existsSync(join(aside, name))) continue;
        renameSync(join(aside, name), join(profile, name));
        kept.push(name);
    }

    console.log(`[fresh] profile set aside: ${aside}`);
    console.log(`[fresh] kept: ${kept.length > 0 ? kept.join(', ') : 'nothing — the old profile had neither builds nor characters'}`);
    console.log('[fresh] nothing was deleted. Empty the Bin yourself when you are sure.');
    console.log('[fresh] now run: npm run dev');
}
