# Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zanaris Kit becomes a download built by CI from a tag: a universal macOS DMG, a Windows installer and a Linux AppImage on a draft GitHub Release, carrying the pinned Lost City engine and packed cache in `resources/engine`, with the repository public under MIT.

**Architecture:** A stage script turns `engine.lock.json` (pinned engine and content commits) into `engine-dist/`, a precompiled, platform-independent runtime tree with production node_modules and no native binaries. electron-builder packs the electron-vite output plus `engine-dist` as an extraResource; an afterSign hook guarantees the macOS bundle is ad-hoc signed. Two GitHub Actions workflows: CI on pushes and PRs, and a release workflow that stages the engine once and builds on three runners. A once-per-launch update check adds a Help menu item when a newer release exists.

**Tech Stack:** Electron 44 (Node 24.19 bundled), electron-vite 5, electron-builder 26.15.3, esbuild 0.28 (transform API only), Node 24 `node:test`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-06-packaging-and-single-player-design.md`, Part 1 and Decisions 1 to 6.

## Global Constraints

- `$KIT` stands for the absolute path of this checkout; set it once per shell (`KIT=$(git rev-parse --show-toplevel)`).
- Node 24 everywhere: the kit's scripts, CI, and the engine (`engines.node >= 24`).
- Commits are made under the pseudonymous identity that the folder's gitconfig applies automatically. Before the first commit run `git config user.email` inside `swiftkit/` and confirm it prints `325498240+Zanaris274@users.noreply.github.com`. Never add repo-local user or credential overrides. Never write any real name, personal email, former GitHub handle, former org name or the retired hosting domain into any file or commit message.
- Every commit message ends with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- The working directory resets to `Server/` between shell calls: run every command as `cd $KIT && ...`. A commit made from `Server/` lands in the wrong repository.
- Work on branch `packaging` of the swiftkit repository. Nothing in this plan pushes; the owner pushes and dispatches the workflows.
- `npm test`, `npm run typecheck` and `npm run build` must pass after every task.
- The engine is not modified in this plan. `engine.lock.json` pins engine `c5c45f88c048f1ca50610de895dff87e0ca7b9cd` (branch `274-memory`, the commit the fleet runs) and content `2b62ae68dfed02b441bae47987a01d6bcbaeb358` (branch `274`), revision 274.
- Names from the spec, verbatim: appId `rs.zanaris.kit`; productName `Zanaris Kit`; artifacts `Zanaris-Kit-<version>-universal.dmg`, `Zanaris-Kit-Setup-<version>.exe`, `Zanaris-Kit-<version>.AppImage`; env `ZANARIS_NO_UPDATE_CHECK` disables the update check; LICENSE copyright holder `Zanaris Kit contributors`.
- Unsigned builds: no Developer ID, no notarization, no Windows certificate. The macOS bundle must nonetheless carry an ad-hoc signature.
- `engine-dist/`, `.engine-work/` and `release/` are build output and are gitignored; `build/icon.png` and `build/icon.svg` are committed.
- `package.json` version stays `0.1.0` in this plan; the owner bumps it at release time per `RELEASE.md`.

---

## File structure

| Path | Responsibility |
| --- | --- |
| `engine.lock.json` | The pinned engine and content repos and commits, and the game revision. |
| `scripts/stage-lib.mjs` | Pure helpers for staging: worker-URL rewrite, pack assertions, native-module scan, file classification. Tested. |
| `scripts/stage-lib.test.mjs` | Tests for the helpers over temp-dir fixtures. |
| `scripts/stage-engine.mjs` | The stage script: fetch, pack, transpile, copy, install, prune, VERSION.json, boot check. Integration; exercised by running it. |
| `scripts/after-sign.cjs` | electron-builder afterSign hook: ad-hoc signs the macOS bundle when its signature does not verify. |
| `scripts/dist.mjs` | `npm run dist`: stage if missing, build, electron-builder for this platform, no publish. |
| `electron-builder.yml` | Targets, artifact names, extraResources, publish provider. |
| `build/icon.svg`, `build/icon.png` | The app icon source and its 1024 px raster. |
| `src/main/update.ts` | Pure version comparison and latest-release check. |
| `src/main/update.test.ts` | Tests for it. |
| `src/main/menu.ts` | Gains a Help menu with the update item. |
| `src/main/index.ts` | Runs the update check once at ready; rebuilds the menu through one function. |
| `.github/workflows/ci.yml` | Typecheck, tests, build on push and PR. |
| `.github/workflows/release.yml` | Stage once, build on three runners, draft release on a tag, artifacts on a dispatch. |
| `LICENSE`, `README.md`, `RELEASE.md` | MIT; download and first-launch guide; the release order. |

---

### Task 1: Stage helpers

**Files:**
- Create: `scripts/stage-lib.mjs`
- Create: `scripts/stage-lib.test.mjs`
- Modify: `package.json` (the `test` script)

**Interfaces:**
- Produces: `rewriteWorkerUrls(code: string): string`; `hasTsUrl(code: string): boolean`; `classify(relPath: string): 'skip' | 'transform' | 'copy'`; `assertPack(packDir: string, fs?): { archives: number }`; `findNativeModules(dir: string): string[]`. Task 2 imports all five.

- [ ] **Step 1: Write the failing tests**

Create `scripts/stage-lib.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertPack, classify, findNativeModules, hasTsUrl, rewriteWorkerUrls } from './stage-lib.mjs';

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

