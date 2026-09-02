# SwiftKit for 04scape

An Electron wrapper around the Lost City / 2004scape web client.

**Status: v1 — walking skeleton.** It proves the client survives being wrapped and that
an observer can attach to it without modifying it. There are no overlays, no launcher,
and no packaging yet.

## Why it's built this way

The long-term goal is SwiftKit/RuneLite-style QoL overlays. The constraint that shapes
everything is that we must **not modify the client**, because a modified client is both
the most detectable thing we could ship and the most likely to be against server policy.

So SwiftKit observes rather than injects. It uses the Chrome DevTools Protocol
(`Network.webSocketFrameSent` / `webSocketFrameReceived`) to watch the game socket from
outside the page. Nothing is injected into the page — there is no preload script and no
main-world code at all. The client that runs is byte-for-byte the client the server served.

This was chosen over the more obvious approach of monkeypatching `window.WebSocket` from
a preload, which would have had to fight Electron's isolated-world boundary and would
have put our code in the data path.

## Running it

Requires the game server to be running (`node start.js` in the parent directory →
*Start Server*).

```sh
npm start           # build + launch
npm run seam:off    # launch with the tap disabled (also re-enables DevTools)
```

The target URL is derived from `engine/data/config/world.json` → `web.port`, never
hardcoded. `start.js:161-165` hardcodes port 80 on macOS and Windows and so opens the
wrong URL; reading the config avoids repeating that bug.

Override the server location with `SWIFTKIT_SERVER_ROOT` if SwiftKit isn't at
`<serverRoot>/swiftkit`.

## What v1 verified

| Check | Result |
|---|---|
| Port resolved from `world.json`, not assumed | 8888, read from config |
| Client renders under Electron (Canvas 2D + `putImageData`) | works |
| On-demand cache loads (Web Worker + its own WebSocket + IndexedDB) | works |
| Login and play — input handling intact | works |
| Seam attaches and observes frames | works — see below |

Tap output during play:

```
[tap] socket opened: ws://127.0.0.1:8888/
[tap] socket classified: game (first client byte 14)
  game     tx     64 frames /       607 B   rx    452 frames /      2284 B
```

### Finding: the tap sees the game socket only

Only one socket appears — the game socket, identified by the client's first byte being
`14` (`engine/src/engine/World.ts:2103`). The on-demand cache socket (first byte `15`)
is created *inside a Web Worker*, which is a separate CDP target, so the page-level tap
never sees it.

This is the desired outcome rather than a limitation: the cache socket carries no game
state, and not observing it means no cycles spent on asset traffic. If it is ever needed,
it requires attaching to the worker target separately.

### Not yet verified

*No wire impact.* CDP's Network domain is a passive observer by construction and nothing
is injected, so there is no mechanism by which it could alter traffic — but a controlled
with/without comparison has not been run. `npm run seam:off` exists for that.

## Layout

```
src/main/main.ts       app lifecycle, window, nav guards, offline handling
src/main/serverUrl.ts  resolves serverRoot + web.port from world.json
src/main/tap.ts        CDP WebSocket tap — counts frames, classifies sockets
static/offline.html    shown while the server is down; auto-connects when it comes up
```

Security posture: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
`webSecurity: true`. Navigation is restricted to the configured localhost origin;
everything else opens in the system browser. The game page gets its own persistent
session partition so its `localStorage` prefs and IndexedDB asset cache survive relaunch.

## Known constraints

**World-anchored overlays are not possible.** Camera position, yaw, pitch and zoom are
purely client-local and never transmitted, so there is no way to project world
coordinates to screen space. RuneLite-style entity highlighting, tile markers, hover
outlines and minimap markers are all out of reach — overlays must be screen-anchored
HUD panels. XP tracker, skill panel, chat log, run energy/weight, position readout and
inventory are all fine.

**The wire carries item ids, not names.** Names, icons and examine text live in the
cache archives. Any useful inventory overlay needs a separate cache reader
(fetch `/config:crc<n>` over HTTP and parse `obj.dat`) — a distinct module, not part
of the state layer.

**Anything touching the client's own objects would be a separate, opt-in tier.** The
state layer must never depend on it. Reading the wire is observation; reaching into
client internals is the thing most likely to read as a cheat client to a human
reviewer, regardless of what it's used for.

## Next

1. **Game-state layer** — recover the ISAAC seed, decode rev-289 packets behind a
   revision seam, emit typed events. Opcodes are ISAAC-obfuscated in both directions
   (`engine/src/engine/entity/NetworkPlayer.ts:205-206`); payload bodies are plaintext.
   Two of the four seed words arrive in plaintext (the server's 8-byte session seed);
   the other two come from adjacent `Math.random()` calls in `Client.login`, so they
   are recoverable by observing the RNG through the login window — no server private
   key needed, which is what makes this work against servers we don't control.
2. **Overlays** — XP tracker first (`UPDATE_STAT`, opcode 154).
3. **Launcher** — GUI over what `start.js` does.
4. **Non-localhost servers** — gated on resolving third-party-client policy with the
   Lost City team, not on any technical milestone.
