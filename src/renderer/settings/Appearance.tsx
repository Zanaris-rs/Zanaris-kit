import type { CSSProperties, ReactNode } from 'react';
import type { AppearanceView, ServerThemeRow } from '../../main/appearance.ts';
import { themeVars, type Theme } from '../../shared/themes.ts';
import { NICK_COLOURS } from '../tools/nickColour';

/*
 * `.tab` and `.tile` are unlayered CSS, which beats a Tailwind utility of
 * equal specificity whatever the order, so the places below that contradict
 * them say so inline.
 */
/* A strip of tabs inside a card, smaller than `.tab`'s fixed 36x34. */
const MINI_TAB: CSSProperties = { width: 22, height: 14 };
/*
 * The card's padding. A card is a <button>, and `styles.css` resets every
 * button to `padding: 0` in unlayered CSS, which beats a `p-` utility — as
 * `tab.tsx`'s PADDED says of its own buttons.
 */
const CARD: CSSProperties = { padding: 6 };
/* The chosen card's border, over `.tile`'s bevel. */
const CHOSEN: CSSProperties = { borderColor: 'var(--color-gold)' };
/* Three of the era's chat colours on the log's own ground, under names from Lumbridge. */
const NAMES = ['Hans', 'Bob', 'Duke'];

/**
 * One theme as a card: the kit's own classes under that theme's variables,
 * set inline on the card, so a swatch is the real `.tile`, `.tab` and
 * `.sunk` and cannot drift from what a window shows. A click makes it the
 * app theme.
 */
function Swatch({ theme, chosen }: { theme: Theme; chosen: boolean }): ReactNode {
    const style = { ...themeVars(theme.colors), ...CARD, ...(chosen ? CHOSEN : null) } as CSSProperties;
    return (
        <button
            type="button"
            aria-pressed={chosen}
            onClick={() => void window.zanaris.appearance.setTheme(theme.id)}
            style={style}
            className="tile flex min-w-0 flex-col gap-1.5 text-left"
        >
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
        </button>
    );
}

/** One server's own theme, or "Same as app", as a select in the kit's sunk field. */
function ServerRow({ row, view }: { row: ServerThemeRow; view: AppearanceView }): ReactNode {
    const app = view.themes.find(theme => theme.id === view.theme)?.name ?? view.theme;
    return (
        <li className="flex min-w-0 items-center gap-2 border-b border-edge-dark px-2 py-1.5 last:border-b-0">
            <span className="min-w-0 flex-1 truncate">{row.name}</span>
            <select
                aria-label={`Theme for ${row.name}`}
                value={row.theme ?? ''}
                onChange={e => void window.zanaris.appearance.setServerTheme(row.id, e.target.value === '' ? null : e.target.value)}
                className="sunk shrink-0 px-1 py-[2px] font-sans text-[13px] text-cream"
            >
                <option value="">Same as app ({app})</option>
                {view.themes.map(theme => (
                    <option key={theme.id} value={theme.id}>
                        {theme.name}
                    </option>
                ))}
            </select>
        </li>
    );
}

/**
 * Settings' Appearance section: the app theme as a card per theme, then a
 * theme per server. A change applies at once to every window it touches and
 * reloads nothing: the game and the pages are never themed.
 */
export default function Appearance({ view }: { view: AppearanceView }): ReactNode {
    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <h2 className="px-2.5 pb-1.5 font-pixel text-[15px] text-gold">Theme</h2>
            <div className="grid grid-cols-3 gap-2 px-2.5">
                {view.themes.map(theme => (
                    <Swatch key={theme.id} theme={theme} chosen={theme.id === view.theme} />
                ))}
            </div>
            <p className="px-2.5 pt-1.5 text-[12px] text-dim">
                Settings and every server wear it, unless the server has its own below. The game and the pages beside it keep their own look.
            </p>

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
