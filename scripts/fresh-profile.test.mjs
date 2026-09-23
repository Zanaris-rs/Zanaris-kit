import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { KEPT, profileDir, setAsidePath, stamp, uniquePath } from './fresh-profile.mjs';

test('the profile is where Electron puts it on each platform', () => {
    assert.equal(profileDir('darwin', {}, '/Users/me'), '/Users/me/Library/Application Support/zanaris-kit');
    assert.equal(profileDir('win32', { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, 'C:\\Users\\me'), join('C:\\Users\\me\\AppData\\Roaming', 'zanaris-kit'));
    assert.equal(profileDir('linux', {}, '/home/me'), '/home/me/.config/zanaris-kit');
});

test('a Windows box with no APPDATA falls back to the path it would hold', () => {
    assert.equal(profileDir('win32', {}, 'C:\\Users\\me'), join('C:\\Users\\me', 'AppData', 'Roaming', 'zanaris-kit'));
});

test('XDG_CONFIG_HOME wins on Linux, since that is what Electron reads', () => {
    assert.equal(profileDir('linux', { XDG_CONFIG_HOME: '/home/me/elsewhere' }, '/home/me'), '/home/me/elsewhere/zanaris-kit');
});

test('the old profile goes to the Bin on macOS, and beside itself everywhere else', () => {
    const profile = '/Users/me/Library/Application Support/zanaris-kit';
    assert.equal(setAsidePath('darwin', '/Users/me', profile, '2026-09-23-142530'), '/Users/me/.Trash/zanaris-kit-2026-09-23-142530');
    // The paths here are the host's flavour, not Windows', because `node:path`
    // is: a test running on macOS asking `dirname` about `C:\x` gets `.`. What
    // the two non-macOS branches share is the answer this pins — beside the
    // profile rather than in a bin, since neither has one a script may write to.
    assert.equal(setAsidePath('linux', '/home/me', '/home/me/.config/zanaris-kit', '2026-09-23-142530'), '/home/me/.config/zanaris-kit.old-2026-09-23-142530');
    assert.equal(setAsidePath('win32', '/home/me', '/roaming/zanaris-kit', '2026-09-23-142530'), '/roaming/zanaris-kit.old-2026-09-23-142530');
});

test('the stamp sorts by hand and holds no character a file name rejects', () => {
    assert.equal(stamp(new Date(Date.UTC(2026, 8, 23, 14, 25, 30))), '2026-09-23-142530');
    // Zero-padded, so a run in January sorts before one in October rather than after it.
    assert.equal(stamp(new Date(Date.UTC(2026, 0, 2, 3, 4, 5))), '2026-01-02-030405');
    assert.doesNotMatch(stamp(new Date()), /[:\\/]/);
});

test('two resets in the same second do not land on the same name', () => {
    // The stamp counts seconds, and resetting twice while testing takes less
    // than one. Without this the second rename hits a directory that is not
    // empty and the script dies with a stack trace over a half-moved profile.
    const taken = new Set(['/t/zanaris-kit-2026-09-23-142530', '/t/zanaris-kit-2026-09-23-142530-2']);
    assert.equal(uniquePath('/t/zanaris-kit-2026-09-23-142530', p => taken.has(p)), '/t/zanaris-kit-2026-09-23-142530-3');
    assert.equal(uniquePath('/t/free', () => false), '/t/free');
});

test('what survives a reset is the two folders that are expensive to rebuild', () => {
    // Builds are 50 MB a line, and the saves are someone's characters. Everything
    // else — state.json above all, which is what makes a launch a first launch —
    // is what the reset is for.
    assert.deepEqual(KEPT, ['yourworld', 'singleplayer']);
    assert.ok(!KEPT.includes('state.json'), 'keeping it would leave the next launch not fresh');
    assert.ok(!KEPT.includes('Partitions'), 'keeping the logins would not be a fresh profile');
});
