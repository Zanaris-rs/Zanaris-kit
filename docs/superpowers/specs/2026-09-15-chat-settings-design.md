# Chat: Settings tab, closable channels, users and metadata

**Date:** 2026-09-15
**Status:** implemented on branch `chat-settings`

## Why

Chat connected at launch once a nick existed, and had no way to disconnect.
The nick was asked for once and changed only with `/nick`. There was no NickServ
support. `#LostHQ` was always joined, `#LostCity` followed Lost City windows,
and only rooms joined by hand could be closed. The client already tracked nick
lists and line times but drew neither, and it threw away ranks, topics, modes
and the MOTD.

The owner asked for a proper chat client in the kit's own look:

- a Settings tab that cannot be closed, holding connect and disconnect, the
  nickname, an optional NickServ password, and the auto-join channels, prefilled
  with `#2004scape,#LostHQ,#Zanaris`;
- every channel closable;
- in a channel, the users, the time each message was sent, and the channel's
  other details.

## The owner's calls

1. **Channels come only from the auto-join list plus `/join`.** The
   always-joined lobby and the per-window room rule (`chat/channels.ts`,
   `ChatService.setServers`) are gone, and every channel tab is closable.
2. **Closing a tab or typing `/join` lasts for the session.** The saved list
   changes only in Settings, and every Connect joins it again.
3. **Disconnect is remembered.** After Disconnect, the next launch stays
   offline until Connect. Quitting while connected reconnects on launch.

## Defaults chosen in the plan and kept

- **Status** (the server log) cannot be closed, like Settings.
- **The password** is sealed by Electron's `safeStorage` and never sent to the
  renderer.
- **The user list** is a sidebar in a wide pane and swaps in for the log in a
  narrow one.

## Design

### Settings and what is saved

`ChatSettings` is `{ nick, server, port, autoJoin, autoConnect }`, with
`DEFAULT_AUTO_JOIN = ['#2004scape', '#LostHQ', '#Zanaris']`.

`appState` handles the chat block this way:

- A missing `autoJoin` falls back to the defaults. An empty array is kept,
  because the user cleared it on purpose.
- A sealed password lives beside the settings as `chat.nickserv`, and the key
  is absent when there is none.
- No migration is needed while nobody has installed the kit, per `CLAUDE.md`.

`chat/secret.ts` seals and opens the password over an injected store:

- On Linux, the `basic_text` and `unknown` backends count as no store.
- Where there is no store, the password is held for the run and nothing is
  written. The Settings tab says so.
- A blob that will not open reads as no password.

`src/shared/chatSettings.ts` is shared by the form and by main, which checks the
form again at the IPC boundary. It covers:

- **The nick:** IRC's own character rules, up to 30 characters.
- **Channels:** separated by commas or spaces; `#` is added when missing, as
  `/join` does; case-folded duplicates are dropped; names longer than 50 or
  holding control characters are refused; 20 at most.
- **The password:** 1 to 100 characters with no control characters, because a
  line break in it would start a second IRC command.
- **Pane helpers:** `sameSettings` (whether a save would change anything),
  `isConnectionWanted`, `clockTime` and `rankTone`.

**Settings is the only writer of the saved nick and list.** A `/nick`, a taken
nick's underscore and a services rename to a guest nick all last for the
session, the way closing a tab and `/join` do. The first draft kept the old
observer that learnt the nick from the view (`chatPersist.ts`). Review showed
it would save `Guest12345` after services renamed an unidentified nick, which
would then be the next launch's nick, so it was removed.
`ChatSettingsView.nick` is the saved nick. `ChatView.nick` is the connection's,
and Settings says when the two differ.

`appState` reads a stored nick and channel list with the form's own checks
(`isNick`, `channelProblem`), so a hand-edited profile cannot carry a line
break to the wire either.

### The connection (`chat/service.ts`)

