import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    DEFAULT_THEME,
    NICK_COLOURS,
    SHOW_MAX,
    THEMES,
    THEME_NAME_MAX,
    THEME_TOKENS,
    contrastRatio,
    contrastWarnings,
    deriveTheme,
    isThemeId,
    newCustomId,
    pictureUrl,
    readBackground,
    readColors,
    readCustomTheme,
    readThemeDraft,
    serverOverride,
    themeById,
    themeFor,
    themeVars,
    uniqueName,
    type Appearance,
    type Theme
} from './themes.ts';

const stone = themeById('stone').colors;
const PICTURE = `${'ab'.repeat(32)}.png`;
const custom = (id: string, name: string, over: Partial<Theme> = {}): Theme => ({ id, name, colors: { ...stone, stone: '#223344' }, background: null, ...over });
const appearance = (over: Partial<Appearance> = {}): Appearance => ({ theme: 'stone', servers: {}, custom: [], ...over });

test('every theme fills every token with a #rrggbb, ids are unique, and no built-in has a picture', () => {
    for (const theme of THEMES) {
        for (const token of THEME_TOKENS) assert.match(theme.colors[token], /^#[0-9a-f]{6}$/, `${theme.id} ${token}`);
        assert.deepEqual(Object.keys(theme.colors).sort(), [...THEME_TOKENS].sort(), theme.id);
        assert.equal(theme.background, null, theme.id);
    }
    assert.equal(new Set(THEMES.map(theme => theme.id)).size, THEMES.length);
    assert.deepEqual(
        THEMES.map(theme => theme.id),
        ['stone', 'zanaris', 'wilderness', 'alkharid', 'morytania', 'lumbridge']
    );
});

test('the rule applied to the reference gives back every stone token exactly', () => {
    assert.deepEqual(deriveTheme('#504d3b', '#504d3b'), stone);
});

test('the rule refuses anything but #rrggbb rather than looping on NaN', () => {
    assert.throws(() => deriveTheme('#fff', '#504d3b'), /#rrggbb/);
    assert.throws(() => deriveTheme('#504d3b', '#50zz3b'), /#rrggbb/);
    assert.throws(() => deriveTheme('red', '#504d3b'), /#rrggbb/);
});

test("signal tokens are the client's own in every built-in", () => {
    for (const theme of THEMES) {
        for (const token of ['gold', 'link', 'good', 'warn', 'red', 'red-edge', 'alarm', 'red-lit'] as const) {
            assert.equal(theme.colors[token], stone[token], `${theme.id} ${token}`);
        }
    }
});

test('contrastRatio is the WCAG ratio', () => {
    assert.equal(contrastRatio('#ffffff', '#000000'), 21);
    assert.equal(contrastRatio('#000000', '#ffffff'), 21);
    assert.equal(contrastRatio('#443d31', '#443d31'), 1);
    assert.equal(contrastRatio(stone.cream, stone.stone).toFixed(2), '8.70');
});

/*
 * The floors are stone's own ratios, pair by pair, not a general standard:
 * dim on stone is 3.97:1 and the purple nick on the log's well 2.96:1, both
 * under WCAG AA, so a general standard would fail the look the kit ships.
 */
test('no built-in reads worse than 2004 stone: contrastWarnings finds nothing in any of them', () => {
    for (const theme of THEMES) assert.deepEqual(contrastWarnings(theme.colors), [], theme.id);
});

test('contrastWarnings names each pair under its floor, with both ratios', () => {
    // Dim the colour of the well is unreadable on the well, and too dark on every other surface.
    const warnings = contrastWarnings({ ...stone, dim: stone.well });
    assert.equal(warnings.length, 5);
    assert.ok(warnings.every(w => w.startsWith('Dim text on ')));
    assert.ok(warnings.includes('Dim text on wells reads at 1.0:1, where 2004 stone reads at 4.8:1.'));
    const nicks = contrastWarnings({ ...stone, well: '#9db8c3' });
    assert.ok(nicks.some(w => /^Chat names in #[0-9a-f]{6} on wells read at /.test(w)));
});

test('a derived theme darkens with a darker place and never lightens with a lighter one', () => {
    const luminance = (hex: string): number => 1 / contrastRatio(hex, '#ffffff');
    assert.ok(luminance(themeById('wilderness').colors.stone) < luminance(stone.stone));
    // Al Kharid's sand is far lighter than the client's stone; its frame is not.
    assert.ok(luminance(themeById('alkharid').colors.stone) < luminance(stone['stone-lit']));
});

test('readColors lower-cases, fills a missing token from stone, ignores keys it does not know, and refuses a bad value', () => {
    const read = readColors({ stone: '#AABBCC', unknown: 'x' });
    assert.equal(read?.stone, '#aabbcc');
    assert.equal(read?.cream, stone.cream);
    assert.equal(readColors({ stone: '#abc' }), null);
    assert.equal(readColors({ stone: 7 }), null);
    assert.equal(readColors(null), null);
    assert.equal(readColors('#aabbcc'), null);
});

test('readBackground keeps a well-formed picture and refuses anything else', () => {
    assert.deepEqual(readBackground({ picture: PICTURE, fit: 'tile', show: 0.3 }), { picture: PICTURE, fit: 'tile', show: 0.3 });
    assert.equal(readBackground({ picture: '../x.png', fit: 'cover', show: 0.3 }), null);
    assert.equal(readBackground({ picture: PICTURE.toUpperCase(), fit: 'cover', show: 0.3 }), null);
    assert.equal(readBackground({ picture: `${'ab'.repeat(32)}.svg`, fit: 'cover', show: 0.3 }), null);
    assert.equal(readBackground({ picture: PICTURE, fit: 'stretch', show: 0.3 }), null);
    assert.equal(readBackground({ picture: PICTURE, fit: 'cover', show: SHOW_MAX + 0.01 }), null);
    assert.equal(readBackground({ picture: PICTURE, fit: 'cover', show: -0.1 }), null);
    assert.equal(readBackground({ picture: PICTURE, fit: 'cover', show: Number.NaN }), null);
    assert.equal(readBackground(null), null);
});

test('readCustomTheme: a bad id, name or colour refuses the theme, and a bad background costs only itself', () => {
    const good = { id: 'custom-0a1b2c3d', name: ' Night ', colors: { stone: '#112233' }, background: { picture: PICTURE, fit: 'cover', show: 0.4 } };
    const read = readCustomTheme(good);
    assert.equal(read?.name, 'Night');
    assert.equal(read?.colors.stone, '#112233');
    assert.deepEqual(read?.background, { picture: PICTURE, fit: 'cover', show: 0.4 });
    assert.equal(readCustomTheme({ ...good, id: 'stone' }), null);
    assert.equal(readCustomTheme({ ...good, id: 'custom-XYZ' }), null);
    assert.equal(readCustomTheme({ ...good, name: '' }), null);
    assert.equal(readCustomTheme({ ...good, name: 'x'.repeat(THEME_NAME_MAX + 1) }), null);
    assert.equal(readCustomTheme({ ...good, name: 'a\nb' }), null);
    assert.equal(readCustomTheme({ ...good, colors: { stone: 'nope' } }), null);
    assert.equal(readCustomTheme({ ...good, background: { picture: 'x', fit: 'cover', show: 0 } })?.background, null);
});

test("themeFor: a server's override, else the app theme, else stone — customs included", () => {
    const night = custom('custom-00000001', 'Night');
    const a = appearance({ theme: 'zanaris', servers: { lostcity: 'wilderness', zanaris: 'custom-00000001' }, custom: [night] });
    assert.equal(themeFor(a, 'lostcity').id, 'wilderness');
    assert.equal(themeFor(a, 'zanaris'), night);
    assert.equal(themeFor(a, 'labs').id, 'zanaris');
    assert.equal(themeFor(a, null).id, 'zanaris');
    assert.equal(themeFor(appearance({ theme: 'custom-00000001', custom: [night] }), null), night);
    assert.equal(themeFor(appearance({ theme: 'custom-00000001' }), null).id, DEFAULT_THEME);
    assert.equal(themeFor(appearance({ theme: 'parchment' }), null).id, DEFAULT_THEME);
    assert.equal(themeFor(appearance({ theme: 'zanaris', servers: { lostcity: 'parchment' } }), 'lostcity').id, 'zanaris');
});

test('an override is read only off the servers block itself, never its prototype', () => {
    assert.equal(serverOverride(appearance(), 'toString'), null);
    assert.equal(serverOverride(appearance(), '__proto__'), null);
});

test('isThemeId knows the six, and the customs it is given', () => {
    for (const theme of THEMES) assert.ok(isThemeId(theme.id));
    assert.equal(isThemeId('parchment'), false);
    assert.equal(isThemeId(7), false);
    assert.equal(isThemeId(null), false);
    assert.equal(isThemeId('custom-00000001'), false);
    assert.equal(isThemeId('custom-00000001', [custom('custom-00000001', 'Night')]), true);
});

test('themeVars names every token as the variable styles.css reads, and a look without a picture is solid', () => {
    const vars = themeVars({ colors: stone, background: null });
    for (const token of THEME_TOKENS) assert.equal(vars[`--color-${token}`], stone[token]);
    assert.equal(vars['--picture'], 'none');
});

test('with a picture, the surfaces let it through by show, and edges, text and window stay solid', () => {
    const vars = themeVars({ colors: stone, background: { picture: PICTURE, fit: 'cover', show: 0.4 } });
    assert.equal(vars['--color-stone'], 'rgb(68 61 49 / 0.6)');
    assert.equal(vars['--color-well'], 'rgb(55 49 31 / 0.6)');
    assert.equal(vars['--color-edge-lit'], stone['edge-lit']);
    assert.equal(vars['--color-cream'], stone.cream);
    assert.equal(vars['--color-window'], stone.window);
    assert.equal(vars['--picture'], `url("${pictureUrl(PICTURE)}")`);
    assert.equal(vars['--picture-size'], 'cover');
    assert.equal(vars['--picture-repeat'], 'no-repeat');
    const tiled = themeVars({ colors: stone, background: { picture: PICTURE, fit: 'tile', show: 0.2 } });
    assert.equal(tiled['--picture-size'], 'auto');
    assert.equal(tiled['--picture-repeat'], 'repeat');
    // At 0 nothing shows through, so there is no picture at all: not fetched, not decoded, not in the seams between panes.
    const hidden = themeVars({ colors: stone, background: { picture: PICTURE, fit: 'cover', show: 0 } });
    assert.equal(hidden['--picture'], 'none');
    assert.equal(hidden['--color-stone'], stone.stone);
});

test('pictureUrl is the private scheme main serves', () => {
    assert.equal(pictureUrl(PICTURE), `zanaris-bg://picture/${PICTURE}`);
});

test('newCustomId never hands out one already taken', () => {
    const rolls = ['0000000a', '0000000a', '0000000b'];
    assert.equal(newCustomId(['custom-0000000a'], () => rolls.shift()!), 'custom-0000000b');
});

test('uniqueName numbers a name already taken, ignoring case, and keeps within the length', () => {
    assert.equal(uniqueName('Night', ['Zanaris']), 'Night');
    assert.equal(uniqueName('night', ['Night']), 'night (2)');
    assert.equal(uniqueName('Night', ['Night', 'Night (2)']), 'Night (3)');
    const long = 'x'.repeat(THEME_NAME_MAX);
    const named = uniqueName(long, [long]);
    assert.equal(named.length, THEME_NAME_MAX);
    assert.ok(named.endsWith(' (2)'));
});

test("stone is styles.css's @theme block, token for token", () => {
    const css = readFileSync(new URL('../renderer/styles.css', import.meta.url), 'utf8');
    const block = /@theme\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    const declared = Object.fromEntries([...block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6});/g)].map(m => [m[1], m[2]]));
    assert.deepEqual(declared, stone);
});

test('the nick palette is the six the chat draws with', () => {
    assert.equal(NICK_COLOURS.length, 6);
    for (const nick of NICK_COLOURS) assert.match(nick, /^#[0-9a-f]{6}$/);
});

/** Black and white are the same in every theme: the glyph shadow, the inner shadows, the red button's label. */
const NEUTRAL = new Set(['#fff', '#ffffff', '#000', '#000000']);
/** The same two as `rgb()`/`rgba()`, at any alpha. */
const NEUTRAL_RGB = /^rgba?\(\s*(?:0\s*,\s*0\s*,\s*0|255\s*,\s*255\s*,\s*255)\s*[,)]/;

test('the renderer paints no colour a theme cannot reach', () => {
    const root = fileURLToPath(new URL('../renderer/', import.meta.url));
    const found: string[] = [];
    for (const entry of readdirSync(root, { recursive: true })) {
        const file = String(entry);
        if (!/\.(tsx?|css)$/.test(file)) continue;
        // Comments go first: a comment citing a sampled value describes a colour rather than using one.
        let text = readFileSync(join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        if (file.endsWith('.css')) text = text.replace(/@theme\s*\{[\s\S]*?\n\}/, '');
        else text = text.replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
        for (const hex of text.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
            if (!NEUTRAL.has(hex.toLowerCase())) found.push(`${file}: ${hex}`);
        }
        for (const fn of text.match(/\b(?:rgba?|hsla?)\([^)]*\)/g) ?? []) {
            if (!NEUTRAL_RGB.test(fn)) found.push(`${file}: ${fn}`);
        }
    }
    assert.deepEqual(found, []);
});

test('readThemeDraft takes what the editor sends: a new theme has no id yet, and a picture that cannot be read refuses the draft', () => {
    const draft = { id: null, name: 'Night', colors: { stone: '#112233' }, background: { picture: PICTURE, fit: 'contain', show: 0.2 } };
    assert.deepEqual(readThemeDraft(draft), { id: null, name: 'Night', colors: { ...stone, stone: '#112233' }, background: { picture: PICTURE, fit: 'contain', show: 0.2 } });
    assert.equal(readThemeDraft({ ...draft, id: 'custom-0a1b2c3d' })?.id, 'custom-0a1b2c3d');
    assert.equal(readThemeDraft({ ...draft, background: null })?.background, null);
    assert.equal(readThemeDraft({ ...draft, id: 'zanaris' }), null);
    assert.equal(readThemeDraft({ ...draft, background: { picture: '../x', fit: 'cover', show: 0 } }), null);
    assert.equal(readThemeDraft({ ...draft, name: '  ' }), null);
    assert.equal(readThemeDraft('Night'), null);
});
