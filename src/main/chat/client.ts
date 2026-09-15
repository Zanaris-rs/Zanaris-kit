import { SERVER_LOG, type ChatChannel, type ChatLine, type ChatStatus, type ChatTopic, type ChatUser, type ChatView } from '../../shared/chat.ts';
import {
    DEFAULT_ISUPPORT,
    foldName as key,
    formatCommand,
    isChannel,
    mentions,
    modeChanges,
    parseInput,
    parseLine,
    readIsupport,
    sameName as same,
    stripFormatting,
    type Isupport
} from './protocol.ts';

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
    /** Sent to NickServ as soon as the server welcomes us, for the account named by `nick`. Null or absent for none. */
    password?: string | null;
    now(): number;
    /** Hands one command to the transport, which adds the CRLF. */
    send(line: string): void;
}

/**
 * What IrcClient reports on its own. It has no notion of settings, so it
 * cannot say what is saved; ChatService adds that, and what is closable, and
 * needsNick, to make a ChatView.
 */
export type ClientSnapshot = Omit<ChatView, 'needsNick' | 'channels' | 'settings'> & { channels: ChatChannel[] };

interface Chan {
    name: string;
    users: ChatUser[];
    unread: number;
    highlights: number;
    /** NAMES arrives over several 353s, so it is collected here and committed on 366. */
    pending: ChatUser[] | null;
    topic: ChatTopic | null;
    /** The flags set on the channel, as mode letters. Lists and ranks are not flags, so they never land here. */
    flags: string[];
    /** Null until a 324 has said, so "no flags" and "not told yet" stay different. */
    flagsKnown: boolean;
    /** We were kicked and have not rejoined, so the tab is only there to say why. */
    kicked: boolean;
    createdAt: number | null;
    lines: ChatLine[];
}

/** Why a join was refused, in words the panel can show. */
const JOIN_REFUSED: Record<string, string> = {
    '403': 'no such channel',
    '473': 'invite only',
    '474': 'you are banned',
    '475': 'the wrong key'
};

/**
 * Numerics that are read for their data and would only be noise as text: the
 * ISUPPORT tokens, NAMES, and the channel details the pane draws from the
 * channel itself rather than from the log.
 */
const SILENT_NUMERICS = new Set(['005', '331', '332', '333', '324', '329', '353', '366']);

/**
 * NickServ commands whose words after the first are a secret. A typed
 * `/msg NickServ IDENTIFY hunter2` is echoed into Status like any message, and
 * the echo must not carry the password there.
 */
const SECRET_COMMANDS = /^(identify|id|register|ghost|recover|release|group|confirm|set\s+password)\b/i;

/** A 333, a KICK or a NAMES entry can name someone as nick!user@host; the pane shows the nick. A bare nick is already one. */
function nickOf(mask: string): string {
    const bang = mask.indexOf('!');
    return bang > 0 ? mask.slice(0, bang) : mask;
}

/** A server's seconds as the milliseconds everything else here counts in. Null for anything that is not a time. */
function seconds(value: string | undefined): number | null {
    if (value === undefined || !/^\d+$/.test(value)) return null;
    return Number(value) * 1000;
}

export class IrcClient {
    private readonly opts: ClientOpts;
    private readonly chans = new Map<string, Chan>();
    private want: string[] = [];
    private status: ChatStatus = 'offline';
    private nickName: string | null;
    /** The account NickServ is told we are: the nick chosen in Settings, whatever the connection is called right now. */
    private account: string;
    private password: string | null;
    /** A CAP REQ is waiting on its answer, and registration with it. */
    private capPending = false;
    private activeName: string;
    private error: string | null = null;
    private lastId = 0;
    private nickTries = 0;
    private support: Isupport = DEFAULT_ISUPPORT;

