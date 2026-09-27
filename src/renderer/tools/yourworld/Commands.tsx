import { Fragment, useEffect, useId, useState, type ReactNode } from 'react';
import { COMMAND_FILTERS, usage, visibleCommands, type CommandFilter, type CommandRef } from '../../../shared/commands';
import Tab from '../../tab';
import { scrollClass, sectionClass } from './fill';

const FIELD = 'sunk w-full min-w-0 px-[7px] py-[3px] font-sans text-[13px] text-cream placeholder:text-faint';

/**
 * A command as it is typed, with a place to break after each underscore. To
 * the browser a debug proc's name is one word, `::~npc_del_change_static`
 * 173px of it, and it scrolled the list sideways in any pane narrower than
 * 225. It breaks after an underscore now, and anywhere at all where even a
 * part is wider than the line, as at `PANE_MIN_WIDTH` (the row's
 * `wrap-anywhere`). A `<wbr>` adds nothing to what is copied.
 */
function breakable(typed: string): ReactNode {
    const parts = typed.split('_');
    return parts.map((part, i) => (
        <Fragment key={i}>
            {part}
            {i < parts.length - 1 && (
                <>
                    _<wbr />
                </>
            )}
        </Fragment>
    ));
}

/**
 * The Commands section: the content's debug procs and the engine's own
 * commands, each as it is typed into the game's chat box. Shown and not sent:
 * the game reads keys and has no paste, so these are to read and type by
 * hand. Main hands over the procs when the section opens.
 */
export default function Commands({ cheats, wide }: { cheats: boolean; wide: boolean }): ReactNode {
    const id = useId();
    /* Undefined while main is asked; null when this build has no list. */
    const [procs, setProcs] = useState<CommandRef[] | null | undefined>(undefined);
    const [filter, setFilter] = useState<CommandFilter>('cheats');
    const [query, setQuery] = useState('');

    useEffect(() => {
        let live = true;
        void window.zanaris.yourWorld.commands().then(list => {
            if (live) setProcs(list);
        });
        return () => {
            live = false;
        };
    }, []);

    /* While main is asked there is nothing to list yet; the Loading line shows instead. */
    const shown = visibleCommands(procs === undefined ? [] : procs, filter, query);

    return (
        <div className={sectionClass(wide)}>
            <div className="flex flex-col gap-1.5">
                {!cheats && <p className="text-[12px] text-warn">These need cheats on, in World. With cheats off the world ignores them.</p>}
                <p className="text-[12px] text-dim">
                    Type them into the game's chat box. Debug procs start with <code className="font-mono text-cream">::~</code>, and <code className="font-mono text-cream">::~help</code> opens the game's own menu of the common ones, which leaves the ~ out.
                </p>
                {procs === null && <p className="text-[12px] text-dim">This build has no list of debug procs the kit can read, or is not downloaded yet, so only the engine's commands are here.</p>}
                <input
                    type="search"
                    value={query}
                    placeholder="Search"
                    aria-label="Search commands"
                    aria-controls={`${id}-list`}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={event => setQuery(event.target.value)}
                    className={FIELD}
                />
                {procs !== null && (
                    <div role="group" aria-label="Which commands" className="flex flex-wrap items-center gap-[5px]">
                        {COMMAND_FILTERS.map(option => (
                            <Tab key={option.id} role="button" label={option.label} open={filter === option.id} onSelect={() => setFilter(option.id)} />
                        ))}
                    </div>
                )}
            </div>

            {/* Narrow, the list's sides are 4px, as Characters' are. */}
            <div id={`${id}-list`} className={`sunk ${scrollClass(wide)} py-1 ${wide ? 'px-2' : 'px-1'}`}>
                {procs === undefined ? (
                    <p className="py-1 text-dim">Loading…</p>
                ) : shown.length === 0 ? (
                    <p className="py-1 text-dim">Nothing matches.</p>
                ) : (
                    <ul>
                        {shown.map(ref => (
                            /* A word wider than the line breaks, in a note as in a command: ::getcoord's level,mx,mz,lx,lz is one. */
                            <li key={`${ref.kind}:${ref.name}`} className="py-[3px] wrap-anywhere">
                                {/* Selectable, unlike the rest of the shell, so a command can be copied out by hand. */}
                                <code className="font-mono text-[12px] text-cream select-text">{breakable(usage(ref))}</code>
                                {ref.note !== null && <span className="block text-[12px] text-dim">{ref.note}</span>}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
