import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnProcess, TunnelError, type TunnelSpawnSpec } from './quickTunnel.ts';
import { buildTorArgs, createTorLogParser, startOnion, startTorClient, torEnv, type TorIo } from './torProcess.ts';

const FAKE = fileURLToPath(new URL('./testdata/fake-tor.mjs', import.meta.url));
const HOST = `${'b'.repeat(52)}7abc.onion`;
const DATA = '/kit/run/tor data';

test('a full onion service reads no torrc, logs to stdout, takes a loopback SOCKS port and forwards port 80 to the relay', () => {
    assert.deepEqual(buildTorArgs({ empty: '/kit/tor/empty', dataDir: DATA, mode: 'full', relayPort: 45678 }), [
        '-f',
        '/kit/tor/empty',
        '--defaults-torrc',
        '/kit/tor/empty',
        '--DataDirectory',
        DATA,
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
    assert.deepEqual(buildTorArgs({ empty: '/e', dataDir: DATA, mode: 'single', relayPort: 1 }), [
        '-f',
        '/e',
        '--defaults-torrc',
        '/e',
        '--DataDirectory',
        DATA,
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
    assert.deepEqual(buildTorArgs({ empty: '/e', dataDir: DATA, mode: 'client' }), [
        '-f',
        '/e',
        '--defaults-torrc',
        '/e',
        '--DataDirectory',
        DATA,
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
    await onion.stop();
    assert.deepEqual(tor.trace, ['prepared', 'made', 'started', 'ended', 'removed /kit/run/data', 'released']);
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
        assert.deepEqual(tor.trace, ['prepared', 'made', 'started', 'ended', 'removed /kit/run/data', 'released']);
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
    assert.deepEqual(tor.trace, ['prepared', 'made', 'removed /kit/run/data', 'released']);
});

test('a Tor that does not bootstrap in time is killed and its folders removed', async () => {
    const tor = fakeIo();
    const pending = startTorClient(tor.io, { ...OPTS, signal: new AbortController().signal, bootTimeoutMs: 50 });
    await turns();
    tor.say('Bootstrapped 10% (conn_done): Connected to a relay');
    await assert.rejects(pending, (err: unknown) => {
        assert.ok(err instanceof TunnelError);
        assert.match(err.message, /^Tor was not ready within 0 s: Bootstrapped 10% \(conn_done\): Connected to a relay$/);
        assert.deepEqual(tor.trace, ['prepared', 'made', 'started', 'ended', 'removed /kit/run/data', 'released']);
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
        assert.deepEqual(tor.trace, ['prepared', 'made', 'started', 'ended', 'removed /kit/run/data', 'released']);
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
    assert.deepEqual(tor.trace, ['prepared', 'made', 'started', 'ended', 'removed /kit/run/data', 'released']);
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
