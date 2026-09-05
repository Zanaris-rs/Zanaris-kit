import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    DEFAULT_SERVERS,
    parseServerUrl,
    originOf,
    hostOf,
    slugify,
    uniqueId,
    createServer,
    isServerDef,
    serverMenuLabel,
    Catalog
} from './catalog.ts';
import type { NewServerInput } from '../shared/catalog.ts';

const input = (over: Partial<NewServerInput> = {}): NewServerInput => ({
    name: 'My Server',
    url: 'https://play.example.com/rs2.cgi?lowmem=1',
    revision: 274,
    wikiHome: null,
    notes: null,
    ...over
});

test('the built-in list has the four servers with the settled revisions', () => {
    const byId = Object.fromEntries(DEFAULT_SERVERS.map(s => [s.id, s]));
    assert.equal(byId['zanaris-w1']!.revision, 274);
    assert.equal(byId['lostcity-w5']!.revision, 274);
    assert.equal(byId['lostcitylabs-w1']!.revision, null);
    assert.equal(byId['lostcitylabs-w1']!.notes, 'May 2005 per Lost City Labs');
    assert.equal(byId['local']!.revision, 289);
    assert.equal(byId['zanaris-w1']!.wiki?.home, 'https://2004.losthq.rs/');
    assert.equal(byId['lostcity-w5']!.wiki?.home, 'https://2004.losthq.rs/');
    assert.equal(byId['lostcitylabs-w1']!.wiki, null);
});

test('every built-in entry validates and lists its own game host', () => {
    const ids = DEFAULT_SERVERS.map(s => s.id);
    assert.equal(new Set(ids).size, ids.length, 'ids are unique');
    for (const server of DEFAULT_SERVERS) {
        assert.ok(isServerDef(server), `${server.id} must validate`);
        assert.ok(server.hosts.includes(hostOf(server.url)), `${server.id} must allow its own host`);
        if (server.wiki) assert.ok(server.hosts.includes(hostOf(server.wiki.home)), `${server.id} must allow its wiki host`);
    }
});

test('parseServerUrl accepts https as-is, assumes https without a scheme, and trims', () => {
    assert.deepEqual(parseServerUrl('https://a.example/rs2.cgi?x=1'), { ok: true, url: 'https://a.example/rs2.cgi?x=1' });
    assert.deepEqual(parseServerUrl('w1.04.zanaris.rs/rs2.cgi?lowmem=1'), { ok: true, url: 'https://w1.04.zanaris.rs/rs2.cgi?lowmem=1' });
    assert.deepEqual(parseServerUrl('  http://127.0.0.1:8888/rs2.cgi \n'), { ok: true, url: 'http://127.0.0.1:8888/rs2.cgi' });
});

test('parseServerUrl rejects non-web schemes, empty input and garbage', () => {
    for (const bad of ['javascript:alert(1)', 'ftp://x.example/', 'file:///etc/passwd', 'about:blank', '', '   ', 'not a url', 'https://']) {
        const r = parseServerUrl(bad);
        assert.equal(r.ok, false, `${JSON.stringify(bad)} must be rejected`);
    }
});

test('originOf and hostOf', () => {
    assert.equal(originOf('https://w5-2004.lostcity.rs/rs2.cgi?plugin=0'), 'https://w5-2004.lostcity.rs');
    assert.equal(hostOf('http://127.0.0.1:8888/rs2.cgi'), '127.0.0.1:8888');
});

test('slugify and uniqueId', () => {
    assert.equal(slugify('Zanaris — World 1'), 'zanaris-world-1');
    assert.equal(slugify('   '), 'server');
    assert.equal(uniqueId('x', new Set()), 'x');
    assert.equal(uniqueId('x', new Set(['x'])), 'x-2');
    assert.equal(uniqueId('x', new Set(['x', 'x-2'])), 'x-3');
});

test('createServer builds a valid entry from the form', () => {
    const r = createServer(input(), []);
    assert.ok(r.ok);
    assert.equal(r.server.id, 'my-server');
    assert.equal(r.server.name, 'My Server');
    assert.equal(r.server.revision, 274);
    assert.equal(r.server.wiki, null);
    assert.deepEqual(r.server.hosts, ['play.example.com']);
    assert.equal(r.server.map, null);
    assert.equal(r.server.notes, null);
    assert.ok(isServerDef(r.server));
});

