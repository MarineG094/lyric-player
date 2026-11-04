/* Android shim. Gives the desktop player code (copied in below, unchanged) the things it expects,
   and defines window.api for the page. Everything the phone has to do natively goes through LPNative. */
(() => {
  const N = window.LPNative;
  const YT_URL = 'https://music.youtube.com/';
  const process = { env: {} };

  /* ---- promise bridge to Kotlin ---- */
  const pending = new Map();
  let seq = 0;
  window.__lpResolve = (id, json) => {
    const done = pending.get(id);
    if (!done) return;
    pending.delete(id);
    let value = null;
    try { value = json == null ? null : JSON.parse(json); } catch (_) { value = null; }
    done(value);
  };
  function native(method, args) {
    return new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      try { N.invoke(id, method, JSON.stringify(args || {})); } catch (e) { pending.delete(id); resolve(null); }
    });
  }

  /* ---- stand-ins for Electron / Node pieces the copied code touches ---- */
  const handlers = {};
  const ipcMain = { handle: (name, fn) => { handlers[name] = fn; }, on: () => {} };
  let settings = {};
  try { settings = JSON.parse(N.settings()) || {}; } catch (_) { settings = {}; }
  const loadSettings = () => settings;
  const saveSettings = (s) => { settings = s; try { N.mergeSettings(JSON.stringify(s)); } catch (_) { /* ignore */ } };
  const app = { getVersion: () => '1.0.0' };
  const clipboard = { writeText: (t) => { native('clipboard', { t: String(t) }); } };
  const fs = { writeFileSync: (file, content) => { N.writeLyrics(file, String(content)); } };
  const safeLyricsFile = (name) => {
    const base = String(name || '').split(/[\\/]/).pop();
    if (!/\.(lrc|txt)$/i.test(base)) throw new Error('Unsupported lyrics file type');
    return base;
  };
  // Lyric lookups go through the phone's own network stack (some of the lyric sites don't allow web pages to call them).
  const fetch = async (url, opts) => {
    const r = await native('http.get', { url, headers: (opts && opts.headers) || {} });
    if (!r || r.error) throw new Error((r && r.error) || 'network error');
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => JSON.parse(r.body) };
  };

  const stateCallbacks = [];
  function emit(s) {
    for (const cb of stateCallbacks) { try { cb(s); } catch (_) { /* ignore */ } }
    try {
      if (s && s.hasMedia && !s.ad) {
        N.nowPlaying(JSON.stringify({ title: s.title, artist: s.artist, album: s.album, art: s.art, dur: s.dur, cur: s.cur, playing: !!s.playing }));
      }
    } catch (_) { /* ignore */ }
  }
  const win = { isDestroyed: () => false, webContents: { send: (channel, s) => { if (channel === 'player:state') emit(s); } } };

  // The YouTube Music page lives in a second WebView; scripts are run there by the native side.
  const ytContents = {
    isDestroyed: () => false,
    executeJavaScript: async (script) => {
      const r = await native('yt.eval', { script });
      if (r && r.e) throw new Error(r.e);
      return r ? r.v : undefined;
    },
    loadURL: (url) => native('yt.load', { url }).then(() => undefined),
  };
  function layoutYt() { native('yt.layout', { browse: ytBrowse, top: ytTop }); }

let ytView = null;
let ytBrowse = false;
let ytTop = 64;
let ytDesiredVolume = null;
let adBlock = true;
let ytHistory = []; // video ids in play order, so Back can return to them even if the page ignores its own button
let ytListId = '';
let ytPolling = false;
let ytTimer = null;


// Runs inside the page: the <video> that is actually playing (the page can contain more than one).
const PICK_VIDEO = `const pickVideo = () => { const a = [...document.querySelectorAll('video')]; return a.find((v) => v.readyState > 0 && !v.paused) || a.find((v) => v.readyState > 0) || a[0] || null; };`;

