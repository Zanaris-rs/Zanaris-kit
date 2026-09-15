import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Notification, type BrowserWindow } from 'electron';

/**
 * The half of a timer's alert that touches the system: reading the alert
 * sound and showing a banner. It holds no rules and needs no test; the sound
 * file itself is checked by `alertSound.test.ts`.
 */

/**
 * The one sound every alert plays, on every platform: Kenney's CC0
 * "Interface Sounds" `confirmation_002`, made louder (see the README). It
 * replaced the system alert sound, which on macOS was too quiet to hear over
 * the game and differed from one platform to the next.
 */
const ALERT_SOUND = join(__dirname, '../../static/sounds/alert.wav');

let alertBytes: Promise<Uint8Array> | null = null;

/** The alert sound's bytes, read once. A read that fails is not cached, so the next alert tries again. */
export function readAlertSound(): Promise<Uint8Array> {
    alertBytes ??= readFile(ALERT_SOUND).then(
        bytes => new Uint8Array(bytes),
        err => {
            alertBytes = null;
            throw err;
        }
    );
    return alertBytes;
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
