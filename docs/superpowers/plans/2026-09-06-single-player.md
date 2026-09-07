# Single Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** File > New Window For > Single player starts the bundled Lost City engine on the player's machine, shows the game once it is ready, and offers a rail tool with status, a cheats toggle, the saves folder and the log.

**Architecture:** Three small engine patches (bind hosts, a local staff level, a shutdown route) land on the fleet branch and are re-pinned. In the kit, a catalog v3 entry of `kind: 'singleplayer'` makes a window ask a `SinglePlayerService` (pure over injected deps; Electron adapters beside it) for the game URL; the service copies the engine's assets from `resources/engine` into `<userData>/singleplayer`, writes `world.json`, spawns `src/app.js` as a utility process, polls `/rs2.cgi`, and stops it through the management port when the last window closes or the app quits. A starting page fills the game view until then.

**Tech Stack:** Electron 44 (`utilityProcess`, `net.fetch`), electron-vite 5 (`define`), React 19, Node 24 `node:test`; the engine is Node ESM with `node:sqlite`, tested with `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-09-06-packaging-and-single-player-design.md`, Part 2 and Decisions 7 to 12.

## Global Constraints

- `$KIT` stands for the absolute path of the swiftkit checkout; `$ENGINE` for the engine checkout beside it (`$KIT/../engine`). Set both once per shell: `KIT=$(git -C <swiftkit> rev-parse --show-toplevel); ENGINE=$KIT/../engine`. The shell's working directory resets between calls, so every command starts with `cd $KIT && ...` or `cd $ENGINE && ...`.
- Commits are made under the pseudonymous identity the folder's gitconfig applies. Before the first commit in each repository run `git config user.email` there and confirm `325498240+Zanaris274@users.noreply.github.com`. Never write a real name, personal email, former GitHub handle, former org name, hosting domain or an absolute home path into any file or commit message.
- Every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Kit work is on branch `singleplayer` (from `main` at `f1c810b`). Engine work is on branch `274-singleplayer` (from `274-memory` at `c5c45f88`), merged into `274-memory` and pushed in Task 1 so `engine.lock.json` can pin it; nothing else is pushed.
- `npm test`, `npm run typecheck` and `npm run build` pass in the kit after every task; `npm test` and `npm run typecheck` pass in the engine after Task 1.
- Names from the spec, verbatim: catalog entry id `singleplayer`, name `Single player`, kind `singleplayer`; tool id `singleplayer`; working directory `<userData>/singleplayer`; files `engine.stamp`, `world.log`; state key `singlePlayer.cheats` (default false); IPC channels `zanaris:singleplayer-set-cheats`, `zanaris:singleplayer-retry`, `zanaris:singleplayer-open-saves`, `zanaris:singleplayer-show-log`; engine config keys `web.host`, `node.host`, `node.localStaffLevel`, env `WEB_HOST`, `NODE_HOST`, `NODE_LOCAL_STAFF_LEVEL`; management route `POST /shutdown` replying 202.
- The engine's working directory and its assets are copied per version, never symlinked. Production stays off; cheats means `node.localStaffLevel` 4, otherwise 0.
- Readiness is HTTP 200 on `/rs2.cgi` polled every 250 ms for up to 60 s. Stop is `POST /shutdown` on the management port, then `kill()` after 10 s.
- The game page is never modified or injected into.

---

## File structure

| Path | Responsibility |
| --- | --- |
| engine `src/util/WorldConfig.ts` | `web.host`, `node.host`, `node.localStaffLevel` (default -1 meaning unset), env overlays, `resolveLocalStaffLevel()`. |
| engine `src/util/Shutdown.ts` | `requestShutdown(stop)`: the once-only exit path shared by signals and the route. |
| engine `src/web.ts`, `src/server/tcp/TcpServer.ts`, `src/app.ts`, `src/server/login/LoginThread.ts` | Use the new keys and the shared shutdown. |
| engine `test/WorldConfig.test.ts`, `test/Shutdown.test.ts` | Tests for the patches. |
| kit `engine.lock.json` | Re-pinned to the merged engine commit. |
| kit `src/shared/catalog.ts`, `src/main/catalog.ts`, `src/main/catalog.test.ts` | `kind`, the built-in entry, migration v3. |
| kit `electron.vite.config.ts`, `src/main/globals.d.ts` | `__ENGINE_REVISION__` from `engine.lock.json`. |
| kit `src/shared/singleplayer.ts` | `SinglePlayerStatus`, `SinglePlayerView`, `SinglePlayerVersion`. |
| kit `src/main/singleplayer/config.ts`, `config.test.ts` | Pure: `worldJson()`, `gameUrl()`, `stampMatches()`. |
| kit `src/main/singleplayer/service.ts`, `service.test.ts` | The state machine over injected deps. |
| kit `src/main/singleplayer/electron.ts` | Real deps: utility process, ports, fetch, filesystem. |
| kit `static/starting.html` | The starting and failure page. |
| kit `src/main/guard.ts`, `guard.test.ts` | The starting page's retry is a kit navigation. |
| kit `src/main/serverWindow.ts`, `src/main/windows.ts` | A single-player window acquires the world and loads the game when ready. |
| kit `src/main/appState.ts`, `appState.test.ts` | `singlePlayer.cheats`. |
| kit `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts` | Channels, the service singleton, quit, IPC handlers, capture. |
| kit `src/renderer/tools/SinglePlayer.tsx`, `src/renderer/icons.tsx`, `src/renderer/Shell.tsx` | The tool. |
| kit `README.md`, `RELEASE.md` | Single player in the docs and the release check. |

---

### Task 1: Engine patches, merge, push, re-pin

**Files:**
- Modify: engine `src/util/WorldConfig.ts`
- Create: engine `src/util/Shutdown.ts`
- Modify: engine `src/app.ts`, `src/web.ts`, `src/server/tcp/TcpServer.ts`, `src/server/login/LoginThread.ts`
- Modify: engine `test/WorldConfig.test.ts`; Create: engine `test/Shutdown.test.ts`
- Modify: kit `engine.lock.json`

**Interfaces:**
- Produces (engine): `WorldConfig.web.host: string` (default `0.0.0.0`), `WorldConfig.node.host: string` (default `0.0.0.0`), `WorldConfig.node.localStaffLevel: number` (default `-1`), `resolveLocalStaffLevel(config): number`, `requestShutdown(stop: () => void): boolean`, `POST /shutdown` on the management port replying `202 { stopping: true }`. The kit's `worldJson()` (Task 3) writes the three keys; the service (Task 4) posts to the route.

- [ ] **Step 1: Branch the engine and write the failing config tests**

```bash
cd $ENGINE && git checkout -q 274-memory && git checkout -b 274-singleplayer && git config user.email
```

Append to `test/WorldConfig.test.ts`:

```ts
import { resolveLocalStaffLevel } from '#/util/WorldConfig.js';

test('bind hosts default to every interface and accept loopback', () => {
    const defaults = createDefaultWorldConfig();
    assert.equal(defaults.web.host, '0.0.0.0');
    assert.equal(defaults.node.host, '0.0.0.0');
    const local = normalizeWorldConfig({ web: { host: '127.0.0.1' }, node: { host: '127.0.0.1' } });
    assert.equal(local.web.host, '127.0.0.1');
    assert.equal(local.node.host, '127.0.0.1');
});

test('the local staff level is unset by default and follows production when unset', () => {
    const config = createDefaultWorldConfig();
    assert.equal(config.node.localStaffLevel, -1);
    config.node.production = false;
    assert.equal(resolveLocalStaffLevel(config), 4);
    config.node.production = true;
    assert.equal(resolveLocalStaffLevel(config), 0);
});

test('an explicit local staff level wins over production', () => {
    assert.equal(resolveLocalStaffLevel(normalizeWorldConfig({ node: { production: false, localStaffLevel: 0 } })), 0);
    assert.equal(resolveLocalStaffLevel(normalizeWorldConfig({ node: { production: true, localStaffLevel: 4 } })), 4);
    assert.equal(resolveLocalStaffLevel(normalizeWorldConfig({ node: { localStaffLevel: 2 } })), 2);
});
```

Note: the first import line must join the existing import of `createDefaultWorldConfig, getDatabaseUrl, normalizeWorldConfig` at the top of the file rather than being a second import of the same module.

Create `test/Shutdown.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { requestShutdown, resetShutdownForTests } from '#/util/Shutdown.js';

test('the first request stops, the second is ignored', () => {
    resetShutdownForTests();
    let stops = 0;
    assert.equal(requestShutdown(() => stops++), true);
    assert.equal(requestShutdown(() => stops++), false);
    assert.equal(stops, 1);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd $ENGINE && npx tsx --test test/WorldConfig.test.ts test/Shutdown.test.ts 2>&1 | tail -20`
Expected: FAIL — `resolveLocalStaffLevel` is not exported, `#/util/Shutdown.js` cannot be found.

- [ ] **Step 3: Patch WorldConfig**

In `src/util/WorldConfig.ts`:

In the `WorldConfig` interface, add `host: string;` to `web` (after `port`) and to `node` (after `port`), and add to `node` after `production`:

```ts
        /**
         * Staff level given to logins when the login server is off (a dev world,
         * or the kit's single player). -1 means unset: 4 when production is off,
         * as before, and 0 when it is on. See resolveLocalStaffLevel().
         */
        localStaffLevel: number;
```

In `createDefaultWorldConfig()`, add `host: '0.0.0.0',` after `port` in `web` and in `node`, and `localStaffLevel: -1,` after `production: false,` in `node`.

In `migrateFromLegacyEnv()`, after the `config.web.port` line add `config.web.host = tryParseString(env.WEB_HOST, config.web.host);`; after `config.node.port` add `config.node.host = tryParseString(env.NODE_HOST, config.node.host);`; after `config.node.production` add `config.node.localStaffLevel = tryParseInt(env.NODE_LOCAL_STAFF_LEVEL, config.node.localStaffLevel);`.

Add the exported function after `normalizeWorldConfig`:

```ts
/** The staff level a local login gets: the explicit setting, else today's rule. */
export function resolveLocalStaffLevel(config: WorldConfig): number {
    if (config.node.localStaffLevel >= 0) return config.node.localStaffLevel;
    return config.node.production ? 0 : 4;
}
```

- [ ] **Step 4: The shared shutdown, the route, the binds, the login thread**

Create `src/util/Shutdown.ts`:

```ts
/**
 * One exit path for the world, whoever asks: SIGINT, SIGTERM, or the
 * management route the kit's single player uses on Windows, where there is
 * no signal to send. The world stops through its own reboot timer so every
 * save is flushed; asking twice does nothing.
 */
let exiting = false;

export function requestShutdown(stop: () => void): boolean {
    if (exiting) return false;
    exiting = true;
    stop();
    return true;
}

export function resetShutdownForTests(): void {
    exiting = false;
}
```

