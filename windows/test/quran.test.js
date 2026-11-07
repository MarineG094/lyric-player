const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../quran.js');

const s = (title, artist = '') => { const r = Q.detect(title, artist); return r && r.surah; };

test('recognises surah titles in common spellings', () => {
  assert.equal(s('Surah Al-Fatiha'), 1);
  assert.equal(s('Surah Al Baqarah - Mishary Rashid Alafasy'), 2);
  assert.equal(s('Surah Baqara Full'), 2);
  assert.equal(s('Surah Yaseen | Beautiful Recitation'), 36);
  assert.equal(s('Surah Ya-Sin'), 36);
  assert.equal(s('Surah Ar-Rahman', 'Mishary Alafasy'), 55);
  assert.equal(s('Surah Rehman'), 55);
  assert.equal(s('Surah Al-Kahf'), 18);
  assert.equal(s('Surah Al-Mulk'), 67);
  assert.equal(s('Surat Al-Ikhlas'), 112);
  assert.equal(s('Surah An-Nas'), 114);
  assert.equal(s('Surah Al-Falaq'), 113);
  assert.equal(s('Surah Al-Asr'), 103);
  assert.equal(s('Surah Ash-Shams'), 91);
  assert.equal(s('Surah Al-Alaq'), 96);
  assert.equal(s('Surah Ali Imran'), 3);
  assert.equal(s('Surah Al-Muzzammil'), 73);
  assert.equal(s('Surah 36'), 36);
});

test('reciter or "Quran" in the title is enough, but only with a real surah name', () => {
  assert.equal(s('Al-Kahf', 'Saad Al Ghamdi'), 18);
  assert.equal(s('Ar-Rahman', 'Abdul Rahman Al-Sudais'), 55);
  assert.equal(s('Quran Recitation Yaseen'), 36);
});

test('ayah ranges and Ayat al-Kursi', () => {
  assert.deepEqual(Q.detect('Surah Al-Kahf (1-10)', ''), { surah: 18, from: 1, to: 10 });
  assert.deepEqual(Q.detect('Surah Al-Baqarah ayat 1 to 5', ''), { surah: 2, from: 1, to: 5 });
  assert.deepEqual(Q.detect('Ayatul Kursi', ''), { surah: 2, from: 255, to: 255 });
  assert.deepEqual(Q.detect('Ayat al-Kursi - Mishary', ''), { surah: 2, from: 255, to: 255 });
});

test('normal songs and nasheeds are left alone', () => {
  assert.equal(Q.detect('Numb', 'Linkin Park'), null);
  assert.equal(Q.detect('Ya Rahman', 'Some Nasheed Artist'), null);
  assert.equal(Q.detect('Tum Hi Ho', 'Arijit Singh'), null);
  assert.equal(Q.detect('Rahman Ka Karam', 'Singer'), null);
  assert.equal(Q.detect('Nur', 'Band'), null);
  assert.equal(Q.detect('Surah of Love', 'Band'), null);
  assert.equal(Q.detect('', ''), null);
});

test('builds Arabic text with the English translation', () => {
  const ar = [{ numberInSurah: 1, text: 'AR1' }, { numberInSurah: 2, text: 'AR2' }, { numberInSurah: 3, text: 'AR3' }];
  const en = [{ numberInSurah: 1, text: 'EN1' }, { numberInSurah: 2, text: 'EN2' }, { numberInSurah: 3, text: 'EN3' }];
  assert.equal(Q.buildText(ar, en), 'AR1 ﴿1﴾\nEN1\n\nAR2 ﴿2﴾\nEN2\n\nAR3 ﴿3﴾\nEN3');
  assert.equal(Q.buildText(ar, en, 2, 3), 'AR2 ﴿2﴾\nEN2\n\nAR3 ﴿3﴾\nEN3');
  assert.equal(Q.buildText(ar, [], 1, 1), 'AR1 ﴿1﴾');
});

