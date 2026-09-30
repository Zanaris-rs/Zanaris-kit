#!/usr/bin/env node
// npm run fresh: empties the development profile so the next `npm run dev` is a
// first launch, keeping its characters, which are painful to make again.
//
// The development profile, never the live one: the installed kit's profile is
// the player's, and a development run keeps its own (src/main/profile.ts). The
// engine builds are the live profile's too, read by every run, so a reset here
// never had them to lose.
//
// A launch is a first launch when there is no state.json (`AppState.fresh`), so
// that file above all is what this clears. It clears the rest of the profile with
// it, since a profile holding a server list and a set of logins is not the one a
// newcomer has.
//
// Nothing is deleted. The old profile is set aside whole — in the Bin on macOS —
// and emptying the Bin is left to whoever ran this. Quit `npm run dev` first: it
// rewrites its files as it goes. The installed kit can stay open.
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEV_PROFILE } from '../src/main/profile.ts';

/**
 * What a reset keeps, moved back into the empty profile afterwards.
 *
 * `homeserver`, which in the development profile holds the characters of every
 * revision and nothing else. It is no reason the next launch would not be
 * fresh — only `state.json` decides that — and losing it to a test would cost
 * somebody's save.
 */
export const KEPT = ['homeserver'];

/**
 * Where the development profile is: the system's app-data folder, as Electron
 * finds it, and the folder `profile.ts` names. Takes its platform, environment
 * and home so the answer can be tested on a machine that is none of them.
 */
export function profileDir(platform, env, home) {
    if (platform === 'darwin') return join(home, 'Library', 'Application Support', DEV_PROFILE);
    if (platform === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), DEV_PROFILE);
    return join(env.XDG_CONFIG_HOME ?? join(home, '.config'), DEV_PROFILE);
}

/**
 * Where the old profile goes. The Bin on macOS, so it is one drag from being
 * back and one menu item from being gone; beside itself anywhere else, since
 * neither Windows nor Linux offers a bin a script can write to without asking
 * the desktop to do it.
 */
export function setAsidePath(platform, home, profile, at) {
    return platform === 'darwin' ? join(home, '.Trash', `${DEV_PROFILE}-${at}`) : join(dirname(profile), `${DEV_PROFILE}.old-${at}`);
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
        console.log(`[fresh] no development profile at ${profile}`);
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
    console.log(`[fresh] kept: ${kept.length > 0 ? kept.join(', ') : 'nothing — the old profile had no characters'}`);
    console.log('[fresh] nothing was deleted. Empty the Bin yourself when you are sure.');
    console.log('[fresh] now run: npm run dev');
}
