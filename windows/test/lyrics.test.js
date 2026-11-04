const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../renderer/lyrics.js');

test('parses timed .lrc lines, skips metadata, applies offset', () => {
  const r = L.parse('[ti:Sample]\n[ar:Someone]\n[offset:500]\n[00:05.00]First line\n[00:10.50]Second line\n[01:02]Third');
  assert.equal(r.synced, true);
  assert.deepEqual(r.lines.map((l) => l.text), ['First line', 'Second line', 'Third']);
  assert.deepEqual(r.lines.map((l) => l.time), [5.5, 11, 62.5]);
});

test('handles several timestamps on one line and sorts them', () => {
  const r = L.parse('[00:30.00]Chorus\n[00:10.00][00:50.00]Repeat me');
  assert.equal(r.synced, true);
  assert.deepEqual(r.lines.map((l) => l.time), [10, 30, 50]);
  assert.equal(r.lines[0].text, 'Repeat me');
});

test('parses plain text and squashes blank runs', () => {
  const r = L.parse('\n\nline one\nline two\n\n\n\nline three\n\n');
  assert.equal(r.synced, false);
  assert.deepEqual(r.lines.map((l) => l.text), ['line one', 'line two', '', 'line three']);
  assert.ok(r.lines.every((l) => l.time === null));
});

test('handles CRLF and BOM', () => {
  const r = L.parse('﻿[00:01.00]a\r\n[00:02.00]b\r\n');
  assert.deepEqual(r.lines.map((l) => l.text), ['a', 'b']);
});

test('activeIndex finds the current line', () => {
  const lines = [{ time: 5 }, { time: 10 }, { time: 20 }];
  assert.equal(L.activeIndex(lines, 0), -1);
  assert.equal(L.activeIndex(lines, 5), 0);
  assert.equal(L.activeIndex(lines, 9.99), 0);
  assert.equal(L.activeIndex(lines, 10), 1);
  assert.equal(L.activeIndex(lines, 999), 2);
  assert.equal(L.activeIndex([], 3), -1);
});

test('matches titles to lyric file names', () => {
  const files = [
    { file: 'Midnight Run.lrc', name: 'Midnight Run' },
    { file: '02 - Open Road.txt', name: '02 - Open Road' },
    { file: 'Open Road (Live).txt', name: 'Open Road (Live)' },
  ];
  assert.equal(L.matchFile('Midnight Run', '', files).file, 'Midnight Run.lrc');
  assert.equal(L.matchFile('MIDNIGHT RUN (Official Audio)', '', files).file, 'Midnight Run.lrc');
  assert.equal(L.matchFile('Some Artist - Midnight Run [Lyric Video]', 'Some Artist', files).file, 'Midnight Run.lrc');
  assert.equal(L.matchFile('Open Road', '', files).file, '02 - Open Road.txt');
  assert.equal(L.matchFile('Totally Different', '', files), null);
  assert.equal(L.matchFile('', '', files), null);
});

test('prefers .lrc over .txt when both exist', () => {
  const files = [
    { file: 'Song.txt', name: 'Song' },
    { file: 'Song.lrc', name: 'Song' },
  ];
  assert.equal(L.matchFile('Song', '', files).file, 'Song.lrc');
});

test('sanitizes file names for Windows', () => {
  assert.equal(L.sanitizeFileName('AC/DC: Back in "Black"?'), 'AC DC Back in Black');
  assert.equal(L.sanitizeFileName('   '), 'Untitled');
  assert.equal(L.sanitizeFileName('Ends with dot.'), 'Ends with dot');
});

test('a saved lyrics file always re-matches the title it was saved for', () => {
  const titles = ['Smoke: Test/Song?', 'AC/DC - Back In Black', 'What? Why! "Quoted" <Tags>', 'Back\\Slash | Pipe', 'Song (Official Audio)'];
  for (const title of titles) {
    const fileName = L.sanitizeFileName(title) + '.txt';
    const found = L.matchFile(title, '', [{ file: fileName, name: fileName.replace(/\.txt$/, '') }]);
    assert.ok(found, `no match for saved file of "${title}"`);
  }
});

test('builds lookup queries from YouTube titles and channels', () => {
  // Auto-generated art track: clean title, "- Topic" channel
  assert.deepEqual(L.queryFor('Midnight Run', 'Some Artist - Topic'), { track: 'Midnight Run', artist: 'Some Artist' });
  // A dash inside an art-track title must NOT be treated as "Artist - Song"
  assert.deepEqual(L.queryFor('Hold - Me', 'Some Artist - Topic'), { track: 'Hold - Me', artist: 'Some Artist' });
  // Regular upload: "Artist - Song (Official Video)"
  assert.deepEqual(L.queryFor('Some Artist - Midnight Run (Official Video)', 'SomeArtistVEVO'), { track: 'Midnight Run', artist: 'Some Artist' });
  // Pipes, brackets and featuring credits are dropped
  assert.deepEqual(L.queryFor('Midnight Run ft. Other Person | Official Audio [HD]', 'Some Artist'), { track: 'Midnight Run', artist: 'Some Artist' });
  assert.deepEqual(L.queryFor('', ''), { track: '', artist: '' });
});

