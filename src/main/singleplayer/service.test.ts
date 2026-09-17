import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SINGLE_PLAYER_SETTINGS, type SinglePlayerSettings } from '../../shared/singleplayer.ts';
import { SinglePlayerService, type SinglePlayerDeps, type SpawnSpec, type WorldProcess } from './service.ts';
import type { Confirmation } from './confirm.ts';
import { buildSave } from './testSaves.ts';

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
    saves: Map<string, Uint8Array>;
    dirs: Set<string>;
    copies: [string, string][];
    processes: FakeProcess[];
    posts: string[];
    statusQueue: (number | null)[];
    clock: { now: number };
    settings: { value: SinglePlayerSettings };
    watchers: Map<string, () => void>;
    trashed: string[];
    /** How many times a directory has been listed. */
    lists: { count: number };
}

function harness(over: { staged?: boolean; stamp?: boolean; baseUrl?: string } = {}): Harness {
    const files = new Map<string, string>();
    const saves = new Map<string, Uint8Array>();
    const dirs = new Set<string>();
    const copies: [string, string][] = [];
    const processes: FakeProcess[] = [];
    const posts: string[] = [];
    const statusQueue: (number | null)[] = [];
    const clock = { now: 1_000_000 };
    const settings = { value: { ...DEFAULT_SINGLE_PLAYER_SETTINGS } };
    const watchers = new Map<string, () => void>();
    const trashed: string[] = [];
    const lists = { count: 0 };
    if (over.staged !== false) {
        files.set('/res/VERSION.json', VERSION);
        for (const tree of ['/res/data/pack', '/res/data/raw', '/res/public', '/res/view']) dirs.add(tree);
        files.set('/res/data/config/private.pem', 'priv');
        files.set('/res/data/config/public.pem', 'pub');
    }
    if (over.stamp) files.set('/home/engine.stamp', VERSION);
    const bytesAt = (p: string): Uint8Array => {
        const bytes = saves.get(p);
        if (bytes === undefined) throw new Error(`ENOENT ${p}`);
        return bytes;
    };
    const deps: SinglePlayerDeps = {
        resources: '/res',
        home: '/home',
        baseUrl: over.baseUrl ?? 'http://127.0.0.1/rs2.cgi?lowmem=1',
        settings: { get: () => ({ ...settings.value }), set: patch => void (settings.value = { ...settings.value, ...patch }) },
        join: (...parts) => parts.join('/'),
        token: (() => {
            let next = 0;
            return () => `token-${++next}`;
        })(),
        fs: {
            exists: p => files.has(p) || dirs.has(p) || saves.has(p),
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
                saves.delete(p);
            },
            rename: (from, to) => {
                if (dirs.delete(from)) dirs.add(to);
                const text = files.get(from);
                if (text !== undefined) {
                    files.delete(from);
                    files.set(to, text);
                }
                const bytes = saves.get(from);
                if (bytes !== undefined) {
                    saves.delete(from);
                    saves.set(to, bytes);
                }
            },
            copyDir: async (from, to) => {
                copies.push([from, to]);
                dirs.add(to);
            },
            readBytes: bytesAt,
            writeBytes: (p, bytes) => void saves.set(p, bytes),
            copyFile: (from, to) => void saves.set(to, bytesAt(from)),
            list: p => {
                lists.count++;
                return [...saves.keys()].filter(k => k.startsWith(`${p}/`) && !k.slice(p.length + 1).includes('/')).map(k => k.slice(p.length + 1));
            },
            stat: p => {
                const bytes = saves.get(p);
                return bytes === undefined ? null : { size: bytes.length, modified: 0, isFile: true };
            },
            trash: async p => {
                trashed.push(p);
                saves.delete(p);
            },
            watchDir: (p, onChange) => {
                watchers.set(p, onChange);
                return () => void watchers.delete(p);
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
    return { deps, files, saves, dirs, copies, processes, posts, statusQueue, clock, settings, watchers, trashed, lists };
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
    // the asset trees were copied through a staging directory and renamed into place.
    // content/ carries the maps CSVs the engine's GameMap.init() needs to load the
    // world at all, so it is an asset like the pack, not an optional extra.
    assert.equal(h.copies.length, 5);
    assert.ok(h.copies.every(([from, to]) => from.startsWith('/res/') && to.startsWith('/home/.staging/')));
    for (const tree of ['/home/data/pack', '/home/data/raw', '/home/public', '/home/view', '/home/content']) assert.ok(h.dirs.has(tree), tree);
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

test('setSettings persists, and restarts a running world with the new staff level, xp rate and members', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    await service.setSettings({ cheats: true });
    assert.equal(h.settings.value.cheats, true);
    assert.equal(h.processes.length, 0, 'a stopped world is not started by a setting');
    h.statusQueue.push(200);
    await service.acquire();
    const first = JSON.parse(h.files.get('/home/data/config/world.json')!);
    assert.equal(first.node.localStaffLevel, 4);
    assert.equal(first.node.xpRate, 1);
    assert.equal(first.node.members, true);
    for (const patch of [{ cheats: false }, { xpRate: 5 as const }, { members: false }]) {
        h.statusQueue.push(200);
        const restart = service.setSettings(patch);
        await tick();
        h.processes.at(-1)!.exit(0);
        await restart;
    }
    assert.equal(h.processes.length, 4);
    const last = JSON.parse(h.files.get('/home/data/config/world.json')!);
    assert.equal(last.node.localStaffLevel, 0);
    assert.equal(last.node.xpRate, 5);
    assert.equal(last.node.members, false);
    assert.equal(service.view().status, 'ready');
    assert.deepEqual(service.view().settings, { cheats: false, xpRate: 5, members: false });
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

const SAVES = '/home/data/players/main';

test('the first acquire makes the saves folder, reads it and watches it, once; dispose stops the watch', async () => {
    const h = harness({ stamp: true });
    h.saves.set(`${SAVES}/zezima.sav`, buildSave());
    const service = new SinglePlayerService(h.deps);
    assert.deepEqual(service.view().characters, [], 'nothing is read before a window wants the world');
    assert.equal(h.lists.count, 0);
    h.statusQueue.push(200);
    await service.acquire();
    assert.ok(h.dirs.has(SAVES));
    assert.ok(h.watchers.has(SAVES));
    assert.deepEqual(service.view().characters.map(c => c.name), ['zezima']);
    await service.acquire();
    assert.equal(h.watchers.size, 1, 'one watch however many windows');
    service.dispose();
    assert.equal(h.watchers.size, 0);
});

test('a burst of changes in the saves folder is read once, after a short wait, and pushed', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    h.statusQueue.push(200);
    await service.acquire();
    let pushes = 0;
    service.subscribe(() => pushes++);
    const before = h.lists.count;
    h.saves.set(`${SAVES}/zezima.sav`, buildSave());
    const changed = h.watchers.get(SAVES)!;
    changed();
    changed();
    changed();
    assert.equal(h.lists.count, before, 'nothing is read until the wait is over');
    await tick();
    await tick();
    assert.equal(h.lists.count, before + 1);
    assert.equal(pushes, 1);
    assert.deepEqual(service.view().characters.map(c => c.name), ['zezima']);
});

test('a status change reads the saves folder again, for a watch that missed a logout', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    h.statusQueue.push(200);
    await service.acquire();
    h.saves.set(`${SAVES}/zezima.sav`, buildSave());
    await service.stop();
    assert.deepEqual(service.view().characters.map(c => c.name), ['zezima']);
});

test('an import through the service writes the save and pushes the new list', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    h.statusQueue.push(200);
    await service.acquire();
    await service.stop();
    h.saves.set('/downloads/Zezima.sav', buildSave());
    const pick = service.pickCharacter('/downloads/Zezima.sav');
    if (!pick.ok) return assert.fail('picked a save');
    assert.equal(pick.suggestedName, 'zezima');
    let pushes = 0;
    service.subscribe(() => pushes++);
    const outcome = await service.importCharacter(pick.token, 'Zezima', async () => assert.fail('a stopped world and a free name ask nothing'));
    assert.deepEqual(outcome, { kind: 'done', name: 'zezima' });
    assert.ok(h.saves.has(`${SAVES}/zezima.sav`));
    assert.deepEqual(service.view().characters.map(c => c.name), ['zezima']);
    assert.equal(pushes, 1);
    assert.equal(service.hasCharacter('zezima'), true);
});

test('a change while the world runs asks with the reason, and a no changes nothing', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    h.statusQueue.push(200);
    await service.acquire();
    h.saves.set(`${SAVES}/zezima.sav`, buildSave());
    const asked: Confirmation[] = [];
    const outcome = await service.deleteCharacter('zezima', async question => {
        asked.push(question);
        return false;
    });
    assert.deepEqual(outcome, { kind: 'cancelled' });
    assert.match(asked[0]!.detail, /world is running\. If anyone is logged in/);
    assert.ok(h.saves.has(`${SAVES}/zezima.sav`));
    assert.deepEqual(h.trashed, []);
});

test('a refused change still reads the saves folder again and pushes it', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    h.statusQueue.push(200);
    await service.acquire();
    await service.stop();
    let pushes = 0;
    service.subscribe(() => pushes++);
    const before = h.lists.count;
    const outcome = await service.importCharacter('no-such-token', 'zezima', async () => true);
    assert.equal(outcome.kind, 'refused');
    assert.equal(h.lists.count, before + 1);
    assert.equal(pushes, 1);
});

test('rename, copy and export go through to the characters', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    h.statusQueue.push(200);
    await service.acquire();
    await service.stop();
    h.saves.set(`${SAVES}/zezima.sav`, buildSave());
    const yes = async (): Promise<boolean> => true;
    assert.deepEqual(await service.renameCharacter('zezima', 'bob', yes), { kind: 'done', name: 'bob' });
    assert.deepEqual(await service.duplicateCharacter('bob', 'bob two', yes), { kind: 'done', name: 'bob_two' });
    assert.deepEqual(service.exportCharacter('bob', '/documents/bob.sav'), { kind: 'done', name: 'bob' });
    assert.ok(h.saves.has('/documents/bob.sav'));
    assert.deepEqual(service.view().characters.map(c => c.name), ['bob', 'bob_two']);
});
