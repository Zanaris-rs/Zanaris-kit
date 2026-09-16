import { createServer, request, type IncomingHttpHeaders, type IncomingMessage, type OutgoingHttpHeaders } from 'node:http';
import { connect, type Socket } from 'node:net';

/**
 * What the tunnel actually points at: a loopback HTTP server in the main
 * process that hands each request to the world's current web port. The world
 * takes new ports every start, so pointing the tunnel at the world would cost
 * the link on every restart; pointing it here keeps the link for as long as
 * sharing is on.
 *
 * It forwards what the game needs and nothing else: GET and HEAD, and the
 * websocket upgrade the client plays over, piped through unread. Everything
 * else is refused before the world sees it. The management port is never a
 * target, since `target` only ever names the web port.
 */

export interface RelayOptions {
    /** The world's web port now, or null while it is not running. Asked again for every request. */
    target(): number | null;
    /** Connections held at once; more are dropped. A world takes ten players. */
    maxSockets?: number;
}

export interface Relay {
    readonly port: number;
    /** Stops listening and ends every connection, relayed or not. */
    close(): Promise<void>;
}

const MAX_SOCKETS = 64;
const ALLOWED = new Set(['GET', 'HEAD']);
/** Headers that describe one hop, which the relay is, and so are not passed on. */
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

const NOT_RUNNING = `<!doctype html>
<meta charset="utf-8">
<title>World not running</title>
<p>The host's world isn't running right now. It may be restarting: try again in a moment.</p>
`;

function endToEnd(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
    const kept: OutgoingHttpHeaders = {};
    for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined && !HOP_BY_HOP.has(key.toLowerCase())) kept[key] = value;
    }
    return kept;
}

/** The upgrade request exactly as it arrived, header case and order included. */
function requestHead(req: IncomingMessage): string {
    let head = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) head += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    return `${head}\r\n`;
}

function refuseRaw(socket: Socket, status: string): void {
    if (socket.writable) socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroySoon();
}

export async function startRelay(opts: RelayOptions): Promise<Relay> {
    const sockets = new Set<Socket>();
    const track = (socket: Socket): void => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
    };

    const server = createServer((req, res) => {
        const method = req.method ?? '';
        if (!ALLOWED.has(method)) {
            res.writeHead(405, { allow: 'GET, HEAD', 'content-length': 0 });
            res.end();
            return;
        }
        const port = opts.target();
        if (port === null) {
            res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '5' });
            res.end(method === 'HEAD' ? undefined : NOT_RUNNING);
            return;
        }
        // agent: false, so no pooled connection outlives the world it was opened to.
        const upstream = request({ host: '127.0.0.1', port, method, path: req.url, headers: endToEnd(req.headers), agent: false }, answer => {
            res.writeHead(answer.statusCode ?? 502, endToEnd(answer.headers));
            answer.pipe(res);
        });
        upstream.on('error', () => {
            if (!res.headersSent) {
                res.writeHead(502, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
                res.end('The host\'s world did not answer.');
            } else {
                res.destroy();
            }
        });
        res.on('close', () => upstream.destroy());
        upstream.end();
    });
    server.maxConnections = opts.maxSockets ?? MAX_SOCKETS;
    server.on('connection', track);

    server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
        const port = req.method === 'GET' ? opts.target() : null;
        if (req.method !== 'GET') return refuseRaw(socket, '405 Method Not Allowed');
        if (port === null) return refuseRaw(socket, '503 Service Unavailable');
        const upstream = connect(port, '127.0.0.1');
        track(upstream);
        let open = false;
        upstream.once('connect', () => {
            open = true;
            upstream.write(requestHead(req));
            if (head.length > 0) upstream.write(head);
            upstream.pipe(socket);
            socket.pipe(upstream);
        });
        upstream.on('error', () => {
            if (!open) refuseRaw(socket, '502 Bad Gateway');
            else socket.destroy();
        });
        socket.on('error', () => upstream.destroy());
        upstream.once('close', () => socket.destroy());
        socket.once('close', () => upstream.destroy());
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    let closing: Promise<void> | null = null;
    return {
        port,
        close: () => {
            closing ??= new Promise<void>(resolve => {
                server.close(() => resolve());
                for (const socket of sockets) socket.destroy();
            });
            return closing;
        }
    };
}
