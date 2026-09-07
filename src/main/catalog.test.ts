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
    migrateCatalog,
    engineRevision,
    Catalog
} from './catalog.ts';
import { isWorldsDef } from './worlds/sources.ts';
import type { NewServerInput, ServerDef } from '../shared/catalog.ts';

const input = (over: Partial<NewServerInput> = {}): NewServerInput => ({
    name: 'My Server',
    url: 'https://play.example.com/rs2.cgi?lowmem=1',
    revision: 274,
    wikiHome: null,
    notes: null,
    ...over
});

test('the built-in list is per server, Lost City first, with the settled revisions', () => {
    assert.deepEqual(DEFAULT_SERVERS.map(s => s.id), ['lostcity', 'zanaris', 'lostcitylabs', 'singleplayer', 'local']);
    const byId = Object.fromEntries(DEFAULT_SERVERS.map(s => [s.id, s]));
    assert.equal(byId['lostcity']!.revision, 274);
    assert.equal(byId['zanaris']!.revision, 274);
    assert.equal(byId['lostcitylabs']!.revision, null);
    assert.equal(byId['lostcitylabs']!.notes, 'May 2005 per Lost City Labs');
    assert.equal(byId['local']!.revision, 289);
    assert.equal(byId['lostcity']!.wiki?.home, 'https://2004.losthq.rs/');
    assert.equal(byId['zanaris']!.wiki?.home, 'https://2004.losthq.rs/');
    assert.equal(byId['lostcitylabs']!.wiki, null);
});

test('the single-player entry runs on this computer and carries the engine revision', () => {
    const sp = DEFAULT_SERVERS.find(s => s.id === 'singleplayer')!;
    assert.equal(sp.kind, 'singleplayer');
    assert.equal(sp.name, 'Single player');
    assert.equal(sp.url, 'http://127.0.0.1/rs2.cgi?lowmem=1');
    assert.equal(sp.revision, engineRevision());
    assert.equal(typeof sp.revision, 'number');
    assert.equal(sp.worlds, null);
    assert.equal(sp.wiki?.home, 'https://2004.losthq.rs/');
    assert.ok(sp.bookmarks.length >= 5);
    assert.deepEqual(sp.hosts, ['127.0.0.1', '2004.losthq.rs', 'tools.losthq.rs']);
    for (const server of DEFAULT_SERVERS) assert.equal(server.kind, server.id === 'singleplayer' ? 'singleplayer' : 'remote');
});

test('engineRevision reads engine.lock.json when nothing was stamped at build time', () => {
    const lock = JSON.parse(readFileSync('engine.lock.json', 'utf8')) as { revision: number };
    assert.equal(engineRevision(), lock.revision);
});

test('a version 2 file gains kind and the single-player entry, before local when present', () => {
    const v2 = {
        version: 2,
        servers: DEFAULT_SERVERS.filter(s => s.id !== 'singleplayer').map(s => {
            const { kind: _kind, ...rest } = s;
            return rest;
        })
    };
    const migrated = migrateCatalog(v2)!;
    assert.deepEqual(migrated.map(s => s.id), ['lostcity', 'zanaris', 'lostcitylabs', 'singleplayer', 'local']);
    assert.ok(migrated.every(s => s.kind === (s.id === 'singleplayer' ? 'singleplayer' : 'remote')));
});

test('a version 2 file without local gets the single-player entry appended', () => {
    const created = createServer(input(), []);
    assert.ok(created.ok);
    const custom: ServerDef = { ...created.server };
    const { kind: _kind, ...bare } = custom;
    const migrated = migrateCatalog({ version: 2, servers: [bare] })!;
    assert.deepEqual(migrated.map(s => s.id), ['my-server', 'singleplayer']);
    assert.equal(migrated[0]!.kind, 'remote');
});

