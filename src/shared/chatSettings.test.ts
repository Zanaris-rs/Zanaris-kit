import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_JOIN_MAX, IGNORE_MAX, readIgnore, sameNames, PASSWORD_MAX, channelProblem, clockTime, isNick, formatAutoJoin, isConnectionWanted, passwordProblem, rankTone, readSettingsDraft, sameSettings } from './chatSettings.ts';
import { DEFAULT_AUTO_JOIN } from './chat.ts';

// ── the form ──────────────────────────────────────────────────────────────

test('a valid form reads as its nick and channels, trimmed', () => {
    assert.deepEqual(readSettingsDraft({ nick: '  Whoosh ', channels: '#2004scape,#LostHQ, #Zanaris' }), {
        ok: true,
        draft: { nick: 'Whoosh', autoJoin: ['#2004scape', '#LostHQ', '#Zanaris'] }
    });
});

test('channels may be separated by commas, spaces or both, and a missing # is added as /join adds it', () => {
    const reading = readSettingsDraft({ nick: 'matt', channels: 'lostcity  #LostHQ,,&local\n#help' });
    assert.ok(reading.ok);
    assert.deepEqual(reading.draft.autoJoin, ['#lostcity', '#LostHQ', '&local', '#help']);
});

test('a channel named twice in different cases is kept once, as first written', () => {
    const reading = readSettingsDraft({ nick: 'matt', channels: '#LostHQ, #losthq, LOSTHQ' });
    assert.ok(reading.ok);
    assert.deepEqual(reading.draft.autoJoin, ['#LostHQ']);
});

test('an empty channel list is allowed: the user may want to join nothing', () => {
    assert.deepEqual(readSettingsDraft({ nick: 'matt', channels: '  , ' }), { ok: true, draft: { nick: 'matt', autoJoin: [] } });
});

test('the nick is required, and refused when IRC would refuse it', () => {
    const field = (nick: string): string | null => {
        const reading = readSettingsDraft({ nick, channels: '' });
        return reading.ok ? null : reading.problem.field;
    };
    assert.equal(field(''), 'nick');
    assert.equal(field('   '), 'nick');
    assert.equal(field('two words'), 'nick');
    assert.equal(field('9lives'), 'nick', 'a digit cannot start a nick');
    assert.equal(field('-dash'), 'nick', 'nor can a hyphen');
    assert.equal(field('x'.repeat(31)), 'nick');
    assert.equal(field('x'.repeat(30)), null);
    assert.equal(field('[Kev]_^{|}-2'), null, 'the specials are all allowed');
});

test('the nick is checked before the channels, the order the form shows them in', () => {
    const reading = readSettingsDraft({ nick: '', channels: `#${'x'.repeat(60)}` });
    assert.equal(reading.ok ? null : reading.problem.field, 'nick');
});

test('a channel name too long, a lone prefix, or a control character is refused', () => {
    const field = (channels: string): string | null => {
        const reading = readSettingsDraft({ nick: 'matt', channels });
        return reading.ok ? null : reading.problem.field;
    };
    assert.equal(field(`#${'x'.repeat(50)}`), 'channels', '51 characters');
    assert.equal(field(`#${'x'.repeat(49)}`), null, '50 characters is the limit, not past it');
    assert.equal(field('#'), 'channels');
    assert.equal(field(`#bell${String.fromCharCode(7)}`), 'channels');
});

test('the stored-profile checks agree with the form', () => {
    assert.equal(isNick('Whoosh'), true);
    assert.equal(isNick('matt\r\nQUIT'), false);
    assert.equal(isNick('x'.repeat(31)), false);
    assert.equal(channelProblem('#LostHQ'), null);
    assert.notEqual(channelProblem('LostHQ'), null, 'a stored name has its prefix already');
    assert.notEqual(channelProblem('#a b'), null);
    assert.notEqual(channelProblem('#a,b'), null);
    assert.notEqual(channelProblem('#bad\nQUIT'), null);
});

test('more channels than the rail allows is refused', () => {
    const many = Array.from({ length: AUTO_JOIN_MAX + 1 }, (_, i) => `#room${i}`).join(',');
    const reading = readSettingsDraft({ nick: 'matt', channels: many });
    assert.equal(reading.ok ? null : reading.problem.field, 'channels');
});

