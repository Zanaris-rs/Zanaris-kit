import type { ReactNode } from 'react';
import type { ViewChannel } from '../../shared/chat';
import { rankTone } from '../../shared/chatSettings';
import { nickColour } from './nickColour';

/** Each tone `rankTone` decides, as the class that draws it. */
const TONE_CLASS = { gold: 'text-gold', warn: 'text-warn', link: 'text-link', plain: 'text-dim' } as const;

/** What a rank symbol means, for the tooltip. A symbol a network invents is shown without a name rather than a guessed one. */
const RANK_NAME: Record<string, string> = { '~': 'owner', '&': 'admin', '@': 'operator', '%': 'half-operator', '+': 'voiced' };

/** When a channel was made, as a date without the time, which nobody reading a user list needs. */
function createdOn(at: number): string {
    return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Who is in a channel, and the channel's own facts above them: how many, its
 * modes, and how old it is.
 *
 * Ranked first and named second, as the client sorts them, so the people who
 * run the room are at the top. Each row is the highest rank symbol in its own
 * narrow column — so the names line up whatever ranks sit beside them — and
 * the nick in the colour the log gives it, so a person found here is the same
 * shape when you look back at the conversation.
 */
export default function ChatUsers({ channel, self, className = '' }: { channel: ViewChannel; self: string | null; className?: string }): ReactNode {
    const count = channel.users.length;
    /* "+" alone is a channel the server said has no flags, which is not worth a mention. */
    const modes = channel.modes !== null && channel.modes !== '+' ? channel.modes : null;
    return (
        <section aria-label={`People in ${channel.name}`} className={`sunk flex min-h-0 flex-col ${className}`}>
            <header className="shrink-0 border-b border-edge-dark px-2 py-1 text-[12px] leading-[1.35] text-dim">
                <p>
                    {count === 1 ? '1 user' : `${count} users`}
                    {modes !== null && <span title="Channel modes"> · {modes}</span>}
                </p>
                {channel.createdAt !== null && <p title={new Date(channel.createdAt).toLocaleString()}>Created {createdOn(channel.createdAt)}</p>}
            </header>
            {count === 0 ? (
                <p className="px-2 py-1.5 text-[12px] text-faint">Nobody listed yet.</p>
            ) : (
                <ul className="min-h-0 flex-1 overflow-y-auto py-1">
                    {channel.users.map(user => {
                        const top = user.prefixes[0] ?? '';
                        const ranks = [...user.prefixes].map(symbol => RANK_NAME[symbol]).filter(Boolean);
                        return (
                            <li key={user.nick} title={ranks.length > 0 ? `${user.nick}, ${ranks.join(' and ')}` : user.nick} className="flex min-w-0 items-baseline px-1.5 py-px">
                                <span aria-hidden="true" className={`w-[12px] shrink-0 text-center ${TONE_CLASS[rankTone(top)]}`}>
                                    {top}
                                </span>
                                <span style={{ color: nickColour(user.nick, self) }} className="truncate">
                                    {user.nick}
                                </span>
                                {/* The symbol is drawn for the eye; this says it for a screen reader, which would otherwise read "at matt". */}
                                {ranks.length > 0 && <span className="sr-only">, {ranks.join(' and ')}</span>}
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
