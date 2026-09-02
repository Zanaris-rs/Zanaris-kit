import { useEffect, useState, type ReactNode } from 'react';
import type { SidebarState, SessionState } from '../shared/ipc';

const num = (n: number): string => n.toLocaleString('en-US');

function bytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function hostOf(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

/** The revision numbers are dates — this project is about specific ones. */
const REVISION_DATES: Record<number, string> = {
    225: '18 May 2004',
    244: '28 June 2004',
    254: '7 September 2004',
    274: '23 November 2004',
    289: '17 January 2005',
    377: '5 May 2006'
};

function Count({ frames, total }: { frames: number; total: number }): ReactNode {
    // Before anything flows, a dash is honest; "0 0 B" is just noise.
    if (frames === 0) return <span className="text-dim">—</span>;
    return (
        <>
            {num(frames)} <span className="text-dim">{bytes(total)}</span>
        </>
    );
}

function Chevron({ pointing }: { pointing: 'left' | 'right' }): ReactNode {
    return (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none">
            <path
                d={pointing === 'left' ? 'M6.5 1.5 3 5l3.5 3.5' : 'M3.5 1.5 7 5l-3.5 3.5'}
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="square"
            />
        </svg>
    );
}

function Section({ title, children, last }: { title: string; children: ReactNode; last?: boolean }): ReactNode {
    return (
        <section className={`px-4 py-3.5 ${last ? '' : 'border-b border-line'}`}>
            <h2 className="mb-2 font-medium text-bone">{title}</h2>
            <div>{children}</div>
        </section>
    );
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
    return (
        <div className="flex items-baseline justify-between gap-4 py-[3px]">
            <span className="shrink-0 text-[12px] text-dim">{label}</span>
            <span className="truncate font-mono text-[12px] tabular-nums">{children}</span>
        </div>
    );
}

function SeedValue({ state }: { state: boolean | null }): ReactNode {
    if (state === null) return <span className="text-dim">waiting for login</span>;
    if (state) return <span className="text-live">recovered</span>;
    return <span className="text-brass">not recovered</span>;
}

export default function App(): ReactNode {
    const [sidebar, setSidebar] = useState<SidebarState>({ open: false, mode: 'widen' });
    const [session, setSession] = useState<SessionState | null>(null);

    useEffect(() => window.swiftkit.sidebar.onState(setSidebar), []);
    useEffect(() => window.swiftkit.session.onState(setSession), []);

    const live = session?.socketOpen ?? false;

    return (
        <div className="flex h-full bg-ink">
            {sidebar.open && (
                <div className="panel-in flex w-[280px] shrink-0 flex-col border-l border-line bg-surface">
                    <Section title="Connection">
                        <Row label="Server">{session ? hostOf(session.serverUrl) : '—'}</Row>
                        <Row label="Socket">
                            {live ? <span className="text-live">open</span> : <span className="text-dim">closed</span>}
                        </Row>
                        <Row label="Received">
                            {session ? <Count frames={session.rxFrames} total={session.rxBytes} /> : '—'}
                        </Row>
                        <Row label="Sent">
                            {session ? <Count frames={session.txFrames} total={session.txBytes} /> : '—'}
                        </Row>
                    </Section>

                    <Section title="Session" last>
                        <Row label="Revision">{session?.revision ?? '—'}</Row>
                        <Row label="Dated">
                            {session?.revision && REVISION_DATES[session.revision] ? (
                                REVISION_DATES[session.revision]
                            ) : (
                                <span className="text-dim">—</span>
                            )}
                        </Row>
                        <Row label="Seed">
                            <SeedValue state={session?.seedRecovered ?? null} />
                        </Row>
                    </Section>

                    {sidebar.mode === 'push' && (
                        <div className="mt-auto border-t border-line px-4 py-3 text-[12px] leading-relaxed text-brass">
                            No room to widen the window here, so the game area is smaller while this is open.
                        </div>
                    )}
                </div>
            )}

            <div className="flex w-12 shrink-0 flex-col items-center border-l border-line py-3">
                <button
                    type="button"
                    onClick={() => void window.swiftkit.sidebar.toggle()}
                    aria-expanded={sidebar.open}
                    aria-label={sidebar.open ? 'Close panel' : 'Open panel'}
                    className="flex h-7 w-7 items-center justify-center text-bone/70 transition-colors hover:bg-surface hover:text-bone"
                >
                    <Chevron pointing={sidebar.open ? 'right' : 'left'} />
                </button>

                <span
                    aria-hidden="true"
                    title={live ? 'Connected' : 'Not connected'}
                    className={`mt-3 h-1.5 w-1.5 ${live ? 'bg-live' : 'bg-line'}`}
                />

                <span className="mt-auto font-semibold tracking-[0.18em] text-[11px] text-brass [writing-mode:vertical-rl] rotate-180">
                    SwiftKit
                </span>
            </div>
        </div>
    );
}
