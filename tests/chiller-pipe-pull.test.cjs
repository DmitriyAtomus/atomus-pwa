// Автопротяжка трубы между двумя патрубками (chiller/project.html, задача #909):
// выбрал патрубок и патрубок — трасса строится по осям, в углах отводы 90°,
// на концах переход, если труба с патрубком не сходится.
// Стенд живой: код трассы берём прямо со страницы, THREE — тот самый
// chiller/three.min.js, что грузит браузер, разметка патрубков — выдержка из
// настоящего индекса базы 3D (труба и угольник PP-R, переходы Valtec).
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

/* присоединения (connOf/connFit/rotSeatLocal) + сама протяжка, без DOM */
function stand(items, geoms) {
  const code = section('const CT_NAME=', 'function rotClear()') +
               section('const PULL_TOL=', 'async function pullPut(');
  const ctx = {
    THREE,
    DATA: items || base.items,
    GEOMS: geoms || base.geoms,
    placed: [],
    localStorage: { getItem: () => null, setItem: () => {} },
    $: () => null,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
/* патрубок как его видит трасса: точка прилегания и ось наружу */
const port = (p, d, z) => ({ p, d: d.clone().normalize(), z: z || { name: 'ВЫХОД' },
                             c: null, it: null, zi: 0 });
const zn = (id) => base.geoms[base.items.find(d => d.id === id).g].zn;

test('оси смотрят друг в друга — трасса прямая, из одного отрезка', () => {
  const S = stand();
  const r = S.pullRoute(port(V(0, 0, 0), V(1, 0, 0)), port(V(500, 0, 0), V(-1, 0, 0)));
  assert.equal(r.err, undefined);
  assert.equal(r.kind, 'прямая');
  assert.equal(r.pts.length, 2);
  assert.equal(Math.round(r.pts[1].x), 500);
});

test('оси пересекаются под 90° — Г-образная трасса с углом в точке пересечения', () => {
  const S = stand();
  const r = S.pullRoute(port(V(0, 0, 0), V(1, 0, 0)), port(V(400, 0, 300), V(0, 0, -1)));
  assert.equal(r.kind, 'Г-образная');
  assert.equal(r.pts.length, 3);
  assert.deepEqual([r.pts[1].x, r.pts[1].y, r.pts[1].z].map(Math.round), [400, 0, 0]);
});

test('оси навстречу, но со сдвигом — Z-образная трасса в две ступени', () => {
  const S = stand();
  const r = S.pullRoute(port(V(0, 0, 0), V(1, 0, 0)), port(V(600, 0, 200), V(-1, 0, 0)));
  assert.equal(r.kind, 'Z-образная');
  assert.equal(r.pts.length, 4);
  assert.deepEqual([r.pts[1].x, r.pts[1].z].map(Math.round), [300, 0]);
  assert.deepEqual([r.pts[2].x, r.pts[2].z].map(Math.round), [300, 200]);
  // все три участка идут строго по осям и поворачивают на 90°
  const d = [];
  for (let i = 0; i + 1 < r.pts.length; i++)
    d.push(r.pts[i + 1].clone().sub(r.pts[i]).normalize());
  assert.ok(Math.abs(d[0].dot(d[1])) < 1e-6);
  assert.ok(Math.abs(d[1].dot(d[2])) < 1e-6);
});

test('оси смотрят одинаково — П-образная трасса с двумя отводами', () => {
  const S = stand();
  const r = S.pullRoute(port(V(0, 0, 0), V(1, 0, 0)),
                        port(V(600, 300, 0), V(1, 0, 0)));
  assert.equal(r.err, undefined);
  assert.equal(r.kind, 'П-образная');
  assert.equal(r.pts.length, 4);
  const d = [];
  for (let i = 0; i + 1 < r.pts.length; i++)
    d.push(r.pts[i + 1].clone().sub(r.pts[i]).normalize());
  assert.deepEqual(d.map(q => [q.x, q.y, q.z].map(Math.round)),
    [[1, 0, 0], [0, 1, 0], [-1, 0, 0]]);
});

test('одинаково направленным патрубкам нужно место поперёк под два отвода', () => {
  const S = stand();
  const r = S.pullRoute(port(V(0, 0, 0), V(1, 0, 0)),
                        port(V(600, 10, 0), V(1, 0, 0)));
  assert.match(r.err, /для двух отводов нет места/);
});

test('оси разошлись в пространстве — трасса не строится, и сказано на сколько', () => {
  const S = stand();
  const r = S.pullRoute(port(V(0, 0, 0), V(1, 0, 0)), port(V(400, 300, 50), V(0, -1, 0)));
  assert.match(r.err, /не сходятся, расходятся на 50 мм/);
});

test('второй патрубок смотрит в сторону от первого — трубе некуда идти', () => {
  const S = stand();
  const r = S.pullRoute(port(V(0, 0, 0), V(1, 0, 0)), port(V(400, 300, 0), V(0, 1, 0)));
  assert.match(r.err, /позади патрубка/);
});

test('патрубки стоят вплотную — отрезок туда не встанет', () => {
  const S = stand();
  const r = S.pullRoute(port(V(0, 0, 0), V(1, 0, 0)), port(V(10, 0, 0), V(-1, 0, 0)));
  assert.match(r.err, /между патрубками 10 мм/);
});

test('у отвода находится настоящая пара раструбов, а не «донышки»', () => {
  const S = stand();
  for (const id of ['VTp.751.0.020', 'VTp.751.0.025']) {
    const z = zn(id), pr = S.elbowPair(z);
    assert.ok(pr, id + ': пара раструбов не нашлась');
    // раструбы угольника: один вдоль +X, второй вдоль +Z
    assert.deepEqual(z[pr.i].dir, [1, 0, 0], id);
    assert.deepEqual(z[pr.j].dir, [0, 0, 1], id);
    // вылет от угла до плоскости прилегания — на него режется труба
    assert.ok(pr.din > 20 && pr.din < 40, id + ': вылет ' + pr.din);
    assert.ok(pr.dout > 20 && pr.dout < 40, id + ': вылет ' + pr.dout);
  }
});

test('у отвода Ø50 в базе размечены только два соосных раструба — за отвод не считаем', () => {
  const S = stand();
  assert.equal(S.elbowPair(zn('VTp.751.0.050')), null);
});

test('труба садится прямо на раструб фитинга — переходов не нужно', () => {
  const S = stand();
  const c = S.connOf(zn('VTp.751.0.025')[0]);        // раструб Ø25 сварка PP-R
  const pl = S.pullPlan({ c, z: { name: 'ПОД СВАРКУ Ø25', od: 34.5 } },
                        { c, z: { name: 'ПОД СВАРКУ Ø25' } }, 0);
  assert.equal(pl.err, undefined);
  assert.equal(pl.cost, 0);
  assert.equal(pl.t.d.id, 'VTp.700.0.025');
});

test('на резьбовой патрубок труба идёт через переход, и переход соосный', () => {
  const S = stand();
  const c = { t: 'thr', size: 'G1/2', sex: 'm', txt: 'резьба G1/2' };
  const pl = S.pullPlan({ c, z: { name: 'НАГНЕТАНИЕ G1/2', od: 21 } },
                        { c, z: { name: 'ВХОД G1/2' } }, 0);
  assert.equal(pl.err, undefined);
  assert.equal(pl.t.d.id, 'VTp.700.0.020');
  assert.equal(pl.cost, 2);                          // переход на обоих концах
  // водорозетка тоже «резьба + раструб», но раструб у неё смещён с оси
  assert.equal(pl.ea.d.id, 'VTp.708.0.02004');
  assert.notEqual(pl.ea.d.id, 'VTp.754.0.02004');
});

test('в углу нужен отвод: нет отвода под этот диаметр — трасса не строится', () => {
  const S = stand();
  const c = S.connOf(zn('VTp.751.0.025')[0]);
  const one = { items: base.items.filter(d => !/Угольник/i.test(d.name)), geoms: base.geoms };
  const S2 = stand(one.items, one.geoms);
  assert.equal(S.pullPlan({ c, z: { name: 'A' } }, { c, z: { name: 'B' } }, 1).err, undefined);
  assert.match(S2.pullPlan({ c, z: { name: 'A' } }, { c, z: { name: 'B' } }, 1).err,
               /нет отвода 90°/);
});

test('предварительная проверка объясняет отсутствующую разметку присоединения', () => {
  const S = stand();
  const a = port(V(0, 0, 0), V(1, 0, 0), { name: 'ВЫХОД БЕЗ РАЗМЕРА' });
  const b = port(V(500, 0, 0), V(-1, 0, 0), { name: 'ВХОД' });
  b.c = S.connOf(zn('VTp.751.0.025')[0]);
  assert.match(S.pullCheck(a, b).err, /не задан тип и размер присоединения/);
});

test('доворот отвода: второй раструб встаёт точно на следующий участок трассы', () => {
  const S = stand();
  const z = zn('VTp.751.0.025'), pr = S.elbowPair(z);
  const el = { zn: z, obj: new THREE.Object3D() };
  const axis = V(1, 0, 0);                            // труба пришла вдоль +X
  const want = V(0, 0, 1);                            // дальше трасса идёт вверх
  // отвод посажен: раструб входа смотрит назад по оси трубы
  el.obj.quaternion.setFromUnitVectors(
    V(z[pr.i].dir[0], z[pr.i].dir[1], z[pr.i].dir[2]), axis.clone().negate());
  const roll = S.pullRoll(el, pr.j, want, axis);
  el.obj.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, roll));
  const out = V(z[pr.j].dir[0], z[pr.j].dir[1], z[pr.j].dir[2])
    .applyQuaternion(el.obj.quaternion);
  assert.ok(out.distanceTo(want) < 1e-6, 'раструб смотрит ' + JSON.stringify(out));
});