// Runs inside the YouTube Music page. Returns plain JSON.
const probeScript = (desiredVolume, blockAds) => `(() => {
  ${PICK_VIDEO}
  try {
    const q = (s) => document.querySelector(s);
    const v = pickVideo();
    const bar = q('ytmusic-player-bar');
    const md = navigator.mediaSession && navigator.mediaSession.metadata;
    let title = md && md.title ? md.title : '';
    let artist = md && md.artist ? md.artist : '';
    let album = md && md.album ? md.album : '';
    let art = '';
    if (md && md.artwork && md.artwork.length) art = md.artwork[md.artwork.length - 1].src;
    if (!title) { const t = q('ytmusic-player-bar .title'); title = t ? t.textContent.trim() : ''; }
    if (!artist) { const b = q('ytmusic-player-bar .byline'); artist = b ? b.textContent.split('\\u2022')[0].trim() : ''; }
    if (!art) { const im = q('ytmusic-player-bar img.image'); art = im ? im.src : ''; }
    if (!title) { try { const pm = q('#movie_player'); const pr = pm && pm.getPlayerResponse && pm.getPlayerResponse(); const d = pr && pr.videoDetails; if (d) { title = d.title || ''; if (!artist) artist = String(d.author || '').replace(/ - Topic$/, ''); const th = d.thumbnail && d.thumbnail.thumbnails; if (!art && th && th.length) art = th[th.length - 1].url; } } catch (e) { /* keep empty */ } }
    if (art) art = art.replace(/=w\\d+-h\\d+[^"']*$/, '=w800-h800');
    const adNow = !!q('.ad-showing, .ad-interrupting');
    if (adNow && ${blockAds ? 'true' : 'false'}) {
      if (v) {
        if (!window.__lpMuted) { window.__lpMuted = true; window.__lpWasMuted = v.muted; }
        v.muted = true;
        v.playbackRate = 16;
        if (isFinite(v.duration) && v.duration > 0 && v.duration < 120) v.currentTime = v.duration;
      }
      for (const sel of ['.ytp-ad-skip-button', '.ytp-skip-ad-button', '.ytp-ad-skip-button-modern', '.ytp-ad-skip-button-container button']) {
        const b = q(sel);
        if (b) b.click();
      }
    } else if (window.__lpMuted) {
      window.__lpMuted = false;
      if (v) { v.muted = !!window.__lpWasMuted; v.playbackRate = 1; }
    }
    const want = ${desiredVolume == null ? 'null' : Number(desiredVolume)};
    if (v && want != null && Math.abs(v.volume * 100 - want) > 1.5) v.volume = Math.max(0, Math.min(1, want / 100));
    const vid = new URL(location.href).searchParams.get('v') || '';
    const items = [...document.querySelectorAll('ytmusic-player-queue-item')];
    let curIdx = vid ? items.findIndex((i) => i.data && i.data.videoId === vid) : -1;
    if (curIdx < 0) curIdx = items.findIndex((i) => i.hasAttribute('selected') || i.hasAttribute('is-playing') || i.getAttribute('play-button-state') === 'playing');
    return {
      hasMedia: !!(v && title),
      ad: adNow,
      videoId: new URL(location.href).searchParams.get('v') || '',
      title, artist, album, art,
      cur: v ? v.currentTime || 0 : 0,
      dur: v && isFinite(v.duration) ? v.duration : 0,
      playing: !!(v && !v.paused && !v.ended),
      ended: !!(v && v.ended),
      queueCount: items.length,
      queueIds: items.length < 600 ? items.map((i) => (i.data && i.data.videoId) || '').filter(Boolean) : [],
      curIdx,
      volume: v ? Math.round(v.volume * 100) : null,
      listId: new URL(location.href).searchParams.get('list') || '',
      url: location.href,
    };
  } catch (e) { return { hasMedia: false, error: String(e) }; }
})()`;

async function pollYt() {
  if (ytPolling || !ytView || !win || ytView.webContents.isDestroyed()) return;
  ytPolling = true;
  try {
    const state = await ytView.webContents.executeJavaScript(probeScript(ytDesiredVolume, adBlock), true);
    if (state && state.hasMedia && !state.ad && state.videoId) {
      if (ytHistory[ytHistory.length - 1] !== state.videoId) {
        ytHistory.push(state.videoId);
        if (ytHistory.length > 60) ytHistory.shift();
      }
      if (state.listId && !ctl.solo) ytListId = state.listId;
    }
    ctl.snap = state;
    if (state && state.hasMedia) controllerTick(state);
    if (win && !win.isDestroyed()) win.webContents.send('player:state', state);
  } catch (_) {
    /* page is navigating; try again next tick */
  } finally {
    ytPolling = false;
  }
}


const SELECTORS = {
  next: ['ytmusic-player-bar .next-button'],
  prev: ['ytmusic-player-bar .previous-button'],
  shuffle: ['ytmusic-player-bar .shuffle', 'ytmusic-player-bar [aria-label*="huffle" i]'],
  repeat: ['ytmusic-player-bar .repeat', 'ytmusic-player-bar [aria-label*="epeat" i]'],
};

function clickScript(kind) {
  return `(() => { for (const s of ${JSON.stringify(SELECTORS[kind])}) { const el = document.querySelector(s); if (el) { el.click(); return true; } } return false; })()`;
}

ipcMain.handle('player:open', (_e, id, videoId) => {
  if (!ytView) return false;
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(String(id || ''))) return false;
  ytHistory = [];
  ytListId = String(id);
  ctl.solo = false;
  ctl.order = [];
  ctl.orderLen = 0;
  ctl.pos = 0;
  ctl.ids = [];
  ctl.idsFor = '';
  ctl.idsTries = 0;
  const v = /^[A-Za-z0-9_-]{2,20}$/.test(String(videoId || '')) ? `v=${encodeURIComponent(videoId)}&` : '';
  ytView.webContents.loadURL(`${YT_URL}watch?${v}list=${encodeURIComponent(id)}`);
  return true;
});

// One song on its own: plays it and stops at the end (no endless "radio" of other songs).
ipcMain.handle('player:openSong', (_e, videoId) => {
  if (!ytView) return false;
  if (!/^[A-Za-z0-9_-]{2,20}$/.test(String(videoId || ''))) return false;
  ytHistory = [];
  ytListId = '';
  ctl.solo = true;
  ctl.order = [];
  ctl.orderLen = 0;
  ctl.pos = 0;
  ctl.ids = [];
  ctl.idsFor = '';
  ctl.idsTries = 0;
  ytView.webContents.loadURL(`${YT_URL}watch?v=${encodeURIComponent(videoId)}`);
  return true;
});

