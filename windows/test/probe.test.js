// The page probe is a string sent into YouTube Music; a typo in it silently breaks the whole player,
// so check that it parses and returns a state against a fake page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const start = src.indexOf('const PICK_VIDEO');
const end = src.indexOf('async function pollYt');
const { probeScript } = vm.runInNewContext(src.slice(start, end) + '\n({ probeScript })');

function fakePage(url, items) {
  const video = { readyState: 4, paused: false, ended: false, currentTime: 12, duration: 200, volume: 0.5, muted: false, playbackRate: 1 };
  const bar = { };
  const all = { video: [video], 'ytmusic-player-queue-item': items || [] };
  return {
    URL, Date, Math, isFinite,
    location: { href: url },
    navigator: { mediaSession: { metadata: { title: 'Song', artist: 'Band', album: 'A', artwork: [{ src: 'https://x/y=w60-h60' }] } } },
    window: {},
    document: { querySelector: (s) => (s === 'ytmusic-player-bar' ? bar : null), querySelectorAll: (s) => all[s] || [] },
  };
}

test('probe script is valid JavaScript for every argument combination', () => {
  for (const args of [[null, false, ''], [50, true, ''], [70, false, 'abcdefghijk']]) {
    assert.doesNotThrow(() => new vm.Script(probeScript(...args)));
  }
});

test('probe returns the song, the next song and no error', () => {
  const mk = (id, t) => ({ hasAttribute: () => false, getAttribute: () => '', data: { videoId: id, title: { runs: [{ text: t }] }, shortBylineText: { runs: [{ text: 'Band • Album' }] }, thumbnail: { thumbnails: [{ url: 'https://t/' + id }] } } });
  const items = [mk('aaaaaaaaaaa', 'One'), mk('bbbbbbbbbbb', 'Two')];
  const out = vm.runInNewContext(probeScript(null, false, 'bbbbbbbbbbb'), fakePage('https://music.youtube.com/watch?v=aaaaaaaaaaa&list=PL1', items));
  assert.equal(out.error, undefined);
  assert.equal(out.hasMedia, true);
  assert.equal(out.videoId, 'aaaaaaaaaaa');
  assert.equal(out.nextMeta.title, 'Two');
  assert.equal(out.wantMeta.id, 'bbbbbbbbbbb');
});

test('probe reuses the queue walk while nothing changed, and redoes it when the song changes', () => {
  let reads = 0;
  const mk = (id) => ({ hasAttribute: () => false, getAttribute: () => '', get data() { reads++; return { videoId: id, title: { runs: [{ text: id }] }, shortBylineText: { runs: [] }, thumbnail: { thumbnails: [] } }; } });
  const items = [mk('aaaaaaaaaaa'), mk('bbbbbbbbbbb'), mk('ccccccccccc')];
  const page = fakePage('https://music.youtube.com/watch?v=aaaaaaaaaaa&list=PL1', items);
  vm.createContext(page);
  const run = () => vm.runInContext(probeScript(null, false, ''), page);
  assert.equal(run().nextMeta.id, 'bbbbbbbbbbb');
  const first = reads;
  const again = run();
  assert.equal(reads, first, 'no queue reads on the second look');
  assert.equal(again.nextMeta.id, 'bbbbbbbbbbb');
  page.location.href = 'https://music.youtube.com/watch?v=bbbbbbbbbbb&list=PL1';
  assert.equal(run().nextMeta.id, 'ccccccccccc');
});
