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

**A running game is either visible or obviously suspended, never silently
hidden by a gesture that reads as final.**

Closing the game pane — or a tab holding it — destroys its view and says so
first, through the same confirm the world switch uses. Keeping it alive behind
a closed pane was considered and rejected: it preserves the login, which is the
wrong thing to protect. A character still standing in the world with nobody watching it dies
to events its player cannot see, and that is worse than the fresh login that
reopening costs. Switching tabs is the other case and is fine — it hides the
game the way another app in front of the window already does, which is what
`backgroundThrottling: false` exists to support, and it reads as temporary.

The tab close is the easy one to get wrong: removing the tab drops the game's
leaf, and nothing in `paneHost` destroys the game view, because the window owns
it. A tab close once did exactly that and left a logged-in game with nowhere to
be shown. What a tab close takes with it is `tabs.closingTab`, pure and tested;
`serverWindow.closeTab` acts on its answer, asking and destroying the view first.

Everything else about the layout is `src/main/paneTree.ts`: a tab is a tree of
leaves and n-ary splits, and one recursive walk turns it into a rect per pane.
Two properties in there are load-bearing and easy to break —

- Shares are distributed by **largest remainder**, so children sum to their
  container exactly. A round per child leaves a hairline of shell showing
  between two native views at some window sizes and not others.
- A split left holding one child is **collapsed into that child**. Without it
  the tree accumulates single-child splits, and then a split along what looks
  like the parent's axis nests instead of appending — so close-then-split stops
  behaving like split on a fresh pane. A collapse can still leave a split
  running the same way as its parent (a row collapsing into the column it held),
  so that one is merged into the parent (`absorb`). Every edge drop goes through
  a close, so without it an ordinary drag nests columns in columns.

> The old invariant said the opposite: opening chrome must never resize the
> game, because resizing cost the login. The second half was never true —
> `setBounds` does not reload a `WebContentsView`, only `loadURL` does — and the
> first half went with the fixed columns that motivated it. The design is
> `docs/superpowers/specs/2026-09-12-panes-and-tabs-design.md`.

## Where logic is allowed to live

`src/main/serverWindow.ts`, `src/main/index.ts` and the **entire renderer** have
no test infrastructure. Nothing in them can fail in CI.

So anything decidable belongs in a pure module that `node --test` reaches without
Electron: `main/paneTree.ts`, `main/hiscores/sources.ts`, `main/hiscores/service.ts`.
Services take an injected `io` for exactly this reason — `ChatIo`, `HiscoresIo`,
`WorldsIo` — so the lifecycle can be driven by hand in a test with no socket.

`main/paneHost.ts` is the seam between the two: it creates, bounds and destroys
`WebContentsView`s and can therefore not be tested, so it holds no rules — every
one of them is next door in `paneTree.ts`, and this only reconciles.

Placement rules reimplemented in a window or a renderer are a defect, not a
shortcut. If you find yourself working out a pane's size in the shell, or
clamping a seam there, you are rewriting `paneTree.ts`. The shell is given a
list of rects and draws it; it does not know what a fraction is.

## Chat and IRC

Hand-written IRC over raw TLS (`node:tls`), no library, no WebSocket.

- **Registration** is `CAP REQ multi-prefix`, `NICK` and `USER`, with `CAP END` on
  the answer. There is no `PASS` and no SASL.
- **A saved NickServ password** goes out on `001`, before the JOINs, as
  `PRIVMSG NickServ :IDENTIFY <account> <pass>` (`IrcClient.identify`). The
  account is the nick saved in Settings. Keep the two-word form: the bare one
  identifies whatever nick the connection holds (`matt_` after a 433), and
  services split a password with a space in it into account and password.
- **Host and port** are captured `readonly` at construction, so changing them
  needs an app restart, and there is no UI for them.
- **`tlsConnect.send` refuses** any line holding CR, LF or NUL.

**The password never enters a log line or the renderer.** `identify()` writes
straight to `send` and never through `push()`. `ChatView.settings` carries only
`hasPassword`. `state.json` holds it sealed by `safeStorage` (`chat/secret.ts`),
and `basic_text` on Linux counts as no store. Keep all three true: a debug line
that logs `sent`, or a view field that echoes the password, is a leak.

**Settings is the only writer of chat's saved nick and auto-join list.**
Nothing learnt from the connection is saved. `chatPersist.ts`, which used to
learn the nick from the view, is gone. A services rename to `Guest12345`
saved as the nick would have been the next launch's nick.
`ChatSettingsView.nick` is the saved nick and `ChatView.nick` is the
connection's; the form shows the first.

**Channels come from the auto-join list and nowhere else.** The list defaults to
`#2004scape, #LostHQ, #Zanaris`, is edited only in the Settings tab, and is joined
again on every Connect. Closing a tab or typing `/join` lasts for the session and
never writes the list. The old always-joined lobby and the per-window
`#LostCity` rule (`chat/channels.ts`, `setServers`) were removed on the owner's
call on 2026-09-15; don't bring back rooms that follow windows.

`#Zanaris` is in the defaults because the owner asked for it. The kit used to
avoid guessing a Zanaris room, since on a large public network the name could
belong to strangers. If it turns out to be someone else's channel, change the
default rather than adding a special case.

**Disconnect is persisted** as `chat.autoConnect: false`, so launch stays
offline until Connect. Connect, Disconnect and a typed `/quit` report through
`ChatStart.onConnectionWanted`, the one writer of that flag.
`ChatService.stop()`, for the app quitting, must not call it.

**Typed commands:** `/me /msg /nick /join /part /quit` are read by the kit.
Everything else goes to the server as typed (`Input` kind `raw`), and the reply
lands in Status.

Chat connects to **SwiftIRC** (`irc.swiftirc.net:6697`, TLS, confirmed by
handshake against its Let's Encrypt certificate), not Libera. That is where
LostHQ's actual community is.

- **`https://irc.losthq.rs/` is a web client, not a server.** Only 443 is open on
  that host. Its own defaults are `wss://irc.swiftirc.net:4443/`, joining
  `#LostCity` and `#LostHQ`, rooms this app's raw-TLS client reaches directly.
- LostHQ's NickServ pass is **optional**, so those rooms are not
  registered-only.

## Single player's characters and commands

A character is `data/players/main/<name>.sav`, and the engine finds it by
`toSafeName(typed)`. `src/shared/names.ts` and `src/main/singleplayer/save.ts`
are ports of the pinned engine: `JString.ts`, `Packet.getcrc`, `Player.ts`'s
level table and combat formula, and the checks in `PlayerLoading.load`. A change
to the engine's names or to its save format before the varps has to be made
there too. The fixture tests are what catch a slip.

**Every path in the saves folder is built by `Characters.path`**, which refuses
any name `toSafeName` would change. Nothing typed or picked reaches the file
system another way, and the renderer never sends a path: an import is a
dialog in main and a token.

**Nothing there is destroyed.** A delete, and a character another is about to
replace, go to the system trash first, and if that fails nothing changes.

`engine-dist/COMMANDS.json` is written by `stage-engine.mjs` from the content
checkout, since the kit ships no `.rs2`. The `::` table in
`src/shared/commands.ts` is written by hand from `ClientCheatHandler.ts`. It
leaves out what single player can never run: the production-only commands,
`::rebuild` and `::random`.

`node.debug` stays off. It does more than keep a player logged in: it enables
random events for staff, in-game developer messages, and loopback map-editor
routes that write content. The owner cut it as a setting on 2026-09-16.

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
| `npm test` | `node --test`, pure modules only, no Electron |
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
