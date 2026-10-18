/** Sharing your home server through a Cloudflare quick tunnel or a Tor onion service, as the shell draws it. */

/**
 * `connecting` until the tunnel's program has its link, then `checking`
 * until the link reaches the kit from the internet, and only then `live`.
 * Checking takes from a few seconds to over half a minute more by Cloudflare,
 * and can take minutes over Tor.
 */
export type ShareStatus = 'off' | 'downloading' | 'connecting' | 'checking' | 'live' | 'failed';

export interface ShareView {
    status: ShareStatus;
    /** The link friends open, `<tunnel>/rs2.cgi`, while live. */
    url: string | null;
    /** How much of the tunnel's program has arrived, 0 to 1, while downloading. */
    progress: number | null;
    /** Why sharing stopped, while failed. */
    reason: string | null;
    /** Which ways this platform can share: Cloudflare where it publishes a cloudflared, Tor where Tor Project publishes a Tor. */
    offered: { cloudflare: boolean; tor: boolean };
    /** The way the share goes, whenever it is not off. */
    way: ShareWay | null;
    /** How a share over Tor runs, whenever it is not off; null for Cloudflare. */
    torMode: TorMode | null;
}

/** A Cloudflare quick tunnel, or a Tor onion service. */
export type ShareWay = 'cloudflare' | 'tor';

/** What a share is asked to start as. */
export type ShareStart = { way: 'cloudflare' } | { way: 'tor'; mode: TorMode };

/**
 * How a share over Tor runs its onion service: `full` hides the host behind
 * three hops of its own, as Tor normally does; `single` is Tor's
 * non-anonymous single-hop mode, which goes through fewer relays and hides
 * nothing about where the host is.
 */
export type TorMode = 'full' | 'single';
