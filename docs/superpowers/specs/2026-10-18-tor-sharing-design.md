# Sharing over Tor

Home server can be shared today through a Cloudflare quick tunnel
(`src/main/share/`). This adds a second way: a Tor onion service, which
friends open in Tor Browser. It is an alternative, not a replacement:
Cloudflare stays the default, quickest and most convenient way.

## Why

The owner likes open source tools, and Tor is one: an alternative to a
company's network, with some anonymity in it. That is the whole reason. Tor
is slower than Cloudflare and asks more of friends, and the owner chose it
knowing that.

## Goals

- A **Share over Tor** button beside **Share** in Home server's Sharing
  section, giving an `http://<56 letters>.onion/rs2.cgi` link.
- The player chooses, per share, between two onion modes:
  - **Hide me** — a full onion service: six relays, the host's address
    hidden from everyone. Slower.
  - **Faster** — a single onion service (`HiddenServiceSingleHopMode`,
    `HiddenServiceNonAnonymousMode`): about three relays. Friends are still
    hidden; the host's address is not hidden from the relays it talks to.
- Every security property the Cloudflare share has holds for the Tor one
  (below).
- Friends are told, on the live link's panel, that it opens only in Tor
  Browser, and that Tor Browser's **Safest** setting stops the game from
  loading because it switches off JavaScript, which the game needs.

## Non-goals

- Two shares at once. One share at a time, Cloudflare or Tor (the owner's
  call). While either is on its way, live or failed, the other's button is
  not offered.
- Using a Tor or cloudflared already on the system. The kit uses only the
  build it pins, as cloudflared does today (the owner agreed).
- A lasting onion address, or Tor client authorization. Every share gets a
  fresh address, so a link ends when the share does, as today.
- Starting Tor before Share over Tor is pressed. Considered for a quicker
  link, left out: it would put Tor on the network for players who never use
  it.
- Linux on ARM. Tor Project publishes no Expert Bundle for it; there Share
  over Tor is not offered and Cloudflare is.

## Anti-goals

Any of these would make it a failure even if a link appeared:

- A link shown before it works through Tor.
- Anything other than the world's web port, through the relay, reachable
  over the onion address.
- Running a Tor whose files were not checked against the kit's pins on that
  share, or one that read any configuration the kit did not write.
- A Tor process outliving the kit.
- Friends left guessing why the page is blank in Tor Browser.

## What we know (measured 2026-10-18)

- Tor Project publishes the **Tor Expert Bundle** per release at
  `https://archive.torproject.org/tor-package-archive/torbrowser/<ver>/tor-expert-bundle-<platform>-<ver>.tar.gz`.
  `dist.torproject.org` keeps only the newest few releases, so the archive is
  the URL to pin; it still serves 14.0. Digests are in that folder's
  `sha256sums-signed-build.txt`.
- 15.0.25 (Tor 0.4.9.14) is the latest stable. Its bundles:

  | Platform key | Asset | Bytes | sha-256 |
  |---|---|---|---|
  | darwin-arm64 | tor-expert-bundle-macos-aarch64-15.0.25.tar.gz | 18 793 521 | a3febb6179152b0b4f56a0f5cc57bf5cc8ecef7db35e7c3e9d5a044c8158c26c |
  | darwin-x64 | tor-expert-bundle-macos-x86_64-15.0.25.tar.gz | 19 422 031 | e1ae4d4a734d28bb590839188511deb3cebc26fcbce9df66d01b2c452060fe95 |
  | linux-x64 | tor-expert-bundle-linux-x86_64-15.0.25.tar.gz | 32 448 097 | 19cf18726eecb362e0f21d27afa9ea9efe5da928bfdfbb1ceb5fe54519e87f4a |
  | win32-x64, win32-arm64 | tor-expert-bundle-windows-x86_64-15.0.25.tar.gz | 22 507 599 | c1988c701de2f24f7d098d1d6d7f507b58f27740d097f29c246e0524d639b252 |

  Windows on Arm runs the x64 build under emulation, as it does cloudflared.
- Every bundle is a `.tar.gz` of `tor/` (the binary and, on macOS and Linux,
  its libraries: `libevent-2.1.7.dylib`; `libcrypto.so.3`, `libssl.so.3`,
  `libevent-2.1.so.7`), `data/` (geoip files and a Tor Browser
  `torrc-defaults`), `docs/`, pluggable transports, and on Linux `debug/`.
  Only `tor/` is needed. The geoip files are not: nothing here uses country
  rules.
- **The macOS binaries are not code-signed at all**, and macOS on Apple
  silicon kills an unsigned arm64 binary on launch (exit 137). After
  `codesign --sign - --force` on `tor` and its dylib it runs. An ad-hoc
  signature names nobody. The signature changes the file's bytes, and differs
  with the identifier (the file name, by default).
