import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { createServer } from 'node:http';
import { fetchProbe, queryAuthoritative, waitUntilReachable, type AuthoritativeAnswer, type ProbeAnswer, type ReachableIo } from './reachable.ts';
import { startRelay } from './relay.ts';

const URL_ = 'https://calm-river.trycloudflare.com';
const HOST = 'calm-river.trycloudflare.com';
const PROBE = { path: '/.zanaris-kit/reachable/abc', token: 'abc' };
const SERVERS = ['198.51.100.1', '198.51.100.2'];
const EDGE = ['104.16.230.132'];

const found = (...addresses: string[]): AuthoritativeAnswer => ({ kind: 'found', addresses });
const missing: AuthoritativeAnswer = { kind: 'missing' };
const unreachable: AuthoritativeAnswer = { kind: 'unreachable' };
const answer = (status: number, body = ''): ProbeAnswer => ({ status, body });

interface Fake {
    io: ReachableIo;
    /** Every call, in order, as `dns <round> <server>` or `probe <address> <path>`. */
    calls: string[];
    sleeps: number[];
    logs: string[];
    controller: AbortController;
}

/**
 * The rules over a scripted network. `dns` is asked per round and server,
 * `probe` per attempt; the clock only moves when the rules sleep.
 */
function fake(script: {
    dns?: (round: number, server: string) => AuthoritativeAnswer;
    probe?: (attempt: number, target: { host: string; address: string }) => ProbeAnswer;
    edge?: string[];
}): Fake {
    const calls: string[] = [];
    const sleeps: number[] = [];
    const logs: string[] = [];
    const controller = new AbortController();
    const rounds = new Map<string, number>();
    let attempt = 0;
    let clock = 0;
    const io: ReachableIo = {
        nameservers: async () => SERVERS,
        edgeAddresses: async () => script.edge ?? EDGE,
        queryAuthoritative: async (server, host) => {
            assert.equal(host, HOST);
            const round = rounds.get(server) ?? 0;
            rounds.set(server, round + 1);
            calls.push(`dns ${round} ${server}`);
            return (script.dns ?? (() => found('104.16.231.132')))(round, server);
        },
        fetchProbe: async target => {
            assert.equal(target.host, HOST);
            calls.push(`probe ${target.address} ${target.path}`);
            return (script.probe ?? (() => answer(200, PROBE.token)))(attempt++, target);
        },
        sleep: async (ms, signal) => {
            if (signal.aborted) throw new Error('aborted');
            sleeps.push(ms);
            clock += ms;
        },
        now: () => clock
    };
    return { io, calls, sleeps, logs, controller };
}

function wait(f: Fake, deadlineMs?: number): Promise<void> {
    return waitUntilReachable(f.io, { url: URL_, probe: PROBE, signal: f.controller.signal, deadlineMs, log: msg => f.logs.push(msg) });
}

test('the link counts as working only once every nameserver publishes it and a request through it brings back the token', async () => {
    const f = fake({
        dns: (round, server) => (round === 0 || (round === 1 && server === SERVERS[1]) ? missing : found('104.16.231.132')),
        probe: attempt => (attempt === 0 ? answer(530, '<html>error 1033</html>') : answer(200, PROBE.token))
    });
    await wait(f);
    assert.deepEqual(f.calls, [
        `dns 0 ${SERVERS[0]}`,
        `dns 0 ${SERVERS[1]}`,
        `dns 1 ${SERVERS[0]}`,
        `dns 1 ${SERVERS[1]}`,
        `dns 2 ${SERVERS[0]}`,
        `dns 2 ${SERVERS[1]}`,
        `probe 104.16.231.132 ${PROBE.path}`,
        `probe 104.16.231.132 ${PROBE.path}`
    ]);
});

