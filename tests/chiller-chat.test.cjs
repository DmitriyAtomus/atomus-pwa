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
    state: { user: { roles: ['director'] } },
    location: { origin: 'https://crm.local' },
    window: { addEventListener(type, fn) { if (type === 'message') ctx.onMessage = fn; } },
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

      // из полноэкранной 3D-базы чат просит открыть сам модуль
      ctx.calls = [];
      ctx.onMessage({ origin: 'https://crm.local', data: { type: 'atom-chiller-chat' } });
      assert.ok(ctx.calls.length, 'свой модуль должен открывать чат');
      // чужая страница и не-директор — мимо
      ctx.calls = [];
      ctx.onMessage({ origin: 'https://evil.example', data: { type: 'atom-chiller-chat' } });
      ctx.state.user.roles = ['manager'];
      ctx.onMessage({ origin: 'https://crm.local', data: { type: 'atom-chiller-chat' } });
      ctx.state.user.roles = ['director'];
      assert.equal(ctx.calls.length, 0);
    });
  });
});

// Живая переписка «Чиллера» родилась раньше проекта, поэтому project_id у неё
// пустой. Новый чат на её месте заводить нельзя: в разделе откроется пустой
// дубль, и лента будет выглядеть стёртой.
test('живой чат переносится в проект, а не подменяется пустым дублем', () => {
  const ctx = {
    calls: [],
    state: { user: { roles: ['director'] } },
    location: { origin: 'https://crm.local' },
    window: { addEventListener() {} },
    saved: null,
    DEVCHAT_THREAD_KEY: 'atomus_devchat_thread',   // объявлен выше по файлу, в вырезку не попадает
    localStorage: { setItem(k, v) { ctx.saved = v; }, getItem() { return null; } },
    document: { getElementById() { return null; } },
    showToast() {},
    devChatOpenThread() {},
    devChatLoadThreads() {},
    devChatToggleDrawer() {},
    async apiGet() {
      return {
        threads: [{ id: 5, project_id: null, title: 'Чиллера' }, { id: 1, project_id: null, title: 'Общий чат' }],
        projects: [{ id: 2, name: 'Атом Чиллер' }],
      };
    },
    async apiPost(url, body) { ctx.calls.push(['POST', url, body]); return { thread: { id: 99 } }; },
    async apiPatch(url, body) {
      ctx.calls.push(['PATCH', url, body]);
      return { thread: { id: 5, project_id: body.project_id } };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(section('const CHILLER_PROJECT_NAME', '// Esc закрывает шторку'), ctx);

  return ctx.openChillerChat().then(() => {
    assert.equal(ctx.calls.filter((c) => c[0] === 'POST').length, 0, 'дубль заводить нельзя');
    assert.equal(ctx.calls[0][0], 'PATCH');
    assert.equal(ctx.calls[0][1], '/api/dev-chat/threads/5');
    assert.equal(ctx.calls[0][2].project_id, 2);
    assert.equal(ctx.saved, '5', 'шторка должна сесть на живую переписку');
  });
});

// Пустой дубль в проекте мог остаться от прежней версии. Садиться надо на тот
// чат, где лежит переписка, иначе после перезагрузки лента выглядит стёртой.
test('из двух чатов проекта открывается тот, где есть переписка', () => {
  const ctx = {
    calls: [],
    state: { user: { roles: ['director'] } },
    location: { origin: 'https://crm.local' },
    window: { addEventListener() {} },
    saved: null,
    DEVCHAT_THREAD_KEY: 'atomus_devchat_thread',
    localStorage: { setItem(k, v) { ctx.saved = v; }, getItem() { return null; } },
    document: { getElementById() { return null; } },
    showToast() {},
    devChatOpenThread() {},
    devChatLoadThreads() {},
    devChatToggleDrawer() {},
    async apiGet() {
      return {
        // пустой дубль свежее — в списке он идёт первым
        threads: [{ id: 9, project_id: 2, title: 'Чиллеры', msg_count: 0 },
                  { id: 5, project_id: 2, title: 'Чиллера', msg_count: 16 }],
        projects: [{ id: 2, name: 'Атом Чиллер' }],
      };
    },
    async apiPost(url, body) { ctx.calls.push(['POST', url, body]); return { thread: { id: 99 } }; },
    async apiPatch(url, body) { ctx.calls.push(['PATCH', url, body]); return { thread: { id: 5 } }; },
  };
  vm.createContext(ctx);
  vm.runInContext(section('const CHILLER_PROJECT_NAME', '// Esc закрывает шторку'), ctx);

  return ctx.openChillerChat().then(() => {
    assert.equal(ctx.calls.length, 0, 'ничего создавать и переносить не нужно');
    assert.equal(ctx.saved, '5', 'шторка должна сесть на чат с перепиской');
  });
});

// v2.45.975: лента переехала внутрь модуля — шторку CRM поверх полного экрана и
// поверх карточки позиции всё равно было не видно. Кнопки две: в шапке базы и
// круглая поверх модели; обе открывают свою панель, CRM для этого не нужна.
// Подробности панели — в tests/chiller-viewer-chat.test.cjs.
test('в 3D-базе чат открывается своей панелью, без обращения к CRM', () => {
  const shell = fs.readFileSync(path.join(root, 'chiller', 'index.html'), 'utf8');
  assert.match(shell, /id="chatBtn"/);
  assert.match(shell, /id="chatFab"/);
  assert.match(shell, /onclick="toggleChat\(\)"/);   // одна кнопка и вызывает, и убирает
  const fn = shell.slice(shell.indexOf('function openChat()'), shell.indexOf('function closeChat()'));
  assert.match(fn, /classList\.add\('open'\)/);
  assert.doesNotMatch(fn, /postMessage/);
});
