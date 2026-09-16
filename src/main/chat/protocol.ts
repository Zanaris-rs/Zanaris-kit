/**
 * The IRC wire format, and the line the user types. Pure string work: no
 * socket, no state, so every rule here is tested against real server lines.
 */

import { asChannel } from '../../shared/ircNames.ts';

export interface IrcMessage {
    /** The raw prefix, without its leading colon. Null when the server sent none. */
    prefix: string | null;
    /** Who spoke, when the prefix names a user rather than a server. */
    nick: string | null;
    command: string;
    params: string[];
}

/** Letters, or a three digit numeric reply. Anything else is a line we cannot trust. */
const COMMAND = /^([A-Za-z]+|[0-9]{3})$/;

/**
 * Parses one line, already stripped of its CRLF. Malformed input returns null:
 * a truncated line from a flaky connection must not take the client down.
 */
export function parseLine(line: string): IrcMessage | null {
    let rest = line.replace(/[\r\n]+$/, '').trim();
    if (rest === '') return null;

    let prefix: string | null = null;
    if (rest.startsWith(':')) {
        const end = rest.indexOf(' ');
        if (end === -1) return null; // a prefix and nothing else
        prefix = rest.slice(1, end);
        rest = rest.slice(end + 1).trimStart();
    }

    // The trailing param is everything after " :", spaces and colons included.
    let trailing: string | null = null;
    const marker = rest.indexOf(' :');
    if (rest.startsWith(':')) {
        trailing = rest.slice(1);
        rest = '';
    } else if (marker !== -1) {
        trailing = rest.slice(marker + 2);
        rest = rest.slice(0, marker);
    }

    const words = rest.split(' ').filter(w => w !== '');
    const command = words.shift();
    if (command === undefined || !COMMAND.test(command)) return null;

    const params = words;
    if (trailing !== null) params.push(trailing);
    return { prefix, nick: prefixNick(prefix), command: command.toUpperCase(), params };
}

/**
 * A user prefix is nick!user@host; a server prefix is a hostname. A bare word
 * with neither a bang nor a dot is a nick, which is what some servers send on
 * NICK and QUIT.
 */
function prefixNick(prefix: string | null): string | null {
    if (prefix === null) return null;
    const bang = prefix.indexOf('!');
    if (bang > 0) return prefix.slice(0, bang);
    if (bang === 0) return null;
    return prefix.includes('.') ? null : prefix || null;
}

/**
 * Formats one command, without the CRLF the transport adds. The last param is
 * marked trailing when it is empty, holds a space, or opens with a colon —
 * miss that and every message with a space in it arrives truncated.
 */
export function formatCommand(command: string, params: string[]): string {
    const parts = [command.toUpperCase()];
    params.forEach((param, i) => {
        const last = i === params.length - 1;
        parts.push(last && (param === '' || param.includes(' ') || param.startsWith(':')) ? `:${param}` : param);
    });
    return parts.join(' ');
}

/** Re-exported so the chat code keeps one import for everything about IRC; the Settings form reads the same rules from shared. */
export { asChannel, foldName, isChannel, sameName } from '../../shared/ircNames.ts';

