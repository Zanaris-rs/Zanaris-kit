import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShotLedger } from './shotLedger.ts';

const png = (...bytes: number[]): Uint8Array => Uint8Array.from(bytes);

test('shots with different bytes have no twin', () => {
    const ledger = new ShotLedger();
    assert.equal(ledger.record('zanaris-shell.png', png(1, 2, 3)), null);
    assert.equal(ledger.record('zanaris-hiscores-shell.png', png(1, 2, 4)), null);
});

test('a shot with the same bytes as an earlier one names it', () => {
    const ledger = new ShotLedger();
    ledger.record('lostcity-w2-shell.png', png(9, 9, 9));
    ledger.record('lostcity-hiscores-shell.png', png(7));
    assert.equal(ledger.record('lostcity-split-down-shell.png', png(9, 9, 9)), 'lostcity-w2-shell.png');
});

test('a third copy still names the first, the frame the others repeat', () => {
    const ledger = new ShotLedger();
    ledger.record('zanaris-shell.png', png(5));
    ledger.record('zanaris-hiscores-shell.png', png(5));
    assert.equal(ledger.record('zanaris-launcher-shell.png', png(5)), 'zanaris-shell.png');
});

test('the same bytes in a different buffer are still a twin', () => {
    const ledger = new ShotLedger();
    const bytes = png(4, 2);
    ledger.record('a-shell.png', bytes);
    assert.equal(ledger.record('b-shell.png', Buffer.from(bytes)), 'a-shell.png');
});
