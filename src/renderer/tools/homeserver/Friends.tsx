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
 * The Friends section: sharing the world with a link. Every rule is in main —
 * what to ask first, when the share ends — so this only draws the view and
 * forwards four clicks.
 *
 * Narrow, what sits beside Share with friends or Cancel goes above or below
 * it instead. Beside Share with friends, 165px, the note was pushed past the
 * section's edge and the section scrolled sideways, and beside Cancel the
 * words it cancels were left a word to a line and Cancel went past the edge.
 */
export default function Friends({ view, worldReady, wide }: { view: ShareView; worldReady: boolean; wide: boolean }): ReactNode {
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), COPIED_MS);
        return () => clearTimeout(timer);
    }, [copied]);

    if (!view.available) {
        return (
            <section aria-label="Play with friends">
                <p className="text-[12px] text-dim">Playing with friends is not available on this computer: Cloudflare makes no tunnel program for it.</p>
            </section>
        );
    }

    const row = wide ? 'flex items-center gap-2' : 'flex flex-col items-start gap-1.5';
    const sides = wide ? undefined : TIGHT;
    const cancel = (
        <button type="button" onClick={() => void window.zanaris.share.stop()} style={{ ...MUTED, ...sides }} className="btn">
            Cancel
        </button>
    );

    return (
        <section aria-label="Play with friends" className={scrollClass(wide)}>
            {view.status === 'off' && (
                <div className={row}>
                    <button type="button" onClick={() => void window.zanaris.share.start()} style={sides} className="btn shrink-0">
                        Share with friends
                    </button>
                    <span className="text-[12px] text-dim">A link your friends open in a browser to join this world.</span>
                </div>
            )}
            {view.status === 'downloading' && (
                <div className={row} aria-live="polite">
                    <span className="text-cream">Downloading Cloudflare&apos;s tunnel program… {Math.floor((view.progress ?? 0) * 100)}%</span>
                    {cancel}
                </div>
            )}
            {view.status === 'connecting' && (
                <div className={row} aria-live="polite">
                    <span className="text-cream">Opening a link…</span>
                    {cancel}
                </div>
            )}
            {view.status === 'checking' && (
                <div className={row} aria-live="polite">
                    <span className="text-cream">Link made. Waiting for it to work from the internet, which can take a minute…</span>
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
                        <button type="button" onClick={() => void window.zanaris.share.openLink()} style={sides} className="btn">
                            Open in browser
                        </button>
                        <button type="button" onClick={() => void window.zanaris.share.stop()} style={sides} className="btn btn-red">
                            Stop sharing
                        </button>
                    </div>
                    <p className="mt-1.5 text-[12px] text-warn">Anyone with this link can log in as any character, yours included.</p>
                    {!worldReady && <p className="text-[12px] text-dim" aria-live="polite">Your home server is restarting. The link stays the same: friends reload once it is back.</p>}
                </>
            )}
            {view.status === 'failed' && (
                <>
                    <p className="text-warn" aria-live="polite">
                        Sharing stopped
                        {view.reason && <span className="block text-[12px] break-words text-dim">{view.reason}</span>}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => void window.zanaris.share.start()} style={sides} className="btn btn-red">
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
