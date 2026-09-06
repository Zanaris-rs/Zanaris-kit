# Zanaris Kit: server windows, a page strip, and shared tools

**Status:** proposed, 2026-09-05. Supersedes the launcher-only layout on the
`multi-server` branch.

## Goal

One client that opens any 04scape server, several at once, where every window
knows which server it is running and offers that server's reference material,
while chat, timers and screenshots behave identically everywhere.

The constraint carried over from v1 stands: nothing is injected into a game
page. The page that runs is byte-for-byte the page the server served.

## Model

Three kinds of thing exist:

| Thing | Count | Owns |
|---|---|---|
| App (main process) | 1 | server catalog, IRC connection, timers, settings, screenshot writer, data packs |
| Server window | 0..n | one running game bound to one server, its page tabs, its rail and panel |

There is no launcher or management window. New windows come from the File
menu: **New Window** (Cmd/Ctrl+N) opens another window of the focused
window's server, and **New Window For** lists the catalog.

A server window is created for exactly one catalog entry and never changes
server. Its title is the server's name; a second window for the same server is
"Zanaris W1 (2)".

Tools have a **scope**, and the scope decides where their state lives:

| Scope | Examples | State lives in | Shown in |
|---|---|---|---|
| app | chat, timers, settings | main, once | every window, identically |
| server | worlds, wiki, map, hiscores, clue lookup, calculators | main, keyed by server or revision | the windows of that server, with that server's data |
| instance | screenshot, later the XP tracker | the window | that window only |

## Server window anatomy

Top to bottom, left to right:

1. **Tab strip** (36px). The first tab is the **game tab**: pinned, cannot be
   closed, cannot be moved, labelled with the server name and revision ("rev
   unknown" when the catalog has none). After
   it come **page tabs**: wiki articles, the world map, anything on the
   server's allowed hosts. A `+` at the end opens a new page tab at the
   server's wiki home with the address box focused. The strip is the
   "browser": it tracks what reference pages this window has open.
2. **Address row** (32px), shown only while a page tab is active: back,
   forward, reload, an address/search box, and a note naming the revision and
   wiki host, "rev 274 · 2004.losthq.rs". Text that is not a URL is sent to the
   server's wiki search URL.
3. **Content area**: the active tab's view. The game tab's view keeps running
   while a page tab is in front (background throttling off, as today). Page
   views are throttled normally.
4. **Rail** (48px, right edge, always visible): one icon per tool, app and instance tools
   above a divider and server tools below it, settings at the bottom. An icon
   can carry a badge (unread chat, a timer that fired).
5. **Panel** (320px, between content and rail, closed by default): the active
   tool's UI. Opening it widens the window by 320px when the screen allows,
   otherwise the window shifts left, otherwise the content area narrows
   ("push" mode) and the game page's own auto-scaling handles the rest. This is
   v1's layout rule and its pure layout function comes back from `main`.

Minimum content size is 765 x 503 plus the strip, so the canvas is never
scaled unless the user chooses push mode by shrinking the window.

### Views and the shell

Each server window holds one **shell** view and any number of content views:

- The shell is a `WebContentsView` covering the whole window. It is the only
  view with a preload. It draws the strip, the address row, the rail and the
  panel, and leaves the content area empty.
- Each tab is a `WebContentsView` with no preload, placed on top of the shell
  inside the content rect. Only the active tab's view is visible.
- Main owns all geometry: it computes the strip, address, content, panel and
  rail rects from the window size, panel state and active tab kind, and sets
  view bounds. The shell never positions anything.

One shell per window means one renderer, one preload and one state tree,
instead of the L-shaped two-view arrangement v1 used.

### Keyboard and menu

| Action | Shortcut | Also |
|---|---|---|
| New window of the focused server | Cmd/Ctrl+N | File menu |
| New window for a listed server | | File > New Window For; the dock menu on macOS |
| Edit the server list | | File > Edit Server List…, opens `servers.json` in the system editor |
| New page tab | Cmd/Ctrl+T | `+` on the strip |
| Close page tab | Cmd/Ctrl+W | `x` on the tab |
| Close window (game tab active) | Cmd/Ctrl+W | confirms: "Close Zanaris W1? You'll be logged out." |
| Switch tab | Cmd/Ctrl+1..9 | click |
| Toggle panel | Cmd/Ctrl+\ | rail icon |
| Screenshot | Cmd/Ctrl+Shift+S | rail icon |

## Server catalog

Stored at `<userData>/servers.json`, seeded from the built-in list on first
run. Until the settings panel arrives it is edited as a file: File > Edit
Server List… opens it in the system editor, and the list is re-read when the
app regains focus or from File > Reload Server List.

```ts
interface ServerDef {
    id: string;          // slug, stable, used for partitions and folders
    name: string;        // "Zanaris — World 1"
    url: string;         // the game page
    revision: number | null;  // 274, 289 …; null when the server does not say
    notes: string | null;     // free text, e.g. "May 2005 per Lost City Labs"
    wiki: {              // optional
        home: string;    // "https://2004.losthq.rs/"
        search: string | null;  // search URL with {query}; null when the site has no known search endpoint
    } | null;
    map: string | null;  // a URL the map tool opens as a page tab
    hosts: string[];     // extra hosts page tabs may visit; always includes the game and wiki hosts
    worlds: WorldsDef | null; // how to list and address this server's worlds; null when it has one
    bookmarks: { name: string; url: string }[]; // reference pages offered by the page-tab "+" menu
    hiscores: string | null;  // player lookup API with {name}, e.g. "https://2004.lostcity.rs/api/hiscores/player/{name}"
}

interface WorldsDef {
    source:
        | { kind: 'losthq'; url: string }   // JSON: [{ world, location, count, p2p, hd, ld }]
        | { kind: 'zanaris'; url: string }  // JSON: [{ id, name, region, members, url }]; players from <url>/world.json
        | { kind: 'static'; worlds: { id: number; name: string; region: string | null; members: boolean | null }[] };
    /** Game page for a world: {world} is its number, {url} its origin, {lowmem} is 1 for low detail and 0 for high. */
    template: string;
    /** False when the server ignores the detail parameter (Labs); the switch is then hidden. */
    detail: boolean;
    /** Opened when nothing is remembered for this server. */
    defaultWorld: number;
}
```

Built-in `worlds`: Lost City uses LostHQ's world API
(`https://2004.losthq.rs/pages/api/worlds.php`), which carries the player
count and both detail URLs per world, with template
`https://w{world}-2004.lostcity.rs/rs2.cgi?plugin=0&world={world}&lowmem={lowmem}`.
Zanaris uses `https://zanaris.rs/worlds.json` with template
`{url}/rs2.cgi?lowmem={lowmem}` and counts from each world's `world.json`.
Labs is static, worlds 1 to 4 under `https://www.lostcitylabs.com/play/world-{world}/`,
with `detail: false` because no parameter was found. Local has none. The
catalog entries are per server; the `url` field is the default world's page
and is what a server without `worlds` loads.

The settings panel's add form (milestone 3) asks for name, game address,
revision (which may be left unknown), an optional wiki address and a note;
`hosts` is derived and `map` is set in the same panel. A window holds its
own copy of its server, so removing an entry never affects windows already
open.

Built-in entries: Zanaris W1 (rev 274, losthq wiki), Lost City W5 (rev 274,
losthq wiki), Lost City Labs W1 (revision unknown, note "May 2005 per Lost
City Labs", no wiki), Local (rev 289, no wiki). A wiki is stored as a URL;
nothing in the catalog claims which revision a wiki describes, since losthq
moves on its own schedule.

### Data packs

Bundled under `data/<revision>/`, loaded by main on demand, exposed read-only
to server tools by revision. A pack may hold `clues.json` (step text to
answer) and `presets.json` (timer presets). A missing pack is normal, and a
server with no known revision never has one: server
tools show "No data for rev N" and offer wiki search instead. Packs ship empty
in the first milestones; the design reserves the slot.

## Tools

A tool is a small declaration plus a panel component:

```ts
interface Tool {
    id: string;
    label: string;
    icon: string;
    scope: 'app' | 'server' | 'instance';
    panel?: React.ComponentType;   // opens in the panel
    action?: () => void;           // or runs immediately (screenshot, map)
}
```

Server-scoped panels receive the window's `ServerDef` and its data pack from
context. App-scoped panels receive app state that main broadcasts to every
shell.

### Initial set

**Worlds** (server). The first rail tool. The panel shows a Low / High detail
switch (hidden when the server's `detail` is false) above the world list:
number, region, player count, a members badge, the current world highlighted,
and a latency figure per world measured from main as the TCP connect time to
the world's host on port 443, refreshed every ten seconds while the panel is
open. Choosing a world loads its page in the game view, which logs the player
out, so the list is the whole gesture and there is no second confirmation.
Flipping detail reloads the current world. The game tab reads "Lost City · W5
· low · 43 ms" and the window title follows the world. The list is fetched in
main, cached for thirty seconds, with a refresh button and the age of the
list shown; a failed fetch shows the error and a retry, never an empty
panel. The last world and detail chosen are remembered per server and used
by the next window for that server. Each source kind is a small adapter with
a pure, tested parser; the switch state (current world, detail, last known
list) is a pure module too.

**Chat** (app). A real IRC client, one connection per app, in main. It exists
whether or not any game is open; the panel is a view onto it. Channels: a
lobby (`#04scape`) always, plus one per server (`#04scape-zanaris`,
`#04scape-lostcity`, `#04scape-labs`) joined while a window for that server is
open. The prefix matters on a public network, where bare names like
`#zanaris` may already belong to someone else. First version:
connect over TLS, join, say, `/me`, `/msg`, `/nick`, a nick list, highlight
notifications with a rail badge. Reconnect with backoff. The protocol layer
is a hand-written parser and serializer for the dozen commands and numerics
needed (NICK, USER, JOIN, PART, PRIVMSG, PING/PONG, NAMES, QUIT; 001, 353,
366, 433), tested as pure functions. No DCC, no CTCP beyond VERSION, no
scripting. Server, port and nick live in settings. The default is Libera.Chat
(`irc.libera.chat`, port 6697, TLS); the nick is the user's choice and is
asked for the first time the panel opens. Registering it with NickServ is an
ordinary `/msg`; SASL is added only if a channel turns out to need it.

**Timers** (app). Named countdowns with absolute end times, persisted to
`<userData>/timers.json` so they survive a restart. The panel lists them and
adds new ones from a label and a duration, with presets of 1, 5, 10 and 30
minutes plus any from the data pack. A timer that fires posts a system
notification and badges the rail icon in every window until acknowledged.

**Screenshot** (instance). `capturePage()` of the window's game view, written
to `<Pictures>/Zanaris Kit/<server-id>/<ISO timestamp>.png`, confirmed by a toast
in the shell. Rail icon and shortcut. This is the same call capture mode
already uses.

**Wiki** (server). Not a panel: the `+` tab, the address row and the search
box are the wiki tool. The `+` opens a menu of the server's `bookmarks`
(for Lost City: the LostHQ guides, clue coordinator, world map, markets, item
database) plus "New tab" at the wiki home. Page tabs use the app-wide
`persist:pages` partition, so a wiki login is shared by every window, and
each page tab keeps its own zoom factor (Cmd/Ctrl + and -, remembered per
URL).

**Hiscores** (server). A panel with a name box, shown only for servers whose
catalog entry has a `hiscores` API. Lost City's returns JSON per player; a
second name box compares two players side by side.

**Map** (server). An action: opens the server's `map` URL as a page tab, or
focuses it if it is already open. Hidden from the rail when the server has no
map.

**Clue lookup** (server). A panel with a search box over the data pack's clue
steps. Without a pack it shows a single "Search the wiki" button that opens a
page tab with the query.

**Calculators** (server). A panel with two tabs. XP: level from XP and XP to a
target level, from the standard table, which does not vary by revision. Max
hit: melee, from strength level, strength bonus, prayer and potion
multipliers and attack style, entered by hand. Equipment lookup by name needs
the data pack and comes later.

**Settings** (app). IRC server and nick, screenshot folder and shortcut,
always-on-top per window, and the server list itself: add, edit and remove
entries, including worlds, bookmarks, map URL and extra hosts.

**Notes** (app). A plain text pad, saved as it is typed. Cheap, and the one
LostKit tool people reach for constantly.

## New windows

At startup the app opens the first server in the catalog (in capture mode,
all of them). Every New Window creates a new server window; focusing an
existing one is done from the OS. On macOS the app keeps running with no
windows, and Cmd/Ctrl+N or the dock menu opens one; elsewhere closing the
last window quits, as the menu lives in the window.

Each server window gets a storage partition `persist:server:<id>` for its
first instance and `persist:server:<id>:<n>` for the n-th concurrent
instance, so two accounts on one server never share cookies or client prefs.
Slot numbers are reused once a window closes.

## Process and IPC

- Main holds: the catalog, the window registry (window id to server def,
  tabs, panel state), the IRC client, the timer store, settings, data packs.
- Each shell talks to main through one typed API exposed by the preload, in
  namespaces: `window` (server def, tabs list/open/activate/close/navigate,
  panel open/close, screenshot), `chat`, `timers`, `catalog`, `settings`.
  Every subscription returns an unsubscribe.
- Main pushes app-scoped state to every shell and window-scoped state to the
  owning shell. Shells hold no state that main does not also hold.
- Game and page views have no preload and no IPC. Page titles reach the strip
  through `page-title-updated`; navigation state through `did-navigate`.

## Navigation rules

- The game tab's view accepts no page-initiated navigation at all: links,
  `location` changes, form submits and mouse back and forward gestures are
  blocked, and http(s) targets open in the system browser. The only way the
  game view changes page is main calling `loadURL`, which is how the Worlds
  tool switches. LostKit arrived at the same rule for the same reason: a stray
  click must never cost a login.
- The game view's context menu is suppressed, since Chromium's default one
  carries Back, Forward and Reload.
- A page tab's view may navigate within any host in the server's `hosts`.
- Anything else, and any `window.open`, goes to the system browser.
- Downloads are refused.
- Every view: `contextIsolation`, `sandbox`, `webSecurity` on;
  `nodeIntegration` off.

## Persistence

| What | Where | When |
|---|---|---|
| Catalog | `<userData>/servers.json` | on every edit |
| Timers | `<userData>/timers.json` | on every edit |
| Settings | `<userData>/settings.json` | on every edit |
| Last world and detail per server | `<userData>/state.json` | on every switch |
| Screenshots | `<Pictures>/Zanaris Kit/<server-id>/` | on capture |
| Game and page storage | Chromium partitions | by Chromium |

Open page tabs are not restored across launches in this design; that is a
listed follow-up.

## Error handling

- Game page fails to load: the offline page with auto-retry, as today.
- Page tab fails to load: the same offline page with the page's URL, no
  auto-retry, a "Try again" button.
- IRC drops: the chat panel shows "Reconnecting…" with the attempt count;
  messages typed meanwhile are refused with a note, not queued.
- Screenshot write fails: the toast says so with the path.
- A catalog file that fails to parse is renamed aside and the defaults are
  written; a message box says this happened.
- A data pack missing for a revision is not an error.

## Testing

Pure modules under `node --test`, no Electron:

- Catalog: validation, host derivation, slot allocation and reuse.
- Tab model: pinned game tab, open/activate/close ordering, which tab becomes
  active when the active one closes.
- Layout: rects for strip, address row, content, panel and rail from window
  size, panel state and active tab kind; widen versus shift versus push.
- IRC: parser and serializer round-trips, numeric handling, the join and
  reconnect state machine driven by fake socket events.
- Timers: firing, persistence round-trip, acknowledgement.
- Calculators: known XP table values and known max-hit cases.

Electron, through capture mode: open a server window, open a wiki tab, open
the chat panel, screenshot each state; open two windows of one server and
confirm distinct partitions.

## Milestones

1. **Server windows and the strip.** Catalog file, the File menu, one server
   window per open with the pinned game tab, empty rail, layout engine with
   widen, shift and push. Capture mode covers it.
2. **Worlds.** The catalog's `worlds` block and the three source adapters,
   the Worlds tool as the first rail tool with the detail switch and latency,
   last world remembered per server, the tightened game-view guard and
   context-menu suppression. Capture mode switches a world to prove it.
3. **Page tabs.** `+` with bookmarks, address row, wiki search, map action,
   per-server host allowlist, per-tab zoom, offline page for pages.
4. **Shared tools.** Screenshot (cropped to the canvas, folder, shortcut),
   timers with the AFK reset, notes, settings, always-on-top.
5. **Chat.** IRC client, panel, channels per server, badges.
6. **Server tools.** Hiscores, clue lookup and calculators, with the data pack
   loader and the first packs.
7. **Follow-ups**, in no committed order: restore page tabs per server, pop a
   page tab out to its own window, the observe-only tap from `main` feeding an
   XP tracker as an instance tool, equipment-aware max hit, a market price
   watch for Lost City, packaging and auto-update.

## Reference: LostKit 2

LostHQ's LostKit 2 (https://github.com/LostHQ/LostKit-Electron, GPL-3.0,
v2.8.0 as of 2026-08-15) is a mature Electron client for Lost City with most
of the per-client tools this design wants. It was studied for features and
behaviour; none of its code is used, because its licence would bind ours.

Its architecture is one window with `WebContentsView`s: a nav panel (full
or strip width; opening a built-in tool widens the window to the right and
shifts left at the screen edge, the same rule as our layout engine), a game
view with an injected preload, a chat view loading LostHQ's hosted web IRC
client, and one view per reference-page tab. Tabs reorder, detach to their
own window, and are restored at launch.

| LostKit feature | How it does it | Zanaris Kit |
|---|---|---|
| World switcher | LostHQ world API, free/members filter, HD checkbox, per-world latency by HEAD fetch, last world remembered, window title "W2 HD \| 43ms" | Worlds tool, per server through adapters; same API for Lost City; latency by TCP connect from main; last world and detail per server; tab label and title carry the world |
| Game-view guard | Blocks all page-initiated navigation and the context menu | Adopted as written |
| Reference pages | Nav buttons open LostHQ guides, clue coordinator, world map, markets, item database as tabs; per-tab zoom; detach; restore | Page tabs seeded from per-server `bookmarks`; per-tab zoom; pop-out and restore are follow-ups |
| Chat | Embeds `https://irc.losthq.rs` (a bundled web client; no public IRC port found) in a resizable bottom pane | Native IRC on Libera in the panel; LostHQ's client can be a bookmark in the meantime |
| Screenshot | Injected preload draws the canvas to a data URL; folder, global shortcut, sound | `capturePage` from main cropped to the canvas rect, which the stock page places at a known offset; folder and shortcut; no injection |
| Stopwatch and AFK timer | Countdown and stopwatch in main; AFK reset from clicks, hover and keys reported by the preload; sound alert; overlay window; title-bar readout | Timers tool; AFK reset from `webContents` input events observed in main, no injection; title-bar readout; overlay is a follow-up |
| Hiscores and compare | `2004.lostcity.rs/api/hiscores/player/{name}` | Hiscores tool for servers with an API |
| Price watch and history | Scrapes markets.lostcity.rs, notifications | Follow-up, Lost City only |
| Notes, always-on-top, zoom | Local notes window; per-window flag; Ctrl+wheel via preload | Notes tool; always-on-top in settings; zoom by shortcut, wheel only if observable without injection |
| Creators, sound manager, fonts | YouTube live and RSS polling; sound picker; RuneScape fonts injected into tool pages | Not planned |
| Updates and packaging | electron-forge and electron-builder, squirrel and AppImage, silent auto-update | Follow-up |

The two things LostKit does that this design refuses on principle are
injecting a preload into the game page (its screenshot, zoom and AFK detection
depend on it) and loading the game with `webSecurity: false`. Every
equivalent here is done from main or not at all.

## Decisions

Settled on 2026-09-05:

1. **IRC server: a public network.** Libera.Chat by default, channels under
   the `#04scape` prefix. No server of our own to run.
2. **Revisions.** Zanaris W1 and Lost City W5 are rev 274. Lost City Labs W1
   is unknown; their own description is "May 2005", kept as the entry's note.
   Local is whatever `engine/data/config/world.json` says, 289 at the time of
   writing.
3. **Wiki per server.** losthq tracks rev 274 today and is the wiki for both
   274 servers. Labs has none until its revision is known. A server without a
   wiki gets no `+` default, and its address row still accepts a URL on an
   allowed host.
4. **Worlds before page tabs.** The world switcher is the first tool, on the
   losthq API for Lost City, with low detail as the default and no
   confirmation on switch.

## Out of scope

Modifying or injecting into game pages. A general-purpose browser (only
allowed hosts). Reading client memory or DOM. Multi-account automation of any
kind. World-anchored overlays (camera state is never transmitted; see the v1
README on `main`).
