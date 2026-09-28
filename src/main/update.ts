import { posix, win32 } from 'node:path';
import type { UpdateButton } from '../shared/ipc.ts';
import { APP_NAME, REPO_URL } from './branding.ts';

/**
 * The kit updating itself: what the latest release offers this system, whether
 * this copy can install it, how each system hands off at quit, and what the
 * player is told at each step. Pure; `updater/service.ts` runs it and
 * `updater/electron.ts` does what it decides.
 */

/** `v0.2.0` or `0.2.0` to `[0, 2, 0]`; anything else, including prereleases, to null. */
export function parseVersion(text: string): number[] | null {
    const digits = /^v?(\d+(?:\.\d+)*)$/.exec(text.trim())?.[1];
    return digits === undefined ? null : digits.split('.').map(Number);
}

/** Negative when `a` is older than `b`, zero when equal, positive when newer; null when either does not parse. */
export function compareVersions(a: string, b: string): number | null {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    if (!pa || !pb) return null;
    const length = Math.max(pa.length, pb.length);
    for (let i = 0; i < length; i++) {
        const x = pa[i] ?? 0;
        const y = pb[i] ?? 0;
        if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
}

// ── where releases come from ──────────────────────────────────────────────

/** Where the latest release is read, and where its files download from. */
export interface Feed {
    /** The latest release's API body. */
    latest: string;
    /** A release's file is `<downloads>/<tag>/<name>`. */
    downloads: string;
}

export const RELEASES_LATEST = 'https://api.github.com/repos/Zanaris-rs/Zanaris-kit/releases/latest';

export const GITHUB_FEED: Feed = { latest: RELEASES_LATEST, downloads: `${REPO_URL}/releases/download` };

/**
 * `ZANARIS_UPDATE_FEED`, for rehearsing an update on one machine: an http URL
 * on 127.0.0.1 serving a release body, whose files download from the same
 * origin under `/download`. Anything else is ignored, so no setting can send
 * the kit's downloads to another host.
 */
export function feedFrom(override: string | undefined): Feed {
    if (!override) return GITHUB_FEED;
    let url: URL;
    try {
        url = new URL(override);
    } catch {
        return GITHUB_FEED;
    }
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return GITHUB_FEED;
    return { latest: url.href, downloads: `${url.origin}/download` };
}

/**
 * The one file each system updates from: electron-builder.yml's artifact
 * names. Windows and Linux ship x64 alone; the Mac's zip is universal.
 */
export function assetName(platform: string, arch: string, version: string): string | null {
    if (platform === 'darwin') return `Zanaris-Kit-${version}-universal.zip`;
    if (platform === 'win32' && arch === 'x64') return `Zanaris-Kit-Setup-${version}.exe`;
    if (platform === 'linux' && arch === 'x64') return `Zanaris-Kit-${version}.AppImage`;
    return null;
}

export interface Asset {
    name: string;
    url: string;
    size: number;
    /** Lower-case hex. */
    sha256: string;
}

export interface Release {
    /** `0.9.1`: the tag without its v. */
    version: string;
    tag: string;
    /** This system's file; null when the release lists none, or none with a size and a sha-256. */
    asset: Asset | null;
}

const TAG = /^v?\d+(?:\.\d+)*$/;
const DIGEST = /^sha256:([0-9a-f]{64})$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * Reads the latest release's body for this system. Null for anything that is
 * not a release tagged with a plain version: an error body, a rate-limit
 * message, a prerelease tag. The download's URL is built from the feed, the
 * tag and the file's name — the body chooses neither host nor path — and its
 * size and digest are GitHub's for that name.
 */
export function readRelease(body: unknown, feed: Feed, platform: string, arch: string): Release | null {
    if (!isRecord(body)) return null;
    const tag = body.tag_name;
    if (typeof tag !== 'string' || !TAG.test(tag)) return null;
    const version = tag.replace(/^v/, '');
    const name = assetName(platform, arch, version);
    const listed = name && Array.isArray(body.assets) ? body.assets.find(a => isRecord(a) && a.name === name) : undefined;
    const size = isRecord(listed) ? listed.size : undefined;
    const sha256 = isRecord(listed) && typeof listed.digest === 'string' ? DIGEST.exec(listed.digest)?.[1] : undefined;
    const asset = name && typeof size === 'number' && Number.isSafeInteger(size) && size > 0 && sha256 ? { name, url: `${feed.downloads}/${tag}/${name}`, size, sha256 } : null;
    return { version, tag, asset };
}

/** A release's page, for Release Notes and Open Release Page. Built here from the version, never read off the network. */
export function releasePage(version: string): string {
    return `${REPO_URL}/releases/tag/v${version}`;
}

// ── whether this copy can update itself ───────────────────────────────────

/** What main knows of where this copy runs from, gathered once at launch. */
export interface InstallFacts {
    platform: string;
    packaged: boolean;
    execPath: string;
    /** `$APPIMAGE`: the file a Linux run was started from, when it was an AppImage. */
    appImage: string | undefined;
    exists(path: string): boolean;
    writable(path: string): boolean;
}

export type InstallTarget = { kind: 'mac'; bundle: string } | { kind: 'windows' } | { kind: 'appimage'; file: string };

export type ManualReason = 'development' | 'not-moved' | 'unwritable' | 'not-installed' | 'not-appimage' | 'no-download';

export type InstallMode = { kind: 'self'; target: InstallTarget } | { kind: 'manual'; reason: ManualReason; folder?: string };

/** What electron-builder's installer leaves beside the app, as `Uninstall ${productName}.exe`. */
export const UNINSTALLER = `Uninstall ${APP_NAME}.exe`;
/** What the Mac zip holds at its top, and what an update is unpacked as. */
export const MAC_BUNDLE = `${APP_NAME}.app`;

/**
 * Whether this copy can replace itself, and if not, why. A Mac copy run from
 * a disk image or where it was downloaded is translocated to a read-only
 * mount, where no swap can happen; one on a writable drive under /Volumes is
 * fine. Windows updates only what its installer put there, which leaves an
 * uninstaller beside the exe. Linux updates only an AppImage.
 */
export function installMode(facts: InstallFacts): InstallMode {
    if (!facts.packaged) return { kind: 'manual', reason: 'development' };
    switch (facts.platform) {
        case 'darwin': {
            // …/Zanaris Kit.app/Contents/MacOS/Zanaris Kit
            const bundle = posix.dirname(posix.dirname(posix.dirname(facts.execPath)));
            if (!bundle.endsWith('.app')) return { kind: 'manual', reason: 'not-installed' };
            const folder = posix.dirname(bundle);
            const writable = facts.writable(bundle) && facts.writable(folder);
            if (bundle.includes('/AppTranslocation/') || (bundle.startsWith('/Volumes/') && !writable)) return { kind: 'manual', reason: 'not-moved' };
            if (!writable) return { kind: 'manual', reason: 'unwritable', folder };
            return { kind: 'self', target: { kind: 'mac', bundle } };
        }
        case 'win32':
            return facts.exists(win32.join(win32.dirname(facts.execPath), UNINSTALLER)) ? { kind: 'self', target: { kind: 'windows' } } : { kind: 'manual', reason: 'not-installed' };
        case 'linux': {
            const file = facts.appImage;
            if (!file || !facts.exists(file)) return { kind: 'manual', reason: 'not-appimage' };
            const folder = posix.dirname(file);
            return facts.writable(folder) ? { kind: 'self', target: { kind: 'appimage', file } } : { kind: 'manual', reason: 'unwritable', folder };
        }
        default:
            return { kind: 'manual', reason: 'no-download' };
    }
}

/** How a release reaches this copy: as `mode` says, unless the release has no file for this system. */
export function howToUpdate(mode: InstallMode, release: Release): InstallMode {
    return mode.kind === 'self' && !release.asset ? { kind: 'manual', reason: 'no-download' } : mode;
}

// ── the hand-off at quit ──────────────────────────────────────────────────

/** In `<userData>/updates`: a download on its way, a finished one, an attempt, its result, and the Mac's old app. */
export const INCOMING = '.incoming';
export const READY = 'ready.json';
export const ATTEMPT = 'attempt.json';
export const RESULT = 'result.txt';
export const ASIDE = 'old.app';

export type HandOff =
    | { kind: 'mac'; args: string[] }
    | { kind: 'windows'; installer: string; args: string[] }
    | { kind: 'appimage'; from: string; part: string; to: string; remove: string | null; relaunch: boolean; result: string };

export interface PlanInput {
    target: InstallTarget;
    /** The finished download: the unpacked app, the installer, or the AppImage. */
    staged: string;
    version: string;
    current: string;
    /** `<userData>/updates`. */
    dir: string;
    pid: number;
    /** Restart to Update rather than a plain quit: open the kit again afterwards. */
    relaunch: boolean;
}

/**
 * What each system runs as the kit exits. The Mac's helper takes everything as
 * arguments (`MAC_HELPER`). Windows runs electron-builder's one-click installer
 * silently; `--updated` makes it wait for the kit to exit rather than ask, and
 * `--force-run` opens the kit afterwards. Linux copies the new AppImage beside
 * the old as a dot-file and renames it over — under the new version's name
 * when the old name carried the old version.
 */
export function installPlan(p: PlanInput): HandOff {
    const t = p.target;
    if (t.kind === 'mac') return { kind: 'mac', args: [String(p.pid), t.bundle, p.staged, posix.join(p.dir, ASIDE), posix.join(p.dir, RESULT), p.relaunch ? '1' : '0'] };
    if (t.kind === 'windows') return { kind: 'windows', installer: p.staged, args: ['/S', '--updated', ...(p.relaunch ? ['--force-run'] : [])] };
    const folder = posix.dirname(t.file);
    const name = posix.basename(t.file);
    const to = name.includes(p.current) ? posix.join(folder, name.replace(p.current, p.version)) : t.file;
    return {
        kind: 'appimage',
        from: p.staged,
        part: posix.join(folder, `.${posix.basename(to)}.part`),
        to,
        remove: to === t.file ? null : t.file,
        relaunch: p.relaunch,
        result: posix.join(p.dir, RESULT)
    };
}

/**
 * The Mac's hand-off, run as `/bin/sh -c MAC_HELPER zanaris-update <args>`
 * with `installPlan`'s arguments: the kit's pid, its app, the new app, where
 * the old one goes, the result file, and 1 to open the kit afterwards. Every
 * path arrives as an argument and is only ever quoted, never pasted into the
 * script. It waits a minute at most for the kit to exit, and opens the kit
 * again on Restart whether or not the swap worked, so a failed update still
 * brings the player back to a kit that says so.
 */
export const MAC_HELPER = `pid=$1 app=$2 fresh=$3 aside=$4 result=$5 reopen=$6
n=0
while kill -0 "$pid" 2>/dev/null; do
  n=$((n + 1))
  if [ "$n" -gt 300 ]; then echo "Zanaris Kit didn't quit, so nothing was replaced." > "$result"; exit 1; fi
  sleep 0.2
done
if ! /bin/mv "$app" "$aside"; then
  echo "The old version couldn't be moved aside." > "$result"
elif ! /bin/mv "$fresh" "$app"; then
  /bin/mv "$aside" "$app"
  echo "The new version couldn't be moved into place, so the old one was put back." > "$result"
else
  echo ok > "$result"
fi
if [ "$reopen" = 1 ]; then /usr/bin/open "$app"; fi
`;

// ── what the last run left ────────────────────────────────────────────────

export type AfterAttempt = { kind: 'none' } | { kind: 'updated'; version: string } | { kind: 'failed'; version: string; reason: string };

/** A version as the kit writes one in its records: `0.9.1`, no v. */
const plainVersion = (value: unknown): string | null => (typeof value === 'string' && /^\d+(?:\.\d+)*$/.test(value) ? value : null);

/** A record's fields, or null when it is not a JSON object. */
function record(text: string | null): Record<string, unknown> | null {
    if (text === null) return null;
    try {
        const parsed: unknown = JSON.parse(text);
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * What an install attempt came to, judged by the version that launched after
 * it: that version or newer means it worked, whatever the result file says.
 * An older one means it did not, for the helper's reason when it left one.
 */
export function afterAttempt(attempt: string | null, result: string | null, current: string): AfterAttempt {
    const version = plainVersion(record(attempt)?.version);
    if (!version) return { kind: 'none' };
    const order = compareVersions(current, version);
    if (order !== null && order >= 0) return { kind: 'updated', version };
    const said = result?.trim();
    return { kind: 'failed', version, reason: said && said !== 'ok' ? said : "The update didn't finish installing." };
}

export interface ReadyRecord {
    version: string;
    /** The file in `updates/<version>/`: a plain name, never a path. */
    file: string;
}

/** A finished download, when it is of a version newer than this one. */
export function readReady(text: string | null, current: string): ReadyRecord | null {
    const fields = record(text);
    const version = plainVersion(fields?.version);
    const file = fields?.file;
    if (!version || typeof file !== 'string' || file === '' || file === '.' || file === '..' || /[/\\]/.test(file)) return null;
    const order = compareVersions(current, version);
    return order !== null && order < 0 ? { version, file } : null;
}

// ── what the player sees ──────────────────────────────────────────────────

export type UpdateState =
    | { kind: 'idle' }
    | { kind: 'available'; release: Release; how: InstallMode }
    | { kind: 'downloading'; release: Release; percent: number }
    | { kind: 'ready'; version: string }
    | { kind: 'failed'; version: string; reason: string; release: Release | null };

/** The tab bar's button, or null while there is nothing to say. */
export function updateButton(state: UpdateState): UpdateButton | null {
    switch (state.kind) {
        case 'idle':
            return null;
        case 'available':
            return { label: `Update ${state.release.version}`, title: `Zanaris Kit ${state.release.version} is out` };
        case 'downloading':
            return { label: `Updating ${state.percent}%`, title: `Downloading Zanaris Kit ${state.release.version}` };
        case 'ready':
            return { label: 'Restart to Update', title: `Zanaris Kit ${state.version} is downloaded, and installs when you quit` };
        case 'failed':
            return { label: 'Update failed', title: `Zanaris Kit couldn't update to ${state.version}` };
    }
}

export type UpdateAction = 'download' | 'page' | 'not-now' | 'keep-going' | 'cancel-download' | 'restart' | 'later' | 'retry';

/** A dialog main shows: the first button is the default, the last is Escape's. */
export interface UpdateQuestion {
    message: string;
    detail: string;
    buttons: { label: string; action: UpdateAction }[];
    /** What Release Notes and Open Release Page open. */
    page: string;
}

const size = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;

function whyByHand(how: Extract<InstallMode, { kind: 'manual' }>): string {
    switch (how.reason) {
        case 'development':
            return "This is a development build, which doesn't update itself.";
        case 'not-moved':
            return "Zanaris Kit is running from the disk image, or from where it was downloaded, and can't update itself there. Drag it to your Applications folder and open it from there, and it will.";
        case 'unwritable':
            return `Zanaris Kit can't write to the folder it's in, ${how.folder ?? 'where it is'}, so it can't update itself.`;
        case 'not-installed':
            return "This copy of Zanaris Kit wasn't put there by its installer, so it can't update itself.";
        case 'not-appimage':
            return "Only the AppImage updates itself, and this copy isn't one.";
        case 'no-download':
            return 'That release has no download for this system.';
    }
}

/** What pressing the button asks, or null while there is no update. `worldRunning` is whether your home server is up, which a restart stops. */
export function updateQuestion(state: UpdateState, worldRunning: boolean): UpdateQuestion | null {
    switch (state.kind) {
        case 'idle':
            return null;
        case 'available': {
            const { release, how } = state;
            const message = `Zanaris Kit ${release.version} is out.`;
            const page = releasePage(release.version);
            if (how.kind === 'manual' || !release.asset) {
                const why = how.kind === 'manual' ? whyByHand(how) : whyByHand({ kind: 'manual', reason: 'no-download' });
                return { message, detail: `${why} Download it from the release page instead.`, buttons: [{ label: 'Open Release Page', action: 'page' }, { label: 'Not Now', action: 'not-now' }], page };
            }
            return {
                message,
                detail: `It's a ${size(release.asset.size)} download. Once it's done, it installs the next time you quit, or straight away if you restart.`,
                buttons: [
                    { label: 'Download', action: 'download' },
                    { label: 'Release Notes', action: 'page' },
                    { label: 'Not Now', action: 'not-now' }
                ],
                page
            };
        }
        case 'downloading':
            return {
                message: `Downloading Zanaris Kit ${state.release.version}: ${state.percent}%.`,
                detail: 'Once it has finished, it installs the next time you quit, or straight away if you restart.',
                buttons: [
                    { label: 'Keep Going', action: 'keep-going' },
                    { label: 'Cancel Download', action: 'cancel-download' }
                ],
                page: releasePage(state.release.version)
            };
        case 'ready':
            return {
                message: `Restart to update to Zanaris Kit ${state.version}?`,
                detail: `Every game is logged out${worldRunning ? ', and your home server stops, saving as it does' : ''}. Otherwise it installs by itself the next time you quit.`,
                buttons: [
                    { label: 'Restart', action: 'restart' },
                    { label: 'Later', action: 'later' }
                ],
                page: releasePage(state.version)
            };
        case 'failed':
            return {
                message: `Zanaris Kit couldn't update to ${state.version}.`,
                detail: state.reason,
                buttons: [
                    { label: 'Try Again', action: 'retry' },
                    { label: 'Open Release Page', action: 'page' },
                    { label: 'Not Now', action: 'not-now' }
                ],
                page: releasePage(state.version)
            };
    }
}
