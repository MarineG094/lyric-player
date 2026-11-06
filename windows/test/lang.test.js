const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'renderer');
const lang = path.join(dir, 'lang');
const sources = ['index.html', 'i18n.js', 'app.js'].map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
const unescape = (s) => s.replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const load = (file) => { const w = { __lang: {} }; vm.runInNewContext(fs.readFileSync(path.join(lang, file), 'utf8'), { window: w }); return w.__lang; };

test('every bundled language file loads and uses real app text as its keys', () => {
  const files = fs.readdirSync(lang).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 1);
  const english = fs.readFileSync(path.join(lang, 'es.js'), 'utf8') && Object.keys(load('es.js').es);
  for (const f of files) {
    const code = f.replace(/\.js$/, '');
    const dict = load(f)[code];
    assert.ok(dict && Object.keys(dict).length > 50, `${f} defines a dictionary`);
    for (const [k, v] of Object.entries(dict)) {
      assert.ok(typeof v === 'string' && v.trim(), `${f}: "${k}" has a translation`);
      assert.ok(unescape(sources).includes(k) || sources.includes(k.replace(/'/g, "\\'")), `${f}: key "${k}" is not text the app shows`);
      assert.ok(!/\$\{|<|>/.test(v), `${f}: "${k}" has no markup or placeholders`);
    }
    assert.deepStrictEqual(Object.keys(dict).sort(), [...english].sort(), `${f} has the same keys as es.js`);
  }
});
