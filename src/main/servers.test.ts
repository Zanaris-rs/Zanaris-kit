import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SERVERS, parseServerUrl, originOf, partitionFor, customServer } from './servers.ts';

test('the default list covers the three target servers with unique ids', () => {
    const ids = DEFAULT_SERVERS.map(s => s.id);
    assert.deepEqual(new Set(ids).size, ids.length, 'ids must be unique');
    for (const want of ['zanaris-w1', 'lostcity-w5', 'lostcitylabs-w1']) {
        assert.ok(ids.includes(want), `missing ${want}`);
    }
    for (const server of DEFAULT_SERVERS) {
        const parsed = parseServerUrl(server.url);
        assert.ok(parsed.ok, `${server.id}: ${server.url} must be a valid web url`);
        assert.equal(parsed.url, server.url, `${server.id}: url must already be normalised`);
    }
});

test('parseServerUrl accepts an https url as-is', () => {
    const r = parseServerUrl('https://w5-2004.lostcity.rs/rs2.cgi?plugin=0&world=5&lowmem=1');
    assert.deepEqual(r, { ok: true, url: 'https://w5-2004.lostcity.rs/rs2.cgi?plugin=0&world=5&lowmem=1' });
});

test('parseServerUrl assumes https when the scheme is missing', () => {
    const r = parseServerUrl('w1.04.zanaris.rs/rs2.cgi?lowmem=1');
    assert.deepEqual(r, { ok: true, url: 'https://w1.04.zanaris.rs/rs2.cgi?lowmem=1' });
});

test('parseServerUrl trims surrounding whitespace', () => {
    const r = parseServerUrl('  http://127.0.0.1:8888/rs2.cgi?lowmem=1 \n');
    assert.deepEqual(r, { ok: true, url: 'http://127.0.0.1:8888/rs2.cgi?lowmem=1' });
});

test('parseServerUrl rejects non-web schemes', () => {
    for (const bad of ['javascript:alert(1)', 'ftp://example.com/', 'file:///etc/passwd', 'about:blank']) {
        const r = parseServerUrl(bad);
        assert.equal(r.ok, false, `${bad} must be rejected`);
    }
});

test('parseServerUrl rejects empty input and things that are not urls', () => {
    for (const bad of ['', '   ', 'not a url', 'https://']) {
        const r = parseServerUrl(bad);
        assert.equal(r.ok, false, `${JSON.stringify(bad)} must be rejected`);
        if (!r.ok) assert.ok(r.error.length > 0, 'a rejection carries a reason');
    }
});

test('originOf strips path and query', () => {
    assert.equal(originOf('https://w5-2004.lostcity.rs/rs2.cgi?plugin=0&world=5'), 'https://w5-2004.lostcity.rs');
    assert.equal(originOf('http://127.0.0.1:8888/rs2.cgi?lowmem=1'), 'http://127.0.0.1:8888');
});

test('partitionFor gives each server its own persistent partition', () => {
    assert.equal(partitionFor('zanaris-w1'), 'persist:server:zanaris-w1');
    assert.notEqual(partitionFor('zanaris-w1'), partitionFor('lostcity-w5'));
});

test('customServer derives a stable id from the url', () => {
    const a = customServer('https://www.lostcitylabs.com/play/world-1/');
    const b = customServer('https://www.lostcitylabs.com/play/world-1/');
    assert.equal(a.id, b.id, 'same url, same id');
    assert.ok(a.id.startsWith('custom:'), 'custom ids are namespaced');
    assert.equal(a.url, 'https://www.lostcitylabs.com/play/world-1/');
});

test('customServer separates worlds that differ only by path or query', () => {
    const byPath1 = customServer('https://www.lostcitylabs.com/play/world-1/');
    const byPath2 = customServer('https://www.lostcitylabs.com/play/world-2/');
    assert.notEqual(byPath1.id, byPath2.id);

    const byQuery5 = customServer('https://w5-2004.lostcity.rs/rs2.cgi?world=5');
    const byQuery6 = customServer('https://w5-2004.lostcity.rs/rs2.cgi?world=6');
    assert.notEqual(byQuery5.id, byQuery6.id);
});

test('customServer names the entry after its host', () => {
    assert.equal(customServer('https://www.lostcitylabs.com/play/world-1/').name, 'www.lostcitylabs.com');
    assert.equal(customServer('http://127.0.0.1:8888/rs2.cgi').name, '127.0.0.1:8888');
});
