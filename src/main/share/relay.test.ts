import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
import { startRelay, type Relay } from './relay.ts';

interface World {
    port: number;
    hits: string[];
    close(): Promise<void>;
}

/** A stand-in world: a page, a method it would accept, and a websocket-style upgrade that echoes. */
async function world(name: string): Promise<World> {
    const hits: string[] = [];
    const sockets = new Set<Socket>();
    const server: Server = createServer((req, res) => {
        hits.push(`${req.method} ${req.url}`);
        res.writeHead(200, { 'content-type': 'text/plain', 'x-world': name });
        res.end(req.method === 'HEAD' ? undefined : `${name} ${req.url}`);
    });
    server.on('connection', s => {
        sockets.add(s);
        s.on('close', () => sockets.delete(s));
    });
    server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
        hits.push(`UPGRADE ${req.url} ${req.headers['sec-websocket-protocol'] ?? ''}`);
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
        if (head.length) socket.write(head);
        socket.on('data', (chunk: Buffer) => socket.write(Buffer.concat([Buffer.from(`${name}:`), chunk])));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    return {
        port: typeof address === 'object' && address ? address.port : 0,
        hits,
        close: () =>
            new Promise(resolve => {
                for (const s of sockets) s.destroy();
                server.close(() => resolve());
            })
    };
}

function send(port: number, method: string, path: string): Promise<{ status: number; headers: IncomingMessage['headers']; body: string }> {
    return new Promise((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, method, path, agent: false }, res => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => (body += chunk));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
        });
        req.on('error', reject);
        req.end();
    });
}

/** Opens an upgraded connection through the relay, or resolves with the status it was refused with. */
function upgrade(port: number, path = '/', method = 'GET'): Promise<{ socket: Socket; head: Buffer } | { refused: number }> {
    return new Promise((resolve, reject) => {
        const req = request({
            host: '127.0.0.1',
            port,
            path,
            method,
            agent: false,
            headers: { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-protocol': 'binary', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' }
        });
        req.on('upgrade', (_res, socket, head) => resolve({ socket, head }));
        req.on('response', res => {
            res.resume();
            resolve({ refused: res.statusCode ?? 0 });
        });
        req.on('error', reject);
        req.end();
    });
}

async function nextData(socket: Socket): Promise<string> {
    const [chunk] = (await once(socket, 'data')) as [Buffer];
    return chunk.toString();
}

async function relayTo(t: { after: (fn: () => Promise<void>) => void }, target: () => number | null, maxSockets?: number): Promise<Relay> {
    const relay = await startRelay({ target, maxSockets });
    t.after(() => relay.close());
    return relay;
}

test('a GET reaches the world with its path and query, and the world\'s answer comes back', async t => {
    const w = await world('w1');
    t.after(() => w.close());
    const relay = await relayTo(t, () => w.port);
    const res = await send(relay.port, 'GET', '/rs2.cgi?lowmem=1');
    assert.equal(res.status, 200);
    assert.equal(res.body, 'w1 /rs2.cgi?lowmem=1');
    assert.equal(res.headers['x-world'], 'w1');
    assert.deepEqual(w.hits, ['GET /rs2.cgi?lowmem=1']);
});

test('a HEAD reaches the world too', async t => {
    const w = await world('w1');
    t.after(() => w.close());
    const relay = await relayTo(t, () => w.port);
    const res = await send(relay.port, 'HEAD', '/crc123');
    assert.equal(res.status, 200);
    assert.deepEqual(w.hits, ['HEAD /crc123']);
});

test('every other method is refused and never reaches the world', async t => {
    const w = await world('w1');
    t.after(() => w.close());
    const relay = await relayTo(t, () => w.port);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
        const res = await send(relay.port, method, '/content/x');
        assert.equal(res.status, 405, method);
        assert.equal(res.headers.allow, 'GET, HEAD');
    }
    assert.deepEqual(w.hits, []);
});

test('an upgrade by any method but GET is refused and never reaches the world', async t => {
    const w = await world('w1');
    t.after(() => w.close());
    const relay = await relayTo(t, () => w.port);
    assert.deepEqual(await upgrade(relay.port, '/', 'POST'), { refused: 405 });
    assert.deepEqual(w.hits, []);
});

test('while the world is down, pages answer 503 and upgrades are refused', async t => {
    const relay = await relayTo(t, () => null);
    const res = await send(relay.port, 'GET', '/rs2.cgi');
    assert.equal(res.status, 503);
    assert.match(res.body, /isn.t running/);
    assert.equal(res.headers['cache-control'], 'no-store');
    const up = await upgrade(relay.port);
    assert.deepEqual(up, { refused: 503 });
});

