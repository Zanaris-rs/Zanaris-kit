import { lookup } from 'node:dns/promises';
import { connect } from 'node:net';
import { performance } from 'node:perf_hooks';

/**
 * TCP connect time to host:port in milliseconds, or null on any failure or
 * once timeoutMs has passed. Never throws, and always destroys the socket.
 * The name is resolved first so the figure is the connect, not the lookup.
 * Electron-free on purpose: `node:net` and Electron's `net` share a name.
 */
export async function probeLatency(host: string, port: number, timeoutMs: number): Promise<number | null> {
    let address: string;
    try {
        const resolved = await Promise.race([
            lookup(host),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('lookup timed out')), timeoutMs).unref())
        ]);
        address = resolved.address;
    } catch {
        return null;
    }

    return new Promise(resolve => {
        const start = performance.now();
        const socket = connect({ host: address, port });
        let done = false;
        const finish = (value: number | null): void => {
            if (done) return;
            done = true;
            socket.destroy();
            resolve(value);
        };
        socket.on('error', () => finish(null));
        socket.setTimeout(timeoutMs, () => finish(null));
        socket.on('connect', () => finish(Math.round(performance.now() - start)));
    });
}
