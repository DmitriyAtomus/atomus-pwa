/* Стенд «скрыть панель под курсором» (v2.46.062).

   Берёт НАСТОЯЩИЕ функции из chiller/project.html (partPick, applyOff,
   partGroups) и НАСТОЯЩИЙ меш корпуса чиллера из pack/mesh. Сцена, DOM и
   история заменены заглушками — проверяется само попадание луча в деталь
   сборки и гашение:

     1) луч сверху находит верхнюю деталь корпуса;
     2) после гашения луч проходит сквозь неё и берёт следующую;
     3) ключ «#индекс» переживает applyOff (как при открытии проекта);
     4) гашение строки списка гасит все её экземпляры разом.

       node tools/chiller_hide_test.js [путь к pack/index.json]
*/
const fs=require('fs'),path=require('path'),vm=require('vm'),zlib=require('zlib');
const SRC=fs.readFileSync('chiller/project.html','utf8');
const IXPATH=process.argv[2]||path.join(__dirname,'..','..',
  'atomus-3d-baza','generator','pack','index.json');
if(!fs.existsSync(IXPATH)){
  console.error('не нашёл индекс базы 3D: '+IXPATH);process.exit(2);}
const IX=JSON.parse(fs.readFileSync(IXPATH,'utf8'));
const GK='frame-chiller-600x900';
const MPATH=path.join(path.dirname(IXPATH),'mesh',GK+'.json.gz');
if(!fs.existsSync(MPATH)){console.error('не нашёл меш корпуса: '+MPATH);process.exit(2);}
const MS=JSON.parse(zlib.gunzipSync(fs.readFileSync(MPATH)).toString('utf8'));

const ctx={console,Math,JSON,Map,Set,Array,String,Number,Object,isFinite,parseFloat,
  document:{},window:{},localStorage:{getItem:()=>null,setItem:()=>{}}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('chiller/three.min.js','utf8'),ctx);
vm.runInContext('var THREE=THREE||globalThis.THREE;',ctx);

const grab=n=>{
  const m=SRC.match(new RegExp('^(?:async )?function '+n+'[(][^]*?^[}]','m'));
  if(!m)throw new Error('не нашёл функцию '+n);
  return m[0];
};
['partPick','partGroups','applyOff','partLabel'].forEach(n=>{
  if(n==='partLabel'){
    const m=SRC.match(/^const partLabel=[^\n]*$/m);
    if(!m)throw new Error('не нашёл partLabel');
    vm.runInContext(m[0]+';globalThis.partLabel=partLabel;',ctx);return;
  }
  vm.runInContext(grab(n),ctx);
});
/* окружение сцены: то, чем пользуются вынутые функции */
vm.runInContext(`
  var placed=[],sel=null,ray=new THREE.Raycaster(),ndc=new THREE.Vector2(),
      camera=new THREE.PerspectiveCamera(45,1.6,1,20000),
      TFIT_KEYS=[];
  function toNDC(){}                       // луч ставим руками
  function tankHideBaked(){}
`,ctx);

/* геометрия из квантованного меша — тем же кодом, что во фронте */
const b64=s=>Buffer.from(s,'base64');
function geoOf(){
  const pb=b64(MS.pos),p16=new Uint16Array(pb.buffer,pb.byteOffset,pb.length/2);
  const ib=b64(MS.idx);
  const i16=MS.i32?new Uint32Array(ib.buffer,ib.byteOffset,ib.length/4)
                  :new Uint16Array(ib.buffer,ib.byteOffset,ib.length/2);
  const pos=new Float32Array(p16.length);
  for(let i=0;i<p16.length;i+=3){
    pos[i]  =MS.lo[0]+p16[i]  *MS.scale[0];
    pos[i+1]=MS.lo[1]+p16[i+1]*MS.scale[1];
    pos[i+2]=MS.lo[2]+p16[i+2]*MS.scale[2];}
  const T=ctx.THREE;
  const geo=new T.BufferGeometry();
  geo.setAttribute('position',new T.BufferAttribute(pos,3));
  geo.setIndex(new T.BufferAttribute(i16.slice(),1));
  geo.computeVertexNormals();geo.computeBoundingBox();
  const parts=(MS.parts||[]).filter(p=>p.count>0);
  parts.forEach((p,i)=>geo.addGroup(p.start,p.count,i));
  geo.userData.parts=parts.map(p=>({des:p.des||'—',name:p.name||'деталь'}));
  return geo;
}
const T=ctx.THREE;
const geo=geoOf();
const mats=geo.userData.parts.map(()=>new T.MeshStandardMaterial());
const obj=new T.Mesh(geo,mats);
obj.updateMatrixWorld(true);
const it={uid:1,obj:obj,d:{name:'Корпус чиллера 600×900'},off:[]};
ctx.placed.push(it);

