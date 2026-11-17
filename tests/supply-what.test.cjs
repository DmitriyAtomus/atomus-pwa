const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function ui(){
 const calls=[];
 const window={};
 const context={window,localStorage:{getItem:()=>null},document:{querySelector:()=>null,getElementById:()=>null},URLSearchParams,console,
 apiGet:async url=>{calls.push(url);return {items:[],contracts:[]};}};
 const code=fs.readFileSync(path.join(__dirname,'../supply-what.js'),'utf8').replace(/\}\)\(\);\s*$/,'window.qa={st,summaryOf,aggregatePurchases,productCard,setView,manualLines,visibleChildren};})();');
 vm.runInNewContext(code,context);
 window.qa.st.container={innerHTML:'',querySelector:()=>null};
 return {...window.qa,calls};
}
function product(cid,iid,qty,unit='шт.'){
 return {id:'ci:'+iid,contract_id:cid,contract_item_id:iid,contract_number:'Д-'+cid,name:'Щит управления',qty:1,unit:'шт.',status:'to_buy',children:[{component_id:1,name:'Блок питания',need:qty,stock_allocated:0,in_transit_allocated:0,to_buy:qty,to_order:qty,unit}],warnings:[],data_errors:[]};
}
test('общая закупка объединяет деталь, сохраняя оба назначения и единицу',()=>{
 const h=ui(), groups=h.aggregatePurchases([product(18,154,2),product(20,201,3)]);
 assert.equal(groups.length,1);assert.equal(groups[0].buy,5);assert.equal(groups[0].manual.length,2);
 assert.deepEqual(Array.from(groups[0].refs,r=>r.row.contract_item_id),[154,201]);
 assert.equal(h.aggregatePurchases([product(18,154,2),product(20,201,3,'м')]).length,2);
});
test('сводка считает позиции при разных единицах и частичном наличии',()=>{
 const h=ui(), a=product(18,154,20,'м'),b=product(18,155,2);
 a.children[0].stock_allocated=3;a.children[0].in_transit_allocated=1;
 const s=h.summaryOf([a,b]);
 assert.equal(s.to_buy_lines,2);assert.equal(s.stock_lines,1);assert.equal(s.in_transit_lines,1);
});
test('переход в общую закупку загружает все договоры после просмотра одного',async()=>{
 const h=ui();h.st.contractId=18;h.st.tree={items:[product(18,154,2)]};
 await h.setView('list');
 assert.equal(h.st.contractId,null);assert.equal(h.calls.at(-1),'/api/supply/what-to-buy?view=products');
});
test('изделия свёрнуты; показываются понятное назначение и состав',()=>{
 const h=ui(),p=product(18,154,2);p.name='ЩУ-001.009';p.model_article=p.name;
 const html=h.productCard(p,false);
 assert.match(html,/Щит управления ЩУ-001.009/);assert.match(html,/aria-expanded="false"/);
 assert.ok(!html.includes('Покрыто'));assert.match(html,/data-wtb-record-group/);
});
test('корпус имеет общую кнопку заказа и не предлагает заказывать части отдельно',()=>{
 const h=ui(),p=product(18,154,2);const body={id:45,designation:'AG-46.000.000СБ',supplier_id:152,supplier_name:'УТМ',files:[]};
 p.children[0].body_bundle=body;p.children[0].body_bundle_id=45;
 const html=h.productCard(p,false);
 assert.match(html,/data-wtb-order-bundle="154:45"/);assert.ok(!html.includes('data-wtb-order-one='));
 assert.equal(h.manualLines([p])[0].supplier_id,152);
});
test('ввод поиска и названия из данных экранируются',()=>{
 const h=ui(),p=product(18,154,2);p.name='<img src=x onerror=alert(1)>';
 assert.ok(!h.productCard(p,false).includes('<img'));assert.ok(h.productCard(p,false).includes('&lt;img'));
});
