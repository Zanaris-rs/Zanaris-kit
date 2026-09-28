# Chat: room for the conversation, and commands you can find

**Date:** 2026-09-28
**Status:** approved in chat, building on `claude/chat-spike-improvements-953d1a`

## Why

Chat is meant to be the focal point of the kit, and in a default window it
has about eighty pixels of log. The topic took a row above the log, and when
there was none it said "No topic set", which was a row spent saying nothing.
The user list spent two lines of header on its count, modes and age, so a
short pane showed a name and a half. Typing `/` showed nothing, so which
commands exist and what they take had to be learnt from `/help`. Settings
opened with a paragraph above the fields.

## The owner's calls

1. **The intro paragraph above Nickname goes.**
2. **Typing `/` lists the commands**, filtering as you type.
3. **"No topic set" goes.**
4. **Channel info is a view, not a row.** The topic row and the user list's
   header both go. An ⓘ at the right end of the tab row swaps the log for
   the channel's info: the topic in full with its links, who set it and
   when, the user count, modes and when it was created. The list holds names
   only.
5. **Settings is a gear**, a square tab at the start of the row.
6. **Each channel keeps its own draft.** Today a half-typed line follows you
   into the next channel, and Enter sends it there.
7. **Unread cues.** A tab's count is gold when a line in it names you and
   cream when it does not; coming back to a channel draws a **New** divider
   above the first line that arrived while you were away.
8. **Joins, parts, quits and renames fold.** A run of them is one faint line,
   "3 joined, 2 left", which opens on a click.
9. **The user list can be hidden.** A people button beside ⓘ hides and shows
   the sidebar in a wide pane, and swaps the log for the list in a narrow
   one, which the "18 users" button on the topic row did before.

## Design

### Settings

`ChatSettings` loses the `needsNick` paragraph. The placeholder "Pick a name",
the spent Connect button and the field notes are what a first run reads.

### The command menu

**One table.** `COMMAND_HELP`, in `shared/chatInput.ts`, holds every command
the kit reads itself: its name, the arguments it takes as they are written
for a person (`#channel`, `nick [reason]`), one line saying what it does,
whether it runs with nothing after it (`bare`), and its aliases (`/j`, `/q`,
`/wi`, `/back`). `COMMANDS` is its names, in the same order as now. `/help`
in `client.ts` prints one line per entry from it, replacing the hand-written
`HELP`, so the menu and `/help` cannot disagree. A test in `protocol.test.ts`
holds `bare` to `parseInput` (`parseInput('/name') !== null` exactly when an
entry is bare) and each alias to the kind its name parses to.

**When it shows.** While the text before the caret is a slash and letters,
at the start of the box, and the caret is at the end of that word. `//` is
the escape for a line starting with a slash and never opens it. It lists
every entry whose name or an alias starts with what is typed, and closes on
the space after the command.

**Keys while it shows.** Up and Down move the highlight, wrapping, instead of
bringing back what was sent. Tab takes the highlighted command. Enter takes
it too, unless what is typed is already a whole command that runs bare
(`/clear`, `/part`), which Enter sends as it does now. Escape closes it until
the word changes. Taking a command writes `/name ` and puts the caret after
the space. A press on a row takes that row without taking focus from the box.

**The usage line.** Once the command is followed by a space, one line above
the box says how it is used (`/join #channel — join a channel`) until the box
no longer starts with that command.

**Where it draws.** Over the bottom of the log's well, inside it and no
taller than it. Anything the shell draws past the pane's edge lands under a
native view, which is why the user menu is native, so the list is clamped to
the box the log already owns and scrolls within it.

The pure parts are `commandMenu(text, caret)`, `commandHint(text)`,
`menuEnter(typed, matches)` and `takeCommand(text, caret, command)`, tested in
`chatInput.test.ts`. The box is a `combobox` with the list as its `listbox`
and the highlight as its `aria-activedescendant`.

The placeholders say where to start: `Message #LostHQ, or / for commands` in
a room, and `Type / for commands` in Status.

### The tab row

`Tab` takes an `icon`. With one, the tab draws the icon in place of its label
and carries the label as its tooltip and accessible name. Settings is the
existing `Gear`, named "Chat settings".

When a channel is open, the row ends, pushed right, with two quiet toggle
buttons, 26px tall like the tabs:

- **People**, a glyph and the count. `aria-pressed` says whether the list is
  showing.
- **Info**, an ⓘ glyph. `aria-pressed` says whether the info is showing.

