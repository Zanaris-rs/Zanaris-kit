# Live themes, pane padding, closing and setups — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The theme editor restyles the real app as you edit, with its actions pinned and Export working on unsaved drafts. Every pane body gets the same padding. Closing a pane beside the game shrinks the window instead of growing the game. A Setups menu in the tab bar opens built-in or saved pane arrangements sized around the game.

**Architecture:** Each rule is a pure function reached by `node --test`:

- `appearance.ts`: `readEditing`, `lookFor`, `closeQuestion`
- `paneTree.ts`: `closeGivingBack`, `arrangeForGame`, `gameSizeIn`
- `windowRoom.ts`: `shrunkFrame`
- `setups.ts`: `builtInSetups`
- `layoutFile.ts`: `readSetup`

Main (`index.ts`, `serverWindow.ts`, `paneHost.ts`, `settingsView.ts`) and the renderer only act on the answers, because they have no tests.

**Tech Stack:** Electron 44, React 19, Tailwind 4, TypeScript run by `node --test` with type stripping.

**Spec:** `docs/superpowers/specs/2026-09-26-live-themes-padding-and-setups-design.md`. Read it before starting any task. Its Decisions section overrides this plan wherever the two disagree. Say so if you find a disagreement.

## Global Constraints

- **Comments are load-bearing.** A comment that describes behaviour the code does not have is a defect. Fix any comment your change makes untrue, in any file, including `CLAUDE.md` and `README.md`.
- **Colours are tokens.** No literal colour (hex, `rgb()`, `hsl()` or named) anywhere under `src/renderer`. `themes.test.ts` fails on one.
- **IPC channels** are named `zanaris:<area>-<verb>`, beside the existing ones in `src/shared/ipc.ts`.
- **`TOOL_IDS`** is append-only. Nothing here touches it.
- **Placement rules** live in `paneTree.ts` (pure), never in the shell or `serverWindow.ts`.
- **No pushes, no `gh`.** Commit locally only.
- **Commit messages** follow the repo's prose style (for example `feat: a dev run wears the kit's name and icon`). They end with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Checks after every task:** `npm test` and `npm run typecheck` both pass. The full suite takes about 3 seconds.
- **Where code is given:** paste pure code exactly as written, since it was run against the real modules before it went into this plan. For wiring code, read the lines around each edit first. If the plan's snippet disagrees with the file, trust the file, make the snippet fit, and report the difference. Don't obey a snippet that is wrong.

## File map

| File | Change |
|---|---|
| `src/main/appearance.ts` (+test) | `Editing`, `readEditing`, `lookFor`, `closeQuestion`; `appearanceView` takes `editing` |
| `src/shared/ipc.ts`, `src/preload/index.ts` | `appearanceEditing`, `exportTheme(draft)`, `tabSetupsMenu` |
| `src/main/index.ts` | the draft, the restyle, Save and Export, Settings' close hooks, `setupsDir`, capture |
| `src/main/settingsView.ts` | `closeQuestion`, `onDiscard`, `onReload` options |
| `src/main/serverWindow.ts` | `theme` as a look, the close shrink, Setups menu and opening |
| `src/main/paneHost.ts` | `close(paneId, room)`, `replaceTab(tabId, tree, size)`, `gameSize()` |
| `src/main/paneTree.ts` (+test) | `Edge`, `closeGivingBack`, `arrangeForGame`, `gameSizeIn` |
| `src/main/windowRoom.ts` (+test) | `shrunkFrame` |
| `src/main/setups.ts` (+test) | **New.** `builtInSetups` |
| `src/main/layoutFile.ts` (+test) | `writeLayout` size, `readSetup` |
| `src/renderer/Settings.tsx` | the draft lifted here, reported to main |
| `src/renderer/settings/Appearance.tsx` | card buttons, the editor opened with Settings' draft |
| `src/renderer/settings/ThemeEditor.tsx` | controlled, no preview, pinned bar, Export of the draft |
| `src/renderer/Shell.tsx` | the Setups button, the padded pane body |
| `src/renderer/tools/**`, `src/renderer/Launcher.tsx` | outer insets removed |
| `CLAUDE.md`, `README.md`, the custom-themes spec | as each task says |

---

### Task 1: The draft theme's rules

**Files:**
- Modify: `src/main/appearance.ts`
- Test: `src/main/appearance.test.ts`

**Interfaces:**
- Produces:
  - `interface Editing { look: ThemeLook; name: string; changed: boolean }`
  - `readEditing(x: unknown): Editing | null`
  - `lookFor(appearance: Appearance, serverId: string | null, editing: Editing | null): ThemeLook`
  - `closeQuestion(editing: Editing | null, quitting: boolean): { message: string; detail: string } | null`
  - `appearanceView(opts: { appearance; catalog; editing?: Editing | null })`, whose `look` is the draft's while editing.

- [ ] **Step 1: Write the failing tests.** Change the import at the top of `src/main/appearance.test.ts` to

```ts
import { appearanceView, closeQuestion, deleteQuestion, lookFor, readEditing } from './appearance.ts';
```

and append:

```ts
const draftLook = { colors: themeById('zanaris').colors, background: null };

test('a report of the theme being edited is read with its look, name and whether it changed', () => {
    assert.deepEqual(readEditing({ look: draftLook, name: 'Mine', changed: true }), { look: draftLook, name: 'Mine', changed: true });
});

test('a report with a colour or a picture that cannot be read is ignored', () => {
    assert.equal(readEditing({ look: { colors: { ...draftLook.colors, ink: 'red' }, background: null }, name: 'Mine', changed: true }), null);
    assert.equal(readEditing({ look: { colors: draftLook.colors, background: { picture: '../../etc/passwd', fit: 'cover', show: 0.3 } }, name: 'Mine', changed: true }), null);
    assert.equal(readEditing({ look: draftLook, name: 'Mine', changed: 'yes' }), null);
    assert.equal(readEditing({ look: draftLook, changed: true }), null);
    assert.equal(readEditing(null), null);
});

test('a picture that can be read is kept', () => {
    const background = { picture: `${'a'.repeat(64)}.png`, fit: 'tile' as const, show: 0.3 };
    assert.deepEqual(readEditing({ look: { colors: draftLook.colors, background }, name: 'Mine', changed: false })?.look.background, background);
});

test('a long name is cut, and an empty one reads as "this theme"', () => {
    assert.equal(readEditing({ look: draftLook, name: 'x'.repeat(100), changed: true })?.name.length, 40);
    assert.equal(readEditing({ look: draftLook, name: '   ', changed: true })?.name, 'this theme');
});

test('while a theme is being edited, every window wears it, a server with its own theme included', () => {
    const appearance = { theme: 'stone', servers: { lostcity: 'wilderness' }, custom: [] };
    const editing = { look: draftLook, name: 'Mine', changed: true };
    assert.deepEqual(lookFor(appearance, null, editing), draftLook);
    assert.deepEqual(lookFor(appearance, 'lostcity', editing), draftLook);
});

test("with nothing being edited, a window wears its own theme or the app's", () => {
    const appearance = { theme: 'zanaris', servers: { lostcity: 'wilderness' }, custom: [] };
    assert.deepEqual(lookFor(appearance, 'lostcity', null), { colors: themeById('wilderness').colors, background: null });
    assert.deepEqual(lookFor(appearance, 'other', null), { colors: themeById('zanaris').colors, background: null });
    assert.deepEqual(lookFor(appearance, null, null), { colors: themeById('zanaris').colors, background: null });
});

test('closing Settings asks only about a draft with changes, and never while quitting', () => {
    const editing = { look: draftLook, name: 'Mine', changed: true };
    assert.deepEqual(closeQuestion(editing, false), { message: 'Discard your changes to Mine?', detail: 'Every window goes back to the theme it wore before.' });
    assert.equal(closeQuestion({ ...editing, changed: false }, false), null);
    assert.equal(closeQuestion(editing, true), null);
    assert.equal(closeQuestion(null, false), null);
});

test('while a theme is being edited, Settings wears it, and the app theme is still named', () => {
    const view = appearanceView({ appearance: { theme: 'zanaris', servers: {}, custom: [] }, catalog, editing: { look: { colors: themeById('wilderness').colors, background: null }, name: 'Mine', changed: true } });
    assert.equal(view.theme, 'zanaris');
    assert.deepEqual(view.look, { colors: themeById('wilderness').colors, background: null });
});
```

- [ ] **Step 2: Run** `node --test src/main/appearance.test.ts`. Expected: FAIL, with the new names not exported.

- [ ] **Step 3: Implement.** In `src/main/appearance.ts`, change the themes import to

```ts
import { THEMES, THEME_NAME_MAX, readBackground, readColors, serverOverride, themeFor, type Appearance, type Theme, type ThemeLook } from '../shared/themes.ts';
```

In `appearanceView`:

- change the signature to `appearanceView(opts: { appearance: Appearance; catalog: readonly ServerDef[]; editing?: Editing | null }): AppearanceView`;
- replace `look: { colors: app.colors, background: app.background },` with `look: lookFor(opts.appearance, null, opts.editing ?? null),`.

On `AppearanceView.look`, change the doc so it says `look` is what Settings wears: the theme being edited while there is one, and otherwise the app theme's look.

Append:

```ts
/**
 * The theme being edited, as Settings reports it while its editor is open:
 * the draft's look, which every window wears until the editor closes, its name
 * for the question closing Settings asks, and whether it differs from what the
 * editor opened on.
 */
export interface Editing {
    look: ThemeLook;
    name: string;
    changed: boolean;
}

/**
 * What Settings sent, read as strictly as a draft's look is on Save — colours
 * through `readColors`, and a picture that is there but cannot be read refuses
 * the whole report rather than being dropped from it, since every window would
 * then wear a draft without the picture its editor shows. The name is only
 * ever read back in a question, so any string will do, cut to a theme name's
 * length; an empty one is "this theme". Null for anything else, which main
 * ignores.
 */
export function readEditing(x: unknown): Editing | null {
    if (typeof x !== 'object' || x === null) return null;
    const e = x as Record<string, unknown>;
    if (typeof e.look !== 'object' || e.look === null || typeof e.name !== 'string' || typeof e.changed !== 'boolean') return null;
    const look = e.look as Record<string, unknown>;
    const colors = readColors(look.colors);
    if (colors === null) return null;
    const background = look.background === null || look.background === undefined ? null : readBackground(look.background);
    if (look.background !== null && look.background !== undefined && background === null) return null;
    const name = e.name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, THEME_NAME_MAX).trim();
    return { look: { colors, background }, name: name || 'this theme', changed: e.changed };
}

/**
 * The look a window wears: the theme being edited while there is one, over
 * everything, and otherwise its server's own theme or the app's. `serverId`
 * null is Settings, which wears the app theme. Every window wears a draft,
 * whatever it would otherwise wear, so the editor's changes can be seen on the
 * window the player is looking at rather than on the one that happens to wear
 * the theme.
 */
export function lookFor(appearance: Appearance, serverId: string | null, editing: Editing | null): ThemeLook {
    if (editing) return editing.look;
    const theme = themeFor(appearance, serverId);
    return { colors: theme.colors, background: theme.background };
}

/**
 * What closing Settings asks before it goes, or null to let it close: only
 * when a draft differs from what its editor opened on, and never while the
 * app is quitting, which Settings does not hold up.
 */
export function closeQuestion(editing: Editing | null, quitting: boolean): { message: string; detail: string } | null {
    if (!editing || !editing.changed || quitting) return null;
    return { message: `Discard your changes to ${editing.name}?`, detail: 'Every window goes back to the theme it wore before.' };
}
```

If `appearanceView` no longer reads `app.colors`/`app.background`, keep `app` for `theme: app.id`.

- [ ] **Step 4: Run** `node --test src/main/appearance.test.ts`, then `npm test` and `npm run typecheck`. Expected: all pass.

- [ ] **Step 5: Commit.** `feat: the theme being edited has rules of its own — what it looks like, who wears it, what closing asks`

---

### Task 2: Every window wears the draft (main)

**Files:**
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/main/settingsView.ts`, `src/main/serverWindow.ts`, `CLAUDE.md`, `docs/superpowers/specs/2026-09-25-custom-themes-and-pictures-design.md`

**Interfaces:**
- Consumes (Task 1): `Editing`, `readEditing`, `lookFor`, `closeQuestion`, `appearanceView(opts.editing)`.
- Produces, for Task 3:
  - `window.zanaris.appearance.editing(report: Editing | null): Promise<void>`
  - `window.zanaris.appearance.exportTheme(draft: ThemeDraft): Promise<string | null>`

