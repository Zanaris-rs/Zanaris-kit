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

## Experience capture

The Experience tab reads XP straight off the game socket — one line per skill, the XP
gained this session, and a total. No rates, no timing.

How it works: the server's `UPDATE_STAT` (opcode 154, 6 bytes: `stat u8, xp u32, level
u8`) carries `exp / 10 | 0` while the engine stores XP x10, so the transmitted value is
the exact displayed XP. The burst the server sends at login sets the baseline; everything
after is a gain.

Three things make the numbers trustworthy rather than plausible:

1. **ISAAC is tested against the engine's own implementation**, not a fixture, across
   10k draws including the int32 wraparound the `+50` decrypt seed causes.
2. **The packet table is generated and cross-checked.** 69 prots from the engine source,
   all 69 matching the client's own baked-in length table — the array the client actually
   frames with. `npm test` re-runs the generator and diffs, so an engine pull that shifts
   the protocol fails loudly instead of silently producing wrong numbers.
3. **The seed is verified, not assumed.** Candidates are tested by framing the real
   stream and requiring six consecutive valid packets; a wrong seed hits an unknown
   opcode almost immediately.

Verified in a live session: the seed recovered from `Math.random` alone was bit-identical
to the one decrypted from the login block with the server's private key
(`oracle cross-check: MATCH`), with zero desyncs over ~1,000 packets.

**Wrong numbers are worse than no numbers.** An unknown opcode stops decoding rather than
guessing past it, and the tab shows the reason instead of stale figures.

## Sidebar

A 48px rail is always visible on the right edge; opening expands it to 328px and
**widens the window** by the difference, so the game area stays pixel-identical either
way. The game view's bounds never change.

That is the point of the design rather than a detail: recreating or reloading the game
view would cost the asset cache, the login and the ISAAC session. So the window hosts
two `WebContentsView`s and the main process owns all layout — the game is never
re-parented, and hiding is geometry only.

Widening isn't always possible. Maximised, fullscreen, or hard against a screen edge,
the layout first tries shifting the window left and then falls back to `push` mode,
where the game area shrinks instead. The active mode is reported to the UI and stated
in the panel rather than silently substituted.

`src/main/layout.ts` is a pure function, so all of this is tested without launching
Electron (`npm test`). The behavioural check that matters is different and objective:
toggle the sidebar while logged in and watch the tap output — frame counters must stay
monotonic and `socket closed` must never appear. If the game view were being recreated,
the log would say so.

### Seeing it

`SWIFTKIT_CAPTURE=<dir> npm start` renders the sidebar to PNGs and exits — the collapsed
rail, the empty panel, and a populated panel driven by a synthetic snapshot.

It uses `webContents.capturePage()`, which captures page content rather than the screen,
so it works regardless of which Space the window is on, whether it is occluded, or where
it sits. Screen-level capture (`screencapture -R`) cannot do this and will silently give
you the desktop instead.

For automated UI testing later, Playwright supports Electron via `_electron.launch()` —
but note `app.windows()` enumerates `BrowserWindow` webContents, and the sidebar lives in
a `WebContentsView` child, so it would need `app.evaluate()` to reach the main process.
WebdriverIO with `wdio-electron-service` is the maintained alternative. Spectron is
archived; don't reach for it.

Visual approach: the panel sits flush against a software-rasterised canvas with
`image-rendering: pixelated`, so it is flat and square-cornered with 1px hairlines and
no shadows or gradients — instrumentation beside pixel art, not chrome on top of it.
Monospace is confined to the live numeric readouts, where tabular figures stop digits
jittering as counters tick.

## Spike result: ISAAC seed recovery (verified)

The seed for the ISAAC keystream is **fully recoverable without the server's private
key**, which is what makes a state layer possible against servers we don't run.

Two of the four seed words arrive in plaintext — they are the server's 8-byte session
seed, sent unencrypted before the login block. The other two are
`Math.floor(99999999 * Math.random())`, drawn by two adjacent calls in `Client.login`.
Observing `Math.random` through the login window recovers them.

Verified against ground truth by RSA-decrypting the real login block with the server's
private key (an oracle for testing only, never a shipping dependency):

```
[1] RSA magic byte    : 10 OK (decrypt correct)
[2] seed[2],[3]       : 12931227, 1753455222
    vs plaintext wire : MATCH — 2 of 4 words need no recovery
[3] seed[0],[1]       : 33158998, 99859750
    found in RNG ring : YES at draw #755782 of 755784
```

**The two draws are the last two before the login block is sent.** The login screen
animation stalls while `Client.login` awaits the socket, so nothing else consumes the
RNG in between. Recovery is therefore reading the tail of the ring, not searching it —
though the consecutive-pair search stays as a fallback should timing ever shift.

Scale note: the login screen burns ~200 `Math.random()` calls per frame (755,784 draws
in one session), so the observer ring must be sized for that. It is 65536 entries.

Two environment traps worth knowing:

- **Electron ships BoringSSL, not OpenSSL.** `crypto.createPrivateKey()` rejects these
  keys with `BAD_E_VALUE` because the RuneScape convention uses a huge public exponent.
  The same code works in plain Node. `rsa.ts` parses the PKCS#8 DER by hand to avoid
  the validation entirely.
- **CDP commands never resolve against a `BrowserWindow` with nothing loaded** — there
  is no renderer to service them. Load `about:blank` first, then register the
  document-start script, then navigate.

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
