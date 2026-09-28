import { foldName, sameName } from './ircNames.ts';

/**
 * The message box's rules: the commands and the menu that offers them, Tab to
 * finish a name, and the arrows to bring back what was sent. Pure, so the
 * rules are tested here and the shell only calls them with what is in the box.
 */

// ── the commands ──────────────────────────────────────────────────────────

/** A command the kit reads itself, as the message box's menu and /help describe it. */
export interface CommandHelp {
    name: string;
    /** What follows the name, written for a person: "#channel", "nick [reason]". Empty when nothing does. */
    args: string;
    /** What it does, in a few words. */
    about: string;
    /** Whether it does something typed alone. A test in main's protocol.test.ts holds this to `parseInput`. */
    bare: boolean;
    /** Shorter names `parseInput` reads exactly as this one, arguments and all. */
    aliases: readonly string[];
}

/**
 * Every command the kit reads itself. Anything else still reaches the server
 * as typed. The one table: /help prints it and the menu offers it, so neither
 * can know a command the other does not. Kept in step with `parseInput`, in
 * main's chat/protocol.ts, by tests there.
 */
export const COMMAND_HELP: readonly CommandHelp[] = [
    { name: 'away', args: '[reason]', about: 'mark yourself away; with no reason, back', bare: true, aliases: [] },
    /* Its own entry rather than away's alias: it takes no reason, and away's usage line would promise one. */
    { name: 'back', args: '', about: 'mark yourself back', bare: true, aliases: [] },
    { name: 'clear', args: '', about: 'empty this tab', bare: true, aliases: [] },
    { name: 'close', args: '', about: 'leave this channel, or end this conversation', bare: true, aliases: [] },
    { name: 'deop', args: 'nick', about: "take away someone's operator rank", bare: false, aliases: [] },
    { name: 'devoice', args: 'nick', about: "take away someone's voice", bare: false, aliases: [] },
    { name: 'help', args: '', about: 'list these commands', bare: true, aliases: [] },
    { name: 'ignore', args: '[nick]', about: "hide someone's messages; with no nick, list who is hidden", bare: true, aliases: [] },
    { name: 'invite', args: 'nick [#channel]', about: 'invite someone to this channel', bare: false, aliases: [] },
    { name: 'join', args: '#channel', about: 'join a channel', bare: false, aliases: ['j'] },
    { name: 'kick', args: 'nick [reason]', about: 'remove someone from this channel', bare: false, aliases: [] },
    { name: 'me', args: 'text', about: 'say what you are doing', bare: false, aliases: [] },
    { name: 'msg', args: 'nick text', about: 'send someone a private message', bare: false, aliases: [] },
    { name: 'nick', args: 'name', about: 'change your name for this session', bare: false, aliases: [] },
    { name: 'notice', args: 'nick text', about: 'send a notice', bare: false, aliases: [] },
    { name: 'op', args: 'nick', about: 'make someone a channel operator', bare: false, aliases: [] },
    { name: 'part', args: '[#channel]', about: 'leave this channel', bare: true, aliases: [] },
    { name: 'query', args: 'nick [text]', about: 'talk to someone privately', bare: false, aliases: ['q'] },
    { name: 'quit', args: '[reason]', about: 'disconnect', bare: true, aliases: [] },
    { name: 'topic', args: '[text]', about: "show or set this channel's topic", bare: true, aliases: [] },
    { name: 'unignore', args: 'nick', about: "stop hiding someone's messages", bare: false, aliases: [] },
    { name: 'voice', args: 'nick', about: 'give someone a voice', bare: false, aliases: [] },
    { name: 'whois', args: 'nick', about: 'look someone up', bare: false, aliases: ['wi'] }
];

/** The table's names, which Tab finishes a command from. */
export const COMMANDS: readonly string[] = COMMAND_HELP.map(c => c.name);

// ── the command menu ──────────────────────────────────────────────────────

/** The command being typed, without its slash, and every command it could be. */
export interface CommandMenu {
    typed: string;
    matches: readonly CommandHelp[];
}

/** A command word opening the box: a slash and letters, up to a space or the end. A second slash is the escape for a message, so it is not one. */
const COMMAND_WORD = /^\/([A-Za-z]*)(?=\s|$)/;