test('extracts playlist IDs from links and bare IDs', () => {
  assert.equal(L.extractPlaylistId('https://music.youtube.com/playlist?list=PLabc123_-XYZ'), 'PLabc123_-XYZ');
  assert.equal(L.extractPlaylistId('https://www.youtube.com/watch?v=xyz&list=PLabc123456&index=2'), 'PLabc123456');
  assert.equal(L.extractPlaylistId('OLAK5uy_nAbCdEfGhIjK'), 'OLAK5uy_nAbCdEfGhIjK');
  assert.equal(L.extractPlaylistId('hello world'), null);
  assert.equal(L.extractPlaylistId(''), null);
});

test('extractSource tells playlists, albums and songs apart', () => {
  // playlists, including an album's own playlist link
  assert.deepEqual(L.extractSource('https://music.youtube.com/playlist?list=PLUKLJlI92oAs&si=abc'), { kind: 'list', id: 'PLUKLJlI92oAs' });
  assert.deepEqual(L.extractSource('https://music.youtube.com/playlist?list=OLAK5uy_nAbCdEfGhIjK'), { kind: 'list', id: 'OLAK5uy_nAbCdEfGhIjK' });
  assert.deepEqual(L.extractSource('https://music.youtube.com/browse/VLPLabcdef123456'), { kind: 'list', id: 'PLabcdef123456' });
  assert.deepEqual(L.extractSource('PLabcdef123456'), { kind: 'list', id: 'PLabcdef123456' });
  // a song inside a playlist starts at that song
  assert.deepEqual(L.extractSource('https://music.youtube.com/watch?v=pl0qSJ9sdLI&list=PLUKLJlI92oAs'), { kind: 'list', id: 'PLUKLJlI92oAs', video: 'pl0qSJ9sdLI' });
  // albums
  assert.deepEqual(L.extractSource('https://music.youtube.com/browse/MPREb_AbCdEf12345'), { kind: 'album', id: 'MPREb_AbCdEf12345' });
  // single songs (the auto "song radio" list that comes with shared links is ignored)
  assert.deepEqual(L.extractSource('https://music.youtube.com/watch?v=pl0qSJ9sdLI'), { kind: 'song', id: 'pl0qSJ9sdLI' });
  assert.deepEqual(L.extractSource('https://music.youtube.com/watch?v=pl0qSJ9sdLI&list=RDAMVMpl0qSJ9sdLI'), { kind: 'song', id: 'pl0qSJ9sdLI' });
  assert.deepEqual(L.extractSource('https://youtu.be/pl0qSJ9sdLI?si=xyz'), { kind: 'song', id: 'pl0qSJ9sdLI' });
  assert.deepEqual(L.extractSource('https://www.youtube.com/watch?v=pl0qSJ9sdLI&t=30s'), { kind: 'song', id: 'pl0qSJ9sdLI' });
  // not links
  assert.equal(L.extractSource('hello world'), null);
  assert.equal(L.extractSource(''), null);
  assert.equal(L.extractSource('https://example.com/page'), null);
});

test('formats time', () => {
  assert.equal(L.formatTime(0), '0:00');
  assert.equal(L.formatTime(65.9), '1:05');
  assert.equal(L.formatTime(NaN), '0:00');
});

test('extractPlaylistId strips the VL prefix from browse ids', () => {
  assert.equal(L.extractPlaylistId('https://music.youtube.com/browse/VLPLabcdef123456'), null);
  assert.equal(L.extractPlaylistId('https://music.youtube.com/playlist?list=VLPLabcdef123456'), 'PLabcdef123456');
});

const { computePalette } = require('../palette.js');
function solid(r, g, b, count = 100) {
  const buf = Buffer.alloc(count * 4);
  for (let i = 0; i < count; i++) { buf[i * 4] = b; buf[i * 4 + 1] = g; buf[i * 4 + 2] = r; buf[i * 4 + 3] = 255; }
  return buf;
}
test('palette: a red cover gives a dark red-tinted background and a light red accent', () => {
  const p = computePalette(solid(200, 30, 30), 10, 10);
  assert.equal(p.vivid, true);
  const bg = parseInt(p.bg.slice(1, 3), 16), bgG = parseInt(p.bg.slice(3, 5), 16);
  assert.ok(bg < 70 && bg > bgG, 'background is dark and reddish: ' + p.bg);
  const acc = parseInt(p.accent.slice(1, 3), 16), accG = parseInt(p.accent.slice(3, 5), 16);
  assert.ok(acc > 150 && acc > accG + 40, 'accent is light and reddish: ' + p.accent);
});
test('palette: a gray cover stays neutral', () => {
  const p = computePalette(solid(120, 120, 120), 10, 10);
  assert.equal(p.vivid, false);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(p.bg.slice(i, i + 2), 16));
  assert.ok(Math.abs(r - g) < 12 && Math.abs(g - b) < 12, p.bg);
});
test('palette: fully transparent image gives nothing', () => {
  assert.equal(computePalette(Buffer.alloc(400), 10, 10), null);
});

