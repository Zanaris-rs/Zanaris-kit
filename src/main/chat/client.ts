import { SERVER_LOG, type ChatChannel, type ChatLine, type ChatStatus, type ChatView } from '../../shared/chat.ts';
import { formatCommand, isChannel, mentions, parseInput, parseLine } from './protocol.ts';

/**
 * One IRC conversation, as pure state over injected IO: it is handed lines and
 * hands back lines to send, so the socket, the reconnect timer and the window
 * all live outside. Nothing here waits, throws at the caller, or knows Electron.
 */

/** The panel scrolls back, it does not archive. A week-long session must not grow without bound. */
const MAX_LINES = 500;

/** Underscores to add before giving up on a taken nick; without a stop it is an infinite NICK loop. */
const MAX_NICK_TRIES = 3;

const BACKOFF_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;

/** The CTCP delimiter that wraps /me and the queries we ignore. */
const CTCP = '\u0001';

const REALNAME = 'Zanaris Kit';

/**
 * How long to wait before reconnect attempt `attempt` (1 is the first). Doubles
 * and then flattens: a client that tries harder the longer a network is down is
 * a client the server bans.
 */
export function backoffDelay(attempt: number): number {
    const n = Math.max(1, Math.floor(attempt));
    return Math.min(BACKOFF_CAP_MS, BACKOFF_MS * 2 ** (n - 1));
}

export interface ClientOpts {
    nick: string;
    /** Channels to be in, prefix included; anything else is ignored. */
    channels: string[];
    now(): number;
    /** Hands one command to the transport, which adds the CRLF. */
    send(line: string): void;
}

interface Chan {
    name: string;
    nicks: string[];
    unread: number;
    highlights: number;
    /** NAMES arrives over several 353s, so it is collected here and committed on 366. */
    pending: string[] | null;
    lines: ChatLine[];
}

/** Channel names and nicks are case-insensitive on IRC, so everything is keyed folded. */
const key = (name: string): string => name.toLowerCase();
const same = (a: string, b: string): boolean => key(a) === key(b);

/** Sorted and deduplicated, folded, with the raw name breaking ties so the order never wobbles. */
function sortNicks(names: string[]): string[] {
    const byKey = new Map<string, string>();
    for (const name of names) if (name !== '') byKey.set(key(name), name);
    return [...byKey.values()].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a < b ? -1 : a > b ? 1 : 0));
}

/** Strips the op, voice and half-op marks a NAMES reply hangs off a nick. */
const bareNick = (name: string): string => name.replace(/^[~&@%+]+/, '');

/** Why a join was refused, in words the panel can show. */
const JOIN_REFUSED: Record<string, string> = {
    '403': 'no such channel',
    '473': 'invite only',
    '474': 'you are banned',
    '475': 'the wrong key'
};

export class IrcClient {
    private readonly opts: ClientOpts;
    private readonly chans = new Map<string, Chan>();
    private want: string[] = [];
    private status: ChatStatus = 'offline';
    private nickName: string | null;
    private activeName: string;
    private error: string | null = null;
    private lastId = 0;
    private nickTries = 0;

    constructor(opts: ClientOpts) {
        this.opts = opts;
        this.nickName = opts.nick === '' ? null : opts.nick;
        this.activeName = SERVER_LOG;
        this.chan(SERVER_LOG); // first in the map, so first in the rail
        for (const channel of opts.channels) this.join(channel);
        this.activeName = this.want[0] ?? SERVER_LOG;
    }

    // ── the connection, driven from outside ───────────────────────────────

    connecting(): void {
        this.status = 'connecting';
        this.error = null;
        this.nickTries = 0;
    }

    /** The socket is up: register. The server says nothing until we do. */
    opened(): void {
        this.status = 'registering';
        const nick = this.nickName ?? this.opts.nick;
        this.opts.send(formatCommand('NICK', [nick]));
        this.opts.send(formatCommand('USER', [nick, '0', '*', REALNAME]));
    }

    closed(reason: string, willRetry: boolean): void {
        this.status = willRetry ? 'reconnecting' : 'offline';
        this.error = reason === '' ? null : reason;
        // Who was in a room is only true while the socket is: keeping the list
        // would show ghosts for however long the reconnect takes.
        for (const chan of this.chans.values()) {
            chan.nicks = [];
            chan.pending = null;
        }
    }

    // ── what the server says ─────────────────────────────────────────────

