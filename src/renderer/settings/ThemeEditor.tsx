import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { FITS, NICK_COLOURS, SHOW_MAX, contrastWarnings, themeVars, type Fit, type ThemeColors, type ThemeDraft, type ThemeLook, type ThemeToken } from '../../shared/themes.ts';
import { FIELD, QuietButton } from './Servers';

/*
 * `.btn`, `.tab` and the base `button` rule are unlayered CSS, which beats a
 * Tailwind utility of equal specificity whatever the order, so the places
 * below that contradict them say so inline.
 */
/* Save: the section's one gold button, sized as Servers' are. */
const BUTTON_SIZE: CSSProperties = { fontSize: 13, padding: '1px 8px' };
/* A text tab inside the preview, rather than `.tab`'s fixed 36x34 square. */
const PREVIEW_TAB: CSSProperties = { width: 'auto', height: 20, padding: '0 8px', fontSize: 12 };
/* The preview's own buttons are drawings, not controls, at the size of the real ones. */
const PREVIEW_BUTTON: CSSProperties = { fontSize: 13, padding: '1px 8px' };
/* The slider and the colour wells wear the gold the client's own accents do. */
const ACCENT: CSSProperties = { accentColor: 'var(--color-gold)' };

/** Every token, in the words a player would use for it, grouped by what it paints. Each of the 21 appears once. */
const GROUPS: readonly { title: string; rows: readonly [ThemeToken, string][] }[] = [
    {
        title: 'Surfaces',
        rows: [
            ['ink', 'Ink: behind everything'],
            ['stone', 'Panels'],
            ['stone-lit', 'Lit stone: the open tab'],
            ['tab', 'Tabs'],
            ['tab-down', 'A tab being pressed'],
            ['well', 'Wells: lists and fields'],
            ['window', 'Window: before a page draws']
        ]
    },
    {
        title: 'Edges',
        rows: [
            ['edge-lit', 'Lit edges'],
            ['edge-dark', 'Dark edges'],
            ['outline', 'Sprite outlines']
        ]
    },
    {
        title: 'Text',
        rows: [
            ['cream', 'Text'],
            ['dim', 'Quieter text'],
            ['faint', 'Quietest text'],
            ['gold', 'Headings'],
            ['link', 'Links']
        ]
    },
    {
        title: 'Signals',
        rows: [
            ['good', 'Good news'],
            ['warn', 'Warnings'],
            ['alarm', 'Alarms'],
            ['red', 'Red buttons'],
            ['red-lit', "A red button's lit edge"],
            ['red-edge', "A red button's dark edge"]
        ]
    }
];

const FIT_LABELS: Readonly<Record<Fit, string>> = { cover: 'Fill the window', contain: 'Fit inside', tile: 'Tile' };

/** A new picture starts showing this much, which leaves every word on solid enough stone. */
const FIRST_SHOW = 0.35;

/**
 * A small frame drawn with the kit's own classes under the draft's variables
 * and picture, set inline on the box: tabs, a panel with every kind of text,
 * a well with chat names and a link, and the two kinds of button. It follows
 * every change as it is made, since it is only this page's; the windows
 * change on Save.
 */
function Preview({ look }: { look: ThemeLook }): ReactNode {
    return (
        <div aria-hidden="true" style={themeVars(look) as CSSProperties} className="picture bg-ink">
            <div className="tile flex items-center gap-[5px] px-1.5 py-1" style={{ borderTop: 'none', borderLeft: 'none', borderRight: 'none' }}>
                <span className="tab tab-on" style={PREVIEW_TAB}>
                    Game
                </span>
                <span className="tab text-dim" style={PREVIEW_TAB}>
                    Guides
                </span>
            </div>
            <div className="flex gap-1.5 p-1.5">
                <div className="tile flex min-w-0 flex-1 flex-col gap-1 p-1.5">
                    <span className="font-pixel text-[14px] leading-none text-gold">Timers</span>
                    <span className="text-[13px] text-cream">AFK · 0:46</span>
                    <span className="text-[12px] text-dim">Countdown, 15s warning</span>
                    <span className="text-[12px] text-faint">Runs with the panel closed.</span>
                    <span className="text-[12px] text-alarm">Thieving · 0:00</span>
                </div>
                <div className="tile flex min-w-0 flex-1 flex-col gap-1.5 p-1.5">
                    <span className="sunk flex flex-wrap gap-x-1.5 px-1 py-0.5 text-[12px]">
                        {['Hans', 'Bob', 'Duke'].map((name, i) => (
                            <span key={name} style={{ color: NICK_COLOURS[i] }}>
                                {name}
                            </span>
                        ))}
                        <span className="link">a link</span>
                        <span className="text-good">W7 50 ms</span>
                        <span className="text-warn">W1 300 ms</span>
                    </span>
                    <span className="flex gap-1.5">
                        <span className="btn" style={PREVIEW_BUTTON}>
                            Refresh
                        </span>
                        <span className="btn btn-red" style={PREVIEW_BUTTON}>
                            Delete
                        </span>
                    </span>
                </div>
            </div>
        </div>
    );
}

