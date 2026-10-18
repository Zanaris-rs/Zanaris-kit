import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnProcess, TunnelError, type TunnelSpawnSpec } from './quickTunnel.ts';
import { buildTorArgs, cacheLeases, checkThroughClient, createTorLogParser, startOnion, startTorClient, torEnv, type TorCacheKind, type TorIo } from './torProcess.ts';

const FAKE = fileURLToPath(new URL('./testdata/fake-tor.mjs', import.meta.url));
const HOST = `${'b'.repeat(52)}7abc.onion`;
const DATA = '/kit/run/tor data';
const CACHE = '/kit/tor/cache/service';

test('a full onion service reads no torrc, keeps its cache, goes with the kit, logs to stdout, takes a loopback SOCKS port and forwards port 80 to the relay', () => {
    assert.deepEqual(buildTorArgs({ empty: '/kit/tor/empty', dataDir: DATA, cacheDir: CACHE, ownerPid: 4242, mode: 'full', relayPort: 45678 }), [
        '-f',
        '/kit/tor/empty',
        '--defaults-torrc',
        '/kit/tor/empty',
        '--DataDirectory',
        DATA,
        '--CacheDirectory',
        CACHE,
        '__OwningControllerProcess',
        '4242',
        '--Log',
        'notice stdout',
        '--SocksPort',
        'auto',
        '--HiddenServiceDir',
        join(DATA, 'hs'),
        '--HiddenServicePort',
        '80 127.0.0.1:45678'
    ]);
});

test('a single-hop service has no SOCKS port, as Tor requires, and says it is not anonymous', () => {
    assert.deepEqual(buildTorArgs({ empty: '/e', dataDir: DATA, cacheDir: CACHE, ownerPid: 4242, mode: 'single', relayPort: 1 }), [
        '-f',
        '/e',
        '--defaults-torrc',
        '/e',
        '--DataDirectory',
        DATA,
        '--CacheDirectory',
        CACHE,
        '__OwningControllerProcess',
        '4242',
        '--Log',
        'notice stdout',
        '--SocksPort',
        '0',
        '--HiddenServiceDir',
        join(DATA, 'hs'),
        '--HiddenServicePort',
        '80 127.0.0.1:1',
        '--HiddenServiceSingleHopMode',
        '1',
        '--HiddenServiceNonAnonymousMode',
        '1'
    ]);
});

test('a client has a SOCKS port and no service', () => {
    assert.deepEqual(buildTorArgs({ empty: '/e', dataDir: DATA, cacheDir: '/kit/tor/cache/client', ownerPid: 4242, mode: 'client' }), [
        '-f',
        '/e',
        '--defaults-torrc',
        '/e',
        '--DataDirectory',
        DATA,
        '--CacheDirectory',
        '/kit/tor/cache/client',
        '__OwningControllerProcess',
        '4242',
        '--Log',
        'notice stdout',
        '--SocksPort',
        'auto'
    ]);
});

test('the loader\'s variables never reach Tor, and only Linux is told where libevent is', () => {
    const env = { PATH: '/bin', LD_PRELOAD: '/evil.so', ld_library_path: '/x', DYLD_INSERT_LIBRARIES: '/evil.dylib', DYLD_LIBRARY_PATH: '/y', UNSET: undefined };
    assert.deepEqual(torEnv(env, 'linux', '/kit/tor/lib'), { PATH: '/bin', LD_LIBRARY_PATH: '/kit/tor/lib' });
    assert.deepEqual(torEnv(env, 'darwin', '/kit/tor/lib'), { PATH: '/bin' });
    assert.deepEqual(torEnv(env, 'win32', 'C:\\kit\\tor'), { PATH: '/bin' });
});

test('the parser picks the SOCKS port and bootstrap out of Tor\'s own lines', () => {
    const parser = createTorLogParser();
    parser.push('Oct 18 19:36:14.000 [notice] Bootstrapped 0% (starting): Starting');
    parser.push('Oct 18 19:36:14.000 [notice] Opened Socks listener connection (ready) on 127.0.0.1:49731\r');
    assert.equal(parser.socksPort(), 49731);
    assert.equal(parser.bootstrapped(), false);
    parser.push('Oct 18 19:36:15.000 [notice] Bootstrapped 10% (conn_done): Connected to a relay');
    assert.equal(parser.bootstrapped(), false);
    parser.push('Oct 18 19:36:15.000 [notice] Bootstrapped 100% (done): Done');
    assert.equal(parser.bootstrapped(), true);
    assert.equal(parser.lastLine(), 'Bootstrapped 100% (done): Done');
});

