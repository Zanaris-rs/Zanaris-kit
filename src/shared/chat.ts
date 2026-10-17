/**
 * Chat types, shared by main and the shell.
 *
 * The app talks IRC on a public network, so everything here describes one
 * connection shared by every window: chat exists whether or not a game is
 * open, and closing a server window does not close the conversation.
 */

export type ChatStatus = 'offline' | 'connecting' | 'registering' | 'online' | 'reconnecting';

/** Where server notices and errors go, since they belong to no channel. The pane calls it Status. */
export const SERVER_LOG = '*';

/** What the shell calls a room on its tab, and on its tab while it is dragged out: Status for `SERVER_LOG`, and its own name for the rest. */
export function roomLabel(room: string): string {
    return room === SERVER_LOG ? 'Status' : room;
}

/** Someone else joining, leaving, quitting or changing name in a channel. */
export type Presence = 'join' | 'part' | 'quit' | 'nick';

export interface ChatLine {
    /** Monotonic within a run; the shell keys on it and never derives meaning from it. */
    id: number;
    /** A channel name, or SERVER_LOG. */
    channel: string;
    kind: 'say' | 'action' | 'system' | 'private';
    /** Null for system lines, which have no speaker. */
    nick: string | null;
    text: string;
    /** When the line arrived, in epoch milliseconds. The pane prints it beside the line. */
    at: number;
    /** The line names you, which the chat pane picks out with a gold edge. */
    highlight: boolean;
    /**
     * The line is churn — someone else coming, going or renamed in a channel —
     * which the log folds into one line when it comes in a run. Absent on
     * every other line, a kick and anything in a private conversation included.
     */
    presence?: Presence;
}

/** Someone in a channel. */
export interface ChatUser {
    nick: string;
    /** The rank symbols they hold, highest first — "@+" for an op who is also voiced, "" for nobody in particular. */
    prefixes: string;
}

export interface ChatTopic {
    /** With the colour and bold codes stripped. */
    text: string;
    /** Who set it, when the server said. */
    setBy: string | null;
    /** When it was set, in epoch milliseconds, when the server said. */
    setAt: number | null;
}

/** What IrcClient knows about a room, on its own. */
export interface ChatChannel {
    name: string;
    /** Highest rank first, then by name, as the server last reported them. */
    users: ChatUser[];
    /**
     * Lines worth reading that arrived while this room was not being read:
     * while no window had its lines on screen (`ChatSight.reading`), in a
     * chat pane on its conversation page or in a room panel.
     */
    unread: number;
    /**
     * Lines for you — naming you, or said to you alone — since this room last
     * came on screen or went off it (`ChatSight.reading`). While there are
     * any, its unread count is drawn in gold.
     */
    highlights: number;
    topic: ChatTopic | null;
    /** The channel's flags as "+nt", letters only — a key is not for showing. Null until the server has said. */
    modes: string | null;
    /** When the channel was created, in epoch milliseconds. Null until the server has said. */
    createdAt: number | null;
    /** We were kicked from this channel and have not rejoined: it is listed to say why, and we are not in it. */
    kicked: boolean;
}

/** What the shell is shown: everything the client knows, plus what only ChatService can add. */
export interface ViewChannel extends ChatChannel {
    /** Any channel or conversation may be closed; the Status log may not, since it is where the server talks to you. */
    closable: boolean;
}

/** What the Settings tab shows as saved. Never the password itself: the renderer does not get it back. */
export interface ChatSettingsView {
    /**
     * The nick chosen in Settings, which is what the next launch registers with.
     * Not always `ChatView.nick`: that is the connection's, which a taken nick,
     * a typed /nick or a services rename can make something else for a while.
     */
    nick: string | null;
    autoJoin: string[];
    /** Nicks whose messages are dropped unseen. */
    ignore: string[];
    /** Whether mentions and private messages raise system notifications while the kit is in the background: a few seconds apart at the least, so a flood raises one. */
    notify: boolean;
    hasPassword: boolean;
    /** Whether a password given now outlives this run. False where the OS has no secure store to keep it in. */
    canSavePassword: boolean;
}

