# Themes

The owner's design of 2026-09-25. The kit's frame can wear a theme: the app
has one, and any server can be given its own. It is the first of three pieces
of theming, each with its own spec, plan and pull request:

1. **Themes** — this spec. The theme model, six built-in themes, the
   Appearance section in Settings, and a theme per server.
2. **Custom themes.** An editor in Settings and theme files to open and save.
3. **Background images.** Part of a theme's look: the deferred Milestone 3 of
   `2026-09-12-panes-and-tabs-design.md`, a picture behind empty panes.

This piece is built so the other two add to it rather than rework it.

## Context

The shell is already built for this. Nearly every colour in the renderer is a
token from the `@theme` block in `src/renderer/styles.css`, around three
hundred uses, and Tailwind v4's utilities read those tokens as `var(--color-*)`
at runtime. A few are literals instead: the red button's lit edge and the
pressed tab in `styles.css`, the sprite outline and fill in `icons.tsx`, the
nick palette in `tools/nickColour.ts`, and the `#17120d` main paints behind
the shell and page views in four places.

Three things are out of reach and stay that way. The game and the reference
pages are native `WebContentsView`s the shell cannot style, and nothing is
ever injected into a game page. The OS title bar, menus and dialogs are the
system's.

Every colour in the frame was sampled from the 2004 client rather than
invented (README, "How it looks"). Themes keep to that: each is sampled from
the game's own map.

## Decisions

These were taken while designing, and override anything below that disagrees.

1. **A theme is data, applied as CSS variables.** `src/shared/themes.ts` holds
   each theme as a record of token values. Main resolves which theme a window
   wears and sends the whole palette in its state; the renderer writes each
   token onto `:root`. Rejected: a `[data-theme]` block per theme in
   `styles.css`, which would need a second mechanism for custom themes, would
   make main duplicate every colour to paint window backgrounds, and would
   leave a contrast test parsing CSS. Also rejected: main injecting a
   stylesheet with `insertCSS`, which bypasses the state push every other
   setting takes.
2. **A theme is derived from two sampled colours by one rule.** A place in the
   game gives a *ground* colour and a *trim* colour, read off the floors laid
   there; the rule turns those two into every token. No theme is a list of
   hand-picked values, so every one can be traced to the map, and piece 2's
   editor can offer "pick a ground and a trim" with the same rule behind it.
   2004 stone is the exception: it is today's values, sampled off the client,
   and the rule's reference: the rule applied to the reference colour gives it
   back exactly.
3. **Six built-in themes:** 2004 stone, Zanaris, Wilderness, Al Kharid,
   Morytania and Lumbridge. The owner chose them from a longer list; a light
   Parchment theme and holiday themes were not taken.
4. **Every theme is dark.** The hard black shadow under every glyph, the
   grain's overlay blend and the black inner shadows are the same in every
   theme, and all three assume a dark ground. Piece 2's editor inherits this.
5. **An app theme, and per-server overrides.** Settings and every server wear
   the app theme unless a server is given its own. The owner chose this over
   every server picking its own with no app-wide theme.
6. **Chosen in Settings and from View > Server Theme.** Settings gains its
   section menu, since this is its second section, as the settings spec said
   it would be. The menu item acts on the focused window's server.
7. **Live, never on restart.** A change restyles every window it touches at
   once. Nothing reloads: only the shell's variables change, so the game
   view and its login are untouched.
8. **No theme reads worse than the one the kit ships.** Contrast floors are
   2004 stone's own ratios, not a general standard stone itself falls under
   in places.

## Design

### Tokens

A theme fills `THEME_TOKENS`: the seventeen in today's `@theme` block and four
that replace literals.

