#!/usr/bin/env node
// Turns engine.lock.json into engine-dist/: the Lost City engine and packed
// cache the kit carries, precompiled to plain JavaScript, with production
// node_modules and no native binaries, so one tree serves every platform.
// Spec: docs/superpowers/specs/2026-09-06-packaging-and-single-player-design.md, Part 1.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { assertPack, classify, findNativeModules, hasTsUrl, patchStamp, readPatches, rewriteWorkerUrls, staticNpcs } from './stage-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(join(root, 'engine.lock.json'), 'utf8'));
const work = join(root, '.engine-work');
const engine = join(work, 'engine');
const content = join(work, 'content');
const dist = join(root, 'engine-dist');
// The world reads these under `<build.srcDir>/maps`; everything else the packer
// consumed is already in data/pack.
const RUNTIME_CONTENT = ['multiway.csv', 'free2play.csv'];
// What the kit changes in the upstream engine, and the file recording what a
// checkout already has applied. See patches/engine/README.md.
const patches = readPatches(join(root, lock.patches ?? 'patches/engine'));
const PATCH_STAMP = '.kit-patches';
const CONTENT_MAPS = join('content', 'maps');
const onWindows = process.platform === 'win32';
const npm = onWindows ? 'npm.cmd' : 'npm';

const log = msg => console.log(`[stage] ${msg}`);
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: onWindows });
const started = Date.now();

// ── 1. fetch ─────────────────────────────────────────────────────────────

function fetchAt(repo, commit, dir, applyPatches = []) {
    const stampPath = join(dir, PATCH_STAMP);
    const wanted = patchStamp(applyPatches);
    if (existsSync(join(dir, '.git'))) {
        // An interrupted fetch leaves .git behind with no HEAD: no head is a mismatch, so the
        // checkout is thrown away and fetched again rather than wedging every later run here.
        let head;
        try {
            head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD']).toString().trim();
        } catch {
            head = null;
        }
        // The patches are already applied in a fresh checkout, so re-applying them is not an
        // option: an edited or added patch has to throw the tree away and start from the pin.
        const applied = existsSync(stampPath) ? readFileSync(stampPath, 'utf8') : '';
        if (head === commit && applied === wanted) {
            log(`${relative(root, dir)} already at ${commit.slice(0, 8)}${applyPatches.length > 0 ? ' with its patches' : ''}`);
            return;
        }
        rmSync(dir, { recursive: true, force: true });
    }
    mkdirSync(dir, { recursive: true });
    log(`fetching ${repo} at ${commit.slice(0, 8)} into ${relative(root, dir)}`);
    run('git', ['init', '-q'], dir);
    run('git', ['fetch', '-q', '--depth', '1', repo, commit], dir);
    run('git', ['checkout', '-q', 'FETCH_HEAD'], dir);
    for (const { name } of applyPatches) {
        // No --3way and no fuzz: a patch that no longer fits the pin is a build that
        // stops, not one that quietly ships an engine missing a piece of it.
        log(`applying ${name}`);
        run('git', ['apply', join(root, lock.patches ?? 'patches/engine', name)], dir);
    }
    // Only where there is something to record: an absent stamp reads as no patches,
    // so the content checkout does not collect an empty file it has no use for.
    if (wanted !== '') writeFileSync(stampPath, wanted);
}

fetchAt(lock.engine.repo, lock.engine.commit, engine, patches);
fetchAt(lock.content.repo, lock.content.commit, content);

// ── 2. pack ──────────────────────────────────────────────────────────────

log('npm ci in the engine checkout');
run(npm, ['ci'], engine);
// The previous pack goes first. A checkout already at the pin is not fetched
// again, so a re-stage packs on top of whatever the last run left, and the
// packer appends to main_file_cache.dat rather than rewriting it: 8.8 MB cold,
// 16.9 MB after a second pack, and a stage that ships different bytes every
// time it runs. The engine's own clean (tools/pack/Clean.ts) removes
// data/pack/ along with the regenerable .pack files beside the content.
log('cleaning the previous pack (npm run clean) so this stage packs from cold');
run(npm, ['run', 'clean'], engine);
log('packing the cache (npm run build - a few minutes)');
run(npm, ['run', 'build'], engine);

// ── 3. assert ────────────────────────────────────────────────────────────

const { archives } = assertPack(join(engine, 'data', 'pack'));
log(`pack looks sane: ${archives} archives, script.dat and maps-server.zip present`);

// ── 4. transpile ─────────────────────────────────────────────────────────

function* walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(path);
        else yield path;
    }
}

// tsx hands the engine's own tsconfig to esbuild; so do we, so class fields,
// enums and the rest come out exactly as they run today.
const tsconfigRaw = readFileSync(join(engine, 'tsconfig.json'), 'utf8');

