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

What a tab switch hides still shows where it went. A background tab holding
the game carries the game's flag, and one holding Your world carries
**Sharing** while a link is live. The tab in front carries neither, since what
it holds is on screen. A live link with no Your world pane in any tab has no
tab to mark, so the bar shows a Sharing button that opens the pane. The
world itself is never marked. It runs for as long as its window is open,
because the game plays on it, so a mark for it would never go away. The rule
is `tabs.marksOfTab` and `tabs.sharingWithoutPane`, pure and tested. Anything
else that keeps running out of sight and can cost the player something gets
a mark there, not in the shell.

The tab close is the easy one to get wrong: removing the tab drops the game's
leaf, and nothing in `paneHost` destroys the game view, because the window owns
it. A tab close once did exactly that and left a logged-in game with nowhere to
be shown. What a tab close takes with it is `tabs.closingTab`, pure and tested;
`serverWindow.closeTab` acts on its answer, asking and destroying the view first.

Everything else about the layout is `src/main/paneTree.ts`: a tab is a tree of
leaves and n-ary splits, and one recursive walk turns it into a rect per pane.
Four properties in there are load-bearing and easy to break —

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
- A window resize **keeps the game's pixels** (`keepGame`) and is fitted from
  the arrangement the player last left (`refit`), **not from the last frame**.
  Shrinking past the other panes' floors squeezes the game; fitted frame from
  frame, growing back would then hold it at the squeezed size for good.
- A pane that is **added** — Add pane's column, Split Right, Split Down — is
  **paid for by the window, not the game** (`makeRoom`): the window grows by
  what the game would have lost, as far as its display allows, and the game
  takes the growth back. The tree is recorded as arranged at the size the
  window is growing to (`arrangedAt`). Left to `refit`, it would be fitted from
  the last frame's size, the growth would read as a resize, and the game would
  be held at the size the new pane squeezed it to while the window grew around
  it. The window grows itself for nothing else — not Reset Game Size, not a
  drop — and never shrinks itself back.

`TOOL_IDS`, in `src/shared/ipc.ts`, is **append-only**. A saved layout file
carries tool ids between people — that is the whole point of saving one — and
`readContent` checks every leaf's id against `TOOL_IDS` before the tree is
trusted at all. One leaf naming an id the array no longer holds sinks the
whole read: `readLayout` refuses the entire file rather than that one pane,
and whoever tried to open it sees "That file isn't a Zanaris Kit layout" over
a tab left exactly as it was. `instantiateLayout`'s own empty-pane fallback
is a different, narrower thing — a tool `TOOL_IDS` still recognises but this
particular window does not currently offer, Hiscores on a server with none or
Your world outside its own window, which is meant to happen and costs only
that pane. So an id, once shipped, is never removed or renamed: a kit that
stopped knowing one would cost someone their whole saved arrangement, not just
the pane that used it, the day they tried to open it here.

> The old invariant said the opposite: opening chrome must never resize the
> game, because resizing cost the login. The second half was never true —
> `setBounds` does not reload a `WebContentsView`, only `loadURL` does — and the
> first half went with the fixed columns that motivated it. The design is
> `docs/superpowers/specs/2026-09-12-panes-and-tabs-design.md`.

## The Settings window

One window is not a game window: Settings, which holds what belongs to the
app rather than to any one window — today the catalog, the startup set and
the themes.
`SettingsWindowSlot` (`src/main/settingsWindow.ts`) keeps it to one, and
opening it again brings the open one forward, because two would be two
copies of one thing. It has no parent window, since a parent would close it
along with a game window, and it never holds up a quit.

It is a window rather than a pane or a popover because the game and pages
are native views stacked above the shell's HTML: anything the shell drew
over them would sit underneath. It takes its state on its own channel,
`settings.get` and `settings.onState`, never through `ShellState`. No game
window's `state()` builds anything for it, which is how `windowCounts()` once
came to recurse through `state()`. Only Settings may call the servers and
appearance handlers.

A catalog entry the kit ships with cannot be removed from Settings,
for a plain reason: `Catalog.load` never puts a missing built-in back. At file
version 5 `migrateCatalog` only validates what is already there, and the four
refresh functions (`refreshYourWorld`, `refreshHiscores`, `refreshBookmarks`,
`refreshTimers`) touch only entries already present — none of them re-adds one
that is gone. So removing a built-in is permanent short of deleting
`servers.json` by hand. The guard is `isRemovable`, in `src/main/servers.ts`;
`Catalog.remove` itself is deliberately left as a general primitive, free to
remove anything a caller hands it, because the rule about which callers may
belongs at the one place that decides, not inside the primitive.

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
- **A silent socket is presumed dead.** After `SILENCE_MS` with nothing from
  the server, `ChatService` sends a `PING`; with nothing back in `ANSWER_MS` it
  drops the socket and reconnects. Any bytes count as an answer, and a wake from
  sleep pings at once, because timers stand still while the machine sleeps.