| Group | Tokens |
|---|---|
| Ground | `ink`, `stone`, `tab`, `well`, `edge-dark`, and new: `tab-down` (the pressed tab, `#332d24`), `outline` (the sprite outline in `icons.tsx`, `#3a3428`), `window` (what main paints before a view does, `#17120d`) |
| Trim | `stone-lit`, `edge-lit` |
| Text | `cream`, `dim`, `faint` |
| Signal | `gold`, `link`, `good`, `warn`, `red`, `red-edge`, `alarm`, and new: `red-lit` (the red button's lit edge, `#c8503f`) |

`icons.tsx`'s two `#ece7dc` fills become `cream`, which they already equal.

The chat nick palette stays one fixed set — "the era's chat set" — and is not
a token. The contrast test checks it on every theme's `well`, where the chat
log sits.

The `@theme` block keeps 2004 stone's values as the fallback. A test reads it
from `styles.css` and compares it with the `stone` theme, so the two cannot
drift and the default stays unchanged pixel for pixel.

### The rule

`deriveTheme(ground, trim)` in `themes.ts`, working in OKLCH. The reference is
`#504d3b`, the client's panel mid that 2004 stone was sampled from (README).

- **How dark.** `dark = min(1, L(ground) / L(reference))`. A place darker than
  the client's stone makes every ground and trim token darker by that much;
  a lighter place never makes the frame lighter. The Wilderness, on
  near-black rock, is darkened to 0.72; Morytania's swamp, a shade darker
  than the reference, to 0.99; the rest not at all.
- **Ground tokens** start from stone's own value for that token. Its hue is
  turned by the angle from the reference's hue to the ground's, its
  lightness is multiplied by `dark`, and its chroma is scaled by
  `C(ground) / C(reference)`, capped at 4. Turning each token's hue, rather
  than replacing it, keeps the small hue differences between stone's own
  tokens, so the rule applied to the reference gives back stone exactly.
- **Trim tokens** do the same with the trim colour. The bevel's highlight and
  the open tab carry the place's second colour.
- **Text tokens** are turned by the ground's angle and keep stone's
  lightness, with their chroma scaled by the ground's but never past stone's
  own, so a grey place gets grey text and a vivid one text no more tinted
  than today's.
- **Signal tokens** are stone's, unchanged: gold headings, green links and
  the red button are the client's voice in every place.
- A colour outside sRGB loses chroma until it fits.

Keeping stone's lightness token by token is what keeps the grain's
compensation true — each base still sits below its sampled mid by what the
overlay blend adds back — and what keeps contrast close to stone's by
construction. The test is what holds it.

### The six themes

Sampled by `scripts/sample-floors.mjs` from the 274 content pin (`32019eb`).
Ground and trim are chosen from the top of each place's *lift* ranking — how
many times more of the place a floor covers than of the whole map — since by
plain count nearly every place on the mainland is mostly grass. Each theme's
comment in `themes.ts` names its squares, floors and counts.

| id | Name | Squares | Ground | Trim |
|---|---|---|---|---|
| `stone` | 2004 stone | — (the client) | today's values | today's values |
| `zanaris` | Zanaris | m49_149, m50_149, where its fairies stand | `l_brownfloor1` `#6d5b2b`, lift 15–99 | `lightgrass` `#6cac10`, lift 26 |
| `wilderness` | Wilderness | m46–52 × m55–61 | `verydarkrock` `#2e2e2e`, 27%, lift 6.3 | `lava` texture mean `#f8902e` |
| `alkharid` | Al Kharid | m51–52 × m48–50 | `desert2` `#d0c074`, 62%, lift 17 | `duel_arena` `#b79767`, lift 16 |
| `morytania` | Morytania | m53–55 × m52–54 | `swamp2` `#125841`, lift 36 | `gungywater` texture mean `#348266`, lift 26 |
| `lumbridge` | Lumbridge | m50_50 | `road` `#505050`, lift 10 | `woodenfloor` (planks) mean `#58351a` |

Zanaris in 274 is brown floors and bright grass in black void. Fairy rings,
and the blue Zanaris people remember, came after this revision.

A first derivation gave every theme at least 98% of stone's ratio on every
pair the test checks.

### Ids

Theme ids are stored in `state.json`, and in piece 2's files later. They are
never renamed once shipped, in the spirit of `TOOL_IDS`. An unknown stored id
costs only that one choice, which falls back as below.

### Sampling

`scripts/sample-floors.mjs [content-dir]` reads the content checkout the stage
script makes (`.engine-work/content`). For each place it reads every ground
tile of its squares, takes the tile's overlay where it has one and its
underlay otherwise (numbered from 1, as the client's `FloType.instances[id - 1]`),
drops the invisible floors the client never draws, and prints each floor's
count, share, lift and colour — its `colour`, or the mean of its texture's
opaque pixels. It never runs in CI: the content is not in the repository. It
stays so the provenance comments can be checked.

### State

`state.json` gains:

```ts
appearance: { theme: string; servers: Record<string, string> }
```

`readAppearance` reads it one entry at a time, as `readHiscores` does. A
theme id the kit does not know is dropped: for the app theme that means
`stone`, for a server that it follows the app. Server ids are not checked on
load, since the catalog is not loaded yet, as with the startup list.

`AppState` gains `appearance()`, `setTheme(id)` and `setServerTheme(serverId,
id | null)`, where null means follow the app. When Settings removes a server,
its override goes with it, as its startup tick already does, so a later add
reusing the id cannot inherit a theme nobody chose for it.

### Resolution

`themeFor(appearance, serverId)` in `themes.ts`: the server's override, else
the app theme, else `stone`; an unknown id is `stone`. Settings wears the app
theme. Every window of a server wears that server's theme, a second window of
it included: a window is its server.

### Settings

Settings gains a row of text tabs across its top, **Servers** and
**Appearance**, drawn as chat's are: cut into the stone, the open one lit. It
opens on Servers, as it does today.

**Appearance** holds two things.

1. **Theme.** Six swatch cards. Each is a small mockup drawn with the kit's own
   classes under that theme's variables, set inline on the card: a strip of
   tabs with one open, a raised `.tile` with a gold heading and a cream and a
   dim line, and a `.sunk` well holding three nick-coloured names. The swatch
   is the real classes, not a second drawing of the look, so it cannot drift
   from what a window shows. The chosen card has a gold border. A click sets
   the app theme.
2. **Servers.** One row per catalog server: its name, then a `<select>` styled
   as the kit's sunk field. The first option reads "Same as app (Zanaris)",
   naming the current app theme, and the six themes follow. A change sets or
   clears that server's override.

### The menu

**View > Server Theme** is a submenu of radio items: "Same as App (<app
theme>)", a separator, then the six themes, with the focused window's
server's choice checked. It sets that server's override, or clears it. It is
Server Theme and not Theme because it restyles every window of the server,
not just the one in front. It is disabled when no game window has focus,
Settings included, as Always on Top is: there is no server to act on.
`MenuWindowState` gains `serverTheme: { override: string | null } | null`,
null when no game window has focus, and the menu is rebuilt when it changes,
as it is for the pin.

### Main

- `ServerWindowDeps` gains `theme: () => Theme`, a getter main answers with
  `themeFor(appState.appearance(), server.id)`. It reads `AppState` and
  nothing else, and never calls `state()` — the recursion `windowCounts()`
  once fell into.
- `ServerWindow` gains `themeChanged()`: it pushes state and repaints the
  native grounds with the theme's `window` — `setBackgroundColor` on the
  window and its shell view, and on the page views through a new
  `paneHost.setBackground(colour)`, which also colours every page view made
  after it. The game view keeps `#000`, the game's own ground. `paneHost`
  stays free of rules: it is told a colour and reconciles.
- A window and its views are created in its theme's `window` colour, not
  `#17120d`. Settings is created in the app theme's.
- Two IPC channels, in the existing shape: `appearanceTheme`
  (`zanaris:appearance-theme`) and `appearanceServer`
  (`zanaris:appearance-server`, null to follow the app). Both are accepted
  only from Settings, through the same `settings.isSender` check the servers
  handlers use. The menu calls main directly.
- Every change goes through `AppState`, is saved, and fans out: each window
  whose theme changed gets `themeChanged()`, Settings gets its state again,
  and the menu is rebuilt.
- `ShellState` gains `theme: ThemeColors`, the resolved palette, so the shell
  never looks anything up. `SettingsState` gains `appearance:
  AppearanceView`: the app theme's id, every theme as `{ id, name, colors }`,
  and each catalog server as `{ id, name, theme: id | null }`, built by a
  pure `appearanceView()` beside `serversView`. Sending palettes rather than
  ids is what lets piece 2's themes arrive without a new shape.

### Renderer

- `themeVars(colors)` in `themes.ts` maps each token to `--color-<token>`. The
  shell applies it to `document.documentElement` on every state; Settings
  applies the app theme's the same way; each swatch applies its theme's
  inline to the card.
- `styles.css` replaces `#c8503f` with `var(--color-red-lit)` and `#332d24`
  with `var(--color-tab-down)`, and the four new tokens join `@theme` with
  stone's values.
- `icons.tsx` replaces its literals with the `outline` and `cream` tokens.

## Files

| File | Change |
|---|---|
| `src/shared/themes.ts` | **New.** Tokens, the rule, the six themes, `themeFor`, `themeVars`. |
| `src/shared/themes.test.ts` | **New.** See Verification. |
| `scripts/sample-floors.mjs` | **New.** The sampler. |
| `src/main/appearance.ts` | **New.** `appearanceView()`, pure. |
| `src/main/appearance.test.ts` | **New.** |
| `src/main/appState.ts` | The `appearance` block, its reader and setters. |
| `src/main/appState.test.ts` | Reading, setting, and clearing on removal. |
| `src/shared/ipc.ts` | Two channels; `ShellState.theme`; `SettingsState.appearance`; the preload API. |
| `src/preload/index.ts` | `appearance.setTheme`, `appearance.setServerTheme`. |
| `src/main/index.ts` | Handlers, the fan-out, the menu state, the theme getter, clearing on removal, capture's theme pass. |
| `src/main/menu.ts` | View > Server Theme. |
| `src/main/serverWindow.ts` | `theme` dep, `themeChanged()`, creation colour. |
| `src/main/paneHost.ts` | `setBackground()`. |
| `src/main/settingsView.ts` | Creation colour. |
| `src/renderer/Shell.tsx` | Applies the palette on each state. |
| `src/renderer/Settings.tsx` | Section tabs; applies the app theme. |
| `src/renderer/settings/Appearance.tsx` | **New.** Swatches and per-server selects. |
| `src/renderer/styles.css` | The four tokens; two literals replaced. |
| `src/renderer/icons.tsx` | Literals replaced. |
| `README.md` | "How it looks" gains themes and the sampling rule. |
| `CLAUDE.md` | A literal colour in the renderer is a defect; theme ids are never renamed. |

## Order

1. `themes.ts` and its test: tokens, the rule, the themes, resolution.
2. The literals out of `styles.css` and `icons.tsx`, and the no-literals test.
3. `AppState`'s block and its test.
4. `appearanceView`, the IPC shapes and the preload.
5. Main: the getter, creation colours, `themeChanged`, `setBackground`, the
   handlers, the fan-out, clearing on removal.
6. The shell applying the palette.
7. Settings' section tabs and the Appearance section.
8. View > Server Theme.
9. Capture's theme pass; README and CLAUDE.md.

## Verification

`node --test`, no Electron:

- **`themes.test.ts`.** Every theme fills every token with a `#rrggbb`, and
  ids are unique. `stone` equals the `@theme` block read from `styles.css`.
  **Contrast:** for each of `cream`, `dim`, `faint`, `gold`, `link`, `good`,
  `warn` and `alarm` on each of `ink`, `stone`, `stone-lit`, `tab` and
  `well`, and each nick colour on `well`, every theme reaches at least 90% of
  stone's own ratio. `themeFor` for an override, the app theme, an unknown id
  and a missing block. `themeVars` names every token. `deriveTheme` of the
  reference colour for both ground and trim gives back every stone token
  exactly.
- **No literal colours in the renderer.** The same file scans `src/renderer`
  for hex colours outside `nickColour.ts` and outside `styles.css`'s `@theme`
  block, with comments stripped first: a comment citing a sampled value
  describes a colour rather than using one. `#fff` and `#000` and their long
  forms are allowed: neutral black and white are the same in every theme. A
  new hardcoded colour fails CI rather than quietly ignoring the theme.
- **`appState.test.ts`.** `readAppearance` drops an unknown theme id one entry
  at a time; the setters persist; removal clears an override.
- **`appearance.test.ts`.** The view lists every theme and every catalog
  server, and an override the catalog no longer holds is not shown.

`npm run capture`, since static checks cannot see main or the renderer. After
the existing shots:

- For each theme, set it as the app theme and shoot the first window, chat
  and a tool open: `theme-<id>.png`.
- Settings on Appearance, `settings-appearance.png`, beside the `settings.png`
  capture already takes of Servers.
- One server given an override, and a window of it and a window of another
  shot one after the other: `theme-override-<id>.png`.

The shot ledger flags a shell shot byte-identical to an earlier one, so a
theme that failed to apply fails the run. The PNGs are opened, not just
counted.

## Out of scope

Custom themes and theme files (piece 2). Background images (piece 3). Light
themes, which need a shadow system of their own. Theming the game, the pages
or the system's chrome.
