/** Sharing the single-player world through a Cloudflare quick tunnel, as the shell draws it. */

export type ShareStatus = 'off' | 'downloading' | 'connecting' | 'live' | 'failed';

export interface ShareView {
    status: ShareStatus;
    /** The link friends open, `<tunnel>/rs2.cgi`, while live. */
    url: string | null;
    /** How much of cloudflared has arrived, 0 to 1, while downloading. */
    progress: number | null;
    /** Why sharing stopped, while failed. */
    reason: string | null;
    /** False on a platform Cloudflare publishes no cloudflared for. */
    available: boolean;
}