/**
 * One colour: its name, a colour well, and a hex field. The field holds what
 * is typed and applies it only once it is a whole `#rrggbb`, so typing a
 * colour out never paints a half one; the well always holds a whole one.
 */
function ColorRow({ token, label, value, onChange }: { token: ThemeToken; label: string; value: string; onChange: (value: string) => void }): ReactNode {
    const id = useId();
    const [typed, setTyped] = useState(value);
    useEffect(() => setTyped(value), [value]);
    return (
        <li className="flex items-center gap-2 px-2 py-1">
            <label htmlFor={id} className="min-w-0 flex-1 truncate text-[12px] text-cream">
                {label}
            </label>
            <input type="color" aria-label={`${label}: pick`} value={value} style={ACCENT} onChange={e => onChange(e.target.value)} className="h-[22px] w-[34px] shrink-0 cursor-pointer" />
            <input
                id={id}
                data-token={token}
                value={typed}
                spellCheck={false}
                onChange={e => {
                    setTyped(e.target.value);
                    if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase());
                }}
                onBlur={() => setTyped(value)}
                className={`${FIELD} w-[84px] shrink-0 font-mono`}
            />
        </li>
    );
}

/**
 * The theme editor, in place of the Appearance section while it is open.
 * Every colour is the player's to set; the warnings say when a pair reads
 * worse than 2004 stone's, and saving is still their call. A picture is
 * chosen in a dialog of main's, which answers its stored name.
 */