/* луч вместо мыши: partPick зовёт toNDC(e) и ray.setFromCamera —
   подменяем setFromCamera на постановку заданного луча */
function shoot(origin,dir){
  ctx.ray.set(new T.Vector3(...origin),new T.Vector3(...dir).normalize());
  ctx.ray.setFromCamera=()=>{};
  return ctx.partPick({clientX:0,clientY:0});
}
const bb=geo.boundingBox,c=bb.getCenter(new T.Vector3());
let bad=0;
const ok=(cond,msg)=>{console.log((cond?'  ok  ':'ПРОВАЛ')+'  '+msg);if(!cond)bad++;};

console.log('корпус '+GK+': '+geo.userData.parts.length+' деталей, габарит '+
  Math.round(bb.max.x-bb.min.x)+' × '+Math.round(bb.max.y-bb.min.y)+' × '+
  Math.round(bb.max.z-bb.min.z)+' мм');

/* 1. луч сверху вниз по крыше. Ровно по центру крыши проём под вентилятор —
   там луч честно уходит внутрь, поэтому целимся в металл рядом с проёмом. */
const from=[c.x+320,c.y,bb.max.z+500];
let h=shoot(from,[0,0,-1]);
ok(!!h,'сверху луч попал в деталь: '+(h?ctx.partLabel(h.p):'—'));
const first=h&&h.pi;

/* 2. гасим деталь ключом «#индекс» — под ней луч должен взять следующую.
   Точку ищем сканированием: над рамой корпус местами пустой насквозь. */
let thru=null;
for(let dx=-420;dx<=420&&!thru;dx+=30)
  for(let dy=-280;dy<=280&&!thru;dy+=30){
    const o=[c.x+dx,c.y+dy,bb.max.z+500];
    const a=shoot(o,[0,0,-1]);if(!a)continue;
    mats[a.pi].visible=false;
    const b=shoot(o,[0,0,-1]);
    mats[a.pi].visible=true;
    if(b&&b.pi!==a.pi)thru={a:a,b:b};
  }
ok(!!thru,'сквозь погашенную деталь виден низ: '+
  (thru?ctx.partLabel(thru.a.p)+' → '+ctx.partLabel(thru.b.p):'—'));

/* 3. ключ переживает applyOff — как при открытии сохранённого проекта */
it.off=['#'+first];
mats.forEach(m=>{m.visible=true;});
ctx.applyOff(it);
ok(mats[first].visible===false,'applyOff вернул гашение по ключу #'+first);
ok(mats.filter(m=>m.visible===false).length===1,'погашена ровно одна деталь');

/* 4. гашение строки списка гасит все её экземпляры */
const gs=ctx.partGroups(it);
const many=gs.find(g=>g.idx.length>1);
it.off=[many.k];ctx.applyOff(it);
ok(many.idx.every(i=>mats[i].visible===false)&&mats[first].visible===(first===many.idx[0]?false:true)||
   many.idx.indexOf(first)>=0,
   'строка «'+many.name+'» ×'+many.idx.length+' гаснет целиком');
ok(mats.filter(m=>m.visible===false).length===many.idx.length,
   'ничего лишнего не погашено ('+many.idx.length+' шт.)');

/* 5. сбоку: боковина решётчатая, поэтому сканируем несколько точек —
   хоть одна должна лечь в металл боковой панели */
it.off=[];ctx.applyOff(it);
let side=null;
for(let dz=-200;dz<=200&&!side;dz+=50)
  for(let dy=-200;dy<=200&&!side;dy+=50)
    side=shoot([bb.max.x+800,c.y+dy,c.z+dz],[-1,0,0]);
ok(!!side,'сбоку луч попал в деталь: '+(side?ctx.partLabel(side.p):'—'));

console.log(bad?('\nпровалов: '+bad):'\nвсё сошлось');
process.exit(bad?1:0);
