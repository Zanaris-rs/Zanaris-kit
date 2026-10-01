import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pingTitle, pingWords } from './chatPing.ts';
import { SERVER_LOG, type ChatLine, type ChatPing } from './chat.ts';

function ping(line: Partial<ChatLine>, more = 0, isPrivate = false): ChatPing {
    return { line: { id: 1, channel: '#LostHQ', kind: 'say', nick: 'bob', text: 'mage: look', at: 0, highlight: true, ...line }, private: isPrivate, more };
}

test('a line naming you in a room reads as the chat log reads it', () => {
    assert.equal(pingWords(ping({})), 'bob: mage: look');
});

test('a line said to you alone says so', () => {
    assert.equal(pingWords(ping({ channel: 'bob', text: 'psst' }, 0, true)), 'bob (private): psst');
});

test('an action reads as the log reads one, private or not', () => {
    assert.equal(pingWords(ping({ kind: 'action', text: 'waves at mage' })), '* bob waves at mage');
    assert.equal(pingWords(ping({ channel: 'bob', kind: 'action', text: 'waves' }, 0, true)), '* bob waves (private)');
});

test('a line with nobody behind it is its text alone', () => {
    assert.equal(pingWords(ping({ nick: null, kind: 'system', text: 'you were kicked by zed' })), 'you were kicked by zed');
});

test('the title adds where it was said, how many more are waiting, and what a click does', () => {
    assert.equal(pingTitle(ping({}, 2)), 'bob: mage: look\nin #LostHQ, and 2 more for you\nClick to open chat');
    assert.equal(pingTitle(ping({ channel: SERVER_LOG, nick: null, kind: 'system', text: '-NickServ- hi mage' })), '-NickServ- hi mage\nin Status\nClick to open chat');
});

test('a private line needs no room in its title, since its words already say whose it is', () => {
    assert.equal(pingTitle(ping({ channel: 'bob', text: 'psst' }, 1, true)), 'bob (private): psst\n1 more for you\nClick to open chat');
});