**The password never enters a log line or the renderer.** `identify()` writes
straight to `send` and never through `push()`. `ChatView.settings` carries only
`hasPassword`. `state.json` holds it sealed by `safeStorage` (`chat/secret.ts`),
and `basic_text` on Linux counts as no store. Keep all three true: a debug line
that logs `sent`, or a view field that echoes the password, is a leak.

**Settings is the only writer of chat's saved nick and auto-join list.**
The ignore list is the one list with a second writer: `/ignore` and
`/unignore` save it through `ChatStart.onIgnoreChanged`, since a person
ignored for this session only would be back on the next launch.
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

**Typed commands:** `parseInput` reads the kit's own — the list is
`COMMANDS` in `shared/chatInput.ts`, which a test keeps in step with it, plus
the aliases `/j /q /wi /back`. Everything else goes to the server as typed
(`Input` kind `raw`), and the reply lands in Status.

**A conversation with one person is a tab named by their nick.** A PRIVMSG to
us opens one; a notice never does, and neither does `/msg`, so NickServ's
answers stay in Status. A conversation is never in the auto-join list, is not
reopened on reconnect, and follows its person through a NICK. Anything said
to NickServ, in a conversation or by `/msg`, is echoed with its secret words
hidden (`hideSecret`).

**Links in the log open only if `linkTarget` says http or https**, read again
in main whatever the shell sent: a chat line is a stranger's writing.

