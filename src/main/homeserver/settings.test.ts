import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HOME_SERVER_SETTINGS, type BuildLine, type HomeServerSettings } from '../../shared/homeserver.ts';
import { changesSettings, readSettingChange, readHomeServerSettings, readShareTorMode, removeBuildConfirmation, restartConfirmation, switchConfirmation } from './settings.ts';

const DEFAULTS: HomeServerSettings = { cheats: false, xpRate: 1, members: true };

test('the defaults are cheats off, xp as the game gives it, and members on', () => {
    assert.deepEqual(DEFAULT_HOME_SERVER_SETTINGS, DEFAULTS);
    assert.deepEqual(readHomeServerSettings(undefined), DEFAULTS);
});

test('readHomeServerSettings keeps each good field and defaults each bad one', () => {
    assert.deepEqual(readHomeServerSettings({ cheats: true, xpRate: 10, members: false }), { cheats: true, xpRate: 10, members: false });
    assert.deepEqual(readHomeServerSettings({ cheats: 'yes', xpRate: 3, members: false }), { cheats: false, xpRate: 1, members: false });
    assert.deepEqual(readHomeServerSettings({ xpRate: '5' }), DEFAULTS);
    assert.deepEqual(readHomeServerSettings({ cheats: true }), { ...DEFAULTS, cheats: true }, 'the block as the kit wrote it before xp rate and members');
    assert.deepEqual(readHomeServerSettings('junk'), DEFAULTS);
    assert.deepEqual(readHomeServerSettings(null), DEFAULTS);
});

test("readShareTorMode reads 'single' only for exactly 'single', and 'full' for anything else", () => {
    assert.equal(readShareTorMode('single'), 'single');
    assert.equal(readShareTorMode('full'), 'full');
    for (const bad of [undefined, null, '', 'Single', ' single', 'tor-single', 1, true, {}, ['single']]) {
        assert.equal(readShareTorMode(bad), 'full', JSON.stringify(bad));
    }
});

test('readHomeServerSettings hands back a fresh object each time', () => {
    const first = readHomeServerSettings(undefined);
    first.cheats = true;
    assert.equal(readHomeServerSettings(undefined).cheats, false);
    assert.equal(DEFAULT_HOME_SERVER_SETTINGS.cheats, false);
});

test('readSettingChange takes one known setting with a value it can have, and nothing else', () => {
    assert.deepEqual(readSettingChange('cheats', true), { cheats: true });
    assert.deepEqual(readSettingChange('members', false), { members: false });
    assert.deepEqual(readSettingChange('xpRate', 5), { xpRate: 5 });
    assert.equal(readSettingChange('xpRate', 3), null);
    assert.equal(readSettingChange('xpRate', '5'), null);
    assert.equal(readSettingChange('cheats', 1), null);
    assert.equal(readSettingChange('debug', true), null);
    assert.equal(readSettingChange('__proto__', true), null);
    assert.equal(readSettingChange(undefined, undefined), null);
});

test('changesSettings says whether a change would leave anything different', () => {
    assert.equal(changesSettings(DEFAULTS, { cheats: false }), false);
    assert.equal(changesSettings(DEFAULTS, { cheats: true }), true);
    assert.equal(changesSettings(DEFAULTS, { xpRate: 1 }), false);
    assert.equal(changesSettings(DEFAULTS, { xpRate: 2 }), true);
    assert.equal(changesSettings(DEFAULTS, { members: false }), true);
    assert.equal(changesSettings(DEFAULTS, {}), false);
});

test('each restart question names the change, the restart and the logout, with Restart as the default', () => {
    const patches: Partial<HomeServerSettings>[] = [{ cheats: true }, { cheats: false }, { xpRate: 5 }, { members: true }, { members: false }];
    for (const patch of patches) {
        const question = restartConfirmation(patch);
        assert.match(question.message, /restarts your home server and logs you out\.$/);
        assert.equal(question.button, 'Restart');
        assert.equal(question.destructive, false);
        assert.notEqual(question.detail, '');
    }
    assert.match(restartConfirmation({ cheats: true }).message, /^Turning cheats on/);
    assert.match(restartConfirmation({ xpRate: 5 }).message, /XP rate to 5×/);
    assert.match(restartConfirmation({ members: false }).detail, /free one/);
});

test('turning cheats off no longer claims the world plays as the servers do', () => {
    assert.doesNotMatch(restartConfirmation({ cheats: false }).detail, /servers/);
});

const LINE: BuildLine = {
    id: 'lostcity-289',
    name: 'Lost City 289',
    revision: 289,
    note: null,
    engine: 'e',
    content: 'c',
    size: 54_166_007,
    state: 'installed',
    progress: null,
    error: null
};

test('switching builds asks as a restart, and says where the characters are', () => {
    const across = switchConfirmation(LINE, 274);
    assert.equal(across.message, 'Switching to Lost City 289 restarts your home server and logs you out.');
    assert.equal(across.detail, 'Rev 289 has its own characters.');
    assert.equal(across.button, 'Switch');
    assert.equal(across.destructive, false);
    assert.equal(switchConfirmation({ ...LINE, revision: 274 }, 274).detail, 'Your characters come with you.');
});

test('switching to a build not downloaded yet says it downloads first, and how much', () => {
    assert.equal(switchConfirmation({ ...LINE, state: 'absent' }, 274).detail, 'Downloads 54 MB first. Rev 289 has its own characters.');
    assert.equal(switchConfirmation({ ...LINE, state: 'absent', revision: 274 }, 274).detail, 'Downloads 54 MB first. Your characters come with you.');
    assert.doesNotMatch(switchConfirmation(LINE, 274).detail, /Downloads/);
});

test('removing a build says the characters stay and it can come back', () => {
    const ask = removeBuildConfirmation(LINE);
    assert.equal(ask.message, 'Remove Lost City 289?');
    assert.equal(ask.detail, 'Your characters stay, and it can be downloaded again (54 MB).');
    assert.equal(ask.button, 'Remove');
});
