// v2.46.187: «Изделия 3D» (витрина ?only=products) — без расчётов и конструктора
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const src = fs.readFileSync(path.join(__dirname, '..', 'chiller', 'index.html'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('в режиме одного раздела расчёт, подбор и «В проект» выключены', () => {
  assert.match(html, /data-src="\/chiller\/index\.html\?only=products"/);
  assert.match(src, /\['chatBtn','upBtn','calcBtn'\]\.forEach/);
  assert.match(src, /const CHILLER_TOOLS = \(\) => !ONLY;/);
  assert.match(src, /function calcOpen\(\) \{ if\(!CHILLER_TOOLS\(\)\) return;/);
  assert.match(src, /function pickOpen\(\)\{ if\(!CHILLER_TOOLS\(\)\) return;/);
  assert.match(src, /\(CHILLER_TOOLS\(\)\?`<button data-act="proj">В проект<\/button>`:''\)/);
  assert.match(src, /body\.only-mode #calc, body\.only-mode #pick \{ display: none !important; \}/);
});
