# The server list moves to a Settings window

> **Amended 2026-09-23, on the owner's call.** Decision 2 is reversed: nothing
> opens Settings on its own, on a fresh profile or otherwise. A launch opens the
> servers that are ticked, and with none ticked that is Lost City, as it has
> always been. Settings opens from the gear and from Settings… only. The window
> also gained a button that opens `servers.json` in the system's editor, for the
> fields no form exposes. A companion button for `state.json` was built and
> removed the same day, on the owner's call: the kit reads that file only at
> launch and rewrites it as it goes, so editing it from a running app achieves
> nothing.
> The sections below are marked where they described the old behaviour.

The owner's design of 2026-09-22. It replaces the surface chosen in
`2026-09-20-servers-pane-design.md`: the catalog was a tool pane, and it
becomes the first section of one Settings window for the whole app, opened
from a gear in every game window. Everything underneath the surface — the pure
rules, the startup set, adding and removing, and the protection of built-in
entries — carries over unchanged. The work is done on PR #16's branch, before
it merges.

## Context

PR #16 made the catalog a `'servers'` tool pane: offered from Add pane in
every window, and shown under the game on a fresh profile's first window. The
owner wants it out of the panes and into a popout, reached from a gear icon,
that can later hold other settings too.

A popout here has to be a real window. The game and the reference pages are
native `WebContentsView`s stacked above the shell's HTML, so anything the shell
draws over them is drawn underneath them — `shared/panes.ts:32` records that
this is why the pane dropdowns are native menus. A settings form is too large
for a native menu, so the popout is its own `BrowserWindow`.

It costs little. The renderer is one bundle (`src/renderer/index.html`), loaded
by one function (`renderer.ts:11`, `loadShell`), so a second window can load
the same page and the same preload and be told apart by a URL hash.

## Decisions

These were taken while designing, and override anything below that disagrees.

1. **One Settings window for the app.** Not a sheet on each game window and not
   a panel that closes when clicked away. The catalog, the startup set and
   chat's settings are all app-wide, and a panel that dismisses itself loses a
   half-typed add form.
2. ~~**A fresh profile opens Settings once, on Servers.**~~ **Reversed
   2026-09-23.** Nothing opens Settings but the gear and Settings…. The
   discovery argument stood, but an app that opens a second window at you on
   first run is the kind of thing the owner did not want; the gear carries it
   instead. `AppState.fresh()` went with the behaviour, having no other caller.
3. **The Servers pane goes away entirely.** `'servers'` never shipped, so taking
   it out of `TOOL_IDS` breaks no saved layout. Were PR #16 merged first, that
   id would be append-only and removing it would be the migration CLAUDE.md
   warns about — which is why this is a rework of PR #16 and not a follow-up.
4. **Same page, told apart by `#settings`.** Not a second page with a narrower
   preload. Every servers handler already checks who sent it, so a Settings
   window holding the full preload still cannot act on a game window; a second
   preload would buy little and need electron-vite's multi-page setup.
5. **No section menu yet.** The window is titled Settings and holds one
   section. A menu listing one entry is decoration; it arrives with the second
   section.

## Design

### The window

`src/main/settingsWindow.ts` is new and pure, holding the rules the way
`windows.ts` does for game windows — over an injected factory, so they are
tested without Electron:

- `SettingsWindowSlot.open(anchor)` creates the window when there is none and
  focuses the one there is otherwise. It never makes a second.
- The factory's `onClosed` clears the slot, so the next `open` makes a fresh
  window.
- `isSender(contentsId)` answers whether an IPC call came from it.
- `settingsBounds(anchor, size, workArea)` places it beside the window that
  asked, top edges level — to its right where the work area has room, else to
  its left, else against the edge with more free space. It centres only when no
  window asked. The case it exists for is a game window near the middle of a
  laptop-sized display, where centring Settings would put it over the game
  rather than beside it.

`src/main/settingsView.ts` is the Electron seam and holds no rules, as
`paneHost.ts` does for panes: it creates the `BrowserWindow`, loads the page,
and captures it for `npm run capture`.

The window has no parent. Parented to a game window, it would close whenever
that window closed, and it belongs to no one window. It never holds up a quit.
On Windows and Linux, closing it when it is the last window left quits the app,
as closing any last window does.

It uses the shell view's `webPreferences` — `sandbox`, `contextIsolation`, no
`nodeIntegration`, `webSecurity` — and refuses any navigation away from its own
page and any `window.open`. This window shows server names and notes that come
from `servers.json`, which people edit by hand. React renders them as text, so
this is defence in depth, and it is two lines.

### How it opens

- **A gear in every game window's tab bar**, just left of Add pane
  (`Shell.tsx:389`). Its accessible name and tooltip are "Settings".
- **Settings… in the app menu, Cmd/Ctrl+,.** On macOS it goes in the app menu,
  which means replacing `{ role: 'appMenu' }` (`menu.ts:61`) with an explicit
  template, since a role menu cannot take extra items. Elsewhere it goes in
  File.
- ~~Once on a fresh profile~~ — removed 2026-09-23; see the amendment above.

### The page

