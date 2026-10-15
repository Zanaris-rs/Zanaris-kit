import { useId, type CSSProperties, type ReactNode } from 'react';
import { XP_RATES, type HomeServerSettings, type HomeServerView } from '../../../shared/homeserver';
import { scrollClass, sectionClass } from './fill';

/*
 * .btn is hand-written CSS carrying the gold label, so a button that wants a
 * quieter colour or a smaller box overrides it inline. A utility class of
 * equal specificity would be settled by stylesheet order rather than by intent.
 */
const MUTED: CSSProperties = { color: 'var(--color-dim)' };
/* A control the world is currently busy with: spent, since .btn:disabled paints nothing of its own. */
const SPENT: CSSProperties = { color: 'var(--color-faint)' };
/* Each rate as wide as the widest label, so the row does not shift as the pressed one moves. */
const RATE: CSSProperties = { fontSize: 13, padding: '1px 6px', minWidth: 38 };
const QUIET: CSSProperties = { fontSize: 13, padding: '1px 8px' };
/*
 * A narrow switch's sides are 4px rather than the 12 `.btn` gives, as Worlds'
 * stacked buttons are: at `PANE_MIN_WIDTH`, with the tool's scrollbar
 * showing, a switch has 88px, and "Members" alone was 94 with the wider sides.
 */
const TIGHT: CSSProperties = { paddingLeft: 4, paddingRight: 4 };

function change<K extends keyof HomeServerSettings>(key: K, value: HomeServerSettings[K]): void {
    void window.zanaris.homeServer.setSetting(key, value);
}

/**
 * An on/off setting: the button says which, and the note under it, at every
 * width, says what on means where the label alone does not. The button keeps
 * to its label's width, and its label wraps inside it only in a pane narrower
 * than that.
 */
function Switch({ label, on, busy, red = false, note, wide, onChange }: { label: string; on: boolean; busy: boolean; red?: boolean; note?: string; wide: boolean; onChange: (on: boolean) => void }): ReactNode {
    const id = useId();
    return (
        <div className="flex flex-col items-start gap-1">
            <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-describedby={note === undefined ? undefined : id}
                disabled={busy}
                onClick={() => onChange(!on)}
                style={{ ...(busy ? SPENT : on ? undefined : MUTED), ...(wide ? undefined : TIGHT) }}
                className={`btn${on && red && !busy ? ' btn-red' : ''}`}
            >
                {label} {on ? 'on' : 'off'}
            </button>
            {note !== undefined && (
                <span id={id} className="text-[12px] text-dim">
                    {note}
                </span>
            )}
        </div>
    );
}

/** The World section: what the kit writes into world.json for the player, and the world's own files. */
export default function World({ view, wide }: { view: HomeServerView; wide: boolean }): ReactNode {
    const id = useId();
    const busy = view.status === 'preparing' || view.status === 'starting' || view.status === 'stopping';
    const { settings } = view;
    return (
        <div className={sectionClass(wide)}>
            <div className={`flex flex-col gap-2.5 ${scrollClass(wide)}`}>
                <Switch label="Cheats" red on={settings.cheats} busy={busy} wide={wide} onChange={on => change('cheats', on)} note="Developer commands such as ::tele and ::give. Off, they are refused." />
                <Switch label="Members" on={settings.members} busy={busy} wide={wide} onChange={on => change('members', on)} />
                {/* Narrow, the label has a line of its own and the rates wrap under it, rather than one rate on the label's line and the rest below. */}
                <div role="group" aria-labelledby={`${id}-rate`} className="flex flex-wrap items-center gap-1.5">
                    <span id={`${id}-rate`} className={wide ? 'mr-0.5 text-cream' : 'w-full text-cream'}>
                        XP rate
                    </span>
                    {XP_RATES.map(rate => {
                        const current = settings.xpRate === rate;
                        return (
                            <button
                                key={rate}
                                type="button"
                                aria-pressed={current}
                                disabled={busy}
                                onClick={() => change('xpRate', rate)}
                                style={{ ...RATE, ...(busy ? SPENT : current ? undefined : MUTED) }}
                                className="btn"
                            >
                                {/* .btn sets the pixel face, which misdraws digits; the rate is a number, so it is Arial. */}
                                <span className="font-sans">{rate}×</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Actions run along the bottom of a panel here, as they do in the client's own interfaces. */}
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void window.zanaris.homeServer.showLog()} style={QUIET} className="btn group">
                    <span className="text-dim group-hover:text-cream">Show log</span>
                </button>
            </div>
        </div>
    );
}
