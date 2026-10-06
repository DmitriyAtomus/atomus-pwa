/* v2.46.240: Продажи → «Презентации».
   Список продажных презентаций (по отраслям), загрузка частями прямо в R2 через
   API, «Открыть / Скачать / Скопировать ссылку для клиента», правка и удаление.
   Части файла идут напрямую на api.atomuscrm.ru: у прокси Vercel лимит тела
   4,5 МБ. Каждая часть — отдельный запрос с процентами, таймаутом и повтором,
   поэтому обрыв связи не молчит и не начинает загрузку заново. */
var _pres = { items: [], categories: [], used: [], canUpload: false, maxSize: 100 * 1048576,
  allowed: [], cat: '', q: '', file: null, uploading: null, editId: null, loadedOnce: false, loading: false, loadedAt: 0 };
var PRES_PART_TIMEOUT_MS = 120000;
var PRES_PART_RETRIES = 3;

function _presE(v) { return escapeHtml(String(v == null ? '' : v)); }
function _presMB(n) {
  n = Number(n) || 0;
  if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' КБ';
  return (n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0).replace('.', ',') + ' МБ';
}
function _presDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(String(iso).replace(' ', 'T') + 'Z');
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch (_) { return ''; }
}
function _presIcon(ext) {
  if (ext === 'pdf') return 'ti-file-type-pdf';
  if (ext === 'pptx' || ext === 'ppt' || ext === 'key') return 'ti-presentation';
  if (ext === 'docx') return 'ti-file-type-docx';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'].indexOf(ext) >= 0) return 'ti-photo';
  return 'ti-file';
}
function _presDirect() {
  return (typeof API_DIRECT_FALLBACK === 'string' && API_DIRECT_FALLBACK) || API_BASE;
}
function _presErr(d, status) {
  return (d && (d.message || d.error)) || ('HTTP ' + status);
}

// v2.46.242: список всегда свежий. Перечитываем при каждом входе в раздел, после
// любого изменения, по кнопке «Обновить», при возврате во вкладку и раз в минуту,
// пока раздел открыт. «?_=время» — чтобы ни один кэш (в т.ч. старый service
// worker) не подсунул прошлый ответ, где удалённая презентация ещё есть.
function _presVisible() {
  const box = document.getElementById('pres-body');
  return !!(box && box.offsetParent !== null && document.visibilityState === 'visible');
}
function _presAutoRefresh() {
  if (_presVisible() && !_pres.loading && Date.now() - (_pres.loadedAt || 0) > 5000) loadPresentations();
}
document.addEventListener('visibilitychange', _presAutoRefresh);
window.addEventListener('focus', _presAutoRefresh);
setInterval(function () { if (_presVisible() && Date.now() - (_pres.loadedAt || 0) > 55000) _presAutoRefresh(); }, 60000);

async function loadPresentations(manual) {
  const box = document.getElementById('pres-body');
  if (!box) return;
  if (!_pres.loadedOnce) box.innerHTML = '<div class="loading-block">Загружаем…</div>';
  const rb = document.getElementById('pres-refresh-btn');
  if (rb) rb.classList.add('is-loading');
  _pres.loading = true;
  try {
    const d = await apiGet('/api/presentations?_=' + Date.now());
    _pres.loadedAt = Date.now();
    _pres.items = d.items || [];
    _pres.categories = d.categories || [];
    _pres.used = d.used_categories || [];
    _pres.canUpload = !!d.can_upload;
    _pres.maxSize = d.max_size || _pres.maxSize;
    _pres.allowed = d.allowed_ext || [];
    _pres.loadedOnce = true;
    if (_pres.cat && _pres.used.indexOf(_pres.cat) < 0) _pres.cat = '';
    const up = document.getElementById('pres-upload-btn');
    if (up) up.style.display = _pres.canUpload ? '' : 'none';
    renderPresentations();
    if (manual) showToast('Список обновлён', 'success');
  } catch (e) {
    if (manual && _pres.loadedOnce) { showToast('Не удалось обновить: ' + _presE(e.serverMessage || e.message || e), 'error'); return; }
    box.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Не удалось загрузить презентации: ' +
      _presE(e.message || e) + '<br><button class="btn btn-secondary" style="margin-top:12px" onclick="loadPresentations(true)">Повторить</button></div>';
  } finally {
    _pres.loading = false;
    if (rb) rb.classList.remove('is-loading');
  }
}

