import { Component, Fragment, type ReactNode } from 'react';
import { TAB_BAR_HEIGHT } from '../shared/layout';
import { toolNotice, windowNotice, type PaneNotice as Notice, type PaneNoticeAction } from '../shared/paneNotice';

/**
 * What a pane shows when what it holds has stopped: the game or a page whose
 * renderer crashed or hung, which main reports with the pane
 * (`PaneView.notice`) and hides the view for; or a tool that failed to draw,
 * which `PaneBoundary` below catches. One component for every case, so each
 * says what happened and offers its ways back in the same place and the same
 * shape. The words are `shared/paneNotice.ts`'s.
 *
 * `row` lays the same notice out in one line, for the one place a column
 * cannot go: a game window's tab bar, below which the game may cover
 * everything (`WindowBoundary`).
 */
export default function PaneNotice({ notice, onAction, row = false }: { notice: Notice; onAction: (action: PaneNoticeAction) => void; row?: boolean }): ReactNode {
    const buttons = notice.actions.map(action => (
        <button key={action.id} type="button" onClick={() => onAction(action.id)} className="btn shrink-0">
            {action.label}
        </button>
    ));
    if (row) {
        return (
            <div role="alert" className="flex min-w-0 items-center justify-center gap-3 px-3">
                <span className="shrink-0 font-pixel text-[15px] text-gold">{notice.title}</span>
                <span className="min-w-0 truncate text-[13px] text-dim">{notice.detail}</span>
                {buttons}
            </div>
        );
    }
    return (
        <div role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
            <p className="font-pixel text-[15px] text-gold">{notice.title}</p>
            <p className="max-w-[360px] text-[13px] text-dim">{notice.detail}</p>
            <div className="flex flex-wrap justify-center gap-2">{buttons}</div>
        </div>
    );
}

/**
 * A tool's body, caught if it throws while drawing. Without it one tool's
 * throw took the whole shell with it — the tab bar and every pane header —
 * since React unmounts everything above an uncaught error. Open again draws
 * the tool fresh; its state is main's, so only what was typed into it goes.
 */
export class PaneBoundary extends Component<{ name: string; paneId: string; children: ReactNode }, { failed: boolean; attempt: number }> {
    state = { failed: false, attempt: 0 };

    static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }

    render(): ReactNode {
        if (!this.state.failed) return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
        return (
            <PaneNotice
                notice={toolNotice(this.props.name)}
                onAction={action => {
                    if (action === 'retry') this.setState(s => ({ failed: false, attempt: s.attempt + 1 }));
                    else if (action === 'close') void window.zanaris.panes.close(this.props.paneId);
                }}
            />
        );
    }
}

/**
 * The whole page, caught: a game window's shell or Settings. What is left of
 * the page is this notice, and Reload draws it again — a reload of the page
 * itself, the one navigation `guard.decideShellNavigation` lets through. The
 * game is a view of its own and keeps running under a shell that reloads.
 *
 * In a game window the notice takes the tab bar's strip and nothing more.
 * The game and any page are native views stacked above the shell, so a
 * notice drawn in the middle of the window would sit underneath them, out of
 * sight and out of reach; the strip is the one part of a game window no view
 * ever covers. Settings has no views, so its notice fills the window.
 */
export class WindowBoundary extends Component<{ page: 'shell' | 'settings'; children: ReactNode }, { failed: boolean }> {
    state = { failed: false };

    static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }

    render(): ReactNode {
        if (!this.state.failed) return this.props.children;
        const reload = (): void => location.reload();
        if (this.props.page === 'shell') {
            return (
                <div className="h-full bg-ink text-cream">
                    <div style={{ height: TAB_BAR_HEIGHT }} className="tile flex items-center justify-center">
                        <PaneNotice row notice={windowNotice('shell')} onAction={reload} />
                    </div>
                </div>
            );
        }
        return (
            <div className="flex h-full flex-col bg-ink text-cream">
                <PaneNotice notice={windowNotice('settings')} onAction={reload} />
            </div>
        );
    }
}
