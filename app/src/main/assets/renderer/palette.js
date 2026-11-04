/* Turns album-art pixels into a colour theme. Shared by the app (main process) and tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Palette = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
    return [h, s, l];
  }

  const hsl = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;

  /* The app's original warm brass look, used when there's no usable art. */
  const DEFAULT = {
    bg: '#120f0d', bg2: '#1a1512', panel: '#1f1914', line: '#3a2f27', dim: '#8f8071',
    accent: '#c08a5e', accent2: '#e0b48a', glow: '#c08a5e', glow2: '#c08a5e',
  };

  /* px: flat pixel array, 4 values per pixel. order: 'rgba' or 'bgra'. */
  function fromPixels(px, order) {
    const bgra = order === 'bgra';
    const bins = new Map();
    let opaque = 0;
    let lumSum = 0;
    for (let i = 0; i + 3 < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      const r = bgra ? px[i + 2] : px[i];
      const g = px[i + 1];
      const b = bgra ? px[i] : px[i + 2];
      const [h, s, l] = rgbToHsl(r, g, b);
      opaque += 1;
      lumSum += l;
      if (s < 0.14 || l < 0.1 || l > 0.9) continue; // near-black, near-white and grey pixels carry no colour
      const weight = (0.3 + s) * (1 - Math.abs(l - 0.5));
      const key = Math.floor(h / 20) % 18;
      let bin = bins.get(key);
      if (!bin) { bin = { w: 0, cos: 0, sin: 0, s: 0, key }; bins.set(key, bin); }
      bin.w += weight;
      bin.cos += Math.cos((h * Math.PI) / 180) * weight;
      bin.sin += Math.sin((h * Math.PI) / 180) * weight;
      bin.s += s * weight;
    }
    if (!opaque) return { ...DEFAULT, hue: null };

    const list = [...bins.values()].sort((a, b) => b.w - a.w);
    // Not enough real colour (black, white or grey art): a neutral theme, light or dark to suit the art.
    if (!list.length || list[0].w < opaque * 0.02) {
      const light = lumSum / opaque > 0.5;
      return {
        hue: null,
        neutral: true,
        bg: hsl(0, 0, 0.07),
        bg2: hsl(0, 0, 0.11),
        panel: hsl(0, 0, 0.14),
        line: hsl(0, 0, 0.24),
        dim: hsl(0, 0, 0.62),
        accent: hsl(0, 0, light ? 0.8 : 0.7),
        accent2: hsl(0, 0, 0.88),
        glow: hsl(0, 0, light ? 0.34 : 0.2),
        glow2: hsl(0, 0, light ? 0.26 : 0.16),
      };
    }

    const hueOf = (bin) => ((Math.atan2(bin.sin, bin.cos) * 180) / Math.PI + 360) % 360;
    const top = list[0];
    const h = hueOf(top);
    const s = top.s / top.w;
    const accentS = clamp(s * 1.1, 0.4, 0.8);
    const bgS = clamp(s * 0.55, 0.14, 0.45);

    // A second, clearly different colour for the second glow, if the art has one.
    const second = list.find((b) => b !== top && b.w > top.w * 0.25 &&
      Math.min(Math.abs(hueOf(b) - h), 360 - Math.abs(hueOf(b) - h)) > 35);
    const h2 = second ? hueOf(second) : h;
    const s2 = second ? clamp(second.s / second.w, 0.3, 0.8) : accentS;

    return {
      hue: Math.round(h),
      bg: hsl(h, bgS, 0.07),
      bg2: hsl(h, bgS, 0.11),
      panel: hsl(h, bgS, 0.14),
      line: hsl(h, bgS, 0.24),
      dim: hsl(h, 0.16, 0.64),
      accent: hsl(h, accentS, 0.62),
      accent2: hsl(h, accentS, 0.78),
      glow: hsl(h, clamp(s, 0.4, 0.85), 0.38),
      glow2: hsl(h2, s2, 0.34),
    };
  }

  return { fromPixels, DEFAULT, rgbToHsl };
});