/**
 * What the menu offers while a command is being typed: the box opens with a
 * slash and letters, and the caret sits at their end. Every command whose name
 * or an alias starts with the letters, in the table's order. Null when no
 * command is being typed or none could be meant, which is the menu closed.
 */
export function commandMenu(text: string, caret: number): CommandMenu | null {
    const word = COMMAND_WORD.exec(text);
    if (word === null || caret !== word[0].length) return null;
    const typed = word[1]!.toLowerCase();
    const matches = COMMAND_HELP.filter(c => c.name.startsWith(typed) || c.aliases.some(a => a.startsWith(typed)));
    return matches.length === 0 ? null : { typed, matches };
}

/** The command a whole word names, by its name or an alias. */
function commandNamed(word: string): CommandHelp | null {
    const name = word.toLowerCase();
    return COMMAND_HELP.find(c => c.name === name || c.aliases.includes(name)) ?? null;
}

/** The command the box opens with, once a space follows it: what the line under the menu says how to use. Null for anything else, the server's own commands included. */
export function commandHint(text: string): CommandHelp | null {
    const word = /^\/([A-Za-z]+)\s/.exec(text);
    return word === null ? null : commandNamed(word[1]!);
}

/**
 * Commands the server answers itself, which the kit sends as typed. Enter
 * sends one typed whole even while the menu offers something longer: "/who"
 * is the start of "/whois", and "/ms", services' MemoServ, of "/msg". IRC's
 * own commands and the services' names, less the kit's own.
 */
const SERVER_COMMANDS: ReadonlySet<string> = new Set([
    'admin',
    'info',
    'ison',
    'kill',
    'knock',
    'links',
    'list',
    'lusers',
    'map',
    'mode',
    'motd',
    'names',
    'oper',
    'ping',
    'privmsg',
    'rules',
    'silence',
    'stats',
    'time',
    'userhost',
    'userip',
    'users',
    'version',
    'wallops',
    'watch',
    'who',
    'whowas',
    'ns',
    'cs',
    'ms',
    'hs',
    'os',
    'bs',
    'nickserv',
    'chanserv',
    'memoserv',
    'hostserv',
    'operserv',
    'botserv'
]);

/**
 * What Enter does while the menu is open. A whole command of the kit's that
 * does something alone is sent, as Enter always did, and so is one of the
 * server's. Anything else takes the highlighted command, since sending "/jo"
 * or a bare "/join" would only be refused.
 */
export function menuEnter(menu: CommandMenu): 'send' | 'take' {
    const named = commandNamed(menu.typed);
    if (named !== null) return named.bare ? 'send' : 'take';
    return SERVER_COMMANDS.has(menu.typed) ? 'send' : 'take';
}

/** The box with its command word replaced by `command`'s name and a space, the caret after the space, and the rest of the line kept. */
export function takeCommand(text: string, command: CommandHelp): { text: string; caret: number } {
    const head = `/${command.name} `;
    return { text: `${head}${text.replace(/^\/[A-Za-z]*\s*/, '')}`, caret: head.length };
}

// ── Tab ───────────────────────────────────────────────────────────────────

/** What one Tab left in the box, kept so the next Tab can move on to the next match. */
export interface Completion {
    /** The box's text and caret as this Tab left them. Anything else in the box means the user has moved on. */
    text: string;
    caret: number;
    /** What stood around the word being finished. */
    before: string;
    after: string;
    matches: string[];
    index: number;
    /** Whether the word opens the line, where a nick is followed by ": " as an address. */
    opening: boolean;
}

export interface CompletionSources {
    /** People who can be named here: the channel's, or the one person in a private conversation. */
    nicks: string[];
    channels: string[];
    commands: readonly string[];
}

/**
 * Finishes the word before the caret, or moves to the next match when the box
 * is still as the last Tab left it. A word opening with "/" at the start of
 * the line is a command, one opening with "#" a channel, anything else a nick.
 * Null when nothing matches, so the key can be left alone.
 */
