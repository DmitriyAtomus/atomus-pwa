const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-4.js'), 'utf8');

test('полоса отпуска не получает повторное смещение стартовой ячейки', () => {
  const section = source.match(/function renderHrTimeline\(\) \{[\s\S]*?function hrTimelinePrev\(\)/)?.[0] || '';

  assert.match(section, /bar\.style\.left\s*=\s*'0px'/);
  assert.doesNotMatch(section, /bar\.style\.left\s*=\s*startLeft/);
  assert.match(section, /const width\s*=\s*endLeft\s*-\s*startLeft/);
  assert.match(section, /startCell\.appendChild\(bar\)/);
});
