import { useEffect, useId, useState, type ReactNode } from 'react';
import { COMMAND_FILTERS, usage, visibleCommands, type CommandFilter, type CommandRef } from '../../../shared/commands';
import Tab from '../../tab';

const FIELD = 'sunk w-full min-w-0 px-[7px] py-[3px] font-sans text-[13px] text-cream placeholder:text-faint';

/**
 * The Commands section: the content's debug procs and the engine's own
 * commands, each as it is typed into the game's chat box. Shown and not sent:
 * the game reads keys and has no paste, so these are to read and type by
 * hand. Main hands over the procs when the section opens.
 */
export default function Commands({ cheats }: { cheats: boolean }): ReactNode {
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
        <div className="flex min-h-0 flex-1 flex-col gap-2">
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

            <div id={`${id}-list`} className="sunk min-h-0 flex-1 overflow-y-auto px-2 py-1">
                {procs === undefined ? (
                    <p className="py-1 text-dim">Loading…</p>
                ) : shown.length === 0 ? (
                    <p className="py-1 text-dim">Nothing matches.</p>
                ) : (
                    <ul>
                        {shown.map(ref => (
                            <li key={`${ref.kind}:${ref.name}`} className="py-[3px]">
                                {/* Selectable, unlike the rest of the shell, so a command can be copied out by hand. */}
                                <code className="font-mono text-[12px] text-cream select-text">{usage(ref)}</code>
                                {ref.note !== null && <span className="block text-[12px] text-dim">{ref.note}</span>}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
