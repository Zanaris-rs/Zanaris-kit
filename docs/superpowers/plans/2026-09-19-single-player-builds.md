# Single-player builds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Single player runs a build the player picks and downloads. Builds are
staged by CI from per-line recipes and pinned in the kit by size and sha-256.
The app itself ships no engine.

**Architecture:**
- **Recipes** are `engines/<id>.json`, read by a pure module, `src/shared/engines.ts`.
- **Staging:** the stage script takes a recipe and writes an archive.
- **CI:** a workflow checks every recipe on pull requests and publishes one on
  dispatch.
- **Kit:**
  - A pure `BuildStore` downloads, checks, unpacks and lists builds.
  - `SinglePlayerService` follows the selected line: its installed build, its
    revision's world folder and that folder's characters.
  - Main wires the store, the service, the catalog and the IPC together.

**Tech Stack:** TypeScript on Node 24 type stripping (`node --test`),
Electron 44 (`net.fetch`, `utilityProcess`), React 19, electron-vite, and GitHub
Actions with `gh`.

**Spec:** `docs/superpowers/specs/2026-09-19-single-player-builds-design.md`

## Global Constraints

- Anything decidable lives in a pure module reached by `node --test`.
  `index.ts`, `serverWindow.ts`, `electron.ts` and the renderer hold wiring only
  (CLAUDE.md, "Where logic is allowed to live").
- A comment that describes behaviour the code does not have is a defect.
  Re-read the comments around every changed behaviour.
- The kit runs nothing whose sha-256 it did not ship with. The only exception
  is the developer's own `engine-dist/` in an unpackaged run.
- Saves are never touched by an install, a remove, a switch or preparing.
- Anything that talks to GitHub runs under `GH_TOKEN=$(gh auth token -u Zanaris274)`.
- `node.debug` stays false and every bind stays loopback. `worldJson` does not
  change.
