import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertPack, classify, commandsJson, debugprocGroup, findNativeModules, findSymlinks, hasTsUrl, parseDebugprocs, patchStamp, readPatches, rewriteWorkerUrls, staticNpcs } from './stage-lib.mjs';
import { readCommandsFile } from '../src/shared/commands.ts';

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

test('findSymlinks lists every link, relative, and follows none of them', { skip: process.platform === 'win32' }, () => {
    const dir = scratch();
    mkdirSync(join(dir, 'node_modules', 'tsx', 'dist'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'tsx', 'dist', 'cli.mjs'), '');
    mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true });
    symlinkSync('../tsx/dist/cli.mjs', join(dir, 'node_modules', '.bin', 'tsx'));
    // A link to a directory is reported, not walked into.
    symlinkSync('tsx', join(dir, 'node_modules', 'alias'));
    assert.deepEqual(findSymlinks(dir).sort(), ['node_modules/.bin/tsx', 'node_modules/alias']);
    assert.deepEqual(findSymlinks(scratch()), []);
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

test('readPatches lists only .patch files, in apply order, and digests them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'patches-'));
    writeFileSync(join(dir, '0002-b.patch'), 'two');
    writeFileSync(join(dir, '0001-a.patch'), 'one');
    writeFileSync(join(dir, 'README.md'), 'not a patch');
    const patches = readPatches(dir);
    assert.deepEqual(patches.map(p => p.name), ['0001-a.patch', '0002-b.patch']);
    // sha256('one'), so the digest is of the file's bytes and nothing else.
    assert.equal(patches[0].sha256, '7692c3ad3540bb803c020b3aee66cd8887123234ea0c6e7143c0add73ff431ed');
    // An absent directory is no patches: the day upstream merges them it is deleted.
    assert.deepEqual(readPatches(join(dir, 'gone')), []);
    // An edit has to move the stamp, or the next stage applies a new patch over an old one.
    const before = patchStamp(patches);
    writeFileSync(join(dir, '0001-a.patch'), 'one, amended');
    assert.notEqual(patchStamp(readPatches(dir)), before);
    rmSync(dir, { recursive: true, force: true });
});

test('parseDebugprocs reads names, typed params and notes, and nothing that is not a declaration', () => {
    const text = [
        '// official name',
        '[debugproc,maxme]',
        'stat_advance(attack, 0);',
        '[debugproc,addxp](stat $stat, int $amount)',
        '[debugproc,west](int $distance)//Direction teleport west',
        '[debugproc,cq] @debug_completequests; // Complete all quests',
        '[debugproc,pp1] if (p_finduid(uid) = true) p_telejump(0_53_54_15_33);',
        '[proc,not_a_debugproc](int $x)',
        '  [debugproc,indented]',
        '[debugproc,lf]// legends fire'
    ].join('\n');
    const proc = (name, params = [], note = null) => ({ kind: 'debugproc', name, params, note, group: 'cheats' });
    assert.deepEqual(parseDebugprocs(text, '_test/scripts/cheats/cheat_x.rs2'), [
        proc('maxme'),
        proc('addxp', [
            { type: 'stat', name: 'stat' },
            { type: 'int', name: 'amount' }
        ]),
        proc('west', [{ type: 'int', name: 'distance' }], 'Direction teleport west'),
        proc('cq', [], 'Complete all quests'),
        proc('pp1'),
        proc('lf', [], 'legends fire')
    ]);
});

test('parseDebugprocs reads Windows line endings without keeping the carriage return', () => {
    const text = ['[debugproc,a]//first', '[debugproc,b]'].join(String.fromCharCode(13, 10));
    assert.deepEqual(
        parseDebugprocs(text, 'quests/quest_x/scripts/quest_x.rs2').map(p => [p.name, p.note, p.group]),
        [
            ['a', 'first', 'quests'],
            ['b', null, 'quests']
        ]
    );
});

test('debugprocGroup is the folder under _test/scripts, or the first folder otherwise', () => {
    assert.equal(debugprocGroup('_test/scripts/cheats/cheat_bank.rs2'), 'cheats');
    assert.equal(debugprocGroup('_test/scripts/engine/debug_pos.rs2'), 'engine');
    assert.equal(debugprocGroup('quests/quest_eadgar/scripts/quest_eadgar.rs2'), 'quests');
    assert.equal(debugprocGroup('_test/scripts/loose.rs2'), '_test');
});

test('commandsJson puts cheats first, then the other test folders, then the rest, each by name, and refuses a name declared twice', () => {
    const p = (name, group) => ({ kind: 'debugproc', name, params: [], note: null, group });
    const written = JSON.parse(commandsJson([p('zz', 'quests'), p('b', 'engine'), p('a', 'debug'), p('maxme', 'cheats'), p('bank', 'cheats')]));
    assert.equal(written.version, 1);
    assert.deepEqual(
        written.debugprocs.map(x => x.name),
        ['bank', 'maxme', 'a', 'b', 'zz']
    );
    assert.throws(() => commandsJson([p('a', 'cheats'), p('a', 'debug')]), /declared twice/);
});

test('what commandsJson writes, the kit reads back whole', () => {
    const procs = parseDebugprocs(['[debugproc,addxp](stat $stat, int $amount)//Add xp', '[debugproc,maxme]'].join('\n'), '_test/scripts/cheats/c.rs2');
    assert.deepEqual(readCommandsFile(commandsJson(procs)), [
        {
            kind: 'debugproc',
            name: 'addxp',
            params: [
                { name: 'stat', type: 'stat', optional: false },
                { name: 'amount', type: 'int', optional: false }
            ],
            note: 'Add xp',
            group: 'cheats'
        },
        { kind: 'debugproc', name: 'maxme', params: [], note: null, group: 'cheats' }
    ]);
});
