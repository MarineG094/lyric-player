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
  // Start the animation once the page is loaded and painted, then end it 3.5 s later (or at once on a click or key).
  var started = false;
  function go() {
    if (started || done) return;
    started = true;
    requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.add('intro-go'); setTimeout(finish, 3500); }); });
  }
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
  setTimeout(function () { go(); setTimeout(finish, 4500); }, 5000); // safety net if load never fires
})();
