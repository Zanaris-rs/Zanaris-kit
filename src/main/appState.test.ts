import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppState } from './appState.ts';
import { DEFAULT_CHAT } from '../shared/chat.ts';

const dirs: string[] = [];
const tempFile = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'zanaris-kit-state-'));
    dirs.push(dir);
    return join(dir, 'state.json');
};
afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const REMEMBERED = { world: 7, detail: 'high' as const, url: 'https://w7-2004.lostcity.rs/rs2.cgi?plugin=0&world=7&lowmem=0' };

test('starts empty when there is no file', () => {
    const state = new AppState(tempFile());
    state.load();
    assert.equal(state.world('lostcity'), null);
});

test('setWorld saves, and a fresh instance reads it back', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    a.setWorld('lostcity', REMEMBERED);
    const b = new AppState(file);
    b.load();
    assert.deepEqual(b.world('lostcity'), REMEMBERED);
    assert.equal(b.world('zanaris'), null);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 1);
});

test('a broken file is kept aside and the state starts empty, without complaint', () => {
    const file = tempFile();
    writeFileSync(file, '{ nope');
    const state = new AppState(file);
    state.load();
    assert.equal(state.world('lostcity'), null);
    assert.ok(readdirSync(join(file, '..')).some(n => n.startsWith('state.json.broken-')));
});

test('an invalid entry is ignored while the rest load', () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ version: 1, worlds: { lostcity: REMEMBERED, zanaris: { world: 1, detail: 'ultra', url: 'https://x' }, labs: { world: 'x' } } }));
    const state = new AppState(file);
    state.load();
    assert.deepEqual(state.world('lostcity'), REMEMBERED);
    assert.equal(state.world('zanaris'), null);
    assert.equal(state.world('labs'), null);
});

test('warnOnSwitch is on until it is turned off', () => {
    const state = new AppState(tempFile());
    state.load();
    assert.equal(state.warnOnSwitch(), true);
});

test('a file written before the preference existed still loads, warning on', () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ version: 1, worlds: { lostcity: REMEMBERED } }));
    const state = new AppState(file);
    state.load();
    assert.equal(state.warnOnSwitch(), true);
    assert.deepEqual(state.world('lostcity'), REMEMBERED);
});

test('setWarnOnSwitch saves, and a fresh instance reads it back', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    a.setWarnOnSwitch(false);
    assert.equal(a.warnOnSwitch(), false);
    const b = new AppState(file);
    b.load();
    assert.equal(b.warnOnSwitch(), false);
    const written = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(written.version, 1);
    assert.equal(written.warnOnSwitch, false);
});

test('a non-boolean preference is ignored, like an invalid world entry', () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ version: 1, worlds: { lostcity: REMEMBERED }, warnOnSwitch: 'no' }));
    const state = new AppState(file);
    state.load();
    assert.equal(state.warnOnSwitch(), true);
    assert.deepEqual(state.world('lostcity'), REMEMBERED);
    assert.equal(readdirSync(join(file, '..')).some(n => n.startsWith('state.json.broken-')), false);
});

test('setWarnOnSwitch leaves the remembered worlds alone', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    a.setWorld('lostcity', REMEMBERED);
    a.setWarnOnSwitch(false);
    const b = new AppState(file);
    b.load();
    assert.deepEqual(b.world('lostcity'), REMEMBERED);
    assert.equal(b.warnOnSwitch(), false);
});

test('chat starts at the default settings when there is no file', () => {
    const state = new AppState(tempFile());
    state.load();
    assert.deepEqual(state.chat(), DEFAULT_CHAT);
});

test('a file written before chat existed still loads, at the chat defaults', () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ version: 1, worlds: { lostcity: REMEMBERED }, warnOnSwitch: false }));
    const state = new AppState(file);
    state.load();
    assert.deepEqual(state.chat(), DEFAULT_CHAT);
    assert.deepEqual(state.world('lostcity'), REMEMBERED);
    assert.equal(state.warnOnSwitch(), false);
});

