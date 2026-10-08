'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const load = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const eqJson = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));

describe('v2.46.253 mobile nav + prospects', () => {
  it('release: version, cache, version.json and changelog stay in sync', () => {
    const ver = JSON.parse(load('version.json'));
    assert.equal(ver.version, 'v2.46.253');
    assert.match(load('app-1.js'), /APP_VERSION\s*=\s*"v2\.46\.253"/);
    assert.match(load('sw.js'), /CACHE_VERSION\s*=\s*'atomus-v2\.46\.253'/);
    assert.match(load('app-3.js'), /version:'v2\.46\.253'/);
    assert.match(load('.assetsignore'), /^tests$/m);
  });

  it('tab-bar markup: Главная / Продажи / Задачи / Почта / Ещё', () => {
    const html = load('index.html');
    assert.match(html, /data-main-tab="home"/);
    assert.match(html, /data-main-tab="sales"/);
    assert.match(html, /data-main-tab="tasks"/);
    assert.match(html, /data-main-tab="mail"/);
    assert.match(html, /data-main-tab="more"/);
    assert.doesNotMatch(html, /data-main-tab="sections"/);
    assert.doesNotMatch(html, /plus-tab25/);
  });

  it('_mobileMainTabCodes respects installer / shevelev / default', () => {
    const code = load('app-4.js');
    const start = code.indexOf('function _mobileMainTabCodes');
    const end = code.indexOf('\nfunction ', start + 10);
    const fn = code.slice(start, end);
    const sandbox = {
      state: { user: { roles: ['manager'] } },
      _isPureInstaller: () => false,
      _isShevelevMaster: () => false,
    };
    vm.createContext(sandbox);
    vm.runInContext(fn, sandbox);
    eqJson(Array.from(sandbox._mobileMainTabCodes()), ['home', 'sales', 'tasks', 'mail', 'more']);
    sandbox._isPureInstaller = () => true;
    eqJson(Array.from(sandbox._mobileMainTabCodes()), ['installation', 'help', 'more']);
    sandbox._isPureInstaller = () => false;
    sandbox._isShevelevMaster = () => true;
    eqJson(Array.from(sandbox._mobileMainTabCodes()), ['home', 'production', 'tasks', 'more']);
  });

  it('Ещё sheet includes search, create, notifications, account, camera, QR, chats', () => {
    const code = load('app-4.js');
    const start = code.indexOf('function openMobileSections');
    const chunk = code.slice(start, start + 4500);
    assert.match(chunk, /Быстрые действия/);
    assert.match(chunk, /switchMainTab\(\\'search\\'\)/);
    assert.match(chunk, /mobilePlusAction/);
    assert.match(chunk, /switchMainTab\(\\'notifications\\'\)/);
    assert.match(chunk, /switchMainTab\(\\'account\\'\)/);
    assert.match(chunk, /openSupplyInvoiceCameraDirect/);
    assert.match(chunk, /openQrScanner/);
    assert.match(chunk, /openTeamChatsScreen/);
  });

  it('prospects mobile: cards, filters sheet, call sheet, fullscreen drawer', () => {
    const js = load('prospects.js');
    const css = load('prospects.css');
    assert.match(js, /function prospectsMobileListHtml/);
    assert.match(js, /function prospectsFiltersOpen/);
    assert.match(js, /function prospectsCallSheetOpen/);
    assert.match(js, /Как прошёл звонок/);
    assert.match(js, /visibilitychange/);
    assert.match(js, /pm-fullscreen/);
    assert.match(css, /pm-call-fab/);
    assert.match(css, /pm-sheet-root/);
    assert.match(css, /\.prospect-drawer\.pm-fullscreen/);
  });

  it('old tab-bar actions remain reachable via Ещё or header', () => {
    const html = load('index.html');
    const a4 = load('app-4.js');
    assert.match(a4, /name === 'search'/);
    assert.match(a4, /name === 'notifications'/);
    assert.match(a4, /name === 'account'/);
    assert.match(a4, /name === 'more' \|\| name === 'sections'/);
    assert.match(html, /hdr-search-btn--mobile-ok/);
    assert.match(html, /id="notif-bell-btn"/);
    assert.match(html, /top-tools-extra/);
  });
});
