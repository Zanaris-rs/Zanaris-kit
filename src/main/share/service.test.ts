import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ShareStart, ShareStatus, ShareView, TorMode } from '../../shared/share.ts';
import type { CloudflaredAsset } from './cloudflared.ts';
import { ShareService, shareDialogs, type ShareDeps, type ShareRelay, type ShareTransport, type ShareTunnel } from './service.ts';

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
    readonly probe: { path: string; token: string };
    constructor(port: number, target: () => number | null) {
        this.port = port;
        this.target = target;
        this.probe = { path: `/.zanaris-kit/reachable/t${port}`, token: `t${port}` };
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
    readonly program: string;
    constructor(url: string, program = 'cloudflared') {
        this.url = url;
        this.program = program;
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

/** One way's transport, recording every call the service makes of it. */
interface FakeWay {
    transport: ShareTransport;
    downloads: { onProgress: (p: number) => void; done: Deferred<string> }[];
    tunnels: { binary: string; port: number; signal: AbortSignal; done: Deferred<ShareTunnel> }[];
    waits: { url: string; tunnel: ShareTunnel; probe: { path: string; token: string }; signal: AbortSignal; done: Deferred<void> }[];
}

function fakeWay(program: 'cloudflared' | 'tor'): FakeWay {
    const downloads: FakeWay['downloads'] = [];
    const tunnels: FakeWay['tunnels'] = [];
    const waits: FakeWay['waits'] = [];
    const transport: ShareTransport = {
        program,
        ensureBinary: onProgress => {
            const done = deferred<string>();
            downloads.push({ onProgress, done });
            return done.promise;
        },
        startTunnel: (binary, port, signal) => {
            const done = deferred<ShareTunnel>();
            tunnels.push({ binary, port, signal, done });
            return done.promise;
        },
        waitReachable: (tunnel, probe, signal) => {
            const done = deferred<void>();
            waits.push({ url: tunnel.url, tunnel, probe, signal, done });
            return done.promise;
        }
    };
    return { transport, downloads, tunnels, waits };
}

/** Cloudflare's calls are the harness's own fields, as they were before Tor; Tor's are under `tor`. */
interface Harness extends Omit<FakeWay, 'transport'> {
    deps: ShareDeps;
    relays: FakeRelay[];
    tor: FakeWay & { modes: TorMode[] };
    world: { port: number | null };
}

function harness(over: { cloudflare?: boolean; tor?: boolean } = {}): Harness {
    const cf = fakeWay('cloudflared');
    const tor = { ...fakeWay('tor'), modes: [] as TorMode[] };
    const relays: FakeRelay[] = [];
    const world = { port: 40001 as number | null };
    const deps: ShareDeps = {
        cloudflare: over.cloudflare === false ? null : cf.transport,
        tor:
            over.tor === false
                ? null
                : mode => {
                      tor.modes.push(mode);
                      return tor.transport;
                  },
        startRelay: async target => {
            const relay = new FakeRelay(50000 + relays.length, target);
            relays.push(relay);
            return relay;
        },
        worldPort: () => world.port,
        log: () => {}
    };
    return { deps, downloads: cf.downloads, tunnels: cf.tunnels, waits: cf.waits, relays, tor, world };
}

const CF: ShareStart = { way: 'cloudflare' };
const TOR_SINGLE: ShareStart = { way: 'tor', mode: 'single' };
const ONION = 'http://' + 'a'.repeat(56) + '.onion';

/** The view while off, on a platform that offers both ways. */
const OFF: ShareView = { status: 'off', url: null, progress: null, reason: null, offered: { cloudflare: true, tor: true }, way: null, torMode: null };

const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

/** Opens the tunnel the latest start is waiting for, and answers the check that follows it. */
async function connect(h: Harness, tunnel: FakeTunnel): Promise<void> {
    h.tunnels.at(-1)!.done.resolve(tunnel);
    await tick();
    h.waits.at(-1)!.done.resolve();
}

async function goLive(h: Harness, service: ShareService, url = 'https://calm-river.trycloudflare.com'): Promise<FakeTunnel> {
    const started = service.start(CF);
    await tick();
    h.downloads.at(-1)!.done.resolve('/cf/cloudflared');
    await tick();
    const tunnel = new FakeTunnel(url);
    await connect(h, tunnel);
    await started;
    return tunnel;
}

/** A share whose tunnel is up and whose link is being checked. */
async function goChecking(h: Harness, service: ShareService): Promise<{ started: Promise<void>; tunnel: FakeTunnel }> {
    const started = service.start(CF);
    await tick();
    h.downloads.at(-1)!.done.resolve('/cf/cloudflared');
    await tick();
    const tunnel = new FakeTunnel('https://calm-river.trycloudflare.com');
    h.tunnels.at(-1)!.done.resolve(tunnel);
    await tick();
    return { started, tunnel };
}

test('sharing starts off, and says which ways this platform can share', () => {
    assert.deepEqual(new ShareService(harness().deps).view(), OFF);
    assert.deepEqual(new ShareService(harness({ cloudflare: false }).deps).view().offered, { cloudflare: false, tor: true });
    assert.deepEqual(new ShareService(harness({ tor: false }).deps).view().offered, { cloudflare: true, tor: false });
    assert.deepEqual(new ShareService(harness({ cloudflare: false, tor: false }).deps).view().offered, { cloudflare: false, tor: false });
});

test('on a platform with no cloudflared, starting does nothing', async () => {
    const h = harness({ cloudflare: false });
    const service = new ShareService(h.deps);
    await service.start(CF);
    assert.equal(service.view().status, 'off');
    assert.equal(h.downloads.length, 0);
});

test('a share downloads, then opens the relay and the tunnel to it, checks the link, then goes live on the game page', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const seen: ShareStatus[] = [];
    service.subscribe(() => {
        const status = service.view().status;
        if (seen.at(-1) !== status) seen.push(status);
    });
    const tunnel = await goLive(h, service);
    assert.deepEqual(seen, ['downloading', 'connecting', 'checking', 'live']);
    assert.equal(h.relays.length, 1);
    assert.equal(h.tunnels[0]!.binary, '/cf/cloudflared');
    assert.equal(h.tunnels[0]!.port, h.relays[0]!.port);
    assert.deepEqual(service.view(), { ...OFF, status: 'live', url: `${tunnel.url}/rs2.cgi`, way: 'cloudflare' });
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
    void service.start(CF);
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
    const a = service.start(CF);
    const b = service.start(CF);
    await tick();
    assert.equal(h.downloads.length, 1);
    h.downloads[0]!.done.resolve('/cf/cloudflared');
    await tick();
    await connect(h, new FakeTunnel('https://x.trycloudflare.com'));
    await Promise.all([a, b]);
    assert.equal(h.relays.length, 1);
    await service.start(CF);
    assert.equal(h.tunnels.length, 1);
});

test('a failed download is reported, and nothing is opened', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const started = service.start(CF);
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
    const started = service.start(CF);
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

test('while the link is checked no link is shown, and the check is of this tunnel through this relay', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const { tunnel } = await goChecking(h, service);
    assert.deepEqual(service.view(), { ...OFF, status: 'checking', way: 'cloudflare' });
    assert.equal(h.waits.length, 1);
    assert.equal(h.waits[0]!.url, tunnel.url);
    assert.deepEqual(h.waits[0]!.probe, h.relays[0]!.probe);
    assert.equal(h.waits[0]!.signal.aborted, false);
});

test('a link that never starts working fails the share, stops cloudflared and closes the relay', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const { started, tunnel } = await goChecking(h, service);
    h.waits[0]!.done.reject(new Error("The link did not start working within 2 minutes: Cloudflare's edge still answered 530"));
    await started;
    assert.equal(service.view().status, 'failed');
    assert.equal(service.view().reason, "The link did not start working within 2 minutes: Cloudflare's edge still answered 530");
    assert.equal(tunnel.stopped, 1);
    assert.equal(h.relays[0]!.closed, 1);
    await tick();
    assert.match(service.view().reason!, /did not start working/, 'the exit the failure caused is not a second failure');
});

