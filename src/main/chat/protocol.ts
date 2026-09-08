/**
 * The IRC wire format, and the line the user types. Pure string work: no
 * socket, no state, so every rule here is tested against real server lines.
 */

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

export function isChannel(target: string): boolean {
    return target.startsWith('#') || target.startsWith('&');
}

/**
 * IRC names — nicks and channels alike — are case-insensitive on the wire, so
 * "#LostCity" and "#lostcity" name the same channel. This is the one place
 * that fact lives; every identity comparison in this codebase folds through
 * here rather than repeating its own `.toLowerCase()`. Display case is a
 * separate concern and is never touched by this — fold only to compare.
 */
export function foldName(name: string): string {
    return name.toLowerCase();
}

/** Whether two IRC names — nicks or channels — are the same, case folded. */
export function sameName(a: string, b: string): boolean {
    return foldName(a) === foldName(b);
}

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

// ── what the user types ───────────────────────────────────────────────────

export type Input =
    | { kind: 'say'; text: string }
    | { kind: 'action'; text: string }
    | { kind: 'msg'; target: string; text: string }
    | { kind: 'nick'; nick: string }
    | { kind: 'join'; channel: string }
    | { kind: 'part'; channel: string }
    | { kind: 'unknown'; command: string };

/** A channel the user named without its prefix is one they meant to hash. */
function asChannel(name: string): string {
    return isChannel(name) ? name : `#${name}`;
}

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
        default:
            return { kind: 'unknown', command };
    }
}
