import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import Isaac from './isaac.ts';

/**
 * Compared against the engine's own Isaac rather than a fixture, so this stays
 * honest if the engine ever changes. Node strips the types on import.
 */
const ENGINE = resolve(
    process.env.SWIFTKIT_SERVER_ROOT ?? resolve(import.meta.dirname, '../../..'),
    'engine/src/io/Isaac.ts'
);

const { default: EngineIsaac } = (await import(ENGINE)) as { default: new (seed?: number[]) => { nextInt(): number } };

const SEEDS: number[][] = [
    [0, 0, 0, 0],
    [1, 2, 3, 4],
    [12345678, 87654321, 10668723, 1061514982],
    // The +50 decrypt seed can push a word past 2^31 — the int32 wrap must match.
    [2147483647, -2147483648, -1, 2147483600 + 50],
    [33158998, 99859750, 12931227, 1753455222].map(n => (n + 50) | 0)
];

for (const seed of SEEDS) {
    test(`matches the engine for seed [${seed.join(', ')}]`, () => {
        const mine = new Isaac([...seed]);
        const theirs = new EngineIsaac([...seed]);
        for (let i = 0; i < 2000; i++) {
            assert.equal(mine.nextInt(), theirs.nextInt(), `diverged at draw ${i}`);
        }
    });
}

test('crosses the internal 256-draw refill boundary identically', () => {
    const seed = [98765, 43210, 11111, 22222];
    const mine = new Isaac([...seed]);
    const theirs = new EngineIsaac([...seed]);
    for (let i = 0; i < 10_000; i++) {
        assert.equal(mine.nextInt(), theirs.nextInt(), `diverged at draw ${i}`);
    }
});
