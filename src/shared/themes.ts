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
 * Beside the six, a player can make their own: every colour theirs to set,
 * and a picture that shows through the stone across the whole frame. Those
 * live in state.json and travel between people as theme files.
 *
 * Pure: main resolves which theme a window wears, the renderer only applies
 * what it is sent, and `node --test` reaches all of it.
 * Specs: docs/superpowers/specs/2026-09-25-themes-design.md, and
 * 2026-09-25-custom-themes-and-pictures-design.md.
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

/** How a picture fills the window: cropped to fill it, fitted inside it, or repeated at its own size. */
export const FITS = ['cover', 'contain', 'tile'] as const;
export type Fit = (typeof FITS)[number];

/** A theme's picture, shown across the whole frame through the stone. */
export interface Background {
    /** The stored file, named by its content (`PICTURE_NAME`). A name, never a path. */
    picture: string;
    fit: Fit;
    /** How much of the picture shows through the stone, from 0 to `SHOW_MAX`. */
    show: number;
}

export interface Theme {
    /**
     * A built-in's is stored in state.json and never renamed once shipped. A
     * custom theme's is `custom-` and 8 hex digits, which no built-in's is.
     */
    id: string;
    /** Sentence case, as the renderer draws everything; the menu title-cases a built-in's. A custom theme's is the player's, as typed. */
    name: string;
    colors: ThemeColors;
    /** Null for every built-in. */
    background: Background | null;
}

/** What a window wears: a theme without its name and id. What main sends the shell. */
export type ThemeLook = Pick<Theme, 'colors' | 'background'>;

/** What state.json keeps: the app's theme, the servers given their own, and the player's own themes. */
export interface Appearance {
    theme: string;
    servers: Readonly<Record<string, string>>;
    custom: readonly Theme[];
}

/** The most of the picture a theme can let through the stone. Past this, the words on it lose to the picture. */
export const SHOW_MAX = 0.6;
/** Enough for anyone's collection, and a bound on what state.json carries. */
export const CUSTOM_MAX = 32;
export const THEME_NAME_MAX = 40;
/** A stored picture's name: its sha-256 and the type its bytes said it was. */
export const PICTURE_NAME = /^[0-9a-f]{64}\.(?:png|jpg|webp|gif)$/;
const CUSTOM_ID = /^custom-[0-9a-f]{8}$/;
const COLOR = /^#[0-9a-f]{6}$/i;

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
    if (!COLOR.test(hex)) throw new Error(`${JSON.stringify(hex)} is not a #rrggbb colour`);
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

const STONE_THEME: Theme = { id: DEFAULT_THEME, name: '2004 stone', colors: STONE, background: null };

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
    { id: 'zanaris', name: 'Zanaris', colors: deriveTheme('#6d5b2b', '#6cac10'), background: null },
    /*
     * m46–52 × m55–61, the band the wilderness covers. Ground `verydarkrock`
     * #2e2e2e (54,977 tiles, 27%, lift 6.3), dark enough that the rule darkens
     * the frame to 0.72 of stone; trim `lava`, whose texture averages #f8902e
     * (6,117 tiles, lift 2.6).
     */
    { id: 'wilderness', name: 'Wilderness', colors: deriveTheme('#2e2e2e', '#f8902e'), background: null },
    /*
     * m51–52 × m48–50, around the "Al Kharid" label and short of Lumbridge's
     * square. Ground `desert2` #d0c074 (15,223 tiles, 62%, lift 16.7); trim
     * `duel_arena` #b79767 (565 tiles, lift 15.9), the arena's own floor.
     */
    { id: 'alkharid', name: 'Al Kharid', colors: deriveTheme('#d0c074', '#b79767'), background: null },
    /*
     * m53–55 × m52–54, around the "Canifis" and "Mort Myre Swamp" labels.
     * Ground `swamp2` #125841 (10,454 tiles, 37%, lift 35.8); trim
     * `gungywater`, whose texture averages #348266 (7,280 tiles, lift 26.2).
     */
    { id: 'morytania', name: 'Morytania', colors: deriveTheme('#125841', '#348266'), background: null },
    /*
     * m50_50, the square the "Lumbridge" label is in: the castle and the
     * town. Ground `road` #505050 (678 tiles, 17%, lift 10.4); trim
     * `woodenfloor`, whose planks average #58351a (182 tiles, lift 4.9) — the
     * castle's own floors.
     */
    { id: 'lumbridge', name: 'Lumbridge', colors: deriveTheme('#505050', '#58351a'), background: null }
];

// ── resolution ────────────────────────────────────────────────────────────

/** A built-in, or one of the customs given. */
export function isThemeId(x: unknown, custom: readonly Theme[] = []): x is string {
    return typeof x === 'string' && (THEMES.some(theme => theme.id === x) || custom.some(theme => theme.id === x));
}

