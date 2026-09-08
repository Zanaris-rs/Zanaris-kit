import type { ChatSettings, ChatView } from '../shared/chat.ts';
import { foldName, sameName } from './chat/protocol.ts';

/**
 * Which of a chat view belongs in the profile.
 *
 * Two persisted chat fields follow the connection rather than a control the
 * user operated: the nick, which the server can refuse and can rename, and the
 * rooms joined by hand. `ClientOpts` has no callback for either, so `index.ts`
 * learns both by watching the view it already subscribes to — one rule
 * covering /nick, /join, /part, the close control and a server-forced rename,
 * where hooking each command would be five rules, and the ones the server can
 * overrule would write what was asked for rather than what happened.
 *
 * Nothing here waits for a value to be certain before writing it: the nick the
 * prompt chose is written while the connection is still opening, because a
 * first nick has to survive a server that never answers. Correctness comes
 * from writing again when the truth arrives — which is what watching the view
 * rather than the command makes possible — and, where a later write could
 * never undo the damage, from the guards below.
 *
 * The view changes on every message and `AppState.save()` rewrites the whole
 * profile, so the question "is this view worth a write?" is worth asking
 * carefully — and worth asking here, where `npm test` can reach it, rather
 * than in `index.ts`, where nothing can.
 */

/** The fields of ChatSettings this observation owns; the rest are set by a control rather than learnt from the wire. */
export type PersistedChat = Pick<ChatSettings, 'nick' | 'rooms'>;

/**
 * Whether this view's nick is worth writing over the stored one.
 *
 * During registration, `IrcClient` answers a 433 by appending an underscore
 * and claiming the result before the server has said yes, and it does not put
 * the name back when it gives up. Persisting that claim is how a working nick
 * is lost for good: the refused name is what the next launch registers with,
 * so it is refused again, and the profile gains an underscore on every cold
 * start.
 *
 * So a stored nick is replaced only by one the connection actually reached
 * `online` with. The exception is a profile holding no nick at all — the
 * prompt's own case, which must be written even while the server is
 * unreachable, or a first nick chosen offline would be forgotten. That is also
 * the one state with nothing to lose.
 *
 * This fences the cascade where it used to compound: at registration, which is
 * where a cold launch's refusal lands. A 433 answering a /nick on a live
 * connection no longer claims anything at all — `IrcClient` reports the
 * refusal and leaves the working nick untouched — so the view does not even
 * change, and there is nothing left here for this guard to catch on that path.
 */
function nickWorthWriting(stored: PersistedChat, view: ChatView): boolean {
    if (view.nick === stored.nick) return false;
    return stored.nick === null || view.status === 'online';
}

/**
 * The rooms to store, given what is stored now.
 *
 * The hand-joined ones come from the `closable` the service stamps on every
 * channel the shell sees — the same flag that draws the close control, so what
 * is persisted and what may be closed cannot come apart, and no second
 * derivation of "the user's own rooms" exists to disagree with the service's.
 *
 * A stored room that is no longer closable is kept while it is still a
 * channel. Opening a window whose server owns that room absorbs it into the
 * auto set, where it is still joined and still the user's — only no longer
 * theirs to close — and dropping it there would lose a room to an act that was
 * not about it. A room the user really did close leaves the channel list
 * altogether, which is what tells the two apart without a second list.
 */
export function persistedRooms(stored: string[], view: ChatView): string[] {
    const rooms: string[] = [];
    for (const room of stored) {
        // A hand-edited file can name the same room twice; one of them is enough.
        if (rooms.some(kept => sameName(kept, room))) continue;
        if (view.channels.some(channel => sameName(channel.name, room))) rooms.push(room);
    }
    for (const channel of view.channels) {
        if (channel.closable && !rooms.some(room => sameName(room, channel.name))) rooms.push(channel.name);
    }
    return rooms;
}

/**
 * What has changed since the profile was last written, or null when nothing
 * has — which is nearly always, since every incoming line produces a view.
 *
 * A view with no channels at all is the offline placeholder from before a
 * nick exists: a live connection always keeps its server-log tab, so an empty
 * list means there is no connection to learn anything from rather than that
 * the user left every room. Persisting it as the latter would erase the
 * stored rooms of anyone whose profile has rooms but no usable nick.
 */
export function chatChanges(stored: PersistedChat, view: ChatView): Partial<PersistedChat> | null {
    if (view.channels.length === 0) return null;
    const patch: Partial<PersistedChat> = {};
    if (nickWorthWriting(stored, view)) patch.nick = view.nick;
    const rooms = persistedRooms(stored.rooms, view);
    if (!sameRooms(stored.rooms, rooms)) patch.rooms = rooms;
    return Object.keys(patch).length === 0 ? null : patch;
}

/**
 * Whether the two name the same rooms. Sorted and folded rather than compared
 * entry by entry: order carries no meaning here — a room parted and rejoined
 * comes back at the end of the list — and IRC names are case-insensitive, so a
 * room whose spelling differs only in case from the stored one is not a change
 * to write. Sorting rather than asking whether each of one is somewhere in the
 * other, because that answer is yes for a stored list holding the same room
 * twice, which would hide a genuinely new room behind an equal length.
 */
function sameRooms(stored: string[], rooms: string[]): boolean {
    if (stored.length !== rooms.length) return false;
    const ordered = rooms.map(foldName).sort();
    return stored
        .map(foldName)
        .sort()
        .every((room, i) => room === ordered[i]);
}
