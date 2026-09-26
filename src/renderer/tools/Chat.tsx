import { useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { SERVER_LOG, type ChatLine, type ChatStatus, type ChatView, type ViewChannel } from '../../shared/chat';
import { COMMANDS, complete, recall, remember, type Completion, type Recall } from '../../shared/chatInput';
import { clockTime, isConnectionWanted } from '../../shared/chatSettings';
import { segments } from '../../shared/chatText';
import { isChannel } from '../../shared/ircNames';
import Tab from '../tab';
import ChatSettings from './ChatSettings';
import ChatUsers from './ChatUsers';
import { nickColour } from './nickColour';
import { openUserMenu } from './userMenu';

/*
 * .btn and .sunk are hand-written CSS carrying colour and padding, so the few
 * places that have to contradict them say so inline. A utility class of equal
 * specificity would be settled by stylesheet order rather than by intent — and
 * unlayered CSS beats Tailwind's layered utilities outright.
 */
const QUIET_SIZE: CSSProperties = { fontSize: 13, padding: '0 8px' };

/** Plain words, not a state name: what is true right now and whether to wait. */
const STATUS_NOTE: Record<ChatStatus, string | null> = {
    offline: 'Not connected. Connect from Settings.',
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
function Status({ view, onSettings }: { view: ChatView; onSettings: boolean }): ReactNode {
    /* On Settings, "connect from Settings" is the button under the reader's hand; before a nick exists, offline is not news either. A real error still gets through. */
    const quiet = view.status === 'offline' && (onSettings || view.needsNick);
    const note = quiet ? null : STATUS_NOTE[view.status];
    return (
        <div aria-live="polite" className="text-[12px] empty:hidden">
            {note !== null && <p className="text-dim">{note}</p>}
            {view.error !== null && <p className="text-warn">{view.error}</p>}
        </div>
    );
}

function channelLabel(name: string): string {
    return name === SERVER_LOG ? 'Status' : name;
}

function channelTitle(name: string): string {
    if (name === SERVER_LOG) return 'Messages from the server';
    return isChannel(name) ? name : `Private conversation with ${name}`;
}


/** The open tab carries `aria-current`, which is what the focus restore below looks for. */
const OPEN_TAB = '[aria-current="true"]';

/**
 * Puts the keyboard back somewhere after a channel closes.
 *
 * Pressing a close takes its own button out of the tree, so focus falls to the
 * document body, and a keyboard user is left with no position. Moving focus to
 * whichever tab is open now answers that: it carries `aria-current`, so a
 * screen reader announces where the user is, and that announcement is the
 * confirmation.
 *
 * It waits for the channel to leave `channels` rather than firing on the press,
 * because closing is a round trip through main. The focus is restored only if
 * nothing has taken it in the meantime — `document.body` is where an unmount
 * leaves it, and anything else means the user has moved on, most likely into
 * the message box, and yanking the caret out of a half-typed line is worse
 * than leaving focus where it went.
 */
function useCloseFocus(channels: ViewChannel[]): {
    group: RefObject<HTMLDivElement | null>;
    closing: (channel: string) => void;
} {
    const group = useRef<HTMLDivElement | null>(null);
    const awaited = useRef<string | null>(null);

    /* `channels` arrives over IPC, so it is a fresh array on every view push and this runs on exactly the pushes that could carry the departure. */
    useLayoutEffect(() => {
        const room = awaited.current;
        if (room === null || channels.some(channel => channel.name === room)) return;
        /* Cleared before the guard below: this close's moment has passed either way, and a latch that outlives it is the hazard. */
        awaited.current = null;
        const idle = document.activeElement === null || document.activeElement === document.body;
        if (!idle) return;
        group.current?.querySelector<HTMLElement>(OPEN_TAB)?.focus();
    }, [channels]);

    return {
        group,
        closing: (channel: string) => {
            awaited.current = channel;
        }
    };
}

/**
 * The row of tabs: Settings, Status, then every channel in the order it was
 * joined. The channels never reorder — an unread count changes inside a tab
 * that stays put, and a row that reshuffles as people talk is a row you cannot
 * aim at.
 *
 * Every channel carries its own close, inside the tab, as the window strip's
 * tabs do: any channel may be closed, so there is no rule about which to
 * learn. Settings and Status have none, because neither is a room you are in.
 *
 * They wrap onto as many rows as they need rather than shrinking: a wide pane
 * holds its usual handful on one row, and truncating "#2004scape" to "#20…"
 * when there are more would leave a row of tabs that all read the same.
 *
 * A group of buttons rather than a tablist, and every tab acts when pressed,
 * including the open one — see `role` in tab.tsx.
 */
function ChatTabs({
    view,
    onSettings,
    showSettings,
    showChannel
}: {
    view: ChatView;
    onSettings: boolean;
    showSettings: () => void;
    showChannel: (name: string) => void;
}): ReactNode {
    const { group, closing } = useCloseFocus(view.channels);
    return (
        <div
            ref={group}
            role="group"
            aria-label="Chat"
            className="flex min-w-0 flex-wrap items-center gap-[5px]"
        >
            <Tab role="button" label="Settings" open={onSettings} onSelect={showSettings} />
            {view.channels.map(channel => {
                const open = !onSettings && channel.name === view.active;
                return (
                    <Tab
                        key={channel.name}
                        role="button"
                        label={channelLabel(channel.name)}
                        title={channelTitle(channel.name)}
                        open={open}
                        onSelect={() => showChannel(channel.name)}
                        after={!open && channel.unread > 0 ? <span className="shrink-0 text-gold">{channel.unread}</span> : null}
                        onClose={
                            channel.closable
                                ? () => {
                                      /* Name what is about to go before asking for it, so the focus restore knows whose disappearance it is waiting on. */
                                      closing(channel.name);
                                      void window.zanaris.chat.closeRoom(channel.name);
                                  }
                                : undefined
                        }
                    />
                );
            })}
        </div>
    );
}

/**
 * One line of the log: its time, then what was said. The time is its own
 * column, so wrapped text hangs clear of it and the times read down the left
 * edge like the margin of a transcript. The nick is the coloured part and the
 * words stay cream, so a wall of chat still scans as one column of prose;
 * system lines drop to faint because they are the room talking about itself,
 * not somebody in it.
 */
/**
 * A line's words, with its links and channel names made clickable: a link
 * opens in the system browser, and a channel joins it — which is how an
 * invite is accepted.
 */
function Words({ text }: { text: string }): ReactNode {
    return segments(text).map((part, i) => {
        if (part.kind === 'text') return part.text;
        if (part.kind === 'link')
            return (
                <a
                    key={i}
                    href={part.url}
                    title={part.url}
                    onClick={event => {
                        /* The shell is the window's own page: following the link here would navigate it away. */
                        event.preventDefault();
                        void window.zanaris.chat.openLink(part.url);
                    }}
                    className="text-link underline underline-offset-2 hover:text-cream"
                >
                    {part.text}
                </a>
            );
        return (
            /* `.link`, not a text- utility: the base `button` rule is unlayered and would win over one. */
            <button key={i} type="button" title={`Join ${part.text}`} onClick={() => void window.zanaris.chat.send(`/join ${part.text}`)} className="link inline">
                {part.text}
            </button>
        );
    });
}

/** A speaker's name in the log, which opens the same menu as their row in the user list. */
function Speaker({ nick, colour, prefix = '', mention }: { nick: string; colour: string | undefined; prefix?: string; mention: (nick: string) => void }): ReactNode {
    return (
        <button type="button" onClick={event => openUserMenu(nick, event, mention)} style={{ color: colour }} className="inline hover:underline">
            {prefix}
            {nick}
        </button>
    );
}

function Line({ line, self, mention }: { line: ChatLine; self: string | null; mention: (nick: string) => void }): ReactNode {
    const nick = line.nick;
    const colour = nick === null ? undefined : nickColour(nick, self);
    const at = new Date(line.at);
    return (
        <div className={`flex gap-[7px] px-1 py-[2px] ${line.highlight ? 'bg-stone-lit/40 shadow-[inset_2px_0_0_var(--color-gold)]' : ''}`}>
            <time dateTime={at.toISOString()} title={at.toLocaleString()} className="shrink-0 text-[12px] leading-[1.6] text-faint tabular-nums">
                {clockTime(line.at)}
            </time>
            <div className="min-w-0 flex-1 wrap-break-word">
                {line.kind === 'system' || nick === null ? (
                    <span className="text-faint">
                        <Words text={line.text} />
                    </span>
                ) : line.kind === 'action' ? (
                    <>
                        <Speaker nick={nick} colour={colour} prefix="* " mention={mention} /> <Words text={line.text} />
                    </>
                ) : (
                    <>
                        {/* A /msg sent with no conversation open is echoed into Status beside notices, so it says which it is. */}
                        {line.kind === 'private' && <span className="text-faint">pm </span>}
                        <Speaker nick={nick} colour={colour} mention={mention} /> <Words text={line.text} />
                    </>
                )}
            </div>
        </div>
    );
}

/**
 * The channel's topic, on one line above the log, with who set it and when in
 * its tooltip. In a narrow pane it also carries the button that swaps the log
 * for the user list, which has no room to sit beside it.
 */
function TopicBar({ channel, wide, usersOpen, toggleUsers }: { channel: ViewChannel; wide: boolean; usersOpen: boolean; toggleUsers: () => void }): ReactNode {
    const topic = channel.topic;
    const setBy = topic?.setBy ? `Set by ${topic.setBy}${topic.setAt !== null ? ` on ${new Date(topic.setAt).toLocaleString()}` : ''}` : null;
    const count = channel.users.length;
    return (
        <div className="flex min-w-0 items-center gap-1.5 text-[12px]">
            <p title={topic === null ? undefined : [topic.text, setBy].filter(Boolean).join('\n')} className="min-w-0 flex-1 truncate">
                {topic === null ? (
                    <span className="text-faint">No topic set</span>
                ) : (
                    <span className="text-cream">
                        <Words text={topic.text} />
                    </span>
                )}
            </p>
            {!wide && (
                <button type="button" aria-expanded={usersOpen} onClick={toggleUsers} style={QUIET_SIZE} className="btn group shrink-0">
                    <span className={usersOpen ? 'text-cream' : 'text-dim group-hover:text-cream'}>{usersOpen ? 'Back to chat' : count === 1 ? '1 user' : `${count} users`}</span>
                </button>
            )}
        </div>
    );
}

/** Within this much of the end still counts as watching the end. */
const STICK_SLACK = 24;

/**
 * What was sent, for the arrows to bring back. One list for every chat pane in
 * the window, since it is one person typing; it lasts until the window closes.
 */
let sentLines: string[] = [];

/**
 * The conversation: the topic, the log with the user list beside it, and the
 * line you are typing.
 *
 * The log and the composer are the same object at 320px wide and at 735px, so
 * they are written once; a second log would be a second set of scroll rules to
 * keep in step. What changes with the width is only where the user list goes.
 */
function Conversation({ view, wide }: { view: ChatView; wide: boolean }): ReactNode {
    const [draft, setDraft] = useState('');
    const [behind, setBehind] = useState(false);
    const [usersOpen, setUsersOpen] = useState(false);
    const log = useRef<HTMLDivElement | null>(null);
    const box = useRef<HTMLInputElement | null>(null);
    /* The last Tab and where the arrows have got to. Refs: they only matter to the next key, and any other change to the box drops them. */
    const completion = useRef<Completion | null>(null);
    const recalled = useRef<Recall | null>(null);
    /*
     * Whether the reader is at the end. A ref rather than state: it is read by
     * the layout effect that fires as lines land, and a render in between
     * would be a frame late — the scroll would jump after the paint.
     */
    const stuck = useRef(true);

    /* A conversation with one person has no topic and no list of people: only a channel is a `channel` here. */
    const channel = isChannel(view.active) ? (view.channels.find(c => c.name === view.active) ?? null) : null;
    const person = view.active !== SERVER_LOG && !isChannel(view.active) ? view.active : null;
    /* A narrow pane shows the list in place of the log, so the log is only there when the list is not. */
    const listInstead = !wide && usersOpen && channel !== null;

    const toBottom = (): void => {
        const el = log.current;
        stuck.current = true;
        setBehind(false);
        if (el) el.scrollTop = el.scrollHeight;
    };

    /* A different room is a different conversation, and coming back from the list is coming back to it: start at its end. */
    useLayoutEffect(() => {
        toBottom();
    }, [view.active, listInstead]);

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
        sentLines = remember(sentLines, text);
        completion.current = null;
        recalled.current = null;
        /* Speaking is a claim on the end of the log, wherever you had scrolled to. */
        stuck.current = true;
        setBehind(false);
        setUsersOpen(false);
        void window.zanaris.chat.send(text);
    };

    /** Puts the caret at `at` once React has written the box's new value. */
    const place = (at: number): void => {
        requestAnimationFrame(() => box.current?.setSelectionRange(at, at));
    };

    /** A mention from someone's menu: their name to open the line, or at the end of what is already there. */
    const mention = (nick: string): void => {
        const next = draft.trim() === '' ? `${nick}: ` : `${draft.replace(/\s*$/, ' ')}${nick} `;
        setDraft(next);
        completion.current = null;
        box.current?.focus();
        place(next.length);
    };

    const onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
        const el = event.currentTarget;
        if (event.key === 'Tab') {
            const nicks = channel !== null ? channel.users.map(u => u.nick) : person !== null ? [person] : [];
            const channels = view.channels.map(c => c.name).filter(isChannel);
            const done = complete(el.value, el.selectionStart ?? el.value.length, { nicks, channels, commands: COMMANDS }, completion.current, event.shiftKey);
            /* Nothing to finish: Tab moves focus on, as it does everywhere else. */
            if (done === null) return;
            event.preventDefault();
            completion.current = done;
            setDraft(done.text);
            place(done.caret);
            return;
        }
        if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.altKey && !event.metaKey && !event.shiftKey) {
            const step = recall(sentLines, recalled.current, el.value, event.key === 'ArrowUp' ? 'up' : 'down');
            if (step === null) return;
            event.preventDefault();
            recalled.current = step.at;
            completion.current = null;
            setDraft(step.text);
            place(step.text.length);
        }
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
            {channel !== null && <TopicBar channel={channel} wide={wide} usersOpen={usersOpen} toggleUsers={() => setUsersOpen(!usersOpen)} />}

            <div className="flex min-h-0 flex-1 gap-[5px]">
                {listInstead && channel !== null ? (
                    <ChatUsers channel={channel} self={view.nick} mention={mention} className="min-w-0 flex-1" />
                ) : (
                    /*
                     * mt-auto on the lines: a short log sits on the floor of the well
                     * the way a chat window fills from the bottom, rather than hanging
                     * from the top of an empty box.
                     */
                    <div
                        ref={log}
                        onScroll={onScroll}
                        role="log"
                        aria-label={view.active === SERVER_LOG ? 'Status' : person !== null ? `Conversation with ${person}` : `Conversation in ${view.active}`}
                        className="sunk flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-2 py-1.5 leading-[1.45]"
                    >
                        <div className="mt-auto">
                            {view.lines.map(line => (
                                <Line key={line.id} line={line} self={view.nick} mention={mention} />
                            ))}
                            {view.lines.length === 0 && (
                                <p className="px-1 py-[2px] text-dim">{view.active === SERVER_LOG ? 'Nothing from the server yet.' : 'Nothing said here yet.'}</p>
                            )}
                        </div>
                    </div>
                )}
                {/* 150px: a nick and its rank without truncating most of them, and little enough that the log keeps the pane. */}
                {wide && channel !== null && <ChatUsers channel={channel} self={view.nick} mention={mention} className="w-[150px] shrink-0" />}
            </div>

            {behind && !listInstead && (
                <div>
                    {/* The size inline: `button { font: inherit }` is unlayered, and beats a text- utility. */}
                    <button type="button" onClick={toBottom} style={{ fontSize: 12 }} className="link">
                        More below — jump to the latest
                    </button>
                </div>
            )}

            {/* Actions run along the bottom of a panel here, as they do in the client's own interfaces. */}
            <form onSubmit={send} className="flex items-center gap-1.5">
                <input
                    ref={box}
                    value={draft}
                    onChange={event => {
                        completion.current = null;
                        recalled.current = null;
                        setDraft(event.target.value);
                    }}
                    onKeyDown={onKey}
                    aria-label="Message"
                    placeholder={offline ? 'Chat is not connected' : view.active === SERVER_LOG ? 'Commands like /join #channel — /help lists them' : `Message ${view.active}`}
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
 * The width at which a channel's user list sits beside the log rather than in
 * place of it, and the Settings form puts two fields on a row.
 *
 * A conversation is a column of short lines, and a narrow pane wraps almost
 * every one of them; taking 150px more for names would leave the log too thin
 * to read. A pane knows its own width, so the layout is read from it rather
 * than stored.
 */
const WIDE_ENOUGH = 560;

/**
 * The Chat tool: one connection, shared by every window this kit has open.
 *
 * Which page a pane shows — Settings or a channel — is the pane's own, so two
 * chat panes can have one on Settings while the other follows the talk. Which
 * channel is open is app-wide, as it always was, since it is the client's.
 * With no nick yet, or nothing to show but Settings, Settings is the page.
 */
export default function Chat({ view, width }: { view: ChatView; width: number }): ReactNode {
    const wide = width >= WIDE_ENOUGH;
    const [page, setPage] = useState<'settings' | 'chat'>(() => (view.needsNick || !isConnectionWanted(view.status) ? 'settings' : 'chat'));
    const onSettings = page === 'settings' || view.needsNick || view.channels.length === 0;

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
            <ChatTabs
                view={view}
                onSettings={onSettings}
                showSettings={() => setPage('settings')}
                showChannel={name => {
                    setPage('chat');
                    void window.zanaris.chat.select(name);
                }}
            />
            <Status view={view} onSettings={onSettings} />
            {onSettings ? (
                <ChatSettings view={view} wide={wide} onConnected={() => setPage('chat')} />
            ) : (
                <Conversation view={view} wide={wide} />
            )}
        </div>
    );
}