/** The theme with that id, or stone for one the kit does not know: an unknown id costs only that one choice. */
export function themeById(id: string, custom: readonly Theme[] = []): Theme {
    return THEMES.find(theme => theme.id === id) ?? custom.find(theme => theme.id === id) ?? STONE_THEME;
}

/** The theme a server was given for itself, or null when it follows the app. Read off the block's own keys only, so a server id can never find a prototype's. */
export function serverOverride(appearance: Appearance, serverId: string): string | null {
    if (!Object.hasOwn(appearance.servers, serverId)) return null;
    const id = appearance.servers[serverId];
    return isThemeId(id, appearance.custom) ? id : null;
}

/** What a window of this server wears: its override, else the app theme. Null for the app's own — Settings. */
export function themeFor(appearance: Appearance, serverId: string | null): Theme {
    return themeById((serverId === null ? null : serverOverride(appearance, serverId)) ?? appearance.theme, appearance.custom);
}

// ── reading what a player made ────────────────────────────────────────────

/**
 * A theme's colours from a file or from state.json. Each must be `#rrggbb`,
 * and one that is not refuses the whole set: a colour that could not be read
 * cannot be guessed. A token that is missing takes stone's, so a theme saved
 * before a token existed still reads; a key the kit does not know is ignored.
 */
export function readColors(x: unknown): ThemeColors | null {
    if (typeof x !== 'object' || x === null) return null;
    const given = x as Record<string, unknown>;
    const colors: ThemeColors = { ...STONE };
    for (const token of THEME_TOKENS) {
        if (!Object.hasOwn(given, token)) continue;
        const value = given[token];
        if (typeof value !== 'string' || !COLOR.test(value)) return null;
        colors[token] = value.toLowerCase();
    }
    return colors;
}

/** A theme's picture, or null for none or for one that cannot be read — which costs the picture, never the theme. */
export function readBackground(x: unknown): Background | null {
    if (typeof x !== 'object' || x === null) return null;
    const b = x as Record<string, unknown>;
    if (typeof b.picture !== 'string' || !PICTURE_NAME.test(b.picture)) return null;
    const fit = FITS.find(f => f === b.fit);
    if (fit === undefined) return null;
    if (typeof b.show !== 'number' || !Number.isFinite(b.show) || b.show < 0 || b.show > SHOW_MAX) return null;
    return { picture: b.picture, fit, show: b.show };
}

/** A theme's name: trimmed, 1 to `THEME_NAME_MAX` characters, and on one line. Null otherwise. */
export function readThemeName(x: unknown): string | null {
    if (typeof x !== 'string') return null;
    const name = x.trim();
    return name.length >= 1 && name.length <= THEME_NAME_MAX && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
}

/** One stored custom theme, or null for one that cannot be read. */
export function readCustomTheme(x: unknown): Theme | null {
    if (typeof x !== 'object' || x === null) return null;
    const t = x as Record<string, unknown>;
    if (typeof t.id !== 'string' || !CUSTOM_ID.test(t.id)) return null;
    const name = readThemeName(t.name);
    const colors = readColors(t.colors);
    if (name === null || colors === null) return null;
    return { id: t.id, name, colors, background: readBackground(t.background) };
}

/** What the editor sends on Save: a theme, with no id yet when it is a new one. */
export interface ThemeDraft {
    id: string | null;
    name: string;
    colors: ThemeColors;
    background: Background | null;
}

/**
 * A draft as main receives it from the editor, read as strictly as a stored
 * theme — except that a picture which cannot be read refuses the draft
 * rather than being dropped from it: saving must never quietly lose the
 * picture somebody just chose.
 */
export function readThemeDraft(x: unknown): ThemeDraft | null {
    if (typeof x !== 'object' || x === null) return null;
    const t = x as Record<string, unknown>;
    if (t.id !== null && (typeof t.id !== 'string' || !CUSTOM_ID.test(t.id))) return null;
    const name = readThemeName(t.name);
    const colors = readColors(t.colors);
    if (name === null || colors === null) return null;
    const background = t.background === null || t.background === undefined ? null : readBackground(t.background);
    if (t.background !== null && t.background !== undefined && background === null) return null;
    return { id: t.id, name, colors, background };
}

/** A custom id no theme has. `random` answers 8 hex digits; main's comes from `crypto`. */
export function newCustomId(taken: readonly string[], random: () => string): string {
    for (;;) {
        const id = `custom-${random()}`;
        if (!taken.includes(id)) return id;
    }
}

