/* Real attachment UI; all data and requests are isolated fixtures. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'app-3.js'),'utf8');
const code=source.slice(source.indexOf('async function openAttachInboxToOrder('),source.indexOf('async function downloadInboxAttachment('));
const output=process.env.SUPPLY_QA_OUTPUT||path.join(root,'docs/previews/inbox-attach');
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    for(const width of [1366,390]){
      const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><head><meta charset="utf-8"></head><body></body></html>'}));
      await page.goto('http://127.0.0.1:8177/fixture');
      await page.addStyleTag({path:path.join(root,'app.css')});
      await page.evaluate(()=>{
        window.API_BASE='http://127.0.0.1:8177';window.TOKEN_KEY='fixture';
        window.cache={supplyInbox:[{id:646,from_name:'Vi work',from_addr:'vi@example.com'}]};
        window.escapeHtml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
        window.toasts=[];window.requests=[];window.reloads=0;
        window.showToast=(text,type)=>toasts.push({text,type});
        window.apiGet=async()=>({items:[{id:472,order_label:'ORD-472',supplier_name:'КИППРИБОР',status_label:'Запрос счёта'},
          {id:470,order_label:'ORD-470',supplier_name:'Гиден электроникс',status_label:'Запрос счёта'}]});
        window.loadSupplyInbox=async()=>{reloads++;};
        window.fetch=async(url,opts)=>{requests.push({url,body:JSON.parse(opts.body)});return new Promise(resolve=>{window.respond=(status,data)=>resolve({ok:status===200,status,json:async()=>data});});};
      });
      await page.addScriptTag({content:code});
      await page.evaluate(()=>openAttachInboxToOrder(646));
      const select=page.locator('#inbox-attach-order-select'),button=page.locator('#inbox-attach-submit');
      assert.equal(await select.inputValue(),'');
      await button.click();
      assert.equal(await page.evaluate(()=>requests.length),0);
      await select.selectOption('472');await button.click();
      assert.equal(await button.isDisabled(),true);assert.equal(await select.isDisabled(),true);
      await page.evaluate(()=>submitAttachInboxToOrder(646));
      assert.equal(await page.evaluate(()=>requests.length),1);
      await page.screenshot({path:path.join(output,`checking-${width}.png`),fullPage:true});
      await page.evaluate(()=>respond(409,{error:'invoice_order_mismatch',message:'В счёте Гиден электроникс; выбран КИППРИБОР. Выберите правильный заказ.'}));
      await page.waitForFunction(()=>!document.getElementById('inbox-attach-submit').disabled);
      assert.equal(await page.locator('#inbox-attach-modal').count(),1);
      assert.equal(await page.evaluate(()=>reloads),0);
      await select.selectOption('470');await button.click();
      await page.evaluate(()=>respond(200,{invoice_number:'1789',invoice_total:30270.15}));
      await page.waitForFunction(()=>reloads===1);
      assert.equal(await page.locator('#inbox-attach-modal').count(),0);
      assert.equal(await page.evaluate(()=>requests[1].body.order_id),470);
      assert.ok(await page.evaluate(()=>toasts.at(-1).text.includes('1789')&&toasts.at(-1).text.includes('270,15')));
      assert.deepEqual(errors,[]);
      await page.close();
    }
    console.log('PASS: explicit order, no empty submit, busy state, double click, mismatch recovery, successful amount display (1366 / 390)');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
