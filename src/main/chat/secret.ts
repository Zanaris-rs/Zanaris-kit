/**
 * Keeping the NickServ password without writing it down in the clear.
 *
 * `state.json` is a plain file in the user's profile, so the password goes in
 * sealed by the OS's own secret store (Electron's `safeStorage`: the Keychain
 * on macOS, DPAPI on Windows, the desktop's keyring on Linux) and is opened
 * again at launch. The store is injected so the rules — when sealing counts
 * as safe, and what a blob that will not open means — are tested here rather
 * than trusted to `index.ts`, where nothing can be.
 */

/** The part of Electron's `safeStorage` this uses. */
export interface SecretStore {
    isEncryptionAvailable(): boolean;
    encryptString(plain: string): Buffer;
    decryptString(sealed: Buffer): string;
    /** Linux only in Electron; which backend holds the key. */
    getSelectedStorageBackend?(): string;
}

/**
 * Whether a password sealed now is really protected. On Linux with no keyring
 * running, Electron still "encrypts" with a key it keeps next to the data
 * (`basic_text`), which is the clear text with extra steps — so that counts as
 * no store at all, and the password is kept for the session instead.
 */
export function canSeal(store: SecretStore, platform: string): boolean {
    let available = false;
    try {
        available = store.isEncryptionAvailable();
    } catch {
        return false;
    }
    if (!available) return false;
    if (platform !== 'linux') return true;
    try {
        const backend = store.getSelectedStorageBackend?.();
        return backend !== undefined && backend !== 'basic_text' && backend !== 'unknown';
    } catch {
        return false;
    }
}

/** The password as `state.json` holds it, or null when it cannot be protected and so must not be written. */
export function seal(password: string, store: SecretStore, platform: string): string | null {
    if (!canSeal(store, platform)) return null;
    try {
        return store.encryptString(password).toString('base64');
    } catch {
        return null;
    }
}

/**
 * The password back out of `state.json`. Null for anything that will not open —
 * a profile copied from another machine, a keyring that was reset — which
 * reads as no password rather than as a launch that fails: chat still
 * connects, just unidentified, and Settings takes a new one.
 */
export function open(sealed: string | null, store: SecretStore, platform: string): string | null {
    if (sealed === null || sealed === '' || !canSeal(store, platform)) return null;
    try {
        const password = store.decryptString(Buffer.from(sealed, 'base64'));
        return password === '' ? null : password;
    } catch {
        return null;
    }
}
