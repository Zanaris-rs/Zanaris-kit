# Zanaris Kit for 04scape

An Electron client that opens several 04scape servers at once, one window per
server, where every window knows which server it is running and can hop
between that server's worlds.

**Status: split panes — any pane, any axis, dragged and closed like iTerm —
on top of the reference pane and your world.** The window is a tree of
panes now rather than four fixed regions: the game, a reference page and any
tool can sit anywhere in it, split left/right or up/down, and every seam
drags. A fresh pane shows a launcher of this server's links and this window's
tools. Workspace tabs are in, and so are layouts saved as files you can hand to
someone else; background images follow.
The design is in `docs/superpowers/specs/2026-09-12-panes-and-tabs-design.md`,
which supersedes the layout halves of the server-windows and chat-dock specs
beside it; the plans are under `docs/superpowers/plans/`.

## Download

Installers for macOS, Windows and Linux are on the
[releases page](https://github.com/Zanaris-rs/Zanaris-kit/releases/latest):
`Zanaris-Kit-<version>-universal.dmg`, `Zanaris-Kit-Setup-<version>.exe` and
`Zanaris-Kit-<version>.AppImage`.

The builds are not signed with a developer certificate, so each system asks
once before running something it cannot attribute:

- **macOS.** Open the DMG and drag Zanaris Kit to Applications. The first
  launch is refused with "Apple could not verify". Open System Settings >
  Privacy & Security, scroll to the message about Zanaris Kit, and choose
  **Open Anyway**. It asks once more; after that it opens like any app.
- **Windows.** Run the installer. SmartScreen says "Windows protected your
  PC": choose **More info**, then **Run anyway**. It installs for your user
  only and needs no administrator password.
- **Linux.** `chmod +x Zanaris-Kit-<version>.AppImage` and run it. If it
  complains about FUSE, install `libfuse2` from your distribution. On Ubuntu
  24.04 it may instead refuse to start with a sandbox error, because AppArmor
  there restricts unprivileged user namespaces: run it once with
  `--no-sandbox`, or allow them with
  `sudo sysctl kernel.apparmor_restrict_unprivileged_userns=0`.

The kit checks the releases page once each time it starts and, when there is
a newer version, adds Help > Update Available, which opens that page. Set
`ZANARIS_NO_UPDATE_CHECK=1` to turn the check off.

## What it does

There is no launcher or management window; there are only game windows. New
ones come from the **File menu**: New Window (Cmd/Ctrl+N) opens another window
of the focused window's server, and New Window For lists the catalog. At
startup the app opens the first server in the catalog, Lost City. On macOS the
app keeps running with no windows and the dock menu opens one; elsewhere
closing the last window quits, since the menu lives in the window.

A **server window** is bound to one catalog entry for its whole life. The game
pane's own header reads "Lost City · W5 · low · 43 ms": the server, the world,
the detail level and the latency to that world's host, measured every ten
seconds. It is the window's fact rather than the pane's — one server, one game —
and it sat at the left of the tab bar for exactly that reason, until it became
clear that a read-out nobody can place is a read-out nobody reads. Beside the
game it describes, it is obviously about the thing under it, and the bar is left
to tabs. The first of the server's tools is **Worlds**, opened from **Add pane**
at the right end of the tab bar like everything else a pane can hold. What it
shows is Low / High detail, then every world with region, players online, members or free, and
latency, the current world marked. Choosing a world loads it in the same
window; flipping detail reloads the current world. The world and detail you
chose are remembered per server; the next window for that server opens there.

Either switch asks first. The dialog names where you are going and says the
switch happens whether or not you are logged in: Zanaris Kit loads the page
straight away, and if you are in game that logs you out. Switch goes, Cancel
changes nothing. The dialog carries a "don't ask again" checkbox, and ticking
it is reversible from View > Warn Before Switching Worlds, which shows the
current setting.

Opening the same server twice gives the second window its own storage
partition (`persist:server:<id>:2`) and the title "Lost City — World 5 (2)",
so two accounts on one server never share cookies or client prefs. Slot
numbers are reused once a window closes.

**View > Always on Top** pins the window you are in above other apps, so the
game stays visible while you are reading something outside the kit. It pins
the focused window rather than all of them — four windows all claiming the top
is four windows covering whatever each was pinned above — and the checkbox
follows focus, so it reads the window in front of you and is greyed out when
none is. What is remembered is simply the last thing you asked for: windows
opened after it, and the next launch, start pinned or unpinned to match.

**Hiscores** is the other server tool, offered for the three remote
servers only — a one-player world has nobody to rank, so your world never
gets it. A name box and a Look up button sit above a Skill · Rank · Lvl · XP
table; the lookup fires on submit, never on a keystroke, since Lost City
rate-limits after a handful of requests inside a minute and typing a name would
spend that budget before you finished it. Overall comes first and is picked out
in gold, then whatever skills the server actually sent — Lost City Labs runs a
later revision than 274 and returns Slayer and Farming rows 274 never will, so
the table shows exactly what a lookup handed it rather than a fixed list. A
name nobody holds gets its own message instead of an empty table or a raw
error, and a 429 gets the same plain rate-limiting sentence wherever it comes
from. Lost City's raw API carries xp with one extra digit of precision, a
genuine tenth the client keeps internally; main's parser floors it away before
the panel ever sees it, matching the whole numbers Zanaris and Labs already
send, which is the one place comparing the panel against the raw API will look
wrong without being wrong. The **Full hiscores** link at the foot opens the
server's own page in your system browser rather than in the reference pane —
the pane shows the server's own curated links and refuses anything else, so the
label says where the link goes rather than leaving a new window to explain
itself.

**Timers** is in every window. It holds countdowns, which run down to 0:00, and
timers, which count up. Every clock has a threshold, a volume and AFK mode. A
countdown alerts when it has that much left and then holds at 0:00; a timer
alerts once when that much has passed and keeps counting. An alert is a silent
system banner — shown only when the window is not the one in front — and a
sound the kit plays at the clock's volume, since a banner's sound cannot have
its volume set. The sound is the same on every platform:
`static/sounds/alert.wav`, `confirmation_002` from
[Kenney's Interface Sounds](https://kenney.nl/assets/interface-sounds) (CC0),
made 6 dB louder with a limiter so it carries over the game. The system's own
alert sound was tried first and was too quiet.

The time is the largest thing in each row, with the clock's name, its kind and
AFK mode small above it and Start or Pause, Reset and Edit as small glyphs beside
it. One button in the pane is gold at a time — Add, or Save while a form is open —
and the rest are quiet.

Every server comes with two countdowns. **AFK** is 90 seconds with a 15-second
threshold and AFK mode on: a click or key anywhere in the game pane starts it
again, and a world switch sets it back to waiting for the next input. That is
close to the client's own idle timer but not the same. The client counts mouse
movement too, which the kit does not, so the warning can come early. But the
client counts only input on the game's own picture, so a click beside the game,
on the page around it, restarts the countdown without resetting the client's
idle timer, and then the warning can come late: click the game itself.
**Thieving** is five minutes with a 30-second threshold, for an npc that
despawns when it has not moved for that long; press Reset when it moves. Both
can be edited and restored to their defaults. Clocks you add are yours
everywhere, in every server's windows; the clocks themselves run per window,
since each window is its own login, and they keep running with the pane closed.

**The launcher** is the way into the reference pages, and it is what an empty
pane shows. It lists this server's links, in order — for Lost City: Forums,
Coordinates, Clue Help, Puzzle Solver, World Map, Markets, Quest Guides, Skill
Guides, Skills Calculator, Bestiary and Item Database; for Zanaris the nine of
those that are not Lost City's own forums and prices; for Lost City Labs and
your world nothing — alongside the tools this window offers and the game.
Clicking one fills the pane you are looking at. Split first and you fill the new
half instead, which is how two pages end up side by side.

There is one game per window and there always will be: two of them side by side
would read as an endorsement of multi-boxing, and the window has one storage
partition and one login. So the launcher's game entry **moves** the game rather
than offering a second — it says "Move game here" when the game is somewhere
else, in this tab or another, and the pane it leaves shows the launcher. That
costs nothing: the view is repositioned, never reloaded, so a move keeps you
logged in exactly as dragging a seam does. Only a window whose game pane has
been closed pays a fresh login, and that is the close doing it rather than the
move.

There is no Guides tool any more. A chooser inside the pane it is about to fill
is a shorter path than a panel that opens somewhere else and puts the page
somewhere else again.

Each tab keeps its own live view for as long as it is open, so switching
between them is instant and nothing reloads — a half-filled coordinate
lookup, a map panned to where you are standing and a drop table scrolled to
the right row are all still there when you come back to them. A page pane's
header carries back, forward and reload and no address box: it browses freely
within the hosts that server allows, and a link off them opens in your system
browser instead. Every seam drags, on both axes, and the pane before a seam —
the one to its left, or above it — is the one that grows as you push the seam
away from it.

**Your world** needs no server at all: File > New Window For > Your world
starts a world on this computer. The kit does not carry the server itself. The
first time, the window offers to download it — a build of Lost City, about
50 MB, from the kit's own releases on GitHub, checked against a digest this
version of the kit carries before anything runs. There is no account and
nothing to sign up for — any name typed at the login screen becomes a
character, and its saves live in the app's own data folder, one world per game
revision: `Application Support/zanaris-kit/yourworld/worlds/274/data/players/main`
on macOS, `%APPDATA%\zanaris-kit\yourworld\worlds\274\...` on Windows,
`~/.config/zanaris-kit/yourworld/worlds/274/...` on Linux. The Your world
tool says what the world is doing, and has five sections. **World** holds what the kit
writes into the world's configuration: Cheats, which turns the engine's
developer commands on for the whole world; an XP rate of 1×, 2×, 5× or 10×; and
Members, which off makes it a free world. Each change restarts a running world,
so it logs you out and asks first. **Characters** lists every save with its
combat level, total level and play time, and imports, exports, renames, copies
and deletes them; a deleted character, or one another replaces, goes to the
system trash. The game writes a save when you log out and every 15 minutes.
**Commands** lists what cheats unlock: the content's debug procs, typed
`::~name` in the chat box, and the engine's own `::` commands. The game cannot
paste, so the list is there to read and type from. **Builds** lists the builds
this kit knows — Lost City 274, and Lost City 289, which Lost City itself marks
as for developers — and downloads, switches between and removes them. Each
revision keeps its own characters: switching from 274 to 289 starts with none,
and switching back finds them again. Characters' Copy to… copies one across,
after saying the other game may read it differently, since a save holds items
and progress from the game that wrote it. **Friends** shares the world with a
link; see Playing with friends below.

Your world is not a live one, and it does not pretend to be: the RuneScape
Guide will offer to skip the tutorial, whether cheats are on or off and however
many characters you start. That is deliberate. Nobody should have to redo the
tutorial on their own machine to get to the game, and a world that only you, and
whoever you share it with, can reach has nothing to protect by making them. What
the Cheats switch controls is the staff level the world gives you and everyone
you share it with: it turns the developer commands on, and with them the few
things the game does differently for staff — random events, for one, stop.

**Playing with friends.** The Your world tool's Friends section lets friends
join that world from a browser. Share with friends downloads Cloudflare's tunnel
program the first time — 19 to 55 MB depending on the system, from Cloudflare's
own GitHub release, checked against a digest pinned in the kit — then opens a
free Cloudflare quick tunnel, which needs no Cloudflare account. Once the link
works from the internet, which takes from a few seconds to about a minute, the
kit shows it: a `https://<words>.trycloudflare.com/rs2.cgi` link to copy. A link
that has not worked within two minutes ends the share, with Try again. Until
then the kit asks only Cloudflare's own nameservers about the link: an ordinary
resolver that asks too early can go on saying it does not exist for half an
hour. The kit asks before
the download and before every share. The link lasts until you stop sharing,
close the last window for your world, or quit. Restarting the world, which any
change in World does, keeps it: friends reload once the world is back. Each new
share gets a new link.

The link is the only lock. A world on this computer checks no passwords, so
anyone holding the link can log in as any character, yours included, and has
cheats whenever you have them on. The kit says so before it shares and, above
whichever section is open, for as long as it does. Friends join with the web
client only. Cloudflare offers quick tunnels for testing, with no uptime promise
and a cap of 200 requests in flight at once, which a ten-player world stays well
under.

Nothing is injected into a game page: no preload, no main-world code. The page
that runs is byte-for-byte the page the server served. A modified client is
both the most detectable thing we could ship and the most likely to be against
server policy. LostKit 2 injects a preload for its screenshots, zoom and AFK
detection; everything equivalent here is done from main or not at all.

## Chat

Chat is one IRC connection for the whole app, not one per window: it stays up
while you open and close game windows, and every window shows the same
conversation. It connects to SwiftIRC over TLS, the network LostHQ's community
actually uses, and joins the channels on its auto-join list:
`#2004scape, #LostHQ, #Zanaris` until you change it.

Its tabs are **Settings**, **Status**, then one per channel in the order they
were joined:

- **Settings** can't be closed. It has the nickname, an optional NickServ
  password, the auto-join list, and Connect or Disconnect.
- **Status** is where the server talks to you. It shows the welcome, the
  message of the day, notices, private messages and anything refused. It can't
  be closed either.
- **Every channel has its own close.** Closing a tab leaves that channel for
  the session, and `/join` joins one for the session. Only Settings changes the
  saved list, and each Connect joins that list again.
- **The nick works the same way.** A `/nick`, the underscore added to a taken
  nick, or a services rename to a guest nick lasts for the session. Settings
  shows the saved nick and, while they differ, what the connection is called.
- **Disconnect is remembered.** A kit you disconnected stays offline on its
  next launch until you press Connect.
- **The NickServ password** is sent when the server welcomes you, as
  `IDENTIFY <saved nick> <password>`, so a password with spaces works and the
  right account is identified even under a fallback nick. It goes out before
  the joins. Services may still confirm after them, so a registered-only room
  can refuse; that refusal shows in Status.
  - It is sealed by the system's own secret store (Electron's `safeStorage`)
    rather than written into `state.json` in the clear.
  - The chat pane is never given it back.
  - Where there is no real store, such as Linux with no keyring, it is kept only
    until you quit, and Settings says so.

Inside a channel, each line carries the time it arrived, with the full date in
its tooltip. The topic sits above the log, with who set it and when in its
tooltip. The user list is ranked first and named second: owners, admins and
ops in gold, half-ops in orange, voices in green. Each nick has the same colour
as in the log. Above the list are the user count, the channel's modes and the
date it was created.

Chat is a pane like anything else: drag its header to wherever you want it, drag
its seams, close it. A new window opens with it already there, in a pane below the game —
chat is the kit's own reason to be open instead of a browser tab, and a pane
nobody knows is there is a pane nobody opens. Closed, it comes back from **Add
pane** in the tab bar, as a column down the tab's right edge.

It draws itself two ways, and picks between them by reading its own width
rather than remembering a preference. A conversation is a column of short
lines, and at 320px almost every one of them wraps. Past about 560px the same
log runs wide and short instead, so six rows hold roughly what eleven hold in a
narrow column. Wide, the tabs keep to one row and the user list sits beside the
log. Narrow, the tabs wrap, and a "12 users" button on the topic bar swaps the
log for the list. Dragging the seam is what "move chat to the bottom" used to
mean.

The first time you open chat it opens on Settings, because there is nothing
sensible to default a nick to, and a name others see should be chosen rather
than assigned. Nothing connects until you pick one, which is also why an
unattended capture run never opens a socket. `/me`, `/msg`, `/nick`, `/join`,
`/part` and `/quit` are the kit's own: they change what it draws, so it has to
understand them. `/quit [reason]` is the Disconnect button, remembered the same
way, rather than a dropped connection the kit would reconnect behind. Every other slash command goes to the server as typed — `/invite bob
#LostHQ`, `/whois`, `/mode`, `/kick` — in IRC's own argument order, colons and
all, so `/topic #LostHQ :hello there` needs its colon or the server keeps only
the first word. The answer comes back in Status, including the complaint when
the command was a typo. A slash followed by something that is not a command at
all, like `/123`, is still refused here rather than sent.

The protocol layer is hand-written and tested rather than a dependency: a
parser and serializer for the commands and numerics this needs, including the
server's ISUPPORT rank prefixes, which modes take a parameter, and the
`multi-prefix` capability, so someone who is both op and voiced keeps their
voice when they lose op. The client is
pure over an injected `send`, so the whole conversation can be driven in tests
without a socket. The service around it owns the TLS socket and the reconnect
backoff, which grows and caps: a client that retries harder the longer a
network is down is a client that gets banned.

Not carried over from LostKit, which reaches LostHQ's community through
`https://irc.losthq.rs/`, a hosted web client rather than a server: that host
exposes no public IRC port. But it is the same room, not a different one — the
web client's own defaults are `wss://irc.swiftirc.net:4443/`, joining
`#LostCity` and `#LostHQ`, and SwiftIRC also exposes ordinary IRC ports, so
this app's raw-TLS client reaches those same channels directly.

## How it looks

The client is dressed as the game it launches. The 2004 interface is built from
warm olive stone: panels around `#443d31`, tabs cut into it at `#342e24`, lists
recessed to `#37311f`, gold headings, cream text and yellow-green values. Those
numbers were sampled out of a screenshot of the running client, quantising each
region so the stone separated from the text, rather than guessed.

Three things carry the period feel, and all three are load-bearing rather than
decorative:

- **Bevels are explicit.** Light above and left, shadow below and right, on
  every raised surface, inverted for every recess. CSS `outset` derives its
  edges from a single colour and always reads flat by comparison.
- **Stone has grain.** Two layers of noise, a fine one and a slower blotch,
  blended over the base colour. Overlay blending lightens as much as it
  darkens, so the base sits below the sampled mid to compensate.
- **Every glyph has a hard black shadow.** The client does this, and without it
  text fights the grain and loses.

Tabs are not a row of buttons on a dark strip: they are cut *into* the stone,
resting ones sunk with an inner shadow and the open one raised and lit. That is
how the client draws its inventory and friends tabs, and it is what makes the
open tab obvious.

Type has two roles. Headings and buttons are set in Pixelify Sans, bundled at
`src/renderer/fonts/` under the SIL Open Font License and loaded from disk so
the interface never waits on the network. Everything carrying data is Arial.
That split is forced rather than chosen: in Pixelify Sans a 5 reads as an S and
a 7 as a 1, so an early build showed "W5" as "WS" and "59 online" as "S9
online". A world switcher cannot afford that.

Latency colour marks the standout rather than grading everything. Most worlds
sit in a band set by where you live, so colouring them all by absolute
thresholds painted the whole column orange and said nothing. Green marks a
world worth switching to, orange one that is genuinely far, and everything
between is left as a plain number.

The mockups this was ported from live in `design/`: `build.mjs` generates the
artboards, and `seed-canvas.mjs` from the design skill packages them into a
canvas. The seeded output is gitignored because it is 2.5 MB of editor payload;
regenerate it rather than committing it.

## Why a window keeps playing when it is not in front

All three hosted clients drive their main loop with `setTimeout`; none of the
served bundles contain `requestAnimationFrame`, and `visibilitychange` is used
only to resume audio. Chromium throttles timers in a background window to once
a second, which would stall any game you were not looking at.
`backgroundThrottling: false` on each game view turns that off.

## The catalog

`<userData>/servers.json` (on macOS, `~/Library/Application Support/zanaris-kit/`),
seeded on first run, one entry per server, now at file version 5:


| id | revision | worlds from | detail switch | wiki |
|---|---|---|---|---|
| `lostcity` | 274 | LostHQ's world API (`2004.losthq.rs/pages/api/worlds.php`), which carries players and both detail URLs | yes | losthq |
| `zanaris` | 274 | `zanaris.rs/worlds.json`, players from each world's `world.json` | yes | losthq |
| `lostcitylabs` | unknown, "May 2005 per Lost City Labs" | a static list, worlds 1 to 4 | no parameter found | none |
| `singleplayer` | the build line it runs, 274 until another is picked | none | | losthq |

The last id is the one the tool was called before it was Your world. It is a
key in files people already have — a stored `servers.json`, a saved layout —
so it stays as it is; nothing shows it.

Each entry carries a `worlds` block (the source, a URL template with `{world}`,
`{url}` and `{lowmem}`, whether detail is switchable, the default world),
`bookmarks` — the reference links the Guides list offers, which is also the
whole of which servers offer it: Lost City has eleven including its own forums
and prices, Zanaris the nine that are not Lost City's, and Labs and single
player none, so their menus list no links — the `hosts` those pages may visit,
and a wiki URL that never claims which revision it describes, since losthq
moves on its own schedule. The three remote entries also carry a `hiscores`
block: a `source` — a `kind` naming which of the three lookup APIs it is, plus
the URL for it — and a `site` the panel's "Full hiscores" link opens. Version 3
kept only Lost City's as a bare URL template; version 4 is what turned it into
this shape, and what gave Zanaris and Labs one of their own for the first time.
Your world carries no `hiscores`, since a one-player world has nobody to
rank. Every entry also carries `timers`, the server's built-in clocks,
re-adopted on every launch the same way `hiscores` is; version 5 is what added
it.

A built-in server's `hiscores` is read back from the defaults above on every
launch rather than frozen from the file on disk — the same trade single
player's own revision already makes. It is the kit's knowledge, not something
the add form ever offered a way to set, so hand-editing or deleting one only
lasts until the next launch, when it comes right back.

The app was called SwiftKit until the rename, and `userData` follows the
package name, so that directory used to be `.../Application Support/swiftkit/`.
The first launch after the rename carries the old profile over — `servers.json`,
`state.json`, and the game logins and caches under `Partitions/` — taking each
of the three only if the new directory has not got it already, since Chromium
builds that directory during startup before any of our code runs. See the note
at the top of `src/main/index.ts`.

Until the settings panel arrives, the list is edited as a file: File > Edit
Server List… opens it in your editor, and the app re-reads it when it regains
focus, or from File > Reload Server List. A file that cannot be read is renamed
to `servers.json.broken-<timestamp>` and the defaults are written in its
place; a message box says so. A version 1 file from the launcher-era build
(one entry per world) is migrated in place: its built-in entries become the
per-server ones above and any custom entries are kept. The ids changed with
it, so each server's storage partition starts fresh once. A window keeps its
own copy of its server, so editing the file never affects windows already
open.

`<userData>/state.json` remembers the last world and detail per server, and
whether the switch confirmation still shows. It is
not configuration and never interrupts a launch: a broken file is kept aside
and the state starts empty. It does not remember pane layouts: those are saved
only when you ask, as files of their own (see Layout below).

## Layout

Main owns all geometry. Each server window is one full-window **shell** view
(React, the only view with a preload) with the game and page views placed on
top of it, inside the rects main worked out.

A window is a bar across the top and a **tree of panes** in everything below
it. A pane holds exactly one thing — the game, a reference
page, or one of the tools — and any pane can be split left/right or up/down,
dragged at its seams, or closed. Splitting a pane halves that pane's own share
and leaves its neighbours where they are; splitting along the grain of an
existing row appends to it rather than nesting, which is what keeps a seam drag
moving exactly the two panes either side of it. Repeated splitting halves each
time, as it does in iTerm and tmux, and **Even Out** in the View menu is what
answers "make these the same size".

**Add pane**, at the right end of the tab bar, adds a pane without splitting one
by hand. It lists what a pane's own dropdown does — the tools, the game, this
server's links — and whatever you pick opens as a new column down the tab's
right edge: 320px wide, or an even share of the row on a narrow window, with the
columns already there giving up the room in proportion. It adds rather than
replaces — a pane's dropdown changes that pane, Add pane adds one. Something
already in the tab is ticked, and choosing it goes to that pane rather than
opening a second copy; the game, when it is in another tab, is moved here. With
no room for another column above the 120px floor, everything not already open is
greyed. It replaced a rail of tool icons down the window's right edge, which
reached only the tools, put them in whichever pane had focus, and gave no sign
that a second pane was possible.

Panes are rearranged by dragging one header onto another. Where on the other
pane you let go decides what happens:

- **An edge** (the outer quarter of the pane on that side) splits that pane and
  moves the dragged one into the half on that side. Along the grain of a row or
  column it joins it, taking half the target's share; across it, the target
  and the dragged pane nest in a new split. The pane you dragged leaves its old
  place the way a close would, so its neighbours take back the room.
- **The middle** swaps the two panes, and nothing else moves: every other
  pane's size and every seam stay exactly where they were.

A gold box shows exactly where the pane will land. It is main's own layout of
the result, not an estimate, so the pane ends up where the box was. An edge
too small to hold two panes above the 120x80 floor is outlined dim and dashed,
says "Too small to split", and letting go there does nothing. So does letting
go over a seam or the tab bar, and Escape cancels a drag. A click on a header
still only focuses its pane: a press has to move a few pixels before it drags.

The header is the handle because it is the only part of a game or a page pane
the shell can see; those are native views stacked above it and they take every
pointer event that lands on them. For the length of the drag the views are
hidden and each pane says its own name, for the same reason: a drop target
painted under a game view would be invisible. Nothing reloads — it is the same
hiding a tab switch does. A page keeps its history wherever it is dropped,
since the pane moves whole rather than handing its contents to another.

The pane you are standing in — the one Cmd/Ctrl+D and Cmd/Ctrl+W act on — has a small gold dot before its name in its header, shown
only when the tab has more than one pane. It used to be a gold ring drawn round
the whole pane, which was the loudest line in the window for the least
interesting fact in it.

Right-clicking a pane offers Split Right, Split Down, Even Out and Close, each
with its shortcut beside it, and focuses that pane first so the menu acts on
what was clicked. A split that
could not be drawn — either half under the 120x80 floor — is offered greyed
rather than offered and then refused, and so is Close on a tab's only pane when
it is already empty, since closing it would empty an empty pane. The same four are in the View menu with
Cmd/Ctrl+D, Cmd/Ctrl+Shift+D, Cmd/Ctrl+W and Cmd/Ctrl+Alt+=; tabs are
Cmd/Ctrl+T, Cmd/Ctrl+Shift+W and Cmd/Ctrl+1 to 9. **Cmd/Ctrl+W closes a pane,
not the window** — the window goes when its last tab does.

Each tab carries its close inside it and is named for its **first pane**, the
top-left one, in the words that pane's header uses — a link's curated name, a
tool's name, "Game" or "Empty" — so clicking between panes never renames the
tab under the pointer. Closing a tab that holds the game asks first, as closing
the game's own pane does: either one destroys the game view and logs the player
out, rather than leaving a live game in the world with nowhere to show it.

A fresh pane is empty and shows a launcher: this server's links, the tools this
window offers, and the game. That list is why there is no longer a Guides tool —
a chooser in the pane it is about to fill is a shorter path than a panel that
opens somewhere else and puts the page somewhere else again.

**Every pane has a header**, 32px of stone across its top, and the native views
are inset below it so it costs that pane's height rather than the window's. It
carries four things and refuses a fifth. The pane's **name** comes first — a
link's curated name from the catalog rather than the page's own `<title>`, which
changes as you click through a wiki and would make the pane's identity move
under it; then the tool's name, or "Game", or "Empty". Then **that pane's own
controls**, which only a page has: back, forward, reload. Then a **dropdown**
that changes what the pane holds, offering the same list the launcher does and,
under a rule, Split Right and Split Down — because nothing on screen says a
right-click exists, and the arrow is the control a new player will actually try.
Last, a **close**, the same act as the right-click menu's, which asks first on
the game's pane. Nothing else gets controls: Hiscores' name box, Worlds' detail switch and chat's
Send stay in the pane body, because they are the pane's *work* rather than its
identity, and a header that collected them would become a second body.

The dropdown is a native menu main pops rather than a panel the shell draws.
In a game or page pane the header sits directly above a `WebContentsView`, so
anything drawn below it by the shell would open behind that view — and building
it in main is what lets one menu serve all four kinds of pane, the same way the
right-click menu does. Which items it offers, what they are called and which one
is already showing are decided in `main/paneMenu.ts`, which is pure and tested,
for the reason the right-click menu is: an item offered and then refused is
worse than one never offered, and the launcher would otherwise be a second
opinion about the same question. It was a second opinion, and it was wrong.

The window never resizes itself any more. Opening the old panel or dock grew the
window rather than shrinking the game, through a `widen → shift → push` ladder,
because reloading or rescaling the game view was believed to cost the player
their login. That turned out not to be true of resizing — `setBounds` does not
reload a `WebContentsView`; only `loadURL` does, which is why a world switch
warns and a drag does not — and with the game an ordinary pane there is no
chrome opening beside it to make room for. Splits divide space that is already
allocated, so the ladder, the per-axis mode notes and the protected content
extent all went with the columns that motivated them.

What a small game pane costs is the bottom of the canvas. The served page does
not rescale to follow unless the player picked **Auto Sizing** from the controls
under the game, so the canvas clips rather than shrinking — still reachable by
scrolling, though with no bar to hint at it, since the injected stylesheet hides
them. 765x503 plus the client page's controls strip plus the pane header — 765
by 567 — is what a game pane *asks for* when it is first placed, and what the
window opens at, not a floor anything protects.

Below that the client page is not ours: every server serves the same template,
and its own `overflow: auto` around a `100vh` centring column can put up a
vertical and a horizontal scrollbar that induce each other once the game view is
shorter than the page's natural height. Main injects a small stylesheet into the
game view's `dom-ready` (the kit's own offline and starting pages are left
alone) that hides the scrollbar — a hidden bar reserves no gutter, which is what
actually stops the two axes inducing each other — and separately swaps that
`100vh` for a percentage of the view's own height, which keeps the canvas centred
in an oversized pane now that `vh` is gone rather than fixing anything itself.

