import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_THEME, THEMES, THEME_TOKENS, deriveTheme, isThemeId, serverOverride, themeById, themeFor, themeVars, type ThemeColors } from './themes.ts';
import { NICK_COLOURS } from '../renderer/tools/nickColour.ts';

const stone = themeById('stone').colors;

/** WCAG relative luminance and contrast ratio: what "reads worse" is measured in. */
function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map(i => {
        const v = parseInt(hex.slice(i, i + 2), 16) / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
}

test('every theme fills every token with a #rrggbb, and ids are unique', () => {
    for (const theme of THEMES) {
        for (const token of THEME_TOKENS) assert.match(theme.colors[token], /^#[0-9a-f]{6}$/, `${theme.id} ${token}`);
        assert.deepEqual(Object.keys(theme.colors).sort(), [...THEME_TOKENS].sort(), theme.id);
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

test("signal tokens are the client's own in every theme", () => {
    for (const theme of THEMES) {
        for (const token of ['gold', 'link', 'good', 'warn', 'red', 'red-edge', 'alarm', 'red-lit'] as const) {
            assert.equal(theme.colors[token], stone[token], `${theme.id} ${token}`);
        }
    }
});

/*
 * The floors are stone's own ratios, pair by pair, not a general standard:
 * dim on stone is 3.97:1 and the purple nick on the log's well 2.96:1, both
 * under WCAG AA, so a general standard would fail the look the kit ships.
 */
test("no theme reads worse than 2004 stone: every text-on-ground pair keeps 90% of stone's ratio", () => {
    const texts = ['cream', 'dim', 'faint', 'gold', 'link', 'good', 'warn', 'alarm'] as const;
    const grounds = ['ink', 'stone', 'stone-lit', 'tab', 'well'] as const;
    for (const theme of THEMES) {
        const c: ThemeColors = theme.colors;
        for (const text of texts) {
            for (const ground of grounds) {
                const floor = 0.9 * contrast(stone[text], stone[ground]);
                const ratio = contrast(c[text], c[ground]);
                assert.ok(ratio >= floor, `${theme.id}: ${text} on ${ground} is ${ratio.toFixed(2)}, floor ${floor.toFixed(2)}`);
            }
        }
        for (const nick of NICK_COLOURS) {
            const floor = 0.9 * contrast(nick, stone.well);
            const ratio = contrast(nick, c.well);
            assert.ok(ratio >= floor, `${theme.id}: nick ${nick} on well is ${ratio.toFixed(2)}, floor ${floor.toFixed(2)}`);
        }
    }
});

test('a derived theme darkens with a darker place and never lightens with a lighter one', () => {
    const wilderness = themeById('wilderness').colors;
    const alkharid = themeById('alkharid').colors;
    assert.ok(luminance(wilderness.stone) < luminance(stone.stone));
    // Al Kharid's sand is far lighter than the client's stone; its frame is not.
    assert.ok(luminance(alkharid.stone) < luminance(stone['stone-lit']));
});

test("themeFor: a server's override, else the app theme, else stone", () => {
    const appearance = { theme: 'zanaris', servers: { lostcity: 'wilderness' } };
    assert.equal(themeFor(appearance, 'lostcity').id, 'wilderness');
    assert.equal(themeFor(appearance, 'zanaris').id, 'zanaris');
    assert.equal(themeFor(appearance, null).id, 'zanaris');
    assert.equal(themeFor({ theme: 'parchment', servers: {} }, null).id, DEFAULT_THEME);
    assert.equal(themeFor({ theme: 'zanaris', servers: { lostcity: 'parchment' } }, 'lostcity').id, 'zanaris');
});

test('an override is read only off the servers block itself, never its prototype', () => {
    assert.equal(serverOverride({ theme: 'stone', servers: {} }, 'toString'), null);
    assert.equal(serverOverride({ theme: 'stone', servers: {} }, '__proto__'), null);
});

test('isThemeId knows the six and nothing else', () => {
    for (const theme of THEMES) assert.ok(isThemeId(theme.id));
    assert.equal(isThemeId('parchment'), false);
    assert.equal(isThemeId(7), false);
    assert.equal(isThemeId(null), false);
});

test('themeVars names every token as the variable styles.css reads', () => {
    const vars = themeVars(stone);
    assert.equal(Object.keys(vars).length, THEME_TOKENS.length);
    assert.equal(vars['--color-stone'], stone.stone);
    assert.equal(vars['--color-red-lit'], stone['red-lit']);
});