test('a share whose link never worked can be tried again, afresh', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const { started } = await goChecking(h, service);
    h.waits[0]!.done.reject(new Error('The link did not start working within 2 minutes'));
    await started;
    await goLive(h, service, 'https://second.trycloudflare.com');
    assert.equal(service.view().status, 'live');
    assert.equal(service.view().url, 'https://second.trycloudflare.com/rs2.cgi');
    assert.equal(h.relays.length, 2);
    assert.deepEqual(h.waits[1]!.probe, h.relays[1]!.probe);
});

test('stopping while the link is checked cancels the check, stops cloudflared and closes the relay', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const { started, tunnel } = await goChecking(h, service);
    const stopped = service.stop();
    assert.equal(h.waits[0]!.signal.aborted, true);
    assert.equal(service.view().status, 'off');
    h.waits[0]!.done.reject(new Error('Sharing was cancelled'));
    await Promise.all([started, stopped]);
    assert.equal(tunnel.stopped, 1);
    assert.equal(h.relays[0]!.closed, 1);
    assert.deepEqual(service.view(), OFF);
});

test('a check that passes after its share was stopped does not bring the link back', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const { started } = await goChecking(h, service);
    await service.stop();
    h.waits[0]!.done.resolve();
    await started;
    await tick();
    assert.deepEqual(service.view(), OFF);
});