Nothing about the arrangement is saved on its own. A new window always opens
the same way — the game at its full 765x567 (765x573 on Lost City, whose client
page has a taller controls strip and drew scrollbars at the stock size), a 232px
chat pane below it, and the game's pane focused, so a split starts from the game
rather than from chat. The
window opens tall enough for both and no taller than the display it opens on;
on a display too short for that, chat gives way to its 80px floor before the
game loses any height.

A layout is saved on purpose, from the menu a **right-click on a tab** raises:

- **Save Layout…** writes that tab's panes — the splits, the seam positions and
  what each pane shows — to a `.json` file named for the tab, in that server's
  own folder, `<userData>/layouts/<server>/`. The save dialog lets you rename it.
- **Load Layout** lists that folder's layouts by name and replaces the tab's
  panes with the one you pick. **From File…** loads one from anywhere, such as a
  file somebody sent you.
- **Open Layouts Folder** opens the folder in Finder or Explorer, which is how a
  layout is shared: copy the file out, or drop somebody else's in.
- **Close Tab**, the same close as the one inside the tab.

The window used to save its arrangement after every split and seam drag, which
made the last accident the thing the next window opened with, and left nothing
to hand anyone.

A layout file holds no pane or split ids — the window hands out its own on load
— and is validated whole and refused whole, with a sheet saying the file is not
a layout and the tab left as it was. A layout made on another server still
loads: a tool this window does not offer, or a page that is not one of
this server's links, comes up as an empty pane showing the launcher rather than
failing the rest. Loading keeps the one-game rule. A layout with a game pane
moves the game into it from wherever it was, with no reload; a layout with no
game, loaded over the tab that holds the game, is closing the game, so it asks
first and ends the game view exactly as closing that tab would.

