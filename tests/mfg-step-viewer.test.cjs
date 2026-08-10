const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

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

test('деталь STEP подсвечивается и открывает свой PDF по C + ЛКМ', () => {
  const viewer = section('// ============ STEP / STP', 'function mfgDropFiles');
  assert.match(viewer, /function _mfg3dMeshNames\(result\)/);
  assert.match(viewer, /node\.meshes/);
  assert.match(viewer, /function _mfg3dPartMeta/);
  assert.match(viewer, /new THREE\.Raycaster\(\)/);
  assert.match(viewer, /intersectObjects\(built\.pickMeshes, false\)/);
  assert.match(viewer, /material\.emissive\.setHex/);
  assert.match(viewer, /event\.code !== 'KeyC'/);
  assert.match(viewer, /event\.button !== 0 \|\| !cPressed/);
  assert.match(viewer, /opts\.onOpenPdf\(info\.pdfId, info\)/);
  assert.match(viewer, /C \+ ЛКМ — PDF/);
  assert.match(css, /\.mfg3d-tooltip\s*\{/);
  assert.match(css, /\.mfg3d-guide\s*\{/);
});

test('имя узла STEP сопоставляется с деталью AG и её PDF', () => {
  const helpers = section('function _mfg3dMeshNames', 'function _mfg3dGroup');
  const context = {
    _mfgPartPdf: (item, part) => (item.files || []).find(file =>
      file.kind === 'pdf' && file.file_name.toLowerCase().includes(part.designation.toLowerCase())) || null,
  };
  vm.createContext(context);
  vm.runInContext(helpers +
    ';this.meshNames=_mfg3dMeshNames;this.nameKey=_mfg3dNameKey;this.partMeta=_mfg3dPartMeta;', context);

  const result = {
    meshes: [{ name: 'Solid_1' }],
    root: {
      name: 'AG-04.000.000 Корпус', meshes: [], children: [
        { name: 'AG-04.000.001 Стойка', meshes: [0], children: [] },
      ],
    },
  };
  const item = {
    parts: [{ designation: 'AG-04.000.001', name: 'Стойка' }],
    files: [{ id: 77, kind: 'pdf', file_name: 'AG-04.000.001 Стойка.pdf' }],
  };
  const names = context.meshNames(result);
  const meta = context.partMeta(result.meshes[0], 0, names, item);

  assert.deepEqual(Array.from(names[0]), ['AG-04.000.001 Стойка', 'AG-04.000.000 Корпус']);
  assert.equal(meta.designation, 'AG-04.000.001');
  assert.equal(meta.name, 'Стойка');
  assert.equal(meta.pdfId, 77);
  assert.equal(context.nameKey('АГ-04.000.001'), 'AG04000001');
});

test('Three.js и OrbitControls используют одну закреплённую версию', () => {
  assert.match(html, /"three": "https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.185\.1\/build\/three\.module\.js"/);
  assert.match(html, /"three\/addons\/": "https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.185\.1\/examples\/jsm\/"/);
});
