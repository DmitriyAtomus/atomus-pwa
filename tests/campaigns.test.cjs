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
    URL, URLSearchParams, FormData, setTimeout, confirm: () => true, canManageSales: () => true, showToast() {},
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
