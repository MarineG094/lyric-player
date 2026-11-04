/* Picks a colour scheme from album art. Pure functions: pixels in, hex colours out. */
'use strict';

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((x) => Math.round(x * 255));
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
const make = (h, s, l) => hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1));

/* bgra: Buffer/Uint8Array of w*h*4 bytes in B,G,R,A order (what Electron's toBitmap() gives). */
function computePalette(bgra, w, h) {
  const BUCKETS = 24;
  const weight = new Array(BUCKETS).fill(0);
  const sumS = new Array(BUCKETS).fill(0);
  const sumL = new Array(BUCKETS).fill(0);
  const sumSin = new Array(BUCKETS).fill(0);
  const sumCos = new Array(BUCKETS).fill(0);
  let n = 0, avgS = 0, avgL = 0, avgSin = 0, avgCos = 0;

  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (bgra[o + 3] < 128) continue;
    const [hh, s, l] = rgbToHsl(bgra[o + 2], bgra[o + 1], bgra[o]);
    n++;
    avgS += s; avgL += l;
    avgSin += Math.sin(hh * 2 * Math.PI) * s; avgCos += Math.cos(hh * 2 * Math.PI) * s;
    // Vivid, mid-brightness pixels make the best accent; near-black/white/gray ones barely count.
    const w8 = Math.pow(s, 1.5) * (1 - Math.abs(2 * l - 1));
    if (w8 <= 0) continue;
    const b = Math.min(BUCKETS - 1, Math.floor(hh * BUCKETS));
    weight[b] += w8; sumS[b] += s * w8; sumL[b] += l * w8;
    sumSin[b] += Math.sin(hh * 2 * Math.PI) * w8; sumCos[b] += Math.cos(hh * 2 * Math.PI) * w8;
  }
  if (!n) return null;
  avgS /= n; avgL /= n;

  let best = 0;
  for (let b = 1; b < BUCKETS; b++) if (weight[b] > weight[best]) best = b;
  const vivid = weight[best] > n * 0.01;

  let hue, accentS;
  if (vivid) {
    hue = ((Math.atan2(sumSin[best], sumCos[best]) / (2 * Math.PI)) + 1) % 1;
    accentS = clamp(sumS[best] / weight[best], 0.4, 0.85);
  } else {
    // Gray / black-and-white art: keep it neutral instead of inventing a colour.
    hue = ((Math.atan2(avgSin, avgCos) / (2 * Math.PI)) + 1) % 1;
    accentS = clamp(avgS, 0.04, 0.2);
  }
  const bgS = vivid ? clamp(avgS * 0.8 + 0.12, 0.18, 0.5) : clamp(avgS, 0.03, 0.12);

  const accent = make(hue, accentS, 0.64);
  return {
    bg: hex(make(hue, bgS, 0.085)),
    bg2: hex(make(hue, bgS, 0.125)),
    panel: hex(make(hue, bgS, 0.155)),
    line: hex(make(hue, bgS * 0.9, 0.24)),
    text: hex(make(hue, vivid ? 0.3 : 0.06, 0.93)),
    dim: hex(make(hue, vivid ? 0.16 : 0.04, 0.6)),
    accent: hex(accent),
    accent2: hex(make(hue, accentS, 0.78)),
    glow: accent.join(','),
    vivid,
  };
}

module.exports = { computePalette, rgbToHsl, hslToRgb };
