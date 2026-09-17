import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ShareStatus } from '../../shared/share.ts';
import type { CloudflaredAsset } from './cloudflared.ts';
import { ShareService, shareDialogs, type ShareDeps, type ShareRelay, type ShareTunnel } from './service.ts';

const ASSET: CloudflaredAsset = { file: 'cloudflared-darwin-arm64.tgz', size: 19_217_478, sha256: 'a'.repeat(64), archive: 'tgz', binarySha256: 'b'.repeat(64) };

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
    reject(err: unknown): void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

class FakeRelay implements ShareRelay {
    closed = 0;
    readonly port: number;
    readonly target: () => number | null;
    constructor(port: number, target: () => number | null) {
        this.port = port;
        this.target = target;
    }
    async close(): Promise<void> {
        this.closed++;
    }
}

class FakeTunnel implements ShareTunnel {
    stopped = 0;
    private readonly exit = deferred<number | null>();
    readonly exited = this.exit.promise;
    readonly url: string;
    constructor(url: string) {
        this.url = url;
    }
    die(code: number | null): void {
        this.exit.resolve(code);
    }
    async stop(): Promise<void> {
        this.stopped++;
        this.exit.resolve(0);
    }
    logs(): string[] {
        return ['2026-09-16T10:00:00Z ERR connection to edge lost'];
    }
}

interface Harness {
    deps: ShareDeps;
    downloads: { onProgress: (p: number) => void; done: Deferred<string> }[];
    relays: FakeRelay[];
    tunnels: { binary: string; port: number; signal: AbortSignal; done: Deferred<ShareTunnel> }[];
    world: { port: number | null };
}

function harness(over: { asset?: CloudflaredAsset | null } = {}): Harness {
    const downloads: Harness['downloads'] = [];
    const relays: FakeRelay[] = [];
    const tunnels: Harness['tunnels'] = [];
    const world = { port: 40001 as number | null };
    const deps: ShareDeps = {
        asset: over.asset === undefined ? ASSET : over.asset,
        ensureBinary: onProgress => {
            const done = deferred<string>();
            downloads.push({ onProgress, done });
            return done.promise;
        },
        startRelay: async target => {
            const relay = new FakeRelay(50000 + relays.length, target);
            relays.push(relay);
            return relay;
        },
        startTunnel: (binary, port, signal) => {
            const done = deferred<ShareTunnel>();
            tunnels.push({ binary, port, signal, done });
            return done.promise;
        },
        worldPort: () => world.port,
        log: () => {}
    };
    return { deps, downloads, relays, tunnels, world };
}

const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

async function goLive(h: Harness, service: ShareService, url = 'https://calm-river.trycloudflare.com'): Promise<FakeTunnel> {
    const started = service.start();
    await tick();
    h.downloads.at(-1)!.done.resolve('/cf/cloudflared');
    await tick();
    const tunnel = new FakeTunnel(url);
    h.tunnels.at(-1)!.done.resolve(tunnel);
    await started;
    return tunnel;
}

test('sharing starts off, and says whether this platform can share at all', () => {
    assert.deepEqual(new ShareService(harness().deps).view(), { status: 'off', url: null, progress: null, reason: null, available: true });
    assert.equal(new ShareService(harness({ asset: null }).deps).view().available, false);
});

test('on a platform with no cloudflared, starting does nothing', async () => {
    const h = harness({ asset: null });
    const service = new ShareService(h.deps);
    await service.start();
    assert.equal(service.view().status, 'off');
    assert.equal(h.downloads.length, 0);
});

test('a share downloads, then opens the relay and the tunnel to it, then goes live on the game page', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const seen: ShareStatus[] = [];
    service.subscribe(() => {
        const status = service.view().status;
        if (seen.at(-1) !== status) seen.push(status);
    });
    const tunnel = await goLive(h, service);
    assert.deepEqual(seen, ['downloading', 'connecting', 'live']);
    assert.equal(h.relays.length, 1);
    assert.equal(h.tunnels[0]!.binary, '/cf/cloudflared');
    assert.equal(h.tunnels[0]!.port, h.relays[0]!.port);
    assert.deepEqual(service.view(), { status: 'live', url: `${tunnel.url}/rs2.cgi`, progress: null, reason: null, available: true });
});