async function transpileTree(name) {
    const from = join(engine, name);
    const to = join(dist, name);
    let transformed = 0;
    let copied = 0;
    for (const abs of walk(from)) {
        const rel = relative(from, abs);
        const kind = classify(rel);
        const outPath = join(to, kind === 'transform' ? rel.replace(/\.ts$/, '.js') : rel);
        mkdirSync(dirname(outPath), { recursive: true });
        if (kind === 'copy') {
            cpSync(abs, outPath);
            copied++;
            continue;
        }
        const { code } = await transform(readFileSync(abs, 'utf8'), {
            loader: 'ts',
            format: 'esm',
            target: 'node24',
            sourcefile: abs,
            tsconfigRaw
        });
        const out = rewriteWorkerUrls(code);
        if (hasTsUrl(out)) throw new Error(`${name}/${rel}: a new URL() still names a .ts file after rewriting`);
        writeFileSync(outPath, out);
        transformed++;
    }
    log(`${name}: ${transformed} files transpiled, ${copied} copied`);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
await transpileTree('src');
await transpileTree('tools');

// ── 5. copy the runtime subset ───────────────────────────────────────────

const copyTree = (name, filter) => cpSync(join(engine, name), join(dist, name), { recursive: true, filter });
copyTree('view');
copyTree('public');
copyTree(join('data', 'pack'), src => basename(src) !== '.stamps');
copyTree(join('data', 'raw'));
mkdirSync(join(dist, 'data', 'config'), { recursive: true });
for (const pem of ['private.pem', 'public.pem']) cpSync(join(engine, 'data', 'config', pem), join(dist, 'data', 'config', pem));
for (const file of ['package.json', 'package-lock.json']) cpSync(join(engine, file), join(dist, file));

// The only part of the content the engine reads at *run* time. GameMap.init()
// returns at its first line when `<build.srcDir>/maps` is absent - no npcs, objs,
// locs or collision, in a world that still boots and says it is ready - and then
// reads these two files before unpacking data/pack/.cache/maps-server.zip. The
// rest of the content is already baked into the pack, so this is all that ships.
mkdirSync(join(dist, CONTENT_MAPS), { recursive: true });
for (const csv of RUNTIME_CONTENT) cpSync(join(content, 'maps', csv), join(dist, CONTENT_MAPS, csv));
log(`content: ${RUNTIME_CONTENT.join(', ')} for the game map`);

// ── 6. production node_modules, no compilers, no native binaries ─────────

log('npm ci --omit=dev in engine-dist (--ignore-scripts: the engine\'s prepare runs husky)');
run(npm, ['ci', '--omit=dev', '--ignore-scripts'], dist);
// fsevents is tsx's darwin-only optional dependency: absent when staging on
// Linux, a native binary when staging on a Mac, and dead either way once tsx is gone.
for (const dir of ['tsx', 'typescript', 'esbuild', '@esbuild', 'get-tsconfig', 'resolve-pkg-maps', 'fsevents']) {
    rmSync(join(dist, 'node_modules', dir), { recursive: true, force: true });
}
// Those packages left their launchers behind in .bin as symlinks pointing at
// nothing; a tree we are about to archive carries no dangling links.
const bin = join(dist, 'node_modules', '.bin');
if (existsSync(bin)) {
    for (const entry of readdirSync(bin)) {
        const path = join(bin, entry);
        if (!existsSync(path)) rmSync(path, { force: true });
    }
}
const native = findNativeModules(join(dist, 'node_modules'));
if (native.length > 0) throw new Error(`native modules in engine-dist/node_modules: ${native.join(', ')}`);
log('no native modules in node_modules');

// ── 7. VERSION.json ──────────────────────────────────────────────────────

const version = {
    engine: lock.engine,
    content: lock.content,
    // The pin alone does not say what was built: the same commits with a different
    // patch are a different engine, and the working directory re-prepares off this.
    patches,
    revision: lock.revision,
    built: new Date().toISOString()
};
writeFileSync(join(dist, 'VERSION.json'), JSON.stringify(version, null, 4) + '\n');

// ── 8. boot check ────────────────────────────────────────────────────────

const freePort = () =>
    new Promise((resolvePort, reject) => {
        const server = createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolvePort(port));
        });
    });

/** The first non-internal IPv4 on this machine, or null when there is none. */
function routableAddress() {
    for (const addresses of Object.values(networkInterfaces())) {
        for (const address of addresses ?? []) {
            if (address.family === 'IPv4' && !address.internal) return address.address;
        }
    }
    return null;
}

/** True when something accepts a TCP connection on host:port within a second. */
function reachable(host, port) {
    return new Promise(resolveReachable => {
        const socket = connect({ host, port });
        const settle = value => {
            socket.destroy();
            resolveReachable(value);
        };
        socket.setTimeout(1000, () => settle(false));
        socket.on('connect', () => settle(true));
        socket.on('error', () => settle(false));
    });
}

