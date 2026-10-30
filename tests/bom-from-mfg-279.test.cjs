const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'app-2.js'), 'utf8');
const a = src.indexOf('// [bfm-pure-start]');
const b = src.indexOf('// [bfm-pure-end]');
assert.ok(a > 0 && b > a, 'секция «Из корпусов» найдена');
const ctx = {};
vm.runInNewContext(src.slice(a, b) +
  '\nthis.f = { _bfmIsAisiModel, _bfmExec, _bfmArticle, _bfmLabel, _bfmLineText, _bfmBuildLines, _bfmMerge, _bfmNoParts, _bfmExpandParts };', ctx);
const f = ctx.f;

const KORPUS = { id: 1, designation: 'AG-02.000.000СБ', name: 'Корпус воздухоохладителя', variant: 'BS-TEF 043M ED' };
const PARTS = [
  { designation: 'AG-02.000.001', name: 'Кожух', qty: 1, material: 'Лист 08Х18Н10 ГОСТ 5582-75' },
  { designation: 'AG-02.001.002', name: 'Диффузор', qty: 2, material: 'лист 1' },
  { designation: 'AG-02.000.009', name: 'Уголок', qty: 4, material: 'Лист Ст3сп ГОСТ 16523-97' },
];

test('кнопка «Из корпусов» стоит в тех. карте рядом с «Импорт BOM»', () => {
  const i = src.indexOf("'<i class=\"ti ti-clipboard-data\"></i> Импорт BOM'");
  const j = src.indexOf("Из корпусов' +", i);
  assert.ok(i > 0 && j > i && j - i < 800);
  assert.match(src, /onclick="openBomFromMfg\(' \+ modelId/);
});

test('AISI модели и исполнение по материалу', () => {
  assert.equal(f._bfmIsAisiModel({ name: 'НВП-15-380-AISI' }), true);
  assert.equal(f._bfmIsAisiModel({ name: 'НВП 204', exec_fixed: 'нерж.' }), true);
  assert.equal(f._bfmIsAisiModel({ name: 'НВП 204' }), false);
  assert.equal(f._bfmExec('Лист 08Х18Н10 ГОСТ 5582-75', false), 'stainless');
  assert.equal(f._bfmExec('12X18H10T', false), 'stainless');
  assert.equal(f._bfmExec('Лист Ст3сп ГОСТ 16523-97', true), 'standard');
  assert.equal(f._bfmExec('лист 1', true), 'stainless');
  assert.equal(f._bfmExec('', false), 'standard');
});

test('одной позицией: строка с артикулом, названием и исполнением модели', () => {
  const lines = f._bfmBuildLines([{ item: KORPUS, qty: 2 }], 'whole', true);
  assert.equal(lines.length, 1);
  assert.equal(f._bfmLineText(lines[0], lines[0].qty),
    '(2N) AG-02.000.000 AG-02.000.000СБ Корпус воздухоохладителя BS-TEF 043M ED');
});

test('с деталями: количество × число корпусов, одинаковые детали складываются', () => {
  const k2 = { id: 2, designation: '', name: 'AG-14.000.005C LUN Корпус', variant: '' };
  const lines = f._bfmBuildLines([
    { item: KORPUS, qty: 3, parts: PARTS },
    { item: k2, qty: 1, parts: [{ designation: 'AG-02.001.002', name: 'Диффузор', qty: 1, material: '' }] },
  ], 'parts', true);
  const txt = Array.from(lines, l => f._bfmLineText(l, l.qty));
  assert.deepEqual(txt, [
    '(3N) AG-02.000.001 AG-02.000.001 Кожух',
    '(7N) AG-02.001.002 AG-02.001.002 Диффузор',
    '(12) AG-02.000.009 AG-02.000.009 Уголок',
  ]);
  assert.equal(lines[1].sources.length, 2, 'видно, из каких корпусов деталь');
});

test('v2.46.280: с деталями — корпус без деталей НЕ подставляется общей строкой', () => {
  const sel = [{ item: KORPUS, qty: 1, parts: [] }];
  const lines = f._bfmBuildLines(sel, 'parts', false);
  assert.equal(lines.length, 0);
  assert.deepEqual(Array.from(f._bfmNoParts(sel)), ['AG-02.000.000СБ Корпус воздухоохладителя BS-TEF 043M ED']);
  assert.equal(f._bfmNoParts([{ item: KORPUS, qty: 1, parts: PARTS }]).length, 0);
});

test('v2.46.280: «С деталями» — режим по умолчанию и первая кнопка', () => {
  assert.match(src, /mode: 'parts', q: '', sel: \{\}/);
  const i = src.indexOf("> С деталями</button>");
  const j = src.indexOf("> Одной позицией</button>");
  assert.ok(i > 0 && j > i);
});

test('v2.46.280: вложенные подсборки раскрываются до деталей с умножением', async () => {
  const items = {
    1: { id: 1, designation: 'AG-25.000.000СБ', parts: [
      { designation: 'AG-25.000.001', name: 'Балка', qty: 5, material: 'Лист 08Х18Н10' },
      { designation: 'AG-25.010.000СБ', name: 'Крышка в сборе', qty: 2 },
    ] },
    2: { id: 2, designation: 'AG-25.010.000СБ', parts: [
      { designation: 'AG-25.010.001', name: 'Крышка верхняя', qty: 1 },
      { designation: 'AG-25.011.000', name: 'Узел', qty: 3 },
    ] },
    3: { id: 3, designation: 'AG-25.011.000', parts: [
      { designation: 'AG-25.011.001', name: 'Балка верхняя', qty: 2 },
    ] },
    // одно-детальное изделие, где деталь = само изделие — не зацикливаемся
    4: { id: 4, designation: 'AG-01.000.001', parts: [{ designation: 'AG-01.000.001', name: 'Ванна', qty: 1 }] },
  };
  const idx = { 'AG-25.000.000': 1, 'AG-25.010.000': 2, 'AG-25.011.000': 3, 'AG-01.000.001': 4 };
  const getItem = async (id) => items[id];
  const flat = await f._bfmExpandParts(items[1], getItem, idx, [], 0);
  assert.deepEqual(flat.map(p => p.designation + '×' + p.qty).join(','),
    'AG-25.000.001×5,AG-25.010.001×2,AG-25.011.001×12');
  const self = await f._bfmExpandParts(items[4], getItem, idx, [], 0);
  assert.equal(self.map(p => p.designation + '×' + p.qty).join(','), 'AG-01.000.001×1');
  // петля A→B→A не вешает
  const loop = { 5: { id: 5, designation: 'AG-50.000.000', parts: [{ designation: 'AG-51.000.000', qty: 1 }] },
                 6: { id: 6, designation: 'AG-51.000.000', parts: [{ designation: 'AG-50.000.000', qty: 2 }] } };
  const r = await f._bfmExpandParts(loop[5], async id => loop[id], { 'AG-50.000.000': 5, 'AG-51.000.000': 6 }, [], 0);
  assert.equal(r.map(p => p.designation + '×' + p.qty).join(','), 'AG-50.000.000×2');
});

test('предпросмотр: уже имеющаяся позиция — количество складывается', () => {
  const lines = f._bfmBuildLines([{ item: KORPUS, qty: 2, parts: PARTS }], 'parts', true);
  const parsed = [
    { match: 'exact', component: { id: 10, name: 'AG-02.000.001 Кожух' }, parsed: { name: 'AG-02.000.001 Кожух' } },
    { match: 'none', component: null, parsed: { name: 'AG-02.001.002 Диффузор' } },
    { match: 'wrong_execution', component: { id: 30, name: 'Уголок' }, parsed: { name: 'AG-02.000.009 Уголок' } },
  ];
  const bom = [
    { component_id: 10, component_name: 'AG-02.000.001 Кожух', qty_required: 1 },
    { component_id: 20, component_name: 'AG-02.001.002 Диффузор', qty_required: 4 },
    { child_model_id: 5, qty_required: 1 },
  ];
  const rows = f._bfmMerge(lines, parsed, bom, { acceptWrong: true, createMissing: true });
  assert.equal(rows[0].status, 'exact');
  assert.equal(rows[0].existing, 1);
  assert.equal(rows[0].final, 3);
  assert.equal(rows[0].text, '(3N) AG-02.000.001 AG-02.000.001 Кожух');
  assert.equal(rows[1].status, 'create');
  assert.equal(rows[1].final, 8, 'новая по имени уже есть в тех. карте → 4 + 4');
  assert.equal(rows[2].status, 'wrong');
  assert.equal(rows[2].final, 8);

  const strict = f._bfmMerge(lines, parsed, bom, { acceptWrong: false, createMissing: false });
  assert.equal(strict[1].status, 'skip');
  assert.equal(strict[2].status, 'skip');
  assert.equal(strict[2].text, '');
});

test('две строки на одну позицию номенклатуры складываются по очереди', () => {
  const lines = [
    { art: 'AG-1.1.1', label: 'AG-1.1.1 A', exec: 'standard', qty: 2, sources: [] },
    { art: 'AG-1.1.2', label: 'AG-1.1.2 B', exec: 'standard', qty: 3, sources: [] },
  ];
  const parsed = [
    { match: 'exact', component: { id: 7 } },
    { match: 'exact', component: { id: 7 } },
  ];
  const rows = f._bfmMerge(lines, parsed, [{ component_id: 7, qty_required: 1 }], {});
  assert.equal(rows[0].final, 3);
  assert.equal(rows[1].existing, 3);
  assert.equal(rows[1].final, 6);
});

test('мобильная вёрстка окна прописана', () => {
  const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
  assert.match(css, /#bfm-modal \.bfm-sheet \{ max-width: 100% !important; height: 94vh; height: 94dvh;/);
  assert.match(css, /#bfm-modal \.bfm-search \{ font-size: 16px; \}/);
});
