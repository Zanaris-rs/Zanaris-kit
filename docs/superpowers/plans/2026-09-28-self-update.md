# Self-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The kit announces a newer release, downloads it when asked, and installs it at quit on macOS, Windows and Linux.

**Architecture:** The rules — which file, whether this copy can update itself, each system's hand-off, what an attempt left, the button's words and the dialogs' — are pure, in `src/main/update.ts`. `UpdateService` (`src/main/updater/service.ts`) runs the lifecycle over an injected `UpdateIo`; `src/main/updater/electron.ts` is the real io and decides nothing. `index.ts` shows the dialogs and hands off in `quit`; the shell draws one button.

**Tech Stack:** TypeScript, Electron 44 (`net.fetch`, `app` events), `node:child_process`, React 19, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-28-self-update-design.md`

## Global Constraints

- No new dependency.
- Only the latest release's asset named for this system — `Zanaris-Kit-<v>-universal.zip`, `Zanaris-Kit-Setup-<v>.exe`, `Zanaris-Kit-<v>.AppImage` — at the size and `sha256:` digest GitHub lists; the URL is built as `<downloads>/<tag>/<name>`, never read from the body.
- The kit never restarts on its own; an install starts only in main's `quit` event.
- Every path reaches the Mac helper as an argument; none is pasted into its script.
- A failed attempt is never retried without the player pressing Try Again.
- `ZANARIS_UPDATE_FEED` is honoured only as `http://127.0.0.1:<port>/…`.
- Tests import with the `.ts` extension. Every colour in the renderer is a `--color-*` token.
- A comment that describes behaviour the code does not have is a defect: re-read the comments around every change.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Files

| File | Responsibility |
|---|---|
| `src/main/update.ts` | pure rules (extended; `checkLatest` goes) |
| `src/main/update.test.ts` | their tests, and the Mac helper run under `/bin/sh` |
| `src/main/download.ts` | `signal` for Cancel Download |
| `src/main/updater/service.ts` | `UpdateService`, `UpdateIo` |
| `src/main/updater/service.test.ts` | the lifecycle over a fake io |
| `src/main/updater/electron.ts` | the real io and the hand-offs |
| `src/shared/ipc.ts`, `src/preload/index.ts` | `UpdateButton`, `ShellState.update`, `IPC.updatePress`, `zanaris.update.press()` |
| `src/main/serverWindow.ts` | `deps.update` into `state()` |
| `src/main/menu.ts` | Check for Updates… |
| `src/main/index.ts` | the service, the dialogs, the checks, `quit` |
| `src/renderer/Shell.tsx` | the button |
| `electron-builder.yml`, `.github/workflows/release.yml`, `package.json` | the Mac zip, 0.9.0 |
| README, CLAUDE.md, RELEASE.md | what it does, its invariants, releasing with it |

---

### Task 1: The rules

**Files:**
- Modify: `src/main/update.ts` (whole file)
- Test: `src/main/update.test.ts` (whole file)

**Interfaces:**
- Produces: `parseVersion`, `compareVersions` (unchanged); `Feed`, `RELEASES_LATEST`, `GITHUB_FEED`, `feedFrom(override)`; `assetName(platform, arch, version)`; `Asset`, `Release`, `readRelease(body, feed, platform, arch)`, `releasePage(version)`; `InstallFacts`, `InstallTarget`, `ManualReason`, `InstallMode`, `UNINSTALLER`, `MAC_BUNDLE`, `installMode(facts)`, `howToUpdate(mode, release)`; `HandOff`, `PlanInput`, `installPlan(input)`, `MAC_HELPER`; the file names `INCOMING`, `READY`, `ATTEMPT`, `RESULT`, `ASIDE`; `AfterAttempt`, `afterAttempt(attempt, result, current)`, `ReadyRecord`, `readReady(text, current)`; `UpdateState`, `updateButton(state)`; `UpdateAction`, `UpdateQuestion`, `updateQuestion(state, worldRunning)`.

