const test=require('node:test'),assert=require('node:assert/strict');
const board=require('../supply-board.js'),sb=require('../supply-buy.js');
function base(){return {key:'c1:0',board_key:'c1:0123456789abcdef',kind:'item',title:'Автомат',dk:'c:24',stage:'buy',plan_models:['Щит управления'],plan_contracts:['24'],problems:['nosup'],quantity:2,qty:'2 шт',sub:'план · <nosup>',hay:'автомат'};}
test('изделие из спецификации; общая потребность не дублируется',()=>{
  const rows=board.decorateRows([base(),{...base(),board_key:'c2:0123456789abcdef',plan_contracts:['24','25'],quantity:6}],{});
  assert.equal(rows.length,2);assert.equal(rows[0].group_name,'Щит управления');assert.equal(rows[1].dk,'shared');assert.equal(rows[1].quantity,6);
});
test('массовый выбор сохраняет индивидуальные количества и ревизии',()=>{
  const rows=Array.from({length:10},(_,i)=>({...base(),key:'c'+i+':0123456789abcdef',quantity:i+1,board_revision:i}));
  const targets=board.targets(rows);assert.equal(targets.length,10);assert.deepEqual(targets.map(t=>t.qty),[1,2,3,4,5,6,7,8,9,10]);assert.deepEqual(targets.map(t=>t.revision),[0,1,2,3,4,5,6,7,8,9]);
});
test('назначение поставщика и названия не мутирует исходную потребность',()=>{
  const input=base(),entries={[input.board_key]:{supplier_id:5,supplier_name:'ЭТМ',title:'Новый автомат',group_name:'Щит 2',revision:3,ready_date:'2026-11-12'}};
  const r=board.decorateRows([input],{entries})[0];assert.equal(r.supplier,'ЭТМ');assert.equal(r.title,'Новый автомат');assert.equal(r.group_name,'Щит 2');assert.equal(r.problems.length,0);assert.equal(r.board_revision,3);assert.ok(r.hay.includes('этм'));assert.deepEqual(input.problems,['nosup']);assert.equal(input.title,'Автомат');
});
test('скрытие назначения и связь черновика; финансовые поля сохраняются',()=>{
  const input={...base(),amount:12345,status:'paid',kind:'order',key:'o7',board_key:null,expected:'2026-11-15',ready_date:'2026-11-11'};
  const r=board.decorateRows([input],{entries:{'d:c:24':{hidden:1},o7:{arrival_date:'2020-01-01',ready_date:'2020-01-01'}}})[0];
  assert.equal(r.board_hidden,true);assert.equal(r.amount,12345);assert.equal(r.status,'paid');assert.equal(r.arrival_date,'2026-11-15');assert.equal(r.ready_date,'2026-11-11');
  assert.equal(board.decorateRows([base()],{entries:{[base().board_key]:{draft_active:1}}})[0].board_consumed,true);
});
test('реальная модель списка передаёт ключ, модель, количества и сроки',()=>{
  const rows=sb.sbBuildRows({shop:{groups:[{supplier_id:null,items:[{component_id:1,component_name:'Автомат',board_key:base().board_key,plan_models:['Щит управления'],plan_contracts:['24'],recommended_qty:4,unit:'шт.'}]}]},cp:[],orders:[{id:7,status:'paid',supplier_id:1,expected_date:'2026-11-15',ready_date:'2026-11-11'}],waiting:{items:[]},closed:[]});
  const d=board.decorateRows(rows,{}),c=d.find(x=>x.kind==='item'),o=d.find(x=>x.kind==='order');assert.equal(c.key,base().board_key);assert.equal(c.quantity,4);assert.equal(c.group_name,'Щит управления');assert.equal(o.ready_date,'2026-11-11');assert.equal(board.targets([o])[0].expected_date,'2026-11-15');
});
