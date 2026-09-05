import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlotAllocator, partitionFor, windowTitle } from './slots.ts';

test('the first instance of a server gets slot 1, the next gets 2', () => {
    const slots = new SlotAllocator();
    assert.equal(slots.acquire('a'), 1);
    assert.equal(slots.acquire('a'), 2);
    assert.equal(slots.count('a'), 2);
});

test('servers do not share slots', () => {
    const slots = new SlotAllocator();
    slots.acquire('a');
    assert.equal(slots.acquire('b'), 1);
    assert.equal(slots.count('b'), 1);
});

test('a released slot is reused before a new one is handed out', () => {
    const slots = new SlotAllocator();
    slots.acquire('a');
    slots.acquire('a');
    slots.release('a', 1);
    assert.equal(slots.count('a'), 1);
    assert.equal(slots.acquire('a'), 1, 'the gap is filled first');
    assert.equal(slots.acquire('a'), 3);
});

test('releasing an unknown slot is harmless', () => {
    const slots = new SlotAllocator();
    slots.release('a', 4);
    assert.equal(slots.count('a'), 0);
});

test('slot 1 keeps the plain partition name; later slots are suffixed', () => {
    assert.equal(partitionFor('zanaris-w1', 1), 'persist:server:zanaris-w1');
    assert.equal(partitionFor('zanaris-w1', 2), 'persist:server:zanaris-w1:2');
    assert.equal(partitionFor('odd id!', 1), 'persist:server:odd-id-', 'partition names are sanitised');
});

test('window titles number the later instances only', () => {
    assert.equal(windowTitle('Zanaris — World 1', 1), 'Zanaris — World 1');
    assert.equal(windowTitle('Zanaris — World 1', 2), 'Zanaris — World 1 (2)');
});
