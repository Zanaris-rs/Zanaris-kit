import { connect } from 'node:tls';
import { DEFAULT_AUTO_JOIN, SERVER_LOG, type ChatLine, type ChatSettings, type ChatSettingsView, type ChatView } from '../../shared/chat.ts';
import { backoffDelay, IrcClient } from './client.ts';
import { formatCommand, parseInput, sameName } from './protocol.ts';

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
 * How long the server may say nothing before it is asked whether it is still
 * there. A socket whose network went away while the laptop slept can stay open
 * with nothing on it: no error, no close, and the panel still saying online.
 * Servers ping their own clients every few minutes, so on a working
 * connection this is rarely the first thing to speak.
 */
export const SILENCE_MS = 90_000;

/** How long a PING of ours waits for anything at all to come back before the connection is taken for dead. */
export const ANSWER_MS = 30_000;

/** What the Settings tab shows when no service exists to ask: the defaults, nothing saved. */
const NO_SETTINGS: ChatSettingsView = { nick: null, autoJoin: [...DEFAULT_AUTO_JOIN], ignore: [], notify: true, hasPassword: false, canSavePassword: false };

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
    /**
     * Told when the user asks for a connection or asks to be rid of one — Connect,
     * Disconnect, or /quit — so the next launch can do the same. Not told when
     * the app quits: a kit closed while connected should connect again.
     */
    onConnectionWanted?: (wanted: boolean) => void;
    /** Told the ignore list after /ignore or /unignore changed it, so the next launch ignores the same people. */
    onIgnoreChanged?: (ignore: string[]) => void;
    /**
     * Told each line that names you or is said to you alone, while `notify` is
     * on. Whether anyone is looking is the caller's to judge: the service
     * knows nothing of windows.
     */
    onMention?: (line: ChatLine) => void;
}

/** One save from the Settings tab, already checked by `readSettingsDraft`. */
export interface SettingsChange {
    nick: string;
    autoJoin: string[];
    /** Absent leaves the password alone; a string replaces it; null forgets it. */
    password?: string | null;
    /** Absent leaves the list alone. */
    ignore?: string[];
    /** Absent leaves the choice alone. */
    notify?: boolean;
}

