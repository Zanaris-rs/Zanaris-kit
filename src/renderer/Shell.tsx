import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { Rect, ShellState, ToolId } from '../shared/ipc';
import type { PaneView, SeamView } from '../shared/panes';
import { PAGE_TOOLBAR_HEIGHT } from '../shared/layout';
import { Bars, Chat as ChatIcon, CloseRoom, Globe, Hearth, Plus } from './icons';
import Grip from './grip';
import Launcher from './Launcher';
import Tab from './tab';
import PageToolbar from './pageToolbar';
import Chat from './tools/Chat';
import Hiscores from './tools/Hiscores';
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
 * The game's read-out keeps the raised tile it has always had. It sits at the
 * left of the bar rather than among anything, because it is the window's: the
 * window is bound to one server and has one game, so the read-out belongs to
 * neither a pane nor a tab.
 */
const BADGE_BOX: CSSProperties = { height: 26, width: 'auto' };
/**
 * A tab and its close are one item of the bar, the way a room and its close are
 * one item of chat's row: the close reads as part of the workspace it shuts
 * rather than as another piece of the bar's furniture.
 *
 * `min-w-0` because these do run out of room — a window can hold as many tabs
 * as the user makes, and a bar that could not shrink them would push the new-tab
 * control off its own right edge instead.
 */
const TAB_SLOT = 'flex min-w-0 items-center gap-[2px]';
/** Sized inline for the reason `tab.tsx` sizes its own box inline: `.tab` carries the rail's 36x34 square and is unlayered CSS, which beats a utility of equal specificity whatever the order. */
const NEW_TAB_BOX: CSSProperties = { height: 26, width: 28 };

/**
 * The ring drawn around the focused pane.
 *
 * A native view cannot be outlined from inside itself, so this is drawn on the
 * shell *around* the pane's rect — which needs a pixel of shell to land on.
 * Between panes there is the seam; at the window's edge main insets the tree by
 * one. `layoutTree` is deliberately unaware that either gap is for this.
 */
function focusRing(rect: Rect): CSSProperties {
    return { position: 'absolute', left: rect.x - 1, top: rect.y - 1, width: rect.width + 2, height: rect.height + 2 };
}

const TOOLS: { id: ToolId; label: string; group: 'app' | 'server'; icon: ReactNode }[] = [
    { id: 'chat', label: 'Chat', group: 'app', icon: <ChatIcon /> },
    { id: 'worlds', label: 'Worlds', group: 'server', icon: <Globe /> },
    { id: 'hiscores', label: 'Hiscores', group: 'server', icon: <Bars /> },
    { id: 'singleplayer', label: 'Single player', group: 'server', icon: <Hearth /> }
];

/** Highlights are lines that named you, so the count is worth carrying on the rail. */
function unreadChat(state: ShellState): number {
    return state.chat.channels.reduce((total, channel) => total + channel.highlights, 0);
}

/**
 * What the shell draws inside one pane.
 *
 * Two of the four kinds draw nothing at all: a game or a page is a native
 * WebContentsView that main has already positioned on top of this rect, so the
 * shell leaves it empty exactly as it left the old content rect empty. A page
 * still gets its toolbar, which is shell, drawn in the top of the pane's own
 * rect — the view below it is inset by the same constant.
 */
function PaneBody({ pane, state }: { pane: PaneView; state: ShellState }): ReactNode {
    switch (pane.content.kind) {
        case 'empty':
            return (
                <Launcher
                    paneId={pane.paneId}
                    links={state.server.bookmarks}
                    tools={state.tools}
                    gameAvailable={!state.panes.some(p => p.content.kind === 'game')}
                />
            );
        case 'game':
            return null;
        case 'page':
            return pane.page ? (
                <div style={{ height: PAGE_TOOLBAR_HEIGHT, borderLeft: 'none', borderRight: 'none' }} className="tile">
                    <PageToolbar view={pane.page} />
                </div>
            ) : null;
        case 'tool':
            switch (pane.content.tool) {
                case 'chat':
                    return <Chat view={state.chat} width={pane.rect.width} />;
                case 'worlds':
                    return state.worlds ? <Worlds view={state.worlds} /> : null;
                case 'hiscores':
                    return state.hiscores ? <Hiscores view={state.hiscores} /> : null;
                case 'singleplayer':
                    return state.singlePlayer ? <SinglePlayer view={state.singlePlayer} /> : null;
            }
    }
}

/**
 * The grabbable gap between two panes.
 *
 * Both sides of it are native views, so this strip of shell is the only thing a
 * pointer can reach — main reserves it and the grip fills it exactly. Every
 * number the grip needs arrives with the seam, because the shell deliberately
 * knows nothing about the tree: not the fractions, not the minimums, not how
 * many children the split has. A second copy of any of that here would be a
 * second copy to keep in step with main's.
 */
