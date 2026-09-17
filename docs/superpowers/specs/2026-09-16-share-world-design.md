# Share your single-player world with friends

**Date:** 2026-09-16
**Status:** implemented on branch `share-world`

## Why

Single player runs a private world on this computer, bound to loopback on
ports that change every start. A player who wants a friend or two in that
world has no way to let them in short of setting up a server. The owner asked
for a button: the host opens their world, gets a link, and friends join.

## The owner's calls

1. **A Cloudflare Quick Tunnel** carries it: `cloudflared tunnel --url …`
   needs no Cloudflare account and gives a random
   `https://<words>.trycloudflare.com` link. No ssh relay, no frp, no UPnP.
2. **Friends join from a browser.** The link is `<tunnel>/rs2.cgi`. The kit
   gets no "join" UI.
3. **No passwords.** The link is the secret. A world with no login server
   checks no password, so anyone holding the link can log in as any
   character, the host's included, and has cheats when the host does. The kit
   says so before sharing and while shared.
4. **cloudflared is downloaded on the first share**, after the host agrees,
   from Cloudflare's GitHub release, and checked against a pinned SHA-256. It
   is not bundled, so the installers stay the size they are.
5. **No engine changes.** The kit stays pinned to Lost City upstream with its
   existing patch and nothing more.

## Rejected

- **The engine's login server, for passwords.** Upstream's login, friend and
  logger servers bind `0.0.0.0` in code, not config. Turning them on would put
  an unauthenticated service that reads and writes save files on the host's
  LAN, and the only fix is an engine change.
- **A login gate in the kit** (read the login block, decrypt it with the
  world's own key, check a kit-held password). It works without the engine,
  but the owner chose no passwords.
- **Bundling cloudflared.** 19 to 55 MB per platform, twice over in the
  universal DMG.

## What is exposed

With `node.debug` false, which `worldJson` writes and a test now pins, the
pinned engine's web port serves `/rs2.cgi`, the cache routes, the game's
websocket and `public/`. The debug-only routes — `/data/` (the RSA key,
`world.json`, every save), `/content/` and its `PUT` — are not registered.
The management port, which answers `POST /shutdown`, is never tunnelled.

## Design

```
friend's browser ──https──▶ Cloudflare ◀──outbound── cloudflared ──▶ relay ──▶ world
                                                     (kit child)    127.0.0.1  127.0.0.1:<web>
```

- **Relay** (`share/relay.ts`). An HTTP server on `127.0.0.1:0` in the main
  process. It forwards `GET` and `HEAD` to the world's current web port and
  pipes websocket upgrades through untouched; anything else is `405`, and
  while the world is down it answers `503`. The tunnel points at the relay,
  so the link outlives a world restart — turning cheats on or off, or Try
  again — and friends reload rather than wait for a new link.
- **Tunnel** (`share/quickTunnel.ts`). Spawns cloudflared with
  `--no-autoupdate`, a `--config` file holding `{}` so a
  `~/.cloudflared/config.yml` cannot override `--url`, and a one-second grace
  period. The link is the first `trycloudflare.com` host after the "Your quick
  Tunnel has been created" line; the tunnel is live once
  `Registered tunnel connection` follows. Quick tunnels force QUIC, which a
  network blocking UDP 7844 never lets through, so one retry uses
  `--protocol http2`.
- **Binary** (`share/cloudflared.ts`). Pinned to 2026.9.1 by GitHub's asset
  digests, which for the macOS archives differ from the release notes'. The
  archive is checked, then extracted, then the binary itself is checked. A
  cached binary is hashed again before every share.
- **Service** (`share/service.ts`). `off → downloading → connecting → live`,
  and `failed`. Counted like the world: every single-player window acquires
  it, and the last window to close stops sharing. A world restart passes
  through `stopped`, so the world's status is never the signal to stop.
- **Panel** (`renderer/tools/singleplayer/Friends.tsx`), the Single player
  tool's Friends section since single player gained sections: Share with
  friends; the link with Copy link, Open in browser and Stop sharing; the
  warning, which also shows above the other sections while the link is live;
  and the failure with Try again.

## Out of scope

Passwords, a join UI, the Java client, other tunnel providers, stable or
custom domains, and Cloudflare's unreleased `--allowed-mail` gate.
