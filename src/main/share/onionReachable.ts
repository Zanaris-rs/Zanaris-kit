import { connect, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { BODY_LIMIT, type ProbeAnswer } from './reachable.ts';

/**
 * Whether an onion link works yet. Tor publishes a hidden service's
 * descriptor some seconds after it starts, and a client may need several
 * circuits before it gets through, so the answer is a loop: ask the link, over
 * Tor's SOCKS port, for the path the relay answers itself, until this share's
 * token comes back. The rules are here, pure over `OnionIo`; the real io is a
 * hand-written SOCKS5 client over a plain socket, so the tests run it against a
 * fake SOCKS server on loopback.
 *
 * The host goes to Tor as a name (ATYP 3), never looked up here: a local lookup
 * of a .onion name would leak it to the resolver.
 */

export interface OnionIo {
    /** Rejects on a network or SOCKS error, or when `signal` aborts. */
    fetchViaSocks(socksPort: number, host: string, path: string, signal: AbortSignal): Promise<ProbeAnswer>;
    /** Rejects if `signal` aborts. */
    sleep(ms: number, signal: AbortSignal): Promise<void>;
    now(): number;
}

export interface OnionWaitOptions {
    /** http://<56 characters>.onion */
    url: string;
    socksPort: number;
    /** The path the relay answers itself, and the body it answers with. */
    probe: { path: string; token: string };
    signal: AbortSignal;
    deadlineMs?: number;
    intervalMs?: number;
    log?: (msg: string) => void;
}

const DEADLINE_MS = 300_000;
const INTERVAL_MS = 5_000;

/**
 * Resolves once a request to the link comes back from this share's relay with
 * its token. Rejects at the deadline or when `signal` aborts.
 */
export async function waitOnionReachable(io: OnionIo, opts: OnionWaitOptions): Promise<void> {
    const { signal, probe } = opts;
    const host = new URL(opts.url).hostname;
    const deadlineMs = opts.deadlineMs ?? DEADLINE_MS;
    const intervalMs = opts.intervalMs ?? INTERVAL_MS;
    const log = opts.log ?? (() => {});
    const started = io.now();
    const cancelled = (): Error => new Error('Sharing was cancelled');

    let said = '';
    /** Every attempt reports what it saw; the log hears it only when it changes. */
    const report = (what: string): void => {
        if (what === said) return;
        said = what;
        log(`[share] ${what}`);
    };

    if (signal.aborted) throw cancelled();
    log(`[share] waiting for ${host} to work over Tor`);
    for (;;) {
        try {
            const answer = await io.fetchViaSocks(opts.socksPort, host, probe.path, signal);
            if (answer.status === 200 && answer.body === probe.token) {
                log(`[share] ${host} reached this share after ${Math.round((io.now() - started) / 1000)} s`);
                return;
            }
            report(answer.status === 200 ? "the link answered with a page that is not this share's" : `the link answered ${answer.status}`);
        } catch (err) {
            report(`the link could not be reached: ${err instanceof Error ? err.message : String(err)}`);
        }

        if (signal.aborted) throw cancelled();
        const left = deadlineMs - (io.now() - started);
        if (left <= 0) throw new Error(`The onion link did not come up within ${Math.round(deadlineMs / 60_000)} minutes`);
        try {
            await io.sleep(Math.min(intervalMs, left), signal);
        } catch (err) {
            throw signal.aborted ? cancelled() : err;
        }
    }
}

// ── the real io ─────────────────────────────────────────────────────────

const ATTEMPT_TIMEOUT_MS = 60_000;

export function nodeOnionIo(): OnionIo {
    return {
        fetchViaSocks: (socksPort, host, path, signal) => fetchViaSocks(socksPort, host, path, signal),
        sleep: (ms, signal) => delay(ms, undefined, { signal }),
        now: () => performance.now()
    };
}

/**
 * One GET over a SOCKS5 connection (no authentication, CONNECT, the host as a
 * domain name, port 80). Reads the status and at most `BODY_LIMIT` bytes of the
 * body, which is all a probe's answer is. Destroys its socket on abort, on
 * timeout and on any failure.
 */
export function fetchViaSocks(socksPort: number, host: string, path: string, signal: AbortSignal, opts: { timeoutMs?: number } = {}): Promise<ProbeAnswer> {
    const name = Buffer.from(host, 'ascii');
    if (name.length === 0 || name.length > 255 || /[\r\n\0 ]/.test(host) || /[\r\n\0 ]/.test(path)) return Promise.reject(new Error('not a host and path'));
    const timeoutMs = opts.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
    if (signal.aborted) return Promise.reject(new Error('aborted'));
    return new Promise((resolve, reject) => {
        const socket: Socket = connect({ host: '127.0.0.1', port: socksPort });
        let settled = false;
        const settle = (then: () => void): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
            socket.destroy();
            then();
        };
        const fail = (err: Error): void => settle(() => reject(err));
        /** What the bytes so far make of the answer; a malformed one fails the attempt. */
        const read = (closed: boolean): ProbeAnswer | null => {
            try {
                return readHttp(buffered, closed);
            } catch (err) {
                fail(err instanceof Error ? err : new Error(String(err)));
                return null;
            }
        };
        const onAbort = (): void => fail(new Error('aborted'));
        const timer = setTimeout(() => fail(new Error(`timed out after ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
        signal.addEventListener('abort', onAbort, { once: true });

        let stage: 'greeting' | 'reply' | 'http' = 'greeting';
        let buffered = Buffer.alloc(0);
        socket.on('error', fail);
        socket.on('connect', () => socket.write(Buffer.from([0x05, 0x01, 0x00])));
        socket.on('close', () => {
            if (stage !== 'http') return fail(new Error('Tor closed the connection'));
            const answer = read(true);
            if (answer) settle(() => resolve(answer));
            else fail(new Error('the link closed without an answer'));
        });
        socket.on('data', (chunk: Buffer) => {
            buffered = Buffer.concat([buffered, chunk]);
            if (stage === 'greeting') {
                if (buffered.length < 2) return;
                if (buffered[0] !== 0x05 || buffered[1] !== 0x00) return fail(new Error('Tor refused the SOCKS greeting'));
                buffered = buffered.subarray(2);
                stage = 'reply';
                socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, name.length]), name, Buffer.from([0x00, 0x50])]));
            }
            if (stage === 'reply') {
                // 05 REP 00 ATYP ADDR PORT: the address is 4, 16 or 1 + n bytes.
                if (buffered.length < 5) return;
                if (buffered[0] !== 0x05) return fail(new Error('not a SOCKS5 reply'));
                if (buffered[1] !== 0x00) return fail(new Error(`Tor could not connect: SOCKS reply ${buffered[1]}`));
                const atyp = buffered[3];
                const addr = atyp === 0x01 ? 4 : atyp === 0x04 ? 16 : atyp === 0x03 ? 1 + buffered[4]! : -1;
                if (addr < 0) return fail(new Error('not a SOCKS5 reply'));
                const total = 4 + addr + 2;
                if (buffered.length < total) return;
                buffered = buffered.subarray(total);
                stage = 'http';
                socket.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Zanaris Kit\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n`);
            }
            if (stage === 'http') {
                const answer = read(false);
                if (answer) settle(() => resolve(answer));
            }
        });
    });
}

