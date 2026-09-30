const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const src = fs.readFileSync('app-3.js', 'utf8');
function part(a,b) { return src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a))); }
function setup(post) {
 const inputs = {'pl-note-inp':{value:'Черновик'}, 'pl-t-emp':{value:'7'},'pl-t-due':{value:'2026-10-02'}};
 const modal = {removed:false,remove(){this.removed=true;}}; inputs['pl-task-modal']=modal;
 const c = {Set,Date,Promise,apiPost:post,document:{getElementById:id=>inputs[id]||null},
  setTimeout:()=>1,clearTimeout:()=>{},showToast:(text,kind)=>c.toasts.push({text,kind}),
  formatApiErrorMessage:(data,fallback)=>data?.message||fallback,renderPlanerka:()=>c.renders++,
  toasts:[],renders:0,state:{currentScreen:"planerka"}};
 vm.createContext(c);
 vm.runInContext(part('var _pl = null;', 'function loadPlanerka()'),c);
 vm.runInContext(part('async function plNoteAdd()', 'async function plNoteDel('),c);
 vm.runInContext(part('async function plStart()', '// «→ Задача»'),c);
 vm.runInContext(part('async function plTaskGo(', '// ============ v2.45.831:'),c);
 c.loadPlanerka=()=>{};c._pl={meeting:null,items:[{id:4}],notes:[],day:'2026-09-30'};
 return {c,inputs,modal};
}
test('start reflects confirmed meeting without waiting for GET',async()=>{
 const {c}=setup(async()=>({ok:true,data:{ok:true,meeting:{started_at:'now'}}}));
 await c.plStart();assert.equal(c._pl.meeting.started_at,'now');assert.equal(c.renders,1);
});
test('duplicate clicks issue one write while response is pending',async()=>{
 let resolve,calls=0;const {c}=setup(()=>{calls++;return new Promise(r=>resolve=r);});
 const first=c.plStart();await c.plStart();assert.equal(calls,1);
 resolve({ok:true,data:{ok:true,meeting:{started_at:'now'}}});await first;
});
test('failed task keeps modal and assignment; reports server error',async()=>{
 const {c,modal}=setup(async()=>({ok:false,status:403,data:{message:'Нет прав'}}));
 await c.plTaskGo(4);assert.equal(modal.removed,false);assert.equal(c._pl.items[0].task_id,undefined);
 assert.equal(c.toasts[0].text,'Нет прав');
});
test('confirmed task updates item and closes modal',async()=>{
 const {c,modal}=setup(async()=>({ok:true,data:{ok:true,task_id:99}}));
 await c.plTaskGo(4);assert.equal(modal.removed,true);assert.equal(c._pl.items[0].task_id,99);
});
test('failed note preserves draft; success clears only submitted text',async()=>{
 const {c,inputs}=setup(async()=>{throw Error('Нет связи');});
 await c.plNoteAdd();assert.equal(inputs['pl-note-inp'].value,'Черновик');
 c.apiPost=async()=>({ok:true,data:{ok:true,id:11}});await c.plNoteAdd();
 assert.equal(inputs['pl-note-inp'].value,'');assert.equal(c._pl.notes[0].id,11);
});
test('pre-mutation read cannot overwrite confirmed mutation',async()=>{
 let resolve;const {c}=setup(async()=>({ok:true,data:{ok:true,meeting:{started_at:'now'}}}));
 const box={innerHTML:''};c.document.getElementById=id=>id==='planerka-content'?box:null;
 c.apiGet=()=>new Promise(r=>resolve=r);
 vm.runInContext(part('function loadPlanerka()', 'function _plFmtDay('),c);
 const old=c.loadPlanerka();const oldResolve=resolve;
 await c.plStart();oldResolve({meeting:null});await old;
 assert.equal(c._pl.meeting.started_at,'now');
 resolve({meeting:{started_at:'now'}});await c._plLoadPromise;
});

test('service worker never replays cached meeting data',()=>{
 const sw=fs.readFileSync('sw.js','utf8');
 const handler=sw.slice(sw.indexOf("if (url.pathname === '/api/planerka'"));
 assert.match(handler,/event\.respondWith\(fetch\(req\)\);\s*return;/);
});
