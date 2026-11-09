# How releases work

- **`main`** is what people get. Every push to `main` builds Windows, Linux and Android and publishes them as the `latest` releases.
- **`dev`** is where work happens. Pushing to `dev` only runs the tests (nothing is published).

## Test builds from `dev`
Every push to `dev` also builds test copies, published as **pre-releases** (not the normal downloads):
- **dev-windows**: `Lyric-Player-DEV-<version>.exe` (portable, no install).
- **dev-android**: `LyricPlayer-DEV.apk` (phone) and `LyricPlayer-TV-DEV.apk` (TV).

They have their own name and settings and install next to the real app, and they never show "Update available". Try them, then merge `dev` into `main` to release.

## Small update or hotfix
1. Work on `dev`, push, wait for the **Test (dev)** check to pass.
2. Merge `dev` into `main` (`git checkout main && git merge --ff-only dev && git push`, or a pull request on GitHub).

## Big update
Keep committing to `dev` for as long as it takes. Merge to `main` once, when it is ready, so people get one update instead of ten.

## Every release
Add a new entry at the top of `windows/renderer/whatsnew.js` (next id), run `python3 tools/assemble.py windows`, and commit the result.

## If a build shows a red mark
Open the Releases page first. If every platform shows the newest commit, it is only GitHub failing to start a job: run **Build APK** again by hand (Actions, Build APK, Run workflow).
