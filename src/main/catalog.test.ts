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
    assert.deepEqual(DEFAULT_SERVERS.map(s => s.id), ['lostcity', 'zanaris', 'lostcitylabs', 'singleplayer']);
    const byId = Object.fromEntries(DEFAULT_SERVERS.map(s => [s.id, s]));
    assert.equal(byId['lostcity']!.revision, 274);
    assert.equal(byId['zanaris']!.revision, 274);
    assert.equal(byId['lostcitylabs']!.revision, null);
    assert.equal(byId['lostcitylabs']!.notes, 'May 2005 per Lost City Labs');
    assert.equal(byId['local'], undefined, 'single player superseded the local server');
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

test('a version 2 file gains kind and the single-player entry, and loses local', () => {
    const v2 = {
        version: 2,
        servers: [
            ...DEFAULT_SERVERS.filter(s => s.id !== 'singleplayer').map(s => {
                const { kind: _kind, hiscores: _hiscores, ...rest } = s;
                return { ...rest, hiscores: s.id === 'lostcity' ? V3_LOSTCITY_TEMPLATE : null };
            }),
            V3_LOCAL
        ]
    };
    const migrated = migrateCatalog(v2)!;
    assert.deepEqual(migrated.map(s => s.id), ['lostcity', 'zanaris', 'lostcitylabs', 'singleplayer']);
    assert.ok(migrated.every(s => s.kind === (s.id === 'singleplayer' ? 'singleplayer' : 'remote')));
    assert.equal(migrated[0]!.hiscores?.source.kind, 'lostcity', 'a version 2 file gets the version 3 step too');
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

test('a version 4 file is taken as it is, and one lacking kind is rejected', () => {
    const v4 = { version: 4, servers: DEFAULT_SERVERS.map(s => structuredClone(s)) };
    assert.deepEqual(migrateCatalog(v4), v4.servers);
    const { kind: _kind, ...bare } = DEFAULT_SERVERS[0]!;
    assert.equal(migrateCatalog({ version: 4, servers: [bare] }), null);
});

test('the catalog writes version 4 and upgrades a version 2 file on load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'catalog-'));
    const file = join(dir, 'servers.json');
    writeFileSync(file, JSON.stringify({ version: 2, servers: [] }));
    const catalog = new Catalog(file);
    catalog.load();
    assert.equal(catalog.recovered, false);
    assert.deepEqual(catalog.list().map(s => s.id), ['singleplayer']);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 4);
    rmSync(dir, { recursive: true, force: true });
});

