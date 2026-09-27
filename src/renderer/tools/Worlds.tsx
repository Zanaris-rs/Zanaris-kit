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

/*
 * A row is a bare `<button>`, and the base `button` rule in styles.css is
 * unlayered CSS too — the same rule `.btn`/`.sunk`/`.tile` beat a utility of
 * equal specificity with, so `px-2 py-[5px]` on the button itself was a
 * silent no-op: `padding: 0` always won, and the row's content sat flush
 * against the well's own border. That is what let the latency figure reach
 * it. `background: none` beats a background utility the same way, so the
 * current-world and hover highlight moved to the `<li>`, which carries no
 * such reset.
 */
const ROW_PADDING: CSSProperties = { padding: '5px 8px' };

/*
 * A stacked detail button is as wide as the pane and no wider, and at
 * `PANE_MIN_WIDTH` the 12px `.btn` puts either side of its label leaves too
 * little for "High detail", which wraps onto a second line inside its button.
 */
const TIGHT: CSSProperties = { paddingLeft: 4, paddingRight: 4 };

function DetailSwitch({ detail, wide }: { detail: Detail; wide: boolean }): ReactNode {
    const option = (value: Detail, label: string): ReactNode => (
        <button
            type="button"
            aria-pressed={detail === value}
            onClick={() => detail !== value && void window.zanaris.worlds.setDetail(value)}
            style={{ ...(detail === value ? undefined : MUTED), ...(wide ? undefined : TIGHT) }}
            className={`btn${wide ? ' flex-1' : ''}${detail === value ? ' btn-red' : ''}`}
        >
            {label}
        </button>
    );
    return (
        <div className={wide ? 'flex gap-1.5' : 'flex flex-col gap-1.5'} role="group" aria-label="Detail">
            {option('low', 'Low detail')}
            {option('high', 'High detail')}
        </div>
    );
}

/**
 * One world. Wide, it is three columns: the world, then its region over its
 * players, then its latency. Narrow, the world and its latency share the top
 * line and the region and players go under them, each with the row's whole
 * width. Three columns in a narrow pane left the middle one no width at all,
 * and its players line, which wraps rather than truncating, went a word to a
 * line and was drawn across the latency.
 */
function Row({ world, current, wide }: { world: WorldRow; current: boolean; wide: boolean }): ReactNode {
    const region = world.region ?? world.name;
    const place = (
        <>
            {/* The title is the whole name, however much of it the row has room for. */}
            <span className="block truncate" title={region}>
                {region}
            </span>
            <span className="block text-[12px] text-dim">
                {world.players === null ? 'players unknown' : `${world.players} online`}
                {world.members === true && ' · members'}
                {world.members === false && ' · free'}
            </span>
        </>
    );
    const latency = world.latencyMs === null ? '—' : `${world.latencyMs} ms`;
    return (
        <li className={current ? 'bg-stone-lit' : 'hover:bg-stone-lit/40'}>
            <button
                type="button"
                aria-current={current ? 'true' : undefined}
                onClick={() => !current && void window.zanaris.worlds.switch(world.id)}
                style={ROW_PADDING}
                className={wide ? 'flex w-full items-center gap-2.5 text-left' : 'block w-full text-left'}
            >
                {wide ? (
                    <>
                        <span className={`w-[32px] shrink-0 ${current ? 'text-gold' : 'text-dim'}`}>W{world.id}</span>
                        <span className="min-w-0 flex-1">{place}</span>
                        <span className={`shrink-0 tabular-nums ${latencyClass(world.latencyMs)}`}>{latency}</span>
                    </>
                ) : (
                    <>
                        {/*
                         * Wraps rather than overlaps: a world and a latency too
                         * long to share the line put the latency under the world.
                         * At `PANE_MIN_WIDTH`, once the list has a scrollbar,
                         * even W1 and a three-digit latency are.
                         */}
                        <span className="flex flex-wrap justify-between gap-x-2">
                            <span className={current ? 'text-gold' : 'text-dim'}>W{world.id}</span>
                            <span className={`tabular-nums ${latencyClass(world.latencyMs)}`}>{latency}</span>
                        </span>
                        {place}
                    </>
                )}
            </button>
        </li>
    );
}

/**
 * The pane width below which the Worlds tool stacks what it otherwise sets
 * side by side: a row's world, region and latency, the two detail buttons,
 * and Refresh and the line beside it.
 *
 * Side by side, a row's world and latency take a fixed width either side of
 * its region, and each detail button wants the whole of its label. The switch
 * is the first to run out: a little below this its labels wrap inside their
 * buttons. Stacked, every line has the pane's whole width, and that holds
 * down to `PANE_MIN_WIDTH`. A pane knows its own width, so the shape is read
 * from it, as Chat's is.
 */
const WIDE_ENOUGH = 260;

/** The Worlds tool: pick a world, pick a detail level. Both reload the game and log the player out. */
export default function Worlds({ view, width }: { view: WorldsView; width: number }): ReactNode {
    const wide = width >= WIDE_ENOUGH;
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    const loading = view.status === 'loading';
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
            {view.showDetail && <DetailSwitch detail={view.detail} wide={wide} />}

            <ul className="sunk min-h-0 flex-1 overflow-y-auto">
                {view.worlds.map(world => (
                    <Row key={world.id} world={world} current={world.id === view.current} wide={wide} />
                ))}
                {view.worlds.length === 0 && !loading && (
                    <li className="px-2 py-2 text-[13px] text-dim">
                        No worlds listed.{' '}
                        <button type="button" onClick={() => void window.zanaris.worlds.refresh()} className="link">
                            Try again
                        </button>
                    </li>
                )}
            </ul>

            {/*
             * Actions run along the bottom of a panel here, as they do in the
             * client's own interfaces. Narrow, how old the list is goes under
             * Refresh, which is as wide as the pane like the detail buttons:
             * beside it, the line had a few pixels and went a letter or two to a line.
             */}
            <div className={wide ? 'flex items-center gap-2' : 'flex flex-col gap-1'}>
                <button
                    type="button"
                    onClick={() => void window.zanaris.worlds.refresh()}
                    disabled={loading}
                    style={loading ? SPENT : undefined}
                    className="btn shrink-0"
                >
                    {loading ? 'Loading…' : 'Refresh'}
                </button>
                <p className={wide ? 'min-w-0 flex-1 text-[12px]' : 'text-[12px]'} aria-live="polite">
                    {view.error ? (
                        <span className="text-warn">{view.error}</span>
                    ) : (
                        <span className="text-dim">{age(view.fetchedAt, now) || (loading ? 'Loading the list' : '')}</span>
                    )}
                </p>
            </div>

            <p className="text-[12px] text-dim">Switching reloads the game and logs you out.</p>
        </div>
    );
}
