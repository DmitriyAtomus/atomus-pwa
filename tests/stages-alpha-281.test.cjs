const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const a1 = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
const i = a1.indexOf('function _sortStagesRu(list)');
const j = a1.indexOf('async function _loadWorkStages()', i);
const ctx = {};
vm.runInNewContext(a1.slice(i, j) + '\nthis.sort = _sortStagesRu;', ctx);

test('этапы — по алфавиту (ru), «Прочее» в конце, исходный массив не меняется', () => {
  const src = ['Сборка', 'Установка конденсатора в корпус чиллера', 'Прочее', 'Вакуумирование фреоновой системы',
    'Подготовка к тесту', 'Монтаж сплит системы', 'ёмкость тест', 'Изготовление рамы', 'Заправка холодильного агрегата']
    .map((name, k) => ({ id: k + 1, name }));
  const out = ctx.sort(src).map(s => s.name).join(' | ');
  assert.equal(out, 'Вакуумирование фреоновой системы | ёмкость тест | Заправка холодильного агрегата | ' +
    'Изготовление рамы | Монтаж сплит системы | Подготовка к тесту | Сборка | ' +
    'Установка конденсатора в корпус чиллера | Прочее');
  assert.equal(src[0].name, 'Сборка');
});

test('сортировка подключена во всех местах каталога этапов, чек-лист не трогаем', () => {
  assert.match(a1, /const stages = _sortStagesRu\(_myday\.stages \|\| \[\]\);/);
  assert.match(a1, /cache\._workStages = _sortStagesRu\(r\.items \|\| \[\]\);/);
  assert.match(a1, /const chips = _sortStagesRu\(stages \|\| \[\]\)\.map/);
  const a2 = fs.readFileSync(path.join(root, 'app-2.js'), 'utf8');
  assert.match(a2, /cache\._workStages = \(typeof _sortStagesRu === 'function'\) \? _sortStagesRu/);
  assert.match(a1, /wstg\.map\(st => \{/, 'нумерованный чек-лист — в своём порядке');
});

test('чипы переносятся, без горизонтальной прокрутки', () => {
  assert.match(css, /\.myday-modal \{ overflow-x: hidden; \}/);
  assert.match(css, /\.myday-chip, \.stage-picker-modal \.stage-chip \{\s*white-space: normal; overflow-wrap: anywhere; max-width: 100%;/);
});
