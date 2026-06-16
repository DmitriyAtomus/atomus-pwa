// AtomCAD core logic — чистые функции, без DOM. Тестируется отдельно.
(function(g){
'use strict';

var STD=[1,2,3,4,6,10,13,16,20,25,32,40,50,63,80,100,125]; // ряд номиналов, А

function consumerCurrent(c){
  if(c.a)return +c.a;
  if(!c.kw)return 0;
  var p=c.phases===3?(Math.sqrt(3)*400*0.85):(230*0.9);
  return +(c.kw*1000/p).toFixed(1);
}
function stdRating(I){ for(var i=0;i<STD.length;i++) if(STD[i]>=I) return STD[i]; return STD[STD.length-1]; }
function ratingFor(I){ return stdRating(I*1.25); } // запас 25%

// нужен ли потребителю контактор (коммутация)
function needsContactor(c){ return c.needs!=='direct'; }

// автоматы из состава: ввод + по группам потребителей + управление
function buildBreakers(P){
  var b=[], n=1;
  // ввод
  var tot=0,maxScenario=0;
  P.consumers.forEach(function(c){tot+=consumerCurrent(c)*(c.qty||1)});
  var introRate = ratingFor(tot);
  b.push({id:'QF'+n, code:'QF'+n, poles:3, rate: Math.max(introRate,16), role:'ввод', loads:[{name:'Σ нагрузка щита', a:+tot.toFixed(1)}], fixed:true}); n++;
  // по потребителям
  P.consumers.forEach(function(c){
    var I=consumerCurrent(c), q=c.qty||1;
    for(var k=0;k<q;k++){
      var nm=c.name+(q>1?(' #'+(k+1)):'');
      b.push({id:'QF'+n, code:'QF'+n, poles:c.phases===3?3:1, rate:ratingFor(I), role:nm, loads:[{name:nm, a:I}], consumer:c.id});
      n++;
    }
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
    var I=consumerCurrent(c), q=c.qty||1;
    if(c.phases===3){ ph.L1+=I*q; ph.L2+=I*q; ph.L3+=I*q; }
    else { for(var k=0;k<q;k++){ ph[ks[idx%3]]+=I; idx++; } }
  });
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
  m+=4; // клеммы/резерв базовый
  return m;
}
var ENCL=[{model:'IEK ЩРн-24',modules:24},{model:'IEK ЩРн-36з',modules:36},{model:'IEK ЩРн-48з-1',modules:48},{model:'IEK ЩРн-72з',modules:72},{model:'IEK ЩРн-96',modules:96}];
function pickEnclosure(P){ var need=Math.ceil(moduleCount(P)*1.3); for(var i=0;i<ENCL.length;i++) if(ENCL[i].modules>=need) return ENCL[i]; return ENCL[ENCL.length-1]; }

// генерация однолинейной схемы (компоненты+провода) для редактора
function shortLbl(s,n){s=String(s||'');n=n||16;return s.length>n?s.slice(0,n-1)+'…':s;}
function buildSchematic(P){
  var comps=[], wires=[], gx=600, busY=800, step=720;
  function C(des,sym,xx,yy,model,manu,note,nm){var a={};if(model)a.model=model;if(manu)a.manu=manu;if(note)a.note=note;if(nm)a.nm=nm;return {sym:sym,x:xx,y:yy,rot:0,mirror:false,des:des,attrs:a};}
  function W(){var pts=[].slice.call(arguments);return {pts:pts.map(function(p){return {x:p[0],y:p[1]}})};}
  // ввод + шина
  var intro=(P.breakers||[]).filter(function(b){return b.role==='ввод'})[0];
  comps.push(C('X1','term',gx,360,'ЗНИ 6 мм²','','ввод'));
  if(intro){ comps.push(C(intro.code,'qf1',gx,460,'NB1-63 '+intro.poles+'P, C'+intro.rate,'CHINT','ввод')); }
  wires.push(W([gx,360],[gx,460]));
  wires.push(W([gx,760],[gx,800]));
  // отходящие — единые уровни: QF y=950, KM y=1450, клеммы y=1950; шаг увеличен под подписи
  var branches=(P.breakers||[]).filter(function(b){return b.role!=='ввод'&&b.role!=='цепи управления'});
  // динамический шаг колонок — чтобы все отходящие линии помещались в ширину
  // листа (рабочее поле ~ до x=3950). Иначе при многих линиях схема вылезает за лист.
  var nB=branches.length, maxX=3850;
  if(nB>0){ var fit=(maxX-gx)/nB; if(fit<step) step=Math.max(300, Math.floor(fit)); }
  var bx=gx+step, lastX=gx, kmN=1;
  branches.forEach(function(b,i){
    var x=bx+i*step;
    var cons=(P.consumers||[]).filter(function(c){return c.id===b.consumer})[0];
    // полные имена — редактор сам перенесёт подпись на несколько строк
    var role=(cons?cons.name:b.role);
    comps.push(C(b.code,'qf1',x,950,'NB1-63 '+b.poles+'P, C'+b.rate,'CHINT',role));
    wires.push(W([x,800],[x,950]));
    if(cons&&needsContactor(cons)){
      comps.push(C('KM'+kmN,'c_no',x,1450,cons.phases===3?'NXC-09':'NCH8-25/20','CHINT',cons.name));
      wires.push(W([x,1250],[x,1450]));
      wires.push(W([x,1600],[x,1950]));
      kmN++;
    } else { wires.push(W([x,1250],[x,1950])); }
    comps.push(C('X'+(i+2),'term',x,2000,'ЗНИ 2,5 мм²','',role));
    lastX=x;
  });
  wires.push(W([gx,800],[Math.max(lastX,bx),800]));
  return {comps:comps, wires:wires};
}

g.AtomCore={
  STD:STD, consumerCurrent:consumerCurrent, stdRating:stdRating, ratingFor:ratingFor,
  buildBreakers:buildBreakers, breakerSum:breakerSum, breakerStatus:breakerStatus,
  phaseBalance:phaseBalance, sectionFor:sectionFor, ioFree:ioFree, ioTotal:ioTotal,
  buildSpec:buildSpec, moduleCount:moduleCount, pickEnclosure:pickEnclosure, ENCL:ENCL,
  buildSchematic:buildSchematic, needsContactor:needsContactor
};
})(typeof window!=='undefined'?window:global);
