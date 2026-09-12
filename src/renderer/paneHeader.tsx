import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import type { PaneView } from '../shared/panes';
import { PANE_HEADER_HEIGHT } from '../shared/layout';
import { Caret, NavArrow, Reload } from './icons';

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
 * - **The name.** A page's is the catalog's curated link rather than the page's
 *   own `<title>`: the name is the pane's identity, and a title that changes as
 *   you click through a wiki is the pane's content moving under a name that
 *   should not. Main decides it; see `paneMenu.paneName`.
 * - **That pane's own controls**, which only a page has: back, forward, reload.
 *   Nothing else gets any. Hiscores' name box, Worlds' detail switch and chat's
 *   Send stay in the pane body, because they are the pane's *work* rather than
 *   its identity, and a header that collected them would become a second body.
 * - **The dropdown**, which changes what the pane holds. It is a native menu
 *   main pops, not a panel drawn here: in a game or page pane this strip sits
 *   directly above a `WebContentsView`, and anything the shell drew below it
 *   would open behind that view.
 */

/* .tile carries the stone; a control that has to sit at 24x22 says so inline rather than fighting it with a utility of equal specificity. */
const BUTTON: CSSProperties = { height: 22, width: 24 };
/** The header spans the pane, so its sides are the pane's edge rather than its own. */
const STRIP: CSSProperties = { height: PANE_HEADER_HEIGHT, borderLeft: 'none', borderRight: 'none' };

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

export default function PaneHeader({ pane, readout }: { pane: PaneView; readout?: ReactNode }): ReactNode {
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
        <div style={STRIP} className="tile flex shrink-0 items-center gap-[5px] px-1.5">
            <span title={pane.page?.url ?? pane.name} className="min-w-0 shrink truncate font-pixel text-[15px] text-gold">
                {pane.name}
            </span>

            {pane.page && (
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
                        can — it is the same word before, during and after a load. */}
                    {pane.page.loading && <span className="shrink-0 text-[12px] text-faint">Loading…</span>}
                </>
            )}

            {readout}

            <div className="min-w-0 flex-1" aria-hidden="true" />

            <button
                type="button"
                title="Change what this pane shows"
                aria-label={`Change what ${pane.name} shows`}
                aria-haspopup="menu"
                onClick={openMenu}
                style={BUTTON}
                className="tile flex shrink-0 items-center justify-center text-gold"
            >
                <Caret />
            </button>
        </div>
    );
}