The floor on a pane is 120x80: the point at which it stops being able to show
that it exists, not the point at which its content is comfortable. A pane that
lands under it is held there and its siblings pay; when even the minimums do not
fit, every pane is cut by the same proportion, because clipping everything a
little beats clipping one pane to nothing.

## Running it

```sh
npm start            # build + launch
npm test             # the pure modules, no Electron
npm run typecheck
npm run capture      # open every server, screenshot every view, hop a world, exit
npm run stage:engine -- <id>  # stage engines/<id>.json into engine-dist/ and engine-<id>.tar.gz (default lostcity-274)
npm run pin:engine -- <id>    # write a published build's size and digest into its recipe
npm run dist         # package this platform into release/
```

Your world's builds are recipes, one file per line under `engines/`: the
engine and content commits of Lost City upstream (`LostCityRS/Engine-TS` and
`LostCityRS/Content`) at one of its revisions, the patches the stage script lays
over the engine, and the published archive's size and sha-256. Your world is
that game, not a fork of it. The one exception is `patches/engine/`: three
backwards-compatible changes a world running on a player's own machine needs,
on their way upstream. `patches/engine/README.md` says what they are and why.
Any server shaped like Lost City 274 — its layout, `world.json`, Node — can be a
recipe, as long as that patch applies and the stage script's boot check passes.

