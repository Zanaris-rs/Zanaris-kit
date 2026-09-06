import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
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

/*
 * .btn is hand-written CSS carrying the gold label, so a button that wants a
 * quieter colour overrides it inline. A utility class of equal specificity
 * would be settled by stylesheet order rather than by intent.
 */
const MUTED: CSSProperties = { color: 'var(--color-dim)' };
const SPENT: CSSProperties = { color: 'var(--color-faint)' };

function DetailSwitch({ detail }: { detail: Detail }): ReactNode {
    const option = (value: Detail, label: string): ReactNode => (
        <button
            type="button"
            aria-pressed={detail === value}
            onClick={() => detail !== value && void window.swiftkit.worlds.setDetail(value)}
            style={detail === value ? undefined : MUTED}
            className={`btn flex-1${detail === value ? ' btn-red' : ''}`}
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
                className={`flex w-full items-center gap-2.5 px-2 py-[5px] text-left ${current ? 'bg-stone-lit' : 'hover:bg-stone-lit/40'}`}
            >
                <span className={`w-[32px] shrink-0 ${current ? 'text-gold' : 'text-dim'}`}>W{world.id}</span>
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
            {/* The client centres a panel's title over its contents, so this one is centred too. */}
            <h2 className="title">Worlds</h2>

            {view.showDetail && (
                <div className="px-2.5 pb-[7px]">
                    <DetailSwitch detail={view.detail} />
                </div>
            )}

            <ul className="sunk mx-2.5 min-h-0 flex-1 overflow-y-auto">
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

            {/* Actions run along the bottom of a panel here, as they do in the client's own interfaces. */}
            <div className="flex items-center gap-2 px-2.5 pt-2 pb-1.5">
                <button
                    type="button"
                    onClick={() => void window.swiftkit.worlds.refresh()}
                    disabled={loading}
                    style={loading ? SPENT : undefined}
                    className="btn shrink-0"
                >
                    {loading ? 'loading' : 'refresh'}
                </button>
                <p className="min-w-0 flex-1 text-[12px]" aria-live="polite">
                    {view.error ? (
                        <span className="text-warn">Couldn't load the list: {view.error}</span>
                    ) : (
                        <span className="text-dim">{age(view.fetchedAt, now) || (loading ? 'Loading the list' : '')}</span>
                    )}
                </p>
            </div>

            <p className="px-2.5 pb-2 text-[12px] text-dim">Switching reloads the game and logs you out.</p>
        </div>
    );
}
