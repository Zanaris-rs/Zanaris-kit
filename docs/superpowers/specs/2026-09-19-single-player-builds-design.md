# Single-player builds: built by CI, pinned in the kit, picked by the player

**Date:** 2026-09-19
**Status:** design approved; not yet implemented

## Why

Single player runs whatever engine the kit was packaged with: one pin in
`engine.lock.json`, staged by `scripts/stage-engine.mjs` into `engine-dist/`,
shipped as `<resources>/engine`. The owner asked for a way to build a server
from upstream Lost City, and from any 04-like server of the same shape, and to
pick the one single player runs.

## Findings that shaped the design

Checked on 2026-09-19 against the public repositories. Items marked
*unverified* were read, not run.

- **The branches are revisions.** Engine-TS and Content each carry branches
  `225`, `244`, `245.2`, `254`, `274`, `289` and `377-wip`, and the default is
  `274`. Lost City's own launcher (`LostCityRS/Server`, `start.js`) lists them,
  with 289 and 377 marked developers only. Neither repository has tags,
  releases or Actions artifacts. `data/pack` is gitignored, so nobody publishes
  a packed cache.
- **Only 274 and 289 build the way the kit builds.** Both have Node
  (`engines: >=24`), `package-lock.json`, `data/config/world.json`, fastify and
  `node:sqlite`. 225 to 254 differ:
  - They run on Bun (`Bun.serve`, `bun:sqlite`) and have only a `bun.lock`, so
    `npm ci` fails.
  - They configure through `.env`.
  - 244 and 245.2 compile their scripts with a Java 17 jar downloaded at build
    time.

  377-wip has no `/rs2.cgi` route and no `public/`, so it cannot load in the kit.
- **The kit's patch is what makes a build safe to run.** Without it, the engine
  binds web, game and management ports on `0.0.0.0`. It also gives every local
  login staff level 4, and has no way to stop cleanly on Windows. Sharing's
  invariants in CLAUDE.md rest on it.
  - Of the five files the patch touches, four are byte-identical between the 274
    and 289 heads. The fifth, `WorldConfig.ts`, differs only in its default
    revision, which lies between the patch's hunks. It should apply to 289
    (*unverified*).
  - It cannot apply to 225 to 254: `WorldConfig.ts` does not exist there, and
    the web server is different code.
- **Upstream changes shape often.** Within 2026, the 274 branch replaced `.env`
  with `world.json` (Apr 8), moved from Bun back to Node (May 23) and moved to
  fastify (Aug 16). A pin that moves can break the patch at any time. That is
  why the stage script's boot check — loopback-only binds, `POST /shutdown`, a
  non-zero static NPC count — is what admits a build, not the fact that it
  compiled.
- **Other 04-like servers do not fit a web view.**
  - Forks of Engine-TS (PlagueCityRS, RareCityRS, rs-sdk) keep Lost City's
    shape, or are Bun-era.
  - rs-majula is a Rust rewrite that needs Postgres and an Elixir sidecar.
  - The Java and Kotlin servers (2006Scape, apollo, runejs) serve no browser
    client.

  "Any 04-like server" in practice means any fork shaped like Lost City 274.
- **Size.** A staged 274 build is 193 MB on disk (147 MB of it `node_modules`)
  and 49.8 MB as a gzipped tarball. On GitHub's Ubuntu runners, Content's own CI
  runs `npm ci` and `npm run build` in about 40 s.

## The owner's calls

1. **CI builds; the kit downloads.** A workflow in the kit repository runs the
   stage script on a recipe and publishes the result. Players never need npm,
   Bun or Java.
2. **Download-only.** The kit ships no engine. The first time Single player
   opens, it asks to download a build, as sharing asks before downloading
   cloudflared.
3. **Characters live per revision.** Each revision has its own world folder, so
   a newer 274 build sees the 274 characters and 289 starts empty. A character
   crosses revisions only through an explicit Copy.
4. **Pins move by hand.** Each recipe pins exact commits, and a pull request
   moves a pin. Nothing follows a branch head.
5. **The build list is pinned in the kit.** Each kit release carries every
   build's URL, size and sha-256, as it pins cloudflared. The kit runs nothing
   whose digest it did not ship with.
6. **274 and 289 first.** 289 is labelled as upstream labels it. Bun-era
   revisions are a later step of their own: each needs its own patch, and the
   kit would have to pin a Bun runtime to run them.

Settled while presenting the design:

