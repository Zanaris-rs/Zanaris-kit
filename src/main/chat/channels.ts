/**
 * Which channel a server's players talk in, alongside the shared lobby.
 *
 * Only the hosted servers get a room: a channel per local or private server
 * would be a room of one. The names carry the 04scape prefix because this is a
 * public network, where a bare #zanaris may already belong to somebody else.
 *
 * A Map rather than an object, so an id that happens to name something on
 * Object.prototype — a server the user called "Constructor" — still misses.
 */
const CHANNELS = new Map<string, string>([
    ['lostcity', '#04scape-lostcity'],
    ['zanaris', '#04scape-zanaris'],
    ['lostcitylabs', '#04scape-labs']
]);

export function serverChannel(serverId: string): string | null {
    return CHANNELS.get(serverId) ?? null;
}
