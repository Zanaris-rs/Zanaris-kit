import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_HELP, commandHint, commandMenu, complete, HISTORY_MAX, menuEnter, recall, remember, takeCommand, userActions, type CompletionSources } from './chatInput.ts';

const SOURCES: CompletionSources = { nicks: ['Bob', 'bobby', 'alice', 'mage'], channels: ['#LostHQ', '#2004scape'], commands: ['join', 'me', 'msg', 'query'] };

// ── Tab ───────────────────────────────────────────────────────────────────

test('a nick opening the line is finished as an address', () => {
    const done = complete('al', 2, SOURCES, null);
    assert.equal(done?.text, 'alice: ');
    assert.equal(done?.caret, 7);
});

test('a nick inside a sentence is finished with a space, and the rest of the line kept', () => {
    const done = complete('ask al about it', 6, SOURCES, null);
    assert.equal(done?.text, 'ask alice about it', 'the space already there is used');
    assert.equal(done?.caret, 9);
});

test('matching ignores case, and Tab again moves through the matches in order, back to the first', () => {
    const first = complete('BO', 2, SOURCES, null)!;
    assert.equal(first.text, 'Bob: ');
    const second = complete(first.text, first.caret, SOURCES, first)!;
    assert.equal(second.text, 'bobby: ');
    const third = complete(second.text, second.caret, SOURCES, second)!;
    assert.equal(third.text, 'Bob: ');
});

test('shift-Tab goes the other way', () => {
    const first = complete('bo', 2, SOURCES, null, true)!;
    assert.equal(first.text, 'bobby: ');
    assert.equal(complete(first.text, first.caret, SOURCES, first, true)?.text, 'Bob: ');
});

test('a box changed since the last Tab starts over', () => {
    const first = complete('bo', 2, SOURCES, null)!;
    assert.equal(complete('Bob: al', 7, SOURCES, first)?.text, 'Bob: alice ');
});

test('a command is finished at the start of the line, and a channel anywhere', () => {
    assert.equal(complete('/qu', 3, SOURCES, null)?.text, '/query ');
    assert.equal(complete('join #lo', 8, SOURCES, null)?.text, 'join #LostHQ ');
    assert.equal(complete('#2', 2, SOURCES, null)?.text, '#2004scape ', 'a channel is not an address');
});

test('nothing to finish, or nothing matching, leaves the key alone', () => {
    assert.equal(complete('', 0, SOURCES, null), null);
    assert.equal(complete('hello ', 6, SOURCES, null), null);
    assert.equal(complete('zed', 3, SOURCES, null), null);
});

test('a nick listed twice in different case is offered once', () => {
    const done = complete('ma', 2, { ...SOURCES, nicks: ['mage', 'Mage'] }, null)!;
    assert.deepEqual(done.matches, ['mage']);
});

// ── the command menu ──────────────────────────────────────────────────────

const names = (text: string, caret = text.length): string[] | undefined => commandMenu(text, caret)?.matches.map(c => c.name);

test('a slash alone offers every command, and letters narrow it by name or alias', () => {
    assert.equal(commandMenu('/', 1)?.matches.length, COMMAND_HELP.length);
    assert.deepEqual(names('/jo'), ['join']);
    assert.deepEqual(names('/wi'), ['whois'], 'by alias');
    assert.deepEqual(names('/b'), ['back']);
    assert.deepEqual(names('/DE'), ['deop', 'devoice'], 'in the table order, whatever the case');
});

test('the menu is closed wherever a command is not being typed', () => {
    assert.equal(commandMenu('', 0), null);
    assert.equal(commandMenu('hello', 5), null);
    assert.equal(commandMenu('//me', 4), null, 'a doubled slash is a message');
    assert.equal(commandMenu('/join ', 6), null, 'the space ends the word');
    assert.equal(commandMenu('/join #x', 8), null);
    assert.equal(commandMenu('/joi', 2), null, 'the caret inside the word');
    assert.equal(commandMenu('/zz', 3), null, 'nothing it could be');
    assert.equal(commandMenu('/12', 3), null);
});

