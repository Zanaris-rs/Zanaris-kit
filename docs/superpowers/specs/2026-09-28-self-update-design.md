# The kit updates itself

**Date:** 2026-09-28
**Status:** approved in chat, building on `claude/v1-release-readiness-952122`

## Why

The first release, 0.9.0, goes to a few friends before 1.0.0 goes anywhere.
Until now the kit only noticed a newer release: Help > Update Available
opened the release page, and the player downloaded and installed it by hand.
Whichever version first carries an updater is the first that can use one —
everyone on an older version updates by hand once more — so it goes into
0.9.0, and 0.9.1 is how it gets tested.

## The owner's calls

1. **Ask before downloading.** A newer release is announced, never fetched
   unasked: the Mac download is about 270 MB, Windows and Linux about 155.
2. **The notice is a button in the tab bar**, beside where Sharing sits, in
   every window. Help > Check for Updates… is the other way in.
3. **Built on the kit's own download code**, not `electron-updater`: no new
   dependency, and no Squirrel on the Mac, whose signature check refuses
   every update between two ad-hoc signed builds.
4. **It ships in 0.9.0**, published as a full release, not a prerelease.

## What a throwaway test on macOS 27 settled

A two-version Electron app, ad-hoc signed as the kit is, installed the way a
player installs the kit — dragged out of a quarantined DMG with Finder, then
Open Anyway — downloaded its next version itself, handed off to a detached
`/bin/sh`, quit, and the helper renamed the old bundle aside and the new one
into `/Applications`. No App Management prompt, and the new version opened
with no Gatekeeper prompt: a file the app writes itself carries no
quarantine. The old bundle was deleted by the new version on its first
launch.

The same app **not** moved by Finder ran translocated, from a read-only
mount under `/AppTranslocation/`, even from `/Applications` and after Open
Anyway; the swap failed on "Read-only file system". And the test app's
helper reopened the old copy, which tried again, three times over. Both
shape the design: a translocated copy never downloads, and a failed attempt
is never retried unasked.

## Design

### What the player sees

The kit asks GitHub for the latest release at launch, every six hours after,
and on Help > Check for Updates… (the app menu on macOS). A newer version
puts a button at the right of every window's tab bar, before Setups:

| State | Button | Pressing it |
|---|---|---|
| available | **Update 0.9.1** | "Zanaris Kit 0.9.1 is out." with the size, and **Download**, **Release Notes**, **Not Now** |
| downloading | **Updating 42%** | **Keep Going**, **Cancel Download** |
| ready | **Restart to Update** | Asks first — every game is logged out and the world stops — then **Restart** or **Later** |
| failed | **Update failed** | The reason, with **Try Again**, **Open Release Page**, **Not Now** |

