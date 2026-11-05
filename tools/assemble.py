#!/usr/bin/env python3
"""Builds app/src/main/assets/renderer from the desktop app's sources.

Usage: python3 tools/assemble.py /path/to/lyric-player
The controller logic (shuffle, repeat, lyric lookups ...) is copied verbatim from the desktop main.js,
so both apps behave the same. Only a thin shim around it is Android specific.
"""
import re, shutil, sys, pathlib

src = pathlib.Path(sys.argv[1])
root = pathlib.Path(__file__).resolve().parent.parent
out = root / 'tools/_out/renderer'
if out.exists():
    shutil.rmtree(out)
out.mkdir(parents=True)

main = (src / 'main.js').read_text(encoding='utf8')

def between(start, end, keep_end=False):
    a = main.index(start)
    b = main.index(end, a)
    return main[a:b + (len(end) if keep_end else 0)]

# 1. state variables
parts = []
parts.append(between('let ytView = null;', 'function stripElectronUA'))
# 2. the probe script and polling
parts.append(between('// Runs inside the page: the <video>', 'const SELECTORS = {'))
# 3. everything from selectors to the diagnose handler, including every ipcMain.handle for the player
parts.append(between('const SELECTORS = {', "ipcMain.on('adblock:testhost'"))
# 4. lyric lookups
parts.append(between('const LRCLIB = ', "ipcMain.handle('lyrics:chooseFolder'"))
core_body = '\n'.join(parts)

# Phone-width pages have no player bar: fall back to the player's own data for title / artist / cover.
anchor = "    if (art) art = art.replace("
assert anchor in core_body
fallback = (
  "    if (!title) { try { const pm = q('#movie_player'); const pr = pm && pm.getPlayerResponse && pm.getPlayerResponse(); const d = pr && pr.videoDetails;"
  " if (d) { title = d.title || ''; if (!artist) artist = String(d.author || '').replace(/ - Topic$/, ''); const th = d.thumbnail && d.thumbnail.thumbnails;"
  " if (!art && th && th.length) art = th[th.length - 1].url; } } catch (e) { /* keep empty */ } }\n"
)
core_body = core_body.replace(anchor, fallback + anchor, 1)

# Safeguard (phone only): a song only counts as finished once it has been seen playing mid-song, and every
# "ended" decision is written to the trace so a Diagnose report shows what the page looked like.
old = "  const atEnd = s.dur > 5 && (s.ended || s.cur >= s.dur - 0.9);\n  if (!atEnd || now - ctl.lastJump < 3000) return;\n"
assert old in core_body
new = ("  if (!ctl.guard || ctl.guard.id !== s.videoId) ctl.guard = { id: s.videoId, mid: false };\n"
       "  if (s.dur > 5 && s.cur > 0.5 && s.cur < s.dur - 3) ctl.guard.mid = true;\n"
       "  const atEnd = ctl.guard.mid && s.dur > 5 && (s.ended || s.cur >= s.dur - 0.9);\n"
       "  if (!atEnd || now - ctl.lastJump < 3000) return;\n"
       "  ctl.trace.push('end? id=' + s.videoId + ' cur=' + (s.cur || 0).toFixed(1) + ' dur=' + (s.dur || 0).toFixed(1) + ' ended=' + s.ended + ' playing=' + s.playing);\n"
       "  if (ctl.trace.length > 40) ctl.trace.shift();\n")
core_body = core_body.replace(old, new, 1)

# Background pages get their timers slowed or frozen; waiting is done by the phone's own clock instead.
old_wait = "const wait = (ms) => new Promise((r) => setTimeout(r, ms));"
assert old_wait in core_body
core_body = core_body.replace(old_wait, "const wait = (ms) => native('sleep', { ms }).then(() => undefined);", 1)

# Phone pages have no media title to compare, so "did the song change?" also looks at the song's id in the address.
a = "title: m ? m.title : '', cur: v ? v.currentTime : 0 });"
b = "return after.title !== before.title || (before.cur > 6 && after.cur < before.cur - 4);"
assert a in core_body and b in core_body
core_body = core_body.replace(a, "title: m ? m.title : '', vid: new URL(location.href).searchParams.get('v') || '', cur: v ? v.currentTime : 0 });", 1)
core_body = core_body.replace(b, "return (before.vid && after.vid !== before.vid) || after.title !== before.title || (before.cur > 6 && after.cur < before.cur - 4);", 1)

# The desktop code asks the main process for settings; here they come from the native side.
shim = (root / 'tools/shim.js').read_text(encoding='utf8')
core = shim.replace('/*__CORE__*/', core_body)
(out / 'android-core.js').write_text(core, encoding='utf8')

# renderer files
for name in ['lyrics.js', 'anyascii.js', 'romanize.js', 'palette.js', 'coverfilter.js', 'build-info.js', 'style.css']:
    shutil.copy(src / 'renderer' / name, out / name)