CI builds them. The Engines workflow stages every recipe on a pull request that
touches one, and on a manual dispatch stages one and publishes it as a
prerelease of this repository, under a tag naming both commits and the patch
set. `npm run pin:engine -- <id>` then writes GitHub's size and digest for it into
the recipe, and the kit, which carries every recipe, runs no build whose digest
it did not ship with. `RELEASE.md` says how to move a build and how a release is
cut. Everything under `engine-dist/`, `.engine-work/`, `engine-*.tar.gz` and
`release/` is build output.

A staged `engine-dist/` is not a build the kit will run. It is what
`stage:engine` hands to the archive and to CI, and nothing else: playing a
stage means publishing it as a prerelease and pinning it, which is what
`engines.yml` and `pin:engine` are for. The kit offers no unpinned build,
packaged or not.

Capture mode (`ZANARIS_CAPTURE=<dir>`, settle time `ZANARIS_CAPTURE_WAIT` in
ms, default 15000) writes each window's shell and game views separately,
because a window's own webContents holds nothing when its content lives in
child views. It opens the panel on a loaded window, opens the Worlds tool,
waits for the list, switches to another world and captures that, opens the
Hiscores tool on each server that has one and looks a single name up there —
one request per server and no retry, since Lost City rate-limits after a
handful inside a minute — opens the Your world tool, then opens a second
instance of that server. Its own profile has downloaded nothing, so it reads
the builds from the real one; a line the real profile has not downloaded is
skipped rather than left waiting. It keeps its
own `state.json` beside the screenshots so a test switch never changes what
the next real launch opens. A view that has no frame yet is retried, then
skipped, and a file of that name left by an earlier run is removed. A shell is
shot only once it has painted, its window fronted again until it does; one that
has not painted within ten seconds is not written, and a shell shot
byte-identical to an earlier one is flagged. Either fails the run: it finishes,
lists what went wrong, and exits 1.

