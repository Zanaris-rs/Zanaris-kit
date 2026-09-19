import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactFile, artifactUrl, DEFAULT_BUILD, readRecipe, recipeTag } from '../src/shared/engines.ts';
import { patchHash, readPatches } from './stage-lib.mjs';

const E = 'a'.repeat(40);
const C = 'b'.repeat(40);

function recipe(over = {}) {
    return {
        id: 'lostcity-274',
        name: 'Lost City 274',
        revision: 274,
        note: null,
        engine: { repo: 'https://github.com/LostCityRS/Engine-TS.git', commit: E },
        content: { repo: 'https://github.com/LostCityRS/Content.git', commit: C },
        patches: 'patches/engine',
        artifact: { tag: `engine-lostcity-274-${E.slice(0, 8)}-${C.slice(0, 8)}-12345678`, file: 'engine-lostcity-274.tar.gz', size: 52_000_000, sha256: 'c'.repeat(64) },
        ...over
    };
}

test('a complete recipe reads as itself, and a pin that is moving has no artifact', () => {
    assert.deepEqual(readRecipe(recipe()), recipe());
    assert.deepEqual(readRecipe(recipe({ artifact: null, note: 'Developers only upstream' })), recipe({ artifact: null, note: 'Developers only upstream' }));
});

test('each broken field refuses the whole recipe', () => {
    const broken = [
        recipe({ id: 'Lost City' }),
        recipe({ id: '-274' }),
        recipe({ id: '../x' }),
        recipe({ name: '' }),
        recipe({ revision: 0 }),
        recipe({ revision: 274.5 }),
        recipe({ note: 7 }),
        recipe({ engine: { repo: 'https://github.com/LostCityRS/Engine-TS.git', commit: 'abc' } }),
        recipe({ content: { repo: '', commit: C } }),
        recipe({ patches: 7 }),
        recipe({ artifact: { ...recipe().artifact, tag: 'engine-lostcity-289-x' } }),
        recipe({ artifact: { ...recipe().artifact, size: 0 } }),
        recipe({ artifact: { ...recipe().artifact, sha256: 'C'.repeat(64) } }),
        recipe({ artifact: { ...recipe().artifact, file: '../engine.tar.gz' } }),
        recipe({ artifact: 'soon' }),
        null,
        'lostcity-274'
    ];
    for (const x of broken) assert.equal(readRecipe(x), null, JSON.stringify(x));
});

test('the tag names the line, both commits and the patches, and the file and url follow from it', () => {
    assert.equal(recipeTag(recipe(), '0123abcd'), `engine-lostcity-274-aaaaaaaa-bbbbbbbb-0123abcd`);
    assert.equal(artifactFile('lostcity-289'), 'engine-lostcity-289.tar.gz');
    assert.equal(
        artifactUrl(recipe().artifact),
        `https://github.com/Zanaris-rs/Zanaris-kit/releases/download/engine-lostcity-274-aaaaaaaa-bbbbbbbb-12345678/engine-lostcity-274.tar.gz`
    );
});

test('patchHash is eight hex digits that change with any patch', () => {
    const one = patchHash([{ name: '0001.patch', sha256: 'd'.repeat(64) }]);
    assert.match(one, /^[0-9a-f]{8}$/);
    assert.notEqual(one, patchHash([{ name: '0001.patch', sha256: 'e'.repeat(64) }]));
    assert.notEqual(one, patchHash([]));
});

const files = readdirSync('engines').filter(name => name.endsWith('.json'));

test('every recipe in engines/ reads, is named for its file, and pins an artifact built from exactly it', () => {
    assert.ok(files.length > 0);
    for (const file of files) {
        const read = readRecipe(JSON.parse(readFileSync(join('engines', file), 'utf8')));
        assert.ok(read, `${file} is not a recipe the kit can read`);
        assert.equal(`${read.id}.json`, file);
        assert.ok(existsSync(read.patches), `${file}: ${read.patches} does not exist`);
        if (read.artifact === null) continue;
        // A pin moved, or a patch edited, without a new build fails here rather than shipping.
        assert.equal(read.artifact.tag, recipeTag(read, patchHash(readPatches(read.patches))), `${file}: the artifact was not built from these commits and patches`);
        assert.equal(read.artifact.file, artifactFile(read.id));
    }
});

test('the default build is one of the recipes', () => {
    assert.ok(files.includes(`${DEFAULT_BUILD}.json`));
});
