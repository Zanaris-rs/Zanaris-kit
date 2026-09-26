# The grain goes, and the kit ships pictures — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the stone's grain, and let a theme's picture be one of twelve of the game's own pictures, picked in the theme editor.

**Architecture:** The grain is deleted from `styles.css`, the renderer and `themeVars`. The presets are files in `static/pictures/`, made from the 274 content pin by an Electron script that reads the kit's own list (`src/main/presets.ts`). Picking one sends an id; main looks it up, reads the file and stores it through `PictureStore.add`, so a theme only ever names a stored picture. Thumbnails come from a `preset` host on the existing `zanaris-bg:` scheme.

**Tech Stack:** Electron 44 (Node 24.19, which strips types on import), React 19, Tailwind 4, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-26-kit-pictures-design.md`

## Global Constraints

- Every colour the renderer paints is a `--color-*` token; no literal colour in `src/renderer` (`themes.test.ts`).
- Every image the renderer draws is a file or a `zanaris-bg:` URL; never `data:` (`csp.test.ts`).
- The page never sends a path. A preset is asked for by id, looked up in `PRESETS`, never joined into a path.
- `zanaris-bg:` is handled on the default session only.
- Comments are load-bearing: fix every comment the change makes untrue, in any file.
- IPC channels are `zanaris:<area>-<verb>`: the new one is `zanaris:appearance-preset-picture`.
- Modules the make script imports use `.ts` extensions in their own imports (Node's type stripping needs them).

---

### Task 1: The grain goes

**Files:**
- Delete: `src/renderer/grain/fine.svg`, `src/renderer/grain/blotch.svg`
- Modify: `src/renderer/styles.css` (header, grain block, text-shadow note, six surfaces)
- Modify: `src/renderer/tools/Hiscores.tsx:44-53`
- Modify: `src/shared/themes.ts` (`deriveTheme` doc, `themeVars`)
- Modify: `src/shared/themes.test.ts:169,182-183,191`
- Modify: `src/shared/csp.test.ts:45` comment
- Modify: `README.md` ("How it looks", themes and picture paragraphs), `CLAUDE.md` (colours section)

- [ ] **Step 1: Tests first.** In `themes.test.ts`, delete the three `--grain` assertions and the comment above the second. Add, in the first themeVars test: `assert.equal(vars['--grain'], undefined);` so a grain cannot creep back in through the vars.
- [ ] **Step 2: Run** `node --test src/shared/themes.test.ts` — expect FAIL (`'initial' !== undefined`).
- [ ] **Step 3: themeVars.** Delete its last three comment lines and `vars['--grain'] = background ? 'none' : 'initial';`.
- [ ] **Step 4: deriveTheme doc.** Replace "Lightness stays stone's, token by token. That keeps the grain's compensation true — each base sits below its sampled mid by what the overlay blend adds back — and keeps contrast close to stone's by construction; `themes.test.ts` is what holds it." with "Lightness stays stone's, token by token, which keeps contrast close to stone's by construction; `themes.test.ts` is what holds it."
- [ ] **Step 5: styles.css.**
  - Header: "warm olive stone with visible grain, a hard two-colour bevel" → "warm olive stone, a hard two-colour bevel".
  - Replace the whole grain block and its `:root { --stone-grain … }` rule with:
    ```css
    /*
     * The stone is flat. Its bases sit a little below the panel mid sampled off
     * the client (#504d3b–#565344), because they were set for a grain of noise
     * to lighten. The grain drew for one day, 2026-09-25, and went on the
     * owner's call: the flat stone is the look the kit had shown every day
     * before it, and these are its values.
     */
    ```
  - Text-shadow note: replace with
    ```css
    /*
     * The hard black shadow the client puts under every glyph. It is applied to
     * the surfaces themselves rather than opted into per label, so any text that
     * lands on stone gets it. Remove it and cream on #443d31 goes soft at 13px.
     */
    ```
  - Delete `background-image: var(--grain, var(--stone-grain));` and `background-blend-mode: overlay, overlay;` from `.tile`, `.sunk`, `.tab`, `.btn`, `.dock`, `::-webkit-scrollbar-thumb`.
- [ ] **Step 6: Hiscores.** `HEAD_GROUP = 'sticky top-0 bg-well'`, comment:
  ```ts
  /*
   * The header stays put while the rows scroll under it. It carries its own
   * background because a sticky row is painted over the ones passing beneath
   * it: the well's colour, on the `thead` rather than each cell, so it is one
   * band with no seam between columns.
   */
  ```
- [ ] **Step 7: Delete** `src/renderer/grain/`.
- [ ] **Step 8: csp.test.ts** comment: "which is every sprite and both layers of the grain." → "which is every sprite." Keep the header's history sentence (still true of what happened).
- [ ] **Step 9: README.** "Three things carry" → "Two things carry"; delete the "Stone has grain" bullet; the glyph bullet ends "without it cream text on the stone goes soft at small sizes."; themes paragraph "so the grain and the text's contrast behave as they do on the stone" → "so the text's contrast behaves as it does on the stone"; picture paragraph drop "The picture stands in for the stone's grain, which would only lay a grey haze over it."
- [ ] **Step 10: CLAUDE.md.** "because the black glyph shadow and the grain's overlay blend assume it" → "because the black glyph shadow assumes it"; in "Every image the renderer draws is a file", say the grain, since removed, is how the `data:` hazard was found, and "a change to the grain or a base" → "a change to a base, or to how a picture shows through the stone"; replace "Over a picture the grain is off." with "The stone is flat." (the grain drew one day and went on the owner's call; bringing a texture back is the owner's decision, not a fix).
- [ ] **Step 11: Verify** `npm test && npm run typecheck && grep -rn "grain" src README.md CLAUDE.md` — tests pass; grep shows only paneTree's "along the grain" and the historical notes written above.
- [ ] **Step 12: Commit** `fix: the stone is flat again — the grain goes`.

### Task 2: `pictureName`, the preset list, and the shipped files

**Files:**
- Modify: `src/main/pictures.ts` (add `pictureName`, `add` uses it), `src/main/pictures.test.ts`
- Create: `src/main/presets.ts`, `src/main/presets.test.ts`, `scripts/make-pictures.mjs`, `static/pictures/*` (12 files, generated)
- Modify: `package.json` (`make:pictures` script)

**Interfaces:**
- Produces: `pictureName(bytes: Uint8Array): string | null`; `PRESETS: readonly Preset[]`; `interface PresetCard { id: string; name: string; fit: Fit; picture: string }`; `readPreset(dir: string, id: unknown): Uint8Array | null`; `presetCards(dir: string): PresetCard[]`.

- [ ] **Step 1: Failing test for `pictureName`** in `pictures.test.ts`:
  ```ts
  test('pictureName is the name add keeps a picture under, and null for a type the store does not keep', () => {
      const store = new PictureStore(tempDir());
      assert.equal(pictureName(PNG), `${createHash('sha256').update(PNG).digest('hex')}.png`);
      assert.deepEqual(store.add(PNG), { picture: pictureName(PNG) });
      assert.equal(pictureName(Uint8Array.from([0x3c, 0x73, 0x76, 0x67, 0x20])), null);
  });
  ```
- [ ] **Step 2: Implement** in `pictures.ts`:
  ```ts
  /** The name `add` keeps a picture under: its sha-256 and the type its bytes say it is. Null for a type the store does not keep. */
  export function pictureName(bytes: Uint8Array): string | null {
      const type = pictureType(bytes);
      return type === null ? null : `${createHash('sha256').update(bytes).digest('hex')}.${type}`;
  }
  ```
  and in `add`, after the size check: `const picture = pictureName(bytes); if (picture === null) return { error: "That isn't a PNG, JPEG, WebP or GIF picture." };` replacing the inline hash line.
- [ ] **Step 3: `presets.ts`** — the list (spec table order), `Preset`, `PresetCard`, `readPreset`, `presetCards`:
  ```ts
  export function readPreset(dir: string, id: unknown): Uint8Array | null {
      const preset = PRESETS.find(p => p.id === id);
      if (!preset) return null;
      try {
          return readFileSync(join(dir, preset.file));
      } catch {
          return null;
      }
  }
  export function presetCards(dir: string): PresetCard[] {
      const cards: PresetCard[] = [];
      for (const preset of PRESETS) {
          const bytes = readPreset(dir, preset.id);
          const picture = bytes && pictureName(bytes);
          if (picture) cards.push({ id: preset.id, name: preset.name, fit: preset.fit, picture });
      }
      return cards;
  }
  ```
  Imports: `import type { Fit } from '../shared/themes.ts'; import { pictureName } from './pictures.ts';`.
- [ ] **Step 4: `scripts/make-pictures.mjs`** — Electron main script (no top-level await: it deadlocks an ESM entry's `ready`). For each preset: `nativeImage.createFromPath(join(content, preset.from))`, refuse `isEmpty()`, then `mirror` (BGRA copy of each row and its reverse → `createFromBitmap(..., { width: 2w, height: h }).toJPEG(90)`) or `double` (nearest-neighbour 2× → `.toPNG()`); write `static/pictures/<file>`; `app.exit(1)` on any failure, `app.quit()` otherwise. Content dir is `process.argv[2]` or `.engine-work/content`. `package.json`: `"make:pictures": "electron scripts/make-pictures.mjs"`.
- [ ] **Step 5: Run** `npm run make:pictures -- /Users/matthewgould/Projects/2004scape/swiftkit/.engine-work/content` and look at `title.jpg` and two textures.
- [ ] **Step 6: `presets.test.ts`**: static/pictures holds exactly the listed files; each file's `pictureType` matches its extension; a `PictureStore` in a temp dir accepts each under the name `presetCards` gives; ids unique and `/^[a-z]+$/`, names unique, fits in `FITS`; `readPreset` answers null for `''`, `'nope'`, `'../package.json'`, `'title.jpg'`, `'__proto__'`, `null`, `7`; `presetCards` of an empty folder is `[]`.
- [ ] **Step 7: Run** `npm test && npm run typecheck`, expect PASS.
- [ ] **Step 8: Commit** `feat: twelve of the game's own pictures, made from the content pin`.

