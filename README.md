<div align="center">

# 🎵 Lyric Player for Android

**Your YouTube Music playlists, with lyrics that scroll in time. Free, on your phone and in your car.**

[![Build APK](https://github.com/NaqibC/lyric-player-android/actions/workflows/build.yml/badge.svg)](https://github.com/NaqibC/lyric-player-android/actions/workflows/build.yml)
![Android 8.0+](https://img.shields.io/badge/Android-8.0%2B-3ddc84)
![Android Auto](https://img.shields.io/badge/Android%20Auto-media%20app-4285f4)

[**⬇ Download the APK**](https://github.com/NaqibC/lyric-player-android/releases/tag/latest)

</div>

---

## ✨ What you get

| | |
|---|---|
| 🎤 **Synced lyrics** | The line being sung grows and glows. Tap a line to jump there. |
| 🖼 **Album art + colours** | The whole screen takes on the colours of the cover. |
| 📀 **Playlists, albums, single songs** | Paste any YouTube Music link. |
| 🔀 **Shuffle & repeat** | Real shuffle: no repeats until every song has played. |
| 🔍 **Four lyric sources** | LRCLIB, then NetEase, then lyrics.ovh, plus Quran text for recitations. |
| 📖 **Quran recitations** | Arabic with an English translation (Al-Quran Cloud). |
| 🚫 **Ad block** | Skips and mutes YouTube Music ads. |
| 🚗 **Android Auto** | Play, pause, next, previous, shuffle, repeat, and the current lyric line on the car screen. |
| 🔒 **Background playback** | Keeps playing with the screen off, with lock-screen controls. |
| ▶️ **Picks up where you left off** | Same song, same spot, same settings. |

---

## 📲 Install

1. Open the [**latest release**](https://github.com/NaqibC/lyric-player-android/releases/tag/latest) on your phone (log in to GitHub, the repo is private).
2. Download **`LyricPlayer.apk`**.
3. Open it and allow **Install unknown apps** for your browser when asked.
4. Open **Lyric Player**, allow notifications, and paste a link.

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

## 🧭 Using it

| Do this | To get this |
|---|---|
| Paste a link in **Change music** | Plays a playlist, album or song. Playlists must be **Public** or **Unlisted**. |
| Tap **YouTube Music** | Shows the real site (accept cookies, sign in). Tap **Back to lyrics** to return. |
| **Add lyrics** | Paste your own. Plain text works; `[00:12.50] line` timestamps make it scroll. |
| **Auto lyrics** | Looks up lyrics online when a song has none. |
| **Ad block** | On by default. |
| **Cover filter** | Blurs explicit covers. |
| **Album: right / left** | Swaps sides (landscape). |
| **Diagnose** | Copies a troubleshooting report to paste into a message. |

Your phone's volume buttons control the volume.

---

## 🛠 How it works

Two web views sit in one app. The **player screen** (lyrics, controls, shuffle logic) is the same code as the Windows version. Behind it, a hidden **YouTube Music page** does the actual playback. A small Kotlin layer keeps the music alive in the background and presents it to Android Auto as a media session.

```
 Player screen  ──reads/controls──▶  YouTube Music page (plays the audio)
       │
       └──▶ Kotlin service ──▶ notification · lock screen · Android Auto
```

The player code is copied from the desktop app by `tools/assemble.py`, so both apps behave the same.

---

## 🏗 Build it yourself

Every push to `main` builds the APK on GitHub Actions and publishes it as the **latest** release. No local Android setup needed. To rebuild the web assets from the desktop app:

```bash
python3 tools/assemble.py /path/to/lyric-player
```

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

No account, no tracking, nothing sent to us. Lyric lookups send only the **song title, artist and length** to the lyric services. Settings and lyrics stay on your phone.

---

<div align="center">

Made for personal use. Not affiliated with YouTube or Google.

</div>
