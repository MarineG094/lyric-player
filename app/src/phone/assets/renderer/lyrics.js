/* Lyrics helpers: parse .lrc / plain text, find the active line, match a song
   title to a lyrics file name. Works in the browser (window.Lyrics) and in
   Node (require), so main.js and the tests can share it. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Lyrics = factory();
})(this, function () {
  const STAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const META = /^\s*\[(ti|ar|al|by|au|length|re|ve|id):/i;
  const OFFSET = /^\s*\[offset:\s*(-?\d+)\s*\]/i;

  function hasTimestamps(text) {
    return /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(String(text || ''));
  }

  /* Returns { synced: boolean, lines: [{ time: number|null, text: string }] } */
  function parse(text) {
    const clean = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const rows = clean.split('\n');
    const synced = [];
    const plain = [];
    let offset = 0;

    for (const raw of rows) {
      const off = raw.match(OFFSET);
      if (off) {
        offset = parseInt(off[1], 10) / 1000;
        continue;
      }
      if (META.test(raw)) continue;

      const stamps = [...raw.matchAll(STAMP)];
      const body = raw.replace(STAMP, '').trim();
      if (stamps.length) {
        for (const m of stamps) {
          const frac = m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) / 1000 : 0;
          synced.push({ time: parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac, text: body });
        }
      } else {
        plain.push(raw.trimEnd());
      }
    }

    if (synced.length) {
      synced.sort((a, b) => a.time - b.time);
      return { synced: true, lines: synced.map((l) => ({ time: Math.max(0, l.time + offset), text: l.text })) };
    }

    // Plain text: drop leading/trailing blank lines, squash runs of blanks.
    const lines = [];
    for (const row of plain) {
      const blank = row.trim() === '';
      if (blank && (lines.length === 0 || lines[lines.length - 1].text === '')) continue;
      lines.push({ time: null, text: blank ? '' : row });
    }
    while (lines.length && lines[lines.length - 1].text === '') lines.pop();
    return { synced: false, lines };
  }

  /* Index of the last line whose time <= t, or -1 before the first line. */
  function activeIndex(lines, t) {
    let lo = 0;
    let hi = lines.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].time <= t) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\(.*?\)|\[.*?\]/g, ' ')
      .replace(/\b(official|audio|video|lyric|lyrics|visualizer|music video|hd|4k)\b/g, ' ')
      .replace(/[^a-z0-9À-￿]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function stripTrackNumber(name) {
    return normalize(String(name).replace(/^\s*\d{1,3}\s*[-._)]\s*/, ''));
  }

  /* files: [{ file, name }]. Returns the best matching entry or null. */
  function matchFile(title, artist, files) {
    const t = normalize(title);
    if (!t) return null;
    const a = normalize(artist);
    let best = null;
    let bestScore = 0;

    for (const f of files || []) {
      const n = stripTrackNumber(f.name);
      if (!n) continue;
      let score = 0;
      if (n === t) score = 100;
      else if (a && (n === `${a} ${t}` || n === `${t} ${a}`)) score = 95;
      else if (n.length >= 3 && t.includes(n)) score = 50 + 40 * (n.length / t.length);
      else if (t.length >= 3 && n.includes(t)) score = 50 + 40 * (t.length / n.length);
      if (score > 0 && /\.lrc$/i.test(f.file || '')) score += 0.5; // prefer timed lyrics on ties
      if (score > bestScore) {
        best = f;
        bestScore = score;
      }
    }
    return best;
  }

  function sanitizeFileName(title) {
    const cleaned = String(title || '')
      // Swap illegal characters for a space (not nothing) so the saved name
      // still normalizes to the same words as the song title and re-matches.
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '')
      .slice(0, 100);
    return cleaned || 'Untitled';
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /* Turns a YouTube title + channel name into { track, artist } for an online lookup.
     Auto-generated "Artist - Topic" channels have clean titles; regular uploads
     are often "Artist - Song (Official Video)". */
  function queryFor(title, author) {
    const isTopic = /-\s*Topic$/i.test(String(author || ''));
    let artist = String(author || '').replace(/\s*-\s*Topic$/i, '').replace(/\s*VEVO$/i, '').trim();
    let track = String(title || '')
      .split('|')[0]
      .replace(/\s*[(\[][^)\]]*[)\]]\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!isTopic) {
      const m = track.match(/^(.+?)\s+[-–—]\s+(.+)$/);
      if (m) {
        artist = m[1].trim();
        track = m[2].trim();
      }
    }
    track = track.replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, '').trim();
    return { track, artist };
  }

  /* Pulls a playlist ID out of a pasted/dropped URL or a bare ID. */
  function extractPlaylistId(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    const m = s.match(/[?&]list=([A-Za-z0-9_-]+)/);
    if (m) return m[1].replace(/^VL(?=PL|OLAK5uy_|UU|FL)/, '');
    if (/^(PL|OLAK5uy_|UU|FL|RD)[A-Za-z0-9_-]{6,}$/.test(s)) return s;
    return null;
  }

  /* Works out what a pasted/dropped link points at:
       { kind: 'list',  id, video? }  a playlist (or an album's playlist link, optionally starting at one song)
       { kind: 'album', id }          an album page (music.youtube.com/browse/MPREb_...)
       { kind: 'song',  id }          one song
     or null when it isn't a YouTube / YouTube Music link. */
  function extractSource(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    const vm = s.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/);
    const video = vm ? vm[1] : null;

    const album = s.match(/\/browse\/(MPREb_[A-Za-z0-9_-]{4,})/) || s.match(/^(MPREb_[A-Za-z0-9_-]{4,})$/);
    if (album) return { kind: 'album', id: album[1] };

    const listParam = s.match(/[?&]list=([A-Za-z0-9_-]+)/);
    const listBrowse = s.match(/\/browse\/VL([A-Za-z0-9_-]{6,})/);
    const bare = /^(PL|OLAK5uy_|UU|FL|RD)[A-Za-z0-9_-]{6,}$/.test(s) ? s : null;
    let list = listParam ? listParam[1].replace(/^VL(?=PL|OLAK5uy_|UU|FL)/, '') : listBrowse ? listBrowse[1] : bare;
    if (list) {
      // "Song radio" / auto-mix lists ride along on single-song links; those mean "just this song".
      if (video && /^RD(AMVM|MM|EM|GM)/.test(list)) return { kind: 'song', id: video };
      return video ? { kind: 'list', id: list, video } : { kind: 'list', id: list };
    }
    if (video) return { kind: 'song', id: video };
    return null;
  }

  return { parse, activeIndex, hasTimestamps, matchFile, normalize, sanitizeFileName, formatTime, extractPlaylistId, extractSource, queryFor };
});
