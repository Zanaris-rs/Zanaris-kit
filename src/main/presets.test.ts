import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FITS } from '../shared/themes.ts';
import { PictureStore, pictureType } from './pictures.ts';
import { PRESETS, presetCards, presetFile, readPreset } from './presets.ts';

/** Where the pictures ship from: main reads them at `../../static/pictures` from its bundle, the same folder. */
const shipped = fileURLToPath(new URL('../../static/pictures/', import.meta.url));

const inTemp = (use: (dir: string) => void): void => {
    const dir = mkdtempSync(join(tmpdir(), 'zanaris-kit-presets-'));
    try {
        use(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
};

test('every preset has its file in static/pictures, and nothing else is there', () => {
    // Dotfiles aside: Finder leaves a .DS_Store in any folder it has shown.
    const files = readdirSync(shipped).filter(file => !file.startsWith('.'));
    assert.deepEqual(files.sort(), PRESETS.map(p => p.file).sort());
});

test("each preset's bytes are the type its file's name says", () => {
    for (const preset of PRESETS) {
        const bytes = readPreset(shipped, preset.id);
        assert.ok(bytes, preset.id);
        assert.equal(pictureType(bytes), preset.file.slice(preset.file.lastIndexOf('.') + 1), preset.file);
    }
});

test('the store keeps every preset, under the name Settings is sent for it', () => {
    // A preset the store would refuse — too big, too many pixels — would be offered and then fail when picked.
    inTemp(dir => {
        const store = new PictureStore(join(dir, 'backgrounds'));
        const cards = presetCards(shipped);
        assert.deepEqual(
            cards.map(card => card.id),
            PRESETS.map(p => p.id)
        );
        for (const card of cards) {
            const bytes = readPreset(shipped, card.id);
            assert.ok(bytes, card.id);
            assert.deepEqual(store.add(bytes), { picture: card.picture }, card.id);
        }
    });
});

test('ids are unique and URL-safe, names are unique, and every fit is one the kit knows', () => {
    const ids = PRESETS.map(p => p.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, /^[a-z]+$/);
    assert.equal(new Set(PRESETS.map(p => p.name.toLowerCase())).size, PRESETS.length);
    for (const preset of PRESETS) assert.ok(FITS.includes(preset.fit), preset.id);
});

test('an id the list does not have reads nothing, however it is shaped', () => {
    for (const id of ['', 'nope', '../package.json', 'title.jpg', 'Title', '__proto__', 'constructor', null, undefined, 7]) {
        assert.equal(readPreset(shipped, id), null, String(id));
    }
});

test("presetFile answers a preset's bytes and type for the scheme, and nothing for an id the list does not have", () => {
    const lava = presetFile(shipped, 'lava');
    assert.equal(lava?.type, 'png');
    assert.deepEqual(lava?.bytes, readPreset(shipped, 'lava'));
    assert.equal(presetFile(shipped, 'title')?.type, 'jpg');
    for (const id of ['nope', '../package.json', 'lava.png']) assert.equal(presetFile(shipped, id), null, id);
});

test('a preset whose file is missing is left out of what Settings is sent', () => {
    inTemp(dir => assert.deepEqual(presetCards(dir), []));
});