test('a version 3 file is taken as it is, and one lacking kind is rejected', () => {
    const v3 = { version: 3, servers: DEFAULT_SERVERS.map(s => structuredClone(s)) };
    assert.deepEqual(migrateCatalog(v3), v3.servers);
    const { kind: _kind, ...bare } = DEFAULT_SERVERS[0]!;
    assert.equal(migrateCatalog({ version: 3, servers: [bare] }), null);
});

test('the catalog writes version 3 and upgrades a version 2 file on load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'catalog-'));
    const file = join(dir, 'servers.json');
    writeFileSync(file, JSON.stringify({ version: 2, servers: [] }));
    const catalog = new Catalog(file);
    catalog.load();
    assert.equal(catalog.recovered, false);
    assert.deepEqual(catalog.list().map(s => s.id), ['singleplayer']);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 3);
    rmSync(dir, { recursive: true, force: true });
});

test('the built-ins carry the worlds, bookmarks and hiscores they should', () => {
    const byId = Object.fromEntries(DEFAULT_SERVERS.map(s => [s.id, s]));
    assert.equal(byId['lostcity']!.worlds?.source.kind, 'losthq');
    assert.equal(byId['lostcity']!.worlds?.defaultWorld, 5);
    assert.equal(byId['lostcity']!.worlds?.detail, true);
    assert.ok(byId['lostcity']!.hiscores?.includes('{name}'));
    assert.ok(byId['lostcity']!.bookmarks.length >= 5);
    assert.equal(byId['zanaris']!.worlds?.source.kind, 'zanaris');
    assert.equal(byId['zanaris']!.worlds?.defaultWorld, 1);
    assert.equal(byId['lostcitylabs']!.worlds?.source.kind, 'static');
    assert.equal(byId['lostcitylabs']!.worlds?.detail, false);
    assert.equal(byId['local']!.worlds, null);
    for (const server of DEFAULT_SERVERS) {
        if (server.worlds) assert.ok(isWorldsDef(server.worlds), `${server.id} worlds must validate`);
        for (const b of server.bookmarks) assert.ok(parseServerUrl(b.url).ok, `${server.id} bookmark ${b.name}`);
    }
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
    assert.equal(r.server.worlds, null);
    assert.deepEqual(r.server.bookmarks, []);
    assert.equal(r.server.hiscores, null);
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

test('isServerDef rejects junk, including bad worlds, bookmarks and hiscores', () => {
    const good = DEFAULT_SERVERS[0]!;
    for (const bad of [
        null,
        1,
        {},
        { id: 'a', name: 'b', url: 'x' },
        { ...good, revision: 'x' },
        { ...good, hosts: 'nope' },
        { ...good, worlds: {} },
        { ...good, bookmarks: 'nope' },
        { ...good, bookmarks: [{ name: 'x', url: 'javascript:1' }] },
        { ...good, hiscores: 'https://x.example/no-placeholder' }
    ]) {
        assert.equal(isServerDef(bad), false, `${JSON.stringify(bad).slice(0, 60)} must be rejected`);
    }
});

// ── migration ─────────────────────────────────────────────────────────────

const OLD = (id: string, name: string, url: string): Record<string, unknown> => ({
    id, name, url, revision: 274, wiki: null, map: null, hosts: [new URL(url).host], notes: null
});
const V1_BUILTINS = [
    OLD('zanaris-w1', 'Zanaris — World 1', 'https://w1.04.zanaris.rs/rs2.cgi?lowmem=1'),
    OLD('lostcity-w5', 'Lost City — World 5', 'https://w5-2004.lostcity.rs/rs2.cgi?plugin=0&world=5&lowmem=1'),
    OLD('lostcitylabs-w1', 'Lost City Labs — World 1', 'https://www.lostcitylabs.com/play/world-1/'),
    OLD('local', 'Local server', 'http://127.0.0.1:8888/rs2.cgi?lowmem=1')
];

test('migrateCatalog turns a v1 file into the new built-ins in default order plus the custom entries', () => {
    const custom = OLD('my-server', 'My Server', 'https://play.example.com/rs2.cgi');
    const migrated = migrateCatalog({ version: 1, servers: [...V1_BUILTINS, custom] });
    assert.ok(migrated);
    assert.deepEqual(migrated.map(s => s.id), ['lostcity', 'zanaris', 'lostcitylabs', 'singleplayer', 'local', 'my-server']);
    assert.equal(migrated[0]!.worlds?.source.kind, 'losthq');
    const mine = migrated[5]!;
    assert.equal(mine.worlds, null);
    assert.deepEqual(mine.bookmarks, []);
    assert.equal(mine.hiscores, null);
    assert.ok(isServerDef(mine));
});

test('migrateCatalog treats a missing version as v1 and passes a v2 file through', () => {
    assert.ok(migrateCatalog({ servers: V1_BUILTINS }));
    const v2 = migrateCatalog({ version: 2, servers: [...DEFAULT_SERVERS] });
    assert.ok(v2);
    assert.deepEqual(v2.map(s => s.id), DEFAULT_SERVERS.map(s => s.id));
});

test('migrateCatalog returns null for junk, an invalid entry, or a version it does not know', () => {
    assert.equal(migrateCatalog(null), null);
    assert.equal(migrateCatalog({ version: 4, servers: [] }), null);
    assert.equal(migrateCatalog({ version: 1, servers: [{ id: 'x' }] }), null);
    assert.equal(migrateCatalog({ version: 2, servers: [{ ...DEFAULT_SERVERS[0], worlds: 'nope' }] }), null);
});

test('Catalog.load migrates a v1 file in place and rewrites it as v3', () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ version: 1, servers: V1_BUILTINS }));
    const catalog = new Catalog(file);
    catalog.load();
    assert.equal(catalog.recovered, false, 'a migration is not a recovery');
    assert.deepEqual(catalog.list().map(s => s.id), ['lostcity', 'zanaris', 'lostcitylabs', 'singleplayer', 'local']);
    const written = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(written.version, 3);
    assert.equal(written.servers[0].id, 'lostcity');
});

