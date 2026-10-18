import { SERVER_LOG, type ChatChannel, type ChatPage, type ChatSight } from '../shared/chat.ts';
import { isNick } from '../shared/chatSettings.ts';
import { foldName, isChannel, sameName } from '../shared/ircNames.ts';
import { parseInput } from './chat/protocol.ts';
import { contentOf, paneIds, setContent, type Fitted, type PaneContent, type PaneNode } from './paneTree.ts';
import type { TabSet } from './tabs.ts';

/**
 * The rules for chat panes and room panels, which `serverWindow`, `paneHost`
 * and `index.ts` ask: which rooms a chat pane lists, which one it shows,
 * where it steps aside to, what a window's front tab shows of chat, where
 * chat opens on a room, where a typed line may go, and how all of it follows
 * a conversation to a new nick.
 *
 * Two kinds of pane hold the chat tool. A **chat pane** has a row of tabs, one
 * for each room chat has, and shows one of them, or its Settings page. A
 * **room panel** (`PaneContent.room`) has one room and no row, and that room
 * is in its content. Rooms are IRC names, so every comparison here folds
 * (`ircNames`) and nothing here changes how a name is spelled.
 *
 * Pure, like `tabs` and `paneTree`: the corners here are the ones a person
 * finds, and none of the three has tests to find them with.
 */

/** What main keeps for each chat pane: the page it is on, and the room it shows on its conversation. */
export interface ChatPaneState {
    page: ChatPage;
    /** Null only when the row is empty, because every room has a panel or chat has none. */
    room: string | null;
}

type ChatContent = Extract<PaneContent, { kind: 'tool' }>;

function holdsChat(content: PaneContent | null): content is ChatContent {
    return content?.kind === 'tool' && content.tool === 'chat';
}

/** A room panel's room. Null for anything else, a chat pane included. */
export function roomOf(content: PaneContent | null): string | null {
    return holdsChat(content) && content.room !== undefined ? content.room : null;
}

/**
 * The rooms with a panel in any of a window's tabs, each once, as the first
 * panel spells it, in the order they are first met. A room's panel is in the
 * window it was put in: another window's chat panes still list that room.
 */
export function panelledRooms(trees: readonly PaneNode[]): string[] {
    const rooms: string[] = [];
    const seen = new Set<string>();
    for (const tree of trees) {
        for (const id of paneIds(tree)) {
            const room = roomOf(contentOf(tree, id));
            if (room === null || seen.has(foldName(room))) continue;
            seen.add(foldName(room));
            rooms.push(room);
        }
    }
    return rooms;
}

/**
 * The tabs a window's chat panes list: every room chat has, in chat's order
 * (Status first, then join order), less the ones with a panel in this window.
 */
export function rowOf(channels: readonly string[], panelled: readonly string[]): string[] {
    const taken = new Set(panelled.map(foldName));
    return channels.filter(channel => !taken.has(foldName(channel)));
}

/**
 * The row's spelling of a room, found however it is cased, or null when the
 * row does not list it: chat lacks it, or it has a panel in this window. A
 * room put on a chat pane is first looked up here, so the pane holds chat's
 * spelling and never a room its row cannot show.
 */
export function rowRoom(row: readonly string[], room: string): string | null {
    return row.find(listed => sameName(listed, room)) ?? null;
}

/**
 * The room a new chat pane starts on: the room last picked in any chat pane,
 * in any window, when this row has it. Otherwise the first room in the row
 * that is not Status, which a person came to chat for, then Status, then
 * nothing for an empty row.
 *
 * Answers the row's spelling of the room, since that is chat's.
 */
export function freshRoom(row: readonly string[], last: string | null): string | null {
    if (last !== null) {
        const picked = row.find(room => sameName(room, last));
        if (picked !== undefined) return picked;
    }
    return row.find(room => room !== SERVER_LOG) ?? (row.includes(SERVER_LOG) ? SERVER_LOG : null);
}

/**
 * Where a chat pane on `room` goes once the row is `row`: where it was if the
 * row still has it, and otherwise somewhere it can be.
 *
 * - A room chat no longer has, because it was closed or parted, lands on
 *   Status, or on the row's first room when Status has a panel. A rename is
 *   the one other way a room leaves `view.channels`, and the renderer moves a
 *   draft along with a pane whose old room has gone and whose new room chat
 *   did not have when the pane last drew (`Conversation`). Either place a
 *   closed room lands is one chat already had, so its draft stays behind.
 * - A room chat still has but a panel took lands on the next room after it
 *   in chat's order that the row has, or failing that the nearest one before.
 *
 * Null for an empty row.
 */