test('the usage line follows a command the kit reads, once its space is typed', () => {
    assert.equal(commandHint('/join'), null);
    assert.equal(commandHint('/join ')?.name, 'join');
    assert.equal(commandHint('/j #LostHQ')?.name, 'join');
    assert.equal(commandHint('/mode #x +m'), null, "the server's own commands have none");
    assert.equal(commandHint('hi /join '), null);
});

test('Enter sends a whole command that runs alone, and takes the highlighted one otherwise', () => {
    assert.equal(menuEnter(commandMenu('/clear', 6)!), 'send');
    assert.equal(menuEnter(commandMenu('/back', 5)!), 'send', 'an alias counts');
    assert.equal(menuEnter(commandMenu('/cl', 3)!), 'take');
    assert.equal(menuEnter(commandMenu('/join', 5)!), 'take', 'it needs a channel');
});

test("Enter sends the server's own commands as typed, even where they begin one of the kit's", () => {
    assert.equal(menuEnter(commandMenu('/who', 4)!), 'send', '/who is not /whois');
    assert.equal(menuEnter(commandMenu('/ms', 3)!), 'send', "/ms is services' MemoServ, not /msg");
    assert.equal(menuEnter(commandMenu('/wh', 3)!), 'take');
});

test('taking a command writes its name and a space, and keeps the rest of the line', () => {
    const join = COMMAND_HELP.find(c => c.name === 'join')!;
    assert.deepEqual(takeCommand('/jo', join), { text: '/join ', caret: 6 });
    assert.deepEqual(takeCommand('/j #LostHQ', join), { text: '/join #LostHQ', caret: 6 });
});

// ── the arrows ────────────────────────────────────────────────────────────

test('up brings back the last line sent, then earlier ones, and stops at the oldest', () => {
    const history = ['one', 'two'];
    const a = recall(history, null, 'half-writ', 'up')!;
    assert.equal(a.text, 'two');
    const b = recall(history, a.at, a.text, 'up')!;
    assert.equal(b.text, 'one');
    assert.equal(recall(history, b.at, b.text, 'up'), null);
});

test('down past the newest gives back what was being written', () => {
    const history = ['one', 'two'];
    const a = recall(history, null, 'half-writ', 'up')!;
    const b = recall(history, a.at, a.text, 'up')!;
    const c = recall(history, b.at, b.text, 'down')!;
    assert.equal(c.text, 'two');
    const d = recall(history, c.at, c.text, 'down')!;
    assert.deepEqual(d, { text: 'half-writ', at: null });
    assert.equal(recall(history, null, 'x', 'down'), null, 'nothing below the line being written');
});

test('an empty history has nothing to bring back', () => {
    assert.equal(recall([], null, '', 'up'), null);
});

test('a line sent twice running is kept once, and the history does not grow without bound', () => {
    assert.deepEqual(remember(['a'], 'a'), ['a']);
    assert.deepEqual(remember(['a'], 'b'), ['a', 'b']);
    let long: string[] = [];
    for (let i = 0; i < HISTORY_MAX + 5; i++) long = remember(long, String(i));
    assert.equal(long.length, HISTORY_MAX);
    assert.equal(long[0], '5');
});

// ── a nick's menu ─────────────────────────────────────────────────────────

test('a nick offers a conversation, a mention, a lookup and ignoring them', () => {
    assert.deepEqual(
        userActions('bob', 'mage', []).map(a => a.action),
        ['message', 'mention', 'whois', 'ignore']
    );
    assert.equal(userActions('Bob', 'mage', ['bob']).at(-1)?.action, 'unignore', 'the ignore list is case-insensitive');
});

test('your own name offers only the lookup', () => {
    assert.deepEqual(
        userActions('Mage', 'mage', []).map(a => a.action),
        ['whois']
    );
});