In `src/app.ts`, replace the `let exiting = false;` block and `safeExit` with:

```ts
import { requestShutdown } from '#/util/Shutdown.js';

function safeExit() {
    requestShutdown(() => World.rebootTimer(0));
}
```

keeping `process.on('SIGINT', safeExit)` and `process.on('SIGTERM', safeExit)`.

In `src/web.ts`, `startWeb` becomes `await fastify.listen({ port: Environment.web.port, host: Environment.web.host });`. Add, before `startManagementWeb`:

```ts
import { requestShutdown } from '#/util/Shutdown.js';

// The kit's single player stops its world this way: loopback only, like the
// rest of the management surface, and the same path as a signal, so saves flush.
management.post('/shutdown', async (_req, reply) => {
    const accepted = requestShutdown(() => World.rebootTimer(0));
    reply.status(202);
    return { stopping: true, alreadyStopping: !accepted };
});
```

(`World` is already imported in `web.ts`.)

In `src/server/tcp/TcpServer.ts`, `this.tcp.listen(Environment.node.port, Environment.node.host, () => {});`.

In `src/server/login/LoginThread.ts`, in the local branch (login server off), replace

```ts
                let staffmodlevel = 0;

                if (!Environment.node.production) {
                    staffmodlevel = 4; // dev (destructive commands)
                }
```

with

```ts
                const staffmodlevel = resolveLocalStaffLevel(Environment);
```

and add `import { resolveLocalStaffLevel } from '#/util/WorldConfig.js';` to the imports. `Environment` is the merged config object, so it satisfies the parameter type.

- [ ] **Step 5: Run the engine suite, typecheck, and boot once**

Run: `cd $ENGINE && npm test 2>&1 | tail -8 && npm run typecheck 2>&1 | tail -2`
Expected: all tests pass including the four new ones; typecheck clean.

Run a boot with the new keys to prove the binds and the route: `cd $ENGINE && WEB_HOST=127.0.0.1 NODE_HOST=127.0.0.1 npx tsx src/app.ts > "$TMPDIR/engine-boot.log" 2>&1 & sleep 8; lsof -nP -iTCP -sTCP:LISTEN | grep -E "node.*(8888|43594|8898)" ; curl -s -X POST -o - -w " %{http_code}\n" http://127.0.0.1:8898/shutdown; sleep 5; pgrep -f "tsx src/app.ts" || echo "stopped"`
Expected: the three listeners on `127.0.0.1` (not `*`), the route replying `{"stopping":true,"alreadyStopping":false} 202`, then `stopped`. (The env overlay applies only when `data/config/world.json` is absent and `.env` is used; if the checkout has a `world.json`, set `web.host` and `node.host` in it for this check and restore it afterwards, or run from a scratch directory with only the pems and pack copied, as `scripts/stage-engine.mjs`'s boot check does.)

- [ ] **Step 6: Commit, merge, push**

```bash
cd $ENGINE && git add src/util/WorldConfig.ts src/util/Shutdown.ts src/app.ts src/web.ts src/server/tcp/TcpServer.ts src/server/login/LoginThread.ts test/WorldConfig.test.ts test/Shutdown.test.ts && git commit -m "feat: bind hosts, a local staff level, and a shutdown route for the kit's single player

web.host and node.host default to every interface as before; the kit sets
loopback. node.localStaffLevel replaces the hard-coded 4 for logins with
the login server off, unset by default so nothing changes. POST /shutdown
on the management port runs the same exit path as a signal.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git checkout -q 274-memory && git merge --ff-only 274-singleplayer && git branch -d 274-singleplayer && git push origin 274-memory && git rev-parse HEAD
```

Expected: the push succeeds and the last line prints the new commit SHA.

- [ ] **Step 7: Re-pin and re-stage in the kit**

```bash
cd $KIT && git checkout -q singleplayer && git config user.email
```

Edit `engine.lock.json`: set `engine.commit` to the SHA printed in Step 6. Then `cd $KIT && npm run stage:engine 2>&1 | tail -6` (minutes; the stale-stage detection in `scripts/dist.mjs` is not involved because this runs the stage directly). Expected: the boot check passes and `engine-dist/VERSION.json` shows the new commit. Then:

```bash
cd $KIT && git add engine.lock.json && git commit -m "chore: pin the engine with the single-player patches

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Catalog v3 and the built-in entry

**Files:**
- Modify: `src/shared/catalog.ts`, `src/main/catalog.ts`, `src/main/catalog.test.ts`
- Create: `src/main/globals.d.ts`
- Modify: `electron.vite.config.ts`

**Interfaces:**
- Produces: `ServerDef.kind: 'remote' | 'singleplayer'`; the built-in `singleplayer` entry; `engineRevision(): number`; catalog file `version: 3`. Task 6 branches on `server.kind === 'singleplayer'`.

- [ ] **Step 1: Write the failing tests**

In `src/main/catalog.test.ts`, change the first test's expected id list to `['lostcity', 'zanaris', 'lostcitylabs', 'singleplayer', 'local']` and add after it:

```ts
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
    const custom = { ...createServer(input(), []).server as ServerDef };
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
```

Add `engineRevision` to the import list from `./catalog.ts` and `import type { NewServerInput, ServerDef } from '../shared/catalog.ts';`. Any existing test that builds a `ServerDef` literal or asserts `version: 2` in a written file must gain `kind: 'remote'` or expect `3` (grep the file for `version: 2` and for object literals passed to `isServerDef`; update each).

- [ ] **Step 2: Run to verify they fail**

Run: `cd $KIT && node --test src/main/catalog.test.ts 2>&1 | tail -15`
Expected: failures on `kind`, `engineRevision` and the id list.

- [ ] **Step 3: The shared type and the global**

In `src/shared/catalog.ts`, add to `ServerDef` after `id`:

```ts
    /** A remote server's page, or the world the kit runs on this computer. */
    kind: 'remote' | 'singleplayer';
```

Create `src/main/globals.d.ts`:

```ts
/** Stamped by electron-vite's `define` from engine.lock.json; undefined under node --test. */
declare const __ENGINE_REVISION__: number | undefined;
```

In `electron.vite.config.ts`:

```ts
import { readFileSync } from 'node:fs';
const lock = JSON.parse(readFileSync('engine.lock.json', 'utf8')) as { revision: number };
```

and in `main`: `{ plugins: [externalizeDepsPlugin()], define: { __ENGINE_REVISION__: JSON.stringify(lock.revision) } }`.

- [ ] **Step 4: The catalog**

In `src/main/catalog.ts`:

```ts
import { readFileSync } from 'node:fs';

/** The game revision the bundled engine is, from the pin file at build time or, under tests, on disk. */
export function engineRevision(): number {
    if (typeof __ENGINE_REVISION__ === 'number') return __ENGINE_REVISION__;
    return (JSON.parse(readFileSync('engine.lock.json', 'utf8')) as { revision: number }).revision;
}
```

Give every existing `DEFAULT_SERVERS` entry `kind: 'remote',` after `id`, and insert between `lostcitylabs` and `local`:

```ts
    {
        id: 'singleplayer',
        kind: 'singleplayer',
        name: 'Single player',
        // The port is applied at runtime: the world is started on a free one.
        url: 'http://127.0.0.1/rs2.cgi?lowmem=1',
        revision: engineRevision(),
        wiki: LOSTHQ,
        map: 'https://tools.losthq.rs/map',
        hosts: ['127.0.0.1', '2004.losthq.rs', 'tools.losthq.rs'],
        notes: 'Runs on this computer. No account needed.',
        worlds: null,
        bookmarks: [...LOSTHQ_BOOKMARKS],
        hiscores: null
    },
```

`createServer` returns `kind: 'remote'` in its literal. `isServerDef` adds `if (s.kind !== 'remote' && s.kind !== 'singleplayer') return false;`.

`CatalogFile.version` becomes `3`. `migrateCatalog`:

```ts
    if (version === 3) {
        return file.servers.every(isServerDef) && uniqueIds(file.servers) ? file.servers.map(copy) : null;
    }
    if (version === 2) {
        const upgraded: ServerDef[] = [];
        for (const entry of file.servers) {
            const withKind = typeof entry === 'object' && entry !== null ? { kind: 'remote', ...(entry as object) } : entry;
            if (!isServerDef(withKind)) return null;
            upgraded.push(copy(withKind));
        }
        return uniqueIds(upgraded) ? withSinglePlayer(upgraded) : null;
    }
    if (version !== 1) return null;
```

and the v1 branch's final line becomes `return uniqueIds(servers) ? withSinglePlayer(servers) : null;` where the v1 built-in filter now naturally includes `singleplayer` only if a legacy id mapped to it (none do), so `withSinglePlayer` adds it:

```ts
/** Adds the built-in single-player entry to a list that lacks it, before `local` when present. */
function withSinglePlayer(servers: ServerDef[]): ServerDef[] {
    if (servers.some(s => s.id === 'singleplayer')) return servers;
    const entry = copy(DEFAULT_SERVERS.find(s => s.id === 'singleplayer')!);
    const local = servers.findIndex(s => s.id === 'local');
    if (local < 0) return [...servers, entry];
    return [...servers.slice(0, local), entry, ...servers.slice(local)];
}
```

In `Catalog.load`, the rewrite condition becomes `!== 3`; `save` writes `version: 3`.

- [ ] **Step 5: Verify**

Run: `cd $KIT && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)" && npm run typecheck && npm run build 2>&1 | tail -2 && grep -c "274" out/main/index.js`
Expected: all pass; typecheck clean; the built main contains the stamped revision (count at least 1).

- [ ] **Step 6: Commit**

```bash
cd $KIT && git add src/shared/catalog.ts src/main/catalog.ts src/main/catalog.test.ts src/main/globals.d.ts electron.vite.config.ts && git commit -m "feat: catalog v3 — every entry has a kind, and Single player is built in

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Shared types and the pure config helpers

**Files:**
- Create: `src/shared/singleplayer.ts`
- Create: `src/main/singleplayer/config.ts`, `src/main/singleplayer/config.test.ts`

**Interfaces:**
- Produces: `SinglePlayerStatus`, `SinglePlayerVersion`, `SinglePlayerView`; `WorldPorts { web, management, tcp }`; `worldJson({ ports, cheats, revision }): string`; `gameUrl(base, port): string`; `parseVersion(text): SinglePlayerVersion | null`; `stampMatches(stamp, versionText): boolean`; `LOG_TAIL_LINES = 200`. Task 4 uses all of them.

- [ ] **Step 1: Write the failing tests**

Create `src/main/singleplayer/config.test.ts`:

```ts
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
    assert.equal(off.build.srcDir, 'content-absent');
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd $KIT && node --test src/main/singleplayer/config.test.ts 2>&1 | tail -5`
Expected: cannot find `./config.ts`.

- [ ] **Step 3: The shared types**

Create `src/shared/singleplayer.ts`:

```ts
/** The single-player world, as the shell draws it. */

