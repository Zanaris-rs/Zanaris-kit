import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Notification, type BrowserWindow } from 'electron';
import { SOUND_BYTES_MAX, alertSoundCandidates, parseRegDefault, toPlayable } from './sound';

/**
 * The half of a timer's alert that touches the system: running `defaults` and
 * `reg`, reading sound files, showing a banner. Which files, in what order and
 * what counts as playable are all `sound.ts`'s; this fetches what it is told
 * to, so it holds no rules and needs no test.
 */

const CHIME = join(__dirname, '../../static/sounds/chime.wav');

export interface AlertSound {
    bytes: Uint8Array;
    /** The file it came from, for the log. */
    source: string;
}

/** A command's stdout, or null when it failed, timed out or is not there. */
function run(command: string, args: string[]): Promise<string | null> {
    return new Promise(resolve => {
        execFile(command, args, { timeout: 3_000, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout)));
    });
}

/** A file's bytes, unless it is missing, unreadable or too big to be an alert sound. */
async function readSound(path: string): Promise<Uint8Array | null> {
    try {
        if ((await stat(path)).size > SOUND_BYTES_MAX) return null;
        return new Uint8Array(await readFile(path));
    } catch {
        return null;
    }
}

export async function chimeSound(): Promise<AlertSound> {
    return { bytes: new Uint8Array(await readFile(CHIME)), source: CHIME };
}

/** The system's alert sound, made playable, or the kit's chime when none of the candidates will do. Resolved once, at launch. */
export async function resolveAlertSound(log: (line: string) => void): Promise<AlertSound> {
    const platform = process.platform;
    const macAlert = platform === 'darwin' ? (await run('defaults', ['read', '-g', 'com.apple.sound.beep.sound']))?.trim() || null : null;
    const windowsDefault = platform === 'win32' ? parseRegDefault((await run('reg', ['query', 'HKCU\\AppEvents\\Schemes\\Apps\\.Default\\.Default\\.Current', '/ve'])) ?? '') : null;
    for (const path of alertSoundCandidates(platform, { macAlert, windowsDefault, env: process.env })) {
        const bytes = await readSound(path);
        const playable = bytes && toPlayable(bytes);
        if (playable) {
            log(`[timers] alert sound: ${path}`);
            return { bytes: playable, source: path };
        }
        log(`[timers] alert sound: could not use ${path}`);
    }
    log('[timers] alert sound: the kit’s own chime');
    return chimeSound();
}

/**
 * Banners still on screen or in the notification centre. Held so their click
 * handlers are not collected; dropped when one is clicked or closed. A banner
 * the system files away without saying so stays here until quit, which is a
 * handful of small objects over a session.
 */
const banners = new Set<Notification>();

/** A silent banner: the sound is the kit's to play, at the clock's volume. Clicking it brings the window forward. */
export function showAlertBanner(win: BrowserWindow, title: string, body: string): void {
    if (!Notification.isSupported()) return;
    const banner = new Notification({ title, body, silent: true });
    banners.add(banner);
    banner.on('click', () => {
        banners.delete(banner);
        if (win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
    });
    banner.on('close', () => banners.delete(banner));
    banner.show();
}