    constructor(opts: ClientOpts) {
        this.opts = opts;
        this.nickName = opts.nick === '' ? null : opts.nick;
        this.account = opts.nick;
        this.password = opts.password === '' ? null : (opts.password ?? null);
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

    /**
     * The socket is up: register. The server says nothing until we do.
     *
     * multi-prefix is asked for first. Without it a NAMES reply carries only
     * each person's highest rank, so an op who is also voiced shows as plain
     * the moment they lose op. A server that knows CAP holds registration
     * until CAP END, which goes out on its answer; one that does not answers
     * 421 and registers anyway.
     */
    opened(): void {
        this.status = 'registering';
        const nick = this.nickName ?? this.opts.nick;
        this.capPending = true;
        this.opts.send(formatCommand('CAP', ['REQ', 'multi-prefix']));
        this.opts.send(formatCommand('NICK', [nick]));
        this.opts.send(formatCommand('USER', [nick, '0', '*', REALNAME]));
    }

    closed(reason: string, willRetry: boolean): void {
        this.status = willRetry ? 'reconnecting' : 'offline';
        this.error = reason === '' ? null : reason;
        // Who was in a room is only true while the socket is: keeping the list
        // would show ghosts for however long the reconnect takes. The topic and
        // modes are the room's rather than the socket's, and stay to be read.
        for (const chan of this.chans.values()) {
            chan.users = [];
            chan.pending = null;
        }
        // A reconnect may land on a server that says something different, so it starts from what a server says by saying nothing.
        this.support = DEFAULT_ISUPPORT;
        this.capPending = false;
    }

    /** Says goodbye, for a disconnect the user asked for. Only a registered connection has anyone to say it to. */
    quit(): void {
        if (this.status !== 'online' && this.status !== 'registering') return;
        this.opts.send(formatCommand('QUIT', [REALNAME]));
    }

    /**
     * Takes a new nick while nothing is registered, so the next registration
     * uses it. A live connection renames with /nick instead, which the server
     * has to confirm.
     */
    rename(nick: string): void {
        if (this.status === 'online' || this.status === 'registering' || nick === '') return;
        this.nickName = nick;
    }

    /**
     * Who NickServ should be told we are: the nick chosen in Settings, and its
     * password. A change is used at once on a live connection, and on the next
     * welcome either way. Nothing is re-sent when neither changed.
     */
    setCredentials(account: string, password: string | null): void {
        const next = password === '' ? null : password;
        if (account === this.account && next === this.password) return;
        this.account = account;
        this.password = next;
        if (this.status === 'online') this.identify();
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
                this.welcomed(p[0], p[1]);
                return;
            case 'CAP':
            case '410':
                // An answer to our REQ, ACK or NAK alike, or a server that did not understand it.
                if (msg.command === '410' || p[1] === 'ACK' || p[1] === 'NAK') this.capDone();
                return;
            case '005':
                // The first param is our nick and the last is the "are supported" text.
                this.support = readIsupport(this.support, p.slice(1, -1));
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
            case 'KICK':
                this.kicked(msg.nick ?? msg.prefix, p[0] ?? '', p[1] ?? '', p[2] ?? '');
                return;
            case 'QUIT':
                this.userQuit(msg.nick, p[0] ?? '');
                return;
            case 'NICK':
                this.renamed(msg.nick, p[0] ?? '');
                return;
            case 'MODE':
                this.moded(msg.nick ?? msg.prefix, p[0] ?? '', p[1] ?? '', p.slice(2));
                return;
            case 'TOPIC':
                this.topicChanged(msg.nick ?? msg.prefix, p[0] ?? '', p[1] ?? '');
                return;
            case 'INVITE':
                this.incoming(SERVER_LOG, 'system', null, `${msg.nick ?? 'someone'} invites you to ${p[1] ?? 'a channel'}`);
                return;
            case 'ERROR':
                this.push(SERVER_LOG, 'system', null, stripFormatting(p[0] ?? 'the server closed the connection'));
                return;
            case '331':
                this.withChan(p[1], chan => (chan.topic = null));
                return;
            case '332':
                this.withChan(p[1], chan => (chan.topic = { text: stripFormatting(p[2] ?? ''), setBy: chan.topic?.setBy ?? null, setAt: chan.topic?.setAt ?? null }));
                return;
            case '333':
                this.withChan(p[1], chan => {
                    if (chan.topic === null) return;
                    chan.topic = { ...chan.topic, setBy: p[2] === undefined ? null : nickOf(p[2]), setAt: seconds(p[3]) };
                });
                return;
            case '324':
                this.withChan(p[1], chan => {
                    chan.flags = [];
                    chan.flagsKnown = true;
                    this.applyFlags(chan, p[2] ?? '', p.slice(3));
                });
                return;
            case '329':
                this.withChan(p[1], chan => (chan.createdAt = seconds(p[2])));
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
            case '221':
                this.push(SERVER_LOG, 'system', null, `your modes are ${p[1] ?? '+'}`);
                return;
            default:
                // Status is where the server talks to you, so every other
                // numeric is shown there — the welcome, the MOTD, the user
                // counts, a refusal this client has no words of its own for.
                // A command that is not a number is not addressed to anyone
                // reading, and is left out.
                if (/^\d{3}$/.test(msg.command) && !SILENT_NUMERICS.has(msg.command)) this.serverSaid(p);
                return;
        }
    }