- [ ] **Step 1: IPC.**
  - In `src/shared/ipc.ts`, add `appearanceEditing: 'zanaris:appearance-editing',` after `appearanceExportTheme` in `IPC`, and `import type { Editing } from '../main/appearance.ts';` beside the `AppearanceView` import.
  - In `ZanarisApi.appearance`, add:

```ts
        /**
         * The theme being edited, reported on every change while the editor
         * is open and as null when it closes. Every window wears it until
         * then; nothing is kept until Save. Settings only.
         */
        editing(report: Editing | null): Promise<void>;
```

  - Change `exportTheme` to:

```ts
        /** Writes the editor's theme, saved or not, to a file the player picks. Null when written or cancelled; otherwise why not. */
        exportTheme(draft: ThemeDraft): Promise<string | null>;
```

  - In `src/preload/index.ts`'s `appearance`, add `editing: report => ipcRenderer.invoke(IPC.appearanceEditing, report),` and change `exportTheme` to `exportTheme: draft => ipcRenderer.invoke(IPC.appearanceExportTheme, draft)`.

- [ ] **Step 2: A window's theme is a look.** In `src/main/serverWindow.ts`:
  - Change `import type { Theme } from '../shared/themes';` to `import type { ThemeLook } from '../shared/themes';`.
  - Change `ServerWindowDeps.theme` to `theme: () => ThemeLook;`. Rewrite its doc so it says this is the look the window wears: the theme being edited while Settings' editor is open, otherwise its server's own or the app's (`appearance.lookFor`). A getter, because any of those can change while the window is open, and main calls `themeChanged` when one does.
  - Every use reads `.colors.window` or `.colors`/`.background`, which a look has. Run `npm run typecheck` to confirm.

- [ ] **Step 3: The draft in `index.ts`.**
  - Import `closeQuestion`, `lookFor`, `readEditing` and `type Editing` from `./appearance`, beside `appearanceView` and `deleteQuestion`.
  - Near `const pictures`, add:

```ts
/**
 * The theme open in Settings' editor, worn by every window until the editor
 * closes (`appearance.lookFor`). Held here only and never written: a draft is
 * kept by Save, and ends with Save, Cancel, Settings closing, or Settings'
 * page loading again.
 */
let editing: Editing | null = null;
```

  - In the server window deps, replace `theme: () => themeFor(appState.appearance(), spec.server.id)` with `theme: () => lookFor(appState.appearance(), spec.server.id, editing)`.
  - In `settingsState()`, pass `editing` to `appearanceView({ appearance: appState.appearance(), catalog: catalog.list(), editing })`.
  - Replace `appearanceChanged` with the three functions below, keeping its doc on `appearanceChanged`:

```ts
/** Every window, and Settings, repainted in what it now wears. */
function restyle(): void {
    for (const sw of serverWindows.values()) sw.themeChanged();
    settings.current()?.setBackground(lookFor(appState.appearance(), null, editing).colors.window);
}

function appearanceChanged(): void {
    restyle();
    pushSettings();
    installAppMenu();
}

/**
 * Ends the draft, when there is one: every window goes back to what it wears.
 * The menu is left alone, since a draft never changed what anything wears.
 */
function endEditing(): void {
    if (!editing) return;
    editing = null;
    restyle();
    pushSettings();
}
```

  - Add the handler after `IPC.appearanceServer`'s:

```ts
/**
 * The editor's draft, reported on every change while it is open and as null
 * when it closes. Every window wears it until then. The menu is not rebuilt:
 * View > Server Theme says what each server wears, which a draft never
 * changes, and a colour well reports on every step of a drag.
 */
ipcMain.handle(IPC.appearanceEditing, (event, raw: unknown) => {
    if (!settings.isSender(event.sender.id)) return;
    if (raw === null) {
        endEditing();
        return;
    }
    const next = readEditing(raw);
    if (!next) return;
    editing = next;
    restyle();
    pushSettings();
});
```

- [ ] **Step 4: Save makes it the app theme and ends the draft.** In `IPC.appearanceSaveCustom`'s handler, inside the existing `try`, after the `saveCustomTheme` line that returns `TOO_MANY_THEMES`, add `appState.setTheme(placed.id);`. After the `catch`, before `pictures.prune(...)`, add `editing = null;`. Rewrite the doc's last sentence ("Save changes what nothing wears…") to: Save makes the theme the app theme and ends the draft (Decision 2 of the 2026-09-26 spec). Every window has been wearing it, and one that flipped back the moment it was kept would read as Save undoing the work. A server with its own theme goes back to that one.

- [ ] **Step 5: Export writes the draft.** Replace the `IPC.appearanceExportTheme` handler with:

```ts
/**
 * Export…: the editor's theme as a file, its picture inline — saved or not,
 * since the file is whatever the editor holds. Read as strictly as Save
 * reads it.
 */
ipcMain.handle(IPC.appearanceExportTheme, async (event, raw: unknown): Promise<string | null> => {
    const win = settingsWindowFor(event.sender);
    if (!win) return null;
    const draft = readThemeDraft(raw);
    if (!draft) return "That theme can't be exported: its name or one of its colours isn't one the kit can keep.";
    const picture = draft.background ? pictures.read(draft.background.picture) : null;
    if (draft.background && picture === null) return 'Its picture is no longer there. Choose it again.';
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'Export theme',
        buttonLabel: 'Export',
        defaultPath: join(app.getPath('documents'), themeFileName(draft.name)),
        filters: [{ name: 'Zanaris Kit themes', extensions: [THEME_FILE_EXTENSION] }]
    });
    if (canceled || !filePath) return null;
    try {
        writeFileSync(filePath, writeThemeFile(draft, picture));
        return null;
    } catch (err) {
        log(`[main] could not write ${filePath}: ${(err as Error).message}`);
        return `Couldn't write ${basename(filePath)}.`;
    }
});
```

Check `pictures.read`'s return type against `writeThemeFile`'s `picture` parameter. The old handler passed one straight to the other.

- [ ] **Step 6: Settings' close question and reload.** In `src/main/settingsView.ts`:
  - Add `dialog` to the electron import.
  - Extend the options to `{ anchor; onClosed; background; closeQuestion: () => { message: string; detail: string } | null; onDiscard: () => void; onReload: () => void }`.
  - After `win.on('closed', opts.onClosed);`, add:

```ts
    // Asked here and decided in `appearance.closeQuestion`: a draft with
    // changes asks before it is thrown away, since every window reverts with
    // it. Prevented synchronously, as `close` must be, and closed again once
    // the answer is Discard.
    let discarded = false;
    win.on('close', event => {
        if (discarded) return;
        const question = opts.closeQuestion();
        if (!question) return;
        event.preventDefault();
        void dialog
            .showMessageBox(win, { type: 'question', buttons: ['Keep Editing', 'Discard'], defaultId: 0, cancelId: 0, message: question.message, detail: question.detail })
            .then(({ response }) => {
                if (response !== 1 || win.isDestroyed()) return;
                discarded = true;
                opts.onDiscard();
                win.close();
            });
    });
    // A page that loads again has no editor open, so a draft left behind would
    // be worn by every window with nothing on screen to end it: Vite's full
    // reload in development, or a page that crashed and came back.
    win.webContents.on('did-finish-load', opts.onReload);
```

  Then in `index.ts`, change the slot's factory to:

```ts
const settings = new SettingsWindowSlot<SettingsWindow>((anchor, onClosed) =>
    createSettingsWindow({
        anchor,
        onClosed: () => {
            onClosed();
            endEditing();
        },
        background: lookFor(appState.appearance(), null, editing).colors.window,
        closeQuestion: () => closeQuestion(editing, quitting),
        onDiscard: endEditing,
        onReload: endEditing
    })
);
```

  `onClosed()` runs first so the slot is empty, and `endEditing`'s `pushSettings` goes nowhere. The functions are hoisted declarations, so `endEditing` being defined further down the file is fine. Check the slot is declared at module scope, as it is today.

- [ ] **Step 7: Docs.**
  - In `CLAUDE.md`'s "The Settings window" section, add a paragraph: closing Settings with a draft that has changes asks first (`appearance.closeQuestion`). Quitting never asks, so it still never holds up a quit.
  - Under "Theme pictures" or "Colours are tokens", wherever it reads best, add: a draft theme is worn by every window while Settings' editor is open (`appearance.lookFor`). Main holds it in memory only. It ends on Save, Cancel, Settings closing, or Settings' page loading again. A new place a draft could outlive its editor needs `endEditing` too.
  - In `docs/superpowers/specs/2026-09-25-custom-themes-and-pictures-design.md`, append to Decision 3: `*Replaced on 2026-09-26: every window wears the draft while the editor is open, and the preview is gone — see 2026-09-26-live-themes-padding-and-setups-design.md.*`
  - Check the comments around every line you touched in `index.ts` for claims that are now untrue: "Save changes what nothing wears", "the editor has its own preview", "Windows change on Save".

- [ ] **Step 8: Verify.** `npm test` and `npm run typecheck` pass. The renderer still calls `exportTheme(initial.id ?? '')`, so typecheck fails in `ThemeEditor.tsx`. Leave that for Task 3 and commit Tasks 2 and 3 together. Otherwise, pass a draft there now, so the tree typechecks at this commit.

- [ ] **Step 9: Commit.** `feat: every window wears the theme being edited, and Save keeps it on`

---

### Task 3: The editor, controlled, pinned and without its preview (renderer)

**Files:**
- Modify: `src/renderer/Settings.tsx`, `src/renderer/settings/Appearance.tsx`, `src/renderer/settings/ThemeEditor.tsx`

**Interfaces:**
- Consumes (Task 2): `window.zanaris.appearance.editing(report)`, `exportTheme(draft)`.
- Produces: `interface ThemeEditing { initial: ThemeDraft; draft: ThemeDraft }`, exported from `Settings.tsx`.

- [ ] **Step 1: Settings holds the draft and reports it.** In `src/renderer/Settings.tsx`:
  - Add `useRef` to the React import, `import type { ThemeDraft } from '../shared/themes';` and `import type { Editing } from '../main/appearance.ts';`.
  - Above the component, add:

```tsx
/** The theme being edited and what its editor opened on. Held here rather than in the editor so a trip to Servers and back keeps it. */
export interface ThemeEditing {
    initial: ThemeDraft;
    draft: ThemeDraft;
}

/**
 * Tells main about the theme being edited, which every window wears until the
 * editor closes — one report in flight at a time, the newest waiting its turn
 * and anything between dropped. A colour well reports on every step of a drag
 * and each report restyles every window, so queueing them all would leave the
 * windows trailing the well long after it stopped.
 */
function useReportEditing(editing: ThemeEditing | null): void {
    const waiting = useRef<{ report: Editing | null } | null>(null);
    const sending = useRef(false);
    useEffect(() => {
        waiting.current = {
            report: editing
                ? {
                      look: { colors: editing.draft.colors, background: editing.draft.background },
                      name: editing.draft.name,
                      changed: JSON.stringify(editing.draft) !== JSON.stringify(editing.initial)
                  }
                : null
        };
        if (sending.current) return;
        sending.current = true;
        void (async () => {
            while (waiting.current) {
                const { report } = waiting.current;
                waiting.current = null;
                try {
                    await window.zanaris.appearance.editing(report);
                } catch {
                    // Nothing to show: the next change reports again, and closing the editor reports null.
                }
            }
            sending.current = false;
        })();
    }, [editing]);
}
```

  - In the component, add `const [editing, setEditing] = useState<ThemeEditing | null>(null);` and call `useReportEditing(editing);`. Both go above the `if (!state)` early return, since hooks come before any return.
  - Render `<Appearance view={state.appearance} editing={editing} setEditing={setEditing} />`.
  - Extend the component's doc: Settings wears `state.appearance.look`, which main makes the draft's look while the editor is open.

  At mount the report is `null`, and main ignores a null with no draft (Task 2's `endEditing` returns early). So StrictMode's double effect costs nothing.

- [ ] **Step 2: Appearance opens the editor on Settings' draft.** In `src/renderer/settings/Appearance.tsx`:
  - Import `type Dispatch, type SetStateAction` from React and `type ThemeEditing` from `'../Settings'`.
  - The component becomes `export default function Appearance({ view, editing, setEditing }: { view: AppearanceView; editing: ThemeEditing | null; setEditing: Dispatch<SetStateAction<ThemeEditing | null>> }): ReactNode` and drops its own `editing` state.
  - Replace the early return with:

```tsx
    if (editing) {
        return (
            <ThemeEditor
                initial={editing.initial}
                draft={editing.draft}
                onChange={update => setEditing(e => (e ? { ...e, draft: update(e.draft) } : e))}
                onClose={() => setEditing(null)}
            />
        );
    }
