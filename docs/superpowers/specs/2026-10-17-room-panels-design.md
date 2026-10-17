# Chat: a room in a panel of its own

**Date:** 2026-10-17
**Status:** approved in chat, building on `claude/chat-rooms-separate-panels-143192`

## Why

The owner wants chat to carry more weight in the kit. Today chat is one pane
with a row of room tabs. Every chat pane shows the room chat has open, so a
second chat pane copies the first, and two rooms can never be on screen
together. This design lets a room come out of that row into a pane of its
own, beside the game or anywhere else in the layout.

## The owner's calls

1. **A room panel is just that room.** Its log, its user list and its own
   message box, with no row of room tabs. To see another room you open
   another panel.
2. **Two ways to open one:** drag the room's tab out of the chat pane and
   drop it on any pane's edge, as a pane header is dragged today; or
   right-click the room's tab for **Open Right**, **Open Below** and
   **Open in New Tab**. Add pane does not list rooms.
3. **One place at a time.** While a room has a panel, its tab leaves the chat
   pane's row. Closing the panel puts the tab back. Closing a panel never
   leaves the room.
4. **Per window.** A panel in this window takes the room's tab out of this
   window's chat panes only. Another window's chat keeps it.
5. **Any tab can come out**: a channel, a private conversation, or Status.
6. **A panel never joins its room.** A panel for a room you are not in, from
   a setup or after `/part`, offers Join and waits for the click. This is the
   2026-09-15 rule that rooms never follow windows, applied to panels.
7. **Unread is per room.** A room is read while a panel showing it is on
   screen. A line that names you, in a room with no tab or panel on screen,
   still shows in the game's header.

## Calls made in writing this up

The owner did not decide these; they are the builder's, flagged for review.

- A room panel is stored as a field on the chat tool, `room`, rather than
  as a new tool, so a setup holding one still opens in 0.9.3.
- Each chat pane keeps its own open room. This is what per-window needs,
  and as a side effect two chat panes in one window can sit on two rooms.
- A drop from a room tab grows the window as Split Right does, rather than
  costing the game half its size, as a moved pane's drop would.
- The People and Info toggles sit at the right of a slim row in the panel's
  body, beside the room's topic, not in the pane header (see below).
- Typing `/query` or `/join` in a room panel, or picking Message from its
  user list, opens the room as the ping does, adding a chat pane if the
  window has none.
- A notification click now does what clicking the ping does.
- A panel for a room you were kicked from offers Join.

## Words

- **Chat pane**: the pane with the row of tabs, as today.
- **Room panel**: a pane showing one room, with no tabs.
- **Room**: anything that can have a tab: a channel, a conversation with one
  person (named by their nick), or Status (`SERVER_LOG`).
- **Row**: the rooms a chat pane lists as tabs.

## What changes, and where it lives

### A room panel is a chat pane that names its room

`PaneContent`'s tool variant gains `room?: string`, set only on chat:
`{ kind: 'tool', tool: 'chat', room: '#LostHQ' }`. With no `room` it is a
chat pane. `TOOL_IDS` does not change.

This is for setup files. A setup written by this kit and opened in 0.9.3
reads as a chat pane where the panel was. A new content kind or tool id would
make 0.9.3's `readContent` refuse the whole file (see `CLAUDE.md` on
`TOOL_IDS`).

- `layoutFile.readContent` keeps `room` on chat when it is `SERVER_LOG`, a
  channel that `chatSettings.channelProblem` passes, or a nick that `isNick`
  passes. It refuses the file when `room` is anything else, and refuses
  `room` on any other tool. `isChannel` alone is not enough: it reads only
  the first character. A stranger's setup naming `#a,0` would then get a
  Join that sends `JOIN #a,0`, and on many servers the `0` leaves every
  channel. One function, `readRoom` in `src/shared/chatSettings.ts` beside `channelProblem`, decides this.
  The `paneSetContent` handler, and every new handler that takes a room,
  use it too. Today `paneSetContent` checks only `kind`.
- `paneMenu.sameContent` compares `room` (absent equals absent). Add pane's
  Chat, `showTool('chat')` and `paneHolding` then find chat panes and never
  room panels.
- `paneMenu.paneName` names a room panel after its room: `Status`, `#LostHQ`
  or the nick. The tab bar's label follows, since it is the first pane's name.
- The dropdown's Replace With and the launcher are unchanged. Replacing a
  room panel with Chat makes it a chat pane.

### Each chat pane has its own room

