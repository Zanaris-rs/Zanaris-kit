import { connect } from 'node:tls';
import { DEFAULT_AUTO_JOIN, SERVER_LOG, type ChatSettings, type ChatSettingsView, type ChatView } from '../../shared/chat.ts';
import { backoffDelay, IrcClient } from './client.ts';
import { isChannel, sameName } from './protocol.ts';

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

/** What the Settings tab shows when no service exists to ask: the defaults, nothing saved. */
const NO_SETTINGS: ChatSettingsView = { nick: null, autoJoin: [...DEFAULT_AUTO_JOIN], hasPassword: false, canSavePassword: false };

/** What the panel shows when there is no connection to describe yet. */
export function offlineChat(nick: string | null, settings: ChatSettingsView = NO_SETTINGS): ChatView {
    return { status: 'offline', nick, channels: [], active: SERVER_LOG, lines: [], error: null, needsNick: nick === null, settings };
}

/** What the service starts from: the saved settings, and the password `index.ts` opened for it. */
export interface ChatStart extends ChatSettings {
    /** In the clear, for the length of the run. Null for none. */
    password: string | null;
    /** Whether a password given now would be saved; the Settings tab says so when it would not. */
    canSavePassword: boolean;
}

/** One save from the Settings tab, already checked by `readSettingsDraft`. */
export interface SettingsChange {
    nick: string;
    autoJoin: string[];
    /** Absent leaves the password alone; a string replaces it; null forgets it. */
    password?: string | null;
}

export class ChatService {
    private readonly io: ChatIo;
    private readonly host: string;
    private readonly port: number;
    private readonly canSavePassword: boolean;
    private nick: string | null;
    private autoJoin: string[];
    private password: string | null;
    private client: IrcClient | null = null;
    private socket: ChatSocket | null = null;
    private pending = '';
    /** Failed attempts since the last connection that reached online, which is what the backoff counts. */
    private attempt = 0;
    private cancelRetry: (() => void) | null = null;
    /**
     * The user does not want a connection: they pressed Disconnect, this run or
     * the last, or the app is quitting. Nothing reconnects while it is set.
     */
    private stopped: boolean;
    /**
     * Which connection the handlers belong to. A socket that closes after we
     * have moved on — one we replaced, or one stop() dropped — must not be
     * able to reconnect us or write into the log.
     */
    private generation = 0;
    private readonly subscribers = new Set<(view: ChatView) => void>();

    constructor(start: ChatStart, io: ChatIo) {
        this.io = io;
        this.host = start.server;
        this.port = start.port;
        this.canSavePassword = start.canSavePassword;
        this.nick = start.nick === '' ? null : start.nick;
        this.autoJoin = [...start.autoJoin];
        this.password = start.password;
        this.stopped = !start.autoConnect;
        // A remembered nick connects straight away unless the user last
        // pressed Disconnect; without a nick nothing opens, which is what a
        // capture run — whose profile has no nick — relies on.
        this.open();
    }

    view(): ChatView {
        const settings: ChatSettingsView = {
            nick: this.nick,
            autoJoin: [...this.autoJoin],
            hasPassword: this.password !== null,
            canSavePassword: this.canSavePassword
        };
        if (this.client === null) return offlineChat(this.nick, settings);
        const snapshot = this.client.snapshot();
        return {
            ...snapshot,
            channels: snapshot.channels.map(channel => ({ ...channel, closable: isChannel(channel.name) })),
            needsNick: this.nick === null,
            settings
        };
    }

    subscribe(cb: (view: ChatView) => void): () => void {
        this.subscribers.add(cb);
        return () => {
            this.subscribers.delete(cb);
        };
    }

    /**
     * Connect, from the Settings tab. The auto-join list is joined again —
     * closing a tab lasted for the session, and this starts the next one —
     * alongside the channels still wanted from before, and the log is kept.
     */
    connect(): void {
        if (this.nick === null) return;
        this.stopped = false;
        if (this.client !== null) for (const channel of this.autoJoin) this.client.join(channel);
        if (this.socket !== null) {
            // Already up, or on its way: the joins above are all there was to do.
            this.emit();
            return;
        }
        // A retry waiting out its backoff is not worth waiting for when the user has asked.
        this.attempt = 0;
        this.open();
    }

