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
      b.push({id:'QF'+n, code:'QF'+n, poles:c.phases===3?3:1, rate:ratingFor(I), role:nm, loads:[{name:nm, a:I}], consumer:c.id});
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
function buildSpec(P){
  var items=[]; // {des, name, manu, model, note}
  // контроллер
  if(P.controller&&P.controller.model) items.push({des:'A1', name:'Контроллер', manu:'', model:P.controller.model, note:'ядро щита'});
  // автоматы
  (P.breakers||[]).forEach(function(b){ items.push({des:b.code, name:'Выключатель автоматический', manu:'CHINT', model:'NB1-63 '+b.poles+'P, C'+b.rate, note:b.role}); });
  // контакторы под потребители
  var kmN=1;
  (P.consumers||[]).forEach(function(c){ if(needsContactor(c)){ var q=c.qty||1; for(var k=0;k<q;k++){ items.push({des:'KM'+kmN, name:'Контактор', manu:'CHINT', model:c.phases===3?'NXC-'+(consumerCurrent(c)<18?'09':'25'):'NCH8-25/20', note:c.name+(q>1?(' #'+(k+1)):'')}); kmN++; } } });
  // датчики
  var btN=1;
  (P.sensors||[]).forEach(function(s){ var q=s.qty||1; for(var k=0;k<q;k++){ items.push({des:'BT'+btN, name:'Датчик температуры', manu:'', model:s.sig, note:s.name}); btN++; } });
  // вспомогательное
  var hlN=1;
  (P.aux||[]).forEach(function(a){ var q=a.qty||1; for(var k=0;k<q;k++){ var base=a.tag||(a.kind==='lamp'?('HL'+hlN):a.kind==='psu'?'G1':a.kind==='ssr'?'KA1':'E'+hlN); var des=q>1?(base+'.'+(k+1)):base; if(!a.tag&&a.kind==='lamp')hlN++; items.push({des:des, name:a.name, manu:a.manu||'', model:a.model||'', note:a.note||''}); } });
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
  (P.breakers||[]).forEach(function(b){ m+= b.poles===3?3:1; });
  (P.consumers||[]).forEach(function(c){ if(needsContactor(c)){ var q=c.qty||1; m+= q*(c.phases===3?2:1); } });
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
function buildSchematic(P){
  var W=_W;
  var hasCtrl = !!(P.controller && P.controller.model);

  // ===================== ЛИСТ 1 · СИЛОВЫЕ ЦЕПИ =====================
  var pc=[], pw=[], pt=[], gx=600;
  var intro=(P.breakers||[]).filter(function(b){return b.role==='ввод'})[0];
  pc.push(C('X1','term',gx,360,'ЗНИ 6 мм²','','ввод'));
  if(intro){ pc.push(C(intro.code,'qf1',gx,460,'NB1-63 '+intro.poles+'P, C'+intro.rate,'CHINT','ввод')); }
  pw.push(W([gx,360],[gx,460])); pw.push(W([gx,760],[gx,800]));
  var branches=(P.breakers||[]).filter(function(b){return b.role!=='ввод'&&b.role!=='цепи управления'});
  var step=720, nB=branches.length, maxX=3850;
  if(nB>0){ var fit=(maxX-gx)/nB; if(fit<step) step=Math.max(300, Math.floor(fit)); }
  var bx=gx+step, lastX=gx, kmN=1;
  branches.forEach(function(b,i){
    var x=bx+i*step;
    var cons=(P.consumers||[]).filter(function(c){return c.id===b.consumer})[0];
    var role=(cons?cons.name:b.role);
    pc.push(C(b.code,'qf1',x,950,'NB1-63 '+b.poles+'P, C'+b.rate,'CHINT',role));
    pw.push(W([x,800],[x,950]));
    if(cons&&needsContactor(cons)){
      pc.push(C('KM'+kmN,'c_no',x,1450,cons.phases===3?'NXC-09':'NCH8-25/20','CHINT',cons.name));
      pw.push(W([x,1250],[x,1450])); pw.push(W([x,1600],[x,1950]));
      kmN++;
    } else { pw.push(W([x,1250],[x,1950])); }
    pc.push(C('X'+(i+2),'term',x,2000,'ЗНИ 2,5 мм²','',role));
    lastX=x;
  });
  pw.push(W([gx,800],[Math.max(lastX,bx),800]));
  pt.push({x:gx+120,y:235,s:38,tx:'СИЛОВЫЕ ЦЕПИ · 3N~ 400 В'});
  var sheets=[{title:'силовые цепи', comps:pc, wires:pw, texts:pt}];

  // ===================== ЛИСТ 2 · ЦЕПИ УПРАВЛЕНИЯ =====================
  if(hasCtrl){
    var ac=[], aw=[], at=[];
    var io=P.controller.io||{}, G=_ctrlGeom(io), cz=1900, ctrlY=900;
    at.push({x:300,y:235,s:38,tx:'ЦЕПИ УПРАВЛЕНИЯ · АВТОМАТИКА'});
    var kmByName={}, kmc=1;
    (P.consumers||[]).forEach(function(c){ if(needsContactor(c)){ var q=c.qty||1; if(!(c.name in kmByName)) kmByName[c.name]='KM'+kmc; kmc+=q; } });
    // питание управления (приходит с силового листа) + автомат управления
    ac.push(C('X0','term',cz,250,'L · N','','питание ← лист 1 (силовая)'));
    var cq=(P.breakers||[]).filter(function(bb){return bb.role==='цепи управления'})[0];
    if(cq){
      ac.push(C(cq.code,'qf1',cz,320,'NB1-63 1P, C'+cq.rate,'CHINT','цепи управления'));
      aw.push(W([cz,250],[cz,320]));
      aw.push(W([cz,620],[cz,720]));
      aw.push(W([cz-150,720],[cz,720]));
      aw.push(W([cz-150,720],[cz-150,ctrlY-G.stub]));
      aw.push(W([cz-90,720],[cz-90,ctrlY-G.stub]));
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
      if(isT){ aw.push(W([inX,devY+150],[comX,devY+150])); usedL.push(devY+150); }
      else   { aw.push(W([inX,devY],[comX,devY]));         usedL.push(devY); }
    });
    // ВЫХОДЫ справа: катушка контактора / клемма
    outA.forEach(function(o,k){
      var p=o.p, py=ctrlY+G.pinY(o.i), devY=baseY+k*SP, km=kmByName[p.lab], chx=rpx+130+k*40;
      if(p.g==='DO' && km){
        ac.push(shortC(km,'coil',outX,devY,'катушка контактора','',p.lab));
        aw.push(W([rpx,py],[chx,py])); aw.push(W([chx,py],[chx,devY])); aw.push(W([chx,devY],[outX,devY]));
        aw.push(W([outX,devY+150],[nX,devY+150])); usedR.push(devY+150);
      } else {
        ac.push(shortC('XO'+(k+1),'term',outX,devY,'','',p.lab));
        aw.push(W([rpx,py],[chx,py])); aw.push(W([chx,py],[chx,devY])); aw.push(W([chx,devY],[outX,devY]));
      }
    });
    if(usedL.length){ var l0=Math.min.apply(null,usedL), l1=Math.max.apply(null,usedL); aw.push(W([comX,l0],[comX,l1])); at.push({x:comX-30,y:l0-26,s:24,tx:'общий / 0В'}); }
    if(usedR.length){ var r0=Math.min.apply(null,usedR), r1=Math.max.apply(null,usedR); aw.push(W([nX,r0],[nX,r1])); at.push({x:nX+24,y:r0-26,s:24,tx:'N'}); }
    var hlN=1;
    (P.aux||[]).forEach(function(a){ if(a.kind==='lamp'){ var q=a.qty||1; for(var k=0;k<q;k++){ var x=cz-200+(hlN-1)*280; ac.push(C(a.tag||('HL'+hlN),'hl',x,520,a.model||'230 В','',a.name)); hlN++; } } });
    sheets.push({title:'цепи управления', comps:ac, wires:aw, texts:at});
  }
  // на схеме — только обозначение; полное название элемента видно по наведению мыши
  sheets.forEach(function(sh){ sh.comps.forEach(function(c){ c.attrs.short=true; }); });
  return {sheets:sheets, comps:pc, wires:pw, texts:pt};
}

g.AtomCore={
  STD:STD, consumerCurrent:consumerCurrent, stdRating:stdRating, ratingFor:ratingFor,
  buildBreakers:buildBreakers, breakerSum:breakerSum, breakerStatus:breakerStatus,
  phaseBalance:phaseBalance, sectionFor:sectionFor, ioFree:ioFree, ioTotal:ioTotal,
  buildSpec:buildSpec, moduleCount:moduleCount, pickEnclosure:pickEnclosure, ENCL:ENCL,
  buildSchematic:buildSchematic, needsContactor:needsContactor,
  isLV:isLV, lvSupplies:lvSupplies
};
})(typeof window!=='undefined'?window:global);
