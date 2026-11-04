/* TV extras: remote-control navigation, and "send a link from your phone" (typing on a TV remote is painful). */
(() => {
  const N = window.LPNative;

  // The cover filter is heavy for a TV box: off unless the person has turned it on before.
  const getSettings = window.api.getSettings;
  window.api.getSettings = async () => {
    const s = (await getSettings()) || {};
    if (s.coverFilter === undefined) s.coverFilter = false;
    return s;
  };

  /* ---- full screen: the menu and the player controls go away, lyrics and cover fill the TV ---- */
  let fsCb = null;
  let fsOn = false;
  window.api.onFullscreen = (cb) => { fsCb = cb; }; // the page's own full-screen styling (menu hidden, controls fade after 3 s)
  const setFs = (on) => {
    fsOn = on;
    if (fsCb) fsCb(on);
    setTimeout(() => { const b = document.getElementById('btnPlay'); if (b) b.focus(); }, 60);
  };
  window.api.fullscreen = async (on) => { setFs(on == null ? !fsOn : !!on); return fsOn; };
  window.__lpBack = () => { if (fsOn) { setFs(false); return true; } return false; }; // Back leaves full screen first
  const actions = document.querySelector('.top-actions');
  if (actions) {
    const b = document.createElement('button');
    b.id = 'btnTvFull';
    b.type = 'button';
    b.className = 'ghost';
    b.textContent = 'Full screen';
    b.addEventListener('click', () => setFs(true));
    actions.insertBefore(b, actions.firstChild);
  }

  // Height of the control bar, so full screen can centre the content while the bar is hidden.
  const dock = document.querySelector('.dock');
  const paintDock = () => { if (dock) document.documentElement.style.setProperty('--dockH', dock.offsetHeight + 'px'); };
  paintDock();
  window.addEventListener('resize', paintDock);
  setInterval(paintDock, 2000);

  /* ---- send a link from the phone ---- */
  const card = document.querySelector('#overlay .card');
  const hint = document.createElement('p');
  hint.className = 'tvhint';
  if (card) card.insertBefore(hint, card.querySelector('.paste-row'));
  const paintHint = () => {
    let addr = '';
    try { addr = N.lanAddress(); } catch (_) { /* ignore */ }
    hint.innerHTML = addr
      ? 'Easiest: on your phone (same Wi-Fi), open this address, paste the link and press Play.<strong>' + addr + '</strong>'
      : 'Connect the TV to Wi-Fi to send links from your phone.';
  };
  paintHint();
  setInterval(paintHint, 5000);

  /* ---- remote control ---- */
  const overlay = document.getElementById('overlay');
  const seek = document.getElementById('seek');
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]');
  };
  const focusables = () => {
    const scope = overlay && !overlay.hidden ? overlay : document;
    return [...scope.querySelectorAll('button, input, textarea')].filter((el) => !el.disabled && visible(el));
  };
  function move(key) {
    const list = focusables();
    const cur = document.activeElement;
    if (!list.length) return;
    if (!cur || !list.includes(cur)) { list[0].focus(); return; }
    const a = cur.getBoundingClientRect();
    const cx = a.left + a.width / 2;
    const cy = a.top + a.height / 2;
    const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
    let best = null;
    let bestScore = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const dx = b.left + b.width / 2 - cx;
      const dy = b.top + b.height / 2 - cy;
      const ok = key === 'ArrowRight' ? dx > 4 : key === 'ArrowLeft' ? dx < -4 : key === 'ArrowDown' ? dy > 4 : dy < -4;
      if (!ok) continue;
      const main = horizontal ? Math.abs(dx) : Math.abs(dy);
      const side = horizontal ? Math.abs(dy) : Math.abs(dx);
      const score = main + side * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) best.focus();
  }
  function jump(delta) {
    const max = parseFloat(seek.max) || 0;
    const t = Math.max(0, Math.min(max, (parseFloat(seek.value) || 0) + delta));
    seek.value = String(t);
    seek.dispatchEvent(new Event('input'));
    window.__lpCmd('seek', t);
  }
  document.addEventListener('keydown', (e) => {
    const key = e.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return;
    const t = e.target;
    if (t === seek && (key === 'ArrowLeft' || key === 'ArrowRight')) { e.preventDefault(); jump(key === 'ArrowRight' ? 10 : -10); return; }
    if (t && t.tagName === 'TEXTAREA') return;
    if (t && t.tagName === 'INPUT' && t.type === 'text' && (key === 'ArrowLeft' || key === 'ArrowRight')) return;
    e.preventDefault();
    move(key);
  }, true);

  // Start with the play button selected, and put the selection somewhere sensible when the "choose music" card opens.
  const first = () => { const b = document.getElementById('btnPlay'); if (b) b.focus(); };
  setTimeout(first, 1200);
  if (overlay) {
    new MutationObserver(() => {
      if (overlay.hidden) { first(); return; }
      const target = [document.getElementById('btnCloseOverlay'), document.getElementById('btnLoad')].find((b) => b && visible(b));
      if (target) target.focus();
    }).observe(overlay, { attributes: true, attributeFilter: ['hidden'] });
  }
})();