## Verified

One capture run with every catalog server open at once:

| window | game | shell |
|---|---|---|
| Lost City | the whole login screen, canvas and controls strip, nothing clipped at 765x535 inside the window's own opening size of 813x839 | the game's pane headed "Game · Lost City · W2 · low · 283 ms · rev 274" with the focus dot before its name, over a 232px chat pane showing the nick prompt (since 2026-09-15, its Settings tab); no ring round either |
| Zanaris | login screen | "Game · Zanaris · W1 · low · 268 ms" |
| Lost City Labs | login screen | "Game · Lost City Labs · W1 · N ms", no detail since Labs has no switch |
| Lost City, split right | untouched at 765→381px wide | the new pane headed "Empty", its launcher offering Chat, Worlds, Hiscores, **Move game here**, then the eleven links under a rule |
| Lost City, Worlds open | untouched | the pane headed "Worlds" with no heading of its own inside it, the red Low detail slab pressed |
| Lost City, Hiscores and Chat open beside the game | untouched | three headers — "Game" with its read-out, "Chat", "Hiscores" — and "Showing granny_grunt", Overall in gold at rank 18, level 1,724, 143,195,458 xp. Every xp is a whole number: Attack reads 13,073,159, the floor of the raw `value` 130731598 |
| Zanaris, Hiscores open | untouched | the header row and nothing else, with "No hiscores entry for that name." in warn: `zezima` is nobody on Zanaris, and the pane says so rather than showing an empty table |
| Lost City Labs, Hiscores open | untouched | "Showing knight", Overall in gold at rank 1, level 1,176, 18,174,678 xp; 22 rows in all, Labs' later revision sending the Slayer and Farming lines 274 never does |
| Zanaris, two pages stacked | untouched | both page panes headed with their catalog names — "Coord…", "Clue H…" — before their back, forward and reload, the name truncating rather than vanishing at 189px |
| Lost City, seam dragged | 190px wide | asked for 190px of 761 and got 190; the game pane's header keeps its name and drops "rev 274", which is the half worth losing |
| Lost City, split right then swapped | untouched | "Empty" beside "Game" over "Chat", the dot on the game's header only — the split shot itself came back a stale frame of the window before it (the capture hazard; so did the Your world tool's), and the swapped shot straight after it shows the three panes |
| Lost City, swapped then moved (a later run, 2026-09-15) | followed its pane both times: 760x742 on the right after the swap, then 378x1554 as a full-height column after the move | swapped: "Empty" beside "Game" over "Chat", the dot on the game that was dragged, and the tab renamed "Empty" for its new first pane; moved: chat dropped on the game's right edge and became a third full-height column — "Empty", "Game", "Chat" — with the dot on chat. The split, swapped and moved shots all hash differently, so none is a stale frame |
| Lost City (2) | login screen, its own partition | slot 2, `persist:server:lostcity:2`, opening on the game over chat like every new window rather than on the first window's arrangement, which nothing saves any more |
| Lost City (2), a layout saved and loaded into a new tab | not reloaded — no second load in the log | tabs "Empty" and "Game": the file saved "game over chat", the new tab loaded it, and the game moved into it, leaving the first tab's game pane empty. `state.json` holds no layouts |