// Презентацию уже удалили (на сервере 404) — убираем из списка и говорим об этом.
function _presGone(id) {
  _pres.items = _pres.items.filter(function (x) { return x.id !== id; });
  renderPresentations();
  showToast('Презентация удалена', 'error');
  loadPresentations();
}

function presSetCat(c) { _pres.cat = c; renderPresentations(); }
function presSearch(v) {
  clearTimeout(_pres.searchTimer);
  _pres.searchTimer = setTimeout(function () { _pres.q = String(v || '').trim().toLowerCase(); renderPresentations(true); }, 150);
}

function _presFiltered() {
  const q = _pres.q;
  return _pres.items.filter(function (it) {
    if (_pres.cat && (it.category || '') !== _pres.cat) return false;
    if (!q) return true;
    return (it.title + ' ' + it.description + ' ' + it.file_name + ' ' + it.category).toLowerCase().indexOf(q) >= 0;
  });
}

function _presCard(it) {
  const meta = [it.ext ? it.ext.toUpperCase() : '', _presMB(it.size), it.uploader_name, _presDate(it.created_at)].filter(Boolean);
  let acts = '';
  if (it.inline) acts += '<button class="btn btn-primary btn-sm" onclick="presOpen(' + it.id + ', false)"><i class="ti ti-external-link"></i> Открыть</button>';
  acts += '<button class="btn btn-secondary btn-sm" onclick="presOpen(' + it.id + ', true)"><i class="ti ti-download"></i> Скачать</button>';
  acts += '<button class="btn btn-secondary btn-sm" onclick="presCopyLink(' + it.id + ')" title="Ссылка, которую можно отправить клиенту"><i class="ti ti-link"></i> Ссылка</button>';
  let tools = '';
  if (it.can_edit) tools += '<button class="icon-btn" title="Изменить" onclick="presEdit(' + it.id + ')"><i class="ti ti-pencil"></i></button>';
  if (it.can_delete) tools += '<button class="icon-btn pres-del" title="Удалить" onclick="presDelete(' + it.id + ')"><i class="ti ti-trash"></i></button>';
  return '<div class="pres-card" data-id="' + it.id + '">' +
    '<div class="pres-card-top">' +
      '<div class="pres-ic ext-' + _presE(it.ext) + '"><i class="ti ' + _presIcon(it.ext) + '"></i></div>' +
      '<div class="pres-card-main">' +
        '<div class="pres-title">' + _presE(it.title) + '</div>' +
        (it.category ? '<span class="pres-chip">' + _presE(it.category) + '</span>' : '') +
      '</div>' +
      (tools ? '<div class="pres-tools">' + tools + '</div>' : '') +
    '</div>' +
    (it.description ? '<div class="pres-desc">' + _presE(it.description).replace(/\n/g, '<br>') + '</div>' : '') +
    '<div class="pres-meta" title="' + _presE(it.file_name) + '">' + _presE(meta.join(' · ')) + '</div>' +
    '<div class="pres-actions">' + acts + '</div>' +
  '</div>';
}

