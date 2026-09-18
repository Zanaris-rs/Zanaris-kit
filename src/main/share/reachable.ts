import { randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Whether a quick tunnel's link works yet. cloudflared registers before the
 * link does: Cloudflare publishes the name, and its edge stops answering 530,
 * anywhere from a few seconds to over half a minute later, either one first.
 *
 * Asking too early is worse than asking late. trycloudflare.com's negative
 * answers are cached for 1800 s, so a resolver asked about the name before it
 * is published — the system's, a friend's ISP's, 1.1.1.1 — keeps saying it
 * does not exist for up to half an hour after it does. So the name is only ever
 * put to Cloudflare's own authoritative nameservers, which cache nothing, and to
 * a probe that connects to the address they gave, or trycloudflare.com's own,
 * without looking anything up.
 * The rules are here, pure over `ReachableIo`; the real io is plain Node, so the
 * tests run it against a nameserver and a relay on loopback.
 */

export type AuthoritativeAnswer = { kind: 'found'; addresses: string[] } | { kind: 'missing' } | { kind: 'unreachable' };

export interface ProbeTarget {
    host: string;
    /** Where to connect. The host is never looked up. */
    address: string;
    path: string;
}

export interface ProbeAnswer {
    status: number;
    /** The start of the body, at most `BODY_LIMIT` bytes of it. */
    body: string;
}

export interface ReachableIo {
    /** Addresses of trycloudflare.com's nameservers. Their names exist, so looking them up leaves nothing wrong in a cache. */
    nameservers(): Promise<string[]>;
    /** Addresses of trycloudflare.com itself: an edge that routes any of its names, for when the nameservers cannot be asked. */
    edgeAddresses(): Promise<string[]>;
    /** Asks one authoritative server, and nothing else, for the host's addresses. */
    queryAuthoritative(server: string, host: string): Promise<AuthoritativeAnswer>;
    /** Rejects on a network error. */
    fetchProbe(target: ProbeTarget): Promise<ProbeAnswer>;
    /** Rejects if `signal` aborts. */
    sleep(ms: number, signal: AbortSignal): Promise<void>;
    now(): number;
}

export interface WaitOptions {
    /** https://<words>.trycloudflare.com */
    url: string;
    /** The path the relay answers itself, and the body it answers with. */
    probe: { path: string; token: string };
    signal: AbortSignal;
    deadlineMs?: number;
    log?: (msg: string) => void;
}

/** About three times what a link has been seen to take. */
const DEADLINE_MS = 120_000;
const FIRST_WAIT_MS = 1_000;
const LONGEST_WAIT_MS = 5_000;
const GROWTH = 1.5;
/** Rounds in which neither nameserver answers before the name stops being asked about: port 53 is blocked, or taken over. */
const SILENT_ROUNDS = 3;

const UNREACHABLE: AuthoritativeAnswer = { kind: 'unreachable' };

/**
 * Resolves once every nameserver that answers publishes the link's name and a
 * request to the link comes back from this share's relay with its token.
 * Rejects at the deadline, saying what it saw last, or when `signal` aborts.
 */
export async function waitUntilReachable(io: ReachableIo, opts: WaitOptions): Promise<void> {
    const { signal, probe } = opts;
    const host = new URL(opts.url).hostname;
    const deadlineMs = opts.deadlineMs ?? DEADLINE_MS;
    const log = opts.log ?? (() => {});
    const started = io.now();
    const seconds = (): number => Math.round((io.now() - started) / 1000);
    const cancelled = (): Error => new Error('Sharing was cancelled');

    let last = `Cloudflare has not published ${host} yet`;
    let said = '';
    /** Every poll reports what it saw; the log hears it only when it changes. */
    const report = (what: string): void => {
        last = what;
        if (what === said) return;
        said = what;
        log(`[share] ${what}`);
    };

    let servers: string[] = [];
    /** Where to reach the link, once its name is published or the nameservers have been given up on; empty means the edge's own. */
    let addresses: string[] | null = null;
    let silentRounds = 0;
    let attempt = 0;
    let wait = FIRST_WAIT_MS;

    if (signal.aborted) throw cancelled();
    log(`[share] waiting for ${host} to work from the internet`);
    for (;;) {
        if (addresses === null) {
            if (servers.length === 0) servers = await io.nameservers().catch(() => []);
            const answers = await Promise.all(servers.map(server => io.queryAuthoritative(server, host).catch(() => UNREACHABLE)));
            if (signal.aborted) throw cancelled();
            const heard = answers.filter(answer => answer.kind !== 'unreachable');
            if (heard.length === 0) {
                if (++silentRounds >= SILENT_ROUNDS) {
                    log("[share] Cloudflare's nameservers cannot be asked from this network; checking the link alone");
                    addresses = [];
                }
            } else if (heard.every(answer => answer.kind === 'found')) {
                addresses = [...new Set(heard.flatMap(answer => (answer.kind === 'found' ? answer.addresses : [])))];
                log(`[share] Cloudflare has published ${host}, after ${seconds()} s`);
            } else {
                silentRounds = 0;
                report(`Cloudflare has not published ${host} yet`);
            }
        }

        if (addresses !== null) {
            const pool = addresses.length > 0 ? addresses : await io.edgeAddresses().catch(() => []);
            if (pool.length === 0) {
                report('there is no address to reach Cloudflare at');
            } else {
                const address = pool[attempt++ % pool.length]!;
                try {
                    const answer = await io.fetchProbe({ host, address, path: probe.path });
                    if (answer.status === 200 && answer.body === probe.token) {
                        log(`[share] ${host} reached this share after ${seconds()} s`);
                        return;
                    }
                    report(answer.status === 200 ? "the link answered with a page that is not this share's" : `Cloudflare's edge still answered ${answer.status}`);
                } catch (err) {
                    report(`the link could not be reached: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        }

        if (signal.aborted) throw cancelled();
        const left = deadlineMs - (io.now() - started);
        if (left <= 0) throw new Error(`The link did not start working within ${span(deadlineMs)}: ${last}`);
        try {
            await io.sleep(Math.min(wait, left), signal);
        } catch (err) {
            throw signal.aborted ? cancelled() : err;
        }
        wait = Math.min(wait * GROWTH, LONGEST_WAIT_MS);
    }
}

function span(ms: number): string {
    if (ms >= 60_000 && ms % 60_000 === 0) return ms === 60_000 ? '1 minute' : `${ms / 60_000} minutes`;
    return `${Math.round(ms / 1000)} s`;
}

// ── the real io ─────────────────────────────────────────────────────────

/** From `dig NS trycloudflare.com`, 2026-09-17. */
export const TRYCLOUDFLARE_NAMESERVERS = ['kevin.ns.cloudflare.com', 'marjory.ns.cloudflare.com'];
const TRYCLOUDFLARE_APEX = 'trycloudflare.com';

const DNS_TIMEOUT_MS = 2_000;
const PROBE_TIMEOUT_MS = 5_000;
const BODY_LIMIT = 4096;
const TYPE_A = 1;
const TYPE_AAAA = 28;
const CLASS_IN = 1;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function nodeReachableIo(): ReachableIo {
    const addresses = async (name: string): Promise<string[]> => {
        const found = await lookup(name, { all: true });
        return [...found].sort((a, b) => a.family - b.family).map(entry => entry.address);
    };
    return {
        nameservers: async () => {
            const first = await Promise.all(TRYCLOUDFLARE_NAMESERVERS.map(name => addresses(name).then(list => list[0], () => undefined)));
            return first.filter((address): address is string => address !== undefined);
        },
        edgeAddresses: () => addresses(TRYCLOUDFLARE_APEX),
        queryAuthoritative: (server, host) => queryAuthoritative({ address: server }, host),
        fetchProbe: target => fetchProbe(target),
        sleep: (ms, signal) => delay(ms, undefined, { signal }),
        now: () => performance.now()
    };
}

/**
 * Asks one server for the host's A and AAAA records over UDP, with recursion
 * off. Only an authoritative answer counts: anything else — a caching resolver
 * answering for it, a refusal, silence — is `unreachable`.
 */
export async function queryAuthoritative(server: { address: string; port?: number }, host: string, opts: { timeoutMs?: number } = {}): Promise<AuthoritativeAnswer> {
    const labels = host.split('.');
    if (host.length > 253 || !labels.every(label => LABEL.test(label))) throw new Error(`${JSON.stringify(host)} is not a host name`);
    const name = labels.map(label => label.toLowerCase());
    const ask = (type: number): Promise<AuthoritativeAnswer> => askOnce(server.address, server.port ?? 53, name, type, opts.timeoutMs ?? DNS_TIMEOUT_MS);
    const [a, aaaa] = await Promise.all([ask(TYPE_A), ask(TYPE_AAAA)]);
    if (a.kind === 'found' || aaaa.kind === 'found') {
        return { kind: 'found', addresses: [a, aaaa].flatMap(answer => (answer.kind === 'found' ? answer.addresses : [])) };
    }
    return a.kind === 'missing' && aaaa.kind === 'missing' ? { kind: 'missing' } : UNREACHABLE;
}

function askOnce(address: string, port: number, name: string[], type: number, timeoutMs: number): Promise<AuthoritativeAnswer> {
    const id = randomBytes(2).readUInt16BE(0);
    const question = Buffer.concat([...name.flatMap(label => [Buffer.from([label.length]), Buffer.from(label, 'ascii')]), Buffer.from([0]), u16(type), u16(CLASS_IN)]);
    // Flags 0: a standard query with recursion not desired.
    const query = Buffer.concat([u16(id), u16(0), u16(1), u16(0), u16(0), u16(0), question]);
    const socket = createSocket(isIP(address) === 6 ? 'udp6' : 'udp4');
    return new Promise(resolve => {
        const finish = (answer: AuthoritativeAnswer): void => {
            clearTimeout(timer);
            socket.removeAllListeners('message');
            socket.close();
            resolve(answer);
        };
        const timer = setTimeout(() => finish(UNREACHABLE), timeoutMs);
        socket.on('error', () => finish(UNREACHABLE));
        socket.on('message', (msg, from) => {
            if (from.port !== port) return;
            const answer = readAnswer(msg, id, question, type);
            if (answer) finish(answer);
        });
        socket.send(query, port, address);
    });
}

/** The answer to our question, or null for a datagram that is not one. */
function readAnswer(msg: Buffer, id: number, question: Buffer, type: number): AuthoritativeAnswer | null {
    if (msg.length < 12 + question.length || msg.readUInt16BE(0) !== id || !(msg[2]! & 0x80)) return null;
    if (msg.readUInt16BE(4) !== 1 || !msg.subarray(12, 12 + question.length).equals(question)) return null;
    const authoritative = (msg[2]! & 0x04) !== 0;
    const truncated = (msg[2]! & 0x02) !== 0;
    const rcode = msg[3]! & 0x0f;
    if (!authoritative || truncated) return UNREACHABLE;
    if (rcode === 3) return { kind: 'missing' };
    if (rcode !== 0) return UNREACHABLE;
    const count = msg.readUInt16BE(6);
    const addresses: string[] = [];
    try {
        let offset = 12 + question.length;
        for (let i = 0; i < count; i++) {
            offset = skipName(msg, offset);
            const rtype = msg.readUInt16BE(offset);
            const rclass = msg.readUInt16BE(offset + 2);
            const length = msg.readUInt16BE(offset + 8);
            const data = msg.subarray(offset + 10, offset + 10 + length);
            if (data.length !== length) return UNREACHABLE;
            offset += 10 + length;
            if (rclass !== CLASS_IN || rtype !== type) continue;
            if (type === TYPE_A && length === 4) addresses.push([...data].join('.'));
            if (type === TYPE_AAAA && length === 16) addresses.push(ipv6(data));
        }
    } catch {
        return UNREACHABLE;
    }
    // Records of another kind for the name, a CNAME say, still mean it is published.
    if (addresses.length > 0 || count > 0) return { kind: 'found', addresses };
    return { kind: 'missing' };
}

function skipName(msg: Buffer, offset: number): number {
    for (;;) {
        const length = msg[offset];
        if (length === undefined) throw new RangeError('name runs past the end');
        if ((length & 0xc0) === 0xc0) return offset + 2;
        if (length === 0) return offset + 1;
        offset += length + 1;
    }
}

function ipv6(data: Buffer): string {
    const groups: string[] = [];
    for (let i = 0; i < 16; i += 2) groups.push(data.readUInt16BE(i).toString(16));
    // The URL parser writes an IPv6 address in its shortest form.
    return new URL(`http://[${groups.join(':')}]`).hostname.slice(1, -1);
}

function u16(value: number): Buffer {
    const buf = Buffer.alloc(2);
    buf.writeUInt16BE(value, 0);
    return buf;
}

/**
 * GET `path` from `host`, connected to `address`. The lookup is replaced, so
 * the host goes out only as the TLS server name and the Host header.
 */
export function fetchProbe(target: ProbeTarget, opts: { scheme?: 'https' | 'http'; port?: number; timeoutMs?: number } = {}): Promise<ProbeAnswer> {
    const family = isIP(target.address);
    if (family === 0) return Promise.reject(new Error(`${JSON.stringify(target.address)} is not an address`));
    const pinned = ((_host, options, callback) => {
        if (options.all) callback(null, [{ address: target.address, family }]);
        else callback(null, target.address, family);
    }) as LookupFunction;
    const scheme = opts.scheme ?? 'https';
    const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
        let settled = false;
        const settle = (then: () => void): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            then();
            req.destroy();
        };
        const req = (scheme === 'https' ? httpsRequest : httpRequest)(
            {
                host: target.host,
                port: opts.port ?? (scheme === 'https' ? 443 : 80),
                path: target.path,
                method: 'GET',
                agent: false,
                lookup: pinned,
                headers: { 'user-agent': 'Zanaris Kit', 'cache-control': 'no-cache' }
            },
            res => {
                const chunks: Buffer[] = [];
                let size = 0;
                const done = (): void => settle(() => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).subarray(0, BODY_LIMIT).toString('utf8') }));
                res.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                    size += chunk.length;
                    if (size >= BODY_LIMIT) done();
                });
                res.on('end', done);
                res.on('error', err => settle(() => reject(err)));
            }
        );
        const timer = setTimeout(() => settle(() => reject(new Error(`timed out after ${Math.round(timeoutMs / 1000)} s`))), timeoutMs);
        req.on('error', err => settle(() => reject(err)));
        req.end();
    });
}