    receive(line: string): void {
        const msg = parseLine(line);
        if (msg === null) return;
        const p = msg.params;

        switch (msg.command) {
            case 'PING':
                // Answer with the token or the server drops us inside a minute.
                this.opts.send(formatCommand('PONG', [p[0] ?? '']));
                return;
            case '001':
                this.welcomed(p[0]);
                return;
            case '433':
                this.nickTaken(p[1]);
                return;
            case 'PRIVMSG':
                this.said(msg.nick, p[0] ?? '', p[1] ?? '');
                return;
            case 'NOTICE':
                this.noticed(msg.nick, p[0] ?? '', p[1] ?? '');
                return;
            case 'JOIN':
                this.joined(msg.nick, p[0] ?? '');
                return;
            case 'PART':
                this.parted(msg.nick, p[0] ?? '', p[1] ?? '');
                return;
            case 'QUIT':
                this.quit(msg.nick, p[0] ?? '');
                return;
            case 'NICK':
                this.renamed(msg.nick, p[0] ?? '');
                return;
            case '353':
                this.names(p);
                return;
            case '366':
                this.namesDone(p);
                return;
            case '403':
            case '473':
            case '474':
            case '475':
                this.refused(msg.command, p[1] ?? '');
                return;
            default:
                // Everything else — MOTD, modes, capabilities, whois — is not
                // conversation, and logging it would bury what is.
                return;
        }
    }

    private welcomed(nick: string | undefined): void {
        this.status = 'online';
        this.error = null;
        this.nickTries = 0;
        if (nick !== undefined && nick !== '') this.nickName = nick; // the server may have trimmed it
        for (const channel of this.want) this.opts.send(formatCommand('JOIN', [channel]));
    }

    private nickTaken(taken: string | undefined): void {
        const attempted = taken !== undefined && taken !== '' ? taken : (this.nickName ?? this.opts.nick);
        if (this.nickTries >= MAX_NICK_TRIES) {
            if (this.nickTries === MAX_NICK_TRIES) {
                this.nickTries++; // say it once, then stay quiet
                this.error = `the nick ${attempted} is taken`;
                this.incoming(SERVER_LOG, 'system', null, `the nick ${attempted} is taken — pick another one`);
            }
            return;
        }
        this.nickTries++;
        const next = `${attempted}_`;
        this.nickName = next;
        this.opts.send(formatCommand('NICK', [next]));
    }

    private said(from: string | null, target: string, body: string): void {
        let text = body;
        let kind: ChatLine['kind'] = isChannel(target) ? 'say' : 'private';
        if (text.startsWith(CTCP)) {
            const inner = text.slice(CTCP.length).replace(/\u0001$/, '');
            // ACTION is the only CTCP that is speech; VERSION, PING and the
            // rest are client chatter the user never wanted to see.
            if (!/^ACTION\b/i.test(inner)) return;
            text = inner.slice('ACTION'.length).trim();
            kind = 'action';
        }
        // A message to us with no channel is a highlight by definition.
        this.incoming(isChannel(target) ? target : SERVER_LOG, kind, from, text, !isChannel(target));
    }

    private noticed(from: string | null, target: string, text: string): void {
        const known = isChannel(target) && this.chans.has(key(target));
        this.incoming(known ? target : SERVER_LOG, 'system', null, from === null ? text : `-${from}- ${text}`);
    }

    private joined(who: string | null, channel: string): void {
        if (who === null || !isChannel(channel)) return;
        if (this.isMe(who)) {
            this.chan(channel);
            return;
        }
        const chan = this.chans.get(key(channel));
        if (chan === undefined) return;
        chan.nicks = sortNicks([...chan.nicks, who]);
        this.push(chan.name, 'system', null, `${who} joined`);
    }

    private parted(who: string | null, channel: string, reason: string): void {
        if (who === null || !isChannel(channel)) return;
        if (this.isMe(who)) {
            this.forget(channel);
            return;
        }
        const chan = this.chans.get(key(channel));
        if (chan === undefined) return;
        chan.nicks = chan.nicks.filter(n => !same(n, who));
        this.push(chan.name, 'system', null, `${who} left${reason === '' ? '' : ` (${reason})`}`);
    }

    private quit(who: string | null, reason: string): void {
        if (who === null) return;
        for (const chan of this.chans.values()) {
            if (!chan.nicks.some(n => same(n, who))) continue;
            chan.nicks = chan.nicks.filter(n => !same(n, who));
            this.push(chan.name, 'system', null, `${who} quit${reason === '' ? '' : ` (${reason})`}`);
        }
    }

    private renamed(from: string | null, to: string): void {
        if (from === null || to === '') return;
        if (this.isMe(from)) this.nickName = to;
        for (const chan of this.chans.values()) {
            if (!chan.nicks.some(n => same(n, from))) continue;
            chan.nicks = sortNicks([...chan.nicks.filter(n => !same(n, from)), to]);
            this.push(chan.name, 'system', null, `${from} is now known as ${to}`);
        }
    }

    /** 353: the channel is the param before the names, whether or not the server sent the "=" one. */
    private names(params: string[]): void {
        if (params.length < 2) return;
        const channel = params[params.length - 2]!;
        const names = params[params.length - 1]!;
        if (!isChannel(channel)) return;
        const chan = this.chan(channel);
        chan.pending = [...(chan.pending ?? []), ...names.split(' ').filter(n => n !== '').map(bareNick)];
    }

    private namesDone(params: string[]): void {
        if (params.length < 2) return;
        const chan = this.chans.get(key(params[params.length - 2]!));
        if (chan === undefined || chan.pending === null) return;
        chan.nicks = sortNicks(chan.pending);
        chan.pending = null;
    }

