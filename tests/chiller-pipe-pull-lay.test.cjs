// Автопротяжка трубы: сама укладка (chiller/project.html, задача #909).
// Проверяем не арифметику трассы, а результат в сцене: отрезки садятся на
// присоединения, отвод довёрнут, длины подрезаны на вылет фитингов, и конец
// трубы приходит ровно в плоскость прилегания второго патрубка.
// Стенд живой: rotMate, setPipeLen и pullRun берутся прямо со страницы,
// THREE — тот самый chiller/three.min.js, разметка — выдержка из индекса базы.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'chiller', 'project.html'), 'utf8');
const THREE = require(path.join(root, 'chiller', 'three.min.js'));
const base = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'chiller-pipe-pull.fixture.json'), 'utf8'));

function section(from, to) {
  const a = page.indexOf(from);
  const b = page.indexOf(to, a);
  assert.notEqual(a, -1, 'не нашёл начало блока: ' + from);
  assert.notEqual(b, -1, 'не нашёл конец блока: ' + to);
  return page.slice(a, b);
}

/* Сцена без браузера: настоящие посадка на патрубок, длина отрезка и
   протяжка; вместо меша — пустой Object3D с габаритом позиции из базы. */
function stand() {
  const code = section('const CT_NAME=', 'function rotClear()') +
               section('/* Посадить деталь: её ось ложится', 'function rotOff(it)') +
               section('const PIPE_MIN=20', 'function pullStart(it,zi)') +
               // pipeLen объявлена через const — вытаскиваем её наружу
               ';this.pipeLen=pipeLen;this.isPipeSeg=isPipeSeg;';
  const ctx = {
    THREE,
    DATA: base.items,
    GEOMS: base.geoms,
    placed: [],
    scene: new THREE.Object3D(),
    sel: null,
    toasts: [],
    localStorage: { getItem: () => null, setItem: () => {} },
    $: () => null,
    console,
    R2D: (r) => (r * 180) / Math.PI,
    roleOf: (d) => (d.section === 'pipe' ? 'pipe' : 'floor'),
    select() {},
    refresh() {},
    save() {},
    checkCollisions() {},
    showSelZ() {},
    pushHist() {},
    histBegin: () => false,
    histEnd() {},
    rotRebuild() {},
  };
  ctx.toast = (t) => ctx.toasts.push(t);
  ctx.window = ctx;
  let uid = 100;
  ctx.addItem = async (d, at) => {
    const g = base.geoms[d.g], bb = g.bb;
    const obj = new THREE.Object3D();
    obj.geometry = {
      boundingBox: {
        min: new THREE.Vector3(bb.lo[0], bb.lo[1], bb.lo[2]),
        max: new THREE.Vector3(bb.hi[0], bb.hi[1], bb.hi[2]),
      },
    };
    obj.position.set(at.x, at.y, at.z);
    ctx.scene.add(obj);
    const it = { uid: uid++, id: d.id, obj, d, pin: false, link: null, off: [],
                 zn: (g.zn || []).filter((z) => z && z.tip) };
    ctx.placed.push(it);
    return it;
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
}

/* аппарат с одним раструбом Ø25 под сварку PP-R: труба садится в него прямо */
function host(S, pos, rotY) {
  const obj = new THREE.Object3D();
  obj.position.set(pos[0], pos[1], pos[2]);
  if (rotY) obj.rotation.y = rotY;
  if (rotY === undefined && pos[0] > 0) obj.rotation.z = Math.PI;
  S.scene.add(obj);
  const it = {
    uid: S.placed.length + 1, id: 'AP' + S.placed.length, obj, pin: false, link: null, off: [],
    d: { id: 'AP', name: 'аппарат', section: 'vessels', ready: true },
    zn: [{ kind: 'suc', name: 'ВЫХОД', od: 34.5, p0: [0, 0, 0], dir: [1, 0, 0],
           tip: [30, 0, 0], ctype: 'ppr', sex: 'f', conn: 'Ø25 сварка PP-R', seat: 20 }],
  };
  S.placed.push(it);
  return it;
}

const world = (S, it, zi) => S.rotSeatLocal(it.zn[zi]).applyMatrix4(
  (it.obj.updateMatrixWorld(true), it.obj.matrixWorld));
const tubes = (S) => S.placed.filter((p) => S.isPipeSeg(p));
const elbows = (S) => S.placed.filter((p) => /Угольник/i.test(p.d.name || ''));

test('прямая трасса: один отрезок от плоскости до плоскости', async () => {
  const S = stand();
  const a = host(S, [0, 0, 0]);                 // раструб смотрит по +X, точка x=20
  const b = host(S, [1000, 0, 0]);              // развёрнут на 180°, точка x=980
  await S.pullRun(S.pullPort(a, 0), S.pullPort(b, 0));
  assert.equal(S.placed.length, 3, S.toasts.join(' | '));
  const t = tubes(S);
  assert.equal(t.length, 1);
  assert.equal(S.pipeLen(t[0]), 960);
  // дальний конец отрезка пришёл ровно в плоскость прилегания второго патрубка
  const end = S.rotSeatLocal(t[0].zn[1]).applyMatrix4(
    (t[0].obj.updateMatrixWorld(true), t[0].obj.matrixWorld));
  assert.ok(end.distanceTo(world(S, b, 0)) < 1, 'конец трубы в ' + JSON.stringify(end));
  assert.match(S.toasts.join(' '), /трасса прямая/);
});

test('Г-образная трасса: два отрезка, отвод в углу довёрнут по трассе', async () => {
  const S = stand();
  const a = host(S, [0, 0, 0], 0);              // раструб по +X от точки (20,0,0)
  const b = host(S, [1000, 0, 600], Math.PI / 2); // раструб смотрит вниз, точка (1000,0,580)
  const pa = S.pullPort(a, 0), pb = S.pullPort(b, 0);
  assert.deepEqual([pb.d.x, pb.d.y, pb.d.z].map(Math.round), [0, 0, -1]);
  await S.pullRun(pa, pb);
  assert.equal(S.placed.length, 5, S.toasts.join(' | '));   // 2 аппарата + 2 трубы + отвод
  const t = tubes(S), el = elbows(S);
  assert.equal(t.length, 2);
  assert.equal(el.length, 1);
  // угол трассы — на пересечении осей патрубков (1000, 0, 0)
  const pr = S.elbowPair(el[0].zn);
  const corner = S.rotSeatLocal(el[0].zn[pr.i]).applyMatrix4(
    (el[0].obj.updateMatrixWorld(true), el[0].obj.matrixWorld))
    .addScaledVector(new THREE.Vector3(1, 0, 0), pr.din);
  assert.ok(corner.distanceTo(new THREE.Vector3(1000, 0, 0)) < 1,
    'угол в ' + JSON.stringify(corner));
  // второй отрезок пришёл в плоскость прилегания второго патрубка
  const end = S.rotSeatLocal(t[1].zn[1]).applyMatrix4(
    (t[1].obj.updateMatrixWorld(true), t[1].obj.matrixWorld));
  assert.ok(end.distanceTo(world(S, b, 0)) < 1, 'конец трубы в ' + JSON.stringify(end));
  // отрезки подрезаны на вылет отвода, а не на всю длину участка
  assert.equal(S.pipeLen(t[0]), Math.round(980 - pr.din));
  assert.equal(S.pipeLen(t[1]), Math.round(580 - pr.dout));
  assert.match(S.toasts.join(' '), /трасса Г-образная/);
});

test('Z-образная трасса: три отрезка и два отвода, конец в патрубке', async () => {
  const S = stand();
  const a = host(S, [0, 0, 0], 0);
  const b = host(S, [1200, 0, 400]);           // навстречу, но выше на 400
  await S.pullRun(S.pullPort(a, 0), S.pullPort(b, 0));
  assert.equal(S.placed.length, 7, S.toasts.join(' | '));   // 2 аппарата + 3 трубы + 2 отвода
  const t = tubes(S);
  assert.equal(t.length, 3);
  const end = S.rotSeatLocal(t[2].zn[1]).applyMatrix4(
    (t[2].obj.updateMatrixWorld(true), t[2].obj.matrixWorld));
  assert.ok(end.distanceTo(world(S, b, 0)) < 1, 'конец трубы в ' + JSON.stringify(end));
  assert.match(S.toasts.join(' '), /трасса Z-образная · \d+ мм · отводов 2/);
});

test('оси разошлись — в сцене не остаётся ни трубы, ни фитинга', async () => {
  const S = stand();
  const a = host(S, [0, 0, 0], 0);
  const b = host(S, [1000, 300, 90], Math.PI / 2);
  await S.pullRun(S.pullPort(a, 0), S.pullPort(b, 0));
  assert.equal(S.placed.length, 2);
  assert.match(S.toasts.join(' '), /Труба не легла/);
});
