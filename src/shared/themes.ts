/**
 * Themes for the kit's frame: the tab bar, pane headers, the launcher, the
 * tools and Settings. Never the game or a reference page — those are native
 * views the kit does not style, and nothing is injected into a game page.
 *
 * A theme is one value per token, and the renderer puts each on the page as
 * the `--color-*` variable `styles.css` and Tailwind's utilities already read.
 * 2004 stone is the look the kit has always had, sampled off the client. The
 * rest are places in the 2004 world, each derived from two colours sampled
 * off the floors laid there by one rule, `deriveTheme`, so every value traces
 * back to the map rather than to taste. The samples are from the 274 content
 * pin (32019eb), read by `scripts/sample-floors.mjs`.
 *
 * Pure: main resolves which theme a window wears, the renderer only applies
 * what it is sent, and `node --test` reaches all of it.
 * Spec: docs/superpowers/specs/2026-09-25-themes-design.md.
 */

/**
 * The names a theme fills, in `styles.css`'s order: the seventeen that were
 * always there, then four that were literals until a theme needed to reach
 * them — the red button's lit edge, the pressed tab, the sprite outline, and
 * `window`, which main paints behind the shell and the pages before they draw.
 */
export const THEME_TOKENS = [
    'ink',
    'stone',
    'stone-lit',
    'tab',
    'well',
    'edge-lit',
    'edge-dark',
    'cream',
    'dim',
    'faint',
    'gold',
    'link',
    'good',
    'warn',
    'red',
    'red-edge',
    'alarm',
    'red-lit',
    'tab-down',
    'outline',
    'window'
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];
export type ThemeColors = Record<ThemeToken, string>;

export interface Theme {
    /** Stored in state.json, and in theme files later: never renamed once shipped. */
    id: string;
    /** Sentence case, as the renderer draws everything; the menu title-cases it. */
    name: string;
    colors: ThemeColors;
}

/** What state.json keeps: the app's theme, and the servers given their own. */
export interface Appearance {
    theme: string;
    servers: Readonly<Record<string, string>>;
}

export const DEFAULT_THEME = 'stone';

/** The client's own, sampled off it (README, "How it looks"). `styles.css`'s `@theme` block holds the same values, and `themes.test.ts` keeps the two one list. */
const STONE: ThemeColors = {
    ink: '#1a1710',
    stone: '#443d31',
    'stone-lit': '#655c4b',
    tab: '#342e24',
    well: '#37311f',
    'edge-lit': '#7d7463',
    'edge-dark': '#211d16',
    cream: '#ece7dc',
    dim: '#a89c86',
    faint: '#7d735f',
    gold: '#ffe139',
    link: '#90c040',
    good: '#04a800',
    warn: '#ff981f',
    red: '#a70700',
    'red-edge': '#570700',
    alarm: '#ff5a48',
    'red-lit': '#c8503f',
    'tab-down': '#332d24',
    outline: '#3a3428',
    window: '#17120d'
};

// ── the rule ──────────────────────────────────────────────────────────────

/** OKLCH: lightness, chroma, and hue in radians. */
interface Lch {
    l: number;
    c: number;
    h: number;
}

const linear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gamma = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/**
 * Refuses anything but `#rrggbb` up front. A short or misspelt colour would
 * parse to NaN, and `fromLch`'s gamut loop can never finish on NaN — a hang in
 * main, once a colour can come from someone's own theme rather than this file.
 */
function toLch(hex: string): Lch {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`${JSON.stringify(hex)} is not a #rrggbb colour`);
    const [r, g, b] = [1, 3, 5].map(i => linear(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number];
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return { l: lightness, c: Math.hypot(a, bb), h: Math.atan2(bb, a) };
}

/** Back to hex. A colour outside sRGB loses chroma, 5% at a time, until it fits: hue and lightness are what a theme is, and chroma is what gives. */
function fromLch({ l, c, h }: Lch): string {
    for (let chroma = c; ; chroma *= 0.95) {
        const a = chroma * Math.cos(h);
        const b = chroma * Math.sin(h);
        const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
        const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
        const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
        const rgb = [
            4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp,
            -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp,
            -0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp
        ];
        if (chroma < 1e-4 || rgb.every(v => v >= -1e-4 && v <= 1 + 1e-4)) {
            return `#${rgb.map(v => Math.round(gamma(Math.min(1, Math.max(0, v))) * 255).toString(16).padStart(2, '0')).join('')}`;
        }
    }
}

/** The client's panel mid, which 2004 stone was sampled from: what a place's colour is measured against. */
const REFERENCE = toLch('#504d3b');
/** How far past stone's own saturation a vivid place may push the frame. */
const CHROMA_CAP = 4;

const GROUND: readonly ThemeToken[] = ['ink', 'stone', 'tab', 'well', 'edge-dark', 'tab-down', 'outline', 'window'];
const TRIM: readonly ThemeToken[] = ['stone-lit', 'edge-lit'];
const TEXT: readonly ThemeToken[] = ['cream', 'dim', 'faint'];