test('tolerates spelling slips in surah names', () => {
  const cases = [['Surah Al-Baqra',2],['Surat Al Bakrah',2],['Sura Baqrah',2],['Surah Al Kahaf',18],['Surah Al Mulq',67],['Surah Falak',113],['Surah Maryem',19],['Surah Lukman',31],['Surah Zuhaa',93],['Surah Al Asar',103],['Surah Hujraat',49],['Surah Bani Israel',17],['Surah Mumtahana',60],['Surah Mayda',5]];
  for (const [t, n] of cases) { const r = require('../quran.js').detect(t, 'Mishary Alafasy'); assert.ok(r && r.surah === n, t + ' -> ' + (r && r.surah)); }
});
test('fuzzy matching never turns a normal song into a surah', () => {
  const Q = require('../quran.js');
  for (const [t, a] of [['Baqarah', 'Taylor Swift'], ['Fire Burning', 'Sean Kingston'], ['Mulberry Street', 'Some Band'], ['Fall', 'Eminem']]) assert.equal(Q.detect(t, a), null);
});

test('picks the reciter and times each ayah to the recording', () => {
  const list = [{ id: 1, name: 'AbdulBaset AbdulSamad', style: 'Murattal' }, { id: 7, name: 'Mishari Rashid al-`Afasy' }, { id: 9, name: 'Mishari Rashid al-`Afasy', style: 'Mujawwad' }, { id: 3, name: 'Abdur-Rahman as-Sudais' }];
  assert.equal(Q.pickReciter(list, 'Surah Al-Kahf - Mishary Alafasy'), 7);
  assert.equal(Q.pickReciter(list, 'Surah Yasin - Sheikh Sudais'), 3);
  assert.equal(Q.pickReciter(list, 'Surah Yasin - Unknown Qari'), 0);
  const ar = [1, 2, 3].map((n) => ({ numberInSurah: n, text: 'ar' + n })), en = [1, 2, 3].map((n) => ({ numberInSurah: n, text: 'en' + n }));
  const st = [['2:1', 0, 5000], ['2:2', 5000, 12000], ['2:3', 12000, 20000]].map(([k, a, b]) => ({ verse_key: k, timestamp_from: a, timestamp_to: b }));
  const same = Q.buildTimed(ar, en, st, 0, 0, 20).split('\n');
  assert.equal(same[1], '[00:00.00]ar1 ﴿1﴾\u2028en1');
  assert.equal(same[3], '[00:12.00]ar3 ﴿3﴾\u2028en3');
  assert.ok(Q.buildTimed(ar, en, st, 0, 0, 27).split('\n')[2].startsWith('[00:12.00]')); // 7 s intro shifts everything
  assert.ok(Q.buildTimed(ar, en, st, 0, 0, 21.2).split('\n')[3].startsWith('[00:12.72]')); // slightly slower recording stretches
  assert.equal(Q.buildTimed(ar, en, [st[0]], 0, 0, 20), null); // too little timing
  assert.ok(Q.buildTimed(ar, en, st, 2, 3, 15).split('\n')[1].startsWith('[00:00.00]ar2')); // partial upload starts at its first ayah
});

test('recognises Arabic-titled recitations and other spellings of the reciter', () => {
  assert.equal(s('AL BAQARA - سورة البقرة', 'El Sheikh Mashary Rashed El Afasi - الشيخ مشارى راشد العفاسى'), 2);
  assert.equal(s('سورة الكهف', 'مشاري العفاسي'), 18);
  assert.equal(s('سورة يس'), 36);
  assert.equal(s('Hello', 'Sheikh Chilli'), null);
  assert.equal(Q.pickReciter([{ id: 7, name: 'Mishari Rashid al-`Afasy' }], 'AL BAQARA El Sheikh Mashary Rashed El Afasi'), 7);
});