test('setChat saves, and a fresh instance reads it back', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    a.setChat({ nick: 'lumbridge', server: 'irc.example.net', port: 6667 });
    const b = new AppState(file);
    b.load();
    assert.deepEqual(b.chat(), { ...DEFAULT_CHAT, nick: 'lumbridge', server: 'irc.example.net', port: 6667 });
    const written = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(written.version, 1);
    assert.deepEqual(written.chat, { ...DEFAULT_CHAT, nick: 'lumbridge', server: 'irc.example.net', port: 6667 });
});

test('a partial patch leaves the other fields alone', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    a.setChat({ nick: 'lumbridge' });
    assert.deepEqual(a.chat(), { ...DEFAULT_CHAT, nick: 'lumbridge' });
    a.setChat({ port: 6667 });
    assert.deepEqual(a.chat(), { ...DEFAULT_CHAT, nick: 'lumbridge', port: 6667 });
});

test('each invalid chat field falls back on its own, keeping the valid ones', () => {
    const cases: Array<[unknown, keyof typeof DEFAULT_CHAT]> = [
        [{ nick: '', server: 'irc.example.net', port: 6667 }, 'nick'],
        [{ nick: 7, server: 'irc.example.net', port: 6667 }, 'nick'],
        [{ nick: 'lumbridge', server: '', port: 6667 }, 'server'],
        [{ nick: 'lumbridge', server: null, port: 6667 }, 'server'],
        [{ nick: 'lumbridge', server: 'irc.example.net', port: 0 }, 'port'],
        [{ nick: 'lumbridge', server: 'irc.example.net', port: 65536 }, 'port'],
        [{ nick: 'lumbridge', server: 'irc.example.net', port: 6667.5 }, 'port'],
        [{ nick: 'lumbridge', server: 'irc.example.net', port: '6667' }, 'port']
    ];
    for (const [chat, bad] of cases) {
        const file = tempFile();
        writeFileSync(file, JSON.stringify({ version: 1, worlds: { lostcity: REMEMBERED }, chat }));
        const state = new AppState(file);
        state.load();
        const stored = chat as Record<string, unknown>;
        const expected = { ...DEFAULT_CHAT, nick: stored.nick, server: stored.server, port: stored.port, [bad]: DEFAULT_CHAT[bad] };
        assert.deepEqual(state.chat(), expected, `expected only ${bad} to fall back`);
        assert.deepEqual(state.world('lostcity'), REMEMBERED);
        assert.equal(readdirSync(join(file, '..')).some(n => n.startsWith('state.json.broken-')), false);
    }
});

test('a chat block that is not an object falls back whole', () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ version: 1, worlds: { lostcity: REMEMBERED }, chat: 'irc.example.net' }));
    const state = new AppState(file);
    state.load();
    assert.deepEqual(state.chat(), DEFAULT_CHAT);
    assert.deepEqual(state.world('lostcity'), REMEMBERED);
    assert.equal(readdirSync(join(file, '..')).some(n => n.startsWith('state.json.broken-')), false);
});

test('setChat leaves the remembered worlds and the warning alone', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    a.setWorld('lostcity', REMEMBERED);
    a.setWarnOnSwitch(false);
    a.setChat({ nick: 'lumbridge' });
    const b = new AppState(file);
    b.load();
    assert.deepEqual(b.world('lostcity'), REMEMBERED);
    assert.equal(b.warnOnSwitch(), false);
    assert.deepEqual(b.chat(), { ...DEFAULT_CHAT, nick: 'lumbridge' });
});

test('a stored auto-join list round-trips, an empty one stays empty, and a file with no list gets the defaults', () => {
    const file = tempFile();
    const chat = { nick: 'lumbridge', server: 'irc.example.net', port: 6667, autoJoin: ['#rscape', '#help'] };
    writeFileSync(file, JSON.stringify({ version: 1, worlds: { lostcity: REMEMBERED }, chat }));
    const state = new AppState(file);
    state.load();
    assert.deepEqual(state.chat().autoJoin, ['#rscape', '#help']);

    const cleared = tempFile();
    writeFileSync(cleared, JSON.stringify({ version: 1, worlds: {}, chat: { ...chat, autoJoin: [] } }));
    const emptied = new AppState(cleared);
    emptied.load();
    assert.deepEqual(emptied.chat().autoJoin, [], 'the user cleared the list, and that is kept');

    const older = tempFile();
    writeFileSync(older, JSON.stringify({ version: 1, worlds: { lostcity: REMEMBERED }, chat: { nick: 'lumbridge', server: 'irc.example.net', port: 6667, rooms: ['#old'] } }));
    const beforeList = new AppState(older);
    beforeList.load();
    assert.deepEqual(beforeList.chat().autoJoin, ['#2004scape', '#LostHQ', '#Zanaris'], 'no autoJoin key at all is the defaults, and the old rooms key is not read');
});

