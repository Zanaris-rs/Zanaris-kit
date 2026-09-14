# Zanaris Kit: countdowns and timers

**Status:** implemented, 2026-09-14. Supersedes the **Timers** paragraph of
`2026-09-05-server-windows-design.md` (absolute end times persisted to
`timers.json`, a rail badge). The rail is gone and nothing here survives a
restart; the reasons are under **Rejected**. `design/Timers.dc.html` is the
visual starting point for the pane.

## Goal

A **Timers** tool that holds two kinds of clock:

- a **countdown**, which runs from a duration down to 0:00, and
- a **timer**, which counts up from 0:00.

Every clock has the same settings: a **threshold** at which it alerts, a
**volume** for the alert sound, and **AFK mode**, which restarts the clock on any
click or key in the game. Two countdowns are built in on every server:

| Built-in | Kind | Duration | Threshold | Volume | AFK mode | Why |
|---|---|---|---|---|---|---|
| AFK | countdown | 90s | 15s | 80% | on | The 274 client sends `IDLE_TIMER` after 4500 cycles × 20ms = 90s without input, and the world logs the player out (`IdleTimerHandler`). |
| Thieving | countdown | 5m | 30s | 80% | off | An npc that has not moved for 5 minutes despawns. |

A player can add their own clocks, edit the built-ins and restore them.

## Decisions taken

| Question | Answer |
|---|---|
| What is AFK mode? | On or off, per clock. On: a mouse down or key down anywhere in the game view — not only on the game's canvas — restarts the clock. No per-input checkboxes. |
| What is an alert? | A **silent** OS banner, plus the OS alert sound played **by the kit** at the clock's volume. An OS notification's own sound cannot have its volume set by an app. |
| What does a timer's threshold mean? | It alerts once when elapsed time reaches the threshold, then keeps counting. |
| What does a countdown do at 0:00? | Holds there, marked expired, until reset (or, with AFK mode, restarted by input). No second alert. |
| Where do a player's own clocks and edits live? | **App-wide.** One list for every server window. |
| Where do the built-ins live? | **Per server**, in each catalog entry, written out separately so they can differ later even though they are identical today. |
| Where do clocks run? | In **main**, one runner per window, over an injected clock. Not in the renderer. |

### Definitions are app-wide; clocks are per window

Two windows open on two servers each have their own AFK clock, because each is
its own login and its own idle timer. What they share is the *definition*: an
edit to the AFK threshold made in a Lost City window is also Zanaris's AFK
threshold. Nothing about a running clock is shared between windows.

## Model

### `TimerDef` (`src/shared/timers.ts`)

```ts
export interface TimerDef {
    /** 'afk' and 'thieving' for the built-ins; 'custom-<8 hex>' for the player's own. */
    id: string;
    name: string;
    kind: 'countdown' | 'timer';
    /** Countdowns only; null for a timer. */
    durationMs: number | null;
    /** Countdown: alert when this much is left. Timer: alert when this much has elapsed. */
    thresholdMs: number;
    /** 0–1. Zero plays no sound. */
    volume: number;
    /** A mouse down or key down in the game view restarts this clock. */
    afk: boolean;
}
```

A definition is valid when:

- `name` is 1–40 characters after trimming;
- a countdown has `1_000 ≤ durationMs ≤ 86_400_000` and `0 ≤ thresholdMs < durationMs`
  (a threshold of 0 alerts at 0:00, which is how "tell me when it is done" is spelled);
- a timer has `durationMs === null` and `1_000 ≤ thresholdMs ≤ 86_400_000`;
- `0 ≤ volume ≤ 1`;
- a built-in id does not start with `custom-`, and a custom id does.

`shared/timers.ts` also holds the pure display helpers: `formatClock(ms)` (`m:ss`,
`h:mm:ss` from an hour) and `parseDuration(text)` (accepts `m:ss`, `h:mm:ss` or a
bare number of seconds; null for anything else).

### The catalog carries each server's built-ins

`ServerDef` gains `timers: TimerDef[]`. Each of the four `DEFAULT_SERVERS`
entries — `lostcity`, `zanaris`, `lostcitylabs`, `singleplayer` — lists its own
AFK and Thieving definitions inline. They are not a shared constant mapped in,
because the point of listing them per entry is that one server's can change
without the others'.

