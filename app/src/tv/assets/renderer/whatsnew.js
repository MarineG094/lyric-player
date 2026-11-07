/* What's new: shown once, the first time a newer version is opened. Newest entry first.
   To announce an update, add an entry at the top with the next id. `desktop: true` items are only shown on Windows and Linux, `mobile: true` items only on the phone and TV. */
window.__whatsnew = [
  {
    id: 9,
    title: 'Smoother on Google TV',
    items: [
      { text: 'Lighter drawing on TV: the lyrics scroll and change lines with less work for the TV chip, with the same look.', mobile: true },
    ],
  },
  {
    id: 8,
    title: 'Home screen widgets',
    items: [
      { text: 'Two widgets for your phone\'s home screen: a small one with the song and play, previous and next buttons, and a larger one that also shows the current lyric line. Long-press your home screen, tap Widgets, then find Lyric Player.', mobile: true },
    ],
  },
  {
    id: 7,
    title: 'No more "active app" when paused',
    items: [
      { text: 'After music has been paused for 5 minutes, the app no longer shows up under Android\'s Active apps. Pressing play brings it back.', mobile: true },
    ],
  },
  {
    id: 6,
    title: 'Fix for freezing after long playback',
    items: [
      { text: 'If Android shuts down the hidden YouTube Music page after a long time in the background, the app now rebuilds it instead of freezing or crashing. Music may need one tap to start again.', mobile: true },
    ],
  },
  {
    id: 5,
    title: 'Closing the app',
    items: [
      { text: 'Swiping the app away from your recent apps now closes it completely: the music stops, the notification goes, and the next time you open it starts fresh.', mobile: true },
    ],
  },
  {
    id: 4,
    title: 'Up next moved',
    items: [
      { text: 'In landscape on the phone, the Up next strip now sits under the album and title on the left, so it no longer covers the Sync buttons.', mobile: true },
    ],
  },
  {
    id: 3,
    title: 'What\'s new button',
    items: [
      { text: 'A What\'s new button in the Menu. It reopens the note for the latest update any time, showing only what changed in it.' },
    ],
  },
  {
    id: 2,
    title: 'Battery and version numbers',
    items: [
      { text: 'Lower battery use on phones. The hidden YouTube Music page behind the player is now drawn small and asks for the smallest video, since only the sound matters.', mobile: true },
      { text: 'Real version numbers. The version now counts every build (1.0.<build number>) instead of always saying 1.0.0. You can see it at the bottom of the Menu.' },
    ],
  },
  {
    id: 1,
    title: 'Updates, languages and translation',
    items: [
      { text: 'Update and restart. On Windows (the .exe) and Linux (the AppImage), the Update button now replaces the app by itself and restarts. Nothing to download or move around.', desktop: true },
      { text: 'Launch at startup and Keep in tray. Two new switches in the Menu, both off until you turn them on. Keep in tray lets the music keep playing after you close the window.', desktop: true },
      { text: 'App language. Pick your language in the Menu. The buttons and messages switch over, and Arabic and Urdu read right to left.' },
      { text: 'Translate lyrics. Turn it on in the Menu to see a translation under each lyric line. It is off by default and keeps only a small saved copy.' },
      { text: 'This What\'s new note. It appears once after each update.' },
    ],
  },
];
