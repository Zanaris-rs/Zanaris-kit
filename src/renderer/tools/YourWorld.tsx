import { useState, type ReactNode } from 'react';
import { lineTitle, sectionsOffered, YOUR_WORLD_SECTIONS, type YourWorldSection, type YourWorldView } from '../../shared/yourworld';
import type { ShareView } from '../../shared/share';
import Tab from '../tab';
import Builds from './yourworld/Builds';
import Characters from './yourworld/Characters';
import Commands from './yourworld/Commands';
import Friends from './yourworld/Friends';
import World from './yourworld/World';

const STATUS: Record<YourWorldView['status'], string> = {
    stopped: 'Stopped',
    missing: 'Not downloaded yet',
    downloading: 'Downloading',
    preparing: 'Getting the world ready',
    starting: 'Starting',
    ready: 'Running',
    stopping: 'Stopping',
    failed: 'Failed'
};

/**
 * The pane width below which the sections stack what they otherwise set side
 * by side: World puts a switch's note under its button, Characters the name
 * box above its buttons, and Friends its note under Share with friends and
 * its Cancel under what it cancels. The lists in Characters, Commands and
 * Builds also give their rows 4px sides rather than 8. The row of sections
 * becomes one tab that opens a menu of them, and under it the section scrolls
 * as one page rather than each list scrolling inside it (yourworld/fill.ts).
 *
 * Friends is the first to run out. Beside Share with friends, 165px, its note
 * has the pane less 193px: three lines here, four at 280, and nine at 240.
 * The name box beside Rename, the widest of its buttons, and Cancel holds
 * "Character name" whole from 273, and a switch's note has 120px beside
 * Members off at 280 with World's scrollbar showing. A pane knows its own
 * width, so the shape is read from it, as Worlds' is.
 */
const WIDE_ENOUGH = 300;

/**
 * The Your world tool. What the world is doing sits above the sections, since it is true of all of them,
 * and so does a live share's warning: Friends says it too, and nothing else would while another section is open.
 * Which section is open belongs to this pane and is not kept. Friends is offered only when main sends a share.
 */
export default function YourWorld({ view, share, width }: { view: YourWorldView; share: ShareView | null; width: number }): ReactNode {
    const wide = width >= WIDE_ENOUGH;
    const [open, setOpen] = useState<YourWorldSection>('world');
    const status = view.status === 'ready' && view.port !== null ? `Running on port ${view.port}` : STATUS[view.status];
    const line = view.builds.find(l => l.id === view.selected);

    const failed = view.status === 'failed' && (
        <>
            {/*
             * A word longer than the line, a stack frame's name say, breaks
             * rather than scrolling the log sideways. Narrow, where the
             * section scrolls, the log keeps its height: as the one thing
             * there that scrolls itself, it was the one squeezed to fit the
             * pane, to 8px at `PANE_MIN_WIDTH`.
             */}
            {view.logTail.length > 0 && (
                <pre className={`sunk max-h-[9em] overflow-auto px-2 py-1 font-mono text-[11px] break-words whitespace-pre-wrap text-dim${wide ? '' : ' shrink-0'}`}>
                    {view.logTail.slice(-20).join('\n')}
                </pre>
            )}
            <div>
                <button type="button" onClick={() => void window.zanaris.yourWorld.retry()} className="btn btn-red">
                    Try again
                </button>
            </div>
        </>
    );

    const section = (
        <>
            {open === 'world' && <World view={view} wide={wide} />}
            {open === 'characters' && <Characters view={view} wide={wide} />}
            {/* Keyed by the build, so a switch or a finished download reads that build's list. */}
            {open === 'commands' && <Commands key={`${view.selected}:${line?.state ?? ''}`} cheats={view.settings.cheats} wide={wide} />}
            {open === 'builds' && <Builds view={view} wide={wide} />}
            {open === 'friends' && share && <Friends view={share} worldReady={view.status === 'ready'} wide={wide} />}
        </>
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
            {/*
             * What the world is doing, which build it runs, and a live share's
             * warning. The build's commits are Builds', beside the rest of
             * that build.
             */}
            <div>
                <p className={view.status === 'failed' ? 'text-warn' : 'text-cream'} aria-live="polite">
                    {status}
                    {/* A reason can hold a path, one word to the browser, which breaks rather than running past the pane. */}
                    {view.status === 'failed' && view.reason && <span className="block text-[12px] break-words text-dim">{view.reason}</span>}
                </p>
                {line && <p className="text-[12px] text-dim">{lineTitle(line)}</p>}
                {share?.status === 'live' && open !== 'friends' && <p className="text-[12px] text-warn">Shared with a link: anyone who has it can log in as any character, yours included.</p>}
            </div>

            {wide && failed}

            {/*
             * Chat's row of tabs, worn the same way and for the same reason:
             * buttons with aria-current, since there is no tabpanel here that
             * a tablist could point at.
             *
             * Narrow, the row is one tab naming the open section, which opens
             * main's menu of them: the row was a tab to a line at
             * `PANE_MIN_WIDTH`, five lines before any section. Under it the
             * rest scrolls as one page (yourworld/fill.ts), so what is running
             * and the way to another section stay in view.
             */}
            <div role="group" aria-label="Your world" className={wide ? 'flex flex-wrap items-center gap-[5px]' : 'flex'}>
                {wide ? (
                    sectionsOffered(share !== null).map(offered => (
                        <Tab key={offered.id} role="button" label={offered.label} open={open === offered.id} onSelect={() => setOpen(offered.id)} />
                    ))
                ) : (
                    <Tab
                        role="button"
                        menu
                        open
                        label={YOUR_WORLD_SECTIONS.find(offered => offered.id === open)?.label ?? ''}
                        onSelect={event => {
                            const box = event.currentTarget.getBoundingClientRect();
                            void window.zanaris.yourWorld.sectionMenu(open, box.left, box.bottom).then(chosen => {
                                if (chosen !== null) setOpen(chosen);
                            });
                        }}
                    />
                )}
            </div>

            {/*
             * The section sits in this one place in both shapes, so a pane
             * crossing `WIDE_ENOUGH` keeps what is open in it: a name half
             * typed, a search, a change still running.
             */}
            <div className={`flex min-h-0 flex-1 flex-col gap-2${wide ? '' : ' overflow-y-auto'}`}>
                {!wide && failed}
                {section}
            </div>
        </div>
    );
}
