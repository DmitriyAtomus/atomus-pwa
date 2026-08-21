/* Стенд врезки арматуры в трубу (v2.46.021).

   Гоняет НАСТОЯЩИЕ функции из chiller/project.html (их текст вынимается из
   файла и исполняется в песочнице с настоящим three.min.js) на НАСТОЯЩЕМ
   индексе базы 3D. Сцена, история и DOM заменены заглушками — проверяется
   геометрия: сходятся ли торцы участков с патрубками врезанной детали,
   держится ли общая длина трассы и переезжает ли на второй участок то, что
   висело на дальнем конце.

       node tools/chiller_cut_test.js [путь к pack/index.json]

   Индекс базы по умолчанию — ../atomus-3d-baza/generator/pack/index.json
   (собирается там же командой python make_pack.py). */
const fs=require('fs'),path=require('path'),vm=require('vm');
const SRC=fs.readFileSync('chiller/project.html','utf8');
const IXPATH=process.argv[2]||path.join(__dirname,'..','..',
  'atomus-3d-baza','generator','pack','index.json');
if(!fs.existsSync(IXPATH)){
  console.error('не нашёл индекс базы 3D: '+IXPATH);process.exit(2);}
const IX=JSON.parse(fs.readFileSync(IXPATH,'utf8'));

const ctx={console,Math,JSON,Map,Set,Array,String,Number,Object,isFinite,parseFloat,
           document:{},window:{},localStorage:{getItem:()=>null,setItem:()=>{}}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('chiller/three.min.js','utf8'),ctx);
vm.runInContext("var THREE=THREE||globalThis.THREE;",ctx);

/* вытаскиваем нужные функции из фронта как есть */
const grab=n=>{
  const re=new RegExp('^(?:async )?function '+n+'[(][^]*?^[}]','m');
  const m=SRC.match(re);
  if(!m)throw new Error('не нашёл функцию '+n);
  return m[0];
};
const NAMES=['connOf','connFit','isPipeSeg','setPipeLen','rotSeatLocal','mateZoneOf',
             'rotMate','pipeEnds','cutMates','zIdxOf','cutPlan','cutInsert'];
const CONST=SRC.match(/const CT_NAME=[\s\S]*?const nm1=[^\n]*\n/)[0]+
  SRC.match(/const SEC_ORD=[^\n]*\n/)[0]+
  SRC.match(/const PIPE_MIN=[^\n]*\n/)[0]+
  SRC.match(/const pipeBase=[^\n]*\n/)[0]+
  SRC.match(/const pipeLen=[^\n]*\n/)[0]+
  SRC.match(/const CUT_TURN=[^\n]*\n/)[0];

const HEAD=`
  var DATA=IXITEMS, GEOMS=IXGEOMS, MATE_CACHE=new Map(), placed=[], uidSeq=1;
  var LOG=[], sel=null;
  function toast(t){LOG.push(t);}
  function roleOf(d){return d.section==='pipe'?'pipe':(d.section==='valves'?'line':'x');}
  function histBegin(){return false;} function histEnd(){}
  function select(it){sel=it;} function checkCollisions(){} function showSelZ(){}
  function refresh(){placed.forEach(p=>{if(p.link&&p.link.mount==='rot')rotMate(p);});}
  function save(){}
  function mkGeo(d){
    const bb=(GEOMS[d.g]||{}).bb||{lo:[-50,-15,-15],hi:[50,15,15]};
    const g=new THREE.BoxGeometry(bb.hi[0]-bb.lo[0]||1,bb.hi[1]-bb.lo[1]||1,
                                  bb.hi[2]-bb.lo[2]||1);
    g.computeBoundingBox();
    g.boundingBox.min.set(bb.lo[0],bb.lo[1],bb.lo[2]);
    g.boundingBox.max.set(bb.hi[0],bb.hi[1],bb.hi[2]);
    return g;
  }
  async function addItem(d,at){
    const obj=new THREE.Mesh(mkGeo(d),null);
    obj.position.set(at.x,at.y,at.z);obj.updateMatrixWorld(true);
    const it={uid:uidSeq++,id:d.id,obj:obj,d:d,pin:false,link:null,off:[],
              zn:((GEOMS[d.g]||{}).zn||[]).slice()};
    placed.push(it);return it;
  }
`;
vm.runInContext(HEAD.replace('IXITEMS','('+JSON.stringify(IX.items)+')')
                    .replace('IXGEOMS','('+JSON.stringify(IX.geoms)+')'),ctx);
