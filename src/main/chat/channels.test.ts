import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serverChannel } from './channels.ts';

test('the one hosted server with a real room on SwiftIRC gets it', () => {
    assert.equal(serverChannel('lostcity'), '#LostCity');
});

test('zanaris and lostcitylabs have no room, since there is none for them on SwiftIRC', () => {
    assert.equal(serverChannel('zanaris'), null, 'no #Zanaris exists; guessing one risks a stranger\'s channel');
    assert.equal(serverChannel('lostcitylabs'), null, 'no room exists for Labs either');
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
