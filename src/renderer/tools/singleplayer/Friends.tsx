import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { ShareView } from '../../../shared/share';

/* .btn carries the gold label; a quieter button overrides it inline, as World does. */
const MUTED: CSSProperties = { color: 'var(--color-dim)' };
const COPIED_MS = 1_500;

/**
 * The Friends section: sharing the world with a link. Every rule is in main —
 * what to ask first, when the share ends — so this only draws the view and
 * forwards four clicks.
 */
export default function Friends({ view, worldReady }: { view: ShareView; worldReady: boolean }): ReactNode {
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), COPIED_MS);
        return () => clearTimeout(timer);
    }, [copied]);

    if (!view.available) {
        return (
            <section aria-label="Play with friends" className="px-2.5 pt-2.5">
                <p className="text-[12px] text-dim">Playing with friends is not available on this computer: Cloudflare makes no tunnel program for it.</p>
            </section>
        );
    }

    const cancel = (
        <button type="button" onClick={() => void window.zanaris.share.stop()} style={MUTED} className="btn">
            Cancel
        </button>
    );

    return (
        <section aria-label="Play with friends" className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-2.5">
            {view.status === 'off' && (
                <div className="flex items-center gap-2">
                    <button type="button" onClick={() => void window.zanaris.share.start()} className="btn shrink-0">
                        Share with friends
                    </button>
                    <span className="text-[12px] text-dim">A link your friends open in a browser to join this world.</span>
                </div>
            )}
            {view.status === 'downloading' && (
                <div className="flex items-center gap-2" aria-live="polite">
                    <span className="text-cream">Downloading Cloudflare&apos;s tunnel program… {Math.floor((view.progress ?? 0) * 100)}%</span>
                    {cancel}
                </div>
            )}
            {view.status === 'connecting' && (
                <div className="flex items-center gap-2" aria-live="polite">
                    <span className="text-cream">Opening a link…</span>
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
                            className="btn"
                        >
                            {copied ? 'Copied' : 'Copy link'}
                        </button>
                        <button type="button" onClick={() => void window.zanaris.share.openLink()} className="btn">
                            Open in browser
                        </button>
                        <button type="button" onClick={() => void window.zanaris.share.stop()} className="btn btn-red">
                            Stop sharing
                        </button>
                    </div>
                    <p className="mt-1.5 text-[12px] text-warn">Anyone with this link can log in as any character, yours included.</p>
                    {!worldReady && <p className="text-[12px] text-dim" aria-live="polite">Your world is restarting. The link stays the same: friends reload once it is back.</p>}
                </>
            )}
            {view.status === 'failed' && (
                <>
                    <p className="text-warn" aria-live="polite">
                        Sharing stopped
                        {view.reason && <span className="block text-[12px] break-words text-dim">{view.reason}</span>}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                        <button type="button" onClick={() => void window.zanaris.share.start()} className="btn btn-red">
                            Try again
                        </button>
                        <button type="button" onClick={() => void window.zanaris.share.stop()} style={MUTED} className="btn">
                            Dismiss
                        </button>
                    </div>
                </>
            )}
        </section>
    );
}
