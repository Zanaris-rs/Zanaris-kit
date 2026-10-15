# The Theme button, and the game page wearing the theme

**Date:** 2026-10-15
**Status:** approved in chat from a clickable mockup, building on `claude/customization-appearance-skinning-fdd61f`

## Why

Two things keep a player from seeing that the kit can be dressed.

- **Themes are hard to find.** From a game window the way in is a gear with
  no word on it, in the bar's far corner, which opens Settings on Servers;
  themes are the second section. The menu bar's View > Server Theme is the
  only other way, and it is a submenu of a menu nobody opens to look for one.
- **The game pane keeps a hole in every theme.** The client page around the
  canvas is black, and its controls strip under the canvas is the client's
  green on black, whatever the frame wears. Every built-in's ground is close
  to black, so the hole is the strip: the one part of the window that is
  plainly not the kit's.

## The owner's calls

1. **A Theme button in the tab bar**, worded, with a caret, between Setups
   and Add pane: Setups, Theme, Add pane, then the gear.
2. **A pick sets the app theme**, which every window following the app
   wears. A **Just for \<server\>** tick in the same menu gives that server
   its own theme, and while it is ticked a pick is that server's alone.
3. **The game page wears the theme, dressed as the kit's own stone**: the
   theme's ground around the canvas, the controls strip a raised stone band,
   its dropdowns sunk wells, its words and icons in the theme's text colour.
   CSS only.
4. **The kit's own offline and starting pages**, which show in the game
   pane, wear the theme too. Today they are 2004 stone whatever the frame is.

## What stays true

- **Nothing but CSS reaches a game page.** No preload, no code in its world:
  a stylesheet through `insertCSS`, as the scrollbar sheet already is. The
  canvas and everything the client draws on it are the game's own art, and
  no theme reaches them.
- **A theme's picture never reaches the game view.** `zanaris-bg:` stays
  unhandled on the game partitions; the page wears flat colours only.
- **The game page keeps its geometry.** The game pane's preferred sizes are
  measured off the stock page — `LOSTCITY_GAME_PREFERRED_HEIGHT` has a pixel
  or two of slack — so the theme sheet changes no border, margin, padding or
  height that sets the page's height. Bevels are inset box-shadows, never
  borders.
- **Only Settings calls the appearance handlers.** The window's Theme menu is
  a native menu main builds and acts on, as View > Server Theme does; the
  shell only asks for it to open, as it does Setups.
- **A reference page is never themed.** Only the game view's pages are.
- **View > Server Theme stays** as it is, acting on the server alone.

## 1. The Theme button and its menu

### What the player sees

The bar ends Setups, Theme, Add pane, then the gear. Theme is a `.btn` with
a caret, as its neighbours are, and opens a native menu under itself:

```
Theme ▾
  ✓ ▣ 2004 Stone
    ▣ Zanaris
    ▣ Wilderness
    ▣ Al Kharid
    ▣ Morytania
    ▣ Lumbridge
  ─────────────
    ▣ Ice Mountain          (the player's own, as typed)
  ─────────────
    Just for Lost City
  ─────────────
    Customise 2004 Stone…   (Edit Ice Mountain… for one of their own)
    All Themes…
```

- **The tick** is on what this window's server is set to wear: its own
  theme while it has one, else the app's. It shows the stored choice, so a
  draft open in the editor moves no tick, as View > Server Theme already
  behaves.
- **Each theme carries a swatch** as its menu icon, on macOS: a 16-point
  square of the theme's stone with its bevel, lit edge above and left and
  dark edge below and right — the trim is what tells the places apart. Off
  macOS there is none: Windows' and GTK's menus are reported to draw an
  item's check or its image, not both, and the tick is the one that means
  something. Names are labelled
  as View > Server Theme labels them (`themeLabel`, moved beside the menu's
  other rules): a built-in in Title Case, the player's own as typed, an `&`
  doubled off macOS.
- **The player's own** follow a separator, and the group is left out when
  there are none.

### What each item does

- **A theme**, with Just for unticked, sets the app theme. With it ticked,
  it sets this server's own theme.
- **Just for \<server\>**, ticked, gives the server the app's current theme
  as its own, so nothing changes on screen; unticked, it puts the server back
  on the app theme. It is greyed out for a window whose server Settings has
  removed, and a pick there sets the app theme.
- **Customise… / Edit…** opens the editor (section 2).
- **All Themes…** opens Settings beside this window, on Appearance.

Every change goes through `appearanceChanged`: every window restyles,
Settings is pushed, and the app menu is rebuilt so View > Server Theme
agrees.

### Where it lives

The rules are pure, in `appearance.ts`, beside `lookFor`: `themeMenu` answers
the entries — label, ticked, enabled, swatch colours and the action each one
takes — and `themeChoice` answers what a pick or the tick writes. The swatch
is `swatch.ts`: an RGBA PNG from a theme's colours, also pure, since
`createFromBitmap`'s byte order is the platform's. Main pops
the menu from the `tab-theme-menu` handler, as the app menu's ≡ is popped,
turning entries into menu items and the bitmap into a `nativeImage`.

## 2. Customise from a window

**Customise… opens Settings on Appearance with the editor open on the theme
the window's server is set to wear**: a built-in as a copy named
"\<name\> (copy)", one of the player's own as it is — what its card's
Customise or Edit opens, so the two share one `draftOf`, moved into
`themes.ts`. Settings opens beside the window, as the gear opens it.

