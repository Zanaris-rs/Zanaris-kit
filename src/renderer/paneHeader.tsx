import type { CSSProperties, MouseEvent, PointerEvent, ReactNode } from 'react';
import type { PaneView } from '../shared/panes';
import { PANE_HEADER_HEIGHT } from '../shared/layout';
import { Caret, CloseRoom, NavArrow, Reload } from './icons';

/**
 * The strip at the top of every pane: what the pane is, what that one thing can
 * do, and how to make it something else.
 *
 * On all four kinds, not only on pages. A pane used to rely on its content to
 * introduce itself, which the game and a reference page cannot do at all —
 * they are native views with nothing of ours drawn in them — while the tools
 * each spent a heading of their own saying a word the window already knew. One
 * header says it once, in the same place, whatever the pane holds, and the
 * native view below it is inset by exactly this height.
 *
 * What it carries, left to right:
 *
 * - **The dot**, on the focused pane when its tab has more than one. Focus is
 *   what Cmd/Ctrl+D and Cmd/Ctrl+W act on, so it has to be visible — but it used to be a gold ring drawn round the whole
 *   pane, which was the loudest line in the window for the least interesting
 *   fact in it. A mark beside the name says the same thing where the eye
 *   already goes to find out what a pane is.
 * - **The name.** A page's is the catalog's curated link rather than the page's
 *   own `<title>`: the name is the pane's identity, and a title that changes as
 *   you click through a wiki is the pane's content moving under a name that
 *   should not. Main decides it; see `paneMenu.paneName`.
 * - **That pane's own controls**, which only a page has: back, forward, reload.
 *   Nothing else gets any. Hiscores' name box, Worlds' detail switch and chat's
 *   Send stay in the pane body, because they are the pane's *work* rather than
 *   its identity, and a header that collected them would become a second body.
 *   They are the first thing a narrow pane gives up; see `ROOM_FOR_NAV`.
 * - **The dropdown**, which changes what the pane holds and, below a rule,
 *   splits it. The splits are there as well as on the right-click menu because
 *   nothing on screen says a right-click exists; the arrow is the one control
 *   a new player can be expected to try. It is a native menu
 *   main pops, not a panel drawn here: in a game or page pane this strip sits
 *   directly above a `WebContentsView`, and anything the shell drew below it
 *   would open behind that view.
 * - **The close**, the same act as the right-click menu's Close and Cmd/Ctrl+W,
 *   and through the same IPC, so closing the game asks first here as it does
 *   there. Greyed on the one pane where it would do nothing — a tab's lone pane
 *   already empty — which is main's call (`pane.closable`), not this strip's.
 */

/* .tile carries the stone; a control that has to sit at 24x22 says so inline rather than fighting it with a utility of equal specificity. */
const BUTTON: CSSProperties = { height: 22, width: 24 };
/**
 * The focused pane's mark. A disc rather than a pixel square, because at 6px a
 * square reads as a stray glyph beside pixel type, and it carries the same hard
 * black shadow the stone puts under every letter so it sits on the stone the
 * way the name beside it does.
 */
const DOT: CSSProperties = { width: 6, height: 6, boxShadow: '1px 1px 0 rgba(0, 0, 0, 0.78)' };
/** The header spans the pane, so its sides are the pane's edge rather than its own. */
const STRIP: CSSProperties = { height: PANE_HEADER_HEIGHT, borderLeft: 'none', borderRight: 'none' };
/**
 * A floor under the name, so a squeeze takes the end of it rather than all of
 * it. Everything else in the strip is an icon that cannot truncate, so without
 * this the name is the only thing that *can* give way and a narrow pane ends up
 * showing its buttons and no idea what it is looking at.
 *
 * 2em rather than more because the floor has to fit the narrowest pane there
 * is: a tool pane at the 120px minimum has 116px inside its bevel, and the
 * padding, the dot, the dropdown, the close and the gaps between them take 86
 * of it, leaving exactly the 30px this is at 15px. A floor past that pushes the
 * close off the pane's edge on the focused pane — it was 2.5em until the dot
 * arrived and took 11px — and the title attribute already carries the full
 * name for a pane that narrow.
 */
const NAME: CSSProperties = { minWidth: '2em' };
/**
 * Below this the strip has room for the name and the controls and nothing else.
 * The shell reading its own pane's width is the same thing chat does to choose
 * between its two shapes; it is presentation, not placement.
 */
