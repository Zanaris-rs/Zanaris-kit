import { useId, type CSSProperties, type ReactNode } from 'react';
import { worldRunning, XP_RATES, type YourWorldSettings, type YourWorldView } from '../../../shared/yourworld';

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

function change<K extends keyof YourWorldSettings>(key: K, value: YourWorldSettings[K]): void {
    void window.zanaris.yourWorld.setSetting(key, value);
}

/** An on/off setting: the button says which, and the note beside it says what on means. */
function Switch({ label, on, busy, red = false, note, onChange }: { label: string; on: boolean; busy: boolean; red?: boolean; note: string; onChange: (on: boolean) => void }): ReactNode {
    const id = useId();
    return (
        <div className="flex items-center gap-2">
            <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-describedby={id}
                disabled={busy}
                onClick={() => onChange(!on)}
                style={busy ? SPENT : on ? undefined : MUTED}
                className={`btn shrink-0${on && red && !busy ? ' btn-red' : ''}`}
            >
                {label} {on ? 'on' : 'off'}
            </button>
            <span id={id} className="text-[12px] text-dim">
                {note}
            </span>
        </div>
    );
}

/** The World section: what the kit writes into world.json for the player, and the world's own files. */
export default function World({ view }: { view: YourWorldView }): ReactNode {
    const id = useId();
    const busy = view.status === 'preparing' || view.status === 'starting' || view.status === 'stopping';
    const { settings } = view;
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-2.5 pt-2.5">
                <Switch label="Cheats" red on={settings.cheats} busy={busy} onChange={on => change('cheats', on)} note="Developer commands such as ::tele and ::give. Off, they are refused." />
                <Switch label="Members" on={settings.members} busy={busy} onChange={on => change('members', on)} note="Off, your world is a free one, as the free-to-play game was." />
                <div>
                    <div role="group" aria-labelledby={`${id}-rate`} className="flex flex-wrap items-center gap-1.5">
                        <span id={`${id}-rate`} className="mr-0.5 text-cream">
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
                    <p className="mt-1 text-[12px] text-dim">Multiplies the experience your characters earn from here on.</p>
                </div>
                {/*
                 * Not a caveat about the cheats switch, which is why it does not hang off it:
                 * the world is yours whatever the switch says, and content asks map_live -
                 * node.production, which your world never turns on. The guide is where a
                 * player meets that first, and on a second character it is the point.
                 */}
                <p className="text-[12px] text-dim">Your own world, not a live one. The guide will offer to skip the tutorial, however many characters you start.</p>
            </div>

            {/* Actions run along the bottom of a panel here, as they do in the client's own interfaces. */}
            <div className="flex flex-wrap items-center gap-2 px-2.5 pt-2 pb-1.5">
                <button type="button" onClick={() => void window.zanaris.yourWorld.showLog()} style={QUIET} className="btn group">
                    <span className="text-dim group-hover:text-cream">Show log</span>
                </button>
            </div>
            <p className="px-2.5 pb-2 text-[12px] text-dim">{worldRunning(view.status) ? 'Each change restarts the world and logs you out.' : 'Changes take effect when the world next starts.'}</p>
        </div>
    );
}
