/* Decides whether an album cover should be hidden, from the classifier's scores. Shared with tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CoverFilter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The classifier scores each image as Neutral, Drawing, Sexy, Porn or Hentai (they add up to 1).
  // Nudity covers on albums are usually artistic, so "Sexy" alone needs a high score.
  const LIMITS = { explicit: 0.3, sexy: 0.6 };

  function shouldBlur(predictions, limits) {
    const t = { ...LIMITS, ...(limits || {}) };
    const p = {};
    for (const item of predictions || []) p[item.className] = item.probability;
    return (p.Porn || 0) + (p.Hentai || 0) >= t.explicit || (p.Sexy || 0) >= t.sexy;
  }

  // The same cover comes in different sizes; this strips the size so a choice sticks to the cover.
  function coverKey(url) {
    try {
      const u = new URL(String(url));
      const path = /googleusercontent|ggpht/i.test(u.hostname) ? u.pathname.split('=')[0] : u.pathname;
      return u.hostname + path;
    } catch (_) {
      return '';
    }
  }

  return { shouldBlur, coverKey, LIMITS };
});
