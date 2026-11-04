const test = require('node:test');
const assert = require('node:assert');
const R = require('../renderer/romanize.js');

test('Hindi reads like everyday Hinglish', () => {
  const cases = {
    'चला': 'chala', 'चल': 'chal', 'राही': 'rahi', 'दिल': 'dil', 'बहुत': 'bahut', 'समझ': 'samajh', 'प्यार': 'pyar',
    'ज़िंदगी': 'zindagi', 'कहानी': 'kahani', 'मेरा': 'mera', 'मित्र': 'mitr', 'धड़कन': 'dharkan', 'मैं': 'main', 'हूँ': 'hoon',
    'यूँ': 'yoon', 'सुनहरा': 'sunahra', 'ज्ञान': 'gyan', 'कमल': 'kamal', 'ही': 'hi',
  };
  for (const [hi, en] of Object.entries(cases)) assert.strictEqual(R.hindiWord(hi), en, hi);
});

test('whole lines keep timestamps and get a capital letter', () => {
  assert.strictEqual(R.text('[00:12.50] यूँ ही चला चल राही'), '[00:12.50] Yoon hi chala chal rahi');
  assert.strictEqual(R.text('ता मा, ता नी\nउ उ उ'), 'Ta ma, ta ni\nU u u');
});

test('Latin-script lyrics are left exactly as they are', () => {
  const s = '[00:01.00] Jo tere ishq mein behka\nCafé señor';
  assert.strictEqual(R.text(s), s);
});

test('other scripts are converted to Latin letters', () => {
  assert.match(R.text('Привет мир'), /^[\x00-\x7f]+$/);
  assert.match(R.text('사랑해'), /^[\x00-\x7f]+$/);
  assert.match(R.text('こんにちは'), /konnichiha/i);
});

test('Quran text (Arabic with a translation) is not converted', () => {
  const s = 'بِسْمِ اللَّهِ ﴿1﴾\nIn the name of Allah';
  assert.strictEqual(R.text(s), s);
  assert.strictEqual(R.needsRomanizing(s), false);
});