test('a SOCKS listener anywhere but loopback is not taken for the port', () => {
    const parser = createTorLogParser();
    parser.push('Oct 18 19:36:14.000 [notice] Opened Socks listener connection (ready) on 0.0.0.0:9050');
    assert.equal(parser.socksPort(), null);
});

/** Tor as an object in this process: the test says what it logs and when the address exists. */
function fakeIo(): {
    io: TorIo;
    trace: string[];
    spec: () => TunnelSpawnSpec;
    say: (line: string) => void;
    exit: (code: number | null) => void;
    setHostname: (text: string | null) => void;
} {
    const trace: string[] = [];
    let spec: TunnelSpawnSpec | null = null;
    let hostname: string | null = null;
    let end!: (code: number | null) => void;
    const exited = new Promise<number | null>(resolve => {
        end = resolve;
    });
    let ended = false;
    const exit = (code: number | null): void => {
        if (ended) return;
        ended = true;
        trace.push('ended');
        end(code);
    };
    const io: TorIo = {
        env: { PATH: '/bin', LD_PRELOAD: '/evil.so' },
        platform: 'linux',
        pid: 4242,
        leaseCache: async kind => {
            trace.push(`leased ${kind}`);
            return { dir: `/kit/tor/cache/${kind}`, release: () => void trace.push(`freed ${kind}`) };
        },
        spawn: s => {
            spec = s;
            trace.push('started');
            return { exited, kill: () => setImmediate(() => exit(null)) };
        },
        makeDataDir: async () => {
            trace.push('made');
            return '/kit/run/data';
        },
        removeDir: async dir => {
            trace.push(`removed ${dir}`);
        },
        readHostname: async () => hostname,
        prepare: async () => {
            trace.push('prepared');
            return {
                exe: '/kit/run/tor',
                libDir: '/kit/run',
                release: async () => {
                    trace.push('released');
                }
            };
        }
    };
    return {
        io,
        trace,
        spec: () => spec!,
        say: line => spec!.onLine(`Oct 18 19:36:15.000 [notice] ${line}`),
        exit,
        setHostname: text => {
            hostname = text;
        }
    };
}

const turns = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
};

const OPTS = { checkedDir: '/kit/tor/0.4.9.14', empty: '/kit/tor/empty' };

test('an onion is ready only once the address is written and Tor has bootstrapped', async () => {
    const tor = fakeIo();
    let ready = false;
    const pending = startOnion(tor.io, { ...OPTS, mode: 'full', relayPort: 45678, signal: new AbortController().signal });
    void pending.then(() => (ready = true));
    await turns();
    assert.equal(tor.spec().command, '/kit/run/tor');
    assert.equal(tor.spec().stream, 'stdout');
    assert.deepEqual(tor.spec().env, { PATH: '/bin', LD_LIBRARY_PATH: '/kit/run' });
    tor.say('Opened Socks listener connection (ready) on 127.0.0.1:49731');
    tor.say('Bootstrapped 100% (done): Done');
    await turns();
    assert.equal(ready, false, 'not before the address exists');
    tor.setHostname(`${HOST}\n`);
    tor.say('Bootstrapped 100% (done): Done');
    const onion = await pending;
    assert.equal(onion.url, `http://${HOST}`);
    assert.equal(onion.socksPort, 49731);
    assert.equal(onion.lastLine(), 'Bootstrapped 100% (done): Done', 'without the timestamp and level');
    await onion.stop();
    assert.deepEqual(tor.trace, ['prepared', 'made', 'leased service', 'started', 'ended', 'removed /kit/run/data', 'freed service', 'released']);
});

test('an address written before bootstrap waits for bootstrap', async () => {
    const tor = fakeIo();
    let ready = false;
    const pending = startOnion(tor.io, { ...OPTS, mode: 'single', relayPort: 1, signal: new AbortController().signal });
    void pending.then(() => (ready = true));
    await turns();
    tor.setHostname(`${HOST}\n`);
    tor.say('Bootstrapped 50% (loading_descriptors): Loading relay descriptors');
    await turns();
    assert.equal(ready, false, 'not before bootstrap');
    tor.say('Bootstrapped 100% (done): Done');
    const onion = await pending;
    assert.equal(onion.url, `http://${HOST}`);
    assert.equal(onion.socksPort, null, 'single-hop has no SOCKS port');
    await onion.stop();
});

test('a half-written or odd hostname file is not taken for the address', async () => {
    const tor = fakeIo();
    let ready = false;
    const pending = startOnion(tor.io, { ...OPTS, mode: 'single', relayPort: 1, signal: new AbortController().signal });
    void pending.then(() => (ready = true));
    await turns();
    tor.setHostname(HOST.slice(0, 20));
    tor.say('Bootstrapped 100% (done): Done');
    await turns();
    assert.equal(ready, false);
    tor.setHostname(HOST);
    tor.say('Something else');
    await (await pending).stop();
});

