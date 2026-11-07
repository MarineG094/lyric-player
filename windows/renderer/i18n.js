/* App language. English is the built-in text and costs nothing: this file does no work until another language is chosen.
   For another language the labels are looked up in a small bundled file (lang/<code>.js) when there is one, and any
   labels it doesn't have are translated online once and kept on the device (localStorage). Lyrics are never touched. */
(function () {
  'use strict';

  // [code, name in its own language]. Codes are what the translation service expects.
  const LANGS = [
    ['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português'], ['it', 'Italiano'],
    ['nl', 'Nederlands'], ['ru', 'Русский'], ['tr', 'Türkçe'], ['id', 'Bahasa Indonesia'], ['ms', 'Bahasa Melayu'],
    ['ar', 'العربية'], ['ur', 'اردو'], ['fa', 'فارسی'], ['bn', 'বাংলা'], ['hi', 'हिन्दी'], ['pa', 'ਪੰਜਾਬੀ'], ['ta', 'தமிழ்'],
    ['zh-CN', '简体中文'], ['ja', '日本語'], ['ko', '한국어'], ['th', 'ไทย'], ['vi', 'Tiếng Việt'],
    ['pl', 'Polski'], ['uk', 'Українська'], ['sw', 'Kiswahili'], ['he', 'עברית'], ['el', 'Ελληνικά'],
  ];
  const RTL = new Set(['ar', 'ur', 'fa', 'he']);

  // Text that is never translated (songs, artists, lyrics, search results, anything typed in), even if it looks like a label.
  const SKIP = '.line, #searchResults, #savedList, #queueList, #importMissing, #editorText, textarea, input, script, style, #title, #artist, #upNextText, .un-text, #selLang option, #selTrans option:not([value=""])';
  const ALLOW_IN_SKIP = new Set(['Nothing playing', 'Drop a playlist to start']);
  const ATTRS = ['title', 'placeholder', 'aria-label'];

  // Messages the app writes while it runs (the labels already on the page are found by scanning it).
  const UI_STRINGS = [
    'Ad block: off', 'Cover filter: off', 'Cover filter: on (not working)', 'English letters: off', 'Auto lyrics: off', 'Album: left', 'Fullscreen button: left',
    'Launch at startup: on', 'Keep in tray: on', 'Discord status: on', 'Discord status: off', 'Discord status on. Your song shows as "Listening to Lyric Player" while the Discord app is open.', 'Discord status off.', 'Edit lyrics', 'Hide cover', 'Back to lyrics', 'Unknown title', 'Playlist', 'YouTube Music playlist',
    'Lyrics will show here.', 'Looking for lyrics…', 'No lyrics yet for this song.', 'No lyrics found for this song.', 'No lyrics for this song yet.',
    "Couldn't find lyrics online for this song.", "Couldn't reach the lyrics service.", 'This one is listed as an instrumental.',
    'Check your internet connection. You can still click “Add lyrics” to paste them in.',
    'Click “Add lyrics” to paste them in, or drop a .txt or .lrc file named after the song into your lyrics folder.',
    'Instrumental, no lyrics to show.', 'Found lyrics', 'Found timed lyrics', 'Saved to your lyrics folder', 'Looking for another match…', 'No other lyrics found for this song.',
    'Searching…', 'Nothing found. Try different words.', 'Opening your playlist in YouTube Music…', 'Opening the song in YouTube Music…', 'Looking up the album…',
    'An ad is playing…', 'Skipping an ad…', 'Checking for updates…', "You're on the newest version.", "Couldn't check for updates.", 'Restarting…',
    'Shuffle: on', 'Shuffle: off', 'Shuffle off.', 'Shuffle on. The next song is picked at random.', 'Repeat: off', 'Repeat: playlist', 'Repeat: this song',
    'Repeat off.', 'Repeat playlist on.', 'Repeating this song.', 'Ad block off.', 'Ad block on. Applies to the next ad.',
    'Next in your queue', 'Next in the playlist', 'Play this now', 'Play this right after the current song', 'Add this to the end of the queue', 'Remove from the queue',
    'Added to the queue:', 'Playing next:', "Couldn't add that:", "Couldn't import that:", "Couldn't save the lyrics:", 'Could not load',
    'Lyrics in other scripts now show in English letters.', 'Lyrics show in their original script.',
    'Closing the window now keeps Lyric Player running in the tray. Use the tray icon to quit.', 'Tray icon on. Closing the window still asks whether to quit or keep Lyric Player in the tray.', 'Tray icon off. Closing the window still asks whether to quit or keep Lyric Player in the tray.',
    'Lyric Player will start when you sign in.', 'Lyric Player will no longer start at sign-in.',
    'Downloading the update. The app restarts by itself when it is ready.', "Couldn't update in place, so the new file is downloading instead.",
    'Version', 'Language', 'Translate lyrics', 'Off', 'Clear translations', 'Saved translations cleared.', "Couldn't translate these lyrics right now.",
  ];
  // Messages that continue with a name or a reason: the start is translated and the rest is kept.
  const PREFIXES = ['Version', 'Added to the queue:', 'Playing next:', "Couldn't add that:", "Couldn't import that:", "Couldn't save the lyrics:", 'Could not load'];

  let dict = null;
  let lang = 'en';
  let token = 0;
  let observer = null;
  let offlineMiss = false; // the last language switch needed the internet and couldn't get it
  const origText = new Map(); // text node -> its English text
  const origAttr = new Map(); // element -> { attribute: English }
  const ours = new WeakMap(); // what this file last wrote into a node (so its own changes are not translated again)
  const oursAttr = new WeakMap();

  const cacheKey = (code) => 'lp.ui.' + code;
  function readCache(code) { try { return JSON.parse(localStorage.getItem(cacheKey(code))) || {}; } catch (_) { return {}; } }
  function writeCache(code, map) { try { localStorage.setItem(cacheKey(code), JSON.stringify(map)); } catch (_) { /* storage full or blocked */ } }

  const skipped = (el) => !el || (el.closest && el.closest(SKIP));
  const NEVER = new Set(['Lyric Player']); // the name is never translated
const wordy = (s) => s.length > 0 && s.length <= 500 && /[A-Za-z]/.test(s) && !NEVER.has(s) && !/^[\u2212+-]?[\d.]+\s*s$/.test(s);

  function lookup(core) {
    if (!dict) return null;
    if (Object.prototype.hasOwnProperty.call(dict, core)) return dict[core];
    for (const key of PREFIXES) {
      if (core.startsWith(key) && Object.prototype.hasOwnProperty.call(dict, key)) return dict[key] + core.slice(key.length);
    }
    return null;
  }

  function textNode(n) {
    const text = n.nodeValue;
    if (ours.get(n) === text) return;
    const core = text.trim();
    if (!wordy(core)) return;
    const parent = n.parentElement;
    if (skipped(parent) && !ALLOW_IN_SKIP.has(core)) return;
    const tr = lookup(core);
    origText.set(n, text); // new English text from the app replaces any older one
    if (tr == null) return;
    const lead = text.slice(0, text.indexOf(core));
    const trail = text.slice(lead.length + core.length);
    const out = lead + tr + trail;
    ours.set(n, out);
    n.nodeValue = out;
  }

  function attrs(el) {
    if (skipped(el)) return;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (!v) continue;
      const mine = oursAttr.get(el);
      if (mine && mine[a] === v) continue;
      const core = v.trim();
      if (!wordy(core)) continue;
      const tr = lookup(core);
      let saved = origAttr.get(el);
      if (!saved) { saved = {}; origAttr.set(el, saved); }
      saved[a] = v;
      if (tr == null) continue;
      const m = mine || {};
      m[a] = tr;
      oursAttr.set(el, m);
      el.setAttribute(a, tr);
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { textNode(root); return; }
    if (root.nodeType !== 1) return;
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) textNode(n);
    if (root.matches && root.matches('[title],[placeholder],[aria-label]')) attrs(root);
    root.querySelectorAll('[title],[placeholder],[aria-label]').forEach(attrs);
  }

  function restoreEnglish() {
    for (const [n, text] of origText) {
      if (n.isConnected && ours.get(n) === n.nodeValue) n.nodeValue = text;
      if (!n.isConnected) origText.delete(n);
    }
    for (const [el, saved] of origAttr) {
      const mine = oursAttr.get(el) || {};
      for (const a of Object.keys(saved)) if (el.isConnected && mine[a] === el.getAttribute(a)) el.setAttribute(a, saved[a]);
      if (!el.isConnected) origAttr.delete(el);
    }
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') textNode(m.target);
        else if (m.type === 'attributes') attrs(m.target);
        else m.addedNodes.forEach(walk);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  // Every English label on the page right now (before translating), plus the app's own messages and the "what's new" text.
  function pageStrings() {
    const set = new Set(UI_STRINGS);
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      const core = (origText.get(n) || n.nodeValue).trim();
      if (wordy(core) && (!skipped(n.parentElement) || ALLOW_IN_SKIP.has(core))) set.add(core);
    }
    document.querySelectorAll('[title],[placeholder],[aria-label]').forEach((el) => {
      if (skipped(el)) return;
      const saved = origAttr.get(el) || {};
      for (const a of ATTRS) { const v = (saved[a] || el.getAttribute(a) || '').trim(); if (wordy(v)) set.add(v); }
    });
    for (const e of window.__whatsnew || []) for (const i of e.items || []) set.add(i.text);
    return [...set];
  }

  function loadScript(src) {
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }

  async function buildDictionary(code, my) {
    window.__lang = window.__lang || {};
    if (!window.__lang[code]) await loadScript('lang/' + code + '.js');
    const bundled = window.__lang[code] || {};
    const cached = readCache(code);
    const map = { ...cached, ...bundled };
    const strings = pageStrings();
    const missing = strings.filter((s) => !Object.prototype.hasOwnProperty.call(map, s));
    offlineMiss = false;
    if (missing.length && window.api && window.api.translateTexts) {
      let r = null;
      try { r = await window.api.translateTexts({ texts: missing, target: code }); } catch (_) { r = null; }
      if (my !== token) return null;
      if (!r || !Array.isArray(r.lines)) offlineMiss = missing.length > 20;
      if (r && Array.isArray(r.lines)) {
        const fresh = {};
        missing.forEach((s, i) => {
          let t = r.lines[i];
          if (!t) return;
          if (s.endsWith(':') && !t.trim().endsWith(':')) t = t.trim() + ':';
          fresh[s] = t;
        });
        writeCache(code, { ...cached, ...fresh });
        Object.assign(map, fresh);
      }
    }
    return map;
  }

  async function set(code) {
    const my = ++token;
    code = LANGS.some((l) => l[0] === code) ? code : 'en';
    if (code === 'en') {
      if (observer) { observer.disconnect(); observer = null; }
      restoreEnglish();
      dict = null;
      lang = 'en';
      document.documentElement.lang = 'en';
      document.documentElement.dir = 'ltr';
      return 'en';
    }
    const map = await buildDictionary(code, my);
    if (my !== token || !map) return lang;
    restoreEnglish();
    dict = map;
    lang = code;
    document.documentElement.lang = code;
    document.documentElement.dir = RTL.has(code) ? 'rtl' : 'ltr';
    walk(document.body);
    startObserver();
    return code;
  }

  function clearCache() {
    try { Object.keys(localStorage).filter((k) => k.startsWith('lp.ui.') || k === 'lp.tr').forEach((k) => localStorage.removeItem(k)); } catch (_) { /* ignore */ }
  }

  window.I18N = { LANGS, set, get: () => lang, couldntFetch: () => offlineMiss, clearCache, isRtl: (c) => RTL.has(c) };
})();