export class ChatService {
    private readonly io: ChatIo;
    private readonly host: string;
    private readonly port: number;
    private readonly canSavePassword: boolean;
    private readonly onConnectionWanted: (wanted: boolean) => void;
    private readonly onIgnoreChanged: (ignore: string[]) => void;
    private readonly onMention: (line: ChatLine) => void;
    private nick: string | null;
    private autoJoin: string[];
    private ignore: string[];
    private notify: boolean;
    private password: string | null;
    private client: IrcClient | null = null;
    private socket: ChatSocket | null = null;
    private pending = '';
    /** Failed attempts since the last connection that reached online, which is what the backoff counts. */
    private attempt = 0;
    private cancelRetry: (() => void) | null = null;
    /** The silence count, or the wait for an answer to our PING: one or the other, while a socket is ours. */
    private cancelWatch: (() => void) | null = null;
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
        this.onConnectionWanted = start.onConnectionWanted ?? (() => {});
        this.onIgnoreChanged = start.onIgnoreChanged ?? (() => {});
        this.onMention = start.onMention ?? (() => {});
        this.nick = start.nick === '' ? null : start.nick;
        this.autoJoin = [...start.autoJoin];
        this.ignore = [...start.ignore];
        this.notify = start.notify;
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
            ignore: [...this.ignore],
            notify: this.notify,
            hasPassword: this.password !== null,
            canSavePassword: this.canSavePassword
        };
        if (this.client === null) return offlineChat(this.nick, settings);
        const snapshot = this.client.snapshot();
        return {
            ...snapshot,
            channels: snapshot.channels.map(channel => ({ ...channel, closable: channel.name !== SERVER_LOG })),
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
        this.onConnectionWanted(true);
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

    /** Disconnect, from the Settings tab or /quit. The tabs and their logs stay to be read. */
    disconnect(reason = ''): void {
        this.onConnectionWanted(false);
        this.hangUp(reason);
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
     *   leaves the client claiming "mage___", and saving "mage" again has to
     *   put that right even though "mage" is what is stored.
     * - A channel added to the list is joined now, or as soon as the
     *   connection on its way is up. One taken off is not parted: the list
     *   says what to join next time, and closing the tab is how to leave now.
     * - The ignore list applies to what arrives from now on; what is already
     *   in a log stays.
     */
    applySettings(change: SettingsChange): void {
        const added = change.autoJoin.filter(channel => !this.autoJoin.some(saved => sameName(saved, channel)));
        this.autoJoin = [...change.autoJoin];
        if (change.password !== undefined) this.password = change.password;
        if (change.notify !== undefined) this.notify = change.notify;
        if (change.ignore !== undefined) {
            this.ignore = [...change.ignore];
            this.client?.setIgnore(this.ignore);
        }
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

    /**
     * One typed line. Text beginning with / is a command, and the client
     * decides what it means — except /quit, which is a disconnect. Sent as a
     * plain QUIT it would drop the connection the way a network fault does, and
     * the kit would reconnect behind it.
     */
    send(text: string): void {
        if (this.client === null) return;
        const typed = parseInput(text);
        if (typed?.kind === 'quit') {
            this.disconnect(typed.reason);
            return;
        }
        this.client.input(text);
        this.emit();
    }

    /**
     * Leaves a channel for the rest of the session, or ends a private
     * conversation. Status is refused, since it is not a room and the server
     * keeps talking into it.
     */
    closeRoom(channel: string): boolean {
        if (this.client === null || channel === SERVER_LOG) return false;
        const known = this.client.snapshot().channels.some(c => sameName(c.name, channel));
        if (!known) return false;
        this.client.close(channel);
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

    /**
     * The machine woke. Timers stand still while it sleeps, so the silence
     * count would pick up where it left off; this asks the server now instead,
     * since a sleep is the likeliest way for a socket to die without closing.
     */
    wake(): void {
        if (this.socket === null || this.client?.snapshot().status === 'connecting') return;
        this.ping();
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
    private hangUp(reason = ''): void {
        this.stopped = true;
        this.cancel();
        if (this.socket !== null) this.client?.quit(reason);
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
                ignore: this.ignore,
                now: () => this.io.now(),
                send: line => this.socket?.send(line),
                onIgnoreChanged: ignore => {
                    this.ignore = [...ignore];
                    this.onIgnoreChanged([...ignore]);
                },
                onHighlight: line => {
                    if (this.notify) this.onMention(line);
                }
            });
        this.client = client;
        client.connecting();
        this.pending = '';

        const gen = ++this.generation;
        const mine = (): boolean => gen === this.generation;
        // Counted from here, so a handshake that never finishes is given up on too.
        this.watch();
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
        this.watch();
        this.client?.opened();
        this.emit();
    }

    private receive(chunk: string): void {
        // Any bytes at all, even half a line, say the socket is alive.
        this.watch();
        const { lines, rest } = splitLines(this.pending, chunk);
        this.pending = rest;
        if (this.client === null || lines.length === 0) return;
        for (const line of lines) this.client.receive(line);
        // Registration succeeded, so the next failure starts the backoff over.
        if (this.client.snapshot().status === 'online') this.attempt = 0;
        this.emit();
    }

    private closed(reason: string): void {
        this.unwatch();
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

    /** Cancels a pending retry, and the watch on a socket that is about to be replaced or dropped. */
    private cancel(): void {
        this.cancelRetry?.();
        this.cancelRetry = null;
        this.unwatch();
    }

    /** Starts the silence count over. */
    private watch(): void {
        this.unwatch();
        this.cancelWatch = this.io.setTimer(() => {
            this.cancelWatch = null;
            // Silent before the socket was even up: there is nobody to ping.
            if (this.client?.snapshot().status === 'connecting') this.dead('the server did not answer');
            else this.ping();
        }, SILENCE_MS);
    }

    /**
     * Asks the server for a sign of life. The PONG is not looked for as such:
     * whatever arrives next goes through receive(), which starts the count over.
     */
    private ping(): void {
        this.unwatch();
        this.socket?.send(formatCommand('PING', ['zanaris']));
        this.cancelWatch = this.io.setTimer(() => {
            this.cancelWatch = null;
            this.dead('the server stopped answering');
        }, ANSWER_MS);
    }

    private unwatch(): void {
        this.cancelWatch?.();
        this.cancelWatch = null;
    }

    /**
     * Lets go of a socket that has gone quiet and reconnects as if it had
     * closed. The generation moves first, so the close the dropped socket
     * reports, whenever it gets round to it, is not taken for a second one.
     */
    private dead(reason: string): void {
        this.generation++;
        this.socket?.close();
        this.closed(reason);
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
