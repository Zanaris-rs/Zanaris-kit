import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { Rect, ShellState, ToolId } from '../shared/ipc';
import { DOCK_HEIGHT_MIN, PAGE_WIDTH_MIN, type LayoutMode } from '../shared/layout';
import { Bars, Book, Chat as ChatIcon, CloseRoom, Globe, Hearth, PaneToggle, PanelToggle } from './icons';
import Grip from './grip';
import PageToolbar from './pageToolbar';
import Tab from './tab';
import Chat from './tools/Chat';
import Guides from './tools/Guides';
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
 * The game's read-out keeps the raised tile it has always had, which now says
 * something it did not before: the tabs beside it are cut into the stone or
 * lifted above it, and a tile is neither, so the badge reads as chrome rather
 * than as a page that happens to be open.
 */
const BADGE_BOX: CSSProperties = { height: 26, width: 'auto' };
/**
 * The strip's two toggles, sized inline because `.tab` carries the rail's
 * 36x34 square and is unlayered CSS — which beats a Tailwind utility outright,
 * whatever the specificity. This is the same reason `tab.tsx` sizes its own box
 * inline rather than with `h-[26px]`.
 */
const TOGGLE_BOX: CSSProperties = { height: 26, width: 32 };
/**
 * A page tab and its close are one item of the strip, the way a room and its
 * close are one item of the dock's row: the close reads as part of the page it
 * shuts rather than as another piece of the strip's furniture.
 *
 * `min-w-0` here and not in the dock's slot, because these do run out of room.
 * Eleven links can all be open at once, and a strip that could not shrink them
 * would push its own controls off the right edge instead.
 */
const PAGE_SLOT = 'flex min-w-0 items-center gap-[2px]';

/**
 * What fitting the chrome cost, per axis, in plain words — null where it cost
 * nothing worth saying. The axes are two sentences rather than one because
 * they are two events: the panel can slide the window left in the same breath
 * as the dock takes height off the game, and somebody who hits both is owed
 * both.
 *
 * Neither push sentence promises the page will scale to follow, because it
 * will not: the served client is a fixed 765x503 canvas, and its fit-to-window
 * branch runs only for someone who has picked "Auto Sizing" from the controls
 * under the game. The default is 1x, so what actually happens is that the view
 * gets shorter than the page: first the controls strip below the canvas goes
 * out of view, then the canvas's own bottom — behind no scrollbar, since we
 * hide those. The note has to say that, and say scrolling still reaches it,
 * rather than describe a rescale that never happened.
 */
const MODE_NOTE: Record<'x' | 'y', Record<LayoutMode, string | null>> = {
    x: {
        widen: null,
        shift: 'The window moved left to make room.',
        push: 'No room to widen, so the width came out of the panel, down to the narrowest it is still usable at — past that, the game area is what gives way and can fall below the canvas width.'
    },
    y: {
        widen: null,
        shift: 'The window moved up to make room.',
        push: 'No room to grow taller, so the height came out of the game area and the bottom of the canvas can fall out of view. Scrolling still reaches it; "Auto Sizing" under the game scales the page to fit instead.'
    }
};

/**
 * The x note with a reference pane in the way, which changes the order enough
 * to be worth a sentence of its own: the pane sits between the game and the
 * panel and has a floor of its own, so the panel is spent to its floor first,
 * then the pane down to that floor, and only then does the game go below its
 * canvas. Saying "the panel is what gives way" here would name the one thing
 * that has already given everything it has.
 */
const PUSH_X_WITH_PANE =
    'No room to widen, so the width came out of the panel first, then the reference pane, each down to the narrowest it is still usable at. Only then is the game area narrower than the canvas, and its right edge can fall out of view — scrolling still reaches it.';

/** The notes for the given axes, in axis order, and none where the window fitted its chrome by growing. */
function modeNotes(mode: { x: LayoutMode; y: LayoutMode }, axes: readonly ('x' | 'y')[], paneShowing: boolean): string[] {
    return axes
        .map(axis => (axis === 'x' && mode.x === 'push' && paneShowing ? PUSH_X_WITH_PANE : MODE_NOTE[axis][mode[axis]]))
        .filter((note): note is string => note !== null);
}

/**
 * A note hangs off the chrome that caused it: the panel is what widened the
 * window, the dock is what grew it taller. So each region shows its own axis'
 * note — and picks up the other axis' note as well whenever the region that
 * owns it is closed, which is what keeps a note from having nowhere to go.
 *
 * Both open and both axes pushed is therefore two regions with one note each,
 * never the same sentence twice; whichever one is open alone carries both.
 * That second half is not a nicety, because an axis can push with its own
 * region shut: the rail costs width whether or not the panel is open, the
 * strip costs height whether or not the dock is, and a maximised window has
 * neither to spare. So the axis with nothing of its own on screen is exactly
 * the one whose note would otherwise be dropped, and the region that is open
 * is the only place left to hang it. Neither region open leaves both undrawn,
 * as it always has: there is no chrome on screen to hang them from.
 */
