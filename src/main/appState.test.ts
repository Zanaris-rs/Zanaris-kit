import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppState } from './appState.ts';
import { DEFAULT_CHAT } from '../shared/chat.ts';
import { CUSTOM_MAX, themeById, type Theme } from '../shared/themes.ts';

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
        JSON.stringify({ version: 1, worlds: {}, chat: { nick: 'mage\r\nJOIN #elsewhere', autoJoin: ['#ok', '#bad\r\nQUIT', '#two words', '#fine'] } })
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

test('your world\'s settings default to cheats off, xp 1x and members on, persist, and survive a file without the key', () => {
    const file = tempFile();
    const state = new AppState(file);
    state.load();
    assert.deepEqual(state.yourWorldSettings(), { cheats: false, xpRate: 1, members: true });
    state.setYourWorldSettings({ cheats: true, xpRate: 5 });
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).singlePlayer, { cheats: true, xpRate: 5, members: true });
    const again = new AppState(file);
    again.load();
    assert.deepEqual(again.yourWorldSettings(), { cheats: true, xpRate: 5, members: true });
    writeFileSync(file, JSON.stringify({ version: 1, worlds: {}, warnOnSwitch: true }));
    const older = new AppState(file);
    older.load();
    assert.deepEqual(older.yourWorldSettings(), { cheats: false, xpRate: 1, members: true });
});

test('a stored stored settings block is read one field at a time, and a bad one costs nothing else', () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ version: 1, worlds: {}, singlePlayer: { cheats: 'yes', xpRate: 3, members: false } }));
    const odd = new AppState(file);
    odd.load();
    assert.deepEqual(odd.yourWorldSettings(), { cheats: false, xpRate: 1, members: false });
    // What the kit wrote before XP rate and members existed.
    writeFileSync(file, JSON.stringify({ version: 1, worlds: {}, singlePlayer: { cheats: true } }));
    const before = new AppState(file);
    before.load();
    assert.deepEqual(before.yourWorldSettings(), { cheats: true, xpRate: 1, members: true });
    writeFileSync(file, JSON.stringify({ version: 1, worlds: { lostcity: REMEMBERED }, singlePlayer: 'junk' }));
    const junk = new AppState(file);
    junk.load();
    assert.deepEqual(junk.yourWorldSettings(), { cheats: false, xpRate: 1, members: true });
    assert.deepEqual(junk.world('lostcity'), REMEMBERED);
});

test('setYourWorldSettings stores only what a load would keep, and hands out copies', () => {
    const state = new AppState(tempFile());
    state.load();
    state.setYourWorldSettings({ xpRate: 5 });
    // An invalid value falls back to the default, exactly as reading it from the file would.
    state.setYourWorldSettings({ xpRate: 7 as never, members: false });
    assert.deepEqual(state.yourWorldSettings(), { cheats: false, xpRate: 1, members: false });
    const copy = state.yourWorldSettings();
    copy.cheats = true;
    assert.equal(state.yourWorldSettings().cheats, false);
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

test('the chosen build line is kept beside the settings, and read back as a line id or nothing', () => {
    const file = tempFile();
    const state = new AppState(file);
    state.load();
    assert.equal(state.yourWorldBuild(), null, 'nobody has chosen yet');
    state.setYourWorldBuild('lostcity-289');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).singlePlayer, { cheats: false, xpRate: 1, members: true, build: 'lostcity-289' });
    const again = new AppState(file);
    again.load();
    assert.equal(again.yourWorldBuild(), 'lostcity-289');
    again.setYourWorldSettings({ cheats: true });
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).singlePlayer.build, 'lostcity-289', 'a settings change keeps it');
    for (const bad of [7, '', '../x', 'Lost City', 'x'.repeat(65)]) {
        writeFileSync(file, JSON.stringify({ version: 1, worlds: {}, singlePlayer: { cheats: true, build: bad } }));
        const odd = new AppState(file);
        odd.load();
        assert.equal(odd.yourWorldBuild(), null, JSON.stringify(bad));
        assert.equal(odd.yourWorldSettings().cheats, true, 'a bad build costs nothing else');
    }
});

test('the startup list saves, and a fresh instance reads it back', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    a.setStartupServer('zanaris', true);
    a.setStartupServer('lostcity', true);
    const b = new AppState(file);
    b.load();
    assert.deepEqual(b.startupIds(), ['zanaris', 'lostcity']);
});

test('setting a server off removes it, and setting one on twice does not duplicate it', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    a.setStartupServer('zanaris', true);
    a.setStartupServer('zanaris', true);
    assert.deepEqual(a.startupIds(), ['zanaris']);
    a.setStartupServer('zanaris', false);
    assert.deepEqual(a.startupIds(), []);
});

