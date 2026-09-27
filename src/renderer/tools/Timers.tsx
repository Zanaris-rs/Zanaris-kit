import { useEffect, useId, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { CUSTOM_TIMERS_MAX, TIMER_NAME_MAX, blankDraft, clockTone, clockValueAt, draftOf, formatClock, readDraft, type ClockView, type TimerDraft, type TimerProblem, type TimersView } from '../../shared/timers';
import { playAlert } from '../alertSound';
import { Pause, Pencil, Play, Reload } from '../icons';

/*
 * One gold button at a time. `.btn` carries the gold label, and a panel full of
 * gold labels has no primary action at all, so only the one thing the player is
 * most likely to do next wears it: Add, until a form is open, and then Save.
 * Everything else is quiet — the same stone, a dim label that lights on hover.
 *
 * `.btn` and the base `button` rule are unlayered CSS, which beats a Tailwind
 * utility of equal specificity whatever the order, so a quiet button's colour
 * sits on a span inside it (a span has no unlayered rule to lose to) and its
 * size is set inline. Gold and quiet buttons share one compact size, so the
 * gold one stands out by its label, not by being bigger.
 */
const BUTTON_SIZE: CSSProperties = { fontSize: 13, padding: '1px 8px' };
/* A duration preset: a number alone, with "min" said once after the row, so four of them fit beside the box in a 320px pane. */
const PRESET_SIZE: CSSProperties = { fontSize: 13, padding: '1px 6px', minWidth: 26 };
/* The slider and the checkbox wear the gold the rest of the controls do. */
const ACCENT: CSSProperties = { accentColor: 'var(--color-gold)' };
/* The pane header's own control size, so the row's icons match the ones above them. */
const ICON_SIZE: CSSProperties = { width: 24, height: 22 };

/*
 * Narrow, the digits have a line of their own and are fitted to it: never
 * above their 26px, and never wider than the line. `24:00:00`, the longest a
 * countdown reads, is four of its own em wide in bold Arial, so 24% of the
 * line (`cqi`) holds it with a little to spare — at `PANE_MIN_WIDTH`, with the
 * list's scrollbar showing, that is 18px. The line is the query container the
 * `cqi` is a share of. Only a timer left counting past 99 hours can be wider,
 * and then it runs past the line's end rather than under anything.
 */
const FITTED_LINE: CSSProperties = { containerType: 'inline-size' };
const FITTED_DIGITS: CSSProperties = { fontSize: 'min(26px, 24cqi)', lineHeight: 1.15 };

const FIELD = 'sunk min-w-0 px-[7px] py-[3px] font-sans text-[13px] text-cream placeholder:text-faint';

/** Each digit tone `clockTone` decides, as the class that draws it. */
const TONE_CLASS = { alarm: 'text-alarm', gold: 'text-gold', dim: 'text-dim' } as const;

/** Quick durations, in minutes. */
const PRESET_MINUTES = [1, 5, 30, 60] as const;

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

/**
 * A secondary action: stone, a dim 13px label that lights on hover, and spent
 * when it cannot be used. A label of more than one word wraps inside it in a
 * narrow pane, as the gold button's does, rather than running out of the pane.
 */
function QuietButton({ onClick, disabled = false, title, size = BUTTON_SIZE, children }: { onClick: () => void; disabled?: boolean; title?: string; size?: CSSProperties; children: ReactNode }): ReactNode {
    return (
        <button type="button" disabled={disabled} title={title} onClick={onClick} style={size} className="btn group">
            <span className={disabled ? 'text-faint' : 'text-dim group-hover:text-cream'}>{children}</span>
        </button>
    );
}

/** A clock's own control: a glyph on a small tile, named by its tooltip. `expanded` is Edit's, pressed into the stone while its form is open. */
function IconButton({ label, onClick, expanded, children }: { label: string; onClick: () => void; expanded?: boolean; children: ReactNode }): ReactNode {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            aria-expanded={expanded}
            onClick={onClick}
            style={ICON_SIZE}
            className={`${expanded ? 'sunk' : 'tile'} group flex shrink-0 items-center justify-center`}
        >
            <span className={`flex ${expanded ? 'text-cream' : 'text-dim group-hover:text-cream'}`}>{children}</span>
        </button>
    );
}

