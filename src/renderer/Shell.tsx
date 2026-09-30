import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import type { Rect, ShellState } from '../shared/ipc';
import { clockHint, clockTone, clockValueAt, formatClock, headerClocks, type TimersView } from '../shared/timers';
import type { DropTargets, DropZone, PaneView, SeamView, TabView } from '../shared/panes';
import { draggedFar, zoneAt } from '../shared/dropZone';
import { PANE_HEADER_HEIGHT } from '../shared/layout';
import { AppMenu, Caret, Gear, Plus } from './icons';
import { playAlert } from './alertSound';
import { applyTheme } from './theme';
import DropIndicator from './dropIndicator';
import Grip from './grip';
import Launcher from './Launcher';
import PaneNotice, { PaneBoundary } from './paneNotice';
import PaneHeader, { HEADER_BUTTON_WIDTH, type Grab } from './paneHeader';
import Tab from './tab';
import TopBar, { BAR_END } from './topBar';
import { gameSprite } from './sprites';
import { TONE_CLASS, useNow } from './clocks';
import Chat from './tools/Chat';
import Hiscores from './tools/Hiscores';
import HomeServer from './tools/HomeServer';
import Timers from './tools/Timers';
import Worlds from './tools/Worlds';

const at = (r: Rect): CSSProperties => ({ position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height });

/**
 * The revision the read-out adds after the game's label, or null when the
 * label names it already. Home server's does, beside the world's status, since
 * a switch of build changes it under an open window; adding it here too
 * printed it twice.
 */
function revisionOf(state: ShellState): string | null {
    if (state.homeServer) return null;
    return state.server.revision === null ? 'rev unknown' : `rev ${state.server.revision}`;
}

/*
 * The stone is hand-written CSS, not utilities, so the handful of places that
 * have to contradict it say so inline. A utility of equal specificity would be
 * decided by stylesheet order, which is not something to leave to chance.
 */

/** Sized inline for the reason `tab.tsx` sizes its own box inline: `.tab` carries a fixed 36x34 square and is unlayered CSS, which beats a utility of equal specificity whatever the order. */
const NEW_TAB_BOX: CSSProperties = { height: 26, width: 28 };
/** The tabs' height, with `.btn`'s padding traded for room on the caret's side. Inline for the same reason as the box above. */
const ADD_PANE_BOX: CSSProperties = { height: 26, padding: '0 4px 0 10px' };
/**
 * The tabs' height, and a pane header's button's width, since the close of
 * the pane under the gear sits directly below it (`BAR_END`) — on Windows,
 * where Windows' own buttons hold the corner, that close sits under theirs
 * instead. After the bar's
 * own 5px like the menus before it, and a wider gap after it than the bar's
 * 5px end: the row's right end is the window's rounded corner on macOS, and
 * Windows' window buttons on Windows. Inline for the same reason as the boxes
 * above.
 */
const GEAR_BOX: CSSProperties = { height: 26, width: HEADER_BUTTON_WIDTH, padding: 0, marginRight: BAR_END - 5 };
/** The gear's box, without the gap after it: the ≡ starts the row, after the bar's own 5px. Inline for the same reason as the boxes above. */
const MENU_BOX: CSSProperties = { height: 26, width: HEADER_BUTTON_WIDTH, padding: 0 };
/** The tabs' height, in the warn colour Home server's own sharing notice uses. Inline because `.btn` sets its gold in unlayered CSS. */
const SHARING_BOX: CSSProperties = { height: 26, color: 'var(--color-warn)' };
/** The tabs' height. Inline for the same reason as the boxes above. */
const UPDATE_BOX: CSSProperties = { height: 26 };

/**
 * What a tab in the background still has running, after its label: the game's
 * minimap flag, and Sharing while a link to your home server is live. Main decides
 * which (`tabs.marksOfTab`), and the tab in front never has any, because what
 * it holds is on screen.
 *
 * The flag rather than a dot, which already means the focused pane in a
 * header. A word for the link, since it is the one of the two that lets
 * someone else in.
 */
function TabMarks({ tab }: { tab: TabView }): ReactNode {
    return (
        <>
            {tab.marks.includes('game') && (
                <span className="shrink-0">
                    {gameSprite()}
                    <span className="sr-only">, game running</span>
                </span>
            )}
            {tab.marks.includes('sharing') && <span className="shrink-0 text-[12px] text-warn">Sharing</span>}
        </>
    );
}

