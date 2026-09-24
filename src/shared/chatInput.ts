import { foldName, sameName } from './ircNames.ts';

/**
 * The message box's keys: Tab to finish a name, and the arrows to bring back
 * what was sent. Pure, so the rules are tested here and the shell only calls
 * them with what is in the box.
 */

/**
 * Every command the kit reads itself, offered when one is being typed. Anything
 * else still reaches the server as typed. Kept in step with `parseInput`, in
 * main's chat/protocol.ts, by a test there.
 */
export const COMMANDS = [
    'away',
    'clear',
    'close',
    'deop',
    'devoice',
    'help',
    'ignore',
    'invite',
    'join',
    'kick',
    'me',
    'msg',
    'nick',
    'notice',
    'op',
    'part',
    'query',
    'quit',
    'topic',
    'unignore',
    'voice',
    'whois'
] as const;

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
