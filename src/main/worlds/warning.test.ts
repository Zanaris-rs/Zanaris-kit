import { test } from 'node:test';
import assert from 'node:assert/strict';
import { switchWarning } from './warning.ts';

test('switching world names where you are going, and says a game in progress is logged out', () => {
    assert.deepEqual(switchWarning({ kind: 'world', to: 2 }), {
        message: 'Switch to World 2?',
        detail: "If you're in game, you'll be logged out."
    });
});

test('switching to high detail says high', () => {
    assert.deepEqual(switchWarning({ kind: 'detail', to: 'high' }), {
        message: 'Switch to high detail?',
        detail: "If you're in game, you'll be logged out."
    });
});

test('switching to low detail says low', () => {
    assert.deepEqual(switchWarning({ kind: 'detail', to: 'low' }), {
        message: 'Switch to low detail?',
        detail: "If you're in game, you'll be logged out."
    });
});
