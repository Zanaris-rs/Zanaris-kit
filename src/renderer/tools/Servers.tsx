import type { ReactNode } from 'react';
import type { ServerRow, ServersView } from '../../main/servers.ts';

/** One line of the catalog: its name, revision if it has one, notes if any, and how many windows have it open. Nothing here is a control yet — the pane is read-only until Remove, Add and the startup toggle arrive. */
function Row({ row }: { row: ServerRow }): ReactNode {
    return (
        <li className="border-b border-edge-dark px-2 py-1.5 last:border-b-0">
            <div className="flex min-w-0 items-center gap-1">
                <span className="min-w-0 truncate">{row.name}</span>
                {row.revision !== null && (
                    <span className="shrink-0 border border-edge-lit px-[3px] text-[10px] leading-[13px] text-dim">rev {row.revision}</span>
                )}
            </div>
            {row.notes && <p className="text-[12px] text-dim">{row.notes}</p>}
            {row.open > 0 && <p className="text-[12px] text-dim">{row.open} {row.open === 1 ? 'window' : 'windows'} open</p>}
        </li>
    );
}

/** The Servers tool: every catalog entry, read-only for now — a pane for "what else can I play" that no one server answers. */
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
