const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app-4.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.notEqual(start, -1, `Не найдено начало секции: ${from}`);
  assert.notEqual(end, -1, `Не найден конец секции: ${to}`);
  return source.slice(start, end);
}

test('STEP и STP принимаются как файлы изделия', () => {
  const line = source.match(/const MFG_FILE_RE = \/([^\n]+)\/i;/);
  assert.ok(line, 'не найдена маска файлов изготовления');
  const re = new RegExp(line[1], 'i');

  assert.equal(re.test('Корпус чиллера.step'), true);
  assert.equal(re.test('Корпус чиллера.STP'), true);
  assert.equal(re.test('Корпус чиллера.sldprt'), false);
});

test('в карточке изделия есть настоящее 3D-превью по клику', () => {
  const render = section('function renderMfgItem(it)', 'function mfgZoomPart');
  assert.match(render, /f\.kind === 'step'/);
  assert.match(render, /class="mfg3d-card"/);
  assert.match(render, /id="mfg3d-thumb-/);
  assert.match(render, /onclick="mfgOpenStep\(/);
  assert.match(render, /_mfgInitStepThumbs\(it\)/);
  assert.match(css, /\.mfg3d-card\s*\{/);
  assert.match(css, /\.mfg3d-thumb canvas/);
});

test('STEP читается с авторизацией и преобразуется локально через OpenCascade', () => {
  const viewer = section('// ============ STEP / STP', 'function mfgDropFiles');
  assert.match(viewer, /\/api\/mfg\/files\/.*\/download/);
  assert.match(viewer, /'Authorization': 'Bearer ' \+ token/);
  assert.match(viewer, /ReadStepFile\(new Uint8Array\(buffer\)/);
  assert.match(viewer, /occt-import-js@0\.0\.23/);
  assert.match(viewer, /new THREE\.WebGLRenderer/);
  assert.match(viewer, /new OrbitControls/);
  assert.match(viewer, /size\.length\(\) \/ 2/);
  assert.match(viewer, /fitDistance/);
});

test('большой просмотрщик умеет вращение, масштаб, панораму и полный экран', () => {
  const viewer = section('async function mfgOpenStep', 'function mfgDropFiles');
  const viewerCore = section('function _mfg3dViewer', 'function _mfgDisposeStepThumbs');
  assert.match(viewer, /ЛКМ — вращать/);
  assert.match(viewer, /колёсико — масштаб/);
  assert.match(viewer, /ПКМ — двигать/);
  assert.match(viewer, /mfgStepReset\(\)/);
  assert.match(viewer, /mfgStepFlip\(\)/);
  assert.match(viewer, /Перевернуть модель на 180 градусов/);
  assert.match(viewerCore, /\.rotation\.x = flipped \? Math\.PI : 0/);
  assert.match(viewerCore, /flip\(\) \{/);
  assert.match(viewer, /requestFullscreen/);
  assert.match(viewer, /mfgStepDownload\(/);
  assert.match(css, /\.mfg3d-overlay\s*\{/);
  assert.match(css, /\.mfg3d-box:fullscreen/);
});

test('Three.js и OrbitControls используют одну закреплённую версию', () => {
  assert.match(html, /"three": "https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.185\.1\/build\/three\.module\.js"/);
  assert.match(html, /"three\/addons\/": "https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.185\.1\/examples\/jsm\/"/);
});
