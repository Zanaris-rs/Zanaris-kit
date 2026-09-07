import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SinglePlayerService, type SinglePlayerDeps, type SpawnSpec, type WorldProcess } from './service.ts';

const VERSION = JSON.stringify({ engine: { repo: 'r', commit: 'e1' }, content: { repo: 'c', commit: 'c1' }, revision: 274, built: '2026-09-06T00:00:00.000Z' });

/** A controllable world: lines it prints, and when it exits. */
class FakeProcess implements WorldProcess {
    killed = 0;
    private resolveExit!: (code: number | null) => void;
    readonly exited = new Promise<number | null>(resolve => {
        this.resolveExit = resolve;
    });
    readonly spec: SpawnSpec;
    constructor(spec: SpawnSpec) {
        this.spec = spec;
    }
    print(line: string): void {
        this.spec.onLine(line);
    }
    exit(code: number | null): void {
        this.resolveExit(code);
    }
    kill(): void {
        this.killed++;
        this.resolveExit(null);
    }
}

interface Harness {
    deps: SinglePlayerDeps;
    files: Map<string, string>;
    dirs: Set<string>;
    copies: [string, string][];
    processes: FakeProcess[];
    posts: string[];
    statusQueue: (number | null)[];
    clock: { now: number };
    cheats: { value: boolean };
}

function harness(over: { staged?: boolean; stamp?: boolean; baseUrl?: string } = {}): Harness {
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    const copies: [string, string][] = [];
    const processes: FakeProcess[] = [];
    const posts: string[] = [];
    const statusQueue: (number | null)[] = [];
    const clock = { now: 1_000_000 };
    const cheats = { value: false };
    if (over.staged !== false) {
        files.set('/res/VERSION.json', VERSION);
        for (const tree of ['/res/data/pack', '/res/data/raw', '/res/public', '/res/view']) dirs.add(tree);
        files.set('/res/data/config/private.pem', 'priv');
        files.set('/res/data/config/public.pem', 'pub');
    }
    if (over.stamp) files.set('/home/engine.stamp', VERSION);
    const deps: SinglePlayerDeps = {
        resources: '/res',
        home: '/home',
        baseUrl: over.baseUrl ?? 'http://127.0.0.1/rs2.cgi?lowmem=1',
        cheats: { get: () => cheats.value, set: v => void (cheats.value = v) },
        join: (...parts) => parts.join('/'),
        fs: {
            exists: p => files.has(p) || dirs.has(p),
            readText: p => {
                const text = files.get(p);
                if (text === undefined) throw new Error(`ENOENT ${p}`);
                return text;
            },
            writeText: (p, text) => void files.set(p, text),
            appendText: (p, text) => void files.set(p, (files.get(p) ?? '') + text),
            mkdir: p => void dirs.add(p),
            rm: p => {
                files.delete(p);
                dirs.delete(p);
            },
            rename: (from, to) => {
                if (dirs.delete(from)) dirs.add(to);
                const text = files.get(from);
                if (text !== undefined) {
                    files.delete(from);
                    files.set(to, text);
                }
            },
            copyDir: async (from, to) => {
                copies.push([from, to]);
                dirs.add(to);
            }
        },
        freePort: (() => {
            let next = 40000;
            return async () => ++next;
        })(),
        spawn: spec => {
            const p = new FakeProcess(spec);
            processes.push(p);
            return p;
        },
        httpStatus: async () => (statusQueue.length > 0 ? statusQueue.shift()! : null),
        httpPost: async url => {
            posts.push(url);
            return 202;
        },
        // Virtual time: the clock jumps, but the promise settles on the next event-loop
        // turn, the way a real timer does, so a test can act between two waits.
        sleep: ms => new Promise(resolve => setImmediate(() => { clock.now += ms; resolve(); })),
        now: () => clock.now,
        log: () => {}
    };
    return { deps, files, dirs, copies, processes, posts, statusQueue, clock, cheats };
}

const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

test('the first acquire prepares the working directory, writes world.json, spawns the world and resolves when it answers', async () => {
    const h = harness();
    const service = new SinglePlayerService(h.deps);
    h.statusQueue.push(null, null, 200);
    const url = await service.acquire();
    assert.equal(url, 'http://127.0.0.1:40001/rs2.cgi?lowmem=1');
    assert.equal(service.view().status, 'ready');
    assert.equal(service.view().port, 40001);
    assert.deepEqual(service.view().version, { engine: 'e1', content: 'c1', revision: 274, built: '2026-09-06T00:00:00.000Z' });
    // the four trees were copied through a staging directory and renamed into place
    assert.equal(h.copies.length, 4);
    assert.ok(h.copies.every(([from, to]) => from.startsWith('/res/') && to.startsWith('/home/.staging/')));
    for (const tree of ['/home/data/pack', '/home/data/raw', '/home/public', '/home/view']) assert.ok(h.dirs.has(tree), tree);
    assert.equal(h.files.get('/home/data/config/private.pem'), 'priv');
    assert.equal(h.files.get('/home/engine.stamp'), VERSION);
    const world = JSON.parse(h.files.get('/home/data/config/world.json')!);
    assert.equal(world.web.port, 40001);
    assert.equal(world.web.managementPort, 40002);
    assert.equal(world.node.port, 40003);
    assert.equal(world.node.localStaffLevel, 0);
    assert.equal(h.processes.length, 1);
    assert.equal(h.processes[0]!.spec.entry, '/res/src/app.js');
    assert.equal(h.processes[0]!.spec.cwd, '/home');
    assert.equal(h.files.get('/home/world.log'), '');
});

