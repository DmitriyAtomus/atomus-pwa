// v2.46.188: CRM не для поисковиков
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.join(__dirname, '..');
test('robots.txt, noindex и X-Robots-Tag на месте', () => {
  assert.match(fs.readFileSync(path.join(root, 'robots.txt'), 'utf8'), /Disallow: \//);
  for (const f of ['index.html', 'chiller/index.html', 'chiller/project.html', 'atomcad/index.html']) {
    assert.match(fs.readFileSync(path.join(root, f), 'utf8'), /<meta name="robots" content="noindex, nofollow, noarchive">/, f);
  }
  const v = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(v.headers.some(h => h.headers.some(x => x.key === 'X-Robots-Tag' && /noindex/.test(x.value))));
});