async function bootCheck() {
    const home = join(work, 'boot');
    rmSync(home, { recursive: true, force: true });
    for (const tree of [join('data', 'pack'), join('data', 'raw'), 'public', 'view', 'content']) {
        cpSync(join(dist, tree), join(home, tree), { recursive: true });
    }
    mkdirSync(join(home, 'data', 'config'), { recursive: true });
    for (const pem of ['private.pem', 'public.pem']) cpSync(join(dist, 'data', 'config', pem), join(home, 'data', 'config', pem));
    const [web, managementPort, tcp] = await Promise.all([freePort(), freePort(), freePort()]);
    // The same shape the kit writes at runtime, so the check exercises the patch
    // rather than a configuration nothing ships: loopback binds, and the world is
    // stopped through the management route instead of a signal.
    writeFileSync(
        join(home, 'data', 'config', 'world.json'),
        JSON.stringify(
            {
                web: { port: web, host: '127.0.0.1', managementPort },
                node: { id: 1, port: tcp, host: '127.0.0.1', production: false },
                login: { enabled: false },
                friend: { enabled: false },
                logger: { enabled: false },
                build: { liveReload: false, srcDir: 'content' }
            },
            null,
            2
        )
    );

    log(`booting the staged engine on port ${web}`);
    const child = spawn(process.execPath, [join(dist, 'src', 'app.js')], { cwd: home, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => (output += chunk));
    child.stderr.on('data', chunk => (output += chunk));
    const exited = new Promise(resolveExit => child.on('exit', resolveExit));

    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline && child.exitCode === null) {
        try {
            const res = await fetch(`http://127.0.0.1:${web}/rs2.cgi`);
            if (res.status === 200) {
                ready = true;
                break;
            }
        } catch {
            // not listening yet
        }
        await new Promise(r => setTimeout(r, 250));
    }

    // Bound to loopback, the world must not answer on a routable address. Only
    // meaningful once it is up, and only where this machine has one.
    let boundLoopbackOnly = null;
    if (ready) {
        const routable = routableAddress();
        boundLoopbackOnly = routable === null ? null : !(await reachable(routable, web));
    }

    if (child.exitCode === null) {
        // POST /shutdown, not a signal: Windows has no SIGTERM, so this is the path
        // the kit actually uses to stop a world, and the check has to prove it works.
        let stopped = false;
        try {
            const res = await fetch(`http://127.0.0.1:${managementPort}/shutdown`, { method: 'POST' });
            stopped = res.status === 202;
        } catch {
            // the route is missing, or the world is already gone
        }
        const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
        if (!stopped) child.kill();
        await exited;
        clearTimeout(timer);
        if (ready && !stopped) {
            throw new Error('the staged engine did not accept POST /shutdown on its management port: the single-player patch is missing or did not apply');
        }
        if (stopped) log('the staged engine stopped through POST /shutdown');
    }
    if (!ready) {
        throw new Error(`the staged engine did not serve /rs2.cgi within 60s; last output:\n${output.split('\n').slice(-20).join('\n')}`);
    }
    log('the staged engine boots and serves /rs2.cgi');

    // A world with no game map serves /rs2.cgi and reports itself ready exactly like
    // a populated one - that is how an empty single player shipped in 0.1.0. The only
    // difference is this line, which GameMap.init() prints after loading the map
    // squares, so the count is what the check is for, not the boot.
    const npcs = staticNpcs(output);
    if (npcs === null) {
        throw new Error(`the staged engine never loaded the game map (no "static NPCs added" line); last output:\n${output.split('\n').slice(-20).join('\n')}`);
    }
    if (npcs === 0) {
        throw new Error('the staged engine loaded the game map but added no static NPCs: the packed maps are empty');
    }
    log(`the staged engine loaded the game map: ${npcs} static NPCs`);

    if (boundLoopbackOnly === false) {
        throw new Error(`the staged engine answered on ${routableAddress()}:${web} while configured for 127.0.0.1: the bind-host patch is missing or did not apply`);
    }
    log(boundLoopbackOnly === null ? 'no routable address on this machine: the loopback bind was not checked' : 'the staged engine bound loopback only');
}

await bootCheck();

// ── 9. report ────────────────────────────────────────────────────────────

function sizeOf(dir) {
    let total = 0;
    for (const path of walk(dir)) total += statSync(path).size;
    return total;
}
const mb = bytes => (bytes / 1048576).toFixed(1);
log(`engine-dist: ${mb(sizeOf(dist))} MB total, ${mb(sizeOf(join(dist, 'node_modules')))} MB of it node_modules`);
log(`done in ${Math.round((Date.now() - started) / 1000)}s: engine ${lock.engine.commit.slice(0, 8)}, content ${lock.content.commit.slice(0, 8)}, rev ${lock.revision}, ${patches.length} patch${patches.length === 1 ? '' : 'es'}`);
