const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.notEqual(start, -1, `Не найдено начало секции: ${from}`);
  assert.notEqual(end, -1, `Не найден конец секции: ${to}`);
  return source.slice(start, end);
}

test('в шапке раздела «Атом Чиллер» есть кнопка чата', () => {
  const screen = html.slice(html.indexOf('data-screen="atom-chiller"'),
                            html.indexOf('data-screen="models"'));
  assert.match(screen, /id="chiller-chat-btn"/);
  assert.match(screen, /onclick="openChillerChat\(\)"/);
  // до проверки роли кнопка спрятана: ленту чата видит только владелец
  assert.match(screen, /id="chiller-chat-btn"[\s\S]*?display:none/);
});

test('кнопку чата показываем только директору', () => {
  const loader = section("if (screenName === 'atom-chiller')", "if (screenName === 'home-dashboard')");
  assert.match(loader, /chiller-chat-btn/);
  assert.match(loader, /roles\.includes\('director'\)/);
});

// Ленту не дублируем: чат по чиллерам — обычный чат devchat в своём проекте,
// поэтому он виден и в разделе, и на экране «Клава».
test('чат открывается в проекте «Атом Чиллер», а не в отдельном хранилище', () => {
  const fn = section('async function openChillerChat', '// Esc закрывает шторку');
  assert.match(fn, /apiGet\('\/api\/dev-chat\/threads'\)/);
  assert.match(fn, /apiPost\('\/api\/dev-chat\/projects'/);
  assert.match(fn, /apiPost\('\/api\/dev-chat\/threads'/);
  assert.match(fn, /localStorage\.setItem\(DEVCHAT_THREAD_KEY/);
  assert.match(fn, /devChatToggleDrawer\(\)/);
});

test('проект заводится один раз и помнит, где лежит база чиллеров', () => {
  const ctx = {
    calls: [],
    localStorage: { setItem() {}, getItem() { return null; } },
    document: { getElementById() { return null; } },
    showToast() {},
    devChatOpenThread() {},
    devChatLoadThreads() {},
    devChatToggleDrawer() { ctx.opened = true; },
    async apiGet(url) { ctx.calls.push(['GET', url]); return ctx.threadsResponse; },
    async apiPost(url, body) {
      ctx.calls.push(['POST', url, body]);
      if (url.indexOf('projects') >= 0) return { project: { id: 7, name: body.name } };
      return { thread: { id: 42, project_id: body.project_id } };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(section('const CHILLER_PROJECT_NAME', '// Esc закрывает шторку'), ctx);

  // первый заход: ни проекта, ни чата — создаём и то, и другое
  ctx.threadsResponse = { threads: [], projects: [] };
  return ctx.openChillerChat().then(() => {
    const posted = ctx.calls.filter((c) => c[0] === 'POST');
    assert.equal(posted.length, 2);
    assert.equal(posted[0][2].name, 'Атом Чиллер');
    assert.match(posted[0][2].memory, /atomus-3d-baza/);
    assert.match(posted[0][2].memory, /make_viewer\.py/);   // оболочку руками не правим
    assert.equal(posted[1][2].project_id, 7);
    assert.equal(ctx.opened, true);

    // второй заход: и проект, и чат уже есть — ничего не создаём
    ctx.calls = [];
    ctx.threadsResponse = {
      threads: [{ id: 42, project_id: 7 }, { id: 1, project_id: null }],
      projects: [{ id: 7, name: 'Атом Чиллер' }],
    };
    return ctx.openChillerChat().then(() => {
      assert.equal(ctx.calls.filter((c) => c[0] === 'POST').length, 0);
    });
  });
});