export function complete(text: string, caret: number, sources: CompletionSources, last: Completion | null, backwards = false): Completion | null {
    if (last !== null && last.text === text && last.caret === caret && last.matches.length > 1) {
        const n = last.matches.length;
        return fill(last.before, last.after, last.matches, (last.index + (backwards ? n - 1 : 1)) % n, last.opening);
    }

    const start = text.slice(0, caret).search(/\S*$/);
    const word = text.slice(start, caret);
    if (word === '') return null;
    const before = text.slice(0, start);
    const after = text.slice(caret);

    let matches: string[];
    let opening = false;
    if (word.startsWith('/') && start === 0) {
        const typed = word.slice(1).toLowerCase();
        matches = sources.commands.filter(c => c.startsWith(typed)).map(c => `/${c}`);
    } else {
        const pool = word.startsWith('#') || word.startsWith('&') ? sources.channels : sources.nicks;
        const typed = foldName(word);
        matches = unique(pool)
            .filter(name => foldName(name).startsWith(typed))
            .sort((a, b) => compare(foldName(a), foldName(b)));
        opening = start === 0 && !word.startsWith('#') && !word.startsWith('&');
    }
    if (matches.length === 0) return null;
    return fill(before, after, matches, backwards ? matches.length - 1 : 0, opening);
}

function fill(before: string, after: string, matches: string[], index: number, opening: boolean): Completion {
    // A nick opening the line is someone being spoken to. Anything else is a word in a sentence, and the space after it is already there or wanted.
    const suffix = opening ? ': ' : after.startsWith(' ') ? '' : ' ';
    const head = `${before}${matches[index]}${suffix}`;
    return { text: `${head}${after}`, caret: head.length, before, after, matches, index, opening };
}

function unique(names: string[]): string[] {
    const kept: string[] = [];
    for (const name of names) if (!kept.some(k => sameName(k, name))) kept.push(name);
    return kept;
}

function compare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

// ── the arrows ────────────────────────────────────────────────────────────

/** Past a morning's worth of chat, and short enough that nothing needs to trim it but this. */
export const HISTORY_MAX = 100;

/** Adds a sent line to the history, newest last. A line sent twice running is kept once. */
export function remember(history: readonly string[], line: string): string[] {
    if (line === '' || history.at(-1) === line) return [...history];
    return [...history, line].slice(-HISTORY_MAX);
}

/** Where the arrows have got to. Null is the line being written, which Up keeps safe as `draft`. */
export interface Recall {
    index: number;
    draft: string;
}

/**
 * One press of Up or Down: the text to put in the box and where that leaves
 * the recall. Null when there is nowhere further to go, so the key can be
 * left to move the caret. Down past the newest brings back what was being
 * written when Up was first pressed.
 */
export function recall(history: readonly string[], at: Recall | null, current: string, direction: 'up' | 'down'): { text: string; at: Recall | null } | null {
    if (direction === 'up') {
        if (history.length === 0) return null;
        if (at === null) return { text: history.at(-1)!, at: { index: history.length - 1, draft: current } };
        if (at.index === 0) return null;
        return { text: history[at.index - 1]!, at: { index: at.index - 1, draft: at.draft } };
    }
    if (at === null) return null;
    if (at.index >= history.length - 1) return { text: at.draft, at: null };
    return { text: history[at.index + 1]!, at: { index: at.index + 1, draft: at.draft } };
}

// ── a nick's menu ─────────────────────────────────────────────────────────

export type UserAction = 'message' | 'mention' | 'whois' | 'ignore' | 'unignore';

/**
 * What a click on someone's name offers, in order. Yourself only to look up:
 * a conversation with, a mention of, or ignoring yourself is nothing.
 */
export function userActions(nick: string, self: string | null, ignored: readonly string[]): { action: UserAction; label: string }[] {
    if (self !== null && sameName(nick, self)) return [{ action: 'whois', label: 'Who is this?' }];
    const isIgnored = ignored.some(n => sameName(n, nick));
    return [
        { action: 'message', label: `Message ${nick}` },
        { action: 'mention', label: 'Mention' },
        { action: 'whois', label: 'Who is this?' },
        isIgnored ? { action: 'unignore', label: `Stop ignoring ${nick}` } : { action: 'ignore', label: `Ignore ${nick}` }
    ];
}
