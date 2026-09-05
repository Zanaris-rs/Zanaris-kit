import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type AddressInfo } from 'node:net';
import { probeLatency } from './probe.ts';

async function listening(): Promise<{ port: number; close: () => Promise<void> }> {
    const server = createServer(socket => socket.end());
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return { port, close: () => new Promise(resolve => server.close(() => resolve())) };
}

test('a listening port measures a non-negative number of milliseconds', async () => {
    const { port, close } = await listening();
    try {
        const ms = await probeLatency('127.0.0.1', port, 2000);
        assert.ok(typeof ms === 'number' && ms >= 0 && ms < 2000, `got ${ms}`);
    } finally {
        await close();
    }
});

test('a closed port resolves null rather than throwing', async () => {
    const { port, close } = await listening();
    await close();
    assert.equal(await probeLatency('127.0.0.1', port, 2000), null);
});

test('an unresolvable host resolves null', async () => {
    assert.equal(await probeLatency('does-not-exist.invalid', 443, 2000), null);
});