export type SinglePlayerStatus = 'stopped' | 'preparing' | 'starting' | 'ready' | 'stopping' | 'failed';

/** What the bundled engine is, from resources/engine/VERSION.json. */
export interface SinglePlayerVersion {
    engine: string;
    content: string;
    revision: number;
    built: string;
}

export interface SinglePlayerView {
    status: SinglePlayerStatus;
    /** The web port while starting or ready. */
    port: number | null;
    /** The game URL while ready. */
    url: string | null;
    /** Why it failed, while failed. */
    reason: string | null;
    /** The last lines the world printed. */
    logTail: string[];
    version: SinglePlayerVersion | null;
    cheats: boolean;
}
```

- [ ] **Step 4: The helpers**

Create `src/main/singleplayer/config.ts`:

```ts
import type { SinglePlayerVersion } from '../../shared/singleplayer.ts';

export interface WorldPorts {
    web: number;
    management: number;
    tcp: number;
}

export const LOG_TAIL_LINES = 200;

/**
 * The world.json the kit writes before every start. Everything the engine
 * needs to be a private world: loopback binds, no login, friend or logger
 * server, live reload off, a content directory that does not exist so the
 * engine neither watches nor serves it. Production stays off; cheats is the
 * staff level and nothing else. The engine fills any key omitted here.
 */
export function worldJson(opts: { ports: WorldPorts; cheats: boolean; revision: number }): string {
    const config = {
        easyStartup: false,
        account: { autoCreate: false },
        web: { port: opts.ports.web, host: '127.0.0.1', allowedOrigin: '', managementPort: opts.ports.management },
        engine: { revision: opts.revision },
        node: {
            id: 1,
            port: opts.ports.tcp,
            host: '127.0.0.1',
            members: true,
            autoSubscribeMembers: true,
            xpRate: 1,
            production: false,
            localStaffLevel: opts.cheats ? 4 : 0,
            debug: false,
            profile: 'main',
            maxConnected: 10
        },
        login: { enabled: false },
        friend: { enabled: false },
        logger: { enabled: false },
        db: { backend: 'sqlite' },
        build: { startup: false, verify: false, liveReload: false, srcDir: 'content-absent' }
    };
    return `${JSON.stringify(config, null, 4)}\n`;
}

/** The catalog's placeholder url with the port the world was actually started on. */
export function gameUrl(base: string, port: number): string {
    const url = new URL(base);
    url.port = String(port);
    return url.href;
}

/** resources/engine/VERSION.json, as the stage script writes it. */
export function parseVersion(text: string): SinglePlayerVersion | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const v = parsed as Record<string, unknown>;
    const engine = (v.engine as Record<string, unknown> | undefined)?.commit;
    const content = (v.content as Record<string, unknown> | undefined)?.commit;
    if (typeof engine !== 'string' || typeof content !== 'string') return null;
    if (typeof v.revision !== 'number' || !Number.isInteger(v.revision) || typeof v.built !== 'string') return null;
    return { engine, content, revision: v.revision, built: v.built };
}

/** True when the assets in the working directory came from this VERSION.json. */
export function stampMatches(stamp: string | null, versionText: string): boolean {
    return stamp !== null && stamp.trim() === versionText.trim();
}
```

- [ ] **Step 5: Run the tests and commit**

Run: `cd $KIT && node --test src/main/singleplayer/config.test.ts 2>&1 | tail -6 && npm run typecheck`
Expected: 4 pass; typecheck clean.

```bash
cd $KIT && git add src/shared/singleplayer.ts src/main/singleplayer/config.ts src/main/singleplayer/config.test.ts && git commit -m "feat: single-player types and the world.json the kit writes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The SinglePlayerService state machine

**Files:**
- Create: `src/main/singleplayer/service.ts`, `src/main/singleplayer/service.test.ts`

**Interfaces:**
- Consumes: Task 3's helpers and types.
- Produces: `SinglePlayerDeps`, `WorldProcess`, `SpawnSpec`, `class SinglePlayerService { view(); subscribe(fn); acquire(): Promise<string>; release(): void; retry(): Promise<string>; setCheats(on): Promise<void>; stop(): Promise<void> }`. Task 5 builds the real deps; Task 6 calls acquire/release/subscribe from the window and stop from quit; Task 7 calls setCheats and retry over IPC.

- [ ] **Step 1: Write the failing tests**

Create `src/main/singleplayer/service.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SinglePlayerService, type SinglePlayerDeps, type SpawnSpec, type WorldProcess } from './service.ts';

const VERSION = JSON.stringify({ engine: { repo: 'r', commit: 'e1' }, content: { repo: 'c', commit: 'c1' }, revision: 274, built: '2026-09-06T00:00:00.000Z' });

/** A controllable world: lines it prints, and when it exits. */
class FakeProcess implements WorldProcess {
    killed = 0;
    private resolveExit!: (code: number | null) => void;
    readonly exited = new Promise<number | null>(resolve => {
        this.resolveExit = resolve;
    });
    constructor(readonly spec: SpawnSpec) {}
    print(line: string): void {
        this.spec.onLine(line);
    }
    exit(code: number | null): void {
        this.resolveExit(code);
    }
    kill(): void {
        this.killed++;
        this.resolveExit(null);
    }
}

interface Harness {
    deps: SinglePlayerDeps;
    files: Map<string, string>;
    dirs: Set<string>;
    copies: [string, string][];
    processes: FakeProcess[];
    posts: string[];
    statusQueue: (number | null)[];
    clock: { now: number };
    cheats: { value: boolean };
}

function harness(over: { staged?: boolean; stamp?: boolean } = {}): Harness {
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    const copies: [string, string][] = [];
    const processes: FakeProcess[] = [];
    const posts: string[] = [];
    const statusQueue: (number | null)[] = [];
    const clock = { now: 1_000_000 };
    const cheats = { value: false };
    if (over.staged !== false) {
        files.set('/res/VERSION.json', VERSION);
        for (const tree of ['/res/data/pack', '/res/data/raw', '/res/public', '/res/view']) dirs.add(tree);
        files.set('/res/data/config/private.pem', 'priv');
        files.set('/res/data/config/public.pem', 'pub');
    }
    if (over.stamp) files.set('/home/engine.stamp', VERSION);
    const deps: SinglePlayerDeps = {
        resources: '/res',
        home: '/home',
        baseUrl: 'http://127.0.0.1/rs2.cgi?lowmem=1',
        cheats: { get: () => cheats.value, set: v => void (cheats.value = v) },
        join: (...parts) => parts.join('/'),
        fs: {
            exists: p => files.has(p) || dirs.has(p),
            readText: p => {
                const text = files.get(p);
                if (text === undefined) throw new Error(`ENOENT ${p}`);
                return text;
            },
            writeText: (p, text) => void files.set(p, text),
            appendText: (p, text) => void files.set(p, (files.get(p) ?? '') + text),
            mkdir: p => void dirs.add(p),
            rm: p => {
                files.delete(p);
                dirs.delete(p);
            },
            rename: (from, to) => {
                if (dirs.delete(from)) dirs.add(to);
                const text = files.get(from);
                if (text !== undefined) {
                    files.delete(from);
                    files.set(to, text);
                }
            },
            copyDir: (from, to) => {
                copies.push([from, to]);
                dirs.add(to);
            }
        },
        freePort: (() => {
            let next = 40000;
            return async () => ++next;
        })(),
        spawn: spec => {
            const p = new FakeProcess(spec);
            processes.push(p);
            return p;
        },
        httpStatus: async () => (statusQueue.length > 0 ? statusQueue.shift()! : null),
        httpPost: async url => {
            posts.push(url);
            return 202;
        },
        sleep: async ms => void (clock.now += ms),
        now: () => clock.now,
        log: () => {}
    };
    return { deps, files, dirs, copies, processes, posts, statusQueue, clock, cheats };
}

const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

test('the first acquire prepares the working directory, writes world.json, spawns the world and resolves when it answers', async () => {
    const h = harness();
    const service = new SinglePlayerService(h.deps);
    h.statusQueue.push(null, null, 200);
    const url = await service.acquire();
    assert.equal(url, 'http://127.0.0.1:40001/rs2.cgi?lowmem=1');
    assert.equal(service.view().status, 'ready');
    assert.equal(service.view().port, 40001);
    assert.deepEqual(service.view().version, { engine: 'e1', content: 'c1', revision: 274, built: '2026-09-06T00:00:00.000Z' });
    // the four trees were copied through a staging directory and renamed into place
    assert.equal(h.copies.length, 4);
    assert.ok(h.copies.every(([from, to]) => from.startsWith('/res/') && to.includes('/.staging-')));
    for (const tree of ['/home/data/pack', '/home/data/raw', '/home/public', '/home/view']) assert.ok(h.dirs.has(tree), tree);
    assert.equal(h.files.get('/home/data/config/private.pem'), 'priv');
    assert.equal(h.files.get('/home/engine.stamp'), VERSION);
    const world = JSON.parse(h.files.get('/home/data/config/world.json')!);
    assert.equal(world.web.port, 40001);
    assert.equal(world.web.managementPort, 40002);
    assert.equal(world.node.port, 40003);
    assert.equal(world.node.localStaffLevel, 0);
    assert.equal(h.processes.length, 1);
    assert.equal(h.processes[0]!.spec.entry, '/res/src/app.js');
    assert.equal(h.processes[0]!.spec.cwd, '/home');
    assert.equal(h.files.get('/home/world.log'), '');
});

test('a matching stamp skips the copy', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    h.statusQueue.push(200);
    await service.acquire();
    assert.equal(h.copies.length, 0);
    assert.equal(service.view().status, 'ready');
});

test('a second acquire while ready resolves at once; release to zero asks the world to stop and waits for it', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    h.statusQueue.push(200);
    const first = await service.acquire();
    const second = await service.acquire();
    assert.equal(second, first);
    assert.equal(h.processes.length, 1);
    service.release();
    assert.equal(service.view().status, 'ready');
    service.release();
    await tick();
    assert.equal(service.view().status, 'stopping');
    assert.deepEqual(h.posts, ['http://127.0.0.1:40002/shutdown']);
    h.processes[0]!.exit(0);
    await tick();
    await tick();
    assert.equal(service.view().status, 'stopped');
    assert.equal(h.processes[0]!.killed, 0);
});

test('a world that ignores the shutdown request is killed after ten seconds', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    h.statusQueue.push(200);
    await service.acquire();
    service.release();
    await tick();
    await tick();
    await tick();
    assert.equal(h.processes[0]!.killed, 1);
    assert.equal(service.view().status, 'stopped');
    assert.ok(h.clock.now >= 1_000_000 + 10_000);
});

test('a world that exits before it is ready fails with its last lines', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    const pending = service.acquire();
    await tick();
    h.processes[0]!.print('Starting world');
    h.processes[0]!.print('Error: boom');
    h.processes[0]!.exit(1);
    await assert.rejects(pending, /exited before it was ready \(code 1\)/);
    assert.equal(service.view().status, 'failed');
    assert.match(service.view().reason!, /code 1/);
    assert.deepEqual(service.view().logTail, ['Starting world', 'Error: boom']);
    assert.match(h.files.get('/home/world.log')!, /boom/);
});

test('a world that never answers fails at the deadline and is killed', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    await assert.rejects(service.acquire(), /did not answer within 60 s/);
    assert.equal(service.view().status, 'failed');
    assert.equal(h.processes[0]!.killed, 1);
});

test('retry from failed starts again without changing the window count', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    await assert.rejects(service.acquire());
    h.statusQueue.push(200);
    const url = await service.retry();
    assert.equal(service.view().status, 'ready');
    assert.equal(url, 'http://127.0.0.1:40004/rs2.cgi?lowmem=1');
    service.release();
    await tick();
    assert.equal(service.view().status, 'stopping');
});

test('setCheats persists, and restarts a running world with the new staff level', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    await service.setCheats(true);
    assert.equal(h.cheats.value, true);
    assert.equal(h.processes.length, 0);
    h.statusQueue.push(200);
    await service.acquire();
    assert.equal(JSON.parse(h.files.get('/home/data/config/world.json')!).node.localStaffLevel, 4);
    h.statusQueue.push(200);
    const restart = service.setCheats(false);
    await tick();
    h.processes[0]!.exit(0);
    await restart;
    assert.equal(h.processes.length, 2);
    assert.equal(JSON.parse(h.files.get('/home/data/config/world.json')!).node.localStaffLevel, 0);
    assert.equal(service.view().status, 'ready');
    assert.equal(service.view().cheats, false);
});

test('a crash while ready is reported as failed and subscribers hear about it', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    let pushes = 0;
    service.subscribe(() => pushes++);
    h.statusQueue.push(200);
    await service.acquire();
    const before = pushes;
    h.processes[0]!.exit(134);
    await tick();
    assert.equal(service.view().status, 'failed');
    assert.match(service.view().reason!, /stopped unexpectedly \(code 134\)/);
    assert.ok(pushes > before);
});

test('missing resources fail before anything is copied or spawned', async () => {
    const h = harness({ staged: false });
    const service = new SinglePlayerService(h.deps);
    await assert.rejects(service.acquire(), /Engine not staged/);
    assert.equal(service.view().status, 'failed');
    assert.equal(h.copies.length, 0);
    assert.equal(h.processes.length, 0);
});

test('stop while starting kills the world and leaves it stopped', async () => {
    const h = harness({ stamp: true });
    const service = new SinglePlayerService(h.deps);
    const pending = service.acquire();
    await tick();
    const stopped = service.stop();
    await assert.rejects(pending);
    await stopped;
    assert.equal(service.view().status, 'stopped');
    assert.equal(h.processes[0]!.killed, 1);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd $KIT && node --test src/main/singleplayer/service.test.ts 2>&1 | tail -5`