Which room is open is no longer the client's. It belongs to each chat pane,
alongside the page (`settings` or `chat`) the pane already has, and main
keeps it in `serverWindow` as it keeps the page today. One consequence is
that two chat panes can now show two different rooms. Before, they always
showed the same one.

A pure module, `src/main/chatPanes.ts` (tested with `node --test`), holds
the rules. `tabs.chatPages` and `tabs.readsChat` move into it and become:

- `panelledRooms(trees)`: the rooms with a panel in any of a window's tabs,
  compared by folded name.
- `rowOf(channels, panelled)`: every room chat has, in chat's order (Status
  first, then join order), less those panelled in this window.
- `chatPanes(trees, known, channels, panelled, fresh)`: each chat pane's
  `{ page, room }`, across every tab. `channels` is chat's whole list in
  its order, and `panelled` is this window's. A pane new since the last
  call gets `fresh()`. A pane whose room has left its row steps aside. A
  room no longer in `channels` (closed or parted) lands on Status, which
  keeps the renderer's draft-follows-rename rule true (see Hazards). A room
  still in `channels` but now in `panelled` lands on the next room after it
  in `channels` that is in the row, or failing that the one before it. When
  the row is empty, `room` is null and the pane says so. Room panels do not
  appear here: their room is in their content.
- `freshRoom(row, last)`: a new chat pane's room is the room last picked in
  any chat pane, in any window, when it is in this row. Otherwise it is the
  first room in the row that is not Status, then Status, then null. `last`
  starts as the client's first wanted channel and is kept in `index.ts`.
- `chatSight(tree, panes, row)`: what the front tab shows of chat.
  `reading` is the room of every chat pane on its `chat` page, plus the room
  of every room panel. `rowed` is the whole row when any chat pane is on its
  `chat` page, and empty otherwise. A chat pane on Settings shows no room
  and counts for nothing, as today.
- `renameRoom(set, from, to)`: a `TabSet` with every room panel for `from`
  now for `to`. This is for a conversation following its person to a new
  nick.

### The client counts rooms, not one open room

`IrcClient` loses `activeName`, `onScreen` and the single `pingsSeen`
watermark. In their place:

- **`see(sight)`**, where `sight` is the union over every window of
  `{ reading, rowed }`. A room entering `reading` is read (`read`), and one
  leaving it is left (`leave`). Both behave as today. Every room in
  `reading` or `rowed` has its pings seen: each `Chan` keeps its own
  `pingsSeen`, raised to `lastId`. `see` returns whether anything a window
  draws changed (an unread count, a New divider, the ping), so that main
  knows when to push the other windows.
- **`reading(chan)`** is now "this room is in `reading`".
- **`pings()`** counts, per room, the highlighted lines its `highlights`
  holds that are newer than that room's `pingsSeen`.
- **`input(text, at)`** takes the room the line was typed in. Everything
  that used `activeName` uses `at` instead: the target of a line, `note`,
  `online`'s complaint, `/topic`, `/kick`, `/invite`, rank modes,
  `/clear`, `/close`, `/part` with no channel, and `whoisTo`. It returns
  `{ open: string | null }`. `/join #x` and `/query nick` name the room
  they mean to open, and nothing else does. `/query` used to make its
  conversation through `select`, which called `chan()`, so `input` now calls
  `chan()` itself; without it the conversation's tab never appears.
  `ChatService.applySettings`'s `/nick` passes `SERVER_LOG` as `at`.
- **`log(room)`** returns `{ lines, newFrom }` for one room. `snapshot()`
  no longer carries `active`, `lines` or `newFrom`.
- **`forget`** no longer moves anyone; main's `chatPanes` does.
- **`renameQuery`** tells `opts.onRenamed(from, to)`, and moves the room in
  `reading`, so a conversation being read stays read under its new name.
- `select` is removed.

`ChatService` passes these through: `send(text, at)` returns the client's
answer, `see(sight)`, `log(room)`, and `onRenamed` on `ChatStart`. The
service keeps the last sight it was given and applies it to a client it
creates later, because chat can be seen before a nick exists.

`ChatView` loses `active`, `lines` and `newFrom`. Everything else stays.

### What a window sends for each chat pane

`PaneView.chatPage` becomes `PaneView.chat: ChatPaneView | null`:

```ts
export interface ChatPaneView {
    /** A room panel: no row, one room. */
    panel: boolean;
    /** Always 'chat' for a room panel. */
    page: ChatPage;
    /** What it shows. Null for a chat pane whose row is empty. */
    room: string | null;
    /** The tabs a chat pane lists, in chat's order. Empty for a room panel. */
    row: string[];
    lines: ChatLine[];
    newFrom: number | null;
}
```

