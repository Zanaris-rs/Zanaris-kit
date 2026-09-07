import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { Rect, ShellState, TabInfo, ToolId } from '../shared/ipc';
import type { LayoutMode } from '../shared/layout';
import { Chat as ChatIcon, Globe, Hearth, PanelToggle } from './icons';
import Chat from './tools/Chat';
import SinglePlayer from './tools/SinglePlayer';
import Worlds from './tools/Worlds';

const at = (r: Rect): CSSProperties => ({ position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height });

function revisionOf(state: ShellState): string {
    return state.server.revision === null ? 'rev unknown' : `rev ${state.server.revision}`;
}

/*
 * The stone is hand-written CSS, not utilities, so the handful of places that
 * have to contradict it say so inline. A utility of equal specificity would be
 * decided by stylesheet order, which is not something to leave to chance.
 */

/** Strip tabs hug their label instead of taking the rail tab's fixed 36x34 square. */
const TAB_BOX: CSSProperties = { height: 26, width: 'auto' };
/** The bar spans the window, so only its underside is bevelled. */
const STRIP_BAR: CSSProperties = { borderTop: 'none', borderLeft: 'none', borderRight: 'none' };
/* A tab is not one of the surfaces that carry the stone's text shadow, and a gold
   digit on a lit sprite needs one of its own to stay a digit. */
const BADGE: CSSProperties = { textShadow: '1px 1px 0 rgba(0, 0, 0, 0.9)' };

/** The open tab is a raised tile; the rest are tabs cut into the strip. */
function Tab({ tab, revision }: { tab: TabInfo; revision: string }): ReactNode {
    return (
        <div
            role="tab"
            aria-selected={tab.active}
            style={TAB_BOX}
            className={`flex items-center gap-[7px] px-2.5 ${tab.active ? 'tile' : 'tab text-dim'}`}
        >
            <span className="truncate">{tab.title}</span>
            {tab.kind === 'game' && <span className="shrink-0 text-[12px] text-faint">{revision}</span>}
        </div>
    );
}

const MODE_NOTE: Record<LayoutMode, string | null> = {
    widen: null,
    shift: 'The window moved left to make room.',
    push: 'No room to widen, so the game area is narrower than the canvas and the page scales it down.'
};

/**
 * The rail's tools, in order. Main says which of these a window offers. The
 * icons are flat sprites on one dark outline, the way the client draws its own
 * interface tabs, so they sit with the pixel type rather than looking like a
 * modern icon set dropped in.
 *
 * A tool is either the app's or this window's server's, and the rail scores a
 * divider where one becomes the other: chat is one conversation shared by every
 * window, while worlds only means anything for the server in front of you.
 */
const TOOLS: { id: ToolId; label: string; group: 'app' | 'server'; icon: ReactNode }[] = [
    { id: 'chat', label: 'Chat', group: 'app', icon: <ChatIcon /> },
    { id: 'worlds', label: 'Worlds', group: 'server', icon: <Globe /> },
    { id: 'singleplayer', label: 'Single player', group: 'server', icon: <Hearth /> }
];

/** Highlights are lines that named you, so the count is worth carrying on the rail. */
function unreadChat(state: ShellState): number {
    if (!state.chat) return 0;
    return state.chat.channels.reduce((total, channel) => total + channel.highlights, 0);
}

/**
 * The chrome around the game: strip, rail and panel, drawn exactly where main
 * placed them. The content rect is left empty; the game view sits on top of it.
 */
export default function Shell(): ReactNode {
    const [state, setState] = useState<ShellState | null>(null);

    useEffect(() => {
        let alive = true;
        void window.zanaris.shell.get().then(s => {
            if (alive && s) setState(s);
        });
        const unsubscribe = window.zanaris.shell.onState(setState);
        return () => {
            alive = false;
            unsubscribe();
        };
    }, []);

    if (!state) return <div className="h-full bg-ink" />;

    const { rects } = state;
    const note = MODE_NOTE[state.mode.x];
    const tools = TOOLS.filter(t => state.tools.includes(t.id));
    const active = state.panelOpen ? state.activeTool : null;
    const unread = unreadChat(state);

    return (
        <div className="relative h-full overflow-hidden bg-ink text-cream">
            <div style={at(rects.strip)} className="flex flex-col">
                <header role="tablist" style={STRIP_BAR} className="tile flex flex-1 items-center gap-[5px] px-1.5">
                    {state.tabs.map(tab => (
                        <Tab key={tab.id} tab={tab} revision={revisionOf(state)} />
                    ))}
                    <button
                        type="button"
                        onClick={() => void window.zanaris.shell.togglePanel()}
                        aria-label={state.panelOpen ? 'Close panel' : 'Open panel'}
                        aria-pressed={state.panelOpen}
                        className="tile ml-auto flex h-[26px] w-[32px] shrink-0 items-center justify-center text-dim"
                    >
                        <PanelToggle />
                    </button>
                </header>
                {/* The client parts its bars with a dark rule lit along the top, never a flat hairline. */}
                <div className="h-[2px] shrink-0 bg-edge-dark shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]" />
            </div>

            <div style={at(rects.content)} className="bg-ink" aria-hidden="true" />

            {rects.panel && (
                <aside style={{ ...at(rects.panel), borderRight: 'none' }} className="tile flex flex-col">
                    {active === 'chat' && state.chat ? (
                        <Chat view={state.chat} />
                    ) : active === 'worlds' && state.worlds ? (
                        <Worlds view={state.worlds} />
                    ) : active === 'singleplayer' && state.singlePlayer ? (
                        <SinglePlayer view={state.singlePlayer} />
                    ) : (
                        <div className="px-2.5">
                            <h2 className="title">Tools</h2>
                            <p className="text-[12px] text-dim">
                                {tools.length === 0 ? 'This server has one page, so there is nothing to switch.' : 'Pick a tool on the rail.'}
                            </p>
                        </div>
                    )}
                    {note && <p className="mt-auto px-2.5 py-2 text-[12px] text-warn">{note}</p>}
                </aside>
            )}

            {/* .rail paints the stone; main sizes it, so the stack of tabs is laid out here. */}
            <nav style={at(rects.rail)} className="rail flex flex-col items-center gap-1 py-[5px]" aria-label="Tools">
                {tools.map((tool, i) => {
                    const badge = tool.id === 'chat' ? unread : 0;
                    const previous = tools[i - 1];
                    return (
                        <Fragment key={tool.id}>
                            {previous && previous.group !== tool.group && <div className="sep" aria-hidden="true" />}
                            <button
                                type="button"
                                title={tool.label}
                                aria-label={badge > 0 ? `${tool.label}, ${badge} unread` : tool.label}
                                aria-pressed={active === tool.id}
                                onClick={() => void window.zanaris.shell.selectTool(active === tool.id ? null : tool.id)}
                                className={`tab relative ${active === tool.id ? 'tab-on' : ''}`}
                            >
                                {tool.icon}
                                {/* The count sits on the tab rather than beside it: the rail is 48px wide. */}
                                {badge > 0 && (
                                    <span style={BADGE} className="absolute top-0 right-[3px] font-pixel text-[12px] leading-none text-gold">
                                        {badge > 99 ? '99+' : badge}
                                    </span>
                                )}
                            </button>
                        </Fragment>
                    );
                })}
            </nav>
        </div>
    );
}
