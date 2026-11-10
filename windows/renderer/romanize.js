/* Shows lyrics written in other scripts (Hindi, Punjabi, Arabic, Korean, Russian ...) in English letters.
   Hindi / Devanagari has its own converter that reads like everyday "Hinglish" (chala chal rahi);
   every other script goes through any-ascii. Latin-script lyrics and Quran text are left alone. */
(function (root, factory) {
  // The big any-ascii table is only fetched when a lyric in another script shows up (see ready()).
  if (typeof module === 'object' && module.exports) module.exports = factory(() => require('./anyascii.js'));
  else root.Romanize = factory(() => root.AnyAscii || null);
})(this, function (getAnyAscii) {
  'use strict';

  const VOWEL = { 'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o', 'ऍ': 'e' };
  const MATRA = { 'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e' };
  const CONS = {
    'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
    'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
    'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'ळ': 'l', 'व': 'v',
    'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  };
  const NUKTA = { 'क': 'q', 'ख': 'kh', 'ग': 'g', 'ज': 'z', 'ड': 'r', 'ढ': 'rh', 'फ': 'f', 'य': 'y' };
  const LABIAL = 'पफबभम';
  const DIGITS = '०१२३४५६७८९';
  const VIRAMA = '्';
  const NUKTA_MARK = '़';

  // One Devanagari word -> Latin letters.
  function hindiWord(word) {
    const units = []; // { c: consonants, v: vowel, inh: vowel is the "silent a" that may be dropped, nasal }
    const chars = [...word.normalize('NFC')];
    let out = '';
    const flush = () => { /* units are rendered at the end */ };
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (VOWEL[ch] !== undefined) { units.push({ c: '', v: ch === 'आ' && units.length ? 'a' : VOWEL[ch], inh: false, nasal: '' }); continue; } // huaa -> hua
      if (CONS[ch] !== undefined) {
        let cluster = '';
        let cur = ch;
        for (;;) {
          let r = CONS[cur];
          if (chars[i + 1] === NUKTA_MARK) { if (NUKTA[cur]) r = NUKTA[cur]; i++; }
          cluster += r;
          if (chars[i + 1] === VIRAMA) {
            i++; // the consonants join up
            const nxt = chars[i + 1];
            if (cur === 'ज' && nxt === 'ञ') { cluster = cluster.slice(0, -1) + 'gy'; i++; break; } // ज्ञ is "gya"
            if (nxt !== undefined && CONS[nxt] !== undefined) { cur = nxt; i++; continue; }
            units.push({ c: cluster, v: '', inh: false, nasal: '' }); // ends with a halant: no vowel
            cluster = null;
          }
          break;
        }
        if (cluster === null) continue;
        const m = chars[i + 1];
        if (m !== undefined && MATRA[m] !== undefined) { i++; units.push({ c: cluster, v: MATRA[m], inh: false, nasal: '' }); }
        else units.push({ c: cluster, v: 'a', inh: true, nasal: '' });
        continue;
      }
      if (ch === 'ं' || ch === 'ँ') {
        const last = units[units.length - 1];
        const nasal = chars[i + 1] && LABIAL.includes(chars[i + 1]) ? 'm' : 'n';
        if (last) {
          last.nasal = nasal;
          last.inh = false;
          if (last.v === 'u' && last.c) last.v = 'oo'; // हूँ -> hoon
          if (last.v === 'e' && last.c) last.v = 'ei'; // में -> mein
        } else units.push({ c: nasal, v: '', inh: false, nasal: '' });
        continue;
      }
      if (ch === 'ः') { const last = units[units.length - 1]; if (last) last.nasal += 'h'; continue; }
      if (ch === NUKTA_MARK || ch === VIRAMA) continue;
      const d = DIGITS.indexOf(ch);
      if (d >= 0) { units.push({ c: String(d), v: '', inh: false, nasal: '' }); continue; }
      if (ch === '।' || ch === '॥') { units.push({ c: '.', v: '', inh: false, nasal: '' }); continue; }
      units.push({ c: '', v: '', inh: false, nasal: '' }); // anything else Devanagari: drop
    }
    void flush;

    // Hindi drops the "silent a" at the end of a word and in the middle of many words (kamal, not kamala).
    const n = units.length;
    if (n > 1 && units[n - 1].inh) units[n - 1].v = '';
    for (let i = n - 2; i >= 1; i--) {
      const u = units[i];
      if (!u.inh) continue;
      const prev = units[i - 1];
      const next = units[i + 1];
      if (next.v !== '' && prev.v !== '' && !prev.nasal) u.v = '';
    }
    for (const u of units) out += u.c + u.v + u.nasal;
    return out;
  }

  const DEVANAGARI = /[ऀ-ॿ]+/g;
  // Scripts that are not Latin: everything else that needs converting.
  const OTHER = /[Ͱ-ϿЀ-ԯ֐-ۿݐ-ݿঀ-෿฀-๿ᄀ-ᇿ぀-ヿ㄰-㆏一-鿿가-힯ﭐ-﷿ﹰ-﻿]+/g;
  const ANY_NON_LATIN = /[Ͱ-ۿݐ-ݿऀ-๿ᄀ-ᇿ぀-ヿ㄰-㆏一-鿿가-힯ﭐ-﷿ﹰ-﻿]/;
  const STAMP_PREFIX = /^((?:\s*\[[^\]]*\])*\s*)([\s\S]*)$/;

  const anyAscii = (w) => getAnyAscii()(w);

  function line(text) {
    let s = text.replace(DEVANAGARI, (w) => hindiWord(w));
    s = s.replace(/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]+/g, (w) => anyAscii(w).toLowerCase()); // Korean comes out in odd capitals
    s = s.replace(OTHER, (w) => anyAscii(w).replace(/\s+/g, ' ').trim());
    return s;
  }

  /* Whole lyrics text (timed .lrc or plain). Timestamps and line breaks are kept. */
  function text(raw) {
    const input = String(raw || '');
    if (!ANY_NON_LATIN.test(input)) return input;
    if (input.includes('﴿')) return input; // Quran: the Arabic is the point, and it comes with an English translation
    return input.split('\n').map((l) => {
      if (!ANY_NON_LATIN.test(l)) return l;
      const m = l.match(STAMP_PREFIX);
      const body = line(m[2]);
      return m[1] + body.replace(/^(\W*)([a-z])/, (_x, p, c) => p + c.toUpperCase());
    }).join('\n');
  }

  function needsRomanizing(raw) {
    const t = String(raw || '');
    return ANY_NON_LATIN.test(t) && !t.includes('﴿');
  }

  /* True when the any-ascii table is loaded (always in tests). Hindi alone does not need it, but keep it simple. */
  function ready() { try { return typeof getAnyAscii() === 'function'; } catch { return false; } }

  return { text, needsRomanizing, hindiWord, ready };
});
