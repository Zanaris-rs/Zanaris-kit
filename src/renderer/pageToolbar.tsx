import type { CSSProperties, ReactNode } from 'react';
import type { PageView } from '../shared/pages';
import { NavArrow, Reload } from './icons';

/**
 * The reference pane's toolbar: back, forward, reload, and what the page calls
 * itself.
 *
 * No address box. The pane shows the server's own curated links, main refuses
 * to open anything else, and a box that could only ever be read would be a
 * control that looks like it takes typing and does not. The page's title goes
 * there instead, which is the question a box would have been answering.
 */

/* .tile carries the stone; a control that has to sit at 24x22 says so inline rather than fighting it with a utility of equal specificity. */
const BUTTON: CSSProperties = { height: 22, width: 24 };

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

export default function PageToolbar({ view }: { view: PageView }): ReactNode {
    const go = window.zanaris.pages.go;
    return (
        <div className="flex h-full items-center gap-[5px] px-1.5">
            <Step label="Back" disabled={!view.canGoBack} on={() => void go('back')}>
                <NavArrow />
            </Step>
            <Step label="Forward" disabled={!view.canGoForward} on={() => void go('forward')}>
                <NavArrow forward />
            </Step>
            <Step label="Reload" disabled={false} on={() => void go('reload')}>
                <Reload />
            </Step>
            <div className="sunk min-w-0 flex-1 truncate px-2 py-[2px] text-link" title={view.url}>
                {view.loading ? 'Loading…' : view.title || view.url}
            </div>
        </div>
    );
}