```

  - Card's `onEdit` becomes `() => { const draft = draftOf(theme); setEditing({ initial: draft, draft }); }`.
  - Replace Card's text button, the second `<button>` with the dim underlined span, with a raised button as wide as the card:

```tsx
            <button type="button" onClick={onEdit} style={EDIT_BUTTON} className="btn group w-full">
                <span className="text-cream group-hover:text-gold">{theme.custom ? 'Edit' : 'Customise'}</span>
            </button>
```

  - Add the constant beside `MINI_TAB`:

```tsx
/* Customise and Edit: a raised button the card's width, sized as Settings' other buttons are. */
const EDIT_BUTTON: CSSProperties = { fontSize: 13, padding: '1px 8px' };
```

  Change the card's gap from `gap-0.5` to `gap-1`. Update Card's doc: "the text button under it" becomes "the button under it". The component doc says "A change applies at once to every window it touches". Keep it and add that while the editor is open, every window wears the draft. Capture clicks the button whose `textContent` is exactly `Edit`, so the label must stay a lone text node in the span.

- [ ] **Step 3: The editor.** Rewrite `src/renderer/settings/ThemeEditor.tsx`:
  - **Keep as they are:** `HEX_FIELD`, `ACCENT`, `GROUPS`, `FIT_LABELS`, `FIRST_SHOW`, `ColorRow`, `BUTTON_SIZE`, and the `.btn` comment at the top.
  - **Delete:** `PREVIEW_TAB`, `PREVIEW_BUTTON`, `Preview`, and the `NICK_COLOURS`, `themeVars` and `ThemeLook` imports.
  - **The React import:** drop `type CSSProperties` only if nothing still uses it. `BUTTON_SIZE` and `ACCENT` do.
  - **The component** becomes:

```tsx
/**
 * The theme editor, in place of the Appearance section while it is open.
 *
 * The draft is Settings' own (`Settings.tsx`), so a trip to Servers and back
 * keeps it, and every window wears it while the editor is open: the changes
 * are seen on the app itself, not on a picture of it. Nothing is kept until
 * Save, which also makes it the app theme; Cancel puts every window back.
 * Every colour is the player's to set; the warnings say when a pair reads
 * worse than 2004 stone's, and saving is still their call. A picture is chosen
 * in a dialog of main's, which answers its stored name.
 *
 * The actions sit in a bar pinned under the fields, which scroll on their own,
 * so Save is never a scroll away from the colour just changed.
 */