7. Builds are published as **prereleases of the kit repository**.
   `releases/latest`, which the update check reads, skips prereleases.
8. **Only a build on the kit's list runs.** When a kit update moves a pin, the
   older build still on disk shows *Update needed* and does not start. A newer
   kit may rely on something the older build lacks, a patch key for instance.
9. **Copy to… another revision** is part of the first version.

## Rejected

- **Building on the player's machine.** It would need npm and a tar reader in
  the kit, plus a patch applier (most players have no git). Each build takes
  minutes and ~1 GB, and npm and tsx running under Electron's Node are unproven.
  A later "build from a repository" could feed the same store.
- **Following branch heads on a schedule.** New upstream fixes would arrive
  without anyone looking, but so would a head that breaks the patch in a way
  the boot check does not catch.
- **Fetching the build list at run time.** New builds would reach existing
  installs without a kit release, but the digest would then come from the same
  place as the file, so it would prove nothing.
- **Keeping one build inside the app.** It works offline on first launch, but
  it costs ~175 MB in every installer, twice over in the universal DMG.
- **One saves folder for every build.** An older engine refuses a newer save,
  and a different revision's content can misread the item and varp ids inside a
  save without saying so.

## Design

```
engines/lostcity-274.json ─┐
engines/lostcity-289.json ─┤  engines.yml (dispatch)       GitHub prerelease
patches/engine/*.patch ────┴─▶ stage-engine.mjs <id> ─────▶ engine-<id>-….tar.gz
                               boot check                         │
                                                       pin-engine.mjs writes
                                                       size + sha256 into the recipe
                                                                  │
kit release bundles engines/*.json ◀──────────────────────────────┘
      │
      ▼
<userData>/singleplayer/builds/<id>/  ◀── download, check, unpack, check VERSION.json, rename
<userData>/singleplayer/worlds/<rev>/ ◀── assets copied per build; saves, db.sqlite, world.json, world.log
```

### Recipes

`engine.lock.json` becomes one file per build line under `engines/`. The
commits below are today's pin; the artifact's values are illustrative until
the first build is published:

```json
{
    "id": "lostcity-274",
    "name": "Lost City 274",
    "revision": 274,
    "note": null,
    "engine": { "repo": "https://github.com/LostCityRS/Engine-TS.git", "commit": "1d25566cb53e7af1b1cb18ade8af996316c19614" },
    "content": { "repo": "https://github.com/LostCityRS/Content.git", "commit": "32019eb334bda7ad21875484c6be54911563807f" },
    "patches": "patches/engine",
    "artifact": {
        "tag": "engine-lostcity-274-1d25566c-32019eb3-<patch8>",
        "file": "engine-lostcity-274.tar.gz",
        "size": 52224000,
        "sha256": "…"
    }
}
```

- `id` is also the folder name the build installs to.
- `revision` is what `world.json`'s `engine.revision` gets, and it names the
  world folder.
- `note` is shown under the name. For 289 it is "Developers only upstream".
- `artifact` is `null` while a pin is moving. The kit lists such a line as
  unavailable and never downloads it.
- The tag names exactly what was built:
  - the id
  - the first eight characters of each commit
  - `<patch8>`, the first eight hex characters of the sha-256 of the patch
    stamp, because the same commits with a different patch are a different
    engine
- A test over the real recipe files fails when a tag does not match its
  recipe. So a pin moved, or a patch edited, without a new build cannot reach
  `main`.

The recipe reader is pure and lives in `src/shared/engines.ts`. It reads the
file field by field, as `readSinglePlayerSettings` does, and computes the tag.
The scripts import it the way `stage-lib.test.mjs` already imports
`src/shared/commands.ts`, through Node's type stripping.

### Staging

`npm run stage:engine -- <id>` stages `engines/<id>.json`. With no id it
stages `lostcity-274`.

- The steps are the ones the 2026-09-06 spec describes: fetch both commits,
  apply the patches, pack, assert the pack, transpile, prune `node_modules`,
  write VERSION.json and COMMANDS.json, boot check.
- VERSION.json gains `id` and `name`.
- A last step writes `engine-dist.tar.gz` with the system `tar`, from inside
  `engine-dist/`, so the archive has no top-level folder.

`npm run dist` no longer stages or checks an engine. `release.yml` loses its
`engine` job and the packaged-engine checks. `electron-builder.yml` loses both
`extraResources` entries.

### Publishing

`.github/workflows/engines.yml`:

