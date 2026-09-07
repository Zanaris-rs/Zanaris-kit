import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { Rect, ShellState, ToolId } from '../shared/ipc';
import type { LayoutMode } from '../shared/layout';
import { Chat as ChatIcon, Globe, Hearth, PanelToggle } from './icons';
import Tab from './tab';
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

/** The bar spans the window, so only its underside is bevelled. */
const STRIP_BAR: CSSProperties = { borderTop: 'none', borderLeft: 'none', borderRight: 'none' };
/* A tab is not one of the surfaces that carry the stone's text shadow, and a gold
   digit on a lit sprite needs one of its own to stay a digit. */
const BADGE: CSSProperties = { textShadow: '1px 1px 0 rgba(0, 0, 0, 0.9)' };

/**
 * What fitting the chrome cost, per axis, in plain words — null where it cost
 * nothing worth saying. The axes are two sentences rather than one because
 * they are two events: the panel can slide the window left in the same breath
 * as the dock scales the game down, and somebody who hits both is owed both.
 */
const MODE_NOTE: Record<'x' | 'y', Record<LayoutMode, string | null>> = {
    x: {
        widen: null,
        shift: 'The window moved left to make room.',
        push: 'No room to widen, so the game area is narrower than the canvas and the page scales it down.'
    },
    y: {
        widen: null,
        shift: 'The window moved up to make room.',
        push: 'No room to grow taller, so the game area is shorter than the canvas and the page scales it down.'
    }
};

/** Both notes, in axis order, and neither when the window fitted its chrome by growing. */
function modeNotes(mode: { x: LayoutMode; y: LayoutMode }): string[] {
    return [MODE_NOTE.x[mode.x], MODE_NOTE.y[mode.y]].filter((note): note is string => note !== null);
}

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
    return state.chat.channels.reduce((total, channel) => total + channel.highlights, 0);
}

/**
 * The chrome around the game: strip, rail, panel and dock, drawn exactly where
 * main placed them. The content rect is left empty; the game view sits on top
 * of it. The panel and the dock are independent regions and can both be open;
 * which one holds chat is main's to say, and arrives as `chatHome`.
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
    const notes = modeNotes(state.mode);
    const revision = revisionOf(state);
    const tools = TOOLS.filter(t => state.tools.includes(t.id));
    const active = state.panelOpen ? state.activeTool : null;
    const unread = unreadChat(state);

    return (
        <div className="relative h-full overflow-hidden bg-ink text-cream">
            <div style={at(rects.strip)} className="flex flex-col">
                <header role="tablist" style={STRIP_BAR} className="tile flex flex-1 items-center gap-[5px] px-1.5">
                    {state.tabs.map(tab => (
                        <Tab
                            key={tab.id}
                            role="tab"
                            label={tab.title}
                            open={tab.active}
                            after={tab.kind === 'game' ? <span className="shrink-0 text-[12px] text-faint">{revision}</span> : null}
                        />
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
                    {active === 'chat' ? (
                        /* The panel is the side, so chat drawn in it is chat at home on the side. */
                        <Chat view={state.chat} home="side" />
                    ) : active === 'worlds' && state.worlds ? (
                        <Worlds view={state.worlds} />
                    ) : active === 'singleplayer' && state.singlePlayer ? (
                        <SinglePlayer view={state.singlePlayer} />
                    ) : (
                        /*
                         * The last arm of the ternary rather than a state anyone can
                         * reach: every window offers chat, so the rail is never empty;
                         * main refuses to open the panel onto a column with no legal
                         * occupant; and every tool a window offers arrives with a view
                         * to draw. What this used to say — pick a tool on the rail —
                         * became a lie the moment chat could live at the bottom, since
                         * a server whose only tool is chat then has nothing the rail
                         * can put here. So it says something that stays true if it
                         * ever does render, instead of naming an action that may not
                         * exist.
                         */
                        <div className="px-2.5">
                            <h2 className="title">Tools</h2>
                            <p className="text-[12px] text-dim">Nothing is open here.</p>
                        </div>
                    )}
                    {notes.length > 0 && (
                        <div className="mt-auto flex flex-col gap-1 px-2.5 py-2 text-[12px] text-warn">
                            {notes.map(note => (
                                <p key={note}>{note}</p>
                            ))}
                        </div>
                    )}
                </aside>
            )}

            {/*
             * The dock. Main decides it exists, how tall it is and how far along
             * the window it runs; the shell only fills it. Chat is its one
             * possible occupant, which is why there is no tool switch here.
             */}
            {rects.dock && state.chatHome === 'bottom' && (
                <section style={at(rects.dock)} className="dock flex flex-col" aria-label="Chat">
                    <Chat view={state.chat} home="bottom" />
                </section>
            )}

            {/* .rail paints the stone; main sizes it, so the stack of tabs is laid out here. */}
            <nav style={at(rects.rail)} className="rail flex flex-col items-center gap-1 py-[5px]" aria-label="Tools">
                {tools.map((tool, i) => {
                    const badge = tool.id === 'chat' ? unread : 0;
                    /*
                     * While chat lives at the bottom its rail tab is the dock's
                     * switch, so it reports the dock rather than the column chat no
                     * longer occupies. Only the pressed state branches: main routes
                     * the Chat tab by home on its own, and the null below still
                     * means "shut the panel", which is never what the dock's switch
                     * is asking for.
                     */
                    const on = tool.id === 'chat' && state.chatHome === 'bottom' ? state.dockOpen : active === tool.id;
                    const previous = tools[i - 1];
                    return (
                        <Fragment key={tool.id}>
                            {previous && previous.group !== tool.group && <div className="sep" aria-hidden="true" />}
                            <button
                                type="button"
                                title={tool.label}
                                aria-label={badge > 0 ? `${tool.label}, ${badge} unread` : tool.label}
                                aria-pressed={on}
                                onClick={() => void window.zanaris.shell.selectTool(active === tool.id ? null : tool.id)}
                                className={`tab relative ${on ? 'tab-on' : ''}`}
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