    private capDone(): void {
        if (!this.capPending) return;
        this.capPending = false;
        this.opts.send(formatCommand('CAP', ['END']));
    }

    /** A numeric's text: everything after our own nick, which is its first param. */
    private serverSaid(params: string[]): void {
        const text = stripFormatting(params.slice(1).join(' ')).trim();
        if (text !== '') this.push(SERVER_LOG, 'system', null, text);
    }

    private welcomed(nick: string | undefined, text: string | undefined): void {
        this.status = 'online';
        this.error = null;
        this.nickTries = 0;
        this.capPending = false;
        if (nick !== undefined && nick !== '') this.nickName = nick; // the server may have trimmed it
        if (text !== undefined && text !== '') this.push(SERVER_LOG, 'system', null, stripFormatting(text));
        // Sent before the joins, but services answer on their own time: the IRCd
        // usually handles the JOINs first, so a registered-only room can still
        // refuse with a 477, which lands in Status. Waiting for the confirmation
        // is not done here.
        this.identify();
        for (const channel of this.want) this.opts.send(formatCommand('JOIN', [channel]));
    }

    /**
     * Identifies to NickServ. Sent straight to the wire and never through
     * push(): a password is not a line of conversation, and nothing that
     * draws the log, or persists it, ever sees it.
     *
     * Always the two-word form, naming the account. The bare form identifies
     * whatever nick the connection holds, which after a taken nick is "matt_"
     * rather than the account; and services read "IDENTIFY correct horse" as
     * account "correct", password "horse". Named, the password is the rest of
     * the line, spaces and all.
     */
    private identify(): void {
        if (this.password === null || this.account === '') return;
        this.opts.send(formatCommand('PRIVMSG', ['NickServ', `IDENTIFY ${this.account} ${this.password}`]));
    }

    private nickTaken(taken: string | undefined): void {
        const attempted = taken !== undefined && taken !== '' ? taken : (this.nickName ?? this.opts.nick);
        if (this.status === 'online') {
            // A live rename was refused: the nick we already have is still
            // registered and working, so there is nothing to recover from and
            // nothing to retry. The underscore cascade below is only for
            // finding a way in during registration, when there is no working
            // nick yet — running it here would trade a nick that works for
            // one nobody asked for and the server has also refused.
            this.incoming(SERVER_LOG, 'system', null, `the nick ${attempted} is taken`);
            return;
        }
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
        this.incoming(isChannel(target) ? target : SERVER_LOG, kind, from, stripFormatting(text), !isChannel(target));
    }

    private noticed(from: string | null, target: string, body: string): void {
        const known = isChannel(target) && this.chans.has(key(target));
        const text = stripFormatting(body);
        this.incoming(known ? target : SERVER_LOG, 'system', null, from === null ? text : `-${from}- ${text}`);
    }

    private joined(who: string | null, channel: string): void {
        if (who === null || !isChannel(channel)) return;
        if (this.isMe(who)) {
            this.chan(channel).kicked = false;
            // The server volunteers the topic and the names on a join, but not
            // the channel's modes or its age; this asks for both (324 and 329).
            this.opts.send(formatCommand('MODE', [channel]));
            return;
        }
        const chan = this.chans.get(key(channel));
        if (chan === undefined) return;
        chan.users = this.sorted([...chan.users.filter(u => !same(u.nick, who)), { nick: who, prefixes: '' }]);
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
        chan.users = chan.users.filter(u => !same(u.nick, who));
        this.push(chan.name, 'system', null, `${who} left${because(reason)}`);
    }