- `-f` and `--defaults-torrc` need an empty file: `/dev/null` is refused.
- One run on the owner's Mac, onion service and Tor client on the same
  machine: the full onion was reachable 55 s after Tor started, the single
  onion 181 s after. A request over an open circuit took 1.2–1.3 s on the
  full onion (two round trips: about 0.6 s each), and 1.0–1.6 s on the single
  onion with one 9 s outlier. A sample this small shows neither mode faster.
  The UI's words about speed must not promise numbers.
- **The game client needs no change for an onion page.** In the pinned 274
  build, `public/client/client.js` opens its socket with
  `ws.Rp(window.location.host, "https:" === window.location.protocol)`, and
  `ondemandworker.js` is handed the same host and flag: an `http://` onion
  page connects `ws://` to its own host and port. No engine patch, no new
  pins. The client also has a DNS-over-HTTPS helper defaulting to
  `cloudflare-dns.com`; over Tor Browser that request goes out through an
  exit or fails. The by-hand test must confirm a login works regardless.

## How it works

### Where Tor comes from

A new module beside `cloudflared.ts` — call it `tor.ts` — pins
`TOR_BUNDLE_VERSION = '15.0.25'` and the table above, keyed
`${process.platform}-${process.arch}` exactly as `ASSETS` is, with
`assetFor`, `downloadUrl` and `isInstalled`. It also pins the sha-256 of
every file under `tor/` that the kit keeps, as Tor Project shipped them
(before any signing), so the check before a share is against the kit's own
pins and not against something recorded on the machine.

`ensureTor`, like `ensureCloudflared`: download beside the target, check
size and digest, unpack into a scratch folder, keep only `tor/`, check every
kept file against its pin, move into `<userData>/tor/<version>/`. Nothing
unchecked is ever left where Tor goes.

macOS needs a signed binary to run, and signing changes the bytes, so what
is checked and what runs cannot be the same files. **Builder's choice**
between two shapes, either of which satisfies "checked against the kit's
pins on every share":

- keep the unsigned files as installed, check them before every share, and
  copy them into a per-share run folder and sign them there; or
- sign at install with a fixed identifier, and check the signed files before
  every share against a signed digest the kit pins — **only** if signing is
  shown to give the same bytes on another Mac and another macOS version.
  Without that evidence, take the first.

`codesign` is `/usr/bin/codesign`, part of macOS. Signing is ad hoc only
(`--sign -`); no identity is ever used.

The download is asked about first, as cloudflared's is: "Sharing over Tor
needs Tor Project's Tor program." / "Downloads <file> (<n> MB) from
torproject.org, once."

### Running it

Tor is started per share and stopped with it. Its arguments, all on the
command line:

