# Zanaris Kit for 04scape

An Electron client that opens several 04scape servers at once, one window per
server, where every window knows which server it is running and can hop
between that server's worlds.

**Status: milestone two of the server-windows design.** Server windows with
the pinned game tab, the rail and panel, the widen / shift / push layout
engine, and now the Worlds tool: a world list with players and latency, a
low / high detail switch, and the last world remembered per server. Page tabs,
timers, screenshots and the other tools follow. The design is in
`docs/superpowers/specs/2026-09-05-server-windows-design.md`, which also maps
LostHQ's LostKit 2 onto it; the plans are under `docs/superpowers/plans/`.

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
  complains about FUSE, install `libfuse2` from your distribution. On Ubuntu
  24.04 it may instead refuse to start with a sandbox error, because AppArmor
  there restricts unprivileged user namespaces: run it once with
  `--no-sandbox`, or allow them with
  `sudo sysctl kernel.apparmor_restrict_unprivileged_userns=0`.

The kit checks the releases page once each time it starts and, when there is
a newer version, adds Help > Update Available, which opens that page. Set
`ZANARIS_NO_UPDATE_CHECK=1` to turn the check off.

## What it does

There is no launcher or management window; there are only game windows. New
ones come from the **File menu**: New Window (Cmd/Ctrl+N) opens another window
of the focused window's server, and New Window For lists the catalog. At
startup the app opens the first server in the catalog, Lost City. On macOS the
app keeps running with no windows and the dock menu opens one; elsewhere
closing the last window quits, since the menu lives in the window.

A **server window** is bound to one catalog entry for its whole life. Its tab
strip starts with the pinned game tab, which reads "Lost City · W5 · low ·
43 ms": the server, the world, the detail level and the latency to that
world's host, measured every ten seconds. A rail runs down the right edge; its
first tool is **Worlds**. The panel it opens (or Cmd/Ctrl+\) shows Low / High
detail, then every world with region, players online, members or free, and
latency, the current world marked. Choosing a world loads it in the same
window; flipping detail reloads the current world. The world and detail you
chose are remembered per server; the next window for that server opens there.

Either switch asks first. The dialog names where you are going and says the
switch happens whether or not you are logged in: Zanaris Kit loads the page
straight away, and if you are in game that logs you out. Switch goes, Cancel
changes nothing. The dialog carries a "don't ask again" checkbox, and ticking
it is reversible from View > Warn Before Switching Worlds, which shows the
current setting.

Opening the same server twice gives the second window its own storage
partition (`persist:server:<id>:2`) and the title "Lost City — World 5 (2)",
so two accounts on one server never share cookies or client prefs. Slot
numbers are reused once a window closes.

**Single player** needs no server at all: the kit carries the Lost City engine
and the game's files, and File > New Window For > Single player starts a world
on this computer. There is no account and nothing to sign up for — any name
typed at the login screen becomes a character, and its saves live in the app's
own data folder: `Application Support/zanaris-kit/singleplayer/data/players/main`
on macOS, `%APPDATA%\zanaris-kit\singleplayer\...` on Windows,
`~/.config/zanaris-kit/singleplayer/...` on Linux. The rail's Single player
tool says what the world is doing, and opens that saves folder or the world's
log. Its Cheats switch turns the engine's developer commands, `::tele` and
`::give`, on for the whole world; that takes a restart of the world, so it
logs you out and asks first.

Nothing is injected into a game page: no preload, no main-world code. The page
that runs is byte-for-byte the page the server served. A modified client is
both the most detectable thing we could ship and the most likely to be against
server policy. LostKit 2 injects a preload for its screenshots, zoom and AFK
detection; everything equivalent here is done from main or not at all.

## Chat

Chat is one IRC connection for the whole app, not one per window: it stays up
while you open and close game windows, and every window shows the same
conversation. It joins Libera.Chat over TLS, the shared `#04scape` lobby
always, plus a room per server while you have a window on it — `#04scape-lostcity`,
`#04scape-zanaris`, `#04scape-labs`. Those names are prefixed because this is a
public network where a bare `#zanaris` may already belong to someone else. A
local or self-added server gets no room, since it would be a room of one.

