import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCommand, isChannel, mentions, parseInput, parseLine } from './protocol.ts';

// ── parseLine ─────────────────────────────────────────────────────────────

test('a user prefix yields the nick before the bang', () => {
    const msg = parseLine(':matt!~m@user/matt PRIVMSG #04scape :hello world');
    assert.deepEqual(msg, {
        prefix: 'matt!~m@user/matt',
        nick: 'matt',
        command: 'PRIVMSG',
        params: ['#04scape', 'hello world']
    });
});

test('a server prefix has no nick', () => {
    const msg = parseLine(':irc.libera.chat 001 matt :Welcome to Libera.Chat');
    assert.equal(msg?.prefix, 'irc.libera.chat');
    assert.equal(msg?.nick, null);
    assert.equal(msg?.command, '001');
    assert.deepEqual(msg?.params, ['matt', 'Welcome to Libera.Chat']);
});

test('a bare-word prefix is read as a nick, since some servers send only that', () => {
    assert.equal(parseLine(':matt NICK matthew')?.nick, 'matt');
});

test('a line with no prefix parses', () => {
    assert.deepEqual(parseLine('PING :LAG1234567'), { prefix: null, nick: null, command: 'PING', params: ['LAG1234567'] });
});

test('the command is uppercased', () => {
    assert.equal(parseLine(':a!b@c privmsg #c :hi')?.command, 'PRIVMSG');
});

test('the trailing param keeps its spaces and colons', () => {
    assert.deepEqual(parseLine(':a!b@c PRIVMSG #c :look: a colon, and  two  spaces')?.params, [
        '#c',
        'look: a colon, and  two  spaces'
    ]);
});

test('an empty trailing param is still a param', () => {
    assert.deepEqual(parseLine(':a!b@c PRIVMSG #c :')?.params, ['#c', '']);
});

test('middle params come through in order', () => {
    assert.deepEqual(parseLine(':srv 353 matt = #c :matt @op +voice')?.params, ['matt', '=', '#c', 'matt @op +voice']);
});

test('a command with no params parses', () => {
    assert.deepEqual(parseLine(':matt!m@h QUIT')?.params, []);
});

test('blank, whitespace and truncated lines are null rather than a throw', () => {
    assert.equal(parseLine(''), null);
    assert.equal(parseLine('   '), null);
    assert.equal(parseLine(':'), null);
    assert.equal(parseLine(':irc.libera.chat'), null, 'a prefix with no command');
    assert.equal(parseLine(':a!b@c ?!? #c'), null, 'a command that is neither a word nor a numeric');
});

// ── formatCommand ─────────────────────────────────────────────────────────

test('a plain param needs no colon', () => {
    assert.equal(formatCommand('NICK', ['matt']), 'NICK matt');
    assert.equal(formatCommand('JOIN', ['#04scape']), 'JOIN #04scape');
});

test('a last param with a space is marked trailing, and round trips', () => {
    const line = formatCommand('PRIVMSG', ['#c', 'hello world']);
    assert.equal(line, 'PRIVMSG #c :hello world');
    assert.deepEqual(parseLine(line)?.params, ['#c', 'hello world']);
});

test('an empty or colon-leading last param is marked trailing, and round trips', () => {
    assert.equal(formatCommand('PRIVMSG', ['#c', '']), 'PRIVMSG #c :');
    assert.deepEqual(parseLine(formatCommand('PRIVMSG', ['#c', '']))?.params, ['#c', '']);
    assert.equal(formatCommand('PRIVMSG', ['#c', ':wq']), 'PRIVMSG #c ::wq');
    assert.deepEqual(parseLine(formatCommand('PRIVMSG', ['#c', ':wq']))?.params, ['#c', ':wq']);
});

test('formatCommand carries no line ending and uppercases the command', () => {
    const line = formatCommand('privmsg', ['#c', 'hi']);
    assert.equal(line, 'PRIVMSG #c hi');
    assert.ok(!line.includes('\r') && !line.includes('\n'));
});

test('a command with no params is just the command', () => {
    assert.equal(formatCommand('QUIT', []), 'QUIT');
});

// ── isChannel and mentions ────────────────────────────────────────────────

test('isChannel knows the two prefixes', () => {
    assert.equal(isChannel('#04scape'), true);
    assert.equal(isChannel('&local'), true);
    assert.equal(isChannel('matt'), false);
    assert.equal(isChannel(''), false);
});

test('mentions is a case-insensitive whole-word test', () => {
    assert.equal(mentions('matt: hi', 'matt'), true);
    assert.equal(mentions('hey Matt', 'matt'), true);
    assert.equal(mentions('hey matt, look at this', 'Matt'), true);
    assert.equal(mentions('matt', 'matt'), true);
    assert.equal(mentions('mattress', 'matt'), false);
    assert.equal(mentions('domatt', 'matt'), false);
    assert.equal(mentions('a mattress for matt', 'matt'), true, 'a later whole word still counts');
    assert.equal(mentions('anything', ''), false);
});

test('mentions handles the punctuation IRC allows in a nick', () => {
    assert.equal(mentions('hi |matt|', '|matt|'), true);
    assert.equal(mentions('nothing here', 'a[b]'), false);
});

// ── parseInput ────────────────────────────────────────────────────────────

test('an empty or blank input is nothing to do', () => {
    assert.equal(parseInput(''), null);
    assert.equal(parseInput('    '), null);
});

test('plain text is a say', () => {
    assert.deepEqual(parseInput('hello world'), { kind: 'say', text: 'hello world' });
});

test('a doubled slash is a literal message starting with one slash', () => {
    assert.deepEqual(parseInput('//me is not an action'), { kind: 'say', text: '/me is not an action' });
});

test('/me is an action', () => {
    assert.deepEqual(parseInput('/me waves at the lobby'), { kind: 'action', text: 'waves at the lobby' });
    assert.deepEqual(parseInput('/ME shouts'), { kind: 'action', text: 'shouts' }, 'commands are case-insensitive');
    assert.equal(parseInput('/me   '), null, 'an action with nothing to act out');
});

test('/msg takes a target and the rest of the line', () => {
    assert.deepEqual(parseInput('/msg bob hi there, bob'), { kind: 'msg', target: 'bob', text: 'hi there, bob' });
    assert.equal(parseInput('/msg bob'), null, 'no message to send');
    assert.equal(parseInput('/msg'), null, 'no target');
});

test('/nick takes a nick', () => {
    assert.deepEqual(parseInput('/nick matthew'), { kind: 'nick', nick: 'matthew' });
    assert.equal(parseInput('/nick'), null);
});

test('/join takes a channel and adds the missing hash', () => {
    assert.deepEqual(parseInput('/join #04scape'), { kind: 'join', channel: '#04scape' });
    assert.deepEqual(parseInput('/join 04scape'), { kind: 'join', channel: '#04scape' });
    assert.deepEqual(parseInput('/join &local'), { kind: 'join', channel: '&local' });
    assert.equal(parseInput('/join'), null);
});

test('/part may name a channel or leave it to the client', () => {
    assert.deepEqual(parseInput('/part #04scape'), { kind: 'part', channel: '#04scape' });
    assert.deepEqual(parseInput('/part'), { kind: 'part', channel: '' }, 'the caller parts the active channel');
});

test('an unrecognised slash command reports itself rather than going on the wire', () => {
    assert.deepEqual(parseInput('/quit now'), { kind: 'unknown', command: 'quit' });
    assert.deepEqual(parseInput('/'), { kind: 'unknown', command: '' });
});