/** A tab's tooltip: its full name, and why it carries a mark. */
function tabTitle(tab: TabView): string {
    const why = [tab.marks.includes('game') && 'the game is still running here', tab.marks.includes('sharing') && 'Your home server is shared with a link'].filter(Boolean);
    return why.length === 0 ? tab.label : `${tab.label} (${why.join('; ')})`;
}

/**
 * What the shell draws inside one pane, under the header every pane now has.
 *
 * Two of the four kinds draw nothing at all: a game or a page is a native
 * WebContentsView that main has already positioned over this rect, inset below
 * the header, so the shell leaves the rest of the pane empty exactly as it left
 * the old content rect empty. A page's back, forward and reload moved up into
 * the header with everything else that names a pane rather than works in one.
 * The exception is a game or page that has crashed or hung: main hides its
 * view and sends the pane a notice, which is drawn where the view was.
 *
 * Every pane the shell draws itself — a tool, the launcher an empty pane
 * shows, and a notice — is inset by the same 10px on every side, here and
 * only here, so no tool can drift from another. A tool no longer insets its
 * own edge; it spaces its own top-level blocks with one `gap-2` instead. A
 * tool is drawn inside a boundary, keyed by what the pane holds, so one that
 * throws shows its own notice rather than taking the shell with it.
 */
function PaneBody({ pane, state }: { pane: PaneView; state: ShellState }): ReactNode {
    if (pane.notice) {
        const notice = pane.notice;
        return (
            <div className="flex min-h-0 flex-1 flex-col p-2.5">
                <PaneNotice
                    notice={notice}
                    onAction={action => {
                        if (action !== 'retry') void window.zanaris.panes.notice(pane.paneId, action);
                    }}
                />
            </div>
        );
    }
    if (pane.content.kind === 'game' || pane.content.kind === 'page') return null;
    return (
        <div className="flex min-h-0 flex-1 flex-col p-2.5">
            <PaneBoundary key={pane.content.kind === 'tool' ? pane.content.tool : 'empty'} name={pane.name} paneId={pane.paneId}>
                <PaneContentBody pane={pane} state={state} />
            </PaneBoundary>
        </div>
    );
}

