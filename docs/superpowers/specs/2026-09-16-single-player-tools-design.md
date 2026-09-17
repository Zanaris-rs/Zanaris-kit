# Single player: characters, world settings, and a command reference

The owner's design of 2026-09-16, with the decisions taken while planning it.
The plan is `docs/superpowers/plans/2026-09-16-single-player-tools.md`.

## Decisions (2026-09-16)

These override the design text below wherever the two disagree. Struck
passages in the design are the ones they remove.

1. **No debug switch.** The owner cut `stayLoggedIn` (`node.debug`). The engine
   flag gates much more than the design said:
   - `IdleTimerHandler.ts` (idle logout)
   - "No trigger for …" game messages
   - script-reload broadcasts (`World.ts:275`)
   - random events for staff (`PlayerOps.ts:1115`)
   - the map-editor routes in `web.ts:255-299`, including `PUT /content/*`, which writes files

   Settings are **cheats, XP rate and members only**, and `node.debug` stays
   `false`.
2. **Commands are shown only.** The 274 web client has no paste handling:
   `client.js` has no `paste` or `clipboard` code, and a Ctrl+key becomes char 0.
   So there is no copy button and no `singlePlayerCopy` channel. The list shows
   each command's exact typed form.
3. **Debug procs are typed `::~name`.**
   - `ClientCheatHandler.ts:57-65` runs `[debugproc,<cmd minus first char>]`
     only when `cmd[0] === '~'`, and has no fallback.
   - The content's own `::~help` menu prints the forms without the `~`, and
     the panel says so.
   - Debug procs, and the `::` commands `reload`, `speed`, `fly` and `naive`,
     need `staffModLevel >= 4 && !production`; the other `::` commands listed
     need staff level 2 or 3. The kit gives staff 4 with cheats
     on and 0 with them off; at 0 the world ignores all of them without saying
     anything (`ClientCheatHandler.ts:57,189,550`).
4. **The `::` table is 21 entries.** Four kinds of command are left out:
   - `::track`, which does not exist in the pinned upstream engine.
   - `::rebuild`, which does nothing with `build.liveReload: false`, because
     `devThread` is null (`World.ts:315-322`).
   - `::random`, which can never fire at staff level 4 with debug off
     (`PlayerOps.ts:1115`).
   - The 12 commands gated on `&& Environment.node.production`.
5. **Saves are written on logout and every 15 minutes**
   (`World.PLAYER_SAVERATE = 1500` ticks), not only on logout. The panel says
   both.
6. **Playtime is in ticks of 600 ms** (`World.ts:608` adds one per tick). The
   game never shows playtime, so the in-game check compares **Combat Lvl** and
   **Total Lvl** from the skills tab. Total Lvl is the client's script op 9:
   base levels summed over `Skill.used`, which is `PlayerStatEnabled` for the 21
   saved stats.
7. **Engine references are to the pinned upstream checkout**, at
   `.engine-work/engine` (`LostCityRS/Engine-TS@1d25566c`), not the fleet fork
   at `Server/engine`. Line numbers differ from those in the design below:
   - `Packet.getcrc` is at `src/io/Packet.ts:54-60`, with its table at `:14-16,40-52`.
   - `toSafeName` and `toDisplayName` are in `src/util/JString.ts:1-67`.
   - `levelExperience`, `getLevelByExp` and `getExpByLevel` are at
     `src/engine/entity/Player.ts:76-98`.
   - `getCombatLevel` is at `Player.ts:1347-1353`.
   - `PlayerLoading.load` is at `src/engine/entity/PlayerLoading.ts:29-100`.

   The save format is identical: upstream `Player.save()` writes the same
   header, and `SAV_VERSION` is 7 in both.
8. **The fixture** comes from the fork, at
   `Server/engine/test/fixtures/save-v7.sav` (sha256 `66d5b608…c63fd1`), whose
   format matches. It lives in `src/main/singleplayer/fixtures/`, following
   `src/main/hiscores/fixtures/`, rather than a new top-level `test/`. It reads
   as:
   - v7, at 3235,3220, with every stat at 99
   - combat 126, total 1881
   - playtime 3529 ticks
   - stored checksum −858711323
