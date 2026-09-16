import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/**
 * A Cloudflare quick tunnel: `cloudflared tunnel --url …` with no account,
 * which answers with a random https://<words>.trycloudflare.com link. The
 * rules for running it are here, pure over a spawn; `spawnProcess` is the
 * spawn, in plain Node so the tests run the real thing against a fake binary.
 */

export interface TunnelProcess {
    /** Resolves with the exit code, null when a signal ended it or it never started, once its output is drained. */
    readonly exited: Promise<number | null>;
    /** Does nothing once the process has gone. */
    kill(signal: 'SIGTERM' | 'SIGKILL'): void;
}

export interface TunnelSpawnSpec {
    command: string;
    args: string[];
    env: Record<string, string>;
    /** One line of cloudflared's log. It writes all of it to stderr. */
    onLine: (line: string) => void;
}

export interface QuickTunnelIo {
    /** The environment cloudflared would inherit, before `sanitizeEnv`. */
    env: Record<string, string | undefined>;
    spawn(spec: TunnelSpawnSpec): TunnelProcess;
}

export interface QuickTunnelOptions {
    binary: string;
    /** The loopback port the tunnel forwards to. */
    port: number;
    /** A config file holding `{}`. See `buildArgs`. */
    configPath: string;
    registerTimeoutMs?: number;
    stopGraceMs?: number;
    /** Aborting it while the tunnel connects kills cloudflared and rejects, without a retry. */
    signal?: AbortSignal;
}

export interface QuickTunnel {
    /** https://<words>.trycloudflare.com */
    readonly url: string;
    /** Settles when cloudflared ends, whether stopped or not. */
    readonly exited: Promise<number | null>;
    /** Asks cloudflared to stop, and kills it after the grace period. Safe to call again. */
    stop(): Promise<void>;
    /** The last lines cloudflared printed, across both attempts. */
    logs(): string[];
}

export class TunnelError extends Error {
    readonly logs: string[];
    constructor(message: string, logs: string[]) {
        super(message);
        this.logs = logs;
    }
}

class Cancelled extends TunnelError {}

const LOG_LINES = 200;
/** Long enough for a slow network to register; a tunnel that does not by then is retried over http2. */
const REGISTER_TIMEOUT_MS = 30_000;
const STOP_GRACE_MS = 5_000;
const ANNOUNCEMENT = 'Your quick Tunnel has been created';
const REGISTERED = 'Registered tunnel connection';
const LINK = /https:\/\/([a-z0-9-]+)\.trycloudflare\.com\b/g;

/**
 * - `--no-autoupdate`: cloudflared updates itself when its output is not a
 *   terminal, which would replace the pinned binary with an unchecked one.
 * - `--config` names a file holding `{}`. Without it cloudflared reads a
 *   `config.yml` from `~/.cloudflared` and elsewhere, whose ingress rules
 *   override `--url`.
 * - `--grace-period 1s`: the default thirty seconds waits out every open
 *   websocket, which a game always has.
 * - `--protocol http2` only on the retry: a quick tunnel otherwise forces QUIC,
 *   which a network that blocks UDP 7844 never lets through.
 */
export function buildArgs(opts: { port: number; configPath: string; protocol?: 'http2' }): string[] {
    return [
        'tunnel',
        '--no-autoupdate',
        '--config',
        opts.configPath,
        '--grace-period',
        '1s',
        '--loglevel',
        'info',
        ...(opts.protocol ? ['--protocol', opts.protocol] : []),
        '--url',
        `http://127.0.0.1:${opts.port}`
    ];
}

/** cloudflared reads most of its flags from TUNNEL_* variables and NO_AUTOUPDATE; none of those may reach it. */
export function sanitizeEnv(env: Record<string, string | undefined>): Record<string, string> {
    const kept: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        if (value === undefined) continue;
        const upper = key.toUpperCase();
        if (upper.startsWith('TUNNEL_') || upper === 'NO_AUTOUPDATE') continue;
        kept[key] = value;
    }
    return kept;
}

/**
 * Reads the link and the first registered connection out of cloudflared's
 * log. The link is the first trycloudflare host after the announcement: the
 * disclaimer before it names other URLs, and the provisioning line names the
 * api host.
 */
export function createLogParser(): { push(line: string): void; url(): string | null; registered(): boolean } {
    let announced = false;
    let url: string | null = null;
    let registered = false;
    return {
        push(raw) {
            const line = raw.replace(/\r$/, '');
            if (!announced) {
                announced = line.includes(ANNOUNCEMENT);
            } else if (url === null) {
                for (const match of line.matchAll(LINK)) {
                    if (match[1] === 'api') continue;
                    url = match[0];
                    break;
                }
            }
            if (line.includes(REGISTERED)) registered = true;
        },
        url: () => url,
        registered: () => registered
    };
}