export default function ThemeEditor({ initial, onClose }: { initial: ThemeDraft; onClose: () => void }): ReactNode {
    const [draft, setDraft] = useState<ThemeDraft>(initial);
    const [busy, setBusy] = useState(false);
    const [said, setSaid] = useState<{ text: string; alert: boolean } | null>(null);
    const nameId = useId();
    const fitId = useId();
    const showId = useId();
    const saved = initial.id !== null;
    const changed = JSON.stringify(draft) !== JSON.stringify(initial);
    const warnings = contrastWarnings(draft.colors);

    const setColor = (token: ThemeToken, value: string): void => setDraft(d => ({ ...d, colors: { ...d.colors, [token]: value } as ThemeColors }));

    const run = async <T,>(request: Promise<T>, then: (answer: T) => void): Promise<void> => {
        setBusy(true);
        setSaid(null);
        try {
            then(await request);
        } finally {
            setBusy(false);
        }
    };

    const choosePicture = (): Promise<void> =>
        run(window.zanaris.appearance.choosePicture(), answer => {
            if (answer === null) return;
            if ('error' in answer) setSaid({ text: answer.error, alert: true });
            else setDraft(d => ({ ...d, background: { picture: answer.picture, fit: d.background?.fit ?? 'cover', show: d.background?.show ?? FIRST_SHOW } }));
        });

    const save = (): Promise<void> =>
        run(window.zanaris.appearance.saveCustom(draft), answer => {
            if ('error' in answer) setSaid({ text: answer.error, alert: true });
            else onClose();
        });

    const exportTheme = (): Promise<void> =>
        run(window.zanaris.appearance.exportTheme(initial.id ?? ''), refused => {
            if (refused !== null) setSaid({ text: refused, alert: true });
        });

    const remove = (): Promise<void> =>
        run(window.zanaris.appearance.deleteCustom(initial.id ?? ''), gone => {
            if (gone) onClose();
        });

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <h2 className="px-2.5 pb-1.5 font-pixel text-[15px] text-gold">{saved ? 'Edit theme' : 'New theme'}</h2>

            <div className="flex flex-col gap-0.5 px-2.5">
                <label htmlFor={nameId} className="text-[12px] text-dim">
                    Name
                </label>
                <input id={nameId} value={draft.name} maxLength={40} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} className={FIELD} />
            </div>

            <div className="px-2.5 pt-2.5">
                <Preview look={draft} />
            </div>

            {warnings.length > 0 && (
                <div role="status" className="px-2.5 pt-2 text-[12px] text-warn">
                    <p>Some pairs read worse than they do in 2004 stone:</p>
                    <ul className="list-disc pl-5">
                        {warnings.map(w => (
                            <li key={w}>{w}</li>
                        ))}
                    </ul>
                </div>
            )}

            <h3 className="px-2.5 pt-3 pb-1 font-pixel text-[14px] text-gold">Picture</h3>
            <div className="flex flex-col gap-1.5 px-2.5">
                <div className="flex items-center gap-2">
                    <QuietButton disabled={busy} onClick={() => void choosePicture()}>
                        {draft.background ? 'Choose another picture…' : 'Choose picture…'}
                    </QuietButton>
                    {draft.background && (
                        <QuietButton disabled={busy} onClick={() => setDraft(d => ({ ...d, background: null }))}>
                            Remove
                        </QuietButton>
                    )}
                </div>
                {draft.background ? (
                    <>
                        <div className="flex items-center gap-2">
                            <label htmlFor={fitId} className="w-[110px] shrink-0 text-[12px] text-dim">
                                Fit
                            </label>
                            <select
                                id={fitId}
                                value={draft.background.fit}
                                onChange={e => {
                                    const fit = FITS.find(f => f === e.target.value);
                                    if (fit) setDraft(d => (d.background ? { ...d, background: { ...d.background, fit } } : d));
                                }}
                                className="sunk px-1 py-[2px] font-sans text-[13px] text-cream"
                            >
                                {FITS.map(fit => (
                                    <option key={fit} value={fit}>
                                        {FIT_LABELS[fit]}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-center gap-2">
                            <label htmlFor={showId} className="w-[110px] shrink-0 text-[12px] text-dim">
                                Show through
                            </label>
                            <input
                                id={showId}
                                type="range"
                                min={0}
                                max={Math.round(SHOW_MAX * 100)}
                                step={5}
                                value={Math.round(draft.background.show * 100)}
                                style={ACCENT}
                                onChange={e => {
                                    const show = Number(e.target.value) / 100;
                                    setDraft(d => (d.background ? { ...d, background: { ...d.background, show } } : d));
                                }}
                                className="min-w-0 flex-1"
                            />
                            <span className="w-[36px] shrink-0 text-right text-[12px] text-cream">{Math.round(draft.background.show * 100)}%</span>
                        </div>
                        <p className="text-[12px] text-faint">The picture shows across the whole window, through the stone. The game and the pages cover it.</p>
                    </>
                ) : (
                    <p className="text-[12px] text-faint">A PNG, JPEG, WebP or GIF of up to 10 MB, shown across the whole window through the stone.</p>
                )}
            </div>

            {GROUPS.map(group => (
                <section key={group.title}>
                    <h3 className="px-2.5 pt-3 pb-1 font-pixel text-[14px] text-gold">{group.title}</h3>
                    <ul className="sunk mx-2.5">
                        {group.rows.map(([token, label]) => (
                            <ColorRow key={token} token={token} label={label} value={draft.colors[token]} onChange={value => setColor(token, value)} />
                        ))}
                    </ul>
                </section>
            ))}

            {said && (
                <p role={said.alert ? 'alert' : 'status'} className={`px-2.5 pt-2 text-[12px] ${said.alert ? 'text-warn' : 'text-dim'}`}>
                    {said.text}
                </p>
            )}

            {/* Exactly one gold `.btn` here: Save. */}
            <div className="flex flex-wrap items-center gap-2 px-2.5 pt-3 pb-2.5">
                <button type="button" disabled={busy} onClick={() => void save()} style={BUTTON_SIZE} className="btn">
                    Save
                </button>
                <QuietButton disabled={busy} onClick={onClose}>
                    Cancel
                </QuietButton>
                {saved && (
                    <>
                        {/* The file is the theme as saved, so a draft with changes has to be saved before it is what gets written. */}
                        <QuietButton disabled={busy || changed} onClick={() => void exportTheme()}>
                            Export…
                        </QuietButton>
                        <button type="button" disabled={busy} className="group ml-auto" onClick={() => void remove()}>
                            <span className="text-[12px] text-dim underline-offset-2 group-hover:text-alarm group-hover:underline">Delete</span>
                        </button>
                    </>
                )}
            </div>
            {saved && changed && <p className="px-2.5 pb-2.5 text-[12px] text-faint">Save to export these changes.</p>}
        </div>
    );
}