test('the built-ins carry the worlds, bookmarks and hiscores they should', () => {
    const byId = Object.fromEntries(DEFAULT_SERVERS.map(s => [s.id, s]));
    assert.equal(byId['lostcity']!.worlds?.source.kind, 'losthq');
    assert.equal(byId['lostcity']!.worlds?.defaultWorld, 5);
    assert.equal(byId['lostcity']!.worlds?.detail, true);
    assert.deepEqual(byId['lostcity']!.hiscores, {
        source: { kind: 'lostcity', url: 'https://2004.lostcity.rs/api/hiscores/player/{name}' },
        site: 'https://2004.lostcity.rs/hiscores'
    });
    assert.deepEqual(byId['zanaris']!.hiscores, {
        source: { kind: 'zanaris', url: 'https://zanaris.rs/api/hiscores/player/{name}' },
        site: 'https://zanaris.rs/hiscores'
    });
    assert.deepEqual(byId['lostcitylabs']!.hiscores, {
        source: { kind: 'labs', url: 'https://www.lostcitylabs.com/hiscores/player?name={name}' },
        site: 'https://www.lostcitylabs.com/hiscores'
    });
    assert.equal(byId['singleplayer']!.hiscores, null, 'a one-player world has nobody to rank');
    assert.ok(byId['lostcity']!.bookmarks.length >= 5);
    assert.equal(byId['zanaris']!.worlds?.source.kind, 'zanaris');
    assert.equal(byId['zanaris']!.worlds?.defaultWorld, 1);
    assert.equal(byId['lostcitylabs']!.worlds?.source.kind, 'static');
    assert.equal(byId['lostcitylabs']!.worlds?.detail, false);
    assert.equal(byId['singleplayer']!.worlds, null);
    for (const server of DEFAULT_SERVERS) {
        if (server.worlds) assert.ok(isWorldsDef(server.worlds), `${server.id} worlds must validate`);
        if (server.hiscores) assert.ok(server.hiscores.source.url.includes('{name}'), `${server.id} hiscores must take a name`);
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
        // `hosts` is the allowlist page tabs will consult once they land, and
        // "Full hiscores" names a page a tab ought to be able to open, so the
        // site's host belongs on it — even while that link goes out to the
        // system browser instead, page tabs being unbuilt. The list is not
        // idle in the meantime: `Catalog.refreshHiscores` tests a stored
        // entry's own url host against this same array before it will adopt a
        // built-in's lookup, so these arrays are read on every launch and
        // pruning one is never free.
        if (server.hiscores?.site) assert.ok(server.hosts.includes(hostOf(server.hiscores.site)), `${server.id} must allow its hiscores host`);
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
        { ...good, hiscores: 'https://2004.lostcity.rs/api/hiscores/player/{name}' }
    ]) {
        assert.equal(isServerDef(bad), false, `${JSON.stringify(bad).slice(0, 60)} must be rejected`);
    }
});

const withHiscores = (hiscores: unknown): unknown => ({ ...DEFAULT_SERVERS[0]!, hiscores });

test('isServerDef accepts a well-formed hiscores block', () => {
    assert.equal(isServerDef(withHiscores({ source: { kind: 'labs', url: 'https://x.example/p?name={name}' }, site: null })), true);
});

test('isServerDef rejects a hiscores block with no source', () => {
    assert.equal(isServerDef(withHiscores({ site: null })), false);
});

test('isServerDef rejects a hiscores block whose source is not an object', () => {
    assert.equal(isServerDef(withHiscores({ source: 'https://x.example/{name}', site: null })), false);
});

test('isServerDef rejects a hiscores source kind nothing knows how to read', () => {
    assert.equal(isServerDef(withHiscores({ source: { kind: 'runescape', url: 'https://x.example/{name}' }, site: null })), false);
});

test('isServerDef rejects a hiscores url that is not a string', () => {
    assert.equal(isServerDef(withHiscores({ source: { kind: 'lostcity', url: 42 }, site: null })), false);
});

test('isServerDef rejects a hiscores url with nowhere to put the name', () => {
    assert.equal(isServerDef(withHiscores({ source: { kind: 'lostcity', url: 'https://x.example/api/hiscores/player/' }, site: null })), false);
});