- Commits end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Findings checked on 2026-09-19 (they settle the spec's "To check before 289 is pinned")

- `patches/engine/0001-…patch` applies to Engine-TS 289 at
  `0c7cf6555d0cf92d2348999b2fd27c6ceff5ffbf`. Checked with `git apply --check`.
- 289's `PlayerLoading.ts` (`SAV_VERSION` 7) and `ClientCheatHandler.ts` are
  byte-identical to 274's. `Player.ts` differs by one comment. So `save.ts` and
  `ENGINE_COMMANDS` hold for 289 unchanged.
- The heads are:
  - Engine 289 `0c7cf6555d0cf92d2348999b2fd27c6ceff5ffbf`
  - Content 289 `5da837c55ae1c978d2d2b17af20710b7c747906a`
  - Engine 274 `1d25566cb53e7af1b1cb18ade8af996316c19614`
  - Content 274 `32019eb334bda7ad21875484c6be54911563807f`
- `Zanaris-rs/Zanaris-kit` is public, so its release assets download without a
  token.
- `workflow_dispatch` only works for a workflow that exists on the default
  branch. So the first two builds can only be published after this PR merges:
  - This PR ships both recipes with `"artifact": null`.
  - Pinning them is the follow-up the workflow exists for.

---

### Task 1: Recipes

**Files:**
- Create: `src/shared/engines.ts`, `engines/lostcity-274.json`,
  `engines/lostcity-289.json`, `scripts/engines.test.mjs`
- Modify: `scripts/stage-lib.mjs` (add `patchHash`)
- Delete: `engine.lock.json`

**Interfaces — Produces:**
```ts
export const BUILDS_REPO = 'Zanaris-rs/Zanaris-kit';
export const DEFAULT_BUILD = 'lostcity-274';
export interface EngineSource { repo: string; commit: string }
export interface Artifact { tag: string; file: string; size: number; sha256: string }
export interface Recipe { id: string; name: string; revision: number; note: string | null; engine: EngineSource; content: EngineSource; patches: string; artifact: Artifact | null }
export function readRecipe(x: unknown): Recipe | null;
export function recipeTag(recipe: Pick<Recipe, 'id' | 'engine' | 'content'>, patchHash: string): string; // engine-<id>-<e8>-<c8>-<patchHash>
export function artifactFile(id: string): string;   // engine-<id>.tar.gz
export function artifactUrl(artifact: Artifact): string; // https://github.com/Zanaris-rs/Zanaris-kit/releases/download/<tag>/<file>
```
`stage-lib.mjs`: `patchHash(patches)` returns the first 8 hex characters of
`sha256(patchStamp(patches))`.

- [ ] Write `scripts/engines.test.mjs`:
  - `readRecipe` accepts a full recipe and rejects each broken field:
    - an id that is not `[a-z0-9][a-z0-9-]*`
    - a commit that is not 40 hex characters
    - a revision that is not a positive integer
    - a note that is not a string or null
    - an artifact with a tag not starting `engine-<id>-`, a non-positive size,
      or a sha256 that is not 64 hex characters
  - `recipeTag` and `artifactUrl` produce the documented shapes.
  - For every real `engines/*.json`:
    - it reads,
    - its `id` equals its file name,
    - its `patches` directory exists,
    - its artifact is null or has `tag === recipeTag(recipe, patchHash(readPatches(recipe.patches)))`
      and `file === artifactFile(id)`.
  - `DEFAULT_BUILD` is one of the recipes.
- [ ] Run `node --test scripts/engines.test.mjs`. It fails (module missing).
- [ ] Write `src/shared/engines.ts`. Add `patchHash`. Write the two recipes with
  the commits above, `"patches": "patches/engine"`, `"artifact": null`, and the
  note `"Developers only upstream"` on 289. Delete `engine.lock.json`.
- [ ] The test passes. Commit.

### Task 2: Stage by recipe, and the archive

**Files:** `scripts/stage-engine.mjs`, `scripts/stage-lib.mjs`,
`scripts/stage-lib.test.mjs`, `scripts/dist.mjs`, `.gitignore`, `package.json`

- The id comes from `process.argv[2] ?? DEFAULT_BUILD`. Read the recipe
  `engines/<id>.json` with `readRecipe`, and refuse an unknown or unreadable one.
- Replace every use of `lock` with the recipe.
- VERSION.json gains `id`, `name` and `tag` (the recipe's computed tag).
- Remove `node_modules/.bin` whole: the engine runs no bins, and symlinks do
  not survive a Windows `tar`. Then assert that there are no symlinks under
  `engine-dist` (`findSymlinks` in stage-lib, tested over a fixture with one link).
- Final step: run `tar -czf engine-<id>.tar.gz -C engine-dist .` at the repo root
  and log its size and sha-256.
- `.gitignore` gains `engine-*.tar.gz`.
- `dist.mjs` no longer stages or checks an engine. It runs `npm run build` and
  `electron-builder --publish never`, and nothing else.
- [ ] Add the `findSymlinks` test, which fails. Implement it; it passes.
- [ ] Make the script changes. Run `npm run stage:engine -- lostcity-289` and
  then `npm run stage:engine` (274). Both pass the boot check, and both
  archives appear.
- [ ] Commit.

### Task 3: The engines workflow and `pin:engine`

**Files:** `.github/workflows/engines.yml`, `scripts/pin-engine.mjs`,
`package.json` (`pin:engine`), `.github/workflows/release.yml`,
`electron-builder.yml`

- `engines.yml`:
  - A `recipes` job lists `engines/*.json` ids as JSON.
  - On `pull_request` (paths `engines/**`, `patches/**`, `scripts/stage-*`,
    `src/shared/engines.ts`, the workflow itself), a `check` matrix runs
    `node scripts/stage-engine.mjs <id>`, with permissions `contents: read`.
  - On `workflow_dispatch` (input `recipe`), a `publish` job does the following,
    with permissions `contents: write` and the input passed through `env`,
    never inlined into `run`:
    1. Checks that `engines/$RECIPE.json` exists.
    2. Stages the recipe.
    3. Reads the tag from `engine-dist/VERSION.json`.
    4. Refuses when `gh release view "$tag"` succeeds.
    5. Runs `gh release create "$tag" "engine-$RECIPE.tar.gz" --prerelease --target "$GITHUB_SHA"`,
       with notes naming both commits.
    6. Writes the size and sha-256 to `$GITHUB_STEP_SUMMARY`.
- `pin-engine.mjs <id>`:
  1. Computes the tag.
  2. Fetches `GET https://api.github.com/repos/Zanaris-rs/Zanaris-kit/releases/tags/<tag>`,
     with `Authorization: Bearer $GH_TOKEN` when set.
  3. Finds the asset named `artifactFile(id)`.
  4. Takes its `size`, and its `digest` without the `sha256:` prefix. It
     refuses when the digest is missing.
  5. Writes `artifact` into the recipe (JSON, 4 spaces, trailing newline).
- `release.yml` loses the `engine` job, the `needs`, the download and the
  packaged-engine check.
- `electron-builder.yml` loses both `extraResources` entries, and its header
  comment says the app ships no engine.
- [ ] Write the files. Run `npm test` and `npm run typecheck`. Commit.

### Task 4: One download for share and builds

**Files:**
- Create: `src/main/download.ts`
- Modify: `src/main/share/cloudflared.ts`, `src/main/share/cloudflared.test.ts`
  (the `extractTgz` import)

**Produces:**
```ts
export type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<Response>;
export interface DownloadOptions { url: string; file: string; size: number; to: string; fetch: FetchLike; idleMs?: number; onProgress?: (fraction: number) => void }
export function downloadFile(opts: DownloadOptions): Promise<void>;          // cloudflared's download(), unchanged in behaviour
export function downloadChecked(opts: DownloadOptions & { sha256: string }): Promise<void>; // plus the digest; removes `to` on any failure
export function sha256File(path: string): Promise<string>;
export function extractTgz(archive: string, into: string): Promise<void>;
```
- [ ] Add `src/main/download.test.ts`. `downloadChecked` over a loopback server
  refuses a wrong digest and leaves no file, and accepts the right one.
- [ ] Move the code. `cloudflared.ts` imports it. The existing cloudflared tests
  and the new test pass. Commit.

### Task 5: The build store

**Files:**
- Create: `src/main/singleplayer/buildStore.ts`,
  `src/main/singleplayer/buildStore.test.ts`
- Modify: `src/shared/singleplayer.ts` (types), `src/main/singleplayer/config.ts`
  (`parseVersion` reads `id`, `name` and `tag`, each null when absent)

**Produces:**
```ts
// shared/singleplayer.ts
export type BuildState = 'absent' | 'downloading' | 'installed' | 'outdated' | 'unavailable';
export interface BuildLine { id: string; name: string; revision: number; note: string | null; engine: string; content: string; size: number | null; state: BuildState; progress: number | null; error: string | null; local: boolean }
// SinglePlayerVersion gains: id: string | null; name: string | null; tag: string | null
// buildStore.ts
export const LOCAL_BUILD = 'local';
export interface InstalledBuild { id: string; resources: string; revision: number; tag: string | null }
export interface BuildStoreDeps {
    dir: string; recipes: readonly Recipe[]; local: string | null; join(...parts: string[]): string;
    fs: { exists(path: string): boolean; readText(path: string): string; mkdir(path: string): void; rm(path: string): void; rename(from: string, to: string): void };
    download(artifact: Artifact, to: string, onProgress: (fraction: number) => void): Promise<void>;
    extract(archive: string, into: string): Promise<void>;
    log(msg: string): void;
}
export class BuildStore {
    constructor(deps: BuildStoreDeps);        // clears <dir>/.incoming; reads each line's installed VERSION.json once
    lines(): BuildLine[];                      // recipes in order, then the local build when there is one
    installed(id: string): InstalledBuild | null; // only a current install (or the local build)
    install(id: string): Promise<void>;        // one at a time per id; a second call joins the first
    remove(id: string): void;                  // throws for the local build or one downloading
    subscribe(fn: () => void): () => void;
}
```
The state of a line, first match wins:
1. The local build is `installed`.
2. A line in flight is `downloading`.
3. A line with no artifact is `unavailable`.
4. A line whose VERSION.json has a tag equal to the artifact's is `installed`.
5. A line with any other VERSION.json is `outdated`.
6. Otherwise the line is `absent`.

`install`:
1. `rm` and `mkdir` `.incoming/<id>`.
2. Download to `.incoming/<id>/<file>`.
3. Extract to `.incoming/<id>/build`.
4. Check the unpacked VERSION.json's `id`, `tag`, commits and revision against
   the recipe.
5. `rm <dir>/<id>` and rename the unpacked build into place.
6. `rm .incoming/<id>` in `finally`.

A failure sets the line's `error` to a sentence for the player and rethrows.
A new install clears it. Progress notifies at most once per whole percent.

- [ ] Tests, over an in-memory fs:
  - the six states
  - a successful install moves into place and clears `.incoming`
  - a download failure leaves `builds/<id>` untouched, records the error and
    clears `.incoming`
  - a VERSION.json mismatch is refused
  - a second `install` joins the first (one download)
  - `remove` refuses the local build and one downloading, and deletes otherwise
  - the constructor clears a leftover `.incoming`
  - progress notifies at whole percents
- [ ] Implement. The tests pass. Commit.

### Task 6: The service follows the selected line

**Files:** `src/main/singleplayer/service.ts`, `service.test.ts`,
`src/shared/singleplayer.ts`, `src/main/singleplayer/settings.ts`,
`src/main/singleplayer/characters.ts` (`copyInto`, `copyToQuestion`),
`characters.test.ts`

**Produces:**
```ts
export type SinglePlayerStatus = 'stopped' | 'missing' | 'downloading' | 'preparing' | 'starting' | 'ready' | 'stopping' | 'failed';
// worldRunning is false for missing and downloading too.
// SinglePlayerView gains: selected: string; revision: number; builds: BuildLine[]
export interface BuildsHandle { lines(): BuildLine[]; installed(id: string): InstalledBuild | null; install(id: string): Promise<void>; remove(id: string): void; subscribe(fn: () => void): () => void }
// SinglePlayerDeps loses resources and home, and gains:
//   worlds: string   // <userData>/singleplayer/worlds
//   builds: BuildsHandle
//   selection: { get(): string | null; set(id: string): void }
// SinglePlayerService gains:
get home(): string;          // <worlds>/<revision of the selected line>
get savesDir(): string;      // <home>/data/players/main
download(id?: string): Promise<void>;          // the selected line by default; failures stay on the line
useBuild(id: string): Promise<void>;           // downloads first when absent, then stops, re-points and starts again for waiting windows
removeBuild(id: string): string | null;        // null when removed, else why not
copyCharacterTo(name: string, revision: number, confirm: Confirm): Promise<CharacterOutcome>;
otherRevisions(): number[];
// settings.ts
export function switchConfirmation(to: BuildLine, fromRevision: number): Confirmation;
export function removeBuildConfirmation(line: BuildLine): Confirmation;
```
**Rules:**
- **Picking the line.** The selected line is `selection.get()` when it is on the
  list. Otherwise it is `DEFAULT_BUILD` when listed, otherwise the first line.
- **Starting with no installed build.** `start()` sets `downloading` when the
  line is in flight and `missing` otherwise, and rejects with a Failure. It
  never spawns.
- **When the store notifies:**
  - While `missing` or `downloading`, the status is re-derived.
  - Once the selected build is installed, the status becomes `stopped`, and
    `ensure()` runs when windows wait.
- **Reason.** `view().reason` is the line's `error` while `missing`.
- **Watching the saves folder.** The watch and the `Characters` instance follow
  `savesDir`. A switch moves the watch and reads the new folder.
- **Serialising.** `useBuild`, `download` and `removeBuild` run one at a time.
- [ ] Tests:
  - acquire with the build absent goes `missing`, spawns nothing and copies nothing
  - `download()` passes through `downloading`, and the world starts for the
    waiting window when the install lands
  - `useBuild` while ready stops, re-points `home` and the saves watch, and
    starts again
  - `useBuild` on an absent line downloads first while the old world keeps running
  - `useBuild` on a line whose download fails stays put
  - `removeBuild` is refused for the running build and allowed otherwise
  - `copyCharacterTo` writes into the other revision's folder, and is refused
    when the name is taken there or when the revision is the current one
  - world.json carries the selected line's revision
  - the existing tests migrate to the new deps: `builds` is a fake store with
    one installed line at `/res`, `worlds` is `/worlds`, and `home` becomes
    `/worlds/274`
- [ ] Implement. `npm test` passes. Commit.

### Task 7: State, catalog, guard

**Files:** `src/main/appState.ts` (+test), `src/main/catalog.ts` (+test),
`src/main/singleplayer/recipes.ts` (new), `src/main/globals.d.ts`,
`electron.vite.config.ts`, `src/main/guard.ts` (+test)

- **AppState.** `singlePlayerBuild(): string | null` and
  `setSinglePlayerBuild(id)`. The id is stored at `singlePlayer.build` and read
  with the recipe id pattern. Anything else reads as null.
- **Recipes in the bundle.** `recipes.ts` exports `bundledRecipes()`. It reads
  `__ENGINE_RECIPES__` (electron-vite `define` of every `engines/*.json`,
  sorted), falls back to reading `engines/` from disk under tests, and drops
  anything `readRecipe` refuses. It also exports
  `recipeRevision(id: string | null): number`, which falls back to
  `DEFAULT_BUILD`'s revision, then to 274.
- **Catalog.** `new Catalog(file, { singlePlayerRevision?: () => number })`.
  `refreshSinglePlayer` re-adopts that revision rather than the built-in's. The
  new public `followSinglePlayer(): boolean` re-runs it and saves when it
  changed. `engineRevision` and `__ENGINE_REVISION__` are removed, and the
  built-in entry takes `recipeRevision(DEFAULT_BUILD)`.
- **Guard.** `NavigationDecision` gains `'download'`, for
  `starting.html?download=1` from a `file:` page.
- [ ] Tests first for each, then implement. Commit.

### Task 8: Main, the starting page and the Builds section

**Files:** `src/main/singleplayer/electron.ts`, `src/main/index.ts`,
`src/main/serverWindow.ts`, `static/starting.html`, `src/shared/ipc.ts`,
`src/preload/index.ts`, `src/renderer/Shell.tsx`,
`src/renderer/tools/SinglePlayer.tsx`,
`src/renderer/tools/singleplayer/Builds.tsx` (new),
`Characters.tsx`, `Commands.tsx`

- **`electron.ts`:**
  - `buildStoreDeps()`: dir `<home>/builds`, `bundledRecipes()`, and `local`
    set to `engine-dist` only when `!app.isPackaged` and its VERSION.json
    exists.
  - The download is `downloadChecked` with `net.fetch`; the extract is
    `extractTgz`.
  - `electronDeps` takes `builds` and `selection`.
  - `readCommands(resources)` takes the directory to read.
- **`index.ts`:**
  - It builds the store, then the service.
  - The catalog gets the `singlePlayerRevision` option.
  - On every service change where the selected line or its revision changed,
    it calls `catalog.followSinglePlayer()` and `installAppMenu()`.
  - The commands cache is keyed by the installed build's `id:tag`.
  - New handlers:
    - `singlePlayerUseBuild` asks `switchConfirmation` when `worldRunning`.
    - `singlePlayerDownloadBuild`.
    - `singlePlayerRemoveBuild` asks `removeBuildConfirmation`, and returns the
      refusal.
    - `singlePlayerCopyCharacter`.
  - `openSaves` and `showLog` use `singlePlayer.savesDir` and `singlePlayer.home`.
  - Capture keeps single player only when its selected line is installed.
- **`serverWindow.ts`:**
  - `SinglePlayerHandle` gains `download()`.
  - A `'download'` decision calls it.
  - The status words gain `missing: 'not downloaded'` and
    `downloading: 'downloading'`.
  - `gameLabel` uses `view.revision`.
  - `showStarting` passes `build`, `size` (MB), `progress` (%), `available` and
    the line's `reason`.
  - `syncSinglePlayer` reloads the page while `downloading` only when the
    percent's tens digit changes.
- **`starting.html`:**
  - `missing` shows "Your world isn't downloaded yet", the build and size, any
    reason, and a Download button (to `starting.html?download=1`). With nothing
    available it shows a sentence and no button.
  - `downloading` shows the percent.
- **Renderer:**
  - `Builds.tsx` lists the lines with Use, Download and Remove.
  - `SinglePlayer.tsx` adds the section and the two status words, and shows the
    selected build's name.
  - `Characters.tsx` gets a "Copy to…" row action that prompts with the other
    revisions.
  - `Commands.tsx` is keyed by the installed build, so a switch re-reads its
    list, and its note loses `npm run stage:engine`.
  - `Shell.tsx` `revisionOf` prefers `singlePlayer.revision`.
- [ ] `npm run typecheck` and `npm test`. Then `npm run dev` with a staged
  `engine-dist`: the local build runs, and the Builds section lists 274 and 289
  as unavailable. Commit.

### Task 9: Docs

**Files:** `README.md`, `CLAUDE.md`, `RELEASE.md`, `patches/engine/README.md`,
the spec (status line, file names)

- **CLAUDE.md:**
  - "Single player's characters and commands" names `engines/` and the
    per-revision world folders.
  - "Sharing" says the invariants hold for every recipe, because every recipe
    carries the patch and passes the boot check.
  - The Commands table gains `npm run stage:engine -- <id>` and
    `npm run pin:engine -- <id>`.
- **RELEASE.md.** Step 0 becomes "every recipe's artifact is pinned".
  - A new section, "Moving a build", gives the steps: move the commits, run the
    PR check, merge, dispatch, run `pin:engine`, and open a PR.
  - The per-platform checks download the build rather than finding it in the
    bundle.
- **README.** The single-player paragraphs cover download-only, the Builds
  section and characters per revision.
- [ ] Commit.

### Task 10: PR

- [ ] `npm test`, `npm run typecheck` and `npm run build` are green.
- [ ] Push the branch and open the PR with `GH_TOKEN=$(gh auth token -u Zanaris274)`.
  Check the author with `gh pr view --json author`.
- [ ] The PR body says what merging leaves to do: dispatch `engines.yml` for each
  recipe, run `pin:engine`, and open a pin PR. It also says that until then a
  packaged kit's single player has nothing to download, so no release is tagged
  in between.
