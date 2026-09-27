import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNoticeAction, toolNotice, troubleNotice, windowNotice } from './paneNotice.ts';

const ids = (notice: { actions: { id: string }[] }): string[] => notice.actions.map(a => a.id);

test('a crashed game offers a reload first, says it is a fresh login, and can be closed', () => {
    const notice = troubleNotice('game', { kind: 'crashed', reason: 'crashed' });
    assert.equal(notice.title, 'The game stopped');
    assert.match(notice.detail, /fresh login/);
    assert.deepEqual(ids(notice), ['reload', 'close']);
    assert.equal(notice.actions[0]!.label, 'Reload game');
});

test('a hung view offers to wait before it offers to reload', () => {
    assert.deepEqual(ids(troubleNotice('game', { kind: 'unresponsive' })), ['wait', 'reload']);
    assert.deepEqual(ids(troubleNotice('page', { kind: 'unresponsive' })), ['wait', 'reload']);
});

test('a page says nothing about logins, and names itself a page', () => {
    const notice = troubleNotice('page', { kind: 'crashed', reason: 'crashed' });
    assert.equal(notice.title, 'This page stopped');
    assert.doesNotMatch(notice.detail, /login/);
    assert.equal(notice.actions[0]!.label, 'Reload page');
});

test("Electron's reasons become words", () => {
    assert.match(troubleNotice('page', { kind: 'crashed', reason: 'oom' }).detail, /ran out of memory/);
    assert.match(troubleNotice('page', { kind: 'crashed', reason: 'killed' }).detail, /outside the kit/);
    assert.match(troubleNotice('page', { kind: 'crashed', reason: 'abnormal-exit' }).detail, /closed unexpectedly/);
    for (const reason of ['crashed', 'oom', 'killed', 'launch-failed', 'memory-eviction', 'integrity-failure', 'abnormal-exit']) {
        assert.doesNotMatch(troubleNotice('game', { kind: 'crashed', reason }).detail, new RegExp(reason === 'oom' ? '\\boom\\b' : reason), `${reason} is not shown raw`);
    }
});

test('a tool that failed to draw can be opened again or closed', () => {
    const notice = toolNotice('Hiscores');
    assert.equal(notice.title, 'Hiscores stopped working');
    assert.deepEqual(ids(notice), ['retry', 'close']);
});

test('a window that failed to draw offers a reload, and the shell says the game is unharmed', () => {
    assert.deepEqual(ids(windowNotice('shell')), ['reload']);
    assert.match(windowNotice('shell').detail, /game keeps running/);
    assert.doesNotMatch(windowNotice('settings').detail, /game/);
});

test('only the actions main answers arrive over IPC', () => {
    for (const ok of ['reload', 'wait', 'close'] as const) assert.equal(readNoticeAction(ok), ok);
    for (const bad of ['retry', 'crash', '', null, 1, {}]) assert.equal(readNoticeAction(bad), null);
});