test('classify: d.ts skipped, ts transformed, everything else copied', () => {
    assert.equal(classify('server/login/index.d.ts'), 'skip');
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
```

- [ ] **Step 2: Add the test glob and run the tests to verify they fail**

In `package.json`, change the `test` script to:

```json
"test": "node --test \"src/**/*.test.ts\" \"scripts/**/*.test.mjs\"",
```

Run: `cd $KIT && node --test scripts/stage-lib.test.mjs`
Expected: FAIL, "Cannot find module './stage-lib.mjs'".

- [ ] **Step 3: Write the helpers**

Create `scripts/stage-lib.mjs`:

```js
// Pure helpers for scripts/stage-engine.mjs, kept apart so they can be tested
// over fixtures without cloning or packing anything.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * The engine starts its worker threads with new Worker(new URL('./x.ts',
 * import.meta.url)). After transpiling, those files are .js. Only the path
 * inside a new URL( call is touched; any other '.ts' string is left alone.
 */
export function rewriteWorkerUrls(code) {
    return code.replace(/new URL\((\s*)(['"`])([^'"`]+?)\.ts\2/g, (_m, ws, q, path) => `new URL(${ws}${q}${path}.js${q}`);
}

/** True when a new URL( call still names a .ts file. */
export function hasTsUrl(code) {
    return /new URL\(\s*['"`][^'"`]+\.ts['"`]/.test(code);
}

/** What to do with one file under src/ or tools/, by its path relative to that root. */
export function classify(relPath) {
    if (relPath.endsWith('.d.ts')) return 'skip';
    if (relPath.endsWith('.ts')) return 'transform';
    return 'copy';
}

/**
 * The checks the fleet's build.sh makes before it trusts a pack: nine
 * archives in idx0 (six bytes each), the server scripts, the server maps.
 */
export function assertPack(packDir, fs = { existsSync, statSync }) {
    const idx0 = join(packDir, 'main_file_cache.idx0');
    if (!fs.existsSync(idx0)) throw new Error(`missing ${idx0} - did the pack fail?`);
    const size = fs.statSync(idx0).size;
    if (size % 6 !== 0) throw new Error(`${idx0} is ${size} bytes, not a multiple of 6`);
    const archives = size / 6;
    if (archives !== 9) throw new Error(`expected 9 cache archives in idx0, found ${archives}`);
    for (const required of [join('server', 'script.dat'), join('.cache', 'maps-server.zip')]) {
        const path = join(packDir, required);
        if (!fs.existsSync(path)) throw new Error(`missing ${path}`);
    }
    return { archives };
}

/** Every *.node under dir, as forward-slash paths relative to dir. Empty means no native modules. */
export function findNativeModules(dir) {
    const found = [];
    const walk = current => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const path = join(current, entry.name);
            if (entry.isDirectory()) walk(path);
            else if (entry.name.endsWith('.node')) found.push(relative(dir, path).split(sep).join('/'));
        }
    };
    walk(dir);
    return found;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd $KIT && npm test`
Expected: every test passes, including the existing `src/**/*.test.ts` suites.

- [ ] **Step 5: Commit**

```bash
cd $KIT && git add scripts/stage-lib.mjs scripts/stage-lib.test.mjs package.json && git commit -m "feat: stage helpers — worker URL rewrite, pack assertions, native-module scan

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Engine pin and stage script

**Files:**
- Create: `engine.lock.json`
- Create: `scripts/stage-engine.mjs`
- Modify: `package.json` (add `stage:engine` script, `esbuild` devDependency)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the five helpers from Task 1.
- Produces: `engine-dist/` with `src/app.js` as the entry, `VERSION.json` `{ engine: {repo, commit}, content: {repo, commit}, revision: number, built: string }`, `data/pack`, `data/raw`, `public`, `view`, `data/config/{private,public}.pem`, `node_modules`. Task 4 ships it; the single-player plan runs it.

- [ ] **Step 1: Confirm the pinned engine commit is on the public remote**

Run: `cd $KIT/../engine && git ls-remote origin refs/heads/274-memory`
Expected: a line ending in `refs/heads/274-memory` whose SHA is `c5c45f88c048f1ca50610de895dff87e0ca7b9cd`.

If the line is missing or the SHA differs, the branch has not been pushed. Run `cd $KIT/../engine && git push origin 274-memory` (the folder's gitconfig pins the pseudonymous key), then repeat the check. CI clones by commit from the public repository, so an unpushed pin cannot build.

- [ ] **Step 2: Write the pin file**

Create `engine.lock.json`:

```json
{
    "engine": {
        "repo": "https://github.com/Zanaris-rs/Engine-TS.git",
        "commit": "c5c45f88c048f1ca50610de895dff87e0ca7b9cd"
    },
    "content": {
        "repo": "https://github.com/Zanaris-rs/Content.git",
        "commit": "2b62ae68dfed02b441bae47987a01d6bcbaeb358"
    },
    "revision": 274
}
```

- [ ] **Step 3: Add the devDependency, the script and the ignores**

Run: `cd $KIT && npm install --save-dev esbuild@0.28.2`

In `package.json` `scripts`, add:

```json
"stage:engine": "node scripts/stage-engine.mjs",
```

Append to `.gitignore`:

```
# the staged engine and its working checkouts (npm run stage:engine)
engine-dist/
.engine-work/
```

- [ ] **Step 4: Write the stage script**

Create `scripts/stage-engine.mjs`:

```js
#!/usr/bin/env node
// Turns engine.lock.json into engine-dist/: the Lost City engine and packed
// cache the kit carries, precompiled to plain JavaScript, with production
// node_modules and no native binaries, so one tree serves every platform.
// Spec: docs/superpowers/specs/2026-09-06-packaging-and-single-player-design.md, Part 1.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { assertPack, classify, findNativeModules, hasTsUrl, rewriteWorkerUrls } from './stage-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(join(root, 'engine.lock.json'), 'utf8'));
const work = join(root, '.engine-work');
const engine = join(work, 'engine');
const content = join(work, 'content');
const dist = join(root, 'engine-dist');
const onWindows = process.platform === 'win32';
const npm = onWindows ? 'npm.cmd' : 'npm';

const log = msg => console.log(`[stage] ${msg}`);
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: onWindows });
const started = Date.now();

// ── 1. fetch ─────────────────────────────────────────────────────────────

function fetchAt(repo, commit, dir) {
    if (existsSync(join(dir, '.git'))) {
        const head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD']).toString().trim();
        if (head === commit) {
            log(`${relative(root, dir)} already at ${commit.slice(0, 8)}`);
            return;
        }
        rmSync(dir, { recursive: true, force: true });
    }
    mkdirSync(dir, { recursive: true });
    log(`fetching ${repo} at ${commit.slice(0, 8)} into ${relative(root, dir)}`);
    run('git', ['init', '-q'], dir);
    run('git', ['fetch', '-q', '--depth', '1', repo, commit], dir);
    run('git', ['checkout', '-q', 'FETCH_HEAD'], dir);
}

fetchAt(lock.engine.repo, lock.engine.commit, engine);
fetchAt(lock.content.repo, lock.content.commit, content);

// ── 2. pack ──────────────────────────────────────────────────────────────

log('npm ci in the engine checkout');
run(npm, ['ci'], engine);
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
        if (kind === 'skip') continue;
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

// ── 6. production node_modules, no compilers, no native binaries ─────────

log('npm ci --omit=dev in engine-dist (--ignore-scripts: the engine\'s prepare runs husky)');
run(npm, ['ci', '--omit=dev', '--ignore-scripts'], dist);
for (const dir of ['tsx', 'typescript', 'esbuild', '@esbuild', 'get-tsconfig', 'resolve-pkg-maps']) {
    rmSync(join(dist, 'node_modules', dir), { recursive: true, force: true });
}
const native = findNativeModules(join(dist, 'node_modules'));
if (native.length > 0) throw new Error(`native modules in engine-dist/node_modules: ${native.join(', ')}`);
log('no native modules in node_modules');

// ── 7. VERSION.json ──────────────────────────────────────────────────────

const version = {
    engine: lock.engine,
    content: lock.content,
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

async function bootCheck() {
    const home = join(work, 'boot');
    rmSync(home, { recursive: true, force: true });
    for (const tree of [join('data', 'pack'), join('data', 'raw'), 'public', 'view']) {
        cpSync(join(dist, tree), join(home, tree), { recursive: true });
    }
    mkdirSync(join(home, 'data', 'config'), { recursive: true });
    for (const pem of ['private.pem', 'public.pem']) cpSync(join(dist, 'data', 'config', pem), join(home, 'data', 'config', pem));
    const [web, managementPort, tcp] = await Promise.all([freePort(), freePort(), freePort()]);
    writeFileSync(
        join(home, 'data', 'config', 'world.json'),
        JSON.stringify(
            {
                web: { port: web, managementPort },
                node: { id: 1, port: tcp, production: false },
                login: { enabled: false },
                friend: { enabled: false },
                logger: { enabled: false },
                build: { liveReload: false, srcDir: 'content-absent' }
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

    if (child.exitCode === null) {
        child.kill();
        const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
        await exited;
        clearTimeout(timer);
    }
    if (!ready) {
        throw new Error(`the staged engine did not serve /rs2.cgi within 60s; last output:\n${output.split('\n').slice(-20).join('\n')}`);
    }
    log('the staged engine boots and serves /rs2.cgi');
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
log(`done in ${Math.round((Date.now() - started) / 1000)}s: engine ${lock.engine.commit.slice(0, 8)}, content ${lock.content.commit.slice(0, 8)}, rev ${lock.revision}`);
```

- [ ] **Step 5: Run the stage script**

Run: `cd $KIT && npm run stage:engine 2>&1 | tail -40`
Expected, taking several minutes the first time: the fetch lines, `npm ci`, the pack, then `pack looks sane: 9 archives`, `src: N files transpiled, M copied`, `no native modules in node_modules`, `the staged engine boots and serves /rs2.cgi`, and the size line, order of 175 MB. Exit code 0.

If `transpileTree` throws on a `.ts` import that esbuild rejects, read the message: the file and line are in it. Fix by adjusting the transform options, not by editing the engine checkout, which is disposable.

- [ ] **Step 6: Verify the staged tree by hand**

Run: `cd $KIT && cat engine-dist/VERSION.json && ls engine-dist engine-dist/data engine-dist/src | head -40 && find engine-dist/src engine-dist/tools -name '*.ts' | wc -l && find engine-dist/node_modules -name '*.node' | wc -l && test ! -e engine-dist/node_modules/tsx && echo "tsx gone" && grep -cE "new URL\([\"']\./login\.js[\"']" engine-dist/src/app.js`
Expected: the VERSION.json with both commits and `"revision": 274`; `src` holds `app.js` and no `.ts` files (count 0); no `.node` files (count 0); `tsx gone`; `1`.

Run: `cd $KIT && git status --short`
Expected: `engine.lock.json`, `scripts/stage-engine.mjs`, `package.json`, `package-lock.json`, `.gitignore` listed; neither `engine-dist/` nor `.engine-work/` appears.

- [ ] **Step 7: Run the suite and commit**

Run: `cd $KIT && npm test && npm run typecheck`
Expected: pass.

```bash
cd $KIT && git add engine.lock.json scripts/stage-engine.mjs package.json package-lock.json .gitignore && git commit -m "feat: stage the pinned engine as precompiled JavaScript in engine-dist

engine.lock.json pins Engine-TS and Content by commit. The stage script
fetches both, packs the cache, transpiles src and tools with esbuild the
way tsx does, rewrites the worker entries, installs production dependencies
without the compilers, refuses native modules, and boots the result once.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: App icon

**Files:**
- Create: `build/icon.svg`
- Create: `build/icon.png`

**Interfaces:**
- Produces: `build/icon.png`, 1024 by 1024, which electron-builder (Task 4) reads by convention from `directories.buildResources`.

- [ ] **Step 1: Write the icon source**

Create `build/icon.svg`. The kit's look: the 2004 interface's warm stone with an explicit bevel, light above and left and shadow below and right, a hard black text shadow, and the gold used for headings. The mark is a pixel Z on a seven-by-seven grid.

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="9" result="fine"/>
      <feColorMatrix in="fine" type="saturate" values="0" result="fineGrey"/>
      <feComponentTransfer in="fineGrey" result="fineSoft">
        <feFuncA type="linear" slope="0.34"/>
      </feComponentTransfer>
      <feBlend in="SourceGraphic" in2="fineSoft" mode="overlay"/>
    </filter>
  </defs>
  <!-- the stone slab: base colour, then its grain -->
  <rect x="64" y="64" width="896" height="896" rx="96" fill="#443d31"/>
  <rect x="64" y="64" width="896" height="896" rx="96" fill="#443d31" filter="url(#grain)"/>
  <!-- bevel: light above-left, shadow below-right, as every raised surface in the client -->
  <path d="M160 64 H864 Q960 64 960 160 V864 L928 832 V160 Q928 96 864 96 H160 Z" fill="#7d7463"/>
  <path d="M64 160 V864 Q64 960 160 960 H864 L832 928 H160 Q96 928 96 864 V160 Z" fill="#211d16"/>
  <!-- the Z, on a 7x7 grid of 96px cells starting at (176,176): hard black shadow first, then gold -->
  <g fill="#000000" transform="translate(16 16)">
    <rect x="176" y="176" width="672" height="96"/>
    <rect x="656" y="272" width="192" height="96"/>
    <rect x="560" y="368" width="192" height="96"/>
    <rect x="464" y="464" width="192" height="96"/>
    <rect x="368" y="560" width="192" height="96"/>
    <rect x="272" y="656" width="192" height="96"/>
    <rect x="176" y="752" width="672" height="96"/>
  </g>
  <g fill="#ffe139">
    <rect x="176" y="176" width="672" height="96"/>
    <rect x="656" y="272" width="192" height="96"/>
    <rect x="560" y="368" width="192" height="96"/>
    <rect x="464" y="464" width="192" height="96"/>
    <rect x="368" y="560" width="192" height="96"/>
    <rect x="272" y="656" width="192" height="96"/>
    <rect x="176" y="752" width="672" height="96"/>
  </g>
</svg>
```

- [ ] **Step 2: Rasterize it**

Run: `cd $KIT && qlmanage -t -s 1024 -o build build/icon.svg >/dev/null 2>&1; mv build/icon.svg.png build/icon.png && sips -g pixelWidth -g pixelHeight build/icon.png`
Expected: `pixelWidth: 1024` and `pixelHeight: 1024`.

If `qlmanage` produces no PNG, render the SVG with Electron instead. Create a one-off `scripts/render-icon.cjs`:

```js
const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1024, height: 1024, useContentSize: true, backgroundColor: '#00000000', transparent: true });
    await win.loadFile(resolve('build/icon.svg'));
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
    writeFileSync(resolve('build/icon.png'), image.toPNG());
    app.quit();
});
```

Run it with `cd $KIT && ./node_modules/.bin/electron scripts/render-icon.cjs`, verify with `sips` as above, then delete `scripts/render-icon.cjs`; it is not committed.

- [ ] **Step 3: Look at it**

Read `build/icon.png` with the Read tool. Expected: a warm brown rounded square with a lighter top-left edge and a darker bottom-right edge, and a gold pixel Z with a black offset shadow. If the Z is clipped or the bevel is missing, fix the SVG and rasterize again.

- [ ] **Step 4: Commit**

```bash
cd $KIT && git add build/icon.svg build/icon.png && git commit -m "feat: app icon — a gold pixel Z on the interface stone

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: electron-builder, the ad-hoc signing hook, and a local build

**Files:**
- Create: `electron-builder.yml`
- Create: `scripts/after-sign.cjs`
- Create: `scripts/dist.mjs`
- Modify: `package.json` (add `electron-builder` devDependency, `dist` script)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `engine-dist/` from Task 2, `build/icon.png` from Task 3.
- Produces: `release/Zanaris-Kit-<version>-universal.dmg` locally; the same config drives CI in Task 6. The engine lands at `<app>/Contents/Resources/engine` on macOS and `resources/engine` beside the executable on Windows and Linux, which the single-player plan reads as `join(process.resourcesPath, 'engine')`.

- [ ] **Step 1: Install electron-builder and add the ignore**

Run: `cd $KIT && npm install --save-dev electron-builder@26.15.3`

Append to `.gitignore`:

```
# electron-builder output (npm run dist)
release/
```

- [ ] **Step 2: Write the builder config**

Create `electron-builder.yml`:

```yaml
# Packaging for Zanaris Kit. electron-vite builds into out/; this packs it
# with the staged engine (engine-dist/, from npm run stage:engine) as an
# extra resource, outside asar, where a child process reads it as files.
# Spec: docs/superpowers/specs/2026-09-06-packaging-and-single-player-design.md, Part 1.
appId: rs.zanaris.kit
productName: Zanaris Kit
copyright: Zanaris Kit contributors
directories:
  output: release
  buildResources: build
files:
  - out/**
  - static/**
  - package.json
extraResources:
  - from: engine-dist
    to: engine
asar: true
# No native dependencies anywhere: nothing to rebuild.
npmRebuild: false
# Ad-hoc signs the macOS bundle when no identity signed it (see the script).
afterSign: scripts/after-sign.cjs

mac:
  target:
    - target: dmg
      arch:
        - universal
  category: public.app-category.games
  hardenedRuntime: false
  gatekeeperAssess: false
  artifactName: Zanaris-Kit-${version}-${arch}.${ext}

win:
  target:
    - target: nsis
      arch:
        - x64
  artifactName: Zanaris-Kit-Setup-${version}.${ext}

nsis:
  oneClick: true
  perMachine: false

linux:
  target:
    - target: AppImage
      arch:
        - x64
  category: Game
  artifactName: Zanaris-Kit-${version}.${ext}

publish:
  provider: github
  owner: Zanaris-rs
  repo: swiftkit
  releaseType: draft
```

- [ ] **Step 3: Write the signing hook**

Create `scripts/after-sign.cjs`:

```js
// electron-builder afterSign hook. There is no Developer ID, so the bundle
// is either ad-hoc signed by electron-builder or not signed at all; Apple
// Silicon refuses to launch the latter. Verify, and sign ad hoc if needed.
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

module.exports = async function afterSign(context) {
    if (context.electronPlatformName !== 'darwin') return;
    const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    const verifies = () => {
        try {
            execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
            return true;
        } catch {
            return false;
        }
    };
    if (verifies()) {
        console.log(`  • after-sign: ${app} already verifies`);
        return;
    }
    console.log(`  • after-sign: ad-hoc signing ${app}`);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
    if (!verifies()) throw new Error(`after-sign: ${app} still fails codesign --verify after ad-hoc signing`);
};
```

- [ ] **Step 4: Write the dist script and wire it**

Create `scripts/dist.mjs`:

```js
// npm run dist: a local package for this platform, never published.
// Stages the engine first when engine-dist/ is missing.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const onWindows = process.platform === 'win32';
const npm = onWindows ? 'npm.cmd' : 'npm';
const run = args => execFileSync(npm, args, { stdio: 'inherit', shell: onWindows });

if (!existsSync('engine-dist/VERSION.json')) run(['run', 'stage:engine']);
run(['run', 'build']);
run(['exec', '--', 'electron-builder', '--publish', 'never']);
```

In `package.json` `scripts`, add:

```json
"dist": "node scripts/dist.mjs",
```

- [ ] **Step 5: Build the DMG on this Mac**

Run: `cd $KIT && npm run dist 2>&1 | tail -30`
Expected, taking a few minutes (it downloads the x64 and arm64 Electron archives once): electron-vite's build, then electron-builder lines ending with `building        target=DMG arch=universal file=release/Zanaris-Kit-0.1.0-universal.dmg` and an `after-sign:` line. Exit code 0.

If electron-builder fails inside `@electron/universal` with a message that a file "is not a Mach-O" or differs between architectures, name the file in the error, add it to `mac.x64ArchFiles` in `electron-builder.yml` as a glob, and rebuild. Do not switch away from the universal target: that is a spec decision.

- [ ] **Step 6: Verify the bundle**

Run: `cd $KIT && ls -la release/*.dmg && APP="release/mac-universal/Zanaris Kit.app" && codesign -dv --verbose=2 "$APP" 2>&1 | grep -E "Signature|Identifier" && codesign --verify --deep --strict "$APP" && echo "signature verifies" && lipo -archs "$APP/Contents/MacOS/Zanaris Kit" && cat "$APP/Contents/Resources/engine/VERSION.json" && test -f "$APP/Contents/Resources/engine/src/app.js" && echo "engine shipped" && test -f "$APP/Contents/Resources/app.asar" && echo "app in asar"`
Expected: the DMG listed; `Signature=adhoc`; `signature verifies`; `x86_64 arm64`; the VERSION.json; `engine shipped`; `app in asar`.

- [ ] **Step 7: Launch the packaged app unattended**

Capture mode opens every server, screenshots, and exits 0, which proves the packaged binary starts, finds its asar, its static pages and its fonts. It talks to the real servers; a server being down produces its offline page, not a failure.

Run: `cd $KIT && CAP="$TMPDIR/kit-capture" && rm -rf "$CAP" && ZANARIS_CAPTURE="$CAP" ZANARIS_NO_UPDATE_CHECK=1 "release/mac-universal/Zanaris Kit.app/Contents/MacOS/Zanaris Kit" 2>&1 | tail -15; echo "exit ${PIPESTATUS[0]}"; ls "$CAP" | head`
Expected: the app's startup log lines, `exit 0`, and PNG files in the capture directory. (`ZANARIS_NO_UPDATE_CHECK` does nothing until Task 5 and is harmless now.)

- [ ] **Step 8: Run the suite and commit**

Run: `cd $KIT && npm test && npm run typecheck && git status --short`
Expected: pass; `release/` absent from the status.

```bash
cd $KIT && git add electron-builder.yml scripts/after-sign.cjs scripts/dist.mjs package.json package-lock.json .gitignore && git commit -m "feat: electron-builder packaging with the engine as an extra resource

Universal macOS DMG, ad-hoc signed by an afterSign hook when nothing else
signed it; Windows NSIS per-user installer; Linux AppImage. npm run dist
builds this platform locally without publishing.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Update check

**Files:**
- Create: `src/main/update.ts`
- Create: `src/main/update.test.ts`
- Modify: `src/main/menu.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Produces: `parseVersion(text: string): number[] | null`; `compareVersions(a: string, b: string): number | null` (negative when `a` is older, null when either does not parse); `checkLatest(body: unknown, current: string): LatestRelease | null` with `interface LatestRelease { latest: string; url: string; newer: boolean }`; `RELEASES_LATEST` URL constant. `installMenu(servers, actions, warnOnSwitch, update: LatestRelease | null)` gains a fourth parameter; `MenuActions` gains `openExternal(url: string): void`.

- [ ] **Step 1: Write the failing tests**

Create `src/main/update.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLatest, compareVersions, parseVersion } from './update.ts';

test('parseVersion accepts a leading v and any number of numeric parts', () => {
    assert.deepEqual(parseVersion('v0.2.0'), [0, 2, 0]);
    assert.deepEqual(parseVersion('1.0'), [1, 0]);
    assert.equal(parseVersion('v0.2.0-beta'), null);
    assert.equal(parseVersion('latest'), null);
});

test('compareVersions orders numerically and pads missing parts with zero', () => {
    assert.ok(compareVersions('0.2.0', 'v0.3.0')! < 0);
    assert.ok(compareVersions('0.10.0', 'v0.9.1')! > 0);
    assert.equal(compareVersions('1.0', '1.0.0'), 0);
    assert.equal(compareVersions('0.2.0', 'v0.2.0'), 0);
    assert.equal(compareVersions('0.2.0', 'nightly'), null);
});

test('checkLatest reads the GitHub release body and says whether it is newer', () => {
    const body = { tag_name: 'v0.3.0', html_url: 'https://github.com/Zanaris-rs/swiftkit/releases/tag/v0.3.0' };
    assert.deepEqual(checkLatest(body, '0.2.0'), { latest: 'v0.3.0', url: body.html_url, newer: true });
    assert.deepEqual(checkLatest(body, '0.3.0'), { latest: 'v0.3.0', url: body.html_url, newer: false });
    assert.deepEqual(checkLatest(body, '0.4.0'), { latest: 'v0.3.0', url: body.html_url, newer: false });
});

test('checkLatest returns null for anything that is not a release', () => {
    assert.equal(checkLatest(null, '0.2.0'), null);
    assert.equal(checkLatest('v0.3.0', '0.2.0'), null);
    assert.equal(checkLatest({ tag_name: 'v0.3.0' }, '0.2.0'), null);
    assert.equal(checkLatest({ tag_name: 'draft', html_url: 'https://example.invalid' }, '0.2.0'), null);
    assert.equal(checkLatest({ message: 'API rate limit exceeded' }, '0.2.0'), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd $KIT && node --test src/main/update.test.ts`
Expected: FAIL, cannot find module `./update.ts`.

- [ ] **Step 3: Write the module**

Create `src/main/update.ts`:

```ts
/** The newest published release on GitHub, and whether it is newer than this build. */
export interface LatestRelease {
    latest: string;
    url: string;
    newer: boolean;
}

export const RELEASES_LATEST = 'https://api.github.com/repos/Zanaris-rs/swiftkit/releases/latest';

/** `v0.2.0` or `0.2.0` to `[0, 2, 0]`; anything else, including prereleases, to null. */
export function parseVersion(text: string): number[] | null {
    const match = /^v?(\d+(?:\.\d+)*)$/.exec(text.trim());
    return match ? match[1].split('.').map(Number) : null;
}

/** Negative when `a` is older than `b`, zero when equal, positive when newer; null when either does not parse. */
export function compareVersions(a: string, b: string): number | null {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    if (!pa || !pb) return null;
    const length = Math.max(pa.length, pb.length);
    for (let i = 0; i < length; i++) {
        const x = pa[i] ?? 0;
        const y = pb[i] ?? 0;
        if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
}

/**
 * Reads the body of GitHub's releases/latest endpoint. Null for anything that
 * is not a release with a parseable tag: an error body, a rate-limit message,
 * a tag that is not a version. Never throws; the caller swallows everything.
 */
export function checkLatest(body: unknown, current: string): LatestRelease | null {
    if (typeof body !== 'object' || body === null) return null;
    const { tag_name: tag, html_url: url } = body as Record<string, unknown>;
    if (typeof tag !== 'string' || typeof url !== 'string') return null;
    const order = compareVersions(current, tag);
    if (order === null) return null;
    return { latest: tag, url, newer: order < 0 };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd $KIT && node --test src/main/update.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Add the Help menu**

In `src/main/menu.ts`, add the import and the action, and the fourth parameter:

```ts
import type { LatestRelease } from './update';
```

In `MenuActions`, after `setWarnOnSwitch`:

```ts
    /** Opens a web page in the system browser: the release page, the repository. */
    openExternal(url: string): void;
```

Change the signature to:

```ts
export function installMenu(servers: readonly ServerDef[], actions: MenuActions, warnOnSwitch: boolean, update: LatestRelease | null): void {
```

After the `{ role: 'windowMenu' }` entry in `template`, add:

```ts
        {
            role: 'help',
            submenu: [
                ...(update?.newer ? [{ label: `Update Available: ${update.latest}`, click: () => actions.openExternal(update.url) }] : []),
                { label: 'Zanaris Kit on GitHub', click: () => actions.openExternal('https://github.com/Zanaris-rs/swiftkit') }
            ]
        }
```

Update the doc comment above `installMenu` so its last sentence reads: "Rebuilt whenever the catalog changes so the server submenu stays current, whenever the switch warning is turned on or off so its checkbox agrees, and once more when a newer release is found."

- [ ] **Step 6: Wire main**

In `src/main/index.ts`:

Add to the imports:

```ts
import { checkLatest, RELEASES_LATEST, type LatestRelease } from './update';
```

Below the `let chat: ChatService | null = null;` line add:

```ts
/** The newer release the update check found, if any; the menu shows it. */
let update: LatestRelease | null = null;

/** The one way the menu is (re)built, so every rebuild carries the same inputs. */
function installAppMenu(): void {
    installMenu(catalog.list(), actions, appState.warnOnSwitch(), update);
}

/**
 * One request per launch for the newest release. Every failure is swallowed:
 * offline, rate limited, malformed. Nothing is downloaded; the Help menu
 * gets an item that opens the release page.
 */
async function checkForUpdate(): Promise<void> {
    if (CAPTURE_DIR || process.env.ZANARIS_NO_UPDATE_CHECK) return;
    try {
        const res = await net.fetch(RELEASES_LATEST, {
            signal: AbortSignal.timeout(5000),
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': `zanaris-kit/${app.getVersion()}` }
        });
        if (!res.ok) return;
        const found = checkLatest(await res.json(), app.getVersion());
        if (!found?.newer) return;
        update = found;
        installAppMenu();
        log(`[main] update available: ${found.latest} (this is ${app.getVersion()})`);
    } catch (err) {
        log(`[main] update check skipped: ${(err as Error).message}`);
    }
}
```

Replace the three existing `installMenu(catalog.list(), actions, appState.warnOnSwitch());` calls (in `loadCatalog`, `reloadCatalogIfChanged` and `setWarnOnSwitch`) with `installAppMenu();`.

In the `actions` object add:

```ts
    openExternal: url => {
        void shell.openExternal(url);
    },
```

In `app.whenReady().then(async () => { ... })`, directly after the `loadCatalog();` line, add:

```ts
    void checkForUpdate();
```

- [ ] **Step 7: Typecheck, test, build**

Run: `cd $KIT && npm run typecheck && npm test && npm run build`
Expected: pass, and the build writes `out/main/index.js`. The menu wiring is exercised by hand in Task 7's last step, once the README is in place.

- [ ] **Step 8: Commit**

```bash
cd $KIT && git add src/main/update.ts src/main/update.test.ts src/main/menu.ts src/main/index.ts && git commit -m "feat: once-per-launch update check with a Help menu item

Asks GitHub for the latest release, compares it with app.getVersion(), and
adds Help > Update Available when there is one. Nothing is downloaded;
builds are unsigned, so the page is the update.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: GitHub Actions workflows

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `npm run stage:engine` (Task 2), `electron-builder.yml` (Task 4), the `test`, `typecheck` and `build` scripts.
- Produces: a draft GitHub Release with three artifacts on a `v*` tag; workflow artifacts on a manual dispatch.

- [ ] **Step 1: Write the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 2: Write the release workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

# A tag v<version> builds every platform and drafts a GitHub Release holding
# the artifacts; the owner publishes it. A manual dispatch is the dry run:
# the same build, the artifacts on the workflow run, no release.
on:
  push:
    tags: ['v*']
  workflow_dispatch:

permissions:
  contents: write

jobs:
  engine:
    name: Stage the engine
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: node scripts/stage-engine.mjs
      - uses: actions/upload-artifact@v4
        with:
          name: engine-dist
          path: engine-dist
          retention-days: 7
          compression-level: 1

  build:
    name: Build (${{ matrix.os }})
    needs: engine
    strategy:
      fail-fast: false
      matrix:
        os: [macos-14, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - uses: actions/download-artifact@v4
        with:
          name: engine-dist
          path: engine-dist
      - name: Tag matches package.json
        if: github.ref_type == 'tag'
        shell: bash
        run: |
          version=$(node -p "require('./package.json').version")
          if [ "$GITHUB_REF_NAME" != "v$version" ]; then
            echo "tag $GITHUB_REF_NAME does not match package.json version $version"
            exit 1
          fi
      - run: npm run build
      - name: Package and draft the release
        if: github.ref_type == 'tag'
        run: npx electron-builder --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Package (dry run)
        if: github.ref_type != 'tag'
        run: npx electron-builder --publish never
      - uses: actions/upload-artifact@v4
        if: github.ref_type != 'tag'
        with:
          name: zanaris-kit-${{ matrix.os }}
          path: |
            release/*.dmg
            release/*.exe
            release/*.AppImage
          if-no-files-found: error
```

- [ ] **Step 3: Check the YAML parses and the steps reference real scripts**

Run: `cd $KIT && for f in .github/workflows/ci.yml .github/workflows/release.yml; do ruby -ryaml -e 'y = YAML.load_file(ARGV[0]); puts "#{ARGV[0]}: jobs #{y["jobs"].keys.join(", ")}"' "$f" 2>/dev/null; done && node -e "const s=require('./package.json').scripts; for (const k of ['typecheck','test','build','stage:engine']) { if (!s[k]) { console.error('missing script', k); process.exit(1); } } console.log('scripts present')"`
Expected: `ci.yml: jobs check`, `release.yml: jobs engine, build`, `scripts present`. (Ruby may print a warning about an ffi gem first; ignore it.)

- [ ] **Step 4: Commit**

```bash
cd $KIT && git add .github/workflows/ci.yml .github/workflows/release.yml && git commit -m "ci: checks on push and PR; tagged releases built on three runners

The engine is staged once on Ubuntu and shared as an artifact; macOS,
Windows and Linux each package it. A tag drafts the GitHub Release; a
manual dispatch only uploads the artifacts.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: LICENSE, README and the release checklist

**Files:**
- Create: `LICENSE`
- Create: `RELEASE.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: the artifact names from Task 4, the workflow behaviour from Task 6, `ZANARIS_NO_UPDATE_CHECK` from Task 5.

- [ ] **Step 1: Write the LICENSE**

Create `LICENSE`:

```
MIT License

Copyright (c) 2026 Zanaris Kit contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Add to `package.json`, after `"description"`:

```json
"license": "MIT",
```

- [ ] **Step 2: Write the release checklist**

Create `RELEASE.md`:

```markdown
# Release checklist

A release is a tag. CI builds every platform from it and drafts a GitHub
Release; publishing the draft is the last step and is done by hand. The order:

## 0. Before you tag

- `engine.lock.json` points at the engine commit the fleet runs and the
  content commit beside it. Both must be on the public repositories:
  `git ls-remote https://github.com/Zanaris-rs/Engine-TS.git` shows the branch.
- Bump `version` in `package.json`. The tag must be `v` followed by exactly
  that version; the workflow refuses anything else.
- Commit. `git status` clean.

## 1. Dry run

Actions > Release > Run workflow, on the branch you are about to tag. It
stages the engine (a few minutes) and packages on all three runners without
publishing. Download the three artifacts from the run.

## 2. Try each artifact on a clean profile

- macOS, on this Mac: mount the DMG, drag the app to Applications. It has no
  Developer ID: the first launch is refused, then System Settings > Privacy &
  Security > Open Anyway opens it. Open a server window; it should load.
  (From the single-player release on: open Single player, log in as a new
  name, log out, and confirm a `.sav` appeared under
  `~/Library/Application Support/zanaris-kit/singleplayer/data/players/main/`.)
- Windows, in a VM or on a spare machine: run the installer, pass SmartScreen
  with More info > Run anyway, same checks. Saves live under
  `%APPDATA%\zanaris-kit\singleplayer\`.
- Linux, on Ubuntu: `chmod +x` the AppImage and run it, same checks. Saves
  live under `~/.config/zanaris-kit/singleplayer/`.

## 3. Tag

```sh
git tag v0.2.0
git push origin main v0.2.0
```

Wait for the Release workflow. It drafts a GitHub Release named after the tag
with the DMG, the installer and the AppImage attached.

## 4. Publish

Open the draft, write the notes, publish. The kit's update check reads
`releases/latest`, so from that moment every older build shows Help >
Update Available.

## If a build fails

Fix on a branch, dry-run again, then delete and re-push the tag only if the
draft was never published. A published release is never rebuilt: bump the
version and release again.
```

- [ ] **Step 3: Update the README**

In `README.md`, after the opening status paragraph (the one beginning "**Status: milestone two") insert:

```markdown
## Download

Installers for macOS, Windows and Linux are on the
[releases page](https://github.com/Zanaris-rs/swiftkit/releases/latest):
`Zanaris-Kit-<version>-universal.dmg`, `Zanaris-Kit-Setup-<version>.exe` and
`Zanaris-Kit-<version>.AppImage`.

The builds are not signed with a developer certificate, so each system asks
once before running something it cannot attribute:

- **macOS.** Open the DMG and drag Zanaris Kit to Applications. The first
  launch is refused with "Apple could not verify". Open System Settings >
  Privacy & Security, scroll to the message about Zanaris Kit, and choose
  **Open Anyway**. It asks once more; after that it opens like any app.
- **Windows.** Run the installer. SmartScreen says "Windows protected your
  PC": choose **More info**, then **Run anyway**. It installs for your user
  only and needs no administrator password.
- **Linux.** `chmod +x Zanaris-Kit-<version>.AppImage` and run it. If it
  complains about FUSE, install `libfuse2` from your distribution.

The kit checks the releases page once each time it starts and, when there is
a newer version, adds Help > Update Available, which opens that page. Set
`ZANARIS_NO_UPDATE_CHECK=1` to turn the check off.
```

In the "Running it" section's code block, after the `npm run capture` line, add:

```sh
npm run stage:engine # fetch the pinned engine and content, pack, precompile into engine-dist/
npm run dist         # package this platform into release/ (stages first if needed)
```

After that code block add:

```markdown
`engine.lock.json` pins the engine and content commits the kit carries; see
`RELEASE.md` for how a release is cut. Everything under `engine-dist/`,
`.engine-work/` and `release/` is build output.
```

- [ ] **Step 4: Check the README reads and the suite passes**

Run: `cd $KIT && grep -n "## Download\|npm run dist\|RELEASE.md" README.md && grep -c "MIT" LICENSE package.json && npm test && npm run typecheck`
Expected: the three README lines found, `1` for each of the two files, tests and typecheck pass.

- [ ] **Step 5: See the Help menu once, by hand**

Run: `cd $KIT && npm run build && LOG="$TMPDIR/kit-run.log" && (./node_modules/.bin/electron . > "$LOG" 2>&1 &) && sleep 8 && grep -i "update" "$LOG"; pkill -f "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \." ; echo done`
Expected: with no published release yet, the API returns 404 and the log shows nothing about an update, or `update check skipped:` on a network error. Either is correct. The window opened and was closed by `pkill`.

- [ ] **Step 6: Commit**

```bash
cd $KIT && git add LICENSE RELEASE.md README.md package.json && git commit -m "docs: MIT license, download and first-launch guide, release checklist

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## After the plan

Owner's steps, not the plan's: push `packaging`, open a pull request into `main` (CI runs), merge, flip the repository to public in Settings, dispatch the Release workflow for a dry run, and follow `RELEASE.md`. The single-player plan starts from the merged `main`.
