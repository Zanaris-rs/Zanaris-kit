import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { Caret, CloseRoom } from './icons';

/**
 * The interface tab that carries a label, worn by the window strip, by the
 * chat pane's row of Settings, Status and channels, and by the Home server
 * tool's rows of sections and command lists. Chat's Settings draws a gear in
 * place of its label, which it still carries as its name.
 *
 * It lives here rather than in either of them because they are the same
 * object: one box, one open-versus-resting split, one place to change it. Two
 * copies of a tab are two tabs that drift, and chat tabs that stopped looking
 * like the strip's pages would read as somebody else's control.
 */

/*
 * The stone is hand-written CSS, not utilities, so the one place that has to
 * contradict it says so inline. A utility of equal specificity would be
 * decided by stylesheet order, which is not something to leave to chance.
 */

/** A text tab hugs its label instead of taking `.tab`'s fixed 36x34 square. */
const BOX: CSSProperties = { height: 26, width: 'auto' };
/**
 * The box with its sides padded, for a tab that is one element rather than a
 * box around two buttons. Inline because the one element is usually a
 * `<button>`, and `styles.css` resets every button to `padding: 0` in unlayered
 * CSS, which beats a `px-` utility whatever the order — so the chat's rooms,
 * the tabs drawn this way, had their labels run into their own borders.
 */
const PADDED: CSSProperties = { ...BOX, paddingLeft: 10, paddingRight: 10 };
/*
 * A tab that opens a menu gives up 4px on the caret's side, and the caret
 * comes 4px after its label rather than 7: at `PANE_MIN_WIDTH` it has 100px,
 * and "Characters" is 66 of them.
 */
const MENU_PADDED: CSSProperties = { ...BOX, paddingLeft: 10, paddingRight: 6 };
/* A tab drawn as a glyph: the glyph's own 18px is most of its width, so its sides are narrower than a word's. */
const ICON_PADDED: CSSProperties = { ...BOX, paddingLeft: 6, paddingRight: 6 };

export default function Tab({
    label,
    title,
    open,
    role,
    onSelect,
    after,
    onClose,
    closeLabel,
    onContextMenu,
    menu = false,
    icon
}: {
    /** What the tab says, or, for a tab drawn as a glyph, its tooltip and its name to a screen reader. */
    label: string;
    /** The full name, for a label that had to be shortened to fit. */
    title?: string;
    open: boolean;
    /**
     * How the open one is announced, which is a different question from how it
     * is drawn — both look the same, and only one of them is a tab widget.
     *
     * 'tab' is the window strip, which is a read-out of which page is in front,
     * sits in a role="tablist", and means aria-selected. 'button' is chat's
     * tabs, which are a row of controls: they have no tabpanel to point at,
     * because the log below them has to stay a role="log" live region or new
     * lines stop being announced at all, and they have no arrow-key roving. A
     * tablist missing both would tell a screen reader "tab 2 of 4" about
     * something that behaves like buttons, so these carry aria-current and
     * claim only what they do. Required rather than defaulted: several call
     * sites, and none should get the wrong answer by saying nothing.
     */
    role: 'tab' | 'button';
    /** Left off for a tab that only reports which page is in front; such a tab is not a control and is not drawn as one. */
    onSelect?: (event: MouseEvent<HTMLElement>) => void;
    /** The detail some tabs carry to the right of the label: a revision, an unread count. */
    after?: ReactNode;
    /** Puts a close inside the tab, at its right edge. The window strip's tabs carry one, and so does every chat channel. */
    onClose?: () => void;
    /** What the close is announced as. Names the tab rather than the act, since "Close" alone says nothing about which one. */
    closeLabel?: string;
    /** A right-click anywhere on the tab, close included. The window strip's tabs raise their tab menu (Close Tab) with it; chat's tabs have none. */
    onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
    /**
     * The tab opens a menu rather than being chosen: Home server's, in a
     * narrow pane, in place of its row of sections. It says so to a screen
     * reader rather than claiming to be current, and carries the caret the
     * kit's other menus do. Only for a tab with `onSelect` and no close.
     */
    menu?: boolean;
    /**
     * Draws the tab as this glyph instead of its label: chat's Settings, a
     * gear, which leaves its channels the room a word took. Only for a tab
     * with `onSelect` and no close.
     */
    icon?: ReactNode;
}): ReactNode {
    /*
     * One pair of faces for both states, `.tab`'s own: resting is a tab cut
     * into the stone, open lifts to the lit face above it.
     *
     * The open one used to be a `.tile`, which is the *same* fill as the bar it
     * sits on — so it read as the background with an outline round it, while
     * the resting tab, darker and shadowed from above-left, was the only tab on
     * the strip with a strong physical read. The eye picked the resting one as
     * the open one. Lit stone is a step above the bar rather than level with
     * it, which is the whole of the fix, and it is what the tool rail's tabs
     * always did. It also settles a wobble: `.tile` is a 2px border and `.tab`
     * a 1px one, so a tab used to change size by two pixels on being opened.
     */
    const face = open ? 'tab tab-on' : 'tab text-dim';
    const skin = `flex items-center ${menu ? 'max-w-full min-w-0 gap-1' : 'gap-[7px]'} ${face}`;
    /* A real button already has the role it needs, so only the strip's read-out names one. */
    const announce: { role?: 'tab'; 'aria-selected'?: boolean; 'aria-current'?: true; 'aria-haspopup'?: 'menu' } =
        role === 'tab' ? { role: 'tab', 'aria-selected': open } : menu ? { 'aria-haspopup': 'menu' } : { 'aria-current': open || undefined };
    const body = (
        <>
            {icon ?? <span className="truncate">{label}</span>}
            {after}
            {menu && <Caret compact />}
        </>
    );

    if (onSelect && onClose) {
        /*
         * The skin moves out to a box holding two sibling buttons, because a
         * close inside the select button would be a button within a button —
         * invalid HTML that no two browsers agree on. The label's button takes
         * the tab's role and every pixel up to the close, so the whole tab
         * still selects wherever it is pressed except on the close itself.
         * No right padding on the box: the close's own 24px is the margin, and
         * its X sits centred in it. `min-w-0` on both, since these do run out
         * of room — a window holds as many tabs as the user makes — and the
         * label is what gives way, never the close.
         *
         * The close's X is dimmed on a resting tab and full on the open one by
         * `.tab svg` and `.tab-on svg`, which do that for any icon on a tab,
         * so it sits back exactly as far as the tab it belongs to.
         */
        const close = closeLabel ?? `Close ${label}`;
        return (
            <div title={title} style={BOX} onContextMenu={onContextMenu} className={`flex min-w-0 items-center gap-[7px] pl-2.5 ${face}`}>
                <button type="button" {...announce} onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-[7px] self-stretch">
                    {body}
                </button>
                {/* 24px wide for the WCAG 2.5.8 floor; the tab's own 24px inside its border is the height. */}
                <button type="button" title={close} aria-label={close} onClick={onClose} className="tab-close flex w-[24px] shrink-0 items-center justify-center self-stretch">
                    <CloseRoom />
                </button>
            </div>
        );
    }

    return onSelect ? (
        <button
            type="button"
            {...announce}
            aria-label={icon === undefined ? undefined : label}
            title={title ?? (icon === undefined ? undefined : label)}
            onClick={onSelect}
            onContextMenu={onContextMenu}
            style={icon !== undefined ? ICON_PADDED : menu ? MENU_PADDED : PADDED}
            className={skin}
        >
            {body}
        </button>
    ) : (
        <div {...announce} title={title} onContextMenu={onContextMenu} style={PADDED} className={skin}>
            {body}
        </div>
    );
}
