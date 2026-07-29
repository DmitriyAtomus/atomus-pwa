const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app-1.js'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const version = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8')
);

function inputAccept(id) {
  const match = html.match(
    new RegExp(`<input[^>]+id="${id}"[^>]+accept="([^"]+)"`, 'i')
  );
  assert.ok(match, `Не найден accept у ${id}`);
  return new Set(match[1].split(','));
}

test('чаты позволяют выбрать инженерные и архивные файлы', () => {
  const expected = ['.dwg', '.dxf', '.step', '.stp', '.iges', '.igs', '.3dm', '.zip'];

  for (const id of ['cchat-file-input', 'tchat-file-input']) {
    const accept = inputAccept(id);
    for (const extension of expected) {
      assert.ok(accept.has(extension), `${id} не принимает ${extension}`);
    }
  }
});

test('версия интерфейса обновлена вместе с API-прокси', () => {
  assert.match(app, /const APP_VERSION = "v2\.45\.832"/);
  assert.match(app, /const APP_VERSION_DATE = "29\.07\.2026"/);
  assert.match(serviceWorker, /atomus-v1\.8\.833/);
  assert.equal(version.version, 'v2.45.832');
  assert.match(version.label, /API-прокси/);
});
