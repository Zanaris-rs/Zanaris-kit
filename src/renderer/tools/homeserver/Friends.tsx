import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { ShareView } from '../../../shared/share';
import { scrollClass } from './fill';

/* .btn carries the gold label; a quieter button overrides it inline, as World does. */
const MUTED: CSSProperties = { color: 'var(--color-dim)' };
/*
 * Narrow, every button here has 4px sides rather than the 12 `.btn` gives, as
 * World's switches do. At `PANE_MIN_WIDTH`, with the tool's scrollbar showing,
 * a button has 88px, and with the wider sides Open in browser could be no
 * narrower than 91: "browser" and its sides.
 */
const TIGHT: CSSProperties = { paddingLeft: 4, paddingRight: 4 };
const COPIED_MS = 1_500;

/**
 * The Sharing section: sharing the world with a link, by Cloudflare or over
 * Tor. Every rule is in main — what to ask first, which mode a share over Tor
 * runs in, when the share ends — so this only draws the view and forwards
 * four kinds of click.
 *
 * Only the ways this computer is offered are drawn, side by side when wide
 * and stacked when narrow, and the note sits under them at every width.
 *
 * Failed, Try again starts the way that failed and nothing else. The other
 * way comes back with Dismiss, since there is one share at a time.
 *
 * Narrow, what sits beside Cancel goes above it instead. Beside it, the words
 * it cancels were left a word to a line, and Cancel went past the section's
 * edge.
 */
export default function Friends({ view, worldReady, wide }: { view: ShareView; worldReady: boolean; wide: boolean }): ReactNode {
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), COPIED_MS);
        return () => clearTimeout(timer);
    }, [copied]);

    const { cloudflare, tor } = view.offered;
    if (!cloudflare && !tor) {
        return (
            <section aria-label="Sharing">
                <p className="text-[12px] text-dim">Sharing isn't available on this computer: neither Cloudflare nor Tor Project makes a program for it.</p>
            </section>
        );
    }
    const overTor = view.way === 'tor';
    const note = cloudflare && tor ? 'Friends join from their browser, or from Tor Browser over Tor.' : cloudflare ? 'Friends join from their browser.' : 'Friends join from Tor Browser over Tor.';

    const row = wide ? 'flex items-center gap-2' : 'flex flex-col items-start gap-1.5';
    const sides = wide ? undefined : TIGHT;
    const cancel = (
        <button type="button" onClick={() => void window.zanaris.share.stop()} style={{ ...MUTED, ...sides }} className="btn">
            Cancel
        </button>
    );

    return (
        <section aria-label="Sharing" className={scrollClass(wide)}>
            {view.status === 'off' && (
                <div className="flex flex-col items-start gap-1.5">
                    <div className={row}>
                        {cloudflare && (
                            <button type="button" onClick={() => void window.zanaris.share.start('cloudflare')} style={sides} className="btn">
                                Share
                            </button>
                        )}
                        {tor && (
                            <button type="button" onClick={() => void window.zanaris.share.start('tor')} style={sides} className="btn">
                                Share over Tor
                            </button>
                        )}
                    </div>
                    <span className="text-[12px] text-dim">{note}</span>
                </div>
            )}
            {view.status === 'downloading' && (
                <div className={row} aria-live="polite">
                    <span className="text-cream">Downloading… {Math.floor((view.progress ?? 0) * 100)}%</span>
                    {cancel}
                </div>
            )}
            {view.status === 'connecting' && (
                <div className={row} aria-live="polite">
                    <span className="text-cream">{overTor ? 'Opening a Tor link… this can take a few minutes.' : 'Opening a link…'}</span>
                    {cancel}
                </div>
            )}
            {view.status === 'checking' && (
                <div className={row} aria-live="polite">
                    <span className="text-cream">{overTor ? 'Waiting for the Tor link to go live… this can take a few minutes.' : 'Waiting for the link to go live…'}</span>
                    {cancel}
                </div>
            )}
            {view.status === 'live' && view.url && (
                <>
                    <p className="sunk mt-1 cursor-text px-2 py-1 font-mono text-[12px] break-all text-cream select-text">{view.url}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                void window.zanaris.share.copyLink();
                                setCopied(true);
                            }}
                            style={sides}
                            className="btn"
                        >
                            {copied ? 'Copied' : 'Copy link'}
                        </button>
                        {/* The system browser cannot open an onion link, and main refuses to try. */}
                        {!overTor && (
                            <button type="button" onClick={() => void window.zanaris.share.openLink()} style={sides} className="btn">
                                Open in browser
                            </button>
                        )}
                        <button type="button" onClick={() => void window.zanaris.share.stop()} style={sides} className="btn btn-red">
                            Stop sharing
                        </button>
                    </div>
                    <p className="mt-1.5 text-[12px] text-warn">Anyone with this link can log in as any character, yours included.</p>
                    {overTor && (
                        <>
                            <p className="mt-1.5 text-[12px] text-dim">
                                Opens only in Tor Browser. Its Safest setting switches off JavaScript, which the game needs: friends should use Standard or Safer.
                            </p>
                            {view.torMode && (
                                <p className="text-[12px] text-dim">{view.torMode === 'full' ? 'Hide me: your address stays hidden.' : 'Faster: only your friends are hidden.'}</p>
                            )}
                        </>
                    )}
                    {!worldReady && <p className="text-[12px] text-dim" aria-live="polite">Restarting. The link stays the same.</p>}
                </>
            )}
            {view.status === 'failed' && (
                <>
                    <p className="text-warn" aria-live="polite">
                        Sharing stopped
                        {view.reason && <span className="block text-[12px] break-words text-dim">{view.reason}</span>}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => void window.zanaris.share.start(view.way ?? 'cloudflare')} style={sides} className="btn btn-red">
                            Try again
                        </button>
                        <button type="button" onClick={() => void window.zanaris.share.stop()} style={{ ...MUTED, ...sides }} className="btn">
                            Dismiss
                        </button>
                    </div>
                </>
            )}
        </section>
    );
}
