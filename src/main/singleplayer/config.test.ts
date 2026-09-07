import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameUrl, parseVersion, stampMatches, worldJson } from './config.ts';

const ports = { web: 40001, management: 40002, tcp: 40003 };

test('worldJson binds loopback, disables the servers, and sets the staff level from cheats', () => {
    const off = JSON.parse(worldJson({ ports, cheats: false, revision: 274 }));
    assert.equal(off.web.port, 40001);
    assert.equal(off.web.managementPort, 40002);
    assert.equal(off.web.host, '127.0.0.1');
    assert.equal(off.node.port, 40003);
    assert.equal(off.node.host, '127.0.0.1');
    assert.equal(off.node.production, false);
    assert.equal(off.node.localStaffLevel, 0);
    assert.equal(off.node.id, 1);
    assert.equal(off.node.members, true);
    assert.equal(off.node.maxConnected, 10);
    assert.equal(off.engine.revision, 274);
    assert.equal(off.login.enabled, false);
    assert.equal(off.friend.enabled, false);
    assert.equal(off.logger.enabled, false);
    assert.equal(off.build.liveReload, false);
    assert.equal(off.build.startup, false);
    // The engine's GameMap.init() returns without loading anything - no npcs, objs,
    // locs or collision - when <srcDir>/maps is absent, so this has to be a real
    // directory the kit ships and copies into the working directory.
    assert.equal(off.build.srcDir, 'content');
    assert.equal(off.easyStartup, false);
    assert.equal(off.account.autoCreate, false);
    const on = JSON.parse(worldJson({ ports, cheats: true, revision: 274 }));
    assert.equal(on.node.localStaffLevel, 4);
    assert.equal(on.node.production, false);
});

test('gameUrl puts the port on the catalog url and keeps its query', () => {
    assert.equal(gameUrl('http://127.0.0.1/rs2.cgi?lowmem=1', 40001), 'http://127.0.0.1:40001/rs2.cgi?lowmem=1');
    assert.equal(gameUrl('http://127.0.0.1:8888/rs2.cgi', 40001), 'http://127.0.0.1:40001/rs2.cgi');
});

test('parseVersion accepts the stage script output and rejects anything else', () => {
    const text = JSON.stringify({ engine: { repo: 'r', commit: 'abc' }, content: { repo: 'c', commit: 'def' }, revision: 274, built: '2026-09-06T00:00:00.000Z' });
    assert.deepEqual(parseVersion(text), { engine: 'abc', content: 'def', revision: 274, built: '2026-09-06T00:00:00.000Z' });
    assert.equal(parseVersion('not json'), null);
    assert.equal(parseVersion(JSON.stringify({ engine: {}, content: {}, revision: 274, built: 'x' })), null);
    assert.equal(parseVersion(JSON.stringify({ engine: { commit: 'a' }, content: { commit: 'b' }, revision: 'x', built: 'x' })), null);
});

test('stampMatches compares the stamp with the version text exactly, ignoring trailing whitespace', () => {
    assert.equal(stampMatches('{"a":1}\n', '{"a":1}'), true);
    assert.equal(stampMatches('{"a":1}', '{"a":2}'), false);
    assert.equal(stampMatches(null, '{"a":1}'), false);
});