Expected: cannot find `./service.ts`.

- [ ] **Step 3: The service**

Create `src/main/singleplayer/service.ts`:

```ts
import type { SinglePlayerStatus, SinglePlayerVersion, SinglePlayerView } from '../../shared/singleplayer.ts';
import { gameUrl, LOG_TAIL_LINES, parseVersion, stampMatches, worldJson, type WorldPorts } from './config.ts';

export interface WorldProcess {
    /** Resolves with the exit code, null when killed, once the process is gone. */
    readonly exited: Promise<number | null>;
    kill(): void;
}

export interface SpawnSpec {
    entry: string;
    cwd: string;
    onLine: (line: string) => void;
}

export interface SinglePlayerDeps {
    /** resources/engine, or engine-dist in dev. */
    resources: string;
    /** <userData>/singleplayer */
    home: string;
    /** The catalog entry's url; the port is applied at start. */
    baseUrl: string;
    cheats: { get(): boolean; set(on: boolean): void };
    join(...parts: string[]): string;
    fs: {
        exists(path: string): boolean;
        readText(path: string): string;
        writeText(path: string, text: string): void;
        appendText(path: string, text: string): void;
        mkdir(path: string): void;
        /** Recursive, and quiet when the path is absent. */
        rm(path: string): void;
        rename(from: string, to: string): void;
        copyDir(from: string, to: string): void;
    };
    freePort(): Promise<number>;
    spawn(spec: SpawnSpec): WorldProcess;
    httpStatus(url: string): Promise<number | null>;
    httpPost(url: string): Promise<number | null>;
    sleep(ms: number): Promise<void>;
    now(): number;
    log(msg: string): void;
}

const ASSET_TREES = ['data/pack', 'data/raw', 'public', 'view'];
const PEMS = ['data/config/private.pem', 'data/config/public.pem'];
const READY_TIMEOUT_MS = 60_000;
const POLL_MS = 250;
const STOP_GRACE_MS = 10_000;

class Failure extends Error {}

/**
 * One world for every single-player window. Windows acquire and release;
 * the first acquire starts the world, the last release stops it. Pure over
 * the deps so the whole lifecycle runs under node:test with fakes.
 */
export class SinglePlayerService {
    private status: SinglePlayerStatus = 'stopped';
    private ports: WorldPorts | null = null;
    private url: string | null = null;
    private reason: string | null = null;
    private logTail: string[] = [];
    private version: SinglePlayerVersion | null = null;
    private process: WorldProcess | null = null;
    private windows = 0;
    private starting: Promise<string> | null = null;
    private stopping: Promise<void> | null = null;
    private readonly listeners = new Set<() => void>();

    constructor(private readonly deps: SinglePlayerDeps) {}

    view(): SinglePlayerView {
        return {
            status: this.status,
            port: this.ports?.web ?? null,
            url: this.status === 'ready' ? this.url : null,
            reason: this.status === 'failed' ? this.reason : null,
            logTail: [...this.logTail],
            version: this.version,
            cheats: this.deps.cheats.get()
        };
    }

    subscribe(fn: () => void): () => void {
        this.listeners.add(fn);
        return () => void this.listeners.delete(fn);
    }

    /** A window wants the world. Resolves with the game url; rejects when it cannot start. */
    async acquire(): Promise<string> {
        this.windows++;
        return this.ensure();
    }

    /** That window is gone. The last one stops the world. */
    release(): void {
        this.windows = Math.max(0, this.windows - 1);
        if (this.windows === 0 && this.status !== 'stopped' && this.status !== 'failed') void this.stop();
    }

    /** From failed: try again for the windows already counted. */
    retry(): Promise<string> {
        return this.ensure();
    }

    async setCheats(on: boolean): Promise<void> {
        this.deps.cheats.set(on);
        this.notify();
        if (this.status === 'ready' || this.status === 'starting' || this.status === 'preparing') {
            await this.stop();
            if (this.windows > 0) await this.ensure().catch(() => undefined);
        }
    }

    /** Quit, or a restart: stops whatever is running, regardless of windows. */
    async stop(): Promise<void> {
        if (this.stopping) return this.stopping;
        if (this.status === 'stopped' || this.status === 'failed') return;
        this.stopping = this.doStop().finally(() => {
            this.stopping = null;
        });
        return this.stopping;
    }

    // ── internals ────────────────────────────────────────────────────────

    private ensure(): Promise<string> {
        if (this.status === 'ready' && this.url) return Promise.resolve(this.url);
        if (this.starting) return this.starting;
        this.starting = this.start().finally(() => {
            this.starting = null;
        });
        return this.starting;
    }

    private set(status: SinglePlayerStatus): void {
        this.status = status;
        this.notify();
    }

    private notify(): void {
        for (const fn of this.listeners) fn();
    }

    private fail(reason: string): never {
        this.reason = reason;
        this.set('failed');
        this.deps.log(`[singleplayer] ${reason}`);
        throw new Failure(reason);
    }

    private async start(): Promise<string> {
        const { deps } = this;
        const { fs, join } = deps;
        this.reason = null;
        this.logTail = [];

        this.set('preparing');
        const versionPath = join(deps.resources, 'VERSION.json');
        if (!fs.exists(versionPath)) this.fail('Engine not staged: run npm run stage:engine');
        const versionText = fs.readText(versionPath);
        const version = parseVersion(versionText);
        if (!version) this.fail(`${versionPath} is not a VERSION.json the kit understands`);
        this.version = version;
        const stampPath = join(deps.home, 'engine.stamp');
        const stamp = fs.exists(stampPath) ? fs.readText(stampPath) : null;
        if (!stampMatches(stamp, versionText)) {
            try {
                this.copyAssets(versionText);
            } catch (err) {
                this.fail(`Could not copy the engine's files: ${String(err)}`);
            }
        }
        if (this.status !== 'preparing') this.fail('Stopped while getting ready');

        this.set('starting');
        const ports: WorldPorts = { web: await deps.freePort(), management: await deps.freePort(), tcp: await deps.freePort() };
        this.ports = ports;
        fs.mkdir(join(deps.home, 'data', 'config'));
        fs.writeText(join(deps.home, 'data', 'config', 'world.json'), worldJson({ ports, cheats: deps.cheats.get(), revision: version.revision }));
        const logPath = join(deps.home, 'world.log');
        fs.writeText(logPath, '');
        const process = deps.spawn({
            entry: join(deps.resources, 'src', 'app.js'),
            cwd: deps.home,
            onLine: line => {
                this.logTail.push(line);
                if (this.logTail.length > LOG_TAIL_LINES) this.logTail.shift();
                fs.appendText(logPath, `${line}\n`);
            }
        });
        this.process = process;
        let exit: number | null | undefined;
        void process.exited.then(code => {
            exit = code;
            this.onExit(process, code);
        });

        const url = gameUrl(deps.baseUrl, ports.web);
        const deadline = deps.now() + READY_TIMEOUT_MS;
        while (deps.now() < deadline) {
            if (this.process !== process) this.fail('Stopped while starting');
            if (exit !== undefined) this.fail(`The world exited before it was ready (code ${exit})`);
            if ((await deps.httpStatus(url)) === 200) {
                if (this.process !== process) this.fail('Stopped while starting');
                this.url = url;
                this.set('ready');
                deps.log(`[singleplayer] ready on port ${ports.web}`);
                return url;
            }
            await deps.sleep(POLL_MS);
        }
        process.kill();
        this.process = null;
        this.fail(`The world did not answer within ${READY_TIMEOUT_MS / 1000} s`);
    }

    /** Copies the four trees and the pems into a staging directory, then swaps them into place. */
    private copyAssets(versionText: string): void {
        const { fs, join, home, resources } = this.deps;
        const staging = join(home, `.staging-${this.deps.now()}`);
        fs.rm(staging);
        for (const tree of ASSET_TREES) fs.copyDir(join(resources, tree), join(staging, tree));
        for (const pem of PEMS) {
            fs.mkdir(join(staging, 'data', 'config'));
            fs.writeText(join(staging, pem), fs.readText(join(resources, pem)));
        }
        fs.mkdir(join(home, 'data', 'config'));
        for (const tree of ASSET_TREES) {
            fs.rm(join(home, tree));
            fs.rename(join(staging, tree), join(home, tree));
        }
        for (const pem of PEMS) fs.rename(join(staging, pem), join(home, pem));
        fs.writeText(join(home, 'engine.stamp'), versionText);
        fs.rm(staging);
    }

    private onExit(process: WorldProcess, code: number | null): void {
        if (this.process !== process) return;
        this.process = null;
        if (this.status === 'ready') {
            this.reason = `The world stopped unexpectedly (code ${code})`;
            this.set('failed');
            this.deps.log(`[singleplayer] ${this.reason}`);
        }
    }

    private async doStop(): Promise<void> {
        const process = this.process;
        const ports = this.ports;
        this.set('stopping');
        if (process && ports && this.url) {
            this.process = null;
            await this.deps.httpPost(`http://127.0.0.1:${ports.management}/shutdown`).catch(() => null);
            const grace = this.deps.sleep(STOP_GRACE_MS).then(() => 'timeout' as const);
            const outcome = await Promise.race([process.exited.then(() => 'exited' as const), grace]);
            if (outcome === 'timeout') {
                this.deps.log('[singleplayer] the world did not stop in time; killing it');
                process.kill();
                await process.exited;
            }
        } else if (process) {
            this.process = null;
            process.kill();
            await process.exited;
        }
        this.url = null;
        this.ports = null;
        this.set('stopped');
    }
}
```

- [ ] **Step 4: Run the tests until they pass**

Run: `cd $KIT && node --test src/main/singleplayer/service.test.ts 2>&1 | tail -20`
Expected: 11 pass. The fakes' `sleep` advances the clock without waiting, so the deadline and the ten-second grace both run instantly. If a test hangs, the usual cause is a promise the fake never resolves: check that `exit()` or `kill()` was called on the process the test expects.

- [ ] **Step 5: Full suite, typecheck, commit**

Run: `cd $KIT && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)" && npm run typecheck`

