const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'klava-pick.js'), 'utf8');

test('на телефоне вместо системного select открывается аккуратный выбор темы', () => {
  assert.match(source, /class="kp-topic-open" id="kp-topic-open"/);
  assert.match(source, /class="kp-topic-picker hidden" id="kp-topic-picker"/);
  assert.match(source, /\.kp-topic select\{display:none\}/);
  assert.match(source, /\.kp-topic-open\{[^}]*display:flex/s);
  assert.match(source, /<div class="kp-topic-group">Общие темы/);
  assert.match(source, /<div class="kp-topic-group">Мои идеи/);
  assert.match(source, /kp-topic-choice' \+ \(KP\.tid === t\.id \? ' active' : ''\)/);
});

test('жёлтый кругляшок переносится долгим нажатием и помнит место', () => {
  assert.match(source, /fab\.addEventListener\('pointerdown'/);
  assert.match(source, /if \(innerWidth > 640\) return;/);
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]{0,180}d\.dragging = true/);
  assert.match(source, /\}, 320\);/);
  assert.match(source, /fab\.addEventListener\('pointermove'/);
  assert.match(source, /KP\._saveFabPosition\(\)/);
  assert.match(source, /localStorage\.setItem\(KP\._fabPositionKey\(\), JSON\.stringify\(\{ x:/);
  assert.match(source, /KP\._restoreFabPosition\(\)/);
  assert.match(source, /touch-action:none/);
  assert.match(source, /fab\.addEventListener\('contextmenu'/);
});
