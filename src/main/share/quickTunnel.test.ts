import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildArgs, createLogParser, sanitizeEnv, spawnProcess, startQuickTunnel, TunnelError, type QuickTunnelIo } from './quickTunnel.ts';

const FAKE = fileURLToPath(new URL('./testdata/fake-cloudflared.mjs', import.meta.url));

interface Run {
    io: QuickTunnelIo;
    runs: () => { pid: number; args: string[]; env: string[] }[];
}

/** Runs the fake cloudflared in place of the real one, recording each run. */
function fake(t: { after: (fn: () => void) => void }, mode: string, extraEnv: Record<string, string> = {}): Run {
    const dir = mkdtempSync(join(tmpdir(), 'share-qt-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const record = join(dir, 'runs.jsonl');
    const io: QuickTunnelIo = {
        env: { ...process.env, FAKE_CF_MODE: mode, FAKE_CF_RECORD: record, ...extraEnv },
        spawn: spec => spawnProcess({ ...spec, command: process.execPath, args: [FAKE, ...spec.args] })
    };
    const runs = (): { pid: number; args: string[]; env: string[] }[] => {
        try {
            return readFileSync(record, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        } catch {
            return [];
        }
    };
    return { io, runs };
}

/**
 * cloudflared as an object in this process: it prints its link just after it
 * starts, never registers, and ends only when killed, a turn of the event loop
 * after its first signal. Nothing in it runs on a clock, so the timeout or
 * cancel a test is about has nothing to race. The fake binary does: under load
 * Node can take longer to start it than a short timeout, and a process killed
 * before it has started has recorded no run.
 */
function stalled(): { io: QuickTunnelIo; trace: string[]; announced: Promise<void>[] } {
    const trace: string[] = [];
    const announced: Promise<void>[] = [];
    const io: QuickTunnelIo = {
        env: {},
        spawn: spec => {
            trace.push('started');
            // Not during spawn: a real process's first line comes after it, once the attempt is listening.
            announced.push(
                Promise.resolve().then(() => {
                    spec.onLine('2026-09-16T10:00:00Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |');
                    spec.onLine('2026-09-16T10:00:00Z INF |  https://brave-otter-lamp-test.trycloudflare.com  |');
                })
            );
            let end!: (code: number | null) => void;
            let signalled = false;
            return {
                exited: new Promise(resolve => {
                    end = resolve;
                }),
                kill: () => {
                    if (signalled) return;
                    signalled = true;
                    setImmediate(() => {
                        trace.push('ended');
                        end(null);
                    });
                }
            };
        }
    };
    return { io, trace, announced };
}

/**
 * The kit's own timeouts, long enough that the fake binary reaches them only
 * when something is broken, not when the machine is busy. A test whose subject
 * is a timeout sets its own.
 */
const OPTS = { binary: 'cloudflared', port: 45678, configPath: '/cf/quick.yml' };

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

test('cloudflared is told to leave itself alone, ignore any config file, stop quickly and point at the relay', () => {
    assert.deepEqual(buildArgs({ port: 45678, configPath: '/cf/quick.yml' }), [
        'tunnel',
        '--no-autoupdate',
        '--config',
        '/cf/quick.yml',
        '--grace-period',
        '1s',
        '--loglevel',
        'info',
        '--url',
        'http://127.0.0.1:45678'
    ]);
});

test('the retry asks for http2, since a quick tunnel otherwise insists on QUIC', () => {
    const args = buildArgs({ port: 1, configPath: 'c', protocol: 'http2' });
    assert.deepEqual(args.slice(-4), ['--protocol', 'http2', '--url', 'http://127.0.0.1:1']);
});

test('settings cloudflared reads from the environment are removed, whatever their case, and the rest kept', () => {
    const env = sanitizeEnv({ PATH: '/bin', HOME: '/h', TUNNEL_URL: 'http://evil', tunnel_origin_cert: 'x', NO_AUTOUPDATE: 'false', Tunnel_Loglevel: 'debug', UNSET: undefined });
    assert.deepEqual(env, { PATH: '/bin', HOME: '/h' });
});

test('the link is the first trycloudflare host after the announcement, not the disclaimer\'s or the api\'s', () => {
    const parser = createLogParser();
    parser.push('INF See https://developers.cloudflare.com/x and https://old-link.trycloudflare.com');
    parser.push('INF Requesting new quick Tunnel on trycloudflare.com... (api https://api.trycloudflare.com/tunnel)');
    assert.equal(parser.url(), null);
    parser.push('INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |');
    parser.push('INF |  https://api.trycloudflare.com  |');
    assert.equal(parser.url(), null);
    parser.push('INF |  https://calm-river-sock-tent.trycloudflare.com                    |\r');
    parser.push('INF |  https://second-one.trycloudflare.com  |');
    assert.equal(parser.url(), 'https://calm-river-sock-tent.trycloudflare.com');
    assert.equal(parser.registered(), false);
    parser.push('INF Registered tunnel connection connIndex=0 protocol=quic\r');
    assert.equal(parser.registered(), true);
});

test('a tunnel is live once its link is announced and a connection registered, and stops when asked', async t => {
    const { io, runs } = fake(t, 'ok');
    const tunnel = await startQuickTunnel(io, OPTS);
    assert.equal(tunnel.url, 'https://brave-otter-lamp-test.trycloudflare.com');
    const [run] = runs();
    assert.deepEqual(run!.args, buildArgs({ port: 45678, configPath: '/cf/quick.yml' }));
    assert.ok(!run!.env.some(key => key.toUpperCase().startsWith('TUNNEL_')));
    assert.ok(tunnel.logs().some(line => line.includes('Registered tunnel connection')));
    await tunnel.stop();
    await tunnel.stop();
    assert.equal(await tunnel.exited, 0);
    assert.equal(alive(run!.pid), false);
});

test('lines ending in CRLF are read the same way', async t => {
    const { io } = fake(t, 'crlf');
    const tunnel = await startQuickTunnel(io, OPTS);
    assert.equal(tunnel.url, 'https://brave-otter-lamp-test.trycloudflare.com');
    await tunnel.stop();
});

test('when QUIC cannot connect, one retry over http2 opens the tunnel', async t => {
    const { io, runs } = fake(t, 'quic-fail');
    const tunnel = await startQuickTunnel(io, OPTS);
    assert.equal(tunnel.url, 'https://brave-otter-lamp-test.trycloudflare.com');
    const all = runs();
    assert.equal(all.length, 2);
    assert.equal(all[0]!.args.includes('--protocol'), false);
    assert.deepEqual(all[1]!.args.slice(-4), ['--protocol', 'http2', '--url', 'http://127.0.0.1:45678']);
    await tunnel.stop();
});

test('two failed attempts give up with what cloudflared said', async t => {
    const { io, runs } = fake(t, 'always-fail');
    await assert.rejects(startQuickTunnel(io, OPTS), (err: unknown) => {
        assert.ok(err instanceof TunnelError);
        assert.match(err.message, /initial tunnel connection failed/);
        assert.ok(err.logs.some(line => line.includes('Failed to dial a quic connection')));
        return true;
    });
    assert.equal(runs().length, 2);
});

test('a tunnel that never registers is killed, both times, and reported', async () => {
    const { io, trace } = stalled();
    await assert.rejects(startQuickTunnel(io, { ...OPTS, registerTimeoutMs: 20 }), (err: unknown) => {
        assert.ok(err instanceof TunnelError);
        assert.match(err.message, /did not connect/);
        // Read as it rejects: a rejection ahead of a kill would find that process still going.
        assert.deepEqual(trace, ['started', 'ended', 'started', 'ended']);
        return true;
    });
});

test('a flood of output neither stalls the tunnel nor grows the kept log without bound', async t => {
    const { io } = fake(t, 'flood');
    const tunnel = await startQuickTunnel(io, OPTS);
    assert.equal(tunnel.url, 'https://brave-otter-lamp-test.trycloudflare.com');
    assert.ok(tunnel.logs().length <= 200, `${tunnel.logs().length} lines kept`);
    await tunnel.stop();
});

test('a tunnel that dies after going live says so through exited', async t => {
    const { io } = fake(t, 'crash-after-ready');
    const tunnel = await startQuickTunnel(io, OPTS);
    assert.equal(await tunnel.exited, 3);
    await tunnel.stop();
});

test('a cloudflared that ignores the polite stop is killed after the grace period', { skip: process.platform === 'win32' }, async t => {
    const { io, runs } = fake(t, 'ignore-term');
    const tunnel = await startQuickTunnel(io, { ...OPTS, stopGraceMs: 200 });
    const started = Date.now();
    await tunnel.stop();
    assert.ok(Date.now() - started >= 150, 'waited for the grace period first');
    assert.equal(await tunnel.exited, null);
    assert.equal(alive(runs()[0]!.pid), false);
});

test('a start that is cancelled while connecting kills cloudflared and does not retry', async () => {
    const { io, trace, announced } = stalled();
    const controller = new AbortController();
    const pending = startQuickTunnel(io, { ...OPTS, signal: controller.signal });
    await announced[0];
    controller.abort();
    await assert.rejects(pending, (err: unknown) => {
        assert.ok(err instanceof TunnelError);
        assert.match(err.message, /cancelled/);
        assert.deepEqual(trace, ['started', 'ended']);
        return true;
    });
});

test('a binary that cannot be started at all is reported, not thrown past', async () => {
    const io: QuickTunnelIo = { env: {}, spawn: spawnProcess };
    await assert.rejects(startQuickTunnel(io, { ...OPTS, binary: join(tmpdir(), 'no-such-cloudflared') }), TunnelError);
});
