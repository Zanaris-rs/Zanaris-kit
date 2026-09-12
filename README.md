# Zanaris Kit for 04scape

An Electron client that opens several 04scape servers at once, one window per
server, where every window knows which server it is running and can hop
between that server's worlds.

**Status: split panes — any pane, any axis, dragged and closed like iTerm —
on top of the reference pane and single player.** The window is a tree of
panes now rather than four fixed regions: the game, a reference page and any
tool can sit anywhere in it, split left/right or up/down, and every seam
drags. A fresh pane shows a launcher of this server's links and this window's
tools. Workspace tabs, background images and shareable layout presets follow.
The design is in `docs/superpowers/specs/2026-09-12-panes-and-tabs-design.md`,
which supersedes the layout halves of the server-windows and chat-dock specs
beside it; the plans are under `docs/superpowers/plans/`.

## Download

Installers for macOS, Windows and Linux are on the
[releases page](https://github.com/Zanaris-rs/Zanaris-kit/releases/latest):
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

A **server window** is bound to one catalog entry for its whole life. Its
strip starts with a badge reading "Lost City · W5 · low · 43 ms": the server,
the world, the detail level and the latency to that world's host, measured
every ten seconds. The game is never behind anything, so that is a read-out
rather than a tab — what follows it are the reference pages this window has
open. A rail runs down the right edge; its first tool is **Worlds**. Clicking
it puts the tool in the pane you are standing in — or splits that pane, when it
holds the game, so a click on the rail never costs you your view of it. What it
shows is Low / High
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

**View > Always on Top** pins the window you are in above other apps, so the
game stays visible while you are reading something outside the kit. It pins
the focused window rather than all of them — four windows all claiming the top
is four windows covering whatever each was pinned above — and the checkbox
follows focus, so it reads the window in front of you and is greyed out when
none is. What is remembered is simply the last thing you asked for: windows
opened after it, and the next launch, start pinned or unpinned to match.

**Hiscores** is the rail's other server tool, offered for the three remote
servers only — a one-player world has nobody to rank, so single player never
gets it. A name box and a Look up button sit above a Skill · Rank · Lvl · XP
table; the lookup fires on submit, never on a keystroke, since Lost City
rate-limits after a handful of requests inside a minute and typing a name would
spend that budget before you finished it. Overall comes first and is picked out
in gold, then whatever skills the server actually sent — Lost City Labs runs a
later revision than 274 and returns Slayer and Farming rows 274 never will, so
the table shows exactly what a lookup handed it rather than a fixed list. A
name nobody holds gets its own message instead of an empty table or a raw
error, and a 429 gets the same plain rate-limiting sentence wherever it comes
from. Lost City's raw API carries xp with one extra digit of precision, a
genuine tenth the client keeps internally; main's parser floors it away before
the panel ever sees it, matching the whole numbers Zanaris and Labs already
send, which is the one place comparing the panel against the raw API will look
wrong without being wrong. The **Full hiscores** link at the foot opens the
server's own page in your system browser rather than in the reference pane —
the pane shows the server's own curated links and refuses anything else, so the
label says where the link goes rather than leaving a new window to explain
itself.

**The launcher** is the way into the reference pages, and it is what an empty
pane shows. It lists this server's links, in order — for Lost City: Forums,
Coordinates, Clue Help, Puzzle Solver, World Map, Markets, Quest Guides, Skill
Guides, Skills Calculator, Bestiary and Item Database; for Zanaris the nine of
those that are not Lost City's own forums and prices; for Lost City Labs and
single player nothing — alongside the tools this window offers and the game, if
no other pane has it. Clicking one fills the pane you are looking at. Split
first and you fill the new half instead, which is how two pages end up side by
side.

There is no Guides tool any more. A chooser inside the pane it is about to fill
is a shorter path than a panel that opens somewhere else and puts the page
somewhere else again.

Each tab keeps its own live view for as long as it is open, so switching
between them is instant and nothing reloads — a half-filled coordinate
lookup, a map panned to where you are standing and a drop table scrolled to
the right row are all still there when you come back to them. The pane has
back, forward and reload and no address box: it browses freely within the
hosts that server allows, and a link off them opens in your system browser
instead. The seam between the game and the pane can be dragged, and where you
leave it is where the next pane opens. Closing the last tab closes the pane;
the control in the strip hides it without closing anything.

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

Your world is not a live one, and it does not pretend to be: the RuneScape
Guide will offer to skip the tutorial, whether cheats are on or off and however
many characters you start. That is deliberate. Nobody should have to redo the
tutorial on their own machine to get to the game, and a world that only you can
reach has nothing to protect by making them. What the Cheats switch controls is
the developer commands, and only those.

Nothing is injected into a game page: no preload, no main-world code. The page
that runs is byte-for-byte the page the server served. A modified client is
both the most detectable thing we could ship and the most likely to be against
server policy. LostKit 2 injects a preload for its screenshots, zoom and AFK
detection; everything equivalent here is done from main or not at all.

## Chat

Chat is one IRC connection for the whole app, not one per window: it stays up
while you open and close game windows, and every window shows the same
conversation. It joins SwiftIRC over TLS — the network LostHQ's community
actually uses — in the shared `#LostHQ` lobby always, plus `#LostCity` while
you have a Lost City window open. Zanaris and Labs get no room: there is no
channel for either on SwiftIRC, and guessing one would risk dropping a player
into a stranger's channel on a large public network. A local or self-added
server gets no room either, since it would be a room of one.

Chat is a pane like anything else: put it wherever you want it, drag its seams,
close it. It comes off the rail's Chat tab, which fills the pane you are
standing in.

It draws itself two ways, and picks between them by reading its own width
rather than remembering a preference. A conversation is a column of short lines,
and at 320px almost every one of them wraps; past about 560px the same log runs
wide and short instead, so six rows hold roughly what eleven hold in a narrow
column. That is the whole argument the old bottom dock was built on — what has
changed is only that a pane knows its own shape, so nothing has to be stored or
moved. Dragging the seam is what "move chat to the bottom" used to mean.

The first time you open chat it asks for a nick, because there is nothing
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

Not carried over from LostKit, which reaches LostHQ's community through
`https://irc.losthq.rs/`, a hosted web client rather than a server: that host
exposes no public IRC port. But it is the same room, not a different one — the
web client's own defaults are `wss://irc.swiftirc.net:4443/`, joining
`#LostCity` and `#LostHQ`, and SwiftIRC also exposes ordinary IRC ports, so
this app's raw-TLS client reaches those same channels directly.

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
seeded on first run, one entry per server, now at file version 4:


| id | revision | worlds from | detail switch | wiki |
|---|---|---|---|---|
| `lostcity` | 274 | LostHQ's world API (`2004.losthq.rs/pages/api/worlds.php`), which carries players and both detail URLs | yes | losthq |
| `zanaris` | 274 | `zanaris.rs/worlds.json`, players from each world's `world.json` | yes | losthq |
| `lostcitylabs` | unknown, "May 2005 per Lost City Labs" | a static list, worlds 1 to 4 | no parameter found | none |
| `singleplayer` | 274, the bundled engine | none | | losthq |

Each entry carries a `worlds` block (the source, a URL template with `{world}`,
`{url}` and `{lowmem}`, whether detail is switchable, the default world),
`bookmarks` — the reference links the Guides list offers, which is also the
whole of which servers offer it: Lost City has eleven including its own forums
and prices, Zanaris the nine that are not Lost City's, and Labs and single
player none, so the tool never reaches their rails — the `hosts` those pages
may visit, and a wiki URL that never claims which revision it describes, since
losthq moves on its own schedule. The three remote entries also carry a
`hiscores` block: a `source` — a `kind` naming which of the three lookup APIs
it is, plus the URL for it — and a `site` the panel's "Full hiscores" link
opens. Version 3 kept only Lost City's as a bare URL template; version 4 is
what turned it into this shape, and what gave Zanaris and Labs one of their
own for the first time. Single player carries no `hiscores`, since a
one-player world has nobody to rank.

A built-in server's `hiscores` is read back from the defaults above on every
launch rather than frozen from the file on disk — the same trade single
player's own revision already makes. It is the kit's knowledge, not something
the add form ever offered a way to set, so hand-editing or deleting one only
lasts until the next launch, when it comes right back.

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
(React, the only view with a preload) with the game and page views placed on
top of it, inside the rects main worked out.

A window is a bar across the top, a rail down the right, and a **tree of panes**
in everything left over. A pane holds exactly one thing — the game, a reference
page, or one of the tools — and any pane can be split left/right or up/down,
dragged at its seams, or closed. Splitting a pane halves that pane's own share
and leaves its neighbours where they are; splitting along the grain of an
existing row appends to it rather than nesting, which is what keeps a seam drag
moving exactly the two panes either side of it. Repeated splitting halves each
time, as it does in iTerm and tmux, and **Even Out** in the View menu is what
answers "make these the same size".

A fresh pane is empty and shows a launcher: this server's links, the tools this
window offers, and the game if no other pane has it. That list is why there is
no longer a Guides tool — a chooser in the pane it is about to fill is a shorter
path than a panel that opens somewhere else and puts the page somewhere else
again.

The window never resizes itself any more. Opening the old panel or dock grew the
window rather than shrinking the game, through a `widen → shift → push` ladder,
because reloading or rescaling the game view was believed to cost the player
their login. That turned out not to be true of resizing — `setBounds` does not
reload a `WebContentsView`; only `loadURL` does, which is why a world switch
warns and a drag does not — and with the game an ordinary pane there is no
chrome opening beside it to make room for. Splits divide space that is already
allocated, so the ladder, the per-axis mode notes and the protected content
extent all went with the columns that motivated them.

What a small game pane costs is the bottom of the canvas. The served page does
not rescale to follow unless the player picked **Auto Sizing** from the controls
under the game, so the canvas clips rather than shrinking — still reachable by
scrolling, though with no bar to hint at it, since the injected stylesheet hides
them. 765x503 is now what a game pane *asks for* when it is first placed, not a
floor anything protects.

Below that the client page is not ours: every server serves the same template,
and its own `overflow: auto` around a `100vh` centring column can put up a
vertical and a horizontal scrollbar that induce each other once the game view is
shorter than the page's natural height. Main injects a small stylesheet into the
game view's `dom-ready` (the kit's own offline and starting pages are left
alone) that hides the scrollbar — a hidden bar reserves no gutter, which is what
actually stops the two axes inducing each other — and separately swaps that
`100vh` for a percentage of the view's own height, which keeps the canvas centred
in an oversized pane now that `vh` is gone rather than fixing anything itself.

