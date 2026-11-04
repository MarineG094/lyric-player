(() => {
    if (window.__lpAdPrune) return;
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

    // Remember the page's own media-key handlers (next / previous / play / pause), so the app can call them directly.
    window.__lpActions = {};
    try {
      const proto = window.MediaSession && window.MediaSession.prototype;
      if (proto && proto.setActionHandler) {
        const orig = proto.setActionHandler;
        proto.setActionHandler = function (name, fn) {
          try { window.__lpActions[name] = fn; } catch (_) {}
          return orig.apply(this, arguments);
        };
      }
    } catch (_) {}
    window.__lpAdPrune = { enabled: __ENABLED__ };
    const KEYS = ['adPlacements', 'playerAds', 'adSlots'];
    const prune = (o) => {
      if (!o || typeof o !== 'object' || !window.__lpAdPrune.enabled) return o;
      for (const k of KEYS) if (k in o) { try { delete o[k]; } catch (_) {} }
      if (o.playerResponse) prune(o.playerResponse);
      if (Array.isArray(o)) o.forEach((x) => x && x.playerResponse && prune(x.playerResponse));
      return o;
    };
    const parse = JSON.parse;
    JSON.parse = function (text, reviver) {
      const out = parse.call(this, text, reviver);
      try { prune(out); } catch (_) {}
      return out;
    };
    const json = Response.prototype.json;
    Response.prototype.json = function () {
      return json.call(this).then((o) => { try { prune(o); } catch (_) {} return o; });
    };
  })();