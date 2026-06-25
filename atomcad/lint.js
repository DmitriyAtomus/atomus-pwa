#!/usr/bin/env node
// Авто-проверка оформления листов «Атом Электрика»: наложения подписей и выход за рамку.
// Запуск:  node atomcad/lint.js     (код выхода 1, если есть нарушения)
require('./core.js');
var C=global.AtomCore;

function ctrl(model,supply,di,ai,doo,ao){
  function pins(pref,n){var a=[];for(var i=1;i<=n;i++)a.push({id:pref+i});return a;}
  return {model:model,spec:{voltage:supply},io:{pins:{DI:pins('DI',di),AI:pins('AI',ai),DO:pins('K',doo),AO:pins('AO',ao)},asg:{}}};
}

// ── типовые сценарии (покрывают плотные ряды, каскад, сигнальные органы, лампы, HMI) ──
var CASES=[];

// 1) простой: KM + ТР
(function(){
  var P={consumers:[{id:'c1',name:'Приточный вентилятор',phases:1,volt:230,kw:1.1,needs:'contactor'},
                    {id:'c2',name:'ТЭН калорифера',phases:3,volt:400,kw:9,needs:'contactor'}],
    aux:[{id:'t1',tag:'ТР1',kind:'ssr',targets:['Приточный вентилятор']},
         {id:'k1',tag:'KM1',kind:'contactor',targets:['ТЭН калорифера']}],
    sensors:[{name:'t приточного',sig:'NTC',qty:1}], terminals:[],
    controller:ctrl('OВЕН ПР200','24В',2,2,2,2)};
  P.controller.io.asg={AO1:'ТР1',K1:'KM1',AI1:'t приточного'};
  CASES.push({name:'простой KM+ТР',P:P});
})();

// 2) плотный: много выходов/входов, лампы, HMI, сигнальные органы
(function(){
  var cons=[],aux=[],asg={};
  for(var i=1;i<=4;i++){cons.push({id:'v'+i,name:'Вентилятор В'+i,phases:1,volt:230,kw:0.8,needs:'contactor'});aux.push({id:'k'+i,tag:'KM'+i,kind:'contactor',targets:['Вентилятор В'+i]});asg['K'+i]='KM'+i;}
  for(var j=1;j<=3;j++){cons.push({id:'h'+j,name:'Калорифер К'+j,phases:3,volt:400,kw:6,needs:'contactor'});aux.push({id:'t'+j,tag:'ТР'+j,kind:'ssr',targets:['Калорифер К'+j]});asg['AO'+j]='ТР'+j;}
  aux.push({id:'sa',tag:'SA1',kind:'switch',name:'Режим Авто/Ручной',signalTo:'DI1'});
  aux.push({id:'sb',tag:'SB1',kind:'estop',name:'Грибок аварийный',signalTo:'DI2'});
  aux.push({id:'l1',tag:'HL1',kind:'lamp',name:'Сеть',qty:1});
  aux.push({id:'l2',tag:'HL2',kind:'lamp',name:'Работа',qty:1});
  aux.push({id:'l3',tag:'HL3',kind:'lamp',name:'Авария',qty:1});
  asg['DI1']='SA1';asg['DI2']='SB1';
  var sens=[{name:'t наружный',sig:'NTC',qty:1},{name:'t канальный',sig:'NTC',qty:1},{name:'давление',sig:'4–20 мА',qty:1}];
  sens.forEach(function(s,i){asg['AI'+(i+1)]=s.name;});
  var P={consumers:cons,aux:aux,sensors:sens,terminals:[],
    controller:ctrl('OВЕН ПР200','24В',9,6,9,6),
    hmi:{model:'ИП320',manu:'ОВЕН'}};
  P.controller.io.asg=asg;
  CASES.push({name:'плотный (выходы/входы/лампы/HMI)',P:P});
})();

// 3) каскад KM→ТР + сигнал на клемму
(function(){
  var P={consumers:[{id:'c1',name:'Электрокалорифер',phases:3,volt:400,kw:15,needs:'contactor'}],
    aux:[{id:'k1',tag:'KM1',kind:'contactor',targets:[]},
         {id:'t1',tag:'ТР1',kind:'ssr',src:'KM1',targets:['Электрокалорифер']},
         {id:'sb',tag:'SB1',kind:'estop',name:'Авар. стоп',signalTo:'__term__'}],
    sensors:[], terminals:[{term:'X5:1',name:'Авар. стоп',line:'дискр. сигнал',sec:1.5,auxId:'sb'},{term:'X5:2',name:'Авар. стоп',line:'дискр. общий',sec:1.5,auxId:'sb'}],
    controller:ctrl('EVCO EPK38SR','230В',2,2,2,2)};
  P.controller.io.asg={AO1:'ТР1',K1:'KM1'};
  CASES.push({name:'каскад KM→ТР + сигнал на клемму',P:P});
})();

// ── прогон ──
var total=0;
CASES.forEach(function(cs){
  try{ cs.P.breakers=C.buildBreakers(cs.P); }catch(e){}
  var res=C.lint(cs.P), n=0;
  res.forEach(function(sh){n+=sh.issues.length;});
  total+=n;
  console.log((n?'✗':'✓')+' '+cs.name+' — нарушений: '+n);
  res.forEach(function(sh){
    sh.issues.forEach(function(is){
      if(is.type==='overlap') console.log('    [наложение] @'+is.at+' «'+trim(is.a)+'» ↔ «'+trim(is.b)+'» (лист: '+sh.title+')');
      else console.log('    [за рамкой] @'+is.at+' «'+trim(is.tx)+'» (лист: '+sh.title+')');
    });
  });
});
function trim(s){s=String(s||'');return s.length>42?s.slice(0,41)+'…':s;}
console.log('\nИтого нарушений: '+total);
process.exit(total?1:0);
