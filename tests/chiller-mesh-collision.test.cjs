// Компоновка чиллера: пересечения считаются по геометрии меша, а не по коробке.
// Габаритная коробка врёт — у Г-образной детали, у ресивера с лапами и у
// наклонной трубы внутри габарита больше пустоты, чем металла, и соседи
// светились красным «на пустом месте». Тест исполняет НАСТОЯЩИЙ код разбора
// из chiller/project.html (meshTris / meshPairHit / inMesh / realHit и разбор
// упора в корпус) на настоящих мешах three.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'chiller', 'project.html'), 'utf8');

global.window = global;
global.self = global;
const THREE = require(path.join(root, 'chiller', 'three.min.js')) || global.THREE;
global.THREE = THREE;

function section(from, to) {
  const a = page.indexOf(from);
  const b = page.indexOf(to, a);
  assert.notEqual(a, -1, 'не нашёл начало блока: ' + from);
  assert.notEqual(b, -1, 'не нашёл конец блока: ' + to);
  return page.slice(a, b);
}
// тот же код, что работает в проде
const code =
  section('const MESH_TOL=2;', '/* ═══ v2.45.1011: упор в корпус') +
  section('/* треугольники детали корпуса в координатах сцены', 'function checkHits()');
const G = new Function('THREE', code +
  '\nreturn {meshTris,meshPairHit,inMesh,realHit,deepIn,framePartTris,frameRealHit,MESH_TOL};')(THREE);

