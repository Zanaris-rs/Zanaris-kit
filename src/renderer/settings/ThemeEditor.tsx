import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { FITS, SHOW_MAX, contrastWarnings, type Fit, type ThemeColors, type ThemeDraft, type ThemeToken } from '../../shared/themes.ts';
import { FIELD, QuietButton } from './Servers';

/*
 * `.btn` and the base `button` rule are unlayered CSS, which beats a Tailwind
 * utility of equal specificity whatever the order, so the places below that
 * contradict them say so inline.
 */
/* Save: the section's one gold button, sized as Servers' are. */
const BUTTON_SIZE: CSSProperties = { fontSize: 13, padding: '1px 8px' };
/*
 * A hex field: `FIELD`'s sunk box at a fixed width. Its own class list rather
 * than `FIELD` plus a width, since `FIELD` carries `w-full` and two width
 * utilities on one element are settled by stylesheet order, not by which was
 * written last — which is how the field once took the whole row and hid its
 * label.
 */
const HEX_FIELD = 'sunk w-[84px] shrink-0 px-[7px] py-[3px] font-mono text-[13px] text-cream';
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
            <input type="color" aria-label={`${label}: pick`} value={value} style={ACCENT} onChange={e => onChange(e.target.value)} className="h-[22px] w-[34px] shrink-0" />
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
                className={HEX_FIELD}
            />
        </li>
    );
}

/**
 * The theme editor, in place of the Appearance section while it is open.
 *
 * The draft is Settings' own (`Settings.tsx`), so a trip to Servers and back
 * keeps it, and every window wears it while the editor is open: the changes
 * are seen on the app itself, not on a picture of it. Nothing is kept until
 * Save, which also makes it the app theme; Cancel puts every window back.
 * Every colour is the player's to set; the warnings say when a pair reads
 * worse than 2004 stone's, and saving is still their call. A picture is chosen
 * in a dialog of main's, which answers its stored name.
 *
 * The actions sit in a bar pinned under the fields, which scroll on their own,
 * so Save is never a scroll away from the colour just changed.
 */
export default function ThemeEditor({
    initial,
    draft,
    onChange: setDraft,
    onClose
}: {
    initial: ThemeDraft;
    draft: ThemeDraft;
    onChange: (update: (draft: ThemeDraft) => ThemeDraft) => void;
    onClose: () => void;
}): ReactNode {
    const [busy, setBusy] = useState(false);
    const [said, setSaid] = useState<{ text: string; alert: boolean } | null>(null);
    const nameId = useId();
    const fitId = useId();
    const showId = useId();
    const saved = initial.id !== null;
    const changed = JSON.stringify(draft) !== JSON.stringify(initial);
    const warnings = contrastWarnings(draft.colors);

    const setColor = (token: ThemeToken, value: string): void => setDraft(d => ({ ...d, colors: { ...d.colors, [token]: value } as ThemeColors }));

    /** One request to main at a time. One that fails outright — rather than answering why not — still says so. */
    const run = async <T,>(request: Promise<T>, then: (answer: T) => void): Promise<void> => {
        setBusy(true);
        setSaid(null);
        try {
            then(await request);
        } catch {
            setSaid({ text: "That didn't work, and the kit couldn't say why. Its log may.", alert: true });
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
        run(window.zanaris.appearance.exportTheme(draft), refused => {
            if (refused !== null) setSaid({ text: refused, alert: true });
        });

    const remove = (): Promise<void> =>
        run(window.zanaris.appearance.deleteCustom(initial.id ?? ''), gone => {
            if (gone) onClose();
        });

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto pb-2.5">
                <h2 className="px-2.5 pb-1.5 font-pixel text-[15px] text-gold">{saved ? 'Edit theme' : 'New theme'}</h2>

                <div className="flex flex-col gap-0.5 px-2.5">
                    <label htmlFor={nameId} className="text-[12px] text-dim">
                        Name
                    </label>
                    <input
                        id={nameId}
                        value={draft.name}
                        maxLength={40}
                        onChange={e => {
                            const name = e.target.value;
                            setDraft(d => ({ ...d, name }));
                        }}
                        className={FIELD}
                    />
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
            </div>

            {/* Exactly one gold `.btn` here: Save. */}
            <div className="flex shrink-0 flex-col gap-1.5 border-t border-edge-dark px-2.5 pt-2 pb-2.5">
                {said && (
                    <p role={said.alert ? 'alert' : 'status'} className={`text-[12px] ${said.alert ? 'text-warn' : 'text-dim'}`}>
                        {said.text}
                    </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" disabled={busy} onClick={() => void save()} style={BUTTON_SIZE} className="btn">
                        Save
                    </button>
                    <QuietButton disabled={busy} onClick={onClose}>
                        Cancel
                    </QuietButton>
                    <QuietButton disabled={busy} onClick={() => void exportTheme()}>
                        Export…
                    </QuietButton>
                    {changed && <span className="text-[12px] text-faint">Unsaved changes</span>}
                    {saved && (
                        <button type="button" disabled={busy} className="group ml-auto" onClick={() => void remove()}>
                            <span className="text-[12px] text-dim underline-offset-2 group-hover:text-alarm group-hover:underline">Delete</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