/** The characters that can sit inside a nick, so "matt" does not match "mattress". */
const NICK_CHAR = /[A-Za-z0-9\[\]\\`^{}|_-]/;

/** Case-insensitive whole-word test: "matt: hi" and "hey Matt" name matt, "mattress" does not. */
export function mentions(text: string, nick: string): boolean {
    if (nick === '') return false;
    const haystack = text.toLowerCase();
    const needle = nick.toLowerCase();
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
        const before = at === 0 ? '' : haystack[at - 1]!;
        const after = haystack[at + needle.length] ?? '';
        if (!NICK_CHAR.test(before) && !NICK_CHAR.test(after)) return true;
    }
    return false;
}

// ── what the server supports ──────────────────────────────────────────────

/**
 * The parts of a server's 005 (ISUPPORT) that change how lines are read: which
 * rank symbols a NAMES reply can hang off a nick, the mode letter behind each,
 * and which channel modes take a parameter. The defaults are what RFC-era
 * servers mean when they say nothing, so a server that never sends 005 still
 * reads right.
 */
export interface Isupport {
    /** Mode letters for the ranks, highest first: "qaohv". */
    prefixModes: string;
    /** The symbol for each of those, in the same order: "~&@%+". */
    prefixSymbols: string;
    /** CHANMODES: A lists (always a parameter), B (always), C (only when set), D (never). */
    chanModes: [string, string, string, string];
}

export const DEFAULT_ISUPPORT: Isupport = { prefixModes: 'qaohv', prefixSymbols: '~&@%+', chanModes: ['beI', 'k', 'l', 'imnpst'] };

/**
 * Folds one 005 line's tokens into what was known. A 005 arrives in several
 * lines, each naming only some tokens, so anything a line does not mention is
 * kept. A malformed PREFIX — letters and symbols of different lengths — is
 * ignored rather than half-applied, since a wrong pairing would mislabel ops.
 */
export function readIsupport(known: Isupport, tokens: string[]): Isupport {
    const next: Isupport = { ...known, chanModes: [...known.chanModes] };
    for (const token of tokens) {
        const eq = token.indexOf('=');
        if (eq === -1) continue;
        const name = token.slice(0, eq).toUpperCase();
        const value = token.slice(eq + 1);
        if (name === 'PREFIX') {
            const match = /^\(([A-Za-z]*)\)(\S*)$/.exec(value);
            if (match && match[1]!.length === match[2]!.length) {
                next.prefixModes = match[1]!;
                next.prefixSymbols = match[2]!;
            }
        } else if (name === 'CHANMODES') {
            const [a = '', b = '', c = '', d = ''] = value.split(',');
            next.chanModes = [a, b, c, d];
        }
    }
    return next;
}

export interface ModeChange {
    adding: boolean;
    mode: string;
    /** The nick, key or limit the mode came with; null for a flag. */
    param: string | null;
}

/**
 * Splits "+o-v+l" and its parameters into one change per letter. Which letters
 * consume a parameter is the server's to say, which is why this takes its
 * ISUPPORT: read wrongly, every parameter after the first mistake lands on the
 * wrong letter and the wrong person is shown as an op. A letter the server
 * never described takes none. A parameter the line ran out of is null.
 */
export function modeChanges(modes: string, params: string[], support: Isupport): ModeChange[] {
    const changes: ModeChange[] = [];
    const [lists, always, whenSet] = support.chanModes;
    let adding = true;
    let next = 0;
    for (const mode of modes) {
        if (mode === '+' || mode === '-') {
            adding = mode === '+';
            continue;
        }
        const takes = support.prefixModes.includes(mode) || lists.includes(mode) || always.includes(mode) || (adding && whenSet.includes(mode));
        const param = takes ? (params[next++] ?? null) : null;
        changes.push({ adding, mode, param });
    }
    return changes;
}

/**
 * mIRC's formatting codes — bold, colour, reverse, italic, underline, reset —
 * are how a topic like "Migrating channels, please join #LostCity" arrives
 * wrapped in colour. The pane draws text as text, so they are taken out rather
 * than shown as boxes. Colour takes its numbers with it; a comma with no
 * background after it is left, since it is part of the message.
 */
const COLOUR = new RegExp(`${String.fromCharCode(3)}(\\d{1,2}(,\\d{1,2})?)?`, 'g');
const HEX_COLOUR = new RegExp(`${String.fromCharCode(4)}([0-9A-Fa-f]{6}(,[0-9A-Fa-f]{6})?)?`, 'g');
const FORMATTING = new RegExp(`[${[2, 15, 17, 22, 29, 30, 31].map(code => String.fromCharCode(code)).join('')}]`, 'g');

export function stripFormatting(text: string): string {
    return text.replace(COLOUR, '').replace(HEX_COLOUR, '').replace(FORMATTING, '');
}

// ── what the user types ───────────────────────────────────────────────────

export type Input =
    | { kind: 'say'; text: string }
    | { kind: 'action'; text: string }
    | { kind: 'msg'; target: string; text: string }
    | { kind: 'nick'; nick: string }
    | { kind: 'join'; channel: string }
    | { kind: 'part'; channel: string }
    /** Leave the network. ChatService reads it as Disconnect, so the kit does not reconnect behind it. */
    | { kind: 'quit'; reason: string }
    /** A command for the server, as typed: this client has no reading of its own for it. */
    | { kind: 'raw'; command: string; args: string }
    | { kind: 'unknown'; command: string };

/** A command is letters. Anything else — "/123", "/?" — is a typo, and typing it at the server would only earn a 421. */
const COMMAND_WORD = /^[A-Za-z]+$/;

/**
 * Reads one typed line. Null means there is nothing to do — an empty line, or
 * a command missing the argument it needs, which is quieter than sending the
 * server something it will only complain about.
 */
export function parseInput(text: string): Input | null {
    const line = text.trim();
    if (line === '') return null;
    // A doubled slash escapes: "//me" is a message, not an action.
    if (line.startsWith('//')) return { kind: 'say', text: line.slice(1) };
    if (!line.startsWith('/')) return { kind: 'say', text: line };

    const match = /^\/(\S*)\s*([\s\S]*)$/.exec(line);
    const command = (match?.[1] ?? '').toLowerCase();
    const args = match?.[2] ?? '';
    // args has no leading space, so its first word starts at 0 and the rest follows it.
    const [first = ''] = args.split(/\s+/);
    const rest = args.slice(first.length).trim();

    switch (command) {
        case 'me':
            return args === '' ? null : { kind: 'action', text: args };
        case 'msg':
            return first === '' || rest === '' ? null : { kind: 'msg', target: first, text: rest };
        case 'nick':
            return first === '' ? null : { kind: 'nick', nick: first };
        case 'join':
            return first === '' ? null : { kind: 'join', channel: asChannel(first) };
        case 'part':
            // No channel means the active one, which only the client knows.
            return { kind: 'part', channel: first === '' ? '' : asChannel(first) };
        case 'quit':
            // The reason is sent as trailing text, so a colon typed out of IRC habit is not part of it.
            return { kind: 'quit', reason: args.replace(/^:/, '') };
        default:
            /*
             * Everything else is the server's. The commands above are here
             * because the client has to know what they did — a join opens a tab,
             * a part closes one, /me is a message, a quit is a disconnect. INVITE, TOPIC, WHOIS, KICK, MODE and
             * the rest change nothing this client tracks, so passing them on is
             * both less code and more commands than a list could hold: the answer
             * comes back from the server and lands in Status like any other.
             *
             * The arguments go as typed, IRC's own order and its own colon rules
             * included, since guessing where a trailing parameter starts is the
             * client-side reading this deliberately does not do.
             */
            return COMMAND_WORD.test(command) ? { kind: 'raw', command, args } : { kind: 'unknown', command };
    }
}