test('once published, the nameservers are not asked again while the link itself is checked', async () => {
    const f = fake({ probe: attempt => (attempt < 3 ? answer(530) : answer(200, PROBE.token)) });
    await wait(f);
    assert.equal(f.calls.filter(c => c.startsWith('dns')).length, 2);
    assert.equal(f.calls.filter(c => c.startsWith('probe')).length, 4);
});

test('a Cloudflare error page, some other page, or a failed connection is not the link working', async () => {
    const f = fake({
        probe: attempt => {
            if (attempt === 0) return answer(530, 'error 1033');
            if (attempt === 1) return answer(200, 'somebody else');
            if (attempt === 2) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
            return answer(200, PROBE.token);
        }
    });
    await wait(f);
    assert.equal(f.calls.filter(c => c.startsWith('probe')).length, 4);
});

test('probes take turns across the addresses the nameservers gave', async () => {
    const f = fake({
        dns: () => found('104.16.230.132', '104.16.231.132'),
        probe: attempt => (attempt < 2 ? answer(530) : answer(200, PROBE.token))
    });
    await wait(f);
    assert.deepEqual(
        f.calls.filter(c => c.startsWith('probe')).map(c => c.split(' ')[1]),
        ['104.16.230.132', '104.16.231.132', '104.16.230.132']
    );
});

test('a nameserver that cannot be asked this time does not hold up one that says the name is published', async () => {
    const f = fake({ dns: (_round, server) => (server === SERVERS[0] ? found('104.16.231.132') : unreachable) });
    await wait(f);
    assert.equal(f.calls.filter(c => c.startsWith('dns')).length, 2);
});

test('when neither nameserver can be asked three times running, the link alone is checked, at the edge\'s own address', async () => {
    const f = fake({ dns: () => unreachable });
    await wait(f);
    assert.deepEqual(f.calls, [
        `dns 0 ${SERVERS[0]}`,
        `dns 0 ${SERVERS[1]}`,
        `dns 1 ${SERVERS[0]}`,
        `dns 1 ${SERVERS[1]}`,
        `dns 2 ${SERVERS[0]}`,
        `dns 2 ${SERVERS[1]}`,
        `probe ${EDGE[0]} ${PROBE.path}`
    ]);
    assert.ok(f.logs.some(l => /cannot be asked/.test(l)));
});

test('a nameserver answering between failures starts the count again', async () => {
    const f = fake({ dns: round => (round === 2 ? missing : round < 5 ? unreachable : found('104.16.231.132')) });
    await wait(f);
    // Rounds 0-1 fail, 2 answers, 3-4 fail, 5 publishes: never three failures in a row.
    assert.equal(f.calls.filter(c => c.startsWith('dns')).length, 12);
    assert.ok(!f.logs.some(l => /cannot be asked/.test(l)));
});

test('a name published with no address of its own is reached at the edge\'s address', async () => {
    const f = fake({ dns: () => found() });
    await wait(f);
    assert.equal(f.calls.at(-1), `probe ${EDGE[0]} ${PROBE.path}`);
});

test('waits start at a second and grow to five at most', async () => {
    const f = fake({ probe: attempt => (attempt < 7 ? answer(530) : answer(200, PROBE.token)) });
    await wait(f);
    assert.deepEqual(f.sleeps, [1000, 1500, 2250, 3375, 5000, 5000, 5000]);
});

test('giving up at the deadline says what it saw last, and never sleeps past it', async () => {
    const f = fake({ probe: () => answer(530) });
    await assert.rejects(wait(f, 10_000), (err: Error) => {
        assert.equal(err.message, "The link did not start working within 10 s: Cloudflare's edge still answered 530");
        return true;
    });
    assert.equal(f.sleeps.reduce((a, b) => a + b, 0), 10_000);
});

test('a name never published is what the give-up names, in minutes for the default deadline', async () => {
    const f = fake({ dns: () => missing });
    await assert.rejects(wait(f), (err: Error) => {
        assert.equal(err.message, `The link did not start working within 2 minutes: Cloudflare has not published ${HOST} yet`);
        return true;
    });
    assert.equal(f.calls.some(c => c.startsWith('probe')), false);
});