function stepAside(room: string, channels: readonly string[], row: readonly string[]): string | null {
    if (row.some(r => sameName(r, room))) return room;
    const at = channels.findIndex(channel => sameName(channel, room));
    if (at < 0) return row.includes(SERVER_LOG) ? SERVER_LOG : (row[0] ?? null);
    const listed = new Set(row.map(foldName));
    for (let i = at + 1; i < channels.length; i++) if (listed.has(foldName(channels[i]!))) return channels[i]!;
    for (let i = at - 1; i >= 0; i--) if (listed.has(foldName(channels[i]!))) return channels[i]!;
    return null;
}

/**
 * Each chat pane's page and room, across every tab.
 *
 * A pane keeps what it had, except that a room that has left its row steps
 * aside (`stepAside`), and a pane with no room takes `fresh()`'s once the row
 * has one again. A pane new since the last call gets `fresh()`'s state, and
 * `fresh` is asked at most once however many panes want it. It is trusted
 * to answer a room in the row (`freshRoom`).
 *
 * A pane that is no longer a chat pane drops out, whether it holds another
 * tool now or has become a room panel, so chat put back in it starts afresh.
 * A pane's id survives a drag (`paneTree.movePane`), so its state goes with
 * it. Room panels never appear: their room is in their content. `channels`
 * is chat's whole list in its order and `panelled` is this window's
 * (`panelledRooms`).
 */
export function chatPanes(
    trees: readonly PaneNode[],
    known: ReadonlyMap<string, ChatPaneState>,
    channels: readonly string[],
    panelled: readonly string[],
    fresh: () => ChatPaneState
): Map<string, ChatPaneState> {
    const row = rowOf(channels, panelled);
    const panes = new Map<string, ChatPaneState>();
    let fresher: ChatPaneState | null = null;
    const newest = (): ChatPaneState => (fresher ??= fresh());
    for (const tree of trees) {
        for (const id of paneIds(tree)) {
            const content = contentOf(tree, id);
            if (!holdsChat(content) || roomOf(content) !== null) continue;
            const was = known.get(id);
            if (was === undefined) {
                panes.set(id, { ...newest() });
                continue;
            }
            const room = was.room === null ? (row.length > 0 ? newest().room : null) : stepAside(was.room, channels, row);
            panes.set(id, room === was.room ? was : { page: was.page, room });
        }
    }
    return panes;
}

/**
 * What a tab shows of chat, which for the tab in front is what is being read.
 *
 * - `reading`: the room of every chat pane on its conversation page, and the
 *   room of every room panel, each once. A chat pane on its Settings page
 *   shows no room and adds none, and one whose state is not known is not
 *   taken to show anything.
 * - `rowed`: the whole `row` when any chat pane is on its conversation page,
 *   and nothing otherwise. Its tabs are in view, so a ping in any of them is
 *   one the player can see. A room panel has no row.
 */
export function chatSight(tree: PaneNode, panes: ReadonlyMap<string, ChatPaneState>, row: readonly string[]): ChatSight {
    const reading: string[] = [];
    const seen = new Set<string>();
    let rowed = false;
    for (const id of paneIds(tree)) {
        const content = contentOf(tree, id);
        if (!holdsChat(content)) continue;
        let room = roomOf(content);
        if (room === null) {
            const state = panes.get(id);
            if (state === undefined || state.page !== 'chat') continue;
            rowed = true;
            room = state.room;
        }
        if (room === null || seen.has(foldName(room))) continue;
        seen.add(foldName(room));
        reading.push(room);
    }
    return { reading, rowed: rowed ? [...row] : [] };
}

/**
 * The tab and pane of the panel for a room, the first in tab order when
 * there are two, or null when it has none. What a ping or a click on a
 * notification goes to before it looks for a chat pane.
 */