**An editor already open keeps its draft.** Settings comes forward on
Appearance, and the draft is neither replaced nor discarded.

**Save goes where the window's pick would.** Opened from a window whose
server keeps its own theme, Save makes the saved theme that server's own;
otherwise it makes it the app theme, as today. Without this, saving from a
window with its own theme would leave that window wearing its old theme the
moment the draft ended. The editor says so only in the first case, under
its fields: *Save makes this Lost City's own theme.* Opened from a card in
Settings, or from a window following the app, nothing changes and nothing
is said.

### How the request reaches Settings

Settings is a page of its own, and may not exist yet when Customise is
chosen, so main holds the request — a section and, for Customise, the draft
and the server — until Settings takes it.

- Settings asks for it with `settings.takeShow()` as its page starts, and
  again whenever main pings it (`settings.onShow`), which main does when a
  request is made with Settings already loaded.
- Main answers only once Settings' page has finished loading, and clears it
  as it answers. So a request is taken exactly once, and never before the
  first load's `onPageReset` — which ends any draft when the page finishes
  loading — could end the draft the request just opened. A page that loads
  again (a reload in development, or after a crash) can still take one before
  its own reset; that reset then ends main's draft under an open editor until
  its next change.
- Settings applies a request it took even from an effect cleaned up since:
  main has let it go. React's StrictMode cleans up and remounts every effect
  once in development, and the first take is the one that gets it.

### Where Save goes

`Editing`, which Settings reports on every change while the editor is open,
carries `forServer`: the server whose window opened it, or null. It is set
when the editor opens from a window whose server keeps its own theme, and is
read strictly in `readEditing`. Main decides with `savesTo(appearance,
catalog, editing)`, pure: that server, while it is still in the catalog and
still keeps its own theme, else the app. The Save handler uses it, and so
does `AppearanceView.savesTo`, which is all the editor reads for its line.

## 3. The game page wears the theme

### What changes

On a client page — Lost City's template; the other servers' and your home
server's pages are older and lack some of it, as the next paragraph says —
the theme sheet sets:

| Part | Wears |
|---|---|
| The page's ground (`html`, `body`, and full screen) | `window` |
| `#controls`, the strip | `stone`, bevelled `edge-lit` above-left and `edge-dark` below-right, by inset shadow |
| Its words | `cream`, with the kit's hard black glyph shadow |
| `select` | `well`, recessed by inset shadow, `cream` text and a `cream` arrow in place of the green one, drawn without the system's look and with its arrow placed by the sheet, since older pages leave both to the system |
| `.icon-control` and `.green` | `cream`; a link `gold` under the pointer |

A server whose page has no `#controls` gets the rest: the ground, the
dropdowns and the green text still follow. Every colour comes from the look
being worn, apart from the glyph shadow's neutral black; nothing else is
written into the page.

The view's own background stays black. Between a load starting and the
sheet landing at `dom-ready` the page is the stock one, black, so the black
under it shows nothing new.

On the kit's own pages, offline and starting, `page.css` reads each colour
from a `--zk-*` variable with its stone value as the fallback, and the sheet
sets the variables.

### How

- **`gamePage.ts`, pure**: `clientPageCss(look)` and `kitPageCss(look)`.
- **`serverWindow.ts`** injects at `dom-ready`: the scrollbar sheet and the
  theme sheet on a client page, the variables on a kit page. On every
  `themeChanged` it swaps the theme sheet: the new one inserted, then the
  old removed by the key `insertCSS` answered, so a page wears one theme
  sheet at a time. A newer swap supersedes one still in flight.
- **The draft is worn here too.** The game page reads the same look the
  shell does, `deps.theme()`, so while the editor is open it wears the draft.

## Testing

- `appearance.test.ts`: `themeMenu` — the tick with and without a server's
  own, Just for ticked, greyed for a removed server, the player's own group
  present and absent, Customise or Edit; `themeChoice` for each action;
  `savesTo` for a server that still keeps its own, one that no longer does,
  one removed, and none; `readEditing` reading `forServer`.
- `themes.test.ts`: `draftOf` for a built-in and for one of the player's own.
- `gamePage.test.ts`: every colour in either sheet is one of the look's, or
  the glyph shadow's black; no
  `url(`, `@import` or `<`; no `border`, `margin`, `padding`, `height` or
  `line-height` on `#controls`; a variable for every token in the kit sheet.
- `swatch.test.ts`: the face, the lit edge and the dark edge at the pixels
  they belong to, RGBA, and a PNG that decodes to them.
- `npm run capture`: the game page shot under the override step's
  Wilderness (`theme-override-<id>-game`); the menu's choices driven through
  the same function the menu calls, read back from the state; Customise from
  a window whose server keeps its own theme, the editor open with its line,
  shot (`settings-editor-from-window`); and each built-in's swatch written as
  a PNG beside the shots, since a native menu cannot be shot.

## Docs

The README's How it looks, on themes, and its Layout paragraph on the
injected stylesheet; `CLAUDE.md` on what a game page may be given; and every
comment that says the game is never themed — `themes.ts`, `Appearance.tsx`,
`serverWindow.ts`'s `themeChanged`, and the shell's tab bar.
