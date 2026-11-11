# How releases work

- **`main`** is what people get. Every push to `main` builds Windows, Linux and Android and publishes them as the `latest` releases.
- **`dev`** is where work happens. Pushing to `dev` only runs the tests (nothing is published).

## Test builds from `dev`
Every push to `dev` also builds test copies, published as **draft releases**. A draft is visible only to you while signed in to GitHub (Releases page, top of the list, marked Draft); nobody else can see or download it:
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


## Announcements

`announcements.json` in the repo root (main branch) is read by the app a few seconds after start. Format:

```json
{ "items": [ { "id": 1, "title": "Short title", "text": "One or two sentences, plain text.", "date": "2026-11-11", "until": "2026-12-01" } ] }
```

- `id` must be a number and go up with each new announcement; people who dismissed id N only see ids above N.
- `until` (optional) hides it after that date. At most the 5 newest are shown. No links or formatting.
- Change the file on `main` and it goes live within minutes, with no new release. An empty list (`"items": []`) shows nothing.
