import { useEffect, useState, type ReactNode } from 'react';
import type { Detail, WorldRow, WorldsView } from '../../shared/worlds';

function age(fetchedAt: number | null, now: number): string {
    if (fetchedAt === null) return '';
    const s = Math.max(0, Math.round((now - fetchedAt) / 1000));
    return s < 60 ? `updated ${s} s ago` : `updated ${Math.round(s / 60)} min ago`;
}

function latencyClass(ms: number | null): string {
    if (ms === null) return 'text-dim';
    if (ms <= 80) return 'text-live';
    if (ms <= 160) return 'text-brass';
    return 'text-dim';
}

function DetailSwitch({ detail }: { detail: Detail }): ReactNode {
    const option = (value: Detail, label: string): ReactNode => (
        <button
            type="button"
            aria-pressed={detail === value}
            onClick={() => detail !== value && void window.swiftkit.worlds.setDetail(value)}
            className={`flex-1 border px-2 py-1 text-[12px] ${detail === value ? 'border-brass bg-surface text-bone' : 'border-line text-dim hover:text-bone'}`}
        >
            {label}
        </button>
    );
    return (
        <div className="flex gap-1" role="group" aria-label="Detail">
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
                className={`flex w-full items-center gap-3 border-b border-line px-4 py-2 text-left ${current ? 'bg-surface' : 'hover:bg-surface/60'}`}
            >
                <span className={`w-[52px] shrink-0 text-[13px] ${current ? 'text-brass' : 'text-bone'}`}>W{world.id}</span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-bone">{world.region ?? world.name}</span>
                    <span className="block text-[11px] text-dim">
                        {world.players === null ? 'players unknown' : `${world.players} online`}
                        {world.members === true && ' · members'}
                        {world.members === false && ' · free'}
                    </span>
                </span>
                <span className={`shrink-0 font-mono text-[11px] tabular-nums ${latencyClass(world.latencyMs)}`}>
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
            <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
                <h2 className="font-medium text-bone">Worlds</h2>
                <button
                    type="button"
                    onClick={() => void window.swiftkit.worlds.refresh()}
                    disabled={loading}
                    className="text-[11px] text-dim hover:text-bone disabled:opacity-50"
                >
                    {loading ? 'loading…' : 'refresh'}
                </button>
            </div>
            {view.showDetail && (
                <div className="px-4 pb-2">
                    <DetailSwitch detail={view.detail} />
                </div>
            )}
            <p className="px-4 pb-2 text-[11px] text-dim" aria-live="polite">
                {view.error ? <span className="text-brass">Couldn't load the list: {view.error}</span> : age(view.fetchedAt, now) || (loading ? 'Loading the list…' : '')}
            </p>
            <ul className="min-h-0 flex-1 overflow-y-auto border-t border-line">
                {view.worlds.map(world => (
                    <Row key={world.id} world={world} current={world.id === view.current} />
                ))}
                {view.worlds.length === 0 && !loading && (
                    <li className="px-4 py-3 text-[12px] text-dim">
                        No worlds listed.{' '}
                        <button type="button" onClick={() => void window.swiftkit.worlds.refresh()} className="text-brass hover:underline">
                            Try again
                        </button>
                    </li>
                )}
            </ul>
            <p className="border-t border-line px-4 py-2 text-[11px] text-dim">Switching reloads the game and logs you out.</p>
        </div>
    );
}