/** `name`, or `name (2)`, `(3)` and on when another theme already has it, ignoring case. Kept within the length by shortening the name, never the number. */
export function uniqueName(name: string, taken: readonly string[]): string {
    const used = new Set(taken.map(t => t.toLowerCase()));
    if (!used.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) {
        const suffix = ` (${n})`;
        const candidate = `${name.slice(0, THEME_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
        if (!used.has(candidate.toLowerCase())) return candidate;
    }
}

// ── contrast ──────────────────────────────────────────────────────────────

/** The era's chat set, one fixed palette in every theme: `renderer/tools/nickColour.ts` deals names into it. */
export const NICK_COLOURS: readonly string[] = ['#9db8c3', '#faa8aa', '#c8a86a', '#90c040', '#c503fd', '#6fc9d8'];

function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map(i => linear(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio between two `#rrggbb` colours: what "reads worse" is measured in. */
export function contrastRatio(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
}

/** What the text tokens are, in words, and where they sit. */
const TEXT_ON: readonly [ThemeToken, string][] = [
    ['cream', 'Cream text'],
    ['dim', 'Dim text'],
    ['faint', 'Faint text'],
    ['gold', 'Gold headings'],
    ['link', 'Links'],
    ['good', 'Good news'],
    ['warn', 'Warnings'],
    ['alarm', 'Alarms']
];
const GROUNDS: readonly [ThemeToken, string][] = [
    ['ink', 'ink'],
    ['stone', 'panels'],
    ['stone-lit', 'lit stone'],
    ['tab', 'tabs'],
    ['well', 'wells']
];
/** A pair may read down to this share of 2004 stone's own ratio. */
const FLOOR = 0.9;

/**
 * Every pair that reads worse than 2004 stone's own, as a sentence: each text
 * token on each surface it sits on, and each chat name colour on the wells
 * the log sits in, held to 90% of stone's ratio for that pair. Stone's own
 * ratios are the floors, not a general standard: some of them — dim on
 * panels at 3.97:1, the purple chat name at 2.96:1 — are under WCAG AA, so a
 * general standard would fail the look the kit has always shipped.
 *
 * Measured on solid colours. A picture showing through the stone can lower
 * contrast where nothing here can see it.
 */
export function contrastWarnings(colors: ThemeColors): string[] {
    const warnings: string[] = [];
    const say = (what: string, verb: string, ratio: number, stoneRatio: number): string =>
        `${what} ${verb} at ${ratio.toFixed(1)}:1, where 2004 stone reads at ${stoneRatio.toFixed(1)}:1.`;
    for (const [text, words] of TEXT_ON) {
        for (const [ground, where] of GROUNDS) {
            const ratio = contrastRatio(colors[text], colors[ground]);
            const stoneRatio = contrastRatio(STONE[text], STONE[ground]);
            if (ratio < FLOOR * stoneRatio) warnings.push(say(`${words} on ${where}`, 'reads', ratio, stoneRatio));
        }
    }
    for (const nick of NICK_COLOURS) {
        const ratio = contrastRatio(nick, colors.well);
        const stoneRatio = contrastRatio(nick, STONE.well);
        if (ratio < FLOOR * stoneRatio) warnings.push(say(`Chat names in ${nick} on wells`, 'read', ratio, stoneRatio));
    }
    return warnings;
}

// ── putting a look on a page ──────────────────────────────────────────────

/** The private scheme main serves stored pictures on, to the kit's own pages only. */
export const PICTURE_SCHEME = 'zanaris-bg';

/** Where the page asks for a stored picture. */
export function pictureUrl(picture: string): string {
    return `${PICTURE_SCHEME}://picture/${picture}`;
}

/**
 * The surfaces a picture shows through. Edges stay solid, so every panel
 * keeps its bevel; text and signals stay solid, so words stay words; and
 * `window` is what main paints natively, where there is no picture to see.
 */
const SURFACES: readonly ThemeToken[] = ['ink', 'stone', 'stone-lit', 'tab', 'well', 'tab-down'];

function seeThrough(hex: string, alpha: number): string {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return `rgb(${r} ${g} ${b} / ${Math.round(alpha * 1000) / 1000})`;
}

/**
 * A look as the variables `styles.css` and Tailwind's utilities read: each
 * token as `--color-<token>`, and the picture as `--picture`,
 * `--picture-size` and `--picture-repeat`, which `styles.css`'s `.picture`
 * paints on the element that spans each page.
 *
 * With a picture showing, each surface lets `show` of it through. A surface
 * inside another stacks with it, so a list inside a panel shows less of the
 * picture than the panel's frame does: the wells, where the words are, stay
 * the most solid. Without one, every value is exactly the theme's colour.
 */
export function themeVars(look: ThemeLook): Record<string, string> {
    const show = look.background?.show ?? 0;
    const vars: Record<string, string> = {};
    for (const token of THEME_TOKENS) {
        vars[`--color-${token}`] = show > 0 && SURFACES.includes(token) ? seeThrough(look.colors[token], 1 - show) : look.colors[token];
    }
    const background = look.background;
    vars['--picture'] = background ? `url("${pictureUrl(background.picture)}")` : 'none';
    vars['--picture-size'] = background && background.fit !== 'tile' ? background.fit : 'auto';
    vars['--picture-repeat'] = background?.fit === 'tile' ? 'repeat' : 'no-repeat';
    return vars;
}