test('a Tor that exits before it is ready rejects with its last line and leaves nothing behind', async () => {
    const tor = fakeIo();
    const pending = startOnion(tor.io, { ...OPTS, mode: 'full', relayPort: 1, signal: new AbortController().signal });
    await turns();
    tor.spec().onLine('Oct 18 19:36:15.000 [warn] Could not bind to 127.0.0.1:9050: Address already in use.');
    tor.exit(1);
    await assert.rejects(pending, (err: unknown) => {
        assert.ok(err instanceof TunnelError);
        assert.match(err.message, /^Tor exited \(code 1\) before it was ready: Could not bind to 127\.0\.0\.1:9050: Address already in use\.$/);
        assert.deepEqual(tor.trace, ['prepared', 'made', 'leased service', 'started', 'ended', 'removed /kit/run/data', 'freed service', 'released']);
        return true;
    });
});

test('an address that appears after Tor\'s last line is still found, by the poll', async () => {
    const tor = fakeIo();
    const pending = startOnion(tor.io, { ...OPTS, mode: 'single', relayPort: 1, signal: new AbortController().signal });
    await turns();
    tor.say('Bootstrapped 100% (done): Done');
    await turns();
    tor.setHostname(`${HOST}\n`);
    const onion = await pending;
    assert.equal(onion.url, `http://${HOST}`);
    await onion.stop();
});

test('a spawn that throws leaves no folders behind and is reported as a TunnelError', async () => {
    const tor = fakeIo();
    tor.io.spawn = () => {
        throw new TypeError('The argument \'args[5]\' must be a string without null bytes');
    };
    await assert.rejects(startOnion(tor.io, { ...OPTS, mode: 'full', relayPort: 1, signal: new AbortController().signal }), (err: unknown) => {
        assert.ok(err instanceof TunnelError);
        assert.match(err.message, /^Tor could not be started: .*null bytes$/);
        return true;
    });
    assert.deepEqual(tor.trace, ['prepared', 'made', 'leased service', 'removed /kit/run/data', 'freed service', 'released']);
});

test('a link checker that does not bootstrap in time is killed, its folders removed, and named as the checker', async () => {
    const tor = fakeIo();
    const pending = startTorClient(tor.io, { ...OPTS, signal: new AbortController().signal, bootTimeoutMs: 50 });
    await turns();
    tor.say('Bootstrapped 10% (conn_done): Connected to a relay');
    await assert.rejects(pending, (err: unknown) => {
        assert.ok(err instanceof TunnelError);
        assert.match(err.message, /^Tor's link checker was not ready within 0 s: Bootstrapped 10% \(conn_done\): Connected to a relay$/);
        assert.deepEqual(tor.trace, ['prepared', 'made', 'leased client', 'started', 'ended', 'removed /kit/run/data', 'freed client', 'released']);
        return true;
    });
});

test('cancelling a start kills Tor and removes its folders', async () => {
    const tor = fakeIo();
    const controller = new AbortController();
    const pending = startOnion(tor.io, { ...OPTS, mode: 'full', relayPort: 1, signal: controller.signal });
    await turns();
    controller.abort();
    await assert.rejects(pending, (err: unknown) => {
        assert.ok(err instanceof TunnelError);
        assert.equal(err.message, 'Sharing was cancelled');
        assert.deepEqual(tor.trace, ['prepared', 'made', 'leased service', 'started', 'ended', 'removed /kit/run/data', 'freed service', 'released']);
        return true;
    });
});

test('a start already cancelled runs nothing', async () => {
    const tor = fakeIo();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(startTorClient(tor.io, { ...OPTS, signal: controller.signal }), /cancelled/);
    assert.deepEqual(tor.trace, []);
});

test('a client is ready with its SOCKS port once bootstrapped', async () => {
    const tor = fakeIo();
    const pending = startTorClient(tor.io, { ...OPTS, signal: new AbortController().signal });
    await turns();
    assert.ok(!tor.spec().args.includes('--HiddenServiceDir'));
    tor.say('Opened Socks listener connection (ready) on 127.0.0.1:50111');
    tor.say('Bootstrapped 100% (done): Done');
    const client = await pending;
    assert.equal(client.socksPort, 50111);
    await Promise.all([client.stop(), client.stop()]);
    assert.deepEqual(tor.trace, ['prepared', 'made', 'leased client', 'started', 'ended', 'removed /kit/run/data', 'freed client', 'released']);
});

test('every Tor is given its kind\'s kept cache and the kit\'s pid, the service its own and the checker its own', async () => {
    const service = fakeIo();
    void startOnion(service.io, { ...OPTS, mode: 'full', relayPort: 1, signal: new AbortController().signal }).catch(() => {});
    const checker = fakeIo();
    void startTorClient(checker.io, { ...OPTS, signal: new AbortController().signal }).catch(() => {});
    await turns();
    const after = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1];
    assert.equal(after(service.spec().args, '--CacheDirectory'), '/kit/tor/cache/service');
    assert.equal(after(checker.spec().args, '--CacheDirectory'), '/kit/tor/cache/client');
    assert.equal(after(service.spec().args, '__OwningControllerProcess'), '4242');
    assert.equal(after(checker.spec().args, '__OwningControllerProcess'), '4242');
    assert.notEqual(after(service.spec().args, '--DataDirectory'), '/kit/tor/cache/service', 'the keys never go in the kept cache');
    service.exit(1);
    checker.exit(1);
});