    /**
     * Someone removed from a room. When it is us, the tab stays with the
     * reason in it — a tab that vanished would say nothing about why — but the
     * room is no longer wanted, so a reconnect does not walk straight back in.
     */
    private kicked(by: string | null, channel: string, victim: string, reason: string): void {
        const chan = this.chans.get(key(channel));
        if (chan === undefined || victim === '') return;
        const kicker = by === null ? 'the server' : nickOf(by);
        if (this.isMe(victim)) {
            this.want = this.want.filter(c => !same(c, channel));
            chan.kicked = true;
            chan.users = [];
            this.incoming(chan.name, 'system', null, `you were kicked by ${kicker}${because(reason)}`, true);
            return;
        }
        chan.users = chan.users.filter(u => !same(u.nick, victim));
        this.push(chan.name, 'system', null, `${victim} was kicked by ${kicker}${because(reason)}`);
    }

    private userQuit(who: string | null, reason: string): void {
        if (who === null) return;
        for (const chan of this.chans.values()) {
            if (!chan.users.some(u => same(u.nick, who))) continue;
            chan.users = chan.users.filter(u => !same(u.nick, who));
            this.push(chan.name, 'system', null, `${who} quit${because(reason)}`);
        }
    }

    private renamed(from: string | null, to: string): void {
        if (from === null || to === '') return;
        if (this.isMe(from)) this.nickName = to;
        for (const chan of this.chans.values()) {
            const user = chan.users.find(u => same(u.nick, from));
            if (user === undefined) continue;
            chan.users = this.sorted([...chan.users.filter(u => u !== user), { nick: to, prefixes: user.prefixes }]);
            this.push(chan.name, 'system', null, `${from} is now known as ${to}`);
        }
    }

    /**
     * A mode change. On a channel it can move someone's rank and change the
     * channel's flags, and it is said in the room. On a nick it is our own
     * modes, which belong in Status.
     */
    private moded(by: string | null, target: string, modes: string, params: string[]): void {
        if (modes === '') return;
        const setter = by === null ? 'the server' : nickOf(by);
        const said = [modes, ...params].join(' ');
        if (!isChannel(target)) {
            this.push(SERVER_LOG, 'system', null, `${setter} sets mode ${said} on ${target}`);
            return;
        }
        const chan = this.chans.get(key(target));
        if (chan === undefined) return;
        this.applyFlags(chan, modes, params);
        this.push(chan.name, 'system', null, `${setter} sets mode ${said}`);
    }

    /** Applies a mode string to a channel: ranks to the people named, flags to the channel. List modes (bans and the like) are neither. */
    private applyFlags(chan: Chan, modes: string, params: string[]): void {
        const [lists] = this.support.chanModes;
        let ranksMoved = false;
        for (const change of modeChanges(modes, params, this.support)) {
            const rank = this.support.prefixModes.indexOf(change.mode);
            if (rank !== -1) {
                if (change.param === null) continue;
                const symbol = this.support.prefixSymbols[rank]!;
                chan.users = chan.users.map(user => {
                    if (!same(user.nick, change.param!)) return user;
                    const without = user.prefixes.replace(symbol, '');
                    return { nick: user.nick, prefixes: change.adding ? this.ordered(without + symbol) : without };
                });
                ranksMoved = true;
                continue;
            }
            if (lists.includes(change.mode)) continue;
            chan.flags = chan.flags.filter(flag => flag !== change.mode);
            if (change.adding) chan.flags.push(change.mode);
        }
        if (ranksMoved) chan.users = this.sorted(chan.users);
    }

    private topicChanged(by: string | null, channel: string, text: string): void {
        const chan = this.chans.get(key(channel));
        if (chan === undefined) return;
        const setter = by === null ? 'the server' : nickOf(by);
        const topic = stripFormatting(text);
        if (topic === '') {
            chan.topic = null;
            this.push(chan.name, 'system', null, `${setter} cleared the topic`);
            return;
        }
        chan.topic = { text: topic, setBy: setter, setAt: this.opts.now() };
        this.push(chan.name, 'system', null, `${setter} changed the topic to: ${topic}`);
    }

