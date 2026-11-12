const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* The probe runs inside the YouTube Music page. Pull it out of main.js and run it against a fake page. */
const lines = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').split('\n');
const a = lines.findIndex((l) => l.startsWith('const PICK_VIDEO'));
const b = lines.findIndex((l, i) => i > a && l.startsWith('})()`;'));
const probeScript = new Function(lines.slice(a, b + 1).join('\n') + '\nreturn probeScript;')();

function look(want, st) {
  const ctx = {
    window: st.win, URL, Date, Math, isFinite, Number,
    navigator: { mediaSession: { metadata: { title: 'T', artist: 'A', album: '', artwork: [] } } },
    location: { href: 'https://music.youtube.com/watch?v=' + st.vid },
    document: {
      querySelector: (sel) => (sel.includes('ad-showing') && st.ad ? {} : null),
      querySelectorAll: (sel) => (sel === 'video' ? [st.v] : []),
    },
  };
  ctx.window.document = ctx.document;
  vm.runInNewContext(probeScript(want, true, null), ctx);
}

test('volume is put back whenever YouTube moves it, and left alone during an ad', () => {
  const v = { readyState: 4, paused: false, volume: 1, muted: false, duration: 200, currentTime: 5, playbackRate: 1 };
  const st = { v, win: {}, vid: 'abc', ad: false };
  look(80, st);
  assert.strictEqual(v.volume, 0.8);                 // first look applies the wanted volume
  v.volume = 1; look(80, st);
  assert.strictEqual(v.volume, 0.8);                 // YouTube jumped it to 100 mid-song: put back
  st.vid = 'def'; v.volume = 1; look(80, st);
  assert.strictEqual(v.volume, 0.8);                 // a new song
  v.volume = 1; look(60, st);
  assert.strictEqual(v.volume, 0.6);                 // the slider moved
  st.ad = true; st.vid = 'ghi'; v.volume = 1; look(60, st);
  assert.strictEqual(v.volume, 1);                   // during an ad it is not touched
});
