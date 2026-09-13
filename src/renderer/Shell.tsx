import { Fragment, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import type { Rect, ShellState, ToolId } from '../shared/ipc';
import type { PaneView, SeamView } from '../shared/panes';
import { PANE_HEADER_HEIGHT } from '../shared/layout';
import { Bars, Chat as ChatIcon, Globe, Hearth, Plus } from './icons';
import Grip from './grip';
import Launcher from './Launcher';
import PaneHeader, { type Grab } from './paneHeader';
import Tab from './tab';
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
/* The rail's unread count sits on a `.tab`, which is not one of the surfaces that
   carry the stone's text shadow, and a gold digit on a lit sprite needs one of its
   own to stay a digit. */
const BADGE: CSSProperties = { textShadow: '1px 1px 0 rgba(0, 0, 0, 0.9)' };
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
 * What the shell draws inside one pane, under the header every pane now has.
 *
 * Two of the four kinds draw nothing at all: a game or a page is a native
 * WebContentsView that main has already positioned over this rect, inset below
 * the header, so the shell leaves the rest of the pane empty exactly as it left
 * the old content rect empty. A page's back, forward and reload moved up into
 * the header with everything else that names a pane rather than works in one.
 */
function PaneBody({ pane, state }: { pane: PaneView; state: ShellState }): ReactNode {
    switch (pane.content.kind) {
        case 'empty':
            return <Launcher paneId={pane.paneId} links={state.server.bookmarks} contents={pane.contents ?? []} />;
        case 'game':
        case 'page':
            return null;
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

/** Below this a game pane has room for the world and the latency and nothing else. */
const ROOM_FOR_REVISION = 300;

/**
 * What the game pane's header says about the game: the server, its world, its
 * detail and the latency to that world's host, plus the revision it runs.
 *
 * It is still the window's fact rather than the pane's — one server, one game —
 * which is why it used to sit at the left of the tab bar. What that missed is
 * that a read-out nobody can place is a read-out nobody reads: beside the game
 * it describes, it is obviously about the thing under it, and the bar is left to
 * tabs. A pane with no game shows none of this, which is itself the honest
 * answer to "where is my character".
 *
 * The revision goes first when the pane is too narrow to hold both. It is the
 * server's fact rather than the moment's — it is the same number all session,
 * while the world and the latency beside it are the whole reason to look — so
 * it is the half worth losing. The title attribute keeps the full read-out
 * reachable however narrow the pane gets.
 */
function GameReadout({ state, width }: { state: ShellState; width: number }): ReactNode {
    /* No shadow of its own, unlike the rail's count: the header is a `.tile`, and every tile already puts one under its text. */
    return (
        <span title={`${state.gameLabel} · ${revisionOf(state)}`} className="flex min-w-0 shrink items-center gap-[7px] truncate">
            <span className="truncate">{state.gameLabel}</span>
            {width >= ROOM_FOR_REVISION && <span className="shrink-0 text-[12px] text-faint">{revisionOf(state)}</span>}
        </span>
    );
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
/** The pane a point falls in, or null for the seams and the chrome between them. */
function paneAt(panes: PaneView[], x: number, y: number): string | null {
    return panes.find(p => x >= p.rect.x && x < p.rect.x + p.rect.width && y >= p.rect.y && y < p.rect.y + p.rect.height)?.paneId ?? null;
}

export default function Shell(): ReactNode {
    const [state, setState] = useState<ShellState | null>(null);
    /**
     * The header drag. `held` is the pointer's, and survives a re-render; `drag`
     * is what the overlay reads, and causes them.
     *
     * Main hides every native view between the two IPC calls below, because the
     * shell cannot draw over a game or a page — those views sit above it, and a
     * drop target painted under either would be invisible. So the panes go blank
     * for the length of the gesture and each says its own name instead, which is
     * also what makes an empty-looking game pane legible while it is moving.
     */
    const held = useRef<{ from: string; pointerId: number } | null>(null);
    const [drag, setDrag] = useState<{ from: string; over: string | null } | null>(null);

    /* A drag interrupted by an unmount would otherwise leave every view hidden. */
    useEffect(
        () => () => {
            if (held.current) void window.zanaris.panes.setDragging(false);
        },
        []
    );

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

    const endDrag = (event: PointerEvent<HTMLDivElement>, drop: boolean): void => {
        const grabbed = held.current;
        if (!grabbed || event.pointerId !== grabbed.pointerId) return;
        held.current = null;
        const over = drop && state ? paneAt(state.panes, event.clientX, event.clientY) : null;
        setDrag(null);
        void window.zanaris.panes.setDragging(false);
        if (over && over !== grabbed.from) void window.zanaris.panes.swap(grabbed.from, over);
    };

    const grabFor = (paneId: string): Grab => ({
        onPointerDown: event => {
            // A press that began on a button is that button's: the nav arrows
            // and the caret must still click rather than start a drag.
            if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            held.current = { from: paneId, pointerId: event.pointerId };
            setDrag({ from: paneId, over: paneId });
            void window.zanaris.panes.setDragging(true);
        },
        onPointerMove: event => {
            const grabbed = held.current;
            if (!grabbed || event.pointerId !== grabbed.pointerId || !state) return;
            setDrag({ from: grabbed.from, over: paneAt(state.panes, event.clientX, event.clientY) });
        },
        onPointerUp: event => endDrag(event, true),
        onPointerCancel: event => endDrag(event, false)
    });

    if (!state) return <div className="h-full bg-ink" />;

    const { rects } = state;
    const tools = TOOLS.filter(t => state.tools.includes(t.id));
    const unread = unreadChat(state);

    return (
        <div className="relative h-full overflow-hidden bg-ink text-cream">
            <div style={at(rects.tabBar)} className="flex flex-col">
                {/*
                 * Tabs and the control that makes one, and nothing else. The
                 * game's read-out used to sit at this bar's left on the grounds
                 * that it was the window's rather than any tab's — true, but it
                 * left the bar reading as two unrelated things, and a read-out
                 * about the game is easiest to believe beside the game. It is in
                 * the game pane's own header now.
                 */}
                <header role="tablist" style={STRIP_BAR} className="tile flex flex-1 items-center gap-[5px] px-1.5">
                    {/*
                     * A tab and its close are one object: the close sits inside
                     * the tab it shuts, so it reads as part of that workspace
                     * rather than as another piece of the bar's furniture. Main
                     * asks first when the tab holds the game.
                     */}
                    {state.tabs.map(tab => (
                        <Tab
                            key={tab.id}
                            role="tab"
                            label={tab.label}
                            title={tab.label}
                            open={tab.active}
                            onSelect={() => void window.zanaris.panes.selectTab(tab.id)}
                            onClose={() => void window.zanaris.panes.closeTab(tab.id)}
                        />
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
                        /*
                         * A tool or empty pane anywhere, and every pane's header
                         * — that strip is shell whatever the pane holds. What
                         * does not reach here is a right-click on the game or a
                         * page *below* its header: that lands on the native view
                         * stacked above the shell, and main raises the same menu
                         * from there. clientX/Y are already the window's,
                         * because the shell view spans the whole content area.
                         */
                        onContextMenu={event => {
                            event.preventDefault();
                            void window.zanaris.panes.contextMenu(pane.paneId, event.clientX, event.clientY);
                        }}
                        className={`flex flex-col overflow-hidden bg-ink${pane.content.kind === 'tool' ? ' tile' : ''}`}
                    >
                        {/*
                         * Every pane, including the two whose bodies are holes
                         * for a native view: the header is the only part of a
                         * game or page pane the shell draws, and the only place
                         * either can say what it is.
                         */}
                        <PaneHeader
                            pane={pane}
                            readout={pane.content.kind === 'game' ? <GameReadout state={state} width={pane.rect.width} /> : undefined}
                            grab={grabFor(pane.paneId)}
                        />
                        <PaneBody pane={pane} state={state} />
                        {/*
                         * Over the body only, so the header stays readable and
                         * grabbable under the pointer that is dragging it. The
                         * pane being carried is dimmed; the one that would take
                         * it is lit. Everything says its name, because with the
                         * native views hidden a game or page pane has nothing
                         * else to identify it by.
                         */}
                        {drag && (
                            <div
                                aria-hidden="true"
                                className={`pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center font-pixel text-[15px] ${
                                    drag.from === pane.paneId
                                        ? 'text-faint opacity-60'
                                        : drag.over === pane.paneId
                                          ? 'border-2 border-gold bg-stone-lit/40 text-gold'
                                          : 'text-dim'
                                }`}
                                style={{ top: PANE_HEADER_HEIGHT }}
                            >
                                {pane.name}
                            </div>
                        )}
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
