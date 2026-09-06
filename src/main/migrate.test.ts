import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { migrationPlan } from './migrate.ts';

const OLD = '/Users/p/Library/Application Support/swiftkit';
const NEW = '/Users/p/Library/Application Support/zanaris-kit';
const ALL = ['servers.json', 'state.json', 'Partitions'];

/** An `exists` that answers true for exactly the named entries under each profile. */
const profiles = (oldEntries: string[], newEntries: string[]): ((path: string) => boolean) => {
    const present = new Set([...oldEntries.map(name => join(OLD, name)), ...newEntries.map(name => join(NEW, name))]);
    return path => present.has(path);
};

test('an old profile that is not there has nothing to move', () => {
    assert.deepEqual(migrationPlan(OLD, NEW, profiles([], [])), []);
});

test('a new profile with none of the entries takes all three', () => {
    assert.deepEqual(migrationPlan(OLD, NEW, profiles(ALL, [])), ALL);
});

test('a new profile Chromium has already scaffolded takes only what it is missing', () => {
    assert.deepEqual(migrationPlan(OLD, NEW, profiles(ALL, ['servers.json', 'Partitions'])), ['state.json']);
});

test('a new profile that has all three is left alone', () => {
    assert.deepEqual(migrationPlan(OLD, NEW, profiles(ALL, ALL)), []);
});

test('only what the old profile actually has is offered', () => {
    assert.deepEqual(migrationPlan(OLD, NEW, profiles(['state.json'], [])), ['state.json']);
});