453 tests cover the pure modules: layout, catalog (validation, defaults, file
recovery, a version 1, 2 or 3 file each migrating into version 4, and a
built-in's hiscores block re-adopted from the defaults), slots, tabs, the
window registry, the world sources against the real API payloads (including a
check that the Lost City template reproduces LostHQ's URLs exactly), the
worlds service (cache, shared fetch, last-good-on-error, latency by host), the
hiscores sources against each server's own payload (the xp floor, Lost City's
empty 200, and the 404s that are and are not a missing player), the hiscores
service (supersession by sequence number, the last table kept through a
failure, the rate-limit message), the per-window switch state, the app state
store, the navigation guard, the latency probe against a local listener, the
pane tree and its solver, the workspace tabs — including moving the game out of
one tab and into another, the game-and-chat arrangement a window opens with at
full, short and tiny heights, and what loading a layout over a tab costs the
game — the layout file (refusing anything that could not have been saved,
fresh ids, and whatever this window cannot show coming up empty), and what a
pane is called and may be turned into, the header's dropdown sharing the
right-click menu's splits.

## Known

- **Latency measures the front door, not the game.** The probe is a TCP connect
  to the world's web host, so for a server behind a CDN it times the nearest
  edge rather than the game server. Lost City's Singapore world reads 45 ms
  from the UK, which is the edge answering, not Singapore. Real game latency
  would have to come off the websocket.
- **Capture mode needs a waking display.** macOS refuses `capturePage` on an
  occluded surface, and once the screen sleeps most shots come back "Current
  display surface not available for capture". The run still completes, but a
  shell that cannot paint fails it; rerun it with the display awake.
- **A capture needs the machine to itself.** `capturePage` does not always
  fail loudly when a window is covered — it can hand back the last frame the
  view composited, with no error at all, so the log reports success over a
  PNG byte-identical to an earlier shot. `caffeinate -d` does not prevent
  it: two consecutive runs under it each wrote a different stale pair, and an
  instrumented run caught the cause — another app's window over the kit's,
  and `moveTop` before each of two shots eight seconds apart not getting it
  back. Capture now waits for each shell to paint and fails the run rather
  than write one that did not, or one identical to an earlier shot, so a
  failed run usually means something covered the windows: rerun it and leave
  the machine alone. Game and page shots are not compared, since a page
  brought back unchanged is meant to match, and a log line still reads state
  rather than pixels, so the PNGs still need opening.
- **A kit that is killed outright can leave cloudflared running.** A quit, a
  closed window or Stop sharing ends it, and so does any exit that runs Node's
  `exit` handlers. A `kill -9` does not, and the orphan keeps a link that only
  answers errors, since the relay behind it is gone, until it is stopped by hand.

## Security posture

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
`webSecurity: true` on every view. The game view accepts no page-initiated
navigation at all: links, `location` changes, form submits and mouse back or
forward gestures are blocked, and web links open in the system browser. The
one exception is our own offline page returning to the page main asked for.
The only way the game view changes page is main calling `loadURL`, which is
how a world switch happens, and the history is cleared after every load so
nothing can walk back through worlds. The preload exposes exactly the shell
and worlds calls in `src/shared/ipc.ts`, and IPC handlers identify a window
from `event.sender`, never from a value the renderer supplies.

**Sharing** exposes one thing: a loopback relay in the main process, which
forwards `GET`, `HEAD` and the game's websocket upgrade to the world's web port
and refuses every other method. It answers one path itself: a random one, new
with every share, that echoes its own token back, so the kit can tell the link
reaches it. The world still binds loopback only, and its
management port, which answers `POST /shutdown`, is never the relay's target.
What makes the web port safe to expose is the `node.debug: false` the kit
writes into `world.json`: with debug on, the engine would also serve `/data/` —
the world's RSA key and every save — and accept writes under `/content/`.
`src/main/share/invariants.test.ts` pins that and the loopback binds.
cloudflared is started with `--no-autoupdate`, a `--config` file holding `{}`
and none of its `TUNNEL_*` environment, so nothing else on the machine can
point the tunnel somewhere else or swap the checked binary. The link itself
is the only access control; see Playing with friends.

**Your world's builds** are the one thing the kit downloads and then runs
as a program. It downloads only the archive a recipe it shipped with pins, from
this repository's releases, and refuses one whose size or sha-256 differs. The
archive is unpacked beside the builds, not among them, and moved into place only
once the VERSION.json it unpacked to names the pinned line, commits and tag;
nothing half-downloaded or unexpected sits where the world could run it. Every
build was staged with `patches/engine/` applied and passed the stage script's
boot check — loopback-only binds, `POST /shutdown`, a populated map — so the
sharing guarantees above hold for each of them, not only for one. There is no
build the kit runs unpinned: `engine-dist/` is staging output, never a line.

## Layout of the source

```
src/shared/layout.ts        geometry constants shared by main and the shell
src/shared/panes.ts         PaneView, SeamView, PageState — what the shell draws
src/shared/dropZone.ts      pure: which zone of a pane a dragged header is over      (tested)
src/shared/catalog.ts       ServerDef and the add-form input
src/shared/worlds.ts        WorldsDef, World, Detail, WorldsView, RememberedWorld
src/shared/ipc.ts           channel names, ShellState, the tool ids
src/shared/timers.ts        pure: clocks, their limits, digits and the edit form    (tested)
src/shared/chatSettings.ts  pure: the chat Settings form, line times, rank tones    (tested)
src/shared/share.ts         ShareView — what Play with friends draws
src/shared/engines.ts       pure: a build recipe, its tag and its download url      (tested)
src/main/paneTree.ts        pure: the split tree, its solver, splits, moves, swaps  (tested)
src/main/paneDrop.ts        pure: what a header drop does and where the pane lands  (tested)
src/main/tabs.ts            pure: workspace tabs, moving the game, the opening
                            arrangement, loading a layout into a tab                (tested)
src/main/layoutFile.ts      pure: a layout file — writing, validating, fresh ids    (tested)
src/main/paneMenu.ts        pure: a pane's name, its gestures, what it may become    (tested)
src/main/paneHost.ts        the views inside a tab's panes; holds no rules
src/main/catalog.ts         pure validation, migration; the servers.json store     (tested)
src/main/slots.ts           pure: slot numbers, partitions, titles                  (tested)
src/main/windows.ts         pure: registry of open windows over a factory           (tested)
src/main/guard.ts           pure: what a page-initiated navigation may do           (tested)
src/main/appState.ts        the state.json store                                    (tested)
src/main/worlds/sources.ts  pure: LostHQ, Zanaris and static parsers, url templates (tested)
src/main/worlds/service.ts  per-server world list and latency over injected IO      (tested)
src/main/worlds/switch.ts   pure: one window's world, detail, url and labels        (tested)
src/main/worlds/probe.ts    TCP connect latency, node-only                          (tested)
src/main/worlds/warning.ts  pure: what the switch confirmation says                 (tested)
src/main/timers/defs.ts     pure: built-ins, the player's clocks and edits          (tested)
src/main/timers/runner.ts   one window's clocks over an injected clock              (tested)
src/main/timers/electron.ts reads the alert sound; the banner
src/main/chat/protocol.ts   pure: IRC lines, ISUPPORT, modes, what a typed line is  (tested)
src/main/chat/client.ts     one IRC conversation over an injected send              (tested)
src/main/chat/service.ts    the app's one connection: socket, backoff, settings     (tested)
src/main/chat/secret.ts     sealing the NickServ password with the OS store         (tested)
src/main/migrate.ts         pure: what a pre-rename profile carries across          (tested)
src/main/download.ts        a pinned download: size, sha-256, the system tar        (tested)
src/main/yourworld/buildStore.ts  your world's builds: install, check, remove       (tested)
src/main/yourworld/recipes.ts     the recipes the kit carries                       (tested)
src/main/share/cloudflared.ts  the pinned cloudflared: which build, where, checked   (tested)
src/main/share/quickTunnel.ts  a quick tunnel: its arguments, its log, the retry     (tested)
src/main/share/relay.ts     loopback relay: GET, HEAD and the websocket to the world (tested)
src/main/share/reachable.ts whether the link works yet, asking no caching resolver  (tested)
src/main/share/service.ts   the one share, and what to ask before it                (tested)
src/main/share/electron.ts  cloudflared's folder, net.fetch, killing it at exit
src/main/serverWindow.ts    one server window: shell view over game view, the switch
src/main/menu.ts            application menu: new windows, the server list, the pane
                            gestures, the switch warning
src/main/renderer.ts        preload path; load the shell
src/main/index.ts           wiring, world services, IPC handlers, capture mode
src/preload/index.ts        the window.zanaris bridge
src/renderer/Shell.tsx      the tab bar, Add pane, and every pane where main put it
src/renderer/paneHeader.tsx a pane's name, its own controls, and what it may become
src/renderer/Launcher.tsx   what an empty pane offers: links, tools, the game
src/renderer/grip.tsx       one draggable seam, and its keyboard path
src/renderer/dropIndicator.tsx where a dragged pane will land
src/renderer/tab.tsx        the shared tab button, worn by the workspace tab bar
src/renderer/tools/Worlds.tsx
src/renderer/tools/Chat.tsx the chat tabs, the log with its times, the topic
src/renderer/tools/ChatSettings.tsx  nickname, NickServ password, auto-join, connect
src/renderer/tools/ChatUsers.tsx     a channel's users by rank, and its modes and age
src/renderer/tools/yourworld/Builds.tsx   the build lines: use, download, remove
src/renderer/tools/yourworld/Friends.tsx  Play with friends: share, the link, stop
src/renderer/alertSound.ts  plays an alert at a clock's volume
static/offline.html         shown when a server can't be reached
static/starting.html        your world starting, failed, or not downloaded yet
engines/*.json              your world's build lines, pinned by digest
static/sounds/alert.wav     every timer's alert: Kenney's confirmation_002 (CC0), louder
```

## Where v1 went

`main` before the reset keeps the observe-only CDP tap, ISAAC seed recovery,
session decoder, XP tracker and the original sidebar (from `ee5116f` back).
The uncommitted work from just before the reset (the six-hour recorder and
the reload button) is parked in `git stash`.

## Next

3. **The reference pane, beyond the links.** An address row and wiki search,
   per-pane zoom, and tearing a pane off into its own window. (Reopening what
   was open at quit landed with the pane tree.)
4. **Shared tools.** Screenshot cropped to the canvas, notes, settings.
5. **Chat.** Private-message tabs, input history and nick completion. IRC on
   SwiftIRC, with Settings, users and topics, landed on 2026-09-15.
6. **Server tools.** Clue lookup and calculators, with the data pack loader.
