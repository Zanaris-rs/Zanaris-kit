import { connect } from 'node:tls';
import { LOBBY, SERVER_LOG, type ChatSettings, type ChatView } from '../../shared/chat.ts';
import { serverChannel } from './channels.ts';
import { backoffDelay, IrcClient } from './client.ts';
import { sameName } from './protocol.ts';

/**
 * The app's one chat connection.
 *
 * IrcClient is pure state over lines, so everything it deliberately does not
 * have lives here: the socket, the half-arrived line still in the buffer, and
 * the reconnect timer. One connection serves every window — chat outlives the
 * window that opened it, and closing a game does not close the conversation.
 *
 * IO is injected the way WorldsService takes its own, so the tests drive a
 * fake transport and none of them opens a socket.
 */

/** What the service does with a socket, once it has one. */
export interface ChatSocket {
    /** Sends one command. The transport adds the CRLF. */
    send(line: string): void;
    /** Drops the connection. Whatever close event follows is ours, not the server's. */
    close(): void;
}

/** How a socket reports back. Handed to connect() so nothing can arrive before we are listening. */
export interface SocketHandlers {
    /** The connection is up and ready to be written to. */
    opened(): void;
    /** Whatever bytes arrived, which is rarely a whole number of lines. */
    data(chunk: string): void;
    closed(reason: string): void;
}

export interface ChatIo {
    connect(host: string, port: number, handlers: SocketHandlers): ChatSocket;
    now(): number;
    /** Schedules fn; the returned closure cancels it. Injected so a test fires the reconnect instead of waiting for it. */
    setTimer(fn: () => void, ms: number): () => void;
}

/**
 * TCP is a stream of bytes, not of lines: one chunk can hold six messages, a
 * quarter of one, or nothing but the CRLF that finished the last. This keeps
 * whatever did not end in a newline for the next chunk to complete.
 *
 * Blank lines are dropped rather than passed on: a keepalive-only chunk is not
 * a message, and the parser would only reject it further down.
 */
export function splitLines(pending: string, chunk: string): { lines: string[]; rest: string } {
    const parts = `${pending}${chunk}`.split('\n');
    // The last piece has no newline after it, so it is the start of the next line, not a line.
    const rest = parts.pop() ?? '';
    return { lines: parts.map(line => line.replace(/\r$/, '')).filter(line => line !== ''), rest };
}

/**
 * The channels the app should be in: the shared lobby, always, plus a room for
 * each open server that has one. Local and user-added servers map to nothing
 * and drop out here.
 */
export function wantedChannels(serverIds: string[]): string[] {
    const channels = [LOBBY];
    for (const id of serverIds) {
        const channel = serverChannel(id);
        // Two windows on one server share its room, so an id already mapped adds nothing.
        if (channel !== null && !channels.includes(channel)) channels.push(channel);
    }
    return channels;
}

/** What the panel shows when there is no connection to describe yet. */
export function offlineChat(nick: string | null): ChatView {
    return { status: 'offline', nick, channels: [], active: SERVER_LOG, lines: [], error: null, needsNick: nick === null };
}

/**
 * What a freshly built IrcClient should join: the auto set plus whatever
 * rooms were persisted, so a hand-joined room from a previous run comes back
 * on this run's first connection. Folded to compare so a persisted room that
 * only differs in case from an auto-joined one is not listed, and later
 * joined, twice.
 */
export function initialChannels(autoSet: string[], rooms: string[]): string[] {
    const channels = [...autoSet];
    for (const room of rooms) if (!channels.some(c => sameName(c, room))) channels.push(room);
    return channels;
}

/**
 * Everything the client is in that the auto set does not account for — the
 * derivation the whole close feature rests on. Folded to compare: IRC names
 * are case-insensitive, so a room that entered `wanted` in a different case
 * than the auto set's own canonical spelling is still the same room, and
 * must not be misread as the user's own to close.
 */
export function handJoinedChannels(wanted: string[], autoSet: string[]): string[] {
    return wanted.filter(channel => !autoSet.some(auto => sameName(auto, channel)));
}