function Seam({ seam }: { seam: SeamView }): ReactNode {
    return (
        <div style={at(seam.rect)} className="relative bg-edge-dark">
            <Grip
                axis={seam.axis}
                value={seam.size}
                min={seam.min}
                label={seam.axis === 'x' ? 'Resize these panes' : 'Resize these panes vertically'}
                announceMax={() => seam.max}
                reachMax={() => seam.max}
                apply={px => window.zanaris.panes.setSeam(seam.splitId, seam.index, px)}
            />
        </div>
    );
}

/**
 * The chrome around the panes: the bar across the top, the rail down the right,
 * and whatever each pane is, drawn exactly where main placed it.
 *
 * The window no longer has four fixed regions to arrange, so this no longer
 * arranges any. It renders a list, and the list is main's.
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
    const revision = revisionOf(state);
    const tools = TOOLS.filter(t => state.tools.includes(t.id));
    const unread = unreadChat(state);

    return (
        <div className="relative h-full overflow-hidden bg-ink text-cream">
            <div style={at(rects.tabBar)} className="flex flex-col">
                <header role="tablist" style={STRIP_BAR} className="tile flex flex-1 items-center gap-[5px] px-1.5">
                    {/*
                     * The window's read-out, not any tab's: the window is bound
                     * to one server and has one game, so it sits before the tabs
                     * rather than among them. A tile says that without claiming
                     * to be a control — the tabs beside it are cut into the
                     * stone or lifted above it, and a tile is neither.
                     */}
                    <div style={BADGE_BOX} title={state.gameLabel} className="tile flex min-w-0 items-center gap-[7px] px-2.5">
                        <span className="truncate">{state.gameLabel}</span>
                        <span className="shrink-0 text-[12px] text-faint">{revision}</span>
                    </div>
                    {state.tabs.map(tab => (
                        <div key={tab.id} className={TAB_SLOT}>
                            <Tab
                                role="tab"
                                label={tab.label}
                                title={tab.hasGame ? `${tab.label} — the game is in this tab` : tab.label}
                                open={tab.active}
                                onSelect={() => void window.zanaris.panes.selectTab(tab.id)}
                                /*
                                 * The character is in here. A running game in a
                                 * background tab is still in the world, so the
                                 * bar says which tab to come back to rather than
                                 * leaving it to be remembered.
                                 */
                                after={tab.hasGame ? <span className="ml-1 text-gold">&bull;</span> : undefined}
                            />
                            {/* Beside the tab, never in its `after`, which renders inside the
                                tab's own button — a button within a button is invalid HTML that
                                no two browsers agree on. */}
                            <button
                                type="button"
                                title={`Close ${tab.label}`}
                                aria-label={`Close ${tab.label}`}
                                onClick={() => void window.zanaris.panes.closeTab(tab.id)}
                                className="tile flex w-[24px] shrink-0 items-center justify-center self-stretch text-faint hover:text-cream"
                            >
                                <CloseRoom />
                            </button>
                        </div>
                    ))}
                    <button
                        type="button"
                        title="New tab"
                        aria-label="New tab"
                        onClick={() => void window.zanaris.panes.newTab()}
                        style={NEW_TAB_BOX}
                        className="tab shrink-0"
                    >
                        <Plus />
                    </button>
                </header>
                {/* The client parts its bars with a dark rule lit along the top, never a flat hairline. */}
                <div className="h-[2px] shrink-0 bg-edge-dark shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]" />
            </div>

            {state.panes.map(pane => (
                <Fragment key={pane.paneId}>
                    {pane.focused && <div style={focusRing(pane.rect)} className="pointer-events-none border border-gold" aria-hidden="true" />}
                    <div
                        style={at(pane.rect)}
                        onPointerDownCapture={() => void window.zanaris.panes.focus(pane.paneId)}
                        className={`flex flex-col overflow-hidden bg-ink${pane.content.kind === 'tool' ? ' tile' : ''}`}
                        /* A game or page pane is a hole for a native view; nothing in it is the shell's to describe. */
                        aria-hidden={pane.content.kind === 'game' || pane.content.kind === 'page' ? 'true' : undefined}
                    >
                        <PaneBody pane={pane} state={state} />
                    </div>
                </Fragment>
            ))}

            {state.seams.map(seam => (
                <Seam key={`${seam.splitId}:${seam.index}`} seam={seam} />
            ))}

            {/* .rail paints the stone; main sizes it, so the stack of tabs is laid out here. */}
            <nav style={at(rects.rail)} className="rail flex flex-col items-center gap-1 py-[5px]" aria-label="Tools">
                {tools.map((tool, i) => {
                    const badge = tool.id === 'chat' ? unread : 0;
                    const on = state.openTools.includes(tool.id);
                    const previous = tools[i - 1];
                    return (
                        <Fragment key={tool.id}>
                            {previous && previous.group !== tool.group && <div className="sep" aria-hidden="true" />}
                            <button
                                type="button"
                                title={tool.label}
                                aria-label={badge > 0 ? `${tool.label}, ${badge} unread` : tool.label}
                                aria-pressed={on}
                                onClick={() => void window.zanaris.shell.selectTool(tool.id)}
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
