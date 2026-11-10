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
        if(url==='/api/supply-orders/468/kind'){
          if(savedError)return {ok:false,status:403,data:{message:'Нет права изменить тип'}};
          fixture.kind=body.kind;
          if(body.dest_type){fixture.dest_type=body.dest_type;fixture.contract_id=body.contract_id;}
          return {ok:true,data:{ok:true}};
        }
        if(url==='/api/supply-orders/468/dest'){
          if(savedError)return {ok:false,status:403,data:{message:'Нет права изменить назначение'}};
          const dest=body.dest_type, cid=body.contract_id||null, all=!!body.all;
          const wanted=new Set((body.item_ids||[]).map(Number));
          if(all) throw Error('must not send all=true for default dest');
          if((fixture.items||[]).length){
            fixture.items.forEach(it=>{if(wanted.has(Number(it.id))){it.dest_type=dest;it.dest_contract_id=cid;}});
          }else{
            fixture.dest_type=dest;fixture.contract_id=cid;
          }
          return {ok:true,data:{ok:true,updated:wanted.size}};
        }
        throw Error('Unexpected POST '+url);
      };
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
    const posts=prefix=>page.evaluate(p=>requests.filter(r=>r.url.endsWith(p)),prefix);
    const noModal=async()=>{assert.equal(await page.locator('#sc-payment-details').count(),0);};

    // New typeless order: silent goods + stock, no modal, then password.
    await page.locator('#pay').click();
    await page.waitForFunction(()=>paid);
    await noModal();
    assert.equal(await page.evaluate(()=>prompts),1);
    assert.deepEqual((await posts('/kind'))[0].body,{kind:'goods'});
    assert.deepEqual((await posts('/dest'))[0].body,{dest_type:'stock',item_ids:[],all:false});
    await page.screenshot({path:path.join(output,'payment-after-paid.png')});

    // Password cancel never pays (defaults may already be saved).
    await page.evaluate(()=>{resetFixture();passwords=[null];});
    await page.locator('#pay').click();
    await page.waitForFunction(()=>!document.getElementById('pay').disabled);
    await noModal();
    assert.equal(await page.evaluate(()=>paid),false);
    assert.deepEqual((await posts('/kind'))[0].body,{kind:'goods'});

    // Existing service kind: no writes, cancelled password never pays.
    await page.evaluate(()=>{resetFixture({kind:'service'});passwords=[null];});
    await page.locator('#pay').click();
    await page.waitForFunction(()=>!document.getElementById('pay').disabled);
    assert.equal(await page.evaluate(()=>paid),false);
    assert.equal((await posts('/kind')).length,0);
    assert.equal((await posts('/dest')).length,0);

    // Preserve assigned lines; stock only for the empty one; do not rewrite kind.
    await page.evaluate(()=>resetFixture({kind:'mfg',items:[{id:1,dest_type:'contract',dest_contract_id:17},{id:2,dest_type:null}]}));
    await page.locator('#pay').click();await page.waitForFunction(()=>paid);
    await noModal();
    assert.equal((await posts('/kind')).length,0);
    assert.deepEqual((await posts('/dest'))[0].body,{dest_type:'stock',item_ids:[2],all:false});
    assert.deepEqual(await page.evaluate(()=>fixture.items),[{id:1,dest_type:'contract',dest_contract_id:17},{id:2,dest_type:'stock',dest_contract_id:null}]);

    // Legacy typeless: only kind=goods, no invented destination.
    await page.evaluate(()=>resetFixture({chain_new:false}));
    await page.locator('#pay').click();await page.waitForFunction(()=>paid);
    await noModal();
    assert.deepEqual((await posts('/kind'))[0].body,{kind:'goods'});
    assert.equal((await posts('/dest')).length,0);

    // Typeless with dest already set: only kind.
    await page.evaluate(()=>resetFixture({dest_type:'stock'}));
    await page.locator('#pay').click();await page.waitForFunction(()=>paid);
    assert.deepEqual((await posts('/kind'))[0].body,{kind:'goods'});
    assert.equal((await posts('/dest')).length,0);

    // Already complete: one-step payment, no writes.
    await page.evaluate(()=>resetFixture({kind:'goods',dest_type:'stock'}));
    await page.locator('#pay').click();await page.waitForFunction(()=>paid);
    assert.equal((await posts('/kind')).length,0);
    assert.equal((await posts('/dest')).length,0);
    await noModal();

    // Failed silent default does not pay and does not open a modal.
    await page.evaluate(()=>{resetFixture({dest_type:'stock'});savedError=true;});
    await page.locator('#pay').click();
    await page.waitForFunction(()=>!document.getElementById('pay').disabled);
    assert.equal(await page.evaluate(()=>paid),false);
    await noModal();
    assert.deepEqual(await page.evaluate(()=>toasts.at(-1)),{message:'Нет права изменить тип',type:'error'});

    // Repeated server refusal does not reopen a dialog.
    await page.evaluate(()=>{resetFixture({chain_new:false});stillReject=true;});
    await page.locator('#pay').click();
    await page.waitForFunction(()=>!document.getElementById('pay').disabled);
    assert.equal(await page.evaluate(()=>paid),false);
    assert.equal((await posts('/kind')).length,1);
    await noModal();

    // Flag off restores the destination modal (reversible).
    await page.evaluate(()=>{SC_FLAGS.hidePurchaseKind=false;resetFixture();});
    await page.locator('#pay').click();
    await page.locator('#sc-payment-details').waitFor();
    assert.equal(await page.locator('#sc-payment-kind').count(),0);
    await page.locator('#sc-payment-cancel').click();
    await page.waitForFunction(()=>!document.getElementById('pay').disabled);
    assert.equal(await page.evaluate(()=>paid),false);
    await page.evaluate(()=>{SC_FLAGS.hidePurchaseKind=true;});

    assert.deepEqual(errors,[]);
    console.log('PASS: kind hidden; payment has no clarification modal; default goods+stock only when required; existing kind/dest kept; legacy orders; complete orders; silent failure; bounded retries; flag restores modal. Mocked API only; no real payments.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