```bash
cd $KIT && git add src/main/singleplayer/service.ts src/main/singleplayer/service.test.ts && git commit -m "feat: SinglePlayerService — prepare, start, watch, stop, one world for every window

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Electron adapters, and proof that a utility process runs the engine

**Files:**
- Create: `src/main/singleplayer/electron.ts`
- Temporary, deleted before the commit: `scripts/smoke-utility.cjs`

**Interfaces:**
- Consumes: `SinglePlayerDeps`, `SpawnSpec`, `WorldProcess` from Task 4.
- Produces: `engineResources(): string`, `singlePlayerHome(): string`, `electronDeps(over: { baseUrl: string; cheats: SinglePlayerDeps['cheats']; log: (msg: string) => void }): SinglePlayerDeps`. Task 8 builds the service with it.

- [ ] **Step 1: Prove the utility process runs the ESM engine**

`engine-dist/` exists from Task 1's re-stage. Create `scripts/smoke-utility.cjs` (not committed):

```js
// Throwaway: does Electron's utilityProcess run engine-dist/src/app.js (ESM,
// worker threads, node:sqlite) from a scratch working directory? Prints the
// HTTP status of /rs2.cgi, asks the world to stop, and exits.
const { app, utilityProcess, net } = require('electron');
const { cpSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { createServer } = require('node:net');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { createInterface } = require('node:readline');

const resources = resolve('engine-dist');
const freePort = () =>
    new Promise(ok => {
        const s = createServer();
        s.listen(0, '127.0.0.1', () => {
            const { port } = s.address();
            s.close(() => ok(port));
        });
    });

app.whenReady().then(async () => {
    const home = mkdtempSync(join(tmpdir(), 'kit-smoke-'));
    for (const tree of ['data/pack', 'data/raw', 'public', 'view']) cpSync(join(resources, tree), join(home, tree), { recursive: true });
    mkdirSync(join(home, 'data/config'), { recursive: true });
    for (const pem of ['private.pem', 'public.pem']) cpSync(join(resources, 'data/config', pem), join(home, 'data/config', pem));
    const [web, management, tcp] = [await freePort(), await freePort(), await freePort()];
    writeFileSync(
        join(home, 'data/config/world.json'),
        JSON.stringify({ web: { port: web, host: '127.0.0.1', managementPort: management }, node: { id: 1, port: tcp, host: '127.0.0.1', production: false, localStaffLevel: 0 }, login: { enabled: false }, friend: { enabled: false }, logger: { enabled: false }, build: { liveReload: false, srcDir: 'content-absent' } })
    );
    const child = utilityProcess.fork(join(resources, 'src/app.js'), [], { cwd: home, stdio: 'pipe', serviceName: 'smoke-world' });
    for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', line => console.log('  world | ' + line));
    child.on('exit', code => console.log('  world exited ' + code));
    let status = null;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && status !== 200) {
        try {
            status = (await net.fetch(`http://127.0.0.1:${web}/rs2.cgi`, { signal: AbortSignal.timeout(2000) })).status;
        } catch {
            status = null;
        }
        await new Promise(r => setTimeout(r, 250));
    }
    console.log(`rs2.cgi status: ${status} after ${Math.round((Date.now() - (deadline - 60_000)) / 100) / 10}s`);
    const stop = await net.fetch(`http://127.0.0.1:${management}/shutdown`, { method: 'POST' }).then(r => r.status).catch(e => String(e));
    console.log(`shutdown: ${stop}`);
    const exited = await Promise.race([new Promise(r => child.once('exit', () => r('exited'))), new Promise(r => setTimeout(() => r('timeout'), 10_000))]);
    console.log(`after shutdown: ${exited}`);
    if (exited === 'timeout') child.kill();
    rmSync(home, { recursive: true, force: true });
    app.exit(status === 200 && exited === 'exited' ? 0 : 1);
});
```

Run: `cd $KIT && ./node_modules/.bin/electron scripts/smoke-utility.cjs 2>&1 | tail -12; echo "exit ${PIPESTATUS[0]:-$?}"`
Expected: `World ready` among the world lines, `rs2.cgi status: 200 after` a few seconds, `shutdown: 202`, `after shutdown: exited`, exit 0. Paste the output into your report.

If the fork fails with an ESM error (`require() of ES Module`, `Cannot use import statement`, or the child exits immediately with no output), the fallback is `child_process.fork` with Electron as Node: replace the `utilityProcess.fork(...)` line with `require('node:child_process').fork(join(resources, 'src/app.js'), [], { cwd: home, execPath: process.execPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })`, rerun, and use that in Step 2's `spawnWorld` instead, saying so in the report.

- [ ] **Step 2: The adapters**

Create `src/main/singleplayer/electron.ts`:

```ts
import { app, net, utilityProcess } from 'electron';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { SinglePlayerDeps, SpawnSpec, WorldProcess } from './service.ts';

/** The staged engine: beside the app's asar when packaged, engine-dist/ in dev. */
export function engineResources(): string {
    return app.isPackaged ? join(process.resourcesPath, 'engine') : join(app.getAppPath(), 'engine-dist');
}

/** Where the world runs and the saves live. */
export function singlePlayerHome(): string {
    return join(app.getPath('userData'), 'singleplayer');
}

export function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            server.close(() => resolve(port));
        });
    });
}

async function httpStatus(url: string): Promise<number | null> {
    try {
        return (await net.fetch(url, { signal: AbortSignal.timeout(2_000) })).status;
    } catch {
        return null;
    }
}

async function httpPost(url: string): Promise<number | null> {
    try {
        return (await net.fetch(url, { method: 'POST', signal: AbortSignal.timeout(2_000) })).status;
    } catch {
        return null;
    }
}

/**
 * The world as a utility process: Electron's own Node, no install needed.
 * stdout and stderr are split into lines for the log tail and world.log.
 */
function spawnWorld(spec: SpawnSpec): WorldProcess {
    const child = utilityProcess.fork(spec.entry, [], { cwd: spec.cwd, stdio: 'pipe', serviceName: 'single-player-world' });
    for (const stream of [child.stdout, child.stderr]) {
        if (stream) createInterface({ input: stream }).on('line', spec.onLine);
    }
    const exited = new Promise<number | null>(resolve => {
        child.once('exit', code => resolve(code));
    });
    return {
        exited,
        kill: () => {
            child.kill();
        }
    };
}

export function electronDeps(over: { baseUrl: string; cheats: SinglePlayerDeps['cheats']; log: (msg: string) => void }): SinglePlayerDeps {
    return {
        resources: engineResources(),
        home: singlePlayerHome(),
        baseUrl: over.baseUrl,
        cheats: over.cheats,
        join,
        fs: {
            exists: existsSync,
            readText: path => readFileSync(path, 'utf8'),
            writeText: (path, text) => writeFileSync(path, text),
            appendText: (path, text) => appendFileSync(path, text),
            mkdir: path => mkdirSync(path, { recursive: true }),
            rm: path => rmSync(path, { recursive: true, force: true }),
            rename: renameSync,
            copyDir: (from, to) => cpSync(from, to, { recursive: true })
        },
        freePort,
        spawn: spawnWorld,
        httpStatus,
        httpPost,
        sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
        now: Date.now,
        log: over.log
    };
}
```

If Step 1 needed the fallback, `spawnWorld` uses `fork` from `node:child_process` with `execPath: process.execPath`, `env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }`, `stdio: ['ignore', 'pipe', 'pipe', 'ipc']`, and `child.kill('SIGTERM')`.

- [ ] **Step 3: Typecheck, delete the smoke script, commit**

Run: `cd $KIT && npm run typecheck && npm run build 2>&1 | tail -1 && rm scripts/smoke-utility.cjs && git status --short`
Expected: clean typecheck; only `src/main/singleplayer/electron.ts` untracked.

```bash
cd $KIT && git add src/main/singleplayer/electron.ts && git commit -m "feat: the single-player service's Electron deps — utility process, ports, fetch, files

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The starting page and the guard

**Files:**
- Create: `static/starting.html`, `static/page.css`
- Modify: `static/offline.html` (its `<style>` moves to `page.css`)
- Modify: `src/main/guard.ts`, `src/main/guard.test.ts`

