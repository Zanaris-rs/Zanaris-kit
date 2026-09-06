# Zanaris Kit: packaging, and a single-player world inside the kit

Status: approved 2026-09-06. Extends the server-windows design
(`2026-09-05-server-windows-design.md`), whose milestone 7 listed packaging and
auto-update as follow-ups. Two parts, two implementation plans, in this order:
packaging ships first, single player second, so the first thing a
non-technical player downloads is already the build that carries the world.

## Goal

Most players are not technical: they will not clone a repository, install
Node, or read a terminal. Two things follow.

1. **Packaging.** Zanaris Kit becomes a download: a DMG for macOS, an
   installer for Windows, an AppImage for Linux, built by CI from a tag and
   attached to a GitHub Release. The repository goes public under MIT.
2. **Single player.** The kit carries the Lost City engine and the packed
   cache, and can run a world of its own on the player's machine: File > New
   Window For > Single player, type a name, play. No accounts, no network, no
   install beyond the kit itself. The engine runs in a child process spawned
   by the kit; nothing is injected into the game page, which remains the page
   the local server serves.

## Findings that shaped the design

Measured on 2026-09-06 on an Apple Silicon Mac with engine branch
`274-memory` (commit c5c45f88) and content `274` (commit 2b62ae68d):

| Measure | Result |
| --- | --- |
| Boot to "World ready", plain Node 24 | 2.0 s |
| Boot to "World ready", Electron 44's bundled Node 24.19 via `ELECTRON_RUN_AS_NODE` and tsx | 2.0 s |
| World process RSS, idle | 510 to 550 MB |
| Idle CPU, no players | 1.5 to 2.2 % |
| Engine runtime subset (src, tools, view, public, data/pack, data/raw) | 74 MB, of which the packed cache is 66 MB |
| Production node_modules | 147 MB, of which tsx, TypeScript and esbuild are 42 MB |

What the engine needs and does not need:

- With `login.enabled`, `friend.enabled` and `logger.enabled` all false the
  world authenticates locally: any name typed at the login screen gets its own
  save under `data/players/<profile>/<name>.sav`, the password is ignored, and
  no database is opened. `src/db/query.ts` is imported only by the login,
  friend and logger servers.
- Node's built-in `node:sqlite` is the only SQLite driver; Prisma is a dev
  dependency. The production dependency tree has no native modules once tsx
  and esbuild are removed.
- The engine resolves `data/config/world.json`, `data/pack`, `data/raw`,
  `data/players`, `public` and `view` relative to its working directory
  (221 references to `data/pack` alone). The OnDemand thread opens the cache
  read-write. So the engine gets a writable working directory of its own.
- The web server and the raw TCP server bind `0.0.0.0`. On Windows that
  raises the firewall prompt on first launch.
- Non-production mode gives a local login staff level 4, and
  `ClientCheatHandler` allows developer commands only when production is off
  and the level is at least 4. Production also changes login rate limits,
  script-error handling (logout on error), Prometheus stats and the dev-op
  debug names, so it is not the lever for a cheats toggle.
- Engine, content and the web client are MIT (Lost City). The kit repository
  history is clean: every commit is authored by the pseudonymous account, and
  no revision contains a real name, email or home path.

## Part 1: Packaging

### Engine pin and stage script

`engine.lock.json` at the repository root names what the kit carries:

```json
{
    "engine": { "repo": "https://github.com/Zanaris-rs/Engine-TS.git", "commit": "<sha>" },
    "content": { "repo": "https://github.com/Zanaris-rs/Content.git", "commit": "<sha>" },
    "revision": 274
}
```

HTTPS URLs, because CI clones them without a key; both repositories are
public. `revision` is the game revision the content is, shown in the catalog
entry. The pinned engine commit is the one the fleet runs, so the kit ships
what the servers ship; it moves when the fleet moves, by editing this file.

`scripts/stage-engine.mjs` (Node 24, no arguments; `npm run stage:engine`)
turns the pin into `engine-dist/`, gitignored:

1. Fetches both repositories at their commits into `.engine-work/`
   (gitignored): `git init`, `git fetch --depth 1 <repo> <sha>`,
   `git checkout FETCH_HEAD`. Side by side, so the engine's default
   `build.srcDir` of `../content` holds.
2. In the engine checkout: `npm ci`, then `npm run build`, which packs the
   cache from the content. This takes a few minutes and needs only Node.
