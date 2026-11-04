const { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell, session, net, nativeImage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const Lyrics = require('./renderer/lyrics.js');
const Quran = require('./quran.js');
const Palette = require('./renderer/palette.js');

const RENDERER_DIR = path.join(__dirname, 'renderer');
const PREFERRED_PORT = 47831;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

let win = null;
let server = null;
let port = 0;
let host = '127.0.0.1';

/* ---------- settings ---------- */

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

function lyricsDir() {
  const s = loadSettings();
  const dir = s.lyricsDir || path.join(app.getPath('documents'), 'Lyric Player', 'lyrics');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/* ---------- local server ----------
   YouTube's embedded player needs a real http(s) origin and referrer.
   Loading the page from file:// makes it fail, so we serve the UI from
   127.0.0.1 (this machine only, never reachable from the network). */

function startServer() {
  server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    const file = path.normalize(path.join(RENDERER_DIR, urlPath));
    if (!file.startsWith(RENDERER_DIR + path.sep)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  });

  return new Promise((resolve, reject) => {
    const onError = (err) => {
      if (err.code === 'EADDRINUSE') {
        server.removeListener('error', onError);
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
      } else {
        reject(err);
      }
    };
    server.once('error', onError);
    server.listen(PREFERRED_PORT, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve(server.address().port);
    });
  });
}

/* ---------- window ---------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 720,
    minWidth: 920,
    minHeight: 600,
    backgroundColor: '#120f0d',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    title: 'Lyric Player',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  host = loadSettings().host === 'localhost' ? 'localhost' : '127.0.0.1';
  win.loadURL(`http://${host}:${port}/`);

  // Links open in the normal browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://${host}:${port}/`)) event.preventDefault();
  });
  // F12 or Ctrl+Shift+I opens developer tools (for troubleshooting). F11 toggles fullscreen.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
      return;
    }
    if (input.key === 'Escape' && win.isFullScreen()) {
      win.setFullScreen(false);
      event.preventDefault();
      return;
    }
    if (input.key === 'F12' || (input.control && input.shift && input.key.toUpperCase() === 'I')) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
  win.on('resize', layoutYt);
  win.on('enter-full-screen', () => win && win.webContents.send('app:fullscreen', true));
  win.on('leave-full-screen', () => win && win.webContents.send('app:fullscreen', false));
  win.on('closed', () => {
    clearInterval(ytTimer);
    ytView = null;
    win = null;
  });
  createYtView();
}


/* ---------- YouTube Music (the actual website, in a hidden view) ----------
   Playing through YouTube's embedded player is blocked for many official songs
   (error 150). Instead this loads the real music.youtube.com site, the same way
   Pear Desktop does, and reads what's playing from the page. The view is kept
   off-screen while you use the lyrics layout, and can be shown with the
   "YouTube Music" button (to browse, accept cookies, or sign in). */

const YT_URL = process.env.YT_URL_FOR_TESTS || 'https://music.youtube.com/';
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

function stripElectronUA(ua) {
  return ua.replace(/\s*Electron\/\S+/i, '').replace(/\s*lyric-player\/\S+/i, '');
}

function layoutYt() {
  if (!ytView || !win) return;
  const [w, h] = win.getContentSize();
  if (ytBrowse) ytView.setBounds({ x: 0, y: ytTop, width: w, height: Math.max(100, h - ytTop) });
  // Off-screen but still "visible" to the page, so audio and timers keep running normally.
  else ytView.setBounds({ x: -12000, y: 0, width: Math.max(w, 1000), height: Math.max(h, 700) });
}

const isGoogleHost = (host) => /(^|\.)(youtube\.com|google\.com|gstatic\.com|googleusercontent\.com|accounts\.youtube\.com)$/i.test(host);

/* Ad servers and YouTube's own ad endpoints. Kept deliberately short so normal playback isn't affected. */
const AD_HOSTS = /(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com|adservice\.google\.com)$/i;
const AD_PATHS = /^\/(pagead\/|api\/stats\/ads|ptracking|get_midroll_)/i;

function isAdRequest(url) {
  try {
    const u = new URL(url);
    return AD_HOSTS.test(u.hostname) || AD_PATHS.test(u.pathname);
  } catch (_) {
    return false;
  }
}

