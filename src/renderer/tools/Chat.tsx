import { useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { SERVER_LOG, type ChatHome, type ChatLine, type ChatStatus, type ChatView } from '../../shared/chat';
import { MoveChat } from '../icons';
import Tab from '../tab';

/*
 * .btn and .sunk are hand-written CSS carrying colour and padding, so the few
 * places that have to contradict them say so inline. A utility class of equal
 * specificity would be settled by stylesheet order rather than by intent — and
 * unlayered CSS beats Tailwind's layered utilities outright.
 */

/** A channel chip sits tighter than a full button, as the design draws them. */
const CHIP: CSSProperties = { padding: '2px 10px' };
const CHIP_QUIET: CSSProperties = { ...CHIP, color: 'var(--color-dim)' };

/** In the dock the title shares a row instead of owning one, so it gives up the panel title's padding. */
const ROW_TITLE: CSSProperties = { padding: 0 };

/**
 * Nick colours, so a conversation can be followed by shape instead of by
 * reading every name. The palette is the era's chat set — pale blue, pink,
 * tan, green, purple, cyan — and a nick is hashed into it rather than dealt
 * one on arrival, so a person keeps their colour across restarts and looks the
 * same in every window. Your own nick is gold instead: the one voice you
 * always want to find in the log.
 */
const NICK_COLOURS = ['#9db8c3', '#faa8aa', '#c8a86a', '#90c040', '#c503fd', '#6fc9d8'];

function nickColour(nick: string, self: string | null): string {
    /* IRC nicks are case-insensitive, so Kev and kev are one person and one colour. */
    const name = nick.toLowerCase();
    if (self !== null && name === self.toLowerCase()) return 'var(--color-gold)';
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return NICK_COLOURS[hash % NICK_COLOURS.length] ?? '#9db8c3';
}

/** Plain words, not a state name: what is true right now and whether to wait. */
const STATUS_NOTE: Record<ChatStatus, string | null> = {
    offline: 'Not connected, so nothing is arriving.',
    connecting: 'Connecting to chat…',
    registering: 'Signing in…',
    online: null,
    reconnecting: 'Connection dropped — reconnecting…'
};

/**
 * Never leave the panel looking like a quiet room when it is a shut one. The
 * region is always in the tree so a change to it is announced rather than
 * appearing silently; it collapses when there is nothing to say.
 */
function Status({ view }: { view: ChatView }): ReactNode {
    const note = STATUS_NOTE[view.status];
    return (
        <div aria-live="polite" className="px-2.5 pb-1.5 text-[12px] empty:hidden">
            {note !== null && <p className="text-dim">{note}</p>}
            {view.error !== null && <p className="text-warn">{view.error}</p>}
        </div>
    );
}

/**
 * Every room carries the same #04scape- prefix, so half of every label says
 * what the whole list already says. Trimmed in both homes, not only the narrow
 * one: short labels fit more rooms across the dock's header, and a room whose
 * name changed as you moved chat from one edge to the other would be worse
 * than one that is always short. The full name stays on the control's title
 * for anyone who needs to type it.
 */
const PREFIX = '#04scape-';

function channelLabel(name: string): string {
    if (name === SERVER_LOG) return 'server';
    return name.startsWith(PREFIX) ? `#${name.slice(PREFIX.length)}` : name;
}

function Channels({ view }: { view: ChatView }): ReactNode {
    return (
        <div className="flex flex-wrap gap-1.5 px-2.5 pb-[7px]" role="group" aria-label="Channels">
            {view.channels.map(channel => {
                const on = channel.name === view.active;
                return (
                    <button
                        key={channel.name}
                        type="button"
                        title={channel.name}
                        aria-pressed={on}
                        onClick={() => !on && void window.zanaris.chat.select(channel.name)}
                        style={on ? CHIP : CHIP_QUIET}
                        className={`btn gap-[7px] ${on ? 'btn-red' : ''}`}
                    >
                        {channelLabel(channel.name)}
                        {!on && channel.unread > 0 && <span className="text-gold">{channel.unread}</span>}
                    </button>
                );
            })}
        </div>
    );
}

/**
 * Sends chat to the edge it is not on. The label names the destination rather
 * than the direction: "move chat to the side" is a thing somebody can want,
 * where "move right" is a thing they have to work out first. The home is
 * app-wide, so main tells every other window where chat went.
 */
function MoveControl({ home, className = '' }: { home: ChatHome; className?: string }): ReactNode {
    const to: ChatHome = home === 'bottom' ? 'side' : 'bottom';
    const label = to === 'side' ? 'Move chat to the side' : 'Move chat to the bottom';
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={() => void window.zanaris.chat.setHome(to)}
            className={`tile flex h-[26px] w-[28px] shrink-0 items-center justify-center ${className}`}
        >
            <MoveChat down={to === 'bottom'} />
        </button>
    );
}