# The cover filter's AI check normally runs on the graphics chip, which depends on timers that Android freezes
# when the screen is off (so the car never got the verdict). With the screen off it runs on the processor instead,
# and a check that stalls is retried that way.
app = (src / 'renderer/app.js').read_text(encoding='utf8')
old_backend = "        try { await window.tf.setBackend('webgl'); } catch (_) { /* falls back below */ }"
assert old_backend in app
app = app.replace(old_backend, "        window.__nsfwBackend = (window.__nsfwCpu || document.visibilityState !== 'visible') ? 'cpu' : 'webgl';\n        try { await window.tf.setBackend(window.__nsfwBackend); } catch (_) { /* falls back below */ }", 1)
old_classify = app[app.index('  async function classifyCover(url) {'):app.index('  function setCoverMode(mode) {')]
new_classify = '''  async function classifyCover(url) {
    const want = () => ((window.__nsfwCpu || document.visibilityState !== 'visible') ? 'cpu' : 'webgl');
    const run = async () => {
      if (nsfwModel && window.__nsfwBackend !== want()) { // the screen went on or off: reload the model on the right backend
        try { nsfwModel.model.dispose(); } catch (_) { /* ignore */ }
        nsfwModel = null;
        nsfwLoading = null;
      }
      const model = await ensureClassifier();
      if (!model) return null;
      const thumb = await window.api.getThumb(url);
      if (!thumb) return null;
      const image = new ImageData(new Uint8ClampedArray(thumb.data), thumb.w, thumb.h);
      const predictions = await model.classify(image);
      console.log('[cover filter]', window.__nsfwBackend, predictions.map((p) => `${p.className} ${p.probability.toFixed(2)}`).join(', '));
      return window.CoverFilter.shouldBlur(predictions);
    };
    const sleep = window.__lpSleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    let result = await Promise.race([run(), sleep(7000).then(() => 'stalled')]);
    if (result === 'stalled') { // the graphics route froze (screen off): do it on the processor
      window.__nsfwCpu = true;
      result = await Promise.race([run(), sleep(40000).then(() => null)]);
    }
    return result === 'stalled' ? null : result;
  }

'''
app = app.replace(old_classify, new_classify, 1)
(out / 'app.js').write_text(app, encoding='utf8')
shutil.copy(src / 'quran.js', out / 'quran.js')
shutil.copytree(src / 'renderer/vendor', out / 'vendor')
shutil.copy(root / 'tools/android.css', out / 'android.css')

html = (src / 'renderer/index.html').read_text(encoding='utf8')
html = html.replace('<meta name="viewport" content="width=device-width, initial-scale=1">',
                    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">')
html = html.replace('<link rel="stylesheet" href="style.css">',
                    '<link rel="stylesheet" href="style.css">\n  <link rel="stylesheet" href="android.css">')
html = html.replace('<script src="app.js"></script>',
                    '<script src="quran.js"></script>\n  <script src="android-core.js"></script>\n  <script src="app.js"></script>')
html = html.replace('<button id="btnPlaylist"', '<button id="btnDiag" class="ghost" type="button">Diagnose</button>\n        <button id="btnPlaylist"')
html = html.replace('<button id="btnBrowse"', '<button id="btnPhoneFull" class="ghost" type="button">Full screen</button>\n        <button id="btnBrowse"', 1)
assert 'btnPhoneFull' in html
assert 'btnDiag' in html
assert 'android-core.js' in html and 'android.css' in html
(out / 'index.html').write_text(html, encoding='utf8')

# page-side ad pruning script (from ytm-preload.js), with a placeholder for the on/off switch
pre = (src / 'ytm-preload.js').read_text(encoding='utf8')
m = re.search(r'const code = `(.*?)`;\n  try \{ webFrame', pre, re.S)
code = m.group(1).replace('${enabled ? \'true\' : \'false\'}', '__ENABLED__')
viewport = '''
    // Ask for the computer-sized page (the phone-sized one has no player bar to read from).
    try {
      const fixVp = () => {
        let m = document.querySelector('meta[name=viewport]');
        if (!m) { m = document.createElement('meta'); m.name = 'viewport'; (document.head || document.documentElement).appendChild(m); }
        if (m.content !== 'width=1280') m.content = 'width=1280';
      };
      fixVp();
      new MutationObserver(fixVp).observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) {}
'''
code = code.replace("if (window.__lpAdPrune) return;", "if (window.__lpAdPrune) return;" + viewport, 1)
(out / 'ytm-inject.js').write_text(code, encoding='utf8')
print('ok:', sorted(p.name for p in out.iterdir()))

# ---- one copy of the page per app flavour (phone / tv) ----
for flavour in ['phone', 'tv']:
    dest = root / f'app/src/{flavour}/assets/renderer'
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(out, dest)
    if flavour == 'tv':
        (dest / 'android.css').unlink()
        shutil.copy(root / 'tools/tv.css', dest / 'tv.css')
        shutil.copy(root / 'tools/tv.js', dest / 'tv.js')
        h = (dest / 'index.html').read_text(encoding='utf8')
        h = h.replace('href="android.css"', 'href="tv.css"').replace('<script src="app.js"></script>', '<script src="tv.js"></script>\n  <script src="app.js"></script>')
        assert 'tv.css' in h and 'tv.js' in h
        (dest / 'index.html').write_text(h, encoding='utf8')
shutil.rmtree(root / 'tools/_out')
print('flavours written')