- **On pull requests** that touch `engines/**`, `patches/**` or
  `scripts/stage-*`, it stages and boot-checks every recipe and publishes
  nothing. A pin or a patch that does not work fails here, before review ends.
- **On a manual dispatch** with a recipe id, it stages that recipe and creates
  a prerelease under the recipe's tag, holding the archive.
  - An existing tag fails the run, so a published build is never replaced.
  - The job summary prints the archive's size and sha-256.
  - It uses the workflow's `GITHUB_TOKEN` with `contents: write`.

A pin moves in one pull request:
1. Change the commits in the recipe.
2. Dispatch the workflow from the branch.
3. Run `npm run pin:engine -- <id>`. It reads the asset's size and GitHub's
   digest for that tag from the API and writes them into `artifact`.
4. Merge.

Anything that talks to GitHub runs under `GH_TOKEN=$(gh auth token -u
Zanaris274)`, as CLAUDE.md requires.

### The kit's list

The kit bundles `engines/*.json` at build time and reads each through the
recipe reader. It knows no build that is not on that list. The one exception
is a developer's own stage: in an unpackaged run, if `engine-dist/VERSION.json`
exists, the list gains "Local build (engine-dist)". It is unpinned and never
offered in a packaged app. Capture mode uses it when present.

The single-player catalog entry's revision is the revision of the selected
build. `refreshSinglePlayer` already re-adopts the revision on every launch.
It now takes it from the selection rather than the build-time constant, and
main refreshes it on every switch. `__ENGINE_REVISION__`, `engineRevision()`
and `LAST_KNOWN_REVISION` are removed.

### The store

```
<userData>/singleplayer/
    builds/<id>/            an installed build: VERSION.json, COMMANDS.json, src/, node_modules/, data/, public/, view/, content/
    builds/.incoming/       where a download lands and unpacks; cleared at launch and after every attempt
    worlds/<revision>/      the engine's working directory for that revision
        engine.stamp  world.log  db.sqlite
        data/config/world.json  data/config/*.pem
        data/pack/  data/raw/  public/  view/  content/      copied from the build that last ran here
        data/players/main/<name>.sav                         the characters; never touched by preparing
```

`src/main/singleplayer/buildStore.ts` is pure over an injected fs, download
and extract.

- **List.** One state per line: `absent`, `downloading` (with progress),
  `installed`, or `outdated`. A line is outdated when its folder's VERSION.json
  names other commits or patches than the pin.
- **Install:**
  1. Download into `.incoming`, refusing the wrong size.
  2. Check the sha-256.
  3. Unpack.
  4. Check that the unpacked VERSION.json names the pinned id, commits and
     patches.
  5. Remove the old `builds/<id>` and rename the new one into place.
  6. Clear `.incoming`.

  Any failure clears `.incoming` and leaves `builds/<id>` as it was.
- **Remove.** A plain recursive delete. A build is a download, not the player's
  data, and can be fetched again. Remove is refused for the build the world is
  running.

The download itself is cloudflared's: its streamed download, idle timeout,
size cap, sha-256 and system-`tar` extract move from `share/cloudflared.ts`
into `src/main/download.ts`. Sharing and builds then share one implementation,
and cloudflared's tests keep covering it.

The old `<userData>/singleplayer/data/players/main` is not migrated. Nobody
has installed the kit yet, and CLAUDE.md licenses exactly this until the first
release.

### The world follows the selection

`state.json` gains `singlePlayer.build`, read field by field. It defaults to
`lostcity-274`, and an id the list does not know reads as the default.

`SinglePlayerService` stops taking a fixed `resources` and `home`. It gets
`select(build)`:
- The build is its folder, its revision's world folder and its VERSION.json.
- The saves folder and its watch follow the world folder.
- Preparing, the copy, `worldJson`, spawning and stopping are unchanged. They
  read the selected build instead of the one fixed path.
- `engine.stamp` compares VERSION.json as before. So a switch between two
  builds of one revision re-copies that revision's assets, and leaves its
  saves alone.

`SinglePlayerStatus` gains two statuses. `worldRunning` is false for both.
- **`missing`**: the selected build is not installed, is outdated, or its line
  has no artifact.
- **`downloading`**: it carries progress.

`acquire()` on a missing build waits in `missing`. It never downloads on its
own. A download starts only from the Download button on the starting page or
in the panel. Once installed, a world that windows are waiting for starts.