/**
 * The dock's one row of furniture: the rooms as tabs, the title, and the move
 * control. In the side panel those first two cost a 31px centred title and a
 * wrapping row of chips, which 600px of height can afford and 200px cannot, so
 * the dock buys all three back for a single ~33px row.
 *
 * The rooms sit in the order they were joined and never reorder. An unread
 * count changes inside a tab that stays put; a room list that reshuffles as
 * people talk is a room list you cannot aim at.
 */
function DockHeader({ view }: { view: ChatView }): ReactNode {
    return (
        <div className="flex items-center gap-[5px] px-1.5 py-[3px]">
            {/* A group of controls rather than a tablist, and every room acts when clicked, including the open one — see `role` in tab.tsx. */}
            <div role="group" aria-label="Channels" className="flex min-w-0 items-center gap-[5px] overflow-hidden">
                {view.channels.map(channel => {
                    const on = channel.name === view.active;
                    return (
                        <Tab
                            key={channel.name}
                            role="button"
                            label={channelLabel(channel.name)}
                            title={channel.name}
                            open={on}
                            onSelect={() => void window.zanaris.chat.select(channel.name)}
                            after={!on && channel.unread > 0 ? <span className="shrink-0 text-gold">{channel.unread}</span> : null}
                        />
                    );
                })}
            </div>
            {/* Two auto margins: the title takes the middle of whatever the rooms leave, and the control keeps the right. */}
            <h2 style={ROW_TITLE} className="title mx-auto shrink-0">
                Chat
            </h2>
            <MoveControl home="bottom" />
        </div>
    );
}

/**
 * One line of the log. The nick is the coloured part and the words stay cream,
 * so a wall of chat still scans as one column of prose; system lines drop to
 * faint because they are the room talking about itself, not somebody in it.
 */
function Line({ line, self }: { line: ChatLine; self: string | null }): ReactNode {
    const nick = line.nick;
    const colour = nick === null ? undefined : nickColour(nick, self);
    return (
        <div
            className={`px-1 py-[2px] wrap-break-word ${
                line.highlight ? 'bg-stone-lit/40 shadow-[inset_2px_0_0_var(--color-gold)]' : ''
            }`}
        >
            {line.kind === 'system' || nick === null ? (
                <span className="text-faint">{line.text}</span>
            ) : line.kind === 'action' ? (
                <>
                    <span style={{ color: colour }}>* {nick}</span> {line.text}
                </>
            ) : (
                <>
                    {/* A private message lands in the server log beside notices, so it says which it is. */}
                    {line.kind === 'private' && <span className="text-faint">pm </span>}
                    <span style={{ color: colour }}>{nick}</span> {line.text}
                </>
            )}
        </div>
    );
}

/** Within this much of the end still counts as watching the end. */
const STICK_SLACK = 24;

/**
 * The conversation: rooms across the top, the log, and the line you are typing.
 *
 * Only the furniture above the log knows which home it is in. The log and the
 * composer are the same object at 320px wide and at 735px, so they are written
 * once; a second log would be a second set of scroll rules to keep in step.
 */
