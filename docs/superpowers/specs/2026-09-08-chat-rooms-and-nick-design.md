# Zanaris Kit: hand-joined rooms, and a nick that sticks

**Status:** proposed, 2026-09-08. Extends the chat described in
`2026-09-07-chat-dock-design.md` and the SwiftIRC move that followed it.

## Goal

Four things the owner asked for:

1. A close control on **hand-joined rooms only**.
2. Hand-joined rooms persist in `state.json` and survive a restart.
3. The IRC nick survives a restart.
4. The nick can be changed.

**(3) already works** — `chatSetNick` writes the nick to `state.json` and the
service reconnects with it on launch. **(4) half works**: `/nick` is parsed and
sent, so the name changes for the session, but that path never reaches
`AppState`, so it is lost on restart. The two ways of setting a nick therefore
disagree, which is the actual defect.

## What already exists

Worth stating, because most of this is plumbing that is already built:

- `IrcClient` tracks `want` — every channel it is in, auto-joined or not — and
  `wanted()` exposes it. `join`/`part` maintain it, and a reconnect rejoins it.
- `/join` and `/part` are parsed (`protocol.ts`) and executed (`client.ts`).
- `ChatChannel.nicks` is maintained from `353`/`366` and kept current through
  `JOIN`/`PART`/`QUIT`/`NICK`. Nothing renders it. **Out of scope here** — the
  owner asked about it and did not ask for it.
- `setServers` parts only the rooms it manages, because it tracks the auto set in
  `this.channels` rather than asking the client. So a hand-joined room already
  survives a window closing. It does **not** survive a restart, because the
  client is constructed with the auto set alone.

## Which rooms are "hand-joined"

Derived, not stored twice:

```
handJoined = client.wanted() − wantedChannels(openServerIds)
```

The service already has both halves. Storing a second parallel list would let the
two drift; deriving means `setServers` and `/join` cannot disagree about what is
closable.

## The design

### 1. `ChatChannel` says whether it can be closed

```ts
export interface ChatChannel {
    name: string;
    nicks: string[];
    unread: number;
    highlights: number;
    /** Hand-joined, so the user may close it. An auto-joined room would only come back. */
    closable: boolean;
}
```

The renderer must not compute this. A close control on an auto-joined room is a
button that appears to work and then undoes itself on the next window open or
close, which is worse than no button.

### 2. `state.json` carries the rooms

`ChatSettings` gains `rooms: string[]`, read field-by-field by `readChat` in the
established style: each entry must be a non-empty string that `isChannel`
accepts, capped in count and length, and one bad entry costs only itself. An
older file without the key loads clean.

### 3. Persist by observing, not by commanding

`ClientOpts` has no callback for "the user joined a room" or "the nick changed",
and adding one would put a second notification path beside the existing
`subscribe`. Instead `index.ts` — which already subscribes to the service —
writes back when the persisted fields change:

```
on every view change:
    if view.nick !== stored.nick            -> persist it
    if handJoined(view) !== stored.rooms    -> persist them
```

This covers `/nick`, `/join`, `/part`, the close button, and a server-forced nick
change with one rule. It also persists the nick **as confirmed by the server**
rather than as typed, so a `433` rejection does not write a nick that does not
work.

**Guard the write.** The view changes on every message; `save()` writes the whole
profile. Compare against the last written values and write only on a real change.

### 4. Startup merges the two sets

The service takes `rooms` and opens the client with
`wantedChannels([]) ∪ rooms`. `setServers` continues to manage only the auto set,
so a persisted room is never parted by a window closing.

### 5. Closing

A new `chatCloseRoom` IPC channel. Main validates the payload is a string,
refuses a room that is not currently hand-joined — the lobby and a per-server
room are not the user's to close — parts it, and lets the observer above drop it
from `state.json`.

## Out of scope

- **The nick list.** The data is there; nothing renders it. Not asked for.
- **A dedicated nick-change control.** With `/nick` persisting, the nick can be
  changed and the change sticks, and `NickPrompt` already tells the user that
  `/nick` is how. A control in the panel is a small follow-on if the prompt's
  sentence turns out not to be discoverable enough.
- **NickServ.** Still no `PASS`, no SASL. Unchanged.

## Testing

`chat/service.test.ts` and `appState.test.ts` are where this is proven, both pure
and Electron-free:

- a persisted room is joined at startup, alongside the auto rooms
- `setServers` never parts a hand-joined room, and still parts its own
- `closable` is true for hand-joined and false for the lobby and per-server rooms
- closing a room that is not hand-joined is refused
- `readChat` survives a `rooms` value that is missing, not an array, or holds a
  non-channel, losing only that entry
- the nick observed from the view is what gets persisted, not the nick as typed