The first time you open the panel it asks for a nick, because there is nothing
sensible to default to and a name others see should be chosen rather than
assigned. Nothing connects until you pick one, which is also why an unattended
capture run never opens a socket. `/me`, `/msg`, `/nick`, `/join` and `/part`
work; an unrecognised slash command is refused rather than sent.

The protocol layer is hand-written and tested rather than a dependency: a
parser and serializer for the dozen commands and numerics this needs, and a
client that is pure over an injected `send`, so the whole conversation can be
driven in tests without a socket. The service around it owns the TLS socket
and the reconnect backoff, which grows and caps — a client that retries harder
the longer a network is down is a client that gets banned.

Not carried over from LostKit, which reaches LostHQ's hosted web client
instead: that host exposes no public IRC port, so this is a different room
rather than the same one.

## How it looks

The client is dressed as the game it launches. The 2004 interface is built from
warm olive stone: panels around `#443d31`, tabs cut into it at `#342e24`, lists
recessed to `#37311f`, gold headings, cream text and yellow-green values. Those
numbers were sampled out of a screenshot of the running client, quantising each
region so the stone separated from the text, rather than guessed.

Three things carry the period feel, and all three are load-bearing rather than
decorative:

- **Bevels are explicit.** Light above and left, shadow below and right, on
  every raised surface, inverted for every recess. CSS `outset` derives its
  edges from a single colour and always reads flat by comparison.
- **Stone has grain.** Two layers of noise, a fine one and a slower blotch,
  blended over the base colour. Overlay blending lightens as much as it
  darkens, so the base sits below the sampled mid to compensate.
- **Every glyph has a hard black shadow.** The client does this, and without it
  text fights the grain and loses.

The rail is not a row of buttons on a dark strip: its tabs are cut *into* the
stone, resting ones sunk with an inner shadow and the open one raised and lit.
That is how the client draws its inventory and friends tabs, and it is what
makes the open tool obvious.

Type has two roles. Headings and buttons are set in Pixelify Sans, bundled at
`src/renderer/fonts/` under the SIL Open Font License and loaded from disk so
the interface never waits on the network. Everything carrying data is Arial.
That split is forced rather than chosen: in Pixelify Sans a 5 reads as an S and
a 7 as a 1, so an early build showed "W5" as "WS" and "59 online" as "S9
online". A world switcher cannot afford that.

Latency colour marks the standout rather than grading everything. Most worlds
sit in a band set by where you live, so colouring them all by absolute
thresholds painted the whole column orange and said nothing. Green marks a
world worth switching to, orange one that is genuinely far, and everything
between is left as a plain number.

The mockups this was ported from live in `design/`: `build.mjs` generates the
artboards, and `seed-canvas.mjs` from the design skill packages them into a
canvas. The seeded output is gitignored because it is 2.5 MB of editor payload;
regenerate it rather than committing it.

## Why a window keeps playing when it is not in front

All three hosted clients drive their main loop with `setTimeout`; none of the
served bundles contain `requestAnimationFrame`, and `visibilitychange` is used
only to resume audio. Chromium throttles timers in a background window to once
a second, which would stall any game you were not looking at.
`backgroundThrottling: false` on each game view turns that off.

## The catalog

`<userData>/servers.json` (on macOS, `~/Library/Application Support/zanaris-kit/`),
seeded on first run, one entry per server:


| id | revision | worlds from | detail switch | wiki |
|---|---|---|---|---|
| `lostcity` | 274 | LostHQ's world API (`2004.losthq.rs/pages/api/worlds.php`), which carries players and both detail URLs | yes | losthq |
| `zanaris` | 274 | `zanaris.rs/worlds.json`, players from each world's `world.json` | yes | losthq |
| `lostcitylabs` | unknown, "May 2005 per Lost City Labs" | a static list, worlds 1 to 4 | no parameter found | none |
| `singleplayer` | 274, the bundled engine | none | | losthq |
| `local` | 289, as `engine/data/config/world.json` sets it | none | | none |

Each entry carries a `worlds` block (the source, a URL template with `{world}`,
`{url}` and `{lowmem}`, whether detail is switchable, the default world),
`bookmarks` for the page-tab menu that arrives next milestone (LostHQ's
guides, the clue coordinator, the world map, markets), an optional `hiscores`
API, the `hosts` page tabs may visit, and a wiki URL that never claims which
revision it describes, since losthq moves on its own schedule.