test('an upgrade is passed through with its headers, and bytes flow both ways untouched', async t => {
    const w = await world('w1');
    t.after(() => w.close());
    const relay = await relayTo(t, () => w.port);
    const up = await upgrade(relay.port, '/');
    assert.ok('socket' in up);
    t.after(() => up.socket.destroy());
    up.socket.write(Buffer.from([14, 0]));
    assert.equal(await nextData(up.socket), `w1:${String.fromCharCode(14, 0)}`);
    assert.deepEqual(w.hits, ['UPGRADE / binary']);
});

test('when the world comes back on another port, the next request follows it', async t => {
    const w1 = await world('w1');
    const w2 = await world('w2');
    t.after(() => w1.close());
    t.after(() => w2.close());
    let port: number | null = w1.port;
    const relay = await relayTo(t, () => port);
    assert.equal((await send(relay.port, 'GET', '/a')).body, 'w1 /a');
    port = null;
    assert.equal((await send(relay.port, 'GET', '/a')).status, 503);
    port = w2.port;
    assert.equal((await send(relay.port, 'GET', '/a')).body, 'w2 /a');
});

test('a world that refuses the connection is a 502, and a refused upgrade is closed', async t => {
    const w = await world('gone');
    const port = w.port;
    await w.close();
    const relay = await relayTo(t, () => port);
    assert.equal((await send(relay.port, 'GET', '/rs2.cgi')).status, 502);
    const up = await upgrade(relay.port).catch(() => ({ refused: -1 }));
    assert.ok('refused' in up);
});

test('connections past the cap are turned away', async t => {
    const w = await world('w1');
    t.after(() => w.close());
    const relay = await relayTo(t, () => w.port, 2);
    const a = await upgrade(relay.port);
    const b = await upgrade(relay.port);
    assert.ok('socket' in a && 'socket' in b);
    t.after(() => a.socket.destroy());
    t.after(() => b.socket.destroy());
    await assert.rejects(send(relay.port, 'GET', '/rs2.cgi'));
});

test('closing the relay ends the connections it holds open', async t => {
    const w = await world('w1');
    t.after(() => w.close());
    const relay = await startRelay({ target: () => w.port });
    const up = await upgrade(relay.port);
    assert.ok('socket' in up);
    const closed = once(up.socket, 'close');
    await relay.close();
    await closed;
    await assert.rejects(send(relay.port, 'GET', '/rs2.cgi'));
});

test('the readiness path is answered by the relay itself with its token, and never reaches the world', async t => {
    const w = await world('w1');
    t.after(() => w.close());
    const relay = await relayTo(t, () => w.port);
    assert.match(relay.probe.token, /^[0-9a-f]{32}$/);
    assert.equal(relay.probe.path, `/.zanaris-kit/reachable/${relay.probe.token}`);
    const res = await send(relay.port, 'GET', relay.probe.path);
    assert.equal(res.status, 200);
    assert.equal(res.body, relay.probe.token);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal((await send(relay.port, 'HEAD', relay.probe.path)).status, 200);
    assert.deepEqual(w.hits, []);
});

test('the readiness path answers while the world is down, since a share outlives a restart', async t => {
    const relay = await relayTo(t, () => null);
    const res = await send(relay.port, 'GET', relay.probe.path);
    assert.equal(res.status, 200);
    assert.equal(res.body, relay.probe.token);
});

test('only this relay\'s own token is answered: any other path is the world\'s, and other methods are still refused', async t => {
    const w = await world('w1');
    t.after(() => w.close());
    const relay = await relayTo(t, () => w.port);
    const other = await send(relay.port, 'GET', `/.zanaris-kit/reachable/${'0'.repeat(32)}`);
    assert.notEqual(other.body, relay.probe.token);
    assert.equal((await send(relay.port, 'GET', `${relay.probe.path}?x=1`)).body, `w1 ${relay.probe.path}?x=1`);
    assert.equal((await send(relay.port, 'POST', relay.probe.path)).status, 405);
    const second = await relayTo(t, () => w.port);
    assert.notEqual(second.probe.token, relay.probe.token);
});

test('the relay listens on loopback only', async t => {
    const relay = await relayTo(t, () => null);
    const lan = Object.values(networkInterfaces())
        .flat()
        .find(entry => entry && entry.family === 'IPv4' && !entry.internal);
    if (!lan) {
        t.skip('no routable IPv4 address on this machine');
        return;
    }
    const socket = connect(relay.port, lan.address);
    const [err] = (await once(socket, 'error')) as [NodeJS.ErrnoException];
    assert.equal(err.code, 'ECONNREFUSED');
});
