# Release checklist

A release is a tag. CI builds every platform from it and drafts a GitHub
Release; publishing the draft is the last step and is done by hand. The order:

## 0. Before you tag

- Every recipe in `engines/` pins a published build: its `artifact` is not
  `null`. A line with none is listed in the kit and cannot be downloaded, and
  a packaged kit runs no other engine — single player would have nothing to
  play. `npm test` fails a recipe whose tag does not match its commits and
  patches; a null artifact it allows, so look. Moving a build is below.
- Bump `version` in `package.json`. The tag must be `v` followed by exactly
  that version; the workflow refuses anything else.
- Commit. `git status` clean.

## 1. Dry run

Actions > Release > Run workflow, on the branch you are about to tag. It
typechecks, tests and packages on all three runners without publishing.
Download the three artifacts from the run.

## 2. Try each artifact on a clean profile

The app carries no engine: the first single-player window downloads one. So
each check below also checks the download, from this repository's releases,
against the pins the artifact was built with.

- macOS, on this Mac: mount the DMG, drag the app to Applications. It has no
  Developer ID: the first launch is refused, then System Settings > Privacy &
  Security > Open Anyway opens it. Open a server window; it should load.
  Then File > New Window For > Single player: the window says the world is not
  downloaded; press Download, watch it count up, and wait for the login
  screen. Log in as a new name, log out, and confirm the `.sav` appeared under
  `~/Library/Application Support/zanaris-kit/singleplayer/worlds/274/data/players/main/`.
  **Look for other characters.** A world with no game map logs in and plays
  exactly like a populated one, minus every NPC, ground item and door; 0.1.0
  shipped that way. The tutorial guide should be standing in front of you, and
  `world.log` should carry `Loading game map` and `N/… static NPCs added`.
  Turn Cheats on in the Single player tool, accept the restart, log in again
  and confirm `::tele 0,50,50,22,18` moves the character to 3222, 3218. The
  engine wants one comma-separated argument, `level,mapx,mapz,localx,localz`;
  a space-separated pair parses as one coordinate and silently does nothing.
  Then in Builds, Use each other line: it downloads, the world restarts on it,
  the strip names its revision, and Characters starts empty. Log in once on
  each. Switch back and your first character is there.
- Windows, in a VM or on a spare machine: run the installer, pass SmartScreen
  with More info > Run anyway, same checks. Saves live under
  `%APPDATA%\zanaris-kit\singleplayer\worlds\<rev>\`.
- Linux, on Ubuntu: `chmod +x` the AppImage and run it, same checks. Saves
  live under `~/.config/zanaris-kit/singleplayer/worlds/<rev>/`.

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

## Moving a build

A build line moves in one pull request, and reaches players in the next
release. Run anything that talks to GitHub as the project's account:
`GH_TOKEN=$(gh auth token -u Zanaris274)`.

1. In `engines/<id>.json`, set both commits to the upstream heads to ship — the
   head of that revision's branch in `LostCityRS/Engine-TS` and
   `LostCityRS/Content` — and set `artifact` to `null`. Both must be on the
   public repositories, or CI cannot fetch them:

   ```sh
   git ls-remote https://github.com/LostCityRS/Engine-TS.git | grep "$(node -p "require('./engines/lostcity-274.json').engine.commit")"
   git ls-remote https://github.com/LostCityRS/Content.git   | grep "$(node -p "require('./engines/lostcity-274.json').content.commit")"
   ```
2. `npm run stage:engine -- <id>` here first. It stops on a patch that no longer
   fits, and its boot check stops on an engine that took the patch but did not
   behave — a world that answers on a routable address, refuses `POST
   /shutdown`, or loads no map. Delete a patch upstream has merged rather than
   carrying it twice; every recipe naming that directory moves with it.
3. Open the pull request. The Engines workflow stages every recipe on it.
4. Actions > Engines > Run workflow, on the pull request's branch, with the
   recipe's id. It stages the recipe again and publishes the archive as a
   prerelease under a tag naming both commits and the patch set. A tag that
   exists already is refused: a published build is never replaced.
5. `npm run pin:engine -- <id>` writes GitHub's size and digest for it into the
   recipe. Commit that, let CI go green, merge.
6. Players get it with the next kit release. Until they update, their kit
   runs the build it pinned, which stays published.

A new line is the same, starting from a new `engines/<id>.json`: an id of lower
case, digits and dashes, a name, the revision, and a note if players should
read one before choosing it.
