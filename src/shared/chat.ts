/**
 * Chat types, shared by main and the shell.
 *
 * The app talks IRC on a public network, so everything here describes one
 * connection shared by every window: chat exists whether or not a game is
 * open, and closing a server window does not close the conversation.
 */

import { DOCK_HEIGHT_DEFAULT } from './layout.ts';

export type ChatStatus = 'offline' | 'connecting' | 'registering' | 'online' | 'reconnecting';

/** Where chat lives: the bottom dock, or the side column with the other tools. */
export type ChatHome = 'bottom' | 'side';

/** Where server notices and errors go, since they belong to no channel. */
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
    at: number;
    /** The line names you. Drives the unread count that badges the rail. */
    highlight: boolean;
}

export interface ChatChannel {
    name: string;
    /** Sorted, as the server last reported them. */
    nicks: string[];
    unread: number;
    highlights: number;
}

/** What the Chat panel draws. Lines are for the active channel only. */
export interface ChatView {
    status: ChatStatus;
    nick: string | null;
    channels: ChatChannel[];
    active: string;
    lines: ChatLine[];
    /** Set when the connection failed; the panel shows it rather than an empty log. */
    error: string | null;
    /** True until a nick is chosen. The panel asks for one instead of a log. */
    needsNick: boolean;
}

/** Where chat connects. The defaults are SwiftIRC over TLS. */
export interface ChatSettings {
    nick: string | null;
    server: string;
    port: number;
    dock: ChatHome;
    dockHeight: number;
}

export const DEFAULT_CHAT: ChatSettings = { nick: null, server: 'irc.swiftirc.net', port: 6697, dock: 'bottom', dockHeight: DOCK_HEIGHT_DEFAULT };

/** Everyone shares this one, whatever server their windows are on. */
export const LOBBY = '#LostHQ';
