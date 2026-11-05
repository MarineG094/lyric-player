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
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => JSON.parse(r.body), text: async () => String(r.body) };
  };

  let fsOn = false;
  let fsCb = null;
  window.__lpBack = () => { if (fsOn) { window.api.fullscreen(false); return true; } return false; }; // Back leaves full screen first
  const stateCallbacks = [];
  function emit(s) {
    for (const cb of stateCallbacks) { try { cb(s); } catch (_) { /* ignore */ } }
    try {
      if (s && s.hasMedia && !s.ad) {
        // Cover filter verdict for this song's cover: s = fine to show, c = still checking, h = hidden.
        const box = document.getElementById('albumBox');
        const veil = document.getElementById('coverVeil');
        const cover = !(box && box.classList.contains('cover-hidden')) ? 's' : (veil && !veil.hidden ? 'h' : 'c');
        N.nowPlaying(JSON.stringify({ title: s.title, artist: s.artist, album: s.album, art: s.art, dur: s.dur, cur: s.cur, playing: !!s.playing, cover }));
      }
    } catch (_) { /* ignore */ }
  }
  const win = { isDestroyed: () => false, isMinimized: () => false, isVisible: () => true, webContents: { send: (channel, s) => { if (channel === 'player:state') emit(s); } } };

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
let ytTick = 0;
let ytTimer = null;


// Runs inside the page: the <video> that is actually playing (the page can contain more than one).
const PICK_VIDEO = `const pickVideo = () => { const a = [...document.querySelectorAll('video')]; return a.find((v) => v.readyState > 0 && !v.paused) || a.find((v) => v.readyState > 0) || a[0] || null; };`;

// Runs inside the YouTube Music page. Returns plain JSON.
const probeScript = (desiredVolume, blockAds, wantId) => `(() => {
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
    // The queue is a big list of components; walking it is the costly part of a look. So it is only walked when the
    // song, the list or the wanted song changed (or every 5 seconds); otherwise the last answer is reused.
    const nl = document.querySelectorAll('ytmusic-player-queue-item');
    const qc = window.__lpQ || (window.__lpQ = { n: -1, t: 0, vid: null, want: null });
    const tNow = Date.now();
    const wantVid = ${JSON.stringify(wantId || '')};
    let queueIds;
    if (nl.length !== qc.n || vid !== qc.vid || wantVid !== qc.want || tNow - qc.t > 5000) {
      const items = [...nl];
      if (items.length !== qc.n || tNow - qc.t > 5000) {
        queueIds = items.length < 600 ? items.map((i) => (i.data && i.data.videoId) || '').filter(Boolean) : [];
      }
      const metaOf = (it) => {
        const d = it && it.data;
        if (!d || !d.videoId) return null;
        const runs = (x) => ((x && x.runs) || []).map((r) => r.text);
        const th = (d.thumbnail && d.thumbnail.thumbnails) || [];
        return { id: d.videoId, title: runs(d.title).join(''), sub: runs(d.shortBylineText).join('').split(' \u2022 ')[0].trim(), thumb: th.length ? th[th.length - 1].url : '' };
      };
      let ci = vid ? items.findIndex((i) => i.data && i.data.videoId === vid) : -1;
      if (ci < 0) ci = items.findIndex((i) => i.hasAttribute('selected') || i.hasAttribute('is-playing') || i.getAttribute('play-button-state') === 'playing');
      qc.n = items.length; qc.t = tNow; qc.vid = vid; qc.want = wantVid; qc.curIdx = ci;
      qc.wantMeta = wantVid ? metaOf(items.find((i) => i.data && i.data.videoId === wantVid)) : null;
      qc.nextMeta = ci >= 0 ? metaOf(items[ci + 1]) : null;
    }
    const items = { length: qc.n };
    const curIdx = qc.curIdx;
    const wantMeta = qc.wantMeta;
    const nextMeta = qc.nextMeta;
    return {
      wantMeta, nextMeta,
      hasMedia: !!(v && title),
      ad: adNow,
      videoId: new URL(location.href).searchParams.get('v') || '',
      title, artist, album, art,
      cur: v ? v.currentTime || 0 : 0,
      dur: v && isFinite(v.duration) ? v.duration : 0,
      playing: !!(v && !v.paused && !v.ended),
      ended: !!(v && v.ended),
      queueCount: items.length,
      queueIds,
      curIdx,
      volume: v ? Math.round(v.volume * 100) : null,
      listId: new URL(location.href).searchParams.get('list') || '',
      url: location.href,
    };
  } catch (e) { return { hasMedia: false, error: String(e) }; }
})()`;

