const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'chiller', 'project.html'), 'utf8');
const start = html.indexOf('const SH_T=3;');
const end = html.indexOf('function tankShelfPlan', start);
assert.ok(start > 0 && end > start, 'блок крепления бака найден');

const api = new Function(
  html.slice(start, end) + '\nreturn {tankBracketRows,shelfCutOf,tankWallCenter};'
)();

const box = (x0, x1, y0, y1) => ({
  min: { x: x0, y: y0 },
  max: { x: x1, y: y1 },
});
const rear = { nm: '00.000.002 Стойка', des: '', b: box(-447, -372, -300, -225) };
const front = { nm: 'AG-41.000.001 Стойка', des: '', b: box(-447, -372, 225, 300) };
const left = { a: 'x', s: -1, t: 'левой' };

test('штатный корпус крепит бак изнутри левой стенки к передней и задней стойкам', () => {
  const rows = api.tankBracketRows({
    d: { id: 'user:frame', name: 'AG-41.000.000СБ Корпус чиллера' },
  }, rear, front, left);
  assert.deepEqual(rows, {
    support: 250,
    low: 268,
    top: 663,
    rows: [
      { low: 283, top: 663, lowMark: 250, topMark: 630, label: 'задняя стойка' },
      { low: 268, top: 648, lowMark: 235, topMark: 615, label: 'передняя стойка' },
    ],
    fixed: true,
    marks: 'передняя стойка 235/615, задняя стойка 250/630',
  });
  assert.deepEqual(api.tankBracketRows({ d: { id: 'chiller-600x900' } },
    rear, front, { a: 'x', s: 1 }), { unsupported: true },
    'прежняя правая стенка со щитом запрещена');
  assert.deepEqual(api.tankBracketRows({ d: { id: 'chiller-600x900' } },
    { nm: 'стойка из STEP (17)' }, { nm: 'стойка из STEP (42)' }, left), rows,
    'ряды определяются по стороне и координате, даже если STEP испортил имена');
  assert.equal(api.tankBracketRows({ d: { id: 'custom-frame' } },
    { nm: 'custom post' }, { nm: 'custom post' }, left), null);
});

test('узел состоит из двух рамных кронштейнов, диагоналей и верхней стяжки', () => {
  const cut = api.shelfCutOf({
    a: 'x', w: 'y', P0: rear, P1: front, face: -372, dir: 1,
    cw: 0, ca: -266, fw: 525, fa: 200, off: 0,
    z: 250, zTop: 663, zBolt: 268,
    rows: [
      { low: 283, top: 663 },
      { low: 268, top: 648 },
    ],
  });
  assert.equal(cut.pl.length, 2, 'две нижние опоры');
  assert.equal(cut.lg.length, 2, 'две вертикальные полосы');
  assert.equal(cut.bk.length, 2, 'две ответные пластины');
  assert.equal(cut.dg.length, 2, 'две диагонали');
  assert.equal(cut.st.length, 3, 'П-образная стяжка: поперечина и два уха');
  assert.equal(cut.pd.length, 2, 'EPDM под обеими опорами');
  assert.equal(cut.bo.length, 4, 'по два штатных болта на стойку');
  assert.deepEqual(cut.bo.map(p => p[2]), [283, 663, 268, 648]);
  assert.deepEqual(cut.dg.map(d => d.p1[2]), [663, 648],
    'каждая диагональ приходит в верхнее отверстие своей стойки');
});

test('бак целиком находится внутри левой стенки', () => {
  const face = -372;
  const center = api.tankWallCenter(face, 1, 200, 0);
  assert.equal(center, -266);
  assert.ok(center - 100 > face, 'наружная грань бака не выходит за внутреннюю грань стоек');
});

test('команда и спецификация называют изготовляемый узел полностью', () => {
  assert.match(html, /▤ Закрепить бак/);
  assert.match(html, /Боковые рамные кронштейны[\s\S]{0,120}левая стенка изнутри/);
  assert.match(html, /передняя стойка Ø7 235\/615, задняя Ø7 250\/630/);
  assert.match(html, /wall:'left-inside'/);
  assert.match(html, /Кронштейн рамный бака, лист/);
  assert.match(html, /Стяжка бака П-образная 30×2/);
  assert.match(html, /Пластина ответная 40×400×3/);
  assert.match(html, /Комплект прокладок EPDM 3 мм/);
  assert.match(html, /Болт М6×35, 2 шайбы, гайка самоконтрящаяся/);
});

/* Проект грузится по одной детали, и бак приезжает раньше корпуса. refresh()
   внутри addItem не находил корпус, рвал связь бака — и вместе со связью
   пропадало крепление на стойках: после F5 бак снова лежал на дне. */
test('крепление бака переживает перезагрузку проекта', () => {
  const reseat = html.slice(html.indexOf('function reseatLink(it){'),
                            html.indexOf('function linkSel('));
  assert.match(reseat, /if\(!fr\)\{if\(!_loading\)it\.link=null;return;\}/,
    'пока проект грузится, связь бака не рвём');
  const face = html.slice(html.indexOf('function faceMate(it){'),
                          html.indexOf('function faceMate(it){') + 260);
  assert.match(face, /if\(!fr\)\{if\(!_loading\)it\.link=null;return false;\}/,
    'та же ловушка у приборов на лицевой панели');

  const load = html.slice(html.indexOf('async function loadProjectData(data){'),
                          html.indexOf('async function openProject(id){'));
  assert.match(load, /sh:p\.link\.sh/,
    'при переносе uid-ов крепление бака (link.sh) не теряется');
});
