import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ISUPPORT, formatCommand, isChannel, mentions, modeChanges, parseInput, parseLine, readIsupport, stripFormatting } from './protocol.ts';

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

test('a slash command this client has no reading of its own for is one for the server', () => {
    assert.deepEqual(parseInput('/invite bob #LostHQ'), { kind: 'raw', command: 'invite', args: 'bob #LostHQ' });
    assert.deepEqual(parseInput('/away'), { kind: 'raw', command: 'away', args: '' });
    assert.deepEqual(parseInput('/TOPIC #LostHQ :hello there'), { kind: 'raw', command: 'topic', args: '#LostHQ :hello there' }, 'the arguments are the user\'s, colon included');
});

test('/quit is read here, with its reason as the trailing text it will be sent as', () => {
    assert.deepEqual(parseInput('/quit'), { kind: 'quit', reason: '' });
    assert.deepEqual(parseInput('/QUIT gone fishing'), { kind: 'quit', reason: 'gone fishing' });
    assert.deepEqual(parseInput('/quit :gone fishing'), { kind: 'quit', reason: 'gone fishing' }, 'a colon typed out of IRC habit is not part of the reason');
});

test('something that is not a command at all is refused here rather than sent as one', () => {
    assert.deepEqual(parseInput('/'), { kind: 'unknown', command: '' });
    assert.deepEqual(parseInput('/123 go'), { kind: 'unknown', command: '123' });
    assert.deepEqual(parseInput('/!? x'), { kind: 'unknown', command: '!?' });
});

// ── ISUPPORT and modes ────────────────────────────────────────────────────

test('005 PREFIX and CHANMODES replace the defaults, and a line naming neither keeps them', () => {
    const tokens = ['CHANTYPES=#', 'PREFIX=(ov)@+', 'CHANMODES=beI,kfL,lj,psmntirRcOAQKVCuzNSMTGZ', 'NETWORK=SwiftIRC'];
    const read = readIsupport(DEFAULT_ISUPPORT, tokens);
    assert.equal(read.prefixModes, 'ov');
    assert.equal(read.prefixSymbols, '@+');
    assert.deepEqual(read.chanModes, ['beI', 'kfL', 'lj', 'psmntirRcOAQKVCuzNSMTGZ']);
    assert.deepEqual(readIsupport(read, ['AWAYLEN=200', 'SAFELIST']), read, 'a later 005 line with other tokens changes nothing here');
    assert.deepEqual(DEFAULT_ISUPPORT.prefixSymbols, '~&@%+', 'and the defaults were not mutated');
});

test('a PREFIX whose letters and symbols do not pair up is ignored rather than half applied', () => {
    const read = readIsupport(DEFAULT_ISUPPORT, ['PREFIX=(qaohv)@+']);
    assert.equal(read.prefixModes, DEFAULT_ISUPPORT.prefixModes);
    assert.equal(read.prefixSymbols, DEFAULT_ISUPPORT.prefixSymbols);
});

test('rank modes take a nick each, in order, across a mixed + and -', () => {
    assert.deepEqual(modeChanges('+o-v', ['alice', 'bob'], DEFAULT_ISUPPORT), [
        { adding: true, mode: 'o', param: 'alice' },
        { adding: false, mode: 'v', param: 'bob' }
    ]);
});

test('list and always modes take a parameter, a set-only mode takes one only when set, and a flag takes none', () => {
    assert.deepEqual(modeChanges('+nkbl', ['secret', '*!*@bad', '50'], DEFAULT_ISUPPORT), [
        { adding: true, mode: 'n', param: null },
        { adding: true, mode: 'k', param: 'secret' },
        { adding: true, mode: 'b', param: '*!*@bad' },
        { adding: true, mode: 'l', param: '50' }
    ]);
    assert.deepEqual(
        modeChanges('-lo', ['matt'], DEFAULT_ISUPPORT),
        [
            { adding: false, mode: 'l', param: null },
            { adding: false, mode: 'o', param: 'matt' }
        ],
        'removing a limit takes no parameter, so the nick is not swallowed by it'
    );
});

test('a mode line that runs out of parameters gives null rather than shifting', () => {
    assert.deepEqual(modeChanges('+ov', ['alice'], DEFAULT_ISUPPORT), [
        { adding: true, mode: 'o', param: 'alice' },
        { adding: true, mode: 'v', param: null }
    ]);
});

// ── formatting codes ──────────────────────────────────────────────────────

test('bold, colour, italic, underline, reverse and reset codes are stripped, colour numbers with them', () => {
    const c = (code: number): string => String.fromCharCode(code);
    assert.equal(stripFormatting(`${c(3)}04,01Migrating${c(15)} channels, ${c(2)}please${c(2)} join ${c(3)}4#LostCity`), 'Migrating channels, please join #LostCity');
    assert.equal(stripFormatting(`${c(29)}italic${c(29)} ${c(31)}under${c(31)} ${c(22)}rev${c(22)}`), 'italic under rev');
    assert.equal(stripFormatting(`${c(4)}FF0000red${c(4)}`), 'red');
    assert.equal(stripFormatting(`${c(3)}12,5 on 5`), ' on 5', 'a background takes its digits too');
    assert.equal(stripFormatting(`${c(3)}, not a colour`), ', not a colour', 'a comma with no colour before it is text');
    assert.equal(stripFormatting('plain text'), 'plain text');
});
