import type { ReactNode } from 'react';
import type { ViewChannel } from '../../shared/chat';
import { rankTone } from '../../shared/chatSettings';
import { openUserMenu } from './userMenu';
import { nickColour } from './nickColour';

/** Each tone `rankTone` decides, as the class that draws it. */
const TONE_CLASS = { gold: 'text-gold', warn: 'text-warn', link: 'text-link', plain: 'text-dim' } as const;

/** What a rank symbol means, for the tooltip. A symbol a network invents is shown without a name rather than a guessed one. */
const RANK_NAME: Record<string, string> = { '~': 'owner', '&': 'admin', '@': 'operator', '%': 'half-operator', '+': 'voiced' };

/**
 * Who is in a channel, and nothing else: every line of the list is a name.
 * How many there are is on the People button that shows the list, and the
 * channel's modes and age are in its info view, since a header of them left a
 * short pane a name and a half.
 *
 * Ranked first and named second, as the client sorts them, so the people who
 * run the room are at the top. Each row is the highest rank symbol in its own
 * narrow column — so the names line up whatever ranks sit beside them — and
 * the nick in the colour the log gives it, so a person found here is the same
 * shape when you look back at the conversation.
 */
export default function ChatUsers({ channel, self, mention, className = '' }: { channel: ViewChannel; self: string | null; mention: (nick: string) => void; className?: string }): ReactNode {
    const count = channel.users.length;
    return (
        <section aria-label={`${count === 1 ? '1 person' : `${count} people`} in ${channel.name}`} className={`sunk flex min-h-0 flex-col ${className}`}>
            {count === 0 ? (
                <p className="px-2 py-1.5 text-[12px] text-faint">Nobody listed yet.</p>
            ) : (
                <ul className="min-h-0 flex-1 overflow-y-auto py-1">
                    {channel.users.map(user => {
                        const top = user.prefixes[0] ?? '';
                        const ranks = [...user.prefixes].map(symbol => RANK_NAME[symbol]).filter(Boolean);
                        return (
                            <li key={user.nick}>
                                {/* A button, so the menu is a Tab and an Enter away as well as a click. */}
                                <button
                                    type="button"
                                    title={ranks.length > 0 ? `${user.nick}, ${ranks.join(' and ')}` : user.nick}
                                    onClick={event => openUserMenu(user.nick, event, mention)}
                                    className="flex w-full min-w-0 items-baseline px-1.5 py-px text-left hover:bg-stone-lit/40"
                                >
                                    <span aria-hidden="true" className={`w-[12px] shrink-0 text-center ${TONE_CLASS[rankTone(top)]}`}>
                                        {top}
                                    </span>
                                    <span style={{ color: nickColour(user.nick, self) }} className="truncate">
                                        {user.nick}
                                    </span>
                                    {/* The symbol is drawn for the eye; this says it for a screen reader, which would otherwise read "at mage". */}
                                    {ranks.length > 0 && <span className="sr-only">, {ranks.join(' and ')}</span>}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
