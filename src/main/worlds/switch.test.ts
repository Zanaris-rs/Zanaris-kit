import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldSwitch } from './switch.ts';
import type { WorldsDef } from '../../shared/worlds.ts';

const LOSTCITY: WorldsDef = {
    source: { kind: 'losthq', url: 'https://2004.losthq.rs/pages/api/worlds.php' },
    template: 'https://w{world}-2004.lostcity.rs/rs2.cgi?plugin=0&world={world}&lowmem={lowmem}',
    detail: true,
    defaultWorld: 5
};
const ZANARIS: WorldsDef = {
    source: { kind: 'zanaris', url: 'https://zanaris.rs/worlds.json' },
    template: '{url}/rs2.cgi?lowmem={lowmem}',
    detail: true,
    defaultWorld: 1
};
const LABS: WorldsDef = {
    source: { kind: 'static', worlds: [1, 2].map(id => ({ id, name: `World ${id}`, region: 'Germany', members: true })) },
    template: 'https://www.lostcitylabs.com/play/world-{world}/',
    detail: false,
    defaultWorld: 1
};
const W2 = { id: 2, origin: 'https://w2-2004.lostcity.rs' };

test('starts on the default world at low detail when nothing is remembered', () => {
    const s = new WorldSwitch(LOSTCITY, 'https://w5-2004.lostcity.rs/rs2.cgi?plugin=0&world=5&lowmem=1', null);
    assert.equal(s.world, 5);
    assert.equal(s.detail, 'low');
    assert.equal(s.url, 'https://w5-2004.lostcity.rs/rs2.cgi?plugin=0&world=5&lowmem=1');
});

test('starts on the remembered world, detail and url', () => {
    const remembered = { world: 7, detail: 'high' as const, url: 'https://w7-2004.lostcity.rs/rs2.cgi?plugin=0&world=7&lowmem=0' };
    const s = new WorldSwitch(LOSTCITY, 'https://w5-2004.lostcity.rs/rs2.cgi', remembered);
    assert.equal(s.world, 7);
    assert.equal(s.detail, 'high');
    assert.equal(s.url, remembered.url);
    assert.deepEqual(s.remembered(), remembered);
});

test('a template that needs an origin starts on the server url until a world is chosen', () => {
    const s = new WorldSwitch(ZANARIS, 'https://w1.04.zanaris.rs/rs2.cgi?lowmem=1', null);
    assert.equal(s.world, 1);
    assert.equal(s.url, 'https://w1.04.zanaris.rs/rs2.cgi?lowmem=1');
});

test('select moves to a listed world and returns the url to load', () => {
    const s = new WorldSwitch(LOSTCITY, 'https://w5-2004.lostcity.rs/rs2.cgi?plugin=0&world=5&lowmem=1', null);
    const url = s.select(W2);
    assert.equal(url, 'https://w2-2004.lostcity.rs/rs2.cgi?plugin=0&world=2&lowmem=1');
    assert.equal(s.world, 2);
    assert.equal(s.url, url);
    assert.deepEqual(s.remembered(), { world: 2, detail: 'low', url });
});

test('select on Zanaris uses the chosen world origin', () => {
    const s = new WorldSwitch(ZANARIS, 'https://w1.04.zanaris.rs/rs2.cgi?lowmem=1', null);
    assert.equal(s.select({ id: 2, origin: 'https://w2.04.zanaris.rs' }), 'https://w2.04.zanaris.rs/rs2.cgi?lowmem=1');
});

test('setDetail reloads the current world at the other detail', () => {
    const s = new WorldSwitch(LOSTCITY, 'https://w5-2004.lostcity.rs/rs2.cgi?plugin=0&world=5&lowmem=1', null);
    assert.equal(s.setDetail('high'), 'https://w5-2004.lostcity.rs/rs2.cgi?plugin=0&world=5&lowmem=0');
    assert.equal(s.detail, 'high');
    assert.equal(s.setDetail('high'), null, 'unchanged is a no-op');
});

test('setDetail on Zanaris keeps the current world origin', () => {
    const s = new WorldSwitch(ZANARIS, 'https://w1.04.zanaris.rs/rs2.cgi?lowmem=1', null);
    assert.equal(s.setDetail('high'), 'https://w1.04.zanaris.rs/rs2.cgi?lowmem=0');
});

test('setDetail is refused when the server ignores detail', () => {
    const s = new WorldSwitch(LABS, 'https://www.lostcitylabs.com/play/world-1/', null);
    assert.equal(s.setDetail('high'), null);
    assert.equal(s.detail, 'low');
});

test('labels carry world, detail and latency, dropping what is missing', () => {
    const s = new WorldSwitch(LOSTCITY, 'https://w5-2004.lostcity.rs/rs2.cgi?plugin=0&world=5&lowmem=1', null);
    assert.equal(s.label('Lost City', 43), 'Lost City · W5 · low · 43 ms');
    assert.equal(s.label('Lost City', null), 'Lost City · W5 · low');
    const labs = new WorldSwitch(LABS, 'https://www.lostcitylabs.com/play/world-1/', null);
    assert.equal(labs.label('Lost City Labs', 80), 'Lost City Labs · W1 · 80 ms');
});

test('the window title names the world', () => {
    const s = new WorldSwitch(LOSTCITY, 'https://w5-2004.lostcity.rs/rs2.cgi?plugin=0&world=5&lowmem=1', null);
    assert.equal(s.title('Lost City'), 'Lost City — World 5');
});