test('a link that answers with the wrong page, or not at all, says so when it gives up', async () => {
    const other = fake({ probe: () => answer(200, 'somebody else') });
    await assert.rejects(wait(other, 3_000), /answered with a page that is not this share's/);
    const dead = fake({
        probe: () => {
            throw new Error('connect ETIMEDOUT');
        }
    });
    await assert.rejects(wait(dead, 3_000), /could not be reached: connect ETIMEDOUT/);
});

test('cancelling stops the wait at once, and nothing more is asked', async () => {
    const f = fake({
        probe: attempt => {
            if (attempt === 1) f.controller.abort();
            return answer(530);
        }
    });
    await assert.rejects(wait(f), /cancelled/);
    assert.equal(f.calls.filter(c => c.startsWith('probe')).length, 2);
});

test('a wait already cancelled asks nothing', async () => {
    const f = fake({});
    f.controller.abort();
    await assert.rejects(wait(f), /cancelled/);
    assert.deepEqual(f.calls, []);
});

test('the log hears each change once, not every poll', async () => {
    const f = fake({
        dns: round => (round < 2 ? missing : found('104.16.231.132')),
        probe: attempt => (attempt < 3 ? answer(530) : answer(200, PROBE.token))
    });
    await wait(f);
    assert.equal(f.logs.filter(l => /has not published/.test(l)).length, 1);
    assert.equal(f.logs.filter(l => /published/.test(l) && !/not/.test(l)).length, 1);
    assert.equal(f.logs.filter(l => /530/.test(l)).length, 1);
    assert.match(f.logs.at(-1)!, /reached this share after \d+ s/);
});

// ── the real io ─────────────────────────────────────────────────────────

type Reply = 'nxdomain' | 'nodata' | 'refused' | 'recursive' | 'silent' | 'wrong-id' | { a: string[] };

/** A nameserver on loopback that answers as `reply` says, recording each question. */
async function nameserver(t: { after: (fn: () => void) => void }, reply: Reply): Promise<{ address: string; port: number; asked: string[] }> {
    const asked: string[] = [];
    const socket = createSocket('udp4');
    t.after(() => socket.close());
    socket.on('message', (msg, from) => {
        const labels: string[] = [];
        let i = 12;
        while (msg[i]) {
            labels.push(msg.subarray(i + 1, i + 1 + msg[i]!).toString('ascii'));
            i += msg[i]! + 1;
        }
        i++;
        const type = msg.readUInt16BE(i);
        const question = msg.subarray(12, i + 4);
        asked.push(`${labels.join('.')} ${type === 1 ? 'A' : type === 28 ? 'AAAA' : type} rd=${msg[2]! & 1}`);
        if (reply === 'silent') return;
        const rcode = reply === 'nxdomain' ? 3 : reply === 'refused' ? 5 : 0;
        const aa = reply === 'recursive' ? 0 : 0x0400;
        const addresses = typeof reply === 'object' && type === 1 ? reply.a : [];
        const header = Buffer.alloc(12);
        header.writeUInt16BE(reply === 'wrong-id' ? msg.readUInt16BE(0) ^ 0xffff : msg.readUInt16BE(0), 0);
        header.writeUInt16BE(0x8000 | aa | (reply === 'recursive' ? 0x0180 : 0) | rcode, 2);
        header.writeUInt16BE(1, 4);
        header.writeUInt16BE(reply === 'recursive' ? 0 : addresses.length, 6);
        const records = addresses.map(ip => {
            const rr = Buffer.alloc(16);
            rr.writeUInt16BE(0xc00c, 0);
            rr.writeUInt16BE(1, 2);
            rr.writeUInt16BE(1, 4);
            rr.writeUInt32BE(300, 6);
            rr.writeUInt16BE(4, 10);
            ip.split('.').forEach((octet, n) => rr.writeUInt8(Number(octet), 12 + n));
            return rr;
        });
        socket.send(Buffer.concat([header, question, ...records]), from.port, from.address);
    });
    await new Promise<void>(resolve => socket.bind(0, '127.0.0.1', resolve));
    return { address: '127.0.0.1', port: socket.address().port, asked };
}

test('a name an authoritative server has not got is missing, asked once for each address type without recursion', async t => {
    const ns = await nameserver(t, 'nxdomain');
    assert.deepEqual(await queryAuthoritative(ns, HOST, { timeoutMs: 500 }), missing);
    assert.deepEqual(ns.asked.sort(), [`${HOST} A rd=0`, `${HOST} AAAA rd=0`]);
});

test('a name an authoritative server has is found, with its addresses', async t => {
    const ns = await nameserver(t, { a: ['104.16.230.132', '104.16.231.132'] });
    assert.deepEqual(await queryAuthoritative(ns, HOST, { timeoutMs: 500 }), found('104.16.230.132', '104.16.231.132'));
});

test('a name that exists with no address records yet is missing', async t => {
    const ns = await nameserver(t, 'nodata');
    assert.deepEqual(await queryAuthoritative(ns, HOST, { timeoutMs: 500 }), missing);
});

test('an answer that is not authoritative means a caching resolver answered, which is no answer at all', async t => {
    const ns = await nameserver(t, 'recursive');
    assert.deepEqual(await queryAuthoritative(ns, HOST, { timeoutMs: 500 }), unreachable);
});

test('a refusal, silence, or a reply to some other question cannot be read as an answer', async t => {
    for (const reply of ['refused', 'silent', 'wrong-id'] as const) {
        const ns = await nameserver(t, reply);
        assert.deepEqual(await queryAuthoritative(ns, HOST, { timeoutMs: 200 }), unreachable, reply);
    }
});

test('only a plain host name is ever put in a question', async () => {
    for (const bad of ['', 'a..b', `${'x'.repeat(64)}.com`, 'bad name.com', 'ok.com ']) {
        await assert.rejects(queryAuthoritative({ address: '127.0.0.1', port: 9 }, bad, { timeoutMs: 100 }), /not a host name/, bad);
    }
});

test('the probe connects to the address it is given and never looks the host up', async t => {
    const relay = await startRelay({ target: () => null });
    t.after(() => relay.close());
    const res = await fetchProbe({ host: 'never-resolves.invalid', address: '127.0.0.1', path: relay.probe.path }, { scheme: 'http', port: relay.port });
    assert.deepEqual(res, { status: 200, body: relay.probe.token });
});

test('a probe that cannot connect, or hears nothing in time, fails', async t => {
    const relay = await startRelay({ target: () => null });
    const port = relay.port;
    await relay.close();
    await assert.rejects(fetchProbe({ host: 'x.invalid', address: '127.0.0.1', path: '/' }, { scheme: 'http', port }));

    const silent = createServer(() => {});
    t.after(() => silent.close());
    await new Promise<void>(resolve => silent.listen(0, '127.0.0.1', resolve));
    const address = silent.address();
    const silentPort = typeof address === 'object' && address ? address.port : 0;
    await assert.rejects(fetchProbe({ host: 'x.invalid', address: '127.0.0.1', path: '/' }, { scheme: 'http', port: silentPort, timeoutMs: 200 }), /timed out/);
    silent.closeAllConnections();
});

test('a probe reads only the start of a long answer', async t => {
    const big = createServer((_req, res) => res.end('x'.repeat(1_000_000)));
    t.after(() => big.close());
    await new Promise<void>(resolve => big.listen(0, '127.0.0.1', resolve));
    const address = big.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const res = await fetchProbe({ host: 'x.invalid', address: '127.0.0.1', path: '/' }, { scheme: 'http', port });
    assert.equal(res.status, 200);
    assert.ok(res.body.length <= 4096);
});