test('an auto-join value that is not an array falls back to the defaults, and a bad entry loses only itself', () => {
    const cases: Array<[unknown, string[]]> = [
        ['#rscape', ['#2004scape', '#LostHQ', '#Zanaris']], // a single string is not an array of them
        [42, ['#2004scape', '#LostHQ', '#Zanaris']],
        [['#rscape', 'not-a-channel', '#help'], ['#rscape', '#help']], // missing the # or & prefix
        [['#rscape', '', '#help'], ['#rscape', '#help']],
        [['#rscape', '#', '#help'], ['#rscape', '#help']], // a prefix is not a name
        [['#rscape', 7, '#help'], ['#rscape', '#help']]
    ];
    for (const [autoJoin, expected] of cases) {
        const file = tempFile();
        writeFileSync(file, JSON.stringify({ version: 1, worlds: { lostcity: REMEMBERED }, chat: { nick: 'lumbridge', autoJoin } }));
        const state = new AppState(file);
        state.load();
        assert.deepEqual(state.chat().autoJoin, expected, `expected ${JSON.stringify(autoJoin)} to become ${JSON.stringify(expected)}`);
        assert.equal(state.chat().nick, 'lumbridge');
        assert.deepEqual(state.world('lostcity'), REMEMBERED);
        assert.equal(readdirSync(join(file, '..')).some(n => n.startsWith('state.json.broken-')), false);
    }
});

test('a stored nick or channel that IRC would refuse, or that could smuggle a second command, is not read', () => {
    const file = tempFile();
    writeFileSync(
        file,
        JSON.stringify({ version: 1, worlds: {}, chat: { nick: 'matt\r\nJOIN #elsewhere', autoJoin: ['#ok', '#bad\r\nQUIT', '#two words', '#fine'] } })
    );
    const state = new AppState(file);
    state.load();
    assert.equal(state.chat().nick, null);
    assert.deepEqual(state.chat().autoJoin, ['#ok', '#fine']);
});

test('an auto-join name past the length cap is dropped, and entries past the count cap are too', () => {
    const file = tempFile();
    const atMax = `#${'x'.repeat(49)}`;
    const overMax = `#${'x'.repeat(50)}`;
    const many = Array.from({ length: 25 }, (_, i) => `#room${i}`);
    writeFileSync(file, JSON.stringify({ version: 1, worlds: {}, chat: { autoJoin: [overMax, atMax, ...many] } }));
    const state = new AppState(file);
    state.load();
    assert.deepEqual(state.chat().autoJoin, [atMax, ...many.slice(0, 19)]);
});

test('autoConnect defaults on, round-trips off, and ignores anything not a boolean', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    assert.equal(a.chat().autoConnect, true);
    a.setChat({ autoConnect: false });
    const b = new AppState(file);
    b.load();
    assert.equal(b.chat().autoConnect, false);

    writeFileSync(file, JSON.stringify({ version: 1, worlds: {}, chat: { autoConnect: 'no' } }));
    const c = new AppState(file);
    c.load();
    assert.equal(c.chat().autoConnect, true);
});

test('setChat with an auto-join list saves a copy, and a fresh instance reads it back', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    const list = ['#rscape'];
    a.setChat({ autoJoin: list });
    list.push('#later');
    assert.deepEqual(a.chat().autoJoin, ['#rscape'], 'the caller\'s array is not held');
    const b = new AppState(file);
    b.load();
    assert.deepEqual(b.chat(), { ...DEFAULT_CHAT, autoJoin: ['#rscape'] });
});