// Runs in the page: finds the playlist that holds an album's songs (the same request the site makes for an album page).
const albumPlaylistScript = (browseId) => `(async () => {
  try {
    const cfg = window.ytcfg;
    const get = (k) => (cfg && typeof cfg.get === 'function' ? cfg.get(k) : cfg && cfg.data_ ? cfg.data_[k] : undefined);
    const key = get('INNERTUBE_API_KEY');
    const context = get('INNERTUBE_CONTEXT');
    if (!key || !context) return '';
    const res = await fetch('/youtubei/v1/browse?prettyPrint=false&key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ context, browseId: ${JSON.stringify(browseId)} }),
    });
    if (!res.ok) return '';
    const data = await res.json();
    let found = '';
    const walk = (o) => {
      if (found || !o || typeof o !== 'object') return;
      if (typeof o.audioPlaylistId === 'string' && o.audioPlaylistId) { found = o.audioPlaylistId; return; }
      if (typeof o.playlistId === 'string' && /^OLAK5uy_/.test(o.playlistId)) { found = o.playlistId; return; }
      for (const k in o) walk(o[k]);
    };
    walk(data);
    return found;
  } catch (e) { return ''; }
})()`;

ipcMain.handle('player:resolveAlbum', async (_e, browseId) => {
  if (!ytView || !/^MPREb_[A-Za-z0-9_-]{4,60}$/.test(String(browseId || ''))) return '';
  const wc = ytView.webContents;
  wc.loadURL(`${YT_URL}browse/${encodeURIComponent(browseId)}`).catch(() => {});
  for (let i = 0; i < 25; i++) { // up to ~17 s while the page loads
    await wait(700);
    try {
      const id = await wc.executeJavaScript(albumPlaylistScript(browseId), true);
      if (id && /^[A-Za-z0-9_-]{6,80}$/.test(id)) return id;
    } catch (_) { /* page is still loading */ }
  }
  return '';
});

ipcMain.handle('player:browse', (_e, show, top) => {
  ytBrowse = !!show;
  if (Number.isFinite(top)) ytTop = Math.max(0, Math.min(300, Math.round(top)));
  layoutYt();
  return ytBrowse;
});

const videoDo = (body) => `(() => { ${PICK_VIDEO} const v = pickVideo(); if (v) { ${body} } })()`;
const songKey = `(() => { ${PICK_VIDEO} const v = pickVideo(); const m = navigator.mediaSession && navigator.mediaSession.metadata; return JSON.stringify({ href: location.href, title: m ? m.title : '', cur: v ? v.currentTime : 0 }); })()`;
const skipToEnd = videoDo('if (isFinite(v.duration) && v.duration > 1) v.currentTime = Math.max(0, v.duration - 0.4);');

const playerApi = (method) => `(() => { const p = document.querySelector('#movie_player'); if (p && typeof p.${method} === 'function') { p.${method}(); return true; } return false; })()`;


/* ---------- shuffle and repeat (handled here, not by clicking the page's buttons) ---------- */

const ctl = { trace: [], solo: false, shuffle: false, repeat: 'off', order: [], pos: 0, lastJump: 0, snap: null, spaWorks: null, spaFails: 0, ids: [], idsFor: '', idsAt: 0, idsTries: 0, idsBusy: false };
const enc = encodeURIComponent;

function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The playlist's song ids, in order: from YouTube Music's own playlist data, or failing that from the page's queue list.
function trackIds() {
  if (ctl.ids.length > 1) return ctl.ids;
  return (ctl.snap && ctl.snap.queueIds) || [];
}

// Runs in the page: asks YouTube Music for the playlist's songs (the same request the site makes when you open a playlist).
const playlistIdsScript = (listId) => `(async () => {
  const out = [];
  try {
    const cfg = window.ytcfg;
    const get = (k) => (cfg && typeof cfg.get === 'function' ? cfg.get(k) : cfg && cfg.data_ ? cfg.data_[k] : undefined);
    const key = get('INNERTUBE_API_KEY');
    const context = get('INNERTUBE_CONTEXT');
    if (key && context) {
      const url = '/youtubei/v1/browse?prettyPrint=false&key=' + encodeURIComponent(key);
      let body = { context, browseId: 'VL' + ${JSON.stringify(listId)} };
      for (let page = 0; page < 25; page++) {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'include' });
        if (!res.ok) break;
        const data = await res.json();
        let token = null;
        const walk = (o) => {
          if (!o || typeof o !== 'object') return;
          if (o.playlistItemData && o.playlistItemData.videoId) out.push(o.playlistItemData.videoId);
          if (!token && o.continuationCommand && o.continuationCommand.token) token = o.continuationCommand.token;
          for (const k in o) walk(o[k]);
        };
        walk(data);
        if (!token) break;
        body = { context, continuation: token };
      }
    }
  } catch (e) { /* the caller falls back to the queue list */ }
  return [...new Set(out)];
})()`;