test('cloudflared dying while the link is checked fails the share at once and cancels the check', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const { started, tunnel } = await goChecking(h, service);
    tunnel.die(1);
    await tick();
    assert.equal(service.view().status, 'failed');
    assert.match(service.view().reason!, /code 1/);
    assert.equal(h.waits[0]!.signal.aborted, true);
    assert.equal(h.relays[0]!.closed, 1);
    h.waits[0]!.done.reject(new Error('Sharing was cancelled'));
    await started;
    assert.match(service.view().reason!, /code 1/, 'the cancelled check is not reported over the reason');
});

test('stopping a live share stops the tunnel, closes the relay, and is not then reported as a failure', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const tunnel = await goLive(h, service);
    await service.stop();
    assert.equal(tunnel.stopped, 1);
    assert.equal(h.relays[0]!.closed, 1);
    await tick();
    assert.deepEqual(service.view(), OFF);
});

test('stopping during the download leaves nothing to open once it finishes', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const started = service.start(CF);
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
    void service.start(CF);
    await tick();
    await service.stop();
    const again = service.start(CF);
    await tick();
    assert.equal(h.downloads.length, 1);
    h.downloads[0]!.done.resolve('/cf/cloudflared');
    await tick();
    await connect(h, new FakeTunnel('https://again.trycloudflare.com'));
    await again;
    assert.equal(service.view().status, 'live');
});

test('stopping while the tunnel connects cancels it and closes the relay', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const started = service.start(CF);
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
    const started = service.start(CF);
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

test('the last window running your home server stops sharing as it closes, and not before', async () => {
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
    const first = service.start(CF);
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
    void service.start(CF);
    await tick();
    assert.ok(heard > 0);
});

test('the first share asks to download cloudflared, naming the file, its size and where it comes from', () => {
    const [download, share] = shareDialogs({ way: 'cloudflare', download: ASSET, cheats: false, lastTorMode: 'full' });
    assert.equal(download!.kind, 'download');
    assert.equal(download!.detail, "Downloads cloudflared-darwin-arm64.tgz (19.2 MB) from Cloudflare's GitHub, once.");
    assert.equal(share!.kind, 'share');
});

test('once cloudflared is here, only the share itself is asked about', () => {
    const dialogs = shareDialogs({ way: 'cloudflare', download: null, cheats: false, lastTorMode: 'full' });
    assert.deepEqual(dialogs.map(d => d.kind), ['share']);
});

test('the share dialog says anyone with the link can be any character, and that cheats go with it when on', () => {
    const [off] = shareDialogs({ way: 'cloudflare', download: null, cheats: false, lastTorMode: 'full' });
    const [on] = shareDialogs({ way: 'cloudflare', download: null, cheats: true, lastTorMode: 'full' });
    for (const dialog of [off!, on!]) assert.deepEqual(dialog.buttons, ['Share']);
    assert.equal(off!.detail, 'Anyone with the link can log in as any character, yours included. Only share it with people you trust. The link ends when you stop sharing or quit.');
    assert.equal(
        on!.detail,
        'Anyone with the link can log in as any character, yours included. Only share it with people you trust. Cheats work for them too. The link ends when you stop sharing or quit.'
    );
});

test('sharing again while a stop is finishing waits for it, then starts afresh', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const tunnel = await goLive(h, service);
    let stopFinished = false;
    const stopping = service.stop().then(() => {
        stopFinished = true;
    });
    const again = service.start(CF);
    assert.equal(h.downloads.length, 1, 'nothing new until the stop is done');
    await stopping;
    await tick();
    assert.ok(stopFinished);
    assert.equal(tunnel.stopped, 1);
    assert.equal(h.downloads.length, 2);
    h.downloads[1]!.done.resolve('/cf/cloudflared');
    await tick();
    await connect(h, new FakeTunnel('https://second.trycloudflare.com'));
    await again;
    assert.equal(service.view().url, 'https://second.trycloudflare.com/rs2.cgi');
});

