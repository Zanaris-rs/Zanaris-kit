import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideNavigation, decidePageNavigation } from './guard.ts';

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

// ── reference pages, which browse rather than sit still ────────────────────

const HOSTS = ['2004.losthq.rs', 'tools.losthq.rs', 'razgals.github.io', '127.0.0.1:8888'];
const page = (target: string, hosts: readonly string[] = HOSTS): ReturnType<typeof decidePageNavigation> => decidePageNavigation({ target, hosts });

test("a reference page browses freely inside its server's allowlist", () => {
    assert.equal(page('https://2004.losthq.rs/?p=itemdb'), 'allow');
    assert.equal(page('https://tools.losthq.rs/map/'), 'allow', 'including the redirect the map answers with');
    assert.equal(page('https://razgals.github.io/Clue-Puzzle-Solver-Standalone/'), 'allow');
    assert.equal(page('HTTPS://2004.LOSTHQ.RS/?p=itemdb'), 'allow', 'hosts are case-insensitive');
});

test('anything off the allowlist goes to the system browser rather than into the pane', () => {
    assert.equal(page('https://discord.gg/somewhere'), 'open-external');
    assert.equal(page('https://losthq.rs/'), 'open-external', 'the bare domain is not the subdomain that was allowed');
    assert.equal(page('https://evil.losthq.rs/'), 'open-external', 'and no subdomain is implied by another');
    assert.equal(page('http://127.0.0.1:9999/'), 'open-external', 'the port is part of the host');
});

test('a page may not navigate to anything that is not the web', () => {
    for (const target of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'chrome://settings', 'not a url']) {
        assert.equal(page(target), 'block', target);
    }
});

test('an empty allowlist sends everything to the browser, and nothing to the pane', () => {
    assert.equal(page('https://2004.losthq.rs/', []), 'open-external');
});
