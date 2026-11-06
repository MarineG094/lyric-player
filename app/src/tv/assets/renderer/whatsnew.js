/* What's new: shown once, the first time a newer version is opened. Newest entry first.
   To announce an update, add an entry at the top with the next id. `desktop: true` items are only shown on Windows and Linux. */
window.__whatsnew = [
  {
    id: 1,
    title: 'New in this version',
    items: [
      { text: 'Update and restart. On Windows (the .exe) and Linux (the AppImage), the Update button now replaces the app by itself and restarts. Nothing to download or move around.', desktop: true },
      { text: 'Launch at startup and Keep in tray. Two new switches in the Menu, both off until you turn them on. Keep in tray lets the music keep playing after you close the window.', desktop: true },
      { text: 'App language. Pick your language in the Menu. The buttons and messages switch over, and Arabic and Urdu read right to left.' },
      { text: 'Translate lyrics. Turn it on in the Menu to see a translation under each lyric line. It is off by default and keeps only a small saved copy.' },
      { text: 'This What\'s new note. It appears once after each update.' },
    ],
  },
];
