/* NODE_PATH=<playwright modules> node tests/supply-order-preview-browser.cjs
 * Real card/preview/submit functions; all network requests are mocked locally.
 * No live orders or emails are created/sent. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app-3.js'), 'utf8');
const output = process.env.SUPPLY_QA_OUTPUT || path.join(root, 'docs/previews/order-preview-20261106');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
}
const code = [
  section('async function openExistingShoppingDraft(orderId)', '// «Сформировать заказ»'),
  section('let _opCurrentDraft = null;', 'async function _opFillAliasDatalist'),
  section('function _opBuildItemsHTML(items)', '// v2.45.238: дебаунс'),
  section('async function submitOrderPreview(orderId)', '// ===== Функции для работы с готовыми заказами'),
  section('async function sendSupplyOrderByEmail(orderId)', '// v2.44.35: bulk-выбор'),
  section('function renderSupplyOrderDetail(o)', 'async function openAddOrderItem'),
].join('\n');
(async () => {
  fs.mkdirSync(output, {recursive:true});
  const browser = await chromium.launch({channel:'chrome', headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1366,height:900}});
    const errors=[];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><body><main id="sup-ord-detail" style="max-width:920px;margin:20px auto;padding:16px"></main></body></html>'}));
    await page.goto('http://127.0.0.1:8176/order-preview-fixture');
    await page.addStyleTag({path:path.join(root, 'app.css')});
    await page.evaluate(() => {
      window.API_BASE='http://127.0.0.1:8176'; window.TOKEN_KEY='fixture-token';
      window.state={user:{roles:['director']},currentSupplyOrderId:99}; window.cache={};
      window.escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      window.canManageSupply=()=>true; window.dupOrderPill=()=>''; window.supOrdDup=()=>null;
      window._opFillAliasDatalist=()=>{};
      window.calls=[]; window.toasts=[]; window.refreshed=0;
      window.showToast=(text,type)=>toasts.push({text,type});
      window.loadSupplyOrders=()=>{}; window.loadSupplyShopping=()=>{};
      window.loadSupplyOrderDetail=()=>{refreshed++;};
      window.fixture={id:99,order_label:'ORD-99',status:'draft',status_label:'Черновик',supplier_name:'Тестовый поставщик',supplier_email:'supplier@example.test',supplier_id:7,items_count:2,items:[{id:1,item_name:'Автомат CHINT',item_unit:'шт.',qty:2},{id:2,item_name:'Контактор CHINT',item_unit:'шт.',qty:4}],company_card:{id:8,name:'Карточка предприятия',filename:'requisites.pdf'},preview:{to:'supplier@example.test',subject:'Запрос счёта [ORD-99]',body:'Добрый день!\nПросим выставить счёт на автомат — 2 шт. и контактор — 4 шт.'}};
      window.fetch=async(url,options={})=>{
        calls.push({url,method:options.method||'GET',body:options.body});
        if(url.endsWith('/preview')) return {ok:!window.previewFails,json:async()=>window.previewFails?{message:'Не удалось открыть черновик'}:fixture};
        if(url.endsWith('/send-email')) return {ok:!window.sendFails,json:async()=>window.sendFails?{success:false,message:'Ошибка SMTP'}:{success:true,message:'Тестовая отправка подтверждена'}};
        throw Error('Unexpected request: '+url);
      };
    });
    await page.addScriptTag({content:code});
    await page.evaluate(()=>renderSupplyOrderDetail(fixture));
    const open = () => page.getByRole('button',{name:'Просмотреть и отправить',exact:true}).click();
    await open();
    assert.equal(await page.locator('#op-to').inputValue(),'supplier@example.test');
    assert.match(await page.locator('#op-body').inputValue(),/Просим выставить счёт/);
    assert.match(await page.locator('.op-attachment').first().innerText(),/ORD-99.*2 позиций/);
    assert.match(await page.locator('.op-company-card').innerText(),/Карточка предприятия/);
    assert.deepEqual(await page.evaluate(()=>calls.map(c=>[c.method,c.url])),[['GET','http://127.0.0.1:8176/api/supply-orders/99/preview']]);
    await page.screenshot({path:path.join(output,'preview-desktop.png')});
    await page.locator('#order-preview-modal').getByRole('button',{name:'Отмена',exact:true}).click();
    assert.equal(await page.evaluate(()=>calls.filter(c=>c.method!=='GET').length),0);
    await open();
    await page.locator('#op-to').fill('');
    await page.locator('#op-send-btn').click();
    assert.equal(await page.evaluate(()=>calls.filter(c=>c.method==='POST').length),0);
    await page.locator('#op-to').fill('checked@example.test');
    await page.locator('#op-subject').fill('Проверенная тема [ORD-99]');
    await page.locator('#op-body').fill('Проверенный текст письма');
    await page.evaluate(()=>{window.sendFails=true;});
    await page.locator('#op-send-btn').click();
    await page.waitForFunction(()=>document.getElementById('op-status').classList.contains('err'));
    assert.equal(await page.locator('#op-send-btn').isEnabled(),true);
    assert.equal(await page.locator('#op-body').inputValue(),'Проверенный текст письма');
    await page.evaluate(()=>{window.sendFails=false;});
    await page.locator('#op-send-btn').click();
    await page.waitForFunction(()=>refreshed===1);
    const posts=await page.evaluate(()=>calls.filter(c=>c.method==='POST'));
    assert.equal(posts.length,2); // failed attempt + explicit retry
    assert.ok(posts.every(c=>c.url.endsWith('/99/send-email')));
    assert.deepEqual(JSON.parse(posts[1].body),{email:'checked@example.test',subject:'Проверенная тема [ORD-99]',body:'Проверенный текст письма'});
    assert.equal(await page.locator('#order-preview-modal').count(),0);
    // Missing supplier email still opens the editor; the user can enter an address there.
    await page.evaluate(()=>{fixture.supplier_email='';fixture.preview.to='';renderSupplyOrderDetail(fixture);});
    await open();
    assert.equal(await page.locator('#op-to').inputValue(),'');
    await page.locator('#order-preview-modal').getByRole('button',{name:'Отмена',exact:true}).click();
    await page.evaluate(()=>{window.previewFails=true;});
    await open();
    await page.waitForFunction(()=>toasts.some(t=>t.text==='Не удалось открыть черновик'));
    assert.equal(await page.locator('#order-preview-modal').count(),0);
    assert.equal(await page.evaluate(()=>calls.filter(c=>c.method==='POST').length),2);
    await page.evaluate(()=>{window.previewFails=false;});
    await page.setViewportSize({width:390,height:844});
    await open();
    assert.equal(await page.locator('#op-send-btn').isVisible(),true);
    await page.screenshot({path:path.join(output,'preview-mobile.png')});
    await page.locator('#order-preview-modal').getByRole('button',{name:'Отмена',exact:true}).click();
    await page.evaluate(()=>{window.canManageSupply=()=>false;renderSupplyOrderDetail(fixture);});
    assert.equal(await page.getByRole('button',{name:'Просмотреть и отправить',exact:true}).count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS: existing-order preview, no send on open/cancel, editable fields, attachments, empty address, SMTP failure/retry, detail refresh, missing-email entry, preview failure, permissions, desktop/mobile. Mocked API only.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
