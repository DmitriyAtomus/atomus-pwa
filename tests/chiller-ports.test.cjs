// Компоновка проекта (chiller/project.html): на сцене видно, где всасывание,
// где нагнетание. Меш из базы 3D приходит размеченным — группы треугольников
// по средам и точки патрубков с заводскими именами. Проверяем, что разметка
// доезжает до сцены, что подпись берёт имя завода, а не вид среды, и что
// режим подписей по умолчанию — «у выделенной детали».
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

test('меш покупной позиции сохраняет группы сред и точки патрубков', () => {
  const geo = section('async function geoOf(d)', "/* ═══ сцена");
  // группы из пакета: 0 — корпус, дальше нагнетание, всасывание, ППК, уравнивание
  assert.match(geo, /\(MS\.groups\|\|\[\]\)\.forEach\(\(g,i\)=>\{if\(g\[1\]>0\)geo\.addGroup\(g\[0\],g\[1\],i\)/);
  assert.match(geo, /geo\.userData\.zoneMats=geo\.groups\.length>1/);
  // одна группа — зон нет, материал должен остаться одиночным
  assert.match(geo, /if\(geo\.groups\.length===1\)geo\.clearGroups\(\)/);
  assert.match(geo, /geo\.userData\.zones=\(\(IZ&&IZ\.length\?IZ:MS\.zones\)\|\|\[\]\)\.filter\(z=>z&&z\.tip\)/);
  // у сборки с деталями цвета свои, зонных материалов там нет
  assert.match(geo, /geo\.userData\.zoneMats=false/);
});

test('цвета сред те же, что в базе 3D, и деталь получает пять материалов', () => {
  assert.match(page, /const C_DIS=0xd94f3d,C_SUC=0x3d8fd9,C_PPK=0xC9A227,C_EQ=0x4FBF8B/);
  assert.match(page, /const ZONE_COL=\[C_BODY,C_DIS,C_SUC,C_PPK,C_EQ\]/);
  assert.match(page, /geo\.userData\.zoneMats\?ZONE_COL\.map\(c=>mk\(c,true\)\):mk\(C_BODY\)/);
  // патрубок остаётся сталью по блеску, а не выглядит крашеным
  assert.match(page, /const mk=\(c,steel\)=>new THREE\.MeshStandardMaterial/);
});

test('подпись патрубка — заводское имя, у выделенной детали ещё и диаметр', () => {
  const src = section('function portText(z,full)', 'function mkSprite');
  const ctx = { ZONE_SHORT: { dis: 'нагнетание', suc: 'всасывание', ppk: 'ППК', eq: 'уравнивание' } };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const suc = { kind: 'suc', name: 'ВСАСЫВАНИЕ', od: 22.225 };
  assert.equal(ctx.portText(suc, false), 'ВСАСЫВАНИЕ');
  assert.equal(ctx.portText(suc, true), 'ВСАСЫВАНИЕ · Ø22,2');   // без хвоста 22,225
  // у ресивера тот же красный порт называется «ВХОД» — врать «нагнетанием» нельзя
  assert.equal(ctx.portText({ kind: 'dis', name: 'ВХОД 3/8" (жидкость)' }, false),
    'ВХОД 3/8" (жидкость)');
  // имени нет — подписываем средой
  assert.equal(ctx.portText({ kind: 'dis', od: 12.7 }, true), 'нагнетание · Ø12,7');
  // длинное заводское имя в кратком виде обрезается, чтобы не закрыть сцену
  const long = ctx.portText({ kind: 'suc', name: 'ПАТРУБОК ОТСОСА ПАРА 1"1/8 ПОД ПАЙКУ ODF' }, false);
  assert.ok(long.length <= 22 && long.endsWith('…'), 'краткая подпись должна укладываться в строку');
});

test('режим подписей: по умолчанию у выделенной детали, кнопка гоняет три позиции', () => {
  // пустое хранилище — это «ещё не выбирали», а не «выключено»
  assert.match(page, /const v=localStorage\.getItem\(PORT_KEY\);\s*\n?\s*return \(v==='0'\|\|v==='1'\|\|v==='2'\)\?\+v:1;/);
  assert.match(page, /PORTS=\(PORTS\+1\)%3/);
  assert.match(page, /localStorage\.setItem\(PORT_KEY,String\(PORTS\)\)/);
  assert.match(page, /const list=PORTS===2\?placed:\(sel\?\[sel\]:\[\]\)/);
  assert.match(page, /\$\('#bPorts'\)\.onclick=portsToggle/);
  assert.match(page, /id="bPorts"/);
  // выключили подписи — гаснет и краска патрубков
  assert.match(page, /m\.color\.setHex\(PORTS\?ZONE_COL\[i\]:C_BODY\)/);
});

test('подписи держатся за деталями и не наезжают друг на друга', () => {
  const sync = section('function portsSync()', 'function portsPaint');
  // берём свежие матрицы: деталь могли только что протащить мышью
  assert.match(sync, /scene\.updateMatrixWorld\(true\)/);
  assert.match(sync, /_pv\.copy\(t\.loc\)\.applyMatrix4\(t\.it\.obj\.matrixWorld\)/);
  // постоянный размер на экране, а не «далеко — мельче»
  assert.match(sync, /2\*dist\*Math\.tan\(camera\.fov\*Math\.PI\/360\)\*PORT_PX\/H/);
  // занятое место запоминаем и разводим подпись по лесенке (v2.46.025)
  assert.match(sync, /for\(const cc of PORT_LADDER\)/);
  assert.match(sync, /if\(tagHit\(r\)\)continue;\s*tagPush\(r\);/);
  // выноска от точки к поднятой подписи
  assert.match(sync, /lp\.setXYZ\(p\.i\*2\+1/);
  assert.match(page, /portLine\.frustumCulled=false/);
  // подписи живут в своей группе — иначе они попали бы в габарит сцены
  assert.match(page, /const portGrp=new THREE\.Group\(\)/);
  assert.match(page, /scene\.add\(portGrp\)/);
  assert.match(page, /portGrp\.add\(spr\)/);
});

test('подписи пересобираются при выборе детали и при изменении сцены', () => {
  assert.match(page, /hideMnt\(\);selBtns\(\);buildParts\(\);portsRebuild\(\)/);
  assert.match(page, /portsPaint\(\);portsRebuild\(\);\s*\/\/ деталь ушла или приехала/);
  assert.match(page, /portsSync\(\);rotSync\(\);[\s\S]{0,80}renderer\.render\(scene,camera\)/);
});

test('присоединения показываются у выбранной детали, а протяжка фильтрует цели', () => {
  const src = section('function rotRebuild()', '/* Что написать на метке');
  assert.match(src, /list=sel\?list\.filter\(f=>f\.it===sel\):\[\]/);
  assert.match(src, /const q=pullChoices\(list\)/);
  assert.match(src, /f\.pullWhy\?' pno':' pto'/);
  assert.match(page, /good\.length\?good\.slice\(0,12\):bad\.slice\(0,6\)/);
  assert.match(page, /if\(!free&&b\.it!==sel&&!b\.el\.classList\.contains\('pfrom'\)\)/);
});