    private refused(numeric: string, channel: string): void {
        this.incoming(SERVER_LOG, 'system', null, `cannot join ${channel}: ${JOIN_REFUSED[numeric] ?? 'refused'}`);
    }

    // ── what the user does ───────────────────────────────────────────────

    input(text: string): void {
        const typed = parseInput(text);
        if (typed === null) return;
        switch (typed.kind) {
            case 'say':
            case 'action':
                this.speak(typed.kind, typed.text);
                return;
            case 'msg':
                if (!this.online(SERVER_LOG)) return;
                this.opts.send(formatCommand('PRIVMSG', [typed.target, typed.text]));
                this.push(SERVER_LOG, 'private', this.nickName, typed.text);
                return;
            case 'nick':
                // Allowed while registering too, which is how a taken nick is fixed.
                if (this.status !== 'online' && this.status !== 'registering') {
                    this.push(this.activeName, 'system', null, 'not connected');
                    return;
                }
                this.opts.send(formatCommand('NICK', [typed.nick]));
                return; // the nick is ours only once the server echoes it back
            case 'join':
                this.join(typed.channel);
                return;
            case 'part': {
                const channel = typed.channel === '' ? this.activeName : typed.channel;
                if (!isChannel(channel)) {
                    this.push(this.activeName, 'system', null, 'no channel to leave');
                    return;
                }
                this.part(channel);
                return;
            }
            case 'unknown':
                this.push(this.activeName, 'system', null, `unknown command: /${typed.command}`);
                return;
        }
    }

    private speak(kind: 'say' | 'action', text: string): void {
        const target = this.activeName;
        if (!isChannel(target)) {
            this.push(target, 'system', null, 'join a channel first');
            return;
        }
        if (!this.online(target)) return;
        this.opts.send(formatCommand('PRIVMSG', [target, kind === 'action' ? `${CTCP}ACTION ${text}${CTCP}` : text]));
        // IRC never sends our own PRIVMSG back, so the echo is ours to make.
        this.push(target, kind, this.nickName, text);
    }

    private online(complainIn: string): boolean {
        if (this.status === 'online') return true;
        this.push(complainIn, 'system', null, 'not connected');
        return false;
    }

    join(channel: string): void {
        if (!isChannel(channel)) return;
        if (!this.want.some(c => same(c, channel))) this.want.push(channel);
        this.chan(channel); // the tab exists before the server confirms, so the rail is stable
        if (this.status === 'online') this.opts.send(formatCommand('JOIN', [channel]));
    }

    part(channel: string): void {
        if (!isChannel(channel)) return;
        this.want = this.want.filter(c => !same(c, channel));
        if (this.status === 'online') this.opts.send(formatCommand('PART', [channel]));
        this.forget(channel);
    }

    select(channel: string): void {
        const chan = this.chan(channel);
        this.activeName = chan.name;
        chan.unread = 0;
        chan.highlights = 0;
    }

    /** The channels we mean to be in, which is what to join on the next 001. */
    wanted(): string[] {
        return [...this.want];
    }

    snapshot(): Omit<ChatView, 'needsNick'> {
        const active = this.chans.get(key(this.activeName));
        const channels: ChatChannel[] = [...this.chans.values()].map(c => ({
            name: c.name,
            nicks: [...c.nicks],
            unread: c.unread,
            highlights: c.highlights
        }));
        return {
            status: this.status,
            nick: this.nickName,
            channels,
            active: this.activeName,
            lines: (active?.lines ?? []).map(l => ({ ...l })),
            error: this.error
        };
    }

    // ── the log ──────────────────────────────────────────────────────────

    private chan(name: string): Chan {
        const existing = this.chans.get(key(name));
        if (existing !== undefined) return existing;
        const chan: Chan = { name, nicks: [], unread: 0, highlights: 0, pending: null, lines: [] };
        this.chans.set(key(name), chan);
        return chan;
    }

    private forget(channel: string): void {
        this.chans.delete(key(channel));
        if (same(this.activeName, channel)) this.activeName = SERVER_LOG;
    }

    private isMe(nick: string): boolean {
        return this.nickName !== null && same(nick, this.nickName);
    }

    private push(channel: string, kind: ChatLine['kind'], nick: string | null, text: string, highlight = false): Chan {
        const chan = this.chan(channel);
        chan.lines.push({ id: ++this.lastId, channel: chan.name, kind, nick, text, at: this.opts.now(), highlight });
        if (chan.lines.length > MAX_LINES) chan.lines.splice(0, chan.lines.length - MAX_LINES);
        return chan;
    }

    /**
     * A line from the server, which is the only kind that badges the rail.
     * Membership churn goes through push() instead: a badge should promise
     * something worth reading, not that someone reconnected.
     */
    private incoming(channel: string, kind: ChatLine['kind'], nick: string | null, text: string, always = false): void {
        const highlight = always || (this.nickName !== null && mentions(text, this.nickName));
        const chan = this.push(channel, kind, nick, text, highlight);
        if (!same(chan.name, this.activeName)) chan.unread++;
        if (highlight) chan.highlights++;
    }
}