test('isServerDef rejects a hiscores site that is neither a page nor null', () => {
    assert.equal(isServerDef(withHiscores({ source: { kind: 'lostcity', url: 'https://x.example/{name}' }, site: 5 })), false);
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

/** The only `hiscores` string a version 3 file could hold. */
const V3_LOSTCITY_TEMPLATE = 'https://2004.lostcity.rs/api/hiscores/player/{name}';

/** The built-in entry version 4 drops, as a version 3 file stored it. */
const V3_LOCAL = {
    id: 'local',
    kind: 'remote',
    name: 'Local server',
    url: 'http://127.0.0.1:8888/rs2.cgi?lowmem=1',
    revision: 289,
    wiki: null,
    map: null,
    hosts: ['127.0.0.1:8888'],
    notes: null,
    worlds: null,
    bookmarks: [],
    hiscores: null
};

/** A version 3 Lost City entry: everything the built-in had, with the bare template. */
const V3_LOSTCITY = {
    id: 'lostcity',
    kind: 'remote',
    name: 'Lost City',
    url: 'https://w5-2004.lostcity.rs/rs2.cgi?plugin=0&world=5&lowmem=1',
    revision: 274,
    wiki: { home: 'https://2004.losthq.rs/', search: null },
    map: 'https://tools.losthq.rs/map',
    hosts: ['w5-2004.lostcity.rs', '2004.losthq.rs'],
    notes: null,
    worlds: {
        source: { kind: 'losthq', url: 'https://2004.losthq.rs/pages/api/worlds.php' },
        template: 'https://w{world}-2004.lostcity.rs/rs2.cgi?plugin=0&world={world}&lowmem={lowmem}',
        detail: true,
        defaultWorld: 5
    },
    bookmarks: [{ name: 'Quest guides', url: 'https://2004.losthq.rs/?p=questguides' }],
    hiscores: V3_LOSTCITY_TEMPLATE
};

/** One the user typed in themselves, with every field filled so the migration has something to lose. */
const V3_CUSTOM = {
    id: 'my-server',
    kind: 'remote',
    name: 'My Server',
    url: 'https://play.example.com/rs2.cgi?lowmem=1',
    revision: 289,
    wiki: { home: 'https://wiki.example.com/', search: 'https://wiki.example.com/?q={query}' },
    map: 'https://map.example.com/',
    hosts: ['play.example.com', 'wiki.example.com'],
    notes: 'the one I run for friends',
    worlds: null,
    bookmarks: [{ name: 'Forum', url: 'https://forum.example.com/' }],
    hiscores: null
};

/** Zanaris as version 3 stored it: no `hiscores` at all, though the server has had the API all along. */
const V3_ZANARIS = {
    id: 'zanaris',
    kind: 'remote',
    name: 'Zanaris',
    url: 'https://w1.04.zanaris.rs/rs2.cgi?lowmem=1',
    revision: 274,
    wiki: { home: 'https://2004.losthq.rs/', search: null },
    map: 'https://tools.losthq.rs/map',
    hosts: ['w1.04.zanaris.rs', '2004.losthq.rs'],
    notes: null,
    worlds: {
        source: { kind: 'zanaris', url: 'https://zanaris.rs/worlds.json' },
        template: '{url}/rs2.cgi?lowmem={lowmem}',
        detail: true,
        defaultWorld: 1
    },
    bookmarks: [],
    hiscores: null
};

/**
 * A local server the user added themselves, which version 4 makes possible:
 * with the built-in gone, `slugify('Local')` is free for the add form to take.
 */
const V4_USER_LOCAL = {
    id: 'local',
    kind: 'remote',
    name: 'Local',
    url: 'http://127.0.0.1:8080/rs2.cgi?lowmem=1',
    revision: 274,
    wiki: null,
    map: null,
    hosts: ['127.0.0.1:8080'],
    notes: 'the world I run here',
    worlds: null,
    bookmarks: [],
    hiscores: null
};

const v3File = (): Record<string, unknown> => ({
    version: 3,
    servers: structuredClone([V3_LOSTCITY, V3_LOCAL, V3_CUSTOM])
});

test('a v3 file loses the local entry and keeps the rest, in order', () => {
    const migrated = migrateCatalog(v3File());
    assert.ok(migrated);
    assert.deepEqual(migrated.map(s => s.id), ['lostcity', 'my-server'], 'single player superseded the local server');
});

test("a v3 file's Lost City template becomes the structured lookup, with the site the panel links to", () => {
    const migrated = migrateCatalog(v3File())!;
    assert.deepEqual(migrated[0]!.hiscores, {
        source: { kind: 'lostcity', url: V3_LOSTCITY_TEMPLATE },
        site: 'https://2004.lostcity.rs/hiscores'
    });
    assert.ok(isServerDef(migrated[0]!), 'and the entry still validates');
});

test("a v3 file's custom entry survives with every field it had", () => {
    const migrated = migrateCatalog(v3File())!;
    const mine = migrated.find(s => s.id === 'my-server')!;
    assert.equal(mine.kind, 'remote');
    assert.equal(mine.name, 'My Server');
    assert.equal(mine.url, 'https://play.example.com/rs2.cgi?lowmem=1');
    assert.equal(mine.revision, 289);
    assert.deepEqual(mine.wiki, { home: 'https://wiki.example.com/', search: 'https://wiki.example.com/?q={query}' });
    assert.equal(mine.map, 'https://map.example.com/');
    assert.deepEqual(mine.hosts, ['play.example.com', 'wiki.example.com']);
    assert.equal(mine.notes, 'the one I run for friends');
    assert.equal(mine.worlds, null);
    assert.deepEqual(mine.bookmarks, [{ name: 'Forum', url: 'https://forum.example.com/' }]);
    assert.equal(mine.hiscores, null);
});

test("a v3 hiscores template that is not Lost City's becomes null rather than a guess", () => {
    for (const template of ['https://hiscores.example.com/player/{name}', 'http://2004.lostcity.rs/api/hiscores/player/{name}', 'https://2004.lostcity.rs/api/hiscores/player/']) {
        const file = v3File();
        (file.servers as Record<string, unknown>[])[2]!.hiscores = template;
        const migrated = migrateCatalog(file)!;
        assert.equal(migrated.find(s => s.id === 'my-server')!.hiscores, null, `${template} is not one this kit can read`);
    }
});

test('a v3 entry that no longer validates fails the whole file rather than being dropped quietly', () => {
    const file = v3File();
    (file.servers as Record<string, unknown>[])[2]!.url = 'javascript:1';
    assert.equal(migrateCatalog(file), null);
});

test('Catalog.load rewrites a v3 file as version 4, keeping what the user added', () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify(v3File()));
    const catalog = new Catalog(file);
    catalog.load();
    assert.equal(catalog.recovered, false, 'a migration is not a recovery');
    assert.deepEqual(catalog.list().map(s => s.id), ['lostcity', 'my-server']);
    const written = JSON.parse(readFileSync(file, 'utf8')) as { version: number; servers: ServerDef[] };
    assert.equal(written.version, 4);
    assert.equal(written.servers.find(s => s.id === 'local'), undefined);
    assert.equal(written.servers.find(s => s.id === 'my-server')!.notes, 'the one I run for friends');
    assert.equal(written.servers[0]!.hiscores!.source.url, V3_LOSTCITY_TEMPLATE);
});

