import { useState, type CSSProperties, type ReactNode } from 'react';
import type { AppearanceView, ServerThemeRow, ThemeCard } from '../../main/appearance.ts';
import { NICK_COLOURS, themeVars, type ThemeDraft } from '../../shared/themes.ts';
import { QuietButton } from './Servers';
import ThemeEditor from './ThemeEditor';

/*
 * `.tab` and `.tile` are unlayered CSS, which beats a Tailwind utility of
 * equal specificity whatever the order, so the places below that contradict
 * them say so inline.
 */
/* A strip of tabs inside a card, smaller than `.tab`'s fixed 36x34. */
const MINI_TAB: CSSProperties = { width: 22, height: 14 };
/* The card's padding, on the `.tile` inside it, set with the border it sits inside so the two read as one decision. */
const CARD: CSSProperties = { padding: 6 };
/* The chosen card's border, over `.tile`'s bevel. */
const CHOSEN: CSSProperties = { borderColor: 'var(--color-gold)' };
/* Three of the era's chat colours on the log's own ground, under names from Lumbridge. */
const NAMES = ['Hans', 'Bob', 'Duke'];

/**
 * One theme as a card: the kit's own classes under that theme's variables,
 * set inline on the card, so a card is the real `.tile`, `.tab` and `.sunk`
 * and cannot drift from what a window shows. A theme with a picture shows it
 * behind the stone, see-through as the theme sets it. A click makes it the
 * app theme; the text button under it — a sibling, since a button cannot
 * hold a button — opens the editor.
 */
function Card({ theme, chosen, onEdit }: { theme: ThemeCard; chosen: boolean; onEdit: () => void }): ReactNode {
    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            <button
                type="button"
                aria-pressed={chosen}
                onClick={() => void window.zanaris.appearance.setTheme(theme.id)}
                style={themeVars(theme) as CSSProperties}
                className="flex min-w-0 flex-col text-left"
            >
                {/*
                 * The picture on a span of its own, over the solid window
                 * colour, as a window's picture is: the base `button` rule
                 * clears a button's own background, and the theme's ink is
                 * see-through when it has a picture.
                 */}
                <span className="picture flex min-w-0 flex-col bg-window">
                    <span style={{ ...CARD, ...(chosen ? CHOSEN : null) }} className="tile flex min-w-0 flex-col gap-1.5">
                        <span className="flex gap-[3px]">
                            <span className="tab tab-on" style={MINI_TAB} />
                            <span className="tab" style={MINI_TAB} />
                            <span className="tab" style={MINI_TAB} />
                        </span>
                        <span className="truncate font-pixel text-[14px] leading-none text-gold">{theme.name}</span>
                        <span className="text-[11px] leading-tight text-cream">
                            World 5 <span className="text-dim">· 43 ms</span>
                        </span>
                        <span className="sunk flex gap-1.5 px-1 text-[11px]">
                            {NAMES.map((name, i) => (
                                <span key={name} style={{ color: NICK_COLOURS[i] }}>
                                    {name}
                                </span>
                            ))}
                        </span>
                    </span>
                </span>
            </button>
            <button type="button" onClick={onEdit} className="group self-start">
                <span className="text-[12px] text-dim underline-offset-2 group-hover:text-cream group-hover:underline">{theme.custom ? 'Edit' : 'Customise'}</span>
            </button>
        </div>
    );
}

