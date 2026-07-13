// ====== Ручная инвентаризация (без фото/AI) ===============================
// Автосохранение черновика в localStorage: ключ ниже, сохраняем при каждом
// изменении (debounce 500мс) — если вкладку закроют/перезагрузят, на главной
// инвентаризации увидим баннер «восстановить черновик».
const INV_MANUAL_DRAFT_KEY = 'atomus:inv-manual-draft-v1';
const INV_MANUAL_DIRTY_KEY = 'inv-manual-entry';
let _invManualSaveTimer = null;

function _invSaveManualDraftSoon() {
  if (_invManualSaveTimer) clearTimeout(_invManualSaveTimer);
  _invManualSaveTimer = setTimeout(() => {
    _invSaveManualDraftNow();
  }, 500);
}

function _invSaveManualDraftNow() {
  if (!_invState._manual) return;
  const m = _invState._manual;
  // Сохраняем только если есть хоть одно заполненное поле
  if (!m.values || !Object.keys(m.values).length) {
    try { localStorage.removeItem(INV_MANUAL_DRAFT_KEY); } catch (_) {}
    markFormClean(INV_MANUAL_DIRTY_KEY);
    return;
  }
  try {
    localStorage.setItem(INV_MANUAL_DRAFT_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      filters: m.filters || null,
      values: m.values,
    }));
    markFormDirty(INV_MANUAL_DIRTY_KEY);
  } catch (e) {
    console.warn('Не удалось сохранить черновик инвентаризации', e);
  }
}

function _invLoadManualDraft() {
  try {
    const raw = localStorage.getItem(INV_MANUAL_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function _invClearManualDraft() {
  try { localStorage.removeItem(INV_MANUAL_DRAFT_KEY); } catch (_) {}
  markFormClean(INV_MANUAL_DIRTY_KEY);
}

function _invDiscardManualDraft() {
  if (!confirm('Удалить черновик безвозвратно?')) return;
  _invClearManualDraft();
  _invRenderHome();
}

async function _invRestoreManualDraft() {
  const draft = _invLoadManualDraft();
  if (!draft) return;
  const filters = draft.filters || { category_ids: [], only_with_stock: false };
  const body = document.getElementById('inventory-screen-body');
  if (!body) return;
  body.innerHTML = '<div class="loading-block">Загружаем номенклатуру для черновика…</div>';

  const params = new URLSearchParams();
  if (filters.category_ids && filters.category_ids.length) params.set('category_ids', filters.category_ids.join(','));
  if (filters.only_with_stock) params.set('only_with_stock', '1');
  const url = API_BASE + '/api/inventory/components-list' + (params.toString() ? ('?' + params.toString()) : '');

  let items = [];
  try {
    const res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    if (!res.ok) throw new Error('http ' + res.status);
    const j = await res.json();
    items = j.items || [];
  } catch (e) {
    showToast('Не удалось восстановить черновик: список номенклатуры недоступен', 'error');
    return;
  }

  // Подчищаем values: если компонент удалили из базы — игнорим
  const knownIds = new Set(items.map(it => it.id));
  const cleanValues = {};
  Object.keys(draft.values || {}).forEach(k => {
    const id = parseInt(k, 10);
    if (knownIds.has(id)) cleanValues[id] = draft.values[k];
  });

  _invState._manual = {
    items,
    values: cleanValues,
    search: '',
    filters,
  };
  markFormDirty(INV_MANUAL_DIRTY_KEY);
  _invRenderManualEntry();
}

function _invPickFiltersFromModalAndClose() {
  const selected = [];
  document.querySelectorAll('#inv-cat-list input[type="checkbox"]:checked').forEach(cb => {
    selected.push(parseInt(cb.dataset.cid, 10));
  });
  const onlyStock = !!document.getElementById('inv-only-with-stock')?.checked;
  const m = document.getElementById('inv-blank-picker');
  if (m) m.remove();
  return { category_ids: selected, only_with_stock: onlyStock };
}

async function openInventoryManualEntry() {
  const filters = _invPickFiltersFromModalAndClose();
  const body = document.getElementById('inventory-screen-body');
  if (!body) return;
  body.innerHTML = '<div class="loading-block">Загружаем номенклатуру…</div>';

  const params = new URLSearchParams();
  if (filters.category_ids.length) params.set('category_ids', filters.category_ids.join(','));
  if (filters.only_with_stock) params.set('only_with_stock', '1');
  const url = API_BASE + '/api/inventory/components-list' + (params.toString() ? ('?' + params.toString()) : '');

  let items = [];
  try {
    const res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    if (!res.ok) throw new Error('http ' + res.status);
    const j = await res.json();
    items = j.items || [];
  } catch (e) {
    body.innerHTML = '<div class="pkb-form-error" style="margin:12px 0;"><i class="ti ti-alert-triangle"></i>Не удалось загрузить номенклатуру</div>';
    return;
  }

  _invState._manual = { items, values: {}, search: '', filters };
  _invRenderManualEntry();
}

function _invBuildManualTableHTML() {
  const m = _invState._manual;
  if (!m) return '';
  const all = m.items || [];
  const search = (m.search || '').trim().toLowerCase();
  const filtered = !search ? all : all.filter(c =>
    ((c.sku || '').toLowerCase().includes(search) ||
     (c.name || '').toLowerCase().includes(search))
  );
  if (!filtered.length) {
    return '<div style="color:var(--text-light);padding:24px;text-align:center;border:1px dashed var(--border);border-radius:10px;">Ничего не найдено</div>';
  }
  let html = '<div class="inv-diff-table">' +
    '<div class="inv-diff-row head">' +
      '<div></div>' +
      '<div></div>' +
      '<div>Позиция</div>' +
      '<div style="text-align:right;">По системе</div>' +
      '<div style="text-align:right;">Факт</div>' +
      '<div style="text-align:right;">Δ</div>' +
    '</div>';
  filtered.forEach((c) => {
    const v = m.values[c.id];
    const valStr = (v === undefined || v === null) ? '' : String(v);
    const delta = (v !== undefined && v !== null) ? (v - (c.qty_on_stock || 0)) : null;
    const deltaCls = delta == null ? '' : (delta > 0 ? 'up' : (delta < 0 ? 'down' : ''));
    const deltaStr = delta == null ? '—' : (delta > 0 ? '+' : '') + _formatNum(delta);
    const unit = c.unit || 'шт.';
    html += '<div class="inv-diff-row">' +
      '<div></div>' +
      '<div></div>' +
      '<div>' +
        '<div style="font-size:13px;color:var(--text-dark);">' + escapeHtml(c.name || '—') + '</div>' +
        '<div style="font-size:11.5px;color:var(--text-light);">' +
          'Артикул: ' + escapeHtml(c.sku || '—') +
          ' · ' + escapeHtml(c.category_name || '—') +
        '</div>' +
      '</div>' +
      '<div style="text-align:right;font-variant-numeric:tabular-nums;">' +
        _formatNum(c.qty_on_stock) + ' ' + escapeHtml(unit) +
      '</div>' +
      '<div class="inv-d-num" style="text-align:right;">' +
        '<input type="number" step="any" min="0" inputmode="decimal" ' +
          'data-cid="' + c.id + '" ' +
          'value="' + valStr + '" placeholder="—" ' +
          'oninput="_invManualSetValue(' + c.id + ', this.value)">' +
      '</div>' +
      '<div class="inv-d-delta ' + deltaCls + '" data-delta-cid="' + c.id + '">' +
        escapeHtml(deltaStr) +
      '</div>' +
    '</div>';
  });
  html += '</div>';
  return html;
}

function _invRenderManualEntry() {
  const body = document.getElementById('inventory-screen-body');
  if (!body || !_invState._manual) return;
  const m = _invState._manual;
  const all = m.items || [];
  const filledCount = Object.keys(m.values).length;

  let html = '';
  html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap;">' +
    '<button class="btn btn-secondary" onclick="_invCancelManualEntry()"><i class="ti ti-arrow-left"></i> Назад</button>' +
    '<h2 style="margin:0;font-size:18px;">Заполнить инвентаризацию</h2>' +
  '</div>';

  html += '<div style="color:var(--text-light);font-size:13px;margin-bottom:12px;">' +
    'Введи фактические количества в столбце «Факт». Пустые поля пропускаются. ' +
    '<b>' + all.length + '</b> позиций в бланке.' +
  '</div>';

  // Инпут поиска вынесен из перерендера: он живёт всё время, на нём не теряется
  // фокус. _invManualSearch обновляет только содержимое #inv-manual-table-wrap.
  html += '<input type="search" id="inv-manual-search" class="form-input" placeholder="Поиск по артикулу или названию…" ' +
    'oninput="_invManualSearch(this.value)" ' +
    'value="' + escapeHtml(m.search || '') + '" ' +
    'style="margin-bottom:12px;max-width:420px;">';

  html += '<div id="inv-manual-table-wrap">' + _invBuildManualTableHTML() + '</div>';

  // Sticky action bar
  html += '<div class="inv-summary-bar" style="position:sticky;bottom:0;z-index:2;flex-wrap:wrap;">' +
    '<span>Заполнено: <span class="inv-sum-num" id="inv-manual-filled">' + filledCount + '</span> из ' + all.length + '</span>' +
    '<div style="flex:1;"></div>' +
    '<button class="btn btn-secondary" onclick="_invCancelManualEntry()">Отмена</button>' +
    '<button class="btn btn-primary" id="inv-manual-submit-btn" ' +
      (filledCount === 0 ? 'disabled' : '') +
      ' onclick="submitManualInventory()">' +
      '<i class="ti ti-check"></i> Сохранить и применить (<span id="inv-manual-submit-count">' + filledCount + '</span>)' +
    '</button>' +
  '</div>';

  body.innerHTML = html;
}

function _invRefreshManualTable() {
  const wrap = document.getElementById('inv-manual-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = _invBuildManualTableHTML();
}

function _invManualSearch(v) {
  if (!_invState._manual) return;
  _invState._manual.search = v;
  // Обновляем ТОЛЬКО таблицу — инпут поиска и его фокус остаются на месте.
  _invRefreshManualTable();
}

function _invManualSetValue(componentId, value) {
  if (!_invState._manual) return;
  const m = _invState._manual;
  const cleaned = (value === '' || value == null) ? null : parseFloat(String(value).replace(',', '.'));
  if (cleaned === null || isNaN(cleaned) || cleaned < 0) {
    delete m.values[componentId];
  } else {
    m.values[componentId] = cleaned;
  }
  // Автосохранение в localStorage + отметка «есть несохранённое» (для beforeunload)
  _invSaveManualDraftSoon();
  // Селективно обновляем счётчик + ячейку «Δ» — без перерендера, чтобы не сбить фокус.
  const filledCount = Object.keys(m.values).length;
  const filledLbl = document.getElementById('inv-manual-filled');
  if (filledLbl) filledLbl.textContent = filledCount;
  const submitBtn = document.getElementById('inv-manual-submit-btn');
  const submitCnt = document.getElementById('inv-manual-submit-count');
  if (submitBtn) submitBtn.disabled = (filledCount === 0);
  if (submitCnt) submitCnt.textContent = filledCount;
  // Δ-ячейка для этой строки
  const c = m.items.find(it => it.id === componentId);
  const deltaCell = document.querySelector('[data-delta-cid="' + componentId + '"]');
  if (c && deltaCell) {
    const newQty = m.values[componentId];
    const delta = (newQty === undefined || newQty === null) ? null : (newQty - (c.qty_on_stock || 0));
    deltaCell.classList.remove('up', 'down');
    if (delta == null) {
      deltaCell.textContent = '—';
    } else {
      if (delta > 0) deltaCell.classList.add('up');
      else if (delta < 0) deltaCell.classList.add('down');
      deltaCell.textContent = (delta > 0 ? '+' : '') + _formatNum(delta);
    }
  }
}

function _invCancelManualEntry() {
  const filledCount = _invState._manual ? Object.keys(_invState._manual.values).length : 0;
  if (filledCount > 0) {
    const choice = confirm(
      'Введено значений: ' + filledCount + '. ' +
      'OK — выйти и удалить черновик. Отмена — продолжить заполнение. ' +
      'Чтобы сохранить черновик и вернуться позже — просто закрой вкладку.'
    );
    if (!choice) return;
  }
  _invClearManualDraft();
  _invState._manual = null;
  loadInventory();
}

async function submitManualInventory() {
  if (!_invState._manual) return;
  const m = _invState._manual;
  const items = [];
  Object.keys(m.values).forEach(cid => {
    const v = m.values[cid];
    if (v === undefined || v === null || isNaN(v)) return;
    items.push({ component_id: parseInt(cid, 10), new_qty: Number(v) });
  });
  if (!items.length) return;
  if (!confirm('Применить инвентаризацию ' + items.length + ' позиций? Дельты будут записаны в склад.')) return;

  const submitBtn = document.getElementById('inv-manual-submit-btn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="ti ti-loader"></i> Применяем…';
  }
  try {
    const res = await fetch(API_BASE + '/api/inventory/sessions/manual', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast(j.message || ('Не удалось применить (HTTP ' + res.status + ')'), 'error');
      _invRenderManualEntry();
      return;
    }
    const j = await res.json();
    showToast('Применено: ' + (j.applied_count || 0) + ' позиций', 'success');
    _invClearManualDraft();
    _invState._manual = null;
    await loadInventory();
  } catch (e) {
    showToast('Сеть: не удалось применить', 'error');
    _invRenderManualEntry();
  }
}

// ====== /Ручная инвентаризация ============================================

async function uploadInventoryPhotos(fileList) {
  if (!fileList || !fileList.length) return;
  const files = Array.from(fileList).filter(f => {
    const t = (f.type || '').toLowerCase();
    const n = (f.name || '').toLowerCase();
    return t.startsWith('image/') || t === 'application/pdf' || n.endsWith('.pdf');
  });
  if (!files.length) {
    showToast('Поддерживаются изображения (JPG/PNG/HEIC) и PDF', 'error');
    return;
  }
  const fd = new FormData();
  files.forEach((f, i) => fd.append('photo_' + (i+1), f));
  const body = document.getElementById('inventory-screen-body');
  if (body) body.innerHTML = '<div class="loading-block">Загружаем файлы и запускаем распознавание…</div>';
  try {
    const res = await fetch(API_BASE + '/api/inventory/sessions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
      body: fd,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast(j.message || 'Не удалось загрузить', 'error');
      _invRenderHome();
      return;
    }
    const j = await res.json();
    showToast('Файлы загружены. ИИ распознаёт…', 'success');
    openInventorySession(j.id);
  } catch (e) {
    showToast('Сеть: не удалось загрузить файлы', 'error');
    _invRenderHome();
  }
}

async function deleteInventorySession(id, statusKey) {
  const warn = (statusKey === 'applied')
    ? ('Инвентаризация #' + id + ' уже применена — движения склада останутся в истории, удалится только запись о сессии. Продолжить?')
    : ('Удалить инвентаризацию #' + id + '?');
  if (!confirm(warn)) return;
  try {
    const res = await fetch(API_BASE + '/api/inventory/sessions/' + id, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast(j.message || ('Не удалось удалить (HTTP ' + res.status + ')'), 'error');
      return;
    }
    showToast('Инвентаризация #' + id + ' удалена', 'success');
    // Перезагружаем список с бэка (а не просто фильтруем локально, чтобы не врать)
    await _invFetchSessions();
    _invRenderHome();
  } catch (e) {
    showToast('Сеть: не удалось удалить', 'error');
  }
}

// ============ СВЕРКА СКЛАДА ПО ФОТО ТОВАРА ============
// Стоя у полки: фото коробки → Claude распознаёт артикул → сверяем с остатком
// (сходится / расхождение / нет позиции → занести). Накопительный список,
// применяется батчем через /api/inventory/sessions/manual (как ручная инвентаризация).

let _boxCheck = { items: [], cats: null, current: null };

function _bcN(n) { n = Number(n) || 0; return (Math.round(n * 100) / 100).toString(); }

async function openBoxCheck() {
  _boxCheck = { items: [], cats: _boxCheck.cats, current: null };
  _renderBoxCheck();
  if (!_boxCheck.cats) {
    try { const j = await apiGet('/api/components/categories'); _boxCheck.cats = (j && j.categories) || []; }
    catch (e) { _boxCheck.cats = []; }
  }
}

function _renderBoxCheck() {
  const body = document.getElementById('inventory-screen-body');
  if (!body) return;
  let html = '';
  html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">' +
    '<button class="btn btn-secondary" onclick="loadInventory()"><i class="ti ti-arrow-left"></i> Назад</button>' +
    '<div style="font-weight:700;font-size:16px;">Сверка склада по фото</div></div>';
  html += '<div class="inv-drop" onclick="_boxCheckPick()" style="margin-bottom:14px;">' +
    '<i class="ti ti-camera"></i>' +
    '<div><b>Сфотографировать коробку</b></div>' +
    '<div style="font-size:11.5px;margin-top:3px;">артикул на упаковке распознаётся автоматически</div>' +
    '<input type="file" id="box-check-input" accept="image/*" capture="environment" style="display:none;" onchange="_boxCheckPhoto(this.files)">' +
    '</div>';
  html += '<div id="box-check-result"></div>';
  html += '<div id="box-check-list">' + _boxCheckListHtml() + '</div>';
  body.innerHTML = html;
}

function _boxCheckPick() {
  const i = document.getElementById('box-check-input');
  if (i) { i.value = ''; i.click(); }
}

async function _boxCheckPhoto(files) {
  if (!files || !files.length) return;
  const f = files[0];
  const res = document.getElementById('box-check-result');
  if (res) res.innerHTML = '<div class="loading-block">Распознаём коробку…</div>';
  const fd = new FormData();
  fd.append('photo_1', f);
  try {
    const r = await fetch(API_BASE + '/api/inventory/recognize-box', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
      body: fd,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      if (res) res.innerHTML = '';
      showToast((j && (j.error || j.message)) || 'Не удалось распознать', 'error');
      return;
    }
    _boxCheck.current = j;
    _renderBoxCheckResult(j);
  } catch (e) {
    if (res) res.innerHTML = '';
    showToast('Сеть: не удалось отправить фото', 'error');
  }
}

function _boxCheckChoose(i) {
  if (!_boxCheck.current) return;
  const s = (_boxCheck.current.suggestions || [])[i];
  if (!s) return;
  _boxCheck.current.chosen = s;
  _renderBoxCheckResult(_boxCheck.current);
}

function _renderBoxCheckResult(j) {
  const res = document.getElementById('box-check-result');
  if (!res) return;
  const rec = j.recognized || {};
  const chosen = j.chosen || j.match || null;
  let h = '<div style="border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:14px;background:#fff;">';
  const recLine = [rec.manufacturer, rec.model || rec.name].filter(Boolean).join(' · ') || 'не распознано';
  h += '<div style="font-size:12px;color:var(--text-light);">Распознано на коробке</div>';
  h += '<div style="font-weight:600;margin-bottom:8px;">' + escapeHtml(recLine) +
    (rec.codes && rec.codes.length ? (' <span style="color:var(--text-light);font-weight:400;">(' + escapeHtml(rec.codes.join(', ')) + ')</span>') : '') + '</div>';
  if (chosen) {
    h += '<div style="background:var(--brand-bg,#eef2ff);border-radius:8px;padding:10px;margin-bottom:10px;">' +
      '<div style="font-weight:600;">' + escapeHtml(chosen.name || '') + '</div>' +
      '<div style="font-size:12px;color:var(--text-light);">' + escapeHtml(chosen.sku || '—') +
      ' · на складе <b>' + _bcN(chosen.qty_on_stock) + '</b> ' + escapeHtml(chosen.unit || 'шт.') + '</div>' +
      '</div>';
    // v2.45.739: применяемость — куда деталь ставится и кому её не хватает
    h += '<div id="box-check-usage"></div>';
    h += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
      '<label style="font-size:13px;">Фактически:</label>' +
      '<input type="number" inputmode="decimal" id="box-check-qty" min="0" step="1" ' +
      'style="width:110px;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:15px;" ' +
      'oninput="_boxCheckQtyHint()"' + (rec.pack_qty ? (' placeholder="' + rec.pack_qty + '"') : '') + '>' +
      '<span style="font-size:13px;">' + escapeHtml(chosen.unit || 'шт.') + '</span>' +
      '<span id="box-check-hint" style="font-size:13px;font-weight:600;"></span>' +
      '</div>';
    h += '<div style="display:flex;gap:8px;margin-top:12px;">' +
      '<button class="btn btn-primary" onclick="_boxCheckAdd()"><i class="ti ti-plus"></i> В список</button>' +
      '<button class="btn btn-secondary" onclick="_boxCheckClear()">Отмена</button>' +
      '</div>';
  } else {
    h += '<div style="color:#b45309;font-weight:600;margin-bottom:8px;"><i class="ti ti-alert-triangle"></i> На складе не найдено</div>';
    if (j.suggestions && j.suggestions.length) {
      h += '<div style="font-size:12px;color:var(--text-light);margin-bottom:6px;">Возможно, это:</div>';
      j.suggestions.forEach((s, i) => {
        h += '<div onclick="_boxCheckChoose(' + i + ')" style="cursor:pointer;border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px;">' +
          '<div style="font-weight:600;font-size:13px;">' + escapeHtml(s.name || '') + '</div>' +
          '<div style="font-size:12px;color:var(--text-light);">' + escapeHtml(s.sku || '—') +
          ' · на складе ' + _bcN(s.qty_on_stock) + ' ' + escapeHtml(s.unit || 'шт.') + '</div>' +
          '</div>';
      });
    }
    h += '<div style="display:flex;gap:8px;margin-top:10px;">' +
      '<button class="btn btn-primary" onclick="_boxCheckNewForm()"><i class="ti ti-plus"></i> Занести новую</button>' +
      '<button class="btn btn-secondary" onclick="_boxCheckClear()">Отмена</button>' +
      '</div>';
  }
  h += '</div>';
  res.innerHTML = h;
  const qi = document.getElementById('box-check-qty');
  if (qi) { try { qi.focus(); } catch (e) {} }
  const _cid = chosen && (chosen.component_id || chosen.id);
  if (_cid) _bcLoadUsage(_cid);
}

// ============ v2.45.739: применяемость детали — где стоит и кому не хватает ============
var _bcUsageShowAll = false;
async function _bcLoadUsage(componentId) {
  const box = document.getElementById('box-check-usage');
  if (!box) return;
  _bcUsageShowAll = false;
  try {
    const d = await apiGet('/api/components/' + componentId + '/usage');
    if (!d || !d.ok) { box.innerHTML = ''; return; }
    _bcRenderUsage(d);
  } catch (e) { box.innerHTML = ''; }
}
function _bcRenderUsage(d) {
  const box = document.getElementById('box-check-usage');
  if (!box) return;
  const c = d.component || {};
  let h = '';
  // ниже минимума — жёлтая пометка
  if (c.min_stock > 0 && c.qty_on_stock < c.min_stock) {
    h += '<div class="bcu-low">⚠ Ниже минимума (мин. ' + _bcN(c.min_stock) + ' ' +
      escapeHtml(c.unit || 'шт.') + ') — уже в «Что закупить»</div>';
  }
  const uses = d.uses || [];
  if (uses.length) {
    h += '<div class="bcu-sec">🔧 Применяется в изделиях <span class="n">' + uses.length + '</span></div>';
    const shown = _bcUsageShowAll ? uses : uses.slice(0, 3);
    shown.forEach(u => {
      h += '<div class="bcu-row" onclick="openModelDetail(' + u.model_id + ')">' +
        '<div class="t"><div class="nm">' + escapeHtml(u.name) + '</div>' +
        '<div class="dir">' + escapeHtml([u.direction, u.article].filter(Boolean).join(' · ')) +
          (u.is_critical ? ' · критичная' : '') + '</div></div>' +
        '<span class="per">' + _bcN(u.qty_per_unit) + ' ' + escapeHtml(c.unit || 'шт.') + ' / изделие</span>' +
        '<span class="go">↗</span></div>';
    });
    if (!_bcUsageShowAll && uses.length > 3) {
      const _n = uses.length - 3;
      const _w = (typeof _plural === 'function') ? _plural(_n, ['изделие', 'изделия', 'изделий']) : 'изделий';
      h += '<button class="bcu-more" onclick="_bcUsageMore()">показать ещё ' + _n + ' ' + _w + ' ▾</button>';
    }
  } else {
    h += '<div class="bcu-sec">🔧 Применяется в изделиях <span class="n">0</span></div>' +
      '<div class="bcu-empty">В составах моделей (BOM) эта деталь не числится — привяжи, чтобы CRM знала, куда она относится.</div>';
  }
  // v2.45.741: привязать к изделию прямо отсюда
  h += '<button class="bcu-more" onclick="_bcuLinkOpen()">＋ Привязать к изделию</button>' +
    '<div id="bcu-link-form" style="display:none;"></div>';
  const need = d.needed_now || [];
  if (need.length) {
    h += '<div class="bcu-sec">⚠ Нужно прямо сейчас <span class="n">' + need.length + '</span></div>';
    need.forEach(n => {
      h += '<div class="bcu-need" onclick="openProductionWorkDetail(' + n.work_id + ')">' +
        '<div class="nm">' + escapeHtml(n.name) +
        '<span class="sub">' + escapeHtml([n.contract_number ? '№' + n.contract_number : '',
          n.is_blocked ? 'работа заблокирована' : ''].filter(Boolean).join(' · ')) + '</span></div>' +
        '<span class="def">не хватает ' + _bcN(n.deficit) + ' ' + escapeHtml(c.unit || 'шт.') + '</span></div>';
    });
  }
  box.innerHTML = h;
  box._usage = d;
}
function _bcUsageMore() {
  _bcUsageShowAll = true;
  const box = document.getElementById('box-check-usage');
  if (box && box._usage) _bcRenderUsage(box._usage);
}

// v2.45.741: привязка детали к изделию прямо с экрана сверки
var _bcuModelPicked = null;
function _bcuLinkOpen() {
  const f = document.getElementById('bcu-link-form');
  if (!f) return;
  if (f.style.display !== 'none') { f.style.display = 'none'; return; }
  _bcuModelPicked = null;
  f.style.display = 'block';
  f.innerHTML = '<div class="bcu-linkbox">' +
    '<div style="position:relative;">' +
      '<input class="form-input" id="bcu-model-q" autocomplete="off" placeholder="Название изделия — начни печатать…" ' +
        'oninput="_bcuModelFilter(this.value)">' +
      '<div class="calc-combo-list" id="bcu-model-dd" style="display:none;"></div>' +
    '</div>' +
    '<div class="bcu-linkrow">' +
      '<label>Штук на изделие:</label>' +
      '<input type="number" class="recvb-qty" id="bcu-link-qty" value="1" min="0.1" step="1">' +
      '<button class="btn btn-primary btn-small" onclick="_bcuLinkGo()"><i class="ti ti-link"></i> Привязать</button>' +
    '</div></div>';
  setTimeout(() => { const q = document.getElementById('bcu-model-q'); if (q) q.focus(); }, 60);
}
async function _bcuModelFilter(q) {
  const dd = document.getElementById('bcu-model-dd');
  if (!dd) return;
  q = (q || '').trim();
  _bcuModelPicked = null;
  if (q.length < 2) { dd.style.display = 'none'; return; }
  try {
    const d = await apiGet('/api/models?search=' + encodeURIComponent(q));
    const models = (d && d.models) || [];
    dd.innerHTML = models.length ? models.slice(0, 15).map(m =>
      '<div class="calc-combo-row" data-id="' + m.id + '">' +
      escapeHtml(m.name || '') + (m.article ? ' <span style="color:var(--text-faint);">' + escapeHtml(m.article) + '</span>' : '') +
      '</div>').join('') : '<div class="calc-combo-row mut">не нашлось</div>';
    dd.querySelectorAll('.calc-combo-row[data-id]').forEach(el => {
      el.onclick = function () {
        _bcuModelPicked = { id: parseInt(el.dataset.id, 10), name: el.textContent };
        const inp = document.getElementById('bcu-model-q');
        if (inp) inp.value = el.textContent;
        dd.style.display = 'none';
      };
    });
    dd.style.display = 'block';
  } catch (e) { dd.style.display = 'none'; }
}
async function _bcuLinkGo() {
  const box = document.getElementById('box-check-usage');
  const compId = box && box._usage && box._usage.component && box._usage.component.id;
  if (!compId) return;
  if (!_bcuModelPicked) { showToast('Выбери изделие из подсказок', 'error'); return; }
  const qty = parseFloat((document.getElementById('bcu-link-qty') || {}).value) || 1;
  try {
    const r = await apiPost('/api/components/' + compId + '/bom-link',
      { model_id: _bcuModelPicked.id, qty_required: qty });
    const j = (r && r.data) || {};
    if (r && r.ok) {
      showToast((j.action === 'updated' ? 'Количество обновлено: ' : 'Привязано: ') +
        (j.model_name || ''), 'success');
      _bcLoadUsage(compId);
    } else showToast(j.message || 'Не удалось привязать', 'error');
  } catch (e) { showToast('Ошибка соединения', 'error'); }
}

function _boxCheckQtyHint() {
  const j = _boxCheck.current; if (!j) return;
  const chosen = j.chosen || j.match; if (!chosen) return;
  const el = document.getElementById('box-check-hint');
  const qi = document.getElementById('box-check-qty');
  if (!el || !qi) return;
  if (qi.value === '') { el.textContent = ''; return; }
  const fact = Number(qi.value);
  const cur = Number(chosen.qty_on_stock) || 0;
  if (!isFinite(fact)) { el.textContent = ''; return; }
  const d = fact - cur;
  if (d === 0) { el.style.color = '#16a34a'; el.textContent = '✓ сходится'; }
  else { el.style.color = '#dc2626'; el.textContent = 'расхождение: ' + (d > 0 ? '+' : '') + _bcN(d); }
}

function _boxCheckClear() {
  _boxCheck.current = null;
  const res = document.getElementById('box-check-result');
  if (res) res.innerHTML = '';
}

function _boxCheckAdd() {
  const j = _boxCheck.current; if (!j) return;
  const chosen = j.chosen || j.match; if (!chosen) return;
  const qi = document.getElementById('box-check-qty');
  const fact = qi ? Number(qi.value) : NaN;
  if (qi && qi.value === '' || !isFinite(fact) || fact < 0) {
    showToast('Введите фактическое количество', 'error'); return;
  }
  const cur = Number(chosen.qty_on_stock) || 0;
  const item = {
    component_id: chosen.component_id,
    name: chosen.name, sku: chosen.sku, unit: chosen.unit || 'шт.',
    current: cur, fact: fact, delta: fact - cur,
    isNew: !!chosen._isNew,
  };
  const ix = _boxCheck.items.findIndex(x => x.component_id === item.component_id);
  if (ix >= 0) _boxCheck.items[ix] = item; else _boxCheck.items.push(item);
  _boxCheckClear();
  _renderBoxCheckList();
  showToast('Добавлено: ' + (item.name || ''), 'success');
}

function _boxCheckRemove(idx) {
  _boxCheck.items.splice(idx, 1);
  _renderBoxCheckList();
}

function _renderBoxCheckList() {
  const el = document.getElementById('box-check-list');
  if (el) el.innerHTML = _boxCheckListHtml();
}

function _boxCheckListHtml() {
  const items = _boxCheck.items;
  if (!items.length) {
    return '<div style="color:var(--text-light);font-size:13px;padding:16px;text-align:center;border:1px dashed var(--border);border-radius:10px;">Список пуст — сфотографируйте первую коробку</div>';
  }
  const diffs = items.filter(x => x.delta !== 0).length;
  let h = '<div style="font-weight:700;margin:6px 0 8px;">Проверено: ' + items.length +
    (diffs ? (' · <span style="color:#dc2626;">с расхождением ' + diffs + '</span>') : ' · всё сходится') + '</div>';
  items.forEach((x, i) => {
    let badge;
    if (x.isNew) badge = '<span style="color:#7c3aed;font-weight:600;">новая · ' + _bcN(x.fact) + '</span>';
    else if (x.delta === 0) badge = '<span style="color:#16a34a;font-weight:600;">✓ ' + _bcN(x.fact) + '</span>';
    else badge = '<span style="color:#dc2626;font-weight:600;">' + _bcN(x.current) + ' → ' + _bcN(x.fact) + ' (' + (x.delta > 0 ? '+' : '') + _bcN(x.delta) + ')</span>';
    h += '<div style="display:flex;align-items:center;gap:10px;border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px;">' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(x.name || '') + '</div>' +
        '<div style="font-size:12px;color:var(--text-light);">' + escapeHtml(x.sku || '—') + ' · ' + escapeHtml(x.unit || 'шт.') + '</div>' +
      '</div>' +
      '<div style="font-size:13px;white-space:nowrap;">' + badge + '</div>' +
      '<button class="inv-delete-btn" title="Убрать" onclick="_boxCheckRemove(' + i + ')"><i class="ti ti-x"></i></button>' +
    '</div>';
  });
  h += '<button class="btn btn-primary" style="width:100%;margin-top:10px;" onclick="_boxCheckApply()">' +
    '<i class="ti ti-checks"></i> Применить (' + items.length + ')</button>';
  return h;
}

async function _boxCheckApply() {
  const items = _boxCheck.items;
  if (!items.length) return;
  const diffs = items.filter(x => x.delta !== 0 && !x.isNew).length;
  const news = items.filter(x => x.isNew).length;
  let msg = 'Применить ' + items.length + ' позиций к складу?';
  if (diffs) msg += '\nС расхождением: ' + diffs + ' (остаток будет приведён к факту).';
  if (news) msg += '\nНовых позиций: ' + news + '.';
  if (!confirm(msg)) return;
  const payload = { items: items.map(x => ({ component_id: x.component_id, new_qty: x.fact })) };
  try {
    const r = await apiPost('/api/inventory/sessions/manual', payload);
    if (!r.ok || !(r.data && (r.data.ok || r.data.id))) {
      showToast((r.data && (r.data.message || r.data.error)) || 'Не удалось применить', 'error');
      return;
    }
    showToast('Применено: ' + items.length + ' позиций', 'success');
    _boxCheck.items = [];
    await _invFetchSessions();
    _invRenderHome();
  } catch (e) {
    showToast('Сеть: не удалось применить', 'error');
  }
}

function _boxCheckNewForm() {
  const j = _boxCheck.current; if (!j) return;
  const rec = j.recognized || {};
  const res = document.getElementById('box-check-result'); if (!res) return;
  const cats = _boxCheck.cats || [];
  let defCat = cats.find(c => /электр/i.test(c.name || ''));
  if (!defCat && cats.length) defCat = cats[0];
  const nameVal = rec.name || rec.model || '';
  const skuVal = (rec.codes && rec.codes.length ? rec.codes[0] : '') || rec.model || '';
  let opts = cats.map(c => '<option value="' + c.id + '"' + (defCat && c.id === defCat.id ? ' selected' : '') + '>' + escapeHtml(c.name) + '</option>').join('');
  let h = '<div style="border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:14px;background:#fff;">' +
    '<div style="font-weight:700;margin-bottom:10px;">Занести новую позицию</div>' +
    '<div style="display:flex;flex-direction:column;gap:8px;">' +
      '<label style="font-size:12px;color:var(--text-light);">Наименование' +
        '<input id="bc-new-name" value="' + escapeHtml(nameVal) + '" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-top:3px;"></label>' +
      '<label style="font-size:12px;color:var(--text-light);">Артикул' +
        '<input id="bc-new-sku" value="' + escapeHtml(skuVal) + '" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-top:3px;"></label>' +
      '<label style="font-size:12px;color:var(--text-light);">Раздел' +
        '<select id="bc-new-cat" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-top:3px;">' + opts + '</select></label>' +
      '<div style="display:flex;gap:8px;">' +
        '<label style="font-size:12px;color:var(--text-light);flex:1;">Фактически (шт.)' +
          '<input id="bc-new-qty" type="number" inputmode="decimal" min="0" step="1"' + (rec.pack_qty ? (' placeholder="' + rec.pack_qty + '"') : '') + ' style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-top:3px;"></label>' +
        '<label style="font-size:12px;color:var(--text-light);width:90px;">Ед.' +
          '<input id="bc-new-unit" value="шт." style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-top:3px;"></label>' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:12px;">' +
      '<button class="btn btn-primary" onclick="_boxCheckCreate()"><i class="ti ti-check"></i> Создать и добавить</button>' +
      '<button class="btn btn-secondary" onclick="_renderBoxCheckResult(_boxCheck.current)">Назад</button>' +
    '</div>' +
  '</div>';
  res.innerHTML = h;
}

async function _boxCheckCreate() {
  const name = (document.getElementById('bc-new-name') || {}).value || '';
  const sku = (document.getElementById('bc-new-sku') || {}).value || '';
  const catId = Number((document.getElementById('bc-new-cat') || {}).value);
  const unit = (document.getElementById('bc-new-unit') || {}).value || 'шт.';
  const qiv = (document.getElementById('bc-new-qty') || {}).value;
  const fact = Number(qiv);
  if (!name.trim()) { showToast('Укажите наименование', 'error'); return; }
  if (!catId) { showToast('Выберите раздел', 'error'); return; }
  if (qiv === '' || !isFinite(fact) || fact < 0) { showToast('Укажите фактическое количество', 'error'); return; }
  try {
    const r = await apiPost('/api/components', {
      name: name.trim(), sku: sku.trim(), category_id: catId, unit: unit.trim() || 'шт.',
    });
    if (!r.ok || !(r.data && r.data.id)) {
      showToast((r.data && (r.data.message || r.data.error)) || 'Не удалось создать позицию', 'error');
      return;
    }
    const comp = r.data;
    _boxCheck.items.push({
      component_id: comp.id, name: comp.name, sku: comp.sku || sku, unit: comp.unit || unit,
      current: 0, fact: fact, delta: fact, isNew: true,
    });
    _boxCheckClear();
    _renderBoxCheckList();
    showToast('Создано и добавлено: ' + comp.name, 'success');
  } catch (e) {
    showToast('Сеть: не удалось создать', 'error');
  }
}

async function openInventorySession(sessionId) {
  _invState._selectedIds = new Set();
  _invState._overrides = {};
  await _invLoadSession(sessionId);
}

async function _invLoadSession(sessionId) {
  const body = document.getElementById('inventory-screen-body');
  if (!body) return;
  body.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try {
    const res = await fetch(API_BASE + '/api/inventory/sessions/' + sessionId, {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    if (!res.ok) throw new Error('http ' + res.status);
    const sess = await res.json();
    _invState.currentSession = sess;
    _invRenderSession(sess);
    // если ещё распознаём — запускаем polling
    if (sess.status === 'recognizing') _invStartPolling(sessionId);
    else _invStopPolling();
  } catch (e) {
    body.innerHTML = '<div class="pkb-form-error" style="margin:12px 0;"><i class="ti ti-alert-triangle"></i>Не удалось загрузить сессию</div>';
  }
}

function _invStartPolling(sessionId) {
  _invStopPolling();
  _invState._pollTimer = setInterval(async () => {
    if (!document.querySelector('.screen[data-screen="inventory"].active')) {
      _invStopPolling();
      return;
    }
    try {
      const res = await fetch(API_BASE + '/api/inventory/sessions/' + sessionId, {
        headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
      });
      if (!res.ok) return;
      const sess = await res.json();
      if (sess.status !== 'recognizing') {
        _invStopPolling();
        _invState.currentSession = sess;
        _invRenderSession(sess);
      }
    } catch (_) {}
  }, 3000);
}
function _invStopPolling() {
  if (_invState._pollTimer) { clearInterval(_invState._pollTimer); _invState._pollTimer = null; }
}

function _invRenderSession(sess) {
  const body = document.getElementById('inventory-screen-body');
  if (!body) return;
  const isReady = sess.status === 'ready';
  const isApplied = sess.status === 'applied';
  const isError = sess.status === 'error';
  const isRecognizing = sess.status === 'recognizing';
  const recognized = sess.recognized || [];

  let html = '';
  html += '<div style="margin-bottom:14px;">' +
    '<button class="btn btn-secondary" onclick="loadInventory()">' +
      '<i class="ti ti-arrow-left"></i> Назад к инвентаризации' +
    '</button>' +
  '</div>';

  // Шапка сессии
  const headerLabel = isApplied ? 'Инвентаризация применена' :
                      isReady ? 'Распознано — проверь и применяй' :
                      isError ? 'Ошибка распознавания' :
                      isRecognizing ? 'ИИ распознаёт фото…' : 'Сессия #' + sess.id;
  html += '<div class="page-header" style="margin-bottom:14px;">' +
            '<div>' +
              '<h1 style="font-size:18px;">' + escapeHtml(headerLabel) + ' · #' + sess.id + '</h1>' +
              '<div class="page-subtitle">Создано ' + escapeHtml(_devFormatDate(sess.created_at)) +
                (sess.applied_at ? ' · применено ' + escapeHtml(_devFormatDate(sess.applied_at)) : '') +
              '</div>' +
            '</div>' +
          '</div>';

  if (isRecognizing) {
    html += '<div style="text-align:center;padding:30px;color:var(--text-light);">' +
              '<i class="ti ti-loader-2" style="font-size:32px;animation:spin 1.5s linear infinite;"></i>' +
              '<div style="margin-top:10px;font-size:14px;">Claude разбирает рукописные значения. Это занимает 5–30 секунд.</div>' +
            '</div>';
    body.innerHTML = html;
    return;
  }

  if (isError) {
    html += '<div class="pkb-form-error" style="margin:12px 0;">' +
              '<i class="ti ti-alert-triangle"></i>' + escapeHtml(sess.ai_error || 'Ошибка ИИ') +
            '</div>';
    body.innerHTML = html;
    return;
  }

  if (!recognized.length) {
    html += '<div style="text-align:center;padding:30px;color:var(--text-light);">Ничего не распознано</div>';
    body.innerHTML = html;
    return;
  }

  // Sortировка: сначала с расхождениями, потом совпадения, в конце не-найденные
  const matched = recognized.filter(r => r.match === 'exact');
  const notFound = recognized.filter(r => r.match !== 'exact');
  const mismatched = matched.filter(r => Math.abs(r.delta || 0) > 0.0001);
  const same = matched.filter(r => Math.abs(r.delta || 0) <= 0.0001);

  // Если ещё не выбирали — авто-выберем все строки с расхождением
  if (_invState._selectedIds.size === 0 && !isApplied) {
    mismatched.forEach(r => { if (r.component_id) _invState._selectedIds.add(r.component_id); });
  }

  // Сводка
  html += '<div class="inv-summary-bar">' +
    '<i class="ti ti-info-circle" style="color:var(--brand);"></i>' +
    '<span>Распознано <span class="inv-sum-num">' + recognized.length + '</span> позиций · ' +
    'с расхождением: <span class="inv-sum-num">' + mismatched.length + '</span> · ' +
    'совпало: <span class="inv-sum-num">' + same.length + '</span>' +
    (notFound.length ? ' · не найдено: <span class="inv-sum-num">' + notFound.length + '</span>' : '') +
    '</span>' +
  '</div>';

  // Таблица
  const ordered = [...mismatched, ...same, ...notFound];
  html += '<div class="inv-diff-table">';
  html += '<div class="inv-diff-row head">' +
    '<div class="inv-check">' +
      (isApplied ? '' :
        '<input type="checkbox" id="inv-check-all"' + (_invState._selectedIds.size > 0 && _invState._selectedIds.size === mismatched.length ? ' checked' : '') + ' onchange="_invToggleAll(this.checked)">' +
        '<label for="inv-check-all"></label>'
      ) +
    '</div>' +
    '<div></div>' +
    '<div>Позиция</div>' +
    '<div style="text-align:right;">По системе</div>' +
    '<div style="text-align:right;">Факт</div>' +
    '<div style="text-align:right;">Δ</div>' +
  '</div>';

  ordered.forEach(r => {
    const isMismatch = r.match === 'exact' && Math.abs(r.delta || 0) > 0.0001;
    const isNF = r.match !== 'exact';
    const rowCls = 'inv-diff-row' + (isMismatch ? ' is-mismatch' : '') + (isNF ? ' is-not-found' : '');
    const checked = r.component_id && _invState._selectedIds.has(r.component_id);
    const checkbox = (isApplied || isNF)
      ? ''
      : '<input type="checkbox" id="inv-row-' + r.component_id + '"' + (checked ? ' checked' : '') +
        ' onchange="_invToggleRow(' + r.component_id + ', this.checked)"><label for="inv-row-' + r.component_id + '"></label>';
    const delta = r.delta;
    const deltaCls = isMismatch ? (delta > 0 ? 'up' : 'down') : '';
    const deltaStr = delta == null ? '—' : (delta > 0 ? '+' : '') + _formatNum(delta);
    // Поле редактирования факта
    const newQty = _invState._overrides[r.component_id] != null
      ? _invState._overrides[r.component_id]
      : r.recognized_qty;
    const factCell = isApplied
      ? '<div style="text-align:right;">' + _formatNum(r.recognized_qty) + '</div>'
      : (isNF
          ? '<div style="text-align:right;">' + _formatNum(r.recognized_qty) + '</div>'
          : '<div class="inv-d-num" style="text-align:right;"><input type="number" step="0.01" value="' + newQty + '" ' +
                'onchange="_invSetOverride(' + r.component_id + ', this.value)"></div>'
        );
    html += '<div class="' + rowCls + '">' +
      '<div class="inv-check">' + checkbox + '</div>' +
      '<div></div>' +
      '<div>' +
        '<div style="font-size:13px;color:var(--text-dark);">' + escapeHtml(r.name || (r.article || '—')) + '</div>' +
        '<div style="font-size:11.5px;color:var(--text-light);">Артикул: ' + escapeHtml(r.article || '—') +
          (isNF ? ' · <span class="inv-diff-not-found-note">нет в базе</span>' : '') +
        '</div>' +
      '</div>' +
      '<div style="text-align:right;font-variant-numeric:tabular-nums;">' +
        (r.current_qty == null ? '—' : _formatNum(r.current_qty)) +
      '</div>' +
      factCell +
      '<div class="inv-d-delta ' + deltaCls + '">' + escapeHtml(deltaStr) + '</div>' +
    '</div>';
  });
  html += '</div>';

  if (!isApplied) {
    html += '<div style="display:flex;justify-content:flex-end;margin-top:14px;gap:8px;">' +
      '<button class="btn btn-primary" onclick="applyInventorySession(' + sess.id + ')" id="inv-apply-btn">' +
        '<i class="ti ti-check"></i> Применить <span id="inv-apply-count">' + _invState._selectedIds.size + '</span> позиций' +
      '</button>' +
    '</div>';
  }

  body.innerHTML = html;
}

function _formatNum(n) {
  if (n == null || isNaN(n)) return '—';
  const num = Number(n);
  if (Number.isInteger(num)) return String(num);
  return num.toFixed(2).replace(/\.?0+$/, '');
}

function _invToggleRow(componentId, checked) {
  if (checked) _invState._selectedIds.add(componentId);
  else _invState._selectedIds.delete(componentId);
  const lbl = document.getElementById('inv-apply-count');
  if (lbl) lbl.textContent = _invState._selectedIds.size;
}

function _invToggleAll(checked) {
  const recognized = (_invState.currentSession && _invState.currentSession.recognized) || [];
  const mismatched = recognized.filter(r => r.match === 'exact' && Math.abs(r.delta || 0) > 0.0001);
  if (checked) mismatched.forEach(r => { if (r.component_id) _invState._selectedIds.add(r.component_id); });
  else _invState._selectedIds.clear();
  _invRenderSession(_invState.currentSession);
}

function _invSetOverride(componentId, val) {
  const num = parseFloat(val);
  if (isNaN(num)) {
    delete _invState._overrides[componentId];
    return;
  }
  _invState._overrides[componentId] = num;
}

async function applyInventorySession(sessionId) {
  const recognized = (_invState.currentSession && _invState.currentSession.recognized) || [];
  const items = [];
  recognized.forEach(r => {
    if (!r.component_id) return;
    if (!_invState._selectedIds.has(r.component_id)) return;
    const newQty = _invState._overrides[r.component_id] != null
      ? _invState._overrides[r.component_id]
      : r.recognized_qty;
    items.push({ component_id: r.component_id, new_qty: newQty });
  });
  if (!items.length) {
    showToast('Не выбрано ни одной позиции', 'error');
    return;
  }
  if (!confirm('Применить инвентаризацию: ' + items.length + ' позиций? Изменения остатков нельзя будет откатить одним кликом.')) return;
  const btn = document.getElementById('inv-apply-btn');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(API_BASE + '/api/inventory/sessions/' + sessionId + '/apply', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast(j.message || 'Не удалось применить', 'error');
      if (btn) btn.disabled = false;
      return;
    }
    const j = await res.json();
    showToast('Применено: ' + (j.applied_count || 0) + ' позиций', 'success');
    await _invLoadSession(sessionId);
  } catch (e) {
    showToast('Сеть: не удалось применить', 'error');
    if (btn) btn.disabled = false;
  }
}

function _startDevChatPolling() {
  _stopDevChatPolling();
  _devState._chatPollTimer = setInterval(async () => {
    if (!_devState.currentId) return;
    if (!document.querySelector('.screen[data-screen="developments"].active')) {
      _stopDevChatPolling();
      return;
    }
    try {
      const res = await fetch(API_BASE + '/api/developments/' + _devState.currentId + '/chat', {
        headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
      });
      if (!res.ok) return;
      const j = await res.json();
      const newMsgs = j.messages || [];
      if (newMsgs.length !== _devState.messages.length) {
        _devState.messages = newMsgs;
        renderDevelopmentMessages();
      }
    } catch (_) {}
  }, 7000);
}
function _stopDevChatPolling() {
  if (_devState._chatPollTimer) {
    clearInterval(_devState._chatPollTimer);
    _devState._chatPollTimer = null;
  }
}

const HELP_CATEGORIES = [
  { id: 'guides',     label: 'Гайды по шагам', icon: 'ti-route' },
  { id: 'start',      label: 'Старт',         icon: 'ti-rocket' },
  { id: 'home',       label: 'Главная',       icon: 'ti-home' },
  { id: 'production', label: 'Производство',  icon: 'ti-tool' },
  { id: 'sales',      label: 'Продажи',       icon: 'ti-briefcase' },
  { id: 'tasks',      label: 'Задачи',        icon: 'ti-checklist' },
  { id: 'warehouse',  label: 'Склад',         icon: 'ti-building-warehouse' },
  { id: 'supply',     label: 'Снабжение',     icon: 'ti-shopping-cart' },
  { id: 'qr',         label: 'QR-коды',       icon: 'ti-qrcode' },
  { id: 'defects',    label: 'Доработки',     icon: 'ti-alert-circle' },
  { id: 'hr',         label: 'Кадры',         icon: 'ti-id-badge' },
];

state.helpSearch = '';
state.helpSearchTimer = null;

// ============================================================
// ============ ЭТАП 20: КАДРЫ — ОТПУСКА (фронт) ============
// ============================================================

cache.vacationsAll = null;
cache.employeesAll = null;
state.hrListFilter = 'all';       // all | current | planned | finished
state.hrCalMonth = null;          // {year, month}
state.hrTlAnchor = null;          // {year, month} — начало просматриваемого окна (3 месяца)

function canManageHr() {
  if (!state.user) return false;
  const roles = state.user.roles || [];
  return roles.includes('director') || roles.includes('accountant');
}

async function ensureAllEmployeesForVacationsLoaded() {
  if (cache.employeesAll) return cache.employeesAll;
  try {
    const d = await apiGet('/api/employees/active');
    cache.employeesAll = d.employees || [];
  } catch (e) {
    cache.employeesAll = [];
  }
  return cache.employeesAll;
}

async function loadAllVacations() {
  try {
    const d = await apiGet('/api/vacations');
    cache.vacationsAll = d.vacations || [];
  } catch (e) {
    cache.vacationsAll = [];
  }
  return cache.vacationsAll;
}

// ---- Таймлайн (Gantt) ----
async function loadHrTimeline() {
  const body = document.getElementById('hr-timeline-body');
  if (!body) return;
  body.innerHTML = '<div class="loading-block">Загружаем график…</div>';
  if (!state.hrTlAnchor) {
    const now = new Date();
    state.hrTlAnchor = { year: now.getFullYear(), month: now.getMonth() };
  }
  await Promise.all([ensureAllEmployeesForVacationsLoaded(), loadAllVacations()]);
  renderHrTimeline();
}

function renderHrTimeline() {
  const body = document.getElementById('hr-timeline-body');
  if (!body) return;
  const { year, month } = state.hrTlAnchor;
  const start = new Date(year, month, 1);
  const monthsToShow = 3;
  const end = new Date(year, month + monthsToShow, 0);
  const totalDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;

  // Заголовок месяцев и дней
  let html = '<div class="hr-timeline"><table class="hr-tl-table">';
  html += '<thead>';
  // Строка месяцев
  html += '<tr><th class="hr-tl-emp-col">Сотрудник</th>';
  let d = new Date(start);
  let currentMonth = -1;
  let mSpan = 0;
  let mLabels = [];
  while (d <= end) {
    if (d.getMonth() !== currentMonth) {
      if (mSpan > 0) mLabels.push({ month: currentMonth, year: d.getFullYear(), span: mSpan });
      currentMonth = d.getMonth();
      mSpan = 1;
    } else mSpan++;
    d.setDate(d.getDate() + 1);
  }
  // Последний месяц
  if (mSpan > 0) mLabels.push({ month: currentMonth, year: end.getFullYear(), span: mSpan });
  // Восстановим years правильно
  let dd = new Date(start);
  mLabels = [];
  let curM = dd.getMonth(), curY = dd.getFullYear(), span = 0;
  while (dd <= end) {
    if (dd.getMonth() !== curM) {
      mLabels.push({ month: curM, year: curY, span });
      curM = dd.getMonth(); curY = dd.getFullYear(); span = 1;
    } else span++;
    dd.setDate(dd.getDate() + 1);
  }
  if (span > 0) mLabels.push({ month: curM, year: curY, span });

  mLabels.forEach(m => {
    html += '<th colspan="' + m.span + '" class="hr-tl-month-header">' + MONTH_NAMES_RU[m.month] + ' ' + m.year + '</th>';
  });
  html += '</tr>';
  // Строка дней
  html += '<tr><th class="hr-tl-emp-col"></th>';
  let dCur = new Date(start);
  while (dCur <= end) {
    const dow = (dCur.getDay() + 6) % 7;
    const cls = dow >= 5 ? 'hr-tl-day-header is-weekend' : 'hr-tl-day-header';
    html += '<th class="' + cls + '">' + dCur.getDate() + '</th>';
    dCur.setDate(dCur.getDate() + 1);
  }
  html += '</tr></thead><tbody>';

  // Строки сотрудников (показываем только тех, у кого есть отпуска в окне)
  const today = new Date();
  const todayIso = isoDate(today);
  const employees = cache.employeesAll || [];
  const allVac = cache.vacationsAll || [];
  // Сгруппируем отпуска по сотруднику и оставим только тех, кто пересекается с окном
  const vacByEmp = {};
  allVac.forEach(v => {
    const s = new Date(v.start_date);
    const e = new Date(v.end_date);
    if (e < start || s > end) return; // вне окна
    if (!vacByEmp[v.employee_id]) vacByEmp[v.employee_id] = [];
    vacByEmp[v.employee_id].push(v);
  });
  const empList = employees.filter(e => vacByEmp[e.id]);
  if (!empList.length) {
    body.innerHTML = '<div class="empty-block"><i class="ti ti-beach"></i>В этом периоде нет запланированных отпусков</div>';
    return;
  }
  empList.forEach(emp => {
    html += '<tr>';
    html += '<td class="hr-tl-emp-col">' + escapeHtml(emp.short_name || emp.full_name || '—');
    if (emp.position) html += '<div class="hr-tl-emp-pos">' + escapeHtml(emp.position) + '</div>';
    html += '</td>';
    // Клетки дней
    let dayCells = '';
    let dD = new Date(start);
    for (let i = 0; i < totalDays; i++) {
      const dow = (dD.getDay() + 6) % 7;
      const iso = isoDate(dD);
      const cls = ['hr-tl-grid-cell'];
      if (dow >= 5) cls.push('is-weekend');
      if (iso === todayIso) cls.push('is-today');
      dayCells += '<td class="' + cls.join(' ') + '"></td>';
      dD.setDate(dD.getDate() + 1);
    }
    html += dayCells;
    html += '</tr>';
    // Добавим бары внутрь строки через JS после рендера (или inline через absolute со script-замером)
    // Проще: вставлю бары inline через colSpan trick — да нет, лучше через positioned overlay
  });
  html += '</tbody></table></div>';

  body.innerHTML = html;

  // Теперь рисуем бары поверх клеток с position: absolute
  // Перебираем строки tbody и для каждого emp находим клетки
  const tbody = body.querySelector('tbody');
  if (!tbody) return;
  Array.from(tbody.children).forEach((tr, rowIdx) => {
    const emp = empList[rowIdx];
    if (!emp) return;
    const vacs = vacByEmp[emp.id] || [];
    const cells = tr.querySelectorAll('.hr-tl-grid-cell');
    vacs.forEach(v => {
      const vs = new Date(v.start_date);
      const ve = new Date(v.end_date);
      const startIdx = Math.max(0, Math.round((vs - start) / (1000 * 60 * 60 * 24)));
      const endIdx = Math.min(totalDays - 1, Math.round((ve - start) / (1000 * 60 * 60 * 24)));
      if (startIdx > endIdx) return;
      // Бар стоит на первой клетке диапазона и тянется через flexibility
      // Используем абсолютное позиционирование: подсчитываем left/width по колонкам
      const startCell = cells[startIdx];
      const endCell = cells[endIdx];
      if (!startCell || !endCell) return;
      const startLeft = startCell.offsetLeft;
      const endLeft = endCell.offsetLeft + endCell.offsetWidth;
      const width = endLeft - startLeft;
      const bar = document.createElement('div');
      bar.className = 'hr-tl-bar';
      bar.style.left = startLeft + 'px';
      bar.style.width = width + 'px';
      bar.textContent = v.days_total + ' дн.';
      bar.title = (v.employee_full_name || '') + ': ' + v.start_date + ' — ' + v.end_date + (v.comment ? ' (' + v.comment + ')' : '');
      if (canManageHr()) {
        bar.onclick = () => openEditVacation(v.id);
        bar.style.cursor = 'pointer';
      }
      startCell.appendChild(bar);
    });
  });
}

function hrTimelinePrev() {
  if (!state.hrTlAnchor) return;
  let { year, month } = state.hrTlAnchor;
  month -= 3;
  while (month < 0) { month += 12; year--; }
  state.hrTlAnchor = { year, month };
  loadHrTimeline();
}
function hrTimelineNext() {
  if (!state.hrTlAnchor) return;
  let { year, month } = state.hrTlAnchor;
  month += 3;
  while (month > 11) { month -= 12; year++; }
  state.hrTlAnchor = { year, month };
  loadHrTimeline();
}
function hrTimelineToday() {
  const now = new Date();
  state.hrTlAnchor = { year: now.getFullYear(), month: now.getMonth() };
  loadHrTimeline();
}

// ---- Список ----
async function loadHrList() {
  const body = document.getElementById('hr-list-body');
  if (!body) return;
  body.innerHTML = '<div class="loading-block">Загружаем…</div>';
  await loadAllVacations();
  renderHrList();
}

function renderHrList() {
  const body = document.getElementById('hr-list-body');
  if (!body) return;
  let list = cache.vacationsAll || [];
  if (state.hrListFilter !== 'all') {
    list = list.filter(v => v.status === state.hrListFilter);
  }
  document.getElementById('hr-list-counter').textContent = list.length;
  if (!list.length) {
    body.innerHTML = '<div class="empty-block"><i class="ti ti-beach"></i>Под этот фильтр отпусков нет</div>';
    return;
  }
  let html = '';
  const canEdit = canManageHr();
  list.forEach(v => {
    const initials = (v.employee_full_name || '').split(' ').map(w => (w[0] || '').toUpperCase()).slice(0, 2).join('');
    const rowCls = 'vac-list-row is-' + v.status;
    html += '<div class="' + rowCls + '">' +
      '<div class="vac-list-avatar">' + escapeHtml(initials || '?') + '</div>' +
      '<div class="vac-list-body">' +
        '<div class="vac-list-name">' + escapeHtml(v.employee_full_name || '—') +
          (v.employee_position ? ' <span style="font-weight: 400; color: var(--text-light); font-size: 12px;">· ' + escapeHtml(v.employee_position) + '</span>' : '') +
        '</div>' +
        '<div class="vac-list-meta">' +
          '<span><i class="ti ti-calendar"></i> ' + escapeHtml(formatVacDates(v.start_date, v.end_date)) + '</span>' +
          '<span><i class="ti ti-clock"></i> ' + v.days_total + ' дн.</span>' +
          (v.comment ? '<span><i class="ti ti-message"></i> ' + escapeHtml(v.comment) + '</span>' : '') +
        '</div>' +
      '</div>' +
      (canEdit
        ? '<div class="vac-list-actions">' +
            '<button class="btn-icon-action" onclick="openEditVacation(' + v.id + ')" title="Редактировать"><i class="ti ti-edit"></i></button>' +
            '<button class="btn-icon-warning" onclick="deleteVacation(' + v.id + ')" title="Удалить"><i class="ti ti-trash"></i></button>' +
          '</div>'
        : '') +
      '</div>';
  });
  body.innerHTML = html;
}

function setHrListFilter(f) {
  state.hrListFilter = f;
  document.querySelectorAll('[data-hr-list]').forEach(b => b.classList.toggle('active', b.dataset.hrList === f));
  renderHrList();
}

// ---- Календарь Кадров ----
async function loadHrCalendar() {
  const body = document.getElementById('hr-cal-body');
  if (!body) return;
  if (!state.hrCalMonth) {
    const now = new Date();
    state.hrCalMonth = { year: now.getFullYear(), month: now.getMonth() };
  }
  body.innerHTML = '<div class="loading-block">Загружаем…</div>';
  await loadAllVacations();
  renderHrCalendar();
}

function renderHrCalendar() {
  const el = document.getElementById('hr-cal-body');
  if (!el) return;
  const { year, month } = state.hrCalMonth;
  const titleEl = document.getElementById('hr-cal-title');
  if (titleEl) titleEl.textContent = 'Отпуска · ' + MONTH_NAMES_RU[month] + ' ' + year;

  const firstOfMonth = new Date(year, month, 1);
  let firstDow = firstOfMonth.getDay() - 1;
  if (firstDow < 0) firstDow = 6;
  const gridStart = new Date(year, month, 1 - firstDow);
  const today = new Date();
  const todayIso = isoDate(today);

  // События отпусков на диапазон
  const evByDate = {};
  (cache.vacationsAll || []).forEach(v => {
    const s = new Date(v.start_date);
    const e = new Date(v.end_date);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const iso = isoDate(d);
      if (!evByDate[iso]) evByDate[iso] = [];
      evByDate[iso].push(v);
    }
  });

  let html = '<div class="hr-cal-wrap"><div class="bigcal-grid">';
  DOW_NAMES_SHORT.forEach(d => html += '<div class="bigcal-dow">' + d + '</div>');
  const cell = new Date(gridStart);
  for (let i = 0; i < 42; i++) {
    const iso = isoDate(cell);
    const dayNum = cell.getDate();
    const dow = (i % 7);
    const isOutside = cell.getMonth() !== month;
    const isToday = iso === todayIso;
    const isWeekend = dow >= 5;
    const cls = ['bigcal-day'];
    if (isOutside) cls.push('is-outside');
    if (isToday) cls.push('is-today');
    if (isWeekend) cls.push('is-weekend');
    html += '<div class="' + cls.join(' ') + '">';
    html += '<div class="bigcal-day-num">' + dayNum + '</div>';
    const evs = evByDate[iso] || [];
    const maxShow = 3;
    evs.slice(0, maxShow).forEach(v => {
      const label = v.employee_short_name || v.employee_full_name || '?';
      html += '<div class="bigcal-event ev-vacation" title="' + escapeHtml(v.employee_full_name) + '" onclick="openEditVacation(' + v.id + ')">' + escapeHtml(label) + '</div>';
    });
    if (evs.length > maxShow) html += '<div class="bigcal-day-more">+ ещё ' + (evs.length - maxShow) + '</div>';
    html += '</div>';
    cell.setDate(cell.getDate() + 1);
  }
  html += '</div></div>';
  el.innerHTML = html;
}

function hrCalPrev() {
  if (!state.hrCalMonth) return;
  let { year, month } = state.hrCalMonth;
  month--;
  if (month < 0) { month = 11; year--; }
  state.hrCalMonth = { year, month };
  renderHrCalendar();
}
function hrCalNext() {
  if (!state.hrCalMonth) return;
  let { year, month } = state.hrCalMonth;
  month++;
  if (month > 11) { month = 0; year++; }
  state.hrCalMonth = { year, month };
  renderHrCalendar();
}
function hrCalToday() {
  const now = new Date();
  state.hrCalMonth = { year: now.getFullYear(), month: now.getMonth() };
  renderHrCalendar();
}

// ---- Создание/редактирование отпуска ----
async function openNewVacation() {
  if (!canManageHr()) { showToast('Доступно только бухгалтеру или директору', 'error'); return; }
  await ensureEmployeesLoaded();
  showVacationModal(null);
}

async function openEditVacation(vacId) {
  if (!canManageHr()) {
    // Просто просмотр
    try {
      const r = await fetch(API_BASE + '/api/vacations', {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem(TOKEN_KEY) },
      });
      const d = await r.json();
      const v = (d.vacations || []).find(x => x.id === vacId);
      if (!v) return;
      showVacationModal(v);
    } catch (e) {}
    return;
  }
  await ensureEmployeesLoaded();
  // Найти отпуск из кэша или загрузить
  let v = (cache.vacationsAll || []).find(x => x.id === vacId);
  if (!v) {
    try {
      const r = await fetch(API_BASE + '/api/vacations', {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem(TOKEN_KEY) },
      });
      const d = await r.json();
      v = (d.vacations || []).find(x => x.id === vacId);
    } catch (e) {}
  }
  if (!v) { showToast('Не удалось загрузить', 'error'); return; }
  showVacationModal(v);
}

function showVacationModal(v) {
  const isEdit = !!v;
  const canManage = canManageHr();
  const employees = cache.employeesAll || [];
  const m = document.getElementById('hr-modal');
  m.innerHTML =
    '<div class="modal modal-wide" onclick="event.stopPropagation()">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-beach"></i> ' + (isEdit ? 'Отпуск #' + v.id : 'Новый отпуск') + '</h3>' +
        '<button class="modal-close" onclick="closeHrModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content">' +
        '<div class="form-group"><label>Сотрудник *</label>' +
          '<select id="vac-employee" ' + (canManage ? '' : 'disabled') + '>' +
            '<option value="">— выбрать —</option>' +
            employees.map(e => '<option value="' + e.id + '"' + (isEdit && v.employee_id === e.id ? ' selected' : '') + '>' +
              escapeHtml(e.full_name) + (e.position ? ' · ' + escapeHtml(e.position) : '') + '</option>').join('') +
          '</select>' +
        '</div>' +
        '<div class="form-group form-row-2">' +
          '<div><label>Начало *</label><input type="date" id="vac-start" value="' + escapeHtml(isEdit ? v.start_date : '') + '" ' + (canManage ? '' : 'disabled') + '></div>' +
          '<div><label>Конец *</label><input type="date" id="vac-end" value="' + escapeHtml(isEdit ? v.end_date : '') + '" ' + (canManage ? '' : 'disabled') + '></div>' +
        '</div>' +
        '<div class="form-group"><label>Комментарий</label><textarea id="vac-comment" rows="2" ' + (canManage ? '' : 'disabled') + '>' + escapeHtml(isEdit ? v.comment : '') + '</textarea></div>' +
        (canManage ? '<div class="modal-actions"><button class="btn btn-primary" onclick="saveVacation(' + (isEdit ? v.id : 'null') + ')"><i class="ti ti-check"></i> Сохранить</button></div>' : '') +
      '</div>' +
    '</div>';
  m.classList.add('visible');
}

function closeHrModal() {
  document.getElementById('hr-modal').classList.remove('visible');
}

async function saveVacation(vacId) {
  const payload = {
    employee_id: parseInt(document.getElementById('vac-employee').value || '0') || null,
    start_date:  document.getElementById('vac-start').value,
    end_date:    document.getElementById('vac-end').value,
    comment:     document.getElementById('vac-comment').value.trim(),
  };
  if (!payload.employee_id) { showToast('Выберите сотрудника', 'error'); return; }
  if (!payload.start_date || !payload.end_date) { showToast('Укажите обе даты', 'error'); return; }
  if (payload.start_date > payload.end_date) { showToast('Дата начала позже конца', 'error'); return; }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const url = vacId ? '/api/vacations/' + vacId : '/api/vacations';
    const method = vacId ? 'PATCH' : 'POST';
    const r = await fetch(API_BASE + url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось', 'error');
      return;
    }
    showToast(vacId ? 'Сохранено' : 'Отпуск создан', 'success');
    closeHrModal();
    cache.vacationsAll = null;
    cache.homeVacations = null;
    // Перезагружаем текущий экран
    if (state.currentScreen === 'hr-vacations-timeline') loadHrTimeline();
    else if (state.currentScreen === 'hr-vacations-list') loadHrList();
    else if (state.currentScreen === 'hr-vacations-calendar') loadHrCalendar();
  } catch (e) {
    showToast('Ошибка', 'error');
  }
}

async function deleteVacation(vacId) {
  if (!confirm('Удалить этот отпуск?')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/vacations/' + vacId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) { showToast('Не удалось', 'error'); return; }
    showToast('Удалено', 'success');
    cache.vacationsAll = null;
    cache.homeVacations = null;
    if (state.currentScreen === 'hr-vacations-timeline') loadHrTimeline();
    else if (state.currentScreen === 'hr-vacations-list') loadHrList();
    else if (state.currentScreen === 'hr-vacations-calendar') loadHrCalendar();
  } catch (e) {
    showToast('Ошибка', 'error');
  }
}


function loadHelpKnowledge() {
  state.helpSearch = '';
  const input = document.getElementById('help-search');
  if (input) input.value = '';
  renderHelpKnowledge();
}

function onHelpSearchInput() {
  const input = document.getElementById('help-search');
  if (!input) return;
  clearTimeout(state.helpSearchTimer);
  state.helpSearchTimer = setTimeout(() => {
    state.helpSearch = input.value.trim().toLowerCase();
    renderHelpKnowledge();
  }, 200);
}

function renderHelpKnowledge() {
  const container = document.getElementById('help-knowledge-body');
  if (!container) return;
  const q = state.helpSearch;
  // Если идёт поиск — показываем плоский список совпадений
  if (q) {
    const matches = HELP_ARTICLES.filter(a =>
      a.title.toLowerCase().includes(q) ||
      a.summary.toLowerCase().includes(q) ||
      a.cat_label.toLowerCase().includes(q)
    );
    let html = '<div style="padding: 0 18px 16px;">';
    if (!matches.length) {
      html += '<div class="empty-block"><i class="ti ti-search-off"></i>Ничего не найдено по запросу «' + escapeHtml(q) + '»</div>';
    } else {
      html += '<div class="help-section-title">Найдено: ' + matches.length + '</div>';
      html += '<div class="help-grid">';
      matches.forEach(a => { html += renderHelpCard(a); });
      html += '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
    return;
  }
  // Обычный режим — по категориям
  let html = '<div style="padding: 0 18px 18px;">';
  // Идеи и доработки — ИИ-ассистент собирает ТЗ
  html += '<div onclick="openIdeasModal()" style="cursor:pointer;display:flex;align-items:center;gap:12px;background:linear-gradient(135deg,#EEF2FF,#F5F3FF);border:1px solid #C7D2FE;border-radius:14px;padding:14px 16px;margin-bottom:16px;">' +
      '<div style="font-size:26px;">💡</div>' +
      '<div style="flex:1;"><div style="font-weight:700;font-size:15px;">Идеи и доработки</div>' +
        '<div style="font-size:12.5px;color:var(--text-light);">Расскажи ИИ, что улучшить в программе — он уточнит детали и оформит заявку разработчику.</div></div>' +
      '<i class="ti ti-chevron-right" style="color:var(--brand);"></i>' +
    '</div>';
  HELP_CATEGORIES.forEach(cat => {
    const list = HELP_ARTICLES.filter(a => a.cat === cat.id);
    if (!list.length) return;
    html += '<div class="help-section-title"><i class="ti ' + cat.icon + '"></i>' + escapeHtml(cat.label) + '</div>';
    html += '<div class="help-grid">';
    list.forEach(a => { html += renderHelpCard(a); });
    html += '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

function renderHelpCard(a) {
  return '<div class="help-card" onclick="openHelpArticle(\'' + a.id + '\')">' +
    '<div class="hc-icon"><i class="ti ' + a.icon + '"></i></div>' +
    '<div class="hc-body">' +
      '<h4>' + escapeHtml(a.title) + '</h4>' +
      '<p>' + escapeHtml(a.summary) + '</p>' +
    '</div>' +
    '</div>';
}

// ============ Идеи / доработки (ИИ-ассистент) ============

function openIdeasModal() {
  let m = document.getElementById('ideas-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'ideas-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) m.classList.remove('visible'); };
    document.body.appendChild(m);
  }
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:560px;width:100%;display:flex;flex-direction:column;max-height:88vh;">' +
      '<div class="modal-header"><h3>💡 Идеи и доработки</h3>' +
        '<button class="modal-close" onclick="document.getElementById(\'ideas-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button></div>' +
      '<div style="display:flex;gap:8px;padding:10px 16px 0;">' +
        '<button class="btn btn-primary btn-small" onclick="ideasShowNew()"><i class="ti ti-bulb"></i> Предложить</button>' +
        '<button class="btn btn-secondary btn-small" onclick="ideasShowList()"><i class="ti ti-list"></i> Заявки</button>' +
      '</div>' +
      '<div id="ideas-body" style="flex:1;overflow-y:auto;padding:14px 16px;"></div>' +
      '<div id="ideas-foot" style="padding:12px 16px;border-top:1px solid var(--border);"></div>' +
    '</div>';
  m.classList.add('visible');
  ideasShowNew();
}

function ideasShowNew() {
  state.ideaThreadId = null;
  const body = document.getElementById('ideas-body');
  const foot = document.getElementById('ideas-foot');
  if (!body || !foot) return;
  body.innerHTML = '<div id="ideas-chat" style="display:flex;flex-direction:column;gap:8px;">' +
      '<div style="background:#F1F5F9;border-radius:10px;padding:8px 11px;font-size:13.5px;">Привет! Опиши, что хочешь улучшить или добавить в программе — я задам пару уточняющих вопросов и оформлю заявку разработчику.</div>' +
    '</div>';
  foot.innerHTML =
    '<textarea id="idea-input" class="form-input" rows="2" placeholder="Напиши идею…" style="margin-bottom:8px;"></textarea>' +
    '<div style="display:flex;gap:8px;">' +
      '<button class="btn btn-primary" style="flex:1;justify-content:center;" onclick="ideaSend()"><i class="ti ti-send"></i> Отправить</button>' +
      '<button class="btn btn-secondary" id="idea-compile-btn" style="display:none;" onclick="ideaCompile()"><i class="ti ti-file-check"></i> Сформировать ТЗ</button>' +
    '</div>';
}

function _ideaAddMsg(role, text) {
  const chat = document.getElementById('ideas-chat');
  if (!chat) return null;
  const mine = role === 'user';
  const div = document.createElement('div');
  div.style.cssText = 'border-radius:10px;padding:8px 11px;font-size:13.5px;white-space:pre-wrap;word-break:break-word;' +
    (mine ? 'background:var(--brand,#2563eb);color:#fff;align-self:flex-end;max-width:88%;' : 'background:#F1F5F9;max-width:92%;');
  div.textContent = text;
  chat.appendChild(div);
  const body = document.getElementById('ideas-body');
  if (body) body.scrollTop = body.scrollHeight;
  return div;
}

async function ideaSend() {
  const inp = document.getElementById('idea-input');
  if (!inp) return;
  const text = (inp.value || '').trim();
  if (!text) return;
  inp.value = '';
  _ideaAddMsg('user', text);
  const ph = _ideaAddMsg('assistant', '…');
  try {
    let d;
    if (!state.ideaThreadId) {
      const r = await apiPost('/api/ideas', { text });
      d = (r && r.data) || {};
      if (d.thread_id) state.ideaThreadId = d.thread_id;
    } else {
      const r = await apiPost('/api/ideas/' + state.ideaThreadId + '/message', { text });
      d = (r && r.data) || {};
    }
    if (ph) ph.textContent = d.reply || 'Принял.';
    const cb = document.getElementById('idea-compile-btn');
    if (cb && state.ideaThreadId) cb.style.display = '';
  } catch (e) {
    if (ph) ph.textContent = 'Ошибка связи';
  }
}

async function ideaCompile() {
  if (!state.ideaThreadId) { showToast('Сначала опиши идею', 'error'); return; }
  showToast('Собираю ТЗ…', 'info');
  try {
    const r = await apiPost('/api/ideas/' + state.ideaThreadId + '/compile', {});
    const d = (r && r.data) || {};
    if (!r.ok || !d.ok) { showToast((d && d.message) || 'Не удалось собрать ТЗ', 'error'); return; }
    _ideaAddMsg('assistant', 'Готово! Заявка оформлена и передана разработчику. Спасибо 🙌');
    if (d.spec) _ideaAddMsg('assistant', d.spec);
    const cb = document.getElementById('idea-compile-btn');
    if (cb) cb.style.display = 'none';
    showToast('ТЗ сохранено', 'success');
  } catch (e) { showToast('Ошибка', 'error'); }
}

async function ideasShowList() {
  const body = document.getElementById('ideas-body');
  const foot = document.getElementById('ideas-foot');
  if (!body) return;
  if (foot) foot.innerHTML = '';
  body.innerHTML = '<div style="color:var(--text-light);font-size:13px;">Загружаем…</div>';
  let d;
  try { d = await apiGet('/api/ideas'); } catch (e) { body.innerHTML = '<div style="color:var(--text-light);">Не удалось загрузить</div>'; return; }
  const ideas = (d && d.ideas) || [];
  const isDir = !!(d && d.is_director);
  state._ideasCache = ideas;
  if (!ideas.length) { body.innerHTML = '<div style="color:var(--text-light);font-size:13px;">Заявок пока нет. Нажми «Предложить» и опиши идею.</div>'; return; }
  let h = '';
  if (isDir) {
    const ready = ideas.filter(x => x.status === 'ready' && x.spec_text);
    if (ready.length) h += '<button class="btn btn-secondary btn-small" style="margin-bottom:10px;" onclick="ideasCopyAll()"><i class="ti ti-copy"></i> Скопировать все новые ТЗ (' + ready.length + ')</button>';
  }
  const stRu = { open: 'в работе с ИИ', ready: 'ТЗ готово', taken: 'взято в работу', done: 'сделано' };
  ideas.forEach(it => {
    h += '<div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px;">' +
      '<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;">' +
        '<div style="font-weight:600;font-size:13.5px;">' + escapeHtml(it.title || 'Идея') + '</div>' +
        '<span style="font-size:11px;color:var(--text-light);white-space:nowrap;">' + escapeHtml(stRu[it.status] || it.status) + '</span>' +
      '</div>' +
      '<div style="font-size:11.5px;color:var(--text-light);">' + escapeHtml(it.author_name || '') + '</div>' +
      (it.spec_text
        ? '<details style="margin-top:6px;"><summary style="cursor:pointer;font-size:12.5px;color:var(--brand);">Показать ТЗ</summary>' +
            '<pre style="white-space:pre-wrap;word-break:break-word;font-size:12px;background:#F8FAFC;border-radius:8px;padding:8px;margin-top:6px;">' + escapeHtml(it.spec_text) + '</pre>' +
            '<button class="btn btn-secondary btn-small" style="margin-top:6px;" onclick="ideaCopySpec(' + it.id + ')"><i class="ti ti-copy"></i> Скопировать ТЗ</button>' +
          '</details>'
        : '') +
    '</div>';
  });
  body.innerHTML = h;
}

function _ideaClipboard(txt) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(() => showToast('Скопировано')).catch(() => showToast('Скопируйте вручную'));
  } else { showToast('Скопируйте вручную'); }
}
function ideaCopySpec(id) {
  const it = (state._ideasCache || []).find(x => x.id === id);
  if (it && it.spec_text) _ideaClipboard(it.spec_text);
}
function ideasCopyAll() {
  const ready = (state._ideasCache || []).filter(x => x.status === 'ready' && x.spec_text);
  if (!ready.length) { showToast('Нет готовых ТЗ', 'info'); return; }
  const txt = ready.map((x, i) => '### Идея ' + (i + 1) + ' — ' + (x.title || '') + ' (автор: ' + (x.author_name || '') + ')\n' + x.spec_text).join('\n\n---\n\n');
  _ideaClipboard(txt);
}

function openHelpArticle(articleId) {
  const a = HELP_ARTICLES.find(x => x.id === articleId);
  if (!a) return;
  let bodyHtml = '';
  a.body.forEach(b => {
    if (b.p)    bodyHtml += '<p>' + b.p + '</p>';
    if (b.h)    bodyHtml += '<h4 class="help-h">' + escapeHtml(b.h) + '</h4>';
    if (b.ol)   bodyHtml += '<ol class="help-ol">' + b.ol.map(x => '<li>' + x + '</li>').join('') + '</ol>';
    if (b.ul)   bodyHtml += '<ul class="help-ul">' + b.ul.map(x => '<li>' + x + '</li>').join('') + '</ul>';
    if (b.note) bodyHtml += '<div class="help-note"><i class="ti ti-info-circle"></i><div>' + b.note + '</div></div>';
    // v2.44.40: кнопка запуска интерактивного гайда
    if (b.tour) {
      bodyHtml += '<div style="margin: 14px 0; text-align: center;">' +
        '<button class="btn btn-primary" style="font-size: 14px; padding: 10px 18px;" onclick="startTour(\'' +
        b.tour + '\')"><i class="ti ti-player-play"></i>' + escapeHtml(b.tour_label || 'Запустить гайд') +
      '</button></div>';
    }
  });

  const m = document.getElementById('help-modal');
  m.innerHTML =
    
    '<div class="modal modal-wide" onclick="event.stopPropagation()">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ' + a.icon + '"></i> ' + escapeHtml(a.title) + '</h3>' +
        '<button class="modal-close" onclick="closeHelpModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content help-article-body">' +
        '<div class="help-cat-label">' + escapeHtml(a.cat_label) + '</div>' +
        bodyHtml +
      '</div>' +
    '</div>';
  m.classList.add('visible');
}

function closeHelpModal() {
  document.getElementById('help-modal').classList.remove('visible');
}

// FAQ
function loadHelpFaq() {
  const container = document.getElementById('help-faq-body');
  if (!container) return;
  let html = '<div class="faq-list">';
  HELP_FAQ.forEach((f, idx) => {
    html += '<details class="faq-item">' +
      '<summary>' +
        '<span class="faq-q-num">' + (idx + 1) + '</span>' +
        '<span class="faq-q-text">' + escapeHtml(f.q) + '</span>' +
        '<i class="ti ti-chevron-down faq-chevron"></i>' +
      '</summary>' +
      '<div class="faq-answer">' + f.a + '</div>' +
      '</details>';
  });
  html += '</div>';
  container.innerHTML = html;
}

// Changelog
function loadHelpChangelog() {
  const container = document.getElementById('help-changelog-body');
  if (!container) return;
  let html = '<div class="cl-timeline">';
  HELP_CHANGELOG.forEach(v => {
    html += '<div class="cl-entry">' +
      '<div class="cl-marker"><i class="ti ti-sparkles"></i></div>' +
      '<div class="cl-body">' +
        '<div class="cl-head">' +
          '<span class="cl-version">' + escapeHtml(v.version) + '</span>' +
          '<span class="cl-date">' + escapeHtml(v.date) + '</span>' +
        '</div>' +
        '<div class="cl-title">' + escapeHtml(v.title) + '</div>' +
        '<ul class="cl-list">' + v.features.map(f => '<li>' + f + '</li>').join('') + '</ul>' +
      '</div>' +
      '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}


// ============ ПОМОЩНИК (v2.45.290) ============
// Чат-помощник по базе знаний. Path A: ищет ответ среди HELP_ARTICLES +
// HELP_FAQ прямо на устройстве (без внешнего ИИ, бесплатно, офлайн).
// Точка расширения под настоящий ИИ — _assistantAnswer(): когда появится
// бэкенд-эндпоинт, достаточно заменить локальный поиск на запрос к нему.

const ASSISTANT_STOPWORDS = new Set([
  'как','что','где','это','для','при','или','если','чтобы','можно','нужно','есть',
  'мне','я','ты','он','она','они','мы','вы','а','и','в','во','на','с','со','к','по',
  'от','до','за','из','о','об','же','ли','бы','не','ни','то','так','там','тут','уже',
  'был','была','быть','мой','моя','твой','его','их','наш','ваш','кто','чем','чём',
  'про','под','над','без','сделать','делать','хочу','надо'
]);

// Превращаем строку в набор значимых токенов (рус. леммы упрощённо — по корню)
function _assistantTokens(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .split(' ')
    .map(t => t.trim())
    .filter(t => t.length >= 3 && !ASSISTANT_STOPWORDS.has(t))
    // грубая нормализация окончаний — «договоры/договора/договор» → «договор»
    .map(t => t.length > 5 ? t.replace(/(ами|ями|ов|ам|ям|ах|ях|ыми|ими|ого|его|ую|ю|ы|и|а|е|у|о|й)$/,'') : t);
}

// Собираем весь поисковый текст статьи (заголовок, аннотация, тело — без HTML)
function _assistantArticleText(a) {
  let parts = [a.title || '', a.summary || '', a.cat_label || ''];
  (a.body || []).forEach(b => {
    if (b.p) parts.push(b.p);
    if (b.h) parts.push(b.h);
    if (b.note) parts.push(b.note);
    if (b.ol) parts.push(b.ol.join(' '));
    if (b.ul) parts.push(b.ul.join(' '));
  });
  return parts.join(' ').replace(/<[^>]+>/g, ' ');
}

// Скоринг релевантности по совпадению токенов (заголовок весит больше)
function _assistantScore(queryTokens, a) {
  if (!queryTokens.length) return 0;
  const titleTokens = new Set(_assistantTokens(a.title));
  const bodyTokens = new Set(_assistantTokens(_assistantArticleText(a)));
  let score = 0;
  queryTokens.forEach(qt => {
    if (titleTokens.has(qt)) score += 5;
    else if (bodyTokens.has(qt)) score += 2;
    else {
      // частичное совпадение по корню (вхождение)
      for (const bt of bodyTokens) { if (bt.indexOf(qt) >= 0 || qt.indexOf(bt) >= 0) { score += 1; break; } }
    }
  });
  return score;
}

// Тело статьи → HTML для вывода прямо в чат (как в openHelpArticle, но компактно)
function _assistantArticleBodyHtml(a) {
  let html = '';
  (a.body || []).forEach(b => {
    if (b.p)    html += '<p>' + b.p + '</p>';
    if (b.h)    html += '<h4 class="help-h">' + escapeHtml(b.h) + '</h4>';
    if (b.ol)   html += '<ol class="help-ol">' + b.ol.map(x => '<li>' + x + '</li>').join('') + '</ol>';
    if (b.ul)   html += '<ul class="help-ul">' + b.ul.map(x => '<li>' + x + '</li>').join('') + '</ul>';
    if (b.note) html += '<div class="help-note"><i class="ti ti-info-circle"></i><div>' + b.note + '</div></div>';
    if (b.tour) html += '<div style="margin:10px 0;"><button class="btn btn-primary btn-sm" onclick="closeAssistantChat();startTour(\'' + b.tour + '\')"><i class="ti ti-player-play"></i>' + escapeHtml(b.tour_label || 'Запустить гайд') + '</button></div>';
  });
  return html;
}

// Основной «мозг»: по тексту вопроса возвращает ответ-объект.
// СЮДА позже подключается настоящий ИИ (Path B) — заменить тело на вызов
// бэкенд-эндпоинта POST /api/assistant и оставить тот же формат результата.
function _assistantAnswer(query) {
  const qTokens = _assistantTokens(query);
  // Статьи
  const scored = (typeof HELP_ARTICLES !== 'undefined' ? HELP_ARTICLES : [])
    .map(a => ({ a, s: _assistantScore(qTokens, a) }))
    .filter(x => x.s > 0)
    .sort((x, y) => y.s - x.s);
  // FAQ
  const faqScored = (typeof HELP_FAQ !== 'undefined' ? HELP_FAQ : [])
    .map(f => {
      const ft = new Set(_assistantTokens(f.q + ' ' + f.a));
      let s = 0; qTokens.forEach(qt => { if (ft.has(qt)) s += 3; });
      return { f, s };
    })
    .filter(x => x.s > 0)
    .sort((x, y) => y.s - x.s);

  const best = scored[0];
  const bestFaq = faqScored[0];

  // Если FAQ заметно релевантнее — отвечаем им
  if (bestFaq && (!best || bestFaq.s >= best.s)) {
    return {
      type: 'faq',
      title: bestFaq.f.q,
      html: '<p>' + bestFaq.f.a + '</p>',
      related: scored.slice(0, 3).map(x => x.a),
    };
  }
  if (best && best.s >= 3) {
    return {
      type: 'article',
      article: best.a,
      title: best.a.title,
      html: _assistantArticleBodyHtml(best.a),
      related: scored.slice(1, 4).map(x => x.a),
    };
  }
  // Ничего уверенного — мягкий фолбэк + подсказки
  return {
    type: 'fallback',
    related: scored.slice(0, 4).map(x => x.a),
  };
}

// Стартовые подсказки — что можно спросить
const ASSISTANT_SUGGESTIONS = [
  'Как создать договор',
  'Как отметить брак или доработку',
  'Как принять товар от поставщика',
  'Как сделать отгрузку по QR',
  'Как поставить задачу сотруднику',
  'Что закупить — как это работает',
];

let _assistantHistory = []; // {role:'user'|'bot', html}

function openAssistantChat() {
  if (typeof closeSectionDrawer === 'function') { try { closeSectionDrawer(); } catch (e) {} }
  let modal = document.getElementById('assistant-modal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'assistant-modal';
  modal.className = 'modal-overlay visible';
  modal.style.zIndex = '400';
  modal.onclick = (e) => { if (e.target === modal) closeAssistantChat(); };
  modal.innerHTML =
    '<div class="modal asst-modal" onclick="event.stopPropagation()">' +
      '<div class="modal-header asst-header">' +
        '<h3><i class="ti ti-sparkles"></i> Помощник Atom</h3>' +
        (_assistantIsDev() ? '<button class="asst-mode-btn' + (_assistantCodeMode ? ' active' : '') + '" id="asst-mode-btn" onclick="_assistantToggleCode()" title="Режим разработчика: читать код">' +
          '<i class="ti ti-code"></i><span>Код</span></button>' : '') +
        '<button class="icon-btn" onclick="closeAssistantChat()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="asst-messages" id="asst-messages"></div>' +
      '<div class="asst-input-bar">' +
        '<input type="text" id="asst-input" placeholder="Спросите: как сделать…" ' +
          'onkeydown="if(event.key===\'Enter\'){event.preventDefault();assistantSend();}" autocomplete="off">' +
        '<button class="asst-send-btn" onclick="assistantSend()" title="Спросить"><i class="ti ti-send"></i></button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  // Приветствие (один раз за сессию модалки)
  const msgs = document.getElementById('asst-messages');
  if (_assistantHistory.length === 0) {
    let greet = '<p>Привет! Я помогу разобраться, как что устроено в Atom CRM. ' +
      'Напишите вопрос своими словами — подскажу по шагам и объясню, зачем функция нужна.</p>' +
      '<div class="asst-suggest-label">Например:</div>' +
      '<div class="asst-suggest-chips">' +
        ASSISTANT_SUGGESTIONS.map(s => '<button class="asst-chip" onclick="assistantAsk(' + JSON.stringify(s).replace(/"/g, '&quot;') + ')">' + escapeHtml(s) + '</button>').join('') +
      '</div>';
    _assistantPushBot(greet, false);
  } else {
    msgs.innerHTML = _assistantHistory.map(m => _assistantBubbleHtml(m)).join('');
  }
  _assistantScrollDown();
  setTimeout(() => { const i = document.getElementById('asst-input'); if (i) i.focus(); }, 120);
}

function closeAssistantChat() {
  const m = document.getElementById('assistant-modal');
  if (m) m.remove();
}

function _assistantBubbleHtml(m) {
  if (m.role === 'user') {
    return '<div class="asst-msg asst-msg-user"><div class="asst-bubble">' + escapeHtml(m.text) + '</div></div>';
  }
  return '<div class="asst-msg asst-msg-bot">' +
    '<div class="asst-avatar"><i class="ti ti-sparkles"></i></div>' +
    '<div class="asst-bubble">' + m.html + '</div>' +
  '</div>';
}

function _assistantPushUser(text) {
  _assistantHistory.push({ role: 'user', text });
  const msgs = document.getElementById('asst-messages');
  if (msgs) msgs.insertAdjacentHTML('beforeend', _assistantBubbleHtml({ role: 'user', text }));
  _assistantScrollDown();
}
function _assistantPushBot(html, store) {
  if (store !== false) _assistantHistory.push({ role: 'bot', html });
  const msgs = document.getElementById('asst-messages');
  if (msgs) msgs.insertAdjacentHTML('beforeend', _assistantBubbleHtml({ role: 'bot', html }));
  _assistantScrollDown();
}
function _assistantScrollDown() {
  const msgs = document.getElementById('asst-messages');
  if (msgs) requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
}

function assistantAsk(text) {
  const inp = document.getElementById('asst-input');
  if (inp) inp.value = text;
  assistantSend();
}

// v2.45.291: режим ИИ. null — не проверяли; true — бэкенд /api/assistant
// доступен; false — эндпоинта нет, работаем локальным поиском (Path A).
let _assistantAiMode = null;
const ASSISTANT_API_PATH = '/api/assistant';

// Топ-N статей по релевантности — отдаём бэкенду как контекст (RAG на клиенте:
// база знаний остаётся во фронте, бэкенд лишь передаёт её Claude вместе с вопросом)
function _assistantTopArticles(query, n) {
  const qTokens = _assistantTokens(query);
  return (typeof HELP_ARTICLES !== 'undefined' ? HELP_ARTICLES : [])
    .map(a => ({ a, s: _assistantScore(qTokens, a) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, n)
    .map(x => x.a);
}

function _assistantStripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Мини-markdown → HTML (жирный, списки, код, абзацы). Вход экранируется.
function _assistantMdToHtml(md) {
  const esc = escapeHtml(String(md || '').trim());
  const lines = esc.split(/\r?\n/);
  let html = '';
  let listType = null; // 'ol' | 'ul' | null
  const closeList = () => { if (listType) { html += '</' + listType + '>'; listType = null; } };
  const inline = (s) => s
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  lines.forEach(raw => {
    const line = raw.trim();
    if (!line) { closeList(); return; }
    const ol = line.match(/^(\d+)[.)]\s+(.*)$/);
    const ul = line.match(/^[-•*]\s+(.*)$/);
    if (ol) {
      if (listType !== 'ol') { closeList(); html += '<ol class="help-ol">'; listType = 'ol'; }
      html += '<li>' + inline(ol[2]) + '</li>';
    } else if (ul) {
      if (listType !== 'ul') { closeList(); html += '<ul class="help-ul">'; listType = 'ul'; }
      html += '<li>' + inline(ul[1]) + '</li>';
    } else {
      closeList();
      const h = line.match(/^#{1,4}\s+(.*)$/);
      if (h) html += '<h4 class="help-h">' + inline(h[1]) + '</h4>';
      else   html += '<p>' + inline(line) + '</p>';
    }
  });
  closeList();
  return html;
}

// Запрос к настоящему ИИ на бэкенде. Кидает исключение, если эндпоинта нет
// или ответ пустой — тогда вызывающий код откатывается на локальный поиск.
async function _assistantAskBackend(query) {
  const token = localStorage.getItem(TOKEN_KEY) || '';
  const context = _assistantTopArticles(query, 5).map(a => ({
    id: a.id,
    title: a.title,
    text: _assistantArticleText(a).slice(0, 1600),
  }));
  const history = _assistantHistory.slice(-6).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    text: m.role === 'user' ? m.text : _assistantStripHtml(m.html),
  }));
  const resp = await fetch(API_BASE + ASSISTANT_API_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ question: query, context, history }),
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const data = await resp.json();
  const answer = data.answer || data.text || data.message || (data.data && data.data.answer);
  if (!answer) throw new Error('empty');
  return { answer: String(answer), sources: data.sources || [] };
}

function _assistantRelatedHtml(articles, label) {
  if (!articles || !articles.length) return '';
  return '<div class="asst-related-label">' + escapeHtml(label) + '</div><div class="asst-related">' +
    articles.map(a => '<button class="asst-related-item" onclick="assistantOpenArticle(' + JSON.stringify(a.id).replace(/"/g, '&quot;') + ')"><i class="ti ' + a.icon + '"></i><span>' + escapeHtml(a.title) + '</span><i class="ti ti-chevron-right"></i></button>').join('') +
  '</div>';
}

// Локальный ответ (Path A) — фолбэк, когда бэкенд-ИИ недоступен
function _assistantLocalAnswerHtml(q) {
  const ans = _assistantAnswer(q);
  if (ans.type === 'fallback') {
    let html = '<p>Не нашёл точного ответа на этот вопрос 🤔 Но вот что может подойти — или загляните в раздел <b>Помощь</b>:</p>';
    if (ans.related.length) {
      html += '<div class="asst-related">' +
        ans.related.map(a => '<button class="asst-related-item" onclick="assistantOpenArticle(' + JSON.stringify(a.id).replace(/"/g, '&quot;') + ')"><i class="ti ' + a.icon + '"></i><span>' + escapeHtml(a.title) + '</span><i class="ti ti-chevron-right"></i></button>').join('') +
      '</div>';
    }
    html += '<div style="margin-top:10px;"><button class="btn btn-secondary btn-sm" onclick="closeAssistantChat();selectSidebarItem(\'help-knowledge\')"><i class="ti ti-book"></i> Открыть Помощь</button></div>';
    return html;
  }
  let html = '<div class="asst-answer-title"><i class="ti ti-bulb"></i>' + escapeHtml(ans.title) + '</div>' + ans.html;
  if (ans.type === 'article' && ans.article) {
    html += '<div class="asst-answer-foot"><button class="btn btn-secondary btn-sm" onclick="assistantOpenArticle(' + JSON.stringify(ans.article.id).replace(/"/g, '&quot;') + ')"><i class="ti ti-external-link"></i> Открыть в Помощи</button></div>';
  }
  html += _assistantRelatedHtml(ans.related, 'Похожее:');
  return html;
}

// ===== Режим кода (для директора): помощник читает живой код бэкенда =====
var _assistantCodeMode = false;

function _assistantIsDev() {
  try { return !!(state && state.user && (state.user.roles || []).indexOf('director') >= 0); }
  catch (e) { return false; }
}

function _assistantToggleCode() {
  _assistantCodeMode = !_assistantCodeMode;
  const btn = document.getElementById('asst-mode-btn');
  if (btn) btn.classList.toggle('active', _assistantCodeMode);
  const inp = document.getElementById('asst-input');
  if (inp) inp.placeholder = _assistantCodeMode ? 'Спросите про логику кода…' : 'Спросите: как сделать…';
  _assistantPushBot(_assistantCodeMode
    ? '<p><b>Режим кода включён.</b> Спросите про логику бэкенда — найду и прочитаю нужные места в коде и объясню. Это медленнее и дороже обычных вопросов.</p>'
    : '<p>Режим кода выключен — снова отвечаю по базе знаний.</p>');
}

async function _assistantSendCode(q) {
  const thinkingId = 'asst-think-' + Date.now();
  _assistantPushBot('<span class="asst-thinking" id="' + thinkingId + '"><i class="ti ti-loader-2"></i> Читаю код…</span>', false);
  const removeThinking = () => { const t = document.getElementById(thinkingId); if (t) { const b = t.closest('.asst-msg'); if (b) b.remove(); } };
  const history = _assistantHistory.slice(-6).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    text: m.role === 'user' ? m.text : _assistantStripHtml(m.html),
  }));
  try {
    const res = await apiPost('/api/assistant/code', { question: q, history });
    removeThinking();
    if (!res.ok) {
      const msg = res.status === 403 ? 'Режим кода доступен только директору.'
        : ((res.data && res.data.message) || ('HTTP ' + res.status));
      _assistantPushBot('<p>' + escapeHtml(msg) + '</p>');
      return;
    }
    const d = res.data || {};
    let html = '<div class="asst-answer-title"><i class="ti ti-code"></i>Atom AI · код</div>' + _assistantMdToHtml(d.answer || '');
    if (d.files && d.files.length) {
      html += '<div class="asst-related-label">Прочитано в коде:</div><div class="asst-files">' +
        d.files.map(f => '<span class="asst-file"><i class="ti ti-file-text"></i>' + escapeHtml(f) + '</span>').join('') + '</div>';
    }
    _assistantPushBot(html);
  } catch (e) {
    removeThinking();
    _assistantPushBot('<p>' + escapeHtml('Не удалось: ' + (e.message || '')) + '</p>');
  }
}

async function assistantSend() {
  const inp = document.getElementById('asst-input');
  if (!inp) return;
  const q = (inp.value || '').trim();
  if (!q) return;
  inp.value = '';
  _assistantPushUser(q);

  if (_assistantCodeMode) { await _assistantSendCode(q); return; }

  const thinkingId = 'asst-think-' + Date.now();
  const thinkingLabel = (_assistantAiMode === false) ? 'Ищу в инструкциях…' : 'Думаю…';
  _assistantPushBot('<span class="asst-thinking" id="' + thinkingId + '"><i class="ti ti-loader-2"></i> ' + thinkingLabel + '</span>', false);
  const removeThinking = () => {
    const t = document.getElementById(thinkingId);
    if (t) { const b = t.closest('.asst-msg'); if (b) b.remove(); }
  };

  // 1) Настоящий ИИ на бэкенде — пробуем на КАЖДЫЙ вопрос (самовосстановление:
  //    если ИИ был недоступен и снова поднялся, помощник «поумнеет» без перезагрузки).
  try {
    const res = await _assistantAskBackend(q);
    removeThinking();
    let html = '<div class="asst-answer-title"><i class="ti ti-sparkles"></i>Atom AI</div>' + _assistantMdToHtml(res.answer);
    const srcArticles = (res.sources || [])
      .map(s => (typeof HELP_ARTICLES !== 'undefined' ? HELP_ARTICLES : []).find(a => a.id === (s.id || s)))
      .filter(Boolean);
    html += _assistantRelatedHtml(srcArticles, 'Источники:');
    _assistantPushBot(html);
    return;
  } catch (e) {
    // ИИ сейчас недоступен — честный разовый откат на локальный поиск (без залипания)
    removeThinking();
    _assistantPushBot(
      '<div class="asst-ai-down"><i class="ti ti-alert-triangle"></i> Умный помощник сейчас недоступен — показываю из инструкций (может быть неточно):</div>' +
      _assistantLocalAnswerHtml(q)
    );
    return;
  }
}

function assistantOpenArticle(articleId) {
  closeAssistantChat();
  // help-modal — постоянный элемент, открывается из любого экрана
  if (typeof openHelpArticle === 'function') openHelpArticle(articleId);
}


// ============ ЭТАП 39 (v2.19.0): ПУБЛИКАЦИЯ ДОГОВОРА ============

async function publishContract(contractId) {
  if (!contractId) return;
  const contract = state.lastLoadedContract;
  const num = contract ? contract.number : ('#' + contractId);
  if (!confirm(
    'Опубликовать договор ' + num + '?\n\n' +
    'Все сотрудники увидят его в производстве. Свободные сборки и комплектующие ' +
    'на складе будут автоматически зарезервированы под этот договор.'
  )) {
    return;
  }

  const btn = document.querySelector('.publish-contract-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader"></i>Публикуем…'; }

  try {
    const r = await apiPost('/api/contracts/' + contractId + '/publish', {});
    const body = (r && r.data) || {};
    if (r && r.ok && body.ok) {
      // Показываем итог авторезерва
      const rep = body.reservation || {};
      const reservedAsm = (rep.reserved_assemblies || []).length;
      const reservedComp = (rep.reserved_components || []).length;
      const needMake = (rep.need_to_make || []).reduce((a, x) => a + (x.qty_short || 0), 0);
      const needBuy = (rep.need_to_buy || []).reduce((a, x) => a + (x.qty_short || 0), 0);
      const parts = [];
      if (reservedAsm) parts.push('зарезервировано сборок: ' + reservedAsm);
      if (reservedComp) parts.push('комплектующих: ' + reservedComp);
      if (needMake > 0) parts.push('на сборку: ' + needMake);
      if (needBuy > 0) parts.push('к закупке: ' + needBuy);
      const msg = parts.length ? ('Опубликовано · ' + parts.join(' · ')) : 'Договор опубликован';
      showToast(msg, 'success');
      // Перезагружаем карточку
      if (typeof loadContractDetail === 'function') {
        loadContractDetail(contractId);
      } else {
        // fallback — общий рефреш
        refreshCurrentScreen();
      }
    } else {
      const errMsg = body.message || 'Не удалось опубликовать';
      showToast(errMsg, 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-rocket"></i>Опубликовать договор'; }
    }
  } catch (e) {
    const msg = (e && e.message) ? e.message : 'Ошибка публикации';
    showToast(msg, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-rocket"></i>Опубликовать договор'; }
  }
}

// ============ ЭТАП 42.2 (v2.20.0): РУЧНАЯ ПЕРЕСБОРКА РЕЗЕРВОВ ============
async function rebuildReservations() {
  if (!confirm('Пересобрать резервы по всем активным договорам?\n\nЭто откатит лишние резервы и попробует привязать свободные сборки к открытым договорам.')) {
    return;
  }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/admin/rebuild-reservations', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      if (r.status === 404) {
        showToast('Endpoint не найден. Бэкенд ещё не задеплоен с новой версией.', 'error');
        return;
      }
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось пересобрать резервы', 'error');
      return;
    }
    const d = await r.json();
    cache.contracts = null;
    cache.contractsWithProgress = null;
    cache.warehouseStock = null;
    showRebuildDiagnosticsModal(d);
    loadCurrentContract();
  } catch (e) {
    showToast('Ошибка соединения: ' + String(e), 'error');
  }
}

function showRebuildDiagnosticsModal(data) {
  const diag = (data && data.diagnostics) || [];
  const cleaned = (data && data.cleaned_pairs) || 0;
  const reserved = (data && data.reserved_assemblies) || 0;

  let m = document.getElementById('rebuild-diag-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'rebuild-diag-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) m.classList.remove('visible'); };
    document.body.appendChild(m);
  }

  // Сортируем: сначала over-reserved
  diag.sort((a, b) => (b.is_over ? 1 : 0) - (a.is_over ? 1 : 0));

  let rows = '';
  if (diag.length === 0) {
    rows = '<div style="padding:14px;text-align:center;color:var(--text-light);">' +
           'В БД нет ни одной model_id-позиции в активных договорах</div>';
  } else {
    diag.forEach(d => {
      const isOver = !!d.is_over;
      const statusOk = !!d.contract_status_passes_filter;
      const bgColor = isOver ? '#fef2f2' : (statusOk ? '#f0fdf4' : '#fafafa');
      const borderColor = isOver ? '#fca5a5' : (statusOk ? '#86efac' : 'var(--border)');
      const needed = Number(d.needed) || 0;
      const reservedQty = Number(d.reserved) || 0;
      const status = d.contract_status || '—';
      rows +=
        '<div style="padding:10px 12px;border-bottom:1px solid var(--border);background:' + bgColor +
        ';border-left:3px solid ' + borderColor + ';margin-bottom:4px;border-radius:6px;font-size:13px;">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
            '<b>' + escapeHtml(d.contract_number || '#' + d.contract_id) + '</b> · ' +
            escapeHtml(d.model_article || '') + ' ' + escapeHtml(d.model_name || '') +
          '</div>' +
          '<div style="display:flex;gap:14px;font-size:12px;color:var(--text-mid);flex-wrap:wrap;">' +
            '<span>нужно: <b>' + needed + '</b></span>' +
            '<span>в резерве: <b>' + reservedQty + '</b> (' + (d.reserve_count || 0) + ' сборок)</span>' +
            '<span>статус договора: <code>' + escapeHtml(status) + '</code>' +
              (statusOk ? ' ✓' : ' <span style="color:#dc2626;">не попадает в фильтр!</span>') + '</span>' +
            (isOver ? '<span style="color:#dc2626;font-weight:600;">⚠ ОВЕР-РЕЗЕРВ +' + (reservedQty - needed) + '</span>' : '') +
          '</div>' +
        '</div>';
    });
  }

  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:700px;max-height:90vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-refresh"></i> Пересборка резервов — диагностика</h3>' +
        '<button class="modal-close" onclick="document.getElementById(\'rebuild-diag-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:14px 18px;background:#f8fafc;border-bottom:1px solid var(--border);">' +
        '<div style="font-size:13px;line-height:1.5;">' +
          '<b>Откачено лишних резервов:</b> ' + cleaned + '<br>' +
          '<b>Зарезервировано свободных сборок:</b> ' + reserved +
        '</div>' +
      '</div>' +
      '<div style="padding:10px;overflow-y:auto;flex:1;">' +
        '<div style="font-size:11px;color:var(--text-light);text-transform:uppercase;margin-bottom:8px;letter-spacing:0.4px;">' +
          'Все model_id-позиции активных договоров (' + diag.length + ')' +
        '</div>' +
        rows +
      '</div>' +
      '<div style="padding:12px 18px;border-top:1px solid var(--border);text-align:right;">' +
        '<button class="secondary-btn" onclick="document.getElementById(\'rebuild-diag-modal\').classList.remove(\'visible\')">Закрыть</button>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
}


// v2.45.117: кеш проверенного пароля на 10 минут — чтобы не задалбывать
// при каждой смене статуса. После успешной проверки храним пароль в памяти;
// последующие действия не показывают модалку. По logout / reload — сбрасывается.
const _PWD_CACHE_TTL_MS = 10 * 60 * 1000;   // 10 минут
let _cachedPassword = null;
let _cachedPasswordAt = 0;
function _getCachedPassword() {
  if (!_cachedPassword) return null;
  if (Date.now() - _cachedPasswordAt > _PWD_CACHE_TTL_MS) {
    _cachedPassword = null;
    return null;
  }
  return _cachedPassword;
}
function _setCachedPassword(pw) {
  _cachedPassword = pw;
  _cachedPasswordAt = Date.now();
}
function _clearCachedPassword() {
  _cachedPassword = null;
  _cachedPasswordAt = 0;
}

// v2.45.106: модалка подтверждения паролем для критичных действий.
// Возвращает строку-пароль (если введён и нажат «Подтвердить»), либо null (отмена).
// v2.45.117: если пароль уже проверен в последние 10 мин — возвращаем кеш без модалки.
function _promptPasswordForAction(title, subtitle) {
  const cached = _getCachedPassword();
  if (cached !== null) {
    // Возвращаем сразу — без вопроса. Пароль уже верный (был принят бэком).
    return Promise.resolve(cached);
  }
  return new Promise((resolve) => {
    let m = document.getElementById('pwd-confirm-modal');
    if (m) m.remove();
    m = document.createElement('div');
    m.id = 'pwd-confirm-modal';
    m.className = 'modal-overlay visible';
    m.innerHTML =
      '<div class="modal" onclick="event.stopPropagation()" style="max-width:460px;">' +
        '<div class="modal-header">' +
          '<h3><i class="ti ti-shield-lock"></i> Подтвердить</h3>' +
          '<button class="modal-close" id="pwd-close"><i class="ti ti-x"></i></button>' +
        '</div>' +
        '<div style="padding:16px 20px;">' +
          '<div style="font-size:14px;color:var(--text-dark);font-weight:600;margin-bottom:6px;">' +
            (title || 'Действие') + '</div>' +
          '<div style="font-size:12.5px;color:var(--text-mid);margin-bottom:14px;line-height:1.5;">' +
            (subtitle || '') + '</div>' +
          '<label style="font-size:11.5px;color:var(--text-mid);display:block;margin-bottom:4px;">' +
            'Твой пароль <span style="color:var(--text-light);font-weight:400;">(если у тебя его нет — оставь пустым)</span>' +
          '</label>' +
          '<input type="password" id="pwd-input" placeholder="••••••" autocomplete="current-password" ' +
            'style="width:100%;font-size:15px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;letter-spacing:0.05em;" />' +
        '</div>' +
        '<div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;background:white;border-radius:0 0 12px 12px;">' +
          '<button class="btn btn-secondary" id="pwd-cancel">Отмена</button>' +
          '<button class="btn btn-primary"   id="pwd-ok"><i class="ti ti-check"></i> Подтвердить</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(m);
    const cleanup = (val) => { m.remove(); resolve(val); };
    const input = m.querySelector('#pwd-input');
    setTimeout(() => input && input.focus(), 50);
    m.querySelector('#pwd-close').onclick  = () => cleanup(null);
    m.querySelector('#pwd-cancel').onclick = () => cleanup(null);
    m.onclick = (e) => { if (e.target === m) cleanup(null); };
    // v2.45.112: бэк сам решит — если у сотрудника есть password_hash,
    // он отклонит пустой пароль с 401. Если нет — пропустит. Фронт просто
    // отправляет введённое (даже пустое).
    const submit = () => {
      const v = (input.value || '').trim();
      cleanup(v);
    };
    m.querySelector('#pwd-ok').onclick = submit;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      else if (e.key === 'Escape') cleanup(null);
    });
  });
}

async function changeContractStatus(contractId, newStatus) {
  // ЭТАП 38 (v2.18.0): проверяем что статус реально меняется (не клик по текущему)
  const currentContract = state.lastLoadedContract;
  if (currentContract && currentContract.id === contractId && currentContract.status === newStatus) {
    return;  // клик по уже активному статусу — игнорируем
  }
  // ЭТАП 38 (v2.18.0): универсальное подтверждение перед сменой статуса
  const labels = {
    'production': 'В производстве',
    'ready': 'Готов к отгрузке',
    'partially_shipped': 'Отгружен частично',
    'shipped': 'Отгружен',
    'closed': 'Закрыт',
  };
  const targetLabel = labels[newStatus] || newStatus;
  const contractNumber = currentContract ? currentContract.number : ('#' + contractId);
  // v2.45.106: подтверждение паролем (объединяем подтверждение и пароль в одной модалке)
  const password = await _promptPasswordForAction(
    'Сменить статус договора ' + contractNumber + ' на «' + targetLabel + '»?',
    'Подтверди личным паролем — событие будет записано в журнал договора.'
  );
  if (password === null) return;   // пользователь отменил
  // ЭТАП 26.1: если закрываем — проверяем прогресс отгрузки, чтобы дать понятное предупреждение
  let forceClose = false;
  if (newStatus === 'closed') {
    try {
      const s = await apiGet('/api/contracts/' + contractId + '/shipment-status');
      const total = (s && s.total) || 0;
      const shipped = (s && s.shipped) || 0;
      if (total > 0 && shipped < total) {
        showToast(
          'Нельзя закрыть: отгружено ' + shipped + ' из ' + total +
          '. Сначала отгрузите остаток.',
          'error'
        );
        return;
      }
      if (total === 0) {
        // Договор без сборок/коробок — спрашиваем подтверждение, разрешаем закрыть
        if (!confirm(
          'У договора нет сборок или коробок к отгрузке.\n\n' +
          'Точно закрыть договор?'
        )) {
          return;
        }
        forceClose = true; // на всякий случай — чтобы бэк не блокировал даже теоретически
      }
    } catch (e) {
      // Если статус-endpoint не отвечает — продолжаем, бэк отвалидирует сам
    }
  }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/contracts/' + contractId, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify(Object.assign(
        { status: newStatus, password: password },
        forceClose ? { force_close: true } : {}
      )),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      // v2.45.106: неверный пароль / нет пароля
      if (r.status === 401 && d.error === 'password_required') {
        showToast('Нужно подтвердить паролем', 'error');
        return;
      }
      if (r.status === 403 && d.error === 'wrong_password') {
        // v2.45.117: неверный пароль — сбросим кеш чтобы попросить снова
        if (typeof _clearCachedPassword === 'function') _clearCachedPassword();
        showToast('Неверный пароль — статус не изменён', 'error');
        return;
      }
      // ЭТАП 26.1: 409 с error=shipment_incomplete — отдельное понятное сообщение
      if (r.status === 409 && d.error === 'shipment_incomplete') {
        showToast(d.message || 'Сначала отгрузите остаток', 'error');
        return;
      }
      // ЭТАП 40 (v2.20.0): 409 с error=items_not_ready — открываем модалку blockers
      if (r.status === 409 && d.error === 'items_not_ready') {
        openShippingBlockersModal(contractId, d.readiness || {}, d.message || '');
        return;
      }
      showToast(d.message || 'Не удалось изменить статус', 'error');
      return;
    }
    showToast('Статус изменён', 'success');
    // v2.45.117: пароль точно верный — кешируем на 10 минут
    if (password && typeof _setCachedPassword === 'function') {
      _setCachedPassword(password);
    }
    cache.contracts = null;
    cache.contractsCounts = null;
    loadCurrentContract();
  } catch (e) {
    showToast('Ошибка соединения: ' + String(e), 'error');
  }
}

// ============ ЭТАП 40 (v2.20.0): МОДАЛКА БЛОКЕРОВ ОТГРУЗКИ ============
// Открывается когда бэк возвращает 409 items_not_ready при попытке поставить shipped.
// Показывает список незавершённых позиций и предлагает два пути:
//   1) Всё равно отгрузить (force_ship=true) — обходит блокировку
//   2) Отгрузить частично (status=partially_shipped) — мягкий шаг
function openShippingBlockersModal(contractId, readiness, message) {
  const blockers = (readiness && readiness.blockers) || [];
  const total = (readiness && readiness.items_total) || 0;
  const ready = (readiness && readiness.items_ready) || 0;

  let m = document.getElementById('shipping-blockers-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'shipping-blockers-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) closeShippingBlockersModal(); };
    document.body.appendChild(m);
  }

  let blockerRowsHtml = '';
  if (blockers.length) {
    blockers.forEach(b => {
      const need = (b.qty_need !== undefined && b.qty_need !== null) ? b.qty_need : '?';
      const have = (b.qty_have !== undefined && b.qty_have !== null) ? b.qty_have : 0;
      blockerRowsHtml +=
        '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border);">' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-weight:500;color:var(--text);">' + escapeHtml(b.item_name || 'Позиция #' + b.item_id) + '</div>' +
            '<div style="font-size:12px;color:var(--text-light);margin-top:2px;">' + escapeHtml(b.reason || '') + '</div>' +
          '</div>' +
          '<div style="font-size:13px;font-weight:600;color:#b45309;white-space:nowrap;">' +
            escapeHtml(String(have)) + ' / ' + escapeHtml(String(need)) +
          '</div>' +
        '</div>';
    });
  } else {
    blockerRowsHtml = '<div style="padding:14px;color:var(--text-light);text-align:center;">Бэкенд не вернул детали блокеров.</div>';
  }

  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:560px;max-height:90vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-alert-triangle" style="color:#f59e0b;"></i> Не все позиции готовы</h3>' +
        '<button class="modal-close" onclick="closeShippingBlockersModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:14px 18px 8px 18px;">' +
        '<div style="background:#fef3c7;color:#92400e;padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.4;">' +
          '<b>Готово ' + ready + ' из ' + total + ' позиций.</b><br>' +
          escapeHtml(message || 'Используйте «Отгрузить частично», если нужно отгрузить только готовые.') +
        '</div>' +
      '</div>' +
      '<div style="overflow-y:auto;flex:1;border-top:1px solid var(--border);">' +
        blockerRowsHtml +
      '</div>' +
      '<div style="padding:14px 18px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:10px;background:#fafbfc;">' +
        '<button class="ship-action-btn ship-partial" onclick="doShippingAction(' + contractId + ', \'partial\')">' +
          '<div class="sa-icon"><i class="ti ti-package-export"></i></div>' +
          '<div class="sa-body">' +
            '<div class="sa-title">Отгрузить частично</div>' +
            '<div class="sa-sub">Отгрузим только готовые позиции, остаток — позже</div>' +
          '</div>' +
          '<i class="ti ti-chevron-right sa-arrow"></i>' +
        '</button>' +
        '<button class="ship-action-btn ship-force" onclick="doShippingAction(' + contractId + ', \'force\')">' +
          '<div class="sa-icon"><i class="ti ti-alert-octagon"></i></div>' +
          '<div class="sa-body">' +
            '<div class="sa-title">Всё равно отгрузить</div>' +
            '<div class="sa-sub">Игнорировать блокировку и закрыть отгрузку</div>' +
          '</div>' +
          '<i class="ti ti-chevron-right sa-arrow"></i>' +
        '</button>' +
        '<button class="ship-action-btn ship-cancel" onclick="closeShippingBlockersModal()">' +
          '<div class="sa-title">Отмена</div>' +
        '</button>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
}

function closeShippingBlockersModal() {
  const m = document.getElementById('shipping-blockers-modal');
  if (m) m.classList.remove('visible');
}

async function doShippingAction(contractId, mode) {
  // mode === 'partial' → ставим status=partially_shipped
  // mode === 'force'   → ставим status=shipped с force_ship=true
  const body = (mode === 'partial')
    ? { status: 'partially_shipped' }
    : { status: 'shipped', force_ship: true };
  const confirmMsg = (mode === 'partial')
    ? 'Перевести договор в «Отгружен частично»?'
    : 'Отгрузить договор несмотря на блокеры?';
  if (!confirm(confirmMsg)) return;
  // v2.45.199: смена статуса договора — под личным паролём
  const _pwd = await _promptPasswordForAction(
    confirmMsg,
    'Подтверди личным паролём — изменение договора защищено.'
  );
  if (_pwd === null) return;   // отменили
  body.password = _pwd;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/contracts/' + contractId, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      if ((r.status === 401 || r.status === 403) && typeof _clearCachedPassword === 'function') {
        _clearCachedPassword();
      }
      showToast(d.message || 'Не удалось изменить статус', 'error');
      return;
    }
    closeShippingBlockersModal();
    showToast(mode === 'partial' ? 'Договор переведён в «Отгружен частично»' : 'Договор отгружен (force)', 'success');
    cache.contracts = null;
    cache.contractsCounts = null;
    loadCurrentContract();
  } catch (e) {
    showToast('Ошибка соединения: ' + String(e), 'error');
  }
}

// --------- ФОРМА ДОГОВОРА (новый / редактирование) ----------

function openNewContract() {
  if (!canManageSales()) {
    showToast('Создавать договоры может директор, зам или менеджер', 'error');
    return;
  }
  state.contractFormMode = 'new';
  state.currentContractId = null;
  state.contractForm = {
    number: '', sign_date: todayIso(), contractor_id: null, contract_type: 'supply',
    legal_entity: 'ooo_atomus', sum_amount: '', delivery_date: '',
    delivery_address: '', manager_id: null, comment: '',
    payment_date: '',  // ЭТАП 37
    working_days: null, _delivery_manual: false,  // ЭТАП 36.3
    days_type: 'working',  // v2.43.67: 'working' (рабочие) | 'calendar' (календарные)
    co_managers: [],  // v2.45.188: доп. менеджеры [{id, name}]
  };
  // Авто-черновик: восстановим незаконченный новый договор, если он есть
  state.contractDraftRestored = false;
  const _cd = (typeof _draftLoad === 'function') ? _draftLoad(CONTRACT_DRAFT_KEY) : null;
  if (_cd) {
    state.contractForm = Object.assign(state.contractForm, _cd);
    state.contractDraftRestored = true;
  }
  selectSidebarItem('sales-contract-form');
}

function discardContractDraft() {
  if (typeof _draftClear === 'function') _draftClear(CONTRACT_DRAFT_KEY);
  state.contractDraftRestored = false;
  openNewContract();   // пере-открываем чистую форму (черновик уже удалён)
  showToast('Черновик очищен', 'info');
}

// ЭТАП 21: QR из карточки договора (вызывается из шапки sales-contract-detail)
function showContractQrFromDetail() {
  const c = state.lastLoadedContract;
  if (!c || !c.id) {
    showToast('Договор не загружен', 'error');
    return;
  }
  showContractQr(c.id, c.number || '#' + c.id, c.contractor_name || '');
}

// v2.43.6: kebab-меню действий с договором для мобильной шапки.
// На десктопе кнопки QR/Чат/Доработка/Монтажнику/Редактировать/Удалить лежат в page-header.
// На мобиле этот page-header скрыт CSS — поэтому собираем те же действия в простое меню.
function openContractMobileActions(anchorEl) {
  const c = state.lastLoadedContract;
  if (!c || !c.id) {
    showToast('Договор не загружен', 'error');
    return;
  }
  const items = [
    { label: 'QR-код',     icon: 'qrcode',         onclick: function () { showContractQrFromDetail(); } },
    { label: 'Чат',        icon: 'message-circle', onclick: function () { openContractChat(); } },
    { label: 'Доработка',  icon: 'alert-circle',   onclick: function () { openDefectFormForContract(); } },
    { label: 'Монтажнику', icon: 'send',           onclick: function () { openShareWithInstallerForContract(); } },
  ];
  // Редактирование — только если есть права
  if (typeof canManageSales !== 'function' || canManageSales()) {
    items.push({ label: 'Редактировать', icon: 'edit', onclick: function () { openEditContract(); } });
    items.push({ label: 'Удалить',       icon: 'trash', danger: true,
                 onclick: function () { deleteCurrentContract(); } });
  }
  showSimpleMenu(anchorEl, items);
}

async function openEditContract() {
  if (!canManageSales()) {
    showToast('Редактировать может директор, зам или менеджер', 'error');
    return;
  }
  state.contractFormMode = 'edit';
  // contractId уже в state.currentContractId
  // Подгружаем данные
  try {
    const c = await apiGet('/api/contracts/' + state.currentContractId);
    state.contractForm = {
      number: c.number || '',
      sign_date: c.sign_date || '',
      contractor_id: c.contractor_id,
      contract_type: c.contract_type || 'supply',
      legal_entity: c.legal_entity || 'ooo_atomus',
      sum_amount: c.sum_amount || '',
      delivery_date: c.delivery_date || '',
      delivery_address: c.delivery_address || '',
      manager_id: c.manager_id,
      comment: c.comment || '',
      payment_date: c.payment_date || '',  // ЭТАП 37
      // Для отображения выбранного контрагента / менеджера
      _contractor_name: c.contractor_name || '',
      _contractor_inn: c.contractor_inn || '',
      _manager_name: c.manager_name || '',
      co_managers: Array.isArray(c.co_managers) ? c.co_managers.slice() : [],  // v2.45.188
    };
    selectSidebarItem('sales-contract-form');
  } catch (e) {
    showToast('Не удалось загрузить договор: ' + String(e), 'error');
  }
}

function cancelContractForm() {
  if (state.contractFormMode === 'edit' && state.currentContractId) {
    selectSidebarItem('sales-contract-detail');
  } else {
    selectSidebarItem('sales-contracts');
  }
}

function initContractForm() {
  document.getElementById('scf-title').textContent =
    state.contractFormMode === 'edit' ? 'Редактирование договора' : 'Новый договор';
  document.getElementById('scf-mobile-title').textContent =
    state.contractFormMode === 'edit' ? 'Редактирование' : 'Новый договор';

  renderContractForm();
}

function renderContractForm() {
  const container = document.getElementById('scf-content');
  const f = state.contractForm;

  let html = '';

  if (state.contractFormMode === 'new' && state.contractDraftRestored) {
    html += '<div class="task-draft-banner"><i class="ti ti-history"></i>' +
      '<span>Восстановлен черновик незаконченного договора.</span>' +
      '<button type="button" class="btn-link" onclick="discardContractDraft()">Очистить</button></div>';
  }

  // Контрагент
  html += '<div class="sales-form-section">';
  html += '<div class="sales-form-title">Контрагент</div>';
  html += '<div class="sales-form-row cols-1">';
  html += '<div><label>Кому <span class="req">*</span></label>';
  html += '<div class="contractor-selector" onclick="openContractorModal()">';
  if (f.contractor_id) {
    const name = f._contractor_name || '—';
    const inn = f._contractor_inn ? ' · ИНН ' + f._contractor_inn : '';
    html += '<div class="selected-text">' +
            '<div class="selected-name">' + escapeHtml(name) + '</div>' +
            '<div class="selected-meta">' + escapeHtml(inn) + '</div>' +
            '</div>';
  } else {
    html += '<div class="selected-text"><div class="placeholder">Выберите контрагента…</div></div>';
  }
  html += '<i class="ti ti-chevron-right chev"></i>';
  html += '</div></div></div></div>';

  // Основные поля
  html += '<div class="sales-form-section">';
  html += '<div class="sales-form-title">Договор</div>';
  html += '<div class="sales-form-row">';
  html += '<div><label>Номер <span class="req">*</span></label>' +
          '<input type="text" id="scf-number" value="' + escapeHtml(f.number) + '" placeholder="напр. 12-Д/2026"></div>';
  html += '<div><label>Дата подписания <span class="req">*</span></label>' +
          '<input type="date" id="scf-sign-date" value="' + escapeHtml(f.sign_date) + '"></div>';
  html += '</div>';

  // Тип
  html += '<div class="sales-form-row cols-1"><div><label>Тип договора <span class="req">*</span></label>';
  html += '<div class="radio-chips">';
  html += '<button type="button" class="' + (f.contract_type === 'supply' ? 'selected' : '') + '" onclick="setContractType(\'supply\')">' +
          '<i class="ti ti-package"></i> Только поставка</button>';
  html += '<button type="button" class="' + (f.contract_type === 'supply_install' ? 'selected' : '') + '" onclick="setContractType(\'supply_install\')">' +
          '<i class="ti ti-tools"></i> Поставка + монтаж</button>';
  // v2.45.293: иногда заказывают только монтаж (без поставки оборудования)
  html += '<button type="button" class="' + (f.contract_type === 'install_only' ? 'selected' : '') + '" onclick="setContractType(\'install_only\')">' +
          '<i class="ti ti-tool"></i> Только монтаж</button>';
  html += '</div></div></div>';

  // Юрлицо
  html += '<div class="sales-form-row cols-1"><div><label>Юрлицо <span class="req">*</span></label>';
  html += '<div class="radio-chips column">';
  html += '<button type="button" class="' + (f.legal_entity === 'ooo_atomus' ? 'selected' : '') + '" onclick="setLegalEntity(\'ooo_atomus\')">' +
          '<i class="ti ti-building"></i><div><b>ООО «Атомус Групп»</b><small>с НДС 22% · ИНН 7415103479</small></div></button>';
  html += '<button type="button" class="' + (f.legal_entity === 'ooo_td_atomus' ? 'selected' : '') + '" onclick="setLegalEntity(\'ooo_td_atomus\')">' +
          '<i class="ti ti-building-skyscraper"></i><div><b>ООО ТД «Атомус Групп»</b><small>без НДС · ИНН 7415110363</small></div></button>';
  html += '</div></div></div>';

  // Сумма + срок
  html += '<div class="sales-form-row">';
  html += '<div><label>Сумма, ₽</label>' +
          '<input type="number" id="scf-sum" value="' + (f.sum_amount || '') + '" placeholder="напр. 485000" min="0" step="1000"></div>';
  // ЭТАП 37: дата оплаты (от неё считается срок отгрузки)
  html += '<div><label>Дата оплаты</label>' +
          '<input type="date" id="scf-payment-date" value="' + escapeHtml(f.payment_date || '') + '">' +
          '<div class="ship-calc-hint" style="margin-top: 4px;">Дата получения предоплаты (срок отгрузки считается от неё)</div>' +
          '</div>';
  html += '</div>';

  // Срок отгрузки
  html += '<div class="sales-form-row cols-1">';
  // ЭТАП 36.3: калькулятор срока отгрузки. v2.43.67: + выбор рабочие/календарные дни
  const daysType = f.days_type || 'working';
  html += '<div><label>Срок отгрузки</label>' +
          '<div class="ship-calc-row">' +
            '<input type="date" id="scf-delivery-date" value="' + escapeHtml(f.delivery_date) + '">' +
            '<div class="ship-calc-mini">' +
              '<input type="number" id="scf-working-days" placeholder="дни" min="1" max="365" value="' +
                (f.working_days || '') + '" title="Срок изготовления в днях">' +
            '</div>' +
          '</div>' +
          '<div class="ship-days-type">' +
            '<button type="button" class="ship-days-type-btn' + (daysType === 'working' ? ' active' : '') + '" onclick="setContractDaysType(\'working\')">Рабочие дни</button>' +
            '<button type="button" class="ship-days-type-btn' + (daysType === 'calendar' ? ' active' : '') + '" onclick="setContractDaysType(\'calendar\')">Календарные дни</button>' +
          '</div>' +
          '<div class="ship-calc-hint" id="scf-ship-hint">Введи количество дней — дата отгрузки посчитается автоматически</div>' +
        '</div>';
  html += '</div>';

  // Адрес
  html += '<div class="sales-form-row cols-1"><div><label>Адрес доставки</label>' +
          '<input type="text" id="scf-delivery-address" value="' + escapeHtml(f.delivery_address) + '" placeholder="г. Екатеринбург, ул. ..."></div></div>';

  // Менеджер
  html += '<div class="sales-form-row cols-1"><div><label>Менеджер</label>';
  html += '<div class="contractor-selector" onclick="openManagerModal()">';
  if (f.manager_id) {
    html += '<div class="selected-text"><div class="selected-name">' + escapeHtml(f._manager_name || '—') + '</div></div>';
  } else {
    html += '<div class="selected-text"><div class="placeholder">Не назначен (необязательно)</div></div>';
  }
  html += '<i class="ti ti-chevron-right chev"></i>';
  html += '</div></div></div>';

  // v2.45.188: Доп. менеджеры (может вести несколько)
  html += '<div class="sales-form-row cols-1"><div><label>Доп. менеджеры</label>';
  html += '<div id="scf-co-managers">' + _renderCoManagersChips() + '</div>';
  html += '<button type="button" class="btn btn-secondary btn-small" style="margin-top:6px;" onclick="openManagerModal(\'co\')"><i class="ti ti-user-plus"></i> Добавить менеджера</button>';
  html += '</div></div>';

  // Комментарий
  html += '<div class="sales-form-row cols-1"><div><label>Комментарий</label>' +
          '<textarea id="scf-comment" placeholder="Доп. информация для своих">' + escapeHtml(f.comment) + '</textarea></div></div>';
  html += '</div>';

  // Кнопки
  html += '<div class="sales-action-bar">';
  html += '<button class="btn btn-secondary" onclick="cancelContractForm()">Отмена</button>';
  html += '<button class="btn btn-primary" id="scf-submit" onclick="submitContractForm()">' +
          '<i class="ti ti-check"></i> ' + (state.contractFormMode === 'edit' ? 'Сохранить' : 'Создать договор') + '</button>';
  html += '</div>';
  html += '<div id="scf-error"></div>';

  container.innerHTML = html;

  // Подвязка input → state
  document.getElementById('scf-number').addEventListener('input', e => { state.contractForm.number = e.target.value; });
  document.getElementById('scf-sign-date').addEventListener('change', e => {
    state.contractForm.sign_date = e.target.value;
    _recalcShipDate();  // ЭТАП 36.3
  });
  document.getElementById('scf-sum').addEventListener('input', e => { state.contractForm.sum_amount = e.target.value; });
  // ЭТАП 37: дата оплаты — триггерит пересчёт срока
  document.getElementById('scf-payment-date').addEventListener('change', e => {
    state.contractForm.payment_date = e.target.value;
    state.contractForm._delivery_manual = false;  // снимаем флаг ручного ввода — пересчёт от оплаты
    _recalcShipDate();
  });
  document.getElementById('scf-delivery-date').addEventListener('change', e => {
    state.contractForm.delivery_date = e.target.value;
    state.contractForm._delivery_manual = true;  // ручное изменение — больше не пересчитываем
    const hint = document.getElementById('scf-ship-hint');
    if (hint) hint.textContent = 'Дата отгрузки изменена вручную';
  });
  document.getElementById('scf-working-days').addEventListener('input', e => {
    state.contractForm.working_days = parseInt(e.target.value) || null;
    state.contractForm._delivery_manual = false;
    _recalcShipDate();
  });
  document.getElementById('scf-delivery-address').addEventListener('input', e => { state.contractForm.delivery_address = e.target.value; });
  document.getElementById('scf-comment').addEventListener('input', e => { state.contractForm.comment = e.target.value; });
}

// ============ ЭТАП 36.3: Календарь РФ и калькулятор срока отгрузки ============

const _RU_FIXED_HOLIDAYS = [
  '01-01','01-02','01-03','01-04','01-05','01-06','01-07','01-08',
  '02-23','03-08','05-01','05-09','06-12','11-04',
];
function _isHolidayRu(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return _RU_FIXED_HOLIDAYS.includes(mm + '-' + dd);
}
function _isWorkingDayRu(d) {
  const wd = d.getDay();
  if (wd === 0 || wd === 6) return false;
  if (_isHolidayRu(d)) return false;
  return true;
}
function _addWorkingDaysRu(startDate, n) {
  const d = new Date(startDate);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    if (_isWorkingDayRu(d)) added++;
  }
  return d;
}
function _recalcShipDate() {
  if (state.contractForm._delivery_manual) return;
  const signStr = state.contractForm.sign_date;
  const payStr = state.contractForm.payment_date;
  const days = parseInt(state.contractForm.working_days) || 0;
  const daysType = state.contractForm.days_type || 'working';
  const hint = document.getElementById('scf-ship-hint');
  const input = document.getElementById('scf-delivery-date');
  // ЭТАП 37: база отсчёта = дата оплаты, если есть; иначе — подписания (с пометкой «прогноз»)
  const baseStr = payStr || signStr;
  const isForecast = !payStr;  // прогноз, пока оплата не получена
  if (!baseStr || !days) {
    if (hint) hint.textContent = 'Введи количество дней — дата отгрузки посчитается автоматически';
    return;
  }
  const baseDate = new Date(baseStr + 'T00:00:00');
  if (isNaN(baseDate)) return;
  // v2.43.67: рабочие или календарные дни
  let shipDate;
  if (daysType === 'calendar') {
    shipDate = new Date(baseDate);
    shipDate.setDate(shipDate.getDate() + days);
  } else {
    shipDate = _addWorkingDaysRu(baseDate, days);
  }
  const yyyy = shipDate.getFullYear();
  const mm = String(shipDate.getMonth() + 1).padStart(2, '0');
  const dd = String(shipDate.getDate()).padStart(2, '0');
  const iso = yyyy + '-' + mm + '-' + dd;
  if (input) input.value = iso;
  state.contractForm.delivery_date = iso;
  if (hint) {
    const dStr = dd + '.' + mm + '.' + yyyy;
    const unitLabel = daysType === 'calendar' ? 'кал. дн.' : 'раб. дн.';
    const fromLabel = isForecast ? 'от подписания' : 'от оплаты';
    if (isForecast) {
      hint.textContent = '+' + days + ' ' + unitLabel + ' ' + fromLabel + ' → ' + dStr + ' (прогноз, уточнится после оплаты)';
    } else {
      hint.textContent = '+' + days + ' ' + unitLabel + ' ' + fromLabel + ' → ' + dStr;
    }
  }
}

// v2.43.67: переключение рабочие/календарные дни
function setContractDaysType(t) {
  state.contractForm.days_type = t;
  state.contractForm._delivery_manual = false; // снова авторасчёт
  // Обновляем кнопки без полной перерисовки формы
  document.querySelectorAll('.ship-days-type-btn').forEach(b => b.classList.remove('active'));
  const btns = document.querySelectorAll('.ship-days-type-btn');
  btns.forEach(b => {
    if ((t === 'working' && b.textContent.includes('Рабоч')) ||
        (t === 'calendar' && b.textContent.includes('Календар'))) {
      b.classList.add('active');
    }
  });
  _recalcShipDate();
}

function setContractType(t) {
  state.contractForm.contract_type = t;
  renderContractForm();
}

function setLegalEntity(le) {
  state.contractForm.legal_entity = le;
  renderContractForm();
}

async function submitContractForm() {
  const errEl = document.getElementById('scf-error');
  const btn = document.getElementById('scf-submit');
  errEl.innerHTML = '';

  const f = state.contractForm;
  if (!f.number.trim()) { errEl.innerHTML = '<div class="sales-error">Укажите номер договора</div>'; return; }
  if (!f.sign_date) { errEl.innerHTML = '<div class="sales-error">Укажите дату подписания</div>'; return; }
  if (!f.contractor_id) { errEl.innerHTML = '<div class="sales-error">Выберите контрагента</div>'; return; }

  const payload = {
    number: f.number.trim(),
    sign_date: f.sign_date,
    contractor_id: f.contractor_id,
    contract_type: f.contract_type,
    legal_entity: f.legal_entity,
  };
  if (f.sum_amount !== '') {
    const n = Number(f.sum_amount);
    if (isNaN(n) || n < 0) { errEl.innerHTML = '<div class="sales-error">Некорректная сумма</div>'; return; }
    payload.sum_amount = n;
  }
  if (f.delivery_date) payload.delivery_date = f.delivery_date;
  if (f.delivery_address) payload.delivery_address = f.delivery_address.trim();
  if (f.manager_id) payload.manager_id = f.manager_id;
  // v2.45.188: доп. менеджеры — всегда передаём (можно очистить), список id
  payload.co_manager_ids = (f.co_managers || []).map(m => m.id);
  if (f.comment) payload.comment = f.comment.trim();
  // ЭТАП 37: дата оплаты (PATCH-семантика: всегда передаём, чтобы можно было очистить → "")
  if (state.contractFormMode === 'edit') {
    payload.payment_date = f.payment_date || '';
  } else if (f.payment_date) {
    payload.payment_date = f.payment_date;
  }
  // В режиме edit статус не отправляем (меняется через переключатель отдельно)

  // v2.45.199: редактирование существующего договора — под личным паролём.
  // (создание нового договора паролем не закрываем — только изменение.)
  if (state.contractFormMode === 'edit' && state.currentContractId) {
    const _pwd = await _promptPasswordForAction(
      'Сохранить изменения договора?',
      'Подтверди личным паролём — редактирование договора защищено.'
    );
    if (_pwd === null) return;   // отменили — форму не трогаем
    payload.password = _pwd;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> Сохраняем…';

  try {
    let r;
    const token = localStorage.getItem(TOKEN_KEY);
    if (state.contractFormMode === 'edit' && state.currentContractId) {
      r = await fetch(API_BASE + '/api/contracts/' + state.currentContractId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(payload),
      });
    } else {
      r = await fetch(API_BASE + '/api/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(payload),
      });
    }
    const data = await r.json();
    if (!r.ok) {
      // v2.45.199: неверный/непереданный пароль — сбросим кеш, чтобы переспросить
      if ((r.status === 401 || r.status === 403) && typeof _clearCachedPassword === 'function') {
        _clearCachedPassword();
      }
      errEl.innerHTML = '<div class="sales-error">' + escapeHtml(data.message || data.error || 'Ошибка') + '</div>';
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-check"></i> ' + (state.contractFormMode === 'edit' ? 'Сохранить' : 'Создать договор');
      return;
    }
    if (state.contractFormMode !== 'edit' && typeof _draftClear === 'function') _draftClear(CONTRACT_DRAFT_KEY);
    showToast(state.contractFormMode === 'edit' ? 'Договор обновлён' : 'Договор создан', 'success');
    cache.contracts = null;
    cache.contractsCounts = null;
    state.currentContractId = data.id;
    setTimeout(() => selectSidebarItem('sales-contract-detail'), 200);
  } catch (e) {
    errEl.innerHTML = '<div class="sales-error">Ошибка соединения: ' + escapeHtml(String(e)) + '</div>';
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i> ' + (state.contractFormMode === 'edit' ? 'Сохранить' : 'Создать договор');
  }
}

async function deleteCurrentContract() {
  if (!state.currentContractId) return;
  if (!confirm('Удалить договор? Действие можно отменить только восстановлением через бота.')) return;
  // v2.45.199: удаление договора — под личным паролём
  const _pwd = await _promptPasswordForAction(
    'Удалить договор?',
    'Подтверди личным паролём — удаление договора защищено.'
  );
  if (_pwd === null) return;   // отменили
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/contracts/' + state.currentContractId, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ password: _pwd }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      if ((r.status === 401 || r.status === 403) && typeof _clearCachedPassword === 'function') {
        _clearCachedPassword();
      }
      showToast(d.message || 'Не удалось удалить', 'error');
      return;
    }
    showToast('Договор удалён', 'success');
    cache.contracts = null;
    cache.contractsCounts = null;
    selectSidebarItem('sales-contracts');
  } catch (e) {
    showToast('Ошибка: ' + String(e), 'error');
  }
}

// --------- МОДАЛКА ВЫБОРА КОНТРАГЕНТА ----------

function openContractorModal() {
  document.getElementById('contractor-modal').classList.add('visible');
  document.getElementById('contractor-modal-search').value = '';
  loadContractorsForModal('');
  setTimeout(() => document.getElementById('contractor-modal-search').focus(), 100);
}

function closeContractorModal() {
  document.getElementById('contractor-modal').classList.remove('visible');
  // Сбрасываем контекст КП, чтобы он не «прилип» к форме договора, если
  // модалку закрыли крестиком без выбора.
  state._contractorModalContext = null;
}

async function loadContractorsForModal(query) {
  const container = document.getElementById('contractor-modal-body');
  container.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try {
    if (!cache.contractors) {
      const d = await apiGet('/api/contractors');
      cache.contractors = d.contractors || [];
    }
    let list = cache.contractors.filter(c => c.is_active);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.inn || '').toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.contact_person || '').toLowerCase().includes(q)
      );
    }
    if (!list.length) {
      container.innerHTML = '<div class="empty-block"><i class="ti ti-search"></i>Не найдено</div>';
      return;
    }
    let html = '';
    list.forEach(c => {
      const iconCls = c.contractor_type === 'private' ? 'ti-user' : 'ti-building';
      const iconColorCls = c.contractor_type === 'private' ? 'private' : '';
      const meta = [];
      if (c.inn) meta.push('ИНН ' + c.inn);
      if (c.phone) meta.push(c.phone);
      html += '<div class="modal-item" onclick="selectContractor(' + c.id + ')">' +
        '<div class="mi-icon"><i class="ti ' + iconCls + '"></i></div>' +
        '<div class="mi-text">' +
          '<div class="mi-title">' + escapeHtml(c.name) + '</div>' +
          '<div class="mi-meta">' + escapeHtml(meta.join(' · ')) + '</div>' +
        '</div></div>';
    });
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function selectContractor(contractorId) {
  const c = (cache.contractors || []).find(x => x.id === contractorId);
  if (!c) return;
  // КП (offerForm) — отдельный контекст, см. openContractorModalForOffer.
  // Эта функция — единственная (объявление в app-4 перекрывает прежний
  // window.selectContractor из app-1), поэтому оба контекста живут здесь.
  if (state._contractorModalContext === 'offer') {
    state.offerForm.contractor_id = contractorId;
    state.offerForm.contractor_name = c.name;
    state.offerForm.contractor_inn = c.inn || '';
    closeContractorModal();
    if (typeof renderOfferForm === 'function') renderOfferForm();
    return;
  }
  state.contractForm.contractor_id = contractorId;
  state.contractForm._contractor_name = c.name;
  state.contractForm._contractor_inn = c.inn || '';
  closeContractorModal();
  renderContractForm();
}

function openNewContractorFromModal() {
  closeContractorModal();
  // Запоминаем что мы из формы договора пришли, чтобы потом вернуться
  state._returnToContractForm = true;
  openNewContractor();
}

// --------- МОДАЛКА ВЫБОРА МЕНЕДЖЕРА ----------

function openManagerModal(mode) {
  state._managerPickMode = (mode === 'co') ? 'co' : 'main';
  document.getElementById('manager-modal').classList.add('visible');
  document.getElementById('manager-modal-search').value = '';
  loadManagersForModal('');
  setTimeout(() => document.getElementById('manager-modal-search').focus(), 100);
}

function closeManagerModal() {
  document.getElementById('manager-modal').classList.remove('visible');
  // Сбрасываем контекст КП, чтобы он не «прилип» к форме договора, если
  // модалку закрыли крестиком без выбора.
  state._managerModalContext = null;
  if (state._managerPickMode === 'co') {
    state._managerPickMode = 'main';
    if (typeof renderContractForm === 'function') renderContractForm();
  }
}

// v2.45.188: доп. менеджеры — чипы и переключение
function _renderCoManagersChips() {
  const co = (state.contractForm && state.contractForm.co_managers) || [];
  if (!co.length) return '<div style="font-size:12.5px;color:var(--text-light);">Никого (необязательно)</div>';
  return '<div style="display:flex;flex-wrap:wrap;gap:6px;">' + co.map(m =>
    '<span style="display:inline-flex;align-items:center;gap:6px;background:var(--brand-bg);color:var(--brand);border-radius:14px;padding:4px 10px;font-size:13px;font-weight:600;">' +
    escapeHtml(m.name || ('#' + m.id)) +
    '<i class="ti ti-x" style="cursor:pointer;" onclick="removeCoManager(' + m.id + ')"></i></span>'
  ).join('') + '</div>';
}
function removeCoManager(id) {
  const co = (state.contractForm && state.contractForm.co_managers) || [];
  state.contractForm.co_managers = co.filter(m => m.id !== id);
  if (typeof renderContractForm === 'function') renderContractForm();
}
function toggleCoManager(id) {
  const co = state.contractForm.co_managers || (state.contractForm.co_managers = []);
  const idx = co.findIndex(m => m.id === id);
  if (idx >= 0) { co.splice(idx, 1); }
  else {
    const m = (cache.managersForPicker || []).find(x => x.id === id);
    if (m) co.push({ id: id, name: m.short_name || m.full_name || ('#' + id) });
  }
  loadManagersForModal(((document.getElementById('manager-modal-search') || {}).value) || '');
}

async function loadManagersForModal(query) {
  const container = document.getElementById('manager-modal-body');
  container.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try {
    if (!cache.managersForPicker) {
      const d = await apiGet('/api/employees/active');
      cache.managersForPicker = d.employees || [];
    }
    let list = cache.managersForPicker;
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(e =>
        ((e.short_name || '') + ' ' + (e.full_name || '')).toLowerCase().includes(q)
      );
    }
    if (!list.length) {
      container.innerHTML = '<div class="empty-block"><i class="ti ti-search"></i>Не найдено</div>';
      return;
    }
    const coMode = state._managerPickMode === 'co';
    const co = (state.contractForm && state.contractForm.co_managers) || [];
    const coIds = co.map(m => m.id);
    const mainId = state.contractForm && state.contractForm.manager_id;
    let html = '';
    if (coMode) {
      // В режиме доп.менеджеров: мультивыбор, кнопка «Готово», без «Не назначен»
      html += '<div style="display:flex;justify-content:flex-end;margin-bottom:8px;">' +
        '<button class="btn btn-primary btn-small" onclick="closeManagerModal()"><i class="ti ti-check"></i> Готово</button></div>';
    } else {
      html += '<div class="modal-item" onclick="selectManager(null)">' +
        '<div class="mi-icon" style="background: var(--bg); color: var(--text-light);"><i class="ti ti-x"></i></div>' +
        '<div class="mi-text"><div class="mi-title">Не назначен</div><div class="mi-meta">Без менеджера</div></div></div>';
    }
    list.forEach(e => {
      if (coMode && e.id === mainId) return;  // основной не может быть доп.
      const name = e.short_name || e.full_name || '—';
      const picked = coMode && coIds.indexOf(e.id) >= 0;
      const click = coMode ? ('toggleCoManager(' + e.id + ')') : ('selectManager(' + e.id + ')');
      const roleMeta = (typeof roleNamesRu === 'function') ? roleNamesRu(e.roles) : '';
      html += '<div class="modal-item" onclick="' + click + '"' + (picked ? ' style="background:var(--brand-bg);"' : '') + '>' +
        '<div class="mi-icon">' + (picked ? '<i class="ti ti-check" style="color:var(--brand);"></i>' : '<i class="ti ti-user"></i>') + '</div>' +
        '<div class="mi-text">' +
          '<div class="mi-title">' + escapeHtml(name) + '</div>' +
          (roleMeta ? '<div class="mi-meta">' + escapeHtml(roleMeta) + '</div>' : '') +
        '</div></div>';
    });
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function selectManager(managerId) {
  // КП (offerForm) — отдельный контекст, см. openManagerModalForOffer.
  // Эта функция — единственная (объявление в app-4 перекрывает прежний
  // window.selectManager из app-1), поэтому оба контекста живут здесь.
  if (state._managerModalContext === 'offer') {
    if (managerId === null) {
      state.offerForm.manager_id = null;
      state.offerForm.manager_name = '';
    } else {
      const m = (cache.managersForPicker || []).find(x => x.id === managerId);
      if (m) {
        state.offerForm.manager_id = managerId;
        state.offerForm.manager_name = m.short_name || m.full_name || '';
      }
    }
    closeManagerModal();
    if (typeof renderOfferForm === 'function') renderOfferForm();
    return;
  }
  if (state._managerModalContext === 'offer_calc') {
    // «Рассчитал» в КП — необязательный сотрудник
    if (managerId === null) {
      state.offerForm.calculated_by_id = null;
      state.offerForm.calculated_by_name = '';
    } else {
      const m = (cache.managersForPicker || []).find(x => x.id === managerId);
      if (m) {
        state.offerForm.calculated_by_id = managerId;
        state.offerForm.calculated_by_name = m.short_name || m.full_name || '';
      }
    }
    closeManagerModal();
    if (typeof renderOfferForm === 'function') renderOfferForm();
    return;
  }
  if (managerId === null) {
    state.contractForm.manager_id = null;
    state.contractForm._manager_name = '';
  } else {
    const m = (cache.managersForPicker || []).find(x => x.id === managerId);
    if (!m) return;
    state.contractForm.manager_id = managerId;
    state.contractForm._manager_name = m.short_name || m.full_name || '';
  }
  closeManagerModal();
  renderContractForm();
}

// --------- СПИСОК КОНТРАГЕНТОВ ----------

async function loadContractors() {
  const container = document.getElementById('ctr-content');
  if (cache.contractors) {
    renderContractorsList();
  } else {
    container.innerHTML = '<div class="loading-block">Загружаем контрагентов…</div>';
  }
  try {
    const d = await apiGet('/api/contractors');
    cache.contractors = d.contractors || [];
    renderContractorsList();
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function renderContractorsList() {
  const container = document.getElementById('ctr-content');
  const all = cache.contractors || [];
  const filter = state.salesContractorsFilter;
  const search = (state.salesContractorsSearch || '').toLowerCase().trim();

  // Считаем юр/физ
  const counts = { legal: 0, private: 0 };
  all.forEach(c => { if (c.is_active) counts[c.contractor_type] = (counts[c.contractor_type] || 0) + 1; });

  // Обновляем чипсы
  document.querySelectorAll('#ctr-filters .filter-chip').forEach(chip => {
    const k = chip.dataset.ctrf;
    const baseLabels = { 'all': 'Все', 'legal': 'Юр. лица', 'private': 'Физ. лица' };
    let count = 0;
    if (k === 'all') count = (counts.legal || 0) + (counts.private || 0);
    else count = counts[k] || 0;
    chip.textContent = baseLabels[k] + (count ? ' · ' + count : '');
    chip.classList.toggle('active', k === filter);
  });

  const sub = document.getElementById('ctr-subtitle');
  if (sub) {
    sub.textContent = (counts.legal || 0) + ' юр. лиц · ' + (counts.private || 0) + ' физ. лиц';
  }

  let list = all.filter(c => c.is_active);
  if (filter !== 'all') {
    list = list.filter(c => c.contractor_type === filter);
  }
  if (search) {
    list = list.filter(c =>
      (c.name || '').toLowerCase().includes(search) ||
      (c.inn || '').toLowerCase().includes(search) ||
      (c.phone || '').toLowerCase().includes(search) ||
      (c.contact_person || '').toLowerCase().includes(search)
    );
  }

  if (!list.length) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-briefcase"></i>Контрагентов нет' +
      (canManageSales() ? '<br><br><button class="btn btn-primary" onclick="openNewContractor()" style="margin: 0 auto;"><i class="ti ti-plus"></i> Создать первого</button>' : '') +
      '</div>';
    return;
  }

  if (state.isDesktop) {
    let html = '<div style="padding: 0;">';
    html += '<div class="contracts-table">';
    html += '<div class="contractor-row header">' +
      '<div></div>' +
      '<div>Название</div>' +
      '<div>ИНН</div>' +
      '<div>Телефон</div>' +
      '<div>Договоров</div>' +
      '<div></div>' +
      '</div>';
    list.forEach(c => {
      const iconCls = c.contractor_type === 'private' ? 'ti-user' : 'ti-building';
      const colorCls = c.contractor_type === 'private' ? 'private' : '';
      html += '<div class="contractor-row" onclick="openContractor(' + c.id + ')">' +
        '<div class="ctr-icon ' + colorCls + '"><i class="ti ' + iconCls + '"></i></div>' +
        '<div class="ctr-name">' + escapeHtml(c.name) +
          (c.contact_person ? '<small>' + escapeHtml(c.contact_person) + '</small>' : '') +
        '</div>' +
        '<div class="ctr-info">' + escapeHtml(c.inn || '—') + '</div>' +
        '<div class="ctr-info">' + escapeHtml(c.phone || '—') + '</div>' +
        '<div class="ctr-counts">' +
          (c.contracts_active ? '<b>' + c.contracts_active + ' акт.</b>' : '<span style="color:var(--text-light);">0 акт.</span>') +
          (c.contracts_closed ? '<small>/ ' + c.contracts_closed + ' закр.</small>' : '') +
        '</div>' +
        '<div class="ct-arrow"><i class="ti ti-chevron-right"></i></div>' +
        '</div>';
    });
    html += '</div></div>';
    container.innerHTML = html;
  } else {
    let html = '<div class="contract-cards" style="padding-top: 12px; padding-bottom: 20px;">';
    list.forEach(c => {
      const iconCls = c.contractor_type === 'private' ? 'ti-user' : 'ti-building';
      const colorCls = c.contractor_type === 'private' ? 'private' : '';
      const meta = [];
      if (c.inn) meta.push('ИНН ' + c.inn);
      if (c.phone) meta.push(c.phone);
      if (c.contact_person) meta.push(c.contact_person);
      const counts = (c.contracts_active ? c.contracts_active + ' акт. ' : '') +
                     (c.contracts_closed ? '/ ' + c.contracts_closed + ' закр.' : '');
      html += '<div class="contractor-card" onclick="openContractor(' + c.id + ')">' +
        '<div class="cc-icon ' + colorCls + '"><i class="ti ' + iconCls + '"></i></div>' +
        '<div class="cc-body">' +
          '<div class="cc-name">' + escapeHtml(c.name) + '</div>' +
          '<div class="cc-meta">' +
          (meta.length ? meta.map(escapeHtml).join(' · ') : 'Минимум данных') +
          (counts ? '<br><b>Договоров:</b> ' + counts : '') +
          '</div>' +
        '</div></div>';
    });
    html += '</div>';
    container.innerHTML = html;
  }
}

// --------- ФОРМА КОНТРАГЕНТА (новый / редактирование) ----------

function openContractor(contractorId) {
  // Сразу открываем форму редактирования
  state.contractorFormMode = 'edit';
  state.currentContractorId = contractorId;
  const c = (cache.contractors || []).find(x => x.id === contractorId);
  if (c) {
    state.contractorForm = {
      name: c.name || '',
      contractor_type: c.contractor_type || 'legal',
      inn: c.inn || '',
      phone: c.phone || '',
      contact_person: c.contact_person || '',
      address: c.address || '',
      comment: c.comment || '',
    };
  }
  selectSidebarItem('sales-contractor-form');
}

function openNewContractor() {
  if (!canManageSales()) {
    showToast('Создавать контрагентов может директор, зам или менеджер', 'error');
    return;
  }
  state.contractorFormMode = 'new';
  state.currentContractorId = null;
  state.contractorForm = {
    name: '', contractor_type: 'legal', inn: '', phone: '',
    contact_person: '', address: '', comment: '',
  };
  selectSidebarItem('sales-contractor-form');
}

function cancelContractorForm() {
  if (state._returnToContractForm) {
    state._returnToContractForm = false;
    selectSidebarItem('sales-contract-form');
  } else {
    selectSidebarItem('sales-contractors');
  }
}

function initContractorForm() {
  document.getElementById('ctrf-title').textContent =
    state.contractorFormMode === 'edit' ? 'Редактирование контрагента' : 'Новый контрагент';
  document.getElementById('ctrf-mobile-title').textContent =
    state.contractorFormMode === 'edit' ? 'Редактирование' : 'Новый контрагент';
  renderContractorForm();
}

function renderContractorForm() {
  const container = document.getElementById('ctrf-content');
  const f = state.contractorForm;
  const isLegal = f.contractor_type === 'legal';

  let html = '';

  html += '<div class="sales-form-section">';
  html += '<div class="sales-form-row cols-1"><div><label>Тип <span class="req">*</span></label>';
  html += '<div class="radio-chips">';
  html += '<button type="button" class="' + (isLegal ? 'selected' : '') + '" onclick="setContractorType(\'legal\')">' +
          '<i class="ti ti-building"></i> Юр. лицо</button>';
  html += '<button type="button" class="' + (!isLegal ? 'selected' : '') + '" onclick="setContractorType(\'private\')">' +
          '<i class="ti ti-user"></i> Физ. лицо</button>';
  html += '</div></div></div>';

  html += '<div class="sales-form-row cols-1"><div><label>' +
          (isLegal ? 'Название организации' : 'ФИО') + ' <span class="req">*</span></label>' +
          '<input type="text" id="ctrf-name" value="' + escapeHtml(f.name) + '" placeholder="' +
          (isLegal ? 'напр. ООО «Северводстрой»' : 'напр. Иванов Иван Иванович') + '"></div></div>';

  html += '<div class="sales-form-row">';
  html += '<div><label>ИНН</label>' +
          '<input type="text" id="ctrf-inn" value="' + escapeHtml(f.inn) + '" placeholder="10 или 12 цифр" inputmode="numeric"></div>';
  html += '<div><label>Телефон</label>' +
          '<input type="tel" id="ctrf-phone" value="' + escapeHtml(f.phone) + '" placeholder="+7 ..."></div>';
  html += '</div>';

  if (isLegal) {
    html += '<div class="sales-form-row cols-1"><div><label>Контактное лицо</label>' +
            '<input type="text" id="ctrf-contact" value="' + escapeHtml(f.contact_person) + '" placeholder="напр. Иванов И.И., директор"></div></div>';
  }

  html += '<div class="sales-form-row cols-1"><div><label>Адрес</label>' +
          '<input type="text" id="ctrf-address" value="' + escapeHtml(f.address) + '" placeholder="г. Екатеринбург, ул. ..."></div></div>';

  html += '<div class="sales-form-row cols-1"><div><label>Комментарий (для своих)</label>' +
          '<textarea id="ctrf-comment" placeholder="Заметки для внутреннего использования">' + escapeHtml(f.comment) + '</textarea></div></div>';
  html += '</div>';

  // Кнопки
  html += '<div class="sales-action-bar">';
  html += '<button class="btn btn-secondary" onclick="cancelContractorForm()">Отмена</button>';
  html += '<button class="btn btn-primary" id="ctrf-submit" onclick="submitContractorForm()">' +
          '<i class="ti ti-check"></i> ' + (state.contractorFormMode === 'edit' ? 'Сохранить' : 'Создать контрагента') + '</button>';
  html += '</div>';
  html += '<div id="ctrf-error"></div>';

  container.innerHTML = html;

  document.getElementById('ctrf-name').addEventListener('input', e => { state.contractorForm.name = e.target.value; });
  document.getElementById('ctrf-inn').addEventListener('input', e => { state.contractorForm.inn = e.target.value; });
  document.getElementById('ctrf-phone').addEventListener('input', e => { state.contractorForm.phone = e.target.value; });
  const contactEl = document.getElementById('ctrf-contact');
  if (contactEl) contactEl.addEventListener('input', e => { state.contractorForm.contact_person = e.target.value; });
  document.getElementById('ctrf-address').addEventListener('input', e => { state.contractorForm.address = e.target.value; });
  document.getElementById('ctrf-comment').addEventListener('input', e => { state.contractorForm.comment = e.target.value; });
}

function setContractorType(t) {
  state.contractorForm.contractor_type = t;
  // Если был контактный, при физ.лице сбросим
  if (t === 'private') state.contractorForm.contact_person = '';
  renderContractorForm();
}

async function submitContractorForm() {
  const errEl = document.getElementById('ctrf-error');
  const btn = document.getElementById('ctrf-submit');
  errEl.innerHTML = '';

  const f = state.contractorForm;
  if (!f.name.trim()) { errEl.innerHTML = '<div class="sales-error">Укажите название</div>'; return; }

  const payload = {
    name: f.name.trim(),
    contractor_type: f.contractor_type,
    inn: f.inn.trim() || null,
    phone: f.phone.trim() || null,
    contact_person: f.contractor_type === 'legal' ? (f.contact_person.trim() || null) : null,
    address: f.address.trim() || null,
    comment: f.comment.trim() || null,
  };

  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> Сохраняем…';

  try {
    let r;
    const token = localStorage.getItem(TOKEN_KEY);
    if (state.contractorFormMode === 'edit' && state.currentContractorId) {
      r = await fetch(API_BASE + '/api/contractors/' + state.currentContractorId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(payload),
      });
    } else {
      r = await fetch(API_BASE + '/api/contractors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(payload),
      });
    }
    const data = await r.json();
    if (!r.ok) {
      errEl.innerHTML = '<div class="sales-error">' + escapeHtml(data.message || data.error || 'Ошибка') + '</div>';
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-check"></i> ' + (state.contractorFormMode === 'edit' ? 'Сохранить' : 'Создать контрагента');
      return;
    }
    showToast(state.contractorFormMode === 'edit' ? 'Контрагент обновлён' : 'Контрагент создан', 'success');
    cache.contractors = null;
    // Если мы пришли из формы договора — возвращаемся и выбираем этого контрагента
    if (state._returnToContractForm) {
      state._returnToContractForm = false;
      state.contractForm.contractor_id = data.id;
      state.contractForm._contractor_name = data.name;
      state.contractForm._contractor_inn = data.inn || '';
      setTimeout(() => selectSidebarItem('sales-contract-form'), 200);
    } else {
      setTimeout(() => selectSidebarItem('sales-contractors'), 200);
    }
  } catch (e) {
    errEl.innerHTML = '<div class="sales-error">Ошибка соединения: ' + escapeHtml(String(e)) + '</div>';
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i> ' + (state.contractorFormMode === 'edit' ? 'Сохранить' : 'Создать контрагента');
  }
}

// --------- ОБРАБОТЧИКИ ФИЛЬТРОВ И ПОИСКА ----------

document.addEventListener('DOMContentLoaded', () => {
  // Фильтры договоров
  document.querySelectorAll('#sc-filters .filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      state.salesContractsFilter = chip.dataset.scf;
      renderContractsList();
    });
  });
  // Поиск договоров
  const scSearch = document.getElementById('sc-search-input');
  if (scSearch) {
    scSearch.addEventListener('input', e => {
      state.salesContractsSearch = e.target.value;
      renderContractsList();
    });
  }

  // Фильтры контрагентов
  document.querySelectorAll('#ctr-filters .filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      state.salesContractorsFilter = chip.dataset.ctrf;
      renderContractorsList();
    });
  });
  // Поиск контрагентов
  const ctrSearch = document.getElementById('ctr-search-input');
  if (ctrSearch) {
    ctrSearch.addEventListener('input', e => {
      state.salesContractorsSearch = e.target.value;
      renderContractorsList();
    });
  }

  // Модалка контрагента — поиск
  const cmSearch = document.getElementById('contractor-modal-search');
  if (cmSearch) {
    cmSearch.addEventListener('input', e => loadContractorsForModal(e.target.value));
  }
  // Модалка менеджера — поиск
  const mmSearch = document.getElementById('manager-modal-search');
  if (mmSearch) {
    mmSearch.addEventListener('input', e => loadManagersForModal(e.target.value));
  }
  // Клик вне модалок закрывает их
  const cm = document.getElementById('contractor-modal');
  if (cm) cm.addEventListener('click', e => { if (e.target === cm) closeContractorModal(); });
  const mm = document.getElementById('manager-modal');
  if (mm) mm.addEventListener('click', e => { if (e.target === mm) closeManagerModal(); });
});

// ============================================================
// ============ ЭТАП 21: ПУБЛИЧНЫЕ СТРАНИЦЫ + QR + ПЕЧАТЬ НАКЛЕЕК ============
// ============================================================

// ---- Публичная страница сборки ----

// ---- Пароль публичной страницы (защита QR) ----
// Любой публичный код (договор/короб/сборка) открывается «с улицы» только по
// паролю договора. Введённый пароль запоминаем по токену, чтобы не спрашивать
// снова при следующих сканах того же получателя.
function _publicPwKey(token) { return 'pubpw_' + token; }
function getStoredPublicPw(token) {
  try { return localStorage.getItem(_publicPwKey(token)) || ''; } catch (e) { return ''; }
}
function setStoredPublicPw(token, pw) {
  try { localStorage.setItem(_publicPwKey(token), pw); } catch (e) {}
}

// Загружает публичный объект с учётом пароля. kind: 'assembly'|'contract'|'box'.
// Возвращает {ok, data, status, needPassword, badPassword}.
async function fetchPublicObject(kind, token, itemId) {
  const pw = getStoredPublicPw(token);
  let url = API_BASE + '/api/public/' + kind + '/' + encodeURIComponent(token);
  const _qs = [];
  if (pw) _qs.push('pw=' + encodeURIComponent(pw));
  if (itemId) _qs.push('item=' + encodeURIComponent(itemId));  // v2.45.208: карточка позиции
  if (_qs.length) url += '?' + _qs.join('&');
  // v2.45.420: публичная страница QR НЕ шлёт токен сессии — пароль спрашивается
  // всегда (в т.ч. у залогиненного сотрудника). Внутренние сценарии открытия
  // карточки (openAssemblyByPublicToken и т.п.) шлют токен отдельно.
  const opts = { cache: 'no-store' };
  const r = await fetch(url, opts);
  let data = null;
  try { data = await r.json(); } catch (e) {}
  if (r.status === 401 && data && (data.error === 'password_required' || data.error === 'bad_password')) {
    // Если сохранённый пароль не подошёл — забываем его
    if (data.error === 'bad_password' && pw) setStoredPublicPw(token, '');
    return { needPassword: true, badPassword: data.error === 'bad_password' && !!pw, status: 401 };
  }
  return { ok: r.ok, data, status: r.status };
}

function renderPublicPasswordGate(kind, token, isWrong) {
  return '<div class="public-header">' +
    '<div class="public-brand">Atom <span class="brand-name-accent">CRM</span></div>' +
    '<h1 class="public-header-title">Требуется пароль</h1>' +
    '<div class="public-header-sub"><i class="ti ti-lock"></i> Доступ по паролю</div>' +
  '</div>' +
  '<div class="public-body" style="padding: 24px;">' +
    '<p style="color: var(--text); font-size:14px; line-height:1.5; margin-bottom:16px;">' +
      'Эта страница защищена. Введите пароль, который вам выслали из «Атомус Групп».' +
    '</p>' +
    (isWrong ? '<div style="color:#c0392b; font-size:13px; margin-bottom:10px;"><i class="ti ti-alert-triangle"></i> Неверный пароль, попробуйте ещё раз.</div>' : '') +
    '<input id="public-pw-input" type="text" inputmode="numeric" autocomplete="off" placeholder="Пароль" ' +
      'style="width:100%; padding:12px 14px; font-size:18px; letter-spacing:2px; text-align:center; border:1.5px solid var(--border); border-radius:10px; box-sizing:border-box;" ' +
      'onkeydown="if(event.key===&quot;Enter&quot;){submitPublicPassword(&quot;' + kind + '&quot;,&quot;' + token + '&quot;);}">' +
    '<button class="public-add-defect-btn" style="margin-top:14px;" onclick="submitPublicPassword(&quot;' + kind + '&quot;,&quot;' + token + '&quot;)">' +
      '<i class="ti ti-lock-open"></i> Открыть' +
    '</button>' +
  '</div>' +
  '<div class="public-footer">' +
    'Внутренняя CRM-система ООО «Атомус Групп»<br>' +
    '<span style="font-size:11.5px;opacity:0.85;">Нет пароля? Обратитесь в Атомус Групп.</span>' +
  '</div>';
}

function submitPublicPassword(kind, token) {
  const inp = document.getElementById('public-pw-input');
  const pw = ((inp && inp.value) || '').trim();
  if (!pw) { if (inp) inp.focus(); return; }
  setStoredPublicPw(token, pw);
  if (kind === 'assembly') showPublicAssembly(token);
  else if (kind === 'contract') showPublicContract(token, window._pubPendingItem || null);
  else if (kind === 'box') showPublicBox(token);
}

async function showPublicAssembly(token) {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app').style.display = 'none';
  const page = document.getElementById('public-page');
  page.style.display = 'flex';
  const body = document.getElementById('public-card-body');
  body.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-light);">Загружаем…</div>';
  try {
    const res = await fetchPublicObject('assembly', token);
    if (res.needPassword) {
      body.innerHTML = renderPublicPasswordGate('assembly', token, res.badPassword);
      const inp = document.getElementById('public-pw-input'); if (inp) inp.focus();
      return;
    }
    if (!res.ok) {
      body.innerHTML = renderPublicError(res.status);
      return;
    }
    body.innerHTML = renderPublicAssemblyCard(res.data, token);
  } catch (e) {
    body.innerHTML = renderPublicError('network');
  }
}

function renderPublicAssemblyCard(a, token) {
  const headerSub = a.contract_number
    ? '<i class="ti ti-link"></i> По договору ' + escapeHtml(a.contract_number) +
      (a.contractor_name ? ' · ' + escapeHtml(a.contractor_name) : '')
    : '<i class="ti ti-building-warehouse"></i> На склад (свободная)';

  let rows = '';
  const addRow = (label, value) => {
    if (!value) return;
    rows += '<div class="public-row"><span class="public-row-label">' + label +
      '</span><span class="public-row-value">' + value + '</span></div>';
  };
  addRow('Артикул',     '<code>' + escapeHtml(a.model_article || '—') + '</code>');
  addRow('Исполнение',  a.execution ? escapeHtml(a.execution) : null);
  addRow('IP класс',    a.ip_class ? escapeHtml(a.ip_class) : null);
  addRow('Количество',  a.quantity + ' шт.');
  addRow('Дата сборки', escapeHtml(a.assembly_date || ''));
  if (a.status) {
    const cls = 's-' + a.status;
    addRow('Статус', '<span class="public-status-pill ' + cls + '">' + escapeHtml(a.status_label || a.status) + '</span>');
  }
  if (a.workers && a.workers.length) {
    const names = a.workers.map(w => escapeHtml(w.short_name || w.full_name || '')).join(', ');
    addRow('Собрали', names);
  }
  if (a.contract_delivery_date) {
    addRow('Срок отгрузки', escapeHtml(a.contract_delivery_date));
  }
  if (a.comment) {
    addRow('Комментарий', '<span style="font-style: italic; color: var(--text-light);">' + escapeHtml(a.comment) + '</span>');
  }

  // История
  let movHtml = '';
  if (a.movements && a.movements.length) {
    movHtml = '<div class="public-section-title">История движений</div>';
    a.movements.slice().reverse().forEach(m => {
      const sign = m.direction === 'in' ? '+' : '−';
      const color = m.direction === 'in' ? '#15803D' : (m.direction === 'out' ? '#2C5282' : '#B25E00');
      movHtml += '<div class="public-asm-row">' +
        '<div class="public-asm-name"><span style="color:' + color + '; font-weight: 700;">' + sign + m.qty + '</span> ' + escapeHtml(m.direction_label) + '</div>' +
        '<div class="public-asm-meta">' +
          (m.reason ? '<span>' + escapeHtml(m.reason) + '</span>' : '') +
          (m.created_at ? '<span><i class="ti ti-clock"></i>' + escapeHtml((m.created_at || '').replace('T', ' ').slice(0, 16)) + '</span>' : '') +
        '</div></div>';
    });
  }

  return '<div class="public-header">' +
    '<div class="public-brand">Atom <span class="brand-name-accent">CRM</span></div>' +
    '<h1 class="public-header-title">' + escapeHtml(a.model_name || 'Сборка') + '</h1>' +
    '<div class="public-header-sub">' + headerSub + '</div>' +
  '</div>' +
  '<div class="public-body">' + rows + movHtml +
    '<button class="public-add-defect-btn" onclick="openDefectForm(\'assembly\', \'' + token + '\')">' +
      '<i class="ti ti-alert-circle"></i> Сообщить о замечании' +
    '</button>' +
  '</div>' +
  '<div class="public-footer">' +
    'Внутренняя CRM-система ООО «Атомус Групп»<br>' +
    '<span style="font-size:11.5px;opacity:0.85;">Нужен полный доступ? Обратитесь в Атомус Групп.</span>' +
  '</div>';
}

// ---- Публичная страница договора ----

async function showPublicContract(token, itemId) {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app').style.display = 'none';
  const page = document.getElementById('public-page');
  page.style.display = 'flex';
  const body = document.getElementById('public-card-body');
  body.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-light);">Загружаем…</div>';
  try {
    const res = await fetchPublicObject('contract', token, itemId);
    if (res.needPassword) {
      body.innerHTML = renderPublicPasswordGate('contract', token, res.badPassword);
      // пароль введём один раз — после открытия снова покажем эту же позицию
      window._pubPendingItem = itemId || null;
      const inp = document.getElementById('public-pw-input'); if (inp) inp.focus();
      return;
    }
    if (!res.ok) {
      body.innerHTML = renderPublicError(res.status);
      return;
    }
    // v2.45.208: QR изделия → карточка конкретной позиции
    if (itemId && res.data && res.data.item) {
      body.innerHTML = renderPublicItemCard(res.data.item, res.data, token);
    } else {
      body.innerHTML = renderPublicContractCard(res.data, token);
    }
  } catch (e) {
    body.innerHTML = renderPublicError('network');
  }
}

// v2.45.208: карточка конкретного изделия (QR позиции спецификации)
function renderPublicItemCard(it, c, token) {
  let rows = '';
  const addRow = (label, value) => {
    if (!value) return;
    rows += '<div class="public-row"><span class="public-row-label">' + label +
      '</span><span class="public-row-value">' + value + '</span></div>';
  };
  if (it.type) addRow('Вид', '<b>' + escapeHtml(it.type) + '</b>');
  if (it.article) addRow('Артикул', escapeHtml(it.article));
  addRow('Количество', escapeHtml(String(it.qty || 0)) + ' ' + escapeHtml(it.unit || 'шт.'));
  if (it.execution_type === 'stainless') addRow('Исполнение', 'Нержавейка');
  else if (it.execution_type === 'standard') addRow('Исполнение', 'Обычное');
  if (it.ip_rating) addRow('Влагозащита', escapeHtml(it.ip_rating));
  addRow('Статус', '<span class="public-status-pill">' + escapeHtml(it.status_label || '') + '</span>');
  if (it.system_tag) addRow('Система / объект', escapeHtml(it.system_tag));
  if (it.alt_supply) {
    const ap = [];
    if (it.alt_supply_city) ap.push(escapeHtml(it.alt_supply_city));
    if (it.alt_supply_phone) ap.push('тел. ' + escapeHtml(it.alt_supply_phone));
    if (it.alt_supply_comment) ap.push(escapeHtml(it.alt_supply_comment));
    addRow('Закуп в другом городе', 'отгрузка сразу на объекте' + (ap.length ? '<br>' + ap.join(' · ') : ''));
  }
  addRow('Договор', escapeHtml(c.number || '') + (c.contractor_name ? ' · ' + escapeHtml(c.contractor_name) : ''));

  return '<div class="public-header">' +
    '<div class="public-brand">Atom <span class="brand-name-accent">CRM</span></div>' +
    '<h1 class="public-header-title">' + escapeHtml(it.name || 'Позиция') + '</h1>' +
    '<div class="public-header-sub"><i class="ti ti-qrcode"></i> Изделие по договору № ' + escapeHtml((c.number || '').replace(/^№#\s*/, '')) + '</div>' +
  '</div>' +
  '<div class="public-body" style="padding: 18px;">' + rows +
    '<div style="margin-top:14px;"><a href="/c/' + encodeURIComponent(token) + '" style="color:var(--brand);font-size:13px;"><i class="ti ti-arrow-right"></i> Весь договор</a></div>' +
  '</div>' +
  '<div class="public-footer">Внутренняя CRM-система ООО «Атомус Групп»</div>';
}

function renderPublicContractCard(c, token) {
  let rows = '';
  const addRow = (label, value) => {
    if (!value) return;
    rows += '<div class="public-row"><span class="public-row-label">' + label +
      '</span><span class="public-row-value">' + value + '</span></div>';
  };
  addRow('Контрагент',     escapeHtml(c.contractor_name || ''));
  addRow('Дата подписания', escapeHtml(c.sign_date || ''));
  addRow('Срок отгрузки',  c.delivery_date ? escapeHtml(c.delivery_date) : '—');
  if (c.delivery_address) addRow('Адрес доставки', escapeHtml(c.delivery_address));
  if (c.manager_name) addRow('Менеджер', escapeHtml(c.manager_name));
  const cls = 's-' + (c.status || 'production');
  addRow('Статус', '<span class="public-status-pill ' + cls + '">' + escapeHtml(c.status_label || '') + '</span>');

  // Сборки
  let asmHtml = '';
  if (c.assemblies && c.assemblies.length) {
    asmHtml = '<div class="public-section-title">Состав договора (' + c.assemblies.length + ')</div>';
    c.assemblies.forEach(a => {
      const acls = 's-' + (a.status || '');
      asmHtml += '<div class="public-asm-row">' +
        '<div class="public-asm-name">' + escapeHtml(a.model_name || 'Сборка') + 
        (a.model_article ? ' <span style="color: var(--text-light); font-weight: 500;">· ' + escapeHtml(a.model_article) + '</span>' : '') + 
        '</div>' +
        '<div class="public-asm-meta">' +
          '<span>' + a.quantity + ' шт.</span>' +
          (a.execution ? '<span>' + escapeHtml(a.execution) + '</span>' : '') +
          (a.ip_class ? '<span>' + escapeHtml(a.ip_class) + '</span>' : '') +
          '<span class="public-status-pill ' + acls + '" style="margin-left: auto;">' + escapeHtml(a.status_label || '') + '</span>' +
        '</div></div>';
    });
  }

  return '<div class="public-header">' +
    '<div class="public-brand">Atom <span class="brand-name-accent">CRM</span></div>' +
    '<h1 class="public-header-title">Договор ' + escapeHtml(c.number || '') + '</h1>' +
    '<div class="public-header-sub"><i class="ti ti-file-text"></i> ' + escapeHtml(c.contractor_name || '') + '</div>' +
  '</div>' +
  '<div class="public-body">' + rows + asmHtml +
    '<button class="public-add-defect-btn" onclick="openDefectForm(\'contract\', \'' + token + '\')">' +
      '<i class="ti ti-alert-circle"></i> Сообщить о замечании' +
    '</button>' +
  '</div>' +
  '<div class="public-footer">' +
    'Внутренняя CRM-система ООО «Атомус Групп»<br>' +
    '<span style="font-size:11.5px;opacity:0.85;">Нужен полный доступ? Обратитесь в Атомус Групп.</span>' +
  '</div>';
}

// ============ v2.37.0: ПУБЛИЧНАЯ СТРАНИЦА ЗАЯВКИ ============

const PUBLIC_DEFECT_GUEST_KEY = 'atomus_public_defect_guest';

async function showPublicDefect(token) {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app').style.display = 'none';
  const page = document.getElementById('public-page');
  page.style.display = 'flex';
  const body = document.getElementById('public-card-body');
  body.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-light);">Загружаем…</div>';
  state._publicDefectToken = token;
  try {
    const r = await fetch(API_BASE + '/api/public/defect/' + encodeURIComponent(token));
    if (!r.ok) {
      body.innerHTML = renderPublicError(r.status);
      return;
    }
    const d = await r.json();
    state._publicDefect = d;
    body.innerHTML = renderPublicDefectCard(d, token);
    // Загружаем чат
    loadPublicDefectMessages(token);
    loadPublicDefectParticipants(token);
    _startPublicDefectPolling(token);
  } catch (e) {
    body.innerHTML = renderPublicError('network');
  }
}

function renderPublicDefectCard(d, token) {
  const typeInfo = (typeof DEFECT_TYPE_LABELS !== 'undefined' && DEFECT_TYPE_LABELS[d.type]) || { label: d.type_label || 'Заявка', cls: 't-defect' };

  let catBadge = '';
  if (d.category && d.category_label) {
    const icon = (typeof DEFECT_CATEGORY_ICONS !== 'undefined' && DEFECT_CATEGORY_ICONS[d.category]) || 'ti-tag';
    catBadge = '<span class="defect-category-badge"><i class="ti ' + icon + '"></i>' + escapeHtml(d.category_label) + '</span>';
  }

  let files = '';
  if (d.photos && d.photos.length) {
    files = '<div class="public-section-title">Файлы</div>' +
      '<div class="defect-photos-grid">' +
      d.photos.map(p => _renderDefectGalleryItem(p)).join('') +
    '</div>';
  }

  let rows = '';
  if (d.location) {
    rows += '<div class="public-row"><span class="public-row-label">Где найдено</span><span class="public-row-value">' + escapeHtml(d.location) + '</span></div>';
  }
  if (d.model_name) {
    rows += '<div class="public-row"><span class="public-row-label">Сборка</span><span class="public-row-value">' + escapeHtml(d.model_name) + '</span></div>';
  }
  if (d.contract_number) {
    rows += '<div class="public-row"><span class="public-row-label">Договор</span><span class="public-row-value">' + escapeHtml(d.contract_number) + '</span></div>';
  }

  return '<div class="public-header">' +
    '<div class="public-brand">Atom <span class="brand-name-accent">CRM</span></div>' +
    '<h1 class="public-header-title">Заявка #' + d.id + '</h1>' +
    '<div class="public-header-sub"><i class="ti ti-calendar"></i> ' + escapeHtml((d.created_at || '').replace('T', ' ').slice(0, 16)) + '</div>' +
  '</div>' +
  '<div class="public-body">' +
    '<div class="defect-detail-head">' +
      '<span class="defect-type-badge ' + typeInfo.cls + '">' + escapeHtml(typeInfo.label) + '</span>' +
      '<span class="defect-status-badge s-' + d.status + '">' + escapeHtml(d.status_label) + '</span>' +
      catBadge +
    '</div>' +
    '<div class="defect-detail-desc">' + escapeHtml(d.description) + '</div>' +
    rows +
    files +
    // Чат
    '<div class="defect-chat" id="defect-chat-block">' +
      '<div class="defect-chat-title">' +
        '<i class="ti ti-messages"></i> Обсуждение' +
        '<span class="defect-chat-count" id="public-defect-chat-count">' + (d.messages_count || 0) + '</span>' +
        '<button class="defect-chat-sound" id="defect-chat-sound-btn" onclick="toggleDefectChatSound()" title="Звук уведомлений">' +
          '<i class="ti ' + (_getDefectSoundEnabled() ? 'ti-bell' : 'ti-bell-off') + '"></i>' +
        '</button>' +
      '</div>' +
      '<div class="defect-participants" id="defect-participants"></div>' +
      '<div class="defect-chat-feed" id="public-defect-chat-feed">' +
        '<div class="loading-block">Загружаем…</div>' +
      '</div>' +
      _renderPublicDefectComposer() +
    '</div>' +
  '</div>' +
  '<div class="public-footer">Внутренняя CRM-система ООО «Атомус Групп»<br>' +
    '<span style="font-size:11.5px;opacity:0.85;">Нужен полный доступ? Обратитесь в Атомус Групп.</span>' +
  '</div>';
}

function _renderPublicDefectComposer() {
  // Проверим, что гость уже представился (имя+телефон сохранены в localStorage)
  const guest = _getPublicDefectGuest();
  if (!guest) {
    return '<div class="public-defect-introduce">' +
      '<div class="public-section-title" style="margin-top:0;">Представьтесь, чтобы писать в обсуждение</div>' +
      '<div class="form-group"><label>Ваше имя *</label>' +
        '<input type="text" id="pub-def-name" placeholder="Иванов И.И.">' +
      '</div>' +
      '<div class="form-group"><label>Телефон *</label>' +
        '<input type="tel" id="pub-def-phone" placeholder="+7...">' +
      '</div>' +
      '<button class="btn btn-primary" style="width:100%;" onclick="savePublicDefectGuest()">' +
        '<i class="ti ti-arrow-right"></i> Продолжить' +
      '</button>' +
    '</div>';
  }
  return '<div class="defect-chat-compose" id="defect-chat-compose">' +
    '<div class="public-defect-guest-tag">' +
      '<i class="ti ti-user"></i> Вы пишете как: <b>' + escapeHtml(guest.name) + '</b> · ' + escapeHtml(guest.phone) +
      ' <a onclick="changePublicDefectGuest()" style="margin-left:8px; color:var(--brand); cursor:pointer;">сменить</a>' +
    '</div>' +
    '<div class="defect-chat-attachments" id="defect-chat-attachments"></div>' +
    '<div class="defect-chat-input-row">' +
      '<button class="defect-chat-attach" onclick="document.getElementById(\'public-defect-chat-file-input\').click()" title="Прикрепить">' +
        '<i class="ti ti-paperclip"></i>' +
      '</button>' +
      '<input type="file" id="public-defect-chat-file-input" multiple style="display:none;" ' +
        'accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" ' +
        'onchange="addDefectChatAttachments(this)">' +
      '<textarea id="defect-chat-text" rows="1" placeholder="Написать сообщение…" oninput="autosizeDefectChatInput(this)"></textarea>' +
      '<button class="defect-chat-send btn btn-primary" onclick="sendPublicDefectMessage()">' +
        '<i class="ti ti-send"></i>' +
      '</button>' +
    '</div>' +
  '</div>';
}

function _getPublicDefectGuest() {
  try {
    const raw = localStorage.getItem(PUBLIC_DEFECT_GUEST_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && obj.name && obj.phone) return obj;
    return null;
  } catch (_) { return null; }
}

function savePublicDefectGuest() {
  const name = (document.getElementById('pub-def-name') || {}).value || '';
  const phone = (document.getElementById('pub-def-phone') || {}).value || '';
  if (!name.trim()) { showToast('Укажите имя', 'error'); return; }
  if (!phone.trim()) { showToast('Укажите телефон', 'error'); return; }
  localStorage.setItem(PUBLIC_DEFECT_GUEST_KEY, JSON.stringify({
    name: name.trim(), phone: phone.trim(),
  }));
  // Перерисуем композер
  const block = document.getElementById('defect-chat-block');
  if (block) {
    const composeOld = block.querySelector('.public-defect-introduce, .defect-chat-compose');
    if (composeOld) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = _renderPublicDefectComposer();
      composeOld.replaceWith(wrapper.firstElementChild);
    }
  }
  state._defectChatAttachments = [];
  // v2.39.0: сразу пинганём — сервер занесёт гостя в участники
  if (state._publicDefectToken) {
    _sendDefectHeartbeat(null, true);
    loadPublicDefectParticipants(state._publicDefectToken);
  }
}

function changePublicDefectGuest() {
  localStorage.removeItem(PUBLIC_DEFECT_GUEST_KEY);
  const block = document.getElementById('defect-chat-block');
  if (block) {
    const composeOld = block.querySelector('.defect-chat-compose');
    if (composeOld) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = _renderPublicDefectComposer();
      composeOld.replaceWith(wrapper.firstElementChild);
    }
  }
}

async function loadPublicDefectMessages(token) {
  const feed = document.getElementById('public-defect-chat-feed');
  if (!feed) return;
  try {
    const r = await fetch(API_BASE + '/api/public/defect/' + encodeURIComponent(token) + '/messages');
    if (!r.ok) {
      feed.innerHTML = '<div class="empty-block">Не удалось загрузить</div>';
      return;
    }
    const d = await r.json();
    _renderMessagesInto(feed, d.messages || [], document.getElementById('public-defect-chat-count'), /* publicView */ true);
    feed.dataset.sig = (d.messages || []).length + ':' + ((d.messages || []).length ? d.messages[d.messages.length - 1].id : '0');
  } catch (e) {
    feed.innerHTML = '<div class="empty-block">Ошибка сети</div>';
  }
}

// v2.39.0: polling для публичной страницы заявки
function _startPublicDefectPolling(token) {
  _stopPublicDefectPolling();
  // heartbeat сразу
  _sendDefectHeartbeat(null, true);
  state._publicPollTimer = setInterval(() => {
    if (state._publicDefectToken !== token) {
      _stopPublicDefectPolling();
      return;
    }
    _refreshPublicDefectMessagesSilently(token);
    loadPublicDefectParticipants(token);
  }, DEFECT_POLL_INTERVAL_MS);
  state._publicHbTimer = setInterval(() => {
    if (state._publicDefectToken !== token) { _stopPublicDefectPolling(); return; }
    _sendDefectHeartbeat(null, true);
  }, DEFECT_HEARTBEAT_INTERVAL_MS);
}

function _stopPublicDefectPolling() {
  if (state._publicPollTimer) { clearInterval(state._publicPollTimer); state._publicPollTimer = null; }
  if (state._publicHbTimer)   { clearInterval(state._publicHbTimer);   state._publicHbTimer = null; }
}

async function _refreshPublicDefectMessagesSilently(token) {
  const feed = document.getElementById('public-defect-chat-feed');
  if (!feed) return;
  try {
    const r = await fetch(API_BASE + '/api/public/defect/' + encodeURIComponent(token) + '/messages');
    if (!r.ok) return;
    const d = await r.json();
    const messages = d.messages || [];
    const prevSig = feed.dataset.sig || '';
    const newSig = messages.length + ':' + (messages.length ? messages[messages.length - 1].id : '0');
    if (prevSig === newSig) return;
    // v2.40.0: ping звуком на новое сообщение (для гостя свои не пингуют — гостевые имя сравним по name+phone из guest)
    if (prevSig && messages.length) {
      const prevLastId = parseInt(prevSig.split(':')[1] || '0', 10);
      const last = messages[messages.length - 1];
      const guest = _getPublicDefectGuest();
      const myDisplay = guest ? (guest.name + ' · ' + guest.phone) : null;
      const isMine = myDisplay && last.author_name === myDisplay;
      if (last.id > prevLastId && !last.is_system && !isMine) {
        _playDefectChatPing();
      }
    }
    const wasNearBottom = (feed.scrollHeight - feed.scrollTop - feed.clientHeight) < 80;
    _renderMessagesInto(feed, messages, document.getElementById('public-defect-chat-count'), true);
    feed.dataset.sig = newSig;
    if (!wasNearBottom) feed.scrollTop = feed.scrollHeight - feed.clientHeight - 80;
  } catch (_) {}
}

async function loadPublicDefectParticipants(token) {
  const box = document.getElementById('defect-participants');
  if (!box) return;
  try {
    const r = await fetch(API_BASE + '/api/public/defect/' + encodeURIComponent(token) + '/participants');
    if (!r.ok) return;
    const d = await r.json();
    renderDefectParticipants(box, d.participants || []);
  } catch (_) {}
}

async function sendPublicDefectMessage() {
  const token = state._publicDefectToken;
  if (!token) return;
  const guest = _getPublicDefectGuest();
  if (!guest) { showToast('Сначала представьтесь', 'error'); return; }
  const ta = document.getElementById('defect-chat-text');
  const text = (ta && ta.value || '').trim();
  const atts = state._defectChatAttachments || [];
  if (!text && !atts.length) { showToast('Напишите сообщение или прикрепите файл', 'error'); return; }
  const fd = new FormData();
  fd.append('author_name', guest.name);
  fd.append('author_phone', guest.phone);
  if (text) fd.append('text', text);
  atts.forEach((a, i) => fd.append('file_' + (i + 1), a.file, a.file.name));
  const sendBtn = document.querySelector('.defect-chat-send');
  if (sendBtn) sendBtn.disabled = true;
  try {
    const r = await fetch(API_BASE + '/api/public/defect/' + encodeURIComponent(token) + '/messages', {
      method: 'POST', body: fd,
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      showToast(e.message || 'Не удалось отправить', 'error');
      return;
    }
    if (ta) { ta.value = ''; autosizeDefectChatInput(ta); }
    state._defectChatAttachments = [];
    renderDefectChatAttachments();
    loadPublicDefectMessages(token);
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

// ============ ЭТАП 26: ПУБЛИЧНАЯ СТРАНИЦА КОРОБКИ ============

async function showPublicBox(token) {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app').style.display = 'none';
  const page = document.getElementById('public-page');
  page.style.display = 'flex';
  const body = document.getElementById('public-card-body');
  body.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-light);">Загружаем…</div>';
  try {
    const res = await fetchPublicObject('box', token);
    if (res.needPassword) {
      body.innerHTML = renderPublicPasswordGate('box', token, res.badPassword);
      const inp = document.getElementById('public-pw-input'); if (inp) inp.focus();
      return;
    }
    if (!res.ok) {
      body.innerHTML = renderPublicError(res.status);
      return;
    }
    body.innerHTML = renderPublicBoxCard(res.data, token);
  } catch (e) {
    body.innerHTML = renderPublicError('network');
  }
}

function renderPublicBoxCard(b, token) {
  let rows = '';
  const addRow = (label, value) => {
    if (!value) return;
    rows += '<div class="public-row"><span class="public-row-label">' + label +
      '</span><span class="public-row-value">' + value + '</span></div>';
  };
  addRow('Договор',    escapeHtml(b.contract_number ? '№' + b.contract_number : ''));
  addRow('Контрагент', escapeHtml(b.contractor_name || ''));
  if (b.description) addRow('Содержимое', escapeHtml(b.description));
  if (b.created_at)  addRow('Создана',    escapeHtml(String(b.created_at).slice(0, 10)));

  return '<div class="public-header">' +
    '<div class="public-brand">Atom <span class="brand-name-accent">CRM</span></div>' +
    '<h1 class="public-header-title">' + escapeHtml(b.name || ('Коробка #' + (b.id || ''))) + '</h1>' +
    '<div class="public-header-sub"><i class="ti ti-package"></i> Контейнер для отгрузки</div>' +
  '</div>' +
  '<div class="public-body">' + rows +
    (b.contract_id ? (
      '<button class="public-add-defect-btn" onclick="openDefectForm(\'contract\', \'' +
      escapeHtml(b.contract_id) + '\')">' +
      '<i class="ti ti-alert-circle"></i> Сообщить о замечании' +
    '</button>'
    ) : '') +
  '</div>' +
  '<div class="public-footer">' +
    'Внутренняя CRM-система ООО «Атомус Групп»<br>' +
    '<span style="font-size:11.5px;opacity:0.85;">Нужен полный доступ? Обратитесь в Атомус Групп.</span>' +
  '</div>';
}


function renderPublicError(status) {
  // v2.43.89: при отказе/ошибке показываем явное «Обратитесь в Атомус Групп»
  // чтобы гость, у которого нет доступа, понимал куда идти.
  const titleByStatus = (status === 404) ? 'Запись не найдена' :
                        (status === 403) ? 'Нет доступа' :
                        (status === 401) ? 'Нужен доступ' :
                        (status === 'network') ? 'Нет связи' : 'Ошибка';
  const explainByStatus = (status === 404)
      ? 'Возможно, токен устарел или ссылка неверна.'
      : (status === 403 || status === 401)
        ? 'У вас нет прав на просмотр этой записи.'
        : (status === 'network')
          ? 'Не удалось загрузить данные. Проверьте подключение.'
          : 'Произошла ошибка (код ' + status + ').';
  return '<div class="public-header">' +
    '<div class="public-brand">Atom <span class="brand-name-accent">CRM</span></div>' +
    '<h1 class="public-header-title">' + escapeHtml(titleByStatus) + '</h1>' +
  '</div>' +
  '<div class="public-body" style="text-align: center; padding: 32px 24px;">' +
    '<i class="ti ti-mood-sad" style="font-size: 48px; color: var(--text-light); display: block; margin-bottom: 12px;"></i>' +
    '<p style="color: var(--text); font-size: 14px; margin-bottom: 18px;">' + escapeHtml(explainByStatus) + '</p>' +
    '<div style="background: var(--brand-bg); border: 1px solid var(--brand); border-radius: 10px; padding: 14px 16px; text-align: left;">' +
      '<div style="font-weight: 600; font-size: 14px; color: var(--brand); margin-bottom: 6px;">' +
        '<i class="ti ti-info-circle"></i> Нужен доступ?' +
      '</div>' +
      '<div style="font-size: 13px; color: var(--text); line-height: 1.45;">' +
        'Обратитесь в компанию <b>«Атомус Групп»</b> — мы выдадим доступ к карточке и расскажем про статус заказа.' +
      '</div>' +
    '</div>' +
  '</div>';
}

// ============ ЭТАП 23+: ОБЩАЯ ПУБЛИЧНАЯ ФОРМА ЗАМЕЧАНИЙ /feedback ============

function showPublicFeedbackPage() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app').style.display = 'none';
  const page = document.getElementById('public-page');
  page.style.display = 'flex';
  const body = document.getElementById('public-card-body');
  body.innerHTML =
    '<div class="public-header">' +
      '<div class="public-brand">Atom <span class="brand-name-accent">CRM</span></div>' +
      '<h1 class="public-header-title">Обратная связь</h1>' +
      '<div class="public-header-sub"><i class="ti ti-message-circle"></i> ООО «Атомус Групп»</div>' +
    '</div>' +
    '<div class="public-body" style="padding: 24px;">' +
      '<p style="color: var(--text); font-size: 14px; line-height: 1.5; margin-bottom: 18px;">' +
        'Здесь вы можете оставить замечание, идею или вопрос. Мы рассмотрим и при необходимости свяжемся.' +
      '</p>' +
      '<button class="public-add-defect-btn" onclick="openGeneralDefectForm()" style="margin-top: 0;">' +
        '<i class="ti ti-alert-circle"></i> Оставить замечание' +
      '</button>' +
    '</div>' +
    '<div class="public-footer">' +
      'Внутренняя CRM-система ООО «Атомус Групп»<br>' +
    '<span style="font-size:11.5px;opacity:0.85;">Нужен полный доступ? Обратитесь в Атомус Групп.</span>' +
    '</div>';
}

/** Открывает форму общего замечания (публично, без авторизации). */
function openGeneralDefectForm() {
  state._defectFormState = {
    targetType: 'general',     // ← новый режим: публичная форма без привязки
    token: '',
    type: 'defect',
    description: '',
    author_name: '',
    author_phone: '',
    location: '',
    photos: [],
    category: '',
  };
  const m = document.getElementById('defect-form-modal');
  if (!m) return;
  m.innerHTML = renderDefectFormHtml();
  m.classList.add('visible');
}

// ---- QR-модалка для сборки/договора ----

async function showAssemblyQr(assemblyId, modelName, modelArticle, assemblyDate) {
  try {
    const r = await apiGet('/api/assemblies/' + assemblyId + '/public-token');
    const url = window.location.origin + '/a/' + r.public_token;
    openQrModal({
      title: 'QR-код · ' + (modelName || 'Сборка #' + assemblyId),
      subtitle: modelArticle ? 'Артикул: ' + modelArticle : '',
      url: url,
      type: 'assembly',
      // v2.45.420: пароль для получателя (договорный или глобальный для свободной сборки)
      password: r.public_password || '',
      contractId: r.contract_id || null,
      data: { assemblyId, modelName, modelArticle, assemblyDate, token: r.public_token },
    });
  } catch (e) {
    showToast('Не удалось получить QR', 'error');
  }
}

// v2.45.93: пакетная печать QR-наклеек для всех готовых сборок договора.
// Один клик → шлёт N заданий в очередь шлюза термопринтера. По одной
// странице с QR на каждую готовую сборку.
// v2.45.331/332: окно-предпросмотр перед пакетной печатью — список того, что
// распечатается (сборки + покупное), у каждой строки кнопка «убрать из печати».
// Возвращает Promise<{ready:[...], comp:[...]}> (что печатать) или null (отмена).
function _confirmBatchPrintModal(readyList, compList, boxList) {
  readyList = readyList || [];
  compList = compList || [];
  boxList = boxList || [];
  return new Promise((resolve) => {
    let m = document.getElementById('batch-print-modal');
    if (m) m.remove();
    m = document.createElement('div');
    m.id = 'batch-print-modal';
    m.className = 'modal-overlay visible';
    const removedAsm = new Set();
    const removedComp = new Set();
    const removedBox = new Set();
    const qtyOf = (it) => Math.max(1, Math.floor(Number(it.qty || it.qty_reserved || 1)));
    const headStyle = 'font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-light);font-weight:600;margin:12px 0 4px;';
    const delBtn = '<button class="bp-del" title="Убрать из печати" style="background:none;border:none;color:#B91C1C;cursor:pointer;padding:2px 4px;flex-shrink:0;font-size:15px;"><i class="ti ti-trash"></i></button>';
    const rowHtml = (kind, id, label, right) =>
      '<div class="bp-row" data-kind="' + kind + '" data-id="' + id + '" ' +
        'style="font-size:13px;padding:5px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;">' +
        '<span style="flex:1;min-width:0;">' + label + '</span>' +
        (right ? '<span style="color:var(--text-light);white-space:nowrap;">' + right + '</span>' : '') +
        delBtn +
      '</div>';
    let listHtml = '';
    if (readyList.length) {
      listHtml += '<div style="' + headStyle + '">Сборки</div>';
      readyList.forEach((a) => {
        const nm = [a.model_article, a.model_name].filter(Boolean).join(' · ') || ('Сборка #' + a.id);
        listHtml += rowHtml('asm', a.id, escapeHtml(nm), '');
      });
    }
    if (compList.length) {
      listHtml += '<div style="' + headStyle + '">Покупное / комплектующие</div>';
      compList.forEach((it) => {
        listHtml += rowHtml('comp', it.id, escapeHtml(it.name || ('Позиция #' + it.id)), qtyOf(it) + ' шт');
      });
    }
    if (boxList.length) {
      listHtml += '<div style="' + headStyle + '">Коробки (QR коробки вместо вложенных сборок)</div>';
      boxList.forEach((b) => {
        listHtml += rowHtml('box', b.id, escapeHtml(b.name || ('Коробка #' + b.id)), 'коробка');
      });
    }
    m.innerHTML =
      '<div class="modal" onclick="event.stopPropagation()" style="max-width:520px;">' +
        '<div class="modal-header"><h3><i class="ti ti-printer"></i> Печать QR-наклеек</h3>' +
          '<button class="modal-close" id="bp-close"><i class="ti ti-x"></i></button></div>' +
        '<div style="padding:14px 18px;max-height:55vh;overflow-y:auto;">' +
          '<div id="bp-total-txt" style="font-size:14px;font-weight:600;color:var(--text-dark);margin-bottom:4px;"></div>' +
          '<div style="font-size:12px;color:var(--text-light);line-height:1.5;">Можно убрать лишние наклейки кнопкой 🗑. Если шлюз сейчас оффлайн — задания подождут в очереди и напечатаются, как только он вернётся.</div>' +
          listHtml +
        '</div>' +
        '<div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;background:white;border-radius:0 0 12px 12px;">' +
          '<button class="btn btn-secondary" id="bp-cancel">Отмена</button>' +
          '<button class="btn btn-primary" id="bp-ok"></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(m);
    const calcTotal = () =>
      readyList.filter(x => !removedAsm.has(x.id)).length +
      boxList.filter(x => !removedBox.has(x.id)).length +
      compList.filter(x => !removedComp.has(x.id)).reduce((acc, it) => acc + qtyOf(it), 0);
    const refresh = () => {
      const t = calcTotal();
      const tt = m.querySelector('#bp-total-txt');
      if (tt) tt.textContent = 'Будет отправлено ' + t + ' наклеек на термопринтер';
      const okb = m.querySelector('#bp-ok');
      if (okb) {
        okb.innerHTML = '<i class="ti ti-printer"></i> Печать (' + t + ')';
        okb.disabled = (t === 0);
        okb.style.opacity = (t === 0) ? '0.5' : '';
      }
    };
    m.querySelectorAll('.bp-del').forEach((btn) => {
      btn.onclick = () => {
        const row = btn.closest('.bp-row');
        if (!row) return;
        const id = Number(row.getAttribute('data-id'));
        const kind = row.getAttribute('data-kind');
        if (kind === 'asm') removedAsm.add(id);
        else if (kind === 'box') removedBox.add(id);
        else removedComp.add(id);
        row.remove();
        refresh();
      };
    });
    const cleanup = (val) => { m.remove(); resolve(val); };
    m.querySelector('#bp-close').onclick = () => cleanup(null);
    m.querySelector('#bp-cancel').onclick = () => cleanup(null);
    m.querySelector('#bp-ok').onclick = () => {
      const selReady = readyList.filter(x => !removedAsm.has(x.id));
      const selComp = compList.filter(x => !removedComp.has(x.id));
      const selBoxes = boxList.filter(x => !removedBox.has(x.id));
      if (!selReady.length && !selComp.length && !selBoxes.length) { cleanup(null); return; }
      cleanup({ ready: selReady, comp: selComp, boxes: selBoxes });
    };
    m.onclick = (e) => { if (e.target === m) cleanup(null); };
    refresh();
  });
}

async function batchPrintContractQrs(contractId) {
  // Берём договор из текущего экрана — assemblies уже подгружены при рендере карточки
  const c = state.lastLoadedContract || {};
  if (!c || c.id !== contractId) {
    showToast('Открой карточку договора заново', 'error');
    return;
  }
  const ready = (c.assemblies || []).filter(a => a.status === 'ready');
  // v2.45.95/99/100: + component-позиции в резерве (кронштейны, пластины и т.д.)
  // — на них клеим QR договора с подписью «Дог.№ · Имя · 1 шт/комплект».
  // Этикеток печатается qty штук на каждую позицию.
  // v2.45.134: тянем спецификацию СВЕЖУЮ с сервера, а не из кэша экрана —
  // иначе если карточку открыли и сразу нажали печать (спецификация ещё не
  // догрузилась), покупные позиции (кронштейны) не попадали в печать.
  let items = [];
  try {
    const ts = Date.now();
    const fresh = await apiGet('/api/contracts/' + contractId + '/items?_=' + ts);
    items = fresh.items || [];
    // освежим и кэш экрана заодно
    if (state._specByContract && state._specByContract[contractId]) {
      state._specByContract[contractId].items = items;
    }
  } catch (e) {
    const spec = (state._specByContract && state._specByContract[contractId]) || {};
    items = (spec.items && spec.items.length) ? spec.items : (c.items || []);
  }
  const compItems = items.filter(it =>
    it && it.component_id && !it.model_id && Number(it.qty_reserved || 0) > 0
  );
  const compQtySum = compItems.reduce((acc, it) =>
    acc + Math.max(1, Math.floor(Number(it.qty || it.qty_reserved || 1))), 0);
  // Коробки договора: сборки, уже упакованные в коробку, по отдельности не печатаем —
  // вместо них печатаем QR самой коробки (он покрывает её содержимое).
  let boxes = [];
  let packed = new Set();
  try {
    const bm = await apiGet('/api/contracts/' + contractId + '/box-map');
    boxes = (bm && bm.boxes) || [];
    packed = new Set((bm && bm.packed_assembly_ids) || []);
  } catch (e) { /* нет данных по коробкам — печатаем как раньше */ }
  const readyUnpacked = ready.filter(a => !packed.has(a.id));
  const total = readyUnpacked.length + compQtySum + boxes.length;
  if (total === 0) {
    showToast('Нет готовых сборок, коробок и компонентов в резерве для печати', 'error');
    return;
  }
  // v2.45.331/332: окно со списком + возможность убрать отдельные наклейки
  const _sel = await _confirmBatchPrintModal(readyUnpacked, compItems, boxes);
  if (!_sel) return;
  const selReady = _sel.ready;
  const selComp = _sel.comp;
  const selBoxes = _sel.boxes || [];
  const selTotal = selReady.length + selBoxes.length + selComp.reduce((acc, it) => acc + Math.max(1, Math.floor(Number(it.qty || it.qty_reserved || 1))), 0);
  if (selTotal === 0) return;

  showToast('Отправляем ' + selTotal + ' заданий…', 'info');
  let ok = 0;
  const failed = [];
  for (const a of selReady) {
    try {
      // 1) получаем public-token для assembly
      const tok = await apiGet('/api/assemblies/' + a.id + '/public-token');
      const url = window.location.origin + '/a/' + tok.public_token;
      // 2) формируем подпись точно так же, как одиночная печать
      const captionData = {
        type: 'assembly',
        assemblyId: a.id,
        modelName: a.model_name || '',
        modelArticle: a.model_article || '',
        assemblyDate: a.assembly_date || '',
        contractNumber: c.contract_number || '',
        contractorName: (c.contractor && c.contractor.name) || '',
        execution: a.execution || '',
        ipClass: a.ip_class || '',
        execLabelSt: a.exec_label_st || '',
        execLabelNe: a.exec_label_ne || '',
      };
      const caption = (typeof _netPrintCaption === 'function') ? _netPrintCaption(captionData) : (a.model_name || '');
      // 3) отправляем задание в очередь шлюза
      const resp = await apiPost('/api/labels/print', {
        qr_url: url,
        caption: caption,
        copies: 1,
      });
      if (resp && resp.ok) {
        ok++;
      } else {
        failed.push({ id: a.id, name: a.model_name });
      }
    } catch (e) {
      failed.push({ id: a.id, name: a.model_name, err: e && e.message });
    }
  }
  // v2.45.95/100: компонент-позиции в резерве → QR договора + кастомный caption.
  // По одной этикетке на каждую единицу qty (если qty=2 → 2 этикетки),
  // на каждой подпись «… · 1 шт» / «1 комплект».
  if (selComp.length) {
    try {
      const ct = await apiGet('/api/contracts/' + contractId + '/public-token');
      const contractUrl = window.location.origin + '/c/' + ct.public_token;
      const contractNum = c.contract_number || ('#' + c.id);
      for (const it of selComp) {
        const itName = it.component_name || it.name || ('Поз. #' + it.id);
        const qty = Math.max(1, Math.floor(Number(it.qty || it.qty_reserved || 1)));
        const unit = _ccUnitLabel(it);
        const caption = ('Дог.' + contractNum + ' · ' + itName + ' · 1 ' + unit).slice(0, 80);
        // v2.45.x: QR покупной позиции = /c/{токен}?item=ID — скан отгружает
        // именно эту позицию (а не «вообще договор»).
        const itemUrl = contractUrl + '?item=' + it.id;
        try {
          const resp = await apiPost('/api/labels/print', {
            qr_url: itemUrl,
            caption: caption,
            copies: qty,
          });
          if (resp && resp.ok) {
            ok += qty;
          } else {
            failed.push({ id: it.id, name: itName });
          }
        } catch (e) {
          failed.push({ id: it.id, name: itName, err: e && e.message });
        }
      }
    } catch (e) {
      // Если не получили токен договора — все компоненты считаем неуспешными
      selComp.forEach(it => failed.push({
        id: it.id, name: it.component_name || it.name, err: 'нет токена договора',
      }));
    }
  }

  // Коробки → QR коробки (ссылка /b/{qr_token})
  for (const b of selBoxes) {
    try {
      const url = window.location.origin + '/b/' + b.qr_token;
      const caption = ('Дог.' + (c.contract_number || ('#' + c.id)) + ' · ' + (b.name || ('Коробка #' + b.id))).slice(0, 80);
      const resp = await apiPost('/api/labels/print', { qr_url: url, caption: caption, copies: 1 });
      if (resp && resp.ok) ok++;
      else failed.push({ id: b.id, name: b.name });
    } catch (e) {
      failed.push({ id: b.id, name: b.name, err: e && e.message });
    }
  }

  if (failed.length === 0) {
    showToast('📤 Отправлено ' + ok + ' QR-наклеек в очередь', 'success');
  } else if (ok === 0) {
    showToast('Не удалось отправить (ошибок: ' + failed.length + ')', 'error');
  } else {
    showToast('📤 Отправлено ' + ok + '/' + selTotal + '. Ошибки: ' + failed.length, 'info');
  }
}

async function showContractQr(contractId, number, contractorName) {
  try {
    const r = await apiGet('/api/contracts/' + contractId + '/public-token');
    const url = window.location.origin + '/c/' + r.public_token;
    // Пароль доступа к публичным кодам договора — показываем, чтобы отправить клиенту
    let pw = '';
    try {
      const pr = await apiGet('/api/contracts/' + contractId + '/public-password');
      pw = pr.public_password || '';
    } catch (e) {}
    openQrModal({
      title: 'QR-код · Договор ' + (number || '#' + contractId),
      subtitle: contractorName || '',
      url: url,
      type: 'contract',
      password: pw,
      contractId: contractId,
      data: {
        contractId: contractId,
        number: number,
        contractorName: contractorName,
        token: r.public_token,
      },
    });
  } catch (e) {
    showToast('Не удалось получить QR', 'error');
  }
}

// Перевыпуск пароля договора (старый перестаёт работать). Обновляет модалку.
async function regenContractPublicPw(contractId, number, contractorName) {
  if (!confirm('Перевыпустить пароль? Старый пароль перестанет работать — придётся выслать получателю новый.')) return;
  try {
    const resp = await apiPost('/api/contracts/' + contractId + '/public-password/regenerate', {});
    if (resp && resp.ok && resp.data && resp.data.public_password) {
      showToast('Новый пароль: ' + resp.data.public_password, 'success');
      showContractQr(contractId, number, contractorName);
    } else {
      showToast('Не удалось перевыпустить пароль', 'error');
    }
  } catch (e) {
    showToast('Ошибка перевыпуска пароля', 'error');
  }
}

function copyPublicPw(pw) {
  try {
    navigator.clipboard.writeText(String(pw));
    showToast('Пароль скопирован', 'success');
  } catch (e) {
    showToast('Пароль: ' + pw, 'info');
  }
}

function openQrModal(opts) {
  const m = document.getElementById('qr-modal');
  // ЭТАП 26: для коробок тоже показываем кнопку «Печать наклейки» (локальная)
  const showPrintBtn = (opts.type === 'assembly' || opts.type === 'box') && opts.data;
  const printOnclick = opts.type === 'box'
    ? "printSingleBoxLabel(" + JSON.stringify(opts.data) + ")"
    : "printSingleLabel(" + JSON.stringify(opts.data) + ")";
  // ЭТАП 33 (v2.43.4): сетевая печать на офисный термопринтер — для ВСЕХ типов QR
  // Кнопка появляется когда есть permission `labels_print` и есть opts.url.
  // Подпись на этикетке генерится автоматически из opts (см. _netPrintCaption).
  // v2.45.136/147: для физических наклеек (сборка/коробка/договор/доработка)
  // термопечать доступна без права labels_print — это объекты, которым клеят
  // стикер прямо на складе/упаковке (аккаунт там может быть без этого права).
  // Для прочих типов — по праву.
  const _physQrType = ['assembly', 'box', 'contract', 'defect'].includes(opts.type);
  const showNetPrintBtn = !!opts.url &&
    (showPrintBtn || _physQrType ||
      (typeof canPrintLabels === 'function' && canPrintLabels()));
  const netPrintData = showNetPrintBtn
    ? Object.assign({}, opts.data || {}, {
        qrUrl: opts.url,
        title: opts.title,
        type: opts.type,
      })
    : null;
  m.innerHTML =
    '<div class="modal modal-wide" onclick="event.stopPropagation()">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-qrcode"></i> ' + escapeHtml(opts.title) + '</h3>' +
        '<button class="modal-close" onclick="closeQrModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="qr-modal-body">' +
        (opts.subtitle ? '<div style="color: var(--text-light); margin-bottom: 12px; font-size: 13px;">' + escapeHtml(opts.subtitle) + '</div>' : '') +
        '<div class="qr-canvas-wrap" id="qr-canvas-wrap"></div>' +
        '<div class="qr-url-display">' + escapeHtml(opts.url) + '</div>' +
        (opts.password ? (
          '<div style="margin:14px 0; padding:12px 14px; background:#FFF7E6; border:1px solid #F0C36D; border-radius:10px; text-align:left;">' +
            '<div style="font-size:12px; color:#8a6d3b; font-weight:600; margin-bottom:6px;">' +
              '<i class="ti ti-lock"></i> Пароль для получателя' +
            '</div>' +
            '<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">' +
              '<span style="font-size:24px; font-weight:800; letter-spacing:4px; font-family:monospace; color:#5c4a1a;">' + escapeHtml(opts.password) + '</span>' +
              '<button class="btn btn-secondary" style="padding:6px 10px;" onclick="copyPublicPw(' + JSON.stringify(opts.password).replace(/"/g,'&quot;') + ')"><i class="ti ti-copy"></i> Копировать</button>' +
              (opts.contractId ? '<button class="btn btn-secondary" style="padding:6px 10px;" onclick="regenContractPublicPw(' + opts.contractId + ', ' + JSON.stringify(opts.data && opts.data.number || '').replace(/"/g,'&quot;') + ', ' + JSON.stringify(opts.data && opts.data.contractorName || '').replace(/"/g,'&quot;') + ')"><i class="ti ti-refresh"></i> Перевыпустить</button>' : '') +
            '</div>' +
            '<div style="font-size:11.5px; color:#8a6d3b; margin-top:8px; line-height:1.4;">' +
              'Без пароля QR договора, коробов и сборок «с улицы» не открыть. Отправьте пароль получателю.' +
            '</div>' +
          '</div>'
        ) : '') +
        '<div class="qr-actions">' +
          '<button class="btn btn-secondary" onclick="downloadQrPng(' + JSON.stringify(opts.url).replace(/"/g,'&quot;') + ', ' + JSON.stringify(opts.title).replace(/"/g,'&quot;') + ')"><i class="ti ti-download"></i> Скачать PNG</button>' +
          (showPrintBtn
            ? '<button class="btn btn-secondary" onclick=\'' + printOnclick + '\'><i class="ti ti-printer"></i> Печать наклейки</button>'
            : '') +
          (showNetPrintBtn
            ? '<button class="btn btn-primary" id="net-print-btn" onclick=\'openNetworkPrintModal(' + JSON.stringify(netPrintData).replace(/'/g, '&#39;') + ')\'><i class="ti ti-printer"></i> 🖨 На термопринтер</button>'
            : '') +
          '<button class="btn btn-secondary" onclick="copyQrUrl(' + JSON.stringify(opts.url).replace(/"/g,'&quot;') + ')"><i class="ti ti-copy"></i> Копировать ссылку</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
  // Генерируем QR — точно с тем caption который реально уйдёт на печать,
  // чтобы предпросмотр совпадал со стикером (WYSIWYG)
  setTimeout(() => {
    const wrap = document.getElementById('qr-canvas-wrap');
    if (!wrap) return;
    let previewCaption = '';
    try {
      // _netPrintCaption использует data.type — а у нас в opts ещё нет type.
      // Соберём суррогат: type из opts.type, остальные поля из opts.data.
      previewCaption = _netPrintCaption(Object.assign(
        {}, opts.data || {}, { type: opts.type || (opts.data && opts.data.type) || '' }
      ));
    } catch (_) { previewCaption = ''; }
    generateQrWithLogo(wrap, {
      text: opts.url,
      width: 220,
      caption: previewCaption,
    });
  }, 50);
}

function closeQrModal() {
  document.getElementById('qr-modal').classList.remove('visible');
}

// ============================================================================
// v2.45.7: QR с логотипом ATOMUS group в центре
// ============================================================================
// Берёт элемент-контейнер и опции для qrcodejs, рендерит QR, потом
// поверх центрального квадрата накладывает /icons/logo.png через Canvas API.
// Уровень коррекции ошибок принудительно поднимается до H (30%), чтобы
// сканер мог прочитать QR даже когда центр перекрыт логотипом.
const ATOMUS_QR_LOGO_URL = '/icons/logo.png';
let _atomusQrLogoImage = null;
function _getAtomusQrLogo() {
  return new Promise((resolve) => {
    if (_atomusQrLogoImage && _atomusQrLogoImage.complete && _atomusQrLogoImage.naturalWidth > 0) {
      resolve(_atomusQrLogoImage);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { _atomusQrLogoImage = img; resolve(img); };
    img.onerror = () => resolve(null);   // не нашли — рендерим QR без лого
    img.src = ATOMUS_QR_LOGO_URL;
  });
}

function generateQrWithLogo(el, opts) {
  if (typeof QRCode === 'undefined' || !el) return null;
  el.innerHTML = '';
  // v2.45.15: WYSIWYG-предпросмотр этикетки. Рендерим точную мини-копию
  // того что физически печатается термопринтером по ZPL-шаблону:
  //   • «ATOMUS» крупно
  //   • «group» мельче
  //   • QR (без оверлея лого внутри)
  //   • опционально — caption под QR, с переносом
  // Этикетка физически 58×60 мм (пропорция ~1:1.03), рамку рисуем чтоб
  // юзер сразу видел границы реального стикера.
  const size = opts.width || opts.height || 200;
  // Внутренний контейнер — пропорции стикера 58×60 мм с белым фоном и рамкой
  const labelW = Math.round(size * 1.5);
  const labelH = Math.round(labelW * (60 / 58));
  const sticker = document.createElement('div');
  sticker.className = 'qr-sticker-preview';
  sticker.style.cssText =
    'width:' + labelW + 'px;height:' + labelH + 'px;' +
    'background:#fff;border:1px solid var(--border, #d4d8dc);border-radius:8px;' +
    'padding:' + Math.round(labelW * 0.06) + 'px;' +
    'display:flex;flex-direction:column;align-items:center;justify-content:space-between;' +
    'box-shadow:0 2px 8px rgba(0,0,0,0.08);' +
    'font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1f2429;';

  // Бренд-блок: «ATOMUS» крупно + «group» мельче
  const brand = document.createElement('div');
  brand.style.cssText = 'text-align:center;line-height:1;';
  brand.innerHTML =
    '<div style="font-size:' + Math.round(labelW * 0.13) + 'px;font-weight:700;letter-spacing:0.5px;">ATOMUS</div>' +
    '<div style="font-size:' + Math.round(labelW * 0.08) + 'px;font-weight:500;letter-spacing:0.3px;margin-top:2px;">group</div>';
  sticker.appendChild(brand);

  // QR (центр)
  const qrHost = document.createElement('div');
  qrHost.style.cssText = 'display:flex;align-items:center;justify-content:center;';
  sticker.appendChild(qrHost);

  // Caption (если передан)
  const caption = (opts.caption || '').trim();
  if (caption) {
    const cap = document.createElement('div');
    cap.style.cssText =
      'text-align:center;font-size:' + Math.round(labelW * 0.055) + 'px;' +
      'line-height:1.25;word-break:break-word;max-width:100%;';
    cap.textContent = caption;
    sticker.appendChild(cap);
  } else {
    // Заглушка-распорка чтобы QR не уходил вниз
    const spacer = document.createElement('div');
    spacer.style.height = Math.round(labelW * 0.04) + 'px';
    sticker.appendChild(spacer);
  }

  el.appendChild(sticker);

  // QR-код примерно 50-55% от ширины стикера
  const qrSize = Math.round(labelW * (caption ? 0.50 : 0.58));
  const qr = new QRCode(qrHost, {
    text: opts.text || opts.url,
    width: qrSize,
    height: qrSize,
    colorDark: opts.colorDark || '#000000',
    colorLight: opts.colorLight || '#ffffff',
    correctLevel: QRCode.CorrectLevel.M,
  });
  return qr;
}

// ============================================================================
// ============ ЭТАП 33 (v2.43.2): СЕТЕВАЯ ПЕЧАТЬ НА ТЕРМОПРИНТЕР =============
// ============================================================================

// Состояние модалки сетевой печати
var _netPrintState = {
  data:          null,    // {assemblyId, modelName, modelArticle, qrUrl, title}
  copies:        1,
  gatewayStatus: null,    // последний полученный объект статуса шлюза
  statusTimer:   null,    // setInterval id для поллинга статуса
  inFlight:      false,   // блокировка повторных кликов
};

async function openNetworkPrintModal(data) {
  closeQrModal();
  _netPrintState.data = data || {};
  _netPrintState.copies = 1;
  _netPrintState.gatewayStatus = null;
  _netPrintState.inFlight = false;

  let modal = document.getElementById('net-print-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'net-print-modal';
    modal.className = 'modal-overlay';
    modal.onclick = function (e) { if (e.target === modal) closeNetworkPrintModal(); };
    document.body.appendChild(modal);
  }
  _renderNetworkPrintModal();
  modal.classList.add('visible');

  // Запуск поллинга статуса шлюза (раз в 30 сек) + сразу первый запрос
  loadGatewayStatus();
  if (_netPrintState.statusTimer) clearInterval(_netPrintState.statusTimer);
  _netPrintState.statusTimer = setInterval(loadGatewayStatus, 30000);
}

function closeNetworkPrintModal() {
  const m = document.getElementById('net-print-modal');
  if (m) m.classList.remove('visible');
  if (_netPrintState.statusTimer) {
    clearInterval(_netPrintState.statusTimer);
    _netPrintState.statusTimer = null;
  }
}

function _renderNetworkPrintModal() {
  const m = document.getElementById('net-print-modal');
  if (!m) return;
  const d = _netPrintState.data || {};
  const status = _netPrintState.gatewayStatus;
  const caption = _netPrintCaption(d);
  const copies = _netPrintState.copies || 1;
  const inFlight = !!_netPrintState.inFlight;

  // Индикатор статуса шлюза
  let statusBlock = '';
  if (status === null) {
    statusBlock = '<div class="np-status np-status-loading">⏳ Проверка статуса шлюза…</div>';
  } else if (!status.configured) {
    statusBlock = '<div class="np-status np-status-error">⚠ Шлюз не настроен на сервере (нет ATOMUS_GATEWAY_TOKEN в env)</div>';
  } else if (!status.online) {
    const pending = status.queue_size_pending || 0;
    if (pending > 0) {
      statusBlock = '<div class="np-status np-status-warn">🟡 Шлюз не на связи. В очереди уже ' + pending + ' задани' + _pluralize(pending, 'е', 'я', 'й') + ' — напечатается при возвращении</div>';
    } else {
      statusBlock = '<div class="np-status np-status-error">🔴 Шлюз offline. Задание встанет в очередь и напечатается когда шлюз вернётся</div>';
    }
  } else if (status.printer_status && status.printer_status !== 'ready') {
    statusBlock = '<div class="np-status np-status-error">🔴 Принтер: ' +
      escapeHtml(status.printer_status) +
      (status.printer_error ? ' · ' + escapeHtml(status.printer_error) : '') +
      '</div>';
  } else {
    let line = '🟢 Шлюз онлайн';
    if (status.name) line += ' · ' + escapeHtml(status.name);
    if (status.last_printer_ip) line += ' · принтер ' + escapeHtml(status.last_printer_ip);
    statusBlock = '<div class="np-status np-status-ok">' + line + '</div>';
  }

  m.innerHTML =
    '<div class="modal" style="max-width: 480px;" onclick="event.stopPropagation()">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-printer"></i> Печать на термопринтер</h3>' +
        '<button class="modal-close" onclick="closeNetworkPrintModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="np-body">' +
        statusBlock +
        '<div class="np-preview">' +
          '<div class="np-preview-label">Что напечатается:</div>' +
          '<div class="np-preview-caption">' + escapeHtml(caption) + '</div>' +
          '<div class="np-preview-url">' + escapeHtml(d.qrUrl || '') + '</div>' +
        '</div>' +
        '<div class="np-copies-row">' +
          '<label class="np-copies-label">Копий:</label>' +
          '<div class="np-copies-control">' +
            '<button class="np-copies-btn" onclick="changeNetPrintCopies(-1)" ' +
              (copies <= 1 ? 'disabled' : '') + '>−</button>' +
            '<input type="number" min="1" max="50" value="' + copies + '" ' +
              'id="np-copies-input" oninput="setNetPrintCopiesFromInput(this.value)" />' +
            '<button class="np-copies-btn" onclick="changeNetPrintCopies(1)" ' +
              (copies >= 50 ? 'disabled' : '') + '>+</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer" style="display:flex; gap:8px; justify-content:flex-end;">' +
        '<button class="btn btn-secondary" onclick="closeNetworkPrintModal()">Отмена</button>' +
        '<button class="btn btn-primary" id="np-submit-btn" onclick="submitNetworkPrint()" ' +
          (inFlight ? 'disabled' : '') + '>' +
          (inFlight ? '⏳ Отправка…' : '<i class="ti ti-printer"></i> Печать') +
        '</button>' +
      '</div>' +
    '</div>';
}

function _netPrintCaption(data) {
  // Подпись под QR — зависит от типа объекта
  if (!data) return 'QR';
  const t = data.type || '';

  if (t === 'assembly') {
    const parts = [];
    if (data.modelName) parts.push(String(data.modelName));
    if (data.assemblyId) parts.push('#' + data.assemblyId);
    return parts.join(' · ').slice(0, 80) || 'Сборка';
  }

  if (t === 'contract') {
    // «Договор №06ТД/04.26» (без двойного № — number уже содержит №)
    const num = data.number ? String(data.number) : ('#' + (data.contractId || ''));
    let caption = 'Договор ' + num;
    if (data.contractorName) {
      caption += ' · ' + String(data.contractorName);
    }
    return caption.slice(0, 80);
  }

  if (t === 'box') {
    // «Коробка #ID» или название коробки, + договор/контрагент если есть
    const parts = [];
    if (data.boxName) parts.push(String(data.boxName));
    else if (data.boxId) parts.push('Коробка #' + data.boxId);
    if (data.contractNumber) parts.push('Дог.' + data.contractNumber);
    return parts.join(' · ').slice(0, 80) || 'Коробка';
  }

  if (t === 'defect') {
    const parts = [];
    if (data.defectId) parts.push('Доработка #' + data.defectId);
    if (data.modelName) parts.push(String(data.modelName));
    return parts.join(' · ').slice(0, 80) || 'Доработка';
  }

  // Fallback — пробуем взять любые осмысленные поля
  const fallbackParts = [];
  if (data.modelName) fallbackParts.push(String(data.modelName));
  if (data.assemblyId) fallbackParts.push('#' + data.assemblyId);
  if (fallbackParts.length === 0 && data.title) {
    // Очищаем title от префикса «QR-код · » если есть
    fallbackParts.push(String(data.title).replace(/^QR-код\s*·\s*/i, ''));
  }
  return fallbackParts.join(' · ').slice(0, 80) || 'QR';
}

function _pluralize(n, one, few, many) {
  // Простое склонение для русского (задание/задания/заданий)
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function changeNetPrintCopies(delta) {
  const next = Math.max(1, Math.min(50, (_netPrintState.copies || 1) + delta));
  _netPrintState.copies = next;
  _renderNetworkPrintModal();
}

function setNetPrintCopiesFromInput(value) {
  let n = parseInt(value, 10);
  if (isNaN(n) || n < 1) n = 1;
  if (n > 50) n = 50;
  _netPrintState.copies = n;
  // НЕ перерисовываем — иначе курсор уходит из input. Только обновим кнопки.
  const minus = document.querySelector('#net-print-modal .np-copies-btn:first-of-type');
  const plus  = document.querySelector('#net-print-modal .np-copies-btn:last-of-type');
  if (minus) minus.disabled = (n <= 1);
  if (plus)  plus.disabled  = (n >= 50);
}

async function loadGatewayStatus() {
  try {
    const r = await apiGet('/api/labels/gateway-status');
    _netPrintState.gatewayStatus = r || {};
  } catch (e) {
    _netPrintState.gatewayStatus = { online: false, configured: false };
  }
  // Перерисовываем только если модалка открыта
  const m = document.getElementById('net-print-modal');
  if (m && m.classList.contains('visible')) {
    _renderNetworkPrintModal();
  }
}

async function submitNetworkPrint() {
  if (_netPrintState.inFlight) return;
  const d = _netPrintState.data || {};
  if (!d.qrUrl) {
    showToast('Нет данных QR-кода', 'error');
    return;
  }
  _netPrintState.inFlight = true;
  _renderNetworkPrintModal();

  const body = {
    qr_url:  d.qrUrl,
    caption: _netPrintCaption(d),
    copies:  _netPrintState.copies || 1,
  };
  try {
    const resp = await apiPost('/api/labels/print', body);
    if (!resp.ok) {
      const msg = (resp.data && (resp.data.message || resp.data.error)) || ('HTTP ' + resp.status);
      throw new Error(msg);
    }
    const queueId = resp.data && resp.data.queue_id;
    const status = _netPrintState.gatewayStatus;
    let toastMsg = '📤 Задание отправлено';
    if (queueId) toastMsg += ' (#' + queueId + ')';
    if (status && !status.online) {
      toastMsg += '. Напечатается когда шлюз вернётся на связь';
    }
    showToast(toastMsg, 'success');
    closeNetworkPrintModal();
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
    _netPrintState.inFlight = false;
    _renderNetworkPrintModal();
  }
}

function copyQrUrl(url) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => showToast('Ссылка скопирована', 'success'));
  } else {
    // fallback
    const t = document.createElement('textarea');
    t.value = url; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); showToast('Ссылка скопирована', 'success'); }
    catch (e) { showToast('Не удалось скопировать', 'error'); }
    document.body.removeChild(t);
  }
}

function downloadQrPng(url, title) {
  // Найдём канвас в qr-canvas-wrap
  const wrap = document.getElementById('qr-canvas-wrap');
  const canvas = wrap && wrap.querySelector('canvas');
  if (!canvas) {
    // Fallback: библиотека может рендерить img — извлекаем src
    const img = wrap && wrap.querySelector('img');
    if (!img) { showToast('QR не готов', 'error'); return; }
    const a = document.createElement('a');
    a.href = img.src;
    a.download = (title || 'qr') + '.png';
    a.click();
    return;
  }
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = (title || 'qr').replace(/[^а-яА-Я\w\s-]/g, '').slice(0, 64) + '.png';
  a.click();
}

// ---- Печать наклеек ----

// Одна наклейка
function printSingleLabel(data) {
  state._labelsToPrint = [Object.assign({ kind: 'assembly' }, data)];
  renderLabelsForPrint();
}

// ЭТАП 26: одна наклейка коробки
function printSingleBoxLabel(data) {
  state._labelsToPrint = [Object.assign({ kind: 'box' }, data)];
  renderLabelsForPrint();
}

// Массовая печать (вызывается с экрана Склад → Остатки)
function printSelectedLabels() {
  const stockList = (cache.warehouseStock && cache.warehouseStock.stock) || [];
  const selected = stockList.filter(s => state.warehouseSelected && state.warehouseSelected.has(s.id));
  if (!selected.length) {
    showToast('Не выбрано ни одной сборки', 'error');
    return;
  }
  // Соберём данные для каждой
  Promise.all(selected.map(async (s) => {
    try {
      const r = await apiGet('/api/assemblies/' + s.id + '/public-token');
      return {
        kind: 'assembly',
        assemblyId: s.id,
        modelName: s.model_name,
        modelArticle: s.model_article,
        assemblyDate: s.assembly_date,
        token: r.public_token,
      };
    } catch (e) { return null; }
  })).then(items => {
    state._labelsToPrint = items.filter(Boolean);
    renderLabelsForPrint();
  });
}

function renderLabelsForPrint() {
  const items = state._labelsToPrint || [];
  if (!items.length) { showToast('Нечего печатать', 'error'); return; }

  // ЭТАП 31.8: открываем в новом окне с автопечатью (вместо перекрытия UI)
  const w = window.open('', '_blank');
  if (!w) { showToast('Разрешите всплывающие окна в браузере', 'error'); return; }

  // Собираем массив URL'ов
  const labelsData = items.map(item => {
    const kind = item.kind || 'assembly';
    const prefix = kind === 'box' ? '/b/' : '/a/';
    return {
      kind: kind,
      url: window.location.origin + prefix + item.token,
      modelName: item.modelName || '',
      modelArticle: item.modelArticle || '',
      assemblyDate: item.assemblyDate || '',
      boxName: item.boxName || '',
      contractNumber: item.contractNumber || '',
      contractorName: item.contractorName || '',
    };
  });

  // v2.45.10: новая вёрстка стикера — как на физическом образце.
  // Сверху крупный ATOMUS group logo, под ним «ПОЛУЧАТЕЛЬ: <имя>», город,
  // телефон, и компактный QR в нижней части без лого внутри.
  const logoUrl = window.location.origin + '/icons/logo.png';
  const labelsBodies = labelsData.map((d, i) => {
    let title, sub1, sub2;
    if (d.kind === 'box') {
      title = d.boxName || 'Коробка';
      sub1 = d.contractorName ? 'Договор № ' + (d.contractNumber || '—') : '';
      sub2 = d.contractorName || '';
    } else {
      title = d.modelName || '—';
      sub1 = d.modelArticle || '';
      sub2 = d.assemblyDate ? 'от ' + d.assemblyDate : '';
    }
    return '<div class="label-58x60">' +
      '<img class="lbl-logo" src="' + logoUrl + '" alt="ATOMUS group">' +
      '<div class="lbl-receiver-label">ПОЛУЧАТЕЛЬ:</div>' +
      '<div class="lbl-receiver">' + escapeHtml(title) + '</div>' +
      (sub1 ? '<div class="lbl-sub">' + escapeHtml(sub1) + '</div>' : '') +
      (sub2 ? '<div class="lbl-sub">' + escapeHtml(sub2) + '</div>' : '') +
      '<div class="lbl-qr-row">' +
        '<div class="lbl-hint">Наведите камеру<br>телефона на QR-код<br>и перейдите на сайт.</div>' +
        '<div class="lbl-qr-wrap" id="lbl-qr-' + i + '"></div>' +
      '</div>' +
    '</div>';
  }).join('');

  const html =
    '<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">' +
    '<title>Печать наклеек · ' + items.length + ' шт.</title>' +
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>' +
    '<style>' +
      '@page { size: 58mm 60mm; margin: 0; }' +
      '* { box-sizing: border-box; }' +
      'body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; margin: 0; padding: 0; background: #f4f5f7; }' +
      '.print-btn { position: fixed; top: 14px; right: 14px; background: #2D5F8B; color: white; border: none; padding: 10px 18px; border-radius: 8px; cursor: pointer; font-size: 14px; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }' +
      '.preview { display: grid; grid-template-columns: repeat(auto-fill, 58mm); gap: 6mm; padding: 20px; }' +
      '.label-58x60 { width: 58mm; height: 60mm; padding: 3mm 3mm 2mm 3mm; border: 1px dashed #ccc; background: white; display: flex; flex-direction: column; align-items: center; page-break-after: always; }' +
      '.label-58x60:last-child { page-break-after: auto; }' +
      '.lbl-logo { width: 30mm; height: auto; margin: 0 auto 2mm auto; display: block; }' +
      '.lbl-receiver-label { font-size: 8pt; font-weight: 700; color: #1f2429; align-self: flex-start; margin-top: 1mm; letter-spacing: 0.3px; }' +
      '.lbl-receiver { font-size: 11pt; font-weight: 700; color: #1f2429; align-self: flex-start; line-height: 1.15; word-wrap: break-word; margin-top: 0.5mm; }' +
      '.lbl-sub { font-size: 7.5pt; color: #4b5563; align-self: flex-start; line-height: 1.2; margin-top: 0.5mm; }' +
      '.lbl-qr-row { display: flex; align-items: center; gap: 2mm; margin-top: auto; width: 100%; padding-top: 1mm; }' +
      '.lbl-hint { font-size: 6.5pt; color: #4b5563; line-height: 1.25; flex: 1; }' +
      '.lbl-qr-wrap { width: 17mm; height: 17mm; display: flex; align-items: center; justify-content: center; flex: 0 0 17mm; }' +
      '.lbl-qr-wrap img, .lbl-qr-wrap canvas { width: 100%; height: 100%; }' +
      '@media print { .print-btn { display: none; } .preview { padding: 0; gap: 0; grid-template-columns: 58mm; } .label-58x60 { border: none; } body { background: white; } }' +
    '</style></head><body>' +
    '<button class="print-btn" onclick="window.print()">🖨️ Печать (' + items.length + ' шт.)</button>' +
    '<div class="preview">' + labelsBodies + '</div>' +
    '<script>window.__labels = ' + JSON.stringify(labelsData) + ';' +
    'window.addEventListener("DOMContentLoaded", function(){' +
      'window.__labels.forEach(function(d, i){' +
        'var el = document.getElementById("lbl-qr-" + i);' +
        'if (!el) return;' +
        // v2.45.10: QR без оверлея, лого живёт сверху в шапке стикера
        'new QRCode(el, { text: d.url, width: 64, height: 64, correctLevel: QRCode.CorrectLevel.M });' +
      '});' +
      'setTimeout(function(){window.print();}, 400);' +
    '});<\/script>' +
    '</body></html>';

  w.document.open();
  w.document.write(html);
  w.document.close();
}

// closeLabelsView — больше не нужна (старый поверх-UI режим убран),
// но оставляем заглушку чтобы старые ссылки не сломались
function closeLabelsView() {
  const lp = document.getElementById('labels-page');
  if (lp) lp.style.display = 'none';
  const app = document.getElementById('app');
  if (app) app.style.display = 'flex';
}

// ---- Селект сборок в Складе ----

state.warehouseSelected = new Set();

function toggleWarehouseSelect(assemblyId, checked) {
  if (!state.warehouseSelected) state.warehouseSelected = new Set();
  if (checked) state.warehouseSelected.add(assemblyId);
  else state.warehouseSelected.delete(assemblyId);
  updateBulkActionBar();
}

function updateBulkActionBar() {
  const bar = document.getElementById('wh-bulk-bar');
  if (!bar) return;
  const n = state.warehouseSelected ? state.warehouseSelected.size : 0;
  if (n > 0) {
    bar.classList.remove('hidden');
    const countEl = document.getElementById('wh-bulk-count');
    if (countEl) countEl.textContent = n;
  } else {
    bar.classList.add('hidden');
  }
}

function clearWarehouseSelection() {
  state.warehouseSelected = new Set();
  document.querySelectorAll('.wh-stock-row input[type="checkbox"]').forEach(cb => cb.checked = false);
  updateBulkActionBar();
}


// ============================================================
// ============ ЭТАП 22.1: ПРОКРУТКА ТАБОВ В ШАПКЕ ============
// ============================================================

function updateSectionScrollState() {
  const nav  = document.getElementById('section-switcher');
  const wrap = document.getElementById('section-switcher-wrap');
  const btnL = document.getElementById('section-scroll-left');
  const btnR = document.getElementById('section-scroll-right');
  if (!nav || !wrap) return;
  // Сколько скрыто слева/справа
  const scrollLeft = nav.scrollLeft;
  const maxScroll  = nav.scrollWidth - nav.clientWidth;
  const hasLeft    = scrollLeft > 2;
  const hasRight   = scrollLeft < maxScroll - 2;
  // ЭТАП 25.0: стрелки всегда видны (visible), приглушаем когда некуда скроллить
  if (btnL) {
    btnL.classList.add('visible');
    btnL.classList.toggle('disabled', !hasLeft);
  }
  if (btnR) {
    btnR.classList.add('visible');
    btnR.classList.toggle('disabled', !hasRight);
  }
  // Fade-эффекты по краям ленты
  wrap.classList.toggle('fade-left',  hasLeft);
  wrap.classList.toggle('fade-right', hasRight);
}

function scrollSectionTabs(direction) {
  const nav = document.getElementById('section-switcher');
  if (!nav) return;
  // ЭТАП 25.0: уменьшен шаг до ~одного таба за клик (раньше было 60% ширины)
  const step = 200 * direction;
  nav.scrollBy({ left: step, behavior: 'smooth' });
}

function scrollActiveTabIntoView() {
  const nav    = document.getElementById('section-switcher');
  if (!nav) return;
  const active = nav.querySelector('.section-tab.active');
  if (!active) { updateSectionScrollState(); return; }
  // Считаем позицию: если таб уже виден — не трогаем
  const navRect = nav.getBoundingClientRect();
  const tabRect = active.getBoundingClientRect();
  const margin = 24;  // отступ от края чтобы таб не прижимался
  if (tabRect.left < navRect.left + margin) {
    nav.scrollBy({ left: tabRect.left - navRect.left - margin, behavior: 'smooth' });
  } else if (tabRect.right > navRect.right - margin) {
    nav.scrollBy({ left: tabRect.right - navRect.right + margin, behavior: 'smooth' });
  }
  // Обновим стрелки после анимации
  setTimeout(updateSectionScrollState, 350);
}

// Колесо мыши → горизонтальный скролл (только над nav)
function attachSectionTabsWheelHandler() {
  const nav = document.getElementById('section-switcher');
  if (!nav) return;
  nav.addEventListener('wheel', (e) => {
    // Если есть вертикальное направление — конвертируем в горизонтальное
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      nav.scrollBy({ left: e.deltaY, behavior: 'auto' });
    }
  }, { passive: false });
  nav.addEventListener('scroll', updateSectionScrollState, { passive: true });
  window.addEventListener('resize', updateSectionScrollState);

  // ЭТАП 22.1+: Аналогичная логика для мобильных табов
  const mNav = document.getElementById('m-section-tabs');
  if (mNav) {
    mNav.addEventListener('scroll', updateMobileTabsScrollState, { passive: true });
    window.addEventListener('resize', updateMobileTabsScrollState);
    setTimeout(updateMobileTabsScrollState, 100);
  }
}

function updateMobileTabsScrollState() {
  const nav  = document.getElementById('m-section-tabs');
  const wrap = document.getElementById('m-section-tabs-wrap');
  const next = document.getElementById('m-section-tabs-next');
  if (!nav || !wrap) return;
  const scrollLeft = nav.scrollLeft;
  const maxScroll  = nav.scrollWidth - nav.clientWidth;
  const hasLeft    = scrollLeft > 2;
  const hasRight   = scrollLeft < maxScroll - 2;
  wrap.classList.toggle('fade-left',  hasLeft);
  wrap.classList.toggle('fade-right', hasRight);
  if (next) next.classList.toggle('visible', hasRight);
}

function scrollMobileTabs(direction) {
  const nav = document.getElementById('m-section-tabs');
  if (!nav) return;
  const step = Math.max(140, Math.floor(nav.clientWidth * 0.6)) * direction;
  nav.scrollBy({ left: step, behavior: 'smooth' });
}

function scrollActiveMobileTabIntoView() {
  const nav    = document.getElementById('m-section-tabs');
  if (!nav) return;
  const active = nav.querySelector('button.active');
  if (!active) { updateMobileTabsScrollState(); return; }
  const navRect = nav.getBoundingClientRect();
  const tabRect = active.getBoundingClientRect();
  const margin = 24;
  if (tabRect.left < navRect.left + margin) {
    nav.scrollBy({ left: tabRect.left - navRect.left - margin, behavior: 'smooth' });
  } else if (tabRect.right > navRect.right - margin) {
    nav.scrollBy({ left: tabRect.right - navRect.right + margin, behavior: 'smooth' });
  }
  setTimeout(updateMobileTabsScrollState, 350);
}

// ============================================================
// ============ ЭТАП 21: СКАНЕР QR-КОДОВ ============
// ============================================================

state._qrScannerInstance = null;
state._qrScannerLibLoading = null;

/**
 * Лениво подгружает библиотеку html5-qrcode. Возвращает Promise.
 * Кэширует результат — при повторных вызовах сразу резолвится.
 */
function loadQrScannerLib() {
  if (typeof Html5Qrcode !== 'undefined') return Promise.resolve(true);
  if (state._qrScannerLibLoading) return state._qrScannerLibLoading;
  state._qrScannerLibLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      state._qrScannerLibLoading = null; // дать ретрай
      reject(new Error('Не удалось загрузить библиотеку сканера'));
    };
    document.head.appendChild(script);
  });
  return state._qrScannerLibLoading;
}

async function openQrScanner() {
  const overlay = document.getElementById('qr-scanner-overlay');
  overlay.classList.add('visible');
  document.getElementById('qr-scanner-error').style.display = 'none';
  document.getElementById('qr-scanner-hint').style.display = '';
  document.getElementById('qr-scanner-hint').textContent = 'Загружаем сканер…';

  // Лениво грузим библиотеку
  try {
    await loadQrScannerLib();
  } catch (e) {
    showQrScannerError('Не удалось загрузить сканер. Проверьте интернет и попробуйте снова.');
    return;
  }
  document.getElementById('qr-scanner-hint').textContent = 'Наведите камеру на QR-код наклейки';

  if (typeof Html5Qrcode === 'undefined') {
    showQrScannerError('Сканер недоступен');
    return;
  }

  // Создаём инстанс сканера
  try {
    const scanner = new Html5Qrcode('qr-reader', { verbose: false });
    state._qrScannerInstance = scanner;
    await scanner.start(
      { facingMode: 'environment' },
      {
        fps: 10,
        qrbox: function(viewfinderWidth, viewfinderHeight) {
          const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
          const size = Math.floor(minEdge * 0.75);
          return { width: size, height: size };
        },
        aspectRatio: 1.0,
        // Среднее разрешение — 1280×720. Высокие (1920×1080) могут глючить на Huawei.
        videoConstraints: {
          facingMode: 'environment',
          width:  { ideal: 1280 },
          height: { ideal: 720 },
        },
        // BarcodeDetector НЕ включаем — на части Android (особенно Huawei) он падает молча
        // и html5-qrcode не делает fallback. JS-декодер (jsQR) работает везде.
      },
      (decodedText) => {
        handleQrScanResult(decodedText);
      },
      (errorMessage) => { /* ignore */ }
    );
    // Включаем непрерывный автофокус (если поддерживается)
    try {
      const v = document.querySelector('#qr-reader video');
      if (v && v.srcObject) {
        const track = v.srcObject.getVideoTracks()[0];
        if (track && track.applyConstraints) {
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
        }
        // ЭТАП 25.0: zoom slider если камера поддерживает программный zoom
        setupQrZoom(track);
      }
    } catch (e) { /* ignore */ }
  } catch (e) {
    console.error('QR scanner error:', e);
    showQrScannerError(e && e.message ? e.message : 'Не удалось запустить камеру');
  }
}

/**
 * Скан QR из загруженного файла (фото из галереи).
 * Самый надёжный способ — статичная картинка декодируется лучше чем видеопоток.
 */
async function scanQrFromFile(fileInput) {
  if (!fileInput.files || !fileInput.files.length) return;
  const file = fileInput.files[0];
  try {
    if (typeof Html5Qrcode === 'undefined') {
      await loadQrScannerLib();
    }
    // Создаём временный инстанс для scanFile (не привязан к камере)
    const tmpDivId = 'qr-file-tmp-' + Date.now();
    const tmpDiv = document.createElement('div');
    tmpDiv.id = tmpDivId;
    tmpDiv.style.display = 'none';
    document.body.appendChild(tmpDiv);
    try {
      const fileScanner = new Html5Qrcode(tmpDivId, { verbose: false });
      const decodedText = await fileScanner.scanFile(file, false);
      // Очищаем инпут для возможности повторного выбора того же файла
      fileInput.value = '';
      handleQrScanResult(decodedText);
    } finally {
      tmpDiv.remove();
    }
  } catch (e) {
    fileInput.value = '';
    showToast('Не удалось распознать QR на фото', 'error');
  }
}

/**
 * Ручной ввод URL/токена — fallback на случай если камера не справляется.
 * Распарсит наш формат /a/{token} или /c/{token} либо чистый токен.
 */
function openQrManualEntry() {
  const input = prompt('Введите ссылку или токен с наклейки:\n\nПример: https://atomus-pwa.vercel.app/a/abc123\nили просто: abc123');
  if (!input) return;
  const text = input.trim();
  if (!text) return;
  // ЭТАП 26.3: пускаем через общий обработчик — он сам разберёт URL/токен через /api/qr/lookup
  closeQrScanner();
  handleQrScanResult(text);
}

function showQrScannerError(msg) {
  const err = document.getElementById('qr-scanner-error');
  const txt = document.getElementById('qr-scanner-error-text');
  if (txt) {
    if (/permission|denied|notallowed/i.test(msg)) {
      txt.textContent = 'Доступ к камере заблокирован. Разрешите его в настройках браузера.';
    } else if (/no.*camera|notfound/i.test(msg)) {
      txt.textContent = 'Камера не найдена на этом устройстве.';
    } else {
      txt.textContent = 'Не удалось запустить камеру: ' + msg;
    }
  }
  if (err) err.style.display = '';
  document.getElementById('qr-scanner-hint').style.display = 'none';
}

async function closeQrScanner() {
  const overlay = document.getElementById('qr-scanner-overlay');
  overlay.classList.remove('visible');
  // ЭТАП 25.0: скрыть зум-bar
  const zb = document.getElementById('qr-zoom-bar');
  if (zb) zb.style.display = 'none';
  state._qrZoomTrack = null;
  // ЭТАП 26.2: сбрасываем continuous-режим если был
  if (state._qrContinuousMode) {
    state._qrContinuousMode = false;
    overlay.classList.remove('continuous-mode');
    const cnt = document.getElementById('ship-counter');    if (cnt) cnt.classList.remove('visible');
    const fb  = document.getElementById('ship-finish-btn'); if (fb)  fb.classList.remove('visible');
    const last = document.getElementById('ship-last');      if (last) last.classList.remove('visible');
  }
  // Останавливаем камеру
  if (state._qrScannerInstance) {
    try {
      await state._qrScannerInstance.stop();
      await state._qrScannerInstance.clear();
    } catch (e) {
      // ignore
    }
    state._qrScannerInstance = null;
  }
}

// ============ ЭТАП 25.0: ЗУМ КАМЕРЫ В QR-СКАНЕРЕ ============

function setupQrZoom(track) {
  const bar = document.getElementById('qr-zoom-bar');
  const slider = document.getElementById('qr-zoom-slider');
  if (!bar || !slider || !track) return;
  state._qrZoomTrack = null;
  try {
    const caps = (typeof track.getCapabilities === 'function') ? track.getCapabilities() : null;
    if (!caps || typeof caps.zoom === 'undefined') {
      // Зум не поддерживается этим устройством/браузером — прячем slider
      bar.style.display = 'none';
      return;
    }
    const minZ = (typeof caps.zoom.min === 'number') ? caps.zoom.min : 1;
    const maxZ = (typeof caps.zoom.max === 'number') ? caps.zoom.max : 10;
    const stepZ = (typeof caps.zoom.step === 'number' && caps.zoom.step > 0) ? caps.zoom.step : 0.1;
    let curZ = minZ;
    try {
      const s = track.getSettings && track.getSettings();
      if (s && typeof s.zoom === 'number') curZ = s.zoom;
    } catch (e) {}
    slider.min = String(minZ);
    slider.max = String(maxZ);
    slider.step = String(stepZ);
    slider.value = String(curZ);
    state._qrZoomTrack = track;
    state._qrZoomMin = minZ;
    state._qrZoomMax = maxZ;
    state._qrZoomStep = stepZ;
    bar.style.display = 'flex';
  } catch (e) {
    bar.style.display = 'none';
  }
}

async function onQrZoomSlider(value) {
  const track = state._qrZoomTrack;
  if (!track) return;
  const v = Number(value);
  try {
    await track.applyConstraints({ advanced: [{ zoom: v }] });
  } catch (e) {
    // ignore
  }
}

async function changeQrZoom(delta) {
  const track = state._qrZoomTrack;
  const slider = document.getElementById('qr-zoom-slider');
  if (!track || !slider) return;
  const step = Math.max(state._qrZoomStep || 0.1, 0.5);
  const min = state._qrZoomMin || 1;
  const max = state._qrZoomMax || 10;
  let v = Number(slider.value) + delta * step;
  if (v < min) v = min;
  if (v > max) v = max;
  slider.value = String(v);
  onQrZoomSlider(v);
}

// ============ КОНЕЦ ЗУМА QR ============

async function handleQrScanResult(decodedText) {
  // Не дёргать handler многократно — закрываем сразу
  if (state._qrScanProcessing) return;
  state._qrScanProcessing = true;

  // ЭТАП 26.2: если включен continuous-режим (отгрузка) — отдельная обработка
  if (state._qrContinuousMode) {
    try {
      await handleContinuousShipmentScan(String(decodedText || '').trim());
    } catch (e) {
      console.error('continuous scan error:', e);
    }
    // Снимаем процессинг через 800мс (дебаунс) чтобы не зачитать ту же коробку дважды
    setTimeout(() => { state._qrScanProcessing = false; }, 800);
    return;
  }

  try {
    const text = String(decodedText || '').trim();
    // ЭТАП 26.3: Сначала пробуем распарсить URL → достать токен
    let token = '';
    let url;
    try { url = new URL(text); } catch (e) { url = null; }

    if (url) {
      // /a/{token} | /b/{token} | /c/{token}
      const m = url.pathname.match(/^\/[abc]\/([A-Za-z0-9_\-]+)$/);
      if (m) {
        token = m[1];
        // v2.45.208: QR изделия — /c/{token}?item=ID → карточка позиции
        if (url.pathname.indexOf('/c/') === 0) {
          const _itm = url.searchParams.get('item');
          if (_itm) {
            await closeQrScanner();
            state._qrScanProcessing = false;
            showPublicContract(token, _itm);
            return;
          }
        }
      } else {
        // Это URL, но не наш — спросим
        if (confirm('Распознана ссылка:\n\n' + text + '\n\nОткрыть в новой вкладке?')) {
          window.open(text, '_blank', 'noopener');
        }
        await closeQrScanner();
        state._qrScanProcessing = false;
        return;
      }
    } else if (/^[A-Za-z0-9_\-]+$/.test(text) && text.length >= 6 && text.length <= 40) {
      // Похоже на чистый токен (URL-safe base64)
      token = text;
    }

    if (token) {
      await closeQrScanner();
      await routeScannedToken(token);
      state._qrScanProcessing = false;
      return;
    }

    // Не URL и не похоже на токен — просто покажем
    alert('Распознан QR-код:\n\n' + text);
    await closeQrScanner();
  } finally {
    setTimeout(() => { state._qrScanProcessing = false; }, 500);
  }
}

// ЭТАП 26.3: универсальный маршрутизатор по токену через /api/qr/lookup
async function routeScannedToken(token) {
  let info;
  try {
    const r = await fetch(API_BASE + '/api/qr/lookup/' + encodeURIComponent(token), {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    if (r.status === 404) {
      showToast('QR не найден в системе', 'error');
      return;
    }
    if (!r.ok) {
      showToast('Не удалось распознать QR', 'error');
      return;
    }
    info = await r.json();
  } catch (e) {
    showToast('Ошибка связи', 'error');
    return;
  }
  if (!info || !info.type) {
    showToast('QR не распознан', 'error');
    return;
  }

  // Договор → открываем карточку (как и раньше)
  if (info.type === 'contract') {
    state.currentContractId = info.id;
    selectSection('sales');
    selectSidebarItem('sales-contract-detail');
    return;
  }

  // v2.45.384: сборка/чиллер с производственной работой → проваливаемся в карточку работы
  if (info.type === 'assembly' && info.work_id && typeof openProductionWorkDetail === 'function') {
    openProductionWorkDetail(info.work_id);
    return;
  }

  // Сборка с привязанным договором, ещё не отгружена → предлагаем отгрузку
  if (info.type === 'assembly' && info.contract_id && !info.is_shipped) {
    const cNum = info.contract_number || ('#' + info.contract_id);
    const cName = info.contractor_name ? ' · ' + info.contractor_name : '';
    if (confirm(
      'Сборка «' + (info.name || '') + '» из договора ' + cNum + cName +
      '.\n\nОткрыть отгрузку по договору?'
    )) {
      openShipmentMode(info.contract_id);
      return;
    }
    // Если отказался — открываем сборку
    selectSection('warehouse');
    selectSidebarItem('warehouse-stock');
    setTimeout(() => openAssemblyStock(info.id), 200);
    return;
  }

  // Сборка без договора / уже отгружена → стандартное поведение (карточка сборки)
  if (info.type === 'assembly') {
    selectSection('warehouse');
    selectSidebarItem('warehouse-stock');
    setTimeout(() => openAssemblyStock(info.id), 200);
    return;
  }

  // Коробка → если есть договор и не отгружена — сразу в отгрузку договора
  if (info.type === 'box') {
    if (!info.contract_id) {
      showToast('Коробка не привязана к договору', 'error');
      return;
    }
    if (info.is_shipped) {
      showToast('Эта коробка уже отгружена', 'info');
      // Всё равно открываем экран отгрузки — там видно когда и кем
    }
    openShipmentMode(info.contract_id);
    return;
  }
}

// Сотрудник отсканировал QR сборки → открываем карточку в CRM
async function openAssemblyByPublicToken(token) {
  try {
    // Достаём публичные данные → получаем ID. Сотрудник шлёт токен сессии —
    // тогда бэкенд не требует публичный пароль договора.
    const _t = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/public/assembly/' + encodeURIComponent(token),
      _t ? { headers: { 'Authorization': 'Bearer ' + _t } } : undefined);
    if (!r.ok) {
      showToast('Сборка не найдена', 'error');
      return;
    }
    const data = await r.json();
    if (!data.id) {
      showToast('Не удалось определить сборку', 'error');
      return;
    }
    // Открываем модалку склада с этой сборкой
    selectSection('warehouse');
    selectSidebarItem('warehouse-stock');
    setTimeout(() => openAssemblyStock(data.id), 200);
  } catch (e) {
    showToast('Ошибка загрузки', 'error');
  }
}

// Сотрудник отсканировал QR договора → открываем карточку договора
async function openContractByPublicToken(token) {
  try {
    const _t = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/public/contract/' + encodeURIComponent(token),
      _t ? { headers: { 'Authorization': 'Bearer ' + _t } } : undefined);
    if (!r.ok) {
      showToast('Договор не найден', 'error');
      return;
    }
    const data = await r.json();
    if (!data.id) {
      showToast('Не удалось определить договор', 'error');
      return;
    }
    state.currentContractId = data.id;
    selectSection('sales');
    selectSidebarItem('sales-contract-detail');
  } catch (e) {
    showToast('Ошибка загрузки', 'error');
  }
}


// ============================================================
// ============ ЭТАП 22: ДОРАБОТКИ (замечания) ============
// ============================================================

state.defectsFilter = 'all';  // all | new | in_progress | resolved | rejected
state._defectFormState = null;
state.currentDefectId = null;

const DEFECT_TYPE_LABELS = {
  defect:      { label: 'Дефект',    icon: 'ti-bug',          cls: 't-defect' },
  issue:       { label: 'Замечание', icon: 'ti-alert-circle', cls: 't-issue' },
  improvement: { label: 'Улучшение', icon: 'ti-bulb',         cls: 't-improvement' },
  question:    { label: 'Вопрос',    icon: 'ti-help-circle',  cls: 't-question' },
};

// --------- Публичная форма (вызывается с публичной страницы) ---------

function openDefectForm(targetType, token) {
  // targetType: 'assembly' | 'contract'
  state._defectFormState = {
    targetType,
    token,
    type: 'defect',
    description: '',
    author_name: '',
    author_phone: '',
    location: '',
    photos: [],   // [{file, dataUrl, kind}] v2.36.0
    category: '',
  };
  const m = document.getElementById('defect-form-modal');
  if (!m) return;
  m.innerHTML = renderDefectFormHtml();
  m.classList.add('visible');
}

function closeDefectForm() {
  const m = document.getElementById('defect-form-modal');
  if (m) m.classList.remove('visible');
  state._defectFormState = null;
}

function renderDefectFormHtml() {
  const s = state._defectFormState;
  if (!s) return '';
  let typeTabs = '';
  Object.entries(DEFECT_TYPE_LABELS).forEach(([k, v]) => {
    const active = s.type === k ? ' active ' + v.cls : '';
    typeTabs += '<button class="defect-type-pill' + active + '" onclick="setDefectType(\'' + k + '\')"><i class="ti ' + v.icon + '"></i>' + v.label + '</button>';
  });

  // v2.36.0: dropdown категории
  let catOptions = '<option value="">— Не указана —</option>';
  Object.entries(DEFECT_CATEGORY_LABELS).forEach(([k, v]) => {
    const sel = s.category === k ? ' selected' : '';
    catOptions += '<option value="' + k + '"' + sel + '>' + escapeHtml(v) + '</option>';
  });

  // v2.36.0: превью файлов — фото/видео/документ
  let filePreviews = '';
  (s.photos || []).forEach((p, i) => {
    filePreviews += _renderDefectFilePreview(p, i);
  });

  return '<div class="modal" onclick="event.stopPropagation()" style="max-width: 520px;">' +
    '<div class="modal-header">' +
      '<h3><i class="ti ti-alert-circle"></i> Новая заявка</h3>' +
      '<button class="modal-close" onclick="closeDefectForm()"><i class="ti ti-x"></i></button>' +
    '</div>' +
    '<div class="modal-content">' +
      '<div class="defect-form">' +
        '<div class="form-group"><label>Тип</label><div class="defect-type-tabs">' + typeTabs + '</div></div>' +
        '<div class="form-group"><label>Категория проблемы</label>' +
          '<select id="def-category" onchange="state._defectFormState.category = this.value">' + catOptions + '</select>' +
        '</div>' +
        '<div class="form-group"><label>Описание *</label>' +
          '<textarea id="def-description" rows="4" placeholder="Что случилось? Например: «Течёт вода в камере созревания, конденсат на нижнем коллекторе»" oninput="state._defectFormState.description = this.value">' + escapeHtml(s.description) + '</textarea>' +
        '</div>' +
        '<div class="form-group"><label>Файлы — фото, видео, документы (до 5)</label>' +
          '<label class="photo-upload-area">' +
            '<input type="file" accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" multiple style="display:none;" onchange="addDefectFiles(this)">' +
            '<i class="ti ti-paperclip"></i>' +
            '<div>Добавить файлы</div>' +
            '<div class="upload-hint">JPG/PNG/HEIC до 8 МБ · видео до 50 МБ · PDF/DOC/XLS до 20 МБ</div>' +
          '</label>' +
          (filePreviews ? '<div class="photo-previews">' + filePreviews + '</div>' : '') +
        '</div>' +
        '<div class="form-group"><label>Где найдено (опционально)</label>' +
          '<input type="text" placeholder="например: ТП-3 на объекте Невский" value="' + escapeHtml(s.location) + '" oninput="state._defectFormState.location = this.value">' +
        '</div>' +
        '<div class="form-group"><label>Ваше имя (опционально)</label>' +
          '<input type="text" placeholder="Иванов И.И." value="' + escapeHtml(s.author_name) + '" oninput="state._defectFormState.author_name = this.value">' +
        '</div>' +
        '<div class="form-group"><label>Телефон (опционально)</label>' +
          '<input type="tel" placeholder="+7..." value="' + escapeHtml(s.author_phone) + '" oninput="state._defectFormState.author_phone = this.value">' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="closeDefectForm()">Отмена</button>' +
      '<button class="btn btn-primary" onclick="submitDefectReport()"><i class="ti ti-send"></i> Отправить</button>' +
    '</div>' +
  '</div>';
}

// v2.36.0: справочник категорий — должен совпадать с DEFECT_CATEGORY_LABELS на бэке
const DEFECT_CATEGORY_LABELS = {
  electric:   'Электрика',
  plumbing:   'Сантехника',
  climate:    'Климатика',
  leak:       'Протечка',
  condensate: 'Конденсат',
  noise:      'Шум',
  mechanics:  'Механика',
  software:   'Автоматика/ПО',
  other:      'Прочее',
};

// v2.36.0: иконки категорий (для бейджей в списке/карточке)
const DEFECT_CATEGORY_ICONS = {
  electric:   'ti-plug',
  plumbing:   'ti-droplet',
  climate:    'ti-temperature',
  leak:       'ti-droplet-filled',
  condensate: 'ti-droplets',
  noise:      'ti-volume',
  mechanics:  'ti-settings',
  software:   'ti-cpu',
  other:      'ti-dots',
};

// v2.36.0: ярлык kind по content-type (для FormData превью)
function _kindForContentType(ct) {
  if (!ct) return 'document';
  if (ct.startsWith('image/')) return 'photo';
  if (ct.startsWith('video/')) return 'video';
  return 'document';
}

// v2.36.0: превью одного файла (фото — миниатюра; видео — иконка плеера; документ — иконка типа)
function _renderDefectFilePreview(p, i) {
  const k = p.kind || _kindForContentType(p.file && p.file.type);
  let body;
  if (k === 'photo' && p.dataUrl) {
    body = '<img src="' + p.dataUrl + '" alt="">';
  } else if (k === 'video') {
    body = '<div class="file-preview-icon"><i class="ti ti-movie"></i><div class="fpn">' +
      escapeHtml((p.file && p.file.name) || 'видео') + '</div></div>';
  } else {
    body = '<div class="file-preview-icon"><i class="ti ti-file-text"></i><div class="fpn">' +
      escapeHtml((p.file && p.file.name) || 'документ') + '</div></div>';
  }
  return '<div class="photo-preview">' + body +
    '<button class="photo-preview-remove" onclick="removeDefectPhoto(' + i + ')" type="button">×</button>' +
  '</div>';
}

function setDefectType(t) {
  if (!state._defectFormState) return;
  state._defectFormState.type = t;
  // Перерисуем только tabs (а не всю модалку — чтобы текст в полях сохранился)
  const m = document.getElementById('defect-form-modal');
  if (!m) return;
  const tabs = m.querySelector('.defect-type-tabs');
  if (!tabs) return;
  let html = '';
  Object.entries(DEFECT_TYPE_LABELS).forEach(([k, v]) => {
    const active = state._defectFormState.type === k ? ' active ' + v.cls : '';
    html += '<button class="defect-type-pill' + active + '" onclick="setDefectType(\'' + k + '\')"><i class="ti ' + v.icon + '"></i>' + v.label + '</button>';
  });
  tabs.innerHTML = html;
}

function addDefectFiles(input) {
  if (!input.files || !input.files.length) return;
  if (!state._defectFormState) return;
  const remaining = 5 - state._defectFormState.photos.length;
  const files = Array.from(input.files).slice(0, remaining);
  let processed = 0;
  const done = () => {
    processed++;
    if (processed === files.length) {
      input.value = '';
      rerenderDefectPhotoPreviews();
    }
  };
  files.forEach(file => {
    // v2.36.0: лимиты по виду
    const ct = file.type || '';
    let limit, kind;
    if (ct.startsWith('image/')) { limit = 8 * 1024 * 1024;  kind = 'photo'; }
    else if (ct.startsWith('video/')) { limit = 50 * 1024 * 1024; kind = 'video'; }
    else { limit = 20 * 1024 * 1024; kind = 'document'; }
    if (file.size > limit) {
      alert('Файл "' + file.name + '" слишком большой (макс ' + Math.round(limit/1024/1024) + ' МБ для ' + kind + ')');
      done();
      return;
    }
    if (kind === 'photo') {
      const reader = new FileReader();
      reader.onload = (e) => {
        state._defectFormState.photos.push({ file, dataUrl: e.target.result, kind });
        done();
      };
      reader.readAsDataURL(file);
    } else {
      state._defectFormState.photos.push({ file, dataUrl: null, kind });
      done();
    }
  });
}

// Бэкомпат — старое имя функции
function addDefectPhotos(input) { return addDefectFiles(input); }

function removeDefectPhoto(idx) {
  if (!state._defectFormState) return;
  state._defectFormState.photos.splice(idx, 1);
  rerenderDefectPhotoPreviews();
}

function rerenderDefectPhotoPreviews() {
  const m = document.getElementById('defect-form-modal');
  if (!m) return;
  const area = m.querySelector('.photo-upload-area');
  if (!area || !area.parentNode) return;
  const existing = area.parentNode.querySelector('.photo-previews');
  if (existing) existing.remove();
  const s = state._defectFormState;
  if (!s.photos.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'photo-previews';
  s.photos.forEach((p, i) => {
    const cell = document.createElement('div');
    cell.innerHTML = _renderDefectFilePreview(p, i);
    wrap.appendChild(cell.firstElementChild);
  });
  area.parentNode.appendChild(wrap);
}

async function submitDefectReport() {
  const s = state._defectFormState;
  if (!s) return;
  const desc = (s.description || '').trim();
  if (!desc) { showToast('Опишите проблему', 'error'); return; }

  const fd = new FormData();
  fd.append('description', desc);
  fd.append('type', s.type);
  if (s.category) fd.append('category', s.category);    // v2.36.0
  if (s.targetType === 'assembly') fd.append('assembly_token', s.token);
  else if (s.targetType === 'contract') fd.append('contract_token', s.token);
  else if (s.targetType === 'general') fd.append('general', '1');     // ЭТАП 23+: общая публичная форма
  if (s.author_name) fd.append('author_name', s.author_name);
  if (s.author_phone) fd.append('author_phone', s.author_phone);
  if (s.location) fd.append('location', s.location);
  // v2.36.0: file_* (бэк принимает и legacy photo_*)
  s.photos.forEach((p, i) => fd.append('file_' + (i + 1), p.file, p.file.name));

  // Маршрутизация:
  // - 'general' (публичная общая форма) → /api/public/defects с general=1
  // - 'internal' (CRM без привязки) → /api/defects с авторизацией
  // - 'assembly'/'contract' → /api/defects если залогинен, иначе /api/public/defects
  const token = localStorage.getItem(TOKEN_KEY);
  const isPublic = (s.targetType === 'general');
  const isInternal = !isPublic && ((s.targetType === 'internal') || !!token);
  const url = (isInternal && !isPublic) ? '/api/defects' : '/api/public/defects';
  const headers = isInternal && token && !isPublic ? { 'Authorization': 'Bearer ' + token } : {};

  try {
    const r = await fetch(API_BASE + url, { method: 'POST', body: fd, headers });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      showToast(e.message || 'Не удалось отправить', 'error');
      return;
    }
    // Успех — показываем благодарность
    const m = document.getElementById('defect-form-modal');
    m.innerHTML = '<div class="modal" onclick="event.stopPropagation()" style="max-width: 420px;">' +
      '<div class="modal-content">' +
        '<div class="defect-form-success">' +
          '<i class="ti ti-circle-check-filled"></i>' +
          '<h3>Заявка отправлена</h3>' +
          '<p>Спасибо! Мы рассмотрим обращение и при необходимости свяжемся с вами.</p>' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-primary" onclick="closeDefectFormAndRefresh()" style="width: 100%;">Закрыть</button>' +
      '</div>' +
    '</div>';
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

/** Закрыть форму и обновить список замечаний если мы в этом разделе. */
function closeDefectFormAndRefresh() {
  closeDefectForm();
  if (state.currentSection === 'defects' && state.currentScreen && state.currentScreen.startsWith('defects-list')) {
    loadDefectsList();
  }
}

// --------- Раздел Доработки в CRM ---------

async function loadDefectsList() {
  const container = document.getElementById('defects-list-content');
  if (!container) return;
  container.innerHTML = '<div class="loading-block">Загружаем…</div>';
  const titleEl = document.getElementById('defects-list-title');
  const mobileTitleEl = document.getElementById('defects-list-mobile-title');
  const counter = document.getElementById('defects-counter');

  const filter = state.defectsFilter || 'all';
  const titles = {
    all: 'Все замечания',
    new: 'Новые',
    in_progress: 'В работе',
    resolved: 'Решённые',
    rejected: 'Отклонённые',
  };
  if (titleEl) titleEl.textContent = titles[filter] || 'Замечания';
  if (mobileTitleEl) mobileTitleEl.textContent = titles[filter] || 'Доработки';

  // Синхронизуем мобильные фильтр-чипсы
  document.querySelectorAll('#m-defects-filter-chips .m-filter-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.filter === filter);
  });

  try {
    const q = filter === 'all' ? '' : '?status=' + filter;
    const d = await apiGet('/api/defects' + q);
    const list = d.defects || [];
    if (counter) counter.textContent = list.length;
    state._defectsList = list;
    _renderDefectsListBody();
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Не удалось загрузить</div>';
  }
}

// v2.45.6xx: переключатель нового/старого вида списка замечаний
function _dfToggleBar() {
  return '<div class="sv2-toggle-bar">' +
      '<span><i class="ti ti-' + (window.DF_V2 ? 'sparkles' : 'history') + '"></i> ' + (window.DF_V2 ? 'Новый вид' : 'Старый вид') + '</span>' +
      '<button class="sv2-toggle-btn" onclick="toggleDefectsV2()">' + (window.DF_V2 ? 'Вернуть старый' : 'Включить новый') + '</button>' +
    '</div>';
}

function toggleDefectsV2() {
  window.DF_V2 = !window.DF_V2;
  try { localStorage.setItem('dfV2', window.DF_V2 ? '1' : '0'); } catch (_) {}
  _renderDefectsListBody();
}

function _renderDefectsListBody() {
  const container = document.getElementById('defects-list-content');
  if (!container) return;
  window.DF_V2 = (localStorage.getItem('dfV2') !== '0');
  const toggle = _dfToggleBar();
  const list = state._defectsList || [];
  if (!list.length) {
    container.innerHTML = toggle + '<div class="empty-block"><i class="ti ti-mood-empty"></i>Замечаний пока нет</div>';
    return;
  }
  if (window.DF_V2) {
    container.innerHTML = toggle + '<div class="df-list">' + list.map(_dfRowV2).join('') + '</div>';
  } else {
    container.innerHTML = toggle + list.map(renderDefectRow).join('');
  }
}

// v2.45.6xx: строка-карточка замечания (новый вид)
function _dfRowV2(d) {
  const ti = DEFECT_TYPE_LABELS[d.type] || DEFECT_TYPE_LABELS.defect;
  const typeKey = (d.type && DEFECT_TYPE_LABELS[d.type]) ? d.type : 'defect';
  const stripMap = { new: 'df-new', in_progress: 'df-prog', resolved: 'df-done', rejected: 'df-rej' };
  const stPillMap = { new: 'new', in_progress: 'prog', resolved: 'done', rejected: 'rej' };
  const stripCls = stripMap[d.status] || 'df-new';
  const stPill = stPillMap[d.status] || 'new';

  let target = '';
  if (d.assembly_id) {
    target = '<span class="df-target"><i class="ti ti-tool"></i> ' + escapeHtml(d.model_name || ('Сборка #' + d.assembly_id)) + (d.model_article ? ' · ' + escapeHtml(d.model_article) : '') + '</span>';
  } else if (d.contract_id) {
    target = '<span class="df-target"><i class="ti ti-file-text"></i> Договор ' + escapeHtml(d.contract_number || ('#' + d.contract_id)) + '</span>';
  }

  const date = (d.created_at || '').replace('T', ' ').slice(0, 16);
  let meta = '';
  if (d.author_name) meta += '<span class="df-mi"><span class="df-mava">' + escapeHtml(getInitials(d.author_name)) + '</span>' + escapeHtml(d.author_name) + '</span>';
  if (d.author_phone) meta += '<span class="df-mi"><i class="ti ti-phone"></i> ' + escapeHtml(d.author_phone) + '</span>';
  if (d.location) meta += '<span class="df-mi"><i class="ti ti-map-pin"></i> ' + escapeHtml(d.location) + '</span>';
  if (d.photos_count) meta += '<span class="df-mi"><i class="ti ti-photo"></i> ' + d.photos_count + ' фото</span>';
  meta += '<span class="df-mi"><i class="ti ti-clock"></i> ' + escapeHtml(date) + '</span>';

  return '<div class="df-row ' + stripCls + '" onclick="openDefectDetail(' + d.id + ')">' +
    '<div class="df-ic ' + ti.cls + '"><i class="ti ' + ti.icon + '"></i></div>' +
    '<div class="df-body">' +
      '<div class="df-top">' +
        '<span class="df-type-pill ' + ti.cls + '"><i class="ti ' + ti.icon + '"></i> ' + escapeHtml(ti.label) + '</span>' +
        '<span class="df-st ' + stPill + '">' + escapeHtml(d.status_label || '') + '</span>' +
        target +
      '</div>' +
      '<div class="df-desc">' + escapeHtml(d.description || '') + '</div>' +
      '<div class="df-meta">' + meta + '</div>' +
    '</div>' +
  '</div>';
}

/** Мобильный клик по фильтр-чипсу — синхронизирует с сайдбаром. */
function setMobileDefectFilter(filter, btnEl) {
  const map = {
    all: 'defects-list',
    new: 'defects-list-new',
    in_progress: 'defects-list-progress',
    resolved: 'defects-list-resolved',
    rejected: 'defects-list-rejected',
  };
  const screen = map[filter] || 'defects-list';
  selectSidebarItem(screen);
}

function renderDefectRow(d) {
  const typeInfo = DEFECT_TYPE_LABELS[d.type] || DEFECT_TYPE_LABELS.defect;
  const target = d.assembly_id
    ? '🔧 ' + escapeHtml(d.model_name || 'Сборка #' + d.assembly_id) + (d.model_article ? ' · ' + escapeHtml(d.model_article) : '')
    : (d.contract_id ? '📄 Договор ' + escapeHtml(d.contract_number || '#' + d.contract_id) : '—');
  const date = (d.created_at || '').replace('T', ' ').slice(0, 16);
  return '<div class="defect-row" onclick="openDefectDetail(' + d.id + ')">' +
    '<div class="defect-row-head">' +
      '<span class="defect-type-badge ' + typeInfo.cls + '">' + typeInfo.label + '</span>' +
      '<span class="defect-status-badge s-' + d.status + '">' + escapeHtml(d.status_label) + '</span>' +
      '<span class="defect-row-target">' + target + '</span>' +
    '</div>' +
    '<div class="defect-row-desc">' + escapeHtml(d.description) + '</div>' +
    '<div class="defect-row-meta">' +
      (d.author_name ? '<span><i class="ti ti-user"></i> ' + escapeHtml(d.author_name) + '</span>' : '') +
      (d.author_phone ? '<span><i class="ti ti-phone"></i> ' + escapeHtml(d.author_phone) + '</span>' : '') +
      (d.location ? '<span><i class="ti ti-map-pin"></i> ' + escapeHtml(d.location) + '</span>' : '') +
      (d.photos_count ? '<span><i class="ti ti-photo"></i> ' + d.photos_count + ' фото</span>' : '') +
      '<span><i class="ti ti-clock"></i> ' + escapeHtml(date) + '</span>' +
    '</div>' +
  '</div>';
}

async function openDefectDetail(id) {
  state.currentDefectId = id;
  selectSidebarItem('defects-detail');
  const content = document.getElementById('dd-content');
  if (content) content.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try {
    const d = await apiGet('/api/defects/' + id);
    renderDefectDetail(d);
  } catch (e) {
    if (content) content.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Не удалось загрузить</div>';
  }
}

function renderDefectDetail(d) {
  const titleEl = document.getElementById('dd-title');
  const subEl = document.getElementById('dd-subtitle');
  const mobileTitle = document.getElementById('dd-mobile-title');
  if (titleEl) titleEl.textContent = (DEFECT_TYPE_LABELS[d.type] || {label: 'Заявка'}).label + ' #' + d.id;
  if (mobileTitle) mobileTitle.textContent = (DEFECT_TYPE_LABELS[d.type] || {label: 'Заявка'}).label;
  if (subEl) subEl.textContent = (d.created_at || '').replace('T', ' ').slice(0, 16);

  const typeInfo = DEFECT_TYPE_LABELS[d.type] || DEFECT_TYPE_LABELS.defect;
  const content = document.getElementById('dd-content');
  if (!content) return;

  // Поля
  let info = '';
  const addInfo = (label, value) => {
    if (!value) return;
    info += '<div class="defect-detail-info-item">' +
      '<div class="defect-detail-info-label">' + label + '</div>' +
      '<div class="defect-detail-info-value">' + value + '</div>' +
    '</div>';
  };
  if (d.assembly_id) addInfo('Сборка', '<a href="#" onclick="event.preventDefault(); openAssemblyStock(' + d.assembly_id + ')" style="color: var(--brand); font-weight: 600;">' + escapeHtml(d.model_name || ('#' + d.assembly_id)) + (d.model_article ? ' · ' + escapeHtml(d.model_article) : '') + '</a>');
  if (d.contract_id) addInfo('Договор', '<a href="#" onclick="event.preventDefault(); state.currentContractId=' + d.contract_id + '; selectSection(\'sales\'); selectSidebarItem(\'sales-contract-detail\');" style="color: var(--brand); font-weight: 600;">' + escapeHtml(d.contract_number || '#' + d.contract_id) + (d.contractor_name ? ' · ' + escapeHtml(d.contractor_name) : '') + '</a>');
  // v2.38.0: показываем контрагента отдельно, если он есть но БЕЗ договора (прямая привязка)
  if (!d.contract_id && d.contractor_id && d.contractor_name) {
    addInfo('Контрагент', '<a href="#" onclick="event.preventDefault(); state.currentContractorId=' + d.contractor_id + '; selectSection(\'sales\'); selectSidebarItem(\'sales-contractor-detail\');" style="color: var(--brand); font-weight: 600;">' + escapeHtml(d.contractor_name) + '</a>');
  }
  if (d.location) addInfo('Где найдено', escapeHtml(d.location));
  if (d.author_name) addInfo('Имя', escapeHtml(d.author_name));
  if (d.author_phone) addInfo('Телефон', escapeHtml(d.author_phone));
  if (d.assignee_name) addInfo('Ответственный', escapeHtml(d.assignee_name));
  // v2.44.63: если заявка про брак комплектующего — показываем привязку
  if (d.component_id) {
    const totalQty = parseFloat(d.component_qty || 0);
    const resolved = parseFloat(d.component_qty_resolved || 0);
    const remaining = totalQty - resolved;
    let qtyHtml = '<b>' + _fmtQty(totalQty) + '</b> шт.';
    if (resolved > 0 && remaining > 0.0001) {
      qtyHtml += ' <span style="color:var(--text-light);">(' + _fmtQty(resolved) + ' уже разрешено, осталось ' + _fmtQty(remaining) + ')</span>';
    } else if (remaining < 0.0001 && d.component_resolution) {
      qtyHtml += ' <span style="color:#0A5B41;">(' + (d.component_resolution === 'return' ? 'вернули в склад' : 'списали') + ')</span>';
    }
    addInfo('Комплектующее', qtyHtml);
  }

  // v2.36.0: галерея файлов — фото / видео / документы
  let filesBlock = '';
  if (d.photos && d.photos.length) {
    filesBlock = '<div class="defect-photos-grid">' +
      d.photos.map(p => _renderDefectGalleryItem(p)).join('') +
    '</div>';
  }

  // Кнопки смены статуса
  const canManage = state.user && (state.user.is_director || state.user.role === 'director' || state.user.role === 'zam' ||
    (state.user.roles && (state.user.roles.includes('director') || state.user.roles.includes('zam'))));
  // v2.37.0: показываем «Редактировать» и «Поделиться» только тем кто может управлять
  const editBtn = document.getElementById('dd-edit-btn');
  const shareBtn = document.getElementById('dd-share-btn');
  if (editBtn) editBtn.style.display = canManage ? '' : 'none';
  if (shareBtn) shareBtn.style.display = canManage ? '' : 'none';
  // Сохраним текущую заявку в state — для модалки редактирования
  state._currentDefect = d;
  let actions = '';
  if (canManage) {
    const buttons = [];
    if (d.status !== 'in_progress') buttons.push('<button class="btn btn-secondary" onclick="changeDefectStatus(\'in_progress\')"><i class="ti ti-progress"></i> В работу</button>');
    if (d.status !== 'resolved') buttons.push('<button class="btn btn-success" onclick="changeDefectStatus(\'resolved\')"><i class="ti ti-check"></i> Решено</button>');
    if (d.status !== 'rejected') buttons.push('<button class="btn btn-secondary" onclick="changeDefectStatus(\'rejected\')" style="color: var(--danger);"><i class="ti ti-x"></i> Отклонить</button>');
    if (d.status !== 'new') buttons.push('<button class="btn btn-secondary" onclick="changeDefectStatus(\'new\')"><i class="ti ti-rewind-backward-5"></i> Вернуть в Новые</button>');
    actions = '<div class="defect-status-actions">' + buttons.join('') + '</div>';
  }
  // v2.44.63: для брака комплектующего — отдельные кнопки разрешения
  const cmpRemaining = d.component_id
    ? (parseFloat(d.component_qty || 0) - parseFloat(d.component_qty_resolved || 0))
    : 0;
  if (d.component_id && cmpRemaining > 0.0001) {
    actions += '<div class="defect-status-actions" style="margin-top:8px;border-top:1px dashed var(--border);padding-top:10px;">' +
      '<span style="color:var(--text-light);font-size:12px;margin-right:8px;">Брак (' + _fmtQty(cmpRemaining) + ' шт.):</span>' +
      '<button class="btn btn-success" onclick="resolveComponentDefect(' + d.id + ', \'return\')"><i class="ti ti-arrow-back-up"></i> Вернуть в склад</button>' +
      '<button class="btn btn-secondary" style="color:#B5302E;" onclick="resolveComponentDefect(' + d.id + ', \'writeoff\')"><i class="ti ti-trash"></i> Списать</button>' +
    '</div>';
  }

  // v2.36.0: бейдж категории рядом с типом и статусом
  let catBadge = '';
  if (d.category && d.category_label) {
    const icon = DEFECT_CATEGORY_ICONS[d.category] || 'ti-tag';
    catBadge = '<span class="defect-category-badge"><i class="ti ' + icon + '"></i>' + escapeHtml(d.category_label) + '</span>';
  }

  content.innerHTML =
    '<div class="defect-detail">' +
      '<div class="defect-detail-head">' +
        '<span class="defect-type-badge ' + typeInfo.cls + '">' + typeInfo.label + '</span>' +
        '<span class="defect-status-badge s-' + d.status + '">' + escapeHtml(d.status_label) + '</span>' +
        catBadge +
      '</div>' +
      '<div class="defect-detail-desc">' + escapeHtml(d.description) + '</div>' +
      (info ? '<div class="defect-detail-info">' + info + '</div>' : '') +
      (filesBlock ? '<div class="defect-detail-info-label" style="margin-top: 16px; margin-bottom: 10px;">ФАЙЛЫ</div>' + filesBlock : '') +
      (d.resolution_note ? '<div class="defect-detail-info-label" style="margin-top: 16px; margin-bottom: 6px;">КОММЕНТАРИЙ К РЕШЕНИЮ</div><div class="defect-detail-desc" style="background: #FFF4E6;">' + escapeHtml(d.resolution_note) + '</div>' : '') +
      actions +
      // v2.36.0: чат
      '<div class="defect-chat" id="defect-chat-block">' +
        '<div class="defect-chat-title">' +
          '<i class="ti ti-messages"></i> Обсуждение' +
          '<span class="defect-chat-count" id="defect-chat-count">' + (d.messages_count || 0) + '</span>' +
          // v2.40.0: тоггл звука
          '<button class="defect-chat-sound" id="defect-chat-sound-btn" onclick="toggleDefectChatSound()" title="Звук уведомлений">' +
            '<i class="ti ' + (_getDefectSoundEnabled() ? 'ti-bell' : 'ti-bell-off') + '"></i>' +
          '</button>' +
        '</div>' +
        // v2.39.0: участники чата
        '<div class="defect-participants" id="defect-participants"></div>' +
        '<div class="defect-chat-feed" id="defect-chat-feed">' +
          '<div class="loading-block">Загружаем сообщения…</div>' +
        '</div>' +
        '<div class="defect-chat-compose" id="defect-chat-compose">' +
          '<div class="defect-chat-attachments" id="defect-chat-attachments"></div>' +
          '<div class="defect-chat-input-row">' +
            '<button class="defect-chat-attach" onclick="document.getElementById(\'defect-chat-file-input\').click()" title="Прикрепить">' +
              '<i class="ti ti-paperclip"></i>' +
            '</button>' +
            '<input type="file" id="defect-chat-file-input" multiple style="display:none;" ' +
              'accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" ' +
              'onchange="addDefectChatAttachments(this)">' +
            '<textarea id="defect-chat-text" rows="1" placeholder="Написать сообщение…" ' +
              'oninput="autosizeDefectChatInput(this)"></textarea>' +
            '<button class="defect-chat-send btn btn-primary" onclick="sendDefectChatMessage()">' +
              '<i class="ti ti-send"></i>' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  // Подгружаем сообщения и стартуем real-time опрос
  state._defectChatAttachments = [];
  loadDefectMessages(d.id);
  loadDefectParticipants(d.id);
  _startDefectChatPolling(d.id);
}

// v2.36.0: рендер одного элемента галереи (фото / видео / документ)
function _renderDefectGalleryItem(p) {
  const url = API_BASE + p.url;
  const kind = p.kind || 'photo';
  if (kind === 'photo') {
    return '<div class="defect-photo-thumb" onclick="openPhotoLightbox(\'' + url + '\')"><img src="' + url + '" loading="lazy" alt=""></div>';
  }
  if (kind === 'video') {
    return '<div class="defect-file-thumb video-thumb" onclick="openDefectVideoLightbox(\'' + url + '\')">' +
      '<i class="ti ti-player-play-filled"></i>' +
      '<div class="ftn">Видео</div>' +
    '</div>';
  }
  // document
  const name = p.original_name || 'Документ';
  return '<a class="defect-file-thumb doc-thumb" href="' + url + '" target="_blank" rel="noopener" title="' + escapeHtml(name) + '">' +
    '<i class="ti ti-file-text"></i>' +
    '<div class="ftn">' + escapeHtml(name) + '</div>' +
  '</a>';
}

// v2.36.0: простой лайтбокс для видео — используем <video> в overlay
function openDefectVideoLightbox(url) {
  let m = document.getElementById('defect-video-lb');
  if (!m) {
    m = document.createElement('div');
    m.id = 'defect-video-lb';
    m.className = 'photo-lightbox';
    m.onclick = () => { m.classList.remove('visible'); m.innerHTML = ''; };
    document.body.appendChild(m);
  }
  m.innerHTML = '<video src="' + url + '" controls autoplay playsinline style="max-width:95vw;max-height:90vh;"></video>';
  m.classList.add('visible');
}

// v2.36.0: подгружаем сообщения чата
async function loadDefectMessages(defectId) {
  const feed = document.getElementById('defect-chat-feed');
  if (!feed) return;
  try {
    const d = await apiGet('/api/defects/' + defectId + '/messages');
    renderDefectMessages(d.messages || []);
  } catch (e) {
    feed.innerHTML = '<div class="empty-block">Не удалось загрузить сообщения</div>';
  }
}

// v2.39.0: загрузка списка участников чата
async function loadDefectParticipants(defectId) {
  const box = document.getElementById('defect-participants');
  if (!box) return;
  try {
    const d = await apiGet('/api/defects/' + defectId + '/participants');
    renderDefectParticipants(box, d.participants || []);
  } catch (e) {
    // тихо
  }
}

function renderDefectParticipants(box, participants) {
  if (!participants.length) {
    box.innerHTML = '';
    return;
  }
  // v2.40.0: банить может только сотрудник с manage. Не во вьюхе.
  const canBan = state.user && (
    state.user.is_director ||
    (state.user.roles && (state.user.roles.includes('director') || state.user.roles.includes('zam')))
  );
  const onlineCount = participants.filter(p => p.is_online).length;
  let html = '<div class="defect-participants-row">' +
    '<span class="defect-participants-label">' +
      '<i class="ti ti-users"></i> Участники <b>' + participants.length + '</b>' +
      (onlineCount ? ' · <span style="color:#15803D;">●</span> ' + onlineCount + ' онлайн' : '') +
    '</span>' +
    '<div class="defect-participants-chips">';
  participants.slice(0, 15).forEach(p => {
    const cls = (p.is_online ? 'online' : '') + (p.is_guest ? ' guest' : ' employee');
    const initials = getInitials(p.name || '—');
    const title = (p.name || '') + (p.phone ? ' · ' + p.phone : '') + (p.is_online ? ' · онлайн' : '');
    // Банить можем только гостей (сотрудников нет смысла — они авторизованы через бот)
    const banBtn = (canBan && p.is_guest && p.key) ?
      '<button class="dp-ban" title="Удалить из обсуждения" onclick="banDefectParticipant(\'' +
      String(p.key).replace(/'/g, "\\'") + '\', \'' +
      String(p.name || '').replace(/'/g, "\\'") + '\')">×</button>' : '';
    html += '<span class="defect-participant-chip ' + cls + '" title="' + escapeHtml(title) + '">' +
      '<span class="dp-avatar">' + initials + '</span>' +
      '<span class="dp-name">' + escapeHtml(p.name || '—') + '</span>' +
      banBtn +
    '</span>';
  });
  if (participants.length > 15) {
    html += '<span class="defect-participants-more">+' + (participants.length - 15) + '</span>';
  }
  html += '</div></div>';
  box.innerHTML = html;
}

// v2.40.0: удалить участника из обсуждения
async function banDefectParticipant(key, name) {
  if (!state.currentDefectId) return;
  if (!confirm('Удалить «' + name + '» из обсуждения?\n\nЧеловек больше не сможет писать сообщения по этой ссылке.')) return;
  const token = localStorage.getItem(TOKEN_KEY);
  try {
    const r = await fetch(API_BASE + '/api/defects/' + state.currentDefectId + '/participants/block', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ key: key, name: name }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      showToast(e.message || 'Не удалось удалить', 'error');
      return;
    }
    showToast('Участник удалён', 'success');
    // Перезагрузим участников и ленту (там появится системка)
    loadDefectParticipants(state.currentDefectId);
    loadDefectMessages(state.currentDefectId);
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// v2.39.0: polling + heartbeat для realtime обновления чата
const DEFECT_POLL_INTERVAL_MS = 5000;
const DEFECT_HEARTBEAT_INTERVAL_MS = 25000;

function _startDefectChatPolling(defectId) {
  _stopDefectChatPolling();
  // Сразу пингуем
  _sendDefectHeartbeat(defectId, false);
  state._defectPollTimer = setInterval(() => {
    // Если карточка ещё открыта
    if (state.currentDefectId !== defectId || state.currentScreen !== 'defects-detail') {
      _stopDefectChatPolling();
      return;
    }
    // Не перетираем ленту если пользователь печатает / прокрутил вверх
    _refreshDefectMessagesSilently(defectId);
    loadDefectParticipants(defectId);
  }, DEFECT_POLL_INTERVAL_MS);
  state._defectHbTimer = setInterval(() => {
    if (state.currentDefectId !== defectId) { _stopDefectChatPolling(); return; }
    _sendDefectHeartbeat(defectId, false);
  }, DEFECT_HEARTBEAT_INTERVAL_MS);
}

function _stopDefectChatPolling() {
  if (state._defectPollTimer) { clearInterval(state._defectPollTimer); state._defectPollTimer = null; }
  if (state._defectHbTimer)   { clearInterval(state._defectHbTimer);   state._defectHbTimer = null; }
}

async function _sendDefectHeartbeat(defectId, isPublic) {
  try {
    if (isPublic) {
      const token = state._publicDefectToken;
      const guest = _getPublicDefectGuest();
      if (!token || !guest) return;
      await fetch(API_BASE + '/api/public/defect/' + encodeURIComponent(token) + '/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: guest.name, phone: guest.phone }),
      });
    } else {
      const tok = localStorage.getItem(TOKEN_KEY);
      if (!tok) return;
      await fetch(API_BASE + '/api/defects/' + defectId + '/heartbeat', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + tok },
      });
    }
  } catch (_) { /* тихо */ }
}

// Загружаем сообщения, не теряя позицию прокрутки и не дёргая UI если ничего не изменилось
async function _refreshDefectMessagesSilently(defectId) {
  const feed = document.getElementById('defect-chat-feed');
  if (!feed) return;
  try {
    const d = await apiGet('/api/defects/' + defectId + '/messages');
    const messages = d.messages || [];
    // Сравним по id последнего и по количеству
    const prevSig = feed.dataset.sig || '';
    const newSig = messages.length + ':' + (messages.length ? messages[messages.length - 1].id : '0');
    if (prevSig === newSig) return;
    // v2.40.0: пинг звуком если появилось НОВОЕ сообщение от ДРУГОГО автора
    if (prevSig && messages.length) {
      const prevLastId = parseInt(prevSig.split(':')[1] || '0', 10);
      const last = messages[messages.length - 1];
      const myEmpId = state.user && state.user.employee_id;
      const isMine = myEmpId && last.author_employee_id === myEmpId;
      if (last.id > prevLastId && !last.is_system && !isMine) {
        _playDefectChatPing();
      }
    }
    const wasNearBottom = (feed.scrollHeight - feed.scrollTop - feed.clientHeight) < 80;
    renderDefectMessages(messages);
    feed.dataset.sig = newSig;
    if (!wasNearBottom) {
      // оставим прокрутку как была
      feed.scrollTop = feed.scrollHeight - feed.clientHeight - 80;
    }
  } catch (_) { /* тихо */ }
}

function renderDefectMessages(messages) {
  const feed = document.getElementById('defect-chat-feed');
  if (!feed) return;
  const countEl = document.getElementById('defect-chat-count');
  _renderMessagesInto(feed, messages, countEl, /* publicView */ false);
}

// v2.37.0: переиспользуемая функция рендера ленты (внутренний и публичный режим)
function _renderMessagesInto(feed, messages, countEl, publicView) {
  if (countEl) countEl.textContent = messages.filter(m => !m.is_system).length;
  if (!messages.length) {
    feed.innerHTML = '<div class="defect-chat-empty">Пока никто не подключился к обсуждению — будьте первым.</div>';
    return;
  }
  const myEmpId = state.user && state.user.employee_id;
  // Удалять может только сотрудник с правом defects.resolve (которое у редактирующих — director/zam)
  const canDelete = !publicView && state.user && (
    state.user.is_director ||
    (state.user.roles && (state.user.roles.includes('director') || state.user.roles.includes('zam')))
  );

  // v2.40.0: группировка по дням
  let html = '';
  let prevDay = '';
  messages.forEach(m => {
    const day = (m.created_at || '').slice(0, 10);
    if (day && day !== prevDay) {
      html += '<div class="defect-chat-day-sep"><span>' + _formatDaySeparator(day) + '</span></div>';
      prevDay = day;
    }
    const isMine = !publicView && myEmpId && m.author_employee_id === myEmpId;
    if (m.is_system) {
      const delBtn = canDelete
        ? '<button class="defect-msg-del sys" title="Удалить" onclick="deleteDefectMessage(' + m.id + ')"><i class="ti ti-x"></i></button>'
        : '';
      html += '<div class="defect-msg system">' +
        '<i class="ti ti-info-circle"></i>' +
        '<span>' + escapeHtml(m.text || '').replace(/\n/g, '<br>') + '</span>' +
        '<time>' + _formatChatTime(m.created_at) + '</time>' +
        delBtn +
      '</div>';
      return;
    }
    let files = '';
    if (m.files && m.files.length) {
      files = '<div class="defect-msg-files">' + m.files.map(f => {
        const url = API_BASE + f.url;
        if (f.kind === 'photo') {
          return '<a class="defect-msg-file photo" href="' + url + '" target="_blank" rel="noopener">' +
            '<img src="' + url + '" loading="lazy" alt=""></a>';
        }
        if (f.kind === 'video') {
          return '<a class="defect-msg-file video" onclick="openDefectVideoLightbox(\'' + url + '\'); return false;" href="#">' +
            '<i class="ti ti-player-play-filled"></i><span>Видео</span></a>';
        }
        return '<a class="defect-msg-file doc" href="' + url + '" target="_blank" rel="noopener">' +
          '<i class="ti ti-file-text"></i><span>' + escapeHtml(f.original_name || 'Документ') + '</span></a>';
      }).join('') + '</div>';
    }
    const delBtn = canDelete
      ? '<button class="defect-msg-del" title="Удалить" onclick="deleteDefectMessage(' + m.id + ')"><i class="ti ti-trash"></i></button>'
      : '';
    // v2.39.0: внешний гость (без employee_id) — отдельный визуал
    const isGuest = !m.author_employee_id && !isMine;
    html += '<div class="defect-msg' + (isMine ? ' mine' : (isGuest ? ' guest' : '')) + '">' +
      '<div class="defect-msg-head">' +
        '<span class="defect-msg-author">' + escapeHtml(m.author_name || '—') + '</span>' +
        '<time>' + _formatChatTime(m.created_at) + '</time>' +
        delBtn +
      '</div>' +
      (m.text ? '<div class="defect-msg-text">' + escapeHtml(m.text).replace(/\n/g, '<br>') + '</div>' : '') +
      files +
    '</div>';
  });
  feed.innerHTML = html;
  feed.scrollTop = feed.scrollHeight;
}

// v2.40.0: тоггл звука уведомлений
const DEFECT_SOUND_KEY = 'atomus_defect_chat_sound';

function _getDefectSoundEnabled() {
  try { return localStorage.getItem(DEFECT_SOUND_KEY) === '1'; } catch (_) { return false; }
}

function toggleDefectChatSound() {
  const cur = _getDefectSoundEnabled();
  try { localStorage.setItem(DEFECT_SOUND_KEY, cur ? '0' : '1'); } catch (_) {}
  const btn = document.getElementById('defect-chat-sound-btn');
  if (btn) {
    const icon = btn.querySelector('i');
    if (icon) icon.className = 'ti ' + (cur ? 'ti-bell-off' : 'ti-bell');
  }
  if (!cur) {
    // включили — проиграем короткий ping чтобы пользователь услышал и одобрил autoplay
    _playDefectChatPing();
    showToast('Звук включён', 'success');
  } else {
    showToast('Звук выключен', 'info');
  }
}

function _playDefectChatPing() {
  if (!_getDefectSoundEnabled()) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = state._audioCtx || (state._audioCtx = new AudioCtx());
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    // Двойной ping (две короткие ноты)
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = t0 + i * 0.12;
      gain.gain.setValueAtTime(0.0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.10);
      osc.start(start);
      osc.stop(start + 0.12);
    });
  } catch (_) {}
}

// v2.40.0: форматирование разделителя дня
function _formatDaySeparator(iso) {
  // iso = "2026-05-25"
  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  if (iso === todayISO) return 'Сегодня';
  const yest = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  if (iso === yest.toISOString().slice(0, 10)) return 'Вчера';
  // 25 мая 2026 (или без года если этот год)
  const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  try {
    const parts = iso.split('-');
    const y = parseInt(parts[0], 10);
    const mo = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    const sameYear = y === today.getFullYear();
    return d + ' ' + months[mo] + (sameYear ? '' : ' ' + y);
  } catch (e) {
    return iso;
  }
}

// v2.37.0: удаление сообщения чата (только сотрудник с defects.resolve)
async function deleteDefectMessage(msgId) {
  if (!state.currentDefectId) return;
  if (!confirm('Удалить это сообщение?')) return;
  const token = localStorage.getItem(TOKEN_KEY);
  try {
    const r = await fetch(
      API_BASE + '/api/defects/' + state.currentDefectId + '/messages/' + msgId,
      { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } }
    );
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      showToast(e.message || 'Не удалось удалить', 'error');
      return;
    }
    loadDefectMessages(state.currentDefectId);
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

function _formatChatTime(iso) {
  if (!iso) return '';
  // 2026-05-25 14:32:11 → 14:32 / 25.05 14:32 / 25.05.2026 14:32
  const s = String(iso).replace('T', ' ');
  const today = new Date().toISOString().slice(0, 10);
  if (s.startsWith(today)) return s.slice(11, 16);
  // другой день этого года
  const year = String(new Date().getFullYear());
  if (s.startsWith(year)) return s.slice(8, 10) + '.' + s.slice(5, 7) + ' ' + s.slice(11, 16);
  return s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) + ' ' + s.slice(11, 16);
}

function autosizeDefectChatInput(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

function addDefectChatAttachments(input) {
  if (!input.files || !input.files.length) return;
  state._defectChatAttachments = state._defectChatAttachments || [];
  const remaining = 5 - state._defectChatAttachments.length;
  const files = Array.from(input.files).slice(0, remaining);
  files.forEach(file => {
    const ct = file.type || '';
    let limit, kind;
    if (ct.startsWith('image/')) { limit = 8 * 1024 * 1024;  kind = 'photo'; }
    else if (ct.startsWith('video/')) { limit = 50 * 1024 * 1024; kind = 'video'; }
    else { limit = 20 * 1024 * 1024; kind = 'document'; }
    if (file.size > limit) {
      showToast('"' + file.name + '" — больше ' + Math.round(limit/1024/1024) + ' МБ', 'error');
      return;
    }
    state._defectChatAttachments.push({ file, kind });
  });
  input.value = '';
  renderDefectChatAttachments();
}

function removeDefectChatAttachment(idx) {
  if (!state._defectChatAttachments) return;
  state._defectChatAttachments.splice(idx, 1);
  renderDefectChatAttachments();
}

function renderDefectChatAttachments() {
  const wrap = document.getElementById('defect-chat-attachments');
  if (!wrap) return;
  const arr = state._defectChatAttachments || [];
  if (!arr.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = arr.map((a, i) => {
    const icon = a.kind === 'photo' ? 'ti-photo' :
                 a.kind === 'video' ? 'ti-movie' : 'ti-file-text';
    return '<div class="defect-chat-att"><i class="ti ' + icon + '"></i>' +
      '<span>' + escapeHtml(a.file.name) + '</span>' +
      '<button onclick="removeDefectChatAttachment(' + i + ')" type="button">×</button></div>';
  }).join('');
}

async function sendDefectChatMessage() {
  const ta = document.getElementById('defect-chat-text');
  const text = (ta && ta.value || '').trim();
  const atts = state._defectChatAttachments || [];
  if (!text && !atts.length) { showToast('Напишите сообщение или прикрепите файл', 'error'); return; }
  if (!state.currentDefectId) return;
  const fd = new FormData();
  if (text) fd.append('text', text);
  atts.forEach((a, i) => fd.append('file_' + (i + 1), a.file, a.file.name));
  const token = localStorage.getItem(TOKEN_KEY);
  const sendBtn = document.querySelector('.defect-chat-send');
  if (sendBtn) sendBtn.disabled = true;
  try {
    const r = await fetch(API_BASE + '/api/defects/' + state.currentDefectId + '/messages', {
      method: 'POST', body: fd,
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      showToast(e.message || 'Не удалось отправить', 'error');
      return;
    }
    // Очистим input и вложения
    if (ta) { ta.value = ''; autosizeDefectChatInput(ta); }
    state._defectChatAttachments = [];
    renderDefectChatAttachments();
    // Перезагрузим ленту
    loadDefectMessages(state.currentDefectId);
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

// v2.37.0: модалка редактирования заявки
async function openEditDefectModal() {
  const d = state._currentDefect;
  if (!d) { showToast('Сначала загрузите карточку', 'error'); return; }
  let m = document.getElementById('defect-edit-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'defect-edit-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) closeEditDefectModal(); };
    document.body.appendChild(m);
  }

  let typeOptions = '';
  Object.entries(DEFECT_TYPE_LABELS).forEach(([k, v]) => {
    typeOptions += '<option value="' + k + '"' + (d.type === k ? ' selected' : '') + '>' + escapeHtml(v.label) + '</option>';
  });

  let catOptions = '<option value="">— Не указана —</option>';
  Object.entries(DEFECT_CATEGORY_LABELS).forEach(([k, v]) => {
    catOptions += '<option value="' + k + '"' + (d.category === k ? ' selected' : '') + '>' + escapeHtml(v) + '</option>';
  });

  // v2.38.0: контрагенты — заполняем после загрузки. Пока показываем текущего (если есть) с пометкой.
  let contractorOptions = '<option value="">— Не указан —</option>';
  if (d.contractor_id) {
    contractorOptions += '<option value="' + d.contractor_id + '" selected>' +
      escapeHtml(d.contractor_name || ('#' + d.contractor_id)) + ' (текущий)</option>';
  }

  m.innerHTML = '<div class="modal" onclick="event.stopPropagation()" style="max-width: 520px;">' +
    '<div class="modal-header">' +
      '<h3><i class="ti ti-edit"></i> Редактировать заявку #' + d.id + '</h3>' +
      '<button class="modal-close" onclick="closeEditDefectModal()"><i class="ti ti-x"></i></button>' +
    '</div>' +
    '<div class="modal-content">' +
      '<div class="defect-form">' +
        '<div class="form-group"><label>Тип</label>' +
          '<select id="def-edit-type">' + typeOptions + '</select>' +
        '</div>' +
        '<div class="form-group"><label>Категория проблемы</label>' +
          '<select id="def-edit-category">' + catOptions + '</select>' +
        '</div>' +
        '<div class="form-group"><label>Контрагент</label>' +
          '<select id="def-edit-contractor">' + contractorOptions + '</select>' +
          '<div class="upload-hint" id="def-edit-contractor-hint">Загружаем список…</div>' +
        '</div>' +
        '<div class="form-group"><label>Описание *</label>' +
          '<textarea id="def-edit-description" rows="5">' + escapeHtml(d.description || '') + '</textarea>' +
        '</div>' +
        '<div class="form-group"><label>Где найдено</label>' +
          '<input type="text" id="def-edit-location" value="' + escapeHtml(d.location || '') + '" placeholder="например: ТП-3 на объекте Невский">' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="closeEditDefectModal()">Отмена</button>' +
      '<button class="btn btn-primary" id="def-edit-save-btn" onclick="saveDefectEdits()">' +
        '<i class="ti ti-check"></i> Сохранить' +
      '</button>' +
    '</div>' +
  '</div>';
  m.classList.add('visible');

  // Подгружаем список контрагентов
  _loadContractorsForDefectEdit(d.contractor_id);
}

async function _loadContractorsForDefectEdit(currentId) {
  const sel = document.getElementById('def-edit-contractor');
  const hint = document.getElementById('def-edit-contractor-hint');
  if (!sel) return;
  try {
    const r = await apiGet('/api/contractors');
    const list = (r && r.contractors) || [];
    let html = '<option value="">— Не указан —</option>';
    list.forEach(c => {
      const selAttr = String(c.id) === String(currentId || '') ? ' selected' : '';
      const typeLbl = c.type_label ? ' · ' + c.type_label : '';
      html += '<option value="' + c.id + '"' + selAttr + '>' +
        escapeHtml(c.name || ('#' + c.id)) + escapeHtml(typeLbl) + '</option>';
    });
    sel.innerHTML = html;
    if (hint) hint.style.display = 'none';
  } catch (e) {
    if (hint) {
      hint.textContent = 'Не удалось загрузить список контрагентов';
      hint.style.color = 'var(--danger)';
    }
  }
}

function closeEditDefectModal() {
  const m = document.getElementById('defect-edit-modal');
  if (m) m.classList.remove('visible');
}

async function saveDefectEdits() {
  const id = state.currentDefectId;
  if (!id) return;
  const type_  = (document.getElementById('def-edit-type') || {}).value;
  const cat    = (document.getElementById('def-edit-category') || {}).value;
  const desc   = ((document.getElementById('def-edit-description') || {}).value || '').trim();
  const loc    = ((document.getElementById('def-edit-location') || {}).value || '').trim();
  const contractorRaw = ((document.getElementById('def-edit-contractor') || {}).value || '').trim();
  if (!desc) { showToast('Описание не может быть пустым', 'error'); return; }
  const btn = document.getElementById('def-edit-save-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader"></i> Сохраняем…'; }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const body = {
      type: type_,
      category: cat,
      description: desc,
      location: loc,
      contractor_id: contractorRaw ? parseInt(contractorRaw, 10) : null,
    };
    const r = await fetch(API_BASE + '/api/defects/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      showToast(e.message || 'Не удалось сохранить', 'error');
      return;
    }
    showToast('Сохранено', 'success');
    closeEditDefectModal();
    openDefectDetail(id);
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-check"></i> Сохранить'; }
  }
}

// v2.37.0: модалка «Поделиться ссылкой»
async function openShareDefectLink() {
  const id = state.currentDefectId;
  if (!id) return;
  let m = document.getElementById('defect-share-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'defect-share-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) m.classList.remove('visible'); };
    document.body.appendChild(m);
  }
  m.innerHTML = '<div class="modal" onclick="event.stopPropagation()" style="max-width: 520px;">' +
    '<div class="modal-header">' +
      '<h3><i class="ti ti-share"></i> Ссылка на заявку</h3>' +
      '<button class="modal-close" onclick="document.getElementById(\'defect-share-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
    '</div>' +
    '<div class="modal-content"><div class="loading-block">Получаем ссылку…</div></div>' +
  '</div>';
  m.classList.add('visible');

  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/defects/' + id + '/public-token', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      m.querySelector('.modal-content').innerHTML =
        '<div class="empty-block"><i class="ti ti-alert-triangle"></i>' +
        escapeHtml(e.message || 'Не удалось получить ссылку') + '</div>';
      return;
    }
    const d = await r.json();
    // v2.38.1: query-формат — работает без правок vercel.json.
    // Если хочешь красивый URL /d/<token> — добавь rewrite в vercel.json и поменяй на:
    //   const url = window.location.origin + '/d/' + d.public_token;
    const url = window.location.origin + '/?d=' + encodeURIComponent(d.public_token);
    m.querySelector('.modal-content').innerHTML =
      '<p style="margin-top:0; color: var(--text-mid);">Скиньте эту ссылку — получатель сможет посмотреть карточку и написать в обсуждение. Регистрация не нужна, попросим только имя и телефон.</p>' +
      '<div style="display:flex; gap:8px; align-items:center; margin-top:14px;">' +
        '<input type="text" id="defect-share-url" value="' + escapeHtml(url) + '" readonly style="flex:1;" onclick="this.select()">' +
        '<button class="btn btn-primary" onclick="copyDefectShareLink()"><i class="ti ti-copy"></i> Копировать</button>' +
      '</div>' +
      '<div style="margin-top: 12px; font-size: 12px; color: var(--text-light);">' +
        '<i class="ti ti-info-circle"></i> Ссылка остаётся рабочей пока заявка существует.' +
      '</div>';
  } catch (e) {
    m.querySelector('.modal-content').innerHTML =
      '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка сети</div>';
  }
}

function copyDefectShareLink() {
  const inp = document.getElementById('defect-share-url');
  if (!inp) return;
  inp.select();
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(inp.value).then(
        () => showToast('Ссылка скопирована', 'success'),
        () => { document.execCommand('copy'); showToast('Ссылка скопирована', 'success'); }
      );
    } else {
      document.execCommand('copy');
      showToast('Ссылка скопирована', 'success');
    }
  } catch (e) {
    showToast('Не удалось скопировать — выделите вручную', 'error');
  }
}

async function changeDefectStatus(newStatus) {
  if (!state.currentDefectId) return;
  let note = '';
  if (newStatus === 'resolved' || newStatus === 'rejected') {
    note = prompt(newStatus === 'resolved' ? 'Комментарий что сделано (опционально):' : 'Причина отклонения (опционально):') || '';
  }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/defects/' + state.currentDefectId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ status: newStatus, resolution_note: note }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      showToast(e.message || 'Не удалось изменить статус', 'error');
      return;
    }
    showToast('Статус изменён', 'success');
    openDefectDetail(state.currentDefectId);
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

async function deleteCurrentDefect() {
  if (!state.currentDefectId) return;
  if (!confirm('Удалить замечание?')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/defects/' + state.currentDefectId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) { showToast('Не удалось удалить', 'error'); return; }
    showToast('Удалено', 'success');
    state.currentDefectId = null;
    selectSidebarItem('defects-list');
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// Лайтбокс
function openPhotoLightbox(url) {
  const lb = document.getElementById('photo-lightbox');
  const img = document.getElementById('photo-lightbox-img');
  if (img) img.src = url;
  if (lb) lb.classList.add('visible');
}
function closePhotoLightbox() {
  const lb = document.getElementById('photo-lightbox');
  if (lb) lb.classList.remove('visible');
}


// ============================================================
// ============ ЭТАП 23: Кнопки «Доработка» и «Отправить монтажнику» ============
// ============================================================

/**
 * Открывает форму добавления замечания (для сборки) из карточки внутри CRM.
 * Получает публичный токен и открывает ту же форму что и публичная страница,
 * но с предзаполненным именем сотрудника.
 */
async function openDefectFormForAssembly(assemblyId) {
  try {
    const r = await apiGet('/api/assemblies/' + assemblyId + '/public-token');
    if (!r.public_token) { showToast('Не удалось получить токен', 'error'); return; }
    closeAssemblyStockModal();
    state._defectFormState = {
      targetType: 'assembly',
      token: r.public_token,
      type: 'defect',
      description: '',
      author_name: (state.user && (state.user.short_name || state.user.full_name)) || '',
      author_phone: (state.user && state.user.phone) || '',
      location: '',
      photos: [],
    category: '',
    };
    const m = document.getElementById('defect-form-modal');
    if (!m) return;
    m.innerHTML = renderDefectFormHtml();
    m.classList.add('visible');
  } catch (e) {
    showToast('Ошибка', 'error');
  }
}

async function openDefectFormForContract() {
  if (!state.currentContractId) return;
  try {
    const r = await apiGet('/api/contracts/' + state.currentContractId + '/public-token');
    if (!r.public_token) { showToast('Не удалось получить токен', 'error'); return; }
    state._defectFormState = {
      targetType: 'contract',
      token: r.public_token,
      type: 'defect',
      description: '',
      author_name: (state.user && (state.user.short_name || state.user.full_name)) || '',
      author_phone: (state.user && state.user.phone) || '',
      location: '',
      photos: [],
    category: '',
    };
    const m = document.getElementById('defect-form-modal');
    if (!m) return;
    m.innerHTML = renderDefectFormHtml();
    m.classList.add('visible');
  } catch (e) {
    showToast('Ошибка', 'error');
  }
}

/**
 * Модалка «Отправить монтажнику» — копирование ссылки, Telegram-share, QR-код.
 */
async function openShareWithInstaller(assemblyId, type) {
  try {
    const r = await apiGet('/api/assemblies/' + assemblyId + '/public-token');
    if (!r.public_token) { showToast('Не удалось получить токен', 'error'); return; }
    const url = window.location.origin + '/a/' + r.public_token;
    showShareInstallerModal(url, 'сборки');
  } catch (e) {
    showToast('Ошибка', 'error');
  }
}

async function openShareWithInstallerForContract() {
  if (!state.currentContractId) return;
  try {
    const r = await apiGet('/api/contracts/' + state.currentContractId + '/public-token');
    if (!r.public_token) { showToast('Не удалось получить токен', 'error'); return; }
    const url = window.location.origin + '/c/' + r.public_token;
    showShareInstallerModal(url, 'договора');
  } catch (e) {
    showToast('Ошибка', 'error');
  }
}

function showShareInstallerModal(url, label) {
  const m = document.getElementById('qr-modal');
  if (!m) return;
  const tgText = encodeURIComponent('Ссылка на ' + label + ': ' + url + '\n\nНа этой странице ты можешь увидеть всю информацию и оставить замечание с фото.');
  const tgUrl = 'https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent('Информация по ' + label + '. По ссылке можно увидеть детали и оставить замечание.');
  const urlEscaped = JSON.stringify(url).replace(/"/g, '&quot;');
  m.innerHTML =
    '<div class="modal modal-wide" onclick="event.stopPropagation()">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-send"></i> Отправить монтажнику</h3>' +
        '<button class="modal-close" onclick="closeQrModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="qr-modal-body">' +
        '<div style="color: var(--text); margin-bottom: 12px; font-size: 14px;">' +
          'По этой ссылке монтажник увидит всю информацию по ' + label + ' и сможет оставить замечание с фото.' +
        '</div>' +
        '<div class="qr-canvas-wrap" id="qr-canvas-wrap"></div>' +
        '<div class="qr-url-display">' + escapeHtml(url) + '</div>' +
        '<div class="qr-actions">' +
          '<a class="btn btn-primary" href="' + tgUrl + '" target="_blank" rel="noopener">' +
            '<i class="ti ti-brand-telegram"></i> Отправить в Telegram' +
          '</a>' +
          '<button class="btn btn-secondary" onclick="copyQrUrl(' + urlEscaped + ')">' +
            '<i class="ti ti-copy"></i> Копировать ссылку' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
  // Генерируем QR — монтажник может его отсканировать с экрана
  setTimeout(() => {
    const wrap = document.getElementById('qr-canvas-wrap');
    if (!wrap) return;
    generateQrWithLogo(wrap, { text: url, width: 220 });
  }, 50);
}


// ============================================================
// ============ ЭТАП 23+: «+ Новая доработка» из CRM ============
// ============================================================

/**
 * Кнопка «+ Новая доработка» в разделе Доработок и в шапке списка.
 * Открывает простую модалку выбора привязки: к сборке / к договору / без привязки.
 */
function openNewDefectFromCRM() {
  state._defectPickerMode = 'defect';     // ЭТАП 23+: режим — создать замечание
  const m = document.getElementById('qr-modal');
  if (!m) return;
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width: 460px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-alert-circle"></i> Новая доработка</h3>' +
        '<button class="modal-close" onclick="closeQrModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content" style="display: flex; flex-direction: column; gap: 10px;">' +
        '<div style="color: var(--text-light); font-size: 13.5px; margin-bottom: 4px;">К чему привязать замечание?</div>' +
        '<button class="defect-target-btn" onclick="pickAssemblyForDefect()">' +
          '<i class="ti ti-package"></i>' +
          '<div><div class="dt-title">К сборке / работе</div>' +
          '<div class="dt-meta">Выбрать из журнала производства</div></div>' +
          '<i class="ti ti-chevron-right dt-chev"></i>' +
        '</button>' +
        '<button class="defect-target-btn" onclick="pickContractForDefect()">' +
          '<i class="ti ti-file-text"></i>' +
          '<div><div class="dt-title">К договору</div>' +
          '<div class="dt-meta">Выбрать из активных договоров</div></div>' +
          '<i class="ti ti-chevron-right dt-chev"></i>' +
        '</button>' +
        '<button class="defect-target-btn" onclick="openInternalDefectForm()">' +
          '<i class="ti ti-note"></i>' +
          '<div><div class="dt-title">Без привязки</div>' +
          '<div class="dt-meta">Общее замечание или идея</div></div>' +
          '<i class="ti ti-chevron-right dt-chev"></i>' +
        '</button>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
}

/**
 * Кнопка «Отправить монтажнику» из раздела Доработок.
 * Выбираем объект → получаем QR + ссылку + Telegram-share.
 */
function openShareForInstallerFromCRM() {
  state._defectPickerMode = 'share';      // ЭТАП 23+: режим — отправить ссылку монтажнику
  const m = document.getElementById('qr-modal');
  if (!m) return;
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width: 460px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-send"></i> Отправить монтажнику</h3>' +
        '<button class="modal-close" onclick="closeQrModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content" style="display: flex; flex-direction: column; gap: 10px;">' +
        '<div style="color: var(--text-light); font-size: 13.5px; margin-bottom: 4px;">Выберите по какому объекту нужна ссылка для монтажника</div>' +
        '<button class="defect-target-btn" onclick="pickAssemblyForDefect()">' +
          '<i class="ti ti-package"></i>' +
          '<div><div class="dt-title">Ссылка на сборку / работу</div>' +
          '<div class="dt-meta">Выбрать из журнала производства</div></div>' +
          '<i class="ti ti-chevron-right dt-chev"></i>' +
        '</button>' +
        '<button class="defect-target-btn" onclick="pickContractForDefect()">' +
          '<i class="ti ti-file-text"></i>' +
          '<div><div class="dt-title">Ссылка на договор</div>' +
          '<div class="dt-meta">Выбрать из активных договоров</div></div>' +
          '<i class="ti ti-chevron-right dt-chev"></i>' +
        '</button>' +
        '<button class="defect-target-btn" onclick="shareGeneralFeedbackLink()">' +
          '<i class="ti ti-note"></i>' +
          '<div><div class="dt-title">Общая ссылка (без привязки)</div>' +
          '<div class="dt-meta">Форма для любых замечаний и идей</div></div>' +
          '<i class="ti ti-chevron-right dt-chev"></i>' +
        '</button>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
}

/** Открывает QR + share для общей публичной ссылки /feedback. */
function shareGeneralFeedbackLink() {
  const url = window.location.origin + '/feedback';
  showShareInstallerModal(url, 'обратной связи');
}

/** Форма замечания «без привязки» (внутренняя). */
function openInternalDefectForm() {
  closeQrModal();
  state._defectFormState = {
    targetType: 'internal',
    token: '',
    type: 'defect',
    description: '',
    author_name: (state.user && (state.user.short_name || state.user.full_name)) || '',
    author_phone: (state.user && state.user.phone) || '',
    location: '',
    photos: [],
    category: '',
  };
  const m = document.getElementById('defect-form-modal');
  if (!m) return;
  m.innerHTML = renderDefectFormHtml();
  m.classList.add('visible');
}

/** Выбор сборки для замечания — список из API. */
async function pickAssemblyForDefect() {
  const mode = state._defectPickerMode || 'defect';
  const backFn = mode === 'share' ? 'openShareForInstallerFromCRM()' : 'openNewDefectFromCRM()';
  const title  = mode === 'share' ? 'Выбрать сборку для ссылки' : 'Выбрать сборку / работу';
  const m = document.getElementById('qr-modal');
  if (!m) return;
  m.innerHTML =
    '<div class="modal modal-wide" onclick="event.stopPropagation()">' +
      '<div class="modal-header">' +
        '<button class="icon-btn" onclick="' + backFn + '" title="Назад"><i class="ti ti-arrow-left"></i></button>' +
        '<h3 style="margin-left: 4px;"><i class="ti ti-package"></i> ' + title + '</h3>' +
        '<button class="modal-close" onclick="closeQrModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content">' +
        '<input type="text" class="text-input-fw" id="defect-asm-search" placeholder="Поиск по модели или артикулу…" oninput="filterDefectAssemblyList()">' +
        '<div id="defect-asm-list" style="margin-top: 12px;">' +
          '<div class="loading-block">Загружаем…</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
  try {
    const d = await apiGet('/api/warehouse/stock');
    state._defectAsmList = d.items || d.assemblies || [];
    renderDefectAssemblyList();
  } catch (e) {
    const list = document.getElementById('defect-asm-list');
    if (list) list.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Не удалось загрузить</div>';
  }
}

function filterDefectAssemblyList() {
  renderDefectAssemblyList();
}

function renderDefectAssemblyList() {
  const list = document.getElementById('defect-asm-list');
  if (!list) return;
  const q = (document.getElementById('defect-asm-search')?.value || '').toLowerCase().trim();
  const items = (state._defectAsmList || []).filter(s => {
    if (!q) return true;
    const txt = ((s.model_name || '') + ' ' + (s.model_article || '') + ' ' + (s.description || '')).toLowerCase();
    return txt.includes(q);
  });
  if (!items.length) {
    list.innerHTML = '<div class="empty-block"><i class="ti ti-mood-empty"></i>Ничего не найдено</div>';
    return;
  }
  list.innerHTML = items.slice(0, 100).map(s => {
    const wt = s.work_type && s.work_type !== 'assembly';
    const wtLabel = wt ? ({repair:'Ремонт',commissioning:'Пусконаладка',installation:'Монтаж',diagnostics:'Диагностика',design:'Проектирование',maintenance:'ТО',other:'Прочее'}[s.work_type] || s.work_type) : '';
    const title = s.model_name || (wtLabel || 'Запись #' + s.id);
    const meta  = [
      s.model_article || '',
      s.assembly_date || '',
      wt ? ('<span class="work-type-badge wt-' + s.work_type + '" style="margin-left:6px;">' + escapeHtml(wtLabel) + '</span>') : '',
    ].filter(Boolean).join(' · ');
    return '<div class="defect-picker-row" onclick="chooseAssemblyForDefect(' + s.id + ')">' +
      '<i class="ti ti-package"></i>' +
      '<div><div class="dp-title">' + escapeHtml(title) + '</div>' +
      '<div class="dp-meta">' + meta + '</div></div>' +
    '</div>';
  }).join('');
}

async function chooseAssemblyForDefect(assemblyId) {
  try {
    const r = await apiGet('/api/assemblies/' + assemblyId + '/public-token');
    if (!r.public_token) { showToast('Не удалось получить токен', 'error'); return; }
    // Режим «share» — открываем модалку с QR + Telegram-share, форму замечания не показываем
    if (state._defectPickerMode === 'share') {
      const url = window.location.origin + '/a/' + r.public_token;
      showShareInstallerModal(url, 'сборки');
      return;
    }
    // Режим «defect» — открываем форму создания замечания (как раньше)
    closeQrModal();
    state._defectFormState = {
      targetType: 'assembly',
      token: r.public_token,
      type: 'defect',
      description: '',
      author_name: (state.user && (state.user.short_name || state.user.full_name)) || '',
      author_phone: (state.user && state.user.phone) || '',
      location: '',
      photos: [],
    category: '',
    };
    const m = document.getElementById('defect-form-modal');
    if (!m) return;
    m.innerHTML = renderDefectFormHtml();
    m.classList.add('visible');
  } catch (e) {
    showToast('Ошибка', 'error');
  }
}

async function pickContractForDefect() {
  const mode = state._defectPickerMode || 'defect';
  const backFn = mode === 'share' ? 'openShareForInstallerFromCRM()' : 'openNewDefectFromCRM()';
  const title  = mode === 'share' ? 'Выбрать договор для ссылки' : 'Выбрать договор';
  const m = document.getElementById('qr-modal');
  if (!m) return;
  m.innerHTML =
    '<div class="modal modal-wide" onclick="event.stopPropagation()">' +
      '<div class="modal-header">' +
        '<button class="icon-btn" onclick="' + backFn + '" title="Назад"><i class="ti ti-arrow-left"></i></button>' +
        '<h3 style="margin-left: 4px;"><i class="ti ti-file-text"></i> ' + title + '</h3>' +
        '<button class="modal-close" onclick="closeQrModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content">' +
        '<input type="text" class="text-input-fw" id="defect-c-search" placeholder="Поиск по номеру или контрагенту…" oninput="filterDefectContractList()">' +
        '<div id="defect-c-list" style="margin-top: 12px;">' +
          '<div class="loading-block">Загружаем…</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
  try {
    const d = await apiGet('/api/contracts');
    state._defectContractList = d.contracts || [];
    renderDefectContractList();
  } catch (e) {
    const list = document.getElementById('defect-c-list');
    if (list) list.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Не удалось загрузить</div>';
  }
}

function filterDefectContractList() {
  renderDefectContractList();
}

function renderDefectContractList() {
  const list = document.getElementById('defect-c-list');
  if (!list) return;
  const q = (document.getElementById('defect-c-search')?.value || '').toLowerCase().trim();
  const items = (state._defectContractList || []).filter(c => {
    if (!q) return true;
    const txt = ((c.number || '') + ' ' + (c.contractor_name || '')).toLowerCase();
    return txt.includes(q);
  });
  if (!items.length) {
    list.innerHTML = '<div class="empty-block"><i class="ti ti-mood-empty"></i>Ничего не найдено</div>';
    return;
  }
  list.innerHTML = items.slice(0, 100).map(c => {
    return '<div class="defect-picker-row" onclick="chooseContractForDefect(' + c.id + ')">' +
      '<i class="ti ti-file-text"></i>' +
      '<div><div class="dp-title">' + escapeHtml(c.number || '#' + c.id) + '</div>' +
      '<div class="dp-meta">' + escapeHtml(c.contractor_name || '') + (c.sum_amount ? ' · ' + Number(c.sum_amount).toLocaleString('ru-RU') + ' ₽' : '') + '</div></div>' +
    '</div>';
  }).join('');
}

async function chooseContractForDefect(contractId) {
  try {
    const r = await apiGet('/api/contracts/' + contractId + '/public-token');
    if (!r.public_token) { showToast('Не удалось получить токен', 'error'); return; }
    if (state._defectPickerMode === 'share') {
      const url = window.location.origin + '/c/' + r.public_token;
      showShareInstallerModal(url, 'договора');
      return;
    }
    closeQrModal();
    state._defectFormState = {
      targetType: 'contract',
      token: r.public_token,
      type: 'defect',
      description: '',
      author_name: (state.user && (state.user.short_name || state.user.full_name)) || '',
      author_phone: (state.user && state.user.phone) || '',
      location: '',
      photos: [],
    category: '',
    };
    const m = document.getElementById('defect-form-modal');
    if (!m) return;
    m.innerHTML = renderDefectFormHtml();
    m.classList.add('visible');
  } catch (e) {
    showToast('Ошибка', 'error');
  }
}


// ============================================================
// ============ ЭТАП 25.1: DRAWER (мобильный sidebar) ==========
// ============================================================

/**
 * Открывает drawer-меню текущего раздела (мобила).
 * Берёт активный sidebar (по data-visible="1") и показывает его как drawer.
 */
// ===== v2.45.638: динамические блоки шторки — лента разделов, поиск, «Сегодня» =====
const DRW_SECTIONS = [
  { code: 'home',         icon: 'ti-home',               label: 'Главная' },
  { code: 'production',   icon: 'ti-tool',               label: 'Производ.' },
  { code: 'sales',        icon: 'ti-briefcase',          label: 'Продажи' },
  { code: 'tasks',        icon: 'ti-checklist',          label: 'Задачи' },
  { code: 'warehouse',    icon: 'ti-building-warehouse', label: 'Склад' },
  { code: 'supply',       icon: 'ti-shopping-cart',      label: 'Снабжен.' },
  { code: 'defects',      icon: 'ti-alert-circle',       label: 'Сервис' },
  { code: 'installation', icon: 'ti-tools',              label: 'Монтаж' },
  { code: 'hr',           icon: 'ti-id-badge',           label: 'Кадры' },
  { code: 'help',         icon: 'ti-help-circle',        label: 'Помощь' },
];

function _drwGoSection(code) {
  const cur = document.querySelector('.sidebar.drawer-mode');
  if (cur && cur.dataset.section === code) { closeSectionDrawer(); return; }
  // Мгновенно прячем текущую шторку, переключаем раздел и открываем его шторку —
  // ощущение «переключил, не закрывая».
  if (cur) cur.classList.remove('drawer-mode', 'open');
  try { selectSection(code); } catch (e) {}
  setTimeout(() => { try { openSectionDrawer(); } catch (e) {} }, 120);
}

function _drwOpenSearch() {
  closeSectionDrawer();
  setTimeout(() => { try { switchMainTab('search'); } catch (e) { try { openDesktopSearch(); } catch (e2) {} } }, 100);
}

function _drwGo(section, item, filter) {
  closeSectionDrawer();
  try { selectSection(section); } catch (e) {}
  setTimeout(() => {
    try { selectSidebarItem(item); } catch (e) {}
    if (filter) setTimeout(() => { try { pkbSetFilter(filter); } catch (e) {} }, 450);
  }, 100);
}

function _drwOpenContract(id) {
  closeSectionDrawer();
  setTimeout(() => { try { openContractDetail(id); } catch (e) {} }, 100);
}

function _drwOverdueContracts() {
  window._ctOverdueOnly = true;
  _drwGo('sales', 'sales-contracts');
}

// Строки «Сегодня» — из уже загруженных кэшей (без запросов). Пусто — блок не показываем.
function _drwTodayRows(sec) {
  const rows = [];
  if (sec === 'production' || sec === 'home') {
    const works = (cache.productionKanban && cache.productionKanban.works) || [];
    const act = works.filter(w => ['queue', 'in_progress', 'review', 'packing'].indexOf(w.status) >= 0);
    const over = act.filter(w => w.is_overdue);
    const blocked = act.filter(w => w.is_blocked);
    if (over.length) {
      let worst = 0;
      over.forEach(w => { try { worst = Math.max(worst, pkbOverdueDays(w.deadline_at)); } catch (e) {} });
      rows.push('<div class="drw-trow" onclick="_drwGo(\'production\',\'dashboard\',\'overdue\')">' +
        '<span class="drw-tdot" style="background:#F87171;"></span>' +
        '<span><b>' + over.length + '</b> ' + plural(over.length, 'просрочка', 'просрочки', 'просрочек') +
        (worst > 0 ? ' · худшая −' + worst + ' дн' : '') + '</span><span class="drw-tgo">показать →</span></div>');
    }
    if (blocked.length) {
      rows.push('<div class="drw-trow" onclick="_drwGo(\'production\',\'dashboard\',\'blocked\')">' +
        '<span class="drw-tdot" style="background:#FBBF24;"></span>' +
        '<span><b>' + blocked.length + '</b> ' + plural(blocked.length, 'работа', 'работы', 'работ') + ' без деталей</span>' +
        '<span class="drw-tgo">показать →</span></div>');
    }
  }
  if (sec === 'sales') {
    const cwp = cache.contractsWithProgress || [];
    if (cwp.length) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      let overN = 0, worst = 0;
      cwp.forEach(c => {
        if (c.delivery_date && c.status !== 'shipped' && c.status !== 'closed') {
          const dd = Math.round((new Date(c.delivery_date + 'T00:00:00') - today) / 86400000);
          if (dd < 0) { overN++; worst = Math.max(worst, -dd); }
        }
      });
      if (overN) {
        rows.push('<div class="drw-trow" onclick="_drwOverdueContracts()">' +
          '<span class="drw-tdot" style="background:#F87171;"></span>' +
          '<span><b>' + overN + '</b> ' + plural(overN, 'договор просрочен', 'договора просрочены', 'договоров просрочены') + ' · −' + worst + ' дн</span>' +
          '<span class="drw-tgo">показать →</span></div>');
      }
    }
  }
  if (sec === 'production' || sec === 'home' || sec === 'sales') {
    const ships = (cache.upcomingShipments && cache.upcomingShipments.contracts) || [];
    if (ships.length) {
      const c = ships[0];
      let dStr = '';
      if (c.delivery_date) {
        const p = String(c.delivery_date).slice(0, 10).split('-');
        if (p.length === 3) dStr = p[2] + '.' + p[1];
      }
      const late = (c.days_to_deadline != null && c.days_to_deadline <= 0);
      rows.push('<div class="drw-trow" onclick="_drwOpenContract(' + c.id + ')">' +
        '<span class="drw-tdot" style="background:' + (late ? '#F87171' : '#7FB2E5') + ';"></span>' +
        '<span>Отгрузка <b>' + escapeHtml(dStr || '—') + '</b> · ' + escapeHtml((c.contractor_name || c.number || '').slice(0, 22)) + '</span>' +
        '<span class="drw-tgo">открыть →</span></div>');
    }
  }
  return rows.join('');
}

function _drwInjectExtras(sidebar) {
  // Пересобираем блоки при каждом открытии (данные из кэшей могли обновиться)
  sidebar.querySelectorAll('.drw-x').forEach(n => n.remove());
  const sec = sidebar.dataset.section || '';

  // Верх: лента разделов + поиск
  const top = document.createElement('div');
  top.className = 'drw-x drw-top';
  let strip = '<div class="drw-secs">';
  DRW_SECTIONS.forEach(s => {
    strip += '<div class="drw-sec' + (s.code === sec ? ' on' : '') + '" onclick="_drwGoSection(\'' + s.code + '\')">' +
      '<i class="ti ' + s.icon + '"></i><span>' + s.label + '</span></div>';
  });
  strip += '</div>';
  top.innerHTML = strip +
    '<div class="drw-search" onclick="_drwOpenSearch()"><i class="ti ti-search"></i> Договор, сборка, деталь…</div>';
  sidebar.insertBefore(top, sidebar.firstChild);

  // Низ: «Сегодня» перед футером профиля
  const todayRows = _drwTodayRows(sec);
  if (todayRows) {
    const t = document.createElement('div');
    t.className = 'drw-x drw-today';
    t.innerHTML = '<div class="drw-grp">Сегодня</div>' + todayRows;
    const foot = sidebar.querySelector('.sidebar-footer');
    if (foot) sidebar.insertBefore(t, foot); else sidebar.appendChild(t);
  }
}

function openSectionDrawer() {
  // Находим активный sidebar (тот что data-visible="1" для текущего раздела)
  const sidebar = document.querySelector('.sidebar[data-visible="1"]');
  if (!sidebar) return;

  // Закрываем все другие drawer'ы (на всякий)
  document.querySelectorAll('.sidebar.drawer-mode').forEach(s => {
    s.classList.remove('drawer-mode', 'open');
  });

  // v2.45.638: лента разделов + поиск + «Сегодня»
  try { _drwInjectExtras(sidebar); } catch (e) {}

  sidebar.classList.add('drawer-mode');
  // Добавляем кнопку закрытия если её ещё нет
  if (!sidebar.querySelector('.drawer-close-btn')) {
    const btn = document.createElement('button');
    btn.className = 'drawer-close-btn';
    btn.innerHTML = '<i class="ti ti-x"></i>';
    btn.setAttribute('aria-label', 'Закрыть меню');
    btn.onclick = closeSectionDrawer;
    sidebar.appendChild(btn);
  }
  // Открываем с анимацией
  requestAnimationFrame(() => {
    sidebar.classList.add('open');
  });
  const ov = document.getElementById('drawer-overlay');
  if (ov) ov.classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function closeSectionDrawer() {
  const sidebar = document.querySelector('.sidebar.drawer-mode');
  if (sidebar) {
    sidebar.classList.remove('open');
    setTimeout(() => sidebar.classList.remove('drawer-mode'), 280);
  }
  const ov = document.getElementById('drawer-overlay');
  if (ov) ov.classList.remove('visible');
  document.body.style.overflow = '';
}

// Перехватываем клики по пунктам sidebar внутри drawer — закрываем drawer
document.addEventListener('click', function(e) {
  const navItem = e.target.closest && e.target.closest('.sidebar.drawer-mode .nav-item');
  if (navItem) {
    // Даём клику обработаться, потом закрываем drawer
    setTimeout(closeSectionDrawer, 50);
  }
}, true);

// ============ КОНЕЦ DRAWER ============


// ============================================================
// ============ ЭТАП 25.0: НОВАЯ МОБИЛЬНАЯ НАВИГАЦИЯ ===========
// ============================================================

// Главный мобильный таб (home/search/notifications/account)
state.currentMainTab = 'home';

/**
 * Переключение в нижнем единном tab-bar (мобилка).
 * home/account — переходят на соответствующие existing screens.
 * search/notifications — открывают overlay поверх контента.
 */
function switchMainTab(name) {
  state.currentMainTab = name;
  const app = document.getElementById('app');
  if (app) app.dataset.mainTab = name;

  // Подсветка кнопок
  document.querySelectorAll('#tab-bar-main .tab25[data-main-tab]').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector('#tab-bar-main .tab25[data-main-tab="' + name + '"]');
  if (btn) btn.classList.add('active');

  // Закрыть все overlay'и
  const so = document.getElementById('search25-screen');
  const no = document.getElementById('notif25-screen');
  if (so) so.style.display = 'none';
  if (no) no.style.display = 'none';

  if (name === 'home') {
    selectSection('home');
  } else if (name === 'account') {
    // Аккаунт — это экран внутри Производства в текущей архитектуре
    selectSection('production');
    setTimeout(() => selectSidebarItem('account'), 30);
  } else if (name === 'search') {
    if (so) so.style.display = 'block';
    setTimeout(() => {
      const inp = document.getElementById('search25-input');
      if (inp) inp.focus();
    }, 100);
  } else if (name === 'notifications') {
    if (no) no.style.display = 'block';
    renderNotifications25();
  }

  window.scrollTo({ top: 0, behavior: 'instant' });
}

/**
 * Когда пользователь переключает раздел через ВЕРХНИЕ табы — сбрасываем подсветку
 * нижнего tab-bar (кроме home/account которые имеют соответствие).
 */
function syncMainTabFromSection(sectionName, screenName) {
  let mainTab = null;
  if (sectionName === 'home') mainTab = 'home';
  else if (screenName === 'account') mainTab = 'account';
  // иначе — никакой не подсвечен

  state.currentMainTab = mainTab;
  const app = document.getElementById('app');
  if (app) app.dataset.mainTab = mainTab || '';

  document.querySelectorAll('#tab-bar-main .tab25[data-main-tab]').forEach(b => b.classList.remove('active'));
  if (mainTab) {
    const btn = document.querySelector('#tab-bar-main .tab25[data-main-tab="' + mainTab + '"]');
    if (btn) btn.classList.add('active');
  }
}

// ============ ACTION SHEET (+ кнопка) ============

// v2.45.607: единая кнопка «+» на мобиле. Раньше у экранов был свой плавающий
// FAB И центральный «+» таб-бара — два одинаковых плюса. Теперь FAB на мобиле
// скрыт (CSS), а центральный «+» делает контекстное действие активного экрана:
// если на экране есть свой .fab — жмём его (Новая заявка / Добавить заказ /
// Новая доработка / Новый чат / Новый монтаж), иначе открываем общий лист создания.
function mobilePlusAction() {
  const active = document.querySelector('.screen.active');
  if (active) {
    const fab = active.querySelector('.fab');
    // inline display:none = FAB сейчас неактуален (например, install-fab до выбора)
    if (fab && fab.style.display !== 'none') { fab.click(); return; }
  }
  openActionSheet25();
}

function openActionSheet25() {
  const sh = document.getElementById('action-sheet-25');
  if (!sh) return;
  // Проверяем роли — что показывать
  const roles = (state.user && state.user.roles) || [];
  const isDirector = roles.includes('director');
  const canSales = isDirector || roles.includes('manager') || roles.includes('zam');
  const canTasks = isDirector || roles.includes('manager') || roles.includes('zam');
  const canAssembly = isDirector || roles.includes('master') || roles.includes('engineer') || roles.includes('zam');

  const setShow = (id, show) => {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? '' : 'none';
  };
  setShow('sheet25-new-assembly', canAssembly);
  setShow('sheet25-new-contract', canSales);
  setShow('sheet25-new-offer',    canSales);
  setShow('sheet25-new-task',     canTasks);
  // Доработка и QR — для всех

  sh.classList.add('visible');
}

function closeActionSheet25(e) {
  if (e && e.target && !e.target.classList.contains('sheet25-overlay') && !e.target.classList.contains('sheet25-cancel')) return;
  const sh = document.getElementById('action-sheet-25');
  if (sh) sh.classList.remove('visible');
}

// ============ УНИВЕРСАЛЬНОЕ POPUP-МЕНЮ (v2.43.3 mobile-cleanup) ============
// Используется для kebab-меню (⋮) в карточках направлений и других мест.
// items = [{ label, icon, onclick, danger? }]
//   icon — класс Tabler ti-* без префикса (например 'edit')
//   danger — если true, пункт красным
// anchorEl — кнопка, рядом с которой открывать меню

function showSimpleMenu(anchorEl, items) {
  if (!anchorEl || !items || !items.length) return;
  // Закрываем предыдущее меню если открыто
  const existing = document.getElementById('simple-menu-popup');
  if (existing) existing.remove();

  const rect = anchorEl.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.id = 'simple-menu-popup';
  menu.className = 'simple-menu';
  menu.style.position = 'fixed';
  menu.style.zIndex = '10000';
  // Сначала добавим в DOM невидимо чтобы измерить размер, потом спозиционируем
  menu.style.visibility = 'hidden';

  items.forEach((it, idx) => {
    const btn = document.createElement('button');
    btn.className = 'simple-menu-item' + (it.danger ? ' danger' : '');
    btn.innerHTML =
      (it.icon ? '<i class="ti ti-' + it.icon + '"></i>' : '') +
      '<span>' + escapeHtml(it.label || '') + '</span>';
    btn.onclick = function (e) {
      e.stopPropagation();
      closeSimpleMenu();
      try { if (typeof it.onclick === 'function') it.onclick(); } catch (err) { console.error(err); }
    };
    menu.appendChild(btn);
  });
  document.body.appendChild(menu);

  // Позиционируем под anchor, выравниваем по правому краю
  const menuRect = menu.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let top = rect.bottom + 4;
  let left = rect.right - menuRect.width;
  if (left < 8) left = 8;
  if (left + menuRect.width > vw - 8) left = vw - menuRect.width - 8;
  // Если внизу не помещается — открыть вверх
  if (top + menuRect.height > vh - 8) top = Math.max(8, rect.top - menuRect.height - 4);
  menu.style.top = top + 'px';
  menu.style.left = left + 'px';
  menu.style.visibility = '';

  // Закрытие по клику вне меню
  setTimeout(() => {
    document.addEventListener('click', _simpleMenuOutsideClick, true);
    document.addEventListener('scroll', closeSimpleMenu, true);
  }, 0);
}

function _simpleMenuOutsideClick(e) {
  const menu = document.getElementById('simple-menu-popup');
  if (menu && !menu.contains(e.target)) closeSimpleMenu();
}

function closeSimpleMenu() {
  const menu = document.getElementById('simple-menu-popup');
  if (menu) menu.remove();
  document.removeEventListener('click', _simpleMenuOutsideClick, true);
  document.removeEventListener('scroll', closeSimpleMenu, true);
}

// Обёртка для kebab-меню направления (используется в renderModels)
function openDirectionKebabMenu(anchorEl, dirId) {
  showSimpleMenu(anchorEl, [
    { label: 'Переименовать', icon: 'edit',  onclick: function () { openEditDirectionModal(dirId); } },
    { label: 'Дублировать',   icon: 'copy',  onclick: function () { openDuplicateDirectionModal(dirId); } },
    { label: 'Удалить',       icon: 'trash', danger: true, onclick: function () { openDeleteDirectionModal(dirId); } },
  ]);
}

// ============ ПОИСК ============

state.search25Query = '';
state.search25Filter = 'all';
state.search25Timer = null;
// v2.45.280: история поиска (максимум 8) — храним в localStorage
const SEARCH25_HISTORY_KEY = 'atomus_search25_history';
function _search25LoadHistory() {
  try {
    const raw = localStorage.getItem(SEARCH25_HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(x => typeof x === 'string' && x).slice(0, 8) : [];
  } catch (e) { return []; }
}
function _search25SaveHistory(q) {
  q = String(q || '').trim();
  if (!q || q.length < 2) return;
  try {
    let arr = _search25LoadHistory();
    arr = [q, ...arr.filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
    localStorage.setItem(SEARCH25_HISTORY_KEY, JSON.stringify(arr));
  } catch (e) {}
}
function _search25ClearHistory() {
  try { localStorage.removeItem(SEARCH25_HISTORY_KEY); } catch (e) {}
  renderSearch25Empty();
}
function search25RunFromHistory(q) {
  const inp = document.getElementById('search25-input');
  if (inp) { inp.value = q; inp.focus(); }
  state.search25Query = q;
  const clr = document.getElementById('search25-clear');
  if (clr) clr.style.display = 'flex';
  runSearch25();
}

function onSearch25Input() {
  const inp = document.getElementById('search25-input');
  const clr = document.getElementById('search25-clear');
  const v = (inp.value || '').trim();
  if (clr) clr.style.display = v ? 'flex' : 'none';
  state.search25Query = v;
  clearTimeout(state.search25Timer);
  state.search25Timer = setTimeout(runSearch25, 250);
}

function clearSearch25() {
  const inp = document.getElementById('search25-input');
  if (inp) { inp.value = ''; inp.focus(); }
  state.search25Query = '';
  const clr = document.getElementById('search25-clear');
  if (clr) clr.style.display = 'none';
  // v2.45.280: при очистке сбрасываем и счётчики в чипах
  _search25UpdateChipCounts(null);
  renderSearch25Empty();
}

function setSearch25Filter(f) {
  state.search25Filter = f;
  document.querySelectorAll('#search25-chips .filter-chip').forEach(c => c.classList.remove('active'));
  const ch = document.querySelector('#search25-chips .filter-chip[data-search-filter="' + f + '"]');
  if (ch) ch.classList.add('active');
  if (state.search25Query) runSearch25();
}

// v2.45.280: обновляет счётчики в чипах фильтров после поиска
function _search25UpdateChipCounts(counts) {
  document.querySelectorAll('#search25-chips .filter-chip').forEach(ch => {
    const old = ch.querySelector('.chip-count');
    if (old) old.remove();
    if (!counts) return;
    const f = ch.getAttribute('data-search-filter');
    let n = 0;
    if (f === 'all') n = (counts.contracts || 0) + (counts.assemblies || 0) + (counts.tasks || 0) + (counts.defects || 0) + (counts.contractors || 0);
    else n = counts[f] || 0;
    if (n > 0) {
      const span = document.createElement('span');
      span.className = 'chip-count';
      span.textContent = n > 99 ? '99+' : String(n);
      ch.appendChild(span);
    }
  });
}

function renderSearch25Empty() {
  const c = document.getElementById('search25-results');
  if (!c) return;
  // v2.45.281: если есть история — компактные чипы + краткий хинт; иначе крупный empty
  const history = _search25LoadHistory();
  if (history.length) {
    let html = '<div class="search25-history">' +
      '<div class="search25-history-head">' +
        '<span><i class="ti ti-history"></i> Недавние</span>' +
        '<button class="search25-history-clear" onclick="_search25ClearHistory()">Очистить</button>' +
      '</div>' +
      '<div class="search25-history-list">';
    history.forEach(q => {
      html += '<button class="search25-history-item" onclick="search25RunFromHistory(' + JSON.stringify(q).replace(/"/g, '&quot;') + ')">' +
        '<i class="ti ti-search"></i>' +
        '<span>' + escapeHtml(q) + '</span>' +
      '</button>';
    });
    html += '</div>' +
      '<div class="search25-history-hint">Тап по чипу — повторить запрос. Или введите новый: <b>номер договора, ФИО, контрагент, слово из задачи</b></div>' +
    '</div>';
    c.innerHTML = html;
    return;
  }
  c.innerHTML = '<div class="search25-empty">' +
    '<i class="ti ti-search big"></i>' +
    '<div class="title">Что ищем?</div>' +
    '<div class="hint">Введите номер договора, ФИО,<br>название контрагента или слово из задачи</div>' +
  '</div>';
}

async function runSearch25() {
  const q = (state.search25Query || '').toLowerCase().trim();
  const c = document.getElementById('search25-results');
  if (!c) return;
  if (!q || q.length < 2) {
    _search25UpdateChipCounts(null);
    renderSearch25Empty();
    return;
  }
  // v2.45.280: скелет вместо «Ищем…»
  c.innerHTML = '<div class="search25-skeleton">' +
    Array.from({ length: 4 }).map(() =>
      '<div class="sk-row"><div class="sk-icon"></div><div class="sk-body"><div class="sk-line w70"></div><div class="sk-line w40"></div></div></div>'
    ).join('') +
  '</div>';

  const filter = state.search25Filter;
  // v2.45.280: параллельные запросы — было последовательно через await в if'ах
  // v2.45.283: + сборки (production works) — ищем по сборщику и соисполнителям
  // v2.45.284: + workload — сводка часов по сотруднику, если имя совпало
  const wantC  = (filter === 'all' || filter === 'contracts');
  const wantA  = (filter === 'all' || filter === 'assemblies');
  const wantT  = (filter === 'all' || filter === 'tasks');
  const wantD  = (filter === 'all' || filter === 'defects');
  const wantCT = (filter === 'all' || filter === 'contractors');
  const [rC, rA, rT, rD, rCT, rWL] = await Promise.all([
    wantC  ? apiGet('/api/contracts').catch(() => null)         : null,
    wantA  ? apiGet('/api/production/works').catch(() => null)  : null,
    wantT  ? apiGet('/api/tasks').catch(() => null)             : null,
    wantD  ? apiGet('/api/defects').catch(() => null)           : null,
    wantCT ? apiGet('/api/contractors').catch(() => null)       : null,
    wantA  ? apiGet('/api/production/workload').catch(() => null) : null,
  ]);

  // Перепроверяем что запрос ещё актуален (пользователь не стёр пока шёл fetch)
  if ((state.search25Query || '').toLowerCase().trim() !== q) return;

  const results = [];
  const counts = { contracts: 0, assemblies: 0, tasks: 0, defects: 0, contractors: 0 };
  // v2.45.284: сводка по сотруднику — заполняется ниже, если запрос совпал с workload
  let workerSummaryHtml = '';

  if (rC && Array.isArray(rC.contracts)) {
    rC.contracts.forEach(x => {
      // v2.45.282: ищем и по менеджеру + соменеджерам
      const coNames = (Array.isArray(x.co_managers) ? x.co_managers : []).map(m => m && m.name).filter(Boolean).join(' ');
      const hay = (
        (x.number || '') + ' ' +
        (x.contractor_name || '') + ' ' +
        (x.comment || '') + ' ' +
        (x.manager_name || '') + ' ' +
        coNames
      ).toLowerCase();
      if (hay.indexOf(q) >= 0) {
        counts.contracts++;
        // Подпись подсказывает почему нашлось — менеджер, соменеджер или просто статус
        let subRole = '';
        if ((x.manager_name || '').toLowerCase().indexOf(q) >= 0) subRole = ' · менеджер ' + x.manager_name;
        else if (coNames.toLowerCase().indexOf(q) >= 0) subRole = ' · соменеджер';
        results.push({
          type: 'contract', cls: 'c-sales', icon: 'ti-file-text',
          title: (x.number || '—') + (x.contractor_name ? ' · ' + x.contractor_name : ''),
          sub: 'Договор · ' + (x.status_label || x.status || '—') + subRole,
          click: () => { switchMainTab('home'); selectSection('sales'); setTimeout(() => openContractDetail(x.id), 50); },
        });
      }
    });
  }
  // v2.45.283: сборки (production works) — ищем по модели, договору, сборщику, соисполнителям
  // v2.45.284: + показываем часы каждой сборки, если есть
  if (rA && Array.isArray(rA.works)) {
    rA.works.forEach(w => {
      const helperNames = (Array.isArray(w.active_helpers) ? w.active_helpers : [])
        .map(h => (h && (h.short_name || h.full_name)) || '')
        .filter(Boolean).join(' ');
      const hay = (
        (w.model_name || w.title || '') + ' ' +
        (w.model_article || '') + ' ' +
        (w.contract_number || '') + ' ' +
        (w.contractor_name || '') + ' ' +
        (w.assignee_short_name || '') + ' ' +
        helperNames
      ).toLowerCase();
      if (hay.indexOf(q) >= 0) {
        counts.assemblies++;
        let subRole = '';
        if ((w.assignee_short_name || '').toLowerCase().indexOf(q) >= 0) subRole = ' · сборщик ' + w.assignee_short_name;
        else if (helperNames.toLowerCase().indexOf(q) >= 0) subRole = ' · соисполнитель';
        // Часы: предпочитаем факт, иначе оценку с тильдой
        let hoursPart = '';
        if (w.actual_hours != null && Number(w.actual_hours) > 0) hoursPart = ' · ' + w.actual_hours + 'ч';
        else if (w.est_hours != null && Number(w.est_hours) > 0)  hoursPart = ' · ~' + w.est_hours + 'ч';
        const title = (w.model_name || w.title || ('Работа #' + w.id)) +
                      (w.contract_number ? ' · ' + w.contract_number : '');
        results.push({
          type: 'assembly', cls: 'c-prod', icon: 'ti-tool',
          title: title,
          sub: 'Сборка · ' + (w.status_label || w.status || '—') + subRole + hoursPart,
          click: () => { switchMainTab('home'); openProductionWorkDetail(w.id); },
        });
      }
    });
  }

  // v2.45.284: сводка по сотруднику из workload — если имя совпало с запросом.
  // Показывает: имя, часы за неделю, кол-во работ (своих и как соисполнитель), статус загрузки.
  if (rWL && Array.isArray(rWL.workers)) {
    const matched = rWL.workers.filter(w => {
      const hay = ((w.short_name || '') + ' ' + (w.full_name || '')).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    if (matched.length) {
      const norm = (rWL.norm_hours) || 40;
      workerSummaryHtml = matched.map(w => {
        const name   = w.short_name || w.full_name || ('Сотрудник #' + w.employee_id);
        const hours  = (w.est_hours != null) ? w.est_hours : (w.total_hours || 0);
        const isEst  = !!w.is_estimated;
        const main   = w.main_count || 0;
        const help   = w.help_count || 0;
        const works  = w.works_count || (main + help);
        const status = w.status || (works === 0 ? 'undersized' : 'normal');
        const statusLabel =
          (status === 'overloaded') ? 'перегруз' :
          (status === 'normal')     ? 'норма'    :
          (works === 0)             ? 'свободен' : 'недогруз';
        const pct = Math.max(0, Math.min(150, Math.round(w.pct || 0)));
        const parts = [];
        if (main) parts.push(main + ' ' + _pluralRu(main, 'сборка', 'сборки', 'сборок'));
        if (help) parts.push(help + ' как соисполнитель');
        if (!parts.length) parts.push('нет активных работ');
        return '<div class="search25-worker-card s-' + status + '">' +
          '<div class="search25-worker-head">' +
            '<div class="search25-worker-name"><i class="ti ti-user"></i>' + escapeHtml(name) + '</div>' +
            '<div class="search25-worker-status">' + escapeHtml(statusLabel) + '</div>' +
          '</div>' +
          '<div class="search25-worker-hours">' +
            '<span class="hours-num">' + (isEst ? '~' : '') + hours + 'ч</span>' +
            '<span class="hours-of">из ' + norm + 'ч/нед · ' + pct + '%</span>' +
          '</div>' +
          '<div class="search25-worker-bar"><div class="search25-worker-bar-fill" style="width:' + Math.min(100, pct) + '%"></div></div>' +
          '<div class="search25-worker-meta">' + escapeHtml(parts.join(' · ')) + '</div>' +
        '</div>';
      }).join('');
    }
  }
  if (rT && Array.isArray(rT.tasks)) {
    rT.tasks.forEach(x => {
      // v2.45.282: ищем и по исполнителю задачи
      const hay = (
        (x.title || '') + ' ' +
        (x.description || '') + ' ' +
        (x.assignee_name || '')
      ).toLowerCase();
      if (hay.indexOf(q) >= 0) {
        counts.tasks++;
        let subRole = '';
        if ((x.assignee_name || '').toLowerCase().indexOf(q) >= 0) subRole = ' · исполнитель ' + x.assignee_name;
        results.push({
          type: 'task', cls: 'c-tasks', icon: 'ti-checklist',
          title: x.title || '—',
          sub: 'Задача · ' + (x.status_label || x.status || '—') + subRole,
          click: () => { switchMainTab('home'); state.currentTaskId = x.id; selectSection('tasks'); setTimeout(() => selectSidebarItem('task-detail'), 50); },
        });
      }
    });
  }
  if (rD && Array.isArray(rD.defects)) {
    rD.defects.forEach(x => {
      const hay = ((x.description || '') + ' ' + (x.author_name || '') + ' ' + (x.contractor_name || '')).toLowerCase();
      if (hay.indexOf(q) >= 0) {
        counts.defects++;
        results.push({
          type: 'defect', cls: 'c-defect', icon: 'ti-alert-triangle',
          title: (x.description || '—').slice(0, 60),
          sub: 'Доработка · ' + (x.status_label || x.status || '—'),
          click: () => { switchMainTab('home'); state.currentDefectId = x.id; selectSection('defects'); setTimeout(() => selectSidebarItem('defect-detail'), 50); },
        });
      }
    });
  }
  if (rCT && Array.isArray(rCT.contractors)) {
    rCT.contractors.forEach(x => {
      const hay = ((x.name || '') + ' ' + (x.inn || '') + ' ' + (x.contact_person || '')).toLowerCase();
      if (hay.indexOf(q) >= 0) {
        counts.contractors++;
        results.push({
          type: 'contractor', cls: 'c-sales', icon: 'ti-briefcase',
          title: x.name || '—',
          sub: 'Контрагент' + (x.inn ? ' · ИНН ' + x.inn : ''),
          click: () => { switchMainTab('home'); state.currentContractorId = x.id; selectSection('sales'); setTimeout(() => selectSidebarItem('sales-contractor-form'), 50); },
        });
      }
    });
  }

  _search25UpdateChipCounts(counts);

  if (!results.length && !workerSummaryHtml) {
    c.innerHTML = '<div class="search25-empty">' +
      '<i class="ti ti-mood-empty big"></i>' +
      '<div class="title">Ничего не нашлось</div>' +
      '<div class="hint">Попробуйте изменить запрос или фильтр</div>' +
    '</div>';
    return;
  }

  // v2.45.280: сохраняем удачный запрос в историю
  _search25SaveHistory(state.search25Query);

  // Сохраняем коллбеки для клика
  window._search25Clicks = results.map(r => r.click);
  // v2.45.284: наверху — сводка по сотруднику, если запрос совпал с workload
  let html = workerSummaryHtml || '';
  results.slice(0, 50).forEach((r, i) => {
    html += '<div class="result25-row" onclick="search25Click(' + i + ')">' +
      '<div class="result25-icon ' + r.cls + '"><i class="ti ' + r.icon + '"></i></div>' +
      '<div class="result25-body">' +
        '<div class="result25-title">' + escapeHtml(r.title) + '</div>' +
        '<div class="result25-sub">' + escapeHtml(r.sub) + '</div>' +
      '</div>' +
      '<i class="ti ti-chevron-right"></i>' +
    '</div>';
  });
  if (results.length > 50) {
    html += '<div style="text-align:center; color: var(--text-light); font-size: 12.5px; padding: 12px;">показано первые 50 из ' + results.length + '</div>';
  }
  c.innerHTML = html;
}

function search25Click(idx) {
  const fn = (window._search25Clicks || [])[idx];
  if (typeof fn === 'function') fn();
}

// ============ УВЕДОМЛЕНИЯ (v2.45.280: полноценный экран) ============
// Используем те же источники, что и панель колокольчика в шапке:
// /api/contract-chats/unread (чаты) + /api/notifications/unread (уведомления).
// Данные кэшируются в state._notifSummary, обновляются через refreshNotifBadge().

async function renderNotifications25() {
  const c = document.getElementById('notif25-list');
  if (!c) return;
  // Если данных ещё нет — показываем скелет и подтягиваем
  if (!state._notifSummary) {
    c.innerHTML = '<div class="search25-skeleton">' +
      Array.from({ length: 3 }).map(() =>
        '<div class="sk-row"><div class="sk-icon"></div><div class="sk-body"><div class="sk-line w70"></div><div class="sk-line w90"></div><div class="sk-line w40"></div></div></div>'
      ).join('') +
    '</div>';
  } else {
    _renderNotifications25(state._notifSummary);
  }
  // Всегда тянем свежее
  try {
    if (typeof refreshNotifBadge === 'function') await refreshNotifBadge();
  } catch (e) {}
  _renderNotifications25(state._notifSummary);
}

function _renderNotifications25(r) {
  const c = document.getElementById('notif25-list');
  if (!c) return;
  const chats  = (r && r.contracts) || [];
  const notifs = (r && r.items) || [];
  const total = chats.length + notifs.length;

  if (!total) {
    c.innerHTML = '<div class="search25-empty">' +
      '<i class="ti ti-check big" style="color: var(--success);"></i>' +
      '<div class="title">Всё прочитано</div>' +
      '<div class="hint">Новые уведомления — о доработках,<br>просроченных задачах и приближающихся отгрузках —<br>появятся здесь автоматически.</div>' +
    '</div>';
    return;
  }

  let html = '';

  // Шапка с кнопкой «Отметить все»
  html += '<div class="notif25-actions">' +
    '<div class="notif25-count">' +
      (notifs.length ? notifs.length + ' уведомлен' + _pluralRu(notifs.length, 'ие', 'ия', 'ий') : '') +
      (notifs.length && chats.length ? ' · ' : '') +
      (chats.length ? chats.length + ' чат' + _pluralRu(chats.length, '', 'а', 'ов') : '') +
    '</div>' +
    (notifs.length ? '<button class="notif25-ack-all" onclick="ackAllFromTab25()"><i class="ti ti-checks"></i> Отметить все</button>' : '') +
  '</div>';

  // Глобальные уведомления (дефекты, договоры, сборки)
  if (notifs.length) {
    html += '<div class="notif25-section-title"><i class="ti ti-bell-ringing"></i> Уведомления</div>';
    notifs.forEach(n => {
      const time = _chatPrettyTime(n.created_at);
      let icon = 'ti-bell';
      if (n.type === 'defect_created')        icon = 'ti-alert-triangle';
      else if (n.type === 'defect_message_added') icon = 'ti-message-circle';
      else if (n.type === 'contract_published')   icon = 'ti-file-text';
      else if (n.type === 'assembly_created')     icon = 'ti-tool';
      else if (n.type === 'contract_shipped')     icon = 'ti-truck-delivery';
      const onClick = n.entity_type === 'defect'
        ? 'onNotif25GlobalClick(' + n.id + ',\'defect\',' + (n.entity_id || 0) + ')'
        : (n.entity_type === 'contract'
            ? 'onNotif25GlobalClick(' + n.id + ',\'contract\',' + (n.entity_id || 0) + ')'
            : 'onNotif25GlobalClick(' + n.id + ',\'\',\'\')');
      html += '<div class="notif25-item notif-global" onclick="' + onClick + '">' +
        '<div class="notif25-item-head">' +
          '<div class="notif25-item-title"><i class="ti ' + icon + '"></i>' + escapeHtml(n.title || '') + '</div>' +
          '<button class="notif25-ack-x" onclick="event.stopPropagation();ackOneNotif25(' + n.id + ')" title="Отметить как прочитанное"><i class="ti ti-x"></i></button>' +
        '</div>' +
        (n.message ? '<div class="notif25-item-last">' + escapeHtml(_truncate(n.message, 140)) + '</div>' : '') +
        '<div class="notif25-item-time">' + escapeHtml(time) + '</div>' +
      '</div>';
    });
  }

  // Непрочитанные чаты по договорам
  if (chats.length) {
    html += '<div class="notif25-section-title"><i class="ti ti-messages"></i> Чаты по договорам</div>';
    chats.forEach(ch => {
      const lastTime = _chatPrettyTime(ch.last_at);
      const lastText = ch.last_text || '';
      const author   = ch.last_author ? (ch.last_author + ': ') : '';
      html += '<div class="notif25-item" onclick="onNotif25ItemClick(' + ch.contract_id + ')">' +
        '<div class="notif25-item-head">' +
          '<div class="notif25-item-title"><i class="ti ti-message-circle"></i>Договор ' + escapeHtml(ch.contract_number || '#' + ch.contract_id) + '</div>' +
          '<span class="notif25-unread-badge">' + (ch.unread > 99 ? '99+' : ch.unread) + '</span>' +
        '</div>' +
        (ch.contractor_name ? '<div class="notif25-item-sub">' + escapeHtml(ch.contractor_name) + '</div>' : '') +
        '<div class="notif25-item-last">' +
          '<span class="notif25-author">' + escapeHtml(author) + '</span>' +
          escapeHtml(_truncate(lastText, 100)) +
        '</div>' +
        '<div class="notif25-item-time">' + escapeHtml(lastTime) + '</div>' +
      '</div>';
    });
  }

  c.innerHTML = html;
}

function _pluralRu(n, one, few, many) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

async function onNotif25GlobalClick(notifId, entityType, entityId) {
  try { await apiPost('/api/notifications/' + notifId + '/ack', {}); } catch (e) {}
  if (typeof refreshNotifBadge === 'function') refreshNotifBadge();
  if (entityType === 'defect' && entityId) {
    if (typeof openDefectDetail === 'function') openDefectDetail(entityId);
    else if (typeof selectSidebarItem === 'function') {
      switchMainTab('home');
      setTimeout(() => selectSidebarItem('defects'), 50);
    }
  } else if (entityType === 'contract' && entityId) {
    if (typeof openContractDetail === 'function') {
      switchMainTab('home');
      setTimeout(() => openContractDetail(entityId), 50);
    }
  }
}

async function ackOneNotif25(notifId) {
  try {
    await apiPost('/api/notifications/' + notifId + '/ack', {});
    if (typeof refreshNotifBadge === 'function') {
      await refreshNotifBadge();
      _renderNotifications25(state._notifSummary);
    }
  } catch (e) {
    if (typeof showToast === 'function') showToast('Не удалось отметить', 'error');
  }
}

function onNotif25ItemClick(contractId) {
  state.currentContractId = contractId;
  switchMainTab('home');
  if (typeof selectSection === 'function') selectSection('sales');
  if (typeof selectSidebarItem === 'function') selectSidebarItem('sales-contract-detail');
  setTimeout(() => {
    if (typeof openContractChat === 'function') openContractChat();
    if (typeof refreshNotifBadge === 'function') refreshNotifBadge();
  }, 200);
}

async function ackAllFromTab25() {
  const btn = document.querySelector('.notif25-ack-all');
  if (btn) btn.disabled = true;
  try {
    const r = await apiPost('/api/notifications/ack-all', {});
    const cnt = (r && r.data && r.data.count) || 0;
    if (state._notifSummary) state._notifSummary.items = [];
    _renderNotifications25(state._notifSummary);
    if (typeof refreshNotifBadge === 'function') refreshNotifBadge();
    if (typeof showToast === 'function') showToast(cnt > 0 ? 'Подтверждено: ' + cnt : 'Нечего очищать', cnt > 0 ? 'success' : 'info');
  } catch (e) {
    if (typeof showToast === 'function') showToast('Не удалось очистить', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ============ НЕДЕЛЬНЫЙ КАЛЕНДАРЬ НА ГЛАВНОЙ ============

function renderWeekCal25() {
  const grid = document.getElementById('week-cal25-grid');
  if (!grid) return;
  const today = new Date();
  // Начало недели — понедельник
  const dow = today.getDay(); // 0=вс
  const monOffset = dow === 0 ? -6 : (1 - dow);
  const monday = new Date(today);
  monday.setDate(today.getDate() + monOffset);

  const dowNames = ['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'];
  const events = (cache.homeWeekEvents && cache.homeWeekEvents.byDate) || {};

  let html = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const isToday = iso === new Date().toISOString().slice(0, 10);
    const isWeekend = i >= 5;
    const dayEvents = events[iso] || [];

    let markers = '';
    if (dayEvents.length) {
      const types = {};
      dayEvents.forEach(e => { types[e.type] = true; });
      const typeOrder = ['prod', 'sales', 'tasks', 'defect'];
      const dots = typeOrder
        .filter(t => types[t])
        .map(t => '<span class="marker-dot m-' + t + '"></span>')
        .join('');
      if (dots) markers = '<div class="markers">' + dots + '</div>';
    }

    const cls = [
      'week-cal25-day',
      isToday ? 'today' : '',
      isWeekend ? 'weekend' : '',
    ].filter(Boolean).join(' ');

    html += '<div class="' + cls + '" onclick="onWeekCalDayClick(\'' + iso + '\')">' +
      '<div class="dow">' + dowNames[i] + '</div>' +
      '<div class="num">' + d.getDate() + '</div>' +
      markers +
    '</div>';
  }

  // Месяц
  const monthEl = document.getElementById('week-cal25-month-label');
  if (monthEl) {
    monthEl.textContent = MONTH_NAMES_RU[today.getMonth()] + ' ' + today.getFullYear();
  }

  grid.innerHTML = html;
}

function onWeekCalDayClick(iso) {
  // Переходим в большой календарь
  selectSidebarItem('home-calendar');
}

async function loadHomeWeekEvents() {
  // Локально собираем события на неделю из уже доступных API:
  // - upcoming-shipments (продажи)
  // - my-tasks (задачи)
  // - dashboard (производство — assemblies today)
  // - defects (новые доработки)
  // Кэшируем результат до перезагрузки
  if (cache.homeWeekEvents) { renderWeekCal25(); return; }
  cache.homeWeekEvents = { byDate: {} };

  // Параллельно подтягиваем
  const promises = [];

  // Отгрузки → events типа 'sales'
  promises.push((async () => {
    try {
      const d = cache.upcomingShipments || await apiGet('/api/home/upcoming-shipments');
      cache.upcomingShipments = d;
      ((d && d.contracts) || []).forEach(c => {
        if (!c.delivery_date) return;
        const iso = c.delivery_date.slice(0, 10);
        if (!cache.homeWeekEvents.byDate[iso]) cache.homeWeekEvents.byDate[iso] = [];
        cache.homeWeekEvents.byDate[iso].push({ type: 'sales' });
      });
    } catch (e) {}
  })());

  // Задачи → events типа 'tasks'
  promises.push((async () => {
    try {
      const d = cache.myTasks || await apiGet('/api/home/my-tasks');
      cache.myTasks = d;
      ((d && d.tasks) || []).forEach(t => {
        if (!t.deadline) return;
        const iso = t.deadline.slice(0, 10);
        if (!cache.homeWeekEvents.byDate[iso]) cache.homeWeekEvents.byDate[iso] = [];
        cache.homeWeekEvents.byDate[iso].push({ type: 'tasks' });
      });
    } catch (e) {}
  })());

  await Promise.all(promises);
  renderWeekCal25();
}

// ============ БЫСТРЫЕ ДЕЙСТВИЯ НА ГЛАВНОЙ ============

function renderQuickActions25() {
  const el = document.getElementById('home25-quick-actions');
  if (!el) return;
  const roles = (state.user && state.user.roles) || [];
  const isDirector = roles.includes('director');
  const canSales = isDirector || roles.includes('manager') || roles.includes('zam');
  const canTasks = isDirector || roles.includes('manager') || roles.includes('zam');
  const canAssembly = isDirector || roles.includes('master') || roles.includes('engineer') || roles.includes('zam');

  let html = '';
  if (canAssembly) {
    html += '<button class="qa25-tile c-prod" onclick="openNewAssembly()">' +
      '<div class="qa-icon"><i class="ti ti-tool"></i></div>' +
      '<div class="qa-text">' +
        '<div class="qa-label">Новая работа</div>' +
        '<div class="qa-hint">сборка / ремонт / монтаж</div>' +
      '</div>' +
    '</button>';
  }
  if (canSales) {
    html += '<button class="qa25-tile c-sales" onclick="openNewContract()">' +
      '<div class="qa-icon"><i class="ti ti-file-text"></i></div>' +
      '<div class="qa-text">' +
        '<div class="qa-label">Новый договор</div>' +
        '<div class="qa-hint">или КП</div>' +
      '</div>' +
    '</button>';
  }
  if (canTasks) {
    html += '<button class="qa25-tile c-tasks" onclick="openNewTask()">' +
      '<div class="qa-icon"><i class="ti ti-checklist"></i></div>' +
      '<div class="qa-text">' +
        '<div class="qa-label">Новая задача</div>' +
        '<div class="qa-hint">поручить сотруднику</div>' +
      '</div>' +
    '</button>';
  }
  // Доработка — для всех ролей
  html += '<button class="qa25-tile c-defect" onclick="openNewDefectFromCRM()">' +
    '<div class="qa-icon"><i class="ti ti-alert-triangle"></i></div>' +
    '<div class="qa-text">' +
      '<div class="qa-label">Доработка</div>' +
      '<div class="qa-hint">замечание с фото</div>' +
    '</div>' +
  '</button>';

  el.innerHTML = html;
}

// ============ КОНЕЦ ЭТАПА 25.0 ============


// ============================================================
// ============ ЭТАП 26.2: ОТГРУЗКА ПО QR =====================
// ============================================================

// Состояние сессии отгрузки
state._shipContractId = null;
state._shipContract = null;
state._shipProgress = { total: 0, shipped: 0 };

// ===== Звуки через Web Audio API =====
let _audioCtx = null;
function _ensureAudioCtx() {
  if (_audioCtx) return _audioCtx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    _audioCtx = new Ctx();
  } catch (e) {}
  return _audioCtx;
}

function playBeep(type) {
  const ctx = _ensureAudioCtx();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    if (type === 'success') {
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.18, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      o.start();
      o.stop(ctx.currentTime + 0.22);
    } else {
      // error — двойной низкий
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(220, ctx.currentTime);
      o.frequency.setValueAtTime(180, ctx.currentTime + 0.12);
      g.gain.setValueAtTime(0.18, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.32);
      o.start();
      o.stop(ctx.currentTime + 0.34);
    }
  } catch (e) {}
}

function vibrate(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch (e) {}
}

function flashScanner(type) {
  const f = document.getElementById('qr-flash');
  if (!f) return;
  f.classList.remove('success', 'error');
  f.classList.add(type === 'success' ? 'success' : 'error');
  f.classList.add('visible');
  setTimeout(() => f.classList.remove('visible'), 350);
}

function showShipLast(type, title, sub) {
  const el = document.getElementById('ship-last');
  if (!el) return;
  const t = document.getElementById('ship-last-title');
  const s = document.getElementById('ship-last-sub');
  if (t) t.textContent = title || '';
  if (s) s.textContent = sub || '';
  el.classList.remove('success', 'error');
  el.classList.add(type === 'success' ? 'success' : 'error');
  el.classList.add('visible');
  clearTimeout(state._shipLastTimer);
  state._shipLastTimer = setTimeout(() => el.classList.remove('visible'), 2200);
}

function updateShipCounter(shipped, total, lastName) {
  state._shipProgress = { shipped: shipped, total: total };
  const sNum = document.getElementById('ship-counter-shipped');
  const tNum = document.getElementById('ship-counter-total');
  const fill = document.getElementById('ship-counter-fill');
  const nm = document.getElementById('ship-counter-name');
  if (sNum) sNum.textContent = String(shipped);
  if (tNum) tNum.textContent = String(total);
  if (fill) {
    const pct = total > 0 ? Math.round(shipped / total * 100) : 0;
    fill.style.width = pct + '%';
  }
  if (nm && lastName) nm.textContent = lastName;
}

// v2.45.407: тап по счётчику «X/Y» в режиме скана открывает список —
// что уже собрано/отгружено и что ещё осталось. Тянем свежий статус, чтобы
// показать актуальную картину сразу после сканов.
function closeShipScanList() {
  const m = document.getElementById('ship-scan-list-modal');
  if (m) m.remove();
}

async function openShipScanList() {
  if (!state._shipContractId) return;
  const isGather = (typeof _shipModeIsGather === 'function') && _shipModeIsGather();
  const doneKey = isGather ? 'gathered' : 'shipped';
  const doneWord = isGather ? 'Собрано' : 'Отгружено';
  const leftWord = isGather ? 'Осталось собрать' : 'Осталось отгрузить';

  let modal = document.getElementById('ship-scan-list-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'ship-scan-list-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.55);' +
      'display:flex;align-items:flex-end;justify-content:center;';
    modal.onclick = (e) => { if (e.target === modal) closeShipScanList(); };
    document.body.appendChild(modal);
  }
  modal.innerHTML = '<div style="background:var(--bg,#fff);width:100%;max-width:560px;max-height:82vh;' +
    'border-radius:18px 18px 0 0;display:flex;flex-direction:column;overflow:hidden;">' +
    '<div style="padding:14px 16px;display:flex;align-items:center;justify-content:center;color:var(--text-light);">' +
    'Загружаем…</div></div>';

  let status;
  try {
    status = await apiGet('/api/contracts/' + state._shipContractId + '/shipment-status');
  } catch (e) {
    const inner = modal.firstChild;
    if (inner) inner.innerHTML = '<div style="padding:18px;text-align:center;color:var(--text-light);">' +
      'Не удалось загрузить список</div>';
    return;
  }

  const items = status.items || [];
  const done = items.filter(it => it[doneKey]);
  const left = items.filter(it => !it[doneKey]);

  const rowHtml = (it, isDone) => {
    const nm = escapeHtml(it.name || ('#' + it.id));
    const qty = it.qty ? (' · ' + it.qty + ' шт') : '';
    const icon = isDone
      ? '<i class="ti ti-circle-check" style="color:#16A34A;font-size:20px;flex-shrink:0;"></i>'
      : '<i class="ti ti-circle" style="color:var(--text-light);font-size:20px;flex-shrink:0;"></i>';
    return '<div style="display:flex;align-items:center;gap:10px;padding:11px 8px;border-bottom:1px solid var(--border);">' +
      icon +
      '<div style="flex:1;min-width:0;font-size:14px;' + (isDone ? 'color:var(--text-light);text-decoration:line-through;' : 'font-weight:600;') + '">' +
      nm + '<span style="color:var(--text-light);font-weight:400;text-decoration:none;">' + qty + '</span></div>' +
      '</div>';
  };

  let body = '';
  body += '<div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">';
  body += '<div style="font-size:16px;font-weight:700;">' + (isGather ? 'Сборка к отгрузке' : 'Отгрузка') +
          ' · ' + done.length + '/' + items.length + '</div>';
  body += '<button onclick="closeShipScanList()" style="width:34px;height:34px;border-radius:50%;border:none;' +
          'background:var(--border);color:var(--text);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">' +
          '<i class="ti ti-x"></i></button>';
  body += '</div>';
  body += '<div style="overflow-y:auto;padding:6px 12px 18px;">';
  // Сначала — что осталось (это и нужно сборщику в работе)
  body += '<div style="font-size:12px;font-weight:700;color:var(--text-light);text-transform:uppercase;padding:10px 4px 4px;">' +
          leftWord + ' · ' + left.length + '</div>';
  if (left.length) { left.forEach(it => body += rowHtml(it, false)); }
  else { body += '<div style="padding:14px 4px;color:#16A34A;font-weight:600;"><i class="ti ti-check"></i> Всё ' +
          (isGather ? 'собрано' : 'отгружено') + '</div>'; }
  body += '<div style="font-size:12px;font-weight:700;color:var(--text-light);text-transform:uppercase;padding:16px 4px 4px;">' +
          doneWord + ' · ' + done.length + '</div>';
  if (done.length) { done.forEach(it => body += rowHtml(it, true)); }
  else { body += '<div style="padding:10px 4px;color:var(--text-light);">Пока ничего</div>'; }
  body += '</div>';

  modal.firstChild.innerHTML = body;
}

// ===== Открытие экрана отгрузки по договору =====

// ============ ЭТАП 30.2: ЭКРАН ВЫБОРА СЦЕНАРИЯ ОТГРУЗКИ ============

function openShipmentEntry() {
  let m = document.getElementById('shipment-entry-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'shipment-entry-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) closeShipmentEntry(); };
    document.body.appendChild(m);
  }
  m.innerHTML = '<div class="modal" onclick="event.stopPropagation()" style="max-width:480px;">' +
    '<div class="modal-header">' +
      '<h3><i class="ti ti-truck-delivery"></i> Произвести отгрузку</h3>' +
      '<button class="modal-close" onclick="closeShipmentEntry()"><i class="ti ti-x"></i></button>' +
    '</div>' +
    '<div style="padding:18px;display:flex;flex-direction:column;gap:10px;">' +
      '<button class="shipment-choice" onclick="shipmentEntryChoose(\'contract\')" style="display:flex;align-items:center;gap:14px;padding:16px;border:2px solid var(--border);border-radius:10px;background:white;cursor:pointer;text-align:left;transition:all .15s;">' +
        '<div style="width:42px;height:42px;border-radius:10px;background:var(--brand-bg);color:var(--brand);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="ti ti-file-text" style="font-size:22px;"></i></div>' +
        '<div style="flex:1;"><div style="font-weight:600;font-size:15px;">По договору</div>' +
        '<div style="font-size:12px;color:var(--text-light);">Сборки или коробки, привязанные к договору</div></div>' +
        '<i class="ti ti-chevron-right" style="color:var(--text-light);"></i>' +
      '</button>' +
      '<button class="shipment-choice" onclick="shipmentEntryChoose(\'external\')" style="display:flex;align-items:center;gap:14px;padding:16px;border:2px solid var(--border);border-radius:10px;background:white;cursor:pointer;text-align:left;transition:all .15s;">' +
        '<div style="width:42px;height:42px;border-radius:10px;background:#FFF3E0;color:#F57C00;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="ti ti-package-export" style="font-size:22px;"></i></div>' +
        '<div style="flex:1;"><div style="font-weight:600;font-size:15px;">По номенклатуре (без договора)</div>' +
        '<div style="font-size:12px;color:var(--text-light);">Отгрузка юрлицу по ИНН или физлицу с комментарием</div></div>' +
        '<i class="ti ti-chevron-right" style="color:var(--text-light);"></i>' +
      '</button>' +
    '</div>' +
    '<style>.shipment-choice:hover{border-color:var(--brand)!important;background:var(--brand-bg)!important;}</style>' +
  '</div>';
  m.classList.add('visible');
}

function closeShipmentEntry() {
  const m = document.getElementById('shipment-entry-modal');
  if (m) m.classList.remove('visible');
}

async function shipmentEntryChoose(kind) {
  closeShipmentEntry();
  if (kind === 'contract') {
    // Откроем список договоров → клик откроет режим отгрузки по договору
    openContractPickerForShipment();
  } else {
    openExternalShipmentForm();
  }
}

async function openContractPickerForShipment() {
  let m = document.getElementById('ship-contract-picker');
  if (!m) {
    m = document.createElement('div');
    m.id = 'ship-contract-picker';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) m.classList.remove('visible'); };
    document.body.appendChild(m);
  }
  m.innerHTML = '<div class="modal" onclick="event.stopPropagation()" style="max-width:520px;max-height:80vh;display:flex;flex-direction:column;">' +
    '<div class="modal-header"><h3><i class="ti ti-file-text"></i> Выбор договора</h3>' +
    '<button class="modal-close" onclick="this.closest(\'.modal-overlay\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button></div>' +
    '<div id="ship-contract-list" style="overflow-y:auto;flex:1;"><div class="loading-block" style="padding:30px;text-align:center;">Загружаем договоры…</div></div>' +
  '</div>';
  m.classList.add('visible');
  try {
    const r = await apiGet('/api/contracts');
    const list = (r.contracts || []).filter(c => c.is_active && c.status !== 'closed');
    const listEl = document.getElementById('ship-contract-list');
    if (!list.length) {
      listEl.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-light);">Нет активных договоров</div>';
      return;
    }
    let html = '';
    list.forEach(c => {
      html += '<div onclick="closeShipContractPicker();openShipmentMode(' + c.id + ')" ' +
              'style="padding:12px 16px;border-bottom:1px solid var(--border);cursor:pointer;" ' +
              'onmouseover="this.style.background=\'var(--brand-bg)\'" onmouseout="this.style.background=\'\'">' +
              '<div style="font-weight:600;">№ ' + escapeHtml(c.number || '') + '</div>' +
              '<div style="font-size:12px;color:var(--text-light);">' + escapeHtml(c.contractor_name || '') + '</div>' +
              '</div>';
    });
    listEl.innerHTML = html;
  } catch (e) {
    document.getElementById('ship-contract-list').innerHTML = '<div style="padding:30px;text-align:center;color:var(--danger);">Не удалось загрузить</div>';
  }
}

function closeShipContractPicker() {
  const m = document.getElementById('ship-contract-picker');
  if (m) m.classList.remove('visible');
}

// ============ ВНЕШНЯЯ ОТГРУЗКА (без договора) ============

function openExternalShipmentForm() {
  state._externalShipItems = [];
  let m = document.getElementById('external-ship-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'external-ship-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) closeExternalShipment(); };
    document.body.appendChild(m);
  }
  m.classList.add('visible');
  renderExternalShipmentForm();
}

function closeExternalShipment() {
  const m = document.getElementById('external-ship-modal');
  if (m) m.classList.remove('visible');
  state._externalShipItems = [];
}

function renderExternalShipmentForm() {
  const m = document.getElementById('external-ship-modal');
  if (!m) return;
  const items = state._externalShipItems || [];

  // Сохраняем введённые значения формы, если перерендериваемся
  const prev = {
    type: (document.getElementById('ext-rec-type-inn') && document.getElementById('ext-rec-type-inn').checked) ? 'inn' :
          (document.getElementById('ext-rec-type-ind') && document.getElementById('ext-rec-type-ind').checked) ? 'individual' : 'inn',
    inn: (document.getElementById('ext-rec-inn') && document.getElementById('ext-rec-inn').value) || '',
    name: (document.getElementById('ext-rec-name') && document.getElementById('ext-rec-name').value) || '',
    comment: (document.getElementById('ext-rec-comment') && document.getElementById('ext-rec-comment').value) || '',
  };

  let itemsHtml = '';
  if (!items.length) {
    itemsHtml = '<div style="padding:18px;text-align:center;color:var(--text-light);font-size:13px;border:1px dashed var(--border);border-radius:8px;">Отсканируй QR или добавь позицию вручную</div>';
  } else {
    itemsHtml = '<div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;">';
    items.forEach((it, i) => {
      itemsHtml += '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;' +
                   (i ? 'border-top:1px solid var(--border);' : '') + '">' +
                   '<i class="ti ' + (it.type === 'box' ? 'ti-package' : 'ti-tool') +
                   '" style="color:var(--brand);"></i>' +
                   '<div style="flex:1;font-size:13px;">' + escapeHtml(it.label) + '</div>' +
                   '<button class="btn btn-secondary btn-small" onclick="removeExternalShipItem(' + i +
                   ')" style="color:var(--danger);" title="Убрать"><i class="ti ti-x"></i></button>' +
                   '</div>';
    });
    itemsHtml += '</div>';
  }

  m.innerHTML = '<div class="modal modal-wide" onclick="event.stopPropagation()" style="max-width:580px;max-height:90vh;display:flex;flex-direction:column;">' +
    '<div class="modal-header">' +
      '<h3><i class="ti ti-package-export"></i> Отгрузка без договора</h3>' +
      '<button class="modal-close" onclick="closeExternalShipment()"><i class="ti ti-x"></i></button>' +
    '</div>' +
    '<div style="padding:18px;overflow-y:auto;flex:1;">' +
      // Получатель
      '<div style="font-size:12px;font-weight:600;color:var(--text-light);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Получатель</div>' +
      '<div style="display:flex;gap:10px;margin-bottom:12px;">' +
        '<label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 12px;border:2px solid ' + (prev.type === 'inn' ? 'var(--brand)' : 'var(--border)') + ';border-radius:8px;cursor:pointer;">' +
          '<input type="radio" name="rec-type" id="ext-rec-type-inn" value="inn" ' + (prev.type === 'inn' ? 'checked' : '') + ' onchange="renderExternalShipmentForm()" />' +
          '<span style="font-size:14px;font-weight:600;">Юрлицо (ИНН)</span>' +
        '</label>' +
        '<label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 12px;border:2px solid ' + (prev.type === 'individual' ? 'var(--brand)' : 'var(--border)') + ';border-radius:8px;cursor:pointer;">' +
          '<input type="radio" name="rec-type" id="ext-rec-type-ind" value="individual" ' + (prev.type === 'individual' ? 'checked' : '') + ' onchange="renderExternalShipmentForm()" />' +
          '<span style="font-size:14px;font-weight:600;">Физлицо</span>' +
        '</label>' +
      '</div>' +
      (prev.type === 'inn' ?
        '<input type="text" id="ext-rec-inn" placeholder="ИНН (10 или 12 цифр)" value="' + escapeHtml(prev.inn) +
        '" inputmode="numeric" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:8px;" />'
        : ''
      ) +
      '<input type="text" id="ext-rec-name" placeholder="' + (prev.type === 'inn' ? 'Название организации' : 'ФИО получателя') +
      '" value="' + escapeHtml(prev.name) + '" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:12px;" />' +
      '<textarea id="ext-rec-comment" placeholder="Комментарий (куда и зачем, обязательно)" rows="2" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:inherit;resize:vertical;margin-bottom:16px;">' + escapeHtml(prev.comment) + '</textarea>' +
      // Позиции
      '<div style="font-size:12px;font-weight:600;color:var(--text-light);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Позиции (' + items.length + ')</div>' +
      itemsHtml +
      '<div style="display:flex;gap:8px;margin-top:10px;">' +
        '<button class="btn btn-secondary btn-small" onclick="addExternalShipItemByQr()" style="flex:1;">' +
          '<i class="ti ti-scan"></i> Сканировать QR</button>' +
        '<button class="btn btn-secondary btn-small" onclick="addExternalShipItemByToken()" style="flex:1;">' +
          '<i class="ti ti-keyboard"></i> Ввести токен</button>' +
      '</div>' +
    '</div>' +
    '<div style="padding:14px 18px;border-top:1px solid var(--border);background:var(--bg);">' +
      '<button class="btn btn-primary" onclick="submitExternalShipment()" style="width:100%;">' +
        '<i class="ti ti-check"></i> Отгрузить (' + items.length + ' поз.)</button>' +
    '</div>' +
  '</div>';
}

function removeExternalShipItem(idx) {
  state._externalShipItems.splice(idx, 1);
  renderExternalShipmentForm();
}

function addExternalShipItemByToken() {
  const token = prompt('Введи QR-токен или полную ссылку:');
  if (!token) return;
  _addExternalShipItemFromToken(token.trim());
}

function addExternalShipItemByQr() {
  // Сохраним состояние формы перед запуском сканера
  state._externalShipFormData = {
    type: document.getElementById('ext-rec-type-inn').checked ? 'inn' : 'individual',
    inn: (document.getElementById('ext-rec-inn') || {}).value || '',
    name: document.getElementById('ext-rec-name').value || '',
    comment: document.getElementById('ext-rec-comment').value || '',
  };
  state._externalShipCallback = true;
  closeExternalShipment();
  openQrScanner();
}

async function _addExternalShipItemFromToken(rawText) {
  // Парсим URL или принимаем токен как есть
  let token = rawText;
  try {
    const u = new URL(rawText);
    const mm = u.pathname.match(/\/[abc]\/([A-Za-z0-9_\-]+)/);
    if (mm) token = mm[1];
  } catch (e) { /* не URL */ }

  try {
    const r = await fetch(API_BASE + '/api/qr/lookup/' + encodeURIComponent(token), {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    if (!r.ok) { showToast('QR не распознан', 'error'); return; }
    const info = await r.json();
    if (info.type === 'contract') {
      showToast('Это QR договора, выбери сборку или коробку', 'error');
      return;
    }
    if (info.is_shipped) {
      showToast('Эта позиция уже отгружена', 'error');
      return;
    }
    if (!state._externalShipItems) state._externalShipItems = [];
    // Не добавлять дубль
    const dup = state._externalShipItems.find(x => x.type === info.type && x.id === info.id);
    if (dup) { showToast('Уже добавлено', 'info'); return; }
    state._externalShipItems.push({
      type: info.type,
      id: info.id,
      label: (info.type === 'box' ? '📦 ' : '🔧 ') + (info.name || ('#' + info.id)) +
             (info.contract_number ? ' · договор № ' + String(info.contract_number).replace(/^\s*№\s*/, '') : ''),
    });
    showToast('Добавлено', 'success');
    // Если форма закрыта (запускали сканер) — открыть снова
    if (state._externalShipCallback) {
      state._externalShipCallback = false;
      openExternalShipmentForm();
      // Восстановим введённые данные
      setTimeout(() => {
        const saved = state._externalShipFormData;
        if (saved) {
          if (saved.type === 'individual') {
            const r = document.getElementById('ext-rec-type-ind');
            if (r) { r.checked = true; renderExternalShipmentForm(); }
          }
          setTimeout(() => {
            if (document.getElementById('ext-rec-inn')) document.getElementById('ext-rec-inn').value = saved.inn || '';
            if (document.getElementById('ext-rec-name')) document.getElementById('ext-rec-name').value = saved.name || '';
            if (document.getElementById('ext-rec-comment')) document.getElementById('ext-rec-comment').value = saved.comment || '';
          }, 50);
        }
      }, 100);
    } else {
      renderExternalShipmentForm();
    }
  } catch (e) {
    showToast('Ошибка связи', 'error');
  }
}

async function submitExternalShipment() {
  const isInn = document.getElementById('ext-rec-type-inn').checked;
  const rec_type = isInn ? 'inn' : 'individual';
  const rec_inn = isInn ? (document.getElementById('ext-rec-inn').value || '').trim() : '';
  const rec_name = (document.getElementById('ext-rec-name').value || '').trim();
  const rec_comment = (document.getElementById('ext-rec-comment').value || '').trim();
  const items = state._externalShipItems || [];

  if (!rec_name) { showToast('Укажи получателя', 'error'); return; }
  if (isInn && (!/^\d{10}$|^\d{12}$/.test(rec_inn))) {
    showToast('ИНН должен содержать 10 или 12 цифр', 'error'); return;
  }
  if (!rec_comment) { showToast('Комментарий обязателен', 'error'); return; }
  if (!items.length) { showToast('Добавь хотя бы одну позицию', 'error'); return; }

  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/shipments/external', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        recipient_type: rec_type,
        recipient_name: rec_name,
        recipient_inn: rec_inn,
        recipient_comment: rec_comment,
        items: items.map(x => ({ type: x.type, id: x.id })),
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok && r.status !== 207) {
      showToast(d.message || 'Не удалось отгрузить', 'error');
      return;
    }
    if (d.errors && d.errors.length) {
      alert('Отгружено ' + (d.created || 0) + ' из ' + items.length + '\n\nОшибки:\n' + d.errors.join('\n'));
    } else {
      showToast('Отгружено: ' + (d.created || 0) + ' поз.', 'success');
    }
    closeExternalShipment();
    if (state.currentScreen === 'warehouse-dashboard' && state.activeWarehouseTab === 'stock') loadFinishedProductsDashboard();
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// v2.45.405: режим экрана — 'ship' (отгрузка, списывает склад) | 'gather'
// (сборка к отгрузке, только комплектация по QR, без списания).
function _shipModeIsGather() { return state._shipMode === 'gather'; }
function _shipItemDone(it) { return _shipModeIsGather() ? !!(it && it.gathered) : !!(it && it.shipped); }

async function openShipmentMode(contractId, mode) {
  if (!contractId) return;
  state._shipContractId = contractId;
  state._shipMode = (mode === 'gather') ? 'gather' : 'ship';

  // Загружаем статус отгрузки
  let status;
  try {
    status = await apiGet('/api/contracts/' + contractId + '/shipment-status');
  } catch (e) {
    alert('Не удалось загрузить статус отгрузки: ' + e);
    return;
  }

  // Загружаем договор для заголовка
  try {
    state._shipContract = await apiGet('/api/contracts/' + contractId);
  } catch (e) {
    state._shipContract = null;
  }

  renderShipmentScreen(status);
}

function renderShipmentScreen(status) {
  // Используем общий screen механизм через временный overlay
  // Делаем модальное окно поверх контента
  let overlay = document.getElementById('shipment-screen-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'shipment-screen-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:150;background:var(--bg);overflow-y:auto;';
    document.body.appendChild(overlay);
  }

  const c = state._shipContract || {};
  // v2.43.12: чистим ведущий № чтобы не было «№№06ТД/04.26»
  const cleanCNumber = (c.number || '').replace(/^№\s*/, '');
  const contractTitle = cleanCNumber ? ('№ ' + cleanCNumber) : ('Договор #' + state._shipContractId);
  const contractor = c.contractor_name || '';
  // v2.45.405: в режиме сборки счётчик и done-флаг считаем по «собрано», не «отгружено»
  const isGather = _shipModeIsGather();
  const total = status.total || 0;
  const shipped = isGather ? (status.gathered || 0) : (status.shipped || 0);
  const pct = total > 0 ? Math.round(shipped / total * 100) : 0;
  const isComplete = isGather ? !!status.gather_complete : !!status.is_complete;
  const screenTitle = isGather ? 'Сборка к отгрузке ' : 'Отгрузка ';
  const progLabel = isGather ? 'Собрано' : 'Отгружено';
  const doneAllLabel = isGather ? 'Всё собрано' : 'Всё отгружено';

  // v2.43.10: запоминаем последний статус в state, чтобы модалка тапа могла к нему обращаться
  state._shipLastStatus = status;

  let html = '';
  // Шапка
  html += '<div style="position:sticky;top:0;z-index:5;background:var(--brand);color:white;padding:14px 16px;display:flex;align-items:center;gap:12px;">';
  html += '<button onclick="closeShipmentScreen()" style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.18);border:none;color:white;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;"><i class="ti ti-arrow-left" style="font-size:20px;"></i></button>';
  html += '<div style="flex:1;min-width:0;">';
  html += '<div style="font-size:15px;font-weight:700;">' + screenTitle + escapeHtml(contractTitle) + '</div>';
  if (contractor) html += '<div style="font-size:12px;opacity:0.9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(contractor) + '</div>';
  html += '</div>';
  html += '<button onclick="reloadShipmentStatus()" style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.18);border:none;color:white;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;" title="Обновить"><i class="ti ti-refresh" style="font-size:18px;"></i></button>';
  html += '</div>';

  html += '<div class="ship-screen-wrap">';

  // v2.43.10 (B): инфо о доставке — адрес + срок (если есть в договоре)
  const deliveryAddr = c.delivery_address || '';
  const deliveryDate = c.delivery_date || '';
  if (deliveryAddr || deliveryDate) {
    html += '<div class="ship-delivery-info">';
    if (deliveryAddr) {
      html += '<div class="ship-delivery-row"><i class="ti ti-map-pin"></i><span>' + escapeHtml(deliveryAddr) + '</span></div>';
    }
    if (deliveryDate) {
      html += '<div class="ship-delivery-row"><i class="ti ti-calendar"></i><span>' + escapeHtml(_fmtDateRu(deliveryDate)) + '</span></div>';
    }
    html += '</div>';
  }

  // Прогресс
  html += '<div class="ship-progress-card">';
  html += '<div class="ship-progress-head">';
  html += '<div class="ship-progress-title">' + progLabel + '</div>';
  html += '<div class="ship-progress-num">' + shipped + ' <span class="total">/ ' + total + '</span></div>';
  html += '</div>';
  html += '<div class="ship-progress-bar"><div class="ship-progress-fill ' + (isComplete ? 'complete' : '') + '" style="width:' + pct + '%"></div></div>';
  if (total === 0) {
    html += '<div style="font-size:13px;color:var(--text-light);text-align:center;padding:8px 0;">К договору не привязано ни одной сборки или коробки</div>';
  } else if (isComplete) {
    html += '<button class="ship-start-btn complete" onclick="onShipmentAllDone()"><i class="ti ti-check-circle"></i> ' + doneAllLabel + '</button>';
  } else {
    html += '<button class="ship-start-btn" onclick="startShipmentScan()"><i class="ti ti-scan"></i> Сканировать QR</button>';
  }
  // v2.45.416: подсказка про ручную отметку в режиме сборки (на случай дубля/слетевшей метки)
  if (isGather && total > 0 && !isComplete) {
    html += '<div style="font-size:12px;color:var(--text-light);text-align:center;margin-top:8px;">' +
      'Не сканируется? Тапните по строке в списке, чтобы отметить «собрано» вручную</div>';
  }
  html += '</div>';

  // Список позиций (с группировкой одинаковых сборок)
  if (total > 0) {
    const items = status.items || [];
    const doneItems = items.filter(x => _shipItemDone(x));
    const pendingItems = items.filter(x => !_shipItemDone(x));
    const pendingTitle = isGather ? 'Ожидают сборки' : 'Ожидают отгрузки';
    const doneTitle = isGather ? 'Собрано' : 'Отгружено';

    if (pendingItems.length) {
      html += '<div class="ship-items-title">' + pendingTitle + ' (' + pendingItems.length + ')</div>';
      // v2.43.10 (C): группируем одинаковые сборки по имени
      html += _renderShipItemsGrouped(pendingItems);
    }
    if (doneItems.length) {
      html += '<div class="ship-items-title">' + doneTitle + ' (' + doneItems.length + ')</div>';
      // У готовых не группируем — нужно видеть время каждой
      doneItems.forEach(it => { html += renderShipItem(it); });
    }
  }

  // v2.43.10 (E): аккордеон «История отгрузки» — только в режиме отгрузки
  if (!isGather) {
    html += '<div class="ship-log-section">' +
      '<button class="ship-log-toggle" onclick="toggleShipmentLog()" id="ship-log-toggle-btn">' +
        '<i class="ti ti-history"></i><span>История отгрузки</span>' +
        '<i class="ti ti-chevron-down ship-log-chevron"></i>' +
      '</button>' +
      '<div class="ship-log-content" id="ship-log-content" style="display:none;"></div>' +
    '</div>';
  }

  html += '</div>';

  overlay.innerHTML = html;
  overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';
}

// v2.43.10 (C): группировка ожидающих позиций по имени модели
function _renderShipItemsGrouped(items) {
  if (!items || !items.length) return '';
  // Группируем по name + type, чтобы 2× «Наружный блок №12» свернулись
  const groups = {};
  items.forEach(it => {
    const key = it.type + '::' + (it.name || '');
    if (!groups[key]) groups[key] = { key: key, type: it.type, name: it.name, items: [] };
    groups[key].items.push(it);
  });
  let html = '';
  Object.values(groups).forEach(g => {
    if (g.items.length === 1) {
      // Одиночная позиция — рендерим как раньше
      html += renderShipItem(g.items[0]);
    } else {
      // Группа из 2+ — заголовок-сводка + раскрытие
      const groupId = 'shipgrp-' + Math.random().toString(36).slice(2, 8);
      const iconCls = g.type === 'box' ? 'ti-package' : 'ti-tool';
      const typeLabel = g.type === 'box' ? 'Коробки' : 'Сборки';
      // v2.45.334: цветная плитка по типу + спейсер, чтобы шапка группы вставала
      // по той же сетке, что и обычные ряды (у которых слева кружок-галочка).
      const typeMod = g.type === 'box' ? ' t-box' : (g.type === 'contract_item' ? ' t-buy' : ' t-asm');
      html += '<div class="ship-group" data-grp-id="' + groupId + '">' +
        '<div class="ship-group-head" onclick="_toggleShipGroup(\'' + groupId + '\')">' +
          '<div class="ship-group-spacer"></div>' +
          '<div class="ship-item-type-icon' + typeMod + '"><i class="ti ' + iconCls + '"></i></div>' +
          '<div class="ship-item-body">' +
            '<div class="ship-item-name">' + escapeHtml(g.name || '—') + '</div>' +
            '<div class="ship-item-sub">' + typeLabel + ' · ' + g.items.length + ' шт.</div>' +
          '</div>' +
          '<i class="ti ti-chevron-down ship-group-chevron"></i>' +
        '</div>' +
        '<div class="ship-group-items" id="' + groupId + '" style="display:none;">';
      g.items.forEach(it => { html += renderShipItem(it); });
      html += '</div></div>';
    }
  });
  return html;
}

function _toggleShipGroup(groupId) {
  const el = document.getElementById(groupId);
  if (!el) return;
  const grp = el.closest('.ship-group');
  if (el.style.display === 'none') {
    el.style.display = '';
    if (grp) grp.classList.add('open');
  } else {
    el.style.display = 'none';
    if (grp) grp.classList.remove('open');
  }
}

function renderShipItem(it) {
  const iconCls = it.type === 'box' ? 'ti-package' : (it.type === 'contract_item' ? 'ti-shopping-cart' : 'ti-tool');
  const typeLabel = it.type === 'box' ? 'Коробка' : (it.type === 'contract_item' ? 'Покупное (отдельно)' : 'Сборка');
  let sub = typeLabel;
  // v2.45.139: у короба показываем сколько сборок внутри (скан короба отгрузит их все)
  // v2.45.330: + покупные позиции, чтобы вместо «0 сборок» было «N покупных позиций»
  if (it.type === 'box') {
    const asmN = Number(it.asm_count || 0);
    const purN = Number(it.purchased_count || 0);
    const parts = [];
    if (asmN > 0) parts.push(asmN + ' ' + _plural(asmN, ['сборка', 'сборки', 'сборок']));
    if (purN > 0) parts.push(purN + ' ' + _plural(purN, ['покупная позиция', 'покупные позиции', 'покупных позиций']));
    sub += ' · ' + (parts.length ? parts.join(' + ') : '0 сборок');
  }
  const _isGather = _shipModeIsGather();
  const _done = _shipItemDone(it);
  if (!_isGather && it.shipped && it.shipped_at) {
    sub += ' · отгружено ' + (String(it.shipped_at).slice(0, 16).replace('T', ' '));
  } else if (_isGather && _done) {
    sub += ' · собрано';
  }
  // v2.43.10 (A): тап по карточке открывает модалку с деталями (режим отгрузки).
  // v2.45.416: в режиме сборки тап по строке отмечает/снимает «собрано» вручную —
  // запасной путь, когда метку не отсканировать (дубликат токена, слетела наклейка).
  const clickAttr = _isGather
    ? ' onclick="toggleGatherItem(\'' + it.type + '\',' + it.id + ',' + (_done ? 1 : 0) + ')"'
    : ' onclick="openShipmentItemDetail(\'' + it.type + '\',' + it.id + ')"';
  return '<div class="ship-item ' + (_done ? 'shipped' : '') + '"' + clickAttr + ' style="cursor:pointer;">' +
    '<div class="ship-item-check"></div>' +
    '<div class="ship-item-type-icon' + (it.type === 'box' ? ' t-box' : (it.type === 'contract_item' ? ' t-buy' : ' t-asm')) + '"><i class="ti ' + iconCls + '"></i></div>' +
    '<div class="ship-item-body">' +
      '<div class="ship-item-name">' + escapeHtml(it.name || '—') + '</div>' +
      '<div class="ship-item-sub">' + escapeHtml(sub) + '</div>' +
    '</div>' +
    (it.type !== 'box' && it.qty && it.qty > 1 ? '<div class="ship-item-qty">' + it.qty + ' шт.</div>' : '') +
  '</div>';
}

async function reloadShipmentStatus() {
  if (!state._shipContractId) return;
  try {
    const status = await apiGet('/api/contracts/' + state._shipContractId + '/shipment-status');
    renderShipmentScreen(status);
  } catch (e) {}
}

// v2.45.416: ручная отметка «собрано» тапом по строке в режиме сборки. Нужна, когда
// единицу не отсканировать (дубликат QR-токена у одинаковых единиц, слетевшая
// наклейка). Склад не затрагивается, действие обратимо повторным тапом.
async function toggleGatherItem(type, id, done) {
  const cid = state._shipContractId;
  if (!cid || !id) return;
  const unmark = !!done;
  if (unmark && !confirm('Снять отметку «собрано» с этой единицы?')) return;
  try {
    const resp = await apiPost('/api/gatherings/mark', {
      contract_id: cid, type: type, id: id, unmark: unmark,
    });
    const d = (resp && resp.data) || {};
    if (resp.ok && d.ok) {
      showToast(unmark ? 'Отметка снята' : 'Отмечено собранным', 'success');
      reloadShipmentStatus();
    } else {
      showToast((d && (d.error)) || 'Не удалось отметить', 'error');
    }
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

function closeShipmentScreen() {
  const ov = document.getElementById('shipment-screen-overlay');
  if (ov) ov.style.display = 'none';
  document.body.style.overflow = '';
  state._shipContractId = null;
  state._shipContract = null;
}

// ============ v2.43.10 (Этап 35): расширения экрана отгрузки ============

// (A) Модалка деталей сборки/коробки по тапу
async function openShipmentItemDetail(itemType, itemId) {
  if (!itemType || !itemId) return;
  let card;
  try {
    card = await apiGet('/api/shipment-card?type=' + encodeURIComponent(itemType) + '&id=' + itemId);
  } catch (e) {
    showToast('Не удалось загрузить карточку: ' + (e.message || e), 'error');
    return;
  }
  if (!card) return;
  _renderShipmentItemModal(card);
}

function _renderShipmentItemModal(card) {
  let m = document.getElementById('ship-detail-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'ship-detail-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) m.classList.remove('visible'); };
    document.body.appendChild(m);
  }
  const isBox = card.type === 'box';
  const isCItem = card.type === 'contract_item';  // v2.45.325: покупное отдельной позицией
  const isShipped = !!card.shipped;
  const typeLabel = isBox ? 'Коробка' : (isCItem ? 'Покупное (отдельно)' : 'Сборка');
  const heroIcon = isBox ? 'ti-package' : (isCItem ? 'ti-shopping-cart' : 'ti-tool');

  // v2.43.12: чистим ведущий № в номере договора (он часто уже есть в данных)
  const cleanContractNum = (card.contract_number || '').replace(/^№\s*/, '');

  // Строки информации
  const infoRows = [];
  if (!isBox && card.assembly_date) {
    infoRows.push({ label: 'Собрано', value: _fmtDateRu(card.assembly_date), icon: 'ti-calendar' });
  }
  if (!isBox && card.workers && card.workers.length) {
    infoRows.push({
      label: card.workers.length > 1 ? 'Исполнители' : 'Исполнитель',
      value: card.workers.map(w => w.name).join(', '),
      icon: 'ti-user',
    });
  }
  if (!isBox && card.quantity && card.quantity > 1) {
    infoRows.push({ label: 'Количество', value: card.quantity + ' шт.', icon: 'ti-stack-2' });
  }
  if (!isBox) {
    // v2.45.102: правильное исполнение для всех сценариев модели
    //  - exec_mode='fixed' → всегда exec_fixed (например, «Стандарт» у ЩУ)
    //  - exec_mode='choice' + execution=stainless/ne → exec_label_ne || «Нерж. AISI»
    //  - exec_mode='choice' + execution=standard/st → exec_label_st || «Стандарт»
    let execLabel = '';
    if (card.exec_mode === 'fixed' && card.exec_fixed) {
      execLabel = card.exec_fixed;
    } else {
      const ex = (card.execution || '').toLowerCase();
      if (ex === 'stainless' || ex === 'ne' || ex === 'нерж' || ex === 'aisi') {
        execLabel = card.exec_label_ne || 'Нерж. AISI';
      } else if (ex === 'standard' || ex === 'st' || ex === 'стандарт') {
        execLabel = card.exec_label_st || 'Стандарт';
      } else if (card.execution) {
        execLabel = String(card.execution);
      }
    }
    if (execLabel) {
      infoRows.push({ label: 'Исполнение', value: execLabel, icon: 'ti-settings' });
    }
  }
  if (!isBox && card.ip_class) {
    infoRows.push({ label: 'IP-класс', value: card.ip_class, icon: 'ti-shield' });
  }
  if (cleanContractNum) {
    infoRows.push({ label: 'Договор', value: '№ ' + cleanContractNum, icon: 'ti-file-text' });
  }
  if (card.contractor_name) {
    infoRows.push({ label: 'Контрагент', value: card.contractor_name, icon: 'ti-building' });
  }
  if (isBox && card.description) {
    infoRows.push({ label: 'Описание', value: card.description, icon: 'ti-note' });
  }
  if (!isBox && card.comment) {
    infoRows.push({ label: 'Комментарий', value: card.comment, icon: 'ti-note' });
  }

  let infoHtml = '';
  infoRows.forEach(r => {
    infoHtml += '<div class="shipd-info-row">' +
      '<div class="shipd-info-icon"><i class="ti ' + r.icon + '"></i></div>' +
      '<div class="shipd-info-body">' +
        '<div class="shipd-info-label">' + escapeHtml(r.label) + '</div>' +
        '<div class="shipd-info-value">' + escapeHtml(String(r.value || '—')) + '</div>' +
      '</div>' +
    '</div>';
  });

  // Бейдж статуса
  let badgeHtml;
  if (isShipped) {
    const when = card.shipped_at ? String(card.shipped_at).slice(0, 16).replace('T', ' ') : '';
    const by = card.shipped_by_name || '';
    badgeHtml =
      '<div class="shipd-status shipped">' +
        '<div class="shipd-status-icon"><i class="ti ti-circle-check"></i></div>' +
        '<div class="shipd-status-text">' +
          '<div class="shipd-status-title">Отгружено</div>' +
          (when || by
            ? '<div class="shipd-status-sub">' + escapeHtml(when) + (by ? ' · ' + escapeHtml(by) : '') + '</div>'
            : '') +
        '</div>' +
      '</div>';
  } else {
    badgeHtml =
      '<div class="shipd-status pending">' +
        '<div class="shipd-status-icon"><i class="ti ti-circle-dashed"></i></div>' +
        '<div class="shipd-status-text">' +
          '<div class="shipd-status-title">Ожидает отгрузки</div>' +
          '<div class="shipd-status-sub">Нажмите кнопку ниже после физической отгрузки</div>' +
        '</div>' +
      '</div>';
  }

  // Кнопки действий
  const actions = [];
  if (!isShipped) {
    actions.push({
      cls: 'btn btn-primary shipd-action-primary',
      onclick: "markShipmentManual('" + card.type + "'," + card.id + ")",
      icon: 'ti-check',
      label: 'Отметить отгруженным',
    });
  } else {
    actions.push({
      cls: 'btn btn-secondary',
      onclick: 'undoShipmentFromModal(' + (card.shipment_id || 0) + ')',
      icon: 'ti-arrow-back-up',
      label: 'Отменить отгрузку',
      danger: true,
    });
  }
  if (card.public_token) {
    const cardJson = JSON.stringify(card).replace(/"/g, '&quot;');
    actions.push({
      cls: 'btn btn-secondary',
      onclick: '_reprintQrFromShipCard(' + cardJson + ')',
      icon: 'ti-qrcode',
      label: 'QR-код',
    });
  }
  if (!isBox && card.model_id) {
    actions.push({
      cls: 'btn btn-secondary',
      onclick: "document.getElementById('ship-detail-modal').classList.remove('visible'); openModelDetail(" + card.model_id + ")",
      icon: 'ti-package',
      label: 'Карточка модели',
    });
  }
  if (!isBox && typeof openEditAssembly === 'function') {
    actions.push({
      cls: 'btn btn-secondary',
      onclick: "document.getElementById('ship-detail-modal').classList.remove('visible'); openEditAssembly(" + card.id + ")",
      icon: 'ti-edit',
      label: 'Редактировать',
    });
  }
  if (!isBox && !isShipped && typeof openAddAssemblyToBox === 'function') {
    actions.push({
      cls: 'btn btn-secondary',
      onclick: "document.getElementById('ship-detail-modal').classList.remove('visible'); openAddAssemblyToBox(" + card.id + ")",
      icon: 'ti-package',
      label: 'Упаковать в коробку',
    });
  }

  let actionsHtml = '<div class="shipd-actions">';
  actions.forEach(a => {
    actionsHtml +=
      '<button class="' + a.cls + (a.danger ? ' shipd-danger' : '') + '" onclick="' + a.onclick + '">' +
        '<i class="ti ' + a.icon + '"></i><span>' + escapeHtml(a.label) + '</span>' +
      '</button>';
  });
  actionsHtml += '</div>';

  m.innerHTML =
    '<div class="modal" style="max-width:520px;" onclick="event.stopPropagation()">' +
      // Кастомный хедер: цветная плашка с иконкой
      '<div class="shipd-hero ' + (isShipped ? 'shipped' : 'pending') + '">' +
        '<div class="shipd-hero-icon"><i class="ti ' + heroIcon + '"></i></div>' +
        '<div class="shipd-hero-text">' +
          '<div class="shipd-hero-type">' + typeLabel + '</div>' +
          '<div class="shipd-hero-name">' + escapeHtml(card.display_name || 'Без названия') + '</div>' +
        '</div>' +
        '<button class="modal-close shipd-close" onclick="document.getElementById(\'ship-detail-modal\').classList.remove(\'visible\')" title="Закрыть"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content">' +
        badgeHtml +
        (infoHtml ? '<div class="shipd-info">' + infoHtml + '</div>' : '') +
        actionsHtml +
      '</div>' +
    '</div>';
  m.classList.add('visible');
}

function _shipInfoRow(label, value) {
  return '<div class="ship-detail-info-row">' +
    '<div class="ship-detail-info-label">' + escapeHtml(label) + '</div>' +
    '<div class="ship-detail-info-value">' + escapeHtml(String(value || '—')) + '</div>' +
  '</div>';
}

function _reprintQrFromShipCard(card) {
  if (!card || !card.public_token) return;
  document.getElementById('ship-detail-modal').classList.remove('visible');
  const baseUrl = window.location.origin;
  const url = baseUrl + (card.type === 'box' ? '/b/' : '/a/') + card.public_token;
  if (typeof openQrModal === 'function') {
    openQrModal({
      title: 'QR-код · ' + (card.display_name || ''),
      subtitle: card.contract_number ? 'Договор № ' + card.contract_number : '',
      url: url,
      type: card.type,
      data: card,
    });
  }
}

// Перепечатать QR: выдать позиции новый уникальный код и отправить на печать
async function reprintUnitQr(type, id, name) {
  if (!confirm('Сгенерировать НОВЫЙ QR для «' + (name || '') + '» и отправить на печать?\nСтарый код перестанет к ней относиться.')) return;
  try {
    const r = await apiPost('/api/shipments/regenerate-qr', { type: type, id: id });
    const d = (r && r.data) || {};
    if (!r.ok || !d.ok || !d.path) {
      showToast('Не удалось обновить код', 'error');
      return;
    }
    const url = window.location.origin + d.path;
    const caption = String(name || '').slice(0, 80);
    const pr = await apiPost('/api/labels/print', { qr_url: url, caption: caption, copies: 1 });
    if (pr && pr.ok) {
      showToast('📤 Новый QR отправлен на печать', 'success');
    } else {
      showToast('Код обновлён, но печать не ушла (проверь шлюз печати)', 'info');
    }
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

// Отметка вручную
async function markShipmentManual(itemType, itemId) {
  if (!confirm('Отметить как отгруженное вручную (без сканирования QR)?')) return;
  let r;
  try {
    r = await apiPost('/api/shipments/manual', { type: itemType, id: itemId });
  } catch (e) {
    showToast('Не удалось отметить: ' + (e.message || e), 'error');
    return;
  }
  // v2.45.421: apiPost возвращает {ok: HTTP-статус, data: тело}. Раньше тут
  // проверялся r.ok (HTTP), из-за чего на «уже отгружено» (HTTP 200, body.ok=false)
  // показывалось ложное «отмечено», а вставки не было. Читаем тело (r.data).
  const d = (r && r.data) || {};
  const m = document.getElementById('ship-detail-modal');
  if (d.ok) {
    showToast('✓ Отгрузка отмечена', 'success');
    _handleShipmentStatusChange(d);
    if (m) m.classList.remove('visible');
    reloadShipmentStatus();
  } else if (d.reason === 'already_shipped') {
    // По этому id уже есть отгрузка — обновим экран, чтобы показать реальную картину
    showToast('Эта единица уже отгружена', 'info');
    if (m) m.classList.remove('visible');
    reloadShipmentStatus();
  } else {
    showToast('Не удалось отметить (' + (d.reason || 'unknown') + ')', 'error');
  }
}

// Откат отгрузки
async function undoShipmentFromModal(shipmentId) {
  if (!shipmentId) return;
  if (!confirm('Отменить отгрузку этой позиции? Запись будет удалена.')) return;
  let r;
  try {
    r = await apiDelete('/api/shipments/' + shipmentId);
  } catch (e) {
    showToast('Не удалось отменить: ' + (e.message || e), 'error');
    return;
  }
  if (r && r.ok) {
    showToast('✓ Отгрузка отменена', 'success');
    _handleShipmentStatusChange(r);
    const m = document.getElementById('ship-detail-modal');
    if (m) m.classList.remove('visible');
    reloadShipmentStatus();
    // Если открыта история — перерисуем
    const log = document.getElementById('ship-log-content');
    if (log && log.style.display !== 'none') loadShipmentLog();
  } else {
    showToast('Не удалось отменить', 'error');
  }
}

// (D-упрощённый) Реакция на смену статуса договора
function _handleShipmentStatusChange(response) {
  if (!response || !response.contract_status_changed) return;
  const newStatus = response.contract_status_changed;
  let label = newStatus;
  if (newStatus === 'shipped') label = 'Отгружено';
  else if (newStatus === 'partially_shipped') label = 'Отгружено частично';
  else if (newStatus === 'production') label = 'В производстве';
  setTimeout(() => {
    showToast('📋 Договор переведён в статус «' + label + '»', 'info');
  }, 800);
}

// (E) История отгрузки — аккордеон
async function toggleShipmentLog() {
  const content = document.getElementById('ship-log-content');
  const btn = document.getElementById('ship-log-toggle-btn');
  if (!content || !btn) return;
  if (content.style.display === 'none') {
    content.style.display = '';
    btn.classList.add('open');
    await loadShipmentLog();
  } else {
    content.style.display = 'none';
    btn.classList.remove('open');
  }
}

async function loadShipmentLog() {
  const content = document.getElementById('ship-log-content');
  if (!content || !state._shipContractId) return;
  content.innerHTML = '<div class="ship-log-loading">Загрузка…</div>';
  let data;
  try {
    data = await apiGet('/api/contracts/' + state._shipContractId + '/shipment-log');
  } catch (e) {
    content.innerHTML = '<div class="ship-log-loading" style="color:var(--danger);">Ошибка: ' + escapeHtml(String(e.message || e)) + '</div>';
    return;
  }
  const entries = (data && data.entries) || [];
  if (!entries.length) {
    content.innerHTML = '<div class="ship-log-loading">Отгрузок пока не было</div>';
    return;
  }
  let html = '';
  entries.forEach(e => {
    const iconCls = e.type === 'box' ? 'ti-package' : 'ti-tool';
    const when = e.shipped_at ? String(e.shipped_at).slice(0, 16).replace('T', ' ') : '';
    const by = e.shipped_by_name || '';
    html += '<div class="ship-log-entry">' +
      '<div class="ship-log-icon"><i class="ti ' + iconCls + '"></i></div>' +
      '<div class="ship-log-body">' +
        '<div class="ship-log-name">' + escapeHtml(e.item_name) + '</div>' +
        '<div class="ship-log-meta">' + escapeHtml(when) + (by ? ' · ' + escapeHtml(by) : '') + '</div>' +
      '</div>' +
      '<button class="ship-log-undo" onclick="undoShipmentFromLog(' + e.shipment_id + ')" title="Отменить отгрузку">' +
        '<i class="ti ti-arrow-back-up"></i>' +
      '</button>' +
    '</div>';
  });
  content.innerHTML = html;
}

async function undoShipmentFromLog(shipmentId) {
  if (!shipmentId) return;
  if (!confirm('Отменить эту отгрузку? Запись будет удалена.')) return;
  try {
    const r = await apiDelete('/api/shipments/' + shipmentId);
    if (r && r.ok) {
      showToast('✓ Отгрузка отменена', 'success');
      _handleShipmentStatusChange(r);
      reloadShipmentStatus();
      loadShipmentLog();
    }
  } catch (e) {
    showToast('Не удалось отменить: ' + (e.message || e), 'error');
  }
}

// Хелпер: дата YYYY-MM-DD → ДД.ММ.ГГГГ
function _fmtDateRu(d) {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return m[3] + '.' + m[2] + '.' + m[1];
  return s;
}

// ============ конец Этапа 35 ============

function onShipmentAllDone() {
  const msg = _shipModeIsGather() ? 'Всё уже собрано к отгрузке' : 'Всё уже отгружено по этому договору';
  if (typeof toast === 'function') toast(msg);
  else alert(msg);
}

// ===== Continuous-режим сканера =====

async function startShipmentScan() {
  if (!state._shipContractId) {
    alert('Не выбран договор для отгрузки');
    return;
  }
  const _isGather = _shipModeIsGather();
  // v2.45.146: отгрузка по QR — под личным паролём (списывает склад). Сборка к
  // отгрузке (комплектация) — без пароля: она обратима и ничего не списывает.
  if (!_isGather) {
    const password = await _promptPasswordForAction(
      'Начать отгрузку по QR?',
      'Подтверди личным паролём — без него сканирование не запустится.'
    );
    if (password === null) return;   // отменили
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const vr = await fetch(API_BASE + '/api/auth/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ password: password }),
      });
      if (!vr.ok) {
        const d = await vr.json().catch(() => ({}));
        if (typeof _clearCachedPassword === 'function') _clearCachedPassword();
        showToast(d.error === 'wrong_password' ? 'Неверный пароль' : 'Нужно подтвердить паролем', 'error');
        return;
      }
    } catch (e) {
      showToast('Сеть: не удалось проверить пароль', 'error');
      return;
    }
  }
  // Загружаем актуальный прогресс для счётчика
  try {
    const status = await apiGet('/api/contracts/' + state._shipContractId + '/shipment-status');
    updateShipCounter((_isGather ? status.gathered : status.shipped) || 0, status.total || 0, '');
  } catch (e) {}

  // Включаем continuous-режим
  state._qrContinuousMode = true;
  state._shipPendingConfirm = null;   // v2.45.137: на старте нет неподтверждённых
  _hideShipConfirm();
  // Показываем UI continuous
  const overlay = document.getElementById('qr-scanner-overlay');
  if (overlay) overlay.classList.add('continuous-mode');
  const cnt = document.getElementById('ship-counter');     if (cnt) cnt.classList.add('visible');
  const fb  = document.getElementById('ship-finish-btn');  if (fb)  fb.classList.add('visible');
  // Готовим контекст звука по жесту пользователя
  _ensureAudioCtx();

  await openQrScanner();
}

const _SHIP_REASON_TEXT = {
  'unknown':         'QR не распознан',
  'no_contract':     'Объект не привязан к договору',
  'wrong_contract':  'Объект из другого договора',
  'already_shipped': 'Уже отгружено',
  'in_production':   'Нельзя — ещё в работе',
};
// v2.45.x: статусы карточки канбана по-русски (для сообщения «ещё в работе»)
const _PWORK_STATUS_RU = {
  'queue': 'в очереди', 'in_progress': 'в работе',
  'review': 'на проверке', 'packing': 'на упаковке',
};
// v2.45.405: в режиме сборки «already_shipped» означает «уже собрано»
function _shipReasonText(reason) {
  if (_shipModeIsGather() && reason === 'already_shipped') return 'Уже собрано';
  return _SHIP_REASON_TEXT[reason] || 'Ошибка';
}
function _shipScanEndpoint() {
  return _shipModeIsGather() ? '/api/gatherings/scan' : '/api/shipments/scan';
}

// v2.45.137: скан → ПРОВЕРКА (dry_run, без списания) → показываем «Совпадает
// по договору» + кнопку «Отгрузить». Реальная отгрузка — только по нажатию.
async function handleContinuousShipmentScan(decodedText) {
  if (!state._shipContractId) return;
  // Пока висит неподтверждённая позиция — игнорируем новые сканы
  if (state._shipPendingConfirm) return;
  // Извлекаем токен из URL если это полная ссылка
  let token = decodedText;
  let itemId = null;
  try {
    const url = new URL(decodedText);
    // ЭТАП 26.3: /a/ (сборка), /b/ (коробка), /c/ (договор)
    const m = url.pathname.match(/\/[abc]\/([A-Za-z0-9_\-]+)/);
    if (m) token = m[1];
    // v2.45.385: этикетка покупной позиции = /c/{токен договора}?item=ID.
    // Токен в ней — договорный (для просмотра карточки), а отгружать надо саму
    // позицию по её id. Достаём item и шлём его как contract_item_id.
    const it = url.searchParams.get('item');
    if (it && /^\d+$/.test(it)) itemId = Number(it);
  } catch (e) { /* не URL — оставляем как есть */ }
  token = String(token || '').trim();
  if (!token) return;

  let resp;
  try {
    resp = await apiPost(_shipScanEndpoint(), {
      qr_token: token,
      contract_id: state._shipContractId,
      contract_item_id: itemId,
      dry_run: true,   // только проверка
    });
  } catch (e) {
    flashScanner('error');
    playBeep('error');
    vibrate([100, 50, 100]);
    showShipLast('error', 'Ошибка связи', String(e));
    return;
  }

  // v2.45.145: apiPost возвращает {ok: HTTP-статус, data: тело}. Реальные поля
  // (ok/item/reason/progress) лежат в resp.data — раньше брали из resp напрямую,
  // из-за чего «уже отгружено» показывалось как «Отгрузить», а имя было пустым.
  const d = (resp && resp.data) || {};
  if (!resp.ok) {
    // HTTP-ошибка (400/500 и т.п.)
    flashScanner('error'); playBeep('error'); vibrate([100, 50, 100]);
    showShipLast('error', d.message || 'Ошибка сервера', '');
    return;
  }
  if (d.progress) {
    updateShipCounter(d.progress.shipped || 0, d.progress.total || 0,
      (d.item && d.item.name) || '');
  }
  if (d.ok) {
    // Совпадает по договору и ещё не отгружено — показываем подтверждение
    flashScanner('success');
    playBeep('success');
    vibrate(40);
    state._shipPendingConfirm = { token: token, itemId: itemId, item: d.item || {} };
    _showShipConfirm(d.item || {});
  } else if (d.reason === 'already_shipped' && d.shipment_id && !_shipModeIsGather()) {
    // Позицию уже пометили отгруженной (напр. через «Отгрузить по договору»).
    // Даём отгрузить её заново по скану: подтверждение снимет старую отметку и
    // проведёт отгрузку по коду.
    flashScanner('success');
    playBeep('success');
    vibrate(40);
    state._shipPendingConfirm = { token: token, itemId: itemId, item: d.item || {}, reship: true, shipmentId: d.shipment_id };
    _showShipConfirm(d.item || {}, true);
  } else if (d.reason === 'in_production') {
    // v2.45.x: изделие ещё в производстве — отгрузка запрещена
    flashScanner('error');
    playBeep('error');
    vibrate([100, 50, 100]);
    const bw = d.blocking_work || {};
    const st = _PWORK_STATUS_RU[bw.status] || 'в работе';
    const who = bw.assignee_name ? (' · ' + bw.assignee_name) : '';
    const name = (bw.model_name || (d.item && d.item.name) || 'Изделие');
    showShipLast('error', 'Нельзя — ещё ' + st, name + ' ещё на производстве' + who + '. Сначала закрой работу на канбане.');
  } else {
    // wrong_contract / unknown / no_contract — показываем тост-ошибку
    flashScanner('error');
    playBeep('error');
    vibrate([100, 50, 100]);
    const reasonText = _shipReasonText(d.reason);
    showShipLast('error', reasonText, (d.item && d.item.name) || '');
  }
}

function _showShipConfirm(item, reship) {
  const el = document.getElementById('ship-confirm');
  if (!el) return;
  const nm = document.getElementById('ship-confirm-name');
  let label = (item && item.name) || 'Позиция';
  // v2.45.139: для короба показываем, сколько сборок в нём отгрузится разом
  if (item && item.type === 'box') {
    const n = Number(item.qty) || 0;
    label += ' · ' + n + ' ' + _plural(n, ['сборка', 'сборки', 'сборок']);
  }
  if (reship) label += ' · уже отгружена';
  if (nm) nm.textContent = label;
  // v2.45.405: в режиме сборки кнопка подтверждения — «Собрано», не «Отгрузить»
  const okBtn = el.querySelector('.ship-confirm-ok');
  if (okBtn) {
    okBtn.innerHTML = reship
      ? '<i class="ti ti-refresh"></i> Отгрузить заново'
      : (_shipModeIsGather()
          ? '<i class="ti ti-checkbox"></i> Собрано'
          : '<i class="ti ti-check"></i> Отгрузить');
  }
  const last = document.getElementById('ship-last');
  if (last) last.classList.remove('visible');   // чтобы тост не перекрывал
  el.classList.add('visible');
}

function _hideShipConfirm() {
  const el = document.getElementById('ship-confirm');
  if (el) el.classList.remove('visible');
}

// Отмена — позиция не отгружается, продолжаем сканировать
function cancelShipConfirm() {
  state._shipPendingConfirm = null;
  _hideShipConfirm();
}

// «Отгрузить» — реальная отгрузка подтверждённой позиции
async function confirmShipCurrent() {
  const pending = state._shipPendingConfirm;
  if (!pending || state._shipConfirmBusy) return;
  state._shipConfirmBusy = true;
  const okBtn = document.querySelector('.ship-confirm-ok');
  if (okBtn) okBtn.disabled = true;
  try {
    const resp = await apiPost(_shipScanEndpoint(), {
      qr_token: pending.token,
      contract_id: state._shipContractId,
      contract_item_id: pending.itemId || null,
      // «Отгрузить заново»: бэкенд атомарно снимет прежнюю отметку и отгрузит снова
      force: pending.reship ? true : undefined,
    });
    // v2.45.145: поля в resp.data, не в resp (см. apiPost)
    const d = (resp && resp.data) || {};
    if (d.progress) {
      const name = (d.item && d.item.name) || (pending.item && pending.item.name) || '';
      updateShipCounter(d.progress.shipped || 0, d.progress.total || 0, name);
    }
    if (resp.ok && d.ok) {
      flashScanner('success');
      playBeep('success');
      vibrate(80);
      const item = d.item || pending.item || {};
      const okWord = _shipModeIsGather() ? 'Собрано' : 'Отгружено';
      showShipLast('success', '✓ ' + (item.name || okWord),
        (d.progress ? (d.progress.shipped + ' из ' + d.progress.total) : ''));
    } else {
      flashScanner('error');
      playBeep('error');
      vibrate([100, 50, 100]);
      const reasonText = (_shipModeIsGather() && d.reason === 'already_shipped')
        ? 'Уже собрано' : (_SHIP_REASON_TEXT[d.reason] || (d.message || 'Ошибка'));
      showShipLast('error', reasonText, (d.item && d.item.name) || '');
    }
  } catch (e) {
    flashScanner('error');
    playBeep('error');
    showShipLast('error', 'Ошибка связи', String(e));
  } finally {
    state._shipPendingConfirm = null;
    state._shipConfirmBusy = false;
    if (okBtn) okBtn.disabled = false;
    _hideShipConfirm();
  }
}

function finishShipmentScan() {
  state._qrContinuousMode = false;
  state._shipPendingConfirm = null;   // v2.45.137: сбрасываем неподтверждённое
  // Прячем continuous UI
  const overlay = document.getElementById('qr-scanner-overlay');
  if (overlay) overlay.classList.remove('continuous-mode');
  const cnt = document.getElementById('ship-counter');     if (cnt) cnt.classList.remove('visible');
  const fb  = document.getElementById('ship-finish-btn');  if (fb)  fb.classList.remove('visible');
  const last = document.getElementById('ship-last');       if (last) last.classList.remove('visible');
  _hideShipConfirm();
  closeQrScanner();
  // Перерисовываем экран отгрузки (актуальный список)
  setTimeout(reloadShipmentStatus, 200);
}

// ============ КОНЕЦ ЭТАПА 26.2 ============


// ============================================================
// ЭТАП 26 (v2.25.0): АВТО-ПРИЁМКА УПД через ИИ
// ============================================================

// Состояние модуля
const siState = {
  currentInvoiceId: null,
  currentInvoice:   null,  // полный объект УПД, обновляем при render
  pollingTimer: null,
  pollingActive: false,
  itemsCache: [],
  categories: null,  // [{id, name, code, ...}] — кешируем для inline-select раздела
  selected: new Set(), // v2.44.50: bulk-выбор позиций
};

// Загружаем категории компонентов один раз для всех селектов в карточке УПД
async function siEnsureCategoriesLoaded() {
  if (siState.categories) return siState.categories;
  try {
    const r = await apiGet('/api/components/categories');
    // Эндпоинт отдаёт {categories: [...]} — но на всякий случай поддерживаем и items
    siState.categories = (r && (r.categories || r.items)) || [];
  } catch (e) {
    siState.categories = [];
  }
  return siState.categories;
}

// Меняем suggested_category_id у позиции
async function siChangeItemCategory(itemId, newCatId) {
  const invoiceId = siState.currentInvoiceId;
  if (!invoiceId) { showToast('Нет открытой УПД', 'error'); return; }
  try {
    await apiPatch('/api/supply/invoices/' + invoiceId + '/items/' + itemId,
                    { suggested_category_id: newCatId ? parseInt(newCatId, 10) : null });
    showToast('Раздел обновлён', 'success');
    loadSupplyInvoiceDetail(invoiceId);
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

const SI_DEST_DEF = {
  production:         { label: 'Производство',     icon: 'ti-building-factory-2', cls: 'd-production' },
  finished_warehouse: { label: 'Готовый склад',    icon: 'ti-package',            cls: 'd-production' },
  tools:              { label: 'Инструмент',       icon: 'ti-tool',               cls: 'd-tools' },
  order:              { label: 'На заказ',         icon: 'ti-target',             cls: 'd-order' },
  expense:            { label: 'Списать сразу',    icon: 'ti-bolt',               cls: 'd-tools' },
  refused:            { label: 'Не принять',       icon: 'ti-circle-x',           cls: 'd-refused' },
};

const SI_REFUSE_REASONS = [
  { key: 'defect',       label: 'Брак',                  icon: 'ti-alert-octagon' },
  { key: 'not_ordered',  label: 'Не заказывали',         icon: 'ti-x' },
  { key: 'wrong_item',   label: 'Пересортица',           icon: 'ti-replace' },
  { key: 'excess_qty',   label: 'Перебор по количеству', icon: 'ti-arrow-up' },
  { key: 'other',        label: 'Другое',                icon: 'ti-dots' },
];

// ---------- Главный вход: список черновиков ----------

async function loadSupplyInvoicesList() {
  // Сбрасываем detail-режим при возврате
  siState.currentInvoiceId = null;
  siStopPolling();

  const body = document.getElementById('si-screen-body');
  const counter = document.getElementById('si-counter');
  if (!body) return;
  body.innerHTML = '<div class="loading-block">Загружаем приёмки…</div>';

  const q = (typeof siState !== 'undefined' && siState.searchQ) ? siState.searchQ : '';
  try {
    const r = await apiGet('/api/supply/invoices?limit=100' + (q ? '&q=' + encodeURIComponent(q) : ''));
    const items = (r && r.items) || [];
    if (counter) counter.textContent = items.length;
    renderSupplyInvoicesList(items);
  } catch (e) {
    body.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i><h3>Ошибка</h3><p>' + escapeHtml(String(e.message || e)) + '</p></div>';
  }
}

// Поиск по приёмкам УПД (по позиции / № / поставщику). Поле — в статичной шапке,
// поэтому фокус не теряется при перерисовке списка.
let _siSearchTimer = null;
function siSearchInput(v) {
  clearTimeout(_siSearchTimer);
  const clearBtn = document.getElementById('si-search-clear');
  if (clearBtn) clearBtn.style.display = (v && v.length) ? '' : 'none';
  _siSearchTimer = setTimeout(function () {
    if (typeof siState !== 'undefined') siState.searchQ = (v || '').trim();
    loadSupplyInvoicesList();
  }, 350);
}
function siSearchClear() {
  const inp = document.getElementById('si-search');
  if (inp) inp.value = '';
  const clearBtn = document.getElementById('si-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  if (typeof siState !== 'undefined') siState.searchQ = '';
  loadSupplyInvoicesList();
}

// Мобильная мини-шапка для экрана Приёмки УПД: 2 большие тач-кнопки сверху
function renderSiMobileHeader() {
  return (
    '<div class="si-mobile-header">' +
      '<div class="si-mobile-header-title">' +
        '<i class="ti ti-sparkles"></i>' +
        '<span>Приёмка УПД</span>' +
      '</div>' +
      '<div class="si-mobile-actions">' +
        '<button class="si-upload-action-btn primary" onclick="openSupplyInvoiceCameraDirect()">' +
          '<i class="ti ti-camera"></i>' +
          '<div>' +
            '<div class="si-upload-action-title">Сфотографировать</div>' +
            '<div class="si-upload-action-hint">прямо с камеры</div>' +
          '</div>' +
        '</button>' +
        '<button class="si-upload-action-btn" onclick="openSupplyInvoiceUpload()">' +
          '<i class="ti ti-file-upload"></i>' +
          '<div>' +
            '<div class="si-upload-action-title">Загрузить</div>' +
            '<div class="si-upload-action-hint">PDF, фото или Excel</div>' +
          '</div>' +
        '</button>' +
      '</div>' +
    '</div>'
  );
}

// v2.45.x: «Приёмка УПД» — группировка по статусу + карточки (под переключателем)
function _updSupInitials(name) {
  let s = String(name || '').replace(/[«»"'()]/g, ' ')
    .replace(/общество с ограниченной ответственностью/gi, ' ')
    .replace(/\b(ООО|ОАО|ЗАО|ПАО|АО|ИП|ТД|ТПК)\b/gi, ' ').trim();
  const w = s.split(/\s+/).filter(Boolean);
  if (!w.length) return (typeof _supInitials === 'function' ? _supInitials(name) : '—');
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[1][0]).toUpperCase();
}
function _updMoney(x) { return Math.round(Number(x) || 0).toLocaleString('ru-RU'); }
function _updKpi(cls, emoji, num, lbl) {
  return '<div class="upd-kpi ' + cls + '"><div class="upd-kpi-ic"><span class="em">' + emoji + '</span></div>' +
    '<div><div class="upd-kpi-num">' + num + '</div><div class="upd-kpi-lbl">' + escapeHtml(lbl) + '</div></div></div>';
}
function _updSec(emoji, title, count) {
  return '<div class="upd-sec"><span class="em">' + emoji + '</span> ' + escapeHtml(title) + ' <span class="cnt">' + count + '</span></div>';
}
function _updDelBtn(inv, status) {
  if (status === 'cancelled') return '';
  const confirmed = (status === 'confirmed' || status === 'partially_refused');
  const handler = confirmed ? 'deleteConfirmedSupplyInvoice' : 'deleteSupplyInvoiceFromList';
  const title = confirmed ? 'Отменить оприходование' : 'Удалить черновик';
  return '<button class="btn upd-icon" title="' + title + '" onclick="event.stopPropagation();' + handler + '(' + inv.id + ')"><span class="em">🗑</span></button>';
}
function _updCard(inv, kind) {
  const status = inv.status || 'draft';
  const isPending = (inv.recognition_state === 'pending');
  const rawName = inv.source_file_name || '';
  const looksLikeTimestamp = /^\d{10,}\.[a-z]+$/i.test(rawName) || /^IMG_\d+/i.test(rawName);
  const num = inv.document_number ? ('УПД №' + escapeHtml(inv.document_number))
    : (rawName && !looksLikeTimestamp ? escapeHtml(rawName) : (inv.created_at ? ('Скан от ' + siFmtDate(inv.created_at)) : 'Скан'));
  const dateStr = inv.document_date ? (' от ' + siFmtDate(inv.document_date)) : '';
  const supplier = inv.supplier_name_raw || '—';
  const ava = (kind === 'wait')
    ? '<div class="upd-ava wait"><span class="em">📄</span></div>'
    : '<div class="upd-ava">' + escapeHtml(_updSupInitials(supplier)) + '</div>';
  let chip;
  if (isPending) chip = '<span class="upd-chip wait"><span class="em">⏳</span> ждёт распознавания</span>';
  else if (status === 'draft') chip = '<span class="upd-chip draft"><span class="em">📝</span> черновик</span>';
  else if (status === 'confirmed') chip = '<span class="upd-chip ok"><span class="em">✅</span> оприходовано</span>';
  else if (status === 'partially_refused') chip = '<span class="upd-chip warn"><span class="em">⚠️</span> с отказами</span>';
  else chip = '<span class="upd-chip mut">' + escapeHtml(siStatusLabel(status)) + '</span>';
  const contractChip = inv.contract_number ? '<span class="upd-chip doc">Дог. №' + escapeHtml(inv.contract_number) + '</span>' : '';
  const parts = ['<b>' + escapeHtml(supplier) + '</b>'];
  if (inv.pages_count && inv.pages_count > 1) parts.push(inv.pages_count + ' стр.');
  if (inv.items_count > 0) parts.push(inv.items_count + ' поз.');
  if (inv.created_at) parts.push((status === 'confirmed' ? '' : 'создано ') + siFmtDateTime(inv.created_at));
  const sumHtml = (inv.sum_with_vat != null && Number(inv.sum_with_vat) > 0)
    ? '<div class="upd-sum">' + _updMoney(inv.sum_with_vat) + ' ₽<small>с НДС</small></div>' : '';
  let acts;
  if (isPending) acts = '<button class="btn btn-primary" onclick="event.stopPropagation();loadSupplyInvoiceDetail(' + inv.id + ')"><span class="em">✨</span> Распознать</button>';
  else if (status === 'draft') acts = '<button class="btn btn-primary" onclick="event.stopPropagation();loadSupplyInvoiceDetail(' + inv.id + ')"><span class="em">✅</span> Оприходовать</button>';
  else acts = '<button class="btn" onclick="event.stopPropagation();loadSupplyInvoiceDetail(' + inv.id + ')"><span class="em">👁</span> Открыть</button>';
  acts += '<button class="btn upd-icon" title="Открыть файл" onclick="event.stopPropagation();openSupplyInvoiceFile(' + inv.id + ')"><span class="em">📎</span></button>';
  acts += _updDelBtn(inv, status);
  const matchHtml = (inv.matched_items && inv.matched_items.length)
    ? '<div class="upd-match" style="margin-top:3px;font-size:12px;color:var(--brand);font-weight:600;">' +
        '<span class="em">🔎</span> ' + inv.matched_items.map(escapeHtml).join(' · ') + '</div>'
    : '';
  return '<div class="upd ' + kind + '" onclick="loadSupplyInvoiceDetail(' + inv.id + ')">' +
    ava +
    '<div class="upd-body">' +
      '<div class="upd-top"><span class="upd-num">' + num + escapeHtml(dateStr) + '</span>' + chip + contractChip + '</div>' +
      '<div class="upd-sub">' + parts.join(' · ') + '</div>' +
      matchHtml +
    '</div>' +
    sumHtml +
    '<div class="upd-acts">' + acts + '</div>' +
  '</div>';
}
function toggleUpdV2() {
  window.UPD_V2 = !window.UPD_V2;
  try { localStorage.setItem('updV2', window.UPD_V2 ? '1' : '0'); } catch (_) {}
  loadSupplyInvoicesList();
}

function renderSupplyInvoicesList(items) {
  const body = document.getElementById('si-screen-body');
  if (!body) return;
  const isMobile = !!(state && !state.isDesktop);
  window.UPD_V2 = localStorage.getItem('updV2') !== '0';

  if (!items.length) {
    const _sq = (typeof siState !== 'undefined' && siState.searchQ) ? siState.searchQ : '';
    if (_sq) {
      body.innerHTML = (isMobile ? renderSiMobileHeader() : '') +
        '<div class="empty-block"><i class="ti ti-search-off"></i><h3>Ничего не найдено</h3>' +
        '<p>По запросу «' + escapeHtml(_sq) + '» нет ни одной УПД. Попробуй другое слово или часть названия.</p></div>';
      return;
    }
    if (isMobile) {
      body.innerHTML =
        renderSiMobileHeader() +
        '<div class="empty-block" style="margin-top:16px;">' +
          '<i class="ti ti-file-text"></i>' +
          '<h3>Пока нет приёмок</h3>' +
          '<p>Загрузите первую УПД одной из кнопок выше</p>' +
        '</div>';
    } else {
      body.innerHTML =
        '<div class="si-upload-zone" onclick="openSupplyInvoiceUpload()">' +
          '<i class="ti ti-cloud-upload"></i>' +
          '<div class="si-upload-zone-title">Перетащите PDF/фото накладной сюда</div>' +
          '<div class="si-upload-zone-hint">или нажмите чтобы выбрать файл. ИИ распознает реквизиты и позиции за 15-30 секунд.</div>' +
        '</div>';
    }
    return;
  }

  const toggle = '<div class="sv2-toggle-bar">' +
      '<span><i class="ti ti-' + (window.UPD_V2 ? 'sparkles' : 'history') + '"></i> ' + (window.UPD_V2 ? 'Новый вид' : 'Старый вид') + '</span>' +
      '<button class="sv2-toggle-btn" onclick="toggleUpdV2()">' + (window.UPD_V2 ? 'Вернуть старый' : 'Включить новый') + '</button>' +
    '</div>';
  const headBlk = isMobile ? renderSiMobileHeader() : '';

  if (!window.UPD_V2) { body.innerHTML = headBlk + toggle + _renderUpdOldList(items); return; }

  // Группировка по статусу
  const pending = [], drafts = [], done = [], other = [];
  items.forEach(inv => {
    const st = inv.status || 'draft';
    if (inv.recognition_state === 'pending') pending.push(inv);
    else if (st === 'draft') drafts.push(inv);
    else if (st === 'confirmed' || st === 'partially_refused') done.push(inv);
    else other.push(inv);
  });
  let html = headBlk + toggle;
  html += '<div class="upd-kpis">' +
    _updKpi('draft', '📝', drafts.length, 'Черновики — оприходовать') +
    _updKpi('wait', '⏳', pending.length, 'Ждут распознавания') +
    _updKpi('ok', '✅', done.length, 'Оприходовано') +
    _updKpi('tot', '📄', items.length, 'Всего за период') +
  '</div>';
  if (pending.length) {
    html += _updSec('⏳', 'Ждут распознавания', pending.length) +
      '<div class="upd-hint">Файл загружен, ИИ ещё не разобрал реквизиты. Открой — запустится распознавание.</div>';
    pending.forEach(inv => { html += _updCard(inv, 'wait'); });
  }
  if (drafts.length) {
    html += _updSec('📝', 'Черновики — проверить и оприходовать', drafts.length) +
      '<div class="upd-hint">Реквизиты распознаны. Открой, сверь позиции и оприходуй на склад.</div>';
    drafts.forEach(inv => { html += _updCard(inv, 'draft'); });
  }
  if (done.length) {
    html += _updSec('✅', 'Оприходовано', done.length);
    done.forEach(inv => { html += _updCard(inv, 'ok'); });
  }
  other.forEach(inv => { html += _updCard(inv, 'mut'); });
  body.innerHTML = html;
}

// Старый вид (для отката) — прежний плоский список карточек
function _renderUpdOldList(items) {
  let html = '';
  items.forEach(inv => {
    const status = inv.status || 'draft';
    // Pending-распознавание показываем особым чипом — Дмитрий с компа должен видеть, какие УПД ждут запуска
    const isPending = (inv.recognition_state === 'pending');
    const chipCls = isPending ? 'sc-pending' : siStatusChipClass(status);
    const chipTxt = isPending ? 'Ждёт распознавания' : siStatusLabel(status);
    // Заголовок: предпочтительно УПД №… от …; иначе осмысленное имя файла (без timestamp-мусора);
    // иначе просто "Черновик · {дата создания}"
    const rawName = inv.source_file_name || '';
    const looksLikeTimestamp = /^\d{10,}\.[a-z]+$/i.test(rawName) || /^IMG_\d+/i.test(rawName);
    const docTitle = inv.document_number
      ? ('УПД №' + escapeHtml(inv.document_number) + (inv.document_date ? (' от ' + siFmtDate(inv.document_date)) : ''))
      : (rawName && !looksLikeTimestamp
          ? rawName
          : ('Черновик · ' + (inv.created_at ? siFmtDateTime(inv.created_at) : '')));
    const supplier = inv.supplier_name_raw || '—';
    const itemsLine = inv.items_count != null ? (inv.items_count + ' поз.') : '';
    const pagesLine = (inv.pages_count && inv.pages_count > 1) ? (inv.pages_count + ' стр.') : '';
    const createdLine = inv.created_at ? ('создано ' + siFmtDateTime(inv.created_at)) : '';
    // Иконка удаления: для черновиков и отменённых — простой soft-delete,
    // для оприходованных — с откатом со склада
    const canDelete = (status !== 'cancelled');
    const handler = (status === 'confirmed' || status === 'partially_refused')
      ? 'deleteConfirmedSupplyInvoice'
      : 'deleteSupplyInvoiceFromList';
    const delTitle = (status === 'confirmed' || status === 'partially_refused')
      ? 'Отменить оприходование'
      : 'Удалить черновик';
    const delBtn = canDelete
      ? '<button class="icon-btn si-row-del" title="' + delTitle + '" ' +
          'onclick="event.stopPropagation();' + handler + '(' + inv.id + ')">' +
          '<i class="ti ti-trash"></i></button>'
      : '';
    const contractChip = inv.contract_number
      ? ('<span style="display:inline-block;background:#E0E7FF;color:#3730A3;border-radius:6px;padding:1px 7px;font-size:11px;font-weight:600;">Дог. №' + escapeHtml(inv.contract_number) + '</span>')
      : '';
    const openBtn = '<button class="icon-btn" title="Открыть счёт" onclick="event.stopPropagation();openSupplyInvoiceFile(' + inv.id + ')"><i class="ti ti-eye"></i></button>';
    html +=
      '<div class="si-list-card" onclick="loadSupplyInvoiceDetail(' + inv.id + ')">' +
        '<div class="si-list-card-row">' +
          '<div class="si-list-card-title">' + escapeHtml(docTitle) + '</div>' +
          openBtn + delBtn +
        '</div>' +
        '<div class="si-list-card-bottom">' +
          '<span class="si-status-chip ' + chipCls + '">' + escapeHtml(chipTxt) + '</span>' +
          contractChip +
          '<span class="si-list-card-meta">' +
            escapeHtml(supplier) + (pagesLine ? (' · ' + pagesLine) : '') + (itemsLine ? (' · ' + itemsLine) : '') + (createdLine ? (' · ' + createdLine) : '') +
          '</span>' +
        '</div>' +
        ((inv.matched_items && inv.matched_items.length)
          ? '<div style="margin-top:4px;font-size:12px;color:var(--brand);font-weight:600;">🔎 ' + inv.matched_items.map(escapeHtml).join(' · ') + '</div>'
          : '') +
      '</div>';
  });
  return html;
}

// Удаление из списка с подтверждением
async function deleteSupplyInvoiceFromList(invoiceId) {
  if (!confirm('Удалить эту приёмку?\n\nЧерновик будет помечен как отменённый и скрыт из списка.')) return;
  try {
    const r = await apiDelete('/api/supply/invoices/' + invoiceId);
    if (r && r.ok === false) {
      showToast('Ошибка: ' + ((r.data && r.data.message) || ('HTTP ' + (r.status || '?'))), 'error');
      return;
    }
    showToast('Удалено', 'success');
    loadSupplyInvoicesList();
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

function siStatusChipClass(s) {
  if (s === 'confirmed') return 'sc-success';
  if (s === 'partially_refused') return 'sc-warn';
  if (s === 'cancelled') return 'sc-muted';
  return 'sc-info';
}
function siStatusLabel(s) {
  switch (s) {
    case 'draft':              return 'Черновик';
    case 'confirmed':          return 'Оприходовано';
    case 'partially_refused':  return 'С отказами';
    case 'cancelled':          return 'Отменено';
    default:                   return s;
  }
}
function siFmtDate(s) {
  if (!s) return '';
  const d = String(s).substring(0, 10);
  const [y, m, dd] = d.split('-');
  return (dd && m && y) ? (dd + '.' + m + '.' + y) : d;
}
function siFmtDateTime(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z'));
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
// Маппинг типа документа из Vision (UPD/TORG12/INVOICE) → русское обозначение
function siFmtDocType(t) {
  const m = { 'UPD': 'УПД', 'TORG12': 'ТОРГ-12', 'INVOICE': 'Счёт-фактура' };
  return m[String(t || '').toUpperCase()] || (t || 'УПД');
}

// ---------- Модалка загрузки ----------

// Прямое открытие камеры — без модалки, без выбора defer
// При выборе фото — сразу же загружаем и идём в распознавание
function openSupplyInvoiceCameraDirect() {
  const input = document.getElementById('si-camera-direct-input');
  if (input) {
    input.value = '';  // сбросить, чтобы onchange сработал повторно для того же файла
    input.click();
  }
}

async function siHandleCameraDirect(event) {
  const files = event.target.files;
  if (!files || !files.length) return;
  // Загружаем без модалки — сразу с тостом
  showToast('Загружаем фото · распознавание запустишь вручную с компа', 'success');
  // Переключаемся на экран Приёмки УПД, чтобы было куда показать detail
  if (typeof selectSidebarItem === 'function' && state.currentScreen !== 'supply-invoice-intake') {
    selectSidebarItem('supply-invoice-intake');
  }
  const fd = new FormData();
  Array.from(files).forEach(f => fd.append('file', f, f.name));
  // Камера всегда откладывает распознавание — токены экономим, запускаем с компа
  fd.append('defer_recognition', '1');
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      showToast('Сессия истекла, войдите заново', 'error');
      return;
    }
    const res = await fetch(API_BASE + '/api/supply/invoices/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: fd,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast('Ошибка: ' + (data.message || data.error || ('HTTP ' + res.status)), 'error');
      return;
    }
    const data = await res.json();
    // Открываем карточку УПД — там pending-блок с кнопкой «Добавить страницу»
    // Это удобно для multi-page УПД: снял первый лист → сразу можешь снять второй
    loadSupplyInvoiceDetail(data.id);
  } catch (e) {
    showToast('Ошибка соединения: ' + (e.message || e), 'error');
  }
}

// Добавление страницы к существующей УПД (для multi-page)
function openSiAddPageDialog(invoiceId) {
  // Создаём временный invisible input — capture камера; после фото шлём в add-files
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,application/pdf';
  input.multiple = true;
  // Capture только если есть смысл (на мобильной)
  if (state && !state.isDesktop) input.setAttribute('capture', 'environment');
  input.style.display = 'none';
  input.onchange = async (ev) => {
    const files = ev.target.files;
    if (!files || !files.length) { input.remove(); return; }
    showToast('Добавляем ' + files.length + ' стр…', 'success');
    const fd = new FormData();
    Array.from(files).forEach(f => fd.append('file', f, f.name));
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const res = await fetch(API_BASE + '/api/supply/invoices/' + invoiceId + '/add-files', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: fd,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast('Ошибка: ' + (data.message || data.error || ('HTTP ' + res.status)), 'error');
        return;
      }
      const data = await res.json();
      showToast('Добавлено ' + (data.added || 0) + ' стр · всего ' + (data.total_pages || '?') + ' стр', 'success');
      loadSupplyInvoiceDetail(invoiceId);
    } catch (e) {
      showToast('Ошибка соединения: ' + (e.message || e), 'error');
    } finally {
      input.remove();
    }
  };
  document.body.appendChild(input);
  input.click();
}

// === Ручная приёмка УПД (без AI) ===
// Открывает модалку с шапкой документа. После создания пользователь
// переходит на детальную страницу УПД и добавляет позиции через addManualSiItem.
// === Добавление позиции вручную с автокомплитом по каталогу ===
function openAddManualItemForm() {
  const existing = document.getElementById('si-add-item-modal');
  if (existing) existing.remove();
  const cats = (siState && siState.categories) || [];
  let catOpts = '<option value="">— Разное</option>';
  cats.forEach(c => {
    if ((c.code || '').toLowerCase() === 'misc' || (c.name || '').toLowerCase() === 'разное') return;
    catOpts += '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
  });
  const overlay = document.createElement('div');
  overlay.id = 'si-add-item-modal';
  overlay.className = 'modal-overlay visible';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML =
    '<div class="modal" style="max-width:520px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-plus"></i>Добавить позицию</h3>' +
        '<button class="icon-btn" onclick="document.getElementById(\'si-add-item-modal\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="form-group" style="position:relative;"><label>Название позиции</label>' +
          '<input type="text" id="si-add-item-name" placeholder="Например: Наконечник НШВИ 0.75-8 синий" autocomplete="off" autofocus oninput="onAddItemNameInput()">' +
          '<div id="si-add-item-suggest" style="position:absolute;left:0;right:0;top:100%;background:white;border:1px solid var(--border);border-radius:8px;margin-top:4px;max-height:260px;overflow:auto;display:none;z-index:10;box-shadow:0 4px 12px rgba(0,0,0,.08);"></div>' +
          '<div id="si-add-item-match-status" class="form-hint" style="margin-top:6px;">' +
            '<i class="ti ti-search" style="vertical-align:-2px;margin-right:4px;color:var(--text-faint);"></i>' +
            'Начните вводить — подскажу совпадения из каталога' +
          '</div>' +
        '</div>' +
        '<div class="form-row" style="margin-top:14px;">' +
          '<div class="form-group"><label>Кол-во</label>' +
            '<input type="number" id="si-add-item-qty" step="0.01" min="0" value="1">' +
          '</div>' +
          '<div class="form-group"><label>Ед.</label>' +
            '<input type="text" id="si-add-item-unit" value="шт">' +
          '</div>' +
          '<div class="form-group"><label>Цена <span style="text-transform:none;color:var(--text-faint);font-weight:400;">(опц.)</span></label>' +
            '<input type="number" id="si-add-item-price" step="0.01" min="0" placeholder="0">' +
          '</div>' +
        '</div>' +
        '<div class="form-group" id="si-add-item-cat-row" style="margin-top:14px;">' +
          '<label>Раздел склада <span style="text-transform:none;color:var(--text-faint);font-weight:400;">(если создаётся новая карточка)</span></label>' +
          '<select id="si-add-item-cat">' + catOpts + '</select>' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'si-add-item-modal\').remove()">Отмена</button>' +
        '<button class="btn btn-primary" onclick="submitAddManualItem()"><i class="ti ti-plus"></i>Добавить</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  // Сбрасываем выбор существующего компонента
  siAddItemState = { matchedId: null, matchedName: '', matchedCategory: '' };
}

let siAddItemState = { matchedId: null, matchedName: '', matchedCategory: '' };
let _siAddItemTimer = null;

function onAddItemNameInput() {
  clearTimeout(_siAddItemTimer);
  _siAddItemTimer = setTimeout(siAutocompleteComponent, 200);
}

async function siAutocompleteComponent() {
  const q = ((document.getElementById('si-add-item-name') || {}).value || '').trim();
  const box = document.getElementById('si-add-item-suggest');
  const status = document.getElementById('si-add-item-match-status');
  if (!box) return;
  if (q.length < 2) {
    box.style.display = 'none';
    siAddItemState.matchedId = null;
    if (status) status.innerHTML = 'Начните вводить — подскажу совпадения из каталога';
    return;
  }
  try {
    const r = await apiGet('/api/components?search=' + encodeURIComponent(q));
    const items = (r && (r.items || r.components)) || [];
    const top = items.slice(0, 8);
    if (top.length === 0) {
      box.style.display = 'none';
      if (status) status.innerHTML = '<span style="color:#854F0B;">⊕ В каталоге не найдено — будет создана новая карточка</span>';
      siAddItemState.matchedId = null;
      return;
    }
    let html = '';
    top.forEach(c => {
      const cat = c.category_name || '—';
      const qty = c.qty_on_stock != null ? (' · в наличии: ' + c.qty_on_stock + ' ' + (c.unit || 'шт')) : '';
      html += '<div class="si-suggest-item" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);" ' +
              'onclick="pickAutocompleteSuggestion(' + c.id + ', \'' + escapeJs(c.name) + '\', \'' + escapeJs(cat) + '\', \'' + (c.unit || 'шт') + '\')">' +
              '<div style="font-weight:500;color:var(--text-dark);">' + escapeHtml(c.name) + '</div>' +
              '<div style="font-size:11.5px;color:var(--text-light);">раздел: ' + escapeHtml(cat) + qty + '</div>' +
              '</div>';
    });
    box.innerHTML = html;
    box.style.display = 'block';
    if (status) status.innerHTML = '<span style="color:#0A5B41;">✓ Найдено ' + top.length + ' совпадений — выберите из списка или продолжайте ввод</span>';
  } catch (e) {
    box.style.display = 'none';
  }
}

function escapeJs(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

function pickAutocompleteSuggestion(id, name, category, unit) {
  document.getElementById('si-add-item-name').value = name;
  const unitInput = document.getElementById('si-add-item-unit');
  if (unitInput && !unitInput.value.trim()) unitInput.value = unit || 'шт';
  document.getElementById('si-add-item-suggest').style.display = 'none';
  document.getElementById('si-add-item-cat-row').style.display = 'none';  // раздел не нужен — позиция привяжется к существующей карточке
  siAddItemState = { matchedId: id, matchedName: name, matchedCategory: category };
  const status = document.getElementById('si-add-item-match-status');
  if (status) status.innerHTML = '<span style="color:#0A5B41;">✓ Привязано к карточке: <b>' + escapeHtml(name) + '</b> (раздел: ' + escapeHtml(category) + ')</span>';
}

async function submitAddManualItem() {
  const name  = ((document.getElementById('si-add-item-name')  || {}).value || '').trim();
  const qty   = parseFloat(((document.getElementById('si-add-item-qty')   || {}).value || '').replace(',', '.'));
  const unit  = ((document.getElementById('si-add-item-unit')  || {}).value || 'шт').trim();
  const price = parseFloat(((document.getElementById('si-add-item-price') || {}).value || '').replace(',', '.'));
  const catSel = document.getElementById('si-add-item-cat');
  const catId = catSel && catSel.value ? parseInt(catSel.value, 10) : null;
  if (!name) { showToast('Укажите название', 'error'); return; }
  if (!qty || qty <= 0) { showToast('Кол-во должно быть > 0', 'error'); return; }
  const invoiceId = siState.currentInvoiceId;
  if (!invoiceId) { showToast('Нет открытой УПД', 'error'); return; }
  const body = {
    name: name,
    qty: qty,
    unit: unit,
    price: isNaN(price) ? null : price,
  };
  if (siAddItemState.matchedId) body.matched_component_id = siAddItemState.matchedId;
  else if (catId) body.suggested_category_id = catId;
  try {
    const r = await apiPost('/api/supply/invoices/' + invoiceId + '/items', body);
    if (!r.ok) { showToast('Ошибка: ' + ((r.data && r.data.message) || ('HTTP ' + r.status)), 'error'); return; }
    document.getElementById('si-add-item-modal').remove();
    showToast('Позиция добавлена', 'success');
    loadSupplyInvoiceDetail(invoiceId);
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

function openManualSupplyInvoice() {
  const existing = document.getElementById('si-manual-modal');
  if (existing) existing.remove();
  const today = new Date().toISOString().slice(0, 10);
  const overlay = document.createElement('div');
  overlay.id = 'si-manual-modal';
  overlay.className = 'modal-overlay visible';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML =
    '<div class="modal" style="max-width:480px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-edit"></i>Принять накладную вручную</h3>' +
        '<button class="icon-btn" onclick="document.getElementById(\'si-manual-modal\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="modal-section-title">Поставщик</div>' +
        '<div class="form-group"><label>Название организации</label>' +
          '<input type="text" id="si-manual-supplier-name" placeholder="ООО «ТД Электрика»" autofocus>' +
        '</div>' +
        '<div class="form-group"><label>ИНН <span style="text-transform:none;color:var(--text-faint);font-weight:400;">(опционально)</span></label>' +
          '<input type="text" id="si-manual-supplier-inn" placeholder="7415091417" maxlength="12" inputmode="numeric">' +
        '</div>' +
        '<div class="modal-section-title" style="margin-top:18px;">Документ</div>' +
        '<div class="form-row">' +
          '<div class="form-group"><label>№ УПД</label>' +
            '<input type="text" id="si-manual-doc-num" placeholder="140">' +
          '</div>' +
          '<div class="form-group"><label>Дата</label>' +
            '<input type="date" id="si-manual-doc-date" value="' + today + '">' +
          '</div>' +
        '</div>' +
        '<div class="form-hint">' +
          '<i class="ti ti-info-circle" style="vertical-align:-2px;margin-right:4px;color:var(--brand);"></i>' +
          'После создания черновика откроется страница, на которой вы добавите позиции по одной — с подсказками из каталога.' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'si-manual-modal\').remove()">Отмена</button>' +
        '<button class="btn btn-primary" onclick="submitManualSupplyInvoice()"><i class="ti ti-check"></i>Создать черновик</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
}

async function submitManualSupplyInvoice() {
  const name = (document.getElementById('si-manual-supplier-name') || {}).value || '';
  const inn  = (document.getElementById('si-manual-supplier-inn')  || {}).value || '';
  const num  = (document.getElementById('si-manual-doc-num')       || {}).value || '';
  const dt   = (document.getElementById('si-manual-doc-date')      || {}).value || '';
  if (!name.trim()) { showToast('Укажите название поставщика', 'error'); return; }
  try {
    const r = await apiPost('/api/supply/invoices/manual', {
      supplier_name: name.trim(),
      supplier_inn:  inn.trim(),
      document_number: num.trim(),
      document_date: dt,
    });
    if (!r.ok) { showToast('Ошибка: ' + ((r.data && r.data.message) || ('HTTP ' + r.status)), 'error'); return; }
    const newId = (r.data && r.data.id);
    document.getElementById('si-manual-modal').remove();
    showToast('Черновик создан, добавьте позиции', 'success');
    if (newId) loadSupplyInvoiceDetail(newId);
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

// v2.45.312: forPayment=true — режим «Загрузить счёт на оплату»:
// распознавание не запускаем автоматически и не открываем экран приёмки УПД.
let siUploadForPayment = false;
function openSupplyInvoiceUpload(forPayment) {
  siUploadForPayment = !!forPayment;
  const existing = document.getElementById('si-upload-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'si-upload-modal';
  overlay.className = 'modal-overlay visible';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML =
    '<div class="modal" style="max-width:480px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-cloud-upload"></i>' + (forPayment ? 'Загрузить счёт' : 'Загрузить накладную') + '</h3>' +
        '<button class="icon-btn" onclick="document.getElementById(\'si-upload-modal\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="si-upload-zone" id="si-drop-zone" ondrop="siHandleDrop(event)" ondragover="event.preventDefault();this.classList.add(\'drag-over\')" ondragleave="this.classList.remove(\'drag-over\')" onclick="document.getElementById(\'si-file-input\').click()">' +
          '<i class="ti ti-cloud-upload"></i>' +
          '<div class="si-upload-zone-title">Перетащите PDF/фото сюда</div>' +
          '<div class="si-upload-zone-hint">или используйте кнопки ниже. До 25 МБ суммарно.</div>' +
        '</div>' +
        '<div class="si-upload-actions">' +
          '<button class="si-upload-action-btn primary" onclick="document.getElementById(\'si-camera-input\').click()">' +
            '<i class="ti ti-camera"></i>' +
            '<div>' +
              '<div class="si-upload-action-title">Сфотографировать</div>' +
              '<div class="si-upload-action-hint">прямо с камеры</div>' +
            '</div>' +
          '</button>' +
          '<button class="si-upload-action-btn" onclick="document.getElementById(\'si-file-input\').click()">' +
            '<i class="ti ti-file-upload"></i>' +
            '<div>' +
              '<div class="si-upload-action-title">Выбрать файл</div>' +
              '<div class="si-upload-action-hint">PDF, фото или Excel</div>' +
            '</div>' +
          '</button>' +
        '</div>' +
        '<input type="file" id="si-camera-input" accept="image/*" capture="environment" style="display:none;" onchange="siHandleFileSelect(event)">' +
        '<input type="file" id="si-file-input" multiple accept="image/*,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,.xlsx,.xls" style="display:none;" onchange="siHandleFileSelect(event)">' +
        '<div style="margin-top:14px;">' +
          '<label style="display:block;font-size:12.5px;color:var(--text-mid);margin-bottom:5px;"><i class="ti ti-file-text" style="font-size:13px;"></i> Договор клиента (необязательно)</label>' +
          '<select id="si-contract-select" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:white;color:var(--text-dark);">' +
            '<option value="">— Без договора —</option>' +
          '</select>' +
          '<div style="font-size:11.5px;color:var(--text-light);margin-top:4px;">Чтобы видеть, по какому договору/клиенту этот расход. Можно оставить «Без договора».</div>' +
        '</div>' +
        '<label style="display:flex;align-items:flex-start;gap:8px;margin-top:14px;padding:10px 12px;background:var(--bg);border-radius:8px;cursor:pointer;font-size:12.5px;line-height:1.4;color:var(--text-mid);">' +
          '<input type="checkbox" id="si-defer-recognize" style="margin-top:2px;flex-shrink:0;">' +
          '<span>' +
            '<b style="color:var(--text-dark);">Распознать позже</b><br>' +
            '<span style="color:var(--text-light);font-size:11.5px;">Удобно если фотографируете с телефона. Файл загрузится, а распознавание ИИ запустите вручную с компьютера.</span>' +
          '</span>' +
        '</label>' +
        '<div id="si-upload-status" style="margin-top:12px;font-size:12.5px;color:var(--text-light);text-align:center;"></div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  // На мобильной по умолчанию отмечаем "Распознать позже" — экономим токены и батарею телефона
  const isMobile = !!(state && !state.isDesktop);
  if (isMobile) {
    const cb = document.getElementById('si-defer-recognize');
    if (cb) cb.checked = true;
  }
  // Режим «счёт на оплату»: распознавание не запускаем, тумблер прячем
  if (forPayment) {
    const cb = document.getElementById('si-defer-recognize');
    if (cb) { cb.checked = true; const lbl = cb.closest('label'); if (lbl) lbl.style.display = 'none'; }
  }
  _siPopulateContractSelect();
}

// v2.45.311: список договоров клиентов в селектор «Договор» при загрузке счёта
async function _siPopulateContractSelect() {
  const sel = document.getElementById('si-contract-select');
  if (!sel) return;
  try {
    let contracts = (typeof cache !== 'undefined' && cache.contracts) || null;
    if (!contracts) {
      const d = await apiGet('/api/contracts?limit=500');
      contracts = d.contracts || [];
      if (typeof cache !== 'undefined') cache.contracts = contracts;
    }
    contracts.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = (c.number || ('#' + c.id)) + (c.contractor_name ? ' · ' + c.contractor_name : '');
      sel.appendChild(opt);
    });
  } catch (e) { /* без договора всё равно можно загрузить */ }
}

function siHandleDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files.length > 0) uploadSupplyInvoiceFiles(Array.from(files));
}
function siHandleFileSelect(e) {
  const files = e.target.files;
  if (files && files.length > 0) uploadSupplyInvoiceFiles(Array.from(files));
}

async function uploadSupplyInvoiceFiles(files) {
  const statusEl = document.getElementById('si-upload-status');
  const zone = document.getElementById('si-drop-zone');
  if (!files || !files.length) return;
  const forPayment = !!siUploadForPayment;
  const deferEl = document.getElementById('si-defer-recognize');
  // В режиме «счёт на оплату» распознавание УПД не запускаем автоматически
  const defer = forPayment ? true : !!(deferEl && deferEl.checked);
  const label = files.length === 1
    ? (defer ? 'Загружаем файл (без распознавания)...' : 'Загружаем файл...')
    : ('Загружаем ' + files.length + ' файла(ов)...');
  if (statusEl) statusEl.innerHTML = '<i class="ti ti-loader" style="animation:spin 1s linear infinite;"></i> ' + label;
  if (zone) zone.style.pointerEvents = 'none';

  const fd = new FormData();
  files.forEach(f => fd.append('file', f, f.name));
  if (defer) fd.append('defer_recognition', '1');
  // v2.45.311: договор клиента (если выбран в селекторе)
  const contractSel = document.getElementById('si-contract-select');
  if (contractSel && contractSel.value) fd.append('contract_id', contractSel.value);

  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      if (statusEl) statusEl.innerHTML = '<span style="color:#8C2A2A;">Сессия истекла, войдите заново</span>';
      if (zone) zone.style.pointerEvents = '';
      return;
    }
    const res = await fetch(API_BASE + '/api/supply/invoices/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: fd,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const msg = data.message || data.error || ('HTTP ' + res.status);
      if (statusEl) statusEl.innerHTML = '<span style="color:#8C2A2A;">Ошибка: ' + escapeHtml(msg) + '</span>';
      if (zone) zone.style.pointerEvents = '';
      return;
    }
    const data = await res.json();
    const invId = data.id;
    const modal = document.getElementById('si-upload-modal');
    if (modal) modal.remove();
    if (forPayment) {
      // Счёт на оплату: тихо кладём во «Входящие счета», НЕ открываем приёмку УПД
      siUploadForPayment = false;
      showToast('Счёт загружен во «Входящие счета» · отдел оплаты уведомлён', 'success');
      try { if (state.currentScreen === 'supply-invoice-intake') loadSupplyInvoicesList(); } catch (_) {}
      return;
    }
    showToast(defer ? 'Файл загружен · ожидает распознавания' : 'Файл загружен · распознаём', 'success');
    // Если загружали не с экрана приёмки (например, с «Заказы») — перейдём туда
    if (state && state.currentScreen === 'supply-invoice-intake') {
      loadSupplyInvoiceDetail(invId);
    } else {
      try { selectSidebarItem('supply-invoice-intake'); } catch (_) {}
      setTimeout(() => { try { loadSupplyInvoiceDetail(invId); } catch (_) {} }, 350);
    }
  } catch (e) {
    if (statusEl) statusEl.innerHTML = '<span style="color:#8C2A2A;">Ошибка соединения: ' + escapeHtml(String(e.message || e)) + '</span>';
    if (zone) zone.style.pointerEvents = '';
  }
}

// ---------- Detail-экран приёмки ----------

// v2.45.316: открыть исходный файл счёта (PDF/фото/Excel) в новой вкладке —
// бухгалтер открывает счёт, копирует номер, видит наименование.
async function openSupplyInvoiceFile(invId, page) {
  // окно открываем сразу в жесте пользователя (иначе блокирует попапы на телефоне)
  const w = window.open('', '_blank');
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const url = API_BASE + '/api/supply/invoices/' + invId + '/file' + (page ? ('?page=' + page) : '');
    const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    if (!res.ok) {
      if (w) w.close();
      const d = await res.json().catch(() => ({}));
      showToast(d.message || 'Не удалось открыть файл', 'error');
      return;
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    if (w) w.location = blobUrl; else window.location = blobUrl;
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  } catch (e) {
    if (w) w.close();
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

async function loadSupplyInvoiceDetail(invoiceId) {
  siState.currentInvoiceId = invoiceId;
  siStopPolling();
  const body = document.getElementById('si-screen-body');
  if (!body) return;
  body.innerHTML = '<div class="loading-block">Загружаем приёмку…</div>';

  try {
    const data = await apiGet('/api/supply/invoices/' + invoiceId);
    // Параллельно подгружаем категории если ещё не закешированы (для inline-select раздела)
    await siEnsureCategoriesLoaded();
    renderSupplyInvoiceDetail(data);
    // Polling только если идёт распознавание (in_progress). Pending/done/error — не поллим.
    if (data.invoice && data.invoice.recognition_state === 'in_progress') {
      siStartPolling(invoiceId);
    }
  } catch (e) {
    body.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i><h3>Ошибка</h3><p>' + escapeHtml(String(e.message || e)) + '</p></div>';
  }
}

function siStartPolling(invoiceId) {
  if (siState.pollingActive) return;
  siState.pollingActive = true;
  const tick = async () => {
    if (siState.currentInvoiceId !== invoiceId || !siState.pollingActive) return;
    try {
      const data = await apiGet('/api/supply/invoices/' + invoiceId);
      // Re-render если что-то изменилось
      renderSupplyInvoiceDetail(data);
      if (data.invoice && data.invoice.recognition_state !== 'in_progress') {
        siStopPolling();
        return;
      }
    } catch (e) { /* пропускаем */ }
    if (siState.pollingActive) siState.pollingTimer = setTimeout(tick, 3000);
  };
  siState.pollingTimer = setTimeout(tick, 3000);
}
function siStopPolling() {
  siState.pollingActive = false;
  if (siState.pollingTimer) { clearTimeout(siState.pollingTimer); siState.pollingTimer = null; }
}

function renderSupplyInvoiceDetail(data) {
  const body = document.getElementById('si-screen-body');
  if (!body) return;
  const inv = data.invoice || {};
  const items = data.items || [];
  const duplicate = data.duplicate_warning;
  siState.itemsCache = items;
  siState.currentInvoice = inv;  // нужно для renderSiItemsTable: показывать кнопку "+ позиция" только для draft
  siState.currentData = data;    // для повторного рендера из bulk-handlers

  const recoState = inv.recognition_state || (inv.ai_recognized_at ? 'done' : (inv.ai_error ? 'error' : 'in_progress'));
  const isLoading = recoState === 'in_progress';
  const isPending = recoState === 'pending';
  const recoTime = inv.ai_recognized_at ? siRecoSeconds(inv) : null;

  let html = '';
  // Шапка с кнопкой Назад
  html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">';
  html +=   '<button class="pkb-btn" onclick="loadSupplyInvoicesList()"><i class="ti ti-arrow-left"></i>К списку</button>';
  html +=   '<div style="flex:1;"></div>';
  html +=   '<button class="pkb-btn primary" onclick="openSupplyInvoiceFile(' + inv.id + ')"><i class="ti ti-eye"></i>Открыть счёт</button>';
  if (inv.status === 'draft') {
    html += '<button class="pkb-btn" onclick="deleteSupplyInvoice(' + inv.id + ')"><i class="ti ti-trash"></i>Удалить</button>';
  } else if (inv.status === 'confirmed' || inv.status === 'partially_refused') {
    html += '<button class="pkb-btn" style="color:#8C2A2A;" onclick="deleteConfirmedSupplyInvoice(' + inv.id + ')"><i class="ti ti-arrow-back-up"></i>Отменить оприходование</button>';
  }
  html += '</div>';

  // Шапка приёмки — заголовок зависит от статуса
  const titlePrefix = (inv.status === 'confirmed') ? 'Приёмка'
                    : (inv.status === 'partially_refused') ? 'Приёмка (с отказами)'
                    : (inv.status === 'cancelled') ? 'Отменённая приёмка'
                    : 'Черновик приёмки';
  html += '<div class="si-detail-header">';
  html +=   '<div>';
  html +=     '<div style="font-size:11px;color:var(--text-light);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Снабжение / приёмка</div>';
  html +=     '<h2 style="margin:4px 0 2px;">' + titlePrefix + (inv.document_number ? (' · УПД №' + escapeHtml(inv.document_number)) : '') + '</h2>';
  html +=     '<div style="font-size:12px;color:var(--text-faint);">' +
                (inv.source_file_name ? ('файл: ' + escapeHtml(inv.source_file_name)) : '') +
                (inv.confirmed_at ? (' · оприходовано ' + siFmtDateTime(inv.confirmed_at)) : '') +
              '</div>';
  html +=   '</div>';
  if (isLoading) {
    html += '<div class="si-ai-badge recognizing"><i class="ti ti-sparkles"></i>Распознаём…</div>';
  } else if (isPending) {
    html += '<div class="si-ai-badge pending"><i class="ti ti-hourglass"></i>Ждёт распознавания</div>';
  } else if (inv.ai_error) {
    html += '<div class="si-ai-badge" style="background:rgba(226,75,74,0.15);color:#8C2A2A;"><i class="ti ti-alert-triangle"></i>Ошибка ИИ</div>';
  } else if (recoTime) {
    html += '<div class="si-ai-badge"><i class="ti ti-sparkles"></i>распознано за ' + recoTime + ' сек</div>';
  }
  html += '</div>';

  // Состояние "ожидает распознавания" (загружено с галкой «Распознать позже»)
  if (isPending) {
    const pages = inv.pages_count || 1;
    const pagesLabel = pages === 1 ? '1 страница' : (pages + ' страниц');
    html += '<div style="background:rgba(124,58,237,0.06);border:1px dashed rgba(124,58,237,0.35);border-radius:10px;padding:24px 20px;text-align:center;margin:8px 0 14px;">';
    html +=   '<i class="ti ti-photo-scan" style="font-size:36px;color:#7C3AED;display:block;margin-bottom:10px;"></i>';
    html +=   '<div style="font-size:14px;font-weight:500;color:var(--text-dark);margin-bottom:4px;">Файл загружен и ждёт распознавания · ' + pagesLabel + '</div>';
    html +=   '<div style="font-size:12px;color:var(--text-light);margin-bottom:14px;">' +
                 (inv.source_file_name ? escapeHtml(inv.source_file_name) : 'без имени') +
              '</div>';
    html +=   '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">';
    html +=     '<button class="pkb-btn" onclick="openSiAddPageDialog(' + inv.id + ')"><i class="ti ti-plus"></i>Добавить страницу</button>';
    html +=     '<button class="pkb-btn ai-action" onclick="rerecognizeSupplyInvoice(' + inv.id + ')"><i class="ti ti-sparkles"></i>Распознать сейчас</button>';
    html +=   '</div>';
    html += '</div>';
    body.innerHTML = html;
    return;
  }

  // Состояние "распознаём" — большой блок с анимированными этапами + скелетон-строки таблицы
  if (isLoading) {
    html += '<div class="si-reco-stage-block">';
    html +=   '<div class="si-reco-header">';
    html +=     '<div class="si-reco-icon-big"><i class="ti ti-sparkles"></i></div>';
    html +=     '<div>';
    html +=       '<div class="si-reco-title">Claude анализирует накладную</div>';
    html +=       '<div class="si-reco-sub">обычно 15–30 секунд · экран обновится автоматически</div>';
    html +=     '</div>';
    html +=   '</div>';
    html +=   '<div class="si-reco-stages">';
    html +=     '<div class="si-reco-stage"><span class="si-stage-dot"></span>Извлечение реквизитов поставщика и документа</div>';
    html +=     '<div class="si-reco-stage"><span class="si-stage-dot"></span>Распознавание позиций накладной</div>';
    html +=     '<div class="si-reco-stage"><span class="si-stage-dot"></span>Сопоставление с каталогом комплектующих</div>';
    html +=   '</div>';
    html += '</div>';

    // Скелетон таблицы позиций (фиолетовый, в тон блока) — добавляет ритм
    html += '<div class="si-skeleton-wrap">';
    html +=   '<div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--bg-card);">';
    const widths = ['80%', '58%', '70%', '46%', '63%'];
    for (let i = 0; i < widths.length; i++) {
      html += '<div class="si-skel-row">';
      html +=   '<div class="si-skel" style="height:10px;width:10px;border-radius:50%;"></div>';
      html +=   '<div>';
      html +=     '<div class="si-skel" style="height:13px;width:' + widths[i] + ';margin-bottom:5px;"></div>';
      html +=     '<div class="si-skel" style="height:10px;width:35%;"></div>';
      html +=   '</div>';
      html +=   '<div class="si-skel" style="height:13px;width:50px;justify-self:end;"></div>';
      html +=   '<div class="si-skel" style="height:30px;"></div>';
      html +=   '<div class="si-skel" style="height:24px;width:24px;border-radius:6px;"></div>';
      html += '</div>';
    }
    html +=   '</div>';
    html += '</div>';
    body.innerHTML = html;
    return;
  }

  // Ошибка ИИ
  if (inv.ai_error) {
    html += '<div class="pkb-form-error" style="margin:12px 0;"><i class="ti ti-alert-triangle"></i>' + escapeHtml(inv.ai_error) + '</div>';
    html += '<button class="pkb-btn ai-action" onclick="rerecognizeSupplyInvoice(' + inv.id + ')"><i class="ti ti-refresh"></i>Попробовать ещё раз</button>';
    body.innerHTML = html;
    return;
  }

  // Предупреждение о дубликате
  if (duplicate) {
    html += '<div style="background:rgba(226,75,74,0.10);border:1px solid rgba(226,75,74,0.3);border-radius:8px;padding:12px;margin-bottom:14px;color:#8C2A2A;">';
    html +=   '<b><i class="ti ti-alert-triangle"></i> Похоже на дубликат</b><br>';
    html +=   'УПД №' + escapeHtml(inv.document_number || '?') + ' от ' + escapeHtml(siFmtDate(inv.document_date)) +
              ' уже оприходована (приёмка #' + duplicate.id + ', ' + escapeHtml(siFmtDateTime(duplicate.confirmed_at)) + ').';
    html += '</div>';
  }

  // 3 карточки реквизитов
  html += renderSiRequisites(inv);

  // Предупреждения ИИ (без цен/НДС)
  const warnings = siParseWarnings(inv.ai_warnings);
  if (warnings.length) html += renderSiWarnings(warnings);

  // Сводка по местам назначения
  html += renderSiDestTiles(items);

  // Таблица позиций
  html += renderSiItemsTable(items);

  // Нижняя панель
  const acceptedCount = items.filter(it => !it.is_refused && (parseFloat(it.qty) || 0) > 0).length;
  const totalCount = items.filter(it => parseFloat(it.qty) > 0 || (parseFloat(it.qty) === 0 && it.is_refused)).length;
  html += '<div class="si-bottom-bar">';
  html +=   '<div class="si-bottom-stat"><span style="color:var(--text-dark);font-weight:600;">' + acceptedCount + '</span> из ' + items.length + ' позиций к оприходованию</div>';
  html +=   '<div style="display:flex;gap:8px;">';
  if (inv.status === 'draft') {
    html += '<button class="pkb-btn" onclick="loadSupplyInvoicesList()">Сохранить черновик</button>';
    html += '<button class="pkb-btn primary" style="background:#1D9E75;" onclick="confirmSupplyInvoice(' + inv.id + ')"><i class="ti ti-check"></i>Оприходовать и закрыть УПД</button>';
  } else {
    html += '<span class="si-status-chip ' + siStatusChipClass(inv.status) + '">' + escapeHtml(siStatusLabel(inv.status)) + '</span>';
  }
  html +=   '</div>';
  html += '</div>';

  // Легенда
  html += '<div style="display:flex;gap:14px;justify-content:center;font-size:11px;color:var(--text-faint);margin-top:10px;flex-wrap:wrap;">';
  html +=   '<span style="display:inline-flex;align-items:center;gap:5px;"><span class="si-conf-dot high"></span>высокая уверенность</span>';
  html +=   '<span style="display:inline-flex;align-items:center;gap:5px;"><span class="si-conf-dot medium"></span>средняя — уточните</span>';
  html +=   '<span style="display:inline-flex;align-items:center;gap:5px;"><span class="si-conf-dot low"></span>низкая — нет в базе</span>';
  html += '</div>';

  body.innerHTML = html;
}

function siRecoSeconds(inv) {
  if (!inv.created_at || !inv.ai_recognized_at) return null;
  try {
    const a = new Date(inv.created_at.replace(' ', 'T') + 'Z').getTime();
    const b = new Date(inv.ai_recognized_at.replace(' ', 'T') + 'Z').getTime();
    return Math.max(1, Math.round((b - a) / 1000));
  } catch (e) { return null; }
}
function siParseWarnings(raw) {
  if (!raw) return [];
  try {
    const a = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}

function renderSiRequisites(inv) {
  let html = '<div class="si-req-grid">';
  html +=   '<div class="si-req-card">';
  html +=     '<div class="si-req-label">Поставщик</div>';
  html +=     '<div class="si-req-value">' + escapeHtml(inv.supplier_name_raw || '—') + '</div>';
  html +=     '<div class="si-req-meta">' + (inv.supplier_inn ? ('ИНН ' + escapeHtml(inv.supplier_inn)) : '') + '</div>';
  html +=   '</div>';
  html +=   '<div class="si-req-card">';
  html +=     '<div class="si-req-label">Документ</div>';
  html +=     '<div class="si-req-value">' + escapeHtml(siFmtDocType(inv.document_type)) + ' №' + escapeHtml(inv.document_number || '—') + '</div>';
  html +=     '<div class="si-req-meta">' + (inv.document_date ? ('от ' + siFmtDate(inv.document_date)) : '') + '</div>';
  html +=   '</div>';
  html +=   '<div class="si-req-card">';
  html +=     '<div class="si-req-label">Основание</div>';
  if (inv.contract_id && inv.contract_number) {
    html += '<div class="si-req-value">Договор №' + escapeHtml(inv.contract_number) + '</div>';
    html += '<div class="si-req-meta">найден ✓ ' + (inv.contract_contractor_name ? escapeHtml(inv.contract_contractor_name) : '') + '</div>';
  } else if (inv.contract_number_raw) {
    html += '<div class="si-req-value">№' + escapeHtml(inv.contract_number_raw) + (inv.contract_date_raw ? (' от ' + siFmtDate(inv.contract_date_raw)) : '') + '</div>';
    html += '<div class="si-req-meta" style="color:#854F0B;">не найден в базе</div>';
  } else {
    html += '<div class="si-req-value">—</div>';
    html += '<div class="si-req-meta">не указано</div>';
  }
  html +=   '</div>';
  html += '</div>';
  return html;
}

function renderSiWarnings(warnings) {
  let html = '<div class="si-warnings">';
  html +=   '<div class="si-warnings-title"><i class="ti ti-alert-triangle"></i>Предупреждения ИИ (' + warnings.length + ')</div>';
  warnings.forEach(w => {
    html += '<div class="si-warning-row">⚠ ' + escapeHtml(w) + '</div>';
  });
  html += '</div>';
  return html;
}

function renderSiDestTiles(items) {
  const buckets = { production: 0, tools: 0, order: 0, refused: 0, other: 0 };
  items.forEach(it => {
    if (parseFloat(it.qty) === 0 && it.split_parent_id) return;
    if (it.is_refused) { buckets.refused++; return; }
    const d = it.destination;
    if (d === 'production' || d === 'finished_warehouse') buckets.production++;
    else if (d === 'tools') buckets.tools++;
    else if (d === 'order') buckets.order++;
    else if (d === 'refused') buckets.refused++;
    else buckets.other++;
  });

  let html = '<div class="si-dest-tiles">';
  html +=   '<div class="si-dest-tile d-production">';
  html +=     '<div class="si-dest-tile-head"><i class="ti ti-building-factory-2"></i>Производство</div>';
  html +=     '<div class="si-dest-tile-count">' + buckets.production + (buckets.production === 1 ? ' позиция' : ' позиций') + '</div>';
  html +=   '</div>';
  html +=   '<div class="si-dest-tile d-tools">';
  html +=     '<div class="si-dest-tile-head"><i class="ti ti-tool"></i>Инструмент</div>';
  html +=     '<div class="si-dest-tile-count">' + buckets.tools + (buckets.tools === 1 ? ' позиция' : ' позиций') + '</div>';
  html +=   '</div>';
  html +=   '<div class="si-dest-tile d-order">';
  html +=     '<div class="si-dest-tile-head"><i class="ti ti-target"></i>На заказ</div>';
  html +=     '<div class="si-dest-tile-count">' + buckets.order + (buckets.order === 1 ? ' позиция' : ' позиций') + '</div>';
  html +=   '</div>';
  html +=   '<div class="si-dest-tile d-refused">';
  html +=     '<div class="si-dest-tile-head"><i class="ti ti-circle-x"></i>Не принять</div>';
  html +=     '<div class="si-dest-tile-count">' + (buckets.refused ? buckets.refused + (buckets.refused === 1 ? ' позиция' : ' позиций') : '—') + '</div>';
  html +=   '</div>';
  html += '</div>';
  return html;
}

// Быстрое редактирование qty прямо в строке через prompt
async function openSiQtyEditPrompt(itemId, currentQty) {
  const newQtyStr = prompt('Новое количество (через точку, например 12 или 3.5):', String(currentQty || '').replace(/\s/g, ''));
  if (newQtyStr === null) return;  // отмена
  const newQty = parseFloat(newQtyStr.replace(',', '.').replace(/\s/g, ''));
  if (isNaN(newQty) || newQty < 0) {
    showToast('Некорректное число', 'error');
    return;
  }
  // No-op защита: если не изменилось — просто закрываем без запроса
  if (parseFloat(currentQty) === newQty) {
    return;
  }
  const invoiceId = siState.currentInvoiceId;
  if (!invoiceId) { showToast('Нет открытой УПД', 'error'); return; }
  try {
    await apiPatch('/api/supply/invoices/' + invoiceId + '/items/' + itemId, { qty: newQty });
    showToast('Кол-во обновлено', 'success');
    loadSupplyInvoiceDetail(invoiceId);
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

// v2.45.619: правка фасовки (штук в упаковке) — если распозналось криво.
// Приход в штуки = кол-во упаковок × эта фасовка.
async function openSiPackEditPrompt(itemId, currentPack) {
  const s = prompt('Штук в одной упаковке (например 100):', String(currentPack || '').replace(/\s/g, ''));
  if (s === null) return;
  const v = parseFloat(String(s).replace(',', '.').replace(/\s/g, ''));
  if (isNaN(v) || v <= 0) { showToast('Некорректное число', 'error'); return; }
  const invoiceId = siState.currentInvoiceId;
  if (!invoiceId) { showToast('Нет открытой УПД', 'error'); return; }
  try {
    await apiPatch('/api/supply/invoices/' + invoiceId + '/items/' + itemId, { pack_size: v });
    showToast('Фасовка обновлена: ' + v + ' шт/упак', 'success');
    loadSupplyInvoiceDetail(invoiceId);
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

// Быстрое редактирование name (полное название позиции) — если Claude распознал криво
async function openSiNameEditPrompt(itemId, currentName) {
  const newName = prompt('Название позиции:', currentName || '');
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed) {
    showToast('Название не может быть пустым', 'error');
    return;
  }
  // No-op защита: если не изменилось — закрываем
  if (trimmed === (currentName || '').trim()) {
    return;
  }
  const invoiceId = siState.currentInvoiceId;
  if (!invoiceId) { showToast('Нет открытой УПД', 'error'); return; }
  try {
    await apiPatch('/api/supply/invoices/' + invoiceId + '/items/' + itemId, { name_raw: trimmed });
    showToast('Название обновлено', 'success');
    loadSupplyInvoiceDetail(invoiceId);
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

function renderSiItemsTable(items) {
  // Скрываем split-parent (qty=0) когда есть дети
  const visible = items.filter(it => !(parseFloat(it.qty) === 0 && !it.is_refused));
  if (!siState.selected) siState.selected = new Set();
  // подчистим selected от исчезнувших id
  const visibleIds = new Set(visible.map(it => it.id));
  for (const id of Array.from(siState.selected)) {
    if (!visibleIds.has(id)) siState.selected.delete(id);
  }

  let html = '';
  // Bulk-bar — появляется когда что-то выбрано
  html += renderSiBulkBar(visible);

  html += '<div class="si-items-table">';
  // Шапка с чекбоксом «выбрать все»
  const allSelected = visible.length > 0 && visible.every(it => siState.selected.has(it.id));
  html += '<div class="si-items-row si-items-row-head">';
  html +=   '<div class="si-row-check">' +
              '<input type="checkbox" id="si-check-all"' + (allSelected ? ' checked' : '') +
              ' onchange="siToggleAllSelect(this.checked)">' +
              '<label for="si-check-all" title="Выбрать все"></label>' +
            '</div>';
  html +=   '<div></div>';
  html +=   '<div>Позиция</div>';
  html +=   '<div style="text-align:right;">Кол-во</div>';
  html +=   '<div>Куда</div>';
  html +=   '<div></div>';
  html += '</div>';

  visible.forEach(it => html += renderSiItemRow(it));
  html += '</div>';

  // Кнопка "+ Добавить позицию" — только для draft
  // (для confirmed позиции уже зафиксированы, для cancelled тоже нельзя)
  const inv = siState.currentInvoice;
  const canAdd = !inv || inv.status === 'draft';
  if (canAdd) {
    html += '<div style="margin-top:10px;text-align:center;">' +
              '<button class="btn btn-secondary" onclick="openAddManualItemForm()" style="border-style:dashed;">' +
                '<i class="ti ti-plus"></i> Добавить позицию вручную' +
              '</button>' +
            '</div>';
  }
  return html;
}

function renderSiItemRow(it) {
  const confKey = it.is_refused ? 'refused' : (it.match_confidence || 'low');
  const dotCls = it.is_refused ? 'refused' : confKey;
  const isWarn = it.match_confidence === 'medium' || it.match_confidence === 'low';
  const isSel  = siState.selected && siState.selected.has(it.id);
  const rowCls = 'si-items-row' + (it.is_refused ? ' is-refused' : '') + (isWarn && !it.is_refused ? ' is-warn' : '') + (isSel ? ' is-selected' : '');

  let html = '<div class="' + rowCls + '">';
  // checkbox для bulk-выбора
  html += '<div class="si-row-check">' +
            '<input type="checkbox" id="si-check-' + it.id + '"' + (isSel ? ' checked' : '') +
            ' onchange="siToggleItemSelect(' + it.id + ', this.checked)">' +
            '<label for="si-check-' + it.id + '"></label>' +
          '</div>';
  // confidence dot
  html += '<div><span class="si-conf-dot ' + dotCls + '"></span></div>';
  // name + hint
  html += '<div>';
  if (it.is_refused) {
    html +=   '<div style="font-size:13px;text-decoration:line-through;">' + escapeHtml(it.name_raw || '—') + '</div>';
  } else {
    // Кликабельное имя — Дмитрий может исправить если Claude распознал криво
    html +=   '<div style="font-size:13px;cursor:pointer;border-bottom:1px dashed transparent;" ' +
                  'title="Нажмите чтобы исправить название" ' +
                  'onclick="openSiNameEditPrompt(' + it.id + ', this.textContent)">' +
                  escapeHtml(it.name_raw || '—') +
              '</div>';
  }
  const hint = renderSiMatchHint(it);
  if (hint) html += '<div class="si-item-hint">' + hint + '</div>';
  html += '</div>';
  // qty — кликабельный для редактирования
  const qty = pkbFmtQty(it.qty);
  const unit = it.unit || '';
  const qtyTitle = it.is_refused ? '' : ' title="Нажмите чтобы изменить количество"';
  const qtyStyle = 'text-align:right;font-variant-numeric:tabular-nums;' +
                   (it.is_refused ? 'text-decoration:line-through;' : 'cursor:pointer;border-bottom:1px dashed transparent;') ;
  const qtyAttr = it.is_refused ? '' : ' onclick="openSiQtyEditPrompt(' + it.id + ',\'' + qty + '\')"';
  // v2.45.619: если строка в упаковках и известна фасовка — показываем перевод
  // «= N шт (×фасовка)» под количеством. Клик по нему правит фасовку.
  const packEff = Number(it.pack_effective || 1);
  const packLine = (!it.is_refused && packEff > 1)
    ? '<div style="font-size:11px;color:#065F46;font-weight:700;cursor:pointer;margin-top:2px;white-space:nowrap;" ' +
        'title="Штук в упаковке — нажмите, чтобы поправить" ' +
        'onclick="event.stopPropagation();openSiPackEditPrompt(' + it.id + ',' + packEff + ')">' +
        '= ' + pkbFmtQty(it.qty_base) + ' шт <span style="color:var(--text-faint);font-weight:400;">(×' + pkbFmtQty(packEff) + ')</span></div>'
    : '';
  html += '<div style="text-align:right;">' +
            '<div style="' + qtyStyle + '"' + qtyTitle + qtyAttr + '>' + qty + ' ' + escapeHtml(unit) + '</div>' +
            packLine +
          '</div>';
  // destination select
  html += '<div>' + renderSiDestSelect(it) + '</div>';
  // actions: split
  html += '<div>';
  if (!it.is_refused) {
    html += '<button class="icon-btn" onclick="openSupplyItemSplitModal(' + it.id + ')" title="Разделить позицию"><i class="ti ti-arrows-split"></i></button>';
  }
  html += '</div>';

  html += '</div>';
  return html;
}

function renderSiMatchHint(it) {
  if (it.is_refused) {
    const r = SI_REFUSE_REASONS.find(x => x.key === it.refuse_reason);
    return '<span style="color:#8C2A2A;">✕ Отказ: ' + escapeHtml(r ? r.label : (it.refuse_reason || 'причина не указана')) + '</span>';
  }
  // Подсказка с категорией: показываем, в какой раздел склада попадёт компонент
  const catSuffix = it.matched_category_name
    ? ' <span style="color:var(--text-faint);">· раздел: ' + escapeHtml(it.matched_category_name) + '</span>'
    : '';
  if (it.match_confidence === 'high' && it.matched_name) {
    const viaAlias = it.via_alias ? ' · из истории' : '';
    return '<span style="color:var(--text-faint);">✓ ' + escapeHtml(it.matched_name) + viaAlias + catSuffix + '</span>';
  }
  if (it.match_confidence === 'medium') {
    const alt = siParseAlternatives(it.match_alternatives);
    const cnt = alt.length || 2;
    return '<span style="color:#854F0B;cursor:pointer;" onclick="openMatchAlternativesModal(' + it.id + ')">? ' + cnt + ' варианта · нажмите чтобы выбрать</span>';
  }
  // Нет сопоставления
  if (!it.matched_component_id) {
    // Для destination='production' (по умолчанию) — даём Дмитрию dropdown категорий
    const dest = it.destination || 'production';
    if (dest === 'production') {
      const cats = (siState && siState.categories) || [];
      // suggested_category_id может быть null — это означает "Разное" (default)
      const currentId = it.suggested_category_id || '';
      let opts = '<option value="">— Разное (по умолчанию)</option>';
      cats.forEach(c => {
        const sel = (String(c.id) === String(currentId)) ? ' selected' : '';
        // "Разное" уже отдельной опцией наверху — не дублируем
        if ((c.code || '').toLowerCase() === 'misc' || (c.name || '').toLowerCase() === 'разное') return;
        opts += '<option value="' + c.id + '"' + sel + '>' + escapeHtml(c.name) + '</option>';
      });
      return (
        '<span style="color:var(--text-faint);display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
          '<span>→ создастся в разделе:</span>' +
          '<select class="si-cat-select" onchange="siChangeItemCategory(' + it.id + ', this.value)" onclick="event.stopPropagation();">' +
            opts +
          '</select>' +
        '</span>'
      );
    }
    // Для других destination (tools/order/...) — пока не создаём авто
    return '<span style="color:#A32D2D;">+ нет в базе — оприходовать в этот раздел пока нельзя</span>';
  }
  return '<span style="color:var(--text-faint);">' + escapeHtml(it.matched_name || '—') + catSuffix + '</span>';
}

function siParseAlternatives(raw) {
  if (!raw) return [];
  try {
    const a = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}

function renderSiBulkBar(visible) {
  const sel = siState.selected;
  if (!sel || sel.size === 0) return '';
  // Защищаемся от случая, когда выбраны только отказанные позиции — их перенести нельзя
  const selectable = visible.filter(it => sel.has(it.id) && !it.is_refused);
  if (!selectable.length) return '';
  const count = selectable.length;
  // Опции для перевода — без refused (для отказов есть свой dropdown)
  let opts = '';
  Object.keys(SI_DEST_DEF).forEach(k => {
    if (k === 'refused') return;
    opts += '<option value="' + k + '">' + SI_DEST_DEF[k].label + '</option>';
  });
  // v2.45.141: массовое проставление РАЗДЕЛА (категории) выбранным позициям —
  // удобно когда вся УПД от одного поставщика одной тематики (напр. сантехника).
  const cats = (siState && siState.categories) || [];
  let catOpts = '<option value="">Раздел: Разное</option>';
  cats.forEach(c => {
    if ((c.code || '').toLowerCase() === 'misc' || (c.name || '').toLowerCase() === 'разное') return;
    catOpts += '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
  });
  return (
    '<div class="si-bulk-bar">' +
      '<i class="ti ti-checks" style="color:var(--brand);font-size:16px;"></i>' +
      '<span>Выбрано <span class="si-bulk-bar-count">' + count + '</span> позиций · Перенести в:</span>' +
      '<select id="si-bulk-dest">' + opts + '</select>' +
      '<button class="si-bulk-bar-apply" onclick="siApplyBulkDestination()"><i class="ti ti-arrow-right"></i>Применить</button>' +
      '<span style="opacity:.5;">|</span>' +
      '<select id="si-bulk-cat" title="Создавать выбранные позиции в этом разделе склада">' + catOpts + '</select>' +
      '<button class="si-bulk-bar-apply" onclick="siApplyBulkCategory()" style="background:#0C4A6E;"><i class="ti ti-folder"></i>Задать раздел</button>' +
      '<button class="si-bulk-bar-clear" onclick="siClearSelection()">Снять выбор</button>' +
    '</div>'
  );
}

function siToggleItemSelect(itemId, checked) {
  if (!siState.selected) siState.selected = new Set();
  if (checked) siState.selected.add(itemId);
  else siState.selected.delete(itemId);
  if (siState.currentData) renderSupplyInvoiceDetail(siState.currentData);
}

function siToggleAllSelect(checked) {
  if (!siState.selected) siState.selected = new Set();
  const items = (siState.currentData && siState.currentData.items) || siState.itemsCache || [];
  const selectable = items.filter(it =>
    !(parseFloat(it.qty) === 0 && !it.is_refused) && !it.is_refused
  );
  if (checked) selectable.forEach(it => siState.selected.add(it.id));
  else         selectable.forEach(it => siState.selected.delete(it.id));
  if (siState.currentData) renderSupplyInvoiceDetail(siState.currentData);
}

function siClearSelection() {
  if (siState.selected) siState.selected.clear();
  if (siState.currentData) renderSupplyInvoiceDetail(siState.currentData);
}

async function siApplyBulkDestination() {
  const invoiceId = siState.currentInvoiceId;
  if (!invoiceId) return;
  if (!siState.selected || !siState.selected.size) return;
  const destSelect = document.getElementById('si-bulk-dest');
  const dest = destSelect ? destSelect.value : 'production';
  if (!dest || dest === 'refused') {
    showToast('Для «Не принять» используй индивидуальный выбор причины', 'error');
    return;
  }
  const ids = Array.from(siState.selected);
  const applyBtn = document.querySelector('.si-bulk-bar-apply');
  if (applyBtn) applyBtn.disabled = true;
  let ok = 0, failed = 0;
  for (const id of ids) {
    try {
      await apiPatch('/api/supply/invoices/' + invoiceId + '/items/' + id, {
        destination: dest,
        is_refused: false,
        refuse_reason: null,
      });
      ok++;
    } catch (_) {
      failed++;
    }
  }
  // снимем выбор и перезагрузим
  siState.selected.clear();
  try {
    const data = await apiGet('/api/supply/invoices/' + invoiceId);
    renderSupplyInvoiceDetail(data);
  } catch (_) {}
  const label = SI_DEST_DEF[dest] ? SI_DEST_DEF[dest].label : dest;
  if (failed === 0) showToast('Перенесено в «' + label + '»: ' + ok, 'success');
  else if (ok === 0) showToast('Не удалось обновить позиции', 'error');
  else showToast('Перенесено: ' + ok + ', не удалось: ' + failed, 'warning');
}

// v2.45.141: массово проставить РАЗДЕЛ (категорию) выбранным позициям
async function siApplyBulkCategory() {
  const invoiceId = siState.currentInvoiceId;
  if (!invoiceId) return;
  if (!siState.selected || !siState.selected.size) return;
  const catSelect = document.getElementById('si-bulk-cat');
  const catVal = catSelect ? catSelect.value : '';
  const catId = catVal ? parseInt(catVal, 10) : null;
  const ids = Array.from(siState.selected);
  const btns = document.querySelectorAll('.si-bulk-bar-apply');
  btns.forEach(b => b.disabled = true);
  let ok = 0, failed = 0;
  for (const id of ids) {
    try {
      await apiPatch('/api/supply/invoices/' + invoiceId + '/items/' + id,
                     { suggested_category_id: catId });
      ok++;
    } catch (_) {
      failed++;
    }
  }
  siState.selected.clear();
  try {
    const data = await apiGet('/api/supply/invoices/' + invoiceId);
    renderSupplyInvoiceDetail(data);
  } catch (_) {}
  const catName = catId
    ? (((siState.categories || []).find(c => String(c.id) === String(catId)) || {}).name || 'раздел')
    : 'Разное';
  if (failed === 0) showToast('Раздел «' + catName + '» проставлен: ' + ok, 'success');
  else if (ok === 0) showToast('Не удалось обновить позиции', 'error');
  else showToast('Обновлено: ' + ok + ', не удалось: ' + failed, 'warning');
}

function renderSiDestSelect(it) {
  const current = it.is_refused ? 'refused' : (it.destination || 'production');
  const def = SI_DEST_DEF[current] || SI_DEST_DEF.production;
  let html = '<select class="si-dest-select ' + def.cls + '" onchange="changeSupplyItemDestination(' + it.id + ', this.value)">';
  Object.keys(SI_DEST_DEF).forEach(k => {
    const d = SI_DEST_DEF[k];
    const sel = k === current ? ' selected' : '';
    html += '<option value="' + k + '"' + sel + '>' + d.label + '</option>';
  });
  html += '</select>';
  return html;
}

// ---------- Действия с позициями ----------

async function changeSupplyItemDestination(itemId, newDest) {
  const invoiceId = siState.currentInvoiceId;
  if (!invoiceId) return;

  // Особый случай: refused → открыть модалку причины
  if (newDest === 'refused') {
    openSupplyItemRefuseModal(itemId);
    return;
  }

  try {
    await apiPatch('/api/supply/invoices/' + invoiceId + '/items/' + itemId, {
      destination: newDest,
      is_refused: false,
      refuse_reason: null,
    });
    // Обновляем detail без полного reload — экран обновится сам через render
    const data = await apiGet('/api/supply/invoices/' + invoiceId);
    renderSupplyInvoiceDetail(data);
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

function openSupplyItemRefuseModal(itemId) {
  const existing = document.getElementById('si-refuse-modal');
  if (existing) existing.remove();

  let optsHtml = '';
  SI_REFUSE_REASONS.forEach(r => {
    optsHtml += '<div class="si-reason-opt" onclick="submitSupplyItemRefuse(' + itemId + ', \'' + r.key + '\')">' +
                  '<i class="ti ' + r.icon + '"></i>' + escapeHtml(r.label) +
                '</div>';
  });

  const overlay = document.createElement('div');
  overlay.id = 'si-refuse-modal';
  overlay.className = 'modal-overlay visible';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML =
    '<div class="modal" style="max-width:440px;">' +
      '<div class="modal-header"><h3><i class="ti ti-circle-x"></i>Причина отказа</h3>' +
      '<button class="icon-btn" onclick="document.getElementById(\'si-refuse-modal\').remove()"><i class="ti ti-x"></i></button></div>' +
      '<div class="modal-body">' +
        '<div class="si-reason-grid">' + optsHtml + '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
}

async function submitSupplyItemRefuse(itemId, reason) {
  const invoiceId = siState.currentInvoiceId;
  if (!invoiceId) return;
  document.getElementById('si-refuse-modal').remove();
  try {
    await apiPatch('/api/supply/invoices/' + invoiceId + '/items/' + itemId, {
      is_refused: true,
      destination: 'refused',
      refuse_reason: reason,
    });
    const data = await apiGet('/api/supply/invoices/' + invoiceId);
    renderSupplyInvoiceDetail(data);
    showToast('Позиция отмечена как отказ', 'success');
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

function openSupplyItemSplitModal(itemId) {
  const it = siState.itemsCache.find(x => x.id === itemId);
  if (!it) return;
  const existing = document.getElementById('si-split-modal');
  if (existing) existing.remove();

  const maxQty = parseFloat(it.qty) || 0;

  let reasonsHtml = '';
  SI_REFUSE_REASONS.forEach((r, i) => {
    reasonsHtml += '<label class="si-reason-opt" style="cursor:pointer;">' +
                     '<input type="radio" name="si-split-reason" value="' + r.key + '"' + (i === 0 ? ' checked' : '') + ' style="margin-right:6px;">' +
                     '<i class="ti ' + r.icon + '"></i>' + escapeHtml(r.label) +
                   '</label>';
  });

  const overlay = document.createElement('div');
  overlay.id = 'si-split-modal';
  overlay.className = 'modal-overlay visible';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML =
    '<div class="modal" style="max-width:480px;">' +
      '<div class="modal-header"><h3><i class="ti ti-arrows-split"></i>Разделить позицию</h3>' +
      '<button class="icon-btn" onclick="document.getElementById(\'si-split-modal\').remove()"><i class="ti ti-x"></i></button></div>' +
      '<div class="modal-body">' +
        '<div style="font-size:13px;margin-bottom:12px;color:var(--text-mid);">' + escapeHtml(it.name_raw) + ' · всего ' + maxQty + ' ' + (it.unit || '') + '</div>' +
        '<div class="si-qty-pair">' +
          '<div>' +
            '<label style="font-size:11px;color:var(--text-light);text-transform:uppercase;">Принять</label>' +
            '<input type="number" id="si-split-accept" min="0" max="' + maxQty + '" step="0.01" value="' + (maxQty - 1) + '" oninput="siSplitRecalc(' + maxQty + ')" style="width:100%;padding:8px;font-size:14px;">' +
          '</div>' +
          '<div>' +
            '<label style="font-size:11px;color:var(--text-light);text-transform:uppercase;">Отказать</label>' +
            '<input type="number" id="si-split-refuse" readonly value="1" style="width:100%;padding:8px;font-size:14px;background:var(--bg);">' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:14px;font-size:11px;color:var(--text-light);text-transform:uppercase;font-weight:600;">Причина отказа</div>' +
        '<div class="si-reason-grid" style="margin-top:6px;">' + reasonsHtml + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;padding:14px 18px;">' +
        '<button class="pkb-btn" onclick="document.getElementById(\'si-split-modal\').remove()">Отмена</button>' +
        '<button class="pkb-btn primary" onclick="submitSupplyItemSplit(' + itemId + ')">Разделить</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
}

function siSplitRecalc(maxQty) {
  const accept = parseFloat(document.getElementById('si-split-accept').value) || 0;
  const refuse = Math.max(0, maxQty - accept);
  document.getElementById('si-split-refuse').value = refuse;
}

async function submitSupplyItemSplit(itemId) {
  const invoiceId = siState.currentInvoiceId;
  if (!invoiceId) return;
  const acceptQty = parseFloat(document.getElementById('si-split-accept').value) || 0;
  const refuseQty = parseFloat(document.getElementById('si-split-refuse').value) || 0;
  const reasonEl = document.querySelector('input[name="si-split-reason"]:checked');
  const reason = reasonEl ? reasonEl.value : 'other';

  if (acceptQty <= 0 && refuseQty <= 0) {
    showToast('Укажите количество', 'error');
    return;
  }

  try {
    await apiPost('/api/supply/invoices/' + invoiceId + '/items/' + itemId + '/split', {
      accept_qty: acceptQty,
      refuse_qty: refuseQty,
      refuse_reason: reason,
    });
    document.getElementById('si-split-modal').remove();
    const data = await apiGet('/api/supply/invoices/' + invoiceId);
    renderSupplyInvoiceDetail(data);
    showToast('Позиция разделена', 'success');
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

function openMatchAlternativesModal(itemId) {
  const it = siState.itemsCache.find(x => x.id === itemId);
  if (!it) return;
  const alt = siParseAlternatives(it.match_alternatives);
  const existing = document.getElementById('si-alt-modal');
  if (existing) existing.remove();

  // Текущий выбор + альтернативы в единый список кандидатов
  const candidates = [];
  if (it.matched_component_id) {
    candidates.push({
      id: it.matched_component_id,
      name: it.matched_name || '(без названия)',  // поле из сериализатора — matched_name
      category: it.matched_category_name || '',
      confidence: it.match_confidence || 'medium',
      current: true,
    });
  }
  alt.forEach(a => {
    // не дублируем текущий выбор
    if (it.matched_component_id && a.id === it.matched_component_id) return;
    candidates.push(a);
  });

  // HTML кандидатов — большими карточками с радио-инпутами
  let optsHtml = '';
  if (candidates.length) {
    optsHtml = '<div class="si-mm-section-title">Кандидаты из каталога</div>';
    candidates.forEach((c, idx) => {
      const checked = c.current ? ' checked' : '';
      const confChip = c.confidence
        ? '<span class="si-mm-conf si-mm-conf-' + escapeHtml(c.confidence) + '">' + escapeHtml(c.confidence) + '</span>'
        : '';
      optsHtml +=
        '<label class="si-mm-card">' +
          '<input type="radio" name="si-mm-pick" value="match:' + c.id + '"' + checked + '>' +
          '<div class="si-mm-card-body">' +
            '<div class="si-mm-card-title">' + escapeHtml(c.name || '—') + '</div>' +
            '<div class="si-mm-card-meta">' +
              (c.category ? '<span>раздел: <b>' + escapeHtml(c.category) + '</b></span>' : '') +
              (c.current ? '<span class="si-mm-current">текущий выбор</span>' : '') +
              confChip +
            '</div>' +
          '</div>' +
        '</label>';
    });
  }

  // Блок "Создать новую карточку в разделе X"
  const cats = (siState && siState.categories) || [];
  const curCatId = it.suggested_category_id || '';
  let catOpts = '<option value="">— Разное (по умолчанию)</option>';
  cats.forEach(c => {
    if ((c.code || '').toLowerCase() === 'misc' || (c.name || '').toLowerCase() === 'разное') return;
    const sel = (String(c.id) === String(curCatId)) ? ' selected' : '';
    catOpts += '<option value="' + c.id + '"' + sel + '>' + escapeHtml(c.name) + '</option>';
  });
  // "Создать новую" опция: радио без matched_id — оприходовать как новую карточку в выбранной категории
  const newChecked = !it.matched_component_id ? ' checked' : '';
  const newOption =
    '<label class="si-mm-card si-mm-card-new">' +
      '<input type="radio" name="si-mm-pick" value="new"' + newChecked + '>' +
      '<div class="si-mm-card-body">' +
        '<div class="si-mm-card-title"><i class="ti ti-plus"></i> Создать новую карточку</div>' +
        '<div class="si-mm-card-meta">' +
          '<span>раздел:</span>' +
          '<select id="si-mm-new-cat" onclick="event.stopPropagation();" onchange="event.stopPropagation();">' + catOpts + '</select>' +
        '</div>' +
      '</div>' +
    '</label>';

  const overlay = document.createElement('div');
  overlay.id = 'si-alt-modal';
  overlay.className = 'modal-overlay visible';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML =
    '<div class="modal si-mm-modal">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-list-search"></i>Сопоставить позицию</h3>' +
        '<button class="icon-btn" onclick="document.getElementById(\'si-alt-modal\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body" style="padding-top:6px;">' +
        '<div class="si-mm-subj">' + escapeHtml(it.name_raw || '—') + '</div>' +
        optsHtml +
        '<div class="si-mm-section-title" style="margin-top:14px;">Или новой карточкой</div>' +
        newOption +
      '</div>' +
      '<div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;padding:12px 16px;border-top:1px solid var(--border);">' +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'si-alt-modal\').remove()">Отмена</button>' +
        '<button class="btn btn-primary" onclick="applyMatchModal(' + itemId + ')">Применить</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
}

async function applyMatchModal(itemId) {
  const invoiceId = siState.currentInvoiceId;
  if (!invoiceId) return;
  const overlay = document.getElementById('si-alt-modal');
  const picked = overlay && overlay.querySelector('input[name="si-mm-pick"]:checked');
  if (!picked) {
    showToast('Выберите вариант', 'error');
    return;
  }
  const value = picked.value;  // "match:42" или "new"
  let body = {};
  if (value.startsWith('match:')) {
    body = {
      matched_component_id: parseInt(value.split(':')[1], 10),
      match_confidence: 'high',  // ручное подтверждение
    };
  } else {
    // "new" — снимаем матч и сохраняем выбранную категорию
    const catSel = document.getElementById('si-mm-new-cat');
    const catId = catSel && catSel.value ? parseInt(catSel.value, 10) : null;
    body = {
      matched_component_id: null,
      match_confidence: 'low',
      suggested_category_id: catId,
    };
  }
  try {
    await apiPatch('/api/supply/invoices/' + invoiceId + '/items/' + itemId, body);
    overlay.remove();
    showToast('Сопоставление обновлено', 'success');
    loadSupplyInvoiceDetail(invoiceId);
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

async function pickMatchAlternative(itemId, componentId) {
  // Legacy-вызов для обратной совместимости — теперь логика в applyMatchModal
  const invoiceId = siState.currentInvoiceId;
  if (!invoiceId) return;
  document.getElementById('si-alt-modal').remove();
  try {
    await apiPatch('/api/supply/invoices/' + invoiceId + '/items/' + itemId, {
      matched_component_id: componentId,
      match_confidence: 'high',
    });
    const data = await apiGet('/api/supply/invoices/' + invoiceId);
    renderSupplyInvoiceDetail(data);
    showToast('Сопоставление обновлено', 'success');
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

// ---------- Подтверждение и прочее ----------

async function confirmSupplyInvoice(invoiceId) {
  if (!confirm('Оприходовать накладную? После этого изменить будет нельзя.')) return;
  try {
    const r = await apiPost('/api/supply/invoices/' + invoiceId + '/confirm', {});
    if (r.status === 409) {
      const msg = (r.data && r.data.message) || 'Дубликат: эта УПД уже была оприходована ранее.';
      alert(msg);
      return;
    }
    if (!r.ok) {
      showToast('Ошибка: ' + ((r.data && r.data.message) || ('HTTP ' + r.status)), 'error');
      return;
    }
    const rep = (r.data && r.data.report) || {};
    const parts = [];
    if (rep.applied)      parts.push('оприходовано: ' + rep.applied);
    if (rep.auto_created) parts.push('новых карточек: ' + rep.auto_created);
    if (rep.refused)      parts.push('отказов: ' + rep.refused);
    if (rep.expense)      parts.push('списано: ' + rep.expense);
    if (rep.no_match)     parts.push('без оприходования: ' + rep.no_match);
    showToast('Накладная оприходована' + (parts.length ? ' · ' + parts.join(', ') : ''), 'success');
    loadSupplyInvoiceDetail(invoiceId);  // покажет финальный статус
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

async function rerecognizeSupplyInvoice(invoiceId) {
  try {
    const r = await apiPost('/api/supply/invoices/' + invoiceId + '/recognize', {});
    if (!r.ok) {
      const msg = (r.data && (r.data.message || r.data.error)) || ('HTTP ' + r.status);
      throw new Error(msg);
    }
    showToast('Запущено повторное распознавание', 'success');
    loadSupplyInvoiceDetail(invoiceId);
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

async function deleteSupplyInvoice(invoiceId) {
  if (!confirm('Удалить черновик приёмки?')) return;
  try {
    await apiDelete('/api/supply/invoices/' + invoiceId);
    showToast('Черновик удалён', 'success');
    loadSupplyInvoicesList();
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

async function deleteConfirmedSupplyInvoice(invoiceId) {
  const msg = 'Отменить оприходование?\n\n' +
              '• Со склада будет вычтено всё, что эта УПД приходовала\n' +
              '• Движения по этой приёмке будут удалены\n' +
              '• Авто-созданные карточки в «Разное» будут деактивированы (если не использовались больше нигде)\n' +
              '• УПД будет помечена как отменённая';
  if (!confirm(msg)) return;
  try {
    const r = await apiDelete('/api/supply/invoices/' + invoiceId);
    if (r && r.ok === false) {
      showToast('Ошибка: ' + ((r.data && r.data.message) || ('HTTP ' + (r.status || '?'))), 'error');
      return;
    }
    const rb = (r && r.data && r.data.rollback) || {};
    const parts = [];
    if (rb.qty_reverted)           parts.push('вычтено: ' + rb.qty_reverted);
    if (rb.movements_deleted)      parts.push('движений удалено: ' + rb.movements_deleted);
    if (rb.components_deactivated) parts.push('карточек деактивировано: ' + rb.components_deactivated);
    if (rb.aliases_removed)        parts.push('алиасов снято: ' + rb.aliases_removed);
    showToast('Оприходование отменено' + (parts.length ? ' · ' + parts.join(', ') : ''), 'success');
    loadSupplyInvoicesList();
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

// ============ КОНЕЦ ЭТАПА 26 (v2.25.0) ============


// ============ v2.45.223: ОПРОСНЫЕ ЛИСТЫ (Продажи) ============

const SURVEY_FORMS = {
  syrovarnya: {
    title: 'Проектирование сыроварни',
    subtitle: 'Сыроварня «под ключ» — оборудование, камеры созревания, вентиляция, электрика',
    icon: 'ti-building-factory-2',
    file: '/oprosnik-syrovarnya.html',
  },
};

function _surveyLink(kind) {
  const f = SURVEY_FORMS[kind || 'syrovarnya'] || SURVEY_FORMS.syrovarnya;
  return window.location.origin + f.file;
}

function copySurveyLink(kind) {
  const url = _surveyLink(kind || 'syrovarnya');
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => {
    showToast('Ссылка скопирована — отправь клиенту', 'success');
  }).catch(() => { prompt('Скопируйте ссылку:', url); });
}

function openSurveyForm(kind) {
  window.open(_surveyLink(kind || 'syrovarnya'), '_blank');
}

// v2.45.224: карточки доступных анкет — видно, какие опросные листы есть
function _surveyFormsBlockHtml() {
  let h = '<div style="padding:12px 0 4px;">' +
    '<div style="font-size:12px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:8px;">Доступные анкеты</div>';
  Object.keys(SURVEY_FORMS).forEach(kind => {
    const f = SURVEY_FORMS[kind];
    h += '<div class="spec-item" style="align-items:center;">' +
      '<div class="spec-item-no" style="color:var(--brand);"><i class="ti ' + (f.icon || 'ti-clipboard-text') + '"></i></div>' +
      '<div class="spec-item-body">' +
        '<div class="spec-item-name">Опросный лист — ' + escapeHtml(f.title) + '</div>' +
        '<div class="spec-item-meta">' + escapeHtml(f.subtitle || '') + '</div>' +
      '</div>' +
      '<div class="spec-item-act-col" style="flex-wrap:wrap;gap:6px;">' +
        '<button class="btn btn-secondary btn-small" onclick="copySurveyLink(\'' + kind + '\')"><i class="ti ti-link"></i> Ссылка для клиента</button>' +
        '<button class="btn btn-primary btn-small" onclick="openSurveyForm(\'' + kind + '\')"><i class="ti ti-pencil"></i> Заполнить</button>' +
      '</div>' +
    '</div>';
  });
  h += '</div>';
  return h;
}

async function loadSurveys() {
  const box = document.getElementById('surveys-list');
  if (!box) return;
  box.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try {
    const d = await apiGet('/api/surveys');
    const list = (d && d.surveys) || [];
    const formsBlock = _surveyFormsBlockHtml();
    if (!list.length) {
      box.innerHTML = formsBlock +
        '<div class="empty-block"><i class="ti ti-clipboard-text"></i>Заполненных опросных листов пока нет.<br>' +
        '<span style="font-size:13px;color:var(--text-light);">Нажми «Ссылка для клиента» и отправь её в мессенджер — заполненная анкета появится здесь.</span></div>';
      return;
    }
    let html = formsBlock +
      '<div style="font-size:12px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:0.4px;margin:14px 0 8px;">Заполненные (' + list.length + ')</div>' +
      '<div class="spec-list" style="padding:0 0 20px;">';
    list.forEach(s => {
      const who = s.org || s.contact || 'Без названия';
      const meta = [];
      if (s.contact && s.org) meta.push(escapeHtml(s.contact));
      if (s.phone) meta.push(escapeHtml(s.phone));
      if (s.email) meta.push(escapeHtml(s.email));
      const kindLabel = (SURVEY_FORMS[s.kind] || {}).title || s.kind || '';
      html += '<div class="spec-item" style="cursor:pointer;" onclick="openSurveyDetail(' + s.id + ')">' +
        '<div class="spec-item-no"><i class="ti ti-clipboard-text"></i></div>' +
        '<div class="spec-item-body">' +
          '<div class="spec-item-name">' + escapeHtml(who) +
            ' <span style="display:inline-block;font-size:10px;font-weight:700;color:#0E7490;background:rgba(14,116,144,0.10);padding:1px 7px;border-radius:6px;margin-left:4px;vertical-align:middle;">' + escapeHtml(kindLabel) + '</span>' +
          '</div>' +
          '<div class="spec-item-meta">' + (meta.join(' · ') || '—') +
            (s.created_at ? ' · ' + escapeHtml(formatNotifTime(s.created_at)) : '') + '</div>' +
        '</div>' +
        '<div class="spec-item-act-col"><i class="ti ti-chevron-right" style="color:var(--text-light);"></i></div>' +
      '</div>';
    });
    html += '</div>';
    box.innerHTML = html;
  } catch (e) {
    box.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Не удалось загрузить</div>';
  }
}

async function openSurveyDetail(surveyId) {
  let s = null;
  try { s = await apiGet('/api/surveys/' + surveyId); } catch (e) {}
  if (!s) { showToast('Не удалось открыть', 'error'); return; }
  let modal = document.getElementById('survey-detail-modal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'survey-detail-modal';
  modal.className = 'modal-overlay visible';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  const who = s.org || s.contact || 'Опросный лист';
  const canDel = (typeof canManageSales === 'function') && canManageSales();
  modal.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:760px;max-height:92vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-clipboard-text"></i> ' + escapeHtml(who) + '</h3>' +
        '<button class="icon-btn" onclick="document.getElementById(\'survey-detail-modal\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body" style="overflow-y:auto;padding:16px 18px;">' +
        '<div style="font-size:13px;color:var(--text-light);margin-bottom:10px;">' +
          [s.contact, s.phone, s.email].filter(Boolean).map(escapeHtml).join(' · ') +
          (s.created_at ? ' · ' + escapeHtml(formatNotifTime(s.created_at)) : '') +
        '</div>' +
        '<pre style="white-space:pre-wrap;font-family:inherit;font-size:13.5px;line-height:1.55;background:var(--bg);border-radius:10px;padding:14px;margin:0;">' +
          escapeHtml(s.answers_text || '') + '</pre>' +
      '</div>' +
      '<div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;">' +
        '<button class="btn btn-secondary" onclick="copySurveyAnswers(' + s.id + ')"><i class="ti ti-copy"></i> Скопировать ответы</button>' +
        (canDel ? '<button class="btn btn-secondary" style="color:var(--danger);" onclick="deleteSurvey(' + s.id + ')"><i class="ti ti-trash"></i> Удалить</button>' : '') +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  window._lastSurveyText = s.answers_text || '';
}

function copySurveyAnswers(id) {
  const t = window._lastSurveyText || '';
  (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => {
    showToast('Ответы скопированы', 'success');
  }).catch(() => { prompt('Скопируйте текст:', t); });
}

async function deleteSurvey(id) {
  if (!confirm('Удалить этот опросный лист?')) return;
  try {
    await apiDelete('/api/surveys/' + id);
    const m = document.getElementById('survey-detail-modal');
    if (m) m.remove();
    showToast('Удалено', 'success');
    loadSurveys();
  } catch (e) { showToast('Не удалось удалить', 'error'); }
}

// ============ ОТЧЁТЫ МЕНЕДЖЕРОВ (ежедневный KPI) ============
// Менеджер раз в день вносит свои показатели; «итого» за месяц считает сервер
// (нарастающим итогом). Менеджер видит свои отчёты, директор/зам — всех.

var _srState = { month: null, data: null };

// Поля отчёта: ключ, подпись в форме, короткая подпись в таблице, иконка
var _SR_FIELDS = [
  { key: 'calls',     label: 'Звонков',       short: 'звонков', icon: 'ti-phone' },
  { key: 'connects',  label: 'Дозвоны',       short: 'дозвоны', icon: 'ti-checks' },
  { key: 'new_leads', label: 'Новых заявок',  short: 'заявок',  icon: 'ti-inbox' },
  { key: 'offers',    label: 'КП выставлено', short: 'КП',      icon: 'ti-file-invoice' },
  { key: 'deals',     label: 'Сделок',        short: 'сделок',  icon: 'ti-circle-check' },
  { key: 'revenue',   label: 'Выручка, ₽',    short: 'выручка', icon: 'ti-coin', money: true },
];

function _srTodayIso() {
  const d = new Date();
  const p = n => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function _srCurMonth() { return _srState.month || _srTodayIso().slice(0, 7); }
function _srFmtNum(n) { return (Number(n) || 0).toLocaleString('ru-RU'); }
function _srMonthLabel(ym) {
  const months = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const parts = (ym || '').split('-');
  return (months[parseInt(parts[1], 10) - 1] || '') + ' ' + (parts[0] || '');
}
function _srFmtDateRu(iso) {
  const p = (iso || '').split('-');
  return p.length === 3 ? (p[2] + '.' + p[1] + '.' + p[0].slice(2)) : (iso || '');
}
function _srShiftMonth(ym, delta) {
  const p = (ym || _srCurMonth()).split('-');
  let y = parseInt(p[0], 10), m = parseInt(p[1], 10) - 1 + delta;
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return y + '-' + (m + 1 < 10 ? '0' : '') + (m + 1);
}

async function loadSalesReports() {
  const box = document.getElementById('sales-reports-body');
  if (!box) return;
  const month = _srCurMonth();
  box.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try {
    const d = await apiGet('/api/sales/reports?month=' + encodeURIComponent(month));
    _srState.month = d.month || month;
    _srState.data = d;
    _srRender(box, d);
  } catch (e) {
    box.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Не удалось загрузить отчёты</div>';
  }
}

function _srNavMonth(delta) {
  _srState.month = _srShiftMonth(_srCurMonth(), delta);
  loadSalesReports();
}

function _srRender(box, d) {
  window.SR_V2 = (localStorage.getItem('srV2') !== '0');
  const toggle = _sr2ToggleBar();
  box.innerHTML = toggle + (window.SR_V2 ? _sr2Body(d) : _srOldBody(d));
  const dateInput = document.getElementById('sr-date');
  if (dateInput) {
    dateInput.addEventListener('change', _srPrefillFromDate);
    _srPrefillFromDate();
  }
}

// === Старый вид (для отката) ===
function _srOldBody(d) {
  let html = '<div class="sr-toolbar">' +
      '<button class="btn btn-secondary btn-small" onclick="_srNavMonth(-1)" title="Предыдущий месяц"><i class="ti ti-chevron-left"></i></button>' +
      '<div class="sr-month">' + escapeHtml(_srMonthLabel(d.month)) + '</div>' +
      '<button class="btn btn-secondary btn-small" onclick="_srNavMonth(1)" title="Следующий месяц"><i class="ti ti-chevron-right"></i></button>' +
    '</div>';
  if (d.can_edit) html += _srFormHtml(d);
  html += _srManagersHtml(d);
  return html;
}

// === Новый вид (v2.45.5xx) ===
function _sr2ToggleBar() {
  return '<div class="sv2-toggle-bar">' +
      '<span><i class="ti ti-' + (window.SR_V2 ? 'sparkles' : 'history') + '"></i> ' + (window.SR_V2 ? 'Новый вид' : 'Старый вид') + '</span>' +
      '<button class="sv2-toggle-btn" onclick="toggleReportsV2()">' + (window.SR_V2 ? 'Вернуть старый' : 'Включить новый') + '</button>' +
    '</div>';
}

function toggleReportsV2() {
  window.SR_V2 = !window.SR_V2;
  try { localStorage.setItem('srV2', window.SR_V2 ? '1' : '0'); } catch (_) {}
  const box = document.getElementById('sales-reports-body');
  if (box && _srState.data) _srRender(box, _srState.data);
  else loadSalesReports();
}

// эмодзи и цветовой класс по метрике
var _SR2_ICON = { calls: '📞', connects: '✅', new_leads: '📥', offers: '📄', deals: '🤝', revenue: '💰' };
var _SR2_CCLS = { calls: 'c-call', connects: 'c-conn', new_leads: 'c-lead', offers: 'c-kp', deals: 'c-deal', revenue: 'c-rev' };

function _sr2Body(d) {
  let html = '<div class="sr2-mnav-row"><div class="sr2-mnav">' +
      '<button onclick="_srNavMonth(-1)" title="Предыдущий месяц">‹</button>' +
      '<span class="sr2-m">' + escapeHtml(_srMonthLabel(d.month)) + '</span>' +
      '<button onclick="_srNavMonth(1)" title="Следующий месяц">›</button>' +
    '</div></div>';

  html += _sr2SummaryHtml(d);
  if (d.can_edit) html += _sr2FormHtml(d);

  const mgrs = d.managers || [];
  if (!mgrs.length) {
    html += '<div class="empty-block"><i class="ti ti-chart-bar"></i>За ' + escapeHtml(_srMonthLabel(d.month).toLowerCase()) + ' отчётов пока нет.' +
      (d.can_edit ? '<br><span style="font-size:13px;color:var(--text-light);">Заполни форму выше и нажми «Сохранить».</span>' : '') + '</div>';
  } else {
    html += '<div class="sr2-sec"><span class="em">👥</span> По менеджерам</div>';
    mgrs.forEach((m, idx) => { html += _sr2ManagerCardHtml(m, idx, d); });
  }
  return html;
}

function _sr2SummaryHtml(d) {
  const mgrs = d.managers || [];
  if (!mgrs.length) return '';
  const sum = {};
  _SR_FIELDS.forEach(f => { sum[f.key] = 0; });
  mgrs.forEach(m => { const t = m.totals || {}; _SR_FIELDS.forEach(f => { sum[f.key] += (Number(t[f.key]) || 0); }); });
  let tiles = '';
  _SR_FIELDS.forEach(f => {
    const val = f.money ? formatMoneyShort(sum[f.key]) : _srFmtNum(sum[f.key]);
    tiles += '<div class="sr2-kpi' + (f.money ? ' rev' : '') + '">' +
        '<div class="sr2-kpi-ic ' + _SR2_CCLS[f.key] + '"><span class="em">' + _SR2_ICON[f.key] + '</span></div>' +
        '<div class="sr2-kpi-num">' + val + '</div>' +
        '<div class="sr2-kpi-lbl">' + escapeHtml(f.short) + '</div>' +
      '</div>';
  });
  return '<div class="sr2-sec"><span class="em">📊</span> Сводка за ' + escapeHtml(_srMonthLabel(d.month).toLowerCase()) + (mgrs.length > 1 ? ' · все менеджеры' : '') + '</div>' +
    '<div class="sr2-kpis">' + tiles + '</div>';
}

function _sr2FormHtml(d) {
  const today = d.today || _srTodayIso();
  let inputs = '';
  _SR_FIELDS.forEach(f => {
    inputs += '<div class="sr2-fld' + (f.money ? ' rev' : '') + '">' +
        '<label for="sr-' + f.key + '"><span class="em">' + _SR2_ICON[f.key] + '</span> ' + escapeHtml(f.short) + '</label>' +
        '<input type="number" inputmode="numeric" min="0" step="1" id="sr-' + f.key + '" value="0" onfocus="this.select()">' +
      '</div>';
  });
  return '<div class="sr2-sec"><span class="em">✏️</span> Мой отчёт за день</div>' +
    '<div class="sr2-form">' +
      '<div class="sr2-form-sub">Внеси цифры за день — «итого» за месяц посчитается само.</div>' +
      '<div class="sr2-frow">' +
        '<div class="sr2-fld date"><label for="sr-date">Дата</label>' +
          '<input type="date" id="sr-date" value="' + today + '" max="' + today + '"></div>' +
        inputs +
        '<div class="sr2-grow"></div>' +
        '<button class="btn btn-primary" id="sr-save-btn" onclick="saveSalesReport()"><i class="ti ti-device-floppy"></i> Сохранить</button>' +
      '</div>' +
      '<div class="sr2-form-hint" id="sr-form-hint"></div>' +
    '</div>';
}

function _sr2Funnel(t) {
  const calls = Number(t.calls) || 0, connects = Number(t.connects) || 0, leads = Number(t.new_leads) || 0, deals = Number(t.deals) || 0;
  if (!calls && !connects && !leads && !deals) return '';
  const pct = (part, whole) => whole > 0 ? Math.round(part / whole * 100) : 0;
  const node = (val, word) => '<span class="sr2-fn-node"><b>' + _srFmtNum(val) + '</b> ' + word + '</span>';
  const arrow = (p, cls) => '<span class="sr2-fn-pct' + (cls ? ' ' + cls : '') + '">' + p + '%</span>';
  return '<div class="sr2-funnel">' +
    node(calls, 'звонков') + arrow(pct(connects, calls)) +
    node(connects, 'дозвонов') + arrow(pct(leads, connects)) +
    node(leads, 'заявок') + arrow(pct(deals, leads), 'warn') +
    node(deals, 'сделок') +
  '</div>';
}

function _sr2ToggleDaily(n) {
  const el = document.getElementById('sr2-daily-' + n);
  if (el) el.classList.toggle('open');
}

function _sr2ManagerCardHtml(m, idx, d) {
  const t = m.totals || {};
  let tiles = '';
  _SR_FIELDS.forEach(f => {
    const val = f.money ? formatMoneyShort(t[f.key]) : _srFmtNum(t[f.key]);
    tiles += '<div class="sr2-tile' + (f.money ? ' rev' : '') + '"><div class="v">' + val + '</div><div class="l">' + escapeHtml(f.short) + '</div></div>';
  });

  const head = '<tr><th>Дата</th>' + _SR_FIELDS.map(f => '<th>' + escapeHtml(f.short) + '</th>').join('') + '<th></th></tr>';
  const rows = (m.reports || []).map(r => {
    const cum = r.cum || {};
    const cells = _SR_FIELDS.map(f =>
      '<td' + (f.money ? ' class="rev-c"' : '') + '>' + (f.money ? _srFmtNum(r[f.key]) : (r[f.key] || 0)) +
        '<span class="cum">' + (f.money ? _srFmtNum(cum[f.key]) : (cum[f.key] || 0)) + '</span></td>').join('');
    const act = '<button class="sr2-ibtn" title="Скопировать для Telegram" onclick="_srCopyReport(' + idx + ',\'' + r.report_date + '\')"><i class="ti ti-copy"></i></button>' +
      (d.can_edit ? '<button class="sr2-ibtn" title="Удалить" onclick="deleteSalesReport(' + r.id + ')"><i class="ti ti-trash"></i></button>' : '');
    return '<tr><td>' + escapeHtml(_srFmtDateRu(r.report_date)) + '</td>' + cells + '<td class="sr2-tact-cell">' + act + '</td></tr>';
  }).join('');

  const cnt = (m.reports || []).length;
  const daily = cnt ?
    '<div class="sr2-daily" id="sr2-daily-' + idx + '">' +
      '<button class="sr2-daily-toggle" onclick="_sr2ToggleDaily(' + idx + ')"><span class="em">📅</span> По дням (' + cnt + ') <span class="sr2-caret em">▾</span></button>' +
      '<div class="sr2-daily-body"><div class="sr2-table-wrap"><table class="sr2-table"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>' +
        '<div class="sr2-table-note">маленькое число снизу — нарастающий итог с начала месяца</div></div></div>' +
    '</div>' : '';

  const periodWord = (_srMonthLabel(d.month).split(' ')[0] || '').toLowerCase();
  return '<div class="sr2-mgr">' +
      '<div class="sr2-mgr-head">' +
        '<div class="sr2-ava">' + escapeHtml(getInitials(m.name)) + '</div>' +
        '<div class="sr2-mgr-id"><div class="sr2-mgr-name">' + escapeHtml(m.name || '—') + '</div>' +
          (m.position ? '<div class="sr2-mgr-pos">' + escapeHtml(m.position) + '</div>' : '') + '</div>' +
        '<div class="sr2-mgr-period">Итого<br>за ' + escapeHtml(periodWord) + '</div>' +
      '</div>' +
      '<div class="sr2-tiles">' + tiles + '</div>' +
      _sr2Funnel(t) +
      daily +
    '</div>';
}

function _srFormHtml(d) {
  const today = d.today || _srTodayIso();
  let inputs = '';
  _SR_FIELDS.forEach(f => {
    inputs += '<div class="sr-field">' +
        '<label class="form-label" for="sr-' + f.key + '"><i class="ti ' + f.icon + '"></i> ' + escapeHtml(f.label) + '</label>' +
        '<input type="number" inputmode="numeric" min="0" step="1" class="form-input" id="sr-' + f.key + '" value="0" onfocus="this.select()">' +
      '</div>';
  });
  return '<div class="sr-card sr-form-card">' +
      '<div class="sr-card-title"><i class="ti ti-pencil-plus"></i> Мой отчёт за день</div>' +
      '<div class="sr-card-sub">Внеси цифры за день — «итого» за месяц посчитается само</div>' +
      '<div class="sr-field sr-date-field">' +
        '<label class="form-label" for="sr-date">Дата</label>' +
        '<input type="date" class="form-input" id="sr-date" value="' + today + '" max="' + today + '">' +
      '</div>' +
      '<div class="sr-grid">' + inputs + '</div>' +
      '<div class="sr-form-actions">' +
        '<button class="btn btn-primary" id="sr-save-btn" onclick="saveSalesReport()"><i class="ti ti-device-floppy"></i> Сохранить</button>' +
        '<span class="sr-form-hint" id="sr-form-hint"></span>' +
      '</div>' +
    '</div>';
}

function _srPrefillFromDate() {
  const d = _srState.data;
  const dateInput = document.getElementById('sr-date');
  if (!d || !dateInput) return;
  const my = (d.my_reports || {})[dateInput.value];
  _SR_FIELDS.forEach(f => {
    const el = document.getElementById('sr-' + f.key);
    if (el) el.value = my ? (my[f.key] || 0) : 0;
  });
  const hint = document.getElementById('sr-form-hint');
  const btn = document.getElementById('sr-save-btn');
  if (my) {
    if (hint) hint.textContent = 'Отчёт за эту дату уже есть — сохранение обновит цифры.';
    if (btn) btn.innerHTML = '<i class="ti ti-refresh"></i> Обновить';
  } else {
    if (hint) hint.textContent = '';
    if (btn) btn.innerHTML = '<i class="ti ti-device-floppy"></i> Сохранить';
  }
}

async function saveSalesReport() {
  const dateInput = document.getElementById('sr-date');
  const rdate = dateInput ? dateInput.value : _srTodayIso();
  if (!rdate) { showToast('Укажите дату', 'error'); return; }
  const body = { date: rdate };
  _SR_FIELDS.forEach(f => {
    let v = parseInt((document.getElementById('sr-' + f.key) || {}).value, 10);
    body[f.key] = (isNaN(v) || v < 0) ? 0 : v;
  });
  const btn = document.getElementById('sr-save-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i> Сохраняю…'; }
  try {
    const res = await apiPost('/api/sales/reports', body);
    if (!res.ok) throw new Error((res.data && res.data.message) || 'HTTP ' + res.status);
    showToast('Отчёт сохранён', 'success');
    _srState.month = rdate.slice(0, 7);  // показать месяц сохранённого отчёта
    await loadSalesReports();
  } catch (e) {
    showToast('Не удалось сохранить: ' + (e.message || ''), 'error');
    if (btn) { btn.disabled = false; _srPrefillFromDate(); }
  }
}

function _srManagersHtml(d) {
  const mgrs = d.managers || [];
  if (!mgrs.length) {
    return '<div class="empty-block"><i class="ti ti-chart-bar"></i>За ' + escapeHtml(_srMonthLabel(d.month).toLowerCase()) + ' отчётов пока нет.' +
      (d.can_edit ? '<br><span style="font-size:13px;color:var(--text-light);">Заполни форму выше и нажми «Сохранить».</span>' : '') +
      '</div>';
  }
  return mgrs.map((m, idx) => _srManagerCardHtml(m, idx, d)).join('');
}

function _srManagerCardHtml(m, idx, d) {
  const t = m.totals || {};
  const totalsTiles = _SR_FIELDS.map(f =>
    '<div class="sr-tot-tile">' +
      '<div class="sr-tot-val">' + (f.money ? _srFmtNum(t[f.key]) : (t[f.key] || 0)) + '</div>' +
      '<div class="sr-tot-lbl">' + escapeHtml(f.short) + '</div>' +
    '</div>').join('');

  const head = '<tr><th>Дата</th>' + _SR_FIELDS.map(f => '<th>' + escapeHtml(f.short) + '</th>').join('') + '<th></th></tr>';
  const rowsHtml = (m.reports || []).map(r => {
    const cum = r.cum || {};
    const cells = _SR_FIELDS.map(f =>
      '<td>' + (f.money ? _srFmtNum(r[f.key]) : (r[f.key] || 0)) +
        '<span class="sr-cum" title="нарастающий итог с начала месяца">' +
          (f.money ? _srFmtNum(cum[f.key]) : (cum[f.key] || 0)) + '</span></td>').join('');
    const act = '<button class="icon-btn icon-btn-sm" title="Скопировать для Telegram" onclick="_srCopyReport(' + idx + ',\'' + r.report_date + '\')"><i class="ti ti-copy"></i></button>' +
      (d.can_edit ? '<button class="icon-btn icon-btn-sm" title="Удалить" onclick="deleteSalesReport(' + r.id + ')"><i class="ti ti-trash"></i></button>' : '');
    return '<tr><td class="sr-d">' + escapeHtml(_srFmtDateRu(r.report_date)) + '</td>' + cells +
      '<td class="sr-row-act">' + act + '</td></tr>';
  }).join('');

  return '<div class="sr-card">' +
      '<div class="sr-mgr-head">' +
        '<div class="sr-mgr-name"><i class="ti ti-user"></i> ' + escapeHtml(m.name || '—') +
          (m.position ? ' <span class="sr-mgr-pos">' + escapeHtml(m.position) + '</span>' : '') + '</div>' +
        '<div class="sr-mgr-sub">Итого за ' + escapeHtml(_srMonthLabel(d.month).toLowerCase()) + '</div>' +
      '</div>' +
      '<div class="sr-tot-row">' + totalsTiles + '</div>' +
      '<div class="sr-table-wrap"><table class="sr-table">' +
        '<thead>' + head + '</thead><tbody>' + rowsHtml + '</tbody></table>' +
        '<div class="sr-table-note">маленькое число справа — нарастающий итог с начала месяца</div>' +
      '</div>' +
    '</div>';
}

// Текст в формате привычного сообщения для Telegram-группы «Отчёты Атомус»
function _srReportToText(name, position, r) {
  const c = r.cum || {};
  let s = (name || 'Менеджер') + '\n' +
    'Дата ' + _srFmtDateRu(r.report_date) + '\n';
  if (position) s += 'Должность: ' + position + '\n';
  s += 'Звонков: ' + (r.calls || 0) + '\n' +
    'Дозвоны: ' + (r.connects || 0) + '\n' +
    'Новых заявок: ' + (r.new_leads || 0) + '\n' +
    'КП выставлено: ' + (r.offers || 0) + '\n' +
    'Сделок заключено: ' + (r.deals || 0) + '\n' +
    'Выручка: ' + (r.revenue || 0) + '\n' +
    '*итого: звонков = ' + (c.calls || 0) + '\n' +
    '*итого: дозвоны = ' + (c.connects || 0) + '\n' +
    '*итого: КП = ' + (c.offers || 0) + '\n' +
    '*итого: сделок = ' + (c.deals || 0) + '\n' +
    '*итого: выручка = ' + (c.revenue || 0);
  return s;
}

function _srCopyReport(idx, rdate) {
  const d = _srState.data;
  const m = d && (d.managers || [])[idx];
  const r = m && (m.reports || []).find(x => x.report_date === rdate);
  if (!r) return;
  const text = _srReportToText(m.name, m.position, r);
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => {
    showToast('Скопировано — можно вставить в Telegram', 'success');
  }).catch(() => { prompt('Скопируйте текст:', text); });
}

async function deleteSalesReport(id) {
  if (!confirm('Удалить этот отчёт?')) return;
  try {
    await apiDelete('/api/sales/reports/' + id);
    showToast('Удалено', 'success');
    loadSalesReports();
  } catch (e) { showToast('Не удалось удалить: ' + (e.message || ''), 'error'); }
}

// ============ INIT ============

// v2.45.222: приём файла из системного «Поделиться» (Web Share Target).
// SW складывает файлы в cache 'atomus-share-intake', мы подхватываем и грузим
// во «Входящие счета» (тот же /api/supply/invoices/upload, что и ручная загрузка).
async function _processSharedInvoiceFiles() {
  try {
    const cache = await caches.open('atomus-share-intake');
    const metaResp = await cache.match('/share-intake/meta');
    if (!metaResp) return;
    const meta = await metaResp.json().catch(() => ({ count: 0 }));
    const n = Number(meta.count) || 0;
    const files = [];
    for (let i = 0; i < n; i++) {
      const r = await cache.match('/share-intake/' + i);
      if (!r) continue;
      const blob = await r.blob();
      const name = decodeURIComponent(r.headers.get('X-Name') || ('file' + i));
      files.push(new File([blob], name, { type: blob.type || 'application/octet-stream' }));
    }
    await caches.delete('atomus-share-intake');
    if (!files.length) return;
    showToast('Файл из «Поделиться» — загружаем счёт…', 'success');
    const fd = new FormData();
    files.forEach(f => fd.append('file', f, f.name));
    // помечаем источник — пришло из системного «Поделиться» (а не Фото УПД)
    fd.append('source', 'share');
    // как и в ручной загрузке: на телефоне распознавание откладываем
    if (state && !state.isDesktop) fd.append('defer_recognition', '1');
    const token = localStorage.getItem(TOKEN_KEY);
    const res = await fetch(API_BASE + '/api/supply/invoices/upload', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: fd,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(d.message || 'Не удалось загрузить счёт', 'error'); return; }
    showToast('Счёт загружен во «Входящие счета»', 'success');
    try { selectSection('supply'); selectSidebarItem('supply-invoice-intake'); } catch (e) {}
  } catch (e) { console.error('share intake:', e); }
}

function _scheduleSharedInvoiceIntake() {
  // Ждём входа (до ~60с): токен + загруженный профиль, потом грузим
  let tries = 0;
  const t = setInterval(() => {
    tries++;
    const token = localStorage.getItem(TOKEN_KEY);
    if (token && state && state.user) {
      clearInterval(t);
      _processSharedInvoiceFiles();
    } else if (tries > 120) {
      clearInterval(t);
      showToast('Чтобы загрузить счёт — войдите и поделитесь файлом ещё раз', 'error');
    }
  }, 500);
}

(function init() {
  detectLayout();
  // ЭТАП 22.1: подключаем обработчики прокрутки табов
  attachSectionTabsWheelHandler();
  setTimeout(updateSectionScrollState, 50);
  // v2.45.222: если в буфере «Поделиться» лежит файл — подхватим после входа
  try {
    if ('caches' in window) {
      caches.has('atomus-share-intake').then(has => { if (has) _scheduleSharedInvoiceIntake(); });
    }
  } catch (e) {}
  // ЭТАП 21: проверяем — если URL это /a/{token} или /c/{token},
  // показываем публичную страницу БЕЗ требования логина
  const path = window.location.pathname;
  const publicAsmMatch = path.match(/^\/a\/([A-Za-z0-9_\-]+)$/);
  const publicContractMatch = path.match(/^\/c\/([A-Za-z0-9_\-]+)$/);
  // ЭТАП 26: публичная страница коробки /b/{token}
  const publicBoxMatch = path.match(/^\/b\/([A-Za-z0-9_\-]+)$/);
  // v2.37.0: публичная страница заявки /d/{token}
  const publicDefectMatch = path.match(/^\/d\/([A-Za-z0-9_\-]+)$/);
  // v2.44.48: публичная страница разработки /dev/{token}
  const publicDevMatch = path.match(/^\/dev\/([A-Za-z0-9_\-]+)$/);
  if (publicAsmMatch) {
    showPublicAssembly(publicAsmMatch[1]);
    return;
  }
  if (publicContractMatch) {
    var _pItem = null;
    try { _pItem = new URLSearchParams(window.location.search).get('item'); } catch (_) {}
    showPublicContract(publicContractMatch[1], _pItem);
    return;
  }
  if (publicBoxMatch) {
    showPublicBox(publicBoxMatch[1]);
    return;
  }
  if (publicDefectMatch) {
    showPublicDefect(publicDefectMatch[1]);
    return;
  }
  if (publicDevMatch) {
    showPublicDevelopment(publicDevMatch[1]);
    return;
  }
  // v2.38.1: fallback на query ?d=<token> (если на Vercel нет rewrite для /d/)
  try {
    const usp = new URLSearchParams(window.location.search);
    const qDefect = usp.get('d');
    if (qDefect && /^[A-Za-z0-9_\-]+$/.test(qDefect)) {
      showPublicDefect(qDefect);
      return;
    }
    // v2.44.48: fallback на ?dev=<token>
    const qDev = usp.get('dev');
    if (qDev && /^[A-Za-z0-9_\-]+$/.test(qDev)) {
      showPublicDevelopment(qDev);
      return;
    }
  } catch (_) {}
  // ЭТАП 23+: общая публичная форма замечаний /feedback
  if (path === '/feedback' || path === '/feedback/') {
    showPublicFeedbackPage();
    return;
  }
  // v2.45.x: ТВ-трансляция CRM на офисный телевизор.
  // Каст-кнопка на сервере открывает …/?tvtoken=<токен>&screen=<раздел> —
  // приложение само авторизуется по токену и открывает нужный раздел.
  // Токен сразу убираем из видимого URL/истории.
  try {
    const _tvUsp = new URLSearchParams(window.location.search);
    const _tvTok = _tvUsp.get('tvtoken');
    if (_tvTok) {
      localStorage.setItem(TOKEN_KEY, _tvTok);
      window._tvMode = true;
      window._tvScreen = (_tvUsp.get('screen') || '').trim();
      try { document.body.classList.add('tv-mode'); } catch (_) {}
      try { history.replaceState({}, '', window.location.pathname); } catch (_) {}
    }
  } catch (_) {}
  // Обычный flow
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) showApp();
  else {
    document.getElementById('login-page').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    if (codeInput) codeInput.focus();
  }
})();

// ============ SERVICE WORKER + UPDATE BANNER ============
// Стратегия: SW не активируется автоматически (см. sw.js — убран skipWaiting).
// Когда есть новая версия — показываем баннер «Доступно обновление», пользователь
// сам решает когда нажать кнопку. Если в этот момент он что-то заполняет —
// успеет сохранить.

let _swUpdateBannerShown = false;
let _swReloadingNow = false;

function _ensureUpdateBannerStyles() {
  if (document.getElementById('sw-update-banner-styles')) return;
  const css = document.createElement('style');
  css.id = 'sw-update-banner-styles';
  css.textContent = `
    #sw-update-banner {
      position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
      background: linear-gradient(135deg, #2563EB, #7C3AED);
      color: #fff; border-radius: 14px;
      padding: 12px 14px;
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
      box-shadow: 0 8px 32px rgba(37,99,235,0.35);
      z-index: 999999;
      width: min(460px, calc(100vw - 24px));
      box-sizing: border-box;
      animation: swUpdSlideUp 0.25s ease-out;
    }
    @keyframes swUpdSlideUp { from { transform: translate(-50%, 30px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
    #sw-update-banner .swu-icon { font-size: 22px; opacity: 0.95; flex-shrink: 0; }
    #sw-update-banner .swu-text { line-height: 1.3; flex: 1; min-width: 0; }
    #sw-update-banner .swu-text b { font-size: 14px; display: block; }
    #sw-update-banner .swu-text small { display:block; font-size:12px; opacity: 0.9; margin-top:2px; }
    #sw-update-banner .swu-actions { display:flex; align-items:center; gap:4px; flex-shrink:0; }
    #sw-update-banner button.swu-go {
      background: #fff; color: #2563EB; border: 0;
      border-radius: 9px; padding: 9px 16px;
      font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap;
      transition: transform .12s ease, box-shadow .12s ease;
    }
    #sw-update-banner button.swu-go:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
    #sw-update-banner button.swu-close {
      background: transparent; color: #fff; opacity: 0.75; border: 0;
      padding: 6px; cursor: pointer; font-size: 16px; line-height: 1;
    }
    #sw-update-banner button.swu-close:hover { opacity: 1; }
    @media (max-width: 460px) {
      #sw-update-banner .swu-actions { width: 100%; justify-content: flex-end; margin-top: 2px; }
      #sw-update-banner button.swu-go { flex: 1; }
    }
  `;
  document.head.appendChild(css);
}

function _showUpdateBanner() {
  if (_swUpdateBannerShown || document.getElementById('sw-update-banner')) return;
  _swUpdateBannerShown = true;
  _ensureUpdateBannerStyles();
  const banner = document.createElement('div');
  banner.id = 'sw-update-banner';
  banner.innerHTML =
    '<i class="ti ti-refresh swu-icon"></i>' +
    '<div class="swu-text"><b>Доступно обновление</b><small id="swu-ver">Узнаём версию…</small></div>' +
    '<div class="swu-actions">' +
      '<button class="swu-go" onclick="applySWUpdate()">Обновить</button>' +
      '<button class="swu-close" onclick="dismissSWUpdate()" title="Скрыть"><i class="ti ti-x"></i></button>' +
    '</div>';
  document.body.appendChild(banner);
  // Подтягиваем какая именно версия готова к установке
  fetch('/version.json?_=' + Date.now(), { cache: 'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then(v => {
      const el = document.getElementById('swu-ver');
      if (!el) return;
      if (v && v.version) {
        el.innerHTML = 'Версия <b>' + escapeHtml(v.version) + '</b>' +
          (v.label ? ' · ' + escapeHtml(v.label) : '') +
          '<br>Нажмите, когда закончите с формой';
      } else {
        el.textContent = 'Нажмите, когда закончите с формой';
      }
    })
    .catch(() => {
      const el = document.getElementById('swu-ver');
      if (el) el.textContent = 'Нажмите, когда закончите с формой';
    });
}

function applySWUpdate() {
  // Если есть несохранённые черновики — спрашиваем подтверждение
  if (typeof hasUnsavedChanges === 'function' && hasUnsavedChanges()) {
    if (!confirm('Есть несохранённые изменения в формах. Сохрани сначала их, иначе данные потеряются. Обновить всё равно?')) return;
  }
  _swReloadingNow = true;
  navigator.serviceWorker.getRegistration().then(reg => {
    if (reg && reg.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
      // На случай если SW уже активировался — просто перезагружаемся
      window.location.reload();
    }
  });
}

function dismissSWUpdate() {
  const el = document.getElementById('sw-update-banner');
  if (el) el.remove();
  _swUpdateBannerShown = false;
  // Появится снова через час
  setTimeout(() => { _swUpdateBannerShown = false; }, 60 * 60 * 1000);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        // Если есть уже ожидающий SW при загрузке (мы его пропустили в прошлый раз)
        if (reg.waiting && navigator.serviceWorker.controller) {
          _showUpdateBanner();
        }
        // Слушаем установку нового SW
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              _showUpdateBanner();
            }
          });
        });
        // Периодически проверяем наличие обновлений (раз в 60 сек, только когда вкладка активна)
        setInterval(() => {
          if (document.visibilityState === 'visible') {
            reg.update().catch(() => {});
          }
        }, 60 * 1000);
      })
      .catch((err) => console.warn('SW registration failed:', err));

    // Когда новый SW взял управление — перезагружаемся (один раз)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (_swReloadingNow) return;
      _swReloadingNow = true;
      window.location.reload();
    });
  });
}

// ============ DIRTY-STATE TRACKER + beforeunload ============
// Глобальный реестр «есть несохранённые изменения». Формы добавляют сюда свой
// уникальный ключ при первой правке и удаляют после сохранения. Если что-то
// в реестре — браузер спросит «Точно уйти?» при закрытии/обновлении вкладки.

const _dirtyForms = new Set();

function markFormDirty(key) {
  if (!key) return;
  _dirtyForms.add(String(key));
}

function markFormClean(key) {
  if (!key) return;
  _dirtyForms.delete(String(key));
}

function hasUnsavedChanges() {
  return _dirtyForms.size > 0;
}

window.addEventListener('beforeunload', (e) => {
  if (_swReloadingNow) return;     // мы сами инициировали обновление — не мешаем
  if (!hasUnsavedChanges()) return;
  // Современные браузеры показывают свой текст, наш игнорируют — но триггерим
  e.preventDefault();
  e.returnValue = '';
  return '';
});

// ============================================================================
// МОНТАЖ (v2.45.346) — раздел для выездных монтажников
// ============================================================================
var _installCanManage = false;
var _installStatusLabels = { planned:'Запланирован', en_route:'Выехали', on_site:'На объекте', mounted:'Смонтировано', handed_over:'Сдан клиенту', cancelled:'Отменён' };
var _installStatusFlow = ['planned','en_route','on_site','mounted','handed_over'];
var _installCache = [];
var _installReportFiles = [];

function _installStatusColor(s) {
  return ({
    planned:     '#64748B',
    en_route:    '#D97706',
    on_site:     '#2563EB',
    mounted:     '#7C3AED',
    handed_over: '#15803D',
    cancelled:   '#B91C1C',
  })[s] || '#64748B';
}

function _installFmtDate(d) {
  if (!d) return '';
  var m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? (m[3] + '.' + m[2] + '.' + m[1]) : String(d);
}

// v2.45.394: дата+время для отметки «монтажник заходил»
function _installFmtDateTime(d) {
  if (!d) return '';
  var m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? (m[3] + '.' + m[2] + '.' + m[1] + ' ' + m[4] + ':' + m[5]) : String(d);
}

function setMobileInstallFilter(f, el) {
  try {
    document.querySelectorAll('#m-install-filter-chips .m-filter-chip').forEach(function (c) { c.classList.remove('active'); });
    if (el) el.classList.add('active');
  } catch (_) {}
  state.installFilter = f;
  loadInstallationList();
}

async function loadInstallationList() {
  var box = document.getElementById('installation-list-content');
  if (!box) return;
  state.installFilter = state.installFilter || 'all';
  box.innerHTML = '<div class="loading-block">Загружаем…</div>';

  var titles = { all:'Монтаж на объектах', active:'В работе', planned:'Запланированы', done:'Сданы' };
  var t = document.getElementById('installation-list-title');
  if (t) t.textContent = titles[state.installFilter] || 'Монтаж';

  // подсветка пункта сайдбара
  try {
    document.querySelectorAll('#sidebar-installation .nav-item[data-nav]').forEach(function (n) { n.classList.remove('active'); });
    var navKey = state.installFilter === 'all' ? 'installation-list' : 'installation-list-' + state.installFilter;
    var navEl = document.querySelector('#sidebar-installation .nav-item[data-nav="' + navKey + '"]');
    if (navEl) navEl.classList.add('active');
  } catch (_) {}

  try {
    var q = '/api/installations';
    if (state.installFilter === 'done')      q += '?status=handed_over';
    else if (state.installFilter === 'planned') q += '?status=planned';
    else if (state.installFilter === 'active')  q += '?include_done=0';
    var d = await apiGet(q);
    _installCanManage = !!d.can_manage;
    if (d.status_labels) _installStatusLabels = d.status_labels;
    if (d.status_flow)   _installStatusFlow = d.status_flow;
    _installCache = d.installations || [];
    var rows = _installCache;
    if (state.installFilter === 'active') rows = rows.filter(function (r) { return ['en_route','on_site','mounted'].indexOf(r.status) >= 0; });
    var c = document.getElementById('installation-counter');
    if (c) c.textContent = rows.length;
    renderInstallationList(rows);
    if (typeof applyPermissionsToUI === 'function') applyPermissionsToUI();
  } catch (e) {
    box.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i> ' + escapeHtml(String(e.message || e)) + '</div>';
  }
}

// v2.45.655: список монтажей v2 — группы по срочности, просрочки выезда кричат,
// статус-цепочка из 5 шагов и отчёты прямо в строке.
function _mntToday() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function _mntGroup(r, todayIso) {
  if (r.status === 'handed_over' || r.status === 'cancelled') return 'done';
  var d = String(r.scheduled_date || '').slice(0, 10);
  if (!d) return 'nodate';
  if (d < todayIso) return 'late';
  if (d === todayIso) return 'today';
  return 'upcoming';
}
function _mntRow(r, grp, todayIso) {
  var MONTHS = ['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК'];
  var isDone = r.status === 'handed_over';
  var isCancelled = r.status === 'cancelled';
  // Блок даты слева
  var dteHtml;
  var dIso = String(r.scheduled_date || '').slice(0, 10);
  if (!dIso) {
    dteHtml = '<div class="mnt-dte q"><b>дата?</b></div>';
  } else {
    var dd = new Date(dIso + 'T00:00:00');
    var lag = '';
    if (grp === 'late') {
      var days = Math.round((new Date(todayIso + 'T00:00:00') - dd) / 86400000);
      lag = '<span class="mnt-lag">−' + days + ' дн</span>';
    }
    dteHtml = '<div class="mnt-dte"><small>' + MONTHS[dd.getMonth()] + '</small><b>' + dd.getDate() + '</b>' + lag + '</div>';
  }
  // Заголовок: № договора · заказчик (без трёх повторов), иначе title
  var title, subBits = [];
  if (r.contract_number) {
    title = '<span class="mnt-num">' + escapeHtml(String(r.contract_number).replace(/^№\s*/, '№')) + '</span> · ' + escapeHtml(r.contractor_name || 'Монтаж');
    if (r.title && String(r.title).indexOf(String(r.contract_number)) < 0) subBits.push(escapeHtml(r.title));
  } else {
    title = escapeHtml(r.title || 'Монтаж');
  }
  subBits.unshift('<span class="mnt-adr">' + (r.object_address ? escapeHtml(r.object_address) : 'адрес не указан') + '</span>');
  if (grp === 'today') subBits.push('<b style="color:#1D4ED8;">сегодня</b>');
  else if (grp === 'upcoming' && dIso) {
    var inDays = Math.round((new Date(dIso + 'T00:00:00') - new Date(todayIso + 'T00:00:00')) / 86400000);
    subBits.push('через ' + inDays + ' ' + _plural(inDays, ['день', 'дня', 'дней']));
  }
  // Монтажник
  var whoHtml = r.assignee_name
    ? '<span class="mnt-ava">' + escapeHtml((typeof getInitials === 'function') ? getInitials(r.assignee_name) : r.assignee_name.slice(0, 2)) + '</span>' +
      '<span class="mnt-whonm">' + escapeHtml(r.assignee_name) + '</span>'
    : '<span class="mnt-none">монтажник не назначен</span>';
  // Статус-цепочка из 5 шагов
  var flow = _installStatusFlow && _installStatusFlow.length ? _installStatusFlow : ['planned', 'en_route', 'on_site', 'mounted', 'handed_over'];
  var idx = flow.indexOf(r.status);
  var steps = flow.map(function (s, i) {
    if (isCancelled) return '<i></i>';
    if (isDone) return '<i class="ok"></i>';
    return '<i class="' + (i <= idx ? 'on' : '') + '"></i>';
  }).join('');
  var stLbl = escapeHtml(_installStatusLabels[r.status] || r.status);
  if (grp === 'late' && idx <= 0) stLbl += ' · выезда не было';
  // Отчёты
  var repN = Number(r.reports_count || 0);
  var repCls = (repN === 0 && (grp === 'late' || grp === 'today')) ? ' zero' : '';
  return '<div class="mnt-r ' + grp + (isCancelled ? ' cancelled' : '') + '" onclick="openInstallationDetail(' + r.id + ')">' +
    dteHtml +
    '<div class="mnt-main">' +
      '<div class="mnt-t">' + title + '</div>' +
      '<div class="mnt-sub">' + subBits.join(' <span class="mnt-dot">·</span> ') + '</div>' +
    '</div>' +
    '<div class="mnt-who">' + whoHtml + '</div>' +
    '<div class="mnt-st"><div class="mnt-steps">' + steps + '</div><div class="mnt-stlbl">' + stLbl + '</div></div>' +
    '<div class="mnt-acts"><span class="mnt-rep' + repCls + '">отчётов: ' + repN + '</span><i class="ti ti-chevron-right mnt-chev"></i></div>' +
  '</div>';
}
function renderInstallationList(rows) {
  var box = document.getElementById('installation-list-content');
  if (!box) return;
  if (!rows.length) {
    box.innerHTML =
      '<div class="empty-block"><i class="ti ti-tools"></i>' +
      (state.installFilter === 'all' ? 'Монтажей пока нет. Они появятся из договоров «Поставка с монтажом» или создайте вручную.' : 'В этой группе пусто.') +
      '</div>';
    return;
  }
  var todayIso = _mntToday();
  var groups = { late: [], today: [], nodate: [], upcoming: [], done: [] };
  rows.forEach(function (r) { groups[_mntGroup(r, todayIso)].push(r); });
  groups.late.sort(function (a, b) { return String(a.scheduled_date || '').localeCompare(String(b.scheduled_date || '')); });
  groups.upcoming.sort(function (a, b) { return String(a.scheduled_date || '').localeCompare(String(b.scheduled_date || '')); });
  groups.done.sort(function (a, b) { return String(b.scheduled_date || b.updated_at || '').localeCompare(String(a.scheduled_date || a.updated_at || '')); });

  var html = '';
  // KPI-строка — только на «Все» (на фильтрах данные неполные)
  if (state.installFilter === 'all') {
    var monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    var doneMonth = groups.done.filter(function (r) {
      return r.status === 'handed_over' && String(r.scheduled_date || r.updated_at || '').slice(0, 10) >= monthAgo;
    }).length;
    html += '<div class="mnt-kpis">' +
      '<div class="mnt-kpi red"><div class="ic">🚨</div><div><div class="n">' + groups.late.length + '</div><div class="l">Выезд просрочен</div></div></div>' +
      '<div class="mnt-kpi blue"><div class="ic">📅</div><div><div class="n">' + groups.today.length + '</div><div class="l">Сегодня на объектах</div></div></div>' +
      '<div class="mnt-kpi amber"><div class="ic">❓</div><div><div class="n">' + groups.nodate.length + '</div><div class="l">Без даты выезда</div></div></div>' +
      '<div class="mnt-kpi gray"><div class="ic">🗓</div><div><div class="n">' + groups.upcoming.length + '</div><div class="l">Запланировано дальше</div></div></div>' +
      '<div class="mnt-kpi green"><div class="ic">✅</div><div><div class="n">' + doneMonth + '</div><div class="l">Сдано за месяц</div></div></div>' +
    '</div>';
  }
  function section(key, cls, icon, name) {
    var list = groups[key];
    if (!list.length) return;
    html += '<div class="mnt-sec' + (cls ? ' ' + cls : '') + '">' + icon + ' ' + name + ' <span class="cnt">' + list.length + '</span></div>';
    html += '<div class="mnt-list">' + list.map(function (r) { return _mntRow(r, key, todayIso); }).join('') + '</div>';
  }
  section('late', 'alarm', '🚨', 'Просрочен выезд');
  section('today', 'today', '📅', 'Сегодня');
  section('nodate', 'warn', '❓', 'Без даты выезда');
  section('upcoming', '', '🗓', 'Ближайшие');
  section('done', '', '✅', 'Сданы');
  box.innerHTML = html;
}

function _installModalEl() {
  var m = document.getElementById('installation-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'installation-modal';
    m.className = 'modal-overlay';
    m.onclick = function (e) { if (e.target === m) m.classList.remove('visible'); };
    document.body.appendChild(m);
  }
  return m;
}

async function openInstallationDetail(id) {
  var m = _installModalEl();
  m.innerHTML = '<div class="modal" onclick="event.stopPropagation()" style="max-width:680px;"><div style="padding:32px;text-align:center;color:var(--text-light);">Загружаем…</div></div>';
  m.classList.add('visible');
  try {
    var d = await apiGet('/api/installations/' + id);
    // v2.45.445: список монтажников для назначения прямо из карточки (только управляющим)
    if (d && d.can_manage) {
      try { var _ir = await apiGet('/api/installations/installers'); d._installers = (_ir && _ir.installers) || []; }
      catch (_) { d._installers = []; }
    }
    _renderInstallationDetail(d);
  } catch (e) {
    m.innerHTML = '<div class="modal" onclick="event.stopPropagation()" style="max-width:680px;"><div class="empty-block">' + escapeHtml(String(e.message || e)) + '</div></div>';
  }
}

function _renderInstallationDetail(d) {
  var m = _installModalEl();
  _installReportFiles = [];
  _montageChatFiles = [];
  var color = _installStatusColor(d.status);
  var canManage = !!d.can_manage;
  var canReport = !!d.can_report;

  // v2.45.656: степпер статуса вместо ленты кнопок — 5 шагов с галочками
  var _flowIdx = _installStatusFlow.indexOf(d.status);
  var _isDone = d.status === 'handed_over';
  var _isCancelled = d.status === 'cancelled';
  var flowHtml = '<div class="imd-steps">' + _installStatusFlow.map(function (s, i) {
    var cls = '';
    if (_isDone || i < _flowIdx) cls = 'done';
    else if (i === _flowIdx) cls = 'cur';
    return '<div class="imd-step ' + cls + '" onclick="changeInstallationStatus(' + d.id + ',\'' + s + '\')" ' +
      'title="Поставить статус «' + escapeHtml(_installStatusLabels[s] || s) + '»">' +
        '<span class="dot">' + ((_isDone || i < _flowIdx) ? '✓' : (i + 1)) + '</span>' +
        '<span class="lbl">' + escapeHtml(_installStatusLabels[s] || s) + '</span>' +
      '</div>';
  }).join('<span class="imd-step-line"></span>') + '</div>' +
  (_isCancelled ? '<div class="imd-cancelled"><i class="ti ti-ban"></i> Монтаж отменён</div>' : '');

  // v2.45.656: факт-плитки вместо строчек меты
  var _todayIso2 = _mntToday();
  var _dIso = String(d.scheduled_date || '').slice(0, 10);
  var _dateSub = '', _dateCls = '';
  if (_dIso && !_isDone && !_isCancelled) {
    var _dl = Math.round((new Date(_dIso + 'T00:00:00') - new Date(_todayIso2 + 'T00:00:00')) / 86400000);
    if (_dl < 0) { _dateSub = 'просрочен на ' + Math.abs(_dl) + ' ' + _plural(Math.abs(_dl), ['день', 'дня', 'дней']); _dateCls = 'bad'; }
    else if (_dl === 0) { _dateSub = 'сегодня'; _dateCls = 'hot'; }
    else _dateSub = 'через ' + _dl + ' ' + _plural(_dl, ['день', 'дня', 'дней']);
  } else if (_isDone) { _dateSub = 'сдан клиенту'; _dateCls = 'ok'; }
  var tiles = '';
  // v2.45.657: дата выезда меняется прямо в плитке (управляющим)
  tiles += '<div class="imd-tile' + (_dateCls ? ' ' + _dateCls : '') + '"><small>Выезд</small>' +
    '<b>' + (_dIso ? escapeHtml(_installFmtDate(d.scheduled_date)) : '<span class="imd-miss">дата не назначена</span>') + '</b>' +
    (_dateSub ? '<span>' + _dateSub + '</span>' : '') +
    (canManage
      ? '<input type="date" class="imd-date-inp" value="' + escapeHtml(_dIso) + '" ' +
        'title="Поменять дату выезда" onchange="_imdSetDate(' + d.id + ', this.value)">'
      : '') +
  '</div>';
  var _seenSub = '';
  if (d.assigned_employee_id) {
    _seenSub = d.installer_first_opened_at
      ? '<span class="imd-ok">заходил: ' + escapeHtml(_installFmtDateTime(d.installer_last_seen_at || d.installer_first_opened_at)) +
        ((d.installer_open_count || 0) > 1 ? ' · ' + d.installer_open_count + ' р.' : '') + '</span>'
      : '<span class="imd-warn">ещё не открывал монтаж</span>';
  }
  tiles += '<div class="imd-tile"><small>Монтажник</small>' +
    '<b>' + (d.assignee_name ? escapeHtml(d.assignee_name) : '<span class="imd-miss">не назначен</span>') + '</b>' + _seenSub + '</div>';
  if (d.object_address) {
    tiles += '<div class="imd-tile click" onclick="window.open(\'https://yandex.ru/maps/?text=' +
      encodeURIComponent(d.object_address) + '\', \'_blank\')"><small>Адрес объекта</small>' +
      '<b>📍 ' + escapeHtml(d.object_address) + '</b><span>открыть на карте →</span></div>';
  } else {
    tiles += '<div class="imd-tile"><small>Адрес объекта</small><b><span class="imd-miss">не указан</span></b></div>';
  }
  if (d.contract_number) {
    tiles += '<div class="imd-tile' + (d.contract_id ? ' click" onclick="document.getElementById(\'installation-modal\').classList.remove(\'visible\');openContractDetail(' + d.contract_id + ')"' : '"') + '>' +
      '<small>Договор</small><b>' + escapeHtml(d.contract_number) + '</b>' +
      '<span>' + escapeHtml(d.contractor_name || '') + (d.contractor_phone ? ' · ' + escapeHtml(d.contractor_phone) : '') + (d.contract_id ? ' →' : '') + '</span></div>';
  }
  // v2.45.657: с кем держать связь на объекте (контакт заказчика)
  var _cName = d.contact_name || '';
  var _cPhone = d.contact_phone || '';
  var _cArgs = JSON.stringify(_cName).replace(/"/g, '&quot;') + ', ' + JSON.stringify(_cPhone).replace(/"/g, '&quot;');
  tiles += '<div class="imd-tile wide rel"><small>Связь на объекте</small>' +
    (canManage
      ? '<button class="imd-pencil" title="Указать контакт" onclick="event.stopPropagation();_imdEditContact(' + d.id + ', ' + _cArgs + ')"><i class="ti ti-pencil"></i></button>'
      : '') +
    ((_cName || _cPhone)
      ? '<b>' + escapeHtml(_cName || 'Контакт') + '</b>' +
        (_cPhone
          ? '<span><a class="imd-tel" href="tel:' + escapeHtml(_cPhone.replace(/[^+\d]/g, '')) + '" onclick="event.stopPropagation()">📞 ' + escapeHtml(_cPhone) + '</a></span>'
          : '')
      : '<b><span class="imd-miss">контакт не указан</span></b>' +
        (canManage ? '<span>кому звонить с объекта — тапни ✎</span>' : '')) +
  '</div>';
  var tilesHtml = '<div class="imd-facts">' + tiles + '</div>';

  // v2.45.656: отчёты — таймлайн с точками, чипом смены статуса и фото
  var reportsHtml = (d.reports || []).map(function (r) {
    var photos = (r.photos || []).map(function (p) {
      var url = API_BASE + p.url;
      if ((p.content_type || '').indexOf('image/') === 0) {
        return '<a href="' + url + '" target="_blank" class="ir-thumb"><img src="' + url + '" loading="lazy"></a>';
      }
      var ic = ((p.content_type || '').indexOf('video/') === 0) ? 'ti-video' : 'ti-file';
      return '<a href="' + url + '" target="_blank" class="ir-fileatt"><i class="ti ' + ic + '"></i><span>' + escapeHtml(p.name || 'Файл') + '</span></a>';
    }).join('');
    var stChip = r.status_to_label
      ? '<span class="imd-tst" style="color:' + _installStatusColor(r.status_to) + ';border-color:' + _installStatusColor(r.status_to) + ';">→ ' + escapeHtml(r.status_to_label) + '</span>'
      : '';
    return '<div class="imd-tle' + (r.status_to ? ' has-status' : '') + '">' +
      '<div class="imd-tle-h"><b>' + escapeHtml(r.author_name || 'Монтажник') + '</b>' + stChip +
        '<span class="tm">' + escapeHtml(String(r.created_at || '').slice(0, 16).replace('T', ' ')) + '</span></div>' +
      (r.text ? '<div class="imd-tle-txt">' + escapeHtml(r.text) + '</div>' : '') +
      (photos ? '<div class="imd-tle-ph">' + photos + '</div>' : '') +
    '</div>';
  }).join('');
  reportsHtml = reportsHtml
    ? '<div class="imd-tl">' + reportsHtml + '</div>'
    : '<div class="imd-noreports"><i class="ti ti-message-off"></i> Отчётов с поля пока нет' +
      (_dateCls === 'bad' ? ' — а дата выезда уже прошла' : '') + '.</div>';

  // статусы для select в форме отчёта
  var statusOptions = '<option value="">— не менять статус —</option>' + _installStatusFlow.map(function (s) {
    return '<option value="' + s + '">' + escapeHtml(_installStatusLabels[s]) + '</option>';
  }).join('');

  var reportForm = canReport ?
    '<div class="ir-form">' +
      '<div class="ir-form-title"><i class="ti ti-send"></i> Новый отчёт с поля</div>' +
      '<textarea id="install-report-text" class="ir-textarea" rows="3" placeholder="Что сделано на объекте…"></textarea>' +
      '<select id="install-report-status" class="ir-select">' + statusOptions + '</select>' +
      '<div class="ir-attach-row">' +
        '<label class="ir-attach-btn"><i class="ti ti-camera"></i> Фото' +
          '<input type="file" accept="image/*" capture="environment" multiple style="display:none;" onchange="onInstallReportFiles(this)"></label>' +
        '<label class="ir-attach-btn"><i class="ti ti-paperclip"></i> Файл' +
          '<input type="file" accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" multiple style="display:none;" onchange="onInstallReportFiles(this)"></label>' +
      '</div>' +
      '<div id="install-report-files" class="ir-files"></div>' +
      '<button class="btn btn-primary ir-send" onclick="submitInstallationReport(' + d.id + ')"><i class="ti ti-check"></i> Отправить отчёт</button>' +
    '</div>' : '';

  var manageBtns = canManage ?
    '<button class="btn btn-secondary btn-small" onclick="openEditInstallation(' + d.id + ')"><i class="ti ti-edit"></i> Изменить</button>' +
    '<button class="btn btn-secondary btn-small" onclick="deleteInstallation(' + d.id + ')" style="color:var(--danger,#B91C1C);"><i class="ti ti-trash"></i></button>' : '';

  // v2.45.383: что назначено по договору (установить/демонтировать/работы/материалы) — видит исполнитель
  var _idiCfg = { install: ['Что установить', 'ti-tool'], dismantle: ['Что демонтировать', 'ti-trash-x'], work: ['Монтажные работы', 'ti-checklist'], material: ['Материалы', 'ti-packages'] };
  var itemsHtml = '';
  ['install', 'dismantle', 'work', 'material'].forEach(function (k) {
    var list = (d.install_items || []).filter(function (x) { return x.kind === k; });
    if (!list.length) return;
    itemsHtml += '<div class="idi-sec"><div class="idi-sec-h"><i class="ti ' + _idiCfg[k][1] + '"></i> ' + _idiCfg[k][0] + ' <span class="idi-cnt">' + list.length + '</span></div>';
    list.forEach(function (it) {
      var mt = [];
      if (k !== 'work') mt.push((parseFloat(it.qty) || 0) + ' ' + escapeHtml(it.unit || 'шт.'));
      if (it.location) mt.push(escapeHtml(it.location));
      itemsHtml += '<div class="idi-row' + (it.status === 'done' ? ' done' : '') + '"><span class="idi-name">' + escapeHtml(it.name || '') + '</span>' +
        (mt.length ? '<span class="idi-meta">' + mt.join(' · ') + '</span>' : '') + '</div>';
    });
    itemsHtml += '</div>';
  });
  if (itemsHtml) itemsHtml = '<div class="idi-wrap"><div class="idi-title"><i class="ti ti-clipboard-list"></i> Что нужно сделать по договору</div>' + itemsHtml + '</div>';

  // v2.45.447: спецификация договора (что монтировать) — для исполнителя
  // v2.45.658: количество «сколько монтировать в этот выезд» редактируется тапом
  // (переопределение хранится на монтаже, спецификация договора не меняется)
  var specHtml = '';
  if (d.contract_spec && d.contract_spec.length) {
    window._imdSpecOv = {};
    d.contract_spec.forEach(function (s) {
      if (s.mount_qty != null && Number(s.mount_qty) !== Number(s.qty)) {
        window._imdSpecOv[String(s.name || '')] = Number(s.mount_qty);
      }
    });
    specHtml = '<div class="idi-wrap"><div class="idi-title"><i class="ti ti-list-details"></i> Спецификация — что монтировать <span class="idi-cnt">' + d.contract_spec.length + '</span></div>';
    d.contract_spec.forEach(function (s) {
      var cq = parseFloat(s.qty) || 0;
      var mq = (s.mount_qty != null) ? (parseFloat(s.mount_qty) || 0) : cq;
      var changed = mq !== cq;
      var unit = escapeHtml(s.unit || 'шт.');
      var qtyInner = mq + ' ' + unit + (changed ? ' <small class="idi-ovhint">из ' + cq + '</small>' : '');
      var qtyHtml = canManage
        ? '<span class="idi-meta idi-qty' + (changed ? ' ov' : '') + '" ' +
            'onclick="_imdEditSpecQty(' + d.id + ', ' + JSON.stringify(String(s.name || '')).replace(/"/g, '&quot;') + ', ' + mq + ', ' + cq + ')" ' +
            'title="' + (changed ? 'По договору: ' + cq + ' · ' : '') + 'Тапни, чтобы изменить, сколько монтировать в этот выезд">' +
            qtyInner + ' <i class="ti ti-pencil"></i></span>'
        : '<span class="idi-meta">' + qtyInner + '</span>';
      specHtml += '<div class="idi-row' + (mq <= 0 ? ' idi-skip' : '') + '"><span class="idi-name">' + escapeHtml(s.name || '—') + '</span>' + qtyHtml + '</div>';
    });
    specHtml += '</div>';
  }
  // v2.45.448: встроенный чат+файлы по договору прямо в карточке (не отдельное окно)
  var chatBlock = d.contract_id ? (
    '<div class="imc-chat">' +
      '<div class="imc-chat-title"><i class="ti ti-message-circle"></i> Чат и файлы по договору</div>' +
      '<div class="imc-chat-msgs" id="imc-chat-msgs"><div class="imc-empty">Загружаем…</div></div>' +
      '<textarea id="imc-chat-input" class="imc-chat-ta" rows="2" placeholder="Написать сообщение / вопрос по объекту…"></textarea>' +
      '<div class="imc-chat-actions">' +
        '<label class="imc-chat-attach"><i class="ti ti-paperclip"></i> Файл' +
          '<input type="file" multiple accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" style="display:none" onchange="onMontageChatFiles(this)"></label>' +
        '<span id="imc-chat-files" class="imc-chat-files"></span>' +
        '<button class="btn btn-primary imc-chat-send" onclick="sendMontageChat(' + d.contract_id + ')"><i class="ti ti-send"></i> Отправить</button>' +
      '</div>' +
    '</div>'
  ) : '';

  // v2.45.445: назначение монтажника прямо в карточке (управляющим)
  var assigneeCtrl = '';
  if (canManage) {
    var _ins = d._installers || [];
    var _opts = '<option value="">— не назначен —</option>' + _ins.map(function (e) {
      return '<option value="' + e.id + '"' + (String(d.assigned_employee_id) === String(e.id) ? ' selected' : '') + '>' + escapeHtml(e.name) + '</option>';
    }).join('');
    assigneeCtrl = '<div class="idet-assignee">' +
      '<span class="idet-assignee-label"><i class="ti ti-user-cog"></i> Монтажник</span>' +
      '<select class="idet-assignee-select" onchange="assignInstallationInstaller(' + d.id + ', this.value)">' + _opts + '</select>' +
      (_ins.length ? '' : '<div class="idet-assignee-hint">Нет монтажников — заведите сотрудника с правом «Монтаж»</div>') +
    '</div>';
  }

  m.innerHTML =
    '<div class="modal imd-modal" onclick="event.stopPropagation()" style="max-width:720px;">' +
      '<div class="imd-hero">' +
        '<button class="imd-x" onclick="document.getElementById(\'installation-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
        '<div class="imd-hero-top">' +
          '<span class="imd-status" style="background:' + color + ';">' + escapeHtml(_installStatusLabels[d.status] || d.status) + '</span>' +
          (manageBtns ? '<div class="imd-mng">' + manageBtns + '</div>' : '') +
        '</div>' +
        '<div class="imd-title"><i class="ti ti-tools"></i> ' + escapeHtml(d.title || 'Монтаж') + '</div>' +
      '</div>' +
      '<div class="imd-body">' +
        tilesHtml +
        assigneeCtrl +
        '<div class="imd-sec-t">Статус монтажа <small>· тапни шаг, чтобы сменить</small></div>' +
        flowHtml +
        (d.notes ? '<div class="imd-notes"><b>Детали для монтажника</b>' + escapeHtml(d.notes) + '</div>' : '') +
        itemsHtml +
        specHtml +
        '<div class="imd-sec-t">Отчёты с поля' + ((d.reports || []).length ? ' <span class="imd-cnt">' + d.reports.length + '</span>' : '') + '</div>' +
        reportsHtml +
        reportForm +
        chatBlock +
      '</div>' +
    '</div>';
  m.classList.add('visible');
  // v2.45.448: подгрузить встроенный чат по договору
  if (d.contract_id) loadMontageChat(d.contract_id);
}

// v2.45.657: сменить дату выезда прямо из плитки карточки
async function _imdSetDate(installationId, val) {
  try {
    await apiPatch('/api/installations/' + installationId, { scheduled_date: val || '' });
    if (typeof showToast === 'function') showToast(val ? 'Дата выезда обновлена' : 'Дата выезда снята', 'success');
    await openInstallationDetail(installationId);
    if (typeof loadInstallationList === 'function') loadInstallationList();
  } catch (e) {
    if (typeof showToast === 'function') showToast('Не удалось сохранить дату', 'error');
  }
}
// v2.45.658: сколько штук монтировать в этот выезд — правится тапом по количеству.
// Пусто — вернуть как по договору, 0 — в этом монтаже позицию не монтируем.
async function _imdEditSpecQty(installationId, name, current, contractQty) {
  var v = prompt(
    'Сколько монтировать: «' + name + '»?\n\n' +
    'По договору: ' + contractQty + '. Пусто — вернуть как по договору. 0 — в этот выезд не монтируем.',
    String(current)
  );
  if (v === null) return;
  var map = window._imdSpecOv || {};
  var t = String(v).trim().replace(',', '.');
  if (!t) {
    delete map[name];
  } else {
    var n = Number(t);
    if (!isFinite(n) || n < 0) {
      if (typeof showToast === 'function') showToast('Введите неотрицательное число', 'error');
      return;
    }
    if (n === Number(contractQty)) delete map[name];
    else map[name] = n;
  }
  try {
    await apiPatch('/api/installations/' + installationId, { spec_overrides: map });
    if (typeof showToast === 'function') showToast('Количество на монтаж сохранено', 'success');
    await openInstallationDetail(installationId);
  } catch (e) {
    if (typeof showToast === 'function') showToast('Не удалось сохранить количество', 'error');
  }
}

// v2.45.657: контакт заказчика на объекте — с кем держать связь
async function _imdEditContact(installationId, curName, curPhone) {
  var nm = prompt('С кем держать связь на объекте? (имя, должность)', curName || '');
  if (nm === null) return;
  var ph = prompt('Телефон контакта', curPhone || '');
  if (ph === null) return;
  try {
    await apiPatch('/api/installations/' + installationId, { contact_name: nm.trim(), contact_phone: ph.trim() });
    if (typeof showToast === 'function') showToast('Контакт на объекте сохранён', 'success');
    await openInstallationDetail(installationId);
  } catch (e) {
    if (typeof showToast === 'function') showToast('Не удалось сохранить контакт', 'error');
  }
}

// v2.45.445: назначить/сменить монтажника прямо из карточки монтажа
async function assignInstallationInstaller(installationId, empId) {
  try {
    await apiPatch('/api/installations/' + installationId, { assigned_employee_id: empId ? parseInt(empId, 10) : null });
    if (typeof showToast === 'function') showToast(empId ? 'Монтажник назначен' : 'Назначение снято', 'success');
    await openInstallationDetail(installationId);
    if (typeof loadInstallationList === 'function') loadInstallationList();
  } catch (e) {
    if (typeof showToast === 'function') showToast('Не удалось назначить монтажника', 'error');
  }
}

function onInstallReportFiles(input) {
  Array.prototype.slice.call(input.files || []).forEach(function (f) {
    if (_installReportFiles.length < 5) _installReportFiles.push(f);
  });
  input.value = '';
  renderInstallReportFiles();
}

function renderInstallReportFiles() {
  var box = document.getElementById('install-report-files');
  if (!box) return;
  box.innerHTML = _installReportFiles.map(function (f, i) {
    var isImg = (f.type || '').indexOf('image/') === 0;
    return '<span class="ir-chip"><i class="ti ' + (isImg ? 'ti-photo' : 'ti-file') + '"></i>' +
      '<span class="ir-chip-name">' + escapeHtml(f.name) + '</span>' +
      '<button onclick="removeInstallReportFile(' + i + ')" title="Убрать"><i class="ti ti-x"></i></button></span>';
  }).join('');
}

function removeInstallReportFile(i) {
  _installReportFiles.splice(i, 1);
  renderInstallReportFiles();
}

// v2.45.448: встроенный чат+файлы по договору прямо в карточке монтажа
// (переиспользуем backend контрактного чата /api/contracts/{id}/chat)
var _montageChatFiles = [];

async function loadMontageChat(cid) {
  var box = document.getElementById('imc-chat-msgs');
  if (!box) return;
  try {
    var r = await apiGet('/api/contracts/' + cid + '/chat');
    _renderMontageChatMsgs(r);
  } catch (e) {
    box.innerHTML = '<div class="imc-empty">Не удалось загрузить чат</div>';
  }
}

function _renderMontageChatMsgs(r) {
  var box = document.getElementById('imc-chat-msgs');
  if (!box) return;
  var msgs = (r && r.messages) || [];
  var myId = r && r.my_chat_id;
  if (!msgs.length) {
    box.innerHTML = '<div class="imc-empty">Сообщений пока нет. Напишите первое — все по договору увидят.</div>';
    return;
  }
  var html = '';
  msgs.forEach(function (m) {
    var time = (m.created_at || '').slice(11, 16);
    if (m.is_system) {
      html += '<div class="imc-sys">' + escapeHtml(m.text || '') + (time ? ' · ' + escapeHtml(time) : '') + '</div>';
      return;
    }
    var isMine = (m.author_chat_id === myId);
    var author = m.author_name || (isMine ? 'Я' : 'Сотрудник');
    var filesHtml = '';
    (m.files || []).forEach(function (f) {
      var url = API_BASE + '/api/contracts/chat/files/' + f.id;
      if (f.kind === 'photo') {
        filesHtml += '<a href="' + url + '" target="_blank" class="imc-img"><img src="' + url + '" loading="lazy"></a>';
      } else if (f.kind === 'video') {
        filesHtml += '<a href="' + url + '" target="_blank" class="imc-file"><i class="ti ti-video"></i><span>' + escapeHtml(f.original_name || 'Видео') + '</span></a>';
      } else {
        filesHtml += '<a href="' + url + '" target="_blank" class="imc-file"><i class="ti ti-file"></i><span>' + escapeHtml(f.original_name || 'Файл') + '</span></a>';
      }
    });
    html += '<div class="imc-msg' + (isMine ? ' mine' : '') + '">' +
      '<div class="imc-author">' + escapeHtml(author) + (time ? ' · ' + escapeHtml(time) : '') + '</div>' +
      (m.text ? '<div class="imc-text">' + escapeHtml(m.text).replace(/\n/g, '<br>') + '</div>' : '') +
      (filesHtml ? '<div class="imc-files-row">' + filesHtml + '</div>' : '') +
    '</div>';
  });
  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;
}

function onMontageChatFiles(input) {
  Array.prototype.slice.call(input.files || []).forEach(function (f) {
    if (_montageChatFiles.length < 5) _montageChatFiles.push(f);
  });
  input.value = '';
  _renderMontageChatFiles();
}

function _renderMontageChatFiles() {
  var box = document.getElementById('imc-chat-files');
  if (!box) return;
  box.innerHTML = _montageChatFiles.map(function (f, i) {
    var isImg = (f.type || '').indexOf('image/') === 0;
    return '<span class="imc-chip"><i class="ti ' + (isImg ? 'ti-photo' : 'ti-file') + '"></i>' +
      '<span class="imc-chip-name">' + escapeHtml(f.name) + '</span>' +
      '<button onclick="removeMontageChatFile(' + i + ')" title="Убрать"><i class="ti ti-x"></i></button></span>';
  }).join('');
}

function removeMontageChatFile(i) {
  _montageChatFiles.splice(i, 1);
  _renderMontageChatFiles();
}

async function sendMontageChat(cid) {
  var inp = document.getElementById('imc-chat-input');
  var text = (inp && inp.value || '').trim();
  if (!text && !_montageChatFiles.length) { showToast('Напишите сообщение или прикрепите файл', 'error'); return; }
  try {
    var token = localStorage.getItem(TOKEN_KEY);
    var resp;
    if (_montageChatFiles.length) {
      var fd = new FormData();
      if (text) fd.append('text', text);
      _montageChatFiles.forEach(function (f, i) { fd.append('file_' + (i + 1), f, f.name); });
      resp = await fetch(API_BASE + '/api/contracts/' + cid + '/chat', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: fd,
      });
    } else {
      resp = await fetch(API_BASE + '/api/contracts/' + cid + '/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ text: text }),
      });
    }
    if (!resp.ok) { var e = await resp.json().catch(function () { return {}; }); showToast(e.message || e.error || 'Не отправилось', 'error'); return; }
    if (inp) inp.value = '';
    _montageChatFiles = [];
    _renderMontageChatFiles();
    await loadMontageChat(cid);
  } catch (e) { showToast('Ошибка соединения', 'error'); }
}

async function submitInstallationReport(id) {
  var text = (document.getElementById('install-report-text') || {}).value || '';
  var status = (document.getElementById('install-report-status') || {}).value || '';
  if (!text.trim() && !_installReportFiles.length && !status) {
    showToast('Добавьте комментарий, файл или смену статуса', 'error');
    return;
  }
  var fd = new FormData();
  fd.append('text', text);
  if (status) fd.append('status', status);
  _installReportFiles.forEach(function (f, i) { fd.append('file_' + (i + 1), f, f.name); });
  try {
    var token = localStorage.getItem(TOKEN_KEY);
    var r = await fetch(API_BASE + '/api/installations/' + id + '/reports', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: fd,
    });
    if (!r.ok) { var e = await r.json().catch(function () { return {}; }); showToast(e.message || 'Не удалось отправить', 'error'); return; }
    showToast('Отчёт отправлен', 'success');
    _installReportFiles = [];
    await openInstallationDetail(id);
    loadInstallationList();
  } catch (e) { showToast('Ошибка соединения', 'error'); }
}

async function changeInstallationStatus(id, status) {
  try {
    await apiPatch('/api/installations/' + id, { status: status });
    showToast('Статус: ' + (_installStatusLabels[status] || status), 'success');
    await openInstallationDetail(id);
    loadInstallationList();
  } catch (e) { showToast(String(e.message || e), 'error'); }
}

async function deleteInstallation(id) {
  if (!confirm('Удалить карточку монтажа? Она скроется из списка.')) return;
  try {
    await apiDelete('/api/installations/' + id);
    document.getElementById('installation-modal').classList.remove('visible');
    showToast('Удалено', 'success');
    loadInstallationList();
  } catch (e) { showToast(String(e.message || e), 'error'); }
}

async function openNewInstallation() { _openInstallationForm(null); }
async function openEditInstallation(id) {
  var inst = (_installCache || []).find(function (r) { return r.id === id; });
  if (!inst) { try { inst = await apiGet('/api/installations/' + id); } catch (e) {} }
  _openInstallationForm(inst);
}

async function _openInstallationForm(inst) {
  var m = _installModalEl();
  var isEdit = !!inst;
  // подгрузим монтажников для назначения
  var installers = [];
  try { var di = await apiGet('/api/installations/installers'); installers = di.installers || []; } catch (e) {}
  var optHtml = '<option value="">— не назначен —</option>' + installers.map(function (p) {
    return '<option value="' + p.id + '"' + (inst && inst.assigned_employee_id === p.id ? ' selected' : '') + '>' + escapeHtml(p.name) + '</option>';
  }).join('');
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:560px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-tools"></i> ' + (isEdit ? 'Изменить монтаж' : 'Новый монтаж') + '</h3>' +
        '<button class="modal-close" onclick="document.getElementById(\'installation-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="if-form" style="padding:18px;max-height:74vh;overflow:auto;display:flex;flex-direction:column;gap:14px;">' +
        '<label>Что монтировать <span style="color:var(--danger,#B91C1C)">*</span><input type="text" id="if-title" value="' + escapeHtml(inst && inst.title || '') + '" placeholder="Например: монтаж щита ЩУ-003 на объекте"></label>' +
        '<label>Адрес / объект<input type="text" id="if-address" value="' + escapeHtml(inst && inst.object_address || '') + '" placeholder="г. Челябинск, ул. …"></label>' +
        '<label>Дата монтажа<input type="date" id="if-date" value="' + escapeHtml(inst && inst.scheduled_date || '') + '"></label>' +
        '<label>Монтажник<select id="if-assignee">' + optHtml + '</select></label>' +
        '<label>Связь на объекте — кто<input type="text" id="if-contact-name" value="' + escapeHtml(inst && inst.contact_name || '') + '" placeholder="Иван Петрович, прораб"></label>' +
        '<label>Телефон контакта<input type="tel" id="if-contact-phone" value="' + escapeHtml(inst && inst.contact_phone || '') + '" placeholder="+7 …"></label>' +
        '<label>Детали для монтажника<textarea id="if-notes" rows="3" placeholder="Состав, нюансы, контакты на объекте…">' + escapeHtml(inst && inst.notes || '') + '</textarea></label>' +
      '</div>' +
      '<div class="modal-footer" style="padding:14px 18px;display:flex;justify-content:flex-end;gap:8px;">' +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'installation-modal\').classList.remove(\'visible\')">Отмена</button>' +
        '<button class="btn btn-primary" onclick="submitInstallationForm(' + (isEdit ? inst.id : 'null') + ')"><i class="ti ti-check"></i> ' + (isEdit ? 'Сохранить' : 'Создать') + '</button>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
}

async function submitInstallationForm(id) {
  var title = (document.getElementById('if-title') || {}).value || '';
  if (!title.trim()) { showToast('Укажите что монтировать', 'error'); return; }
  var body = {
    title: title.trim(),
    object_address: (document.getElementById('if-address') || {}).value || '',
    scheduled_date: (document.getElementById('if-date') || {}).value || '',
    assigned_employee_id: parseInt((document.getElementById('if-assignee') || {}).value, 10) || null,
    notes: (document.getElementById('if-notes') || {}).value || '',
    contact_name: (document.getElementById('if-contact-name') || {}).value || '',
    contact_phone: (document.getElementById('if-contact-phone') || {}).value || '',
  };
  try {
    if (id) { await apiPatch('/api/installations/' + id, body); showToast('Сохранено', 'success'); }
    else {
      var r = await apiPost('/api/installations', body);
      if (!r.ok) { showToast((r.data && (r.data.message || r.data.error)) || 'Ошибка', 'error'); return; }
      showToast('Монтаж создан', 'success');
    }
    document.getElementById('installation-modal').classList.remove('visible');
    loadInstallationList();
  } catch (e) { showToast(String(e.message || e), 'error'); }
}
// ============ v2.45.344: Утреннее окно мастеру — отметка % готовности ============
// Раз в день мастеру (роль 'master') показываем ОБЯЗАТЕЛЬНОЕ окно: проставить
// процент готовности по каждому договору «в производстве». Окно нельзя закрыть,
// пока не проставлены все позиции.
// ВНИМАНИЕ: хранение пока ЛОКАЛЬНОЕ (localStorage этого устройства). Чтобы прогресс
// видели все (директор и пр.), нужен бэкенд-эндпоинт: POST {date, contract_id, pct, user}.
const MORNING_PROGRESS_KEY = 'atomus_morning_progress_v1';

function _mpToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function _mpLoadStore() { try { return JSON.parse(localStorage.getItem(MORNING_PROGRESS_KEY) || '{}'); } catch (e) { return {}; } }
function _mpSaveStore(o) { try { localStorage.setItem(MORNING_PROGRESS_KEY, JSON.stringify(o)); } catch (e) {} }

// Триггер — вызывается из showApp() после логина. Никогда не валит приложение.
async function _maybeMorningProgress() {
  try {
    const roles = (state.user && state.user.roles) || [];
    // v2.45.359: только мастеру (и НЕ директору) — у директора роль master тоже есть
    if (!roles.includes('master') || roles.includes('director')) return;
    // v2.45.659: бухгалтеру утреннее окно не показываем, даже если у него есть
    // роль master — «Начать смену» и вопросы про людей только у мастера цеха
    if (roles.includes('accountant')) return;
    // v2.45.404: Михаил Шевелёв пока не заполняет утреннюю готовность — не показываем
    if (typeof _isShevelevMaster === 'function' && _isShevelevMaster()) return;
    if (document.getElementById('morning-progress-overlay')) return;
    // v2.45.680: показываем максимум ОДИН раз за день. Раньше окно всплывало при
    // каждом открытии/перезагрузке, пока % не подтверждён — теперь, если сегодня уже
    // показывали, больше не дёргаем (даже если мастер закрыл без «Начать смену»).
    try { const _s0 = _mpLoadStore(); if (_s0[_mpToday()] && _s0[_mpToday()]._shown) return; } catch (e) {}
    // v2.45.364: только то, что «В работе» в производстве (production works status=in_progress),
    // и сразу подставляем текущий % готовности с карточки канбана
    let active = [];
    try { const d = await apiGet('/api/production/works?status=in_progress'); active = (d && d.works) || []; }
    catch (e) { active = []; }
    active = active.filter(w => w && w.status === 'in_progress');
    // v2.45.649: «вчера без записей» — люди без журнала за последний рабочий день.
    // Сервер возвращает только неотвеченных, поэтому после сабмита окно не повторяется.
    let gaps = null;
    try { const g = await apiGet('/api/production/day-gaps'); if (g && g.people && g.people.length) gaps = g; }
    catch (e) { gaps = null; }
    const rec = (_mpLoadStore()[_mpToday()]) || {};
    const pctPending = active.length > 0 && !active.every(w => rec[w.id] != null);
    if (!pctPending && !gaps) return;                      // ни %, ни вопросов — не мешаем
    // v2.45.680: отмечаем, что сегодня окно уже показали — повторно не всплывёт
    try { const _s = _mpLoadStore(); const _t = _mpToday(); _s[_t] = _s[_t] || {}; _s[_t]._shown = true; _mpSaveStore(_s); } catch (e) {}
    _renderMorningProgress(active, gaps);
  } catch (e) { /* окно не должно ломать вход в приложение */ }
}

function _renderMorningProgress(active, gaps) {
  const rec = (_mpLoadStore()[_mpToday()]) || {};
  state._mp = {
    active: active, filled: {},
    // v2.45.649: утренний опрос «чем занимался вчера»
    gaps: (gaps && gaps.people) || [],
    gapWorks: (gaps && gaps.works) || [],
    gapDate: (gaps && gaps.date) || '',
    gapAns: {},
  };
  state._mp.gaps.forEach(p => {
    state._mp.gapAns[p.employee_id] = { mode: null, work_id: null, hours: 7, off_kind: null, comment: '' };
  });
  // v2.45.364: пред-заполняем текущим % (rec за сегодня, иначе серверный progress с карточки)
  active.forEach(w => {
    const cur = (rec[w.id] != null) ? rec[w.id] : (w.progress != null ? Math.max(0, Math.min(100, parseInt(w.progress, 10) || 0)) : 0);
    state._mp.filled[w.id] = cur;
  });

  // v2.45.359: приветствие по имени-отчеству (ФИО = «Фамилия Имя Отчество» → «Имя Отчество»)
  const nm = (state.user && (state.user.full_name || state.user.name) || '').trim();
  const _np = nm.split(/\s+/).filter(Boolean);
  const _io = _np.length >= 2 ? _np.slice(1).join(' ') : nm;
  const greet = _io ? (', ' + escapeHtml(_io)) : '';
  const dt = new Date();
  const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const dateStr = days[dt.getDay()] + ', ' + dt.getDate() + ' ' + months[dt.getMonth()];

  let items = '';
  active.forEach(w => {
    const val = state._mp.filled[w.id];                    // уже пред-заполнено
    // срок — дедлайн работы либо срок договора; «горит» при просрочке или ≤3 днях
    const dlRaw = w.deadline_at || w.contract_delivery_date || '';
    let hot = !!w.is_overdue, deadline = '';
    if (dlRaw) {
      const dd = new Date((String(dlRaw).length <= 10 ? dlRaw + 'T00:00:00' : dlRaw));
      deadline = (typeof formatDate === 'function') ? formatDate(dlRaw) : String(dlRaw).slice(0, 10);
      if (!isNaN(dd) && Math.ceil((dd.getTime() - Date.now()) / 86400000) <= 3) hot = true;
    }
    const model = w.model_name || 'Работа';
    const sub = [w.contract_number ? escapeHtml(w.contract_number) : '', w.contractor_name ? escapeHtml(w.contractor_name) : ''].filter(Boolean).join(' · ');
    items +=
      '<div class="mp-item is-set" data-cid="' + w.id + '">' +
        '<div class="mp-itop">' +
          '<div class="mp-ic"><i class="ti ti-tool"></i></div>' +
          '<div class="mp-imain">' +
            '<div class="mp-iname">' + escapeHtml(model) + '</div>' +
            '<div class="mp-isub">' + (sub || 'без договора') + (deadline ? ' · до ' + escapeHtml(deadline) : '') + (hot ? ' · <span class="mp-hot">ГОРИТ</span>' : '') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="mp-prog">' +
          '<input type="range" class="mp-range" min="0" max="100" step="5" value="' + val + '" ' +
            'oninput="_mpOnInput(' + w.id + ', this.value)" onclick="_mpOnInput(' + w.id + ', this.value)">' +
          '<span class="mp-pct" id="mp-pct-' + w.id + '">' + val + '%</span>' +
        '</div>' +
      '</div>';
  });

  // v2.45.649: блок «Вчера без записей» — вопросы по людям без журнала
  const gapsHtml = _ydBlockHtml();

  const ov = document.createElement('div');
  ov.id = 'morning-progress-overlay';
  ov.className = 'mp-overlay';
  ov.innerHTML =
    '<div class="mp-modal">' +
      '<div class="mp-head">' +
        '<span class="mp-lock"><i class="ti ti-lock"></i> обязательно</span>' +
        '<div class="mp-sun"><i class="ti ti-sunrise"></i></div>' +
        '<div class="mp-h1">Доброе утро' + greet + ' 👋</div>' +
        '<div class="mp-date">' + dateStr + ' · смена началась</div>' +
      '</div>' +
      (active.length
        ? '<div class="mp-note"><i class="ti ti-alert-triangle"></i><span>Проверьте % готовности по каждой работе в производстве — текущие значения подставлены, поправьте, если изменилось.</span></div>' +
          '<div class="mp-counter"><span id="mp-counter-txt"></span><div class="mp-cbar"><div id="mp-cbar-fill"></div></div></div>' +
          '<div class="mp-list">' + items + '</div>'
        : '') +
      gapsHtml +
      '<div class="mp-foot">' +
        '<button class="mp-cta" id="mp-cta" disabled onclick="_mpSubmit()"><i class="ti ti-lock"></i> Начать смену</button>' +
        '<div class="mp-hint" id="mp-hint"></div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  _mpUpdateState();
}

// ============ v2.45.649: «Вчера без записей» — утренний опрос по людям ============
function _ydDateLabel(iso) {
  if (!iso) return 'вчера';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return 'вчера';
  const wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d.getDay()];
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  return wd + ', ' + d.getDate() + ' ' + months[d.getMonth()];
}

function _ydBlockHtml() {
  const g = state._mp;
  if (!g || !g.gaps.length) return '';
  let persons = '';
  g.gaps.forEach(p => {
    const eid = p.employee_id;
    const nm = p.short_name || p.full_name || ('#' + eid);
    const initials = (typeof getInitials === 'function') ? getInitials(nm) : nm.slice(0, 2).toUpperCase();
    const colorIdx = (eid || 0) % 8;
    // список действующих работ (сворачиваемый скроллом при большом числе)
    let workRows = '';
    g.gapWorks.forEach(w => {
      const sub = [w.contract_number ? '№' + String(w.contract_number).replace(/^[№#\s]+/, '') : '', w.contractor_name || ''].filter(Boolean).join(' · ');
      const stRu = { queue: 'в очереди', in_progress: 'в работе', review: 'на проверке', packing: 'упаковка' }[w.status] || '';
      workRows += '<div class="yd-work" data-wid="' + w.id + '" onclick="_ydWork(' + eid + ',' + w.id + ',this)">' +
        '<span class="yd-radio"></span>' +
        '<div class="yd-wmain"><div class="yd-wn">' + escapeHtml(w.title || '') + '</div>' +
          '<div class="yd-ws">' + escapeHtml([sub, stRu].filter(Boolean).join(' · ')) + '</div></div>' +
      '</div>';
    });
    persons +=
      '<div class="yd-person" id="yd-p-' + eid + '">' +
        '<div class="yd-ptop">' +
          '<div class="pkb-wl-avatar ac-' + colorIdx + ' yd-ava">' + escapeHtml(initials) + '</div>' +
          '<div class="yd-pmain">' +
            '<div class="yd-pname">' + escapeHtml(nm) + '</div>' +
            '<div class="yd-psub">вчера 0 ч в журнале</div>' +
          '</div>' +
          '<span class="yd-status todo" id="yd-st-' + eid + '">не указано</span>' +
        '</div>' +
        '<div class="yd-chips" id="yd-chips-' + eid + '">' +
          '<span class="yd-chip" data-m="work" onclick="_ydMode(' + eid + ',\'work\',this)"><i class="ti ti-tool"></i>Работал на сборке</span>' +
          '<span class="yd-chip" data-m="other" onclick="_ydMode(' + eid + ',\'other\',this)"><i class="ti ti-broom"></i>Хозработы / другое</span>' +
          '<span class="yd-chip" data-m="off" onclick="_ydMode(' + eid + ',\'off\',this)"><i class="ti ti-beach"></i>Отгул / болел</span>' +
        '</div>' +
        '<div class="yd-detail" id="yd-work-' + eid + '" style="display:none;">' +
          '<div class="yd-workpick">' + workRows + '</div>' +
          '<div class="yd-hours"><span class="yd-hlbl">Сколько часов:</span>' +
            '<div class="yd-step">' +
              '<button type="button" onclick="_ydH(' + eid + ',-1)">−</button>' +
              '<span class="yd-hval"><b id="yd-h-' + eid + '">7</b> ч</span>' +
              '<button type="button" onclick="_ydH(' + eid + ',1)">+</button>' +
            '</div></div>' +
        '</div>' +
        '<div class="yd-detail" id="yd-other-' + eid + '" style="display:none;">' +
          '<textarea class="yd-comment" id="yd-txt-' + eid + '" rows="2" ' +
            'placeholder="Чем занимался? Например: перемотка кабеля, погрузка…" ' +
            'oninput="_ydTxt(' + eid + ', this)"></textarea>' +
          '<div class="yd-quick">' +
            ['уборка цеха', 'погрузка / отгрузка', 'закупка / поездка', 'помогал на монтаже'].map(q =>
              '<span onclick="_ydQuick(' + eid + ', this)">' + q + '</span>').join('') +
          '</div>' +
        '</div>' +
        '<div class="yd-detail" id="yd-off-' + eid + '" style="display:none;">' +
          '<div class="yd-chips yd-offkinds">' +
            ['отгул', 'болел', 'отпуск', 'выходной'].map(k =>
              '<span class="yd-chip" onclick="_ydOff(' + eid + ', \'' + k + '\', this)">' + k + '</span>').join('') +
          '</div>' +
        '</div>' +
      '</div>';
  });
  const n = g.gaps.length;
  return '<div class="yd-block">' +
    '<div class="yd-head"><i class="ti ti-alert-circle"></i><div>' +
      '<b>За ' + _ydDateLabel(g.gapDate) + ' нет записей — ' + n + ' ' + _plural(n, ['человек', 'человека', 'человек']) + '</b>' +
      '<span>Укажи, чем занимались. Часы попадут в журнал, причина — в сводку дня.</span>' +
    '</div></div>' +
    '<div class="yd-list">' + persons + '</div>' +
  '</div>';
}

function _ydMode(eid, mode, el) {
  const a = state._mp && state._mp.gapAns[eid];
  if (!a) return;
  a.mode = mode;
  const chips = document.getElementById('yd-chips-' + eid);
  if (chips) chips.querySelectorAll('.yd-chip').forEach(c => c.classList.toggle('on', c === el));
  ['work', 'other', 'off'].forEach(m => {
    const d = document.getElementById('yd-' + m + '-' + eid);
    if (d) d.style.display = (m === mode) ? 'block' : 'none';
  });
  _ydRefresh(eid);
}
function _ydWork(eid, workId, el) {
  const a = state._mp && state._mp.gapAns[eid];
  if (!a) return;
  a.work_id = workId;
  const box = document.getElementById('yd-work-' + eid);
  if (box) box.querySelectorAll('.yd-work').forEach(w => w.classList.toggle('on', w === el));
  _ydRefresh(eid);
}
function _ydH(eid, delta) {
  const a = state._mp && state._mp.gapAns[eid];
  if (!a) return;
  a.hours = Math.max(1, Math.min(12, (a.hours || 7) + delta));
  const el = document.getElementById('yd-h-' + eid);
  if (el) el.textContent = a.hours;
  _ydRefresh(eid);
}
function _ydTxt(eid, el) {
  const a = state._mp && state._mp.gapAns[eid];
  if (!a) return;
  a.comment = (el.value || '').trim();
  _ydRefresh(eid);
}
function _ydQuick(eid, el) {
  const txt = document.getElementById('yd-txt-' + eid);
  if (txt) { txt.value = el.textContent; _ydTxt(eid, txt); }
}
function _ydOff(eid, kind, el) {
  const a = state._mp && state._mp.gapAns[eid];
  if (!a) return;
  a.off_kind = kind;
  const box = document.getElementById('yd-off-' + eid);
  if (box) box.querySelectorAll('.yd-chip').forEach(c => c.classList.toggle('on', c === el));
  _ydRefresh(eid);
}
function _ydDone(a) {
  if (!a || !a.mode) return false;
  if (a.mode === 'work') return !!a.work_id && (a.hours || 0) > 0;
  if (a.mode === 'other') return (a.comment || '').length > 1;
  if (a.mode === 'off') return !!a.off_kind;
  return false;
}
let _ydSaveTimers = {};
// v2.45.674: авто-сохранение ответа «чем занимался вчера» СРАЗУ по мере заполнения,
// а не только по кнопке «Начать смену». Иначе при хард-релоаде (смена версии/обновление)
// незасейвленный ответ терялся и вопрос выскакивал снова.
function _ydAutoSave(eid) {
  const g = state._mp;
  if (!g) return;
  const a = g.gapAns[eid];
  if (!_ydDone(a) || a._saved) return;
  clearTimeout(_ydSaveTimers[eid]);
  _ydSaveTimers[eid] = setTimeout(async function () {
    if (!_ydDone(a) || a._saved || a._saving || typeof apiPost !== 'function') return;
    a._saving = true;
    try {
      const r = await apiPost('/api/production/day-answers', {
        date: g.gapDate,
        answers: [{ employee_id: eid, kind: a.mode, work_id: a.work_id, hours: a.hours, comment: a.comment, off_kind: a.off_kind }],
      });
      if (r && r.ok) a._saved = true;
    } catch (e) { /* повторим при следующем изменении/по кнопке */ }
    a._saving = false;
  }, 700);
}
function _ydRefresh(eid) {
  const a = state._mp && state._mp.gapAns[eid];
  const ok = _ydDone(a);
  const st = document.getElementById('yd-st-' + eid);
  if (st) { st.textContent = ok ? '✓ указано' : 'не указано'; st.className = 'yd-status ' + (ok ? 'ok' : 'todo'); }
  const card = document.getElementById('yd-p-' + eid);
  if (card) card.classList.toggle('is-done', ok);
  if (ok) _ydAutoSave(eid);   // засейвить сразу, как ответ стал полным (переживёт релоад)
  _mpUpdateState();
}

function _mpOnInput(cid, value) {
  if (!state._mp) return;
  const v = Math.max(0, Math.min(100, parseInt(value, 10) || 0));
  state._mp.filled[cid] = v;
  const el = document.getElementById('mp-pct-' + cid);
  if (el) el.textContent = v + '%';
  const item = document.querySelector('.mp-item[data-cid="' + cid + '"]');
  if (item) { item.classList.remove('is-todo'); item.classList.add('is-set'); }
  _mpUpdateState();
}

function _mpUpdateState() {
  if (!state._mp) return;
  const total = state._mp.active.length;
  const done = state._mp.active.filter(c => state._mp.filled[c.id] != null).length;
  const txt = document.getElementById('mp-counter-txt');
  if (txt) txt.textContent = 'Заполнено ' + done + ' из ' + total;
  const fill = document.getElementById('mp-cbar-fill');
  if (fill) fill.style.width = (total ? Math.round(done / total * 100) : 0) + '%';
  const left = total - done;
  // v2.45.649: плюс неотвеченные вопросы «чем занимался вчера»
  const gapsLeft = (state._mp.gaps || []).filter(p => !_ydDone(state._mp.gapAns[p.employee_id])).length;
  const allDone = left === 0 && gapsLeft === 0;
  const cta = document.getElementById('mp-cta');
  const hint = document.getElementById('mp-hint');
  if (cta) {
    cta.disabled = !allDone;
    cta.classList.toggle('ready', allDone);
    cta.innerHTML = allDone ? 'Начать смену <i class="ti ti-arrow-right"></i>' : '<i class="ti ti-lock"></i> Начать смену';
  }
  if (hint) {
    if (allDone) hint.innerHTML = 'Готово — хорошей смены!';
    else if (left > 0) hint.innerHTML = 'Заполните все позиции — осталось <b>' + left + '</b>';
    else hint.innerHTML = 'Укажите, чем занимались вчера — осталось <b>' + gapsLeft + '</b>';
  }
}

function _mpSubmit() {
  if (!state._mp) return;
  const total = state._mp.active.length;
  const done = state._mp.active.filter(c => state._mp.filled[c.id] != null).length;
  if (done < total) return; // защита: не закрываем, пока не всё
  // v2.45.649: и пока не отвечено по всем «вчера без записей»
  if ((state._mp.gaps || []).some(p => !_ydDone(state._mp.gapAns[p.employee_id]))) return;
  const store = _mpLoadStore();
  const today = _mpToday();
  store[today] = store[today] || {};
  state._mp.active.forEach(c => { store[today][c.id] = state._mp.filled[c.id]; });
  _mpSaveStore(store);
  // v2.45.364: сохраняем % прямо в production work — тот же прогресс, что на карточке канбана
  // (PATCH /api/production/works/{id}/progress). Виден всем, включая директора на доске.
  try {
    if (typeof apiPatch === 'function') {
      state._mp.active.forEach(function (w) {
        apiPatch('/api/production/works/' + w.id + '/progress', { progress: state._mp.filled[w.id] }).catch(function () {});
      });
    }
  } catch (e) {}
  // v2.45.649: ответы «чем занимался вчера» → журнал участия / заметки дня
  try {
    const g = state._mp;
    if (g.gaps && g.gaps.length && typeof apiPost === 'function') {
      const answers = g.gaps.map(function (p) {
        const a = g.gapAns[p.employee_id] || {};
        return {
          employee_id: p.employee_id,
          kind: a.mode,
          work_id: a.work_id,
          hours: a.hours,
          comment: a.comment,
          off_kind: a.off_kind,
        };
      });
      apiPost('/api/production/day-answers', { date: g.gapDate, answers: answers }).then(function () {
        // журнал/сводки могли быть уже загружены — сбросим кэш, чтобы подтянулись записи
        try { if (typeof cache === 'object') { delete cache.summaryData; } } catch (e2) {}
      }).catch(function () {});
    }
  } catch (e) {}
  const ov = document.getElementById('morning-progress-overlay');
  if (ov) ov.remove();
  document.body.style.overflow = '';
  if (typeof showToast === 'function') showToast('Прогресс отмечен. Хорошей смены!', 'success');
}


// ============================================================================
// v2.45.523: КОМАНДНЫЕ ЧАТЫ (свободные группы) — раздел «Сервис»
// Менеджер создаёт чат, приглашает участников (сотрудников), общается.
// Текст + файлы (фото/видео/документы). Поллинг как у чата по договору.
// ============================================================================

let _teamChatsPollTimer = null;
let _tchatRefreshTimer  = null;
let _tchatPendingFiles  = [];
let _tchatCurrentId     = null;
let _tchatLastSig       = '';

function _stopTeamChatsPolling() {
  if (_teamChatsPollTimer) { clearInterval(_teamChatsPollTimer); _teamChatsPollTimer = null; }
}

// Глобальная точка входа в чаты (кнопка в шапке) — работает из любого раздела
// и для любой роли, в т.ч. для «чистого» монтажника. Экран чатов не привязан
// к разделу, поэтому просто показываем его поверх текущего.
function openTeamChatsScreen() {
  if (typeof selectSidebarItem === 'function') selectSidebarItem('defects-chats');
  else if (typeof loadTeamChats === 'function') loadTeamChats();
}

function _tcTrim(s, n) { s = s || ''; return s.length > n ? s.slice(0, n) + '…' : s; }

function _tchatListTime(iso) {
  if (!iso) return '';
  const d = iso.slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const yest  = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (d === today) return iso.slice(11, 16) || '';
  if (d === yest)  return 'вчера';
  return d.split('-').reverse().slice(0, 2).join('.');
}

// ---------- Список чатов ----------
async function loadTeamChats() {
  const box = document.getElementById('team-chats-content');
  if (!box) return;
  try {
    const [r, cr] = await Promise.all([
      apiGet('/api/team-chats'),
      apiGet('/api/team-chats/contract-chats').catch(() => ({ chats: [] })),   // v2.45.717
    ]);
    const chats = r.chats || [];
    window._contractChats = (cr && cr.chats) || [];
    renderTeamChatList(chats);
    _updateTeamChatsBadge(chats);
  } catch (e) {
    box.innerHTML = '<div class="empty-block">Не удалось загрузить чаты</div>';
  }
  _stopTeamChatsPolling();
  _teamChatsPollTimer = setInterval(() => {
    const modal = document.getElementById('team-chat-modal');
    if (state.currentScreen === 'defects-chats' && !(modal && modal.classList.contains('visible'))) {
      _silentRefreshTeamChats();
    }
  }, 12000);
}

async function _silentRefreshTeamChats() {
  try {
    const r = await apiGet('/api/team-chats');
    renderTeamChatList(r.chats || []);
    _updateTeamChatsBadge(r.chats || []);
  } catch (_) {}
}

// v2.45.6xx: переключатель нового/старого вида списка чатов
function _tcToggleBar() {
  return '<div class="sv2-toggle-bar">' +
      '<span><i class="ti ti-' + (window.TC_V2 ? 'sparkles' : 'history') + '"></i> ' + (window.TC_V2 ? 'Новый вид' : 'Старый вид') + '</span>' +
      '<button class="sv2-toggle-btn" onclick="toggleChatsV2()">' + (window.TC_V2 ? 'Вернуть старый' : 'Включить новый') + '</button>' +
    '</div>';
}

function toggleChatsV2() {
  window.TC_V2 = !window.TC_V2;
  try { localStorage.setItem('tcV2', window.TC_V2 ? '1' : '0'); } catch (_) {}
  renderTeamChatList(state._teamChats || []);
}

function _tcInitials(s) {
  const m = String(s || '').match(/[a-zA-Zа-яА-ЯёЁ0-9]+/g) || [];
  if (m.length >= 2) return (m[0][0] + m[1][0]).toUpperCase();
  if (m.length === 1) return m[0].slice(0, 2).toUpperCase();
  return '#';
}
function _tcColorIdx(s) {
  let h = 0; const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = (h + str.charCodeAt(i)) % 4;
  return h;
}

// v2.45.6xx: строка-карточка чата (новый вид)
function _tcRowV2(c) {
  const lm = c.last_message;
  let preview = 'Нет сообщений', sys = false;
  if (lm) {
    if (lm.is_system) { preview = lm.text; sys = true; }
    else {
      const who = lm.author_name ? (lm.author_name + ': ') : '';
      preview = who + (lm.text || (lm.has_files ? '📎 файл' : ''));
    }
  }
  const t = c.last_at ? _tchatListTime(c.last_at) : '';
  const isUnread = c.unread > 0;
  const unread = isUnread ? '<span class="tc2-unread">' + (c.unread > 99 ? '99+' : c.unread) + '</span>' : '';
  const crown = c.role === 'owner' ? '<span class="tc2-crown"><i class="ti ti-crown"></i></span>' : '';
  const owner = c.role === 'owner' ? ' · <span class="tc2-own">вы владелец</span>' : '';
  const mc = c.members_count || 1;
  return '<div class="tc2-row' + (isUnread ? ' unread' : '') + '" onclick="openTeamChat(' + c.id + ')">'
    + '<div class="tc2-ava a' + _tcColorIdx(c.title) + '">' + escapeHtml(_tcInitials(c.title)) + crown + '</div>'
    + '<div class="tc2-main">'
    + '<div class="tc2-r1"><span class="tc2-title">' + escapeHtml(c.title) + '</span><span class="tc2-time">' + escapeHtml(t) + '</span></div>'
    + '<div class="tc2-r2"><span class="tc2-preview' + (sys ? ' sys' : '') + '">' + escapeHtml(_tcTrim(preview, 80)) + '</span>' + unread + '</div>'
    + '<div class="tc2-meta"><i class="ti ti-users"></i> ' + mc + ' ' + _plural(mc, ['участник', 'участника', 'участников']) + owner + '</div>'
    + '</div></div>';
}

function renderTeamChatList(chats) {
  const box = document.getElementById('team-chats-content');
  const counter = document.getElementById('team-chats-counter');
  if (counter) counter.textContent = chats.length;
  if (!box) return;
  state._teamChats = chats;
  window.TC_V2 = (localStorage.getItem('tcV2') !== '0');
  const toggle = _tcToggleBar();
  const cchHtml = _contractChatsSectionHtml();   // v2.45.717: чаты договоров
  if (counter) counter.textContent = chats.length + ((window._contractChats || []).length);
  if (!chats.length) {
    box.innerHTML = toggle + '<div class="empty-block" style="padding:40px 18px;text-align:center;color:var(--text-light);">'
      + '<i class="ti ti-messages" style="font-size:42px;opacity:.4;"></i><br><br>'
      + 'Пока нет ни одного чата.<br>Создайте чат, пригласите монтажников и коллег — и общайтесь.<br><br>'
      + '<button class="btn btn-primary" onclick="openTeamPick(\'create\')"><i class="ti ti-plus"></i> Создать чат</button>'
      + '</div>' + cchHtml;
    return;
  }
  if (window.TC_V2) {
    box.innerHTML = toggle + '<div class="tc2-list">' + chats.map(_tcRowV2).join('') + '</div>' + cchHtml;
    return;
  }
  let html = toggle + '<div class="tcl-list">';
  chats.forEach(c => {
    const lm = c.last_message;
    let preview = 'Нет сообщений';
    if (lm) {
      if (lm.is_system) preview = lm.text;
      else {
        const who = lm.author_name ? (lm.author_name + ': ') : '';
        const body = lm.text || (lm.has_files ? '📎 файл' : '');
        preview = who + body;
      }
    }
    const t = c.last_at ? _tchatListTime(c.last_at) : '';
    const unread = c.unread > 0 ? '<span class="tcl-unread">' + (c.unread > 99 ? '99+' : c.unread) + '</span>' : '';
    html += '<div class="tcl-card" onclick="openTeamChat(' + c.id + ')">'
      + '<div class="tcl-ava"><i class="ti ti-' + (c.role === 'owner' ? 'crown' : 'messages') + '"></i></div>'
      + '<div class="tcl-main">'
      + '<div class="tcl-row1"><span class="tcl-title">' + escapeHtml(c.title) + '</span>'
      + '<span class="tcl-time">' + escapeHtml(t) + '</span></div>'
      + '<div class="tcl-row2"><span class="tcl-preview' + (lm && lm.is_system ? ' sys' : '') + '">'
      + escapeHtml(_tcTrim(preview, 72)) + '</span>' + unread + '</div>'
      + '<div class="tcl-meta"><i class="ti ti-users"></i> ' + (c.members_count || 1)
      + (c.role === 'owner' ? ' · вы владелец' : '') + '</div>'
      + '</div></div>';
  });
  html += '</div>';
  box.innerHTML = html + cchHtml;
}

// v2.45.717: секция «Чаты по договорам» в хабе чатов
function _contractChatsSectionHtml() {
  const list = window._contractChats || [];
  if (!list.length) return '';
  let h = '<div class="cch-sec"><i class="ti ti-file-text"></i> Чаты по договорам <span class="cnt">' + list.length + '</span></div><div class="cch-list">';
  list.forEach(c => {
    const dt = c.last_at ? _tchatListTime(String(c.last_at).replace(' ', 'T')) : '';
    const prev = c.last_is_system
      ? (c.last_text || '')
      : ((c.last_author ? c.last_author + ': ' : '') + (c.last_text || '📎 файл'));
    const num = c.number ? ('№' + String(c.number).replace(/^№\s*/, '')) : ('#' + c.contract_id);
    h += '<div class="cch-row" onclick="_openContractChatFromHub(' + c.contract_id + ')">' +
      '<div class="cch-ava"><i class="ti ti-file-text"></i></div>' +
      '<div class="cch-main">' +
        '<div class="cch-t">' + escapeHtml(num + (c.contractor_name ? ' · ' + c.contractor_name : '')) + '</div>' +
        '<div class="cch-sub">' + escapeHtml(_tcTrim(prev, 84)) + '</div>' +
      '</div>' +
      '<div class="cch-right"><span class="cch-time">' + escapeHtml(dt) + '</span>' +
        (Number(c.unread) > 0 ? '<span class="cch-unread">' + (c.unread > 99 ? '99+' : c.unread) + '</span>' : '') +
      '</div>' +
    '</div>';
  });
  return h + '</div>';
}
function _openContractChatFromHub(cid) {
  state.currentContractId = cid;
  if (typeof openContractChat === 'function') openContractChat();
}

// Бейдж «Чаты» есть и в Сервисе, и в Монтаже — обновляем все сразу (.team-chats-badge)
function _setTeamChatsBadge(total) {
  document.querySelectorAll('.team-chats-badge').forEach(b => {
    if (total > 0) { b.textContent = total > 99 ? '99+' : total; b.style.display = ''; }
    else b.style.display = 'none';
  });
}

function _updateTeamChatsBadge(chats) {
  const total = (chats || []).reduce((s, c) => s + (c.unread || 0), 0);
  _setTeamChatsBadge(total);
}

async function refreshTeamChatsBadge() {
  try {
    const r = await apiGet('/api/team-chats/unread');
    _setTeamChatsBadge(r.total_unread || 0);
  } catch (_) {}
}

// ---------- Открытие чата ----------
async function openTeamChat(cid) {
  _tchatCurrentId = cid;
  _tchatPendingFiles = [];
  _tchatLastSig = '';
  _renderTeamAttachPreview();
  const card = document.getElementById('tchat-modal-card');
  if (card) card.classList.remove('show-side');
  const side = document.getElementById('tchat-side');
  if (side) side.innerHTML = '';
  document.getElementById('tchat-messages').innerHTML = '<div class="loading-block">Загружаем…</div>';
  document.getElementById('team-chat-modal').classList.add('visible');
  await loadTeamChatMeta(cid);
  renderTeamSide();
  await loadTeamChat(cid);
  if (_tchatRefreshTimer) clearInterval(_tchatRefreshTimer);
  _tchatRefreshTimer = setInterval(() => {
    const modal = document.getElementById('team-chat-modal');
    if (modal && modal.classList.contains('visible')) loadTeamChat(cid, true);
    else { clearInterval(_tchatRefreshTimer); _tchatRefreshTimer = null; }
  }, 6000);
  setTimeout(() => { const i = document.getElementById('tchat-input'); if (i) i.focus(); }, 150);
}

function closeTeamChat() {
  document.getElementById('team-chat-modal').classList.remove('visible');
  if (_tchatRefreshTimer) { clearInterval(_tchatRefreshTimer); _tchatRefreshTimer = null; }
  _tchatCurrentId = null;
  _tchatPendingFiles = [];
  _renderTeamAttachPreview();
  if (state.currentScreen === 'defects-chats') _silentRefreshTeamChats();
  else refreshTeamChatsBadge();
}

async function loadTeamChatMeta(cid) {
  try {
    const r = await apiGet('/api/team-chats/' + cid);
    state._tchatMeta = r;
    document.getElementById('tchat-title').textContent = r.title || 'Чат';
    const names = (r.members || []).map(m => m.name).join(', ');
    document.getElementById('tchat-subtitle').textContent =
      (r.members || []).length + ' участ. · ' + _tcTrim(names, 56);
    // карандаш-переименование — только владельцу
    const rb = document.getElementById('tchat-rename-btn');
    if (rb) rb.style.display = r.is_owner ? '' : 'none';
  } catch (e) {}
}

async function loadTeamChat(cid, silent) {
  const box = document.getElementById('tchat-messages');
  try {
    const r = await apiGet('/api/team-chats/' + cid + '/messages');
    const arr = r.messages || [];
    const sig = arr.length + ':' + ((arr.slice(-1)[0] || {}).id || 0);
    if (silent && sig === _tchatLastSig) return;
    _tchatLastSig = sig;
    _renderTeamChatMessages(r);
  } catch (e) {
    if (!silent) box.innerHTML = '<div class="empty-block">Ошибка загрузки</div>';
  }
}

function _renderTeamChatMessages(r) {
  const box = document.getElementById('tchat-messages');
  const msgs = r.messages || [];
  const myChatId = r.my_chat_id;
  const meta = state._tchatMeta || {};
  const canModerate = !!meta.is_owner;
  if (!msgs.length) {
    box.innerHTML = '<div class="empty-block" style="padding:30px 18px;color:var(--text-light);">'
      + '<i class="ti ti-message-circle"></i><br>Сообщений пока нет.<br>Напишите первое — все участники увидят.</div>';
    return;
  }
  const wasAtBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 60;
  let html = '';
  let lastAuthor = null, lastDate = null;
  msgs.forEach(m => {
    const isMine = (m.author_chat_id === myChatId);
    const dt = (m.created_at || '').slice(0, 10);
    if (dt !== lastDate) {
      html += '<div class="cchat-date-sep"><span>' + escapeHtml(_chatPrettyDate(dt)) + '</span></div>';
      lastDate = dt; lastAuthor = null;
    }
    const time = (m.created_at || '').slice(11, 16);
    if (m.is_system) {
      html += '<div class="cchat-sys">' + escapeHtml(m.text) + ' · ' + escapeHtml(time) + '</div>';
      lastAuthor = null;
      return;
    }
    const showHead = (lastAuthor !== (m.author_chat_id || 0));
    lastAuthor = m.author_chat_id || 0;
    const author = m.author_name || (isMine ? 'Я' : 'Сотрудник');
    const cls = 'cchat-msg' + (isMine ? ' mine' : '');
    html += '<div class="' + cls + '">';
    if (showHead && !isMine) html += '<div class="cchat-msg-author">' + escapeHtml(author) + '</div>';
    if (m.text) html += '<div class="cchat-msg-body">' + _escapeChatText(m.text) + '</div>';
    if (m.files && m.files.length) html += _renderTeamMessageFiles(m.files);
    html += '<div class="cchat-msg-meta">' + escapeHtml(time);
    if (isMine || canModerate) {
      html += ' · <button class="cchat-del-btn" onclick="deleteTeamChatMessage(' + m.id + ')" title="Удалить"><i class="ti ti-trash"></i></button>';
    }
    html += '</div></div>';
  });
  box.innerHTML = html;
  if (wasAtBottom) box.scrollTop = box.scrollHeight;
}

function _renderTeamMessageFiles(files) {
  if (!files || !files.length) return '';
  let html = '<div class="cchat-msg-files">';
  files.forEach(f => {
    const url = API_BASE + '/api/team-chats/messages/files/' + f.id;
    if (f.kind === 'photo') {
      html += '<a href="' + url + '" target="_blank" class="cchat-file-img"><img src="' + url + '" alt=""></a>';
    } else if (f.kind === 'video') {
      html += '<video controls class="cchat-file-video"><source src="' + url + '" type="' + escapeHtml(f.content_type || '') + '"></video>';
    } else {
      const name = f.original_name || ('Файл #' + f.id);
      const sz = f.file_size ? Math.round(f.file_size / 1024) + ' КБ' : '';
      html += '<a href="' + url + '" target="_blank" class="cchat-file-doc"><i class="ti ti-file"></i>'
        + '<div class="cchat-file-doc-meta"><div class="cchat-file-doc-name">' + escapeHtml(name) + '</div>'
        + (sz ? '<div class="cchat-file-doc-size">' + sz + '</div>' : '') + '</div></a>';
    }
  });
  html += '</div>';
  return html;
}

// ---------- Файлы к сообщению ----------
function onTeamChatFilesSelected(files) {
  if (!files || !files.length) return;
  for (let i = 0; i < files.length; i++) {
    if (_tchatPendingFiles.length >= 5) { showToast('Не больше 5 файлов на сообщение', 'info'); break; }
    const f = files[i];
    const isVid = (f.type || '').startsWith('video/');
    const maxSize = isVid ? 100 * 1024 * 1024 : 20 * 1024 * 1024;
    if (f.size > maxSize) { showToast('Файл "' + f.name + '" слишком большой', 'error'); continue; }
    _tchatPendingFiles.push(f);
  }
  _renderTeamAttachPreview();
  document.getElementById('tchat-file-input').value = '';
}

function _renderTeamAttachPreview() {
  const wrap = document.getElementById('tchat-attach-preview');
  if (!wrap) return;
  if (!_tchatPendingFiles.length) { wrap.innerHTML = ''; return; }
  let html = '<div class="cchat-attach-row">';
  _tchatPendingFiles.forEach((f, i) => {
    const isImg = (f.type || '').startsWith('image/');
    const isVid = (f.type || '').startsWith('video/');
    let thumb;
    if (isImg) thumb = '<img src="' + URL.createObjectURL(f) + '" alt="">';
    else if (isVid) thumb = '<div class="cchat-thumb-icon"><i class="ti ti-video"></i></div>';
    else thumb = '<div class="cchat-thumb-icon"><i class="ti ti-file"></i></div>';
    html += '<div class="cchat-attach-item">' + thumb
      + '<div class="cchat-attach-name" title="' + escapeHtml(f.name) + '">' + escapeHtml(f.name) + '</div>'
      + '<button class="cchat-attach-remove" onclick="removeTeamAttachment(' + i + ')"><i class="ti ti-x"></i></button>'
      + '</div>';
  });
  html += '</div>';
  wrap.innerHTML = html;
}

function removeTeamAttachment(idx) { _tchatPendingFiles.splice(idx, 1); _renderTeamAttachPreview(); }

// ---------- Отправка / удаление ----------
async function sendTeamChatMessage() {
  const inp = document.getElementById('tchat-input');
  const btn = document.getElementById('tchat-send-btn');
  const text = (inp.value || '').trim();
  const cid = _tchatCurrentId;
  if (!cid) return;
  if (!text && !_tchatPendingFiles.length) return;
  btn.disabled = true;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    let response;
    if (_tchatPendingFiles.length) {
      const fd = new FormData();
      if (text) fd.append('text', text);
      _tchatPendingFiles.forEach((f, i) => fd.append('file_' + (i + 1), f, f.name));
      response = await fetch(API_BASE + '/api/team-chats/' + cid + '/messages', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: fd });
    } else {
      response = await fetch(API_BASE + '/api/team-chats/' + cid + '/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ text: text }) });
    }
    if (!response.ok) {
      const e = await response.json().catch(() => ({}));
      showToast(e.message || e.error || 'Не отправилось', 'error');
      return;
    }
    inp.value = ''; inp.style.height = '';
    _tchatPendingFiles = []; _renderTeamAttachPreview();
    _tchatLastSig = '';
    await loadTeamChat(cid, false);
    const box = document.getElementById('tchat-messages');
    box.scrollTop = box.scrollHeight;
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  } finally { btn.disabled = false; inp.focus(); }
}

async function deleteTeamChatMessage(mid) {
  if (!confirm('Удалить сообщение?')) return;
  const cid = _tchatCurrentId;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/team-chats/' + cid + '/messages/' + mid, {
      method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } });
    if (!r.ok) { const e = await r.json().catch(() => ({})); showToast(e.message || 'Не удалось', 'error'); return; }
    _tchatLastSig = '';
    loadTeamChat(cid, false);
  } catch (e) { showToast('Ошибка соединения', 'error'); }
}

// ---------- Боковая панель участников ----------
// На широком экране видна всегда; на мобильном — выезжает по кнопке 👥.
function toggleTeamMembers() {
  const card = document.getElementById('tchat-modal-card');
  if (card) card.classList.toggle('show-side');
}

function renderTeamSide() {
  const panel = document.getElementById('tchat-side');
  if (!panel) return;
  const meta = state._tchatMeta || {};
  const members = meta.members || [];
  const isOwner = !!meta.is_owner;
  let html = '<div class="tchat-side-head"><span><i class="ti ti-users"></i> Участники · ' + members.length + '</span>'
    + '<button class="tchat-side-close" onclick="toggleTeamMembers()" title="Свернуть"><i class="ti ti-x"></i></button></div>';
  html += '<div class="tchat-side-scroll">';
  html += '<button class="tcm-add-btn full" onclick="openTeamPick(\'add\')"><i class="ti ti-user-plus"></i> Добавить участников</button>';
  html += '<div class="tcm-list">';
  members.forEach(m => {
    const roleTag = m.role === 'owner' ? '<span class="tcm-role">владелец</span>' : '';
    let delBtn = '';
    if (!m.is_me && isOwner && m.employee_id) {
      delBtn = '<button class="tcm-del" onclick="removeTeamMember(' + m.employee_id + ')" title="Убрать из чата"><i class="ti ti-x"></i></button>';
    }
    const initial = escapeHtml((m.name || '?').trim().charAt(0).toUpperCase());
    html += '<div class="tcm-item"><div class="tcm-ava">' + initial + '</div>'
      + '<span class="tcm-name">' + escapeHtml(m.name || '—')
      + (m.is_me ? ' <span class="tcm-you">вы</span>' : '') + roleTag + '</span>' + delBtn + '</div>';
  });
  html += '</div></div>';
  html += '<div class="tchat-side-foot">';
  if (isOwner) html += '<button class="tcm-act" onclick="renameTeamChat()"><i class="ti ti-edit"></i> Переименовать чат</button>';
  html += '<button class="tcm-act danger" onclick="leaveTeamChat()"><i class="ti ti-logout"></i> Выйти из чата</button>';
  html += '</div>';
  panel.innerHTML = html;
}

async function removeTeamMember(empId) {
  const meta = state._tchatMeta || {};
  const m = (meta.members || []).find(x => x.employee_id === empId);
  const name = m ? m.name : 'участника';
  if (!confirm('Убрать «' + name + '» из чата?')) return;
  const cid = _tchatCurrentId;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/team-chats/' + cid + '/members/' + empId, {
      method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } });
    if (!r.ok) { const e = await r.json().catch(() => ({})); showToast(e.message || 'Не удалось', 'error'); return; }
    await loadTeamChatMeta(cid);
    renderTeamSide();
    _tchatLastSig = ''; loadTeamChat(cid, false);
  } catch (e) { showToast('Ошибка соединения', 'error'); }
}

async function leaveTeamChat() {
  if (!confirm('Выйти из этого чата? Вы перестанете получать сообщения.')) return;
  const cid = _tchatCurrentId;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/team-chats/' + cid + '/leave', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
    if (!r.ok) { showToast('Не удалось выйти', 'error'); return; }
    showToast('Вы вышли из чата', 'success');
    closeTeamChat();
    if (state.currentScreen === 'defects-chats') loadTeamChats();
  } catch (e) { showToast('Ошибка соединения', 'error'); }
}

async function renameTeamChat() {
  const meta = state._tchatMeta || {};
  const title = prompt('Новое название чата:', meta.title || '');
  if (title === null) return;
  const t = (title || '').trim();
  if (!t) return;
  const cid = _tchatCurrentId;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/team-chats/' + cid, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ title: t }) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); showToast(e.message || 'Не удалось', 'error'); return; }
    await loadTeamChatMeta(cid);
    renderTeamSide();
    _tchatLastSig = ''; loadTeamChat(cid, false);
  } catch (e) { showToast('Ошибка соединения', 'error'); }
}

// ---------- Выбор участников (создание / добавление) ----------
async function openTeamPick(mode) {
  state._teamPick = { mode: mode, cid: _tchatCurrentId, sel: new Set(), existing: new Set(), employees: [] };
  const titleEl = document.getElementById('tcp-title');
  const nameRow = document.getElementById('tcp-name-row');
  const submit  = document.getElementById('tcp-submit');
  if (mode === 'add') {
    titleEl.textContent = 'Добавить участников';
    nameRow.style.display = 'none';
    submit.textContent = 'Добавить';
    const meta = state._tchatMeta || {};
    (meta.members || []).forEach(m => { if (m.employee_id) state._teamPick.existing.add(m.employee_id); });
  } else {
    titleEl.textContent = 'Новый чат';
    nameRow.style.display = '';
    submit.textContent = 'Создать чат';
    document.getElementById('tcp-chat-title').value = '';
  }
  document.getElementById('tcp-search').value = '';
  document.getElementById('tcp-list').innerHTML = '<div class="loading-block">Загружаем…</div>';
  document.getElementById('team-pick-modal').classList.add('visible');
  if (mode === 'create') setTimeout(() => { const t = document.getElementById('tcp-chat-title'); if (t) t.focus(); }, 120);
  try {
    const r = await apiGet('/api/employees/active');
    state._teamPick.employees = (r.employees || []).filter(e => !state._teamPick.existing.has(e.id));
    renderTeamPickList();
  } catch (e) {
    document.getElementById('tcp-list').innerHTML = '<div class="empty-block">Не удалось загрузить сотрудников</div>';
  }
  _updateTcpCount();
}

function closeTeamPick() {
  document.getElementById('team-pick-modal').classList.remove('visible');
  state._teamPick = null;
}

function renderTeamPickList() {
  const tp = state._teamPick;
  if (!tp) return;
  const q = (document.getElementById('tcp-search').value || '').toLowerCase().trim();
  const list = document.getElementById('tcp-list');
  let emps = tp.employees;
  if (q) emps = emps.filter(e => ((e.short_name || '') + ' ' + (e.full_name || '') + ' ' + (e.position || '')).toLowerCase().includes(q));
  if (!emps.length) { list.innerHTML = '<div class="empty-block" style="padding:18px;">Никого не найдено</div>'; return; }
  let html = '';
  emps.forEach(e => {
    const sel = tp.sel.has(e.id);
    const nm = e.short_name || e.full_name || ('Сотрудник #' + e.id);
    html += '<div class="tcp-item' + (sel ? ' sel' : '') + '" onclick="toggleTeamPick(' + e.id + ')">'
      + '<div class="tcp-check"><i class="ti ti-' + (sel ? 'square-check-filled' : 'square') + '"></i></div>'
      + '<div class="tcp-info"><div class="tcp-name">' + escapeHtml(nm) + '</div>'
      + (e.position ? '<div class="tcp-pos">' + escapeHtml(e.position) + '</div>' : '') + '</div></div>';
  });
  list.innerHTML = html;
}

function toggleTeamPick(empId) {
  const tp = state._teamPick;
  if (!tp) return;
  if (tp.sel.has(empId)) tp.sel.delete(empId); else tp.sel.add(empId);
  renderTeamPickList();
  _updateTcpCount();
}

function _updateTcpCount() {
  const tp = state._teamPick;
  const el = document.getElementById('tcp-count');
  if (el && tp) el.textContent = 'Выбрано: ' + tp.sel.size;
}

async function submitTeamPick() {
  const tp = state._teamPick;
  if (!tp) return;
  const ids = Array.from(tp.sel);
  const token = localStorage.getItem(TOKEN_KEY);
  if (tp.mode === 'create') {
    const title = (document.getElementById('tcp-chat-title').value || '').trim();
    if (!title) { showToast('Введите название чата', 'error'); document.getElementById('tcp-chat-title').focus(); return; }
    try {
      const r = await fetch(API_BASE + '/api/team-chats', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ title: title, member_ids: ids }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); showToast(e.message || 'Не удалось создать', 'error'); return; }
      const data = await r.json();
      closeTeamPick();
      if (state.currentScreen === 'defects-chats') await loadTeamChats();
      if (data.id) openTeamChat(data.id);
    } catch (e) { showToast('Ошибка соединения', 'error'); }
  } else {
    if (!ids.length) { showToast('Выберите хотя бы одного сотрудника', 'info'); return; }
    const cid = tp.cid || _tchatCurrentId;
    try {
      const r = await fetch(API_BASE + '/api/team-chats/' + cid + '/members', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ employee_ids: ids }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); showToast(e.message || 'Не удалось', 'error'); return; }
      closeTeamPick();
      await loadTeamChatMeta(cid);
      renderTeamSide();
      _tchatLastSig = ''; loadTeamChat(cid, false);
      showToast('Участники добавлены', 'success');
    } catch (e) { showToast('Ошибка соединения', 'error'); }
  }
}

// Enter — отправить, Shift+Enter — перенос; авто-рост поля ввода
document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('tchat-input');
  if (!inp) return;
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTeamChatMessage(); }
  });
  inp.addEventListener('input', () => {
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 140) + 'px';
  });
});
