import type { UpdateButton } from '../../shared/ipc.ts';
import {
    afterAttempt,
    ASIDE,
    ATTEMPT,
    compareVersions,
    howToUpdate,
    INCOMING,
    installPlan,
    MAC_BUNDLE,
    READY,
    readReady,
    readRelease,
    RESULT,
    updateButton,
    type Asset,
    type Feed,
    type HandOff,
    type InstallMode,
    type Release,
    type UpdateState
} from '../update.ts';

/** Everything the service needs of the machine, so a test can drive it with none. */
export interface UpdateIo {
    current: string;
    platform: string;
    arch: string;
    /** `<userData>/updates`. */
    dir: string;
    join(...parts: string[]): string;
    feed: Feed;
    /** How this copy updates, decided once at launch by `installMode`. */
    mode: InstallMode;
    pid: number;
    /** The latest release's body, or null when there is none (GitHub's 404). Rejects with a sentence otherwise. */
    fetchLatest(): Promise<unknown>;
    download(asset: Asset, to: string, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<void>;
    unpack(zip: string, into: string): Promise<void>;
    /** Null when the unpacked app is the kit at `version`; otherwise what is wrong, as a sentence. */
    checkApp(bundle: string, version: string): Promise<string | null>;
    fs: {
        exists(path: string): boolean;
        /** Throws when the file is missing. */
        readText(path: string): string;
        writeText(path: string, text: string): void;
        /** Recursive. */
        mkdir(path: string): void;
        /** Recursive, and quiet when the path is absent. */
        rm(path: string): void;
        rename(from: string, to: string): void;
    };
    /** Starts the install and returns at once: the Mac's helper, the installer, or the AppImage's replacement. */
    handOff(plan: HandOff): void;
    log(msg: string): void;
}

export type CheckOutcome = { kind: 'newer' } | { kind: 'current' } | { kind: 'error'; reason: string };

const sentence = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * The kit's own update, from a newer release being noticed to its install at
 * quit. Nothing downloads until `download`, which only the player's press
 * calls; nothing installs but in `installAtQuit`, which only main's `quit`
 * calls; and an attempt that failed is reported at the next launch and never
 * made again until `retry`.
 */
export class UpdateService {
    private readonly io: UpdateIo;
    private readonly listeners = new Set<() => void>();
    private state: UpdateState = { kind: 'idle' };
    /** Not Now: the button stays hidden until a check is asked for. */
    private dismissed = false;
    private flight: AbortController | null = null;

    constructor(io: UpdateIo) {
        this.io = io;
    }

    subscribe(fn: () => void): () => void {
        this.listeners.add(fn);
        return () => void this.listeners.delete(fn);
    }

    view(): UpdateState {
        return this.state;
    }

    button(): UpdateButton | null {
        return this.dismissed ? null : updateButton(this.state);
    }

    /**
     * Reads what the last run left, once, at launch. An attempt that worked
     * clears `updates/`, the Mac's old app with it; one that failed shows why
     * and clears it too, so nothing is installed again unasked. Otherwise a
     * finished download of a newer version is ready, and anything else there
     * is stale.
     */
    start(): void {
        const { fs, join, dir, current } = this.io;
        fs.rm(join(dir, INCOMING));
        const after = afterAttempt(this.read(ATTEMPT), this.read(RESULT), current);
        if (after.kind === 'updated') {
            this.io.log(`[update] now ${current}; ${after.version} was installed`);
            fs.rm(dir);
            return;
        }
        if (after.kind === 'failed') {
            this.io.log(`[update] installing ${after.version} failed: ${after.reason}`);
            fs.rm(dir);
            this.set({ kind: 'failed', version: after.version, reason: after.reason, release: null });
            return;
        }
        const ready = readReady(this.read(READY), current);
        if (ready && fs.exists(join(dir, ready.version, ready.file))) {
            this.set({ kind: 'ready', version: ready.version });
            return;
        }
        fs.rm(dir);
    }

    /**
     * Asks for the latest release. A scheduled check only ever turns nothing
     * into an offer, or an offer into a newer one; one the player asked for
     * also brings back a button Not Now hid, and replaces a failure.
     */
    async check(manual = false): Promise<CheckOutcome> {
        if (manual) this.dismissed = false;
        if (!this.checkable(manual)) {
            this.notify();
            return { kind: 'newer' };
        }
        let body: unknown;
        try {
            body = await this.io.fetchLatest();
        } catch (err) {
            this.io.log(`[update] check failed: ${sentence(err)}`);
            return { kind: 'error', reason: sentence(err) };
        }
        // A download may have started from another check while this one waited.
        if (!this.checkable(manual)) return { kind: 'newer' };
        const release = body === null ? null : readRelease(body, this.io.feed, this.io.platform, this.io.arch);
        if (body !== null && !release) return { kind: 'error', reason: "GitHub's answer wasn't a release the kit can read." };
        const order = release ? compareVersions(this.io.current, release.version) : null;
        if (!release || order === null || order >= 0) {
            if (this.state.kind === 'available' || this.state.kind === 'failed') this.set({ kind: 'idle' });
            else this.notify();
            return { kind: 'current' };
        }
        this.io.log(`[update] ${release.version} is out (this is ${this.io.current})`);
        this.set({ kind: 'available', release, how: howToUpdate(this.io.mode, release) });
        return { kind: 'newer' };
    }