function renderPresentations(onlyList) {
  const box = document.getElementById('pres-body');
  if (!box) return;
  const list = _presFiltered();
  let listHtml = '';
  if (!_pres.items.length) {
    listHtml = '<div class="empty-block"><i class="ti ti-presentation"></i>Презентаций пока нет.' +
      (_pres.canUpload ? '<br><button class="btn btn-primary" style="margin-top:12px" onclick="presOpenUpload()"><i class="ti ti-upload"></i> Загрузить первую</button>' : '') + '</div>';
  } else if (!list.length) {
    listHtml = '<div class="empty-block"><i class="ti ti-search"></i>Ничего не найдено</div>';
  } else if (_pres.cat || _pres.q) {
    listHtml = '<div class="pres-grid">' + list.map(_presCard).join('') + '</div>';
  } else {
    // «Все»: группами по отрасли
    const groups = {}; const order = [];
    list.forEach(function (it) {
      const c = it.category || 'Без категории';
      if (!groups[c]) { groups[c] = []; order.push(c); }
      groups[c].push(it);
    });
    order.forEach(function (c) {
      listHtml += '<div class="pres-group-title">' + _presE(c) + ' <span>' + groups[c].length + '</span></div>' +
        '<div class="pres-grid">' + groups[c].map(_presCard).join('') + '</div>';
    });
  }
  if (onlyList) {
    const l = document.getElementById('pres-list');
    if (l) { l.innerHTML = listHtml; return; }
  }
  const counts = {};
  _pres.items.forEach(function (it) { counts[it.category || ''] = (counts[it.category || ''] || 0) + 1; });
  let chips = '<button class="filter-chip' + (!_pres.cat ? ' active' : '') + '" onclick="presSetCat(\'\')">Все <span class="chip-count">' + _pres.items.length + '</span></button>';
  _pres.used.forEach(function (c) {
    chips += '<button class="filter-chip' + (_pres.cat === c ? ' active' : '') + '" onclick="presSetCat(' + _presE(JSON.stringify(c)) + ')">' +
      _presE(c) + ' <span class="chip-count">' + (counts[c] || 0) + '</span></button>';
  });
  box.innerHTML =
    '<div class="pres-toolbar">' +
      '<div class="pres-search"><i class="ti ti-search"></i><input id="pres-q" type="search" placeholder="Поиск по названию…" value="' + _presE(_pres.q) + '" oninput="presSearch(this.value)"></div>' +
      '<div class="pres-chips">' + chips + '</div>' +
    '</div>' +
    '<div id="pres-list">' + listHtml + '</div>';
}

function _presById(id) { return _pres.items.find(function (x) { return x.id === id; }); }

async function presOpen(id, download) {
  // Окно открываем сразу (в обработчике клика), иначе браузер заблокирует всплывающее
  const w = download ? null : window.open('about:blank', '_blank');
  try {
    const d = await apiGet('/api/presentations/' + id + '/link?' + (download ? 'download=1&' : '') + '_=' + Date.now());
    if (!d.url) throw new Error('сервер не вернул ссылку');
    if (w) { w.location.href = d.url; return; }
    const a = document.createElement('a');
    a.href = d.url; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    showToast('Скачивание началось', 'success');
  } catch (e) {
    if (w) try { w.close(); } catch (_) {}
    if (e && e.status === 404) { _presGone(id); return; }
    showToast('Не удалось открыть файл: ' + (e.serverMessage || e.message || e), 'error');
  }
}

