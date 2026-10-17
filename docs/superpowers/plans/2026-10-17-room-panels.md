# Room Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A chat room, conversation or Status can come out of the chat pane's row of tabs into a pane of its own: dragged out or opened from its tab's right-click menu.

**Architecture:** A room panel is a chat pane whose content names its room (`{ kind: 'tool', tool: 'chat', room }`). Each chat pane keeps its own open room in main, beside its page. The IRC client stops having one open room: main tells it which rooms are on screen, unioned across windows (`see`), and it counts unread and pings per room. Every rule about which rooms a pane lists, where a pane steps aside to and what a window shows is pure, in `src/main/chatPanes.ts`.

**Tech Stack:** Electron, TypeScript, React, `node --test` (pure modules only), Tailwind tokens.

**Spec:** `docs/superpowers/specs/2026-10-17-room-panels-design.md`. Read it before any task. `CLAUDE.md` is binding throughout.

## Global Constraints

- Write paths from the repository root. `src/shared/identity.test.ts` fails on a home directory path.
- `TOOL_IDS` does not change. A room panel is `room` on the chat tool's content.
- IPC channel names are `zanaris:chat-<verb>`, as the 60-odd existing ones are.
- Every colour is a `--color-*` token. No literal colour in `src/renderer`.
- A comment that describes behaviour the code does not have is a defect. **Fix any comment your change makes untrue, in any file**, including ones outside the task's file list.
- Logic goes in pure modules that `node --test` reaches. `serverWindow.ts`, `index.ts` and the renderer have no tests, and must hold no rules: they call `chatPanes.ts`, `paneTree.ts` and `paneDrop.ts`.
- Names are compared folded (`foldName` and `sameName` in `src/shared/ircNames.ts`). Rooms are stored as written.
- Nothing in the sight path may call a window's `state()`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Where this plan and the code disagree, trust the code, follow the spec's intent, and say so in your report. Don't follow the plan blindly.

## Review Focus

1. **Two windows.** A panel in window A must not take the room's tab out of window B's chat pane. B must still read it, and B must still see pings from it. Tested by `chatPanes.test.ts` (per-window rows) and by capture step 4 in Task 6.
2. **The drag that isn't one.** A press on a room tab that never travels is a click, which shows the room. A drag that ends anywhere but a target (Escape, the tab bar, a refused edge, a shell reload) leaves every native view visible. Capture checks the views after `beginRoomDrag` then `endDrag` (Task 6).
3. **A panel closing.** The tab returns to the row. The room counts unread again once nothing shows it. Tested in `chatPanes.test.ts` and `client.test.ts` (Tasks 2 and 3).
4. **A stranger's setup.** A room panel for `#a,0`, or for a room you are not in, never sends a JOIN on its own. `#a,0` is refused. Tested in `layoutFile.test.ts` (Task 1) and in the Join-only path (Task 5).
5. **A conversation renamed.** A panel for `zed` follows `zed` to `zed_` and keeps its draft. Tested by `renameRoom` (Task 2) and `onRenamed` (Task 3). The draft is renderer-side (Task 5).

---

### Task 1: Room content, its name, its file form and inserting it

**Files:**
- Modify: `src/main/paneTree.ts` (`PaneContent`, export `insertPane`, `splitPane` through it)
- Modify: `src/shared/chatSettings.ts` (add `readRoom`)
- Modify: `src/main/layoutFile.ts` (`readContent`)
- Modify: `src/main/paneMenu.ts` (`sameContent`, `paneName`)
- Modify: `src/main/paneDrop.ts` (add `insertTargets`, `canInsert`)
- Test: `src/main/paneTree.test.ts`, `src/shared/chatSettings.test.ts`, `src/main/layoutFile.test.ts`, `src/main/paneMenu.test.ts`, `src/main/paneDrop.test.ts`

