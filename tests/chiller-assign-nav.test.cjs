// Подбор модели на схеме — конвейер по узлам (v2.45.1019): узел знает свою
// категорию в базе, модалка открывается сразу в ней, после назначения окно
// само идёт к следующему неназначенному. Резолвер категории гоняем настоящим
// кодом на фейковых SECTIONS: id-шники пакета базы могут меняться, поэтому
// категория ищется по русским именам разделов.
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

// реальный резолвер + парсер мощности на фейковой базе
function sandbox(SECTIONS) {
  const code =
    slice('function asgResolveCat(nd){', 'function asgSecName(id){') +
    'return {asgResolveCat, asgKw};';
  return new Function('SECTIONS', code)(SECTIONS);
}

const FAKE_SECTIONS = [
  ['compressors', 'Компрессоры', [['scroll', 'Спиральные'], ['piston', 'Поршневые']]],
  ['heat_exchanger', 'Теплообменники', [['cond', 'Конденсаторы воздушные'], ['plate', 'Пластинчатые (ПТО)'], ['fan', 'Вентиляторы']]],
  ['vessels', 'Аппараты', [['recv', 'Ресиверы'], ['filt', 'Фильтры-осушители'], ['sep', 'Отделители жидкости']]],
  ['valves', 'Арматура', [['trv', 'ТРВ'], ['sol', 'Соленоидные клапаны'], ['serv', 'Сервисные'], ['check', 'Обратные клапаны']]],
  ['auto', 'Автоматика', [['psw', 'Реле давления'], ['gauge', 'Манометры'], ['flow', 'Реле потока']]],
  ['pumps', 'Насосы', []],
  ['heat', 'Электронагрев', [['block', 'Блоки нагревателей'], ['elem', 'ТЭНы и термостаты']]],
];

test('категория узла резолвится по именам разделов, а не по id', () => {
  const { asgResolveCat } = sandbox(FAKE_SECTIONS);
  const cat = (c) => asgResolveCat({ cat: c });
  assert.deepEqual(cat(['компрессор', 'спираль']), { sec: 'compressors', sub: 'scroll' });
  assert.deepEqual(cat(['теплообмен', 'испарител|пластинчат|пто']), { sec: 'heat_exchanger', sub: 'plate' });
  assert.deepEqual(cat(['аппарат|арматур', 'фильтр']), { sec: 'vessels', sub: 'filt' });
  assert.deepEqual(cat(['арматур|клапан', 'обратн']), { sec: 'valves', sub: 'check' });
  assert.deepEqual(cat(['автоматик', 'проток|реле поток']), { sec: 'auto', sub: 'flow' });
  // раздел без подразделов — берём только раздел
  assert.deepEqual(cat(['насос', null]), { sec: 'pumps', sub: null });
  // подраздел не нашёлся — падаем на раздел, а не в «Все»
  assert.deepEqual(cat(['арматур', 'такого-нет']), { sec: 'valves', sub: null });
  // раздела нет — честный null, модалка уходит в старый hint-поиск
  assert.deepEqual(cat(['марсоходы', 'колёса']), { sec: null, sub: null });
  assert.deepEqual(asgResolveCat({}), { sec: null, sub: null });
});