test("a version 4 file keeps a local server the user added themselves", () => {
    const servers = [...DEFAULT_SERVERS.map(s => structuredClone(s)), structuredClone(V4_USER_LOCAL)];
    const migrated = migrateCatalog({ version: 4, servers })!;
    assert.deepEqual(migrated.map(s => s.id), [...DEFAULT_SERVERS.map(s => s.id), 'local']);
    const theirs = migrated.find(s => s.id === 'local')!;
    assert.equal(theirs.name, 'Local');
    assert.equal(theirs.url, 'http://127.0.0.1:8080/rs2.cgi?lowmem=1');
    assert.equal(theirs.notes, 'the world I run here');
});

test("version 4 never shipped a local server, so even one at the old address is the user's", () => {
    const theirs = { ...structuredClone(V4_USER_LOCAL), url: 'http://127.0.0.1:8888/rs2.cgi?lowmem=1', hosts: ['127.0.0.1:8888'] };
    const migrated = migrateCatalog({ version: 4, servers: [theirs] })!;
    assert.deepEqual(migrated.map(s => s.id), ['local'], 'the drop belongs to the older versions, not this one');
});

test('a local server the user added survives the next launch and the next write', () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ version: 4, servers: [...DEFAULT_SERVERS.map(s => structuredClone(s)), V4_USER_LOCAL] }));
    const a = new Catalog(file);
    a.load();
    assert.equal(a.recovered, false);
    assert.equal(a.get('local')!.notes, 'the world I run here');
    // any later write rewrites the whole file, so a ghost entry would be erased here
    assert.ok(a.add(input({ name: 'Another' })).ok);
    const b = new Catalog(file);
    b.load();
    assert.equal(b.get('local')!.url, 'http://127.0.0.1:8080/rs2.cgi?lowmem=1');
});