The window loads `index.html#settings`, and `main.tsx` renders `<Settings />`
for that hash and `<Shell />` otherwise. `Settings.tsx` is the page: titled
Settings, with one section, **Servers**. That section is the existing list,
Open buttons, startup ticks and add form, moved from `tools/Servers.tsx` to
`settings/Servers.tsx` rather than rewritten.

### State and IPC

The Settings window has its own channel, built as the shell's is:
`settings.get()` answers the current state, and `settings.onState(cb)` receives
every push. The state is `{ servers: ServersView }`. `settings.open()` is new,
for the gear.

The four servers handlers accept only the Settings window as a sender, and
refuse anything else, since once the pane is gone no game window has a servers
UI. `settings.get` answers only the Settings window.

Taken out: `'servers'` from `TOOL_IDS` and `TOOL_NAMES`, `tools.push('servers')`
in `serverWindow.ts`, the `servers` field on `ShellState`, the `servers`
dependency on `ServerWindowDeps`, and the `case 'servers'` in `Shell.tsx`.

Every push PR #16 added for the pane goes to the Settings window instead of to
every game window: `catalogChanged()`, the startup-toggle handler, the
`onChange` given to `ServerWindows`, and `loadCatalog()`. Game windows return to
receiving no catalog data, which they never draw.

That also retires a hazard. The servers view was built inside every game
window's `state()`, which is how `windowCounts()` came to recurse through
`state()` in PR #16. With the view built only for the Settings window, no game
window's `state()` touches the catalog at all.

### First launch

**Removed 2026-09-23.** No launch opens Settings. A launch opens the ticked
servers, or the catalog's first entry when none is ticked, exactly as before
this branch. `npm run capture` is unaffected, since it never opened Settings
either.

`openWindowTabs` loses its `bottomTool` parameter and puts chat under the game
again in every window; the docstring paragraph describing a first-launch caller
goes with it, since that caller no longer exists.

## Files

| File | What changes |
|---|---|
| `src/main/settingsWindow.ts` | **New, pure.** `SettingsWindowSlot`, `settingsBounds`. |
| `src/main/settingsWindow.test.ts` | **New.** Both of the above. |
| `src/main/settingsView.ts` | **New.** Creates, guards, loads and captures the window. No rules. |
| `src/renderer/Settings.tsx` | **New.** The page, holding the Servers section. |
| `src/renderer/main.tsx` | Renders `Settings` for `#settings`, `Shell` otherwise. |
| `src/renderer/settings/Servers.tsx` | Moved from `tools/`. Takes its view from the Settings page instead of a pane; its comments reworded for a section rather than a pane. |
| `src/renderer/Shell.tsx` | The gear; the `servers` case removed. |
| `src/renderer/icons.tsx` | A gear icon. |
| `src/main/renderer.ts` | `loadShell` takes an optional hash. |
| `src/shared/ipc.ts` | `settings.*` channels and API; `'servers'` out of `TOOL_IDS`; `servers` off `ShellState`. |
| `src/preload/index.ts` | `zanaris.settings.*`. |
| `src/main/paneMenu.ts` | `TOOL_NAMES.servers` removed. |
| `src/main/serverWindow.ts` | No `servers` tool, dependency or state field; `openWindowTabs` called without `bottomTool`. |
| `src/main/tabs.ts` | `bottomTool` removed; docstring back to chat alone. |
| `src/main/tabs.test.ts` | The Servers-bottom-pane test removed. |
| `src/main/menu.ts` | Settings… with Cmd/Ctrl+,; an explicit macOS app menu. |
| `src/main/index.ts` | The slot; the settings handlers; pushes redirected; the launch opening Settings once; the capture block. |
| `README.md` | "There is no launcher or management window" becomes true of game windows plus one Settings window; the servers paragraph describes Settings. |
| `CLAUDE.md` | The built-in removal paragraph names Settings rather than the pane. |
| `docs/superpowers/specs/2026-09-20-servers-pane-design.md` | A note at the top saying which of its decisions this spec replaces. |

## Order

1. `settingsWindow.ts` and its tests.
2. The page, the channel and the window, reachable from the gear and the menu,
   holding the Servers section — while the pane still exists alongside it.
3. Remove the pane: the tool id, the state field, the dependency, the case,
   and the pushes redirected.
4. First launch opens Settings; `bottomTool` removed.
5. Capture, README, CLAUDE.md and the note on the old spec.

The pane stays until step 3 so every commit on the way builds and runs.

## Verification

`npm test`, `npm run typecheck` and `npm run build` throughout. Beyond them:

- The gear, Settings… and Cmd/Ctrl+, each open the same window, and a second
  click focuses it rather than making another.
- Closing it and opening it again gives a fresh window.
- Open, the startup ticks, add and remove all work from the Settings window,
  and File > New Window For agrees after an add or remove.
- Opening and closing a game window updates the open-window counts in Settings.
- No game window offers a Servers pane anywhere, and a layout saved before this
  change still loads.
- No launch opens Settings, on a fresh profile or any other.
- `npm run capture` photographs the Settings window. Open the image — a capture
  log line reads state, not pixels. Leave the machine alone while it runs:
  another window covering the kit mid-run makes the shell stop painting and the
  shot come out stale.
