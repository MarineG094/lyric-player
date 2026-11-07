<div align="center">

<img src="docs/logo.png" width="112" alt="Lyric Player logo">

# Lyric Player

**Your YouTube Music, with lyrics that scroll in time. Free, on Windows, Android, Android Auto and Google TV.**

[![Build](https://github.com/NaqibC/lyric-player/actions/workflows/build.yml/badge.svg)](https://github.com/NaqibC/lyric-player/actions/workflows/build.yml)
![Windows](https://img.shields.io/badge/Windows-portable%20.exe-0078d4)
![Linux](https://img.shields.io/badge/Linux-AppImage%20%2F%20.deb-fcc624)
![Android 8.0+](https://img.shields.io/badge/Android-8.0%2B-3ddc84)
![Android Auto](https://img.shields.io/badge/Android%20Auto-media%20app-4285f4)
![Google TV](https://img.shields.io/badge/Google%20TV-remote%20ready-ea4335)

[**⬇ Windows**](https://github.com/NaqibC/lyric-player/releases/tag/windows-latest) · [**⬇ Linux**](https://github.com/NaqibC/lyric-player/releases/tag/linux-latest) · [**⬇ Android + TV**](https://github.com/NaqibC/lyric-player/releases/tag/latest)

<img src="docs/windows-main.jpg" width="900" alt="Lyric Player on Windows: album cover on the left, synced lyrics on the right, controls along the bottom">

</div>

---

## ✨ What you get

| | |
|---|---|
| 🎤 **Synced lyrics** | The line being sung grows and glows. Click or tap a line to jump there. |
| 🖼 **Album art + colours** | The whole screen takes on the colours of the cover. |
| 🔍 **Search or paste** | Search YouTube Music for songs, albums and playlists, or paste any link. |
| 📥 **Bring your Spotify playlists** | Paste a Spotify, Deezer or SoundCloud playlist link: each song is matched on YouTube Music and queued, with a "found X of Y" report. |
| 💾 **Saved playlists** | Imported and YouTube Music playlists are remembered, so they open again without waiting. |
| 🪟 **Mini player (Windows)** | A small always-on-top pill with the cover, song and one rolling lyric line. |
| 🔀 **Shuffle & repeat** | Real shuffle: no repeats until every song has played. |
| 🌐 **Four lyric sources** | LRCLIB, then NetEase, then lyrics.ovh, plus Quran text for recitations. |
| 🖥️ **Startup and tray (Windows, Linux)** | Optional **Launch at startup** and **Keep in tray** switches in the Menu. Both are off until you turn them on. |
| 🔄 **Updates in place (Windows .exe, Linux AppImage)** | **Update available** downloads the new version, checks it against its published checksum, replaces the app and restarts. Phone and TV still ask you to confirm the install. |
| 📰 **What's new** | A short note shows once the first time you open an updated version (never on a fresh install). |
| 🌍 **App language** | Pick a language in the Menu (28 to choose from; Arabic, Urdu, Persian and Hebrew read right to left). Spanish, French, Arabic, Urdu and Bengali are bundled. The others are translated online once, then kept on the device (a few KB). Songs, artists and lyrics are never translated this way. Not on the TV app. |
| 🈯 **Translate lyrics** | Off by default. Pick a language in the Menu to show a translation under each lyric line. Saved translations are capped at about 1 MB (oldest dropped first); **Clear translations** deletes them. Not on the TV app. |
| 🔤 **English letters** | Songs in Hindi, Arabic, Korean and more can show in Latin letters. |
| ⏱ **Sync buttons** | Nudge timed lyrics earlier or later (−3s, −0.5s, +0.5s, +3s). Saved per song. |
| 📖 **Quran recitations** | Spelling-tolerant surah detection (Arabic titles too). Arabic with an English translation that follows the reciter ayah by ayah, using Quran.com timing (estimated for reciters it doesn't cover). |
| 🙈 **Cover filter** | Automatically hides explicit album covers (runs on the device). It isn't perfect, and on slower devices (TVs especially) it can fail to start. Covers then show normally, so use **Hide cover** to cover one manually. |
| 🚫 **Ad block** | Skips and mutes YouTube Music ads. |
| 🚗 **Android Auto** | Play, pause, next, previous, shuffle, repeat, and the current lyric line on the car screen. |
| 📺 **Google TV** | A separate app made for the remote, with full screen. |
| 🔒 **Background playback** | Keeps playing with the screen off, with lock-screen controls. |
| ▶️ **Picks up where you left off** | Same song, same spot, same settings. |

---

## ✅ What you need

| | Minimum | Recommended | Notes |
|---|---|---|---|
| 💻 **Windows** | Windows 10 (64-bit), 4 GB RAM, about 200 MB free space | Windows 10/11, 8 GB RAM | Portable `.exe`, no install. |
| 🐧 **Linux** | A 64-bit (x86_64) Debian or Ubuntu-based system such as Linux Mint, 4 GB RAM, about 200 MB free space | A current Mint or Ubuntu, 8 GB RAM | `.AppImage` (no install) or `.deb`. Made and tested on **Linux Mint**. Older systems may need `sudo apt install libfuse2` for the AppImage. |
| 📲 **Android phone** | Android 8.0 (API 26) or newer, 3 GB RAM | Android 10+, 4 GB RAM | Keep **Android System WebView** (or Chrome) up to date from the Play Store. |
| 📺 **Google TV / Android TV** | Android 8.0 or newer, 1.5 GB RAM, 1080p | A 4K stick or box with 2 GB+ RAM | Tested on the **onn. Full HD (1080p) streaming device** (1.5 GB RAM): it plays properly, with some lag. |
| 🌐 **All** | An internet connection | | Playback, search and lyrics all come from the internet. |

> **On low-end hardware it may be slow and laggy, but it still plays properly.** The app runs YouTube Music's own web page behind the lyrics screen, which is heavy for small chips. On a weak device expect a pause of a few seconds when a song changes or you skip, and the lyrics may appear a moment after the song starts. Once a song is playing it is smooth, and the music itself is not affected.
>
> **If it feels slow:** restart the device, close other apps, keep Android System WebView updated, and on TV switch off apps you don't use (Settings → Apps). On TV the **Cover filter** starts **off** to save memory; you can turn it on with the button. The automatic check can miss a cover or fail to start on slower devices, so you may sometimes need to press **Hide cover** yourself.

---

## 💻 Windows

1. Open the [**windows-latest release**](https://github.com/NaqibC/lyric-player/releases/tag/windows-latest).
2. Download **`Lyric-Player-<version>.exe`** and double-click it. It is portable: no install.
3. Click **Change music**, then search or paste a link.

**Shortcuts:** `Space` play/pause · `F11` full screen · `Ctrl+→ / ←` next / previous.

**Mini player:** click **Mini player** at the top for a small always-on-top pill with the cover, song, one rolling lyric line, and controls that appear when you hover.

<img src="docs/windows-mini.png" width="444" alt="The Lyric Player mini player on Windows">

---

## 🐧 Linux

Made and tested on **Linux Mint**; other Debian/Ubuntu-based systems should work the same.

**AppImage (recommended: it updates itself)**

1. Open the [**linux-latest release**](https://github.com/NaqibC/lyric-player/releases/tag/linux-latest) and download **`Lyric-Player-<version>.AppImage`** into a folder you can write to, such as Downloads.
2. Make it runnable and start it:
   ```
   cd ~/Downloads
   chmod +x Lyric-Player-*.AppImage
   ./Lyric-Player-*.AppImage
   ```
   After that you can also just double-click it. If it won't start on a newer Ubuntu/Mint, add `--no-sandbox`. Older systems may need `sudo apt install libfuse2`.

**`.deb` (installs into the app menu)**

Download **`Lyric-Player-<version>.deb`** and install it: double-click it, or run `sudo apt install ./Lyric-Player-*.deb`. Then open **Lyric Player** from the menu.

In either case, click **Change music**, then search or paste a link.

Everything in the Windows version is included, including the mini player. It needs a desktop with window transparency (a compositor) to look right. The **Update available** button replaces the AppImage in place; with the `.deb` it downloads the new file for you to install.

---

## 📲 Android

1. Open the [**latest release**](https://github.com/NaqibC/lyric-player/releases/tag/latest) on your phone.
2. Download **`LyricPlayer.apk`**.
3. Open it and allow **Install unknown apps** for your browser when asked.
4. Open **Lyric Player**, allow notifications, then search or paste a link.

The **Full screen** button hides the system bars and the top bar. Tap the screen to bring the controls back; Back leaves full screen.

<img src="docs/phone-main.jpg" width="300" alt="Lyric Player on an Android phone: cover, synced lyrics, sync buttons and controls">

> Updating? When a newer build is published, an **Update available** button appears at the top (or use **Menu > Check for updates**). It downloads the new APK; open it to install over the old one. Your settings and saved lyrics stay.

---

## 🚗 Android Auto

Lyric Player is a sideloaded app, so Android Auto hides it until you allow that:

1. Open **Android Auto settings** on your phone.
2. Tap the **Version** row about **10 times** to turn on developer mode.
3. Open the ⋮ menu → **Developer settings** → turn on **Unknown sources**.
4. Connect to the car. Lyric Player shows in the media apps.

**On the car screen:** the line being sung takes the big title slot; the song and artist move to the line beneath. Shuffle and repeat are extra buttons on the now-playing screen (some cars tuck them in an overflow menu).

<img src="docs/android-auto.jpg" width="560" alt="Lyric Player on the Android Auto screen: the current lyric line as the title, with the song and artist beneath">

> **Album cover:** on the car screen the cover doesn't appear until about **50 seconds** into each song, because the cover filter is checking it first.

> Lyrics appear only for songs with **timed** lyrics. A full scrolling lyrics page on the car display would need a separate car-app screen and Google's approval, so it isn't included.

---

## 📺 Google TV / Android TV

A separate app, **`LyricPlayer-TV.apk`** (installs as *Lyric Player TV*, next to the phone app). It is tuned for small TV sticks: on each song change it works one step at a time (cover, then lyrics, then the song plays), so there is a short pause before the music starts.

<img src="docs/tv.jpg" width="640" alt="Lyric Player on a Google TV: cover and song on the left, synced lyrics on the right, and what plays next along the bottom">

- **Remote:** arrows move between buttons, OK presses, left/right on the progress bar skips 10 s, and the media keys (play/pause, next, previous, rewind, fast-forward) work.
- **No typing:** the "choose music" card shows an address like `http://192.168.1.20:8080`. Open it on your phone (same Wi-Fi), paste a link and press **Play**.
- **Install:** put the APK on a USB stick or use the **Downloader** app with a link to it, then allow unknown apps. Or use `adb install LyricPlayer-TV.apk`.

---

## 🧭 Using it

| Do this | To get this |
|---|---|
| Search or paste a link in **Change music** | Plays a song, album or playlist. Playlists must be **Public** or **Unlisted**. |
| Paste a **Spotify, Deezer or SoundCloud** playlist link in **Change music** | Each song is matched on YouTube Music and queued. You're told how many were found and which weren't. Playlists must be public; SoundCloud is best-effort. Up to 200 songs are imported. |
| **Saved playlists** (in **Change music**) | Imported and YouTube Music playlists you've played. **Play**, **+ Queue**, **Update** (re-import) or ✕. Imported ones open instantly. |
| Tap **YouTube Music** | Shows the real site (accept cookies, sign in). Tap **Back to lyrics** to return. |
| **Add lyrics** | Paste your own. Plain text works; `[00:12.50] line` timestamps make it scroll. |
| **Auto lyrics** | Looks up lyrics online when a song has none. |
| **English letters** | Shows lyrics in other scripts in Latin letters. |
| **Language** / **Translate lyrics** | Language of the app's buttons and messages, and an optional translation under each lyric line (see the note below). |
| **Launch at startup** / **Keep in tray** (Windows and Linux) | Both off by default. Keep in tray lets the music keep playing after you close the window; quit from the tray icon. |
| **Sync** (under the lyrics) | Shifts timed lyrics earlier or later if they drift. |
| **Ad block** | On by default. |
| **Cover filter** | Blurs explicit covers. |
| **Album: right / left** | Swaps sides (landscape). |
| **Diagnose** | Copies a troubleshooting report to paste into a message. |
| **Update available** (top) | Shows up when a newer build is published. Tap it to download it, then install over the old one (phone/TV) or replace the old file (Windows). The app checks quietly a few seconds after it starts, at most every 6 hours. |

Your phone's volume buttons control the volume.

---

## 🛠 How it works

Two web views sit in one app. The **player screen** (lyrics, controls, shuffle logic) is the same code as the Windows version (`windows/`). Behind it, a hidden **YouTube Music page** does the actual playback. A small Kotlin layer keeps the music alive in the background and presents it to Android Auto as a media session.

```
 Player screen  ──reads/controls──▶  YouTube Music page (plays the audio)
       │
       └──▶ Kotlin service ──▶ notification · lock screen · Android Auto
```

The player code is copied from the Windows app (the `windows/` folder) by `tools/assemble.py`, so both apps behave the same.

---

## 🏗 Build it yourself

Every push to `main` builds everything on GitHub Actions: the Android and TV APKs go to the **latest** release, and the Windows `.exe` goes to **windows-latest**. No local setup needed. To rebuild the web assets from the desktop app:

```bash
python3 tools/assemble.py windows
```

The Windows app lives in `windows/` (Electron). Run it with `npm install` then `npm start` inside that folder, or package it with `Build-EXE.bat`. Tests: `npm test`.

---

## 🩺 Troubleshooting

| Problem | Try this |
|---|---|
| Stuck on *"Taking longer than expected"* | Tap **YouTube Music**, accept any cookie or consent page, go back and reload the link. |
| Playlist won't load | It must be **Public** or **Unlisted**, not Private. |
| No lyrics found | Tap **Add lyrics** and paste them. They're saved for next time. |
| Not showing in Android Auto | Turn on developer mode and **Unknown sources** (see above). |
| Music stops in the background | Set the app to **Unrestricted** battery use in Android settings. |
| Something else | Tap **Diagnose** and paste the result. |

---

## 🔐 Privacy

No account, no tracking, nothing sent to us. Lyric lookups send only the **song title, artist and length** to the lyric services (LRCLIB, NetEase, lyrics.ovh). Settings and lyrics stay on your device. Quran lookups send only the surah number and reciter to Al-Quran Cloud and Quran.com.

---

<div align="center">

Made for personal use. Not affiliated with YouTube or Google.

</div>

---

## Privacy note on translation

Translating lyrics, or showing the app in a language that isn't bundled, sends the text to be translated (lyric lines or the app's own button labels, never your account or listening history) to the free Google Translate web endpoint, with MyMemory as a backup. Both are off until you choose a language. Nothing is sent while you use English with Translate lyrics off. The endpoint is unofficial, so it can change or rate-limit without notice; if it does, the text simply stays in the original language.
