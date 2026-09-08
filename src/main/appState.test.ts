import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppState } from './appState.ts';
import { DEFAULT_CHAT } from '../shared/chat.ts';
import { DOCK_HEIGHT_MIN } from '../shared/layout.ts';

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

test('a stored dock and dockHeight round-trip together', () => {
    const file = tempFile();
    const chat = { nick: 'lumbridge', server: 'irc.example.net', port: 6667, dock: 'side', dockHeight: 260 };
    writeFileSync(file, JSON.stringify({ version: 1, worlds: { lostcity: REMEMBERED }, chat }));
    const state = new AppState(file);
    state.load();
    assert.deepEqual(state.chat(), chat);
    assert.deepEqual(state.world('lostcity'), REMEMBERED);
});

test("an invalid or missing dock falls back to 'bottom', keeping the rest of chat and the remembered worlds", () => {
    const cases: unknown[] = ['sideways', 42, undefined];
    for (const dock of cases) {
        const file = tempFile();
        const chat: Record<string, unknown> = { nick: 'lumbridge', server: 'irc.example.net', port: 6667, dockHeight: 260 };
        if (dock !== undefined) chat.dock = dock;
        writeFileSync(file, JSON.stringify({ version: 1, worlds: { lostcity: REMEMBERED }, chat }));
        const state = new AppState(file);
        state.load();
        assert.deepEqual(state.chat(), { nick: 'lumbridge', server: 'irc.example.net', port: 6667, dock: 'bottom', dockHeight: 260 }, `expected dock ${JSON.stringify(dock)} to fall back`);
        assert.deepEqual(state.world('lostcity'), REMEMBERED);
    }
});

test('dockHeight is clamped to its bounds, or falls back to the default when it is not an integer', () => {
    const cases: Array<[unknown, number]> = [
        [40, DOCK_HEIGHT_MIN],
        [99999, 2000],
        ['tall', DEFAULT_CHAT.dockHeight],
        [180.5, DEFAULT_CHAT.dockHeight]
    ];
    for (const [dockHeight, expected] of cases) {
        const file = tempFile();
        const chat = { nick: 'lumbridge', server: 'irc.example.net', port: 6667, dock: 'side', dockHeight };
        writeFileSync(file, JSON.stringify({ version: 1, worlds: { lostcity: REMEMBERED }, chat }));
        const state = new AppState(file);
        state.load();
        assert.deepEqual(state.chat(), { nick: 'lumbridge', server: 'irc.example.net', port: 6667, dock: 'side', dockHeight: expected }, `expected dockHeight ${JSON.stringify(dockHeight)} to become ${expected}`);
        assert.deepEqual(state.world('lostcity'), REMEMBERED);
    }
});

test('setChat with dock and dockHeight saves, and a fresh instance reads them back', () => {
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    a.setChat({ dock: 'side', dockHeight: 260 });
    const b = new AppState(file);
    b.load();
    assert.deepEqual(b.chat(), { ...DEFAULT_CHAT, dock: 'side', dockHeight: 260 });
    const written = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(written.chat, { ...DEFAULT_CHAT, dock: 'side', dockHeight: 260 });
});

test('stageChat applies in memory and writes nothing until save is called', () => {
    // What the dock drag leans on: a height arrives once an animation frame,
    // so the layout must see it immediately while the profile is written once,
    // when the drag settles. A stageChat that saved would be sixty rewrites of
    // the whole file a second; one that did not apply would leave every
    // window laying out against the old height.
    const file = tempFile();
    const a = new AppState(file);
    a.load();
    a.setChat({ nick: 'lumbridge' });
    a.stageChat({ dockHeight: 260 });
    assert.equal(a.chat().dockHeight, 260, 'the staged height is live in memory at once');
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).chat.dockHeight, DEFAULT_CHAT.dockHeight, 'and nothing has been written yet');
    a.save();
    const b = new AppState(file);
    b.load();
    assert.deepEqual(b.chat(), { ...DEFAULT_CHAT, nick: 'lumbridge', dockHeight: 260 }, 'the save writes the staged height alongside everything else');
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