3. Asserts the pack the way the fleet's `build.sh` does: `main_file_cache.idx0`
   is a multiple of 6 bytes and holds exactly 9 archives;
   `data/pack/server/script.dat` and `data/pack/.cache/maps-server.zip` exist.
4. Transpiles every `.ts` under `src/` and `tools/` (not `.d.ts`) to `.js`
   with esbuild's transform API: loader `ts`, format `esm`, target `node24`, no
   source maps. The engine's own imports already carry `.js` extensions and its
   `package.json` `imports` map (`#/*`, `#tools/*`) is extension-agnostic, so
   the output is runnable ESM. The eight `new Worker(new URL('./x.ts',
   import.meta.url))` sites are rewritten to `.js`; the script asserts that no
   `.ts` remains inside a `new URL(` call afterwards.
5. Copies the runtime subset into `engine-dist/`: `src/`, `tools/`, `view/`,
   `public/`, `data/pack/` (with `.cache/`, without `.stamps/`), `data/raw/`,
   `data/config/private.pem` and `public.pem`, `package.json`,
   `package-lock.json`.
6. Runs `npm ci --omit=dev --ignore-scripts` in `engine-dist/`
   (`--ignore-scripts` because the engine's `prepare` runs husky, a dev
   dependency), then removes `node_modules/tsx`, `typescript`, `esbuild` and
   `@esbuild`, and asserts `find node_modules -name '*.node'` is empty. One
   engine artifact then serves every platform.
7. Writes `engine-dist/VERSION.json`: `{ engine: {repo, commit}, content:
   {repo, commit}, revision, built }`.
8. Prints the total size. Expected order: 75 MB of engine and cache plus
   about 100 MB of node_modules.

The staged tree must boot: the script's final step starts
`node engine-dist/src/app.js` from a scratch working directory that holds a
copy of the assets, waits for HTTP 200 on `/rs2.cgi`, and stops it. A pin
that does not boot does not stage.

### electron-builder

`electron-builder.yml` at the repository root. electron-vite builds into
`out/`; electron-builder packs it.

- `appId: rs.zanaris.kit`, `productName: Zanaris Kit`,
  `directories: { output: release, buildResources: build }`.
- `files: [out/**, static/**, package.json]`; `asar: true`;
  `npmRebuild: false` (the kit has no native dependencies).
- `extraResources: [{ from: engine-dist, to: engine }]`, so the engine lives
  at `<resources>/engine`, outside asar, where a child process can read it as
  plain files.
- macOS: one universal DMG (`arch: universal`), category
  `public.app-category.games`, hardened runtime off. **Ad-hoc signed.** With
  no Developer ID available electron-builder signs ad hoc; if a build turns
  out not to, an `afterPack` hook runs
  `codesign --force --deep --sign - "<app>"`. Apple Silicon refuses to launch
  a bundle whose signature is missing or invalid, so this is a correctness
  requirement, not polish. Not notarized: see Decisions.
- Windows: NSIS x64, `oneClick: true`, `perMachine: false` (per-user, no
  admin prompt). Unsigned; SmartScreen shows "More info > Run anyway".
- Linux: AppImage x64, category Game.
- `publish: { provider: github, owner: Zanaris-rs, repo: swiftkit,
  releaseType: draft }`.
- Artifact names carry product, version and platform, for example
  `Zanaris-Kit-0.2.0-universal.dmg`, `Zanaris-Kit-Setup-0.2.0.exe`,
  `Zanaris-Kit-0.2.0.AppImage`.
- Icon: `build/icon.png`, 1024 by 1024, from `build/icon.svg`. electron-builder
  derives the icns and ico. The icon is the kit's gold pixel face on the warm
  stone slab the offline page uses, and is a task in the plan; nothing exists
  today.

`npm run dist` runs stage (if `engine-dist/` is missing), the electron-vite
build, and electron-builder for the current platform without publishing, for
local checks.

### CI

Two workflows under `.github/workflows/`.

`ci.yml`, on push to `main` and on pull requests: Ubuntu, Node 24, `npm ci`,
`npm run typecheck`, `npm test`, `npm run build`. Staging the engine is not
part of it: packing takes minutes and the pin changes rarely.

`release.yml`, on tags `v*` and on `workflow_dispatch`:

