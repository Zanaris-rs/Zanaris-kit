# Plan: Share your single-player world

Spec: `docs/superpowers/specs/2026-09-16-share-world-design.md`. Test-first
throughout (`node --test`); every rule lives in a pure module with its io
injected, and Electron glue holds none.

Another branch (`singleplayer-tools`) is reworking `singleplayer/*`,
`SinglePlayer.tsx`, `ipc.ts`, the preload and `index.ts`. New code goes in
`src/main/share/`; edits to shared files are additive and small so a rebase is
mechanical.

## Tasks

1. **`src/shared/share.ts`** — `ShareStatus`, `ShareView`.
2. **`src/main/share/cloudflared.ts`** — `CLOUDFLARED_VERSION`, the pinned
   `ASSETS` table (file, size, SHA-256; for the macOS archives also the
   binary's SHA-256), `assetFor(platform, arch)`, `downloadUrl`,
   `ensureCloudflared(io, onProgress)`: reuse a cached binary whose hash
   matches, otherwise download to `.partial`, check size and hash, extract the
   archive, check the binary, mark it executable, rename it into place.
   Tests: mapping, pins, cache hit and miss, size and hash mismatch, HTTP
   error, stall, no `.partial` left behind, wrong inner hash.
3. **`src/main/share/quickTunnel.ts`** — `buildArgs`, `sanitizeEnv`,
   `createLogParser`, `startQuickTunnel(io, opts)` with the http2 retry and a
   bounded stop. Tests drive a fake cloudflared script under
   `process.execPath`: arguments, environment, parser edge cases, QUIC
   failure then http2, two failures, registration timeout, a flood of
   output, a crash after going live, a second `stop()`.
4. **`src/main/share/relay.ts`** — loopback relay: `GET`/`HEAD` forwarded,
   other methods `405`, `503` while the world is down, websocket upgrades
   piped, a socket cap, `close()` ending everything. Tests against a real
   loopback server.
5. **`src/main/share/service.ts`** — `ShareService`, `shareConfirm`,
   `downloadConfirm`. Tests: the status sequence and progress, a failed
   download starting nothing, a tunnel failure closing the relay, the last
   release stopping, shared stops, the dialog wording.
6. **`src/main/share/invariants.test.ts`** — `worldJson` keeps `debug: false`
   and loopback hosts, which is what makes the web port safe to tunnel.
7. **Glue** — `src/main/share/electron.ts` (fetch to disk, spawn, tar,
   hashing, killing cloudflared at exit); `index.ts` (service, IPC
   `share-start`/`share-stop`/`share-copy`/`share-open`, the two dialogs,
   quit); `serverWindow.ts` (acquire and release beside the world's, `share`
   in the shell state); `ipc.ts`; the preload.
8. **UI** — `src/renderer/tools/ShareWorld.tsx`, placed at the foot of
   `SinglePlayer.tsx`; `Shell.tsx` passes the view.
9. **Docs** — README (Share with friends, security posture, source layout),
   `CLAUDE.md` (the sharing invariants).
10. **Verify** — `npm test`, `npm run typecheck`, `npm run build`; a live run
    of relay and tunnel in front of the staged engine, the link opened in a
    browser; an app run with the owner's go-ahead.
11. **Ship** — push `share-world`, open the PR as Zanaris274, check its author
    and CI.
