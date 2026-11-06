/* Запуск: NODE_PATH=<каталог с playwright> node tests/supply-board-browser.cjs
 * Настоящие UI-модули, учебные данные и перехват apiPost: рабочий API не вызывается. */
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const output=process.env.SUPPLY_QA_OUTPUT || path.join(root,'docs','previews','supply-selection-20261106');
async function fixture(page){
  // localhost даёт тот же secure context (crypto.randomUUID), что HTTPS CRM.
  await page.route('http://127.0.0.1:8176/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html></html>'}));
  await page.goto('http://127.0.0.1:8176/fixture');
  await page.setContent('<!doctype html><html lang="ru"><head><meta charset="utf-8"></head><body><header style="box-sizing:border-box;height:62px;position:sticky;top:0;background:#183556;color:white;z-index:5;padding:18px">Атомус · Снабжение</header><main style="max-width:1180px;margin:auto;padding:12px"><div id="sup-shop-counter"></div><div id="board"></div></main></body></html>');
  await page.addStyleTag({content:'body{margin:0;font-family:Arial,sans-serif;background:#f4f7fb}'});
  for(const file of ['app.css','supply-buy.css','supply-board.css'])await page.addStyleTag({path:path.join(root,file)});
  for(const file of ['supply-buy.js','supply-board.js'])await page.addScriptTag({path:path.join(root,file)});
  await page.evaluate(()=>{
    window.hasPermission=()=>true;
    window.saved=[];window.opened=[];
    window.apiGet=async()=>({suppliers:[{id:7,name:'ТД Электрика',is_active:1},{id:21,name:'ТПК Миасс ТЭН',is_active:1}]});
    window.apiPost=async(url,body)=>{saved.push({url,body});return {ok:true,data:{ok:true}};};
    window.openSupplyOrder=id=>opened.push(id);
    const items=Array.from({length:21},(_,i)=>({component_id:i+1,board_key:'c'+(i+1)+':0123456789abcdef',component_name:'CHINT · автомат '+(i+1),recommended_qty:i%4+1,plan_models:['ЩУ - 005.004'],plan_contracts:['24ТД/10.26'],unit:'шт.'}));
    items.push({component_id:99,board_key:'c99:0123456789abcdef',component_name:'Вентилятор',recommended_qty:4,plan_models:['НВП-15-380-AISI'],plan_contracts:['24ТД/10.26'],unit:'шт.'});
    items.push({component_id:507,component_name:'ТЭНР 119.5 В 13/1,5-К-220 Ф1',recommended_qty:14,plan_models:['НВП-15-380-AISI'],plan_contracts:['24ТД/10.26'],order_id:464,order_status:'to_pay',order_match:'exact_name_unit_contract',order_coverage_qty:14,order_remaining_qty:30,order_surplus_qty:16,unit:'шт.'});
    const input={shop:{groups:[{items}]},orders:[{id:464,status:'to_pay',purpose:'ТЭНы на Абхазию',order_label:'ORD-464',invoice_number:'3384',invoice_total:29390,supplier_id:21,supplier_name:'ТПК Миасс ТЭН',dest_type:'contract',contract_number:'24ТД/10.26'}],waiting:{items:[{order_id:464,name:'ТЭНР 119.5 В 13/1,5-К-220 Ф1',qty:30,remaining:30,unit:'шт.',dest_type:'contract',dest_contract_number:'24ТД/10.26'}]}};
    const rows=SupplyBoard.decorateRows(__sbv.sbBuildRows(input),{});
    window.view={rows,allRows:rows,board:{entries:{}},boardReady:true,loading:false,loadError:false,f:{q:'',dest:'all',tile:'',problems:false},mode:'dest',open:{}};
    window.paint=()=>SupplyBoard.render(document.getElementById('board'),view,{paint,reload:async()=>paint()});
    window.sbSet=(key,value)=>{SupplyBoard.clearSelection();if(key==='mode')view.mode=value;else view.f[key]=value;paint();};
    paint();
  });
}
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1366,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await fixture(page);
    const group=page.locator('.sbw-group').filter({has:page.locator('.sbw-group-title strong',{hasText:'ЩУ - 005.004'})});
    await group.locator('[data-select-group]').check();
    await group.locator('[data-baction="group-supplier"]').click();
    assert.match(await page.locator('#sbw-dialog-title').innerText(),/21/);
    await page.locator('#sbw-supplier-options input').first().check();
    await page.locator('#sbw-supplier-save').click();
    await page.waitForFunction(()=>saved.length===1);
    const save=await page.evaluate(()=>saved[0]);
    assert.equal(save.url,'/api/supply/board/change');assert.equal(save.body.targets.length,21);
    assert.deepEqual(save.body.targets.map(x=>x.qty),Array.from({length:21},(_,i)=>i%4+1));
    assert.equal(save.body.patch.supplier_id,7);
    // Клик «Выбрать» в любой выделенной строке также относится к 21 позиции.
    await group.locator('[data-baction="supplier"]').nth(8).click();
    assert.match(await page.locator('#sbw-dialog-title').innerText(),/21/);
    await page.screenshot({path:path.join(output,'supplier-desktop.png')});
    await page.locator('#sbw-dialog [data-close]').first().click();
    // Одиночная невыделенная строка не изменит выбранный щит.
    await page.locator('[data-row="c99:0123456789abcdef"] [data-baction="supplier"]').click();
    assert.match(await page.locator('#sbw-dialog-title').innerText(),/для 1 позиц/);
    await page.locator('#sbw-dialog [data-close]').first().click();
    assert.equal(await page.locator('[data-section="needs"] [data-row="o464"]').count(),0);
    assert.equal(await page.locator('[data-row="o464"]').count(),1);
    assert.match(await page.locator('[data-row="o464"]').innerText(),/нужно 14.*в заказе осталось 30.*докупить 0.*сверх потребности 16/s);
    assert.match(await page.locator('[data-row="o464"]').innerText(),/Счёт №3384/);
    await page.locator('[data-row="o464"] [data-baction="lines"]').click();
    assert.match(await page.locator('.sbw-lines').innerText(),/ТЭНР.*30/s);
    await page.locator('[data-row="o464"] [data-baction="open"]').click();
    assert.deepEqual(await page.evaluate(()=>opened),[464]);
    await page.locator('[data-row="o464"]').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,'order-desktop.png')});
    for(const width of [390,320]){
      await page.setViewportSize({width,height:844});
      await group.locator('[data-select-group]').scrollIntoViewIfNeeded();
      await group.locator('[data-baction="group-supplier"]').click();
      assert.match(await page.locator('#sbw-dialog-title').innerText(),/21/);
      await page.locator('#sbw-dialog [data-close]').first().click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`нет горизонтального скролла ${width}`);
      await page.locator('[data-row="o464"]').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(output,'order-'+width+'.png')});
    }
    // Группировка по поставщику не смешивает потребность и заказ одной номенклатуры.
    await page.selectOption('#sbw-mode','supplier');
    assert.equal(await page.locator('[data-section="orders"] [data-row="o464"]').count(),1);
    assert.equal(await page.locator('[data-section="needs"] [data-row="o464"]').count(),0);
    await page.locator('[data-row="o464"] [data-select]').check();
    await page.locator('.sbw-bulk [data-baction="supplier"]').click();
    assert.match(await page.locator('#sbw-dialog').innerText(),/У уже оформленного заказа поставщик связан со счётом/);
    assert.deepEqual(errors,[]);
    console.log('PASS: массовое сохранение 21 строки, отдельная строка, связь 14/30/16, состав заказа, 1366/390/320 px, группировка, без ошибок JS');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