export class ChatService {
    private readonly io: ChatIo;
    private readonly host: string;
    private readonly port: number;
    private nick: string | null;
    /** Rooms persisted from a previous run, joined alongside the auto set the first time a client is built. */
    private readonly rooms: string[];
    private client: IrcClient | null = null;
    private socket: ChatSocket | null = null;
    private pending = '';
    private channels: string[] = wantedChannels([]);
    /** Failed attempts since the last connection that reached online, which is what the backoff counts. */
    private attempt = 0;
    private cancelRetry: (() => void) | null = null;
    private stopped = false;
    /**
     * Which connection the handlers belong to. A socket that closes after we
     * have moved on — one we replaced, or one stop() dropped — must not be
     * able to reconnect us or write into the log.
     */
    private generation = 0;
    private readonly subscribers = new Set<(view: ChatView) => void>();

    constructor(settings: ChatSettings, io: ChatIo) {
        this.io = io;
        this.host = settings.server;
        this.port = settings.port;
        this.nick = settings.nick === '' ? null : settings.nick;
        this.rooms = settings.rooms;
        // A remembered nick connects straight away; without one nothing opens,
        // which is what a capture run — whose profile has no nick — relies on.
        if (this.nick !== null) this.open();
    }

    view(): ChatView {
        if (this.client === null) return offlineChat(this.nick);
        const snapshot = this.client.snapshot();
        const handJoined = this.handJoined();
        return {
            ...snapshot,
            channels: snapshot.channels.map(channel => ({ ...channel, closable: handJoined.some(c => sameName(c, channel.name)) })),
            needsNick: this.nick === null
        };
    }

    /**
     * Everything the client is in that this service did not put it in for
     * managing the open windows. Never stored: a second list of "the rooms I
     * joined by hand" would let this and setServers's own bookkeeping
     * (`this.channels`) drift apart, and then a close button and a window
     * closing could disagree about what is closable.
     */
    private handJoined(): string[] {
        if (this.client === null) return [];
        return handJoinedChannels(this.client.wanted(), this.channels);
    }

    subscribe(cb: (view: ChatView) => void): () => void {
        this.subscribers.add(cb);
        return () => {
            this.subscribers.delete(cb);
        };
    }

    /** Chooses the nick and connects. Until one is set the app stays offline, which is what capture mode runs as. */
    setNick(nick: string): void {
        const wanted = nick.trim();
        if (wanted === '' || wanted === this.nick) return;
        this.nick = wanted;
        this.stopped = false;
        const client = this.client;
        const status = client?.snapshot().status;
        if (client !== null && (status === 'online' || status === 'registering')) {
            // A rename on a live connection is the server's to confirm, so it
            // goes over the wire and the view follows the echo.
            client.input(`/nick ${wanted}`);
            this.emit();
            return;
        }
        // Otherwise the nick only becomes real by registering with it, and this
        // client took the old one at construction: start the conversation over.
        this.restart();
    }

    /**
     * The servers with a window open. Their rooms plus the lobby are the set we
     * mean to be in; a change joins and parts the difference rather than
     * reconnecting. Channels the user joined by hand are left alone: only rooms
     * this mapping added are ever parted by it.
     */
    setServers(serverIds: string[]): void {
        const wanted = wantedChannels(serverIds);
        const added = wanted.filter(channel => !this.channels.includes(channel));
        const gone = this.channels.filter(channel => !wanted.includes(channel));
        this.channels = wanted;
        if (this.client === null || (added.length === 0 && gone.length === 0)) return;
        for (const channel of added) this.client.join(channel);
        for (const channel of gone) this.client.part(channel);
        this.emit();
    }

    /** One typed line. Text beginning with / is a command; the client decides what it means. */
    send(text: string): void {
        if (this.client === null) return;
        this.client.input(text);
        this.emit();
    }