const bx = (it) => new THREE.Box3().setFromObject(it.obj);
function boxItem(x0, y0, z0, x1, y1, z1) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0),
    new THREE.MeshBasicMaterial());
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.updateMatrixWorld(true);
  return { obj: m };
}
// сборка из нескольких коробок одним мешем: каждая — своя группа, как в базе 3D
function multiBox(list) {
  const pos = [], idx = [], grp = [];
  let off = 0;
  list.forEach((g) => {
    const p = g.attributes.position.array, ix = g.index.array, st = idx.length;
    for (let i = 0; i < p.length; i++) pos.push(p[i]);
    for (let i = 0; i < ix.length; i++) idx.push(ix[i] + off);
    off += p.length / 3;
    grp.push([st, ix.length]);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  grp.forEach((g, i) => geo.addGroup(g[0], g[1], i));
  const mats = grp.map(() => new THREE.MeshBasicMaterial());
  const m = new THREE.Mesh(geo, mats);
  m.updateMatrixWorld(true);
  return { obj: m, mats: mats };
}
const hit = (a, b) => G.realHit(a, b, bx(a), bx(b));

test('коробки задели, а металл — нет: наезда нет', () => {
  const A = boxItem(0, 0, 0, 100, 100, 100);
  assert.equal(hit(A, boxItem(50, 50, 50, 150, 150, 150)), true, 'угол в угол — наезд');
  assert.equal(hit(A, boxItem(100, 0, 0, 200, 100, 100)), false, 'вплотную — не наезд');
  assert.equal(hit(A, boxItem(99, 0, 0, 199, 100, 100)), false, '1 мм — в допуске');
  assert.equal(hit(A, boxItem(95, 0, 0, 195, 100, 100)), true, '5 мм внахлёст — наезд');
});

test('деталь в вырезе Г-образного узла не считается наездом', () => {
  // полка 200×40×200 в начале координат и стойка 40×40×200 у её края
  const L = multiBox([new THREE.BoxGeometry(200, 40, 200),
                      new THREE.BoxGeometry(40, 40, 200).translate(-80, 0, 200)]);
  const notch = boxItem(-10, -15, 120, 50, 15, 280);
  assert.equal(bx(L).intersectsBox(bx(notch)), true, 'габариты обязаны задевать');
  assert.equal(hit(L, notch), false, 'в вырезе — не наезд');
  assert.equal(hit(L, boxItem(-90, -15, 120, -50, 15, 280)), true, 'в стойке — наезд');
  // мелочь целиком внутри чужого габарита, но в пустоте
  assert.equal(hit(L, boxItem(-5, -5, 180, 5, 5, 220)), false, 'мелочь в пустоте габарита');
});

test('точка в теле детали и точка в пустоте её габарита', () => {
  const L = multiBox([new THREE.BoxGeometry(200, 40, 200),
                      new THREE.BoxGeometry(40, 40, 200).translate(-80, 0, 200)]);
  const T = G.meshTris(L);
  assert.equal(G.inMesh(T, 0, 0, 0), true, 'центр полки — металл');
  assert.equal(G.inMesh(T, 0, 0, 200), false, 'над полкой — пустота');
  assert.equal(G.inMesh(T, -80, 0, 200), true, 'центр стойки — металл');
});

test('погашенную деталь узла в расчёт не берём', () => {
  const two = multiBox([new THREE.BoxGeometry(50, 50, 50),
                        new THREE.BoxGeometry(50, 50, 50).translate(60, 0, 0)]);
  const probe = boxItem(45, -25, -25, 75, 25, 25);
  assert.equal(hit(two, probe), true, 'сидит на второй половине узла');
  two.mats[1].visible = false;
  assert.equal(hit(two, probe), false, 'вторую половину погасили — наезда нет');
});

test('неиндексированный меш тоже разбирается', () => {
  const g = new THREE.BoxGeometry(50, 50, 50).toNonIndexed();
  const N1 = { obj: new THREE.Mesh(g, new THREE.MeshBasicMaterial()) };
  const N2 = { obj: new THREE.Mesh(g.clone(), new THREE.MeshBasicMaterial()) };
  N2.obj.position.set(40, 0, 0);
  N1.obj.updateMatrixWorld(true); N2.obj.updateMatrixWorld(true);
  assert.equal(hit(N1, N2), true);
  N2.obj.position.set(51, 0, 0); N2.obj.updateMatrixWorld(true);
  assert.equal(hit(N1, N2), false);
});

test('упор в корпус: балка мимо — молчим, балка в теле — упор', () => {
  // корпус одним мешем: стойка 40×40×1000 и панель обшивки 2 мм
  const frame = multiBox([new THREE.BoxGeometry(40, 40, 1000).translate(-400, 0, 500),
                          new THREE.BoxGeometry(800, 2, 1000).translate(0, 300, 500)]);
  frame._fpKey = 'k1';
  const gbox = (gi) => {
    const T = G.framePartTris(frame, gi), b = new THREE.Box3(), v = new THREE.Vector3();
    for (let i = 0; i < T.n * 9; i += 3) b.expandByPoint(v.set(T.t[i], T.t[i + 1], T.t[i + 2]));
    return b;
  };
  const B0 = gbox(0), B1 = gbox(1);
  const node = (x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(200, 200, 200), new THREE.MeshBasicMaterial());
    m.position.set(x, y, z); m.updateMatrixWorld(true); return { obj: m };
  };
  const real = (p, gi, fb) => G.frameRealHit(p, frame, gi, bx(p).expandByScalar(-5), fb);
  assert.equal(real(node(0, 0, 500), 0, B0), false, 'узел в стороне от стойки');
  assert.equal(real(node(-400, 0, 500), 0, B0), true, 'узел влез в стойку');
  assert.equal(real(node(0, 300, 500), 1, B1), true, 'узел торчит сквозь панель 2 мм');
  assert.equal(real(node(0, 180, 500), 1, B1), false, 'до панели 20 мм');
  assert.equal(real(node(0, 199, 500), 1, B1), false, 'стоит вплотную к панели');
  // треугольники детали корпуса считаются один раз и живут до сдвига корпуса
  assert.equal(G.framePartTris(frame, 0), G.framePartTris(frame, 0));
  frame._fpKey = 'k2';
  assert.equal(G.framePartTris(frame, 0).n, 12, 'корпус подвинули — пересчитали');
});

test('кадр перетаскивания укладывается в бюджет', () => {
  const parts = [];
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(new THREE.TorusKnotGeometry(60, 18, 64, 10),
      new THREE.MeshBasicMaterial());
    m.position.set((i % 5) * 95, Math.floor(i / 5) * 95, 0);
    m.updateMatrixWorld(true);
    parts.push({ obj: m });
  }
  const boxes = parts.map(bx);
  const t0 = Date.now();
  for (let r = 0; r < 10; r++) {
    parts[0]._mtKey = null;                        // одну деталь «подвинули»
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++)
        if (boxes[i].intersectsBox(boxes[j])) G.realHit(parts[i], parts[j], boxes[i], boxes[j]);
  }
  const ms = (Date.now() - t0) / 10;
  assert.ok(ms < 60, '14 узлов в куче, кадр ' + ms.toFixed(1) + ' мс');
});
