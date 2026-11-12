const { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell, session, net, nativeImage, clipboard, screen, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const Lyrics = require('./renderer/lyrics.js');
const Quran = require('./quran.js');
const Palette = require('./renderer/palette.js');
const Discord = require('./discord.js').createDiscord();

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

let settingsCache = null;
let settingsTimer = null;

/* Read once, then served from memory (a copy, so callers can change theirs freely). */
function loadSettings() {
  if (settingsCache === null) {
    try {
      settingsCache = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    } catch {
      settingsCache = {};
    }
    if (!settingsCache || typeof settingsCache !== 'object' || Array.isArray(settingsCache)) settingsCache = {};
  }
  return { ...settingsCache };
}

function writeSettingsNow() {
  if (settingsTimer) { clearTimeout(settingsTimer); settingsTimer = null; }
  if (settingsCache === null) return;
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    const tmp = settingsPath() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(settingsCache, null, 2));
    fs.renameSync(tmp, settingsPath());
  } catch (e) {
    try { fs.writeFileSync(settingsPath(), JSON.stringify(settingsCache, null, 2)); } catch { /* nothing more to try */ }
  }
}

/* The memory copy changes at once; the file follows a moment later (and always on quit), so the
   resume-position save every few seconds does not hit the disk each time. */
function saveSettings(settings) {
  settingsCache = { ...settings };
  if (!settingsTimer) settingsTimer = setTimeout(writeSettingsNow, 400);
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

function createWindow(startHidden) {
  win = new BrowserWindow({
    show: !startHidden,
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
  // With "keep in tray" on, the close button only hides the window; the tray menu's Quit really exits.
  win.on('close', (event) => {
    if (quitting) return;
    const what = closeDecision(loadSettings(), !!tray);
    if (what === 'quit') return;
    event.preventDefault();
    if (what === 'tray') hideToTray(); else askBeforeClosing();
  });
  win.on('session-end', () => { quitting = true; });
  win.on('enter-full-screen', () => win && win.webContents.send('app:fullscreen', true));
  win.on('leave-full-screen', () => win && win.webContents.send('app:fullscreen', false));
  win.on('closed', () => {
    if (miniWin && !miniWin.isDestroyed()) miniWin.destroy();
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
let stateHook = null; // Windows mini player: gets every player state
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
    if (art) art = art.replace(/=w\\d+-h\\d+[^"']*$/, '=w800-h800');
    const adNow = !!q('.ad-showing, .ad-interrupting');
    window.__lpAdNow = adNow;
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
    const vid = new URL(location.href).searchParams.get('v') || '';
    // Set the volume only when it needs setting (the slider moved, a new song, or a new player), not on every look:
    // pushing it back every quarter second fights YouTube's own level changes and can be heard as jumps.
    if (v && want != null && !window.__lpAdNow) {
      const key = want + '|' + vid;
      if (window.__lpVolKey !== key || window.__lpVolEl !== v) {
        window.__lpVolKey = key; window.__lpVolEl = v;
        if (Math.abs(v.volume * 100 - want) > 1.5) { v.volume = Math.max(0, Math.min(1, want / 100)); window.__lpLastVol = v.volume; }
      }
    }
    // Diagnostic: remember any sudden volume change the app did not make, so the cause can be found.
    if (v) {
      const lg = window.__lpVolLog || (window.__lpVolLog = []);
      const lv = window.__lpLastVol;
      if (lv != null && Math.abs(v.volume - lv) > 0.1 && lg.length < 20) {
        lg.push({ at: Date.now(), pos: Math.round(v.currentTime), from: Math.round(lv * 100), to: Math.round(v.volume * 100), muted: v.muted, ad: !!window.__lpAdNow, gap: window.__lpPrev ? Date.now() - window.__lpPrev : 0 });
      }
      window.__lpLastVol = v.volume; window.__lpPrev = Date.now();
    }
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
    // Nobody watches the video (only the sound matters), so ask the page for its smallest picture, once per song.
    if (v && vid && window.__lpLowQ !== vid) {
      window.__lpLowQ = vid;
      try { const mp = document.getElementById('movie_player'); if (mp && mp.setPlaybackQualityRange) mp.setPlaybackQualityRange('tiny', 'tiny'); } catch (_) { /* the page changed: skip */ }
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
      volLog: (window.__lpVolLog && window.__lpVolLog.length) ? window.__lpVolLog.splice(0) : null,
      curIdx,
      volume: v ? Math.round(v.volume * 100) : null,
      listId: new URL(location.href).searchParams.get('list') || '',
      url: location.href,
    };
  } catch (e) { return { hasMedia: false, error: String(e) }; }
})()`;

// Writes sudden volume changes (the app did not cause them) to volume-log.txt in the app's data folder.
function logVolume(list) {
  try {
    const f = path.join(app.getPath('userData'), 'volume-log.txt');
    let old = ''; try { old = fs.readFileSync(f, 'utf8'); } catch (_) { /* first entry */ }
    const lines = list.map((e) => new Date(e.at).toISOString() + ' song@' + e.pos + 's volume ' + e.from + ' -> ' + e.to + ' muted=' + e.muted + ' ad=' + e.ad + ' lookGap=' + e.gap + 'ms (adblock ' + (adBlock ? 'on' : 'off') + ')');
    fs.writeFileSync(f, (old + lines.join('\n') + '\n').split('\n').slice(-200).join('\n'));
  } catch (_) { /* diagnostic only */ }
}

async function pollYt() {
  if (ytPolling || !ytView || !win || ytView.webContents.isDestroyed()) return;
  // Minimised or hidden: look a quarter as often, except near the end of a song so the next one still starts on time.
  if (!stateHook && (win.isMinimized() || !win.isVisible())) {
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
    if (state && Array.isArray(state.volLog) && state.volLog.length) logVolume(state.volLog);
    ctl.snap = state;
    if (state && Array.isArray(state.queueIds)) ctl.qids = state.queueIds;
    if (state && state.hasMedia) controllerTick(state);
    if (state) { learnMeta(state); state.next = computeNext(state); }
    if (win && !win.isDestroyed()) win.webContents.send('player:state', state);
    if (stateHook && state) stateHook(state);
    Discord.update(state);
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
const SONGS_ONLY = 'EgWKAQIIAWoMEA4QChADEAQQCRAF'; // YouTube Music's own "Songs" filter: album tracks, no videos
const searchScript = (query, songsOnly) => `(async () => {
  try {
    const cfg = window.ytcfg;
    const get = (k) => (cfg && typeof cfg.get === 'function' ? cfg.get(k) : cfg && cfg.data_ ? cfg.data_[k] : undefined);
    const key = get('INNERTUBE_API_KEY');
    const context = get('INNERTUBE_CONTEXT');
    if (!key || !context) return JSON.stringify({ wait: true });
    const res = await fetch('/youtubei/v1/search?prettyPrint=false&key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ context, query: ${JSON.stringify(query)}${songsOnly ? `, params: ${JSON.stringify(SONGS_ONLY)}` : ''} }),
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
      let type = String(sub[0] || '').trim();
      let detailRuns = sub.slice(1);
      if (${songsOnly ? 'true' : 'false'} && !/^(song|video)$/i.test(type)) { type = 'Song'; detailRuns = sub; } // the Songs filter lists "Artist • Album • time" with no "Song" in front
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
      const detail = detailRuns.join('').replace(/^[\\s•·]+/, '').trim();
      out.push({ kind, id, title, sub: detail || type, type, thumb });
      if (out.length >= 24) break;
    }
    return JSON.stringify({ results: out });
  } catch (e) { return JSON.stringify({ error: String(e && e.message || e) }); }
})()`;

async function searchYt(query, songsOnly) {
  const q = String(query || '').trim().slice(0, 120);
  if (!ytView || q.length < 2) return { results: [] };
  const wc = ytView.webContents;
  let last = 'YouTube Music is still loading';
  for (let i = 0; i < 20; i++) { // the page may still be starting up (up to ~14 s)
    try {
      const r = JSON.parse(await wc.executeJavaScript(searchScript(q, !!songsOnly), true) || '{}');
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
ipcMain.handle('player:enqueueMany', (_e, items, front, asPlaylist, seed) => {
  const room = 200 - ctl.queue.length;
  const tidy = (list) => (Array.isArray(list) ? list : []).filter((x) => x && /^[A-Za-z0-9_-]{11}$/.test(String(x.id || ''))).map((x) => ({
    id: String(x.id), title: String(x.title || '').slice(0, 200), sub: String(x.sub || '').slice(0, 200), thumb: /^https:/.test(String(x.thumb || '')) ? String(x.thumb) : '',
  }));
  const clean = tidy(items).slice(0, Math.max(0, room));
  if (Array.isArray(seed)) ctl.played = tidy(seed).slice(-200); // songs of this playlist that came before (a restored session), so Repeat can start the whole playlist over
  if (front && asPlaylist) ctl.queue.splice(ctl.nextN, 0, ...clean); // a whole playlist: in order, but shuffle and repeat can work on it
  else if (front) { ctl.queue.splice(ctl.nextN, 0, ...clean); ctl.nextN += clean.length; } else ctl.queue.push(...clean);
  ctl.pick = -1;
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
      let seen = []; // what the search did return, so a "not found" song can say what was rejected
      if (t.title) {
        // Album tracks first (the Songs filter), then looser searches, so a music video is only used when there is no song.
        for (const tryIt of Lyrics.searchTries(t)) {
          const res = await searchYt(tryIt.query, tryIt.songsOnly);
          hit = Lyrics.matchTrack(t, res.results || []);
          if (!hit) for (const x of (res.results || []).filter((y) => y && y.kind === 'song').slice(0, 5)) { const s1 = `${x.title} · ${String(x.sub || '(no details)').split(' • ').slice(0, 3).join(' • ')}`; if (seen.length < 10 && !seen.includes(s1)) seen.push(s1); }
          if (res.error && !(res.results || []).length && !items.length && importState.done === 0) throw new Error(res.error);
          if (hit) break;
          await wait(Math.min(gap, 250));
        }
      }
      if (hit && !items.some((x) => x.id === hit.id)) {
        const it = { id: hit.id, title: hit.title, sub: hit.sub, thumb: hit.thumb || '' };
        items.push(it);
        ctl.meta.set(it.id, it);
        importState.found += 1;
      } else if (!hit) missing.push(seen.length ? `${label}  (searched, but only found: ${seen.join(' | ')})` : `${label}  (nothing came back from the search)`);
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
  if (Number.isInteger(i) && i >= 0 && i < ctl.queue.length) { ctl.queue.splice(i, 1); if (i < ctl.nextN) ctl.nextN -= 1; ctl.pick = -1; }
  return ctl.queue.slice();
});
ipcMain.handle('player:clearQueue', () => { ctl.queue = []; ctl.nextN = 0; ctl.played = []; ctl.pick = -1; return []; });

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

const ctl = { meta: new Map(), wantId: '', queue: [], nextN: 0, played: [], pick: -1, divert: null, trace: [], solo: false, shuffle: false, repeat: 'off', order: [], pos: 0, lastJump: 0, snap: null, spaWorks: null, spaFails: 0, ids: [], idsFor: '', idsAt: 0, idsTries: 0, idsBusy: false };
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

// Which queued song is next: the first one, or with Shuffle on a random one (chosen once, so "Up next" can show it).
// Songs added with "play next" always go first.
function queueIndex() {
  if (ctl.nextN > 0 || !ctl.shuffle || ctl.queue.length < 2) return 0;
  if (!(ctl.pick >= 0 && ctl.pick < ctl.queue.length)) ctl.pick = Math.floor(Math.random() * ctl.queue.length);
  return ctl.pick;
}

function takeQueued() {
  if (!ctl.queue.length) return null;
  const idx = queueIndex();
  const it = ctl.queue.splice(idx, 1)[0];
  if (it && ctl.nextN > 0) ctl.nextN -= 1;
  ctl.pick = -1;
  if (it) { ctl.played.push(it); if (ctl.played.length > 200) ctl.played.shift(); }
  return it || null;
}

// Repeat: playlist. The queue ran dry, so it fills up again with the songs that were played from it.
function refillQueue() {
  if (ctl.repeat !== 'all' || ctl.queue.length || ctl.played.length < 2) return false;
  ctl.queue = ctl.played.splice(0);
  ctl.nextN = 0; ctl.pick = -1;
  return true;
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
  if (!ctl.queue.length && ctl.repeat === 'all' && onQueuedSong(s) && ctl.played.length > 1) item = ctl.played[0];
  else if (ctl.queue.length) item = ctl.queue[queueIndex()];
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
  return { id: item.id, title: item.title || '', sub: item.sub || '', thumb: item.thumb || (item.id ? `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg` : ''), queued: item === ctl.queue[queueIndex()] };
}

// Called after every poll. Handles what should happen when a song reaches its end.
function controllerTick(s) {
  if (s.ad || !ytView) return;
  ensureTrackIds();
  const now = Date.now();
  const atEnd = s.dur > 5 && (s.ended || s.cur >= s.dur - 0.9);
  if (!atEnd || now - ctl.lastJump < 3000) return;

  if (ctl.repeat !== 'one') {
    if (ctl.queue.length) { playQueued(s.videoId); return; }
    if (onQueuedSong(s) && refillQueue()) { playQueued(s.videoId); return; }
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
  if (name === 'next' && onQueuedSong(ctl.snap) && refillQueue()) { await playQueued(ctl.snap && ctl.snap.videoId); return true; }
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

const playerCmd = async (name, arg) => {
  if (!ytView) return false;
  const wc = ytView.webContents;
  const num = Number(arg);
  try {
    switch (name) {
      case 'play': await wc.executeJavaScript(videoDo('v.play();'), true); return true;
      case 'pause': await wc.executeJavaScript(videoDo('v.pause();'), true); return true;
      case 'toggle': await wc.executeJavaScript(videoDo('if (v.paused) v.play(); else v.pause();'), true); return true;
      case 'next': case 'prev': return await stepTrack(wc, name);
      case 'setShuffle': ctl.shuffle = !!arg; ctl.pick = -1; ctl.order = []; ctl.orderLen = 0; ctl.pos = 0; return true;
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
};
ipcMain.handle('player:cmd', (_e, name, arg) => playerCmd(name, arg));

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

/* ---------- mini player (Windows only) ----------
   A small always-on-top pill: cover, song, artist and rolling lyrics, with the controls showing on hover.
   It is a second light window that only receives text: the main window keeps doing all the real work
   (playing, finding lyrics, colours) and hands the results over. Nothing runs while it is closed. */
const MINI_W = 380;
const MINI_H = 98;
let miniWin = null;
let miniDrag = null;
const miniData = { palette: null, lyrics: null, cover: false, state: null };

function miniStart() {
  const saved = loadSettings().miniPos;
  let x; let y;
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const d = screen.getDisplayMatching({ x: saved.x, y: saved.y, width: MINI_W, height: MINI_H }).workArea;
    if (saved.x + 60 < d.x + d.width && saved.x + MINI_W - 60 > d.x && saved.y >= d.y - 10 && saved.y + 40 < d.y + d.height) { x = saved.x; y = saved.y; }
  }
  if (x === undefined) { const d = screen.getPrimaryDisplay().workArea; x = Math.round(d.x + (d.width - MINI_W) / 2); y = d.y + 14; } // top centre, like an island
  return { x, y };
}

// Windows lets other always-on-top windows, and any window raised after ours, slip over a topmost window that was shown
// without focus. So the mini player claims the top again when it is shown, when focus moves, and every couple of seconds.
function raiseMini() {
  if (!miniWin || miniWin.isDestroyed()) return;
  try {
    miniWin.setAlwaysOnTop(true, process.platform === 'win32' ? 'screen-saver' : 'floating');
    miniWin.moveTop();
  } catch (_) { /* window closing */ }
}

function openMini() {
  if (!win || win.isDestroyed()) return false;
  if (miniWin && !miniWin.isDestroyed()) { miniWin.show(); return true; }
  const { x, y } = miniStart();
  miniWin = new BrowserWindow({
    width: MINI_W, height: MINI_H, x, y,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false, title: 'Lyric Player mini',
    webPreferences: { preload: path.join(__dirname, 'mini-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  miniWin.setAlwaysOnTop(true, 'floating');
  miniWin.setMenuBarVisibility(false);
  miniWin.on('system-context-menu', (e) => e.preventDefault());
  miniWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  miniWin.webContents.on('will-navigate', (e) => e.preventDefault());
  miniWin.loadURL(`http://${host}:${port}/mini.html`);
  miniWin.once('ready-to-show', () => { if (miniWin && !miniWin.isDestroyed()) { miniWin.showInactive(); raiseMini(); } });
  miniWin.on('blur', raiseMini);
  miniWin.on('show', raiseMini);
  const keepTop = setInterval(raiseMini, 2000);
  stateHook = (s) => {
    if (!miniWin || miniWin.isDestroyed()) return;
    const st = { hasMedia: !!s.hasMedia, ad: !!s.ad, title: s.title || '', artist: s.artist || '', art: s.art || '', cur: s.cur || 0, dur: s.dur || 0, playing: !!s.playing,
      next: s.next && s.next.title ? { title: String(s.next.title).slice(0, 120), artist: String(s.next.sub || '').split(' • ')[0].slice(0, 80) } : null };
    miniData.state = st;
    miniWin.webContents.send('mini:state', st);
  };
  miniWin.on('closed', () => {
    clearInterval(keepTop);
    if (miniDrag) { clearInterval(miniDrag.t); miniDrag = null; }
    miniWin = null;
    stateHook = null;
    if (win && !win.isDestroyed()) { win.webContents.setBackgroundThrottling(true); if (!win.isVisible()) win.show(); if (win.isMinimized()) win.restore(); win.focus(); win.webContents.send('mini:closed'); }
  });
  win.webContents.setBackgroundThrottling(false); // the main window keeps working while it is out of sight
  win.minimize();
  win.webContents.send('mini:opened');
  return true;
}

function closeMini() { if (miniWin && !miniWin.isDestroyed()) miniWin.close(); }

ipcMain.handle('mini:toggle', () => { if (miniWin && !miniWin.isDestroyed()) { closeMini(); return false; } return openMini(); });
ipcMain.handle('mini:init', () => ({ ...miniData }));
ipcMain.on('mini:lyrics', (_e, d) => { miniData.lyrics = d; if (miniWin && !miniWin.isDestroyed()) miniWin.webContents.send('mini:lyrics', d); });
ipcMain.on('mini:palette', (_e, c) => { miniData.palette = c; if (miniWin && !miniWin.isDestroyed()) miniWin.webContents.send('mini:palette', c); });
ipcMain.on('mini:cover', (_e, hidden) => { miniData.cover = !!hidden; if (miniWin && !miniWin.isDestroyed()) miniWin.webContents.send('mini:cover', !!hidden); });
ipcMain.handle('mini:cmd', (e, name, arg) => {
  if (!miniWin || e.sender !== miniWin.webContents) return false;
  return ['toggle', 'next', 'prev'].includes(name) ? playerCmd(name, arg) : false;
});
ipcMain.on('mini:expand', (e) => { if (miniWin && e.sender === miniWin.webContents) closeMini(); }); // closing it brings the full window back
ipcMain.on('mini:dragStart', (e) => {
  if (!miniWin || e.sender !== miniWin.webContents || miniDrag) return;
  const c = screen.getCursorScreenPoint();
  const b = miniWin.getBounds();
  miniDrag = { cx: c.x, cy: c.y, x: b.x, y: b.y };
  miniDrag.t = setInterval(() => {
    if (!miniWin || miniWin.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    miniWin.setBounds({ x: miniDrag.x + p.x - miniDrag.cx, y: miniDrag.y + p.y - miniDrag.cy, width: MINI_W, height: MINI_H });
  }, 8);
});
ipcMain.on('mini:dragEnd', () => {
  if (!miniDrag) return;
  clearInterval(miniDrag.t);
  miniDrag = null;
  if (miniWin && !miniWin.isDestroyed()) { const b = miniWin.getBounds(); saveSettings({ ...loadSettings(), miniPos: { x: b.x, y: b.y } }); }
});

// Saved playlists live in their own file (read only when asked for, written only when they change),
// so the settings file that is rewritten every few seconds stays small.
const savedPath = () => path.join(app.getPath('userData'), 'saved-playlists.json');
let savedCache = null;
ipcMain.handle('saved:get', () => {
  if (!savedCache) { try { const v = JSON.parse(fs.readFileSync(savedPath(), 'utf8')); savedCache = Array.isArray(v) ? v : []; } catch { savedCache = []; } }
  return savedCache;
});
ipcMain.handle('saved:set', (_e, list) => {
  savedCache = (Array.isArray(list) ? list : []).slice(0, 30);
  try { fs.mkdirSync(path.dirname(savedPath()), { recursive: true }); fs.writeFileSync(savedPath(), JSON.stringify(savedCache)); } catch { /* ignore */ }
  return true;
});

ipcMain.on('discord:cover', (_e, url, ok) => { Discord.setCover(typeof url === 'string' ? url : '', ok === true); });

ipcMain.handle('settings:get', () => loadSettings());

ipcMain.handle('settings:set', (_event, patch) => {
  const next = { ...loadSettings(), ...(patch || {}) };
  if (patch && 'keepInTray' in patch && !('askOnClose' in patch)) next.askOnClose = true; // switching it by hand brings the question back
  saveSettings(next);
  if (patch && 'launchAtLogin' in patch) applyLaunchAtLogin(next.launchAtLogin === true);
  if (patch && 'keepInTray' in patch) applyTray(next.keepInTray === true);
  if (patch && 'discordPresence' in patch) { if (next.discordPresence === true) Discord.start(); else Discord.stop(); }
  return next;
});

ipcMain.handle('app:switchHost', () => {
  const next = host === 'localhost' ? '127.0.0.1' : 'localhost';
  saveSettings({ ...loadSettings(), host: next });
  host = next;
  if (win) win.loadURL(`http://${host}:${port}/`);
});

ipcMain.handle('lyrics:dir', () => lyricsDir());

// Lyrics this app downloaded before the artist went into the file name are named by the title alone, so they can belong to a
// different song with the same title. They stay on disk but are not matched any more; the song's lyrics are fetched again.
function oldDownload(file, fetched) { return fetched.has(file) && !/ - /.test(file); }

ipcMain.handle('lyrics:list', () => {
  const dir = lyricsDir();
  const fetched = new Set(loadSettings().fetchedLyrics || []);
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(lrc|txt)$/i.test(f) && !oldDownload(f, fetched))
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

// The newest published build of this app (for the update button). Only the two release tags are ever asked for.
ipcMain.handle('app:latestRelease', async (_e, tag) => {
  if (tag !== 'latest' && tag !== 'windows-latest' && tag !== 'linux-latest') return null;
  try {
    const r = await jsonGet('GitHub', `https://api.github.com/repos/Syncstanza/lyric-player/releases/tags/${tag}`, { Accept: 'application/vnd.github+json' });
    if (!r) return null;
    return { sha: String(r.target_commitish || ''), assets: (r.assets || []).map((x) => ({ name: String(x.name || ''), url: String(x.browser_download_url || '') })) };
  } catch (_) { return null; }
});

/* ---------- announcements: a small file in the repo that the app reads (see docs/RELEASING.md) ---------- */
ipcMain.handle('app:announcements', async () => {
  try { return Lyrics.cleanAnnouncements(await jsonGet('GitHub', 'https://raw.githubusercontent.com/Syncstanza/lyric-player/main/announcements.json', {}, 10000)); }
  catch (_) { return []; }
});

/* ---------- translation (lyric lines and the app's own labels) ----------
   The free Google Translate web endpoint first, MyMemory as a backup. Only the text to translate is sent. */
const GT_URL = 'https://translate.googleapis.com/translate_a/single';
const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';

async function gtLines(lines, target) { // lines: non-empty, one line each. Returns { out, src } or null if the answer didn't line up.
  const r = await jsonGet('Translate', `${GT_URL}?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(lines.join('\n'))}`, {}, 12000);
  if (!r || !Array.isArray(r[0])) return null;
  const parts = r[0].map((seg) => (seg && seg[0]) || '').join('').split('\n').map((x) => x.trim());
  while (parts.length > lines.length && parts[parts.length - 1] === '') parts.pop();
  return parts.length === lines.length ? { out: parts, src: typeof r[2] === 'string' ? r[2] : '' } : null;
}

async function myMemoryLine(line, target) {
  try {
    const r = await jsonGet('MyMemory', `${MYMEMORY_URL}?q=${encodeURIComponent(line.slice(0, 450))}&langpair=${encodeURIComponent('autodetect|' + target)}`, {}, 10000);
    const t = r && r.responseData && r.responseData.translatedText;
    return t && Number(r.responseStatus) === 200 && !/MYMEMORY WARNING|INVALID|QUERY LENGTH/i.test(t) ? String(t) : null;
  } catch (_) { return null; }
}

async function translateTexts(texts, target) {
  const clean = (Array.isArray(texts) ? texts : []).slice(0, 400).map((x) => String(x == null ? '' : x).replace(/[\r\n\u2028\u2029]+/g, ' ').trim().slice(0, 400));
  const uniq = [...new Set(clean.filter(Boolean))];
  const done = new Map();
  let src = '';
  // chunks stay small enough for a web address
  const chunks = [];
  let cur = [];
  let size = 0;
  for (const t of uniq) {
    const n = encodeURIComponent(t).length + 3;
    if (cur.length && (size + n > 5500 || cur.length >= 60)) { chunks.push(cur); cur = []; size = 0; }
    cur.push(t);
    size += n;
  }
  if (cur.length) chunks.push(cur);
  let fallbackLeft = 40;
  for (const chunk of chunks) {
    let got = null;
    try { got = await gtLines(chunk, target); } catch (_) { got = null; }
    if (got) { chunk.forEach((t, i) => done.set(t, got.out[i])); if (!src) src = got.src; continue; }
    // the batch failed or came back misaligned: line by line through the backup service
    for (let i = 0; i < chunk.length && fallbackLeft > 0; i += 3) {
      const group = chunk.slice(i, i + 3);
      fallbackLeft -= group.length;
      const res = await Promise.all(group.map((t) => myMemoryLine(t, target)));
      group.forEach((t, k) => { if (res[k]) done.set(t, res[k]); });
    }
  }
  if (uniq.length && !done.size) return null;
  return { lines: clean.map((t) => (t ? (done.get(t) || '') : '')), src };
}

ipcMain.handle('text:translate', async (_e, p) => {
  const target = p && typeof p.target === 'string' ? p.target : '';
  if (!/^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$/.test(target)) return null;
  try { return await translateTexts(p.texts, target); } catch (_) { return null; }
});

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
    // only the same song: a different song that merely came up in the search must never be shown
    const usable = results.filter((r) => hasLyrics(r) && Lyrics.sameSong(track, artist, r.trackName, r.artistName));
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
  // The artist is part of the name so two songs with the same title ("Demons", "Memories") never share one file.
  const base = Lyrics.sanitizeFileName((title || track) + (artist ? ' - ' + artist : ''));
  if (skip) for (const f of new Set([replaceFile, base + '.lrc', base + '.txt'].filter(Boolean))) { try { fs.unlinkSync(safeLyricsFile(f)); } catch (_) { /* not there */ } }
  const file = base + (synced ? '.lrc' : '.txt');
  fs.writeFileSync(safeLyricsFile(file), pick.text, 'utf8');
  if (!skip && synced) { try { fs.unlinkSync(safeLyricsFile(base + '.txt')); } catch (_) { /* no old plain copy */ } }
  const fetched = new Set(loadSettings().fetchedLyrics || []); fetched.add(file); fetched.add(base + (synced ? '.txt' : '.lrc'));
  saveSettings({ ...loadSettings(), fetchedLyrics: [...fetched].slice(-2000) });
  return { status: 'ok', file, synced, source: pick.source, index: skip, more: ordered.length - skip - 1 };
});

ipcMain.handle('lyrics:fetched', () => loadSettings().fetchedLyrics || []);

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

/* ---------- desktop extras: launch at startup and keep running in the tray (Windows and Linux) ----------
   Both are off until switched on in the Menu. */
let tray = null;
let quitting = false;
let closePromptOpen = false;

// What the close button does: ask (the default, even with the tray switch on, because people forget it is on), or the answer
// remembered with "Don't ask again": hide to the tray, or quit.
function closeDecision(st, hasTray) {
  if (st.askOnClose !== false) return 'ask';
  return st.keepInTray === true && hasTray ? 'tray' : 'quit';
}

function hideToTray() {
  if (!win || win.isDestroyed()) return;
  if (win.isFullScreen()) win.setFullScreen(false);
  win.hide();
}

// The close button asks once: keep it running in the tray, or close for good. "Don't ask again" remembers the answer.
async function askBeforeClosing() {
  if (closePromptOpen || !win || win.isDestroyed()) return;
  closePromptOpen = true;
  try {
    const r = await dialog.showMessageBox(win, {
      type: 'question', title: 'Close Lyric Player', noLink: true,
      message: 'Close Lyric Player for good, or keep it running in the tray?',
      detail: 'In the tray the music keeps playing. Use the tray icon to open it again or to quit.',
      buttons: ['Keep in tray', 'Close for good', 'Cancel'], defaultId: 0, cancelId: 2,
      checkboxLabel: "Don't ask again", checkboxChecked: false,
    });
    if (r.response === 2) return;
    if (r.response === 0) {
      applyTray(true);
      if (!tray) { dialog.showErrorBox('No tray here', "This system doesn't show tray icons, so Lyric Player can't stay in the tray."); return; }
      if (r.checkboxChecked) { const next = { ...loadSettings(), keepInTray: true, askOnClose: false }; saveSettings(next); notifySettings(next); }
      hideToTray();
    } else {
      if (r.checkboxChecked) { const next = { ...loadSettings(), keepInTray: false, askOnClose: false }; saveSettings(next); notifySettings(next); }
      quitting = true;
      app.quit();
    }
  } finally { closePromptOpen = false; }
}

function notifySettings(next) {
  try { if (win && !win.isDestroyed()) win.webContents.send('settings:changed', next); } catch (_) { /* window gone */ }
}
const startedAtLogin = process.argv.includes('--at-login');

// What the system should launch: the portable .exe / AppImage itself, the installed binary, or electron + this folder in development.
function launchTarget() {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.env.APPIMAGE || process.execPath;
  const args = !app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE && !process.env.APPIMAGE ? [app.getAppPath()] : [];
  return { exe, args: [...args, '--at-login'] };
}

const autostartFile = () => path.join(process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'), '.config'), 'autostart', 'lyric-player.desktop');

function applyLaunchAtLogin(on) {
  try {
    const t = launchTarget();
    if (process.platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin: on, path: t.exe, args: t.args });
    } else if (process.platform === 'linux') {
      if (on) {
        const q = (x) => '"' + x.replace(/(["\\$`])/g, '\\$1') + '"';
        fs.mkdirSync(path.dirname(autostartFile()), { recursive: true });
        fs.writeFileSync(autostartFile(), [
          '[Desktop Entry]', 'Type=Application', 'Name=Lyric Player', 'Comment=YouTube Music with synced lyrics',
          'Exec=' + [t.exe, ...t.args].map(q).join(' '), 'Terminal=false', 'X-GNOME-Autostart-enabled=true', '',
        ].join('\n'));
      } else {
        fs.rmSync(autostartFile(), { force: true });
      }
    }
  } catch (_) { /* a failed startup entry should never break the app */ }
}

function showMain() {
  if (!win || win.isDestroyed()) { createWindow(false); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function applyTray(on) {
  if (!on) {
    if (tray) { tray.destroy(); tray = null; }
    return;
  }
  if (tray) return;
  try {
    const size = process.platform === 'win32' ? 32 : 22;
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: size, height: size }));
    tray.setToolTip('Lyric Player');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show Lyric Player', click: showMain },
      { type: 'separator' },
      { label: 'Play / Pause', click: () => playerCmd('toggle') },
      { label: 'Next', click: () => playerCmd('next') },
      { label: 'Previous', click: () => playerCmd('prev') },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', showMain);
  } catch (_) {
    tray = null; // no tray on this desktop: closing the window then quits as usual
  }
}

app.on('before-quit', () => { quitting = true; writeSettingsNow(); Discord.stop(); });
app.on('will-quit', writeSettingsNow);


/* ---------- update in place (Windows portable .exe or installed copy, and Linux AppImage) ----------
   Downloads the newest build next to the running file, checks it against the checksum published with the release,
   swaps it in (the old one is kept as ".old" until the new one has started) and restarts. */
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');
// Any GitHub owner is fine: the account can be renamed, and GitHub then answers with the new name in every download link.
const RELEASES_URL = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/lyric-player\/releases\//;
let updating = false;

// Installed with the Windows setup program (it leaves an uninstaller beside the app).
function installedWindows() {
  try { return process.platform === 'win32' && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE && fs.existsSync(path.join(path.dirname(process.execPath), 'Uninstall Lyric Player.exe')); } catch (_) { return false; }
}

function selfUpdateTarget() {
  if (process.platform === 'win32' && process.env.PORTABLE_EXECUTABLE_FILE) return { file: process.env.PORTABLE_EXECUTABLE_FILE, tag: 'windows-latest', pick: /^Lyric-Player-(?!Setup).*\.exe$/i };
  if (installedWindows()) return { installer: true, tag: 'windows-latest', pick: /^Lyric-Player-Setup-.*\.exe$/i };
  if (process.platform === 'linux' && process.env.APPIMAGE) return { file: process.env.APPIMAGE, tag: 'linux-latest', pick: /\.AppImage$/i };
  return null;
}

ipcMain.handle('app:canSelfUpdate', () => !!selfUpdateTarget());

ipcMain.handle('app:selfUpdate', async (e) => {
  const T = selfUpdateTarget();
  if (!T) return { ok: false, error: 'unsupported' };
  if (updating) return { ok: false, error: 'busy' };
  updating = true;
  const send = (pct) => { try { e.sender.send('app:updateProgress', pct); } catch (_) { /* window gone */ } };
  const tmp = T.installer ? path.join(os.tmpdir(), 'Lyric-Player-update.exe') : T.file + '.new';
  try {
    const rel = await jsonGet('GitHub', `https://api.github.com/repos/Syncstanza/lyric-player/releases/tags/${T.tag}`, { Accept: 'application/vnd.github+json' }, 15000);
    const assets = (rel && rel.assets) || [];
    const bin = assets.find((a) => T.pick.test(String(a.name || '')));
    const sum = bin && assets.find((a) => a.name === bin.name + '.sha256');
    if (!bin || !sum) { updating = false; return { ok: false, error: 'nochecksum' }; }
    for (const a of [bin, sum]) if (!RELEASES_URL.test(String(a.browser_download_url || ''))) throw new Error('unexpected download address');

    const sumText = await (await fetch(sum.browser_download_url)).text();
    const want = (sumText.match(/[0-9a-f]{64}/i) || [''])[0].toLowerCase();
    if (!want) throw new Error('no checksum');

    const res = await fetch(bin.browser_download_url);
    if (!res.ok || !res.body) throw new Error('download failed');
    const total = Number(res.headers.get('content-length')) || Number(bin.size) || 0;
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(tmp);
    let got = 0;
    let last = -1;
    for await (const chunk of res.body) {
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      got += chunk.length;
      const pct = total ? Math.min(99, Math.floor((got / total) * 100)) : 0;
      if (pct !== last) { last = pct; send(pct); }
    }
    await new Promise((r, j) => { out.once('error', j); out.end(r); });
    if (got < 5 * 1024 * 1024 || hash.digest('hex') !== want) throw new Error('checksum mismatch');

    if (T.installer) {
      // Installed copy: run the new setup program quietly. It closes this copy, installs over it and starts the app again.
      send(100);
      const child = spawn(tmp, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' });
      child.unref();
      quitting = true;
      app.releaseSingleInstanceLock();
      setTimeout(() => app.quit(), 400);
      return { ok: true };
    }

    // Swap: a running file can be renamed (both Windows and Linux allow it), so the old one is moved aside first.
    const old = T.file + '.old';
    try { fs.rmSync(old, { force: true }); } catch (_) { /* ignore */ }
    if (process.platform !== 'win32') fs.chmodSync(tmp, 0o755);
    fs.renameSync(T.file, old);
    try { fs.renameSync(tmp, T.file); } catch (err) { try { fs.renameSync(old, T.file); } catch (_) { /* ignore */ } throw err; }
    send(100);

    // Restart a moment after this copy has exited (it holds the single-instance lock and the port until then).
    const env = { ...process.env };
    for (const k of ['APPIMAGE', 'APPDIR', 'ARGV0', 'OWD', 'PORTABLE_EXECUTABLE_FILE', 'PORTABLE_EXECUTABLE_DIR', 'PORTABLE_EXECUTABLE_APP_FILENAME']) delete env[k];
    const flags = process.argv.includes('--no-sandbox') ? ['--no-sandbox'] : [];
    let child;
    if (process.platform === 'win32') {
      child = spawn('cmd.exe', ['/c', `ping -n 3 127.0.0.1 >nul & start "" "${T.file}"`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true, env });
    } else {
      child = spawn('/bin/sh', ['-c', 'sleep 1.5; exec "$0" "$@"', T.file, ...flags], { detached: true, stdio: 'ignore', env });
    }
    child.unref();
    quitting = true;
    app.releaseSingleInstanceLock();
    setTimeout(() => app.quit(), 400);
    return { ok: true };
  } catch (err) {
    updating = false;
    try { fs.rmSync(tmp, { force: true }); } catch (_) { /* ignore */ }
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// The previous version is left beside the new one while the new one starts; once it is running it is not needed.
function cleanupOldBuild() {
  const T = selfUpdateTarget();
  if (!T || !T.file) return;
  for (const f of [T.file + '.old', T.file + '.new']) { try { fs.rmSync(f, { force: true }); } catch (_) { /* still in use: next start */ } }
}

/* ---------- lifecycle ---------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit(); // already running (possibly only in the tray): the first copy comes forward instead
} else {
  app.on('second-instance', () => showMain());
}

app.whenReady().then(async () => {
  if (!gotLock) return;
  setTimeout(cleanupOldBuild, 8000);
  const st = loadSettings();
  adBlock = st.adBlock !== false;
  // Present as a normal Chromium browser (drops the "Electron/x.y.z" token).
  const ses = session.defaultSession;
  ses.setUserAgent(ses.getUserAgent().replace(/\s*Electron\/\S+/i, ''));

  port = await startServer();
  if (st.keepInTray === true) applyTray(true);
  if (st.discordPresence === true) Discord.start();
  if (st.launchAtLogin === true) applyLaunchAtLogin(true); // keeps the entry pointing at wherever the app is now
  createWindow(startedAtLogin && !!tray); // started by the system at login: stay in the tray if there is one

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (server) server.close();
  app.quit();
});
