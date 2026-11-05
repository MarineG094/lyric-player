/* Lyric Player renderer: YouTube IFrame playback + lyrics UI. */
(function () {
  'use strict';

  const L = window.Lyrics;
  const $ = (sel) => document.querySelector(sel);

  const MINI = window.api && window.api.mini ? window.api.mini : null; // only the Windows app has the mini player
  const els = {
    app: $('#app'),
    lyrics: $('#lyrics'),
    lines: $('#lyricsLines'),
    btnEdit: $('#btnEdit'),
    nudge: $('#syncNudge'),
    btnWrong: $('#btnWrong'),
    nudgeVal: $('#nudgeVal'),
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
    searchInput: $('#searchInput'),
    btnSearch: $('#btnSearch'),
    searchResults: $('#searchResults'),
    searchMsg: $('#searchMsg'),
    upNext: $('#upNext'),
    upNextImg: $('#upNextImg'),
    upNextText: $('#upNextText'),
    linkChoice: $('#linkChoice'),
    choiceText: $('#choiceText'),
    chPlayNow: $('#chPlayNow'),
    chPlayNext: $('#chPlayNext'),
    chQueue: $('#chQueue'),
    chCancel: $('#chCancel'),
    savedBox: $('#savedBox'),
    savedList: $('#savedList'),
    importNote: $('#importNote'),
    importText: $('#importText'),
    importMissing: $('#importMissing'),
    importCancel: $('#importCancel'),
    importClose: $('#importClose'),
    queueBox: $('#queueBox'),
    queueList: $('#queueList'),
    btnClearQueue: $('#btnClearQueue'),
    btnLoad: $('#btnLoad'),
    btnCloseOverlay: $('#btnCloseOverlay'),
    btnPlaylist: $('#btnPlaylist'),
    btnMini: $('#btnMini'),
    btnUpdate: $('#btnUpdate'),
    btnFolder: $('#btnFolder'),
    btnAuto: $('#btnAuto'),
    btnRoman: $('#btnRoman'),
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
    upgraded: new Set(),
    retryN: new Map(),
    romanize: true,
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
    if (els.savedBox) renderSaved();
    els.btnCloseOverlay.hidden = !state.playlistId;
    if (message) {
      els.overlayMsg.textContent = message;
      els.overlayMsg.hidden = false;
    } else {
      els.overlayMsg.hidden = true;
    }
    refreshQueue();
    hideChoice();
    setTimeout(() => (els.searchInput || els.urlInput).focus(), 0);
  }

  /* ---------- search ---------- */

  let searchSeq = 0;
  const KIND_LABEL = { song: 'Song', album: 'Album', list: 'Playlist' };

  function searchNote(text) {
    els.searchMsg.textContent = text || '';
    els.searchMsg.hidden = !text;
  }

  function renderQueue(items) {
    els.queueList.textContent = '';
    els.queueBox.hidden = !items.length;
    items.forEach((it, i) => {
      const row = document.createElement('div'); row.className = 'queue-item';
      const n = document.createElement('span'); n.className = 'qn'; n.textContent = String(i + 1);
      const t = document.createElement('span'); t.className = 'qt'; t.textContent = it.title + (it.sub ? ' · ' + it.sub : '');
      const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.title = 'Remove from the queue'; x.setAttribute('aria-label', 'Remove ' + it.title);
      x.addEventListener('click', async () => renderQueue(await P.dequeue(i)));
      row.append(n, t, x);
      els.queueList.appendChild(row);
    });
  }
  async function refreshQueue() { try { renderQueue(await P.queue()); } catch (_) { /* ignore */ } }
  els.btnClearQueue.addEventListener('click', async () => renderQueue(await P.clearQueue()));

  // A YouTube Music link, or a Spotify / Deezer / SoundCloud playlist link (those get matched song by song).
  function linkOf(text) {
    const y = L.extractSource(text);
    if (y) return y;
    const ext = L.extractExternal(text);
    return ext ? { kind: 'import', ext } : null;
  }

  // Adds whatever a link or search result points at (one song, or all songs of an album / playlist) to the queue.
  async function queueSource(src, title, front) {
    if (src.kind === 'import') return importAndQueue(src.ext, front, false);
    let res;
    try { res = await P.resolveItems(src); } catch (_) { res = { items: [], error: 'failed' }; }
    const items = (res && res.items) || [];
    if (!items.length) { toast("Couldn't add that: " + ((res && res.error) || 'nothing found')); return false; }
    let out;
    try { out = await P.enqueueMany(items, front); } catch (_) { return false; }
    renderQueue(out.queue);
    const what = items.length === 1 ? (items[0].title || title || 'the song') : `${out.added} songs`;
    toast((front ? 'Playing next: ' : 'Added to the queue: ') + what + (out.skipped ? ` (${out.skipped} didn't fit, the queue holds 200)` : ''));
    return true;
  }


  /* ---------- update check ----------
     Looks at the app's GitHub release (one small request, at most every 6 hours, a little after start so it
     never competes with the music loading). A different build there means an update. */
  const REPO = 'NaqibC/lyric-player';
  let updateInfo = null;
  function openLink(url) { if (window.api.openUrl) window.api.openUrl(url); else window.open(url, '_blank'); }
  function showUpdate(info) {
    updateInfo = info;
    els.btnUpdate.hidden = false;
  }
  els.btnUpdate.addEventListener('click', () => {
    if (!updateInfo) return;
    openLink(updateInfo.url);
    toast(window.__lpTv
      ? `New version: open github.com/${REPO}/releases/tag/latest and download LyricPlayer-TV.apk (the Downloader app works well).`
      : window.api.mini ? 'Downloading the new version. Close this app and run the new file instead.' : 'Downloading the new version. Open the file when it finishes to update.', 9000);
  });
  async function checkForUpdate() {
    const B = window.__build;
    if (!B || !B.sha || B.sha === 'dev' || !B.platform) return;
    let st = {};
    try { st = await window.api.getSettings(); } catch (_) { return; }
    if (st.updateInfo && st.updateInfo.sha && st.updateInfo.sha !== B.sha && st.updateInfo.platform === B.platform) showUpdate(st.updateInfo); // found earlier, not installed yet
    const now = Date.now();
    if (st.updateCheckedAt && now - st.updateCheckedAt < 6 * 3600 * 1000 && now >= st.updateCheckedAt) return;
    const tag = B.platform === 'windows' ? 'windows-latest' : 'latest';
    const want = B.platform === 'windows' ? /\.exe$/i : B.platform === 'tv' ? /^LyricPlayer-TV\.apk$/i : /^LyricPlayer\.apk$/i;
    try {
      const rel = await window.api.latestRelease(tag);
      if (!rel) return; // offline, rate-limited, or the release is being rebuilt: try again next time
      window.api.setSettings({ updateCheckedAt: now });
      const sha = String(rel.sha || '');
      const asset = (rel.assets || []).find((x) => want.test(x.name || ''));
      const url = asset && String(asset.url || '');
      if (!/^[0-9a-f]{40}$/.test(sha) || !url.startsWith(`https://github.com/${REPO}/releases/`)) return;
      if (sha !== B.sha) {
        const info = { sha, url, platform: B.platform };
        window.api.setSettings({ updateInfo: info });
        showUpdate(info);
        if (st.updateToastSha !== sha) { window.api.setSettings({ updateToastSha: sha }); toast('A new version is available. Use the "Update available" button at the top.', 7000); }
      } else if (st.updateInfo) { window.api.setSettings({ updateInfo: null }); els.btnUpdate.hidden = true; }
    } catch (_) { /* no network: nothing to do */ }
  }
  setTimeout(checkForUpdate, window.__lpTv ? 60000 : 15000);

  /* ---------- importing a Spotify / Deezer / SoundCloud playlist ---------- */
  let importTimer = null;
  function showImport(text, opts) {
    els.importNote.hidden = false;
    els.importText.textContent = text;
    els.importCancel.hidden = !(opts && opts.running);
    els.importClose.hidden = !!(opts && opts.running);
    els.importMissing.hidden = !(opts && opts.missing && opts.missing.length);
    els.importMissing.textContent = '';
    if (opts && opts.missing) for (const m of opts.missing) { const li = document.createElement('li'); li.textContent = m; els.importMissing.appendChild(li); }
  }
  els.importCancel.addEventListener('click', () => { P.importCancel(); els.importCancel.hidden = true; els.importText.textContent += ' Stopping…'; });
  els.importClose.addEventListener('click', () => { els.importNote.hidden = true; });

  /* Saved playlists: the matched songs are kept, so opening one again needs no new searching. */
  let migrated = false;
  async function loadSaved() {
    try {
      let list = await window.api.getSaved();
      if (!migrated) { // earlier versions kept them in the settings file: move them over once
        migrated = true;
        const st = await window.api.getSettings();
        if (st && Array.isArray(st.savedPlaylists)) {
          if (!list.length && st.savedPlaylists.length) { list = st.savedPlaylists; await window.api.setSaved(list); }
          await window.api.setSettings({ savedPlaylists: null });
        }
      }
      return Array.isArray(list) ? list : [];
    } catch (_) { return []; }
  }
  async function storeSaved(list) { try { await window.api.setSaved(list.slice(0, 30)); } catch (_) { /* ignore */ } }

  async function rememberYt(id, name) {
    const url = 'yt:' + id;
    const old = await loadSaved();
    const prev = old.find((x) => x.url === url);
    await storeSaved([{ url, service: 'youtube', kind: 'list', id, name: prev ? prev.name : name, savedAt: Date.now() }, ...old.filter((x) => x.url !== url)]);
    renderSaved();
  }

  async function renderSaved() {
    const list = await loadSaved();
    els.savedBox.hidden = !list.length;
    els.savedList.textContent = '';
    list.forEach((pl) => {
      const row = document.createElement('div');
      row.className = 'saved-row';
      const info = document.createElement('div');
      info.className = 'saved-info';
      const nm = document.createElement('strong'); nm.textContent = pl.name;
      const yt = pl.service === 'youtube';
      const sub = document.createElement('span'); sub.textContent = yt ? 'YouTube Music playlist' : `${pl.items.length} songs` + (pl.missing && pl.missing.length ? `, ${pl.missing.length} not found` : '') + ` · ${L.SERVICE_NAME[pl.service] || ''}`;
      info.append(nm, sub);
      const mk = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost small'; b.textContent = label; b.addEventListener('click', fn); return b; };
      row.append(info,
        mk('Play', () => (yt ? loadPlaylist(pl.id, true, undefined, pl.name) : applyImported(pl, false, true))),
        mk('+ Queue', () => (yt ? (state.currentVideoId ? queueSource({ kind: 'list', id: pl.id }, pl.name, false) : loadPlaylist(pl.id, true, undefined, pl.name)) : applyImported(pl, false, false))),
        ...(yt ? [] : [mk('Update', () => importAndQueue({ service: pl.service, kind: pl.kind, url: pl.url }, false, false, true))]),
        mk('✕', async () => { await storeSaved((await loadSaved()).filter((x) => x.url !== pl.url)); renderSaved(); }));
      els.savedList.appendChild(row);
    });
  }

  // Puts the songs of an imported / saved playlist into the queue (or starts the first one), and says what was missing.
  async function applyImported(pl, front, playFirst, fresh) {
    const items = pl.items || [];
    const missing = pl.missing || [];
    let rest = items;
    let first = null;
    if (playFirst && !state.currentVideoId) { first = items[0]; rest = items.slice(1); }
    else if (playFirst && items.length) { // something is playing: "Play" means play this next
      front = true;
    }
    if (rest.length) { try { const out = await P.enqueueMany(rest, front); renderQueue(out.queue); } catch (_) { /* ignore */ } }
    const bits = [`${fresh ? 'Found' : 'Saved playlist:'} ${items.length}${fresh ? ' of ' + (pl.total || items.length) : ''} songs${pl.name ? ' from "' + pl.name + '"' : ''}, ${first ? 'started' : playFirst ? 'playing next' : 'added to the queue'}.`];
    if (missing.length) bits.push(`Not all songs were found. Missing ${missing.length}:`);
    if (pl.cut) bits.push(`(${pl.cut} more songs in the playlist were left out; at most 200 are imported.)`);
    if (pl.cancelled) bits.push('(Stopped early.)');
    showImport(bits.join(' '), { running: false, missing });
    if (first) loadSong(first.id, true);
  }

  async function importAndQueue(ext, front, playFirst, refresh) {
    hideChoice();
    els.urlInput.value = '';
    if (!refresh) { // already imported before? use the saved songs, no searching
      const hit = (await loadSaved()).find((x) => x.url === ext.url);
      if (hit) { await applyImported(hit, front, playFirst); return true; }
    }
    const svc = L.SERVICE_NAME[ext.service];
    showImport(`Reading the ${svc} ${ext.kind}…`, { running: true });
    clearInterval(importTimer);
    importTimer = setInterval(async () => {
      try {
        const st = await P.importStatus();
        if (st && st.running && st.phase === 'matching') showImport(`Finding songs on YouTube Music: ${st.done} of ${st.total} (${st.found} found)…`, { running: true });
      } catch (_) { /* ignore */ }
    }, 800);
    let res;
    try { res = await P.importPlaylist({ url: ext.url || '' }); } catch (_) { res = { items: [], missing: [], total: 0, error: 'failed' }; }
    clearInterval(importTimer);
    const items = (res && res.items) || [];
    if (res && res.error && !items.length) { showImport("Couldn't import that: " + res.error, { running: false }); return false; }
    if (!items.length) { showImport(`None of the ${res.total || ''} songs could be found on YouTube Music.`.replace('  ', ' '), { running: false, missing: res.missing }); return false; }
    const name = res.name || `${svc} ${ext.kind} (${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})`;
    const pl = { url: ext.url, service: ext.service, kind: ext.kind, name, items, missing: res.missing || [], total: res.total, cut: res.cut || 0, cancelled: !!res.cancelled, savedAt: Date.now() };
    if (!res.cancelled) { // a half-finished import isn't saved: it would look complete next time
      await storeSaved([pl, ...(await loadSaved()).filter((x) => x.url !== pl.url)]);
      renderSaved();
    }
    await applyImported(pl, front, playFirst, true);
    return true;
  }

  // Play now / Play next / Add to queue, for a result or a pasted link. With nothing playing, there is nothing to queue behind.
  function playNow(src, title) { loadSource(src, title); }

  function renderResults(results) {
    els.searchResults.textContent = '';
    els.searchResults.hidden = !results.length;
    for (const r of results) {
      const row = document.createElement('div');
      row.className = 'result-row';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'result';
      if (r.thumb && /^https:/.test(r.thumb)) {
        const img = document.createElement('img');
        img.src = r.thumb; img.alt = ''; img.loading = 'lazy';
        b.appendChild(img);
      } else {
        const none = document.createElement('div'); none.className = 'noimg'; b.appendChild(none);
      }
      const rt = document.createElement('div'); rt.className = 'rt';
      const t = document.createElement('b'); t.textContent = r.title;
      const sub = document.createElement('span'); sub.textContent = r.sub || '';
      rt.append(t, sub);
      const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = KIND_LABEL[r.kind] || '';
      b.append(rt, chip);
      b.addEventListener('click', () => { els.searchInput.value = ''; renderResults([]); searchNote(''); loadSource({ kind: r.kind, id: r.id }, r.title); });
      row.appendChild(b);
      {
        const q = document.createElement('div'); q.className = 'qbtns';
        const src = { kind: r.kind, id: r.id };
        const mk = (label, title, fn) => { const x = document.createElement('button'); x.type = 'button'; x.className = 'qbtn'; x.textContent = label; x.title = title; x.addEventListener('click', fn); return x; };
        q.append(
          mk('Play now', 'Play this now', () => { els.searchInput.value = ''; renderResults([]); searchNote(''); playNow(src, r.title); }),
          mk('Play next', 'Play this right after the current song', () => { if (!state.currentVideoId) playNow(src, r.title); else queueSource(src, r.title, true); }),
          mk('+ Queue', 'Add this to the end of the queue', () => { if (!state.currentVideoId) playNow(src, r.title); else queueSource(src, r.title, false); }),
        );
        row.appendChild(q);
      }
      els.searchResults.appendChild(row);
    }
  }

  async function runSearch() {
    const q = els.searchInput.value.trim();
    const mine = ++searchSeq;
    if (q.length < 2) { renderResults([]); searchNote(''); return; }
    // A pasted link in the search box just works too.
    if (linkOf(q)) { submitUrl(q); els.searchInput.value = ''; return; }
    searchNote('Searching…');
    let res;
    try { res = await P.search(q); } catch (_) { res = { results: [], error: 'search failed' }; }
    if (mine !== searchSeq) return; // a newer search replaced this one
    renderResults(res.results || []);
    if (res.results && res.results.length) searchNote('');
    else searchNote(res.error ? "Couldn't search right now: " + res.error : 'Nothing found. Try different words.');
  }

  function hideOverlay() {
    els.overlay.hidden = true;
    els.overlayMsg.hidden = true;
  }

  // A pasted link asks what to do with it (unless nothing is playing yet, when there is nothing to ask).
  let pendingSrc = null;
  const KIND_WORD = { song: 'a song', album: 'an album', list: 'a playlist' };
  function hideChoice() { pendingSrc = null; els.linkChoice.hidden = true; }
  function offerLink(src) {
    if (!state.currentVideoId) { els.urlInput.value = ''; loadSource(src); return; }
    pendingSrc = src;
    els.choiceText.textContent = src.kind === 'import'
      ? `That's a ${L.SERVICE_NAME[src.ext.service]} ${src.ext.kind}. The songs are matched on YouTube Music one by one, so it may take a minute. What should happen?`
      : `That link is ${KIND_WORD[src.kind] || 'music'}. What should happen?`;
    els.linkChoice.hidden = false;
    els.overlayMsg.hidden = true;
    setTimeout(() => els.chPlayNow.focus(), 0);
  }
  function submitUrl(text) {
    const src = linkOf(text);
    if (!src) {
      showOverlay("That doesn't look like a music link. Paste a YouTube Music, Spotify, Deezer or SoundCloud playlist, album or song link.");
      return;
    }
    offerLink(src);
  }
  els.chPlayNow.addEventListener('click', () => { const s = pendingSrc; hideChoice(); els.urlInput.value = ''; if (s) playNow(s); });
  els.chPlayNext.addEventListener('click', async () => { const s = pendingSrc; if (!s) return; if (await queueSource(s, '', true)) { hideChoice(); els.urlInput.value = ''; } });
  els.chQueue.addEventListener('click', async () => { const s = pendingSrc; if (!s) return; if (await queueSource(s, '', false)) { hideChoice(); els.urlInput.value = ''; } });
  els.chCancel.addEventListener('click', () => { hideChoice(); els.urlInput.focus(); });

  // Playlist, album or single song: whatever the link points at.
  function loadSource(src, title) {
    if (src.kind === 'import') importAndQueue(src.ext, false, true);
    else if (src.kind === 'song') loadSong(src.id, true);
    else if (src.kind === 'album') loadAlbum(src.id, title);
    else loadPlaylist(src.id, true, src.video, title);
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

  function loadPlaylist(id, userInitiated, startVideo, name) {
    state.playlistId = id;
    state.saveYt = userInitiated && /^[A-Za-z0-9_-]{10,}$/.test(id) && !/^RD/.test(id) ? { id, name: name || '' } : null; // remembered once the first song plays
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
  async function loadAlbum(browseId, name) {
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
    loadPlaylist(listId, true, undefined, name);
  }

  // The tiny "Up next" line at the bottom: cover, title and artist of the song that plays after this one.
  let upNextId = '';
  function paintNext(s) {
    const n = s && s.hasMedia && !s.ad ? s.next : null;
    if (!n || (!n.title && !n.thumb)) { els.upNext.hidden = true; upNextId = ''; return; }
    const label = n.title ? (n.sub ? `${n.title} · ${n.sub}` : n.title) : '…';
    if (els.upNext.hidden) els.upNext.hidden = false;
    if (els.upNextText.textContent !== label) els.upNextText.textContent = label;
    if (n.id !== upNextId || els.upNextImg.dataset.src !== n.thumb) {
      upNextId = n.id;
      els.upNextImg.dataset.src = n.thumb || '';
      els.upNextImg.hidden = !/^https:/.test(n.thumb || '');
      if (!els.upNextImg.hidden) els.upNextImg.src = n.thumb;
    }
    const tip = n.queued ? 'Next in your queue' : 'Next in the playlist';
    if (els.upNext.title !== tip) els.upNext.title = tip;
  }

  function onPlayerState(s) {
    if (!s) return;
    state.snap = s;
    paintNext(s);
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
      if (state.saveYt) { const y = state.saveYt; state.saveYt = null; rememberYt(y.id, y.name || (s.title ? `Playlist with “${s.title}”` : 'YouTube Music playlist')); }
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
      // TV: the music waits until the cover, colours and lyrics are ready, so hold the new song straight away.
      if (window.__lpTv && state.pendingCount === 1 && s.playing) { state.heldByUs = true; P.cmd('pause'); }
      if (state.pendingCount >= 2) {
        state.pendingKey = null;
        onTrackChange({ video_id: key, title: s.title, author: s.artist });
      }
    } else {
      state.pendingKey = null;
      // A false alarm (the id and title just updated at different moments): nothing changed, so carry on playing.
      if (window.__lpTv && state.heldByUs && !state.staging) { state.heldByUs = false; P.cmd('play'); }
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
    if (MINI) MINI.palette(c);
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
    if (MINI) MINI.cover(hidden);
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
        state.coverFailed = true; // the button says so, so a filter that is quietly not running can be seen
        applyCoverFilterButton();
        verdict = false;
      } else {
        coverVerdicts.set(key, verdict);
        if (state.coverFailed) { state.coverFailed = false; applyCoverFilterButton(); }
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
    els.btnCover.textContent = state.coverFilter ? (state.coverFailed ? 'Cover filter: on (not working)' : 'Cover filter: on') : 'Cover filter: off';
  }
  els.btnCover.addEventListener('click', () => {
    state.coverFilter = !state.coverFilter;
    applyCoverFilterButton();
    window.api.setSettings({ coverFilter: state.coverFilter });
    if (state.artUrl) evaluateCover(state.artUrl);
  });

  /* If the cover picture fails to load (a one-off network hiccup, or the server refusing one size), try again,
     then smaller sizes, then the video's own thumbnail, instead of leaving a broken image. */
  let artFallbacks = [];
  els.artImg.addEventListener('error', () => {
    const next = artFallbacks.shift();
    if (next) {
      setTimeout(() => { if (state.artUrl) els.artImg.src = next; }, 600);
    } else if (state.artUrl) {
      els.artImg.hidden = true;
      els.artEmpty.hidden = false;
    }
  });
  function artChain(url) {
    const vid = state.snap && state.snap.videoId;
    const sized = (size) => url.replace(/=w\d+-h\d+.*$/, size);
    const out = [url + '#retry', sized('=w544-h544'), sized('=w226-h226'), vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : '', sized('')];
    return out.filter((u, i) => u && u !== url && out.indexOf(u) === i);
  }

  function setArt(url) {
    state.artUrl = url;
    if (window.__lpTv) {
      // TV stick: the picture shows at once; the colours and the cover check wait until the song and its lyrics have settled.
      clearTimeout(state.artTimer);
      if (!state.staging) state.artTimer = setTimeout(() => {
        if (state.artUrl !== url || state.staging) return;
        applyPalette(url);
        state.artTimer = setTimeout(() => { if (state.artUrl === url) evaluateCover(url); }, 2500); // the cover check is a separate, later step
      }, 9000);
    } else {
      applyPalette(url);
      evaluateCover(url);
    }
    if (url) {
      artFallbacks = artChain(url);
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

  const idle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function onTrackChange(videoData) {
    const vid = videoData.video_id;
    state.currentVideoId = vid;
    state.currentTitle = videoData.title || '';
    state.currentArtist = cleanArtist(videoData.author);
    els.title.textContent = state.currentTitle || 'Unknown title';
    els.artist.textContent = state.currentArtist;
    document.title = state.currentTitle ? `${state.currentTitle} — Lyric Player` : 'Lyric Player';
    els.btnEdit.disabled = !state.currentTitle;
    // Intro: the cover shows in the middle for a moment, then slides over to make room for the lyrics.
    els.stage.classList.add('intro');
    clearTimeout(state.introTimer);
    closeEditor();

    if (!window.__lpTv) {
      state.introTimer = setTimeout(() => els.stage.classList.remove('intro'), 2600);
      await refreshLyricFiles();
      await showLyricsForCurrent();
      return;
    }

    // TV stick: one thing at a time, in this order, with a pause between each, and the music starts last:
    // 1) the cover loads  2) the cover check  3) the cover slides over  4) the colours  5) the lyrics  6) the song plays.
    const mine = (state.stageId = (state.stageId || 0) + 1);
    const stale = () => state.currentVideoId !== vid || state.stageId !== mine;
    state.staging = true;
    clearTimeout(state.artTimer);
    state.introTimer = setTimeout(() => els.stage.classList.remove('intro'), 30000); // safety net
    state.lyricsData = null;
    state.lyricsFile = null;
    state.lyricsRaw = '';
    state.activeIdx = -1;
    state.lyricsStatus = 'searching';
    renderLyrics(); // clears the last song's lyrics; cheap
    if (state.snap && state.snap.playing) { state.heldByUs = true; P.cmd('pause'); }
    try {
      // 1) the cover loads
      const t0 = Date.now();
      while (!stale() && !(els.artImg.complete || els.artImg.hidden) && Date.now() - t0 < 3000) await idle(150);
      await idle(700);
      if (stale()) return;
      // 2) the cover check: if the filter is on, it decides now, and an explicit cover is hidden before anything else happens
      if (state.artUrl && state.coverFilter) {
        await Promise.race([evaluateCover(state.artUrl), idle(20000)]); // a slow first start of the filter can't hold things up for ever
        await idle(700);
        if (stale()) return;
      }
      // 3) the cover slides over
      clearTimeout(state.introTimer);
      els.stage.classList.remove('intro');
      await idle(1700);
      if (stale()) return;
      // 4) colours
      if (state.artUrl) { await applyPalette(state.artUrl); }
      await idle(900);
      if (stale()) return;
      // 5) lyrics, waiting for the online search to finish
      await refreshLyricFiles();
      if (stale()) return;
      await showLyricsForCurrent();
      const t1 = Date.now();
      while (!stale() && state.fetching.has(vid) && Date.now() - t1 < 9000) await idle(250);
      await idle(900);
      if (stale()) return;
    } finally {
      if (state.stageId === mine) state.staging = false;
    }
    // 6) the song
    if (state.heldByUs) { state.heldByUs = false; P.cmd('play'); }
  }

  // Songs in other scripts are shown in English letters (the saved file keeps the original text).
  function shown(raw) {
    return state.romanize && window.Romanize ? window.Romanize.text(raw) : raw;
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
        state.lyricsData = L.parse(shown(state.lyricsRaw));
      } catch (_) {
        state.lyricsData = null;
      }
    }

    const vid = state.currentVideoId;
    // A Quran file saved earlier as plain text gets one try at being replaced by a version timed to the reciter.
    const vid0 = state.currentVideoId;
    if (match && state.autoFetch && /\.txt$/i.test(match.file) && state.lyricsRaw.includes('\uFD3E') && !state.upgraded.has(vid0) && !state.fetching.has(vid0)) {
      state.upgraded.add(vid0);
      fetchOnline(vid0, state.currentTitle, state.currentArtist, true);
    }
    const shouldLookUp =
      !state.lyricsData && state.autoFetch && state.currentTitle && !state.notFound.has(vid) && !state.fetching.has(vid);
    if (shouldLookUp) state.lyricsStatus = 'searching';
    renderLyrics();
    if (shouldLookUp) fetchOnline(vid, state.currentTitle, state.currentArtist);
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function fetchOnline(vid, title, author, timedOnly, retry, replaceFile) {
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
      res = await window.api.fetchLyrics({ title, track: query.track, artist: query.artist, author: author || '', duration, timedOnly: !!timedOnly, retry: retry || 0, replaceFile: replaceFile || '' });
    } catch (_) {
      res = { status: 'error' };
    }
    state.fetching.delete(vid);

    if (retry && res.status === 'own') { toast("Those lyrics are a file you made or edited, so the app won't replace them. Change them with Edit lyrics, or delete the file in the Lyrics folder."); return; }
    if (retry && (res.status === 'nomore' || res.status === 'notfound')) { state.retryN.set(vid, 0); toast('No other lyrics found for this song.'); return; }
    if (res.status === 'ok') {
      await refreshLyricFiles();
      if (state.currentVideoId === vid && els.editor.hidden) {
        await showLyricsForCurrent();
        toast(`${res.synced ? 'Found timed lyrics' : 'Found lyrics'} on ${res.source || 'LRCLIB'} and saved them` + (res.note ? (res.synced ? `. Note: ${res.note}. Use the Sync buttons to adjust` : `. Not timed to the reciter: ${res.note}`) : ''));
      }
      return;
    }
    if (timedOnly) { if (res.note && state.currentVideoId === vid) toast(`Quran text isn't timed to the reciter: ${res.note}`); return; } // the plain text already on screen stays
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
    if (MINI) MINI.lyrics({ status: state.lyricsStatus || '', synced: !!(data && data.synced), lines: data ? data.lines.map((l) => ({ time: l.time || 0, text: l.text })) : [] });
    els.lines.textContent = '';
    els.lyrics.classList.toggle('synced', !!(data && data.synced));
    // Arabic (Quran) text mixes right-to-left and left-to-right lines, so centre everything.
    els.lyrics.classList.toggle('centered', !!(data && data.lines.some((l) => /[\u0600-\u06FF]/.test(l.text))));
    els.lyrics.classList.toggle('plain', !!(data && !data.synced));
    els.btnEdit.textContent = data ? 'Edit lyrics' : 'Add lyrics';
    els.btnWrong.hidden = !(data && els.editor.hidden && state.lyricsFile && state.autoFetch);
    els.nudge.hidden = !(data && data.synced && els.editor.hidden && state.lyricsFile); // any song with timed lyrics
    { const off = (state.lyricsRaw.match(/^\s*\[offset:\s*(-?\d+)\s*\]/im) || [0, '0'])[1] | 0; els.nudgeVal.textContent = off ? `${off > 0 ? '+' : ''}${(off / 1000).toFixed(1)}s` : ''; }

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
      p.textContent = line.text.replace(/\u2028/g, '\n'); // an ayah's Arabic and its translation share one timed entry
      els.lines.appendChild(p);
    });
    els.lyrics.scrollTop = 0;
  }

  // A very long entry (a long Quran verse with its translation) would run past the lyrics area. It is shrunk until it
  // fits, once per line and screen height. (The line grows a little when it is the one being sung, so that is allowed for.)
  function fitLine(el) {
    const avail = els.lyrics.clientHeight;
    if (!avail || el.classList.contains('gap')) return;
    const key = String(avail);
    if (el.dataset.fit === key) return;
    el.style.fontSize = '';
    const limit = avail * 0.8;
    const grow = 1.14;
    let h = el.offsetHeight * grow;
    if (h > limit) {
      let px = parseFloat(getComputedStyle(el).fontSize) || 24;
      const floor = Math.max(14, px * 0.45);
      for (let i = 0; i < 8 && h > limit && px > floor; i++) {
        px = Math.max(floor, Math.floor(px * Math.max(0.6, Math.sqrt(limit / h)) * 0.97));
        el.style.fontSize = px + 'px';
        h = el.offsetHeight * grow;
      }
    }
    el.dataset.fit = key;
  }

  function syncLyrics(currentTime) {
    const data = state.lyricsData;
    if (!data || !data.synced) return;
    const idx = L.activeIndex(data.lines, currentTime + 0.15);
    if (idx === state.activeIdx) return;
    const prev = state.activeIdx;
    state.activeIdx = idx;

    // Only the lines that changed are touched (a long surah has hundreds of lines).
    const nodes = els.lines.children;
    if (prev >= 0 && idx > prev && idx - prev < 40 && state.paintedFor === data) {
      for (let i = prev; i < idx; i++) if (nodes[i]) { nodes[i].classList.remove('active'); nodes[i].classList.add('past'); }
      if (nodes[idx]) { nodes[idx].classList.remove('past'); nodes[idx].classList.add('active'); }
    } else {
      for (let i = 0; i < nodes.length; i++) {
        nodes[i].classList.toggle('active', i === idx);
        nodes[i].classList.toggle('past', i < idx);
      }
    }
    state.paintedFor = data;
    const el = nodes[idx];
    if (el) {
      fitLine(el);
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

  // Timed lyrics can be a little early or late for the version playing (and Quran timing comes from another recording): nudge them.
  async function nudgeLyrics(ms) {
    if (!state.lyricsFile || !state.lyricsRaw) return;
    const cur = (state.lyricsRaw.match(/^\s*\[offset:\s*(-?\d+)\s*\]/im) || [0, '0'])[1] | 0;
    const next = ms === null ? 0 : cur + ms;
    const tag = `[offset:${next}]`;
    const content = /^\s*\[offset:/im.test(state.lyricsRaw) ? state.lyricsRaw.replace(/^\s*\[offset:\s*-?\d+\s*\]/im, tag) : tag + '\n' + state.lyricsRaw;
    try {
      await window.api.writeLyrics({ title: state.currentTitle, content, existingFile: state.lyricsFile });
      state.lyricsRaw = content;
      state.lyricsData = L.parse(shown(content));
      state.activeIdx = -1;
      renderLyrics();
      els.nudgeVal.textContent = next ? `${next > 0 ? '+' : ''}${(next / 1000).toFixed(1)}s` : '';
    } catch (_) { toast("Couldn't save the sync change."); }
  }
  els.nudge.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    nudgeLyrics(b.dataset.ms === 'reset' ? null : Number(b.dataset.ms));
  });

  els.btnWrong.addEventListener('click', () => {
    const vid = state.currentVideoId;
    if (!vid || state.fetching.has(vid) || !state.lyricsFile) return;
    const n = (state.retryN.get(vid) || 0) + 1;
    state.retryN.set(vid, n);
    toast('Looking for another match…');
    fetchOnline(vid, state.currentTitle, state.currentArtist, false, n, state.lyricsFile);
  });

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

  els.btnPlay.addEventListener('click', () => { state.heldByUs = false; P.cmd('toggle'); });
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
    if (tag === 'INPUT' && !/^(range|checkbox|radio|button)$/.test(event.target.type)) return; // typing in a text or search box
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
      const src = linkOf(text);
      if (src) { showOverlay(); return offerLink(src); }
    }
    toast("Couldn't find a playlist, album or song link in what you dropped. Try pasting the link instead.");
    showOverlay();
  });

  els.btnLoad.addEventListener('click', () => submitUrl(els.urlInput.value));
  let searchTimer = 0;
  els.btnSearch.addEventListener('click', () => { clearTimeout(searchTimer); runSearch(); });
  els.searchInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { clearTimeout(searchTimer); runSearch(); } });
  els.searchInput.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 700); });
  els.urlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submitUrl(els.urlInput.value);
  });
  els.urlInput.addEventListener('paste', () => setTimeout(() => {
    if (linkOf(els.urlInput.value)) submitUrl(els.urlInput.value);
  }, 0));
  els.btnPlaylist.addEventListener('click', () => showOverlay());
  if (MINI) { els.btnMini.hidden = false; els.btnMini.addEventListener('click', () => MINI.toggle()); } // Windows only
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

  function applyRoman() {
    els.btnRoman.textContent = state.romanize ? 'English letters: on' : 'English letters: off';
  }
  els.btnRoman.addEventListener('click', () => {
    state.romanize = !state.romanize;
    applyRoman();
    window.api.setSettings({ romanize: state.romanize });
    if (state.lyricsRaw) {
      state.lyricsData = L.parse(shown(state.lyricsRaw));
      state.activeIdx = -1;
      renderLyrics();
    }
    toast(state.romanize ? 'Lyrics in other scripts now show in English letters.' : 'Lyrics show in their original script.');
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
    // The cover check runs an 8 MB image model; a TV stick starts with it off (it can be turned on with the button).
    state.coverFilter = settings.coverFilter === undefined && window.__lpTv ? false : settings.coverFilter !== false;
    state.coverOverrides = settings.coverOverrides && typeof settings.coverOverrides === 'object' ? settings.coverOverrides : {};
    applyCoverFilterButton();
    applyAds();
    applyAuto();
    state.romanize = settings.romanize !== false;
    applyRoman();
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
    if (window.__lpTv) await idle(2500); // let the first screen draw before YouTube Music starts loading

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
