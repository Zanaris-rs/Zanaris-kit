import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { fetchViaSocks, waitOnionReachable, type OnionIo } from './onionReachable.ts';
import { BODY_LIMIT, type ProbeAnswer } from './reachable.ts';

const HOST = `${'a'.repeat(56)}.onion`;
const URL_ = `http://${HOST}`;
const PROBE = { path: '/.zanaris-kit/reachable/abc', token: 'abc' };
const answer = (status: number, body = ''): ProbeAnswer => ({ status, body });

function fake(script: (attempt: number) => ProbeAnswer | Error) {
    const controller = new AbortController();
    const sleeps: number[] = [];
    const calls: string[] = [];
    const timeouts: number[] = [];
    let attempt = 0;
    let clock = 0;
    const io: OnionIo = {
        fetchViaSocks: async (port, host, path, _signal, timeoutMs) => {
            calls.push(`${port} ${host} ${path}`);
            timeouts.push(timeoutMs);
            const next = script(attempt++);
            if (next instanceof Error) throw next;
            return next;
        },
        sleep: async (ms, signal) => {
            if (signal.aborted) throw new Error('aborted');
            sleeps.push(ms);
            clock += ms;
        },
        now: () => clock
    };
    return { io, controller, sleeps, calls, timeouts };
}

const run = (f: ReturnType<typeof fake>, extra: { deadlineMs?: number; intervalMs?: number } = {}) =>
    waitOnionReachable(f.io, { url: URL_, socksPort: 9150, probe: PROBE, signal: f.controller.signal, ...extra });

test('live when the body equals the token', async () => {
    const f = fake(() => answer(200, 'abc'));
    await run(f);
    assert.deepEqual(f.calls, [`9150 ${HOST} ${PROBE.path}`]);
    assert.deepEqual(f.sleeps, []);
});

test('a wrong body, a 503 and a thrown fetch keep waiting', async () => {
    const f = fake(n => [answer(200, 'other'), answer(503), new Error('connection refused'), answer(200, 'abc')][n]!);
    await run(f);
    assert.equal(f.calls.length, 4);
    assert.deepEqual(f.sleeps, [5000, 5000, 5000]);
});

test('the deadline rejects with the message', async () => {
    const f = fake(() => answer(503));
    await assert.rejects(run(f, { deadlineMs: 60_000, intervalMs: 20_000 }), { message: 'The onion link did not come up within 1 minute' });
    const g = fake(() => answer(503));
    await assert.rejects(run(g), { message: 'The onion link did not come up within 5 minutes' });
});

test('no attempt is given longer than the time left before the deadline', async () => {
    const f = fake(() => answer(503));
    await assert.rejects(run(f, { deadlineMs: 90_000, intervalMs: 40_000 }));
    assert.deepEqual(f.timeouts, [60_000, 50_000, 10_000]);
});

test('an abort rejects promptly', async () => {
    const f = fake(() => answer(503));
    f.controller.abort();
    await assert.rejects(run(f), { message: 'Sharing was cancelled' });
    const g = fake(() => answer(503));
    const io: OnionIo = { ...g.io, sleep: (_ms, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) };
    const waiting = waitOnionReachable(io, { url: URL_, socksPort: 1, probe: PROBE, signal: g.controller.signal });
    setImmediate(() => g.controller.abort());
    await assert.rejects(waiting, { message: 'Sharing was cancelled' });
});

// ── the real io, against a fake SOCKS5 server ───────────────────────────

interface Socks {
    server: Server;
    port: number;
    seen: { greeting?: Buffer; request?: Buffer; http?: string };
    sockets: Socket[];
}

