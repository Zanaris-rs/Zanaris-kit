# Engine patches

The kit builds the engine from Lost City upstream, unmodified except for what
is here. Each `*.patch` is applied by `scripts/stage-engine.mjs` to the engine
checkout named in `engine.lock.json`, in sorted order, with `git apply`. A patch
that no longer applies stops the build rather than being skipped.

Keep this directory as close to empty as it can be. A patch belongs here only
while it is on its way upstream: when Lost City merges one, move the pin to the
merge commit and delete the file.

## 0001-single-player-hosts-staff-level-and-shutdown.patch

Three changes single player needs and upstream `274` does not have. Every
default is upstream's behaviour, so a world that sets none of these runs exactly
as it does today.

- **`web.host` and `node.host`** (default `0.0.0.0`, env `WEB_HOST` /
  `NODE_HOST`). `src/web.ts` and `src/server/tcp/TcpServer.ts` hardcode
  `0.0.0.0`. A world running on a player's own machine has to bind loopback:
  otherwise Windows raises the firewall prompt on first launch and the world is
  reachable from the rest of the network.
- **`node.localStaffLevel`** (default `-1`, unset, env
  `NODE_LOCAL_STAFF_LEVEL`) and `resolveLocalStaffLevel()`.
  `src/server/login/LoginThread.ts` gives every login staff level 4 when the
  login server is off and production is off. Single player needs both of those
  to be true and still wants cheats off by default, so the level becomes a
  setting; unset, it is the same expression as before.
- **`POST /shutdown`** on the management port, and `src/util/Shutdown.ts`, which
  hoists the once-only `exiting` guard out of `src/app.ts` so a signal and the
  route share one exit path. Windows has no SIGTERM, so a launcher supervising
  the world as a child process has no other way to stop it and flush saves.
  The patch also binds the management server to loopback, which upstream leaves
  on `0.0.0.0` - it has no authentication and can now stop the world.

Upstream has no `test/` directory or test script at `274`, so the patch carries
no tests. What covers it instead is `scripts/stage-engine.mjs`: its boot check
starts the staged engine bound to loopback, asserts the world is not reachable
on a routable address, and stops it through `POST /shutdown` rather than a
signal. `localStaffLevel` is covered by the manual cheats check in RELEASE.md.
