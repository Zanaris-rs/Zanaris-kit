import type { ChatView } from '../shared/chat.ts';
import { sameName } from './chat/protocol.ts';

/**
 * Which of a chat view belongs in the profile.
 *
 * Two persisted chat fields follow the connection rather than a control the
 * user operated: the nick, which the server confirms and can rename out from
 * under us, and the rooms joined by hand. `ClientOpts` has no callback for
 * either, so `index.ts` learns both by watching the view it already
 * subscribes to — one rule covering /nick, /join, /part, the close control
 * and a server-forced rename, where hooking each command would be five rules,
 * and the two the server can overrule would be writing what was asked for
 * rather than what happened.
 *
 * The view changes on every message and `AppState.save()` rewrites the whole
 * profile, so the question "is this view worth a write?" is worth asking
 * carefully — and worth asking here, where `npm test` can reach it, rather
 * than in `index.ts`, where nothing can.
 */

/** The fields of ChatSettings this observation owns. Everything else in there is set by a control, not learnt from the wire. */
export interface PersistedChat {
    nick: string | null;
    rooms: string[];
}

/**
 * The rooms the user joined by hand, taken from the `closable` the service
 * stamps on every channel the shell sees. That flag is also what draws the
 * close control, so what gets persisted and what can be closed cannot come
 * apart. Deriving the set again from the auto set would be a third answer to
 * a question the service has already answered.
 */
export function persistedRooms(view: ChatView): string[] {
    return view.channels.filter(channel => channel.closable).map(channel => channel.name);
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
    if (view.nick !== stored.nick) patch.nick = view.nick;
    const rooms = persistedRooms(view);
    if (!sameRooms(stored.rooms, rooms)) patch.rooms = rooms;
    return Object.keys(patch).length === 0 ? null : patch;
}

/**
 * Whether the two name the same rooms. Compared as a set and folded: order
 * carries no meaning here — a room parted and rejoined comes back at the end
 * of the list — and IRC names are case-insensitive, so a room whose spelling
 * differs only in case from the stored one is not a change to write.
 */
function sameRooms(stored: string[], rooms: string[]): boolean {
    return stored.length === rooms.length && stored.every(room => rooms.some(other => sameName(other, room)));
}
