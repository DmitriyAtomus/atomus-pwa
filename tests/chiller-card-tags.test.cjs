// Карточка позиции базы (v2.45.1024): мощность из тегов — голубым бейджем у
// бренда, остальные теги — чипами, LOD ушёл в карточку ⓘ. Один и тот же ряд
// живёт в витрине базы, поиске и подборе на схеме.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const src = fs.readFileSync(path.join(__dirname, '..', 'chiller', 'project.html'), 'utf8');

function slice(from, to) {
  const i = src.indexOf(from);
  assert.ok(i >= 0, 'не найдено: ' + from);
  const j = src.indexOf(to, i);
  assert.ok(j > i, 'не найден конец: ' + to);
  return src.slice(i, j);
}

// настоящий catRow на заглушках: hlt/esc — простые, геометрия — фейковая
function render(d) {
  const code = slice('function catRow(d,add,tk){', 'function bindInfo(box,acts)') +
    'return catRow(d, "+");';
  return new Function('d', 'esc', 'hlt', 'GEOMS', 'tagLine', code)(
    d, (v) => String(v), (v) => String(v), { g1: { f: 't' } },
    (x) => (x.tags || []).slice(0, 4).join(' · '));
}

test('мощность уходит в бейдж и не дублируется в чипах', () => {
  const h = render({ id: 'a', g: 'g1', name: 'YH69T1-100', brand: 'Invotech',
    kind: 'Спиральный', tags: ['R407C', 'пайка', '6,3 кВт'] });
  assert.match(h, /<i class="kwb">6,3 кВт<\/i>/);
  assert.match(h, /<span class="tgs"><i>R407C<\/i><i>пайка<\/i><\/span>/);
  assert.ok(!/tgs.*кВт/.test(h), 'кВт не должен повторяться среди чипов');
});

test('без мощности — просто чипы, без пустого бейджа', () => {
  const h = render({ id: 'b', g: 'g1', name: 'DML 305S', brand: 'Ридан',
    kind: 'Фильтр', tags: ['1/4"', 'пайка'] });
  assert.ok(!h.includes('kwb'), 'пустой бейдж мощности');
  assert.match(h, /<i>1\/4"<\/i>/);
});

test('LOD в строке списка больше не показываем', () => {
  const row = slice('function catRow(d,add,tk){', 'function bindInfo(box,acts)');
  assert.ok(!row.includes("' · LOD '"), 'LOD остался в строке — он живёт в карточке ⓘ');
});
