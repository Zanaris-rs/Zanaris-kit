import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serverChannel } from './channels.ts';

test('each hosted server has its own room', () => {
    assert.equal(serverChannel('lostcity'), '#04scape-lostcity');
    assert.equal(serverChannel('zanaris'), '#04scape-zanaris');
    assert.equal(serverChannel('lostcitylabs'), '#04scape-labs');
});

test('the local server has none, since it would be a room of one', () => {
    assert.equal(serverChannel('local'), null);
});

test('a server the user added themselves has none', () => {
    assert.equal(serverChannel('my-own-server'), null);
    assert.equal(serverChannel(''), null);
    // An id can be anything the user's server name slugified to, Object.prototype keys included.
    assert.equal(serverChannel('constructor'), null);
});
