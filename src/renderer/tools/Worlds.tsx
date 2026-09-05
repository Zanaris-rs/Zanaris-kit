import { useEffect, useState, type ReactNode } from 'react';
import type { Detail, WorldRow, WorldsView } from '../../shared/worlds';

function age(fetchedAt: number | null, now: number): string {
    if (fetchedAt === null) return '';
    const s = Math.max(0, Math.round((now - fetchedAt) / 1000));
    return s < 60 ? `updated ${s} s ago` : `updated ${Math.round(s / 60)} min ago`;
}

/**
 * Colour marks the standout rather than grading every world. Most worlds sit
 * in a band set by where you live, so painting all of them orange said
 * nothing; green marks one worth switching to, orange a world that is
 * genuinely far, and everything between is just a number.
 */
function latencyClass(ms: number | null): string {
    if (ms === null) return 'text-faint';
    if (ms <= 100) return 'text-good';
    if (ms > 300) return 'text-warn';
    return 'text-dim';
}

function DetailSwitch({ detail }: { detail: Detail }): ReactNode {
    const option = (value: Detail, label: string): ReactNode => (
        <button
            type="button"
            aria-pressed={detail === value}
            onClick={() => detail !== value && void window.swiftkit.worlds.setDetail(value)}
            className={`slab slab-button font-pixel flex-1 py-0.5 text-[14px] ${detail === value ? 'slab-on text-bone' : 'text-dim'}`}
        >
            {label}
        </button>
    );
    return (
        <div className="flex gap-1.5" role="group" aria-label="Detail">
            {option('low', 'Low detail')}
            {option('high', 'High detail')}
        </div>
    );
}

function Row({ world, current }: { world: WorldRow; current: boolean }): ReactNode {
    return (
        <li>
            <button
                type="button"
                aria-current={current ? 'true' : undefined}
                onClick={() => !current && void window.swiftkit.worlds.switch(world.id)}
                className={`flex w-full items-center gap-2.5 px-2 py-1.5 text-left ${current ? 'bg-row' : 'hover:bg-row/50'}`}
            >
                <span className={`w-[34px] shrink-0 ${current ? 'text-gold' : 'text-dim'}`}>W{world.id}</span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate">{world.region ?? world.name}</span>
                    <span className="block text-[12px] text-dim">
                        {world.players === null ? 'players unknown' : `${world.players} online`}
                        {world.members === true && ' · members'}
                        {world.members === false && ' · free'}
                    </span>
                </span>
                <span className={`shrink-0 tabular-nums ${latencyClass(world.latencyMs)}`}>
                    {world.latencyMs === null ? '—' : `${world.latencyMs} ms`}
                </span>
            </button>
        </li>
    );
}

/** The Worlds tool: pick a world, pick a detail level. Both reload the game and log the player out. */
export default function Worlds({ view }: { view: WorldsView }): ReactNode {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    const loading = view.status === 'loading';
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between gap-2 px-3 pt-2 pb-1.5">
                <h2 className="font-pixel text-[17px] text-gold">Worlds</h2>
                <button
                    type="button"
                    onClick={() => void window.swiftkit.worlds.refresh()}
                    disabled={loading}
                    className="link font-pixel text-[14px] disabled:text-faint"
                >
                    {loading ? 'loading' : 'refresh'}
                </button>
            </div>

            {view.showDetail && (
                <div className="px-3 pb-1.5">
                    <DetailSwitch detail={view.detail} />
                </div>
            )}

            <p className="px-3 pb-1.5 text-[12px]" aria-live="polite">
                {view.error ? (
                    <span className="text-warn">Couldn't load the list: {view.error}</span>
                ) : (
                    <span className="text-dim">{age(view.fetchedAt, now) || (loading ? 'Loading the list' : '')}</span>
                )}
            </p>

            <ul className="well mx-3 min-h-0 flex-1 overflow-y-auto">
                {view.worlds.map(world => (
                    <Row key={world.id} world={world} current={world.id === view.current} />
                ))}
                {view.worlds.length === 0 && !loading && (
                    <li className="px-2 py-2 text-[13px] text-dim">
                        No worlds listed.{' '}
                        <button type="button" onClick={() => void window.swiftkit.worlds.refresh()} className="link">
                            Try again
                        </button>
                    </li>
                )}
            </ul>

            <p className="px-3 py-2 text-[12px] text-dim">Switching reloads the game and logs you out.</p>
        </div>
    );
}