export function panelFor(tabs: readonly { id: string; tree: PaneNode }[], room: string): { tabId: string; paneId: string } | null {
    for (const tab of tabs) {
        for (const paneId of paneIds(tab.tree)) {
            const panelRoom = roomOf(contentOf(tab.tree, paneId));
            if (panelRoom !== null && sameName(panelRoom, room)) return { tabId: tab.id, paneId };
        }
    }
    return null;
}

/**
 * Where chat opens in one window, and on what (`chatTarget`).
 *
 * - `panel`: the room's panel, its tab to be brought to the front and the
 *   panel focused.
 * - `pane`: a chat pane already there, put on `state`.
 * - `add`: a chat pane to add, which starts on `state`.
 *
 * `picked` is the row's spelling of the room asked for, when the chat pane
 * is put on it, and null when the pane keeps the room it was on or starts on
 * one nobody asked for.
 */
export type ChatTarget =
    | { kind: 'panel'; tabId: string; paneId: string }
    | { kind: 'pane'; paneId: string; state: ChatPaneState; picked: string | null }
    | { kind: 'add'; state: ChatPaneState; picked: string | null };

/**
 * Where chat opens on `room` and `page` in one window: for the game header's
 * ping, a click on a notification, a room panel's button that opens chat's
 * Settings, and a room a line typed in a pane opened (`/join`, `/query`,
 * Message in the user menu). Asked in this order:
 *
 * 1. `typedIn`, the pane the line was typed in, when it is a chat pane whose
 *    row lists the room: that pane, on the room.
 * 2. For the conversation page, the room's panel in any of the window's
 *    tabs, the first in tab order (`panelFor`). A room with a panel here is
 *    not in this window's row, so no chat pane could show it.
 * 3. The first chat pane in the tab in front: on `page`, and on the room
 *    when its row lists it. Otherwise it keeps the room it was on, which is
 *    what a null `room` asks for.
 * 4. Otherwise a chat pane to add, on `page` and on the room when the row
 *    lists it, or on `freshRoom`'s when not. It starts there rather than
 *    being put there once it is in: the first state it went out in would
 *    otherwise show the room a new pane starts on, read it, and leave it at
 *    the next, so that room would lose its count and its New divider
 *    without ever being on screen.
 *
 * `panes` is every chat pane's state, just brought up to date
 * (`chatPanes`), and `row` this window's (`rowOf`).
 */
export function chatTarget(ask: {
    room: string | null;
    page: ChatPage;
    typedIn: string | null;
    tabs: readonly { id: string; tree: PaneNode }[];
    front: PaneNode;
    panes: ReadonlyMap<string, ChatPaneState>;
    row: readonly string[];
    last: string | null;
}): ChatTarget {
    const { room, page, typedIn, panes, row } = ask;
    const picked = room === null ? null : rowRoom(row, room);
    if (typedIn !== null && picked !== null && panes.has(typedIn)) return { kind: 'pane', paneId: typedIn, state: { page, room: picked }, picked };
    if (room !== null && page === 'chat') {
        const panel = panelFor(ask.tabs, room);
        if (panel !== null) return { kind: 'panel', ...panel };
    }
    const shown = paneIds(ask.front).find(id => {
        const content = contentOf(ask.front, id);
        return holdsChat(content) && roomOf(content) === null;
    });
    if (shown !== undefined) {
        const was = panes.get(shown)?.room ?? freshRoom(row, ask.last);
        return { kind: 'pane', paneId: shown, state: { page, room: picked ?? was }, picked };
    }
    return { kind: 'add', state: { page, room: picked ?? freshRoom(row, ask.last) }, picked };
}

/**
 * The set with every room panel for `from` now for `to`: a conversation
 * following its person to a new nick. Chat panes and the other rooms' panels
 * are left alone, and `set` itself comes back when nothing changed, so a
 * caller can tell by identity whether anything moved.
 */
export function renameRoom(set: TabSet, from: string, to: string): TabSet {
    let moved = false;
    const tabs = set.tabs.map(tab => {
        const tree = renameRoomIn(tab.tree, from, to);
        if (tree === tab.tree) return tab;
        moved = true;
        return { ...tab, tree };
    });
    return moved ? { ...set, tabs } : set;
}

/** One tree with every room panel for `from` now for `to`: `renameRoom`'s rule for one tab. The tree itself when nothing changed. */
export function renameRoomIn(tree: PaneNode, from: string, to: string): PaneNode {
    let renamed = tree;
    for (const paneId of paneIds(tree)) {
        const content = contentOf(tree, paneId);
        const room = roomOf(content);
        if (!holdsChat(content) || room === null || room === to || !sameName(room, from)) continue;
        renamed = setContent(renamed, paneId, { ...content, room: to });
    }
    return renamed;
}