The floor on a pane is 120x80: the point at which it stops being able to show
that it exists, not the point at which its content is comfortable. A pane that
lands under it is held there and its siblings pay; when even the minimums do not
fit, every pane is cut by the same proportion, because clipping everything a
little beats clipping one pane to nothing.

## Running it

```sh
npm start            # build + launch
npm test             # the pure modules, no Electron
npm run typecheck
npm run capture      # open every server, screenshot every view, hop a world, exit
npm run stage:engine # fetch the pinned engine and content, pack, precompile into engine-dist/
npm run dist         # package this platform into release/ (stages first if needed)
```

`engine.lock.json` pins the engine and content commits the kit carries — Lost
City upstream, `LostCityRS/Engine-TS` and `LostCityRS/Content`, at the latest
revision Lost City has adopted. Single player is that game, not a fork of it.
The one exception is `patches/engine/`, which the stage script applies to the
engine checkout: three backwards-compatible changes a world running on a
player's own machine needs, on their way upstream. `patches/engine/README.md`
says what they are and why. See `RELEASE.md` for how a release is cut.
Everything under `engine-dist/`, `.engine-work/` and `release/` is build
output.

Single player runs from `engine-dist/` in dev, so `npm run stage:engine` has
to have run once before it works: without it the window says "Engine not
staged: run npm run stage:engine", and a capture run skips the entry rather
than failing on it. A packaged build stages the engine for you.