function PaneContentBody({ pane, state }: { pane: PaneView; state: ShellState }): ReactNode {
    switch (pane.content.kind) {
        case 'empty':
            return <Launcher paneId={pane.paneId} links={state.server.bookmarks} contents={pane.contents ?? []} width={pane.rect.width} />;
        case 'game':
        case 'page':
            return null;
        case 'tool':
            switch (pane.content.tool) {
                case 'chat':
                    return <Chat view={state.chat} width={pane.rect.width} />;
                case 'worlds':
                    return state.worlds ? <Worlds view={state.worlds} width={pane.rect.width} /> : null;
                case 'hiscores':
                    return state.hiscores ? <Hiscores view={state.hiscores} width={pane.rect.width} /> : null;
                case 'singleplayer':
                    return state.homeServer ? <HomeServer view={state.homeServer} share={state.share} width={pane.rect.width} /> : null;
                case 'timers':
                    return <Timers view={state.timers} width={pane.rect.width} />;
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
 *
 * Home server is the exception. Its label carries the revision itself, before
 * the world's status, since a switch of build changes it under an open window
 * (`revisionOf`), so nothing is added after it and nothing is dropped: a
 * narrow pane cuts the label from its end, status first.
 */
function GameReadout({ state, width }: { state: ShellState; width: number }): ReactNode {
    const revision = revisionOf(state);
    /* No shadow of its own: the header is a `.tile`, and every tile already puts one under its text. */
    return (
        <span title={revision === null ? state.gameLabel : `${state.gameLabel} · ${revision}`} className="flex min-w-0 shrink items-center gap-[7px] truncate">
            <span className="truncate">{state.gameLabel}</span>
            {revision !== null && width >= ROOM_FOR_REVISION && <span className="shrink-0 text-[12px] text-faint">{revision}</span>}
        </span>
    );
}

/**
 * No width of its own to ask for, so it never squeezes what the header already
 * holds; it grows into what is left, all of it but the sliver the spacer after
 * it keeps, since the spacer grows too. Sized from its content, the clocks
 * shrank alongside the name and the world, and a 430px pane read "Ga…".
 */
const CLOCKS: CSSProperties = { flex: '1000 1 0px' };

/**
 * The clocks the game's header carries while no Timers pane is beside the game
 * (`pane.clocks`, main's): those running, and countdowns holding at 0:00
 * (`headerClocks`). Clocks alert with the Timers pane closed, and an alert
 * used to sound with nothing on screen to say which clock it was; now that
 * clock is beside the game it is about. Read-only: the Timers pane is where a
 * clock is started, paused, reset or changed, and the hint under the pointer
 * says when each alerts.
 *
 * They take only the room the header has to spare (`CLOCKS`), so the name,
 * the world and the latency read exactly as they would with no clocks at all,
 * and a narrow game pane shows fewer. Within that room they sit on one line
 * that wraps into a second one the header clips, so whole clocks drop from
 * the end rather than one being cut mid-digit, and the dropdown and the close
 * stay where they are. A line always takes its first item however wide, so an
 * empty one 22px tall leads: with it, a first clock wider than the room wraps
 * away too, where it used to show its name and half its digits. Every clock is
 * 22px tall as well, so the ones left do not move when one wraps away.
 */
function GameClocks({ view }: { view: TimersView }): ReactNode {
    const shown = headerClocks(view.clocks);
    const now = useNow(shown.some(clock => clock.phase === 'running'));
    if (shown.length === 0) return null;
    return (
        <span style={CLOCKS} className="ml-[5px] flex h-[22px] min-w-0 flex-wrap overflow-hidden">
            <span aria-hidden="true" className="h-[22px] w-0 shrink-0" />
            {shown.map(clock => (
                <span key={clock.def.id} title={clockHint(clock.def)} className="mr-[10px] flex shrink-0 items-baseline gap-[5px] leading-[22px] whitespace-nowrap">
                    <span className="max-w-[9em] truncate text-[12px] text-dim">{clock.def.name}</span>
                    {/* Arial, never the pixel face, where 5 reads as S: the pane's digits are the same. */}
                    <span className={`font-sans font-bold tabular-nums ${TONE_CLASS[clockTone(clock)]}`}>{formatClock(clockValueAt(clock, now), clock.def.kind)}</span>
                </span>
            ))}
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

    // This window's theme, before paint, so a change never shows a frame of the old palette.
    useLayoutEffect(() => {
        if (state) applyTheme(state.theme);
    }, [state]);

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
        <div className="picture relative h-full overflow-hidden bg-ink text-cream">
            <TopBar frame={state.frame} style={at(rects.tabBar)}>
                {/*
                 * The menu, where the window has no menu bar, then tabs and
                 * the control that makes one, then Sharing while a live link
                 * has no pane to mark, then the kit's own update while there
                 * is one, then the two menus that act on the tab in front,
                 * Setups and Add pane, side by side, and Settings alone in
                 * the corner, and nothing else. The game's read-out used to
                 * sit at this bar's left on the grounds that it was the
                 * window's rather than any tab's — true, but it left the bar
                 * reading as two unrelated things, and a read-out about the
                 * game is easiest to believe beside the game. It is in the
                 * game pane's own header now.
                 */}
                {/*
                 * The application menu, where the window has no menu bar to
                 * hang it in: on Windows, whose title bar this row replaces
                 * (`windowFrame.ts`). First in the row, where macOS keeps
                 * room for its window buttons. Main's menu, the one the
                 * shortcuts belong to, opened under the button.
                 */}
                {state.frame.menuButton && (
                    <button
                        type="button"
                        title="Menu"
                        aria-label="Menu"
                        aria-haspopup="menu"
                        onClick={event => {
                            const box = event.currentTarget.getBoundingClientRect();
                            void window.zanaris.panes.appMenu(box.left, box.bottom);
                        }}
                        style={MENU_BOX}
                        className="btn shrink-0 justify-center"
                    >
                        <AppMenu />
                    </button>
                )}
                {/*
                 * The tablist is its own box so Setups and Add pane, menu
                 * buttons rather than tabs, sit outside it. `min-w-0` is
                 * what lets the tabs give way to them as they multiply,
                 * and `overflow-hidden` keeps what still does not fit
                 * inside the box: on a window narrower than the bar's
                 * buttons, which closing a pane beside the game can now
                 * make, the tabs and the new-tab plus are cut off at its
                 * edge instead of painting over the buttons after it.
                 */}
                <div role="tablist" className="flex min-w-0 flex-1 items-center gap-[5px] overflow-hidden">
                    {/*
                     * A tab and its close are one object: the close sits inside
                     * the tab it shuts, so it reads as part of that workspace
                     * rather than as another piece of the bar's furniture. Main
                     * asks first when the tab holds the game. A right-click
                     * raises the tab's own menu, which offers Close Tab and
                     * which main builds, as it does every pane menu. Setups
                     * are the bar's Setups menu, which opens into the tab in
                     * front.
                     */}
                    {state.tabs.map(tab => (
                        <Tab
                            key={tab.id}
                            role="tab"
                            label={tab.label}
                            title={tabTitle(tab)}
                            open={tab.active}
                            after={<TabMarks tab={tab} />}
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
                 * A live link with no pane showing Home server, so no tab
                 * can carry the mark. It opens the pane, whose Friends
                 * section is where the link is copied or stopped.
                 */}
                {state.sharingWithoutPane && (
                    <button
                        type="button"
                        title="Your home server is shared with a link, and no pane shows it. Open Home server"
                        onClick={() => void window.zanaris.panes.showHomeServer()}
                        style={SHARING_BOX}
                        className="btn shrink-0"
                    >
                        Sharing
                    </button>
                )}
                {/*
                 * The kit's own update: Update 0.9.1, Updating 42%, Restart to
                 * Update or Update failed, as main words it. A press asks, in
                 * a dialog of main's, what to do about it.
                 */}
                {state.update && (
                    <button type="button" title={state.update.title} onClick={() => void window.zanaris.update.press()} style={UPDATE_BOX} className="btn shrink-0">
                        {state.update.label}
                    </button>
                )}
                {/*
                 * Setups: a set of panes in a shape, one click away. Main's
                 * menu, as Add pane's is, since it drops down over the panes;
                 * a setup chosen from it replaces the panes of the tab in
                 * front and, when it holds the game and has a size, sizes
                 * the window around the game.
                 */}
                <button
                    type="button"
                    title="Open this tab in a setup, or save it as one"
                    aria-haspopup="menu"
                    onClick={event => {
                        const box = event.currentTarget.getBoundingClientRect();
                        void window.zanaris.panes.setupsMenu(box.left, box.bottom);
                    }}
                    style={ADD_PANE_BOX}
                    className="btn shrink-0 gap-[3px]"
                >
                    Setups
                    <Caret />
                </button>
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
                {/*
                 * Settings: a window of its own rather than a pane, since
                 * everything in it is the app's rather than this tab's or this
                 * window's. So it sits last, in the corner where a window's
                 * settings are looked for, and set in a little from that
                 * corner, which on macOS is the window's rounded one; on
                 * Windows the window's own buttons hold the corner, and it
                 * sits just short of them. Between
                 * the menus and the tabs, where it used to be, it split the
                 * tab's own controls from the tabs they act on. A gear and no
                 * word, beside buttons that already have words; its name is on
                 * the tooltip and the label.
                 */}
                <button
                    type="button"
                    title="Settings"
                    aria-label="Settings"
                    onClick={() => void window.zanaris.settings.open()}
                    style={GEAR_BOX}
                    className="btn shrink-0 justify-center"
                >
                    <Gear />
                </button>
            </TopBar>

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
                         * The stone goes on every pane the shell paints itself —
                         * a tool, and the launcher an empty pane shows — so the
                         * two read as the same object: a panel with its list
                         * sunk into it. A game or page pane keeps the ink, since
                         * a native view covers all of it but the header — or,
                         * while it has stopped, the notice drawn where the
                         * hidden view was, which reads on ink as the view's own
                         * ground.
                         *
                         * No pane gets a bevel round it. The header's is the
                         * only frame any pane has, so a tool reads as the same
                         * weight as the game beside it; a `.tile` here stacked
                         * its own lit edge on the header's and drew a second
                         * one down each side.
                         */
                        className={`flex flex-col overflow-hidden ${pane.content.kind === 'tool' || pane.content.kind === 'empty' ? 'stone' : 'bg-ink'}`}
                    >
                        {/*
                         * Every pane, including the two whose bodies are holes
                         * for a native view: the header is the only part of a
                         * running game or page pane the shell draws (one that
                         * has stopped also gets its notice), and the only place
                         * either can say what it is — and so the only place
                         * any pane can say it is the focused one. The dot is
                         * shown only when there is a choice: a tab's lone pane
                         * is focused by definition, and a mark that is always
                         * there says nothing.
                         */}
                        <PaneHeader
                            pane={pane}
                            active={pane.focused && state.panes.length > 1}
                            readout={
                                pane.content.kind === 'game' ? (
                                    <>
                                        <GameReadout state={state} width={pane.rect.width} />
                                        {pane.clocks && <GameClocks view={state.timers} />}
                                    </>
                                ) : undefined
                            }
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
