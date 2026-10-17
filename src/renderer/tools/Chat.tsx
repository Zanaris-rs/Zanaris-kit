import { Fragment, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { SERVER_LOG, roomLabel, type ChatLine, type ChatStatus, type ChatView, type ViewChannel } from '../../shared/chat';
import { COMMANDS, commandHint, commandMenu, complete, menuEnter, recall, remember, takeCommand, type CommandHelp, type CommandMenu, type Completion, type Recall } from '../../shared/chatInput';
import { foldLog, type LogItem } from '../../shared/chatLog';
import { clockTime } from '../../shared/chatSettings';
import { segments } from '../../shared/chatText';
import { foldName, isChannel, sameName } from '../../shared/ircNames';
import type { ChatPaneView } from '../../shared/panes';
import { Caret, Gear, Info, People } from '../icons';
import type { Grab } from '../paneHeader';
import Tab from '../tab';
import ChatSettings from './ChatSettings';
import ChatUsers from './ChatUsers';
import { nickColour } from './nickColour';
import { openUserMenu } from './userMenu';

/*
 * .btn, .tab and .sunk are hand-written CSS carrying colour, size and padding,
 * so the few places that have to contradict them say so inline. A utility
 * class of equal specificity would be settled by stylesheet order rather than
 * by intent — and unlayered CSS beats Tailwind's layered utilities outright.
 */

/** The People and Info toggles: the tabs' 26px, hugging a glyph rather than taking `.tab`'s fixed square. */
const TOGGLE: CSSProperties = { height: 26, width: 'auto', paddingLeft: 6, paddingRight: 6 };

/** Plain words, not a state name: what is true right now and whether to wait. */
const STATUS_NOTE: Record<ChatStatus, string | null> = {
    offline: 'Not connected.',
    connecting: 'Connecting to chat…',
    registering: 'Signing in…',
    online: null,
    reconnecting: 'Connection dropped — reconnecting…'
};

/**
 * Never leave the panel looking like a quiet room when it is a shut one. The
 * region is always in the tree so a change to it is announced rather than
 * appearing silently; it collapses when there is nothing to say.
 *
 * `quiet` keeps offline to itself where something else already says it:
 * Settings' Connect button, under the reader's hand, or a room panel's own
 * Connect; and before a nick exists, offline is not news either. A real error
 * still gets through.
 */
function Status({ view, quiet }: { view: ChatView; quiet: boolean }): ReactNode {
    const note = quiet && view.status === 'offline' ? null : STATUS_NOTE[view.status];
    return (
        <div aria-live="polite" className="text-[12px] empty:hidden">
            {note !== null && <p className="text-dim">{note}</p>}
            {view.error !== null && <p className="text-warn">{view.error}</p>}
        </div>
    );
}

/**
 * A room as chat has it, found however the name is cased: a room panel's room
 * comes from its pane, which a setup can spell its own way. Null when chat
 * does not have the room at all.
 */
function findRoom(view: ChatView, room: string): ViewChannel | null {
    return view.channels.find(c => sameName(c.name, room)) ?? null;
}

function roomTitle(name: string): string {
    if (name === SERVER_LOG) return 'Messages from the server';
    return isChannel(name) ? name : `Private conversation with ${name}`;
}

/**
 * A tab's tooltip: what it is, and what its count is counting. Only a channel
 * says how many name you: everything said in a conversation with one person
 * is said to you, which is also why its count is always gold.
 */
function tabTitle(channel: ViewChannel): string {
    const title = roomTitle(channel.name);
    if (channel.unread === 0) return title;
    const named = channel.highlights > 0 && isChannel(channel.name) ? `, ${channel.highlights} ${channel.highlights === 1 ? 'names' : 'name'} you` : '';
    return `${title} — ${channel.unread} unread${named}`;
}

/** A date without the time, which nobody reading about a channel needs; the time is in its tooltip. */
function dateOnly(at: number): string {
    return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
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
 * The row of tabs: Settings, as a gear, then the rooms main lists for this
 * pane (`ChatPaneView.row`) — Status, then every channel and conversation in
 * the order it was opened, less any that has a panel of its own in this
 * window. The rooms never reorder — an unread count changes inside a tab that
 * stays put, and a row that reshuffles as people talk is a row you cannot aim
 * at.
 *
 * A count is gold when a line it counts is for you — it names you, or was said
 * to you alone — and cream when none is, so a tab that wants you reads
 * differently from one that is only busy.
 *
 * Every channel and conversation carries its own close, inside the tab, as
 * the window strip's tabs do: any of them may be closed, so there is no rule
 * about which to learn. Settings and Status have none, because neither is a
 * room you are in.
 *
 * A room's tab is also how it comes out of the row into a panel of its own:
 * dragged onto any pane's edge, it opens there, and a right-click offers Open
 * Right, Open Below and Open in New Tab. Main answers where a drop may land,
 * and builds the menu, as it does every pane menu. A press that never travels
 * is still a click, and opens the room in this pane. The gear does neither.
 *
 * They wrap onto as many rows as they need rather than shrinking: a wide pane
 * holds its usual handful on one row, and truncating "#2004scape" to "#20…"
 * when there are more would leave a row of tabs that all read the same.
 * `end` sits at the right of whichever row the last tab lands on.
 *
 * A group of buttons rather than a tablist, and every tab acts when pressed,
 * including the open one — see `role` in tab.tsx.
 */
function ChatTabs({
    view,
    pane,
    paneId,
    onSettings,
    grabRoom,
    end
}: {
    view: ChatView;
    pane: ChatPaneView;
    paneId: string;
    onSettings: boolean;
    grabRoom: (room: string) => Grab;
    end: ReactNode;
}): ReactNode {
    const { group, closing } = useCloseFocus(view.channels);
    return (
        <div ref={group} role="group" aria-label="Chat" className="flex min-w-0 flex-wrap items-center gap-[5px]">
            <Tab role="button" label="Chat settings" icon={<Gear />} open={onSettings} onSelect={() => void window.zanaris.chat.showPage(paneId, 'settings')} />
            {pane.row.map(name => {
                /* The row and the rooms arrive in one push, so a room is always found; a tab without one would still say what it is. */
                const channel = view.channels.find(c => c.name === name);
                const unread = channel?.unread ?? 0;
                const open = !onSettings && name === pane.room;
                return (
                    <Tab
                        key={name}
                        role="button"
                        label={roomLabel(name)}
                        title={channel === undefined ? roomTitle(name) : tabTitle(channel)}
                        open={open}
                        onSelect={() => void window.zanaris.chat.showRoom(paneId, name)}
                        grab={grabRoom(name)}
                        onContextMenu={event => {
                            event.preventDefault();
                            /* The pane's own menu is raised from the pane around this row, and a room's is the one asked for. */
                            event.stopPropagation();
                            void window.zanaris.chat.roomMenu(paneId, name, event.clientX, event.clientY);
                        }}
                        after={!open && unread > 0 ? <span className={`shrink-0 ${channel !== undefined && channel.highlights > 0 ? 'text-gold' : 'text-cream'}`}>{unread}</span> : null}
                        onClose={
                            channel?.closable
                                ? () => {
                                      /* Name what is about to go before asking for it, so the focus restore knows whose disappearance it is waiting on. */
                                      closing(name);
                                      void window.zanaris.chat.closeRoom(name);
                                  }
                                : undefined
                        }
                    />
                );
            })}
            {end !== null && <div className="ml-auto flex items-center gap-[5px]">{end}</div>}
        </div>
    );
}

/**
 * A button that shows or hides something in the log's space, worn as a tab:
 * lit while what it shows is showing, as an open tab is, so the row reads the
 * same whether a press opened a channel or a view.
 */
function Toggle({ label, on, onPress, children }: { label: string; on: boolean; onPress: () => void; children: ReactNode }): ReactNode {
    return (
        <button type="button" aria-pressed={on} title={label} aria-label={label} onClick={onPress} style={TOGGLE} className={`tab flex items-center gap-1 ${on ? 'tab-on' : 'text-dim'}`}>
            {children}
        </button>
    );
}

/**
 * A line's words, with its links and channel names made clickable: a link
 * opens in the system browser, and a channel joins it — which is how an
 * invite is accepted. The join is typed from the pane the words are in, as
 * though typed there, so a room panel opens the channel as /join would.
 */
function Words({ text, paneId }: { text: string; paneId: string }): ReactNode {
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
            <button key={i} type="button" title={`Join ${part.text}`} onClick={() => void window.zanaris.chat.send(paneId, `/join ${part.text}`)} className="link inline">
                {part.text}
            </button>
        );
    });
}