    /**
     * Parts a room the user joined by hand. Refused for anything else — the
     * lobby and a per-server room are not the user's to close from here, and
     * that refusal belongs here rather than in the caller: only the service
     * has both halves handJoined() derives from, so only it can tell the two
     * cases apart without re-deriving the same set a second time.
     */
    closeRoom(channel: string): boolean {
        if (this.client === null || !this.handJoined().some(c => sameName(c, channel))) return false;
        this.client.part(channel);
        this.emit();
        return true;
    }

    select(channel: string): void {
        if (this.client === null) return;
        // Only a channel the rail already shows: selecting anything else would
        // invent a tab for a room nobody is in.
        const known = this.client.snapshot().channels.some(c => sameName(c.name, channel));
        if (!known) return;
        this.client.select(channel);
        this.emit();
    }

    /** For quit. The close this causes is ours, so nothing reconnects after it. */
    stop(): void {
        this.stopped = true;
        this.cancel();
        this.generation++;
        this.socket?.close();
        this.socket = null;
        this.client?.closed('', false);
        this.emit();
    }

    // ── the connection ───────────────────────────────────────────────────

    /** Drops everything and connects afresh, for a change the current registration cannot carry. */
    private restart(): void {
        this.cancel();
        this.generation++;
        this.socket?.close();
        this.socket = null;
        this.client = null;
        this.attempt = 0;
        this.open();
    }

    private open(): void {
        this.cancel();
        if (this.nick === null || this.stopped || this.socket !== null) return;

        // The client survives a reconnect, so the log does too.
        const client =
            this.client ??
            new IrcClient({
                nick: this.nick,
                channels: initialChannels(this.channels, this.rooms),
                now: () => this.io.now(),
                send: line => this.socket?.send(line)
            });
        this.client = client;
        client.connecting();
        this.pending = '';

        const gen = ++this.generation;
        const mine = (): boolean => gen === this.generation;
        this.socket = this.io.connect(this.host, this.port, {
            opened: () => {
                if (mine()) this.opened();
            },
            data: chunk => {
                if (mine()) this.receive(chunk);
            },
            closed: reason => {
                if (mine()) this.closed(reason);
            }
        });
        this.emit();
    }

    private opened(): void {
        this.client?.opened();
        this.emit();
    }

    private receive(chunk: string): void {
        const { lines, rest } = splitLines(this.pending, chunk);
        this.pending = rest;
        if (this.client === null || lines.length === 0) return;
        for (const line of lines) this.client.receive(line);
        // Registration succeeded, so the next failure starts the backoff over.
        if (this.client.snapshot().status === 'online') this.attempt = 0;
        this.emit();
    }

    private closed(reason: string): void {
        this.socket = null;
        this.pending = '';
        const retrying = !this.stopped && this.nick !== null;
        this.client?.closed(reason, retrying);
        if (retrying) {
            this.attempt++;
            this.cancelRetry = this.io.setTimer(() => {
                this.cancelRetry = null;
                this.open();
            }, backoffDelay(this.attempt));
        }
        this.emit();
    }

    private cancel(): void {
        this.cancelRetry?.();
        this.cancelRetry = null;
    }

    private emit(): void {
        const view = this.view();
        for (const cb of this.subscribers) cb(view);
    }
}

/**
 * The real transport: one TLS socket, decoded as UTF-8 so a multi-byte
 * character split across packets is the decoder's problem rather than the
 * parser's. servername is passed explicitly because IRC networks front many
 * hosts on one address and the certificate is chosen by SNI.
 */
export function tlsConnect(host: string, port: number, handlers: SocketHandlers): ChatSocket {
    const socket = connect({ host, port, servername: host });
    socket.setEncoding('utf8');
    // An error is always followed by close, so it only supplies the reason.
    let failure: string | null = null;
    socket.on('error', err => {
        failure = err.message;
    });
    socket.on('secureConnect', () => handlers.opened());
    socket.on('data', chunk => handlers.data(String(chunk)));
    socket.on('close', () => handlers.closed(failure ?? 'the connection closed'));
    return {
        send: line => {
            if (!socket.destroyed) socket.write(`${line}\r\n`);
        },
        close: () => socket.destroy()
    };
}