1. Job `engine` (Ubuntu, Node 24): checkout, `npm ci`,
   `node scripts/stage-engine.mjs`, upload `engine-dist/` as an artifact.
   Runs once; the artifact is platform-independent.
2. Job `build`, needs `engine`, matrix over `macos-14`, `windows-latest`,
   `ubuntu-latest`: checkout, Node 24, `npm ci`, download the artifact to
   `engine-dist/`, assert the tag equals `v` + `package.json` version (tag
   runs only), `npm run build`, then `npx electron-builder --publish always`
   on a tag or `--publish never` plus upload-artifact on a dispatch.
   `GH_TOKEN` is the workflow's `GITHUB_TOKEN` with `contents: write`.

A tag produces a draft GitHub Release holding all three artifacts. The owner
reads it and publishes it; nothing goes public on its own. A dispatch run is
the dry run: same build, artifacts on the workflow run, no release.

### Going public

- `LICENSE`: MIT, copyright "Zanaris Kit contributors". No legal name.
- README gains a Download section linking the latest release, and a
  first-launch guide: macOS, open once via System Settings > Privacy &
  Security > Open Anyway (the right-click Open shortcut is gone since macOS
  15); Windows, SmartScreen > More info > Run anyway; Linux, `chmod +x` the
  AppImage, and `libfuse2` on distributions that lack it.
- No history rewrite: verified clean on 2026-09-06.
- The flip from private to public is the owner's action in repository
  settings, after the first dry-run build succeeds and before the first tag.
  A private repository bills macOS runner minutes at ten times; a public one
  is free.
- A download page on zanaris.rs linking the latest release is a Website task,
  outside this repository, noted as a dependency of announcing the kit.

### Update check

`src/main/update.ts` exports `compareVersions(a, b)` and
`checkLatest(fetchJson, current)`, both pure: given the JSON of
`https://api.github.com/repos/Zanaris-rs/swiftkit/releases/latest`, return
`{ latest, url, newer }`. Main calls it once at ready, after the catalog
loads, with `net.fetch`, a five-second abort and every failure swallowed:
offline, rate limited, malformed. Skipped in capture mode and when
`ZANARIS_NO_UPDATE_CHECK` is set. When `newer`, the menu is rebuilt with a
Help item "Update available: v0.3.0" that opens the release page in the
browser. No download, no install, until builds are signed.

### Release checklist

`RELEASE.md` in the kit, the order to do it in:

1. `engine.lock.json` points at the commit the fleet runs. Bump
   `package.json` version. Commit.
2. Dispatch `release.yml` by hand; download the three artifacts.
3. On this Mac: mount the DMG, copy the app out, `xattr -w
   com.apple.quarantine` it if it lacks the flag, launch through Open Anyway,
   open Single player (from Part 2 onward), log in as a new name, log out,
   confirm the save file exists under the app's data directory.
4. On a Windows machine or VM: run the installer, pass SmartScreen, same
   check. On Ubuntu: AppImage, same check.
5. Tag `v<version>`, push the tag. Wait for the draft release. Read it,
   publish it.

### Testing

- `update.test.ts`: version comparison including prerelease-free triples of
  differing lengths, a newer and an older and an equal latest, and malformed
  API bodies.
- `stage-engine.test.mjs`: the worker-URL rewrite over sample sources; the
  pack assertions over fixture files; the native-module scan.
- `ci.yml` exercises typecheck, tests and the build on every pull request.
- The release checklist is the manual gate for the artifacts themselves.

## Part 2: Single player

### Catalog v3

`ServerDef` gains `kind: 'remote' | 'singleplayer'`. `createServer` sets
`remote`; `isServerDef` requires the field. A built-in entry:

```ts
{
    id: 'singleplayer',
    kind: 'singleplayer',
    name: 'Single player',
    url: 'http://127.0.0.1/rs2.cgi?lowmem=1',   // the port is applied at runtime
    revision: ENGINE_REVISION,                  // from engine.lock.json at build time
    wiki: LOSTHQ,
    map: 'https://tools.losthq.rs/map',
    hosts: ['127.0.0.1', '2004.losthq.rs', 'tools.losthq.rs'],
    notes: 'Runs on this computer. No account needed.',
    worlds: null,
    bookmarks: [...LOSTHQ_BOOKMARKS],
    hiscores: null
}
```

Order: after Lost City Labs, before the developer entry `local`, which stays.
`ENGINE_REVISION` is injected by electron-vite `define` from
`engine.lock.json`, so dev and packaged builds agree.

