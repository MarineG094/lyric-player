'use strict';
// Discord "Listening to Lyric Player" status, through Discord's own local socket (no extra packages).
// Off unless the user switches it on. Only the song title and artist are sent, and only to the Discord app on this computer.
const net = require('net');
const path = require('path');

const CLIENT_ID = '1568692794216947722';
const MIN_GAP_MS = 15000;        // Discord allows one status change every 15 seconds
const PAUSE_CLEAR_MS = 5 * 60000; // a long pause clears the status
const RETRY_MS = 30000;          // Discord not open yet: look again now and then

function pipePaths() {
  if (process.platform === 'win32') return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  const bases = [process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, process.env.TMP, process.env.TEMP, '/tmp'].filter(Boolean);
  const subs = ['', 'app/com.discordapp.Discord/', 'snap.discord/', 'app/com.discordapp.DiscordCanary/'];
  const out = [];
  for (const b of [...new Set(bases)]) for (const s of subs) for (let i = 0; i < 10; i++) out.push(path.join(b, `${s}discord-ipc-${i}`));
  return out;
}

function frame(op, data) {
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

function clip(s, fallback) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length < 2) s = fallback;
  return s.length > 120 ? s.slice(0, 117) + '...' : s;
}

// What the status should say for a player state, or null for "nothing" (no song, an ad).
function activityFor(st, now) {
  if (!st || !st.hasMedia || st.ad || !st.title) return null;
  const a = { type: 2, details: clip(st.title, 'Unknown song'), state: clip(st.artist, 'Unknown artist') };
  if (st.playing && st.dur > 0) {
    const start = Math.round(now - (st.cur || 0) * 1000);
    a.timestamps = { start, end: Math.round(start + st.dur * 1000) };
  }
  return a;
}

function createDiscord(opts) {
  const clientId = (opts && opts.clientId) || CLIENT_ID;
  const connect = (opts && opts.connect) || ((p) => net.createConnection(p));
  const paths = (opts && opts.paths) || pipePaths();
  const clock = (opts && opts.now) || Date.now;
  let on = false, sock = null, ready = false, connecting = false, buf = Buffer.alloc(0);
  let want = null;            // the status we want shown (null = none)
  let wantBase = '', dirty = false;
  let sentBase = '', sentAt = 0, sentStart = 0, pausedSince = 0;
  let retryTimer = null, sendTimer = null;

  function drop() {
    ready = false; connecting = false; buf = Buffer.alloc(0); sentBase = ''; sentStart = 0; dirty = !!want;
    if (sock) { try { sock.destroy(); } catch (_) { /* gone */ } sock = null; }
    if (on && !retryTimer) { retryTimer = setTimeout(() => { retryTimer = null; open(); }, RETRY_MS); if (retryTimer.unref) retryTimer.unref(); }
  }

  function open() {
    if (!on || sock || connecting) return;
    connecting = true;
    let i = 0;
    const next = () => {
      if (!on) { connecting = false; return; }
      if (i >= paths.length) { connecting = false; drop(); return; }
      const s = connect(paths[i++]);
      let settled = false;
      s.once('error', () => { if (!settled) { settled = true; next(); } });
      s.once('connect', () => {
        settled = true; sock = s; connecting = false;
        s.on('data', onData);
        s.on('error', drop);
        s.on('close', drop);
        s.write(frame(0, { v: 1, client_id: clientId }));
      });
    };
    next();
  }

  function onData(d) {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 8) {
      const op = buf.readInt32LE(0), len = buf.readInt32LE(4);
      if (len < 0 || len > 1 << 20) { drop(); return; }
      if (buf.length < 8 + len) return;
      let msg = null;
      try { msg = JSON.parse(buf.slice(8, 8 + len).toString('utf8')); } catch (_) { /* skip */ }
      buf = buf.slice(8 + len);
      if (op === 3) { try { sock.write(frame(4, msg || {})); } catch (_) { /* closing */ } } // ping -> pong
      else if (op === 2) { drop(); return; }                                                  // Discord closed us
      else if (msg && msg.evt === 'READY') { ready = true; flush(true); }
    }
  }

  function send() {
    if (!ready || !sock) return;
    const args = { pid: process.pid, activity: want || undefined };
    try { sock.write(frame(1, { cmd: 'SET_ACTIVITY', args, nonce: String(clock()) + Math.random() })); } catch (_) { return; }
    sentBase = wantBase; sentAt = clock(); sentStart = want && want.timestamps ? want.timestamps.start : 0; dirty = false;
  }

  function flush(force) {
    if (!on || !ready || !dirty) return;
    const wait = MIN_GAP_MS - (clock() - sentAt);
    if (!force && sentAt && wait > 0) {
      if (!sendTimer) { sendTimer = setTimeout(() => { sendTimer = null; flush(false); }, wait + 50); if (sendTimer.unref) sendTimer.unref(); }
      return;
    }
    send();
  }

  return {
    activityFor,
    // Called with every player state. Only sends when the song, play/pause or the position (a seek) really changed.
    update(st) {
      if (!on) return;
      const now = clock();
      let a = activityFor(st, now);
      if (a && !a.timestamps) {
        if (!pausedSince) pausedSince = now;
        if (now - pausedSince > PAUSE_CLEAR_MS) a = null;
      } else pausedSince = 0;
      const base = a ? `${a.details}|${a.state}|${a.timestamps ? 'play' : 'pause'}` : '';
      // a seek or a restart moves the song's start time by more than a few seconds
      const seeked = !!(a && a.timestamps && sentStart && Math.abs(a.timestamps.start - sentStart) > 4000);
      want = a; wantBase = base;
      dirty = base !== sentBase || seeked;
      flush(false);
    },
    start() { if (on) return; on = true; open(); },
    stop() {
      if (!on) return;
      if (ready && sock) { want = null; wantBase = ''; send(); }
      on = false;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
      const s = sock; sock = null; ready = false; connecting = false; sentBase = ''; sentStart = 0; dirty = false; pausedSince = 0;
      if (s) setTimeout(() => { try { s.destroy(); } catch (_) { /* gone */ } }, 200);
    },
    get connected() { return ready; },
  };
}

module.exports = { createDiscord, activityFor, frame, CLIENT_ID };