Built-in timers are the kit's knowledge, not the player's choice, so they follow
the `refreshHiscores` rule: `refreshTimers` re-adopts each built-in entry's
`timers` from `DEFAULT_SERVERS` on every launch, behind the same guard (same id,
same kind, stored url on one of the built-in's hosts). The player's edits are not
stored here, so re-adopting loses nothing.

A server added through the launcher's form is created with `newServerTimers()`,
the same AFK and Thieving pair. It is not refreshed afterwards: an added server is
not a built-in, and the guard would not recognise it.

**Catalog version 5.** Version 4's loader requires every entry to pass
`isServerDef`, which will now require `timers`, so a version 4 file read by the
new code would be renamed aside as broken and replaced by the defaults. Version
4 → 5 fills `timers` from the matching built-in, or `newServerTimers()` for any
other entry. Versions 1–3 migrate through 4 as they do today. `isServerDef`
checks each timer is a valid built-in definition and the ids are unique within
the entry.

### The player's clocks and edits (`state.json`)

`StateFile` gains:

```ts
timers: {
    /** The player's own, in the order they were added. At most 20. */
    custom: TimerDef[];
    /** Changes to a built-in, by its id. Only these fields may be edited. */
    edits: Record<string, Partial<Pick<TimerDef, 'name' | 'durationMs' | 'thresholdMs' | 'volume' | 'afk'>>>;
}
```

`StateFile.version` stays 1: like `readChat`, `readTimers` reads the block one
field at a time, so a missing block is the empty one and a bad entry costs only
itself. A custom definition that fails validation is dropped; an edit field of
the wrong type is dropped.

A built-in's `kind` cannot be edited. A custom definition's can.

Saving a built-in from a window stores, as its edit, only the editable fields that
differ from **that window's server's** catalog definition of it; if none differ,
the edit is removed. So saving a built-in unchanged is the same as restoring it,
and an edit never freezes a value the kit might later change.

### What a window lists

`timersFor(serverTimers, state)` returns the server's built-ins in catalog order
with their edits applied, then every custom definition. The whole edit is applied
at once when the result is a valid definition, so a duration and a threshold
lowered together both apply. Only when it is not is the edit applied field by
field, in the order `name`, `volume`, `afk`, `durationMs`, `thresholdMs`, skipping
any field that would make the definition invalid — which is what happens when the
kit changes a built-in's duration under an edited threshold: the threshold edit
stops applying rather than breaking the clock. Edits for an id this server does
not have are kept on disk and ignored.

## Clocks

### Phases

Each clock in a runner is in one phase:

| Phase | Shows | Start | Pause | Reset |
|---|---|---|---|---|
| `idle` | countdown: its duration · timer: 0:00 | runs from the beginning | — | runs from the beginning |
| `running` | the live value | — | `paused` at the current value | runs from the beginning |
| `paused` | the frozen value | runs on from the frozen value | — | runs from the beginning |
| `expired` (countdown only) | 0:00 | runs from the beginning | — | runs from the beginning |

"Runs from the beginning" also clears the clock's `alerted` flag. Resuming from
`paused` does not.

**Reset runs.** It is the button pressed when the thieving target moves, and the
next thing that is wanted is the clock going again.

### Threshold and zero

While `running`, a clock alerts **once per run** when:

- a countdown's remaining time is ≤ `thresholdMs`, or
- a timer's elapsed time is ≥ `thresholdMs`,

and its `alerted` flag is not yet set. The alert sets it.

A countdown that reaches 0:00 goes to `expired`. If its threshold is 0 and it has
not alerted, that is when it alerts. It never alerts a second time at zero.

A timer has no end. It counts until paused or reset.

### No ticking in main

The runner keeps **at most one pending timeout**, set for the earliest next
event among running clocks: an un-alerted threshold crossing or a countdown's
zero. When it fires, the runner reads `now()` and processes every clock whose
event is due at or before it, then schedules the next. Because it reads the wall
clock rather than trusting the timeout's delay, a countdown that crossed its
threshold and reached zero while the lid was shut alerts once, and is `expired`.

The timeout itself does not count the time asleep, though, so after a wake it
fires only once its remaining delay has passed, and until then the digits read
0:00 with no alert. So on a wake from system sleep (`powerMonitor`'s `resume`)
main also settles every window at once: each runner's `settle()` processes
whatever is due at `now()` and schedules the next event.

The shell draws the digits itself from what main sent — a value and the
`Date.now()` it was true at — on a short interval of its own. A throttled hidden
shell only delays digits nobody is looking at; the alert is main's.

`ShellState.timers` is pushed on a **phase change**, an alert or a definition
change, not on a tick. Input is the exception worth spelling out: every mouse
down and key down restarts AFK clocks, and a whole shell state per keystroke is
a lot to send for a restart the digits can barely show. So a restart by input
pushes when it changes a phase or clears an alert, or when the last push for
input was a second or more ago. Between those, the digits can read up to a second
low, which errs early.

### AFK mode and the game view

`serverWindow` listens to the game view's `webContents` `input-event`. For
`mouseDown`, `rawKeyDown` and `keyDown` — `isGameInput` decides — it calls
`runner.input()`, which restarts every clock with `afk: true` that is **not
paused**: `idle`, `running` and `expired` all run from the beginning. So:

- the built-in AFK countdown starts by itself at the first click or key after the
  window opens;
- a paused AFK clock ignores input until the player presses Start;
- input while the game view shows one of the kit's own `file:` pages (the offline
  or starting page) is ignored, because there is no login to be idle on.

Key repeat counts, as it does in the client.

This is not the client's idle timer exactly, and it can be wrong in both
directions:

- **Early.** The client also counts mouse movement, which the kit does not, so
  the client's idle timer can be reset when the countdown is not.
- **Late.** The client counts only input on its own canvas (its handlers are on
  the `canvas` element), while `input-event` reports a mouse down or key down
  anywhere in the game view — the page margin, the controls strip below the
  765×503 canvas, or a key typed after focus has left the canvas. Such input
  restarts the countdown while the client's idle timer keeps running, so the
  warning can come late.

When the game view is **destroyed** (`destroyGame`), or a page **commits** in it —
a main-frame `did-navigate`: a world switch, a detail switch, a retry, the kit's
offline or starting page — the runner's `gameGone()` puts every AFK clock that is
not paused back to `idle`. That login's idle timer is gone, and the next one
starts at the next input. A navigation the guard cancels loads nothing, so it
resets nothing, and neither does an in-page navigation. Clocks without AFK mode
are left alone.

### Definition changes

When a definition is saved, deleted or restored, every window's runner receives
the new list through `setDefs(defs)`:

- a clock whose definition is unchanged keeps its phase and value;
- a clock whose definition changed goes to `idle`;
- a clock whose definition is gone is dropped;
- a new definition gets an `idle` clock.

### Window close

`runner.dispose()` clears the pending timeout. Nothing is saved.

## Alerts

When a clock alerts, the runner calls `io.alert(def, at)` where `at` is
`'threshold'` or `'zero'`. `serverWindow` does two things:

1. **Banner.** If the window is **not focused** and `Notification.isSupported()`,
   show `new Notification({ title, body, silent: true })`. Clicking it shows and
   focuses the window. The notification is held in a set until it is closed or
   clicked, so its click handler is not collected. When the window is focused
   there is no banner: the pane and the sound are already in front of the player.

   | Alert | Title |
   |---|---|
   | countdown, threshold > 0 | `AFK: 15s left` |
   | countdown, threshold 0 (at zero) | `Thieving: time's up` |
   | timer | `Stopwatch: 0:20 elapsed` |

   The body is the window's title (server and world, e.g. `Lost City · W5`).

2. **Sound.** If `volume > 0`, send `zanaris:timers-alert` `{ volume }` to the
   window's shell. The shell plays it whether or not a Timers pane is open.

### Which sound

Resolved **once at launch** in main, by `sound.ts` deciding and
`timers/electron.ts` doing the reading:

| Platform | Candidates, in order |
|---|---|
| macOS | the path in `defaults read -g com.apple.sound.beep.sound`, then `/System/Library/Sounds/Tink.aiff` — CoreAudio's own fallback when that key is unset (see **Build order**, step 1) |
| Windows | the default value of `HKCU\AppEvents\Schemes\Apps\.Default\.Default\.Current`, with `%SystemRoot%`-style variables expanded |
| Linux | `/usr/share/sounds/freedesktop/stereo/bell.oga`, then `…/complete.oga` |
| every platform, last | `static/sounds/chime.wav`, bundled |

Each candidate is read (at most 5 MB) and passed to `toPlayable(bytes)`, which
sniffs the header:

- WAV (`RIFF…WAVE`), Ogg (`OggS`), FLAC (`fLaC`), MP3 (`ID3` or a frame sync) and
  MPEG-4 (`ftyp`) pass through unchanged — Chromium decodes them;
- AIFF (`FORM…AIFF`) and uncompressed AIFF-C (`FORM…AIFC` with compression `NONE`
  or `sowt`) at 8, 16, 24 or 32 bits are rewritten as 16-bit little-endian PCM WAV
  at the same rate and channel count. macOS's `/System/Library/Sounds/*.aiff` are
  this (24-bit stereo, 48 kHz), and Chromium cannot decode AIFF;
- anything else returns null, and the next candidate is tried.

The first playable candidate is the sound. `chime.wav` is always playable, so
there always is one.

The shell asks for the bytes once, with `zanaris:timers-sound`, decodes them with
`AudioContext.decodeAudioData`, and caches the buffer. Each alert plays a
`BufferSource` through a `GainNode` set to the clock's volume. If decoding fails,
the shell asks once more with `fallback` set to `true` and main answers with
`chime.wav`.

`chime.wav` is made for this project by `scripts/make-chime.mjs` (a short
two-tone sine, 44.1 kHz mono 16-bit, under half a second), and the generated file
is committed. It is ours, so there is no licence to track.

## The Timers pane

`src/renderer/tools/Timers.tsx`, dressed as `design/Timers.dc.html`: a `.tile`
panel with a list of rows in a `.sunk` well, and the form below.

**A row:** the clock's name, its value in large tabular digits, an **AFK** tag
when AFK mode is on, **Start**/**Pause** (one button, labelled for what it will
do), **Reset**, and an edit toggle.

| Phase | Digits |
|---|---|
| `idle`, `paused` | dim |
| `running`, before the threshold | gold |
| `running`, alerted | red |
| `expired` | red, 0:00 |

`clockTone` in `shared/timers.ts` decides the tone; the pane only maps it to a class.

**The edit form** opens in place under its row:

- Name
- Countdown / Timer (custom clocks only)
- Duration, countdowns only: a text box read by `parseDuration`, and the artboard's
  1 / 5 / 30 / 80 min buttons, which fill it
- Threshold, the same kind of box
- Volume, a 0–100% slider, and **Test**, which plays the sound at the slider's
  volume in the shell, with no IPC beyond fetching the bytes
- AFK mode, a checkbox
- **Save** and **Cancel**; then **Delete** for a custom clock, or **Restore
  default** for a built-in that has an edit

Save is disabled while the form is not a valid definition, with the reason shown
under the field that makes it so. Main validates again at the IPC boundary and
refuses an invalid definition; the renderer's check only spares the player a
refusal.

**Add countdown or timer** under the list opens the same form, blank: a
countdown, 5:00, threshold 0:30, volume 80%, AFK mode off. It is disabled at 20
custom clocks.

The footer keeps the artboard's line: *Timers run with the panel closed.*

### Where the tool is offered

`TOOL_IDS` gains `'timers'`, and `paneMenu`'s `TOOL_NAMES` gains
`timers: 'Timers'`. Every window offers it, because a player's own clocks are
app-wide and the built-ins are on every server. It is listed after Hiscores and
before Single player. It is reached through Add pane, a pane's dropdown and an
empty pane's launcher, like every other tool. The default layout for a new window
(game over chat) does not change.

## IPC

| Channel | Direction | Payload | Does |
|---|---|---|---|
| `zanaris:timers-start` | shell → main | `id` | Start |
| `zanaris:timers-pause` | shell → main | `id` | Pause |
| `zanaris:timers-reset` | shell → main | `id` | Reset |
| `zanaris:timers-save` | shell → main | `Omit<TimerDef, 'id'> & { id: string \| null }` (null: a new custom, given an id by main) | validate, store, `setDefs` in every window |
| `zanaris:timers-delete` | shell → main | `id` | custom only |
| `zanaris:timers-restore` | shell → main | `id` | built-in only; clears its edit |
| `zanaris:timers-sound` | shell → main | `fallback: boolean` | returns the sound bytes; `true` asks for `chime.wav` |
| `zanaris:timers-alert` | main → shell | `{ volume }` | play |

Start, pause and reset act on the calling window's runner only. Save, delete and
restore change the app-wide definitions and so reach every window.

`ShellState.timers`:

```ts
export interface TimersView {
    clocks: ClockView[];
    /** True at 20 custom clocks, so the add button can say why it is off. */
    customsFull: boolean;
}