test('a matching stamp skips the copy', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    h.statusQueue.push(200);
    await service.acquire();
    assert.equal(h.copies.length, 0);
    assert.equal(service.view().status, 'ready');
});

test('a second acquire while ready resolves at once; release to zero asks the world to stop and waits for it', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    h.statusQueue.push(200);
    const first = await service.acquire();
    const second = await service.acquire();
    assert.equal(second, first);
    assert.equal(h.processes.length, 1);
    service.release();
    assert.equal(service.view().status, 'ready');
    service.release();
    await tick();
    assert.equal(service.view().status, 'stopping');
    assert.deepEqual(h.posts, ['http://127.0.0.1:40002/shutdown']);
    h.processes[0]!.exit(0);
    await tick();
    await tick();
    assert.equal(service.view().status, 'stopped');
    assert.equal(h.processes[0]!.killed, 0);
});

test('a world that ignores the shutdown request is killed after ten seconds', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    h.statusQueue.push(200);
    await service.acquire();
    service.release();
    await tick();
    await tick();
    await tick();
    assert.equal(h.processes[0]!.killed, 1);
    assert.equal(service.view().status, 'stopped');
    assert.ok(h.clock.now >= 1_000_000 + 10_000);
});

test('a world that exits before it is ready fails with its last lines', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    const pending = service.acquire();
    await tick();
    h.processes[0]!.print('Starting world');
    h.processes[0]!.print('Error: boom');
    h.processes[0]!.exit(1);
    await assert.rejects(pending, /exited before it was ready \(code 1\)/);
    assert.equal(service.view().status, 'failed');
    assert.match(service.view().reason!, /code 1/);
    assert.deepEqual(service.view().logTail, ['Starting world', 'Error: boom']);
    assert.match(h.files.get('/home/world.log')!, /boom/);
});

test('a world that never answers fails at the deadline and is killed', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    await assert.rejects(service.acquire(), /did not answer within 60 s/);
    assert.equal(service.view().status, 'failed');
    assert.equal(h.processes[0]!.killed, 1);
});

test('retry from failed starts again without changing the window count', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    await assert.rejects(service.acquire());
    h.statusQueue.push(200);
    const url = await service.retry();
    assert.equal(service.view().status, 'ready');
    assert.equal(url, 'http://127.0.0.1:40004/rs2.cgi?lowmem=1');
    service.release();
    await tick();
    assert.equal(service.view().status, 'stopping');
});

test('setCheats persists, and restarts a running world with the new staff level', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    await service.setCheats(true);
    assert.equal(h.cheats.value, true);
    assert.equal(h.processes.length, 0);
    h.statusQueue.push(200);
    await service.acquire();
    assert.equal(JSON.parse(h.files.get('/home/data/config/world.json')!).node.localStaffLevel, 4);
    h.statusQueue.push(200);
    const restart = service.setCheats(false);
    await tick();
    h.processes[0]!.exit(0);
    await restart;
    assert.equal(h.processes.length, 2);
    assert.equal(JSON.parse(h.files.get('/home/data/config/world.json')!).node.localStaffLevel, 0);
    assert.equal(service.view().status, 'ready');
    assert.equal(service.view().cheats, false);
});

test('a crash while ready is reported as failed and subscribers hear about it', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    let pushes = 0;
    service.subscribe(() => pushes++);
    h.statusQueue.push(200);
    await service.acquire();
    const before = pushes;
    h.processes[0]!.exit(134);
    await tick();
    assert.equal(service.view().status, 'failed');
    assert.match(service.view().reason!, /stopped unexpectedly \(code 134\)/);
    assert.ok(pushes > before);
});

test('missing resources fail before anything is copied or spawned', async () => {
    const h = harness({ staged: false });
    const service = new SinglePlayerService(h.deps);
    await assert.rejects(service.acquire(), /Engine not staged/);
    assert.equal(service.view().status, 'failed');
    assert.equal(h.copies.length, 0);
    assert.equal(h.processes.length, 0);
});