vm.runInContext(CONST+'\n'+NAMES.map(grab).join('\n'),ctx);



/* ── случай 2: труба сидит на патрубке, на дальнем конце висит деталь ── */
const T2=`(async()=>{
  placed.length=0;uidSeq=1;LOG.length=0;
  const pipe=DATA.find(d=>/труба PP-R PN20 Ø20/.test(d.name));
  const tee=DATA.find(d=>d.name==='Тройник 20');
  const host=await addItem(tee,{x:0,y:0,z:400});
  const it=await addItem(pipe,{x:0,y:0,z:400});
  it.link={to:host.uid,mount:'rot',face:'port',zi:0,pzi:0};
  setPipeLen(it,900);
  const end=await addItem(tee,{x:0,y:0,z:400});       // фитинг на дальнем торце
  end.link={to:it.uid,mount:'rot',face:'port',zi:1,pzi:1};
  rotMate(end);
  const e0=pipeEnds(it), A0=e0.A.clone(), B0=e0.B.clone();
  const endPos0=end.obj.position.clone();
  const c=connOf(it.zn[e0.fi]);
  const m=cutMates(c).find(x=>x.d.name==='Тройник 20');
  await cutInsert(it,m,e0.A.clone().addScaledVector(e0.u,300));
  const p1=placed.find(x=>x.uid===it.uid), v=placed[3], p2=placed[4];
  const e1=pipeEnds(p1), e2=pipeEnds(p2);
  v.obj.updateMatrixWorld(true);
  const s1=rotSeatLocal(v.zn[v.link.pzi]).applyMatrix4(v.obj.matrixWorld);
  const s2=rotSeatLocal(v.zn[p2.link.zi]).applyMatrix4(v.obj.matrixWorld);
  rotMate(end);
  return {n:placed.length,log:LOG.slice(),
          startMoved:A0.distanceTo(e1.A),          // начало трассы осталось на месте
          gap1:e1.B.distanceTo(s1),gap2:e2.A.distanceTo(s2),
          farKept:B0.distanceTo(e2.B),             // дальний торец там же
          tailTo:end.link.to,tailZi:end.link.zi,tailUid:p2.uid,
          tailMoved:endPos0.distanceTo(end.obj.position),
          L1:pipeLen(p1),L2:pipeLen(p2),sp:m.sp,
          hostLink:p1.link&&p1.link.to};
})()`;

/* ── случай 3: короткий отрезок и врезка у самого торца ── */
const T3=`(async()=>{
  placed.length=0;uidSeq=1;LOG.length=0;
  const pipe=DATA.find(d=>/труба PP-R PN20 Ø20/.test(d.name));
  const it=await addItem(pipe,{x:0,y:0,z:300});
  setPipeLen(it,60);
  const c=connOf(it.zn[1]);
  const m=cutMates(c).find(x=>x.d.name==='Тройник 20');
  const plan=cutPlan(it,m.sp,null);
  await cutInsert(it,m,null);
  const R={err:plan.err,n:placed.length,log:LOG.slice()};
  /* тот же тройник, но в длинную трубу и с нажатием у самого края */
  placed.length=0;uidSeq=1;LOG.length=0;
  const it2=await addItem(pipe,{x:0,y:0,z:300});
  setPipeLen(it2,400);
  const e=pipeEnds(it2);
  await cutInsert(it2,m,e.A.clone().addScaledVector(e.u,398));
  R.edge={L1:pipeLen(placed[0]),L2:placed[2]?pipeLen(placed[2]):null,
          n:placed.length,log:LOG.slice(),plan:cutPlan(it2,m.sp,null)};
  if(placed.length<3)return R;
  /* и вторая врезка — уже во второй участок длинной трубы */
  placed.length=0;uidSeq=1;LOG.length=0;
  const it3=await addItem(pipe,{x:0,y:0,z:300});
  setPipeLen(it3,1500);
  const e3=pipeEnds(it3);
  await cutInsert(it3,m,e3.A.clone().addScaledVector(e3.u,500));
  const mid=placed[2],em=pipeEnds(mid);
  await cutInsert(mid,m,em.A.clone().addScaledVector(em.u,400));
  const last=placed[4];
  const ends=pipeEnds(last);
  R.again={n:placed.length,L1:pipeLen(placed[0]),L2:pipeLen(mid),L3:pipeLen(last),
           link3:last.link&&last.link.mount,log:LOG.slice(),
           total:pipeEnds(placed[0]).A.distanceTo(ends.B)};
  return R;
})()`;