/**
 * A tab's fit (`paneTree.refit`) carried across a rename that turned the
 * tab's tree `was` into `now`.
 *
 * A rename is chat's, not a gesture of the player's. Left to `refit`, the
 * renamed tree would read as a gesture made on the tree on screen, and become
 * the arrangement a resize is fitted from, so a window shrunk past the
 * panes' floors would keep the game at the size it was squeezed to. So the
 * arrangement is renamed too, and `now` is what the fit showed. A fit that
 * did not show `was` is handed back as it was: the next layout fits whatever
 * changed since as the gesture it was.
 */
export function renamedFit(fit: Fitted, was: PaneNode, now: PaneNode, from: string, to: string): Fitted {
    if (now === was || fit.shown !== was) return fit;
    return { ...fit, base: renameRoomIn(fit.base, from, to), shown: now };
}

/** `to` when `room` is `from`, however either is cased, and `room` otherwise: one name, after a conversation follows its person to a new nick. */
export function renamedRoom(room: string, from: string, to: string): string {
    return sameName(room, from) ? to : room;
}

/**
 * Every chat pane on the conversation `from` now on `to`, each on the page
 * it was on: the chat panes' half of a conversation following its person to
 * a new nick, as `renameRoom` is the room panels'. Applied when chat says
 * so, before the panes are next reconciled against chat's rooms, so a pane
 * on the conversation stays on it rather than stepping aside from a name
 * chat no longer has. A new map: the one handed in is left alone.
 */
export function renamePaneRooms(panes: ReadonlyMap<string, ChatPaneState>, from: string, to: string): Map<string, ChatPaneState> {
    const renamed = new Map<string, ChatPaneState>();
    for (const [id, state] of panes) {
        const room = state.room === null ? null : renamedRoom(state.room, from, to);
        renamed.set(id, room === state.room ? state : { page: state.page, room });
    }
    return renamed;
}

/**
 * What a window last showed of chat, with the conversation `from` named `to`.
 * Main keeps each window's last sight, and chat is told the union of them
 * again before any window has sent a new one: under the old name, the
 * conversation would read as gone from the screen, and lose its place.
 */
export function renameSight(sight: ChatSight, from: string, to: string): ChatSight {
    return { reading: sight.reading.map(room => renamedRoom(room, from, to)), rowed: sight.rowed.map(room => renamedRoom(room, from, to)) };
}

/**
 * What every window shows of chat, together, which is what chat counts rooms
 * by: each room once in `reading` and once in `rowed`, as the first window to
 * name it spells it, in the order they are first met.
 */
export function unionSight(sights: Iterable<ChatSight>): ChatSight {
    const all = [...sights];
    return { reading: eachOnce(all.flatMap(sight => sight.reading)), rowed: eachOnce(all.flatMap(sight => sight.rowed)) };
}

/** Each name once, however it is cased, as it is first spelled, in the order first met. */
function eachOnce(rooms: readonly string[]): string[] {
    const seen = new Set<string>();
    return rooms.filter(room => {
        const key = foldName(room);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Whether a line typed in a pane on `at` goes to chat as typed there.
 *
 * Every line does, but one said aloud — a line of text, or `/me` — in a
 * channel chat does not have at all: a room panel's for a room we never
 * joined, or left. That would be a PRIVMSG into a room we are not in, and
 * its echo would open a tab for it besides. A command goes, `/join` above
 * all, which is what such a panel's Join sends. A channel we were kicked
 * from is still one chat has, listed to say why, so everything goes there:
 * `/part` and `/close` close its tab, and the client answers anything said
 * there by saying how to go back (`IrcClient.speak`). Anything that is not
 * a room at all takes nothing.
 */
export function maySend(at: string, text: string, channels: readonly Pick<ChatChannel, 'name'>[]): boolean {
    if (at === SERVER_LOG || channels.some(channel => sameName(channel.name, at))) return true;
    if (!isChannel(at)) return isNick(at);
    const kind = parseInput(text)?.kind;
    return kind !== 'say' && kind !== 'action';
}
