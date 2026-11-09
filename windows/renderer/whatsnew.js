/* What's new: shown once, the first time a newer version is opened. Newest entry first.
   To announce an update, add an entry at the top with the next id. `desktop: true` items are only shown on Windows and Linux, `mobile: true` items only on the phone and TV. */
window.__whatsnew = [
  {
    id: 33,
    title: 'Import: songs whose result has no artist',
    items: [
      { text: 'Some YouTube Music results (often the official video of a big song) come without an artist name. The importer now accepts one when the title is exact, it is not a remix, and the length matches the Spotify song, but only if no result names the right artist. Covers by other artists are still rejected.' },
    ],
  },
  {
    id: 32,
    title: 'Import: more ways to find a song',
    items: [
      { text: 'When a song with several artists isn\'t found, the importer now also searches the title alone and the main artist with the plain search, before giving up. The not-found list shows more of what came back.' },
    ],
  },
  {
    id: 31,
    title: 'Not-found songs now say why',
    items: [
      { text: 'When an imported playlist can\'t match a song, the list now shows what the search did find (or that nothing came back), so it is clear whether the song is missing or was rejected.' },
    ],
  },
  {
    id: 30,
    title: 'Fix: the artist, not the album name',
    items: [
      { text: 'Importing a playlist only matches the artist against the song\'s artist now, not its album title. An album called "Ambient Translations of Halsey" no longer counts as Halsey. Tap Update on a playlist that already has a wrong song.' },
    ],
  },
  {
    id: 29,
    title: 'Fix: the real song, not the remix',
    items: [
      { text: 'Importing a playlist no longer picks a remix, live, sped-up or other altered version when the playlist has the normal song. If only the altered version is found, the song is listed as not found instead. Tap Update on a playlist that already has one.' },
    ],
  },
  {
    id: 28,
    title: 'Fix: interludes, intros and outros',
    items: [
      { text: 'A track called "Faded (Interlude)", "Intro", "Outro", "Skit" or "Reprise" no longer gets the lyrics of the full song with the same name.' },
    ],
  },
  {
    id: 27,
    title: 'Fix: two songs with the same name',
    items: [
      { text: 'Downloaded lyrics are now saved with the artist in the file name, and a song only uses a saved file when the name really is that song. Before, "Demons" by one artist could show another artist\'s "Demons", and "Memories" could pick up "Dead Memories". Lyrics downloaded earlier under the title alone are looked up again the next time you play the song (the old files stay in the Lyrics folder). If a song still shows the wrong lyrics, tap "Wrong lyrics? Try another" or delete that file in the Lyrics folder.' },
    ],
  },
  {
    id: 26,
    title: 'Fix: lyrics from a different song',
    items: [
      { text: 'Lyrics are now only taken from a result with the same title and the same artist. Before, a different song that showed up in the lyrics search (like "Dead Memories" for "Memories") could be shown. If a song has no lyrics found, use Add lyrics.' },
    ],
  },
  {
    id: 25,
    title: 'Fix: fan uploads and clips no longer matched',
    items: [
      { text: 'Importing a playlist no longer picks a fan upload with the artist\'s name in its title, or a short clip, instead of the real song. The artist has to be the uploader\'s listed artist, and the length has to be close to the original. Tap Update on a playlist that already has a wrong song.' },
    ],
  },
  {
    id: 24,
    title: 'Fix: the Close button is back',
    items: [
      { text: 'The Play a playlist window always has a Close button now (and Esc closes it). It was missing when an imported playlist was playing.' },
    ],
  },
  {
    id: 23,
    title: 'Fix: wrong artist in imported playlists',
    items: [
      { text: 'Importing a playlist no longer picks a cover or another artist\'s version of a song. The artist has to match, so Avicii\'s "Wake Me Up" is no longer swapped for a song with the same name by someone else. If a playlist already has a wrong song, tap Update on it to match it again. A few songs may now show as "not found" instead of being the wrong track.' },
    ],
  },
  {
    id: 22,
    title: 'Better matching for imported playlists',
    items: [
      { text: 'Importing a Spotify, Deezer or SoundCloud playlist now looks for the real album track first (YouTube Music\'s Songs search, using the artist too), then tries again with a cleaned-up title. A music video is only used when there is no album track. Fewer songs should come back as "not found".' },
    ],
  },
  {
    id: 21,
    title: 'Fix: the way back from YouTube Music',
    items: [
      { text: 'While the YouTube Music page is open, a "Back to lyrics" button now sits in the top bar. Before, it was only in the Menu, which dropped down behind the page and could not be clicked. The What\'s new card also steps aside while you browse.' },
    ],
  },
  {
    id: 20,
    title: 'Fix: imported playlists play, shuffle and repeat properly',
    items: [
      { text: 'Play on an imported (Spotify, Deezer, SoundCloud) playlist now starts it right away, even if a song is already playing.' },
      { text: 'Shuffle now mixes the imported songs, and Repeat: playlist starts the playlist over when it ends.' },
      { text: 'When you reopen the app it picks up the imported playlist where you left it, at the same song and spot, instead of going back to an older YouTube playlist.' },
    ],
  },
  {
    id: 19,
    title: 'Fix: the mini player stays on top',
    items: [
      { text: 'The mini player no longer slips behind other windows and apps. It claims the top again whenever focus moves.', desktop: true },
    ],
  },
  {
    id: 18,
    title: 'Fix: the Play a playlist window fits on screen',
    items: [
      { text: 'After importing a playlist, a long queue used to push the window past the bottom and cut it off. The window now always fits, and the saved playlists and queue lists scroll inside it.' },
    ],
  },
  {
    id: 17,
    title: 'Fix: nasheeds no longer get Quran verses as lyrics',
    items: [
      { text: 'Songs by artists who also recite the Quran (for example "Ya Adheeman" by Ahmed Bukhatir) were sometimes given Quran verses as lyrics. The Quran text is now only used when the title says it is a recitation. If a song already has the wrong lyrics saved, press "Wrong lyrics? Try another".' },
    ],
  },
  {
    id: 16,
    title: 'Discord status',
    items: [
      { text: 'New Menu switch, "Discord status". When it is on, your Discord profile shows "Listening to Lyric Player" with the song, the artist and the album cover while the Discord app is open. Covers hidden by the cover filter are never sent. It is off until you turn it on.', desktop: true },
    ],
  },
  {
    id: 15,
    title: 'Phone: tidier sync and full screen buttons',
    items: [
      { text: 'The Sync buttons now line up in one even row in portrait.', mobile: true },
      { text: 'In full screen, the button sits centred above the play button in portrait, and in a bottom corner when the phone is sideways. Left-handed? Menu > "Fullscreen button" moves it to the left.', mobile: true },
    ],
  },
  {
    id: 14,
    title: 'Close question every time',
    items: [
      { text: 'Closing the window now asks whether to keep Lyric Player in the tray or quit, even when Keep in tray is switched on, so a forgotten setting never surprises you. Tick "Don\'t ask again" if you want your choice remembered.', desktop: true },
    ],
  },
  {
    id: 13,
    title: 'Closing the window, and full screen',
    items: [
      { text: 'Closing the window now asks whether to close Lyric Player for good or keep it running in the tray. Tick "Don\'t ask again" to remember your choice. Switching "Keep in tray" in the Menu brings the question back.', desktop: true },
      { text: 'In full screen, the cover and lyrics now sit in the middle of the screen while the controls are hidden, instead of leaving empty space at the bottom.', desktop: true },
    ],
  },
  {
    id: 12,
    title: 'Windows installer',
    items: [
      { text: 'Windows now has a setup program (Lyric-Player-Setup) with a short wizard: pick where to install, add a desktop shortcut, and start the app when it finishes. The portable .exe is still available. A copy installed this way updates itself from the Update button.', desktop: true },
    ],
  },
  {
    id: 11,
    title: 'TV lyrics edge fix',
    items: [
      { text: 'Fixed the top of the lyrics looking cut off on TV, and the dark band across the lyrics.', mobile: true },
    ],
  },
  {
    id: 10,
    title: 'Lighter cover filter',
    items: [
      { text: 'Lighter cover filter on every version (phone, TV, Windows and Linux): each cover is now checked only once and the result is remembered on your device. The filter no longer piles up checks when you skip songs, and if it can\'t start it waits 10 minutes before trying again instead of reloading every time.' },
      { text: 'On TV and phones, the first check now gets much longer to start up, so it stops failing on slower devices.', mobile: true },
    ],
  },
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
