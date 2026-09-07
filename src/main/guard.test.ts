import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideNavigation } from './guard.ts';

const GAME = 'https://w5-2004.lostcity.rs/rs2.cgi?plugin=0&world=5&lowmem=1';
const OFFLINE = 'file:///app/static/offline.html?url=' + encodeURIComponent(GAME);

test('the offline page may return to the page main asked for', () => {
    assert.equal(decideNavigation({ current: OFFLINE, target: GAME, expected: GAME }), 'allow');
});

test('the offline page may not go anywhere else', () => {
    assert.equal(decideNavigation({ current: OFFLINE, target: 'https://w5-2004.lostcity.rs/other', expected: GAME }), 'block');
    assert.equal(decideNavigation({ current: OFFLINE, target: 'https://example.com/', expected: GAME }), 'open-external');
});

test('the game page may not navigate itself, even to its own host', () => {
    assert.equal(decideNavigation({ current: GAME, target: GAME, expected: GAME }), 'block');
    assert.equal(decideNavigation({ current: GAME, target: 'https://w5-2004.lostcity.rs/rs2.cgi?world=7', expected: GAME }), 'block');
});

test('links off the game page open in the system browser; non-web targets are dropped', () => {
    assert.equal(decideNavigation({ current: GAME, target: 'https://2004.losthq.rs/?p=questguides', expected: GAME }), 'open-external');
    assert.equal(decideNavigation({ current: GAME, target: 'javascript:alert(1)', expected: GAME }), 'block');
    assert.equal(decideNavigation({ current: GAME, target: 'file:///etc/passwd', expected: GAME }), 'block');
});

test("the starting page's retry is a kit navigation, not a page one", () => {
    const current = 'file:///app/static/starting.html?state=failed';
    assert.equal(decideNavigation({ current, target: 'file:///app/static/starting.html?retry=1', expected: 'http://127.0.0.1:40001/rs2.cgi?lowmem=1' }), 'retry');
    // only from a kit page, and only the retry query
    assert.equal(decideNavigation({ current: 'http://127.0.0.1:40001/rs2.cgi', target: 'file:///app/static/starting.html?retry=1', expected: 'http://127.0.0.1:40001/rs2.cgi' }), 'block');
    assert.equal(decideNavigation({ current, target: 'file:///app/static/starting.html?state=failed', expected: 'http://127.0.0.1:40001/rs2.cgi' }), 'block');
    assert.equal(decideNavigation({ current, target: 'file:///etc/passwd?retry=1', expected: 'http://127.0.0.1:40001/rs2.cgi' }), 'block');
});
