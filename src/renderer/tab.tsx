import type { CSSProperties, ReactNode } from 'react';

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
    after
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
}): ReactNode {
    /* The open tab is a raised tile; the rest are tabs cut into the stone. */
    const skin = `flex items-center gap-[7px] px-2.5 ${open ? 'tile' : 'tab text-dim'}`;
    /* A real button already has the role it needs, so only the strip's read-out names one. */
    const announce: { role?: 'tab'; 'aria-selected'?: boolean; 'aria-current'?: true } =
        role === 'tab' ? { role: 'tab', 'aria-selected': open } : { 'aria-current': open || undefined };
    const body = (
        <>
            <span className="truncate">{label}</span>
            {after}
        </>
    );

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
