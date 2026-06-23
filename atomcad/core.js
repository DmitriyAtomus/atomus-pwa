// AtomCAD core logic — чистые функции, без DOM. Тестируется отдельно.
(function(g){
'use strict';

var STD=[1,2,3,4,6,10,13,16,20,25,32,40,50,63,80,100,125]; // ряд номиналов, А

function consumerCurrent(c){
  if(c.a)return +c.a;
  if(!c.kw)return 0;
  var U=c.volt||(c.phases===3?400:230);
  var p;
  if(c.phases===3) p=Math.sqrt(3)*U*0.85;        // 3ф AC, cosφ=0.85
  else if(U>=110)  p=U*0.9;                        // 1ф сетевое AC, cosφ=0.9
  else             p=U;                            // низковольтное (24/12 В), пост. ток / cosφ≈1
  return +(c.kw*1000/p).toFixed(1);
}
function stdRating(I){ for(var i=0;i<STD.length;i++) if(STD[i]>=I) return STD[i]; return STD[STD.length-1]; }
function ratingFor(I){ return stdRating(I*1.25); } // запас 25%

// нужен ли потребителю контактор (коммутация)
function needsContactor(c){ return c.needs!=='direct'; }

// контактор серии CHINT NC1 — типоразмер по рабочему току (AC-3), катушка =230В, 50 Гц
var NC1=[{a:9,m:'NC1-0910',aux:'1НО',w:45,h:75,d:87},{a:12,m:'NC1-1210',aux:'1НО',w:45,h:75,d:87},{a:18,m:'NC1-1810',aux:'1НО',w:45,h:75,d:87},{a:25,m:'NC1-2510',aux:'1НО',w:45,h:80,d:87},{a:32,m:'NC1-3210',aux:'1НО',w:45,h:80,d:87},{a:40,m:'NC1-4011',aux:'1НО+1НЗ',w:55,h:85,d:92},{a:50,m:'NC1-5011',aux:'1НО+1НЗ',w:55,h:85,d:92},{a:65,m:'NC1-6511',aux:'1НО+1НЗ',w:55,h:90,d:100},{a:80,m:'NC1-8011',aux:'1НО+1НЗ',w:70,h:95,d:112},{a:95,m:'NC1-9511',aux:'1НО+1НЗ',w:70,h:95,d:112}];
function contactorPick(curA){ curA=+curA||0; for(var i=0;i<NC1.length;i++){ if(NC1[i].a>=curA) return NC1[i]; } return NC1[NC1.length-1]; }
// строка модели для спецификации/подсказки: «NC1-1210 12А 230В AC-3 1НО»
function contactorModel(c){ var n=contactorPick(consumerCurrent(c)); return n.m+' '+n.a+'А 230В AC-3 '+n.aux; }
// реальный габарит контактора (Ш×В×Г) — для понимания размера
function contactorDimStr(c){ var n=contactorPick(consumerCurrent(c)); return n.w+'×'+n.h+'×'+n.d+' мм · 3-пол.'; }
// символ УГО для аппарата из «Вспомогат.» в редакторе (ключи совпадают с SYM в editor.html)
function auxSym2(k){return ({button:'sb_no',estop:'sb_nc',switch:'sb_no',relay:'coil',ssr:'box',psu:'box',vfd:'box',fan:'m3',contactor:'km3',breaker:'qf1',other:'box'})[k]||'box';}

// низковольтный потребитель (24/12 В) — питается от БП, а не от ввода
function isLV(c){ return c.phases!==3 && (c.volt||230) < 110; }
var PSU_W=[15,30,60,100,120,150,240,350,480,720,960];
// группировка НН-потребителей по напряжению → требуемые блоки питания (авто-мощность)
function lvSupplies(P){
  var byV={};
  (P.consumers||[]).forEach(function(c){
    if(!isLV(c))return;
    var v=c.volt||24, q=c.qty||1, w=(c.kw||0)*1000*q;
    if(!byV[v])byV[v]={volt:v,sumW:0,count:0};
    byV[v].sumW+=w; byV[v].count+=q;
  });
  var out=[];
  Object.keys(byV).forEach(function(k){
    var g=byV[k], need=g.sumW*1.3, rw=PSU_W[PSU_W.length-1];
    for(var i=0;i<PSU_W.length;i++){ if(PSU_W[i]>=need){ rw=PSU_W[i]; break; } }
    var primA=+(rw/(230*0.85)).toFixed(2);   // первичный ток БП (230В, КПД≈0.85)
    out.push({volt:g.volt, sumW:Math.round(g.sumW), count:g.count, ratingW:rw, primaryA:primA});
  });
  out.sort(function(a,b){return b.volt-a.volt});
  return out;
}

// автоматы из состава: ввод + по группам потребителей + управление
function buildBreakers(P){
  var b=[], n=1;
  var psus=lvSupplies(P);
  // ввод: сетевые потребители + первичка блоков питания (НН-потребители напрямую НЕ грузят ввод)
  var tot=0;
  P.consumers.forEach(function(c){ if(isLV(c))return; tot+=consumerCurrent(c)*(c.qty||1); });
  psus.forEach(function(p){ tot+=p.primaryA; });
  var introRate = ratingFor(tot);
  b.push({id:'QF'+n, code:'QF'+n, poles:3, rate: Math.max(introRate,16), role:'ввод', loads:[{name:'Σ нагрузка щита', a:+tot.toFixed(1)}], fixed:true}); n++;
  // по сетевым потребителям (НН пропускаем — они на БП)
  P.consumers.forEach(function(c){
    if(isLV(c))return;
    var I=consumerCurrent(c), q=c.qty||1;
    for(var k=0;k<q;k++){
      var nm=c.name+(q>1?(' #'+(k+1)):'');
      b.push({id:'QF'+n, code:'QF'+n, poles:c.phases===3?3:1, rate:ratingFor(I), role:nm, loads:[{name:nm, a:I, cid:c.id}], consumer:c.id});
      n++;
    }
  });
  // блоки питания низковольтных цепей (24/12 В) — отдельные линии, первичка от ввода
  psus.forEach(function(p){
    b.push({id:'QF'+n, code:'QF'+n, poles:1, rate:stdRating(p.primaryA*1.25)||6,
            role:'питание '+p.volt+'В (БП '+p.ratingW+'Вт)',
            loads:[{name:'БП '+p.volt+'В · нагрузка '+p.sumW+' Вт', a:p.primaryA}], psu:p.volt}); n++;
  });
  // управление
  var ctrlA = 0.8 + P.aux.reduce(function(s,a){return s+(a.a||0)},0);
  b.push({id:'QF'+n, code:'QF'+n, poles:1, rate:stdRating(ctrlA*1.25)||4, role:'цепи управления', loads:[{name:'Контроллер + вспом.', a:+ctrlA.toFixed(1)}]});
  return b;
}
function breakerSum(b){ return +(b.loads||[]).reduce(function(s,l){return s+(+l.a||0)},0).toFixed(1); }
function breakerStatus(b){ var s=breakerSum(b),r=b.rate; return s>r?'over':s>r*0.8?'warn':'ok'; }

// баланс фаз: 3ф нагрузки делятся на 3; 1ф раскидываются round-robin
function phaseBalance(P){
  var ph={L1:0,L2:0,L3:0}, ks=['L1','L2','L3'], idx=0;
  P.consumers.forEach(function(c){
    if(isLV(c))return;               // НН-потребители висят на БП, не на фазах напрямую
    var I=consumerCurrent(c), q=c.qty||1;
    if(c.phases===3){ ph.L1+=I*q; ph.L2+=I*q; ph.L3+=I*q; }
    else { for(var k=0;k<q;k++){ ph[ks[idx%3]]+=I; idx++; } }
  });
  // блоки питания — однофазная нагрузка (первичка), раскидываем по фазам
  lvSupplies(P).forEach(function(p){ ph[ks[idx%3]]+=p.primaryA; idx++; });
  return {L1:+ph.L1.toFixed(1), L2:+ph.L2.toFixed(1), L3:+ph.L3.toFixed(1)};
}

// сечение по току (ПУЭ-упрощённо, медь)
function sectionFor(I){
  var t=[[10,1.0],[16,1.5],[25,2.5],[32,4],[40,6],[50,10],[80,16],[100,25]];
  for(var i=0;i<t.length;i++) if(I<=t[i][0]) return t[i][1];
  return 35;
}

// карта занятости I/O контроллера
function ioFree(io,type){ var n=0; (io.pins[type]||[]).forEach(function(p){ if(!io.asg[p.id]) n++; }); return n; }
function ioTotal(io,type){ return (io.pins[type]||[]).length; }

// спецификация из собранного проекта
var DESNAME={QF:'Выключатель автоматический',KM:'Контактор',A:'Контроллер',BT:'Датчик температуры',
  HL:'Лампа сигнальная',KA:'Реле',G:'Блок питания',X:'Клеммник',KK:'Реле тепловое'};
function compressDes(list){
  if(list.length>=3){ var p=(/^[A-Za-zА-Яа-я]+/.exec(list[0])||[''])[0].toUpperCase(), nums=[], ok=true;
    list.forEach(function(d){var m=/^([A-Za-zА-Яа-я]+)(\d+)$/.exec(d); if(!m||m[1].toUpperCase()!==p)ok=false; else nums.push(+m[2]);});
    if(ok){ var c=true; for(var i=1;i<nums.length;i++) if(nums[i]!==nums[i-1]+1) c=false; if(c) return list[0]+'…'+list[list.length-1]; }
  }
  return list.join(', ');
}
function natKey(d){var m=/^([A-Za-zА-Яа-я]+)(\d*)/.exec(d)||[];return (m[1]||'')+(m[2]?('00000'+m[2]).slice(-5):'')}
// удалённые пользователем элементы щита (обратимо): набор стабильных токенов в P.cab.removed
function isRemoved(P,token){return !!(P&&P.cab&&P.cab.removed&&P.cab.removed[token]);}
function buildSpec(P){
  var items=[]; // {des, name, manu, model, note}
  // контроллер
  if(P.controller&&P.controller.model) items.push({des:'A1', name:'Контроллер', manu:'', model:P.controller.model, note:'ядро щита'});
  // сенсорная панель (HMI) на двери
  if(P.hmi&&P.hmi.model){ var hd=P.hmi.dims||{}, hc=P.hmi.cut||{}; var hdim=(hd.w||'?')+'×'+(hd.h||'?')+(hd.d?'×'+hd.d:'')+' мм'; var cutStr=(+hc.w&&+hc.h)?(' · вырез '+(+hc.w)+'×'+(+hc.h)+' мм'):''; var hnote='на дверь · '+hdim+cutStr+(P.hmi.terminals&&P.hmi.terminals.length?(' · клеммы '+P.hmi.terminals.join('/')):'')+' · RS-485'; items.push({des:'A2', name:'Панель оператора (HMI)', manu:P.hmi.manu||'', model:P.hmi.model, note:hnote}); }
  // автоматы
  (P.breakers||[]).forEach(function(b){ if(isRemoved(P,'qf|'+b.code))return; items.push({des:b.code, name:'Выключатель автоматический', manu:'CHINT', model:'NB1-63 '+b.poles+'P, C'+b.rate, note:b.role}); });
  // контакторы под потребители
  var kmN=1;
  (P.consumers||[]).forEach(function(c){ if(needsContactor(c)){ var q=c.qty||1; for(var k=0;k<q;k++){ if(isRemoved(P,'km|'+c.id+'|'+k))continue; items.push({des:'KM'+kmN, name:'Контактор электромагнитный', manu:'CHINT', model:contactorModel(c), note:c.name+(q>1?(' #'+(k+1)):'')}); kmN++; } } });
  // датчики
  var btN=1;
  (P.sensors||[]).forEach(function(s){ var q=s.qty||1; for(var k=0;k<q;k++){ items.push({des:'BT'+btN, name:'Датчик температуры', manu:'', model:s.sig, note:s.name}); btN++; } });
  // вспомогательное
  var hlN=1;
  (P.aux||[]).forEach(function(a){ var q=a.qty||1; for(var k=0;k<q;k++){ if(isRemoved(P,'aux|'+a.id+'|'+k))continue; var base=a.tag||(a.kind==='lamp'?('HL'+hlN):a.kind==='psu'?'G1':a.kind==='ssr'?'KA1':'E'+hlN); var des=q>1?(base+'.'+(k+1)):base; if(!a.tag&&a.kind==='lamp')hlN++; items.push({des:des, name:a.name, manu:a.manu||'', model:a.model||'', note:a.note||''}); } });
  // блоки питания низковольтных цепей (авто — по НН-потребителям)
  var psuBase=(P.aux||[]).filter(function(a){return a.kind==='psu'}).reduce(function(s,a){return s+(a.qty||1)},0);
  var gN=1;
  lvSupplies(P).forEach(function(p){ items.push({des:'G'+(psuBase+gN), name:'Блок питания', manu:'', model:p.volt+'В '+p.ratingW+'Вт', note:'питание '+p.volt+'В · нагрузка '+p.sumW+' Вт ('+p.count+' шт)'}); gN++; });
  // корпус
  if(P.enclosure&&P.enclosure.model) items.push({des:'—', name:'Корпус щита', manu:'', model:P.enclosure.model, note:P.enclosure.modules+' мод.'});

  // группировка
  var groups={}, order=[];
  items.forEach(function(it){
    var key=it.name+'|'+it.manu+'|'+it.model;
    if(!groups[key]){ groups[key]={name:it.name,manu:it.manu,model:it.model,des:[it.des],notes:it.note?[it.note]:[]}; order.push(key); }
    else { var gg=groups[key]; gg.des.push(it.des); if(it.note&&gg.notes.indexOf(it.note)<0) gg.notes.push(it.note); }
  });
  var arr=order.map(function(k){return groups[k]});
  arr.forEach(function(gp){ gp.des.sort(function(a,b){return natKey(a)<natKey(b)?-1:1}); gp.desStr=compressDes(gp.des); gp.qty=gp.des.length; });
  arr.sort(function(a,b){return natKey(a.des[0])<natKey(b.des[0])?-1:1});
  return arr;
}

// число модулей и подбор корпуса
function moduleCount(P){
  var m=0;
  (P.breakers||[]).forEach(function(b){ if(isRemoved(P,'qf|'+b.code))return; m+= b.poles===3?3:1; });
  (P.consumers||[]).forEach(function(c){ if(needsContactor(c)){ var q=c.qty||1; for(var k=0;k<q;k++){ if(isRemoved(P,'km|'+c.id+'|'+k))continue; m+= c.phases===3?2:1; } } });
  (P.aux||[]).forEach(function(a){ m+= (a.kind==='psu')?2:1; });
  lvSupplies(P).forEach(function(){ m+=2; }); // авто-БП низковольтных цепей
  m+=4; // клеммы/резерв базовый
  return m;
}
var ENCL=[{model:'IEK ЩРн-24',modules:24},{model:'IEK ЩРн-36з',modules:36},{model:'IEK ЩРн-48з-1',modules:48},{model:'IEK ЩРн-72з',modules:72},{model:'IEK ЩРн-96',modules:96}];
function pickEnclosure(P){ var need=Math.ceil(moduleCount(P)*1.3); for(var i=0;i<ENCL.length;i++) if(ENCL[i].modules>=need) return ENCL[i]; return ENCL[ENCL.length-1]; }

// генерация однолинейной схемы (компоненты+провода) для редактора
function shortLbl(s,n){s=String(s||'');n=n||16;return s.length>n?s.slice(0,n-1)+'…':s;}
// геометрия выводов контроллера — ДОЛЖНА совпадать с ctrlSym() в editor.html
function _ctrlGeom(io){
  var pn=(io&&io.pins)||{}, asg=(io&&io.asg)||{}, left=[], right=[];
  ['AI','DI'].forEach(function(g){(pn[g]||[]).forEach(function(p){left.push({id:p.id,lab:asg[p.id]||'',g:g});});});
  ['AO','DO'].forEach(function(g){(pn[g]||[]).forEach(function(p){right.push({id:p.id,lab:asg[p.id]||'',g:g});});});
  var rows=Math.max(left.length,right.length,1), pitch=rows>14?50:rows>8?66:84;
  var hx=230, stub=70, header=110, padB=40, bodyH=header+rows*pitch+padB;
  return {left:left,right:right,rows:rows,pitch:pitch,hx:hx,stub:stub,header:header,padB:padB,bodyH:bodyH,
    pinY:function(i){return header+padB/2+i*pitch+pitch/2;}};
}
function C(des,sym,xx,yy,model,manu,note,nm){var a={};if(model)a.model=model;if(manu)a.manu=manu;if(note)a.note=note;if(nm)a.nm=nm;return {sym:sym,x:xx,y:yy,rot:0,mirror:false,des:des,attrs:a};}
function _W(){var pts=[].slice.call(arguments);return {pts:pts.map(function(p){return {x:p[0],y:p[1]}})};}
// рамка листа A3 (×10 мм) — ДОЛЖНА совпадать с editor.html (SW/SH и штамп)
var SHEET_W=4200, SHEET_H=2970, TITLE_X=2300, TITLE_Y=2370;
/* листы «аппараты управления»: сетка в пределах рамки, перенос на новый лист при нехватке места */
function buildAuxSheets(P){
  var units=[];
  (P.aux||[]).forEach(function(a){ if(a.kind==='lamp')return; var q=a.qty||1; for(var k=0;k<q;k++){ units.push({a:a, des:(a.tag||'A')+(q>1?('.'+(k+1)):'')}); } });
  if(!units.length)return [];
  // рабочая зона: по ширине — вся рамка; по высоте — до верха штампа (полноширинные ряды)
  var x0=380, xs=500, perRow=Math.max(1,Math.floor((SHEET_W-200-x0)/xs));   // отступ справа 200
  var yTop=460, ys=560, yMax=TITLE_Y-120;                                    // не залезаем в штамп
  var rowsPer=Math.max(1,Math.floor((yMax-yTop)/ys));
  var perSheet=perRow*rowsPer, sheets=[], np=Math.ceil(units.length/perSheet);
  for(var p=0;p<np;p++){
    var ac=[], at=[], part=units.slice(p*perSheet,(p+1)*perSheet);
    at.push({x:x0,y:yTop-150,s:36,tx:'АППАРАТЫ УПРАВЛЕНИЯ'+(np>1?(' · '+(p+1)+'/'+np):'')});
    part.forEach(function(u,ci){
      var col=ci%perRow, rw=Math.floor(ci/perRow), x=x0+col*xs, y=yTop+rw*ys;
      var note=(u.a.name||'')+(u.a.target?(' · '+u.a.target):'');
      ac.push(C(u.des, auxSym2(u.a.kind), x, y, u.a.model||'', u.a.manu||'', note));
    });
    sheets.push({title:'аппараты управления'+(np>1?(' '+(p+1)):''), subtitle:'аппараты управления', comps:ac, wires:[], texts:at});
  }
  return sheets;
}
function buildSchematic(P){
  var W=_W;
  var hasCtrl = !!(P.controller && P.controller.model);

  // ===================== ЛИСТ 1 · СИЛОВЫЕ ЦЕПИ =====================
  var pc=[], pw=[], pt=[], gx=600, kmByName={};   // kmByName — общий для листов 1 и 2 (чтобы контакт KMn = катушка KMn)
  var intro=(P.breakers||[]).filter(function(b){return b.role==='ввод'})[0];
  pc.push(C('X1','term',gx,360,'ЗНИ 6 мм²','','ввод'));
  if(intro){ pc.push(C(intro.code,'qf1',gx,460,'NB1-63 '+intro.poles+'P, C'+intro.rate,'CHINT','ввод')); }
  pw.push(W([gx,360],[gx,460])); pw.push(W([gx,760],[gx,800]));
  var branches=(P.breakers||[]).filter(function(b){return b.role!=='ввод'&&b.role!=='цепи управления'});
  // колонки-отводы: по одной на каждую линию автомата (сгруппированный автомат → несколько колонок)
  var groups=[], cols=[];
  branches.forEach(function(b){
    var loads=(b.loads&&b.loads.length)?b.loads:[{name:b.role,cid:b.consumer}];
    var g={b:b, cols:[]};
    loads.forEach(function(l){ var col={b:b,l:l}; cols.push(col); g.cols.push(col); });
    groups.push(g);
  });
  var nT=cols.length, step=720, maxX=3850;
  if(nT>0){ var fit=(maxX-gx)/nT; if(fit<step) step=Math.max(300, Math.floor(fit)); }
  var bx=gx+step, lastX=gx, kmN=1, phI=0, wN=1, termN=2;
  cols.forEach(function(col,ci){ col.x=bx+ci*step; });
  groups.forEach(function(g){
    var gc=g.cols, b=g.b, x0=gc[0].x, x1=gc[gc.length-1].x, qfx=(x0+x1)/2, grouped=gc.length>1;
    var ph3=(b.poles===3), phase=ph3?'L1 L2 L3':['L1','L2','L3'][(phI++)%3];
    // автомат — один на группу, питание с шины ввода
    pc.push(C(b.code,'qf1',qfx,950,'NB1-63 '+b.poles+'P, C'+b.rate,'CHINT', grouped?('группа · '+gc.length+' лин.'):gc[0].l.name));
    pw.push(W([qfx,800],[qfx,950]));
    pt.push({x:qfx+44,y:885,s:24,ls:0,anchor:'start',tx:phase});                       // фаза(ы) линии
    if(grouped){
      pw.push(W([qfx,1250],[qfx,1350]));                                               // отвод автомата на шину распределения
      pw.push(W([x0,1350],[x1,1350]));                                                 // шина распределения по отводам
    }
    gc.forEach(function(col){
      var x=col.x, cons=(P.consumers||[]).filter(function(c){return c.id===(col.l.cid||b.consumer)})[0];
      var role=cons?cons.name:(col.l.name||b.role);
      if(grouped) pw.push(W([x,1350],[x,1450]));                                        // от шины к отводу
      else        pw.push(W([qfx,1250],[x,1450]));                                      // одиночный отвод — прямо от автомата
      if(cons&&needsContactor(cons)){
        pc.push(C('KM'+kmN,'c_no',x,1450,contactorModel(cons),'CHINT',cons.name));
        pw.push(W([x,1600],[x,1950]));
        pt.push({x:x-66,y:1545,s:20,ls:0,anchor:'end',tx:'(л.2)'});                     // ссылка на катушку (лист 2)
        if(!(cons.name in kmByName)) kmByName[cons.name]='KM'+kmN;                       // тот же номер на листе 2 (катушка)
        kmN++;
      } else { pw.push(W([x,1450],[x,1950])); }
      pt.push({x:x+44,y:1730,s:22,ls:0,anchor:'start',tx:(ph3?('W'+wN+'…'+(wN+2)):('W'+wN))}); wN+=ph3?3:1;  // номер(а) провода
      pc.push(C('X'+termN,'term',x,2000,'ЗНИ 2,5 мм²','',role)); termN++;
      lastX=x;
    });
  });
  pw.push(W([gx,800],[Math.max(lastX,bx),800]));
  pt.push({x:gx-10,y:780,s:24,ls:0,anchor:'start',tx:'L1 · L2 · L3 · N · PE'});  // маркировка шины
  pt.push({x:gx+120,y:235,s:38,tx:'СИЛОВЫЕ ЦЕПИ · 3N~ 400 В'});
  var sheets=[{title:'силовые цепи', comps:pc, wires:pw, texts:pt}];

  // ===================== ЛИСТ 2 · ЦЕПИ УПРАВЛЕНИЯ =====================
  if(hasCtrl){
    var ac=[], aw=[], at=[];
    var io=P.controller.io||{}, G=_ctrlGeom(io), cz=1900, ctrlY=900;
    at.push({x:300,y:235,s:38,tx:'ЦЕПИ УПРАВЛЕНИЯ · АВТОМАТИКА'});
    // kmByName уже заполнен на листе 1 (контакт KMn ↔ катушка KMn). Подстраховка, если контакт не нарисован:
    var kmc=kmN; (P.consumers||[]).forEach(function(c){ if(needsContactor(c)){ var q=c.qty||1; if(!(c.name in kmByName)) kmByName[c.name]='KM'+kmc; kmc+=q; } });
    // питание управления (приходит с силового листа) + автомат управления
    ac.push(C('X0','term',cz,250,'L · N','','питание ← лист 1 (силовая)'));
    var cq=(P.breakers||[]).filter(function(bb){return bb.role==='цепи управления'})[0];
    if(cq){
      ac.push(C(cq.code,'qf1',cz,320,'NB1-63 1P, C'+cq.rate,'CHINT','цепи управления'));
      aw.push(W([cz,250],[cz,320]));
      aw.push(W([cz,620],[cz,720]));
      aw.push(W([cz-195,720],[cz,720]));                       // шина питания к выводам контроллера
      aw.push(W([cz-195,720],[cz-195,ctrlY-G.stub]));          // на «+24 В» (px1=-195 в ctrlSym)
      aw.push(W([cz-55,720],[cz-55,ctrlY-G.stub]));            // на «0 В» (px2=-55 в ctrlSym)
    } else { aw.push(W([cz,250],[cz,ctrlY-G.stub])); }
    var cspec=P.controller.spec||{};
    ac.push({sym:'ctrl',x:cz,y:ctrlY,rot:0,mirror:false,des:'A1',
      attrs:{model:P.controller.model,nm:'Контроллер',note:'',io:io,supply:cspec.voltage||'',wired:true}});
    var lpx=cz-G.hx-G.stub, rpx=cz+G.hx+G.stub;
    var SP=210, baseY=ctrlY+40;                 // крупный шаг устройств — чтобы не наезжали
    function shortC(des,sym,xx,yy,model,manu,note,nm){var cc=C(des,sym,xx,yy,model,manu,note,nm);cc.attrs.short=true;return cc;}
    // только назначенные выводы
    var inA=[], outA=[];
    G.left.forEach(function(p,i){ if(p.lab) inA.push({p:p,i:i}); });
    G.right.forEach(function(p,i){ if(p.lab) outA.push({p:p,i:i}); });
    var inX=lpx-560, comX=inX-220, outX=rpx+560, nX=outX+220;
    var usedL=[], usedR=[];
    // ВХОДЫ слева: датчик/клемма на своём уровне, провод подведён зигзагом
    inA.forEach(function(o,k){
      var p=o.p, py=ctrlY+G.pinY(o.i), devY=baseY+k*SP, isT=(p.g==='AI'), chx=lpx-130-k*40;
      ac.push(shortC('BT'+(k+1), isT?'ntc':'term', inX, devY, isT?'NTC':'', '', p.lab));
      aw.push(W([lpx,py],[chx,py])); aw.push(W([chx,py],[chx,devY])); aw.push(W([chx,devY],[inX,devY]));
      at.push({x:chx+22,y:py-14,s:22,ls:0,anchor:'start',tx:''+(11+k)});        // номер цепи входа
      if(isT){ aw.push(W([inX,devY+150],[comX,devY+150])); usedL.push(devY+150); }
      else   { aw.push(W([inX,devY],[comX,devY]));         usedL.push(devY); }
    });
    // ВЫХОДЫ справа: катушка контактора / клемма
    outA.forEach(function(o,k){
      var p=o.p, py=ctrlY+G.pinY(o.i), devY=baseY+k*SP, km=kmByName[p.lab], chx=rpx+130+k*40;
      at.push({x:chx-22,y:py-14,s:22,ls:0,anchor:'end',tx:''+(21+k)});        // номер цепи выхода
      if(p.g==='DO' && km){
        ac.push(shortC(km,'coil',outX,devY,'катушка контактора','',p.lab));
        aw.push(W([rpx,py],[chx,py])); aw.push(W([chx,py],[chx,devY])); aw.push(W([chx,devY],[outX,devY]));
        aw.push(W([outX,devY+150],[nX,devY+150])); usedR.push(devY+150);
        at.push({x:outX-150,y:devY+120,s:20,ls:0,anchor:'end',tx:'(л.1)'});   // ссылка на контакт (компактно, слева)
      } else {
        ac.push(shortC('XO'+(k+1),'term',outX,devY,'','',p.lab));
        aw.push(W([rpx,py],[chx,py])); aw.push(W([chx,py],[chx,devY])); aw.push(W([chx,devY],[outX,devY]));
      }
    });
    if(usedL.length){ var l0=Math.min.apply(null,usedL), l1=Math.max.apply(null,usedL); aw.push(W([comX,l0],[comX,l1])); at.push({x:comX-30,y:l0-26,s:24,ls:0,anchor:'end',tx:'общий / 0В'}); }
    if(usedR.length){ var r0=Math.min.apply(null,usedR), r1=Math.max.apply(null,usedR); aw.push(W([nX,r0],[nX,r1])); at.push({x:nX+24,y:r0-26,s:24,ls:0,anchor:'start',tx:'N'}); }
    var hlN=1;
    (P.aux||[]).forEach(function(a){ if(a.kind==='lamp'){ var q=a.qty||1; for(var k=0;k<q;k++){ var x=cz-200+(hlN-1)*280; ac.push(C(a.tag||('HL'+hlN),'hl',x,520,a.model||'230 В','',a.name)); hlN++; } } });
    sheets.push({title:'цепи управления', comps:ac, wires:aw, texts:at});
  }
  // отдельные листы «аппараты управления» — кнопки/переключатели/реле/SSR и т.д., в пределах рамки A3, с переносом
  buildAuxSheets(P).forEach(function(sh){ sheets.push(sh); });
  // на схеме — только обозначение; полное название элемента видно по наведению мыши
  sheets.forEach(function(sh){ sh.comps.forEach(function(c){ c.attrs.short=true; }); });
  return {sheets:sheets, comps:pc, wires:pw, texts:pt};
}

g.AtomCore={
  STD:STD, consumerCurrent:consumerCurrent, stdRating:stdRating, ratingFor:ratingFor,
  buildBreakers:buildBreakers, breakerSum:breakerSum, breakerStatus:breakerStatus,
  phaseBalance:phaseBalance, sectionFor:sectionFor, ioFree:ioFree, ioTotal:ioTotal,
  buildSpec:buildSpec, moduleCount:moduleCount, pickEnclosure:pickEnclosure, ENCL:ENCL,
  buildSchematic:buildSchematic, needsContactor:needsContactor, contactorModel:contactorModel, contactorPick:contactorPick, contactorDimStr:contactorDimStr,
  isLV:isLV, lvSupplies:lvSupplies
};
})(typeof window!=='undefined'?window:global);
