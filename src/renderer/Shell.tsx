import { Fragment, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import type { Rect, ShellState } from '../shared/ipc';
import type { DropTargets, DropZone, PaneView, SeamView } from '../shared/panes';
import { draggedFar, zoneAt } from '../shared/dropZone';
import { PANE_HEADER_HEIGHT } from '../shared/layout';
import { Caret, Plus } from './icons';
import { playAlert } from './alertSound';
import DropIndicator from './dropIndicator';
import Grip from './grip';
import Launcher from './Launcher';
import PaneHeader, { type Grab } from './paneHeader';
import Tab from './tab';
import Chat from './tools/Chat';
import Hiscores from './tools/Hiscores';
import SinglePlayer from './tools/SinglePlayer';
import Timers from './tools/Timers';
import Worlds from './tools/Worlds';

const at = (r: Rect): CSSProperties => ({ position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height });

/** Single player names the revision of the line the world runs, which a switch changes under an open window. */
function revisionOf(state: ShellState): string {
    if (state.singlePlayer) return `rev ${state.singlePlayer.revision}`;
    return state.server.revision === null ? 'rev unknown' : `rev ${state.server.revision}`;
}

/*
 * The stone is hand-written CSS, not utilities, so the handful of places that
 * have to contradict it say so inline. A utility of equal specificity would be
 * decided by stylesheet order, which is not something to leave to chance.
 */

/** The bar spans the window, so only its underside is bevelled. */
const STRIP_BAR: CSSProperties = { borderTop: 'none', borderLeft: 'none', borderRight: 'none' };
/** Sized inline for the reason `tab.tsx` sizes its own box inline: `.tab` carries a fixed 36x34 square and is unlayered CSS, which beats a utility of equal specificity whatever the order. */
const NEW_TAB_BOX: CSSProperties = { height: 26, width: 28 };
/** The tabs' height, with `.btn`'s padding traded for room on the caret's side. Inline for the same reason as the box above. */
const ADD_PANE_BOX: CSSProperties = { height: 26, padding: '0 4px 0 10px' };

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
                    return state.singlePlayer ? <SinglePlayer view={state.singlePlayer} share={state.share} /> : null;
                case 'timers':
                    return <Timers view={state.timers} />;
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
    /* No shadow of its own: the header is a `.tile`, and every tile already puts one under its text. */
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

/** The pane a point falls in, or null for the seams and the chrome between them. */
function paneAt(panes: PaneView[], x: number, y: number): PaneView | null {
    return panes.find(p => x >= p.rect.x && x < p.rect.x + p.rect.width && y >= p.rect.y && y < p.rect.y + p.rect.height) ?? null;
}

/** What a dragged header is over: a pane and the zone of it, or nothing. */
function aimAt(panes: PaneView[], x: number, y: number): { over: string | null; zone: DropZone } {
    const pane = paneAt(panes, x, y);
    return pane ? { over: pane.paneId, zone: zoneAt(pane.rect, x, y) } : { over: null, zone: 'centre' };
}

/** A header press. It becomes a drag once the pointer has travelled far enough, so a click on a header still only focuses its pane. */
interface Held {
    from: string;
    pointerId: number;
    start: { x: number; y: number };
    dragging: boolean;
    /** The panes' layout when the drag began, as `layoutKey` spells it. */
    layout: string;
    /** Main's answer, kept with the press so a release reads it even before a render has caught up. */
    targets: DropTargets | null;
}

/** Which panes are showing and where, as one comparable string. A drag's targets were answered for exactly this. */
function layoutKey(panes: PaneView[]): string {
    return panes.map(p => `${p.paneId}@${p.rect.x},${p.rect.y},${p.rect.width}x${p.rect.height}`).join(' ');
}

/** A drag in progress. `targets` is main's answer to where each drop would land, and is null until it arrives. */
interface Drag {
    from: string;
    targets: DropTargets | null;
    over: string | null;
    zone: DropZone;
}

/**
 * The chrome around the panes: the bar across the top, and whatever each pane
 * is, drawn exactly where main placed it.
 *
 * The window no longer has four fixed regions to arrange, so this no longer
 * arranges any. It renders a list, and the list is main's.
 */
export default function Shell(): ReactNode {
    const [state, setState] = useState<ShellState | null>(null);
    /**
     * The header drag. `held` is the pointer's, and survives a re-render; `drag`
     * is what the overlay reads, and causes them.
     *
     * Main hides every native view from `beginDrag` until the drag ends, because
     * the shell cannot draw over a game or a page — those views sit above it,
     * and a drop target painted under either would be invisible. So the panes
     * go blank for the length of the gesture and each says its own name
     * instead, which is also what makes an empty-looking game pane legible
     * while it is moving.
     */
    const held = useRef<Held | null>(null);
    const [drag, setDrag] = useState<Drag | null>(null);

    /** Ends a drag without dropping. Reads nothing a render could leave stale, so the Escape listener can hold it. */
    const cancelDrag = (): void => {
        const grabbed = held.current;
        held.current = null;
        setDrag(null);
        if (grabbed?.dragging) void window.zanaris.panes.endDrag();
    };

    /* A drag interrupted by an unmount would otherwise leave every view hidden. */
    useEffect(
        () => () => {
            if (held.current?.dragging) void window.zanaris.panes.endDrag();
        },
        []
    );

    /*
     * A drag ends when the layout it was aimed at changes under it — a
     * shortcut, a tab switch, a resize. Its targets were answered for the old
     * rects, so the preview would be wrong; and when the change takes the
     * dragged header off screen, its pointer events go with it, and nothing
     * else would ever end the drag. Main ends it on its side too.
     */
    const layout = state ? layoutKey(state.panes) : '';
    useEffect(() => {
        if (held.current?.dragging && held.current.layout !== layout) cancelDrag();
    }, [layout]);

    /* Escape puts everything back where it was, as it does for any drag. */
    const dragging = drag !== null;
    useEffect(() => {
        if (!dragging) return;
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') cancelDrag();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [dragging]);

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

    /*
     * A timer's alert plays here, not in the Timers pane: the pane may be
     * closed, in another tab, or never opened, and the alert is for the player
     * all the same.
     */
    useEffect(() => window.zanaris.timers.onAlert(alert => void playAlert(alert.volume)), []);

    /**
     * The release. A drop goes to main only where main said it would land;
     * anywhere else — a seam, the tab bar, a refused edge, or before main has
     * answered at all — ends the drag and changes nothing. Main asks again
     * before it drops.
     */
    const release = (event: PointerEvent<HTMLDivElement>): void => {
        const grabbed = held.current;
        if (!grabbed || event.pointerId !== grabbed.pointerId) return;
        if (!grabbed.dragging || !state) {
            cancelDrag();
            return;
        }
        held.current = null;
        const { over, zone } = aimAt(state.panes, event.clientX, event.clientY);
        const landing = over ? grabbed.targets?.[over]?.[zone] : null;
        setDrag(null);
        if (over && landing) void window.zanaris.panes.drop(grabbed.from, over, zone);
        else void window.zanaris.panes.endDrag();
    };

    const grabFor = (paneId: string): Grab => ({
        onPointerDown: event => {
            // A press that began on a button is that button's: the nav arrows
            // and the caret must still click rather than start a drag.
            if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
            // A second pointer pressing a header mid-drag ends the first drag
            // properly, rather than overwriting it and never telling main.
            if (held.current) cancelDrag();
            event.currentTarget.setPointerCapture(event.pointerId);
            held.current = { from: paneId, pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, dragging: false, layout: '', targets: null };
        },
        onPointerMove: event => {
            const grabbed = held.current;
            if (!grabbed || event.pointerId !== grabbed.pointerId || !state) return;
            const at = { x: event.clientX, y: event.clientY };
            if (!grabbed.dragging) {
                // A lone pane has nowhere to go, so pressing its header stays a
                // click however far the pointer wanders.
                if (state.panes.length < 2 || !draggedFar(grabbed.start, at)) return;
                grabbed.dragging = true;
                grabbed.layout = layoutKey(state.panes);
                setDrag({ from: grabbed.from, targets: null, over: null, zone: 'centre' });
                void window.zanaris.panes.beginDrag(grabbed.from).then(targets => {
                    // Only for the drag that asked: this one may have ended, and
                    // another begun, while main was answering.
                    if (held.current !== grabbed) return;
                    grabbed.targets = targets;
                    setDrag(d => (d ? { ...d, targets } : d));
                });
            }
            const { over, zone } = aimAt(state.panes, at.x, at.y);
            setDrag(d => (d && (d.over !== over || d.zone !== zone) ? { ...d, over, zone } : d));
        },
        onPointerUp: release,
        onPointerCancel: event => {
            if (held.current?.pointerId === event.pointerId) cancelDrag();
        },
        onLostPointerCapture: event => {
            if (held.current?.pointerId === event.pointerId) cancelDrag();
        }
    });

    if (!state) return <div className="h-full bg-ink" />;

    const { rects } = state;

    return (
        <div className="relative h-full overflow-hidden bg-ink text-cream">
            <div style={at(rects.tabBar)} className="flex flex-col">
                {/*
                 * Tabs and the control that makes one, then Add pane at the far
                 * end, and nothing else. The game's read-out used to sit at this
                 * bar's left on the grounds that it was the window's rather than
                 * any tab's — true, but it left the bar reading as two unrelated
                 * things, and a read-out about the game is easiest to believe
                 * beside the game. It is in the game pane's own header now.
                 */}
                <header style={STRIP_BAR} className="tile flex flex-1 items-center gap-[5px] px-1.5">
                    {/*
                     * The tablist is its own box so Add pane, a menu button
                     * rather than a tab, sits outside it. `min-w-0` is what lets
                     * the tabs give way to it as they multiply.
                     */}
                    <div role="tablist" className="flex min-w-0 flex-1 items-center gap-[5px]">
                        {/*
                         * A tab and its close are one object: the close sits inside
                         * the tab it shuts, so it reads as part of that workspace
                         * rather than as another piece of the bar's furniture. Main
                         * asks first when the tab holds the game. A right-click
                         * raises the tab's own menu — save its panes as a layout,
                         * load one, open the folder — which main builds, as it does
                         * every pane menu.
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
                                onContextMenu={event => {
                                    event.preventDefault();
                                    void window.zanaris.panes.tabMenu(tab.id, event.clientX, event.clientY);
                                }}
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
                    </div>
                    {/*
                     * How a pane gets added, at the far end of the bar from the
                     * tabs. It replaced the tool rail down the window's right
                     * edge, which could reach the tools and none of the links,
                     * and put what it opened in whichever pane had focus — so
                     * nothing on screen said a second pane was possible, and a
                     * click could replace the page you were reading.
                     *
                     * Words and a caret rather than a second plus: a plus in
                     * this bar already means "new tab", and two of them side by
                     * side is a guess about which is which. A raised `.btn`
                     * rather than a tab's face, so it does not read as one more
                     * tab. The menu is main's, like every pane menu, and opens
                     * under the button.
                     */}
                    <button
                        type="button"
                        title="Add a pane to this tab"
                        aria-haspopup="menu"
                        onClick={event => {
                            const box = event.currentTarget.getBoundingClientRect();
                            void window.zanaris.panes.addPaneMenu(box.left, box.bottom);
                        }}
                        style={ADD_PANE_BOX}
                        className="btn shrink-0 gap-[3px]"
                    >
                        Add pane
                        <Caret />
                    </button>
                </header>
                {/* The client parts its bars with a dark rule lit along the top, never a flat hairline. */}
                <div className="h-[2px] shrink-0 bg-edge-dark shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]" />
            </div>

            {state.panes.map(pane => (
                <Fragment key={pane.paneId}>
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
                        /*
                         * The stone frame goes on every pane the shell paints
                         * itself — a tool, and the launcher an empty pane shows —
                         * so the two read as the same object: a bevelled panel
                         * with its list sunk into it. A game or page pane keeps
                         * the ink, since a native view covers all of it but
                         * the header.
                         */
                        className={`flex flex-col overflow-hidden bg-ink${pane.content.kind === 'tool' || pane.content.kind === 'empty' ? ' tile' : ''}`}
                    >
                        {/*
                         * Every pane, including the two whose bodies are holes
                         * for a native view: the header is the only part of a
                         * game or page pane the shell draws, and the only place
                         * either can say what it is — and so the only place
                         * any pane can say it is the focused one. The dot is
                         * shown only when there is a choice: a tab's lone pane
                         * is focused by definition, and a mark that is always
                         * there says nothing.
                         */}
                        <PaneHeader
                            pane={pane}
                            active={pane.focused && state.panes.length > 1}
                            readout={pane.content.kind === 'game' ? <GameReadout state={state} width={pane.rect.width} /> : undefined}
                            grab={grabFor(pane.paneId)}
                            grabbing={drag?.from === pane.paneId}
                        />
                        <PaneBody pane={pane} state={state} />
                        {/*
                         * Over the body only, so the header stays readable and
                         * grabbable under the pointer that is dragging it. The
                         * pane being carried is dimmed. Everything says its name,
                         * because with the native views hidden a game or page
                         * pane has nothing else to identify it by — except the
                         * pane under the pointer, whose middle the drop preview's
                         * own label is about to cover. Its header still names it.
                         */}
                        {drag && (
                            <div
                                aria-hidden="true"
                                className={`pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center font-pixel text-[15px] ${
                                    drag.from === pane.paneId ? 'text-faint opacity-60' : 'text-dim'
                                }`}
                                style={{ top: PANE_HEADER_HEIGHT }}
                            >
                                {drag.over === pane.paneId && drag.over !== drag.from && drag.targets ? null : pane.name}
                            </div>
                        )}
                    </div>
                </Fragment>
            ))}

            {state.seams.map(seam => (
                <Seam key={`${seam.splitId}:${seam.index}`} seam={seam} />
            ))}

            {/*
             * Above the seams, since a preview can straddle one: an edge drop
             * on a pane that already has a neighbour on that side lands against
             * the seam between them.
             */}
            {(() => {
                const target = drag?.over && drag.over !== drag.from ? state.panes.find(p => p.paneId === drag.over) : undefined;
                const dragged = drag ? state.panes.find(p => p.paneId === drag.from) : undefined;
                const zones = target && drag?.targets?.[target.paneId];
                if (!drag || !target || !dragged || !zones) return null;
                return <DropIndicator target={target.rect} targetName={target.name} landing={zones[drag.zone]} zone={drag.zone} dragged={dragged.name} />;
            })()}
        </div>
    );
}
