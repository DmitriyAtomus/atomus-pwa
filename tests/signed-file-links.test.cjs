const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// Раздачи файлов на сервере закрыты подписью (my-bot: require_file_link).
// Адрес файла теперь приходит готовым в поле url — фронт не должен собирать
// его из id, иначе картинки в чатах отвалятся с 403.
const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const sources = ['app-1.js', 'app-2.js', 'app-3.js', 'app-4.js'].map((name) => [name, read(name)]);

test('ссылки на файлы чатов берутся из поля url, а не собираются из id', () => {
  for (const [name, code] of sources) {
    const naked = code.match(/API_BASE \+ '\/api\/(contracts\/chat|team-chats\/messages)\/files\/' \+ f\.id/g);
    assert.equal(naked, null, `${name}: адрес файла собирается из id без подписи`);
  }

  const withUrl = sources
    .map(([, code]) => (code.match(/f\.url \|\| '\/api\/(contracts\/chat|team-chats\/messages)\/files\/' \+ f\.id/g) || []).length)
    .reduce((a, b) => a + b, 0);
  assert.equal(withUrl, 4, 'ожидались 4 места: 3 чата договора + командный чат');
});

test('версия фронта поднята вместе с правкой', () => {
  const version = JSON.parse(read('version.json')).version;
  assert.equal(read('app-1.js').match(/const APP_VERSION = "([^"]+)"/)[1], version);
  assert.match(read('sw.js'), /const CACHE_VERSION = 'atomus-v1\.8\.962';/);
});
