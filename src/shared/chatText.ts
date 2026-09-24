import { CHANNEL_NAME_MAX } from './chatSettings.ts';

/**
 * What the chat log draws a line as: plain text, with the links and channel
 * names in it picked out so they can be clicked. Shared because main opens a
 * link only if this reads it as one, whatever the shell sent.
 */

export type Segment = { kind: 'text'; text: string } | { kind: 'link'; text: string; url: string } | { kind: 'channel'; text: string };

/**
 * A web address, or a channel name standing on its own. A channel has to be
 * preceded by a space, an opening bracket or nothing, so "C#" and "page#top"
 * stay text.
 */
const FINDS = /\b(?:https?:\/\/|www\.)[^\s<>"]+|(?<=^|[\s(])[#&][^\s,]+/gi;

/** Punctuation that ends a sentence rather than an address: "see https://x.com." means x.com. */
const TRAILING = /[.,;:!?'"]+$/;

/**
 * Takes the sentence's punctuation off the end of a find. A closing bracket
 * goes too unless the find opened one, so "(https://x.com)" loses its own and
 * a wiki link ending in "_(disambiguation)" keeps it.
 */
function trim(found: string): string {
    let text = found;
    for (;;) {
        const before = text;
        text = text.replace(TRAILING, '');
        if (text.endsWith(')') && count(text, '(') < count(text, ')')) text = text.slice(0, -1);
        if (text === before) return text;
    }
}

function count(text: string, char: string): number {
    return text.split(char).length - 1;
}

/** A channel worth offering to join: a letter in it, so "#1" in "we're #1" is not one, and short enough to be real. */
function isChannelName(text: string): boolean {
    return text.length >= 2 && text.length <= CHANNEL_NAME_MAX && /[A-Za-z]/.test(text);
}

/**
 * The address a link opens, or null when it is not one this kit will hand to
 * the browser. Only http and https: a chat line is written by a stranger, and
 * a file:, javascript: or custom-scheme link is theirs to aim at the machine.
 * "www." with no scheme means the web.
 */
export function linkTarget(text: string): string | null {
    const raw = /^www\./i.test(text) ? `https://${text}` : text;
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.hostname === '') return null;
    return url.href;
}

export function segments(text: string): Segment[] {
    const out: Segment[] = [];
    let at = 0;
    const plain = (upTo: number): void => {
        if (upTo <= at) return;
        const last = out.at(-1);
        const piece = text.slice(at, upTo);
        if (last?.kind === 'text') last.text += piece;
        else out.push({ kind: 'text', text: piece });
        at = upTo;
    };
    for (const match of text.matchAll(FINDS)) {
        const start = match.index;
        const found = trim(match[0]);
        if (found === '') continue;
        const isChannel = found.startsWith('#') || found.startsWith('&');
        const url = isChannel ? null : linkTarget(found);
        if (isChannel ? !isChannelName(found) : url === null) continue;
        plain(start);
        out.push(isChannel ? { kind: 'channel', text: found } : { kind: 'link', text: found, url: url! });
        at = start + found.length;
    }
    plain(text.length);
    return out;
}
