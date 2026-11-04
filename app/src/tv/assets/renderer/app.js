/* Lyric Player renderer: YouTube IFrame playback + lyrics UI. */
(function () {
  'use strict';

  const L = window.Lyrics;
  const $ = (sel) => document.querySelector(sel);

  const els = {
    app: $('#app'),
    lyrics: $('#lyrics'),
    lines: $('#lyricsLines'),
    btnEdit: $('#btnEdit'),
    editor: $('#editor'),
    editorText: $('#editorText'),
    editorHint: $('#editorHint'),
    btnSave: $('#btnSave'),
    btnCancel: $('#btnCancel'),
    title: $('#title'),
    artist: $('#artist'),
    btnBrowse: $('#btnBrowse'),
    btnFull: $('#btnFull'),
    btnAds: $('#btnAds'),
    btnCover: $('#btnCover'),
    albumBox: $('#albumBox'),
    coverVeil: $('#coverVeil'),
    btnCoverToggle: $('#btnCoverToggle'),
    stage: $('#stage'),
    soloNote: $('#soloNote'),
    btnAddSolo: $('#btnAddSolo'),
    artImg: $('#artImg'),
    artEmpty: $('#artEmpty'),
    seek: $('#seek'),
    cur: $('#cur'),
    dur: $('#dur'),
    vol: $('#vol'),
    btnShuffle: $('#btnShuffle'),
    btnPrev: $('#btnPrev'),
    btnPlay: $('#btnPlay'),
    btnNext: $('#btnNext'),
    btnRepeat: $('#btnRepeat'),
    repeatOne: $('#repeatOne'),
    iconPlay: $('#iconPlay'),
    iconPause: $('#iconPause'),
    overlay: $('#overlay'),
    overlayMsg: $('#overlayMsg'),
    urlInput: $('#urlInput'),
    btnLoad: $('#btnLoad'),
    btnCloseOverlay: $('#btnCloseOverlay'),
    btnPlaylist: $('#btnPlaylist'),
    btnFolder: $('#btnFolder'),
    btnAuto: $('#btnAuto'),
    btnSide: $('#btnSide'),
    dragVeil: $('#dragVeil'),
    toast: $('#toast'),
    status: $('#status'),
  };

  const state = {
    playlistId: null,
    shuffle: false,
    repeat: 'off', // 'off' | 'all' | 'one'
    lyricFiles: [],
    currentVideoId: null,
    currentTitle: '',
    currentArtist: '',
    lyricsFile: null,
    lyricsRaw: '',
    lyricsData: null,
    activeIdx: -1,
    seeking: false,
    watchdog: null,
    snap: null,
    artUrl: '',
    holdFirst: false,
    albumSide: 'right',
    resume: null,
    savedAt: 0,
    pendingKey: null,
    pendingCount: 0,
    fullscreen: false,
    adBlock: true,
    coverFilter: true,
    coverOverrides: {},
    coverKey: '',
    coverMode: 'shown',
    adShown: false,
    idleTimer: null,
    gotMedia: false,
    volume: 80,
    autoFetch: true,
    lyricsStatus: 'idle', // 'idle' | 'searching' | 'notfound' | 'instrumental' | 'error'
    notFound: new Set(), // video ids already looked up online without luck this session
    fetching: new Set(), // video ids with a lookup in flight
  };

  /* ---------- small helpers ---------- */

  let toastTimer = null;
  function toast(message, ms = 3500) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (els.toast.hidden = true), ms);
  }

  function setRangeFill(input) {
    const max = parseFloat(input.max) || 0;
    const pct = max > 0 ? (parseFloat(input.value) / max) * 100 : 0;
    input.style.setProperty('--fill', `${Math.min(100, Math.max(0, pct))}%`);
  }

  function cleanArtist(name) {
    return String(name || '').replace(/\s*-\s*Topic$/i, '').trim();
  }

  /* ---------- overlay (drop / paste a playlist) ---------- */

  function showOverlay(message) {
    els.overlay.hidden = false;
    els.btnCloseOverlay.hidden = !state.playlistId;
    if (message) {
      els.overlayMsg.textContent = message;
      els.overlayMsg.hidden = false;
    } else {
      els.overlayMsg.hidden = true;
    }
    setTimeout(() => els.urlInput.focus(), 0);
  }

  function hideOverlay() {
    els.overlay.hidden = true;
    els.overlayMsg.hidden = true;
  }

  function submitUrl(text) {
    const src = L.extractSource(text);
    if (!src) {
      showOverlay("That doesn't look like a YouTube Music link. Paste a playlist, album or song link.");
      return;
    }
    els.urlInput.value = '';
    loadSource(src);
  }

  // Playlist, album or single song: whatever the link points at.
  function loadSource(src) {
    if (src.kind === 'song') loadSong(src.id, true);
    else if (src.kind === 'album') loadAlbum(src.id);
    else loadPlaylist(src.id, true, src.video);
  }

  /* ---------- status line ---------- */

  function setStatus(text, kind) {
    els.status.textContent = text || '';
    els.status.dataset.kind = kind || '';
    els.status.hidden = !text;
  }

  /* ---------- player bridge ----------
     Songs play in the real YouTube Music site, which lives in a hidden view
     managed by the app. We read what's playing from it and send it commands. */

  const P = window.api.player;
  let browsing = false;

  function setBrowse(show) {
    browsing = !!show;
    const top = document.querySelector('.topbar').getBoundingClientRect().bottom + 8;
    P.browse(browsing, top);
    els.btnBrowse.textContent = browsing ? 'Back to lyrics' : 'YouTube Music';
    els.btnBrowse.classList.toggle('on', browsing);
  }

  function startWatchdog() {
    clearTimeout(state.watchdog);
    state.watchdog = setTimeout(() => {
      setStatus('Taking longer than expected. Click "YouTube Music" at the top to see the page. It may be asking you to accept cookies or confirm something.', 'error');
    }, 25000);
  }

  function stopWatchdog() { clearTimeout(state.watchdog); }

  function loadPlaylist(id, userInitiated, startVideo) {
    state.playlistId = id;
    state.holdFirst = !userInitiated;
    state.currentVideoId = null;
    state.currentTitle = '';
    state.gotMedia = false;
    hideOverlay();
    const resume = state.resume && !userInitiated ? state.resume : null;
    if (userInitiated) { state.resume = null; window.api.setSettings({ lastPlaylist: id, lastSong: '', lastVideoId: '', lastPos: 0 }); }
    else window.api.setSettings({ lastPlaylist: id });
    setBrowse(false);
    setStatus('Opening your playlist in YouTube Music…', 'info');
    startWatchdog();
    P.open(id, resume ? resume.videoId : startVideo);
  }

  // One song on its own.
  function loadSong(videoId, userInitiated) {
    state.playlistId = videoId;
    state.holdFirst = !userInitiated;
    state.currentVideoId = null;
    state.currentTitle = '';
    state.gotMedia = false;
    hideOverlay();
    if (userInitiated) { state.resume = null; window.api.setSettings({ lastPlaylist: '', lastSong: videoId, lastVideoId: '', lastPos: 0 }); }
    setBrowse(false);
    setStatus('Opening the song in YouTube Music…', 'info');
    startWatchdog();
    P.openSong(videoId);
  }

  // An album page: find its playlist, then play that.
  async function loadAlbum(browseId) {
    hideOverlay();
    setBrowse(false);
    setStatus('Looking up the album…', 'info');
    startWatchdog();
    const listId = await P.resolveAlbum(browseId);
    if (!listId) {
      stopWatchdog();
      setStatus('');
      showOverlay("Couldn't open that album. Try the album's playlist link instead (open the album, then Share).");
      return;
    }
    loadPlaylist(listId, true);
  }

  function onPlayerState(s) {
    if (!s) return;
    state.snap = s;
    if (!s.hasMedia) return;

    // An ad is playing: don't treat it as a song. (With ad block on it is muted and skipped by the app.)
    if (s.ad) {
      state.adShown = true;
      setStatus(state.adBlock ? 'Skipping an ad…' : 'An ad is playing…', 'info');
      return;
    }
    if (state.adShown) { state.adShown = false; setStatus(''); }

    if (!state.gotMedia) {
      state.gotMedia = true;
      stopWatchdog();
      setStatus('');
    }

    const playing = !!s.playing;
    els.iconPlay.toggleAttribute('hidden', playing);
    els.iconPause.toggleAttribute('hidden', !playing);
    els.btnPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    if (state.holdFirst && playing) {
      state.holdFirst = false;
      P.cmd('pause');
    }

    // Resuming the last session: jump back to where the song was left, once.
    if (state.resume && s.dur > 0) {
      const r = state.resume;
      state.resume = null;
      if (s.videoId === r.videoId && r.pos > 2 && r.pos < s.dur - 3) P.cmd('seek', r.pos);
    }
    // Remember the song and spot (every few seconds) so the next launch continues from here.
    if (!state.resume && s.videoId && s.dur > 0 && Date.now() - (state.savedAt || 0) > 4000) {
      state.savedAt = Date.now();
      window.api.setSettings({ lastVideoId: s.videoId, lastPos: Math.floor(s.cur || 0) });
    }

    // YouTube updates the song id and the title/artist at slightly different moments,
    // so a new song only counts once id + title + artist have stayed the same briefly.
    const key = `${s.videoId}|${s.title}|${s.artist}`;
    if (key !== state.currentVideoId) {
      if (key !== state.pendingKey) { state.pendingKey = key; state.pendingCount = 0; }
      state.pendingCount += 1;
      if (state.pendingCount >= 2) {
        state.pendingKey = null;
        onTrackChange({ video_id: key, title: s.title, author: s.artist });
      }
    } else {
      state.pendingKey = null;
    }
    if (s.art !== state.artUrl) setArt(s.art);


    const cur = s.cur || 0;
    const dur = s.dur || 0;
    if (!state.seeking) {
      els.seek.max = String(dur);
      els.seek.value = String(cur);
      els.cur.textContent = L.formatTime(cur);
      setRangeFill(els.seek);
    }
    els.dur.textContent = L.formatTime(dur);
    syncLyrics(cur);
  }

  // Reads the art in the page itself (a fallback if the app's own download of it fails).
  function paletteFromImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = 32;
          c.height = 32;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, 32, 32);
          resolve(window.Palette.fromPixels(ctx.getImageData(0, 0, 32, 32).data, 'rgba'));
        } catch (_) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  async function applyPalette(url) {
    if (!url) return; // art is briefly missing between songs: keep the current colours rather than flashing the default
    let p = null;
    try { p = await window.api.getPalette(url); } catch (_) { p = null; }
    if (!p && url === state.artUrl) p = await paletteFromImage(url);
    if (url !== state.artUrl) return; // a newer song already replaced this one
    const D = { bg: '#120f0d', bg2: '#1a1512', panel: '#1f1914', line: '#3a2f27', dim: '#8f8071', accent: '#c08a5e', accent2: '#e0b48a', glow: '#c08a5e', glow2: '#c08a5e' };
    const c = p || D;
    const root = document.documentElement.style;
    root.setProperty('--bg', c.bg);
    root.setProperty('--bg-2', c.bg2);
    root.setProperty('--panel', c.panel);
    root.setProperty('--line', c.line);
    root.setProperty('--dim', c.dim);
    root.setProperty('--accent', c.accent);
    root.setProperty('--accent-2', c.accent2);
    root.setProperty('--glow', c.glow);
    root.setProperty('--glow-2', c.glow2);
  }

  /* ---------- cover filter: hides explicit album covers ---------- */

  const coverVerdicts = new Map(); // cover key -> true (hide) / false (show)
  let nsfwModel = null;
  let nsfwLoading = null;
  let nsfwFailedToastShown = false;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(el);
    });
  }

  // The classifier is about 8 MB, so it is only loaded when the first cover needs checking.
  function ensureClassifier() {
    if (nsfwModel) return Promise.resolve(nsfwModel);
    if (!nsfwLoading) {
      nsfwLoading = (async () => {
        // tf.min.js bundles an old helper that falls back to running a string as code (blocked by this page's
        // security policy) unless this global already exists. Declaring it keeps the policy strict.
        if (!('regeneratorRuntime' in window)) window.regeneratorRuntime = {};
        await loadScript('vendor/tf.min.js');
        await loadScript('vendor/nsfwjs.min.js');
        try { await window.tf.setBackend('webgl'); } catch (_) { /* falls back below */ }
        await window.tf.ready();
        nsfwModel = await window.nsfwjs.load('vendor/nsfw/', { size: 224, type: 'layers' });
        return nsfwModel;
      })().catch((err) => {
        console.error('[cover filter]', err);
        nsfwLoading = null;
        return null;
      });
    }
    return nsfwLoading;
  }

  async function classifyCover(url) {
    const model = await ensureClassifier();
    if (!model) return null;
    const thumb = await window.api.getThumb(url);
    if (!thumb) return null;
    const image = new ImageData(new Uint8ClampedArray(thumb.data), thumb.w, thumb.h);
    const predictions = await model.classify(image);
    console.log('[cover filter]', predictions.map((p) => `${p.className} ${p.probability.toFixed(2)}`).join(', '));
    return window.CoverFilter.shouldBlur(predictions);
  }

  function setCoverMode(mode) {
    state.coverMode = mode; // 'shown' | 'checking' | 'hidden'
    const hidden = mode !== 'shown';
    els.albumBox.classList.toggle('cover-hidden', hidden);
    els.coverVeil.hidden = mode !== 'hidden';
    els.btnCoverToggle.hidden = !state.artUrl;
    els.btnCoverToggle.textContent = hidden ? 'Show cover' : 'Hide cover';
  }

  async function evaluateCover(url) {
    const key = window.CoverFilter.coverKey(url);
    state.coverKey = key;
    if (!url || !key) { setCoverMode('shown'); return; }

    const choice = state.coverOverrides[key];
    if (choice === 'hide') { setCoverMode('hidden'); return; }
    if (choice === 'show' || !state.coverFilter) { setCoverMode('shown'); return; }

    let verdict = coverVerdicts.get(key);
    if (verdict === undefined) {
      setCoverMode('checking'); // stays hidden until the check is done, so nothing flashes up
      try { verdict = await classifyCover(url); } catch (err) { console.error('[cover filter]', err); verdict = null; }
      if (verdict === null || verdict === undefined) {
        // The filter itself failed: show the cover rather than hiding every cover, and say so once.
        if (!nsfwFailedToastShown) { nsfwFailedToastShown = true; toast("The cover filter couldn't start, so covers are shown normally. Use Hide cover on any cover you want hidden.", 7000); }
        verdict = false;
      } else {
        coverVerdicts.set(key, verdict);
      }
    }
    if (state.coverKey !== key) return; // a newer song already replaced this one
    setCoverMode(verdict ? 'hidden' : 'shown');
  }

  els.btnCoverToggle.addEventListener('click', () => {
    if (!state.coverKey) return;
    const nowHidden = state.coverMode === 'shown'; // clicking "Hide cover" hides it, "Show cover" shows it
    state.coverOverrides[state.coverKey] = nowHidden ? 'hide' : 'show';
    const keys = Object.keys(state.coverOverrides);
    if (keys.length > 500) delete state.coverOverrides[keys[0]];
    window.api.setSettings({ coverOverrides: state.coverOverrides });
    setCoverMode(nowHidden ? 'hidden' : 'shown');
  });

  function applyCoverFilterButton() {
    els.btnCover.textContent = state.coverFilter ? 'Cover filter: on' : 'Cover filter: off';
  }
  els.btnCover.addEventListener('click', () => {
    state.coverFilter = !state.coverFilter;
    applyCoverFilterButton();
    window.api.setSettings({ coverFilter: state.coverFilter });
    if (state.artUrl) evaluateCover(state.artUrl);
  });

  function setArt(url) {
    state.artUrl = url;
    applyPalette(url);
    evaluateCover(url);
    if (url) {
      els.artImg.src = url;
      els.artImg.hidden = false;
      els.artEmpty.hidden = true;
    } else {
      els.artImg.hidden = true;
      els.artEmpty.hidden = false;
    }
  }

  P.onState(onPlayerState);

  /* ---------- track changes and lyrics ---------- */

  async function refreshLyricFiles() {
    try {
      state.lyricFiles = await window.api.listLyrics();
    } catch (_) {
      state.lyricFiles = [];
    }
  }

  async function onTrackChange(videoData) {
    state.currentVideoId = videoData.video_id;
    state.currentTitle = videoData.title || '';
    state.currentArtist = cleanArtist(videoData.author);
    els.title.textContent = state.currentTitle || 'Unknown title';
    els.artist.textContent = state.currentArtist;
    document.title = state.currentTitle ? `${state.currentTitle} — Lyric Player` : 'Lyric Player';
    els.btnEdit.disabled = !state.currentTitle;
    // Intro: the cover shows in the middle for a moment, then slides over to make room for the lyrics.
    els.stage.classList.add('intro');
    clearTimeout(state.introTimer);
    state.introTimer = setTimeout(() => els.stage.classList.remove('intro'), 2600);
    closeEditor();
    await refreshLyricFiles();
    await showLyricsForCurrent();
  }

  async function showLyricsForCurrent() {
    const match = L.matchFile(state.currentTitle, state.currentArtist, state.lyricFiles);
    state.lyricsFile = match ? match.file : null;
    state.lyricsRaw = '';
    state.lyricsData = null;
    state.activeIdx = -1;
    state.lyricsStatus = 'idle';

    if (match) {
      try {
        state.lyricsRaw = await window.api.readLyrics(match.file);
        state.lyricsData = L.parse(state.lyricsRaw);
      } catch (_) {
        state.lyricsData = null;
      }
    }

    const vid = state.currentVideoId;
    const shouldLookUp =
      !state.lyricsData && state.autoFetch && state.currentTitle && !state.notFound.has(vid) && !state.fetching.has(vid);
    if (shouldLookUp) state.lyricsStatus = 'searching';
    renderLyrics();
    if (shouldLookUp) fetchOnline(vid, state.currentTitle, state.currentArtist);
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function fetchOnline(vid, title, author) {
    const query = L.queryFor(title, author);
    if (!query.track) return;
    state.fetching.add(vid);

    // The length helps pick the right version; it can take a moment to be known.
    let duration = 0;
    for (let i = 0; i < 8 && !duration; i++) {
      duration = (state.snap && state.snap.dur) || 0;
      if (!duration) await sleep(250);
    }

    let res;
    try {
      res = await window.api.fetchLyrics({ title, track: query.track, artist: query.artist, duration });
    } catch (_) {
      res = { status: 'error' };
    }
    state.fetching.delete(vid);

    if (res.status === 'ok') {
      await refreshLyricFiles();
      if (state.currentVideoId === vid && els.editor.hidden) {
        await showLyricsForCurrent();
        toast(`${res.synced ? 'Found timed lyrics' : 'Found lyrics'} on ${res.source || 'LRCLIB'} and saved them`);
      }
      return;
    }
    if (res.status === 'notfound' || res.status === 'instrumental') state.notFound.add(vid);
    if (state.currentVideoId === vid) {
      state.lyricsStatus = res.status === 'disabled' ? 'idle' : res.status;
      renderLyrics();
    }
  }

  /* ---------- layout: album moves to the middle when a song has no lyrics ---------- */

  // Decided only once the lookup has settled, so the layout doesn't jump around while searching.
  function updateLayout() {
    const editing = !els.editor.hidden;
    const hasLyrics = !!(state.lyricsData && state.lyricsData.lines && state.lyricsData.lines.length);
    let solo = els.stage.classList.contains('solo');
    if (!state.currentTitle || editing || hasLyrics) solo = false;
    else if (state.lyricsStatus !== 'searching') solo = true;
    els.stage.classList.toggle('solo', solo);

    const note = {
      instrumental: 'Instrumental, no lyrics to show.',
      error: "Couldn't reach the lyrics service, so no lyrics for now.",
      notfound: 'No lyrics found for this song.',
    }[state.lyricsStatus] || 'No lyrics for this song yet.';
    els.soloNote.textContent = note;
    els.soloNote.hidden = !solo;
    els.btnAddSolo.hidden = !solo;
  }

  function renderLyrics() {
    updateLayout();
    const data = state.lyricsData;
    els.lines.textContent = '';
    els.lyrics.classList.toggle('synced', !!(data && data.synced));
    // Arabic (Quran) text mixes right-to-left and left-to-right lines, so centre everything.
    els.lyrics.classList.toggle('centered', !!(data && data.lines.some((l) => /[\u0600-\u06FF]/.test(l.text))));
    els.lyrics.classList.toggle('plain', !!(data && !data.synced));
    els.btnEdit.textContent = data ? 'Edit lyrics' : 'Add lyrics';

    if (!data || !data.lines.length) {
      const box = document.createElement('div');
      box.className = 'empty';
      const strong = document.createElement('strong');
      let detail = '';
      if (!state.currentTitle) {
        strong.textContent = 'Lyrics will show here.';
      } else if (state.lyricsStatus === 'searching') {
        strong.textContent = 'Looking for lyrics…';
      } else if (state.lyricsStatus === 'instrumental') {
        strong.textContent = 'This one is listed as an instrumental.';
      } else if (state.lyricsStatus === 'error') {
        strong.textContent = "Couldn't reach the lyrics service.";
        detail = 'Check your internet connection. You can still click “Add lyrics” to paste them in.';
      } else if (state.lyricsStatus === 'notfound') {
        strong.textContent = "Couldn't find lyrics online for this song.";
        detail = 'Click “Add lyrics” to paste them in, or drop a .txt or .lrc file named after the song into your lyrics folder.';
      } else {
        strong.textContent = 'No lyrics yet for this song.';
        detail = 'Click “Add lyrics” to paste them in, or drop a .txt or .lrc file named after the song into your lyrics folder.';
      }
      box.appendChild(strong);
      if (detail) {
        box.appendChild(document.createElement('br'));
        box.appendChild(document.createTextNode(detail));
      }
      els.lines.appendChild(box);
      els.lyrics.scrollTop = 0;
      return;
    }

    data.lines.forEach((line, i) => {
      const p = document.createElement('p');
      p.className = line.text === '' ? 'line gap' : 'line';
      p.dataset.i = String(i);
      p.dir = 'auto'; // Arabic lines read right-to-left
      p.textContent = line.text;
      els.lines.appendChild(p);
    });
    els.lyrics.scrollTop = 0;
  }

  function syncLyrics(currentTime) {
    const data = state.lyricsData;
    if (!data || !data.synced) return;
    const idx = L.activeIndex(data.lines, currentTime + 0.15);
    if (idx === state.activeIdx) return;
    state.activeIdx = idx;

    const nodes = els.lines.children;
    for (let i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('active', i === idx);
      nodes[i].classList.toggle('past', i < idx);
    }
    const el = nodes[idx];
    if (el) {
      const top = el.offsetTop - els.lyrics.clientHeight / 2 + el.offsetHeight / 2;
      els.lyrics.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }

  els.lines.addEventListener('click', (event) => {
    const p = event.target.closest('.line');
    if (!p || !state.lyricsData || !state.lyricsData.synced) return;
    const line = state.lyricsData.lines[Number(p.dataset.i)];
    if (line && line.time != null) P.cmd('seek', line.time);
  });

  /* ---------- lyrics editor ---------- */

  function openEditor() {
    if (!state.currentTitle) return;
    els.editorText.value = state.lyricsRaw;
    els.editorHint.textContent = state.lyricsFile ? `Editing ${state.lyricsFile}` : 'Saved to your lyrics folder';
    els.lyrics.hidden = true;
    els.editor.hidden = false;
    els.btnEdit.disabled = true;
    updateLayout();
    els.editorText.focus();
  }

  function closeEditor() {
    els.editor.hidden = true;
    els.lyrics.hidden = false;
    els.btnEdit.disabled = !state.currentTitle;
    updateLayout();
  }

  async function saveEditor() {
    const content = els.editorText.value;
    if (!content.trim()) {
      toast('Nothing to save yet. Paste some lyrics first.');
      return;
    }
    try {
      const res = await window.api.writeLyrics({
        title: state.currentTitle,
        content,
        existingFile: state.lyricsFile || undefined,
      });
      await refreshLyricFiles();
      closeEditor();
      await showLyricsForCurrent();
      toast(`Saved ${res.file}`);
    } catch (err) {
      toast("Couldn't save the lyrics: " + (err && err.message ? err.message : 'unknown error'));
    }
  }

  els.btnEdit.addEventListener('click', openEditor);
  els.btnCancel.addEventListener('click', closeEditor);
  els.btnSave.addEventListener('click', saveEditor);

  /* ---------- transport ---------- */

  function paintShuffle() {
    els.btnShuffle.classList.toggle('on', state.shuffle);
    els.btnShuffle.title = state.shuffle ? 'Shuffle: on' : 'Shuffle: off';
  }

  function paintRepeat() {
    els.btnRepeat.classList.toggle('on', state.repeat !== 'off');
    els.repeatOne.hidden = state.repeat !== 'one';
    els.btnRepeat.title = { off: 'Repeat: off', all: 'Repeat: playlist', one: 'Repeat: this song' }[state.repeat];
  }

  function toggleShuffle() {
    state.shuffle = !state.shuffle;
    paintShuffle();
    P.cmd('setShuffle', state.shuffle);
    window.api.setSettings({ shuffle: state.shuffle });
    toast(state.shuffle ? 'Shuffle on. The next song is picked at random.' : 'Shuffle off.');
  }

  function cycleRepeat() {
    state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
    paintRepeat();
    P.cmd('setRepeat', state.repeat);
    window.api.setSettings({ repeat: state.repeat });
    toast({ off: 'Repeat off.', all: 'Repeat playlist on.', one: 'Repeating this song.' }[state.repeat]);
  }

  els.btnPlay.addEventListener('click', () => P.cmd('toggle'));
  els.btnNext.addEventListener('click', () => P.cmd('next'));
  els.btnPrev.addEventListener('click', () => {
    // Like most players: restart the song if we're past the first few seconds.
    if (state.snap && state.snap.cur > 3) P.cmd('seek', 0);
    else P.cmd('prev');
  });
  els.btnShuffle.addEventListener('click', toggleShuffle);
  els.btnRepeat.addEventListener('click', cycleRepeat);
  els.btnAddSolo.addEventListener('click', openEditor);
  els.btnBrowse.addEventListener('click', () => setBrowse(!browsing));

  /* ---------- fullscreen ---------- */

  function wakeControls() {
    els.app.classList.remove('idle');
    clearTimeout(state.idleTimer);
    if (state.fullscreen) state.idleTimer = setTimeout(() => els.app.classList.add('idle'), 3000);
  }

  function setFullscreenUi(on) {
    state.fullscreen = !!on;
    els.app.classList.toggle('immersive', state.fullscreen);
    els.btnFull.title = state.fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen (F11)';
    if (state.fullscreen && browsing) setBrowse(false);
    wakeControls();
  }

  els.btnFull.addEventListener('click', () => window.api.fullscreen());
  window.api.onFullscreen(setFullscreenUi);
  window.addEventListener('mousemove', wakeControls);
  window.addEventListener('keydown', wakeControls);

  els.seek.addEventListener('pointerdown', () => (state.seeking = true));
  els.seek.addEventListener('input', () => {
    els.cur.textContent = L.formatTime(els.seek.value);
    setRangeFill(els.seek);
  });
  els.seek.addEventListener('change', () => {
    P.cmd('seek', parseFloat(els.seek.value));
    state.seeking = false;
  });

  els.vol.addEventListener('input', () => {
    state.volume = parseInt(els.vol.value, 10);
    setRangeFill(els.vol);
    P.cmd('volume', state.volume);
  });
  els.vol.addEventListener('change', () => window.api.setSettings({ volume: state.volume }));

  document.addEventListener('keydown', (event) => {
    const tag = (event.target && event.target.tagName) || '';
    if (tag === 'INPUT' && event.target.type === 'text') return;
    if (tag === 'TEXTAREA') return;
    if (event.ctrlKey && event.shiftKey && event.code === 'KeyD') {
      event.preventDefault();
      P.diagnose().then((n) => toast(typeof n === 'number' ? 'Troubleshooting info copied. Paste it into your message to me.' : String(n), 6000));
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      P.cmd('toggle');
    } else if (event.ctrlKey && event.code === 'ArrowRight') {
      P.cmd('next');
    } else if (event.ctrlKey && event.code === 'ArrowLeft') {
      P.cmd('prev');
    }
  });

  /* ---------- drag and drop / paste ---------- */

  function textFromDrop(dt) {
    const parts = [];
    for (const type of ['text/uri-list', 'text/plain']) {
      const v = dt.getData(type);
      if (v) parts.push(v);
    }
    const html = dt.getData('text/html');
    if (html) {
      const m = html.match(/href=["']([^"']+)["']/i);
      if (m) parts.push(m[1].replace(/&amp;/g, '&'));
    }
    return parts;
  }

  let dragDepth = 0;
  window.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth += 1;
    els.dragVeil.hidden = false;
  });
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) els.dragVeil.hidden = true;
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    els.dragVeil.hidden = true;
    for (const text of textFromDrop(event.dataTransfer)) {
      const src = L.extractSource(text);
      if (src) return loadSource(src);
    }
    toast("Couldn't find a playlist, album or song link in what you dropped. Try pasting the link instead.");
    showOverlay();
  });

  els.btnLoad.addEventListener('click', () => submitUrl(els.urlInput.value));
  els.urlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submitUrl(els.urlInput.value);
  });
  els.urlInput.addEventListener('paste', () => setTimeout(() => {
    if (L.extractSource(els.urlInput.value)) submitUrl(els.urlInput.value);
  }, 0));
  els.btnPlaylist.addEventListener('click', () => showOverlay());
  els.btnCloseOverlay.addEventListener('click', hideOverlay);
  els.btnFolder.addEventListener('click', () => window.api.openLyricsFolder());

  function applyAds() {
    els.btnAds.textContent = state.adBlock ? 'Ad block: on' : 'Ad block: off';
  }
  els.btnAds.addEventListener('click', async () => {
    state.adBlock = !state.adBlock;
    applyAds();
    await window.api.setAdBlock(state.adBlock);
    toast(state.adBlock ? 'Ad block on. Applies to the next ad.' : 'Ad block off.');
  });

  function applySide() {
    els.stage.classList.toggle('swap', state.albumSide === 'left');
    els.btnSide.textContent = state.albumSide === 'left' ? 'Album: left' : 'Album: right';
  }
  els.btnSide.addEventListener('click', () => {
    state.albumSide = state.albumSide === 'left' ? 'right' : 'left';
    applySide();
    window.api.setSettings({ albumSide: state.albumSide });
  });

  function applyAuto() {
    els.btnAuto.textContent = state.autoFetch ? 'Auto lyrics: on' : 'Auto lyrics: off';
  }
  els.btnAuto.addEventListener('click', () => {
    state.autoFetch = !state.autoFetch;
    applyAuto();
    window.api.setSettings({ autoFetch: state.autoFetch });
    if (state.autoFetch && state.currentTitle && !state.lyricsData && els.editor.hidden) showLyricsForCurrent();
    else if (!state.autoFetch && state.lyricsStatus === 'searching') {
      state.lyricsStatus = 'idle';
      renderLyrics();
    }
  });

  window.addEventListener('focus', async () => {
    const before = state.lyricFiles.length;
    await refreshLyricFiles();
    if (state.lyricFiles.length !== before && state.currentTitle && els.editor.hidden) showLyricsForCurrent();
  });

  /* ---------- start ---------- */

  async function init() {
    const settings = (await window.api.getSettings()) || {};
    state.volume = Number.isFinite(settings.volume) ? settings.volume : 80;
    state.autoFetch = settings.autoFetch !== false;
    state.adBlock = settings.adBlock !== false;
    state.coverFilter = settings.coverFilter !== false;
    state.coverOverrides = settings.coverOverrides && typeof settings.coverOverrides === 'object' ? settings.coverOverrides : {};
    applyCoverFilterButton();
    applyAds();
    applyAuto();
    // Shuffle, repeat and the album side come back the way they were left.
    state.shuffle = settings.shuffle === true;
    state.repeat = ['off', 'all', 'one'].includes(settings.repeat) ? settings.repeat : 'off';
    paintShuffle();
    paintRepeat();
    P.cmd('setShuffle', state.shuffle);
    P.cmd('setRepeat', state.repeat);
    state.albumSide = settings.albumSide === 'left' ? 'left' : 'right';
    applySide();
    els.vol.value = String(state.volume);
    setRangeFill(els.vol);
    setRangeFill(els.seek);
    P.cmd('volume', state.volume);
    renderLyrics();
    await refreshLyricFiles();

    if (settings.lastPlaylist) {
      // Pick up where the last session ended: same song, same spot (it opens paused).
      if (settings.lastVideoId && /^[A-Za-z0-9_-]{2,20}$/.test(settings.lastVideoId)) {
        state.resume = { videoId: settings.lastVideoId, pos: Number(settings.lastPos) || 0 };
      }
      loadPlaylist(settings.lastPlaylist, false);
    } else if (settings.lastSong && /^[A-Za-z0-9_-]{2,20}$/.test(settings.lastSong)) {
      if (settings.lastVideoId === settings.lastSong) state.resume = { videoId: settings.lastSong, pos: Number(settings.lastPos) || 0 };
      loadSong(settings.lastSong, false);
    } else showOverlay();
  }

  init();
})();