Migration, `version: 3`: every entry without `kind` gets `remote`; if no
entry has id `singleplayer` the built-in is inserted before `local` when
present, else appended. A v1 file goes through v2 first. The catalog's
`recovered` path is unchanged.

The File menu and dock menu list it like any server, as "Single player (rev
274)".

### SinglePlayerService

`src/main/singleplayer/service.ts`. Pure over injected dependencies, so the
state machine is tested without Electron:

```ts
interface SinglePlayerDeps {
    resources: string;                 // <resources>/engine, or <repo>/engine-dist in dev
    home: string;                      // <userData>/singleplayer
    cheats: () => boolean;             // from AppState
    fs: {                              // the handful of calls the service makes
        exists, readText, writeText, mkdir, rm, rename, copyDir, appendText
    };
    freePort: () => Promise<number>;   // bind 127.0.0.1:0, read, close
    spawn: (spec: SpawnSpec) => WorldProcess;   // wraps utilityProcess.fork
    httpStatus: (url: string) => Promise<number | null>;
    setTimer, clearTimer, now, log
}

type SinglePlayerStatus = 'stopped' | 'preparing' | 'starting' | 'ready' | 'stopping' | 'failed';

interface SinglePlayerView {
    status: SinglePlayerStatus;
    port: number | null;
    url: string | null;               // the game URL while ready
    reason: string | null;            // while failed
    logTail: string[];                // last 200 lines, always
    version: { engine: string; content: string; revision: number; built: string } | null;
    cheats: boolean;
}

class SinglePlayerService {
    view(): SinglePlayerView;
    subscribe(fn: () => void): () => void;
    acquire(): Promise<string>;       // a window wants the world; resolves with the game URL
    release(): void;                  // that window is gone
    retry(): Promise<string>;         // from failed, same as acquire without changing the count
    setCheats(on: boolean): Promise<void>;   // persists, and restarts the world if it is running
    stop(): Promise<void>;            // quit: stop regardless of the count
}
```

One world serves every single-player window. `acquire` counts windows; the
first starts the world, and `release` to zero stops it. On macOS the app can
be open with no windows, so closing the last single-player window stops the
world, and the next open starts it again in a couple of seconds.

### Working directory

```
<userData>/singleplayer/
    engine.stamp                 VERSION.json of the assets currently copied
    world.log                    stdout and stderr of the last run
    data/config/world.json       written by the kit before every start
    data/config/private.pem      copied from resources
    data/config/public.pem
    data/pack/  data/raw/  public/  view/     copied from resources
    data/players/main/<name>.sav              the player's characters; persists
```

`preparing` runs when `engine.stamp` is missing or differs from
`VERSION.json` in resources: copy the four asset trees and the pems into
`<home>/.staging-<n>/`, then rename each into place, replacing the old ones.
`data/players/` is never touched by preparing. About 90 MB, seconds on a
normal disk. Symlinks are deliberately not used: junction rules on Windows,
and a bundle-relative link breaks the first time the app moves.

`world.json` is rewritten before every start from a template held in the
kit. Fixed values: `easyStartup` false; `account.autoCreate` false; `login`,
`friend` and `logger` `enabled` false; `node.id` 1, `node.members` true,
`node.autoSubscribeMembers` true, `node.xpRate` 1, `node.production` false,
`node.debug` false, `node.profile` `main`, `node.maxConnected` 10;
`db.backend` `sqlite`; `build.startup` false, `build.verify` false,
`build.liveReload` false, `build.srcDir` `content-absent` (a path that does
not exist, so the engine neither watches content nor serves the working
directory as static files); `engine.revision` from VERSION.json. Per start:
`web.port`, `web.managementPort`, `node.port` from three free loopback ports;
`web.host` and `node.host` `127.0.0.1`; `node.localStaffLevel` 4 when cheats
are on, else 0. The engine's `normalizeWorldConfig` fills anything the
template omits; environment variables are not relied upon.

### Process lifecycle

Spawn: `utilityProcess.fork('<resources>/src/app.js', [], { cwd: home, stdio:
'pipe', serviceName: 'single-player-world' })`. Electron's utility process is
a Node 24 environment with ESM, worker threads and `node:sqlite`. If the
plan's first task finds ESM entry unsupported there, the fallback is
`child_process.fork` of the same file with `ELECTRON_RUN_AS_NODE=1` through
`process.execPath`, which was proven on 2026-09-06.

