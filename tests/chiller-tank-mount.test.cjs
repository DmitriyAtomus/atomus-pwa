const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'chiller', 'project.html'), 'utf8');
const meshJs = fs.readFileSync(path.join(__dirname, '..', 'chiller', 'tank-oem-brackets.js'), 'utf8');
const mesh = JSON.parse(meshJs.slice(meshJs.indexOf('=') + 1, meshJs.lastIndexOf(';')));
const start = html.indexOf('const SH_T=2;');
const end = html.indexOf('function tankShelfPlan', start);
assert.ok(start > 0 && end > start, 'блок заводского крепления бака найден');

const THREE = { Vector3: class { constructor() { this.x = this.y = this.z = 0; } } };
const api = new Function('THREE',
  html.slice(start, end) +
  '\nreturn {tankBracketRows,tankPostHoleSet,tankPostHoleFit,shelfCutOf,tankWallFace,tankWallCenter};'
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

test('штатный корпус использует четыре Ø7 бака и два нижних кронштейна', () => {
  const holes = api.tankBracketRows({
    d: { id: 'user:frame', name: 'AG-41.000.000СБ Корпус чиллера' },
  }, rear, front, left, 36);
  assert.deepEqual(holes, {
    support: 250,
    low: 262.5,
    top: 660,
    rows: null,
    fixed: true,
    direct: true,
    baseDrop: 14,
    posts: true,
    brackets: true,
    marks: '4 × Ø7 в стойки · 2 кронштейна снизу',
  });
  assert.deepEqual(api.tankBracketRows({ d: { id: 'chiller-600x900' } },
    rear, front, { a: 'x', s: 1 }, 36), { unsupported: true },
    'стенка со щитом по-прежнему запрещена');
  assert.equal(api.tankBracketRows({ d: { id: 'custom-frame' } },
    rear, front, left, 36), null);
});

test('разворот +90° совмещает по два отверстия с каждой стойкой', () => {
  const holes = api.tankPostHoleSet(Math.PI / 2, -306.25, -3, 250);
  assert.deepEqual(holes.map(h => h.p), [
    [-402.55, -232, 262.5],
    [-402.55, -232, 660],
    [-402.55, 226, 262.5],
    [-402.55, 226, 660],
  ]);
  assert.deepEqual(holes.map(h => h.d), new Array(4).fill([-1, 0]));
  assert.equal(api.tankPostHoleFit(holes, rear, front), true,
    'по два отверстия лежат в металле каждой стойки');

  const mirrored = api.tankPostHoleSet(Math.PI * 3 / 2, -306.25, -3, 250);
  assert.equal(api.tankPostHoleFit(mirrored, rear, front), false,
    'зеркальный разворот уносит ряд отверстий мимо стоек');

  const cut = api.shelfCutOf({ a: 'x', w: 'y', dir: 1, ca: -321.5,
    cw: -3, fw: 525, z: 250, postHoles: holes, holes: { baseDrop: 14 } });
  assert.deepEqual(cut.bo, holes.map(h => h.p));
  assert.deepEqual(cut.bd, new Array(4).fill([-1, 0]));
  assert.equal(cut.br.length, 4, 'две пластины и две стойки кронштейнов');
  assert.deepEqual(cut.br[0], {
    x0: -305.5, x1: -205.5, y0: -280.5, y1: -255.5, z0: 36, z1: 38,
  });
  assert.deepEqual(cut.br[1], {
    x0: -278, x1: -233, y0: -280.5, y1: -265.5, z0: 38, z1: 275,
  });
  assert.equal(cut.bm.length, 4, 'по два М6 на каждом кронштейне');
  assert.deepEqual(cut.bm.slice(0, 2), [
    [-265, -265.5, 262.5], [-246, -265.5, 262.5],
  ], 'М6 сохраняют заводское положение с внутренней стороны бака');
  assert.deepEqual(cut.bmd.slice(0, 2), [[0, -1, 0], [0, -1, 0]]);
  assert.equal(cut.b8.length, 4, 'по два М8 в раму на каждом кронштейне');
  assert.deepEqual(cut.b8.slice(0, 2), [
    [-288, -265.5, 38], [-223, -265.5, 38],
  ], 'М8 проходят через отверстия опорной пластины в нижнюю раму');
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

test('интерфейс и BOM описывают заводской узел со стойками и кронштейнами', () => {
  assert.match(html, /Закрепить как в AG-04/);
  assert.match(html, /4 × М6 к стойкам/);
  assert.match(html, /wall:'left-posts-brackets'/);
  assert.match(html, /kind:'tank-oem-brackets-step'/);
  assert.match(html, /boltAx:best\.a/);
  assert.match(html, /Кронштейн бака, тип AG-04\.002\.000СБ/);
  assert.match(html, /Комплект М6×14 DIN 7045 \+ гайка М6 · бак → стойки/);
  assert.match(html, /Комплект М6×14 DIN 7045 \+ гайка и шайбы · бак → кронштейны/);
  assert.match(html, /Комплект М8×20 ГОСТ 11738-84 \+ гайка и шайбы · кронштейны → рама/);
  assert.match(html, /pc\.set\(SH_BRACKET/);
  assert.match(html, /const sh=\{v:9/);
  assert.match(html, /const baseDrop=Math\.max\(0,support-SH_OEM_BASE_DROP-zFloor\)/,
    'до листа опускается низ кронштейна, а не бак');
  assert.match(html, /tankOemBracketGeo\(sh\.baseDrop\)/);
  assert.match(html, /pos\[i\+2\]=z<-150\?z-baseDrop:z/,
    'нижняя прямая часть удлиняется без сдвига верхних отверстий');
  assert.match(html, /exactStepAssembly='AG-04\.002\.000СБ'/);
  assert.match(html, /\[0,Math\.PI\/2,Math\.PI,Math\.PI\*3\/2\]/,
    'проверяются оба зеркальных разворота бака');
  assert.doesNotMatch(html, /М6×35/);
  assert.doesNotMatch(html, /торцевые Ø7/);
});

test('меш кронштейнов и крепежа взят из исходного STEP, а не нарисован брусками', () => {
  assert.match(html, /<script src="tank-oem-brackets\.js"><\/script>/);
  assert.equal(mesh.assembly, 'AG-04.002.000СБ Кронштейн');
  assert.equal(mesh.source_sha256,
    '6eff48df98e966c23c675859a4677453b7d9cd2cd6aa3c4d6afb5f546d903da1');
  assert.deepEqual(mesh.bodies, [4, 44], '4 листовых тела и 44 тела штатного крепежа');
  assert.equal(mesh.n_tri, 27952);
  assert.equal(mesh.groups[0][1], 3200 * 3, 'первая группа — точные тела кронштейнов');
  assert.equal(mesh.groups[1][1], 24752 * 3, 'вторая группа — штатный крепёж');
  assert.deepEqual(mesh.lo, [-105.549, -277.5, -213.6]);

  const posBuf = Buffer.from(mesh.pos, 'base64');
  const pos16 = new Uint16Array(posBuf.buffer, posBuf.byteOffset, posBuf.byteLength / 2);
  const ixBuf = Buffer.from(mesh.idx, 'base64');
  const index = new Uint16Array(ixBuf.buffer, ixBuf.byteOffset, ixBuf.byteLength / 2);
  const point = i => [0, 1, 2].map(a => mesh.lo[a] + pos16[i * 3 + a] * mesh.scale[a]);
  const bounds = group => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const [start, count] = mesh.groups[group];
    for (let i = start; i < start + count; i++) point(index[i]).forEach((v, a) => {
      lo[a] = Math.min(lo[a], v); hi[a] = Math.max(hi[a], v);
    });
    return [lo.map(v => +v.toFixed(3)), hi.map(v => +v.toFixed(3))];
  };
  const closeBounds = (actual, expected, message) => {
    actual.flat().forEach((v, i) => assert.ok(Math.abs(v - expected.flat()[i]) < 0.015,
      `${message}: координата ${i}, ${v} ≠ ${expected.flat()[i]}`));
  };
  closeBounds(bounds(0), [[16, -277.5, -200], [116, 277.5, 25]],
    'точные листовые тела стоят с внутренней стороны и перекрывают бак на 25 мм');
  closeBounds(bounds(1), [[-105.549, -269.988, -213.6], [106.5, 269.988, 416]],
    'крепёж включает четыре М6 к стойкам, четыре М6 к кронштейнам и четыре М8');
});

test('прежняя посадка мигрирует на точную STEP-геометрию и сохраняется', () => {
  const load = html.slice(html.indexOf('async function loadProjectData(data){'),
                          html.indexOf('async function openProject(id){'));
  assert.match(load, /if\(!sh\|\|sh\.v>=9\)return;/);
  assert.match(load, /tankShelfPut\(p,\{quiet:true\}\)/);
  assert.match(load, /schemaMoved\|\|tankMountMoved/);

  const history = html.slice(html.indexOf('async function histApply(snapshot)'),
                             html.indexOf('async function histGo(back)'));
  assert.match(history, /sh:it\.link\.sh\?JSON\.parse\(JSON\.stringify\(it\.link\.sh\)\):undefined/,
    'undo/redo не теряет кронштейны и крепёж');
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
