# The grain goes, and the kit ships pictures of its own

Two changes, asked for together on 2026-09-26.

1. **The stone loses its grain.** The two noise layers (`src/renderer/grain/`)
   drew for the first time on 2026-09-25, when #31 got them past the CSP, and
   the owner prefers the stone without them — the flat look the kit had shown
   every day until then.
2. **A theme's picture can be one of the kit's own**, picked from a gallery
   in the theme editor, without a file of the player's.

The pictures are the game's own art, from the 274 content pin (32019eb): the
title screen, and a set of the textures the client lays on walls, roofs and
floors. Whether they look good behind the frame is judged in the app, not in
a mockup, so the set is expected to change after the owner has worn them.

## 1. The grain

Removed outright, not hidden behind a setting.

- `src/renderer/grain/` and `--stone-grain` go. `.tile`, `.sunk`, `.tab`,
  `.btn`, `.dock` and the scrollbar's thumb lose their `background-image` and `background-blend-mode`. Hiscores' sticky
  header keeps `bg-well` and loses its grain classes.
- `themeVars` stops setting `--grain`: there is nothing left for a picture to
  switch off.
- **The bases stay as they are.** They sit below the client's sampled panel
  mid (#504d3b–#565344), because they were set for a grain to lighten. Flat,
  they are what the kit showed from the day the look landed until #31, which
  is the look the owner is asking to go back to. The comment says so rather
  than claiming a grain adds anything back.
- Everything that describes a grain is rewritten: `styles.css`'s header,
  its grain block and its note on the text shadow, `deriveTheme`'s note on lightness, `themeVars`, the Hiscores
  header comment, `csp.test.ts`'s comments, README's "How it looks" (three
  load-bearing things become two, and the text shadow no longer fights a
  grain) and its themes and pictures paragraphs, and CLAUDE.md's
  "Over a picture the grain is off" and its dark-themes reason. Built-ins stay
  dark because the black glyph shadow needs a dark ground; that reason stands
  on its own.
- The CSP and `csp.test.ts`'s checks stay: the sprites and the font are still
  files the renderer names, and a `data:` image would still draw nothing.

## 2. The kit's pictures

Twelve, in this order:

| id | name | source in the content pin | fit |
|---|---|---|---|
| `title` | Title screen | `binary/title.jpg`, mirrored beside itself | Fill the window |
| `lava` | Lava | `textures/lava.png` | Tile |
| `water` | Water | `textures/water.png` | Tile |
| `swamp` | Swamp | `textures/gungywater.png` | Tile |
| `marble` | Marble | `textures/marble.png` | Tile |
| `brick` | Brick | `textures/planks.png` (the brick, whatever its name) | Tile |
| `cobbles` | Cobbles | `textures/pebblefloor.png` | Tile |
| `sandstone` | Sandstone | `textures/elfbrick.png` | Tile |
| `rock` | Rock | `textures/rockwall.png` | Tile |
| `roof` | Roof tiles | `textures/roof.png` | Tile |
| `thatch` | Thatch | `textures/thatched.png` | Tile |
| `oak` | Oak | `textures/wood2.png` | Tile |

- **The title screen** is `title.jpg` (383×503) and its mirror image side by
  side, 766×503, as the 274 client draws it: two pillars and the arch
  between them. Stored as a JPEG.
- **A texture** is 128×128 and seamless. It is stored at 2× by
  nearest-neighbour, 256×256 PNG, so it tiles at a size where brick and
  cobbles read as brick and cobbles rather than as noise, and its pixels stay
  hard.
- **Where they live:** `static/pictures/`, committed. `static/**` is already
  in what electron-builder packs, and main already finds `static/` as
  `join(__dirname, '../../static')` in dev and packaged alike.
- **Where they come from:** `scripts/make-pictures.mjs`, run under Electron
  (`npm run make:pictures`) so `nativeImage` can decode the JPEG. It reads the
  content checkout the stage script makes, and the list it makes is the kit's
  own list, imported from `src/main/presets.ts`, so the two cannot disagree.
  Never run in CI: the content checkout is not in the repository. They are
  Jagex's art, taken from the Lost City content repository's copy, as the
  launcher's item sprites already are.
- **The list** is `PRESETS` in `src/main/presets.ts`: id, name, fit, the file
  in `static/pictures/`, and what it was made from. Main is the only reader of
  it; Settings is sent what it draws.

### Picking one

- The editor's Picture section opens with the gallery: the twelve as square
  thumbnails, six to a row, each with its name under it, above
  "Choose your own…" (the button's new label) and Remove. The one the draft
  wears has a gold border, as a chosen theme card does, and `aria-pressed`.
- A click sends the preset's **id**, and nothing else, on a new channel,
  `zanaris:appearance-preset-picture`. Main answers only Settings, looks the id
  up in `PRESETS` — never a path, and an id it does not list is refused — reads
  the file from `static/pictures/`, and hands the bytes to `PictureStore.add`.
  The draft gets back an ordinary stored picture name, exactly as from a file
  of the player's.
- So nothing downstream changes: a theme names a stored picture, never a
  preset; Export writes its bytes into the theme file; Import stores them;
  pruning drops a preset picked and then cancelled like any other picture.
  No preset id is ever saved, so the set can change freely between releases.
- A preset brings its own fit — Tile for a texture, Fill the window for the
  title screen. Show through keeps whatever the draft had, or 35% on a draft
  with no picture yet, as a chosen file does. A file of the player's keeps
  the draft's fit, as it does today.
- Save still does not wear the theme. It is chosen from its card, as before.

### Showing the thumbnails

- The same scheme gains a second host: `zanaris-bg://preset/<id>` serves a
  preset's file, looked up by id in `PRESETS`, so no name from a URL reaches
  the file system. It is handled on the default session only, where the shell
  and Settings are, as `picture` is. The CSP already takes images from
  `zanaris-bg:`.
- `presetUrl(id)` sits beside `pictureUrl` in `shared/themes.ts`.
- The gallery marks the draft's preset by comparing stored names. Main sends
  each preset with the name `PictureStore.add` will give it — its sha-256 and
  type, computed once from the file by `pictureName`, which `add` now uses
  too — in `AppearanceView.presets`.

## Testing

- `src/main/presets.test.ts`: every preset has a file in `static/pictures/`
  whose bytes are the type its name says; `PictureStore.add` accepts each one
  in a temporary folder, under the name `presetCards` sends; ids and names are
  unique and ids are URL-safe; an unknown id, and one shaped like a path,
  reads nothing.
- `pictures.test.ts`: `pictureName` is the name `add` gives, and null for a
  type the store does not keep.
- `themes.test.ts` loses `--grain`, and checks `presetUrl`.
- `appearance.test.ts`: the view carries the presets it is given.
- `npm run capture`: its custom theme wears the Title screen through the same
  path the IPC takes, in place of the dusk sky it drew by hand, and a second
  shot wears Cobbles, tiled. The editor shot shows the gallery with Title
  screen marked. The PNGs are opened, not just the log read.