Only panes in the front tab are sent, as now, so a window sends the logs it
draws and no more. Two panes on one room both carry its lines, which is rare
and harmless. `paneHost`'s `chatPage` dependency becomes
`chat(paneId): ChatPaneView | null`.

### Seeing chat across windows

`ServerWindowDeps.chatShown` and `chatHidden` become `chatSight(sight)`.
They are told on every `pushState`, before the state is built, as now.
`index.ts` keeps a `Map<windowId, ChatSight>` in place of `chatInFront`, for
the reason `chatInFront` gives: a window's first state goes out before the
window is in `serverWindows`. When a window closes, its entry goes.

`applySight()` takes the union, calls `chat.see(union)` and, when that
reports a change, pushes every other window. That push ends: the other
windows report sights that change nothing. The chat subscription calls
`applySight()` before pushing every window, so a line that arrives in a room
on screen is read and seen before any window draws it, as `seePings` does
today. Nothing in this path may call a window's `state()`
(`windowCounts()`'s recursion, 2026-09-20).

### Opening a room panel

Content: `{ kind: 'tool', tool: 'chat', room }`.

- **Open Right / Open Below** split the chat pane the tab is in, through
  `serverWindow.split`. That is Split Right's path, so the window pays for
  the new pane when the game would otherwise have paid (`makeRoom`).
- **Open in New Tab** goes through `host.newTab()` and puts the panel in its
  pane, as `showTool`'s fallback does.
- **Drag out.** A press on a room tab that travels `draggedFar` becomes a
  room drag. `chat.beginRoomDrag(paneId, room)` hides the native views, as
  `beginPaneDrag` does, and answers `DropTargets` from a new pure
  `paneDrop.insertTargets(tree, rect, content)`. It allows every pane's four
  edges where `halvable` allows them, and never the centre. The shell draws
  the same `DropIndicator` with the room's name as the dragged name.
  `chat.dropRoom(paneId, room, to, zone)` inserts a leaf beside `to` on that
  side, through a new exported `paneTree.insertPane(node, to, side, ids,
  content)`. `splitPane` becomes `insertPane` with `right` or `bottom`. The
  window grows through `makeRoom`, as for a split. A drag ends as pane drags
  end: Escape, a change of layout, or a release anywhere that is not a
  target. A press that never travels is still a click on the tab.
- **The menu** is native, built in main (`chat.roomMenu(paneId, room, x,
  y)`), for the reason the user menu is: a menu the shell drew would open
  under the game.

When a room goes into a panel from the chat pane that was showing it, that
pane steps aside (`chatPanes`), and the panel has the room's New divider and
draft. The divider is the client's, and the draft is keyed by room in the
renderer.

### The room panel itself

`Chat.tsx` draws both kinds. A room panel has:

- A top row in the panel body. For a channel, it holds the room's topic on
  one truncated line, with the full text on hover, and the People and Info
  toggles at its right, where they sit in a chat pane. A conversation or
  Status has no topic and no toggles, so it has no row. The toggles stay in
  the body rather than the pane header, because the header rule in
  `paneHeader.tsx` keeps a pane's work in its body.
- The status note and error, as a chat pane shows them.
- The conversation (`Conversation`), unchanged apart from taking `room`,
  `lines` and `newFrom` from the pane rather than the view.
What fills the panel in place of the conversation, checked in this order:

1. **No nick yet**: a note saying chat needs a nick, with a button that
   opens a chat pane on its Settings page (`showChat` with Settings as the
   page).
2. **Not connected and not trying**: status `offline`. The service may have
   no client at all, so there may be no rooms, not even Status. The panel
   shows "Chat isn't connected." and a **Connect** button (`chat.connect`).
3. **Not in the room**: a channel missing from `view.channels`, or one we
   were kicked from, shows "You're not in #LostHQ." and a **Join** button.
   Join sends `/join #LostHQ` from that panel. `ChatChannel` gains
   `kicked: boolean` for this. A conversation that is not open shows its
   empty log, and the first line typed opens it again.

A chat pane whose row is empty, because every room has a panel, shows
"Every room has a panel of its own." in place of the log and has no message
box.

### What else moves

- **Typing.** `chat.send(paneId, text)`. Main reads the pane's room in the
  sender's window and passes it as `at`. When the client answers `open`
  from a chat pane, that pane is put on the room. From a room panel it goes
  through `showChat(room)`, as the ping does: the room's panel if this
  window has one, otherwise a chat pane put on it, found or added. You asked
  to open something, so something opens. Adding a pane can grow the window,
  as any added pane can.
- **The user menu** (`chat.userMenu`) gains `paneId`, so its Whois answer
  lands in that pane's room and its Message opens the conversation by the
  rule above.
- **Picking a tab.** `chat.showRoom(paneId, room)` puts a chat pane on the
  room and its `chat` page in one step. It replaces `select` followed by
  `showPage`, so no room is read on the way. It also records the room as
  `last`. The gear still uses `showPage(paneId, 'settings')`.
- **Closing a tab** (the ×) still closes the room for the session.
- **The ping** (`chat.openPing`), and a **notification click**, call
  `serverWindow.showChat(room)`. If this window has a panel for the room,
  that tab is selected and the panel focused. Otherwise it does what it does
  today, and the chat pane it finds or adds is put on the room. A
  notification click no longer only selects. It does what the ping does, in
  the window it brings forward.
- **A conversation renamed**: `onRenamed` fans out from `index.ts` to every
  window. Each one renames its chat panes' rooms and its room panels
  (`renameRoom`), then pushes.
- **Links to channels** in a log (`Words`) send `/join` from the pane they
  are in.

### IPC

Names follow `zanaris:chat-<verb>`. `chatSend` takes `(paneId, text)`.
`chatSelect` goes. New: `chatShowRoom`, `chatRoomMenu`,
`chatBeginRoomDrag` and `chatDropRoom`. Ending a room drag uses
`panes.endDrag`. Every handler checks its arguments, as the others do: a
room is a string naming a room the client has, except where a panel's Join
sends `/join`.

### Verification

Capture today has no nick, so chat has never been shot with rooms in it.
Capture gains a **scripted chat server**: in capture mode `ChatService` is
built with an `io.connect` that never opens a socket. It answers
registration with `001`, answers each `JOIN` with the join, a topic and a
`NAMES` reply, and then plays a few lines from other nicks, one naming the
capture nick. The shots of chat with no nick come first and are unchanged.
After them, capture saves a nick through `applySettings` and connects, then
shoots:

- a chat pane with rooms;
- a room opened right of the chat pane, and the chat pane's row without it;
- a room panel for a room the client is not in (Join);
- a second window whose chat pane still lists the room (per window);
- the game header's ping for a mention in a room with no tab or panel on
  screen.

Each shot logs the panes' `chat` views, and a mismatch is a `fault`.
`notifyMention` raises nothing in capture mode. Capture windows are never
focused, so the scripted mention would otherwise put a system banner on the
owner's desktop.

## Hazards

- **Drafts and renames.** `Conversation` moves a draft to a new room when
  the old one has gone from `view.channels` and the new one is not Status,
  because a rename is the only way that happens. `chatPanes` keeps that
  true: a closed room's pane lands on Status. The exception is Status
  itself being in a panel, when the pane lands on a neighbour. Whoever
  builds it should tighten the rule to "the new room was not in the
  previous `channels`", which holds in every case, and fix the comment.
- **The drop preview.** `paneDrop.dropTargets` promises that its preview is
  exactly where a dragged pane lands. A room drop grows the window
  afterwards (`makeRoom`), so the new pane is the size the preview showed,
  on the side it showed, but it and the game may then sit further right or
  lower. `insertTargets`' comment says so, and the promise on `dropTargets`
  stays limited to moves.
- **Comments.** `chat.ts`'s `ChatChannel.unread` and `highlights`,
  `ChatPing`, `ChatPage`, `ChatView`, the client's `select`, `seePings` and
  `lookAway`, `serverWindow`'s `chatShown`, `chatHidden` and `showChat`,
  `index.ts`'s `chatInFront`, and `Chat.tsx`'s component comment all
  describe one open room. Each is rewritten, not left.
- **`CLAUDE.md`.** "The open room is read only while a chat pane shows the
  conversation" becomes per room and per pane. The ping paragraph gains
  rooms with no tab on screen. The layout invariant's list of what resizes
  the window gains "a room opened beside a pane". The `TOOL_IDS` paragraph
  gains why a room panel is a field rather than an id.

## Not doing

- Rooms in Add pane, or in a pane's Replace With list.
- Dropping a room tab on the tab bar, or on a pane's centre.
- Moving a room between two room panels, or back into a chat pane by
  dragging. Closing the panel is how a room goes back.
- Unread counts on a room panel, or on a workspace tab holding one.
- A room panel joining its room on its own.
