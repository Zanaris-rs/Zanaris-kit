import type { CSSProperties, ReactNode } from 'react';
import type { WindowFrame } from '../shared/ipc';

/** The bar spans the window, so only its underside is bevelled. */
const STRIP_BAR: CSSProperties = { borderTop: 'none', borderLeft: 'none', borderRight: 'none' };

/**
 * The row's right padding where Windows' window buttons sit over its end
 * (`frame.buttonsAtEnd`): its own 5px end, past what they cover of it. Their
 * rect is the overlay's (`env(titlebar-area-*)`), which Electron hands the
 * shell's view from 44.4; nothing here knows how wide they are, so it holds
 * at any display scaling. Only there, since Electron still reports the rect
 * in full screen, where the buttons are gone. Inline, so no build step
 * rewrites the `env()`.
 */
const END_PADDING = 'calc(5px + 100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))';

/**
 * How far in from the row's right end the bar's last control ends: the bar's
 * own 5px end and 7 more after the gear, since on macOS that end is the
 * window's rounded corner. The row ends at the window's edge, or on Windows
 * where its window buttons begin. Every pane header ends its controls as far
 * in from its own right edge, so a pane at the window's edge has its close
 * under the gear rather than 6px to the right of it — on Windows, under the
 * window's own close instead.
 */
export const BAR_END = 12;

/**
 * The strip across a window's top: a game window's tabs, and Settings'
 * sections. One component for both because on macOS and Windows each is the
 * window's title bar, and two copies of that would be two title bars that
 * drift: a row the window buttons overlap, or one the window cannot be moved
 * by.
 *
 * Main says how the OS frames it (`windowFrame.ts`). Where the row is the
 * title bar it moves the window, and its controls keep clear of the window
 * buttons the OS draws over it: its first starts past macOS's at its left
 * end, and its last ends short of Windows' at its right. Everywhere else it
 * is only a row, as it always was.
 */
export default function TopBar({ frame, style, children }: { frame: WindowFrame; style: CSSProperties; children: ReactNode }): ReactNode {
    return (
        <div style={style} className={frame.ownTitleBar ? 'title-bar flex flex-col' : 'flex flex-col'}>
            {/*
             * 5px at the ends, as between the controls and above and below them
             * (`TAB_BAR_HEIGHT`), past the window buttons at whichever end has
             * them. An inset of zero leaves the left padding, and no buttons
             * at the end leave the right. Inline because a utility could not
             * carry a number main sends, nor keep an `env()` as written.
             */}
            <header
                style={{ ...STRIP_BAR, paddingLeft: frame.buttonsInset || undefined, paddingRight: frame.buttonsAtEnd ? END_PADDING : undefined }}
                className="tile flex flex-1 items-center gap-[5px] px-[5px]"
            >
                {children}
            </header>
            {/* The client parts its bars with a dark rule lit along the top, never a flat hairline. */}
            <div className="h-[2px] shrink-0 bg-edge-dark shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]" />
        </div>
    );
}