test('closing the last window after a failure clears it', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    service.acquire();
    const started = service.start(CF);
    await tick();
    h.downloads[0]!.done.reject(new Error('HTTP 503'));
    await started;
    assert.equal(service.view().status, 'failed');
    service.release();
    await tick();
    assert.deepEqual(service.view(), OFF);
});

// ── by Tor ───────────────────────────────────────────────────────────────

/** A Tor share whose onion service is up and whose link is being checked. */
async function goCheckingTor(h: Harness, service: ShareService, how: ShareStart = TOR_SINGLE): Promise<{ started: Promise<void>; tunnel: FakeTunnel }> {
    const started = service.start(how);
    await tick();
    h.tor.downloads.at(-1)!.done.resolve('/tor/tor');
    await tick();
    const tunnel = new FakeTunnel(ONION, 'tor');
    h.tor.tunnels.at(-1)!.done.resolve(tunnel);
    await tick();
    return { started, tunnel };
}

test('a share over Tor goes the same way, downloading, connecting, checking, then live on the onion\'s game page', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const seen: ShareStatus[] = [];
    service.subscribe(() => {
        const status = service.view().status;
        if (seen.at(-1) !== status) seen.push(status);
    });
    const { started, tunnel } = await goCheckingTor(h, service);
    assert.deepEqual(service.view(), { ...OFF, status: 'checking', way: 'tor', torMode: 'single' });
    assert.equal(h.tor.waits[0]!.tunnel, tunnel);
    assert.deepEqual(h.tor.waits[0]!.probe, h.relays[0]!.probe);
    h.tor.waits[0]!.done.resolve();
    await started;
    assert.deepEqual(seen, ['downloading', 'connecting', 'checking', 'live']);
    assert.deepEqual(h.tor.modes, ['single']);
    assert.equal(h.tor.tunnels[0]!.binary, '/tor/tor');
    assert.equal(h.tor.tunnels[0]!.port, h.relays[0]!.port);
    assert.deepEqual(service.view(), { ...OFF, status: 'live', url: `${ONION}/rs2.cgi`, way: 'tor', torMode: 'single' });
    assert.equal(h.downloads.length + h.tunnels.length + h.waits.length, 0, 'Cloudflare is not asked for anything');
});

test('the way and the mode stay shown while a share fails, and go when it is stopped', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const started = service.start({ way: 'tor', mode: 'full' });
    await tick();
    assert.deepEqual(service.view(), { ...OFF, status: 'downloading', progress: 0, way: 'tor', torMode: 'full' });
    h.tor.downloads[0]!.done.reject(new Error('HTTP 503'));
    await started;
    assert.equal(service.view().way, 'tor');
    assert.equal(service.view().torMode, 'full');
    await service.stop();
    assert.deepEqual(service.view(), OFF);
});

test('the Tor transport is asked for once per start, for that start\'s mode', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const first = service.start({ way: 'tor', mode: 'full' });
    void service.start({ way: 'tor', mode: 'single' });
    await tick();
    assert.deepEqual(h.tor.modes, ['full'], 'a start while one is on its way is that share');
    h.tor.downloads[0]!.done.reject(new Error('HTTP 503'));
    await first;
    void service.start(TOR_SINGLE);
    await tick();
    assert.deepEqual(h.tor.modes, ['full', 'single']);
});

test('where Tor is not offered, starting a share over it does nothing', async () => {
    const h = harness({ tor: false });
    const service = new ShareService(h.deps);
    await service.start(TOR_SINGLE);
    assert.deepEqual(service.view(), { ...OFF, offered: { cloudflare: true, tor: false } });
});

test('stopping a Tor share while its link is checked cancels the check and stops the onion service', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const { started, tunnel } = await goCheckingTor(h, service);
    const stopped = service.stop();
    assert.equal(h.tor.waits[0]!.signal.aborted, true);
    assert.equal(service.view().status, 'off');
    h.tor.waits[0]!.done.reject(new Error('Sharing was cancelled'));
    await Promise.all([started, stopped]);
    assert.equal(tunnel.stopped, 1);
    assert.equal(h.relays[0]!.closed, 1);
    assert.deepEqual(service.view(), OFF);
});

test('Tor exiting on its own says it was tor that exited, and is still stopped so its folder goes', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const { started, tunnel } = await goCheckingTor(h, service);
    h.tor.waits[0]!.done.resolve();
    await started;
    tunnel.die(1);
    await tick();
    assert.equal(service.view().status, 'failed');
    assert.match(service.view().reason!, /^The link closed unexpectedly \(tor exited with code 1\)/);
    assert.equal(tunnel.stopped, 1);
    assert.equal(h.relays[0]!.closed, 1);
});

