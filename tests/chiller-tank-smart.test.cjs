const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'chiller', 'project.html'), 'utf8');

function section(from, to) {
  const a = page.indexOf(from);
  const b = page.indexOf(to, a);
  assert.notEqual(a, -1, 'not found: ' + from);
  assert.notEqual(b, -1, 'not found: ' + to);
  return page.slice(a, b);
}

test('tank editor keeps the main scene interactive and offers focus/isolation modes', () => {
  assert.match(page, /#tnk\{[^}]*pointer-events:none/);
  assert.match(page, /\.tk-card\{[^}]*pointer-events:auto/);
  for (const id of ['tkFocus', 'tkDim', 'tkSolo', 'tkAll']) {
    assert.match(page, new RegExp(`id="${id}"`));
  }
  const view = section('function tkViewCapture()', 'function tankSmartScore');
  assert.match(view, /target:target\.clone\(\),dist,theta,phi,camTouched/);
  assert.match(view, /target\.copy\(tkViewState\.target\)/);
  assert.match(view, /transparent=x\[1\].*opacity=x\[2\]/s);
  assert.match(view, /document\.body\.classList\.remove\('tk-tank-solo'\)/);
  assert.match(page, /tkViewCapture\(\);tkViewNeedFocus=true/);
  assert.match(page, /tkPreviewClear\(true\);tkViewClose\(\)/);
});

test('Klava exposes three deterministic engineering profiles', () => {
  assert.match(page, /id="tkSmartRun"[^>]*>[^<]*Рассчитать 3 варианта/);
  assert.match(page, /key:'compact',name:'Компактно'/);
  assert.match(page, /key:'solder',name:'Удобно паять'/);
  assert.match(page, /key:'service',name:'Удобно обслуживать'/);

  const code = section('function tankSmartScore', 'function tkBoxGap');
  const api = new Function(code + '\nreturn {tankSmartScore,tankSmartRank};')();
  const compact = {key: 'a', metrics: {inside: 0, collision: 0, support: true,
    centerDist: 10, weightMoment: 100, portClear: 120, serviceClear: 150,
    bendClear: -20, frontBlocked: false}};
  const workable = {key: 'b', metrics: {inside: 0, collision: 0, support: true,
    centerDist: 300, weightMoment: 300, portClear: 400, serviceClear: 420,
    bendClear: 180, frontBlocked: false}};
  assert.equal(api.tankSmartRank('compact', [workable, compact])[0].key, 'a');
  assert.equal(api.tankSmartRank('solder', [compact, workable])[0].key, 'b');
  assert.equal(api.tankSmartRank('service', [compact, workable])[0].key, 'b');
  assert.deepEqual(api.tankSmartRank('service', [compact, workable]).map(x => x.key),
    api.tankSmartRank('service', [compact, workable]).map(x => x.key));
});

test('collision and missing foundation cannot win or be applied', () => {
  const code = section('function tankSmartScore', 'function tkBoxGap');
  const api = new Function(code + '\nreturn {tankSmartScore};')();
  const ok = {inside: 0, collision: 0, support: true, centerDist: 100,
    portClear: 250, serviceClear: 250, bendClear: 100};
  assert.ok(api.tankSmartScore('compact', {...ok, collision: 1}) >
            api.tankSmartScore('compact', ok) + 100000);
  assert.ok(api.tankSmartScore('compact', {...ok, support: false}) >
            api.tankSmartScore('compact', ok) + 100000);
  const apply = section('function tkSmartApply', 'function tkFixDraw');
  assert.match(apply, /m\.inside>0\|\|m\.collision>0\|\|!m\.support/);
});

test('tank fixtures are parametric, require a real base and enter BOM only when linked', () => {
  assert.match(page, /const TK_FIX=\[\['auto','авто'\],\['bracket'/);
  assert.match(page, /function tankSupportCheckBox\(fr,b\)/);
  assert.match(page, /panTop\(fr\)/);
  assert.match(page, /intersectObject\(fr\.obj,true\)/);
  assert.match(page, /Без основания крепёж не создаём/);
  assert.match(page, /if\(fx\.key==='rails'\)[\s\S]*tkTube\(acc,B\.fix/);
  assert.match(page, /else if\(fx\.key==='bracket'\)[\s\S]*B\.bolt/);
  assert.match(page, /isTank\(p\.d\)&&p\.d\.tk\.fix.*p\.link&&p\.link\.mount==='tank'/);
  assert.match(page, /const fr=placed\.find\(x=>x\.uid===p\.link\.to\),ck=fr\?tankSupportCheck/);
});

test('fixture choice changes tank identity and is covered by project/history serialization', () => {
  const id = section('function tkId(P)', 'function tkZones(P)');
  assert.match(id, /'-F'\+P\.fix/);
  const payload = section('function projPayload(){', 'function save(){');
  assert.match(payload, /tk:isTank\(p\.d\)\?p\.d\.tk:undefined/);
  const history = section('async function histApply(snapshot)', 'async function histGo(back)');
  assert.match(history, /isTank\(p\.d\)&&p\.d\.id!==it\.id/);
  assert.match(page, /made\.link=\{to:fr\.uid,mount:'tank',face:'pan'\}/);
  assert.match(page, /made\.link\.rel=tankRelOf\(made,fr\)/);
});

test('all inline scripts compile', () => {
  const scripts = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).filter(Boolean);
  scripts.forEach(s => new Function(s));
  assert.ok(scripts.length);
});