function createYtView() {
  ytView = new WebContentsView({
    webPreferences: {
      partition: 'persist:ytmusic',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  const wc = ytView.webContents;
  const ses = wc.session;
  ses.setUserAgent(stripElectronUA(ses.getUserAgent()));
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'ytm-preload.js') });
  ses.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (details, callback) => {
    callback({ cancel: adBlock && isAdRequest(details.url) });
  });

  wc.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:' && isGoogleHost(u.hostname)) wc.loadURL(url);
      else if (u.protocol === 'https:') shell.openExternal(url);
    } catch (_) { /* ignore */ }
    return { action: 'deny' };
  });
  // The page registers a "Leave site?" prompt while music plays. Without this, Electron silently cancels
  // every reload we do to jump to a specific song (which is what broke shuffle). Ignore the prompt.
  wc.on('will-prevent-unload', (event) => event.preventDefault());
  wc.on('will-navigate', (event, url) => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || !isGoogleHost(u.hostname)) event.preventDefault();
    } catch (_) {
      event.preventDefault();
    }
  });
  wc.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toUpperCase() === 'I'))) {
      wc.toggleDevTools();
      event.preventDefault();
    }
  });

  win.contentView.addChildView(ytView);
  layoutYt();
  wc.loadURL(YT_URL);
  ytTimer = setInterval(pollYt, 250);
}

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
    // The queue's song ids only change when the queue does, so they are rebuilt (and sent) only then, or every 5 seconds.
    const qc = window.__lpQ || (window.__lpQ = { n: -1, t: 0 });
    const tNow = Date.now();
    let queueIds;
    if (items.length !== qc.n || tNow - qc.t > 5000) {
      qc.n = items.length;
      qc.t = tNow;
      queueIds = items.length < 600 ? items.map((i) => (i.data && i.data.videoId) || '').filter(Boolean) : [];
    }
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
    const state = await ytView.webContents.executeJavaScript(probeScript(ytDesiredVolume, adBlock), true);
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

ipcMain.handle('player:search', async (_e, query) => {
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
});

ipcMain.handle('player:enqueue', (_e, item, front) => {
  const id = String(item && item.id || '');
  if (!/^[A-Za-z0-9_-]{11}$/.test(id) || ctl.queue.length >= 200) return ctl.queue.slice();
  const entry = { id, title: String(item.title || '').slice(0, 200), sub: String(item.sub || '').slice(0, 200), thumb: /^https:/.test(String(item.thumb || '')) ? String(item.thumb) : '' };
  if (front) { ctl.queue.splice(ctl.nextN, 0, entry); ctl.nextN += 1; } // after earlier "play next" songs, before the rest
  else ctl.queue.push(entry);
  return ctl.queue.slice();
});
ipcMain.handle('player:queue', () => ctl.queue.slice());
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
const songKey = `(() => { ${PICK_VIDEO} const v = pickVideo(); const m = navigator.mediaSession && navigator.mediaSession.metadata; return JSON.stringify({ href: location.href, title: m ? m.title : '', cur: v ? v.currentTime : 0 }); })()`;
const skipToEnd = videoDo('if (isFinite(v.duration) && v.duration > 1) v.currentTime = Math.max(0, v.duration - 0.4);');

const playerApi = (method) => `(() => { const p = document.querySelector('#movie_player'); if (p && typeof p.${method} === 'function') { p.${method}(); return true; } return false; })()`;


/* ---------- shuffle and repeat (handled here, not by clicking the page's buttons) ---------- */

const ctl = { queue: [], nextN: 0, divert: null, trace: [], solo: false, shuffle: false, repeat: 'off', order: [], pos: 0, lastJump: 0, snap: null, spaWorks: null, spaFails: 0, ids: [], idsFor: '', idsAt: 0, idsTries: 0, idsBusy: false };
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