async function ensureTrackIds() {
  if (!ytView || !ytListId || ctl.idsBusy || ctl.idsFor === ytListId) return;
  const now = Date.now();
  if (ctl.idsTries >= 4 || now - ctl.idsAt < 4000) return;
  ctl.idsBusy = true;
  ctl.idsAt = now;
  ctl.idsTries += 1;
  const listId = ytListId;
  try {
    const ids = await ytView.webContents.executeJavaScript(playlistIdsScript(listId), true);
    if (listId === ytListId && Array.isArray(ids) && ids.length > 1) { ctl.ids = ids; ctl.idsFor = listId; ctl.order = []; ctl.orderLen = 0; ctl.pos = 0; }
  } catch (_) { /* try again later */ }
  ctl.idsBusy = false;
}

// Next random song, never repeating until every song has played (the song you started on counts as already played).
// null when the round is over and repeat is off.
function nextShuffleId(forceNewRound) {
  const ids = trackIds();
  if (ids.length < 2) return null;
  const current = ctl.snap && ctl.snap.videoId;
  if (ctl.orderLen !== ids.length || ctl.orderList !== ids[0]) {
    ctl.order = shuffled(ids.filter((x) => x !== current));
    ctl.orderLen = ids.length;
    ctl.orderList = ids[0];
    ctl.pos = 0;
  }
  if (ctl.pos >= ctl.order.length) {
    // Song-end with repeat off stops here; pressing Next always starts a freshly shuffled round.
    if (ctl.repeat === 'off' && !forceNewRound) return null;
    ctl.order = shuffled(ids.filter((x) => x !== current));
    if (!ctl.order.length) ctl.order = ids.slice();
    ctl.pos = 0;
  }
  let id = ctl.order[ctl.pos++];
  if (id === current && ctl.pos < ctl.order.length) id = ctl.order[ctl.pos++]; // don't "shuffle" to the song already playing
  return id;
}

// Runs in the page: switch to a song inside YouTube Music without reloading the page, if the site lets us.
const spaNavigateScript = (videoId, listId) => `(async () => {
  const app = document.querySelector('ytmusic-app');
  const endpoint = { watchEndpoint: { videoId: ${JSON.stringify(videoId)}, playlistId: ${JSON.stringify(listId)} } };
  const arrived = () => new URL(location.href).searchParams.get('v') === ${JSON.stringify(videoId)};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const settle = async () => { for (let i = 0; i < 9 && !arrived(); i++) await wait(150); return arrived(); };
  try {
    if (app && typeof app.navigate_ === 'function') app.navigate_(endpoint);
    else if (app && typeof app.navigate === 'function') app.navigate(endpoint);
    if (await settle()) return true;
  } catch (e) { /* try the next way */ }
  try {
    if (app) app.dispatchEvent(new CustomEvent('yt-navigate', { detail: { endpoint }, bubbles: true, composed: true }));
    if (await settle()) return true;
  } catch (e) { /* fall back to loading the page */ }
  return false;
})()`;

// Play one specific song of the playlist: inside the page if possible, otherwise by loading its address.
async function playTrack(id) {
  if (!ytView) return false;
  ctl.lastJump = Date.now();
  const wc = ytView.webContents;
  let ok = false;
  // Once switching inside the page has failed, don't waste time on it again: load the song's address straight away.
  if (ctl.spaWorks !== false) {
    try { ok = await wc.executeJavaScript(spaNavigateScript(id, ytListId), true); } catch (_) { ok = false; }
    ctl.spaFails = ok ? 0 : ctl.spaFails + 1;
    ctl.spaWorks = ok ? true : ctl.spaFails >= 2 ? false : null; // two misses in a row: stop trying
  }
  if (!ok && ytView) wc.loadURL(`${YT_URL}watch?v=${enc(id)}${ytListId ? `&list=${enc(ytListId)}` : ''}`);
  ctl.lastJump = Date.now();
  return true;
}

function openInList(query) {
  if (!ytView) return;
  ctl.lastJump = Date.now();
  ytView.webContents.loadURL(`${YT_URL}watch?${query}`);
}

// Called after every poll. Handles what should happen when a song reaches its end.
function controllerTick(s) {
  if (s.ad || !ytView) return;
  ensureTrackIds();
  const now = Date.now();
  const atEnd = s.dur > 5 && (s.ended || s.cur >= s.dur - 0.9);
  if (!atEnd || now - ctl.lastJump < 3000) return;

  if (ctl.solo) {
    // A single song: repeat plays it again, otherwise it stops and waits at the start.
    ctl.lastJump = now;
    ytView.webContents.executeJavaScript(videoDo(ctl.repeat !== 'off' ? 'v.currentTime = 0; v.play();' : 'v.pause(); v.currentTime = 0;'), true).catch(() => {});
    return;
  }
  if (ctl.repeat === 'one') {
    ctl.lastJump = now;
    ytView.webContents.executeJavaScript(videoDo('v.currentTime = 0; v.play();'), true).catch(() => {});
    return;
  }
  if (ctl.shuffle) {
    const id = nextShuffleId();
    if (id) { playTrackVerified(id); return; }
    if (ctl.repeat !== 'off') return;
  }
  const ids = trackIds();
  if (ctl.repeat === 'all' && ytListId) {
    const i = ids.length ? ids.indexOf(s.videoId) : s.curIdx;
    const last = ids.length ? ids.length - 1 : s.queueCount - 1;
    if (i >= 0 && i === last) {
      if (ids.length) playTrack(ids[0]);
      else openInList(`list=${enc(ytListId)}`); // last song finished: start the playlist again
    }
  }
}

