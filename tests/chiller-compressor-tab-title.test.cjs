const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'chiller', 'index.html'), 'utf8');

test('вкладка comp называется по результату расчёта', () => {
  assert.match(html, /<div class="ctab" data-t="comp">Требуемый объём компрессора<\/div>/);
  assert.doesNotMatch(html, /<div class="ctab" data-t="comp">Компрессор<\/div>/);
});

test('ключ comp и переходы на вкладку остаются рабочими', () => {
  assert.match(html, /else if \(calcTab === 'comp'\) b\.innerHTML = calcCompForm\(\)/);
  assert.match(html, /function calcToComp\(q\)/);
  assert.match(html, /calcTab = 'comp'; calcPaint\(\)/);
});

test('длинное название переносится вместе с полосой вкладок', () => {
  assert.match(html, /\.ctabs\{[^}]*display:flex;[^}]*flex-wrap:wrap[^}]*\}/s);
  assert.match(html, /\.ctab\{[^}]*white-space:nowrap[^}]*\}/s);
  assert.match(html, /\.ctab\{[^}]*flex:0 0 auto[^}]*\}/s);
});

test('названия кнопок подбора не переименованы', () => {
  assert.equal((html.match(/→ Подобрать компрессор/g) || []).length, 2);
  assert.equal((html.match(/→ Компрессоры в базе/g) || []).length, 1);
});