test('the link checker is given three minutes to bootstrap', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const tor = fakeIo();
    let failed: unknown = null;
    void startTorClient(tor.io, { ...OPTS, signal: new AbortController().signal }).catch(err => (failed = err));
    await turns();
    t.mock.timers.tick(179_999);
    await turns();
    assert.equal(failed, null);
    t.mock.timers.tick(1);
    await turns();
    assert.match(String(failed), /Tor's link checker was not ready within 180 s/);
});

test('a cache is leased to one Tor at a time, and a wait given up on does not hold up the next', async () => {
    const made: TorCacheKind[] = [];
    const lease = cacheLeases(async kind => {
        made.push(kind);
        return `/cache/${kind}`;
    });
    const live = new AbortController().signal;
    const first = await lease('client', live);
    assert.equal(first.dir, '/cache/client');
    const service = await lease('service', live);
    assert.equal(service.dir, '/cache/service', 'the other kind is its own');
    const giveUp = new AbortController();
    const abandoned = lease('client', giveUp.signal);
    const third: { dir: string | null } = { dir: null };
    void lease('client', live).then(l => (third.dir = l.dir));
    await turns();
    assert.equal(third.dir, null, 'not while the first holds it');
    giveUp.abort();
    await assert.rejects(abandoned, /aborted/);
    await turns();
    assert.equal(third.dir, null, 'giving up a wait frees nothing the first still holds');
    first.release();
    first.release();
    await turns();
    assert.equal(third.dir, '/cache/client');
    assert.deepEqual(made, ['client', 'service', 'client']);
});

test('a second link checker starts only once the first has gone, so two never share the cache', async () => {
    const one = fakeIo();
    const two = fakeIo();
    const lease = cacheLeases(async kind => `/kit/tor/cache/${kind}`);
    one.io.leaseCache = lease;
    two.io.leaseCache = lease;
    const pending = startTorClient(one.io, { ...OPTS, signal: new AbortController().signal });
    await turns();
    one.say('Opened Socks listener connection (ready) on 127.0.0.1:50111');
    one.say('Bootstrapped 100% (done): Done');
    const first = await pending;
    void startTorClient(two.io, { ...OPTS, signal: new AbortController().signal }).catch(() => {});
    await turns();
    assert.deepEqual(two.trace, ['prepared', 'made'], 'waiting for the cache');
    await first.stop();
    await turns();
    assert.deepEqual(two.trace, ['prepared', 'made', 'started']);
    two.exit(1);
});

/** A link checker for `checkThroughClient`, bootstrapped as soon as it starts. */
async function checking(wait: (socksPort: number, signal: AbortSignal) => Promise<void>, signal = new AbortController().signal) {
    const tor = fakeIo();
    const logged: string[] = [];
    const check = checkThroughClient(tor.io, { ...OPTS, signal, wait, log: msg => void logged.push(msg) });
    await turns();
    tor.say('Opened Socks listener connection (ready) on 127.0.0.1:50111');
    tor.say('Bootstrapped 100% (done): Done');
    await turns();
    return { tor, check, logged };
}

test('a link checked through the checker stops the checker as soon as the link works', async () => {
    let port = 0;
    const { tor, check } = await checking(async socksPort => {
        port = socksPort;
    });
    await check;
    assert.equal(port, 50111);
    assert.deepEqual(tor.trace, ['prepared', 'made', 'leased client', 'started', 'ended', 'removed /kit/run/data', 'freed client', 'released']);
});

