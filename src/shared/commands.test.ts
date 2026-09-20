import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_FILTERS, ENGINE_COMMANDS, inFilter, matchesQuery, readCommandsFile, typedForm, usage, visibleCommands, type CommandRef } from './commands.ts';

const proc = (name: string, group: string, note: string | null = null): CommandRef => ({ kind: 'debugproc', name, params: [], note, group });
const engineCommand = (name: string): CommandRef => ENGINE_COMMANDS.find(ref => ref.name === name)!;

test('typedForm and usage write a command as the chat box takes it', () => {
    const addxp: CommandRef = {
        kind: 'debugproc',
        name: 'addxp',
        params: [
            { name: 'stat', type: 'stat', optional: false },
            { name: 'amount', type: 'int', optional: false }
        ],
        note: null,
        group: 'cheats'
    };
    assert.equal(typedForm(engineCommand('tele')), '::tele');
    assert.equal(usage(engineCommand('tele')), '::tele <level,mx,mz,lx,lz>');
    assert.equal(usage(engineCommand('give')), '::give <item> [count]');
    assert.equal(usage(engineCommand('minme')), '::minme');
    assert.equal(typedForm(addxp), '::~addxp');
    assert.equal(usage(addxp), '::~addxp <stat> <amount>');
});

test('the engine table lists no command your world can never run', () => {
    const names = ENGINE_COMMANDS.map(ref => ref.name);
    assert.equal(names.length, 21);
    assert.equal(new Set(names).size, names.length);
    const never = ['setvarother', 'getvarother', 'giveother', 'broadcast', 'reboot', 'slowreboot', 'teleother', 'teleto', 'setvis', 'ban', 'mute', 'kick', 'rebuild', 'random', 'track'];
    for (const name of never) assert.ok(!names.includes(name), name);
    for (const ref of ENGINE_COMMANDS) {
        assert.equal(ref.kind, 'engine');
        assert.equal(ref.group, null);
        assert.match(ref.note ?? '', /\.$/, ref.name);
    }
});

test('matchesQuery searches names and notes, and ignores a typed :: or ::~', () => {
    const west = proc('west', 'cheats', 'Direction teleport west');
    assert.equal(matchesQuery(west, ''), true);
    assert.equal(matchesQuery(west, '  '), true);
    assert.equal(matchesQuery(west, 'WES'), true);
    assert.equal(matchesQuery(west, '::~west'), true);
    assert.equal(matchesQuery(west, 'teleport'), true);
    assert.equal(matchesQuery(west, 'east'), false);
    assert.equal(matchesQuery(engineCommand('give'), '::give'), true);
    assert.equal(matchesQuery(proc('bank', 'cheats'), 'teleport'), false);
});

test('inFilter sorts commands into cheats, engine, test scripts and all', () => {
    assert.deepEqual(
        COMMAND_FILTERS.map(f => f.id),
        ['cheats', 'engine', 'scripts', 'all']
    );
    const maxme = proc('maxme', 'cheats');
    const cannon = proc('cannon', 'debug');
    const tele = engineCommand('tele');
    assert.deepEqual([maxme, cannon, tele].map(ref => inFilter(ref, 'cheats')), [true, false, false]);
    assert.deepEqual([maxme, cannon, tele].map(ref => inFilter(ref, 'engine')), [false, false, true]);
    assert.deepEqual([maxme, cannon, tele].map(ref => inFilter(ref, 'scripts')), [false, true, false]);
    assert.deepEqual([maxme, cannon, tele].map(ref => inFilter(ref, 'all')), [true, true, true]);
});

test('visibleCommands lists the procs then the engine commands, and only the engine commands without procs', () => {
    const maxme = proc('maxme', 'cheats');
    const cannon = proc('cannon', 'debug');
    assert.deepEqual(visibleCommands([maxme, cannon], 'cheats', ''), [maxme]);
    assert.deepEqual(visibleCommands([maxme, cannon], 'all', 'cannon'), [cannon]);
    assert.equal(visibleCommands([maxme, cannon], 'all', '').length, 2 + ENGINE_COMMANDS.length);
    assert.deepEqual(visibleCommands(null, 'cheats', ''), [...ENGINE_COMMANDS]);
    assert.deepEqual(visibleCommands(null, 'scripts', 'tele').map(ref => ref.name), ['tele']);
});

test('readCommandsFile takes what the stage script writes and drops what it could not have written', () => {
    const good = { kind: 'debugproc', name: 'maxme', params: [], note: null, group: 'cheats' };
    const west = { ...good, name: 'west', params: [{ type: 'int', name: 'distance' }], note: 'Direction teleport west' };
    const text = JSON.stringify({ version: 1, debugprocs: [good, { ...good, name: 'West!' }, west, { ...good, note: 3 }, { name: 'x' }, 7] });
    assert.deepEqual(readCommandsFile(text), [
        { kind: 'debugproc', name: 'maxme', params: [], note: null, group: 'cheats' },
        { kind: 'debugproc', name: 'west', params: [{ name: 'distance', type: 'int', optional: false }], note: 'Direction teleport west', group: 'cheats' }
    ]);
    assert.equal(readCommandsFile('not json'), null);
    assert.equal(readCommandsFile('null'), null);
    assert.equal(readCommandsFile(JSON.stringify({ version: 2, debugprocs: [] })), null);
    assert.equal(readCommandsFile(JSON.stringify({ version: 1 })), null);
});