The app was called SwiftKit until the rename, and `userData` follows the
package name, so that directory used to be `.../Application Support/swiftkit/`.
The first launch after the rename carries the old profile over — `servers.json`,
`state.json`, and the game logins and caches under `Partitions/` — taking each
of the three only if the new directory has not got it already, since Chromium
builds that directory during startup before any of our code runs. See the note
at the top of `src/main/index.ts`.

Until the settings panel arrives, the list is edited as a file: File > Edit
Server List… opens it in your editor, and the app re-reads it when it regains
focus, or from File > Reload Server List. A file that cannot be read is renamed
to `servers.json.broken-<timestamp>` and the defaults are written in its
place; a message box says so. A version 1 file from the launcher-era build
(one entry per world) is migrated in place: its built-in entries become the
per-server ones above and any custom entries are kept. The ids changed with
it, so each server's storage partition starts fresh once. A window keeps its
own copy of its server, so editing the file never affects windows already
open.

`<userData>/state.json` remembers the last world and detail per server, and
whether the switch confirmation still shows. It is
not configuration and never interrupts a launch: a broken file is kept aside
and the state starts empty.

## Layout

Main owns all geometry. Each server window is one full-window **shell** view
(React, the only view with a preload) with the **game** view placed on top of
it inside the content rect. The shell draws the strip, rail and panel exactly
where main says they are, and leaves the content rect empty.

Opening the panel widens the window by 320px so the content rect, and with it
the game view, never changes. When that is not possible the engine falls back
in order:

| mode | when | what happens |
|---|---|---|
| widen | there is room to the right | the window grows |
| shift | the window would run off the right edge | the window grows and moves left |
| push | maximised, fullscreen, or no room on the display | the content rect narrows and the page's own auto-scaling shrinks the canvas |

The active mode is stated in the panel rather than silently substituted. The
content rect never drops below 765 x 503 unless the user shrinks the window.

## Running it

```sh
npm start            # build + launch
npm test             # the pure modules, no Electron
npm run typecheck
npm run capture      # open every server, screenshot every view, hop a world, exit
npm run stage:engine # fetch the pinned engine and content, pack, precompile into engine-dist/
npm run dist         # package this platform into release/ (stages first if needed)
```

`engine.lock.json` pins the engine and content commits the kit carries; see
`RELEASE.md` for how a release is cut. Everything under `engine-dist/`,
`.engine-work/` and `release/` is build output.

Single player runs from `engine-dist/` in dev, so `npm run stage:engine` has
to have run once before it works: without it the window says "Engine not
staged: run npm run stage:engine", and a capture run skips the entry rather
than failing on it. A packaged build stages the engine for you.

Capture mode (`ZANARIS_CAPTURE=<dir>`, settle time `ZANARIS_CAPTURE_WAIT` in
ms, default 15000) writes each window's shell and game views separately,
because a window's own webContents holds nothing when its content lives in
child views. It opens the panel on a loaded window, opens the Worlds tool,
waits for the list, switches to another world and captures that, then opens
a second instance of that server. It keeps its own `state.json` beside the
screenshots so a test switch never changes what the next real launch opens.
A view that has no frame yet is retried, then skipped.

## Verified

One capture run with every catalog server open at once:

| window | game | shell |
|---|---|---|
| Lost City | login screen at World 5 | "Lost City · W5 · low · 239 ms", the globe on the rail |
| Zanaris | login screen | "Zanaris · W1 · low · N ms" |
| Lost City Labs | login screen | "Lost City Labs · W1 · N ms", no detail since Labs has no switch |
| Local server | offline page, `ERR_CONNECTION_REFUSED`, auto-retry | "Local server", no worlds tool |
| Lost City, Worlds open | untouched | five worlds with region, players and latency, W5 marked in gold, the red Low detail slab pressed; mode **widen** |
| Lost City, after choosing W1 | login screen at World 1 | "Lost City · W1 · low · 294 ms", W1 marked; title "Lost City — World 1" |
| Lost City (2), opened after the hop | login screen at World 1, the remembered world | slot 2, `persist:server:lostcity:2` |

