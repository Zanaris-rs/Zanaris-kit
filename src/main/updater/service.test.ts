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