test('the saved list is shown comma separated, and reads back to itself', () => {
    const shown = formatAutoJoin(DEFAULT_AUTO_JOIN);
    assert.equal(shown, '#2004scape, #LostHQ, #Zanaris');
    const reading = readSettingsDraft({ nick: 'matt', channels: shown });
    assert.ok(reading.ok);
    assert.deepEqual(reading.draft.autoJoin, [...DEFAULT_AUTO_JOIN]);
});

test('a password is refused empty, too long, or holding a line break that would start a second IRC command', () => {
    assert.equal(passwordProblem('correct horse battery staple'), null, 'spaces are fine: it is the tail of the line');
    assert.equal(passwordProblem('x'.repeat(PASSWORD_MAX)), null);
    assert.notEqual(passwordProblem(''), null);
    assert.notEqual(passwordProblem('x'.repeat(PASSWORD_MAX + 1)), null);
    assert.notEqual(passwordProblem('hunter2\r\nJOIN #elsewhere'), null);
    assert.notEqual(passwordProblem(`tab${String.fromCharCode(9)}bed`), null);
});

// ── whether there is anything to save ─────────────────────────────────────

test('a draft matching what is saved is not a change, whatever the channel order or case', () => {
    assert.equal(sameSettings({ nick: 'matt', autoJoin: ['#b', '#A'] }, 'matt', ['#a', '#B']), true);
});

test('a different nick, even by case, is a change', () => {
    assert.equal(sameSettings({ nick: 'Matt', autoJoin: [] }, 'matt', []), false);
    assert.equal(sameSettings({ nick: 'matt', autoJoin: [] }, null, []), false);
});

test('a channel added or removed is a change', () => {
    assert.equal(sameSettings({ nick: 'matt', autoJoin: ['#a', '#b'] }, 'matt', ['#a']), false);
    assert.equal(sameSettings({ nick: 'matt', autoJoin: ['#a'] }, 'matt', ['#a', '#b']), false);
    assert.equal(sameSettings({ nick: 'matt', autoJoin: ['#a', '#c'] }, 'matt', ['#a', '#b']), false);
});

test('only offline is a connection to start; reconnecting is one to stop', () => {
    assert.equal(isConnectionWanted('offline'), false);
    for (const status of ['connecting', 'registering', 'online', 'reconnecting'] as const) assert.equal(isConnectionWanted(status), true, status);
});

// ── what the log draws ────────────────────────────────────────────────────

test('a line time is 24-hour local time to the second, zero padded', () => {
    // Built from local fields, so this holds in whatever zone the tests run in.
    assert.equal(clockTime(new Date(2026, 8, 15, 15, 48, 7).getTime()), '15:48:07');
    assert.equal(clockTime(new Date(2026, 0, 1, 0, 0, 0).getTime()), '00:00:00');
    assert.equal(clockTime(new Date(2026, 0, 1, 9, 5, 59, 999).getTime()), '09:05:59', 'milliseconds are dropped, not rounded up');
});

test('ops share the gold, a half-op is between, a voice is green, and anything else is plain', () => {
    assert.equal(rankTone('~'), 'gold');
    assert.equal(rankTone('&'), 'gold');
    assert.equal(rankTone('@'), 'gold');
    assert.equal(rankTone('%'), 'warn');
    assert.equal(rankTone('+'), 'link');
    assert.equal(rankTone(''), 'plain');
    assert.equal(rankTone('!'), 'plain');
});

test('the ignore field reads nicks by comma or space, each once whatever the case', () => {
    assert.deepEqual(readIgnore(' spammer, Bob bob ,, '), { ok: true, ignore: ['spammer', 'Bob'] });
    assert.deepEqual(readIgnore(''), { ok: true, ignore: [] });
});

test('the ignore field refuses a name no one could have, and a list past its rail', () => {
    const bad = readIgnore('fine #channel');
    assert.equal(bad.ok, false);
    const many = Array.from({ length: IGNORE_MAX + 1 }, (_, i) => `n${i}`).join(' ');
    assert.equal(readIgnore(many).ok, false);
});

test('two name lists are the same whatever their order or case', () => {
    assert.equal(sameNames(['Bob', 'alice'], ['ALICE', 'bob']), true);
    assert.equal(sameNames(['bob'], ['bob', 'alice']), false);
    assert.equal(sameNames([], []), true);
});
