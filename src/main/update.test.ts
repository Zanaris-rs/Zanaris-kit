import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLatest, compareVersions, parseVersion } from './update.ts';

test('parseVersion accepts a leading v and any number of numeric parts', () => {
    assert.deepEqual(parseVersion('v0.2.0'), [0, 2, 0]);
    assert.deepEqual(parseVersion('1.0'), [1, 0]);
    assert.equal(parseVersion('v0.2.0-beta'), null);
    assert.equal(parseVersion('latest'), null);
});

test('compareVersions orders numerically and pads missing parts with zero', () => {
    assert.ok(compareVersions('0.2.0', 'v0.3.0')! < 0);
    assert.ok(compareVersions('0.10.0', 'v0.9.1')! > 0);
    assert.equal(compareVersions('1.0', '1.0.0'), 0);
    assert.equal(compareVersions('0.2.0', 'v0.2.0'), 0);
    assert.equal(compareVersions('0.2.0', 'nightly'), null);
});

test('checkLatest reads the GitHub release body and says whether it is newer', () => {
    const body = { tag_name: 'v0.3.0', html_url: 'https://github.com/Zanaris-rs/swiftkit/releases/tag/v0.3.0' };
    assert.deepEqual(checkLatest(body, '0.2.0'), { latest: 'v0.3.0', url: body.html_url, newer: true });
    assert.deepEqual(checkLatest(body, '0.3.0'), { latest: 'v0.3.0', url: body.html_url, newer: false });
    assert.deepEqual(checkLatest(body, '0.4.0'), { latest: 'v0.3.0', url: body.html_url, newer: false });
});

test('checkLatest returns null for anything that is not a release', () => {
    assert.equal(checkLatest(null, '0.2.0'), null);
    assert.equal(checkLatest('v0.3.0', '0.2.0'), null);
    assert.equal(checkLatest({ tag_name: 'v0.3.0' }, '0.2.0'), null);
    assert.equal(checkLatest({ tag_name: 'draft', html_url: 'https://example.invalid' }, '0.2.0'), null);
    assert.equal(checkLatest({ message: 'API rate limit exceeded' }, '0.2.0'), null);
});

test('checkLatest refuses a release page that is not https', () => {
    // The url goes to the OS handler. Remote data never reaches it with a
    // scheme of its own choosing: file:// would open a local path, and a
    // release page is always https.
    assert.equal(checkLatest({ tag_name: 'v0.3.0', html_url: 'file:///etc/passwd' }, '0.2.0'), null);
    assert.equal(checkLatest({ tag_name: 'v0.3.0', html_url: 'http://github.com/x/y/releases/tag/v0.3.0' }, '0.2.0'), null);
});
