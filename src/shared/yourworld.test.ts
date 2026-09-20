import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPlaytime, isXpRate, PROBLEM_LABEL, PROBLEM_TEXT, worldRunning, XP_RATES } from './yourworld.ts';

test('worldRunning is every status but stopped and failed', () => {
    assert.equal(worldRunning('stopped'), false);
    assert.equal(worldRunning('failed'), false);
    for (const status of ['preparing', 'starting', 'ready', 'stopping'] as const) assert.equal(worldRunning(status), true, status);
});

test('isXpRate takes the four offered rates and nothing else', () => {
    assert.deepEqual([...XP_RATES], [1, 2, 5, 10]);
    for (const rate of XP_RATES) assert.equal(isXpRate(rate), true);
    for (const other of [0, 3, 100, -1, 1.5, '5', null, undefined, Number.NaN]) assert.equal(isXpRate(other), false, String(other));
});

test('formatPlaytime reads ticks of 600 ms as minutes, hours and days', () => {
    assert.equal(formatPlaytime(0), 'under a minute');
    assert.equal(formatPlaytime(99), 'under a minute');
    assert.equal(formatPlaytime(-5), 'under a minute');
    assert.equal(formatPlaytime(100), '1m');
    assert.equal(formatPlaytime(3529), '35m');
    assert.equal(formatPlaytime(6000), '1h 00m');
    assert.equal(formatPlaytime(6100), '1h 01m');
    assert.equal(formatPlaytime(143_999), '23h 59m');
    assert.equal(formatPlaytime(144_000), '1d 0h');
});

test('every file problem has a sentence and a label', () => {
    for (const problem of ['not-a-save', 'too-new', 'corrupt', 'unreadable'] as const) {
        assert.match(PROBLEM_TEXT[problem], /\.$/);
        assert.ok(PROBLEM_LABEL[problem].length > 0);
    }
});