Capture mode (`ZANARIS_CAPTURE=<dir>`, settle time `ZANARIS_CAPTURE_WAIT` in
ms, default 15000) writes each window's shell and game views separately,
because a window's own webContents holds nothing when its content lives in
child views. It opens the panel on a loaded window, opens the Worlds tool,
waits for the list, switches to another world and captures that, opens the
Hiscores tool on each server that has one and looks a single name up there —
one request per server and no retry, since Lost City rate-limits after a
handful inside a minute — opens the Single player tool on the window running
the bundled world, then opens a second instance of that server. It keeps its
own `state.json` beside the screenshots so a test switch never changes what
the next real launch opens. A view that has no frame yet is retried, then
skipped.

## Verified

One capture run with every catalog server open at once:

| window | game | shell |
|---|---|---|
| Lost City | login screen at World 5 | "Lost City · W5 · low · 239 ms", the globe on the rail |
| Zanaris | login screen | "Zanaris · W1 · low · N ms" |
| Lost City Labs | login screen | "Lost City Labs · W1 · N ms", no detail since Labs has no switch |
| Lost City, Worlds open | untouched | five worlds with region, players and latency, W5 marked in gold, the red Low detail slab pressed; mode **widen** |
| Lost City, after choosing W1 | login screen at World 1 | "Lost City · W1 · low · 294 ms", W1 marked; title "Lost City — World 1" |
| Lost City, Hiscores open | untouched | "Showing granny_grunt", Overall picked out in gold at rank 18, level 1,724, 143,195,458 xp, then Attack down to Crafting in view, 20 rows in all. Every xp is a whole number — Attack reads 13,073,159, the floor of the raw `value` 130731598 |
| Zanaris, Hiscores open | untouched | the header row and nothing else, with "No hiscores entry for that name." in warn: `zezima` is nobody on Zanaris, and the panel says so rather than showing an empty table |
| Lost City Labs, Hiscores open | untouched | "Showing knight", Overall in gold at rank 1, level 1,176, 18,174,678 xp; 22 rows in all, Labs' later revision sending the Slayer and Farming lines 274 never does |
| Lost City (2), opened after the hop | login screen at World 1, the remembered world | slot 2, `persist:server:lostcity:2` |