- **At construction** it connects only when a nick exists and `autoConnect` is set.
- **`connect()`** clears the stop, joins the auto-join list into what is wanted
  (alongside the channels still wanted from before), and connects now,
  cancelling any waiting retry. The client and its log are kept.
- **`disconnect()`** and `stop()` both send `QUIT` while a socket exists, stop
  retries, and drop the socket. Tabs and logs stay. Main persists
  `autoConnect` for disconnect, never for quit.
- **`applySettings()`** changes the connection in place:
  - The nick and password become the client's credentials first. A change
    identifies at once when online, so a new nick arrives already identified.
  - A new nick is compared with the nick the connection holds, not the saved
    one. It is sent as `/nick` when live, or becomes the next registration's
    nick through `client.rename`, with no restart that would lose the log.
  - Channels added to the list are joined unless offline; while connecting they
    go into what the welcome joins. Removed ones are not parted; closing their
    tabs does that.
- **`closeRoom()`** parts any open channel and refuses Status.
- **The view** stamps `closable = isChannel(name)` and adds
  `settings: { nick, autoJoin, hasPassword, canSavePassword }`.
- **`tlsConnect.close()`** ends the socket so the QUIT is flushed, and destroys
  it after two seconds.
- **`tlsConnect.send()`** refuses any line holding CR, LF or NUL.

### The IRC client (`chat/client.ts`, `chat/protocol.ts`)

- **Registration** asks for `multi-prefix` (`CAP REQ`, then `CAP END` on the
  ACK, NAK or 410). Without it a server sends only each person's highest rank.
- **NickServ:** on `001`, `PRIVMSG NickServ :IDENTIFY <account> <pass>` goes out
  before the JOINs, straight to `send` and never into a log line.
  - The account is the saved nick, so an underscore fallback still identifies
    the right account.
  - In the two-word form the password keeps its spaces.
  - Services may confirm after the JOINs land, so a registered-only room can
    still refuse with a 477; waiting for confirmation is out of scope.
  - `setCredentials` identifies at once when online and something changed.
  - A typed `/msg NickServ IDENTIFY …` (or REGISTER, GHOST, SET PASSWORD and the
    like) is sent whole, but echoed as `IDENTIFY (hidden)`.
- **Users:** each user is `{ nick, prefixes }`.
  - `005 PREFIX` and `CHANMODES` are read with RFC-era defaults.
  - `353` keeps every rank symbol (multi-prefix) and drops a userhost suffix.
  - A channel `MODE` moves ranks, using `modeChanges` to decide which letters
    take a parameter.
  - Users are sorted by highest rank, then by case-folded nick.
- **Channel details:**
  - The topic, its setter and time come from `332`, `333` and `TOPIC`.
  - Flags come from `324`, letters only so a key is never shown, and are
    updated by `MODE`; list modes are not flags.
  - The creation time comes from `329`.
  - The client sends `MODE #chan` on its own join to get `324` and `329`.
  - Changes become lines in the room.
- **KICK:** another user is removed from the list, with a line. When we are
  kicked, the tab stays with the reason as a highlighted line, its list is
  cleared, and the channel leaves `want` so a reconnect does not rejoin it.
  Closing that tab sends no PART, because a PART would only earn a 442. Any
  other channel's close does send one, including a room the server put us in
  unasked.
- **Status:** these go to Status without an unread badge:
  - the welcome;
  - the MOTD;
  - `221` and our own `MODE`;
  - `ERROR`;
  - the text of every other numeric, except the silent ones (`005`, `331`–`333`,
    `324`, `329`, `353`, `366`).

  Notices, private messages and `INVITE` are addressed to you, so they do
  badge it.
- **Formatting:** mIRC colour, bold, italic, underline, reverse and reset codes
  are stripped from messages, notices, topics and reasons.

### IPC

- `chatSetNick` is replaced by `chatSaveSettings`, which takes
  `{ nick, channels, password? }` and resolves to null or to the reason it was
  refused.
- `chatConnect` and `chatDisconnect` are added.

### The pane