/* ── проверки ─────────────────────────────────────────────────────────── */
let fail=0;
const ok=(c,t,extra)=>{console.log((c?'  ok  ':'ПЛОХО ')+t+(extra?('  '+extra):''));if(!c)fail++;};

const T=`(async()=>{
  const pipe=DATA.find(d=>/труба PP-R PN20 Ø20/.test(d.name));
  const it=await addItem(pipe,{x:0,y:0,z:300});
  setPipeLen(it,1200);
  const R={};
  R.isPipe=isPipeSeg(it);
  const e=pipeEnds(it);
  R.ends={D:e.D,k:e.k,si:e.si,fi:e.fi,A:e.A.toArray(),B:e.B.toArray()};
  const c=connOf(it.zn[e.fi]);
  R.conn=c;
  const list=cutMates(c);
  R.list=list.map(m=>({n:m.d.name,sp:Math.round(m.sp*10)/10,zi:m.zi,zj:m.zj}));
  const tee=list.find(m=>/^Тройник \d+$/.test(m.d.name))||list[0];
  /* врезаем на 400 мм от первого торца */
  const pt=e.A.clone().addScaledVector(e.u,400);
  await cutInsert(it,tee,pt);
  R.log=LOG.slice();
  R.n=placed.length;
  const v=placed[1],p2=placed[2];
  const e1=pipeEnds(placed[0]),e2=pipeEnds(p2);
  R.piece1={len:pipeLen(placed[0]),A:e1.A.toArray(),B:e1.B.toArray()};
  R.valve={name:v.d.name,link:v.link,pos:v.obj.position.toArray()};
  R.piece2={len:pipeLen(p2),A:e2.A.toArray(),B:e2.B.toArray(),link:p2.link};
  /* совпали ли стыки: конец 1-го участка = вход арматуры, выход = начало 2-го */
  const vz=v.zn[v.link.pzi],vz2=v.zn[p2.link.zi];
  v.obj.updateMatrixWorld(true);
  const s1=rotSeatLocal(vz).applyMatrix4(v.obj.matrixWorld);
  const s2=rotSeatLocal(vz2).applyMatrix4(v.obj.matrixWorld);
  R.gap1=e1.B.distanceTo(s1); R.gap2=e2.A.distanceTo(s2);
  R.total=e1.A.distanceTo(e2.B);
  R.axis=e1.u.dot(e2.u);
  return R;
})()`;
vm.runInContext(T,ctx).then(R=>{
  console.log('\nтруба Ø20, отрезок 1200 мм, врезка на 400 мм от начала');
  console.log('концы: D='+R.ends.D+' k='+R.ends.k+' si='+R.ends.si+' fi='+R.ends.fi);
  console.log('присоединение:',JSON.stringify(R.conn));
  console.log('кандидатов в разрыв:',R.list.length);
  R.list.forEach(m=>console.log('   ',m.sp,'мм ',m.n));
  console.log('лог:',R.log.join(' | '));
  ok(R.isPipe,'отрезок опознан как труба');
  ok(R.ends.D===1200,'расстояние между торцами = длине (seat 250 при базе 500)','D='+R.ends.D);
  ok(R.list.length>0,'есть что врезать');
  ok(!R.list.some(m=>/угольник|двухплоскостн/i.test(m.n)),'угольник и двухплоскостной отсеяны');
  ok(R.n===3,'в сцене три детали: участок, арматура, участок','n='+R.n);
  console.log('участок 1:',R.piece1.len,'мм  участок 2:',R.piece2.len,'мм');
  ok(R.gap1<0.01,'первый участок упёрся в арматуру','зазор '+R.gap1.toFixed(3)+' мм');
  ok(R.gap2<0.01,'второй участок сел на выход арматуры','зазор '+R.gap2.toFixed(3)+' мм');
  ok(Math.abs(R.total-1200)<1.5,'общая длина трассы не изменилась','стало '+R.total.toFixed(1)+' мм');
  ok(R.axis>0.999,'оба участка на одной оси','cos='+R.axis.toFixed(4));
  ok(Math.abs(R.piece1.len-(400-R.list.find(m=>m.n===R.valve.name).sp/2))<1.5,
     'первый участок отмерен от точки нажатия','len='+R.piece1.len);
  ok(R.valve.link&&R.valve.link.mount==='rot','арматура сидит на торце трубы');
  ok(R.piece2.link&&R.piece2.link.mount==='rot','второй участок сидит на арматуре');
  return vm.runInContext(T2,ctx);
}).then(R=>{
  console.log('\n— труба на патрубке, на дальнем конце фитинг —');
  console.log('лог:',R.log.join(' | '));
  console.log('участки',R.L1,'и',R.L2,'мм, арматура',R.sp,'мм');
  ok(R.n===5,'в сцене пять деталей','n='+R.n);
  ok(R.startMoved<0.01,'начало трассы не сдвинулось','ушло '+R.startMoved.toFixed(3));
  ok(R.gap1<0.01,'первый участок упёрся в арматуру','зазор '+R.gap1.toFixed(3));
  ok(R.gap2<0.01,'второй участок сел на арматуру','зазор '+R.gap2.toFixed(3));
  ok(R.farKept<1.5,'дальний торец остался на месте','ушёл на '+R.farKept.toFixed(1)+' мм');
  ok(R.tailTo===R.tailUid&&R.tailZi===1,'фитинг с дальнего конца переехал на второй участок');
  ok(R.tailMoved<1.5,'и остался на своём месте','ушёл на '+R.tailMoved.toFixed(1)+' мм');
  ok(R.hostLink===1,'первый участок остался на своём патрубке');
  return vm.runInContext(T3,ctx);
}).then(R=>{
  console.log('\n— короткий отрезок и край —');
  console.log('короткий:',R.err,'| лог:',R.log.join(' | '));
  ok(!!R.err,'на 60 мм врезка отбита с объяснением');
  ok(R.n===1,'сцена не тронута','n='+R.n);
  console.log('нажатие у края: участки',R.edge.L1,'и',R.edge.L2,'мм');
  ok(R.edge.n===3,'врезка у края всё равно прошла');
  ok(R.edge.L1>=20&&R.edge.L2>=20,'оба участка не короче 20 мм');
  console.log('вторая врезка:',R.again.log.join(' | '));
  ok(R.again.n===5,'второй раз режется уже второй участок','n='+R.again.n);
  console.log('трасса 1500 мм после двух врезок: участки '+R.again.L1+' + '+R.again.L2+
    ' + '+R.again.L3+', всего '+R.again.total.toFixed(1)+' мм');
  ok(Math.abs(R.again.total-1500)<2,'длина трассы держится после двух врезок');
  ok(R.again.link3==='rot','третий участок сцеплен с арматурой');
  console.log(fail?('\nПРОВАЛОВ: '+fail):'\nвсё сошлось');
  process.exit(fail?1:0);
}).catch(e=>{console.error('СТЕНД УПАЛ:',e);process.exit(1);});
