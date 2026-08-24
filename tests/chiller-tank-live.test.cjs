// Конструктор бака: живой меш остаётся временным до подтверждения,
// а закреплённый внутри бак хранит transform относительно корпуса.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'chiller', 'project.html'), 'utf8');

global.window = global;
global.self = global;
const THREE = require(path.join(root, 'chiller', 'three.min.js')) || global.THREE;

function section(from, to) {
  const a = page.indexOf(from);
  const b = page.indexOf(to, a);
  assert.notEqual(a, -1, 'не нашёл начало блока: ' + from);
  assert.notEqual(b, -1, 'не нашёл конец блока: ' + to);
  return page.slice(a, b);
}

test('конструктор объясняет живой предпросмотр и явное подтверждение', () => {
  const modal = section('<div id="tnk">', '<div id="mdz">');
  assert.match(modal, /id="tkLive"/);
  assert.match(modal, /не входит в проект и BOM/);
  assert.match(modal, /id="tkAddB">Добавить бак в проект/);
  assert.match(modal, /id="tkCancelB">Отмена/);
  assert.match(page, /\$\('#tkCancelB'\)\.onclick=tkClose/);
  assert.match(page, /function tkClose\(\)\{\s*tkPreviewClear\(true\)/);
  assert.match(page, /\$\('#tnk'\)\.classList\.contains\('on'\)\)\{tkClose\(\);return;\}/);
});

test('временный меш не попадает в placed, историю и save', () => {
  const preview = section('function tkPreviewMats(geo)', 'function tkChips(box,list,key,cb)');
  assert.doesNotMatch(preview, /placed\.push/);
  assert.doesNotMatch(preview, /pushHist|histBegin|\bsave\s*\(/);
  assert.match(preview, /tkPreview\.obj\.geometry\.dispose\(\)/);
  assert.match(preview, /if\(restore\)tkPreviewSetOld\(true\)/);
  assert.match(section('function tkDraw()', 'const tkCell='), /tkPreviewUpdate\(\)/);

  const els = { '#tnk': { classList: { contains: () => true } } };
  const scene = new THREE.Scene();
  const ctx = {
    THREE, scene, placed: [], TKP: { L: 10 }, C_BODY: 0x888888,
    tkPreview: null, tkPreviewOld: null, target: new THREE.Vector3(),
    $: id => els[id],
    tkModel: p => ({ id: 'preview', tk: p, _zn: [] }),
    tkBuild() {
      const g = new THREE.BoxGeometry(100, 80, 60);
      g.userData.parts = [{ col: 0x999999 }];
      return g;
    },
    roleOf: () => 'floor',
    site: () => ({ min: { z: 0 } }),
    placeAt(it, x, y, z) { it.obj.position.set(x, y, z + 30); it.obj.updateMatrixWorld(true); },
  };
  vm.createContext(ctx);
  vm.runInContext(preview, ctx);
  vm.runInContext('tkPreviewUpdate()', ctx);
  assert.equal(ctx.placed.length, 0, 'предпросмотр не стал деталью проекта');
  assert.equal(scene.children.length, 1, 'меш виден в сцене');
  vm.runInContext('tkPreviewUpdate()', ctx);
  assert.equal(scene.children.length, 1, 'прежний меш заменён, а не дублирован');
  vm.runInContext('tkPreviewClear(true)', ctx);
  assert.equal(scene.children.length, 0, 'отмена убрала предпросмотр');
});

test('при подтверждении бак получает место preview, а редактируемый — прежний uid', () => {
  const put = section('async function tkPut()', "$('#bTank').onclick");
  assert.match(put, /const pp=tkPreview&&tkPreview\.obj\.position\.clone\(\)/);
  assert.match(put, /addItem\(d,pp\?\{x:pp\.x,y:pp\.y,z:pp\.z\}/);
  assert.match(put, /addItem\(d,\{uid:tkEdit,x:pos\.x,y:pos\.y,z:pos\.z,state:st\}/);
  assert.match(put, /const st=\{pin:old\.pin,off:old\.off,link:old\.link,fit:old\.fit,sch:old\.sch\}/);
});

test('кнопка бака ищет место внутри и создаёт tank-link', () => {
  assert.match(page, /id="bTankLink"[^>]*[\s\S]{0,180}?Закрепить бак внутри/);
  assert.match(page, /function tankInsidePlan\(it,fr\)/);
  assert.match(page, /rots=\[rz0,rz0\+Math\.PI\/2\]/, 'если не входит вдоль, пробуем поперёк');
  assert.match(page, /boxFree\(b,it\)&&frameFree\(b,it\)/, 'место свободно и от деталей, и от металла корпуса');
  assert.match(page, /sel\.link=\{to:fr\.uid,mount:'tank',face:'pan'\}/);
  assert.match(page, /sel\.link\.rel=tankRelOf\(sel,fr\)/);
  assert.match(page, /pushHist\('закрепление бака внутри чиллера'\)/);
});

test('относительный transform ведёт бак за перемещением и поворотом корпуса', () => {
  const code = section('function tankRelOf(it,fr)', 'function tankZone(fr)');
  const api = new Function('THREE', code + '\nreturn {tankRelOf,tankReseat};')(THREE);
  const frameObj = new THREE.Mesh(new THREE.BoxGeometry(900, 600, 900));
  frameObj.position.set(120, -50, 450);
  frameObj.rotation.z = Math.PI / 6;
  const tankObj = new THREE.Mesh(new THREE.BoxGeometry(260, 180, 500));
  tankObj.position.set(-40, 30, 285);
  tankObj.rotation.z = -Math.PI / 2;
  const fr = { uid: 4, obj: frameObj };
  const tank = { obj: tankObj, link: null };
  const rel = api.tankRelOf(tank, fr);
  tank.link = { to: fr.uid, mount: 'tank', rel };

  frameObj.position.set(740, 300, 450);
  frameObj.rotation.z = Math.PI / 2;
  frameObj.updateMatrixWorld(true);
  api.tankReseat(tank, fr);

  const expected = frameObj.localToWorld(new THREE.Vector3(...rel.p));
  assert.ok(tankObj.position.distanceTo(expected) < 1e-7, 'место осталось относительным');
  const fq = frameObj.getWorldQuaternion(new THREE.Quaternion());
  const expectedQ = fq.multiply(new THREE.Quaternion(...rel.q));
  assert.ok(1 - Math.abs(tankObj.quaternion.dot(expectedQ)) < 1e-9, 'бак повернулся вместе с корпусом');
});

test('tank-link сохраняет rel в проекте, history и при загрузке', () => {
  const payload = section('function projPayload(){', 'function save(){');
  assert.match(payload, /rel:p\.link\.rel\?\{p:p\.link\.rel\.p\.slice\(\),\s*q:p\.link\.rel\.q\.slice\(\)\}:undefined/);
  const hist = section('async function histApply(snapshot)', 'async function histGo(back)');
  assert.match(hist, /rel:it\.link\.rel\?\{p:it\.link\.rel\.p\.slice\(\),q:it\.link\.rel\.q\.slice\(\)\}:undefined/);
  const load = section('async function loadProjectData(data)', 'async function openProject(id)');
  assert.match(load, /pzi:p\.link\.pzi,roll:p\.link\.roll,\s*rel:p\.link\.rel/);
  assert.match(section('function refresh(){', 'function refreshSpecSel()'), /mount==='tank'\)reseatLink\(p\)/);
});
