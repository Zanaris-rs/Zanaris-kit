import type { CSSProperties, ReactNode } from 'react';
import type { WindowFrame } from '../shared/ipc';

/** The bar spans the window, so only its underside is bevelled. */
const STRIP_BAR: CSSProperties = { borderTop: 'none', borderLeft: 'none', borderRight: 'none' };

/**
 * The strip across a window's top: a game window's tabs, and Settings'
 * sections. One component for both because on macOS each is the window's
 * title bar, and two copies of that would be two title bars that drift: a
 * row the window buttons overlap, or one the window cannot be moved by.
 *
 * Main says how the OS frames it (`windowFrame.ts`). Where the row is the
 * title bar it moves the window, and its first control starts past the
 * window buttons macOS draws over its left end. Everywhere else it is only a
 * row, as it always was.
 */
export default function TopBar({ frame, style, children }: { frame: WindowFrame; style: CSSProperties; children: ReactNode }): ReactNode {
    return (
        <div style={style} className={frame.ownTitleBar ? 'title-bar flex flex-col' : 'flex flex-col'}>
            {/* An inset of zero leaves `px-1.5`'s own left padding. Inline because a utility could not carry a number main sends. */}
            <header style={{ ...STRIP_BAR, paddingLeft: frame.buttonsInset || undefined }} className="tile flex flex-1 items-center gap-[5px] px-1.5">
                {children}
            </header>
            {/* The client parts its bars with a dark rule lit along the top, never a flat hairline. */}
            <div className="h-[2px] shrink-0 bg-edge-dark shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]" />
        </div>
    );
}
