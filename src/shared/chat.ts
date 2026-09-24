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
    unread: number;
    highlights: number;
    topic: ChatTopic | null;
    /** The channel's flags as "+nt", letters only — a key is not for showing. Null until the server has said. */
    modes: string | null;
    /** When the channel was created, in epoch milliseconds. Null until the server has said. */
    createdAt: number | null;
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
    /** Whether a mention or a private message raises a system notification while the kit is in the background. */
    notify: boolean;
    hasPassword: boolean;
    /** Whether a password given now outlives this run. False where the OS has no secure store to keep it in. */
    canSavePassword: boolean;
}

/** What the Chat panel draws. Lines are for the active channel only. */
export interface ChatView {
    status: ChatStatus;
    nick: string | null;
    channels: ViewChannel[];
    active: string;
    lines: ChatLine[];
    /** Set when the connection failed; the panel shows it rather than an empty log. */
    error: string | null;
    /** True until a nick is chosen. The panel opens on Settings instead of a log. */
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
    /** Whether a mention or a private message raises a system notification while the kit is in the background. */
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