/** A small fact about a clock beside its name: its kind, or AFK mode. */
function Badge({ title, children }: { title: string; children: ReactNode }): ReactNode {
    return (
        <span title={title} className="shrink-0 border border-edge-lit px-[3px] text-[10px] leading-[13px] text-dim">
            {children}
        </span>
    );
}

/** Which form is open. One at a time: two open forms is two half-edited clocks. */
type Open = { kind: 'clock'; id: string } | { kind: 'new' } | null;

/**
 * The pane width below which a clock's controls go under its digits rather
 * than beside them.
 *
 * Beside them, the digits and the three controls share a line: `24:00:00` at
 * 26px is 104px and the controls 84px with their gaps, which a row has room
 * for from 241px with the list's scrollbar showing. Below that the digits ran
 * under the controls. Under them, each has the row's whole width, the digits
 * fitted to it (`FITTED_DIGITS`), and a row a little narrower at the sides, so
 * that the three controls still fit on their line at `PANE_MIN_WIDTH`. A pane
 * knows its own width, so the shape is read from it, as Worlds' is.
 */
const WIDE_ENOUGH = 250;

/*
 * A narrow row gives its sides 4px rather than 8, and its controls 2px apart
 * rather than 4: at `PANE_MIN_WIDTH` with the scrollbar showing, that leaves
 * the row 76px, which is the three 24px controls and their two gaps exactly.
 */
const ROW_WIDE = 'px-2 py-1.5';
const ROW_NARROW = 'px-1 py-1.5';

/** The Timers tool: every clock this window has, each with its controls and its form, and a way to add one. */
export default function Timers({ view, width }: { view: TimersView; width: number }): ReactNode {
    const wide = width >= WIDE_ENOUGH;
    const now = useNow(view.clocks.some(clock => clock.phase === 'running'));
    const [open, setOpen] = useState<Open>(null);
    const close = (): void => setOpen(null);
    const row = wide ? ROW_WIDE : ROW_NARROW;

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
            <ul className="sunk min-h-0 flex-1 overflow-y-auto">
                {view.clocks.map(clock => {
                    const editing = open?.kind === 'clock' && open.id === clock.def.id;
                    return (
                        <li key={clock.def.id} className={`border-b border-edge-dark ${row} last:border-b-0`}>
                            <ClockRow clock={clock} now={now} wide={wide} editing={editing} onEdit={() => setOpen(editing ? null : { kind: 'clock', id: clock.def.id })} />
                            {editing && <ClockForm clock={clock} wide={wide} onDone={close} />}
                        </li>
                    );
                })}
                {open?.kind === 'new' && (
                    <li className={row}>
                        <span className="text-[12px] text-dim">New countdown or timer</span>
                        <ClockForm clock={null} wide={wide} onDone={close} />
                    </li>
                )}
            </ul>

            {/* Actions run along the bottom of a panel here, as they do in the client's own interfaces. */}
            <div className="flex flex-wrap items-center gap-2">
                {open === null && !view.customsFull ? (
                    <button type="button" onClick={() => setOpen({ kind: 'new' })} style={BUTTON_SIZE} className="btn">
                        Add countdown or timer
                    </button>
                ) : (
                    <QuietButton disabled={view.customsFull || open?.kind === 'new'} onClick={() => setOpen({ kind: 'new' })}>
                        Add countdown or timer
                    </QuietButton>
                )}
                {view.customsFull && <span className="text-[12px] text-dim">{CUSTOM_TIMERS_MAX} of your own is the most.</span>}
            </div>
            <p className="text-[12px] text-dim">Timers run with the pane closed.</p>
        </div>
    );
}

/**
 * One clock. The time is what a player looks for, so it is the largest thing in
 * the row; the name sits small above it with the clock's kind and AFK mode, and
 * the controls are small glyphs on the time's own line — or, narrow, on a line
 * of their own under it (`WIDE_ENOUGH`), where the name's badges also go under
 * the name when the two do not fit side by side.
 *
 * The digits never shrink below their own width, so nothing is drawn over
 * them. Were a wide row ever too short for them — a timer counting past 99
 * hours — the controls would go under them there too, rather than over them.
 */