test('stop while starting kills the world and leaves it stopped', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    const pending = service.acquire();
    await tick();
    const stopped = service.stop();
    await assert.rejects(pending);
    await stopped;
    assert.equal(service.view().status, 'stopped');
    assert.equal(h.processes[0]!.killed, 1);
});

test('a malformed catalog url fails before a world is spawned', async () => {
    const h = harness({ stamp: true, baseUrl: 'not a url' });
    const service = new SinglePlayerService(h.deps);
    await assert.rejects(service.acquire());
    assert.equal(service.view().status, 'failed');
    assert.equal(h.processes.length, 0);
});

test('a window that arrives while the world is stopping gets a world of its own', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    h.statusQueue.push(200);
    await service.acquire();
    service.release();
    await tick();
    assert.equal(service.view().status, 'stopping');
    h.statusQueue.push(200);
    const url = await service.acquire();
    assert.equal(url, 'http://127.0.0.1:40004/rs2.cgi?lowmem=1');
    assert.equal(h.processes.length, 2);
    // the dying world's stop must not clear the new world's state when its grace expires
    await tick();
    await tick();
    assert.equal(service.view().status, 'ready');
    assert.equal(service.view().port, 40004);
    assert.equal(service.view().url, url);
    assert.ok(h.processes[0]!.killed === 1 || h.posts.length > 0, 'the old world was asked to stop');
    assert.equal(h.processes[1]!.killed, 0);
});

test('a window that closes again during the grace leaves no world behind', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    h.statusQueue.push(200);
    await service.acquire();
    service.release();
    await tick();
    assert.equal(service.view().status, 'stopping');
    // Reopened during the grace, then closed again before the queued start could run.
    const queued = service.acquire();
    service.release();
    h.processes[0]!.exit(0);
    await assert.rejects(queued, /No window is waiting/);
    await tick();
    await tick();
    assert.equal(h.processes.length, 1, 'no second world was spawned');
    assert.equal(service.view().status, 'stopped');
});

test('a log write that throws leaves the world running, and the tail keeps the line', async () => {
    const h = harness({ stamp: true });
    h.deps.fs.appendText = () => {
        throw new Error('ENOSPC: no space left on device');
    };
    const service = new SinglePlayerService(h.deps);
    const pending = service.acquire();
    await tick();
    h.processes[0]!.print('Starting world');
    h.statusQueue.push(200);
    const url = await pending;
    assert.equal(url, 'http://127.0.0.1:40001/rs2.cgi?lowmem=1');
    assert.equal(service.view().status, 'ready');
    assert.deepEqual(service.view().logTail, ['Starting world']);
});

test('a stop while the engine is being copied leaves the service stopped with nothing spawned', async () => {
    const h = harness();
    let letCopyFinish!: () => void;
    const gate = new Promise<void>(resolve => {
        letCopyFinish = resolve;
    });
    h.deps.fs.copyDir = async (from, to) => {
        h.copies.push([from, to]);
        h.dirs.add(to);
        await gate;
    };
    const service = new SinglePlayerService(h.deps);
    const pending = service.acquire();
    await tick();
    assert.equal(service.view().status, 'preparing', 'the copy is in flight');
    const stopped = service.stop();
    letCopyFinish();
    await assert.rejects(pending, /Stopped while getting ready/);
    await stopped;
    assert.equal(service.view().status, 'stopped');
    assert.equal(h.processes.length, 0);
});

test('a world that answers and dies in the same turn fails with the exit, not the stop', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    // The only way to land an exit inside the gap between the probe and its answer.
    h.deps.httpStatus = async () => {
        h.processes[0]!.print('Error: boom');
        h.processes[0]!.exit(1);
        await tick();
        return 200;
    };
    await assert.rejects(service.acquire(), /exited before it was ready \(code 1\)/);
    assert.equal(service.view().status, 'failed');
    assert.match(service.view().reason!, /code 1/);
});

test('a listener that throws is logged and leaves the world alone', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    let others = 0;
    service.subscribe(() => {
        if (service.view().status === 'ready') throw new Error('the window is gone');
    });
    service.subscribe(() => others++);
    h.statusQueue.push(200);
    const url = await service.acquire();
    assert.equal(url, 'http://127.0.0.1:40001/rs2.cgi?lowmem=1');
    assert.equal(service.view().status, 'ready');
    assert.ok(others > 0);
    assert.equal(h.processes[0]!.killed, 0);
    await service.stop();
    assert.equal(service.view().status, 'stopped');
});

test('an unexpected failure after the spawn reaps the world, and a later stop settles at stopped', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    h.deps.httpStatus = async () => {
        throw new Error('probe blew up');
    };
    await assert.rejects(service.acquire(), /probe blew up/);
    assert.equal(service.view().status, 'failed');
    assert.equal(h.processes.length, 1);
    assert.equal(h.processes[0]!.killed, 1);
    await service.stop();
    assert.equal(service.view().status, 'stopped');
});