function Conversation({ view, home }: { view: ChatView; home: ChatHome }): ReactNode {
    const [draft, setDraft] = useState('');
    const [behind, setBehind] = useState(false);
    const log = useRef<HTMLDivElement | null>(null);
    /*
     * Whether the reader is at the end. A ref rather than state: it is read by
     * the layout effect that fires as lines land, and a render in between
     * would be a frame late — the scroll would jump after the paint.
     */
    const stuck = useRef(true);

    const toBottom = (): void => {
        const el = log.current;
        stuck.current = true;
        setBehind(false);
        if (el) el.scrollTop = el.scrollHeight;
    };

    /* A different room is a different conversation: start it at its end. */
    useLayoutEffect(() => {
        toBottom();
    }, [view.active]);

    /*
     * Follow new lines only for a reader who was already at the bottom. Someone
     * who scrolled up is reading something, and yanking them to the end is how
     * chat windows lose an argument mid-sentence. They get told instead.
     */
    const last = view.lines.at(-1)?.id ?? 0;
    useLayoutEffect(() => {
        const el = log.current;
        if (!el) return;
        if (stuck.current) el.scrollTop = el.scrollHeight;
        else setBehind(true);
    }, [last, view.lines.length]);

    const onScroll = (): void => {
        const el = log.current;
        if (!el) return;
        stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_SLACK;
        if (stuck.current) setBehind(false);
    };

    const offline = view.status !== 'online';
    const send = (event: FormEvent): void => {
        event.preventDefault();
        const text = draft.trim();
        if (text === '') return;
        setDraft('');
        /* Speaking is a claim on the end of the log, wherever you had scrolled to. */
        stuck.current = true;
        setBehind(false);
        void window.zanaris.chat.send(text);
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {home === 'bottom' ? (
                <>
                    <DockHeader view={view} />
                    <Status view={view} />
                </>
            ) : (
                <>
                    {/*
                     * The client centres a panel's title over its contents, so this one is
                     * centred too — which is why the move control is laid over the row
                     * rather than placed in it: a flex sibling would push the title off
                     * centre to make room for itself.
                     */}
                    <div className="relative">
                        <h2 className="title">Chat</h2>
                        <MoveControl home="side" className="absolute top-1/2 right-2.5 -translate-y-1/2" />
                    </div>
                    <Status view={view} />
                    {view.channels.length > 1 && <Channels view={view} />}
                </>
            )}

            {/*
             * mt-auto on the lines: a short log sits on the floor of the well
             * the way a chat window fills from the bottom, rather than hanging
             * from the top of an empty box.
             */}
            <div
                ref={log}
                onScroll={onScroll}
                role="log"
                aria-label="Conversation"
                className="sunk mx-2.5 flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-1.5 leading-[1.45]"
            >
                <div className="mt-auto">
                    {view.lines.map(line => (
                        <Line key={line.id} line={line} self={view.nick} />
                    ))}
                    {view.lines.length === 0 && (
                        <p className="px-1 py-[2px] text-dim">
                            {view.active === SERVER_LOG ? 'Nothing from the server yet.' : 'Nothing said here yet.'}
                        </p>
                    )}
                </div>
            </div>

            {behind && (
                <div className="px-2.5 pt-1">
                    <button type="button" onClick={toBottom} className="link text-[12px]">
                        More below — jump to the latest
                    </button>
                </div>
            )}

            {/* Actions run along the bottom of a panel here, as they do in the client's own interfaces. */}
            <form onSubmit={send} className="flex items-center gap-1.5 px-2.5 py-2">
                <input
                    value={draft}
                    onChange={event => setDraft(event.target.value)}
                    aria-label="Message"
                    placeholder={offline ? 'Chat is not connected' : 'Say something'}
                    maxLength={400}
                    autoComplete="off"
                    spellCheck={false}
                    className="sunk min-w-0 flex-1 px-[7px] py-[3px] font-sans text-[13px] text-cream placeholder:text-faint"
                />
                <button type="submit" disabled={offline} className="btn btn-red shrink-0 disabled:opacity-60">
                    Send
                </button>
            </form>
        </div>
    );
}

/**
 * The first thing a new user meets, so it asks rather than complains: chat is
 * one public conversation and it needs something to call you. The field and
 * its button are the same pair as the message row underneath the log, so the
 * panel does not change shape when the name is set.
 */
function NickPrompt({ view }: { view: ChatView }): ReactNode {
    const [nick, setNick] = useState('');
    const ready = nick.trim() !== '';

    const claim = (event: FormEvent): void => {
        event.preventDefault();
        const name = nick.trim();
        if (name === '') return;
        void window.zanaris.chat.setNick(name);
    };

    return (
        <form onSubmit={claim} className="flex min-h-0 flex-1 flex-col">
            <h2 className="title">Chat</h2>
            <Status view={view} />

            <div className="sunk mx-2.5 min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5 leading-[1.45]">
                <p>Everyone playing shares one conversation here. Pick a name for it — the other players will see it.</p>
                <p className="mt-2 text-dim">
                    It does not have to be your character's name, and you can change it later by typing{' '}
                    <span className="text-cream">/nick</span> in the chat.
                </p>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-2">
                <input
                    value={nick}
                    onChange={event => setNick(event.target.value)}
                    aria-label="Your name in chat"
                    placeholder="Pick a name"
                    maxLength={30}
                    autoComplete="off"
                    spellCheck={false}
                    className="sunk min-w-0 flex-1 px-[7px] py-[3px] font-sans text-[13px] text-cream placeholder:text-faint"
                />
                <button type="submit" disabled={!ready} className="btn btn-red shrink-0 disabled:opacity-60">
                    Join
                </button>
            </div>
        </form>
    );
}

/**
 * The Chat tool: one connection, shared by every window this kit has open, and
 * drawn either along the bottom of the window or down the side column.
 * `NickPrompt` is the same in both — at 735px its two paragraphs land in three
 * or four lines instead of a column, which is the only difference.
 */
export default function Chat({ view, home }: { view: ChatView; home: ChatHome }): ReactNode {
    return view.needsNick ? <NickPrompt view={view} /> : <Conversation view={view} home={home} />;
}