function noteAxes(otherRegionOpen: boolean, own: 'x' | 'y'): readonly ('x' | 'y')[] {
    return otherRegionOpen ? [own] : ['x', 'y'];
}

/** The warning under a region, in the words the region's own axis earned. Absent, not empty, when there is nothing to say. */
function ModeNotes({ notes }: { notes: string[] }): ReactNode {
    if (notes.length === 0) return null;
    return (
        <div className="mt-auto flex flex-col gap-1 px-2.5 py-2 text-[12px] text-warn">
            {notes.map(note => (
                <p key={note}>{note}</p>
            ))}
        </div>
    );
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
 *
 * The order here is one of three copies of the rail's order, and the other two
 * live in main: the tools builder in `main/serverWindow.ts`, which feeds
 * `firstLegalSideOccupant` and so `panelAvailable`, and `RAIL` in
 * `main/chatDock.test.ts`, which stands in for that builder. Nothing links
 * them and no test compares them, so reordering this list means editing those
 * two as well — and it is a live question now that a remote window on a server
 * with links offers Worlds, Hiscores and Guides rather than one server tool at
 * most.
 */
const TOOLS: { id: ToolId; label: string; group: 'app' | 'server'; icon: ReactNode }[] = [
    { id: 'chat', label: 'Chat', group: 'app', icon: <ChatIcon /> },
    { id: 'worlds', label: 'Worlds', group: 'server', icon: <Globe /> },
    { id: 'hiscores', label: 'Hiscores', group: 'server', icon: <Bars /> },
    { id: 'guides', label: 'Guides', group: 'server', icon: <Book /> },
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
    /* Main sends a dock rect only while the dock is open; the home is checked with it because the two arrive in one state and only one of them says which region chat is in. */
    const dock = state.chatHome === 'bottom' ? rects.dock : null;
    const revision = revisionOf(state);
    const tools = TOOLS.filter(t => state.tools.includes(t.id));
    const active = state.panelOpen ? state.activeTool : null;
    const unread = unreadChat(state);
    /*
     * Main says whether the side column has anything that could open in it; on
     * a chat-only server with chat in the dock it has not, and main would
     * refuse the open. The button says so rather than looking live, and names
     * the reason: an unexplained dead control is the same bug wearing a
     * different face.
     */
    const paneShowing = rects.page !== null;
    const paneLabel = state.pages.collapsed ? 'Show the reference pane' : 'Hide the reference pane';
    const panelLabel = !state.panelAvailable
        ? 'Nothing can open in the panel here: chat is docked at the bottom and this window has no other tool'
        : state.panelOpen
          ? 'Close panel'
          : 'Open panel';

    return (
        <div className="relative h-full overflow-hidden bg-ink text-cream">
            <div style={at(rects.strip)} className="flex flex-col">
                <header role="tablist" style={STRIP_BAR} className="tile flex flex-1 items-center gap-[5px] px-1.5">
                    {/*
                     * Where a pinned game tab used to be. The game is never
                     * behind anything now, so there was nothing left to switch
                     * to — what is left is the read-out the tab was carrying,
                     * and a badge says that without claiming to be a control.
                     */}
                    <div style={BADGE_BOX} title={state.gameLabel} className="tile flex min-w-0 items-center gap-[7px] px-2.5">
                        <span className="truncate">{state.gameLabel}</span>
                        <span className="shrink-0 text-[12px] text-faint">{revision}</span>
                    </div>
                    {state.pages.tabs.map(tab => (
                        <div key={tab.id} className={PAGE_SLOT}>
                            <Tab
                                role="tab"
                                label={tab.label}
                                open={tab.active && !state.pages.collapsed}
                                onSelect={() => void window.zanaris.pages.activate(tab.id)}
                            />
                            {/* Beside the tab, never in its `after`, which renders inside the
                                tab's own button — a button within a button is invalid HTML that
                                no two browsers agree on. */}
                            <button
                                type="button"
                                title={`Close ${tab.label}`}
                                aria-label={`Close ${tab.label}`}
                                onClick={() => void window.zanaris.pages.close(tab.id)}
                                className="tile flex w-[24px] shrink-0 items-center justify-center self-stretch text-faint hover:text-cream"
                            >
                                <CloseRoom />
                            </button>
                        </div>
                    ))}
                    {state.pages.tabs.length > 0 && (
                        <button
                            type="button"
                            onClick={() => void window.zanaris.pages.setCollapsed(!state.pages.collapsed)}
                            title={paneLabel}
                            aria-label={paneLabel}
                            aria-pressed={!state.pages.collapsed}
                            style={TOGGLE_BOX}
                            className={`ml-auto shrink-0 tab${state.pages.collapsed ? '' : ' tab-on'}`}
                        >
                            <PaneToggle open={!state.pages.collapsed} />
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => void window.zanaris.shell.togglePanel()}
                        disabled={!state.panelAvailable}
                        title={panelLabel}
                        aria-label={panelLabel}
                        aria-pressed={state.panelOpen}
                        style={TOGGLE_BOX}
                        /* `.tab` dims its own glyph to 78% until it is open, so the icon needs no colour of its own here. */
                        className={`shrink-0 tab${state.panelOpen ? ' tab-on' : ''} disabled:opacity-60${state.pages.tabs.length > 0 ? '' : ' ml-auto'}`}
                    >
                        <PanelToggle />
                    </button>
                </header>
                {/* The client parts its bars with a dark rule lit along the top, never a flat hairline. */}
                <div className="h-[2px] shrink-0 bg-edge-dark shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]" />
            </div>

            <div style={at(rects.content)} className="bg-ink" aria-hidden="true" />

            {/*
             * The seam. Both sides of it are native views, so this strip of
             * shell between them is the only thing a pointer can reach — main
             * reserves it, and the grip fills it exactly.
             */}
            {rects.seam && (
                <div style={at(rects.seam)} className="relative bg-edge-dark">
                    <Grip
                        axis="x"
                        value={state.pages.width}
                        min={PAGE_WIDTH_MIN}
                        label="Resize the reference pane"
                        /*
                         * Main's own ceiling, sent with the state rather than
                         * estimated here — the formula depends on which display
                         * the window is on and on whether the panel is open, and
                         * a second copy of it in the renderer would be a second
                         * copy to keep in step with the first.
                         */
                        announceMax={() => state.pages.maxWidth}
                        reachMax={() => state.pages.maxWidth}
                        apply={px => window.zanaris.pages.setWidth(px)}
                    />
                </div>
            )}

            {rects.pageToolbar && state.pages.active && (
                <div style={{ ...at(rects.pageToolbar), borderLeft: 'none', borderRight: 'none' }} className="tile">
                    <PageToolbar view={state.pages.active} />
                </div>
            )}

            {/* Left empty, like the game's rect: the page's own view sits on top of it. */}
            {rects.page && <div style={at(rects.page)} className="bg-ink" aria-hidden="true" />}

            {rects.panel && (
                <aside style={{ ...at(rects.panel), borderRight: 'none' }} className="tile flex flex-col">
                    {active === 'chat' ? (
                        /* The panel is the side, so chat drawn in it is chat at home on the side. */
                        <Chat view={state.chat} home="side" />
                    ) : active === 'worlds' && state.worlds ? (
                        <Worlds view={state.worlds} />
                    ) : active === 'hiscores' && state.hiscores ? (
                        <Hiscores view={state.hiscores} />
                    ) : active === 'guides' ? (
                        <Guides links={state.server.bookmarks} pages={state.pages} />
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
                    <ModeNotes notes={modeNotes(state.mode, noteAxes(dock !== null, 'x'), paneShowing)} />
                </aside>
            )}

            {/*
             * The dock. Main decides it exists, how tall it is and how far along
             * the window it runs; the shell only fills it. Chat is its one
             * possible occupant, which is why there is no tool switch here.
             */}
            {dock && (
                <section style={at(dock)} className="dock flex flex-col" aria-label="Chat">
                    <Grip
                        axis="y"
                        value={state.dockHeight}
                        min={DOCK_HEIGHT_MIN}
                        label="Resize chat"
                        /*
                         * The true ceiling is workArea.height / 2 on whichever
                         * display the window is on, and only main can see that
                         * display. window.screen is the same idea from the
                         * renderer's own side of the glass — close enough for a
                         * screen reader's announcement without a round trip, or
                         * a second formula that could drift from main's one.
                         * End asks for the whole height so that main's clamp,
                         * not this estimate, is what decides where it lands.
                         */
                        announceMax={() => Math.round(window.screen.availHeight / 2)}
                        reachMax={() => window.screen.availHeight}
                        apply={px => window.zanaris.chat.setDockHeight(px)}
                    />
                    <Chat view={state.chat} home="bottom" />
                    {/* Under the composer, on the edge of the window: the dock is usually what pushed the y axis, and until now the note for it only ever rendered inside a side panel that a chat-only server cannot even open. */}
                    <ModeNotes notes={modeNotes(state.mode, noteAxes(rects.panel !== null, 'y'), paneShowing)} />
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
