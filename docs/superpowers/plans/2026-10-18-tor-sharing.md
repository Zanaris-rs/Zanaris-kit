# Sharing over Tor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A **Share over Tor** button beside **Share** in Home server, giving an onion link in the player's choice of full or single onion mode.

**Architecture:** Three new pure modules in `src/main/share/` — `tor.ts` (pinned Expert Bundle, download and per-file check), `torProcess.ts` (running Tor as an onion service or a probe client), `onionReachable.ts` (the token round trip through Tor's SOCKS port). `ShareService` gains a *way* and takes one transport per way; everything it already guarantees holds for both. Main, preload and the Friends panel are wired last.

**Tech Stack:** TypeScript, Node (`node:net`, `node:child_process`), Electron, React, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-18-tor-sharing-design.md` — read it first.

## Global Constraints

- Tor Expert Bundle `15.0.25` (Tor 0.4.9.14), from `https://archive.torproject.org/tor-package-archive/torbrowser/15.0.25/<file>` — never `dist.torproject.org`.
- Platform keys and assets exactly as the spec's table; Windows on Arm uses the x64 bundle; Linux arm64 has no Tor (`null`).
- Only `tor/` is kept from a bundle, and of it only the files listed per platform in Task 1. Pluggable transports, `tor-gencert.exe`, `data/`, `docs/`, `debug/` are never kept.
- Every kept file is checked against the kit's pinned digest before **every** share, and what runs is derived from those checked files on that share.
- macOS signing is ad hoc only: `/usr/bin/codesign --sign - --force`. Never an identity.
- Tor never reads a torrc the kit did not write: `-f <empty file>` and `--defaults-torrc <empty file>`.
- A fresh `DataDirectory` (mode 700) per Tor process, removed when it ends. Fresh onion address every share.
- `HiddenServicePort` targets the relay, never the world.
- No DNS for an onion address, ever. SOCKS5 with the host name sent as a domain (ATYP 3).
- Live only once the relay's token came back through Tor. Deadline 5 minutes.
- UI copy promises no speed numbers.
- One share at a time; the other way is not offered while one is on its way, live or failed.
- Comments that say "cloudflared" or "Cloudflare" where they now mean either are fixed (CLAUDE.md: comments are load-bearing).
- Paths in any committed file are written from the repository root.

## Review Focus

1. **Tor dies at start** (port clash, bad folder permissions, macOS kill 137 when unsigned) → the share fails with Tor's last log line, nothing left running. Test in Task 2.
2. **Stop or quit during the up-to-5-minute check in Faster mode** → both the service Tor and the probe client Tor are gone. Tests in Tasks 3 and 4; tracked-kill set in Task 5.
3. **A path with a space** (`Application Support` on macOS, a Windows profile name) → every path is its own argv element and Tor starts. Test in Task 2.
4. **A kept file changed on disk after install** (or a half-unpacked folder from a killed download) → the check before the share fails it and `ensureTor` downloads afresh. Test in Task 1.
5. **Try again after a Tor failure** shows the Hide me / Faster dialog with the mode just tried first, and Cloudflare is not offered until Dismiss. Tests in Tasks 4 and 5.

---

### Task 1: The pinned Tor bundle

**Files:**
- Create: `src/main/share/tor.ts`
- Test: `src/main/share/tor.test.ts`

**Interfaces:**
- Consumes: `downloadFile`, `sha256File`, `extractTgz`, `FetchLike` from `src/main/download.ts`.
- Produces:
  - `export const TOR_BUNDLE_VERSION = '15.0.25'`
  - `export interface TorAsset { file: string; size: number; sha256: string; files: Readonly<Record<string, string>> }` — `files` maps a kept file name (inside `tor/`) to its pinned sha-256; the first entry is the executable.
  - `export const TOR_ASSETS: Readonly<Record<string, TorAsset>>`, `export function torAssetFor(platform: string, arch: string): TorAsset | null`
  - `export function torDownloadUrl(asset: TorAsset): string`
  - `export function torExecutable(asset: TorAsset): string` — `'tor'` or `'tor.exe'`
  - `export interface TorQuery { asset: TorAsset; dir: string }` (`dir` = `<userData>/tor/<version>`)
  - `export async function torInstalled(q: TorQuery): Promise<boolean>` — every kept file present and matching.
  - `export async function ensureTor(opts: TorQuery & { url?: string; fetch: FetchLike; extract?: (archive: string, into: string) => Promise<void>; idleMs?: number; onProgress?: (f: number) => void }): Promise<string>` — returns `dir`, the folder holding the checked files.

Pinned kept files (digests computed from the published bundles on 2026-10-18):

| Key | Kept files → sha-256 |
|---|---|
| darwin-arm64 | `tor` 7d5a89b6cec99aab47420040ad86dd5fd5174192e71b6c201b0b10170ba57ebb; `libevent-2.1.7.dylib` 6dde3faf59255b7cf0cc20d0b3cdf78622266fbf13c534300b8884c76d89b739 |
| darwin-x64 | `tor` e249a521aa5b0ff44a39c1dc4b5707ae8cb109d8a26c637b6acbbf6832bf2f14; `libevent-2.1.7.dylib` 38aea0316e01e1fc52a15941bf523c8bc018ca90655cfa90de568b4a86a82b4b |
| linux-x64 | `tor` 39c9db0654d2ec218892bd00f75eccb5b641a7222754436c2e4a8d2f764a57d3; `libevent-2.1.so.7` b51ca562ec232785856c454ce4f3621d957f39d0db87919e237590b0331544ff; `libssl.so.3` 9c2438d086d6c299db04b0bc337bbc8c0acd26c19c71eada2173a5b2ef7cecac; `libcrypto.so.3` 418208c5c738864cb5653f3eeab650debcc71afbe50d08b0bd5a04b20f1d3c05 |
| win32-x64, win32-arm64 | `tor.exe` 8c38513b3c4584154158e7c584f4144849dc679a64cd679553d72dad28230c54 |

Archive sizes and digests: the spec's table.

- [ ] **Step 1: Write the failing tests** in `tor.test.ts`, modelled on `cloudflared.test.ts` (loopback HTTP server serving a fake `.tar.gz` built in a temp dir with `tar -czf`; the test computes the fake's digests and builds a `TorAsset` from them):
  - `torAssetFor('linux','arm64') === null`; `torAssetFor('win32','arm64') === torAssetFor('win32','x64')`; `torDownloadUrl` of darwin-arm64 equals `https://archive.torproject.org/tor-package-archive/torbrowser/15.0.25/tor-expert-bundle-macos-aarch64-15.0.25.tar.gz`.
  - every `TOR_ASSETS` entry has 64-hex digests and its first `files` key is `tor` or `tor.exe`.
  - `ensureTor` success: `dir` holds exactly the kept files (no `pluggable_transports`, no `data`), `torInstalled` true, no `.partial` or scratch folder left.
  - wrong size → rejects; wrong archive digest → rejects; archive without `tor/` → rejects; a kept file whose digest differs → rejects with its name; in every case `dir` holds no kept file and no scratch is left.
  - a kept file altered after a successful install → `torInstalled` false, and `ensureTor` downloads again and restores it.
  - non-Windows: the executable is mode 0o755.

- [ ] **Step 2: Run, verify failure**
  Run: `node --test src/main/share/tor.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `tor.ts`.** Same shape as `ensureCloudflared`: remove the kept files, download to `<dir>/<file>.partial`, check digest, extract to `<dir>/.extract`, check and copy each kept file from `.extract/tor/` into `dir` via a rename of the checked file, `finally` removes partial and scratch. Any failure after files start landing removes the kept files already placed. Doc comment says why only `tor/` and why the archive URL.

- [ ] **Step 4: Run, verify pass** — `node --test src/main/share/tor.test.ts`: PASS. `npm run typecheck`: clean.

- [ ] **Step 5: Commit** — `git add src/main/share/tor.ts src/main/share/tor.test.ts && git commit -m "feat(share): pin and fetch Tor's Expert Bundle"`

---

### Task 2: Running Tor

**Files:**
- Create: `src/main/share/torProcess.ts`
- Test: `src/main/share/torProcess.test.ts` (+ a fake tor script under `src/main/share/testdata/`, as cloudflared's tests do)

**Interfaces:**
- Consumes: `TunnelProcess`, `TunnelSpawnSpec`, `spawnProcess`, `TunnelError` from `quickTunnel.ts` (extend `spawnProcess` with an optional `stream: 'stdout' | 'stderr'` on the spec, default `'stderr'`; Tor logs to stdout).
- Produces:
  - Adds `export type TorMode = 'full' | 'single'` to `src/shared/share.ts` (shared with the renderer later) and imports it from there.
  - `export function buildTorArgs(opts: { empty: string; dataDir: string; mode: TorMode | 'client'; relayPort?: number }): string[]` — `client` has no hidden service and `--SocksPort auto`; `full` has the service and `--SocksPort auto`; `single` has the service, `--SocksPort 0`, `--HiddenServiceSingleHopMode 1`, `--HiddenServiceNonAnonymousMode 1`. Always `-f empty`, `--defaults-torrc empty`, `--DataDirectory dataDir`, `--Log 'notice stdout'`; a service adds `--HiddenServiceDir <dataDir>/hs` and `--HiddenServicePort '80 127.0.0.1:<relayPort>'`. SOCKS is loopback (`auto` binds 127.0.0.1).
  - `export function torEnv(env: Record<string, string | undefined>, platform: string, libDir: string): Record<string, string>` — drops `LD_*` and `DYLD_*`, then on Linux sets `LD_LIBRARY_PATH=libDir` (the Linux tor has no `$ORIGIN` runpath; the mac one uses `@executable_path`).
  - `export function createTorLogParser(): { push(line: string): void; bootstrapped(): boolean; socksPort(): number | null; lastLine(): string }` — `Bootstrapped 100%`; `Opened Socks listener connection (ready) on 127.0.0.1:<port>`.
  - `export interface TorIo { env: Record<string, string | undefined>; platform: string; spawn(spec: TunnelSpawnSpec): TunnelProcess; makeDataDir(): Promise<string>; removeDir(dir: string): Promise<void>; readHostname(dataDir: string): Promise<string | null>; prepare(checkedDir: string, signal: AbortSignal): Promise<{ exe: string; libDir: string; release(): Promise<void> }> }` — `prepare` is where macOS copies to a run folder and signs (Task 5 supplies it; tests fake it).
  - `export interface TorHandle { readonly exited: Promise<number | null>; stop(): Promise<void>; logs(): string[] }`
  - `export async function startOnion(io: TorIo, opts: { checkedDir: string; empty: string; mode: TorMode; relayPort: number; signal: AbortSignal; bootTimeoutMs?: number; stopGraceMs?: number }): Promise<TorHandle & { url: string; socksPort: number | null }>` — resolves with `url` `http://<56 chars>.onion` once the hostname file exists **and** Tor logged `Bootstrapped 100%`; `socksPort` non-null for `full`. Default boot timeout 120 s.
  - `export async function startTorClient(io: TorIo, opts: { checkedDir: string; empty: string; signal: AbortSignal; bootTimeoutMs?: number; stopGraceMs?: number }): Promise<TorHandle & { socksPort: number }>`
  - Both: `stop()` SIGTERM then SIGKILL after the grace (reuse `quickTunnel`'s stopper — export it), then remove the data dir and `release()` the prepared run folder. Exit, timeout or abort before ready rejects with `TunnelError` whose message ends with Tor's last line, and leaves nothing running or on disk.

- [ ] **Step 1: Write failing tests:**
  - `buildTorArgs` for each of `full`, `single`, `client`: exact arrays, including a `dataDir` containing a space as a single element (Review Focus 3).
  - `torEnv`: removes `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`; Linux sets `LD_LIBRARY_PATH`; darwin and win32 do not.
  - parser: picks out the SOCKS port and bootstrap from real Tor lines (`Oct 18 19:36:15.000 [notice] Bootstrapped 100% (done): Done`).
  - `startOnion` with a fake io: resolves only after both hostname and bootstrap; `full` reports the SOCKS port; exit before ready rejects with the last line and removes the data dir (Review Focus 1); abort rejects with "Sharing was cancelled" and kills; `stop()` removes the data dir and calls `release`.
  - one test that runs the real `spawnProcess` against the fake tor script (prints the lines, writes `hs/hostname`) through `startOnion`.

- [ ] **Step 2: Run, verify failure** — `node --test src/main/share/torProcess.test.ts`: FAIL.

- [ ] **Step 3: Implement.** Poll `readHostname` on each log line and every 500 ms until ready.

- [ ] **Step 4: Run, verify pass** — that file and `quickTunnel.test.ts` PASS; typecheck clean.

- [ ] **Step 5: Commit** — `git commit -m "feat(share): run Tor as an onion service or a probe client"`

---

### Task 3: Checking the onion link

**Files:**
- Create: `src/main/share/onionReachable.ts`
- Test: `src/main/share/onionReachable.test.ts`

**Interfaces:**
- Consumes: `ProbeAnswer` from `reachable.ts`.
- Produces:
  - `export interface OnionIo { fetchViaSocks(socksPort: number, host: string, path: string, signal: AbortSignal): Promise<ProbeAnswer>; sleep(ms: number, signal: AbortSignal): Promise<void>; now(): number }`
  - `export async function waitOnionReachable(io: OnionIo, opts: { url: string; socksPort: number; probe: { path: string; token: string }; signal: AbortSignal; deadlineMs?: number; intervalMs?: number; log?: (m: string) => void }): Promise<void>` — default deadline 300 000 ms, interval 5 000 ms. Rejects `'The onion link did not come up within 5 minutes'` (minutes from `deadlineMs`).
  - `export function nodeOnionIo(): OnionIo` — hand-written SOCKS5 (no auth, CONNECT, ATYP 3 domain), then `GET <path> HTTP/1.1` with `Host`, `Connection: close`, reading status and at most `BODY_LIMIT` bytes. Each attempt times out at 60 s.

- [ ] **Step 1: Write failing tests:** live when the body equals the token; wrong body or 503 keeps waiting; a thrown fetch keeps waiting; deadline rejects with the message; abort rejects promptly. And `nodeOnionIo` against a loopback fake SOCKS5 server: asserts the greeting is `05 01 00`, the request is ATYP `03` carrying the onion host and port 80 (no local lookup), then serves an HTTP answer that `fetchViaSocks` returns.

- [ ] **Step 2: Run, verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, verify pass**; typecheck clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(share): check an onion link through Tor's SOCKS port"`

---

### Task 4: The share service learns a way

**Files:**
- Modify: `src/shared/share.ts`, `src/main/share/service.ts`
- Test: `src/main/share/service.test.ts`

**Interfaces:**
- Consumes: `TorMode` in `share.ts` (Task 2), `TorAsset` (Task 1), `CloudflaredAsset`.
- Produces:
  - In `share.ts`: `export type ShareWay = 'cloudflare' | 'tor'`; `export type ShareStart = { way: 'cloudflare' } | { way: 'tor'; mode: TorMode }`. `ShareView` replaces `available` with `offered: { cloudflare: boolean; tor: boolean }`, and adds `way: ShareWay | null` and `torMode: TorMode | null` (non-null whenever status is not `off`).
  - In `service.ts`:
    - `export interface ShareTransport { program: 'cloudflared' | 'tor'; ensureBinary(onProgress: (f: number) => void): Promise<string>; startTunnel(binary: string, relayPort: number, signal: AbortSignal): Promise<ShareTunnel>; waitReachable(tunnel: ShareTunnel, probe: ShareRelay['probe'], signal: AbortSignal): Promise<void> }`
    - `ShareDeps` becomes `{ cloudflare: ShareTransport | null; tor: ((mode: TorMode) => ShareTransport) | null; startRelay; worldPort; log }`.
    - `ShareTunnel` gains `readonly program: string` for the exit message.
    - `start(how: ShareStart): Promise<void>` — refuses (resolves, does nothing) when the way is not offered or a share is not `off`/`failed`; from `failed` it may start either way (the panel gates the other way, not the service).
    - One download in flight **per program**.
    - Exit message: `The link closed unexpectedly (${program} exited with code ${code})…`.
  - `shareDialogs(opts: { way: ShareWay; download: { file: string; size: number } | null; cheats: boolean; lastTorMode: TorMode }): ShareDialog[]`. `ShareDialog` gains `buttons: string[]` (the confirming ones, in order; Cancel is added by main) and loses `confirm`. Tor download: message `"Sharing over Tor needs Tor Project's Tor program."`, detail `Downloads <file> (<n> MB) from torproject.org, once.` The Tor share: message `'Share your home server over Tor?'`; buttons `['Hide me', 'Faster']`, swapped when `lastTorMode` is `'single'`; detail is today's warning sentence(s) plus `Hide me keeps your address hidden, and is slower. Faster hides only your friends. Friends need Tor Browser.` Cloudflare's dialogs keep today's wording with `buttons: ['Download']` / `['Share']`.

- [ ] **Step 1: Update and add tests.** Convert the harness to transports (one fake transport per way recording calls). Keep every existing test's assertion, run against Cloudflare. Add: the same lifecycle passes for `{way:'tor', mode:'single'}` (start → downloading → connecting → checking → live, `view().way === 'tor'`, `torMode === 'single'`, url `http://….onion/rs2.cgi`); stop during `checking` aborts the signal handed to `waitReachable` and stops the tunnel (Review Focus 2); a Tor exit reports `tor exited`; Cloudflare and Tor downloads can be in flight separately but two Tor starts share one; `offered` reflects null transports; `shareDialogs` for Tor with each `lastTorMode` orders the buttons (Review Focus 5) and omits the download when `download` is null.

- [ ] **Step 2: Run, verify failure** — `node --test src/main/share/service.test.ts`.
- [ ] **Step 3: Implement.** Fix the class and file comments to talk about "the tunnel" / "the program" rather than cloudflared where they mean either.
- [ ] **Step 4: Run, verify pass** — `npm test`; typecheck will fail in `index.ts`, `electron.ts` and `Friends.tsx` until Tasks 5 and 6 — note it, don't paper over it.
- [ ] **Step 5: Commit** — `git commit -m "feat(share): one share, by Cloudflare or by Tor"`

---

### Task 5: Wiring main and preload

**Files:**
- Modify: `src/main/share/electron.ts`, `src/main/index.ts` (share IPC block near line 1946, `new ShareService` near line 3308), `src/shared/ipc.ts` (`share.start` signature + doc), `src/preload/index.ts`, `src/main/appState.ts`, `src/main/homeserver/settings.ts`
- Test: `src/main/appState.test.ts`, `src/main/homeserver/settings.test.ts` (if it exists; else in `appState.test.ts`)

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `readShareTorMode(x: unknown): TorMode` in `settings.ts` — `'single'` only for exactly `'single'`, else `'full'`.
  - `AppState.shareTorMode(): TorMode` / `setShareTorMode(mode: TorMode): void`, persisted as `singlePlayer.shareTorMode` beside `build`, written only when not the default `'full'`.
  - `window.zanaris.share.start(way: ShareWay)`; IPC `shareStart` receives the way and checks it is `'cloudflare'` or `'tor'`.

- [ ] **Step 1: Failing tests** for `readShareTorMode` and the `AppState` round trip (default `'full'`; `'single'` survives save and reload; garbage reads as `'full'`).
- [ ] **Step 2: Run, verify failure.**
- [ ] **Step 3: Implement.**
  - `electron.ts`: `torAsset = torAssetFor(process.platform, process.arch)`; `torDir = <userData>/tor/<TOR_BUNDLE_VERSION>`; an empty `torrc` file in it, created like `quick.yml`. A `TorIo` whose `makeDataDir` is `mkdtemp` under `<torDir>/run` then `chmod 0o700`; whose `prepare` re-checks every kept file against its pin (`torInstalled` — fail the share with "Tor's files changed on disk; try again to download them afresh" if not), and on darwin copies them into a fresh run folder and runs `/usr/bin/codesign --sign - --force <each>`; elsewhere returns the checked folder itself. Spawns go through the existing `spawnTracked` set so `process.on('exit')` kills every Tor, the probe client included. The Tor transport's `waitReachable`: full → `waitOnionReachable` through the service Tor's `socksPort`; single → `startTorClient`, wait, and stop the client in a `finally` (also on abort).
  - `index.ts` `shareStart(event, way)`: build `shareDialogs` for that way; show each with `buttons: [...ask.buttons, 'Cancel']`, `cancelId` and `defaultId` both the Cancel index for the share dialog (download dialog keeps default on Download); for Tor map the pressed button to a mode, `appState.setShareTorMode(mode)`, then `share.start({ way: 'tor', mode })`. `shareOpen` stays https-only (onion links never open in the system browser).
- [ ] **Step 4: Verify** — `npm test` and `npm run typecheck` (renderer errors remain until Task 6).
- [ ] **Step 5: Commit** — `git commit -m "feat(share): wire Share over Tor through main"`

---

### Task 6: The Sharing panel, docs and comments

**Files:**
- Modify: `src/renderer/tools/homeserver/Friends.tsx`, `CLAUDE.md` ("Sharing your home server"), `src/shared/share.ts` comments, `src/main/share/relay.ts` / `reachable.ts` comments only where they claim to be the only way.

- [ ] **Step 1: Panel.** Per the spec's "The Sharing panel":
  - Neither offered: today's "isn't available" line, reworded to not blame Cloudflare alone.
  - Off: **Share** (if offered) and **Share over Tor** (if offered), same `row` layout rules; note `Friends join from their browser, or from Tor Browser over Tor.` (only the half that is offered).
  - Connecting over Tor: `Opening a Tor link… this can take a few minutes.`
  - Live over Tor: link, Copy link, Stop sharing — no Open in browser. Under the existing warning: `Opens only in Tor Browser. Its Safest setting switches off JavaScript, which the game needs: friends should use Standard or Safer.` and `Hide me: your address stays hidden.` or `Faster: only your friends are hidden.`
  - Failed: Try again calls `share.start(view.way ?? 'cloudflare')`; Dismiss as today.
  - Colours only via existing tokens/classes.
- [ ] **Step 2: Check the marks.** Confirm `tabs.marksOfTab`'s `sharing` and the Sharing button come from `status` and need no change; if they key on anything Cloudflare-specific, fix there with a test.
- [ ] **Step 3: CLAUDE.md** — add the Tor rules to "Sharing your home server": pinned Expert Bundle from the archive, every kept file checked before every share, ad-hoc signing on macOS and why, empty `-f`/`--defaults-torrc`, fresh address per share, live means the token came back through Tor (SOCKS, ATYP 3, never DNS), Faster's probe client, `TOR_BUNDLE_VERSION` bumps need new per-file digests from the bundles themselves.
- [ ] **Step 4: Verify** — `npm test`, `npm run typecheck`: all clean. `grep -rn "cloudflared" src/shared src/renderer` and read each hit: none may now be false.
- [ ] **Step 5: Commit** — `git commit -m "feat(share): Share over Tor in the Sharing panel"`

---

### Task 7: Running it for real

No code unless something breaks (then back to the owning task, with a test).

- [ ] `npm run dev`; Home server running. **Share over Tor → Hide me**: download asked, link goes live, `curl --socks5-hostname` through a separate Tor to `<link>` returns the client page. Stop sharing: the old link stops answering; no `tor` left in `ps`.
- [ ] Same with **Faster**; during `checking`, press Cancel: no `tor` processes remain (Review Focus 2).
- [ ] Quit mid-share: no `tor` processes remain.
- [ ] Try again after a forced failure (kill the tor process): dialog shows the last mode first; Cloudflare not offered until Dismiss.
- [ ] Cloudflare share still goes live as before.
- [ ] `caffeinate -d npm run capture`, then open the Sharing panel shots in each new state.
- [ ] Owner: open a live link in Tor Browser (Standard), log in a character, walk around. Then Safest: confirm the page fails and the panel's explanation matches.
