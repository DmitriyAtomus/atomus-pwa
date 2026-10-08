'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const load = (f) => fs.readFileSync(path.join(root, f), 'utf8');

describe('v2.46.254 call-on-phone + vCard', () => {
  it('version/cache/changelog in sync', () => {
    const v = JSON.parse(load('version.json'));
    assert.equal(v.version, 'v2.46.254');
    assert.match(load('sw.js'), /atomus-v2\.46\.254/);
    assert.match(load('app-3.js'), /v2\.46\.254/);
    assert.match(load('app-1.js'), /APP_VERSION\s*=\s*"v2\.46\.254"/);
  });

  it('SW notificationclick opens PWA url, never tel:', () => {
    const sw = load('sw.js');
    const click = sw.slice(sw.indexOf('notificationclick'), sw.indexOf('async function networkFirst'));
    assert.match(click, /atomus-call-dial/);
    assert.match(click, /return self\.clients\.openWindow\(url\)/);
    const codeOnly = click.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(codeOnly, /openWindow\(\s*['"]tel:/);
    assert.match(sw, /call-on-phone/);
  });

  it('hash dial parsing', () => {
    const code = load('prospects.js');
    const start = code.indexOf('var PROSPECT_HASH_RE');
    const end = code.indexOf('function prospectsNavInfo');
    const sandbox = { URLSearchParams };
    vm.createContext(sandbox);
    vm.runInContext(code.slice(start, end), sandbox);
    assert.equal(sandbox.prospectsHashId('#prospects/ATM-5?dial=%2B7999'), 'ATM-5');
    assert.equal(sandbox.prospectsHashDial('#prospects/ATM-5?dial=%2B79991234567'), '+79991234567');
    assert.equal(sandbox.prospectsHashDial('#prospects/ATM-5'), '');
  });

  it('UI: call-on-phone button, vcard, account register', () => {
    const js = load('prospects.js');
    const html = load('index.html');
    const a1 = load('app-1.js');
    assert.match(js, /function prospectsCallOnPhone/);
    assert.match(js, /function prospectsSaveVcard/);
    assert.match(js, /BEGIN:VCARD/);
    assert.match(js, /function prospectsEnsureDialUI/);
    assert.match(js, /data-call-on-phone/);
    assert.match(html, /registerCallDevice/);
    assert.match(html, /Сделать этот телефон рабочим/);
    assert.match(a1, /function registerCallDevice/);
    assert.match(a1, /\/api\/push\/call-device/);
  });

  it('history shows Отправлен на телефон for call_push', () => {
    assert.match(load('prospects.js'), /call_push/);
    assert.match(load('prospects.js'), /Отправлен на телефон/);
  });
});