async function presCopyLink(id) {
  const it = _presById(id);
  if (!it) return;
  const url = it.share_url;
  // v2.46.242: не раздаём клиентам ссылку на уже удалённую презентацию
  try {
    await apiGet('/api/presentations/' + id + '/link?_=' + Date.now());
  } catch (e) {
    if (e && e.status === 404) { _presGone(id); return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast('Ссылка скопирована — её можно отправить клиенту', 'success');
  } catch (_) {
    window.prompt('Скопируйте ссылку для клиента:', url);
  }
}

async function presDelete(id) {
  const it = _presById(id);
  if (!it) return;
  if (!confirm('Удалить презентацию «' + it.title + '»?\nСсылки, отправленные клиентам, перестанут открываться.')) return;
  try {
    await apiDelete('/api/presentations/' + id);
    _pres.items = _pres.items.filter(function (x) { return x.id !== id; });
    renderPresentations();
    showToast('Презентация удалена', 'success');
    loadPresentations();
  } catch (e) {
    showToast('Не удалось удалить: ' + (e.message || e), 'error');
  }
}

// ---------- модалка загрузки / правки ----------

function _presCatOptions() {
  const dl = document.getElementById('pres-cat-list');
  if (dl) dl.innerHTML = _pres.categories.map(function (c) { return '<option value="' + _presE(c) + '">'; }).join('');
}
function _presModal(show) {
  const m = document.getElementById('pres-modal');
  if (m) m.classList.toggle('visible', !!show);
}
function _presFormErr(msg) {
  const el = document.getElementById('pres-f-error');
  if (el) el.innerHTML = msg ? '<div class="sales-error">' + _presE(msg) + '</div>' : '';
}
function _presProgress(pct, text) {
  const wrap = document.getElementById('pres-progress');
  if (!wrap) return;
  wrap.hidden = pct === null;
  if (pct === null) return;
  wrap.querySelector('.pres-bar i').style.width = Math.max(0, Math.min(100, pct)) + '%';
  wrap.querySelector('.pres-progress-text').textContent = text || '';
}

function presOpenUpload() {
  if (!_pres.canUpload) { showToast('Загружать презентации может отдел продаж и директор', 'error'); return; }
  _pres.editId = null; _pres.file = null;
  document.getElementById('pres-m-title').textContent = 'Новая презентация';
  document.getElementById('pres-f-title').value = '';
  document.getElementById('pres-f-cat').value = _pres.cat || '';
  document.getElementById('pres-f-desc').value = '';
  document.getElementById('pres-f-file-row').hidden = false;
  document.getElementById('pres-f-file').value = '';
  document.getElementById('pres-f-file-info').textContent = 'PDF, PPTX, PPT, KEY, DOCX или картинка, до ' + Math.round(_pres.maxSize / 1048576) + ' МБ';
  document.getElementById('pres-f-submit').innerHTML = '<i class="ti ti-upload"></i> Загрузить';
  document.getElementById('pres-f-submit').disabled = false;
  _presCatOptions(); _presFormErr(''); _presProgress(null);
  _presModal(true);
}

function presEdit(id) {
  const it = _presById(id);
  if (!it) return;
  _pres.editId = id; _pres.file = null;
  document.getElementById('pres-m-title').textContent = 'Изменить презентацию';
  document.getElementById('pres-f-title').value = it.title;
  document.getElementById('pres-f-cat').value = it.category || '';
  document.getElementById('pres-f-desc').value = it.description || '';
  document.getElementById('pres-f-file-row').hidden = true;
  document.getElementById('pres-f-submit').innerHTML = '<i class="ti ti-check"></i> Сохранить';
  document.getElementById('pres-f-submit').disabled = false;
  _presCatOptions(); _presFormErr(''); _presProgress(null);
  _presModal(true);
}

function presCloseModal() {
  if (_pres.uploading) {
    if (!confirm('Загрузка ещё идёт. Прервать её?')) return;
    presCancelUpload();
  }
  _presModal(false);
}

function presFileChosen(input) {
  const f = input.files && input.files[0];
  _pres.file = null;
  _presFormErr('');
  const info = document.getElementById('pres-f-file-info');
  if (!f) { info.textContent = ''; return; }
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  if (_pres.allowed.length && _pres.allowed.indexOf(ext) < 0) {
    _presFormErr('Формат «.' + ext + '» не подходит. Можно PDF, PPTX, PPT, KEY, DOCX и картинки.');
    info.textContent = f.name; return;
  }
  if (f.size > _pres.maxSize) {
    _presFormErr('«' + f.name + '» — ' + _presMB(f.size) + ', а предел ' + Math.round(_pres.maxSize / 1048576) + ' МБ. Сожмите PDF или разделите презентацию.');
    info.textContent = f.name; return;
  }
  if (!f.size) { _presFormErr('Файл пустой'); return; }
  _pres.file = f;
  info.textContent = f.name + ' · ' + _presMB(f.size);
  const t = document.getElementById('pres-f-title');
  if (!t.value.trim()) t.value = f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
}

function _presXhrPart(url, blob, token, onProgress) {
  return new Promise(function (resolve, reject) {
    const x = new XMLHttpRequest();
    _pres.uploading.xhr = x;
    x.open('PUT', url);
    x.setRequestHeader('Authorization', 'Bearer ' + token);
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.timeout = PRES_PART_TIMEOUT_MS;
    x.upload.onprogress = function (ev) { if (ev.lengthComputable) onProgress(ev.loaded); };
    x.onload = function () {
      let d = {};
      try { d = JSON.parse(x.responseText || '{}'); } catch (_) {}
      if (x.status >= 200 && x.status < 300) resolve(d);
      else { const e = new Error(_presErr(d, x.status)); e.status = x.status; reject(e); }
    };
    x.onerror = function () { reject(new Error('нет связи с сервером')); };
    x.ontimeout = function () { reject(new Error('сервер не ответил за ' + Math.round(PRES_PART_TIMEOUT_MS / 1000) + ' с')); };
    x.onabort = function () { const e = new Error('отменено'); e.aborted = true; reject(e); };
    x.send(blob);
  });
}

async function _presJson(method, path, body) {
  const token = localStorage.getItem(TOKEN_KEY);
  const r = await fetch(_presDirect() + path, {
    method: method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error(_presErr(d, r.status));
  return d;
}

function presCancelUpload() {
  const up = _pres.uploading;
  if (!up) return;
  up.cancelled = true;
  try { up.xhr && up.xhr.abort(); } catch (_) {}
  if (up.id) _presJson('DELETE', '/api/presentations/uploads/' + encodeURIComponent(up.id)).catch(function () {});
}

async function presSubmit() {
  const btn = document.getElementById('pres-f-submit');
  if (btn.disabled) return;
  const title = document.getElementById('pres-f-title').value.trim();
  const category = document.getElementById('pres-f-cat').value.trim();
  const description = document.getElementById('pres-f-desc').value.trim();
  _presFormErr('');
  if (!title) { _presFormErr('Укажите название'); return; }

  if (_pres.editId) {
    btn.disabled = true;
    try {
      await apiPatch('/api/presentations/' + _pres.editId, { title: title, category: category, description: description });
      showToast('Сохранено', 'success');
      _presModal(false);
      loadPresentations();
    } catch (e) {
      _presFormErr('Не удалось сохранить: ' + (e.message || e));
    } finally { btn.disabled = false; }
    return;
  }

  const f = _pres.file;
  if (!f) { _presFormErr('Выберите файл презентации'); return; }
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> Загружаем…';
  const token = localStorage.getItem(TOKEN_KEY);
  const up = _pres.uploading = { id: null, xhr: null, cancelled: false };
  const t0 = Date.now();
  try {
    _presProgress(0, 'Готовим загрузку…');
    const init = await _presJson('POST', '/api/presentations/uploads',
      { file_name: f.name, size: f.size, content_type: f.type || '' });
    up.id = init.upload_id;
    const cs = init.chunk_size, parts = init.parts;
    let done = 0;
    for (let n = 1; n <= parts; n++) {
      const blob = f.slice((n - 1) * cs, Math.min(n * cs, f.size));
      for (let attempt = 1; ; attempt++) {
        if (up.cancelled) throw Object.assign(new Error('отменено'), { aborted: true });
        try {
          await _presXhrPart(_presDirect() + '/api/presentations/uploads/' + encodeURIComponent(up.id) + '/' + n,
            blob, token, function (loaded) {
              const sent = done + loaded;
              const sec = (Date.now() - t0) / 1000;
              _presProgress(sent / f.size * 100, _presMB(sent) + ' из ' + _presMB(f.size) +
                (sec > 2 ? ' · ' + _presMB(sent / sec) + '/с' : ''));
            });
          break;
        } catch (e) {
          if (e.aborted || up.cancelled) throw e;
          if (e.status && e.status < 500 && e.status !== 408 && e.status !== 429) throw e;
          if (attempt >= PRES_PART_RETRIES) throw new Error('часть ' + n + ' из ' + parts + ' не загрузилась: ' + e.message);
          _presProgress(done / f.size * 100, 'Связь прервалась — повтор ' + attempt + ' из ' + (PRES_PART_RETRIES - 1) + '…');
          await new Promise(function (r) { setTimeout(r, 1500 * attempt); });
        }
      }
      done += blob.size;
    }
    _presProgress(100, 'Сохраняем…');
    const item = await _presJson('POST', '/api/presentations/uploads/' + encodeURIComponent(up.id) + '/complete',
      { title: title, category: category, description: description });
    _pres.uploading = null;
    showToast('Презентация «' + item.title + '» загружена', 'success');
    _presModal(false);
    loadPresentations();
  } catch (e) {
    const cancelled = e.aborted || up.cancelled;
    _pres.uploading = null;
    if (!cancelled && up.id) _presJson('DELETE', '/api/presentations/uploads/' + encodeURIComponent(up.id)).catch(function () {});
    _presProgress(null);
    if (cancelled) showToast('Загрузка отменена', 'info');
    else _presFormErr('Не удалось загрузить: ' + (e.message || e));
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-upload"></i> Загрузить';
  }
}