test('createServer adds the wiki host and leaves search unknown', () => {
    const r = createServer(input({ wikiHome: '2004.losthq.rs' }), []);
    assert.ok(r.ok);
    assert.deepEqual(r.server.wiki, { home: 'https://2004.losthq.rs/', search: null });
    assert.deepEqual(r.server.hosts, ['play.example.com', '2004.losthq.rs']);
});

test('createServer keeps ids unique and trims notes', () => {
    const first = createServer(input(), []);
    assert.ok(first.ok);
    const second = createServer(input({ notes: '  May 2005  ' }), [first.server]);
    assert.ok(second.ok);
    assert.equal(second.server.id, 'my-server-2');
    assert.equal(second.server.notes, 'May 2005');
});

test('createServer rejects bad input with a reason', () => {
    for (const bad of [input({ name: ' ' }), input({ url: 'javascript:1' }), input({ revision: 0 }), input({ revision: 1.5 }), input({ wikiHome: 'ftp://x.example/' })]) {
        const r = createServer(bad, []);
        assert.equal(r.ok, false);
        if (!r.ok) assert.ok(r.error.length > 0);
    }
});

test('serverMenuLabel shows the revision only when known', () => {
    assert.equal(serverMenuLabel({ name: 'Zanaris — World 1', revision: 274 }), 'Zanaris — World 1 (rev 274)');
    assert.equal(serverMenuLabel({ name: 'Lost City Labs — World 1', revision: null }), 'Lost City Labs — World 1');
});

test('a later load that succeeds clears recovered', () => {
    const file = tempFile();
    writeFileSync(file, '{ not json');
    const catalog = new Catalog(file);
    catalog.load();
    assert.equal(catalog.recovered, true);
    catalog.load();
    assert.equal(catalog.recovered, false, 'the defaults it wrote are readable');
});

test('isServerDef rejects junk', () => {
    for (const bad of [null, 1, {}, { id: 'a', name: 'b', url: 'x' }, { ...DEFAULT_SERVERS[0], revision: 'x' }, { ...DEFAULT_SERVERS[0], hosts: 'nope' }]) {
        assert.equal(isServerDef(bad), false);
    }
});

// ── the file ──────────────────────────────────────────────────────────────

const dirs: string[] = [];
const tempFile = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'swiftkit-catalog-'));
    dirs.push(dir);
    return join(dir, 'servers.json');
};
afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('load writes the defaults when there is no file', () => {
    const file = tempFile();
    const catalog = new Catalog(file);
    catalog.load();
    assert.equal(catalog.recovered, false);
    assert.deepEqual(catalog.list().map(s => s.id), DEFAULT_SERVERS.map(s => s.id));
    assert.ok(existsSync(file));
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 1);
});

test('add persists and a fresh load sees it', () => {
    const file = tempFile();
    const a = new Catalog(file);
    a.load();
    const r = a.add(input());
    assert.ok(r.ok);
    const b = new Catalog(file);
    b.load();
    assert.ok(b.get('my-server'));
    assert.equal(b.list().length, DEFAULT_SERVERS.length + 1);
});

test('remove persists and reports unknown ids', () => {
    const file = tempFile();
    const a = new Catalog(file);
    a.load();
    assert.equal(a.remove('local'), true);
    assert.equal(a.remove('local'), false);
    const b = new Catalog(file);
    b.load();
    assert.equal(b.get('local'), undefined);
});

test('an unreadable file is renamed aside and the defaults restored', () => {
    const file = tempFile();
    writeFileSync(file, '{ not json');
    const catalog = new Catalog(file);
    catalog.load();
    assert.equal(catalog.recovered, true);
    assert.deepEqual(catalog.list().map(s => s.id), DEFAULT_SERVERS.map(s => s.id));
    const names = readdirSync(join(file, '..'));
    assert.ok(names.some(n => n.startsWith('servers.json.broken-')), `kept the broken file: ${names}`);
});

test('a file with an invalid or duplicated entry counts as unreadable', () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ version: 1, servers: [DEFAULT_SERVERS[0], DEFAULT_SERVERS[0]] }));
    const catalog = new Catalog(file);
    catalog.load();
    assert.equal(catalog.recovered, true);
});

test('list returns copies', () => {
    const catalog = new Catalog(tempFile());
    catalog.load();
    catalog.list()[0]!.hosts.push('evil.example');
    assert.equal(catalog.list()[0]!.hosts.includes('evil.example'), false);
});