**Interfaces:**
- Produces:
  - `PaneContent` tool variant: `{ kind: 'tool'; tool: ToolId; room?: string }`. `room` is set only on chat.
  - `readRoom(x: unknown): string | null` in `src/shared/chatSettings.ts`. It returns `x` when it is `SERVER_LOG`, a channel `channelProblem` passes, or a nick `isNick` passes. Otherwise it returns null.
  - `insertPane(node: PaneNode, to: string, side: Side, ids: { paneId: string; splitId: string }, content: PaneContent): PaneNode` in `paneTree.ts`. It returns `node` by identity when `to` is not in it.
  - `insertTargets(tree: PaneNode, rect: Rect, content: PaneContent): DropTargets` and `canInsert(tree: PaneNode, rect: Rect, to: string, zone: DropZone): boolean` in `paneDrop.ts`.
  - `paneName({ kind: 'tool', tool: 'chat', room })`: `'Status'` for `SERVER_LOG`, otherwise the room as written.

- [ ] **Step 1: Write the failing tests**

`chatSettings.test.ts`:
```ts
test('readRoom keeps Status, a channel and a nick, and nothing else', () => {
    assert.equal(readRoom(SERVER_LOG), SERVER_LOG);
    assert.equal(readRoom('#LostHQ'), '#LostHQ');
    assert.equal(readRoom('zed'), 'zed');
    for (const bad of ['#a,0', '#', '# x', 'two words', '', 7, null, undefined, '#' + 'x'.repeat(60)]) assert.equal(readRoom(bad), null, String(bad));
});
```
`layoutFile.test.ts` (use the file's existing helpers for writing and reading a setup):
- `'a room panel survives a setup file'`: a leaf `{ kind: 'tool', tool: 'chat', room: '#LostHQ' }` round-trips with `room` intact.
- `'a room the reader cannot trust sinks the file'`: `room: '#a,0'` makes the read return null.
- `'room on a tool other than chat sinks the file'`: `{ tool: 'worlds', room: '#x' }` returns null.

`paneMenu.test.ts`:
- `'a room panel is named after its room'`: `'#LostHQ'`, `'Status'` for `SERVER_LOG`, `'zed'`.
- `'Add pane finds chat, not a room panel'`: in a tree holding only a room panel, `paneHolding(tree, { kind: 'tool', tool: 'chat' })` is null. In a tree holding chat and a room panel, it is the chat pane.

`paneTree.test.ts`:
- `'insertPane puts a pane on each side of its target'`: from `leaf('a', game)`, `left` gives `split(x, [new, a])`, `top` gives `split(y, [new, a])`, `right` and `bottom` put it after.
- `'splitPane is insertPane on the right or the bottom'`: an existing `splitPane` test still passes unchanged.

`paneDrop.test.ts`:
- `'a room can land on any edge, never the centre'`: for a two-pane tab, every pane's `centre` is null and every edge is a rect whose size equals the half `layoutTree` gives after `insertPane`.
- `'a pane too small to halve refuses a room on that axis'`: a pane at `PANE_MIN_WIDTH * 2 - 1` wide refuses `left` and `right`.

- [ ] **Step 2: Run them to see them fail**

Run: `npm test 2>&1 | grep -E "^not ok|# fail"`
Expected: the new tests fail with missing exports or wrong values.

- [ ] **Step 3: Implement**

`insertPane` is the private `insertBeside` with `side` mapped to `axis` and `after`, exported. `splitPane` calls it. `insertTargets` mirrors `dropTargets`: it lays out `insertPane`'s result for each pane and edge, using `PREVIEW_SPLIT` as the split id, and sets centre to null. Its comment says the window may then grow (`makeRoom`), so the new pane is the previewed size on the previewed side, but it and the game can sit further right or lower. `dropTargets`' comment keeps its promise, now scoped to moves. `canInsert` is `halvable` on the target at its current size; no pane leaves first. `readContent` uses `readRoom`. `sameContent` compares `a.room ?? null` with `b.room ?? null` for tools.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test 2>&1 | tail -5 && npm run typecheck`
Expected: all tests pass, and typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/paneTree.ts src/main/paneTree.test.ts src/shared/chatSettings.ts src/shared/chatSettings.test.ts src/main/layoutFile.ts src/main/layoutFile.test.ts src/main/paneMenu.ts src/main/paneMenu.test.ts src/main/paneDrop.ts src/main/paneDrop.test.ts
git commit -m "feat: a chat pane can name a room, and a pane can be inserted beside another"
```

---

### Task 2: The rules for chat panes (`chatPanes.ts`)

**Files:**
- Create: `src/main/chatPanes.ts`, `src/main/chatPanes.test.ts`
- Modify: `src/main/tabs.ts` (remove `readsChat` and `chatPages`; their tests move to `chatPanes.test.ts`, rewritten for the new rules)
- Modify: `src/shared/chat.ts` (add `ChatSight`, `ChatLog`)

**Interfaces:**
- Consumes: `PaneContent.room` (Task 1).
- Produces, all in `src/main/chatPanes.ts`:
  ```ts
  export interface ChatPaneState { page: ChatPage; room: string | null }
  export function roomOf(content: PaneContent | null): string | null; // a room panel's room; null for anything else, chat panes included
  export function panelledRooms(trees: readonly PaneNode[]): string[]; // folded-unique, first-seen order
  export function rowOf(channels: readonly string[], panelled: readonly string[]): string[];
  export function freshRoom(row: readonly string[], last: string | null): string | null;
  export function chatPanes(trees: readonly PaneNode[], known: ReadonlyMap<string, ChatPaneState>, channels: readonly string[], panelled: readonly string[], fresh: () => ChatPaneState): Map<string, ChatPaneState>;
  export function chatSight(tree: PaneNode, panes: ReadonlyMap<string, ChatPaneState>, row: readonly string[]): ChatSight;
  export function panelFor(tabs: readonly { id: string; tree: PaneNode }[], room: string): { tabId: string; paneId: string } | null;
  export function renameRoom(set: TabSet, from: string, to: string): TabSet; // returns `set` by identity when no panel is for `from`
  ```
  And in `src/shared/chat.ts`:
  ```ts
  export interface ChatSight { reading: string[]; rowed: string[] }
  export interface ChatLog { lines: ChatLine[]; newFrom: number | null }
  ```

- [ ] **Step 1: Write the failing tests** in `chatPanes.test.ts`. They use `leaf` and `split` from `paneTree.ts`. `chat` is `{ kind: 'tool', tool: 'chat' }` and `panel('#x')` is `{ kind: 'tool', tool: 'chat', room: '#x' }`.

- `rowOf(['*', '#a', '#b', 'zed'], ['#B'])` → `['*', '#a', 'zed']` (folded match).
- `panelledRooms([leaf('p1', panel('#a')), split('s', 'x', [leaf('p2', panel('#A')), leaf('p3', chat)], [0.5, 0.5])])` → `['#a']`.
- **Per window**: window A's trees panel `#a` and window B's trees do not. `rowOf(channels, panelledRooms(A))` lacks `#a`, and `rowOf(channels, panelledRooms(B))` has it.
- `freshRoom(['*', '#a', '#b'], '#b')` → `'#b'`. `freshRoom(['*', '#a'], '#gone')` → `'#a'`. `freshRoom(['*'], null)` → `'*'`. `freshRoom([], '#a')` → null.
- `chatPanes`, with `channels = ['*', '#a', '#b', '#c']`:
  - A new chat pane gets `fresh()`, which is asked once however many panes are new.
  - Room panels are not in the map.
  - A pane on `#b` when `#b` becomes panelled lands on `#c`. When `#c` is also panelled, it lands on `#a`.
  - A pane on `#b` when `#b` leaves `channels` lands on `'*'`.
  - A pane on `#b` when `#b` leaves `channels` and `'*'` is panelled lands on `#a`, the first room of the row.
  - With every room panelled, `room` is null and `page` is kept.
  - A pane with `room: null` takes `fresh().room` once the row has a room again.
  - A pane that stopped holding chat drops out, and chat put back in it starts afresh. This is the old `chatPages` test, kept.
- `chatSight`, on a front tree holding one chat pane on `#a`, one chat pane on `settings`, and one panel for `zed`:
  - `reading` is `['#a', 'zed']`, and `rowed` is the whole `row`.
  - With the `#a` pane on `settings` as well, `reading` is `['zed']` and `rowed` is `[]`.
  - A pane whose state is missing counts for nothing, as `readsChat` did.
- `panelFor` finds the tab and pane of a panel for `#A` when asked for `#a`, and null when there is none.
- `renameRoom` turns a panel for `zed` into one for `zed_` in a background tab. It leaves chat panes and other panels alone, and returns the same set when nothing matches.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test src/main/chatPanes.test.ts 2>&1 | tail -5`
Expected: FAIL. The module does not exist.

- [ ] **Step 3: Implement `chatPanes.ts`**, move the comments that still hold from `tabs.ts`, and delete `readsChat`, `chatPages` and their tests from `tabs.ts` and `tabs.test.ts`. `serverWindow.ts` still imports them, and Task 4 replaces those imports. Until then typecheck errors there are expected; leave them.

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | tail -5`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/chatPanes.ts src/main/chatPanes.test.ts src/main/tabs.ts src/main/tabs.test.ts src/shared/chat.ts
git commit -m "feat: chatPanes — which rooms each chat pane lists, shows and reads"
```

---

### Task 3: The client and service count rooms, not one open room

**Files:**
- Modify: `src/main/chat/client.ts`, `src/main/chat/client.test.ts`
- Modify: `src/main/chat/service.ts`, `src/main/chat/service.test.ts`
- Modify: `src/shared/chat.ts` (`ChatView`, `ChatChannel.kicked`, and the comments listed in the spec's Hazards)

**Interfaces:**
- Consumes: `ChatSight`, `ChatLog` (Task 2).
- Produces:
  - `IrcClient.see(sight: ChatSight): boolean`. True when an unread count, a New divider or the ping changed.
  - `IrcClient.log(room: string): ChatLog`, which gives `{ lines: [], newFrom: null }` for a room it does not have.
  - `IrcClient.input(text: string, at: string): { open: string | null }`.
  - `ClientOpts.onRenamed?(from: string, to: string): void`, called at the end of `renameQuery` after its line is pushed.
  - `ChatChannel.kicked: boolean`.
  - `ChatView` without `active`, `lines` or `newFrom`. `ClientSnapshot` likewise.
  - `ChatService.send(text: string, at: string): { open: string | null }`, `ChatService.see(sight: ChatSight): boolean`, `ChatService.log(room: string): ChatLog` and `ChatStart.onRenamed?(from: string, to: string)`. `select`, `seePings` and `lookAway` are removed from both classes.

- [ ] **Step 1: Rewrite the tests first.** About 114 lines in `client.test.ts` and 24 in `service.test.ts` use the old surface. Map them:

| Old | New |
|---|---|
| `client.seePings()` in `fake()` (chat on screen) | `client.see({ reading: ['#04scape'], rowed: <all rooms> })`, with the first channel open as before |
| `client.select(x)` with chat on screen | `client.see({ reading: [x], rowed })` |
| `client.lookAway()` | `client.see({ reading: [], rowed: [] })` |
| `client.seePings()` returning whether a ping waited | `client.see(sight)` returning whether something changed |
| `snapshot().lines`, `.active`, `.newFrom` | `client.log(room).lines` and `.newFrom` |
| `client.input(text)` | `client.input(text, at)` with the room the old test had open |

A test whose point was "only the open room is read" becomes "only rooms in `reading` are read". Keep every behaviour the old suite pinned unless the spec changes it. Add these tests:

- `'two rooms on screen are both read'`: `see({ reading: ['#a', '#b'], rowed })`. Lines in both leave `unread` at 0.
- `'a room leaving the screen counts again, and is marked when it comes back'`: read `#a`, then `see` without it, a line arrives, then `see` with it again. `log('#a').newFrom` is that line's id.
- `'a ping in a room with no tab or panel on screen stays'`: a mention in `#b` with `rowed` lacking `#b` keeps `snapshot().ping`. Adding `#b` to `rowed` clears it.
- `'a ping seen in one room does not see another room's'`: mentions in `#a` and `#b`, with only `#a` in `rowed`, leave the ping on `#b`'s line with `more: 0`.
- `'see reports a change only when there is one'`: the same sight twice returns true, then false.
- `'a line goes to the room it was typed in'`: `input('hello', '#b')` with `#a` the client's first channel sends `PRIVMSG #b :hello`.
- `'/join and /query name the room to open'`: they return `{ open: '#new' }` and `{ open: 'zed' }`. `/query zed` creates the `zed` tab even with no text. Plain text returns `{ open: null }`.
- `'/close closes the room it was typed in'`.
- `'a conversation renamed tells onRenamed and stays read'`: `zed` is being read and becomes `zed_`. `onRenamed` gets `('zed', 'zed_')`, and a line from `zed_` leaves unread at 0.
- `'a kicked channel says so'`: after `KICK #a mage`, `channel('#a').kicked` is true. After a rejoin it is false.
- Service: `'a sight given before there is a client applies to the client made later'`: `see` while `nick` is null, then `applySettings` with a nick and `connect`. The first channel's lines are read.

- [ ] **Step 2: Run the rewritten suites to see them fail**

Run: `node --test src/main/chat/client.test.ts src/main/chat/service.test.ts 2>&1 | grep -cE "^not ok"`
Expected: many failures, with `see`, `log` or `input`'s second argument missing.

- [ ] **Step 3: Implement.** `Chan` gains `pingsSeen: number`. The client keeps `reading: Set<string>` of folded names. `see` leaves rooms that dropped out, reads rooms that came in, then raises `pingsSeen` to `lastId` on every room in `reading` or `rowed`. It compares a digest of what it changed (unread counts, `newFrom`s and the ping) before and after. Thread `at` through `speak`, `fits`, `note` and `online`. `whoisTo` records `at`. `forget` no longer selects. `applySettings`' `/nick` passes `SERVER_LOG`. The service keeps the last sight and applies it right after it constructs a client.

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | tail -5`
Expected: all tests pass. Typecheck errors are expected in `serverWindow.ts`, `index.ts` and the renderer, which Tasks 4 and 5 own. There should be none in `src/main/chat/` or `src/shared/`: `npm run typecheck 2>&1 | grep -E "src/(main/chat|shared)/"` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/main/chat/ src/shared/chat.ts
git commit -m "feat: chat reads every room on screen, and a line goes to the room it was typed in"
```

---

### Task 4: Main wires it up: panes, windows, IPC and `CLAUDE.md`

**Files:**
- Modify: `src/shared/panes.ts` (`PaneView.chatPage` becomes `PaneView.chat: ChatPaneView | null`, with `ChatPaneView` as in the spec)
- Modify: `src/main/paneHost.ts`, `src/main/serverWindow.ts`, `src/main/index.ts`
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`
- Modify: `CLAUDE.md` (the chat sections, the layout invariant's list of resizes, and the `TOOL_IDS` paragraph, as the spec's Hazards list)

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces:
  - `paneHost` deps: `chat: (paneId: string) => ChatPaneView | null` replaces `chatPage`.
  - `paneHost` methods:
    - `insert(to: string, side: Side, room: Size, content: PaneContent): { paneId: string | null; grown: Size }`. It goes through `adoptAdded`; `split` calls it.
    - `beginInsertDrag(content: PaneContent): DropTargets | null`.
    - `dropInsert(content: PaneContent, to: string, zone: DropZone, room: Size): { paneId: string | null; grown: Size }`. It checks `canInsert` again and ends the drag first, as `drop` does.
    - `renameRoom(from: string, to: string): void`. It replaces the tab set through `chatPanes.renameRoom` and does **not** call `changed()`; the emit that follows pushes.
  - `ServerWindowDeps`:
    - `chatSight: (sight: ChatSight) => void` replaces `chatShown` and `chatHidden`.
    - `chatLog: (room: string) => ChatLog`.
    - `chatLast: () => string | null` and `chatPicked: (room: string) => void`.
  - `ServerWindow`:
    - `showChat(room: string | null, page: ChatPage): void`.
    - `showChatRoom(paneId: string, room: string): void` and `chatRoomOf(paneId: string): string | null`.
    - `chatOpened(paneId: string, room: string): void`.
    - `openRoom(paneId: string, room: string, where: 'right' | 'below' | 'tab'): void`.
    - `beginRoomDrag(room: string): DropTargets | null` and `dropRoom(room: string, to: string, zone: DropZone): void`.
    - `chatRenamed(from: string, to: string): void`.
    - `showChatPage` stays.
  - IPC (`ipc.ts`), all `zanaris:chat-*`:
    - `chatSend(paneId, text)`, `chatShowRoom(paneId, room)` and `chatShowSettings()`.
    - `chatRoomMenu(paneId, room, x, y)`.
    - `chatBeginRoomDrag(room) → DropTargets | null` and `chatDropRoom(room, to, zone)`.
    - `chatUserMenu(paneId, nick, x, y)`.
    - `chatSelect` is removed.
  - `ZanarisApi.chat` mirrors these as `send(paneId, text)`, `showRoom`, `showSettings`, `roomMenu`, `beginRoomDrag`, `dropRoom` and `userMenu(paneId, nick, x, y)`.

- [ ] **Step 1: `serverWindow`.** `chatPageOf` becomes `chatPaneOf: Map<string, ChatPaneState>`, read only through `currentChatPanes()`. That calls `chatPanes(host.trees(), chatPaneOf, channels, panelledRooms(host.trees()), fresh)`, with `fresh = () => ({ page: firstPage(deps.chat()), room: freshRoom(row, deps.chatLast()) })`. `pushState` calls `deps.chatSight(chatSight(host.tree(), currentChatPanes(), row))` before `state()`. The host's `chat(paneId)` builds a `ChatPaneView`:
  - A room panel is `{ panel: true, page: 'chat', room, row: [], ...deps.chatLog(room) }`.
  - A chat pane is `{ panel: false, page, room, row, ...log }`, with an empty log when `room` is null.

  `showChat` uses `panelFor` first (select the tab, focus the pane). Otherwise it does what it does today and sets the found pane's state. `openRoom` goes through `split` for right and below, and through `newTab` plus `setContent` for tab. `dropRoom` goes through `host.dropInsert(..., roomToGrow())` then `growWindow`. Each new method refuses a room that `readRoom` rejects. `beginRoomDrag` also refuses a room not in this window's row.

- [ ] **Step 2: `index.ts`.**
  - `chatInFront` becomes `chatSights: Map<number, ChatSight>`. `applySight()` unions every entry, calls `chat.see`, and pushes every *other* window when it reports a change.
  - The chat subscription calls `applySight()` before pushing.
  - A window closing deletes its entry and applies.
  - `lastRoom` (initially null) backs `chatLast` and `chatPicked`.
  - `onRenamed` fans out `sw.chatRenamed`.
  - `chatSend` reads `windowFor(sender).chatRoomOf(paneId)`, sends, and calls `chatOpened` on `open`.
  - `notifyMention` returns false in capture mode. Its click calls `sw.showChat(line.channel, 'chat')` on the window it focuses.
  - `chatOpenPing` calls `showChat(room, 'chat')`.
  - `chatRoomMenu` builds a native menu (Open Right, Open Below, Open in New Tab) the way `chatUserMenu` builds its own.
  - `chatUserMenu`'s Message and Whois send from the pane's room, and Message's `open` goes through `chatOpened`.
  - `paneSetContent` checks a tool's `room` with `readRoom` and refuses the call when it fails. Today the handler checks only `kind`.

- [ ] **Step 3: `CLAUDE.md` and comments.**
  - Rewrite "The open room is read only while a chat pane shows the conversation" for rooms and panes.
  - Extend the ping paragraph: a room with no tab or panel on screen.
  - Add "a room opened beside a pane" to the layout invariant's list of what resizes the window. Fix "Those four are the only things that resize the window — not a drop" to say a room dropped is an added pane, and a moved pane is not.
  - Add to the `TOOL_IDS` paragraph why a room panel is a field rather than an id.
  - Fix every comment the spec's Hazards names.

- [ ] **Step 4: Typecheck and tests**

Run: `npm run typecheck 2>&1 | grep -vE "src/renderer/" ; npm test 2>&1 | tail -3`
Expected: no errors outside `src/renderer/` (Task 5 owns those), and all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main src/shared src/preload CLAUDE.md
git commit -m "feat: each chat pane keeps its own room, and main opens room panels"
```

---

### Task 5: The renderer: the room panel, the row and the drag

**Files:**
- Modify: `src/renderer/tools/Chat.tsx`, `src/renderer/tab.tsx`, `src/renderer/Shell.tsx`, `src/renderer/dropIndicator.tsx` (only if it needs a label rather than a pane name)

**Interfaces:**
- Consumes: `PaneView.chat: ChatPaneView`, and the `ZanarisApi.chat` methods from Task 4.
- Produces: `Chat({ view, pane, width, paneId, grabRoom })`, where `pane: ChatPaneView` and `grabRoom: (room: string) => Grab`. `Grab` is the pointer-handler bundle `Shell.grabFor` returns.

- [ ] **Step 1: `Shell.tsx`.** `Held` and `Drag` carry `from: { kind: 'pane'; paneId: string } | { kind: 'room'; room: string }`. `grabRoom(room)` works like `grabFor`, except:
  - It needs no second pane to start.
  - It asks `chat.beginRoomDrag(room)`.
  - The release calls `chat.dropRoom(room, over, zone)` where main said it would land, and `panes.endDrag()` otherwise.

  `DropIndicator`'s dragged name is the room's label (`Status` for `SERVER_LOG`). `PaneContentBody` passes `pane.chat` and `grabRoom` to `Chat`. Escape, a layout change and an unmount end a room drag as they end a pane drag.

- [ ] **Step 2: `tab.tsx`.** Add optional `onContextMenu` and pointer-handler props, passed to the button. A press that became a drag must not fire `onSelect`: drop the click that follows a drag.

- [ ] **Step 3: `Chat.tsx`, the chat pane.**
  - The row lists `pane.row`, each name looked up in `view.channels` for its counts.
  - The open tab is `pane.room`.
  - A tab press calls `chat.showRoom(paneId, name)`.
  - A right-click calls `chat.roomMenu(paneId, name, x, y)`.
  - A drag uses `grabRoom(name)`.
  - When `pane.room` is null, the pane shows "Every room has a panel of its own." and has no message box.

- [ ] **Step 4: `Chat.tsx`, the room panel** (`pane.panel`).
  - It has no row. For a channel, a top row holds its topic on one truncated line (its full text in `title`) and the People and Info toggles at the right.
  - It then shows `Status` and the conversation.
  - In place of the conversation, in the spec's order:
    1. With no nick, the note and a button calling `chat.showSettings()`.
    2. Offline, "Chat isn't connected." and Connect (`chat.connect()`).
    3. Not in the channel, or kicked, "You're not in #x." and Join (`chat.send(paneId, '/join #x')`).
- [ ] **Step 5: `Conversation`.**
  - It takes `room`, `lines` and `newFrom` from `pane`, and sends with `chat.send(paneId, text)`.
  - `Words`' channel links send from the pane.
  - `openUserMenu` passes `paneId`.
  - The draft rule moves a draft only when the old room is gone *and* the new room was not in the previous render's `view.channels`. Keep that list in a ref, and fix the comment to match.

- [ ] **Step 6: Typecheck, test and build**

Run: `npm run typecheck && npm test 2>&1 | tail -3 && npm run build 2>&1 | tail -3`
Expected: all clean. `themes.test.ts` passes, so no literal colours slipped in.

- [ ] **Step 7: Commit**

```bash
git add src/renderer
git commit -m "feat: room panels in the shell — drag a room's tab out, or right-click it"
```

---

### Task 6: A scripted chat server for capture, and the capture steps

**Files:**
- Create: `src/main/chat/scripted.ts`, `src/main/chat/scripted.test.ts`
- Modify: `src/main/index.ts` (capture mode builds `ChatService` with `scriptedConnect`, and the new capture steps)

**Interfaces:**
- Produces: `scriptedConnect(opts: { rooms: { name: string; topic: string; users: string[]; lines: { nick: string; text: string }[] }[]; defer: (fn: () => void) => void }): ChatIo['connect']`. It never opens a socket. On connect it defers `opened()`. It answers `CAP REQ` with NAK, and `USER` with `001` to the nick `NICK` gave. Each `JOIN` gets the join, `332`, `353` and `366`, then that room's scripted lines as PRIVMSGs from their nicks. `PING` gets `PONG`. Everything else is ignored.

- [ ] **Step 1: Write the failing test** `'a service on the scripted server joins and hears the rooms'`. Build a `ChatService` with `nick: 'capture'`, `autoJoin: ['#a', '#b']`, and `io.connect = scriptedConnect(...)`. The `defer` and `setTimer` fakes run their function at once. Then assert that `view().status === 'online'`, that `#a`'s users are the scripted ones, and that `log('#a').lines` holds its scripted text.

- [ ] **Step 2: Run it to see it fail, implement `scripted.ts`, and run it to see it pass**

Run: `node --test src/main/chat/scripted.test.ts`
Expected: FAIL, then PASS.

- [ ] **Step 3: Capture steps in `index.ts`.** The existing no-nick chat shots stay first and are unchanged. Then:
  1. `applySettings({ nick: 'capture', autoJoin: ['#2004scape', '#LostHQ', '#Zanaris'] })` and `connect()`. Wait until the view is online.
  2. Shoot the chat pane with rooms.
  3. `openRoom(chatPane, '#LostHQ', 'right')`. Shoot it. Fault unless the chat pane's `row` lacks `#LostHQ` and a pane has `chat.panel && chat.room === '#LostHQ'` with lines.
  4. Open a second window of the same server. Fault unless its chat pane's row has `#LostHQ`. Close it.
  5. `beginRoomDrag('#Zanaris')`, then `panes.endDrag()`. Fault unless the game view is visible afterwards.
  6. `splitPaneWith(chatPane, 'y', { kind: 'tool', tool: 'chat', room: '#notjoined' })`. Shoot the Join state. Fault if the scripted server ever saw `JOIN #notjoined`.
  7. Put the window's front tab on a tab with no chat, and let the scripted server send a line naming `capture` in `#Zanaris`. Fault unless `state().chat.ping` names it. Shoot the game header.

  Log each pane's `chat` view, with the line count, not the lines.

- [ ] **Step 4: Run capture and open the shots**

Run: `caffeinate -d npm run capture 2>&1 | tail -40`
Expected: exit 0 and no `fault` lines. **Open every new PNG.** A green log reads state, not pixels.

- [ ] **Step 5: Commit**

```bash
git add src/main/chat/scripted.ts src/main/chat/scripted.test.ts src/main/index.ts
git commit -m "test: capture talks to a scripted chat server and shoots room panels"
```