const ROOM_FOR_LOADING = 320;
/**
 * Below this a page pane's header cannot hold the name, the three navigation
 * buttons, the dropdown and the close together — 12px of padding, room for a
 * few letters of the name at 15px, five 24px buttons and the 5px gaps between
 * the seven items, or eight with the focused pane's dot, which leaves the name
 * 42px rather than 53 and still above its floor. The navigation is what goes. None of these can truncate, so
 * something has to, and the other two are the pane's way out: a dropdown or a
 * close pushed past the pane's edge is a pane that can no longer be changed
 * or shut, while a page too narrow to hold its buttons is too narrow to browse.
 */
const ROOM_FOR_NAV = 215;

function Step({ label, on, disabled, children }: { label: string; on: () => void; disabled: boolean; children: ReactNode }): ReactNode {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            disabled={disabled}
            onClick={on}
            style={BUTTON}
            className="tile flex shrink-0 items-center justify-center text-gold disabled:text-faint"
        >
            {children}
        </button>
    );
}

/**
 * The pointer handlers that make this strip a drag handle. Shell's, because
 * only Shell knows every pane's rect, and so which pane and which part of it
 * the pointer is over.
 */
export interface Grab {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => void;
}

export default function PaneHeader({
    pane,
    active,
    readout,
    grab,
    grabbing = false
}: {
    pane: PaneView;
    active: boolean;
    readout?: ReactNode;
    grab?: Grab;
    /** This pane is the one being dragged. */
    grabbing?: boolean;
}): ReactNode {
    const go = window.zanaris.panes.go;
    /*
     * The menu opens under the button that asked for it. `getBoundingClientRect`
     * is already in the window's coordinates, which is what `popup` wants,
     * because the shell view spans the whole content area — the same reason a
     * right-click can forward `clientX/Y` untouched.
     */
    const openMenu = (event: MouseEvent<HTMLButtonElement>): void => {
        const box = event.currentTarget.getBoundingClientRect();
        void window.zanaris.panes.contentMenu(pane.paneId, box.left, box.bottom);
    };

    return (
        /*
         * The whole strip is the handle, not just the name: a browser tab is
         * grabbed anywhere along itself, and the spacer between the name and
         * the caret is the easiest part of a narrow header to hit. The handlers
         * ignore a press that began on a button, so the nav arrows and the
         * caret still click rather than starting a drag nobody asked for.
         */
        <div style={{ ...STRIP, cursor: grab ? (grabbing ? 'grabbing' : 'grab') : undefined }} {...grab} className="tile flex shrink-0 items-center gap-[5px] px-1.5">
            {active && (
                <span style={DOT} className="shrink-0 rounded-full bg-gold">
                    <span className="sr-only">Active pane:</span>
                </span>
            )}
            <span title={pane.page?.url ?? pane.name} style={NAME} className="shrink truncate font-pixel text-[15px] text-gold">
                {pane.name}
            </span>

            {pane.page && pane.rect.width >= ROOM_FOR_NAV && (
                <>
                    <Step label="Back" disabled={!pane.page.canGoBack} on={() => void go('back')}>
                        <NavArrow />
                    </Step>
                    <Step label="Forward" disabled={!pane.page.canGoForward} on={() => void go('forward')}>
                        <NavArrow forward />
                    </Step>
                    <Step label="Reload" disabled={false} on={() => void go('reload')}>
                        <Reload />
                    </Step>
                    {/* The one thing the header keeps of the old toolbar's url field: a page
                        that is still coming says so, which the curated name beside it never
                        can — it is the same word before, during and after a load. First to
                        go when the pane is too narrow for both, since the name is the pane's
                        identity and this is only its weather. */}
                    {pane.page.loading && pane.rect.width >= ROOM_FOR_LOADING && <span className="min-w-0 shrink truncate text-[12px] text-faint">Loading…</span>}
                </>
            )}

            {readout}

            <div className="min-w-0 flex-1" aria-hidden="true" />

            <button
                type="button"
                title="Change or split this pane"
                aria-label={`Change or split ${pane.name}`}
                aria-haspopup="menu"
                onClick={openMenu}
                style={BUTTON}
                className="tile flex shrink-0 items-center justify-center text-gold"
            >
                <Caret />
            </button>

            {/* Named for what it costs, as the menu's item is: the game's close disconnects the player. */}
            <button
                type="button"
                title={pane.content.kind === 'game' ? 'Close game' : 'Close pane'}
                aria-label={`Close ${pane.name}`}
                disabled={!pane.closable}
                onClick={() => void window.zanaris.panes.close(pane.paneId)}
                style={BUTTON}
                /* The X's fill is fixed in the sprite, so a spent close is dimmed by opacity rather than by colour. */
                className="tile flex shrink-0 items-center justify-center disabled:opacity-40"
            >
                <CloseRoom />
            </button>
        </div>
    );
}