function ClockRow({ clock, now, wide, editing, onEdit }: { clock: ClockView; now: number; wide: boolean; editing: boolean; onEdit: () => void }): ReactNode {
    const { id, name, kind, afk } = clock.def;
    const running = clock.phase === 'running';
    return (
        <>
            <div className={`flex min-w-0 items-center gap-1${wide ? '' : ' flex-wrap gap-y-0.5'}`}>
                {/* The title is the whole name, however much of it the row has room for. */}
                <span title={name} className="min-w-0 truncate text-[12px] text-dim">
                    {name}
                </span>
                <Badge title={kind === 'countdown' ? 'Counts down to 0:00' : 'Counts up from 0:00'}>{kind === 'countdown' ? 'Countdown' : 'Timer'}</Badge>
                {afk && <Badge title="Restarts on any click or key in the game">AFK</Badge>}
            </div>
            <div className={`flex flex-wrap items-center ${wide ? 'gap-1' : 'gap-y-1'}`} style={wide ? undefined : FITTED_LINE}>
                {/* Arial, not the pixel face: in Pixelify Sans a 5 reads as an S and a 7 as a 1. */}
                <span
                    style={wide ? undefined : FITTED_DIGITS}
                    className={`${wide ? 'flex-1 text-[26px] leading-[30px]' : 'w-full'} font-sans font-bold whitespace-nowrap tabular-nums ${TONE_CLASS[clockTone(clock)]}`}
                >
                    {formatClock(clockValueAt(clock, now), kind)}
                </span>
                <span className={`flex ${wide ? 'gap-1' : 'gap-0.5'}`}>
                    <IconButton label={running ? `Pause ${name}` : `Start ${name}`} onClick={() => void (running ? window.zanaris.timers.pause(id) : window.zanaris.timers.start(id))}>
                        {running ? <Pause /> : <Play />}
                    </IconButton>
                    <IconButton label={`Reset ${name}`} onClick={() => void window.zanaris.timers.reset(id)}>
                        <Reload />
                    </IconButton>
                    <IconButton label={`Edit ${name}`} expanded={editing} onClick={onEdit}>
                        <Pencil />
                    </IconButton>
                </span>
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
function ClockForm({ clock, wide, onDone }: { clock: ClockView | null; wide: boolean; onDone: () => void }): ReactNode {
    const id = useId();
    const [draft, setDraft] = useState<TimerDraft>(() => (clock ? draftOf(clock.def) : blankDraft()));
    const [refusal, setRefusal] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const reading = readDraft(draft);
    const problem: TimerProblem | null = reading.ok ? null : reading.problem;
    const builtIn = clock?.builtIn ?? false;
    const percent = Math.round(draft.volume * 100);
    const saveable = reading.ok && !busy;

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
                <input id={`${id}-name`} value={draft.name} maxLength={TIMER_NAME_MAX} onChange={e => change({ name: e.target.value })} className={`${FIELD} w-[170px] max-w-full`} />
                {note('name')}
            </div>

            {/*
             * A built-in's kind is the kit's: an AFK countdown that counted up
             * would not be one. The two kinds are one small switch cut into the
             * stone, the chosen half raised, rather than two buttons competing
             * with Save for the gold.
             *
             * Its labels are the row's own 13px Arial: the base `button` rule's
             * `font: inherit` is unlayered, so a face or size utility on the
             * button would be a silent no-op. Narrow, the halves are stacked
             * and the frame and the halves give up their inner padding, since
             * at `PANE_MIN_WIDTH` "Countdown" is 66px of the 68 a half has.
             */}
            {!builtIn && (
                <div role="radiogroup" aria-label="Kind" className={`sunk flex ${wide ? 'self-start p-[2px]' : 'flex-col'}`}>
                    {(['countdown', 'timer'] as const).map(kind => {
                        const chosen = draft.kind === kind;
                        const padding = wide ? '0 8px' : 0;
                        return (
                            <button
                                key={kind}
                                type="button"
                                role="radio"
                                aria-checked={chosen}
                                onClick={() => change({ kind })}
                                style={chosen ? { padding } : { padding, border: '2px solid transparent' }}
                                className={`group${chosen ? ' tile' : ''}`}
                            >
                                <span className={chosen ? 'text-cream' : 'text-dim group-hover:text-cream'}>{kind === 'countdown' ? 'Countdown' : 'Timer'}</span>
                            </button>
                        );
                    })}
                </div>
            )}

            {draft.kind === 'countdown' && (
                <div className="flex flex-col gap-0.5">
                    <label htmlFor={`${id}-duration`} className="text-[12px] text-dim">
                        Duration
                    </label>
                    <div className="flex flex-wrap items-center gap-1">
                        <input id={`${id}-duration`} value={draft.duration} onChange={e => change({ duration: e.target.value })} placeholder="5:00" className={`${FIELD} mr-1 w-[84px]`} />
                        {PRESET_MINUTES.map(minutes => (
                            <QuietButton key={minutes} title={`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`} size={PRESET_SIZE} onClick={() => change({ duration: `${minutes}:00` })}>
                                {/* Arial, as the digits are: in the pixel face this row read "1 S 30 60". */}
                                <span className="font-sans text-[12px]">{minutes}</span>
                            </QuietButton>
                        ))}
                        <span className="text-[12px] text-dim">min</span>
                    </div>
                    {note('durationMs')}
                </div>
            )}

            <div className="flex flex-col gap-0.5">
                <label htmlFor={`${id}-threshold`} className="text-[12px] text-dim">
                    {draft.kind === 'countdown' ? 'Alert when this much is left' : 'Alert when this much has passed'}
                </label>
                <input id={`${id}-threshold`} value={draft.threshold} onChange={e => change({ threshold: e.target.value })} placeholder="0:30" className={`${FIELD} w-[84px] max-w-full`} />
                {note('thresholdMs')}
            </div>

            <div className="flex flex-col gap-0.5">
                <label htmlFor={`${id}-volume`} className="text-[12px] text-dim">
                    Volume
                </label>
                {/* Narrow, the slider has a line of its own: beside the figure and Test it was left no width at all. */}
                <div className={`flex items-center gap-2${wide ? '' : ' flex-wrap gap-y-1'}`}>
                    <input id={`${id}-volume`} type="range" min={0} max={100} step={5} value={percent} onChange={e => change({ volume: Number(e.target.value) / 100 })} style={ACCENT} className={wide ? 'min-w-0 flex-1' : 'w-full'} />
                    <span className="w-[38px] shrink-0 text-right text-[12px] text-cream tabular-nums">{percent}%</span>
                    <QuietButton disabled={percent === 0} onClick={() => void playAlert(draft.volume)}>
                        Test
                    </QuietButton>
                </div>
                {note('volume')}
            </div>

            {/* Narrow, the label runs to several lines, and the box stays level with the first. */}
            <label className={`flex gap-2 text-cream ${wide ? 'items-center' : 'items-start'}`}>
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
                {/* The form's one gold button. Spent, not hidden, while the form cannot be saved: the reason is under the field. */}
                <button type="submit" disabled={!saveable} style={saveable ? BUTTON_SIZE : { ...BUTTON_SIZE, color: 'var(--color-faint)' }} className="btn">
                    Save
                </button>
                <QuietButton onClick={onDone}>Cancel</QuietButton>
                {clock && !builtIn && (
                    /* Text, not a button: deleting is rare, and a red slab beside Save is the loudest thing in the form. */
                    <button type="button" disabled={busy} onClick={() => void send(window.zanaris.timers.delete(clock.def.id))} className="group ml-auto">
                        <span className="text-[12px] text-dim underline-offset-2 group-hover:text-alarm group-hover:underline">Delete</span>
                    </button>
                )}
                {clock && builtIn && clock.edited && (
                    <span className="ml-auto">
                        <QuietButton disabled={busy} onClick={() => void send(window.zanaris.timers.restore(clock.def.id))}>
                            Restore default
                        </QuietButton>
                    </span>
                )}
            </div>
        </form>
    );
}