stdout and stderr lines go to the ring buffer and `world.log` (truncated at
start). The "World ready" line is the early signal; readiness is an HTTP 200
from `http://127.0.0.1:<port>/rs2.cgi`, polled every 250 ms for up to 60 s.
Exit before ready, or the deadline, is `failed` with the reason and the log
tail.

Stop: `POST http://127.0.0.1:<managementPort>/shutdown` (the engine patch
below), which runs the engine's own exit path and flushes every save; wait up
to ten seconds for the process to exit, then `kill()`. Windows has no
SIGTERM, which is why the stop is a request and not a signal. On `before-quit`
main calls `stop()` and quit waits for it, bounded by the same ten seconds.

Crash while ready: every single-player window shows the starting page in its
failed state with Retry. Nothing restarts on its own.

### Window and starting page

A window on a `singleplayer` entry gets `singleplayer` in its tool list, after
`chat`. At creation it loads `static/starting.html` in the game view and
calls `acquire()`; when that resolves it loads the game URL, and its allowed
hosts gain `127.0.0.1:<port>`. `whenGameLoaded()` still resolves on the game
load, so capture mode can wait for it.

`starting.html` follows the offline page: the slab, the pixel heading, no
network. States by query string: `starting` ("Starting your world"), with
the version line; `preparing` ("Getting the world ready for the first time");
`failed`, with the reason, the last twenty log lines in the recessed well, and
a Retry button. Retry navigates to `starting.html?retry`, which the
navigation guard recognises the way it recognises the offline page's return,
and main answers with `retry()`. The guard's rule stays: the page main asked
for, or the kit's own pages returning to it, nothing else.

Title and tab: "Single player", no world or latency readout; the strip shows
"Single player · rev 274 · running" or the state.

### Single player tool

Rail tool `singleplayer`, panel content in `src/renderer/tools/SinglePlayer.tsx`:

- Status line: Running on port N / Starting / Getting ready / Stopped /
  Failed: reason. Engine and content commits and the built date beneath it.
- **Cheats** toggle. Off by default. Flipping it while the world runs shows a
  dialog first: "Turning cheats on restarts your world and logs you out.
  Restart / Cancel". On Restart the service stops, rewrites world.json, and
  starts; every single-player window shows the starting page and then reloads
  the game. With the world stopped it just persists.
- **Open saves folder**: `shell.openPath` on `data/players/main`.
- **Show log**: `shell.openPath` on `world.log`.
- The last twenty log lines, read-only, when failed.

What cheats means, in the panel's own words: "Developer commands such as
::tele and ::give. Off, the world plays as the servers do."

### IPC and persistence

`ShellState` gains `singlePlayer: SinglePlayerView | null`, non-null only for
single-player windows; main pushes it on every service change, the way chat
is pushed. New calls, guarded by the sender's window like the others:
`singlePlayer.setCheats(on)`, `singlePlayer.retry()`,
`singlePlayer.openSaves()`, `singlePlayer.showLog()`.

`state.json` gains `singlePlayer: { cheats: boolean }`, default off, through
AppState.

### Engine patches

Three small, backwards-compatible changes on the fleet's engine branch,
merged there, pushed, and then pinned by `engine.lock.json`. The fleet is
unaffected: every default is today's behaviour.

1. **Bind hosts.** `web.host` and `node.host` in `WorldConfig`, defaults
   `0.0.0.0`, env `WEB_HOST` and `NODE_HOST` in the legacy migration. Used by
   `fastify.listen` in `web.ts` and `tcp.listen` in `TcpServer.ts`. The
   management server already binds loopback.
2. **Local staff level.** `node.localStaffLevel: number | null`, default
   null, env `NODE_LOCAL_STAFF_LEVEL`. In `LoginThread`'s local branch (login
   server off) the level becomes `localStaffLevel ?? (production ? 0 : 4)`,
   which is exactly the current expression when null.
3. **Shutdown route.** `POST /shutdown` on the management server: replies 202
   and runs the same path as SIGTERM (`World.rebootTimer(0)` behind the
   `exiting` guard, hoisted from `app.ts` into a shared function). Loopback
   only, like every management route.

Each patch gets a test in the engine's `test/` (config parsing for 1 and 2,
route for 3).

### Error handling