test('a sealed NickServ password is kept in the chat block, read back, and forgotten with null', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    assert.equal(a.sealedNickserv(), null);
    a.setChat({ nick: 'lumbridge' });
    assert.equal('nickserv' in JSON.parse(readFileSync(file, 'utf8')).chat, false, 'no key at all when there is nothing to keep');

    a.setNickservSealed('c2VhbGVk');
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).chat.nickserv, 'c2VhbGVk');
    const b = new AppState(file);
    b.load();
    assert.equal(b.sealedNickserv(), 'c2VhbGVk');
    assert.deepEqual(b.chat(), { ...DEFAULT_CHAT, nick: 'lumbridge' }, 'and it is not one of the chat settings');

    b.setNickservSealed(null);
    const c = new AppState(file);
    c.load();
    assert.equal(c.sealedNickserv(), null);
});

test('a sealed password that is not a string, or absurdly long, is not kept', () => {
    for (const nickserv of [42, '', 'x'.repeat(5000), null]) {
        const file = tempFile();
        writeFileSync(file, JSON.stringify({ version: 1, worlds: {}, chat: { nick: 'lumbridge', nickserv } }));
        const state = new AppState(file);
        state.load();
        assert.equal(state.sealedNickserv(), null, JSON.stringify(nickserv).slice(0, 20));
        assert.equal(state.chat().nick, 'lumbridge');
    }
});

test('stageChat applies in memory and writes nothing until save is called', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    a.setChat({ nick: 'lumbridge' });
    a.stageChat({ autoJoin: ['#rscape'] });
    assert.deepEqual(a.chat().autoJoin, ['#rscape'], 'the staged value is live in memory at once');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).chat.autoJoin, [...DEFAULT_CHAT.autoJoin], 'and nothing has been written yet');
    a.save();
    const b = new AppState(file);
    b.load();
    assert.deepEqual(b.chat(), { ...DEFAULT_CHAT, nick: 'lumbridge', autoJoin: ['#rscape'] }, 'the save writes the staged value alongside everything else');
});

test('single-player cheats are off by default, persist, and survive a file without the key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'state-'));
    const file = join(dir, 'state.json');
    const state = new AppState(file);
    state.load();
    assert.equal(state.singlePlayerCheats(), false);
    state.setSinglePlayerCheats(true);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).singlePlayer.cheats, true);
    const again = new AppState(file);
    again.load();
    assert.equal(again.singlePlayerCheats(), true);
    writeFileSync(file, JSON.stringify({ version: 1, worlds: {}, warnOnSwitch: true }));
    const older = new AppState(file);
    older.load();
    assert.equal(older.singlePlayerCheats(), false);
    writeFileSync(file, JSON.stringify({ version: 1, worlds: {}, singlePlayer: { cheats: 'yes' } }));
    const odd = new AppState(file);
    odd.load();
    assert.equal(odd.singlePlayerCheats(), false);
});

test('a stored hiscores block round-trips', () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ version: 1, worlds: { lostcity: REMEMBERED }, hiscores: { lostcity: 'granny_grunt', zanaris: 'knight' } }));
    const state = new AppState(file);
    state.load();
    assert.equal(state.hiscoresName('lostcity'), 'granny_grunt');
    assert.equal(state.hiscoresName('zanaris'), 'knight');
    assert.equal(state.hiscoresName('labs'), null);
});

test('a missing, non-object, or invalid hiscores block leaves an empty map, and the remembered worlds and chat settings intact', () => {
    const cases: unknown[] = [undefined, 'granny_grunt', { lostcity: 42 }];
    for (const hiscores of cases) {
        const file = tempFile();
        const data: Record<string, unknown> = { version: 1, worlds: { lostcity: REMEMBERED }, chat: { nick: 'lumbridge', server: 'irc.example.net', port: 6667 } };
        if (hiscores !== undefined) data.hiscores = hiscores;
        writeFileSync(file, JSON.stringify(data));
        const state = new AppState(file);
        state.load();
        assert.equal(state.hiscoresName('lostcity'), null, `expected ${JSON.stringify(hiscores)} to leave an empty map`);
        assert.deepEqual(state.world('lostcity'), REMEMBERED, `expected ${JSON.stringify(hiscores)} to leave the remembered worlds alone`);
        assert.deepEqual(state.chat(), { ...DEFAULT_CHAT, nick: 'lumbridge', server: 'irc.example.net', port: 6667 }, `expected ${JSON.stringify(hiscores)} to leave chat alone`);
        assert.equal(readdirSync(join(file, '..')).some(n => n.startsWith('state.json.broken-')), false, `expected ${JSON.stringify(hiscores)} not to be treated as a broken file`);
    }
});

