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

  /* "Memories" must not match a file called "Dead Memories": when one name contains the other, the extra words have to be
     the artist or filler ("official video", "remastered 2011"), not more of the title. */
  const FILLER = new Set(['official', 'video', 'audio', 'lyrics', 'lyric', 'remastered', 'remaster', 'version', 'hd', 'hq', 'live', 'music', 'feat', 'ft', 'explicit', 'topic', 'vevo', 'single', 'radio', 'edit', 'mono', 'stereo', 'album', 'remix', 'acoustic', 'slowed', 'reverb', 'sped', 'up', 'nightcore', 'mix', 'deluxe', 'interlude', 'intro', 'outro', 'skit', 'reprise', 'prelude', 'instrumental']); // (the last ones are compared separately, by partsOf)
  function extraOk(longer, shorter, artist) {
    const aw = new Set(String(artist || '').split(' ').filter(Boolean));
    const sw = new Set(shorter.split(' '));
    return longer.split(' ').every((w) => sw.has(w) || aw.has(w) || FILLER.has(w) || /^\d+$/.test(w));
  }

  /* "Faded (Interlude)" is a 40 second track, not the song "Faded". normalize() drops the brackets, so these words are read
     from the raw title: two titles that differ in them are different songs. */
  const PARTS = ['interlude', 'intro', 'outro', 'skit', 'reprise', 'prelude', 'instrumental'];
  function partsOf(raw) {
    const w = String(raw || '').toLowerCase().split(/[^a-z0-9]+/);
    return PARTS.filter((p) => w.includes(p)).join(',');
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
      if (partsOf(f.name) !== partsOf(title)) continue;
      let score = 0;
      if (n === t) score = 100;
      else if (a && (n === `${a} ${t}` || n === `${t} ${a}`)) score = 95;
      else if (n.length >= 3 && (` ${t} `).includes(` ${n} `) && extraOk(t, n, a)) score = 50 + 40 * (n.length / t.length);
      else if (t.length >= 3 && (` ${n} `).includes(` ${t} `) && extraOk(n, t, a)) score = 50 + 40 * (t.length / n.length);
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
  /* A "not found" line from an import ("Artist – Title  (searched, but only found: …)") -> the words to search for by hand. */
  function missingQuery(line) {
    return String(line || '')
      .replace(/\s{2,}\((searched, but only found|nothing came back)[\s\S]*$/, '')
      .replace(/\s+[–-]\s+/, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* announcements.json from the repo -> a short, safe list, newest first. Plain text only, no links or markup. */
  function cleanAnnouncements(json, now) {
    const list = json && Array.isArray(json.items) ? json.items : [];
    const t = now || Date.now();
    const out = [];
    for (const a of list) {
      if (!a || typeof a !== 'object') continue;
      const id = Number(a.id);
      const text = typeof a.text === 'string' ? a.text.trim().slice(0, 600) : '';
      if (!Number.isInteger(id) || id < 1 || !text) continue;
      if (typeof a.until === 'string' && Date.parse(a.until) < t) continue; // past its end date
      out.push({ id, title: typeof a.title === 'string' ? a.title.trim().slice(0, 80) : '', text, date: typeof a.date === 'string' ? a.date.slice(0, 10) : '' });
    }
    out.sort((x, y) => y.id - x.id);
    return out.slice(0, 5);
  }

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


  /* ---------- playlists from other services (Spotify, Deezer, SoundCloud) ---------- */

  /* { service, kind: 'playlist' | 'album', id, url } for a Spotify / Deezer / SoundCloud link, else null. */
  function extractExternal(text) {
    const s = String(text || '').trim();
    let m = s.match(/open\.spotify\.com\/(?:intl-[a-z]+\/|embed\/)*(playlist|album)\/([A-Za-z0-9]{10,30})/i);
    if (m) return { service: 'spotify', kind: m[1].toLowerCase(), id: m[2], url: `https://open.spotify.com/embed/${m[1].toLowerCase()}/${m[2]}` };
    m = s.match(/deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(playlist|album)\/(\d{3,20})/i);
    if (m) return { service: 'deezer', kind: m[1].toLowerCase(), id: m[2], url: `https://api.deezer.com/${m[1].toLowerCase()}/${m[2]}/tracks?limit=200` };
    m = s.match(/^https?:\/\/(?:www\.|m\.)?soundcloud\.com\/([A-Za-z0-9_-]+)\/sets\/([A-Za-z0-9_-]+)/i);
    if (m) return { service: 'soundcloud', kind: 'playlist', id: `${m[1]}/${m[2]}`, url: `https://soundcloud.com/${m[1]}/sets/${m[2]}` };
    return null;
  }

  const SERVICE_NAME = { spotify: 'Spotify', deezer: 'Deezer', soundcloud: 'SoundCloud' };

  function cleanList(arr) {
    const out = [];
    const seen = new Set();
    for (const t of arr) {
      const title = String(t.title || '').replace(/\s+/g, ' ').trim();
      if (!title) { out.push({ title: '', artist: '', dur: 0 }); continue; }
      const artist = String(t.artist || '').replace(/\s+/g, ' ').trim();
      const key = normalize(title) + '|' + normalize(artist);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ title, artist, dur: Number(t.dur) > 0 ? Math.round(Number(t.dur)) : 0 });
    }
    return out;
  }

  /* Spotify's public embed page carries the song list as JSON ("__NEXT_DATA__"). → { name, tracks } or null. */
  function parseSpotifyEmbed(html) {
    const m = String(html || '').match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;
    let data;
    try { data = JSON.parse(m[1]); } catch (_) { return null; }
    let entity = null;
    const find = (o, depth) => {
      if (!o || typeof o !== 'object' || entity || depth > 12) return;
      if (Array.isArray(o.trackList)) { entity = o; return; }
      for (const k in o) find(o[k], depth + 1);
    };
    find(data, 0);
    if (!entity) return null;
    const tracks = entity.trackList.map((t) => ({
      title: t.title || t.name || '',
      artist: String(t.subtitle || t.artists || '').replace(/ /g, ' '),
      dur: t.duration ? Number(t.duration) / 1000 : 0,
    }));
    return { name: String(entity.name || entity.title || ''), tracks: cleanList(tracks) };
  }

  /* Deezer's public API: /playlist/ID/tracks or /album/ID/tracks. */
  function parseDeezer(json) {
    if (!json || !Array.isArray(json.data)) return null;
    return { name: '', tracks: cleanList(json.data.map((t) => ({ title: t.title, artist: t.artist && t.artist.name, dur: t.duration }))) };
  }

  /* SoundCloud pages embed their data as window.__sc_hydration. Only the first tracks carry titles; the rest are bare ids. */
  function parseSoundcloud(html) {
    const m = String(html || '').match(/window\.__sc_hydration\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/);
    if (!m) return null;
    let arr;
    try { arr = JSON.parse(m[1]); } catch (_) { return null; }
    const pl = (Array.isArray(arr) ? arr : []).find((x) => x && x.hydratable === 'playlist');
    if (!pl || !pl.data || !Array.isArray(pl.data.tracks)) return null;
    const tracks = pl.data.tracks.map((t) => ({
      title: t.title || '',
      artist: (t.publisher_metadata && t.publisher_metadata.artist) || (t.user && t.user.username) || '',
      dur: t.duration ? t.duration / 1000 : 0,
    }));
    return { name: String(pl.data.title || ''), tracks: cleanList(tracks) };
  }

  const wordsOf = (s) => normalize(s).split(' ').filter(Boolean);
  const NOISE = /\b(live|cover|karaoke|instrumental|sped|slowed|reverb|remix|acoustic|8d|nightcore|reaction|tutorial)\b/;

  function durFromText(sub) {
    const m = String(sub || '').match(/(\d{1,2}):(\d{2})(?!\d)/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  }

  /* The searches to try, in order, for one wanted song: { query, songsOnly }. Album tracks come first (the Songs filter),
     then a cleaned-up title, then the plain mixed search (which can also find music videos). */
  function searchTries(want) {
    const artist = String(want.artist || '').trim();
    const primary = artist.split(/\s*(?:,|&| feat\.?| ft\.?| x | and )\s*/i)[0].trim();
    const title = String(want.title || '').trim();
    const clean = title.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, ' ').replace(/\s*-\s*(remaster(ed)?|single|radio|mono|stereo|album|live|from)\b.*$/i, '').replace(/\s*(feat\.?|ft\.?|with)\s.*$/i, '').replace(/\s+/g, ' ').trim();
    const out = [{ query: `${artist} ${title}`.trim(), songsOnly: true }];
    const second = `${primary} ${clean || title}`.trim();
    if (second && second !== out[0].query) out.push({ query: second, songsOnly: true });
    // the title alone (an unusual artist list can drown the song), then the plain mixed search
    if (clean && clean.length >= 3) out.push({ query: clean, songsOnly: true });
    out.push({ query: `${artist} ${title}`.trim(), songsOnly: false });
    if (second && second !== out[out.length - 1].query) out.push({ query: second, songsOnly: false });
    return out;
  }

  /* Picks the YouTube Music result that is the wanted song, or null. results: [{ kind, id, title, sub, type }] */
  function matchTrack(want, results) {
    const wTitle = String(want.title || '').replace(/\s*-\s*(remaster(ed)?|single|radio|mono|stereo|album)\b.*$/i, '').replace(/\s*(feat\.?|ft\.?|with)\s.*$/i, '');
    const wt = wordsOf(wTitle);
    if (!wt.length) return null;
    // every wanted artist counts (a song by "A, B" is fine when the result lists A or B), not just the first
    const wantArtists = String(want.artist || '').split(/\s*(?:,|&| feat\.?| ft\.?| x | and )\s*/i).map(wordsOf).filter((w) => w.length);
    // read from the raw title: normalize() drops the brackets, and "(Bardz Remix)" is exactly what has to be seen
    const wantNoisy = NOISE.test(String(want.title || '').toLowerCase());
    let best = null;
    let weak = null; // a result that does not say who the artist is: only used when nothing says it plainly
    let idx = -1;
    for (const r of results || []) {
      if (!r || r.kind !== 'song') continue;
      idx += 1;
      let rt = wordsOf(r.title);
      // A video is usually called "Maroon 5 - Payphone ft. Wiz Khalifa": drop the artist in front and the "ft." part, then compare.
      for (const ws of wantArtists) if (rt.length > ws.length && ws.every((w, i) => rt[i] === w)) { rt = rt.slice(ws.length); break; }
      const ftAt = rt.findIndex((w, i) => i > 0 && (w === 'ft' || w === 'feat' || w === 'featuring'));
      if (ftAt > 0) rt = rt.slice(0, ftAt);
      if (!rt.length) continue;
      const rset = new Set(rt);
      const inter = wt.filter((w) => rset.has(w)).length;
      const t = inter / Math.max(wt.length, rt.length, 1);
      if (t < 0.5) continue;
      // r.sub reads "Artist • Album • 3:25": only the artist part counts. The album can name another artist ("Ambient Translations of Halsey").
      const sub = normalize(String(r.sub || '').split(/\s*\u2022\s*/)[0]);
      const subWords = sub.split(' ');
      // a long artist word also counts inside a channel name ("AviciiVEVO"). Never the title: an upload called "Wake Me Up Avicii" is not by Avicii.
      const a = wantArtists.length ? Math.max(...wantArtists.map((ws) => ws.filter((w) => subWords.includes(w) || (w.length >= 5 && sub.includes(w))).length / ws.length)) : 0;
      let score = 0.55 * t + 0.3 * a;
      const d = durFromText(r.sub);
      // a clip or a different cut: far off the real length is not the song
      if (want.dur && d && Math.abs(d - want.dur) > Math.max(25, want.dur * 0.1)) continue;
      if (want.dur && d) { const diff = Math.abs(d - want.dur); score += diff <= 5 ? 0.1 : diff <= 15 ? 0.04 : -0.1; }
      if (/^song$/i.test(r.type || '')) score += 0.1;      // the album track
      else if (/^video$/i.test(r.type || '')) score -= 0.05; // a music video only wins when there is nothing better
      if (wantNoisy && !NOISE.test(String(r.title || '').toLowerCase())) score -= 0.15; // the playlist has the remix: prefer the remix
      if (!wantNoisy && NOISE.test(String(r.title || '').toLowerCase())) score -= 0.6; // a remix, live or sped-up version is not the song: with nothing else it counts as not found
      // Some rows (a video's top result, say) come without the artist: the first part is a view count or empty. (An artist that happens to be named like the song is a real artist: "STEREO HEARTS." is not Gym Class Heroes.)
      // Then the artist cannot be compared, so the title must be exact, not a remix, and the length must agree (or it must be the first hit).
      const seg = String(r.sub || '').split(/\s*\u2022\s*/)[0].trim();
      const unknown = !seg || /\b(views?|plays?|subscribers?|likes?)\b/i.test(seg) || /^\d{1,2}:\d{2}$/.test(seg);
      if (unknown && wantArtists.length) {
        const noisy = !wantNoisy && NOISE.test(String(r.title || '').toLowerCase());
        const lenOk = want.dur && d ? Math.abs(d - want.dur) <= 3 : (!d && idx === 0);
        if (t >= 0.9 && !noisy && lenOk) { const ws = 0.5 + (want.dur && d ? 0.1 : 0) + (/^song$/i.test(r.type || '') ? 0.05 : 0); if (!weak || ws > weak.score) weak = { score: ws, r }; }
        continue;
      }
      // Same title by a different artist is a different song (a cover, a remix): the artist has to be there.
      // Only when there is no usable artist name to compare does an exact title have to do.
      if (wantArtists.length ? a < 0.5 : t < 0.9) continue;
      if (score >= 0.5 && (!best || score > best.score)) best = { score, r };
    }
    return best ? best.r : weak ? weak.r : null;
  }

  /* Is this lyrics-service result the same song? The title has to be the same (a longer title that starts with it is fine:
     "Memories" is not "Dead Memories") and, when we know the artist, the artist has to match too. */
  function sameSong(track, artist, resTrack, resArtist) {
    const nt = normalize(track), rt = normalize(resTrack);
    if (!nt || !rt) return false;
    if (partsOf(track) !== partsOf(resTrack)) return false;
    const titleOk = rt === nt || rt.startsWith(nt + ' ') || nt.startsWith(rt + ' ');
    const na = normalize(artist), ra = normalize(resArtist);
    const artistOk = !na || (!!ra && (ra.includes(na) || na.includes(ra)));
    return titleOk && artistOk;
  }

  return { sameSong, searchTries, extractExternal, SERVICE_NAME, parseSpotifyEmbed, parseDeezer, parseSoundcloud, matchTrack, parse, activeIndex, hasTimestamps, matchFile, normalize, sanitizeFileName, formatTime, extractPlaylistId, extractSource, queryFor, missingQuery, cleanAnnouncements };
});
