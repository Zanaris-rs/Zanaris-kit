import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertPack, classify, findNativeModules, hasTsUrl, rewriteWorkerUrls, staticNpcs } from './stage-lib.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'stage-lib-'));

test('rewriteWorkerUrls turns .ts worker entries into .js, only inside new URL()', () => {
    const before = [
        "new Worker(new URL('./login.ts', import.meta.url));",
        'new Worker(new URL("../server/login/LoginThread.ts", import.meta.url));',
        "const x = new Worker(new URL( './friend.ts', import.meta.url ));",
        "const name = 'not-a-url.ts';",
        "import('#tools/pack/PackAll.js');"
    ].join('\n');
    const after = rewriteWorkerUrls(before);
    assert.match(after, /new URL\('\.\/login\.js', import\.meta\.url\)/);
    assert.match(after, /new URL\("\.\.\/server\/login\/LoginThread\.js", import\.meta\.url\)/);
    assert.match(after, /new URL\( '\.\/friend\.js', import\.meta\.url \)/);
    assert.match(after, /const name = 'not-a-url\.ts';/);
    assert.equal(hasTsUrl(after), false);
    assert.equal(hasTsUrl(before), true);
});

test('classify: every .ts transformed, including .d.ts; everything else copied', () => {
    assert.equal(classify('server/login/index.d.ts'), 'transform');
    assert.equal(classify('app.ts'), 'transform');
    assert.equal(classify('3rdparty/bzip2-wasm/bzip2.wasm'), 'copy');
    assert.equal(classify('3rdparty/ws-sync/ws-sync.js'), 'copy');
    assert.equal(classify('pack/map/Pack.js'), 'copy');
});

function packFixture({ idx0Bytes = 54, script = true, maps = true } = {}) {
    const dir = scratch();
    mkdirSync(join(dir, 'server'), { recursive: true });
    mkdirSync(join(dir, '.cache'), { recursive: true });
    writeFileSync(join(dir, 'main_file_cache.idx0'), Buffer.alloc(idx0Bytes));
    if (script) writeFileSync(join(dir, 'server', 'script.dat'), '');
    if (maps) writeFileSync(join(dir, '.cache', 'maps-server.zip'), '');
    return dir;
}

test('assertPack accepts nine archives with the required files', () => {
    assert.deepEqual(assertPack(packFixture()), { archives: 9 });
});

test('assertPack rejects a missing idx0', () => {
    const dir = scratch();
    assert.throws(() => assertPack(dir), /missing .*main_file_cache\.idx0/);
});

test('assertPack rejects an idx0 that is not a multiple of 6', () => {
    assert.throws(() => assertPack(packFixture({ idx0Bytes: 55 })), /55 bytes, not a multiple of 6/);
});

test('assertPack rejects the wrong archive count', () => {
    assert.throws(() => assertPack(packFixture({ idx0Bytes: 48 })), /expected 9 cache archives in idx0, found 8/);
});

test('assertPack rejects a pack without script.dat or maps-server.zip', () => {
    assert.throws(() => assertPack(packFixture({ script: false })), /missing .*script\.dat/);
    assert.throws(() => assertPack(packFixture({ maps: false })), /missing .*maps-server\.zip/);
});

test('findNativeModules lists every .node file, relative, and nothing else', () => {
    const dir = scratch();
    mkdirSync(join(dir, 'fsevents'), { recursive: true });
    mkdirSync(join(dir, '@prisma', 'engines'), { recursive: true });
    writeFileSync(join(dir, 'fsevents', 'fsevents.node'), '');
    writeFileSync(join(dir, '@prisma', 'engines', 'libquery_engine.dylib.node'), '');
    writeFileSync(join(dir, 'fsevents', 'index.js'), '');
    assert.deepEqual(findNativeModules(dir).sort(), ['@prisma/engines/libquery_engine.dylib.node', 'fsevents/fsevents.node']);
    assert.deepEqual(findNativeModules(scratch()), []);
});

test('staticNpcs reads the game map line, and says nothing when the map never loaded', () => {
    const ready = '07/09/2026 13:04:17\t INFO\t Starting world\n07/09/2026 13:04:17\t DEBUG\t Loaded 10940 scripts.\n';
    // What 0.1.0 shipped: boots, serves, reports ready, and is empty.
    assert.equal(staticNpcs(`${ready}07/09/2026 13:04:17\t INFO\t World ready: Visit http://localhost:54629/rs2.cgi\n`), null);
    assert.equal(staticNpcs(`${ready}\t DEBUG\t Loading game map\n\t DEBUG\t 3491/8192 static NPCs added\n`), 3491);
    // A map that loaded but spawned nothing is a broken pack, not a healthy world.
    assert.equal(staticNpcs('\t DEBUG\t 0/8192 static NPCs added\n'), 0);
    // A reload after the first boot must not be read as the first count.
    assert.equal(staticNpcs('1/8192 static NPCs added\n2/8192 static NPCs added\n'), 2);
});
