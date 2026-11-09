// The "Up next" queue: an imported playlist must respect Shuffle and Repeat: playlist (loads main.js against a stub of Electron).
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module'), fs = require('fs'), path = require('path'), os = require('os');

const noop = () => {};
const handlers = {};
const electron = {
  app: { getPath: () => fs.mkdtempSync(path.join(os.tmpdir(), 'lpq-')), getAppPath: () => '/dev/app', isPackaged: true, whenReady: () => new Promise(noop), on: noop, quit: noop,
    requestSingleInstanceLock: () => true, setLoginItemSettings: noop, commandLine: { appendSwitch: noop } },
  BrowserWindow: class {}, WebContentsView: class {}, ipcMain: { handle: (n, f) => { handlers[n] = f; }, on: noop }, dialog: {}, shell: {}, session: {}, net: {}, clipboard: {},
  screen: {}, nativeImage: { createFromPath: () => ({ resize: () => ({}) }) }, Tray: class {}, Menu: { buildFromTemplate: () => ({}) },
};
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? electron : orig.call(this, r, ...a); };
const file = path.join(__dirname, '..', 'main.js');
const m = new Module(file); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
m._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.__t = { ctl, takeQueued, refillQueue, queueIndex };', file);
Module._load = orig;
const t = m.exports.__t;

const song = (n) => ({ id: String(n).padStart(11, 'a'), title: 'Song ' + n, sub: 'x', thumb: '' });
const list = (n) => Array.from({ length: n }, (_, i) => song(i + 1));
function reset() { Object.assign(t.ctl, { queue: [], nextN: 0, played: [], pick: -1, shuffle: false, repeat: 'off' }); }

test('a playlist goes in as one playlist: in order, not as "play next" songs', async () => {
  reset();
  await handlers['player:enqueueMany'](null, list(5), true, true);
  assert.equal(t.ctl.queue.length, 5); assert.equal(t.ctl.nextN, 0);
  assert.deepEqual([1, 2, 3].map(() => t.takeQueued().title), ['Song 1', 'Song 2', 'Song 3']);
});

test('a single "play next" song still goes before the playlist, even with Shuffle on', async () => {
  reset(); t.ctl.shuffle = true;
  await handlers['player:enqueueMany'](null, list(6), true, true);
  await handlers['player:enqueueMany'](null, [song(99)], true, false);
  assert.equal(t.takeQueued().title, 'Song 99');
});

test('Shuffle on: the queue plays in a different order, every song once', async () => {
  reset(); t.ctl.shuffle = true;
  await handlers['player:enqueueMany'](null, list(30), true, true);
  const order = []; while (t.ctl.queue.length) order.push(t.takeQueued().title);
  assert.equal(order.length, 30); assert.equal(new Set(order).size, 30);
  assert.notDeepEqual(order, list(30).map((x) => x.title));
});

test('Shuffle: the song shown in "Up next" is the one that really plays', async () => {
  reset(); t.ctl.shuffle = true;
  await handlers['player:enqueueMany'](null, list(20), true, true);
  for (let i = 0; i < 10; i++) { const shown = t.ctl.queue[t.queueIndex()].title; assert.equal(t.takeQueued().title, shown); }
});

test('Repeat: playlist refills the queue with what was played; other modes do not', async () => {
  reset();
  await handlers['player:enqueueMany'](null, list(3), true, true);
  while (t.ctl.queue.length) t.takeQueued();
  assert.equal(t.refillQueue(), false);          // repeat off
  t.ctl.repeat = 'all';
  assert.equal(t.refillQueue(), true);
  assert.deepEqual(t.ctl.queue.map((x) => x.title), ['Song 1', 'Song 2', 'Song 3']);
  assert.equal(t.ctl.played.length, 0);
  assert.equal(t.refillQueue(), false);          // queue not empty
});

test('clearing the queue forgets what was played', async () => {
  reset(); t.ctl.repeat = 'all';
  await handlers['player:enqueueMany'](null, list(3), true, true);
  while (t.ctl.queue.length) t.takeQueued();
  await handlers['player:clearQueue']();
  assert.equal(t.refillQueue(), false);
});
