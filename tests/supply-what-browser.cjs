/* Run with NODE_PATH=<runtime node_modules> node tests/supply-what-browser.cjs.
 * Real procurement module, isolated fixtures. No production API or messages. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const out=process.env.WTB_QA_OUTPUT||path.join(root,'docs/previews/supply-311');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.WTB_CHROMIUM_PATH?{executablePath:process.env.WTB_CHROMIUM_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f6fa;font-family:Arial"><main style="max-width:1300px;margin:24px auto;padding:0 20px"><h1 style="font-size:23px">Снабжение · Что закупить</h1><p class="page-subtitle"></p><div id="supply"></div></main></body></html>'}));
  await page.goto('http://127.0.0.1:8311/procurement-fixture');
  await page.addStyleTag({path:path.join(root,'supply-what.css')});
  await page.evaluate(()=>{
   window.calls=[]; window.toasts=[]; window.showToast=(text,type)=>toasts.push({text,type});
   const body={id:45,designation:'AG-46.000.000СБ',name:'Корпус щита',supplier_id:152,supplier_name:'УТМ',files:[{id:7,file_name:'Корпус.pdf'}]};
   function child(id,name,qty,stock=0){return {component_id:id,name,sku:'C-'+id,unit:'шт.',qty_required:qty,need:qty,stock_allocated:stock,stock_available_to_reserve:stock,reserved_qty:0,in_transit_allocated:0,to_buy:qty-stock,to_order:qty-stock,status:qty>stock?'to_buy':'in_stock_not_reserved',warnings:[]};}
   const one={id:'ci:154',contract_id:18,contract_item_id:154,contract_number:'25ТД/10.26',position_no:2,name:'ЩУ-001.009',model_article:'ЩУ-001.009',qty:1,unit:'шт.',status:'to_buy',children:[child(1,'Блок питания 24 В',4,2),Object.assign(child(2,'Основание ГИБКА',1),{body_bundle:body,body_bundle_id:45}),Object.assign(child(3,'Крышка ГИБКА',2),{body_bundle:body,body_bundle_id:45})],data_errors:[],warnings:[]};
   const two={id:'ci:201',contract_id:20,contract_item_id:201,contract_number:'26ТД/10.26',position_no:1,name:'Щит нагревателя',qty:1,unit:'шт.',status:'to_buy',children:[child(1,'Блок питания 24 В',3)],data_errors:[],warnings:[]};
   window.rows=[one,two]; window.cards=[{contract_id:18,number:'25ТД/10.26',contractor_name:'Тестовый проект',items_count:1},{contract_id:20,number:'26ТД/10.26',contractor_name:'Второй проект',items_count:1}];
   function summary(rs){const cc=rs.flatMap(r=>r.children);return {lines:cc.length,stock_lines:cc.filter(c=>c.stock_allocated>0).length,in_transit_lines:cc.filter(c=>c.in_transit_allocated>0).length,to_buy_lines:cc.filter(c=>c.to_buy>0).length};}
   window.apiGet=async url=>{
    calls.push({method:'GET',url});
    if(url==='/api/suppliers')return {suppliers:[{id:152,name:'УТМ',is_active:1}]};
    const u=new URL(url,location.origin),cid=Number(u.searchParams.get('contract_id'));
    cards.forEach(c=>c.summary=summary(rows.filter(r=>r.contract_id===c.contract_id)));
    const data={contracts:cards,min_stock:{items:[]},in_transit:[],items:cid?rows.filter(r=>r.contract_id===cid):u.searchParams.has('view')?rows:[],contract:cards.find(c=>c.contract_id===cid)};
    return JSON.parse(JSON.stringify(data));
   };
   window.apiPost=async(url,body)=>{
    calls.push({method:'POST',url,body:JSON.parse(JSON.stringify(body))});
    if(url.endsWith('/reserve')){
     const row=rows.find(r=>r.contract_item_id===body.contract_item_id);
     const items=row.children.filter(c=>c.stock_available_to_reserve>0&&(!body.component_id||body.component_id===c.component_id)).map(c=>({component_id:c.component_id,name:c.name,qty:c.stock_available_to_reserve,unit:c.unit}));
     if(body.dry_run===false)items.forEach(item=>{const c=row.children.find(c=>c.component_id===item.component_id);c.reserved_qty+=item.qty;c.stock_available_to_reserve=0;});
     return {ok:true,data:{ok:true,items,items_count:items.length}};
    }
    if(url.endsWith('/ordered')){
     if(body.dry_run)return {ok:true,data:{can_create:!!body.supplier_id,existing_orders:window.forceExisting?[{id:99,order_label:'ORD-99',status:'sent'}]:[]}};
     body.items.forEach(item=>{const c=rows.find(r=>r.contract_item_id===item.contract_item_id).children.find(c=>c.component_id===item.component_id);c.to_buy-=item.qty;c.to_order=c.to_buy;c.in_transit_allocated+=item.qty;});
     return {ok:true,data:{ok:true,order:{id:99,order_label:'ORD-99'}}};
    }
    throw Error('Unexpected POST '+url);
   };
   window.openMfgItem=id=>{window.openedMfg=id;};
  });
  await page.addScriptTag({path:path.join(root,'supply-what.js')});
  await page.evaluate(()=>wtbTryLoad(document.getElementById('supply')));
  await page.locator('[data-wtb-contract="18"]').click();
  const product=page.locator('[data-wtb-open="ci:154"]');
  assert.equal(await product.locator('.wtb-bodyc').isVisible(),false);
  await product.locator('.wtb-heading-toggle').click();
  assert.equal(await product.locator('.wtb-heading-toggle').getAttribute('aria-expanded'),'true');
  assert.match(await product.innerText(),/Щит управления/);
  assert.equal(await product.locator('[data-wtb-order-one]').count(),1,'body parts cannot be purchased individually');
  assert.equal(await product.locator('[data-wtb-order-bundle]').count(),1);
  await product.locator('[data-wtb-mfg]').click();assert.equal(await page.evaluate(()=>openedMfg),45);
  await product.locator('.wtb-reserve-summary [data-wtb-reserve]').click();
  assert.equal(await page.locator('#wtb-order-modal [data-confirm-reserve]').count(),1);
  assert.equal(await page.evaluate(()=>calls.filter(c=>c.body?.dry_run===false).length),0);
  await page.locator('[data-confirm-reserve]').click();
  await page.waitForFunction(()=>!document.getElementById('wtb-order-modal'));
  await page.waitForFunction(()=>!document.querySelector('.wtb-reserve-summary'));
  assert.match(await product.innerText(),/2 закреплено/);
  await product.locator('[data-wtb-record-one]').click();
  await page.locator('[data-manual-supplier]').selectOption('152');
  await page.locator('[data-manual-qty="0"]').fill('1');
  await page.locator('[data-manual-paid]').check();
  await page.locator('[data-manual-invoice]').fill('Счёт 123');
  await page.locator('[data-manual-submit]').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('[data-manual-submit]').disabled);
  await page.locator('[data-manual-submit]').click();
  await page.waitForFunction(()=>!document.getElementById('wtb-order-modal'));
  await page.waitForFunction(()=>document.querySelector('[data-wtb-open="ci:154"]')?.innerText.includes('В пути 1 поз.'));
  const recorded=await page.evaluate(()=>calls.filter(c=>c.url.endsWith('/ordered')&&c.body.dry_run===false));
  assert.equal(recorded.length,1);assert.equal(recorded[0].body.items[0].qty,1);assert.equal(recorded[0].body.paid,true);
  assert.equal(recorded[0].body.items[0].contract_item_id,154);
  await page.evaluate(()=>{window.forceExisting=true;});
  await product.locator('[data-wtb-record-one]').click();
  await page.locator('[data-manual-supplier]').selectOption('152');
  await page.locator('[data-manual-append]').waitFor();
  assert.equal(await page.locator('[data-manual-submit]').isDisabled(),true);
  await page.locator('[data-manual-append]').selectOption('99');
  assert.equal(await page.locator('[data-manual-submit]').isEnabled(),true);
  await page.locator('#wtb-order-modal [data-wtb-close]').first().click();
  await page.locator('[data-wtb-view="list"]').click();
  await page.locator('.wtb-general-row').first().waitFor();
  const shared=page.locator('.wtb-general-row').filter({has:page.locator('.wtb-general-info>b',{hasText:'Блок питания'})});
  assert.equal(await shared.locator('.wtb-destination').count(),2);
  assert.equal((await shared.locator('.wtb-general-buy b').innerText()).trim(),'4');
  assert.ok((await page.evaluate(()=>calls)).some(c=>c.url==='/api/supply/what-to-buy?view=products'),'general list reloads all contracts');
  await page.locator('[data-wtb-destination="20:201"]').click();
  await page.locator('[data-wtb-open="ci:201"] .wtb-bodyc').waitFor({state:'visible'});
  assert.match(await page.locator('.wtb-contract-heading').innerText(),/26ТД/);
  await page.locator('[data-wtb-filter="buy"]').click();
  assert.equal(await page.locator('[data-wtb-filter="buy"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-wtb-filter="all"]').click();
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow on mobile');
  assert.equal(await page.locator('table.wtb-comp thead').isVisible(),false);
  assert.ok(!(await page.locator('#supply').innerText()).includes('Покрыто'));
  assert.deepEqual(errors,[]);
  assert.ok(!(await page.evaluate(()=>calls)).some(c=>/send|email|telegram|notify/.test(c.url)));
  console.log('PASS procurement: hierarchy, collapsed products, body grouping, drawing link, reserve confirmation/refresh, partial paid order, existing-order choice, all-contract aggregation, destination navigation, mobile layout; no outgoing messages.');
  if(process.env.WTB_REAL_DATA){
   const snapshot=JSON.parse(fs.readFileSync(process.env.WTB_REAL_DATA,'utf8'));
   await page.evaluate(data=>{
    const cards=data.all.contracts;
    window.apiGet=async url=>{
     if(url==='/api/suppliers')return {suppliers:[]};
     const u=new URL(url,location.origin),cid=Number(u.searchParams.get('contract_id'));
     if(cid===18)return JSON.parse(JSON.stringify(data.contract));
     if(u.searchParams.has('view'))return JSON.parse(JSON.stringify(data.all));
     return {contracts:cards,items:[],min_stock:{items:[]},in_transit:[]};
    };
    // Inspection fixture is read-only: clicking a write action cannot touch any database.
    window.apiPost=async()=>({ok:false,data:{message:'Превью на копии данных. Запись отключена.'}});
   },snapshot);
   fs.mkdirSync(out,{recursive:true});
   await page.setViewportSize({width:1440,height:1000});
   await page.evaluate(()=>wtbTryLoad(document.getElementById('supply')));
   await page.locator('[data-wtb-contract="18"]').click();
   await page.evaluate(()=>window.scrollTo(0,0));
   await page.screenshot({path:path.join(out,'supply-311-overview.png')});
   await page.locator('[data-wtb-search]').fill('ЩУ');
   const shield=page.locator('[data-wtb-open="ci:157"]');
   await shield.locator('.wtb-heading-toggle').click();
   await page.evaluate(()=>window.scrollTo(0,0));
   await page.screenshot({path:path.join(out,'supply-311-desktop.png')});
   await page.setViewportSize({width:390,height:844});
   await page.evaluate(()=>window.scrollTo(0,0));
   await page.screenshot({path:path.join(out,'supply-311-mobile.png')});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'real-data mobile overflow');
   await page.setViewportSize({width:1440,height:1000});
   await page.locator('[data-wtb-view="list"]').click();
   await page.screenshot({path:path.join(out,'supply-311-general.png')});
   assert.deepEqual(errors,[]);
   console.log('PASS real 25ТД desktop/mobile preview.');
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