| Situation | Behaviour |
| --- | --- |
| `resources` missing (dev without `npm run stage:engine`) | `failed`, reason "Engine not staged: run npm run stage:engine". |
| Copy fails (disk full, permissions) | `failed` with the error; nothing renamed into place, so the previous assets remain usable. |
| No free port, spawn error | `failed` with the error. |
| Process exits before ready, or 60 s pass | `failed`, log tail attached. |
| Process exits while ready | `failed`, every single-player window shows Retry. |
| Shutdown request unanswered for 10 s | `kill()`, then `stopped`. |
| Quit during `preparing` or `starting` | `stop()` kills the process if any and abandons the staging directory, which the next `preparing` removes. |
| Two single-player windows | One world, both windows; the second `acquire` resolves immediately when ready. |

### Testing

- `service.test.ts`: the state machine over fakes: first acquire prepares,
  starts and resolves on 200; a stale stamp prepares, a fresh one skips it;
  release to zero stops via the shutdown request; the kill after the ten-second
  deadline; failure on early exit and on the readiness deadline; retry from
  failed; `setCheats` with the world stopped only persists, with it running
  stops and starts and the new world.json carries the level; `stop` during
  starting.
- `catalog.test.ts`: v2 to v3 adds `kind` and the built-in; v3 with the
  built-in already present is untouched; a v3 file with `local` gets the
  built-in inserted before it; v1 goes through both.
- `guard.test.ts`: the starting page's retry is allowed, its other navigation
  is not.
- `worldConfig.test.ts` in the kit: the template plus per-start values
  produces the expected document.
- Engine tests for the three patches.
- Capture mode opens the single-player window when `resources` exists, waits
  for the game load, screenshots the game and the panel, and stops the world
  on exit. Without staged resources it skips the entry and says so.
- Manual, in the release checklist: fresh profile on each platform, new name,
  log out, save file present; cheats on, restart, `::tele` works; cheats off,
  restart, it does not.

## Decisions

Settled on 2026-09-06:

1. **Unsigned for now.** Signing carries a verified legal name, in the Apple
   Developer ID or a Windows certificate, and the project is pseudonymous.
   macOS builds are ad-hoc signed so they launch; players use Open Anyway.
   Revisited when there is an entity to sign under; auto-update waits for it.
2. **Three platforms** from the first release: macOS universal DMG, Windows
   NSIS x64, Linux AppImage x64.
3. **Public repository under MIT**, releases on GitHub, drafted by CI and
   published by hand. The flip to public is the owner's, after a dry run.
4. **Universal macOS build.** One download beats asking a player which chip
   they have; the size cost is the Electron binary twice.
5. **Engine pinned to the fleet's commit** in `engine.lock.json`, moved by
   hand.
6. **Precompiled engine.** Per-file esbuild transform at stage time; tsx,
   TypeScript and esbuild dropped from the shipped tree. One
   platform-independent engine artifact, no native modules.
7. **Assets copied per version, not linked.** Saves stay put.
8. **The shipped RSA pair is reused** for the local world. Loopback only.
9. **Cheats off by default, per world, by staff level.** Production stays
   off always; the toggle flips `node.localStaffLevel` and restarts the world,
   asking first.
10. **One world for all single-player windows.**
11. **The `local` developer entry stays** in the catalog until the add form
    (milestone 3) lets a developer add it by hand.
12. **Graceful stop is an HTTP request**, not a signal, so Windows flushes
    saves too.

## Out of scope

High detail for single player (the entry has no worlds block to hang the
switch on). A character list in the panel. Save export and import. More than
one world or profile. The Java client and its TCP port, which is bound but
unused. Code signing and notarization. In-app update download or install.
Serving the single-player world to other machines.

## Sequencing

Two plans, in order:

1. **Packaging** (`docs/superpowers/plans/2026-09-06-packaging.md`): pin and
   stage script, electron-builder, icon, workflows, LICENSE and README,
   update check, RELEASE.md. Done when a dispatch run yields three artifacts
   and the DMG launches on this Mac through Open Anyway.
2. **Single player** (`docs/superpowers/plans/2026-09-06-single-player.md`):
   engine patches and re-pin, catalog v3, service, window and starting page,
   tool, capture. Done when a fresh profile on the packaged build can open
   Single player, log in as a new name, and find the save.

The packaging plan is worth shipping on its own as the kit's first public
release; single player follows as the second.
