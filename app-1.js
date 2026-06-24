const API_BASE = "https://worker-production-9b70.up.railway.app";
const TOKEN_KEY = "atomus_token";
// Версия приложения — обновляется при каждом релизе вместе с CACHE_VERSION в sw.js
const APP_VERSION = "v2.45.537-atomcad-stampfix2";
const APP_VERSION_DATE = "24.06.2026";

// ============ ЭТАП 29: ПРОВЕРКА ПРАВ ============
// hasPermission(key) — true если у текущего пользователя есть указанный permission.
// state.user.permissions заполняется бэком при логине и в /api/me.
// Старый код продолжает использовать state.user.roles — для обратной совместимости
// бэк его тоже отдаёт (derive из permissions уровня доступа).
function hasPermission(key) {
  if (!state.user) return false;
  // v2.9.1: legacy-роль director даёт все права. Это для владельца чата
  // (хозяин Atomus, который не записан в employees), а также страховка
  // от рассинхрона permissions с бэка.
  const roles = state.user.roles || [];
  if (roles.indexOf('director') >= 0) return true;
  const perms = state.user.permissions;
  if (!Array.isArray(perms)) {
    return false;
  }
  return perms.indexOf(key) >= 0;
}
// v2.45.182: печать QR-наклеек доступна не только по праву labels_print, но и
// ролям директор/менеджер/зам/мастер (как и на бэкенде — _user_has_labels_print).
// Раньше у менеджера (Малахова) и мастера кнопка печати была скрыта.
function canPrintLabels() {
  if (hasPermission('labels_print')) return true;
  const roles = (state.user && state.user.roles) || [];
  return roles.indexOf('director') >= 0 || roles.indexOf('manager') >= 0
      || roles.indexOf('zam') >= 0 || roles.indexOf('master') >= 0;
}
// Удобная shortcut для проверки списка разрешений (любое из):
function hasAnyPermission(/* ...keys */) {
  for (let i = 0; i < arguments.length; i++) {
    if (hasPermission(arguments[i])) return true;
  }
  return false;
}

// ============ Архитектура «под расширения» ============
// Структура: section → sidebar item → screen
// Чтобы добавить новый раздел, надо:
//   1. Добавить кнопку в .section-switcher
//   2. Создать sidebar с id="sidebar-<name>" data-section="<name>"
//   3. Создать экраны с data-section="<name>"
//   4. (опционально) Кастомизировать SECTION_CONFIG
const SECTION_CONFIG = {
  home:       { sidebar: 'sidebar-home',       defaultScreen: 'home-dashboard' },   // ЭТАП 16Б
  production: { sidebar: 'sidebar-production', defaultScreen: 'dashboard' },
  sales:      { sidebar: 'sidebar-sales',      defaultScreen: 'sales-dashboard' },
  tasks:      { sidebar: 'sidebar-tasks',      defaultScreen: 'tasks-list' },       // ЭТАП 16В
  warehouse:  { sidebar: 'sidebar-warehouse',  defaultScreen: 'warehouse-dashboard' },     // ЭТАП 18 → 28.1
  logistics:  { sidebar: 'sidebar-coming',     defaultScreen: 'coming-logistics', comingSoon: true },
  supply:     { sidebar: 'sidebar-supply',     defaultScreen: 'supply-shopping' },    // ЭТАП 19; v2.45.339: открывать сразу «Что закупить»
  defects:    { sidebar: 'sidebar-defects',    defaultScreen: 'defects-list' },       // ЭТАП 22
  installation: { sidebar: 'sidebar-installation', defaultScreen: 'installation-list' }, // v2.45.346 Монтаж
  hr:         { sidebar: 'sidebar-hr',         defaultScreen: 'hr-vacations-timeline' }, // ЭТАП 20
  help:       { sidebar: 'sidebar-help',       defaultScreen: 'help-knowledge' },
};

const state = {
  user: null,
  currentSection: 'home',          // ЭТАП 16Б: главная — по умолчанию
  currentScreen: 'home-dashboard',
  historyFilter: 'month',
  summaryFilter: 'month',
  summaryCustomFrom: null,
  summaryCustomTo: null,
  summaryEmployeeFilter: null,     // v2.35.0: id сборщика или null = все
  isDesktop: false,
  newAssembly: {
    model: null, execution: null, ipClass: null,
    quantity: 1, workerIds: [], dateMode: 'today', customDate: null, comment: '',
  },
  // ===== Продажи =====
  salesContractsFilter: 'all',        // фильтр статуса в списке договоров
  salesContractsSearch: '',
  salesContractorsFilter: 'all',       // фильтр типа в списке контрагентов
  salesContractorsSearch: '',
  currentContractId: null,             // ID открытого договора
  currentContractorId: null,           // ID открытого контрагента (или null = новый)
  contractFormMode: 'new',             // 'new' или 'edit'
  contractorFormMode: 'new',
  // Текущее состояние формы договора
  contractForm: {
    number: '', sign_date: '', contractor_id: null, contract_type: 'supply',
    legal_entity: 'ooo_atomus', sum_amount: '', delivery_date: '',
    delivery_address: '', manager_id: null, comment: '',
    payment_date: '',  // ЭТАП 37
  },
  // Текущее состояние формы контрагента
  contractorForm: {
    name: '', contractor_type: 'legal', inn: '', phone: '',
    contact_person: '', address: '', comment: '',
  },
};

const cache = {
  dashboard: null, history: {}, summary: {},
  employees: null, models: null, activeEmployees: null,
  // ===== Продажи =====
  contracts: null,           // массив договоров (все)
  contractsCounts: null,     // {production: N, ready: M, ...}
  contractors: null,         // массив контрагентов
  legalEntities: null,       // массив юрлиц
  managersForPicker: null,   // список менеджеров для выбора
};

// ============ LAYOUT ============

function detectLayout() {
  const w = window.innerWidth;
  const newIsDesktop = w >= 1000;
  if (newIsDesktop !== state.isDesktop) {
    state.isDesktop = newIsDesktop;
    applyLayout();
  }
}

function applyLayout() {
  const app = document.getElementById('app');
  if (state.isDesktop) { app.classList.add('desktop-layout'); app.classList.remove('mobile-layout'); }
  else { app.classList.add('mobile-layout'); app.classList.remove('desktop-layout'); }
}

window.addEventListener('resize', detectLayout);

// ============ HELPERS ============

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// v2.45.380: русские названия ролей (legacy-коды приходят на английском:
// master/accountant/…). Используется в выпадашках, чтобы не показывать англ. слова.
var ROLE_NAMES_RU = {
  director: 'Директор', zam: 'Зам директора', manager: 'Менеджер',
  engineer: 'Инженер', master: 'Мастер', accountant: 'Бухгалтер',
  assembler: 'Сборщик', installer: 'Монтажник',
};
function roleNameRu(r) { return ROLE_NAMES_RU[r] || ''; }
function roleNamesRu(roles) {
  return (roles || []).map(roleNameRu).filter(Boolean).join(', ');
}

// v2.43.54: формирует «№XXX» с защитой от двойного № (если в БД уже есть префикс).
// Также экранирует HTML.
function formatContractNum(num) {
  if (num === null || num === undefined || num === '') return '—';
  let s = String(num).trim().replace(/^[№#\s]+/, '');
  return '№' + escapeHtml(s);
}

function formatDate(iso) {
  try { const [y, m, d] = iso.split('-'); return d + '.' + m; } catch (e) { return iso; }
}

function formatDateLong(iso) {
  try {
    const [y, m, d] = iso.split('-');
    const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
    return d + ' ' + months[parseInt(m) - 1];
  } catch (e) { return iso; }
}

function isToday(iso) { return iso === new Date().toISOString().slice(0, 10); }

function plural(n, one, few, many) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}

function getCurrentDateLine() {
  const days = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
  const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const d = new Date();
  const day = days[d.getDay()];
  return day.charAt(0).toUpperCase() + day.slice(1) + ', ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
}

function getDirectionIcon(directionCode) {
  const code = (directionCode || '').toLowerCase();
  if (code.includes('klm') || code.includes('klim') || code === '1') return 'ti-snowflake';
  if (code.includes('def')) return 'ti-temperature';
  if (code.includes('chi')) return 'ti-snow';
  if (code.includes('uvl')) return 'ti-droplet';
  if (code.includes('vnt') || code.includes('vent')) return 'ti-wind';
  if (code.includes('shi') || code.includes('scu') || code === '6') return 'ti-box';
  return 'ti-package';
}

function todayIso() { return new Date().toISOString().slice(0, 10); }
function yesterdayIso() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ============ API ============

async function apiPost(path, body) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const response = await fetch(API_BASE + path, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  return { ok: response.ok, status: response.status, data: await response.json() };
}

// v2.19.1: PATCH-хелпер — возвращает чистый JSON-объект (как apiGet) для удобства
async function apiPatch(path, body) {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) throw new Error('Нет токена');
  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };
  const response = await fetch(API_BASE + path, {
    method: 'PATCH', headers, body: JSON.stringify(body || {}),
  });
  // v2.45.194: только 401 (нет/истёк токен) разлогинивает. 403 (доступ запрещён
  // по роли) — НЕ выкидывает из системы: сессия валидна, просто нет прав на
  // конкретный запрос. Раньше мастер «вылетал» из договоров из-за 403.
  if (response.status === 401) {
    logout();
    throw new Error('Сессия истекла');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = (data && (data.message || data.error)) || ('HTTP ' + response.status);
    throw new Error(msg);
  }
  return data;
}

async function apiGet(path) {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) throw new Error('Нет токена');
  // v2.43.21: cache: 'no-store' обходит браузерный/SW кэш без дополнительных
  // заголовков (которые ломали CORS preflight).
  const response = await fetch(API_BASE + path, {
    headers: { 'Authorization': 'Bearer ' + token },
    cache: 'no-store',
  });
  // v2.45.194: только 401 (нет/истёк токен) разлогинивает. 403 (доступ запрещён
  // по роли) — НЕ выкидывает из системы: сессия валидна, просто нет прав на
  // конкретный запрос. Раньше мастер «вылетал» из договоров из-за 403.
  if (response.status === 401) {
    logout();
    throw new Error('Сессия истекла');
  }
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}

async function apiDelete(path, body) {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) throw new Error('Нет токена');
  const opts = {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + token },
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const response = await fetch(API_BASE + path, opts);
  // v2.45.194: только 401 (нет/истёк токен) разлогинивает. 403 (доступ запрещён
  // по роли) — НЕ выкидывает из системы: сессия валидна, просто нет прав на
  // конкретный запрос. Раньше мастер «вылетал» из договоров из-за 403.
  if (response.status === 401) {
    logout();
    throw new Error('Сессия истекла');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = (data && (data.message || data.error)) || ('HTTP ' + response.status);
    throw new Error(msg);
  }
  return data;
}

// v2.43.52: универсальный (для случаев когда нужно body в DELETE и пр.)
async function apiCall(method, path, body) {
  if (method === 'GET')    return apiGet(path);
  if (method === 'POST')   return apiPost(path, body);
  if (method === 'DELETE') return apiDelete(path, body);
  throw new Error('Неподдерживаемый метод: ' + method);
}

// ===== Универсальные авто-черновики форм (localStorage) =====
// Пока заполняешь форму — данные сохраняются; вышел/нажал «назад» — при
// возврате восстанавливаются. Чистятся при сохранении или кнопкой «Очистить».
const CONTRACT_DRAFT_KEY = 'atomus_contract_draft';
const OFFER_DRAFT_KEY = 'atomus_offer_draft';

function _draftSave(key, dataObj, hasContent) {
  try {
    if (typeof hasContent === 'function' && !hasContent(dataObj)) { localStorage.removeItem(key); return; }
    localStorage.setItem(key, JSON.stringify({ data: dataObj, _ts: Date.now() }));
  } catch (_) {}
}
function _draftLoad(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return (o && o.data) ? o.data : null;
  } catch (_) { return null; }
}
function _draftClear(key) { try { localStorage.removeItem(key); } catch (_) {} }

function _contractDraftHasContent(f) {
  if (!f) return false;
  return !!((f.number && String(f.number).trim()) || f.contractor_id ||
    (f.sum_amount && String(f.sum_amount).trim()) ||
    (f.delivery_address && f.delivery_address.trim()) ||
    (f.comment && f.comment.trim()) || f.manager_id);
}
function _offerDraftHasContent(f) {
  if (!f) return false;
  return !!(f.contractor_id || (Array.isArray(f.items) && f.items.length) ||
    (f.comment_client && f.comment_client.trim()) ||
    (f.comment_internal && f.comment_internal.trim()) ||
    (f.delivery_terms && f.delivery_terms.trim()));
}

// Один глобальный слушатель: по текущему экрану-форме сохраняет нужный черновик.
// Срабатывает после inline-обработчиков (фаза всплытия) — state уже обновлён.
function _formDraftAutosave() {
  try {
    const s = state.currentScreen;
    if (s === 'sales-contract-form' && state.contractFormMode !== 'edit') {
      _draftSave(CONTRACT_DRAFT_KEY, state.contractForm, _contractDraftHasContent);
    } else if (s === 'sales-offer-form' && state.offerFormMode !== 'edit') {
      _draftSave(OFFER_DRAFT_KEY, state.offerForm, _offerDraftHasContent);
    }
  } catch (_) {}
}
try {
  document.addEventListener('input', _formDraftAutosave);
  document.addEventListener('change', _formDraftAutosave);
} catch (_) {}

// ============ ЛОГИН ============

function setStatus(msg, type) {
  const el = document.getElementById('login-status');
  el.textContent = msg || '';
  el.className = 'status' + (type ? ' ' + type : '');
}

async function submitCode() {
  const input = document.getElementById('code-input');
  const code = input.value.trim();
  const btn = document.getElementById('submit-btn');
  if (!code) { setStatus('Введите код', 'error'); return; }
  if (!/^\d{6}$/.test(code)) { setStatus('Код должен быть 6 цифр', 'error'); return; }
  btn.disabled = true;
  setStatus('Проверяем код…');
  try {
    const r = await apiPost('/api/auth/code', { code });
    if (!r.ok) {
      setStatus(r.data.message || r.data.error || 'Ошибка', 'error');
      btn.disabled = false;
      return;
    }
    localStorage.setItem(TOKEN_KEY, r.data.token);
    state.user = r.data.user;
    setStatus('Готово!', 'success');
    // ЭТАП 28: приветствие после входа
    state._loginWelcome = r.data.user;
    setTimeout(showApp, 300);
  } catch (e) {
    setStatus('Ошибка соединения: ' + String(e), 'error');
    btn.disabled = false;
  }
}

// ============ ЭТАП 28: ВХОД ПО ПАРОЛЮ ============

function switchLoginTab(tabName) {
  // Переключатель вкладок Telegram / Пароль
  document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
  const btn = document.querySelector('.login-tab[data-login-tab="' + tabName + '"]');
  if (btn) btn.classList.add('active');
  const tg = document.getElementById('login-body-telegram');
  const pw = document.getElementById('login-body-password');
  if (tg) tg.style.display = (tabName === 'telegram') ? '' : 'none';
  if (pw) pw.style.display = (tabName === 'password') ? '' : 'none';
  setStatus('');
  // Фокус
  setTimeout(() => {
    if (tabName === 'telegram') {
      const c = document.getElementById('code-input'); if (c) c.focus();
    } else {
      const p = document.getElementById('password-input'); if (p) p.focus();
    }
  }, 50);
}

async function submitPassword() {
  const input = document.getElementById('password-input');
  const password = (input && input.value || '').trim();
  const btn = document.getElementById('password-submit-btn');
  if (!password) { setStatus('Введите пароль', 'error'); return; }
  if (password.length < 6) { setStatus('Пароль должен быть не короче 6 символов', 'error'); return; }
  btn.disabled = true;
  setStatus('Проверяем пароль…');
  try {
    const r = await apiPost('/api/auth/password', { password });
    if (!r.ok) {
      setStatus(r.data.message || r.data.error || 'Неверный пароль', 'error');
      btn.disabled = false;
      // Стираем поле чтобы не дать перебирать вслепую
      if (input) { input.value = ''; input.focus(); }
      return;
    }
    localStorage.setItem(TOKEN_KEY, r.data.token);
    state.user = r.data.user;
    setStatus('Готово!', 'success');
    state._loginWelcome = r.data.user;
    setTimeout(showApp, 300);
  } catch (e) {
    setStatus('Ошибка соединения: ' + String(e), 'error');
    btn.disabled = false;
  }
}

// Enter в поле пароля = клик по кнопке
document.addEventListener('DOMContentLoaded', () => {
  const p = document.getElementById('password-input');
  if (p) {
    p.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); submitPassword(); }
    });
  }
});

// ============ КОНЕЦ ЭТАПА 28 ============

// v2.45.120: автообнаружение новой версии — раз в 5 минут fetch sw.js,
// парсим CACHE_VERSION. Если отличается от запомненной при загрузке —
// красим брэнд-шарик красным с пульсацией, в tooltip пишем что доступна
// новая версия. После глубокого обновления версия совпадёт — шарик
// автоматом вернётся к стандартному.
let _swLiveVersion = null;  // запомним при первой проверке = «версия с которой работаем»
async function _fetchLiveSwVersion() {
  try {
    const r = await fetch('/sw.js?_=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return null;
    const t = await r.text();
    const m = t.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}
async function _checkAppUpdate() {
  const live = await _fetchLiveSwVersion();
  if (!live) return;
  if (!_swLiveVersion) {
    _swLiveVersion = live;   // первая проверка — запомнили базовую
    return;
  }
  _setUpdateBadge(live !== _swLiveVersion, live);
}
function _setUpdateBadge(needsUpdate, liveVer) {
  const ball = document.querySelector('.brand-ball');
  const wrap = ball ? ball.closest('.brand-wrap') : null;
  if (!ball || !wrap) return;
  if (needsUpdate) {
    ball.classList.add('update-pending');
    wrap.title = 'Доступна новая версия' + (liveVer ? ' (' + liveVer + ')' : '') +
                 ' — двойной клик для глубокого обновления';
  } else {
    ball.classList.remove('update-pending');
    wrap.title = 'Клик — на главную · Двойной клик — глубокое обновление';
  }
}
// Запуск авто-проверки
setTimeout(_checkAppUpdate, 10 * 1000);            // первая через 10 сек
setInterval(_checkAppUpdate, 5 * 60 * 1000);       // потом каждые 5 мин
window.addEventListener('focus', () => {
  // При возврате во вкладку — проверим сразу (часто после деплоя)
  _checkAppUpdate();
});

// v2.45.119: глубокое обновление — снимает service worker, чистит все кэши,
// перезагружает страницу с явным cache-bust. Используется когда зависает
// старая версия PWA (часто после деплоя backend несовместим с старым фронтом).
// Запускается двойным кликом по логотипу Atom CRM.
async function deepReloadConfirm() {
  if (!confirm('Глубокое обновление приложения?\n\n' +
    'Сейчас закроется service worker, удалятся все кэши и страница перезагрузится. ' +
    'Это устранит «застрявшую» старую версию. Сохранённые черновики останутся.')) return;
  try {
    // 1) Останавливаем уведомления и фоновые задачи
    if (typeof stopNotifPolling === 'function') stopNotifPolling();
    // 2) Снимаем регистрацию service worker
    if ('serviceWorker' in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) {
          try { await r.unregister(); } catch (_) {}
        }
      } catch (_) {}
    }
    // 3) Удаляем все кэши
    if ('caches' in window) {
      try {
        const keys = await caches.keys();
        for (const k of keys) {
          try { await caches.delete(k); } catch (_) {}
        }
      } catch (_) {}
    }
    // 4) Сбрасываем кеш паролей (в памяти)
    if (typeof _clearCachedPassword === 'function') _clearCachedPassword();
    // 5) Hard reload с cache-bust
    const url = new URL(window.location.href);
    url.searchParams.set('_r', String(Date.now()));
    window.location.replace(url.toString());
  } catch (e) {
    // Если что-то пошло не так — просто грубый reload
    try { window.location.reload(true); } catch (_) { window.location.reload(); }
  }
}

// v2.45.177: тест системы тревог о сбоях (директору) — Телеграм + пуш
async function testAlerts() {
  try {
    showToast('Отправляю тестовую тревогу…', 'info');
    const resp = await apiPost('/api/admin/alert/test', {});
    if (resp && resp.status === 403) { showToast('Только для директора', 'error'); return; }
    if (resp && resp.ok && resp.data && resp.data.ok) {
      showToast(resp.data.delivered
        ? '✅ Тревога отправлена — проверь Телеграм и пуш'
        : 'Отправлено, но получателей нет (нужна роль директора; для пуша — включить 📱)',
        resp.data.delivered ? 'success' : 'info');
    } else {
      showToast('Не удалось отправить тревогу', 'error');
    }
  } catch (e) {
    showToast('Ошибка отправки', 'error');
  }
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem('atomus_last_view');  // v2.8.2
  // v2.45.117: при выходе сбрасываем кеш пароля
  if (typeof _clearCachedPassword === 'function') _clearCachedPassword();
  state.user = null;
  document.getElementById('login-page').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  const input = document.getElementById('code-input');
  if (input) { input.value = ''; input.focus(); }
  document.getElementById('submit-btn').disabled = false;
  const pInput = document.getElementById('password-input');
  if (pInput) pInput.value = '';
  const pBtn = document.getElementById('password-submit-btn');
  if (pBtn) pBtn.disabled = false;
  setStatus('');
  // v2.19.0: останавливаем polling уведомлений
  stopNotifPolling();
}

// ============ TOAST ============

function showToast(message, type) {
  const toast = document.getElementById('toast');
  const icon = document.getElementById('toast-icon');
  const text = document.getElementById('toast-text');
  text.textContent = message;
  toast.className = 'toast ' + (type || '');
  if (type === 'success') icon.className = 'ti ti-check';
  else if (type === 'error') icon.className = 'ti ti-alert-circle';
  else icon.className = 'ti ti-info-circle';
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 3000);
}

// ============ ПОКАЗ ПРИЛОЖЕНИЯ ============

// ============ ЭТАП 39 (v2.19.0): IN-APP УВЕДОМЛЕНИЯ ============
//
// Архитектура:
//   - Polling /api/notifications/unread каждые NOTIF_POLL_INTERVAL мс
//   - state.notif.unread — кэш текущих непрочитанных
//   - state.notif.shownIds — какие id уже показывали в модалке (чтобы не дёргать модалку повторно)
//   - Модалка #notif-modal появляется автоматически если есть непрочитанные
//   - Бейдж #notif25-badge обновляется при каждом poll'е

const NOTIF_POLL_INTERVAL = 30000;  // 30 сек
state.notif = state.notif || {
  unread: [],
  shownIds: new Set(),
  pollTimer: null,
  isModalOpen: false,
  firstLoadDone: false,   // v2.45.79: на первом запросе НЕ играть звук
};

// v2.45.79: звуковое уведомление через Web Audio API.
// Хранение настройки: localStorage 'atomus:notif-sound' = '1' | '0' (default '1')
const NOTIF_SOUND_KEY = 'atomus:notif-sound';
function notifSoundEnabled() {
  const v = localStorage.getItem(NOTIF_SOUND_KEY);
  return v !== '0';   // default включён
}
function _playNotifSound() {
  if (!notifSoundEnabled()) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    // Двойной нежный «бим-бом» — частоты 880 и 660 Гц по 150 мс
    function beep(freq, startAt, durMs) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // Плавный envelope — без щелчка
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(0.18, startAt + 0.02);
      gain.gain.linearRampToValueAtTime(0, startAt + durMs / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + durMs / 1000 + 0.05);
    }
    const t0 = ctx.currentTime;
    beep(880, t0,       170);
    beep(660, t0 + 0.18, 200);
    // Освободим контекст через 0.5 сек
    setTimeout(() => { try { ctx.close(); } catch (_) {} }, 600);
  } catch (_) { /* тихо игнорим — браузер может блочить autoplay до клика */ }
}
function toggleNotifSound() {
  const cur = notifSoundEnabled();
  localStorage.setItem(NOTIF_SOUND_KEY, cur ? '0' : '1');
  _updateNotifSoundIcon();
  showToast(cur ? 'Звук уведомлений выключен' : 'Звук уведомлений включён', 'info');
  if (!cur) _playNotifSound();   // короткая демонстрация при включении
}
function _updateNotifSoundIcon() {
  const ic = document.getElementById('notif-sound-icon');
  if (!ic) return;
  if (notifSoundEnabled()) {
    ic.className = 'ti ti-volume';
    ic.parentElement.title = 'Звук уведомлений ВКЛ';
  } else {
    ic.className = 'ti ti-volume-off';
    ic.parentElement.title = 'Звук уведомлений ВЫКЛ';
  }
}

async function loadUnreadNotifications(options) {
  options = options || {};
  const silent = !!options.silent;
  try {
    const r = await apiGet('/api/notifications/unread?limit=50');
    const items = (r && r.items) || [];
    state.notif.unread = items;
    updateNotifBadge(items.length);
    // Автопоказ модалки: если есть новые id (которых раньше не показывали) — показать
    if (items.length > 0) {
      const newOnes = items.filter(x => !state.notif.shownIds.has(x.id));
      // v2.45.79: звук только при реально новых уведомлениях, и не на самом первом
      // запросе после логина (там shownIds пустой — иначе бимкнет на всю пачку старых).
      if (newOnes.length > 0 && state.notif.firstLoadDone) {
        _playNotifSound();
      }
      if (newOnes.length > 0 && !state.notif.isModalOpen && !silent) {
        // Показывать только если юзер на главной (не отвлекать в форме создания)
        const screen = state.currentScreen || '';
        if (screen === 'home-dashboard' || screen === '') {
          openNotifModal();
        }
      }
      // Помечаем что эти id уже видели (даже если модалка не показалась, бейдж обновлён)
      items.forEach(x => state.notif.shownIds.add(x.id));
    }
    state.notif.firstLoadDone = true;
    // Если открыта модалка — обновляем содержимое
    if (state.notif.isModalOpen) {
      renderNotifModal();
    }
    return items;
  } catch (e) {
    // Игнорируем ошибки сети — следующий poll попробует ещё раз
    return [];
  }
}

function startNotifPolling() {
  stopNotifPolling();
  // Первый запрос — без silent, чтобы показать модалку если есть свежие
  loadUnreadNotifications({ silent: false });
  state.notif.pollTimer = setInterval(() => {
    loadUnreadNotifications({ silent: false });
  }, NOTIF_POLL_INTERVAL);
}

function stopNotifPolling() {
  if (state.notif && state.notif.pollTimer) {
    clearInterval(state.notif.pollTimer);
    state.notif.pollTimer = null;
  }
  if (state.notif) {
    state.notif.unread = [];
    state.notif.shownIds = new Set();
  }
  updateNotifBadge(0);
  closeNotifModal();
}

function updateNotifBadge(n) {
  const badge = document.getElementById('notif25-badge');
  if (!badge) return;
  if (n > 0) {
    badge.textContent = String(n);
    badge.style.display = '';
    badge.classList.add('pulse');
    setTimeout(() => badge.classList.remove('pulse'), 2500);
  } else {
    badge.style.display = 'none';
    badge.textContent = '0';
  }
}

function openNotifModal() {
  const m = document.getElementById('notif-modal');
  if (!m) return;
  state.notif.isModalOpen = true;
  renderNotifModal();
  m.classList.add('visible');
}

function closeNotifModal(ev) {
  // Если event есть — это клик по оверлею. Закрываем ТОЛЬКО если все подтверждены.
  // Иначе модалка остаётся (по требованию из RESUME — висит пока не подтверждено каждое).
  if (ev && ev.target && ev.target.id !== 'notif-modal') return;
  const items = (state.notif && state.notif.unread) || [];
  if (ev && items.length > 0) {
    // Висит — даём фидбек
    showToast('Подтвердите уведомления чтобы закрыть', 'info');
    return;
  }
  const m = document.getElementById('notif-modal');
  if (!m) return;
  m.classList.remove('visible');
  if (state.notif) state.notif.isModalOpen = false;
}

function renderNotifModal() {
  const body = document.getElementById('notif-modal-body');
  const cnt = document.getElementById('notif-modal-count');
  const ackAll = document.getElementById('notif-ack-all-btn');
  const ackHead = document.getElementById('notif-head-ack');
  if (!body) return;
  const items = (state.notif && state.notif.unread) || [];
  if (cnt) cnt.textContent = String(items.length);
  if (ackAll)  ackAll.disabled  = (items.length === 0);
  if (ackHead) ackHead.disabled = (items.length === 0);

  if (items.length === 0) {
    body.innerHTML = '<div class="notif-modal-empty"><i class="ti ti-check" style="font-size:32px;color:var(--success);display:block;margin-bottom:8px;"></i>Все уведомления прочитаны</div>';
    return;
  }
  let html = '';
  items.forEach(n => {
    const iconCls = n.type === 'contract_published' ? 't-contract'
                   : n.type === 'assembly_created' ? 't-assembly'
                   : n.type === 'supply_invoice_received' ? 't-contract'
                   : n.type === 'supply_invoice_uploaded' ? 't-contract'
                   : n.type === 'supply_order_paid' ? 't-assembly'
                   : n.type === 'edo_upd_received' ? 't-contract'
                   : (n.type === 'dev_guest_message' || n.type === 'dev_guest_file') ? 't-development'
                   : '';
    const icon = n.type === 'contract_published' ? 'ti-file-text'
                : n.type === 'assembly_created' ? 'ti-tool'
                : n.type === 'supply_invoice_received' ? 'ti-receipt'
                : n.type === 'supply_invoice_uploaded' ? 'ti-receipt'
                : n.type === 'supply_order_paid' ? 'ti-cash'
                : n.type === 'edo_upd_received' ? 'ti-cloud-download'
                : n.type === 'dev_guest_message' ? 'ti-message-circle'
                : n.type === 'dev_guest_file' ? 'ti-paperclip'
                : 'ti-bell';
    const linkAttr = (n.entity_type && n.entity_id)
      ? 'onclick="onNotifClick(' + n.id + ', \'' + escapeHtml(n.entity_type) + '\', ' + Number(n.entity_id) + ', \'' + escapeHtml(n.type || '') + '\')" style="cursor:pointer;"'
      : '';
    html += '<div class="notif-card" ' + linkAttr + '>';
    html += '<div class="notif-card-icon ' + iconCls + '"><i class="ti ' + icon + '"></i></div>';
    html += '<div class="notif-card-body">';
    html += '<div class="notif-card-title">' + escapeHtml(n.title || '') + '</div>';
    html += '<div class="notif-card-msg">' + escapeHtml(n.message || '') + '</div>';
    if (n.created_at) {
      html += '<div class="notif-card-time">' + escapeHtml(formatNotifTime(n.created_at)) + '</div>';
    }
    html += '</div>';
    html += '<div class="notif-card-actions">';
    html += '<button class="notif-ack-btn" onclick="event.stopPropagation(); ackNotification(' + n.id + ')">ОК</button>';
    html += '</div>';
    html += '</div>';
  });
  body.innerHTML = html;
}

function formatNotifTime(iso) {
  if (!iso) return '';
  try {
    // SQLite даёт 'YYYY-MM-DD HH:MM:SS' (UTC)
    let d;
    if (iso.includes('T') || iso.endsWith('Z')) {
      d = new Date(iso);
    } else {
      d = new Date(iso.replace(' ', 'T') + 'Z');
    }
    if (isNaN(d.getTime())) return iso;
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'только что';
    if (diffMin < 60) return diffMin + ' мин назад';
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return diffH + ' ч назад';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return dd + '.' + mm + ' ' + hh + ':' + mi;
  } catch (e) {
    return iso;
  }
}

async function ackNotification(notifId) {
  try {
    await apiPost('/api/notifications/' + notifId + '/ack', {});
  } catch (e) {
    showToast('Не удалось подтвердить уведомление', 'error');
    return;
  }
  // Убираем из state
  if (state.notif && state.notif.unread) {
    state.notif.unread = state.notif.unread.filter(x => x.id !== notifId);
  }
  updateNotifBadge((state.notif.unread || []).length);
  renderNotifModal();
  // Если последнее — закрываем модалку
  if ((state.notif.unread || []).length === 0) {
    setTimeout(closeNotifModalForced, 400);
  }
}

async function ackAllNotifications() {
  try {
    const r = await apiPost('/api/notifications/ack-all', {});
    if (state.notif) state.notif.unread = [];
    updateNotifBadge(0);
    renderNotifModal();
    setTimeout(closeNotifModalForced, 300);
    const cnt = (r && r.data && r.data.count) || 0;
    if (cnt > 0) showToast('Подтверждено: ' + cnt, 'success');
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  }
}

function closeNotifModalForced() {
  const m = document.getElementById('notif-modal');
  if (!m) return;
  m.classList.remove('visible');
  if (state.notif) state.notif.isModalOpen = false;
}

function onNotifClick(notifId, entityType, entityId, notifType) {
  // Сначала ackнем (мягко), потом перейдём на сущность
  ackNotification(notifId);
  if (entityType === 'contract' && entityId) {
    closeNotifModalForced();
    openContractDetail(entityId);
  } else if (entityType === 'assembly' && entityId) {
    closeNotifModalForced();
    selectSidebarItem('history');
  } else if (entityType === 'supply_invoice') {
    // v2.45.140: Фото УПД → Приёмка УПД
    closeNotifModalForced();
    selectSidebarItem('supply-invoice-intake');
  } else if (entityType === 'supply_order') {
    // v2.45.140: счёт привязан к заказу → Заказы
    closeNotifModalForced();
    selectSidebarItem('supply-orders');
  } else if (entityType === 'edo_upd') {
    // v2.45.269: УПД из 1С-ЭДО → раздел приёма + карточка
    closeNotifModalForced();
    selectSidebarItem('supply-edo-upd');
    if (entityId && typeof openEdoUpdDetail === 'function') setTimeout(() => openEdoUpdDetail(entityId), 300);
  } else if (entityType === 'inbox') {
    // v2.45.140: непривязанный счёт → Входящие счета
    closeNotifModalForced();
    selectSidebarItem('supply-inbox');
  } else if (entityType === 'development' && entityId) {
    // v2.44.58/59: уведомления по разработкам — открываем нужную карточку,
    // затем скроллим к чату (для сообщений) или к файлам (для загрузок)
    closeNotifModalForced();
    selectSection && selectSection('production');
    setTimeout(() => {
      selectSidebarItem('developments');
      setTimeout(() => {
        if (typeof openDevelopment === 'function') openDevelopment(entityId);
        // Скролл и подсветка нужной секции
        setTimeout(() => _devScrollToTarget(notifType), 700);
      }, 250);
    }, 80);
  }
}

// v2.45.148: Web Push — подписка на пуш-уведомления на телефон
function _urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function enablePushNotifications() {
  // v2.45.149: пошаговая диагностика — alert на каждом провале, чтобы было видно где стопор
  let step = 'старт';
  try {
    if (!('serviceWorker' in navigator)) { alert('Пуш недоступен: нет Service Worker в этом браузере'); return; }
    if (!('PushManager' in window))      { alert('Пуш недоступен: браузер/телефон не поддерживает Web Push (часто на телефонах без Google-сервисов, напр. Huawei). Попробуй Chrome.'); return; }
    if (!('Notification' in window))     { alert('Пуш недоступен: нет Notification API'); return; }

    step = 'разрешение';
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      alert('Уведомления не разрешены (статус: ' + perm + '). Разреши их для сайта в настройках браузера.');
      return;
    }

    step = 'VAPID-ключ';
    const token = localStorage.getItem(TOKEN_KEY);
    const kr = await fetch(API_BASE + '/api/push/vapid-key', { headers: { 'Authorization': 'Bearer ' + token } });
    const kd = await kr.json().catch(() => ({}));
    if (!kd.available || !kd.key) { alert('Сервер: пуш недоступен (available=' + kd.available + ')'); return; }

    step = 'Service Worker ready';
    // не даём зависнуть навсегда — таймаут 8 сек
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, rej) => setTimeout(() => rej(new Error('Service Worker не активировался (таймаут). Обнови страницу и попробуй снова.')), 8000)),
    ]);

    step = 'подписка (subscribe)';
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlB64ToUint8Array(kd.key),
      });
    }

    step = 'сохранение подписки';
    const sr = await fetch(API_BASE + '/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(sub.toJSON()),
    });
    if (!sr.ok) { alert('Не удалось сохранить подписку на сервере (HTTP ' + sr.status + ')'); return; }

    showToast('📱 Пуш включён — сейчас придёт тестовое уведомление', 'success');
    const icon = document.getElementById('notif-push-icon');
    if (icon) icon.style.color = 'var(--success)';
    step = 'тестовый пуш';
    try {
      const tr = await fetch(API_BASE + '/api/push/test', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + token },
      });
      const td = await tr.json().catch(() => ({}));
      if (td && td.sent === 0) {
        const det = (td.results || []).map(r => 'хост=' + (r.host || '?') + ' код=' + r.code + (r.detail ? ' (' + r.detail + ')' : '')).join('\n') || '(нет подписок на сервере)';
        alert('Подписка сохранена, но пуш не доставлен (sent=0).\nДетали отправки:\n' + det + '\n\nПокажи это сообщение.');
      }
    } catch (_) {}
  } catch (e) {
    alert('Пуш не включился на шаге «' + step + '»:\n' + (e && (e.message || e.name)) + '\n\n' + (e && e.stack ? String(e.stack).slice(0, 300) : ''));
  }
}

function _markPushEnabledUI() {
  const icon = document.getElementById('notif-push-icon');
  if (icon) icon.style.color = 'var(--success)';
}

// Достаёт applicationServerKey текущей подписки в base64url (для сверки с VAPID).
function _subAppServerKeyB64(sub) {
  try {
    const k = (sub.options || {}).applicationServerKey;
    if (!k) return '';
    const bytes = new Uint8Array(k);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch (_) { return ''; }
}

// v2.45.159: тихая пере-синхронизация пуш-подписки на старте/после обновления.
// Раньше после refresh/обновления SW подписка «слетала» (иконка гасла, пуш не
// приходил), т.к. подписку никто не пере-сохранял на сервере. Теперь если
// разрешение уже выдано — переподписываемся (пересоздаём при смене VAPID-ключа)
// и сохраняем подписку заново. Ничего не спрашиваем у пользователя.
async function syncPushSubscription() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;  // не выдано — не трогаем
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    const kr = await fetch(API_BASE + '/api/push/vapid-key', { headers: { 'Authorization': 'Bearer ' + token } });
    const kd = await kr.json().catch(() => ({}));
    if (!kd.available || !kd.key) return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    // Подписка под другим VAPID-ключом «протухла» (пуш не дойдёт) — пересоздаём
    if (sub) {
      const curKey = _subAppServerKeyB64(sub);
      if (curKey && curKey !== kd.key) {
        try { await sub.unsubscribe(); } catch (_) {}
        sub = null;
      }
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlB64ToUint8Array(kd.key),
      });
    }
    await fetch(API_BASE + '/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(sub.toJSON()),
    });
    _markPushEnabledUI();
    state._pushSynced = true;
  } catch (e) { /* тихо — не мешаем работе приложения */ }
}

// v2.45.158: тестовый пуш по кнопке — отправляет уведомление на телефоны,
// где включён пуш (📱). Если подписок нет — подсказывает нажать 📱.
async function sendTestPush() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) { showToast('Нет сессии', 'error'); return; }
  const btn = document.getElementById('notif-push-test');
  if (btn) btn.disabled = true;
  try {
    showToast('Отправляю тестовый пуш…', 'info');
    const tr = await fetch(API_BASE + '/api/push/test', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token },
    });
    const td = await tr.json().catch(() => ({}));
    if (td && td.sent > 0) {
      showToast('✅ Тест отправлен на ' + td.sent + ' устр. — посмотри телефон', 'success');
    } else {
      // sent=0 — нет подписок или не доставилось
      const hasResults = td && td.results && td.results.length;
      if (!hasResults) {
        if (confirm('На этом устройстве/аккаунте пуш ещё не включён.\nВключить сейчас (нажать 📱)?')) {
          enablePushNotifications();
        }
      } else {
        const det = (td.results || []).map(r => 'хост=' + (r.host || '?') + ' код=' + r.code + (r.detail ? ' (' + r.detail + ')' : '')).join('\n');
        alert('Пуш не доставлен (sent=0).\nДетали:\n' + det);
      }
    }
  } catch (e) {
    showToast('Ошибка отправки теста', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function _devScrollToTarget(notifType) {
  // v2.44.61: и для сообщения, и для файла — проваливаем в чат
  // (там единый «диалог» по разработке; файл можно посмотреть, проскроллив выше).
  const chatBox  = document.getElementById('dev-chat-messages');
  const chatWrap = chatBox && chatBox.closest('.dev-section');
  const target = chatWrap || chatBox;
  if (target) {
    try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    catch (_) { target.scrollIntoView(); }
    target.style.transition = 'box-shadow 0.5s';
    target.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.40)';
    setTimeout(() => { target.style.boxShadow = ''; }, 1800);
  }
  // Для файлового уведомления ещё мягко подсветим строку файлов сверху,
  // чтобы пользователь видел контекст.
  if (notifType === 'dev_guest_file') {
    const filesList = document.getElementById('dev-files-list');
    const filesWrap = filesList && filesList.closest('.dev-section');
    if (filesWrap) {
      filesWrap.style.transition = 'box-shadow 0.5s';
      filesWrap.style.boxShadow = '0 0 0 2px rgba(124,58,237,0.30)';
      setTimeout(() => { filesWrap.style.boxShadow = ''; }, 1800);
    }
  }
  // Фокус в инпут чата — чтобы можно было сразу ответить
  const input = document.getElementById('dev-chat-input');
  if (input) setTimeout(() => input.focus(), 400);
}

// Кнопка-колокольчик: ручное открытие
function manuallyOpenNotifModal() {
  // Если есть непрочитанные — открываем; иначе показываем «пусто»
  openNotifModal();
}

// ============ КОНЕЦ ЭТАПА 39 (v2.19.0) — УВЕДОМЛЕНИЯ ============


function showApp() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  applyLayout();
  if (!state.user) {
    apiGet('/api/me').then(me => {
      state.user = me;
      renderProfile();
      applyPermissionsToUI();
      _restoreLastView();
      _showWelcomeIfFresh();
      startNotifPolling();  // v2.19.0
      setTimeout(function () { if (typeof _maybeMorningProgress === 'function') _maybeMorningProgress(); }, 800);  // v2.45.358
    })
      .catch(() => logout());
  } else {
    renderProfile();
    applyPermissionsToUI();
    _restoreLastView();
    _showWelcomeIfFresh();
    startNotifPolling();  // v2.19.0
    setTimeout(function () { if (typeof _maybeMorningProgress === 'function') _maybeMorningProgress(); }, 800);  // v2.45.358
  }
}

// v2.8.2: восстановление последнего открытого экрана при F5/перезагрузке
function _restoreLastView() {
  // Если есть свежий приветственный тост (т.е. только что вошли) — на главную
  if (state._loginWelcome) {
    selectSection('home');
    return;
  }
  let last = null;
  try {
    const raw = localStorage.getItem('atomus_last_view');
    if (raw) last = JSON.parse(raw);
  } catch (e) {}
  // Срок жизни — сутки. Дальше — на главную, иначе странно если открыл через 2 недели
  const MAX_AGE = 24 * 3600 * 1000;
  if (!last || !last.section || !last.screen || (Date.now() - (last.ts || 0)) > MAX_AGE) {
    selectSection('home');
    return;
  }
  // Проверяем что раздел вообще существует в SECTION_CONFIG
  if (!SECTION_CONFIG[last.section]) {
    selectSection('home');
    return;
  }
  // Восстанавливаем: сначала раздел (он откроет defaultScreen), потом меняем на сохранённый экран
  selectSection(last.section);
  // v2.43.28: восстанавливаем ID-контекст ДО переключения экрана,
  // чтобы loadXxx() видел правильные state.currentXxxId.
  if (last.ctx && typeof last.ctx === 'object') {
    if (last.ctx.contractId)    state.currentContractId    = last.ctx.contractId;
    if (last.ctx.contractorId)  state.currentContractorId  = last.ctx.contractorId;
    if (last.ctx.taskId)        state.currentTaskId        = last.ctx.taskId;
    if (last.ctx.offerId)       state.currentOfferId       = last.ctx.offerId;
    if (last.ctx.employeeId)    state.currentEmployeeId    = last.ctx.employeeId;
    if (last.ctx.saleProductId) state.currentSaleProductId = last.ctx.saleProductId;
    if (last.ctx.supplyOrderId) state.currentSupplyOrderId = last.ctx.supplyOrderId;
  }
  // v2.43.27 fallback: совместимость с предыдущей версией, где сохранялся
  // только contractId в отдельном ключе
  if (!state.currentContractId) {
    try {
      const savedCid = parseInt(localStorage.getItem('atomus_last_contract_id'), 10);
      if (savedCid > 0) state.currentContractId = savedCid;
    } catch (e) {}
  }
  if (last.screen !== SECTION_CONFIG[last.section].defaultScreen) {
    // Дополнительная проверка — есть ли элемент экрана в DOM
    const screenEl = document.querySelector('.screen[data-screen="' + last.screen + '"]');
    if (screenEl) {
      // Если экран — карточка чего-то, а нужный id не подтянулся, лучше вернуться в список
      if (last.screen === 'sales-contract-detail' && !state.currentContractId) {
        selectSidebarItem('sales-contracts');
        return;
      }
      selectSidebarItem(last.screen);
    }
  }
}

// ЭТАП 28: приветственный тост при свежем входе (любым способом)
function _showWelcomeIfFresh() {
  if (!state._loginWelcome) return;
  const u = state._loginWelcome;
  state._loginWelcome = null;
  const name = u.short_name || u.full_name || u.name || 'друг';
  setTimeout(() => showToast('Добро пожаловать, ' + name + '!', 'success'), 400);
}

function renderProfile() {
  if (!state.user) return;
  // FIX v1.8.1-fix1: fallback на state.user.name для совместимости с ответом /api/auth/code,
  // где бэк возвращает поле "name", а не "full_name"/"short_name" (как в /api/me).
  const name = state.user.full_name || state.user.short_name || state.user.name || '—';
  // 6 ролей в системе (полный набор для будущих этапов).
  // Сейчас бэк поддерживает только 3 первых (director/accountant/master),
  // остальные (zam/manager/engineer) появятся в Этапе 13 с разделом «Продажи».
  // PWA уже готов отобразить любую из них.
  const rolesMap = {
    director:   'Директор',
    zam:        'Зам директора',
    manager:    'Менеджер',
    engineer:   'Инженер',
    master:     'Мастер',
    accountant: 'Бухгалтер',
  };
  // Показываем только ОДНУ роль — самую главную, по приоритету:
  // Директор > Зам > Менеджер > Инженер > Мастер > Бухгалтер
  // (руководящие выше, исполнительные ниже). Логика прав по-прежнему
  // учитывает ВСЕ роли пользователя, а не только показанную.
  const rolePriority = ['director', 'zam', 'manager', 'engineer', 'master', 'accountant'];
  let primaryRole = '';
  for (const r of rolePriority) {
    if ((state.user.roles || []).includes(r)) {
      primaryRole = rolesMap[r];
      break;
    }
  }
  // Если у пользователя только неизвестная роль — берём первую как есть
  if (!primaryRole && state.user.roles && state.user.roles.length) {
    primaryRole = rolesMap[state.user.roles[0]] || state.user.roles[0];
  }
  const roles = primaryRole || 'без роли';
  const initials = getInitials(name);

  // Top bar
  document.getElementById('top-username').textContent = name;
  document.getElementById('top-userrole').textContent = roles || 'без роли';
  document.getElementById('top-avatar').textContent = initials;

  // v2.42.5: запускаем поллинг уведомлений
  if (typeof startNotifPolling === 'function') {
    try { startNotifPolling(); } catch (_) {}
  }

  // Дашборд
  // ПРАВКА: имя+отчество вместо первого слова ФИО
  const _parts = name.trim().split(/\s+/).filter(Boolean);
  let _displayName = '';
  if (_parts.length >= 3) {
    _displayName = _parts[1] + ' ' + _parts[2];
  } else if (_parts.length === 2) {
    _displayName = _parts[1];
  } else if (_parts.length === 1) {
    _displayName = _parts[0];
  }
  const greeting = 'Привет, ' + _displayName;
  document.getElementById('greeting-name').textContent = greeting;
  document.getElementById('greeting-date').textContent = getCurrentDateLine();
  document.getElementById('page-greeting-name').textContent = greeting;
  document.getElementById('page-greeting-date').textContent = getCurrentDateLine();

  // Профиль на экране Аккаунт
  document.getElementById('profile-avatar').textContent = initials;
  document.getElementById('profile-name').textContent = name;
  document.getElementById('profile-roles').textContent = roles || 'без роли';

  // Sidebars — заполняем по КЛАССАМ внутри .sidebar-footer, чтобы покрыть ВСЕ
  // секции (включая главный «-home»). Раньше шёл жёсткий список id без -home,
  // из-за чего на главном сайдбаре висели прочерки «—».
  document.querySelectorAll('.sidebar-footer .small-avatar').forEach(el => { el.textContent = initials; });
  document.querySelectorAll('.sidebar-footer .un').forEach(el => { el.textContent = name; });
  document.querySelectorAll('.sidebar-footer .ur').forEach(el => { el.textContent = roles || 'без роли'; });

  // Версия приложения — по-русски: номер + краткое описание из changelog,
  // без технического суффикса вроде «-notif-head».
  let _verNum = APP_VERSION;
  const _vm = APP_VERSION.match(/^v[\d.]+/);
  if (_vm) _verNum = _vm[0];
  let _verTitle = '';
  try {
    if (typeof HELP_CHANGELOG !== 'undefined' && HELP_CHANGELOG[0] && HELP_CHANGELOG[0].title) {
      _verTitle = HELP_CHANGELOG[0].title;
    }
  } catch (e) {}
  const versionText = _verNum + (_verTitle ? ' · ' + _verTitle : '') + ' · ' + APP_VERSION_DATE;
  const vMobile = document.getElementById('version-info-mobile');
  if (vMobile) vMobile.textContent = versionText;
  document.querySelectorAll('.sidebar-version-text').forEach(el => {
    el.textContent = versionText;
  });

  // Условный показ «Сотрудники» только директору
  const navEmp = document.getElementById('nav-employees');
  if (navEmp) {
    if (state.user.roles && state.user.roles.includes('director')) navEmp.style.display = '';
    else navEmp.style.display = 'none';
  }

  // Условный показ «Новая сборка»
  const navNew = document.getElementById('nav-new-assembly');
  const tabPlus = document.getElementById('tab-plus');
  if (canCreateAssembly()) {
    if (navNew) navNew.style.display = '';
    if (tabPlus) tabPlus.style.display = '';
  } else {
    if (navNew) navNew.style.display = 'none';
    if (tabPlus) tabPlus.style.display = 'none';
  }

  // Условный показ кнопок «Новый договор» / «Новый контрагент» / «Новое КП» (только sales-роли)
  const canSales = canManageSales();
  const navSalesNew = document.getElementById('nav-sales-new');
  const scNewBtn = document.getElementById('sc-new-btn');
  const scMobileNew = document.getElementById('sc-mobile-new');
  const dashNewBtn = document.getElementById('sales-dashboard-new-btn');
  const tabPlusSales = document.getElementById('tab-plus-sales');
  const soNewBtn = document.getElementById('so-new-btn');
  const soMobileNew = document.getElementById('so-mobile-new');
  [navSalesNew, scNewBtn, scMobileNew, dashNewBtn, tabPlusSales, soNewBtn, soMobileNew].forEach(el => {
    if (el) el.style.display = canSales ? '' : 'none';
  });
  // Кнопка «Удалить» в карточке договора и КП — только директор
  const delBtn = document.getElementById('scd-delete-btn');
  if (delBtn) {
    delBtn.style.display = (state.user.roles && state.user.roles.includes('director')) ? '' : 'none';
  }
  const delOfferBtn = document.getElementById('sod-delete-btn');
  if (delOfferBtn) {
    delOfferBtn.style.display = (state.user.roles && state.user.roles.includes('director')) ? '' : 'none';
  }
}

function canCreateAssembly() {
  if (!state.user || !state.user.roles) return false;
  return state.user.roles.includes('master') || state.user.roles.includes('director');
}

function canManageSales() {
  if (!state.user || !state.user.roles) return false;
  return state.user.roles.includes('director')
      || state.user.roles.includes('zam')
      || state.user.roles.includes('manager');
}

// v2.45.194: кто видит суммы договоров/цены. Мастер (производство) — НЕ видит.
// Любая другая роль (директор/зам/менеджер/бухгалтер/инженер) — видит.
// Чистый мастер: суммы скрыты, но в договоры заходить может (без сумм).
function canSeeMoney() {
  if (!state.user || !state.user.roles) return false;
  const r = state.user.roles;
  return r.includes('director') || r.includes('zam') || r.includes('manager')
      || r.includes('accountant') || r.includes('engineer');
}

// ============ ПЕРЕКЛЮЧЕНИЕ РАЗДЕЛОВ ============

function selectSection(sectionName) {
  const config = SECTION_CONFIG[sectionName];
  if (!config) return;

  state.currentSection = sectionName;

  // ЭТАП 25.1: data-section на app — для CSS-селекторов (гамбургер видим/скрыт и т.д.)
  const appEl0 = document.getElementById('app');
  if (appEl0) appEl0.dataset.section = sectionName;

  // Обновляем шапку
  document.querySelectorAll('.section-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.section-tab[data-section="' + sectionName + '"]').forEach(t => t.classList.add('active'));

  // ЭТАП 22.1: автоскролл к активному табу + обновляем стрелки/fade
  scrollActiveTabIntoView();
  scrollActiveMobileTabIntoView();

  // Обновляем мобильные табы разделов
  document.querySelectorAll('.m-section-tabs button').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.m-section-tabs button[data-section="' + sectionName + '"]').forEach(t => t.classList.add('active'));

  // Показываем нужный сайдбар (через data-атрибут, чтобы CSS-правила мобильной раскладки работали)
  document.querySelectorAll('.sidebar').forEach(s => { s.dataset.visible = '0'; });
  const sidebar = document.getElementById(config.sidebar);
  if (sidebar) sidebar.dataset.visible = '1';

  // Переключаем tab-bar (мобильный). У Продаж — свой, у остальных — производственный.
  // ЭТАП 23+: в разделах с FAB (Доработки) скрываем нижний tab-bar полностью.
  document.querySelectorAll('.tab-bar').forEach(tb => { tb.dataset.active = '0'; });
  const appEl = document.getElementById('app');
  if (sectionName === 'sales') {
    const tbSales = document.getElementById('tab-bar-sales');
    if (tbSales) tbSales.dataset.active = '1';
    if (appEl) appEl.classList.remove('no-tabbar');
  } else if (sectionName === 'defects') {
    // Не показываем ни один tab-bar — у Доработок свой FAB
    if (appEl) appEl.classList.add('no-tabbar');
  } else {
    const tbProd = document.getElementById('tab-bar-production');
    if (tbProd) tbProd.dataset.active = '1';
    if (appEl) appEl.classList.remove('no-tabbar');
  }

  // Открываем экран раздела по умолчанию
  selectSidebarItem(config.defaultScreen);
}

function selectSidebarItem(screenName) {
  state.currentScreen = screenName;
  // v2.39.0: если уходим с карточки заявки — глушим polling чата
  if (screenName !== 'defects-detail') {
    try { _stopDefectChatPolling && _stopDefectChatPolling(); } catch (_) {}
  }
  // v2.44.46: глушим polling чата разработок при уходе
  if (screenName !== 'developments') {
    try { _stopDevChatPolling && _stopDevChatPolling(); } catch (_) {}
  }
  // v2.44.56: глушим poll инвентаризации при уходе
  if (screenName !== 'inventory') {
    try { _invStopPolling && _invStopPolling(); } catch (_) {}
  }

  // v2.8.2 / v2.43.28: сохраняем текущий раздел+экран+ID-контекст чтобы при F5
  // оказаться ровно там, где был. Не сохраняем для form-экранов (там полузаполненные данные).
  try {
    const TRANSIENT_SCREENS = [
      'employee-form', 'task-form', 'contract-form', 'sale-offer-form',
      'sale-product-form', 'task-detail', 'contract-detail', 'sale-offer-detail',
      'defect-form', 'defect-detail', 'model-form', 'vacation-form',
      'wh-ship-qr',
    ];
    if (!TRANSIENT_SCREENS.includes(screenName)) {
      // v2.43.28: расширенный snapshot — на каждом экране может быть открыт
      // конкретный элемент (договор, задача, КП, контрагент, сотрудник и т.д.).
      // Сохраняем все эти id, чтобы при F5 _restoreLastView мог восстановить.
      const ctx = {};
      if (state.currentContractId)     ctx.contractId     = state.currentContractId;
      if (state.currentContractorId)   ctx.contractorId   = state.currentContractorId;
      if (state.currentTaskId)         ctx.taskId         = state.currentTaskId;
      if (state.currentOfferId)        ctx.offerId        = state.currentOfferId;
      if (state.currentEmployeeId)     ctx.employeeId     = state.currentEmployeeId;
      if (state.currentSaleProductId)  ctx.saleProductId  = state.currentSaleProductId;
      if (state.currentSupplyOrderId)  ctx.supplyOrderId  = state.currentSupplyOrderId;
      localStorage.setItem('atomus_last_view', JSON.stringify({
        section: state.currentSection || 'home',
        screen: screenName,
        ctx: ctx,
        ts: Date.now(),
      }));
    }
  } catch (e) { /* localStorage может быть отключён — игнор */ }

  // ЭТАП 25.0: синхронизируем подсветку нижнего таб-бара
  if (typeof syncMainTabFromSection === 'function') {
    syncMainTabFromSection(state.currentSection, screenName);
  }

  // ЭТАП 22: алиасы для экранов с фильтрами (все varианты defects-list-* идут на один экран)
  const SCREEN_ALIASES = {
    'defects-list-new':      'defects-list',
    'defects-list-progress': 'defects-list',
    'defects-list-resolved': 'defects-list',
    'defects-list-rejected': 'defects-list',
    // v2.45.346: фильтры монтажа → один экран
    'installation-list-active':  'installation-list',
    'installation-list-planned': 'installation-list',
    'installation-list-done':    'installation-list',
    // ЭТАП 28.1: старые экраны склада → новый единый дашборд с табами
    'warehouse-stock':       'warehouse-dashboard',
    'warehouse-components':  'warehouse-dashboard',
    'warehouse-movements':   'warehouse-dashboard',
  };
  const targetScreen = SCREEN_ALIASES[screenName] || screenName;

  // ЭТАП 28.1: если запросили склад с конкретным табом — запомним
  if (screenName === 'warehouse-stock')      state._requestedWarehouseTab = 'stock';
  if (screenName === 'warehouse-components') state._requestedWarehouseTab = 'components';
  if (screenName === 'warehouse-movements')  state._requestedWarehouseTab = 'movements';

  // Скрываем все экраны
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.querySelector('.screen[data-screen="' + targetScreen + '"]');
  if (screen) screen.classList.add('active');

  // Подсветка sidebar (только нужного раздела)
  document.querySelectorAll('.sidebar .nav-item[data-nav]').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sidebar .nav-item[data-nav="' + screenName + '"]').forEach(t => t.classList.add('active'));

  // Подсветка tab-bar
  document.querySelectorAll('.tab[data-tab]').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab[data-tab="' + screenName + '"]').forEach(t => t.classList.add('active'));

  window.scrollTo({ top: 0, behavior: 'instant' });

  // Загрузка данных под экран
  // v2.45.325: AtomCAD «Атом Электрика» — ленивая загрузка iframe при первом открытии
  if (screenName === 'atom-electrica') {
    const _acf = document.getElementById('atomcad-frame');
    if (_acf && !_acf.getAttribute('src') && _acf.dataset.src) _acf.setAttribute('src', _acf.dataset.src);
  }
  if (screenName === 'home-dashboard') loadHomeDashboard();  // ЭТАП 16Б
  if (screenName === 'dashboard') loadDashboard();
  // ЭТАП 16В: задачи
  if (screenName === 'tasks-list') loadTasksList();
  if (screenName === 'tasks-mine') loadTasksMine();
  if (screenName === 'tasks-created') loadTasksCreated();
  if (screenName === 'task-detail') loadTaskDetail();
  if (screenName === 'task-form') initTaskForm();
  if (screenName === 'history') loadHistory();
  if (screenName === 'summary') loadSummary();
  if (screenName === 'employees') loadEmployees();
  if (screenName === 'employee-form') initEmployeeForm();
  if (screenName === 'positions') loadPositions();   // v2.8.2
  if (screenName === 'access-levels') loadAccessLevels();   // ЭТАП 29
  if (screenName === 'models') loadModels();
  if (screenName === 'new-assembly') initNewAssemblyForm();
  // Продажи
  if (screenName === 'sales-dashboard') loadSalesDashboard();
  if (screenName === 'sales-contracts') loadContracts();
  if (screenName === 'sales-contract-detail') loadCurrentContract();
  if (screenName === 'sales-contract-form') initContractForm();
  if (screenName === 'sales-contractors') loadContractors();
  if (screenName === 'sales-contractor-form') initContractorForm();
  if (screenName === 'sale-products') loadSaleProducts();
  if (screenName === 'sale-categories') loadSaleCategories();   // ЭТАП 17
  if (screenName === 'sale-product-form') initSaleProductForm();
  if (screenName === 'catalog') loadCatalog();                   // ЭТАП 47 (v2.44.0)
  if (screenName === 'developments') loadDevelopments();         // ЭТАП 48 (v2.44.46)
  if (screenName === 'inventory') loadInventory();               // ЭТАП 49 (v2.44.56)
  // КП (14Б)
  if (screenName === 'sales-offers') loadOffers();
  // v2.45.223: опросные листы
  if (screenName === 'sales-surveys') loadSurveys();
  // Ежедневные отчёты менеджеров (KPI)
  if (screenName === 'sales-reports') loadSalesReports();
  if (screenName === 'sales-offer-detail') loadCurrentOffer();
  // ЭТАП 18 → 28.1: склад — единый дашборд с табами
  if (screenName === 'warehouse-stock')      switchWarehouseTab('stock');
  if (screenName === 'warehouse-components') switchWarehouseTab('components');
  if (screenName === 'warehouse-movements')  switchWarehouseTab('movements');
  if (screenName === 'warehouse-dashboard') {
    const tab = state._requestedWarehouseTab
             || localStorage.getItem('wh_active_tab')
             || 'stock';
    state._requestedWarehouseTab = null;
    switchWarehouseTab(tab);
  }
  if (screenName === 'components-catalog')   loadComponentsCatalog();
  // ЭТАП 19: снабжение
  if (screenName === 'supply-shopping')     loadSupplyShopping();
  if (screenName === 'supply-requests')     loadSupplyRequests();
  if (screenName === 'supply-orders')       loadSupplyOrders();
  if (screenName === 'supply-order-detail') loadSupplyOrderDetail();
  if (screenName === 'supply-receipts')     loadSupplyReceipts();
  // ЭТАП 52.3 (v2.45.0): входящие счета от поставщиков (IMAP-робот)
  if (screenName === 'supply-inbox')        loadSupplyInbox();
  // v2.25.0 (Этап 26): авто-приёмка УПД через ИИ
  if (screenName === 'supply-invoice-intake') loadSupplyInvoicesList();
  // v2.45.265: УПД из 1С-ЭДО
  if (screenName === 'supply-edo-upd')      loadEdoUpd();
  if (screenName === 'supply-suppliers')    loadSuppliers();
  if (screenName === 'supply-catalog')      loadSupplyCatalog();
  // Помощь
  if (screenName === 'help-knowledge')      loadHelpKnowledge();
  if (screenName === 'help-faq')            loadHelpFaq();
  if (screenName === 'help-changelog')      loadHelpChangelog();
  // ЭТАП 20: большой календарь
  if (screenName === 'home-calendar')       loadBigCalendar();
  // ЭТАП 20: Кадры
  if (screenName === 'hr-vacations-timeline') loadHrTimeline();
  if (screenName === 'hr-vacations-list')     loadHrList();
  if (screenName === 'hr-vacations-calendar') loadHrCalendar();
  if (screenName === 'sales-offer-form') initOfferForm();
  // ЭТАП 22: Доработки
  if (screenName === 'defects-list')          { state.defectsFilter = 'all';         loadDefectsList(); }
  if (screenName === 'defects-list-new')      { state.defectsFilter = 'new';         loadDefectsList(); }
  if (screenName === 'defects-list-progress') { state.defectsFilter = 'in_progress'; loadDefectsList(); }
  if (screenName === 'defects-list-resolved') { state.defectsFilter = 'resolved';    loadDefectsList(); }
  if (screenName === 'defects-list-rejected') { state.defectsFilter = 'rejected';    loadDefectsList(); }
  // v2.45.346: Монтаж
  if (screenName === 'installation-list')         { state.installFilter = 'all';     loadInstallationList(); }
  if (screenName === 'installation-list-active')  { state.installFilter = 'active';  loadInstallationList(); }
  if (screenName === 'installation-list-planned') { state.installFilter = 'planned'; loadInstallationList(); }
  if (screenName === 'installation-list-done')    { state.installFilter = 'done';    loadInstallationList(); }
  // «Ещё»
  if (screenName === 'production-more') renderProductionMore();
  if (screenName === 'sales-more') renderSalesMore();
}

function goHome() {
  selectSection('home');   // ЭТАП 16Б: главная — новый раздел
}

function refreshCurrentScreen() {
  const s = state.currentScreen;
  if (s === 'home-dashboard') { cache.homeKpi = null; cache.cbrRates = null; cache.myTasks = null; cache.upcomingShipments = null; cache.recentActivity = null; }   // ЭТАП 16Б+В+Г
  if (s === 'dashboard') cache.dashboard = null;
  if (s === 'history') cache.history = {};
  if (s === 'summary') cache.summary = {};
  if (s === 'employees') cache.employees = null;
  if (s === 'models') cache.models = null;
  // ЭТАП 16В: задачи
  if (s === 'tasks-list' || s === 'tasks-mine' || s === 'tasks-created') cache.tasks = {};
  if (s === 'task-detail') { /* загрузим заново */ }
  // Продажи
  if (s === 'sales-dashboard') { cache.contracts = null; cache.contractsCounts = null; }
  if (s === 'sales-contracts') { cache.contracts = null; cache.contractsCounts = null; }
  if (s === 'sales-contractors') cache.contractors = null;
  if (s === 'sale-products') { cache.saleProducts = null; cache.saleCategories = null; }   // ЭТАП 17
  if (s === 'sale-categories') cache.saleCategories = null;   // ЭТАП 17
  if (s === 'catalog') { cache.catalogCategories = null; cache.catalogProducts = null; }    // ЭТАП 47
  if (s === 'sales-offers') { cache.offers = null; cache.offersCounts = null; }
  selectSidebarItem(s);
}

// ============ ДАШБОРД ============

// ЭТАП 29.2 (v2.22.0): главная Производства переехала на канбан.
// Старая реализация сохранена под именем loadLegacyProductionDashboard
// на случай быстрого отката.
async function loadLegacyProductionDashboard() {
  const container = document.getElementById('dashboard-content');
  if (cache.dashboard) { renderDashboard(cache.dashboard); loadProductionQueue(); return; }
  container.innerHTML = '<div class="loading-block">Загружаем данные…</div>';
  try {
    const d = await apiGet('/api/dashboard');
    cache.dashboard = d;
    renderDashboard(d);
    // v2.19.0: подгружаем виджет «На сборку» параллельно
    loadProductionQueue();
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Не удалось загрузить: ' + escapeHtml(String(e)) + '</div>';
  }
}

// Новая точка входа — канбан производства
async function loadDashboard() {
  return loadProductionDashboard();
}

function renderDashboard(d) {
  const container = document.getElementById('dashboard-content');
  let html = '';

  // v2.45.271: блок «На оплате» для бухгалтера/директора — заполняется отдельно
  html += '<div id="pay-due-block"></div>';

  // v2.42.2: блок «Сейчас в работе» — заполняется отдельным запросом
  html += '<div id="active-works-block" class="active-works-section"></div>';

  // ============ ЭТАП 25.1: МОБИЛЬНЫЕ БЛОКИ ============
  html += '<div class="m25-mobile-only">';

  // 1. KPI Производства — горизонтальный скролл
  html += '<div class="qa25-section-label">Сегодня в производстве</div>';
  html += '<div class="kpi-strip">';
  html += '<div class="kpi-pill c-prod"><div class="kpi-value">' + (d.today.qty || 0) + '</div><div class="kpi-label">собрано</div></div>';
  html += '<div class="kpi-pill c-prod"><div class="kpi-value">' + (d.today.records || 0) + '</div><div class="kpi-label">записей</div></div>';
  html += '<div class="kpi-pill"><div class="kpi-value">' + (d.week.qty || 0) + '</div><div class="kpi-label">за неделю</div></div>';
  html += '<div class="kpi-pill"><div class="kpi-value">' + (d.month.qty || 0) + '</div><div class="kpi-label">за месяц</div></div>';
  html += '<div class="kpi-pill"><div class="kpi-value">' + (d.month.employees || 0) + '</div><div class="kpi-label">сборщиков</div></div>';
  html += '</div>';

  // v2.19.0: виджет «На сборку» (мобильный) — между KPI и Последними записями
  html += '<div class="qa25-section-label" id="prod-queue-label-m" style="display:none;">На сборку</div>';
  html += '<div class="prod-queue-block" id="production-queue-block-mobile"></div>';

  // 2. Журнал работ за сегодня (последние записи, до 6)
  if (d.recent && d.recent.length) {
    html += '<div class="qa25-section-label">Последние записи <a onclick="selectSidebarItem(\'history\')">все →</a></div>';
    d.recent.slice(0, 6).forEach(r => {
      const workers = (r.workers && r.workers.length) ? r.workers.join(', ') : '—';
      const model = (r.model_name || '—') + (r.model_extra ? ' · ' + r.model_extra : '');
      const qty = r.qty || 1;
      const dateStr = (typeof isToday === 'function' && isToday(r.date)) ? 'сегодня' : (r.date || '');
      html += '<div class="prod25-active-row">' +
        '<div class="av">' + escapeHtml(getInitials(workers)) + '</div>' +
        '<div class="body">' +
          '<div class="title">' + escapeHtml(model) + '</div>' +
          '<div class="sub">' + escapeHtml(workers) + ' · ' + escapeHtml(dateStr) + '</div>' +
        '</div>' +
        '<div class="qty-pill">' + qty + ' шт.</div>' +
      '</div>';
    });
  } else {
    html += '<div class="qa25-section-label">Последние записи</div>';
    html += '<div style="margin: 0 14px; padding: 24px; background: white; border: 1px solid var(--border); border-radius: 16px; text-align: center; color: var(--text-light); font-size: 13px;">' +
      'Сегодня записей пока нет</div>';
  }

  // 3. Плитки-ссылки на подразделы
  html += '<div class="qa25-section-label">Разделы</div>';
  html += '<div class="prod25-links">';
  html += '<button class="prod25-link-tile" onclick="selectSidebarItem(\'history\')">' +
    '<div class="ico"><i class="ti ti-list-details"></i></div>' +
    '<div class="ttl">Сборки</div>' +
    '<div class="sub">Журнал работ</div>' +
  '</button>';
  html += '<button class="prod25-link-tile" onclick="selectSidebarItem(\'summary\')">' +
    '<div class="ico"><i class="ti ti-chart-bar"></i></div>' +
    '<div class="ttl">Сводки</div>' +
    '<div class="sub">Аналитика</div>' +
  '</button>';
  html += '<button class="prod25-link-tile" onclick="selectSidebarItem(\'employees\')">' +
    '<div class="ico"><i class="ti ti-users"></i></div>' +
    '<div class="ttl">Сотрудники</div>' +
    '<div class="sub">Справочник</div>' +
  '</button>';
  html += '<button class="prod25-link-tile" onclick="selectSidebarItem(\'models\')">' +
    '<div class="ico"><i class="ti ti-package"></i></div>' +
    '<div class="ttl">Номенклатура</div>' +
    '<div class="sub">Модели</div>' +
  '</button>';
  html += '</div>';

  html += '</div>';
  // ============ КОНЕЦ ЭТАПА 25.1 ============

  html += '<div class="kpi-grid">';
  html += kpiCard('сегодня', d.today.qty, d.today.records + ' ' + plural(d.today.records, 'запись', 'записи', 'записей'));
  html += kpiCard('за неделю', d.week.qty, trendText(d.week.trend_pct), trendClass(d.week.trend_pct));
  html += kpiCard('за месяц', d.month.qty, trendText(d.month.trend_pct), trendClass(d.month.trend_pct));
  html += kpiCard('сборщиков', d.month.employees, 'за месяц');
  html += '</div>';

  // v2.19.0: виджет «На сборку» (десктоп) — между KPI grid и row-2
  html += '<div class="section" id="prod-queue-section-d" style="display:none;">';
  html += '<h3 class="section-title">На сборку <a id="prod-queue-link-d" style="display:none;cursor:pointer;color:var(--brand);" onclick="selectSidebarItem(\'sales-contracts\')">Все договоры</a></h3>';
  html += '<div class="prod-queue-block" id="production-queue-block-desktop"></div>';
  html += '</div>';

  html += '<div class="row-2">';
  if (d.daily_14d && d.daily_14d.length) {
    const maxQty = Math.max(1, ...d.daily_14d.map(x => x.qty));
    html += '<div class="section"><h3 class="section-title">Динамика 14 дней</h3>';
    html += '<div class="card"><div class="chart-wrap"><div class="chart-bars">';
    d.daily_14d.forEach((day, idx) => {
      const h = (day.qty / maxQty * 100);
      const today = isToday(day.date);
      const showVal = day.qty > 0 && (idx === d.daily_14d.length - 1 || day.qty === maxQty);
      html += '<div class="bar' + (today ? ' today' : '') + '" style="height: ' + h + '%;" title="' + formatDate(day.date) + ': ' + day.qty + '">' +
              (showVal ? '<div class="bar-val">' + day.qty + '</div>' : '') + '</div>';
    });
    html += '</div></div>';
    if (d.daily_14d.length > 0) {
      const f = formatDate(d.daily_14d[0].date);
      const m = formatDate(d.daily_14d[Math.floor(d.daily_14d.length / 2)].date);
      const l = formatDate(d.daily_14d[d.daily_14d.length - 1].date);
      html += '<div class="chart-labels"><span>' + f + '</span><span>' + m + '</span><span>' + l + '</span></div>';
    }
    html += '</div></div>';
  }
  if (d.top_employees && d.top_employees.length) {
    html += '<div class="section"><h3 class="section-title">Топ сборщиков (неделя)</h3>';
    html += '<div class="card"><div class="top-list">';
    d.top_employees.forEach((e, i) => {
      html += '<div class="row">';
      html += '<div class="rank">' + (i + 1) + '.</div>';
      html += '<div class="avatar">' + getInitials(e.name || '?') + '</div>';
      html += '<div class="name">' + escapeHtml(e.name || '—') + '</div>';
      html += '<div class="qty">' + e.qty + '<small>шт.</small></div>';
      html += '</div>';
    });
    html += '</div></div></div>';
  }
  html += '</div>';

  html += '<div class="section"><h3 class="section-title">Последние записи <a onclick="selectSidebarItem(\'history\')">Все сборки</a></h3>';
  html += '<div class="card" id="recent-card">';
  if (!d.recent || d.recent.length === 0) {
    html += '<div class="empty-block" style="padding:20px 0;"><i class="ti ti-inbox"></i>Записей пока нет</div>';
  } else {
    const recent = d.recent;
    // ЭТАП 31.3: показываем 4 записи, остальные скрываем за «Показать ещё»
    const initialCount = 4;
    recent.slice(0, initialCount).forEach(r => html += renderRecordHtml(r));
    if (recent.length > initialCount) {
      html += '<div id="recent-hidden" style="display:none;">';
      recent.slice(initialCount).forEach(r => html += renderRecordHtml(r));
      html += '</div>';
      html += '<button class="btn btn-link" id="recent-toggle" onclick="toggleRecentMore()" style="width:100%;padding:12px;text-align:center;background:none;border:none;border-top:1px solid var(--border);color:var(--brand);font-weight:500;cursor:pointer;font-family:inherit;font-size:14px;">' +
        '<i class="ti ti-chevron-down"></i> Показать ещё ' + (recent.length - initialCount) +
      '</button>';
    }
  }
  html += '</div></div>';

  // ЭТАП 31.4: блок «Договоры в работе» убран отсюда — теперь на главной приложения

  container.innerHTML = html;
  // v2.42.2: подтягиваем активные работы (status='in_progress')
  if (typeof loadActiveWorksBlock === 'function') {
    try { loadActiveWorksBlock(); } catch (_) {}
  }
  // v2.45.271: «На оплате» — бухгалтеру и директору
  try { _fillPayDueBlock(); } catch (_) {}
}

// v2.45.272: пункт «На оплате» в левой колонке — открывает Заказы с фильтром «К оплате»
function openSupplyPayList() {
  selectSidebarItem('supply-orders');
  setTimeout(() => {
    try { setSupplyOrdFilter('to_pay'); } catch (_) {}
  }, 150);
}

// v2.45.272: бейдж количества «к оплате» на пункте меню
async function _updateSupplyPayBadge() {
  const badge = document.getElementById('supply-pay-badge');
  if (!badge) return;
  try {
    const d = await apiGet('/api/supply-orders?status=to_pay');
    const n = (d.counts && d.counts.to_pay) || (d.orders || []).length || 0;
    badge.textContent = n;
    badge.style.display = n ? '' : 'none';
  } catch (_) {}
}

// v2.45.271: блок «На оплате» на главной — заказы в статусе to_pay с кнопкой «Оплатил»
async function _fillPayDueBlock() {
  const box = document.getElementById('pay-due-block');
  if (!box) return;
  const roles = (state.user && state.user.roles) || [];
  if (!(roles.includes('director') || roles.includes('accountant') || roles.includes('zam'))) return;
  try {
    // v2.45.310: два этапа для бухгалтера —
    //  «Счёт получен» → кнопка «На оплату»; «На оплате» → кнопка «Оплатил».
    const [dRecv, dPay] = await Promise.all([
      apiGet('/api/supply-orders?status=invoice_received').catch(() => ({})),
      apiGet('/api/supply-orders?status=to_pay').catch(() => ({})),
    ]);
    const recvList = dRecv.orders || dRecv.items || [];
    const payList  = dPay.orders  || dPay.items  || [];
    // бейджи «На оплате» в меню — по числу заказов to_pay
    ['supply-pay-badge', 'home-pay-badge'].forEach(id => {
      const badge = document.getElementById(id);
      if (badge) {
        badge.textContent = payList.length;
        badge.style.display = payList.length ? '' : 'none';
      }
    });
    let h = '';
    h += _payBlockHtml(recvList, 'Счёт получен — на оплату', '#3730A3', 'ti-file-invoice',
      o => '<button class="btn btn-primary btn-small" style="white-space:nowrap;" onclick="payQueueToPay(' + o.id + ', this)"><i class="ti ti-wallet"></i> На оплату</button>');
    h += _payBlockHtml(payList, 'На оплате', '#9A3412', 'ti-wallet',
      o => '<button class="btn btn-primary btn-small" style="white-space:nowrap;" onclick="payDueMarkPaid(' + o.id + ', this)"><i class="ti ti-cash"></i> Оплатил</button>');
    box.innerHTML = h;
  } catch (e) { box.innerHTML = ''; }
}

// v2.45.310: HTML одного блока главного экрана «список заказов + кнопка действия».
function _payBlockHtml(list, title, color, icon, btnFactory) {
  if (!list || !list.length) return '';
  let h = '<div class="section" style="margin-bottom:16px;">' +
    '<h3 class="section-title" style="color:' + color + ';"><i class="ti ' + icon + '"></i> ' + escapeHtml(title) + ' (' + list.length + ') ' +
      '<a style="cursor:pointer;color:var(--brand);font-size:13px;" onclick="selectSidebarItem(\'supply-orders\')">все заказы →</a></h3>' +
    '<div class="card" style="padding:4px 12px;">';
  list.forEach(o => {
    const sum = o.invoice_total
      ? Number(o.invoice_total).toLocaleString('ru-RU', { minimumFractionDigits: 2 }) + ' ₽'
      : (o.total_amount ? Math.round(o.total_amount).toLocaleString('ru-RU') + ' ₽' : '');
    const inv = o.invoice_number ? 'Счёт № ' + o.invoice_number : (o.invoice_filename || '');
    const dog = o.contract_number ? ('дог. №' + o.contract_number) : '';
    const meta2 = [inv, dog].filter(Boolean).join(' · ');
    h += '<div style="display:flex;align-items:center;gap:10px;padding:9px 2px;border-bottom:1px solid var(--border);">' +
      '<div style="flex:1;min-width:0;cursor:pointer;" onclick="state.currentSupplyOrderId=' + o.id + ';selectSidebarItem(\'supply-order-detail\');" title="Открыть заказ">' +
        '<div style="font-size:13.5px;font-weight:600;color:var(--text-dark);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
          escapeHtml(o.order_label || ('#' + o.id)) + ' · ' + escapeHtml(o.supplier_name || '—') + '</div>' +
        '<div style="font-size:12px;color:var(--text-light);">' + escapeHtml(meta2) +
          (sum ? (meta2 ? ' · ' : '') + '<b style="color:' + color + ';">' + sum + '</b>' : '') + '</div>' +
        // v2.45.x: срок поставки — заметно, чтобы видеть ДО оплаты
        (o.invoice_delivery_term ? '<div style="font-size:11.5px;font-weight:700;color:#9A3412;margin-top:2px;"><i class="ti ti-truck-delivery" style="font-size:12px;vertical-align:-1px;"></i> Срок поставки: ' + escapeHtml(o.invoice_delivery_term) + '</div>' : '') +
      '</div>' +
      btnFactory(o) +
    '</div>';
  });
  h += '</div></div>';
  return h;
}

// v2.45.310: бухгалтер передаёт «счёт получен» → «на оплате»
async function payQueueToPay(orderId, btn) {
  if (!confirm('Передать на оплату?')) return;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i>'; }
  try {
    const res = await supplyOrderTransitionConfirmed(orderId, 'to_pay');
    if (res.cancelled) { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-wallet"></i> На оплату'; } return; }
    if (!res.ok) {
      showToast(res.message || 'Не удалось', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-wallet"></i> На оплату'; }
      return;
    }
    showToast('Передано на оплату ✓', 'success');
    cache.supplyOrders = null;
    _fillPayDueBlock();
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-wallet"></i> На оплату'; }
  }
}

// v2.45.309: один запрос на смену статуса заказа поставщику.
async function _supplyOrderTransitionReq(orderId, newStatus, password) {
  const body = { to: newStatus };
  if (password != null) body.password = password;
  const r = await fetch(API_BASE + '/api/supply-orders/' + orderId + '/transition', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, error: j.error, message: j.message, data: j };
}

// v2.45.309: смена статуса с подтверждением личным паролём для «Оплачено».
// Сначала пробуем без пароля; если бэкенд просит пароль (401) или он неверный (403) —
// спрашиваем и повторяем. Возвращает {ok, cancelled?, message?}.
async function supplyOrderTransitionConfirmed(orderId, newStatus) {
  let password = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await _supplyOrderTransitionReq(orderId, newStatus, password);
    if (res.ok) return res;
    if (res.status === 401 && res.error === 'password_required') {
      const pw = prompt('Подтвердите оплату — введите ваш пароль от Atom:');
      if (pw === null) return { ok: false, cancelled: true };
      password = (pw || '').trim();
      continue;
    }
    if (res.status === 403 && res.error === 'wrong_password') {
      const pw = prompt('Неверный пароль. Введите ещё раз:');
      if (pw === null) return { ok: false, cancelled: true };
      password = (pw || '').trim();
      continue;
    }
    return res; // прочая ошибка
  }
  return { ok: false, message: 'Слишком много попыток ввода пароля' };
}

async function payDueMarkPaid(orderId, btn) {
  if (!confirm('Отметить заказ оплаченным?')) return;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i>'; }
  try {
    const res = await supplyOrderTransitionConfirmed(orderId, 'paid');
    if (res.cancelled) {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-cash"></i> Оплатил'; }
      return;
    }
    if (!res.ok) {
      showToast(res.message || 'Не удалось отметить оплату', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-cash"></i> Оплатил'; }
      return;
    }
    showToast('Оплачено ✓', 'success');
    cache.supplyOrders = null;
    _fillPayDueBlock();   // блок перерисуется (оплаченный уйдёт)
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-cash"></i> Оплатил'; }
  }
}

// v2.42.5: ГЛОБАЛЬНЫЕ УВЕДОМЛЕНИЯ ===================================

let _notifRefreshTimer = null;

function startNotifPolling() {
  refreshNotifBadge();
  if (_notifRefreshTimer) clearInterval(_notifRefreshTimer);
  _notifRefreshTimer = setInterval(refreshNotifBadge, 30000);
  // v2.45.159: пере-синхронизировать пуш-подписку, чтобы она не «слетала»
  // после обновления страницы / Service Worker (иконка гасла, пуш не приходил)
  try { syncPushSubscription(); } catch (_) {}
}

async function refreshNotifBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  try {
    // v2.43.49: запрашиваем оба источника параллельно
    const [chats, notifs] = await Promise.all([
      apiGet('/api/contract-chats/unread').catch(() => ({ total_unread: 0, contracts: [] })),
      apiGet('/api/notifications/unread').catch(() => ({ items: [], count: 0 })),
    ]);
    const totalChats   = (chats && chats.total_unread) || 0;
    const totalNotifs  = (notifs && (notifs.count != null ? notifs.count : (notifs.items || []).length)) || 0;
    const total = totalChats + totalNotifs;
    if (total > 0) {
      const newText = total > 99 ? '99+' : String(total);
      // v2.45.61: pulse только когда счётчик изменился (новое уведомление)
      const prevText = badge.textContent || '';
      const wasHidden = badge.style.display === 'none';
      badge.textContent = newText;
      badge.style.display = '';
      if (wasHidden || prevText !== newText) {
        badge.classList.remove('is-pulsing');
        // reflow trick — рестартим анимацию
        void badge.offsetWidth;
        badge.classList.add('is-pulsing');
      }
    } else {
      badge.style.display = 'none';
    }
    state._notifSummary = {
      contracts:    (chats && chats.contracts) || [],
      items:        (notifs && notifs.items) || [],
      total_unread: totalChats,
      total_global: totalNotifs,
    };
  } catch (e) {
    // тихо
  }
}

// v2.45.62: «Очистить всё» прямо из панели колокольчика —
// шлёт /api/notifications/ack-all и обновляет UI без перезагрузки.
async function ackAllFromPanel() {
  const btn = document.getElementById('notif-panel-clear');
  if (btn) btn.disabled = true;
  try {
    const r = await apiPost('/api/notifications/ack-all', {});
    const cnt = (r && r.data && r.data.count) || 0;
    // Обнулим состояние и UI
    if (state.notif) state.notif.unread = [];
    state._notifSummary = { items: [], contracts: [] };
    updateNotifBadge(0);
    _renderNotifPanel(state._notifSummary);
    // Сразу обновим бейдж колокольчика (он считает и чаты тоже)
    refreshNotifBadge().catch(() => {});
    if (cnt > 0) showToast('Подтверждено: ' + cnt, 'success');
    else        showToast('Нечего очищать', 'info');
  } catch (e) {
    showToast('Не удалось очистить', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  if (panel.classList.contains('open')) {
    closeNotifPanel();
  } else {
    openNotifPanel();
  }
}

function openNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  panel.classList.add('open');
  _renderNotifPanel(state._notifSummary);
  if (typeof _updateNotifSoundIcon === 'function') _updateNotifSoundIcon();
  // Подгрузить актуальное
  refreshNotifBadge().then(() => _renderNotifPanel(state._notifSummary));
  // Закрытие по клику вне
  setTimeout(() => {
    document.addEventListener('click', _notifOutsideClickHandler);
  }, 50);
}

function closeNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  panel.classList.remove('open');
  document.removeEventListener('click', _notifOutsideClickHandler);
}

function _notifOutsideClickHandler(e) {
  const panel = document.getElementById('notif-panel');
  const bell = document.getElementById('notif-bell-btn');
  if (!panel || !bell) return;
  if (panel.contains(e.target) || bell.contains(e.target)) return;
  closeNotifPanel();
}

function _renderNotifPanel(r) {
  const body = document.getElementById('notif-panel-body');
  if (!body) return;
  const chats   = (r && r.contracts) || [];
  const notifs  = (r && r.items) || [];
  if (!chats.length && !notifs.length) {
    body.innerHTML = '<div class="notif-empty">' +
      '<i class="ti ti-check"></i>' +
      '<div>Все сообщения прочитаны</div>' +
    '</div>';
    return;
  }
  let html = '';
  // v2.43.49: сначала глобальные уведомления (дефекты, договоры, сборки)
  if (notifs.length) {
    html += '<div class="notif-section-title"><i class="ti ti-bell-ringing"></i> Уведомления</div>';
    notifs.forEach(n => {
      const time = _chatPrettyTime(n.created_at);
      let icon = 'ti-bell';
      let actionTitle = '';
      if (n.type === 'defect_created') {
        icon = 'ti-alert-triangle';
        actionTitle = 'Открыть замечание';
      } else if (n.type === 'defect_message_added') {
        icon = 'ti-message-circle';
        actionTitle = 'Открыть переписку';
      } else if (n.type === 'contract_published') {
        icon = 'ti-file-text';
      } else if (n.type === 'assembly_created') {
        icon = 'ti-tool';
      } else if (n.type === 'contract_shipped') {
        icon = 'ti-truck-delivery';
        actionTitle = 'Открыть договор';
      }
      const onClick = n.entity_type === 'defect'
        ? 'onNotifGlobalClick(' + n.id + ',\'defect\',' + (n.entity_id || 0) + ')'
        : (n.entity_type === 'contract'
            ? 'onNotifGlobalClick(' + n.id + ',\'contract\',' + (n.entity_id || 0) + ')'
            : 'onNotifGlobalClick(' + n.id + ',\'\',\'\')');
      html += '<div class="notif-item notif-global" onclick="' + onClick + '">' +
        '<div class="notif-item-head">' +
          '<div class="notif-item-title">' +
            '<i class="ti ' + icon + '"></i>' +
            escapeHtml(n.title || '') +
          '</div>' +
          '<button class="notif-ack-x" onclick="event.stopPropagation();ackOneNotif(' + n.id + ')" title="Отметить как прочитанное"><i class="ti ti-x"></i></button>' +
        '</div>' +
        (n.message ? '<div class="notif-item-last">' + escapeHtml(_truncate(n.message, 120)) + '</div>' : '') +
        '<div class="notif-item-time">' + escapeHtml(time) + '</div>' +
      '</div>';
    });
  }
  // Затем — непрочитанные чаты договоров
  if (chats.length) {
    html += '<div class="notif-section-title"><i class="ti ti-messages"></i> Чаты по договорам</div>';
    chats.forEach(c => {
      const lastTime = _chatPrettyTime(c.last_at);
      const lastText = c.last_text || '';
      const author = c.last_author ? (c.last_author + ': ') : '';
      html += '<div class="notif-item" onclick="onNotifItemClick(' + c.contract_id + ')">' +
        '<div class="notif-item-head">' +
          '<div class="notif-item-title">' +
            '<i class="ti ti-message-circle"></i>' +
            'Договор ' + escapeHtml(c.contract_number || '#' + c.contract_id) +
          '</div>' +
          '<span class="notif-unread-badge">' + (c.unread > 99 ? '99+' : c.unread) + '</span>' +
        '</div>' +
        (c.contractor_name ? '<div class="notif-item-sub">' + escapeHtml(c.contractor_name) + '</div>' : '') +
        '<div class="notif-item-last">' +
          '<span class="notif-author">' + escapeHtml(author) + '</span>' +
          escapeHtml(_truncate(lastText, 80)) +
        '</div>' +
        '<div class="notif-item-time">' + escapeHtml(lastTime) + '</div>' +
      '</div>';
    });
  }
  body.innerHTML = html;
}

// v2.43.49: клик по глобальному уведомлению — переход + ack
async function onNotifGlobalClick(notifId, entityType, entityId) {
  // Ack
  try { await apiPost('/api/notifications/' + notifId + '/ack', {}); } catch (e) {}
  closeNotifPanel();
  refreshNotifBadge();
  // Навигация по типу
  if (entityType === 'defect' && entityId) {
    if (typeof openDefectDetail === 'function') {
      openDefectDetail(entityId);
    } else {
      selectSidebarItem('defects');
    }
  } else if (entityType === 'contract' && entityId) {
    if (typeof openContractDetail === 'function') {
      openContractDetail(entityId);
    }
  }
}

// v2.43.49: точечный ack по крестику
async function ackOneNotif(notifId) {
  try {
    await apiPost('/api/notifications/' + notifId + '/ack', {});
    refreshNotifBadge().then(() => _renderNotifPanel(state._notifSummary));
  } catch (e) {
    showToast('Не удалось отметить', 'error');
  }
}

function _truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function _chatPrettyTime(iso) {
  if (!iso) return '';
  const dt = (iso || '').replace('T', ' ');
  const today = new Date().toISOString().slice(0, 10);
  const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const date = dt.slice(0, 10);
  const time = dt.slice(11, 16);
  if (date === today) return time;
  if (date === yest) return 'вчера ' + time;
  return date.split('-').reverse().join('.') + ' ' + time;
}

function onNotifItemClick(contractId) {
  closeNotifPanel();
  // Переходим в договор и открываем чат
  state.currentContractId = contractId;
  if (typeof selectSection === 'function') selectSection('sales');
  if (typeof selectSidebarItem === 'function') selectSidebarItem('sales-contract-detail');
  setTimeout(() => {
    if (typeof openContractChat === 'function') openContractChat();
    refreshNotifBadge();
  }, 200);
}

// v2.42.3: ЧАТ ПО ДОГОВОРУ ============================================

let _cchatRefreshTimer = null;

async function openContractChat() {
  const cid = state.currentContractId;
  if (!cid) {
    showToast('Договор не выбран', 'error');
    return;
  }
  document.getElementById('contract-chat-modal').classList.add('visible');
  await loadContractChat(cid);
  // Автообновление каждые 7 сек
  if (_cchatRefreshTimer) clearInterval(_cchatRefreshTimer);
  _cchatRefreshTimer = setInterval(() => {
    if (document.getElementById('contract-chat-modal').classList.contains('visible')) {
      loadContractChat(cid, /*silent*/true);
    } else {
      clearInterval(_cchatRefreshTimer);
      _cchatRefreshTimer = null;
    }
  }, 7000);
  // Фокус в инпут
  setTimeout(() => {
    const inp = document.getElementById('cchat-input');
    if (inp) inp.focus();
  }, 150);
}

function closeContractChat() {
  document.getElementById('contract-chat-modal').classList.remove('visible');
  if (_cchatRefreshTimer) { clearInterval(_cchatRefreshTimer); _cchatRefreshTimer = null; }
  _cchatPendingFiles = [];
  _renderChatAttachPreview();
  if (typeof refreshNotifBadge === 'function') refreshNotifBadge();
}

async function loadContractChat(contractId, silent) {
  const box = document.getElementById('cchat-messages');
  if (!silent) box.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try {
    const r = await apiGet('/api/contracts/' + contractId + '/chat');
    state._cchat = r;
    document.getElementById('cchat-title').textContent =
      'Договор ' + (r.contract_number || '#' + contractId);
    document.getElementById('cchat-subtitle').textContent = r.contractor_name || '';
    _renderContractChatMessages(r);
    // Бейдж сбросить
    const b = document.getElementById('scd-chat-unread');
    if (b) b.style.display = 'none';
  } catch (e) {
    if (!silent) box.innerHTML = '<div class="empty-block">Ошибка загрузки</div>';
  }
}

function _renderContractChatMessages(r) {
  const box = document.getElementById('cchat-messages');
  const msgs = r.messages || [];
  const myChatId = r.my_chat_id;
  if (!msgs.length) {
    box.innerHTML = '<div class="empty-block" style="padding:30px 18px;color:var(--text-light);">' +
      '<i class="ti ti-message-circle"></i><br>Сообщений пока нет.<br>Напишите первое — все участники по этому договору увидят.</div>';
    return;
  }
  // Считаем «было ли уже выше внизу»
  const wasAtBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 40;
  let html = '';
  let lastAuthor = null;
  let lastDate = null;
  msgs.forEach(m => {
    const isMine = (m.author_chat_id === myChatId);
    const dt = (m.created_at || '').slice(0, 10);
    if (dt !== lastDate) {
      html += '<div class="cchat-date-sep"><span>' + escapeHtml(_chatPrettyDate(dt)) + '</span></div>';
      lastDate = dt;
      lastAuthor = null;
    }
    const time = (m.created_at || '').slice(11, 16);
    const showHead = (lastAuthor !== (m.author_chat_id || 0)) || (m.is_system);
    lastAuthor = m.author_chat_id || 0;
    const author = m.author_name || (isMine ? 'Я' : 'Сотрудник');
    const cls = 'cchat-msg' + (isMine ? ' mine' : '') + (m.is_system ? ' sys' : '');
    if (m.is_system) {
      html += '<div class="cchat-sys">' + escapeHtml(m.text) + ' · ' + escapeHtml(time) + '</div>';
      return;
    }
    html += '<div class="' + cls + '">';
    if (showHead && !isMine) {
      html += '<div class="cchat-msg-author">' + escapeHtml(author) + '</div>';
    }
    if (m.text) {
      html += '<div class="cchat-msg-body">' + _escapeChatText(m.text) + '</div>';
    }
    if (m.files && m.files.length) {
      html += _renderChatMessageFiles(m.files);
    }
    html += '<div class="cchat-msg-meta">' + escapeHtml(time);
    if (isMine) {
      html += ' · <button class="cchat-del-btn" onclick="deleteContractMessage(' + m.id + ')" title="Удалить"><i class="ti ti-trash"></i></button>';
    }
    html += '</div></div>';
  });
  box.innerHTML = html;
  if (wasAtBottom) box.scrollTop = box.scrollHeight;
}

function _chatPrettyDate(iso) {
  if (!iso) return '';
  const today = new Date().toISOString().slice(0, 10);
  const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (iso === today) return 'Сегодня';
  if (iso === yest) return 'Вчера';
  return iso.split('-').reverse().join('.');
}

function _escapeChatText(t) {
  // Экранируем + переносы строк сохраняем
  return escapeHtml(t || '').replace(/\n/g, '<br>');
}

// v2.42.3.1: прикреплённые файлы
let _cchatPendingFiles = [];

function onContractChatFilesSelected(files) {
  if (!files || !files.length) return;
  for (let i = 0; i < files.length; i++) {
    if (_cchatPendingFiles.length >= 5) {
      showToast('Не больше 5 файлов на сообщение', 'info');
      break;
    }
    const f = files[i];
    // Лимит: 20МБ для фото/документов, 100МБ для видео
    const isVid = (f.type || '').startsWith('video/');
    const maxSize = isVid ? 100 * 1024 * 1024 : 20 * 1024 * 1024;
    if (f.size > maxSize) {
      showToast('Файл "' + f.name + '" слишком большой', 'error');
      continue;
    }
    _cchatPendingFiles.push(f);
  }
  _renderChatAttachPreview();
  document.getElementById('cchat-file-input').value = '';
}

function _renderChatAttachPreview() {
  const wrap = document.getElementById('cchat-attach-preview');
  if (!wrap) return;
  if (!_cchatPendingFiles.length) { wrap.innerHTML = ''; return; }
  let html = '<div class="cchat-attach-row">';
  _cchatPendingFiles.forEach((f, i) => {
    const isImg = (f.type || '').startsWith('image/');
    const isVid = (f.type || '').startsWith('video/');
    let thumb;
    if (isImg) {
      const url = URL.createObjectURL(f);
      thumb = '<img src="' + url + '" alt="">';
    } else if (isVid) {
      thumb = '<div class="cchat-thumb-icon"><i class="ti ti-video"></i></div>';
    } else {
      thumb = '<div class="cchat-thumb-icon"><i class="ti ti-file"></i></div>';
    }
    html += '<div class="cchat-attach-item">' +
      thumb +
      '<div class="cchat-attach-name" title="' + escapeHtml(f.name) + '">' + escapeHtml(f.name) + '</div>' +
      '<button class="cchat-attach-remove" onclick="removeChatAttachment(' + i + ')" title="Убрать">' +
        '<i class="ti ti-x"></i>' +
      '</button>' +
    '</div>';
  });
  html += '</div>';
  wrap.innerHTML = html;
}

function removeChatAttachment(idx) {
  _cchatPendingFiles.splice(idx, 1);
  _renderChatAttachPreview();
}

function _renderChatMessageFiles(files) {
  if (!files || !files.length) return '';
  let html = '<div class="cchat-msg-files">';
  files.forEach(f => {
    const url = API_BASE + '/api/contracts/chat/files/' + f.id;
    if (f.kind === 'photo') {
      html += '<a href="' + url + '" target="_blank" class="cchat-file-img">' +
        '<img src="' + url + '" alt="">' +
      '</a>';
    } else if (f.kind === 'video') {
      html += '<video controls class="cchat-file-video"><source src="' + url + '" type="' + escapeHtml(f.content_type || '') + '"></video>';
    } else {
      const name = f.original_name || ('Файл #' + f.id);
      const sz = f.file_size ? Math.round(f.file_size / 1024) + ' КБ' : '';
      html += '<a href="' + url + '" target="_blank" class="cchat-file-doc">' +
        '<i class="ti ti-file"></i>' +
        '<div class="cchat-file-doc-meta">' +
          '<div class="cchat-file-doc-name">' + escapeHtml(name) + '</div>' +
          (sz ? '<div class="cchat-file-doc-size">' + sz + '</div>' : '') +
        '</div>' +
      '</a>';
    }
  });
  html += '</div>';
  return html;
}

async function sendContractChatMessage() {
  const inp = document.getElementById('cchat-input');
  const btn = document.getElementById('cchat-send-btn');
  const text = (inp.value || '').trim();
  if (!text && !_cchatPendingFiles.length) return;
  const cid = state.currentContractId;
  if (!cid) return;
  btn.disabled = true;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    let response;
    if (_cchatPendingFiles.length) {
      // multipart
      const fd = new FormData();
      if (text) fd.append('text', text);
      _cchatPendingFiles.forEach((f, i) => {
        fd.append('file_' + (i + 1), f, f.name);
      });
      response = await fetch(API_BASE + '/api/contracts/' + cid + '/chat', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: fd,
      });
    } else {
      // JSON
      response = await fetch(API_BASE + '/api/contracts/' + cid + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ text: text }),
      });
    }
    if (!response.ok) {
      const e = await response.json().catch(() => ({}));
      showToast(e.message || e.error || 'Не отправилось', 'error');
      return;
    }
    inp.value = '';
    inp.style.height = '';
    _cchatPendingFiles = [];
    _renderChatAttachPreview();
    await loadContractChat(cid, /*silent*/true);
    const box = document.getElementById('cchat-messages');
    box.scrollTop = box.scrollHeight;
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  } finally {
    btn.disabled = false;
    inp.focus();
  }
}

async function deleteContractMessage(msgId) {
  if (!confirm('Удалить сообщение?')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/contract-messages/' + msgId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      showToast(e.message || e.error || 'Не удалось', 'error');
      return;
    }
    if (state.currentContractId) loadContractChat(state.currentContractId, true);
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// Enter — отправить, Shift+Enter — перенос
document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('cchat-input');
  if (!inp) return;
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendContractChatMessage();
    }
  });
  // Auto-grow textarea
  inp.addEventListener('input', () => {
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 140) + 'px';
  });
});

// v2.42.2: «Сейчас в работе» — рендер блока на главной
async function loadActiveWorksBlock() {
  const wrap = document.getElementById('active-works-block');
  if (!wrap) return;
  try {
    const r = await apiGet('/api/active-works');
    const works = (r && r.works) || [];
    if (!works.length) {
      wrap.innerHTML = '';
      return;
    }
    let html = '<div class="aw-head">' +
      '<i class="ti ti-player-play"></i>' +
      '<span class="aw-title">Сейчас в работе</span>' +
      '<span class="aw-count">' + works.length + '</span>' +
    '</div><div class="aw-list">';
    works.forEach(w => {
      const workers = (w.workers || []).map(x => x.name).join(', ') || '—';
      const model = (w.model_name || w.description || '—');
      const sub = [];
      if (w.contract_number) sub.push('Договор ' + w.contract_number);
      if (w.contractor_name) sub.push(w.contractor_name);
      if (w.location) sub.push(w.location);
      const subStr = sub.join(' · ');
      const startedAt = (w.created_at || '').replace('T', ' ').slice(5, 16);
      const finishBtn = (typeof canManageSales === 'function' && canManageSales())
        ? '<button class="btn btn-primary btn-small aw-finish-btn" onclick="finishActiveWork(' + w.id + ')" title="Перевести в Готово и создать приход на склад">' +
            '<i class="ti ti-check"></i> Завершить' +
          '</button>'
        : '';
      html += '<div class="aw-row">' +
        '<div class="aw-av">' + escapeHtml(getInitials(workers)) + '</div>' +
        '<div class="aw-body">' +
          '<div class="aw-model">' + (typeof _highlightAisi === 'function' ? _highlightAisi(model) : escapeHtml(model)) + '</div>' +
          '<div class="aw-meta">' +
            escapeHtml(workers) +
            (subStr ? ' · ' + escapeHtml(subStr) : '') +
            ' · с ' + escapeHtml(startedAt) +
          '</div>' +
        '</div>' +
        '<div class="aw-qty">' + (w.quantity || 1) + ' шт.</div>' +
        finishBtn +
      '</div>';
    });
    html += '</div>';
    wrap.innerHTML = html;
  } catch (e) {
    wrap.innerHTML = '';
  }
}

async function finishActiveWork(assemblyId) {
  if (!confirm('Завершить работу? Сборка перейдёт в «Готово» и появится приход на складе.')) return;
  try {
    const r = await apiPost('/api/assemblies/' + assemblyId + '/finish', {});
    if (r && r.ok && r.data && r.data.ok) {
      showToast('Работа завершена', 'success');
      if (typeof loadActiveWorksBlock === 'function') loadActiveWorksBlock();
      if (typeof loadDashboard === 'function') loadDashboard();
    } else {
      showToast((r && r.data && (r.data.message || r.data.error)) || 'Не удалось завершить', 'error');
    }
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// v2.45.20: удаление сборки из карточки договора (например, после авто-привязки
// позиции к component на складе — старая сборка-сирота больше не нужна).
async function deleteAssemblyFromContract(assemblyId, contractId, modelTitle) {
  const what = modelTitle ? ' «' + modelTitle.replace(/<[^>]+>/g, '') + '»' : '';
  if (!confirm('Удалить сборку' + what + '? Это действие необратимо.\n\nПриход на склад (если был) — отменится. История переходов сохранится.')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/assemblies/' + assemblyId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (r.status === 401 || r.status === 403) {
      showToast('Сессия истекла — обнови страницу (F5)', 'error');
      return;
    }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      showToast(j.message || ('Не удалось удалить (HTTP ' + r.status + ')'), 'error');
      return;
    }
    showToast('Сборка удалена', 'success');
    await _afterAssemblyStatusChange(contractId);
  } catch (e) {
    showToast('Сеть: не удалось удалить', 'error');
  }
}

// v2.43.16: откатить «готовую» сборку обратно в «в работе».
// Используется когда мастер ошибочно отметил готовность.
// Приходные движения склада автоматически отменяются.
async function reopenAssembly(assemblyId, contractId) {
  if (!confirm('Вернуть сборку в работу? Приход на склад отменится.\nДоступно только пока не было отгрузок.')) return;
  try {
    const r = await apiPatch('/api/assemblies/' + assemblyId + '/status', { status: 'in_progress' });
    if (r) {
      showToast('Сборка возвращена в работу', 'success');
      await _afterAssemblyStatusChange(contractId);
    }
  } catch (e) {
    showToast((e && e.message) || 'Не удалось вернуть в работу', 'error');
  }
}

// v2.43.17: пометить сборку готовой (in_progress → ready)
async function markAssemblyReady(assemblyId, contractId) {
  if (!confirm('Отметить сборку готовой? Появится приход на склад, статус: «Готово».')) return;
  try {
    const r = await apiPatch('/api/assemblies/' + assemblyId + '/status', { status: 'ready' });
    if (r) {
      showToast('Сборка готова', 'success');
      await _afterAssemblyStatusChange(contractId);
    }
  } catch (e) {
    showToast((e && e.message) || 'Не удалось перевести в готово', 'error');
  }
}

// v2.43.17: общая постобработка после смены статуса сборки —
// сбрасываем кэши И жёстко перезагружаем спецификацию (бейджи В резерве/Изготовляется).
async function _afterAssemblyStatusChange(contractId) {
  cache.dashboard = null;
  cache.productionKanban = null;
  cache.contracts = null;
  cache.contractsWithProgress = null;
  // Сбрасываем кэш спецификации, иначе бейджи останутся старые
  if (state._specByContract && contractId) {
    delete state._specByContract[contractId];
  }
  if (contractId && typeof loadCurrentContract === 'function') {
    await loadCurrentContract();
  }
  // На всякий случай дёргаем спецификацию ещё раз (loadCurrentContract её и сам тянет)
  if (contractId && typeof loadContractItemsBlock === 'function') {
    await loadContractItemsBlock(contractId);
  }
}

// v2.43.18: пакетный откат всех ready-assembly позиции спецификации в in_progress.
// Находим assemblies этого договора с указанной моделью и status='ready', переключаем все.
async function reopenSpecItemAssemblies(contractId, itemId, modelId) {
  if (!confirm('Вернуть все готовые сборки этой позиции обратно в работу?\nПриходы на склад отменятся.')) return;
  try {
    // 1. Берём список assemblies из карточки договора (она уже загружена в state)
    const c = state.lastLoadedContract || {};
    const list = (c.assemblies || []).filter(a =>
      a.model_id === modelId && a.status === 'ready' && a.is_active !== 0
    );
    if (!list.length) {
      showToast('Нет готовых сборок для отката', 'error');
      return;
    }
    // 2. Переключаем каждую через существующий endpoint
    let ok = 0, failed = 0;
    for (const a of list) {
      try {
        await apiPatch('/api/assemblies/' + a.id + '/status', { status: 'in_progress' });
        ok++;
      } catch (e) {
        failed++;
      }
    }
    if (ok > 0) {
      showToast('Возвращено в работу: ' + ok + ' шт.' + (failed ? ' (ошибок: ' + failed + ')' : ''), 'success');
    } else {
      showToast('Не удалось вернуть: ' + (failed || 0) + ' ошибок', 'error');
    }
    await _afterAssemblyStatusChange(contractId);
  } catch (e) {
    showToast((e && e.message) || 'Ошибка операции', 'error');
  }
}

// v2.43.18: пакетная пометка всех in_progress-assembly позиции спецификации готовыми.
// v2.45.6: «Уже готово» — создаёт ready-assembly для модели позиции,
// чтобы спецификация моментально стала «В резерве» (для случаев, когда
// изделие физически уже сделано — не надо проходить полный pipeline).
async function markSpecItemReady(contractId, itemId) {
  if (!confirm('Создать готовую сборку для этой позиции и положить в резерв?\n\nИспользуй, если товар уже физически готов на складе и не нужно проходить производство.')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/contracts/items/' + itemId + '/mark-ready', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    });
    if (r.status === 401 || r.status === 403) {
      showToast('Сессия истекла — обнови страницу (F5) и попробуй снова', 'error');
      return;
    }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      showToast(j.message || ('Не удалось (HTTP ' + r.status + ')'), 'error');
      return;
    }
    const j = await r.json();
    showToast('Готово — позиция в резерве (' + (j.qty || 0) + ' шт.)', 'success');
    await _afterAssemblyStatusChange(contractId);
  } catch (e) {
    showToast((e && e.message) || 'Ошибка операции', 'error');
  }
}

async function finishSpecItemAssemblies(contractId, itemId, modelId) {
  if (!confirm('Отметить все сборки этой позиции готовыми? Появится приход на склад.')) return;
  try {
    const c = state.lastLoadedContract || {};
    const list = (c.assemblies || []).filter(a =>
      a.model_id === modelId && a.status === 'in_progress' && a.is_active !== 0
    );
    if (!list.length) {
      showToast('Нет сборок в работе для перевода', 'error');
      return;
    }
    let ok = 0, failed = 0;
    for (const a of list) {
      try {
        await apiPatch('/api/assemblies/' + a.id + '/status', { status: 'ready' });
        ok++;
      } catch (e) {
        failed++;
      }
    }
    if (ok > 0) {
      showToast('Готовых: ' + ok + ' шт.' + (failed ? ' (ошибок: ' + failed + ')' : ''), 'success');
    } else {
      showToast('Не удалось перевести: ' + (failed || 0) + ' ошибок', 'error');
    }
    await _afterAssemblyStatusChange(contractId);
  } catch (e) {
    showToast((e && e.message) || 'Ошибка операции', 'error');
  }
}


// ============================================================
// ЭТАП 29.2 (v2.22.0): КАНБАН ПРОИЗВОДСТВА
// ============================================================

// Кеш данных канбана (KPI + works)
cache.productionKanban = null;
// Активная мобильная колонка
let pkbMobileCol = 'queue';
// v2.44.22: «Готово · 7 дней» свёрнута по умолчанию, чтобы не растягивать доску
let pkbDoneCollapsed = true;
function pkbToggleDoneColumn() {
  pkbDoneCollapsed = !pkbDoneCollapsed;
  if (cache.productionKanban) renderProductionDashboard(cache.productionKanban);
}

const PKB_COL_DEFS = [
  { key: 'queue',       title: 'В очереди',       cls: 'c-queue'   },
  { key: 'in_progress', title: 'В работе',        cls: 'c-active'  },
  { key: 'review',      title: 'На проверке',     cls: 'c-review'  },
  { key: 'packing',     title: 'Упаковка',        cls: 'c-packing' },
  { key: 'done',        title: 'Готово · 7 дней', cls: 'c-done'    },
];

async function loadProductionDashboard() {
  const container = document.getElementById('dashboard-content');
  if (!container) return;

  // Если есть кеш — рендерим сразу, фоновый refresh
  if (cache.productionKanban) {
    renderProductionDashboard(cache.productionKanban);
    // Освежаем в фоне
    fetchProductionKanban().then(d => {
      cache.productionKanban = d;
      renderProductionDashboard(d);
    }).catch(() => {});
    return;
  }

  container.innerHTML = '<div class="loading-block">Загружаем производство…</div>';
  try {
    const d = await fetchProductionKanban();
    cache.productionKanban = d;
    renderProductionDashboard(d);
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Не удалось загрузить канбан: ' + escapeHtml(String(e && e.message || e)) + '</div>';
  }
}

async function fetchProductionKanban() {
  // Грузим параллельно: KPI, список работ, workload сборщиков.
  // workload — необязательный (если упадёт, виджет просто скроется).
  const [kpiRes, worksRes, workloadRes] = await Promise.all([
    apiGet('/api/production/kpi'),
    apiGet('/api/production/works'),
    apiGet('/api/production/workload').catch(() => null),
  ]);
  return {
    kpi: kpiRes || {},
    works: (worksRes && worksRes.works) || [],
    workload: workloadRes || { workers: [], norm_hours: 40 },
    fetchedAt: new Date(),
  };
}

function renderProductionDashboard(d) {
  const container = document.getElementById('dashboard-content');
  if (!container) return;

  const kpi = d.kpi || {};
  const works = d.works || [];
  const fetchedAt = d.fetchedAt || new Date();

  // Распределяем работы по колонкам
  const byCol = { queue: [], in_progress: [], review: [], packing: [], done: [] };
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  works.forEach(w => {
    const st = w.status;
    if (st === 'queue' || st === 'in_progress' || st === 'review' || st === 'packing') {
      byCol[st].push(w);
    } else if (st === 'done') {
      // в колонку «Готово» — только за последние 7 дней
      const fin = w.finished_at ? new Date(w.finished_at) : null;
      if (!fin || fin >= weekAgo) byCol.done.push(w);
    }
  });
  // Сортировка: просроченные сначала, потом по deadline, потом по id
  Object.keys(byCol).forEach(k => {
    byCol[k].sort((a, b) => {
      const ao = a.is_overdue ? 1 : 0;
      const bo = b.is_overdue ? 1 : 0;
      if (ao !== bo) return bo - ao;
      const ad = a.deadline_at ? new Date(a.deadline_at).getTime() : 99999999999;
      const bd = b.deadline_at ? new Date(b.deadline_at).getTime() : 99999999999;
      if (ad !== bd) return ad - bd;
      return (a.id || 0) - (b.id || 0);
    });
  });

  let html = '';

  // --- Шапка ---
  const updatedStr = formatPkbDateTime(fetchedAt);
  html += '<div class="pkb-section-header">';
  html +=   '<div class="pkb-title">';
  html +=     '<h1>Производство</h1>';
  html +=     '<div class="pkb-subtitle">обновлено ' + escapeHtml(updatedStr) + '</div>';
  html +=   '</div>';
  html +=   '<div class="pkb-section-actions">';
  html +=     '<button class="pkb-btn" disabled title="Скоро"><i class="ti ti-calendar-week"></i>План недели</button>';
  html +=     '<button class="pkb-btn" onclick="selectSidebarItem(\'summary\')"><i class="ti ti-chart-bar"></i>Аналитика</button>';
  // v2.24.0 (Stage 30.0): AI-анализ канбана — для мастера и директора
  if (hasPermission('production.manage')) {
    html += '<button class="pkb-btn ai-action" onclick="openAiInsightModal()" title="Запросить анализ канбана у Claude AI"><i class="ti ti-sparkles"></i>AI-анализ</button>';
  }
  // v2.22.2: кнопка синхронизации production_works из договоров — только для директора
  const isDirector = state.user && (state.user.roles || []).indexOf('director') >= 0;
  if (isDirector) {
    html += '<button class="pkb-btn" onclick="syncProductionWorksFromContracts()" title="Создать работы для непокрытых позиций опубликованных договоров (безопасно — дубли не плодит)"><i class="ti ti-cloud-download"></i>Синхронизировать</button>';
  }
  if (hasPermission('production.create')) {
    html +=   '<button class="pkb-btn primary" onclick="openNewAssembly()"><i class="ti ti-plus"></i>Новая работа</button>';
  }
  html +=   '</div>';
  html += '</div>';

  // --- KPI ряд ---
  html += renderPkbKpi(kpi);

  // --- Виджет загрузки сборщиков (Stage 29.4) ---
  html += renderPkbWorkload(d.workload || { workers: [], norm_hours: 40 });

  // --- Мобильные табы переключения колонок ---
  html += '<div class="pkb-col-tabs">';
  PKB_COL_DEFS.forEach(def => {
    const cnt = (byCol[def.key] || []).length;
    const active = (pkbMobileCol === def.key) ? ' active' : '';
    html += '<button class="pkb-col-tab' + active + '" onclick="pkbSwitchMobileColumn(\'' + def.key + '\')">' +
              escapeHtml(def.title) +
              '<span class="pkb-col-tab-count">' + cnt + '</span>' +
            '</button>';
  });
  html += '</div>';

  // --- Канбан-доска ---
  const canDrag = hasPermission('production.manage');
  html += '<div class="pkb-board">';
  PKB_COL_DEFS.forEach(def => {
    const items = byCol[def.key] || [];
    const activeCls = (pkbMobileCol === def.key) ? ' active' : '';
    // v2.23.0: drop-обработчики только если у пользователя есть права на смену статуса
    const dropAttrs = canDrag
      ? ' ondragover="pkbColDragOver(event)"' +
        ' ondragleave="pkbColDragLeave(event)"' +
        ' ondrop="pkbColDrop(event, \'' + def.key + '\')"'
      : '';
    // v2.44.22: колонка «Готово» — сворачиваемая, при раскрытии скроллится внутри
    const isDoneCol = (def.key === 'done');
    const collapsed = isDoneCol && pkbDoneCollapsed;
    const colCollapsedCls = collapsed ? ' is-collapsed' : '';
    const headClickAttr = isDoneCol ? ' onclick="pkbToggleDoneColumn()" style="cursor:pointer"' : '';
    const chevron = isDoneCol
      ? '<i class="ti ' + (collapsed ? 'ti-chevron-down' : 'ti-chevron-up') + '" style="margin-left:auto;font-size:14px;color:var(--text-light);"></i>'
      : '';
    html += '<div class="pkb-col ' + def.cls + activeCls + colCollapsedCls + '" data-pkb-col="' + def.key + '"' + dropAttrs + '>';
    html +=   '<div class="pkb-col-head"' + headClickAttr + '>';
    html +=     '<div class="pkb-col-name">' + escapeHtml(def.title) + '</div>';
    html +=     '<div class="pkb-col-count">' + items.length + '</div>';
    html +=     chevron;
    html +=   '</div>';
    if (!collapsed) {
      const bodyExtra = isDoneCol ? ' pkb-col-body-scroll' : '';
      html += '<div class="pkb-col-body' + bodyExtra + '">';
      if (items.length === 0) {
        html += '<div class="pkb-col-empty">' + escapeHtml(pkbEmptyText(def.key)) + '</div>';
      } else {
        items.forEach(w => html += renderPkbWorkCard(w, def.key));
      }
      html += '</div>';
    }
    html += '</div>';
  });
  html += '</div>';

  container.innerHTML = html;
}

function pkbEmptyText(colKey) {
  switch (colKey) {
    case 'queue':       return 'Очередь пуста';
    case 'in_progress': return 'Ничего в работе';
    case 'review':      return 'Нет работ на проверке';
    case 'packing':     return 'Нет работ на упаковке';
    case 'done':        return 'За неделю пока пусто';
    default:            return '—';
  }
}

// v2.23.2 (Stage 29.5): рендер бейджа комплектности на карточке
function renderPkbKitBadge(kitStatus) {
  const def = pkbKitDef(kitStatus);
  if (!def) return '';
  return '<div class="pkb-wc-kit k-' + kitStatus + '" title="' + escapeHtml(def.tooltip) + '">' +
           '<i class="ti ' + def.icon + '"></i>' + escapeHtml(def.short) +
         '</div>';
}

function pkbKitDef(kitStatus) {
  switch (kitStatus) {
    case 'ready':   return { short: 'комплект', label: 'Комплект собран', tooltip: 'Все детали в наличии', icon: 'ti-package-check' };
    case 'partial': return { short: 'частично', label: 'Частично',         tooltip: 'Часть деталей в наличии', icon: 'ti-package' };
    case 'missing': return { short: 'нет деталей', label: 'Нет деталей',   tooltip: 'Не хватает комплектующих', icon: 'ti-package-off' };
    default:        return null;
  }
}

function pkbSwitchMobileColumn(colKey) {
  pkbMobileCol = colKey;
  // Локально переключаем (без полной перерисовки)
  document.querySelectorAll('.pkb-col-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.pkb-col').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.pkb-col-tab').forEach(t => {
    if (t.getAttribute('onclick') && t.getAttribute('onclick').indexOf("'" + colKey + "'") !== -1) {
      t.classList.add('active');
    }
  });
  const col = document.querySelector('.pkb-col[data-pkb-col="' + colKey + '"]');
  if (col) col.classList.add('active');
}

function renderPkbKpi(kpi) {
  // kpi: { queue, in_progress: {count, assignees}, review, packing, overdue, blocked, week_done, week_plan }
  const queueCnt    = (kpi.queue != null) ? kpi.queue : 0;
  const inProgObj   = kpi.in_progress || {};
  const inProgCnt   = (typeof inProgObj === 'object') ? (inProgObj.count || 0) : inProgObj;
  const inProgAss   = (typeof inProgObj === 'object') ? (inProgObj.assignees || 0) : 0;
  const reviewCnt   = (kpi.review != null) ? kpi.review : 0;
  const packingCnt  = (kpi.packing != null) ? kpi.packing : 0;
  const overdueCnt  = (kpi.overdue != null) ? kpi.overdue : 0;
  const blockedCnt  = (kpi.blocked != null) ? kpi.blocked : 0;
  const weekDone    = (kpi.week_done != null) ? kpi.week_done : 0;
  const weekPlan    = (kpi.week_plan != null) ? kpi.week_plan : null;

  let html = '<div class="pkb-kpi-grid">';

  // 1. В очереди
  html += pkbKpiCard('В очереди', queueCnt, 'ждут сборщика', 'k-neutral', false);

  // 2. В работе
  const inProgHint = inProgAss ? (inProgAss + ' ' + plural(inProgAss, 'сборщик', 'сборщика', 'сборщиков')) : '—';
  html += pkbKpiCard('В работе', inProgCnt, inProgHint, 'k-info', false);

  // 3. Просрочка
  html += pkbKpiCard('Просрочка', overdueCnt, overdueCnt > 0 ? 'требуют внимания' : 'нет просрочек', 'k-danger', overdueCnt > 0);

  // 4. На проверке (или Заблокированы, если есть)
  if (blockedCnt > 0) {
    html += pkbKpiCard('Заблокированы', blockedCnt, 'нет комплектующих', 'k-warning', false);
  } else {
    html += pkbKpiCard('На проверке', reviewCnt, reviewCnt > 0 ? 'ждут ОТК' : '—', 'k-warning', false);
  }

  // 5. v2.34.2: Упаковка
  html += pkbKpiCard('Упаковка', packingCnt, packingCnt > 0 ? 'в дерево / картон' : '—', 'k-violet', false);

  // 6. За неделю
  let weekVal, weekHint;
  if (weekPlan != null && weekPlan > 0) {
    weekVal = weekDone + ' / ' + weekPlan;
    const pct = Math.round(weekDone / weekPlan * 100);
    weekHint = 'факт / план · ' + pct + '%';
  } else {
    weekVal = String(weekDone);
    weekHint = 'завершено';
  }
  html += pkbKpiCard('За неделю', weekVal, weekHint, 'k-success', false);

  html += '</div>';
  return html;
}

function pkbKpiCard(label, value, hint, cls, clickable) {
  const clickAttr = clickable ? ' onclick="pkbFilterOverdue()"' : '';
  return '<div class="pkb-kpi ' + cls + (clickable ? ' clickable' : '') + '"' + clickAttr + '>' +
           '<div class="pkb-kpi-label">' + escapeHtml(label) + '</div>' +
           '<div class="pkb-kpi-value">' + escapeHtml(String(value)) + '</div>' +
           '<div class="pkb-kpi-hint">' + escapeHtml(hint || '') + '</div>' +
         '</div>';
}

function pkbFilterOverdue() {
  // Заглушка под фильтр просрочки. В следующем стейдже.
  showToast('Фильтр по просрочке — в следующем стейдже', 'info');
}

// ============ Stage 29.4: виджет загрузки сборщиков ============

function renderPkbWorkload(workload) {
  const workers = (workload && workload.workers) || [];
  const norm    = (workload && workload.norm_hours) || 40;
  const defHrs  = (workload && workload.default_hours_per_work) || 16;

  // Скрываем виджет если нет сотрудников вовсе
  if (!workers.length) return '';

  // Сортировка: перегруженные первыми, потом норма, потом недогруз,
  // внутри группы — по убыванию pct
  const orderMap = { overloaded: 0, normal: 1, undersized: 2 };
  const sorted = [...workers].sort((a, b) => {
    const oa = orderMap[a.status] != null ? orderMap[a.status] : 9;
    const ob = orderMap[b.status] != null ? orderMap[b.status] : 9;
    if (oa !== ob) return oa - ob;
    return (b.pct || 0) - (a.pct || 0);
  });

  let html = '<div class="pkb-workload">';
  html +=   '<div class="pkb-workload-head">';
  html +=     '<div class="pkb-workload-title">Загрузка сборщиков ' +
                '<i class="ti ti-info-circle pkb-workload-info" title="Как считается:&#10;' +
                '• Главные работы (сотрудник — assignee) + работы где он соисполнитель.&#10;' +
                '• Часы из поля «расч. часы» каждой работы.&#10;' +
                '• Если «расч. часы» не указаны — берётся оценка по ' + defHrs + 'ч на работу.&#10;' +
                '• Тильда (~) рядом со значением означает что часы оценочные.&#10;' +
                '• Норма ' + norm + 'ч/неделю. Чтобы получить точные часы — заполните «расч. часы» в карточке работы."></i>' +
              '</div>';
  html +=     '<div class="pkb-workload-norm" title="Норма ' + norm + 'ч в неделю. Работы без указанных часов считаются по ' + defHrs + 'ч.">' +
                'норма ' + norm + 'ч / неделю' +
              '</div>';
  // v2.45.84: запуск «батч-помощи» (один сотрудник одной операцией на N работ)
  html +=     '<button class="btn btn-secondary btn-small" onclick="openHelperBatchModal()" ' +
                'title="Один сотрудник делает операцию (напр. дверки) сразу на несколько сборок — часы поделятся" ' +
                'style="margin-left:10px;">' +
                '<i class="ti ti-users-group"></i> Батч-помощь' +
              '</button>';
  html +=   '</div>';

  sorted.forEach(w => {
    const name     = w.short_name || w.full_name || ('Сотрудник #' + w.employee_id);
    const initials = getInitials(name);
    const pct      = Math.max(0, Math.min(200, w.pct || 0)); // обрезаем визуально 200%
    // v2.43.30: считаем по est_hours (с учётом оценочных часов) + флаг is_estimated
    const hours       = (w.est_hours != null) ? w.est_hours : (w.total_hours || 0);
    const isEstimated = !!w.is_estimated;
    const works       = w.works_count || 0;
    const mainN       = w.main_count || 0;
    const helpN       = w.help_count || 0;
    const helpingNow  = !!w.helping_now_work_id;
    const status      = w.status || 'undersized';
    const statusLabel =
      (status === 'overloaded') ? 'перегруз' :
      (status === 'normal')     ? 'норма'    :
      (works === 0)             ? 'свободен' : 'недогруз';

    // v2.43.91: вместо «помогает 1 работа» показываем чем именно занят —
    // название первой работы (helping_now вперёд по сортировке с бэка) + счётчик
    // остальных. Полный список с ролями уходит в title для всплывающей подсказки.
    // v2.43.97: часы из подписи убраны — они теперь на самих карточках канбана.
    const worksList = w.works || [];
    const primary = worksList[0];
    const restCount = Math.max(0, worksList.length - 1);
    function _trimTitle(s, n) {
      s = String(s || '').trim();
      return s.length > n ? s.slice(0, n - 1) + '…' : s;
    }
    let barText;
    // v2.45.87: если сотрудник помечен «помогает сейчас» и есть описание
    // операции (helping_note), показываем сначала «🔨 что делает»
    const helpingNote = (w.helping_note || '').trim();
    const batchIds = w.helping_batch_work_ids || [];
    if (works === 0) {
      barText = 'нет работ';
    } else if (helpingNow && helpingNote) {
      // Шапка с операцией + сколько сборок в батче (если батч)
      const bSuffix = batchIds.length > 1 ? ' ×' + batchIds.length : '';
      const tailModel = primary ? (' · ' + _trimTitle(primary.title || '', 18)) : '';
      barText = '🔨 ' + _trimTitle(helpingNote, 24) + bSuffix + tailModel;
    } else if (primary && primary.title) {
      const prefix = (primary.role === 'help' && mainN === 0) ? 'помогает: ' : '';
      const tail = restCount > 0 ? ' +' + restCount : '';
      barText = prefix + _trimTitle(primary.title, 28) + tail;
    } else if (helpN > 0 && mainN > 0) {
      barText = mainN + ' гл. + ' + helpN + ' пом.';
    } else if (helpN > 0) {
      barText = 'помогает ' + helpN + ' ' + plural(helpN, 'работа', 'работы', 'работ');
    } else {
      barText = mainN + ' ' + plural(mainN, 'работа', 'работы', 'работ');
    }
    // Tooltip с полным списком работ
    let barTooltip;
    if (works === 0) {
      barTooltip = 'Активных работ нет';
    } else if (worksList.length) {
      const lines = worksList.map(x => {
        const role = x.role === 'help' ? '(помощь) ' : '';
        return '• ' + role + (x.title || ('Работа #' + x.id));
      });
      const opLine = helpingNote
        ? 'Прямо сейчас: ' + helpingNote +
          (batchIds.length > 1 ? ' (батч ×' + batchIds.length + ')' : '') + '\n'
        : '';
      barTooltip = opLine + lines.join('\n') + (isEstimated
        ? '\nЧасы оценочные: ' + defHrs + 'ч на работу без указанного времени.'
        : '');
    } else {
      const parts = [];
      if (mainN > 0) parts.push('Главный по ' + mainN + ' ' + plural(mainN, 'работе', 'работам', 'работам'));
      if (helpN > 0) parts.push('Помогает ещё ' + helpN);
      barTooltip = parts.join('. ') + (isEstimated
        ? '. Часы оценочные: ' + defHrs + 'ч на работу без указанного времени.'
        : '');
    }

    const fillWidth = Math.min(100, pct);
    const barEmptyCls = (works === 0) ? ' empty' : '';
    const avatarColorIdx = ((w.employee_id || 0) % 8);
    // v2.43.47: бейдж «сейчас» если сотрудник помечен helping_now_work_id
    // v2.43.51: бейдж кликабельный — открывает текущую работу
    // v2.43.52: бейдж показывает время «СЕЙЧАС · 1ч 23м» (live-обновление)
    const startedAt = w.helping_started_at || '';
    const elapsedFmt = helpingNow && startedAt ? _formatHelpingDuration(startedAt) : '';
    const nowBadgeText = 'СЕЙЧАС' + (elapsedFmt ? ' · ' + elapsedFmt : '');
    const nowBadge = helpingNow
      ? '<span class="pkb-wl-now-badge" data-started-at="' + escapeHtml(startedAt) + '" data-label="СЕЙЧАС" ' +
                  'onclick="event.stopPropagation();openProductionWorkDetail(' + w.helping_now_work_id + ')" ' +
                  'title="Открыть текущую работу">' + nowBadgeText + '</span>'
      : '';
    // v2.45.88: кнопка «Стоп» — снять сотрудника с активной помощи/батча
    // (для мастера/директора). Работает и для одиночной помощи, и для батча.
    const stopBtn = helpingNow
      ? '<button class="pkb-wl-stop-btn" ' +
              'onclick="event.stopPropagation();_stopHelperFromWorkload(' + w.employee_id + ',' + w.helping_now_work_id + ')" ' +
              'title="Остановить помощь (часы запишутся в журнал)">' +
          '<i class="ti ti-player-stop"></i>' +
        '</button>'
      : '';

    html += '<div class="pkb-wl-row" data-employee-id="' + w.employee_id + '" title="' + escapeHtml(w.full_name || name) + '">';
    html +=   '<div class="pkb-wl-avatar ac-' + avatarColorIdx + '">' + escapeHtml(initials) + '</div>';
    html +=   '<div class="pkb-wl-name"><span class="pkb-wl-name-text">' + escapeHtml(name) + '</span>' + nowBadge + stopBtn + '</div>';
    html +=   '<div class="pkb-wl-bar' + barEmptyCls + '" title="' + escapeHtml(barTooltip) + '">';
    if (works > 0) {
      html += '<div class="pkb-wl-bar-fill s-' + status + '" style="width: ' + fillWidth + '%;"></div>';
    }
    html +=   '<div class="pkb-wl-norm-line" title="80% — норма"></div>';
    html +=   '<div class="pkb-wl-bar-text">' + escapeHtml(barText) + '</div>';
    html +=   '</div>';
    html +=   '<div class="pkb-wl-status s-' + status + '">' + escapeHtml(statusLabel) + '</div>';
    html += '</div>';
  });

  html += '</div>';
  return html;
}

function formatHours(h) {
  if (h == null) return '0';
  const n = parseFloat(h);
  if (isNaN(n)) return '0';
  return (n % 1 === 0) ? String(Math.round(n)) : n.toFixed(1);
}

// ============ Stage 29.3: Drag-and-drop между колонками ============

// Активный draggable работ: { workId, fromStatus }
let pkbDrag = null;

function pkbCardDragStart(ev, workId, fromStatus) {
  pkbDrag = { workId: workId, fromStatus: fromStatus };
  try {
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', String(workId));
  } catch (e) {}
  const card = ev.currentTarget;
  if (card && card.classList) card.classList.add('pkb-wc-dragging');
}

function pkbCardDragEnd(ev) {
  const card = ev.currentTarget;
  if (card && card.classList) card.classList.remove('pkb-wc-dragging');
  // На всякий случай — снимаем drop-подсветку со всех колонок
  document.querySelectorAll('.pkb-col.pkb-drop-target').forEach(c =>
    c.classList.remove('pkb-drop-target'));
  pkbDrag = null;
}

function pkbColDragOver(ev) {
  if (!pkbDrag) return; // не наша карточка → пропускаем
  ev.preventDefault();
  try { ev.dataTransfer.dropEffect = 'move'; } catch (e) {}
  const col = ev.currentTarget;
  if (col && col.classList) col.classList.add('pkb-drop-target');
}

function pkbColDragLeave(ev) {
  const col = ev.currentTarget;
  // dragleave срабатывает при переходе на дочерний элемент — фильтруем
  if (col && ev.relatedTarget && col.contains(ev.relatedTarget)) return;
  if (col && col.classList) col.classList.remove('pkb-drop-target');
}

async function pkbColDrop(ev, newStatus) {
  ev.preventDefault();
  const col = ev.currentTarget;
  if (col && col.classList) col.classList.remove('pkb-drop-target');

  if (!pkbDrag) return;
  const workId = pkbDrag.workId;
  const fromStatus = pkbDrag.fromStatus;
  pkbDrag = null;

  if (!workId || newStatus === fromStatus) return;

  // Делаем оптимистичное PATCH, ошибка → откатываем (перерисуем при reload)
  try {
    const r = await apiPatch('/api/production/works/' + workId + '/status', { status: newStatus });
    // v2.43.5 (Этап 34): при переходе в 'done' бэк может автоматически создать assembly
    if (r && r.created_assembly) {
      const ca = r.created_assembly;
      const parts = ['📦 Упаковано'];
      if (ca.model_name) parts.push(escapeHtml(ca.model_name));
      if (ca.quantity && ca.quantity > 1) parts.push('× ' + ca.quantity);
      let msg = parts.join(' · ') + ' — на склад';
      if (ca.contract_number) {
        msg += ', резерв под договор ' + escapeHtml(String(ca.contract_number));
      }
      showToast(msg, 'success');
    } else {
      showToast('Статус обновлён', 'success');
    }
    cache.productionKanban = null;
    cache.assemblies = null;
    cache.stockSummary = null;
    loadProductionDashboard();
  } catch (e) {
    // Скорее всего 409 FSM-нарушение или 403 — показываем сообщение и перезагружаем чтобы вернуть карту
    showToast('Ошибка: ' + (e.message || e), 'error');
    loadProductionDashboard();
  }
}

// v2.43.84: палитра цветов договоров — 12 различимых оттенков, выбираются
// детерминированно по contract_id. Карточки одного договора одного цвета.
const PKB_CONTRACT_PALETTE = [
  '#2563EB', // blue
  '#F97316', // orange
  '#16A34A', // green
  '#A855F7', // purple
  '#D97706', // amber
  '#0891B2', // cyan
  '#DB2777', // pink
  '#7C3AED', // violet
  '#0EA5E9', // sky
  '#059669', // emerald
  '#E11D48', // rose
  '#65A30D', // lime
];
function pkbContractColor(contractId) {
  const id = parseInt(contractId, 10);
  if (!id || isNaN(id)) return '';
  return PKB_CONTRACT_PALETTE[Math.abs(id) % PKB_CONTRACT_PALETTE.length];
}

// ============ v2.45.84: БАТЧ-ПОМОЩЬ ============
// Один сотрудник делает одну операцию (например, дверки) сразу на N сборок.
// Часы при остановке делятся поровну.
let _hbState = null;
async function openHelperBatchModal() {
  const works = (cache.productionKanban && cache.productionKanban.works) || [];
  const inProgress = works.filter(w => w.status === 'in_progress' || w.status === 'queue');
  if (inProgress.length < 2) {
    showToast('Для батча нужно минимум 2 активные сборки (в очереди или в работе)', 'error');
    return;
  }
  // v2.45.86: берём сборщиков из workload (это и есть нужный список цеха).
  // Если workload пустой — фолбэк на /api/employees/active (все активные).
  let emps = [];
  const workers = (cache.productionKanban && cache.productionKanban.workload && cache.productionKanban.workload.workers) || [];
  if (workers.length) {
    emps = workers.map(w => ({
      id: w.employee_id,
      short_name: w.short_name,
      full_name: w.full_name,
    }));
  } else {
    try {
      const d = await apiGet('/api/employees/active');
      const list = Array.isArray(d) ? d : (d.items || []);
      cache.activeEmployees = list;
      emps = list;
    } catch (e) {
      showToast('Не удалось загрузить список сотрудников', 'error');
      return;
    }
  }
  if (!emps.length) {
    showToast('Нет активных сотрудников', 'error');
    return;
  }
  _hbState = {
    employee_id: null,
    selectedWorkIds: new Set(),
    employees: emps,    // храним в state чтобы перерисовка не теряла список
    note: '',           // v2.45.87: что делает (напр. «дверки»)
    loading: false,
  };
  let m = document.getElementById('hb-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'hb-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) m.classList.remove('visible'); };
    document.body.appendChild(m);
  }
  _hbRender(_hbState.employees, inProgress);
  m.classList.add('visible');
}

function _hbRender(emps, works) {
  const m = document.getElementById('hb-modal');
  if (!m) return;
  const s = _hbState;
  const empOpts = '<option value="">— выбрать —</option>' + emps.map(e =>
    '<option value="' + e.id + '"' + (s.employee_id === e.id ? ' selected' : '') + '>' +
    escapeHtml(e.short_name || e.full_name || ('Сотрудник #' + e.id)) + '</option>'
  ).join('');
  const rows = works.map(w => {
    const checked = s.selectedWorkIds.has(w.id) ? 'checked' : '';
    const title = (w.model_name || w.title || ('Работа #' + w.id)).trim();
    const contract = w.contract_number ? (' · ' + w.contract_number) : '';
    const statusBadge = w.status === 'in_progress'
      ? '<span style="font-size:10.5px;background:#FEF3C7;color:#92400E;padding:1px 6px;border-radius:4px;margin-left:6px;">в работе</span>'
      : '<span style="font-size:10.5px;background:#E0F2FE;color:#075985;padding:1px 6px;border-radius:4px;margin-left:6px;">очередь</span>';
    return '<label style="display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-bottom:1px solid #F1F5F9;cursor:pointer;">' +
      '<input type="checkbox" ' + checked + ' onchange="_hbToggleWork(' + w.id + ', this.checked)" ' +
        'style="appearance:auto;-webkit-appearance:auto;width:16px;height:16px;margin-top:2px;accent-color:#0C4A6E;" />' +
      '<div style="flex:1;font-size:13px;">' +
        '<div style="font-weight:500;color:var(--text-dark);">' + escapeHtml(title) + statusBadge + '</div>' +
        '<div style="font-size:11.5px;color:var(--text-light);margin-top:2px;">' +
          'ID:' + w.id + escapeHtml(contract) +
        '</div>' +
      '</div>' +
    '</label>';
  }).join('');
  const n = s.selectedWorkIds.size;
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:560px;max-height:90vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-users-group"></i> Батч-помощь</h3>' +
        '<button class="modal-close" onclick="this.closest(\'.modal-overlay\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:16px 20px;overflow-y:auto;flex:1;">' +
        '<div style="font-size:12.5px;color:var(--text-mid);margin-bottom:14px;line-height:1.5;background:#F0F9FF;border:1px solid #BAE6FD;border-radius:8px;padding:10px 12px;">' +
          '<i class="ti ti-info-circle"></i> Когда сотрудник делает одну операцию сразу на несколько сборок (например, дверки на 3 чиллера). При остановке часы поделятся поровну между сборками.' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">' +
          '<div><label style="font-size:11.5px;color:var(--text-mid);display:block;margin-bottom:4px;">Сотрудник</label>' +
            '<select onchange="_hbSetEmp(this.value)" style="width:100%;font-size:14px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;">' +
            empOpts + '</select></div>' +
          '<div><label style="font-size:11.5px;color:var(--text-mid);display:block;margin-bottom:4px;">Что делает <span style="color:var(--text-light);font-weight:400;">(опц.)</span></label>' +
            '<input type="text" id="hb-note-input" value="' + escapeHtml(s.note) + '" oninput="_hbSetNote(this.value)" placeholder="напр. дверки, сварка" ' +
              'style="width:100%;font-size:14px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;" /></div>' +
        '</div>' +
        '<div style="font-size:11.5px;color:var(--text-mid);text-transform:uppercase;font-weight:600;margin-bottom:6px;">Сборки в батче</div>' +
        '<div style="border:1px solid var(--border);border-radius:8px;max-height:340px;overflow-y:auto;">' +
          rows +
        '</div>' +
        '<div style="font-size:11.5px;color:var(--text-light);margin-top:8px;">Выбрано: <b>' + n + '</b>. Минимум 2.</div>' +
      '</div>' +
      '<div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;background:white;border-radius:0 0 12px 12px;">' +
        '<button class="btn btn-secondary" onclick="this.closest(\'.modal-overlay\').classList.remove(\'visible\')">Отмена</button>' +
        '<button class="btn btn-primary" onclick="_hbStart()" ' +
          ((!s.employee_id || n < 2 || s.loading) ? 'disabled' : '') + '>' +
          (s.loading
            ? '<i class="ti ti-loader-2"></i> Стартуем…'
            : '<i class="ti ti-player-play"></i> Стартовать батч (' + n + ')') +
        '</button>' +
      '</div>' +
    '</div>';
}

function _hbWorks() {
  return (cache.productionKanban && cache.productionKanban.works || [])
    .filter(w => w.status === 'in_progress' || w.status === 'queue');
}
function _hbSetEmp(v) {
  _hbState.employee_id = v ? parseInt(v, 10) : null;
  _hbRender(_hbState.employees || [], _hbWorks());
}
// v2.45.87: пишем в state без перерисовки (чтобы инпут не терял фокус)
function _hbSetNote(v) { _hbState.note = v; }
function _hbToggleWork(wid, on) {
  if (on) _hbState.selectedWorkIds.add(wid);
  else _hbState.selectedWorkIds.delete(wid);
  _hbRender(_hbState.employees || [], _hbWorks());
}

async function _hbStart() {
  if (_hbState.loading) return;
  const empId = _hbState.employee_id;
  const ids = Array.from(_hbState.selectedWorkIds);
  if (!empId || ids.length < 2) return;
  if (!confirm('Стартовать батч-помощь по ' + ids.length + ' сборкам?\n\nЕсли у сотрудника сейчас активна другая помощь — она будет автоматически остановлена и записана в журнал.')) return;
  _hbState.loading = true;
  _hbRender(_hbState.employees || [], _hbWorks());
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/production/helpers/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        employee_id: empId,
        work_ids: ids,
        note: (_hbState.note || '').trim() || null,
      }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || ('HTTP ' + r.status), 'error');
      _hbState.loading = false;
      _hbRender(cache.activeEmployees || [], works);
      return;
    }
    showToast('Батч-помощь стартована: ' + ids.length + ' сборок', 'success');
    document.getElementById('hb-modal').classList.remove('visible');
    cache.productionKanban = null;
    if (typeof loadProductionDashboard === 'function') loadProductionDashboard();
  } catch (e) {
    showToast('Ошибка', 'error');
    _hbState.loading = false;
    _hbRender(_hbState.employees || [], _hbWorks());
  }
}
// ============ /v2.45.84 ============

// v2.45.88: остановить помощь сотрудника прямо из «Загрузки сборщиков».
// Работает и для одиночной помощи, и для батча — бэк делит часы корректно.
async function _stopHelperFromWorkload(employeeId, workId) {
  if (!employeeId || !workId) return;
  // Найдём сотрудника в текущем workload, чтобы в подтверждении было видно
  // имя/операция/размер батча
  let label = 'этого сотрудника';
  let extra = '';
  try {
    const workers = (cache.productionKanban && cache.productionKanban.workload && cache.productionKanban.workload.workers) || [];
    const w = workers.find(x => x.employee_id === employeeId);
    if (w) {
      label = (w.short_name || w.full_name || label);
      const note = (w.helping_note || '').trim();
      const bN = (w.helping_batch_work_ids || []).length;
      if (note) extra += '\nОперация: ' + note;
      if (bN > 1) extra += '\nБатч: ' + bN + ' сборок (часы поделятся поровну)';
    }
  } catch (e) {}
  if (!confirm('Снять «' + label + '» с текущей помощи?\n\n' +
    'Отработанные часы запишутся в журнал.' + extra)) return;
  try {
    await apiDelete('/api/production/works/' + workId + '/helpers/' + employeeId);
    showToast('Снято. Часы записаны в журнал.', 'success');
    cache.productionKanban = null;
    if (typeof loadProductionDashboard === 'function') loadProductionDashboard();
  } catch (e) {
    showToast((e && e.message) || 'Не удалось снять', 'error');
  }
}

function renderPkbWorkCard(w, colKey) {
  const overdueClass = w.is_overdue ? ' b-overdue' : '';
  const isDone = (colKey === 'done');
  const dimCls = isDone ? ' dim' : '';

  // Определение «срочности» дедлайна (для border-left у незавершённых)
  let urgencyClass = '';
  if (!isDone && w.deadline_at && !w.is_overdue) {
    const d = new Date(w.deadline_at);
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const dl = new Date(d); dl.setHours(0,0,0,0);
    if (dl.getTime() === today.getTime()) urgencyClass = ' b-today';
    else if (dl.getTime() === tomorrow.getTime()) urgencyClass = ' b-tomorrow';
  }
  const borderCls = overdueClass || urgencyClass;

  // v2.23.0: DnD — только если есть права на управление и не done с привязанной сборкой
  const canDrag = hasPermission('production.manage');
  const dragAttrs = canDrag
    ? ' draggable="true"' +
      ' ondragstart="pkbCardDragStart(event, ' + w.id + ', \'' + w.status + '\')"' +
      ' ondragend="pkbCardDragEnd(event)"'
    : '';

  // v2.24.0: класс is-blocked для красного border-left если BOM-дефицит
  const blockedCls = (w.is_blocked && colKey !== 'done') ? ' is-blocked' : '';

  // v2.43.33: класс градации по прогрессу — для in_progress карточек,
  // чтобы фон/border становился насыщеннее по мере приближения к 100%
  let progressCls = '';
  if (colKey === 'in_progress' && w.progress != null) {
    const p = Number(w.progress) || 0;
    if (p >= 75)      progressCls = ' p-stage-4';
    else if (p >= 50) progressCls = ' p-stage-3';
    else if (p >= 25) progressCls = ' p-stage-2';
    else if (p > 0)   progressCls = ' p-stage-1';
  }

  // v2.43.84: цвет рамки/точки по contract_id для визуальной группировки в очереди
  const contractColor = pkbContractColor(w.contract_id);
  const contractColorCls = contractColor ? ' has-contract-color' : '';
  const contractColorStyle = contractColor ? ' style="--ck: ' + contractColor + ';"' : '';

  let html = '<div class="pkb-wc' + borderCls + dimCls + blockedCls + progressCls + contractColorCls + '"' +
             ' data-work-id="' + w.id + '"' +
             ' data-work-status="' + escapeHtml(w.status || '') + '"' +
             contractColorStyle +
             dragAttrs +
             ' onclick="openProductionWorkDetail(' + w.id + ')">';

  // Бар срочности или статус-инфо (v2.23.2: оборачиваем в pkb-wc-badges, рядом — бейдж кита)
  let badgesHtml = '';
  if (w.is_overdue) {
    const days = pkbOverdueDays(w.deadline_at);
    badgesHtml += '<div class="pkb-wc-bar b-overdue"><i class="ti ti-alert-triangle"></i>Просрочка ' + (days > 0 ? ('−' + days + ' ' + plural(days, 'день', 'дня', 'дней')) : '') + '</div>';
  } else if (colKey === 'queue' && w.deadline_at) {
    const labelDate = formatPkbDate(w.deadline_at);
    if (urgencyClass === ' b-today') {
      badgesHtml += '<div class="pkb-wc-bar b-today"><i class="ti ti-clock"></i>Срок сегодня</div>';
    } else if (urgencyClass === ' b-tomorrow') {
      badgesHtml += '<div class="pkb-wc-bar b-tomorrow"><i class="ti ti-clock"></i>Срок завтра</div>';
    } else {
      badgesHtml += '<div class="pkb-wc-bar b-deadline"><i class="ti ti-calendar"></i>До ' + escapeHtml(labelDate) + '</div>';
    }
  } else if (colKey === 'in_progress') {
    const startedDays = w.started_at ? pkbDaysSince(w.started_at) : 0;
    const dlStr = w.deadline_at ? (' · до ' + formatPkbDate(w.deadline_at)) : '';
    badgesHtml += '<div class="pkb-wc-bar b-deadline"><i class="ti ti-player-play"></i>' + startedDays + ' ' + plural(startedDays, 'день', 'дня', 'дней') + escapeHtml(dlStr) + '</div>';
  } else if (colKey === 'review') {
    const finStr = w.finished_at ? (' · ' + formatPkbDateTime(w.finished_at)) : '';
    badgesHtml += '<div class="pkb-wc-bar b-deadline"><i class="ti ti-checks"></i>Ждёт ОТК' + escapeHtml(finStr) + '</div>';
  } else if (colKey === 'done') {
    const finStr = w.finished_at ? formatPkbDate(w.finished_at) : '—';
    const hrs = (w.actual_hours != null) ? (' · ' + w.actual_hours + 'ч') : '';
    badgesHtml += '<div class="pkb-wc-bar b-success"><i class="ti ti-circle-check"></i>' + escapeHtml(finStr + hrs) + '</div>';
  }

  // v2.23.2: бейдж комплектности — показывается только когда задан и для не-done колонок
  if (w.kit_status && colKey !== 'done') {
    badgesHtml += renderPkbKitBadge(w.kit_status);
  }

  // v2.24.0 (Stage 30.0): бейдж блокировки по BOM — только для активных колонок
  if (w.is_blocked && colKey !== 'done') {
    badgesHtml += '<div class="pkb-wc-blocked" title="Не хватает критичных компонентов">' +
                    '<i class="ti ti-lock"></i>Нет деталей' +
                  '</div>';
  }

  if (badgesHtml) {
    html += '<div class="pkb-wc-badges">' + badgesHtml + '</div>';
  }

  // Title — название модели или описание для не-сборок (v2.43.78)
  const _wtLabels = {repair:'Ремонт',commissioning:'Пусконаладка',installation:'Монтаж',diagnostics:'Диагностика',design:'Проектирование',maintenance:'ТО',other:'Прочее'};
  const isService = w.work_type && w.work_type !== 'assembly';
  const modelTitle = w.model_name || (isService
    ? (w.description || _wtLabels[w.work_type] || 'Работа')
    : ('Модель #' + (w.model_id || '?')));
  const modelExtra = w.model_extra ? (' ' + w.model_extra) : '';
  const qtyStr = (w.qty && w.qty > 1) ? (' × ' + w.qty) : '';
  let titleHtml = '<div class="pkb-wc-title">' + escapeHtml(modelTitle + modelExtra) + escapeHtml(qtyStr);
  if (isService) {
    titleHtml += ' <span class="work-type-badge wt-' + w.work_type + '" style="margin-left:4px;font-size:10px;">' +
                 escapeHtml(_wtLabels[w.work_type] || w.work_type) + '</span>';
  }
  titleHtml += '</div>';
  html += titleHtml;

  // Sub — договор + клиент
  const subParts = [];
  if (w.contract_number) subParts.push('№' + String(w.contract_number).replace(/^[№#\s]+/, ''));
  if (w.contractor_name) subParts.push(w.contractor_name);
  if (subParts.length) {
    // v2.43.84: точка цвета договора перед текстом
    const dot = contractColor
      ? '<span class="pkb-wc-contract-dot" style="background:' + contractColor + ';"></span>'
      : '';
    html += '<div class="pkb-wc-sub">' + dot + escapeHtml(subParts.join(' · ')) + '</div>';
  }

  // v2.43.97: бейдж часов по этой работе из журнала участия
  const sh = parseFloat(w.session_hours || 0);
  if (sh > 0) {
    const hrsStr = (sh % 1 === 0 ? Math.round(sh) : sh.toFixed(1)) + 'ч';
    html += '<div class="pkb-wc-hours" title="Сумма часов по журналу участия">' +
              '<i class="ti ti-clock-hour-4"></i>' + escapeHtml(hrsStr) +
            '</div>';
  }

  // Прогресс/исполнитель для in_progress
  if (colKey === 'in_progress') {
    const initials = w.assignee_short_name ? getInitials(w.assignee_short_name) : '?';
    const pct = (w.progress != null) ? w.progress : 0;
    // v2.43.33: класс полоски-fill по прогрессу для цветовой градации
    let fillCls = 'p1';
    if      (pct >= 75) fillCls = 'p4';
    else if (pct >= 50) fillCls = 'p3';
    else if (pct >= 25) fillCls = 'p2';
    // v2.43.30: цвет главного аватара по hash от employee_id
    const avColorIdx = ((w.assignee_id || 0) % 8);
    // v2.43.33: иконка «есть комментарий»
    const commentIcon = (w.comment && w.comment.trim())
      ? '<i class="ti ti-message-circle pkb-wc-comment-icon" title="Есть комментарий"></i>'
      : '';
    html += '<div class="pkb-wc-progress">' +
              '<div class="pkb-wc-av ac-' + avColorIdx + '" title="' + escapeHtml(w.assignee_short_name || '—') + '">' + escapeHtml(initials) + '</div>' +
              '<div class="pkb-wc-bar-track"><div class="pkb-wc-bar-fill ' + fillCls + '" style="width: ' + pct + '%"></div></div>' +
              '<div class="pkb-wc-pct">' + pct + '%</div>' +
              commentIcon +
            '</div>';
  } else if (colKey === 'review' || colKey === 'done') {
    if (w.assignee_short_name) {
      const initials = getInitials(w.assignee_short_name);
      const avColorIdx = ((w.assignee_id || 0) % 8);
      const commentIcon = (w.comment && w.comment.trim())
        ? '<i class="ti ti-message-circle pkb-wc-comment-icon" title="Есть комментарий"></i>'
        : '';
      html += '<div class="pkb-wc-meta">' +
                '<div class="pkb-wc-av ac-' + avColorIdx + '" style="display:inline-flex;width:18px;height:18px;border-radius:50%;font-size:9px;font-weight:600;align-items:center;justify-content:center;">' + escapeHtml(initials) + '</div>' +
                escapeHtml(w.assignee_short_name) +
                commentIcon +
              '</div>';
    }
  }

  html += '</div>';
  return html;
}

function pkbOverdueDays(deadlineStr) {
  if (!deadlineStr) return 0;
  const dl = new Date(deadlineStr); dl.setHours(0,0,0,0);
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.max(0, Math.round((today - dl) / (1000 * 60 * 60 * 24)));
}

function pkbDaysSince(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(dateStr); d.setHours(0,0,0,0);
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.max(0, Math.round((today - d) / (1000 * 60 * 60 * 24)));
}

function formatPkbDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return dd + '.' + mm;
}

function formatPkbDateTime(s) {
  const d = (s instanceof Date) ? s : new Date(s);
  if (isNaN(d.getTime())) return String(s || '');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return dd + '.' + mm + ' ' + hh + ':' + mi;
}

// ============ МОДАЛКА ДЕТАЛИ РАБОТЫ ============

// Модалка назначения/смены исполнителя на производственную работу
async function openAssignProductionWorkerModal(workId) {
  const existing = document.getElementById('assign-worker-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'assign-worker-modal';
  overlay.className = 'modal-overlay visible';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML =
    '<div class="modal" style="max-width:440px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-user-plus"></i>Назначить ответственного</h3>' +
        '<button class="icon-btn" onclick="document.getElementById(\'assign-worker-modal\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body" id="assign-worker-body">' +
        '<div class="loading-block">Загружаем сотрудников…</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'assign-worker-modal\').remove()">Отмена</button>' +
        '<button class="btn btn-primary" onclick="submitAssignProductionWorker(' + workId + ')"><i class="ti ti-check"></i>Применить</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  try {
    const w = await apiGet('/api/production/works/' + workId);
    const r = await apiGet('/api/employees/active');
    const employees = (r && r.employees) || [];
    const currentId = w.assignee_id || w.assignee_employee_id || null;
    const body = document.getElementById('assign-worker-body');
    if (!employees.length) {
      body.innerHTML = '<div class="empty-block"><i class="ti ti-user-off"></i>Нет активных сотрудников</div>';
      return;
    }
    let html = '';
    // Опция "Снять назначение"
    html += '<label class="si-mm-card" style="margin-bottom:6px;">' +
              '<input type="radio" name="assign-emp" value=""' + (!currentId ? ' checked' : '') + '>' +
              '<div class="si-mm-card-body">' +
                '<div class="si-mm-card-title" style="color:var(--text-light);"><i class="ti ti-user-off"></i> Не назначен</div>' +
                '<div class="si-mm-card-meta">убрать ответственного с работы</div>' +
              '</div>' +
            '</label>';
    employees.forEach(e => {
      const isMaster = e.is_master || (e.roles || []).indexOf('master') !== -1;
      const checked = (String(e.id) === String(currentId)) ? ' checked' : '';
      const fullName = e.full_name || e.short_name || ('#' + e.id);
      const pos = e.position || '';
      html += '<label class="si-mm-card">' +
                '<input type="radio" name="assign-emp" value="' + e.id + '"' + checked + '>' +
                '<div class="si-mm-card-body">' +
                  '<div class="si-mm-card-title">' + escapeHtml(fullName) + (isMaster ? ' <span style="color:var(--brand);font-size:11px;font-weight:600;">★ мастер</span>' : '') + '</div>' +
                  (pos ? '<div class="si-mm-card-meta">' + escapeHtml(pos) + '</div>' : '') +
                '</div>' +
              '</label>';
    });
    body.innerHTML = html;
  } catch (e) {
    document.getElementById('assign-worker-body').innerHTML =
      '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e.message || e)) + '</div>';
  }
}

async function submitAssignProductionWorker(workId) {
  const overlay = document.getElementById('assign-worker-modal');
  const picked = overlay && overlay.querySelector('input[name="assign-emp"]:checked');
  if (!picked) { showToast('Выберите сотрудника или «Не назначен»', 'error'); return; }
  const val = picked.value;
  const body = { assignee_id: val ? parseInt(val, 10) : null };
  try {
    await apiPatch('/api/production/works/' + workId + '/assign', body);
    overlay.remove();
    showToast(val ? 'Ответственный назначен' : 'Назначение снято', 'success');
    // Перерисуем карточку работы — она открыта поверх
    openProductionWorkDetail(workId);
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

async function openProductionWorkDetail(workId) {
  // Удаляем предыдущую модалку, если осталась
  const existing = document.getElementById('pkb-detail-modal');
  if (existing) existing.remove();

  // Каркас сразу с loading
  const overlay = document.createElement('div');
  overlay.id = 'pkb-detail-modal';
  overlay.className = 'modal-overlay visible pkb-detail-modal';
  overlay.onclick = function(e) { if (e.target === overlay) closeProductionWorkDetail(); };
  overlay.innerHTML =
    '<div class="modal">' +
      '<div class="modal-header">' +
        '<h3>Работа</h3>' +
        '<button class="icon-btn" onclick="closeProductionWorkDetail()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body"><div class="loading-block">Загружаем…</div></div>' +
    '</div>';
  document.body.appendChild(overlay);

  try {
    const w = await apiGet('/api/production/works/' + workId);
    renderProductionWorkDetail(w);
  } catch (e) {
    overlay.querySelector('.modal-body').innerHTML =
      '<div class="empty-block" style="padding:20px;"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e.message || e)) + '</div>';
  }
}

function closeProductionWorkDetail() {
  const m = document.getElementById('pkb-detail-modal');
  if (m) m.remove();
}

async function showProductionWorkQr(workId) {
  try {
    const w = await apiGet('/api/production/works/' + workId);
    let aid = w.assembly_id || w.linked_assembly_id;
    if (!aid) {
      // Создаём связанную запись сборки на лету (status='in_progress' — на склад не пойдёт).
      const r = await apiPost('/api/production/works/' + workId + '/ensure-assembly', {});
      aid = r && r.assembly_id;
      if (!aid) throw new Error('ensure-assembly не вернул id');
      if (r.created) showToast('Запись сборки создана — теперь у работы есть QR', 'info');
    }
    showAssemblyQr(aid, w.model_name || '', w.model_article || '', w.linked_assembly_date || w.finished_at || w.started_at || '');
  } catch (e) {
    showToast('Не удалось получить QR: ' + (e && e.message ? e.message : ''), 'error');
  }
}

function renderProductionWorkDetail(w) {
  const overlay = document.getElementById('pkb-detail-modal');
  if (!overlay) return;
  const modal = overlay.querySelector('.modal');

  // v2.43.78: для не-сборок (Проектирование и т.д.) модели нет — берём описание.
  const _wtLabelsDetail = {repair:'Ремонт',commissioning:'Пусконаладка',installation:'Монтаж',diagnostics:'Диагностика',design:'Проектирование',maintenance:'ТО',other:'Прочее'};
  const _isServiceDetail = w.work_type && w.work_type !== 'assembly';
  const modelTitle = (w.model_name || (_isServiceDetail
    ? (w.description || _wtLabelsDetail[w.work_type] || 'Работа')
    : ('Модель #' + (w.model_id || '?')))) + (w.model_extra ? (' ' + w.model_extra) : '');
  // v2.44.55: для не-сборок «Готово» переименовываем в «Выполнено» (физического приёма нет)
  let statusLabel = w.status_label || w.status || '—';
  if (_isServiceDetail && w.status === 'done') statusLabel = 'Выполнено';
  const statusCls = pkbStatusToCss(w.status);

  let html = '';
  html += '<div class="modal-header">';
  html +=   '<h3>' + escapeHtml(modelTitle) + (w.qty > 1 ? (' × ' + w.qty) : '') + '</h3>';
  html +=   '<span class="pkb-status-chip ' + statusCls + '">' + escapeHtml(statusLabel) + '</span>';
  // v2.43.70: QR-код сборки прямо из карточки работы — нужен на упаковке/проверке,
  // когда изделие физически готово, а до страницы «Сборки» идти неудобно.
  // v2.43.71: кнопка отображается всегда; если у работы ещё нет связанной сборки
  // (assembly_id пустой) — кликом показываем тост вместо тихого ничего.
  html += '<button class="btn-icon-qr" style="margin-right:6px;" onclick="showProductionWorkQr(' + w.id + ')" title="QR-код сборки"><i class="ti ti-qrcode"></i> QR</button>';
  html +=   '<button class="icon-btn" onclick="closeProductionWorkDetail()"><i class="ti ti-x"></i></button>';
  html += '</div>';
  html += '<div class="modal-body">';

  if (w.is_overdue) {
    const days = pkbOverdueDays(w.deadline_at);
    html += '<div class="pkb-form-error" style="margin-bottom:14px;"><i class="ti ti-alert-triangle"></i> Просрочка ' + (days > 0 ? ('−' + days + ' ' + plural(days, 'день', 'дня', 'дней')) : '') + '</div>';
  }

  html += '<dl class="pkb-detail-grid">';
  if (w.contract_number) {
    html += '<dt>Договор</dt><dd>' + formatContractNum(w.contract_number) + (w.contractor_name ? (' · ' + escapeHtml(w.contractor_name)) : '') + '</dd>';
  }
  html += '<dt>Кол-во</dt><dd>' + (w.qty || 1) + ' шт.</dd>';
  if (w.deadline_at) html += '<dt>Срок</dt><dd>' + escapeHtml(formatPkbDate(w.deadline_at)) + '</dd>';
  // Исполнитель — ВСЕГДА показываем строку (даже если не назначен) + кнопка назначить/сменить
  {
    const canAssign = hasPermission('production.manage') && w.status !== 'done' && w.status !== 'cancelled';
    const btnLabel = w.assignee_short_name ? 'Сменить' : 'Назначить';
    const btnIcon  = w.assignee_short_name ? 'ti-user-edit' : 'ti-user-plus';
    const valueText = w.assignee_short_name
      ? escapeHtml(w.assignee_short_name)
      : '<span style="color:var(--text-faint);font-style:italic;">не назначен</span>';
    const btn = canAssign
      ? ' <button class="pkb-btn" style="padding:2px 10px;font-size:11.5px;margin-left:8px;vertical-align:middle;" onclick="openAssignProductionWorkerModal(' + w.id + ')"><i class="ti ' + btnIcon + '" style="font-size:12px;"></i>' + btnLabel + '</button>'
      : '';
    html += '<dt>Ответственный</dt><dd>' + valueText + btn + '</dd>';
  }
  // v2.43.33: соисполнители — кто ещё подключался временно
  {
    const coList = w.co_assignees || [];
    const canEditCo = hasPermission('production.manage') && w.status !== 'done' && w.status !== 'cancelled';
    let coHtml = '';
    if (coList.length) {
      coHtml = coList.map(co => {
        const removeBtn = canEditCo
          ? ' <i class="ti ti-x" style="cursor:pointer;font-size:11px;margin-left:3px;color:var(--text-faint);" title="Убрать" onclick="event.stopPropagation();removePwdCoAssignee(' + w.id + ',' + co.id + ')"></i>'
          : '';
        return '<span class="pwd-co-chip" title="' + escapeHtml(co.full_name || co.short_name) + '">' +
                  escapeHtml(co.short_name || co.full_name || ('#' + co.id)) + removeBtn +
                '</span>';
      }).join(' ');
    } else {
      coHtml = '<span style="color:var(--text-faint);font-style:italic;">никого ещё не подключали</span>';
    }
    const addBtn = canEditCo
      ? ' <button class="pkb-btn" style="padding:2px 10px;font-size:11.5px;margin-left:8px;vertical-align:middle;" onclick="openAddCoAssigneeModal(' + w.id + ')"><i class="ti ti-user-plus" style="font-size:12px;"></i>Подключить</button>'
      : '';
    html += '<dt>Соисполнители</dt><dd>' + coHtml + addBtn + '</dd>';
  }
  if (w.estimated_hours != null) html += '<dt>План часов</dt><dd>' + w.estimated_hours + 'ч</dd>';
  if (w.actual_hours != null) html += '<dt>Факт часов</dt><dd>' + w.actual_hours + 'ч</dd>';
  // v2.43.31: прогресс — показываем всегда (для in_progress в виде редактируемого слайдера ниже)
  if (w.progress != null && w.status !== 'in_progress' && w.status !== 'review' && w.status !== 'packing') {
    html += '<dt>Прогресс</dt><dd>' + w.progress + '%</dd>';
  }
  if (w.execution_type && w.execution_type !== 'standard') html += '<dt>Исполнение</dt><dd>' + escapeHtml(w.execution_type) + '</dd>';
  if (w.ip_rating) html += '<dt>IP</dt><dd>' + escapeHtml(w.ip_rating) + '</dd>';
  if (w.started_at)  html += '<dt>Начато</dt><dd>'    + escapeHtml(formatPkbDateTime(w.started_at)) + '</dd>';
  if (w.finished_at) html += '<dt>Завершено</dt><dd>' + escapeHtml(formatPkbDateTime(w.finished_at)) + '</dd>';
  if (w.description) html += '<dt>Описание</dt><dd style="white-space:pre-wrap;">' + escapeHtml(w.description) + '</dd>';
  html += '</dl>';

  // v2.43.31: блок прогресса с возможностью редактирования (только in_progress/review/packing)
  const canEditWork = hasPermission('production.manage') &&
                      ['in_progress', 'review', 'packing'].includes(w.status);

  // v2.43.47: Toggle «Помогаю сейчас» — для активных работ
  // v2.43.48: добавлена возможность мастеру/директору ставить других + убирать любого
  if (['in_progress', 'review', 'packing'].includes(w.status)) {
    const activeHelpers = w.active_helpers || [];
    const iAmHelping = !!w.i_am_helping_this;
    const canManageHelpers = hasPermission('production.manage');
    html += '<div class="pwd-help-block">';
    html +=   '<div class="pwd-help-head">';
    html +=     '<span><i class="ti ti-hand-stop"></i> Кто работает прямо сейчас</span>';
    html +=     '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
    html +=       '<button class="pwd-help-toggle ' + (iAmHelping ? 'on' : '') + '" onclick="togglePwdHelp(' + w.id + ',' + (iAmHelping ? 'false' : 'true') + ')">' +
                    '<i class="ti ' + (iAmHelping ? 'ti-player-stop-filled' : 'ti-player-play-filled') + '"></i>' +
                    (iAmHelping ? 'Я закончил' : 'Я работаю над этим') +
                  '</button>';
    if (canManageHelpers) {
      html +=     '<button class="pwd-help-add" onclick="openAddHelperModal(' + w.id + ')">' +
                    '<i class="ti ti-user-plus"></i>Добавить' +
                  '</button>';
    }
    html +=     '</div>';
    html +=   '</div>';
    if (activeHelpers.length) {
      html += '<div class="pwd-help-active">';
      activeHelpers.forEach(h => {
        const initials = getInitials(h.short_name || h.full_name || '?');
        const colorIdx = ((h.id || 0) % 8);
        const closeBtn = canManageHelpers
          ? '<span class="pwd-help-chip-x" onclick="event.stopPropagation();removePwdHelper(' + w.id + ',' + h.id + ')" title="Снять"><i class="ti ti-x"></i></span>'
          : '';
        // v2.43.52: live-таймер на чипе
        const startedAt = h.helping_started_at || '';
        const elapsedFmt = startedAt ? _formatHelpingDuration(startedAt) : '';
        const timerHtml = startedAt
          ? '<span class="pwd-help-chip-timer" data-started-at="' + escapeHtml(startedAt) + '" data-label="">' + escapeHtml(elapsedFmt) + '</span>'
          : '';
        // v2.44.70/71: бэдж с этапом — менять может сам сотрудник ИЛИ мастер/директор
        const stageName = h.stage_name || '';
        const isMe = !!h.is_me;
        const canChangeStage = isMe || canManageHelpers;
        const stageClickHandler = canChangeStage
          ? (isMe
              ? 'event.stopPropagation();openChangeMyStage(' + w.id + ')'
              : 'event.stopPropagation();openChangeHelperStage(' + w.id + ',' + h.id + ',\'' + escapeHtml((h.short_name || h.full_name || '').replace(/\\\\/g, '\\\\\\\\').replace(/\'/g, "\\\\'")) + '\')'
            )
          : '';
        const stageHtml = stageName
          ? '<span class="pwd-help-chip-stage" ' +
              (canChangeStage ? ('onclick="' + stageClickHandler + '" title="Сменить этап"') : ('title="' + escapeHtml(stageName) + '"')) +
              '>' + escapeHtml(stageName) + '</span>'
          : (canChangeStage
              ? '<span class="pwd-help-chip-stage empty" onclick="' + stageClickHandler + '" title="Выбрать этап">+ этап</span>'
              : '');
        html += '<span class="pwd-help-chip" title="' + escapeHtml(h.full_name || h.short_name) + '">' +
                  '<span class="pkb-wl-avatar ac-' + colorIdx + '" style="width:22px;height:22px;font-size:9px;border-width:1px;">' + escapeHtml(initials) + '</span>' +
                  escapeHtml(h.short_name || h.full_name || ('#' + h.id)) +
                  stageHtml +
                  timerHtml +
                  closeBtn +
                '</span>';
      });
      html += '</div>';
    } else {
      html += '<div class="pwd-help-empty">Никто сейчас не работает. Нажми «Я работаю над этим» когда возьмёшь работу в руки' +
              (canManageHelpers ? ', или «Добавить» чтобы поставить другого сотрудника.' : '.') + '</div>';
    }
    html += '</div>';
  }

  if (canEditWork || (w.progress != null && ['in_progress', 'review', 'packing'].includes(w.status))) {
    const curPct = Math.max(0, Math.min(100, Number(w.progress || 0)));
    html += '<div class="pwd-progress-block">';
    html +=   '<div class="pwd-progress-head">';
    html +=     '<span><i class="ti ti-progress"></i> Прогресс</span>';
    html +=     '<span class="pwd-progress-value" id="pwd-progress-value">' + curPct + '%</span>';
    html +=   '</div>';
    if (canEditWork) {
      html +=   '<input type="range" min="0" max="100" step="5" value="' + curPct + '" ' +
                'class="pwd-progress-slider" id="pwd-progress-slider" ' +
                'oninput="document.getElementById(\'pwd-progress-value\').textContent = this.value + \'%\'; ' +
                  'document.getElementById(\'pwd-progress-bar-fill\').style.width = this.value + \'%\';" ' +
                'onchange="savePwdProgress(' + w.id + ', this.value)">';
      html +=   '<div class="pwd-progress-presets">';
      [0, 25, 50, 75, 100].forEach(p => {
        html += '<button class="pwd-progress-preset" onclick="pwdSetProgressPreset(' + w.id + ',' + p + ')">' + p + '%</button>';
      });
      html +=   '</div>';
    } else {
      html +=   '<div class="pwd-progress-bar-wrap"><div class="pwd-progress-bar-fill" id="pwd-progress-bar-fill" style="width:' + curPct + '%;"></div></div>';
    }
    html += '</div>';
  }

  // v2.43.31: комментарий сборщика
  if (canEditWork || w.comment) {
    const safeComment = escapeHtml(w.comment || '');
    html += '<div class="pwd-comment-block">';
    html +=   '<div class="pwd-comment-head"><i class="ti ti-message-circle"></i> Комментарий</div>';
    if (canEditWork) {
      html += '<textarea class="pwd-comment-textarea" id="pwd-comment-textarea" rows="3" ' +
                'placeholder="Заметки по работе: где остановился, что ждёт, на что обратить внимание…" ' +
                'oninput="document.getElementById(\'pwd-comment-save\').disabled = (this.value === ' + JSON.stringify(w.comment || '') + ');">' +
              safeComment + '</textarea>';
      html += '<div class="pwd-comment-actions">';
      if (w.comment_updated_at) {
        html += '<span class="pwd-comment-meta">обновлено ' + escapeHtml(formatPkbDateTime(w.comment_updated_at)) + '</span>';
      } else {
        html += '<span></span>';
      }
      html += '<button class="pkb-btn primary" id="pwd-comment-save" disabled onclick="savePwdComment(' + w.id + ')">' +
                '<i class="ti ti-device-floppy"></i> Сохранить</button>';
      html += '</div>';
    } else {
      html += '<div class="pwd-comment-text">' + safeComment.replace(/\n/g, '<br>') + '</div>';
      if (w.comment_updated_at) {
        html += '<div class="pwd-comment-meta">обновлено ' + escapeHtml(formatPkbDateTime(w.comment_updated_at)) + '</div>';
      }
    }
    html += '</div>';
  }

  // v2.45.232: документы модели (схема PDF / файл СП / фото) — чтобы сборщик
  // мог открыть прямо из карточки работы. Заполняется асинхронно.
  if (w.model_id) {
    html += '<div id="pwd-model-docs" data-model-id="' + w.model_id + '" style="display:none;margin:10px 0;"></div>';
  }

  // v2.43.34: журнал участия — список записей «кто, когда, что делал, сколько часов»
  {
    const sessions = w.sessions || [];
    html += '<div class="pwd-sessions-block">';
    html +=   '<div class="pwd-sessions-head">';
    html +=     '<span><i class="ti ti-history"></i> Журнал участия</span>';
    if (canEditWork) {
      html +=   '<button class="pkb-btn" onclick="openAddSessionForm(' + w.id + ')"><i class="ti ti-plus"></i> Добавить запись</button>';
    }
    html +=   '</div>';
    if (!sessions.length) {
      html += '<div class="pwd-sessions-empty">Записей пока нет. Добавь запись чтобы зафиксировать кто и что делал в конкретный день.</div>';
    } else {
      html += '<div class="pwd-sessions-list">';
      sessions.forEach(s => {
        const initials = getInitials(s.employee_short_name || s.employee_full_name || '?');
        const avColorIdx = ((s.employee_id || 0) % 8);
        const dateStr = s.session_date ? formatPkbDate(s.session_date) : '—';
        const hoursStr = (s.hours != null) ? (' · ' + formatHours(s.hours) + 'ч') : '';
        const roleLabel = s.role === 'main' ? 'главный' : 'соисполнитель';
        const roleCls   = s.role === 'main' ? 'pwd-role-main' : 'pwd-role-co';
        const actions = canEditWork
          ? ('<div class="pwd-session-actions">' +
                '<button class="pwd-session-edit" title="Редактировать" onclick="editPwdSession(' + s.id + ',' + w.id + ')"><i class="ti ti-pencil"></i></button>' +
                '<button class="pwd-session-del" title="Удалить запись" onclick="removePwdSession(' + s.id + ',' + w.id + ')"><i class="ti ti-trash"></i></button>' +
              '</div>')
          : '';
        // v2.44.72: бейдж этапа в журнале сессий
        const stageBadge = s.stage_name
          ? ' <span class="pwd-help-chip-stage" style="cursor:default;">' + escapeHtml(s.stage_name) + '</span>'
          : '';
        html += '<div class="pwd-session-row" id="pwd-session-row-' + s.id + '" data-session-id="' + s.id + '" data-session-date="' + escapeHtml(s.session_date || '') + '" data-hours="' + (s.hours != null ? s.hours : '') + '" data-note="' + escapeHtml(s.note || '') + '">' +
                  '<div class="pkb-wl-avatar ac-' + avColorIdx + '" style="width:30px;height:30px;font-size:11px;flex-shrink:0;">' + escapeHtml(initials) + '</div>' +
                  '<div class="pwd-session-body">' +
                    '<div class="pwd-session-top">' +
                      '<span class="pwd-session-name">' + escapeHtml(s.employee_short_name || s.employee_full_name || ('#' + s.employee_id)) +
                        ' <span class="pwd-role-badge ' + roleCls + '">' + roleLabel + '</span>' +
                        stageBadge +
                      '</span>' +
                      '<span class="pwd-session-meta">' + escapeHtml(dateStr + hoursStr) + '</span>' +
                    '</div>' +
                    (s.note ? '<div class="pwd-session-note">' + escapeHtml(s.note) + '</div>' : '') +
                  '</div>' +
                  actions +
                '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
  }

  // v2.23.2 (Stage 29.5): блок выбора комплектности — только для не-done и при наличии прав
  if (w.status !== 'done' && w.status !== 'cancelled' && hasPermission('production.manage')) {
    html += renderPkbKitBlock(w);
  }

  // v2.24.0 (Stage 30.0): блок BOM-дефицита (всегда показывается если has_bom)
  if (w.status !== 'cancelled' && (w.has_bom || (w.missing_components && w.missing_components.length))) {
    html += renderPkbBomBlock(w);
  }

  html += '</div>';

  // Кнопки смены статуса (заменяют DnD до Stage 29.3)
  html += renderPkbDetailActions(w);

  modal.innerHTML = html;
  // v2.45.232: подгружаем документы модели (схема/файл СП/фото)
  if (w.model_id) _fillWorkModelDocs(w.model_id);
}

// v2.45.232: блок «Документы модели» в карточке работы — схема PDF, файл СП, фото
async function _fillWorkModelDocs(modelId) {
  const box = document.getElementById('pwd-model-docs');
  if (!box) return;
  try {
    if (!cache.models) cache.models = await apiGet('/api/models');
    const m = ((cache.models && cache.models.models) || []).find(x => x.id === modelId);
    if (!m) return;
    const btns = [];
    if (m.scheme_file_key) {
      btns.push('<button class="pkb-btn" onclick="downloadModelScheme(' + modelId + ')">' +
        '<i class="ti ti-schema" style="color:#7C3AED;"></i> Схема (PDF)</button>');
    }
    if (m.spec_file_key) {
      btns.push('<button class="pkb-btn" onclick="downloadModelSpec(' + modelId + ')">' +
        '<i class="ti ti-file-text" style="color:var(--brand);"></i> Файл СП</button>');
    }
    if (m.photo_key) {
      btns.push('<button class="pkb-btn" onclick="openModelPhotoBlob(' + modelId + ')">' +
        '<i class="ti ti-photo" style="color:#0E7490;"></i> Фото</button>');
    }
    if (!btns.length) return;
    box.innerHTML =
      '<div style="font-size:12px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:6px;">' +
        '<i class="ti ti-paperclip"></i> Документы модели</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + btns.join('') + '</div>';
    box.style.display = '';
  } catch (e) { /* не критично */ }
}

// v2.45.232: открыть фото модели в новой вкладке (эндпоинт требует Bearer)
async function openModelPhotoBlob(modelId) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/models/' + modelId + '/photo', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) { showToast('Фото не найдено', 'error'); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { showToast('Ошибка открытия фото', 'error'); }
}

function pkbStatusToCss(status) {
  switch (status) {
    case 'queue':       return 's-queue';
    case 'in_progress': return 's-active';
    case 'review':      return 's-review';
    case 'packing':     return 's-packing';
    case 'done':        return 's-done';
    case 'cancelled':   return 's-cancel';
    default:            return 's-queue';
  }
}

// v2.43.52: помощь по таймеру — вспомогательные функции
function _formatHelpingDuration(startedAtIso) {
  if (!startedAtIso) return '';
  // SQLite даёт строку 'YYYY-MM-DD HH:MM:SS' — это UTC. Преобразуем в Date.
  const iso = startedAtIso.includes('T') ? startedAtIso : (startedAtIso.replace(' ', 'T') + 'Z');
  const startMs = Date.parse(iso);
  if (!startMs || isNaN(startMs)) return '';
  const nowMs = Date.now();
  const elapsedMin = Math.max(0, Math.floor((nowMs - startMs) / 60000));
  const lunchMin = _calculateLunchMinutes(startMs, nowMs);
  const workMin = Math.max(0, elapsedMin - lunchMin);
  if (workMin < 1) return 'только что';
  if (workMin < 60) return workMin + 'м';
  const h = Math.floor(workMin / 60);
  const m = workMin % 60;
  return h + 'ч ' + (m > 0 ? m + 'м' : '');
}

function _calculateLunchMinutes(startMs, endMs) {
  const startDate = new Date(startMs);
  const endDate = new Date(endMs);
  let lunchMinutes = 0;
  const day = new Date(startDate);
  day.setHours(0, 0, 0, 0);

  while (day.getTime() <= endDate.getTime()) {
    const lunchStart = new Date(day);
    lunchStart.setHours(12, 0, 0, 0);
    const lunchEnd = new Date(day);
    lunchEnd.setHours(13, 0, 0, 0);

    const overlapStart = Math.max(startMs, lunchStart.getTime());
    const overlapEnd = Math.min(endMs, lunchEnd.getTime());
    if (overlapEnd > overlapStart) {
      lunchMinutes += Math.floor((overlapEnd - overlapStart) / 60000);
    }
    day.setDate(day.getDate() + 1);
  }

  return lunchMinutes;
}

// Глобальный интервал для обновления таймеров каждую минуту
let _helpingTimerInterval = null;
function _startHelpingTimerRefresh() {
  if (_helpingTimerInterval) return;
  _helpingTimerInterval = setInterval(() => {
    // Перерисовываем все DOM-элементы с data-started-at
    document.querySelectorAll('[data-started-at]').forEach(el => {
      const startedAt = el.getAttribute('data-started-at');
      if (startedAt) {
        const fmt = _formatHelpingDuration(startedAt);
        if (el.dataset.label) {
          el.textContent = el.dataset.label + (fmt ? ' · ' + fmt : '');
        } else {
          el.textContent = fmt;
        }
      }
    });
  }, 60000);
}
// Запустить при загрузке (не понадобится остановить — пока страница жива)
_startHelpingTimerRefresh();

// v2.43.47: Toggle «Помогаю сейчас» — POST start-helping или stop-helping
// v2.43.52: при остановке открывает мини-окно «Что делал?» — заметка идёт в журнал
/* === v2.44.70: этапы работы — каталог + пикер === */
async function _loadWorkStages() {
  // Кэшируем на сессию — список меняется редко
  if (cache._workStages) return cache._workStages;
  try {
    const r = await apiGet('/api/work-stages');
    cache._workStages = r.items || [];
  } catch (_) {
    cache._workStages = [];
  }
  return cache._workStages;
}

function _invalidateWorkStagesCache() { cache._workStages = null; }

function openStagePicker({ title, stages, onPick, allowSkip }) {
  const overlayId = 'stage-picker-modal';
  let m = document.getElementById(overlayId);
  if (m) m.remove();
  m = document.createElement('div');
  m.id = overlayId;
  m.className = 'modal-overlay stage-picker-modal';
  const chips = (stages || []).map(s =>
    '<button class="stage-chip" data-stage-id="' + s.id + '">' + escapeHtml(s.name) + '</button>'
  ).join('');
  m.innerHTML =
    '<div class="modal" style="max-width:520px;">' +
      '<div class="modal-header">' +
        '<h2><i class="ti ti-tools"></i> ' + escapeHtml(title || 'Выбери этап') + '</h2>' +
        '<button class="icon-btn" onclick="document.getElementById(\'' + overlayId + '\').remove()">' +
          '<i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content">' +
        '<div class="stage-picker-grid" id="stage-picker-grid">' + chips + '</div>' +
        '<div class="stage-picker-new">' +
          '<input type="text" id="stage-new-name" placeholder="Свой этап — введи и нажми «+»">' +
          '<button class="btn btn-secondary btn-sm" onclick="_stagePickerAddNew()">' +
            '<i class="ti ti-plus"></i></button>' +
        '</div>' +
        (allowSkip !== false
          ? '<button class="dev-link-btn" style="margin-top:10px;" onclick="_stagePickerPick(null)">Пропустить — без этапа</button>'
          : '') +
      '</div>' +
    '</div>';
  document.body.appendChild(m);
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
  m.classList.add('visible');
  // Делегирование клика по чипам
  m.querySelector('#stage-picker-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('.stage-chip');
    if (!btn) return;
    _stagePickerPick(parseInt(btn.dataset.stageId, 10));
  });
  // Сохраним onPick в state модалки
  m._onPick = onPick;
}

function _stagePickerPick(stageId) {
  const m = document.getElementById('stage-picker-modal');
  if (!m) return;
  const cb = m._onPick;
  m.remove();
  if (typeof cb === 'function') cb(stageId);
}

async function _stagePickerAddNew() {
  const input = document.getElementById('stage-new-name');
  const name = (input?.value || '').trim();
  if (!name) return;
  try {
    const r = await apiPost('/api/work-stages', { name });
    _invalidateWorkStagesCache();
    // Сразу пикаем созданный этап
    _stagePickerPick(r.id);
  } catch (e) {
    showToast('Не удалось добавить этап: ' + ((e && e.message) || e), 'error');
  }
}

async function openChangeMyStage(workId) {
  const stages = await _loadWorkStages();
  openStagePicker({
    title: 'Сменить этап',
    stages,
    onPick: async (stageId) => {
      try {
        await apiPost('/api/employees/me/helping-stage', stageId ? { stage_id: stageId } : { stage_id: null });
        const fresh = await apiGet('/api/production/works/' + workId);
        renderProductionWorkDetail(fresh);
      } catch (e) {
        showToast((e && e.message) || 'Ошибка', 'error');
      }
    },
  });
}

async function openChangeHelperStage(workId, employeeId, employeeName) {
  const stages = await _loadWorkStages();
  openStagePicker({
    title: 'Этап для «' + (employeeName || 'сотрудника') + '»',
    stages,
    onPick: async (stageId) => {
      try {
        await apiPost(
          '/api/production/works/' + workId + '/helpers/' + employeeId + '/stage',
          stageId ? { stage_id: stageId } : { stage_id: null },
        );
        const fresh = await apiGet('/api/production/works/' + workId);
        renderProductionWorkDetail(fresh);
      } catch (e) {
        showToast((e && e.message) || 'Ошибка', 'error');
      }
    },
  });
}

async function togglePwdHelp(workId, willStart) {
  const isStart = (willStart === true || willStart === 'true');
  if (isStart) {
    // v2.44.70: спрашиваем какой этап работы
    const stages = await _loadWorkStages();
    openStagePicker({
      title: 'Какой этап ты делаешь?',
      stages,
      onPick: async (stageId) => {
        try {
          await apiPost('/api/production/works/' + workId + '/start-helping',
                        stageId ? { stage_id: stageId } : {});
          showToast('Часики пошли ⏱', 'success');
          const fresh = await apiGet('/api/production/works/' + workId);
          renderProductionWorkDetail(fresh);
          cache.productionKanban = null;
          if (state.currentScreen === 'production-dashboard' && typeof loadProductionDashboard === 'function') {
            loadProductionDashboard();
          }
        } catch (e) {
          showToast((e && e.message) || 'Ошибка', 'error');
        }
      },
    });
    return;
  }
  // v2.45.209: при остановке — простое подтверждение, без повторного вопроса
  // «что делал» (сотрудник уже указал операцию при старте — она и идёт в журнал).
  if (!confirm('Точно закрыть работу?')) return;
  try {
    const r = await apiPost('/api/production/works/' + workId + '/stop-helping', { note: '' });
    const mins = (r && r.minutes) || 0;
    if (mins > 0) {
      const fmtMin = mins < 60 ? (mins + ' мин') : (Math.floor(mins/60) + 'ч ' + (mins%60) + 'м');
      showToast('Записано в журнал: ' + fmtMin, 'success');
    } else {
      showToast('Закончил (меньше 5 мин — в журнал не пошло)', 'info');
    }
    const fresh = await apiGet('/api/production/works/' + workId);
    renderProductionWorkDetail(fresh);
    cache.productionKanban = null;
    if (state.currentScreen === 'production-dashboard' && typeof loadProductionDashboard === 'function') {
      loadProductionDashboard();
    }
  } catch (e) {
    showToast((e && e.message) || 'Ошибка', 'error');
  }
}

// v2.43.52: мини-окно с заметкой при остановке таймера
function openStopHelpDialog(opts) {
  const { workId, elapsedLabel, workTitle, onConfirm } = opts || {};
  let modal = document.getElementById('stop-help-modal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'stop-help-modal';
  modal.className = 'modal-overlay visible';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  const elapsedText = elapsedLabel ? ('<b>' + escapeHtml(elapsedLabel) + '</b>') : '';
  modal.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:440px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-player-stop-filled" style="color:#B91C1C;"></i> Закончил работу</h3>' +
        '<button class="icon-btn" onclick="document.getElementById(\'stop-help-modal\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body" style="padding:14px 18px 18px;">' +
        (elapsedText
          ? '<div style="font-size:13px;color:var(--text-dark);margin-bottom:12px;">Ты работал ' + elapsedText +
            (workTitle ? ' над <b>' + escapeHtml(workTitle) + '</b>' : '') + '. Запишем в журнал.</div>'
          : '<div style="font-size:13px;color:var(--text-dark);margin-bottom:12px;">Запишем в журнал. Что делал?</div>') +
        '<label style="display:block;font-size:12px;color:var(--text-light);margin-bottom:4px;font-weight:600;">Что делал? (необязательно)</label>' +
        '<textarea id="stop-help-note" rows="3" placeholder="Например: Делал подставку из профиля 40х20" ' +
                  'style="width:100%;padding:8px 10px;border:1px solid var(--border-strong);border-radius:8px;font-size:13px;font-family:inherit;resize:vertical;"></textarea>' +
        '<div style="display:flex;gap:8px;margin-top:14px;">' +
          '<button class="btn btn-secondary" onclick="document.getElementById(\'stop-help-modal\').remove();_stopHelpConfirm(\'\')" style="flex:1;">Без заметки</button>' +
          '<button class="btn btn-primary"   onclick="_stopHelpConfirm(document.getElementById(\'stop-help-note\').value || \'\')" style="flex:1.5;"><i class="ti ti-check"></i> Сохранить</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  // Стейт callback для кнопок (через глобальный — простой способ)
  window._stopHelpConfirm = (noteVal) => {
    const m = document.getElementById('stop-help-modal');
    if (m) m.remove();
    if (typeof onConfirm === 'function') onConfirm(noteVal);
    window._stopHelpConfirm = null;
  };
  setTimeout(() => { const t = document.getElementById('stop-help-note'); if (t) t.focus(); }, 50);
}

// v2.43.48: добавить ВРУЧНУЮ сотрудника в «работает сейчас» (мастер/директор)
// v2.45.118: используем /api/employees/active (доступен любому залогиненному)
// вместо /api/employees — тот требует @require_director, и для Иванова
// возвращает 403 → «Не удалось загрузить сотрудников».
async function openAddHelperModal(workId) {
  let employees = [];
  try {
    const d = await apiGet('/api/employees/active');
    employees = (d.items || d.employees || []).filter(e => e.is_active !== false);
  } catch (e) {
    showToast('Не удалось загрузить сотрудников', 'error');
    return;
  }
  let w = null;
  try { w = await apiGet('/api/production/works/' + workId); } catch (e) {}
  // Исключаем тех кто уже активно помогает этой работе
  const excluded = new Set();
  (w && w.active_helpers || []).forEach(h => excluded.add(h.id));
  const candidates = employees.filter(e => !excluded.has(e.id));
  if (!candidates.length) {
    showToast('Все сотрудники уже работают над этой задачей', 'success');
    return;
  }
  let modal = document.getElementById('pwd-add-helper-modal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'pwd-add-helper-modal';
  modal.className = 'modal-overlay visible pkb-form-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  const listHtml = candidates.map(e => {
    const initials = getInitials(e.short_name || e.full_name || '?');
    const colorIdx = (e.id || 0) % 8;
    return '<button class="pwd-co-pick-row" onclick="addPwdHelper(' + workId + ',' + e.id + ')">' +
              '<div class="pkb-wl-avatar ac-' + colorIdx + '" style="width:30px;height:30px;font-size:11px;">' + escapeHtml(initials) + '</div>' +
              '<div style="flex:1;text-align:left;">' +
                '<div style="font-weight:500;">' + escapeHtml(e.short_name || e.full_name || ('#' + e.id)) + '</div>' +
                (e.full_name && e.short_name !== e.full_name ? '<div style="font-size:11px;color:var(--text-light);">' + escapeHtml(e.full_name) + '</div>' : '') +
              '</div>' +
            '</button>';
  }).join('');
  modal.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:420px;max-height:80vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-hand-stop"></i> Кто сейчас работает?</h3>' +
        '<button class="icon-btn" onclick="document.getElementById(\'pwd-add-helper-modal\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body" style="overflow-y:auto;">' +
        '<div style="font-size:12.5px;color:var(--text-light);margin-bottom:10px;">' +
          'Выбери сотрудника — он будет помечен как активно работающий над этой задачей. Если у него уже была другая работа в статусе «сейчас» — она автоматически снимется.' +
        '</div>' +
        listHtml +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
}

async function addPwdHelper(workId, employeeId) {
  // v2.44.70: после выбора сотрудника просим выбрать этап
  const stages = await _loadWorkStages();
  // Закроем модалку выбора сотрудника
  const empModal = document.getElementById('pwd-add-helper-modal');
  if (empModal) empModal.remove();
  openStagePicker({
    title: 'Какой этап будет делать?',
    stages,
    onPick: async (stageId) => {
      try {
        await apiPost('/api/production/works/' + workId + '/helpers', {
          employee_id: employeeId,
          ...(stageId ? { stage_id: stageId } : {}),
        });
        showToast('Сотрудник назначен', 'success');
        const fresh = await apiGet('/api/production/works/' + workId);
        renderProductionWorkDetail(fresh);
        cache.productionKanban = null;
        if (state.currentScreen === 'production-dashboard' && typeof loadProductionDashboard === 'function') {
          loadProductionDashboard();
        }
      } catch (e) {
        showToast((e && e.message) || 'Ошибка', 'error');
      }
    },
  });
}

async function removePwdHelper(workId, employeeId) {
  // v2.43.52: вытаскиваем started_at и имя для отображения
  let elapsedLabel = '';
  let empName = '';
  try {
    const w = await apiGet('/api/production/works/' + workId);
    const helper = (w && w.active_helpers || []).find(h => h.id === employeeId);
    if (helper) {
      elapsedLabel = _formatHelpingDuration(helper.helping_started_at);
      empName = helper.short_name || helper.full_name || ('#' + employeeId);
    }
  } catch (e) {}
  openStopHelpDialog({
    workId,
    elapsedLabel,
    workTitle: empName ? ('сотрудника ' + empName) : '',
    onConfirm: async (note) => {
      try {
        // DELETE с телом — некоторые серверы не позволяют, но aiohttp принимает
        const r = await apiCall('DELETE', '/api/production/works/' + workId + '/helpers/' + employeeId, { note: note || '' });
        const mins = (r && r.minutes) || 0;
        if (mins > 0) {
          const fmtMin = mins < 60 ? (mins + ' мин') : (Math.floor(mins/60) + 'ч ' + (mins%60) + 'м');
          showToast('Снято · в журнал: ' + fmtMin, 'success');
        } else {
          showToast('Снято', 'success');
        }
        const fresh = await apiGet('/api/production/works/' + workId);
        renderProductionWorkDetail(fresh);
        cache.productionKanban = null;
        if (state.currentScreen === 'production-dashboard' && typeof loadProductionDashboard === 'function') {
          loadProductionDashboard();
        }
      } catch (e) {
        showToast((e && e.message) || 'Ошибка', 'error');
      }
    },
  });
}

// v2.43.31: сохранение прогресса (слайдер onchange / preset onclick)
async function savePwdProgress(workId, value) {
  try {
    const v = Math.max(0, Math.min(100, parseInt(value, 10) || 0));
    await apiPatch('/api/production/works/' + workId + '/progress', { progress: v });
    // v2.43.33: сбрасываем кэш И перерисовываем kanban — чтобы прогресс
    // обновился на карточке без необходимости F5
    cache.productionKanban = null;
    if (state.currentScreen === 'production-dashboard' && typeof loadProductionDashboard === 'function') {
      loadProductionDashboard();
    }
  } catch (e) {
    showToast((e && e.message) || 'Ошибка сохранения прогресса', 'error');
  }
}

function pwdSetProgressPreset(workId, pct) {
  const slider = document.getElementById('pwd-progress-slider');
  const valueEl = document.getElementById('pwd-progress-value');
  if (slider) slider.value = pct;
  if (valueEl) valueEl.textContent = pct + '%';
  savePwdProgress(workId, pct);
}

// v2.43.33: соисполнители — добавление через модалку выбора сотрудника
async function openAddCoAssigneeModal(workId) {
  // v2.45.118: /api/employees/active вместо /api/employees (не требует director)
  let employees = [];
  try {
    const d = await apiGet('/api/employees/active');
    employees = (d.items || d.employees || []).filter(e => e.is_active !== false);
  } catch (e) {
    showToast('Не удалось загрузить сотрудников', 'error');
    return;
  }
  // Получаем работу чтобы исключить уже добавленных
  let w = null;
  try { w = await apiGet('/api/production/works/' + workId); } catch (e) {}
  const excluded = new Set();
  if (w) {
    if (w.assignee_id) excluded.add(w.assignee_id);
    (w.co_assignees || []).forEach(c => excluded.add(c.id));
  }
  const candidates = employees.filter(e => !excluded.has(e.id));
  if (!candidates.length) {
    showToast('Все сотрудники уже подключены', 'success');
    return;
  }
  // Простая модалка-список
  let modal = document.getElementById('pwd-add-co-modal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'pwd-add-co-modal';
  modal.className = 'modal-overlay visible pkb-form-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  let listHtml = candidates.map(e => {
    const initials = getInitials(e.short_name || e.full_name || '?');
    const colorIdx = (e.id || 0) % 8;
    return '<button class="pwd-co-pick-row" onclick="addPwdCoAssignee(' + workId + ',' + e.id + ')">' +
              '<div class="pkb-wl-avatar ac-' + colorIdx + '" style="width:30px;height:30px;font-size:11px;">' + escapeHtml(initials) + '</div>' +
              '<div style="flex:1;text-align:left;">' +
                '<div style="font-weight:500;">' + escapeHtml(e.short_name || e.full_name || ('#' + e.id)) + '</div>' +
                (e.full_name && e.short_name !== e.full_name ? '<div style="font-size:11px;color:var(--text-light);">' + escapeHtml(e.full_name) + '</div>' : '') +
              '</div>' +
            '</button>';
  }).join('');
  modal.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:420px;max-height:80vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-user-plus"></i> Подключить соисполнителя</h3>' +
        '<button class="icon-btn" onclick="document.getElementById(\'pwd-add-co-modal\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body" style="overflow-y:auto;">' + listHtml + '</div>' +
    '</div>';
  document.body.appendChild(modal);
}

async function addPwdCoAssignee(workId, employeeId) {
  try {
    await apiPost('/api/production/works/' + workId + '/co-assignees', { employee_id: employeeId });
    showToast('Подключён к работе', 'success');
    const modal = document.getElementById('pwd-add-co-modal');
    if (modal) modal.remove();
    const fresh = await apiGet('/api/production/works/' + workId);
    renderProductionWorkDetail(fresh);
    cache.productionKanban = null;
    if (state.currentScreen === 'production-dashboard' && typeof loadProductionDashboard === 'function') {
      loadProductionDashboard();
    }
  } catch (e) {
    showToast((e && e.message) || 'Ошибка', 'error');
  }
}

async function removePwdCoAssignee(workId, employeeId) {
  if (!confirm('Убрать соисполнителя?')) return;
  try {
    await apiDelete('/api/production/works/' + workId + '/co-assignees/' + employeeId);
    showToast('Убран', 'success');
    const fresh = await apiGet('/api/production/works/' + workId);
    renderProductionWorkDetail(fresh);
    cache.productionKanban = null;
    if (state.currentScreen === 'production-dashboard' && typeof loadProductionDashboard === 'function') {
      loadProductionDashboard();
    }
  } catch (e) {
    showToast((e && e.message) || 'Ошибка', 'error');
  }
}

// v2.43.34: журнал участия — модалка для добавления новой записи
async function openAddSessionForm(workId) {
  // v2.45.118: /api/employees/active вместо /api/employees (не требует director)
  let employees = [];
  try {
    const d = await apiGet('/api/employees/active');
    employees = (d.items || d.employees || []).filter(e => e.is_active !== false);
  } catch (e) {
    showToast('Не удалось загрузить сотрудников', 'error');
    return;
  }
  // Дефолтный employee — главный исполнитель работы (если есть)
  let defaultEmpId = '';
  try {
    const w = await apiGet('/api/production/works/' + workId);
    if (w && w.assignee_id) defaultEmpId = w.assignee_id;
  } catch (e) {}

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  let modal = document.getElementById('pwd-add-session-modal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'pwd-add-session-modal';
  modal.className = 'modal-overlay visible pkb-form-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  const empOptions = employees.map(e =>
    '<option value="' + e.id + '"' + (e.id === defaultEmpId ? ' selected' : '') + '>' +
      escapeHtml(e.short_name || e.full_name || ('#' + e.id)) +
    '</option>'
  ).join('');

  modal.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:460px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-history"></i> Запись в журнал</h3>' +
        '<button class="icon-btn" onclick="document.getElementById(\'pwd-add-session-modal\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="pkb-field">' +
          '<label>Сотрудник</label>' +
          '<select id="pwd-ses-emp">' + empOptions + '</select>' +
        '</div>' +
        '<div class="pkb-field-row">' +
          '<div class="pkb-field">' +
            '<label>Дата</label>' +
            '<input type="date" id="pwd-ses-date" value="' + todayStr + '">' +
          '</div>' +
          '<div class="pkb-field">' +
            '<label>Часы</label>' +
            '<input type="number" id="pwd-ses-hours" step="0.5" min="0" max="24" placeholder="—">' +
          '</div>' +
        '</div>' +
        '<div class="pkb-field">' +
          '<label>Что делал</label>' +
          '<textarea id="pwd-ses-note" rows="3" placeholder="Например: «собрал раму, монтаж насоса»"></textarea>' +
        '</div>' +
        '<div class="pkb-form-actions">' +
          '<button class="pkb-btn" onclick="document.getElementById(\'pwd-add-session-modal\').remove()">Отмена</button>' +
          '<button class="pkb-btn primary" onclick="savePwdSession(' + workId + ')"><i class="ti ti-device-floppy"></i> Сохранить</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
}

async function savePwdSession(workId) {
  const empEl = document.getElementById('pwd-ses-emp');
  const dateEl = document.getElementById('pwd-ses-date');
  const hoursEl = document.getElementById('pwd-ses-hours');
  const noteEl = document.getElementById('pwd-ses-note');
  if (!empEl || !dateEl) return;
  const empId = parseInt(empEl.value, 10);
  const date = (dateEl.value || '').trim();
  const hours = hoursEl && hoursEl.value !== '' ? parseFloat(hoursEl.value) : null;
  const note = noteEl ? noteEl.value : '';
  if (!empId || !date) {
    showToast('Укажите сотрудника и дату', 'error');
    return;
  }
  try {
    await apiPost('/api/production/works/' + workId + '/sessions', {
      employee_id: empId,
      session_date: date,
      hours: hours,
      note: note,
    });
    showToast('Запись сохранена', 'success');
    const modal = document.getElementById('pwd-add-session-modal');
    if (modal) modal.remove();
    const fresh = await apiGet('/api/production/works/' + workId);
    renderProductionWorkDetail(fresh);
    cache.productionKanban = null;
  } catch (e) {
    showToast((e && e.message) || 'Ошибка', 'error');
  }
}

async function removePwdSession(sessionId, workId) {
  if (!confirm('Удалить запись из журнала?')) return;
  try {
    await apiDelete('/api/production/work-sessions/' + sessionId);
    showToast('Удалено', 'success');
    const fresh = await apiGet('/api/production/works/' + workId);
    renderProductionWorkDetail(fresh);
  } catch (e) {
    showToast((e && e.message) || 'Ошибка', 'error');
  }
}

// v2.43.38: редактирование записи журнала (часы / заметка / дата) inline
function editPwdSession(sessionId, workId) {
  const row = document.getElementById('pwd-session-row-' + sessionId);
  if (!row) return;
  const curDate  = row.getAttribute('data-session-date') || '';
  const curHours = row.getAttribute('data-hours') || '';
  const curNote  = row.getAttribute('data-note') || '';
  row.classList.add('pwd-session-editing');
  row.innerHTML =
    '<div class="pwd-session-body" style="flex:1;">' +
      '<div class="pwd-session-edit-grid">' +
        '<div><label>Дата</label><input type="date" id="pwd-es-date-' + sessionId + '" value="' + escapeHtml(curDate) + '"></div>' +
        '<div><label>Часы</label><input type="number" id="pwd-es-hours-' + sessionId + '" step="0.5" min="0" max="24" value="' + escapeHtml(curHours) + '"></div>' +
      '</div>' +
      '<label style="font-size:11px;color:var(--text-light);margin-top:6px;display:block;">Что делал</label>' +
      '<textarea id="pwd-es-note-' + sessionId + '" rows="2" class="pwd-session-edit-note">' + escapeHtml(curNote) + '</textarea>' +
      '<div class="pwd-session-edit-actions">' +
        '<button class="pkb-btn" onclick="cancelEditPwdSession(' + sessionId + ',' + workId + ')">Отмена</button>' +
        '<button class="pkb-btn primary" onclick="saveEditedPwdSession(' + sessionId + ',' + workId + ')"><i class="ti ti-device-floppy"></i> Сохранить</button>' +
      '</div>' +
    '</div>';
}

async function saveEditedPwdSession(sessionId, workId) {
  const dateEl  = document.getElementById('pwd-es-date-' + sessionId);
  const hoursEl = document.getElementById('pwd-es-hours-' + sessionId);
  const noteEl  = document.getElementById('pwd-es-note-' + sessionId);
  if (!dateEl) return;
  const body = {
    session_date: (dateEl.value || '').trim(),
    hours:        hoursEl && hoursEl.value !== '' ? parseFloat(hoursEl.value) : null,
    note:         noteEl ? noteEl.value : '',
  };
  try {
    await apiPatch('/api/production/work-sessions/' + sessionId, body);
    showToast('Запись обновлена', 'success');
    const fresh = await apiGet('/api/production/works/' + workId);
    renderProductionWorkDetail(fresh);
  } catch (e) {
    showToast((e && e.message) || 'Ошибка', 'error');
  }
}

async function cancelEditPwdSession(sessionId, workId) {
  // Просто перезагружаем модалку — отменяет редактирование на исходную
  try {
    const fresh = await apiGet('/api/production/works/' + workId);
    renderProductionWorkDetail(fresh);
  } catch (e) {}
}

// v2.43.31: сохранение комментария по кнопке «Сохранить»
async function savePwdComment(workId) {
  const ta = document.getElementById('pwd-comment-textarea');
  if (!ta) return;
  const value = ta.value;
  const btn = document.getElementById('pwd-comment-save');
  if (btn) btn.disabled = true;
  try {
    await apiPatch('/api/production/works/' + workId + '/comment', { comment: value });
    showToast('Комментарий сохранён', 'success');
    // Перерисовываем модалку чтобы обновился штамп «обновлено …»
    const fresh = await apiGet('/api/production/works/' + workId);
    renderProductionWorkDetail(fresh);
    // v2.43.33: перерисовываем kanban — на карточке появится иконка «есть коммент»
    cache.productionKanban = null;
    if (state.currentScreen === 'production-dashboard' && typeof loadProductionDashboard === 'function') {
      loadProductionDashboard();
    }
  } catch (e) {
    if (btn) btn.disabled = false;
    showToast((e && e.message) || 'Ошибка сохранения', 'error');
  }
}

function renderPkbDetailActions(w) {
  // Подсчёт допустимых переходов из FSM:
  //   queue       → in_progress, cancelled
  //   in_progress → queue, review, done, cancelled
  //   review      → in_progress, done, cancelled
  //   done        → review
  //   cancelled   → queue
  // v2.34.2: добавлен этап «упаковка»
  //   queue       → in_progress, cancelled
  //   in_progress → queue, review, packing, done, cancelled
  //   review      → in_progress, packing, done, cancelled
  //   packing     → review, done, cancelled
  //   done        → review, packing
  //   cancelled   → queue
  // v2.44.55: для работ-сервисов (проектирование/ремонт/пусконаладка/ТО и т.п.)
  // нет физической упаковки/проверки — упрощённая FSM: queue ↔ in_progress → done.
  const isService = w.work_type && w.work_type !== 'assembly';
  let transitions;
  if (isService) {
    transitions = {
      queue:       [{ to: 'in_progress', label: 'Взять в работу', icon: 'ti-player-play', cls: 'primary' },
                    { to: 'cancelled',   label: 'Отменить',       icon: 'ti-x' }],
      in_progress: [{ to: 'done',        label: 'Сделано',        icon: 'ti-circle-check', cls: 'primary' },
                    { to: 'queue',       label: 'Вернуть в очередь', icon: 'ti-arrow-back-up' },
                    { to: 'cancelled',   label: 'Отменить',       icon: 'ti-x' }],
      review:      [{ to: 'done',        label: 'Сделано',        icon: 'ti-circle-check', cls: 'primary' },
                    { to: 'in_progress', label: 'Вернуть в работу', icon: 'ti-arrow-back-up' }],
      packing:     [{ to: 'done',        label: 'Сделано',        icon: 'ti-circle-check', cls: 'primary' },
                    { to: 'in_progress', label: 'Вернуть в работу', icon: 'ti-arrow-back-up' }],
      done:        [{ to: 'in_progress', label: 'Вернуть в работу', icon: 'ti-arrow-back-up' }],
      cancelled:   [{ to: 'queue',       label: 'Реактивировать', icon: 'ti-refresh' }],
    };
  } else {
    transitions = {
      queue:       [{ to: 'in_progress', label: 'Взять в работу', icon: 'ti-player-play', cls: 'primary' },
                    { to: 'cancelled',   label: 'Отменить',       icon: 'ti-x' }],
      in_progress: [{ to: 'review',      label: 'На проверку',    icon: 'ti-checks', cls: 'primary' },
                    { to: 'packing',     label: 'На упаковку',    icon: 'ti-package' },
                    { to: 'queue',       label: 'Вернуть в очередь', icon: 'ti-arrow-back-up' },
                    { to: 'cancelled',   label: 'Отменить',       icon: 'ti-x' }],
      review:      [{ to: 'packing',     label: 'На упаковку',    icon: 'ti-package', cls: 'primary' },
                    { to: 'done',        label: 'Принять (Готово)', icon: 'ti-circle-check' },
                    { to: 'in_progress', label: 'Вернуть в работу', icon: 'ti-arrow-back-up' }],
      packing:     [{ to: 'done',        label: 'Упаковано (Готово)', icon: 'ti-circle-check', cls: 'primary' },
                    { to: 'review',      label: 'Вернуть на проверку', icon: 'ti-arrow-back-up' }],
      done:        [{ to: 'packing',     label: 'На упаковку',    icon: 'ti-package' },
                    { to: 'review',      label: 'Откатить (ОТК)', icon: 'ti-arrow-back-up' }],
      cancelled:   [{ to: 'queue',       label: 'Реактивировать', icon: 'ti-refresh' }],
    };
  }
  const allowed = transitions[w.status] || [];
  if (allowed.length === 0) return '';
  // Без прав на управление — только показ, никаких кнопок
  if (!hasPermission('production.manage')) return '';

  let html = '<div class="pkb-detail-actions">';
  allowed.forEach(t => {
    const cls = (t.cls === 'primary') ? 'pkb-btn primary' : 'pkb-btn';
    html += '<button class="' + cls + '" onclick="changeProductionWorkStatus(' + w.id + ', \'' + t.to + '\')">' +
              '<i class="ti ' + t.icon + '"></i>' + escapeHtml(t.label) +
            '</button>';
  });
  // Кнопка удалить — только для не-done или done без assembly_id
  if (w.status !== 'done' || !w.assembly_id) {
    html += '<button class="pkb-btn" style="margin-left:auto;color:#8C2A2A;" onclick="deleteProductionWork(' + w.id + ')">' +
              '<i class="ti ti-trash"></i>Удалить' +
            '</button>';
  }
  html += '</div>';
  return html;
}

async function changeProductionWorkStatus(workId, newStatus) {
  // v2.45.153: подтверждение при завершении работы (перевод в «Готово»)
  if (newStatus === 'done') {
    if (!confirm('Завершить работу и перевести в «Готово»?\n\nЕсли это сборка — появится приход на склад.')) return;
  }
  try {
    const r = await apiPatch('/api/production/works/' + workId + '/status', { status: newStatus });
    // v2.43.5 (Этап 34): при переходе в 'done' бэк может автоматически создать assembly
    if (r && r.created_assembly) {
      const ca = r.created_assembly;
      const parts = [];
      parts.push('📦 Упаковано');
      if (ca.model_name) parts.push(escapeHtml(ca.model_name));
      if (ca.quantity && ca.quantity > 1) parts.push('× ' + ca.quantity);
      let msg = parts.join(' · ') + ' — на склад';
      if (ca.contract_number) {
        msg += ', резерв под договор ' + escapeHtml(String(ca.contract_number));
      }
      showToast(msg, 'success');
    } else {
      showToast('Статус обновлён', 'success');
    }
    closeProductionWorkDetail();
    cache.productionKanban = null;
    cache.assemblies = null;       // на складе появилась новая сборка — сбросим кеш
    cache.stockSummary = null;     // итоги склада тоже
    loadProductionDashboard();
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

// v2.23.2 (Stage 29.5): блок выбора комплектности в модалке детали
function renderPkbKitBlock(w) {
  const current = w.kit_status || null;
  const options = [
    { key: 'ready',   icon: 'ti-package-check', label: 'Комплект' },
    { key: 'partial', icon: 'ti-package',       label: 'Частично' },
    { key: 'missing', icon: 'ti-package-off',   label: 'Нет деталей' },
    { key: null,      icon: 'ti-eraser',        label: 'Снять отметку', noneClass: 'k-none' },
  ];
  let html = '<div class="pkb-kit-block">';
  html +=   '<div class="pkb-kit-block-title">Комплектность</div>';
  html +=   '<div class="pkb-kit-options">';
  options.forEach(o => {
    const isActive = (o.key === current) || (o.key === null && !current);
    const cls = 'pkb-kit-opt ' +
                (o.key ? ('k-' + o.key) : (o.noneClass || 'k-none')) +
                (isActive ? ' active' : '');
    const arg = o.key ? ("'" + o.key + "'") : 'null';
    html += '<button class="' + cls + '" onclick="setProductionWorkKitStatus(' + w.id + ', ' + arg + ')">' +
              '<i class="ti ' + o.icon + '"></i>' + escapeHtml(o.label) +
            '</button>';
  });
  html +=   '</div>';
  if (w.kit_set_at) {
    html += '<div class="pkb-kit-meta">отмечено ' + escapeHtml(formatPkbDateTime(w.kit_set_at)) + '</div>';
  }
  html += '</div>';
  return html;
}

async function setProductionWorkKitStatus(workId, kitStatus) {
  try {
    await apiPatch('/api/production/works/' + workId + '/kit-status', { kit_status: kitStatus });
    showToast(kitStatus
      ? ('Комплектность: ' + (pkbKitDef(kitStatus) || {}).label)
      : 'Отметка снята', 'success');
    // Не закрываем модалку — обновляем её содержимое + перечитываем канбан в фоне
    try {
      const fresh = await apiGet('/api/production/works/' + workId);
      renderProductionWorkDetail(fresh);
    } catch (e) {}
    cache.productionKanban = null;
    loadProductionDashboard();
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

// ============ v2.24.0 (Stage 30.0): BOM-блок в модалке деталей ============

function renderPkbBomBlock(w) {
  const missing = w.missing_components || [];
  const hasBom = w.has_bom;

  // Нет BOM у модели — выводим информационное сообщение
  if (!hasBom && missing.length === 0) {
    return '<div class="pkb-bom-block no-bom">' +
             '<div class="pkb-bom-title"><i class="ti ti-info-circle"></i>Спецификация модели не задана</div>' +
             '<div style="font-size:11.5px;color:var(--text-light);">Чтобы автоматически отслеживать дефицит компонентов, заполните BOM модели в справочнике.</div>' +
           '</div>';
  }

  // BOM есть и нет дефицита — всё хорошо
  if (missing.length === 0) {
    return '<div class="pkb-bom-block no-deficit">' +
             '<div class="pkb-bom-title" style="color:#0A5B41;"><i class="ti ti-circle-check"></i>Все компоненты на складе</div>' +
           '</div>';
  }

  // Есть дефицит — выводим список
  const hasCritical = missing.some(m => m.is_critical);
  const titleIcon = hasCritical ? 'ti-alert-triangle' : 'ti-info-circle';
  const titleColor = hasCritical ? '#8C2A2A' : '#854F0B';
  const titleText = hasCritical
    ? 'Дефицит — работа заблокирована'
    : 'Дефицит некритичных компонентов';

  let html = '<div class="pkb-bom-block">';
  html +=   '<div class="pkb-bom-title" style="color:' + titleColor + ';">';
  html +=     '<i class="ti ' + titleIcon + '"></i>' + escapeHtml(titleText);
  html +=   '</div>';
  html +=   '<div class="pkb-bom-list">';
  // v2.43.81: кнопка «Сопоставить со склада» — закрыть BOM-строку ручным списанием
  // компонента с другим названием (поставщики иногда называют чуть иначе).
  const canMan = (typeof hasPermission === 'function') && hasPermission('production.manage');
  missing.forEach(m => {
    const need = pkbFmtQty(m.need);
    const have = pkbFmtQty(m.available);
    const def  = pkbFmtQty(m.deficit);
    const unit = m.unit || 'шт.';
    const critCls = m.is_critical ? ' crit' : '';
    html += '<div class="pkb-bom-item">';
    html +=   '<span class="pkb-bom-item-name' + critCls + '">' + escapeHtml(m.component_name || '?') + '</span>';
    html +=   '<span class="pkb-bom-item-qty">нужно ' + need + ' / есть ' + have + ' ' + escapeHtml(unit) + '</span>';
    html +=   '<span class="pkb-bom-item-deficit">−' + def + '</span>';
    if (canMan && m.bom_id) {
      html += '<button class="btn btn-secondary btn-small" style="margin-left:8px;padding:3px 8px;font-size:11px;" ' +
                'onclick="event.stopPropagation();openBomFulfillModal(' + w.id + ',' + m.bom_id + ',' + JSON.stringify(m.component_name || '').replace(/"/g, '&quot;') + ',' + m.need + ',' + JSON.stringify(unit).replace(/"/g, '&quot;') + ')" ' +
                'title="Списать другой компонент со склада, чтобы закрыть эту строку"><i class="ti ti-arrow-merge"></i> Сопоставить</button>';
    }
    html += '</div>';
  });
  html +=   '</div>';
  if (hasCritical) {
    html += '<div style="font-size:11px;color:var(--text-light);margin-top:8px;">! — критичный компонент. Работа считается заблокированной пока их нет на складе.</div>';
  }
  html += '</div>';
  return html;
}

function pkbFmtQty(n) {
  if (n == null) return '0';
  const v = parseFloat(n);
  if (isNaN(v)) return '0';
  return (v % 1 === 0) ? String(Math.round(v)) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

// v2.43.81: модал «Сопоставить со склада» — выбрать другой компонент и закрыть BOM-строку.
async function openBomFulfillModal(workId, bomId, bomName, need, unit) {
  if (!cache.components) {
    try { const r = await apiGet('/api/components'); cache.components = r.components || []; }
    catch (e) { cache.components = []; }
  }
  state._bomFulfillSelectedId = null;
  state._bomFulfillName = bomName || '';
  const overlay = document.createElement('div');
  overlay.id = 'bom-fulfill-modal';
  overlay.className = 'modal-overlay visible';
  overlay.style.zIndex = '270';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:560px;max-height:85vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-arrow-merge"></i> Сопоставить со склада</h3>' +
        '<button class="modal-close" onclick="document.getElementById(\'bom-fulfill-modal\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:14px 18px 0;">' +
        '<div style="background:var(--brand-bg);border-radius:8px;padding:10px 12px;margin-bottom:12px;">' +
          '<div style="font-size:11px;color:var(--text-light);text-transform:uppercase;letter-spacing:0.4px;">Закрыть строку</div>' +
          '<div style="font-weight:600;font-size:14px;margin-top:2px;">' + escapeHtml(bomName) + '</div>' +
          '<div style="font-size:11.5px;color:var(--text-light);margin-top:2px;">Нужно ' + need + ' ' + escapeHtml(unit) + '</div>' +
        '</div>' +
        '<input type="text" id="bf-search" class="form-input" placeholder="Поиск по названию или артикулу…" oninput="_bomFulfillFilter()" style="margin-bottom:6px;" />' +
        '<div style="font-size:11px;color:var(--text-light);margin-bottom:10px;">Сверху — подходящие по названию к нужной позиции и то, что есть в наличии.</div>' +
      '</div>' +
      '<div id="bf-list" style="flex:1;overflow-y:auto;padding:0 18px;"></div>' +
      '<div id="bf-qty-row" style="display:none;padding:14px 18px 0;border-top:1px solid var(--border);">' +
        '<label class="form-label">Количество для списания</label>' +
        '<input type="number" id="bf-qty" class="form-input" value="' + need + '" min="0.001" step="0.01" />' +
      '</div>' +
      '<div style="padding:14px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">' +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'bom-fulfill-modal\').remove()">Отмена</button>' +
        '<button class="btn btn-primary" id="bf-submit" disabled onclick="submitBomFulfill(' + workId + ',' + bomId + ')"><i class="ti ti-check"></i> Списать</button>' +
      '</div></div>';
  document.body.appendChild(overlay);
  _bomFulfillFilter();
}

// v2.45.x: оценка релевантности компонента запросу/нужной позиции (больше — лучше)
function _bomScore(c, tokens, rawNoSpace) {
  const name = (c.name || '').toLowerCase();
  const sku  = (c.sku  || '').toLowerCase();
  const nameN = name.replace(/\s+/g, '');
  const skuN  = sku.replace(/\s+/g, '');
  let score = 0;
  if (rawNoSpace) {
    if (nameN === rawNoSpace || skuN === rawNoSpace) score += 1000;
    else if (nameN.indexOf(rawNoSpace) === 0 || skuN.indexOf(rawNoSpace) === 0) score += 500;
    else if (nameN.indexOf(rawNoSpace) >= 0 || skuN.indexOf(rawNoSpace) >= 0) score += 200;
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t && (name.indexOf(t) >= 0 || sku.indexOf(t) >= 0)) score += 50;
  }
  return score;
}

function _bomFulfillFilter() {
  // Релевантность: при пустом поиске ранжируем по похожести на нужную позицию,
  // при вводе — по запросу. В наличии — выше. Поиск по названию и артикулу,
  // игнорируя пробелы/регистр.
  const raw = ((document.getElementById('bf-search') || {}).value || '').trim().toLowerCase();
  const usingSearch = !!raw;
  const basis = usingSearch ? raw : (state._bomFulfillName || '').toLowerCase();
  const tokens = basis.split(/[\s,;·.\/]+/).filter(t => t.length >= 2);
  const rawNoSpace = usingSearch ? raw.replace(/\s+/g, '') : '';
  const comps = cache.components || [];

  let arr = comps.map(c => ({ c: c, s: _bomScore(c, tokens, rawNoSpace) }));
  if (usingSearch) arr = arr.filter(x => x.s > 0);
  arr.sort((a, b) => {
    if (b.s !== a.s) return b.s - a.s;                         // релевантность
    const ia = parseFloat(a.c.qty_on_stock || 0) > 0 ? 1 : 0;
    const ib = parseFloat(b.c.qty_on_stock || 0) > 0 ? 1 : 0;
    if (ib !== ia) return ib - ia;                             // в наличии — выше
    return (a.c.name || '').localeCompare(b.c.name || '', 'ru');
  });
  const filtered = arr.map(x => x.c);

  const list = document.getElementById('bf-list');
  if (!list) return;
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-block" style="padding:14px;"><i class="ti ti-info-circle"></i>Ничего не найдено. Попробуйте другое слово или артикул.</div>';
    return;
  }
  const shown = filtered.slice(0, 120);
  list.innerHTML = shown.map(c => {
    const stock = parseFloat(c.qty_on_stock || 0);
    const inStock = stock > 0;
    const sel = state._bomFulfillSelectedId === c.id;
    const cat = c.category_name ? escapeHtml(c.category_name) + ' · ' : '';
    const stockHtml = inStock
      ? '<span style="color:#15803D;font-weight:600;">в наличии: ' + formatNumberShort(stock) + ' ' + escapeHtml(c.unit || 'шт.') + '</span>'
      : '<span style="color:var(--danger);">нет в наличии</span>';
    return '<div class="modal-item' + (sel ? ' bf-selected' : '') + '" onclick="_bomFulfillSelect(' + c.id + ')"' +
             (inStock ? '' : ' style="opacity:.72;"') + '>' +
             '<div class="mi-text">' +
               '<div class="mi-title">' + escapeHtml(c.name || '?') + (c.sku ? ' · ' + escapeHtml(c.sku) : '') + '</div>' +
               '<div class="mi-meta">' + cat + stockHtml + '</div>' +
             '</div>' +
             (sel ? '<i class="ti ti-circle-check" style="color:var(--brand);font-size:20px;"></i>' : '') +
           '</div>';
  }).join('') +
    (filtered.length > shown.length
      ? '<div style="padding:10px 4px;text-align:center;color:var(--text-light);font-size:12px;">…ещё ' + (filtered.length - shown.length) + ' — уточните поиск.</div>'
      : '');
}

function _bomFulfillSelect(componentId) {
  state._bomFulfillSelectedId = componentId;
  const submit = document.getElementById('bf-submit');
  if (submit) submit.disabled = false;
  const qtyRow = document.getElementById('bf-qty-row');
  if (qtyRow) qtyRow.style.display = '';
  _bomFulfillFilter();
}

async function submitBomFulfill(workId, bomId) {
  const componentId = state._bomFulfillSelectedId;
  const qty = parseFloat((document.getElementById('bf-qty') || {}).value || 0);
  if (!componentId) { showToast('Выберите компонент', 'error'); return; }
  if (!(qty > 0)) { showToast('Укажите кол-во > 0', 'error'); return; }
  try {
    const r = await apiPost('/api/production/works/' + workId + '/bom-fulfill', {
      bom_id: bomId, component_id: componentId, qty: qty,
    });
    if (!r.ok) {
      showToast((r.data && (r.data.message || r.data.error)) || 'Не удалось списать', 'error');
      return;
    }
    showToast(r.data.message || 'Списано', 'success');
    document.getElementById('bom-fulfill-modal').remove();
    cache.productionKanban = null;
    cache.components = null;
    // Перезагружаем модалку работы — статус блокировки изменился
    if (typeof openProductionWorkDetail === 'function') {
      const cur = document.querySelector('#pkb-detail-modal [data-work-id]');
      if (cur) {
        const wid = parseInt(cur.dataset.workId, 10);
        if (wid) openProductionWorkDetail(wid);
      } else {
        openProductionWorkDetail(workId);
      }
    }
  } catch (e) {
    showToast('Ошибка: ' + (e && e.message || e), 'error');
  }
}


// ============ v2.24.0 (Stage 30.0): AI-ИНСАЙТ КАНБАНА ============

async function openAiInsightModal() {
  // Удаляем предыдущую
  const existing = document.getElementById('pkb-ai-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'pkb-ai-modal';
  overlay.className = 'modal-overlay visible pkb-ai-modal';
  overlay.onclick = function(e) { if (e.target === overlay) closeAiInsightModal(); };
  overlay.innerHTML =
    '<div class="modal">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-sparkles"></i>AI-анализ канбана</h3>' +
        '<button class="icon-btn" onclick="closeAiInsightModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="pkb-ai-body" id="pkb-ai-body">' +
        '<div class="pkb-ai-loading">' +
          '<div class="pkb-ai-spinner"></div>' +
          'Claude анализирует канбан...<br>' +
          '<span style="font-size:11px;color:var(--text-faint);">Обычно 5-15 секунд</span>' +
        '</div>' +
      '</div>' +
      '<div class="pkb-ai-actions" id="pkb-ai-actions" style="display:none;">' +
        '<button class="pkb-btn" onclick="closeAiInsightModal()">Закрыть</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  // Запускаем запрос
  requestAiInsight();
}

function closeAiInsightModal() {
  const m = document.getElementById('pkb-ai-modal');
  if (m) m.remove();
}

async function requestAiInsight() {
  const body = document.getElementById('pkb-ai-body');
  const actions = document.getElementById('pkb-ai-actions');
  if (!body) return;

  // Показываем loading
  body.innerHTML =
    '<div class="pkb-ai-loading">' +
      '<div class="pkb-ai-spinner"></div>' +
      'Claude анализирует канбан...<br>' +
      '<span style="font-size:11px;color:var(--text-faint);">Обычно 5-15 секунд</span>' +
    '</div>';
  if (actions) actions.style.display = 'none';

  try {
    const r = await apiPost('/api/production/ai-insights', {});
    if (!r.ok) {
      const msg = (r.data && (r.data.message || r.data.error)) || ('HTTP ' + r.status);
      body.innerHTML = '<div class="pkb-ai-error"><b>Не удалось получить анализ</b><br>' + escapeHtml(msg) + '</div>';
      renderAiActions(false);
      return;
    }
    const d = r.data || {};
    let html = '<div class="pkb-ai-text">' + escapeHtml(d.response_text || '(пустой ответ)') + '</div>';
    body.innerHTML = html;

    // Метаданные внизу модалки
    const cost = (d.cost_usd != null) ? d.cost_usd.toFixed(4) : '0';
    const created = d.created_at ? new Date(d.created_at).toLocaleString('ru-RU') : '';
    const metaHtml = '<div class="pkb-ai-meta">' +
                       '<span>модель: ' + escapeHtml(d.model || '—') + '</span>' +
                       '<span>токены: ' + (d.tokens_in || 0) + '→' + (d.tokens_out || 0) + '</span>' +
                       '<span>стоимость: $' + cost + '</span>' +
                       '<span>' + escapeHtml(created) + '</span>' +
                     '</div>';
    body.insertAdjacentHTML('afterend', metaHtml);
    // Удалим следующий мета-блок при следующем requestAiInsight (см. ниже)

    renderAiActions(true);
  } catch (e) {
    body.innerHTML = '<div class="pkb-ai-error"><b>Ошибка соединения</b><br>' + escapeHtml(String(e.message || e)) + '</div>';
    renderAiActions(false);
  }
}

function renderAiActions(success) {
  const actions = document.getElementById('pkb-ai-actions');
  if (!actions) return;
  let html = '<button class="pkb-btn" onclick="closeAiInsightModal()">Закрыть</button>';
  html += '<button class="pkb-btn ai-action" onclick="resetAiAndRequest()"><i class="ti ti-refresh"></i>Запросить новый</button>';
  actions.innerHTML = html;
  actions.style.display = 'flex';
}

function resetAiAndRequest() {
  // Удаляем мета-блок если он был добавлен через insertAdjacentHTML
  const meta = document.querySelector('#pkb-ai-modal .pkb-ai-meta');
  if (meta) meta.remove();
  requestAiInsight();
}

async function deleteProductionWork(workId) {
  if (!confirm('Удалить работу? Действие необратимо.')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/production/works/' + workId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      showToast(data.message || data.error || 'Ошибка', 'error');
      return;
    }
    showToast('Работа удалена', 'success');
    closeProductionWorkDetail();
    cache.productionKanban = null;
    loadProductionDashboard();
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// ============ ФОРМА СОЗДАНИЯ РАБОТЫ ============
// ВАЖНО (v2.22.1): функции openNewProductionWork / closeNewProductionWork /
// submitNewProductionWork отвязаны от UI — кнопка «+ Новая работа» в канбане
// теперь вызывает openNewAssembly() (старый полнофункциональный экран сборки).
// Production_works создаются автоматически при публикации договора
// (см. Stage 29.2.1 / sync_production_works_for_contract в бэке).
// Функции оставлены как fallback на случай возврата к быстрой модалке.

async function openNewProductionWork() {
  // Удаляем старую
  const existing = document.getElementById('pkb-new-modal');
  if (existing) existing.remove();

  // Параллельно подгружаем модели и сотрудников (если ещё нет в кеше)
  if (!cache.models) {
    try { cache.models = await apiGet('/api/models'); } catch (e) {}
  }
  let employees = [];
  try {
    const d = await apiGet('/api/employees/active');
    employees = Array.isArray(d) ? d : (d.items || []);
  } catch (e) {}

  const models = (cache.models && cache.models.models) ? cache.models.models : [];

  // Сортируем модели по имени
  const modelsSorted = [...models].sort((a, b) =>
    (a.name || '').localeCompare(b.name || '', 'ru'));
  const employeesSorted = [...employees].sort((a, b) =>
    (a.name || '').localeCompare(b.name || '', 'ru'));

  // Дефолтный дедлайн — через 7 дней
  const defaultDeadline = new Date();
  defaultDeadline.setDate(defaultDeadline.getDate() + 7);
  const ddStr = defaultDeadline.toISOString().slice(0, 10);

  let modelOpts = '<option value="">— выберите модель —</option>';
  modelsSorted.forEach(m => {
    const labelExtra = m.extra ? (' ' + m.extra) : '';
    modelOpts += '<option value="' + m.id + '">' + escapeHtml((m.name || '?') + labelExtra) + '</option>';
  });
  let empOpts = '<option value="">— не назначен —</option>';
  employeesSorted.forEach(e => {
    empOpts += '<option value="' + e.id + '">' + escapeHtml(e.name || '?') + '</option>';
  });

  const overlay = document.createElement('div');
  overlay.id = 'pkb-new-modal';
  overlay.className = 'modal-overlay visible pkb-form-modal';
  overlay.onclick = function(e) { if (e.target === overlay) closeNewProductionWork(); };
  overlay.innerHTML =
    '<div class="modal">' +
      '<div class="modal-header">' +
        '<h3>Новая работа</h3>' +
        '<button class="icon-btn" onclick="closeNewProductionWork()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div id="pkb-form-error" class="pkb-form-error" style="display:none;"></div>' +
        '<div class="pkb-field">' +
          '<label>Модель *</label>' +
          '<select id="pkb-f-model">' + modelOpts + '</select>' +
        '</div>' +
        '<div class="pkb-field-row">' +
          '<div class="pkb-field">' +
            '<label>Кол-во *</label>' +
            '<input type="number" id="pkb-f-qty" min="1" value="1" />' +
          '</div>' +
          '<div class="pkb-field">' +
            '<label>Срок</label>' +
            '<input type="date" id="pkb-f-deadline" value="' + ddStr + '" />' +
          '</div>' +
        '</div>' +
        '<div class="pkb-field-row">' +
          '<div class="pkb-field">' +
            '<label>Ответственный</label>' +
            '<select id="pkb-f-assignee">' + empOpts + '</select>' +
          '</div>' +
          '<div class="pkb-field">' +
            '<label>План часов</label>' +
            '<input type="number" id="pkb-f-hours" min="0" step="0.5" placeholder="—" />' +
          '</div>' +
        '</div>' +
        '<div class="pkb-field">' +
          '<label>Описание / заметка</label>' +
          '<textarea id="pkb-f-desc" placeholder="Особенности, IP, нюансы…"></textarea>' +
        '</div>' +
        '<div class="pkb-form-actions">' +
          '<button class="pkb-btn" onclick="closeNewProductionWork()">Отмена</button>' +
          '<button class="pkb-btn primary" onclick="submitNewProductionWork()"><i class="ti ti-check"></i>Создать</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  // Фокус на модель
  setTimeout(() => { const el = document.getElementById('pkb-f-model'); if (el) el.focus(); }, 60);
}

function closeNewProductionWork() {
  const m = document.getElementById('pkb-new-modal');
  if (m) m.remove();
}

async function submitNewProductionWork() {
  const errEl = document.getElementById('pkb-form-error');
  errEl.style.display = 'none';
  errEl.textContent = '';

  const modelId = parseInt(document.getElementById('pkb-f-model').value, 10);
  const qty     = parseInt(document.getElementById('pkb-f-qty').value, 10);
  const deadline = document.getElementById('pkb-f-deadline').value;
  const assigneeRaw = document.getElementById('pkb-f-assignee').value;
  const assigneeId  = assigneeRaw ? parseInt(assigneeRaw, 10) : null;
  const hoursRaw    = document.getElementById('pkb-f-hours').value;
  const hours       = hoursRaw ? parseFloat(hoursRaw) : null;
  const desc        = document.getElementById('pkb-f-desc').value.trim();

  if (!modelId) {
    errEl.textContent = 'Выберите модель';
    errEl.style.display = 'block';
    return;
  }
  if (!qty || qty < 1) {
    errEl.textContent = 'Кол-во должно быть ≥ 1';
    errEl.style.display = 'block';
    return;
  }

  const body = { model_id: modelId, qty: qty };
  if (deadline) body.deadline_at = deadline;
  if (assigneeId) body.assignee_id = assigneeId;
  if (hours != null && !isNaN(hours)) body.estimated_hours = hours;
  if (desc) body.description = desc;

  try {
    const r = await apiPost('/api/production/works', body);
    if (!r.ok) {
      errEl.textContent = (r.data && (r.data.message || r.data.error)) || ('HTTP ' + r.status);
      errEl.style.display = 'block';
      return;
    }
    showToast('Работа создана', 'success');
    closeNewProductionWork();
    cache.productionKanban = null;
    loadProductionDashboard();
  } catch (e) {
    errEl.textContent = 'Ошибка: ' + (e.message || e);
    errEl.style.display = 'block';
  }
}

// ============ v2.22.2: СИНХРОНИЗАЦИЯ ИЗ ДОГОВОРОВ ============

async function syncProductionWorksFromContracts() {
  const ok = confirm(
    'Создать работы в очереди для непокрытых позиций ВСЕХ опубликованных договоров?\n\n' +
    'Это безопасно: уже существующие работы не дублируются. ' +
    'Можно повторно нажимать после добавления новых позиций в договоры.'
  );
  if (!ok) return;

  showToast('Синхронизирую с договорами…', 'info');
  try {
    const r = await apiPost('/api/admin/sync-production-works', {});
    if (!r.ok) {
      const msg = (r.data && (r.data.message || r.data.error)) || ('HTTP ' + r.status);
      showToast('Ошибка: ' + msg, 'error');
      return;
    }
    const d = r.data || {};
    const created   = d.total_created || 0;
    const totalQty  = d.total_qty_created || 0;
    const procd     = d.contracts_processed || 0;
    const skipNoMdl = d.total_skipped_no_model || 0;

    if (created === 0) {
      let msg = 'Договоров обработано: ' + procd + '. Новых работ нет — всё уже синхронизировано';
      if (skipNoMdl > 0) msg += '. Позиций без модели: ' + skipNoMdl;
      showToast(msg, 'info');
    } else {
      showToast('Создано работ: ' + created + ' (шт. суммарно: ' + totalQty + ') из ' + procd + ' договоров', 'success');
    }
    cache.productionKanban = null;
    loadProductionDashboard();
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

// ============ КОНЕЦ ЭТАПА 29.2 (v2.22.0) ============


// ============ ЭТАП 39 (v2.19.0): ВИДЖЕТ «НА СБОРКУ» ============

async function loadProductionQueue() {
  try {
    const r = await apiGet('/api/production/queue');
    const contracts = (r && r.contracts) || [];
    renderProductionQueue(contracts);
  } catch (e) {
    // Тихо — виджет необязательный
    renderProductionQueue([]);
  }
}

function renderProductionQueue(contracts) {
  const containers = [
    document.getElementById('production-queue-block-mobile'),
    document.getElementById('production-queue-block-desktop'),
  ].filter(Boolean);
  const labelM = document.getElementById('prod-queue-label-m');
  const sectionD = document.getElementById('prod-queue-section-d');
  const linkD = document.getElementById('prod-queue-link-d');

  if (!contracts || contracts.length === 0) {
    if (labelM) labelM.style.display = 'none';
    if (sectionD) sectionD.style.display = 'none';
    containers.forEach(c => c.innerHTML = '');
    return;
  }

  // Показываем секцию (была скрыта если пусто)
  if (labelM) labelM.style.display = '';
  if (sectionD) sectionD.style.display = '';
  if (linkD) linkD.style.display = contracts.length > 3 ? '' : 'none';

  let html = '';
  contracts.forEach(c => {
    const urgCls = _prodQueueUrgencyClass(c.delivery_date);
    html += '<div class="prod-queue-contract ' + urgCls + '">';
    html += '<div class="pqc-head">';
    html += '<div class="pqc-title">';
    html += '<span class="pqc-link" onclick="openContractDetail(' + c.contract_id + ')">№' + escapeHtml(c.contract_number || '—') + '</span>';
    if (c.contractor_name) html += ' · ' + escapeHtml(c.contractor_name);
    html += '</div>';
    let metaParts = [];
    if (c.delivery_date) {
      metaParts.push('срок ' + formatDateShort(c.delivery_date));
      const daysLeft = _prodQueueDaysLeft(c.delivery_date);
      if (daysLeft !== null) {
        if (daysLeft < 0) metaParts.push('просрочен на ' + Math.abs(daysLeft) + ' дн');
        else if (daysLeft === 0) metaParts.push('сегодня');
        else if (daysLeft <= 7) metaParts.push('через ' + daysLeft + ' дн');
      }
    } else {
      metaParts.push('без срока');
    }
    html += '<div class="pqc-meta">' + escapeHtml(metaParts.join(' · ')) + '</div>';
    html += '</div>';

    // Позиции
    (c.items || []).forEach(item => {
      const subParts = [];
      if (item.execution_type) {
        const lbl = item.execution_type === 'stainless' ? 'Нерж. AISI' : (item.execution_type === 'standard' ? 'Стандарт' : item.execution_type);
        subParts.push(lbl);
      }
      if (item.ip_rating) subParts.push(item.ip_rating);
      html += '<div class="pqc-item">';
      html += '<div class="pqc-item-name">' + escapeHtml(item.item_name || '—');
      if (subParts.length) html += '<small>' + escapeHtml(subParts.join(' · ')) + '</small>';
      html += '</div>';
      const need = Math.round((item.qty_need || 0) * 100) / 100;
      const qtyText = (item.qty_reserved > 0)
        ? ('Нужно <span class="pqc-need">' + _fmtQty(need) + '</span> из ' + _fmtQty(item.qty))
        : ('Нужно <span class="pqc-need">' + _fmtQty(item.qty) + '</span>');
      html += '<div class="pqc-item-qty">' + qtyText + '</div>';
      if (canCreateAssembly()) {
        html += '<button class="pqc-take-btn" onclick="takeForAssembly(' + c.contract_id + ', ' + (item.model_id || 'null') + ', \'' + escapeHtml(String(item.execution_type || '')) + '\', \'' + escapeHtml(String(item.ip_rating || '')) + '\')"><i class="ti ti-tool"></i> Взять в работу</button>';
      }
      html += '</div>';
    });
    html += '</div>';
  });
  containers.forEach(c => c.innerHTML = html);
}

function _fmtQty(v) {
  const n = Number(v) || 0;
  return (n % 1 === 0) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
}

function _prodQueueDaysLeft(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((target - today) / (24 * 3600 * 1000));
  } catch (e) { return null; }
}

function _prodQueueUrgencyClass(iso) {
  const days = _prodQueueDaysLeft(iso);
  if (days === null) return 'urg-nodate';
  if (days < 0) return 'urg-overdue';
  if (days <= 3) return 'urg-urgent';
  if (days <= 14) return 'urg-soon';
  return 'urg-ok';
}

function canCreateAssembly() {
  const u = state.user || {};
  const perms = u.permissions || {};
  const roles = u.roles || [];
  // Есть permissions с ключом производства — или legacy роли мастер/инженер/директор/зам
  if (perms['production.assembly_create'] || perms['production.full']) return true;
  if (roles.includes('director') || roles.includes('master') || roles.includes('engineer') || roles.includes('zam')) return true;
  return false;
}

// «Взять в работу» — открывает форму создания сборки с предзаполненной моделью и contract_id
function takeForAssembly(contractId, modelId, executionType, ipRating) {
  // state._prefillAssembly будет прочитан при инициализации формы новой сборки
  state._prefillAssembly = {
    contract_id: contractId,
    model_id: modelId || null,
    execution: executionType || null,
    ip_class: ipRating || null,
  };
  // Открываем форму
  if (typeof openNewAssembly === 'function') {
    openNewAssembly();
  } else if (typeof openSidebarItem === 'function') {
    selectSidebarItem('new-assembly');
  } else {
    selectSidebarItem('new-assembly');
  }
}

// ============ КОНЕЦ ВИДЖЕТА «НА СБОРКУ» ============


function kpiCard(label, value, trendStr, trendCls) {
  return '<div class="kpi-card">' +
    '<div class="label">' + escapeHtml(label) + '</div>' +
    '<div class="value">' + escapeHtml(String(value)) + '</div>' +
    '<div class="trend ' + (trendCls || '') + '">' + escapeHtml(trendStr || '—') + '</div>' + '</div>';
}

function trendText(pct) {
  if (pct === null || pct === undefined) return '—';
  if (pct === 0) return '= 0%';
  if (pct > 0) return '▲ +' + pct + '%';
  return '▼ ' + pct + '%';
}

function trendClass(pct) {
  if (pct === null || pct === undefined || pct === 0) return '';
  return pct > 0 ? 'up' : 'down';
}

// ЭТАП 31.3: раскрытие/сокрытие дополнительных записей блока «Последние записи»
function toggleRecentMore() {
  const hidden = document.getElementById('recent-hidden');
  const btn = document.getElementById('recent-toggle');
  if (!hidden || !btn) return;
  const isHidden = (hidden.style.display === 'none');
  hidden.style.display = isHidden ? '' : 'none';
  const count = hidden.querySelectorAll(':scope > *').length;
  btn.innerHTML = isHidden
    ? '<i class="ti ti-chevron-up"></i> Свернуть'
    : '<i class="ti ti-chevron-down"></i> Показать ещё ' + count;
}

function renderRecordHtml(r) {
  const meta = [];
  if (r.workers && r.workers.length) meta.push(r.workers.join(', '));
  if (r.execution) meta.push(r.execution);
  if (r.ip_class) meta.push(r.ip_class);
  const title = r.model_name + (r.model_extra ? ' · ' + r.model_extra : '');
  const dateStr = isToday(r.date) ? 'сегодня' : formatDate(r.date);
  const iconCls = getDirectionIcon(r.direction_code);
  // ЭТАП 15: бейдж договора или «на склад»
  let badge = '';
  if (r.contract_id && r.contract_number) {
    const tip = r.contract_contractor_name ? ' (' + r.contract_contractor_name + ')' : '';
    badge = '<span class="assembly-contract-badge" title="' + escapeHtml(r.contract_contractor_name || '') + '">' +
            '<i class="ti ti-file-text"></i>' + escapeHtml(r.contract_number) + '</span>';
  } else {
    badge = '<span class="assembly-warehouse-badge" title="На склад"><i class="ti ti-building-warehouse"></i>склад</span>';
  }
  return '<div class="record">' +
    '<div class="record-icon"><i class="ti ' + iconCls + '"></i></div>' +
    '<div class="record-body">' +
      '<div class="record-title">' + escapeHtml(title) + badge + '</div>' +
      '<div class="record-meta">' + dateStr + (meta.length ? ' · ' + escapeHtml(meta.join(' · ')) : '') + '</div>' +
    '</div>' +
    '<div class="record-qty">' + r.qty + '<small>шт.</small></div>' +
    '</div>';
}

// ============ ИСТОРИЯ ============

function getPeriodRange(filter) {
  const today = new Date();
  const toDate = today.toISOString().slice(0, 10);
  if (filter === 'today') return [toDate, toDate];
  if (filter === 'week') { const d = new Date(today); d.setDate(d.getDate() - 6); return [d.toISOString().slice(0, 10), toDate]; }
  if (filter === 'month') { const d = new Date(today); d.setDate(d.getDate() - 29); return [d.toISOString().slice(0, 10), toDate]; }
  if (filter === 'all') return ['2020-01-01', toDate];
  return [toDate, toDate];
}

async function loadHistory() {
  const filter = state.historyFilter;
  const container = document.getElementById('history-content');
  if (cache.history[filter]) { renderHistory(cache.history[filter]); return; }
  container.innerHTML = '<div class="loading-block">Загружаем историю…</div>';
  try {
    const [from, to] = getPeriodRange(filter);
    const limit = filter === 'all' ? 500 : 200;
    const d = await apiGet('/api/history?from=' + from + '&to=' + to + '&limit=' + limit);
    cache.history[filter] = d;
    renderHistory(d);
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function renderHistory(d) {
  const container = document.getElementById('history-content');
  if (!d.records || d.records.length === 0) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-inbox"></i>В этом периоде нет записей</div>';
    return;
  }
  const groups = {};
  d.records.forEach(r => { if (!groups[r.date]) groups[r.date] = []; groups[r.date].push(r); });
  const sortedDates = Object.keys(groups).sort().reverse();
  let html = '';
  sortedDates.forEach(date => {
    const records = groups[date];
    const totalQty = records.reduce((sum, r) => sum + r.qty, 0);
    const todayLabel = isToday(date) ? ' · сегодня' : '';
    html += '<div class="day-header"><b>' + formatDateLong(date) + '</b>' + todayLabel + ' · ' + totalQty + ' шт.</div>';
    html += '<div class="card">';
    records.forEach(r => html += renderRecordHtml(r));
    html += '</div>';
  });
  container.innerHTML = html;
}

// ============ СВОДКИ ============

// ============ ЭТАП 31.2: ЭКСПОРТ РАБОТ ЗА ПЕРИОД ============

// v2.43.43: общий хелпер расчёта дат for-from-to из state (с учётом custom)
function _summaryDateRange() {
  const period = state.summaryFilter || 'month';
  if (period === 'custom' && state.summaryCustomFrom && state.summaryCustomTo) {
    return { from: state.summaryCustomFrom, to: state.summaryCustomTo };
  }
  const today = new Date();
  const y = today.getFullYear(); const mo = today.getMonth(); const d = today.getDate();
  let f, t;
  if (period === 'day')             { f = new Date(y, mo, d);     t = new Date(y, mo, d); }
  else if (period === 'yesterday')  { f = new Date(y, mo, d - 1); t = new Date(y, mo, d - 1); }
  else if (period === 'week')       { f = new Date(y, mo, d - 6); t = new Date(y, mo, d); }
  else if (period === 'month')      { f = new Date(y, mo, 1);     t = new Date(y, mo + 1, 0); }
  else if (period === 'prev_month') { f = new Date(y, mo - 1, 1); t = new Date(y, mo, 0); }
  else                              { f = new Date(y, mo - 1, d); t = new Date(y, mo, d); }
  const toIso = (dt) => {
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  return { from: toIso(f), to: toIso(t) };
}

function summaryPeriodLabel() {
  const period = state.summaryFilter || 'month';
  if (period === 'day') return 'Сегодня';
  if (period === 'yesterday') return 'Вчера';
  if (period === 'week') return 'Последние 7 дней';
  if (period === 'month') return 'Текущий месяц';
  if (period === 'prev_month') return 'Прошлый месяц';
  if (period === 'custom' && state.summaryCustomFrom && state.summaryCustomTo) {
    if (state.summaryCustomFrom === state.summaryCustomTo) {
      return 'За ' + formatDateShort(state.summaryCustomFrom);
    }
    return 'С ' + formatDateShort(state.summaryCustomFrom) + ' по ' + formatDateShort(state.summaryCustomTo);
  }
  return '';
}

// ЭТАП 31.9: быстрое скачивание отчёта Сводок за активный период
async function quickExportSummary(fmt) {
  const { from: fromStr, to: toStr } = _summaryDateRange();

  showToast('Готовим файл…', 'info');

  try {
    const token = localStorage.getItem(TOKEN_KEY);
    // Все 8 типов работ
    const allTypes = 'assembly,repair,installation,commissioning,diagnostics,design,maintenance,other';
    let url = API_BASE + '/api/assemblies/export?from=' + encodeURIComponent(fromStr) +
      '&to=' + encodeURIComponent(toStr) +
      '&format=' + fmt +
      '&types=' + encodeURIComponent(allTypes);
    // v2.35.0: прокидываем фильтр по сборщику
    if (state.summaryEmployeeFilter) {
      url += '&employee_id=' + encodeURIComponent(state.summaryEmployeeFilter);
    }
    const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось сформировать отчёт', 'error');
      return;
    }
    const blob = await r.blob();
    const filename = 'atomus-rabota-' + fromStr + '_' + toStr + '.' + fmt;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
    showToast('Отчёт скачан', 'success');
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// v2.43.36: быстрое скачивание журнала участия в XLSX
async function quickExportSessions() {
  const { from: fromStr, to: toStr } = _summaryDateRange();

  showToast('Готовим журнал…', 'info');
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    let url = API_BASE + '/api/production/sessions/export?from=' + encodeURIComponent(fromStr) +
              '&to=' + encodeURIComponent(toStr) + '&format=xlsx';
    if (state.summaryEmployeeFilter) {
      url += '&employee_id=' + encodeURIComponent(state.summaryEmployeeFilter);
    }
    const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось сформировать журнал', 'error');
      return;
    }
    const blob = await r.blob();
    const filename = 'atomus-otchet-rabotnika-' + fromStr + '_' + toStr + '.xlsx';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    showToast('Журнал скачан', 'success');
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// v2.43.44: мини-модалка выбора формата для Активности
function askExportActivityFormat() {
  let modal = document.getElementById('activity-fmt-modal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'activity-fmt-modal';
  modal.className = 'modal-overlay visible';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:360px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-list-details"></i> Активность — формат</h3>' +
        '<button class="icon-btn" onclick="document.getElementById(\'activity-fmt-modal\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body" style="padding:14px 18px 18px;">' +
        '<div style="font-size:13px;color:var(--text-light);margin-bottom:12px;">В каком формате скачать отчёт?</div>' +
        '<div style="display:flex;gap:10px;">' +
          '<button class="report-fmt-pick" onclick="document.getElementById(\'activity-fmt-modal\').remove();quickExportActivity(\'xlsx\')">' +
            '<i class="ti ti-file-spreadsheet"></i><span>Excel</span></button>' +
          '<button class="report-fmt-pick" onclick="document.getElementById(\'activity-fmt-modal\').remove();quickExportActivity(\'pdf\')">' +
            '<i class="ti ti-file-text"></i><span>PDF</span></button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
}

// v2.43.42: единый отчёт активности — сборки + помощь хронологически
async function quickExportActivity(fmt) {
  fmt = fmt || 'xlsx';
  const { from: fromStr, to: toStr } = _summaryDateRange();

  showToast('Готовим отчёт активности…', 'info');
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    let url = API_BASE + '/api/production/activity/export?from=' + encodeURIComponent(fromStr) +
              '&to=' + encodeURIComponent(toStr) + '&format=' + fmt;
    if (state.summaryEmployeeFilter) {
      url += '&employee_id=' + encodeURIComponent(state.summaryEmployeeFilter);
    }
    const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось сформировать отчёт', 'error');
      return;
    }
    const blob = await r.blob();
    const ext = fmt === 'pdf' ? 'pdf' : 'xlsx';
    const filename = 'atomus-aktivnost-' + fromStr + '_' + toStr + '.' + ext;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    showToast('Отчёт скачан', 'success');
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

function openExportAssembliesModal() {
  let m = document.getElementById('export-asm-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'export-asm-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) closeExportAssembliesModal(); };
    document.body.appendChild(m);
  }

  const today = new Date();
  const monthAgo = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);
  const toStr = today.toISOString().slice(0, 10);
  const fromStr = monthAgo.toISOString().slice(0, 10);

  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:520px;max-height:90vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-download"></i> Экспорт работ за период</h3>' +
        '<button class="modal-close" onclick="closeExportAssembliesModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:18px;overflow-y:auto;flex:1;">' +
        // Преcеты
        '<div style="font-size:12px;font-weight:600;color:var(--text-light);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Период</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">' +
          '<button class="btn btn-secondary btn-small" onclick="setExportPeriod(\'today\')">Сегодня</button>' +
          '<button class="btn btn-secondary btn-small" onclick="setExportPeriod(\'yesterday\')">Вчера</button>' +
          '<button class="btn btn-secondary btn-small" onclick="setExportPeriod(\'week\')">Неделя</button>' +
          '<button class="btn btn-secondary btn-small" onclick="setExportPeriod(\'month\')">Месяц</button>' +
          '<button class="btn btn-secondary btn-small" onclick="setExportPeriod(\'quarter\')">Квартал</button>' +
          '<button class="btn btn-secondary btn-small" onclick="setExportPeriod(\'year\')">Год</button>' +
        '</div>' +
        // Ручные даты
        '<div style="display:flex;gap:10px;margin-bottom:18px;">' +
          '<div style="flex:1;">' +
            '<label style="display:block;margin-bottom:4px;font-size:12px;color:var(--text-light);">С</label>' +
            '<input type="date" id="export-from" value="' + fromStr + '" style="width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:inherit;" />' +
          '</div>' +
          '<div style="flex:1;">' +
            '<label style="display:block;margin-bottom:4px;font-size:12px;color:var(--text-light);">По</label>' +
            '<input type="date" id="export-to" value="' + toStr + '" style="width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:inherit;" />' +
          '</div>' +
        '</div>' +
        // Типы работ
        '<div style="font-size:12px;font-weight:600;color:var(--text-light);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Типы работ</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px;background:var(--bg);border-radius:8px;padding:10px;">' +
          _exportTypeCheckbox('assembly',     'Сборки', true) +
          _exportTypeCheckbox('repair',       'Ремонт', true) +
          _exportTypeCheckbox('installation', 'Монтаж', true) +
          _exportTypeCheckbox('commissioning','Пусконаладка', true) +
          _exportTypeCheckbox('diagnostics',  'Диагностика', true) +
          _exportTypeCheckbox('design',       'Проектирование', true) +
          _exportTypeCheckbox('maintenance',  'ТО', true) +
          _exportTypeCheckbox('other',        'Прочее', true) +
        '</div>' +
        '<div style="display:flex;gap:8px;font-size:12px;margin-bottom:18px;">' +
          '<a onclick="toggleAllExportTypes(true)" style="color:var(--brand);cursor:pointer;">Выбрать все</a>' +
          '<span style="color:var(--text-light);">·</span>' +
          '<a onclick="toggleAllExportTypes(false)" style="color:var(--brand);cursor:pointer;">Снять все</a>' +
        '</div>' +
        // v2.35.0: Сотрудник
        '<div style="font-size:12px;font-weight:600;color:var(--text-light);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Сборщик</div>' +
        '<select id="export-worker-select" class="summary-worker-select" style="width:100%;max-width:none;margin-bottom:18px;">' +
          '<option value="">Все сборщики</option>' +
        '</select>' +
        // Формат
        '<div style="font-size:12px;font-weight:600;color:var(--text-light);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Формат файла</div>' +
        '<div style="display:flex;gap:10px;">' +
          '<label class="export-fmt-choice" style="flex:1;display:flex;align-items:center;gap:10px;padding:12px;border:2px solid var(--brand);border-radius:10px;cursor:pointer;background:var(--brand-bg);">' +
            '<input type="radio" name="export-fmt" value="xlsx" checked />' +
            '<i class="ti ti-file-spreadsheet" style="font-size:20px;color:var(--brand);"></i>' +
            '<span style="font-weight:600;">Excel (.xlsx)</span>' +
          '</label>' +
          '<label class="export-fmt-choice" style="flex:1;display:flex;align-items:center;gap:10px;padding:12px;border:2px solid var(--border);border-radius:10px;cursor:pointer;">' +
            '<input type="radio" name="export-fmt" value="pdf" />' +
            '<i class="ti ti-file-text" style="font-size:20px;color:#D94B4B;"></i>' +
            '<span style="font-weight:600;">PDF</span>' +
          '</label>' +
        '</div>' +
      '</div>' +
      '<div style="padding:14px 18px;border-top:1px solid var(--border);background:var(--bg);">' +
        '<button class="btn btn-primary" onclick="doExportAssemblies()" id="export-do-btn" style="width:100%;">' +
          '<i class="ti ti-download"></i> Скачать отчёт</button>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');

  // Радио — стилизация выбора формата
  setTimeout(() => {
    document.querySelectorAll('.export-fmt-choice input[type="radio"]').forEach(r => {
      r.addEventListener('change', () => {
        document.querySelectorAll('.export-fmt-choice').forEach(lbl => {
          const inp = lbl.querySelector('input');
          if (inp && inp.checked) {
            lbl.style.borderColor = 'var(--brand)';
            lbl.style.background = 'var(--brand-bg)';
          } else {
            lbl.style.borderColor = 'var(--border)';
            lbl.style.background = '';
          }
        });
      });
    });
  }, 50);

  // v2.35.0: Подгружаем сборщиков и предвыбираем фильтр из Сводок
  _loadExportWorkersDropdown();
}

async function _loadExportWorkersDropdown() {
  const sel = document.getElementById('export-worker-select');
  if (!sel) return;
  try {
    const d = await apiGet('/api/employees/active');
    const employees = (d && d.employees) || [];
    // Сначала те, у кого роль assembler/master, остальные ниже
    const isAssembler = (e) => (e.roles || []).some(r => r === 'assembler' || r === 'master');
    const top = employees.filter(isAssembler);
    const rest = employees.filter(e => !isAssembler(e));
    let html = '<option value="">Все сборщики</option>';
    if (top.length) {
      html += '<optgroup label="Сборщики">';
      top.forEach(e => {
        const name = e.short_name || e.full_name || '—';
        html += '<option value="' + e.id + '">' + escapeHtml(name) + '</option>';
      });
      html += '</optgroup>';
    }
    if (rest.length) {
      html += '<optgroup label="Остальные">';
      rest.forEach(e => {
        const name = e.short_name || e.full_name || '—';
        html += '<option value="' + e.id + '">' + escapeHtml(name) + '</option>';
      });
      html += '</optgroup>';
    }
    sel.innerHTML = html;
    // Предвыбираем фильтр из Сводок, если он активен
    if (state.summaryEmployeeFilter) {
      sel.value = String(state.summaryEmployeeFilter);
    }
  } catch (e) {
    // Тихо — выпадайка останется с одной опцией «Все сборщики»
  }
}

function _exportTypeCheckbox(value, label, checked) {
  return '<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;font-size:13px;">' +
    '<input type="checkbox" class="export-type-cb" value="' + value + '"' + (checked ? ' checked' : '') + ' />' +
    '<span>' + label + '</span>' +
  '</label>';
}

function toggleAllExportTypes(state) {
  document.querySelectorAll('.export-type-cb').forEach(cb => cb.checked = !!state);
}

function setExportPeriod(preset) {
  const today = new Date();
  let from = new Date();
  if (preset === 'today') {
    from = new Date(today);
  } else if (preset === 'yesterday') {
    from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  } else if (preset === 'week') {
    from.setDate(today.getDate() - 6);
  } else if (preset === 'month') {
    from.setDate(today.getDate() - 29);
  } else if (preset === 'quarter') {
    from.setMonth(today.getMonth() - 3);
  } else if (preset === 'year') {
    from.setFullYear(today.getFullYear() - 1);
  }
  document.getElementById('export-from').value = from.toISOString().slice(0, 10);
  document.getElementById('export-to').value = today.toISOString().slice(0, 10);
}

function closeExportAssembliesModal() {
  const m = document.getElementById('export-asm-modal');
  if (m) m.classList.remove('visible');
}

async function doExportAssemblies() {
  const from = (document.getElementById('export-from').value || '').trim();
  const to   = (document.getElementById('export-to').value || '').trim();
  if (!from || !to) { showToast('Укажи период', 'error'); return; }
  if (from > to) { showToast('«С» должна быть раньше «По»', 'error'); return; }

  const types = [];
  document.querySelectorAll('.export-type-cb:checked').forEach(cb => types.push(cb.value));
  if (!types.length) { showToast('Выбери хотя бы один тип работ', 'error'); return; }

  let fmt = 'xlsx';
  document.querySelectorAll('input[name="export-fmt"]').forEach(r => {
    if (r.checked) fmt = r.value;
  });

  const btn = document.getElementById('export-do-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader"></i> Готовим файл…'; }

  // v2.35.0: фильтр по сборщику из модалки
  const workerSel = document.getElementById('export-worker-select');
  const workerId = workerSel ? (workerSel.value || '').trim() : '';
  const workerName = workerId && workerSel
    ? (workerSel.options[workerSel.selectedIndex].textContent || '').trim()
    : '';

  try {
    const token = localStorage.getItem(TOKEN_KEY);
    let url = API_BASE + '/api/assemblies/export?from=' + encodeURIComponent(from) +
      '&to=' + encodeURIComponent(to) +
      '&format=' + fmt +
      '&types=' + encodeURIComponent(types.join(','));
    if (workerId) url += '&employee_id=' + encodeURIComponent(workerId);
    const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось сформировать отчёт', 'error');
      return;
    }
    const blob = await r.blob();
    // Имя файла: добавляем суффикс с именем сборщика, если выбран
    const safeWorker = workerName
      ? '-' + workerName.replace(/[^\wА-Яа-яЁё.-]+/g, '_').slice(0, 30)
      : '';
    const filename = 'atomus-rabota' + safeWorker + '-' + from + '_' + to + '.' + fmt;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
    showToast('Отчёт скачан', 'success');
    closeExportAssembliesModal();
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-download"></i> Скачать отчёт'; }
  }
}


async function loadSummary() {
  const period = state.summaryFilter;
  const empId = state.summaryEmployeeFilter;
  // v2.43.43: произвольный период или отдельная кнопка "Вчера"
  const isCustom = period === 'custom' || period === 'yesterday';
  const cacheKey = (isCustom
    ? ('custom:' + _summaryDateRange().from + '-' + _summaryDateRange().to)
    : period) + '|' + (empId || 'all');
  const container = document.getElementById('summary-content');
  if (cache.summary[cacheKey]) { renderSummary(cache.summary[cacheKey]); return; }
  container.innerHTML = '<div class="loading-block">Считаем сводки…</div>';
  try {
    let url;
    if (isCustom) {
      const { from, to } = _summaryDateRange();
      url = '/api/summary?from=' + encodeURIComponent(from) +
            '&to=' + encodeURIComponent(to);
    } else {
      url = '/api/summary?period=' + period;
    }
    if (empId) url += '&employee_id=' + encodeURIComponent(empId);
    const d = await apiGet(url);
    cache.summary[cacheKey] = d;
    renderSummary(d);
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function renderSummary(d) {
  const container = document.getElementById('summary-content');
  const t = d.total;
  const empId = state.summaryEmployeeFilter;
  // Имя выбранного сборщика (для заголовков карточек)
  const selectedWorker = empId
    ? ((d.available_workers || []).find(w => String(w.id) === String(empId)) ||
       (d.by_employee && d.by_employee[0]) || null)
    : null;
  const selectedName = selectedWorker
    ? (selectedWorker.short_name || selectedWorker.full_name || '—')
    : null;

  // Всегда обновляем выпадайку — даже когда данных нет, чтобы можно было сбросить фильтр.
  _updateSummaryWorkerSelect(d.available_workers || []);

  const sessionsExist = d.sessions && (
    (d.sessions.total && d.sessions.total.total_entries > 0) ||
    (d.sessions.by_employee && d.sessions.by_employee.length > 0) ||
    (d.sessions.entries && d.sessions.entries.length > 0)
  );
  const hasAssemblyData = t && t.total_records > 0;
  if (!hasAssemblyData && !sessionsExist) {
    let empty = '<div class="empty-block"><i class="ti ti-chart-bar"></i>';
    empty += selectedName
      ? 'У сотрудника <b>' + escapeHtml(selectedName) + '</b> нет работ за этот период'
      : 'За этот период нет данных';
    empty += '</div>';
    container.innerHTML = empty;
    return;
  }

  let html = '';
  if (!hasAssemblyData) {
    html += '<div class="empty-block"><i class="ti ti-info-circle"></i>';
    html += selectedName
      ? 'У сотрудника <b>' + escapeHtml(selectedName) + '</b> нет сборок за этот период.'
      : 'За выбранный период нет сборок.';
    html += ' Ниже отображается журнал участия, если он есть.';
    html += '</div>';
  }

  // Бейдж активного фильтра — над KPI
  const periodLabel = summaryPeriodLabel();
  if (periodLabel || selectedName) {
    html += '<div style="padding:0 18px 8px;display:flex;flex-wrap:wrap;gap:8px;">';
    if (periodLabel) {
      html += '<span class="summary-filter-badge"><i class="ti ti-calendar-event"></i>' + escapeHtml(periodLabel) + '</span>';
    }
    if (selectedName) {
      html += '<span class="summary-filter-badge"><i class="ti ti-filter"></i>Сводка по: ' + escapeHtml(selectedName) + '</span>';
    }
    html += '</div>';
  }

  if (hasAssemblyData) {
    html += '<div class="kpi-grid">';
    html += kpiCard('записей', t.total_records, '—');
    html += kpiCard('штук', t.total_qty, '—');
    html += kpiCard('моделей', t.unique_models, '—');
    // При фильтре по одному сборщику карточка «сборщиков» бессмысленна — скрываем.
    if (!empId) {
      html += kpiCard('сборщиков', t.unique_employees, '—');
    }
    html += '</div>';

    html += '<div class="row-2">';
  if (d.by_direction && d.by_direction.length > 1) {
    html += '<div class="section"><h3 class="section-title">По направлениям' +
      (selectedName ? ' <small style="font-weight:400;color:var(--text-light);">· ' + escapeHtml(selectedName) + '</small>' : '') +
      '</h3>';
    html += '<div class="card">' + renderPieChart(d.by_direction, t.total_qty) + '</div></div>';
  }
  if (d.by_model && d.by_model.length) {
    const top = d.by_model.slice(0, 8);
    const maxQty = top[0].qty;
    html += '<div class="section"><h3 class="section-title">Топ моделей' +
      (selectedName ? ' <small style="font-weight:400;color:var(--text-light);">· ' + escapeHtml(selectedName) + '</small>' : '') +
      '</h3>';
    html += '<div class="card"><div class="hbar-list">';
    top.forEach((m, idx) => {
      const title = m.model_name + (m.model_extra ? ' · ' + m.model_extra : '');
      const pct = (m.qty / maxQty * 100);
      const color = SUMMARY_PALETTE[idx % SUMMARY_PALETTE.length];
      html += '<div class="hbar-row">';
      html += '<div class="hbar-name">' + escapeHtml(title) + '</div>';
      html += '<div class="hbar-track"><div class="hbar-fill" style="width:' + pct + '%;background:' + color + ';"></div></div>';
      html += '<div class="hbar-qty">' + m.qty + '</div></div>';
    });
    html += '</div></div></div>';
  }
  html += '</div>';
  }

  // Топ сборщиков — только когда фильтра нет. При фильтре по одному сотруднику теряет смысл.
  if (!empId && d.by_employee && d.by_employee.length) {
    html += '<div class="section"><h3 class="section-title">Топ сборщиков</h3>';
    html += '<div class="card"><div class="top-list">';
    d.by_employee.slice(0, 10).forEach((e, i) => {
      const name = e.short_name || e.full_name || '—';
      const clickable = e.id
        ? ' onclick="onSummaryWorkerChange(\'' + e.id + '\')" style="cursor:pointer;" title="Фильтр по сборщику"'
        : '';
      html += '<div class="row"' + clickable + '>';
      html += '<div class="rank">' + (i + 1) + '.</div>';
      html += '<div class="avatar">' + getInitials(name) + '</div>';
      html += '<div class="name">' + escapeHtml(name) + '</div>';
      html += '<div class="qty">' + e.qty + '<small>шт.</small></div></div>';
    });
    html += '</div></div></div>';
  }

  // v2.43.36: блок «Журнал участия» — из production_work_sessions
  if (d.sessions && (d.sessions.total || (d.sessions.by_employee && d.sessions.by_employee.length) || (d.sessions.entries && d.sessions.entries.length))) {
    const sb = d.sessions;
    const sbTotal = sb.total || {};
    const totalHours = Number(sbTotal.total_hours || (sb.by_employee || []).reduce((sum, e) => sum + Number(e.hours || 0), 0));
    const totalEntries = Number(sbTotal.total_entries || (sb.entries || []).length);
    const totalEmployees = Number(sbTotal.employees_count || (sb.by_employee || []).length);
    const fmtH = (h) => (h % 1 === 0 ? h : h.toFixed(1));
    // v2.43.44: средняя нагрузка в день — по числу разных дат в by_day (не пустых)
    const workingDays = (sb.by_day || []).filter(x => Number(x.hours || 0) > 0).length;
    const avgPerDay = workingDays > 0 ? (totalHours / workingDays) : 0;

    html += '<div class="section"><h3 class="section-title"><span><i class="ti ti-history" style="margin-right:6px;color:var(--brand);"></i>Журнал участия</span></h3></div>';
    // 4 KPI-карточки
    html += '<div class="kpi-grid">';
    html += '<div class="kpi-card kpi-amber"><div class="kpi-icon"><i class="ti ti-clock-hour-4"></i></div>' +
              '<div class="kpi-text"><div class="label">Часов отработано</div>' +
              '<div class="value">' + fmtH(totalHours) + 'ч</div></div></div>';
    html += '<div class="kpi-card kpi-blue"><div class="kpi-icon"><i class="ti ti-list-numbers"></i></div>' +
              '<div class="kpi-text"><div class="label">Записей</div>' +
              '<div class="value">' + totalEntries + '</div></div></div>';
    html += '<div class="kpi-card kpi-green"><div class="kpi-icon"><i class="ti ti-users"></i></div>' +
              '<div class="kpi-text"><div class="label">Сборщиков</div>' +
              '<div class="value">' + totalEmployees + '</div></div></div>';
    html += '<div class="kpi-card kpi-violet"><div class="kpi-icon"><i class="ti ti-trending-up"></i></div>' +
              '<div class="kpi-text"><div class="label">В среднем за день</div>' +
              '<div class="value">' + fmtH(avgPerDay) + 'ч</div></div></div>';
    html += '</div>';

    // По сборщикам — с полосками доли часов
    if ((sb.by_employee || []).length) {
      const maxH = Math.max(1, ...sb.by_employee.map(e => Number(e.hours || 0)));
      html += '<div class="section"><h3 class="section-title"><span>По сборщикам — часы</span></h3></div>';
      html += '<div class="ssn-byemp-list">';
      sb.by_employee.forEach(e => {
        const hrs = Number(e.hours || 0);
        const initials = getInitials(e.short_name || e.full_name || '?');
        const colorIdx = ((e.employee_id || 0) % 8);
        const pct = (hrs / maxH) * 100;
        const share = totalHours > 0 ? (hrs / totalHours * 100) : 0;
        html += '<div class="ssn-byemp-row">' +
                  '<div class="pkb-wl-avatar ac-' + colorIdx + '" style="width:32px;height:32px;font-size:11px;flex-shrink:0;">' + escapeHtml(initials) + '</div>' +
                  '<div class="ssn-byemp-mid">' +
                    '<div class="ssn-byemp-top">' +
                      '<span class="ssn-byemp-name">' + escapeHtml(e.short_name || e.full_name || ('#' + e.employee_id)) + '</span>' +
                      '<span class="ssn-byemp-stats"><b>' + fmtH(hrs) + 'ч</b> · ' + (e.entries || 0) + ' зап. · ' + share.toFixed(0) + '%</span>' +
                    '</div>' +
                    '<div class="ssn-byemp-bar"><div class="ssn-byemp-bar-fill ac-fill-' + colorIdx + '" style="width:' + pct + '%;"></div></div>' +
                  '</div>' +
                '</div>';
      });
      html += '</div>';
    }

    // Последние записи — с группировкой по датам
    if ((sb.entries || []).length) {
      html += '<div class="section"><h3 class="section-title">' +
                '<span>Последние записи</span>' +
                '<span style="font-weight:400;color:var(--text-light);font-size:12.5px;">' + sb.entries.length + ' из ' + totalEntries + '</span>' +
              '</h3></div>';
      html += '<div class="ssn-entries-list">';
      let prevDate = null;
      sb.entries.forEach(s => {
        const initials = getInitials(s.employee_short_name || s.employee_full_name || '?');
        const avColorIdx = ((s.employee_id || 0) % 8);
        const dateStr = s.session_date ? formatPkbDate(s.session_date) : '—';
        const hrs = (s.hours != null) ? Number(s.hours) : null;
        const hoursStr = (hrs != null && hrs > 0) ? (fmtH(hrs) + 'ч') : '';
        const modelStr = s.model_name
          ? ((s.model_article ? s.model_article + ' · ' : '') + s.model_name)
          : '';
        const contractStr = s.contract_number
          ? ('№' + String(s.contract_number).replace(/^[№#\s]+/, '') + (s.contractor_name ? ' · ' + s.contractor_name : ''))
          : '';
        const roleLabel = s.role === 'main' ? 'главный' : 'соисполнитель';
        const roleCls   = s.role === 'main' ? 'pwd-role-main' : 'pwd-role-co';
        // Заголовок-разделитель если новая дата
        if (s.session_date !== prevDate) {
          html += '<div class="ssn-date-divider"><i class="ti ti-calendar-event"></i> ' + escapeHtml(dateStr) + '</div>';
          prevDate = s.session_date;
        }
        // v2.45.164: проваливаемся в карточку работы (что за работа, кто и что делал)
        const _clickable = !!s.work_id;
        html += '<div class="ssn-entry' + (_clickable ? ' ssn-entry-click' : '') + '"' +
                  (_clickable ? ' onclick="openProductionWorkDetail(' + s.work_id + ')" style="cursor:pointer;"' : '') + '>' +
                  '<div class="pkb-wl-avatar ac-' + avColorIdx + '" style="width:36px;height:36px;font-size:12px;flex-shrink:0;">' + escapeHtml(initials) + '</div>' +
                  '<div class="ssn-entry-body">' +
                    '<div class="ssn-entry-top">' +
                      '<span class="ssn-entry-name">' + escapeHtml(s.employee_short_name || s.employee_full_name || ('#' + s.employee_id)) +
                        ' <span class="pwd-role-badge ' + roleCls + '">' + roleLabel + '</span>' +
                      '</span>' +
                      (hoursStr ? '<span class="ssn-entry-hours">' + escapeHtml(hoursStr) + '</span>' : '<span></span>') +
                    '</div>' +
                    (modelStr || contractStr ? '<div class="ssn-entry-work">' +
                      (modelStr ? '<i class="ti ti-package"></i> ' + escapeHtml(modelStr) : '') +
                      (contractStr ? ' <span style="color:var(--text-light);">· ' + escapeHtml(contractStr) + '</span>' : '') +
                    '</div>' : '') +
                    (s.stage_name ? '<div class="ssn-entry-work" style="color:var(--text-light);"><i class="ti ti-tool"></i> ' + escapeHtml(s.stage_name) + '</div>' : '') +
                    (s.note ? '<div class="ssn-entry-note">' + escapeHtml(s.note) + '</div>' : '') +
                  '</div>' +
                  (_clickable ? '<i class="ti ti-chevron-right" style="color:var(--text-light);align-self:center;flex-shrink:0;font-size:18px;"></i>' : '') +
                '</div>';
      });
      html += '</div>';
    }
  }

  // ЭТАП 31.9: кнопки быстрого скачивания за активный период
  html += '<div class="section"><h3 class="section-title">Скачать отчёт за выбранный период' +
    (selectedName ? ' <small style="font-weight:400;color:var(--text-light);">· ' + escapeHtml(selectedName) + '</small>' : '') +
    '</h3></div>';
  html += '<div class="report-buttons">';
  if (hasAssemblyData) {
    html += '<button onclick="quickExportSummary(\'xlsx\')" title="Только сборки за период"><i class="ti ti-file-spreadsheet"></i><span>Excel сборок</span></button>';
    html += '<button onclick="quickExportSummary(\'pdf\')" title="Только сборки за период"><i class="ti ti-file-text"></i><span>PDF сборок</span></button>';
  }
  html += '<button onclick="quickExportSessions()" title="Excel: журнал участия за период"><i class="ti ti-history"></i><span>Excel журнал участия</span></button>';
  html += '<button onclick="askExportActivityFormat()" title="Хронологический отчёт: сборки + помощь"><i class="ti ti-list-details"></i><span>Активность</span></button>';
  html += '</div>';
  html += '<div style="text-align:center;padding:6px 18px 14px;font-size:12px;color:var(--text-light);">' +
    'Нужны произвольные даты или фильтр по типам работ? <a onclick="openExportAssembliesModal()" style="color:var(--brand);cursor:pointer;font-weight:500;">Расширенные параметры</a>' +
    '</div>';
  container.innerHTML = html;
}

// v2.35.0: перезаполнение выпадайки сборщиков (вызывается из renderSummary)
function _updateSummaryWorkerSelect(workers) {
  const sel = document.getElementById('summary-worker-select');
  const resetBtn = document.getElementById('summary-worker-reset');
  if (!sel) return;
  const currentVal = state.summaryEmployeeFilter ? String(state.summaryEmployeeFilter) : '';
  // Если выбранного нет в списке за период — добавляем его как disabled, чтобы UI не сбросился
  let html = '<option value="">Все сборщики</option>';
  let foundCurrent = false;
  workers.forEach(w => {
    if (String(w.id) === currentVal) foundCurrent = true;
    const name = w.short_name || w.full_name || '—';
    html += '<option value="' + w.id + '">' + escapeHtml(name) + ' · ' + w.qty + ' шт.</option>';
  });
  if (currentVal && !foundCurrent) {
    // Сборщик отфильтрован, у него нет работ за период — даём остаться выбранным
    const fromState = state._summaryWorkerName || ('ID ' + currentVal);
    html += '<option value="' + currentVal + '">' + escapeHtml(fromState) + ' · 0 шт.</option>';
  }
  sel.innerHTML = html;
  sel.value = currentVal;
  sel.classList.toggle('has-filter', !!currentVal);
  if (resetBtn) resetBtn.style.display = currentVal ? 'inline-flex' : 'none';
}

// v2.35.0: смена фильтра по сборщику
function onSummaryWorkerChange(val) {
  const newVal = val ? parseInt(val, 10) : null;
  if (state.summaryEmployeeFilter === newVal) return;
  state.summaryEmployeeFilter = newVal;
  // Запомним имя на случай нулевых результатов (см. _updateSummaryWorkerSelect)
  if (newVal) {
    const sel = document.getElementById('summary-worker-select');
    if (sel) {
      const opt = sel.querySelector('option[value="' + newVal + '"]');
      if (opt) state._summaryWorkerName = opt.textContent.split(' · ')[0];
    }
  } else {
    state._summaryWorkerName = null;
  }
  loadSummary();
}

// v2.42.0: разноцветная палитра вместо синих оттенков
const SUMMARY_PALETTE = [
  '#2563EB', // blue
  '#EA580C', // orange
  '#0891B2', // cyan
  '#D4537E', // pink
  '#1D9E75', // teal
  '#7F77DD', // purple
  '#BA7517', // amber
  '#E24B4A', // red
  '#0EA5E9', // sky
  '#639922', // green
];

function renderPieChart(byDir, totalQty) {
  let acc = 0, svgArcs = '', legendHtml = '';
  byDir.forEach((d, idx) => {
    const pct = d.qty / totalQty * 100;
    const color = SUMMARY_PALETTE[idx % SUMMARY_PALETTE.length];
    svgArcs += '<circle cx="18" cy="18" r="15.9" fill="none" stroke="' + color + '" stroke-width="3.2" ' +
               'stroke-dasharray="' + pct.toFixed(2) + ' ' + (100 - pct).toFixed(2) + '" ' +
               'stroke-dashoffset="' + (-acc).toFixed(2) + '" ' +
               'transform="rotate(-90 18 18)"/>';
    acc += pct;
    legendHtml += '<div class="legend-row">' +
      '<span class="legend-dot" style="background:' + color + '"></span>' +
      '<span class="legend-name">' + escapeHtml(d.direction) + '</span>' +
      '<span class="legend-val">' + d.qty + ' (' + Math.round(pct) + '%)</span></div>';
  });
  return '<div class="pie"><svg viewBox="0 0 36 36">' + svgArcs +
    '<text x="18" y="20" text-anchor="middle" style="font-size:6px; font-weight:600; fill:#1B2030;">' + totalQty + '</text>' +
    '</svg><div class="pie-legend">' + legendHtml + '</div></div>';
}

// ============ СОТРУДНИКИ ============

// ============================================================================
// v2.8.2: СПРАВОЧНИК ДОЛЖНОСТЕЙ
// ============================================================================

async function loadPositions() {
  const container = document.getElementById('positions-list');
  if (!container) return;
  const isDirector = state.user && (state.user.roles || []).includes('director');
  if (!isDirector) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-lock"></i>Доступно только директору</div>';
    return;
  }
  container.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try {
    const d = await apiGet('/api/positions?include_inactive=true');
    cache.positions = d;
    renderPositions(d);
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function renderPositions(d) {
  const container = document.getElementById('positions-list');
  if (!container) return;
  const positions = d.positions || [];
  const active = positions.filter(p => p.is_active);
  const inactive = positions.filter(p => !p.is_active);

  const subtitle = document.getElementById('positions-subtitle');
  if (subtitle) subtitle.textContent = active.length + ' активных · ' + inactive.length + ' скрытых';

  if (active.length === 0 && inactive.length === 0) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-briefcase"></i>Должностей нет<br><br><button class="btn btn-primary" onclick="openNewPositionPrompt()" style="margin: 0 auto;"><i class="ti ti-plus"></i> Создать первую</button></div>';
    return;
  }

  let html = '';
  if (active.length) {
    html += '<div class="section-label">Активные · ' + active.length + '</div><div class="card">';
    active.forEach(p => html += renderPositionRow(p));
    html += '</div>';
  }
  if (inactive.length) {
    html += '<div class="section-label">Скрытые · ' + inactive.length + '</div><div class="card">';
    inactive.forEach(p => html += renderPositionRow(p));
    html += '</div>';
  }
  container.innerHTML = html;
}

function renderPositionRow(p) {
  const usage = (p.usage_count || 0);
  const usageText = usage > 0
    ? '<span style="color: var(--text-light); font-size: 12.5px;">используется у ' + usage + ' сотр.</span>'
    : '<span style="color: var(--text-light); font-size: 12.5px;">никто не использует</span>';
  const inactiveCls = p.is_active ? '' : ' emp-inactive';
  let actions = '';
  if (p.is_active) {
    actions = '<button class="icon-btn" onclick="event.stopPropagation(); renamePosition(' + p.id + ')" title="Переименовать"><i class="ti ti-pencil"></i></button>' +
              '<button class="icon-btn" onclick="event.stopPropagation(); deletePositionConfirm(' + p.id + ')" title="Скрыть"><i class="ti ti-archive"></i></button>';
  } else {
    actions = '<button class="icon-btn" onclick="event.stopPropagation(); restorePosition(' + p.id + ')" title="Восстановить"><i class="ti ti-rotate"></i></button>';
  }
  return '<div class="employee-row' + inactiveCls + '" style="cursor: default;">' +
    '<div class="emp-info">' +
      '<div class="emp-name">' + escapeHtml(p.name) + '</div>' +
      '<div class="emp-meta">' + usageText + '</div>' +
    '</div>' +
    '<div style="display:flex; gap:4px; align-items:center;">' + actions + '</div>' +
  '</div>';
}

async function openNewPositionPrompt() {
  const name = (window.prompt('Название должности (напр. «Электромонтажник»):') || '').trim();
  if (!name) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/positions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ name }),
    });
    const data = await r.json();
    if (!r.ok) {
      showToast(data.message || data.error || 'Ошибка', 'error');
      return;
    }
    showToast('Должность создана', 'success');
    cache.positions = null;
    cache.positionsActive = null;
    loadPositions();
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

async function renamePosition(posId) {
  const current = ((cache.positions && cache.positions.positions) || []).find(p => p.id === posId);
  if (!current) return;
  const name = (window.prompt('Новое название должности:', current.name) || '').trim();
  if (!name || name === current.name) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/positions/' + posId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ name }),
    });
    const data = await r.json();
    if (!r.ok) {
      showToast(data.message || data.error || 'Ошибка', 'error');
      return;
    }
    showToast('Должность переименована', 'success');
    cache.positions = null;
    cache.positionsActive = null;
    loadPositions();
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

async function deletePositionConfirm(posId) {
  const current = ((cache.positions && cache.positions.positions) || []).find(p => p.id === posId);
  if (!current) return;
  let msg = 'Скрыть должность «' + current.name + '»?';
  if (current.usage_count > 0) {
    msg += '\n\nЕё используют ' + current.usage_count + ' сотр. — у них поле «Должность» останется как есть, но из выпадающего списка должность пропадёт.';
  }
  if (!confirm(msg)) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/positions/' + posId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      showToast(data.message || data.error || 'Ошибка', 'error');
      return;
    }
    showToast('Должность скрыта', 'success');
    cache.positions = null;
    cache.positionsActive = null;
    loadPositions();
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

async function restorePosition(posId) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/positions/' + posId + '?restore=true', {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      showToast(data.message || data.error || 'Ошибка', 'error');
      return;
    }
    showToast('Должность восстановлена', 'success');
    cache.positions = null;
    cache.positionsActive = null;
    loadPositions();
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// Загружаем активные должности и кладём в кэш — для datalist в форме сотрудника
async function ensurePositionsLoaded() {
  if (cache.positionsActive) return cache.positionsActive;
  try {
    const d = await apiGet('/api/positions');
    cache.positionsActive = d;
    return d;
  } catch (e) {
    return { positions: [] };
  }
}

// ============================================================================
// КОНЕЦ СПРАВОЧНИКА ДОЛЖНОСТЕЙ
// ============================================================================

// ============================================================================
// ЭТАП 29: УРОВНИ ДОСТУПА
// ============================================================================

// Открытые карточки уровней (id → bool). Состояние раскрытия.
state.accessLevelsOpen = {};
// Локальные изменения в карточках (id → { name, permissions: Set })
state.accessLevelsDraft = {};

async function loadAccessLevels() {
  const container = document.getElementById('access-levels-list');
  if (!container) return;
  if (!hasPermission('hr.manage_access')) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-lock"></i>Доступ к этой странице есть только у тех, у кого включено «Настраивать уровни доступа»</div>';
    return;
  }
  container.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try {
    // Грузим уровни и реестр разрешений параллельно
    const [levelsData, permsData] = await Promise.all([
      apiGet('/api/access-levels?include_inactive=true'),
      apiGet('/api/access-levels/permissions'),
    ]);
    cache.accessLevels = levelsData;
    cache.permissionsRegistry = permsData;
    state.accessLevelsDraft = {};  // сбрасываем черновики
    renderAccessLevels();
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function renderAccessLevels() {
  const container = document.getElementById('access-levels-list');
  if (!container) return;
  const levels = (cache.accessLevels && cache.accessLevels.levels) || [];
  const subtitle = document.getElementById('access-subtitle');
  if (subtitle) {
    const sysCnt = levels.filter(l => l.is_system).length;
    subtitle.textContent = levels.length + ' уровней · ' + sysCnt + ' системных';
  }
  if (levels.length === 0) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-shield-lock"></i>Уровней нет</div>';
    return;
  }
  container.innerHTML = levels.map(renderAccessLevelCard).join('');
}

function renderAccessLevelCard(level) {
  const isOpen = !!state.accessLevelsOpen[level.id];
  const draft = state.accessLevelsDraft[level.id] || {
    name: level.name,
    permissions: new Set(level.permissions || []),
  };
  // Сохраним в state на случай первого рендера
  state.accessLevelsDraft[level.id] = draft;

  const usage = (level.usage_count || 0);
  const usageText = usage > 0 ? (usage + ' сотр.') : 'не используется';

  let html = '<div class="access-card' + (isOpen ? ' open' : '') + '" id="access-card-' + level.id + '">';

  // Header
  html += '<div class="access-card-header" onclick="toggleAccessCard(' + level.id + ')">';
  html += '<i class="ti ti-chevron-right access-card-chevron"></i>';
  html += '<div style="flex:1;">';
  html += '<div class="access-card-name">' + escapeHtml(level.name);
  if (level.is_system) {
    html += '<span class="access-card-badge">системный</span>';
  }
  html += '</div>';
  html += '<div class="access-card-meta">' + escapeHtml(usageText) + ' · ' +
          (draft.permissions.size) + ' разрешений</div>';
  html += '</div></div>';

  // Body
  if (isOpen) {
    html += '<div class="access-card-body">';

    // Имя
    html += '<label style="display:block; font-size:11.5px; font-weight:700; text-transform:uppercase; color:var(--text-light); margin-bottom:6px; letter-spacing:0.5px;">Название</label>';
    html += '<input type="text" class="access-name-input" value="' + escapeHtml(draft.name) +
            '"' + (level.is_system ? ' disabled title="Системный уровень — название менять нельзя"' : '') +
            ' oninput="onAccessNameChange(' + level.id + ', this.value)">';

    // Группы permissions
    const registry = (cache.permissionsRegistry && cache.permissionsRegistry.permissions) || [];
    // Группируем по полю group, сохраняя порядок из registry
    const groups = [];
    const groupMap = {};
    registry.forEach(p => {
      if (!groupMap[p.group]) {
        groupMap[p.group] = { name: p.group, items: [] };
        groups.push(groupMap[p.group]);
      }
      groupMap[p.group].items.push(p);
    });

    groups.forEach(g => {
      // v2.9.2: счётчик "сколько отмечено / всего в группе" + состояние all/some/none
      const total = g.items.length;
      const onCount = g.items.filter(p => draft.permissions.has(p.key)).length;
      let stateClass = '';
      if (onCount === total && total > 0) stateClass = ' all';
      else if (onCount > 0) stateClass = ' some';
      const groupKeysJson = JSON.stringify(g.items.map(p => p.key)).replace(/"/g, '&quot;');

      html += '<div class="access-perm-group">';
      html += '<div class="access-perm-group-title' + stateClass + '" ' +
              'onclick="event.stopPropagation(); toggleAccessGroup(' + level.id + ', &quot;' + escapeHtml(g.name) + '&quot;, ' + groupKeysJson + ')">' +
              '<div class="group-toggle"><i class="ti ti-check"></i></div>' +
              '<span>' + escapeHtml(g.name) + '</span>' +
              '<span class="group-count">' + onCount + ' / ' + total + '</span>' +
              '</div>';

      g.items.forEach(p => {
        const checked = draft.permissions.has(p.key);
        const safeKey = p.key.replace(/'/g, "\\'");
        html += '<div class="access-perm-row' + (checked ? ' checked' : '') + '"' +
                ' onclick="event.stopPropagation(); onAccessPermToggle(' + level.id + ', \'' + safeKey + '\', ' + (!checked) + ')">' +
                '<div class="perm-check"><i class="ti ti-check"></i></div>' +
                '<span class="access-perm-label">' + escapeHtml(p.label) + '</span>' +
                '</div>';
      });
      html += '</div>';
    });

    // Кнопки
    html += '<div class="access-card-actions">';
    if (!level.is_system) {
      const canDelete = usage === 0;
      html += '<button class="btn btn-secondary" onclick="deleteAccessLevel(' + level.id + ')"' +
              (canDelete ? '' : ' disabled title="Уровень привязан к ' + usage + ' сотр. — сначала переназначьте их"') +
              '><i class="ti ti-trash"></i> Удалить</button>';
    }
    html += '<button class="btn btn-primary" onclick="saveAccessLevel(' + level.id + ')"><i class="ti ti-check"></i> Сохранить</button>';
    html += '</div>';

    html += '</div>';
  }

  html += '</div>';
  return html;
}

function toggleAccessCard(levelId) {
  state.accessLevelsOpen[levelId] = !state.accessLevelsOpen[levelId];
  renderAccessLevels();
}

function onAccessNameChange(levelId, value) {
  const draft = state.accessLevelsDraft[levelId];
  if (!draft) return;
  draft.name = value;
}

function onAccessPermToggle(levelId, permKey, checked) {
  const draft = state.accessLevelsDraft[levelId];
  if (!draft) return;
  if (checked) draft.permissions.add(permKey);
  else draft.permissions.delete(permKey);
  // Перерисуем чтобы счётчик в шапке обновился
  renderAccessLevels();
}

// v2.9.2: групповое переключение — клик на заголовок группы
// Логика: если в группе все включены — снимаем все; иначе включаем все.
function toggleAccessGroup(levelId, groupName, keys) {
  const draft = state.accessLevelsDraft[levelId];
  if (!draft || !Array.isArray(keys)) return;
  const allOn = keys.every(k => draft.permissions.has(k));
  if (allOn) {
    keys.forEach(k => draft.permissions.delete(k));
  } else {
    keys.forEach(k => draft.permissions.add(k));
  }
  renderAccessLevels();
}

async function saveAccessLevel(levelId) {
  const draft = state.accessLevelsDraft[levelId];
  if (!draft) return;
  const level = ((cache.accessLevels && cache.accessLevels.levels) || []).find(l => l.id === levelId);
  if (!level) return;
  const payload = { permissions: Array.from(draft.permissions) };
  if (!level.is_system && draft.name && draft.name.trim() !== level.name) {
    payload.name = draft.name.trim();
  }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/access-levels/' + levelId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok) {
      showToast(data.message || data.error || 'Ошибка', 'error');
      return;
    }
    showToast('Уровень сохранён', 'success');
    cache.accessLevels = null;
    cache.accessLevelsActive = null;        // выпадашка в форме сотрудника пере-подтянет
    cache.employees = null;                 // список сотрудников — теперь могут другие effective roles
    // Если редактировали свой собственный уровень — перезагружаем /api/me, иначе UI рассинхронизирован
    if (state.user && state.user.access_level_id === levelId) {
      apiGet('/api/me').then(me => { state.user = me; renderProfile(); applyPermissionsToUI(); });
    }
    loadAccessLevels();
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

async function openNewAccessLevel() {
  if (!hasPermission('hr.manage_access')) return;
  const name = (window.prompt('Название нового уровня (напр. «Кладовщик»):') || '').trim();
  if (!name) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/access-levels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ name, permissions: [] }),
    });
    const data = await r.json();
    if (!r.ok) {
      showToast(data.message || data.error || 'Ошибка', 'error');
      return;
    }
    showToast('Уровень создан — настройте права галочками', 'success');
    cache.accessLevels = null;
    cache.accessLevelsActive = null;
    state.accessLevelsOpen[data.id] = true;  // сразу раскрыть карточку
    loadAccessLevels();
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

async function deleteAccessLevel(levelId) {
  const level = ((cache.accessLevels && cache.accessLevels.levels) || []).find(l => l.id === levelId);
  if (!level) return;
  if (!confirm('Удалить уровень «' + level.name + '»?')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/access-levels/' + levelId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      showToast(data.message || data.error || 'Ошибка', 'error');
      return;
    }
    showToast('Уровень удалён', 'success');
    cache.accessLevels = null;
    cache.accessLevelsActive = null;
    delete state.accessLevelsOpen[levelId];
    delete state.accessLevelsDraft[levelId];
    loadAccessLevels();
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// Загружает активные уровни — для выпадашки в форме сотрудника
async function ensureAccessLevelsLoaded() {
  if (cache.accessLevelsActive) return cache.accessLevelsActive;
  try {
    const d = await apiGet('/api/access-levels');
    cache.accessLevelsActive = d;
    return d;
  } catch (e) {
    return { levels: [] };
  }
}

// Применяет права к UI: скрывает пункты меню, кнопки и т.д.
// v2.45.404: Михаил Шевелёв (мастер) пока не заполняет утреннюю готовность и не
// работает с оплатой — точечно прячем для него утреннее окно «Начать смену» и
// пункт меню «На оплату». Определяем по ФИО (другого стабильного признака нет).
function _isShevelevMaster() {
  const nm = (state.user && (state.user.full_name || state.user.name) || '');
  return /шевел[её]в/i.test(nm) && /михаил/i.test(nm);
}

function applyPermissionsToUI() {
  // Сотрудники в Кадрах — только если hr.manage_employees
  const navEmps = document.querySelector('#sidebar-hr .nav-item[data-nav="employees"]');
  if (navEmps) navEmps.style.display = hasPermission('hr.manage_employees') ? '' : 'none';

  // Должности — только если hr.manage_positions
  const navPos = document.getElementById('nav-positions');
  if (navPos) navPos.style.display = hasPermission('hr.manage_positions') ? '' : 'none';

  // Уровни доступа — только если hr.manage_access
  const navAcc = document.getElementById('nav-access-levels');
  if (navAcc) navAcc.style.display = hasPermission('hr.manage_access') ? '' : 'none';

  // Раздел Кадры в шапке — если есть хоть одно право в Кадрах
  const hrTabs = document.querySelectorAll('.section-tab[data-section="hr"], .m-section-tabs button[data-section="hr"]');
  const canSeeHR = hasAnyPermission('hr.view_vacations', 'hr.create_vacations',
    'hr.manage_employees', 'hr.manage_positions', 'hr.manage_access');
  hrTabs.forEach(t => { t.style.display = canSeeHR ? '' : 'none'; });

  // v2.45.404: Михаилу Шевелёву пункт «На оплату» не нужен — он с оплатой не работает
  if (_isShevelevMaster()) {
    const _payNav = document.getElementById('sb-home-pay');
    if (_payNav) _payNav.style.display = 'none';
  }

  // v2.45.406: Михаил Шевелёв (мастер-сборщик) работает только с производством и
  // сборкой к отгрузке. Оставляем в верхней навигации лишь «Главную» (там его
  // запросы «к отгрузке» с QR) и «Производство»; остальные разделы прячем.
  if (_isShevelevMaster()) {
    const ALLOWED = ['home', 'production'];
    document.querySelectorAll('.section-tab, .m-section-tabs button').forEach(t => {
      t.style.display = ALLOWED.includes(t.dataset.section) ? '' : 'none';
    });
  }

  // v2.45.56: Админ-инструменты в сайдбаре Снабжения — только директору
  const adminTools = document.getElementById('sb-supply-admin-tools');
  if (adminTools) {
    const isDir = state.user && (state.user.roles || []).includes('director');
    adminTools.style.display = isDir ? '' : 'none';
  }

  // v2.45.346: Монтаж — вкладка видна при installation.view; создание — при installation.manage
  const instTabs = document.querySelectorAll('.section-tab[data-section="installation"], .m-section-tabs button[data-section="installation"]');
  const canSeeInstall = hasPermission('installation.view');
  instTabs.forEach(t => { t.style.display = canSeeInstall ? '' : 'none'; });
  const canManageInstall = hasPermission('installation.manage');
  ['nav-install-new', 'install-new-btn', 'install-new-mobile', 'install-fab'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = canManageInstall ? '' : 'none';
  });

  // v2.45.350: «чистый» монтажник — есть installation.view и нет ни одного
  // «офисного» права. Ему показываем ТОЛЬКО раздел «Монтаж»: прячем остальные
  // вкладки, кнопку «Фото УПД» и сразу открываем монтаж.
  const OFFICE_PERMS = [
    'home.view_activity', 'home.view_finance_kpi',
    'production.view', 'sales.view', 'warehouse.view', 'logistics.view',
    'supply.view', 'defects.view', 'tasks.view_all',
    'hr.view_vacations', 'hr.create_vacations', 'hr.manage_employees',
    'hr.manage_positions', 'hr.manage_access',
  ];
  const installerOnly = canSeeInstall && !OFFICE_PERMS.some(p => hasPermission(p));
  if (installerOnly) {
    document.querySelectorAll('.section-tab, .m-section-tabs button').forEach(t => {
      t.style.display = (t.dataset.section === 'installation') ? '' : 'none';
    });
    const cam = document.getElementById('si-camera-top-btn');
    if (cam) cam.style.display = 'none';
    // v2.45.383: монтажнику уведомления не нужны — он видит только свой монтаж по договору
    const _bell = document.getElementById('notif-bell-btn');
    if (_bell) _bell.style.display = 'none';
    const _ntab = document.querySelector('.tab25[data-main-tab="notifications"]');
    if (_ntab) _ntab.style.display = 'none';
    // при входе монтажник попадает сразу в «Монтаж», а не на «Главную»
    if (state.currentSection !== 'installation') {
      try { selectSection('installation'); } catch (_) {}
    }
  }
}

// ============================================================================
// КОНЕЦ ЭТАПА 29
// ============================================================================

async function loadEmployees() {
  const container = document.getElementById('employees-list');
  if (cache.employees) { renderEmployees(cache.employees); return; }
  container.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try { const d = await apiGet('/api/employees?include_inactive=true'); cache.employees = d; renderEmployees(d); }
  catch (e) { container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>'; }
}

function renderEmployees(d) {
  const container = document.getElementById('employees-list');
  const active = d.employees.filter(e => e.is_active);
  const inactive = d.employees.filter(e => !e.is_active);

  // Обновляем подзаголовок и видимость кнопок «Новый сотрудник»
  const isDirector = state.user && (state.user.roles || []).includes('director');
  const subtitle = document.getElementById('emp-subtitle');
  if (subtitle) subtitle.textContent = active.length + ' активных · ' + inactive.length + ' деактивированных';
  const newBtn = document.getElementById('emp-new-btn');
  const mobileNewBtn = document.getElementById('emp-mobile-new');
  [newBtn, mobileNewBtn].forEach(b => { if (b) b.style.display = isDirector ? '' : 'none'; });

  let html = '';
  if (active.length === 0 && inactive.length === 0) {
    let emptyHtml = '<div class="empty-block"><i class="ti ti-users"></i>Сотрудников нет';
    if (isDirector) {
      emptyHtml += '<br><br><button class="btn btn-primary" onclick="openNewEmployee()" style="margin: 0 auto;"><i class="ti ti-plus"></i> Создать первого</button>';
    }
    emptyHtml += '</div>';
    container.innerHTML = emptyHtml;
    return;
  }
  if (active.length) {
    html += '<div class="section-label">Активные · ' + active.length + '</div><div class="card">';
    active.forEach(e => html += renderEmployeeRow(e, isDirector));
    html += '</div>';
  }
  if (inactive.length) {
    html += '<div class="section-label">Деактивированные · ' + inactive.length + '</div><div class="card">';
    inactive.forEach(e => html += renderEmployeeRow(e, isDirector));
    html += '</div>';
  }
  container.innerHTML = html;
}

function renderEmployeeRow(e, isDirector) {
  const meta = [];
  // ЭТАП 29: основной маркер — уровень доступа (а не legacy-роли)
  if (e.access_level_name) meta.push(e.access_level_name);
  if (e.position) meta.push(e.position);
  if (e.phone) meta.push(e.phone);
  if (e.email) meta.push(e.email);
  if (e.tab_number) meta.push('таб. ' + e.tab_number);
  const inactiveClass = e.is_active ? '' : ' emp-inactive';
  const clickAttr = isDirector ? ' onclick="openEditEmployee(' + e.id + ')"' : '';
  const arrow = isDirector ? '<div class="emp-arrow"><i class="ti ti-chevron-right"></i></div>' : '';
  // v2.45.27: для директора — статус пароля + быстрые кнопки прямо в карточке
  let pwdLine = '';
  if (isDirector) {
    if (e.has_password) {
      const setAt = e.password_set_at ? (' ' + _fmtPwdDate(e.password_set_at)) : '';
      pwdLine = '<div class="emp-pwd-line emp-pwd-yes">' +
        '<i class="ti ti-key" style="color:#0A5B41;"></i> Пароль установлен' + escapeHtml(setAt) +
        '<button class="emp-pwd-btn" onclick="event.stopPropagation(); generateEmployeePassword(' + e.id + ',\'' + escapeHtml(e.full_name || '').replace(/'/g, "\\'") + '\',true)" title="Сгенерировать новый">' +
          '<i class="ti ti-refresh"></i> Новый</button>' +
        '<button class="emp-pwd-btn emp-pwd-btn-danger" onclick="event.stopPropagation(); clearEmployeePassword(' + e.id + ',\'' + escapeHtml(e.full_name || '').replace(/'/g, "\\'") + '\')" title="Сбросить пароль">' +
          '<i class="ti ti-x"></i> Сбросить</button>' +
      '</div>';
    } else {
      pwdLine = '<div class="emp-pwd-line emp-pwd-no">' +
        '<i class="ti ti-key-off" style="color:var(--text-light);"></i> Пароль не установлен' +
        '<button class="emp-pwd-btn emp-pwd-btn-primary" onclick="event.stopPropagation(); generateEmployeePassword(' + e.id + ',\'' + escapeHtml(e.full_name || '').replace(/'/g, "\\'") + '\',false)" title="Сгенерировать пароль">' +
          '<i class="ti ti-key"></i> Сгенерировать</button>' +
      '</div>';
    }
  }
  return '<div class="employee-row' + inactiveClass + '"' + clickAttr + '>' +
    '<div class="emp-info"><div class="emp-name">' + escapeHtml(e.full_name || e.short_name || '—') +
       (e.has_password ? ' <i class="ti ti-key" title="Установлен пароль для входа без Telegram" style="font-size:13px; color:var(--text-light); margin-left:4px; vertical-align:middle;"></i>' : '') +
    '</div>' +
    '<div class="emp-meta">' + escapeHtml(meta.join(' · ') || '—') + '</div>' +
    pwdLine +
    '</div>' +
    arrow + '</div>';
}

// v2.45.27: «02.06.2026» из ISO даты password_set_at
function _fmtPwdDate(iso) {
  if (!iso) return '';
  try {
    const s = String(iso);
    // ожидаем формат "YYYY-MM-DD HH:MM:SS" или "YYYY-MM-DDTHH:MM:SS"
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3] + '.' + m[2] + '.' + m[1];
    return s.slice(0, 10);
  } catch (e) { return ''; }
}

async function generateEmployeePassword(empId, empName, hasOld) {
  const msg = hasOld
    ? 'Сгенерировать НОВЫЙ пароль для «' + empName + '»? Старый перестанет работать сразу.'
    : 'Сгенерировать пароль для «' + empName + '»?';
  if (!confirm(msg)) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/employees/' + empId + '/password/generate', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.password) {
      showToast(d.message || 'Не удалось сгенерировать пароль', 'error');
      return;
    }
    showOneTimePassword(empName, d.password);
    // Перезагрузим список сотрудников чтобы обновился password_set_at
    loadEmployees().catch(() => {});
  } catch (e) { showToast('Ошибка', 'error'); }
}

async function clearEmployeePassword(empId, empName) {
  if (!confirm('Снять пароль у «' + empName + '»? Вход по паролю перестанет работать (Telegram-вход останется).')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/employees/' + empId + '/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ password: null }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось сбросить пароль', 'error');
      return;
    }
    showToast('Пароль снят', 'success');
    loadEmployees().catch(() => {});
  } catch (e) { showToast('Ошибка', 'error'); }
}

// v2.45.27: показываем сгенерированный пароль ОДИН раз — после закрытия модалки
// он остаётся только в виде хеша в БД.
function showOneTimePassword(empName, password) {
  let m = document.getElementById('one-time-pwd-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'one-time-pwd-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) m.classList.remove('visible'); };
    document.body.appendChild(m);
  }
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:480px;">' +
      '<div class="modal-header"><h3><i class="ti ti-key"></i> Пароль сгенерирован</h3>' +
        '<button class="modal-close" onclick="this.closest(\'.modal-overlay\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button></div>' +
      '<div style="padding:20px;">' +
        '<div style="font-size:13.5px;color:var(--text-mid);margin-bottom:10px;">Сотрудник: <b>' + escapeHtml(empName) + '</b></div>' +
        '<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:18px;display:flex;align-items:center;justify-content:space-between;gap:14px;">' +
          '<div id="otp-pwd-value" style="font-family:Menlo,Consolas,\'Courier New\',monospace;font-size:22px;letter-spacing:1.5px;color:var(--text-dark);user-select:all;font-weight:600;">' + escapeHtml(password) + '</div>' +
          '<button class="btn btn-primary btn-small" id="otp-copy-btn" onclick="copyOneTimePassword(\'' + password.replace(/'/g, "\\'") + '\')">' +
            '<i class="ti ti-copy"></i> Копия' +
          '</button>' +
        '</div>' +
        '<div style="margin-top:14px;padding:12px 14px;background:#FFF3CD;border-radius:8px;color:#664D03;font-size:12.5px;line-height:1.5;">' +
          '<i class="ti ti-alert-triangle"></i> <b>Покажем только один раз.</b> Скопируй и отправь сотруднику сейчас. Закроешь модалку — пароль больше не достать (в БД только хеш).' +
        '</div>' +
      '</div>' +
      '<div style="padding:14px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">' +
        '<button class="btn btn-primary" onclick="this.closest(\'.modal-overlay\').classList.remove(\'visible\')"><i class="ti ti-check"></i> Скопировал, закрыть</button>' +
      '</div></div>';
  m.classList.add('visible');
}

async function copyOneTimePassword(pwd) {
  try {
    await navigator.clipboard.writeText(pwd);
    const btn = document.getElementById('otp-copy-btn');
    if (btn) {
      btn.innerHTML = '<i class="ti ti-check"></i> Скопировано';
      setTimeout(() => { if (btn) btn.innerHTML = '<i class="ti ti-copy"></i> Копия'; }, 2000);
    }
    showToast('Пароль в буфере обмена', 'success');
  } catch (e) {
    showToast('Не удалось скопировать — выдели вручную', 'error');
  }
}

// ============================================================================
// ЭТАП 13В: УПРАВЛЕНИЕ СОТРУДНИКАМИ ЧЕРЕЗ PWA
// ============================================================================

// Состояние формы сотрудника
state.employeeFormMode = 'new';       // 'new' или 'edit'
state.currentEmployeeId = null;
state.employeeForm = {
  full_name: '',
  position: '',
  phone: '',
  email: '',                    // ЭТАП 16А
  tab_number: '',
  telegram_id: '',
  roles: [],            // массив строк (legacy — для обратной совместимости)
  _is_active: true,
  password: '',
  _has_password: false,
  _password_action: 'keep',
  access_level_id: null,        // ЭТАП 29: основной способ задания прав
};

// Legacy-список ролей оставлен для совместимости (нигде в форме теперь не используется)
const ROLES_LIST = [
  { code: 'director',   label: 'Директор',       desc: 'Полный доступ ко всему' },
  { code: 'zam',        label: 'Зам директора',  desc: 'Управление продажами, договорами, ценами' },
  { code: 'manager',    label: 'Менеджер',       desc: 'Ведение клиентов, договоров, КП' },
  { code: 'engineer',   label: 'Инженер',        desc: 'Согласование ТЗ, технические задачи' },
  { code: 'master',     label: 'Мастер',         desc: 'Внесение сборок в производстве' },
  { code: 'accountant', label: 'Бухгалтер',      desc: 'Просмотр финансовых отчётов' },
];

function openNewEmployee() {
  if (!state.user || !hasPermission('hr.manage_employees')) {
    showToast('Создавать сотрудников нельзя — нет прав', 'error');
    return;
  }
  state.employeeFormMode = 'new';
  state.currentEmployeeId = null;
  state.employeeForm = {
    full_name: '', position: '', phone: '', email: '', tab_number: '', telegram_id: '',
    roles: [], _is_active: true,
    password: '', _has_password: false, _password_action: 'set',
    access_level_id: null,
  };
  selectSidebarItem('employee-form');
}

function openEditEmployee(empId) {
  if (!state.user || !hasPermission('hr.manage_employees')) {
    showToast('Редактировать нельзя — нет прав', 'error');
    return;
  }
  // Берём сотрудника из кэша
  const emp = (cache.employees && cache.employees.employees || []).find(e => e.id === empId);
  if (!emp) {
    showToast('Сотрудник не найден', 'error');
    return;
  }
  state.employeeFormMode = 'edit';
  state.currentEmployeeId = empId;
  state.employeeForm = {
    full_name: emp.full_name || '',
    position: emp.position || '',
    phone: emp.phone || '',
    email: emp.email || '',
    tab_number: emp.tab_number || '',
    telegram_id: emp.telegram_id ? String(emp.telegram_id) : '',
    roles: [...(emp.roles || [])],
    _is_active: !!emp.is_active,
    password: '',
    _has_password: !!emp.has_password,
    _password_action: 'keep',
    access_level_id: emp.access_level_id || null,
  };
  selectSidebarItem('employee-form');
}

function cancelEmployeeForm() {
  selectSidebarItem('employees');
}

function initEmployeeForm() {
  document.getElementById('empf-title').textContent =
    state.employeeFormMode === 'edit' ? 'Редактирование сотрудника' : 'Новый сотрудник';
  document.getElementById('empf-mobile-title').textContent =
    state.employeeFormMode === 'edit' ? 'Редактирование' : 'Новый сотрудник';
  document.getElementById('empf-subtitle').textContent =
    state.employeeFormMode === 'edit'
      ? 'Изменение данных и ролей'
      : 'После создания сотрудник зайдёт в систему через /login в Telegram-боте';
  renderEmployeeForm();
}

function renderEmployeeForm() {
  const container = document.getElementById('empf-content');
  const f = state.employeeForm;
  const isEdit = state.employeeFormMode === 'edit';

  let html = '';

  // Блок 1: Основные данные
  html += '<div class="sales-form-section">';
  html += '<div class="sales-form-title">Основные данные</div>';
  html += '<div class="sales-form-row cols-1"><div><label>ФИО <span class="req">*</span></label>' +
          '<input type="text" id="empf-full-name" value="' + escapeHtml(f.full_name) + '" placeholder="напр. Иванов Иван Иванович"></div></div>';
  html += '<div class="sales-form-row cols-1"><div><label>Должность <span class="hint" style="text-transform:none; font-weight:400; color:var(--text-light); font-size:11px;">(выберите из списка или впишите своё)</span></label>' +
          '<input type="text" id="empf-position" list="empf-position-list" value="' + escapeHtml(f.position) + '" placeholder="напр. Электромонтажник">' +
          '<datalist id="empf-position-list"></datalist>' +
          '</div></div>';
  html += '<div class="sales-form-row">';
  html += '<div><label>Телефон</label>' +
          '<input type="tel" id="empf-phone" value="' + escapeHtml(f.phone) + '" placeholder="+7 ..."></div>';
  html += '<div><label>Email</label>' +
          '<input type="email" id="empf-email" value="' + escapeHtml(f.email || '') + '" placeholder="ivanov@example.com"></div>';
  html += '</div>';
  html += '<div class="sales-form-row cols-1">';
  html += '<div><label>Табельный номер</label>' +
          '<input type="text" id="empf-tab-number" value="' + escapeHtml(f.tab_number) + '" placeholder="напр. 0034"></div>';
  html += '</div>';
  html += '</div>';

  // Блок 2 (ЭТАП 29): Уровень доступа (заменяет блок «Роли в системе»)
  html += '<div class="sales-form-section">';
  html += '<div class="sales-form-title">Уровень доступа <span class="req" style="color:var(--danger);">*</span> <span style="font-weight:400; font-size:12px; color:var(--text-light); margin-left:4px;">определяет что видит и может делать сотрудник</span></div>';

  // Список уровней из кэша
  const levelsList = (cache.accessLevelsActive && cache.accessLevelsActive.levels) || [];
  const currentLevel = levelsList.find(l => l.id === f.access_level_id) || null;

  html += '<div class="sales-form-row cols-1"><div>';
  html += '<label>Уровень</label>';
  html += '<select id="empf-access-level" style="width:100%;">';
  html += '<option value="">— Выберите уровень —</option>';
  levelsList.forEach(l => {
    const sel = (l.id === f.access_level_id) ? ' selected' : '';
    html += '<option value="' + l.id + '"' + sel + '>' + escapeHtml(l.name) + '</option>';
  });
  html += '</select>';
  html += '</div></div>';

  // Подсказка о содержимом выбранного уровня
  if (currentLevel) {
    const perms = currentLevel.permissions || [];
    if (perms.length === 0) {
      html += '<div style="font-size: 12.5px; color: var(--danger); margin-top: 8px; padding: 8px 12px; background: rgba(244,67,54,0.06); border-radius: 8px;">' +
              '<i class="ti ti-alert-triangle"></i> У этого уровня не выбрано ни одного разрешения — сотрудник не сможет работать в системе.</div>';
    } else {
      // Группируем разрешения для красивого вывода
      const registry = (cache.permissionsRegistry && cache.permissionsRegistry.permissions) || null;
      let summaryHtml = '';
      if (registry) {
        const groups = {};
        const groupOrder = [];
        registry.forEach(p => {
          if (perms.indexOf(p.key) >= 0) {
            if (!groups[p.group]) { groups[p.group] = []; groupOrder.push(p.group); }
            groups[p.group].push(p.label);
          }
        });
        summaryHtml = groupOrder.map(g =>
          '<div style="margin-bottom: 4px;"><b>' + escapeHtml(g) + ':</b> ' +
          escapeHtml(groups[g].join(', ').toLowerCase()) + '</div>'
        ).join('');
      } else {
        summaryHtml = perms.length + ' разрешений';
      }
      html += '<div style="font-size: 12px; color: var(--text-mid); margin-top: 8px; padding: 10px 12px; background: var(--bg); border-radius: 8px; line-height: 1.6;">' +
              '<div style="font-weight: 600; color: var(--text-dark); margin-bottom: 6px;">Что включает «' + escapeHtml(currentLevel.name) + '»:</div>' +
              summaryHtml + '</div>';
    }
  }

  // Ссылка на редактор уровней (если есть право)
  if (hasPermission('hr.manage_access')) {
    html += '<div style="font-size: 12px; color: var(--text-light); margin-top: 8px; text-align: right;">' +
            '<a href="#" onclick="event.preventDefault(); selectSidebarItem(\'access-levels\');" style="color: var(--brand); text-decoration: none;">→ Настроить уровни доступа</a></div>';
  }

  html += '</div>';

  // Блок 3 (ЭТАП 28): пароль для входа без Telegram
  html += '<div class="sales-form-section">';
  html += '<div class="sales-form-title">Пароль для входа <span style="font-weight:400; font-size:12px; color:var(--text-light); margin-left:4px;">' +
          (isEdit ? '(оставьте «не менять», чтобы сохранить текущий)' : '(для тех, кто работает без Telegram)') +
          '</span></div>';

  if (isEdit) {
    // В режиме edit показываем три радио-варианта
    const act = f._password_action || 'keep';
    html += '<div style="display:flex; flex-direction:column; gap:8px; margin-bottom:8px;">';

    // 1. Не менять
    html += '<label class="role-checkbox' + (act === 'keep' ? ' selected' : '') + '" style="cursor:pointer;">' +
      '<input type="radio" name="empf-pw-action" value="keep" ' + (act === 'keep' ? 'checked' : '') + ' style="display:none;" onclick="setEmployeePwAction(\'keep\')">' +
      '<div class="check">' + (act === 'keep' ? '<i class="ti ti-check"></i>' : '') + '</div>' +
      '<div class="role-body">' +
        '<div class="role-name">Не менять</div>' +
        '<div class="role-desc">' + (f._has_password ? 'Пароль установлен — оставить как есть' : 'Пароль не установлен — оставить без пароля') + '</div>' +
      '</div></label>';

    // 2. Установить новый
    html += '<label class="role-checkbox' + (act === 'set' ? ' selected' : '') + '" style="cursor:pointer;">' +
      '<input type="radio" name="empf-pw-action" value="set" ' + (act === 'set' ? 'checked' : '') + ' style="display:none;" onclick="setEmployeePwAction(\'set\')">' +
      '<div class="check">' + (act === 'set' ? '<i class="ti ti-check"></i>' : '') + '</div>' +
      '<div class="role-body">' +
        '<div class="role-name">' + (f._has_password ? 'Сменить пароль' : 'Установить пароль') + '</div>' +
        '<div class="role-desc">Задать новый пароль для входа без Telegram</div>' +
      '</div></label>';

    // 3. Снять
    if (f._has_password) {
      html += '<label class="role-checkbox' + (act === 'clear' ? ' selected' : '') + '" style="cursor:pointer;">' +
        '<input type="radio" name="empf-pw-action" value="clear" ' + (act === 'clear' ? 'checked' : '') + ' style="display:none;" onclick="setEmployeePwAction(\'clear\')">' +
        '<div class="check">' + (act === 'clear' ? '<i class="ti ti-check"></i>' : '') + '</div>' +
        '<div class="role-body">' +
          '<div class="role-name">Снять пароль</div>' +
          '<div class="role-desc">Сотрудник больше не сможет входить по паролю (Telegram-вход останется работать)</div>' +
        '</div></label>';
    }
    html += '</div>';
  }

  // Поле ввода пароля (показываем когда: new ИЛИ edit+_password_action==='set')
  const showPwInput = !isEdit || f._password_action === 'set';
  if (showPwInput) {
    html += '<div class="sales-form-row cols-1"><div>';
    html += '<label>Пароль ' +
            '<span class="hint" style="text-transform:none; font-weight:400; color:var(--text-light); font-size:11px;">(минимум 6 символов, должен быть уникальным)</span>' +
            '</label>';
    html += '<div style="display:flex; gap:8px; align-items:stretch;">';
    html += '<input type="text" id="empf-password" value="' + escapeHtml(f.password || '') + '" placeholder="напр. ' + (isEdit ? 'новый пароль' : 'k7m9x2p4') + '" style="flex:1; font-family: ui-monospace, monospace; letter-spacing:1px;" autocomplete="off">';
    html += '<button class="btn btn-secondary" onclick="generateEmployeePassword()" type="button" title="Сгенерировать случайный пароль" style="white-space:nowrap;"><i class="ti ti-dice"></i> Сгенерировать</button>';
    html += '</div>';
    if (!isEdit) {
      html += '<div style="font-size: 12px; color: var(--text-light); margin-top: 6px; line-height: 1.5;">Если оставить пустым — войти можно будет только через Telegram. Запишите пароль и передайте сотруднику.</div>';
    }
    html += '</div></div>';
  } else if (isEdit && f._has_password) {
    // Индикатор «пароль установлен»
    html += '<div style="font-size: 12.5px; color: var(--success, #2D7D46); padding: 8px 12px; background: rgba(45,125,70,0.08); border-radius: 8px;"><i class="ti ti-check"></i> Пароль установлен</div>';
  }
  html += '</div>';

  // Блок 4: Расширенные настройки (скрыто по умолчанию, разворачивается)
  html += '<div class="sales-form-section">';
  html += '<button class="advanced-toggle" onclick="toggleAdvancedSettings()">' +
          '<i class="ti ti-chevron-down" id="empf-adv-icon"></i> Расширенные настройки</button>';
  html += '<div class="advanced-block" id="empf-advanced">';
  html += '<div class="sales-form-row cols-1"><div><label>Telegram ID <span class="hint" style="text-transform:none; font-weight:400; color:var(--text-light); font-size:11px;">(необязательно — обычно сотрудник входит через /login)</span></label>' +
          '<input type="text" id="empf-telegram-id" value="' + escapeHtml(f.telegram_id) + '" placeholder="напр. 123456789" inputmode="numeric"></div></div>';
  html += '<div style="background: var(--bg); padding: 12px 14px; border-radius: 8px; font-size: 12.5px; color: var(--text-mid); line-height: 1.6; margin-top: 6px;">' +
          '<b>Как сотрудник войдёт в систему:</b><br>' +
          '1. Откроет бота <code style="background:white; padding:1px 5px; border-radius:4px; border:1px solid var(--border);">@AtomusgroupBot</code><br>' +
          '2. Отправит команду <code style="background:white; padding:1px 5px; border-radius:4px; border:1px solid var(--border);">/login</code><br>' +
          '3. Получит 6-значный код и введёт его на странице входа PWA<br>' +
          '4. Telegram-аккаунт автоматически привяжется к карточке сотрудника' +
          '</div>';
  html += '</div></div>';

  // Блок 4: Активация/деактивация (только в режиме редактирования)
  if (isEdit) {
    html += '<div class="sales-form-section">';
    html += '<div class="sales-form-title">Статус сотрудника</div>';
    if (f._is_active) {
      html += '<button class="danger-btn-text" onclick="toggleEmployeeActive(false)">' +
              '<i class="ti ti-user-off"></i> Деактивировать сотрудника</button>';
      html += '<div style="font-size: 12px; color: var(--text-light); text-align: center; line-height: 1.5; padding: 0 12px;">' +
              'Сотрудник перестанет видеть систему и не будет показываться в списках для назначения. Данные сохранятся.' +
              '</div>';
    } else {
      html += '<button class="success-btn-text" onclick="toggleEmployeeActive(true)">' +
              '<i class="ti ti-user-check"></i> Активировать сотрудника</button>';
      html += '<div style="font-size: 12px; color: var(--text-light); text-align: center; line-height: 1.5; padding: 0 12px;">' +
              'Сотрудник снова сможет входить в систему.' +
              '</div>';
    }
    html += '</div>';
  }

  // Кнопки
  html += '<div class="sales-action-bar">';
  html += '<button class="btn btn-secondary" onclick="cancelEmployeeForm()">Отмена</button>';
  html += '<button class="btn btn-primary" id="empf-submit" onclick="submitEmployeeForm()">' +
          '<i class="ti ti-check"></i> ' + (isEdit ? 'Сохранить' : 'Создать сотрудника') + '</button>';
  html += '</div>';
  html += '<div id="empf-error"></div>';

  container.innerHTML = html;

  // Подвязка input → state
  document.getElementById('empf-full-name').addEventListener('input', e => { state.employeeForm.full_name = e.target.value; });
  document.getElementById('empf-position').addEventListener('input', e => { state.employeeForm.position = e.target.value; });
  // v2.8.2: подгружаем варианты должностей в datalist
  ensurePositionsLoaded().then(d => {
    const dl = document.getElementById('empf-position-list');
    if (!dl) return;
    dl.innerHTML = (d.positions || []).map(p => '<option value="' + escapeHtml(p.name) + '"></option>').join('');
  });
  document.getElementById('empf-phone').addEventListener('input', e => { state.employeeForm.phone = e.target.value; });
  document.getElementById('empf-email').addEventListener('input', e => { state.employeeForm.email = e.target.value; });
  document.getElementById('empf-tab-number').addEventListener('input', e => { state.employeeForm.tab_number = e.target.value; });
  const tgEl = document.getElementById('empf-telegram-id');
  if (tgEl) tgEl.addEventListener('input', e => { state.employeeForm.telegram_id = e.target.value.replace(/\D/g, ''); });

  // ЭТАП 29: подгрузка списка уровней доступа и подвязка select
  const accSel = document.getElementById('empf-access-level');
  if (accSel) {
    accSel.addEventListener('change', e => {
      const v = e.target.value;
      state.employeeForm.access_level_id = v ? parseInt(v) : null;
      // Перерисуем — поменяется подсказка «что включает»
      renderEmployeeForm();
    });
  }
  // Если кэш уровней пустой — подгрузим
  if (!cache.accessLevelsActive) {
    ensureAccessLevelsLoaded().then(() => {
      // если экран всё ещё на форме сотрудника — перерисуем
      if (state.currentScreen === 'employee-form') renderEmployeeForm();
    });
  }
  // Если реестра permissions ещё нет (для рендера саммари) — загрузим
  if (!cache.permissionsRegistry) {
    apiGet('/api/access-levels/permissions').then(d => {
      cache.permissionsRegistry = d;
      if (state.currentScreen === 'employee-form') renderEmployeeForm();
    }).catch(() => {});
  }
  // ЭТАП 28: подвязка поля пароля
  const pwEl = document.getElementById('empf-password');
  if (pwEl) pwEl.addEventListener('input', e => { state.employeeForm.password = e.target.value; });
}

// ЭТАП 28: переключение режима работы с паролем при редактировании
function setEmployeePwAction(action) {
  state.employeeForm._password_action = action;
  if (action !== 'set') state.employeeForm.password = '';
  renderEmployeeForm();
}

// ЭТАП 28: генератор случайного пароля (8 символов, латиница + цифры, без неоднозначных)
function generateEmployeePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // без 0/o/O/1/l/i/I чтобы не путали
  let pw = '';
  const arr = new Uint8Array(8);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(arr);
    for (let i = 0; i < 8; i++) pw += alphabet[arr[i] % alphabet.length];
  } else {
    // fallback
    for (let i = 0; i < 8; i++) pw += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  state.employeeForm.password = pw;
  renderEmployeeForm();
  // Сразу выставляем курсор в поле и подсвечиваем — чтобы директор мог скопировать
  setTimeout(() => {
    const el = document.getElementById('empf-password');
    if (el) { el.focus(); el.select(); }
  }, 50);
  showToast('Пароль сгенерирован — запишите его', 'info');
}

function toggleEmployeeRole(roleCode) {
  const idx = state.employeeForm.roles.indexOf(roleCode);
  if (idx >= 0) state.employeeForm.roles.splice(idx, 1);
  else state.employeeForm.roles.push(roleCode);
  renderEmployeeForm();
}

function toggleAdvancedSettings() {
  const block = document.getElementById('empf-advanced');
  const icon = document.getElementById('empf-adv-icon');
  if (!block) return;
  if (block.classList.contains('visible')) {
    block.classList.remove('visible');
    if (icon) icon.className = 'ti ti-chevron-down';
  } else {
    block.classList.add('visible');
    if (icon) icon.className = 'ti ti-chevron-up';
  }
}

async function submitEmployeeForm() {
  const errEl = document.getElementById('empf-error');
  const btn = document.getElementById('empf-submit');
  errEl.innerHTML = '';

  const f = state.employeeForm;
  if (!f.full_name.trim()) {
    errEl.innerHTML = '<div class="sales-error">Укажите ФИО</div>';
    return;
  }
  // ЭТАП 29: валидация уровня доступа вместо ролей
  if (!f.access_level_id) {
    errEl.innerHTML = '<div class="sales-error">Выберите уровень доступа</div>';
    return;
  }

  // ЭТАП 16А: лёгкая валидация email — если пустой, ок; если введён, должен содержать @
  const emailValue = (f.email || '').trim();
  if (emailValue && emailValue.indexOf('@') === -1) {
    errEl.innerHTML = '<div class="sales-error">Email должен содержать символ @</div>';
    return;
  }

  // ЭТАП 28: валидация пароля
  const isEdit = state.employeeFormMode === 'edit';
  const pwAction = isEdit ? (f._password_action || 'keep') : (f.password ? 'set' : 'keep');
  const pwValue = (f.password || '').trim();
  if (pwAction === 'set') {
    if (pwValue.length < 6) {
      errEl.innerHTML = '<div class="sales-error">Пароль должен быть не короче 6 символов</div>';
      return;
    }
    if (pwValue.length > 100) {
      errEl.innerHTML = '<div class="sales-error">Пароль слишком длинный (макс 100)</div>';
      return;
    }
  }

  const payload = {
    full_name: f.full_name.trim(),
    position: f.position.trim(),
    phone: f.phone.trim(),
    email: emailValue,
    tab_number: f.tab_number.trim(),
    access_level_id: f.access_level_id,                // ЭТАП 29
  };
  if (f.telegram_id) {
    const tg = parseInt(f.telegram_id);
    if (isNaN(tg) || tg <= 0) {
      errEl.innerHTML = '<div class="sales-error">Telegram ID должен быть числом</div>';
      return;
    }
    payload.telegram_id = tg;
  }

  // При СОЗДАНИИ — пароль шлём прямо в payload, бэк создаст одной транзакцией
  if (!isEdit && pwAction === 'set' && pwValue) {
    payload.password = pwValue;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> Сохраняем…';

  try {
    let r;
    const token = localStorage.getItem(TOKEN_KEY);
    if (isEdit) {
      r = await fetch(API_BASE + '/api/employees/' + state.currentEmployeeId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(payload),
      });
    } else {
      r = await fetch(API_BASE + '/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(payload),
      });
    }
    const data = await r.json();
    if (!r.ok) {
      errEl.innerHTML = '<div class="sales-error">' + escapeHtml(data.message || data.error || 'Ошибка') + '</div>';
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-check"></i> ' + (isEdit ? 'Сохранить' : 'Создать сотрудника');
      return;
    }

    // ЭТАП 28: для EDIT — отдельный запрос на смену/сброс пароля
    const empId = isEdit ? state.currentEmployeeId : (data.id || data.employee_id);
    if (isEdit && empId && (pwAction === 'set' || pwAction === 'clear')) {
      const pwPayload = pwAction === 'clear' ? { password: null } : { password: pwValue };
      const r2 = await fetch(API_BASE + '/api/employees/' + empId + '/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(pwPayload),
      });
      const data2 = await r2.json();
      if (!r2.ok) {
        // Не критично: сотрудник уже сохранён, но пароль не применился
        errEl.innerHTML = '<div class="sales-error">Сотрудник сохранён, но пароль не применился: ' +
                          escapeHtml(data2.message || data2.error || 'ошибка') + '</div>';
        btn.disabled = false;
        btn.innerHTML = '<i class="ti ti-check"></i> Сохранить';
        return;
      }
    }
    // ЭТАП 28: для создания — проверим что пароль реально применился
    if (!isEdit && pwAction === 'set' && data && data.has_password === false) {
      showToast('Сотрудник создан, но такой пароль уже используется. Задайте другой через карточку.', 'error');
    } else {
      showToast(isEdit ? 'Сотрудник обновлён' : 'Сотрудник создан', 'success');
    }
    cache.employees = null;
    cache.activeEmployees = null;
    cache.managersForPicker = null;
    setTimeout(() => selectSidebarItem('employees'), 200);
  } catch (e) {
    errEl.innerHTML = '<div class="sales-error">Ошибка соединения: ' + escapeHtml(String(e)) + '</div>';
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i> ' + (isEdit ? 'Сохранить' : 'Создать сотрудника');
  }
}

async function toggleEmployeeActive(makeActive) {
  if (!state.currentEmployeeId) return;
  const verb = makeActive ? 'активировать' : 'деактивировать';
  if (!confirm('Точно ' + verb + ' сотрудника?')) return;

  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/employees/' + state.currentEmployeeId + '/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ is_active: makeActive }),
    });
    const data = await r.json();
    if (!r.ok) {
      showToast(data.message || data.error || 'Ошибка', 'error');
      return;
    }
    showToast(makeActive ? 'Сотрудник активирован' : 'Сотрудник деактивирован', 'success');
    cache.employees = null;
    cache.activeEmployees = null;
    cache.managersForPicker = null;
    state.employeeForm._is_active = makeActive;
    renderEmployeeForm();
  } catch (e) {
    showToast('Ошибка: ' + String(e), 'error');
  }
}

// ============ КОНЕЦ ЭТАПА 13В ============

// ============================================================================
// ============ ЭТАП 14А: ПРОДАЖНАЯ НОМЕНКЛАТУРА ============================
// ============================================================================

// Состояние продажной номенклатуры
state.saleProductsFilter = 'all';      // 'all' / 'goods' / 'service'
state.saleProductsSearch = '';
state.saleProductFormMode = 'new';     // 'new' / 'edit'
state.currentSaleProductId = null;
state.saleProductForm = {
  name: '',
  description: '',
  product_type: 'goods',
  base_price: '',
  unit: 'шт.',
  category_id: null,    // ЭТАП 17
  linkedModels: [],     // массив объектов {model_id, model_name, model_extra, model_article, direction_name}
};
state._modelsLinkSelection = [];       // временная выборка во время открытой модалки

cache.saleProducts = null;
cache.saleCategories = null;          // ЭТАП 17: справочник категорий
state.saleCategoryFilter = '';        // ЭТАП 17: фильтр по категории ('' = все, '0' = без категории, 'N' = id)

// ЭТАП 17: ленивая загрузка категорий
async function ensureSaleCategoriesLoaded() {
  if (cache.saleCategories !== null) return cache.saleCategories;
  try {
    const d = await apiGet('/api/sale-categories');
    cache.saleCategories = d.categories || [];
  } catch (e) {
    cache.saleCategories = [];
  }
  return cache.saleCategories;
}

// ============ ЭТАП 34.3: Одноразовый импорт каталога продажной номенклатуры ============

const ATOMUS_SALE_CATALOG = [
  { name: 'AtomGold09',  series: 'AtomGold',  kind: 'mid' },
  { name: 'AtomGold12',  series: 'AtomGold',  kind: 'mid' },
  { name: 'AtomGold18',  series: 'AtomGold',  kind: 'mid' },
  { name: 'AtomGold24',  series: 'AtomGold',  kind: 'mid' },
  { name: 'AtomGold36',  series: 'AtomGold',  kind: 'mid' },
  { name: 'AtomGold42',  series: 'AtomGold',  kind: 'mid' },
  { name: 'AtomGold70',  series: 'AtomGold',  kind: 'mid' },
  { name: 'AtomGold09+', series: 'AtomGold+', kind: 'mid' },
  { name: 'AtomGold12+', series: 'AtomGold+', kind: 'mid' },
  { name: 'AtomGold18+', series: 'AtomGold+', kind: 'mid' },
  { name: 'AtomGold24+', series: 'AtomGold+', kind: 'mid' },
  { name: 'AtomGold36+', series: 'AtomGold+', kind: 'mid' },
  { name: 'AtomGold42+', series: 'AtomGold+', kind: 'mid' },
  { name: 'AtomGold70+', series: 'AtomGold+', kind: 'mid' },
  { name: 'AtomZero09',  series: 'AtomZero',  kind: 'low' },
  { name: 'AtomZero12',  series: 'AtomZero',  kind: 'low' },
  { name: 'AtomZero18',  series: 'AtomZero',  kind: 'low' },
  { name: 'AtomZero24',  series: 'AtomZero',  kind: 'low' },
  { name: 'AtomZero36',  series: 'AtomZero',  kind: 'low' },
  { name: 'AtomZero72',  series: 'AtomZero',  kind: 'low' },
];

const _ATOMUS_CERT_INFO = 'Маркировка AtomusGroup. Сертификат ЕАЭС N RU Д-RU.РА08.B.98208/23 от 01.11.2023, действителен до 22.10.2028 (ТР ТС 010/2011).';

function _atomusItemDescription(it) {
  const typeText = it.kind === 'mid'
    ? 'Среднетемпературная сплит-система для холодильных камер.'
    : 'Низкотемпературная сплит-система для холодильных камер.';
  return typeText + ' ' + _ATOMUS_CERT_INFO;
}

async function openSaleProductsImport() {
  if (!canManageSales()) {
    showToast('Доступ только директору и заму', 'error');
    return;
  }
  // Грузим категории
  if (!cache.saleCategories) {
    try {
      const r = await apiGet('/api/sale-categories');
      cache.saleCategories = r.categories || [];
    } catch (e) { cache.saleCategories = []; }
  }
  const refrigCat = (cache.saleCategories || []).find(c =>
    (c.name || '').toLowerCase().includes('холодильн')
  );
  // Грузим существующие позиции для дедупа
  let existing = [];
  try {
    const r = await apiGet('/api/sale-products');
    existing = r.products || r.sale_products || [];
  } catch (e) { /* ignore */ }
  const existingNamesLC = new Set(
    existing.map(p => (p.name || '').trim().toLowerCase())
  );

  let m = document.getElementById('sp-import-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'sp-import-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) m.classList.remove('visible'); };
    document.body.appendChild(m);
  }
  const newItems = ATOMUS_SALE_CATALOG.filter(it =>
    !existingNamesLC.has(it.name.trim().toLowerCase())
  );
  const dupCount = ATOMUS_SALE_CATALOG.length - newItems.length;

  let rowsHtml = '';
  ATOMUS_SALE_CATALOG.forEach(it => {
    const isDup = existingNamesLC.has(it.name.trim().toLowerCase());
    rowsHtml +=
      '<div style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--border);' +
        (isDup ? 'opacity:0.5;' : '') + '">' +
        '<div style="flex:1;">' +
          '<div style="font-weight:500;">' + escapeHtml(it.name) + '</div>' +
          '<div style="font-size:12px;color:var(--text-light);">' +
            escapeHtml(it.series) + ' · ' +
            (it.kind === 'mid' ? 'среднетемпературная' : 'низкотемпературная') +
          '</div>' +
        '</div>' +
        '<div style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;' +
          (isDup
            ? 'background:#fef3c7;color:#92400e;'
            : 'background:#dcfce7;color:#15803d;') + '">' +
          (isDup ? 'Уже есть' : 'Новая') +
        '</div>' +
      '</div>';
  });

  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:560px;max-height:85vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-download"></i> Импорт каталога AtomusGroup</h3>' +
        '<button class="modal-close" onclick="this.closest(\'.modal-overlay\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:14px 18px;border-bottom:1px solid var(--border);">' +
        '<div style="font-size:13px;color:var(--text);margin-bottom:8px;">' +
          'Будет добавлено <b>' + newItems.length + '</b> моделей сплит-систем ' +
          '(AtomGold 7 + AtomGold+ 7 + AtomZero 6).' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text-light);">' +
          '<i class="ti ti-folder"></i> Категория: <b>' +
          escapeHtml(refrigCat ? refrigCat.name : '⚠ Холодильное оборудование (не найдена!)') +
          '</b>' +
          (dupCount ? '<br><i class="ti ti-alert-triangle" style="color:#f59e0b;"></i> ' + dupCount + ' уже в каталоге — пропустятся' : '') +
        '</div>' +
      '</div>' +
      '<div style="overflow-y:auto;flex:1;">' + rowsHtml + '</div>' +
      '<div style="padding:14px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">' +
        '<button class="btn btn-secondary" onclick="this.closest(\'.modal-overlay\').classList.remove(\'visible\')">Отмена</button>' +
        '<button class="btn btn-primary" id="sp-import-go" onclick="runSaleProductsImport(' +
          (refrigCat ? refrigCat.id : 'null') + ')"' +
          (newItems.length && refrigCat ? '' : ' disabled style="opacity:0.5;cursor:not-allowed;"') +
          '>' +
          '<i class="ti ti-check"></i> Импортировать ' + newItems.length +
        '</button>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
}

async function runSaleProductsImport(categoryId) {
  if (!categoryId) {
    showToast('Не найдена категория «Холодильное оборудование»', 'error');
    return;
  }
  const btn = document.getElementById('sp-import-go');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader"></i> Импортируем…'; }

  // Перепроверка существующих перед импортом — защита от двойного клика
  let existing = [];
  try {
    const r = await apiGet('/api/sale-products');
    existing = r.products || r.sale_products || [];
  } catch (e) { /* ignore */ }
  const existingNamesLC = new Set(
    existing.map(p => (p.name || '').trim().toLowerCase())
  );

  const token = localStorage.getItem(TOKEN_KEY);
  let added = 0, skipped = 0, failed = 0;
  for (let i = 0; i < ATOMUS_SALE_CATALOG.length; i++) {
    const it = ATOMUS_SALE_CATALOG[i];
    if (existingNamesLC.has(it.name.trim().toLowerCase())) {
      skipped++;
      continue;
    }
    const body = {
      name: it.name,
      description: _atomusItemDescription(it),
      product_type: 'goods',
      unit: 'шт.',
      category_id: categoryId,
    };
    try {
      const r = await fetch(API_BASE + '/api/sale-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        added++;
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
    }
  }
  const m = document.getElementById('sp-import-modal');
  if (m) m.classList.remove('visible');
  let msg = 'Импорт: добавлено ' + added;
  if (skipped) msg += ', пропущено ' + skipped + ' (уже было)';
  if (failed)  msg += ', ошибок ' + failed;
  showToast(msg, failed ? 'error' : 'success');
  // Обновляем экран
  cache.saleProducts = null;
  await loadSaleProducts();
}

// ============================================================================
// v2.45.453: Импорт прайса из Excel в Продажную номенклатуру
// (тот же механизм, что и в Каталоге: xlsx → сервер разбирает листы → upsert)
// ============================================================================

async function openSaleXlsxImport() {
  if (!canManageSales()) {
    showToast('Доступ только директору, заму и менеджеру', 'error');
    return;
  }
  // Категории — чтобы выбрать, куда сложить позиции
  if (!cache.saleCategories) {
    try {
      const r = await apiGet('/api/sale-categories');
      cache.saleCategories = r.categories || [];
    } catch (e) { cache.saleCategories = []; }
  }
  const catOpts = '<option value="">— без категории —</option>' +
    (cache.saleCategories || []).map(c =>
      '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>'
    ).join('');

  let m = document.getElementById('sp-xlsx-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'sp-xlsx-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) closeSaleXlsxImport(); };
    document.body.appendChild(m);
  }
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:620px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-file-spreadsheet"></i> Импорт прайса из Excel</h3>' +
        '<button class="modal-close" onclick="closeSaleXlsxImport()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:18px;display:flex;flex-direction:column;gap:14px;">' +
        '<div style="font-size:13px;color:var(--text-mid);line-height:1.5;">' +
          'Загрузите Excel-прайс (.xlsx). Сервер сам найдёт колонки <b>«Наименование»</b> и <b>«Цена»</b> ' +
          'по заголовкам, а каждый <b>лист</b> книги станет отдельной <b>группой</b> (папкой) в номенклатуре.' +
        '</div>' +
        '<div style="font-size:12px;padding:10px 12px;background:#E0F2FE;border-left:3px solid #2563EB;border-radius:6px;line-height:1.5;color:#1E40AF;">' +
          '<b><i class="ti ti-info-circle"></i> Логика:</b> позиция с таким же <b>названием</b> в выбранной категории ' +
          '<b>обновится ценой</b>, новые — добавятся. Каталожные позиции (с артикулом) не затрагиваются.' +
        '</div>' +
        '<label style="display:flex;flex-direction:column;gap:6px;font-size:12.5px;font-weight:600;color:var(--text-mid);">' +
          'Категория для позиций' +
          '<select id="sp-xlsx-category" style="width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:14px;background:#fff;">' + catOpts + '</select>' +
        '</label>' +
        '<label style="display:flex;flex-direction:column;gap:6px;font-size:12.5px;font-weight:600;color:var(--text-mid);">' +
          'XLSX файл (до 50 МБ)' +
          '<input type="file" id="sp-xlsx-file" accept=".xlsx" style="font-size:13px;">' +
        '</label>' +
        '<button class="btn btn-primary" onclick="runSaleXlsxImport()"><i class="ti ti-upload"></i> Запустить импорт</button>' +
        '<div id="sp-xlsx-result"></div>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
}

function closeSaleXlsxImport() {
  const m = document.getElementById('sp-xlsx-modal');
  if (m) m.classList.remove('visible');
  if (window._saleXlsxPollTimer) { clearTimeout(window._saleXlsxPollTimer); window._saleXlsxPollTimer = null; }
}

async function runSaleXlsxImport() {
  const fileInput = document.getElementById('sp-xlsx-file');
  const file = fileInput && fileInput.files && fileInput.files[0];
  if (!file) { showToast('Выберите xlsx-файл', 'error'); return; }
  const catSel = document.getElementById('sp-xlsx-category');
  const categoryId = catSel ? (catSel.value || '') : '';
  const resultEl = document.getElementById('sp-xlsx-result');
  resultEl.innerHTML = '<div class="loading-block" style="margin:10px 0;">Загружаем прайс на сервер…</div>';
  const form = new FormData();
  form.append('file', file);
  if (categoryId) form.append('category_id', categoryId);
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/sale-products/import-xlsx', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: form,
    });
    if (!r.ok) {
      let errMsg = 'HTTP ' + r.status;
      try { const err = await r.json(); if (err && err.message) errMsg = err.message; } catch (_) {}
      throw new Error(errMsg);
    }
    const d = await r.json();
    pollSaleXlsxStatus(d.job_id, d.total_chunks);
  } catch (e) {
    resultEl.innerHTML = '<div class="empty-block" style="text-align:left;padding:14px;"><i class="ti ti-alert-triangle" style="color:#DC2626;"></i> ' + escapeText(e.message || String(e)) + '</div>';
  }
}

async function pollSaleXlsxStatus(jobId, totalChunks) {
  const resultEl = document.getElementById('sp-xlsx-result');
  if (!resultEl) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/catalog/import-jobs/' + jobId, {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const job = await r.json();
    const pct = totalChunks > 0 ? Math.round((job.done_chunks || 0) / totalChunks * 100) : 0;
    let html = '<div style="margin-top:10px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
        '<span style="font-size:13px;color:var(--text-mid);">' +
          (job.status === 'completed' ? '<i class="ti ti-check" style="color:#16A34A;"></i> Готово' :
           job.status === 'failed'    ? '<i class="ti ti-x" style="color:#DC2626;"></i> Ошибка' :
                                        '<i class="ti ti-loader"></i> Обрабатываем') +
          ' · лист ' + (job.done_chunks || 0) + ' из ' + totalChunks +
          ' · позиций: <b>' + (job.products_count || 0) + '</b>' +
        '</span>' +
        '<span style="font-size:13px;color:var(--text-light);">' + pct + '%</span>' +
      '</div>' +
      '<div style="height:8px;background:var(--bg);border-radius:4px;overflow:hidden;">' +
        '<div style="height:100%;background:var(--brand);width:' + pct + '%;transition:width 0.3s;"></div>' +
      '</div>';
    if (job.status === 'failed') {
      html += '<div style="margin-top:10px;color:#DC2626;font-size:12.5px;">' +
        escapeText(job.error_message || 'Неизвестная ошибка') + '</div>';
    }
    if (job.status === 'completed') {
      let summary = '';
      try {
        const mm = JSON.parse(job.error_message || '{}');
        if (mm && (mm.added != null || mm.updated != null)) {
          summary = ' · добавлено ' + (mm.added || 0) + ', обновлено ' + (mm.updated || 0);
        }
      } catch (_) {}
      html += '<div style="margin-top:10px;padding:10px 12px;background:#E8F5E9;border-radius:8px;font-size:13px;color:#16A34A;">' +
        '<i class="ti ti-check"></i> Прайс импортирован' + summary + '</div>';
    }
    html += '</div>';
    resultEl.innerHTML = html;
    if (job.status === 'pending' || job.status === 'running') {
      window._saleXlsxPollTimer = setTimeout(() => pollSaleXlsxStatus(jobId, totalChunks), 3000);
    } else if (job.status === 'completed') {
      cache.saleProducts = null;
      cache.saleCategories = null;
      loadSaleProducts();
    }
  } catch (e) {
    resultEl.innerHTML = '<div class="empty-block">Ошибка опроса: ' + escapeText(e.message || String(e)) + '</div>';
  }
}

// --------- ЗАГРУЗКА ----------

async function loadSaleProducts() {
  const container = document.getElementById('sp-content');
  if (cache.saleProducts) {
    renderSaleProductsList();
  } else {
    container.innerHTML = '<div class="loading-block">Загружаем…</div>';
  }
  // ЭТАП 17: подгрузим категории параллельно
  await ensureSaleCategoriesLoaded();
  try {
    const d = await apiGet('/api/sale-products');
    cache.saleProducts = d;
    renderSaleProductsList();
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function renderSaleProductsList() {
  const container = document.getElementById('sp-content');
  const d = cache.saleProducts;
  if (!d) return;
  const all = d.products || [];
  const counts = d.counts || {};
  const filter = state.saleProductsFilter;
  const catFilter = state.saleCategoryFilter || '';   // ЭТАП 17
  const search = (state.saleProductsSearch || '').toLowerCase().trim();

  // Обновляем чипсы типа
  document.querySelectorAll('#sp-filters .filter-chip').forEach(chip => {
    const k = chip.dataset.spf;
    const baseLabels = { 'all': 'Все', 'goods': 'Товары', 'service': 'Услуги' };
    let count = 0;
    if (k === 'all') count = counts.total || 0;
    else count = counts[k] || 0;
    chip.textContent = baseLabels[k] + (count ? ' · ' + count : '');
    chip.classList.toggle('active', k === filter);
  });

  // ЭТАП 17: чипсы категорий
  renderSaleCategoryChips(catFilter);

  // Подзаголовок
  const sub = document.getElementById('sp-subtitle');
  if (sub) sub.textContent = (counts.goods || 0) + ' товаров · ' + (counts.service || 0) + ' услуг';

  // Фильтрация
  let list = all;
  if (filter !== 'all') list = list.filter(p => p.product_type === filter);
  // ЭТАП 17: фильтр по категории
  if (catFilter === '0') {
    list = list.filter(p => !p.category_id);
  } else if (catFilter) {
    const cid = parseInt(catFilter);
    list = list.filter(p => p.category_id === cid);
  }
  if (search) {
    list = list.filter(p =>
      (p.name || '').toLowerCase().includes(search) ||
      (p.description || '').toLowerCase().includes(search)
    );
  }

  if (!list.length) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-shopping-cart"></i>Пока нет позиций' +
      (canManageSales() ? '<br><br><button class="btn btn-primary" onclick="openNewSaleProduct()" style="margin: 0 auto;"><i class="ti ti-plus"></i> Создать первую</button>' : '') +
      '</div>';
    return;
  }

  // ============ ЭТАП 35: иерархический режим group → subgroup → товары ============
  // Если у любой позиции есть group_name — используем иерархию
  const hasHierarchy = list.some(p => p.group_name);
  if (hasHierarchy) {
    container.innerHTML = _renderSaleProductsHierarchical(list, search);
    return;
  }

  // ЭТАП 17: группировка по категории если включен «Все категории»
  const showGroups = !catFilter;

  if (state.isDesktop) {
    let html = '<div style="padding: 0;"><div class="contracts-table">';
    if (!showGroups) {
      html += '<div class="sale-product-row header">' +
        '<div></div>' +
        '<div>Название</div>' +
        '<div>Тип</div>' +
        '<div style="text-align: right;">Цена</div>' +
        '<div>Сборки</div>' +
        '<div></div>' +
        '</div>';
      list.forEach(p => { html += _saleProductRowHtml(p); });
    } else {
      // Группируем по category_name
      const groups = _groupProductsByCategory(list);
      groups.forEach(grp => {
        html += '<div class="sale-product-group-header">' +
          '<i class="ti ti-folder"></i> ' + escapeHtml(grp.name) +
          ' <span class="cnt">' + grp.items.length + '</span></div>';
        grp.items.forEach(p => { html += _saleProductRowHtml(p); });
      });
    }
    html += '</div></div>';
    container.innerHTML = html;
  } else {
    let html = '<div class="contract-cards" style="padding-top: 12px; padding-bottom: 20px;">';
    if (!showGroups) {
      list.forEach(p => { html += _saleProductCardHtml(p); });
    } else {
      const groups = _groupProductsByCategory(list);
      groups.forEach(grp => {
        html += '<div class="sale-product-group-header"><i class="ti ti-folder"></i> ' +
                escapeHtml(grp.name) + ' <span class="cnt">' + grp.items.length + '</span></div>';
        grp.items.forEach(p => { html += _saleProductCardHtml(p); });
      });
    }
    html += '</div>';
    container.innerHTML = html;
  }
}

// ============ ЭТАП 35: Иерархический рендер (group → subgroup → товары) ============

function _renderSaleProductsHierarchical(list, search) {
  // Группируем: group_name → subgroup_name → []
  const tree = {};
  list.forEach(p => {
    const g = p.group_name || '(без группы)';
    const sg = p.subgroup_name || '(без подгруппы)';
    if (!tree[g]) tree[g] = {};
    if (!tree[g][sg]) tree[g][sg] = [];
    tree[g][sg].push(p);
  });

  if (!state.spOpenGroups) state.spOpenGroups = {};
  if (!state.spOpenSubgroups) state.spOpenSubgroups = {};
  const allOpen = !!search;

  let html = '<div style="padding: 10px 0 20px;">';
  const groupNames = Object.keys(tree).sort();
  groupNames.forEach(gName => {
    const subgroups = tree[gName];
    const subNames = Object.keys(subgroups).sort();
    const groupCount = subNames.reduce((acc, sg) => acc + subgroups[sg].length, 0);
    const gOpen = allOpen || !!state.spOpenGroups[gName];
    html += '<div class="sp-tree-group">' +
      '<button type="button" class="sp-tree-toggle group' + (gOpen ? ' open' : '') + '" ' +
        'onclick="toggleSpGroup(\'' + gName.replace(/'/g, "\\'") + '\')">' +
        '<i class="ti ti-chevron-right sp-tree-chev"></i>' +
        '<i class="ti ti-folder" style="font-size:16px;"></i>' +
        '<span>' + escapeHtml(gName) + '</span>' +
        '<span class="sp-tree-count">' + groupCount + '</span>' +
      '</button>';
    if (gOpen) {
      html += '<div class="sp-tree-body">';
      subNames.forEach(sgName => {
        const items = subgroups[sgName];
        const sgKey = gName + '||' + sgName;
        const sgOpen = allOpen || !!state.spOpenSubgroups[sgKey];
        html += '<div class="sp-tree-subgroup">' +
          '<button type="button" class="sp-tree-toggle subgroup' + (sgOpen ? ' open' : '') + '" ' +
            'onclick="toggleSpSubgroup(\'' + sgKey.replace(/'/g, "\\'") + '\')">' +
            '<i class="ti ti-chevron-right sp-tree-chev"></i>' +
            '<span>' + escapeHtml(sgName) + '</span>' +
            '<span class="sp-tree-count subgroup">' + items.length + '</span>' +
          '</button>';
        if (sgOpen) {
          // ЭТАП 36: картинка серии — берём из первой позиции с image_path
          const firstWithImage = items.find(it => it.image_path);
          if (firstWithImage) {
            html += '<div class="sp-tree-image-wrap">' +
              '<img src="' + API_BASE + '/static/images/' + escapeHtml(firstWithImage.image_path) + '" ' +
                'alt="' + escapeHtml(sgName) + '" class="sp-tree-image" ' +
                'onerror="this.parentNode.style.display=\'none\'" />' +
            '</div>';
          }
          html += '<div class="sp-tree-items">';
          items.forEach(p => { html += _spTreeItemHtml(p); });
          html += '</div>';
        }
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
  });
  html += '</div>';
  return html;
}

function _spTreeItemHtml(p) {
  const retail = p.base_price != null ? _fmtMoney(p.base_price) + ' ₽' : '<span style="color:var(--text-light);">—</span>';
  const dealer = p.dealer_price != null ? _fmtMoney(p.dealer_price) + ' ₽' : '';
  const nc = p.nc_code || '';
  const hasSpecs = p.specs && Object.keys(p.specs).length > 0;
  const specsBadge = hasSpecs
    ? '<span class="sp-tree-specs-badge" title="Есть характеристики"><i class="ti ti-list-details"></i></span>'
    : '';
  return '<div class="sp-tree-item" onclick="openSaleProductDetail(' + p.id + ')">' +
    '<div class="sp-tree-item-main">' +
      '<div class="sp-tree-item-name">' + escapeHtml(p.name || '—') + specsBadge + '</div>' +
      '<div class="sp-tree-item-meta">' +
        (nc ? '<span style="font-family:monospace;font-size:11px;">' + escapeHtml(nc) + '</span>' : '') +
      '</div>' +
    '</div>' +
    '<div class="sp-tree-item-prices">' +
      '<div class="sp-price-retail">' + retail + '</div>' +
      (dealer ? '<div class="sp-price-dealer">дилер: ' + dealer + '</div>' : '') +
    '</div>' +
  '</div>';
}

// ============ ЭТАП 36: модалка с фото + характеристиками + действиями ============

async function openSaleProductDetail(productId, returnTo) {
  // v2.43.8: returnTo пробрасывается в openEditSaleProduct если карточка
  // покажется как форма редактирования (когда нет картинки/specs).
  // Также сохраняем его для модалки sp-detail-modal: если оттуда нажмут
  // «Редактировать» — попадём в форму с тем же контекстом возврата.
  state.saleProductFormReturnTo = returnTo || null;
  // Грузим полную карточку с linked_models
  let p;
  try {
    p = await apiGet('/api/sale-products/' + productId);
  } catch (e) {
    showToast('Не удалось загрузить позицию', 'error');
    return;
  }
  if (!p) return;

  // ЭТАП 45 (v2.33.0): для locked-позиций всегда показываем detail-модалку
  // (даже если нет meta — нужно дать кнопку «Открыть модель»)
  const isLocked = !!p.is_locked;
  const hasMeta = !!(p.image_path || (p.specs && Object.keys(p.specs).length));
  if (!hasMeta && !isLocked) {
    openEditSaleProduct(productId, returnTo);
    return;
  }

  let m = document.getElementById('sp-detail-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'sp-detail-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) m.classList.remove('visible'); };
    document.body.appendChild(m);
  }

  const retail = p.base_price != null ? _fmtMoney(p.base_price) + ' ₽' : '—';
  const dealer = p.dealer_price != null ? _fmtMoney(p.dealer_price) + ' ₽' : '';
  const nc = p.nc_code || '';
  const groupPath = [p.group_name, p.subgroup_name].filter(Boolean).join(' → ');

  let specsHtml = '';
  if (p.specs && Object.keys(p.specs).length) {
    specsHtml = '<div class="sp-detail-specs">' +
      '<div class="sp-detail-section-title"><i class="ti ti-list-details"></i> Характеристики</div>';
    Object.keys(p.specs).forEach(k => {
      specsHtml += '<div class="sp-spec-row">' +
        '<div class="sp-spec-key">' + escapeHtml(k) + '</div>' +
        '<div class="sp-spec-val">' + escapeHtml(p.specs[k]) + '</div>' +
      '</div>';
    });
    specsHtml += '</div>';
  }

  let imgHtml = '';
  if (p.image_path) {
    imgHtml = '<div class="sp-detail-image">' +
      '<img src="' + API_BASE + '/static/images/' + escapeHtml(p.image_path) + '" ' +
        'alt="' + escapeHtml(p.name) + '" ' +
        'onerror="this.parentNode.style.display=\'none\'" />' +
    '</div>';
  }

  // ЭТАП 45 (v2.33.0): бейдж "Управляется из производственной" + кнопки
  let lockedBadge = '';
  if (isLocked) {
    lockedBadge =
      '<div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;padding:10px 12px;margin-bottom:14px;display:flex;align-items:center;gap:10px;font-size:13px;color:#854F0B;">' +
        '<i class="ti ti-lock" style="font-size:18px;flex-shrink:0;"></i>' +
        '<div>' +
          '<div style="font-weight:600;margin-bottom:2px;">Управляется из производственной номенклатуры</div>' +
          '<div style="font-size:12px;color:#9A5F12;">Артикул: <b>' + escapeHtml(p.linked_model_article || ('#' + p.linked_model_id)) + '</b></div>' +
        '</div>' +
      '</div>';
  }

  // Кнопки в футере зависят от is_locked
  let footerButtons = '<button class="btn btn-secondary" onclick="this.closest(\'.modal-overlay\').classList.remove(\'visible\')">Закрыть</button>';
  if (canManageSales()) {
    if (isLocked) {
      footerButtons +=
        '<button class="btn btn-secondary" onclick="if(confirm(\'Отвязать от производственной модели? Карточка снова станет редактируемой, а модель — пустой ссылкой.\'))unlinkSaleProductFromModel(' + p.id + ')" style="color:var(--danger);"><i class="ti ti-unlink"></i> Отвязать</button>' +
        '<button class="btn btn-primary" onclick="this.closest(\'.modal-overlay\').classList.remove(\'visible\'); openModelDetail(' + p.linked_model_id + ')"><i class="ti ti-package"></i> Открыть модель</button>';
    } else {
      footerButtons +=
        '<button class="btn btn-secondary" onclick="this.closest(\'.modal-overlay\').classList.remove(\'visible\'); openEditSaleProduct(' + p.id + ')"><i class="ti ti-edit"></i> Редактировать</button>' +
        '<button class="btn btn-primary" onclick="openPromoteSaleProductModal(' + p.id + ')"><i class="ti ti-package-export"></i> В производство</button>';
    }
  }

  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:640px;max-height:90vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-package"></i> ' + escapeHtml(p.name) + '</h3>' +
        '<button class="modal-close" onclick="this.closest(\'.modal-overlay\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content" style="overflow-y:auto;">' +
        lockedBadge +
        (groupPath ? '<div class="sp-detail-path"><i class="ti ti-folder"></i> ' + escapeHtml(groupPath) + '</div>' : '') +
        (nc ? '<div class="sp-detail-nc">НС-код: <b>' + escapeHtml(nc) + '</b></div>' : '') +
        imgHtml +
        '<div class="sp-detail-prices">' +
          '<div class="sp-detail-price-item">' +
            '<div class="sp-detail-price-label">Розничная</div>' +
            '<div class="sp-detail-price-value retail">' + retail + '</div>' +
          '</div>' +
          (dealer ? '<div class="sp-detail-price-item">' +
            '<div class="sp-detail-price-label">Дилерская</div>' +
            '<div class="sp-detail-price-value dealer">' + dealer + '</div>' +
          '</div>' : '') +
        '</div>' +
        specsHtml +
      '</div>' +
      '<div style="padding:14px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">' +
        footerButtons +
      '</div>' +
    '</div>';
  m.classList.add('visible');
}

function _fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ============ ЭТАП 45.3 (v2.33.7): палитра и иконки для разделов номенклатуры ============

function _nvPaletteClass(key) {
  // Стабильный hash имени → 1..8
  const s = String(key || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return 'nv-pal-' + (Math.abs(h) % 8 + 1);
}

function _nvCapitalize(s) {
  s = String(s || '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function _nvIconFor(name) {
  // Подбор иконки по ключевым словам в имени раздела
  const n = String(name || '').toLowerCase();
  if (n.includes('климат') || n.includes('кондиц')) return 'ti-snowflake';
  if (n.includes('дефрост') || n.includes('разморо')) return 'ti-droplet';
  if (n.includes('чиллер')) return 'ti-temperature-snow';
  if (n.includes('увлаж')) return 'ti-droplets';
  if (n.includes('вентил'))    return 'ti-wind';
  if (n.includes('щит'))        return 'ti-bolt';
  if (n.includes('узл') && n.includes('нагрев')) return 'ti-flame';
  if (n.includes('узл') && n.includes('охлаж')) return 'ti-snowflake';
  if (n.includes('электр'))    return 'ti-bolt';
  if (n.includes('сантех'))    return 'ti-pipe';
  if (n.includes('пневмат'))   return 'ti-wind';
  if (n.includes('воздухоохл')) return 'ti-temperature-snow';
  if (n.includes('холодильн')) return 'ti-temperature-snow';
  if (n.includes('тэн'))        return 'ti-flame';
  if (n.includes('утм'))        return 'ti-cpu';
  if (n.includes('датчик') || n.includes('контролл')) return 'ti-device-analytics';
  if (n.includes('комплект'))  return 'ti-package';
  return 'ti-package';
}

// ============ ЭТАП 45 (v2.33.0): ПЕРЕНОС ПРОДАЖНОЙ → ПРОИЗВОДСТВЕННАЯ ============

async function _ensureDirectionsForPromote() {
  // Гарантирует наличие cache.models.directions (для dropdown направления)
  if (cache.models && cache.models.directions && cache.models.directions.length) return;
  try {
    const d = await apiGet('/api/models?with_stock=false');
    cache.models = d;
  } catch (e) {
    cache.models = { models: [], directions: [] };
  }
}

async function openPromoteSaleProductModal(productId) {
  if (!canManageSales()) {
    showToast('Перевод доступен директору и заму', 'error');
    return;
  }
  // Загружаем направления
  await _ensureDirectionsForPromote();
  const directions = (cache.models && cache.models.directions) || [];
  if (!directions.length) {
    showToast('Сначала создайте хотя бы одно направление', 'error');
    return;
  }

  // Закрываем detail-модалку
  const detailM = document.getElementById('sp-detail-modal');
  if (detailM) detailM.classList.remove('visible');

  let m = document.getElementById('promote-sp-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'promote-sp-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) m.classList.remove('visible'); };
    document.body.appendChild(m);
  }

  const defaultArticle = 'SP-' + productId;
  const dirOptions = directions.map(d =>
    '<option value="' + d.id + '">' + escapeHtml(d.name) + '</option>'
  ).join('');

  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:480px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-package-export"></i> Перевести в производство</h3>' +
        '<button class="icon-btn" onclick="document.getElementById(\'promote-sp-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="form-hint" style="margin-bottom:14px;">' +
          '<i class="ti ti-info-circle" style="vertical-align:-2px;margin-right:4px;color:var(--brand);"></i>' +
          'Создастся карточка в производственной номенклатуре с теми же характеристиками, ценами и описанием. После переноса продажная карточка станет read-only.' +
        '</div>' +
        '<div class="form-group">' +
          '<label>Направление *</label>' +
          '<select id="promote-direction" onchange="_onPromoteDirChange()">' +
            dirOptions +
          '</select>' +
        '</div>' +
        '<div class="form-group" id="promote-subgroup-wrap" style="display:none;">' +
          '<label>Подгруппа <span style="text-transform:none;color:var(--text-faint);font-weight:400;">(опционально)</span></label>' +
          '<select id="promote-subgroup"><option value="">— Без подгруппы —</option></select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label>Артикул *</label>' +
          '<input type="text" id="promote-article" value="' + defaultArticle + '" style="font-family:monospace;text-transform:uppercase;" />' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'promote-sp-modal\').classList.remove(\'visible\')">Отмена</button>' +
        '<button class="btn btn-primary" onclick="submitPromoteSaleProduct(' + productId + ')"><i class="ti ti-check"></i> Перенести</button>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
  setTimeout(_onPromoteDirChange, 50);
}

function _onPromoteDirChange() {
  const dirSel = document.getElementById('promote-direction');
  const sgWrap = document.getElementById('promote-subgroup-wrap');
  const sgSel = document.getElementById('promote-subgroup');
  if (!dirSel || !sgWrap || !sgSel) return;
  const dirId = parseInt(dirSel.value);
  const directions = (cache.models && cache.models.directions) || [];
  const dir = directions.find(d => d.id === dirId);
  const subgroups = (dir && dir.subgroups) || [];
  if (!subgroups.length) {
    sgWrap.style.display = 'none';
    sgSel.innerHTML = '<option value="">— Без подгруппы —</option>';
    return;
  }
  sgWrap.style.display = '';
  let opts = '<option value="">— Без подгруппы —</option>';
  subgroups.forEach(sg => {
    opts += '<option value="' + sg.id + '">' + escapeHtml(sg.name) + '</option>';
  });
  sgSel.innerHTML = opts;
}

async function submitPromoteSaleProduct(productId) {
  const dirSel = document.getElementById('promote-direction');
  const sgSel = document.getElementById('promote-subgroup');
  const artInput = document.getElementById('promote-article');
  const direction_id = parseInt(dirSel.value);
  const subgroupRaw = sgSel ? sgSel.value : '';
  const subgroup_id = subgroupRaw ? parseInt(subgroupRaw) : null;
  const article = (artInput.value || '').trim().toUpperCase();
  if (!direction_id) { showToast('Выбери направление', 'error'); return; }
  if (!article) { showToast('Введи артикул', 'error'); return; }

  try {
    const r = await apiPost('/api/sale-products/' + productId + '/promote', {
      direction_id, subgroup_id, article,
    });
    document.getElementById('promote-sp-modal').classList.remove('visible');
    if (r.was_existing) {
      showToast('Уже была связана с моделью ' + r.article, 'info');
    } else {
      showToast('Перенесено в производство: ' + r.article, 'success');
    }
    // Сбросим кэш моделей и продажки
    cache.models = null;
    cache.saleProducts = null;
    // Если на экране продажная номенклатура — перерисуем
    if (typeof loadSaleProducts === 'function') {
      try { await loadSaleProducts(); } catch (e) {}
    }
    // Открываем модель сразу для редактирования характеристик
    setTimeout(() => {
      try { openModelDetail(r.model_id); } catch (e) {}
    }, 300);
  } catch (e) {
    showToast('Ошибка переноса: ' + (e.message || e), 'error');
  }
}

async function unlinkSaleProductFromModel(productId) {
  // Сейчас бэк не имеет специального эндпоинта unlink, но мы можем сделать его
  // через прямой запрос — однако пока что bыставим оповещение и оставим как заглушку,
  // дав возможность пользователю отредактировать модель и решить вопрос там.
  // Простой путь — добавим прямое DELETE/PATCH на отдельном пути; пока что — просим
  // открыть модель.
  try {
    // Используем нештатный путь: PATCH /api/sale-products/{id} с явным "_unlink_only"
    // Поскольку бэк блокирует update locked-позиции, нужен отдельный эндпоинт.
    // Пока что — открываем модель и сообщаем что отвязать можно через её деактивацию.
    showToast('Чтобы отвязать — деактивируйте модель в производственной номенклатуре', 'info');
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

// ============ Массовый импорт категории ============

async function openBulkPromoteModal() {
  if (!canManageSales()) {
    showToast('Импорт доступен директору и заму', 'error');
    return;
  }
  await _ensureDirectionsForPromote();
  const directions = (cache.models && cache.models.directions) || [];
  if (!directions.length) {
    showToast('Сначала создайте хотя бы одно направление', 'error');
    return;
  }

  // Загружаем продажные категории
  let saleCats = cache.saleCategories;
  if (!saleCats || !saleCats.length) {
    try {
      const r = await apiGet('/api/sale-categories');
      saleCats = r.categories || [];
      cache.saleCategories = saleCats;
    } catch (e) { saleCats = []; }
  }

  let m = document.getElementById('bulk-promote-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'bulk-promote-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) m.classList.remove('visible'); };
    document.body.appendChild(m);
  }

  let saleCatOptions = '<option value="">— Без категории —</option>';
  saleCats.forEach(c => {
    saleCatOptions += '<option value="' + c.id + '">' + escapeHtml(c.name) + (c.products_count ? ' · ' + c.products_count : '') + '</option>';
  });

  const dirOptions = directions.map(d =>
    '<option value="' + d.id + '">' + escapeHtml(d.name) + '</option>'
  ).join('');

  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:520px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-package-export"></i> Импорт категории в производство</h3>' +
        '<button class="icon-btn" onclick="document.getElementById(\'bulk-promote-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="form-hint" style="margin-bottom:14px;">' +
          '<i class="ti ti-info-circle" style="vertical-align:-2px;margin-right:4px;color:var(--brand);"></i>' +
          'Все позиции выбранной продажной категории станут производственными моделями. Артикулы автогенерируются: SP-&lt;id&gt;. Уже перенесённые позиции пропускаются.' +
        '</div>' +
        '<div class="modal-section-title">Откуда</div>' +
        '<div class="form-group">' +
          '<label>Продажная категория</label>' +
          '<select id="bulk-promote-sale-cat">' + saleCatOptions + '</select>' +
        '</div>' +
        '<div class="modal-section-title">Куда</div>' +
        '<div class="form-group">' +
          '<label>Направление *</label>' +
          '<select id="bulk-promote-direction" onchange="_onBulkPromoteDirChange()">' + dirOptions + '</select>' +
        '</div>' +
        '<div class="form-group" id="bulk-promote-subgroup-wrap" style="display:none;">' +
          '<label>Подгруппа <span style="text-transform:none;color:var(--text-faint);font-weight:400;">(опционально, для всех)</span></label>' +
          '<select id="bulk-promote-subgroup"><option value="">— Без подгруппы —</option></select>' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'bulk-promote-modal\').classList.remove(\'visible\')">Отмена</button>' +
        '<button class="btn btn-primary" onclick="submitBulkPromote()"><i class="ti ti-check"></i> Перенести категорию</button>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
  setTimeout(_onBulkPromoteDirChange, 50);
}

function _onBulkPromoteDirChange() {
  const dirSel = document.getElementById('bulk-promote-direction');
  const sgWrap = document.getElementById('bulk-promote-subgroup-wrap');
  const sgSel = document.getElementById('bulk-promote-subgroup');
  if (!dirSel || !sgWrap || !sgSel) return;
  const dirId = parseInt(dirSel.value);
  const directions = (cache.models && cache.models.directions) || [];
  const dir = directions.find(d => d.id === dirId);
  const subgroups = (dir && dir.subgroups) || [];
  if (!subgroups.length) {
    sgWrap.style.display = 'none';
    sgSel.innerHTML = '<option value="">— Без подгруппы —</option>';
    return;
  }
  sgWrap.style.display = '';
  let opts = '<option value="">— Без подгруппы —</option>';
  subgroups.forEach(sg => {
    opts += '<option value="' + sg.id + '">' + escapeHtml(sg.name) + '</option>';
  });
  sgSel.innerHTML = opts;
}

async function submitBulkPromote() {
  const dirSel = document.getElementById('bulk-promote-direction');
  const catSel = document.getElementById('bulk-promote-sale-cat');
  const sgSel = document.getElementById('bulk-promote-subgroup');
  const direction_id = parseInt(dirSel.value);
  const saleCatRaw = catSel.value;
  const sale_category_id = saleCatRaw === '' ? null : parseInt(saleCatRaw);
  const prod_subgroup_id = sgSel && sgSel.value ? parseInt(sgSel.value) : null;
  if (!direction_id) { showToast('Выбери направление', 'error'); return; }

  try {
    const r = await apiPost('/api/sale-products/bulk-promote', {
      sale_category_id, direction_id, prod_subgroup_id,
    });
    document.getElementById('bulk-promote-modal').classList.remove('visible');
    const errCount = (r.errors || []).length;
    let msg = 'Перенесено: ' + r.promoted + ', пропущено: ' + r.skipped;
    if (errCount) msg += ', ошибок: ' + errCount;
    showToast(msg, r.promoted > 0 ? 'success' : 'info');
    cache.models = null;
    cache.saleProducts = null;
    if (typeof loadSaleProducts === 'function') {
      try { await loadSaleProducts(); } catch (e) {}
    }
  } catch (e) {
    showToast('Ошибка массового переноса: ' + (e.message || e), 'error');
  }
}

// ============ КОНЕЦ ЭТАПА 45 (UI блок 1) ============

function toggleSpGroup(gName) {
  if (!state.spOpenGroups) state.spOpenGroups = {};
  state.spOpenGroups[gName] = !state.spOpenGroups[gName];
  renderSaleProductsList();
}

function toggleSpSubgroup(sgKey) {
  if (!state.spOpenSubgroups) state.spOpenSubgroups = {};
  state.spOpenSubgroups[sgKey] = !state.spOpenSubgroups[sgKey];
  renderSaleProductsList();
}


function renderSaleCategoryChips(activeKey) {
  const wrap = document.getElementById('sp-categories-filters');
  if (!wrap) return;
  // Очищаем содержимое
  wrap.innerHTML = '';
  // Кнопка «Все категории»
  const allBtn = document.createElement('button');
  allBtn.className = 'filter-chip' + (activeKey === '' ? ' active' : '');
  allBtn.dataset.spcat = '';
  allBtn.textContent = 'Все категории';
  allBtn.onclick = () => setSaleCategoryFilter('');
  wrap.appendChild(allBtn);
  // Реальные категории
  const cats = cache.saleCategories || [];
  cats.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'filter-chip' + (activeKey === String(c.id) ? ' active' : '');
    btn.dataset.spcat = String(c.id);
    btn.textContent = c.name + (c.products_count ? ' · ' + c.products_count : '');
    btn.onclick = () => setSaleCategoryFilter(String(c.id));
    wrap.appendChild(btn);
  });
  // «Без категории»
  const noCatBtn = document.createElement('button');
  noCatBtn.className = 'filter-chip' + (activeKey === '0' ? ' active' : '');
  noCatBtn.dataset.spcat = '0';
  noCatBtn.textContent = 'Без категории';
  noCatBtn.onclick = () => setSaleCategoryFilter('0');
  wrap.appendChild(noCatBtn);
  // ЭТАП 30.4: кнопка «Категории» перенесена в page-actions, тут больше не добавляется
}

function setSaleCategoryFilter(key) {
  state.saleCategoryFilter = key;
  renderSaleProductsList();
}

function _groupProductsByCategory(list) {
  // Возвращает массив групп {name, sort, items[]}
  const map = new Map();
  list.forEach(p => {
    const key = p.category_id ? 'c_' + p.category_id : 'none';
    const name = p.category_name || 'Без категории';
    if (!map.has(key)) map.set(key, { name, sort: p.category_id || 9999, items: [] });
    map.get(key).items.push(p);
  });
  return Array.from(map.values()).sort((a, b) => a.sort - b.sort);
}

function _saleProductRowHtml(p) {
  const isService = p.product_type === 'service';
  const iconCls = isService ? 'ti-tools' : 'ti-package';
  const colorCls = isService ? 'service' : '';
  const priceHtml = (p.base_price !== null && p.base_price !== undefined)
    ? formatMoney(p.base_price) + ' <small style="color:var(--text-light); font-weight:400;">/ ' + escapeHtml(p.unit) + '</small>'
    : '<span class="sp-price empty">по запросу</span>';
  return '<div class="sale-product-row ' + (isService ? 'service' : '') + '" onclick="openEditSaleProduct(' + p.id + ')">' +
    '<div class="sp-icon ' + colorCls + '"><i class="ti ' + iconCls + '"></i></div>' +
    '<div class="sp-name">' + escapeHtml(p.name) +
      (p.description ? '<small>' + escapeHtml(p.description) + '</small>' : '') +
    '</div>' +
    '<div class="sp-type">' + escapeHtml(p.product_type_label) + '</div>' +
    '<div class="sp-price">' + priceHtml + '</div>' +
    '<div class="sp-links"><i class="ti ti-link"></i><span>—</span></div>' +
    '<div class="ct-arrow"><i class="ti ti-chevron-right"></i></div>' +
    '</div>';
}

function _saleProductCardHtml(p) {
  const isService = p.product_type === 'service';
  const iconCls = isService ? 'ti-tools' : 'ti-package';
  const colorCls = isService ? 'service' : '';
  const priceText = (p.base_price !== null && p.base_price !== undefined)
    ? formatMoney(p.base_price) + ' / ' + p.unit
    : 'по запросу';
  return '<div class="sale-product-card" onclick="openEditSaleProduct(' + p.id + ')">' +
    '<div class="spc-icon ' + colorCls + '"><i class="ti ' + iconCls + '"></i></div>' +
    '<div class="spc-body">' +
      '<div class="spc-name">' + escapeHtml(p.name) + '</div>' +
      '<div class="spc-meta">' + escapeHtml(p.product_type_label) +
      ' · <span class="spc-price">' + escapeHtml(priceText) + '</span></div>' +
    '</div></div>';
}

// --------- ФОРМА ----------

function openNewSaleProduct() {
  if (!canManageSales()) {
    showToast('Создавать позиции может директор, зам или менеджер', 'error');
    return;
  }
  state.saleProductFormMode = 'new';
  state.currentSaleProductId = null;
  state.saleProductFormReturnTo = null;  // v2.43.8: чистим хвост от прежнего перехода
  state.saleProductForm = {
    name: '', description: '', product_type: 'goods', base_price: '', unit: 'шт.',
    category_id: null,    // ЭТАП 17
    linkedModels: [],
    specs: [],            // характеристики (key/val) → specs_json
  };
  selectSidebarItem('sale-product-form');
}

async function openEditSaleProduct(productId, returnTo) {
  if (!canManageSales()) {
    showToast('Редактировать может директор, зам или менеджер', 'error');
    return;
  }
  // v2.43.8: если функция вызвана с return-context — записываем,
  // иначе явно сбрасываем (чтобы прежний контекст не сработал не в том месте).
  state.saleProductFormReturnTo = returnTo || null;
  state.saleProductFormMode = 'edit';
  state.currentSaleProductId = productId;
  try {
    const p = await apiGet('/api/sale-products/' + productId);
    state.saleProductForm = {
      name: p.name || '',
      description: p.description || '',
      product_type: p.product_type || 'goods',
      base_price: p.base_price !== null && p.base_price !== undefined ? p.base_price : '',
      unit: p.unit || 'шт.',
      category_id: p.category_id || null,    // ЭТАП 17
      linkedModels: (p.linked_models || []).map(lm => ({
        model_id: lm.model_id,
        model_name: lm.model_name,
        model_extra: lm.model_extra,
        model_article: lm.model_article,
        direction_name: lm.direction_name,
      })),
      // характеристики (specs_json) → редактируемые строки
      specs: Object.keys(p.specs || {}).map(k => ({ key: k, val: String(p.specs[k] == null ? '' : p.specs[k]) })),
    };
    selectSidebarItem('sale-product-form');
  } catch (e) {
    showToast('Не удалось загрузить позицию: ' + String(e), 'error');
  }
}

function cancelSaleProductForm() {
  // v2.43.8: если в форму пришли из конкретного места (например, из спецификации
  // договора) — возвращаемся туда, а не на общий список продажной номенклатуры.
  const ret = state.saleProductFormReturnTo;
  state.saleProductFormReturnTo = null;
  if (ret && ret.screen === 'sales-contract-detail' && ret.contractId) {
    openContractDetail(ret.contractId);
    return;
  }
  selectSidebarItem('sale-products');
}

async function initSaleProductForm() {
  const isEdit = state.saleProductFormMode === 'edit';
  document.getElementById('spf-title').textContent = isEdit ? 'Редактирование позиции' : 'Новая позиция';
  document.getElementById('spf-mobile-title').textContent = isEdit ? 'Редактирование' : 'Новая позиция';
  // ЭТАП 17: подгрузим категории, чтобы при первом рендере выпадашка была заполнена
  await ensureSaleCategoriesLoaded();
  renderSaleProductForm();
}

function renderSaleProductForm() {
  const container = document.getElementById('spf-content');
  const f = state.saleProductForm;
  const isEdit = state.saleProductFormMode === 'edit';
  const isGoods = f.product_type === 'goods';

  // Список единиц
  const units = ['шт.', 'усл.', 'компл.', 'м', 'м²', 'м³', 'кг', 'л', 'ч'];

  let html = '';

  // Блок 1: Основные данные
  html += '<div class="sales-form-section">';
  html += '<div class="sales-form-title">Позиция</div>';
  html += '<div class="sales-form-row cols-1"><div><label>Название <span class="req">*</span></label>' +
          '<input type="text" id="spf-name" value="' + escapeHtml(f.name) + '" placeholder="напр. Увлажнитель промышленный УУЗ-300"></div></div>';

  // Тип
  html += '<div class="sales-form-row cols-1"><div><label>Тип <span class="req">*</span></label>';
  html += '<div class="radio-chips">';
  html += '<button type="button" class="' + (isGoods ? 'selected' : '') + '" onclick="setSaleProductType(\'goods\')">' +
          '<i class="ti ti-package"></i> Товар</button>';
  html += '<button type="button" class="' + (!isGoods ? 'selected' : '') + '" onclick="setSaleProductType(\'service\')">' +
          '<i class="ti ti-tools"></i> Услуга</button>';
  html += '</div></div></div>';

  // Описание
  html += '<div class="sales-form-row cols-1"><div><label>Описание <span class="hint" style="text-transform:none; font-weight:400; color:var(--text-light); font-size:11px;">(попадёт в PDF КП)</span></label>' +
          '<textarea id="spf-description" placeholder="Подробное описание для клиента — что входит, технические характеристики, особенности">' + escapeHtml(f.description) + '</textarea></div></div>';

  // ЭТАП 17: Категория
  html += '<div class="sales-form-row cols-1"><div><label>Категория <span class="hint" style="text-transform:none; font-weight:400; color:var(--text-light); font-size:11px;">(для группировки в каталоге)</span></label>';
  const cats = cache.saleCategories || [];
  html += '<select id="spf-category">';
  html += '<option value="">— без категории —</option>';
  cats.forEach(c => {
    const sel = (c.id === f.category_id) ? ' selected' : '';
    html += '<option value="' + c.id + '"' + sel + '>' + escapeHtml(c.name) + '</option>';
  });
  html += '</select></div></div>';

  html += '</div>';

  // Блок 2: Цена
  html += '<div class="sales-form-section">';
  html += '<div class="sales-form-title">Цена</div>';
  html += '<div class="sales-form-row">';
  html += '<div><label>Базовая цена, ₽ <span class="hint" style="text-transform:none; font-weight:400; color:var(--text-light); font-size:11px;">(без НДС, можно пустую)</span></label>' +
          '<input type="number" id="spf-price" value="' + (f.base_price !== '' ? f.base_price : '') + '" placeholder="напр. 50000" min="0" step="100"></div>';
  html += '<div><label>Единица измерения</label>';
  html += '<div class="unit-selector">';
  units.forEach(u => {
    html += '<button type="button" class="' + (f.unit === u ? 'selected' : '') + '" onclick="setSaleProductUnit(\'' + u + '\')">' + escapeHtml(u) + '</button>';
  });
  html += '</div></div>';
  html += '</div></div>';

  // Блок 2.5: Характеристики (specs_json) — видны в карточке и в КП
  html += '<div class="sales-form-section">';
  html += '<div class="sales-form-title">Характеристики <span class="hint" style="text-transform:none; font-weight:400; color:var(--text-light); font-size:11px;">(показываются в карточке и под позицией в КП)</span></div>';
  html += '<div id="spf-specs-list"></div>';
  html += '<button class="btn btn-secondary" onclick="addSpfSpec()" style="width: 100%; justify-content: center; margin-top: 10px;">' +
          '<i class="ti ti-plus"></i> Добавить характеристику</button>';
  html += '</div>';

  // Блок 3: Привязка к сборкам
  html += '<div class="sales-form-section">';
  html += '<div class="sales-form-title">Связанные сборочные позиции <span class="hint" style="text-transform:none; font-weight:400; color:var(--text-light); font-size:11px;">(опционально, можно не привязывать — для услуг)</span></div>';
  html += '<div class="linked-models-list" id="spf-linked-list">';
  if (f.linkedModels.length === 0) {
    html += '<div class="linked-empty">Не привязано ни одной сборки</div>';
  } else {
    f.linkedModels.forEach(lm => {
      const name = lm.model_name + (lm.model_extra ? ' · ' + lm.model_extra : '');
      html += '<div class="linked-model-chip">' +
        '<i class="ti ti-package-import"></i>' +
        '<div class="lm-name">' + escapeHtml(name) + ' <span class="lm-direction">(' + escapeHtml(lm.direction_name || '—') + ')</span></div>' +
        '<button class="lm-remove" onclick="removeLinkedModel(' + lm.model_id + ')" title="Убрать">' +
          '<i class="ti ti-x"></i></button>' +
        '</div>';
    });
  }
  html += '</div>';
  html += '<button class="btn btn-secondary" onclick="openModelsLinkModal()" style="width: 100%; justify-content: center; margin-top: 10px;">' +
          '<i class="ti ti-link"></i> Привязать сборки</button>';
  html += '</div>';

  // Кнопки
  html += '<div class="sales-action-bar">';
  html += '<button class="btn btn-secondary" onclick="cancelSaleProductForm()">Отмена</button>';
  html += '<button class="btn btn-primary" id="spf-submit" onclick="submitSaleProductForm()">' +
          '<i class="ti ti-check"></i> ' + (isEdit ? 'Сохранить' : 'Создать позицию') + '</button>';
  html += '</div>';
  if (isEdit) {
    html += '<div style="padding: 0 18px;"><button class="danger-btn-text" onclick="deleteCurrentSaleProduct()">' +
            '<i class="ti ti-trash"></i> Удалить позицию</button></div>';
  }
  html += '<div id="spf-error"></div>';

  container.innerHTML = html;

  // Подвязка input → state
  document.getElementById('spf-name').addEventListener('input', e => { state.saleProductForm.name = e.target.value; });
  document.getElementById('spf-description').addEventListener('input', e => { state.saleProductForm.description = e.target.value; });
  document.getElementById('spf-price').addEventListener('input', e => { state.saleProductForm.base_price = e.target.value; });
  // ЭТАП 17: категория
  const catSel = document.getElementById('spf-category');
  if (catSel) {
    catSel.addEventListener('change', e => {
      const v = e.target.value;
      state.saleProductForm.category_id = v ? parseInt(v) : null;
    });
  }
  _renderSpfSpecs();
}

// --- Характеристики позиции (specs_json) ---
function _renderSpfSpecs() {
  const box = document.getElementById('spf-specs-list');
  if (!box) return;
  const specs = state.saleProductForm.specs || [];
  if (!specs.length) {
    box.innerHTML = '<div class="spf-specs-empty">Характеристик нет. Добавьте — они появятся в карточке и под позицией в КП.</div>';
    return;
  }
  let html = '<div class="spf-specs-table">';
  html += '<div class="spf-specs-head"><span>Параметр</span><span>Значение</span><span></span></div>';
  specs.forEach((row, i) => {
    html += '<div class="spf-spec-row">' +
      '<input class="spf-spec-k" type="text" placeholder="напр. Холодопроизводительность" value="' + escapeHtml(row.key || '') + '" oninput="updateSpfSpec(' + i + ',\'key\',this.value)">' +
      '<input class="spf-spec-v" type="text" placeholder="напр. 2,73 кВт" value="' + escapeHtml(row.val || '') + '" oninput="updateSpfSpec(' + i + ',\'val\',this.value)">' +
      '<button class="spf-spec-del" onclick="removeSpfSpec(' + i + ')" title="Убрать"><i class="ti ti-x"></i></button>' +
    '</div>';
  });
  html += '</div>';
  box.innerHTML = html;
}

function addSpfSpec() {
  if (!Array.isArray(state.saleProductForm.specs)) state.saleProductForm.specs = [];
  state.saleProductForm.specs.push({ key: '', val: '' });
  _renderSpfSpecs();
}

function updateSpfSpec(i, field, value) {
  const s = state.saleProductForm.specs;
  if (s && s[i]) s[i][field] = value;
}

function removeSpfSpec(i) {
  const s = state.saleProductForm.specs;
  if (s) { s.splice(i, 1); _renderSpfSpecs(); }
}

function setSaleProductType(t) {
  state.saleProductForm.product_type = t;
  renderSaleProductForm();
}

function setSaleProductUnit(u) {
  state.saleProductForm.unit = u;
  renderSaleProductForm();
}

function removeLinkedModel(modelId) {
  state.saleProductForm.linkedModels = state.saleProductForm.linkedModels.filter(lm => lm.model_id !== modelId);
  renderSaleProductForm();
}

async function submitSaleProductForm() {
  const errEl = document.getElementById('spf-error');
  const btn = document.getElementById('spf-submit');
  errEl.innerHTML = '';

  const f = state.saleProductForm;
  if (!f.name.trim()) {
    errEl.innerHTML = '<div class="sales-error">Укажите название</div>';
    return;
  }

  // характеристики (key/val строки) → плоский словарь specs
  const specsObj = {};
  (f.specs || []).forEach(row => {
    const k = (row.key || '').trim();
    const v = (row.val || '').trim();
    if (k && v) specsObj[k] = v;
  });

  const payload = {
    name: f.name.trim(),
    description: f.description.trim(),
    product_type: f.product_type,
    unit: f.unit,
    category_id: f.category_id || null,    // ЭТАП 17
    linked_model_ids: f.linkedModels.map(lm => lm.model_id),
    specs: specsObj,                        // → specs_json
  };

  if (f.base_price !== '' && f.base_price !== null) {
    const n = Number(f.base_price);
    if (isNaN(n) || n < 0) {
      errEl.innerHTML = '<div class="sales-error">Некорректная цена</div>';
      return;
    }
    payload.base_price = n;
  } else {
    payload.base_price = null;
  }

  const isEdit = state.saleProductFormMode === 'edit';
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> Сохраняем…';

  try {
    let r;
    const token = localStorage.getItem(TOKEN_KEY);
    if (isEdit) {
      r = await fetch(API_BASE + '/api/sale-products/' + state.currentSaleProductId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(payload),
      });
    } else {
      r = await fetch(API_BASE + '/api/sale-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(payload),
      });
    }
    const data = await r.json();
    if (!r.ok) {
      errEl.innerHTML = '<div class="sales-error">' + escapeHtml(data.message || data.error || 'Ошибка') + '</div>';
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-check"></i> ' + (isEdit ? 'Сохранить' : 'Создать позицию');
      return;
    }
    showToast(isEdit ? 'Позиция обновлена' : 'Позиция создана', 'success');
    cache.saleProducts = null;
    // v2.43.8: если форма открывалась из спецификации договора — возвращаемся туда
    const ret = state.saleProductFormReturnTo;
    state.saleProductFormReturnTo = null;
    setTimeout(() => {
      if (ret && ret.screen === 'sales-contract-detail' && ret.contractId) {
        openContractDetail(ret.contractId);
      } else {
        selectSidebarItem('sale-products');
      }
    }, 200);
  } catch (e) {
    errEl.innerHTML = '<div class="sales-error">Ошибка соединения: ' + escapeHtml(String(e)) + '</div>';
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i> ' + (isEdit ? 'Сохранить' : 'Создать позицию');
  }
}

async function deleteCurrentSaleProduct() {
  if (!state.currentSaleProductId) return;
  if (!confirm('Удалить позицию из каталога? Это soft-delete — позиция станет архивной.')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/sale-products/' + state.currentSaleProductId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const d = await r.json();
      showToast(d.message || 'Не удалось удалить', 'error');
      return;
    }
    showToast('Позиция удалена', 'success');
    cache.saleProducts = null;
    selectSidebarItem('sale-products');
  } catch (e) {
    showToast('Ошибка: ' + String(e), 'error');
  }
}

// ============================================================================
// ============ ЭТАП 17: СПРАВОЧНИК КАТЕГОРИЙ =================================
// ============================================================================

async function loadSaleCategories() {
  const container = document.getElementById('sc-content');
  if (cache.saleCategories) {
    renderSaleCategoriesList();
  } else {
    container.innerHTML = '<div class="loading-block">Загружаем…</div>';
  }
  try {
    const d = await apiGet('/api/sale-categories');
    cache.saleCategories = d.categories || [];
    renderSaleCategoriesList();
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function renderSaleCategoriesList() {
  const container = document.getElementById('sc-content');
  const cats = cache.saleCategories || [];
  const newBtnEl = document.getElementById('sc-new-btn');
  if (newBtnEl) newBtnEl.style.display = canManageSales() ? '' : 'none';
  const sub = document.getElementById('sc-subtitle');
  if (sub) sub.textContent = cats.length + (cats.length === 1 ? ' категория' : ' категорий');

  if (!cats.length) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-folders"></i>Категорий пока нет' +
      (canManageSales() ? '<br><br><button class="btn btn-primary" onclick="openNewCategory()" style="margin: 0 auto;"><i class="ti ti-plus"></i> Создать первую</button>' : '') +
      '</div>';
    return;
  }

  let html = '<div style="padding: 0 18px;">';
  cats.forEach(c => {
    const canEdit = canManageSales();
    html += '<div class="category-row">' +
      '<div class="cat-row-icon"><i class="ti ti-folder"></i></div>' +
      '<div class="cat-row-body">' +
        '<div class="cat-row-name">' + escapeHtml(c.name) + '</div>' +
        '<div class="cat-row-meta">' + c.products_count + (c.products_count === 1 ? ' товар' : ' товаров/услуг') + '</div>' +
      '</div>';
    if (canEdit) {
      html += '<div class="cat-row-actions">' +
        '<button class="icon-btn" onclick="openEditCategory(' + c.id + ')" title="Редактировать"><i class="ti ti-edit"></i></button>' +
        '<button class="icon-btn" onclick="deleteCategory(' + c.id + ')" title="Удалить" style="color:var(--danger);"><i class="ti ti-trash"></i></button>' +
        '</div>';
    }
    html += '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

function openNewCategory() {
  if (!canManageSales()) {
    showToast('Управлять категориями может директор, зам или менеджер', 'error');
    return;
  }
  const name = prompt('Название категории:');
  if (!name || !name.trim()) return;
  _createCategory(name.trim());
}

async function _createCategory(name) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/sale-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ name: name }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось создать категорию', 'error');
      return;
    }
    showToast('Категория создана', 'success');
    cache.saleCategories = null;
    cache.saleProducts = null;
    loadSaleCategories();
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

function openEditCategory(catId) {
  if (!canManageSales()) return;
  const cat = (cache.saleCategories || []).find(c => c.id === catId);
  if (!cat) return;
  const newName = prompt('Новое название категории:', cat.name);
  if (!newName || !newName.trim() || newName.trim() === cat.name) return;
  _updateCategory(catId, newName.trim());
}

async function _updateCategory(catId, name) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/sale-categories/' + catId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ name: name }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось обновить', 'error');
      return;
    }
    showToast('Категория обновлена', 'success');
    cache.saleCategories = null;
    cache.saleProducts = null;
    loadSaleCategories();
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

async function deleteCategory(catId) {
  if (!canManageSales()) return;
  const cat = (cache.saleCategories || []).find(c => c.id === catId);
  if (!cat) return;
  const msg = cat.products_count > 0
    ? 'В этой категории ' + cat.products_count + ' товар(ов). После удаления они станут «Без категории». Продолжить?'
    : 'Удалить категорию «' + cat.name + '»?';
  if (!confirm(msg)) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/sale-categories/' + catId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось удалить', 'error');
      return;
    }
    showToast('Категория удалена', 'success');
    cache.saleCategories = null;
    cache.saleProducts = null;
    loadSaleCategories();
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// ============ КОНЕЦ ЭТАПА 17 ============

// --------- МОДАЛКА ПРИВЯЗКИ МОДЕЛЕЙ ----------

function openModelsLinkModal() {
  // Запоминаем уже выбранные id
  state._modelsLinkSelection = state.saleProductForm.linkedModels.map(lm => lm.model_id);
  document.getElementById('models-link-modal').classList.add('visible');
  document.getElementById('models-link-search').value = '';
  loadModelsForLinkModal('');
}

function closeModelsLinkModal() {
  document.getElementById('models-link-modal').classList.remove('visible');
}

async function loadModelsForLinkModal(query) {
  const container = document.getElementById('models-link-body');
  container.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try {
    if (!cache.models) {
      const d = await apiGet('/api/models');
      cache.models = d;
    }
    let all = (cache.models && cache.models.models) || [];
    if (query) {
      const q = query.toLowerCase();
      all = all.filter(m =>
        (m.name || '').toLowerCase().includes(q) ||
        (m.article || '').toLowerCase().includes(q) ||
        (m.extra || '').toLowerCase().includes(q)
      );
    }
    if (!all.length) {
      container.innerHTML = '<div class="empty-block"><i class="ti ti-search"></i>Не найдено</div>';
      return;
    }
    let html = '';
    all.forEach(m => {
      const selected = state._modelsLinkSelection.includes(m.id);
      const fullName = m.name + (m.extra ? ' · ' + m.extra : '');
      html += '<div class="modal-item checkbox-item' + (selected ? ' selected' : '') + '" onclick="toggleModelLink(' + m.id + ')">' +
        '<div class="check">' + (selected ? '<i class="ti ti-check"></i>' : '') + '</div>' +
        '<div class="mi-text">' +
          '<div class="mi-title">' + escapeHtml(fullName) + '</div>' +
          '<div class="mi-meta">' + escapeHtml(m.article || '—') +
          (m.direction_name ? ' · ' + escapeHtml(m.direction_name) : '') + '</div>' +
        '</div></div>';
    });
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function toggleModelLink(modelId) {
  const idx = state._modelsLinkSelection.indexOf(modelId);
  if (idx >= 0) state._modelsLinkSelection.splice(idx, 1);
  else state._modelsLinkSelection.push(modelId);
  // Перерисуем чекбоксы (но не перезагружая модели)
  const search = document.getElementById('models-link-search').value;
  loadModelsForLinkModal(search);
}

function applyModelsLink() {
  // Сохраняем выбор в saleProductForm.linkedModels
  const all = (cache.models && cache.models.models) || [];
  state.saleProductForm.linkedModels = state._modelsLinkSelection.map(mid => {
    const m = all.find(x => x.id === mid);
    if (!m) return null;
    return {
      model_id: m.id,
      model_name: m.name,
      model_extra: m.extra || '',
      model_article: m.article || '',
      direction_name: m.direction_name || '',
    };
  }).filter(Boolean);
  closeModelsLinkModal();
  renderSaleProductForm();
}

// --------- ОБРАБОТЧИКИ ----------

document.addEventListener('DOMContentLoaded', () => {
  // Фильтры продажной номенклатуры
  document.querySelectorAll('#sp-filters .filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      state.saleProductsFilter = chip.dataset.spf;
      renderSaleProductsList();
    });
  });
  // Поиск продажной номенклатуры
  const spSearch = document.getElementById('sp-search-input');
  if (spSearch) {
    spSearch.addEventListener('input', e => {
      state.saleProductsSearch = e.target.value;
      renderSaleProductsList();
    });
  }
  // Поиск в модалке моделей
  const mlSearch = document.getElementById('models-link-search');
  if (mlSearch) {
    mlSearch.addEventListener('input', e => loadModelsForLinkModal(e.target.value));
  }
  // Клик вне модалки моделей закрывает
  const mlm = document.getElementById('models-link-modal');
  if (mlm) mlm.addEventListener('click', e => { if (e.target === mlm) closeModelsLinkModal(); });
});

// ============ КОНЕЦ ЭТАПА 14А ============

// ============================================================================
// ============ ЭТАП 14Б: КП — КОММЕРЧЕСКИЕ ПРЕДЛОЖЕНИЯ =====================
// ============================================================================

// Состояние КП
state.offersFilter = 'all';                   // all/draft/sent/accepted/rejected
state.offersSearch = '';
state.currentOfferId = null;                  // ID открытого КП
state.offerFormMode = 'new';                  // 'new' или 'edit'
state.offerForm = {
  manager_id: null,
  manager_name: '',
  calculated_by_id: null,
  calculated_by_name: '',
  contractor_id: null,
  contractor_name: '',
  contractor_inn: '',
  legal_entity: 'ooo_atomus',
  valid_until: '',
  valid_duration_value: 14,           // ЭТАП 16А: число (по умолч. 14)
  valid_duration_unit: 'days',        // ЭТАП 16А: 'days'|'weeks'|'months'
  production_term: '',
  production_days: null,              // ЭТАП 16А-2: срок изготовления в рабочих днях
  payment_terms: '',
  delivery_terms: '',
  comment_internal: '',
  comment_client: '',
  items: [],   // массив { sale_product_id, name, description, unit, qty, price, discount_pct }
};

cache.offers = null;
cache.offersCounts = null;

// --------- ХЕЛПЕРЫ ----------

function offerStatusBadge(status, label) {
  return '<span class="offer-status offer-status-' + status + '">' + escapeHtml(label || '—') + '</span>';
}

function calcItemTotal(it) {
  const qty = Number(it.qty) || 0;
  const price = Number(it.price) || 0;
  const d = Math.max(0, Math.min(100, Number(it.discount_pct) || 0));
  return qty * price * (1 - d / 100);
}

function calcOfferTotal(items) {
  let total = 0;
  (items || []).forEach(it => { total += calcItemTotal(it); });
  return total;
}

function addDaysIso(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

// --------- СПИСОК КП ----------

async function loadOffers() {
  const container = document.getElementById('so-content');
  if (cache.offers) {
    renderOffersList();
  } else {
    container.innerHTML = '<div class="loading-block">Загружаем КП…</div>';
  }
  try {
    const d = await apiGet('/api/sale-offers?limit=500');
    cache.offers = d.offers || [];
    cache.offersCounts = d.counts || {};
    renderOffersList();
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function renderOffersList() {
  const container = document.getElementById('so-content');
  const counts = cache.offersCounts || {};
  const filter = state.offersFilter;
  const search = (state.offersSearch || '').toLowerCase().trim();

  // Чипсы
  document.querySelectorAll('#so-filters .filter-chip').forEach(chip => {
    const k = chip.dataset.sof;
    const baseLabels = {
      'all': 'Все', 'draft': 'Черновики', 'sent': 'Отправлены',
      'accepted': 'Приняты', 'rejected': 'Отклонены',
    };
    let count = 0;
    if (k === 'all') count = counts.total || 0;
    else count = counts[k] || 0;
    chip.textContent = baseLabels[k] + (count ? ' · ' + count : '');
    chip.classList.toggle('active', k === filter);
  });

  // Подзаголовок
  const sub = document.getElementById('so-subtitle');
  if (sub) {
    if (counts.total) sub.textContent = 'Всего ' + counts.total + ' · в работе ' + ((counts.draft || 0) + (counts.sent || 0));
    else sub.textContent = 'КП пока нет';
  }

  // Фильтрация
  let list = cache.offers || [];
  if (filter !== 'all') list = list.filter(o => o.status === filter);
  if (search) {
    list = list.filter(o =>
      (o.number || '').toLowerCase().includes(search) ||
      (o.contractor_name || '').toLowerCase().includes(search)
    );
  }

  if (!list.length) {
    let h = '<div class="empty-block"><i class="ti ti-file-invoice"></i>Нет КП под этот фильтр';
    if (canManageSales() && filter === 'all' && !search) {
      h += '<br><br><button class="btn btn-primary" onclick="openNewOffer()" style="margin: 0 auto;"><i class="ti ti-plus"></i> Создать первое</button>';
    }
    h += '</div>';
    container.innerHTML = h;
    return;
  }

  if (state.isDesktop) {
    let html = '<div style="padding: 0 0 16px;"><div class="offers-table">';
    html += '<div class="oft-header">' +
      '<div>Номер</div><div>Контрагент</div><div>Статус</div>' +
      '<div style="text-align: right;">Сумма</div>' +
      '<div>Менеджер</div><div></div></div>';
    list.forEach(o => {
      const versionBadge = (o.version && o.version > 1) ? '<span class="version-badge">v' + o.version + '</span>' : '';
      html += '<div class="oft-row" onclick="openOffer(' + o.id + ')">' +
        '<div class="oft-num">' + escapeHtml(o.number) + versionBadge + '</div>' +
        '<div class="oft-name">' + escapeHtml(o.contractor_name || '—') +
          (o.contractor_inn ? '<small>ИНН ' + escapeHtml(o.contractor_inn) + '</small>' : '') +
        '</div>' +
        '<div>' + offerStatusBadge(o.status, o.status_label) + '</div>' +
        '<div class="oft-sum">' + formatMoney(o.total_sum) + '</div>' +
        '<div class="oft-manager">' + escapeHtml(o.manager_name || '—') + '</div>' +
        '<div class="oft-arrow"><i class="ti ti-chevron-right"></i></div>' +
        '</div>';
    });
    html += '</div></div>';
    container.innerHTML = html;
  } else {
    let html = '<div class="contract-cards" style="padding-top: 12px; padding-bottom: 20px;">';
    list.forEach(o => {
      const versionBadge = (o.version && o.version > 1) ? '<span class="version-badge">v' + o.version + '</span>' : '';
      html += '<div class="offer-card" onclick="openOffer(' + o.id + ')">' +
        '<div class="oc-top">' +
          '<span class="oc-num">' + escapeHtml(o.number) + versionBadge + '</span>' +
          offerStatusBadge(o.status, o.status_label) +
        '</div>' +
        '<div class="oc-name">' + escapeHtml(o.contractor_name || '—') + '</div>' +
        '<div class="oc-meta">' +
          '<span><b>сумма</b> ' + formatMoney(o.total_sum) + '</span>' +
          '<span><b>менеджер</b> ' + escapeHtml(o.manager_name || '—') + '</span>' +
          ((o.calc_by_name || o.calc_by_full_name) ? '<span><b>рассчитал</b> ' + escapeHtml(o.calc_by_name || o.calc_by_full_name) + '</span>' : '') +
        '</div>' +
        '</div>';
    });
    html += '</div>';
    container.innerHTML = html;
  }
}

// --------- КАРТОЧКА КП ----------

function openOffer(offerId) {
  state.currentOfferId = offerId;
  selectSidebarItem('sales-offer-detail');
}

async function loadCurrentOffer() {
  const container = document.getElementById('sod-content');
  const oid = state.currentOfferId;
  if (!oid) { container.innerHTML = '<div class="empty-block">КП не выбрано</div>'; return; }
  container.innerHTML = '<div class="loading-block">Загружаем КП…</div>';
  try {
    const o = await apiGet('/api/sale-offers/' + oid);
    renderOfferDetail(o);
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function renderOfferDetail(o) {
  document.getElementById('sod-title').textContent = o.number;
  document.getElementById('sod-mobile-title').textContent = o.number;
  const subParts = [];
  if (o.created_at) subParts.push('от ' + formatDateLong(o.created_at.slice(0, 10)));
  if (o.version > 1) subParts.push('версия ' + o.version);
  document.getElementById('sod-subtitle').textContent = subParts.join(' · ');

  const container = document.getElementById('sod-content');
  const canEdit = canManageSales();

  let html = '';

  // Шапка с контрагентом и статусом
  html += '<div class="contract-header-card">';
  html += '<div class="ch-top">';
  html += '<div>';
  html += '<div class="ch-contractor-label">КОНТРАГЕНТ</div>';
  html += '<div class="ch-contractor-name">' + escapeHtml(o.contractor_name || '—') + '</div>';
  const meta = [];
  if (o.contractor_inn) meta.push('ИНН ' + escapeHtml(o.contractor_inn));
  if (o.contractor_phone) meta.push('☎ ' + escapeHtml(o.contractor_phone));
  if (o.contractor_contact_person) meta.push(escapeHtml(o.contractor_contact_person));
  if (meta.length) html += '<div class="ch-contractor-meta">' + meta.join(' · ') + '</div>';
  html += '</div>';
  html += '<div>' + offerStatusBadge(o.status, o.status_label) + '</div>';
  html += '</div>';

  // Переключатель статуса
  if (canEdit) {
    html += '<div style="font-size: 11px; color: var(--text-light); text-transform: uppercase; letter-spacing: 0.4px; margin-top: 16px; margin-bottom: 4px;">ИЗМЕНИТЬ СТАТУС</div>';
    const steps = [
      { code: 'draft', label: 'Черновик' },
      { code: 'sent', label: 'Отправлено' },
      { code: 'accepted', label: 'Принято' },
      { code: 'rejected', label: 'Отклонено' },
    ];
    const currentIdx = steps.findIndex(s => s.code === o.status);
    html += '<div class="status-changer">';
    steps.forEach((s, i) => {
      let cls = 'status-step';
      // «Отклонено» — отдельная ветка, не «пройденная»
      if (s.code === 'rejected') {
        if (o.status === 'rejected') cls += ' current';
      } else {
        if (i < currentIdx) cls += ' passed';
        else if (i === currentIdx) cls += ' current';
      }
      html += '<button class="' + cls + '" onclick="changeOfferStatus(' + o.id + ', \'' + s.code + '\')">' +
        escapeHtml(s.label) + '</button>';
    });
    html += '</div>';
  }

  // Детали
  html += '<div class="detail-grid">';
  html += '<div class="detail-item"><div class="detail-label">Юрлицо</div>' +
          '<div class="detail-value">' + escapeHtml(legalEntityShortName(o.legal_entity)) +
          (o.legal_entity_with_vat ? ' <small style="color:var(--text-light); font-weight:400;">(с НДС ' + (o.legal_entity_vat_rate || 22) + '%)</small>' : ' <small style="color:var(--text-light); font-weight:400;">(без НДС)</small>') +
          '</div></div>';
  html += '<div class="detail-item"><div class="detail-label">Менеджер</div>' +
          '<div class="detail-value">' + escapeHtml(o.manager_name || '—') + '</div></div>';
  if (o.calc_by_name || o.calc_by_full_name) {
    html += '<div class="detail-item"><div class="detail-label">Рассчитал</div>' +
            '<div class="detail-value">' + escapeHtml(o.calc_by_name || o.calc_by_full_name) + '</div></div>';
  }
  // ЭТАП 16А: срок действия — приоритет у длительности
  let validText = 'не указан';
  let validHasValue = false;
  if (o.valid_duration_value) {
    validText = validDurationLabel(o.valid_duration_value, o.valid_duration_unit || 'days');
    if (o.valid_until) validText += ' (до ' + formatDateLong(o.valid_until) + ')';
    validHasValue = true;
  } else if (o.valid_until) {
    validText = formatDateLong(o.valid_until);
    validHasValue = true;
  }
  html += '<div class="detail-item"><div class="detail-label">Срок действия</div>' +
          '<div class="detail-value' + (validHasValue ? '' : ' muted') + '">' +
          escapeHtml(validText) + '</div></div>';
  // ЭТАП 16А-2: срок изготовления — приоритет у числа рабочих дней
  let prodText = 'не указан';
  let prodHasValue = false;
  if (o.production_days) {
    prodText = productionDaysLabel(o.production_days);
    prodHasValue = true;
  } else if (o.production_term) {
    prodText = o.production_term;
    prodHasValue = true;
  }
  html += '<div class="detail-item"><div class="detail-label">Срок изготовления</div>' +
          '<div class="detail-value' + (prodHasValue ? '' : ' muted') + '">' +
          escapeHtml(prodText) + '</div></div>';
  if (o.payment_terms) {
    html += '<div class="detail-item span-2"><div class="detail-label">Условия оплаты</div>' +
            '<div class="detail-value">' + escapeHtml(o.payment_terms) + '</div></div>';
  }
  if (o.delivery_terms) {
    html += '<div class="detail-item span-2"><div class="detail-label">Условия доставки</div>' +
            '<div class="detail-value">' + escapeHtml(o.delivery_terms) + '</div></div>';
  }
  if (o.comment_client) {
    html += '<div class="detail-item span-2"><div class="detail-label">Комментарий клиенту</div>' +
            '<div class="detail-value muted">' + escapeHtml(o.comment_client).replace(/\\n/g, '<br>') + '</div></div>';
  }
  if (o.comment_internal) {
    html += '<div class="detail-item span-2"><div class="detail-label">Внутренний комментарий</div>' +
            '<div class="detail-value muted" style="background: var(--bg); padding: 8px 10px; border-radius: 8px;">' + escapeHtml(o.comment_internal).replace(/\\n/g, '<br>') + '</div></div>';
  }
  html += '</div>';
  html += '</div>';

  // Позиции КП
  html += '<div style="padding: 0 18px;">';
  html += '<h3 style="font-size: 15px; margin-bottom: 10px;">Состав КП</h3>';
  if (state.isDesktop) {
    html += '<div class="offer-items-table">';
    html += '<div class="oit-header">' +
      '<div>№</div><div>Наименование</div>' +
      '<div style="text-align: right;">Кол-во</div>' +
      '<div style="text-align: right;">Цена</div>' +
      '<div style="text-align: right;">Сумма</div>' +
      '</div>';
    (o.items || []).forEach((it, idx) => {
      html += '<div class="oit-row">' +
        '<div class="oit-num">' + (idx + 1) + '</div>' +
        '<div class="oit-name">' + escapeHtml(it.name) +
          (it.description ? '<small>' + escapeHtml(it.description) + '</small>' : '') +
        '</div>' +
        '<div class="oit-qty">' + formatNumberShort(it.qty) + ' ' + escapeHtml(it.unit) + '</div>' +
        '<div class="oit-price">' + formatMoney(it.price) + '</div>' +
        '<div class="oit-total">' + formatMoney(it.line_total) + '</div>' +
        '</div>';
    });
    html += '<div class="oit-footer">';
    html += '<span class="label">Итого</span>';
    html += '<span class="value">' + formatMoney(o.total_sum) + '</span>';
    html += '</div>';
    html += '</div>';
  } else {
    // Мобильный — карточки
    html += '<div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px;">';
    (o.items || []).forEach((it, idx) => {
      html += '<div style="background: white; border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px;">';
      html += '<div style="font-size: 13.5px; font-weight: 500;">' + (idx + 1) + '. ' + escapeHtml(it.name) + '</div>';
      if (it.description) html += '<div style="font-size: 12px; color: var(--text-light); margin-top: 4px;">' + escapeHtml(it.description) + '</div>';
      html += '<div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 13px; color: var(--text-mid);">' +
        '<span>' + formatNumberShort(it.qty) + ' ' + escapeHtml(it.unit) + ' × ' + formatMoney(it.price) +
        '</span>' +
        '<span style="font-weight: 600; color: var(--brand);">' + formatMoney(it.line_total) + '</span>' +
        '</div>';
      html += '</div>';
    });
    html += '</div>';
    html += '<div style="background: var(--brand-bg); padding: 14px 16px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">' +
      '<span style="font-weight: 600; color: var(--brand); text-transform: uppercase; letter-spacing: 0.4px; font-size: 13px;">Итого</span>' +
      '<span style="font-weight: 700; color: var(--brand); font-size: 20px;">' + formatMoney(o.total_sum) + '</span>' +
      '</div>';
  }
  html += '</div>';

  // Кнопка «Скачать PDF» + «Скачать Word» (для всех авторизованных) — ЭТАП 17
  html += '<div style="padding: 12px 18px 14px;">';
  html += '<button class="btn btn-primary" onclick="previewOfferPdf()" style="width: 100%; justify-content: center; margin-bottom: 8px;">' +
          '<i class="ti ti-eye"></i> Предпросмотр</button>';
  html += '<div style="display: flex; gap: 8px;">';
  html += '<button class="btn btn-secondary" onclick="downloadOfferPdf()" style="flex: 1; justify-content: center;">' +
          '<i class="ti ti-file-download"></i> PDF</button>';
  html += '<button class="btn btn-secondary" onclick="downloadOfferDocx()" style="flex: 1; justify-content: center;">' +
          '<i class="ti ti-file-type-doc"></i> Word</button>';
  html += '</div>';
  // «На печать» — отправляет КП на офисный принтер через шлюз документов
  html += '<button class="btn btn-secondary" onclick="printOffer()" style="width: 100%; justify-content: center; margin-top: 8px;">' +
          '<i class="ti ti-printer"></i> На печать</button>';
  html += '<div style="font-size: 12px; color: var(--text-light); text-align: center; margin-top: 6px;">' +
          'Предпросмотр — посмотреть · PDF — клиенту · Word — править · «На печать» — на офисный принтер' +
          '</div>';
  html += '</div>';

  // Документы к КП (чертежи/спецификации) — видны клиенту на странице
  html += '<div style="padding: 12px 18px;">';
  html += '<h3 style="font-size: 15px; margin-bottom: 8px; display:flex; align-items:center; gap:6px;"><i class="ti ti-paperclip"></i> Документы <span style="font-weight:400;font-size:12px;color:var(--text-light);">— видны клиенту на странице КП</span></h3>';
  html += '<div id="sod-docs"><div style="font-size:13px;color:var(--text-light);">Загружаем…</div></div>';
  if (canEdit) {
    html += '<label class="btn btn-secondary" style="cursor:pointer;margin-top:8px;"><i class="ti ti-upload"></i> Прикрепить файл' +
            '<input type="file" style="display:none;" onchange="uploadOfferAttachment(' + o.id + ', this)"></label>';
  }
  html += '</div>';

  // Трекер: отправка по ссылке + активность (кто открыл/распечатал/скачал)
  html += '<div style="padding: 12px 18px;">';
  html += '<h3 style="font-size: 15px; margin-bottom: 8px; display:flex; align-items:center; gap:6px;"><i class="ti ti-link"></i> Отправка по ссылке и активность</h3>';
  html += '<div id="sod-tracker"><div style="font-size:13px;color:var(--text-light);">Загружаем…</div></div>';
  html += '</div>';

  // Версионирование — кнопка «Создать новую версию» (если canEdit)
  if (canEdit) {
    html += '<div style="padding: 12px 18px;">';
    html += '<button class="btn btn-secondary" onclick="createNewVersionOfCurrentOffer()" style="width: 100%; justify-content: center;">' +
            '<i class="ti ti-versions"></i> Создать новую версию (v' + (o.version + 1) + ')</button>';
    html += '<div style="font-size: 12px; color: var(--text-light); text-align: center; margin-top: 6px;">' +
            'Если клиент попросил переделать — сохраним текущее как архив и продолжим работу с новой версией' +
            '</div>';
    html += '</div>';
  }

  container.innerHTML = html;
  loadOfferTracker(o.id);
  loadOfferAttachments(o.id);
}

// ============ Документы к КП ============

async function loadOfferAttachments(offerId) {
  const el = document.getElementById('sod-docs');
  if (!el) return;
  let list = [];
  try {
    const d = await apiGet('/api/sale-offers/' + offerId + '/attachments');
    list = (d && d.attachments) || [];
  } catch (e) {
    el.innerHTML = '<div style="font-size:13px;color:var(--text-light);">Не удалось загрузить</div>';
    return;
  }
  const canEdit = canManageSales();
  if (!list.length) {
    el.innerHTML = '<div style="font-size:12.5px;color:var(--text-light);">Файлов нет. Прикрепи чертёж или спецификацию — клиент увидит их на странице КП.</div>';
    return;
  }
  let h = '';
  list.forEach(a => {
    const name = escapeHtml(a.filename || 'файл');
    const size = _kpFileSize(a.size);
    h += '<div style="display:flex;align-items:center;gap:10px;border:1px solid var(--border);border-radius:10px;padding:9px 11px;margin-bottom:8px;">';
    h += '<i class="ti ti-file-text" style="font-size:18px;color:var(--brand);"></i>';
    h += '<div style="flex:1;min-width:0;cursor:pointer;" onclick="downloadKpAttachment(' + a.id + ',\'' + escapeHtml((a.filename || '').replace(/'/g, "\\'")) + '\')">' +
         '<div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + name + '</div>' +
         (size ? '<div style="font-size:11.5px;color:var(--text-light);">' + size + '</div>' : '') +
         '</div>';
    h += '<button class="btn btn-secondary btn-small" onclick="downloadKpAttachment(' + a.id + ',\'' + escapeHtml((a.filename || '').replace(/'/g, "\\'")) + '\')" title="Открыть"><i class="ti ti-eye"></i></button>';
    if (canEdit) h += '<button class="btn btn-secondary btn-small" onclick="deleteKpAttachment(' + a.id + ',' + offerId + ')" title="Удалить"><i class="ti ti-trash"></i></button>';
    h += '</div>';
  });
  el.innerHTML = h;
}

function _kpFileSize(n) {
  n = parseInt(n || 0, 10);
  if (!n || n <= 0) return '';
  if (n < 1024) return n + ' Б';
  if (n < 1048576) return Math.round(n / 1024) + ' КБ';
  return (n / 1048576).toFixed(1) + ' МБ';
}

async function uploadOfferAttachment(offerId, input) {
  const file = input && input.files && input.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/sale-offers/' + offerId + '/attachments', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: fd,
    });
    if (!r.ok) {
      let msg = 'Не удалось загрузить';
      try { const e = await r.json(); if (e.message) msg = e.message; } catch (x) {}
      showToast(msg, 'error');
    } else {
      showToast('Файл прикреплён');
      await loadOfferAttachments(offerId);
    }
  } catch (e) {
    showToast('Не удалось загрузить', 'error');
  }
  input.value = '';
}

async function downloadKpAttachment(attachmentId, filename) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/kp-attachments/' + attachmentId + '/file', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) throw new Error('http');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    showToast('Не удалось открыть файл', 'error');
  }
}

async function deleteKpAttachment(attachmentId, offerId) {
  if (!confirm('Удалить документ? Он пропадёт со страницы КП.')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/kp-attachments/' + attachmentId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) throw new Error('http');
    await loadOfferAttachments(offerId);
  } catch (e) {
    showToast('Не удалось удалить', 'error');
  }
}

// ============ Трекер просмотров КП ============

async function loadOfferTracker(offerId) {
  const el = document.getElementById('sod-tracker');
  if (!el) return;
  let d;
  try {
    d = await apiGet('/api/sale-offers/' + offerId + '/tracker');
  } catch (e) {
    el.innerHTML = '<div style="font-size:13px;color:var(--text-light);">Не удалось загрузить активность</div>';
    return;
  }
  renderOfferTracker(el, d, offerId);
}

function _kpEventTime(s) {
  if (!s) return '';
  // created_at из SQLite — UTC ("YYYY-MM-DD HH:MM:SS"); приводим к локальному времени
  const iso = s.replace(' ', 'T') + (s.length <= 19 ? 'Z' : '');
  const d = new Date(iso);
  if (isNaN(d.getTime())) return s;
  const p = n => String(n).padStart(2, '0');
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function renderOfferTracker(el, d, offerId) {
  const canEdit = canManageSales();
  let h = '';
  // Счётчики
  const stat = (v, l, icon, brand) =>
    '<div style="background:var(--bg,#f1f5f9);border:1px solid var(--border);border-radius:10px;padding:10px 8px;text-align:center;">' +
      '<div style="font-size:20px;font-weight:800;' + (brand ? 'color:var(--brand);' : '') + '">' + (v || 0) + '</div>' +
      '<div style="font-size:11px;color:var(--text-light);margin-top:2px;"><i class="ti ' + icon + '"></i> ' + l + '</div></div>';
  h += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;">';
  h += stat(d.views, 'Просмотры', 'ti-eye', true);
  h += stat(d.prints, 'Печати', 'ti-printer', false);
  h += stat(d.downloads, 'Скачали', 'ti-download', false);
  h += stat(d.devices, 'Устройств', 'ti-devices', false);
  h += '</div>';

  h += '<button class="btn btn-primary" style="width:100%;justify-content:center;margin-bottom:10px;" onclick="createKpLink(' + offerId + ')"><i class="ti ti-plus"></i> Создать ссылку для клиента</button>';

  const links = d.links || [];
  if (links.length) {
    h += '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-light);margin:6px 0 6px;">Кому отправляли</div>';
    links.forEach(l => {
      // Ссылку строим от текущего домена приложения (как все публичные ссылки)
      const url = window.location.origin + '/kp/' + l.token;
      const safeUrl = escapeHtml(url.replace(/'/g, "\\'"));
      h += '<div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px;' + (l.is_active ? '' : 'opacity:.5;') + '">';
      h += '<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;">';
      h += '<div style="font-weight:600;font-size:13.5px;">' + escapeHtml(l.recipient_name || 'Без имени') + (l.is_active ? '' : ' <span style="font-weight:400;color:var(--text-light);">(отозвана)</span>') + '</div>';
      h += '<div style="font-size:12px;color:var(--text-light);white-space:nowrap;">' + (l.views || 0) + ' просм.</div>';
      h += '</div>';
      if (l.last_view_at) h += '<div style="font-size:11.5px;color:var(--text-light);margin-top:2px;">последний просмотр ' + _kpEventTime(l.last_view_at) + '</div>';
      h += '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">';
      h += '<input readonly value="' + escapeHtml(url) + '" onclick="this.select()" style="flex:1;min-width:140px;font-size:12px;font-family:monospace;border:1px solid var(--border);border-radius:8px;padding:6px 8px;background:#fff;">';
      h += '<button class="btn btn-secondary btn-small" onclick="copyKpLink(\'' + safeUrl + '\')" title="Копировать"><i class="ti ti-copy"></i></button>';
      if (canEdit && l.is_active) h += '<button class="btn btn-secondary btn-small" onclick="deleteKpLink(' + l.id + ',' + offerId + ')" title="Отозвать"><i class="ti ti-trash"></i></button>';
      h += '</div></div>';
    });
  } else {
    h += '<div style="font-size:12.5px;color:var(--text-light);margin-bottom:8px;">Ссылок пока нет. Создай ссылку и отправь клиенту — увидишь, когда её откроют.</div>';
  }

  const ev = d.events || [];
  if (ev.length) {
    h += '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-light);margin:14px 0 6px;">Лента событий</div>';
    h += '<div style="display:flex;flex-direction:column;gap:8px;max-height:340px;overflow-y:auto;padding-right:2px;">';
    ev.forEach(e => {
      let icon = 'ti-eye', label = 'Просмотрено';
      if (e.is_forward) { icon = 'ti-arrow-forward-up'; label = 'Открыто с нового устройства (возможно, переслали)'; }
      else if (e.event_type === 'print') { icon = 'ti-printer'; label = 'Распечатано'; }
      else if (e.event_type === 'download') { icon = 'ti-download'; label = 'Скачан PDF'; }
      const geo = [e.city, e.country].filter(Boolean).join(', ');
      const who = e.recipient_name ? (' · ' + e.recipient_name) : '';
      const sub = [geo, e.device].filter(Boolean).join(' · ') + who;
      h += '<div style="display:flex;gap:10px;align-items:flex-start;">';
      h += '<div style="width:28px;height:28px;border-radius:50%;background:var(--brand-bg,#eef2ff);color:var(--brand);display:flex;align-items:center;justify-content:center;flex:none;"><i class="ti ' + icon + '"></i></div>';
      h += '<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:500;">' + escapeHtml(label) + '</div>';
      if (sub.trim()) h += '<div style="font-size:11.5px;color:var(--text-light);">' + escapeHtml(sub) + '</div>';
      h += '</div>';
      h += '<div style="font-size:11.5px;color:var(--text-light);white-space:nowrap;">' + _kpEventTime(e.created_at) + '</div>';
      h += '</div>';
    });
    h += '</div>';
  }

  // Подсказка про ограничения трекинга
  h += '<div style="font-size:11.5px;color:var(--text-light);background:var(--bg,#f1f5f9);border-radius:8px;padding:9px 11px;margin-top:12px;">Открытие фиксируется надёжно. Печать и скачивание — когда клиент делает это на странице по ссылке. «Переслали» определяется по открытию с нового устройства.</div>';

  el.innerHTML = h;
}

async function createKpLink(offerId) {
  const name = prompt('Кому отправляете КП? (имя клиента / компании — для вашей статистики)');
  if (name === null) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/sale-offers/' + offerId + '/tracker-links', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_name: name }),
    });
    if (!r.ok) throw new Error('http');
    const d = await r.json();
    await loadOfferTracker(offerId);
    copyKpLink(window.location.origin + '/kp/' + d.token);
  } catch (e) {
    showToast('Не удалось создать ссылку', 'error');
  }
}

function copyKpLink(url) {
  if (!url) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => showToast('Ссылка скопирована')).catch(() => showToast('Ссылка: ' + url));
  } else {
    showToast('Ссылка: ' + url);
  }
}

async function deleteKpLink(linkId, offerId) {
  if (!confirm('Отозвать ссылку? Клиент больше не сможет открыть КП по ней.')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/kp-tracker-links/' + linkId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) throw new Error('http');
    await loadOfferTracker(offerId);
  } catch (e) {
    showToast('Не удалось отозвать', 'error');
  }
}

// Отправка КП на офисный принтер (печатает шлюз документов на сервере офиса).
// Работает откуда угодно — задание встаёт в очередь, бумага выходит в офисе.
async function printOffer() {
  if (!state.currentOfferId) return;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showToast('Сессия истекла, войдите заново', 'error');
    return;
  }
  showToast('Отправляю на печать…', 'success');
  try {
    const r = await apiPost('/api/documents/print', {
      doc_type: 'offer_pdf',
      offer_id: state.currentOfferId,
      copies: 1,
    });
    if (r.ok) {
      showToast('Отправлено на офисный принтер', 'success');
    } else {
      const msg = (r.data && (r.data.message || r.data.error)) || 'Не удалось отправить на печать';
      showToast(msg, 'error');
    }
  } catch (e) {
    showToast('Ошибка соединения: ' + String(e), 'error');
  }
}

async function downloadOfferPdf() {
  if (!state.currentOfferId) return;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showToast('Сессия истекла, войдите заново', 'error');
    return;
  }
  showToast('Готовим PDF…', 'success');
  try {
    const r = await fetch(API_BASE + '/api/sale-offers/' + state.currentOfferId + '/pdf', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      let msg = 'Не удалось получить PDF';
      try { const d = await r.json(); msg = d.message || msg; } catch (e) {}
      showToast(msg, 'error');
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    // Открываем в новой вкладке (мобильный браузер сам предложит скачать)
    window.open(url, '_blank');
    // Освобождаем память через минуту
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    showToast('Ошибка соединения: ' + String(e), 'error');
  }
}

// Предпросмотр КП: открываем PDF во вкладке для быстрого просмотра «как выглядит».
// Тот же PDF, что и «Скачать», но цель — посмотреть, а не сохранить.
async function previewOfferPdf() {
  if (!state.currentOfferId) return;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showToast('Сессия истекла, войдите заново', 'error');
    return;
  }
  // Вкладку открываем синхронно (в обработчике клика), иначе после await её
  // заблокирует попап-блокировщик. Потом подменим адрес на готовый PDF.
  const win = window.open('', '_blank');
  showToast('Готовим предпросмотр…', 'success');
  try {
    const r = await fetch(API_BASE + '/api/sale-offers/' + state.currentOfferId + '/pdf', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      let msg = 'Не удалось открыть предпросмотр';
      try { const d = await r.json(); msg = d.message || msg; } catch (e) {}
      showToast(msg, 'error');
      if (win) win.close();
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    if (win) { win.location = url; } else { window.open(url, '_blank'); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    showToast('Ошибка соединения: ' + String(e), 'error');
    if (win) win.close();
  }
}

// ЭТАП 17: Word-экспорт КП
async function downloadOfferDocx() {
  if (!state.currentOfferId) return;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showToast('Сессия истекла, войдите заново', 'error');
    return;
  }
  showToast('Готовим Word…', 'success');
  try {
    const r = await fetch(API_BASE + '/api/sale-offers/' + state.currentOfferId + '/docx', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      let msg = 'Не удалось получить Word';
      try { const d = await r.json(); msg = d.message || msg; } catch (e) {}
      showToast(msg, 'error');
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    // Word всегда скачиваем (не открываем в браузере)
    const a = document.createElement('a');
    a.href = url;
    // Имя из Content-Disposition или дефолт
    const cd = r.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="([^"]+)"/);
    a.download = match ? match[1] : 'КП.docx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    showToast('Ошибка соединения: ' + String(e), 'error');
  }
}

async function changeOfferStatus(offerId, newStatus) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/sale-offers/' + offerId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!r.ok) {
      const d = await r.json();
      showToast(d.message || 'Не удалось изменить статус', 'error');
      return;
    }
    showToast('Статус изменён', 'success');
    cache.offers = null;
    cache.offersCounts = null;
    loadCurrentOffer();
  } catch (e) {
    showToast('Ошибка: ' + String(e), 'error');
  }
}

async function deleteCurrentOffer() {
  if (!state.currentOfferId) return;
  if (!confirm('Удалить эту версию КП? Другие версии (если есть) останутся.')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/sale-offers/' + state.currentOfferId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const d = await r.json();
      showToast(d.message || 'Не удалось удалить', 'error');
      return;
    }
    showToast('КП удалено', 'success');
    cache.offers = null;
    cache.offersCounts = null;
    selectSidebarItem('sales-offers');
  } catch (e) {
    showToast('Ошибка: ' + String(e), 'error');
  }
}

async function createNewVersionOfCurrentOffer() {
  if (!state.currentOfferId) return;
  if (!confirm('Создать новую версию этого КП? Текущая останется в архиве, откроется форма редактирования новой версии.')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/sale-offers/' + state.currentOfferId + '/new-version', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({}),
    });
    const data = await r.json();
    if (!r.ok) {
      showToast(data.message || 'Не удалось создать версию', 'error');
      return;
    }
    showToast('Версия v' + data.version + ' создана', 'success');
    cache.offers = null;
    cache.offersCounts = null;
    state.currentOfferId = data.id;
    // Сразу открываем форму редактирования новой версии
    openEditOffer();
  } catch (e) {
    showToast('Ошибка: ' + String(e), 'error');
  }
}

// --------- ФОРМА КП ----------

function openNewOffer() {
  if (!canManageSales()) {
    showToast('Создавать КП может директор, зам или менеджер', 'error');
    return;
  }
  state.offerFormMode = 'new';
  state.currentOfferId = null;
  // По умолчанию менеджер — текущий пользователь (если есть в employees)
  let defaultManagerId = null;
  let defaultManagerName = '';
  // Попытаемся найти себя в списке менеджеров
  if (cache.managersForPicker && state.user) {
    const myEmp = cache.managersForPicker.find(e => e.id === (state.user && state.user.employee_id));
    if (myEmp) {
      defaultManagerId = myEmp.id;
      defaultManagerName = myEmp.short_name || myEmp.full_name;
    }
  }
  state.offerForm = {
    manager_id: defaultManagerId,
    manager_name: defaultManagerName,
    calculated_by_id: null,
    calculated_by_name: '',
    contractor_id: null, contractor_name: '', contractor_inn: '',
    legal_entity: 'ooo_atomus',
    valid_until: '',                       // ЭТАП 16А: считается на бэке
    valid_duration_value: 14,              // ЭТАП 16А: 14 дней по умолчанию
    valid_duration_unit: 'days',
    production_term: '',
    production_days: 20,                  // ЭТАП 16А-2: 20 рабочих дней по умолчанию
    payment_terms: '50% при изготовлении, 50% перед отгрузкой',  // ЭТАП 16А-2: шаблон по умолч.
    delivery_terms: '',
    comment_internal: '',
    comment_client: '',
    items: [],
  };
  // Авто-черновик: восстановим незаконченное новое КП, если оно есть
  state.offerDraftRestored = false;
  const _od = (typeof _draftLoad === 'function') ? _draftLoad(OFFER_DRAFT_KEY) : null;
  if (_od) {
    state.offerForm = Object.assign(state.offerForm, _od);
    if (!Array.isArray(state.offerForm.items)) state.offerForm.items = [];
    state.offerDraftRestored = true;
  }
  selectSidebarItem('sales-offer-form');
}

function discardOfferDraft() {
  if (typeof _draftClear === 'function') _draftClear(OFFER_DRAFT_KEY);
  state.offerDraftRestored = false;
  openNewOffer();   // пере-открываем чистую форму (черновик уже удалён)
  showToast('Черновик очищен', 'info');
}

async function openEditOffer() {
  if (!canManageSales()) {
    showToast('Редактировать может директор, зам или менеджер', 'error');
    return;
  }
  state.offerFormMode = 'edit';
  try {
    const o = await apiGet('/api/sale-offers/' + state.currentOfferId);
    state.offerForm = {
      manager_id: o.manager_id,
      manager_name: o.manager_name || o.manager_full_name || '',
      calculated_by_id: o.calculated_by_id || null,
      calculated_by_name: o.calc_by_name || o.calc_by_full_name || '',
      contractor_id: o.contractor_id,
      contractor_name: o.contractor_name || '',
      contractor_inn: o.contractor_inn || '',
      legal_entity: o.legal_entity || 'ooo_atomus',
      valid_until: o.valid_until || '',
      valid_duration_value: o.valid_duration_value || 14,
      valid_duration_unit: o.valid_duration_unit || 'days',
      production_term: o.production_term || '',
      production_days: o.production_days || null,
      payment_terms: o.payment_terms || '',
      delivery_terms: o.delivery_terms || '',
      comment_internal: o.comment_internal || '',
      comment_client: o.comment_client || '',
      items: (o.items || []).map(it => ({
        sale_product_id: it.sale_product_id,
        name: it.name,
        description: it.description || '',
        unit: it.unit || 'шт.',
        qty: it.qty,
        price: it.price,
        discount_pct: it.discount_pct,
      })),
      _offerNumber: o.number,
    };
    selectSidebarItem('sales-offer-form');
  } catch (e) {
    showToast('Не удалось загрузить: ' + String(e), 'error');
  }
}

function cancelOfferForm() {
  if (state.offerFormMode === 'edit' && state.currentOfferId) {
    selectSidebarItem('sales-offer-detail');
  } else {
    selectSidebarItem('sales-offers');
  }
}

function initOfferForm() {
  const isEdit = state.offerFormMode === 'edit';
  document.getElementById('sof-form-title').textContent =
    isEdit ? ('Редактирование ' + (state.offerForm._offerNumber || 'КП')) : 'Новое КП';
  document.getElementById('sof-form-mobile-title').textContent =
    isEdit ? 'Редактирование' : 'Новое КП';
  document.getElementById('sof-form-subtitle').textContent =
    isEdit ? 'Изменения сохранятся в текущей версии' : 'Номер сгенерируется автоматически после сохранения';
  renderOfferForm();
}

function renderOfferForm() {
  const container = document.getElementById('sof-form-content');
  const f = state.offerForm;
  const isEdit = state.offerFormMode === 'edit';

  let html = '';

  if (!isEdit && state.offerDraftRestored) {
    html += '<div class="task-draft-banner"><i class="ti ti-history"></i>' +
      '<span>Восстановлен черновик незаконченного КП.</span>' +
      '<button type="button" class="btn-link" onclick="discardOfferDraft()">Очистить</button></div>';
  }

  // Менеджер
  html += '<div class="sales-form-section">';
  html += '<div class="sales-form-title">Менеджер <span class="req">*</span></div>';
  html += '<div class="contractor-selector" onclick="openManagerModalForOffer()">';
  if (f.manager_id) {
    html += '<div class="selected-text"><div class="selected-name">' + escapeHtml(f.manager_name || '—') + '</div></div>';
  } else {
    html += '<div class="selected-text"><div class="placeholder">Выберите менеджера…</div></div>';
  }
  html += '<i class="ti ti-chevron-right chev"></i>';
  html += '</div></div>';

  // Рассчитал (необязательно)
  html += '<div class="sales-form-section">';
  html += '<div class="sales-form-title">Рассчитал</div>';
  html += '<div class="contractor-selector" onclick="openCalcModalForOffer()">';
  if (f.calculated_by_id) {
    html += '<div class="selected-text"><div class="selected-name">' + escapeHtml(f.calculated_by_name || '—') + '</div></div>';
  } else {
    html += '<div class="selected-text"><div class="placeholder">Кто рассчитал КП (необязательно)…</div></div>';
  }
  html += '<i class="ti ti-chevron-right chev"></i>';
  html += '</div>';
  if (f.calculated_by_id) {
    html += '<div style="margin-top:6px;"><button type="button" class="btn-link" onclick="clearOfferCalc(event)">Убрать</button></div>';
  }
  html += '</div>';

  // Контрагент
  html += '<div class="sales-form-section">';
  html += '<div class="sales-form-title">Контрагент <span class="req">*</span></div>';
  html += '<div class="contractor-selector" onclick="openContractorModalForOffer()">';
  if (f.contractor_id) {
    html += '<div class="selected-text">' +
            '<div class="selected-name">' + escapeHtml(f.contractor_name || '—') + '</div>' +
            (f.contractor_inn ? '<div class="selected-meta">ИНН ' + escapeHtml(f.contractor_inn) + '</div>' : '') +
            '</div>';
  } else {
    html += '<div class="selected-text"><div class="placeholder">Выберите контрагента…</div></div>';
  }
  html += '<i class="ti ti-chevron-right chev"></i>';
  html += '</div></div>';

  // Юрлицо
  html += '<div class="sales-form-section">';
  html += '<div class="sales-form-title">Юрлицо <span class="req">*</span></div>';
  html += '<div class="radio-chips column">';
  html += '<button type="button" class="' + (f.legal_entity === 'ooo_atomus' ? 'selected' : '') + '" onclick="setOfferLegalEntity(\'ooo_atomus\')">' +
          '<i class="ti ti-building"></i><div><b>ООО «Атомус Групп»</b><small>с НДС 22% · ИНН 7415103479</small></div></button>';
  html += '<button type="button" class="' + (f.legal_entity === 'ooo_td_atomus' ? 'selected' : '') + '" onclick="setOfferLegalEntity(\'ooo_td_atomus\')">' +
          '<i class="ti ti-building-skyscraper"></i><div><b>ООО ТД «Атомус Групп»</b><small>без НДС · ИНН 7415110363</small></div></button>';
  html += '</div></div>';

  // Сроки
  html += '<div class="sales-form-section">';
  html += '<div class="sales-form-title">Сроки и условия</div>';
  html += '<div class="sales-form-row">';
  // ЭТАП 16А: срок действия КП — число + единица измерения
  html += '<div><label>Срок действия КП <span class="hint" style="text-transform:none; font-weight:400; color:var(--text-light); font-size:11px;">(от даты создания)</span></label>' +
          '<div class="duration-row">' +
          '<input type="number" id="sof-valid-duration-value" min="1" max="365" value="' + (f.valid_duration_value || 14) + '">' +
          '<select id="sof-valid-duration-unit">' +
          '<option value="days"' + (f.valid_duration_unit === 'days' ? ' selected' : '') + '>дней</option>' +
          '<option value="weeks"' + (f.valid_duration_unit === 'weeks' ? ' selected' : '') + '>недель</option>' +
          '<option value="months"' + (f.valid_duration_unit === 'months' ? ' selected' : '') + '>месяцев</option>' +
          '</select>' +
          '</div></div>';
  // ЭТАП 16А-2: срок изготовления — число + «рабочих дней»
  html += '<div><label>Срок изготовления</label>' +
          '<div class="duration-row">' +
          '<input type="number" id="sof-production-days" min="0" max="365" value="' + (f.production_days || '') + '" placeholder="20">' +
          '<div class="duration-suffix">рабочих дней</div>' +
          '</div></div>';
  html += '</div>';

  // ЭТАП 16А-2: Условия оплаты — выпадашка с шаблонами + «свой вариант»
  html += renderPaymentTermsField(f.payment_terms);

  html += '<div class="sales-form-row cols-1"><div><label>Условия доставки</label>' +
          '<input type="text" id="sof-delivery-terms" value="' + escapeHtml(f.delivery_terms) + '" placeholder="напр. Самовывоз / доставка ТК"></div></div>';
  html += '</div>';

  // Позиции
  html += '<div class="sales-form-section">';
  html += '<div class="sales-form-title">Состав КП <span class="req">*</span></div>';
  if (f.items.length === 0) {
    html += '<div style="padding: 18px; text-align: center; color: var(--text-light); font-size: 13px;">Позиций пока нет. Добавьте хотя бы одну.</div>';
  } else {
    f.items.forEach((it, idx) => {
      const lineTotal = calcItemTotal(it);
      html += '<div class="item-row-edit">';
      html += '<div style="flex:1; min-width:0;">';
      html += '<div style="font-size:13px; font-weight:500; margin-bottom:8px;">' + (idx + 1) + '. ' + escapeHtml(it.name);
      if (!it.sale_product_id) {
        html += ' <span class="ire-no-product" style="font-size:11px;">(не из каталога)</span>';
      }
      html += '</div>';
      html += '<div class="ire-desc"><label class="ire-label">Расшифровка — что это, видит клиент</label>' +
              '<input type="text" value="' + escapeHtml(it.description || '') + '" oninput="updateOfferItem(' + idx + ', \'description\', this.value)" placeholder="напр.: Щит управления, стандартное исполнение, IP54; автоматика Carel"></div>';
      html += '<div class="ire-body">';
      html += '<div><label class="ire-label">Кол-во</label>' +
              '<input type="number" step="0.01" min="0" value="' + (it.qty || 1) + '" oninput="updateOfferItem(' + idx + ', \'qty\', this.value)"></div>';
      html += '<div><label class="ire-label">Цена ₽</label>' +
              '<input type="number" step="100" min="0" value="' + (it.price || 0) + '" oninput="updateOfferItem(' + idx + ', \'price\', this.value)"></div>';
      html += '<div><label class="ire-label">Сумма</label>' +
              '<div class="ire-line-total" id="sof-item-total-' + idx + '">' + formatMoney(lineTotal) + '</div></div>';
      html += '</div></div>';
      html += '<button class="ire-remove" onclick="removeOfferItem(' + idx + ')" title="Убрать"><i class="ti ti-x"></i></button>';
      html += '</div>';
    });
    // Итого
    const total = calcOfferTotal(f.items);
    html += '<div style="background: var(--brand-bg); padding: 12px 14px; border-radius: 10px; margin-top: 10px; display: flex; justify-content: space-between; align-items: center;">' +
      '<span style="font-weight:600; color: var(--brand); text-transform: uppercase; letter-spacing: 0.4px; font-size: 12px;">Итого</span>' +
      '<span id="sof-grand-total" style="font-weight:700; color: var(--brand); font-size: 18px;">' + formatMoney(total) + '</span>' +
      '</div>';
  }
  html += '<button class="btn btn-secondary" onclick="openSaleProductPickModal()" style="width: 100%; justify-content: center; margin-top: 12px;">' +
          '<i class="ti ti-plus"></i> Добавить позицию</button>';
  html += '</div>';

  // Комментарии
  html += '<div class="sales-form-section">';
  html += '<div class="sales-form-title">Комментарии</div>';
  html += '<div class="sales-form-row cols-1"><div><label>Комментарий клиенту <span class="hint" style="text-transform:none; font-weight:400; color:var(--text-light); font-size:11px;">(попадёт в PDF)</span></label>' +
          '<textarea id="sof-comment-client" placeholder="Доп. условия, особенности для клиента">' + escapeHtml(f.comment_client) + '</textarea></div></div>';
  html += '<div class="sales-form-row cols-1"><div><label>Внутренний комментарий <span class="hint" style="text-transform:none; font-weight:400; color:var(--text-light); font-size:11px;">(не попадёт в PDF)</span></label>' +
          '<textarea id="sof-comment-internal" placeholder="Заметки для своих">' + escapeHtml(f.comment_internal) + '</textarea></div></div>';
  html += '</div>';

  // Кнопки
  html += '<div class="sales-action-bar">';
  html += '<button class="btn btn-secondary" onclick="cancelOfferForm()">Отмена</button>';
  html += '<button class="btn btn-primary" id="sof-submit" onclick="submitOfferForm()">' +
          '<i class="ti ti-check"></i> ' + (isEdit ? 'Сохранить' : 'Создать КП') + '</button>';
  html += '</div>';
  html += '<div id="sof-error"></div>';

  container.innerHTML = html;

  // Авто-черновик нового КП: менеджер, контрагент, юрлицо и позиции выбираются
  // через модалки/кнопки и НЕ порождают input/change-событий, поэтому
  // глобального слушателя _formDraftAutosave недостаточно. renderOfferForm
  // вызывается после каждого такого изменения state.offerForm — сохраняем
  // черновик здесь, чтобы начатое КП пережило обновление страницы.
  if (!isEdit) {
    try { _draftSave(OFFER_DRAFT_KEY, state.offerForm, _offerDraftHasContent); } catch (_) {}
  }

  // Подвязка полей
  document.getElementById('sof-valid-duration-value').addEventListener('input', e => {
    const v = parseInt(e.target.value) || 0;
    state.offerForm.valid_duration_value = (v >= 1 && v <= 365) ? v : 14;
  });
  document.getElementById('sof-valid-duration-unit').addEventListener('change', e => {
    state.offerForm.valid_duration_unit = e.target.value;
  });
  // ЭТАП 16А-2: production_days
  const pdEl = document.getElementById('sof-production-days');
  if (pdEl) {
    pdEl.addEventListener('input', e => {
      const v = parseInt(e.target.value);
      state.offerForm.production_days = (isNaN(v) || v <= 0) ? null : Math.min(365, v);
    });
  }
  // ЭТАП 16А-2: условия оплаты — либо select, либо textarea (зависит от состояния)
  const ptInput = document.getElementById('sof-payment-terms-input');
  if (ptInput) {
    ptInput.addEventListener('input', e => { state.offerForm.payment_terms = e.target.value; });
  }
  document.getElementById('sof-delivery-terms').addEventListener('input', e => { state.offerForm.delivery_terms = e.target.value; });
  document.getElementById('sof-comment-client').addEventListener('input', e => { state.offerForm.comment_client = e.target.value; });
  document.getElementById('sof-comment-internal').addEventListener('input', e => { state.offerForm.comment_internal = e.target.value; });
}

function setOfferLegalEntity(le) {
  state.offerForm.legal_entity = le;
  renderOfferForm();
}

function updateOfferItem(idx, field, value) {
  const it = state.offerForm.items[idx];
  if (!it) return;
  if (field === 'qty' || field === 'price' || field === 'discount_pct') {
    it[field] = Number(value) || 0;
  } else {
    it[field] = value;
  }
  // Пересчёт сумм БЕЗ полного renderOfferForm(): иначе input пересоздаётся и
  // фокус слетает после каждой цифры. Точечно обновляем сумму этой позиции и
  // общий итог по их id — поля ввода не трогаем.
  if (field === 'qty' || field === 'price' || field === 'discount_pct') {
    const itEl = document.getElementById('sof-item-total-' + idx);
    if (itEl) itEl.textContent = formatMoney(calcItemTotal(it));
    const totEl = document.getElementById('sof-grand-total');
    if (totEl) totEl.textContent = formatMoney(calcOfferTotal(state.offerForm.items));
  }
  // Черновик (раньше его сохранял renderOfferForm) — сохраняем явно.
  if (state.offerFormMode !== 'edit') {
    try { _draftSave(OFFER_DRAFT_KEY, state.offerForm, _offerDraftHasContent); } catch (_) {}
  }
}

function removeOfferItem(idx) {
  state.offerForm.items.splice(idx, 1);
  renderOfferForm();
}

async function submitOfferForm() {
  const errEl = document.getElementById('sof-error');
  const btn = document.getElementById('sof-submit');
  errEl.innerHTML = '';

  const f = state.offerForm;
  if (!f.manager_id) { errEl.innerHTML = '<div class="sales-error">Выберите менеджера</div>'; return; }
  if (!f.contractor_id) { errEl.innerHTML = '<div class="sales-error">Выберите контрагента</div>'; return; }
  if (f.items.length === 0) { errEl.innerHTML = '<div class="sales-error">Добавьте хотя бы одну позицию</div>'; return; }
  for (const it of f.items) {
    if (!(it.name || '').trim()) { errEl.innerHTML = '<div class="sales-error">У всех позиций должно быть название</div>'; return; }
    if (Number(it.qty) <= 0) { errEl.innerHTML = '<div class="sales-error">Количество в позиции «' + escapeHtml(it.name) + '» должно быть больше 0</div>'; return; }
  }

  const payload = {
    manager_id: f.manager_id,
    calculated_by_id: f.calculated_by_id || null,
    contractor_id: f.contractor_id,
    legal_entity: f.legal_entity,
    // ЭТАП 16А: длительность вместо явной даты — valid_until посчитается на бэке
    valid_duration_value: f.valid_duration_value || 14,
    valid_duration_unit: f.valid_duration_unit || 'days',
    production_term: f.production_term.trim() || null,
    production_days: f.production_days || null,         // ЭТАП 16А-2
    payment_terms: f.payment_terms.trim() || null,
    delivery_terms: f.delivery_terms.trim() || null,
    comment_internal: f.comment_internal.trim() || null,
    comment_client: f.comment_client.trim() || null,
    items: f.items.map(it => ({
      sale_product_id: it.sale_product_id || null,
      name: it.name,
      description: it.description || null,
      unit: it.unit || 'шт.',
      qty: Number(it.qty) || 1,
      price: Number(it.price) || 0,
      discount_pct: Number(it.discount_pct) || 0,
    })),
  };

  const isEdit = state.offerFormMode === 'edit';
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> Сохраняем…';

  try {
    let r;
    const token = localStorage.getItem(TOKEN_KEY);
    if (isEdit) {
      r = await fetch(API_BASE + '/api/sale-offers/' + state.currentOfferId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(payload),
      });
    } else {
      r = await fetch(API_BASE + '/api/sale-offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(payload),
      });
    }
    const data = await r.json();
    if (!r.ok) {
      errEl.innerHTML = '<div class="sales-error">' + escapeHtml(data.message || data.error || 'Ошибка') + '</div>';
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-check"></i> ' + (isEdit ? 'Сохранить' : 'Создать КП');
      return;
    }
    if (!isEdit && typeof _draftClear === 'function') _draftClear(OFFER_DRAFT_KEY);
    showToast(isEdit ? 'КП обновлено' : 'КП ' + data.number + ' создано', 'success');
    cache.offers = null;
    cache.offersCounts = null;
    state.currentOfferId = data.id;
    setTimeout(() => selectSidebarItem('sales-offer-detail'), 200);
  } catch (e) {
    errEl.innerHTML = '<div class="sales-error">Ошибка соединения: ' + escapeHtml(String(e)) + '</div>';
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i> ' + (isEdit ? 'Сохранить' : 'Создать КП');
  }
}

// --------- МОДАЛКА МЕНЕДЖЕРА ДЛЯ КП ----------

function openManagerModalForOffer() {
  state._managerModalContext = 'offer';
  openManagerModal();
}

// «Рассчитал» для КП — тот же пикер сотрудников, отдельный контекст.
function openCalcModalForOffer() {
  state._managerModalContext = 'offer_calc';
  openManagerModal();
}

function clearOfferCalc(e) {
  if (e) e.stopPropagation();
  state.offerForm.calculated_by_id = null;
  state.offerForm.calculated_by_name = '';
  renderOfferForm();
}

// selectManager живёт в app-4.js (там объявление function selectManager,
// которое грузится позже и перекрывает любой override отсюда). Контекст КП
// (offerForm) обрабатывается прямо там по state._managerModalContext.

// --------- МОДАЛКА КОНТРАГЕНТА ДЛЯ КП ----------

function openContractorModalForOffer() {
  state._contractorModalContext = 'offer';
  openContractorModal();
}

// selectContractor живёт в app-4.js (объявление перекрывает override отсюда).
// Контекст КП (offerForm) обрабатывается там по state._contractorModalContext.

// --------- МОДАЛКА ВЫБОРА ПРОДАЖНОЙ ПОЗИЦИИ ----------

function openSaleProductPickModal() {
  // v2.45.218: иерархический пикер с вкладками (Продажи / Производство)
  state._offerPick = { tab: 'sale', filter: '', openGroups: {} };
  document.getElementById('sale-product-pick-modal').classList.add('visible');
  const si = document.getElementById('sp-pick-search'); if (si) si.value = '';
  document.querySelectorAll('.nom-picker-tab[data-opick-tab]').forEach(t =>
    t.classList.toggle('active', t.getAttribute('data-opick-tab') === 'sale'));
  _renderOfferPick();
  setTimeout(() => { const f = document.getElementById('sp-pick-search'); if (f) f.focus(); }, 100);
}

function closeSaleProductPickModal() {
  document.getElementById('sale-product-pick-modal').classList.remove('visible');
}

// ============================================================================
// ЭТАП 47 (v2.44.0): КАТАЛОГ ОБОРУДОВАНИЯ — фронт (TZ-Stage 34 v2)
// ============================================================================

// Подписи и юниты для филд-чипов и Bento-сетки
const CATALOG_CATEGORY_DEFAULTS = {
  compressor:     { measureLabel: 'Мощность',     measureUnit: 'Вт' },
  air_cooler:     { measureLabel: 'Мощность',     measureUnit: 'кВт' },
  condenser:      { measureLabel: 'Рассеив-я',    measureUnit: 'кВт' },
  heat_exchanger: { measureLabel: 'Мощность',     measureUnit: 'кВт' },
  automation:     { measureLabel: '',             measureUnit: '' },
  electronics:    { measureLabel: '',             measureUnit: '' },
  materials:      { measureLabel: '',             measureUnit: '' },
  refrigerants:   { measureLabel: '',             measureUnit: '' },
};

// v2.44.5: лейблы и единицы для catalog_attrs — переводим английские ключи и форматируем значения.
const CATALOG_ATTR_LABELS = {
  // air_cooler
  fin_pitch_mm:    { label: 'Шаг оребрения',     unit: 'мм' },
  fans_spec:       { label: 'Вентиляторы' },
  airflow_m3h:     { label: 'Расход воздуха',    unit: 'м³/ч' },
  surface_m2:      { label: 'Площадь теплообмена', unit: 'м²' },
  volume_liter:    { label: 'Внутренний объём',  unit: 'л' },
  voltage:         { label: 'Напряжение' },
  defrost_power_w: { label: 'Мощность оттайки',  unit: 'Вт' },
  motor_power_w:   { label: 'Мощность двигателя', unit: 'Вт' },
  motor_current_a: { label: 'Ток двигателя',     unit: 'А' },
  throw_m:         { label: 'Длина воздушной струи', unit: 'м' },
  inlet_size:      { label: 'Вход' },
  outlet_size:     { label: 'Выход' },
  drain_size:      { label: 'Дренаж' },
  refrigerants:    { label: 'Хладагенты' },
  // compressor
  displacement_cm3: { label: 'Рабочий объём',    unit: 'см³' },
  application:     { label: 'Применение' },
  // automation
  connection:      { label: 'Подключение' },
  refrigerant:     { label: 'Хладагент' },
  compatible_body: { label: 'Совместимый корпус' },
  // refrigerants
  fluid:           { label: 'Маркировка' },
  package:         { label: 'Упаковка' },
  net_weight_kg:   { label: 'Нетто',             unit: 'кг' },
  // materials
  diameter_mm:     { label: 'Диаметр',           unit: 'мм' },
  // общие
  mounting_dimensions: { label: 'Монтажные размеры' },
  ip_rating:       { label: 'Степень защиты' },
  noise_db:        { label: 'Уровень шума',      unit: 'дБ' },
  power_kw:        { label: 'Мощность',          unit: 'кВт' },
  current_a:       { label: 'Ток',               unit: 'А' },
  rpm:             { label: 'Обороты вентилятора', unit: 'об/мин' },
  pipe_d_in:       { label: 'Вход (труба)' },
  pipe_d_out:      { label: 'Выход (труба)' },
  fans_count:      { label: 'Кол-во вентиляторов' },
  fans_diameter_mm:{ label: 'Диаметр вентиляторов', unit: 'мм' },
};

function _formatPowerW(power_w) {
  if (power_w == null) return null;
  if (power_w >= 1000) {
    const kw = (power_w / 1000).toFixed(2).replace(/\.?0+$/, '');
    return kw + ' кВт';
  }
  return power_w + ' Вт';
}

function _formatCatalogAttr(key, value) {
  // Возвращает { label, value } с локализованным лейблом и единицей.
  let cfg = CATALOG_ATTR_LABELS[key];
  if (!cfg) {
    // Неизвестный ключ — делаем человекочитаемый fallback из snake_case.
    const pretty = String(key).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    cfg = { label: pretty };
  }
  let v = value;
  if (Array.isArray(v)) v = v.join(', ');
  if (v === null || v === undefined) v = '';
  const text = String(v);
  return {
    label: cfg.label,
    value: cfg.unit && text ? text + ' ' + cfg.unit : text,
  };
}

async function loadCatalog() {
  const el = document.getElementById('catalog-content');
  if (!el) return;
  if (!cache.catalogState) cache.catalogState = { category: null, brand: null };

  el.innerHTML = '<div class="loading-block">Загружаем каталог…</div>';
  try {
    if (!cache.catalogCategories) {
      const d = await apiGet('/api/catalog/categories');
      cache.catalogCategories = d.categories || [];
    }
  } catch (e) {
    el.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
    return;
  }

  // По умолчанию открыта первая категория
  if (!cache.catalogState.category && cache.catalogCategories.length) {
    cache.catalogState.category = cache.catalogCategories[0].code;
  }

  // Кнопку «Добавить позицию» показываем только тем, кто может управлять
  const newBtn = document.getElementById('cat-new-btn');
  if (newBtn) {
    const canManage = (typeof hasPermission === 'function') && hasPermission('sales.manage');
    newBtn.style.display = canManage ? '' : 'none';
  }

  renderCatalogTabs();
  await loadCatalogProducts(cache.catalogState.category);
}

function renderCatalogTabs() {
  const el = document.getElementById('catalog-content');
  if (!el) return;
  const cats = cache.catalogCategories || [];
  const active = cache.catalogState.category;
  const activeCat = cats.find(c => c.code === active);

  // Sticky-навигация (только на мобиле, на десктопе ведёт себя обычно)
  let html = '<div class="catalog-sticky-nav">';
  html += '<div class="catalog-tabs">';
  cats.forEach(c => {
    const isActive = c.code === active ? ' active' : '';
    html += '<button class="catalog-tab' + isActive + '" onclick="setCatalogCategory(\'' + escapeText(c.code) + '\')">' +
      '<i class="ti ' + escapeText(c.icon || 'ti-package') + '"></i>' +
      escapeText(c.name) +
      '</button>';
  });
  html += '</div>';

  // Строка поиска по категории — всегда видна
  if (activeCat) {
    const currentQ = (cache.catalogState.q || '').replace(/"/g, '&quot;');
    const hideClear = currentQ ? '' : ' style="display:none"';
    html += '<div class="catalog-search-row">' +
      '<i class="ti ti-search"></i>' +
      '<input type="search" id="catalog-search" placeholder="Поиск по артикулу / названию / бренду…" ' +
        'value="' + currentQ + '" oninput="onCatalogSearchInput(this.value)" autocomplete="off">' +
      '<button class="search-clear" id="catalog-search-clear" onclick="clearCatalogSearch()" title="Очистить"' + hideClear + '><i class="ti ti-x"></i></button>' +
      '</div>';
  }

  // Панель действий над списком: основная CTA «Подбор» + сгруппированный импорт + сидинг
  if (activeCat && activeCat.selector_kind) {
    html += '<div class="catalog-selector-bar">';
    const selectorActive = cache.catalogState.selectorResults != null;
    if (selectorActive) {
      html += '<div class="selector-status"><i class="ti ti-target"></i>Результаты подбора · ' +
        (cache.catalogState.selectorResults.count || 0) + ' позиций' +
        ' <button class="btn-link" onclick="resetCatalogSelector()">Сбросить</button></div>';
    } else {
      // Основная кнопка
      const label = activeCat.selector_kind === 'power' ? 'Подбор по мощности' : 'Подбор по характеристикам';
      html += '<button class="btn btn-primary btn-sm" onclick="openCatalogSelectorModal()">' +
        '<i class="ti ti-target"></i><span>' + escapeText(label) + '</span></button>';

      // Действия импорта — в одной серой группе, чтобы визуально не конкурировали с CTA
      const canManage = (typeof hasPermission === 'function') && hasPermission('sales.manage');
      if (canManage) {
        html += '<div class="toolbar-group">';
        html += '<button class="btn-tool" onclick="openCatalogPdfImport()" title="AI-парсинг каталога поставщика из PDF">' +
          '<i class="ti ti-file-text"></i><span class="btn-label-full">PDF</span></button>';
        html += '<button class="btn-tool" onclick="openCatalogXlsxImport()" title="Импорт прайс-листа Excel (все листы одним прогоном)">' +
          '<i class="ti ti-table"></i><span class="btn-label-full">Excel</span></button>';
        if (activeCat.code === 'air_cooler') {
          html += '<button class="btn-tool" onclick="seedBeliefBsTef()" title="Загрузить все воздухоохладители Belief (32 модели)">' +
            '<i class="ti ti-snowflake"></i><span class="btn-label-full">Belief seed</span></button>';
        }
        html += '</div>';
      }
    }
    html += '</div>';
  }

  html += '</div>';  // /catalog-sticky-nav
  html += '<div id="catalog-body"><div class="loading-block">Загружаем…</div></div>';
  el.innerHTML = html;
}

async function setCatalogCategory(code) {
  cache.catalogState.category = code;
  cache.catalogState.brand = null;
  cache.catalogState.formFactor = null;
  cache.catalogState.q = null;
  renderCatalogTabs();
  await loadCatalogProducts(code);
}

async function loadCatalogProducts(code) {
  const body = document.getElementById('catalog-body');
  if (!body) return;
  body.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try {
    const params = new URLSearchParams({ category: code });
    if (cache.catalogState.brand) params.append('brand', cache.catalogState.brand);
    if (cache.catalogState.formFactor) params.append('form_factor', cache.catalogState.formFactor);
    if (cache.catalogState.q) params.append('q', cache.catalogState.q);
    const d = await apiGet('/api/catalog/products?' + params.toString());
    cache.catalogProducts = d;
    renderCatalogProducts();
  } catch (e) {
    body.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

// Дебаунс-таймер для поиска
window._catalogSearchTimer = null;
function onCatalogSearchInput(value) {
  // Кнопка X показывается/прячется сразу, без ожидания дебаунса
  const clearBtn = document.getElementById('catalog-search-clear');
  if (clearBtn) clearBtn.style.display = value && value.trim() ? '' : 'none';

  if (window._catalogSearchTimer) clearTimeout(window._catalogSearchTimer);
  window._catalogSearchTimer = setTimeout(() => {
    const q = (value || '').trim();
    cache.catalogState.q = q || null;
    loadCatalogProducts(cache.catalogState.category);
  }, 350);
}

function clearCatalogSearch() {
  cache.catalogState.q = null;
  const inp = document.getElementById('catalog-search');
  if (inp) { inp.value = ''; inp.focus(); }
  const clearBtn = document.getElementById('catalog-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  loadCatalogProducts(cache.catalogState.category);
}

function setCatalogBrand(brand) {
  cache.catalogState.brand = (cache.catalogState.brand === brand) ? null : brand;
  loadCatalogProducts(cache.catalogState.category);
}

function setCatalogFormFactor(ff) {
  cache.catalogState.formFactor = (cache.catalogState.formFactor === ff) ? null : ff;
  loadCatalogProducts(cache.catalogState.category);
}

function renderCatalogProducts() {
  const body = document.getElementById('catalog-body');
  if (!body) return;
  const d = cache.catalogProducts || { products: [], brands: [], form_factors: [] };
  const products = d.products || [];
  const brands = d.brands || [];
  const formFactors = d.form_factors || [];
  const cat = (cache.catalogCategories || []).find(c => c.code === cache.catalogState.category) || {};
  const defaults = CATALOG_CATEGORY_DEFAULTS[cat.code] || {};

  let html = '';
  // Чипы фильтров: тип + бренд. Дедуплицируем бренды case-insensitive
  // (на случай если backfill ещё не пробежался).
  const brandSeen = new Set();
  const brandsDedup = [];
  brands.forEach(b => {
    const key = String(b || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (key && !brandSeen.has(key)) {
      brandSeen.add(key);
      brandsDedup.push(b);
    }
  });
  if (formFactors.length || brandsDedup.length) {
    html += '<div class="catalog-toolbar" style="flex-direction: column; align-items: stretch; gap: 6px;">';
    if (formFactors.length) {
      html += '<div class="catalog-brand-chips">';
      html += '<span class="chips-label">Тип</span>';
      formFactors.forEach(ff => {
        const isActive = ff.code === cache.catalogState.formFactor ? ' active' : '';
        html += '<span class="catalog-brand-chip' + isActive + '" onclick="setCatalogFormFactor(' + JSON.stringify(ff.code).replace(/"/g, '&quot;') + ')">' +
          escapeText(ff.label) + '</span>';
      });
      html += '</div>';
    }
    if (brandsDedup.length) {
      html += '<div class="catalog-brand-chips">';
      html += '<span class="chips-label">Бренд</span>';
      brandsDedup.forEach(b => {
        const isActive = (b || '').toLowerCase() === (cache.catalogState.brand || '').toLowerCase() ? ' active' : '';
        html += '<span class="catalog-brand-chip' + isActive + '" onclick="setCatalogBrand(' + JSON.stringify(b).replace(/"/g, '&quot;') + ')">' +
          escapeText(b) + '</span>';
      });
      html += '</div>';
    }
    html += '</div>';
  }

  if (!products.length) {
    const canManage = (typeof hasPermission === 'function') && hasPermission('sales.manage');
    html += '<div class="empty-block"><i class="ti ti-package-off"></i>В разделе «' + escapeText(cat.name || '') + '» пока нет позиций';
    if (canManage) {
      html += '<div style="margin-top: 14px;"><button class="btn btn-secondary" onclick="seedCatalogDemo()"><i class="ti ti-sparkles"></i> Загрузить демо-данные (5 позиций)</button></div>';
    }
    html += '</div>';
    body.innerHTML = html;
    return;
  }

  html += '<div class="catalog-list">';
  products.forEach(p => {
    // Мета: бренд · мощность · подтип
    const metaParts = [];
    if (p.brand) metaParts.push('<b>' + escapeText(p.brand) + '</b>');
    if (p.power_w && defaults.measureUnit === 'кВт') {
      const kw = (p.power_w / 1000).toFixed(2).replace(/\.?0+$/, '');
      metaParts.push(kw + ' кВт');
    } else if (p.power_w) {
      metaParts.push(p.power_w + ' Вт');
    }
    if (p.subtype) metaParts.push(escapeText(p.subtype));
    if (p.power_standard) metaParts.push(escapeText(p.power_standard));

    let priceCell;
    if (p.price_eur) {
      priceCell = '<div class="row-price">€' + p.price_eur.toFixed(2) + '<small>с НДС</small></div>';
    } else {
      priceCell = '<div class="row-price muted"><small>по запросу</small></div>';
    }

    html += '<div class="catalog-row" onclick="openCatalogProduct(' + p.id + ')">' +
      '<div class="row-code">' + escapeText(p.code || '—') + '</div>' +
      '<div class="row-main">' +
        '<div class="row-name">' + escapeText(p.name) + '</div>' +
        (metaParts.length ? '<div class="row-meta">' + metaParts.join(' · ') + '</div>' : '') +
      '</div>' +
      (p.supplier ? '<div class="row-supplier"><i class="ti ti-check"></i>' + escapeText(p.supplier) + '</div>' : '<div></div>') +
      priceCell +
      '</div>';
  });
  html += '</div>';
  body.innerHTML = html;
}

async function _loadCatalogPhotoBlob(productId, imgElId) {
  const img = document.getElementById(imgElId);
  if (!img) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/catalog/products/' + productId + '/photo', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) return;
    const blob = await r.blob();
    img.src = URL.createObjectURL(blob);
  } catch (e) {}
}

async function openCatalogProduct(id) {
  try {
    const p = await apiGet('/api/catalog/products/' + id);
    renderCatalogDetailModal(p);
  } catch (e) {
    showToast('Не удалось открыть позицию: ' + e, 'error');
  }
}

function renderCatalogDetailModal(p) {
  // Создаём модалку «на лету» если её ещё нет в DOM
  let modal = document.getElementById('catalog-detail-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay catalog-detail-modal';
    modal.id = 'catalog-detail-modal';
    modal.onclick = (e) => { if (e.target === modal) closeCatalogDetail(); };
    modal.innerHTML = '<div class="modal" style="max-width: 800px;">' +
      '<div class="modal-header">' +
        '<h3 id="catalog-detail-title">Карточка</h3>' +
        '<button class="icon-btn" onclick="closeCatalogDetail()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body" id="catalog-detail-body"></div>' +
    '</div>';
    document.body.appendChild(modal);
  }

  const attrs = p.catalog_attrs || {};

  // v2.44.6: фото временно убираем из карточки — будет вместе с формой создания/редактирования
  let html = '<div class="catalog-detail-hero" style="grid-template-columns: 1fr;">';
  html += '<div class="catalog-detail-meta">';
  if (p.supplier) html += '<div class="row-supplier" style="margin-bottom: 6px;"><i class="ti ti-check"></i>' + escapeText(p.supplier) + '</div>';
  if (p.code) html += '<div class="code">' + escapeText(p.code) + '</div>';
  html += '<h2>' + escapeText(p.name) + '</h2>';
  if (p.brand || p.series) {
    html += '<div class="code">' + [p.brand, p.series].filter(Boolean).map(escapeText).join(' / ') + '</div>';
  }
  // v2.44.13: мощность с условиями — заметная строка в hero
  if (p.power_w || p.power_standard) {
    const parts = [];
    if (p.power_w) parts.push('<b>' + escapeText(_formatPowerW(p.power_w)) + '</b>');
    if (p.power_standard) parts.push('<span style="color: var(--text-light);">' + escapeText(p.power_standard) + '</span>');
    html += '<div style="margin-top: 6px; font-size: 13.5px;">' + parts.join(' · ') + '</div>';
  }
  if (p.description) html += '<div class="desc">' + escapeText(p.description) + '</div>';
  if (p.price_eur) {
    html += '<div style="margin-top: 10px; font-size: 16px; font-weight: 700;">€' + p.price_eur.toFixed(2) + ' <small style="font-size: 12px; font-weight: 500; color: var(--text-light);">с НДС' + (p.price_source ? ' · ' + escapeText(p.price_source) : '') + '</small></div>';
  }
  html += '</div>';
  html += '</div>';

  // Bento: габариты и масса — показываем только заполненные ячейки.
  const dims = [
    { lbl: 'Длина',  val: p.length_mm, unit: 'мм' },
    { lbl: 'Ширина', val: p.width_mm,  unit: 'мм' },
    { lbl: 'Высота', val: p.height_mm, unit: 'мм' },
    { lbl: 'Масса',  val: p.mass_kg,   unit: 'кг' },
  ].filter(d => d.val != null && d.val !== '');
  if (dims.length) {
    html += '<h3 class="catalog-spec-section" style="margin-top: 0;">Габариты и вес</h3>';
    html += '<div class="catalog-bento">';
    dims.forEach(d => {
      html += '<div class="catalog-bento-cell"><div class="lbl">' + escapeText(d.lbl) + '</div><div class="val">' + escapeText(String(d.val)) + ' <small>' + d.unit + '</small></div></div>';
    });
    html += '</div>';
  }

  // Технические характеристики из catalog_attrs + первичных полей
  const specs = [];
  if (p.power_w) specs.push(['Мощность', _formatPowerW(p.power_w)]);
  if (p.power_standard) specs.push(['Условия номинала', p.power_standard]);
  if (p.subtype) specs.push(['Подтип', p.subtype]);
  Object.keys(attrs).forEach(k => {
    const v = attrs[k];
    if (v === null || v === undefined || v === '' || k === 'cooling_data') return;
    const fmt = _formatCatalogAttr(k, v);
    if (fmt.value) specs.push([fmt.label, fmt.value]);
  });

  if (specs.length) {
    html += '<div class="catalog-spec-section"><h3>Характеристики</h3>';
    html += '<table class="catalog-spec-table">';
    specs.forEach(([k, v]) => {
      html += '<tr><td>' + escapeText(String(k)) + '</td><td>' + escapeText(String(v)) + '</td></tr>';
    });
    html += '</table></div>';
  }

  // Таблица холодопроизводительности (если есть)
  const cd = Array.isArray(attrs.cooling_data) ? attrs.cooling_data : null;
  if (cd && cd.length) {
    html += '<div class="catalog-spec-section"><h3>Холодопроизводительность</h3>';
    html += '<table class="catalog-spec-table"><tr><td>Хладагент</td><td>DT, K</td><td>To, °C</td><td>Мощность, Вт</td></tr>';
    cd.forEach(r => {
      html += '<tr>' +
        '<td>' + escapeText(String(r.refrigerant || '—')) + '</td>' +
        '<td>' + escapeText(String(r.dt_k != null ? r.dt_k : '—')) + '</td>' +
        '<td>' + escapeText(String(r.to_c != null ? r.to_c : '—')) + '</td>' +
        '<td>' + escapeText(String(r.power_w != null ? r.power_w : '—')) + '</td>' +
        '</tr>';
    });
    html += '</table></div>';
  }

  if (p.external_url) {
    html += '<div style="margin-top: 14px;"><a href="' + escapeText(p.external_url) + '" target="_blank" rel="noopener" style="color: var(--brand); font-size: 13px;"><i class="ti ti-external-link"></i> Источник</a></div>';
  }

  document.getElementById('catalog-detail-title').textContent = p.code || p.name;
  document.getElementById('catalog-detail-body').innerHTML = html;
  modal.classList.add('visible');
  window._catalogCurrentProductId = p.id;
}

function closeCatalogDetail() {
  const modal = document.getElementById('catalog-detail-modal');
  if (modal) modal.classList.remove('visible');
}

async function uploadCatalogPhoto(productId, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const resp = await fetch(API_BASE + '/api/catalog/products/' + productId + '/photo', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: form,
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(t || ('HTTP ' + resp.status));
    }
    showToast('Фото загружено', 'ok');
    // Перерисовываем карточку и список
    cache.catalogProducts = null;
    await openCatalogProduct(productId);
    if (cache.catalogState && cache.catalogState.category) {
      loadCatalogProducts(cache.catalogState.category);
    }
  } catch (e) {
    showToast('Не удалось загрузить фото: ' + e.message, 'error');
  }
}

// Заглушка: форма создания/редактирования позиции — на 34.9
function openCatalogProductForm(id) {
  showToast('Форма каталога будет добавлена в Stage 34.9', 'info');
}

// ============================================================================
// ПОДБОР ПО ПАРАМЕТРАМ (Stage 34.6)
// ============================================================================

async function openCatalogSelectorModal() {
  const code = cache.catalogState && cache.catalogState.category;
  if (!code) return;
  let cfg;
  try {
    cfg = await apiGet('/api/catalog/selector-fields?category=' + encodeURIComponent(code));
  } catch (e) {
    showToast('Не удалось открыть подбор: ' + e.message, 'error');
    return;
  }

  let modal = document.getElementById('catalog-selector-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'catalog-selector-modal';
    modal.onclick = (e) => { if (e.target === modal) closeCatalogSelector(); };
    modal.innerHTML = '<div class="modal" style="max-width: 480px;">' +
      '<div class="modal-header">' +
        '<h3 id="catalog-selector-title">Подбор</h3>' +
        '<button class="icon-btn" onclick="closeCatalogSelector()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body" id="catalog-selector-body"></div>' +
    '</div>';
    document.body.appendChild(modal);
  }

  const cats = cache.catalogCategories || [];
  const cat = cats.find(c => c.code === code) || {};
  document.getElementById('catalog-selector-title').textContent =
    cfg.selector_kind === 'power' ? 'Подбор по мощности — ' + cat.name : 'Подбор — ' + cat.name;

  // Рендер полей
  let body = '<form id="catalog-selector-form" onsubmit="event.preventDefault(); submitCatalogSelector();" style="display: flex; flex-direction: column; gap: 12px;">';
  cfg.fields.forEach(f => {
    body += '<label style="display: flex; flex-direction: column; gap: 4px;">';
    body += '<span style="font-size: 12px; color: var(--text-light); font-weight: 600;">' + escapeText(f.label) +
      (f.unit ? ', ' + escapeText(f.unit) : '') +
      (f.required ? ' <span style="color: #DC2626;">*</span>' : '') + '</span>';
    if (f.type === 'number') {
      body += '<input type="number" step="any" name="' + escapeText(f.key) + '" ' +
        (f.required ? 'required ' : '') +
        'class="form-input" style="width: 100%;">';
    } else if (f.type === 'select') {
      body += '<select name="' + escapeText(f.key) + '" class="form-input" style="width: 100%;">';
      body += '<option value="">— любой —</option>';
      (f.options || []).forEach(o => {
        body += '<option value="' + escapeText(String(o)) + '">' + escapeText(String(o)) + '</option>';
      });
      body += '</select>';
    }
    body += '</label>';
  });
  body += '<button type="submit" class="btn btn-primary" style="margin-top: 8px;"><i class="ti ti-target"></i>Подобрать</button>';
  body += '</form>';
  document.getElementById('catalog-selector-body').innerHTML = body;
  modal.classList.add('visible');
}

function closeCatalogSelector() {
  const m = document.getElementById('catalog-selector-modal');
  if (m) m.classList.remove('visible');
}

async function submitCatalogSelector() {
  const code = cache.catalogState && cache.catalogState.category;
  if (!code) return;
  const form = document.getElementById('catalog-selector-form');
  if (!form) return;
  const fd = new FormData(form);
  const body = { category: code };
  fd.forEach((v, k) => {
    if (v === '' || v == null) return;
    // Числа автоматом
    const num = Number(v);
    body[k] = (!Number.isNaN(num) && String(num) === String(v)) ? num : v;
  });
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/catalog/select', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(t || ('HTTP ' + r.status));
    }
    const d = await r.json();
    cache.catalogState.selectorResults = d;
    closeCatalogSelector();
    renderCatalogTabs();         // обновит панель с «Сбросить»
    renderCatalogSelectorResults();
  } catch (e) {
    showToast('Ошибка подбора: ' + e.message, 'error');
  }
}

function resetCatalogSelector() {
  cache.catalogState.selectorResults = null;
  renderCatalogTabs();
  loadCatalogProducts(cache.catalogState.category);
}

function renderCatalogSelectorResults() {
  const body = document.getElementById('catalog-body');
  if (!body) return;
  const d = cache.catalogState.selectorResults || {};
  const results = d.results || [];
  if (!results.length) {
    body.innerHTML = '<div class="empty-block"><i class="ti ti-package-off"></i>Нет позиций, удовлетворяющих критериям</div>';
    return;
  }
  let html = '<div class="catalog-list">';
  results.forEach(r => {
    // Маркер слева
    const marker = '<span class="row-marker m-' + escapeText(r.marker) + '">' + escapeText(r.marker_label) + '</span>';

    // Контекст: power_at_conditions или score
    let metaParts = [];
    if (r.brand) metaParts.push('<b>' + escapeText(r.brand) + '</b>');
    if (r.power_at_conditions != null) {
      const fmt = r.power_at_conditions >= 1000
        ? (r.power_at_conditions / 1000).toFixed(2).replace(/\.?0+$/, '') + ' кВт'
        : r.power_at_conditions + ' Вт';
      let label = 'при заданных условиях: ' + fmt;
      if (r.power_source === 'nominal') label += ' (номинал)';
      else if (r.power_source === 'nominal_dt_scaled') label += ' (≈ по DT)';
      metaParts.push(label);
    }
    if (r.subtype) metaParts.push(escapeText(r.subtype));

    let priceCell;
    if (r.price_eur) {
      priceCell = '<div class="row-price">€' + r.price_eur.toFixed(2) + '<small>с НДС</small></div>';
    } else {
      priceCell = '<div class="row-price muted"><small>по запросу</small></div>';
    }

    html += '<div class="catalog-row" onclick="openCatalogProduct(' + r.id + ')">' +
      '<div class="row-code">' + marker + ' ' + escapeText(r.code || '—') + '</div>' +
      '<div class="row-main">' +
        '<div class="row-name">' + escapeText(r.name) + '</div>' +
        (metaParts.length ? '<div class="row-meta">' + metaParts.join(' · ') + '</div>' : '') +
      '</div>' +
      (r.supplier ? '<div class="row-supplier"><i class="ti ti-check"></i>' + escapeText(r.supplier) + '</div>' : '<div></div>') +
      priceCell +
      '</div>';
  });
  html += '</div>';
  body.innerHTML = html;
}

// ============================================================================
// AI-парсинг каталога поставщика из PDF
// ============================================================================

function openCatalogPdfImport() {
  const code = cache.catalogState && cache.catalogState.category;
  if (!code) return;
  const cats = cache.catalogCategories || [];
  const cat = cats.find(c => c.code === code) || {};

  let modal = document.getElementById('catalog-pdf-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'catalog-pdf-modal';
    modal.onclick = (e) => { if (e.target === modal) closeCatalogPdfImport(); };
    modal.innerHTML = '<div class="modal" style="max-width: 920px;">' +
      '<div class="modal-header">' +
        '<h3>Импорт каталога из PDF</h3>' +
        '<button class="icon-btn" onclick="closeCatalogPdfImport()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body" id="catalog-pdf-body"></div>' +
    '</div>';
    document.body.appendChild(modal);
  }

  document.getElementById('catalog-pdf-body').innerHTML =
    '<div style="display: flex; flex-direction: column; gap: 14px;">' +
      '<div style="font-size: 13px; color: var(--text-mid); line-height: 1.5;">' +
        'AI разрежет PDF на куски и распознает позиции в фоне. Грузить можно любой размер — целый каталог поставщика тоже зайдёт.' +
        '<br>Категория: <b>' + escapeText(cat.name || code) + '</b>' +
      '</div>' +
      '<label style="display: flex; flex-direction: column; gap: 4px;">' +
        '<span style="font-size: 12px; color: var(--text-light); font-weight: 600;">PDF файл (до 50 МБ)</span>' +
        '<input type="file" id="catalog-pdf-file" accept="application/pdf">' +
      '</label>' +
      '<label style="display: flex; flex-direction: column; gap: 4px;">' +
        '<span style="font-size: 12px; color: var(--text-light); font-weight: 600;">Поставщик (опционально)</span>' +
        '<input type="text" id="catalog-pdf-supplier" placeholder="например, СПС-Холод" class="form-input">' +
      '</label>' +
      '<div style="display: flex; gap: 12px; align-items: center;">' +
        '<label style="display: flex; flex-direction: column; gap: 4px; flex: 1;">' +
          '<span style="font-size: 12px; color: var(--text-light); font-weight: 600;">Чанк, страниц</span>' +
          '<input type="number" id="catalog-pdf-chunk" value="10" min="2" max="30" class="form-input">' +
        '</label>' +
        '<label style="display: flex; align-items: center; gap: 6px; cursor: pointer; margin-top: 18px;">' +
          '<input type="checkbox" id="catalog-pdf-auto">' +
          '<span style="font-size: 12.5px;">Загрузить автоматически по завершении</span>' +
        '</label>' +
      '</div>' +
      '<button class="btn btn-primary" onclick="runCatalogPdfImport()"><i class="ti ti-sparkles"></i>Запустить импорт</button>' +
      '<div id="catalog-pdf-result"></div>' +
    '</div>';
  modal.classList.add('visible');
}

function closeCatalogPdfImport() {
  const m = document.getElementById('catalog-pdf-modal');
  if (m) m.classList.remove('visible');
  if (window._catalogPollTimer) {
    clearTimeout(window._catalogPollTimer);
    window._catalogPollTimer = null;
  }
}

async function runCatalogPdfImport() {
  const fileInput = document.getElementById('catalog-pdf-file');
  const file = fileInput && fileInput.files && fileInput.files[0];
  if (!file) {
    showToast('Выберите PDF-файл', 'error');
    return;
  }
  const code = cache.catalogState && cache.catalogState.category;
  const supplier = (document.getElementById('catalog-pdf-supplier') || {}).value || '';
  const chunkSize = (document.getElementById('catalog-pdf-chunk') || {}).value || '10';
  const autoApply = (document.getElementById('catalog-pdf-auto') || {}).checked ? '1' : '0';

  const resultEl = document.getElementById('catalog-pdf-result');
  resultEl.innerHTML = '<div class="loading-block" style="margin: 10px 0;">Загружаем PDF на сервер…</div>';

  const form = new FormData();
  form.append('file', file);
  form.append('category_code', code);
  if (supplier) form.append('supplier', supplier);
  form.append('chunk_size', chunkSize);
  form.append('auto_apply', autoApply);

  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/catalog/import-pdf-chunked', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: form,
    });
    if (!r.ok) {
      let errMsg = 'HTTP ' + r.status;
      try { const err = await r.json(); if (err && err.message) errMsg = err.message; } catch (_) {}
      throw new Error(errMsg);
    }
    const d = await r.json();
    window._catalogImportJobId = d.job_id;
    pollCatalogImportStatus(d.job_id, d.total_chunks, d.total_pages);
  } catch (e) {
    resultEl.innerHTML = '<div class="empty-block" style="text-align: left; padding: 14px;"><div style="display: flex; gap: 10px; align-items: flex-start;"><i class="ti ti-alert-triangle" style="font-size: 20px; color: #DC2626;"></i><div>' + escapeText(e.message || String(e)) + '</div></div></div>';
  }
}

async function pollCatalogImportStatus(jobId, totalChunks, totalPages) {
  const resultEl = document.getElementById('catalog-pdf-result');
  if (!resultEl) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/catalog/import-jobs/' + jobId, {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const job = await r.json();

    const pct = totalChunks > 0 ? Math.round((job.done_chunks || 0) / totalChunks * 100) : 0;
    let html = '<div style="margin-top: 10px;">' +
      '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">' +
        '<span style="font-size: 13px; color: var(--text-mid);">' +
          (job.status === 'completed' ? '<i class="ti ti-check" style="color: #16A34A;"></i> Готово' :
           job.status === 'failed'    ? '<i class="ti ti-x" style="color: #DC2626;"></i> Ошибка' :
                                        '<i class="ti ti-loader"></i> Обрабатываем') +
          ' · чанк ' + (job.done_chunks || 0) + ' из ' + totalChunks +
          ' · найдено позиций: <b>' + (job.products_count || 0) + '</b>' +
        '</span>' +
        '<span style="font-size: 13px; color: var(--text-light);">' + pct + '%</span>' +
      '</div>' +
      '<div style="height: 8px; background: var(--bg); border-radius: 4px; overflow: hidden;">' +
        '<div style="height: 100%; background: var(--brand); width: ' + pct + '%; transition: width 0.3s;"></div>' +
      '</div>';

    if (job.status === 'failed') {
      html += '<div style="margin-top: 10px; color: #DC2626; font-size: 12.5px;">' +
        escapeText(job.error_message || 'Неизвестная ошибка') + '</div>';
    }

    if (job.status === 'completed') {
      if (job.applied) {
        let applyInfo = '';
        try {
          const m = JSON.parse(job.error_message || '{}');
          if (m && (m.added != null || m.updated != null)) {
            applyInfo = ' · добавлено ' + (m.added || 0) + ', обновлено ' + (m.updated || 0);
          }
        } catch (_) {}
        html += '<div style="margin-top: 10px; padding: 10px 12px; background: #E8F5E9; border-radius: 8px; font-size: 13px; color: #16A34A;">' +
          '<i class="ti ti-check"></i> Импорт завершён и применён к каталогу' + applyInfo + '</div>';
      } else {
        html += '<div style="margin-top: 10px; display: flex; gap: 10px;">' +
          '<button class="btn btn-primary btn-sm" onclick="applyCatalogImport(' + jobId + ')"><i class="ti ti-check"></i>Загрузить в каталог</button>' +
          '<button class="btn btn-secondary btn-sm" onclick="showCatalogImportPreview(' + jobId + ')"><i class="ti ti-eye"></i>Превью</button>' +
        '</div>';
      }
    }
    html += '</div>';
    resultEl.innerHTML = html;

    if (job.status === 'pending' || job.status === 'running') {
      window._catalogPollTimer = setTimeout(
        () => pollCatalogImportStatus(jobId, totalChunks, totalPages),
        3000,
      );
    } else if (job.status === 'completed' && job.applied) {
      // Обновляем список каталога
      cache.catalogProducts = null;
      loadCatalogProducts(cache.catalogState.category);
    }
  } catch (e) {
    resultEl.innerHTML = '<div class="empty-block">Ошибка опроса: ' + escapeText(e.message || String(e)) + '</div>';
  }
}

async function applyCatalogImport(jobId) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/catalog/import-jobs/' + jobId + '/apply', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      let errMsg = 'HTTP ' + r.status;
      try { const err = await r.json(); if (err && err.message) errMsg = err.message; } catch (_) {}
      throw new Error(errMsg);
    }
    const d = await r.json();
    showToast('Загружено: ' + (d.added || 0) + ', обновлено: ' + (d.updated || 0) +
              (d.errors_count ? ' (ошибок ' + d.errors_count + ')' : ''), 'ok');
    closeCatalogPdfImport();
    cache.catalogProducts = null;
    loadCatalogProducts(cache.catalogState.category);
  } catch (e) {
    showToast('Не удалось загрузить: ' + e.message, 'error');
  }
}

async function showCatalogImportPreview(jobId) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/catalog/import-jobs/' + jobId + '/products', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    window._catalogParsedProducts = d.products || [];
    renderCatalogPdfPreview(d);
  } catch (e) {
    showToast('Не удалось загрузить превью: ' + e.message, 'error');
  }
}

function renderCatalogPdfPreview(d) {
  const resultEl = document.getElementById('catalog-pdf-result');
  const products = d.products || [];
  if (!products.length) {
    resultEl.innerHTML = '<div class="empty-block"><i class="ti ti-info-circle"></i>AI не нашёл позиций в этом PDF</div>';
    return;
  }

  let html = '<div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border);">';
  html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">' +
    '<b style="font-size: 14px;">Распознано позиций: ' + products.length + '</b>' +
    '<button class="btn btn-primary btn-sm" onclick="confirmCatalogPdfBulkCreate()"><i class="ti ti-check"></i>Загрузить в каталог</button>' +
  '</div>';
  html += '<div style="max-height: 50vh; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px;">';
  html += '<table style="width: 100%; border-collapse: collapse; font-size: 12.5px;">';
  html += '<thead style="position: sticky; top: 0; background: var(--bg); z-index: 1;"><tr>' +
    '<th style="text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); width: 110px;">Артикул</th>' +
    '<th style="text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border);">Название</th>' +
    '<th style="text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); width: 90px;">Бренд</th>' +
    '<th style="text-align: right; padding: 8px 10px; border-bottom: 1px solid var(--border); width: 90px;">Мощность</th>' +
    '<th style="text-align: right; padding: 8px 10px; border-bottom: 1px solid var(--border); width: 80px;">Цена EUR</th>' +
    '</tr></thead><tbody>';
  products.forEach(p => {
    const pw = p.power_w ? (p.power_w >= 1000 ? (p.power_w / 1000).toFixed(2).replace(/\.?0+$/, '') + ' кВт' : p.power_w + ' Вт') : '—';
    const price = (p.price_eur != null) ? '€' + Number(p.price_eur).toFixed(2) : '—';
    html += '<tr>' +
      '<td style="padding: 6px 10px; border-bottom: 1px solid var(--border); font-family: ui-monospace, Menlo, monospace; font-size: 11.5px;">' + escapeText(p.code || '—') + '</td>' +
      '<td style="padding: 6px 10px; border-bottom: 1px solid var(--border);">' + escapeText(p.name || '—') + '</td>' +
      '<td style="padding: 6px 10px; border-bottom: 1px solid var(--border); color: var(--text-light);">' + escapeText(p.brand || '—') + '</td>' +
      '<td style="padding: 6px 10px; border-bottom: 1px solid var(--border); text-align: right;">' + escapeText(pw) + '</td>' +
      '<td style="padding: 6px 10px; border-bottom: 1px solid var(--border); text-align: right; font-weight: 600;">' + price + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div></div>';
  resultEl.innerHTML = html;
}

async function confirmCatalogPdfBulkCreate() {
  const products = window._catalogParsedProducts || [];
  const code = cache.catalogState && cache.catalogState.category;
  if (!products.length || !code) return;
  const resultEl = document.getElementById('catalog-pdf-result');
  const status = document.createElement('div');
  status.style.marginTop = '10px';
  status.style.fontSize = '13px';
  status.style.color = 'var(--text-light)';
  status.textContent = 'Сохраняю…';
  resultEl.appendChild(status);
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/catalog/bulk-create', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ category_code: code, products }),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(t || ('HTTP ' + r.status));
    }
    const d = await r.json();
    showToast('Импорт: добавлено ' + (d.added || 0) + ', обновлено ' + (d.updated || 0) +
              (d.errors_count ? ' (ошибок ' + d.errors_count + ')' : ''), 'ok');
    closeCatalogPdfImport();
    cache.catalogProducts = null;
    loadCatalogProducts(code);
  } catch (e) {
    showToast('Не удалось сохранить: ' + e.message, 'error');
  }
}

// ============================================================================
// Импорт Excel-прайса (все 41 лист одним заходом, без AI)
// ============================================================================

function openCatalogXlsxImport() {
  let modal = document.getElementById('catalog-xlsx-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'catalog-xlsx-modal';
    modal.onclick = (e) => { if (e.target === modal) closeCatalogXlsxImport(); };
    modal.innerHTML = '<div class="modal" style="max-width: 720px;">' +
      '<div class="modal-header">' +
        '<h3>Импорт Excel-прайса</h3>' +
        '<button class="icon-btn" onclick="closeCatalogXlsxImport()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body" id="catalog-xlsx-body"></div>' +
    '</div>';
    document.body.appendChild(modal);
  }
  document.getElementById('catalog-xlsx-body').innerHTML =
    '<div style="display: flex; flex-direction: column; gap: 14px;">' +
      '<div style="font-size: 13px; color: var(--text-mid); line-height: 1.5;">' +
        'Загрузи xlsx прайс-лист СПС-Холод. Сервер сам разложит позиции по 8 разделам каталога ' +
        '(маппинг по префиксу листа: <code>18→Воздухоохладители</code>, <code>19→Конденсаторы</code>, ' +
        '<code>22→Автоматика</code> и т.д.).' +
      '</div>' +
      '<div style="font-size: 12px; padding: 10px 12px; background: #E0F2FE; border-left: 3px solid #2563EB; border-radius: 6px; line-height: 1.5; color: #1E40AF;">' +
        '<b><i class="ti ti-info-circle"></i> Логика:</b> позиции, у которых артикул производителя уже есть в каталоге ' +
        '(BS-TEF027M ED, EA-130AE6-C05 и т.д.), <b>обновятся ценой и поставщиком</b>. Новые позиции добавятся с ' +
        'кодом производителя если он распознан в названии, иначе — с кодом СПС-Холод.' +
      '</div>' +
      '<label style="display: flex; flex-direction: column; gap: 4px;">' +
        '<span style="font-size: 12px; color: var(--text-light); font-weight: 600;">XLSX файл (до 50 МБ)</span>' +
        '<input type="file" id="catalog-xlsx-file" accept=".xlsx">' +
      '</label>' +
      '<button class="btn btn-primary" onclick="runCatalogXlsxImport()"><i class="ti ti-sparkles"></i>Запустить импорт</button>' +
      '<div id="catalog-xlsx-result"></div>' +
    '</div>';
  modal.classList.add('visible');
}

function closeCatalogXlsxImport() {
  const m = document.getElementById('catalog-xlsx-modal');
  if (m) m.classList.remove('visible');
  if (window._catalogXlsxPollTimer) { clearTimeout(window._catalogXlsxPollTimer); window._catalogXlsxPollTimer = null; }
}

async function runCatalogXlsxImport() {
  const fileInput = document.getElementById('catalog-xlsx-file');
  const file = fileInput && fileInput.files && fileInput.files[0];
  if (!file) {
    showToast('Выберите xlsx-файл', 'error');
    return;
  }
  const resultEl = document.getElementById('catalog-xlsx-result');
  resultEl.innerHTML = '<div class="loading-block" style="margin: 10px 0;">Загружаем прайс на сервер…</div>';
  const form = new FormData();
  form.append('file', file);
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/catalog/import-xlsx', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: form,
    });
    if (!r.ok) {
      let errMsg = 'HTTP ' + r.status;
      try { const err = await r.json(); if (err && err.message) errMsg = err.message; } catch (_) {}
      throw new Error(errMsg);
    }
    const d = await r.json();
    pollCatalogXlsxStatus(d.job_id, d.total_chunks);
  } catch (e) {
    resultEl.innerHTML = '<div class="empty-block" style="text-align: left; padding: 14px;"><i class="ti ti-alert-triangle" style="color: #DC2626;"></i> ' + escapeText(e.message || String(e)) + '</div>';
  }
}

async function pollCatalogXlsxStatus(jobId, totalChunks) {
  const resultEl = document.getElementById('catalog-xlsx-result');
  if (!resultEl) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/catalog/import-jobs/' + jobId, {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const job = await r.json();
    const pct = totalChunks > 0 ? Math.round((job.done_chunks || 0) / totalChunks * 100) : 0;
    let html = '<div style="margin-top: 10px;">' +
      '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">' +
        '<span style="font-size: 13px; color: var(--text-mid);">' +
          (job.status === 'completed' ? '<i class="ti ti-check" style="color: #16A34A;"></i> Готово' :
           job.status === 'failed'    ? '<i class="ti ti-x" style="color: #DC2626;"></i> Ошибка' :
                                        '<i class="ti ti-loader"></i> Обрабатываем') +
          ' · лист ' + (job.done_chunks || 0) + ' из ' + totalChunks +
          ' · позиций: <b>' + (job.products_count || 0) + '</b>' +
        '</span>' +
        '<span style="font-size: 13px; color: var(--text-light);">' + pct + '%</span>' +
      '</div>' +
      '<div style="height: 8px; background: var(--bg); border-radius: 4px; overflow: hidden;">' +
        '<div style="height: 100%; background: var(--brand); width: ' + pct + '%; transition: width 0.3s;"></div>' +
      '</div>';
    if (job.status === 'failed') {
      html += '<div style="margin-top: 10px; color: #DC2626; font-size: 12.5px;">' +
        escapeText(job.error_message || 'Неизвестная ошибка') + '</div>';
    }
    if (job.status === 'completed') {
      let summary = '';
      try {
        const m = JSON.parse(job.error_message || '{}');
        if (m && (m.added != null || m.updated != null)) {
          summary = ' · добавлено ' + (m.added || 0) + ', обновлено ' + (m.updated || 0);
        }
      } catch (_) {}
      html += '<div style="margin-top: 10px; padding: 10px 12px; background: #E8F5E9; border-radius: 8px; font-size: 13px; color: #16A34A;">' +
        '<i class="ti ti-check"></i> Прайс импортирован' + summary + '</div>';
    }
    html += '</div>';
    resultEl.innerHTML = html;
    if (job.status === 'pending' || job.status === 'running') {
      window._catalogXlsxPollTimer = setTimeout(
        () => pollCatalogXlsxStatus(jobId, totalChunks),
        3000,
      );
    } else if (job.status === 'completed') {
      cache.catalogProducts = null;
      if (cache.catalogState && cache.catalogState.category) {
        loadCatalogProducts(cache.catalogState.category);
      }
    }
  } catch (e) {
    resultEl.innerHTML = '<div class="empty-block">Ошибка опроса: ' + escapeText(e.message || String(e)) + '</div>';
  }
}

// Заливка полной серии Belief BS-TEF (16 моделей воздухоохладителей).
async function seedBeliefBsTef() {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/catalog/seed-belief-bs-tef', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(t || ('HTTP ' + r.status));
    }
    const d = await r.json();
    showToast('Belief BS-TEF: добавлено ' + (d.added || 0) + ', обновлено ' + (d.updated || 0) + (d.errors ? ' (✕' + d.errors + ')' : ''), 'ok');
    cache.catalogProducts = null;
    if (cache.catalogState && cache.catalogState.category === 'air_cooler') {
      loadCatalogProducts('air_cooler');
    }
  } catch (e) {
    showToast('Не удалось загрузить серию: ' + e.message, 'error');
  }
}

// Разовый сидинг 5 демо-позиций — кнопка показывается на пустой категории.
async function seedCatalogDemo() {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/catalog/seed-demo', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(t || ('HTTP ' + r.status));
    }
    const d = await r.json();
    const photoNote = (d.photos_added != null)
      ? ' · фото: ' + (d.photos_added || 0) + (d.photos_failed ? ' (✕' + d.photos_failed + ')' : '')
      : '';
    showToast('Загружено: ' + (d.added || 0) + ', пропущено: ' + (d.skipped || 0) + photoNote, 'ok');
    cache.catalogProducts = null;
    if (cache.catalogState && cache.catalogState.category) {
      loadCatalogProducts(cache.catalogState.category);
    }
  } catch (e) {
    showToast('Не удалось загрузить демо: ' + e.message, 'error');
  }
}

// v2.45.218: КП-пикер стал иерархическим — продажная номенклатура по
// группа→подгруппа, производственная по направление→подгруппа. Те же .sp-tree-*.
function loadSaleProductsForPickModal(query) {
  if (!state._offerPick) state._offerPick = { tab: 'sale', filter: '', openGroups: {} };
  state._offerPick.filter = (query || '').trim().toLowerCase();
  _renderOfferPick();
}

function switchOfferPickTab(tab) {
  if (!state._offerPick) state._offerPick = { tab: 'sale', filter: '', openGroups: {} };
  state._offerPick.tab = tab;
  state._offerPick.openGroups = {};
  document.querySelectorAll('.nom-picker-tab[data-opick-tab]').forEach(t =>
    t.classList.toggle('active', t.getAttribute('data-opick-tab') === tab));
  _renderOfferPick();
}

function toggleOfferPickGroup(key) {
  if (!state._offerPick) return;
  state._offerPick.openGroups[key] = !state._offerPick.openGroups[key];
  _renderOfferPick();
}

async function _renderOfferPick() {
  const container = document.getElementById('sp-pick-body');
  if (!container) return;
  const st = state._offerPick || (state._offerPick = { tab: 'sale', filter: '', openGroups: {} });
  container.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try {
    if (st.tab === 'production') {
      if (!cache.models) cache.models = await apiGet('/api/models');
      container.innerHTML = _offerProductionTreeHtml(st);
    } else {
      if (!cache.saleProducts) cache.saleProducts = await apiGet('/api/sale-products');
      container.innerHTML = _offerSaleTreeHtml(st);
    }
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function _offerPickEmpty() {
  return '<div class="empty-block"><i class="ti ti-search"></i>Не найдено. Можно добавить произвольную позицию кнопкой внизу.</div>';
}
function _offerGroupTpl(key, name, count, open, inner) {
  return '<div class="sp-tree-group">' +
    '<button type="button" class="sp-tree-toggle group' + (open ? ' open' : '') + '" onclick="toggleOfferPickGroup(\'' + key.replace(/'/g, "\\'") + '\')">' +
      '<i class="ti ti-chevron-right sp-tree-chev"></i><i class="ti ti-folder" style="font-size:16px;"></i>' +
      '<span>' + escapeHtml(name) + '</span><span class="sp-tree-count">' + count + '</span>' +
    '</button>' + (open ? ('<div class="sp-tree-body">' + inner + '</div>') : '') +
  '</div>';
}
function _offerSubTpl(key, name, count, open, inner) {
  return '<div class="sp-tree-subgroup">' +
    '<button type="button" class="sp-tree-toggle subgroup' + (open ? ' open' : '') + '" onclick="toggleOfferPickGroup(\'' + key.replace(/'/g, "\\'") + '\')">' +
      '<i class="ti ti-chevron-right sp-tree-chev"></i><span>' + escapeHtml(name) + '</span>' +
      '<span class="sp-tree-count subgroup">' + count + '</span>' +
    '</button>' + (open ? ('<div class="sp-tree-items">' + inner + '</div>') : '') +
  '</div>';
}
function _offerSaleItem(p) {
  const priceText = (p.base_price != null) ? formatMoney(p.base_price) + ' / ' + (p.unit || 'шт.') : 'цена по запросу';
  const nc = p.nc_code ? '<span style="font-family:monospace;font-size:11px;">' + escapeHtml(p.nc_code) + '</span> · ' : '';
  return '<div class="sp-tree-item" onclick="pickSaleProductForOffer(' + p.id + ')">' +
    '<div class="sp-tree-item-main">' +
      '<div class="sp-tree-item-name">' + escapeHtml(p.name || '') + '</div>' +
      '<div class="sp-tree-item-meta">' + nc + escapeHtml(p.product_type_label || 'Товар') + ' · ' + escapeHtml(priceText) + '</div>' +
    '</div></div>';
}
function _offerModelItem(m) {
  const article = m.article || '', name = m.name || '';
  const priceText = (m.base_price != null) ? formatMoney(m.base_price) + ' / шт.' : 'цена по запросу';
  return '<div class="sp-tree-item" onclick="pickModelForOffer(' + m.id + ')">' +
    '<div class="sp-tree-item-main">' +
      '<div class="sp-tree-item-name">' + (article ? '<b>' + escapeHtml(article) + '</b> ' : '') + escapeHtml(name) + '</div>' +
      '<div class="sp-tree-item-meta">Производство · ' + escapeHtml(priceText) + '</div>' +
    '</div></div>';
}
function _offerSaleTreeHtml(st) {
  const all = ((cache.saleProducts && cache.saleProducts.products) || []).filter(p => p.is_active);
  const f = st.filter;
  const list = all.filter(p => !f ||
    (p.name || '').toLowerCase().includes(f) ||
    (p.description || '').toLowerCase().includes(f) ||
    (p.nc_code || '').toLowerCase().includes(f));
  if (!list.length) return _offerPickEmpty();
  const catNameById = {};
  ((cache.saleProducts && cache.saleProducts.categories) || []).forEach(c => { catNameById[c.id] = c.name; });
  const auto = !!f;
  const tree = {};
  list.forEach(p => {
    const g = (p.group_name || p.category_name || catNameById[p.category_id] || '(без группы)');
    const sg = (p.subgroup_name || '(без подгруппы)');
    tree[g] = tree[g] || {}; (tree[g][sg] = tree[g][sg] || []).push(p);
  });
  let html = '<div style="padding:4px 0 12px;">';
  Object.keys(tree).sort((a, b) => a.localeCompare(b, 'ru')).forEach(g => {
    const subs = tree[g];
    const subNames = Object.keys(subs).sort((a, b) => a.localeCompare(b, 'ru'));
    const gcount = subNames.reduce((a, x) => a + subs[x].length, 0);
    const gKey = 'osg:' + g;
    const gOpen = auto || !!st.openGroups[gKey];
    let inner = '';
    if (subNames.length === 1 && subNames[0] === '(без подгруппы)') {
      inner = '<div class="sp-tree-items">' + subs['(без подгруппы)'].map(_offerSaleItem).join('') + '</div>';
    } else {
      subNames.forEach(sg => {
        const items = subs[sg], sKey = 'ossg:' + g + '|' + sg;
        inner += _offerSubTpl(sKey, sg, items.length, auto || !!st.openGroups[sKey], items.map(_offerSaleItem).join(''));
      });
    }
    html += _offerGroupTpl(gKey, g, gcount, gOpen, inner);
  });
  return html + '</div>';
}
function _offerProductionTreeHtml(st) {
  const d = cache.models || {};
  const all = (d.models || []).filter(m => m.is_active);
  const f = st.filter;
  const list = all.filter(m => !f ||
    (m.name || '').toLowerCase().includes(f) ||
    (m.article || '').toLowerCase().includes(f) ||
    (m.extra || '').toLowerCase().includes(f));
  if (!list.length) return _offerPickEmpty();
  const auto = !!f;
  const byDir = {};
  list.forEach(m => { const id = m.direction_id || 0; (byDir[id] = byDir[id] || []).push(m); });
  function renderDir(dirId, dirName, models) {
    if (!models.length) return '';
    const dKey = 'opd:' + dirId, dOpen = auto || !!st.openGroups[dKey];
    const bySg = {}, noSg = [];
    models.forEach(m => {
      if (m.subgroup_id) { const s = String(m.subgroup_id); (bySg[s] = bySg[s] || { name: m.subgroup_name || ('Подгруппа #' + s), items: [] }).items.push(m); }
      else noSg.push(m);
    });
    let inner = '';
    if (noSg.length) inner += '<div class="sp-tree-items">' + noSg.map(_offerModelItem).join('') + '</div>';
    Object.keys(bySg).sort((a, b) => (bySg[a].name || '').localeCompare(bySg[b].name || '', 'ru')).forEach(s => {
      const sg = bySg[s], sKey = 'opsg:' + dirId + ':' + s;
      inner += _offerSubTpl(sKey, sg.name, sg.items.length, auto || !!st.openGroups[sKey], sg.items.map(_offerModelItem).join(''));
    });
    return _offerGroupTpl(dKey, dirName, models.length, dOpen, inner);
  }
  let html = '<div style="padding:4px 0 12px;">';
  (d.directions || []).forEach(dir => { html += renderDir(dir.id, dir.name, byDir[dir.id] || []); });
  if ((byDir[0] || []).length) html += renderDir(0, 'Без направления', byDir[0]);
  return html + '</div>';
}
// v2.45.x: характеристики модели → строка для расшифровки позиции КП
function _modelCharsLine(m) {
  if (!m || !m.characteristics) return '';
  let obj;
  try { obj = (typeof m.characteristics === 'string') ? JSON.parse(m.characteristics) : m.characteristics; }
  catch (e) { return ''; }
  if (!obj || !Array.isArray(obj.sections)) return '';
  const parts = [];
  obj.sections.forEach(s => {
    (s.items || []).forEach(it => {
      const k = (it.key || '').trim(), v = (it.value || '').trim();
      if (v) parts.push(k ? (k + ' ' + v) : v);
    });
  });
  return parts.join(' · ');
}

function pickModelForOffer(modelId) {
  const m = ((cache.models && cache.models.models) || []).find(x => x.id === modelId);
  if (!m) return;
  const label = (m.article ? m.article + ' · ' : '') + (m.name || '');
  // v2.45.x: подставляем характеристики модели в расшифровку (видно в КП и PDF)
  const specLine = _modelCharsLine(m);
  state.offerForm.items.push({
    sale_product_id: null,
    name: label,
    description: specLine || m.extra || m.description || '',
    unit: 'шт.',
    qty: 1,
    price: Number(m.base_price) || 0,
    discount_pct: 0,
  });
  closeSaleProductPickModal();
  renderOfferForm();
}

// v2.45.x: характеристики продажной позиции (p.specs — плоский ключ→значение)
// в строку для расшифровки позиции КП
function _saleSpecsLine(p) {
  if (!p || !p.specs || typeof p.specs !== 'object') return '';
  const parts = [];
  Object.keys(p.specs).forEach(k => {
    const v = (p.specs[k] == null ? '' : String(p.specs[k])).trim();
    if (v) parts.push((k || '').trim() ? ((k || '').trim() + ' ' + v) : v);
  });
  return parts.join(' · ');
}

function pickSaleProductForOffer(productId) {
  const p = ((cache.saleProducts && cache.saleProducts.products) || []).find(x => x.id === productId);
  if (!p) return;
  // v2.45.x: характеристики позиции подставляем в расшифровку (видно в КП и PDF)
  const specLine = _saleSpecsLine(p);
  // Добавляем позицию в КП с базовой ценой
  state.offerForm.items.push({
    sale_product_id: p.id,
    name: p.name,
    description: specLine || p.description || '',
    unit: p.unit || 'шт.',
    qty: 1,
    price: Number(p.base_price) || 0,
    discount_pct: 0,
  });
  closeSaleProductPickModal();
  renderOfferForm();
}

function addCustomOfferItem() {
  // Произвольная позиция без привязки к каталогу
  const name = prompt('Название позиции:');
  if (!name || !name.trim()) return;
  state.offerForm.items.push({
    sale_product_id: null,
    name: name.trim(),
    description: '',
    unit: 'шт.',
    qty: 1,
    price: 0,
    discount_pct: 0,
  });
  closeSaleProductPickModal();
  renderOfferForm();
}

// ============================================================================
// v2.45.456: Excel-прайс при составлении КП — открыть и листать «как в Excel»
// (с фото), кликнуть по строке → позиция добавляется в КП с ценой.
// ============================================================================
var _salePriceState = { fid: null, uploadFile: null, sheets: null, added: 0 };

function _salePriceModalEl() {
  var m = document.getElementById('sale-price-viewer-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'sale-price-viewer-modal';
    m.className = 'modal-overlay';
    m.onclick = function (e) { if (e.target === m) closeSalePriceViewer(); };
    document.body.appendChild(m);
  }
  return m;
}

async function openSalePriceViewer() {
  var m = _salePriceModalEl();
  _salePriceState.added = 0;
  m.innerHTML =
    '<div class="modal spv-modal" onclick="event.stopPropagation()">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-file-spreadsheet"></i> Excel-прайс — выбрать позицию в КП</h3>' +
        '<div style="display:flex;gap:4px;align-items:center;">' +
          '<button class="icon-btn" id="spv-full-btn" onclick="toggleSalePriceFullscreen()" title="Во весь экран"><i class="ti ti-arrows-maximize"></i></button>' +
          '<button class="icon-btn" onclick="closeSalePriceViewer()"><i class="ti ti-x"></i></button>' +
        '</div>' +
      '</div>' +
      '<div class="spv-bar">' +
        '<label class="btn btn-secondary spv-upload"><i class="ti ti-upload"></i> Загрузить прайс' +
          '<input type="file" accept=".xlsx,.xlsm,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none" onchange="onSalePriceUpload(this)"></label>' +
        '<div class="spv-files" id="spv-files"></div>' +
      '</div>' +
      '<div class="spv-hint" id="spv-hint">Загрузите Excel-прайс (.xlsx) или выберите ранее загруженный — он откроется таблицей, как в Excel (с фото). Кликните по строке с моделью, чтобы добавить её в КП с ценой.</div>' +
      '<div class="spv-sheettabs" id="spv-sheettabs" style="display:none;"></div>' +
      '<div class="modal-body spv-body" id="spv-body"></div>' +
      '<div class="spv-foot">' +
        '<span id="spv-added" class="spv-added"></span>' +
        '<button class="btn btn-primary" onclick="closeSalePriceViewer()"><i class="ti ti-check"></i> Готово</button>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
  await _salePriceLoadFiles();
}

function closeSalePriceViewer() {
  var m = document.getElementById('sale-price-viewer-modal');
  if (m) m.classList.remove('visible');
  closeSaleProductPickModal();
  if (state.offerForm) renderOfferForm();
}

function toggleSalePriceFullscreen() {
  var mod = document.querySelector('#sale-price-viewer-modal .spv-modal');
  if (!mod) return;
  var full = mod.classList.toggle('spv-full');
  var btn = document.getElementById('spv-full-btn');
  if (btn) btn.innerHTML = '<i class="ti ' + (full ? 'ti-arrows-minimize' : 'ti-arrows-maximize') + '"></i>';
}

async function _salePriceLoadFiles() {
  var box = document.getElementById('spv-files');
  if (!box) return;
  try {
    var r = await apiGet('/api/sale-price-files');
    var files = (r && r.files) || [];
    if (!files.length) { box.innerHTML = '<span class="spv-files-empty">Сохранённых прайсов пока нет</span>'; return; }
    box.innerHTML = files.map(function (f) {
      var lbl = f.label || f.file_name || ('Прайс #' + f.id);
      return '<button class="spv-file-chip' + (_salePriceState.fid === f.id ? ' active' : '') + '" onclick="openSalePriceFileView(' + f.id + ')">' +
        '<i class="ti ti-table"></i><span class="spv-file-name">' + escapeHtml(lbl) + '</span>' +
        '<span class="spv-file-del" onclick="event.stopPropagation();deleteSalePriceFile(' + f.id + ')" title="Удалить"><i class="ti ti-x"></i></span>' +
      '</button>';
    }).join('');
  } catch (e) { box.innerHTML = '<span class="spv-files-empty">Не удалось загрузить список</span>'; }
}

async function onSalePriceUpload(input, sheetName) {
  var file = sheetName ? _salePriceState.uploadFile : (input && input.files && input.files[0]);
  if (!file) return;
  _salePriceState.uploadFile = file;
  var hint = document.getElementById('spv-hint');
  if (hint) hint.innerHTML = '<div class="loading-block" style="margin:0;">Загружаем прайс…</div>';
  var fd = new FormData();
  fd.append('file', file, file.name);
  if (sheetName) fd.append('sheet_name', sheetName);
  try {
    var token = localStorage.getItem(TOKEN_KEY);
    var resp = await fetch(API_BASE + '/api/sale-price-files', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: fd });
    var d = await resp.json().catch(function () { return {}; });
    if (!resp.ok) { showToast(d.message || 'Не удалось загрузить', 'error'); if (hint) hint.textContent = ''; return; }
    if (d.need_sheet && d.sheets && !sheetName) {
      _salePriceState.sheets = d.sheets;
      if (hint) hint.innerHTML = '<div class="spv-sheets"><span>В файле несколько листов — выберите нужный:</span>' +
        d.sheets.map(function (s, i) { return '<button class="spv-sheet-btn" onclick="onSalePriceUploadSheet(' + i + ')">' + escapeHtml(s) + '</button>'; }).join('') +
      '</div>';
      return;
    }
    if (input) input.value = '';
    await _salePriceLoadFiles();
    if (d.price_file_id) openSalePriceFileView(d.price_file_id);
  } catch (e) { showToast('Ошибка соединения', 'error'); if (hint) hint.textContent = ''; }
}

function onSalePriceUploadSheet(idx) {
  var s = (_salePriceState.sheets || [])[idx];
  if (s != null) onSalePriceUpload(null, s);
}

async function openSalePriceFileView(fid, sheet) {
  _salePriceState.fid = fid;
  var body = document.getElementById('spv-body');
  var hint = document.getElementById('spv-hint');
  if (hint) hint.textContent = 'Кликните по строке с моделью — она добавится в КП с ценой. Листы прайса — вкладками ниже.';
  if (body) body.innerHTML = '<div class="loading-block">Открываем прайс…</div>';
  if (!sheet) _salePriceLoadFiles();  // подсветить активный файл (при смене листа не дёргаем)
  try {
    var url = '/api/sale-price-files/' + fid + '/view' + (sheet ? '?sheet=' + encodeURIComponent(sheet) : '');
    var r = await apiGet(url);
    _renderSheetTabs(r.sheets, r.current_sheet);
    if (body) {
      body.innerHTML = '<div class="xls-wrap" onclick="_salePriceRowClick(event)">' + (r.html || '') + '</div>';
      body.scrollTop = 0;
    }
  } catch (e) {
    if (body) body.innerHTML = '<div class="empty-block">Не удалось открыть прайс. Возможно, файл утерян — загрузите заново.</div>';
  }
}

function _renderSheetTabs(sheets, current) {
  var bar = document.getElementById('spv-sheettabs');
  if (!bar) return;
  _salePriceState.curSheets = sheets || [];
  if (!sheets || sheets.length < 2) { bar.innerHTML = ''; bar.style.display = 'none'; return; }
  bar.style.display = '';
  bar.innerHTML = '<span class="spv-sheettabs-lbl"><i class="ti ti-layout-list"></i> Листы:</span>' +
    sheets.map(function (s, i) {
      return '<button class="spv-sheet-tab' + (s === current ? ' active' : '') + '" ' +
        'onclick="openSalePriceFileView(_salePriceState.fid, _salePriceState.curSheets[' + i + '])">' +
        escapeHtml(s) + '</button>';
    }).join('');
}

function _salePriceRowClick(e) {
  var tr = e.target.closest && e.target.closest('tr.xls-pick');
  if (!tr) return;
  var name = tr.getAttribute('data-pick') || '';
  var price = parseFloat(tr.getAttribute('data-price') || '0') || 0;
  if (!name) return;
  addExcelRowToOffer(name, price);
  tr.style.transition = 'background .2s';
  tr.style.background = 'rgba(22,163,74,0.22)';
  setTimeout(function () { tr.style.background = ''; }, 350);
}

function addExcelRowToOffer(name, price) {
  if (!state.offerForm) { showToast('Откройте форму КП', 'error'); return; }
  if (!Array.isArray(state.offerForm.items)) state.offerForm.items = [];
  state.offerForm.items.push({
    sale_product_id: null,
    name: name,
    description: '',
    unit: 'шт.',
    qty: 1,
    price: Number(price) || 0,
    discount_pct: 0,
  });
  _salePriceState.added = (_salePriceState.added || 0) + 1;
  var addedEl = document.getElementById('spv-added');
  if (addedEl) addedEl.textContent = 'Добавлено позиций: ' + _salePriceState.added;
  showToast('В КП: ' + name + (price ? ' — ' + formatMoney(price) : ''), 'success');
}

async function deleteSalePriceFile(fid) {
  if (!confirm('Удалить этот прайс-файл? Сами позиции в КП останутся.')) return;
  try {
    var token = localStorage.getItem(TOKEN_KEY);
    var r = await fetch(API_BASE + '/api/sale-price-files/' + fid, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } });
    if (!r.ok) { showToast('Не удалось удалить', 'error'); return; }
    if (_salePriceState.fid === fid) { _salePriceState.fid = null; var b = document.getElementById('spv-body'); if (b) b.innerHTML = ''; }
    await _salePriceLoadFiles();
  } catch (e) { showToast('Ошибка соединения', 'error'); }
}

// --------- МЕНЮ «ЕЩЁ» ----------

function renderProductionMore() {
  const container = document.getElementById('production-more-content');
  if (!container || !state.user) return;
  const isDirector = (state.user.roles || []).includes('director');

  let html = '';
  // Профиль вверху (как в Аккаунте)
  // FIX v1.8.1-fix1: fallback на state.user.name (см. renderProfile)
  html += '<div class="user-info">' +
    '<div class="big-avatar" id="more-prod-avatar">' + escapeHtml(getInitials(state.user.full_name || state.user.short_name || state.user.name || '')) + '</div>' +
    '<div class="ui-body">' +
      '<div class="ui-name">' + escapeHtml(state.user.full_name || state.user.short_name || state.user.name || '—') + '</div>' +
      '<div class="ui-roles">' + escapeHtml(document.getElementById('top-userrole').textContent || 'без роли') + '</div>' +
    '</div></div>';

  // Плитки разделов
  html += '<div class="more-section-title">СПРАВОЧНИКИ</div>';
  html += '<div class="more-menu-grid">';
  if (isDirector) {
    html += '<div class="more-menu-card" onclick="selectSidebarItem(\'employees\')">' +
      '<div class="mmc-icon"><i class="ti ti-users"></i></div>' +
      '<div class="mmc-title">Сотрудники</div>' +
      '<div class="mmc-desc">Управление командой</div></div>';
  }
  html += '<div class="more-menu-card" onclick="selectSidebarItem(\'models\')">' +
    '<div class="mmc-icon"><i class="ti ti-package"></i></div>' +
    '<div class="mmc-title">Номенклатура</div>' +
    '<div class="mmc-desc">Сборочные позиции</div></div>';
  html += '</div>';

  // Выход
  html += '<div class="more-section-title">ПРОФИЛЬ</div>';
  html += '<div class="more-menu-grid">';
  html += '<div class="more-menu-card danger" onclick="logout()">' +
    '<div class="mmc-icon"><i class="ti ti-logout"></i></div>' +
    '<div class="mmc-title">Выйти</div>' +
    '<div class="mmc-desc">Закрыть сессию</div></div>';
  html += '</div>';

  // Версия
  html += '<div class="version-block">' +
    '<div class="version-ball"></div>' +
    '<div class="version-text">' +
      '<div class="version-line"><b>Atomus group</b></div>' +
      '<div class="version-line">' + APP_VERSION + ' · ' + APP_VERSION_DATE + '</div>' +
    '</div></div>';

  container.innerHTML = html;
}

function renderSalesMore() {
  const container = document.getElementById('sales-more-content');
  if (!container || !state.user) return;
  const isDirector = (state.user.roles || []).includes('director');

  let html = '';
  // FIX v1.8.1-fix1: fallback на state.user.name (см. renderProfile)
  html += '<div class="user-info">' +
    '<div class="big-avatar">' + escapeHtml(getInitials(state.user.full_name || state.user.short_name || state.user.name || '')) + '</div>' +
    '<div class="ui-body">' +
      '<div class="ui-name">' + escapeHtml(state.user.full_name || state.user.short_name || state.user.name || '—') + '</div>' +
      '<div class="ui-roles">' + escapeHtml(document.getElementById('top-userrole').textContent || 'без роли') + '</div>' +
    '</div></div>';

  html += '<div class="more-section-title">СПРАВОЧНИКИ</div>';
  html += '<div class="more-menu-grid">';
  html += '<div class="more-menu-card" onclick="selectSidebarItem(\'sales-contractors\')">' +
    '<div class="mmc-icon"><i class="ti ti-briefcase"></i></div>' +
    '<div class="mmc-title">Контрагенты</div>' +
    '<div class="mmc-desc">База клиентов</div></div>';
  html += '<div class="more-menu-card" onclick="selectSidebarItem(\'sale-products\')">' +
    '<div class="mmc-icon"><i class="ti ti-shopping-cart"></i></div>' +
    '<div class="mmc-title">Продажная номенклатура</div>' +
    '<div class="mmc-desc">Каталог для КП</div></div>';
  if (isDirector) {
    html += '<div class="more-menu-card" onclick="selectSidebarItem(\'employees\')">' +
      '<div class="mmc-icon"><i class="ti ti-users"></i></div>' +
      '<div class="mmc-title">Сотрудники</div>' +
      '<div class="mmc-desc">Управление командой</div></div>';
  }
  html += '</div>';

  html += '<div class="more-section-title">ПРОФИЛЬ</div>';
  html += '<div class="more-menu-grid">';
  html += '<div class="more-menu-card danger" onclick="logout()">' +
    '<div class="mmc-icon"><i class="ti ti-logout"></i></div>' +
    '<div class="mmc-title">Выйти</div>' +
    '<div class="mmc-desc">Закрыть сессию</div></div>';
  html += '</div>';

  html += '<div class="version-block">' +
    '<div class="version-ball"></div>' +
    '<div class="version-text">' +
      '<div class="version-line"><b>Atomus group</b></div>' +
      '<div class="version-line">' + APP_VERSION + ' · ' + APP_VERSION_DATE + '</div>' +
    '</div></div>';

  container.innerHTML = html;
}

// --------- ОБРАБОТЧИКИ ----------

document.addEventListener('DOMContentLoaded', () => {
  // Фильтры КП
  document.querySelectorAll('#so-filters .filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      state.offersFilter = chip.dataset.sof;
      renderOffersList();
    });
  });
  const soSearch = document.getElementById('so-search-input');
  if (soSearch) {
    soSearch.addEventListener('input', e => {
      state.offersSearch = e.target.value;
      renderOffersList();
    });
  }

  // Модалка выбора продажной позиции — поиск и клик-вне-закрывает
  const spp = document.getElementById('sp-pick-search');
  if (spp) spp.addEventListener('input', e => loadSaleProductsForPickModal(e.target.value));
  const sppm = document.getElementById('sale-product-pick-modal');
  if (sppm) sppm.addEventListener('click', e => { if (e.target === sppm) closeSaleProductPickModal(); });
});

// Хелпер для форматирования чисел (например количества)
function formatNumberShort(n) {
  if (n === null || n === undefined) return '0';
  const v = Number(n);
  if (!isFinite(v)) return '0';
  if (v % 1 === 0) return String(v);
  return v.toFixed(2).replace(/\.?0+$/, '');
}

