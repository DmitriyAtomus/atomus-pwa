const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'prospects.js'), 'utf8');
const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function harness() {
  const elements = new Map();
  const node = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', value: '', dataset: {}, setAttribute() {}, removeAttribute() {} });
    return elements.get(id);
  };
  const ctx = vm.createContext({ URL, URLSearchParams, escapeHtml, setTimeout, clearTimeout,
    canManageSales: () => true, showToast() {},
    document: { getElementById: node, querySelectorAll: () => [], querySelector: selector => node(selector) } });
  vm.runInContext(source, ctx); return { ctx, node };
}
function response(name) { return { rows: [{ id: 'ATM-123', name, email: '<img src=x onerror=alert(1)>', phone: '+79000000001', site: 'javascript:alert(1)', stage: 'new' }], total: 1, page: 1, pages: 1,
  stats: {total:1,email:1,phone:1}, facets: { segment: [], region: [], owner: [] }, stages: {new:'Новый'}, consents: {} }; }
test('untrusted contacts and URLs render as escaped text, never script links', async () => {
  const {ctx,node} = harness();
  ctx.apiGet = async () => response('<svg onload=alert(1)>');
  await ctx.loadProspects();
  const html = node('prospects-list').innerHTML;
  assert.match(html, /&lt;svg/); assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<svg|<img|href="javascript:/);
  assert.equal(ctx.prospectsUrl('data:text/html,hello'), '');
  assert.equal(ctx.prospectsUrl('https://example.org'), 'https://example.org/');
});
test('late search response cannot overwrite the newer filter result', async () => {
  const {ctx,node} = harness(); const pending = [];
  ctx.apiGet = () => new Promise(resolve => pending.push(resolve));
  const first = ctx.loadProspects(); const second = ctx.loadProspects();
  pending[1](response('Новая выдача')); await second;
  pending[0](response('Старая выдача')); await first;
  assert.match(node('prospects-list').innerHTML, /Новая выдача/);
  assert.doesNotMatch(node('prospects-list').innerHTML, /Старая выдача/);
});
test('return to list invalidates pending detail response', async () => {
  const {ctx,node} = harness(); let resolve;
  ctx.apiGet = () => new Promise(r => { resolve = r; });
  const pending = ctx.prospectsOpen('ATM-123'); ctx.prospectsClose();
  resolve({id:'ATM-123'}); await pending;
  assert.equal(node('prospects-detail').hidden, true);
  assert.equal(ctx._prospects.current, null);
});