// Back in shuffle mode (or when the page ignores its own Back): open the song that played before this one.
function openPreviousFromHistory(currentHref) {
  const current = currentHref && /[?&]v=([^&]+)/.exec(currentHref);
  const stack = ytHistory.slice();
  if (current && stack[stack.length - 1] === current[1]) stack.pop();
  const prevId = stack.pop();
  if (!prevId) return false;
  ytHistory = stack; // the song we're opening gets pushed again once it plays
  playTrackVerified(prevId);
  return true;
}

const callAction = (name) => `(() => { const f = window.__lpActions && window.__lpActions['${name}']; if (typeof f === 'function') { f({ action: '${name}' }); return true; } return false; })()`;


// Did playback really move to a different song? (Compares what was playing before with what is playing now.)
async function trackChanged(wc, before) {
  try {
    const after = JSON.parse(await wc.executeJavaScript(songKey, true));
    if (!before) return true;
    return after.title !== before.title || (before.cur > 6 && after.cur < before.cur - 4);
  } catch (_) {
    return true; // the page is reloading, so something changed
  }
}

// Plays one specific song and makes sure it really started. If the page didn't switch, it escalates:
// load the song's address, and as a last resort just skip the current song to its end.
async function playTrackVerified(id) {
  if (!ytView) return false;
  const wc = ytView.webContents;
  const t0 = Date.now();
  const tr = (msg) => { ctl.trace.push(`+${Date.now() - t0}ms ${msg}`); if (ctl.trace.length > 40) ctl.trace.shift(); };
  ctl.trace.push(`--- jump to ${id} (spa=${ctl.spaWorks})`);
  let before = null;
  try { before = JSON.parse(await wc.executeJavaScript(songKey, true)); } catch (_) { /* ignore */ }
  tr('got current song');

  await playTrack(id);
  tr('in-page navigation done (spaWorks=' + ctl.spaWorks + ')');
  (async () => {
    try {
      for (let i = 0; i < 8; i++) { // poll so the trace shows when the song really changed
        await wait(250);
        if (await trackChanged(wc, before)) { tr('song changed'); return; }
      }
      ctl.spaWorks = false; // switching inside the page didn't really work
      ctl.lastJump = Date.now();
      tr('no change after 2s, reloading the page');
      wc.loadURL(`${YT_URL}watch?v=${enc(id)}${ytListId ? `&list=${enc(ytListId)}` : ''}`);
      for (let i = 0; i < 22; i++) {
        await wait(250);
        if (await trackChanged(wc, before)) { tr('song changed after reload'); return; }
      }
      tr('still no change, skipping to the end of the current song');
      await wc.executeJavaScript(skipToEnd, true);
    } catch (_) { /* ignore */ }
  })();
  return true;
}

// Moves forward by one song using only things that always exist: the page's next handler, then the end-of-song jump.
async function advanceOnce(wc) {
  let before = null;
  try { before = JSON.parse(await wc.executeJavaScript(songKey, true)); } catch (_) { /* ignore */ }
  await wc.executeJavaScript(callAction('nexttrack'), true).catch(() => {});
  await wait(1000);
  if (await trackChanged(wc, before)) return;
  await wc.executeJavaScript(skipToEnd, true).catch(() => {});
  for (let i = 0; i < 12; i++) { // wait (up to ~3s) for the new song to show up
    await wait(250);
    if (await trackChanged(wc, before)) return;
  }
}