- **Tabs:** Settings, Status, then channels, all `Tab role="button"`.
  - Every channel passes `onClose`, so the close sits inside its tab. Settings
    and Status have none.
  - Wide panes (560px and up) keep one row; narrow panes wrap.
  - Which page shows is local to the pane. It is forced to Settings with no
    nick or no channels, and the open channel stays app-wide in main.
- **Settings** (`ChatSettings.tsx`) replaces the nick prompt.
  - The fields are Nickname, NickServ password and Auto-join channels. In a
    wide pane the nick and password sit side by side.
  - Each field shows what is saved until it is typed in, so a nick the server
    changed shows up.
  - The password field is always empty. Its placeholder says whether one is
    saved, and "Forget the saved password" clears it on Save.
  - Offline, a red **Connect** submits, and becomes "Save and connect" when
    something changed. Connected, a gold **Save** (spent until something
    changed) sits beside a quiet **Disconnect**.
- **A channel:**
  - A topic bar sits above the log, with the setter and time in its tooltip.
  - Each line starts with a faint `HH:MM:SS` in its own column, with the full
    local date in its tooltip.
  - Users (`ChatUsers.tsx`) have a header with the count, modes and creation
    date. Each row shows the rank symbol, toned gold for `~&@`, warn for `%` and
    link for `+`, then the nick in the colour the log gives it
    (`nickColour.ts`).
  - A wide pane puts the list in a 150px sidebar. A narrow pane has a "N users"
    button on the topic bar that swaps the log for the list.

## Tests

All tests run under `node --test` and cover pure modules only:

- **`shared/chatSettings.test.ts`:** reading the form, the password rules,
  `sameSettings`, `clockTime` (built from local fields, so any timezone
  passes), `rankTone`.
- **`chat/protocol.test.ts`:** ISUPPORT, `modeChanges`, `stripFormatting`.
- **`chat/client.test.ts`:**
  - the password is sent after `001`, before the JOINs, and never logged;
  - ranks from NAMES and from MODE;
  - topic, modes and creation date;
  - kicks of others and of us;
  - the named IDENTIFY after an underscore fallback;
  - CAP END;
  - closing a channel the server put us in;
  - the masked IDENTIFY echo;
  - Status numerics;
  - `rename` and `quit`.
- **`chat/service.test.ts`:**
  - `autoConnect`;
  - connect and disconnect;
  - `applySettings` online, offline, connecting and reconnecting;
  - the saved nick surviving a services rename;
  - closing any channel but Status;
  - `/join` never writing the list.
- **`chat/secret.test.ts`:** seal and open, no store, Linux backends, a blob
  that will not open.
- **`appState.test.ts`:** `autoJoin`, `autoConnect`, the sealed password, and a
  stored nick or channel with a line break refused.

An independent review of the first draft found the guest-nick save, the
single-word IDENTIFY, joins lost while connecting, the missing multi-prefix
request, the echoed typed IDENTIFY, and closing a channel the server put us
in. All are fixed and tested as above.

The pane was checked in a gitignored harness (`.superpowers/harness/chat.html`)
at 765px and 320px, including first run. That covered validation, save then
connect, closing a tab, the users toggle and the Settings button states.

## Follow-up, 2026-09-16

`/invite` did nothing: `parseInput` read five commands and answered everything
else with "unknown command", which was the chat-dock design's rule. The owner
chose pass-through with no per-command helpers, so an unknown command now goes
to the server as typed, with only its name uppercased, and the server's answer
lands in Status. Arguments are IRC's own, so a trailing parameter needs its
colon. A slash naming something that is not a command — `/123`, `/?` — is still
refused locally, since the server could only answer it with a 421.

Known edge: `/quit` really does quit, and the kit then reconnects, because
Disconnect is what tells it to stay offline.

## Out of scope

- Private-message tabs.
- Recovering a taken registered nick with GHOST or RECOVER.
- SASL.
- Editing the server or port.
- mIRC colours drawn as colours; they are stripped instead.
- Input history and nick tab-completion.