**A switch while the world runs** is a confirmed restart, worded like the
settings restarts: "Switching to Lost City 289 restarts your world and logs
everyone out." It asks again about who is logged in, as character changes do.

**A share survives it.** The relay already follows the world through a
restart, and the link serves whichever build is up.

Main drops its cached command list on every switch, so the Commands section
reads the new build's COMMANDS.json.

### Starting page

`static/starting.html` gains two states:
- `missing`: "Your world isn't downloaded yet", the build's name and size, and
  a **Download** button.
- `downloading`: the percentage.

Download navigates to `starting.html?download=1`. `guard.ts` answers it as
`'download'`, as it answers `?retry=1` with `'retry'`, and main starts the
install.

### The Builds section

A fifth section in the Single player tool, `renderer/tools/singleplayer/Builds.tsx`.
- **One row per line:**
  - the name, `rev N` and the note
  - the engine and content commits
  - the size
  - its state: *In use*, *Installed*, *Not downloaded*, *Downloading N %* or
    *Update needed*
- **Actions:** **Use**, **Download** and **Remove**. Use on a build that is not
  downloaded downloads it, then switches.
- **Layout:** it follows the other sections — scroll body, bottom actions, dim
  note. Every state it shows comes from main in `SinglePlayerView.builds`.

### Copy to another revision

In the Characters section, **Copy to…** lists the other revisions on the build
list.
- The target is built by `Characters.path` in that revision's saves folder.
  It is refused when the name is taken there.
- It asks first, and says the other game may not read the save: a save holds
  item and varp ids that belong to the content that wrote it.
- Nothing in the source revision changes.

### IPC

- New calls on `ZanarisApi.singlePlayer`: `useBuild(id)`, `downloadBuild(id)`,
  `removeBuild(id)` and `copyCharacter(name, revision)`. Each is gated by
  `singlePlayerWindow`, like the rest.
- `SinglePlayerView` gains `build` (the selected line) and `builds` (every
  line and its state).

## Error handling

| Situation | Behaviour |
| --- | --- |
| Offline, HTTP error, a stall, the wrong size, a failed digest | The download fails with the reason and Try again. Nothing reaches `builds/`. |
| The unpacked VERSION.json does not name the pin | Refused as a failed check; `.incoming` cleared. |
| Disk full while unpacking | `.incoming` cleared; the reason shown. |
| The selected build removed, outdated, or its line without an artifact | `missing` or *Update needed*; never a spawn of something absent. |
| Quit during a download | The download is aborted; the next launch clears `.incoming`. |
| Remove on the build in use while the world runs | Refused. |
| A patch that no longer fits, or a build that fails its boot check | The `engines.yml` run fails; nothing is published. |

## What stays true

- Every build the kit can run was staged by the stage script, with the kit's
  patch applied, and passed its boot check. So the sharing invariants —
  loopback binds, `node.debug` false, the management port never relayed — hold
  for every build on the list, not only one.
- The kit runs nothing whose digest it did not ship with.
- Saves are never touched by an install, a remove, a switch or preparing.

## To check before 289 is pinned

Both are about 289's engine, not the kit, and neither is known yet:

- **The save format.** Is 289's `SAV_VERSION` still 7, and is the save header
  the one `save.ts` reads? If not, reading a character's levels becomes
  per-revision.
- **The cheat commands.** Does 289's `ClientCheatHandler` still match the
  hand-written `ENGINE_COMMANDS`? If not, that table becomes per-build data,
  like COMMANDS.json.

## Out of scope

- Bun-era revisions (225 to 254). Each needs its own patch, and the kit would
  need a pinned Bun runtime.
- Building on the player's machine, or from a repository the player types in.
- Revisions without a web client (377).
- Following branch heads.
- Migrating the old single-player saves folder.

## Testing

- **Recipes:** the reader over good and malformed files, and the tag check
  over the real `engines/*.json`.
- **Download:** cloudflared's existing tests, now over `download.ts`.
- **Store:** install, the checks at each step, rename, the leftover
  `.incoming`, outdated detection and remove, over an injected fs.
- **Service:**
  - select while stopped
  - select while running (stop, re-point, start)
  - missing and downloading
  - the saves watch moving
  - `acquire` waiting in `missing`
- **State, catalog and guard:** the `build` field and its fallback, the
  revision re-adopted from the selection, and `?download=1`.
- **Copy:** a character copied across revisions, and refused when the name is
  taken.
- **End to end:** the `engines.yml` pull-request run, for every recipe.
- **Manually:** see the verification in the plan.