test('the relay asks for the world\'s port every time, so a restart moves it and does not end the share', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    await goLive(h, service);
    const relay = h.relays[0]!;
    assert.equal(relay.target(), 40001);
    h.world.port = null;
    assert.equal(relay.target(), null);
    h.world.port = 40077;
    assert.equal(relay.target(), 40077);
    assert.equal(service.view().status, 'live');
});

test('download progress is shown, and only a whole-percent change is worth telling the windows about', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    let notified = 0;
    void service.start();
    await tick();
    service.subscribe(() => notified++);
    const { onProgress } = h.downloads[0]!;
    onProgress(0.001);
    onProgress(0.004);
    assert.equal(notified, 0);
    onProgress(0.5);
    assert.equal(notified, 1);
    assert.equal(service.view().progress, 0.5);
    onProgress(0.503);
    assert.equal(notified, 1);
    assert.equal(service.view().progress, 0.503);
});

test('starting again while a share is on its way is the same share', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const a = service.start();
    const b = service.start();
    await tick();
    assert.equal(h.downloads.length, 1);
    h.downloads[0]!.done.resolve('/cf/cloudflared');
    await tick();
    h.tunnels[0]!.done.resolve(new FakeTunnel('https://x.trycloudflare.com'));
    await Promise.all([a, b]);
    assert.equal(h.relays.length, 1);
    await service.start();
    assert.equal(h.tunnels.length, 1);
});

test('a failed download is reported, and nothing is opened', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const started = service.start();
    await tick();
    h.downloads[0]!.done.reject(new Error('cloudflared-darwin-arm64.tgz failed its checksum'));
    await started;
    assert.equal(service.view().status, 'failed');
    assert.match(service.view().reason!, /failed its checksum/);
    assert.equal(h.relays.length, 0);
    assert.equal(h.tunnels.length, 0);
});

test('a tunnel that cannot open is reported, and the relay is closed', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const started = service.start();
    await tick();
    h.downloads[0]!.done.resolve('/cf/cloudflared');
    await tick();
    h.tunnels[0]!.done.reject(new Error('cloudflared did not connect within 30 s'));
    await started;
    assert.equal(service.view().status, 'failed');
    assert.match(service.view().reason!, /did not connect/);
    assert.equal(h.relays[0]!.closed, 1);
});

test('a tunnel that dies while live ends the share, says why, and closes the relay', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const tunnel = await goLive(h, service);
    tunnel.die(1);
    await tick();
    assert.equal(service.view().status, 'failed');
    assert.equal(service.view().url, null);
    assert.match(service.view().reason!, /code 1/);
    assert.match(service.view().reason!, /connection to edge lost/);
    assert.equal(h.relays[0]!.closed, 1);
});

test('stopping a live share stops the tunnel, closes the relay, and is not then reported as a failure', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const tunnel = await goLive(h, service);
    await service.stop();
    assert.equal(tunnel.stopped, 1);
    assert.equal(h.relays[0]!.closed, 1);
    await tick();
    assert.deepEqual(service.view(), { status: 'off', url: null, progress: null, reason: null, available: true });
});

test('stopping during the download leaves nothing to open once it finishes', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const started = service.start();
    await tick();
    await service.stop();
    assert.equal(service.view().status, 'off');
    h.downloads[0]!.done.resolve('/cf/cloudflared');
    await started;
    await tick();
    assert.equal(h.relays.length, 0);
    assert.equal(service.view().status, 'off');
});

test('sharing again while an abandoned download is still running waits for that download rather than starting another', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    void service.start();
    await tick();
    await service.stop();
    const again = service.start();
    await tick();
    assert.equal(h.downloads.length, 1);
    h.downloads[0]!.done.resolve('/cf/cloudflared');
    await tick();
    h.tunnels[0]!.done.resolve(new FakeTunnel('https://again.trycloudflare.com'));
    await again;
    assert.equal(service.view().status, 'live');
});

test('stopping while the tunnel connects cancels it and closes the relay', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const started = service.start();
    await tick();
    h.downloads[0]!.done.resolve('/cf/cloudflared');
    await tick();
    const stopped = service.stop();
    assert.equal(h.tunnels[0]!.signal.aborted, true);
    h.tunnels[0]!.done.reject(new Error('Sharing was cancelled'));
    await Promise.all([started, stopped]);
    assert.equal(service.view().status, 'off');
    assert.equal(h.relays[0]!.closed, 1);
});

