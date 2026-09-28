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
