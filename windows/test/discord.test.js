// Discord status: the handshake, what gets sent, and when. Uses a fake Discord socket (no real Discord needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createDiscord, activityFor, frame } = require('../discord.js');

function fakeDiscord() {
  const sent = []; let sock;
  const connect = () => {
    sock = new EventEmitter();
    sock.write = (b) => { sent.push({ op: b.readInt32LE(0), data: JSON.parse(b.slice(8).toString()) }); };
    sock.destroy = () => {};
    setImmediate(() => sock.emit('connect'));
    return sock;
  };
  const say = (op, data) => sock.emit('data', frame(op, data));
  return { sent, connect, say };
}
const tick = () => new Promise((r) => setImmediate(r));
const song = (o) => Object.assign({ hasMedia: true, ad: false, title: 'Hold The Line', artist: 'Ashen Hours', playing: true, cur: 10, dur: 200 }, o);

test('activityFor: nothing for ads or no song, listening type with times when playing', () => {
  assert.equal(activityFor({ hasMedia: false }, 0), null);
  assert.equal(activityFor(song({ ad: true }), 0), null);
  const a = activityFor(song(), 100000);
  assert.equal(a.type, 2); assert.equal(a.details, 'Hold The Line'); assert.equal(a.state, 'Ashen Hours');
  assert.equal(a.timestamps.start, 90000); assert.equal(a.timestamps.end, 290000);
  assert.equal(activityFor(song({ playing: false }), 0).timestamps, undefined);
  assert.equal(activityFor(song({ title: 'A' }), 0).details, 'A'.padEnd(2, ' ').trim().length < 2 ? 'Unknown song' : 'A');
});

test('handshake, first status, no spam, seek, and clearing on stop', async () => {
  const f = fakeDiscord(); let t = 1000000;
  const d = createDiscord({ connect: f.connect, paths: ['x'], now: () => t });
  d.start(); await tick();
  assert.equal(f.sent[0].op, 0); assert.equal(f.sent[0].data.client_id, '1568692794216947722');
  d.update(song()); // before READY: nothing goes out yet
  assert.equal(f.sent.length, 1);
  f.say(1, { evt: 'READY' });
  assert.equal(f.sent.length, 2); assert.equal(f.sent[1].data.cmd, 'SET_ACTIVITY'); assert.equal(f.sent[1].data.args.activity.details, 'Hold The Line');
  t += 1000; d.update(song({ cur: 11 })); d.update(song({ cur: 12 })); // same song, normal progress: nothing new
  assert.equal(f.sent.length, 2);
  t += 20000; d.update(song({ cur: 120 })); // a seek, and past the 15 s gap
  assert.equal(f.sent.length, 3);
  t += 20000; d.update(song({ playing: false, cur: 140 })); // paused: times go away
  assert.equal(f.sent.length, 4); assert.equal(f.sent[3].data.args.activity.timestamps, undefined);
  d.stop();
  assert.equal(f.sent[f.sent.length - 1].data.args.activity, undefined); // cleared
});

test('a quick song change waits for the 15 second gap', async () => {
  const f = fakeDiscord(); let t = 5000000;
  const d = createDiscord({ connect: f.connect, paths: ['x'], now: () => t });
  d.start(); await tick(); f.say(1, { evt: 'READY' }); d.update(song());
  const n = f.sent.length; t += 2000; d.update(song({ title: 'Cast Me Out', cur: 0 }));
  assert.equal(f.sent.length, n); // held back
  t += 14000; d.update(song({ title: 'Cast Me Out', cur: 14 }));
  assert.equal(f.sent.length, n + 1); assert.equal(f.sent[n].data.args.activity.details, 'Cast Me Out');
  d.stop();
});

test('answers a ping, and does nothing while switched off', async () => {
  const f = fakeDiscord();
  const d = createDiscord({ connect: f.connect, paths: ['x'] });
  d.update(song()); assert.equal(f.sent.length, 0);
  d.start(); await tick(); f.say(3, { n: 1 });
  assert.equal(f.sent[f.sent.length - 1].op, 4);
  d.stop();
});

test('cover: only the approved picture, only from YouTube image hosts', () => {
  const { coverUrl } = require('../discord.js');
  const art = 'https://lh3.googleusercontent.com/abc=w800-h800-l90-rj';
  assert.equal(coverUrl(art), 'https://lh3.googleusercontent.com/abc=w512-h512');
  assert.equal(coverUrl('https://evil.example/x.png'), '');
  assert.equal(coverUrl('http://i.ytimg.com/vi/a/b.jpg'), '');
  assert.equal(activityFor(song({ art }), 0).assets, undefined);                       // no approval: no picture
  assert.equal(activityFor(song({ art }), 0, { key: art + 'x' }).assets, undefined);   // approval was for another song
  assert.equal(activityFor(song({ art }), 0, { key: art }).assets.large_image, 'https://lh3.googleusercontent.com/abc=w512-h512');
  assert.equal(activityFor(song({ art: 'https://evil.example/x' }), 0, { key: 'https://evil.example/x' }).assets, undefined);
});

test('cover approval arriving later changes the status; taking it away removes the picture', async () => {
  const f = fakeDiscord(); let t = 9000000; const art = 'https://i.ytimg.com/vi/a/hq.jpg';
  const d = createDiscord({ connect: f.connect, paths: ['x'], now: () => t });
  d.start(); await tick(); f.say(1, { evt: 'READY' }); d.update(song({ art }));
  const n = f.sent.length; assert.equal(f.sent[n - 1].data.args.activity.assets, undefined);
  d.setCover(art, true); t += 16000; d.update(song({ art, cur: 26 }));
  assert.equal(f.sent.length, n + 1); assert.ok(f.sent[n].data.args.activity.assets);
  d.setCover(art, false); t += 16000; d.update(song({ art, cur: 42 }));
  assert.equal(f.sent.length, n + 2); assert.equal(f.sent[n + 1].data.args.activity.assets, undefined);
  d.stop();
});