/** cloudflared as a child process, its stderr split into lines. */
export function spawnProcess(spec: TunnelSpawnSpec): TunnelProcess {
    const child = spawn(spec.command, spec.args, { env: spec.env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    const exited = new Promise<number | null>(resolve => {
        child.once('error', err => {
            spec.onLine(`[kit] could not run cloudflared: ${err.message}`);
            resolve(null);
        });
        // 'close' rather than 'exit': it comes after stderr is drained, so the
        // lines explaining an early exit are in the log before anyone reads it.
        child.once('close', code => resolve(code));
    });
    if (child.stderr) createInterface({ input: child.stderr, crlfDelay: Infinity }).on('line', spec.onLine);
    return {
        exited,
        kill: signal => {
            if (child.exitCode === null && child.signalCode === null) child.kill(signal);
        }
    };
}

/**
 * Opens a quick tunnel to `127.0.0.1:<port>`, resolving once the link is known
 * and cloudflared has registered a connection to it. A first attempt that
 * exits or does not register in time is retried once over http2; the second
 * failure rejects with the log.
 */
export async function startQuickTunnel(io: QuickTunnelIo, opts: QuickTunnelOptions): Promise<QuickTunnel> {
    const logs: string[] = [];
    try {
        return await attempt(io, opts, logs);
    } catch (err) {
        if (err instanceof Cancelled || !(err instanceof TunnelError)) throw err;
        logs.push(`[kit] ${err.message}; trying again over http2`);
        return await attempt(io, opts, logs, 'http2');
    }
}

function attempt(io: QuickTunnelIo, opts: QuickTunnelOptions, logs: string[], protocol?: 'http2'): Promise<QuickTunnel> {
    if (opts.signal?.aborted) return Promise.reject(new Cancelled('Sharing was cancelled', [...logs]));
    const parser = createLogParser();
    let changed = (): void => {};
    const proc = io.spawn({
        command: opts.binary,
        args: buildArgs({ port: opts.port, configPath: opts.configPath, protocol }),
        env: sanitizeEnv(io.env),
        onLine: line => {
            logs.push(line);
            if (logs.length > LOG_LINES) logs.shift();
            parser.push(line);
            changed();
        }
    });
    const stop = stopper(proc, opts.stopGraceMs ?? STOP_GRACE_MS);
    const timeoutMs = opts.registerTimeoutMs ?? REGISTER_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (then: () => void): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            opts.signal?.removeEventListener('abort', onAbort);
            changed = () => {};
            then();
        };
        // A process that has not connected is never left running behind a rejection.
        const give = (err: TunnelError): void => finish(() => void stop().then(() => reject(err)));
        const timer = setTimeout(() => give(new TunnelError(`cloudflared did not connect within ${Math.round(timeoutMs / 1000)} s`, [...logs])), timeoutMs);
        const onAbort = (): void => give(new Cancelled('Sharing was cancelled', [...logs]));
        opts.signal?.addEventListener('abort', onAbort, { once: true });
        changed = () => {
            const url = parser.url();
            if (url !== null && parser.registered()) finish(() => resolve({ url, exited: proc.exited, stop, logs: () => [...logs] }));
        };
        void proc.exited.then(code => finish(() => reject(new TunnelError(`cloudflared exited (code ${code}) before the tunnel connected${lastError(logs)}`, [...logs]))));
    });
}

/** SIGTERM, then SIGKILL once the grace period is up. Every call shares the first one's stop. */
function stopper(proc: TunnelProcess, graceMs: number): () => Promise<void> {
    let stopping: Promise<void> | null = null;
    return () => {
        stopping ??= (async () => {
            proc.kill('SIGTERM');
            let timer: ReturnType<typeof setTimeout> | undefined;
            const grace = new Promise<'timeout'>(resolve => {
                timer = setTimeout(() => resolve('timeout'), graceMs);
            });
            const outcome = await Promise.race([proc.exited.then(() => 'exited' as const), grace]);
            clearTimeout(timer);
            if (outcome === 'timeout') {
                proc.kill('SIGKILL');
                await proc.exited;
            }
        })();
        return stopping;
    };
}

/** The last error cloudflared logged, without its timestamp, or its last line of any kind. */
function lastError(logs: string[]): string {
    const line = [...logs].reverse().find(l => /\bERR\b/.test(l)) ?? logs.at(-1);
    return line ? `: ${line.replace(/^\S+Z\s+[A-Z]{3}\s+/, '').trim()}` : '';
}
