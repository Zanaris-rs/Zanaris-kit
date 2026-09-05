import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { Rect, ShellState, TabInfo, ToolId } from '../shared/ipc';
import Worlds from './tools/Worlds';

const at = (r: Rect): CSSProperties => ({ position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height });

function revisionOf(state: ShellState): string {
    return state.server.revision === null ? 'rev unknown' : `rev ${state.server.revision}`;
}

function Tab({ tab, revision }: { tab: TabInfo; revision: string }): ReactNode {
    return (
        <div
            role="tab"
            aria-selected={tab.active}
            className={`flex h-[26px] items-center gap-2 px-2.5 ${tab.active ? 'slab' : 'border-3 border-transparent text-dim'}`}
        >
            <span className="truncate">{tab.title}</span>
            {tab.kind === 'game' && <span className="shrink-0 text-[12px] text-faint">{revision}</span>}
        </div>
    );
}

const MODE_NOTE: Record<ShellState['mode'], string | null> = {
    widen: null,
    shift: 'The window moved left to make room.',
    push: 'No room to widen, so the game area is narrower than the canvas and the page scales it down.'
};

/**
 * The rail's tools, in order. Main says which of these a window offers. The
 * icons are drawn with a heavy square-capped stroke so they sit with the
 * pixel type rather than looking like a modern icon set dropped in.
 */
const TOOLS: { id: ToolId; label: string; icon: ReactNode }[] = [
    {
        id: 'worlds',
        label: 'Worlds',
        icon: (
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" shapeRendering="crispEdges">
                <circle cx="9" cy="9" r="7" />
                <path d="M2 9h14M9 2c2.5 2.5 2.5 11.5 0 14M9 2c-2.5 2.5-2.5 11.5 0 14" />
            </svg>
        )
    }
];

/**
 * The chrome around the game: strip, rail and panel, drawn exactly where main
 * placed them. The content rect is left empty; the game view sits on top of it.
 */
export default function Shell(): ReactNode {
    const [state, setState] = useState<ShellState | null>(null);

    useEffect(() => {
        let alive = true;
        void window.swiftkit.shell.get().then(s => {
            if (alive && s) setState(s);
        });
        const unsubscribe = window.swiftkit.shell.onState(setState);
        return () => {
            alive = false;
            unsubscribe();
        };
    }, []);

    if (!state) return <div className="h-full bg-ink" />;

    const { rects } = state;
    const note = MODE_NOTE[state.mode];
    const tools = TOOLS.filter(t => state.tools.includes(t.id));
    const active = state.panelOpen ? state.activeTool : null;

    return (
        <div className="relative h-full overflow-hidden bg-ink text-bone">
            <header style={at(rects.strip)} className="flex items-center gap-1 px-1.5" role="tablist">
                {state.tabs.map(tab => (
                    <Tab key={tab.id} tab={tab} revision={revisionOf(state)} />
                ))}
                <button
                    type="button"
                    onClick={() => void window.swiftkit.shell.togglePanel()}
                    aria-label={state.panelOpen ? 'Close panel' : 'Open panel'}
                    aria-pressed={state.panelOpen}
                    className="slab slab-button ml-auto flex h-[26px] w-[32px] items-center justify-center text-dim"
                >
                    <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" shapeRendering="crispEdges">
                        <rect x="1" y="1" width="12" height="10" />
                        <path d="M9.5 1v10" />
                    </svg>
                </button>
            </header>

            <div style={at(rects.content)} className="bg-ink" aria-hidden="true" />

            {rects.panel && (
                <aside style={at(rects.panel)} className="slab flex flex-col">
                    {active === 'worlds' && state.worlds ? (
                        <Worlds view={state.worlds} />
                    ) : (
                        <div className="px-3 py-2.5">
                            <h2 className="font-pixel text-[17px] text-gold">Tools</h2>
                            <p className="mt-1.5 text-[12px] text-dim">
                                {tools.length === 0 ? 'This server has one page, so there is nothing to switch.' : 'Pick a tool on the rail.'}
                            </p>
                        </div>
                    )}
                    {note && <p className="mt-auto px-3 py-2 text-[12px] text-warn">{note}</p>}
                </aside>
            )}

            <nav style={at(rects.rail)} className="flex flex-col items-center gap-1.5 pt-1.5" aria-label="Tools">
                {tools.map(tool => (
                    <button
                        key={tool.id}
                        type="button"
                        title={tool.label}
                        aria-label={tool.label}
                        aria-pressed={active === tool.id}
                        onClick={() => void window.swiftkit.shell.selectTool(active === tool.id ? null : tool.id)}
                        className={`slab slab-button flex h-[34px] w-[34px] items-center justify-center ${active === tool.id ? 'text-gold' : 'text-dim'}`}
                        style={active === tool.id ? { borderStyle: 'inset' } : undefined}
                    >
                        {tool.icon}
                    </button>
                ))}
            </nav>
        </div>
    );
}
