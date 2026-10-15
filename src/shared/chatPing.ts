import { SERVER_LOG, type ChatPing } from './chat.ts';

/**
 * What the game pane's header says about a ping. Shared rather than written
 * in the shell, which has nothing to test it with.
 */

/** The ping as one line of plain text, read the way the chat log reads it. */
export function pingWords(ping: ChatPing): string {
    const { line } = ping;
    const aside = ping.private ? ' (private)' : '';
    if (line.nick === null) return line.text;
    if (line.kind === 'action') return `* ${line.nick} ${line.text}${aside}`;
    return `${line.nick}${aside}: ${line.text}`;
}

/** The header's tooltip: the whole line, then where it was said and how many more are waiting. */
export function pingTitle(ping: ChatPing): string {
    const room = ping.line.channel === SERVER_LOG ? 'Status' : ping.line.channel;
    const more = ping.more > 0 ? `${ping.more} more` : '';
    const where = ping.private ? more : [`in ${room}`, more].filter(Boolean).join(' · ');
    return [pingWords(ping), where].filter(Boolean).join('\n');
}