test('cloudflared exiting on its own is stopped too, which ends nothing more', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const tunnel = await goLive(h, service);
    tunnel.die(1);
    await tick();
    assert.equal(tunnel.stopped, 1);
    assert.match(service.view().reason!, /^The link closed unexpectedly \(cloudflared exited with code 1\)/);
});

test('one download per program: two Tor starts share one, and Cloudflare\'s is its own', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    void service.start({ way: 'tor', mode: 'full' });
    await tick();
    await service.stop();
    void service.start(TOR_SINGLE);
    await tick();
    assert.equal(h.tor.downloads.length, 1, 'the second Tor start waits on the first one\'s download');
    await service.stop();
    const cloudflare = service.start(CF);
    await tick();
    assert.equal(h.downloads.length, 1, 'Cloudflare downloads its own program alongside');
    assert.equal(h.tor.downloads.length, 1);
    h.downloads[0]!.done.resolve('/cf/cloudflared');
    await tick();
    await connect(h, new FakeTunnel('https://both.trycloudflare.com'));
    await cloudflare;
    assert.equal(service.view().status, 'live');
});

test('an abandoned download of the other program does not move this share\'s progress', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    void service.start(TOR_SINGLE);
    await tick();
    await service.stop();
    void service.start(CF);
    await tick();
    h.tor.downloads[0]!.onProgress(0.7);
    assert.equal(service.view().progress, 0);
    h.downloads[0]!.onProgress(0.2);
    assert.equal(service.view().progress, 0.2);
});

test('a failed share may be tried again the other way', async () => {
    const h = harness();
    const service = new ShareService(h.deps);
    const first = service.start(CF);
    await tick();
    h.downloads[0]!.done.reject(new Error('HTTP 503'));
    await first;
    const { started } = await goCheckingTor(h, service);
    h.tor.waits[0]!.done.resolve();
    await started;
    assert.deepEqual(service.view(), { ...OFF, status: 'live', url: `${ONION}/rs2.cgi`, way: 'tor', torMode: 'single' });
});

test('Cloudflare\'s dialogs go ahead with Download and Share', () => {
    const [download, share] = shareDialogs({ way: 'cloudflare', download: ASSET, cheats: false, lastTorMode: 'single' });
    assert.equal(download!.message, "Sharing needs Cloudflare's tunnel program.");
    assert.deepEqual(download!.buttons, ['Download']);
    assert.equal(share!.message, 'Share your home server with a link?');
    assert.deepEqual(share!.buttons, ['Share']);
});

test('the first share over Tor asks to download Tor, naming the file, its size and where it comes from', () => {
    const tor = { file: 'tor-expert-bundle-macos-aarch64-15.0.25.tar.gz', size: 21_456_789 };
    const [download, share] = shareDialogs({ way: 'tor', download: tor, cheats: false, lastTorMode: 'full' });
    assert.deepEqual(download, {
        kind: 'download',
        message: "Sharing over Tor needs Tor Project's Tor program.",
        detail: 'Downloads tor-expert-bundle-macos-aarch64-15.0.25.tar.gz (21.5 MB) from torproject.org, once.',
        buttons: ['Download']
    });
    assert.equal(share!.kind, 'share');
});

test('the Tor share offers Hide me and Faster, the mode picked last first, and says what each does', () => {
    const [full] = shareDialogs({ way: 'tor', download: null, cheats: false, lastTorMode: 'full' });
    const [single] = shareDialogs({ way: 'tor', download: null, cheats: true, lastTorMode: 'single' });
    assert.equal(full!.kind, 'share');
    assert.equal(full!.message, 'Share your home server over Tor?');
    assert.deepEqual(full!.buttons, ['Hide me', 'Faster']);
    assert.deepEqual(single!.buttons, ['Faster', 'Hide me']);
    assert.equal(
        full!.detail,
        'Anyone with the link can log in as any character, yours included. Only share it with people you trust. The link ends when you stop sharing or quit. Hide me keeps your address hidden, and is slower. Faster hides only your friends. Friends need Tor Browser.'
    );
    assert.equal(
        single!.detail,
        'Anyone with the link can log in as any character, yours included. Only share it with people you trust. Cheats work for them too. The link ends when you stop sharing or quit. Hide me keeps your address hidden, and is slower. Faster hides only your friends. Friends need Tor Browser.'
    );
});
