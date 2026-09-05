import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WorldsService, type WorldsIo } from './service.ts';
import type { WorldsDef } from '../../shared/worlds.ts';

const LOSTHQ_JSON: unknown = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'losthq-worlds.json'), 'utf8'));

const LOSTCITY: WorldsDef = {
    source: { kind: 'losthq', url: 'https://2004.losthq.rs/pages/api/worlds.php' },
    template: 'https://w{world}-2004.lostcity.rs/rs2.cgi?plugin=0&world={world}&lowmem={lowmem}',
    detail: true,
    defaultWorld: 5
};
const LABS: WorldsDef = {
    source: { kind: 'static', worlds: [1, 2, 3].map(id => ({ id, name: `World ${id}`, region: 'Germany', members: true })) },
    template: 'https://www.lostcitylabs.com/play/world-{world}/',
    detail: false,
    defaultWorld: 1
};

interface Fake {
    io: WorldsIo;
    fetches: string[];
    probes: string[];
    clock: { now: number };
    fail: (message: string | null) => void;
    latency: (ms: number | null) => void;
}

function fake(): Fake {
    const clock = { now: 1_000_000 };
    let failure: string | null = null;
    let ms: number | null = 40;
    const fetches: string[] = [];
    const probes: string[] = [];
    const io: WorldsIo = {
        fetchJson: async url => {
            fetches.push(url);
            if (failure) throw new Error(failure);
            return LOSTHQ_JSON;
        },
        probe: async (host, port) => {
            probes.push(`${host}:${port}`);
            return ms;
        },
        now: () => clock.now
    };
    return { io, fetches, probes, clock, fail: m => { failure = m; }, latency: v => { ms = v; } };
}

test('list fetches once and reports the rows, the time, and ready', async () => {
    const f = fake();
    const service = new WorldsService(LOSTCITY, f.io);
    assert.equal(service.view().status, 'idle');
    const view = await service.list();
    assert.equal(view.status, 'ready');
    assert.equal(view.fetchedAt, 1_000_000);
    assert.deepEqual(
        view.worlds.map(w => w.id),
        [1, 2, 3, 5, 7]
    );
    assert.equal(view.worlds[0]!.latencyMs, null, 'nothing probed yet');
    assert.deepEqual(f.fetches, ['https://2004.losthq.rs/pages/api/worlds.php']);
});

test('a second list inside the cache window does not fetch; force does', async () => {
    const f = fake();
    const service = new WorldsService(LOSTCITY, f.io, { cacheMs: 30_000 });
    await service.list();
    f.clock.now += 10_000;
    await service.list();
    assert.equal(f.fetches.length, 1, 'served from cache');
    await service.list(true);
    assert.equal(f.fetches.length, 2, 'force bypasses the cache');
    f.clock.now += 31_000;
    await service.list();
    assert.equal(f.fetches.length, 3, 'stale after the window');
});

test('concurrent callers share one fetch', async () => {
    const f = fake();
    const service = new WorldsService(LOSTCITY, f.io);
    await Promise.all([service.list(), service.list(), service.list()]);
    assert.equal(f.fetches.length, 1);
});

test('a failed fetch keeps the last good list and reports the error', async () => {
    const f = fake();
    const service = new WorldsService(LOSTCITY, f.io);
    await service.list();
    f.fail('boom');
    const view = await service.list(true);
    assert.equal(view.status, 'error');
    assert.equal(view.error, 'boom');
    assert.equal(view.worlds.length, 5, 'the old rows stay');
    assert.equal(view.fetchedAt, 1_000_000, 'and so does their time');
});

test('a failed first fetch leaves no rows and an error, then recovers', async () => {
    const f = fake();
    f.fail('offline');
    const service = new WorldsService(LOSTCITY, f.io);
    const failed = await service.list();
    assert.equal(failed.status, 'error');
    assert.equal(failed.worlds.length, 0);
    f.fail(null);
    const ok = await service.list(true);
    assert.equal(ok.status, 'ready');
    assert.equal(ok.error, null);
});

test('probeAll measures each distinct host once and lands the figures on the rows', async () => {
    const f = fake();
    const service = new WorldsService(LOSTCITY, f.io);
    await service.list();
    await service.probeAll('low');
    assert.deepEqual(f.probes, [1, 2, 3, 5, 7].map(n => `w${n}-2004.lostcity.rs:443`));
    assert.ok(service.view().worlds.every(w => w.latencyMs === 40));
});

test('probeAll dedupes worlds that share a host', async () => {
    const f = fake();
    const service = new WorldsService(LABS, f.io);
    await service.list();
    await service.probeAll('low');
    assert.deepEqual(f.probes, ['www.lostcitylabs.com:443']);
    assert.ok(service.view().worlds.every(w => w.latencyMs === 40));
});

test('latency survives a list refresh', async () => {
    const f = fake();
    const service = new WorldsService(LOSTCITY, f.io);
    await service.list();
    await service.probeAll('low');
    await service.list(true);
    assert.equal(service.view().worlds[3]!.latencyMs, 40);
});

test('a probe pass already running is not started twice', async () => {
    const f = fake();
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let probes = 0;
    const io: WorldsIo = { ...f.io, probe: async () => { probes += 1; await gate; return 12; } };
    const service = new WorldsService(LOSTCITY, io);
    await service.list();
    const first = service.probeAll('low');
    const second = service.probeAll('low');
    release();
    await Promise.all([first, second]);
    assert.equal(probes, 5, 'one pass, five hosts');
});

test('subscribers hear every change and can unsubscribe', async () => {
    const f = fake();
    const service = new WorldsService(LOSTCITY, f.io);
    const seen: string[] = [];
    const off = service.subscribe(view => seen.push(view.status));
    await service.list();
    assert.deepEqual(seen, ['loading', 'ready']);
    off();
    await service.probeAll('low');
    assert.equal(seen.length, 2, 'nothing after unsubscribing');
});

test('view returns copies', async () => {
    const f = fake();
    const service = new WorldsService(LOSTCITY, f.io);
    await service.list();
    service.view().worlds[0]!.latencyMs = 999;
    assert.equal(service.view().worlds[0]!.latencyMs, null);
});
