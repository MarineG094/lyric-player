// Intro screen: plays once per launch, can be switched off in Menu > Settings, and any click or key skips it.
// It runs first (in the head) so that when it is off nothing flashes.
(function () {
  var root = document.documentElement;
  var on = true;
  try { on = localStorage.getItem('lpIntro') !== '0'; } catch (_) { /* storage blocked: keep the default */ }
  if (!on) { root.classList.add('no-intro'); return; }
  var done = false;
  function finish() {
    if (done) return;
    done = true;
    root.classList.add('intro-done');
    var s = document.getElementById('splash');
    if (s && s.parentNode) s.parentNode.removeChild(s);
    window.removeEventListener('keydown', finish, true);
    window.removeEventListener('pointerdown', finish, true);
  }
  window.addEventListener('keydown', finish, true);
  window.addEventListener('pointerdown', finish, true);
  setTimeout(finish, 3500);
})();