    /** 353: the channel is the param before the names, whether or not the server sent the "=" one. */
    private names(params: string[]): void {
        if (params.length < 2) return;
        const channel = params[params.length - 2]!;
        const names = params[params.length - 1]!;
        if (!isChannel(channel)) return;
        const chan = this.chan(channel);
        const users = names
            .split(' ')
            .filter(n => n !== '')
            .map(entry => this.user(entry))
            .filter(user => user.nick !== '');
        chan.pending = [...(chan.pending ?? []), ...users];
    }

    private namesDone(params: string[]): void {
        if (params.length < 2) return;
        const chan = this.chans.get(key(params[params.length - 2]!));
        if (chan === undefined || chan.pending === null) return;
        // One entry per person, the last report winning, as a repeated 353 means the server changed its mind.
        const byNick = new Map<string, ChatUser>();
        for (const user of chan.pending) byNick.set(key(user.nick), user);
        chan.users = this.sorted([...byNick.values()]);
        chan.pending = null;
    }

    /**
     * One NAMES entry: every rank symbol in front (a server with multi-prefix
     * sends "@+matt" for an op who is voiced) and the nick after, with any
     * user@host a userhost-in-names server tacks on taken off.
     */
    private user(entry: string): ChatUser {
        let at = 0;
        while (at < entry.length && this.support.prefixSymbols.includes(entry[at]!)) at++;
        return { nick: nickOf(entry.slice(at)), prefixes: this.ordered(entry.slice(0, at)) };
    }

    /** Rank symbols, highest first and each once, whatever order they were given in. */
    private ordered(symbols: string): string {
        return [...new Set(symbols)].sort((a, b) => this.support.prefixSymbols.indexOf(a) - this.support.prefixSymbols.indexOf(b)).join('');
    }

    /** Highest rank first, then by folded name, with the raw name breaking ties so the order never wobbles. */
    private sorted(users: ChatUser[]): ChatUser[] {
        const rank = (user: ChatUser): number => {
            const top = user.prefixes[0];
            return top === undefined ? this.support.prefixSymbols.length : this.support.prefixSymbols.indexOf(top);
        };
        return [...users].sort((a, b) => rank(a) - rank(b) || compare(key(a.nick), key(b.nick)) || compare(a.nick, b.nick));
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
            case 'msg': {
                if (!this.online(SERVER_LOG)) return;
                this.opts.send(formatCommand('PRIVMSG', [typed.target, typed.text]));
                const secret = same(typed.target, 'NickServ') ? SECRET_COMMANDS.exec(typed.text) : null;
                this.push(SERVER_LOG, 'private', this.nickName, secret === null ? typed.text : `${secret[0]} (hidden)`);
                return;
            }
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
        // A tab kept to say we were kicked is not a room we are in, and a PART for
        // it earns only a 442. Anything else is left on the wire, including a room
        // the server put us in that we never asked for.
        const kicked = this.chans.get(key(channel))?.kicked ?? false;
        this.want = this.want.filter(c => !same(c, channel));
        if (!kicked && this.status === 'online') this.opts.send(formatCommand('PART', [channel]));
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

    snapshot(): ClientSnapshot {
        const active = this.chans.get(key(this.activeName));
        const channels: ChatChannel[] = [...this.chans.values()].map(c => ({
            name: c.name,
            users: c.users.map(u => ({ ...u })),
            unread: c.unread,
            highlights: c.highlights,
            topic: c.topic === null ? null : { ...c.topic },
            modes: c.flagsKnown ? `+${c.flags.join('')}` : null,
            createdAt: c.createdAt
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
        const chan: Chan = { name, users: [], unread: 0, highlights: 0, pending: null, topic: null, flags: [], flagsKnown: false, kicked: false, createdAt: null, lines: [] };
        this.chans.set(key(name), chan);
        return chan;
    }

    /** Runs fn on a channel the client already has, for a numeric naming one. A reply about a room we left changes nothing. */
    private withChan(name: string | undefined, fn: (chan: Chan) => void): void {
        if (name === undefined || !isChannel(name)) return;
        const chan = this.chans.get(key(name));
        if (chan !== undefined) fn(chan);
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

/** A part, quit or kick reason, in brackets after the fact, or nothing when none was given. */
function because(reason: string): string {
    const text = stripFormatting(reason).trim();
    return text === '' ? '' : ` (${text})`;
}

function compare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}
