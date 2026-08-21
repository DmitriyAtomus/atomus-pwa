// Каталог номенклатуры во весь экран (v2.45.1025): кнопка «⛶ каталог» /
// Ctrl+K, дерево раздел → подраздел, крупные карточки, сравнение до трёх
// позиций и полка «по схеме назначено, а в сцене не стоит».
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

// настоящий расчёт полки «не хватает» на фейках
function needList(data, schema, placed, nodes) {
  const code = slice('function nomNeedList(data,schema,placedArr,schNodes){', 'function nomOpenCat()') +
    'return nomNeedList(data,schema,placedArr,schNodes);';
  return new Function('data', 'schema', 'placedArr', 'schNodes', code)(data, schema, placed, nodes);
}

const DATA = [
  { id: 'trv', name: 'TN2', brand: 'Danfoss', ready: true },
  { id: 'flt', name: '4316/2', brand: 'Castel', ready: true },
  { id: 'old', name: 'нет в паке', ready: false },
];
const NODES = [{ k: 'TRV1', t: 'ТРВ1' }, { k: 'F1', t: 'Ф1' }, { k: 'KM1', t: 'КМ1' }];

test('полка «не хватает»: назначено и готово, но не стоит в сцене', () => {
  const need = needList(DATA,
    { TRV1: { id: 'trv' }, F1: { id: 'flt' }, KM1: { id: 'old' } },
    [{ id: 'flt' }], NODES);
  // ТРВ назначен и не стоит — в полке; фильтр стоит — нет; неготовая позиция — нет
  assert.equal(need.length, 1);
  assert.equal(need[0].tag, 'ТРВ1');
  assert.equal(need[0].d.id, 'trv');
});

test('пустая схема или всё расставлено — полки нет', () => {
  assert.equal(needList(DATA, {}, [], NODES).length, 0);
  assert.equal(needList(DATA, { TRV1: { id: 'trv' } }, [{ id: 'trv' }], NODES).length, 0);
});

test('каталог подключён: кнопка, оверлей, дерево, сравнение, Ctrl+K', () => {
  assert.match(src, /id="nomOpen"[^>]*Ctrl\+K/);
  assert.match(src, /id="nom"/);
  assert.match(src, /id="nomNav"/);
  assert.match(src, /id="nomNeedRow"/);
  assert.match(src, /id="nomCmpGo"/);
  assert.match(src, /ПО СХЕМЕ ПРОЕКТА НЕ ХВАТАЕТ В СЦЕНЕ/);
  const kb = slice("document.addEventListener('keydown',(e)=>{   // клавиши каталога", '},true);');
  assert.match(kb, /'k','K','л','Л'/);
  assert.match(kb, /Escape/);
  assert.match(kb, /stopPropagation\(\)/);   // хоткеи сцены не срабатывают под оверлеем
});

test('карточки и постановка идут через существующие механизмы', () => {
  const dn = slice('function drawNom(){', 'function nomCompare(){');
  assert.match(dn, /fillThumbsIn\('#nomGrid'\)/);            // настоящие превью
  assert.match(dn, /openDesc\(d,\[\{t:'\+ Добавить в сцену'/); // карточка ⓘ
  assert.match(dn, /показать ещё/);                           // пагинация, не молчаливый срез
  const put = slice('async function nomPut(d,tag){', 'function nomCard(d){');
  assert.match(put, /await addItem\(d\)/);                    // та же расстановка по функции
});

test('сравнение: лучшая мощность подсвечена, ставится из таблицы', () => {
  const c = slice('function nomCompare(){', "$('#nomOpen').onclick");
  assert.match(c, /Отметь «⚖» хотя бы на двух/);
  assert.match(c, /best/);
  assert.match(c, /data-a2/);
});