/**
 * The status and body of an HTTP/1.1 answer, or null while more is needed.
 * With a Content-Length, the answer is whole once that many bytes are in (or
 * `BODY_LIMIT`); a chunked one is decoded as far as it has come; with neither,
 * the body runs to the close, which is `closed`.
 */
function readHttp(raw: Buffer, closed: boolean): ProbeAnswer | null {
    const end = raw.indexOf('\r\n\r\n');
    if (end < 0) return null;
    const head = raw.subarray(0, end).toString('latin1');
    const status = /^HTTP\/1\.[01] (\d{3})/.exec(head);
    if (!status) throw new Error('not an HTTP answer');
    const body = raw.subarray(end + 4);
    const done = (bytes: Buffer): ProbeAnswer => ({ status: Number(status[1]), body: bytes.subarray(0, BODY_LIMIT).toString('utf8') });
    const length = /^content-length:\s*(\d+)\s*$/im.exec(head);
    if (length) {
        const want = Math.min(Number(length[1]), BODY_LIMIT);
        return body.length >= want || closed ? done(body.subarray(0, want)) : null;
    }
    if (/^transfer-encoding:\s*chunked/im.test(head)) {
        const parts: Buffer[] = [];
        let size = 0;
        let at = 0;
        for (;;) {
            const line = body.indexOf('\r\n', at);
            if (line < 0) break;
            const n = parseInt(body.subarray(at, line).toString('latin1').split(';')[0]!, 16);
            if (Number.isNaN(n)) throw new Error('bad chunk');
            if (n === 0) return done(Buffer.concat(parts));
            if (body.length < line + 2 + n) break;
            parts.push(body.subarray(line + 2, line + 2 + n));
            size += n;
            if (size >= BODY_LIMIT) return done(Buffer.concat(parts));
            at = line + 2 + n + 2;
        }
        return closed ? done(Buffer.concat(parts)) : null;
    }
    return body.length >= BODY_LIMIT || closed ? done(body) : null;
}
