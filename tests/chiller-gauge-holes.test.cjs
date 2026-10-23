const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'chiller', 'project.html'), 'utf8');
global.window = global;
global.self = global;
const THREE = require(path.join(root, 'chiller', 'three.min.js')) || global.THREE;

function section(from, to) {
  const a = page.indexOf(from);
  const b = page.indexOf(to, a);
  assert.notEqual(a, -1, 'not found: ' + from);
  assert.notEqual(b, -1, 'not found: ' + to);
  return page.slice(a, b);
}

test('корпус 600×900 отдаёт два штатных манометрических отверстия Ø79', () => {
  const code = section('const FACE_HOLES=', 'function faceMate(it)');
  const placed = [];
  const api = new Function('THREE', 'placed', 'gaugeRank', code +
    '\nreturn {FACE_HOLES,faceHoleGrid,faceHolePick};')(THREE, placed, () => 0);
  const geometry = new THREE.BoxGeometry(900, 606, 899);
  const frame = { uid: 7, obj: new THREE.Mesh(geometry) };
  const holes = api.faceHoleGrid(frame);
  assert.equal(holes.length, 2);
  assert.deepEqual(holes.map(h => h.d), [79, 79]);

  const gauge = { d: {}, obj: new THREE.Mesh(new THREE.BoxGeometry(80, 40, 80)) };
  const first = api.faceHolePick(gauge, frame);
  assert.equal(first.p[2], 638, 'первый манометр садится в верхнее отверстие');
  placed.push({ uid: 8, link: { to: 7, mount: 'face', hole: first.i } });
  assert.equal(api.faceHolePick(gauge, frame).p[2], 488,
    'занятое отверстие вторично не выбирается');
});

test('манометр держит центр отверстия при перемещении и повороте корпуса', () => {
  const code = section('function faceMate(it)', '/* v2.46.011: автоматическая врезка');
  const frame = { uid: 3, obj: new THREE.Mesh(new THREE.BoxGeometry(900, 606, 899)) };
  frame.obj.position.set(120, -80, 450);
  frame.obj.rotation.z = Math.PI / 3;
  frame.obj.updateMatrixWorld(true);
  const gauge = {
    link: { to: 3, mount: 'face', hole: 0, lp: [-369.5, 293.875, 638] },
    obj: new THREE.Mesh(new THREE.BoxGeometry(80, 40, 80)),
  };
  const api = new Function('THREE', 'placed', code + '\nreturn {faceMate};')(
    THREE, [frame, gauge]);
  assert.equal(api.faceMate(gauge), true);

  const b = gauge.obj.geometry.boundingBox;
  const anchor = new THREE.Vector3(b.max.x - 4, (b.min.y + b.max.y) / 2,
    (b.min.z + b.max.z) / 2).applyMatrix4(gauge.obj.matrixWorld);
  const hole = frame.obj.localToWorld(new THREE.Vector3(...gauge.link.lp));
  assert.ok(anchor.distanceTo(hole) < 1e-7, 'посадочное кольцо соосно отверстию');

  const face = new THREE.Vector3(1, 0, 0).applyQuaternion(gauge.obj.quaternion);
  const out = new THREE.Vector3(0, 1, 0).applyQuaternion(frame.obj.quaternion);
  assert.ok(face.distanceTo(out) < 1e-7, 'циферблат смотрит наружу');
});

test('связь с отверстием сохраняется в проекте и undo', () => {
  const payload = section('function projPayload(){', 'function save(){');
  assert.match(payload, /hole:p\.link\.hole/);
  assert.match(payload, /lp:Array\.isArray\(p\.link\.lp\)\?p\.link\.lp\.slice\(\)/);
  const hist = section('async function histApply(snapshot)', 'async function histGo(back)');
  assert.match(hist, /hole:it\.link\.hole/);
  assert.match(hist, /mount==='face'\)faceMate\(p\)/);
});