9. **The name functions live in `src/shared/names.ts`,** not in `save.ts`, so the
   import and rename prompt can preview the log-in name as you type.
10. **Names Windows cannot store are refused everywhere:** `con`, `prn`, `aux`,
    `nul`, `com1-9` and `lpt1-9`. Otherwise a character made on a Mac could never
    be copied to Windows, and the engine could not save one made there.
11. **One settings channel.** `singlePlayerSetSetting(key, value)` replaces the
    three separate setters, and a pure validator, `readSettingChange`, checks
    each change.
12. **Replacing a character never destroys it.** An import, rename or copy onto
    an existing name first moves that save to the system trash. Delete also goes
    to the trash. If trashing fails, nothing is changed.
13. **Writes are atomic:** `<name>.sav.part`, then a rename. The list ignores
    anything not ending in `.sav`.
14. **`.title` does not exist in `styles.css`.** The section switch reuses
    `renderer/tab.tsx`'s `Tab role="button"`, as chat's row does, and the name
    field reuses `ChatSettings`' `FIELD` classes.
15. **`CommandRef` lives in `src/shared/commands.ts` only.**

Also decided: the work is on a new branch, `single-player-tools`, cut from
`origin/main` after chat-settings (PR #9) merged, rather than on `chat-dock`.

---

## Context

The kit's single-player world gives the player exactly one thing to change:
cheats on or off. Everything else about the world is hard-coded in
`worldJson()`. The only way to touch a character is "Open saves folder" and a
file manager.

That is thin for what the project says single player is for.
`docs/superpowers/specs/2026-09-06-packaging-and-single-player-design.md`
(Decision 13) and the README are explicit that this is a development world on
purpose: the player's own machine, their own world, no one else reachable. A
development world that cannot change its XP rate, cannot move a character
between machines, and cannot tell you that `~maxme` exists is not carrying its
own idea.

There are three gaps, in the order they bite:

1. **Characters are invisible and immovable.** A character is a file,
   `<home>/data/players/main/<name>.sav`. With `login.enabled: false` the engine
   reads that file by name and ignores the password entirely
   (`engine/src/server/login/LoginThread.ts:85-119`). So "import a save and log
   in as it" is a validated file copy. Today nothing in the kit does it, and
   nothing tells you which characters you already have.
2. **Real world knobs are hard-coded.** `node.xpRate`, `node.members` and
   `node.debug` are live, working engine settings that `config.ts` pins at `1`,
   `true` and `false`. Nothing but the kit's own template stops the player
   choosing them. ~~`node.debug`~~ (decision 1)
3. **With cheats on, nothing tells you what cheats are.** The content pack has
   247 `~` debugprocs, among them `~maxme`, `~bank`, `~quests`, `~varrock` and
   `~completequests`, plus about 20 `::` commands. None of them can be found
   from inside the kit. The content sources are not shipped at runtime, so the
   list has to be built at stage time.

No engine patches. All three land in the kit alone, which keeps
`patches/engine/` as close to empty as `patches/engine/README.md` asks.

Work happens in `Server/swiftkit` (a different repository from the Server
launcher repo). Automatic backups were considered and cut for this pass.

## Design

### The panel gains three sections

`src/renderer/tools/SinglePlayer.tsx` becomes a shell over three focused
components in a new `src/renderer/tools/singleplayer/` directory:
- A segmented World / Characters / Commands switch picks the component. Which
  section is open is renderer-local `useState` and is not kept.
- The status line, version line and log tail stay above the switch, since they
  describe the world in every section.

Keep the existing conventions:
- the hand-written `.btn` and `.sunk` classes (~~`.title`~~, decision 14)
- inline `CSSProperties` consts where a class must beat a Tailwind utility,
  with a comment saying why, as `MUTED` and `SPENT` already do
- sentence case in the renderer

### Settings replace the lone cheats flag

`SinglePlayerView.cheats: boolean` becomes `SinglePlayerView.settings: SinglePlayerSettings`:

```ts
export interface SinglePlayerSettings {
    cheats: boolean;        // node.localStaffLevel: 4 | 0
    xpRate: number;         // node.xpRate, one of XP_RATES
    members: boolean;       // node.members; off = the free-to-play game
}
export const XP_RATES = [1, 2, 5, 10] as const;
```

~~`stayLoggedIn: boolean; // node.debug`~~ (decision 1)

- **Each setter costs a confirmed restart,** exactly as cheats does today.
  `confirmCheats()` in `src/main/index.ts` generalises to a confirm for any
  restart.
- **Fix the confirm's stale copy while there.** It still says "The world will
  play as the servers do", the claim commit `2f59777` removed from the panel but
  not from this dialog.

~~The copy for `stayLoggedIn`~~: cut with the setting (decision 1).

### A character is a file, and base37 is what makes that safe

`toSafeName` (`engine/src/util/JString.ts`) is `fromBase37(toBase37(name))`.
Ported faithfully, its output can only be `[a-z0-9_]{1,12}` or the literal
`invalid_name`. That single function answers three questions at once: path
traversal, name collisions, and "the name you type is the name you log in
with". So the rule is:
- normalise every name through it
- reject `invalid_name`
- never touch a path built any other way

### Save parsing stops early and on purpose

New pure module `src/main/singleplayer/save.ts`, modelled on
`engine/tools/server/SaveReader.ts`. That tool exists for exactly this reason:
reading a save without importing `World`. The new module reads only the header:

```
u2 magic=0x2004 | u2 version | u2 x | u2 z | u1 level
u1[13] appearance (skipped) | u2 runenergy
i4 playtime (u2 when version < 2)
21 x { i4 xp ; u1 boostedLevel }
```

and stops. It never reads varps or inventories, so a format change after the
stat block cannot break it.

Validation follows the engine's own order:
1. A file under 2 bytes is a fresh character.
2. Wrong magic is not-a-save.
3. A version above 7 is too-new.
4. Otherwise, CRC32 over `[0, len-4)` must match the trailing `i4`.

A `SaveError` carries a `kind`, so the UI can say which of those went wrong.

Three things to port exactly, each pinned by a unit test:

- **`crc32`**: `Packet.getcrc`. Reflected table, polynomial `0xEDB88320`. It
  returns `~crc` (signed), which is compared against a signed `i4` read. Pin it
  against `save-v7.sav`, copied into the kit's fixtures.
- **`levelFromXp`**: `getLevelByExp`, with the table built beside it. Note the
  table is ×10: the saved `i4` feeds straight in, and the xp the game shows is
  raw / 10.
- **`combatLevel`**: `getCombatLevel`. Needs the stat order from
  `PlayerStat.ts`.

Pin the level table with known constants (92 → 6,517,253; 99 → 13,034,431,
both ×10). A transcription slip then fails loudly rather than showing a
plausible wrong number.

### The character list stays live

`SinglePlayerService` caches the list and re-reads
`<home>/data/players/main` at three points:
- when the world's status changes
- after any change it makes itself
- when the directory changes on disk

The last uses a new `watchDir(path, cb): () => void` on
`SinglePlayerDeps.fs`, debounced by about 400 ms. The watcher is what makes
logging out in-game update the panel, and as a dep it is easy to fake in
`service.test.ts`.

The panel says plainly when progress is written, so a running world's numbers
are the last saved ones (decision 5).

### Import is two steps, and main never trusts a renderer path

1. **Import…** — main opens `dialog.showOpenDialog`, filtered to `.sav`, reads
   and validates the bytes, and returns `{ token, suggestedName, summary }`.
   The token is random and is not a path, so the second call cannot be pointed
   anywhere the user did not pick. An invalid file returns its
   `SaveError.kind`, and the panel says why.
2. The panel shows an inline "Import as [____]" row, prefilled with the
   suggested name. It is the same inline-prompt shape chat uses for its nick.
   The panel then invokes `import(token, name)`. Main re-reads and
   re-validates, normalises the name, confirms an overwrite if that character
   exists, and writes the file.

**Export** is a `dialog.showSaveDialog` defaulting to `<name>.sav`, then a
byte copy. It only reads the saves, so it is always allowed.

**Rename**, **duplicate** (with the same inline name prompt) and **delete**
round out the list. Delete goes through `shell.trashItem`, so it can be undone
outside the app, and it asks first.

**Changes are allowed while the world is running, and they ask first,** giving
the reason: you are playing right now, and logging out will write over this.
That is truer than blocking them, and cheaper than detecting who is logged in,
which the kit cannot do.

### The command list is generated at stage time

The kit ships only `content/maps/{multiway,free2play}.csv` at runtime, so the
`.rs2` sources are not there to scan. `scripts/stage-engine.mjs` has the full
content checkout at `.engine-work/content`, and it already writes
`VERSION.json` into `engine-dist/`. `electron-builder.yml` copies that folder
wholesale to `resources/engine`. So the list is generated there, next to
`VERSION.json`, and ships with it at no extra cost.

A declaration of the form `[debugproc,name](type $param, ...)//note` parses
into `{ name, params, note, group }`. The group is the directory the script
came from. It is worth keeping because it sorts the list by usefulness: cheats
has 105, debug 91, engine 50, and quests one. The panel defaults to cheats,
the ones a player actually wants, and lets you widen to the rest.

The `::` commands are a hand-written table in `src/shared/commands.ts`, about
20 entries, among them:
- `::tele`, `::getcoord`, `::setvar`, `::give`, `::setstat`, `::minme`
- `::npcadd`, `::locadd`, `::speed`, `::fly`, `::reload`, `::snapshot`
- ~~`::track`~~ (decision 4)

They change rarely, and each needs a human-written description regardless.
Omit the dozen gated on `Environment.node.production` (`::ban`, `::kick`,
`::reboot`, `::teleother`, …). They can never fire in single player, and
listing a dead command is worse than not listing it.

Two runtime details:

- **A one-shot IPC call, not ShellState.** The list is about 270 entries and
  never changes, so it does not belong in `ShellState`, which is pushed to
  every window on every relayout. Serve it from a one-shot
  `singlePlayerCommands()` IPC call that the panel makes once on mount.
- ~~**Copying** goes through main's `clipboard.writeText`~~ (decision 2).

When `COMMANDS.json` is absent (a checkout that has not run
`npm run stage:engine`), the section falls back to the `::` table and says so.
When cheats are off, the section says these need cheats on.

## Files

New

| Path | Owns |
|---|---|
| `src/main/singleplayer/save.ts` | `crc32`, `levelFromXp`, `combatLevel`, `readSave`, `SaveError`. Pure: no `node:fs`, no Electron. (`toSafeName` and `toDisplayName` are in `src/shared/names.ts`, decision 9.) |
| `src/main/singleplayer/save.test.ts` | The three ported formulas, every `SaveError.kind`, and the fixture |
| `src/shared/names.test.ts` | base37 edge cases: `invalid_name`, more than 12 characters, a trailing `_`, punctuation |
| `src/main/singleplayer/characters.ts` | Listing, import, export, rename, duplicate and delete, over `SinglePlayerDeps.fs`, so it is testable |
| `src/main/singleplayer/characters.test.ts` | Collisions, overwrite, unsafe names, and corrupt files listed with a problem rather than dropped |
| `src/shared/commands.ts` | The `::` table and the `CommandRef` type |
| `src/renderer/tools/singleplayer/{World,Characters,Commands}.tsx` | The three sections |
| `src/main/singleplayer/fixtures/save-v7.sav` | Copied from the fleet engine's `test/fixtures/save-v7.sav` (decision 8) |

Edited

| Path | Change |
|---|---|
| `src/shared/singleplayer.ts` | `SinglePlayerSettings`, `XP_RATES`, `CharacterInfo`; `SinglePlayerView.cheats` → `.settings`, plus `.characters` |
| `src/shared/ipc.ts` | The settings channel (decision 11); `singlePlayerPickImport`, `singlePlayerImport`, `singlePlayerExport`, `singlePlayerRename`, `singlePlayerDuplicate`, `singlePlayerDelete` and `singlePlayerCommands`, with matching `ZanarisApi.singlePlayer` methods |
| `src/main/appState.ts` | `StateFile.singlePlayer` widens to the settings, read one field at a time like `readChat`, so a junk value costs only itself |
| `src/main/singleplayer/config.ts` | `worldJson({ ports, settings, revision })`; `node.members`, `node.xpRate` and `node.localStaffLevel` come from the settings |
| `src/main/singleplayer/service.ts` | The `cheats` dep becomes `settings`; `setSettings()` generalises `setCheats()`; the character cache, its refresh points and the watcher; `view()` carries both |
| `src/main/singleplayer/electron.ts` | The real `watchDir`, `readBytes`, `writeBytes`, `list`, `stat`, `copyFile` and `trash` |
| `src/preload/index.ts` | The new wrappers |
| `src/main/index.ts` | The restart confirm generalised, with the copy fix. The new handlers each validate their payload as `unknown` and resolve the window through `windowFor(event.sender)`. `xpRate` is checked against `XP_RATES` rather than accepting any integer. |
| `src/renderer/tools/SinglePlayer.tsx` | Status, version and log tail, then the section switch |
| `scripts/stage-lib.mjs` (+ test) | The pure `parseDebugprocs(text, file)` |
| `scripts/stage-engine.mjs` | Walk `.engine-work/content/**/*.rs2` and write `engine-dist/COMMANDS.json` beside `VERSION.json` |

Tests to update:
- **`config.test.ts`** asserts `world.json` field by field, so every new field lands here.
- **`service.test.ts`**: the `harness()` fake fs and `FakeProcess` need the new fs members. Add tests for each setter restarting, and for the watcher refreshing the list.
- **`appState.test.ts`**: defaults, persistence, and survival of a file that is missing or corrupts each new key.

## Order

1. **`save.ts` and its tests.** The riskiest transcription, and everything else
   reads it. Land it alone, then stop at a checkpoint.
2. **Settings.** `SinglePlayerSettings` goes through shared → appState → config
   → service → preload → main, and ends in a World section that renders cheats
   plus the new controls. Update `config.test.ts` and `service.test.ts`.
   Checkpoint: the XP rate visibly changes xp in game.
3. **Characters.** `characters.ts` and its tests, the deps, the watcher, the IPC
   and the Characters section. Checkpoint: export, delete, re-import under a
   new name, and log in as it.
4. **Commands.** `parseDebugprocs` and its test, the stage step, the `::` table,
   the one-shot IPC and the Commands section.

Cut first if it runs long: duplicate, then the group filter in the command list
(ship the flat searchable list instead).

## Verification

```
npm run typecheck && npm test
npm run stage:engine
```

Confirm that `engine-dist/COMMANDS.json` holds 247 debugprocs, and that the
script's existing `bootCheck()` still passes.

Then run the app (`npm run dev`), open a single-player window, and check each of these:

1. **The levels read from a save are right.** Play briefly and log out. The
   character appears in the list, and its combat level and total level match
   the in-game skills tab (decision 6). This is the real check on the ported
   formulas: the unit tests pin the constants, this pins the reading.
2. **A character survives export, delete and import.** Export the character.
   Delete it, and confirm it is in the OS trash. Import it back under a
   different name, then log in as that name: it is the same character.
3. **Bad files are refused.** Import a file that is not a save, and a
   truncated one. Each is refused with its reason, and nothing is written.
4. **Names stay safe.** Type a name of punctuation, and a 20-character name.
   Neither escapes `[a-z0-9_]{1,12}`, and the first is refused.
5. **XP rate works.** Set 5×, restart, and gain xp: it is 5× the xp.
6. **Members off works.** Turn members off and restart: the free-to-play game.
7. ~~Stay logged in, idle past 90 s~~ (decision 1).
8. **Commands need cheats.** With cheats on, type `::~maxme` from the Commands
   section into the game's chat box (decision 2). With cheats off, the section
   says so and the command is refused.
9. **A running world asks first.** Change a setting while the world is running.
   The confirm names the restart, and cancelling changes nothing.
