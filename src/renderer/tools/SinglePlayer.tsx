import type { ReactNode } from 'react';
import type { SinglePlayerView } from '../../shared/singleplayer';
import World from './singleplayer/World';

const STATUS: Record<SinglePlayerView['status'], string> = {
    stopped: 'Stopped',
    preparing: 'Getting the world ready',
    starting: 'Starting',
    ready: 'Running',
    stopping: 'Stopping',
    failed: 'Failed'
};

/** The Single player tool. What the world is doing sits at the top, above the World section. */
export default function SinglePlayer({ view }: { view: SinglePlayerView }): ReactNode {
    const status = view.status === 'ready' && view.port !== null ? `Running on port ${view.port}` : STATUS[view.status];
    return (
        <div className="flex min-h-0 flex-1 flex-col">
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

            {view.status === 'failed' && (
                <>
                    {view.logTail.length > 0 && (
                        <pre className="sunk mx-2.5 mt-2 max-h-[9em] overflow-auto px-2 py-1 font-mono text-[11px] whitespace-pre-wrap text-dim">
                            {view.logTail.slice(-20).join('\n')}
                        </pre>
                    )}
                    <div className="px-2.5 pt-2">
                        <button type="button" onClick={() => void window.zanaris.singlePlayer.retry()} className="btn btn-red">
                            Try again
                        </button>
                    </div>
                </>
            )}

            <World view={view} />
        </div>
    );
}
