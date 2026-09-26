import { Component, Fragment, type ReactNode } from 'react';
import { toolNotice, windowNotice, type PaneNotice as Notice, type PaneNoticeAction } from '../shared/paneNotice';

/**
 * What a pane shows when what it holds has stopped: the game or a page whose
 * renderer crashed or hung, which main reports with the pane
 * (`PaneView.notice`) and hides the view for; or a tool that failed to draw,
 * which `PaneBoundary` below catches. One component for every case, so each
 * says what happened and offers its ways back in the same place and the same
 * shape. The words are `shared/paneNotice.ts`'s.
 */
export default function PaneNotice({ notice, onAction }: { notice: Notice; onAction: (action: PaneNoticeAction) => void }): ReactNode {
    return (
        <div role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
            <p className="font-pixel text-[15px] text-gold">{notice.title}</p>
            <p className="max-w-[360px] text-[13px] text-dim">{notice.detail}</p>
            <div className="flex flex-wrap justify-center gap-2">
                {notice.actions.map(action => (
                    <button key={action.id} type="button" onClick={() => onAction(action.id)} className="btn">
                        {action.label}
                    </button>
                ))}
            </div>
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
 */
export class WindowBoundary extends Component<{ page: 'shell' | 'settings'; children: ReactNode }, { failed: boolean }> {
    state = { failed: false };

    static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }

    render(): ReactNode {
        if (!this.state.failed) return this.props.children;
        return (
            <div className="flex h-full flex-col bg-ink text-cream">
                <PaneNotice notice={windowNotice(this.props.page)} onAction={() => location.reload()} />
            </div>
        );
    }
}