Both are new glyphs in `icons.tsx`, stroked in `currentColor` like the other
chrome glyphs. Neither shows in Status or a private conversation, which have
no topic and no list.

### What the log's space shows

`Chat` holds two pieces of state, which it keeps while the pane lives:

- `swap`: `'log' | 'info' | 'users'`, what fills the log's space. It goes back
  to `'log'` when the open channel changes and when a line is sent.
- `sidebar`: whether a wide pane shows the list beside the log. On by
  default.

People, in a wide pane, flips `sidebar`. In a narrow pane there is no sidebar,
so it flips `swap` between `'users'` and `'log'`. Info flips `swap` between
`'info'` and `'log'`.

**The info view** is a well in the log's place, scrolling on its own: the
topic under a small "Topic" label, with its links and channel names live, and
"Set by branon on …" under it when the server said. Then the facts, one to a
line: the user count, the modes (not "+" alone), and the date the channel was
made. A channel with no topic shows only the facts.

**The list** drops its header. Its count moves to the People button and its
accessible name ("18 people in #LostHQ"). The modes and date move to the info
view.

`TopicBar` goes. Its narrow-pane button moved to the tab row.

### Drafts

A module-level map, beside `sentLines`, holds the draft of every channel,
keyed by `foldName`. The box writes to it on every change, and loads from it
when the open channel changes. Sending a line deletes its entry. It lasts
until the window closes, as the sent lines do, so a visit to the gear keeps
it.

### Unread cues

**The badge.** A resting tab's count is gold when `highlights > 0` and cream
otherwise. The tab's tooltip adds what the count is: "3 unread, 1 names you".

**The divider.** `ChatView.newFrom` is the id of the first line that arrived
in the open tab since you last left it, or null. `IrcClient` keeps, per tab,
`seen` (the last line id when the tab was last left) and `newFrom`. `select`
does the work:

- Leaving a tab sets its `seen` to the latest id and clears its `newFrom`.
- Opening a different tab with `unread > 0` sets its `newFrom` to the first
  line after its `seen`. Opening one with nothing unread clears it.
- Selecting the tab that is already open changes neither.

Unread counts only what `incoming` counts, so churn alone never draws a
divider, but the divider sits above the first line of any kind after `seen`.
A tab closed while open hands over to Status without a `select`. Status's
`newFrom` was cleared when you last left it, so it shows none.

The log draws a gold rule labelled **New** above the item holding that line.
It is not drawn above the first item in the log, where it says nothing. It
stays while you stay, and goes when you leave.

This is "since you last had the tab open", not "since you last looked": a
channel left open while the kit sat in the background draws none.

### Folding churn

`ChatLine` gains an optional `presence: 'join' | 'part' | 'quit' | 'nick'`.
`client.ts` sets it on the lines for someone else joining, leaving, quitting
or changing name in a channel. Kicks stay unmarked, since a kick is news. A
quit or rename in a private conversation stays unmarked too: it is the one
person you are talking to. The key is absent rather than `undefined` on every
other line, so no existing test's `deepEqual` changes.

`foldLog(lines, newFrom)`, in a new `shared/chatLog.ts`, turns the lines into
items. A run of two or more consecutive `presence` lines is one fold, and a
single one stays a line. A run breaks at `newFrom`, so the divider always has
a boundary to sit on. A fold's summary counts joins as "joined", parts and
quits together as "left", and renames as "renamed", in that order, leaving
out any that are zero: "3 joined, 2 left". It is keyed by its first line's id,
which stays put as the run grows.

The log draws a fold as one faint line with the first line's time: the
summary as a button, `aria-expanded`, with the run's lines under it when
open. Which folds are open is the conversation's own state, cleared when the
channel changes.

## Testing

- `chatInput.test.ts`: the menu opens, filters, matches aliases, closes on
  the space and on `//`; the hint; Enter's choice; taking a command.
- `protocol.test.ts`: `bare` against `parseInput`; aliases.
- `client.test.ts`: `/help` prints every entry; `presence` on join, part,
  quit and rename in a channel, and not on a kick or a private quit;
  `newFrom` through leave, return, reselect and a close.
- `chatLog.test.ts`: runs, singles, the break at `newFrom`, the summary.
- The renderer has no tests. It is checked by `npm run capture` for Settings,
  and by rendering the conversation against a stubbed view for everything
  capture cannot reach, since the capture profile has no nick and never
  connects.
