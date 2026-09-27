import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESS_MS, REDIRECT_PRESS_MS, allowPermission, decideNavigation, decidePageNavigation, decideShellNavigation, isPress, mayOpenBrowser } from './guard.ts';

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

test("the starting page's download is a kit navigation too, and only from a kit page", () => {
    const current = 'file:///app/static/starting.html?state=missing';
    const expected = 'http://127.0.0.1:40001/rs2.cgi?lowmem=1';
    assert.equal(decideNavigation({ current, target: 'file:///app/static/starting.html?download=1', expected }), 'download');
    assert.equal(decideNavigation({ current: 'http://127.0.0.1:40001/rs2.cgi', target: 'file:///app/static/starting.html?download=1', expected }), 'block');
    assert.equal(decideNavigation({ current, target: 'file:///app/static/starting.html?download=yes', expected }), 'block');
    assert.equal(decideNavigation({ current, target: 'file:///app/static/other.html?download=1', expected }), 'block');
});

const SHELL = 'file:///Applications/Zanaris%20Kit.app/Contents/Resources/app.asar/out/renderer/index.html';
const DEV_SHELL = 'http://localhost:5173/';

test("a kit page may reload itself, which is how Vite's full reload reaches it in development", () => {
    assert.equal(decideShellNavigation({ current: SHELL, target: SHELL }), 'allow');
    assert.equal(decideShellNavigation({ current: DEV_SHELL, target: DEV_SHELL }), 'allow');
    assert.equal(decideShellNavigation({ current: `${DEV_SHELL}#settings`, target: `${DEV_SHELL}#settings` }), 'allow');
});

test('a kit page may go nowhere else, however close to home', () => {
    const refused: [current: string, target: string][] = [
        [SHELL, 'https://example.com/'],
        [SHELL, `${SHELL}?x=1`],
        [SHELL, SHELL.replace('index.html', 'other.html')],
        [SHELL, 'file:///etc/passwd'],
        [SHELL, 'javascript:alert(1)'],
        [DEV_SHELL, 'http://localhost:5173/other'],
        [DEV_SHELL, 'http://localhost:5174/'],
        [`${DEV_SHELL}#settings`, DEV_SHELL]
    ];
    for (const [current, target] of refused) {
        assert.equal(decideShellNavigation({ current, target }), 'block', `${current} → ${target}`);
    }
});

test('a game may go full screen and copy to the clipboard, and have nothing else', () => {
    assert.equal(allowPermission('fullscreen', 'game'), true);
    assert.equal(allowPermission('clipboard-sanitized-write', 'game'), true);
    for (const permission of ['openExternal', 'clipboard-read', 'notifications', 'geolocation', 'media', 'pointerLock', 'midiSysex', 'hid', 'serial', 'usb', 'unknown']) {
        assert.equal(allowPermission(permission, 'game'), false, permission);
    }
});

test('a reference page gets no permission at all', () => {
    for (const permission of ['clipboard-sanitized-write', 'openExternal', 'clipboard-read', 'notifications', 'fullscreen']) {
        assert.equal(allowPermission(permission, 'page'), false, permission);
    }
});

test('a link reaches the browser only as the answer to a press', () => {
    for (const via of ['window-open', 'navigate'] as const) {
        assert.equal(mayOpenBrowser({ via, mainFrame: true, sincePress: 150 }), true, `${via} just after a click`);
        assert.equal(mayOpenBrowser({ via, mainFrame: true, sincePress: PRESS_MS + 1 }), false, `${via} long after one`);
        assert.equal(mayOpenBrowser({ via, mainFrame: true, sincePress: Infinity }), false, `${via} with no press at all`);
    }
    assert.equal(mayOpenBrowser({ via: 'window-open', mainFrame: false, sincePress: 150 }), true, 'a frame the player clicked in may open one');
});

test("a redirect has longer to arrive, and a frame's never opens the browser", () => {
    assert.equal(mayOpenBrowser({ via: 'redirect', mainFrame: true, sincePress: 4_000 }), true);
    assert.equal(mayOpenBrowser({ via: 'redirect', mainFrame: true, sincePress: REDIRECT_PRESS_MS + 1 }), false);
    assert.equal(mayOpenBrowser({ via: 'redirect', mainFrame: false, sincePress: 10 }), false, "an ad's frame redirecting, however soon after a click");
});

test('presses are clicks, keys and taps, never movement or scrolling', () => {
    for (const type of ['mouseDown', 'mouseUp', 'rawKeyDown', 'keyDown', 'char', 'gestureTap', 'touchEnd']) assert.equal(isPress(type), true, type);
    for (const type of ['mouseMove', 'mouseEnter', 'mouseLeave', 'mouseWheel', 'keyUp', 'gestureScrollUpdate', 'touchMove']) assert.equal(isPress(type), false, type);
});