/** Speaks SOCKS5 with no auth, replying with `rep`, then hands the HTTP request to `serve`. */
async function socks(rep: number, serve: (socket: Socket, http: string) => void, split = false): Promise<Socks> {
    const seen: Socks['seen'] = {};
    const sockets: Socket[] = [];
    const server = createServer(socket => {
        sockets.push(socket);
        socket.on('error', () => {});
        let buf = Buffer.alloc(0);
        let stage = 0;
        socket.on('data', (chunk: Buffer) => {
            buf = Buffer.concat([buf, chunk]);
            if (stage === 0 && buf.length >= 3) {
                seen.greeting = buf.subarray(0, 3);
                buf = buf.subarray(3);
                stage = 1;
                socket.write(Buffer.from([0x05, 0x00]));
            }
            if (stage === 1 && buf.length >= 5 && buf.length >= 5 + buf[4]! + 2) {
                const total = 5 + buf[4]! + 2;
                seen.request = buf.subarray(0, total);
                buf = buf.subarray(total);
                stage = 2;
                const reply = Buffer.from([0x05, rep, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
                if (split) {
                    socket.write(reply.subarray(0, 3));
                    setTimeout(() => socket.write(reply.subarray(3)), 20);
                } else socket.write(reply);
                if (rep !== 0) return;
            }
            if (stage === 2 && buf.includes('\r\n\r\n')) {
                stage = 3;
                seen.http = buf.toString('latin1');
                serve(socket, seen.http);
            }
        });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return { server, port: (server.address() as AddressInfo).port, seen, sockets };
}

const stop = (s: Socks): void => {
    for (const socket of s.sockets) socket.destroy();
    s.server.close();
};

const never = new AbortController().signal;

test('fetchViaSocks greets with 05 01 00, sends the host as a domain, and returns the answer', async () => {
    const s = await socks(0, (socket, http) => {
        assert.match(http, new RegExp(`^GET ${PROBE.path} HTTP/1.1\\r\\n`));
        assert.match(http, new RegExp(`\\r\\nHost: ${HOST}\\r\\n`));
        assert.match(http, /\r\nConnection: close\r\n/);
        socket.end(`HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 3\r\n\r\nabc`);
    }, true);
    try {
        const got = await fetchViaSocks(s.port, HOST, PROBE.path, never);
        assert.deepEqual(got, { status: 200, body: 'abc' });
        assert.deepEqual([...s.seen.greeting!], [0x05, 0x01, 0x00]);
        const req = s.seen.request!;
        assert.deepEqual([...req.subarray(0, 5)], [0x05, 0x01, 0x00, 0x03, HOST.length]);
        assert.equal(req.subarray(5, 5 + HOST.length).toString('ascii'), HOST);
        assert.deepEqual([...req.subarray(5 + HOST.length)], [0x00, 0x50]);
    } finally {
        stop(s);
    }
});

test('fetchViaSocks reads a chunked answer and one with no length', async () => {
    const a = await socks(0, socket => socket.end('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1\r\na\r\n2\r\nbc\r\n0\r\n\r\n'));
    const b = await socks(0, socket => socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\nnot yet'));
    try {
        assert.deepEqual(await fetchViaSocks(a.port, HOST, PROBE.path, never), { status: 200, body: 'abc' });
        assert.deepEqual(await fetchViaSocks(b.port, HOST, PROBE.path, never), { status: 503, body: 'not yet' });
    } finally {
        stop(a);
        stop(b);
    }
});

test('fetchViaSocks stops reading at the body limit', async () => {
    const s = await socks(0, socket => socket.write(`HTTP/1.1 200 OK\r\nContent-Length: 100000\r\n\r\n${'x'.repeat(8000)}`));
    try {
        const got = await fetchViaSocks(s.port, HOST, PROBE.path, never);
        assert.equal(got.body.length, BODY_LIMIT);
    } finally {
        stop(s);
    }
});

test('fetchViaSocks rejects a failed SOCKS reply', async () => {
    const s = await socks(0x04, () => assert.fail('no request after a refusal'));
    try {
        await assert.rejects(fetchViaSocks(s.port, HOST, PROBE.path, never), /SOCKS reply 4/);
    } finally {
        stop(s);
    }
});

test('fetchViaSocks destroys its socket when aborted mid-attempt', async () => {
    const s = await socks(0, () => {});
    try {
        const controller = new AbortController();
        const pending = fetchViaSocks(s.port, HOST, PROBE.path, controller.signal);
        while (s.seen.http === undefined) await new Promise(resolve => setTimeout(resolve, 5));
        controller.abort();
        await assert.rejects(pending, { message: 'aborted' });
        await new Promise<void>(resolve => (s.sockets[0]!.destroyed ? resolve() : s.sockets[0]!.once('close', () => resolve())));
    } finally {
        stop(s);
    }
});

test('fetchViaSocks times out', async () => {
    const s = await socks(0, () => {});
    try {
        await assert.rejects(fetchViaSocks(s.port, HOST, PROBE.path, never, { timeoutMs: 50 }), /timed out/);
    } finally {
        stop(s);
    }
});
