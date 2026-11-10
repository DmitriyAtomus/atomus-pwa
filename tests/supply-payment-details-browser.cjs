/* Real payment handler and supply-chain UI; requests/passwords use fixtures only.
 * NODE_PATH=<playwright> node tests/supply-payment-details-browser.cjs */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const app1=fs.readFileSync(path.join(root,'app-1.js'),'utf8');
const app3=fs.readFileSync(path.join(root,'app-3.js'),'utf8');
const start=app1.indexOf('async function _supplyOrderTransitionReq(');
const end=app1.indexOf('async function payDueMarkPaid(',start);
assert.ok(start>=0&&end>start);
const handler=app1.slice(start,end)+app3.slice(app3.indexOf('async function payListMarkPaid('));
const output=process.env.SUPPLY_QA_OUTPUT||path.join(root,'docs/previews/payment-details-20261110');
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1366,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang="ru"><head><meta charset="utf-8"></head><body><button id="pay" onclick="payListMarkPaid(\'invoice\',468,this)">Оплатил</button></body></html>'}));
    await page.goto('http://127.0.0.1:8176/payment-fixture');
    await page.addStyleTag({path:path.join(root,'app.css')});
    await page.evaluate(()=>{
      window.API_BASE='http://127.0.0.1:8176';window.TOKEN_KEY='fixture';window.cache={};
      window._payListFind=()=>fixture;window.dupPayConfirmed=()=>true;window.supOrdDup=()=>null;
      window.showToast=(message,type)=>toasts.push({message,type});window._fillPayDueBlock=()=>{};
      window.confirm=()=>true;window.prompt=()=>{prompts++;return passwords.length?passwords.shift():null;};
      window.resetFixture=(extra={})=>{
        window.fixture={id:468,order_label:'ORD-468',supplier_name:'Тестовый поставщик',purpose:'Вентиляция в Смоленск',kind:null,status:'to_pay',chain_new:true,items:[],...extra};
        window.requests=[];window.toasts=[];window.passwords=['test-password'];window.prompts=0;
        window.savedError=false;window.stillReject=false;window.paid=false;
        document.getElementById('pay').disabled=false;
      };
      resetFixture();
      window.apiGet=async url=>{
        requests.push({method:'GET',url});
        if(url.startsWith('/api/contracts'))return {contracts:[{id:17,number:'24ТД/10.26',contractor_name:'Тестовый договор',status:'production'}]};
        if(url==='/api/supply-orders/468')return structuredClone(fixture);
        throw Error('Unexpected GET '+url);
      };
      window.apiPost=async(url,body)=>{
        requests.push({method:'POST',url,body:structuredClone(body)});
        assertFixturePath(url);
        if(savedError)return {ok:false,status:403,data:{message:'Нет права изменить тип'}};
        fixture.kind=body.kind;
        if(body.dest_type){fixture.dest_type=body.dest_type;fixture.contract_id=body.contract_id;fixture.items.forEach(it=>{if(!scItemDestOk(it)){it.dest_type=body.dest_type;it.dest_contract_id=body.contract_id;}});}
        return {ok:true,data:{ok:true}};
      };
      window.assertFixturePath=url=>{if(url!='/api/supply-orders/468/kind')throw Error('Unexpected POST '+url);};
      window.fetch=async(url,opts)=>{
        const body=JSON.parse(opts.body);requests.push({method:opts.method,url,body});
        if(!url.endsWith('/api/supply-orders/468/transition'))throw Error('Unexpected fetch '+url);
        let status=200,data={ok:true};
        if(!fixture.kind||stillReject){status=422;data={error:'kind_required',message:'Выберите тип закупки'};}
        else if(scPaymentNeedsDest(fixture,fixture.kind)){status=422;data={error:'dest_required',message:'Куда закупаем?'};}
        else if(body.password==null){status=401;data={error:'password_required'};}
        else if(body.password!=='test-password'){status=403;data={error:'wrong_password'};}
        else{paid=true;}
        return {ok:status===200,status,json:async()=>data};
      };
    });
    await page.addScriptTag({content:handler});
    await page.addScriptTag({path:path.join(root,'supply-chain.js')});
    await page.evaluate(()=>{window.loadPayList=()=>{document.getElementById('pay').disabled=false;};});
    const open=async()=>{await page.locator('#pay').click();await page.locator('#sc-payment-details').waitFor();};
    const postKinds=()=>page.evaluate(()=>requests.filter(r=>r.url.endsWith('/kind')));
    const cancel=()=>page.locator('#sc-payment-cancel').click();
    const noKindSelect=async()=>{
      assert.equal(await page.locator('#sc-payment-kind').count(),0);
      assert.equal(await page.locator('text=Тип закупки').count(),0);
    };

    // Missing kind on a new order still needs destination; type is not asked.
    await open();
    await noKindSelect();
    assert.equal(await page.locator('#sc-payment-dest').inputValue(),'');
    assert.equal((await postKinds()).length,0);
    await cancel();
    await page.waitForFunction(()=>!document.getElementById('pay').disabled);
    assert.equal(await page.evaluate(()=>paid),false);
    await open();await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.getElementById('pay').disabled);
    assert.equal((await postKinds()).length,0);
    await open();
    await page.locator('#sc-payment-save').click();
    assert.match(await page.locator('#sc-payment-error').innerText(),/куда закупаем/);
    await page.locator('#sc-payment-dest').selectOption('contract');
    await page.locator('#sc-payment-save').click();
    assert.match(await page.locator('#sc-payment-error').innerText(),/Выберите договор/);
    assert.equal((await postKinds()).length,0);
    await page.locator('#sc-payment-contract').selectOption('17');
    assert.equal(await page.locator('#sc-payment-error').isVisible(),false);
    await noKindSelect();
    await page.screenshot({path:path.join(output,'payment-desktop.png')});
    await page.evaluate(()=>{savedError=true;});
    await page.locator('#sc-payment-save').click();
    await page.waitForFunction(()=>document.getElementById('sc-payment-error').textContent==='Нет права изменить тип');
    assert.equal(await page.evaluate(()=>paid),false);
    assert.equal(await page.locator('#sc-payment-contract').inputValue(),'17');
    await page.evaluate(()=>{savedError=false;passwords=['wrong','test-password'];});
    await page.locator('#sc-payment-save').click();
    await page.waitForFunction(()=>paid);
    assert.equal(await page.evaluate(()=>prompts),2);
    assert.deepEqual((await postKinds()).at(-1).body,{kind:'goods',dest_type:'contract',contract_id:17});
    assert.equal(await page.locator('#sc-payment-details').count(),0);

    // Existing service kind: no modal, no overwrite, cancelled password never pays.
    await page.evaluate(()=>resetFixture({kind:'service'}));
    await page.locator('#pay').click();
    await page.waitForFunction(()=>prompts>0||paid);
    assert.equal(await page.locator('#sc-payment-details').count(),0);
    await page.evaluate(()=>{resetFixture({kind:'service'});passwords=[null];});
    await page.locator('#pay').click();
    await page.waitForFunction(()=>!document.getElementById('pay').disabled);
    assert.equal(await page.evaluate(()=>paid),false);
    assert.equal((await postKinds()).length,0);

    // Preserve assigned lines; supply a default only for missing destinations.
    await page.evaluate(()=>resetFixture({kind:'mfg',items:[{id:1,dest_type:'contract',dest_contract_id:17},{id:2,dest_type:null}]}));
    await page.setViewportSize({width:390,height:844});await open();
    await noKindSelect();
    await page.locator('#sc-payment-dest').selectOption('shop');
    await page.screenshot({path:path.join(output,'payment-mobile.png')});
    await page.locator('#sc-payment-save').click();await page.waitForFunction(()=>paid);
    assert.deepEqual(await page.evaluate(()=>fixture.items),[{id:1,dest_type:'contract',dest_contract_id:17},{id:2,dest_type:'shop',dest_contract_id:null}]);
    assert.deepEqual((await postKinds()).at(-1).body,{kind:'mfg',dest_type:'shop',contract_id:null});
    assert.ok((await postKinds()).every(r=>!('all' in r.body)&&!('item_ids' in r.body)));

    // Legacy order without kind: default goods, no destination question, no modal.
    await page.setViewportSize({width:1366,height:900});
    await page.evaluate(()=>resetFixture({chain_new:false}));
    await page.locator('#pay').click();await page.waitForFunction(()=>paid);
    assert.equal(await page.locator('#sc-payment-details').count(),0);
    assert.deepEqual((await postKinds())[0].body,{kind:'goods'});

    // Missing kind, destination already set: silent default, no modal.
    await page.evaluate(()=>resetFixture({dest_type:'stock'}));
    await page.locator('#pay').click();await page.waitForFunction(()=>paid);
    assert.equal(await page.locator('#sc-payment-details').count(),0);
    assert.deepEqual((await postKinds())[0].body,{kind:'goods'});

    // Already complete order retains its original one-step payment path.
    await page.evaluate(()=>resetFixture({kind:'goods',dest_type:'stock'}));
    await page.locator('#pay').click();await page.waitForFunction(()=>paid);
    assert.equal((await postKinds()).length,0);
    assert.equal(await page.locator('#sc-payment-details').count(),0);

    // Failed silent default does not pay and does not invent destination.
    await page.evaluate(()=>{resetFixture({dest_type:'stock'});savedError=true;});
    await page.locator('#pay').click();
    await page.waitForFunction(()=>!document.getElementById('pay').disabled);
    assert.equal(await page.evaluate(()=>paid),false);
    assert.equal(await page.locator('#sc-payment-details').count(),0);
    assert.deepEqual(await page.evaluate(()=>toasts.at(-1)),{message:'Нет права изменить тип',type:'error'});

    // A repeated server refusal does not reopen the dialog or loop indefinitely.
    await page.evaluate(()=>{resetFixture({chain_new:false});stillReject=true;});
    await page.locator('#pay').click();
    await page.waitForFunction(()=>!document.getElementById('pay').disabled);
    assert.equal(await page.evaluate(()=>paid),false);
    assert.equal((await postKinds()).length,1);
    assert.equal(await page.locator('#sc-payment-details').count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS: payment has no kind picker; default goods when missing; existing kind kept; dest only if required; cancel/Escape; save failure; password and retry; cancelled password; existing line destinations; legacy and complete orders; silent default failure; bounded retries; desktop/mobile. Mocked API only; no real payments.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
