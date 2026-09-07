// npm run dist: a local package for this platform, never published.
// Stages the engine first when engine-dist/ is missing or stale, and checks
// afterwards that the packaged app carries a complete engine.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const onWindows = process.platform === 'win32';
const npm = onWindows ? 'npm.cmd' : 'npm';
const run = args => execFileSync(npm, args, { stdio: 'inherit', shell: onWindows });
const log = msg => console.log(`[dist] ${msg}`);

// ── stage when there is no stage, or the stage is of another pin ──────────
//
// engine-dist/VERSION.json records the commits it was built from. A lock
// bumped since the last stage leaves a tree that looks complete and ships the
// wrong engine, so the commits are compared rather than the directory's
// existence alone.
function stageReason() {
    if (!existsSync('engine-dist/VERSION.json')) return 'engine-dist/VERSION.json is missing';
    let version;
    try {
        version = JSON.parse(readFileSync('engine-dist/VERSION.json', 'utf8'));
    } catch (err) {
        return `engine-dist/VERSION.json could not be read: ${String(err)}`;
    }
    const lock = JSON.parse(readFileSync('engine.lock.json', 'utf8'));
    for (const part of ['engine', 'content']) {
        const staged = version[part]?.commit;
        const pinned = lock[part].commit;
        if (staged !== pinned) return `${part}.commit is ${staged ?? '(absent)'} in the stage, ${pinned} in engine.lock.json`;
    }
    return null;
}

const reason = stageReason();
if (reason === null) {
    log('engine-dist is at the pinned engine and content commits; not staging');
} else {
    log(`staging the engine: ${reason}`);
    run(['run', 'stage:engine']);
}

run(['run', 'build']);
run(['exec', '--', 'electron-builder', '--publish', 'never']);

// ── the packaged engine is complete ──────────────────────────────────────
//
// electron-builder drops the top-level node_modules of a copy root, so an
// engine can be packaged with every source file and no dependency at all and
// nothing complains until a user launches it. A source file, a dependency and
// the pack's hidden cache are checked, in the app this run just built.
function packagedEngine() {
    if (process.platform === 'darwin') return join('release', 'mac-universal', 'Zanaris Kit.app', 'Contents', 'Resources', 'engine');
    const unpacked = existsSync('release')
        ? readdirSync('release', { withFileTypes: true }).find(entry => entry.isDirectory() && entry.name.endsWith('-unpacked'))
        : undefined;
    if (!unpacked) throw new Error('no release/*-unpacked directory: cannot check the packaged engine');
    return join('release', unpacked.name, 'resources', 'engine');
}

const engine = packagedEngine();
const required = [
    join('src', 'app.js'),
    join('node_modules', 'fastify', 'package.json'),
    join('data', 'pack', '.cache', 'maps-server.zip'),
    // Without this the world boots, serves the game and is empty: GameMap.init()
    // returns before loading a single map square when <srcDir>/maps is missing.
    join('content', 'maps', 'multiway.csv')
].map(path => join(engine, path));
const missing = required.filter(path => !existsSync(path));
if (missing.length > 0) {
    throw new Error(`the packaged engine in ${engine} is incomplete: ${missing.join(', ')} missing. Check extraResources in electron-builder.yml.`);
}
log(`packaged engine complete in ${engine}: ${required.join(', ')} present`);
