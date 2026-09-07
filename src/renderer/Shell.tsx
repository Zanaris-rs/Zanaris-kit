import { Fragment, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { Rect, ShellState, ToolId } from '../shared/ipc';
import { DOCK_HEIGHT_MIN, type LayoutMode } from '../shared/layout';
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

/** A fine nudge, and Shift for the coarse one — a stroke of a drag in one press. */
const DOCK_STEP = 10;
const DOCK_STEP_COARSE = 50;

/**
 * The dock's top edge, draggable and, for anyone without a pointer, a
 * separator that answers arrow keys. Both paths call the same
 * `setDockHeight`, and neither clamps: main owns the range (`DOCK_HEIGHT_MIN`
 * up to half the work area), and restating it here would just be a second
 * copy of it to keep in step.
 *
 * `requested` tracks the height this component believes is current, and
 * `send` is the only thing allowed to move it: it sets `requested` to the
 * number being asked for, then — once `setDockHeight` resolves — sets it
 * again to whatever main actually applied. That second write is not optional.
 * Main skips its own layout work when a request lands exactly where the dock
 * already is, which happens at both ends of the range: one more ArrowDown at
 * the floor, an End already at the ceiling. Without a reply to correct it,
 * `requested` would be left holding the out-of-range number it optimistically
 * guessed, and every later key press would build the next request on that
 * wrong number instead of the real one — at the floor a few wasted presses
 * paying back the debt, at the ceiling (where the guess used to be
 * `Number.MAX_SAFE_INTEGER`) the control dead until the dock closed and
 * reopened. Resolving `setDockHeight` with the applied height, on every path
 * including the one that changes nothing, is what makes this safe rather
 * than a renderer-side clamp of our own. The effect below folds the same
 * confirmed value in whenever `height` changes for a reason that was not this
 * component's own request — another window dragging the shared height, most
 * plausibly.
 */
function DockGrip({ height }: { height: number }): ReactNode {
    const requested = useRef(height);
    useEffect(() => {
        requested.current = height;
    }, [height]);

    const drag = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
    /* The id of a scheduled frame, or null when none is pending. */
    const frame = useRef<number | null>(null);
    /* A pending frame calling back into an unmounted component would still reach main; nothing here needs that after the grip is gone. */
    useEffect(() => () => {
        if (frame.current !== null) cancelAnimationFrame(frame.current);
    }, []);

    /**
     * The exact ceiling, learned rather than guessed, the moment any request
     * overshoots it: main clamping a request down (`applied < px`) can only
     * mean the ceiling itself is `applied`. Until that happens this is null
     * and the announcement falls back to an estimate — see `announcedMax`.
     */
    const [exactMax, setExactMax] = useState<number | null>(null);

    /**
     * `px` is rounded here, once, before it goes anywhere else. A fractional
     * pixel height is meaningless — `clientY` is fractional on any HiDPI
     * display, which is routine — and without this, `applied < px` stops
     * meaning "main clamped this": main rounds too, so an unrounded request
     * like 200.33 comes back as 200 from ordinary rounding, no ceiling
     * involved, and would have latched `exactMax` onto an arbitrary drag
     * position forever. Rounding is not clamping — it does not narrow the
     * range main enforces, only the precision of what is asked for — so it
     * does not cross the line the spec draws about main being the authority.
     */
    const send = (px: number): void => {
        const rounded = Math.round(px);
        requested.current = rounded;
        void window.zanaris.chat.setDockHeight(rounded).then(applied => {
            requested.current = applied;
            if (applied < rounded) setExactMax(applied);
        });
    };

    const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: requested.current };
    };

    /*
     * The OS can report pointer movement far faster than the shell repaints,
     * and each repaint is a full setContentBounds — so only the freshest
     * position survives to the next frame. A frame already pending is left
     * alone and just has its target replaced; a fresh one is scheduled only
     * once nothing is in flight. That is what keeps a fast drag from queuing
     * a pile of setDockHeight calls behind the one that already supersedes
     * them all.
     */
    const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
        const d = drag.current;
        if (!d || event.pointerId !== d.pointerId) return;
        // Up is taller: the strip moves opposite to the screen's y axis.
        requested.current = d.startHeight + (d.startY - event.clientY);
        if (frame.current === null) {
            frame.current = requestAnimationFrame(() => {
                frame.current = null;
                send(requested.current);
            });
        }
    };

    const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
        if (!drag.current || event.pointerId !== drag.current.pointerId) return;
        drag.current = null;
        if (frame.current !== null) {
            cancelAnimationFrame(frame.current);
            frame.current = null;
        }
        // The frame just cancelled may never have run, so the release position
        // is sent once here rather than left to whichever pointermove queued it —
        // otherwise the last pixel of a drag could go unsent and unpersisted.
        send(requested.current);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        switch (event.key) {
            case 'ArrowUp':
                send(requested.current + (event.shiftKey ? DOCK_STEP_COARSE : DOCK_STEP));
                break;
            case 'ArrowDown':
                send(requested.current - (event.shiftKey ? DOCK_STEP_COARSE : DOCK_STEP));
                break;
            case 'Home':
                send(DOCK_HEIGHT_MIN);
                break;
            case 'End':
                // Not a sentinel: window.screen.availHeight is a real quantity
                // (this display's own available height) that comfortably
                // exceeds any per-window ceiling main could compute from it, so
                // main's own clamp is still what decides where this lands — and
                // unlike Number.MAX_SAFE_INTEGER, a reply that fails to arrive
                // for some reason leaves `requested` at a plausible height
                // rather than a nine-quadrillion one.
                send(window.screen.availHeight);
                break;
            default:
                return;
        }
        event.preventDefault();
    };

    /*
     * The true ceiling is workArea.height / 2 on whichever display the window
     * is on, and only main can see that display. window.screen is the same
     * idea from the renderer's own side of the glass — close enough for a
     * screen reader's announcement without a round trip to ask main, or a
     * second formula that could drift from its one. Once `exactMax` has been
     * learned from an actual reply, it is the truth and this estimate steps
     * aside for it.
     *
     * Floored at `height`: `exactMax` is only ever refreshed when a request
     * happens to overshoot it, so a window dragged onto a display with a
     * taller ceiling after `exactMax` was learned on a shorter one would
     * otherwise leave the announcement stale and, if the dock has since grown
     * past that stale number, smaller than `aria-valuenow` — an invalid ARIA
     * state. `height` is always current and always within the true ceiling,
     * so it is a safe floor regardless of how stale `exactMax` gets.
     */
    const announcedMax = Math.max(height, exactMax ?? Math.round(window.screen.availHeight / 2));

    return (
        <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize chat"
            aria-valuenow={height}
            aria-valuemin={DOCK_HEIGHT_MIN}
            aria-valuemax={announcedMax}
            tabIndex={0}
            className="dock-grip absolute inset-x-0 top-0 h-1"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
            onKeyDown={onKeyDown}
        />
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
                    <DockGrip height={state.dockHeight} />
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