### Task 3: Main serves and stores them

**Files:**
- Modify: `src/shared/themes.ts` (`presetUrl`), `src/shared/themes.test.ts`
- Modify: `src/main/appearance.ts` (`AppearanceView.presets`, `appearanceView` opt), `src/main/appearance.test.ts`
- Modify: `src/shared/ipc.ts` (channel, `presetPicture` in the API type), `src/preload/index.ts`
- Modify: `src/main/index.ts` (`PRESET_DIR`, cached cards, settingsState, IPC handler, protocol `preset` host)

**Interfaces:**
- Consumes: `readPreset`, `presetCards`, `PresetCard` (Task 2); `pictureType`, `MIME` (`pictures.ts`).
- Produces: `presetUrl(id: string): string` → `zanaris-bg://preset/<id>`; `AppearanceView.presets: PresetCard[]`; `window.zanaris.appearance.presetPicture(id: string): Promise<{ picture: string } | { error: string } | null>`.

- [ ] **Step 1: Tests.** themes.test: `assert.equal(presetUrl('lava'), 'zanaris-bg://preset/lava')`. appearance.test: every `appearanceView({ … catalog })` gains `presets: []`; a new test passes one card and gets an equal copy back.
- [ ] **Step 2: Implement** `presetUrl` beside `pictureUrl`; `presets` on the view (`opts.presets.map(p => ({ ...p }))`).
- [ ] **Step 3: IPC.** `appearancePresetPicture: 'zanaris:appearance-preset-picture'` after `appearanceChoosePicture`; API type doc "One of the kit's own pictures, by its id, stored as a chosen file is: its name, or why not. Null from anywhere but Settings."; preload `presetPicture: id => ipcRenderer.invoke(IPC.appearancePresetPicture, id)`.
- [ ] **Step 4: index.ts.** `const PRESET_DIR = join(__dirname, '../../static/pictures');` beside `pictures`; `let kitPictures: PresetCard[] | undefined;` and `presets: (kitPictures ??= presetCards(PRESET_DIR))` in `settingsState()`; the handler (gate `settingsWindowFor`, `readPreset` → `{ error: "That picture isn't one the kit has." }` when null, `pictures.add` in a try that logs and answers "Couldn't keep that picture: the kit's data folder couldn't be written."); the protocol handler reads `preset` as `readPreset(PRESET_DIR, name)` typed by `pictureType`, served without the `immutable` cache header (an id's file can change between releases).
- [ ] **Step 5: Verify** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 6: Commit** `feat: main stores a preset picked by id, and serves its thumbnail`.

### Task 4: The gallery

**Files:**
- Modify: `src/renderer/settings/ThemeEditor.tsx`, `src/renderer/settings/Appearance.tsx`

- [ ] **Step 1:** `Appearance` passes `presets={view.presets}` to `ThemeEditor`.
- [ ] **Step 2:** `ThemeEditor` takes `presets: readonly PresetCard[]`; a `Gallery` of six columns of `.sunk` square buttons, each with `backgroundImage: url("${presetUrl(id)}")`, `backgroundSize` `50%` for tile and `cover` otherwise, centred, `aria-pressed` and a gold border when `preset.picture === draft.background?.picture`, and its name under it in 11px `text-dim`, truncated.
- [ ] **Step 3:** `pickPreset` runs `presetPicture(preset.id)` through `run` and sets `background: { picture, fit: preset.fit, show: d.background?.show ?? FIRST_SHOW }`.
- [ ] **Step 4:** The button reads "Choose your own…"; the empty hint reads "One of the kit's, or a PNG, JPEG, WebP or GIF of your own of up to 10 MB, shown across the whole window through the stone."; the editor's doc comment mentions the gallery.
- [ ] **Step 5: Verify** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 6: Commit** `feat: the theme editor offers the kit's own pictures`.

### Task 5: Capture, docs, and looking at it

**Files:**
- Modify: `src/main/index.ts` (capture block), `README.md`, `CLAUDE.md`

- [ ] **Step 1: Capture.** The custom theme takes `readPreset(PRESET_DIR, 'title')` through `pictures.add` (fault if missing), stone's colours, named "Title screen"; after the Settings shots, the same theme is saved with Cobbles (`fit: 'tile'`) and shot as `theme-preset-tile`. The comment says so.
- [ ] **Step 2: README** picture paragraph: the gallery, the twelve, where they come from. **CLAUDE.md** Theme pictures: a bullet for presets (by id, through `PictureStore`, `preset` host on the default session, no id saved); Commands: `npm run make:pictures`.
- [ ] **Step 3: Run** `caffeinate -d npm run capture`; open `theme-custom`, `theme-preset-tile`, `settings-editor`, `settings-appearance*` and a plain stone shell shot.
- [ ] **Step 4: Commit** `test: capture wears the kit's pictures; docs for them`.