export interface ClockView {
    def: TimerDef;
    builtIn: boolean;
    /** A built-in with an edit, so the form can offer Restore default. */
    edited: boolean;
    phase: 'idle' | 'running' | 'paused' | 'expired';
    /** Remaining (countdown) or elapsed (timer) ms, true at `at`. */
    valueMs: number;
    /** The `Date.now()` at which `valueMs` was true. */
    at: number;
    alerted: boolean;
}
```

## Where the code lives

| File | Holds | Tested |
|---|---|---|
| `src/shared/timers.ts` | `TimerDef`, `TimersView`, `ClockView`, validation, `formatClock`, `parseDuration`, `clockTone` | yes |
| `src/main/timers/defs.ts` | `readTimers`, `timersFor`, the save / delete / restore rules, `newServerTimers`, custom id generation | yes |
| `src/main/timers/runner.ts` | `TimersRunner` over `TimersIo { now, setTimer, alert, changed }` (`setTimer` returns its own cancel); `isGameInput`, which input restarts AFK clocks | yes |
| `src/main/timers/sound.ts` | platform candidates, `toPlayable`, AIFF → WAV | yes |
| `src/main/timers/electron.ts` | `resolveAlertSound()` (`defaults`, `reg`, file reads), the banner | no — a seam, no rules |
| `src/main/catalog.ts` | `timers` on each built-in, version 5, `refreshTimers`, the add path | yes |
| `src/main/appState.ts` | the `timers` block | yes |
| `src/main/serverWindow.ts`, `src/main/index.ts` | one app-wide definition store, the resolved sound and the settle on a wake from sleep in `index`; one runner per window, `input-event`, `gameGone`, the banner and the alert send in `serverWindow` | no |
| `src/preload/index.ts`, `src/shared/ipc.ts` | the `timers` API and channels | typecheck |
| `src/renderer/tools/Timers.tsx`, `Shell.tsx` | the pane; the shell's alert player | no |
| `static/sounds/chime.wav`, `scripts/make-chime.mjs` | the fallback sound; `electron-builder.yml` already ships `static/**` | — |

Every rule is in a tested module; `serverWindow`, `index` and the renderer only
connect them, as `CLAUDE.md` requires.

## Edge cases

- **Two windows on the same server.** Each has its own runner. An input in one
  game does not restart the other's AFK clock.
- **The game in another tab.** Input still reaches its `webContents`, and a
  switched-away tab is hidden, not closed, so AFK clocks keep running and
  restarting as usual. Closing that tab destroys the game and calls `gameGone()`.
- **Editing a running clock.** Saving puts it to `idle` in every window, which the
  player sees immediately. It does not alert for the old definition.
- **A banner the OS refuses** (notifications turned off for the app, or
  `isSupported()` false). The sound still plays. Nothing is shown in its place.
- **Volume 0 while the window is focused.** Nothing is heard and no banner is
  shown. The row turning red is the only alert. That is what the player set.
- **An alert sound that cannot be read** (a missing file, a registry key that
  isn't there, `reg` or `defaults` failing). The next candidate is tried, down to
  the chime. `resolveAlertSound` logs which one it chose.

## Testing

`node --test`, no Electron:

- **`shared/timers.ts`**: validation limits on both sides of each boundary;
  `formatClock` around 59:59 / 1:00:00; `parseDuration` accepting `90`, `1:30`,
  `1:00:00` and refusing `1:60`, `-5`, empty, words; `clockTone` for every phase,
  alerted and not.
- **`defs.ts`**: `timersFor` orders built-ins then customs; an edit applies to
  every server's copy of that built-in; a duration and a threshold lowered
  together both apply, directly and through a save; when the whole edit is
  invalid, a field that would invalidate the definition is skipped and the rest
  still applies; restore clears the edit;
  delete refuses a built-in; save refuses a 21st custom and an invalid definition;
  saving a built-in stores only the fields that differ, and saving it unchanged
  removes its edit;
  `readTimers` keeps good entries beside bad ones; a built-in's `kind` edit is
  ignored.
- **`runner.ts`**, with a fake `now` and a recorded `setTimer`:
  - a countdown alerts once at its threshold and not again;
  - reset re-arms; pause then start does not;
  - a countdown holds at zero as `expired` with no second alert;
  - threshold 0 alerts at zero, once;
  - a timer alerts at its elapsed threshold and keeps counting;
  - `input()` restarts idle, running and expired AFK clocks and skips paused ones
    and non-AFK ones;
  - `gameGone()` idles AFK clocks that are not paused and leaves the rest;
  - at most one timer is ever pending, and it targets the earliest event;
  - a `now()` far past both threshold and zero (sleep) alerts once and expires;
  - `settle()` with the clock moved past both and the pending timeout not yet
    fired alerts once and expires, and on an idle runner pushes nothing;
  - `setDefs` keeps unchanged clocks, idles changed ones, drops removed ones;
  - `dispose()` clears the pending timer;
  - `isGameInput` takes a mouse down or key down on a game page, and refuses the
    other input types and any input on a `file:` page.
- **`sound.ts`**: candidate order per platform from injected facts; `toPlayable`
  passes WAV/Ogg/FLAC/MP3/MPEG-4 through, converts 8-, 16- and 24-bit AIFF and a
  `sowt` AIFF-C, built in the test, to 16-bit WAV whose samples match, and refuses a
  compressed AIFF-C, a CAF and garbage.
- **`catalog.ts`**: all four built-ins carry AFK and Thieving with the values in
  **Goal**; a version 4 file migrates to 5 with timers filled, not renamed aside;
  `refreshTimers` re-adopts a hand-edited built-in and leaves an added server
  alone; the add path gives a new server the pair.
- **`appState.ts`**: the `timers` block round-trips; a missing block reads as
  empty; one bad custom beside a good one keeps the good one.

**Manual**, in `npm run dev` (back up `state.json` first, per `CLAUDE.md`):

1. Add a Timers pane. Set AFK to 20s with threshold 10s. Click the game: it runs.
   Put another app in front. At 0:10 a silent banner appears and the alert sound
   plays at the set volume; clicking the banner brings the window forward.
2. With the window focused, the same alert plays the sound and shows no banner.
3. Switch worlds: AFK goes back to idle and starts again at the first click.
4. Pause AFK, click the game: it stays paused.
5. Add a timer with a 5s threshold; it alerts at 0:05 and keeps counting.
6. Close the Timers pane while a countdown runs; it still alerts.
7. Test at 0%, 50% and 100% volume and hear the difference.

`npm run capture` gains a `timers` shot of the pane with a running, an alerted
and an idle clock, taken under `caffeinate -d` with its hash compared to the
previous frame.

## Build order

1. **Spike, throwaway — done 2026-09-14.** With `com.apple.sound.beep.sound` unset,
   CoreAudio's `AudioServices` falls back to `/System/Library/Sounds/Tink.aiff`
   (the string sits beside the key in the dyld shared cache on macOS 14.7.1); the
   file is uncompressed 24-bit stereo 48 kHz AIFF. A throwaway Electron 44 script
   with a preload-less `WebContentsView` saw `input-event` report `mouseMove`,
   `mouseDown`, `mouseUp`, `rawKeyDown`, `char` and `keyUp` for events sent with
   `sendInputEvent`, and `Notification.isSupported()` was true.
2. `shared/timers.ts` and `main/timers/defs.ts`, with tests.
3. `main/timers/runner.ts`, with tests.
4. `main/timers/sound.ts`, fixtures, `make-chime.mjs` and `chime.wav`, with tests.
5. Catalog version 5 and `refreshTimers`; the `appState` block; with tests.
6. Main wiring: the definition store and sound in `index`, the runner, input,
   `gameGone`, banner and alert in `serverWindow`, IPC and preload.
7. `Timers.tsx`, the shell's alert player, `TOOL_IDS` and `TOOL_NAMES`.
8. README section, capture shot, manual checks.

## Rejected

- **Clocks in the renderer.** Chromium throttles timers in a hidden page, heavily
  after five minutes, so a five-minute thieving countdown in a kit left behind
  another app could alert up to a minute late. That is the exact moment it exists
  for. The renderer also cannot be tested here.
- **The OS notification's own sound.** Its volume is the system's, not the kit's,
  and the brief asks for a volume control.
- **Surviving a restart.** The earlier spec persisted absolute end times. A restart
  ends the login, which makes a saved AFK clock meaningless, and nothing asked for
  it for the others.
- **Mouse movement as AFK input.** The client counts it; the owner chose AFK mode
  as on/off over clicks and keys. Without movement, the countdown restarts less
  often than the client's idle timer does, which can make it warn early. It is not
  the only difference: the kit counts clicks and keys anywhere in the game view,
  and the client only those on its canvas, which can make it warn late (see
  **AFK mode and the game view**).
- **Per-input checkboxes, per-server custom clocks, separate Countdowns and Timers
  tools.** Each was offered and declined. Kind is a field, not a tool.
- **Reading input through a preload on the game page.** The game view has no
  preload by design, and `input-event` sees what is needed from main.

## Out of scope

- A read-out of a clock in the tab bar or window title.
- Global or in-game hotkeys for Start and Reset.
- An always-on-top overlay window.
- Repeating alerts, or a second alert at zero.
- Counting only input on the game's canvas for AFK mode.