    /** Downloads the release on offer, when this copy can install it. Resolves once it is ready, has failed, or was cancelled. */
    async download(): Promise<void> {
        const s = this.state;
        if (s.kind !== 'available' || s.how.kind !== 'self' || !s.release.asset) return;
        const asset = s.release.asset;
        const { release, how } = s;
        const target = how.target;
        const { fs, join, dir } = this.io;
        const controller = new AbortController();
        this.flight = controller;
        this.set({ kind: 'downloading', release, percent: 0 });
        const incoming = join(dir, INCOMING);
        try {
            fs.rm(incoming);
            fs.mkdir(incoming);
            const file = join(incoming, asset.name);
            await this.io.download(asset, file, fraction => this.progress(release, fraction), controller.signal);
            const staged = join(dir, release.version);
            fs.rm(staged);
            fs.mkdir(staged);
            let name = asset.name;
            if (target.kind === 'mac') {
                const unpacked = join(incoming, 'unpacked');
                await this.io.unpack(file, unpacked);
                const app = join(unpacked, MAC_BUNDLE);
                const wrong = await this.io.checkApp(app, release.version);
                if (wrong) throw new Error(wrong);
                name = MAC_BUNDLE;
                fs.rename(app, join(staged, name));
            } else {
                fs.rename(file, join(staged, name));
            }
            fs.writeText(join(dir, READY), JSON.stringify({ version: release.version, file: name }));
            this.io.log(`[update] ${release.version} is downloaded`);
            this.set({ kind: 'ready', version: release.version });
        } catch (err) {
            if (controller.signal.aborted) {
                this.io.log(`[update] download of ${release.version} cancelled`);
                this.set({ kind: 'available', release, how });
            } else {
                this.io.log(`[update] download of ${release.version} failed: ${sentence(err)}`);
                fs.rm(join(dir, release.version));
                this.set({ kind: 'failed', version: release.version, reason: sentence(err), release });
            }
        } finally {
            fs.rm(incoming);
            this.flight = null;
        }
    }

    cancel(): void {
        this.flight?.abort();
    }

    /** Not Now. */
    dismiss(): void {
        this.dismissed = true;
        this.notify();
    }

    /**
     * Try Again: downloads a release that failed to download, or asks GitHub
     * again after an install that failed, and downloads what it offers.
     * Resolves with that check's outcome, for main to report an error.
     */
    async retry(): Promise<CheckOutcome | null> {
        const s = this.state;
        if (s.kind !== 'failed') return null;
        let outcome: CheckOutcome | null = null;
        if (s.release) this.set({ kind: 'available', release: s.release, how: howToUpdate(this.io.mode, s.release) });
        else outcome = await this.check(true);
        await this.download();
        return outcome;
    }

    /**
     * main's `quit`: hands a ready update off, after recording the attempt the
     * next launch judges. True when it did. Synchronous, since the process is
     * about to end.
     */
    installAtQuit(relaunch: boolean): boolean {
        const s = this.state;
        const mode = this.io.mode;
        if (s.kind !== 'ready' || mode.kind !== 'self') return false;
        const { fs, join, dir, current } = this.io;
        const ready = readReady(this.read(READY), current);
        if (!ready || ready.version !== s.version) return false;
        try {
            fs.rm(join(dir, RESULT));
            // `mv` onto a folder that exists moves into it, not over it.
            fs.rm(join(dir, ASIDE));
            fs.writeText(join(dir, ATTEMPT), JSON.stringify({ version: s.version }));
            this.io.handOff(installPlan({ target: mode.target, staged: join(dir, ready.version, ready.file), version: s.version, current, dir, pid: this.io.pid, relaunch }));
            this.io.log(`[update] installing ${s.version}${relaunch ? ', then opening it' : ''}`);
            return true;
        } catch (err) {
            this.io.log(`[update] could not start installing ${s.version}: ${sentence(err)}`);
            return false;
        }
    }

    // ── internals ────────────────────────────────────────────────────────

    private checkable(manual: boolean): boolean {
        const kind = this.state.kind;
        return kind === 'idle' || kind === 'available' || (manual && kind === 'failed');
    }

    private read(name: string): string | null {
        try {
            return this.io.fs.readText(this.io.join(this.io.dir, name));
        } catch {
            return null;
        }
    }

    /** Whole percents: one push per step rather than per chunk. */
    private progress(release: Release, fraction: number): void {
        const percent = Math.floor(fraction * 100);
        const s = this.state;
        if (s.kind === 'downloading' && s.percent !== percent) this.set({ kind: 'downloading', release, percent });
    }

    private set(state: UpdateState): void {
        this.state = state;
        this.notify();
    }

    private notify(): void {
        for (const fn of this.listeners) fn();
    }
}
