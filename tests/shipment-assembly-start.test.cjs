const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app1 = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const app2 = fs.readFileSync(path.join(root, 'app-2.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const version = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));

test('первое открытие сборки подтверждает начало на сервере', () => {
  assert.match(app2, /async function startShipmentAssembly\(contractId\)/);
  assert.match(app2, /\/start-shipment-assembly/);
  assert.match(app2, /Сборка начата — напоминания в цехе остановлены/);
  assert.match(app2, /startShipmentAssembly\(' \+ it\.contract_id/);
  assert.match(app2, /startShipmentAssembly\(' \+ contractId/);
});

test('после подтверждения кнопка продолжает QR-сборку без повторного запроса', () => {
  assert.match(app2, /started \? 'Продолжить сборку' : 'Начать сборку'/);
  assert.match(app2, /gatherStarted \? 'Продолжить сборку' : 'Начать сборку'/);
  assert.match(app2, /openShipmentMode\(" \+ contractId \+ ", 'gather'\)/);
});

test('релиз и кэш обновлены', () => {
  assert.equal(version.version, 'v2.46.120');
  assert.match(app1, /const APP_VERSION = "v2\.46\.120"/);
  assert.match(sw, /atomus-v1\.8\.120/);
});
