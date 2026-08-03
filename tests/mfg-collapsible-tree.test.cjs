const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app-4.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

test('разделы изготовления корпусов можно сворачивать', () => {
  assert.match(app, /function toggleMfgSection\(id, event\)/);
  assert.match(app, /if \(!collapsed\) kids\.forEach/);
  assert.match(app, /ti-chevron-' \+\s*\(collapsed \? 'right' : 'down'\)/);
  assert.match(css, /\.mfg-node-toggle\s*\{/);
});

test('свёрнутые разделы сохраняются после обновления страницы', () => {
  assert.match(app, /localStorage\.getItem\('mfgCollapsedSections'\)/);
  assert.match(app, /localStorage\.setItem\('mfgCollapsedSections'/);
});
