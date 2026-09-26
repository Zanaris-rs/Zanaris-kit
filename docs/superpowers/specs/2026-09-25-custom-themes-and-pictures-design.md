# Custom themes and pictures

The owner's design of 2026-09-25: pieces 2 and 3 of theming, together in one
pull request. Piece 1, `2026-09-25-themes-design.md` (PR #26), built the theme
model, six built-in themes, the Appearance section and per-server themes.
This adds:

- **Custom themes.** An editor in Settings, where every colour can be
  changed, and theme files to save and open.
- **Pictures.** A theme can carry a picture, shown across the whole frame.

The owner answered four questions, chose an approach, approved the first
design section, and asked for the rest to be decided and built. The
sections after the first are that.

## Decisions

These were taken while designing, and override anything below that disagrees.

1. **The picture spans the whole frame.** One picture across the window:
   behind the tab bar, the pane headers and every pane the shell draws. The
   game and the pages are native views and cover their own rects. The
   owner chose this over empty panes only, and over empty and tool panes.
2. **Every colour is editable.** All 21 tokens, one by one, starting from any
   theme. The editor warns when a pair reads worse than 2004 stone's floors,
   and saving is still the owner's call. The owner chose this over ground
   and trim through the rule.
3. **Windows change on Save.** The editor has its own live preview. Windows
   wearing the theme restyle when Save is pressed, and Cancel changes
   nothing.
   *Replaced on 2026-09-26: every window wears the draft while the editor is open, and the preview is gone — see 2026-09-26-live-themes-padding-and-setups-design.md.*
4. **Pictures reach the page through a private scheme.** The approach is
   `zanaris-bg:`, served only from the kit's own picture folder, and only to
   the kit's own pages. The owner chose it over `data:` URLs sent over IPC.
5. **A picture shows through the stone rather than replacing it.** Surfaces
   turn partly see-through over it; edges and text stay solid. How much
   shows is the theme's to say, up to 60%.
6. **Custom themes live in `state.json`.** A theme file is for sharing, not
   for storage.
7. **The grain stays as it is.** Measuring for this work found that the
   stone grain has never rendered. The CSP (`default-src 'self'`) refuses
   the `data:` SVGs it is drawn from, and a stone capture's tab bar is one
   colour across 80,000 pixels. This change adds `zanaris-bg:` to `img-src`
   and deliberately not `data:`, which would switch the grain on and change
   every surface in every theme. That is its own decision, filed separately.

## Design

### The model

`Theme` becomes `{ id, name, colors, background: Background | null }`, where
`Background` is `{ picture, fit, show }`:

- `picture` names a stored file by its content: 64 hex digits of sha-256
  and an extension, for example `3f9a….png`.
- `fit` is `'cover' | 'contain' | 'tile'`.
- `show` is how much of the picture shows through the stone, from 0 to 0.6.

The six built-ins have no background.

`Appearance` becomes `{ theme, servers, custom }`, where `custom` holds the
custom themes:

- **Ids.** A custom id is `custom-` and 8 hex digits, so it can never be a
  built-in's.
- **Limits.** At most 32 custom themes. A name is 1–40 characters after
  trimming, and a name another theme already has gets " (2)", " (3)" and
  so on.
- **Reading.** `readAppearance` reads the customs first, one at a time. A
  bad id, name or colour costs only that theme, and a bad background costs
  only the background. It then checks `theme` and `servers` against
  built-ins plus customs.

**Colours.** `readColors` accepts `#rrggbb` in either case and stores it
lower case. A token that is missing takes stone's value, so a file written
before a token existed still reads. A token with a bad value refuses the
theme. Keys the kit does not know are ignored.

**Resolution** is still one pure function. `themeFor(appearance, serverId)`
searches built-ins and customs, and anything it does not know is stone.
`isThemeId` and `themeById` take the custom list as an optional argument, so
existing callers keep working. A custom theme can be chosen anywhere a
built-in can: as the app theme, as a server's own, and from View > Server
Theme.

**Built-ins cannot be edited.** Customise on any theme opens the editor on a
copy named "<name> (copy)". Edit, on a custom theme, opens that theme.

**Deleting** a custom theme asks first, in a native dialog on Settings that
names what wears it. After it goes:

- The app falls back to stone if it wore the theme.
- Each server that wore it follows the app again.
- Its picture is deleted if no other custom theme uses it.

**Contrast.** `contrastWarnings(colors)` in `themes.ts` returns every pair
under its floor: the eight text tokens on the five grounds, and the six nick
colours on `well`, each held to 90% of 2004 stone's own ratio. Each warning
is a sentence naming the pair and both ratios. It is the check the piece-1
test made, moved where the editor can reach it; the test now calls it. The
floors are measured on solid colours. A picture showing through can lower
contrast where no check can see it, and that is part of why `show` stops at
0.6.

### Pictures

**Storage.** A picture is stored at `<userData>/backgrounds/<sha256>.<ext>`
by `PictureStore` (`src/main/pictures.ts`). Before storing, a picture is
checked:

- by its first bytes, never its name, as PNG, JPEG, WebP or GIF (`pictureType`);
- no SVG, which can carry script;
- at most 10 MB;
- at most a 5K screen's worth of pixels (5120×2880), and no side past 8192,
  read off its header without decoding (`pictureSize`). The file limit says
  nothing about this: a single-colour PNG of 20000×20000 fits in 10 MB and
  decodes to 1.6 GB in every page that shows it.

Storing the same picture twice keeps one file, because the name is the
content. `PictureStore.path(name)` answers only for a name matching
`^[0-9a-f]{64}\.(png|jpg|webp|gif)$`, so no name can reach outside the
folder.

**Pruning.** `prune(keep)` deletes every file no custom theme names, and
never throws: one it cannot delete stays until the next prune. It runs:

- at launch, but only when `state.json` was read. One that could not be read
  was set aside holding the themes that name these pictures, and the empty
  state standing in for it names none;
- after a custom theme is saved or deleted, when a picture chosen in an
  editor that was then cancelled goes too.

A picture is only ever chosen in the editor, and the editor saves or
cancels before the list can import or delete anything. So a prune never
takes a picture an open editor is still using.

**The scheme.** `zanaris-bg` is registered privileged (`standard`, `secure`)
before ready, and handled on the default session:

- `zanaris-bg://picture/<name>` answers with the file's bytes, its image
  type, `nosniff`, and an immutable cache header.
- Anything else answers 404.
- The shell and Settings use the default session. The game views and pages
  use partitions of their own, so the scheme does not exist for them.

The CSP gains `img-src 'self' zanaris-bg:`. `pictureUrl(name)` in
`themes.ts` builds the URL, so main and the page cannot disagree about its
shape.

**The page never sends a path.** Choose picture… is a dialog in main. It
stores the picture and answers with its name, which is a hash and not a
path.

**Showing it.** `themeVars(look)` now takes a theme's `{ colors, background }`.

- With a picture and a `show` above 0:
  - The six surface tokens (`ink`, `stone`, `stone-lit`, `tab`, `well`,
    `tab-down`) become `rgb(r g b / (1 − show))`.
  - It adds `--picture` as a `url(…)`, `--picture-size` (`cover`, `contain`,
    or `auto` for tile) and `--picture-repeat`.
- Edges, text, signals and `window` stay solid.
- Without a picture it is exactly what it was.

A `.picture` class in `styles.css` paints `--picture` as an element's own
image, over its ink. It goes on the element that spans each page (the
shell's root, and Settings'), not on `body` behind it: the shell's root is
itself inked, and a picture behind it would show through one surface more
everywhere. Each surface over it is see-through by `show`, and a surface
inside another stacks with it. A list in a panel therefore shows less of the picture than the panel's
frame does, which keeps the wells, where the words are, the most solid.
Settings wears the app theme, picture and all.

### Settings

The Appearance section keeps its two parts.

**The cards.** Every theme has a card, built-ins first, then customs in the
order they were made.

- Clicking a card still makes it the app theme.
- A custom card shows its picture behind the mock, see-through as the
  theme sets it.
- Under each card is a small text button: Customise on a built-in, Edit on a
  custom. It is a sibling of the card, not inside it, since a button cannot
  hold a button.
- Import theme… sits under the grid.

**The editor** takes the section's place while it is open:

- **Name.**
- **Preview.** A mock frame drawn with the real classes under the draft's
  variables and picture: a tab strip, a pane header, a panel with a gold
  heading and cream, dim and faint text, a well with nick-coloured names and
  a link, a quiet button and a red one. It follows every change as it is
  made.
- **Warnings.** `contrastWarnings` of the draft, in the warn colour, when
  there are any.
- **Colours.** Grouped as Surfaces, Edges, Text and Signals. Each has a
  plain-words label ("Well: lists and fields"), a colour well and a hex field.
  The hex field applies only once it holds a whole `#rrggbb`.
- **Picture.** Choose picture… and Remove; the fit ("Fill the window", "Fit
  inside", "Tile"); and a Show through slider from 0 to 60%.
- **Actions.** Save (the one gold button) and Cancel. For a theme already
  saved, also Export… and Delete.

Save sends the draft to main, which reads it through the same checks a
stored theme gets. For a new theme it gives an id and a unique name. It
stores the theme, prunes pictures and restyles every window. Save does not
change what anything wears: a new theme is chosen from its card like any
other.

### Theme files

A theme file is `<name>.zktheme`, one JSON object:

```json
{
  "zanarisKitTheme": 1,
  "name": "Zanaris at night",
  "colors": { "ink": "#…", "stone": "#…", "…": "…" },
  "background": { "type": "png", "fit": "cover", "show": 0.35, "data": "<base64>" }
}
```

`background` may be null. A file never carries anything but the look: no
server, no layout, no id.

`readThemeFile` (`src/main/themeFile.ts`, pure) refuses:

- anything that is not JSON;
- a version other than 1, with its own sentence for a newer one ("made by a
  newer Zanaris Kit");
- a name or colours that fail the checks above;
- a picture that is not valid base64, not one of the four types by its bytes,
  or over 10 MB.

A file over 16 MB is refused before it is read, and one nested deeper than a
theme ever is before it is parsed: `JSON.parse` spends seconds on 16 MB of
brackets, on the main thread.

**Import** is a dialog in main from Settings. It stores the picture, gives
the theme a new id and a unique name, and refuses past 32 themes. It never
replaces an existing theme.

**Export** is a save dialog in main that writes the file with the picture
inline.

### Main

- **IPC**, all accepted only from Settings (`settings.isSender`):
  - `appearanceSaveCustom` (draft) answers `{ id }` or a refusal.
  - `appearanceDeleteCustom` (id) asks, and answers whether the theme went.
  - `appearanceChoosePicture` answers a picture name, a refusal or null.
  - `appearanceImportTheme` answers the new theme's name, a refusal or null.
  - `appearanceExportTheme` (id) answers null or a refusal.
  - `appearanceTheme` and `appearanceServer` accept custom ids now.
- **`AppState`** gains `saveCustomTheme(theme)`, which replaces by id or
  appends up to 32, and `deleteCustomTheme(id)`, which also clears the app
  theme and any server that wore it. `appearance()` hands out copies,
  customs included.
- **`ShellState.theme`** becomes `{ colors, background }`. `AppearanceView`
  lists every theme with `custom: boolean` and its background.
- **View > Server Theme** lists the customs after the built-ins, behind a
  separator, by their own names. Its items are checkboxes, exactly one ticked:
  Electron ticks the first item of any radio group with none ticked as a menu
  opens, and the separators make groups. Built-in names are title-cased as before.
  On Windows and Linux an `&` is doubled so it is not read as a mnemonic.

### Capture

After the theme pass, capture:

1. Builds a picture in code (`nativeImage.createFromBitmap`) and stores it
   through `PictureStore`.
2. Saves a custom theme wearing it at 40%, and makes it the app theme.
3. Shoots the first window (`theme-custom`), Settings' Appearance
   (`settings-appearance-custom`) and the editor on it
   (`settings-editor`), opened by clicking Edit and read back.
4. Deletes the theme and prunes.

## Files

| File | Change |
|---|---|
| `src/shared/themes.ts` | Backgrounds, customs in resolution, `readColors`, `readCustomTheme`, `contrastWarnings`, `themeVars(look)`, `pictureUrl`, `newCustomId`, `uniqueName` |
| `src/main/pictures.ts` | **New.** `pictureType`, `PictureStore` |
| `src/main/themeFile.ts` | **New.** `readThemeFile`, `writeThemeFile` |
| `src/main/appState.ts` | Customs in the appearance block |
| `src/main/appearance.ts` | Customs and backgrounds in the view |
| `src/main/index.ts` | The scheme, the handlers, pruning, capture |
| `src/main/menu.ts` | Customs in Server Theme |
| `src/main/serverWindow.ts` | `ShellState.theme` as a look |
| `src/shared/ipc.ts`, `src/preload/index.ts` | Channels and shapes |
| `src/renderer/index.html` | `img-src` |
| `src/renderer/styles.css` | `.picture`, which the shell's root and Settings' paint the picture with |
| `src/renderer/theme.ts` | Applies a look |
| `src/renderer/settings/Appearance.tsx` | Cards for customs, Customise and Edit, Import |
| `src/renderer/settings/ThemeEditor.tsx` | **New.** The editor |
| tests | `themes`, `pictures`, `themeFile`, `appState`, `appearance` |
| `README.md`, `CLAUDE.md` | Custom themes, pictures, the scheme's rules |

## Verification

`node --test`, for everything pure:

- **Colours and customs.** Reading colours and custom themes: bad ids, names,
  colours and backgrounds, and a missing token filled from stone.
- **Resolution and contrast.** Customs in resolution; `contrastWarnings` is
  empty for every built-in and names the pair for a broken one; `themeVars`
  with and without a picture.
- **Pictures.** `pictureType` for the four types, SVG and junk; the store's
  content names, its refusal of any other name, and pruning.
- **Theme files.** A round trip with and without a picture, and every
  refusal.
- **`AppState`.** Customs round-trip; a bad custom costs only itself; a
  theme or server naming a dropped custom falls back; save, delete and the
  cap.
- **The view.** Customs are listed with their backgrounds.

`npm run capture`, with the shots opened.

## Out of scope

- Turning the grain on (Decision 7).
- Pictures from a URL: a picture comes from a file on this machine.
- Per-pane pictures.
- Sharing a theme as pasteable text.
- Light themes.