const Palette = require('../renderer/palette.js');
const flat = (r, g, b, n = 64) => Array.from({ length: n }, () => [r, g, b, 255]).flat();

test('palette: a red cover gives a red hue, a blue one a blue hue', () => {
  assert.ok(Palette.fromPixels(flat(200, 30, 30), 'rgba').hue <= 5 || Palette.fromPixels(flat(200, 30, 30), 'rgba').hue >= 355);
  const blue = Palette.fromPixels(flat(30, 60, 200), 'rgba');
  assert.ok(blue.hue > 215 && blue.hue < 235);
});

test('palette: bgra order is read correctly', () => {
  // The same blue, stored as B,G,R,A
  const px = Array.from({ length: 64 }, () => [200, 60, 30, 255]).flat();
  const p = Palette.fromPixels(px, 'bgra');
  assert.ok(p.hue > 215 && p.hue < 235);
});

test('palette: black, white and grey art get a neutral theme that matches, not the brass default', () => {
  for (const [r, g, b] of [[0, 0, 0], [255, 255, 255], [128, 128, 128]]) {
    const p = Palette.fromPixels(flat(r, g, b), 'rgba');
    assert.equal(p.neutral, true);
    assert.notEqual(p.accent, Palette.DEFAULT.accent);
  }
});

test('palette: fully transparent art falls back to the default look', () => {
  assert.equal(Palette.fromPixels(Array.from({ length: 64 }, () => [200, 30, 30, 0]).flat(), 'rgba').accent, Palette.DEFAULT.accent);
});

test('palette: a mostly dark cover with real colour still picks that colour', () => {
  const px = [...flat(5, 5, 5, 300), ...flat(40, 90, 200, 40)];
  const p = Palette.fromPixels(px, 'rgba');
  assert.ok(p.hue > 205 && p.hue < 235);
});

test('palette: dominant colour wins over a small accent area', () => {
  const px = [...flat(30, 160, 60, 80), ...flat(200, 30, 30, 10)];
  const p = Palette.fromPixels(px, 'rgba');
  assert.ok(p.hue > 100 && p.hue < 150);
});

const CoverFilter = require('../renderer/coverfilter.js');
const preds = (o) => Object.entries(o).map(([className, probability]) => ({ className, probability }));

test('cover filter: neutral and drawing covers are shown', () => {
  assert.equal(CoverFilter.shouldBlur(preds({ Neutral: 0.9, Drawing: 0.08, Sexy: 0.01, Porn: 0.01, Hentai: 0 })), false);
  assert.equal(CoverFilter.shouldBlur(preds({ Drawing: 0.95, Neutral: 0.05 })), false);
});

test('cover filter: explicit scores are hidden', () => {
  assert.equal(CoverFilter.shouldBlur(preds({ Porn: 0.4, Neutral: 0.6 })), true);
  assert.equal(CoverFilter.shouldBlur(preds({ Porn: 0.2, Hentai: 0.15, Neutral: 0.65 })), true); // the two add up
  assert.equal(CoverFilter.shouldBlur(preds({ Sexy: 0.7, Neutral: 0.3 })), true);
});

test('cover filter: moderately "sexy" alone is not enough', () => {
  assert.equal(CoverFilter.shouldBlur(preds({ Sexy: 0.45, Neutral: 0.55 })), false);
});

test('cover filter: empty or missing predictions never hide a cover', () => {
  assert.equal(CoverFilter.shouldBlur([]), false);
  assert.equal(CoverFilter.shouldBlur(null), false);
});

test('cover key ignores the size part of the image address', () => {
  const a = CoverFilter.coverKey('https://lh3.googleusercontent.com/AbC_dEf-123=w226-h226-l90-rj');
  const b = CoverFilter.coverKey('https://lh3.googleusercontent.com/AbC_dEf-123=w800-h800');
  assert.equal(a, b);
  assert.notEqual(a, CoverFilter.coverKey('https://lh3.googleusercontent.com/Other=w800-h800'));
  assert.equal(CoverFilter.coverKey('not a url'), '');
});