/**
 * A line for you that nobody has seen: one that names you, or was said to you
 * alone, since its room was last on screen in any window — its lines in a
 * pane or a panel, or its tab in a row (`ChatSight`) — and that its room still
 * counts (`ChatChannel.highlights`). The game pane's header shows it.
 */
export interface ChatPing {
    /** The newest of them. */
    line: ChatLine;
    /** Said to you alone, in a conversation or in Status, rather than naming you in a room. */
    private: boolean;
    /** How many more are waiting besides it. */
    more: number;
}

/**
 * What one chat pane shows: its Settings page or the conversation. Each
 * pane's own, and kept in main. A pane on Settings shows no room and lists
 * no row, so it adds nothing to what its window shows of chat (`ChatSight`).
 * A room panel is always on its conversation.
 */
export type ChatPage = 'settings' | 'chat';

/**
 * What one window's front tab shows of chat, which the client counts rooms
 * by. Each window reports its own, and chat takes the union of them.
 *
 * - `reading`: the rooms whose lines are on screen — each chat pane's room on
 *   its conversation page, and each room panel's. A pane on its Settings page
 *   shows no room and adds none.
 * - `rowed`: every room in a row of tabs that is on screen, whether or not a
 *   pane is showing it, so a ping in a room whose tab is in view is seen. The
 *   whole row when any chat pane is on its conversation page, none otherwise.
 */
export interface ChatSight {
    reading: string[];
    rowed: string[];
}

/** One room's lines, and where its New divider goes: the part of the chat view that is a pane's rather than the connection's. */
export interface ChatLog {
    lines: ChatLine[];
    /**
     * The id of the first line that arrived in this room since it was last
     * left, when anything counted as unread did: the log draws a New divider
     * above it. Null otherwise. Set as the room comes on screen, kept while
     * it stays there, and cleared as it goes.
     */
    newFrom: number | null;
}

/**
 * What every chat pane and room panel is shown of the connection: its rooms,
 * the ping and how it stands. No room's lines are here, since which room a
 * pane shows is the pane's: each is sent its own room's log (`ChatLog`).
 */
export interface ChatView {
    status: ChatStatus;
    nick: string | null;
    channels: ViewChannel[];
    /** The newest line for you whose room no window has had on screen since, from any room, or null (`ChatPing`). */
    ping: ChatPing | null;
    /**
     * Why the connection failed, or why the server turned it away, in words
     * for a player; what the socket itself said is in Status. A chat pane
     * shows it under its tabs, whichever page is open.
     */
    error: string | null;
    /** True until a nick is chosen. A chat pane opens on Settings instead of a log. */
    needsNick: boolean;
    settings: ChatSettingsView;
}

/** Where chat connects, as whom, and what it joins. The defaults are SwiftIRC over TLS. */
export interface ChatSettings {
    nick: string | null;
    server: string;
    port: number;
    /** Joined on every connect. Edited only in Settings: closing a tab or typing /join lasts for the session. */
    autoJoin: string[];
    /** Whether launch connects. Pressing Disconnect clears it, and Connect sets it again. */
    autoConnect: boolean;
    /** Nicks whose messages are dropped unseen. Written by Settings and by /ignore and /unignore. */
    ignore: string[];
    /** Whether mentions and private messages raise system notifications while the kit is in the background: a few seconds apart at the least, so a flood raises one. */
    notify: boolean;
}

export const DEFAULT_AUTO_JOIN: readonly string[] = ['#2004scape', '#LostHQ', '#Zanaris'];

export const DEFAULT_CHAT: ChatSettings = {
    nick: null,
    server: 'irc.swiftirc.net',
    port: 6697,
    autoJoin: [...DEFAULT_AUTO_JOIN],
    autoConnect: true,
    ignore: [],
    notify: true
};
