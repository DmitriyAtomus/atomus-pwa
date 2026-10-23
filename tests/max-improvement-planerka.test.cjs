const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-3.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');

function planerkaSection() {
  const start = source.indexOf('function renderPlanerka()');
  const end = source.indexOf('async function plAtt(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return source.slice(start, end);
}

test('доработки из MAX показываются отдельным разделом планёрки', () => {
  const render = planerkaSection();
  assert.match(render, /improvement:\s*\[\]/);
  assert.match(render, /\['improvement', '🛠 Доработки из MAX'\]/);
  assert.match(render, /it\.details/);
});

test('фото и аудио доработки можно открыть прямо из карточки', () => {
  const render = planerkaSection();
  assert.match(render, /a\.kind === 'image'/);
  assert.match(render, /<img src=/);
  assert.match(render, /a\.kind === 'audio'/);
  assert.match(render, /<audio controls preload="metadata"/);
  assert.match(css, /\.pl-impr-files/);
  assert.match(css, /\.pl-impr-file\.audio audio/);
});