- [ ] **Step 1: Write the failing tests** — replace `src/main/update.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    afterAttempt,
    assetName,
    compareVersions,
    feedFrom,
    GITHUB_FEED,
    howToUpdate,
    installMode,
    installPlan,
    MAC_HELPER,
    parseVersion,
    readReady,
    readRelease,
    updateButton,
    updateQuestion,
    type InstallFacts,
    type Release
} from './update.ts';

const DIGEST = 'a'.repeat(64);
const body = (tag: string, assets: unknown[]): unknown => ({ tag_name: tag, html_url: 'https://github.com/Zanaris-rs/Zanaris-kit/releases/tag/' + tag, assets });
const listed = (name: string, size = 270_000_000, digest = `sha256:${DIGEST}`): unknown => ({ name, size, digest, browser_download_url: 'https://elsewhere.invalid/x' });

test('parseVersion accepts a leading v and any number of numeric parts', () => {
    assert.deepEqual(parseVersion('v0.2.0'), [0, 2, 0]);
    assert.deepEqual(parseVersion('1.0'), [1, 0]);
    assert.equal(parseVersion('v0.2.0-beta'), null);
    assert.equal(parseVersion('latest'), null);
});

test('compareVersions orders numerically and pads missing parts with zero', () => {
    assert.ok(compareVersions('0.2.0', 'v0.3.0')! < 0);
    assert.ok(compareVersions('0.10.0', 'v0.9.1')! > 0);
    assert.equal(compareVersions('1.0', '1.0.0'), 0);
    assert.equal(compareVersions('0.2.0', 'nightly'), null);
});

test('the feed is GitHub unless a loopback http override names another', () => {
    assert.equal(feedFrom(undefined), GITHUB_FEED);
    assert.equal(GITHUB_FEED.downloads, 'https://github.com/Zanaris-rs/Zanaris-kit/releases/download');
    assert.deepEqual(feedFrom('http://127.0.0.1:8765/latest.json'), { latest: 'http://127.0.0.1:8765/latest.json', downloads: 'http://127.0.0.1:8765/download' });
    for (const refused of ['https://evil.invalid/latest.json', 'http://localhost:8765/latest.json', 'http://10.0.0.2/latest.json', 'file:///tmp/latest.json', 'nonsense']) {
        assert.equal(feedFrom(refused), GITHUB_FEED, refused);
    }
});

test('each system updates from one named file, and a system the kit does not build for from none', () => {
    assert.equal(assetName('darwin', 'arm64', '0.9.1'), 'Zanaris-Kit-0.9.1-universal.zip');
    assert.equal(assetName('darwin', 'x64', '0.9.1'), 'Zanaris-Kit-0.9.1-universal.zip');
    assert.equal(assetName('win32', 'x64', '0.9.1'), 'Zanaris-Kit-Setup-0.9.1.exe');
    assert.equal(assetName('linux', 'x64', '0.9.1'), 'Zanaris-Kit-0.9.1.AppImage');
    assert.equal(assetName('linux', 'arm64', '0.9.1'), null);
    assert.equal(assetName('win32', 'ia32', '0.9.1'), null);
    assert.equal(assetName('freebsd', 'x64', '0.9.1'), null);
});

test('a release is read for its version and this system file, whose url the kit builds itself', () => {
    const release = readRelease(body('v0.9.1', [listed('Zanaris-Kit-0.9.1-universal.zip'), listed('Zanaris-Kit-Setup-0.9.1.exe', 155_000_000)]), GITHUB_FEED, 'darwin', 'arm64');
    assert.deepEqual(release, {
        version: '0.9.1',
        tag: 'v0.9.1',
        asset: {
            name: 'Zanaris-Kit-0.9.1-universal.zip',
            url: 'https://github.com/Zanaris-rs/Zanaris-kit/releases/download/v0.9.1/Zanaris-Kit-0.9.1-universal.zip',
            size: 270_000_000,
            sha256: DIGEST
        }
    });
});

test('a release without this system file, or without a size and sha-256 for it, has no asset', () => {
    assert.equal(readRelease(body('v0.9.1', [listed('Zanaris-Kit-Setup-0.9.1.exe')]), GITHUB_FEED, 'darwin', 'arm64')?.asset, null);
    assert.equal(readRelease(body('v0.9.1', [listed('Zanaris-Kit-0.9.1-universal.zip', 0)]), GITHUB_FEED, 'darwin', 'arm64')?.asset, null);
    assert.equal(readRelease(body('v0.9.1', [listed('Zanaris-Kit-0.9.1-universal.zip', 5, 'md5:abc')]), GITHUB_FEED, 'darwin', 'arm64')?.asset, null);
    assert.equal(readRelease(body('v0.9.1', [{ name: 'Zanaris-Kit-0.9.1-universal.zip', size: 5 }]), GITHUB_FEED, 'darwin', 'arm64')?.asset, null);
    assert.equal(readRelease({ tag_name: 'v0.9.1' }, GITHUB_FEED, 'darwin', 'arm64')?.asset, null);
});

test('anything that is not a release with a plain version tag is not read', () => {
    assert.equal(readRelease(null, GITHUB_FEED, 'darwin', 'arm64'), null);
    assert.equal(readRelease('v0.9.1', GITHUB_FEED, 'darwin', 'arm64'), null);
    assert.equal(readRelease({ message: 'API rate limit exceeded' }, GITHUB_FEED, 'darwin', 'arm64'), null);
    assert.equal(readRelease(body('v0.9.1-rc.1', []), GITHUB_FEED, 'darwin', 'arm64'), null);
    assert.equal(readRelease(body('v0.9.1/../../x', []), GITHUB_FEED, 'darwin', 'arm64'), null);
    assert.equal(readRelease(body(' v0.9.1', []), GITHUB_FEED, 'darwin', 'arm64'), null);
});

const mac = (execPath: string, writable = true): InstallFacts => ({ platform: 'darwin', packaged: true, execPath, appImage: undefined, exists: () => true, writable: () => writable });

test('a Mac copy updates itself from a folder it can write, and not from a disk image or a translocated copy', () => {
    assert.deepEqual(installMode(mac('/Applications/Zanaris Kit.app/Contents/MacOS/Zanaris Kit')), { kind: 'self', target: { kind: 'mac', bundle: '/Applications/Zanaris Kit.app' } });
    assert.deepEqual(installMode(mac('/Volumes/Games/Zanaris Kit.app/Contents/MacOS/Zanaris Kit')), { kind: 'self', target: { kind: 'mac', bundle: '/Volumes/Games/Zanaris Kit.app' } }, 'a writable external drive is fine');
    assert.deepEqual(installMode(mac('/Volumes/Zanaris Kit/Zanaris Kit.app/Contents/MacOS/Zanaris Kit', false)), { kind: 'manual', reason: 'not-moved' });
    assert.deepEqual(installMode(mac('/private/var/folders/y_/T/AppTranslocation/851D/d/Zanaris Kit.app/Contents/MacOS/Zanaris Kit')), { kind: 'manual', reason: 'not-moved' });
    assert.deepEqual(installMode(mac('/Applications/Zanaris Kit.app/Contents/MacOS/Zanaris Kit', false)), { kind: 'manual', reason: 'unwritable', folder: '/Applications' });
    assert.deepEqual(installMode({ ...mac('/Applications/Zanaris Kit.app/Contents/MacOS/Zanaris Kit'), packaged: false }), { kind: 'manual', reason: 'development' });
});

test('a Windows copy updates itself only where the installer put it, and Linux only as a writable AppImage', () => {
    const win = (uninstaller: boolean): InstallFacts => ({
        platform: 'win32',
        packaged: true,
        execPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\zanaris-kit\\Zanaris Kit.exe',
        appImage: undefined,
        exists: path => uninstaller && path === 'C:\\Users\\me\\AppData\\Local\\Programs\\zanaris-kit\\Uninstall Zanaris Kit.exe',
        writable: () => true
    });
    assert.deepEqual(installMode(win(true)), { kind: 'self', target: { kind: 'windows' } });
    assert.deepEqual(installMode(win(false)), { kind: 'manual', reason: 'not-installed' });
    const linux = (appImage: string | undefined, writable = true): InstallFacts => ({ platform: 'linux', packaged: true, execPath: '/tmp/.mount_x/zanaris-kit', appImage, exists: () => true, writable: () => writable });
    assert.deepEqual(installMode(linux('/home/me/Apps/Zanaris-Kit-0.9.0.AppImage')), { kind: 'self', target: { kind: 'appimage', file: '/home/me/Apps/Zanaris-Kit-0.9.0.AppImage' } });
    assert.deepEqual(installMode(linux(undefined)), { kind: 'manual', reason: 'not-appimage' });
    assert.deepEqual(installMode(linux('/opt/Zanaris-Kit-0.9.0.AppImage', false)), { kind: 'manual', reason: 'unwritable', folder: '/opt' });
});

test('a release with no file for this system is fetched by hand, however this copy could install', () => {
    const release: Release = { version: '0.9.1', tag: 'v0.9.1', asset: null };
    assert.deepEqual(howToUpdate({ kind: 'self', target: { kind: 'windows' } }, release), { kind: 'manual', reason: 'no-download' });
    assert.deepEqual(howToUpdate({ kind: 'manual', reason: 'development' }, release), { kind: 'manual', reason: 'development' });
});

test('each system hands off as its plan says', () => {
    const base = { staged: '', version: '0.9.1', current: '0.9.0', dir: '/Users/me/Library/Application Support/zanaris-kit/updates', pid: 4242 };
    assert.deepEqual(installPlan({ ...base, target: { kind: 'mac', bundle: '/Applications/Zanaris Kit.app' }, staged: `${base.dir}/0.9.1/Zanaris Kit.app`, relaunch: true }), {
        kind: 'mac',
        args: ['4242', '/Applications/Zanaris Kit.app', `${base.dir}/0.9.1/Zanaris Kit.app`, `${base.dir}/old.app`, `${base.dir}/result.txt`, '1']
    });
    assert.deepEqual(installPlan({ ...base, target: { kind: 'windows' }, staged: 'C:\\u\\0.9.1\\Zanaris-Kit-Setup-0.9.1.exe', relaunch: false }), {
        kind: 'windows',
        installer: 'C:\\u\\0.9.1\\Zanaris-Kit-Setup-0.9.1.exe',
        args: ['/S', '--updated']
    });
    assert.deepEqual(installPlan({ ...base, target: { kind: 'windows' }, staged: 'C:\\u\\s.exe', relaunch: true }), {
        kind: 'windows',
        installer: 'C:\\u\\s.exe',
        args: ['/S', '--updated', '--force-run']
    });
    assert.deepEqual(installPlan({ ...base, dir: '/home/me/.config/zanaris-kit/updates', target: { kind: 'appimage', file: '/home/me/Apps/Zanaris-Kit-0.9.0.AppImage' }, staged: '/s/Zanaris-Kit-0.9.1.AppImage', relaunch: true }), {
        kind: 'appimage',
        from: '/s/Zanaris-Kit-0.9.1.AppImage',
        part: '/home/me/Apps/.Zanaris-Kit-0.9.1.AppImage.part',
        to: '/home/me/Apps/Zanaris-Kit-0.9.1.AppImage',
        remove: '/home/me/Apps/Zanaris-Kit-0.9.0.AppImage',
        relaunch: true,
        result: '/home/me/.config/zanaris-kit/updates/result.txt'
    });
    const renamed = installPlan({ ...base, target: { kind: 'appimage', file: '/home/me/zk.AppImage' }, staged: '/s/n', relaunch: false });
    assert.equal(renamed.kind === 'appimage' && renamed.to, '/home/me/zk.AppImage', 'a name without the version is kept');
    assert.equal(renamed.kind === 'appimage' && renamed.remove, null);
});

test('an attempt is judged by the version that launched after it', () => {
    assert.deepEqual(afterAttempt(null, null, '0.9.0'), { kind: 'none' });
    assert.deepEqual(afterAttempt('{"version":"0.9.1"}', 'ok', '0.9.1'), { kind: 'updated', version: '0.9.1' });
    assert.deepEqual(afterAttempt('{"version":"0.9.1"}', "The old version couldn't be moved aside.", '0.9.0'), { kind: 'failed', version: '0.9.1', reason: "The old version couldn't be moved aside." });
    assert.deepEqual(afterAttempt('{"version":"0.9.1"}', null, '0.9.0'), { kind: 'failed', version: '0.9.1', reason: "The update didn't finish installing." });
    assert.deepEqual(afterAttempt('{"version":"0.9.1"}', 'ok\n', '0.9.0'), { kind: 'failed', version: '0.9.1', reason: "The update didn't finish installing." });
    assert.deepEqual(afterAttempt('not json', null, '0.9.0'), { kind: 'none' });
    assert.deepEqual(afterAttempt('{"version":"../x"}', null, '0.9.0'), { kind: 'none' });
});

test('a finished download counts only for a newer version, under a plain file name', () => {
    assert.deepEqual(readReady('{"version":"0.9.1","file":"Zanaris Kit.app"}', '0.9.0'), { version: '0.9.1', file: 'Zanaris Kit.app' });
    assert.equal(readReady('{"version":"0.9.1","file":"Zanaris Kit.app"}', '0.9.1'), null);
    assert.equal(readReady('{"version":"0.9.1","file":"../../x"}', '0.9.0'), null);
    assert.equal(readReady('{"version":"0.9.1","file":"a\\\\b"}', '0.9.0'), null);
    assert.equal(readReady('{"version":"0.9.1"}', '0.9.0'), null);
    assert.equal(readReady(null, '0.9.0'), null);
});

const release: Release = { version: '0.9.1', tag: 'v0.9.1', asset: { name: 'Zanaris-Kit-0.9.1-universal.zip', url: 'u', size: 270_400_000, sha256: DIGEST } };

test('the button says where the update is, and nothing while there is none', () => {
    assert.equal(updateButton({ kind: 'idle' }), null);
    assert.equal(updateButton({ kind: 'available', release, how: { kind: 'self', target: { kind: 'windows' } } })?.label, 'Update 0.9.1');
    assert.equal(updateButton({ kind: 'downloading', release, percent: 42 })?.label, 'Updating 42%');
    assert.equal(updateButton({ kind: 'ready', version: '0.9.1' })?.label, 'Restart to Update');
    assert.equal(updateButton({ kind: 'failed', version: '0.9.1', reason: 'x', release: null })?.label, 'Update failed');
});

test('each dialog offers what can be done from where the update is', () => {
    const actions = (q: ReturnType<typeof updateQuestion>): string[] | undefined => q?.buttons.map(b => b.action);
    const offered = updateQuestion({ kind: 'available', release, how: { kind: 'self', target: { kind: 'windows' } } }, false);
    assert.deepEqual(actions(offered), ['download', 'page', 'not-now']);
    assert.match(offered!.detail, /270 MB/);
    assert.equal(offered!.page, 'https://github.com/Zanaris-rs/Zanaris-kit/releases/tag/v0.9.1');
    const byHand = updateQuestion({ kind: 'available', release, how: { kind: 'manual', reason: 'not-moved' } }, false);
    assert.deepEqual(actions(byHand), ['page', 'not-now']);
    assert.match(byHand!.detail, /Applications folder/);
    assert.match(updateQuestion({ kind: 'available', release, how: { kind: 'manual', reason: 'unwritable', folder: '/opt' } }, false)!.detail, /\/opt/);
    assert.deepEqual(actions(updateQuestion({ kind: 'downloading', release, percent: 3 }, false)), ['keep-going', 'cancel-download']);
    assert.deepEqual(actions(updateQuestion({ kind: 'ready', version: '0.9.1' }, false)), ['restart', 'later']);
    assert.match(updateQuestion({ kind: 'ready', version: '0.9.1' }, true)!.detail, /home server/);
    assert.doesNotMatch(updateQuestion({ kind: 'ready', version: '0.9.1' }, false)!.detail, /home server/);
    const failed = updateQuestion({ kind: 'failed', version: '0.9.1', reason: 'The download stalled.', release: null }, false);
    assert.deepEqual(actions(failed), ['retry', 'page', 'not-now']);
    assert.equal(failed!.detail, 'The download stalled.');
    assert.equal(updateQuestion({ kind: 'idle' }, false), null);
});

// The Mac helper itself, run by the shell it runs under. Not on Windows, which has no /bin/sh.
const helper = process.platform === 'win32' ? test.skip : test;

function helperRun(fresh: boolean): { app: string; aside: string; result: string; freshApp: string } {
    const dir = mkdtempSync(join(tmpdir(), 'zanaris update "q" '));
    const app = join(dir, "Zanaris Kit's.app");
    const freshApp = join(dir, 'new', 'Zanaris Kit.app');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'version'), 'old');
    if (fresh) {
        mkdirSync(freshApp, { recursive: true });
        writeFileSync(join(freshApp, 'version'), 'new');
    }
    const gone = spawnSync(process.execPath, ['-e', '0']).pid;
    const aside = join(dir, 'old.app');
    const result = join(dir, 'result.txt');
    execFileSync('/bin/sh', ['-c', MAC_HELPER, 'zanaris-update', String(gone), app, freshApp, aside, result, '0']);
    return { app, aside, result, freshApp };
}

helper('the Mac helper swaps the new app in for the old, whatever the paths hold', t => {
    const run = helperRun(true);
    t.after(() => rmSync(join(run.app, '..'), { recursive: true, force: true }));
    assert.equal(readFileSync(join(run.app, 'version'), 'utf8'), 'new');
    assert.equal(readFileSync(join(run.aside, 'version'), 'utf8'), 'old');
    assert.equal(readFileSync(run.result, 'utf8').trim(), 'ok');
});

helper('the Mac helper puts the old app back when the new one cannot go in, and says so', t => {
    const run = helperRun(false);
    t.after(() => rmSync(join(run.app, '..'), { recursive: true, force: true }));
    assert.equal(readFileSync(join(run.app, 'version'), 'utf8'), 'old');
    assert.equal(existsSync(run.aside), false);
    assert.match(readFileSync(run.result, 'utf8'), /old one was put back/);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test src/main/update.test.ts`
