import type { ChatStatus } from './chat.ts';
import { asChannel, foldName, isChannel } from './ircNames.ts';

/**
 * The chat Settings form, and the small readings the chat pane draws with.
 * Shared because the shell checks a draft as it is typed and main checks it
 * again before anything is saved or sent, and two copies of what a valid
 * channel list is would be two lists that disagree.
 */

/** Past any nick SwiftIRC hands out, and the length the old nick prompt allowed. */
export const NICK_MAX = 30;
/** RFC 2812 caps a channel name at 50 characters. */
export const CHANNEL_NAME_MAX = 50;
/** A sanity rail rather than a real ceiling on how many rooms someone could want. */
export const AUTO_JOIN_MAX = 20;
/** The same kind of rail for the ignore list. */
export const IGNORE_MAX = 100;

/**
 * A nick as IRC allows one: a letter or one of the specials first, then those
 * plus digits and hyphens. A server answers anything else with 432 and a
 * registration that never finishes, so the form refuses it instead.
 */
const NICK = /^[A-Za-z[\]\\`_^{|}][A-Za-z0-9[\]\\`_^{|}-]*$/;

/** Whether a nick is one IRC would take. Also how `appState` judges a hand-edited profile, which reaches the wire the same way. */
export function isNick(nick: string): boolean {
    return nick.length <= NICK_MAX && NICK.test(nick);
}

/**
 * What is wrong with a channel name that already has its prefix, or null.
 * Also `appState`'s test for a stored list: a name holding a line break would
 * end the JOIN it is sent in and start another command.
 */
export function channelProblem(channel: string): string | null {
    if (!isChannel(channel) || channel.length < 2) return `"${channel}" is not a channel name.`;
    if (channel.length > CHANNEL_NAME_MAX) return `${channel.slice(0, 20)}… is longer than ${CHANNEL_NAME_MAX} characters.`;
    if (/[\u0000-\u001f\u007f\s,]/.test(channel)) return `${channel} has a character a channel name cannot.`;
    return null;
}

/** What the form holds: the text as typed. */
export interface SettingsInput {
    nick: string;
    /** Comma or space separated, prefixes optional. */
    channels: string;
}

/**
 * What the form sends to main. The password rides alongside rather than in
 * the draft because it is never shown back: absent leaves the saved one alone,
 * a string replaces it, and null forgets it.
 */
export interface SettingsSave extends SettingsInput {
    password?: string | null;
    /** The ignore list as typed, read by `readIgnore`. Absent leaves the saved one alone. */
    ignore?: string;
    /** Absent leaves the saved choice alone. */
    notify?: boolean;
}

/**
 * Reads the ignore field: nicks, separated by commas or spaces, each kept once
 * whatever its case. A name IRC would never give anyone is refused rather than
 * kept, since it could never match.
 */
export function readIgnore(text: string): { ok: true; ignore: string[] } | { ok: false; message: string } {
    const ignore: string[] = [];
    for (const word of text.split(/[\s,]+/)) {
        if (word === '') continue;
        if (!isNick(word)) return { ok: false, message: `"${word.slice(0, 30)}" is not a nick.` };
        if (!ignore.some(kept => foldName(kept) === foldName(word))) ignore.push(word);
    }
    if (ignore.length > IGNORE_MAX) return { ok: false, message: `${IGNORE_MAX} names is the most.` };
    return { ok: true, ignore };
}

/** Whether two name lists hold the same names, whatever their order or case. */
export function sameNames(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    const folded = b.map(foldName).sort();
    return a
        .map(foldName)
        .sort()
        .every((name, i) => name === folded[i]);
}

/** Longer than any NickServ allows, and short enough that nothing silly reaches the wire. */
export const PASSWORD_MAX = 100;

/**
 * What is wrong with a password, or null. It goes out as the tail of a
 * PRIVMSG, so a line break in it would end that command and start another —
 * refused for that reason as much as because no service would accept one.
 */
export function passwordProblem(password: string): string | null {
    if (password === '') return 'Type a password, or leave the field empty to keep the saved one.';
    if (password.length > PASSWORD_MAX) return `${PASSWORD_MAX} characters is the most.`;
    if (/[\u0000-\u001f\u007f]/.test(password)) return 'A password cannot hold a line break or control character.';
    return null;
}

/** What a valid form means. */
export interface SettingsDraft {
    nick: string;
    autoJoin: string[];
}

export interface SettingsProblem {
    field: 'nick' | 'channels';
    message: string;
}

export type SettingsReading = { ok: true; draft: SettingsDraft } | { ok: false; problem: SettingsProblem };

/**
 * Reads the form. The first problem found is the one reported, nick before
 * channels, since that is the order the fields are in.
 *
 * Channels are forgiving about how they are written — "lostcity" means
 * "#lostcity", as `/join` already reads it, and commas and spaces both
 * separate — and strict about what they are: a name the server would refuse
 * or silently truncate is reported here, not discovered in the Status log.
 * A room named twice, in any case, is kept once, in the spelling first given.
 */
export function readSettingsDraft(input: SettingsInput): SettingsReading {
    const nick = input.nick.trim();
    if (nick === '') return problem('nick', 'Pick a name for chat.');
    if (nick.length > NICK_MAX) return problem('nick', `${NICK_MAX} characters is the most.`);
    if (!isNick(nick)) return problem('nick', 'Letters, digits and _-[]{}|^` only, and not a digit or - first.');

    const autoJoin: string[] = [];
    for (const word of input.channels.split(/[\s,]+/)) {
        if (word === '') continue;
        const channel = asChannel(word);
        const wrong = channelProblem(channel);
        if (wrong !== null) return problem('channels', wrong);
        if (autoJoin.some(kept => foldName(kept) === foldName(channel))) continue;
        autoJoin.push(channel);
    }
    if (autoJoin.length > AUTO_JOIN_MAX) return problem('channels', `${AUTO_JOIN_MAX} channels is the most.`);
    return { ok: true, draft: { nick, autoJoin } };
}

function problem(field: SettingsProblem['field'], message: string): SettingsReading {
    return { ok: false, problem: { field, message } };
}

/** The saved list as the field shows it. */
export function formatAutoJoin(autoJoin: readonly string[]): string {
    return autoJoin.join(', ');
}

/**
 * Whether saving this draft would change anything. Case counts for the nick,
 * which other people see, and not for a channel, which the server does not
 * distinguish; order counts for neither list, since it only decides which tab
 * comes first on the next connect.
 */
export function sameSettings(draft: SettingsDraft, nick: string | null, autoJoin: readonly string[]): boolean {
    return draft.nick === nick && sameNames(draft.autoJoin, autoJoin);
}

/**
 * Whether the connection is the user's to end rather than start. Reconnecting
 * counts: a connection waiting to retry is one Disconnect should stop.
 */
export function isConnectionWanted(status: ChatStatus): boolean {
    return status !== 'offline';
}

/** A line's time as the log prints it: 24-hour, local, to the second. */
export function clockTime(at: number): string {
    const date = new Date(at);
    const two = (n: number): string => String(n).padStart(2, '0');
    return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

export type RankTone = 'gold' | 'warn' | 'link' | 'plain';

/**
 * How loud a rank symbol is drawn. Owners, admins and ops run the room and
 * share the gold; a half-op is between; a voice is someone the room lets
 * speak. Anything else a network invents reads as plain rather than guessed.
 */
export function rankTone(symbol: string): RankTone {
    switch (symbol) {
        case '~':
        case '&':
        case '@':
            return 'gold';
        case '%':
            return 'warn';
        case '+':
            return 'link';
        default:
            return 'plain';
    }
}