The Zanaris and Labs frames caught the panel before its pixel font landed, so
the title and the Look up label are blank in those two — everything drawn in
the sans face, the table and its message included, is there. They evidence the
lookup, not the chrome around it.

The version 1 `servers.json` on disk migrated in place during that run, with
no recovery prompt, and the state file recorded the hop.

371 tests cover the pure modules: layout, catalog (validation, defaults, file
recovery, a version 1, 2 or 3 file each migrating into version 4, and a
built-in's hiscores block re-adopted from the defaults), slots, tabs, the
window registry, the world sources against the real API payloads (including a
check that the Lost City template reproduces LostHQ's URLs exactly), the
worlds service (cache, shared fetch, last-good-on-error, latency by host), the
hiscores sources against each server's own payload (the xp floor, Lost City's
empty 200, and the 404s that are and are not a missing player), the hiscores
service (supersession by sequence number, the last table kept through a
failure, the rate-limit message), the per-window switch state, the app state
store, the navigation guard, and the latency probe against a local listener.

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
- **A successful-looking capture can still be stale.** `capturePage` does not
  always fail loudly when a window goes occluded — it can also hand back an
  old frame without an error at all, so the log reports success and the PNG
  looks plausible while actually being a duplicate of an earlier shot. It
  happened once on this branch: a Hiscores capture logged a correct `ready
  "granny_grunt" 20 row(s)` and wrote a shell PNG that was byte-identical to
  an unrelated capture of the same window taken moments before, catchable
  only by hashing the two files against each other. It is likeliest on any
  capture step that awaits a real network round trip between fronting the
  window and shooting it — fronting is a point-in-time guard, not a held
  invariant, and both the Hiscores and Worlds passes do exactly that. The fix
  for the run that hit it was keeping the display awake throughout, per the
  bullet above; the safeguard for reading the evidence is not trusting a
  capture's log line over its own pixels.

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
src/shared/panes.ts         PaneView, SeamView, PageState — what the shell draws
src/shared/catalog.ts       ServerDef and the add-form input
src/shared/worlds.ts        WorldsDef, World, Detail, WorldsView, RememberedWorld
src/shared/ipc.ts           channel names, ShellState, the tool ids
src/main/paneTree.ts        pure: the split tree, its solver, splits and drags      (tested)
src/main/paneHost.ts        the views inside a tab's panes; holds no rules
src/main/catalog.ts         pure validation, migration; the servers.json store     (tested)
src/main/slots.ts           pure: slot numbers, partitions, titles                  (tested)
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
src/main/menu.ts            application menu: new windows, the server list, the pane
                            gestures, the switch warning
src/main/renderer.ts        preload path; load the shell
src/main/index.ts           wiring, world services, IPC handlers, capture mode
src/preload/index.ts        the window.zanaris bridge
src/renderer/Shell.tsx      the bar, the rail, and every pane where main put it
src/renderer/Launcher.tsx   what an empty pane offers: links, tools, the game
src/renderer/tab.tsx        the shared tab button, worn by the strip and the dock header
src/renderer/tools/Worlds.tsx
static/offline.html         shown when a server can't be reached
```

## Where v1 went

`main` before the reset keeps the observe-only CDP tap, ISAAC seed recovery,
session decoder, XP tracker and the original sidebar (from `ee5116f` back).
The uncommitted work from just before the reset (the six-hour recorder and
the reload button) is parked in `git stash`.

## Next

3. **The reference pane, beyond the links.** An address row and wiki search,
   per-tab zoom, tearing a page off into its own window, and reopening the
   pages that were open at quit.
4. **Shared tools.** Screenshot cropped to the canvas, timers with an AFK
   reset, notes, settings.
5. **Chat.** IRC on SwiftIRC, joining `#LostHQ` and `#LostCity`.
6. **Server tools.** Clue lookup and calculators, with the data pack loader.
