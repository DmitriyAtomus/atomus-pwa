const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'campaigns.js'), 'utf8');
function harness() {
  const elements = new Map();
  const node = id => {
    if (!elements.has(id)) elements.set(id, { value: '', hidden: false, dataset: {}, textContent: '', innerHTML: '', setAttribute() {}, removeAttribute() {}, querySelectorAll() { return []; } });
    return elements.get(id);
  };
  const ctx = vm.createContext({
    window: { addEventListener() {} }, document: { getElementById: node, querySelectorAll: () => [] },
    escapeHtml: v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    localStorage: { getItem: () => 'test-token' }, API_BASE: '', TOKEN_KEY: 'token',
    URL, URLSearchParams, FormData, setTimeout: () => 1, clearTimeout() {}, confirm: () => true, canManageSales: () => true, showToast() {},
  });
  vm.runInContext(source, ctx);
  return { ctx, node };
}
const draft = () => ({ name: 'Камеры', subject: 'Подбор', body: 'Текст', signature: 'Атомус', recipient_ids: ['ATM-ONE'], materials: [] });

test('selection persists across pages and clearing removes all IDs', () => {
  const {ctx,node}=harness();
  ctx.campaignsToggle('ATM-ONE',true);ctx.campaignsToggle('ATM-TWO',true);ctx.campaignsToggle('ATM-ONE',true);
  assert.equal(ctx._campaigns.selected.size,2);
  ctx.campaignsToggle('ATM-ONE',false);assert.equal(ctx._campaigns.selected.has('ATM-TWO'),true);
  assert.equal(node('campaigns-selected').textContent,'Выбрано: 1');
  ctx.campaignsClearSelection();assert.equal(ctx._campaigns.selected.size,0);
});

test('reopened draft edits do not mutate saved version and must save before retest', async () => {
  const {ctx}=harness();let stored={id:'a'.repeat(32),status:'draft',revision:1,tested_revision:1,draft:draft()};let updates=0;
  ctx.campaignsRequest=async (p,method,body)=>{
    if(p==='')return {materials:[]};
    if(method==='PUT'){updates++;stored={...stored,revision:2,tested_revision:null,draft:structuredClone(body.draft)};return {id:stored.id};}
    return structuredClone(stored);
  };
  ctx.campaignsEditor=()=>{};ctx.campaignsSync=()=>{};
  await ctx.campaignsOpen(stored.id);
  ctx._campaigns.draft.subject='Новая тема';
  assert.equal(ctx._campaigns.current.draft.subject,'Подбор');
  await ctx.campaignsSave();
  assert.equal(updates,1);assert.equal(ctx._campaigns.current.tested_revision,null);
  await ctx.campaignsSave();assert.equal(updates,1,'unchanged save preserves version');
});

test('saving a new draft only calls save/detail, never send or launch', async()=>{
  const {ctx}=harness();const calls=[];ctx.campaignsSync=()=>{};ctx._campaigns.draft=draft();
  ctx.campaignsRequest=async(p,method,body)=>{calls.push([p,method]);return method==='POST'?{id:'new'}:{id:'new',revision:1,status:'draft',draft:structuredClone(ctx._campaigns.draft)};};
  await ctx.campaignsSave();
  assert.deepEqual(calls,[['','POST'],['/new',undefined]]);
});

test('launch refuses an untested saved revision without issuing a launch request', async()=>{
  const {ctx}=harness();let requested=false;
  ctx.campaignsSave=async()=>({id:'x',revision:2,tested_revision:1});
  ctx.campaignsAudience=async()=>{};ctx.campaignsRequest=async()=>{requested=true};
  await assert.rejects(ctx.campaignsLaunch(),/Сначала отправьте тест/);assert.equal(requested,false);
});

test('failed API response is surfaced and authorization accompanies requests', async()=>{
  const {ctx}=harness();let options;
  ctx.fetch=async(url,opts)=>{options=opts;return {ok:false,text:async()=>JSON.stringify({message:'Нет прав'})}};
  await assert.rejects(ctx.campaignsRequest('/preview','POST',draft()),/Нет прав/);
  assert.equal(options.headers.Authorization,'Bearer test-token');assert.equal(options.cache,'no-store');
});

test('poll transitions launched draft to report without sending and preserves unsent edits', async () => {
  const {ctx}=harness();
  ctx._campaigns.current={id:'a',status:'draft',draft:draft()};ctx._campaigns.draft=draft();
  ctx._campaigns.draft.body='unsaved edit';
  let rendered=0;ctx.campaignsReport=()=>rendered++;
  ctx.campaignsRequest=async(path,method)=>{assert.equal(method,undefined);return {id:'a',status:'draft',draft:draft()};};
  await ctx.campaignsPoll('a',0);
  assert.equal(ctx._campaigns.draft.body,'unsaved edit');assert.equal(rendered,0);
  ctx.campaignsRequest=async()=>({id:'a',status:'running',recipients:[]});
  await ctx.campaignsPoll('a',0);
  assert.equal(ctx._campaigns.draft,null);assert.equal(rendered,1);
});

