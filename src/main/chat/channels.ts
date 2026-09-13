/**
 * Which channel a server's players talk in, alongside the shared lobby.
 *
 * Only `lostcity` gets a room, because only `#LostCity` exists on SwiftIRC for
 * it. `zanaris` and `lostcitylabs` map to nothing on purpose: there is no room
 * for them there, and guessing one — `#Zanaris`, say — would very likely hand
 * a user into a stranger's channel on a large public network, which is the
 * exact collision the old `#04scape-` prefix existed to prevent on Libera.
 * Having no room is the safe failure; having the wrong room is not.
 *
 * A Map rather than an object, so an id that happens to name something on
 * Object.prototype — a server the user called "Constructor" — still misses.
 */
const CHANNELS = new Map<string, string>([['lostcity', '#LostCity']]);

export function serverChannel(serverId: string): string | null {
    return CHANNELS.get(serverId) ?? null;
}
