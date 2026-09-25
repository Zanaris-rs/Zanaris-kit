import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEME_FILE_EXTENSION, readThemeFile, themeFileName, writeThemeFile } from './themeFile.ts';
import { PICTURE_MAX } from './pictures.ts';
import { themeById, type Theme } from '../shared/themes.ts';

const stone = themeById('stone').colors;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7, 6]);
const night: Theme = {
    id: 'custom-0000000a',
    name: 'Night',
    colors: { ...stone, stone: '#223344' },
    background: { picture: `${'ab'.repeat(32)}.png`, fit: 'cover', show: 0.35 }
};

const file = (over: Record<string, unknown>): string =>
    JSON.stringify({ zanarisKitTheme: 1, name: 'Night', colors: { stone: '#223344' }, background: null, ...over });

test('a theme without a picture round-trips, and carries nothing but its look', () => {
    const text = writeThemeFile({ ...night, background: null }, null);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    assert.deepEqual(Object.keys(parsed).sort(), ['background', 'colors', 'name', 'zanarisKitTheme']);
    assert.deepEqual(readThemeFile(text), { ok: true, theme: { name: 'Night', colors: night.colors, background: null } });
});

test('a theme with a picture carries it inline, and it comes back byte for byte', () => {
    const text = writeThemeFile(night, { bytes: PNG, type: 'png' });
    const read = readThemeFile(text);
    assert.ok(read.ok);
    assert.deepEqual(read.theme.background, { bytes: PNG, fit: 'cover', show: 0.35 });
});

test('a picture the theme names but the file cannot carry is left off rather than written half', () => {
    const read = readThemeFile(writeThemeFile(night, null));
    assert.ok(read.ok);
    assert.equal(read.theme.background, null);
});

test('a colour a file leaves out is stone, as for a file made before that colour existed', () => {
    const read = readThemeFile(file({ colors: { stone: '#223344' } }));
    assert.ok(read.ok);
    assert.equal(read.theme.colors.cream, stone.cream);
});

test('each thing that is not a theme is refused with its own sentence', () => {
    const refused = (text: string): string => {
        const read = readThemeFile(text);
        assert.equal(read.ok, false, text.slice(0, 80));
        return read.ok ? '' : read.error;
    };
    assert.match(refused('{ nope'), /isn't a Zanaris Kit theme/);
    assert.match(refused('[]'), /isn't a Zanaris Kit theme/);
    assert.match(refused(JSON.stringify({ name: 'x', colors: {} })), /isn't a Zanaris Kit theme/);
    assert.match(refused(file({ zanarisKitTheme: 2 })), /newer Zanaris Kit/);
    assert.match(refused(file({ zanarisKitTheme: 0 })), /isn't a Zanaris Kit theme/);
    assert.match(refused(file({ name: '' })), /name/);
    assert.match(refused(file({ colors: { stone: 'blue' } })), /colours/);
    const picture = (over: Record<string, unknown>): string =>
        file({ background: { type: 'png', fit: 'cover', show: 0.3, data: PNG.toString('base64'), ...over } });
    assert.match(refused(picture({ data: 'not base64!' })), /picture/);
    assert.match(refused(picture({ data: Buffer.from('<svg/>').toString('base64') })), /PNG, JPEG, WebP or GIF/);
    assert.match(refused(picture({ fit: 'stretch' })), /picture/);
    assert.match(refused(picture({ show: 0.9 })), /picture/);
    const big = Buffer.alloc(PICTURE_MAX + 1);
    PNG.copy(big);
    assert.match(refused(picture({ data: big.toString('base64') })), /10 MB/);
});

test('a picture is typed by its bytes, whatever the file says it is', () => {
    const read = readThemeFile(file({ background: { type: 'gif', fit: 'tile', show: 0.2, data: PNG.toString('base64') } }));
    assert.ok(read.ok);
    assert.deepEqual(read.theme.background, { bytes: PNG, fit: 'tile', show: 0.2 });
});

test('themeFileName is the name made safe for any platform, as a .zktheme', () => {
    assert.equal(THEME_FILE_EXTENSION, 'zktheme');
    assert.equal(themeFileName('Night'), 'Night.zktheme');
    assert.equal(themeFileName('a/b:c?'), 'a b c.zktheme');
    assert.equal(themeFileName('...'), 'Theme.zktheme');
});

test('a file nested deeper than any theme is refused before it is parsed, and quickly', () => {
    // As big as a theme file may be: 16 MB of brackets, which JSON.parse takes seconds over on the main thread.
    const deep = `${'['.repeat(8_000_000)}${']'.repeat(8_000_000)}`;
    const started = Date.now();
    const read = readThemeFile(deep);
    assert.equal(read.ok, false);
    assert.ok(Date.now() - started < 1_000, `took ${Date.now() - started}ms`);
    // Brackets inside a string are text, not nesting.
    const named = readThemeFile(file({ name: '[[[[[[[[[[[[' }));
    assert.ok(named.ok);
    assert.equal(named.theme.name, '[[[[[[[[[[[[');
});
