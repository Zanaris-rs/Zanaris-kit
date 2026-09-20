import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundledRecipes, recipeRevision } from './recipes.ts';

test('the recipes the kit knows are every engines/*.json, in file order, when nothing was stamped at build time', () => {
    assert.deepEqual(
        bundledRecipes().map(r => [r.id, r.revision]),
        [
            ['lostcity-274', 274],
            ['lostcity-289', 289]
        ]
    );
});

test('a line\'s revision, or the default line\'s for one the kit does not know', () => {
    assert.equal(recipeRevision('lostcity-289'), 289);
    assert.equal(recipeRevision('lostcity-274'), 274);
    assert.equal(recipeRevision(null), 274);
    assert.equal(recipeRevision('retired'), 274);
    assert.equal(recipeRevision('lostcity-289', []), 274, 'with no recipes at all, the last revision the kit was written against');
});