test('a version 3 entry that only borrowed the local id keeps its place', () => {
    const theirs = { ...structuredClone(V4_USER_LOCAL), hiscores: null };
    const migrated = migrateCatalog({ version: 3, servers: [structuredClone(V3_LOSTCITY), theirs] })!;
    assert.deepEqual(migrated.map(s => s.id), ['lostcity', 'local'], 'only the built-in address is dropped');
});

// ── the kit's own knowledge about a built-in ──────────────────────────────

test("a version 3 file's Zanaris entry gains the lookup its null was hiding", () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ version: 3, servers: [V3_ZANARIS, V3_CUSTOM] }));
    const catalog = new Catalog(file);
    catalog.load();
    assert.equal(catalog.recovered, false);
    assert.deepEqual(catalog.get('zanaris')!.hiscores, DEFAULT_SERVERS.find(s => s.id === 'zanaris')!.hiscores);
    assert.equal(catalog.get('my-server')!.hiscores, null, "and a server of the user's own gains nothing");
    // written back, so the next launch does not have to work it out again
    const written = JSON.parse(readFileSync(file, 'utf8')) as { servers: ServerDef[] };
    assert.equal(written.servers.find(s => s.id === 'zanaris')!.hiscores!.source.url, 'https://zanaris.rs/api/hiscores/player/{name}');
});

test('a stored built-in whose lookup has moved is brought up to date, and the file rewritten', () => {
    const file = tempFile();
    const servers = DEFAULT_SERVERS.map(s => structuredClone(s) as ServerDef);
    servers.find(s => s.id === 'lostcitylabs')!.hiscores = { source: { kind: 'labs', url: 'https://old.lostcitylabs.com/hiscores/player?name={name}' }, site: null };
    writeFileSync(file, JSON.stringify({ version: 4, servers }));
    const catalog = new Catalog(file);
    catalog.load();
    assert.deepEqual(catalog.get('lostcitylabs')!.hiscores, DEFAULT_SERVERS.find(s => s.id === 'lostcitylabs')!.hiscores);
    const written = JSON.parse(readFileSync(file, 'utf8')) as { servers: ServerDef[] };
    assert.equal(written.servers.find(s => s.id === 'lostcitylabs')!.hiscores!.site, 'https://www.lostcitylabs.com/hiscores');
});

test('a built-in entry whose stored url has no scheme costs the user nothing', () => {
    const file = tempFile();
    const zanaris = { ...structuredClone(V3_ZANARIS), url: 'w1.04.zanaris.rs/rs2.cgi?lowmem=1' };
    writeFileSync(file, JSON.stringify({ version: 4, servers: [zanaris, structuredClone(V3_CUSTOM)] }));
    const catalog = new Catalog(file);
    catalog.load();
    assert.equal(catalog.recovered, false, 'a hand-edited address must not cost the user their catalog');
    assert.deepEqual(catalog.list().map(s => s.id), ['zanaris', 'my-server']);
    assert.equal(catalog.get('my-server')!.notes, 'the one I run for friends', "and the user's own entry is still there");
    assert.deepEqual(catalog.get('zanaris')!.hiscores, DEFAULT_SERVERS.find(s => s.id === 'zanaris')!.hiscores, 'read as https, the host matches');
    assert.equal(readdirSync(join(file, '..')).some(n => n.startsWith('servers.json.broken-')), false, 'nothing was renamed aside');
});

