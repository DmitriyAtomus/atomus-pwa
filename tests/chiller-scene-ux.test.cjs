// UX компоновки «Атом Чиллер»: плавная навигация без поломки перетаскивания
// деталей и перемещаемая панель точных координат.
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

test('колесо и pinch используют общий плавный зум к точке курсора', () => {
  assert.match(page, /dMin=120,dMax=12000/);
  const ctl = section('function bindCtl(cv)', '/* роли, которые живут внутри');
  assert.match(ctl, /zoomAt\(m\.x,m\.y,pin\.d\/m\.d\)/, 'pinch не держит точку под пальцами');
  assert.match(ctl, /zoomAt\(e\.clientX,e\.clientY,Math\.exp\(dy\*\.0015\)\)/,
    'колесо всё ещё прыгает фиксированными шагами');
  assert.match(ctl, /e\.button===1\|\|\(e\.button===0&&e\.shiftKey\)/);
  assert.match(ctl, /e\.button===0&&e\.altKey/);
  // Обычный ЛКМ по-прежнему выбирает деталь и входит в item-mode.
  assert.match(ctl, /const hit=pickItem\(e\);[\s\S]*mode='item';cv\.classList\.add\('drag'\)/);
});

class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  subVectors(a, b) { this.x = a.x-b.x; this.y = a.y-b.y; this.z = a.z-b.z; return this; }
  normalize() { const n = Math.hypot(this.x,this.y,this.z)||1; this.x/=n;this.y/=n;this.z/=n;return this; }
  clone() { return new V3(this.x,this.y,this.z); }
  cross(v) { const x=this.y*v.z-this.z*v.y,y=this.z*v.x-this.x*v.z,z=this.x*v.y-this.y*v.x;
    this.x=x;this.y=y;this.z=z;return this; }
  crossVectors(a,b) { this.x=a.y*b.z-a.z*b.y;this.y=a.z*b.x-a.x*b.z;this.z=a.x*b.y-a.y*b.x;return this; }
  multiplyScalar(k) { this.x*=k;this.y*=k;this.z*=k;return this; }
  add(v) { this.x+=v.x;this.y+=v.y;this.z+=v.z;return this; }
  addScaledVector(v,k) { this.x+=v.x*k;this.y+=v.y*k;this.z+=v.z*k;return this; }
}

test('зум меняет дистанцию и сдвигает target к курсору', () => {
  const ctx = {
    THREE:{Vector3:V3}, dist:1000, dMin:120, dMax:12000,theta:0,phi:Math.PI/2,
    target:new V3(), camera:{position:new V3(1000,0,0),up:new V3(0,0,1),fov:40},
    $:()=>({getBoundingClientRect:()=>({left:0,top:0,width:1000,height:500})}),
    panClamp(){ctx.clamped=(ctx.clamped||0)+1;},
  };
  vm.createContext(ctx);
  vm.runInContext(section('function zoomAt(x,y,factor)', '/* v2.46.032: двумя пальцами'), ctx);
  vm.runInContext('zoomAt(900,250,.5)', ctx);
  assert.equal(ctx.dist, 500);
  assert.ok(Math.hypot(ctx.target.x,ctx.target.y,ctx.target.z)>1, 'target остался в центре');
  assert.equal(ctx.clamped, 1);
});

test('панель координат по умолчанию справа и тащится только за заголовок', () => {
  assert.match(page, /#pos\{position:absolute;right:12px;bottom:58px/);
  assert.doesNotMatch(page, /#pos\{[^}]*left:50%/);
  assert.match(page, /id="posTitle"[^>]*Перетащи окно/);
  const drag = section('(function posDragBind()', '/* ═══ v2.46.001');
  assert.match(drag, /hd\.addEventListener\('pointerdown'/);
  assert.match(drag, /hd\.setPointerCapture\(e\.pointerId\)/);
  assert.doesNotMatch(drag, /box\.addEventListener\('pointerdown'/,
    'перетаскивание панели перехватывает ввод в полях');
  assert.match(drag, /hd\.addEventListener\('dblclick',[\s\S]*posReset\(\)/);
});

test('границы панели учитывают visualViewport мобильного экрана', () => {
  const style = {};
  const box = {
    classList:{contains:c=>c==='on'}, style,
    getBoundingClientRect:()=>({left:850,top:-20,width:322,height:400}),
  };
  const host = {getBoundingClientRect:()=>({left:100,top:50,width:800,height:600})};
  const ctx = {
    window:{visualViewport:{offsetLeft:0,offsetTop:100,width:1000,height:300}},
    $:q=>q==='#vwrap'?host:box,
  };
  vm.createContext(ctx);
  const code = 'const POS_EDGE=6;\n' + section('function posViewBounds()', 'function posReset()');
  vm.runInContext(code, ctx);
  vm.runInContext('posClamp()', ctx);
  assert.equal(style.left, '472px', 'правый край вышел за сцену');
  assert.equal(style.top, '56px', 'заголовок вышел за видимую область');
  assert.equal(style.maxHeight, '288px', 'окно не подстроилось под клавиатуру');
});