async function songMoved(wc, before) {
  try {
    const after = JSON.parse(await wc.executeJavaScript(songKey, true));
    return !before || after.href !== before.href || after.title !== before.title;
  } catch (_) {
    return true; // page is navigating, so something changed
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Next / previous, in layers: the page's own button, then the page's player API,
// then something we can always do ourselves (jump to the end for next, open the song played before for previous).
async function stepTrack(wc, name) {
  let before = null;
  try { before = JSON.parse(await wc.executeJavaScript(songKey, true)); } catch (_) { /* ignore */ }

  // A single song has nothing to move to: Next / Back just start it over.
  if (ctl.solo) {
    await wc.executeJavaScript(videoDo('v.currentTime = 0; v.play();'), true).catch(() => {});
    return true;
  }

  // Shuffle is ours: Next picks a random song, Back opens the one that played before.
  if (ctl.shuffle && ytListId) {
    if (name === 'next') {
      await ensureTrackIds();
      const id = nextShuffleId(true);
      if (id) return playTrackVerified(id);
      // The playlist's song list couldn't be read: hop forward a random number of songs.
      const hops = 1 + Math.floor(Math.random() * 6);
      (async () => { for (let i = 0; i < hops; i++) await advanceOnce(wc); })();
      return true;
    }
    if (name === 'prev' && openPreviousFromHistory(before && before.href)) return true;
  }

  // Layers: the page's media-key handler, then its button, then its player API,
  // then something we can always do ourselves (jump to the end for next, history for previous).
  let pressed = await wc.executeJavaScript(callAction(name === 'next' ? 'nexttrack' : 'previoustrack'), true);
  if (!pressed) pressed = await wc.executeJavaScript(clickScript(name), true);

  const after = async () => {
    await wait(1400);
    if (await songMoved(wc, before)) return true;
    await wc.executeJavaScript(playerApi(name === 'next' ? 'nextVideo' : 'previousVideo'), true);
    await wait(1400);
    return songMoved(wc, before);
  };

  // Runs in the background so the button press returns right away.
  (async () => {
    try {
      if (await after()) return;
      if (name === 'next') await wc.executeJavaScript(skipToEnd, true);
      else openPreviousFromHistory(before && before.href);
    } catch (_) { /* ignore */ }
  })();
  return pressed;
}

ipcMain.handle('player:cmd', async (_e, name, arg) => {
  if (!ytView) return false;
  const wc = ytView.webContents;
  const num = Number(arg);
  try {
    switch (name) {
      case 'play': await wc.executeJavaScript(videoDo('v.play();'), true); return true;
      case 'pause': await wc.executeJavaScript(videoDo('v.pause();'), true); return true;
      case 'toggle': await wc.executeJavaScript(videoDo('if (v.paused) v.play(); else v.pause();'), true); return true;
      case 'next': case 'prev': return await stepTrack(wc, name);
      case 'setShuffle': ctl.shuffle = !!arg; ctl.order = []; ctl.orderLen = 0; ctl.pos = 0; return true;
      case 'setRepeat': ctl.repeat = ['off', 'all', 'one'].includes(arg) ? arg : 'off'; return true;
      case 'seek':
        if (!Number.isFinite(num) || num < 0) return false;
        await wc.executeJavaScript(videoDo(`v.currentTime = ${num};`), true);
        return true;
      case 'volume':
        if (!Number.isFinite(num)) return false;
        ytDesiredVolume = Math.max(0, Math.min(100, num));
        return true;
      case 'reload':
        wc.loadURL(YT_URL);
        return true;
      default: return false;
    }
  } catch (_) {
    return false;
  }
});

// A text report of what the YouTube Music page looks like to the app, for troubleshooting (copied to the clipboard).
const diagnoseScript = `(() => {
  const bar = document.querySelector('ytmusic-player-bar');
  const buttons = bar ? [...bar.querySelectorAll('tp-yt-paper-icon-button, button, [role="button"]')].map((b) => ({
    tag: b.tagName.toLowerCase(), cls: String(b.className).slice(0, 70), aria: b.getAttribute('aria-label'), title: b.getAttribute('title'), shown: b.offsetParent !== null,
  })) : null;
  const items = [...document.querySelectorAll('ytmusic-player-queue-item')];
  return {
    url: location.href,
    viewport: innerWidth + 'x' + innerHeight,
    mediaKeyHandlers: Object.keys(window.__lpActions || {}),
    playerBar: !!bar,
    buttons,
    videos: [...document.querySelectorAll('video')].map((v) => ({ ready: v.readyState, paused: v.paused, dur: v.duration })),
    moviePlayerApi: (() => { const p = document.querySelector('#movie_player'); return p ? ['nextVideo', 'previousVideo', 'getPlaylistIndex', 'playVideoAt', 'loadVideoById', 'getPlaylist'].filter((m) => typeof p[m] === 'function') : null; })(),
    moviePlayerMethods: (() => { const p = document.querySelector('#movie_player'); return p ? Object.keys(p).filter((k) => typeof p[k] === 'function').slice(0, 120) : null; })(),
    appMethods: (() => { const a = document.querySelector('ytmusic-app'); return a ? Object.keys(a).filter((k) => typeof a[k] === 'function' && /nav|play|queue|next/i.test(k)).slice(0, 40) : null; })(),
    queueItems: items.length,
    queueItemAttrs: items[0] ? [...items[0].attributes].map((a) => a.name) : null,
  };
})()`;

ipcMain.handle('player:diagnose', async () => {
  if (!ytView) return 'No YouTube Music view.';
  let report;
  try { report = await ytView.webContents.executeJavaScript(diagnoseScript, true); } catch (err) { report = { error: String(err) }; }
  report.nextTrace = ctl.trace.slice();
  report.app = { shuffle: ctl.shuffle, repeat: ctl.repeat, history: ytHistory.length, listId: ytListId, snap: ctl.snap && { title: ctl.snap.title, queueCount: ctl.snap.queueCount, curIdx: ctl.snap.curIdx }, playlistSongsKnown: ctl.ids.length, queueSongsKnown: ((ctl.snap && ctl.snap.queueIds) || []).length };
  const text = JSON.stringify(report, null, 1);
  clipboard.writeText(text);
  return text.length;
});


const LRCLIB = (process.env.LRCLIB_BASE || 'https://lrclib.net') + '/api';
const NETEASE = process.env.NETEASE_BASE || 'https://music.163.com';
const LYRICS_OVH = process.env.LYRICS_OVH_BASE || 'https://api.lyrics.ovh';
const QURAN_API = process.env.QURAN_BASE || 'https://api.alquran.cloud';

async function jsonGet(label, url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': `Lyric Player/${app.getVersion()} (personal desktop player)`, ...(headers || {}) },
      signal: controller.signal,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${label} answered HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`${label} took too long to answer`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const lrclibRequest = (pathAndQuery) => jsonGet('LRCLIB', LRCLIB + pathAndQuery);

function hasLyrics(r) {
  return r && !r.instrumental && (r.syncedLyrics || r.plainLyrics);
}

// Source 1: LRCLIB. Returns { syncedLyrics?, plainLyrics?, instrumental? } or null.
async function fromLrclib(track, artist, seconds) {
  const exact = new URLSearchParams({ track_name: track, artist_name: artist || '' });
  if (seconds > 0) exact.set('duration', String(seconds));
  let hit = await lrclibRequest('/get?' + exact);
  if (hit && (hit.instrumental || hasLyrics(hit))) return hit;

  const results = await lrclibRequest('/search?' + new URLSearchParams({ track_name: track, artist_name: artist || '' }));
  if (!Array.isArray(results)) return null;
  const usable = results.filter(hasLyrics);
  // With a known length, only accept results within 10 seconds of it so we don't show a different version's timing.
  const close = seconds > 0 ? usable.filter((r) => Math.abs((r.duration || 0) - seconds) <= 10) : usable;
  close.sort((a, b) => Math.abs((a.duration || 0) - seconds) - Math.abs((b.duration || 0) - seconds));
  return close[0] || null;
}

// Source 2: NetEase Cloud Music (timed lyrics). Strict matching so a different song is never shown.
async function fromNetease(track, artist, seconds) {
  const headers = { Referer: NETEASE + '/' };
  const q = `${artist || ''} ${track}`.trim();
  const found = await jsonGet('NetEase', `${NETEASE}/api/search/get?` + new URLSearchParams({ s: q, type: '1', limit: '8' }), headers);
  const songs = (found && found.result && found.result.songs) || [];
  const nt = Lyrics.normalize(track);
  const na = Lyrics.normalize(artist);
  const candidates = songs.filter((song) => {
    const name = Lyrics.normalize(song.name);
    const titleOk = name === nt || name.startsWith(nt + ' ') || nt.startsWith(name + ' ');
    const artists = (song.artists || song.ar || []).map((x) => Lyrics.normalize(x.name));
    const artistOk = !na || artists.some((x) => x && (x.includes(na) || na.includes(x)));
    const dur = (song.duration || song.dt || 0) / 1000;
    const lengthOk = !(seconds > 0 && dur > 0) || Math.abs(dur - seconds) <= 10;
    return titleOk && artistOk && lengthOk;
  });
  for (const song of candidates.slice(0, 3)) {
    const data = await jsonGet('NetEase', `${NETEASE}/api/song/lyric?` + new URLSearchParams({ id: String(song.id), lv: '1', kv: '1', tv: '-1' }), headers);
    const lrc = data && data.lrc && data.lrc.lyric;
    if (lrc && Lyrics.hasTimestamps(lrc) && lrc.split('\n').length > 3) return { syncedLyrics: lrc };
  }
  return null;
}

// Source 3: lyrics.ovh (plain text, needs the artist).
async function fromLyricsOvh(track, artist) {
  if (!artist) return null;
  const data = await jsonGet('lyrics.ovh', `${LYRICS_OVH}/v1/${encodeURIComponent(artist)}/${encodeURIComponent(track)}`);
  let text = data && typeof data.lyrics === 'string' ? data.lyrics.replace(/\r\n/g, '\n').trim() : '';
  text = text.replace(/^Paroles de la chanson[^\n]*\n+/i, '').trim();
  return text.length > 20 ? { plainLyrics: text } : null;
}

// Quran recitations: the surah's Arabic text with an English translation (Al-Quran Cloud). Plain text, not timed.
async function fromQuran(title, artist) {
  const hit = Quran.detect(title, artist);
  if (!hit) return null;
  const data = await jsonGet('Al-Quran Cloud', `${QURAN_API}/v1/surah/${hit.surah}/editions/quran-uthmani,en.sahih`);
  const editions = data && Array.isArray(data.data) ? data.data : [];
  const arabic = editions[0] && editions[0].ayahs;
  const english = editions[1] && editions[1].ayahs;
  if (!Array.isArray(arabic) || !arabic.length) return null;
  return { plainLyrics: Quran.buildText(arabic, english, hit.from, hit.to) };
}

ipcMain.handle('lyrics:fetch', async (_event, { title, track, artist, duration }) => {
  if (loadSettings().autoFetch === false) return { status: 'disabled' };
  if (!track) return { status: 'notfound' };

  // A Quran recitation gets the Quran text; if that service can't be reached we carry on to the normal sources.
  try {
    const quran = await fromQuran(title || track, artist);
    if (quran) {
      const file = Lyrics.sanitizeFileName(title || track) + '.txt';
      fs.writeFileSync(safeLyricsFile(file), quran.plainLyrics, 'utf8');
      return { status: 'ok', file, synced: false, source: 'Al-Quran Cloud' };
    }
  } catch (_) { /* fall through */ }

  const seconds = Math.round(Number(duration) || 0);
  const sources = [
    ['LRCLIB', () => fromLrclib(track, artist, seconds)],
    ['NetEase', () => fromNetease(track, artist, seconds)],
    ['lyrics.ovh', () => fromLyricsOvh(track, artist)],
  ];
  let best = null; // { hit, source }
  let attempted = 0;
  let failed = 0;
  let lastError = '';
  for (const [name, lookup] of sources) {
    if (best && name === 'lyrics.ovh') break; // already have plain text; only look further for timed lyrics
    attempted += 1;
    try {
      const r = await lookup();
      if (!r) continue;
      if (r.instrumental) return { status: 'instrumental' };
      if (r.syncedLyrics) { best = { hit: r, source: name }; break; }
      if (r.plainLyrics && !best) best = { hit: r, source: name }; // keep looking for timed lyrics
    } catch (err) {
      failed += 1;
      lastError = err.message;
    }
  }

  if (!best) return failed === attempted ? { status: 'error', message: lastError } : { status: 'notfound' };
  const content = best.hit.syncedLyrics || best.hit.plainLyrics;
  const synced = Lyrics.hasTimestamps(content);
  const file = Lyrics.sanitizeFileName(title || track) + (synced ? '.lrc' : '.txt');
  fs.writeFileSync(safeLyricsFile(file), content, 'utf8');
  return { status: 'ok', file, synced, source: best.source };
});



  ytView = { webContents: ytContents };

  ipcMain.handle('settings:set', (_e, patch) => {
    settings = { ...settings, ...(patch || {}) };
    try { N.mergeSettings(JSON.stringify(patch || {})); } catch (_) { /* ignore */ }
    return settings;
  });

  ipcMain.handle('adblock:set', async (_e, on) => {
    adBlock = !!on;
    saveSettings({ ...loadSettings(), adBlock });
    await native('adblock', { on: adBlock });
    try { await ytContents.executeJavaScript(`(window.__lpAdPrune ? (window.__lpAdPrune.enabled = ${adBlock}) : null)`); } catch (_) { /* ignore */ }
    return adBlock;
  });
  adBlock = settings.adBlock !== false;

  // The native side calls this a few times a second (a web page's own timers get slowed down in the background).
  let lastLine = null;
  window.__lpTick = () => {
    pollYt();
    try {
      const el = document.querySelector('.lyrics .line.active');
      const text = el ? el.textContent.trim() : '';
      if (text !== lastLine) { lastLine = text; N.lyricLine(text); }
    } catch (_) { /* ignore */ }
  };
  window.__lpCmd = (name, arg) => handlers['player:cmd'](null, name, arg);

  const decode64 = (b64) => {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const paletteCache = new Map();

  const diagBtn = document.getElementById('btnDiag');
  if (diagBtn) {
    diagBtn.addEventListener('click', async () => {
      const t = document.getElementById('toast');
      const say = (m) => { if (t) { t.textContent = m; t.hidden = false; setTimeout(() => { t.hidden = true; }, 7000); } };
      try {
        const info = await handlers['player:diagnose']();
        say('Copied. Paste it into your message to me. (' + info + ')');
      } catch (e) { say('Diagnose failed: ' + e); }
    });
  }

  window.api = {
    getSettings: async () => loadSettings(),
    setSettings: async (patch) => handlers['settings:set'](null, patch),
    getLyricsDir: async () => N.lyricsDir(),
    listLyrics: async () => JSON.parse(N.listLyrics()),
    readLyrics: async (file) => {
      const text = N.readLyrics(safeLyricsFile(file));
      if (text == null) throw new Error('Lyrics file not found');
      return String(text).replace(/^﻿/, '');
    },
    writeLyrics: async ({ title, content, existingFile }) => {
      let fileName;
      if (existingFile) fileName = safeLyricsFile(existingFile);
      else fileName = safeLyricsFile(Lyrics.sanitizeFileName(title) + (Lyrics.hasTimestamps(content) ? '.lrc' : '.txt'));
      N.writeLyrics(fileName, String(content || ''));
      return { file: fileName };
    },
    fetchLyrics: (payload) => handlers['lyrics:fetch'](null, payload),
    chooseLyricsFolder: async () => null,
    setAdBlock: (on) => handlers['adblock:set'](null, on),
    getThumb: async (url) => {
      try {
        const r = await native('art.thumb', { url, size: 224 });
        if (!r || !r.b64) return null;
        return { w: r.w, h: r.h, data: decode64(r.b64) };
      } catch (_) { return null; }
    },
    getPalette: async (url) => {
      try {
        if (paletteCache.has(url)) return paletteCache.get(url);
        const r = await native('art.thumb', { url, size: 24 });
        if (!r || !r.b64) return null;
        const p = window.Palette.fromPixels(decode64(r.b64), 'rgba');
        if (paletteCache.size > 200) paletteCache.clear();
        paletteCache.set(url, p);
        return p;
      } catch (_) { return null; }
    },
    fullscreen: async () => false,
    onFullscreen: () => {},
    player: {
      diagnose: () => handlers['player:diagnose'](),
      open: (id, videoId) => handlers['player:open'](null, id, videoId),
      openSong: (videoId) => handlers['player:openSong'](null, videoId),
      resolveAlbum: (browseId) => handlers['player:resolveAlbum'](null, browseId),
      // The phone's own volume buttons set the loudness; the page's volume stays at full.
      cmd: (name, arg) => (name === 'volume' ? Promise.resolve(true) : handlers['player:cmd'](null, name, arg)),
      browse: (show, top) => handlers['player:browse'](null, show, top),
      onState: (cb) => { stateCallbacks.push(cb); },
    },
    openLyricsFolder: async () => {},
  };
})();
