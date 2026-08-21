// Подбор фильтра-осушителя внутри проекта (chiller/project.html).
// Раньше подбор был только в витрине базы: подобрал — запомнил артикул —
// вернулся в проект — нашёл руками. Теперь он открывается кнопкой в шапке
// проекта, мощность подставляется с компрессора, который уже стоит в сцене,
// а выбранная строка сразу добавляет фильтр в компоновку.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'chiller', 'project.html'), 'utf8');

function section(from, to) {
  const a = page.indexOf(from);
  const b = page.indexOf(to, a);
  assert.notEqual(a, -1, 'не нашёл начало блока: ' + from);
  assert.notEqual(b, -1, 'не нашёл конец блока: ' + to);
  return page.slice(a, b);
}

// фильтр ровно в том виде, в каком его отдаёт /api/3d/index
const DML = {
  id: '023Z5058R', name: 'DML 083S 023Z5058R', brand: 'Ридан', ready: true,
  section: 'vessels', sub: 'filt', lod: 400,
  kind: 'Герметичный фильтр-осушитель с твёрдым сердечником DML 083S, '
    + 'присоединительный размер 10 мм, под пайку',
  tags: ['DML 083S', '10 мм пайка ODF', 'жидкостная линия', 'R404A/R507 7,7 кВт',
    'R407C 11 кВт', 'R410A 11,3 кВт', 'R134a 10,9 кВт', 'R22 11,2 кВт'],
  pick: {
    k: 'filt', ser: 'DML', line: 'liq', ex: 'odf', conn: '10 мм',
    what: 'фильтр-осушитель с твёрдым сердечником',
    cap: { 'R404A/R507': 7.7, R407C: 11, R410A: 11.3, R134a: 10.9, R22: 11.2 },
  },
  g: 'line-023Z5058R',
};
const DCR = {                       // разборный корпус: киловатт у него нет
  id: '023U7071R', name: 'DCR 19211s 023U7071R', brand: 'Ридан', ready: true,
  kind: 'Корпус разборного фильтра DCR 19211s', tags: ['DCR 19211s'],
  pick: { k: 'filt', ser: 'DCR', line: 'liq', ex: 'odf', conn: '1"3/8', cap: {} },
  g: 'line-023U7071R',
};
const COMP = {                      // компрессор в сцене: с него берут мощность
  id: 'YH104T1-100', name: 'YH104T1-100', brand: 'Invotech', ready: true,
  section: 'compressors', sub: 'scroll', tags: ['R407C', 'пайка', '10,2 кВт'],
  g: 'yh-small-418',
};

test('кнопка подбора стоит в шапке проекта и открывает окно', () => {
  assert.match(page, /<button class="back" id="bFlt"/);
  assert.match(page, /\$\('#bFlt'\)\.onclick=fltOpen;/);
  assert.match(page, /<div id="flt"><div class="flt-card">/);
  // Esc закрывает подбор, а не сбрасывает выделение в сцене
  const keys = section("addEventListener('keydown'", 'function roleOf');
  assert.match(keys, /if\(\$\('#flt'\)\.classList\.contains\('on'\)\)\{fltClose\(\);return;\}/);
});

test('подбор идёт по индексу базы, без обращения к серверу', () => {
  const flt = section("const FLT={ref:'R404A/R507'", '/* ═══ каталог базы');
  assert.ok(!/fetch\(/.test(flt), 'подбор полез на сервер — данные уже есть в индексе');
  assert.match(flt, /DATA\.filter\(d=>d\.ready&&d\.pick&&d\.pick\.k==='filt'\)/);
  // строка выдачи ставит фильтр в сцену, «ⓘ» открывает карточку
  assert.match(flt, /fltClose\(\);addItem\(d\);/);
  assert.match(flt, /openDesc\(d,\[\{t:'\+ Добавить в сцену'/);
});

test('подпись фильтра несёт киловатты по всем хладагентам', () => {
  const ctx = { };
  vm.createContext(ctx);
  vm.runInContext(section('function tagLine(d)', 'function secNames()'), ctx);
  const line = ctx.tagLine(DML);
  ['R404A/R507 7,7', 'R407C 11', 'R410A 11,3', 'R134a 10,9', 'R22 11,2'].forEach(x =>
    assert.ok(line.includes(x), 'в подписи нет ' + x));
  assert.ok(line.includes('жидкостная'), 'не видно, на какую линию фильтр');
  assert.ok(line.includes('10 мм пайка ODF'), 'не видно присоединения');
  // у разборного корпуса киловатт нет — так и пишем, а не молчим
  assert.ok(ctx.tagLine(DCR).includes('по числу вставок'), 'корпус DCR остался без пояснения');
  // остальным позициям подпись не меняли
  assert.equal(ctx.tagLine(COMP), 'R407C · пайка · 10,2 кВт');
});

test('мощность берётся с компрессора, который уже стоит в сцене', () => {
  const ctx = { placed: [{ d: COMP }, { d: COMP }, { d: DML }] };
  vm.createContext(ctx);
  vm.runInContext(section('function fltScene()', 'function fltFrom(refs)'), ctx);
  const list = ctx.fltScene();
  assert.equal(list.length, 1, 'один и тот же компрессор попал в чипы дважды');
  assert.equal(list[0].id, 'YH104T1-100');
  assert.equal(list[0].q, 10.2);
  assert.equal(list[0].ref, 'R407C');
});
