// Склад → Готовая продукция (v2.46.158): карточка модели читается словами —
// «Всего / В резерве / Свободно», статус «Всё в резерве», строка резерва
// объясняет, можно ли отгружать. Гоняем настоящую _renderFpRow.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const app3 = fs.readFileSync(path.join(__dirname, '..', 'app-3.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');

function render() {
  const i = app3.indexOf('function _renderFpRow(it) {');
  const j = app3.indexOf('// ---- Обработчики тулбара ----', i);
  assert.ok(i >= 0 && j > i);
  const code = app3.slice(i, j);
  return new Function('escapeHtml', '_plural', code + 'return _renderFpRow;')(
    x => String(x), (n, f) => f[n === 1 ? 0 : 1]);
}
const base = { model_id: 1, model_name: 'УДФ-1', direction_name: 'Увлажнение', assemblies_count: 2,
  age_category: 'fresh', oldest_age_days: 3 };

test('всё в резерве: три строки, статус, «отгрузить другому нельзя»', () => {
  const h = render()({ ...base, total_qty: 2, free_qty: 0, reserved_qty: 2,
    reservations: [{ contract_number: '№17АГ/08.26', contractor_name: 'ВС-ХОЛОД ООО' }] });
  assert.match(h, /<span>Всего<\/span><b>2 шт<\/b>/);
  assert.match(h, /В резерве<\/span><b>2<\/b>/);
  assert.match(h, /Свободно<\/span><b>0<\/b>/);
  assert.match(h, /fp2-av av-res">Всё в резерве</);
  assert.match(h, /Все 2 шт заняты под договор №17АГ\/08\.26 · ВС-ХОЛОД ООО — отгрузить другому клиенту нельзя/);
  assert.doesNotMatch(h, /св\.<\/small>/);   // старое «0 св.» ушло
});

test('одна штука в резерве — без «все 1 шт»', () => {
  const h = render()({ ...base, total_qty: 1, free_qty: 0, reserved_qty: 1, assemblies_count: 1,
    reservations: [{ contract_number: '20ТД/08.26' }] });
  assert.match(h, /Единственная штука занята под договор №20ТД\/08\.26/);
});

test('часть в резерве: «2 из 3 шт заняты — остальные можно отгружать»', () => {
  const h = render()({ ...base, total_qty: 3, free_qty: 1, reserved_qty: 2, assemblies_count: 3,
    reservations: [{ contract_number: '5' }, { contract_number: '6' }] });
  assert.match(h, /fp2-av av-mix">Часть в резерве</);
  assert.match(h, /2 из 3 шт заняты под договор №5 — остальные можно отгружать/);
  assert.match(h, /\+1 дог\./);
});

test('все свободны: статус и «Свободно все N»', () => {
  const h = render()({ ...base, total_qty: 2, free_qty: 2, reserved_qty: 0, reservations: [] });
  assert.match(h, /fp2-av av-free">Свободно</);
  assert.match(h, /Свободно<\/span><b>все 2<\/b>/);
  assert.doesNotMatch(h, /В резерве/);
});

test('стили: колонка расширена, статус и строки описаны', () => {
  assert.match(css, /\.fp-row\.fp2 \{\s*grid-template-columns: 12px 1fr 124px/);
  assert.match(css, /\.fp2-l\.res/);
  assert.match(css, /\.fp2-av\.av-res/);
  assert.match(css, /\.fp2-q\.zero \.fp2-l\.free \{ color: #B91C1C/);
});