**Interfaces:**
- Produces: `static/starting.html?state=<preparing|starting|stopping|stopped|failed>&name=&version=&reason=&log=` and its retry navigation `starting.html?retry=1`; `NavigationDecision` gains `'retry'`. Task 8 loads the page and acts on the decision.

- [ ] **Step 1: Write the failing guard tests**

Append to `src/main/guard.test.ts` (it imports `decideNavigation` from `./guard.ts` already):

```ts
test("the starting page's retry is a kit navigation, not a page one", () => {
    const current = 'file:///app/static/starting.html?state=failed';
    assert.equal(decideNavigation({ current, target: 'file:///app/static/starting.html?retry=1', expected: 'http://127.0.0.1:40001/rs2.cgi?lowmem=1' }), 'retry');
    // only from a kit page, and only the retry query
    assert.equal(decideNavigation({ current: 'http://127.0.0.1:40001/rs2.cgi', target: 'file:///app/static/starting.html?retry=1', expected: 'http://127.0.0.1:40001/rs2.cgi' }), 'block');
    assert.equal(decideNavigation({ current, target: 'file:///app/static/starting.html?state=failed', expected: 'http://127.0.0.1:40001/rs2.cgi' }), 'block');
    assert.equal(decideNavigation({ current, target: 'file:///etc/passwd?retry=1', expected: 'http://127.0.0.1:40001/rs2.cgi' }), 'block');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $KIT && node --test src/main/guard.test.ts 2>&1 | tail -6`
Expected: the new test fails with `'block'` where `'retry'` is expected.

- [ ] **Step 3: The guard**

In `src/main/guard.ts`, extend the type and add the rule before the `try`:

```ts
export type NavigationDecision = 'allow' | 'open-external' | 'block' | 'retry';

/** The starting page's Retry button navigates to itself with ?retry=1; main answers it. */
function isRetry(target: string): boolean {
    try {
        const url = new URL(target);
        return url.protocol === 'file:' && url.pathname.endsWith('/starting.html') && url.searchParams.get('retry') === '1';
    } catch {
        return false;
    }
}
```

and, as the second line of `decideNavigation`, after the existing `allow` rule: `if (nav.current.startsWith('file:') && isRetry(nav.target)) return 'retry';`. Extend the doc comment: "The other exception is the starting page asking for a retry, which is a request to main, not a navigation."

- [ ] **Step 4: Share the page style**

Create `static/page.css` with the entire contents of the `<style>` element in `static/offline.html` (everything between `<style>` and `</style>`, unchanged), and replace that element in `offline.html` with `<link rel="stylesheet" href="./page.css" />`. Add to the end of `page.css`:

```css
/* The starting page's log well: the recessed field, scrolling, left-aligned, smaller. */
pre {
    display: block; margin: 8px 0 0; max-height: 9em; overflow: auto; text-align: left;
    font: 12px/1.4 Menlo, Consolas, monospace; white-space: pre-wrap; word-break: break-word;
    background-color: #37311f;
    border: 2px solid #7d7463; border-top-color: #211d16; border-left-color: #211d16;
    padding: 4px 8px; color: #a89c86;
}
.version { color: #a89c86; font-size: 12px; margin-top: 12px; }
```

- [ ] **Step 5: The starting page**

Create `static/starting.html`:

```html
<!doctype html>
<meta charset="utf-8" />
<title>Zanaris Kit — single player</title>
<link rel="stylesheet" href="./page.css" />
<div class="slab">
    <h1 id="title">Starting your world<span class="dots"></span></h1>
    <p id="text"></p>
    <pre id="log" hidden></pre>
    <button type="button" id="retry" hidden>Try again</button>
    <p class="version" id="version"></p>
</div>
<script>
    const q = new URLSearchParams(location.search);
    const state = q.get('state') || 'starting';
    const title = document.getElementById('title');
    const text = document.getElementById('text');
    const log = document.getElementById('log');
    const retry = document.getElementById('retry');

    const copy = {
        preparing: ['Getting the world ready', 'The first start copies the game files. This takes a moment.'],
        starting: ['Starting your world', 'Loading the map and everyone in it.'],
        stopping: ['Stopping the world', 'Saving and shutting down.'],
        stopped: ['The world is stopped', 'Open it again from the panel.'],
        failed: ["The world couldn't start", q.get('reason') || 'No reason was given.']
    };
    const [heading, detail] = copy[state] || copy.starting;
    title.textContent = heading;
    if (state === 'preparing' || state === 'starting' || state === 'stopping') {
        const dots = document.createElement('span');
        dots.className = 'dots';
        title.appendChild(dots);
    }
    text.textContent = detail;
    if (q.get('version')) document.getElementById('version').textContent = q.get('version');

    if (state === 'failed') {
        const lines = q.get('log') || '';
        if (lines) {
            log.textContent = lines;
            log.hidden = false;
        }
        retry.hidden = false;
        // A navigation to ourselves with ?retry=1: main sees it and starts the world again.
        retry.addEventListener('click', () => location.replace('starting.html?retry=1'));
    }
</script>
```

- [ ] **Step 6: Look at both pages and run the guard tests**

Run: `cd $KIT && node --test src/main/guard.test.ts 2>&1 | tail -4 && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: pass.

Open each page in the Browser pane as a file URL to check they render with the shared style: `file://$KIT/static/starting.html?state=failed&reason=The%20world%20exited%20(code%201)&log=Starting%20world%0AError%3A%20boom&version=engine%20abc1234%20%C2%B7%20content%20def5678%20%C2%B7%20rev%20274` and `file://$KIT/static/offline.html?url=http://example.invalid&name=Example`. Expected: the slab, gold heading, the log well with two lines and a red Try again button on the first; the offline page unchanged in appearance. Take a screenshot of each for the report.

- [ ] **Step 7: Commit**

```bash
cd $KIT && git add static/starting.html static/page.css static/offline.html src/main/guard.ts src/main/guard.test.ts && git commit -m "feat: starting page for the single-player world, sharing the offline page's style

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: State, the IPC contract and the preload

**Files:**
- Modify: `src/main/appState.ts`, `src/main/appState.test.ts`
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`

**Interfaces:**
- Produces: `AppState.singlePlayerCheats(): boolean`, `AppState.setSinglePlayerCheats(on: boolean): void` (file key `singlePlayer: { cheats }`, default false); `IPC.singlePlayerSetCheats/Retry/OpenSaves/ShowLog`; `TOOL_IDS` includes `'singleplayer'`; `ShellState.singlePlayer: SinglePlayerView | null`; `ZanarisApi.singlePlayer.{setCheats, retry, openSaves, showLog}`. Tasks 8 and 9 use them.

- [ ] **Step 1: Write the failing state tests**

Append to `src/main/appState.test.ts` (it already imports `test`, `assert`, `AppState` and the temp-dir helpers; add `mkdtempSync`, `tmpdir`, `join`, `readFileSync`, `writeFileSync` if any is missing):

```ts
test('single-player cheats are off by default, persist, and survive a file without the key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'state-'));
    const file = join(dir, 'state.json');
    const state = new AppState(file);
    state.load();
    assert.equal(state.singlePlayerCheats(), false);
    state.setSinglePlayerCheats(true);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).singlePlayer.cheats, true);
    const again = new AppState(file);
    again.load();
    assert.equal(again.singlePlayerCheats(), true);
    writeFileSync(file, JSON.stringify({ version: 1, worlds: {}, warnOnSwitch: true }));
    const older = new AppState(file);
    older.load();
    assert.equal(older.singlePlayerCheats(), false);
    writeFileSync(file, JSON.stringify({ version: 1, worlds: {}, singlePlayer: { cheats: 'yes' } }));
    const odd = new AppState(file);
    odd.load();
    assert.equal(odd.singlePlayerCheats(), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $KIT && node --test src/main/appState.test.ts 2>&1 | tail -5`
Expected: `singlePlayerCheats is not a function`.

- [ ] **Step 3: The state**

In `src/main/appState.ts`: add `singlePlayer: { cheats: boolean };` to `StateFile`; a field `private cheats = false;`; reset it in `load()` beside the others, and after the chat line in `load()` add:

```ts
            const sp = parsed?.singlePlayer;
            if (typeof sp === 'object' && sp !== null && typeof (sp as { cheats?: unknown }).cheats === 'boolean') this.cheats = (sp as { cheats: boolean }).cheats;
```

Add the accessors after `setChat`:

```ts
    /** Whether the single-player world grants developer commands. Off until asked for. */
    singlePlayerCheats(): boolean {
        return this.cheats;
    }

    setSinglePlayerCheats(on: boolean): void {
        this.cheats = on;
        this.save();
    }
```

and include `singlePlayer: { cheats: this.cheats }` in the object `save()` writes.

- [ ] **Step 4: The contract**

In `src/shared/ipc.ts`: import `type { SinglePlayerView } from './singleplayer'`; add to `IPC`:

```ts
    singlePlayerSetCheats: 'zanaris:singleplayer-set-cheats',
    singlePlayerRetry: 'zanaris:singleplayer-retry',
    singlePlayerOpenSaves: 'zanaris:singleplayer-open-saves',
    singlePlayerShowLog: 'zanaris:singleplayer-show-log'
```

`TOOL_IDS` becomes `['worlds', 'chat', 'singleplayer'] as const` (update its comment: three tools now). Add to `ShellState` after `chat`:

```ts
    /** The world this computer runs; null for every other kind of window. */
    singlePlayer: SinglePlayerView | null;
```

Add to `ZanarisApi`:

```ts
    singlePlayer: {
        /** Asks first when the world is running, since it restarts. */
        setCheats(on: boolean): Promise<void>;
        retry(): Promise<void>;
        openSaves(): Promise<void>;
        showLog(): Promise<void>;
    };
```

In `src/preload/index.ts`, add to `api`:

```ts
    singlePlayer: {
        setCheats: on => ipcRenderer.invoke(IPC.singlePlayerSetCheats, on),
        retry: () => ipcRenderer.invoke(IPC.singlePlayerRetry),
        openSaves: () => ipcRenderer.invoke(IPC.singlePlayerOpenSaves),
        showLog: () => ipcRenderer.invoke(IPC.singlePlayerShowLog)
    }
```

`ShellState` now requires `singlePlayer`, so `serverWindow.ts`'s `state()` fails to typecheck until Task 8; to keep this task green, add `singlePlayer: null` to that object literal now (Task 8 replaces it).

- [ ] **Step 5: Verify and commit**

Run: `cd $KIT && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)" && npm run typecheck && npm run build 2>&1 | tail -1`

