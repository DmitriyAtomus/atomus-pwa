const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-4.js'), 'utf8');

// Окно выбора папки Windows показывает только папки — архив в нём не найти.
// Подписи кнопок должны сразу разводить эти два случая.
test('кнопки загрузки говорят, какая для архива, а какая для папки', () => {
  const files = source.match(/Файлы и архив<\/button>/g) || [];
  const folder = source.match(/Папка целиком<\/button>/g) || [];

  assert.equal(files.length, 2, 'кнопка есть и в разделе, и в карточке изделия');
  assert.equal(folder.length, 2);
  assert.doesNotMatch(source, /ti-file-plus"><\/i> Файлы<\/button>/);
  assert.doesNotMatch(source, /ti-folder"><\/i> Папка<\/button>/);
});

test('подсказка предупреждает, что в окне выбора папки архивов не видно', () => {
  const hints = source.match(/в окне выбора папки архивы не показываются/g) || [];

  assert.equal(hints.length, 2, 'подсказка в обеих зонах загрузки');
});

test('выбор папки остаётся именно выбором папки', () => {
  // webkitdirectory — у кнопки «Папка целиком», обычный выбор — у «Файлы и архив»
  assert.match(source, /id="mfg-quick-input2" multiple webkitdirectory/);
  assert.match(source, /id="mfg-file-input" multiple webkitdirectory/);
  assert.match(source, /id="mfg-quick-input" multiple style/);
  assert.match(source, /id="mfg-file-input2" multiple style/);
});