test('an over-long name is rejected, leaving other entries alone', () => {
    const file = tempFile();
    const atMax = 'x'.repeat(30);
    const overMax = 'x'.repeat(31);
    writeFileSync(file, JSON.stringify({ version: 1, worlds: {}, hiscores: { lostcity: overMax, zanaris: atMax } }));
    const state = new AppState(file);
    state.load();
    assert.equal(state.hiscoresName('lostcity'), null, 'a name past the cap is rejected');
    assert.equal(state.hiscoresName('zanaris'), atMax, 'a name at the cap is kept');
});

test('setHiscoresName saves, and a fresh instance reads it back', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    a.setHiscoresName('lostcity', 'granny_grunt');
    const b = new AppState(file);
    b.load();
    assert.equal(b.hiscoresName('lostcity'), 'granny_grunt');
    assert.equal(b.hiscoresName('zanaris'), null);
    const written = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(written.version, 1);
    assert.deepEqual(written.hiscores, { lostcity: 'granny_grunt' });
});

test('setHiscoresName leaves the remembered worlds and chat settings alone', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    a.setWorld('lostcity', REMEMBERED);
    a.setChat({ nick: 'lumbridge' });
    a.setHiscoresName('lostcity', 'granny_grunt');
    const b = new AppState(file);
    b.load();
    assert.deepEqual(b.world('lostcity'), REMEMBERED);
    assert.deepEqual(b.chat(), { ...DEFAULT_CHAT, nick: 'lumbridge' });
    assert.equal(b.hiscoresName('lostcity'), 'granny_grunt');
});

// ── the reference pane's width ─────────────────────────────────────────────

// ── always on top ──────────────────────────────────────────────────────────

test('always on top is off until asked for, and survives a round trip', () => {
    const file = tempFile();
    const state = new AppState(file);
    state.load();
    assert.equal(state.alwaysOnTop(), false, 'a window that floats over everything is not a default');

    state.setAlwaysOnTop(true);
    const again = new AppState(file);
    again.load();
    assert.equal(again.alwaysOnTop(), true);
});

test('a junk always-on-top costs only itself, not the rest of the file', () => {
    const file = tempFile();
    const state = new AppState(file);
    state.load();
    state.setWarnOnSwitch(false);
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), alwaysOnTop: 'yes' }));

    const again = new AppState(file);
    again.load();
    assert.equal(again.alwaysOnTop(), false);
    assert.equal(again.warnOnSwitch(), false, 'the rest of the file still read');
});

// ── timers ────────────────────────────────────────────────────────────────

const MINE = { id: 'custom-0badf00d', name: 'Herb run', kind: 'countdown' as const, durationMs: 4_800_000, thresholdMs: 60_000, volume: 1, afk: false };

test('timers start empty, and survive a round trip', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    assert.deepEqual(a.timers(), { custom: [], edits: {} });
    a.setTimers({ custom: [MINE], edits: { afk: { thresholdMs: 20_000 } } });
    const b = new AppState(file);
    b.load();
    assert.deepEqual(b.timers(), { custom: [MINE], edits: { afk: { thresholdMs: 20_000 } } });
});

test('timers() hands out a copy, so a caller cannot change the stored state', () => {
    const state = new AppState(tempFile());
    state.load();
    state.setTimers({ custom: [MINE], edits: {} });
    state.timers().custom[0]!.name = 'mutated';
    assert.equal(state.timers().custom[0]!.name, 'Herb run');
});

test('one bad custom clock costs only itself, and a file without timers keeps its worlds', () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ version: 1, worlds: { lostcity: REMEMBERED }, timers: { custom: [MINE, { id: 'custom-x' }], edits: { afk: 'loud' } } }));
    const a = new AppState(file);
    a.load();
    assert.deepEqual(a.timers(), { custom: [MINE], edits: {} });
    assert.deepEqual(a.world('lostcity'), REMEMBERED);

    const older = tempFile();
    writeFileSync(older, JSON.stringify({ version: 1, worlds: { lostcity: REMEMBERED } }));
    const b = new AppState(older);
    b.load();
    assert.deepEqual(b.timers(), { custom: [], edits: {} });
    assert.deepEqual(b.world('lostcity'), REMEMBERED);
});