```bash
cd $KIT && git add src/main/appState.ts src/main/appState.test.ts src/shared/ipc.ts src/preload/index.ts src/main/serverWindow.ts && git commit -m "feat: single-player state, IPC channels and the preload bridge

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The single-player window and main

**Files:**
- Modify: `src/main/serverWindow.ts`, `src/main/index.ts`

**Interfaces:**
- Consumes: `SinglePlayerService` (Task 4), `electronDeps` (Task 5), the starting page and `'retry'` (Task 6), state and channels (Task 7).
- Produces: `ServerWindowDeps.singlePlayer: SinglePlayerHandle | null`; `ShellState.singlePlayer` populated; IPC handlers; the service singleton; stop on quit. Task 9 draws the view; Task 10 captures it.

- [ ] **Step 1: The window**

In `src/main/serverWindow.ts`:

Imports: add `import type { SinglePlayerView } from '../shared/singleplayer';` and `const STARTING_PAGE = join(__dirname, '../../static/starting.html');` beside `OFFLINE_PAGE`.

Add the narrow handle and the dep:

```ts
/** What a single-player window needs of the service; the service itself satisfies it. */
export interface SinglePlayerHandle {
    view(): SinglePlayerView;
    subscribe(fn: () => void): () => void;
    acquire(): Promise<string>;
    release(): void;
    retry(): Promise<string>;
}
```

In `ServerWindowDeps`, after `probe`: `/** The world this computer runs, for a window of kind singleplayer; null otherwise. */ singlePlayer: SinglePlayerHandle | null;`

Tools: replace the `tools` line with

```ts
    const single = server.kind === 'singleplayer' ? deps.singlePlayer : null;
    const tools: ToolId[] = single ? ['chat', 'singleplayer'] : worldSwitch ? ['chat', 'worlds'] : ['chat'];
```

Labels: `gameLabel()` returns, for `single`, `` `${server.name} · rev ${server.revision ?? '?'} · ${statusWord(single.view().status)}` `` with

```ts
const STATUS_WORD: Record<SinglePlayerView['status'], string> = {
    stopped: 'stopped',
    preparing: 'getting ready',
    starting: 'starting',
    ready: 'running',
    stopping: 'stopping',
    failed: 'failed'
};
function statusWord(status: SinglePlayerView['status']): string {
    return STATUS_WORD[status];
}
```

State: `singlePlayer: single?.view() ?? null` in the object `state()` returns (replacing the `null` from Task 7).

The load promise must survive a load that supersedes another (the starting page, then the game): change `loadGame` so a waiter that was never settled is settled by the next load's result:

```ts
    function loadGame(url: string): Promise<LoadResult> {
        expected = url;
        failedOver = false;
        const previous = loadWaiter;
        loadPromise = new Promise<LoadResult>(resolve => {
            loadWaiter = result => {
                resolve(result);
                previous?.(result);
            };
        });
        refreshLabels();
        pushState();
        void gameView.webContents.loadURL(url);
        return loadPromise;
    }
```

Kit pages: generalise the offline-page branch of `did-finish-load` to any `file:` URL (the log line becomes `showing a kit page`), and add the starting page:

```ts
    /** The starting page in the state the service is in. Only a single-player window shows it. */
    function showStarting(): void {
        if (!single || win.isDestroyed()) return;
        const view = single.view();
        const version = view.version ? `engine ${view.version.engine.slice(0, 8)} · content ${view.version.content.slice(0, 8)} · rev ${view.version.revision}` : '';
        failedOver = true;
        void gameView.webContents.loadFile(STARTING_PAGE, {
            query: { state: view.status, name: server.name, version, reason: view.reason ?? '', log: view.logTail.slice(-20).join('\n') }
        });
    }

    /** The world changed state: load the game when it is ready, show the page otherwise. */
    let loadedGameUrl: string | null = null;
    function syncSinglePlayer(): void {
        if (!single) return;
        const view = single.view();
        refreshLabels();
        pushState();
        if (view.status === 'ready' && view.url) {
            if (loadedGameUrl !== view.url) {
                loadedGameUrl = view.url;
                void loadGame(view.url);
            }
            return;
        }
        loadedGameUrl = null;
        showStarting();
    }
```

In `will-navigate`, handle the new decision before the `open-external` branch:

```ts
        if (decision === 'retry') {
            deps.log(`${tag} retrying the world`);
            void single?.retry().catch(() => undefined);
            return;
        }
```

In `did-fail-load`, when `single` is set, call `showStarting()` instead of loading the offline page (the service's own view says why), keeping the `settleLoad('failed')`.

Startup and shutdown: replace the final `void loadGame(expected);` with

```ts
    let unsubscribeSingle: (() => void) | null = null;
    if (single) {
        // The load promise stays pending until the game itself loads, or the world fails.
        loadPromise = new Promise<LoadResult>(resolve => {
            loadWaiter = resolve;
        });
        unsubscribeSingle = single.subscribe(syncSinglePlayer);
        showStarting();
        void single.acquire().then(
            () => syncSinglePlayer(),
            () => {
                syncSinglePlayer();
                settleLoad('failed');
            }
        );
    } else {
        void loadGame(expected);
    }
```

and in the `closed` handler add `unsubscribeSingle?.(); single?.release();`.

- [ ] **Step 2: Main**

In `src/main/index.ts`:

Imports: `import { SinglePlayerService } from './singleplayer/service';`, `import { electronDeps, singlePlayerHome } from './singleplayer/electron';`.

Below `let update: LatestRelease | null = null;`:

```ts
/** The one world this computer runs; built at ready, when the paths and the catalog exist. */
let singlePlayer: SinglePlayerService | null = null;
```

In the window factory's deps object add `singlePlayer` (the singleton; the window ignores it unless its server is of that kind).

In `app.whenReady`, after `loadCatalog();` and before `void checkForUpdate();`:

```ts
    singlePlayer = new SinglePlayerService(
        electronDeps({
            baseUrl: catalog.get('singleplayer')?.url ?? 'http://127.0.0.1/rs2.cgi?lowmem=1',
            cheats: { get: () => appState.singlePlayerCheats(), set: on => appState.setSinglePlayerCheats(on) },
            log
        })
    );
    singlePlayer.subscribe(() => {
        for (const sw of serverWindows.values()) if (sw.state().server.kind === 'singleplayer') sw.pushState();
    });
```

Quit waits for the world to flush its saves:

```ts
let worldStoppedForQuit = false;
app.on('before-quit', event => {
    quitting = true;
    chat?.stop();
    const status = singlePlayer?.view().status;
    if (singlePlayer && !worldStoppedForQuit && status !== 'stopped' && status !== 'failed' && status !== undefined) {
        event.preventDefault();
        void singlePlayer.stop().finally(() => {
            worldStoppedForQuit = true;
            app.quit();
        });
    }
});
```

(replacing the existing `before-quit` handler).

IPC, after the chat handlers:

```ts
// ── single player ─────────────────────────────────────────────────────────

async function confirmCheats(sw: ServerWindow, on: boolean): Promise<boolean> {
    const { response } = await dialog.showMessageBox(sw.window, {
        type: 'question',
        buttons: ['Restart', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        message: `Turning cheats ${on ? 'on' : 'off'} restarts your world and logs you out.`,
        detail: on ? 'Developer commands such as ::tele and ::give will work.' : 'The world will play as the servers do.'
    });
    return response === 0;
}

ipcMain.handle(IPC.singlePlayerSetCheats, async (event, on: unknown) => {
    if (typeof on !== 'boolean' || !singlePlayer) return;
    const sw = windowFor(event.sender);
    if (!sw || sw.state().server.kind !== 'singleplayer') return;
    if (singlePlayer.view().cheats === on) return;
    const running = singlePlayer.view().status !== 'stopped' && singlePlayer.view().status !== 'failed';
    if (running && !(await confirmCheats(sw, on))) return;
    await singlePlayer.setCheats(on);
});

ipcMain.handle(IPC.singlePlayerRetry, async event => {
    const sw = windowFor(event.sender);
    if (!sw || sw.state().server.kind !== 'singleplayer' || !singlePlayer) return;
    await singlePlayer.retry().catch(() => undefined);
});

ipcMain.handle(IPC.singlePlayerOpenSaves, async () => {
    const saves = join(singlePlayerHome(), 'data', 'players', 'main');
    mkdirSync(saves, { recursive: true });
    await shell.openPath(saves);
});

ipcMain.handle(IPC.singlePlayerShowLog, async () => {
    const logPath = join(singlePlayerHome(), 'world.log');
    if (!existsSync(logPath)) writeFileSync(logPath, '');
    await shell.openPath(logPath);
});
```

- [ ] **Step 3: Typecheck, build, and a dev run**

Run: `cd $KIT && npm run typecheck && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)" && npm run build 2>&1 | tail -1`

Then open a single-player window from the built dev app and watch the log. `engine-dist/` must exist. Run: `cd $KIT && LOG="$TMPDIR/kit-sp.log" && (ZANARIS_NO_UPDATE_CHECK=1 ./node_modules/.bin/electron . > "$LOG" 2>&1 &) && sleep 6 && echo opened`. Then, from the running app, choose File > New Window For > Single player (rev 274): use the Browser pane's computer tool only if the window is visible in it; otherwise drive it with the macOS accessibility route the computer-use tools offer, or, simplest, restart the app with the single-player entry first in a temporary catalog: set `ZANARIS_CAPTURE` is not it (capture opens every server). Use the temporary-catalog route: `cd $KIT && pkill -f "Electron\.app/Contents/MacOS/Electron \." ; node -e "const f=require('os').homedir()+'/Library/Application Support/zanaris-kit/servers.json'; const j=JSON.parse(require('fs').readFileSync(f,'utf8')); const i=j.servers.findIndex(s=>s.id==='singleplayer'); const [sp]=j.servers.splice(i,1); j.servers.unshift(sp); require('fs').writeFileSync(f, JSON.stringify(j,null,2)+'\n'); console.log(j.servers.map(s=>s.id).join(','))"` (this reorders the real profile's catalog so the first window at launch is Single player; restore the order afterwards by moving it back before `local`). Launch again as above, wait 15 s, then: `grep -E "singleplayer|Single player|World ready|opened" "$LOG" | head -20 && ls "$HOME/Library/Application Support/zanaris-kit/singleplayer" && cat "$HOME/Library/Application Support/zanaris-kit/singleplayer/data/config/world.json" | head -12`.
Expected: `[main] opened Single player — http://127.0.0.1/rs2.cgi?lowmem=1`, `[singleplayer] ready on port N`, the game load line for `http://127.0.0.1:N/rs2.cgi?lowmem=1`; the home holds `engine.stamp`, `world.log`, `data`, `public`, `view`; `world.json` shows loopback hosts and `localStaffLevel: 0`. Take a screenshot of the window if the Browser pane or computer-use tools can see it; otherwise the log is the evidence. Quit the app (`pkill -INT -f "Electron\.app/Contents/MacOS/Electron \."`), wait 12 s, and confirm no engine process remains: `pgrep -fl "engine/src/app.js|engine-dist/src/app.js" || echo "world stopped"`. Restore the catalog order.