/**
 * A theme from a place's two colours: `ground`, the floor that sets the place
 * apart, and `trim`, its second.
 *
 * Every token starts from stone's own value for it. Ground tokens turn their
 * hue by the angle from the reference's hue to the ground's, trim tokens by
 * the angle to the trim's, and both scale their chroma by how much more
 * saturated the place is than the reference, capped. Turning rather than
 * replacing the hue keeps the small differences between stone's own tokens,
 * so the rule applied to the reference gives stone back exactly.
 *
 * Lightness stays stone's, token by token. That keeps the grain's
 * compensation true — each base sits below its sampled mid by what the
 * overlay blend adds back — and keeps contrast close to stone's by
 * construction; `themes.test.ts` is what holds it. A place darker than the
 * reference darkens the frame by that much, and a lighter one never lightens
 * it, since the black glyph shadow needs a dark ground.
 *
 * Text turns with the ground but is never more tinted than stone's own, so a
 * grey place gets grey text. Signal tokens — gold, the links, the red button —
 * are the client's voice in every place and stay stone's.
 */
export function deriveTheme(ground: string, trim: string): ThemeColors {
    const g = toLch(ground);
    const t = toLch(trim);
    const dark = Math.min(1, g.l / REFERENCE.l);
    const saturation = (from: Lch): number => Math.min(CHROMA_CAP, from.c / REFERENCE.c);
    const turn = (token: ThemeToken, from: Lch, lightness: number, chroma: number): string => {
        const own = toLch(STONE[token]);
        return fromLch({ l: own.l * lightness, c: own.c * chroma, h: own.h + from.h - REFERENCE.h });
    };
    const colors: ThemeColors = { ...STONE };
    for (const token of GROUND) colors[token] = turn(token, g, dark, saturation(g));
    for (const token of TRIM) colors[token] = turn(token, t, dark, saturation(t));
    for (const token of TEXT) colors[token] = turn(token, g, 1, Math.min(1, saturation(g)));
    return colors;
}

// ── the themes ────────────────────────────────────────────────────────────

const STONE_THEME: Theme = { id: DEFAULT_THEME, name: '2004 stone', colors: STONE };

/**
 * Each place's squares, and its ground and trim, with the counts
 * `scripts/sample-floors.mjs` prints for them. Ground and trim come from the
 * top of the place's lift ranking — how many times more of the place a floor
 * covers than of the whole map — since by plain count nearly every place on
 * the mainland is mostly grass.
 */
export const THEMES: readonly Theme[] = [
    STONE_THEME,
    /*
     * m49_149 and m50_149, where all 49 of its fairies stand and where the
     * Lost City quest's door lands you. In 274 that is brown floors and bright
     * grass in black void: the fairy rings, and the blue Zanaris people
     * remember, came after this revision. Ground `l_brownfloor1` #6d5b2b
     * (1,046 tiles, 23%, lift 15.5, and its bumped twin 397 more at lift 99);
     * trim `lightgrass` #6cac10 (318 tiles, lift 26.1).
     */
    { id: 'zanaris', name: 'Zanaris', colors: deriveTheme('#6d5b2b', '#6cac10') },
    /*
     * m46–52 × m55–61, the band the wilderness covers. Ground `verydarkrock`
     * #2e2e2e (54,977 tiles, 27%, lift 6.3), dark enough that the rule darkens
     * the frame to 0.72 of stone; trim `lava`, whose texture averages #f8902e
     * (6,117 tiles, lift 2.6).
     */
    { id: 'wilderness', name: 'Wilderness', colors: deriveTheme('#2e2e2e', '#f8902e') },
    /*
     * m51–52 × m48–50, around the "Al Kharid" label and short of Lumbridge's
     * square. Ground `desert2` #d0c074 (15,223 tiles, 62%, lift 16.7); trim
     * `duel_arena` #b79767 (565 tiles, lift 15.9), the arena's own floor.
     */
    { id: 'alkharid', name: 'Al Kharid', colors: deriveTheme('#d0c074', '#b79767') },
    /*
     * m53–55 × m52–54, around the "Canifis" and "Mort Myre Swamp" labels.
     * Ground `swamp2` #125841 (10,454 tiles, 37%, lift 35.8); trim
     * `gungywater`, whose texture averages #348266 (7,280 tiles, lift 26.2).
     */
    { id: 'morytania', name: 'Morytania', colors: deriveTheme('#125841', '#348266') },
    /*
     * m50_50, the square the "Lumbridge" label is in: the castle and the
     * town. Ground `road` #505050 (678 tiles, 17%, lift 10.4); trim
     * `woodenfloor`, whose planks average #58351a (182 tiles, lift 4.9) — the
     * castle's own floors.
     */
    { id: 'lumbridge', name: 'Lumbridge', colors: deriveTheme('#505050', '#58351a') }
];

// ── resolution ────────────────────────────────────────────────────────────

export function isThemeId(x: unknown): x is string {
    return typeof x === 'string' && THEMES.some(theme => theme.id === x);
}

/** The theme with that id, or stone for one the kit does not know: an unknown id costs only that one choice. */
export function themeById(id: string): Theme {
    return THEMES.find(theme => theme.id === id) ?? STONE_THEME;
}

/** The theme a server was given for itself, or null when it follows the app. Read off the block's own keys only, so a server id can never find a prototype's. */
export function serverOverride(appearance: Appearance, serverId: string): string | null {
    if (!Object.hasOwn(appearance.servers, serverId)) return null;
    const id = appearance.servers[serverId];
    return isThemeId(id) ? id : null;
}

/** What a window of this server wears: its override, else the app theme. Null for the app's own — Settings. */
export function themeFor(appearance: Appearance, serverId: string | null): Theme {
    return themeById((serverId === null ? null : serverOverride(appearance, serverId)) ?? appearance.theme);
}

/** Each token as the variable `styles.css` and Tailwind's utilities read. */
export function themeVars(colors: ThemeColors): Record<string, string> {
    return Object.fromEntries(THEME_TOKENS.map(token => [`--color-${token}`, colors[token]]));
}
