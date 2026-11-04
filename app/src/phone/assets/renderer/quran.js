(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Quran = factory();
})(this, function () {
'use strict';
/* Recognises Quran recitations from a song title + artist ("Surah Al-Kahf (1-10) - Mishary Alafasy")
   and builds the text to show (Arabic with an English translation). Pure functions, shared with the tests. */

// Surah names, 1 to 114: a few common English spellings each, written without the leading "al-/an-/ar-...".
const NAMES = [
  ['fatiha', 'fatihah', 'fateha', 'fatehah'], ['baqarah', 'baqara', 'bakara', 'bakarah', 'bakrah', 'baqrah'], ['imran', 'aliimran', 'ale imran'],
  ['nisa', 'nisaa', 'nissa'], ['maidah', 'maida', 'maaidah', 'maeda'], ['anam', 'anaam'], ['araf', 'aaraf'], ['anfal'],
  ['tawbah', 'tawba', 'taubah', 'tauba', 'barah', 'baraah'], ['yunus', 'yunus', 'younus'], ['hud', 'hood'], ['yusuf', 'yousuf', 'yusif', 'yousef'],
  ['rad', 'raad'], ['ibrahim', 'ibraheem'], ['hijr'], ['nahl'], ['isra', 'israa', 'bani israil', 'bani israeel', 'bani israel'], ['kahf'],
  ['maryam', 'mariam', 'meryem'], ['taha', 'ta ha'], ['anbiya', 'anbiyaa', 'anbiyaa'], ['hajj', 'haj'], ['muminun', 'muminoon', 'mominoon', 'mominun'],
  ['nur', 'noor'], ['furqan', 'furqaan'], ['shuara', 'shuaraa'], ['naml'], ['qasas'], ['ankabut', 'ankaboot'], ['rum', 'room'],
  ['luqman', 'luqmaan'], ['sajdah', 'sajda', 'sajadah'], ['ahzab', 'ahzaab'], ['saba', 'sabaa'], ['fatir', 'faatir'], ['yasin', 'yaseen', 'yaaseen', 'ya sin', 'ya seen'],
  ['saffat', 'saaffaat', 'saffaat'], ['sad', 'saad'], ['zumar'], ['ghafir', 'mumin', 'momin'], ['fussilat', 'fussilat', 'ha mim sajdah'],
  ['shura', 'shuraa'], ['zukhruf'], ['dukhan', 'dukhaan'], ['jathiyah', 'jathiya', 'jasiyah', 'jaathiyah'], ['ahqaf', 'ahqaaf'], ['muhammad'],
  ['fath', 'fatah', 'fatH'], ['hujurat', 'hujuraat'], ['qaf', 'qaaf'], ['dhariyat', 'zariyat', 'dhariyaat', 'zaariyat'], ['tur', 'toor'],
  ['najm'], ['qamar'], ['rahman', 'rehman', 'rahmaan'], ['waqiah', 'waqia', 'waqiah', 'waqiaa'], ['hadid', 'hadeed'], ['mujadilah', 'mujadila', 'mujadalah', 'mujadelah'],
  ['hashr'], ['mumtahanah', 'mumtahina', 'mumtahinah'], ['saff', 'saf'], ['jumuah', 'jumua', 'jumah', 'jumuah'], ['munafiqun', 'munafiqoon', 'munafiqun'],
  ['taghabun', 'taghabon'], ['talaq', 'talaaq'], ['tahrim', 'tahreem'], ['mulk'], ['qalam'], ['haqqah', 'haqqa', 'haaqqah'], ['maarij', 'maarij', 'maaarij'],
  ['nuh', 'nooh'], ['jinn'], ['muzzammil', 'muzammil', 'muzzamil'], ['muddaththir', 'muddathir', 'mudassir', 'muddasir', 'mudathir'], ['qiyamah', 'qiyama', 'qiyamat', 'qiyaamah'],
  ['insan', 'dahr', 'insaan'], ['mursalat', 'mursalaat'], ['naba', 'nabaa'], ['naziat', 'naziaat', 'naziaat'], ['abasa'], ['takwir', 'takweer'], ['infitar', 'infitaar'],
  ['mutaffifin', 'mutaffifeen', 'tatfif'], ['inshiqaq', 'inshiqaaq'], ['buruj', 'burooj'], ['tariq', 'taariq'], ['ala', 'aala', 'alaa', 'ala'], ['ghashiyah', 'ghashiya', 'ghaashiyah'],
  ['fajr'], ['balad'], ['shams'], ['layl', 'lail'], ['duha', 'dhuha', 'duhaa'], ['sharh', 'inshirah', 'alam nashrah', 'sharah'], ['tin', 'teen'], ['alaq'],
  ['qadr'], ['bayyinah', 'bayyina', 'bayinah'], ['zalzalah', 'zilzal', 'zalzala', 'zilzaal'], ['adiyat', 'aadiyat', 'aadiyaat'], ['qariah', 'qaria', 'qaariah'],
  ['takathur', 'takaathur'], ['asr'], ['humazah', 'humaza'], ['fil', 'feel'], ['quraysh', 'quraish', 'quraish'], ['maun', 'maoon', 'maaoon'],
  ['kawthar', 'kausar', 'kauthar', 'kawsar'], ['kafirun', 'kafiroon', 'kafirun'], ['nasr'], ['masad', 'lahab', 'masadd'], ['ikhlas', 'ikhlaas', 'ikhlass'], ['falaq'], ['nas', 'naas'],
];

// Words that carry no meaning for matching.
const NOISE = new Set([
  'holy', 'quran', 'quraan', 'koran', 'recitation', 'recited', 'beautiful', 'full', 'by', 'with', 'english', 'translation', 'translated', 'hd', 'official',
  'audio', 'video', 'the', 'of', 'tilawat', 'tilawah', 'complete', 'emotional', 'heart', 'touching', 'sheikh', 'shaykh', 'qari', 'imam', 'new', 'and',
]);
const KEYWORDS = new Set(['surah', 'sura', 'surat', 'soorah', 'soora', 'surahs', 'ayat', 'ayah', 'ayaat', 'ayatul', 'verse', 'verses']);
const RECITERS = /shuraim|shuraym|sudais|sudays|husar[iy]|hussar[iy]|minshaw[iy]|abdul\s?bas[ie]t|abdulbas[ie]t|ghamd[iy]|ghamid[iy]|ajm[iy]|ajam[iy]|dos+ar[iy]|dus+ar[iy]|tablaw[iy]|rifa[iy]|r[ie]faa?[iy]|shatr[iy]|shaatr[iy]|jalil|jaleel|bukhatir|abkar|budair|bud[ae]ir|qatam[iy]|bas?far|thubait[iy]|akdar|banna|tunaij[iy]|nufais|neana|jabir|jaber|yasin\s?sahl|sahl\s?yasin|haneef|abbad|ayy?ub|juhan[iy]|muaiq?l[iy]|mueaq?l[iy]|luhaid[ai]n|lahid[ai]n|bandar|bal[ei]+la|h[uo](?:dh|th|z|d|t)[aey]+[iy]?f[iy]|الحذيفي|alafasy|afasy|afasi|el\s?afasi|m[ia]shar[iy]|mishary|mishari|sheikh|shaykh|sheik\b|الشيخ|القارئ|قارئ|عفاسي|العفاسي|العفاسى|مشاري|مشارى|السديس|الشريم|الحصري|المنشاوي|عبد الباسط|الغامدي|المعيقلي|العجمي|الدوسري|sudais|sudays|shuraim|shuraym|shureim|husary|hussary|minshawi|abdul\s?basit|abdulbasit|ghamdi|ghamidi|dosari|dossary|dosary|shatri|shaatree|ajmi|ajamy|qatami|luhaidan|lahidan|tablawi|rifai|hudhaify|huzaify|juhany|juhani|muaiqly|muaiqli|mueaqly|maher al|saad al ?ghamdi|ayyub|bandar|baleela|yasser al|qari|quran|qur'?an/i;

// Letter key that ignores spelling variation: "Al-Baqarah", "Baqara", "baqaraa" all collapse to the same thing.
function key(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`ʿʾ]/g, '')
    .replace(/[^a-z]+/g, '')
    .replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/ou/g, 'u')
    .replace(/(.)\1+/g, '$1'); // collapse doubled letters
}

const ARTICLES = ['adh', 'ath', 'ash', 'al', 'an', 'ar', 'as', 'at', 'ad', 'az', 'ag'];
const INDEX = new Map(); // key -> surah number
NAMES.forEach((variants, i) => variants.forEach((v) => { if (!INDEX.has(key(v))) INDEX.set(key(v), i + 1); }));

// Edit distance, giving up early once it passes `max`.
function dist(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// Closest known spelling: 1 slip allowed from 4 letters, 2 from 8. The winner must be unique and clearly closest.
function fuzzy(k, short) {
  const max = k.length >= 8 ? 2 : k.length >= 4 ? 1 : 0;
  if (!max) return 0;
  let best = max + 1, num = 0, tie = false;
  for (const [name, n] of INDEX) {
    if (name.length < (short ? 3 : 4)) continue;
    const d = dist(k, name, max);
    if (d < best) { best = d; num = n; tie = false; }
    else if (d === best && n !== num) tie = true;
  }
  return best <= max && !tie ? num : 0;
}

function lookup(words) {
  const k = key(words.join(''));
  if (!k) return 0;
  if (INDEX.has(k)) return INDEX.get(k);
  // "Al Baqarah" / "An-Nas": drop a leading article word, or one glued to the name ("Albaqarah").
  const rests = [];
  if (words.length > 1 && ARTICLES.includes(key(words[0]))) rests.push(key(words.slice(1).join('')));
  for (const a of ARTICLES) {
    const p = key(a);
    if (k.startsWith(p) && k.length > p.length) rests.push(k.slice(p.length));
  }
  for (const r of rests) if (INDEX.has(r)) return INDEX.get(r);
  for (const r of rests) { const n = fuzzy(r, true); if (n) return n; }
  return fuzzy(k, false);
}


// Arabic surah names (without the leading "ال"), 1 to 114, for titles written in Arabic: "سورة البقرة".
const ARABIC = 'الفاتحة,البقرة,آل عمران,النساء,المائدة,الأنعام,الأعراف,الأنفال,التوبة,يونس,هود,يوسف,الرعد,إبراهيم,الحجر,النحل,الإسراء,الكهف,مريم,طه,الأنبياء,الحج,المؤمنون,النور,الفرقان,الشعراء,النمل,القصص,العنكبوت,الروم,لقمان,السجدة,الأحزاب,سبأ,فاطر,يس,الصافات,ص,الزمر,غافر,فصلت,الشورى,الزخرف,الدخان,الجاثية,الأحقاف,محمد,الفتح,الحجرات,ق,الذاريات,الطور,النجم,القمر,الرحمن,الواقعة,الحديد,المجادلة,الحشر,الممتحنة,الصف,الجمعة,المنافقون,التغابن,الطلاق,التحريم,الملك,القلم,الحاقة,المعارج,نوح,الجن,المزمل,المدثر,القيامة,الإنسان,المرسلات,النبأ,النازعات,عبس,التكوير,الانفطار,المطففين,الانشقاق,البروج,الطارق,الأعلى,الغاشية,الفجر,البلد,الشمس,الليل,الضحى,الشرح,التين,العلق,القدر,البينة,الزلزلة,العاديات,القارعة,التكاثر,العصر,الهمزة,الفيل,قريش,الماعون,الكوثر,الكافرون,النصر,المسد,الإخلاص,الفلق,الناس'.split(',');
const arKey = (w) => String(w || '').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/^ال/, '').replace(/\s+/g, '');
const AR_INDEX = new Map(ARABIC.map((n, i) => [arKey(n), i + 1]));
// Arabic words in a title that name a surah. Two-letter names (ص, ق, يس) only count right after "سورة".
function arabicSurah(title) {
  const words = (String(title || '').match(/[\u0600-\u06FF]+/g) || []);
  for (let i = 0; i < words.length; i++) {
    const k = arKey(words[i]);
    if (!AR_INDEX.has(k)) continue;
    const afterKw = i > 0 && /^(سوره|سورة)$/.test(words[i - 1].replace(/[\u064B-\u065F]/g, '').replace(/ة/g, 'ه') ) || (i > 0 && /سور[ةه]/.test(words[i - 1]));
    if (k.length <= 2 && !afterKw) continue;
    return AR_INDEX.get(k);
  }
  return 0;
}

/* Which surah is this? Returns { surah } or null when the title doesn't look like a Quran
   recitation. Deliberately cautious: a normal song never matches. */
function detectRecitation(title, artist) {
  const t = String(title || '');
  const a = String(artist || '');
  if (!t.trim()) return null;

  if (/ayat(?:ul|\s*al|\s*ul)?[\s-]*(?:al[\s-]*)?kursi|ayatul[\s-]*kursi|آية الكرسي/i.test(t)) return { surah: 2, from: 255, to: 255 };

  const words = t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’`]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
  const kwAt = words.findIndex((w) => KEYWORDS.has(w));
  const hasKeyword = kwAt >= 0;
  const arKw = /سور[ةه]/.test(t);
  const hintedByTitle = hasKeyword || arKw || words.some((w) => w === 'quran' || w === 'quraan' || w === 'tilawat' || w === 'tilawah' || w === 'recitation');
  if (!hintedByTitle && !RECITERS.test(a)) return null; // "Ya Rahman" by a pop nasheed artist is not a recitation

  const arN = arabicSurah(t);
  const start = hasKeyword ? kwAt + 1 : 0;
  const rest = words.slice(start);

  // "Surah 36"
  if (hasKeyword && /^\d{1,3}$/.test(rest[0] || '')) {
    const n = parseInt(rest[0], 10);
    if (n >= 1 && n <= 114) return { surah: n };
  }

  // The name is one to three words in a row (articles like "al" / "ar" are part of those words).
  for (let i = 0; i < rest.length; i++) {
    if (NOISE.has(rest[i]) || /^\d+$/.test(rest[i])) continue;
    for (let len = Math.min(3, rest.length - i); len >= 1; len--) {
      const n = lookup(rest.slice(i, i + len));
      if (n) return { surah: n };
    }
  }
  return arN ? { surah: arN } : null;
}

// Adds an ayah range if the title has one: "(1-10)", "1 to 10", "ayah 255".
function detect(title, artist) {
  const r = detectRecitation(title, artist);
  if (!r) return null;
  if (r.from) return r; // Ayat al-Kursi
  const raw = String(title || '');
  const range = raw.match(/\b(\d{1,3})\s*(?:-|–|—|to)\s*(\d{1,3})\b/i);
  const one = raw.match(/\b(?:ayah|ayat|verse)s?\s*(\d{1,3})\b/i);
  if (range && +range[1] >= 1 && +range[1] <= +range[2]) { r.from = +range[1]; r.to = +range[2]; }
  else if (one) { r.from = r.to = +one[1]; }
  return r;
}

/* Builds plain lyrics text: each ayah in Arabic with its English translation below. */
function buildText(arabic, english, from, to) {
  const en = new Map((english || []).map((x) => [x.numberInSurah, x.text]));
  const pick = (arabic || []).filter((x) => (!from || x.numberInSurah >= from) && (!to || x.numberInSurah <= to));
  const rows = (pick.length ? pick : arabic || []).map((x) => {
    const lines = [`${x.text} ﴿${x.numberInSurah}﴾`];
    if (en.get(x.numberInSurah)) lines.push(en.get(x.numberInSurah));
    return lines.join('\n');
  });
  return rows.join('\n\n');
}


/* ---------- reciter timing (Quran.com) ---------- */

// Reciter as written in a title/artist -> how Quran.com spells the name.
const RECITER_MAP = [
  [/m[ia]shar[iy]|afas[iy]|العفاسي|العفاسى|مشاري|مشارى/i, /afas[iy]|mishar/i], [/sudais|sudays|السديس/i, /sudais|sudays/i], [/shuraim|shuraym|shureim|saud\s*(al|ash)|الشريم/i, /shuraim|shuraym|saud/i],
  [/husary|hussary|husari|الحصري/i, /husar/i], [/minshawi|minshawy/i, /minshaw/i], [/abdul\s?basit|abdulbasit|abdel\s?basit|abd\s?al[\s-]?basit/i, /basit|baset/i],
  [/ghamdi|ghamidi|الغامدي/i, /ghamd|ghamid/i], [/maher|muaiqly|mueaqly|muaiqli/i, /maher|muaiqly|mueaqly/i], [/ajmi|ajamy/i, /ajm/i],
  [/dosari|dossary|dosary|yasser/i, /dossar|dosar|yasser/i], [/h[uo](?:dh|th|z|d|t)[aey]+[iy]?f[iy]|الحذيفي/i, /h[uo](?:dh|th|z|d|t)[aey]+[iy]?f[iy]|الحذيفي/i], [/juhany|juhani/i, /juhan/i],
  [/shatri|shaatree/i, /shatri|shaatr/i], [/tablawi/i, /tablaw/i], [/ayyub/i, /ayyub|ayub/i], [/bandar|baleela/i, /bandar|balila|baleela/i],
];

// Spelling-proof form of a name: "Hudhaify", "Huthaifi" and "Huzaifi" all become the same thing.
function pkey(w) {
  return String(w || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ'’`ʿʾ]/g, '').replace(/[^a-z]/g, '')
    .replace(/sh/g, 's').replace(/kh/g, 'k').replace(/gh/g, 'g').replace(/ph/g, 'f').replace(/dh|th|zh|z/g, 'd').replace(/q/g, 'k').replace(/c(?=[ek])|c$/g, 'k')
    .replace(/ee|ea|ie|ei|ai|ay|ey|y/g, 'i').replace(/oo|ou|ow|o/g, 'u').replace(/(.)\1+/g, '$1');
}
// Words that are shared by many reciters and say nothing about which one it is.
const GENERIC = new Set(('al el ash as an ar at ad az ath adh abu abd abdul abdur abdulrahman abdurrahman bin ibn ben sheikh shaykh sheik shaikh qari qaari imam the of full surah sura ' +
  'muhammad mohammad mohamed muhammed mohammed ahmad ahmed ali mahmoud mahmud saad saud hani yasser khalid salah abdullah ibrahim nasser idrees omar umar hamza yusuf yousef').split(' '));
function nameTokens(text) {
  return String(text || '').split(/[^A-Za-zÀ-ɏ'’`ʿʾ]+/).map((w) => w.trim()).filter(Boolean);
}
const near = (a, b) => {
  if (a === b) return true;
  const m = Math.min(a.length, b.length);
  const max = m >= 8 ? 2 : m >= 4 ? 1 : 0;
  if (!max) return false;
  if (m === 4 && a[0] !== b[0]) return false; // very short names must at least start the same
  return dist(a, b, max) <= max;
};
// How well the name part `k` shows up in word `w` (which may be glued to others: "AbdulBaset", "Alqatami"):
// 1 for a match, 0.5 for a loose match inside a longer word, 0 for none.
const within = (k, w) => {
  if (near(k, w) || (k.length >= 3 && w.length > k.length && w.includes(k))) return 1;
  if (k.length < 4 || w.length < k.length + 3) return 0;
  for (let len = k.length - 1; len <= k.length + 1; len++) {
    for (let i = 0; i + len <= w.length; i++) if (near(k, w.slice(i, i + len))) return 0.5;
  }
  return 0;
};

/* Picks the Quran.com reciter id for a title/artist, or 0. `list` is the API's reciter list. Names are compared
   loosely, so any spelling of a reciter's family name finds them. */
function pickReciter(list, text) {
  const t = String(text || '');
  const wantsMujawwad = /mujawwad|mujawad/i.test(t);
  const score = (r) => {
    const n = `${r.name || ''} ${(r.style && r.style.name) || r.style || ''}`;
    let v = 0;
    if (/mujawwad|mujawad/i.test(n)) v += wantsMujawwad ? -2 : 2;
    if (/warsh|qalon|qaloon|douri|duri|shu.?ba/i.test(n)) v += 3;
    return v;
  };
  const best = (hits) => hits.slice().sort((a, b) => score(a) - score(b))[0].id;

  // 1. A few well-known spellings (including Arabic) written out.
  for (const [inRe, apiRe] of RECITER_MAP) {
    if (!inRe.test(t)) continue;
    const hits = (list || []).filter((r) => apiRe.test(`${r.name || ''} ${(r.translated_name && r.translated_name.name) || ''}`));
    if (hits.length) return best(hits);
  }

  // 2. Any reciter in the list: their distinctive name parts must show up (spelled loosely) in the title/artist.
  const raw = nameTokens(t);
  const words = raw.filter((w) => !GENERIC.has(w.toLowerCase())).map(pkey).filter(Boolean);
  const pool = words.slice();
  // "Abdul Basit" can be written "AbdulBasit": glue a title-word prefix to the word after it.
  for (let i = 0; i + 1 < raw.length; i++) if (/^(abdul|abdur|abd|abu|al|el|ash|as|ar|at|ad)$/i.test(raw[i])) pool.push(pkey(raw[i] + raw[i + 1]));
  let top = [], topN = 0;
  for (const r of list || []) {
    const parts = nameTokens(`${r.name || ''} ${(r.translated_name && r.translated_name.name) || ''}`).filter((w) => !GENERIC.has(w.toLowerCase()));
    const keys = [...new Set(parts.filter((p) => p.length >= 5).map(pkey).filter((k) => k.length >= 3))];
    const n = keys.reduce((sum, k) => sum + Math.max(0, ...pool.map((w) => within(k, w))), 0);
    if (n > topN) { topN = n; top = [r]; } else if (n === topN && n > 0) top.push(r);
  }
  return topN ? best(top) : 0;
}

const clock = (sec) => {
  const t = Math.max(0, sec);
  const m = Math.floor(t / 60);
  return `${String(m).padStart(2, '0')}:${(t - m * 60).toFixed(2).padStart(5, '0')}`;
};

/* Builds a timed .lrc: one entry per ayah (Arabic, then the translation on a second line inside the same entry).
   `stamps` are Quran.com timestamps ({ verse_key, timestamp_from, timestamp_to } in ms, relative to their own audio).
   `seconds` is the length of the track being played: it decides how to line the two recordings up. Returns null
   when too few ayahs have timing. */
function buildTimed(arabic, english, stamps, from, to, seconds, estimated) {
  const st = new Map();
  for (const x of stamps || []) {
    const n = Number(String(x.verse_key || '').split(':')[1]);
    if (n && x.timestamp_to > x.timestamp_from) st.set(n, x);
  }
  const en = new Map((english || []).map((x) => [x.numberInSurah, x.text]));
  const rows = (arabic || []).filter((x) => (!from || x.numberInSurah >= from) && (!to || x.numberInSurah <= to));
  const have = rows.filter((x) => st.has(x.numberInSurah));
  if (!have.length || have.length < rows.length * 0.6) return null;

  const base = st.get(have[0].numberInSurah).timestamp_from / 1000;
  const span = st.get(have[have.length - 1].numberInSurah).timestamp_to / 1000 - base;
  let shift = 0, scale = 1, origin = base;
  const d = (Number(seconds) || 0) - span;
  if (estimated) {
    // Another reciter's rhythm stretched over this track. A whole surah keeps that recording's own opening (from the file start).
    const whole = !from && !to;
    origin = whole ? 0 : base;
    const total = st.get(have[have.length - 1].numberInSurah).timestamp_to / 1000 - origin;
    if (!(Number(seconds) > 0 && total > 0)) return null;
    scale = seconds / total;
  } else if (Number(seconds) > 0 && span > 0) {
    if (d > 1.5 && d <= 45) shift = d;                         // the upload has an intro (opening words, silence)
    else if (Math.abs(d) / span >= 0.02 && Math.abs(d) / span <= 0.12) scale = seconds / span; // a slightly different pace
  }
  const lines = [estimated ? '[by:Quran.com timing (estimated)]' : '[by:Quran.com timing]'];
  for (const x of have) {
    const t = shift + ((st.get(x.numberInSurah).timestamp_from / 1000) - origin) * scale;
    const text = [`${x.text} ﴿${x.numberInSurah}﴾`, en.get(x.numberInSurah)].filter(Boolean).join('\u2028'); // one timed entry, shown on two lines
    lines.push(`[${clock(t)}]${text}`);
  }
  return lines.join('\n');
}

return { detect, buildText, buildTimed, pickReciter, key, NAMES };

});