- [ ] **Step 4: Commit**

```bash
cd $KIT && git add src/main/serverWindow.ts src/main/index.ts && git commit -m "feat: a Single player window starts the world, shows the starting page, loads the game when ready

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: The Single player tool

**Files:**
- Create: `src/renderer/tools/SinglePlayer.tsx`
- Modify: `src/renderer/icons.tsx`, `src/renderer/Shell.tsx`

**Interfaces:**
- Consumes: `ShellState.singlePlayer`, `window.zanaris.singlePlayer` (Task 7), tool id `singleplayer`.

- [ ] **Step 1: The icon**

Append to `src/renderer/icons.tsx`:

```tsx
/** Single player. A lit hearth on the stone: a warm flame over a dark grate, one flat sprite on the shared outline. */
export function Hearth(): ReactNode {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
            <rect x="3" y="12" width="12" height="3.5" fill="#5a4a38" stroke={OUTLINE} strokeWidth="1.3" />
            <path d="M9 2.5c1.2 2 3.6 3.4 3.6 6.2A3.6 3.6 0 0 1 9 12.2a3.6 3.6 0 0 1-3.6-3.5c0-1.4.6-2.2 1.3-3 .1 1.1.6 1.7 1.3 1.9C7.7 5.4 8.2 3.8 9 2.5z" fill="#ffe139" stroke={OUTLINE} strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M9 7.4c.6 1 1.4 1.6 1.4 2.6A1.4 1.4 0 0 1 9 11.3a1.4 1.4 0 0 1-1.4-1.3c0-.9.8-1.6 1.4-2.6z" fill="#a70700" />
        </svg>
    );
}
```

- [ ] **Step 2: The tool**

Create `src/renderer/tools/SinglePlayer.tsx`:

```tsx
import type { CSSProperties, ReactNode } from 'react';
import type { SinglePlayerView } from '../../shared/singleplayer';

const STATUS: Record<SinglePlayerView['status'], string> = {
    stopped: 'Stopped',
    preparing: 'Getting the world ready',
    starting: 'Starting',
    ready: 'Running',
    stopping: 'Stopping',
    failed: 'Failed'
};

const MUTED: CSSProperties = { color: 'var(--color-dim)' };

/** The Single player tool: what the world is doing, the cheats switch, and where its files are. */
export default function SinglePlayer({ view }: { view: SinglePlayerView }): ReactNode {
    const busy = view.status === 'preparing' || view.status === 'starting' || view.status === 'stopping';
    const status = view.status === 'ready' && view.port !== null ? `Running on port ${view.port}` : STATUS[view.status];
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <h2 className="title">Single player</h2>

            <div className="px-2.5">
                <p className={view.status === 'failed' ? 'text-warn' : 'text-cream'} aria-live="polite">
                    {status}
                </p>
                {view.status === 'failed' && view.reason && <p className="text-[12px] text-dim">{view.reason}</p>}
                {view.version && (
                    <p className="text-[12px] text-faint">
                        engine {view.version.engine.slice(0, 8)} · content {view.version.content.slice(0, 8)} · rev {view.version.revision}
                    </p>
                )}
            </div>

            {view.status === 'failed' && view.logTail.length > 0 && (
                <pre className="sunk mx-2.5 mt-2 max-h-[9em] overflow-auto px-2 py-1 font-mono text-[11px] whitespace-pre-wrap text-dim">
                    {view.logTail.slice(-20).join('\n')}
                </pre>
            )}

            <div className="mt-3 px-2.5">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        role="switch"
                        aria-checked={view.cheats}
                        disabled={busy}
                        onClick={() => void window.zanaris.singlePlayer.setCheats(!view.cheats)}
                        style={view.cheats ? undefined : MUTED}
                        className={`btn${view.cheats ? ' btn-red' : ''}`}
                    >
                        Cheats {view.cheats ? 'on' : 'off'}
                    </button>
                    <span className="text-[12px] text-dim">Developer commands such as ::tele and ::give. Off, the world plays as the servers do.</span>
                </div>
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-2 px-2.5 pt-2 pb-1.5">
                {view.status === 'failed' && (
                    <button type="button" onClick={() => void window.zanaris.singlePlayer.retry()} className="btn btn-red">
                        Try again
                    </button>
                )}
                <button type="button" onClick={() => void window.zanaris.singlePlayer.openSaves()} className="btn">
                    Open saves folder
                </button>
                <button type="button" onClick={() => void window.zanaris.singlePlayer.showLog()} className="btn">
                    Show log
                </button>
            </div>
            <p className="px-2.5 pb-2 text-[12px] text-dim">Changing cheats restarts the world and logs you out.</p>
        </div>
    );
}
```

- [ ] **Step 3: The shell**

In `src/renderer/Shell.tsx`: import `Hearth` and `SinglePlayer`; add `{ id: 'singleplayer', label: 'Single player', group: 'server', icon: <Hearth /> }` to `TOOLS` after `worlds`; and in the panel's ternary add, before the fallback: `: active === 'singleplayer' && state.singlePlayer ? (<SinglePlayer view={state.singlePlayer} />)`.

- [ ] **Step 4: Typecheck, build, look**

Run: `cd $KIT && npm run typecheck && npm run build 2>&1 | tail -1 && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`

Run the dev app with the single-player entry first in the catalog (Task 8's reordering), open the panel on the Single player tool (Cmd+\ opens the panel on the first tool, chat; click the hearth tab or, with the window focused, use the rail), and capture the panel in the three states you can reach: running, then Cheats on (Restart in the dialog), then Show log. If no screen tool can reach the window, use capture mode after Task 10 instead and say so.

- [ ] **Step 5: Commit**

```bash
cd $KIT && git add src/renderer/tools/SinglePlayer.tsx src/renderer/icons.tsx src/renderer/Shell.tsx && git commit -m "feat: Single player tool — status, cheats, saves folder, log

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Capture mode, the docs, and the packaged build

**Files:**
- Modify: `src/main/index.ts` (capture), `README.md`, `RELEASE.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Capture mode**

In `captureAndExit`, the opened list is every catalog server, so the single-player window is already opened and waited on through `whenGameLoaded()`, which Task 8 made resolve on the real game load. Two additions:

1. Before opening, skip the entry when the engine is not staged, so a capture on a machine without `engine-dist/` is not a failure: `const servers = catalog.list().filter(s => s.kind !== 'singleplayer' || existsSync(join(engineResources(), 'VERSION.json')));` (import `engineResources` from `./singleplayer/electron`), logging `[capture] singleplayer skipped: engine not staged` when it drops it, and use `servers` in place of `catalog.list()`.
2. After the worlds section, capture the tool: find the single-player window among `opened` (`sw.state().server.kind === 'singleplayer'`), and if its result was `'loaded'`: `sw.selectTool('singleplayer'); await wait(500); await shoot('singleplayer-tool', sw); log(\`[capture] singleplayer: ${sw.state().singlePlayer?.status} on port ${sw.state().singlePlayer?.port}\`)`.
3. In the `finally` that quits, the world stops through `before-quit`; nothing to add, but confirm in the run below that it does.

- [ ] **Step 2: Run capture**

Run: `cd $KIT && npm run build 2>&1 | tail -1 && CAP="$TMPDIR/kit-capture-sp" && rm -rf "$CAP" && ZANARIS_CAPTURE="$CAP" ZANARIS_NO_UPDATE_CHECK=1 ./node_modules/.bin/electron . 2>&1 | grep -E "capture|singleplayer" | head -30; ls "$CAP"; pgrep -fl "engine-dist/src/app.js" || echo "world stopped"`
Expected: `Single player: loaded`, `singleplayer-shell.png`, `singleplayer-game.png`, `singleplayer-tool.png` among the files, the status line `ready on port N`, and `world stopped`. Read `singleplayer-game.png` and `singleplayer-tool.png` with the Read tool: the game's login screen, and the panel with "Running on port N" and "Cheats off".

- [ ] **Step 3: The docs**

`README.md`: in "What it does", after the paragraph about server windows, add a paragraph "Single player" saying: the kit carries the Lost City engine and the game files; File > New Window For > Single player starts a world on this computer, no account, any name at the login screen becomes a character, saves live in the app's data folder (`Application Support/zanaris-kit/singleplayer/data/players/main` on macOS, `%APPDATA%\zanaris-kit\singleplayer\...` on Windows, `~/.config/zanaris-kit/singleplayer/...` on Linux), the rail's Single player tool shows the state, opens the saves folder and the log, and its Cheats switch turns developer commands on for the whole world after a restart. In the catalog table add the row `| singleplayer | 274, the bundled engine | none | | losthq |`. In "Running it", note that `npm run stage:engine` must have run once for Single player to work in dev.

`RELEASE.md` step 2: replace the parenthetical about the single-player release with the live instruction: open Single player, wait for the login screen, log in as a new name, log out, and confirm the `.sav` appeared under the saves path for that platform; then turn Cheats on, accept the restart, log in again and confirm `::tele 3222 3218` moves the character.

- [ ] **Step 4: The packaged build**

Run: `cd $KIT && npm run dist 2>&1 | tail -8` (minutes; the stale-stage check re-stages only if the lock changed since `engine-dist` was staged, which Task 1 already did). Expected: exit 0 and the packaged-engine assertion line. Then run the packaged app in capture mode against a fresh profile so the first-run copy is exercised: `cd $KIT && CAP="$TMPDIR/kit-capture-packaged" && rm -rf "$CAP" && ZANARIS_CAPTURE="$CAP" ZANARIS_NO_UPDATE_CHECK=1 "release/mac-universal/Zanaris Kit.app/Contents/MacOS/Zanaris Kit" 2>&1 | grep -E "capture\] Single|singleplayer" | head; ls "$CAP" | grep singleplayer`. Expected: `Single player: loaded` from the packaged app and the three PNGs. (Capture mode keeps `state.json` beside the screenshots but the world's home is the real userData; that is fine, the stamp matches and nothing is copied twice.)

- [ ] **Step 5: Commit**

```bash
cd $KIT && git add src/main/index.ts README.md RELEASE.md && git commit -m "feat: capture the single-player window and tool; document single player and its release check

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## After the plan

Owner's steps: merge `singleplayer` into `main` (fast-forward), push, and follow `RELEASE.md`: bump the version, dispatch the Release workflow, try the artifacts on each platform including the single-player login and cheats checks, tag, publish. The parked follow-up from the packaging review, `serverWindow.ts`'s `open-external` branch of `will-navigate` lacking an https guard, is a one-line change worth making with the next window edit.
