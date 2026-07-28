const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-1.js'), 'utf8');
const start = source.indexOf('function _railBadges()');
const end = source.indexOf('function renderSectionRail()', start);
assert.notEqual(start, -1, '_railBadges must exist');
assert.notEqual(end, -1, 'renderSectionRail marker must exist');
const code = source.slice(start, end);

function railBadges(cache) {
  const context = {
    cache,
    state: {},
    Date,
    Array,
    Number,
  };
  vm.createContext(context);
  vm.runInContext(`${code}; this.result = _railBadges();`, context);
  return context.result;
}

test('sales rail badge uses the same overdue alert count as the home dashboard', () => {
  const badges = railBadges({
    homeExtras: {
      alerts: [{
        kind: 'overdue',
        link: 'contracts',
        count: 4,
      }],
    },
    contractsWithProgress: [
      { delivery_date: '2026-06-01', status: 'production' },
      { delivery_date: '2026-06-02', status: 'production' },
      { delivery_date: '2026-06-03', status: 'production' },
    ],
  });

  assert.equal(badges.sales.n, 4);
  assert.equal(badges.sales.cls, 'r');
});

test('loaded dashboard without overdue alert clears stale sales badge', () => {
  const badges = railBadges({
    homeExtras: { alerts: [] },
    contractsWithProgress: [
      { delivery_date: '2026-06-01', status: 'production' },
    ],
  });

  assert.equal(badges.sales, undefined);
});
