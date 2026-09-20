import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldJson } from '../yourworld/config.ts';
import { DEFAULT_YOUR_WORLD_SETTINGS } from '../../shared/yourworld.ts';

/*
 * Sharing tunnels the world's web port and nothing else. That is only safe
 * because of what worldJson writes: with node.debug on, the engine also serves
 * /data/ (the RSA key, world.json and every save), /content/ and a PUT that
 * writes into it, to anyone the port is reachable from. If one of these has to
 * change, sharing has to change first.
 */
const world = JSON.parse(worldJson({ ports: { web: 40001, management: 40002, tcp: 40003 }, settings: { ...DEFAULT_YOUR_WORLD_SETTINGS, cheats: true }, revision: 274 }));

test('a shared world never runs in debug mode, which would serve its saves and key over the link', () => {
    assert.equal(world.node.debug, false);
});

test('a shared world still binds loopback only, so the tunnel is the one way in', () => {
    assert.equal(world.web.host, '127.0.0.1');
    assert.equal(world.node.host, '127.0.0.1');
});

test('the management port, which can shut the world down, is a different port from the one the relay forwards to', () => {
    assert.notEqual(world.web.managementPort, world.web.port);
});