Chat connects to **SwiftIRC** (`irc.swiftirc.net:6697`, TLS, confirmed by
handshake against its Let's Encrypt certificate), not Libera. That is where
LostHQ's actual community is.

- **`https://irc.losthq.rs/` is a web client, not a server.** Only 443 is open on
  that host. Its own defaults are `wss://irc.swiftirc.net:4443/`, joining
  `#LostCity` and `#LostHQ`, rooms this app's raw-TLS client reaches directly.
- LostHQ's NickServ pass is **optional**, so those rooms are not
  registered-only.

## Your world was called Single player

The name changed on 2026-09-20: the feature runs a world on your machine and
Friends shares it by link, so "single player" said the opposite of what it
does. Three stored keys did not change, because they sit in files that already
exist and nothing shows them — the catalog entry's `id` and `kind`
(`singleplayer`), `TOOL_IDS`' `singleplayer`, which saved layouts carry between
people, and `state.json`'s `singlePlayer` block. Renaming one of those is a
migration, not a rename. Everything else reads "your world".

## Your world's builds

The kit ships no engine. Each build line is a recipe, `engines/<id>.json`: the
upstream engine and content commits, the patches, and the published archive's
tag, size and sha-256. The design is
`docs/superpowers/specs/2026-09-19-single-player-builds-design.md`.

- **Pins move by hand, in a pull request.** Nothing follows a branch head:
  upstream changed its config, runtime and web server within 2026, and any of
  those can break the patch. The `engines.yml` pull-request run stages every
  recipe; a dispatch publishes one as a prerelease; `npm run pin:engine -- <id>`
  writes its size and digest. `scripts/engines.test.mjs` fails a recipe whose
  tag was not built from its own commits and patches.
- **The kit runs only what it pins.** `BuildStore` downloads into `.incoming`,
  checks size and digest, unpacks, checks the VERSION.json it unpacked to, and
  only then renames into place. A build on disk that is not this kit's pin is
  *outdated* and does not start: a newer kit may rely on something it lacks.
  There is no exception, packaged or not: `engine-dist/` is what `stage:engine`
  hands to CI and to the archive, never a build the kit offers. Playing a stage
  means publishing it as a prerelease and pinning it. A capture reads the
  builds from the real profile, since its own has downloaded nothing, and
  those are pinned like any other.
- **A recipe must take `patches/engine/` and pass the boot check**, or it
  cannot be a line: the sharing invariants below depend on both. That is what
  "any 04-like server" means here — shaped like Lost City 274 (its layout,
  `world.json`, Node). Bun-era revisions need their own patch and a pinned
  Bun, and are not lines yet.
- **Characters live per revision**, in `<userData>/yourworld/worlds/<rev>/`,
  which is also the world's working directory. A switch never moves a save;
  Copy to… copies one after asking, and never replaces one there.
- Two older trees are left where they are rather than migrated, under the
  no-migrations licence below: `<userData>/singleplayer/data/players/main`,
  from before characters lived per revision, and the whole of
  `<userData>/singleplayer/` from before the tool was called Your world.

## Your world's characters and commands

A character is `worlds/<rev>/data/players/main/<name>.sav`, and the engine finds
it by `toSafeName(typed)`. `src/shared/names.ts` and `src/main/yourworld/save.ts`
are ports of the pinned engines: `JString.ts`, `Packet.getcrc`, `Player.ts`'s
level table and combat formula, and the checks in `PlayerLoading.load`, which
274 and 289 share byte for byte as of 2026-09-19. A change to the engine's names
or to its save format before the varps has to be made there too, and a line
whose engine differs there makes those per-revision. The fixture tests are what
catch a slip.

**Every path in the saves folder is built by `Characters.path`**, which refuses
any name `toSafeName` would change. Nothing typed or picked reaches the file
system another way, and the renderer never sends a path: an import is a
dialog in main and a token.

**Nothing there is destroyed.** A delete, and a character another is about to
replace, go to the system trash first. If the trash refuses, nothing changes;
if a later step fails, the old save is already in the trash and the refusal
says so. Changes to the folder run one at a time, after their question is
answered, and check again what the question was about.

Each build's `COMMANDS.json` is written by `stage-engine.mjs` from its content
checkout, since the kit ships no `.rs2`. The `::` table in
`src/shared/commands.ts` is written by hand from `ClientCheatHandler.ts`, the
same in 274 and 289. It leaves out what your world can never run: the
production-only commands, `::rebuild` and `::random`.

`node.debug` stays off. It does more than keep a player logged in: it enables
random events for staff, in-game developer messages, and loopback map-editor
routes that write content. The owner cut it as a setting on 2026-09-16.

## Sharing your world

A share is a Cloudflare quick tunnel to a loopback relay in main, which
forwards to the world's web port (`src/main/share/`). The link is the only
access control — a world with no login server checks no passwords — so what
the link reaches is the whole security story. Keep these true:

- **Only the web port is ever a relay target.** The management port answers
  `POST /shutdown` with no authentication.
- **The relay forwards `GET`, `HEAD` and the websocket upgrade, nothing else.**
  The one path it answers itself is its readiness path, random per relay, which
  echoes back its own token.
- **`worldJson` keeps `node.debug: false` and loopback hosts.** Debug on makes
  the engine serve `/data/` (the RSA key, `world.json`, every save) and accept
  writes under `/content/`. `share/invariants.test.ts` pins both; if either has
  to change, sharing changes first. The host keys mean something only because
  every build carries `patches/engine/`: upstream binds `0.0.0.0` in code, so
  a build without the patch would ignore them. The stage script's boot check
  refuses a build that answers on a routable address.
- **The share never follows the world's status.** A restart passes through
  `stopped`, and ending the share there would cost the link on every change in
  World, and on every switch of build. It ends on Stop, on the last
  window for your world releasing it, or at quit.
- **cloudflared is the pinned build, checked by digest before every share**, and
  runs with `--no-autoupdate`, an empty `--config` and no `TUNNEL_*` variables.
  Bumping `CLOUDFLARED_VERSION` means new sizes and digests from GitHub's asset
  API — for the macOS archives, the release notes list the binary's digest, not
  the archive's.
- **Live means the link works, and nothing asks a caching resolver about its
  name.** cloudflared registers before the link works: Cloudflare publishes
  the name, and its edge stops answering 530, anywhere from a few seconds to
  over half a minute later. `share/reachable.ts` waits for both — the name on
  every authoritative nameserver that answers, then the relay's token back
  through the link — and after two minutes the share fails. trycloudflare.com
  caches "no such name" for 1800 s, so a resolver asked too early keeps whoever
  uses it out for half an hour. The name goes only to Cloudflare's own
  nameservers, over the kit's own UDP query with recursion off, and to a probe
  pinned to the address they gave: never through `dns.lookup`, `net.fetch` or a
  public resolver.

The engine's own login server was ruled out for passwords: upstream binds it,
and the friend and logger servers, to `0.0.0.0` in code. Turning it on would put
an unauthenticated service that reads and writes saves on the host's network.

## No migrations needed — for now

**Nobody has installed this client yet.** `state.json` and `servers.json` have no
users in the field, so a change of defaults does not need a migration path.

> Delete this section at first release. It is a temporary licence, not a rule, and
> inheriting it after users exist would be how their data gets lost.

Note the contrast already in the catalog: `refreshYourWorld` and
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

## Colours are tokens

Every colour the renderer paints is a `--color-*` token from `styles.css`'s
`@theme` block, which a theme overrides at runtime (`src/shared/themes.ts`).
A literal colour in the renderer is a defect — it does not follow the theme —
and `themes.test.ts` fails on a hex, `rgb()` or `hsl()` one anywhere under
`src/renderer`. It cannot see a named colour (`color: red`), so don't write
those either. Neutral black and white are the only exception. The chat nick
palette is one fixed set, and lives in `themes.ts` beside the contrast check
that holds every theme's wells to it. The `stone` theme and the `@theme`
block are the same values, and a test keeps them so.

A built-in theme is derived from a ground and a trim colour sampled off the
map, never typed in by hand; `scripts/sample-floors.mjs` is where the samples
come from. Every built-in is dark, because the black glyph shadow and the
grain's overlay blend assume it, and `contrastWarnings` finds nothing in any
of them. A player's own theme can be anything: the editor shows its warnings,
and saving is theirs. Built-in ids sit in `state.json` and theme files, so one
once shipped is never renamed.

**The grain has never rendered.** The CSP's `default-src 'self'` refuses the
`data:` SVGs `--stone-grain` is drawn from; a stone capture's tab bar is one
colour across 80,000 pixels. `img-src` adds `zanaris-bg:` and deliberately not
`data:`: switching the grain on changes every surface in every theme, and is
its own decision. Until it is made, the grain comments in `styles.css` and the
README's "Stone has grain" each say, up front, that it is not drawn.

## Theme pictures

A theme's picture is somebody's file — theirs, or a stranger's inside a theme
file — shown in the kit's own pages. Keep these true:

- **Every picture goes through `PictureStore`** (`src/main/pictures.ts`). Its
  type is read off its first bytes, only PNG, JPEG, WebP and GIF are kept —
  never SVG, which carries script — and at most 10 MB and 5120×2880 pixels'
  worth, read off the header: a tiny PNG can decode to gigabytes. It is named by its
  sha-256, and `path` answers only for a name shaped that way, so no name
  reaches outside `<userData>/backgrounds/`.
- **`zanaris-bg:` is handled on the default session only**, where the shell and
  Settings are. The game and page views are partitions of their own and must
  never get it: a page could then read every picture by guessing nothing more
  than a hash.
- **The page never sends a path.** Choose picture… and Import theme… are
  dialogs in main that answer a name; Export is a save dialog in main.
- **Theme files are read strictly** (`themeFile.ts`) and are sized before they
  are read. An import adds a theme and never replaces one. Base64 is checked as
  one character class and a length, never a repeated group: a group repeated
  over a 13 MB string overflows the regex engine's stack.
- **A picture no theme names is pruned** at launch and after a save or a
  delete. The editor is the only place a picture is chosen, and it saves or
  cancels before anything else in Settings can prune. At launch only when
  `appState.fromFile()`: a broken `state.json` is set aside with the themes
  that name the pictures, and pruning against the empty state that replaced
  it would delete every one.

## Commands

| | |
|---|---|
| `npm test` | `node --test`, pure modules only, no Electron |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run dev` / `npm start` | run it |
| `npm run capture` | screenshot every view — see the hazard below |
| `npm run fresh` | set the profile aside so the next launch is a first launch, keeping the builds and the characters |
| `npm run stage:engine -- <id>` | stage a recipe into `engine-dist/` and `engine-<id>.tar.gz` |
| `npm run pin:engine -- <id>` | write a published build's size and digest into its recipe |
| `npm run dist` | electron-builder output |

**The capture hazard.** `npm run capture` opens real windows and makes real
network requests, and `capturePage` hands back the last frame a view
composited. A shell that is not painting — its window covered by another app's,
or the display asleep — composites nothing, so a shot of it is a **silently
stale frame**: a correct-looking log line over a PNG byte-identical to an
earlier shot. `caffeinate -d` covers only the display. The harness guards the
rest: `shoot` waits for the shell to paint (`settle` answers whether it did),
fronting the window again for up to ten seconds; a shell that never paints is
not written, a shell shot byte-identical to an earlier one is flagged
(`shotLedger.ts`), and either makes the run exit 1 with the faults listed last.
A failed run usually means the machine was in use: rerun it under
`caffeinate -d` and leave it alone. Game and page shots are not compared, and
the log reads state, not pixels, so a green run still means opening the PNGs.