    /** Disconnect, from the Settings tab. The tabs and their logs stay to be read. */
    disconnect(): void {
        this.hangUp();
    }

    /**
     * A save from the Settings tab. Each field changes what it can without
     * dropping the connection:
     *
     * - The nick and password are who NickServ is told we are, from now on.
     *   A new password, or a new nick with one saved, identifies at once on a
     *   live connection — before the rename, so the new nick arrives already
     *   identified.
     * - A new nick on a live connection is asked for with /nick, and the
     *   connection takes it when the server agrees. Otherwise it is simply the
     *   nick the next registration uses. It is compared with the nick the
     *   connection holds rather than the saved one: a refused registration
     *   leaves the client claiming "matt___", and saving "matt" again has to
     *   put that right even though "matt" is what is stored.
     * - A channel added to the list is joined now, or as soon as the
     *   connection on its way is up. One taken off is not parted: the list
     *   says what to join next time, and closing the tab is how to leave now.
     */
    applySettings(change: SettingsChange): void {
        const added = change.autoJoin.filter(channel => !this.autoJoin.some(saved => sameName(saved, channel)));
        this.autoJoin = [...change.autoJoin];
        if (change.password !== undefined) this.password = change.password;
        const nick = change.nick.trim();
        const client = this.client;

        if (client !== null) {
            const { status, nick: holding } = client.snapshot();
            if (nick !== '') client.setCredentials(nick, this.password);
            if (nick !== '' && nick !== holding) {
                if (status === 'online' || status === 'registering') client.input(`/nick ${nick}`);
                else client.rename(nick);
            }
            if (status !== 'offline') for (const channel of added) client.join(channel);
        }
        if (nick !== '') this.nick = nick;
        this.emit();
    }

    /** One typed line. Text beginning with / is a command; the client decides what it means. */
    send(text: string): void {
        if (this.client === null) return;
        this.client.input(text);
        this.emit();
    }

    /** Leaves a channel for the rest of the session. Status is refused, since it is not a room and the server keeps talking into it. */
    closeRoom(channel: string): boolean {
        if (this.client === null || !isChannel(channel)) return false;
        const known = this.client.snapshot().channels.some(c => sameName(c.name, channel));
        if (!known) return false;
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
        this.hangUp();
    }

    // ── the connection ───────────────────────────────────────────────────

    /**
     * Says goodbye and drops the socket, and stops anything that would bring
     * it back. The QUIT goes out before the close, while there is still a
     * socket to write it to.
     */
    private hangUp(): void {
        this.stopped = true;
        this.cancel();
        if (this.socket !== null) this.client?.quit();
        this.generation++;
        this.socket?.close();
        this.socket = null;
        this.pending = '';
        this.client?.closed('', false);
        this.emit();
    }

    private open(): void {
        this.cancel();
        if (this.nick === null || this.stopped || this.socket !== null) return;

        // The client survives a reconnect, so the log does too.
        const client =
            this.client ??
            new IrcClient({
                nick: this.nick,
                channels: [...this.autoJoin],
                password: this.password,
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

/** How long a closing socket may take to flush its goodbye before it is cut off. */
const CLOSE_GRACE_MS = 2_000;

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
            // The last guard between a line and the wire. Every caller already
            // refuses a line break, but a stored profile or a future caller that
            // did not would otherwise end this command and start another.
            if (/[\r\n\0]/.test(line)) return;
            if (!socket.destroyed) socket.write(`${line}\r\n`);
        },
        close: () => {
            // end() rather than destroy(), so a QUIT written just before is
            // flushed to the server instead of dropped with the buffer. A
            // server that never closes its half is not waited on for long.
            socket.end();
            setTimeout(() => socket.destroy(), CLOSE_GRACE_MS).unref();
        }
    };
}
