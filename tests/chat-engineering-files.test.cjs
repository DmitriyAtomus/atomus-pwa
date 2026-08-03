const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app-1.js'), 'utf8');
const app3 = fs.readFileSync(path.join(__dirname, '..', 'app-3.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');
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

test('чат расчёта показывает прикреплённые файлы', () => {
  const start = app3.indexOf('async function _calcChatLoad');
  const end = app3.indexOf('async function calcChatSend', start);
  assert.ok(start >= 0 && end > start, 'Найден загрузчик чата расчёта');
  assert.match(app3.slice(start, end), /_renderTeamMessageFiles\(m\.files \|\| \[\]\)/);
});

test('длинный чат расчёта прокручивается внутри панели', () => {
  assert.match(css, /\.calcs-pane\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/);
  assert.match(css, /\.calc-chat\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/);
  assert.match(app3, /boxEl\.scrollTop\s*=\s*boxEl\.scrollHeight/);
});

// v2.45.838: не пиним конкретный номер (ломался при каждом релизе) —
// проверяем согласованность версий между app-1.js, sw.js и version.json.
test('версия интерфейса согласована между app, sw и version.json', () => {
  const appVer = (app.match(/const APP_VERSION = "v(\d+\.\d+\.\d+)"/) || [])[1];
  const swVer = (serviceWorker.match(/atomus-v\d+\.\d+\.(\d+)/) || [])[1];
  assert.ok(appVer, 'APP_VERSION найден в app-1.js');
  assert.equal(version.version, 'v' + appVer);
  assert.equal(swVer, appVer.split('.').pop(), 'sw.js CACHE_VERSION совпадает с APP_VERSION');
  assert.match(app, /const APP_VERSION_DATE = "\d{2}\.\d{2}\.\d{4}"/);
});
