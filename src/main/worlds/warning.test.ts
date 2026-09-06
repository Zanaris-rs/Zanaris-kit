import { test } from 'node:test';
import assert from 'node:assert/strict';
import { switchWarning } from './warning.ts';

test('switching world names where you are going and where you are leaving', () => {
    assert.deepEqual(switchWarning({ kind: 'world', to: 2, from: 5 }), {
        message: 'Switch to World 2?',
        detail: 'SwiftKit loads World 2 straight away, whether or not you are logged in. If you are in game on World 5, that logs you out.'
    });
});

test('the world being left is not the world being joined', () => {
    const warning = switchWarning({ kind: 'world', to: 41, from: 3 });
    assert.equal(warning.message, 'Switch to World 41?');
    assert.ok(warning.detail.startsWith('SwiftKit loads World 41 straight away'));
    assert.ok(warning.detail.includes('in game on World 3, that logs you out.'));
});

test('switching to high detail names the world being reloaded', () => {
    assert.deepEqual(switchWarning({ kind: 'detail', to: 'high', world: 5 }), {
        message: 'Switch to high detail?',
        detail: 'SwiftKit reloads World 5 at high detail straight away, whether or not you are logged in. If you are in game, that logs you out.'
    });
});

test('switching to low detail says low', () => {
    assert.deepEqual(switchWarning({ kind: 'detail', to: 'low', world: 1 }), {
        message: 'Switch to low detail?',
        detail: 'SwiftKit reloads World 1 at low detail straight away, whether or not you are logged in. If you are in game, that logs you out.'
    });
});
