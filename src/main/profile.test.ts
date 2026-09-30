import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPTURE_PROFILE, DEV_PROFILE, LIVE_PROFILE, profileFor } from './profile.ts';

test('the installed kit keeps the profile Electron names after the package', () => {
    assert.equal(profileFor({ packaged: true, capture: false }), LIVE_PROFILE);
    assert.equal(LIVE_PROFILE, 'zanaris-kit');
});

test('a development run keeps a profile of its own, so it can run beside the installed kit', () => {
    assert.equal(profileFor({ packaged: false, capture: false }), DEV_PROFILE);
});

test('a capture keeps its own, whatever it runs from', () => {
    assert.equal(profileFor({ packaged: false, capture: true }), CAPTURE_PROFILE);
    assert.equal(profileFor({ packaged: true, capture: true }), CAPTURE_PROFILE);
});

test('the three are three folders', () => {
    assert.equal(new Set([LIVE_PROFILE, DEV_PROFILE, CAPTURE_PROFILE]).size, 3);
});