The version 1 `servers.json` on disk migrated in place during that run, with
no recovery prompt, and the state file recorded the hop.

222 tests cover the pure modules: layout, catalog (validation, defaults, file
recovery, v1 to v2 migration), slots, tabs, the window registry, the world
sources against the real API payloads (including a check that the Lost City
template reproduces LostHQ's URLs exactly), the worlds service (cache, shared
fetch, last-good-on-error, latency by host), the per-window switch state, the
app state store, the navigation guard, and the latency probe against a local
listener.

## Known

- **Latency measures the front door, not the game.** The probe is a TCP connect
  to the world's web host, so for a server behind a CDN it times the nearest
  edge rather than the game server. Lost City's Singapore world reads 45 ms
  from the UK, which is the edge answering, not Singapore. Real game latency
  would have to come off the websocket.
- **Capture mode needs a waking display.** macOS refuses `capturePage` on an
  occluded surface, and once the screen sleeps most shots come back "Current
  display surface not available for capture". The run still completes and skips
  those frames; rerun it with the display awake.

## Security posture

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
`webSecurity: true` on every view. The game view accepts no page-initiated
navigation at all: links, `location` changes, form submits and mouse back or
forward gestures are blocked, and web links open in the system browser. The
one exception is our own offline page returning to the page main asked for.
The only way the game view changes page is main calling `loadURL`, which is
how a world switch happens, and the history is cleared after every load so
nothing can walk back through worlds. The preload exposes exactly the shell
and worlds calls in `src/shared/ipc.ts`, and IPC handlers identify a window
from `event.sender`, never from a value the renderer supplies.

## Layout of the source

```
src/shared/layout.ts        geometry constants shared by main and the shell
src/shared/catalog.ts       ServerDef and the add-form input
src/shared/worlds.ts        WorldsDef, World, Detail, WorldsView, RememberedWorld
src/shared/ipc.ts           channel names, ShellState, the tool ids
src/main/layout.ts          pure: window and view rects; widen / shift / push        (tested)
src/main/catalog.ts         pure validation, migration; the servers.json store     (tested)
src/main/slots.ts           pure: slot numbers, partitions, titles                  (tested)
src/main/tabs.ts            pure: the pinned game tab and page tabs                 (tested)
src/main/windows.ts         pure: registry of open windows over a factory           (tested)
src/main/guard.ts           pure: what a page-initiated navigation may do           (tested)
src/main/appState.ts        the state.json store                                    (tested)
src/main/worlds/sources.ts  pure: LostHQ, Zanaris and static parsers, url templates (tested)
src/main/worlds/service.ts  per-server world list and latency over injected IO      (tested)
src/main/worlds/switch.ts   pure: one window's world, detail, url and labels        (tested)
src/main/worlds/probe.ts    TCP connect latency, node-only                          (tested)
src/main/worlds/warning.ts  pure: what the switch confirmation says                 (tested)
src/main/migrate.ts         pure: what a pre-rename profile carries across          (tested)
src/main/serverWindow.ts    one server window: shell view over game view, the switch
src/main/menu.ts            application menu: new windows, the server list, the panel,
                            the switch warning
src/main/renderer.ts        preload path; load the shell
src/main/index.ts           wiring, world services, IPC handlers, capture mode
src/preload/index.ts        the window.zanaris bridge
src/renderer/Shell.tsx      strip, rail, panel
src/renderer/tools/Worlds.tsx
static/offline.html         shown when a server can't be reached
```

## Where v1 went

`main` before the reset keeps the observe-only CDP tap, ISAAC seed recovery,
session decoder, XP tracker and the original sidebar (from `ee5116f` back).
The uncommitted work from just before the reset (the six-hour recorder and
the reload button) is parked in `git stash`.

## Next

3. **Page tabs.** `+` with the server's bookmarks, the address row, wiki
   search, the map action, the per-server host allowlist, per-tab zoom.
4. **Shared tools.** Screenshot cropped to the canvas, timers with an AFK
   reset, notes, settings, always-on-top.
5. **Chat.** IRC on Libera.Chat, channels under the `#04scape` prefix.
6. **Server tools.** Hiscores, clue lookup and calculators, with the data pack
   loader.
