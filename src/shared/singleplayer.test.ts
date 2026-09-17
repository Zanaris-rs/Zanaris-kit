import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isXpRate, worldRunning, XP_RATES } from './singleplayer.ts';

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