async function pollYt() {
  if (ytPolling || !ytView || !win || ytView.webContents.isDestroyed()) return;
  // Minimised or hidden: look a quarter as often, except near the end of a song so the next one still starts on time.
  if (win.isMinimized() || !win.isVisible()) {
    ytTick = (ytTick + 1) % 4;
    const near = ctl.snap && ctl.snap.dur > 0 && ctl.snap.dur - ctl.snap.cur < 6;
    if (ytTick && !near) return;
  }
  ytPolling = true;
  try {
    const state = await ytView.webContents.executeJavaScript(probeScript(ytDesiredVolume, adBlock, ctl.wantId), true);
    if (state && state.hasMedia && !state.ad && state.videoId) {
      if (ytHistory[ytHistory.length - 1] !== state.videoId) {
        ytHistory.push(state.videoId);
        if (ytHistory.length > 60) ytHistory.shift();
      }
      if (state.listId && !ctl.solo) ytListId = state.listId;
    }
    ctl.snap = state;
    if (state && Array.isArray(state.queueIds)) ctl.qids = state.queueIds;
    if (state && state.hasMedia) controllerTick(state);
    if (state) { learnMeta(state); state.next = computeNext(state); }
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
  ctl.divert = null;
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
  ctl.divert = null;
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

// Runs in the page: searches YouTube Music (the same request its search box makes) and returns songs, albums and playlists.
const searchScript = (query) => `(async () => {
  try {
    const cfg = window.ytcfg;
    const get = (k) => (cfg && typeof cfg.get === 'function' ? cfg.get(k) : cfg && cfg.data_ ? cfg.data_[k] : undefined);
    const key = get('INNERTUBE_API_KEY');
    const context = get('INNERTUBE_CONTEXT');
    if (!key || !context) return JSON.stringify({ wait: true });
    const res = await fetch('/youtubei/v1/search?prettyPrint=false&key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ context, query: ${JSON.stringify(query)} }),
    });
    if (!res.ok) return JSON.stringify({ error: 'YouTube Music answered HTTP ' + res.status });
    const data = await res.json();
    const items = [];
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (o.musicResponsiveListItemRenderer) { items.push(o.musicResponsiveListItemRenderer); return; }
      for (const k in o) walk(o[k]);
    };
    walk(data);
    const text = (col) => ((col && col.musicResponsiveListItemFlexColumnRenderer && col.musicResponsiveListItemFlexColumnRenderer.text && col.musicResponsiveListItemFlexColumnRenderer.text.runs) || []).map((r) => r.text);
    const out = [];
    const seen = new Set();
    for (const it of items) {
      const cols = it.flexColumns || [];
      const title = (text(cols[0])[0] || '').trim();
      const sub = text(cols[1]);
      if (!title) continue;
      const type = String(sub[0] || '').trim();
      if (/^(artist|podcast|episode|profile|station)$/i.test(type)) continue;
      let thumb = '';
      try { const th = it.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails; thumb = th[th.length - 1].url; } catch (e) { /* none */ }
      const browse = (it.navigationEndpoint && it.navigationEndpoint.browseEndpoint && it.navigationEndpoint.browseEndpoint.browseId) || '';
      let play = null;
      try { play = it.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer.playNavigationEndpoint; } catch (e) { /* none */ }
      const watch = play && (play.watchEndpoint || play.watchPlaylistEndpoint) || null;
      let kind = '', id = '';
      if (/^MPREb_/.test(browse)) { kind = 'album'; id = browse; }
      else if (/^VL/.test(browse)) { kind = 'list'; id = browse.slice(2); }
      else if (watch && watch.videoId && /^[A-Za-z0-9_-]{11}$/.test(watch.videoId)) { kind = 'song'; id = watch.videoId; }
      else if (watch && watch.playlistId) { kind = 'list'; id = watch.playlistId; }
      if (!kind || seen.has(kind + id)) continue;
      seen.add(kind + id);
      const detail = sub.slice(1).join('').replace(/^[\\s•·]+/, '').trim();
      out.push({ kind, id, title, sub: detail || type, type, thumb });
      if (out.length >= 24) break;
    }
    return JSON.stringify({ results: out });
  } catch (e) { return JSON.stringify({ error: String(e && e.message || e) }); }
})()`;

async function searchYt(query) {
  const q = String(query || '').trim().slice(0, 120);
  if (!ytView || q.length < 2) return { results: [] };
  const wc = ytView.webContents;
  let last = 'YouTube Music is still loading';
  for (let i = 0; i < 20; i++) { // the page may still be starting up (up to ~14 s)
    try {
      const r = JSON.parse(await wc.executeJavaScript(searchScript(q), true) || '{}');
      if (r.results) return { results: r.results };
      if (r.error) last = r.error;
      if (i === 6 && r.wait) wc.loadURL(YT_URL).catch(() => {}); // never got a usable page: load the home page (only if nothing else made it ready)
    } catch (err) { last = err && err.message ? err.message : last; }
    await wait(700);
  }
  return { results: [], error: last };
}
ipcMain.handle('player:search', (_e, query) => searchYt(query));

ipcMain.handle('player:enqueue', (_e, item, front) => {
  const id = String(item && item.id || '');
  if (!/^[A-Za-z0-9_-]{11}$/.test(id) || ctl.queue.length >= 200) return ctl.queue.slice();
  const entry = { id, title: String(item.title || '').slice(0, 200), sub: String(item.sub || '').slice(0, 200), thumb: /^https:/.test(String(item.thumb || '')) ? String(item.thumb) : '' };
  if (front) { ctl.queue.splice(ctl.nextN, 0, entry); ctl.nextN += 1; } // after earlier "play next" songs, before the rest
  else ctl.queue.push(entry);
  return ctl.queue.slice();
});
ipcMain.handle('player:queue', () => ctl.queue.slice());
ipcMain.handle('player:enqueueMany', (_e, items, front) => {
  const room = 200 - ctl.queue.length;
  const clean = (Array.isArray(items) ? items : []).filter((x) => x && /^[A-Za-z0-9_-]{11}$/.test(String(x.id || ''))).slice(0, Math.max(0, room)).map((x) => ({
    id: String(x.id), title: String(x.title || '').slice(0, 200), sub: String(x.sub || '').slice(0, 200), thumb: /^https:/.test(String(x.thumb || '')) ? String(x.thumb) : '',
  }));
  if (front) { ctl.queue.splice(ctl.nextN, 0, ...clean); ctl.nextN += clean.length; } else ctl.queue.push(...clean);
  return { queue: ctl.queue.slice(), added: clean.length, skipped: (Array.isArray(items) ? items.length : 0) - clean.length };
});

// Runs in the page: the songs behind a link (one song, or every song of a playlist), with titles and covers.
const itemsScript = (kind, id) => `(async () => {
  try {
    const cfg = window.ytcfg;
    const get = (k) => (cfg && typeof cfg.get === 'function' ? cfg.get(k) : cfg && cfg.data_ ? cfg.data_[k] : undefined);
    const key = get('INNERTUBE_API_KEY');
    const context = get('INNERTUBE_CONTEXT');
    if (!key || !context) return JSON.stringify({ wait: true });
    const post = async (path, body) => {
      const res = await fetch('/youtubei/v1/' + path + '?prettyPrint=false&key=' + encodeURIComponent(key), { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(Object.assign({ context }, body)) });
      return res.ok ? res.json() : null;
    };
    const runs = (x) => ((x && x.runs) || []).map((r) => r.text);
    const out = [];
    if (${JSON.stringify(kind)} === 'song') {
      const data = await post('next', { videoId: ${JSON.stringify(id)} });
      const walk = (o) => {
        if (!o || typeof o !== 'object' || out.length) return;
        if (o.playlistPanelVideoRenderer && o.playlistPanelVideoRenderer.videoId === ${JSON.stringify(id)}) {
          const d = o.playlistPanelVideoRenderer; const th = (d.thumbnail && d.thumbnail.thumbnails) || [];
          out.push({ id: d.videoId, title: runs(d.title).join(''), sub: runs(d.shortBylineText).join('').split(' \u2022 ')[0].trim(), thumb: th.length ? th[th.length - 1].url : '' });
          return;
        }
        for (const k in o) walk(o[k]);
      };
      walk(data);
      if (!out.length) out.push({ id: ${JSON.stringify(id)}, title: '', sub: '', thumb: '' });
      return JSON.stringify({ items: out });
    }
    let body = { browseId: 'VL' + ${JSON.stringify(id)} };
    for (let page = 0; page < 8 && out.length < 200; page++) {
      const data = await post('browse', body);
      if (!data) break;
      let token = null;
      const walk = (o) => {
        if (!o || typeof o !== 'object') return;
        const it = o.musicResponsiveListItemRenderer;
        if (it && it.playlistItemData && it.playlistItemData.videoId) {
          const cols = it.flexColumns || [];
          const col = (c) => runs(c && c.musicResponsiveListItemFlexColumnRenderer && c.musicResponsiveListItemFlexColumnRenderer.text);
          let thumb = '';
          try { const th = it.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails; thumb = th[th.length - 1].url; } catch (e) { /* none */ }
          out.push({ id: it.playlistItemData.videoId, title: (col(cols[0])[0] || '').trim(), sub: (col(cols[1])[0] || '').trim(), thumb });
          return;
        }
        if (!token && o.continuationCommand && o.continuationCommand.token) token = o.continuationCommand.token;
        for (const k in o) walk(o[k]);
      };
      walk(data);
      if (!token) break;
      body = { continuation: token };
    }
    const seen = new Set();
    return JSON.stringify({ items: out.filter((x) => (seen.has(x.id) ? false : seen.add(x.id))).slice(0, 200) });
  } catch (e) { return JSON.stringify({ error: String(e && e.message || e) }); }
})()`;

// The songs behind a pasted or searched link, without interrupting what is playing.
ipcMain.handle('player:resolveItems', async (_e, src) => {
  if (!ytView || !src) return { items: [], error: 'not ready' };
  const wc = ytView.webContents;
  let kind = src.kind === 'song' ? 'song' : 'list';
  let id = String(src.id || '');
  try {
    if (src.kind === 'album') {
      if (!/^MPREb_[A-Za-z0-9_-]{4,60}$/.test(id)) return { items: [] };
      id = await wc.executeJavaScript(albumPlaylistScript(id), true);
      if (!id) return { items: [], error: "couldn't open that album" };
    }
    if (!/^[A-Za-z0-9_-]{2,80}$/.test(id)) return { items: [] };
    for (let i = 0; i < 12; i++) {
      const r = JSON.parse((await wc.executeJavaScript(itemsScript(kind, id), true)) || '{}');
      if (r.items) {
        r.items.forEach((x) => { if (x.title) ctl.meta.set(x.id, x); });
        return { items: r.items };
      }
      if (r.error) return { items: [], error: r.error };
      await wait(700); // the page is still starting
    }
  } catch (err) { return { items: [], error: err && err.message ? err.message : 'failed' }; }
  return { items: [], error: 'YouTube Music is still loading' };
});
/* ---------- playlists from Spotify / Deezer / SoundCloud ----------
   The song list is read from the service's public page, then every song is looked up on YouTube Music
   (one search at a time, with a pause between them) and the best match is kept. Nothing runs unless
   a link from one of those services is pasted. */
const importState = { running: false, cancel: false, phase: '', done: 0, total: 0, found: 0, service: '', name: '' };

async function textGet(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'en' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('answered HTTP ' + res.status);
    return await res.text();
  } finally { clearTimeout(timer); }
}

async function readExternalList(ext) {
  const svc = Lyrics.SERVICE_NAME[ext.service] || 'that service';
  let body;
  try { body = await textGet(ext.url); } catch (err) {
    throw new Error(err && err.name === 'AbortError' ? `${svc} took too long to answer` : `couldn't open the ${svc} link (${err && err.message ? err.message : 'network error'})`);
  }
  let r = null;
  if (ext.service === 'spotify') r = Lyrics.parseSpotifyEmbed(body);
  else if (ext.service === 'deezer') { try { r = Lyrics.parseDeezer(JSON.parse(body)); } catch (_) { r = null; } }
  else r = Lyrics.parseSoundcloud(body);
  if (!r || !r.tracks.length) throw new Error(`couldn't read any songs from that ${svc} link. Make sure the playlist is public`);
  return r;
}

ipcMain.handle('player:importPlaylist', async (_e, ext) => {
  if (importState.running) return { items: [], missing: [], total: 0, error: 'An import is already running' };
  const e = ext && Lyrics.extractExternal(ext.url || '') ;
  if (!e) return { items: [], missing: [], total: 0, error: "That isn't a Spotify, Deezer or SoundCloud playlist link" };
  Object.assign(importState, { running: true, cancel: false, phase: 'reading', done: 0, total: 0, found: 0, service: e.service, name: '' });
  const items = [];
  const missing = [];
  let list;
  try {
    list = await readExternalList(e);
    importState.name = list.name || '';
    const tracks = list.tracks.slice(0, 200);
    importState.total = tracks.length;
    importState.phase = 'matching';
    const gap = Number(globalThis.__lpImportGap) > 0 ? Number(globalThis.__lpImportGap) : 350;
    for (const t of tracks) {
      if (importState.cancel) break;
      const label = t.title ? (t.artist ? `${t.artist} – ${t.title}` : t.title) : '(a song without a readable name)';
      let hit = null;
      if (t.title) {
        const res = await searchYt(`${t.artist} ${t.title}`.trim());
        hit = Lyrics.matchTrack(t, res.results || []);
        if (res.error && !(res.results || []).length && !items.length && importState.done === 0) throw new Error(res.error);
      }
      if (hit && !items.some((x) => x.id === hit.id)) {
        const it = { id: hit.id, title: hit.title, sub: hit.sub, thumb: hit.thumb || '' };
        items.push(it);
        ctl.meta.set(it.id, it);
        importState.found += 1;
      } else if (!hit) missing.push(label);
      importState.done += 1;
      await wait(gap);
    }
    return { items, missing, total: tracks.length, name: list.name || '', cut: Math.max(0, list.tracks.length - tracks.length), cancelled: importState.cancel };
  } catch (err) {
    return { items, missing, total: importState.total, error: err && err.message ? err.message : 'failed' };
  } finally { importState.running = false; importState.phase = 'done'; }
});
ipcMain.handle('player:importStatus', () => ({ ...importState }));
ipcMain.handle('player:importCancel', () => { importState.cancel = true; return true; });
ipcMain.handle('player:dequeue', (_e, index) => {
  const i = Number(index);
  if (Number.isInteger(i) && i >= 0 && i < ctl.queue.length) { ctl.queue.splice(i, 1); if (i < ctl.nextN) ctl.nextN -= 1; }
  return ctl.queue.slice();
});
ipcMain.handle('player:clearQueue', () => { ctl.queue = []; ctl.nextN = 0; return []; });

ipcMain.handle('player:browse', (_e, show, top) => {
  ytBrowse = !!show;
  if (Number.isFinite(top)) ytTop = Math.max(0, Math.min(300, Math.round(top)));
  layoutYt();
  return ytBrowse;
});

const videoDo = (body) => `(() => { ${PICK_VIDEO} const v = pickVideo(); if (v) { ${body} } })()`;
const songKey = `(() => { ${PICK_VIDEO} const v = pickVideo(); const m = navigator.mediaSession && navigator.mediaSession.metadata; return JSON.stringify({ href: location.href, title: m ? m.title : '', vid: new URL(location.href).searchParams.get('v') || '', cur: v ? v.currentTime : 0 }); })()`;
const skipToEnd = videoDo('if (isFinite(v.duration) && v.duration > 1) v.currentTime = Math.max(0, v.duration - 0.4);');

const playerApi = (method) => `(() => { const p = document.querySelector('#movie_player'); if (p && typeof p.${method} === 'function') { p.${method}(); return true; } return false; })()`;


/* ---------- shuffle and repeat (handled here, not by clicking the page's buttons) ---------- */

const ctl = { meta: new Map(), wantId: '', queue: [], nextN: 0, divert: null, trace: [], solo: false, shuffle: false, repeat: 'off', order: [], pos: 0, lastJump: 0, snap: null, spaWorks: null, spaFails: 0, ids: [], idsFor: '', idsAt: 0, idsTries: 0, idsBusy: false };
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
  return ctl.qids || [];
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

// Which song the shuffle will pick next, without using it up.
function peekShuffleId() {
  const ids = trackIds();
  if (ids.length < 2) return null;
  const current = ctl.snap && ctl.snap.videoId;
  if (ctl.orderLen !== ids.length || ctl.orderList !== ids[0]) {
    ctl.order = shuffled(ids.filter((x) => x !== current));
    ctl.orderLen = ids.length;
    ctl.orderList = ids[0];
    ctl.pos = 0;
  }
  let id = ctl.order[ctl.pos];
  if (id === current) id = ctl.order[ctl.pos + 1];
  return id || null;
}

// Runs in the page: switch to a song inside YouTube Music without reloading the page, if the site lets us.
const spaNavigateScript = (videoId, listId) => `(async () => {
  const app = document.querySelector('ytmusic-app');
  const endpoint = { watchEndpoint: Object.assign({ videoId: ${JSON.stringify(videoId)} }, ${JSON.stringify(listId || '')} ? { playlistId: ${JSON.stringify(listId || '')} } : {}) };
  const arrived = () => new URL(location.href).searchParams.get('v') === ${JSON.stringify(videoId)};
  const wait = (ms) => native('sleep', { ms }).then(() => undefined);
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
async function playTrack(id, listOverride) {
  if (!ytView) return false;
  const lid = listOverride === undefined ? ytListId : listOverride; // '' plays the song on its own, outside the playlist
  ctl.lastJump = Date.now();
  const wc = ytView.webContents;
  let ok = false;
  // Once switching inside the page has failed, don't waste time on it again: load the song's address straight away.
  if (ctl.spaWorks !== false) {
    try { ok = await wc.executeJavaScript(spaNavigateScript(id, lid), true); } catch (_) { ok = false; }
    ctl.spaFails = ok ? 0 : ctl.spaFails + 1;
    ctl.spaWorks = ok ? true : ctl.spaFails >= 2 ? false : null; // two misses in a row: stop trying
  }
  if (!ok && ytView) wc.loadURL(`${YT_URL}watch?v=${enc(id)}${lid ? `&list=${enc(lid)}` : ''}`);
  ctl.lastJump = Date.now();
  return true;
}

function openInList(query) {
  if (!ytView) return;
  ctl.lastJump = Date.now();
  ytView.webContents.loadURL(`${YT_URL}watch?${query}`);
}

/* ---------- the "play next" queue ----------
   Songs the person adds play before the playlist carries on. A queued song plays on its own; when the queue is
   empty the playlist resumes with the song that would have come next. */

function takeQueued() {
  const it = ctl.queue.shift();
  if (it && ctl.nextN > 0) ctl.nextN -= 1;
  return it || null;
}

async function playQueued(fromId) {
  const it = takeQueued();
  if (!it) return false;
  if (!ctl.divert) ctl.divert = { afterId: fromId, listId: ytListId, wasSolo: ctl.solo };
  ctl.divert.playing = it.id;
  await playTrackVerified(it.id, '');
  return true;
}

// The queue ran out: go on with the playlist (or stop, if the person was only playing one song).
async function resumeAfterDivert() {
  const d = ctl.divert;
  ctl.divert = null;
  if (!d || !ytView) return;
  const wc = ytView.webContents;
  ctl.lastJump = Date.now();
  if (d.wasSolo || !d.listId) {
    wc.executeJavaScript(videoDo('v.pause(); v.currentTime = 0;'), true).catch(() => {});
    return;
  }
  let id = null;
  if (ctl.shuffle) {
    id = nextShuffleId();
    if (!id && ctl.repeat !== 'off') id = nextShuffleId(true);
  } else {
    const ids = trackIds();
    const i = ids.indexOf(d.afterId);
    if (i >= 0 && i + 1 < ids.length) id = ids[i + 1];
    else if (ids.length && (i < 0 || ctl.repeat === 'all')) id = ids[0];
  }
  if (id) { playTrackVerified(id, d.listId); return; }
  if (!trackIds().length) { // the playlist's song list isn't known: reopen where we were and step forward
    openInList(`v=${enc(d.afterId)}&list=${enc(d.listId)}`);
    await wait(4500);
    advanceOnce(wc);
    return;
  }
  wc.executeJavaScript(videoDo('v.pause(); v.currentTime = 0;'), true).catch(() => {}); // end of the playlist
}

const onQueuedSong = (s) => ctl.divert && s && ctl.divert.playing === s.videoId;

// Remembers the title / artist / cover of songs the page has told us about.
function learnMeta(s) {
  for (const mm of [s.wantMeta, s.nextMeta]) if (mm && mm.id) { ctl.meta.set(mm.id, mm); if (ctl.meta.size > 800) ctl.meta.delete(ctl.meta.keys().next().value); }
  if (s.videoId && s.title) ctl.meta.set(s.videoId, { id: s.videoId, title: s.title, sub: s.artist || '', thumb: s.art || '' });
}

// What will play after this song, for the "Up next" line: { id, title, sub, thumb } or null.
function computeNext(s) {
  if (!s || !s.hasMedia || s.ad) return null;
  let id = '';
  let item = null;
  if (ctl.repeat === 'one') return null;
  if (ctl.queue.length) item = ctl.queue[0];
  else if (onQueuedSong(s) && ctl.divert) {
    const d = ctl.divert;
    if (d.wasSolo || !d.listId) return null;
    if (ctl.shuffle) id = peekShuffleId() || '';
    else { const ids = trackIds(); const i = ids.indexOf(d.afterId); id = i >= 0 ? (ids[i + 1] || (ctl.repeat === 'all' ? ids[0] : '')) : ''; }
  } else if (!ctl.solo) {
    if (ctl.shuffle) id = peekShuffleId() || '';
    else {
      const ids = trackIds();
      const i = ids.indexOf(s.videoId);
      if (i >= 0) id = ids[i + 1] || (ctl.repeat === 'all' ? ids[0] : '');
      else if (s.nextMeta) item = s.nextMeta;
    }
  }
  if (!item && id) item = ctl.meta.get(id) || { id, title: '', sub: '', thumb: '' };
  ctl.wantId = item && !item.title ? item.id : ''; // ask the page for this song's details on the next look
  if (!item) return null;
  return { id: item.id, title: item.title || '', sub: item.sub || '', thumb: item.thumb || (item.id ? `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg` : ''), queued: item === ctl.queue[0] };
}

// Called after every poll. Handles what should happen when a song reaches its end.
function controllerTick(s) {
  if (s.ad || !ytView) return;
  ensureTrackIds();
  const now = Date.now();
  if (!ctl.guard || ctl.guard.id !== s.videoId) ctl.guard = { id: s.videoId, mid: false };
  if (s.dur > 5 && s.cur > 0.5 && s.cur < s.dur - 3) ctl.guard.mid = true;
  const atEnd = ctl.guard.mid && s.dur > 5 && (s.ended || s.cur >= s.dur - 0.9);
  if (!atEnd || now - ctl.lastJump < 3000) return;
  ctl.trace.push('end? id=' + s.videoId + ' cur=' + (s.cur || 0).toFixed(1) + ' dur=' + (s.dur || 0).toFixed(1) + ' ended=' + s.ended + ' playing=' + s.playing);
  if (ctl.trace.length > 40) ctl.trace.shift();

  if (ctl.repeat !== 'one') {
    if (ctl.queue.length) { playQueued(s.videoId); return; }
    if (onQueuedSong(s)) { resumeAfterDivert(); return; }
  }
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
    return (before.vid && after.vid !== before.vid) || after.title !== before.title || (before.cur > 6 && after.cur < before.cur - 4);
  } catch (_) {
    return true; // the page is reloading, so something changed
  }
}

// Plays one specific song and makes sure it really started. If the page didn't switch, it escalates:
// load the song's address, and as a last resort just skip the current song to its end.
async function playTrackVerified(id, listOverride) {
  if (!ytView) return false;
  const lid = listOverride === undefined ? ytListId : listOverride;
  const wc = ytView.webContents;
  const t0 = Date.now();
  const tr = (msg) => { ctl.trace.push(`+${Date.now() - t0}ms ${msg}`); if (ctl.trace.length > 40) ctl.trace.shift(); };
  ctl.trace.push(`--- jump to ${id} (spa=${ctl.spaWorks})`);
  let before = null;
  try { before = JSON.parse(await wc.executeJavaScript(songKey, true)); } catch (_) { /* ignore */ }
  tr('got current song');

  await playTrack(id, lid);
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
      wc.loadURL(`${YT_URL}watch?v=${enc(id)}${lid ? `&list=${enc(lid)}` : ''}`);
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

  // Next goes to the queue first; at the end of the queue it picks the playlist up again.
  if (name === 'next' && ctl.queue.length) { await playQueued(ctl.snap && ctl.snap.videoId); return true; }
  if (name === 'next' && onQueuedSong(ctl.snap)) { await resumeAfterDivert(); return true; }

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
  report.app = { shuffle: ctl.shuffle, repeat: ctl.repeat, history: ytHistory.length, listId: ytListId, snap: ctl.snap && { title: ctl.snap.title, queueCount: ctl.snap.queueCount, curIdx: ctl.snap.curIdx }, playlistSongsKnown: ctl.ids.length, queueSongsKnown: (ctl.qids || []).length };
  const text = JSON.stringify(report, null, 1);
  clipboard.writeText(text);
  return text.length;
});


const LRCLIB = (process.env.LRCLIB_BASE || 'https://lrclib.net') + '/api';
const NETEASE = process.env.NETEASE_BASE || 'https://music.163.com';
const LYRICS_OVH = process.env.LYRICS_OVH_BASE || 'https://api.lyrics.ovh';
const QURAN_API = process.env.QURAN_BASE || 'https://api.alquran.cloud';
const QURAN_COM = process.env.QURAN_COM_BASE || 'https://api.quran.com/api/v4';

async function jsonGet(label, url, headers, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 8000);
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
  const out = [];
  const exact = new URLSearchParams({ track_name: track, artist_name: artist || '' });
  if (seconds > 0) exact.set('duration', String(seconds));
  const hit = await lrclibRequest('/get?' + exact);
  if (hit && (hit.instrumental || hasLyrics(hit))) out.push(hit);

  const results = await lrclibRequest('/search?' + new URLSearchParams({ track_name: track, artist_name: artist || '' }));
  if (Array.isArray(results)) {
    const na = Lyrics.normalize(artist);
    const usable = results.filter(hasLyrics);
    // With a known length, only accept results within 10 seconds of it so we don't show a different version's timing.
    const close = seconds > 0 ? usable.filter((r) => Math.abs((r.duration || 0) - seconds) <= 10) : usable;
    const rank = (r) => {
      const ra = Lyrics.normalize(r.artistName);
      const artistOk = !na || (ra && (ra.includes(na) || na.includes(ra)));
      const rt = Lyrics.normalize(r.trackName), nt = Lyrics.normalize(track);
      const titleOk = rt === nt || rt.startsWith(nt + ' ') || nt.startsWith(rt + ' ');
      return (artistOk ? 0 : 2000) + (titleOk ? 0 : 1000) + Math.abs((r.duration || 0) - seconds) + (r.syncedLyrics ? 0 : 500);
    };
    close.sort((x, y) => rank(x) - rank(y));
    for (const r of close) if (!out.some((o) => o.id && o.id === r.id)) out.push(r);
  }
  return out;
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
  const out = [];
  for (const song of candidates.slice(0, 3)) {
    const data = await jsonGet('NetEase', `${NETEASE}/api/song/lyric?` + new URLSearchParams({ id: String(song.id), lv: '1', kv: '1', tv: '-1' }), headers);
    const lrc = data && data.lrc && data.lrc.lyric;
    if (lrc && Lyrics.hasTimestamps(lrc) && lrc.split('\n').length > 3) out.push({ syncedLyrics: lrc });
  }
  return out;
}

// Source 3: lyrics.ovh (plain text, needs the artist).
async function fromLyricsOvh(track, artist) {
  if (!artist) return null;
  const data = await jsonGet('lyrics.ovh', `${LYRICS_OVH}/v1/${encodeURIComponent(artist)}/${encodeURIComponent(track)}`);
  let text = data && typeof data.lyrics === 'string' ? data.lyrics.replace(/\r\n/g, '\n').trim() : '';
  text = text.replace(/^Paroles de la chanson[^\n]*\n+/i, '').trim();
  return text.length > 20 ? { plainLyrics: text } : null;
}

// Quran recitations: the surah's Arabic text with an English translation (Al-Quran Cloud). When the reciter is one
// Quran.com has ayah timings for, the text is timed so it follows the recitation; otherwise it is plain text.
let reciterList = null;
async function quranReciters() {
  if (reciterList) return reciterList;
  const data = await jsonGet('Quran.com', `${QURAN_COM}/resources/chapter_reciters`);
  const list = data && Array.isArray(data.reciters) ? data.reciters : [];
  if (list.length) reciterList = list;
  return list;
}

let quranNote = ''; // why the last Quran lookup had no exact timing, shown to the person
// Returns { stamps, estimated }. A reciter Quran.com has no timing for borrows another reciter's rhythm (estimated).
async function quranTimes(hit, title, artist) {
  try {
    const list = await quranReciters();
    if (!list.length) { quranNote = 'the reciter list was empty'; return null; }
    let id = Quran.pickReciter(list, `${title || ''} ${artist || ''}`);
    let estimated = false;
    if (!id) {
      id = Quran.pickReciter(list, 'Mishary Alafasy') || list[0].id;
      estimated = true;
      quranNote = "this reciter isn't on Quran.com, so the timing is estimated from another reciter";
    }
    // segments=true is what makes Quran.com include the per-ayah timestamps.
    const data = await jsonGet('Quran.com', `${QURAN_COM}/chapter_recitations/${id}/${hit.surah}?segments=true`, null, 20000);
    const stamps = data && data.audio_file && data.audio_file.timestamps;
    if (!Array.isArray(stamps) || !stamps.length) { quranNote = 'Quran.com has no ayah timing for this reciter and surah'; return null; }
    return { stamps, estimated };
  } catch (err) { quranNote = err && err.message ? err.message : 'Quran.com could not be reached'; return null; } // timing is a bonus; the plain text still works
}

async function fromQuran(title, artist, seconds, timedOnly) {
  const hit = Quran.detect(title, artist);
  if (!hit) return null;
  quranNote = '';
  const times = await quranTimes(hit, title, artist);
  if (timedOnly && !times) return null;
  const data = await jsonGet('Al-Quran Cloud', `${QURAN_API}/v1/surah/${hit.surah}/editions/quran-uthmani,en.sahih`);
  const editions = data && Array.isArray(data.data) ? data.data : [];
  const arabic = editions[0] && editions[0].ayahs;
  const english = editions[1] && editions[1].ayahs;
  if (!Array.isArray(arabic) || !arabic.length) return null;
  const timed = times && Quran.buildTimed(arabic, english, times.stamps, hit.from, hit.to, seconds, times.estimated);
  if (timed) return { syncedLyrics: timed, estimated: times.estimated };
  if (times && !quranNote) quranNote = 'the timing did not match this surah';
  if (times && times.estimated) quranNote = 'the timing could not be estimated for this track';
  return timedOnly ? null : { plainLyrics: Quran.buildText(arabic, english, hit.from, hit.to) };
}

ipcMain.handle('lyrics:fetch', async (_event, { title, track, artist, author, duration, timedOnly, retry, replaceFile }) => {
  if (loadSettings().autoFetch === false) return { status: 'disabled' };
  // "Wrong lyrics?": only a file this app downloaded is replaced, never one the person made.
  if (retry && replaceFile && !(loadSettings().fetchedLyrics || []).includes(path.basename(String(replaceFile)))) return { status: 'own' };
  if (!track) return { status: 'notfound' };
  const seconds = Math.round(Number(duration) || 0);

  // A Quran recitation gets the Quran text; if that service can't be reached we carry on to the normal sources.
  try {
    const quran = await fromQuran(title || track, `${artist || ''} ${author || ''}`.trim(), seconds, timedOnly);
    if (quran) {
      const synced = !!quran.syncedLyrics;
      const base = Lyrics.sanitizeFileName(title || track);
      fs.writeFileSync(safeLyricsFile(base + (synced ? '.lrc' : '.txt')), quran.syncedLyrics || quran.plainLyrics, 'utf8');
      if (synced) { try { fs.unlinkSync(safeLyricsFile(base + '.txt')); } catch (_) { /* no old plain copy */ } }
      return { status: 'ok', file: base + (synced ? '.lrc' : '.txt'), synced, source: synced ? 'Al-Quran Cloud + Quran.com timing' : 'Al-Quran Cloud', note: quran.estimated ? quranNote : synced ? '' : quranNote };
    }
  } catch (_) { /* fall through */ }

  if (timedOnly) return { status: 'notfound', note: quranNote };
  // Every candidate, best first: timed ones from LRCLIB and NetEase, then plain text. "Try next" skips the ones already shown.
  const skip = Math.max(0, Number(retry) || 0);
  const sources = [
    ['LRCLIB', () => fromLrclib(track, artist, seconds)],
    ['NetEase', () => fromNetease(track, artist, seconds)],
    ['lyrics.ovh', async () => { const r = await fromLyricsOvh(track, artist); return r ? [r] : []; }],
  ];
  const all = [];
  let attempted = 0;
  let failed = 0;
  let lastError = '';
  for (const [name, lookup] of sources) {
    attempted += 1;
    try {
      for (const r of (await lookup()) || []) {
        if (r.instrumental) { if (!skip && !all.length) return { status: 'instrumental' }; continue; }
        const text = r.syncedLyrics || r.plainLyrics;
        if (text && !all.some((c) => c.text === text)) all.push({ source: name, text });
      }
    } catch (err) {
      failed += 1;
      lastError = err.message;
    }
    if (!skip && all.some((c) => Lyrics.hasTimestamps(c.text))) break; // first time round: a timed hit is enough
  }

  if (!all.length) return failed === attempted ? { status: 'error', message: lastError } : { status: 'notfound' };
  // Timed lyrics first, then plain; stable within each group.
  const ordered = all.filter((c) => Lyrics.hasTimestamps(c.text)).concat(all.filter((c) => !Lyrics.hasTimestamps(c.text)));
  const pick = ordered[skip];
  if (!pick) return { status: 'nomore' };
  const synced = Lyrics.hasTimestamps(pick.text);
  const base = Lyrics.sanitizeFileName(title || track);
  if (skip) for (const f of new Set([replaceFile, base + '.lrc', base + '.txt'].filter(Boolean))) { try { fs.unlinkSync(safeLyricsFile(f)); } catch (_) { /* not there */ } }
  const file = base + (synced ? '.lrc' : '.txt');
  fs.writeFileSync(safeLyricsFile(file), pick.text, 'utf8');
  if (!skip && synced) { try { fs.unlinkSync(safeLyricsFile(base + '.txt')); } catch (_) { /* no old plain copy */ } }
  const fetched = new Set(loadSettings().fetchedLyrics || []); fetched.add(file); fetched.add(base + (synced ? '.txt' : '.lrc'));
  saveSettings({ ...loadSettings(), fetchedLyrics: [...fetched].slice(-2000) });
  return { status: 'ok', file, synced, source: pick.source, index: skip, more: ordered.length - skip - 1 };
});

ipcMain.handle('lyrics:fetched', () => loadSettings().fetchedLyrics || []);



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
  let lastModes = '';
  window.__lpTick = () => {
    pollYt();
    try {
      const el = document.querySelector('.lyrics .line.active');
      const text = el ? el.textContent.trim().replace(/\s*\n\s*/g, ' — ') : '';
      if (text !== lastLine) { lastLine = text; N.lyricLine(text); }
      const sb = document.getElementById('btnShuffle');
      const rb = document.getElementById('btnRepeat');
      const modes = (sb && sb.classList.contains('on') ? '1' : '0') + ((rb && rb.title.indexOf('this song') >= 0) ? 'o' : (rb && rb.classList.contains('on')) ? 'a' : 'x');
      if (modes !== lastModes) { lastModes = modes; N.modes(modes); }
    } catch (_) { /* ignore */ }
  };
  document.addEventListener('DOMContentLoaded', () => { const b = document.getElementById('btnPhoneFull'); if (b) b.addEventListener('click', () => window.api.fullscreen(true)); });
  window.__lpSleep = (ms) => native('sleep', { ms }).then(() => undefined);
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
    fullscreen: async (on) => {
      fsOn = on == null ? !fsOn : !!on;
      native('fullscreen', { on: fsOn }); // hides the phone's status and navigation bars
      if (fsCb) fsCb(fsOn);
      return fsOn;
    },
    onFullscreen: (cb) => { fsCb = cb; },
    player: {
      diagnose: () => handlers['player:diagnose'](),
      open: (id, videoId) => handlers['player:open'](null, id, videoId),
      openSong: (videoId) => handlers['player:openSong'](null, videoId),
      resolveAlbum: (browseId) => handlers['player:resolveAlbum'](null, browseId),
      search: (query) => handlers['player:search'](null, query),
      enqueue: (item, front) => handlers['player:enqueue'](null, item, front),
      queue: () => handlers['player:queue'](),
      enqueueMany: (items, front) => handlers['player:enqueueMany'](null, items, front),
      resolveItems: (src) => handlers['player:resolveItems'](null, src),
      importPlaylist: (ext) => handlers['player:importPlaylist'](null, ext),
      importStatus: () => handlers['player:importStatus'](),
      importCancel: () => handlers['player:importCancel'](),
      dequeue: (index) => handlers['player:dequeue'](null, index),
      clearQueue: () => handlers['player:clearQueue'](),
      // The phone's own volume buttons set the loudness; the page's volume stays at full.
      cmd: (name, arg) => (name === 'volume' ? Promise.resolve(true) : handlers['player:cmd'](null, name, arg)),
      browse: (show, top) => handlers['player:browse'](null, show, top),
      onState: (cb) => { stateCallbacks.push(cb); },
    },
    openLyricsFolder: async () => {},
  };
})();
