import { useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { SERVER_LOG, type ChatLine, type ChatStatus, type ChatView } from '../../shared/chat';

/*
 * .btn and .sunk are hand-written CSS carrying colour and padding, so the few
 * places that have to contradict them say so inline. A utility class of equal
 * specificity would be settled by stylesheet order rather than by intent — and
 * unlayered CSS beats Tailwind's layered utilities outright.
 */

/** A channel chip sits tighter than a full button, as the design draws them. */
const CHIP: CSSProperties = { padding: '2px 10px' };
const CHIP_QUIET: CSSProperties = { ...CHIP, color: 'var(--color-dim)' };

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
 * Every room carries the same #04scape- prefix, which in a 320px panel spends
 * half the chip saying nothing. The full name stays on the button's title for
 * anyone who needs to type it.
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

/** The conversation: rooms across the top, the log, and the line you are typing. */
function Conversation({ view }: { view: ChatView }): ReactNode {
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
            {/* The client centres a panel's title over its contents, so this one is centred too. */}
            <h2 className="title">Chat</h2>
            <Status view={view} />
            {view.channels.length > 1 && <Channels view={view} />}

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

/** The Chat tool: one connection, shared by every window this kit has open. */
export default function Chat({ view }: { view: ChatView }): ReactNode {
    return view.needsNick ? <NickPrompt view={view} /> : <Conversation view={view} />;
}