test('a tunnel that opens after its share was stopped is stopped at once', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const started = service.start();
    await tick();
    h.downloads[0]!.done.resolve('/cf/cloudflared');
    await tick();
    const stopped = service.stop();
    const late = new FakeTunnel('https://late.trycloudflare.com');
    h.tunnels[0]!.done.resolve(late);
    await Promise.all([started, stopped]);
    assert.equal(late.stopped, 1);
    assert.equal(h.relays[0]!.closed, 1);
    assert.equal(service.view().status, 'off');
});

test('stops asked for at once share one stop', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const tunnel = await goLive(h, service);
    await Promise.all([service.stop(), service.stop()]);
    assert.equal(tunnel.stopped, 1);
    assert.equal(h.relays[0]!.closed, 1);
});

test('the last single-player window to close stops sharing, and not before', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    service.acquire();
    service.acquire();
    const tunnel = await goLive(h, service);
    service.release();
    await tick();
    assert.equal(service.view().status, 'live');
    service.release();
    await tick();
    assert.equal(tunnel.stopped, 1);
    assert.equal(service.view().status, 'off');
});

test('a failed share can be tried again', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const first = service.start();
    await tick();
    h.downloads[0]!.done.reject(new Error('HTTP 503'));
    await first;
    assert.equal(service.view().status, 'failed');
    await goLive(h, service);
    assert.equal(service.view().status, 'live');
    assert.equal(service.view().reason, null);
});

test('a window that throws while being told does not stop the others hearing', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    let heard = 0;
    service.subscribe(() => {
        throw new Error('gone');
    });
    service.subscribe(() => heard++);
    void service.start();
    await tick();
    assert.ok(heard > 0);
});

test('the first share asks to download cloudflared, naming the file, its size and where it comes from', () => {
    const [download, share] = shareDialogs({ asset: ASSET, installed: false, cheats: false });
    assert.equal(download!.kind, 'download');
    assert.match(download!.detail, /cloudflared-darwin-arm64\.tgz/);
    assert.match(download!.detail, /19\.2 MB/);
    assert.match(download!.detail, /github\.com\/cloudflare\/cloudflared/);
    assert.equal(share!.kind, 'share');
});

test('once cloudflared is here, only the share itself is asked about', () => {
    const dialogs = shareDialogs({ asset: ASSET, installed: true, cheats: false });
    assert.deepEqual(dialogs.map(d => d.kind), ['share']);
});

test('the share dialog says anyone with the link can be any character, and that cheats go with it when on', () => {
    const [off] = shareDialogs({ asset: ASSET, installed: true, cheats: false });
    const [on] = shareDialogs({ asset: ASSET, installed: true, cheats: true });
    for (const dialog of [off!, on!]) {
        assert.match(dialog.detail, /anyone who has the link/i);
        assert.match(dialog.detail, /any character, yours included/i);
        assert.match(dialog.detail, /changes every time/i);
        assert.equal(dialog.confirm, 'Share');
    }
    assert.doesNotMatch(off!.detail, /cheat/i);
    assert.match(on!.detail, /cheats are on/i);
});

test('sharing again while a stop is finishing waits for it, then starts afresh', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const tunnel = await goLive(h, service);
    let stopFinished = false;
    const stopping = service.stop().then(() => {
        stopFinished = true;
    });
    const again = service.start();
    assert.equal(h.downloads.length, 1, 'nothing new until the stop is done');
    await stopping;
    await tick();
    assert.ok(stopFinished);
    assert.equal(tunnel.stopped, 1);
    assert.equal(h.downloads.length, 2);
    h.downloads[1]!.done.resolve('/cf/cloudflared');
    await tick();
    h.tunnels[1]!.done.resolve(new FakeTunnel('https://second.trycloudflare.com'));
    await again;
    assert.equal(service.view().url, 'https://second.trycloudflare.com/rs2.cgi');
});

test('closing the last window after a failure clears it', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    service.acquire();
    const started = service.start();
    await tick();
    h.downloads[0]!.done.reject(new Error('HTTP 503'));
    await started;
    assert.equal(service.view().status, 'failed');
    service.release();
    await tick();
    assert.deepEqual(service.view(), { status: 'off', url: null, progress: null, reason: null, available: true });
});