test('finds Al-Hudhaify under its different spellings', () => {
  const list = [{ id: 5, name: 'Ali bin Abdur-Rahman al-Hudhaify' }, { id: 7, name: 'Mishari Rashid al-`Afasy' }];
  for (const n of ['Ali Al Huthaifi', 'Ali Al Hudhaify', 'Ali Al Huzaifi', 'Ali Al Hudhayfi', 'علي الحذيفي']) assert.equal(Q.pickReciter(list, 'Surah Mulk ' + n), 5, n);
  assert.equal(s('Surah Mulk', 'Ali Al Huthaifi'), 67);
});

test('finds every reciter under loose spellings, and nobody for ordinary artists', () => {
  const names = ['Abdul Basit Abdul Samad','Abdur-Rahman as-Sudais','Abu Bakr al-Shatri','Hani ar-Rifai','Khalid Al-Jalil','Mishari Rashid al-`Afasy','Mahmoud Khalil Al-Husary','Muhammad Siddiq al-Minshawi','Mohamed al-Tablawi','Saud Al-Shuraim','Ali Jaber','Saad al-Ghamdi','Ahmed ibn Ali al-Ajamy','Maher al-Muaiqly','Yasser Ad-Dussary','Abdullah Awad al-Juhani','Muhammad Ayyub','Bandar Baleela','Ali bin Abdur-Rahman al-Hudhaify','Nasser Al Qatami'];
  const list = names.map((name, i) => ({ id: i + 1, name }));
  const cases = [['AbdulBaset', 1], ['Abdel Basit', 1], ['Al Sudays', 2], ['Abubakr Shaatree', 3], ['Hani Al Refai', 4], ['Khaled Al Jaleel', 5], ['Mashary Afasi', 6], ['El Hosary', 7], ['Al Menshawi', 8], ['Sheikh Shuraym', 10], ['Ali Jabir', 11], ['Saad Al Ghamidi', 12], ['Ahmad Al Ajmi', 13], ['Maher Almuaiqly', 14], ['Yasir Ad-Dosary', 15], ['Al Juhany', 16], ['Muhammad Ayub', 17], ['Bandar Balila', 18], ['Ali Al Huthaifi', 19], ['Nasser Alqatami', 20], ['Muhammad Ali', 0], ['Taylor Swift', 0], ['Ali Hamza', 0]];
  for (const [n, id] of cases) assert.equal(Q.pickReciter(list, 'Surah Mulk ' + n), id, n);
});

test('estimates timing for a reciter Quran.com does not have', () => {
  const ar = [1, 2, 3].map((n) => ({ numberInSurah: n, text: 'ar' + n })), en = [1, 2, 3].map((n) => ({ numberInSurah: n, text: 'en' + n }));
  const st = [['2:1', 4000, 10000], ['2:2', 10000, 16000], ['2:3', 16000, 20000]].map(([k, a, b]) => ({ verse_key: k, timestamp_from: a, timestamp_to: b }));
  const out = Q.buildTimed(ar, en, st, 0, 0, 40, true).split('\n');
  assert.match(out[0], /estimated/);
  assert.ok(out[1].startsWith('[00:08.00]'));  // 4 s of 20 s, stretched to 40 s
  assert.ok(out[3].startsWith('[00:32.00]'));
  assert.equal(Q.buildTimed(ar, en, st, 0, 0, 0, true), null); // no track length, no estimate
});

test('a nasheed is not guessed into a surah just because the artist also recites', () => {
  const Q = require('../quran.js');
  assert.equal(Q.detect('Ya Adheeman', 'Ahmed Bukhatir'), null);
  assert.equal(Q.detect('Ya Adheeman', 'Mishary Alafasy'), null);
  assert.equal(Q.detect('Al-Baqarah', 'Abdul Rahman Al-Sudais').surah, 2);
  assert.equal(Q.detect('Surah Al-Kahf', 'Ahmed Bukhatir').surah, 18);
});
