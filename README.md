# SwiftKit for 04scape

An Electron client that opens several 04scape servers at once, one window per
server, where every window knows which server it is running.

**Status: milestone one of the server-windows design.** The launcher, the
catalog, and a server window with the pinned game tab, an empty rail, a
toggleable panel and the widen / shift / push layout engine. Page tabs, chat,
timers, screenshots and the server tools follow in later milestones. The design
is in `docs/superpowers/specs/2026-09-05-server-windows-design.md` and the plan
this milestone followed in `docs/superpowers/plans/2026-09-05-milestone-1-server-windows.md`.

## What it does

The **launcher** lists the catalog and opens a server in a new window, every
time you ask. It appears at startup, on Cmd/Ctrl+N, from the File menu, and
again whenever the last server window closes. The add form takes a name, a
game address, an optional revision, an optional wiki address and a note.

A **server window** is bound to one catalog entry for its whole life. Its tab
strip starts with the pinned game tab, labelled with the server's name and
revision ("rev unknown" when the catalog has none). A rail runs down the right
edge and a panel opens beside it (Cmd/Ctrl+\ or the button at the end of the
strip). The rail is empty and the panel is a placeholder in this milestone; the
point of building them now is that the layout engine underneath them is done.
Closing a window asks first, because it logs you out.

Opening the same server twice gives the second window its own storage
partition (`persist:server:<id>:2`) and the title "Name (2)", so two accounts
on one server never share cookies or client prefs. Slot numbers are reused
once a window closes.

Nothing is injected into a game page: no preload, no main-world code. The page
that runs is byte-for-byte the page the server served. A modified client is
both the most detectable thing we could ship and the most likely to be against
server policy.

## Why a window keeps playing when it is not in front

All three hosted clients drive their main loop with `setTimeout`; none of the
served bundles contain `requestAnimationFrame`, and `visibilitychange` is used
only to resume audio. Chromium throttles timers in a background window to once
a second, which would stall any game you were not looking at.
`backgroundThrottling: false` on each game view turns that off.

## The catalog

`<userData>/servers.json` (on macOS, `~/Library/Application Support/swiftkit/`),
seeded on first run:

| id | server | revision | wiki |
|---|---|---|---|
| `zanaris-w1` | `https://w1.04.zanaris.rs/rs2.cgi?lowmem=1` | 274 | losthq |
| `lostcity-w5` | `https://w5-2004.lostcity.rs/rs2.cgi?plugin=0&world=5&lowmem=1` | 274 | losthq |
| `lostcitylabs-w1` | `https://www.lostcitylabs.com/play/world-1/` | unknown, "May 2005 per Lost City Labs" | none |
| `local` | `http://127.0.0.1:8888/rs2.cgi?lowmem=1` | 289, as `engine/data/config/world.json` sets it | none |

Each entry also carries `hosts`, the hosts its page tabs may visit (always the
game host and the wiki host), and a `map` URL for the map tool. A wiki is
stored as a URL; nothing claims which revision it describes, since losthq moves
on its own schedule. LostHQ has no discoverable search endpoint (its
`index.php?search=` returns the homepage), so `wiki.search` is null for it.

A file that cannot be read is renamed to `servers.json.broken-<timestamp>` and
the defaults are written in its place; the launcher says so. Removing a server
is refused while it has open windows.

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
npm test             # the pure modules: layout, catalog, slots, tabs, window registry
npm run typecheck
npm run capture      # open every server, screenshot every view into captures/, exit
```

Capture mode (`SWIFTKIT_CAPTURE=<dir>`, settle time `SWIFTKIT_CAPTURE_WAIT` in
ms, default 15000) writes each window's shell and game views separately,
because a window's own webContents holds nothing when its content lives in
child views. It then opens the panel on a window whose game loaded and captures
it again, and opens a second instance of that server. A view that has no frame
yet is skipped rather than allowed to abort the run.

## Verified

One capture run with every catalog server open at once:

| window | game | shell |
|---|---|---|
| Zanaris — World 1 | the host was down at the time (`ERR_CONNECTION_TIMED_OUT`); offline page | strip with the game tab, "rev 274" |
| Lost City — World 5 | login screen | strip, "rev 274" |
| Lost City Labs — World 1 | login screen | strip, "rev unknown" |
| Local server | offline page, `ERR_CONNECTION_REFUSED`, auto-retry | strip, "rev 289" |
| Lost City — World 5, panel open | login screen, untouched | panel beside the rail; mode **shift**, because the cascaded window sat near the screen edge |
| Lost City — World 5 (2) | login screen | slot 2, `persist:server:lostcity-w5:2` |

Fifty tests cover the pure modules: layout (widen, shift, push, rects tiling
the window), catalog (validation, defaults, file recovery), slots (reuse,
partition and title naming), tabs (pinned game tab, close activates the left
neighbour) and the window registry.

## Security posture

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
`webSecurity: true` on every view. The game view navigates only within its
server's origin; any other navigation, and any `window.open`, goes to the
system browser rather than replacing the game. The preload exposes exactly the
launcher and shell calls in `src/shared/ipc.ts`, and IPC handlers identify a
window from `event.sender`, never from a value the renderer supplies.

## Layout of the source

```
src/shared/layout.ts     geometry constants shared by main and the shell
src/shared/catalog.ts    ServerDef and the add-form input
src/shared/ipc.ts        channel names and payload types
src/main/layout.ts       pure: window and view rects; widen / shift / push     (tested)
src/main/catalog.ts      pure validation; the servers.json store               (tested)
src/main/slots.ts        pure: slot numbers, partitions, titles                (tested)
src/main/tabs.ts         pure: the pinned game tab and page tabs               (tested)
src/main/windows.ts      pure: registry of open windows over a factory         (tested)
src/main/serverWindow.ts one server window: shell view over game view
src/main/launcher.ts     the launcher window
src/main/menu.ts         application menu and shortcuts
src/main/renderer.ts     preload path; load the renderer as launcher or shell
src/main/index.ts        wiring, IPC handlers, capture mode
src/preload/index.ts     the window.swiftkit bridge
src/renderer/Launcher.tsx, Shell.tsx, main.tsx, styles.css
static/offline.html      shown when a server can't be reached
```

## Where v1 went

`main` keeps the observe-only CDP tap, ISAAC seed recovery, session decoder,
XP tracker and the original sidebar. The uncommitted work from just before the
reset (the six-hour recorder and the reload button) is parked in `git stash`
on `main`.

## Next

2. **Page tabs.** `+`, the address row, wiki search, the map action, the
   per-server host allowlist, an offline page for pages.
3. **Shared tools.** Screenshot, timers, settings.
4. **Chat.** IRC on Libera.Chat, channels under the `#04scape` prefix.
5. **Server tools.** Clue lookup and calculators, with the data pack loader.
