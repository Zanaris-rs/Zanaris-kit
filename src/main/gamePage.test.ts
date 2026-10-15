import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientPageCss, kitPageCss } from './gamePage.ts';
import { THEME_TOKENS, type ThemeColors, type ThemeLook } from '../shared/themes.ts';

/** A look whose every colour is different, so a colour in a sheet names the token it came from: the token's index, in hex. */
const hexOf = (i: number): string => `#0000${i.toString(16).padStart(2, '0')}`;
const look: ThemeLook = { colors: Object.fromEntries(THEME_TOKENS.map((token, i) => [token, hexOf(i)])) as ThemeColors, background: null };
const of = (token: (typeof THEME_TOKENS)[number]): string => hexOf(THEME_TOKENS.indexOf(token));

test("every colour the client sheet writes is the look's, or the glyph shadow's black", () => {
    const css = clientPageCss(look);
    const values = new Set(Object.values(look.colors));
    const hexes = css.match(/#[0-9a-f]{6}\b/gi) ?? [];
    assert.ok(hexes.length > 0);
    for (const hex of hexes) assert.ok(values.has(hex), hex);
    for (const fn of css.match(/rgba?\([^)]*\)/g) ?? []) assert.equal(fn, 'rgba(0, 0, 0, 0.78)');
    assert.doesNotMatch(css, /url\(|@import|<|expression/i);
});

test("the client sheet moves nothing that sets the page's height", () => {
    const css = clientPageCss(look);
    const sizing = /^(html(:root)?(:-webkit-full-screen)?|html:root body|html #controls)$/;
    let checked = 0;
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        if (!selector!.split(',').some(part => sizing.test(part.trim()))) continue;
        checked++;
        assert.doesNotMatch(body!, /(^|;|\s)(border|margin|padding|height|min-height|line-height)\s*:/, selector!);
    }
    assert.equal(checked, 2);
});

test('the page ground, the strip and its controls wear the theme', () => {
    const css = clientPageCss(look);
    assert.match(css, new RegExp(`html:root body[^{]*\\{[^}]*background-color: ${of('window')}`));
    assert.match(css, new RegExp(`html #controls \\{[^}]*background-color: ${of('stone')}`));
    assert.match(css, new RegExp(`html #controls \\{[^}]*inset 2px 2px 0 ${of('edge-lit')}, inset -2px -2px 0 ${of('edge-dark')}`));
    assert.match(css, new RegExp(`html a\\.green:hover[^{]*\\{[^}]*color: ${of('gold')}`));
});

test('the dropdowns and green text follow on a page with no strip, by rules of their own', () => {
    const css = clientPageCss(look);
    assert.match(css, new RegExp(`(^|\\n)html select \\{[^}]*background-color: ${of('well')}`));
    assert.match(css, new RegExp(`(^|\\n)html \\.green, html \\.icon-control \\{[^}]*color: ${of('cream')}`));
});

test('the kit sheet sets a variable for every token, and nothing else', () => {
    const css = kitPageCss(look);
    for (const token of THEME_TOKENS) assert.ok(css.includes(`--zk-${token}: ${look.colors[token]};`), token);
    assert.match(css, /^:root \{[^{}]*\}$/);
});