test('late polling result cannot reopen a closed report', async () => {
  const {ctx,node}=harness();ctx._campaigns.current={id:'a'};
  let resolve;ctx.campaignsRequest=()=>new Promise(r=>resolve=r);
  let rendered=false;ctx.campaignsReport=()=>{rendered=true};
  const pending=ctx.campaignsPoll('a',0);ctx.campaignsClose();
  resolve({id:'a',status:'running'});await pending;
  assert.equal(rendered,false);assert.equal(node('campaigns-panel').hidden,true);
});

test('progress separates sent, queued, returned and failed mail', () => {
  const {ctx}=harness();
  const result=ctx.campaignsProgress({status:'running',recipients:[
    {state:'sent',provider_id:'one',events:['sent','bounced']},
    {state:'queued',events:[]},{state:'failed',events:[]}
  ]});
  assert.match(result,/Идёт отправка/);assert.match(result,/1 из 3/);
  assert.match(result,/В очереди: <b>1/);assert.match(result,/Возвраты: <b>1/);
  assert.match(result,/Ошибки \/ нужна проверка: <b>1/);
  assert.match(ctx.campaignsProgress({status:'paused',recipients:[]}),/на паузе/);
  assert.match(ctx.campaignsProgress({status:'completed',recipients:[]}),/завершена/);
  assert.match(ctx.campaignsProgress({status:'running',scheduled_at:Date.now()/1000+3600,recipients:[]}),/запланирована/);
});


test('daily quota waiting displays automatic retry without overriding pause', () => {
  const {ctx}=harness();
  const campaign={status:'running',quota:{used:100,limit:100,remaining:0,next_at:Date.now()/1000+3600},recipients:[{state:'queued',events:[]}]};
  const result=ctx.campaignsProgress(campaign);
  assert.match(result,/Ожидаем доступный лимит/);
  assert.match(result,/Автоматическая повторная попытка/);
  assert.match(result,/100 из 100 писем/);
  assert.doesNotMatch(result,/Идёт отправка/);
  assert.match(ctx.campaignsProgress({...campaign,status:'paused'}),/Отправка на паузе/);
  assert.doesNotMatch(ctx.campaignsProgress({...campaign,status:'paused'}),/Автоматическая повторная попытка/);
});


test('bulk consent records current selection then refreshes audience without sending', async () => {
  const {ctx,node}=harness();ctx._campaigns.draft=draft();
  node('campaign-consent-basis').value='При встрече согласились';node('campaign-consent-date').value='2026-01-01';
  let refreshed=0,requests=0;ctx.campaignsAudience=async()=>refreshed++;
  ctx.campaignsRequest=async(path,method,body)=>{
    requests++;assert.equal(path,'/bulk-consent');assert.equal(method,'POST');
    assert.deepEqual(Array.from(body.recipient_ids),['ATM-ONE']);
    assert.equal(body.basis,'При встрече согласились');assert.equal(body.date,'2026-01-01');
    return {updated:1,skipped:0};
  };
  await ctx.campaignsBulkConsent();
  assert.equal(requests,1);assert.equal(refreshed,1);assert.equal(node('campaign-consent').hidden,true);
  assert.match(node('campaign-consent-result').textContent,/зафиксировано: 1/);
  node('campaign-consent-basis').value='';
  await assert.rejects(ctx.campaignsBulkConsent(),/основание и дату/);assert.equal(requests,1);
});


test('launch uses visible confirmation even when browser dialogs are blocked', async () => {
  const {ctx,node}=harness();ctx.confirm=()=>{throw Error('Native confirm must not be used')};
  ctx._campaigns.draft=draft();ctx._campaigns.config={blockers:[],sender:'orders@example.org'};
  ctx._campaigns.preview={included:[{email:'one@example.org'}]};
  ctx.campaignsSave=async()=>({id:'a',revision:1,tested_revision:1});ctx.campaignsAudience=async()=>{};
  let launches=0,opened=0;ctx.campaignsOpen=async()=>opened++;
  ctx.campaignsRequest=async(path,method,body)=>{assert.equal(path,'/a/launch');assert.equal(body.confirm,true);launches++};
  await ctx.campaignsLaunch();assert.equal(launches,0);assert.equal(node('campaign-launch-confirm').hidden,false);
  assert.match(node('campaign-launch-confirm').innerHTML,/Запустить рассылку/);
  await ctx.campaignsConfirmLaunch();assert.equal(launches,1);assert.equal(opened,1);
});

test('changed audience requires fresh visible confirmation and errors persist', async () => {
  const {ctx,node}=harness();ctx._campaigns.draft=draft();ctx._campaigns.config={blockers:[],sender:'orders@example.org'};
  ctx._campaigns.preview={included:[{email:'one@example.org'}]};
  ctx.campaignsSave=async()=>({id:'a',revision:1,tested_revision:1});ctx.campaignsAudience=async()=>{};
  let launches=0;ctx.campaignsRequest=async()=>launches++;
  await ctx.campaignsLaunch();ctx._campaigns.preview.included.push({email:'two@example.org'});
  await ctx.campaignsConfirmLaunch();assert.equal(launches,0);
  assert.match(node('campaign-launch-confirm').innerHTML,/2 адресов/);
  ctx.campaignsSave=async()=>{throw Error('Сервер недоступен')};
  await ctx.campaignsRun(ctx.campaignsConfirmLaunch);
  assert.equal(node('campaign-launch-status').textContent,'Сервер недоступен');
  assert.equal(ctx._campaigns.busy,false);
});
