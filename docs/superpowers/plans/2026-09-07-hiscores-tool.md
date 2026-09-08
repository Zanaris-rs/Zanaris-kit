# Hiscores tool for Zanaris Kit

Repo: `/Users/matthewgould/Projects/2004scape/Server/swiftkit` (nested git repo, `Zanaris-rs/Zanaris-kit`).

## Context

The kit's sidebar already carries Chat, Worlds and Single player as rail tools, and the
2026-09-05 server-windows spec sketched a Hiscores tool that was never built —
`ServerDef.hiscores` exists as a `string | null` URL template with Lost City's endpoint
filled in, and nothing reads it. Players currently have to leave the kit and open a
website to look anyone up, including themselves.

This adds a Hiscores tool in the existing `[game][panel][rail]` layout: a name box, a
Look up button, and a `[skill][rank][level][xp]` table — the same table the zanaris.rs
website renders. It is offered for the three remote servers (Lost City, Zanaris, Lost
City Labs) and never for single player, where a one-player world has nothing to rank.

The same change removes the `Local server` catalog entry, which single-player mode
superseded.

Decided with the user while planning: **player lookup only** (no compare pane, no
skill boards), **plain four-column rows** (no XP-to-next-level bar, so no level table to
keep in sync), and the stale `local` entry is **migrated away** from existing installs
rather than left to rot in their `servers.json`.

## Live API facts (verified by curl during planning)

| Server | Endpoint | Body | Missing player |
|---|---|---|---|
| Lost City | `https://2004.lostcity.rs/api/hiscores/player/{name}` | `[{type, level, value, rank}]`, **`value` is XP × 10** | `200` + `[]` |
| Zanaris | `https://zanaris.rs/api/hiscores/player/{name}` | `{username, name, skills:[{category, rank, level, xp}]}` | `404 {"error":"not_found"}` |
| Labs | `https://www.lostcitylabs.com/hiscores/player?name={name}` | `{username, mode, board, skills:[{type, rank, level, xp}], kills:[…]}` | `404 {"error":"Unknown player."}` |

- Names must be the base37 stored form: `granny_grunt` resolves on Lost City, `granny grunt`
  does not. Labs accepts either. One `normaliseName` (lowercase, spaces → underscores) covers all three.
- **Lost City rate-limits**: it returned `429` after a handful of requests inside a minute.
  No lookup-as-you-type; `429` gets its own message.
- Labs returns types 19 (Slayer) and 20 (Farming), which 274 disables. Rendering only the
  types a server actually returns keeps one table honest across both revisions.
- Labs' `kills` and `mode`, and Lost City's beta profiles, are out of scope for v1.

## Design

### 1. Catalog and schema — `src/shared/catalog.ts`, `src/main/catalog.ts`

```ts
export type HiscoresSource =
    | { kind: 'lostcity'; url: string }   // .../api/hiscores/player/{name}
    | { kind: 'zanaris'; url: string }
    | { kind: 'labs'; url: string };      // .../hiscores/player?name={name}

export interface HiscoresDef {
    source: HiscoresSource;
    /** Opened by "Full hiscores" at the foot of the panel; null when there is no such page. */
    site: string | null;
}
```

`ServerDef.hiscores: HiscoresDef | null`. Filled in for `lostcity`, `zanaris` (whose
current `null` is simply stale — zanaris.rs does have the API) and `lostcitylabs`; `null`
for `singleplayer` and for anything the launcher's add form creates (`createServer`,
`catalog.ts:200-211`).

**Catalog file version 3 → 4** in `migrateCatalog` (`catalog.ts:265+`), doing two things:

- Drop the built-in `local` entry by id. Remove `local` from `LEGACY_IDS`
  (`catalog.ts:249`) and the "before `local` when present" clause from `withSinglePlayer`
  (`catalog.ts:305-312`), which exists only to order the two.
- Rewrite a v3 `hiscores` string into `{ source: { kind: 'lostcity', url }, site }` when it
  matches Lost City's endpoint, else `null`. Only Lost City ever had one, so this is a
  one-case rewrite, not a parser.

`isServerDef` (`catalog.ts:216`) swaps its `s.hiscores.includes('{name}')` check for an
`isHiscoresDef` guard, written the way `isWorldsDef` is used at `catalog.ts:236`.

### 2. Main process — new `src/main/hiscores/`

**`sources.ts`** (pure, mirrors `worlds/sources.ts`):
- `lookupUrl(source, name)` — normalise, then substitute `{name}`; the same substitution
  serves Labs' query string and the others' path segment.
- `parsePlayer(source, status, json)` → `PlayerSkill[]`, the `NOT_FOUND` sentinel, or a
  throw on a malformed body. Each server's quirk lives here and nowhere else: Lost City's
  `value / 10` and `200` + `[]`, Zanaris's `skills[].category`, Labs' `skills[].type`.

**`service.ts`** — `HiscoresService`, one per server id, shared by that server's windows,
modelled directly on `WorldsService` (`worlds/service.ts:24`):
- Injected `HiscoresIo { fetch(url): Promise<{ status: number; json: unknown }>; now(): number }`
  so it tests under `node --test` with no network. Note `index.ts`'s existing `fetchJson`
  (`index.ts:135`) throws on non-2xx and cannot be reused — a `404` is a legitimate answer
  here. Add a sibling `fetchStatus` beside it.
- Statuses `idle | loading | ready | notFound | error`; concurrent callers share the
  in-flight promise; a newer lookup supersedes an older one by sequence number; a failed
  lookup keeps the previous player's table on screen with the error beside it, the way
  `WorldsService` keeps the last good world list.