test("an entry that claims a built-in's id and host but is a different kind of server keeps its own", () => {
    const file = tempFile();
    const theirs = { ...structuredClone(V3_LOSTCITY), kind: 'singleplayer', hiscores: null };
    writeFileSync(file, JSON.stringify({ version: 4, servers: [theirs] }));
    const catalog = new Catalog(file);
    catalog.load();
    assert.equal(catalog.get('lostcity')!.hiscores, null, 'a single-player world is not the remote one it is named after');
});

test("a server of the user's own that took a built-in id keeps its own hiscores", () => {
    const file = tempFile();
    const theirs = { ...structuredClone(V3_CUSTOM), id: 'zanaris', name: 'Zanaris', hiscores: null };
    writeFileSync(file, JSON.stringify({ version: 4, servers: [theirs] }));
    const catalog = new Catalog(file);
    catalog.load();
    assert.equal(catalog.get('zanaris')!.hiscores, null, 'the id matches a built-in; the server does not');
    assert.equal(catalog.get('zanaris')!.url, 'https://play.example.com/rs2.cgi?lowmem=1');
});

test('a version 4 file round-trips through load untouched', () => {
    const file = tempFile();
    const servers = [...DEFAULT_SERVERS.map(s => structuredClone(s) as ServerDef), structuredClone(V3_CUSTOM) as ServerDef];
    const before = `${JSON.stringify({ version: 4, servers }, null, 2)}\n`;
    writeFileSync(file, before);
    const catalog = new Catalog(file);
    catalog.load();
    assert.equal(catalog.recovered, false);
    assert.deepEqual(catalog.list(), servers);
    assert.equal(readFileSync(file, 'utf8'), before, 'nothing to upgrade, so nothing rewritten');
});

test('migrateCatalog turns a v1 file into the new built-ins in default order plus the custom entries', () => {
    const custom = OLD('my-server', 'My Server', 'https://play.example.com/rs2.cgi');
    const migrated = migrateCatalog({ version: 1, servers: [...V1_BUILTINS, custom] });
    assert.ok(migrated);
    assert.deepEqual(migrated.map(s => s.id), ['lostcity', 'zanaris', 'lostcitylabs', 'singleplayer', 'my-server']);
    assert.equal(migrated[0]!.worlds?.source.kind, 'losthq');
    assert.equal(migrated[0]!.hiscores?.source.kind, 'lostcity', 'the built-in brings its own lookup');
    const mine = migrated[4]!;
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
    assert.equal(migrateCatalog({ version: 5, servers: [] }), null);
    assert.equal(migrateCatalog({ version: 1, servers: [{ id: 'x' }] }), null);
    assert.equal(migrateCatalog({ version: 2, servers: [{ ...DEFAULT_SERVERS[0], worlds: 'nope' }] }), null);
});

test('Catalog.load migrates a v1 file in place and rewrites it as v4', () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ version: 1, servers: V1_BUILTINS }));
    const catalog = new Catalog(file);
    catalog.load();
    assert.equal(catalog.recovered, false, 'a migration is not a recovery');
    assert.deepEqual(catalog.list().map(s => s.id), ['lostcity', 'zanaris', 'lostcitylabs', 'singleplayer']);
    const written = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(written.version, 4);
    assert.equal(written.servers[0].id, 'lostcity');
});

test('a stored single-player entry follows the pinned engine, keeping the rest of the entry', () => {
    const file = tempFile();
    const servers = DEFAULT_SERVERS.map(s => structuredClone(s) as ServerDef);
    const stored = servers.find(s => s.id === 'singleplayer')!;
    stored.revision = 1;
    stored.bookmarks = [{ name: 'Mine', url: 'https://example.com/' }];
    writeFileSync(file, JSON.stringify({ version: 4, servers }));
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
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 4);
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
    assert.equal(a.remove('lostcitylabs'), true);
    assert.equal(a.remove('lostcitylabs'), false);
    const b = new Catalog(file);
    b.load();
    assert.equal(b.get('lostcitylabs'), undefined);
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
