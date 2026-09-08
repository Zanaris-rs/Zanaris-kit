# Working in Zanaris Kit

`README.md` says what this app is and why it looks the way it does. This file is
the other half: what to know before changing it. Where the two overlap, the
README wins on description and this file wins on process.

## Identity — the one that bites first

Everything under `~/Projects/2004scape/` belongs to the pseudonymous GitHub
account **Zanaris274** and its org **Zanaris-rs**. The point is that this work is
unattributable to the owner's real name.

`git` is already correct: an `includeIf` in `~/.gitconfig` sets the user and pins
`core.sshCommand` to `~/.ssh/zanaris_ed25519` for this directory tree.

**`gh` is not.** Its active account is the real-name one, so a plain `gh pr create`
or `gh api` opens work under the wrong identity on a repo whose whole purpose is
not to carry it. Anything touching `Zanaris-rs` needs:

```sh
GH_TOKEN=$(gh auth token -u Zanaris274) gh pr create ...
```

Check the result afterwards — `gh pr view <n> --json author` — rather than assuming.
Never add repo-local user or credential overrides, and never let a retired handle,
the old org, the owner's company or its domain into anything pushed.

## The layout invariant

**Opening chrome must never resize the game view.** Reloading or rescaling that
view costs the player their login, which is the one failure the layout exists to
prevent. Chrome opening grows the *window* instead, falling back through
`widen → shift → push`.

One 1-D solver — `fitAxis` in `src/main/layout.ts` — is called once per axis, so
the ladder is literally the same code on both. The axes deliberately disagree
about who gives way:

- **x**: the panel is sacrificed; content never drops below `MIN_CONTENT_WIDTH`.
- **y**: the dock is protected down to `DOCK_HEIGHT_MIN`, and past that the
  *content* gives way below `MIN_CONTENT_HEIGHT`.

That asymmetry is intentional — the dock holds the conversation the user just
asked to see. `docs/superpowers/specs/2026-09-07-chat-dock-design.md` argues it.

## Where logic is allowed to live

`src/main/serverWindow.ts`, `src/main/index.ts` and the **entire renderer** have
no test infrastructure. Nothing in them can fail in CI.

So anything decidable belongs in a pure module that `node --test` reaches without
Electron: `main/layout.ts`, `main/chatDock.ts`, `main/hiscores/sources.ts`,
`main/hiscores/service.ts`. Services take an injected `io` for exactly this reason
— `ChatIo`, `HiscoresIo`, `WorldsIo` — so the lifecycle can be driven by hand in a
test with no socket.

Placement rules reimplemented in a window or a renderer are a defect, not a
shortcut. `chatDock.ts` owns every tool-placement transition; if you find yourself
setting `panelOpen` next to `activeTool`, you are rewriting it.

## Chat and IRC

Hand-written IRC over raw TLS (`node:tls`), no library, no WebSocket. Registration
is two lines — `NICK` and `USER` (`src/main/chat/client.ts:104-109`) — with **no
`PASS`, no SASL and no NickServ identify**; `ChatSettings` cannot hold a password.
Host and port are captured `readonly` at construction, so changing them needs an
app restart, and there is no UI for them.

Chat connects to **SwiftIRC** (`irc.swiftirc.net:6697`, TLS, confirmed by
handshake against its Let's Encrypt certificate), not Libera — this is where
LostHQ's actual community is, in `#LostHQ` (the always-joined lobby) and
`#LostCity` (joined while a Lost City window is open). The existing `tlsConnect`
reaches it unchanged; no WebSocket transport was needed.

- **`https://irc.losthq.rs/` is a web client, not a server.** Only 443 is open on
  that host. Its own defaults are `wss://irc.swiftirc.net:4443/`, joining
  `#LostCity` and `#LostHQ` — the same two rooms this app's raw-TLS client joins
  directly.
- LostHQ's NickServ pass is **optional**, so those rooms are not
  registered-only and the missing password support does not block joining.
- **Zanaris and Labs get no channel.** There is no room for either on SwiftIRC,
  and `chat/channels.ts` deliberately maps them to nothing rather than guessing
  one — a speculative `#Zanaris` would very likely be somebody else's channel on
  a large public network. Having no room is the safe failure; having the wrong
  room is not. The old `#04scape-` prefix served the same purpose on Libera and
  is gone along with it; it is not a convention worth reinventing here.

## No migrations needed — for now

**Nobody has installed this client yet.** `state.json` and `servers.json` have no
users in the field, so a change of defaults does not need a migration path.

> Delete this section at first release. It is a temporary licence, not a rule, and
> inheriting it after users exist would be how their data gets lost.

Note the contrast already in the catalog: `refreshSinglePlayer` and
`refreshHiscores` re-adopt built-in fields from the defaults on **every** launch,
because those fields are the kit's knowledge rather than the user's choice. A
stored entry must not freeze what the kit has since learned. Anything the add form
exposes — name, url, revision, wiki, notes — is the user's and must survive.

## Comments are load-bearing

A comment that describes behaviour the code does not have is a **defect** here,
not a nit, and gets fixed rather than tolerated.

This is not theoretical. Comments corrected recently include one claiming a
scrollbar-hiding rule caused clipping behaviour that `overflow: auto` produces on
its own, and a user-facing string that told the player the page had scaled the
game down when the page does no such thing at the default. If you change
behaviour, re-read the comments around it before you commit.

## Commands

| | |
|---|---|
| `npm test` | 371 tests, `node --test`, pure modules only, no Electron |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run dev` / `npm start` | run it |
| `npm run capture` | screenshot every view — see the hazard below |
| `npm run stage:engine` | fetch and pack the pinned engine |
| `npm run dist` | electron-builder output |

**The capture hazard.** `npm run capture` opens real windows and makes real
network requests, and it can return a **silently stale frame**: a correct-looking
log line and a PNG byte-identical to an earlier shot, if the display sleeps
mid-run. A green log is not evidence. Run it under `caffeinate -d` and compare
file hashes before trusting the output. It is likeliest on any step that awaits a
network round-trip between fronting the window and shooting it.