test('a hand-edited startup entry that is not a string costs its own row and not the file', () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ version: 1, worlds: {}, startup: ['zanaris', 7, '', 'lostcity'] }));
    const state = new AppState(file);
    state.load();
    assert.deepEqual(state.startupIds(), ['zanaris', 'lostcity']);
});

test('setStartupServer does not push past the cap readStartup enforces on the way in', () => {
    const file = tempFile();
    const state = new AppState(file);
    state.load();
    for (let i = 0; i < 16; i++) state.setStartupServer(`s${i}`, true);
    state.setStartupServer('s16', true);
    assert.equal(state.startupIds().length, 16, 'the seventeenth id is dropped rather than pushed');
    assert.ok(!state.startupIds().includes('s16'));
    const fresh = new AppState(file);
    fresh.load();
    assert.deepEqual(fresh.startupIds(), state.startupIds(), 'the dropped id was never saved either');
});

test('the chat ignore list and notification choice are kept, and a bad entry costs only itself', () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ version: 1, worlds: {}, chat: { nick: 'mage', ignore: ['spammer', 42, 'two words', 'Bob'], notify: false } }));
    const state = new AppState(file);
    state.load();
    assert.deepEqual(state.chat().ignore, ['spammer', 'Bob']);
    assert.equal(state.chat().notify, false);

    const fresh = new AppState(tempFile());
    fresh.load();
    assert.deepEqual(fresh.chat().ignore, [], 'nobody is ignored until someone is');
    assert.equal(fresh.chat().notify, true);

    state.setChat({ ignore: ['carol'] });
    const again = new AppState(file);
    again.load();
    assert.deepEqual(again.chat().ignore, ['carol']);
});

test('the app theme starts as stone with no server themes, and both survive a round trip', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    assert.deepEqual(a.appearance(), { theme: 'stone', servers: {}, custom: [] });
    a.setTheme('zanaris');
    a.setServerTheme('lostcity', 'wilderness');
    const b = new AppState(file);
    b.load();
    assert.deepEqual(b.appearance(), { theme: 'zanaris', servers: { lostcity: 'wilderness' }, custom: [] });
});

test('an unknown theme costs only itself: the app theme falls back, a bad server entry is dropped, the rest stays', () => {
    const file = tempFile();
    writeFileSync(
        file,
        JSON.stringify({ version: 1, worlds: { lostcity: REMEMBERED }, appearance: { theme: 'parchment', servers: { lostcity: 'morytania', zanaris: 'parchment', labs: 7, '': 'zanaris' } } })
    );
    const state = new AppState(file);
    state.load();
    assert.deepEqual(state.appearance(), { theme: 'stone', servers: { lostcity: 'morytania' }, custom: [] });
    assert.deepEqual(state.world('lostcity'), REMEMBERED);
});

test('an appearance block that is not an object, or a file without one, starts at stone', () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ version: 1, worlds: {}, appearance: 'zanaris' }));
    const state = new AppState(file);
    state.load();
    assert.deepEqual(state.appearance(), { theme: 'stone', servers: {}, custom: [] });
});

test('setServerTheme with null clears an override, and an unknown id changes nothing', () => {
    const file = tempFile();
    const state = new AppState(file);
    state.load();
    state.setServerTheme('lostcity', 'lumbridge');
    state.setServerTheme('lostcity', 'parchment');
    state.setTheme('parchment');
    assert.deepEqual(state.appearance(), { theme: 'stone', servers: { lostcity: 'lumbridge' }, custom: [] });
    state.setServerTheme('lostcity', null);
    assert.deepEqual(state.appearance(), { theme: 'stone', servers: {}, custom: [] });
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).appearance, { theme: 'stone', servers: {}, custom: [] });
});

test('appearance() hands out a copy, so a caller cannot change the stored state', () => {
    const state = new AppState(tempFile());
    state.load();
    state.setServerTheme('lostcity', 'zanaris');
    const copy = state.appearance() as { theme: string; servers: Record<string, string> };
    copy.servers.lostcity = 'wilderness';
    copy.theme = 'wilderness';
    assert.deepEqual(state.appearance(), { theme: 'stone', servers: { lostcity: 'zanaris' }, custom: [] });
});

test('a server id of __proto__ in a hand-edited file is a plain entry, not a prototype', () => {
    const file = tempFile();
    writeFileSync(file, '{"version":1,"worlds":{},"appearance":{"theme":"stone","servers":{"__proto__":"zanaris"}}}');
    const state = new AppState(file);
    state.load();
    assert.deepEqual(Object.keys(state.appearance().servers), ['__proto__']);
    assert.equal(Object.getPrototypeOf(state.appearance().servers), Object.prototype);
});

