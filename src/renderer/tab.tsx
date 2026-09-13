import type { CSSProperties, ReactNode } from 'react';
import { CloseRoom } from './icons';

/**
 * The text-bearing interface tab, worn by the window strip and by the chat
 * dock's row of rooms.
 *
 * It lives here rather than in either of them because they are the same
 * object: one box, one open-versus-resting split, one place to change it. Two
 * copies of a tab are two tabs that drift, and a dock whose rooms stopped
 * looking like the strip's pages would read as somebody else's control.
 */

/*
 * The stone is hand-written CSS, not utilities, so the one place that has to
 * contradict it says so inline. A utility of equal specificity would be
 * decided by stylesheet order, which is not something to leave to chance.
 */

/** A text tab hugs its label instead of taking the rail tab's fixed 36x34 square. */
const BOX: CSSProperties = { height: 26, width: 'auto' };

export default function Tab({
    label,
    title,
    open,
    role,
    onSelect,
    after,
    onClose,
    closeLabel
}: {
    label: string;
    /** The full name, for a label that had to be shortened to fit. */
    title?: string;
    open: boolean;
    /**
     * How the open one is announced, which is a different question from how it
     * is drawn — both look the same, and only one of them is a tab widget.
     *
     * 'tab' is the window strip, which is a read-out of which page is in front,
     * sits in a role="tablist", and means aria-selected. 'button' is the dock's
     * rooms, which are a row of controls: they have no tabpanel to point at,
     * because the log below them has to stay a role="log" live region or new
     * lines stop being announced at all, and they have no arrow-key roving. A
     * tablist missing both would tell a screen reader "tab 2 of 4" about
     * something that behaves like buttons, so these carry aria-current and
     * claim only what they do. Required rather than defaulted: two call sites,
     * and neither should get the wrong answer by saying nothing.
     */
    role: 'tab' | 'button';
    /** Left off for a tab that only reports which page is in front; such a tab is not a control and is not drawn as one. */
    onSelect?: () => void;
    /** The detail some tabs carry to the right of the label: a revision, an unread count. */
    after?: ReactNode;
    /**
     * Puts a close inside the tab, at its right edge. The window strip's tabs
     * carry one; the dock's rooms do not, and keep their close beside the tab
     * for the open room only — see `CloseControl` in `tools/Chat.tsx`.
     */
    onClose?: () => void;
    /** What the close is announced as. Names the tab rather than the act, since "Close" alone says nothing about which one. */
    closeLabel?: string;
}): ReactNode {
    /*
     * One pair of faces for both states, the rail's own: resting is a tab cut
     * into the stone, open lifts to the lit face above it.
     *
     * The open one used to be a `.tile`, which is the *same* fill as the bar it
     * sits on — so it read as the background with an outline round it, while
     * the resting tab, darker and shadowed from above-left, was the only tab on
     * the strip with a strong physical read. The eye picked the resting one as
     * the open one. Lit stone is a step above the bar rather than level with
     * it, which is the whole of the fix, and it is what the rail has always
     * done. It also settles a wobble: `.tile` is a 2px border and `.tab` a 1px
     * one, so a tab used to change size by two pixels on being opened.
     */
    const face = open ? 'tab tab-on' : 'tab text-dim';
    const skin = `flex items-center gap-[7px] px-2.5 ${face}`;
    /* A real button already has the role it needs, so only the strip's read-out names one. */
    const announce: { role?: 'tab'; 'aria-selected'?: boolean; 'aria-current'?: true } =
        role === 'tab' ? { role: 'tab', 'aria-selected': open } : { 'aria-current': open || undefined };
    const body = (
        <>
            <span className="truncate">{label}</span>
            {after}
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
         * `.tab svg` and `.tab-on svg`, which already do that for the rail's
         * icons, so it sits back exactly as far as the tab it belongs to.
         */
        const close = closeLabel ?? `Close ${label}`;
        return (
            <div title={title} style={BOX} className={`flex min-w-0 items-center gap-[7px] pl-2.5 ${face}`}>
                <button type="button" {...announce} onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-[7px] self-stretch">
                    {body}
                </button>
                {/* 24px wide for the WCAG 2.5.8 floor the dock's close keeps; the tab's own 24px inside its border is the height. */}
                <button type="button" title={close} aria-label={close} onClick={onClose} className="tab-close flex w-[24px] shrink-0 items-center justify-center self-stretch">
                    <CloseRoom />
                </button>
            </div>
        );
    }

    return onSelect ? (
        <button type="button" {...announce} title={title} onClick={onSelect} style={BOX} className={skin}>
            {body}
        </button>
    ) : (
        <div {...announce} title={title} style={BOX} className={skin}>
            {body}
        </div>
    );
}
