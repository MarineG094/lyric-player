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

/*__CORE__*/

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
      const text = el ? el.textContent.trim() : '';
      if (text !== lastLine) { lastLine = text; N.lyricLine(text); }
      const sb = document.getElementById('btnShuffle');
      const rb = document.getElementById('btnRepeat');
      const modes = (sb && sb.classList.contains('on') ? '1' : '0') + ((rb && rb.title.indexOf('this song') >= 0) ? 'o' : (rb && rb.classList.contains('on')) ? 'a' : 'x');
      if (modes !== lastModes) { lastModes = modes; N.modes(modes); }
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
