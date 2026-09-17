import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromBase37, INVALID_NAME, NAME_INPUT_MAX, nameProblem, toBase37, toDisplayName, toSafeName } from './names.ts';

test('toSafeName lower-cases, trims, and turns anything else into an underscore', () => {
    assert.equal(toSafeName('Zezima'), 'zezima');
    assert.equal(toSafeName('  Bob  '), 'bob');
    assert.equal(toSafeName('a b'), 'a_b');
    assert.equal(toSafeName('a-b'), 'a_b');
    assert.equal(toSafeName('a  b'), 'a__b');
    assert.equal(toSafeName('my save (1)'), 'my_save__1');
});

test('toSafeName keeps the first twelve characters and drops underscores at either end', () => {
    assert.equal(toSafeName('abcdefghijklmnopqrst'), 'abcdefghijkl');
    assert.equal(toSafeName('bob_'), 'bob');
    assert.equal(toSafeName('bob!!!'), 'bob');
    assert.equal(toSafeName('_bob'), 'bob');
    assert.equal(toSafeName('999999999999'), '999999999999');
    assert.equal(toSafeName('zzzzzzzzzzzz'), 'zzzzzzzzzzzz');
});

test('a name with no letter or digit is invalid_name, as the engine files it', () => {
    assert.equal(toSafeName('!!!'), INVALID_NAME);
    assert.equal(toSafeName(''), INVALID_NAME);
    assert.equal(toSafeName(' '), INVALID_NAME);
    assert.equal(toSafeName('..'), INVALID_NAME);
    assert.equal(toBase37('!!!'), 0n);
});

test('nothing toSafeName returns can climb out of a directory or name a drive', () => {
    assert.equal(toSafeName('../../etc/passwd'), 'etc_pa');
    assert.equal(toSafeName('a/b'), 'a_b');
    assert.equal(toSafeName('C:\\x'), 'c__x');
    assert.equal(toSafeName('Zezima.sav'), 'zezima_sav');
    for (const typed of ['../../etc/passwd', 'a/b', 'C:\\x', '..', 'élan', 'x'.repeat(40)]) {
        assert.match(toSafeName(typed), /^[a-z0-9_]{1,12}$/, typed);
    }
});

test('letters outside a-z count as underscores, and a leading one vanishes', () => {
    assert.equal(toSafeName('élan'), 'lan');
});

test('fromBase37 refuses zero, a multiple of 37 and anything past twelve characters', () => {
    assert.equal(fromBase37(0n), INVALID_NAME);
    assert.equal(fromBase37(37n), INVALID_NAME);
    assert.equal(fromBase37(-1n), INVALID_NAME);
    assert.equal(fromBase37(6582952005840035281n), INVALID_NAME);
    assert.equal(fromBase37(toBase37('zezima')), 'zezima');
});

test("toDisplayName is the game's: underscores as spaces, each word capitalised", () => {
    assert.equal(toDisplayName('bob_the_big'), 'Bob The Big');
    assert.equal(toDisplayName('bob_the_great'), 'Bob The Grea', 'the safe name first, so twelve characters');
    assert.equal(toDisplayName('ZEZIMA'), 'Zezima');
    assert.equal(toDisplayName('a  b'), 'A  B');
});

test('nameProblem refuses what cannot be a character, and nothing else', () => {
    assert.equal(nameProblem('Zezima'), null);
    assert.equal(nameProblem('x'.repeat(20)), null, 'a long name is shortened, not refused');
    assert.match(nameProblem('!!!') ?? '', /letter or number/);
    assert.match(nameProblem('') ?? '', /letter or number/);
    assert.match(nameProblem('Invalid Name') ?? '', /keeps that name/);
    assert.match(nameProblem('CON') ?? '', /Windows/);
    assert.match(nameProblem('lpt9') ?? '', /Windows/);
    assert.match(nameProblem(String.fromCharCode(0) + 'nul') ?? '', /Windows/);
    assert.equal(nameProblem('com10'), null);
    assert.match(nameProblem('x'.repeat(NAME_INPUT_MAX + 1)) ?? '', /too long/);
});