test('у каждого из 24 узлов схемы задана категория', () => {
  const nodes = slice('const SCH_NODES=[', 'const SCH_DESC={');
  const keys = nodes.match(/\{k:'(\w+)'/g).map((m) => m.slice(4, -1));
  assert.equal(keys.length, 24);
  for (const k of keys) {
    const row = nodes.slice(nodes.indexOf("{k:'" + k + "'"));
    assert.match(row.slice(0, 200), / cat:\[/, 'нет категории у узла ' + k);
  }
});

// v2.45.1020: наш блок нагревателя AG-10.000.000 — это не нагреватель картера
// и не вентилятор; ни один узел схемы не должен приводить в «Блоки нагревателей».
test('ЕК1 и М1 не приводят в «Блоки нагревателей»', () => {
  const { asgResolveCat } = sandbox(FAKE_SECTIONS);
  const nodes = slice('const SCH_NODES=[', 'const SCH_DESC={');
  const catOf = (k) => {
    const row = nodes.slice(nodes.indexOf("{k:'" + k + "'"));
    const m = /cat:\[([^\]]*)\]/.exec(row.slice(0, 300));
    return eval('[' + m[1] + ']');
  };
  assert.deepEqual(asgResolveCat({ cat: catOf('EK1') }), { sec: 'heat', sub: 'elem' });
  assert.deepEqual(asgResolveCat({ cat: catOf('M1') }), { sec: 'heat_exchanger', sub: 'fan' });
  const keys = nodes.match(/\{k:'(\w+)'/g).map((m) => m.slice(4, -1));
  for (const k of keys) {
    const r = asgResolveCat({ cat: catOf(k) });
    assert.notDeepEqual(r, { sec: 'heat', sub: 'block' }, 'узел ' + k + ' зовёт блок нагревателя');
    assert.notDeepEqual(r, { sec: 'heat', sub: null }, 'узел ' + k + ' валится во весь «Электронагрев»');
  }
});

test('пустая категория узла говорит об этом прямо', () => {
  const dl = slice('function drawAsgList()', "$('#asgQ')&&");
  assert.match(dl, /emptyCat/);
  assert.match(dl, /В базе 3D пока нет позиций/);
});

test('мощность читается из тегов вида «10,2 кВт»', () => {
  const { asgKw } = sandbox(FAKE_SECTIONS);
  assert.equal(asgKw({ tags: ['R407C', 'пайка', '10,2 кВт'] }), 10.2);
  assert.equal(asgKw({ tags: ['7.4 кВт · пайка'] }), 7.4);
  assert.equal(asgKw({ tags: ['1/4" пайка'] }), 0);
  assert.equal(asgKw({}), 0);
});

test('конвейер: после назначения окно идёт к следующему неназначенному', () => {
  const as = slice('function assignTo(d)', 'function drawAsgList()');
  assert.match(as, /const next=asgNextUn\(\);/);
  assert.match(as, /if\(next\)openAssign\(next\);/);
  assert.match(as, /дальше: /);                       // тост говорит, куда перешли
  assert.match(as, /все узлы назначены/);
});

test('навигация на месте: лента узлов, стрелки, прогресс, клавиатура', () => {
  assert.match(src, /id="asgStrip"/);
  assert.match(src, /id="asgPrev"/);
  assert.match(src, /id="asgNext"/);
  assert.match(src, /id="asgJump"/);
  assert.match(src, /id="asgProg"/);
  assert.match(src, /id="asgCrumbs"/);
  assert.match(src, /id="asgFit"/);
  const kb = slice("document.addEventListener('keydown',(e)=>{  // клавиатура конвейера", '});');
  assert.match(kb, /ArrowLeft/);
  assert.match(kb, /ArrowRight/);
  assert.match(kb, /'Tab'/);
  assert.match(kb, /'Enter'/);
  assert.match(kb, /'Escape'/);
  // лента: клик по любому узлу открывает его подбор
  assert.match(src, /#asgStrip \.nd'\)\.forEach\(el=>el\.onclick=\(\)=>openAssign\(el\.dataset\.k\)\)/);
});

test('полка «подходит сюда» и группа «уже в проекте» строятся из базы', () => {
  const dl = slice('function drawAsgList()', "$('#asgQ')&&");
  assert.match(dl, /asgUsedIds\(\)/);
  assert.match(dl, /УЖЕ В ПРОЕКТЕ/);
  assert.match(dl, /Подходит сюда/);
  assert.match(dl, /под лист 7 кВт/);
  assert.match(dl, /вся база/);                        // переключатель охвата поиска
  assert.match(dl, /категория узла/);                  // возврат к рекомендованной категории
});
