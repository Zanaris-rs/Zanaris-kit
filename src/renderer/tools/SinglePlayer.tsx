import type { CSSProperties, ReactNode } from 'react';
import type { SinglePlayerView } from '../../shared/singleplayer';

const STATUS: Record<SinglePlayerView['status'], string> = {
    stopped: 'Stopped',
    preparing: 'Getting the world ready',
    starting: 'Starting',
    ready: 'Running',
    stopping: 'Stopping',
    failed: 'Failed'
};

/*
 * .btn is hand-written CSS carrying the gold label, so a button that wants a
 * quieter colour overrides it inline. A utility class of equal specificity
 * would be settled by stylesheet order rather than by intent.
 */
const MUTED: CSSProperties = { color: 'var(--color-dim)' };
/* A control the world is currently busy with: spent, since .btn:disabled paints nothing of its own. */
const SPENT: CSSProperties = { color: 'var(--color-faint)' };

/** The Single player tool: what the world is doing, the cheats switch, and where its files are. */
export default function SinglePlayer({ view }: { view: SinglePlayerView }): ReactNode {
    const busy = view.status === 'preparing' || view.status === 'starting' || view.status === 'stopping';
    const status = view.status === 'ready' && view.port !== null ? `Running on port ${view.port}` : STATUS[view.status];
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* The client centres a panel's title over its contents, so this one is centred too. */}
            <h2 className="title">Single player</h2>

            <div className="px-2.5">
                <p className={view.status === 'failed' ? 'text-warn' : 'text-cream'} aria-live="polite">
                    {status}
                    {view.status === 'failed' && view.reason && <span className="block text-[12px] text-dim">{view.reason}</span>}
                </p>
                {view.version && (
                    <p className="text-[12px] text-faint">
                        engine {view.version.engine.slice(0, 8)} · content {view.version.content.slice(0, 8)} · rev {view.version.revision}
                    </p>
                )}
            </div>

            {view.status === 'failed' && view.logTail.length > 0 && (
                <pre className="sunk mx-2.5 mt-2 max-h-[9em] overflow-auto px-2 py-1 font-mono text-[11px] whitespace-pre-wrap text-dim">
                    {view.logTail.slice(-20).join('\n')}
                </pre>
            )}

            <div className="mt-3 px-2.5">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        role="switch"
                        aria-checked={view.cheats}
                        aria-describedby="cheats-note"
                        disabled={busy}
                        onClick={() => void window.zanaris.singlePlayer.setCheats(!view.cheats)}
                        style={busy ? SPENT : view.cheats ? undefined : MUTED}
                        className={`btn shrink-0${view.cheats && !busy ? ' btn-red' : ''}`}
                    >
                        Cheats {view.cheats ? 'on' : 'off'}
                    </button>
                    <span id="cheats-note" className="text-[12px] text-dim">Developer commands such as ::tele and ::give. Off, the world plays as the servers do.</span>
                </div>
            </div>

            {/* Actions run along the bottom of a panel here, as they do in the client's own interfaces. */}
            <div className="mt-auto flex flex-wrap items-center gap-2 px-2.5 pt-2 pb-1.5">
                {view.status === 'failed' && (
                    <button type="button" onClick={() => void window.zanaris.singlePlayer.retry()} className="btn btn-red">
                        Try again
                    </button>
                )}
                <button type="button" onClick={() => void window.zanaris.singlePlayer.openSaves()} className="btn">
                    Open saves folder
                </button>
                <button type="button" onClick={() => void window.zanaris.singlePlayer.showLog()} className="btn">
                    Show log
                </button>
            </div>
            <p className="px-2.5 pb-2 text-[12px] text-dim">Changing cheats restarts the world and logs you out.</p>
        </div>
    );
}
