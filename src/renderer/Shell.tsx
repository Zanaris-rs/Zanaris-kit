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
            className={`flex h-[26px] items-center gap-2 border px-3 text-[12px] ${
                tab.active ? 'border-line bg-surface text-bone' : 'border-transparent text-dim'
            }`}
        >
            <span className="truncate">{tab.title}</span>
            {tab.kind === 'game' && <span className="shrink-0 text-[11px] text-dim">{revision}</span>}
        </div>
    );
}

const MODE_NOTE: Record<ShellState['mode'], string | null> = {
    widen: null,
    shift: 'The window moved left to make room.',
    push: 'No room to widen, so the game area is narrower than the canvas and the page scales it down.'
};

/** The rail's tools, in order. Main says which of these a window offers. */
const TOOLS: { id: ToolId; label: string; icon: ReactNode }[] = [
    {
        id: 'worlds',
        label: 'Worlds',
        icon: (
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
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
            <header style={at(rects.strip)} className="flex items-center gap-1 border-b border-line px-2" role="tablist">
                {state.tabs.map(tab => (
                    <Tab key={tab.id} tab={tab} revision={revisionOf(state)} />
                ))}
                <button
                    type="button"
                    onClick={() => void window.swiftkit.shell.togglePanel()}
                    aria-label={state.panelOpen ? 'Close panel' : 'Open panel'}
                    aria-pressed={state.panelOpen}
                    className="ml-auto flex h-[26px] w-[30px] items-center justify-center border border-transparent text-dim hover:border-line hover:text-bone"
                >
                    <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="0.75" y="0.75" width="12.5" height="10.5" />
                        <path d="M9.5 0.75v10.5" />
                    </svg>
                </button>
            </header>

            <div style={at(rects.content)} className="bg-black" aria-hidden="true" />

            {rects.panel && (
                <aside style={at(rects.panel)} className="flex flex-col border-l border-line">
                    {active === 'worlds' && state.worlds ? (
                        <Worlds view={state.worlds} />
                    ) : (
                        <div className="px-4 py-3">
                            <h2 className="font-medium text-bone">Tools</h2>
                            <p className="mt-1 text-[12px] text-dim">
                                {tools.length === 0 ? 'This server has nothing to switch yet.' : 'Pick a tool on the rail.'}
                            </p>
                        </div>
                    )}
                    {note && <p className="border-t border-line px-4 py-2 text-[12px] text-brass">{note}</p>}
                </aside>
            )}

            <nav style={at(rects.rail)} className="flex flex-col items-center gap-2 border-l border-line pt-2" aria-label="Tools">
                {tools.map(tool => (
                    <button
                        key={tool.id}
                        type="button"
                        title={tool.label}
                        aria-label={tool.label}
                        aria-pressed={active === tool.id}
                        onClick={() => void window.swiftkit.shell.selectTool(active === tool.id ? null : tool.id)}
                        className={`flex h-[36px] w-[36px] items-center justify-center border ${
                            active === tool.id ? 'border-brass text-brass' : 'border-transparent text-dim hover:border-line hover:text-bone'
                        }`}
                    >
                        {tool.icon}
                    </button>
                ))}
            </nav>
        </div>
    );
}
