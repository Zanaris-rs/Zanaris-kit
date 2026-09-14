import { useEffect, useId, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { CUSTOM_TIMERS_MAX, TIMER_NAME_MAX, blankDraft, clockValueAt, draftOf, formatClock, readDraft, type ClockView, type TimerDraft, type TimerProblem, type TimersView } from '../../shared/timers';
import { playAlert } from '../alertSound';

/*
 * .btn is hand-written CSS carrying the gold label, so a control that wants a
 * quieter colour overrides it inline. A utility class of equal specificity
 * would be settled by stylesheet order rather than by intent.
 */
const MUTED: CSSProperties = { color: 'var(--color-dim)' };
const SPENT: CSSProperties = { color: 'var(--color-faint)' };
/* The slider and the checkbox wear the gold the rest of the controls do. */
const ACCENT: CSSProperties = { accentColor: 'var(--color-gold)' };

const FIELD = 'sunk min-w-0 px-[7px] py-[3px] font-sans text-[13px] text-cream placeholder:text-faint';

/** The artboard's quick durations, in minutes. */
const PRESET_MINUTES = [1, 5, 30, 80] as const;

/**
 * How often the digits are redrawn while a clock runs. Only the drawing: each
 * redraw reads the value from main's snapshot, so a slow interval makes a digit
 * change late, never wrong — and the alert is main's, not this interval's.
 */
const DRAW_EVERY_MS = 250;

function useNow(active: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active) return;
        setNow(Date.now());
        const interval = window.setInterval(() => setNow(Date.now()), DRAW_EVERY_MS);
        return () => window.clearInterval(interval);
    }, [active]);
    return now;
}

/** Which form is open. One at a time: two open forms is two half-edited clocks. */
type Open = { kind: 'clock'; id: string } | { kind: 'new' } | null;

/** The Timers tool: every clock this window has, each with its controls and its form, and a way to add one. */
export default function Timers({ view }: { view: TimersView }): ReactNode {
    const now = useNow(view.clocks.some(clock => clock.phase === 'running'));
    const [open, setOpen] = useState<Open>(null);
    const close = (): void => setOpen(null);
    const adding = open?.kind === 'new';

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <ul className="sunk mx-2.5 min-h-0 flex-1 overflow-y-auto">
                {view.clocks.map(clock => {
                    const editing = open?.kind === 'clock' && open.id === clock.def.id;
                    return (
                        <li key={clock.def.id} className="border-b border-edge-dark px-2 py-1.5 last:border-b-0">
                            <ClockRow clock={clock} now={now} editing={editing} onEdit={() => setOpen(editing ? null : { kind: 'clock', id: clock.def.id })} />
                            {editing && <ClockForm clock={clock} onDone={close} />}
                        </li>
                    );
                })}
                {adding && (
                    <li className="px-2 py-1.5">
                        <span className="text-cream">New countdown or timer</span>
                        <ClockForm clock={null} onDone={close} />
                    </li>
                )}
            </ul>

            {/* Actions run along the bottom of a panel here, as they do in the client's own interfaces. */}
            <div className="flex flex-wrap items-center gap-2 px-2.5 pt-2 pb-1.5">
                <button type="button" disabled={view.customsFull || adding} onClick={() => setOpen({ kind: 'new' })} style={view.customsFull || adding ? SPENT : undefined} className="btn">
                    Add countdown or timer
                </button>
                {view.customsFull && <span className="text-[12px] text-dim">{CUSTOM_TIMERS_MAX} of your own is the most.</span>}
            </div>
            <p className="px-2.5 pb-2 text-[12px] text-dim">Timers run with the panel closed.</p>
        </div>
    );
}

/** One clock: its name and digits, then Start or Pause, Reset and Edit on a line of their own so a narrow pane keeps the digits whole. */
function ClockRow({ clock, now, editing, onEdit }: { clock: ClockView; now: number; editing: boolean; onEdit: () => void }): ReactNode {
    const { id, name, kind, afk } = clock.def;
    const running = clock.phase === 'running';
    const tone = clock.phase === 'expired' || (running && clock.alerted) ? 'text-alarm' : running ? 'text-gold' : 'text-dim';
    return (
        <>
            <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-cream">{name}</span>
                {afk && (
                    <span title="Restarts on any click or key in the game" className="shrink-0 border border-edge-lit px-1 text-[11px] text-dim">
                        AFK
                    </span>
                )}
                {/* Arial, not the pixel face: in Pixelify Sans a 5 reads as an S and a 7 as a 1. */}
                <span className={`shrink-0 font-sans text-[20px] font-bold tabular-nums ${tone}`}>{formatClock(clockValueAt(clock, now), kind)}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
                <button type="button" onClick={() => void (running ? window.zanaris.timers.pause(id) : window.zanaris.timers.start(id))} className="btn">
                    {running ? 'Pause' : 'Start'}
                </button>
                <button type="button" onClick={() => void window.zanaris.timers.reset(id)} className="btn">
                    Reset
                </button>
                <button type="button" aria-expanded={editing} onClick={onEdit} style={editing ? undefined : MUTED} className="btn">
                    Edit
                </button>
            </div>
        </>
    );
}

/**
 * The form for one clock, or a new one when `clock` is null. It is checked
 * here with the same `readDraft` main's rules sit behind, so Save is off while
 * the form is wrong and the reason sits under the field; main checks again
 * and its refusal is shown rather than swallowed.
 */