test('a stored single-player entry follows the pinned engine, keeping the rest of the entry', () => {
    const file = tempFile();
    const servers = DEFAULT_SERVERS.map(s => structuredClone(s) as ServerDef);
    const stored = servers.find(s => s.id === 'singleplayer')!;
    stored.revision = 1;
    stored.bookmarks = [{ name: 'Mine', url: 'https://example.com/' }];
    writeFileSync(file, JSON.stringify({ version: 3, servers }));
    const catalog = new Catalog(file);
    catalog.load();
    assert.equal(catalog.recovered, false);
    const loaded = catalog.get('singleplayer')!;
    assert.equal(loaded.revision, engineRevision());
    assert.deepEqual(loaded.bookmarks, [{ name: 'Mine', url: 'https://example.com/' }]);
    // and the file was rewritten, so the menu agrees on the next launch too
    const written = JSON.parse(readFileSync(file, 'utf8')) as { servers: ServerDef[] };
    assert.equal(written.servers.find(s => s.id === 'singleplayer')!.revision, engineRevision());
});

test('list returns deep copies of the worlds block', () => {
    const catalog = new Catalog(tempFile());
    catalog.load();
    const first = catalog.list()[0]!;
    (first.worlds!.source as { url: string }).url = 'https://evil.example/';
    first.bookmarks.push({ name: 'x', url: 'https://evil.example/' });
    const again = catalog.list()[0]!;
    assert.notEqual((again.worlds!.source as { url: string }).url, 'https://evil.example/');
    assert.equal(again.bookmarks.some(b => b.url === 'https://evil.example/'), false);
});

// ── the file ──────────────────────────────────────────────────────────────

const dirs: string[] = [];
const tempFile = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'zanaris-kit-catalog-'));
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
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 3);
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