/** A speaker's name in the log, which opens the same menu as their row in the user list. */
function Speaker({ nick, colour, prefix = '', paneId, mention }: { nick: string; colour: string | undefined; prefix?: string; paneId: string; mention: (nick: string) => void }): ReactNode {
    return (
        <button type="button" onClick={event => openUserMenu(paneId, nick, event, mention)} style={{ color: colour }} className="inline hover:underline">
            {prefix}
            {nick}
        </button>
    );
}

/** The time down a log's left edge, with the full date in its tooltip. */
function Stamp({ at }: { at: number }): ReactNode {
    const when = new Date(at);
    return (
        <time dateTime={when.toISOString()} title={when.toLocaleString()} className="shrink-0 text-[12px] leading-[1.6] text-faint tabular-nums">
            {clockTime(at)}
        </time>
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
function Line({ line, self, paneId, mention }: { line: ChatLine; self: string | null; paneId: string; mention: (nick: string) => void }): ReactNode {
    const nick = line.nick;
    const colour = nick === null ? undefined : nickColour(nick, self);
    return (
        <div className={`flex gap-[7px] px-1 py-[2px] ${line.highlight ? 'bg-stone-lit/40 shadow-[inset_2px_0_0_var(--color-gold)]' : ''}`}>
            <Stamp at={line.at} />
            <div className="min-w-0 flex-1 wrap-break-word">
                {line.kind === 'system' || nick === null ? (
                    <span className="text-faint">
                        <Words text={line.text} paneId={paneId} />
                    </span>
                ) : line.kind === 'action' ? (
                    <>
                        <Speaker nick={nick} colour={colour} prefix="* " paneId={paneId} mention={mention} /> <Words text={line.text} paneId={paneId} />
                    </>
                ) : (
                    <>
                        {/* A private message with no conversation to go in — a /msg sent with none open, or one from someone new while every conversation slot is taken — sits in Status beside notices, so it says which it is. */}
                        {line.kind === 'private' && <span className="text-faint">pm </span>}
                        <Speaker nick={nick} colour={colour} paneId={paneId} mention={mention} /> <Words text={line.text} paneId={paneId} />
                    </>
                )}
            </div>
        </div>
    );
}

/**
 * A run of people coming and going, as one faint line saying how many of
 * each, with the time the run began. A press opens it to the lines it holds,
 * under it, and a second closes it again.
 */
function Fold({
    item,
    open,
    toggle,
    self,
    paneId,
    mention
}: {
    item: Extract<LogItem, { kind: 'fold' }>;
    open: boolean;
    toggle: () => void;
    self: string | null;
    paneId: string;
    mention: (nick: string) => void;
}): ReactNode {
    return (
        <div>
            <div className="flex gap-[7px] px-1 py-[2px]">
                <Stamp at={item.lines[0]!.at} />
                <button type="button" aria-expanded={open} title={open ? 'Hide who' : 'Show who'} onClick={toggle} className="group flex min-w-0 flex-1 items-center text-left">
                    <span className="min-w-0 text-faint group-hover:text-cream">{item.summary}</span>
                    {/* The menus' wedge, turned to point at the lines while they are folded away. */}
                    <span className="shrink-0 text-faint group-hover:text-cream" style={open ? undefined : { transform: 'rotate(-90deg)' }}>
                        <Caret compact />
                    </span>
                </button>
            </div>
            {open && item.lines.map(line => <Line key={line.id} line={line} self={self} paneId={paneId} mention={mention} />)}
        </div>
    );
}

/** Where what arrived while this room was out of sight begins: a gold rule, labelled, since a colour alone is no label. */
function NewDivider(): ReactNode {
    return (
        <div role="separator" aria-label="New since you were last here" className="my-1 flex items-center gap-2 px-1">
            <span className="h-px flex-1 bg-gold" />
            <span className="text-[12px] text-gold">New</span>
        </div>
    );
}

/**
 * What a channel is, in the log's place: its topic in full, with its links
 * live, and who set it; then how many are in it, its modes and when it was
 * made. It replaced a row above the log that the topic took from every
 * conversation, and a header over the user list that left a short pane a
 * name and a half. A channel with no topic shows only its facts.
 */
function ChannelInfo({ channel, paneId }: { channel: ViewChannel; paneId: string }): ReactNode {
    const topic = channel.topic;
    const count = channel.users.length;
    /* "+" alone is a channel the server said has no flags, which is not worth a mention. */
    const modes = channel.modes !== null && channel.modes !== '+' ? channel.modes : null;
    return (
        <section aria-label={`About ${channel.name}`} className="sunk min-h-0 min-w-0 flex-1 overflow-y-auto px-2.5 py-2 leading-[1.45]">
            {topic !== null && (
                <div className="mb-2.5">
                    <p className="text-[12px] text-dim">Topic</p>
                    <p className="wrap-break-word text-cream">
                        <Words text={topic.text} paneId={paneId} />
                    </p>
                    {topic.setBy !== null && (
                        <p className="text-[12px] text-dim" title={topic.setAt === null ? undefined : new Date(topic.setAt).toLocaleString()}>
                            Set by {topic.setBy}
                            {topic.setAt !== null && ` on ${dateOnly(topic.setAt)}`}
                        </p>
                    )}
                </div>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <dt className="text-dim">People</dt>
                <dd className="text-cream">{count}</dd>
                {modes !== null && (
                    <>
                        <dt className="text-dim">Modes</dt>
                        <dd className="text-cream">{modes}</dd>
                    </>
                )}
                {channel.createdAt !== null && (
                    <>
                        <dt className="text-dim">Created</dt>
                        <dd className="text-cream" title={new Date(channel.createdAt).toLocaleString()}>
                            {dateOnly(channel.createdAt)}
                        </dd>
                    </>
                )}
            </dl>
        </section>
    );
}

/**
 * The commands that could be meant by what is being typed, over the bottom
 * of the log's space. It is clamped to that space and scrolls inside it:
 * native views sit above the shell, so anything drawn past the pane's edge
 * would be under the game. A press on a row takes it without taking focus
 * from the box, which keeps the caret where the command goes.
 */
function CommandList({ id, menu, picked, pick, take }: { id: string; menu: CommandMenu; picked: number; pick: (index: number) => void; take: (command: CommandHelp) => void }): ReactNode {
    const list = useRef<HTMLUListElement | null>(null);
    useLayoutEffect(() => {
        list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    }, [picked, menu.typed]);
    return (
        <ul ref={list} id={id} role="listbox" aria-label="Commands" className="tile absolute inset-x-0 bottom-0 z-10 max-h-full overflow-y-auto py-1 text-[13px] leading-[1.45]">
            {menu.matches.map((command, i) => (
                <li
                    key={command.name}
                    id={`${id}-${command.name}`}
                    role="option"
                    aria-selected={i === picked}
                    onMouseEnter={() => pick(i)}
                    onMouseDown={event => {
                        event.preventDefault();
                        take(command);
                    }}
                    className={`flex min-w-0 gap-2 px-2 py-px ${i === picked ? 'bg-stone-lit' : ''}`}
                >
                    <span className="shrink-0 text-cream">
                        /{command.name}
                        {command.args !== '' && <span className="text-dim"> {command.args}</span>}
                    </span>
                    <span className="min-w-0 truncate text-dim">{command.about}</span>
                </li>
            ))}
        </ul>
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
 * What is half-typed in each room, by its folded name, so a line started in
 * one room stays there rather than following you into the next one and being
 * sent to it. For every chat pane and room panel in the window, and until the
 * window closes, as `sentLines` is, so a visit to Settings keeps it, and a
 * room taken out of the row into a panel takes its line with it. Two panes
 * typing in the same room share its one entry, so the one typed in last is
 * what the room keeps; one sending clears it for both.
 */
const drafts = new Map<string, string>();

/** What fills the log's space: the log, a channel's info, or, in a pane too narrow to put it beside the log, its user list. */
type Swap = 'log' | 'info' | 'users';

/**
 * The conversation in one room: the log, or what has been swapped in for it,
 * with the user list beside it, and the line you are typing. The same in a
 * chat pane and in a room panel: the room, its lines and its New divider are
 * the pane's (`ChatPaneView`), and what is typed goes to the room the pane
 * shows, which main reads for itself.
 *
 * The log and the composer are the same object at 320px wide and at 735px, so
 * they are written once; a second log would be a second set of scroll rules to
 * keep in step. What changes with the width is only where things go: the user
 * list, and in a narrow pane Send (`NARROW_BELOW`).
 */
function Conversation({
    view,
    room,
    lines,
    newFrom,
    paneId,
    wide,
    narrow,
    shown,
    sidebar,
    onSent,
    notice
}: {
    view: ChatView;
    room: string;
    lines: ChatLine[];
    newFrom: number | null;
    paneId: string;
    wide: boolean;
    narrow: boolean;
    shown: Swap;
    sidebar: boolean;
    onSent: () => void;
    /** Said just above the message box, about the room: a chat pane's word that we were kicked from it. */
    notice: ReactNode;
}): ReactNode {
    const listId = useId();
    const [draft, setDraft] = useState(() => drafts.get(foldName(room)) ?? '');
    const [caret, setCaret] = useState(draft.length);
    const [behind, setBehind] = useState(false);
    /* Which folds are open, by key. A different room is a different log, so they start closed there. */
    const [openFolds, setOpenFolds] = useState<ReadonlySet<number>>(() => new Set());
    /*
     * The box's text when the menu was closed without anything taken — by
     * Escape, or by the arrows bringing back a line sent, which would
     * otherwise open it on "/clear" and keep the arrows from going further
     * back. It stays closed until the text changes.
     */
    const [dismissed, setDismissed] = useState<string | null>(null);
    const [pick, setPick] = useState(0);
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

    /*
     * A different room brings its own draft, with the caret at its end, and
     * its folds closed. Set while rendering, so the other room's line is never
     * drawn in this one's box.
     *
     * Except when the room left has gone from chat and the one arriving was
     * not in chat when this pane last drew (`drawnWith`). A room that closes
     * or is parted puts its pane on a room chat already had — Status, or a
     * neighbour when Status has a panel of its own — so a room leaving and a
     * new one arriving in one step is a rename: the same conversation under
     * the new name its person took. Its draft moves with it and nothing else
     * changes. A room that closed takes its draft with it.
     */
    const [draftFor, setDraftFor] = useState(room);
    /* The rooms chat had when this pane last drew. Kept as each draw is committed, so the check below compares with what was on screen, not with a render React threw away. */
    const drawnWith = useRef(view.channels);
    useLayoutEffect(() => {
        drawnWith.current = view.channels;
    });
    if (draftFor !== room) {
        const gone = !view.channels.some(c => sameName(c.name, draftFor));
        const arrived = !drawnWith.current.some(c => sameName(c.name, room));
        const kept = drafts.get(foldName(draftFor));
        setDraftFor(room);
        if (gone) drafts.delete(foldName(draftFor));
        if (gone && arrived) {
            if (kept !== undefined) drafts.set(foldName(room), kept);
        } else {
            const next = drafts.get(foldName(room)) ?? '';
            setDraft(next);
            setCaret(next.length);
            setOpenFolds(new Set());
            setDismissed(null);
        }
    }

    const typedMenu = commandMenu(draft, caret);
    const menu = typedMenu !== null && dismissed !== draft ? typedMenu : null;
    /* A different word is a different list, whose first row is the one to offer. */
    const [pickFor, setPickFor] = useState<string | null>(null);
    if (pickFor !== (menu?.typed ?? null)) {
        setPickFor(menu?.typed ?? null);
        setPick(0);
    }
    const picked = menu === null ? 0 : Math.min(pick, menu.matches.length - 1);
    const hint = menu === null ? commandHint(draft) : null;

    /* A conversation with one person has no topic and no list of people: only a channel is a `channel` here. */
    const channel = isChannel(room) ? findRoom(view, room) : null;
    const person = room !== SERVER_LOG && !isChannel(room) ? room : null;
    /* Something swapped in for the log, which only a channel has. */
    const instead = channel === null ? 'log' : shown;

    const toBottom = (): void => {
        const el = log.current;
        stuck.current = true;
        setBehind(false);
        if (el) el.scrollTop = el.scrollHeight;
    };

    /* A different room is a different conversation, and coming back from the list or the info is coming back to it: start at its end. */
    useLayoutEffect(() => {
        completion.current = null;
        recalled.current = null;
        toBottom();
    }, [room, instead]);

    /*
     * Follow new lines only for a reader who was already at the bottom. Someone
     * who scrolled up is reading something, and yanking them to the end is how
     * chat windows lose an argument mid-sentence. They get told instead.
     */
    const last = lines.at(-1)?.id ?? 0;
    useLayoutEffect(() => {
        const el = log.current;
        if (!el) return;
        if (stuck.current) el.scrollTop = el.scrollHeight;
        else setBehind(true);
    }, [last, lines.length]);

    /*
     * And keep them at the end when the log's own box changes: the usage line
     * appearing under it, or the list shown beside it, takes room from the
     * bottom, and the latest line would sit hidden under the well's edge.
     */
    useLayoutEffect(() => {
        const el = log.current;
        if (!el) return;
        const watch = new ResizeObserver(() => {
            if (stuck.current) el.scrollTop = el.scrollHeight;
        });
        watch.observe(el);
        return () => watch.disconnect();
    }, [instead]);

    const onScroll = (): void => {
        const el = log.current;
        if (!el) return;
        stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_SLACK;
        if (stuck.current) setBehind(false);
    };

    /** Puts `next` in the box and keeps it as this room's draft. New text lifts a closed menu's closing. */
    const write = (next: string): void => {
        setDraft(next);
        if (next !== dismissed) setDismissed(null);
        const key = foldName(room);
        if (next === '') drafts.delete(key);
        else drafts.set(key, next);
    };

    const offline = view.status !== 'online';
    const send = (event: FormEvent): void => {
        event.preventDefault();
        const text = draft.trim();
        if (text === '') return;
        write('');
        setCaret(0);
        sentLines = remember(sentLines, text);
        completion.current = null;
        recalled.current = null;
        /* Speaking is a claim on the end of the log, wherever you had scrolled to. */
        stuck.current = true;
        setBehind(false);
        onSent();
        void window.zanaris.chat.send(paneId, text);
    };

    /** Puts the caret at `at` once React has written the box's new value. */
    const place = (at: number): void => {
        setCaret(at);
        requestAnimationFrame(() => box.current?.setSelectionRange(at, at));
    };

    /** A mention from someone's menu: their name to open the line, or at the end of what is already there. */
    const mention = (nick: string): void => {
        const next = draft.trim() === '' ? `${nick}: ` : `${draft.replace(/\s*$/, ' ')}${nick} `;
        write(next);
        completion.current = null;
        box.current?.focus();
        place(next.length);
    };

    /** A command from the menu, in place of the word being typed. */
    const take = (command: CommandHelp): void => {
        const next = takeCommand(draft, command);
        write(next.text);
        completion.current = null;
        recalled.current = null;
        place(next.caret);
    };

    /**
     * The menu's keys, while it is open: the arrows and shift-Tab move through
     * it rather than through what was sent, Tab takes a command, Enter takes
     * one unless what is typed is a whole command to send, and Escape closes
     * it. True when the key was the menu's.
     */
    const menuKey = (event: KeyboardEvent<HTMLInputElement>, open: CommandMenu): boolean => {
        const n = open.matches.length;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
            setPick((picked + (event.key === 'ArrowDown' ? 1 : n - 1)) % n);
            return true;
        }
        if (event.key === 'Tab' || (event.key === 'Enter' && !event.nativeEvent.isComposing && menuEnter(open) === 'take')) {
            take(open.matches[picked]!);
            return true;
        }
        if (event.key === 'Escape') {
            setDismissed(draft);
            return true;
        }
        return false;
    };

    const onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
        const el = event.currentTarget;
        if (menu !== null && menuKey(event, menu)) {
            event.preventDefault();
            return;
        }
        if (event.key === 'Tab') {
            const nicks = channel !== null ? channel.users.map(u => u.nick) : person !== null ? [person] : [];
            const channels = view.channels.map(c => c.name).filter(isChannel);
            const done = complete(el.value, el.selectionStart ?? el.value.length, { nicks, channels, commands: COMMANDS }, completion.current, event.shiftKey);
            /* Nothing to finish: Tab moves focus on, as it does everywhere else. */
            if (done === null) return;
            event.preventDefault();
            completion.current = done;
            write(done.text);
            place(done.caret);
            return;
        }
        if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.altKey && !event.metaKey && !event.shiftKey) {
            const step = recall(sentLines, recalled.current, el.value, event.key === 'ArrowUp' ? 'up' : 'down');
            if (step === null) return;
            event.preventDefault();
            recalled.current = step.at;
            completion.current = null;
            write(step.text);
            setDismissed(step.text);
            place(step.text.length);
        }
    };

    const items = foldLog(lines, newFrom);
    const toggleFold = (key: number): void => {
        const next = new Set(openFolds);
        if (!next.delete(key)) next.add(key);
        setOpenFolds(next);
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex min-h-0 flex-1 gap-[5px]">
                {/* The log's space. `relative` holds the command menu to it. */}
                <div className="relative flex min-h-0 min-w-0 flex-1">
                    {instead === 'users' && channel !== null ? (
                        <ChatUsers channel={channel} self={view.nick} paneId={paneId} mention={mention} className="min-w-0 flex-1" />
                    ) : instead === 'info' && channel !== null ? (
                        <ChannelInfo channel={channel} paneId={paneId} />
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
                            aria-label={room === SERVER_LOG ? 'Status' : person !== null ? `Conversation with ${person}` : `Conversation in ${room}`}
                            className="sunk flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-2 py-1.5 leading-[1.45]"
                        >
                            <div className="mt-auto">
                                {items.map((item, i) => {
                                    const first = item.kind === 'line' ? item.line : item.lines[0]!;
                                    return (
                                        <Fragment key={item.kind === 'line' ? `line-${item.line.id}` : `fold-${item.key}`}>
                                            {/* Above the first item it would mark nothing: the whole log is what is new. */}
                                            {i > 0 && first.id === newFrom && <NewDivider />}
                                            {item.kind === 'line' ? (
                                                <Line line={item.line} self={view.nick} paneId={paneId} mention={mention} />
                                            ) : (
                                                <Fold item={item} open={openFolds.has(item.key)} toggle={() => toggleFold(item.key)} self={view.nick} paneId={paneId} mention={mention} />
                                            )}
                                        </Fragment>
                                    );
                                })}
                                {lines.length === 0 && <p className="px-1 py-[2px] text-dim">{room === SERVER_LOG ? 'Nothing from the server yet.' : 'Nothing said here yet.'}</p>}
                            </div>
                        </div>
                    )}
                    {menu !== null && <CommandList id={listId} menu={menu} picked={picked} pick={setPick} take={take} />}
                </div>
                {/* 150px: a nick and its rank without truncating most of them, and little enough that the log keeps the pane. */}
                {wide && sidebar && channel !== null && <ChatUsers channel={channel} self={view.nick} paneId={paneId} mention={mention} className="w-[150px] shrink-0" />}
            </div>

            {behind && instead === 'log' && (
                <div>
                    {/* The size inline: `button { font: inherit }` is unlayered, and beats a text- utility. */}
                    <button type="button" onClick={toBottom} style={{ fontSize: 12 }} className="link">
                        Jump to latest
                    </button>
                </div>
            )}

            {notice}

            {/* How the command being typed is used, once its name is done and the menu has closed. */}
            {hint !== null && (
                <p className="truncate text-[12px]">
                    <span className="text-cream">
                        /{hint.name}
                        {hint.args !== '' && ` ${hint.args}`}
                    </span>
                    <span className="text-dim"> — {hint.about}</span>
                </p>
            )}

            {/*
             * Actions run along the bottom of a panel here, as they do in the
             * client's own interfaces. The box stops at 400 characters, but
             * what the server carries is bytes: main measures the line again
             * as the others will receive it, and refuses one too long with a
             * note saying so. Narrow, Send is under the box and as wide as
             * it, as Worlds' Refresh is: beside it at `PANE_MIN_WIDTH`, the
             * box had 32px.
             */}
            <form onSubmit={send} className={narrow ? 'flex flex-col gap-1.5' : 'flex items-center gap-1.5'}>
                <input
                    ref={box}
                    value={draft}
                    onChange={event => {
                        completion.current = null;
                        recalled.current = null;
                        setCaret(event.target.selectionStart ?? event.target.value.length);
                        write(event.target.value);
                    }}
                    onSelect={event => setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
                    onKeyDown={onKey}
                    aria-label="Message"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={menu !== null}
                    aria-controls={menu !== null ? listId : undefined}
                    aria-activedescendant={menu !== null ? `${listId}-${menu.matches[picked]!.name}` : undefined}
                    placeholder={offline ? 'Chat is not connected' : room === SERVER_LOG || channel?.kicked ? 'Type / for commands' : `Message ${room}, or / for commands`}
                    maxLength={400}
                    autoComplete="off"
                    spellCheck={false}
                    className={`sunk ${narrow ? '' : 'min-w-0 flex-1 '}px-[7px] py-[3px] font-sans text-[13px] text-cream placeholder:text-faint`}
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
 * The width below which a pane is too narrow for what Chat sets side by side
 * at every other width, and stacks it instead: Send goes under the message
 * box, and the Settings page goes without its well.
 *
 * Beside Send, the box has the pane less 88px: 112 here, a dozen or so
 * characters of the line being typed, and 32 at `PANE_MIN_WIDTH`. Around a
 * field, the well was 24px of every line of Settings, and its fields were cut
 * short below about 150. A pane knows its own width, so the shape is read from
 * it, as Worlds' is.
 */
const NARROW_BELOW = 200;

/**
 * What a pane shows in place of a room's log when there is none to show, and
 * the one thing that would give it one, when there is such a thing.
 */
function Waiting({ note, action }: { note: string; action?: { label: string; disabled?: boolean; press: () => void } }): ReactNode {
    return (
        <div className="sunk flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 px-3 py-2 text-center">
            <p className="text-dim">{note}</p>
            {action !== undefined && (
                <button type="button" disabled={action.disabled} onClick={action.press} className="btn btn-red shrink-0 disabled:opacity-60">
                    {action.label}
                </button>
            )}
        </div>
    );
}

/** Joins a channel from a pane, as though /join were typed there. */
function join(paneId: string, channel: string): void {
    void window.zanaris.chat.send(paneId, `/join ${channel}`);
}

/**
 * A channel we were kicked from, open in a chat pane: said above the message
 * box, which stays, since /part, /close and the rest still work from its tab,
 * and a line said aloud there is answered with how to go back. Join waits for
 * the connection, as Send does.
 */
function Kicked({ channel, paneId, online }: { channel: string; paneId: string; online: boolean }): ReactNode {
    return (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="min-w-0 text-dim">You're not in {channel}.</p>
            <button type="button" disabled={!online} onClick={() => join(paneId, channel)} className="btn shrink-0 disabled:opacity-60">
                Join
            </button>
        </div>
    );
}

/** How a pane is looking at its room: what fills the log's space, and whether a wide pane shows the user list beside it. */
interface Look {
    shown: Swap;
    sidebar: boolean;
    /** Whether the user list is on screen, beside the log or in its place, which is what People is lit for. */
    listShowing: boolean;
    togglePeople: () => void;
    toggleInfo: () => void;
    /** Back to the log: a line sent is a claim on the conversation. */
    toLog: () => void;
}

/**
 * A pane's own way of looking at its room, which People and Info change. A
 * different room brings the log back — you chose a room to read it.
 */
function useLook(room: string | null, wide: boolean): Look {
    const [swap, setSwap] = useState<Swap>('log');
    const [sidebar, setSidebar] = useState(true);
    /* Set while rendering, so the room you move to never draws a frame of the view the last one had open. */
    const [swapFor, setSwapFor] = useState(room);
    if (swapFor !== room) {
        setSwapFor(room);
        setSwap('log');
    }
    /* Wide, the list is beside the log, so a narrow pane's swap for it is the log again. */
    const shown: Swap = wide && swap === 'users' ? 'log' : swap;
    return {
        shown,
        sidebar,
        listShowing: wide ? sidebar : shown === 'users',
        togglePeople: () => (wide ? setSidebar(!sidebar) : setSwap(shown === 'users' ? 'log' : 'users')),
        toggleInfo: () => setSwap(shown === 'info' ? 'log' : 'info'),
        toLog: () => setSwap('log')
    };
}

/** People, with how many there are, and Info: a channel's two toggles, at the end of a chat pane's row or a room panel's top row. */
function RoomToggles({ channel, look }: { channel: ViewChannel; look: Look }): ReactNode {
    const count = channel.users.length;
    return (
        <>
            <Toggle label={`${count === 1 ? '1 person' : `${count} people`} in ${channel.name}`} on={look.listShowing} onPress={look.togglePeople}>
                <People />
                <span className="tabular-nums">{count}</span>
            </Toggle>
            <Toggle label={`About ${channel.name}`} on={look.shown === 'info'} onPress={look.toggleInfo}>
                <Info />
            </Toggle>
        </>
    );
}

/**
 * A room panel's top row, for a channel: its topic on one line, cut short
 * with the whole of it on hover, and People and Info at the right, where a
 * chat pane has them at the end of its row of tabs. In the panel's body
 * rather than its header, since a header names its pane and keeps none of
 * its work (`paneHeader.tsx`). With no topic the row holds the toggles alone;
 * Info has the rest of what a channel is.
 */
function TopicRow({ channel, paneId, look }: { channel: ViewChannel; paneId: string; look: Look }): ReactNode {
    const topic = channel.topic;
    return (
        <div className="flex min-w-0 items-center gap-[5px]">
            <p title={topic?.text} className="min-w-0 flex-1 truncate text-dim">
                {topic !== null && <Words text={topic.text} paneId={paneId} />}
            </p>
            <RoomToggles channel={channel} look={look} />
        </div>
    );
}

/**
 * A chat pane: the row of tabs, and under it Settings or the conversation in
 * the room the pane has open. Which page, which room and which rooms the row
 * lists are the pane's own, and main keeps all three: a press asks main to
 * change them, and the row is drawn as main sends it.
 *
 * With no nick yet, or no rooms at all, Settings is the page. A row left empty
 * because every room has a panel says so, with no message box: there is no
 * room for a line to go to.
 */
function ChatPane({ view, pane, paneId, wide, narrow, grabRoom }: { view: ChatView; pane: ChatPaneView; paneId: string; wide: boolean; narrow: boolean; grabRoom: (room: string) => Grab }): ReactNode {
    const onSettings = pane.page === 'settings' || view.needsNick || view.channels.length === 0;
    const look = useLook(pane.room, wide);
    const room = onSettings ? null : pane.room;
    const channel = room !== null && isChannel(room) ? findRoom(view, room) : null;
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
            <ChatTabs view={view} pane={pane} paneId={paneId} onSettings={onSettings} grabRoom={grabRoom} end={channel === null ? null : <RoomToggles channel={channel} look={look} />} />
            <Status view={view} quiet={onSettings || view.needsNick} />
            {onSettings ? (
                <ChatSettings view={view} wide={wide} narrow={narrow} onConnected={() => void window.zanaris.chat.showPage(paneId, 'chat')} />
            ) : room === null ? (
                <Waiting note="Every room has a panel of its own." />
            ) : (
                <Conversation
                    view={view}
                    room={room}
                    lines={pane.lines}
                    newFrom={pane.newFrom}
                    paneId={paneId}
                    wide={wide}
                    narrow={narrow}
                    shown={look.shown}
                    sidebar={look.sidebar}
                    onSent={look.toLog}
                    notice={channel?.kicked ? <Kicked channel={channel.name} paneId={paneId} online={view.status === 'online'} /> : null}
                />
            )}
        </div>
    );
}

/**
 * A room panel: one room, with no row of tabs. To see another room, you open
 * another panel.
 *
 * In place of the conversation, checked in this order: with no nick yet, a
 * way to Settings, in chat's pane, found or added; offline, Connect; and for a
 * channel we are not in, Join, whether we never joined it — from a setup, or
 * after /part — or were kicked from it. A panel never joins its room on its
 * own: rooms never follow windows. A channel we are not in shows Join and
 * nothing else — no log, no message box, no user list — because anything
 * typed or chosen in a pane is sent from the room it shows. Main refuses only
 * speech from a channel chat does not have, and a command typed there would
 * have chat make the room to answer it in. A conversation not open shows its
 * empty log, and the first line typed opens it again.
 *
 * Offline is said by the panel itself, beside Connect, so the status note
 * above keeps it quiet.
 */
function RoomPanel({ view, pane, room, paneId, wide, narrow }: { view: ChatView; pane: ChatPaneView; room: string; paneId: string; wide: boolean; narrow: boolean }): ReactNode {
    const look = useLook(room, wide);
    const channel = findRoom(view, room);
    /* Chat's spelling once it has the room, so the panel says what its tab would. */
    const name = channel?.name ?? room;
    const instead = view.needsNick ? (
        <Waiting note="Chat needs a nick before it can connect." action={{ label: 'Choose a nick', press: () => void window.zanaris.chat.showSettings() }} />
    ) : view.status === 'offline' ? (
        <Waiting note="Chat isn't connected." action={{ label: 'Connect', press: () => void window.zanaris.chat.connect() }} />
    ) : isChannel(room) && (channel === null || channel.kicked) ? (
        <Waiting note={`You're not in ${name}.`} action={{ label: 'Join', disabled: view.status !== 'online', press: () => join(paneId, name) }} />
    ) : null;
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
            {instead === null && channel !== null && isChannel(room) && <TopicRow channel={channel} paneId={paneId} look={look} />}
            <Status view={view} quiet />
            {instead ?? (
                <Conversation
                    view={view}
                    room={name}
                    lines={pane.lines}
                    newFrom={pane.newFrom}
                    paneId={paneId}
                    wide={wide}
                    narrow={narrow}
                    shown={look.shown}
                    sidebar={look.sidebar}
                    onSent={look.toLog}
                    notice={null}
                />
            )}
        </div>
    );
}

/**
 * The Chat tool: one connection, shared by every window this kit has open,
 * drawn as one of two things — a chat pane, with its row of tabs, or a room
 * panel, which is one room come out of that row (`ChatPaneView.panel`).
 *
 * What the connection knows — its rooms, their counts and topics, who is in
 * them, how it stands — is the same in every pane (`view`). What one pane
 * shows of it is that pane's own (`pane`): a chat pane's page, its open room
 * and the rooms its row lists, and either kind's room's lines. Main keeps all
 * of that, since a room is read only while a pane shows it, so two chat panes
 * can sit on two rooms, or one on Settings while the other follows the talk;
 * this only draws it and asks main to change it.
 *
 * What fills a pane's log's space, and whether a wide pane shows the user
 * list, are the pane's too, and kept here: People and Info change them. A
 * different room, or a line sent, brings the log back — you chose a room to
 * read it, and you spoke to be part of it.
 */
export default function Chat({ view, pane, width, paneId, grabRoom }: { view: ChatView; pane: ChatPaneView; width: number; paneId: string; grabRoom: (room: string) => Grab }): ReactNode {
    const wide = width >= WIDE_ENOUGH;
    const narrow = width < NARROW_BELOW;
    /* A panel always names its room; a null one would be a chat pane's empty row, and is drawn as one. */
    if (pane.panel && pane.room !== null) return <RoomPanel view={view} pane={pane} room={pane.room} paneId={paneId} wide={wide} narrow={narrow} />;
    return <ChatPane view={view} pane={pane} paneId={paneId} wide={wide} narrow={narrow} grabRoom={grabRoom} />;
}
