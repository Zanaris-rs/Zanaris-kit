import type { CSSProperties, ReactNode } from 'react';
import type { ServerRow, ServersView } from '../../main/servers.ts';

/*
 * `.btn` and the base `button` rule are unlayered CSS, which beats a Tailwind
 * utility of equal specificity whatever the order, so Open — one per row, none
 * of them the pane's single primary action — sits on `.btn` for its size and
 * shape but keeps a quiet, dim label on a span inside it (a span has no
 * unlayered rule to lose to) rather than the gold `.btn` sets by default.
 * Copied from `Timers.tsx` rather than reinvented, so the two panes agree.
 */
const BUTTON_SIZE: CSSProperties = { fontSize: 13, padding: '1px 8px' };
/* The startup checkbox wears the gold the client's own accents do. */
const ACCENT: CSSProperties = { accentColor: 'var(--color-gold)' };

/** One line of the catalog: its name, revision if it has one, notes if any, how many windows have it open, an Open button, and whether a launch opens it. Remove and the add form are not here yet — Task 6. */
function Row({ row }: { row: ServerRow }): ReactNode {
    return (
        <li className="border-b border-edge-dark px-2 py-1.5 last:border-b-0">
            <div className="flex min-w-0 items-center gap-1">
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                {row.revision !== null && (
                    <span className="shrink-0 border border-edge-lit px-[3px] text-[10px] leading-[13px] text-dim">rev {row.revision}</span>
                )}
                <button type="button" style={BUTTON_SIZE} className="btn group shrink-0" onClick={() => void window.zanaris.servers.open(row.id)}>
                    <span className="text-dim group-hover:text-cream">Open</span>
                </button>
            </div>
            {row.notes && <p className="text-[12px] text-dim">{row.notes}</p>}
            {row.open > 0 && <p className="text-[12px] text-dim">{row.open} {row.open === 1 ? 'window' : 'windows'} open</p>}
            <label className="mt-1 flex items-center gap-2 text-[12px] text-cream">
                <input type="checkbox" checked={row.atStartup} style={ACCENT} onChange={e => void window.zanaris.servers.setStartup(row.id, e.target.checked)} />
                Open at startup
            </label>
        </li>
    );
}

/** The Servers tool: every catalog entry, each with Open and a startup checkbox. Add and Remove are not here yet — a pane for "what else can I play" that no one server answers. */
export default function Servers({ view }: { view: ServersView }): ReactNode {
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <ul className="sunk mx-2.5 min-h-0 flex-1 overflow-y-auto">
                {view.rows.map(row => (
                    <Row key={row.id} row={row} />
                ))}
            </ul>
        </div>
    );
}
