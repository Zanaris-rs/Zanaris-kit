import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppState } from './appState.ts';

const dirs: string[] = [];
const tempFile = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'swiftkit-state-'));
    dirs.push(dir);
    return join(dir, 'state.json');
};
afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const REMEMBERED = { world: 7, detail: 'high' as const, url: 'https://w7-2004.lostcity.rs/rs2.cgi?plugin=0&world=7&lowmem=0' };

test('starts empty when there is no file', () => {
    const state = new AppState(tempFile());
    state.load();
    assert.equal(state.world('lostcity'), null);
});

test('setWorld saves, and a fresh instance reads it back', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    a.setWorld('lostcity', REMEMBERED);
    const b = new AppState(file);
    b.load();
    assert.deepEqual(b.world('lostcity'), REMEMBERED);
    assert.equal(b.world('zanaris'), null);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 1);
});

test('a broken file is kept aside and the state starts empty, without complaint', () => {
    const file = tempFile();
    writeFileSync(file, '{ nope');
    const state = new AppState(file);
    state.load();
    assert.equal(state.world('lostcity'), null);
    assert.ok(readdirSync(join(file, '..')).some(n => n.startsWith('state.json.broken-')));
});

test('an invalid entry is ignored while the rest load', () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ version: 1, worlds: { lostcity: REMEMBERED, zanaris: { world: 1, detail: 'ultra', url: 'https://x' }, labs: { world: 'x' } } }));
    const state = new AppState(file);
    state.load();
    assert.deepEqual(state.world('lostcity'), REMEMBERED);
    assert.equal(state.world('zanaris'), null);
    assert.equal(state.world('labs'), null);
});
