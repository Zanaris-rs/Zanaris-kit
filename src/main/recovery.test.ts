import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Recoveries } from './recovery.ts';

test('a few reloads are allowed, then none until the window moves on', () => {
    const r = new Recoveries(3, 60_000);
    assert.equal(r.allow(0), true);
    assert.equal(r.allow(1_000), true);
    assert.equal(r.allow(2_000), true);
    assert.equal(r.allow(3_000), false, 'a page crashing as it loads is not reloaded forever');
    assert.equal(r.allow(59_999), false);
    assert.equal(r.allow(60_000), true, 'the first has aged out');
});

test('a refusal is not counted, so it does not push the next allowance further off', () => {
    const r = new Recoveries(1, 10_000);
    assert.equal(r.allow(0), true);
    for (let t = 1; t < 10_000; t += 1_000) assert.equal(r.allow(t), false);
    assert.equal(r.allow(10_000), true);
});