test('a checker that exits while the link is checked fails the check at once, with its last line and nothing else', async () => {
    let seen: AbortSignal | null = null;
    const { tor, check } = await checking((_port, signal) => {
        seen = signal;
        return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Sharing was cancelled'))));
    });
    tor.spec().onLine('Oct 18 19:36:20.000 [err] Directory authority refused us.');
    tor.exit(1);
    await assert.rejects(check, (err: unknown) => {
        assert.ok(err instanceof TunnelError);
        assert.equal(err.message, "Tor's link checker exited (code 1): Directory authority refused us.");
        return true;
    });
    assert.equal(seen!.aborted, true, 'the wait is told to give up');
    assert.deepEqual(tor.trace, ['prepared', 'made', 'leased client', 'started', 'ended', 'removed /kit/run/data', 'freed client', 'released']);
});

test('a share stopped while its link is checked cancels the wait and stops the checker', async () => {
    const controller = new AbortController();
    const { tor, check } = await checking(
        (_port, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Sharing was cancelled')))),
        controller.signal
    );
    controller.abort();
    await assert.rejects(check, /Sharing was cancelled/);
    assert.deepEqual(tor.trace, ['prepared', 'made', 'leased client', 'started', 'ended', 'removed /kit/run/data', 'freed client', 'released']);
});

/** The real `spawnProcess` running the fake Tor script, with real folders. */
function realIo(t: { after: (fn: () => void) => void }, mode: string): { io: TorIo; made: string[]; released: () => number } {
    const root = mkdtempSync(join(tmpdir(), 'share-tor-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const made: string[] = [];
    let released = 0;
    const io: TorIo = {
        env: { ...process.env, FAKE_TOR_MODE: mode },
        platform: process.platform,
        pid: process.pid,
        leaseCache: cacheLeases(async kind => {
            const dir = join(root, 'cache', kind);
            mkdirSync(dir, { recursive: true, mode: 0o700 });
            return dir;
        }),
        spawn: spec => spawnProcess({ ...spec, command: process.execPath, args: [FAKE, ...spec.args] }),
        makeDataDir: async () => {
            const dir = mkdtempSync(join(root, 'tor data '));
            made.push(dir);
            return dir;
        },
        removeDir: async dir => rmSync(dir, { recursive: true, force: true }),
        readHostname: async dir => {
            try {
                return readFileSync(join(dir, 'hs', 'hostname'), 'utf8');
            } catch {
                return null;
            }
        },
        prepare: async () => ({
            exe: 'tor',
            libDir: root,
            release: async () => {
                released++;
            }
        })
    };
    return { io, made, released: () => released };
}

test('the fake Tor, run for real, comes up as an onion and goes away cleanly', async t => {
    const { io, made, released } = realIo(t, 'ok');
    const empty = join(tmpdir(), `share-tor-empty-${process.pid}`);
    writeFileSync(empty, '');
    t.after(() => rmSync(empty, { force: true }));
    const onion = await startOnion(io, { checkedDir: '/unused', empty, mode: 'full', relayPort: 45678, signal: new AbortController().signal });
    assert.equal(onion.url, `http://${'a'.repeat(52)}2345.onion`);
    assert.equal(onion.socksPort, 49731);
    assert.ok(existsSync(made[0]!));
    await onion.stop();
    assert.equal(existsSync(made[0]!), false);
    assert.equal(released(), 1);
    assert.equal(await onion.exited, 0);
});

test('the fake Tor, failing for real, is reported with its last line', async t => {
    const { io, made, released } = realIo(t, 'bind-fail');
    await assert.rejects(startOnion(io, { checkedDir: '/unused', empty: '/unused', mode: 'full', relayPort: 1, signal: new AbortController().signal }), (err: unknown) => {
        assert.ok(err instanceof TunnelError);
        assert.match(err.message, /: Could not bind to 127\.0\.0\.1:9050: Address already in use\. Is Tor already running\?$/);
        return true;
    });
    assert.equal(existsSync(made[0]!), false);
    assert.equal(released(), 1);
});

test('the fake Tor, failing to load for real, is reported with what the loader wrote to stderr', async t => {
    const { io, made, released } = realIo(t, 'load-fail');
    await assert.rejects(startOnion(io, { checkedDir: '/unused', empty: '/unused', mode: 'full', relayPort: 1, signal: new AbortController().signal }), (err: unknown) => {
        assert.ok(err instanceof TunnelError);
        assert.match(err.message, /^Tor exited \(code 127\) before it was ready: tor: error while loading shared libraries: libevent-2\.1\.so\.7: cannot open shared object file: No such file or directory$/);
        return true;
    });
    assert.equal(existsSync(made[0]!), false);
    assert.equal(released(), 1);
});
