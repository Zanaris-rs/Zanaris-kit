# Release checklist

A release is a tag. CI builds every platform from it and drafts a GitHub
Release; publishing the draft is the last step and is done by hand. The order:

## 0. Before you tag

- `engine.lock.json` points at the engine commit the fleet runs and the
  content commit beside it. Both must be on the public repositories:
  `git ls-remote https://github.com/Zanaris-rs/Engine-TS.git` shows the branch.
- Bump `version` in `package.json`. The tag must be `v` followed by exactly
  that version; the workflow refuses anything else.
- Commit. `git status` clean.

## 1. Dry run

Actions > Release > Run workflow, on the branch you are about to tag. It
stages the engine (a few minutes) and packages on all three runners without
publishing. Download the three artifacts from the run.

## 2. Try each artifact on a clean profile

On each artifact, before anything else, confirm the engine came across whole:
under the app's `resources/engine` there must be a `node_modules` directory
beside `src` (on macOS, inside the bundle at `Zanaris Kit.app/Contents/Resources/engine`).

- macOS, on this Mac: mount the DMG, drag the app to Applications. It has no
  Developer ID: the first launch is refused, then System Settings > Privacy &
  Security > Open Anyway opens it. Open a server window; it should load.
  (From the single-player release on: open Single player, log in as a new
  name, log out, and confirm a `.sav` appeared under
  `~/Library/Application Support/zanaris-kit/singleplayer/data/players/main/`.)
- Windows, in a VM or on a spare machine: run the installer, pass SmartScreen
  with More info > Run anyway, same checks. Saves live under
  `%APPDATA%\zanaris-kit\singleplayer\`.
- Linux, on Ubuntu: `chmod +x` the AppImage and run it, same checks. Saves
  live under `~/.config/zanaris-kit/singleplayer/`.

## 3. Tag

```sh
git tag v0.2.0
git push origin main v0.2.0
```

Wait for the Release workflow. It drafts a GitHub Release named after the tag
with the DMG, the installer and the AppImage attached.

## 4. Publish

Open the draft, write the notes, publish. The kit's update check reads
`releases/latest`, so from that moment every older build shows Help >
Update Available.

## If a build fails

Fix on a branch, dry-run again, then delete and re-push the tag only if the
draft was never published. A published release is never rebuilt: bump the
version and release again.
