// The What's new notes: every note must be visible somewhere, and ids must count down from the top.
const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('../renderer/whatsnew.js');
const notes = global.window.__whatsnew;

test('no item is flagged both desktop and mobile (that hides it everywhere)', () => {
  for (const e of notes) for (const i of e.items) assert.ok(!(i.desktop && i.mobile), `note ${e.id}: "${i.text.slice(0, 40)}" has both flags`);
});
test('every note shows on at least one platform, and ids are newest first with no repeats', () => {
  const shows = (e, desktop) => e.items.filter((i) => (!i.desktop || desktop) && (!i.mobile || !desktop)).length;
  for (const e of notes) assert.ok(shows(e, true) + shows(e, false) > 0, `note ${e.id} shows nowhere`);
  for (let k = 1; k < notes.length; k++) assert.ok(notes[k - 1].id > notes[k].id, `ids out of order at ${notes[k].id}`);
});
