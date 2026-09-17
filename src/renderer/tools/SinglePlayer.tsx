import { useState, type ReactNode } from 'react';
import type { SinglePlayerView } from '../../shared/singleplayer';
import Tab from '../tab';
import Characters from './singleplayer/Characters';
import Commands from './singleplayer/Commands';
import World from './singleplayer/World';

const STATUS: Record<SinglePlayerView['status'], string> = {
    stopped: 'Stopped',
    preparing: 'Getting the world ready',
    starting: 'Starting',
    ready: 'Running',
    stopping: 'Stopping',
    failed: 'Failed'
};

type Section = 'world' | 'characters' | 'commands';

const SECTIONS: readonly { id: Section; label: string }[] = [
    { id: 'world', label: 'World' },
    { id: 'characters', label: 'Characters' },
    { id: 'commands', label: 'Commands' }
];

/** The Single player tool. What the world is doing sits above the sections, since it is true of all of them. Which section is open belongs to this pane and is not kept. */
export default function SinglePlayer({ view }: { view: SinglePlayerView }): ReactNode {
    const [open, setOpen] = useState<Section>('world');
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

            {/*
             * Chat's row of tabs, worn the same way and for the same reason:
             * buttons with aria-current, since there is no tabpanel here that a
             * tablist could point at.
             */}
            <div role="group" aria-label="Single player" className="mt-2.5 flex flex-wrap items-center gap-[5px] px-2.5">
                {SECTIONS.map(section => (
                    <Tab key={section.id} role="button" label={section.label} open={open === section.id} onSelect={() => setOpen(section.id)} />
                ))}
            </div>

            {open === 'world' && <World view={view} />}
            {open === 'characters' && <Characters view={view} />}
            {open === 'commands' && <Commands cheats={view.settings.cheats} />}
        </div>
    );
}