- `-f <empty>` and `--defaults-torrc <empty>`: no system or user torrc is
  read. (The empty file lives in the kit's Tor folder, as `quick.yml` does.)
- `--DataDirectory` a fresh folder per share, removed afterwards; and
  `--HiddenServiceDir` inside it. A fresh key means a fresh address every
  share. Tor wants both folders mode 700.
- `--HiddenServicePort "80 127.0.0.1:<relay port>"`.
- `--SocksPort` `auto` on loopback for Hide me (it is also how the kit checks
  the link, below); `0` for Faster, which Tor requires in non-anonymous mode.
- Faster adds `--HiddenServiceSingleHopMode 1 --HiddenServiceNonAnonymousMode 1`.
- Logging to stdout at notice, read line by line as cloudflared's stderr is;
  `--Log` to a file is not needed.
- The environment is stripped of anything Tor reads, the way `sanitizeEnv`
  treats `TUNNEL_*`. (Builder: check which variables Tor honours; if none
  matter, say so in the comment.)
- A control port is the builder's call. Reading the address from
  `<HiddenServiceDir>/hostname` once Tor writes it is enough; if a control
  port is used it must be loopback and cookie-authenticated.

The same tracked-spawn rule as cloudflared: every Tor started is in a set
killed on `process.on('exit')`, and `stop()` asks, then kills after a grace.

Nothing else about the share changes. Tor forwards to the **same relay**,
which forwards only `GET`, `HEAD` and the websocket upgrade, only to the web
port, and answers its random readiness path itself. `worldJson` keeps
`node.debug: false` and loopback hosts. Tor's `HiddenServicePort` points at
the relay, never at the world.

### When the link is live

"Live means the link works" holds. The kit shows the link only once the
relay's token has come back through Tor to the onion address.

- **Hide me:** the kit's own Tor has a SOCKS port; fetch
  `http://<address>/<probe path>` through it (socks5 with the host name sent
  to Tor, never resolved locally) until the body is the token.
- **Faster:** non-anonymous Tor cannot be a client. Start a second,
  client-only Tor from the same checked files (its own fresh data folder, an
  `auto` SOCKS port, nothing else), probe through it, and stop it as soon as
  the probe answers or the share ends. It is tracked like the first.

Both: poll patiently (a few seconds apart; Tor caches a failed descriptor
fetch, and hammering does not help), give up after **five minutes** — a
single onion took three in the one measurement — and fail with a reason
that says the link did not come up. The probe is a pure loop over an
injected io, like `waitUntilReachable`, so it is tested with no network.

Nothing here touches DNS. An onion address is never looked up.

### The share service

`ShareService` stays the one share. It gains which way the share goes:
`start(way)` with `way` `cloudflare | tor-full | tor-single`, and
`ShareView` gains `way` (null while off) so the panel can word itself. The
deps grow the Tor side; how the deps split (one deps object with both, or a
per-way "transport" the service is handed) is the builder's call, provided
the service's existing rules — the generation counter, one download at a
time per program, exit-is-failure, stop-owns-what-it-took — hold for both
and are tested for both.

`available` becomes per way: Cloudflare where `shareAsset` exists, Tor where
the Tor asset does. The panel offers what is available; if neither is, it
says so as it does now.

### Asking first

`shareDialogs` grows a Tor variant. In order:

1. Tor's download, the first time (above).
2. The share itself, with three buttons: **Hide me**, **Faster**, **Cancel**.
   The detail keeps today's warning ("Anyone with the link can log in as any
   character…", cheats, "The link ends when you stop sharing or quit") and
   adds one line per mode, in words, no numbers: Hide me keeps your address
   hidden and is slower; Faster hides only your friends. The mode picked last
   is listed first. Cancel is the default and the cancel button, as today:
   Return must not share by accident.

The last mode is saved in `state.json` under the `singlePlayer` block (say
`shareTorMode: 'full' | 'single'`, default `'full'`), read leniently like the
rest of that block. Builder's call on the exact key.

### The Sharing panel

`src/renderer/tools/homeserver/Friends.tsx`:

- Off: **Share** and **Share over Tor** side by side (stacked when narrow,
  as the panel already does), the note under them. Copy like "Friends join
  from their browser, or from Tor Browser over Tor."
- Downloading, connecting, checking: unchanged wording, except that
  connecting over Tor can say it may take a few minutes.
- Live over Tor: the link; **Copy link** and **Stop sharing**; **no Open in
  browser** (the system browser cannot open `.onion`, and `shareOpen` already
  refuses anything not `https://`). Under it: the existing warning, then
  "Opens only in Tor Browser. Tor Browser's Safest setting switches off
  JavaScript, which the game needs, so friends should use Standard or Safer."
  and, for Hide me / Faster, which mode it is.
- Failed: as today, Try again and Dismiss only — the other way's button is
  not offered until Dismiss (my call, following one share at a time). Try
  again goes back through the same dialogs as the first press for that way,
  so the per-share warning is shown every time, as today; for Tor that is
  the Hide me / Faster dialog, with the mode just tried listed first. So the
  renderer sends `shareStart(way)` with `way` `cloudflare | tor`, and main
  decides the mode from the dialog. `ShareView.way` tells the failed panel
  which way Try again means.

The Sharing mark on a background tab (`tabs.marksOfTab`) and the Sharing
button with no pane (`tabs.sharingWithoutPane`) work off `status`, so they
cover Tor with no change. Check that, don't assume it.

### Comments and docs

`CLAUDE.md`'s "Sharing your home server" section is the project's statement
of the rules; it gains the Tor ones (pinned bundle checked by digest every
share; no system torrc; fresh address per share; live means the token came
back through Tor; no DNS). The cloudflared-specific comments in
`service.ts`, `share.ts` and `Friends.tsx` that say "Cloudflare" or
"cloudflared" where they now mean either are corrected — a comment that no
longer describes the code is a defect here.

## Tests

Pure modules, `node --test`, as the rest of `share/`:

- `tor.ts`: the asset table, URL, per-file pins; `ensureTor` against a fake
  bundle on loopback — wrong size, wrong digest, missing `tor/`, a tampered
  file inside, success; nothing unchecked left behind on any failure.
- The Tor process runner: arguments for each mode (empty `-f` and defaults,
  fresh folders, SOCKS 0 with single hop), environment stripped, the address
  read once written, exit before the address is a failure with Tor's last
  line, stop then kill. Run against a fake `tor` script, as
  `quickTunnel.test.ts` runs a fake cloudflared.
- The probe loop: token back is live, wrong body keeps waiting, deadline
  fails, abort stops it, the single-onion path starts and stops its client.
- `ShareService`: each existing test's rule holds for the Tor way; a share in
  one way refuses to start the other; `view().way`.
- `shareDialogs`: the Tor download and share dialogs, the last mode first.
- `share/invariants.test.ts` still passes untouched.

And by hand, because none of the shell or main wiring can fail in CI: a real
share in each mode on a Mac, the link opened in Tor Browser, a character
logged in, Stop sharing, the old link dead; and `npm run capture` for the
panel's new states.

## Left to the builder

- The run-folder-versus-pinned-signature choice on macOS (above).
- Control port or `hostname` file.
- How `ShareDeps` splits between the two ways.
- The `state.json` key's exact name.
- Exact UI copy, within what is said above.
