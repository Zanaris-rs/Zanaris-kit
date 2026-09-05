# SwiftKit: server windows, a page strip, and shared tools

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
| Launcher | 0..1 | the way to pick a server and open a new server window |

A server window is created for exactly one catalog entry and never changes
server. Its title is the server's name; a second window for the same server is
"Zanaris W1 (2)".

Tools have a **scope**, and the scope decides where their state lives:

| Scope | Examples | State lives in | Shown in |
|---|---|---|---|
| app | chat, timers, settings | main, once | every window, identically |
| server | wiki, map, clue lookup, calculators | main, keyed by revision | the windows of that server, with that server's data |
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
| New server window (launcher) | Cmd/Ctrl+N | File menu, dock |
| New page tab | Cmd/Ctrl+T | `+` on the strip |
| Close page tab | Cmd/Ctrl+W | `x` on the tab |
| Close window (game tab active) | Cmd/Ctrl+W | confirms: "Close Zanaris W1? You'll be logged out." |
| Switch tab | Cmd/Ctrl+1..9 | click |
| Toggle panel | Cmd/Ctrl+\ | rail icon |
| Screenshot | Cmd/Ctrl+Shift+S | rail icon |

## Server catalog

Stored at `<userData>/servers.json`, seeded from the built-in list on first
run, edited from the launcher.

```ts
interface ServerDef {
    id: string;          // slug, stable, used for partitions and folders
    name: string;        // "Zanaris — World 1"
    url: string;         // the game page
    revision: number | null;  // 274, 289 …; null when the server does not say
    notes: string | null;     // shown in the launcher, e.g. "May 2005 per Lost City Labs"
    wiki: {              // optional
        home: string;    // "https://2004.losthq.rs/"
        search: string | null;  // search URL with {query}; null when the site has no known search endpoint
    } | null;
    map: string | null;  // a URL the map tool opens as a page tab
    hosts: string[];     // extra hosts page tabs may visit; always includes the game and wiki hosts
}
```

The launcher's add form asks for name, game address, revision (which may be
left unknown), an optional wiki address and a note; `hosts` is derived and
`map` is left for the settings panel.
Removing a server that has open windows is refused.

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
to `<Pictures>/SwiftKit/<server-id>/<ISO timestamp>.png`, confirmed by a toast
in the shell. Rail icon and shortcut. This is the same call capture mode
already uses.

**Wiki** (server). Not a panel: the `+` tab, the address row and the search
box are the wiki tool. Page tabs use the app-wide `persist:pages` partition,
so a wiki login is shared by every window.

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

**Settings** (app). IRC server and nick, screenshot folder, and per-server
fields the add form left out (map URL, extra hosts).

## Launcher

A single window, shown at startup, on Cmd/Ctrl+N, from the File menu, and
again whenever the last server window closes. It lists the catalog with each
entry's revision, wiki status and how many windows are open, an "Open" button
per entry ("Open another" when one is already open), and the add-server form.
Opening from the launcher creates a new server window every time; focusing an
existing window is done from the OS, not the launcher.

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

- The game tab's view may navigate only within the game page's origin.
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
| Screenshots | `<Pictures>/SwiftKit/<server-id>/` | on capture |
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
  written; the launcher says this happened.
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

1. **Server windows and the strip.** Catalog file, launcher, one server window
   per open with the pinned game tab, empty rail, layout engine with widen,
   shift and push. Capture mode covers it.
2. **Page tabs.** `+`, address row, wiki search, map action, per-server host
   allowlist, offline page for pages.
3. **Shared tools.** Screenshot, timers, settings.
4. **Chat.** IRC client, panel, channels per server, badges.
5. **Server tools.** Clue lookup and calculators, with the data pack loader
   and the first packs.
6. **Follow-ups**, in no committed order: restore page tabs per server, pop a
   page tab out to its own window, the observe-only tap from `main` feeding an
   XP tracker as an instance tool, equipment-aware max hit.

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

## Out of scope

Modifying or injecting into game pages. A general-purpose browser (only
allowed hosts). Reading client memory or DOM. Multi-account automation of any
kind. World-anchored overlays (camera state is never transmitted; see the v1
README on `main`).