export default function ThemeEditor({
    initial,
    draft,
    onChange: setDraft,
    onClose
}: {
    initial: ThemeDraft;
    draft: ThemeDraft;
    onChange: (update: (draft: ThemeDraft) => ThemeDraft) => void;
    onClose: () => void;
}): ReactNode {
    const [busy, setBusy] = useState(false);
    const [said, setSaid] = useState<{ text: string; alert: boolean } | null>(null);
    const nameId = useId();
    const fitId = useId();
    const showId = useId();
    const saved = initial.id !== null;
    const changed = JSON.stringify(draft) !== JSON.stringify(initial);
    const warnings = contrastWarnings(draft.colors);
```

  - **The handlers** (`setColor`, `run`, `choosePicture`, `save`, `remove`) stay as they are. `setDraft` is now the `onChange` prop, with the same functional form. `exportTheme` becomes:

```tsx
    const exportTheme = (): Promise<void> =>
        run(window.zanaris.appearance.exportTheme(draft), refused => {
            if (refused !== null) setSaid({ text: refused, alert: true });
        });
```

  - **The returned tree** is two parts: a scrolling column and a pinned bar.

```tsx
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto pb-2.5">
                {/* The h2, the Name field, the warnings, Picture and the colour
                    groups, exactly as they were, minus the Preview block and its
                    wrapper. */}
            </div>

            {/* Exactly one gold `.btn` here: Save. */}
            <div className="flex shrink-0 flex-col gap-1.5 border-t border-edge-dark px-2.5 pt-2 pb-2.5">
                {said && (
                    <p role={said.alert ? 'alert' : 'status'} className={`text-[12px] ${said.alert ? 'text-warn' : 'text-dim'}`}>
                        {said.text}
                    </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" disabled={busy} onClick={() => void save()} style={BUTTON_SIZE} className="btn">
                        Save
                    </button>
                    <QuietButton disabled={busy} onClick={onClose}>
                        Cancel
                    </QuietButton>
                    <QuietButton disabled={busy} onClick={() => void exportTheme()}>
                        Export…
                    </QuietButton>
                    {changed && <span className="text-[12px] text-faint">Unsaved changes</span>}
                    {saved && (
                        <button type="button" disabled={busy} className="group ml-auto" onClick={() => void remove()}>
                            <span className="text-[12px] text-dim underline-offset-2 group-hover:text-alarm group-hover:underline">Delete</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
```

  - **Also delete:** the old `said` paragraph above the actions, the old actions row, the "Save to export these changes." line, and the comment about the file being the theme as saved.
  - **Keep the h2 text** `Edit theme`/`New theme`. Capture reads it.

- [ ] **Step 4: Verify.** `npm run typecheck`, `npm test` and `npm run build` all pass. Then run the app with `npm run dev`. Open Settings > Appearance, click Customise on a card, and change Panels. The game window's panels change as you drag the well.
  - Cancel: the window goes back.
  - Customise again, change a colour, switch to Servers and back: the editor is still open and the window still wears the draft.
  - Close Settings: it asks "Discard your changes to … (copy)?". Keep Editing keeps it open; Discard reverts every window.
  - Save: the theme becomes the app theme, its card is selected, and the window keeps the colours.
  - Export… on an unsaved draft: it offers a save dialog.
  - Report what you saw. If you cannot run the app, say so rather than guessing.

- [ ] **Step 5: Commit** (with Task 2, if you held it). `feat: the theme editor works on the app itself, its actions pinned, and exports what it holds`

---

### Task 4: Every pane body padded alike

**Files:**
- Modify: `src/renderer/Shell.tsx` (`PaneBody`)
- Modify: `src/renderer/Launcher.tsx`
- Modify: every file under `src/renderer/tools/`, including `yourworld/`

The rule is 10px (`p-2.5`) on all four sides of every pane body the shell draws, applied once in `Shell.tsx`. Each tool stops insetting itself and spaces its top-level blocks with one `gap-2` (8px). Rows inside a well (`.sunk`) keep their own padding. That padding belongs to the well.

- [ ] **Step 1: The wrapper.** In `Shell.tsx`, change `PaneBody`'s `empty` and `tool` cases to render inside one box. Leave `game` and `page` returning null.

```tsx
function PaneBody({ pane, state }: { pane: PaneView; state: ShellState }): ReactNode {
    if (pane.content.kind === 'game' || pane.content.kind === 'page') return null;
    return (
        // Every pane the shell draws itself is inset by the same 10px on every
        // side, here and only here, so no tool can drift from another.
        <div className="flex min-h-0 flex-1 flex-col p-2.5">
            <PaneContentBody pane={pane} state={state} />
        </div>
    );
}
```

  Move the existing switch into `function PaneContentBody(...)`. Chat takes `width={pane.rect.width}`. Read `Chat.tsx`'s uses of `width` and decide whether its thresholds meant the pane's outer width. If they compare against room for content, pass `pane.rect.width - 20`, and say which you chose and why.

- [ ] **Step 2: Each tool drops its own outer inset.** For each file, the tool's outermost column gets `gap-2`. Every top-level child loses its horizontal `px-2.5`/`mx-2.5` and the outer `pt-*`/`pb-*`/`mt-*`/`mb-*` that spaced it from the pane's edge or its neighbour. Padding inside a well (`sunk … px-2 py-1`) stays. These are all the lines found on 2026-09-26:

```
Chat.tsx:40        px-2.5 pb-1.5 (status line)       Chat.tsx:257   mx-2.5 mb-1.5
Chat.tsx:406       mx-2.5 (log and users row)        Chat.tsx:437   px-2.5 pt-1
Chat.tsx:446       px-2.5 py-2 (input form)
ChatSettings.tsx:127  sunk mx-2.5 … px-2.5 py-2.5 (keep the inner px/py; drop mx)
ChatSettings.tsx:249  px-2.5 py-2 (buttons)
Worlds.tsx:89      px-2.5 pb-[7px]                   Worlds.tsx:94  sunk mx-2.5
Worlds.tsx:109     px-2.5 pt-2 pb-1.5                Worlds.tsx:128 px-2.5 pb-2
Timers.tsx:98      sunk mx-2.5                       Timers.tsx:117 px-2.5 pt-2 pb-1.5
Timers.tsx:129     px-2.5 pb-2
Hiscores.tsx:123   px-2.5 pb-[7px]                   Hiscores.tsx:140 px-2.5 pb-[5px]
Hiscores.tsx:145   sunk mx-2.5                       Hiscores.tsx:187 px-2.5 pt-2 pb-1.5
Hiscores.tsx:197   px-2.5 pb-2
YourWorld.tsx:43   px-2.5   :64 sunk mx-2.5 mt-2   :68 px-2.5 pt-2   :81 mt-2.5 … px-2.5
yourworld/Characters.tsx:166 sunk mx-2.5 mt-2.5   :197 mx-2.5 mt-2   :238 mx-2.5 mt-2
                     :262 mx-2.5 mt-1.5   :267 px-2.5 pt-1.5   :269 px-2.5 pt-2 pb-2
yourworld/Builds.tsx:105 sunk mx-2.5 mt-2.5   :113 mx-2.5 mt-1.5   :117 px-2.5 pt-1.5   :118 px-2.5 pt-1 pb-2
yourworld/Commands.tsx:35 px-2.5 pt-2.5   :61 sunk mx-2.5 mt-2 mb-2.5
yourworld/Friends.tsx:23 px-2.5 pt-2.5   :36 … px-2.5 pt-2.5
yourworld/World.tsx:51 … px-2.5 pt-2.5   :89 px-2.5 pt-2 pb-1.5   :94 px-2.5 pb-2
Launcher.tsx:94    sunk mx-2.5 … p-1                 Launcher.tsx:111 px-2.5 pt-2 pb-2
```

  Line numbers drift as you edit, so find each by its classes. Grep again afterwards: `grep -n "px-2\.5\|mx-2\.5" src/renderer/tools src/renderer/Launcher.tsx -r`. Anything left must be inside a well or a form row that isn't at the pane's edge, and you should say why it stays.

  Where a tool nests its blocks in an inner column (for example Your world's sections), the `gap-2` goes on the column whose children used to carry the spacing. Where two blocks were deliberately tighter, like a caption directly under its field, keep them inside one child so the gap applies around the pair, not between them.

  A scroll region that used to run to the pane's edge now stops 10px short. That is the point, not a regression.

- [ ] **Step 3: The Worlds latencies.** The owner's screenshot showed Worlds' latency figures (`328 ms`) touching the list's right border. After Step 2, run `caffeinate -d npm run capture` and open `captures/*worlds*` or whichever shot shows Worlds, or open it in `npm run dev`. If the figures still touch the border, find out why before moving on. The row is `px-2` inside the well, so something is wider than it should be. Fix the cause and report it.

- [ ] **Step 4: Verify.** `npm test` (includes the token check), `npm run typecheck` and `npm run build` pass. Then run `caffeinate -d npm run capture` and open every tool shot: Chat, its Settings tab, Worlds, Hiscores, Timers, Your world's sections, and an empty pane's launcher. Check:
  - the same 10px inset on all four sides;
  - nothing flush under a header;
  - nothing touching a border.

  Name the shots you opened in your report.

- [ ] **Step 5: Commit.** `fix: every pane is inset the same 10px, by the shell rather than by each tool`

---

### Task 5: Closing a pane gives its space back (pure)

**Files:**
- Modify: `src/main/paneTree.ts`, `src/main/windowRoom.ts`
- Test: `src/main/paneTree.test.ts`, `src/main/windowRoom.test.ts`

**Interfaces:**
- Produces:
  - `type Edge = 'left' | 'right' | 'top' | 'bottom'`
  - `closeGivingBack(node: PaneNode, paneId: string, size: Size, room: Size): { tree: PaneNode; shrunk: Size; edge: Edge | null }`
  - `shrunkFrame(frame: Rect, by: Size, edge: Edge): Rect`

- [ ] **Step 1: Failing tests.** Add `closeGivingBack` to `paneTree.test.ts`'s import from `./paneTree.ts`. The file already defines `game`, `chat` and `drawn` near line 380. Reuse them if their definitions match those below; otherwise define these under different names. Append:

```ts
const cgHiscores = leaf('h', { kind: 'tool', tool: 'hiscores' });
const cgWorlds = leaf('w', { kind: 'tool', tool: 'worlds' });
const cgGame = leaf('g', { kind: 'game' });
const cgChat = leaf('c', { kind: 'tool', tool: 'chat' });
const plenty = { width: 5000, height: 5000 };
const nothing = { width: 0, height: 0 };
const cgDrawn = (tree: PaneNode, size: Size, paneId: string): Size => {
    const rect = layoutTree(tree, { x: 0, y: 0, width: size.width, height: size.height }).panes.get(paneId)!;
    return { width: rect.width, height: rect.height };
};
const less = (size: Size, by: Size): Size => ({ width: size.width - by.width, height: size.height - by.height });

test('closing the column right of the game gives the window back its width, and the game keeps its own', () => {
    const size = { width: 1089, height: 567 };
    const row = split('s', 'x', [cgGame, cgHiscores], [765 / 1085, 320 / 1085]);
    const closed = closeGivingBack(row, 'h', size, plenty);
    assert.deepEqual(closed.shrunk, { width: 324, height: 0 });
    assert.equal(closed.edge, 'right');
    assert.deepEqual(cgDrawn(closed.tree, less(size, closed.shrunk), 'g'), { width: 765, height: 567 });
});

test("a column left of the game moves the window's left edge in", () => {
    const size = { width: 1089, height: 567 };
    const row = split('s', 'x', [cgHiscores, cgGame], [320 / 1085, 765 / 1085]);
    const closed = closeGivingBack(row, 'h', size, plenty);
    assert.equal(closed.edge, 'left');
    assert.deepEqual(closed.shrunk, { width: 324, height: 0 });
    assert.equal(cgDrawn(closed.tree, less(size, closed.shrunk), 'g').width, 765);
});

test('of three columns, closing the last keeps the game and the middle one at their pixels', () => {
    const size = { width: 1417, height: 600 };
    const row = split('s', 'x', [cgGame, cgHiscores, cgWorlds], [765 / 1409, 320 / 1409, 324 / 1409]);
    const before = { g: cgDrawn(row, size, 'g').width, h: cgDrawn(row, size, 'h').width, w: cgDrawn(row, size, 'w').width };
    const closed = closeGivingBack(row, 'w', size, plenty);
    assert.deepEqual(closed.shrunk, { width: before.w + 4, height: 0 });
    const to = less(size, closed.shrunk);
    assert.equal(cgDrawn(closed.tree, to, 'g').width, before.g);
    assert.equal(cgDrawn(closed.tree, to, 'h').width, before.h);
});

test('closing chat under a row holding the game gives back its height', () => {
    const size = { width: 1089, height: 803 };
    const tree = split('s1', 'y', [split('s2', 'x', [cgGame, cgHiscores], [765 / 1085, 320 / 1085]), cgChat], [567 / 799, 232 / 799]);
    const closed = closeGivingBack(tree, 'c', size, plenty);
    assert.deepEqual(closed.shrunk, { width: 0, height: 236 });
    assert.equal(closed.edge, 'bottom');
    const to = less(size, closed.shrunk);
    assert.deepEqual(cgDrawn(closed.tree, to, 'g'), { width: 765, height: 567 });
    assert.deepEqual(cgDrawn(closed.tree, to, 'h'), { width: 320, height: 567 });
});

test('closing a pane in a column beside the game changes nothing about the window', () => {
    const size = { width: 1089, height: 803 };
    const tree = split('s1', 'x', [cgGame, split('s2', 'y', [cgHiscores, cgWorlds], [0.5, 0.5])], [765 / 1085, 320 / 1085]);
    const closed = closeGivingBack(tree, 'w', size, plenty);
    assert.deepEqual(closed.shrunk, nothing);
    assert.equal(closed.edge, null);
    assert.deepEqual(closed.tree, closePane(tree, 'w'));
});

test("with no room to shrink — a maximised window — the close is closePane's own", () => {
    const size = { width: 1089, height: 567 };
    const row = split('s', 'x', [cgGame, cgHiscores], [765 / 1085, 320 / 1085]);
    const closed = closeGivingBack(row, 'h', size, nothing);
    assert.deepEqual(closed.shrunk, nothing);
    assert.equal(closed.edge, null);
    assert.deepEqual(closed.tree, closePane(row, 'h'));
});

test('with some room, the window shrinks that far and the rest is shared as closePane shares it', () => {
    const size = { width: 1417, height: 600 };
    const row = split('s', 'x', [cgGame, cgHiscores, cgWorlds], [765 / 1409, 320 / 1409, 324 / 1409]);
    const closed = closeGivingBack(row, 'w', size, { width: 100, height: 0 });
    assert.deepEqual(closed.shrunk, { width: 100, height: 0 });
    const to = less(size, closed.shrunk);
    const g = cgDrawn(closed.tree, to, 'g').width;
    const h = cgDrawn(closed.tree, to, 'h').width;
    assert.equal(g + h + 4, to.width, 'the two left tile the smaller window');
    // 228 px unpaid, shared 765:320.
    assert.ok(Math.abs(g - (765 + (228 * 765) / 1085)) <= 1, `the game takes its share of what was not given back (${g})`);
});

test("a tab with no game, and the game's own pane, close as they always did", () => {
    const size = { width: 1089, height: 567 };
    const tools = split('s', 'x', [cgChat, cgHiscores], [0.5, 0.5]);
    assert.deepEqual(closeGivingBack(tools, 'h', size, plenty).shrunk, nothing);
    const row = split('s', 'x', [cgGame, cgHiscores], [765 / 1085, 320 / 1085]);
    assert.deepEqual(closeGivingBack(row, 'g', size, plenty).shrunk, nothing);
});

test('the window shrinks no further than the panes left can be drawn at', () => {
    const size = { width: 500, height: 400 };
    const row = split('s', 'x', [cgGame, cgHiscores], [0.2, 0.8]);
    const closed = closeGivingBack(row, 'h', size, plenty);
    assert.deepEqual(closed.shrunk, { width: 380, height: 0 }, "500 less the lone game pane's floor of 120");
});

test('nested: closing beside the game in a row inside a column inside a row takes only that pane off the outer width', () => {
    const size = { width: 1417, height: 803 };
    const inner = split('s3', 'x', [cgGame, cgHiscores], [765 / 1089, 324 / 1089]);
    const column = split('s2', 'y', [inner, cgChat], [567 / 799, 232 / 799]);
    const tree = split('s1', 'x', [column, cgWorlds], [1093 / 1413, 320 / 1413]);
    const before = { g: cgDrawn(tree, size, 'g'), w: cgDrawn(tree, size, 'w'), h: cgDrawn(tree, size, 'h') };
    const closed = closeGivingBack(tree, 'h', size, plenty);
    assert.deepEqual(closed.shrunk, { width: before.h.width + 4, height: 0 });
    const to = less(size, closed.shrunk);
    assert.deepEqual(cgDrawn(closed.tree, to, 'g'), before.g);
    assert.deepEqual(cgDrawn(closed.tree, to, 'w'), before.w, 'the column on the far side keeps its pixels');
});

test('a close that collapses its split into the column around it still gives back the width', () => {
    const size = { width: 1089, height: 1003 };
    const timers = leaf('t', { kind: 'tool', tool: 'timers' });
    const tree = split('s1', 'y', [split('s2', 'x', [split('s3', 'y', [cgGame, cgChat], [567 / 799, 232 / 799]), cgHiscores], [765 / 1085, 320 / 1085]), timers], [803 / 999, 196 / 999]);
    const before = cgDrawn(tree, size, 'g');
    const closed = closeGivingBack(tree, 'h', size, plenty);
    assert.deepEqual(closed.shrunk, { width: 324, height: 0 });
    assert.equal(closed.edge, 'right');
    const to = less(size, closed.shrunk);
    assert.equal(closed.tree.kind === 'split' && closed.tree.children.length, 3, 'game, chat and timers in one column');
    assert.equal(cgDrawn(closed.tree, to, 'g').width, before.width);
    assert.ok(Math.abs(cgDrawn(closed.tree, to, 'g').height - before.height) <= 2, "and within the absorb's seam of its height");
});
```

In `windowRoom.test.ts`, import `shrunkFrame` too and append:

```ts
test('a pane closed right of the game, or below it, takes the right or bottom edge in', () => {
    const frame = { x: 100, y: 50, width: 1089, height: 839 };
    assert.deepEqual(shrunkFrame(frame, { width: 324, height: 0 }, 'right'), { x: 100, y: 50, width: 765, height: 839 });
    assert.deepEqual(shrunkFrame(frame, { width: 0, height: 236 }, 'bottom'), { x: 100, y: 50, width: 1089, height: 603 });
});

test('a pane closed left of the game, or above it, moves the left or top edge in, so the game stays put', () => {
    const frame = { x: 100, y: 50, width: 1089, height: 839 };
    assert.deepEqual(shrunkFrame(frame, { width: 324, height: 0 }, 'left'), { x: 424, y: 50, width: 765, height: 839 });
    assert.deepEqual(shrunkFrame(frame, { width: 0, height: 236 }, 'top'), { x: 100, y: 286, width: 1089, height: 603 });
});

test('a window grown by a negative amount shrinks from its right and bottom, where it is', () => {
    const frame = { x: 100, y: 50, width: 1089, height: 839 };
    assert.deepEqual(grownFrame(frame, workArea, { width: -324, height: -36 }), { x: 100, y: 50, width: 765, height: 803 });
});
```

- [ ] **Step 2: Run** `node --test src/main/paneTree.test.ts src/main/windowRoom.test.ts`. Expected: FAIL, with the new names not exported.

- [ ] **Step 3: Implement.** Append to `src/main/paneTree.ts`, after `makeRoom`'s neighbours or at the end, wherever reads naturally. It uses the private `gameSize`, `allocate` and `minimumOf` and the exported `closePane`, `layoutTree`, `paneIds` and `contentOf`.

```ts
/** A side of the window: the one that moves when a close gives space back. */
export type Edge = 'left' | 'right' | 'top' | 'bottom';

/**
 * Closes a pane and, when that would have grown the game, gives the space back
 * to the screen instead — the explicit close's counterpart to `makeRoom`.
 *
 * `closePane` hands a closed pane's share to its siblings, and when the game is
 * one of them it grows: a canvas of fixed pixels in a bigger pane is a border of
 * nothing, and the player has to drag a seam back to where it was. So along the
 * closed pane's split, the window shrinks by the pane and its seam, and every
 * pane left keeps the pixels it had. `edge` is the side of the window that moves
 * in — the closed pane's own side of the game — so the game stays where it was
 * on screen, and null when nothing shrank.
 *
 * `room` is how far the window may shrink, per axis: nothing while it is
 * maximised or full screen. The shrink stops at the tree's own floor too. What
 * the window cannot give up is shared by the closed pane's siblings in
 * proportion, exactly as `closePane` shares it, so with no room at all the
 * answer is `closePane`'s own tree.
 *
 * Only the gesture that says "close" comes here. A drop also closes a pane on
 * its way to moving it, and a drop must never resize the window, so
 * `closePane` itself stays as it is.
 *
 * The tree returned is arranged at `size` less `shrunk` (`arrangedAt`).
 */
export function closeGivingBack(node: PaneNode, paneId: string, size: Size, room: Size): { tree: PaneNode; shrunk: Size; edge: Edge | null } {
    const after = closePane(node, paneId);
    const none = { tree: after, shrunk: { width: 0, height: 0 }, edge: null };
    const parent = parentOf(node, paneId);
    const was = gameSize(node, size);
    const now = gameSize(after, size);
    if (!parent || !was || !now) return none;
    const across = parent.axis === 'x';
    if ((across ? now.width - was.width : now.height - was.height) <= 0) return none;

    const panes = layoutTree(node, { x: 0, y: 0, width: size.width, height: size.height }).panes;
    const closed = panes.get(paneId)!;
    const game = panes.get(paneIds(node).find(id => contentOf(node, id)?.kind === 'game')!)!;
    const extent = (across ? closed.width : closed.height) + SEAM;
    const floor = (across ? size.width : size.height) - minimumOf(after, parent.axis);
    const shrink = Math.max(0, Math.min(extent, across ? room.width : room.height, floor));
    if (shrink === 0) return none;

    const to = across ? { width: size.width - shrink, height: size.height } : { width: size.width, height: size.height - shrink };
    const before = across ? closed.x < game.x : closed.y < game.y;
    return {
        tree: closePane(payFrom(node, paneId, size, to), paneId),
        shrunk: { width: size.width - to.width, height: size.height - to.height },
        edge: across ? (before ? 'left' : 'right') : before ? 'top' : 'bottom'
    };
}

/** The split holding `paneId` as a direct child, or null when the pane is the whole tree or not in it. */
function parentOf(node: PaneNode, paneId: string): Extract<PaneNode, { kind: 'split' }> | null {
    if (node.kind === 'leaf') return null;
    if (node.children.some(child => child.kind === 'leaf' && child.paneId === paneId)) return node;
    for (const child of node.children) {
        const found = parentOf(child, paneId);
        if (found) return found;
    }
    return null;
}

/**
 * `node` arranged at `to` rather than `from`, with the whole difference taken
 * from the named pane: down its path, each split's child on the path gives up
 * the difference along that split's axis and every other child keeps the pixels
 * it had.
 *
 * The pane about to be closed is the one named, so its share can end up at
 * nothing or a seam's width below it — a size no pane is ever drawn at, and
 * none is, since `closePane` removes it before anything lays the tree out. What
 * closing it then hands its siblings is exactly what is left of it, which is
 * nothing when the window gave up the whole pane and its seam.
 */
function payFrom(node: PaneNode, paneId: string, from: Size, to: Size): PaneNode {
    if (node.kind === 'leaf') return node;
    const at = node.children.findIndex(child => paneIds(child).includes(paneId));
    if (at < 0) return node;
    const across = node.axis === 'x';
    const seams = SEAM * (node.children.length - 1);
    const had = allocate(
        node.fractions,
        (across ? from.width : from.height) - seams,
        node.children.map(child => minimumOf(child, node.axis))
    );
    const gross = (across ? to.width : to.height) - seams;
    const lost = (across ? from.width : from.height) - (across ? to.width : to.height);
    const sizes = had.map((px, i) => (i === at ? px - lost : px));
    const resized = (size: Size, px: number): Size => (across ? { width: px, height: size.height } : { width: size.width, height: px });
    const child = payFrom(node.children[at]!, paneId, resized(from, had[at]!), resized(to, sizes[at]!));
    return { ...node, children: node.children.map((c, i) => (i === at ? child : c)), fractions: sizes.map(px => px / gross) };
}
```

In `src/main/windowRoom.ts`, change the import to `import type { Edge, Rect, Size } from './paneTree.ts';` and append:

```ts
/**
 * `frame` less `by`, taken off at `edge`: the window giving back a closed
 * pane's room (`paneTree.closeGivingBack`). A pane that was left of the game, or
 * above it, moves the window's left or top edge in, so the game stays where it
 * was on screen; one right of it or below moves the right or bottom edge.
 */
export function shrunkFrame(frame: Rect, by: Size, edge: Edge): Rect {
    return {
        x: edge === 'left' ? frame.x + by.width : frame.x,
        y: edge === 'top' ? frame.y + by.height : frame.y,
        width: frame.width - by.width,
        height: frame.height - by.height
    };
}
```

`grownFrame`'s doc says it grows a frame. Add one sentence: a negative `by` shrinks it from the right and the bottom, where it is (`serverWindow.sizeWindow`, Task 7, relies on this).

- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: pass.

- [ ] **Step 5: Commit.** `feat: a closed pane's room can be given back to the screen, with the game kept where it was`

---

### Task 6: Closing a pane shrinks the window (main)

**Files:**
- Modify: `src/main/paneHost.ts`, `src/main/serverWindow.ts`, `CLAUDE.md`, `README.md` (the Layout section's resize rules)

**Interfaces:**
- Consumes (Task 5): `closeGivingBack`, `Edge`, `shrunkFrame`.
- Produces: `PaneHost.close(paneId: string, room: Size): { shrunk: Size; edge: Edge | null }`.

- [ ] **Step 1: The host.** In `src/main/paneHost.ts`:
  - Import `closeGivingBack` and `type Edge` from `./paneTree.ts`. Drop `closePane` from that import if nothing else in the file uses it (grep).
  - Replace `close(paneId: string): void { adopt(closePane(active(), paneId)); },` with:

```ts
        /**
         * Closes a pane, and when the game would have grown into its room,
         * gives the room back to the screen instead
         * (`paneTree.closeGivingBack`). The shrink and the edge it comes off
         * are returned for the window to act on, and the tree is fitted from
         * the size it will have once it has (`arrangedAt`), as `adoptAdded`
         * does for a pane added.
         */
        close(paneId: string, room: Size): { shrunk: Size; edge: Edge | null } {
            const size = { width: bounds.width, height: bounds.height };
            const closed = closeGivingBack(active(), paneId, size, room);
            if (closed.edge) fits.set(set.activeId, arrangedAt(closed.tree, { width: size.width - closed.shrunk.width, height: size.height - closed.shrunk.height }));
            adopt(closed.tree);
            return { shrunk: closed.shrunk, edge: closed.edge };
        },
```

  - In the `PaneHost` interface, change `close: (paneId: string) => void;` to:

```ts
    /** Closes a pane in the active tab. `room` is how far the window could shrink; what it has to shrink by, and at which edge, for the game to keep its size, is returned (`paneTree.closeGivingBack`). */
    close: (paneId: string, room: Size) => { shrunk: Size; edge: Edge | null };
```

- [ ] **Step 2: The window.** In `src/main/serverWindow.ts`:
  - Import `shrunkFrame` beside `grownFrame, roomFor`, and `type Edge` from `./paneTree`.
  - In `closePane`, replace `host.close(paneId);` with:

```ts
        const given = host.close(paneId, roomToShrink());
        if (given.edge) shrinkWindow(given.shrunk, given.edge);
```

  - Add beside `roomToGrow`/`growWindow`:

```ts
    /**
     * How far the window may shrink to give a closed pane's room back
     * (`paneTree.closeGivingBack`): as far as its tree reaches, which the
     * tree's own floor then limits, and not at all while it is maximised or
     * full screen, since it fills the screen and a resize would only take it
     * out of that.
     */
    function roomToShrink(): Size {
        if (win.isDestroyed() || win.isFullScreen() || win.isMaximized()) return { width: 0, height: 0 };
        return { width: rects.tree.width, height: rects.tree.height };
    }

    /** The window less a closed pane's room, taken off at that pane's side (`windowRoom.shrunkFrame`). Its resize lays everything out again. */
    function shrinkWindow(by: Size, edge: Edge): void {
        if (win.isDestroyed() || (by.width <= 0 && by.height <= 0)) return;
        win.setBounds(shrunkFrame(win.getBounds(), by, edge));
    }
```

  - Update `closePane`'s doc: after the game paragraph, add that a pane closed beside or below the game gives its room back to the screen, so the game keeps its size and stays where it is. Update `applyLayout`'s doc too ("The window grows for one thing only…"). It now also shrinks for a pane closed beside the game (`closeGivingBack`, through `shrinkWindow`), and Task 7 adds setups.
  - Grep `serverWindow.ts`, `paneHost.ts` and `paneTree.ts` for "never shrinks", "grows for", "grows itself" and "for nothing else". Fix every comment that is now untrue. `makeRoom` and `resetGame`'s docs say a reset does not resize the window. That stays true.

- [ ] **Step 3: `CLAUDE.md`.** In "The layout invariant", replace the last bullet's final sentence ("The window grows itself for nothing else — not Reset Game Size, not a drop — and never shrinks itself back.") with:

  > A pane **closed** beside or below the game gives its room back to the
  > screen (`closeGivingBack`): the window shrinks by the pane and its seam,
  > from that pane's side, so the game keeps its pixels and stays where it is.
  > Only the explicit close does this — a drop also closes a pane on its way
  > to moving it, and must never resize the window, so `closePane` is
  > untouched. Nothing else resizes the window — not Reset Game Size, not a
  > drop.

  In `README.md`'s Layout section, find where it says the window grows for an added pane (search "grows"). Add a sentence saying closing a pane beside or below the game shrinks the window by it, keeping the game where it is.

- [ ] **Step 4: Verify.** `npm test` and `npm run typecheck` pass. Then in `npm run dev`:
  - Add Hiscores from Add pane. The window grows.
  - Close it from its header. The window shrinks back, and the game neither moves on screen nor changes size.
  - Split the game right, move the empty pane to the game's left by dragging its header, and close it. The window's left edge moves in.
  - Close chat below the game. The window gets shorter.
  - Maximise, add a pane and close it. The window stays maximised.
  - Drag a pane onto another pane's edge. The window does not resize.

  Report what you saw.

- [ ] **Step 5: Commit.** `feat: closing a pane beside the game gives its room back to the screen`

---

### Task 7: Setups (pure)

**Files:**
- Create: `src/main/setups.ts`, `src/main/setups.test.ts`
- Modify: `src/main/paneTree.ts`, `src/main/layoutFile.ts`
- Test: `src/main/paneTree.test.ts`, `src/main/layoutFile.test.ts`

**Interfaces:**
- Produces:
  - `arrangeForGame(tree: PaneNode, saved: Size | null, want: Size | null): { tree: PaneNode; size: Size | null }`
  - `gameSizeIn(trees: readonly PaneNode[], size: Size): Size | null`
  - `type BuiltInSetupId = 'game' | 'game-chat' | 'game-chat-tools'`
  - `interface BuiltInSetup { id; name; tree: StoredNode; size: Size }`
  - `builtInSetups(opts: { tools: readonly ToolId[]; gameHeight: number }): BuiltInSetup[]`
  - `writeLayout(tree, serverId, size?: Size)`
  - `readSetup(text): { tree: StoredNode; size: Size | null } | null`, with `readLayout` kept as its tree alone.

- [ ] **Step 1: Failing tests.** Add `arrangeForGame, gameSizeIn` to `paneTree.test.ts`'s import and append (reusing Task 5's `cg*` names):

```ts
test('a setup is arranged around the game as it is now, and its other panes keep their saved pixels', () => {
    const saved = { width: 1089, height: 803 };
    const tree = split('s1', 'x', [split('s2', 'y', [cgGame, cgChat], [567 / 799, 232 / 799]), cgHiscores], [765 / 1085, 320 / 1085]);
    const arranged = arrangeForGame(tree, saved, { width: 900, height: 600 });
    assert.deepEqual(arranged.size, { width: 1224, height: 836 });
    assert.deepEqual(cgDrawn(arranged.tree, arranged.size!, 'g'), { width: 900, height: 600 });
    assert.deepEqual(cgDrawn(arranged.tree, arranged.size!, 'c'), { width: 900, height: 232 });
    assert.deepEqual(cgDrawn(arranged.tree, arranged.size!, 'h'), { width: 320, height: 836 });
});

test('a setup with no game running keeps its own game size', () => {
    const saved = { width: 1089, height: 803 };
    const tree = split('s1', 'x', [split('s2', 'y', [cgGame, cgChat], [567 / 799, 232 / 799]), cgHiscores], [765 / 1085, 320 / 1085]);
    const arranged = arrangeForGame(tree, saved, null);
    assert.deepEqual(arranged.size, saved);
    assert.deepEqual(cgDrawn(arranged.tree, saved, 'g'), { width: 765, height: 567 });
});

test('a setup with no game, or no saved size, is fitted to the tab as it is', () => {
    const tools = split('s', 'x', [cgChat, cgHiscores], [0.5, 0.5]);
    assert.deepEqual(arrangeForGame(tools, { width: 800, height: 600 }, { width: 765, height: 567 }), { tree: tools, size: null });
    const row = split('s', 'x', [cgGame, cgHiscores], [0.7, 0.3]);
    assert.deepEqual(arrangeForGame(row, null, { width: 765, height: 567 }), { tree: row, size: null });
});

test("a game smaller than a setup's floors leaves the tab at its floor", () => {
    const saved = { width: 1089, height: 567 };
    const row = split('s', 'x', [cgGame, cgHiscores], [765 / 1085, 320 / 1085]);
    const arranged = arrangeForGame(row, saved, { width: 50, height: 50 });
    assert.equal(arranged.size!.width, 1089 - 715, 'the game gives 715 of width down to 50');
    assert.equal(arranged.size!.height, 80, "the height stops at a pane's floor");
});

test('the game is found in whichever tab holds it', () => {
    const size = { width: 1089, height: 567 };
    const row = split('s', 'x', [cgGame, cgHiscores], [765 / 1085, 320 / 1085]);
    assert.deepEqual(gameSizeIn([leaf('e', { kind: 'empty' }), row], size), { width: 765, height: 567 });
    assert.equal(gameSizeIn([leaf('e', { kind: 'empty' })], size), null);
});
```

In `layoutFile.test.ts`, add `readSetup` to the import and append:

```ts
test('a setup carries the size of the tab it was saved from', () => {
    const text = writeLayout(arranged, 'lostcity', { width: 1089, height: 803 });
    assert.deepEqual(readSetup(text), { tree: storeTree(arranged), size: { width: 1089, height: 803 } });
    assert.deepEqual(readLayout(text), storeTree(arranged), 'the tree alone reads as it always did');
});

test('a file with no size reads with none', () => {
    assert.deepEqual(readSetup(writeLayout(arranged, 'lostcity')), { tree: storeTree(arranged), size: null });
});

test('a size that is there and wrong refuses the whole file', () => {
    const good = storeTree(arranged);
    for (const size of [null, 'big', { width: 0, height: 600 }, { width: 800 }, { width: 800.5, height: 600 }, { width: 800, height: 16385 }, { width: -1, height: 600 }, { width: '800', height: 600 }]) {
        assert.equal(readSetup(file(good, { size })), null, `expected size ${JSON.stringify(size)} to be refused`);
    }
});
```

Create `src/main/setups.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builtInSetups } from './setups.ts';
import { instantiateLayout, type StoredNode } from './layoutFile.ts';
import { contentOf, layoutTree, paneIds, type PaneNode } from './paneTree.ts';
import { CHAT_PREFERRED_HEIGHT, GAME_PREFERRED_HEIGHT, LOSTCITY_GAME_PREFERRED_HEIGHT } from '../shared/layout.ts';
import type { ToolId } from '../shared/ipc.ts';

/** A built-in made real, and every pane's size at the size it was made for, keyed by what the pane holds. */
function drawn(tree: StoredNode, size: { width: number; height: number }, tools: readonly ToolId[]): Record<string, { width: number; height: number }> {
    let n = 1;
    const real: PaneNode = instantiateLayout(tree, { tools, links: [], nextPane: () => `pane-${n++}`, nextSplit: () => `split-${n++}` });
    const panes = layoutTree(real, { x: 0, y: 0, ...size }).panes;
    return Object.fromEntries(
        paneIds(real).map(id => {
            const content = contentOf(real, id)!;
            const rect = panes.get(id)!;
            return [content.kind === 'tool' ? content.tool : content.kind, { width: rect.width, height: rect.height }];
        })
    );
}

const ALL: ToolId[] = ['chat', 'worlds', 'hiscores', 'timers'];

test('a server with every tool has all three built-ins, in order', () => {
    const setups = builtInSetups({ tools: ALL, gameHeight: GAME_PREFERRED_HEIGHT });
    assert.deepEqual(
        setups.map(s => [s.id, s.name]),
        [
            ['game', 'Game'],
            ['game-chat', 'Game and Chat'],
            ['game-chat-tools', 'Game, Chat and Tools']
        ]
    );
});

test('Game is the game alone at its preferred size', () => {
    const [game] = builtInSetups({ tools: ALL, gameHeight: GAME_PREFERRED_HEIGHT });
    assert.deepEqual(game!.size, { width: 765, height: GAME_PREFERRED_HEIGHT });
    assert.deepEqual(drawn(game!.tree, game!.size, ALL), { game: { width: 765, height: GAME_PREFERRED_HEIGHT } });
});

test('Game and Chat is what a new window opens with', () => {
    const setup = builtInSetups({ tools: ALL, gameHeight: GAME_PREFERRED_HEIGHT })[1]!;
    assert.deepEqual(setup.size, { width: 765, height: GAME_PREFERRED_HEIGHT + 4 + CHAT_PREFERRED_HEIGHT });
    assert.deepEqual(drawn(setup.tree, setup.size, ALL), {
        game: { width: 765, height: GAME_PREFERRED_HEIGHT },
        chat: { width: 765, height: CHAT_PREFERRED_HEIGHT }
    });
});

test("Game, Chat and Tools adds a 320px column of every other tool, in the window's order, sharing its height", () => {
    const setup = builtInSetups({ tools: ALL, gameHeight: GAME_PREFERRED_HEIGHT })[2]!;
    const height = GAME_PREFERRED_HEIGHT + 4 + CHAT_PREFERRED_HEIGHT;
    assert.deepEqual(setup.size, { width: 765 + 4 + 320, height });
    const panes = drawn(setup.tree, setup.size, ALL);
    assert.deepEqual(panes.game, { width: 765, height: GAME_PREFERRED_HEIGHT });
    assert.deepEqual(panes.chat, { width: 765, height: CHAT_PREFERRED_HEIGHT });
    assert.deepEqual(Object.keys(panes), ['game', 'chat', 'worlds', 'hiscores', 'timers']);
    for (const id of ['worlds', 'hiscores', 'timers']) assert.equal(panes[id]!.width, 320);
    const heights = ['worlds', 'hiscores', 'timers'].map(id => panes[id]!.height);
    assert.equal(heights.reduce((a, b) => a + b, 0) + 8, height, 'the column fills the height');
    assert.ok(Math.max(...heights) - Math.min(...heights) <= 1, 'evenly');
});

test('a tool the window does not offer is left out, not left empty', () => {
    const tools: ToolId[] = ['chat', 'timers', 'singleplayer'];
    const setup = builtInSetups({ tools, gameHeight: GAME_PREFERRED_HEIGHT }).find(s => s.id === 'game-chat-tools')!;
    assert.deepEqual(Object.keys(drawn(setup.tree, setup.size, tools)), ['game', 'chat', 'timers', 'singleplayer']);
});

test('one other tool is the column itself', () => {
    const tools: ToolId[] = ['chat', 'timers'];
    const setup = builtInSetups({ tools, gameHeight: GAME_PREFERRED_HEIGHT }).find(s => s.id === 'game-chat-tools')!;
    const panes = drawn(setup.tree, setup.size, tools);
    assert.deepEqual(panes.timers, { width: 320, height: setup.size.height });
});

test('a window with no tool but chat has no tools setup', () => {
    assert.deepEqual(
        builtInSetups({ tools: ['chat'], gameHeight: GAME_PREFERRED_HEIGHT }).map(s => s.id),
        ['game', 'game-chat']
    );
});

test('a window without chat has no Game and Chat, and puts its tools beside the game', () => {
    const tools: ToolId[] = ['timers'];
    const setups = builtInSetups({ tools, gameHeight: GAME_PREFERRED_HEIGHT });
    assert.deepEqual(setups.map(s => s.name), ['Game', 'Game and Tools']);
    const panes = drawn(setups[1]!.tree, setups[1]!.size, tools);
    assert.deepEqual(panes, { game: { width: 765, height: GAME_PREFERRED_HEIGHT }, timers: { width: 320, height: GAME_PREFERRED_HEIGHT } });
});

test("Lost City's built-ins are drawn for its taller game", () => {
    const setups = builtInSetups({ tools: ALL, gameHeight: LOSTCITY_GAME_PREFERRED_HEIGHT });
    for (const setup of setups) assert.equal(drawn(setup.tree, setup.size, ALL).game!.height, LOSTCITY_GAME_PREFERRED_HEIGHT, setup.id);
});
```

- [ ] **Step 2: Run** `node --test src/main/paneTree.test.ts src/main/layoutFile.test.ts src/main/setups.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `paneTree.ts`.** Append. It uses the private `gameSize`, `holdGame` and `minimumOf`.

```ts
/**
 * A setup's tree made for the game as it is now, and the size of tab that
 * holds it — what opening a setup sizes the window to.
 *
 * `saved` is the tab size the setup was made at, and `want` the game's pixels
 * now, or null when no game is running, when the setup's own game size stands.
 * The game's side of every split is moved by the difference, the same walk
 * `keepGame` makes, so every other pane keeps the pixels it was saved with and
 * the tab grows or shrinks by exactly what the game did. Raised to the tree's
 * own floor, where the other panes take up the slack.
 *
 * A null size — the setup has no game, or no size was saved with it — means the
 * tree is to be fitted to the tab as it is, by its fractions, as a setup
 * always was before sizes were saved.
 */
export function arrangeForGame(tree: PaneNode, saved: Size | null, want: Size | null): { tree: PaneNode; size: Size | null } {
    if (!saved) return { tree, size: null };
    const had = gameSize(tree, saved);
    if (!had) return { tree, size: null };
    const game = want ?? had;
    const delta = { width: game.width - had.width, height: game.height - had.height };
    const size = {
        width: Math.max(saved.width + delta.width, minimumOf(tree, 'x')),
        height: Math.max(saved.height + delta.height, minimumOf(tree, 'y'))
    };
    return { tree: holdGame(tree, saved, size, delta), size };
}

/** The game's pixels in whichever of `trees` holds it, laid out at `size`, or null when none does. */
export function gameSizeIn(trees: readonly PaneNode[], size: Size): Size | null {
    for (const tree of trees) {
        const found = gameSize(tree, size);
        if (found) return found;
    }
    return null;
}
```

- [ ] **Step 4: Implement `layoutFile.ts`.**
  - Change the import to `import { leaf, split, type PaneContent, type PaneNode, type Size } from './paneTree.ts';`.
  - Replace `writeLayout` and its doc with:

```ts
/**
 * The file's text. `server` is a note about where it was made, not a lock: a
 * layout saved on one server loads on another, and whatever that server does
 * not offer comes up empty (see `instantiateLayout`).
 *
 * `size` is the tab's own size in pixels when it was saved. It is what lets a
 * setup open with every pane at the size it was saved at and the window sized
 * around them (`paneTree.arrangeForGame`), where fractions alone would stretch
 * or squeeze everything, the game included, to whatever window it opens in.
 */
export function writeLayout(tree: PaneNode, serverId: string, size?: Size): string {
    const sized = size ? { size: { width: Math.round(size.width), height: Math.round(size.height) } } : {};
    return `${JSON.stringify({ kind: LAYOUT_KIND, version: LAYOUT_VERSION, server: serverId, ...sized, tree: storeTree(tree) }, null, 2)}\n`;
}

/** A setup's size: no side under a pixel or past any display there is. */
const SIZE_MAX = 16384;
```

  - Replace `readLayout` and its doc with:

```ts
/**
 * A layout file's tree and the size it was saved at, or null when anything at
 * all about it is wrong.
 *
 * Refused whole rather than repaired, as stored layouts always were: a half-
 * understood file is a tab that loads wrong with nothing to say about why,
 * while a refusal can say "that isn't a setup" and leave the tab as it was.
 *
 * The refusals that are not merely shape: at most one game, because the window
 * has exactly one game view and a second leaf would point at nothing; and a
 * version newer than this kit knows, because a later kit may mean something by
 * it that this one would silently get wrong. A file with no size is a layout
 * saved before sizes were, and reads with a null one; a size that is there
 * and wrong refuses the file like any other bad field.
 */
export function readSetup(text: string): { tree: StoredNode; size: Size | null } | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const file = parsed as Record<string, unknown>;
    if (file.kind !== LAYOUT_KIND || file.version !== LAYOUT_VERSION) return null;
    const size = file.size === undefined ? null : readSize(file.size);
    if (file.size !== undefined && size === null) return null;
    let games = 0;
    const tree = readNode(file.tree, () => games++);
    return tree && games <= 1 ? { tree, size } : null;
}

/** `readSetup`'s tree alone. */
export function readLayout(text: string): StoredNode | null {
    return readSetup(text)?.tree ?? null;
}

function readSize(x: unknown): Size | null {
    if (typeof x !== 'object' || x === null) return null;
    const { width, height } = x as Record<string, unknown>;
    const side = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= SIZE_MAX;
    return side(width) && side(height) ? { width, height } : null;
}
```

  - The file's opening doc ("A saved layout: one tab's panes, as a file…") says layouts are saved from a tab's right-click menu. Rewrite that part: a setup is saved from the tab bar's Setups menu, into that server's own `setups/` folder, and opened from the same menu. Keep the rest of the doc's argument.

- [ ] **Step 5: Implement `src/main/setups.ts`.**

```ts
import type { StoredNode } from './layoutFile.ts';
import type { Size } from './paneTree.ts';
import type { ToolId } from '../shared/ipc.ts';
import { CHAT_PREFERRED_HEIGHT, COLUMN_PREFERRED_WIDTH, GAME_PREFERRED_WIDTH, SEAM } from '../shared/layout.ts';

/**
 * The setups the kit ships: the shapes a window is most often wanted in,
 * one click from the tab bar's Setups menu.
 *
 * Pure, and made per window rather than fixed, because what a built-in holds
 * depends on what the window offers. A built-in leaves out a tool the window
 * does not have — Hiscores on a server with no lookup — rather than showing an
 * empty pane where it would have been: a built-in is the kit's promise of a
 * shape, and a hole in it would read as broken. A saved setup is somebody's
 * file and keeps `instantiateLayout`'s empty pane, which says what is missing.
 *
 * Each comes with the size of tab it was drawn for, in pixels, so opening one
 * can size the window around the game (`paneTree.arrangeForGame`) exactly as
 * a saved setup's own size does.
 */

export type BuiltInSetupId = 'game' | 'game-chat' | 'game-chat-tools';

export interface BuiltInSetup {
    id: BuiltInSetupId;
    /** As the Setups menu shows it. */
    name: string;
    tree: StoredNode;
    size: Size;
}

const GAME: StoredNode = { kind: 'leaf', content: { kind: 'game' } };
const tool = (id: ToolId): StoredNode => ({ kind: 'leaf', content: { kind: 'tool', tool: id } });

/** Children laid along one axis at these pixel sizes, as a split whose fractions lay them out at exactly those sizes. One child is that child. */
function stack(axis: 'x' | 'y', children: StoredNode[], sizes: number[]): StoredNode {
    if (children.length === 1) return children[0]!;
    const gross = sizes.reduce((sum, px) => sum + px, 0);
    return { kind: 'split', axis, children, fractions: sizes.map(px => px / gross) };
}

/**
 * The built-ins this window can offer, in the menu's order.
 *
 * - **Game**: the game alone, at its preferred size.
 * - **Game and Chat**: the game over chat, as a new window opens.
 * - **Game, Chat and Tools**: that, with a column down its right holding every
 *   other tool the window offers, in the window's own order, sharing the
 *   column's height evenly.
 *
 * `gameHeight` is the game pane's preferred height, which is the stock one
 * unless the server's client page needs more. A window without chat has no
 * Game and Chat, and its tools setup puts the column beside the game alone; a
 * window with no tool but chat has no tools setup.
 */
export function builtInSetups(opts: { tools: readonly ToolId[]; gameHeight: number }): BuiltInSetup[] {
    const width = GAME_PREFERRED_WIDTH;
    const chat = opts.tools.includes('chat');
    const left = chat ? stack('y', [GAME, tool('chat')], [opts.gameHeight, CHAT_PREFERRED_HEIGHT]) : GAME;
    const height = chat ? opts.gameHeight + SEAM + CHAT_PREFERRED_HEIGHT : opts.gameHeight;
    const others = opts.tools.filter(id => id !== 'chat');
    const setups: BuiltInSetup[] = [{ id: 'game', name: 'Game', tree: GAME, size: { width, height: opts.gameHeight } }];
    if (chat) setups.push({ id: 'game-chat', name: 'Game and Chat', tree: left, size: { width, height } });
    if (others.length > 0) {
        const gross = height - SEAM * (others.length - 1);
        const column = stack('y', others.map(tool), others.map(() => gross / others.length));
        setups.push({
            id: 'game-chat-tools',
            name: chat ? 'Game, Chat and Tools' : 'Game and Tools',
            tree: stack('x', [left, column], [width, COLUMN_PREFERRED_WIDTH]),
            size: { width: width + SEAM + COLUMN_PREFERRED_WIDTH, height }
        });
    }
    return setups;
}
```

- [ ] **Step 6: Run** `npm test` and `npm run typecheck`. Expected: pass.

- [ ] **Step 7: Commit.** `feat: setups — three built-in shapes, a saved size, and a tree arranged around the game`

---

### Task 8: The Setups menu (main and the tab bar)

**Files:**
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/main/serverWindow.ts`, `src/main/paneHost.ts`, `src/renderer/Shell.tsx`, `CLAUDE.md`, `README.md`

**Interfaces:**
- Consumes (Task 7): `arrangeForGame`, `gameSizeIn`, `builtInSetups`, `BuiltInSetupId`, `readSetup`, `writeLayout(…, size)`.
- Produces:
  - `ServerWindow.showSetupsMenu(x, y)`
  - `ServerWindow.openBuiltInSetup(id): Promise<'opened' | 'cancelled' | 'missing'>`
  - `ServerWindow.saveSetupTo(tabId, path)`
  - `ServerWindow.openSetupFrom(tabId, path): Promise<'opened' | 'unreadable' | 'cancelled' | 'missing'>`

  These replace `saveLayoutTo` and `loadLayoutFrom`.

- [ ] **Step 1: IPC and preload.**
  - Add `tabSetupsMenu: 'zanaris:tab-setups-menu',` after `tabAddPaneMenu` in `IPC`.
  - In `ZanarisApi.panes`, add after `addPaneMenu`:

```ts
        /**
         * Raises the tab bar's Setups menu: the built-in setups, the saved
         * ones, and saving the active tab as one. Choosing one replaces the
         * active tab's panes and sizes the window around the game. Native and
         * built in main like the pane menus. Coordinates are the window's.
         */
        setupsMenu(x: number, y: number): Promise<void>;
```

  - Rewrite `tabMenu`'s doc: a right-click on a tab raises its menu, which is Close Tab. Setups moved to the Setups menu.
  - In the preload, add `setupsMenu: (x, y) => ipcRenderer.invoke(IPC.tabSetupsMenu, x, y),`.
  - In `index.ts`, beside the `IPC.tabAddPaneMenu` handler, add:

```ts
ipcMain.handle(IPC.tabSetupsMenu, (event, x: unknown, y: unknown) => {
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    windowFor(event.sender)?.showSetupsMenu(x, y);
});
```

- [ ] **Step 2: The host.** In `src/main/paneHost.ts`:
  - Import `gameSizeIn` from `./paneTree.ts`.
  - Change `replaceTab` to take a size and record the arrangement:

```ts
        /**
         * Replaces a tab's panes with a setup's. The window has already asked
         * about and destroyed the game when this drops it, which is why it is
         * a separate step from `loading`: the question comes between them.
         * With a size (`paneTree.arrangeForGame`), the tree is the arrangement
         * made at that size, so the window's resize toward it is fitted from
         * there rather than read as a resize of the old tab; without one it is
         * fitted to the tab as it is, by its fractions.
         */
        replaceTab(tabId: string, tree: PaneNode, size: Size | null): boolean {
            const loaded = loadingLayout(set, tabId, tree);
            if (!loaded) return false;
            set = loaded.set;
            if (size) fits.set(tabId, arrangedAt(tree, size));
            dragging = false;
            syncViews();
            deps.changed();
            return true;
        },

        gameSize: () => gameSizeIn(set.tabs.map(tab => tab.tree), { width: bounds.width, height: bounds.height }),
```

  - In the `PaneHost` interface, add `size: Size | null` to `replaceTab`'s signature. Add `/** The game's pixels in whichever tab holds it, at the tab size the window has now, or null when no tab holds it. */ gameSize: () => Size | null;`. Change "loaded layout" to "setup" in the docs of `instantiate`, `loading` and `treeOf`.

- [ ] **Step 3: The window.** In `src/main/serverWindow.ts`:
  - **Imports:**
    - `readSetup` and `type StoredNode` from `./layoutFile`, replacing `readLayout`. `writeLayout` and `layoutEntries` stay.
    - `arrangeForGame` from `./paneTree`.
    - `builtInSetups, type BuiltInSetupId` from `./setups`.
  - **`ServerWindowDeps`:**
    - Rename `layoutsDir` to `setupsDir`. Its doc becomes "This server's saved setups: the folder Save This Tab as a Setup… writes into, the Setups menu lists, and Open Setups Folder opens. Created when first needed, not before…".
    - Change `confirmCloseGame`'s `via` to `'pane' | 'tab' | 'setup'` and its doc ("a layout loaded over the tab holding it" becomes "a setup opened over the tab holding it").
  - **`destroyGame`:** `via` takes `'setup'` instead of `'layout'`, and logs `closed the game to open a setup`.
  - **The tab menu:** delete `showTabMenu`'s Save/Load/Open items and the separator after them. It becomes a menu of Close Tab alone. Rewrite its doc: a tab's menu is Close Tab, and setups live in the tab bar's Setups menu, because a setup is opened into whichever tab is in front.
  - **Replace** `savedLayouts`, `saveLayoutAs`, `saveLayoutTo`, `loadLayoutFromFile`, `loadLayoutChosen`, `loadLayoutFrom` and `openLayoutsFolder` with the block below. Keep the section heading, renamed `// ── setups ──`.

```ts
    /** The tab in front: what the Setups menu opens into and saves. */
    function activeTabId(): string {
        return host.tabs().find(tab => tab.active)!.id;
    }

    /**
     * The menu under the tab bar's Setups: the built-in shapes this window can
     * offer (`setups.builtInSetups`), the setups saved for this server, and
     * saving the tab in front as one. Whatever is chosen replaces the panes of
     * the tab in front, which is the tab the menu was opened over.
     */
    function showSetupsMenu(x: number, y: number): void {
        if (win.isDestroyed()) return;
        const tabId = activeTabId();
        const saved = savedSetups();
        const template: MenuItemConstructorOptions[] = [
            ...builtInSetups({ tools, gameHeight: content.game }).map(setup => ({
                label: setup.name,
                click: () => void openSetup(tabId, setup.tree, setup.size, setup.name)
            })),
            { type: 'separator' },
            ...(saved.length === 0
                ? [{ label: 'No Saved Setups', enabled: false }]
                : saved.map(entry => ({ label: entry.name, click: () => void openSetupChosen(tabId, join(deps.setupsDir, entry.file)) }))),
            { type: 'separator' },
            { label: 'Save This Tab as a Setup…', click: () => void saveSetupAs(tabId) },
            // A setup somebody sent, wherever it was saved to. Opening it does
            // not copy it into the folder: that is still the player's to
            // decide, by saving it again.
            { label: 'Open Setup File…', click: () => void openSetupFromFile(tabId) },
            { label: 'Open Setups Folder', click: () => void openSetupsFolder() }
        ];
        Menu.buildFromTemplate(template).popup({ window: win, x: Math.round(x), y: Math.round(y) });
    }

    /** The folder's setups, or none when there is no folder yet. */
    function savedSetups(): { name: string; file: string }[] {
        try {
            return layoutEntries(readdirSync(deps.setupsDir));
        } catch {
            return [];
        }
    }

    async function saveSetupAs(tabId: string): Promise<void> {
        const label = host.tabs().find(tab => tab.id === tabId)?.label;
        if (label === undefined) return;
        try {
            mkdirSync(deps.setupsDir, { recursive: true });
            const { canceled, filePath } = await dialog.showSaveDialog(win, {
                title: 'Save Setup',
                defaultPath: join(deps.setupsDir, layoutFileName(label)),
                filters: [{ name: 'Zanaris Kit setup', extensions: ['json'] }]
            });
            if (canceled || !filePath || win.isDestroyed()) return;
            saveSetupTo(tabId, filePath);
        } catch (err) {
            deps.log(`${tag} could not save a setup: ${(err as Error).message}`);
            if (!win.isDestroyed()) await dialog.showMessageBox(win, { type: 'warning', message: 'The setup could not be saved.', detail: (err as Error).message });
        }
    }

    /**
     * Writes a tab's panes, with the size of tab they are drawn at, so the
     * setup opens with every pane at these pixels again. Reads the tab when the
     * file is written rather than when the menu opened: the dialog was up in
     * between.
     */
    function saveSetupTo(tabId: string, path: string): void {
        const tree = host.treeOf(tabId);
        if (!tree) throw new Error('that tab has closed');
        writeFileSync(path, writeLayout(tree, server.id, { width: rects.tree.width, height: rects.tree.height }));
        deps.log(`${tag} saved setup ${basename(path)}`);
    }

    async function openSetupFromFile(tabId: string): Promise<void> {
        try {
            mkdirSync(deps.setupsDir, { recursive: true });
        } catch {
            // The folder is only where the dialog starts; a file anywhere else still opens.
        }
        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
            title: 'Open Setup',
            defaultPath: deps.setupsDir,
            properties: ['openFile'],
            filters: [{ name: 'Zanaris Kit setup', extensions: ['json'] }]
        });
        const path = filePaths[0];
        if (canceled || !path || win.isDestroyed()) return;
        await openSetupChosen(tabId, path);
    }

    /** Opening from the menu: the same open, and a sheet rather than silence when the file was not a setup. */
    async function openSetupChosen(tabId: string, path: string): Promise<void> {
        if ((await openSetupFrom(tabId, path)) !== 'unreadable' || win.isDestroyed()) return;
        await dialog.showMessageBox(win, {
            type: 'warning',
            message: "That file isn't a Zanaris Kit setup.",
            detail: `${basename(path)} could not be read as a setup, so the tab was left as it was.`
        });
    }

    /** A setup file, into a tab. `unreadable` is a file that could not be read or is not a setup, and leaves the tab as it was. */
    async function openSetupFrom(tabId: string, path: string): Promise<'opened' | 'unreadable' | 'cancelled' | 'missing'> {
        let text: string;
        try {
            text = readFileSync(path, 'utf8');
        } catch (err) {
            deps.log(`${tag} could not read ${path}: ${(err as Error).message}`);
            return 'unreadable';
        }
        const read = readSetup(text);
        if (!read) {
            deps.log(`${tag} refused ${basename(path)}: not a Zanaris Kit setup`);
            return 'unreadable';
        }
        return openSetup(tabId, read.tree, read.size, basename(path));
    }

    /** One of the built-ins, into the tab in front, as its menu item does. `missing` when this window does not offer it. */
    function openBuiltInSetup(id: BuiltInSetupId): Promise<'opened' | 'cancelled' | 'missing'> {
        const setup = builtInSetups({ tools, gameHeight: content.game }).find(s => s.id === id);
        return setup ? openSetup(activeTabId(), setup.tree, setup.size, setup.name) : Promise.resolve('missing');
    }

    /**
     * A setup, into a tab: a built-in or a file's, replacing the tab's panes
     * and sizing the window around the game.
     *
     * What it costs is `tabs.loadingLayout`'s answer, which is pure and
     * tested; this asks the question it raises and acts. When the setup would
     * take the game's leaf away, that is closing the game, so it asks first
     * and destroys the view — the layout invariant in `CLAUDE.md`, and the
     * same order `closeTab` keeps, including asking the tabs again once the
     * sheet is down, since the game may have moved while it was up. When the
     * setup wants a game and the window has none left, one is made and
     * loaded, as choosing the game in an empty pane does.
     *
     * The game keeps the pixels it has now and every other pane gets the ones
     * the setup was saved with (`paneTree.arrangeForGame`): the window grows or
     * shrinks to hold them (`sizeWindow`).
     */
    async function openSetup(tabId: string, stored: StoredNode, saved: Size | null, name: string): Promise<'opened' | 'cancelled' | 'missing'> {
        const want = gameView ? host.gameSize() : null;
        const tree = host.instantiate(stored);
        const loading = host.loading(tabId, tree);
        if (!loading) return 'missing';
        if (loading.dropsGame) {
            if (!(await deps.confirmCloseGame('setup'))) return 'cancelled';
            if (win.isDestroyed()) return 'missing';
            const now = host.loading(tabId, tree);
            if (!now) return 'missing';
            if (now.dropsGame) destroyGame('setup');
        }
        if (holdsGame(tree) && !gameView) {
            gameView = makeGameView();
            void loadGame(expected);
        }
        const arranged = arrangeForGame(tree, saved, want);
        if (!host.replaceTab(tabId, arranged.tree, arranged.size)) return 'missing';
        if (arranged.size) sizeWindow(arranged.size);
        syncPanelProbe();
        deps.log(`${tag} opened setup ${name}${arranged.size ? ` at ${arranged.size.width}x${arranged.size.height}` : ''}`);
        return 'opened';
    }

    /**
     * The window sized so its tab is `size`: grown as far as its display
     * allows and moved back onto it, or shrunk from the right and the bottom
     * (`windowRoom.grownFrame` takes both). Not while it is maximised or full
     * screen, where a resize would only take it out of that; the tab's fit
     * holds the game instead. Its resize lays everything out again.
     */
    function sizeWindow(size: Size): void {
        if (win.isDestroyed() || win.isFullScreen() || win.isMaximized()) return;
        const frame = win.getBounds();
        const workArea = screen.getDisplayMatching(frame).workArea;
        const room = roomFor(frame, workArea);
        const by = { width: Math.min(size.width - rects.tree.width, room.width), height: Math.min(size.height - rects.tree.height, room.height) };
        if (by.width === 0 && by.height === 0) return;
        win.setBounds(grownFrame(frame, workArea, by));
    }

    async function openSetupsFolder(): Promise<void> {
        try {
            mkdirSync(deps.setupsDir, { recursive: true });
        } catch (err) {
            deps.log(`${tag} could not make ${deps.setupsDir}: ${(err as Error).message}`);
            return;
        }
        const failed = await shell.openPath(deps.setupsDir);
        if (failed) deps.log(`${tag} could not open ${deps.setupsDir}: ${failed}`);
    }
```

  - **Check the variables it uses.** `content` is the `defaultContent(server.id)` const in `createServerWindow`, and `content.game` is the game's preferred height. `tools` is the window's `ToolId[]`. Confirm both are in scope where you put the block. If `content` is declared after it, move the block or read `defaultContent(server.id).game`.
  - **The `ServerWindow` interface and return object:**
    - Replace `saveLayoutTo` and `loadLayoutFrom` with `saveSetupTo` and `openSetupFrom`, with the docs from their functions.
    - Add `showSetupsMenu(x: number, y: number): void;` with a doc like `showAddPaneMenu`'s.
    - Add `openBuiltInSetup(id: BuiltInSetupId): Promise<'opened' | 'cancelled' | 'missing'>;`.
    - Update `showTabMenu`'s doc.
    - Remove `readLayout` from the imports if nothing uses it now.
  - **`applyLayout`'s doc:** add setups to the list of things the window resizes for.

- [ ] **Step 4: `index.ts`.**
  - Rename the dep `layoutsDir: join(userData, 'layouts', slugify(spec.server.id))` to `setupsDir: join(userData, 'setups', slugify(spec.server.id))`.
  - In `confirmCloseGame`, change the `via` type to `'setup'` and change `via === 'layout' ? 'Load this layout and close the game?'` to `via === 'setup' ? 'Open this setup and close the game?'`.
  - **Capture's layout block** (search `const layoutPath`):
    - Replace `second.saveLayoutTo(` with `second.saveSetupTo(` and `second.loadLayoutFrom(` with `second.openSetupFrom(`.
    - Rename `layoutPath` to `setupPath`, the temp file name to `zanaris-kit-capture-setup-${Date.now()}.json`, and the shot to `${first.state().server.id}-setup-loaded`.
    - Reword its comment and log line from layout to setup. The comment's "leaves nothing in the layouts folder" becomes "the setups folder".
  - **A new capture block** at the end of the capture run, after the custom-theme block and inside the same `try`:

```ts
        // A built-in setup opened, then its tools column closed pane by pane:
        // the window should grow by the column when the setup opens and give
        // it back when the column's last pane closes, and the game keep its
        // width through both. On the first window, whose tab in front holds
        // the game; skipped, and said, when it does not.
        {
            const gamePane = (): { rect: { width: number } } | undefined => first.state().panes.find(p => p.content.kind === 'game');
            const width = (): number => first.window.getContentBounds().width;
            if (!gamePane()) {
                log('[capture] setups: the first window has no game in its tab in front; the setup and close check was skipped');
            } else {
                const before = { window: width(), game: gamePane()!.rect.width };
                const opened = await first.openBuiltInSetup('game-chat-tools');
                await wait(800);
                const during = { window: width(), game: gamePane()?.rect.width ?? 0 };
                log(`[capture] setup Game, Chat and Tools: ${opened} — window ${before.window} → ${during.window}, game ${before.game} → ${during.game}`);
                await shootShell('setup-tools', first);
                for (const pane of first.state().panes.filter(p => p.content.kind === 'tool' && p.content.tool !== 'chat')) {
                    await first.closePane(pane.paneId);
                    await wait(300);
                }
                await wait(500);
                const after = { window: width(), game: gamePane()?.rect.width ?? 0 };
                log(`[capture] setups: tools column closed — window ${during.window} → ${after.window}, game ${during.game} → ${after.game}`);
                if (during.game !== before.game || after.game !== before.game) fault(`setups: the game did not keep its width (${before.game}, ${during.game}, ${after.game})`);
                if (after.window >= during.window) fault(`setups: closing the tools column did not give the window its width back (${during.window} → ${after.window})`);
                await shootShell('setup-closed', first);
            }
        }
```

  Check that `shootShell(name, sw)` has that signature. The theme blocks use `shootShell('theme-custom', first)`. If `opened` is not `'opened'`, the log line says so. Leave it at that and don't add a fault for it, because a window might legitimately lack tools.

- [ ] **Step 5: The Setups button.** In `src/renderer/Shell.tsx`, between the gear's `<button>` and Add pane's, add:

```tsx
                    {/*
                     * Setups: a set of panes in a shape, one click away. Main's
                     * menu, as Add pane's is, since it drops down over the panes;
                     * whatever is chosen replaces the panes of the tab in front
                     * and sizes the window around the game.
                     */}
                    <button
                        type="button"
                        title="Open this tab in a setup, or save it as one"
                        aria-haspopup="menu"
                        onClick={event => {
                            const box = event.currentTarget.getBoundingClientRect();
                            void window.zanaris.panes.setupsMenu(box.left, box.bottom);
                        }}
                        style={ADD_PANE_BOX}
                        className="btn shrink-0 gap-[3px]"
                    >
                        Setups
                        <Caret />
                    </button>
```

  Update the two comments that describe the bar ("Tabs and the control that makes one, then Settings and Add pane at the far end, and nothing else", and the tablist comment about a right-click raising the tab's own menu) so they name Setups and say a right-click on a tab offers Close Tab. `ADD_PANE_BOX`'s comment speaks of "the caret's side", which fits both buttons. Leave it.

- [ ] **Step 6: Docs.**
  - **`CLAUDE.md`:**
    - The `TOOL_IDS` paragraph: "A saved layout file carries tool ids between people" becomes "A saved setup file…". The quoted refusal becomes "That file isn't a Zanaris Kit setup". Keep `readLayout`'s name if you kept the function, or use `readSetup`, whichever is what refuses the whole file.
    - The layout invariant's resize sentence, from Task 6: add setups. A setup opened sizes the window to hold the game at its pixels (`arrangeForGame`, `sizeWindow`).
  - **`README.md`:**
    - Replace the saved-layout text (search "Save Layout…", "Load Layout", "right-click on a tab") with the Setups menu: the three built-ins, saving the tab in front, opening a file, the folder at `<userData>/setups/<server>/`, and that a setup opens around the game at its pixels.
    - Update the Verified table row that names "a layout saved and loaded into a new tab" to say setup.
    - Update the source list's `layoutFile.ts` line and add `src/main/setups.ts` beside it, marked tested.

- [ ] **Step 7: Verify.** `npm test`, `npm run typecheck` and `npm run build` pass. Grep for leftovers: `grep -rn "loadLayoutFrom\|saveLayoutTo\|layoutsDir\|Load Layout\|Save Layout" src CLAUDE.md README.md`. Nothing should remain except history in specs. Then in `npm run dev`:
  - Setups > Game, Chat and Tools: a column appears, the window grows, and the game keeps its size.
  - Setups > Game: the window shrinks to the game.
  - Save This Tab as a Setup…, then change the tab, then pick the saved setup from the menu: it comes back at its saved pixels.
  - Open Setups Folder opens `…/setups/<server>`.
  - Right-click a tab: only Close Tab.

  Report what you saw.

- [ ] **Step 8: Commit.** `feat: Setups — a menu in the tab bar opens a shape of panes around the game, or saves one`

---

### Task 9: Verification pass

**Files:** none new. This task fixes whatever it finds.

- [ ] **Step 1:** `npm test`, `npm run typecheck` and `npm run build` all pass. Paste the counts.
- [ ] **Step 2:** Run `caffeinate -d npm run capture` and leave the machine alone while it runs. Expected: exit 0, and the log says every shell painted. Grep the log for `could not push state`, `Maximum call stack`, `fault` and `[capture] setup`.
- [ ] **Step 3: Open the PNGs.** Look at every tool pane shot (padding), `settings-appearance*` (the card buttons), `settings-editor` (no preview, the bar pinned at the bottom, Save visible), `setup-tools`, `setup-closed` and `*-setup-loaded`. Describe each in a sentence.
- [ ] **Step 4:** Read the diff of `CLAUDE.md` and `README.md` against `main` (`git diff main -- CLAUDE.md README.md`). Every claim has to match the code.
- [ ] **Step 5:** Commit any fixes with messages that say what was wrong.