A copy that cannot update itself is still told: the button reads **Update
0.9.1**, and its dialog says why and offers **Open Release Page** and **Not
Now** — running from the disk image or translocated ("drag Zanaris Kit to
your Applications folder and open it from there"), a folder the kit cannot
write to, a Windows copy the installer did not put there, a Linux run that
is not the AppImage, a development build, or a release with no download for
this system.

**Not Now** hides the button until the next launch. Check for Updates…
brings it back, and answers "0.9.0 is the newest version" or why it could
not check. The dialogs are sheets on the window whose button was pressed.

**The kit never restarts on its own.** A ready update installs at the next
quit, after the world has stopped and saved, as every quit already waits
for. Restart to Update is that quit, followed by opening the new version.
Quitting never asks, as before.

### What it downloads, and what it trusts

Only one file: the latest release's asset named for this platform and
version — `Zanaris-Kit-<v>-universal.zip`, `Zanaris-Kit-Setup-<v>.exe` or
`Zanaris-Kit-<v>.AppImage` — at the size and sha-256 GitHub's API lists for
it (`digest: "sha256:…"`), through `downloadChecked`. The kit builds the
download URL itself, `https://github.com/Zanaris-rs/Zanaris-kit/releases/download/<tag>/<name>`;
the release body chooses neither host nor path. Windows ships x64 and Linux
x64 only; any other `process.arch` there has no download.

The digest comes from the same place as the file. It catches a broken or
cut-off download and a proxy's mistake, not somebody who controls the
repository — no weaker than a download by hand, and without a signing
identity nothing stronger is available. A signing identity carries a legal
name, which is the attribution this project exists to avoid.

The Mac download is unpacked with `ditto -x -k` and must then pass
`codesign --verify --deep --strict` and read back `CFBundleIdentifier`
`rs.zanaris.kit` and `CFBundleShortVersionString` equal to the version
downloaded. None of that proves who built it; it refuses a wrong or broken
file before it replaces the app.

Nothing is re-checked at rest. A download lives in `<userData>/updates/`,
which anything able to change could change the installed app as easily.

### How each system installs

Every install runs in main's `quit` event: after `before-quit` has stopped
the share and the world, after every window has closed, and just before the
process exits. It writes `updates/attempt.json` (the version) first, then:

- **macOS.** A detached `/bin/sh -c <script>` gets the kit's pid, the
  bundle's path, the unpacked bundle's path, an aside path in `updates/`,
  a result file and whether to reopen, as **arguments** — no path is ever
  pasted into the script. It waits up to 60 s for the pid to go, renames
  the old bundle aside, renames the new one in (renaming the old one back
  if that fails), writes `ok` or the reason to the result file, and reopens
  the app on Restart whichever way it went, so a failed restart still
  brings the player back to a kit that says so.
- **Windows.** The downloaded installer, detached, with `/S --updated`, and
  `--force-run` on Restart. It is electron-builder's one-click per-user
  installer: no elevation, and no SmartScreen, since a file the kit wrote
  carries no mark of the web. With `--updated` it waits about 1.3 s for the
  kit to exit and then closes it, which is why it starts only in `quit`,
  once the world has saved.
- **Linux.** The new AppImage is copied beside the running one (`$APPIMAGE`)
  as a dot-file, made executable, and renamed over it — under the new
  version's name when the old name carried the old version, removing the
  old file. On Restart the new file is spawned detached.

A copy updates itself only when all of this holds, and otherwise is told why
(above): packaged; on macOS, a bundle path ending `.app` that is neither
under `/AppTranslocation/` nor on `/Volumes/`, with both the bundle and its
folder writable; on Windows, `Uninstall Zanaris Kit.exe` beside the running
exe; on Linux, `$APPIMAGE` naming a file whose folder is writable.

### After an attempt

At launch the kit reads `attempt.json`. If it is now that version or newer,
the attempt worked: `updates/` is emptied, the old Mac bundle with it. If
not, the state is **failed**, with the helper's reason when it left one or
"The installer didn't finish" when it did not, and nothing installs at quit
until the player presses Try Again. That is what keeps a failure from
looping.

A download that finished writes `updates/ready.json`. At launch, one naming
a version newer than this one makes the state **ready** without asking
GitHub again; anything older is deleted. A quit during a download leaves an
`.incoming` folder, cleared at the next launch, as `BuildStore` clears its
own.

### Code

- **`src/main/update.ts`** (pure, extended): reading a release body into a
  version, a page and the one asset this system wants; the feed and the
  download base; whether this copy can update itself, from facts main
  gathers (`installMode`); each system's install plan (`installPlan`); what
  an attempt record means (`afterAttempt`); the button's label and title
  (`updateButton`); and each dialog's words and buttons (`updateQuestion`).
- **`src/main/updater/service.ts`**: `UpdateService` with an injected
  `UpdateIo`, as chat and worlds take theirs, so checking, downloading,
  cancelling, the launch reading of `attempt.json` and `ready.json`, and the
  quit's hand-off are driven in a test with no Electron.
- **`src/main/updater/electron.ts`**: the real io — `net.fetch`,
  `downloadChecked`, `ditto`, `codesign`, `plutil`, the file system, the Mac
  helper's script and the spawns. It decides nothing.
- **`src/main/download.ts`**: `downloadFile` takes an optional `signal`, for
  Cancel Download.
- **Wiring**: `ShellState.update`, the button in `Shell.tsx`,
  `IPC.updatePress` and `window.zanaris.update.press()`; `index.ts` shows
  the dialogs, runs the checks and the quit hand-off; the Help menu's
  Update Available item becomes Check for Updates….

### Proving it

A loopback-only feed override, `ZANARIS_UPDATE_FEED=http://127.0.0.1:<port>/<path>`,
points the check at a local release body, and the download base at the same
origin; anything else in it is ignored. With it, a packaged 0.9.0 in
`/Applications` updates to a locally built 0.9.1 on this Mac before anything
is tagged. Then 0.9.0 is published, and later 0.9.1: the Mac path is proven
by then, and Windows and Linux are proven by a friend, or a VM, going from
one to the other.

### Release and docs

- `electron-builder.yml`: the Mac targets are `dmg` and `zip`, both
  universal. The dry run uploads the zip too.
- `package.json`: version 0.9.0.
- RELEASE.md: a zip beside the DMG, and a step for updating from the
  previous release.
- README: Download says what the kit does now; Security posture gains the
  update's trust, as above.
- CLAUDE.md: an Updates section holding the invariants — never restarts on
  its own, installs only in `quit`, one named asset of the latest release
  at GitHub's size and digest, a URL the kit builds, arguments never pasted
  into the helper, and a failed attempt never retried unasked.
- The newer-files dialog stops pointing at Help > Update Available.

## Not in this

Partial downloads, rollback to an older version, release channels, a
Settings switch for automatic checks (`ZANARIS_NO_UPDATE_CHECK` stays, and
now turns off the automatic checks only), and signing.
