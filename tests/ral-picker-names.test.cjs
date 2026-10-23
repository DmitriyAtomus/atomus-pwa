// Выбор цвета по-человечески: у каждого RAL есть русское название и группа
// (белые / серые / чёрные / цветные), а поиск ищет и по слову, и по коду.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-4.js'), 'utf8');

function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.notEqual(start, -1, `Не найдено начало секции: ${from}`);
  assert.notEqual(end, -1, `Не найден конец секции: ${to}`);
  return source.slice(start, end);
}

const ctx = {};
vm.runInNewContext(
  section('const RAL_CATALOG = [', '// Марки материалов приходят с бэкенда') +
  '\nthis.cat = RAL_CATALOG; this.name = _ralName; this.label = _ralLabel; this.hex = _ralHex;',
  ctx
);

test('у каждого цвета есть название и группа', () => {
  assert.ok(ctx.cat.length >= 30);
  ctx.cat.forEach(r => {
    assert.match(r.c, /^RAL \d{4}$/, `плохой код: ${r.c}`);
    assert.ok(r.n && r.n.length > 2, `нет названия у ${r.c}`);
    assert.ok(['Белые', 'Серые', 'Чёрные', 'Цветные'].includes(r.g), `нет группы у ${r.c}`);
    assert.match(r.h, /^#[0-9A-F]{6}$/i, `нет цвета у ${r.c}`);
  });
});

test('серый и белый находятся словом, а не кодом', () => {
  const find = (q) => ctx.cat.filter(r =>
    (r.c + ' ' + r.n + ' ' + r.g).toLowerCase().includes(q));
  assert.ok(find('сер').length >= 8, 'серых должно быть видно');
  assert.ok(find('бел').length >= 6, 'белых должно быть видно');
  assert.ok(find('чёрн').length >= 3, 'чёрные должны находиться');
  assert.equal(find('9016').length, 1);
});

test('подпись цвета показывает и код, и слово', () => {
  assert.equal(ctx.label('RAL 9016'), 'RAL 9016 · транспортный белый');
  assert.equal(ctx.name('RAL 7035'), 'светло-серый');
  assert.equal(ctx.label('RAL 1234'), 'RAL 1234'); // чужой код не ломает подпись
  assert.equal(ctx.name(''), '');
});

test('первыми в списке идут белые и серые, а не жёлтый', () => {
  assert.equal(ctx.cat[0].c, 'RAL 9016');
  const groups = [...new Set(ctx.cat.map(r => r.g))];
  assert.deepEqual(groups, ['Белые', 'Серые', 'Чёрные', 'Цветные']);
});

test('в палитре есть поиск, заголовки групп и подписи под кодом', () => {
  const picker = section('function openPaintRalPicker(', 'function closeRalPicker()');
  assert.ok(picker.includes('ral-search'), 'нет строки поиска');
  assert.ok(picker.includes('data-search'), 'ячейки нечем фильтровать');
  assert.ok(picker.includes('ral-group-title'), 'нет заголовков групп');
  assert.ok(picker.includes('ral-name'), 'нет названия цвета в ячейке');
  const filter = section('function _ralFilter(', 'async function _pickRal');
  assert.ok(filter.includes('dataset.search'), 'фильтр не ищет по названию');
});
