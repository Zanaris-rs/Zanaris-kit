import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    expandTemplate,
    worldUrl,
    worldEndpoint,
    parseLosthqWorlds,
    parseZanarisWorlds,
    parseZanarisWorldInfo,
    staticWorlds,
    listWorlds,
    isWorldsDef
} from './sources.ts';
import type { WorldsDef } from '../../shared/worlds.ts';

const fixture = (name: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8'));

const LOSTCITY: WorldsDef = {
    source: { kind: 'losthq', url: 'https://2004.losthq.rs/pages/api/worlds.php' },
    template: 'https://w{world}-2004.lostcity.rs/rs2.cgi?plugin=0&world={world}&lowmem={lowmem}',
    detail: true,
    defaultWorld: 5
};
const ZANARIS: WorldsDef = {
    source: { kind: 'zanaris', url: 'https://zanaris.rs/worlds.json' },
    template: '{url}/rs2.cgi?lowmem={lowmem}',
    detail: true,
    defaultWorld: 1
};
const LABS: WorldsDef = {
    source: { kind: 'static', worlds: [1, 2, 3, 4].map(id => ({ id, name: `World ${id}`, region: 'Germany', members: true })) },
    template: 'https://www.lostcitylabs.com/play/world-{world}/',
    detail: false,
    defaultWorld: 1
};

// ── templates ─────────────────────────────────────────────────────────────

test('expandTemplate fills world and detail for Lost City', () => {
    assert.equal(
        expandTemplate(LOSTCITY.template, { world: 5, origin: null, detail: 'low' }),
        'https://w5-2004.lostcity.rs/rs2.cgi?plugin=0&world=5&lowmem=1'
    );
    assert.equal(
        expandTemplate(LOSTCITY.template, { world: 5, origin: null, detail: 'high' }),
        'https://w5-2004.lostcity.rs/rs2.cgi?plugin=0&world=5&lowmem=0'
    );
});

test('expandTemplate uses the origin for Zanaris and refuses to guess one', () => {
    assert.equal(expandTemplate(ZANARIS.template, { world: 1, origin: 'https://w1.04.zanaris.rs', detail: 'low' }), 'https://w1.04.zanaris.rs/rs2.cgi?lowmem=1');
    assert.throws(() => expandTemplate(ZANARIS.template, { world: 1, origin: null, detail: 'low' }), /origin/);
});

test('expandTemplate ignores detail when the template has no lowmem, and leaves unknown placeholders alone', () => {
    assert.equal(expandTemplate(LABS.template, { world: 3, origin: null, detail: 'high' }), 'https://www.lostcitylabs.com/play/world-3/');
    assert.equal(expandTemplate('https://x.example/{world}/{foo}', { world: 2, origin: null, detail: 'low' }), 'https://x.example/2/{foo}');
});

test('worldUrl takes the origin from the world when the template needs it', () => {
    const world = { id: 1, name: 'World 1', region: null, members: null, players: null, origin: 'https://w1.04.zanaris.rs' };
    assert.equal(worldUrl(ZANARIS, world, 'high'), 'https://w1.04.zanaris.rs/rs2.cgi?lowmem=0');
});

test('worldEndpoint takes the port from the scheme unless the url names one', () => {
    assert.deepEqual(worldEndpoint('https://w5-2004.lostcity.rs/rs2.cgi?x=1'), { host: 'w5-2004.lostcity.rs', port: 443 });
    assert.deepEqual(worldEndpoint('http://127.0.0.1:8888/rs2.cgi'), { host: '127.0.0.1', port: 8888 });
    assert.deepEqual(worldEndpoint('http://example.com/'), { host: 'example.com', port: 80 });
});

// ── LostHQ ────────────────────────────────────────────────────────────────

test('parseLosthqWorlds reads the real payload: string ids, gaps, regions, members, players, origin', () => {
    const worlds = parseLosthqWorlds(fixture('losthq-worlds.json'));
    assert.deepEqual(
        worlds.map(w => w.id),
        [1, 2, 3, 5, 7]
    );
    assert.deepEqual(
        worlds.map(w => w.members),
        [false, true, true, true, true]
    );
    assert.equal(worlds[0]!.region, 'US (East)');
    assert.equal(worlds[3]!.region, 'Australia');
    assert.equal(worlds[3]!.players, 24);
    assert.equal(worlds[3]!.origin, 'https://w5-2004.lostcity.rs');
    assert.equal(worlds[3]!.name, 'World 5');
});

test('the Lost City template reproduces the payload urls exactly', () => {
    const raw = fixture('losthq-worlds.json') as { world: string; hd: string; ld: string }[];
    for (const entry of raw) {
        const id = Number(entry.world);
        assert.equal(expandTemplate(LOSTCITY.template, { world: id, origin: null, detail: 'low' }), entry.ld);
        assert.equal(expandTemplate(LOSTCITY.template, { world: id, origin: null, detail: 'high' }), entry.hd);
    }
});

test('parseLosthqWorlds sorts by id and rejects junk', () => {
    const sorted = parseLosthqWorlds([
        { world: '7', location: 'x', count: 1, p2p: true, hd: 'https://w7-2004.lostcity.rs/a', ld: 'https://w7-2004.lostcity.rs/b' },
        { world: '2', location: 'y', count: 2, p2p: false, hd: 'https://w2-2004.lostcity.rs/a', ld: 'https://w2-2004.lostcity.rs/b' }
    ]);
    assert.deepEqual(
        sorted.map(w => w.id),
        [2, 7]
    );
    for (const bad of [null, {}, [{ location: 'x' }], [{ world: 'abc' }], [{ world: '1', ld: 'nope' }], [{ world: '1', ld: 'https://a.example/' }, { world: '1', ld: 'https://a.example/' }]]) {
        assert.throws(() => parseLosthqWorlds(bad), `${JSON.stringify(bad)} must be rejected`);
    }
});

// ── Zanaris ───────────────────────────────────────────────────────────────

test('parseZanarisWorlds reads worlds.json and trims a trailing slash off the origin', () => {
    const worlds = parseZanarisWorlds(fixture('zanaris-worlds.json'));
    assert.deepEqual(worlds, [{ id: 1, name: 'World 1', region: 'US-East', members: true, players: null, origin: 'https://w1.04.zanaris.rs' }]);
    const slashed = parseZanarisWorlds([{ id: 2, name: 'World 2', region: 'EU', members: false, url: 'https://w2.04.zanaris.rs/' }]);
    assert.equal(slashed[0]!.origin, 'https://w2.04.zanaris.rs');
});

test('parseZanarisWorlds and parseZanarisWorldInfo reject junk', () => {
    for (const bad of [null, {}, [{ id: 'x' }], [{ id: 1, name: 'a', region: 'b', members: true, url: 'ftp://x' }]]) {
        assert.throws(() => parseZanarisWorlds(bad));
    }
    assert.deepEqual(parseZanarisWorldInfo(fixture('zanaris-world.json')), { players: 3, maxPlayers: 150 });
    for (const bad of [null, {}, { players: 'x' }]) assert.throws(() => parseZanarisWorldInfo(bad));
});

// ── static and the dispatcher ─────────────────────────────────────────────

test('staticWorlds lists the declared worlds with no players and no origin', () => {
    const worlds = staticWorlds(LABS.source as { kind: 'static'; worlds: { id: number; name: string; region: string | null; members: boolean | null }[] });
    assert.equal(worlds.length, 4);
    assert.deepEqual(worlds[1], { id: 2, name: 'World 2', region: 'Germany', members: true, players: null, origin: null });
});

test('listWorlds fetches once for LostHQ', async () => {
    const asked: string[] = [];
    const worlds = await listWorlds(LOSTCITY, async url => {
        asked.push(url);
        return fixture('losthq-worlds.json');
    });
    assert.deepEqual(asked, ['https://2004.losthq.rs/pages/api/worlds.php']);
    assert.equal(worlds.length, 5);
});

test('listWorlds fetches the Zanaris list then every world.json, tolerating a failed count', async () => {
    const asked: string[] = [];
    const worlds = await listWorlds(
        { ...ZANARIS },
        async url => {
            asked.push(url);
            if (url === 'https://zanaris.rs/worlds.json') {
                return [
                    { id: 1, name: 'World 1', region: 'US-East', members: true, url: 'https://w1.04.zanaris.rs' },
                    { id: 2, name: 'World 2', region: 'EU', members: true, url: 'https://w2.04.zanaris.rs' }
                ];
            }
            if (url === 'https://w1.04.zanaris.rs/world.json') return { id: 1, members: true, players: 3, maxPlayers: 150 };
            throw new Error('down');
        }
    );
    assert.deepEqual(asked, ['https://zanaris.rs/worlds.json', 'https://w1.04.zanaris.rs/world.json', 'https://w2.04.zanaris.rs/world.json']);
    assert.equal(worlds[0]!.players, 3);
    assert.equal(worlds[1]!.players, null, 'a failed count leaves the world listed');
});

test('listWorlds rejects when the list itself fails, and never fetches for a static source', async () => {
    await assert.rejects(listWorlds(LOSTCITY, async () => { throw new Error('offline'); }), /offline/);
    let fetched = 0;
    const worlds = await listWorlds(LABS, async () => { fetched += 1; return null; });
    assert.equal(fetched, 0);
    assert.equal(worlds.length, 4);
});

// ── validation ────────────────────────────────────────────────────────────

test('isWorldsDef accepts the three built-in shapes', () => {
    for (const def of [LOSTCITY, ZANARIS, LABS]) assert.ok(isWorldsDef(def));
});

test('isWorldsDef rejects inconsistent definitions', () => {
    const bad: unknown[] = [
        null,
        { ...LOSTCITY, template: 'https://x.example/{world}' },                       // detail true needs {lowmem}
        { ...LOSTCITY, template: '{url}/rs2.cgi?lowmem={lowmem}' },                 // {url} only with zanaris
        { ...LABS, source: { kind: 'static', worlds: [] } },                          // empty static list
        { ...LABS, defaultWorld: 9 },                                                  // default not in the static list
        { ...LOSTCITY, template: 42 },
        { ...LOSTCITY, source: { kind: 'nope', url: 'https://x' } },
        { ...LOSTCITY, source: { kind: 'losthq', url: 'ftp://x' } }
    ];
    for (const def of bad) assert.equal(isWorldsDef(def), false, `${JSON.stringify(def)} must be rejected`);
});