/** One server's own theme, or "Same as app", as a select in the kit's sunk field. */
function ServerRow({ row, view }: { row: ServerThemeRow; view: AppearanceView }): ReactNode {
    const app = view.themes.find(theme => theme.id === view.theme)?.name ?? view.theme;
    const builtIns = view.themes.filter(theme => !theme.custom);
    const custom = view.themes.filter(theme => theme.custom);
    return (
        <li className="flex min-w-0 items-center gap-2 border-b border-edge-dark px-2 py-1.5 last:border-b-0">
            <span className="min-w-0 flex-1 truncate">{row.name}</span>
            <select
                aria-label={`Theme for ${row.name}`}
                value={row.theme ?? ''}
                onChange={e => void window.zanaris.appearance.setServerTheme(row.id, e.target.value === '' ? null : e.target.value)}
                className="sunk max-w-[60%] shrink-0 px-1 py-[2px] font-sans text-[13px] text-cream"
            >
                <option value="">Same as app ({app})</option>
                {builtIns.map(theme => (
                    <option key={theme.id} value={theme.id}>
                        {theme.name}
                    </option>
                ))}
                {custom.length > 0 && (
                    <optgroup label="Your themes">
                        {custom.map(theme => (
                            <option key={theme.id} value={theme.id}>
                                {theme.name}
                            </option>
                        ))}
                    </optgroup>
                )}
            </select>
        </li>
    );
}

/** What the editor opens on: a copy of a built-in, or one of the player's own as it is. */
function draftOf(theme: ThemeCard): ThemeDraft {
    return theme.custom
        ? { id: theme.id, name: theme.name, colors: { ...theme.colors }, background: theme.background ? { ...theme.background } : null }
        : { id: null, name: `${theme.name} (copy)`, colors: { ...theme.colors }, background: null };
}

/**
 * Settings' Appearance section: the app theme as a card per theme, the
 * player's own after the built-ins, then a theme per server. The editor takes
 * the section's place while it is open. A change applies at once to every
 * window it touches and reloads nothing: the game and the pages are never
 * themed.
 */
export default function Appearance({ view }: { view: AppearanceView }): ReactNode {
    const [editing, setEditing] = useState<ThemeDraft | null>(null);
    const [said, setSaid] = useState<{ text: string; alert: boolean } | null>(null);
    const [busy, setBusy] = useState(false);

    if (editing) return <ThemeEditor initial={editing} presets={view.presets} onClose={() => setEditing(null)} />;

    const importTheme = async (): Promise<void> => {
        setBusy(true);
        setSaid(null);
        try {
            const answer = await window.zanaris.appearance.importTheme();
            if (answer === null) return;
            setSaid('error' in answer ? { text: answer.error, alert: true } : { text: `Added ${answer.name}. Click its card to wear it.`, alert: false });
        } catch {
            setSaid({ text: "That didn't work, and the kit couldn't say why. Its log may.", alert: true });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <h2 className="px-2.5 pb-1.5 font-pixel text-[15px] text-gold">Theme</h2>
            <div className="grid grid-cols-3 gap-2 px-2.5">
                {view.themes.map(theme => (
                    <Card key={theme.id} theme={theme} chosen={theme.id === view.theme} onEdit={() => setEditing(draftOf(theme))} />
                ))}
            </div>
            <p className="px-2.5 pt-1.5 text-[12px] text-dim">
                Settings and every server wear it, unless the server has its own below. The game and the pages beside it keep their own look.
            </p>
            <div className="flex items-center gap-2 px-2.5 pt-2">
                <QuietButton disabled={busy} onClick={() => void importTheme()}>
                    Import theme…
                </QuietButton>
            </div>
            {said && (
                <p role={said.alert ? 'alert' : 'status'} className={`px-2.5 pt-1 text-[12px] ${said.alert ? 'text-warn' : 'text-dim'}`}>
                    {said.text}
                </p>
            )}

            <h2 className="px-2.5 pt-3 pb-1.5 font-pixel text-[15px] text-gold">Servers</h2>
            <ul className="sunk mx-2.5">
                {view.servers.map(row => (
                    <ServerRow key={row.id} row={row} view={view} />
                ))}
            </ul>
            <p className="px-2.5 pt-1.5 pb-2.5 text-[12px] text-dim">
                A server&apos;s theme is worn by every window of it. View &gt; Server Theme sets it from the window in front.
            </p>
        </div>
    );
}
