# Custom Themes and Pictures Implementation Plan

> **For agentic workers:** executed inline, task by task, in the session that wrote it. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Custom themes (every colour editable, saved and opened as `.zktheme` files) and pictures shown through the whole frame, in one PR.

**Architecture:** Pure rules in `shared/themes.ts`, `main/pictures.ts` (type sniffing and a content-named store over a folder), `main/themeFile.ts` (read and write), `main/appState.ts` (customs in the appearance block). Main serves pictures on a private `zanaris-bg:` scheme and owns every dialog. The renderer applies a look (colours plus picture) and hosts the editor.

**Tech Stack:** Electron 44 (`protocol.handle`, `registerSchemesAsPrivileged`), React 19, Tailwind 4.3, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-25-custom-themes-and-pictures-design.md`

## Global Constraints

- These carry over from the themes plan:
  - Code `node --test` reaches uses erasable TypeScript only, with `.ts` imports.
  - No colour literals in the renderer.
  - Comments are load-bearing.
  - IPC channels are shaped `zanaris:<area>-<verb>`.
- Every handler added here accepts only `settings.isSender`. The page never sends a path.
- The CSP adds `img-src 'self' zanaris-bg:`, and not `data:`: see spec Decision 7.
- Limits: 32 custom themes, names of 40 characters, 10 MB pictures, 16 MB theme files, `show` of at most 0.6.

---

### Task 1: `themes.ts` — backgrounds, customs, contrast, looks

- [ ] **Tests first** (`themes.test.ts`):
  - `readColors`: lower-cases; a missing token takes stone's; a bad value gives null; extra keys are ignored.
  - `readCustomTheme`: bad id, name or colours give null; a bad background gives `background: null`.
  - `themeFor`, `isThemeId` and `serverOverride` with customs.
  - `contrastWarnings`: `[]` for every built-in; a theme with `dim === well` names "dim on well".
  - `themeVars` with a picture: surfaces become `rgb(... / 0.6)` at `show` 0.4, the picture variables are present, and edges and text stay hex. With `show` 0, or no picture, it is unchanged.
  - `pictureUrl`.
  - `newCustomId` avoids ids already taken.
  - `uniqueName` adds " (2)" and " (3)".
- [ ] Implement. `Theme.background` is null on the built-ins. Signature changes: `themeById(id, custom = [])`, `isThemeId(x, custom = [])`, `themeVars({ colors, background })`. Move the contrast floors out of the test into `contrastWarnings`, and have the test call it.
- [ ] Fix every caller for the new `themeVars` and `Theme` shapes: `Appearance.tsx`, `theme.ts`, `appearance.ts`, `menu.ts`, `serverWindow.ts`. Run `npm test` and `npm run typecheck`, then commit.

**Produces:** `Background`, `Fit`, `FITS`, `SHOW_MAX`, `CUSTOM_MAX`, `THEME_NAME_MAX`, `PICTURE_NAME`, `readColors`, `readBackground`, `readCustomTheme`, `contrastWarnings`, `pictureUrl`, `newCustomId(taken, random)`, `uniqueName(name, taken)`, `ThemeLook = { colors, background }`.

### Task 2: `pictures.ts` — sniffing and the store

- [ ] **Tests first** (`pictures.test.ts`):
  - `pictureType` for PNG, JPEG, WebP, GIF87a and GIF89a; null for SVG, text and too few bytes.
  - `PictureStore` over a temporary folder:
    - `add` names the file by sha-256 and extension, and refuses over 10 MB or an unknown type;
    - adding the same bytes twice keeps one file;
    - `path` refuses `../x`, an upper-case hash and a name that is not a hash;
    - `prune(keep)` removes only unnamed files, and leaves foreign files alone.
- [ ] Implement, then commit.

**Produces:** `pictureType(bytes): PictureExt | null`, `PICTURE_MAX`, `MIME`, `PictureStore { add(bytes): { picture } | { error }, path(name): string | null, read(name): Buffer | null, prune(keep: Set<string>): void }`.

### Task 3: `themeFile.ts`

- [ ] **Tests first** (`themeFile.test.ts`):
  - A round trip without a picture, and one with picture bytes.
  - Refusals, one sentence each: not JSON, missing version, version 2 (the "newer" sentence), a bad name, a bad colour, bad base64, a picture that is not an image, and one that is too big.
  - A missing token is filled from stone.
- [ ] Implement, then commit.

**Produces:** `THEME_FILE_MAX`, `readThemeFile(text): { ok: true, name, colors, background: { bytes, fit, show } | null } | { ok: false, error }`, `writeThemeFile(theme, bytes | null): string`, `themeFileName(name)`.

### Task 4: `AppState` customs

- [ ] **Tests first**:
  - Customs round-trip.
  - A bad custom costs only itself.
  - The app theme and a server that name a dropped custom fall back.
  - `saveCustomTheme` replaces by id, appends, and refuses the 33rd.
  - `deleteCustomTheme` clears the app theme and overrides that named it.
  - `appearance()` copies are deep enough that changing one leaves the stored state alone.
- [ ] Implement, then commit.

### Task 5: `appearanceView` with customs and backgrounds

- [ ] **Tests first:** customs come after the built-ins with `custom: true`, their backgrounds are carried, and an app theme naming a custom resolves to it.
- [ ] Implement, then commit.

### Task 6: Main — the scheme, handlers, pruning, the menu

- [ ] Register `zanaris-bg` before ready. Handle it after ready through `PictureStore.read`, and prune at launch.
- [ ] Add the handlers, in the spec's shapes: save, delete (native confirm), choose picture, import and export. `appearanceTheme` and `appearanceServer` accept customs.
- [ ] `ShellState.theme` becomes a look. The shapes change in `ipc.ts` and the preload.
- [ ] The menu lists customs, with `&` doubled off macOS.
- [ ] Run typecheck and build, then commit.

### Task 7: Renderer — the look, the cards, the editor

- [ ] `index.html` gets its `img-src`. `styles.css` `body` paints the picture variables. `theme.ts` applies a look.
- [ ] `Appearance.tsx`: custom cards with their picture, Customise and Edit, Import theme….
- [ ] `ThemeEditor.tsx`, as the spec describes.
- [ ] Run typecheck, build and the literal scan, then commit.

### Task 8: Capture, docs, verification

- [ ] The capture pass, as in the spec.
- [ ] Update the README and CLAUDE.md.
- [ ] Run `npm test`, typecheck and build, then `caffeinate -d npm run capture` and open the PNGs.
- [ ] Get an independent review, fix what it finds, and open the PR as Zanaris274.