- `429` surfaces as "The server is rate-limiting lookups. Try again in a minute."

**`src/shared/hiscores.ts`** — the type → skill-name table (0 Overall, 1–18 Attack…Thieving,
19 Slayer, 20 Farming, 21 Runecraft), `HiscoresView`, `PlayerSkill`, and `normaliseName`,
so the renderer can label rows without main sending names down the wire.

**`src/main/appState.ts`** — a `hiscores: Record<string, string>` block (last name looked
up, per server id) read field-by-field like `readChat` (`appState.ts:37`), so a junk value
costs only the prefill.

### 3. IPC and shell wiring

- `src/shared/ipc.ts`: `IPC.hiscoresLookup`, `hiscoresClear`, `hiscoresOpenSite`;
  `TOOL_IDS` gains `'hiscores'`; `ShellState.hiscores: HiscoresView | null`.
- `src/preload/index.ts`: a `hiscores` block of three `invoke`s, matching the existing style.
- `src/main/index.ts`: `hiscoresServices = new Map<string, HiscoresService>()` and
  `hiscoresServiceFor(server)` beside `worldsServiceFor` (`index.ts:141`); the three
  handlers; the service passed into `createServerWindow`'s deps (`index.ts:186-200`).
- `src/main/serverWindow.ts:118`: the `single ? … : worldSwitch ? … : ['chat']` ternary
  chain cannot take a fourth tool. Replace it with a small builder — chat always, then
  `worlds` when there is a world switch, `hiscores` when `deps.hiscores` is non-null,
  `singleplayer` for the single-player window. Rail order: chat · divider · worlds,
  hiscores, singleplayer.
- `src/renderer/icons.tsx`: one flat sprite (three ascending bars) on the same dark
  outline as `Globe` and `Hearth`.

The lookup runs in main, never the renderer: the shell view has no business making
cross-origin requests, and keeping it in main preserves the `guard.ts` discipline.

### 4. Panel — `src/renderer/tools/Hiscores.tsx`

Follows `tools/Worlds.tsx` in structure and in reusing the hand-written stone classes
(`.title`, `.sunk`, `.btn`, `.link`, `text-dim`/`text-gold`/`text-warn`):

- Centred `<h2 className="title">Hiscores</h2>`.
- A name `<input>` prefilled with the remembered name, plus a **Look up** button; Enter in
  the box submits. Lookup happens only on submit — never per keystroke, given the 429.
- The table in a `.sunk` scroller: header `Skill · Rank · Lvl · XP`, then one line per
  returned skill in canonical order with Overall first and picked out in gold.
  `toLocaleString` for the numbers; right-aligned `tabular-nums`. 320px panel less padding
  leaves ~296px, which fits the four columns at the pixel font's size, and 20 rows fit
  without scrolling.
- States: nothing looked up yet (a one-line hint), loading, `notFound`
  ("No hiscores entry for that name.", in `text-warn`), error (message beside the table).
- Foot: a `.link` **Full hiscores** that opens `def.site` as a page tab, when the server has one.
- `Shell.tsx` gains the `active === 'hiscores' && state.hiscores` branch in the panel's
  chain and the `TOOLS` entry.

## Implementation order

Each step is committed on its own and lands **on top of the in-flight chat-dock work** —
the working tree already has uncommitted changes to `layout.ts`, `serverWindow.ts`,
`shared/layout.ts`, `ipc.ts` and `Shell.tsx`, and `ShellState.mode` is now `{x, y}`. Do not
start until that branch is committed, or expect to rebase.

1. `shared/hiscores.ts` + `shared/catalog.ts` types. No behaviour yet.
2. `main/hiscores/sources.ts` + `sources.test.ts` — one fixture per server, captured from
   the live responses above, plus the missing-player and malformed cases. Put the fixtures
   in `src/main/hiscores/fixtures/`, matching `src/main/worlds/fixtures/`.
3. `main/hiscores/service.ts` + `service.test.ts` with a fake `io` — supersession, error
   keeping the last table, 429, not-found.
4. `main/catalog.ts`: `isHiscoresDef`, the v4 migration, `DEFAULT_SERVERS` entries, `local`
   removed. Extend `catalog.test.ts` — a v3 file with `local` and a Lost City string, a v3
   file with a custom entry, a v4 round-trip.
5. `main/appState.ts` + test: the remembered name.
6. IPC, preload, `index.ts` services and handlers, `serverWindow.ts` tools builder
   (`tabs.test.ts`/`windows.test.ts` neighbours as needed).
7. `renderer/tools/Hiscores.tsx`, `icons.tsx`, `Shell.tsx`.
8. `README.md`: the catalog section documenting `hiscores` (`README.md:195`) and the tool list.

## Verification

- `npm test` (the `node --test` suite) and `npm run lint`/`typecheck` per `package.json`.
- `npm run dev`, then for each of Lost City, Zanaris and Labs: open the rail's Hiscores
  tool and look up a name known to exist on that server (`granny_grunt` on Lost City,
  `knight` on Labs), confirming the numbers match the server's own website — in particular
  that Lost City's XP is a tenth of its raw `value`.
- Look up a nonsense name on each and confirm "No hiscores entry for that name." rather
  than an empty table or a raw error.
- Confirm single-player windows show no Hiscores tool on the rail.
- Delete nothing, but copy a real `servers.json` containing `local` aside and launch
  against it: the entry is gone, custom entries survive, and the file comes back as
  version 4.
- Screenshot the panel against all three servers for the PR.

## Out of scope (follow-ups, not built)

Compare two players; skill boards / top-of-table; Labs' kill counts and game modes; Lost
City's beta profiles; looking a name up from a chat line.
