# The server list becomes a pane

> **Superseded in part, 2026-09-22,** by `2026-09-22-settings-window-design.md`.
> The catalog lives in one Settings window opened from a gear, not in a tool
> pane. Decision 2 and the sections "The tool", "First launch shows the list
> once" and "Every window stays honest" no longer describe the code; the
> `'servers'` tool id was removed before it ever shipped. What carries over
> unchanged: the pure rules in `servers.ts`, the startup set, adding and
> removing, and the protection of built-in entries (decisions 1, 3, 4 and 5).

The owner's design of 2026-09-20. The kit opens into Lost City and never
mentions that it knows about anything else; this makes the catalog a tool pane
you can reach from any window, gives it add and remove, and lets you say which
servers a launch opens.

## Context

Startup is one line. `app.whenReady` ends with `actions.newWindow()`
(`index.ts:1662`), and with no window focused that takes `catalog.list()[0]`
(`index.ts:423`) — which is Lost City for no better reason than that it is
first in `DEFAULT_SERVERS`. Opening several instead needs nothing new:
`ServerWindows.open` already hands each window its own slot, title and storage
partition, and the same server may be open any number of times.

The rest of the catalog is all but invisible. It appears in File > New Window
For and, on macOS, the dock menu. Nothing on screen names another server, so
somebody who never opens that menu never learns the kit is not a Lost City
client.

Half of what is needed is already written and tested, and nothing calls it:
`createServer` (`catalog.ts:225`) turns an add form into an entry, `Catalog.add`
(`catalog.ts:653`) and `Catalog.remove` (`catalog.ts:662`) apply it and save.
`NewServerInput`'s comment in `shared/catalog.ts` says it is "what the
launcher's add form collects" — a form that has never existed. That comment is
the kind `CLAUDE.md` calls a defect, and this is what stops it being one.

What there is nowhere to put a server list *in* is the whole difficulty. Every
`BrowserWindow` the kit makes is a server window bound to one catalog entry for
its life; the README states the position outright — "There is no launcher or
management window; there are only game windows." Settings live in three
unconnected places: menu checkboxes, the Chat Settings tool pane, and
`servers.json` opened in whatever the system calls a text editor.

## Decisions

These were taken while designing, and override anything below that disagrees.

1. **Discovery is the goal, not convenience.** A first-run chooser with a "save
   my choices" tick was the starting request. It is the wrong shape for
   discovery: it spends the one moment of attention and then hides forever.
   There is no modal and no "don't ask again" anywhere in this design. The
   startup set survives as a per-server toggle in a pane that is always there.
2. **A tool pane, not a window.** Tools are panes in this kit. A management
   window would contradict the README's position, add a lifecycle (what does
   closing it mean, does it hold the quit) and land its logic in
   `serverWindow.ts`, which cannot be tested.
3. **Built-in entries cannot be removed.** `Catalog.load` does not re-add a
   missing built-in — the four refresh functions only touch entries already
   present — so a removal of Lost City is permanent short of deleting
   `servers.json`. Remove is offered on user-added entries only. This is the
   same stance `refreshHiscores` and `refreshYourWorld` already take: a
   built-in's fields are the kit's knowledge, not the user's choice.
4. **The default launch does not change.** A startup list that is empty, or
   whose every server has gone, resolves to the first catalog entry — exactly
   what happens today. The feature costs nothing until somebody opts in.
5. **No edit form.** Add and remove only. Changing an existing entry stays
   File > Edit Server List.

## Design

### The tool

`'servers'` is appended to `TOOL_IDS` (`shared/ipc.ts:88`) and pushed
unconditionally in `serverWindow.ts`'s tool list (`serverWindow.ts:296`),
beside Timers and for the same reason: "what else can I play" is not a question
any particular server answers, so no window is without it. `TOOL_NAMES` in
`paneMenu.ts` gains `servers: 'Servers'`.

Appending to `TOOL_IDS` is one-way. Saved layout files carry tool ids between
people (`layoutFile.ts`), and a kit that stopped knowing one would turn those
panes into launchers. Adding is safe; a later rename or removal is a migration.

Nothing else is needed to make the pane reachable. The empty-pane launcher,
every pane header's dropdown and the tab bar's Add pane are all built from
`paneMenu.paneContentItems`, which takes its tools from that one list — which
is why they cannot come to offer different things.

### What a row says

One row per catalog entry: the name, the revision when it has one, its notes,
and how many windows of it are open. Then **Open**, and a checkbox, **Open at
startup**. A user-added entry also has **Remove**.

Open always makes a new window. A window is bound to its server for life, so
there is no other thing it could mean, and the button saying so is better than
a row that looks like it will change the game under you. This is what File >
New Window For already does; the pane is the same act with the list visible.

Below the list, the add form: name, address, revision, wiki, notes — the five
fields `NewServerInput` has always described.

### The rules are pure, as they must be

`serverWindow.ts`, `index.ts` and the renderer have no test infrastructure, so
nothing decidable goes in them. One new module, `src/main/servers.ts`:

