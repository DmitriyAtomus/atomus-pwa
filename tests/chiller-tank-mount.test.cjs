const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'chiller', 'project.html'), 'utf8');
const start = html.indexOf('const SH_T=0;');
const end = html.indexOf('function tankShelfPlan', start);
assert.ok(start > 0 && end > start, 'блок прямого крепления бака найден');

const THREE = { Vector3: class { constructor() { this.x = this.y = this.z = 0; } } };
const api = new Function('THREE',
  html.slice(start, end) +
  '\nreturn {tankBracketRows,tankEndHolePair,tankEndHoleFit,shelfCutOf,tankWallFace,tankWallCenter};'
)(THREE);

const box = (x0, x1, y0, y1) => ({
  min: { x: x0, y: y0 },
  max: { x: x1, y: y1 },
  getCenter(v) { v.x = (x0 + x1) / 2; v.y = (y0 + y1) / 2; return v; },
});
const rear = { nm: '00.000.002 Стойка', des: '', b: box(-447, -372, -300, -225) };
const front = { nm: 'AG-41.000.001 Стойка', des: '', b: box(-447, -272, 219, 294) };
const sidePanel = box(-447, -427, -244, 238);
const left = { a: 'x', s: -1, t: 'левой' };

test('штатный корпус использует торцевые Ø7 бака напротив двух стоек', () => {
  const holes = api.tankBracketRows({
    d: { id: 'user:frame', name: 'AG-41.000.000СБ Корпус чиллера' },
  }, rear, front, left);
  assert.deepEqual(holes, {
    support: 250,
    low: 663,
    top: 663,
    rows: null,
    fixed: true,
    direct: true,
    posts: true,
    marks: 'торцевые Ø7 бака: ±258.8 мм, отм. 663',
  });
  assert.deepEqual(api.tankBracketRows({ d: { id: 'chiller-600x900' } },
    rear, front, { a: 'x', s: 1 }), { unsupported: true },
    'стенка со щитом по-прежнему запрещена');
  assert.equal(api.tankBracketRows({ d: { id: 'custom-frame' } },
    rear, front, left), null);
});

test('разворот +90° совмещает торцевые отверстия STEP с задней и передней стойками', () => {
  const pair = api.tankEndHolePair(Math.PI / 2, -306.25, -3, 250);
  assert.deepEqual(pair.map(h => h.p), [
    [-392.95, -261.8, 663],
    [-392.95, 255.8, 663],
  ]);
  assert.equal(api.tankEndHoleFit(pair, rear, front), true,
    'оба отверстия лежат в металле своих стоек');

  const mirrored = api.tankEndHolePair(Math.PI * 3 / 2, -306.25, -3, 250);
  assert.equal(api.tankEndHoleFit(mirrored, rear, front), false,
    'зеркальный разворот уносит ряд отверстий мимо стоек');

  const cut = api.shelfCutOf({ endHoles: pair });
  assert.deepEqual(cut.bo, [
    [-392.95, -261.8, 663],
    [-392.95, 255.8, 663],
  ]);
  assert.deepEqual(cut.bd, [[0, -1], [0, 1]], 'болты идут наружу в обе стойки');
  for (const key of ['pl', 'lg', 'bk', 'dg', 'st', 'pd'])
    assert.deepEqual(cut[key], [], key + ' отсутствует');
});

test('бак прижат к внутренней плоскости левой панели', () => {
  const parts = [
    { name: rear.nm },
    { name: front.nm },
    { name: '00.000.007 Панель боковая' },
  ];
  const boxes = [rear.b, front.b, sidePanel];
  const postFace = Math.max(rear.b.max.x, front.b.max.x);
  assert.equal(api.tankWallFace(parts, boxes, left, -450, postFace), -427);
  const center = api.tankWallCenter(-427, 1, 210, 0);
  assert.equal(center, -321.5);
  assert.equal(center - 105 - (-427), 0.5, 'видимого воздушного зазора нет');
});

test('интерфейс и BOM описывают крепление к стойкам без изготовляемого узла', () => {
  assert.match(html, /Развернуть отверстиями к стойкам/);
  assert.match(html, /два торцевых Ø7/);
  assert.match(html, /wall:'left-posts'/);
  assert.match(html, /kind:'tank-post-holes'/);
  assert.match(html, /boltAx:best\.w/);
  assert.match(html, /Болт М6×35, шайба широкая, гайка самоконтрящаяся/);
  assert.match(html, /sh\.v>=4&&\(sh\.bo\|\|\[\]\)\.length/);
  assert.match(html, /\[0,Math\.PI\/2,Math\.PI,Math\.PI\*3\/2\]/,
    'проверяются оба зеркальных разворота бака');
  assert.doesNotMatch(html, /Кронштейн рамный бака, лист/);
  assert.doesNotMatch(html, /Стяжка бака П-образная/);
  assert.doesNotMatch(html, /Пластина ответная 40×400×3/);
});

test('прежняя посадка в панель мигрирует на стойки и сохраняется', () => {
  const load = html.slice(html.indexOf('async function loadProjectData(data){'),
                          html.indexOf('async function openProject(id){'));
  assert.match(load, /if\(!sh\|\|sh\.v>=5\)return;/);
  assert.match(load, /tankShelfPut\(p,\{quiet:true\}\)/);
  assert.match(load, /schemaMoved\|\|tankMountMoved/);

  const history = html.slice(html.indexOf('async function histApply(snapshot)'),
                             html.indexOf('async function histGo(back)'));
  assert.match(history, /sh:it\.link\.sh\?JSON\.parse\(JSON\.stringify\(it\.link\.sh\)\):undefined/,
    'undo/redo не теряет прямые болты');
});

/* Проект грузится по одной детали, и бак может приехать раньше корпуса. */
test('крепление бака переживает перезагрузку проекта', () => {
  const reseat = html.slice(html.indexOf('function reseatLink(it){'),
                            html.indexOf('function linkSel('));
  assert.match(reseat, /if\(!fr\)\{if\(!_loading\)it\.link=null;return;\}/);
  const load = html.slice(html.indexOf('async function loadProjectData(data){'),
                          html.indexOf('async function openProject(id){'));
  assert.match(load, /sh:p\.link\.sh/);
});
