# SwiftKit for 04scape

An Electron client that opens several 04scape servers at once — each in its own
window, each kept running while you play the others.

**Status: multi-server reset.** This branch steps back from the v1 wrapper (the
observe-only CDP tap, ISAAC seed recovery, XP decoder and sidebar — all still on
`main`) to the cheapest thing that can load more than one *kind* of server. The
overlay work comes back on top of this later; the point right now is one client
that can open our own fleet, upstream Lost City and Lost City Labs, together.

## What it does

The launcher lists the built-in servers and opens each in its own window:

| id | server |
|---|---|
| `zanaris-w1` | `https://w1.04.zanaris.rs/rs2.cgi?lowmem=1` |
| `lostcity-w5` | `https://w5-2004.lostcity.rs/rs2.cgi?plugin=0&world=5&lowmem=1` |
| `lostcitylabs-w1` | `https://www.lostcitylabs.com/play/world-1/` |
| `local` | `http://127.0.0.1:8888/rs2.cgi?lowmem=1` |

Any other address can be typed in. A missing scheme is read as https; anything
that is not http(s) is refused, so a window can never be pointed at `file:` or
`javascript:` content. The same address always maps to the same window.

At most one window per server: opening an open server focuses it. Each window
has its own persistent partition (`persist:server:<id>`), so logins, cookies,
client prefs and the IndexedDB asset cache never bleed between servers and
survive relaunch.

Nothing is injected into a game page — no preload, no main-world code. The page
that runs is byte-for-byte the page the server served. That constraint carries
over from v1 unchanged: a modified client is both the most detectable thing we
could ship and the most likely to be against server policy.

## Why windows rather than tabs

"Play all three at once" means all three keep running, and you can *see* more
than one. Tabs would hide two of them. Separate `BrowserWindow`s tile across
monitors however you like, and nothing is shared between them.

## Why a window keeps playing when it is not in front

All three clients drive their main loop with `setTimeout` — none of the served
bundles contain `requestAnimationFrame`, and `visibilitychange` is used only to
resume audio. Chromium throttles timers in a background window to once a second,
which would stall any game you were not looking at. `backgroundThrottling: false`
on each window turns that off, so the loop runs at full rate whether the window
is in front, behind another, or on a different Space.

## Running it

```sh
npm start            # build + launch
npm test             # the pure modules: url handling, window registry
npm run typecheck
npm run capture      # open every server, screenshot each window into captures/, exit
```

`SWIFTKIT_CAPTURE=<dir>` is what `npm run capture` sets; `SWIFTKIT_CAPTURE_WAIT`
overrides the settle time in milliseconds (default 15000). `capturePage()` captures
page content rather than the screen, so overlapping windows don't matter.

## Verified

Two capture runs, all four built-in servers opened together:

| Run | Zanaris W1 | Lost City W5 | Lost City Labs W1 | Local |
|---|---|---|---|---|
| Cold cache, 15s settle | title screen, "Loading animations — 94%" | title screen, "Unpacking textures" | login screen, "31 players online" | offline page, `ERR_CONNECTION_REFUSED` |
| Warm cache, 30s settle | login screen, "Loading extra files" | login screen, "Loading extra files" | login screen | offline page |

The second run's caches came from the first, so the partitions persist. All
three remote clients rendered and advanced while three other windows were open
on top of them, which is the property that matters.

## Security posture

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
`webSecurity: true` on every window. A game window navigates only within its own
server's origin; any other navigation, and any `window.open`, goes to the system
browser rather than replacing the game. The launcher's preload exposes exactly
four calls: list, open, open-url, on-state.

## Offline

When a server's page fails to load, the window shows `static/offline.html` with
the reason, retries with a no-cors probe every five seconds, and reloads the
server the moment something answers. That is the local-server case: start it,
and the window connects on its own.

## Layout

```
src/main/servers.ts     built-in list, url parsing, partition naming     (tested)
src/main/registry.ts    which servers have a window; open / focus / close  (tested)
src/main/gameWindow.ts  one BrowserWindow per server: nav guard, offline page, throttling off
src/main/index.ts       launcher window, IPC handlers, capture mode
src/preload/index.ts    the launcher's bridge to main
src/renderer/App.tsx    launcher UI
static/offline.html     shown when a server can't be reached
```

The registry takes its window factory by injection, so both tested modules run
under `node --test` without Electron.

## Known

- **Lost City Labs' navbar is same-origin.** Its Main Menu / World Select links
  navigate the game window away, exactly as they would in a browser. Reopen from
  the launcher.
- **Lost City sends `frame-ancestors`.** It would refuse to be iframed, which is
  one reason this is windows, not iframes in one page.
- **The local entry assumes port 8888.** v1 read `engine/data/config/world.json`
  for the port; this branch does not. Type the address if yours differs.
- **Custom addresses are per run.** They are not remembered across launches yet.

## Where v1 went

`main` keeps the CDP tap, ISAAC seed recovery, decoder, XP tracker and sidebar.
The uncommitted work from just before this reset — the six-hour recorder and the
reload button — is parked in `git stash` on `main`.

## Next

1. Re-attach the observe-only tap from `main`, one per game window.
2. Remember custom servers across launches.
3. Packaging.