- `startupServers(stored: readonly string[], catalog: readonly ServerDef[]): ServerDef[]`
  — drops ids the catalog no longer holds, de-duplicates, orders by the
  catalog, and answers `[catalog[0]]` when what is left is empty. That last
  clause is the rule that makes a launch into no windows at all impossible,
  whether the list was never set or everything in it was removed.
- `serversView(...)` — the row model above, so the renderer draws a list it was
  handed and works nothing out.

`createServer`, `Catalog.add` and `Catalog.remove` are already pure or already
tested. This design wires them up; it does not write them.

### The startup set

`state.json` gains `startup: string[]`, read one entry at a time in the style
of `readHiscores`: a hand-edited junk entry costs its own row and not the file,
because nothing here is worth losing somebody's remembered worlds over.
`AppState` gains `startupServers()` and `setStartupServer(id, on)`.

`app.whenReady`'s closing `actions.newWindow()` becomes a loop over
`startupServers(appState.startupServers(), catalog.list())`. Every window is a
real game client, so the list is opened in catalog order and nothing tries to
stagger or throttle it — if somebody ticks four servers, four clients is what
they asked for.

### First launch shows the list once

A fresh profile is one where `state.json` does not exist; `AppState.load`
exposes it as `fresh`, which needs no new stored key. On a fresh profile the
*first* window's initial tabs put Servers in the bottom pane, where Chat
normally goes. `tabs.openWindowTabs` (`tabs.ts:61`) takes which tool that is;
`index.ts` holds a one-shot flag the first `openServer` consumes, since the
factory runs per window and only the first one is meant.

So the catalog is on screen under the game the first time the kit ever runs,
and reachable from any pane forever after. Chat is one click away in the same
launcher. A three-pane column holding both was considered and dropped: the window
opens with a 232px strip below the game (`CHAT_PREFERRED_HEIGHT`), and halving
that gives two panes of about 114px each spending 32 of it on its own
header.

### Every window stays honest

A catalog change made inside a pane happens in this process, so the other
windows have to be told rather than left to notice. After any add, remove or
toggle: `pushState()` to every window, `installAppMenu()` so File > New Window
For agrees, and `catalogSeen = catalogMtime()` (`index.ts:284`) so the
on-focus `reloadCatalogIfChanged` (`index.ts:391`) does not mistake our own
write for somebody editing the file underneath.

### The renderer sends ids, never entries

New IPC under `zanaris.servers`: `list`, `add`, `remove`, `open`, `setStartup`.
Everything the renderer sends is an id or the five form fields, and `main`
judges all of it — `createServer` already refuses an address that is not http
or https, a blank name and a non-integer revision, and `Catalog.remove` answers
false for an id it does not hold. A renderer never sends a `ServerDef`.

## Files

| File | What changes |
|---|---|
| `src/main/servers.ts` | **New.** `startupServers`, `serversView`. Pure. |
| `src/main/servers.test.ts` | **New.** Both of the above. |
| `src/shared/ipc.ts` | `'servers'` in `TOOL_IDS`; the new channel types. |
| `src/main/paneMenu.ts` | `TOOL_NAMES.servers`. |
| `src/main/serverWindow.ts` | Push `'servers'` into every window's tools; carry the view. |
| `src/main/tabs.ts` | `openWindowTabs` takes which tool the bottom pane holds. |
| `src/main/appState.ts` | `startup: string[]` in `StateFile`, its defensive read, its two accessors. |
| `src/main/index.ts` | Startup loops the set; the one-shot first-launch flag; the IPC handlers and the three-part sync after each change. |
| `src/preload/index.ts` | `zanaris.servers.*`. |
| `src/renderer/tools/Servers.tsx` | **New.** The list, the toggles and the add form. |
| `src/renderer/Shell.tsx` | Draw it for `tool: 'servers'`. |
| `src/shared/catalog.ts` | `NewServerInput`'s comment stops describing a form that does not exist. |
| `README.md` | "At startup the app opens the first server in the catalog, Lost City" is no longer true. |
| `CLAUDE.md` | A note that `TOOL_IDS` is append-only and why. |

## Order

1. `src/main/servers.ts` and its tests — the rules, before anything can use them.
2. `appState.ts`: the stored list, read defensively, with tests.
3. `tabs.ts`: the bottom-pane parameter, with its test.
4. `TOOL_IDS`, `TOOL_NAMES`, the window's tool list — the pane becomes
   offerable and draws nothing yet.
5. The IPC, preload and `Servers.tsx` — the pane draws, opens and toggles.
6. Add and remove, wiring the existing catalog seams.
7. Startup reads the set; the first-launch flag.
8. Comments, README, capture.

## Verification

`npm test` and `npm run typecheck` throughout. Beyond that:

- A fresh profile (`state.json` absent) opens one window with Servers below the
  game; a second launch opens with Chat there.
- Ticking two servers and relaunching opens two windows; unticking both and
  relaunching opens one, Lost City.
- Removing every startup server from the catalog and relaunching opens one
  window rather than none.
- A layout file saved with a Servers pane loads in another window.
- Adding a server updates File > New Window For and every open Servers pane
  without a focus change.
- `npm run capture` under `caffeinate -d`, with file hashes compared against
  the previous run before the shot of the new pane is believed.