Expected: FAIL — `feedFrom`, `assetName` and the rest are not exported.

- [ ] **Step 3: Write `src/main/update.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests**

Run: `node --test src/main/update.test.ts`
Expected: PASS. (`index.ts` and `menu.ts` still import `checkLatest`/`LatestRelease`; typecheck is red until Task 4.)

- [ ] **Step 5: Commit** — `git add src/main/update.ts src/main/update.test.ts && git commit -m "feat: the rules of the kit updating itself"`

---

### Task 2: Cancel for a download

**Files:**
- Modify: `src/main/download.ts` (`DownloadOptions`, `downloadFile`)
- Test: `src/main/download.test.ts` (append)

**Interfaces:**
- Produces: `DownloadOptions.signal?: AbortSignal`; an aborted download rejects with `Downloading <file> was cancelled` and leaves no file through `downloadChecked`.

- [ ] **Step 1: Write the failing test** — append to `download.test.ts`:

```ts
test('a download is cancelled by its signal, and a checked one leaves no file', async t => {
    const dir = mkdtempSync(join(tmpdir(), 'download-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const to = join(dir, 'kit.zip');
    const controller = new AbortController();
    // A body that sends one chunk and then waits, until the fetch's own signal ends it.
    const slow = async (_url: string, init: { signal: AbortSignal }): Promise<Response> =>
        new Response(
            new ReadableStream({
                start(stream) {
                    stream.enqueue(new Uint8Array(10));
                    init.signal.addEventListener('abort', () => stream.error(new Error('aborted')));
                }
            })
        );
    const going = downloadChecked({ url: 'http://example.invalid/kit.zip', file: 'kit.zip', size: 100, sha256: 'f'.repeat(64), to, fetch: slow, signal: controller.signal, onProgress: f => f > 0 && controller.abort() });
    await assert.rejects(going, /Downloading kit\.zip was cancelled/);
    assert.equal(existsSync(to), false);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test src/main/download.test.ts`
Expected: FAIL — the signal is ignored, so the download stalls until its 30 s idle timer.

- [ ] **Step 3: Implement** — in `DownloadOptions` add after `onProgress`:

```ts
    /** Cancels the download: Cancel Download on an update. */
    signal?: AbortSignal;
```

and in `downloadFile`, after `let timer = setTimeout(stall, idleMs);`:

```ts
    const cancel = (): void => controller.abort();
    opts.signal?.addEventListener('abort', cancel, { once: true });
    if (opts.signal?.aborted) controller.abort();
```

in its `catch`, after the stalled line:

```ts
        if (opts.signal?.aborted) throw new Error(`Downloading ${opts.file} was cancelled`);
```

and in its `finally`, before `out?.destroy();`:

```ts
        opts.signal?.removeEventListener('abort', cancel);
```

- [ ] **Step 4: Run** — `node --test src/main/download.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat: a download can be cancelled"`

---

### Task 3: `UpdateService`

**Files:**
- Create: `src/main/updater/service.ts`
- Test: `src/main/updater/service.test.ts`

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces:

```ts
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
    fs: { exists(path: string): boolean; readText(path: string): string; writeText(path: string, text: string): void; mkdir(path: string): void; rm(path: string): void; rename(from: string, to: string): void };
    handOff(plan: HandOff): void;
    log(msg: string): void;
}
export type CheckOutcome = { kind: 'newer' } | { kind: 'current' } | { kind: 'error'; reason: string };
export class UpdateService {
    constructor(io: UpdateIo);
    subscribe(fn: () => void): () => void;
    view(): UpdateState;
    button(): UpdateButton | null;
    start(): void;
    check(manual?: boolean): Promise<CheckOutcome>;
    download(): Promise<void>;
    cancel(): void;
    dismiss(): void;
    retry(): Promise<CheckOutcome | null>;
    installAtQuit(relaunch: boolean): boolean;
}
```

- [ ] **Step 1: Write the failing tests** — `src/main/updater/service.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { GITHUB_FEED, type Asset, type HandOff, type InstallMode } from '../update.ts';
import { UpdateService, type UpdateIo } from './service.ts';

const DIR = '/u/updates';
const ZIP = 'Zanaris-Kit-0.9.1-universal.zip';
const RELEASE = { tag_name: 'v0.9.1', assets: [{ name: ZIP, size: 1000, digest: `sha256:${'a'.repeat(64)}` }] };
const MAC: InstallMode = { kind: 'self', target: { kind: 'mac', bundle: '/Applications/Zanaris Kit.app' } };

interface Fake {
    io: UpdateIo;
    files: Map<string, string>;
    downloads: { asset: Asset; to: string; signal: AbortSignal }[];
    handOffs: HandOff[];
    /** What the next download does: resolve, reject, or wait for its signal. */
    next: 'ok' | 'fail' | 'hang';
    latest: unknown;
    checkApp: string | null;
}

function fake(over: Partial<UpdateIo> = {}): Fake {
    const files = new Map<string, string>();
    const under = (path: string): string[] => [...files.keys()].filter(k => k === path || k.startsWith(`${path}/`));
    const f: Fake = {
        files,
        downloads: [],
        handOffs: [],
        next: 'ok',
        latest: RELEASE,
        checkApp: null,
        io: {
            current: '0.9.0',
            platform: 'darwin',
            arch: 'arm64',
            dir: DIR,
            join: posix.join,
            feed: GITHUB_FEED,
            mode: MAC,
            pid: 4242,
            fetchLatest: async () => {
                if (f.latest instanceof Error) throw f.latest;
                return f.latest;
            },
            download: (asset, to, onProgress, signal) => {
                f.downloads.push({ asset, to, signal });
                if (f.next === 'fail') return Promise.reject(new Error('Downloading it stalled'));
                if (f.next === 'hang') return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled'))));
                onProgress(0.5);
                onProgress(0.504);
                files.set(to, 'zip');
                return Promise.resolve();
            },
            unpack: async (_zip, into) => void files.set(posix.join(into, 'Zanaris Kit.app', 'Contents'), 'app'),
            checkApp: async () => f.checkApp,
            fs: {
                exists: path => under(path).length > 0,
                readText: path => {
                    const text = files.get(path);
                    if (text === undefined) throw new Error(`ENOENT ${path}`);
                    return text;
                },
                writeText: (path, text) => void files.set(path, text),
                mkdir: () => {},
                rm: path => under(path).forEach(k => files.delete(k)),
                rename: (from, to) => {
                    for (const k of under(from)) {
                        files.set(to + k.slice(from.length), files.get(k)!);
                        files.delete(k);
                    }
                }
            },
            handOff: plan => void f.handOffs.push(plan),
            log: () => {},
            ...over
        }
    };
    return f;
}

test('a newer release is announced, and an equal or older one is not', async () => {
    const f = fake();
    const service = new UpdateService(f.io);
    assert.deepEqual(await service.check(), { kind: 'newer' });
    assert.equal(service.button()?.label, 'Update 0.9.1');
    f.io.current = '0.9.1';
    const same = new UpdateService(f.io);
    assert.deepEqual(await same.check(), { kind: 'current' });
    assert.equal(same.button(), null);
});

test('no release at all is being up to date, and a failed request is an error that changes nothing', async () => {
    const f = fake();
    f.latest = null;
    assert.deepEqual(await new UpdateService(f.io).check(), { kind: 'current' });
    f.latest = new Error('GitHub answered HTTP 403.');
    const service = new UpdateService(f.io);
    assert.deepEqual(await service.check(true), { kind: 'error', reason: 'GitHub answered HTTP 403.' });
    assert.equal(service.view().kind, 'idle');
});

test('a Mac download is unpacked, checked and put where the quit can find it', async () => {
    const f = fake();
    const service = new UpdateService(f.io);
    await service.check();
    const seen: string[] = [];
    service.subscribe(() => seen.push(service.button()?.label ?? '-'));
    await service.download();
    assert.equal(f.downloads[0].asset.name, ZIP);
    assert.equal(f.downloads[0].to, `${DIR}/.incoming/${ZIP}`);
    assert.deepEqual(seen, ['Updating 0%', 'Updating 50%', 'Restart to Update'], 'one push per whole percent');
    assert.equal(f.files.get(`${DIR}/0.9.1/Zanaris Kit.app/Contents`), 'app');
    assert.deepEqual(JSON.parse(f.files.get(`${DIR}/ready.json`)!), { version: '0.9.1', file: 'Zanaris Kit.app' });
    assert.equal([...f.files.keys()].some(k => k.includes('.incoming')), false);
});

test('an app that fails its check is refused, and nothing is left ready', async () => {
    const f = fake();
    f.checkApp = "The download isn't Zanaris Kit.";
    const service = new UpdateService(f.io);
    await service.check();
    await service.download();
    assert.deepEqual(service.view(), { kind: 'failed', version: '0.9.1', reason: "The download isn't Zanaris Kit.", release: { version: '0.9.1', tag: 'v0.9.1', asset: f.downloads[0].asset } });
    assert.equal(f.files.has(`${DIR}/ready.json`), false);
    assert.equal(service.installAtQuit(false), false);
});

test('a Windows download is the installer itself', async () => {
    const f = fake({ platform: 'win32', arch: 'x64', mode: { kind: 'self', target: { kind: 'windows' } } });
    f.latest = { tag_name: 'v0.9.1', assets: [{ name: 'Zanaris-Kit-Setup-0.9.1.exe', size: 9, digest: `sha256:${'b'.repeat(64)}` }] };
    const service = new UpdateService(f.io);
    await service.check();
    await service.download();
    assert.equal(f.files.get(`${DIR}/0.9.1/Zanaris-Kit-Setup-0.9.1.exe`), 'zip');
    assert.equal(service.view().kind, 'ready');
});

test('cancelling goes back to offering the update', async () => {
    const f = fake();
    f.next = 'hang';
    const service = new UpdateService(f.io);
    await service.check();
    const going = service.download();
    service.cancel();
    await going;
    assert.equal(service.view().kind, 'available');
    assert.equal(f.files.has(`${DIR}/ready.json`), false);
});

test('a failed download is tried again only when asked', async () => {
    const f = fake();
    f.next = 'fail';
    const service = new UpdateService(f.io);
    await service.check();
    await service.download();
    assert.equal(service.button()?.label, 'Update failed');
    await service.check();
    assert.equal(service.view().kind, 'failed', 'a scheduled check leaves a failure showing');
    f.next = 'ok';
    await service.retry();
    assert.equal(service.view().kind, 'ready');
});

test('a copy that cannot update itself is told of the release but downloads nothing', async () => {
    const f = fake({ mode: { kind: 'manual', reason: 'not-moved' } });
    const service = new UpdateService(f.io);
    await service.check();
    await service.download();
    assert.equal(f.downloads.length, 0);
    assert.equal(service.button()?.label, 'Update 0.9.1');
});

test('the quit hands a ready update off, after recording the attempt', async () => {
    const f = fake();
    const service = new UpdateService(f.io);
    assert.equal(service.installAtQuit(true), false, 'nothing ready');
    await service.check();
    await service.download();
    f.files.set(`${DIR}/old.app/x`, 'left over');
    assert.equal(service.installAtQuit(true), true);
    assert.deepEqual(JSON.parse(f.files.get(`${DIR}/attempt.json`)!), { version: '0.9.1' });
    assert.equal(f.files.has(`${DIR}/old.app/x`), false, 'nothing is where the old app goes');
    assert.deepEqual(f.handOffs, [{ kind: 'mac', args: ['4242', '/Applications/Zanaris Kit.app', `${DIR}/0.9.1/Zanaris Kit.app`, `${DIR}/old.app`, `${DIR}/result.txt`, '1'] }]);
});

test('a launch after an attempt that worked clears everything', () => {
    const f = fake({ current: '0.9.1' });
    f.files.set(`${DIR}/attempt.json`, '{"version":"0.9.1"}');
    f.files.set(`${DIR}/old.app/Contents`, 'old');
    const service = new UpdateService(f.io);
    service.start();
    assert.equal(service.view().kind, 'idle');
    assert.equal(f.files.size, 0);
});

test('a launch after an attempt that failed says why, clears it, and installs nothing at quit', () => {
    const f = fake();
    f.files.set(`${DIR}/attempt.json`, '{"version":"0.9.1"}');
    f.files.set(`${DIR}/result.txt`, "The old version couldn't be moved aside.\n");
    f.files.set(`${DIR}/ready.json`, '{"version":"0.9.1","file":"Zanaris Kit.app"}');
    f.files.set(`${DIR}/0.9.1/Zanaris Kit.app/Contents`, 'app');
    const service = new UpdateService(f.io);
    service.start();
    assert.deepEqual(service.view(), { kind: 'failed', version: '0.9.1', reason: "The old version couldn't be moved aside.", release: null });
    assert.equal(f.files.size, 0);
    assert.equal(service.installAtQuit(false), false);
});

test('a launch finds a finished download ready, and throws away a stale one', () => {
    const f = fake();
    f.files.set(`${DIR}/ready.json`, '{"version":"0.9.1","file":"Zanaris Kit.app"}');
    f.files.set(`${DIR}/0.9.1/Zanaris Kit.app/Contents`, 'app');
    f.files.set(`${DIR}/.incoming/half.zip`, 'half');
    const ready = new UpdateService(f.io);
    ready.start();
    assert.deepEqual(ready.view(), { kind: 'ready', version: '0.9.1' });
    assert.equal(f.files.has(`${DIR}/.incoming/half.zip`), false);
    const stale = fake({ current: '0.9.1' });
    stale.files.set(`${DIR}/ready.json`, '{"version":"0.9.1","file":"Zanaris Kit.app"}');
    stale.files.set(`${DIR}/0.9.1/Zanaris Kit.app/Contents`, 'app');
    new UpdateService(stale.io).start();
    assert.equal(stale.files.size, 0);
});

test('Not Now hides the button until a check is asked for', async () => {
    const f = fake();
    const service = new UpdateService(f.io);
    await service.check();
    service.dismiss();
    assert.equal(service.button(), null);
    await service.check();
    assert.equal(service.button(), null, 'a scheduled check keeps it hidden');
    await service.check(true);
    assert.equal(service.button()?.label, 'Update 0.9.1');
});
```

- [ ] **Step 2: Run to see them fail** — `node --test src/main/updater/service.test.ts` → FAIL, `./service.ts` does not exist.

- [ ] **Step 3: Write `src/main/updater/service.ts`**

```ts
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
        const { release, how } = s;
        const asset = release.asset;
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
```

- [ ] **Step 4: Run** — `node --test src/main/updater/service.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/main/updater && git commit -m "feat: the update service, from a release noticed to its hand-off at quit"`

---

### Task 4: Wiring, the real io, and the button

**Files:**
- Create: `src/main/updater/electron.ts`
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/serverWindow.ts` (`ServerWindowDeps`, `state()`), `src/main/menu.ts`, `src/main/index.ts`, `src/renderer/Shell.tsx`

**Interfaces:**
- Consumes: `UpdateService`, `UpdateIo` (Task 3); `feedFrom`, `installMode`, `MAC_HELPER`, `HandOff`, `InstallFacts`, `updateQuestion`, `UpdateAction` (Task 1).
- Produces: `IPC.updatePress = 'zanaris:update-press'`; `interface UpdateButton { label: string; title: string }`; `ShellState.update: UpdateButton | null`; `ZanarisApi.update.press(): Promise<void>`; `ServerWindowDeps.update: () => UpdateButton | null`; `MenuActions.checkForUpdates(): void`; `updateIo(log): UpdateIo`.

- [ ] **Step 1: `src/shared/ipc.ts`** — add `updatePress: 'zanaris:update-press'` at the end of `IPC`; before `ShellState` add

```ts
/** The tab bar's update button, the same in every window: main words it (`update.updateButton`), and a press asks about it. */
export interface UpdateButton {
    label: string;
    title: string;
}
```

in `ShellState`, after `sharingWithoutPane`:

```ts
    /** The kit's own update, while there is one to act on and Not Now has not hidden it. */
    update: UpdateButton | null;
```

and in `ZanarisApi`, after `share`:

```ts
    update: {
        /** The tab bar's update button: main asks, in a dialog on this window, what it should do. */
        press(): Promise<void>;
    };
```

- [ ] **Step 2: `src/preload/index.ts`** — after the `share` block: `update: { press: () => ipcRenderer.invoke(IPC.updatePress) },`

- [ ] **Step 3: `src/main/serverWindow.ts`** — import `type UpdateButton` alongside the other `../shared/ipc` imports; in `ServerWindowDeps`, after `theme`:

```ts
    /** The tab bar's update button: `UpdateService.button()`. A getter, since main pushes every window when it changes. */
    update: () => UpdateButton | null;
```

and in `state()`, after `sharingWithoutPane`: `update: deps.update(),`

- [ ] **Step 4: `src/main/menu.ts`** — delete the `LatestRelease` import and `installMenu`'s `update` parameter; in `MenuActions` add

```ts
    /** Check for Updates…: asks GitHub now, and says what it found. */
    checkForUpdates(): void;
```

in the Mac app menu after `{ role: 'about' },` add `{ label: 'Check for Updates…', click: () => actions.checkForUpdates() },`; in Help replace the `Update Available` line with `...(isMac ? [] : [{ label: 'Check for Updates…', click: () => actions.checkForUpdates() }, { type: 'separator' as const }]),`; and drop "and once more when a newer release is found" from the docstring above `MenuWindowState`.

- [ ] **Step 5: `src/main/updater/electron.ts`**

```ts
import { app, net } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { accessSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { APP_ID } from '../branding.ts';
import { downloadChecked } from '../download.ts';
import { feedFrom, installMode, MAC_HELPER, type HandOff } from '../update.ts';
import type { UpdateIo } from './service.ts';

const run = promisify(execFile);

function writable(path: string): boolean {
    try {
        accessSync(path, constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Starts an install as the kit exits. Nothing is waited for: the Mac's helper
 * and the Windows installer outlive the kit, and the AppImage's replacement is
 * done before this returns. An AppImage that cannot be replaced says so in the
 * result file, which the next launch reads, as the Mac's helper does.
 */
function handOff(plan: HandOff): void {
    switch (plan.kind) {
        case 'mac':
            spawn('/bin/sh', ['-c', MAC_HELPER, 'zanaris-update', ...plan.args], { detached: true, stdio: 'ignore' }).unref();
            return;
        case 'windows':
            spawn(plan.installer, plan.args, { detached: true, stdio: 'ignore' }).unref();
            return;
        case 'appimage':
            try {
                copyFileSync(plan.from, plan.part);
                chmodSync(plan.part, 0o755);
                renameSync(plan.part, plan.to);
                if (plan.remove) rmSync(plan.remove, { force: true });
                writeFileSync(plan.result, 'ok');
            } catch (err) {
                rmSync(plan.part, { force: true });
                writeFileSync(plan.result, `The AppImage couldn't be replaced: ${(err as Error).message}`);
                return;
            }
            if (plan.relaunch) spawn(plan.to, [], { detached: true, stdio: 'ignore' }).unref();
    }
}

/** The update's io over Electron and the file system. It decides nothing: `update.ts` does. */
export function updateIo(log: (msg: string) => void): UpdateIo {
    const feed = feedFrom(process.env.ZANARIS_UPDATE_FEED);
    if (feed.latest !== feedFrom(undefined).latest) log(`[update] reading releases from ${feed.latest}`);
    return {
        current: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        dir: join(app.getPath('userData'), 'updates'),
        join,
        feed,
        mode: installMode({ platform: process.platform, packaged: app.isPackaged, execPath: process.execPath, appImage: process.env.APPIMAGE, exists: existsSync, writable }),
        pid: process.pid,
        fetchLatest: async () => {
            const res = await net.fetch(feed.latest, {
                signal: AbortSignal.timeout(8_000),
                headers: { Accept: 'application/vnd.github+json', 'User-Agent': `zanaris-kit/${app.getVersion()}` }
            });
            // GitHub's answer while the repository has no release that is not a prerelease.
            if (res.status === 404) return null;
            if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}.`);
            return res.json();
        },
        // net.fetch rather than Node's: it follows the system proxy, as the rest of the kit's requests do.
        download: (asset, to, onProgress, signal) =>
            downloadChecked({ url: asset.url, file: asset.name, size: asset.size, sha256: asset.sha256, to, fetch: (url, init) => net.fetch(url, init), onProgress, signal }),
        unpack: async (zip, into) => {
            mkdirSync(into, { recursive: true });
            // ditto, not unzip: it keeps the framework's symlinks, and with them the signature.
            await run('/usr/bin/ditto', ['-x', '-k', zip, into]);
        },
        checkApp: async (bundle, version) => {
            try {
                await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
            } catch {
                return "The download's signature doesn't check out.";
            }
            const plist = join(bundle, 'Contents', 'Info.plist');
            const read = async (key: string): Promise<string> => (await run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist])).stdout.trim();
            try {
                if ((await read('CFBundleIdentifier')) !== APP_ID) return "The download isn't Zanaris Kit.";
                if ((await read('CFBundleShortVersionString')) !== version) return `The download isn't version ${version}.`;
            } catch {
                return "The download isn't an app the kit can read.";
            }
            return null;
        },
        fs: {
            exists: existsSync,
            readText: path => readFileSync(path, 'utf8'),
            writeText: (path, text) => {
                mkdirSync(join(path, '..'), { recursive: true });
                writeFileSync(path, text);
            },
            mkdir: path => mkdirSync(path, { recursive: true }),
            rm: path => rmSync(path, { recursive: true, force: true }),
            rename: renameSync
        },
        handOff,
        log
    };
}
```

- [ ] **Step 6: `src/main/index.ts`**
  1. Imports: replace `import { checkLatest, RELEASES_LATEST, type LatestRelease } from './update';` with `import { updateQuestion, type UpdateAction } from './update';`, `import { UpdateService } from './updater/service';`, `import { updateIo } from './updater/electron';`; make sure `worldRunning` is imported from `../shared/homeserver`.
  2. Replace `let update: LatestRelease | null = null;` and its docstring with:

  ```ts
  /** The kit's own update. Read from disk at launch (`start`) and asked of GitHub once the app is ready. */
  const updates = new UpdateService(updateIo(log));
  /** Restart to Update: the quit it starts opens the new version afterwards. */
  let restartForUpdate = false;
  /** How often a running kit asks again: a player may leave it open for days. */
  const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;
  ```

  3. `installAppMenu`: drop the `update` argument.
  4. Replace `checkForUpdate` with:

  ```ts
  /**
   * The automatic checks: once as the app starts and every six hours after.
   * Every failure is logged and otherwise ignored. Not in a capture, and not
   * with ZANARIS_NO_UPDATE_CHECK, which leaves Check for Updates… working.
   */
  function startUpdateChecks(): void {
      if (CAPTURE_DIR || process.env.ZANARIS_NO_UPDATE_CHECK) return;
      void updates.check();
      setInterval(() => void updates.check(), UPDATE_CHECK_MS);
  }

  /** The update's dialog, on `win` as a sheet when there is one, and what its answer does. */
  async function askAboutUpdate(win: BrowserWindow | null): Promise<void> {
      const question = updateQuestion(updates.view(), homeServer ? worldRunning(homeServer.view().status) : false);
      if (!question) return;
      const options: MessageBoxOptions = {
          type: 'question',
          buttons: question.buttons.map(b => b.label),
          defaultId: 0,
          cancelId: question.buttons.length - 1,
          message: question.message,
          detail: question.detail
      };
      const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
      const action: UpdateAction | undefined = question.buttons[response]?.action;
      switch (action) {
          case 'download':
              void updates.download();
              return;
          case 'page':
              actions.openExternal(question.page);
              return;
          case 'not-now':
              updates.dismiss();
              return;
          case 'cancel-download':
              updates.cancel();
              return;
          case 'restart':
              restartForUpdate = true;
              app.quit();
              return;
          case 'retry': {
              const outcome = await updates.retry();
              if (outcome?.kind === 'error') await showUpdateCheckFailed(win, outcome.reason);
              return;
          }
          default:
              return;
      }
  }

  async function showUpdateCheckFailed(win: BrowserWindow | null, reason: string): Promise<void> {
      const options: MessageBoxOptions = { type: 'warning', message: "Couldn't check for updates.", detail: reason };
      await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
  }

  /** Check for Updates…: asks now, and says what it found, on the window in front. */
  async function checkForUpdatesNow(): Promise<void> {
      const outcome = await updates.check(true);
      const win = focusedServerWindow()?.window ?? null;
      if (outcome.kind === 'newer') return askAboutUpdate(win);
      if (outcome.kind === 'error') return showUpdateCheckFailed(win, outcome.reason);
      const options: MessageBoxOptions = { type: 'info', message: `Zanaris Kit ${app.getVersion()} is the newest version.` };
      await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
  }
  ```

  (Import `BrowserWindow` and `MessageBoxOptions` from `electron` if not already.)
  5. In `actions`, add `checkForUpdates: () => void checkForUpdatesNow(),` and change the `openExternal` comment's "and the update item's url came off the network" to "which is all built in the kit, but a menu is no place to trust that".
  6. In the `createServerWindow` deps object, add `update: () => updates.button(),`.
  7. After `ipcMain.handle(IPC.tabShowHomeServer, …)`:

  ```ts
  ipcMain.handle(IPC.updatePress, event => askAboutUpdate(windowFor(event.sender)?.window ?? null));
  ```

  8. At the top of the `app.whenReady().then(async () => {` body: `updates.start();` and `updates.subscribe(() => { for (const sw of serverWindows.values()) sw.pushState(); });`; replace `void checkForUpdate();` with `startUpdateChecks();`.
  9. After the `before-quit` handler:

  ```ts
  /*
   * The update installs here, not in before-quit: this runs after the world
   * and the share have stopped and every window has closed, just before the
   * process ends — which the Windows installer needs, since it closes a kit
   * still running after about a second. Quitting never asks, and a ready
   * update is installed on every quit, Restart to Update's or not.
   */
  app.on('quit', () => {
      updates.installAtQuit(restartForUpdate);
  });
  ```

  10. In `continueWithNewerFiles`, change "and Help > Update Available opens it once the kit has found it." to "and the kit offers it in the tab bar once it has found it."

- [ ] **Step 7: `src/renderer/Shell.tsx`** — add after `SHARING_BOX`: `/** The tabs' height. Inline for the same reason as the boxes above. */ const UPDATE_BOX: CSSProperties = { height: 26 };`; extend the bar's first comment to read "…then Sharing while a live link has no pane to mark, then the kit's own update while there is one, then the two menus…"; and after the Sharing button:

  ```tsx
  {/*
   * The kit's own update: Update 0.9.1, Updating 42%, Restart to Update
   * or Update failed, as main words it. A press asks, in a dialog of
   * main's, what to do about it.
   */}
  {state.update && (
      <button type="button" title={state.update.title} onClick={() => void window.zanaris.update.press()} style={UPDATE_BOX} className="btn shrink-0">
          {state.update.label}
      </button>
  )}
  ```

- [ ] **Step 8: Verify** — `npm run typecheck` (clean), `npm test` (all pass), `npm run build` (succeeds).
- [ ] **Step 9: Commit** — `git add -A src && git commit -m "feat: the update button, its dialogs, and the install at quit"`

---

### Task 5: Packaging and 0.9.0

**Files:** `electron-builder.yml`, `.github/workflows/release.yml`, `package.json`, `package-lock.json`

- [ ] **Step 1:** `electron-builder.yml` — the Mac targets become

```yaml
  target:
    - target: dmg
      arch:
        - universal
    # What an installed kit updates itself from (src/main/update.ts, assetName).
    - target: zip
      arch:
        - universal
```

and the header's "single player downloads the build the player picks" becomes "your home server downloads the build the player picks".
- [ ] **Step 2:** `release.yml` — add `release/*.zip` to the dry run's upload paths, and "single player's builds" in its header becomes "your home server's builds".
- [ ] **Step 3:** `npm version 0.9.0 --no-git-tag-version`
- [ ] **Step 4:** `npm run dist` — expect `release/Zanaris-Kit-0.9.0-universal.dmg` and `release/Zanaris-Kit-0.9.0-universal.zip`. Then `ditto -x -k release/Zanaris-Kit-0.9.0-universal.zip <scratch>` and `codesign --verify --deep --strict "<scratch>/Zanaris Kit.app"` must pass: electron-builder's zip has to keep the framework's symlinks for the kit's own check to accept it.
- [ ] **Step 5: Commit** — `git commit -am "build: 0.9.0, with a Mac zip to update from"`

---

### Task 6: Docs

**Files:** `README.md`, `CLAUDE.md`, `RELEASE.md`, the spec's status line.

- [ ] **Step 1: README, Download** — replace the paragraph from "The kit checks the releases page once each time it starts" to "`ZANARIS_NO_UPDATE_CHECK=1` to turn the check off." with:

```markdown
The kit updates itself. It looks for a newer release as it starts and every
six hours after, and Check for Updates… (in the Zanaris Kit menu on macOS,
Help elsewhere) looks now. A newer one puts a button in the tab bar that
downloads it when you say so; it installs the next time you quit, or
straight away from Restart to Update. It never restarts on its own. A copy
that can't replace itself — run from the disk image, or from a folder it
can't write to — says so and opens the release page instead. Set
`ZANARIS_NO_UPDATE_CHECK=1` to turn the automatic checks off.
```

- [ ] **Step 2: README, Security posture** — add a paragraph:

```markdown
An update is one file: the latest release's download for your system, at
the size and sha-256 GitHub lists for it, from a URL the kit builds itself.
That catches a broken or cut-off download, not somebody who controls the
repository — no weaker than downloading it by hand, and with no signing
identity, nothing stronger is available. On a Mac the download must also be
a validly signed app with the kit's bundle id and the version expected
before it replaces the one in Applications.
```

- [ ] **Step 3: CLAUDE.md** — add before "## No migrations needed — for now":

```markdown
## Updates

The kit updates itself from this repository's latest release; the design is
`docs/superpowers/specs/2026-09-28-self-update-design.md`. Keep these true:

- **It never restarts on its own.** A download waits for the player's
  Download, and an install happens only in main's `quit` event — after the
  share and the world have stopped and every window has closed. Restart to
  Update is a quit that opens the kit again.
- **One file, at GitHub's size and digest, from a URL the kit builds.**
  `readRelease` takes this system's asset by its exact name and builds
  `<downloads>/<tag>/<name>`; the release body chooses neither host nor path.
  `ZANARIS_UPDATE_FEED` is honoured only on 127.0.0.1, for a rehearsal.
- **The Mac helper takes every path as an argument** (`MAC_HELPER`) and has
  none pasted into its script. Its test runs it under `/bin/sh` with a quote
  and a space in every path.
- **A failed attempt is never retried unasked.** The next launch reads
  `attempt.json`, shows the failure, and clears `updates/`; nothing installs
  until Try Again downloads it again. A throwaway app that retried on every
  launch reopened itself three times over.
- **A copy that cannot replace itself says so** rather than trying: a Mac
  copy run from a disk image or translocated (which a copy dragged out with
  Finder is not), a folder it cannot write, a Windows copy with no
  uninstaller beside it, a Linux run that is not the AppImage.

The Mac zip beside the DMG exists for this; removing it strands every
installed Mac copy on its version.
```

- [ ] **Step 4: RELEASE.md** — in step 2's macOS bullet, after "Open a server window; it should load." add "Help: the Zanaris Kit menu's Check for Updates… says this is the newest version, or offers the previous release's successor when you are checking an update." In step 3's heading example use `v0.9.0`. Replace step 4's last sentence with: "The kit's update check reads `releases/latest`, so from that moment every older installed kit shows an update button in its tab bar." Add a step:

```markdown
## 5. Update from the previous release

On each system that has the previous release installed, open it: within a
launch it shows **Update <new version>** in the tab bar. Download, then
Restart to Update. The kit that comes back should be the new version (the
About panel says so), and `<userData>/updates/` should be gone. On a Mac
the old app must not be left anywhere but the Bin.
```

- [ ] **Step 5:** the spec's status line becomes "built on `claude/v1-release-readiness-952122`".
- [ ] **Step 6: Commit** — `git commit -am "docs: the kit updates itself"`

---

### Task 7: Prove it on this Mac

- [ ] **Step 1:** Build 0.9.1 locally without committing: `npm version 0.9.1 --no-git-tag-version && npm run dist`, keep `release/Zanaris-Kit-0.9.1-universal.zip`, then `git checkout package.json package-lock.json`.
- [ ] **Step 2:** Serve a rehearsal feed from the scratchpad: `latest.json` = `{"tag_name":"v0.9.1","assets":[{"name":"Zanaris-Kit-0.9.1-universal.zip","size":<bytes>,"digest":"sha256:<shasum -a 256>"}]}`, the zip at `download/v0.9.1/Zanaris-Kit-0.9.1-universal.zip`, `python3 -m http.server 8765 --bind 127.0.0.1`.
- [ ] **Step 3:** Ask the owner before going on: the packaged kit runs on the real profile, and a running `npm run dev` holds the single-instance lock. Then install 0.9.0 from its DMG to `/Applications` and start it with `ZANARIS_UPDATE_FEED=http://127.0.0.1:8765/latest.json "/Applications/Zanaris Kit.app/Contents/MacOS/Zanaris Kit"`.
- [ ] **Step 4:** Expect **Update 0.9.1** in the tab bar; Download → **Updating N%** → **Restart to Update**; Restart → the dialog → the kit comes back as 0.9.1 (About), `updates/` gone, no `old.app`. Log lines `[update] …` in the kit's log confirm each step.
- [ ] **Step 5:** `caffeinate -d npm run capture`, then open the PNGs: every window's tab bar as before (no update button in a capture).
