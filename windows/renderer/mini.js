/* Mini player page: draws what the main window hands over (song, colours, lyrics) and rolls the lyrics.
   Does no lookups of its own. */
(() => {
  const api = window.mini;
  const $ = (id) => document.getElementById(id);
  const el = { nextbox: $('nextbox'), nt: $('nt'), na: $('na'), pill: $('pill'), cover: $('cover'), title: $('title'), artist: $('artist'), roll: $('roll'), note: $('note'), prog: $('prog') };
  const LH = 22;
  let lyr = null;            // { status, synced, lines: [{ time, text }] }
  let nodes = [];
  let idx = -2;
  let st = { hasMedia: false, title: '', artist: '', art: '', cur: 0, dur: 0, playing: false };
  let stamp = performance.now();
  let key = '';

  function setPalette(c) {
    if (!c) return;
    const r = document.documentElement.style;
    r.setProperty('--bg', c.bg); r.setProperty('--bg2', c.bg2); r.setProperty('--glow', c.glow); r.setProperty('--acc', c.accent2 || c.accent);
  }

  function setNote(text) { el.note.textContent = text || ''; el.note.hidden = !text; }

  function buildLyrics() {
    el.roll.textContent = '';
    nodes = [];
    idx = -2;
    el.roll.style.transform = 'translateY(0)';
    const ok = lyr && lyr.synced && lyr.lines && lyr.lines.length;
    if (!st.hasMedia) setNote('Nothing playing');
    else if (ok) setNote('');
    else if (lyr && lyr.status === 'searching') setNote('Finding lyrics…');
    else if (lyr && lyr.lines && lyr.lines.length) setNote('These lyrics have no timing, so they can’t roll here');
    else setNote('No lyrics for this song');
    if (!ok) return;
    const frag = document.createDocumentFragment();
    for (const l of lyr.lines) {
      const d = document.createElement('div');
      d.className = 'l';
      d.dir = 'auto';
      d.textContent = l.text || '♪';
      frag.appendChild(d);
      nodes.push(d);
    }
    el.roll.appendChild(frag);
    paintRoll(-1);
  }

  // Classes by distance from the active line: current, next (dim), previous (fading out), everything else hidden.
  function paintRoll(i) {
    const from = Math.max(0, Math.min(idx, i) - 2);
    const to = Math.min(nodes.length - 1, Math.max(idx, i) + 3);
    for (let k = from; k <= to; k++) {
      const d = k - i;
      const n = nodes[k];
      n.className = d === 0 ? 'l cur' : d === 1 ? 'l nx' : d === -1 ? 'l pv' : 'l';
      if (d >= 0 && d <= 1) fit(n);
    }
    // Before the first line, the first lines wait in view; afterwards the active one sits on the top row.
    el.roll.style.transform = `translateY(${-Math.max(0, i) * LH}px)`;
    if (i < 0 && nodes[0]) nodes[0].className = 'l nx';
    idx = i;
  }

  // A line too wide for the pill shrinks until it fits (down to a small minimum). Done once per line.
  function fit(n) {
    if (n.dataset.fit) return;
    n.dataset.fit = '1';
    const over = n.scrollWidth / Math.max(1, n.clientWidth);
    if (over > 1) n.style.fontSize = Math.max(9.5, Math.floor(14.5 / over * 10) / 10) + 'px';
  }

  function lineAt(t) {
    const L = lyr.lines;
    let lo = 0; let hi = L.length - 1; let ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (L[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }

  function tick() {
    const now = performance.now();
    const cur = st.playing ? st.cur + (now - stamp) / 1000 : st.cur;
    if (st.dur > 0) el.prog.style.width = Math.min(100, (cur / st.dur) * 100) + '%';
    if (nodes.length) {
      const i = lineAt(cur + 0.15);
      if (i !== idx) paintRoll(i);
    }
  }

  function setNext(n) {
    el.nextbox.hidden = !n;
    if (!n) return;
    if (el.nt.textContent !== n.title) el.nt.textContent = n.title;
    if (el.na.textContent !== n.artist) el.na.textContent = n.artist;
  }

  function setState(s) {
    if (!s) return;
    setNext(s.hasMedia && !s.ad ? s.next : null);
    const had = st.hasMedia;
    st = s;
    stamp = performance.now();
    el.pill.classList.toggle('playing', !!s.playing);
    if (!s.hasMedia || s.ad) { if (!s.hasMedia) { el.title.textContent = 'Nothing playing'; el.artist.textContent = ''; } if (had !== s.hasMedia) buildLyrics(); return; }
    const k = s.title + '|' + s.artist;
    if (k !== key) {
      key = k;
      el.title.textContent = s.title || 'Unknown song';
      el.artist.textContent = s.artist || '';
      el.cover.style.backgroundImage = s.art ? `url("${s.art.replace(/"/g, '%22')}")` : '';
      lyr = null; // the main window sends this song's lyrics next
      buildLyrics();
    }
  }

  api.onState(setState);
  api.onPalette(setPalette);
  api.onCover((h) => el.cover.classList.toggle('hide', !!h));
  api.onLyrics((d) => { lyr = d; buildLyrics(); tick(); });
  api.init().then((d) => {
    if (!d) return;
    setPalette(d.palette);
    el.cover.classList.toggle('hide', !!d.cover);
    if (d.state) setState(d.state);
    if (d.lyrics) { lyr = d.lyrics; buildLyrics(); }
  });
  setInterval(tick, 100);

  $('bPlay').addEventListener('click', () => { st.playing = !st.playing; stamp = performance.now(); el.pill.classList.toggle('playing', st.playing); api.cmd('toggle'); });
  $('bPrev').addEventListener('click', () => api.cmd('prev'));
  $('bNext').addEventListener('click', () => api.cmd('next'));
  $('bExp').addEventListener('click', () => api.expand());
  $('bExp').addEventListener('dblclick', (e) => e.stopPropagation());

  // Dragging is done by hand (the system drag area would stop the hover from working).
  let dragging = false;
  el.pill.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    dragging = true; el.pill.setPointerCapture(e.pointerId); api.dragStart();
  });
  const stop = () => { if (dragging) { dragging = false; api.dragEnd(); } };
  el.pill.addEventListener('pointerup', stop);
  el.pill.addEventListener('pointercancel', stop);
  window.addEventListener('blur', stop);
  el.pill.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) api.expand(); });
})();