function ClockForm({ clock, onDone }: { clock: ClockView | null; onDone: () => void }): ReactNode {
    const id = useId();
    const [draft, setDraft] = useState<TimerDraft>(() => (clock ? draftOf(clock.def) : blankDraft()));
    const [refusal, setRefusal] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const reading = readDraft(draft);
    const problem: TimerProblem | null = reading.ok ? null : reading.problem;
    const builtIn = clock?.builtIn ?? false;
    const percent = Math.round(draft.volume * 100);

    const change = (patch: Partial<TimerDraft>): void => {
        setDraft(current => ({ ...current, ...patch }));
        setRefusal(null);
    };

    const send = async (request: Promise<string | null>): Promise<void> => {
        setBusy(true);
        try {
            const refused = await request;
            if (refused === null) onDone();
            else setRefusal(refused);
        } finally {
            setBusy(false);
        }
    };

    const submit = (event: FormEvent): void => {
        event.preventDefault();
        if (reading.ok) void send(window.zanaris.timers.save(reading.input));
    };

    const note = (field: TimerProblem['field']): ReactNode => (problem?.field === field ? <span className="text-[12px] text-warn">{problem.message}</span> : null);

    return (
        <form onSubmit={submit} className="mt-2 flex flex-col gap-2 border-t border-edge-dark pt-2">
            <div className="flex flex-col gap-0.5">
                <label htmlFor={`${id}-name`} className="text-[12px] text-dim">
                    Name
                </label>
                <input id={`${id}-name`} value={draft.name} maxLength={TIMER_NAME_MAX} onChange={e => change({ name: e.target.value })} className={FIELD} />
                {note('name')}
            </div>

            {/* A built-in's kind is the kit's: an AFK countdown that counted up would not be one. */}
            {!builtIn && (
                <div role="radiogroup" aria-label="Kind" className="flex gap-1.5">
                    {(['countdown', 'timer'] as const).map(kind => (
                        <button key={kind} type="button" role="radio" aria-checked={draft.kind === kind} onClick={() => change({ kind })} style={draft.kind === kind ? undefined : MUTED} className="btn">
                            {kind === 'countdown' ? 'Countdown' : 'Timer'}
                        </button>
                    ))}
                </div>
            )}

            {draft.kind === 'countdown' && (
                <div className="flex flex-col gap-0.5">
                    <label htmlFor={`${id}-duration`} className="text-[12px] text-dim">
                        Duration
                    </label>
                    <div className="flex flex-wrap items-center gap-1.5">
                        <input id={`${id}-duration`} value={draft.duration} onChange={e => change({ duration: e.target.value })} placeholder="5:00" className={`${FIELD} w-[84px]`} />
                        {PRESET_MINUTES.map(minutes => (
                            <button key={minutes} type="button" onClick={() => change({ duration: `${minutes}:00` })} style={MUTED} className="btn">
                                {minutes} min
                            </button>
                        ))}
                    </div>
                    {note('durationMs')}
                </div>
            )}

            <div className="flex flex-col gap-0.5">
                <label htmlFor={`${id}-threshold`} className="text-[12px] text-dim">
                    {draft.kind === 'countdown' ? 'Alert when this much is left' : 'Alert when this much has passed'}
                </label>
                <input id={`${id}-threshold`} value={draft.threshold} onChange={e => change({ threshold: e.target.value })} placeholder="0:30" className={`${FIELD} w-[84px]`} />
                {note('thresholdMs')}
            </div>

            <div className="flex flex-col gap-0.5">
                <label htmlFor={`${id}-volume`} className="text-[12px] text-dim">
                    Volume
                </label>
                <div className="flex items-center gap-2">
                    <input id={`${id}-volume`} type="range" min={0} max={100} step={5} value={percent} onChange={e => change({ volume: Number(e.target.value) / 100 })} style={ACCENT} className="min-w-0 flex-1" />
                    <span className="w-[38px] shrink-0 text-right text-[12px] text-cream tabular-nums">{percent}%</span>
                    <button type="button" disabled={percent === 0} onClick={() => void playAlert(draft.volume)} style={percent === 0 ? SPENT : undefined} className="btn shrink-0">
                        Test
                    </button>
                </div>
                {note('volume')}
            </div>

            <label className="flex items-center gap-2 text-cream">
                <input type="checkbox" checked={draft.afk} onChange={e => change({ afk: e.target.checked })} style={ACCENT} />
                <span>
                    AFK mode <span className="text-[12px] text-dim">restarts on any click or key in the game</span>
                </span>
            </label>

            {refusal && (
                <p role="alert" className="text-[12px] text-warn">
                    {refusal}
                </p>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
                <button type="submit" disabled={!reading.ok || busy} style={!reading.ok || busy ? SPENT : undefined} className="btn">
                    Save
                </button>
                <button type="button" onClick={onDone} style={MUTED} className="btn">
                    Cancel
                </button>
                {clock && !builtIn && (
                    <button type="button" disabled={busy} onClick={() => void send(window.zanaris.timers.delete(clock.def.id))} className="btn btn-red ml-auto">
                        Delete
                    </button>
                )}
                {clock && builtIn && clock.edited && (
                    <button type="button" disabled={busy} onClick={() => void send(window.zanaris.timers.restore(clock.def.id))} style={MUTED} className="btn ml-auto">
                        Restore default
                    </button>
                )}
            </div>
        </form>
    );
}