const PICTURE = `${'cd'.repeat(32)}.jpg`;
const night = (id = 'custom-0000000a', name = 'Night'): Theme => ({
    id,
    name,
    colors: { ...themeById('stone').colors, stone: '#223344' },
    background: { picture: PICTURE, fit: 'cover', show: 0.4 }
});

test('custom themes survive a round trip, and the app and a server can wear one', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    a.saveCustomTheme(night());
    a.setTheme('custom-0000000a');
    a.setServerTheme('lostcity', 'custom-0000000a');
    const b = new AppState(file);
    b.load();
    assert.deepEqual(b.appearance(), { theme: 'custom-0000000a', servers: { lostcity: 'custom-0000000a' }, custom: [night()] });
});

test('a custom theme that cannot be read costs only itself, and whatever wore it falls back', () => {
    const file = tempFile();
    const broken = { ...night('custom-0000000b', 'Broken'), colors: { stone: 'nope' } };
    writeFileSync(
        file,
        JSON.stringify({
            version: 1,
            worlds: {},
            appearance: { theme: 'custom-0000000b', servers: { lostcity: 'custom-0000000b', zanaris: 'custom-0000000a' }, custom: [night(), broken, 'junk', night()] }
        })
    );
    const state = new AppState(file);
    state.load();
    const read = state.appearance();
    assert.deepEqual(
        read.custom.map(t => t.id),
        ['custom-0000000a']
    );
    assert.equal(read.theme, 'stone');
    assert.deepEqual(read.servers, { zanaris: 'custom-0000000a' });
});

test('saveCustomTheme replaces by id, appends a new one, and refuses past the cap or a theme that would not read back', () => {
    const state = new AppState(tempFile());
    state.load();
    assert.equal(state.saveCustomTheme(night()), true);
    assert.equal(state.saveCustomTheme({ ...night(), name: 'Night, again' }), true);
    assert.deepEqual(
        state.appearance().custom.map(t => t.name),
        ['Night, again']
    );
    assert.equal(state.saveCustomTheme({ ...night('custom-0000000c'), name: '' }), false);
    for (let i = 1; i < CUSTOM_MAX; i++) assert.equal(state.saveCustomTheme(night(`custom-${(0x10000000 + i).toString(16)}`, `N${i}`)), true);
    assert.equal(state.appearance().custom.length, CUSTOM_MAX);
    assert.equal(state.saveCustomTheme(night('custom-ffffffff', 'One too many')), false);
});

test('deleteCustomTheme clears the app theme and every server that wore it', () => {
    const state = new AppState(tempFile());
    state.load();
    state.saveCustomTheme(night());
    state.setTheme('custom-0000000a');
    state.setServerTheme('lostcity', 'custom-0000000a');
    state.setServerTheme('zanaris', 'wilderness');
    assert.equal(state.deleteCustomTheme('custom-0000000a'), true);
    assert.deepEqual(state.appearance(), { theme: 'stone', servers: { zanaris: 'wilderness' }, custom: [] });
    assert.equal(state.deleteCustomTheme('custom-0000000a'), false);
});

test('appearance() copies the custom themes too, so a caller cannot change the stored ones', () => {
    const state = new AppState(tempFile());
    state.load();
    state.saveCustomTheme(night());
    const copy = state.appearance().custom[0] as Theme & { colors: Record<string, string>; background: { show: number } };
    copy.colors.stone = '#ffffff';
    copy.background.show = 0;
    assert.equal(state.appearance().custom[0]?.colors.stone, '#223344');
    assert.equal(state.appearance().custom[0]?.background?.show, 0.4);
});

test('a save that cannot be written leaves the custom themes as they were, so trying again makes no second copy', () => {
    const file = tempFile();
    const state = new AppState(file);
    state.load();
    state.saveCustomTheme(night());
    // A file that cannot be written, as on a full disk.
    chmodSync(file, 0o400);
    try {
        assert.throws(() => state.saveCustomTheme(night('custom-0000000b', 'Second')));
        assert.throws(() => state.deleteCustomTheme('custom-0000000a'));
    } finally {
        chmodSync(file, 0o600);
    }
    assert.deepEqual(
        state.appearance().custom.map(t => t.id),
        ['custom-0000000a']
    );
});

test('fromFile says whether the state was read from its file: not when there was none, and not when it was broken', () => {
    const file = tempFile();
    const fresh = new AppState(file);
    fresh.load();
    assert.equal(fresh.fromFile(), false);
    fresh.saveCustomTheme(night());
    const read = new AppState(file);
    read.load();
    assert.equal(read.fromFile(), true);
    writeFileSync(file, '{ broken');
    const broken = new AppState(file);
    broken.load();
    assert.equal(broken.fromFile(), false);
});