// Runs in the page: switch to a song inside YouTube Music without reloading the page, if the site lets us.
const spaNavigateScript = (videoId, listId) => `(async () => {
  const app = document.querySelector('ytmusic-app');
  const endpoint = { watchEndpoint: Object.assign({ videoId: ${JSON.stringify(videoId)} }, ${JSON.stringify(listId || '')} ? { playlistId: ${JSON.stringify(listId || '')} } : {}) };
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

// Called after every poll. Handles what should happen when a song reaches its end.
function controllerTick(s) {
  if (s.ad || !ytView) return;
  ensureTrackIds();
  const now = Date.now();
  const atEnd = s.dur > 5 && (s.ended || s.cur >= s.dur - 0.9);
  if (!atEnd || now - ctl.lastJump < 3000) return;

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
    return after.title !== before.title || (before.cur > 6 && after.cur < before.cur - 4);
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

ipcMain.on('adblock:testhost', (event) => { event.returnValue = !!process.env.YT_URL_FOR_TESTS; });
ipcMain.on('adblock:get', (event) => { event.returnValue = adBlock; });

ipcMain.handle('adblock:set', async (_e, on) => {
  adBlock = !!on;
  saveSettings({ ...loadSettings(), adBlock });
  if (ytView && !ytView.webContents.isDestroyed()) {
    try { await ytView.webContents.executeJavaScript(`if (window.__lpAdPrune) window.__lpAdPrune.enabled = ${adBlock};`, true); } catch (_) { /* ignore */ }
  }
  return adBlock;
});

/* ---------- album colours ---------- */

const paletteCache = new Map();
const ART_HOST = /(^|\.)(googleusercontent\.com|ggpht\.com|ytimg\.com|gstatic\.com)$/i;

// Downloads the cover (only from Google/YouTube image hosts) and decodes it.
const artImageCache = new Map();
async function loadArtImage(url) {
  const u = new URL(String(url || ''));
  const isTestData = u.protocol === 'data:' && process.env.YT_URL_FOR_TESTS;
  if (!isTestData && !(u.protocol === 'https:' && ART_HOST.test(u.hostname))) return null;
  if (artImageCache.has(url)) return artImageCache.get(url);
  let buf;
  if (isTestData) buf = Buffer.from(String(url).split(',')[1] || '', 'base64');
  else {
    const res = await net.fetch(String(url));
    if (!res.ok) return null;
    buf = Buffer.from(await res.arrayBuffer());
  }
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) return null;
  if (artImageCache.size > 40) artImageCache.clear();
  artImageCache.set(url, img);
  return img;
}

ipcMain.handle('art:palette', async (_e, url) => {
  try {
    if (paletteCache.has(url)) return paletteCache.get(url);
    const img = await loadArtImage(url);
    if (!img) return null;
    const palette = Palette.fromPixels(img.resize({ width: 24, height: 24 }).toBitmap(), 'bgra');
    if (paletteCache.size > 200) paletteCache.clear();
    paletteCache.set(url, palette);
    return palette;
  } catch (_) {
    return null;
  }
});

// A 224x224 RGBA copy of the cover, for the cover filter (which runs in the window).
ipcMain.handle('art:thumb', async (_e, url) => {
  try {
    const img = await loadArtImage(url);
    if (!img) return null;
    const bgra = img.resize({ width: 224, height: 224 }).toBitmap();
    const rgba = Buffer.alloc(bgra.length);
    for (let i = 0; i < bgra.length; i += 4) {
      rgba[i] = bgra[i + 2];
      rgba[i + 1] = bgra[i + 1];
      rgba[i + 2] = bgra[i];
      rgba[i + 3] = 255;
    }
    return { w: 224, h: 224, data: new Uint8Array(rgba) };
  } catch (_) {
    return null;
  }
});

/* ---------- fullscreen ---------- */

ipcMain.handle('app:fullscreen', (_e, on) => {
  if (!win) return false;
  win.setFullScreen(on == null ? !win.isFullScreen() : !!on);
  return win.isFullScreen();
});

/* ---------- IPC ---------- */

function safeLyricsFile(name) {
  const base = path.basename(String(name || ''));
  const full = path.join(lyricsDir(), base);
  if (!/\.(lrc|txt)$/i.test(base)) throw new Error('Unsupported lyrics file type');
  return full;
}

ipcMain.handle('settings:get', () => loadSettings());

ipcMain.handle('settings:set', (_event, patch) => {
  const next = { ...loadSettings(), ...(patch || {}) };
  saveSettings(next);
  return next;
});

ipcMain.handle('app:switchHost', () => {
  const next = host === 'localhost' ? '127.0.0.1' : 'localhost';
  saveSettings({ ...loadSettings(), host: next });
  host = next;
  if (win) win.loadURL(`http://${host}:${port}/`);
});

ipcMain.handle('lyrics:dir', () => lyricsDir());

ipcMain.handle('lyrics:list', () => {
  const dir = lyricsDir();
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(lrc|txt)$/i.test(f))
    .map((f) => ({ file: f, name: f.replace(/\.(lrc|txt)$/i, '') }))
    .sort((a, b) => a.file.localeCompare(b.file));
});

ipcMain.handle('lyrics:read', (_event, name) => {
  const text = fs.readFileSync(safeLyricsFile(name), 'utf8');
  return text.replace(/^﻿/, '');
});

ipcMain.handle('lyrics:write', (_event, { title, content, existingFile }) => {
  let fileName;
  if (existingFile) {
    fileName = path.basename(existingFile);
    safeLyricsFile(fileName);
  } else {
    const ext = Lyrics.hasTimestamps(content) ? '.lrc' : '.txt';
    fileName = Lyrics.sanitizeFileName(title) + ext;
  }
  fs.writeFileSync(safeLyricsFile(fileName), String(content || ''), 'utf8');
  return { file: fileName };
});

/* ---------- online lyrics ----------
   LRCLIB first. If it has nothing (or can't be reached), two backups are tried in order:
   NetEase Cloud Music (timed lyrics) and lyrics.ovh (plain text). Only the song title, artist and
   length are sent. Found lyrics are saved into the lyrics folder, so each song is looked up once
   and can be edited later. */

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

ipcMain.handle('lyrics:fetch', async (_event, { title, track, artist, author, duration, timedOnly }) => {
  if (loadSettings().autoFetch === false) return { status: 'disabled' };
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

ipcMain.handle('lyrics:chooseFolder', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose your lyrics folder',
    defaultPath: lyricsDir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  saveSettings({ ...loadSettings(), lyricsDir: result.filePaths[0] });
  return result.filePaths[0];
});

ipcMain.handle('lyrics:openFolder', () => shell.openPath(lyricsDir()));

/* ---------- lifecycle ---------- */

app.whenReady().then(async () => {
  adBlock = loadSettings().adBlock !== false;
  // Present as a normal Chromium browser (drops the "Electron/x.y.z" token).
  const ses = session.defaultSession;
  ses.setUserAgent(ses.getUserAgent().replace(/\s*Electron\/\S+/i, ''));

  port = await startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (server) server.close();
  app.quit();
});
