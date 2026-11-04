<div align="center">

# 🎵 Lyric Player

**Your YouTube Music, with lyrics that scroll in time. Free, on Windows, Android, Android Auto and Google TV.**

[![Build](https://github.com/NaqibC/lyric-player/actions/workflows/build.yml/badge.svg)](https://github.com/NaqibC/lyric-player/actions/workflows/build.yml)
![Windows](https://img.shields.io/badge/Windows-portable%20.exe-0078d4)
![Android 8.0+](https://img.shields.io/badge/Android-8.0%2B-3ddc84)
![Android Auto](https://img.shields.io/badge/Android%20Auto-media%20app-4285f4)
![Google TV](https://img.shields.io/badge/Google%20TV-remote%20ready-ea4335)

[**⬇ Windows**](https://github.com/NaqibC/lyric-player/releases/tag/windows-latest) · [**⬇ Android + TV**](https://github.com/NaqibC/lyric-player/releases/tag/latest)

</div>

---

## ✨ What you get

| | |
|---|---|
| 🎤 **Synced lyrics** | The line being sung grows and glows. Click or tap a line to jump there. |
| 🖼 **Album art + colours** | The whole screen takes on the colours of the cover. |
| 🔍 **Search or paste** | Search YouTube Music for songs, albums and playlists, or paste any link. |
| 🔀 **Shuffle & repeat** | Real shuffle: no repeats until every song has played. |
| 🌐 **Four lyric sources** | LRCLIB, then NetEase, then lyrics.ovh, plus Quran text for recitations. |
| 🔤 **English letters** | Songs in Hindi, Arabic, Korean and more can show in Latin letters. |
| ⏱ **Sync buttons** | Nudge timed lyrics earlier or later (−3s, −0.5s, +0.5s, +3s). Saved per song. |
| 📖 **Quran recitations** | Spelling-tolerant surah detection (Arabic titles too). Arabic with an English translation that follows the reciter ayah by ayah, using Quran.com timing (estimated for reciters it doesn't cover). |
| 🙈 **Cover filter** | Automatically hides explicit album covers (runs on the device). |
| 🚫 **Ad block** | Skips and mutes YouTube Music ads. |
| 🚗 **Android Auto** | Play, pause, next, previous, shuffle, repeat, and the current lyric line on the car screen. |
| 📺 **Google TV** | A separate app made for the remote, with full screen. |
| 🔒 **Background playback** | Keeps playing with the screen off, with lock-screen controls. |
| ▶️ **Picks up where you left off** | Same song, same spot, same settings. |

---

## 💻 Windows

1. Open the [**windows-latest release**](https://github.com/NaqibC/lyric-player/releases/tag/windows-latest) (log in to GitHub, the repo is private).
2. Download **`Lyric-Player-1.0.0.exe`** and double-click it. It is portable: no install.
3. Click **Change music**, then search or paste a link.

**Shortcuts:** `Space` play/pause · `F11` full screen · `Ctrl+→ / ←` next / previous.

---

## 📲 Android

1. Open the [**latest release**](https://github.com/NaqibC/lyric-player/releases/tag/latest) on your phone (log in to GitHub, the repo is private).
2. Download **`LyricPlayer.apk`**.
3. Open it and allow **Install unknown apps** for your browser when asked.
4. Open **Lyric Player**, allow notifications, then search or paste a link.

The **Full screen** button hides the system bars and the top bar. Tap the screen to bring the controls back; Back leaves full screen.

> Updating? Install the new APK over the old one. Your settings and saved lyrics stay.

---

## 🚗 Android Auto

Lyric Player is a sideloaded app, so Android Auto hides it until you allow that:

1. Open **Android Auto settings** on your phone.
2. Tap the **Version** row about **10 times** to turn on developer mode.
3. Open the ⋮ menu → **Developer settings** → turn on **Unknown sources**.
4. Connect to the car. Lyric Player shows in the media apps.

**On the car screen:** the line being sung takes the big title slot; the song and artist move to the line beneath. Shuffle and repeat are extra buttons on the now-playing screen (some cars tuck them in an overflow menu).

> Lyrics appear only for songs with **timed** lyrics. A full scrolling lyrics page on the car display would need a separate car-app screen and Google's approval, so it isn't included.

---

## 📺 Google TV / Android TV

A separate app, **`LyricPlayer-TV.apk`** (installs as *Lyric Player TV*, next to the phone app).

- **Remote:** arrows move between buttons, OK presses, left/right on the progress bar skips 10 s, and the media keys (play/pause, next, previous, rewind, fast-forward) work.
- **No typing:** the "choose music" card shows an address like `http://192.168.1.20:8080`. Open it on your phone (same Wi-Fi), paste a link and press **Play**.
- **Install:** put the APK on a USB stick or use the **Downloader** app with a link to it, then allow unknown apps. Or use `adb install LyricPlayer-TV.apk`.

---

## 🧭 Using it

| Do this | To get this |
|---|---|
| Search or paste a link in **Change music** | Plays a song, album or playlist. Playlists must be **Public** or **Unlisted**. |
| Tap **YouTube Music** | Shows the real site (accept cookies, sign in). Tap **Back to lyrics** to return. |
| **Add lyrics** | Paste your own. Plain text works; `[00:12.50] line` timestamps make it scroll. |
| **Auto lyrics** | Looks up lyrics online when a song has none. |
| **English letters** | Shows lyrics in other scripts in Latin letters. |
| **Sync** (under the lyrics) | Shifts timed lyrics earlier or later if they drift. |
| **Ad block** | On by default. |
| **Cover filter** | Blurs explicit covers. |
| **Album: right / left** | Swaps sides (landscape). |
| **Diagnose** | Copies a troubleshooting report to paste into a message. |

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
