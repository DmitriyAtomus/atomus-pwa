/* Что закупить v2 (этап 2). Отключение: localStorage.supplyWhatV1 = "0" */
(function () {
  'use strict';
  var LS = 'supplyWhatV1';
  var _esc = (typeof escapeHtml === 'function')
    ? function (s) { return escapeHtml(s); }
    : function (s) {
        return String(s == null ? '' : s)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      };
  var st = {
    container: null,
    landing: null,
    tree: null,
    view: 'landing',
    contractId: null,
    q: '',
    includeDrafts: false,
    selected: {},
    open: {},
    inactive: null,
    componentFilter: 'all',
    loadSeq: 0,
    shippingTimer: null
  };

  function fmt(n) {
    var x = Number(n || 0);
    if (!isFinite(x)) return '0';
    var s = (Math.round(x * 1000) / 1000).toString();
    if (s.indexOf('.') >= 0) s = s.replace(/\.?0+$/, '');
    return s;
  }
  function unit(u) { return _esc(u || 'шт.'); }
  function statusClass(s) {
    if (s === 'to_buy') return 'st-buy';
    if (s === 'in_transit') return 'st-wait';
    if (s === 'data_error' || s === 'inactive_bom' || s === 'empty_bom') return 'st-err';
    if (s === 'in_stock_not_reserved') return 'st-mark';
    return 'st-ok';
  }
  function statusLabel(s) {
    return ({
      to_buy: 'Докупить',
      in_transit: 'В пути',
      data_error: 'Ошибка данных',
      empty_bom: 'Пустой состав',
      inactive_bom: 'Неактивный BOM',
      in_stock_not_reserved: 'На складе, не зарезервировано',
      reserved: 'Зарезервировано',
      covered: 'Закупка не требуется'
    })[s] || s || '';
  }
  function orderStatusRu(s) {
    return ({
      draft: 'Черновик',
      invoice_requested: 'Счёт запрошен',
      sent: 'Заказан',
      awaiting_invoice: 'Счёт запрошен',
      invoice_received: 'Счёт получен',
      approval: 'На согласовании',
      to_pay: 'К оплате',
      paid: 'Оплачен',
      shipping: 'Едет',
      partial: 'Частично',
      received: 'Получен',
      closed: 'Закрыт',
      cancelled: 'Отменён'
    })[s] || s || '';
  }

  async function wtbGet(params) {
    var q = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') q.set(k, params[k]);
    });
    var path = '/api/supply/what-to-buy' + (q.toString() ? '?' + q : '');
    if (typeof apiGet === 'function') return await apiGet(path);
    var token = (typeof TOKEN_KEY !== 'undefined' && localStorage.getItem(TOKEN_KEY)) || localStorage.getItem('token') || '';
    var base = (typeof API_BASE !== 'undefined' ? API_BASE : '');
    var r = await fetch(base + path, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) {
      var err = new Error('HTTP ' + r.status);
      err.status = r.status;
      throw err;
    }
    return r.json();
  }


  function warnTone(code) {
    if (code === 'in_stock_not_reserved') return 'stock';
    if (code === 'stale_inventory') return 'wait';
    return 'err';
  }
  function renderWarns(list) {
    if (!list || !list.length) return '';
    return '<div class="wtb-warns">' + list.map(function (w) {
      var extra = '';
      if (w.active_duplicate) {
        extra = ' <span class="wtb-dup">активный дубль #' + w.active_duplicate.component_id +
          (w.active_duplicate.sku ? ' · ' + _esc(w.active_duplicate.sku) : '') + '</span>';
      }
      return '<div class="wtb-warn ' + warnTone(w.code) + '"><b>' + _esc(w.title || statusLabel(w.code)) + '</b>' +
        _esc(w.text || '') + extra + '</div>';
    }).join('') + '</div>';
  }
  function withoutInventory(list) {
    return (list || []).filter(function (w) { return w.code !== 'stale_inventory'; });
  }
  function inventorySummary(card) {
    var s = card && card.inventory_summary;
    if (!s || !s.count) return '';
    var id = 'inv:' + (card.contract_id || 'x');
    var open = !!st.open[id];
    var items = (s.items || []).map(function (it) {
      var when = it.last_at
        ? ('последняя ' + String(it.last_at).slice(0, 10) + (it.days != null ? ' (' + it.days + ' дн.)' : ''))
        : 'инвентаризации не было';
      return '<div class="wtb-min-row"><div><b>' + _esc(it.name || ('#' + it.component_id)) + '</b>' +
        (it.sku ? '<div class="s">' + _esc(it.sku) + '</div>' : '') +
        (it.product ? '<div class="s">' + _esc(it.product) + '</div>' : '') +
        '</div><div class="s">' + _esc(when) + '</div></div>';
    }).join('');
    return '<div class="wtb-report wtb-invsum' + (open ? ' open' : '') + '" data-wtb-open="' + id + '">' +
      '<div class="rh"><div><b>Инвентаризация</b><div class="meta2">' +
      _esc(s.text || (s.count + ' позиций без инвентаризации >' + (s.stale_days || 60) + ' дн.')) +
      '</div></div><span class="wtb-pill wait">' + s.count + '</span></div>' +
      '<div class="rb">' + items + '</div></div>';
  }
  function linkMethodRu(m) {
    return ({
      explicit: 'явная связь',
      name_normalized: 'по имени',
      name_alnum: 'по имени без знаков',
      article: 'по артикулу',
      fuzzy: 'похожее имя'
    })[m] || (m || 'не связана');
  }
  function suggestionInScope(s) {
    if (!st.contractId) return true;
    if (s.dest_contract_id && Number(s.dest_contract_id) === Number(st.contractId)) return true;
    var rows = (st.landing && st.landing.in_transit) || [];
    return rows.some(function (o) {
      if (o.order_id !== s.order_id && o.order_label !== s.order_label) return false;
      return Number(o.dest_contract_id) === Number(st.contractId);
    });
  }
  function linkSuggestionsBlock(data) {
    var list = ((data && data.link_suggestions) || []).filter(suggestionInScope);
    if (!list.length) return '';
    var html = '<div class="wtb-sug" data-wtb-sugs><h3>Предлагаемые связи заказ → склад · ' + list.length + '</h3>' +
      '<div class="lead" style="color:var(--wtb-muted);font-size:13px;margin-bottom:8px;">Однозначные совпадения можно проставить скриптом на копии БД. В живую базу скрипт сам ничего не пишет.</div>';
    list.forEach(function (s) {
      var cands = (s.candidates || []).map(function (c) {
        return 'компонент ' + c.component_id + ' «' + _esc(c.name || '') + '»' +
          (c.sku ? ' · ' + _esc(c.sku) : '') +
          (c.method ? ' (' + linkMethodRu(c.method) + ')' : '');
      }).join('; ');
      html += '<div class="row"><b>' + _esc(s.order_label || ('ORD-' + s.order_id)) + '</b> · ' +
        _esc(s.item_name || '') +
        (s.auto_component_id ? ' → компонент ' + s.auto_component_id + ' (' + linkMethodRu(s.method) + '), стоит проставить явную связь' : '') +
        (cands && !s.auto_component_id ? ' · варианты: ' + cands : '') +
        '</div>';
    });
    return html + '</div>';
  }

  function isDisabled() { return localStorage.getItem(LS) === '0'; }

  window.wtbTryLoad = async function (container) {
    if (isDisabled()) return false;
    if (!container) return false;
    try {
      st.container = container;
      st.componentFilter = 'all';
      st.view = 'landing';
      st.contractId = null;
      container.innerHTML = '<div class="loading-block">Считаем, что нужно закупить…</div>';
      st.landing = await wtbGet();
      render();
      return true;
    } catch (e) {
      var msg = String((e && (e.message || e.detail || e.error)) || e || '');
      var code = e && (e.status || e.statusCode || e.code);
      if (code === 404 || /404|not found|what-to-buy/i.test(msg)) return false;
      container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + _esc(msg) +
        ' <button type="button" class="wtb-legacy" onclick="localStorage.setItem(\'supplyWhatV1\',\'0\');loadSupplyShopping()">Старый список</button></div>';
      return true;
    }
  };

  async function openContract(id, itemId) {
    st.contractId = id; st.view = 'contract'; st.q = ''; st.componentFilter = 'all';
    var seq = ++st.loadSeq;
    st.container.innerHTML = '<div class="loading-block">Загружаем изделия договора…</div>';
    var tree = await wtbGet({ contract_id: id });
    if (seq !== st.loadSeq) return;
    st.tree = tree;
    if (itemId) st.open['ci:' + itemId] = true;
    render();
  }

  async function setView(view) {
    var seq = ++st.loadSeq;
    st.view = view; st.q = ''; st.componentFilter = 'all';
    if (view === 'landing') {
      st.contractId = null; st.landing = await wtbGet();
    } else if (view === 'list' || view === 'products' || view === 'suppliers') {
      st.contractId = null;
      st.tree = await wtbGet({ view: 'products' });
    } else if (view === 'in_transit') {
      st.landing = await wtbGet({ view: 'in_transit', include_drafts: st.includeDrafts ? '1' : '' });
    } else if (view === 'inactive_bom') {
      st.inactive = await wtbGet({ view: 'inactive_bom' });
    } else if (st.contractId) {
      st.tree = await wtbGet({ contract_id: st.contractId });
    }
    if (seq === st.loadSeq) render();
  }

  function setSub(text) {
    var sub = document.querySelector('[data-screen="supply-shopping"] .page-subtitle');
    if (sub) sub.textContent = text;
  }
  function setCounter(n) {
    var el = document.getElementById('sup-shop-counter');
    if (el) el.textContent = n;
  }

  function toolbar(active) {
    var main = [['landing', 'По договору'], ['list', 'Общая закупка']];
    var more = [['products', 'Все изделия'], ['suppliers', 'По поставщикам'], ['in_transit', 'Заказы в пути'], ['inactive_bom', 'Ошибки состава']];
    function button(b) {
      var on = b[0] === active || b[0] === 'landing' && active === 'contract';
      return '<button type="button" class="' + (on ? 'on' : '') + '" data-wtb-view="' + b[0] + '" aria-pressed="' + on + '">' + b[1] + '</button>';
    }
    return '<div class="wtb-toolbar"><div class="wtb-seg">' + main.map(button).join('') + '</div>' +
      '<details class="wtb-more"><summary>Ещё</summary><div class="wtb-more-menu">' + more.map(button).join('') + '</div></details>' +
      '<input class="wtb-search" type="search" aria-label="Поиск по изделиям и комплектующим" placeholder="Изделие или комплектующее…" value="' + _esc(st.q) + '" data-wtb-search></div>';
  }

  function matchQ(text) {
    if (!st.q) return true;
    return String(text || '').toLowerCase().indexOf(st.q.toLowerCase()) >= 0;
  }

  function cardTone(c) {
    if ((c.data_errors || 0) > 0) return 'mid';
    if ((c.to_buy_qty || 0) > 0) return 'need';
    return 'oktop';
  }

  function renderLanding() {
    var data = st.landing || {}, cards = (data.contracts || []).filter(function (c) { return matchQ(c.number + ' ' + c.contractor_name); });
    setCounter(cards.reduce(function (n, c) { return n + Number((c.summary || {}).to_buy_lines || 0); }, 0));
    setSub('Договор → изделия → комплектующие. Склад, размещённые заказы и недостающее количество.');
    var html = '<div class="wtb-root wtb-v311">' + toolbar('landing') + '<div class="wtb-h2">Выберите договор · ' + cards.length + '</div><div class="wtb-lcards">';
    cards.forEach(function (c) {
      var s = c.summary || {};
      html += '<button type="button" class="wtb-lcard ' + cardTone(c) + '" data-wtb-contract="' + c.contract_id + '"><div class="num">' +
        _esc(c.number) + '</div><div class="who">' + _esc(c.contractor_name || '') + '</div><div class="wtb-card-count">' + Number(c.items_count || 0) + ' изделий / позиций договора</div><div class="rowm">' +
        '<div class="m ok"><b>' + Number(s.stock_lines || 0) + '</b>на складе, поз.</div><div class="m wait"><b>' + Number(s.in_transit_lines || 0) +
        '</b>в пути, поз.</div><div class="m buy' + (Number(s.to_buy_lines || 0) ? '' : ' wtb-zero') + '"><b>' + Number(s.to_buy_lines || 0) + '</b>купить, поз.</div></div>' +
        (s.production_allocated_products ? '<div class="wtb-card-count">Уже в работе / готово: ' + Number(s.production_allocated_products) + ' изделий</div>' : '') +
        (c.data_errors ? '<div class="wtb-card-issue"><i class="ti ti-alert-triangle"></i> Проверить состав: ' + c.data_errors + '</div>' : '') +
        '<div class="wtb-card-open">Открыть изделия <i class="ti ti-arrow-right"></i></div></button>';
    });
    if (!cards.length) html += '<div class="wtb-empty">Нет договоров в производстве</div>';
    html += '</div>';
    var shipped = (data.shipped_contracts || []).filter(function (c) { return matchQ(c.number + ' ' + (c.contractor_name || '')); });
    if (shipped.length) {
      html += '<details class="wtb-diagnostics"><summary>Недавно отправленные договоры</summary><div class="wtb-minbox">' +
        shipped.map(function (c) {
          return '<button type="button" class="wtb-link" data-wtb-contract="' + Number(c.contract_id) + '">' +
            _esc(c.number) + (c.shipped_date ? ' · ' + _esc(invoiceDate(c.shipped_date)) : '') + '</button>';
        }).join('') + '</div></details>';
    }
    html += '<details class="wtb-diagnostics"><summary>Пополнение склада · минимальные остатки</summary><div class="wtb-minbox">';
    (((data.min_stock || {}).items) || []).filter(function (m) { return matchQ(m.name); }).forEach(function (m) {
      html += '<div class="wtb-min-row"><b>' + _esc(m.name) + '</b><span>Докупить ' + fmt(m.gap) + ' ' + unit(m.unit) + '</span></div>';
    });
    html += '</div></details><details class="wtb-diagnostics"><summary>Проверить связи заказов со складом</summary>' + linkSuggestionsBlock(data) + '</details>';
    return html + '<button type="button" class="wtb-legacy" data-wtb-legacy>Прежний вид</button></div>';
  }

  function readinessBar(row) {
    var pct = row.readiness_pct || 0;
    var err = (row.data_errors || []).length;
    if (err && !(row.children || []).length) {
      return '<div class="wtb-bar-wrap"><div class="wtb-bar empty"></div><div class="wtb-bar-lbl">Нет состава</div></div>';
    }
    var buy = 0, wait = 0, ok = 0, tot = 0;
    (row.children || []).forEach(function (ch) {
      var n = Number(ch.need || 0) || 1;
      tot += n;
      buy += Number(ch.to_buy || 0);
      wait += Number(ch.in_transit_allocated || 0);
      ok += Number(ch.stock_allocated || 0);
    });
    if (!tot) {
      return '<div class="wtb-bar-wrap"><div class="wtb-bar"><i class="s" style="width:' + pct + '%"></i></div>' +
        '<div class="wtb-bar-lbl">Готовность ' + pct + '%</div></div>';
    }
    return '<div class="wtb-bar-wrap"><div class="wtb-bar">' +
      '<i class="s" style="width:' + (100 * ok / tot) + '%"></i>' +
      '<i class="o" style="width:' + (100 * wait / tot) + '%"></i></div>' +
      '<div class="wtb-bar-lbl">Готовность ' + pct + '% · склад ' + fmt(ok) + ' · в пути ' + fmt(wait) +
      (buy ? ' · докупить ' + fmt(buy) : '') + '</div></div>';
  }

  function shareChips(ch) {
    return (ch.share || []).map(function (s) {
      return '<span class="wtb-share">ещё нужно: ' + _esc(s.contract_number || ('#' + s.contract_id)) +
        (s.product ? ' / ' + _esc(s.product) : '') + ' ×' + fmt(s.qty) + '</span>';
    }).join('');
  }


  function toOrder(obj) {
    if (!obj) return 0;
    if (obj.to_order != null) return Number(obj.to_order) || 0;
    return Number(obj.to_buy != null ? obj.to_buy : obj.to_buy_qty) || 0;
  }
  function lineKey(row, ch) {
    if (ch && ch.component_id) return 'ci:' + row.contract_item_id + ':c:' + ch.component_id;
    return 'ci:' + row.contract_item_id;
  }
  function orderableLine(row, ch) {
    if (ch) {
      return {
        key: lineKey(row, ch),
        contract_id: row.contract_id,
        contract_item_id: row.contract_item_id,
        component_id: ch.component_id || null,
        name: ch.name,
        product_name: row.name,
        position_no: row.position_no,
        qty: toOrder(ch),
        unit: ch.unit || row.unit,
        supplier_id: ch.body_bundle ? (ch.body_bundle.supplier_id || null) : (ch.supplier_id || row.supplier_id || null),
        supplier_name: ch.body_bundle ? ch.body_bundle.supplier_name : (ch.supplier_name || row.supplier_name || ''),
        body_bundle: ch.body_bundle || null,
        qty_to_buy: Number(ch.to_buy) || 0,
        contract_number: row.contract_number,
        drafts: ch.drafts || []
      };
    }
    return {
      key: lineKey(row, null),
      contract_id: row.contract_id,
      contract_item_id: row.contract_item_id,
      component_id: null,
      direct_purchase: row.supply_kind === 'sale_product' || row.supply_kind === 'free_text',
      name: row.name,
      product_name: row.name,
      position_no: row.position_no,
      qty: toOrder(row),
      unit: row.unit,
      supplier_id: row.supplier_id || null,
      supplier_name: row.supplier_name || '',
      contract_number: row.contract_number,
      drafts: row.drafts || []
    };
  }
  function draftChips(list) {
    return (list || []).map(function (d) {
      return '<span class="wtb-pill wait" title="Черновик, поставщику не отправлен">черновик ' +
        _esc(d.order_label || ('ORD-' + d.order_id)) + '</span>';
    }).join('');
  }
  function collectOrderable(items) {
    var out = [];
    (items || []).forEach(function (row) {
      if (row.children && row.children.length) {
        row.children.forEach(function (ch) {
          if (toOrder(ch) > 0) out.push(orderableLine(row, ch));
        });
      } else if (toOrder(row) > 0) {
        out.push(orderableLine(row, null));
      }
    });
    return out;
  }
  function overrideOf(raw) {
    if (raw == null || raw === '') return {};
    if (typeof raw === 'number' || typeof raw === 'string') return { supplier_id: Number(raw) };
    return raw;
  }
  function linePayload(l, supplierOverride) {
    var ov = overrideOf(supplierOverride);
    var o = {
      key: l.key,
      contract_id: l.contract_id,
      contract_item_id: l.contract_item_id,
      component_id: l.component_id,
      qty: l.qty
    };
    var sid = ov.supplier_id || l.supplier_id;
    if (sid) o.supplier_id = sid;
    if (ov.supplier_alias) o.supplier_alias = ov.supplier_alias;
    return o;
  }

  function childRow(row, ch, inBundle) {
    var line = orderableLine(row, ch), can = toOrder(ch) > 0, manual = recordedLine(row, ch);
    var box = !inBundle && can ? '<input type="checkbox" aria-label="Выбрать ' + _esc(ch.name) + '" data-wtb-line="' + _esc(line.key) + '"' + (st.selected[line.key] ? ' checked' : '') + '>' : '';
    var action = '';
    if (!inBundle && can) action += '<button type="button" class="wtb-order-btn" data-wtb-order-one="' + _esc(line.key) + '">Заказать</button>';
    if (!inBundle && manual) action += '<button type="button" class="wtb-order-btn wtb-manual-btn" data-wtb-record-one="' + _esc(line.key) + '">Уже заказали</button>';
    if (Number(ch.stock_available_to_reserve) > 0) action += '<button type="button" class="wtb-small-btn" data-wtb-reserve="' + row.contract_item_id + '" data-component="' + ch.component_id + '">Зарезервировать под этот заказ</button>';
    var warn = (ch.warnings || []).filter(function (w) { return w.code !== 'stale_inventory' && w.code !== 'in_stock_not_reserved'; });
    var stockQty = ch.stock_on_hand == null ? ch.stock_allocated : ch.stock_on_hand;
    var stockNote = ch.stock_free == null ? '' : '<small>Свободно: ' + fmt(ch.stock_free) + '</small>';
    stockNote += '<small>В резерве изделия: ' + fmt(ch.reserved_qty) + '</small>';
    if (Number(ch.stock_available_to_reserve) > 0) stockNote += '<small>Доступно для изделия: ' + fmt(ch.stock_available_to_reserve) + '</small>';
    return '<tr><td class="wtb-td-check">' + box + '</td><td class="nm" data-label="Комплектующее">' + _esc(ch.name || '—') +
      (ch.sku ? '<small>' + _esc(ch.sku) + '</small>' : '') + (ch.qty_required != null ? '<small>На изделие: ' + fmt(ch.qty_required) + ' ' + unit(ch.unit) + '</small>' : '') +
      (warn.length ? '<span class="wtb-inline-issue" title="' + _esc(warn.map(function (w) { return w.text || w.title; }).join('\n')) + '"><i class="ti ti-alert-triangle"></i> Проверить состав</span>' : '') +
      '</td><td data-label="Нужно">' + fmt(ch.need) + '<small>' + unit(ch.unit) + '</small></td><td data-label="На складе">' + fmt(stockQty) + ' ' + unit(ch.unit) + stockNote +
      '</td><td data-label="В пути" class="wtb-num-wait">' + fmt(ch.in_transit_allocated) + '</td><td data-label="Купить" class="' + (ch.to_buy > 0 ? 'wtb-num-buy' : '') + '">' + fmt(ch.to_buy) +
      '</td><td class="wtb-actions-cell" data-label="Состояние"><span class="wtb-line-state ' + statusClass(ch.status) + '">' + _esc(lineStatus(row, ch)) + '</span><div class="wtb-line-actions">' + action + draftChips(ch.drafts) + '</div></td></tr>';
  }

  function productionStatus(row) {
    if (row.supply_kind === 'purchase_only' || row.supply_kind === 'sale_product') {
      return '<div class="wtb-production wtb-production-muted">Покупное изделие</div>';
    }
    if (!row.production) {
      return row.supply_kind === 'assembly' || row.supply_kind === 'assembly_mod'
        ? '<div class="wtb-production wtb-production-muted">Нет данных производства</div>' : '';
    }
    var p = row.production;
    var labels = { queued: 'В очереди', running: 'В работе', stopped: 'Стоп', assembled: 'Собрано' };
    var label = labels[p.state];
    if (!label) return '';
    var percent = p.progress == null ? null : Math.max(0, Math.min(100, Number(p.progress) || 0));
    return '<div class="wtb-production wtb-production-' + _esc(p.state) + '">' +
      '<div class="wtb-production-head"><span class="wtb-production-badge">' + _esc(label) + '</span>' +
      (percent === null ? '' : '<b>' + percent + '%</b>') + '</div>' +
      (p.stage && p.state !== 'assembled' ? '<strong>' + _esc(p.stage) + '</strong>' : '') +
      (percent === null ? '' : '<progress aria-label="Готовность производства" max="100" value="' + percent + '"></progress>') +
      (p.comment ? '<div class="wtb-production-comment">' + _esc(p.comment) + '</div>' : '') +
      (p.state === 'stopped' && !p.comment ? '<div class="wtb-production-comment">Причина остановки не указана</div>' : '') +
      (p.expected_date ? '<div class="wtb-production-comment">Ожидаемая поставка · ' + _esc(invoiceDate(p.expected_date)) + '</div>' : '') +
      '</div>';
  }

  function shippingStatus(card) {
    var sent = card.status === 'shipped';
    var date = String((sent ? card.shipped_date : card.delivery_date) || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return '<div class="wtb-shipping"><span>Отправка заказчику</span><b>' +
        (sent ? 'Отправлено · дата не указана' : 'Дата не назначена') + '</b></div>';
    }
    var planned = new Date(date + 'T00:00:00Z');
    if (Number.isNaN(planned.valueOf()) || planned.toISOString().slice(0, 10) !== date) return '';
    var now = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Yekaterinburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    var days = Math.round((planned - new Date(now + 'T00:00:00Z')) / 86400000);
    var quantity = Math.abs(days);
    var word = { one: 'день', few: 'дня', many: 'дней' }[new Intl.PluralRules('ru').select(quantity)] || 'дней';
    var label = sent ? 'Отправлено' : days === 0 ? 'Сегодня' : (days < 0 ? 'Просрочено на ' : 'Осталось ') + quantity + ' ' + word;
    return '<div class="wtb-shipping' + (!sent && days < 0 ? ' late' : '') + '"><span>Отправка заказчику</span><b>' +
      _esc(planned.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })) +
      '</b><strong>' + label + '</strong></div>';
  }

  function refreshShippingClock() {
    if (st.shippingTimer != null) clearTimeout(st.shippingTimer);
    st.shippingTimer = null;
    if (!st.contractId) return;
    var shipping = st.container && st.container.querySelector('.wtb-shipping');
    var card = st.tree && st.tree.contract;
    if (!shipping || !shipping.isConnected || !card || card.status === 'shipped') return;
    var next = shippingStatus(card);
    if (next && shipping.outerHTML !== next) shipping.outerHTML = next;
    st.shippingTimer = setTimeout(refreshShippingClock, 60000);
  }

  function productCard(row, withContract) {
    var id = row.id || ('ci:' + row.contract_item_id), open = Object.prototype.hasOwnProperty.call(st.open, id) ? !!st.open[id] : false;
    var summary = row.summary || summaryOf([row]), normal = collectOrderable([row]), manual = manualLines([row]);
    var checked = normal.length && normal.every(function (l) { return st.selected[l.key]; });
    var pills = '<span class="wtb-pill ok">Склад ' + summary.stock_lines + ' поз.</span><span class="wtb-pill wait">В пути ' + summary.in_transit_lines + ' поз.</span><span class="wtb-pill ' + (summary.to_buy_lines > 0 ? 'buy' : 'none') + '">Купить ' + summary.to_buy_lines + ' поз.</span>';
    var warnings = withoutInventory(row.warnings).filter(function (w) { return w.code !== 'in_stock_not_reserved'; });
    var pending = (row.children || []).filter(function (c) { return Number(c.stock_available_to_reserve) > 0; });
    var body = '';
    if (row.production_allocated_qty > 0) body += '<div class="wtb-production-note">Изделий уже выделено в производство / готово: ' + fmt(row.production_allocated_qty) + ' ' + unit(row.unit) + '. Комплектующие ниже рассчитаны на оставшийся объём.</div>';
    body += '<div class="wtb-bom-source"><span>Состав из производственной номенклатуры</span><span>' + positionText((row.children || []).length) + '</span></div>';
    if (pending.length) body += '<div class="wtb-reserve-summary"><div><b>На складе есть ' + positionText(pending.length) + ' без резерва</b><small>Резерв выделяет комплектующие со склада под это изделие.</small></div><button type="button" class="wtb-small-btn" data-wtb-reserve="' + row.contract_item_id + '">Зарезервировать всё</button></div>';
    if ((row.children || []).length || (row.bom_nodes || []).length) body += productComponents(row);
    else body += '<div class="wtb-direct-state">' + ((row.data_errors || []).length ? 'Состав изделия не заполнен. Требуется проверка номенклатуры.' : row.historical ? 'Отправлено заказчику' : row.production_allocated_qty >= row.qty ? 'Изделие уже выделено под договор.' : 'Покупная позиция договора · ' + fmt(row.direct_need || row.qty) + ' ' + unit(row.unit)) + '</div>';
    if (warnings.length) body += '<details class="wtb-diagnostics"><summary>Проверить состав · ' + warnings.length + '</summary>' + renderWarns(warnings) + '</details>';
    return '<section class="wtb-card ' + statusClass(row.status) + (open ? ' open' : '') + '" data-wtb-open="' + _esc(id) + '"><div class="wtb-ch">' +
      '<div class="wtb-pos">' + (normal.length ? '<label class="wtb-check"><input type="checkbox" aria-label="Выбрать комплектующие изделия" data-wtb-line-group="' + _esc(id) + '"' + (checked ? ' checked' : '') + '></label>' : _esc(row.position_no || '')) + '</div>' +
      '<button type="button" class="wtb-heading-toggle" aria-expanded="' + open + '"><span class="name">' + _esc(productName(row)) + '</span><span class="meta2">' + fmt(row.qty) + ' ' + unit(row.unit) +
      (withContract ? ' · договор ' + _esc(row.contract_number) : '') + ' · ' + positionText((row.children || []).length) + ' в составе</span><span class="wtb-pills">' + pills + '</span></button>' +
      productionStatus(row) + '<div class="wtb-cstat">' +
      (normal.length ? '<button type="button" class="wtb-order-btn" data-wtb-order-group="' + _esc(id) + '">Заказать</button>' : '') +
      (manual.length ? '<button type="button" class="wtb-order-btn wtb-manual-btn" data-wtb-record-group="' + _esc(id) + '">Уже заказали</button>' : '') +
      ((row.data_errors || []).length ? '<span class="wtb-pill err">Проверить состав · ' + row.data_errors.length + '</span>' : '') + '<span class="wtb-tog">▾</span></div></div><div class="wtb-bodyc">' + body + '</div></section>';
  }

  function filterItems(items) {
    return (items || []).filter(function (row) {
      if (matchQ([row.name, row.contract_number, row.model_article].join(' '))) return true;
      return (row.children || []).some(function (c) { return matchQ(c.name + ' ' + (c.sku || '')); });
    });
  }

  function renderContractOrProducts(view) {
    var payload = st.tree || {}, card = st.contractId && payload.contract, all = payload.items || [];
    var items = filterItems(all).filter(function (r) { return st.componentFilter === 'all' || (r.children && r.children.length ? visibleChildren(r).length : lineMatchesFilter(r)); });
    var summary = summaryOf(all);
    setCounter(summary.to_buy_lines);
    setSub(card ? 'Договор → изделие → комплектующие. Состав берётся из производственной номенклатуры.' : 'Изделия всех договоров и их комплектующие.');
    var number = card ? String(card.number || '').trim() : '';
    var title = /^договор(?:\s|$)/i.test(number) ? number : ('Договор ' + number).trim();
    var head = card ? '<button type="button" class="wtb-back" data-wtb-view="landing">← Все договоры</button><div class="wtb-contract-heading"><div><h2>' + _esc(title) +
      '</h2><span>' + _esc(card.contractor_name || '') + '</span></div>' + shippingStatus(card) + '</div>' : '<div class="wtb-h2">Все изделия</div>';
    var html = '<div class="wtb-root wtb-v311">' + toolbar(card ? 'contract' : view) + head + summaryCards(summary) +
      '<div class="wtb-products-caption"><b>Изделия / позиции договора · ' + all.length + '</b><span>' + positionText(summary.lines) + ' в составе</span>' +
      (st.componentFilter !== 'all' ? '<button type="button" class="wtb-link" data-wtb-filter="all">Показать весь состав</button>' : '') + '</div><div class="wtb-tree">';
    items.forEach(function (row) { html += productCard(row, !card); });
    if (!items.length) html += '<div class="wtb-empty">Нет позиций с выбранным состоянием</div>';
    html += '</div>' + orderBar(all);
    if (card) html += '<details class="wtb-diagnostics"><summary>Инвентаризация и качество данных</summary>' + inventorySummary(card) + '</details>';
    return html + '</div>';
  }

  function collectLines(items) {
    var lines = [];
    (items || []).forEach(function (row) {
      if (row.children && row.children.length) {
        row.children.forEach(function (ch) {
          lines.push({
            product: row.name,
            contract: row.contract_number,
            contract_id: row.contract_id,
            name: ch.name,
            sku: ch.sku,
            unit: ch.unit,
            need: ch.need,
            stock: ch.stock_allocated,
            in_transit: ch.in_transit_allocated,
            to_buy: ch.to_buy,
            status: ch.status,
            supplier: ch.supplier_name || 'Без поставщика',
            flags: ch.flags,
            in_stock_not_reserved: ch.in_stock_not_reserved,
            share: ch.share
          });
        });
      } else {
        lines.push({
          product: row.name,
          contract: row.contract_number,
          contract_id: row.contract_id,
          name: row.name,
          sku: row.model_article,
          unit: row.unit,
          need: row.direct_need || row.qty,
          stock: row.stock_qty,
          in_transit: row.in_transit_qty,
          to_buy: row.to_buy_qty,
          status: row.status,
          supplier: row.supplier_name || 'Без поставщика',
          flags: [],
          in_stock_not_reserved: false,
          share: []
        });
      }
    });
    return lines.filter(function (l) {
      return matchQ([l.name, l.product, l.contract, l.sku, l.supplier].join(' '));
    });
  }

  function renderSuppliers() {
    var payload = st.contractId ? st.tree : (st.tree || st.landing);
    var lines = collectLines(payload && payload.items);
    var groups = {};
    lines.forEach(function (l) {
      (groups[l.supplier] = groups[l.supplier] || []).push(l);
    });
    setCounter(lines.filter(function (l) { return l.to_buy > 0; }).length);
    setSub('Комплектующие, сгруппированные по поставщику.');
    var html = '<div class="wtb-root">' + toolbar('suppliers');
    Object.keys(groups).sort().forEach(function (sup) {
      var gl = groups[sup];
      var buy = gl.reduce(function (s, l) { return s + (Number(l.to_buy) || 0); }, 0);
      html += '<div class="wtb-supg"><div class="gh"><b>' + _esc(sup) + '</b><span class="sp"></span>' +
        (buy ? '<span class="wtb-pill buy">докупить ' + fmt(buy) + '</span>' : '') + '</div>' +
        '<table class="wtb-comp"><thead><tr><th></th><th>Позиция</th><th>Нужно</th><th>Склад</th><th>В пути</th><th>Докупить</th><th>Статус</th></tr></thead><tbody>';
      gl.forEach(function (l) {
        html += '<tr><td></td><td class="nm">' + _esc(l.name) +
          '<small>' + _esc(l.product || '') +
          (l.contract ? ' · ' + _esc(l.contract) : '') + '</small>' +
          (l.in_stock_not_reserved ? '<span class="wtb-pill mark">на складе, не зарезервировано</span>' : '') +
          '</td><td>' + fmt(l.need) + '</td><td>' + fmt(l.stock) + '</td>' +
          '<td class="wtb-num-wait">' + fmt(l.in_transit) + '</td>' +
          '<td class="' + (l.to_buy > 0 ? 'wtb-num-buy' : 'wtb-num-ok') + '">' + fmt(l.to_buy) + '</td>' +
          '<td>' + _esc(statusLabel(l.status)) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    });
    if (!lines.length) html += '<div class="wtb-empty">Нет позиций</div>';
    html += '</div>';
    return html;
  }

  function renderList() {
    var groups = aggregatePurchases((st.tree || {}).items), owners = {};
    groups.forEach(function (g) { g.manual.forEach(function (l) { owners[l.contract_id] = true; }); });
    setCounter(groups.length); setSub('Общая закупка по всем договорам. У каждого комплектующего видны договор и изделие.');
    var html = '<div class="wtb-root wtb-v311">' + toolbar('list') + '<div class="wtb-products-caption"><b>Общая закупка · ' + positionText(groups.length) + '</b><span>Договоров: ' + Object.keys(owners).length + '</span></div>';
    if (!groups.length) return html + '<div class="wtb-empty">По всем договорам всё есть на складе или уже заказано</div></div>';
    html += '<div class="wtb-general-list">';
    groups.forEach(function (g) {
      var destinations = {};
      g.refs.filter(function (ref) { return ref.buy > 0; }).forEach(function (ref) { var key = ref.row.contract_item_id, dest = destinations[key] || (destinations[key] = { row: ref.row, line: ref.line, buy: 0 }); dest.buy += g.bundle ? 1 : ref.buy; });
      var links = Object.keys(destinations).map(function (key) { var ref = destinations[key]; return '<button type="button" class="wtb-destination" data-wtb-destination="' + ref.row.contract_id + ':' + ref.row.contract_item_id + '">' + _esc(ref.row.contract_number) + ' → ' + _esc(productName(ref.row)) + ' · ' + fmt(ref.buy) + ' ' + unit(g.bundle ? 'поз.' : ref.line.unit) + '</button>'; }).join('');
      html += '<article class="wtb-general-row"><div class="wtb-general-info"><b>' + _esc(g.name) + '</b><div class="wtb-destinations">' + links + '</div><details class="wtb-general-detail"><summary>Склад, поставки и потребность</summary><div class="wtb-general-facts">Нужно: ' + fmt(g.need) + ' ' + unit(g.unit) + ' · На складе: ' + fmt(g.stock) + ' ' + unit(g.unit) + ' · В пути: ' + fmt(g.incoming) + ' ' + unit(g.unit) + '</div></details></div><div class="wtb-general-buy"><small>Купить</small><b>' + fmt(g.buy) + '</b><small>' + unit(g.unit) + '</small></div><div class="wtb-general-actions">' +
        (g.orderable.length ? '<button type="button" class="wtb-order-btn" data-wtb-order-aggregate="' + _esc(g.key) + '">' + (g.bundle ? 'Заказать корпус' : 'Заказать') + '</button>' : '') +
        '<button type="button" class="wtb-order-btn wtb-manual-btn" data-wtb-record-aggregate="' + _esc(g.key) + '">Уже заказали</button></div></article>';
    });
    return html + '</div></div>';
  }

  function transitRows() {
    var rows = (st.landing && st.landing.in_transit) || [];
    if (st.contractId) {
      rows = rows.filter(function (o) {
        if (Number(o.dest_contract_id) === Number(st.contractId)) return true;
        // если у заказа нет своего dest — показываем по распределению на этот договор
        if (o.dest_contract_id == null || o.dest_contract_id === '') {
          return (o.destinations || []).some(function (d) { return Number(d.contract_id) === Number(st.contractId); });
        }
        return false;
      });
    }
    return rows.filter(function (o) {
      return matchQ([o.order_label, o.item_name, o.supplier_name, o.dest_contract_number,
        o.component_id, (o.link_suggestions || []).map(function (s) { return s.name; }).join(' ')].join(' '));
    });
  }
  function renderTransit() {
    var rows = transitRows();
    setCounter(rows.length);
    var scope = '';
    if (st.contractId && st.tree && st.tree.contract) scope = ' Договор ' + (st.tree.contract.number || '') + '.';
    setSub('Заказы, отправленные поставщику или оплаченные, но ещё не полностью принятые. Черновики скрыты.' + scope);
    var html = '<div class="wtb-root">' + toolbar('in_transit');
    if (st.contractId && st.tree && st.tree.contract) {
      html += '<button type="button" class="wtb-back" data-wtb-view="contract">← К договору ' +
        _esc(st.tree.contract.number || '') + '</button>';
    }
    html += '<label class="wtb-hint" style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">' +
      '<input type="checkbox" data-wtb-drafts' + (st.includeDrafts ? ' checked' : '') + '> Показать черновики</label>';
    html += linkSuggestionsBlock(st.landing);
    if (!rows.length) html += '<div class="wtb-empty">' +
      (st.contractId ? 'Нет заказов в пути по этому договору' : 'Нет заказов в пути') + '</div>';
    rows.forEach(function (o) {
      var dest = o.dest_contract_number || ((o.destinations || []).map(function (d) { return d.contract_number; }).filter(Boolean).join(', ')) || '—';
      var linkMeta = '';
      if (o.component_id) {
        linkMeta = 'связано с компонентом ' + o.component_id + ' (' + linkMethodRu(o.link_method) + ')';
        if (o.needs_explicit && o.link_method !== 'explicit') linkMeta += ' · стоит проставить явную связь';
      } else if ((o.link_suggestions || []).length) {
        linkMeta = 'не связана однозначно · варианты: ' + (o.link_suggestions || []).map(function (s) {
          return 'компонент ' + s.component_id + ' «' + (s.name || '') + '»';
        }).join('; ');
      } else {
        linkMeta = 'карточка склада не найдена';
      }
      html += '<div class="wtb-tr' + (o.overdue ? ' overdue' : '') + (String(o.order_label || '').indexOf('ORD-464') >= 0 ? ' wtb-ord464' : '') +
        '" data-order="' + _esc(o.order_label || '') + '" data-component="' + (o.component_id || '') + '">' +
        '<div><div class="lbl">' + _esc(o.order_label || ('ORD-' + o.order_id)) + '</div>' +
          '<div class="meta">' + _esc(o.supplier_name || 'Без поставщика') + '</div></div>' +
        '<div><div class="lbl">' + _esc(o.item_name) + '</div>' +
          '<div class="meta">договор ' + _esc(dest) + '</div>' +
          '<div class="meta">' + _esc(linkMeta) + '</div></div>' +
        '<div>' + _esc(orderStatusRu(o.status)) + (o.paid ? ' · оплачен' : '') + '</div>' +
        '<div>принято ' + fmt(o.received_qty) + ' / ' + fmt(o.qty) + '<div class="meta">осталось ' + fmt(o.remaining_qty) + '</div></div>' +
        '<div>' + (o.expected_date ? _esc(String(o.expected_date).slice(0, 10)) : 'без даты') +
          (o.overdue ? '<div class="over">просрочен</div>' : '') + '</div></div>';
    });
    html += '</div>';
    return html;
  }
  function renderInactiveBom() {
    var d = st.inactive || { models: [], models_count: 0, inactive_lines: 0 };
    var models = (d.models || []).filter(function (m) {
      if (matchQ([m.article, m.name].join(' '))) return true;
      return (m.items || []).some(function (it) { return matchQ(it.name + ' ' + (it.sku || '')); });
    });
    setCounter(d.inactive_lines || 0);
    setSub('Неактивные позиции в BOM по всем моделям, не только по договорам в производстве.');
    var html = '<div class="wtb-root">' + toolbar('inactive_bom') +
      '<div class="wtb-h2">Неактивные в BOM · моделей ' + (d.models_count || 0) +
      ' · строк ' + (d.inactive_lines || 0) + '</div>';
    if (!models.length) html += '<div class="wtb-empty">Неактивных позиций в составах нет</div>';
    models.forEach(function (m) {
      var used = (m.used_in_contracts || []).map(function (c) { return (c.number || ('#' + c.contract_id)) + (c.status ? ' (' + c.status + ')' : ''); }).join(', ');
      var open = !!st.open['m:' + m.model_id] || /ЩУ-001-003|ЩУ-003-001/.test(m.article || '');
      html += '<div class="wtb-report' + (open ? ' open' : '') + '" data-wtb-open="m:' + m.model_id + '">' +
        '<div class="rh"><div><b>' + _esc(m.article || ('модель ' + m.model_id)) + '</b>' +
        ' · ' + _esc(m.name || '') +
        (used ? '<div class="meta2">в договорах: ' + _esc(used) : '<div class="meta2">в текущих договорах не используется') +
        '</div></div><span class="wtb-pill err">' + m.inactive_count + '</span></div><div class="rb">';
      (m.items || []).forEach(function (it) {
        html += '<div class="wtb-min-row"><div><b>' + _esc(it.name) + '</b>' +
          (it.sku ? '<div class="s">' + _esc(it.sku) + '</div>' : '') +
          '<div class="s">BOM #' + (it.bom_id || '—') + ' · компонент ' + it.component_id + '</div></div>' +
          (it.active_duplicate
            ? '<span class="wtb-dup">дубль #' + it.active_duplicate.component_id +
              (it.active_duplicate.sku ? ' · ' + _esc(it.active_duplicate.sku) : '') + '</span>'
            : '<span class="s">активный дубль не найден</span>') +
          '</div>';
      });
      html += '</div></div>';
    });
    html += '</div>';
    return html;
  }

  function render() {
    var html;
    if (st.view === 'landing') html = renderLanding();
    else if (st.view === 'suppliers') html = renderSuppliers();
    else if (st.view === 'list') html = renderList();
    else if (st.view === 'in_transit') html = renderTransit();
    else if (st.view === 'inactive_bom') html = renderInactiveBom();
    else html = renderContractOrProducts(st.view === 'contract' ? 'contract' : 'products');
    st.container.innerHTML = html;
    bind();
    refreshShippingClock();
  }


  function currentItems() {
    var payload = st.contractId ? st.tree : (st.tree || st.landing);
    return (payload && payload.items) || [];
  }
  function selectedLines() {
    var all = collectOrderable(currentItems());
    return all.filter(function (l) { return st.selected[l.key]; });
  }
  function orderBar(items) {
    var n = selectedLines().length;
    var can = collectOrderable(items).length;
    if (!can && !n) return '';
    return '<div class="wtb-orderbar' + (n ? ' on' : '') + '">' +
      (n ? '<strong>Выбрано ' + n + '</strong>' : '<span class="wtb-muted">Отметьте позиции, чтобы заказать</span>') +
      '<span class="sp"></span>' +
      (n ? '<button type="button" class="btn btn-secondary btn-small" data-wtb-clear>Снять</button>' : '') +
      '<button type="button" class="btn btn-primary btn-small" data-wtb-order-sel' + (n ? '' : ' disabled') +
      '>Заказать' + (n ? ' выбранные' : '') + '</button></div>';
  }
  function findLine(key) {
    return collectOrderable(currentItems()).filter(function (l) { return l.key === key; })[0];
  }
  function toggleLine(key, on) {
    if (on) st.selected[key] = 1;
    else delete st.selected[key];
  }
  function toggleGroup(id, on) {
    var row = currentItems().filter(function (r) { return (r.id || ('ci:' + r.contract_item_id)) === id; })[0];
    if (!row) return;
    collectOrderable([row]).forEach(function (l) { toggleLine(l.key, on); });
  }
  function closeWtbModal() {
    var m = document.getElementById('wtb-order-modal');
    if (m) m.remove();
  }
  function wtbModal(html) {
    closeWtbModal();
    var wrap = document.createElement('div');
    wrap.id = 'wtb-order-modal';
    wrap.className = 'wtb-modal-back';
    wrap.innerHTML = '<div class="wtb-modal" onclick="event.stopPropagation()">' + html + '</div>';
    wrap.addEventListener('click', function (e) { if (e.target === wrap) closeWtbModal(); });
    document.body.appendChild(wrap);
    return wrap;
  }
  function openOrderCard(id) {
    closeWtbModal();
    if (typeof openSupplyOrder === 'function') openSupplyOrder(Number(id));
    else if (typeof window.openSupplyOrder === 'function') window.openSupplyOrder(Number(id));
  }
  async function startOrder(lines) {
    if (!lines || !lines.length) return;
    var overrides = {};
    function items() {
      return lines.map(function (l) { return linePayload(l, overrides[l.key]); });
    }
    wtbModal('<div class="wtb-modal-h"><h3>Создать заказы поставщикам</h3>' +
      '<button type="button" class="modal-close" data-wtb-close><i class="ti ti-x"></i></button></div>' +
      '<div class="wtb-modal-b">Готовим черновики…</div>');
    var preview;
    try {
      var res = await apiPost('/api/supply/what-to-buy/drafts', { dry_run: true, items: items() });
      if (!res || !res.ok) throw new Error((res && res.data && (res.data.message || res.data.error)) || 'Не удалось подготовить заказ');
      preview = res.data;
    } catch (e) {
      wtbModal('<div class="wtb-modal-h"><h3>Не удалось подготовить заказ</h3>' +
        '<button type="button" class="modal-close" data-wtb-close><i class="ti ti-x"></i></button></div>' +
        '<div class="wtb-modal-b">' + _esc((e && e.message) || e) + '</div>' +
        '<div class="wtb-modal-f"><button type="button" data-wtb-close>Закрыть</button></div>');
      bindModal();
      return;
    }
    renderPreview(preview);

    function renderPreview(p) {
      var groups = p.groups || [];
      var total = p.items_count || lines.length;
      var will = p.orders_count || 0;
      var html = '<div class="wtb-modal-h"><h3>Создать заказы поставщикам</h3>' +
        '<button type="button" class="modal-close" data-wtb-close><i class="ti ti-x"></i></button></div>';
      html += '<div class="wtb-modal-lead">' + total + ' выбранных позици' + (total === 1 ? 'я' : 'й') +
        (st.tree && st.tree.contract ? ' договора ' + _esc(st.tree.contract.number || '') : '') +
        ' будут разобраны на ' + will + ' черновик' + (will === 1 ? '' : (will >= 2 && will <= 4 ? 'а' : 'ов')) +
        '. Поставщику ничего не отправится.</div><div class="wtb-modal-b">';
      groups.forEach(function (g, idx) {
        html += '<div class="wtb-og' + (g.missing_supplier ? ' miss' : '') + '"><div class="ogh">' +
          '<b>' + (idx + 1) + '. Поставщик</b>' +
          '<span class="wtb-pill ' + (g.missing_supplier ? 'err' : 'buy') + '">' + g.items_count + '</span>' +
          '<span class="sp"></span><span class="s">' + _esc(g.contract_number || '') + ' · Куда: договор</span></div>';
        html += '<div class="wtb-supfield"><div class="wtb-supval">' +
          _esc(g.missing_supplier ? 'Не назначен' : (g.supplier_name || ('Поставщик #' + g.supplier_id))) +
          '</div><button type="button" class="wtb-link" data-wtb-pick-sup="' + idx + '">' +
          (g.missing_supplier ? 'Выбрать поставщика' : 'Сменить') + '</button></div>';
        (g.items || []).forEach(function (it) {
          var alias = (it.supplier_alias || '').trim();
          html += '<div class="wtb-oline"><div><b>' + _esc(it.name) + '</b> ×' + fmt(it.qty) +
            (it.unit ? ' ' + _esc(it.unit) : '') +
            '<div class="s">изделие: ' + (it.position_no != null ? 'поз. ' + _esc(it.position_no) + ' ' : '') +
            _esc(it.product_name || '') + '</div>' +
            '<div class="wtb-alias' + (alias ? '' : ' miss') + '">' +
              '<div class="ours">наше имя: ' + _esc(it.name || '') + '</div>' +
              (alias
                ? '<div class="pr">в прайсе: ' + _esc(alias) + '</div>'
                : '<div class="pr">выберите строку прайса</div>') +
              (it.supplier_id
                ? '<button type="button" class="wtb-link" data-wtb-pick-price="' + _esc(it.key) + '">' +
                  (alias ? 'сменить строку прайса' : 'каталог') + '</button>'
                : '') +
            '</div></div><div class="wtb-oline-r"><span class="wtb-num-buy">докупить ' + fmt(it.qty) + '</span>' +
            '<button type="button" class="wtb-link" data-wtb-pick-line="' + _esc(it.key) + '">' +
            (it.supplier_id ? 'сменить' : 'выбрать поставщика') + '</button></div></div>';
        });
        html += '</div>';
      });
      html += '</div><div class="wtb-modal-f"><button type="button" data-wtb-close>Отмена</button>';
      if (p.can_create) {
        html += '<button type="button" class="btn btn-primary" data-wtb-create>+ Создать ' + will +
          ' черновик' + (will === 1 ? '' : (will >= 2 && will <= 4 ? 'а' : 'ов')) + '</button>';
      } else {
        html += '<button type="button" class="btn btn-primary" disabled>Сначала назначьте поставщика</button>';
      }
      html += '</div>';
      var wrap = document.getElementById('wtb-order-modal');
      if (wrap) wrap.querySelector('.wtb-modal').innerHTML = html;
      bindModal(p, groups);
    }

    function bindModal(p, groups) {
      var box = document.getElementById('wtb-order-modal');
      if (!box) return;
      box.querySelectorAll('[data-wtb-close]').forEach(function (b) {
        b.onclick = function () { closeWtbModal(); };
      });
      var createBtn = box.querySelector('[data-wtb-create]');
      if (createBtn) {
        createBtn.onclick = async function () {
          createBtn.disabled = true;
          createBtn.textContent = 'Создаём…';
          try {
            var resC = await apiPost('/api/supply/what-to-buy/drafts', { dry_run: false, items: items() });
            if (!resC || !resC.ok) throw new Error((resC && resC.data && (resC.data.message || resC.data.error)) || 'Не удалось создать черновики');
            var result = resC.data;
            showCreated(result);
            st.selected = {};
            await refreshCurrent();
          } catch (e) {
            createBtn.disabled = false;
            createBtn.textContent = 'Повторить';
            if (typeof showToast === 'function') showToast((e && e.message) || String(e), 'error');
          }
        };
      }
      box.querySelectorAll('[data-wtb-pick-sup]').forEach(function (b) {
        b.onclick = function () {
          var g = groups[Number(b.getAttribute('data-wtb-pick-sup'))];
          if (g) pickSupplier(g.items || [], g.supplier_id, g.missing_supplier
            ? 'Выбрать поставщика'
            : 'Сменить поставщика');
        };
      });
      box.querySelectorAll('[data-wtb-pick-price]').forEach(function (b) {
        b.onclick = function () {
          var key = b.getAttribute('data-wtb-pick-price');
          var item = null;
          (groups || []).forEach(function (g) {
            (g.items || []).forEach(function (it) { if (it.key === key) item = it; });
          });
          if (item) pickPriceLine(item, groups);
        };
      });
      box.querySelectorAll('[data-wtb-pick-line]').forEach(function (b) {
        b.onclick = function () {
          var key = b.getAttribute('data-wtb-pick-line');
          var item = null;
          (groups || []).forEach(function (g) {
            (g.items || []).forEach(function (it) { if (it.key === key) item = it; });
          });
          if (item) {
            pickSupplier([item], item.supplier_id, item.supplier_id
              ? 'Сменить поставщика для «' + item.name + '»'
              : 'Поставщик для «' + item.name + '»');
          }
        };
      });
    }


    async function pickPriceLine(item, groups) {
      if (!item || !item.supplier_id) {
        if (typeof showToast === 'function') showToast('Сначала выберите поставщика', 'error');
        return;
      }
      var data;
      try {
        data = await apiGet('/api/suppliers/' + item.supplier_id + '/price-items');
      } catch (e) {
        if (typeof showToast === 'function') showToast('Не удалось загрузить прайс поставщика', 'error');
        return;
      }
      var names = data.items || [];
      var detailed = data.detailed || names.map(function (n) { return { name: n, source: null }; });
      if (!detailed.length && names.length) {
        detailed = names.map(function (n) { return { name: n, source: null }; });
      }
      var current = (item.supplier_alias || '').trim();
      var supplierName = item.supplier_name;
      if (!supplierName) {
        (groups || []).forEach(function (g) {
          if (g.supplier_id && Number(g.supplier_id) === Number(item.supplier_id)) supplierName = g.supplier_name || supplierName;
        });
      }
      var html = '<div class="wtb-modal-h"><h3>Каталог: ' + _esc(supplierName || 'поставщик') + '</h3>' +
        '<button type="button" class="modal-close" data-wtb-close><i class="ti ti-x"></i></button></div>' +
        '<div class="wtb-modal-lead">Наше имя: <b>' + _esc(item.name || '') + '</b>. Выберите строку прайса поставщика. Цену система не подставляет.</div>' +
        '<div class="wtb-modal-b"><input type="search" class="wtb-search" id="wtb-price-q" placeholder="Поиск по прайсу…" autocomplete="off">' +
        '<div id="wtb-price-list" class="wtb-sup-list"></div></div>' +
        '<div class="wtb-modal-f"><button type="button" data-wtb-back-prev>Назад</button></div>';
      var wrap = document.getElementById('wtb-order-modal');
      wrap.querySelector('.wtb-modal').innerHTML = html;
      function draw() {
        var q = (document.getElementById('wtb-price-q').value || '').trim().toLowerCase();
        var list = detailed.filter(function (row) {
          var n = (row.name || row || '').toString();
          var src = (row.source || '').toString();
          return (n + ' ' + src).toLowerCase().indexOf(q) >= 0;
        });
        document.getElementById('wtb-price-list').innerHTML = list.map(function (row) {
          var n = (row.name || row || '').toString();
          var src = row.source || '';
          var on = current && n === current;
          return '<button type="button" class="wtb-supopt' + (on ? ' on' : '') + '" data-wtb-price-name="' + _esc(n) + '">' +
            '<span class="wtb-supopt-name">' + _esc(n) + '</span>' +
            (src ? '<span class="s">' + _esc(src) + '</span>' : '') +
            (on ? '<span class="wtb-supopt-check">✓</span>' : '') +
            '</button>';
        }).join('') || '<div class="wtb-empty">В прайсе этого поставщика нет строк</div>';
        document.querySelectorAll('[data-wtb-price-name]').forEach(function (el) {
          el.onclick = function () { choose(el.getAttribute('data-wtb-price-name')); };
        });
      }
      function choose(name) {
        if (!name) return;
        var prev = overrideOf(overrides[item.key]);
        overrides[item.key] = { supplier_id: prev.supplier_id || item.supplier_id, supplier_alias: name };
        lines.forEach(function (l) {
          if (l.key === item.key) l.supplier_alias = name;
        });
        apiPost('/api/supply/what-to-buy/drafts', { dry_run: true, items: items() }).then(function (res) {
          if (!res || !res.ok) throw new Error((res && res.data && (res.data.message || res.data.error)) || 'Не удалось обновить превью');
          renderPreview(res.data);
        }).catch(function (e) { if (typeof showToast === 'function') showToast((e && e.message) || String(e), 'error'); });
      }
      draw();
      document.getElementById('wtb-price-q').oninput = draw;
      setTimeout(function () {
        var s = document.getElementById('wtb-price-q');
        if (s) s.focus();
      }, 50);
      wrap.querySelectorAll('[data-wtb-close]').forEach(function (b) { b.onclick = closeWtbModal; });
      wrap.querySelector('[data-wtb-back-prev]').onclick = function () { renderPreview(p); };
    }

    async function pickSupplier(targetItems, currentId, title) {
      var data;
      try { data = await apiGet('/api/suppliers'); } catch (e) {
        if (typeof showToast === 'function') showToast('Не удалось загрузить поставщиков', 'error');
        return;
      }
      var suppliers = (data.suppliers || data.items || []).filter(function (s) {
        return s.is_active !== false && s.is_active !== 0;
      });
      var current = currentId != null && currentId !== '' ? Number(currentId) : null;
      var choice = current;
      var html = '<div class="wtb-modal-h"><h3>' + _esc(title || 'Выбрать поставщика') + '</h3>' +
        '<button type="button" class="modal-close" data-wtb-close><i class="ti ti-x"></i></button></div>' +
        '<div class="wtb-modal-lead">Поиск по справочнику поставщиков. Разбивка черновиков пойдёт по выбранному.</div>' +
        '<div class="wtb-modal-b"><input type="search" class="wtb-search" id="wtb-sup-q" placeholder="Найти поставщика по названию или ИНН" autocomplete="off">' +
        '<div id="wtb-sup-list" class="wtb-sup-list"></div></div>' +
        '<div class="wtb-modal-f"><button type="button" data-wtb-back-prev>Назад</button>' +
        '<button type="button" class="btn btn-primary" id="wtb-sup-save"' + (choice ? '' : ' disabled') + '>Назначить</button></div>';
      var wrap = document.getElementById('wtb-order-modal');
      wrap.querySelector('.wtb-modal').innerHTML = html;
      function applyChoice(id) {
        choice = Number(id);
        var save = document.getElementById('wtb-sup-save');
        if (save) save.disabled = !choice;
        draw();
      }
      function draw() {
        var q = (document.getElementById('wtb-sup-q').value || '').trim().toLowerCase();
        var list = suppliers.filter(function (s) {
          return ((s.name || '') + ' ' + (s.inn || '')).toLowerCase().indexOf(q) >= 0;
        });
        document.getElementById('wtb-sup-list').innerHTML = list.map(function (s) {
          var on = Number(s.id) === Number(choice);
          return '<button type="button" class="wtb-supopt' + (on ? ' on' : '') + '" data-wtb-sup-id="' + s.id + '">' +
            '<span class="wtb-supopt-name">' + _esc(s.name || '—') + '</span><span class="s">Карточка #' + s.id + '</span>' +
            (s.inn ? '<span class="s">ИНН ' + _esc(s.inn) + '</span>' : '') +
            (on ? '<span class="wtb-supopt-check">✓</span>' : '') +
            '</button>';
        }).join('') || '<div class="wtb-empty">Поставщики не найдены</div>';
        document.querySelectorAll('[data-wtb-sup-id]').forEach(function (el) {
          el.onclick = function () { applyChoice(el.getAttribute('data-wtb-sup-id')); };
        });
      }
      draw();
      document.getElementById('wtb-sup-q').oninput = draw;
      setTimeout(function () {
        var s = document.getElementById('wtb-sup-q');
        if (s) s.focus();
      }, 50);
      wrap.querySelectorAll('[data-wtb-close]').forEach(function (b) { b.onclick = closeWtbModal; });
      wrap.querySelector('[data-wtb-back-prev]').onclick = function () { renderPreview(p); };
      document.getElementById('wtb-sup-save').onclick = function () {
        if (!choice) return;
        var rec = suppliers.filter(function (s) { return Number(s.id) === Number(choice); })[0] || {};
        var name = rec.name || '';
        (targetItems || []).forEach(function (it) {
          var prev = overrideOf(overrides[it.key]);
          overrides[it.key] = { supplier_id: choice };
          // смена поставщика — алиас от другой пары (позиция, поставщик) не переносим
        });
        lines.forEach(function (l) {
          if ((targetItems || []).some(function (it) { return it.key === l.key; })) {
            l.supplier_id = choice;
            l.supplier_name = name;
            l.supplier_alias = '';
          }
        });
        apiPost('/api/supply/what-to-buy/drafts', { dry_run: true, items: items() }).then(function (res) {
          if (!res || !res.ok) throw new Error((res && res.data && (res.data.message || res.data.error)) || 'Не удалось обновить превью');
          renderPreview(res.data);
        }).catch(function (e) { if (typeof showToast === 'function') showToast((e && e.message) || String(e), 'error'); });
      };
    }

    function showCreated(result) {
      var orders = result.orders || [];
      var html = '<div class="wtb-modal-h"><h3>Черновики созданы</h3>' +
        '<button type="button" class="modal-close" data-wtb-close><i class="ti ti-x"></i></button></div>' +
        '<div class="wtb-modal-lead">Поставщику ничего не отправлялось. Письмо и перевод дальше — из карточки заказа.</div>' +
        '<div class="wtb-modal-b">';
      orders.forEach(function (o) {
        html += '<button type="button" class="wtb-created" data-open-ord="' + o.id + '">' +
          _esc(o.order_label) + ' · ' + _esc(o.supplier_name || '') + ' · ' + o.items_count +
          ' позиц. · ' + _esc(o.contract_number || '') + '</button>';
      });
      html += '</div><div class="wtb-modal-f"><button type="button" data-wtb-close>Закрыть</button></div>';
      var wrap = document.getElementById('wtb-order-modal');
      wrap.querySelector('.wtb-modal').innerHTML = html;
      wrap.querySelectorAll('[data-wtb-close]').forEach(function (b) { b.onclick = closeWtbModal; });
      wrap.querySelectorAll('[data-open-ord]').forEach(function (b) {
        b.onclick = function () { openOrderCard(b.getAttribute('data-open-ord')); };
      });
    }
  }

  function bind() {
    var root = st.container.querySelector('.wtb-root');
    if (!root) return;
    root.addEventListener('click', function (e) {
      if (handleProcurementClick(e)) return;
      var viewBtn = e.target.closest('[data-wtb-view]');
      if (viewBtn) { e.preventDefault(); setView(viewBtn.getAttribute('data-wtb-view')).catch(actionError); return; }
      var cbtn = e.target.closest('[data-wtb-contract]');
      if (cbtn) { e.preventDefault(); openContract(Number(cbtn.getAttribute('data-wtb-contract'))).catch(actionError); return; }
      var legacy = e.target.closest('[data-wtb-legacy]');
      if (legacy) {
        e.preventDefault();
        localStorage.setItem(LS, '0');
        if (typeof loadSupplyShopping === 'function') loadSupplyShopping();
        return;
      }
      if (e.target.closest('.wtb-check') || e.target.closest('.wtb-order-btn') || e.target.closest('.wtb-orderbar')) {
        return;
      }
      var open = e.target.closest('[data-wtb-open]');
      if (open && (e.target.closest('.wtb-ch') || e.target.closest('.rh'))) {
        var id = open.getAttribute('data-wtb-open');
        st.open[id] = !open.classList.contains('open');
        open.classList.toggle('open', st.open[id]);
        var heading = open.querySelector('.wtb-heading-toggle');
        if (heading) heading.setAttribute('aria-expanded', String(st.open[id]));
      }
    });
    root.querySelectorAll('[data-wtb-line]').forEach(function (el) {
      el.addEventListener('change', function () {
        toggleLine(el.getAttribute('data-wtb-line'), el.checked);
        render();
      });
    });
    root.querySelectorAll('[data-wtb-line-group]').forEach(function (el) {
      if (el.getAttribute('data-indeterminate') === '1') el.indeterminate = true;
      el.addEventListener('change', function () {
        toggleGroup(el.getAttribute('data-wtb-line-group'), el.checked);
        render();
      });
    });
    var orderSel = root.querySelector('[data-wtb-order-sel]');
    if (orderSel) orderSel.addEventListener('click', function () { startOrder(selectedLines()); });
    var clearBtn = root.querySelector('[data-wtb-clear]');
    if (clearBtn) clearBtn.addEventListener('click', function () { st.selected = {}; render(); });
    root.querySelectorAll('[data-wtb-order-one]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var line = findLine(btn.getAttribute('data-wtb-order-one'));
        if (line) startOrder([line]);
      });
    });
    root.querySelectorAll('[data-wtb-order-group]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-wtb-order-group');
        var row = currentItems().filter(function (r) { return (r.id || ('ci:' + r.contract_item_id)) === id; })[0];
        if (row) startOrder(collectOrderable([row]));
      });
    });
    var search = root.querySelector('[data-wtb-search]');
    if (search) {
      search.addEventListener('input', function () {
        st.q = search.value || '';
        render();
        var again = st.container.querySelector('[data-wtb-search]');
        if (again) { again.focus(); again.setSelectionRange(st.q.length, st.q.length); }
      });
    }
    var drafts = root.querySelector('[data-wtb-drafts]');
    if (drafts) {
      drafts.addEventListener('change', function () {
        st.includeDrafts = !!drafts.checked;
        setView('in_transit').catch(actionError);
      });
    }
  }

  function positionText(n) {
    var a = Math.abs(n) % 100, b = a % 10;
    return n + ' ' + (a > 10 && a < 20 ? 'позиций' : b === 1 ? 'позиция' : b > 1 && b < 5 ? 'позиции' : 'позиций');
  }

  function productName(row) {
    var name = row.name || row.model_article || 'Позиция договора';
    var article = String(row.model_article || '').toLowerCase().replace(/[\s._-]/g, '');
    var split = name.lastIndexOf(' · ');
    if (article && split > 0 &&
        name.slice(split + 3).toLowerCase().replace(/[\s._-]/g, '') === article &&
        name.slice(0, split).toLowerCase().replace(/[\s._-]/g, '').includes(article)) {
      name = name.slice(0, split);
    }
    return /^(ЩУ|ШУ)/i.test(row.model_article || name) && !/щит/i.test(name) ? 'Щит управления ' + name : name;
  }

  function summaryOf(items) {
    var out = { lines: 0, stock_lines: 0, in_transit_lines: 0, to_buy_lines: 0, unreserved_lines: 0, production_allocated_products: 0 };
    (items || []).forEach(function (r) {
      if (Number(r.production_allocated_qty) > 0) out.production_allocated_products++;
      (r.children && r.children.length ? r.children : [{ stock_allocated: r.stock_qty, in_transit_allocated: r.in_transit_qty, to_buy: r.to_buy_qty }]).forEach(function (c) {
        out.lines++;
        if (Number(c.stock_allocated) > 0) out.stock_lines++;
        if (Number(c.in_transit_allocated) > 0) out.in_transit_lines++;
        if (Number(c.to_buy) > 0) out.to_buy_lines++;
        if (Number(c.stock_available_to_reserve) > 0) out.unreserved_lines++;
      });
    });
    return out;
  }

  function lineMatchesFilter(c) {
    return st.componentFilter === 'all' ||
      st.componentFilter === 'stock' && Number(c.stock_allocated || c.stock_qty) > 0 ||
      st.componentFilter === 'transit' && Number(c.in_transit_allocated || c.in_transit_qty) > 0 ||
      st.componentFilter === 'buy' && Number(c.to_buy != null ? c.to_buy : c.to_buy_qty) > 0;
  }

  function visibleChildren(row) {
    var productMatches = matchQ([row.name, row.model_article].join(' '));
    return (row.children || []).filter(function (c) {
      return lineMatchesFilter(c) && (productMatches || matchQ(c.name + ' ' + (c.sku || '')));
    });
  }

  function lineStatus(row, ch) {
    if (row.historical) return 'Отправлено';
    if (ch.inactive || ch.status === 'inactive_bom') return 'Ошибка состава';
    if (Number(ch.to_buy) > 0) return 'Нужно купить';
    if (Number(ch.in_transit_allocated) > 0) return 'Заказано · в пути';
    if (Number(ch.stock_available_to_reserve) > 0 || ch.in_stock_not_reserved) return 'Есть на складе';
    if (Number(ch.reserved_qty) > 0 || ch.status === 'reserved') return 'Зарезервировано';
    if (Number(row.production_allocated_qty) > 0 && Number(ch.need) === 0) return 'Учтено в изделии';
    if (Number(ch.need) === 0) return 'Сейчас не требуется';
    return 'Проверить данные';
  }

  function summaryCards(summary) {
    return '<div class="wtb-summary">' + [
      ['stock', 'Есть на складе', summary.stock_lines, 'ti-building-warehouse'],
      ['transit', 'Заказано / в пути', summary.in_transit_lines, 'ti-truck'],
      ['buy', 'Нужно купить', summary.to_buy_lines, 'ti-shopping-cart']
    ].map(function (v) {
      var neutral = v[0] === 'buy' && !Number(v[2]) ? ' wtb-zero' : '';
      return '<button type="button" class="wtb-summary-card ' + v[0] + neutral + (st.componentFilter === v[0] ? ' on' : '') +
        '" data-wtb-filter="' + v[0] + '" aria-pressed="' + (st.componentFilter === v[0]) + '"><span class="label"><i class="ti ' + v[3] + '"></i>' + v[1] +
        '</span><strong>' + Number(v[2] || 0) + '</strong><small>позиций</small></button>';
    }).join('') + '</div>';
  }

  function componentTable(row, children, inBundle) {
    return '<table class="wtb-comp"><thead><tr><th></th><th>Комплектующее</th><th>Нужно</th><th>На складе</th><th>В пути</th><th>Купить</th><th>Действие</th></tr></thead><tbody>' + children.map(function (c) { return childRow(row, c, inBundle); }).join('') + '</tbody></table>';
  }

  function productComponents(row) {
    var children = visibleChildren(row), grouped = {}, byNode = {};
    children.forEach(function (c) {
      if (c.body_bundle_id) (grouped[c.body_bundle_id] = grouped[c.body_bundle_id] || []).push(c);
      else (byNode[c.bom_node || ''] = byNode[c.bom_node || ''] || []).push(c);
    });
    function renderNode(key) {
      var parts = byNode[key] || [];
      var html = parts.length ? componentTable(row, parts, false) : '';
      (row.bom_nodes || []).filter(function (n) { return n.parent === key; }).forEach(function (n) {
        var inner = renderNode(n.key);
        if (!inner && st.componentFilter !== 'all') return;
        var missing = Math.max(0, Number(n.need) - Number(n.on_stock));
        var info = n.need > 0 ? ('На складе ' + fmt(n.on_stock) + ' из ' + fmt(n.need) + ' шт.' +
          (missing > 0 ? ' · собрать ' + fmt(missing) + ' шт.' : '')) : '';
        html += '<details class="wtb-bom-node"><summary><strong>' + _esc(n.name || n.article) + '</strong>' +
          (info ? '<span>' + info + '</span>' : '') + '</summary>' +
          (inner || '<div class="wtb-empty">Состав узла не указан</div>') + '</details>';
      });
      return html;
    }
    var html = renderNode('');
    Object.keys(grouped).forEach(function (id) {
      var bundle = grouped[id][0].body_bundle, members = (row.children || []).filter(function (c) { return Number(c.body_bundle_id) === Number(id); });
      var buy = members.filter(function (c) { return Number(c.to_buy) > 0; }).length;
      html += '<div class="wtb-body-bundle"><details><summary><i class="ti ti-box"></i><strong>Корпус ' + _esc(bundle.designation || bundle.name) + ' — ' + _esc(bundle.supplier_name || 'УТМ') +
        '</strong><span>' + positionText(members.length) + (buy ? ' · купить ' + buy + ' поз.' : '') + '</span></summary>' + componentTable(row, members, true) + '</details><div class="wtb-bundle-actions">';
      if (members.some(function (c) { return toOrder(c) > 0; })) html += '<button type="button" class="wtb-order-btn" data-wtb-order-bundle="' + row.contract_item_id + ':' + id + '">Заказать корпус</button>';
      if (members.some(function (c) { return recordedLine(row, c); })) html += '<button type="button" class="wtb-order-btn wtb-manual-btn" data-wtb-record-bundle="' + row.contract_item_id + ':' + id + '">Уже заказали</button>';
      html += '<button type="button" class="wtb-link" data-wtb-mfg="' + id + '">Чертежи корпуса' + ((bundle.files || []).length ? ' · ' + bundle.files.length : '') + '</button></div></div>';
    });
    return html;
  }

  function recordedLine(row, child) {
    var buy = Number(child ? child.to_buy : row.to_buy_qty) || 0;
    var incoming = Number(child && child.in_transit_without_item) || 0;
    if (buy + incoming <= 0) return null;
    return Object.assign(orderableLine(row, child), {
      qty: buy,
      invoiceQty: Number((buy + incoming).toFixed(6))
    });
  }

  function manualLines(items) {
    return (items || []).flatMap(function (row) {
      return (row.children && row.children.length ? row.children : [null])
        .map(function (child) { return recordedLine(row, child); }).filter(Boolean);
    });
  }

  function aggregatePurchases(items) {
    var groups = {};
    (items || []).forEach(function (r) {
      var children = r.children && r.children.length ? r.children : [null];
      children.forEach(function (c) {
        var line = orderableLine(r, c), bundle = c && c.body_bundle;
        var key = bundle ? 'body:' + bundle.id : c && c.component_id ? 'component:' + c.component_id + ':' + (c.unit || '') : 'item:' + r.contract_item_id;
        var group = groups[key] || (groups[key] = { key: key, name: bundle ? 'Корпус ' + (bundle.designation || bundle.name) + ' — ' + (bundle.supplier_name || 'УТМ') : line.name,
          unit: bundle ? 'поз.' : line.unit, bundle: bundle || null, need: 0, stock: 0, incoming: 0, buy: 0, refs: [], orderable: [], manual: [] });
        var need = Number(c ? c.need : r.direct_need || r.qty) || 0, stock = Number(c ? c.stock_allocated : r.stock_qty) || 0;
        var incoming = Number(c ? c.in_transit_allocated : r.in_transit_qty) || 0, buy = Number(c ? c.to_buy : r.to_buy_qty) || 0;
        group.need += bundle ? 1 : need; group.stock += bundle ? Number(stock > 0) : stock;
        group.incoming += bundle ? Number(incoming > 0) : incoming; group.buy += bundle ? Number(buy > 0) : buy;
        group.refs.push({ row: r, child: c, line: line, buy: buy });
        if (line.qty > 0) group.orderable.push(line);
        var recorded = recordedLine(r, c);
        if (recorded) group.manual.push(recorded);
      });
    });
    return Object.keys(groups).map(function (k) { return groups[k]; }).filter(function (g) { return g.buy > 0 && matchQ(g.name + ' ' + g.refs.map(function (r) { return r.row.name + ' ' + r.row.contract_number; }).join(' ')); });
  }

  function actionError(error) {
    var message = (error && error.message) || String(error);
    if (typeof showToast === 'function') showToast(message, 'error');
    else if (st.container) st.container.insertAdjacentHTML('afterbegin', '<div class="wtb-action-error" role="alert">' + _esc(message) + '</div>');
  }

  async function refreshCurrent() {
    st.landing = await wtbGet();
    if (st.contractId) st.tree = await wtbGet({ contract_id: st.contractId });
    else if (st.view === 'list' || st.view === 'products' || st.view === 'suppliers') st.tree = await wtbGet({ view: 'products' });
    render();
  }

  function successfulPost(response) {
    if (!response || !response.ok) throw new Error((response && response.data && (response.data.message || response.data.error)) || 'Не удалось выполнить действие');
    return response.data;
  }

  function modalCloseButtons(box) {
    box.querySelectorAll('[data-wtb-close]').forEach(function (b) { b.onclick = closeWtbModal; });
  }

  function bundleLines(value, manual) {
    var parts = String(value || '').split(':'), row = currentItems().find(function (r) { return Number(r.contract_item_id) === Number(parts[0]); });
    if (!row) return [];
    var children = (row.children || []).filter(function (c) { return Number(c.body_bundle_id) === Number(parts[1]); });
    var clone = Object.assign({}, row, { children: children });
    return manual ? manualLines([clone]) : collectOrderable([clone]);
  }

  function handleProcurementClick(e) {
    var b = e.target.closest('[data-wtb-filter],[data-wtb-destination],[data-wtb-record-one],[data-wtb-record-group],[data-wtb-record-bundle],[data-wtb-order-bundle],[data-wtb-record-aggregate],[data-wtb-order-aggregate],[data-wtb-reserve],[data-wtb-mfg]');
    if (!b) return false;
    e.preventDefault(); e.stopPropagation();
    if (b.hasAttribute('data-wtb-filter')) {
      st.componentFilter = b.getAttribute('data-wtb-filter');
      currentItems().forEach(function (r) { if (visibleChildren(r).length) st.open[r.id || ('ci:' + r.contract_item_id)] = true; });
      render(); return true;
    }
    if (b.hasAttribute('data-wtb-destination')) {
      var dest = b.getAttribute('data-wtb-destination').split(':');
      openContract(Number(dest[0]), Number(dest[1])).catch(actionError); return true;
    }
    if (b.hasAttribute('data-wtb-mfg')) {
      if (typeof openMfgItem === 'function') openMfgItem(Number(b.getAttribute('data-wtb-mfg')));
      return true;
    }
    if (b.hasAttribute('data-wtb-reserve')) {
      var iid = Number(b.getAttribute('data-wtb-reserve'));
      var row = currentItems().find(function (r) { return Number(r.contract_item_id) === iid; });
      if (row) startReserve(row, Number(b.getAttribute('data-component')) || null).catch(actionError);
      return true;
    }
    var lines = [], ordering = false;
    if (b.hasAttribute('data-wtb-record-one')) lines = manualLines(currentItems()).filter(function (l) { return l.key === b.getAttribute('data-wtb-record-one'); });
    if (b.hasAttribute('data-wtb-record-group')) {
      var group = currentItems().filter(function (r) { return (r.id || ('ci:' + r.contract_item_id)) === b.getAttribute('data-wtb-record-group'); });
      lines = manualLines(group);
    }
    if (b.hasAttribute('data-wtb-record-bundle')) lines = bundleLines(b.getAttribute('data-wtb-record-bundle'), true);
    if (b.hasAttribute('data-wtb-order-bundle')) { lines = bundleLines(b.getAttribute('data-wtb-order-bundle'), false); ordering = true; }
    if (b.hasAttribute('data-wtb-record-aggregate') || b.hasAttribute('data-wtb-order-aggregate')) {
      var key = b.getAttribute('data-wtb-record-aggregate') || b.getAttribute('data-wtb-order-aggregate');
      var aggregate = aggregatePurchases(currentItems()).find(function (g) { return g.key === key; });
      ordering = b.hasAttribute('data-wtb-order-aggregate');
      if (aggregate) lines = ordering ? aggregate.orderable : aggregate.manual;
    }
    if (lines.length) (ordering ? startOrder(lines) : startRecorded(lines)).catch(actionError);
    return true;
  }

  async function startReserve(row, componentId) {
    var body = { dry_run: true, contract_id: row.contract_id, contract_item_id: row.contract_item_id };
    if (componentId) body.component_id = componentId;
    var preview = successfulPost(await apiPost('/api/supply/what-to-buy/reserve', body));
    var html = '<div class="wtb-modal-h"><h3>Резерв под изделие</h3><button type="button" class="modal-close" data-wtb-close aria-label="Закрыть"><i class="ti ti-x"></i></button></div>' +
      '<div class="wtb-modal-lead">' + _esc(productName(row)) + ' · договор ' + _esc(row.contract_number) + '</div><div class="wtb-modal-b">';
    (preview.items || []).forEach(function (item) { html += '<div class="wtb-min-row"><b>' + _esc(item.name) + '</b><span>' + fmt(item.qty) + ' ' + unit(item.unit) + '</span></div>'; });
    if (!preview.items_count) html += '<div class="wtb-empty">Всё доступное уже закреплено. Новый резерв не требуется.</div>';
    html += '<div class="wtb-action-error" role="alert" data-reserve-error hidden></div></div><div class="wtb-modal-f"><button type="button" data-wtb-close>Отмена</button>' +
      (preview.items_count ? '<button type="button" class="btn btn-primary" data-confirm-reserve>Зарезервировать</button>' : '') + '</div>';
    var box = wtbModal(html); modalCloseButtons(box);
    var confirm = box.querySelector('[data-confirm-reserve]');
    if (confirm) confirm.onclick = async function () {
      confirm.disabled = true;
      try {
        var result = successfulPost(await apiPost('/api/supply/what-to-buy/reserve', Object.assign({}, body, { dry_run: false })));
        closeWtbModal(); await refreshCurrent();
        if (typeof showToast === 'function') showToast('Закреплено со склада: ' + positionText(result.items_count), 'success');
      } catch (error) { confirm.disabled = false; var warning = box.querySelector('[data-reserve-error]'); warning.hidden = false; warning.textContent = error.message; }
    };
  }

  function invoiceDate(value) {
    var date = String(value || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.split('-').reverse().join('.') : (date || 'Без даты');
  }

  function invoiceName(invoice) {
    return invoice.invoice_number ? 'Счёт № ' + invoice.invoice_number : (invoice.order_label || 'Счёт');
  }

  function invoiceBadge(invoice) {
    return '<span class="wtb-pill ' + (invoice.paid ? 'ok">Оплачен' : 'wait">' + _esc(orderStatusRu(invoice.status)) ) + '</span>';
  }

  function openInvoicePicker(box, currentId, onPick) {
    var modal = box.querySelector('.wtb-modal');
    var original = Array.from(modal.children);
    original.forEach(function (el) { el.hidden = true; });
    var panel = document.createElement('div');
    panel.className = 'wtb-invoice-picker';
    modal.classList.add('wtb-wide-modal');
    modal.appendChild(panel);
    panel.innerHTML = '<div class="wtb-modal-h"><h3>Выбрать счёт поставщика</h3><button type="button" class="wtb-picker-close" data-picker-back aria-label="Назад">×</button></div>' +
      '<div class="wtb-modal-b"><div class="wtb-invoice-filters"><label class="wtb-field">Поиск по номеру, поставщику или ИНН<input type="search" data-picker-query autocomplete="off"></label>' +
      '<label class="wtb-field">Дата счёта<input type="date" data-picker-date></label></div>' +
      '<label class="wtb-paid-field"><input type="checkbox" data-picker-paid>Только оплаченные</label>' +
      '<div class="wtb-invoice-grid"><div class="wtb-sup-list" data-picker-results aria-live="polite"></div><div class="wtb-invoice-details" data-picker-details>Выберите счёт, чтобы открыть позиции</div></div></div>' +
      '<div class="wtb-modal-f"><button type="button" data-picker-back>К заказу</button><button type="button" class="btn btn-primary" data-picker-confirm disabled>Выбрать счёт</button></div>';
    var query = panel.querySelector('[data-picker-query]'), date = panel.querySelector('[data-picker-date]');
    var paid = panel.querySelector('[data-picker-paid]'), results = panel.querySelector('[data-picker-results]');
    var details = panel.querySelector('[data-picker-details]'), confirm = panel.querySelector('[data-picker-confirm]');
    var chosen = null, choiceId = currentId, seq = 0, detailSeq = 0, timer, visible = [];
    function back() {
      clearTimeout(timer);
      panel.remove();
      modal.classList.remove('wtb-wide-modal');
      original.forEach(function (el) { el.hidden = false; });
      box.querySelector('[data-open-invoice-picker]').focus();
    }
    panel.querySelectorAll('[data-picker-back]').forEach(function (btn) { btn.onclick = back; });
    function renderRows(more) {
      results.innerHTML = visible.map(function (invoice) {
        var on = invoice.id === choiceId;
        return '<button type="button" class="wtb-supopt' + (on ? ' on' : '') + '" data-picker-id="' + Number(invoice.id) + '" aria-pressed="' + on + '">' +
          '<span class="wtb-invoice-result"><b>' + _esc(invoiceName(invoice)) + '</b><small>' + _esc(invoiceDate(invoice.invoice_date)) +
          ' · ' + _esc(invoice.supplier_name) + '</small></span>' + invoiceBadge(invoice) + '</button>';
      }).join('') || '<div class="wtb-empty">Счета не найдены</div>';
      if (more) results.insertAdjacentHTML('beforeend', '<div class="wtb-empty">Уточните запрос, чтобы увидеть остальные счета</div>');
    }
    async function openDetails(id) {
      var request = ++detailSeq;
      choiceId = id; chosen = null; confirm.disabled = true;
      details.textContent = 'Загрузка позиций…';
      try {
        var data = await apiGet('/api/supply/what-to-buy/invoices?id=' + Number(id));
        if (request !== detailSeq || !panel.isConnected) return;
        if (!data || !data.invoice) throw new Error('Счёт не найден');
        chosen = Object.assign({}, data.invoice, {
          availableItems: (data.items || []).filter(function (item) { return item.id && item.available; })
        });
        var items = (data.items || []).map(function (item) {
          return '<div class="wtb-invoice-item"><span>' + _esc(item.name) + '</span><b>' +
            (item.qty == null ? 'Количество не указано' : fmt(item.qty) + ' ' + unit(item.unit)) + '</b></div>';
        }).join('');
        details.innerHTML = '<div class="wtb-invoice-detail-head"><b>' + _esc(invoiceName(chosen)) + '</b>' + invoiceBadge(chosen) + '</div>' +
          '<div>' + _esc(chosen.supplier_name) + ' · ' + _esc(invoiceDate(chosen.invoice_date)) + '</div>' +
          '<h4>Позиции счёта</h4>' + (items || 'Позиции в заказе ещё не заведены');
        confirm.disabled = data.can_link === false || !items;
        if (confirm.disabled && typeof openSupplyOrder === 'function') {
          details.insertAdjacentHTML('beforeend', '<p>Свободных подтверждённых позиций нет.</p><button type="button" data-picker-open-order class="wtb-link">Открыть карточку закупки</button>');
          details.querySelector('[data-picker-open-order]').onclick = function () { closeWtbModal(); openSupplyOrder(id); };
        }
      } catch (error) {
        if (request === detailSeq && panel.isConnected) details.textContent = error.message || 'Не удалось открыть счёт';
      }
    }
    async function search() {
      var request = ++seq;
      var params = new URLSearchParams({ q: query.value, date: date.value, paid: paid.checked ? '1' : '' });
      results.textContent = 'Поиск…';
      try {
        var data = await apiGet('/api/supply/what-to-buy/invoices?' + params);
        if (request !== seq || !panel.isConnected) return;
        visible = data.invoices || [];
        if (choiceId && !visible.some(function (invoice) { return invoice.id === choiceId; })) {
          ++detailSeq; choiceId = null; chosen = null; confirm.disabled = true;
          details.textContent = 'Выберите счёт, чтобы открыть позиции';
        }
        renderRows(data.has_more);
        if (choiceId && !chosen) openDetails(choiceId);
        results.onclick = function (event) {
          var row = event.target.closest('[data-picker-id]');
          if (!row) return;
          results.querySelectorAll('[data-picker-id]').forEach(function (el) {
            el.classList.toggle('on', el === row);
            el.setAttribute('aria-pressed', String(el === row));
          });
          openDetails(Number(row.getAttribute('data-picker-id')));
        };
      } catch (error) {
        if (request === seq && panel.isConnected) results.textContent = error.message || 'Не удалось загрузить счета';
      }
    }
    query.oninput = function () {
      ++seq;
      clearTimeout(timer);
      timer = setTimeout(search, 220);
    };
    date.onchange = paid.onchange = function () { clearTimeout(timer); search(); };
    confirm.onclick = function () { if (chosen) { var invoice = chosen; back(); onPick(invoice); } };
    search();
    query.focus();
  }

  async function startRecorded(lines) {
    var directory = await apiGet('/api/suppliers');
    var suppliers = (directory.suppliers || directory.items || []).filter(function (s) { return s.is_active !== false && s.is_active !== 0; });
    var ids = Array.from(new Set(lines.map(function (l) { return l.supplier_id; }).filter(Boolean)));
    var initial = ids.length === 1 ? Number(ids[0]) : null;
    var requestId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'wtb-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    var html = '<div class="wtb-modal-h"><h3>Уже заказали</h3><button type="button" class="wtb-picker-close" data-wtb-close aria-label="Закрыть">×</button></div>' +
      '<div class="wtb-modal-lead">Учесть размещённый заказ. Количество появится в «В пути». Письма не отправляются.</div><form data-wtb-manual-form><div class="wtb-modal-b">' +
      '<div class="wtb-invoice-choice"><button type="button" class="wtb-small-btn" data-open-invoice-picker>Найти счёт в CRM</button><button type="button" class="wtb-link" data-clear-invoice hidden>Ввести вручную</button><div data-chosen-invoice></div></div>' +
      '<div data-supplier-fields><label class="wtb-field">Поставщик<input type="search" data-manual-supplier-search placeholder="Название или ИНН" autocomplete="off"></label>' +
      '<select data-manual-supplier aria-label="Выбрать поставщика" required></select></div><div class="wtb-manual-lines">';
    lines.forEach(function (l, index) {
      var source = l.direct_purchase ? '<label class="wtb-field wtb-invoice-source" hidden>Позиция счёта<select data-invoice-source="' + index + '"></select></label>' : '';
      html += '<div class="wtb-manual-line"><label data-include-invoice hidden><input type="checkbox" data-invoice-line="' + index + '" aria-label="Учесть ' + _esc(l.name) + '" checked></label><span class="wtb-manual-line-name"><b>' + _esc(l.name) + '</b><small>' + _esc(l.contract_number || '') + ' → ' + _esc(l.product_name || '') + '</small>' + source + '</span><span class="wtb-quantity-field"><input type="number" data-manual-qty="' + index + '" min="0.001" max="' + l.qty + '" step="any" value="' + l.qty + '" aria-label="Количество: ' + _esc(l.name) + '" required><small>' + unit(l.unit) + '</small></span></div>';
    });
    html += '</div><div class="wtb-manual-fields"><label class="wtb-field" data-manual-only>Номер счёта · необязательно<input type="text" maxlength="200" data-manual-invoice></label>' +
      '<label class="wtb-field">Ожидаемая поставка<input type="date" data-manual-date></label></div><label class="wtb-paid-field" data-manual-only><input type="checkbox" data-manual-paid>Счёт уже оплачен</label>' +
      '<div data-manual-existing></div><div class="wtb-invoice-replacement" data-invoice-replacement aria-live="polite" hidden></div>' +
      '<div class="wtb-action-error" data-manual-error role="alert" hidden></div></div><div class="wtb-modal-f"><button type="button" data-wtb-close>Отмена</button><button type="submit" class="btn btn-primary" data-manual-submit disabled>Учесть заказ</button></div></form>';
    var box = wtbModal(html); modalCloseButtons(box);
    var form = box.querySelector('[data-wtb-manual-form]'), submit = box.querySelector('[data-manual-submit]'), warning = box.querySelector('[data-manual-error]');
    var changeNotice = box.querySelector('[data-invoice-replacement]');
    var timer = null, sequence = 0, submitting = false, invoice = null, manualDate = '', confirmation = null;
    var supplier = box.querySelector('[data-manual-supplier]');
    var supplierQuery = box.querySelector('[data-manual-supplier-search]');
    function filterSuppliers(value) {
      var terms = supplierQuery.value.trim().toLowerCase().split(/\s+/);
      var matches = suppliers.filter(function (s) {
        var label = ((s.name || '') + ' ' + (s.inn || '')).toLowerCase();
        return Number(s.id) === Number(value) || terms.every(function (term) { return label.includes(term); });
      });
      supplier.innerHTML = '<option value="">Выберите из справочника</option>' + matches.map(function (s) {
        return '<option value="' + Number(s.id) + '">' + _esc(s.name) + (s.inn ? ' · ИНН ' + _esc(s.inn) : '') + ' · #' + Number(s.id) + '</option>';
      }).join('');
      supplier.value = value || '';
    }
    filterSuppliers(initial);
    supplierQuery.oninput = function () { filterSuppliers(supplier.value); };
    var canManual = lines.some(function (line) { return line.qty > 0; });
    function setInvoice(value) {
      var dateInput = box.querySelector('[data-manual-date]');
      if (!invoice) manualDate = dateInput.value;
      invoice = value;
      box.querySelector('[data-supplier-fields]').hidden = !!invoice || !canManual;
      supplier.disabled = !!invoice || !canManual;
      box.querySelectorAll('[data-manual-only]').forEach(function (el) { el.hidden = !!invoice || !canManual; });
      box.querySelectorAll('[data-include-invoice]').forEach(function (el) { el.hidden = !invoice; });
      box.querySelector('[data-clear-invoice]').hidden = !invoice;
      box.querySelector('[data-open-invoice-picker]').textContent = invoice ? 'Выбрать другой счёт' : 'Найти счёт в CRM';
      box.querySelector('[data-chosen-invoice]').innerHTML = invoice ?
        '<b>' + _esc(invoiceName(invoice)) + '</b> · ' + _esc(invoice.supplier_name) + ' · ' + _esc(invoiceDate(invoice.invoice_date)) + ' ' + invoiceBadge(invoice) : '';
      box.querySelector('[data-manual-existing]').replaceChildren();
      dateInput.value = invoice ? String(invoice.expected_date || '').slice(0, 10) : manualDate;
      lines.forEach(function (line, i) {
        var check = box.querySelector('[data-invoice-line="' + i + '"]');
        var qty = box.querySelector('[data-manual-qty="' + i + '"]');
        var limit = invoice ? line.invoiceQty : line.qty;
        check.checked = true;
        qty.disabled = !limit;
        qty.max = limit;
        qty.value = limit ? Math.min(Number(qty.value) || limit, limit) : '';
        qty.closest('.wtb-manual-line').hidden = !limit && !invoice;
        var select = box.querySelector('[data-invoice-source="' + i + '"]');
        if (!select) return;
        var available = invoice ? (invoice.availableItems || []) : [];
        var matching = available.filter(function (item) { return item.name.trim().toLowerCase() === line.name.trim().toLowerCase(); });
        select.closest('label').hidden = available.length <= 1;
        select.innerHTML = '<option value="">По наименованию в договоре</option>' + available.map(function (item) {
          return '<option value="' + Number(item.id) + '">' + _esc(item.name) +
            ' · ' + fmt(item.remaining_qty) + ' ' + unit(item.unit) + '</option>';
        }).join('');
        var chosen = matching.length === 1 ? matching[0] : available.length === 1 ? available[0] : null;
        select.value = chosen ? String(chosen.id) : '';
      });
      preview();
    }
    box.querySelector('[data-open-invoice-picker]').onclick = function () { openInvoicePicker(box, invoice && invoice.id, setInvoice); };
    box.querySelector('[data-clear-invoice]').onclick = function () { setInvoice(null); };
    function body(dry) {
      var sid = invoice ? Number(invoice.supplier_id) : Number(supplier.value) || null;
      var append = box.querySelector('[data-manual-append]');
      return { dry_run: dry, request_id: requestId, supplier_id: sid,
        invoice_order_id: invoice ? invoice.id : undefined,
        replacement_confirmation: !dry && confirmation ? confirmation : undefined,
        paid: box.querySelector('[data-manual-paid]').checked,
        invoice_number: box.querySelector('[data-manual-invoice]').value.trim(),
        expected_date: box.querySelector('[data-manual-date]').value || null,
        append_order_id: append && append.value ? Number(append.value) : null,
        create_separate: !!(box.querySelector('[data-manual-separate]') || {}).checked,
        items: lines.flatMap(function (l, i) {
          var input = box.querySelector('[data-manual-qty="' + i + '"]');
          var source = box.querySelector('[data-invoice-source="' + i + '"]');
          return !input.disabled ? [Object.assign(linePayload(l, { supplier_id: sid }), {
            qty: Number(input.value), invoice_line_id: invoice && source && source.value ? Number(source.value) : undefined
          })] : [];
        }) };
    }
    async function preview() {
      var seq = ++sequence;
      submit.disabled = true; warning.hidden = true;
      confirmation = null;
      changeNotice.hidden = true;
      submit.textContent = 'Учесть заказ';
      if (!form.checkValidity() || (!invoice && !supplier.value) || !body(true).items.length) return;
      try {
        var data = successfulPost(await apiPost('/api/supply/what-to-buy/ordered', body(true)));
        if (seq !== sequence || !box.isConnected) return;
        if (data.replacement_confirmation && (data.replacements || []).length) {
          confirmation = data.replacement_confirmation;
          changeNotice.innerHTML = '<strong>Наименование в договоре изменится</strong>' +
            data.replacements.map(function (item) {
              return '<div><span>' + _esc(item.original_name) + '</span><b> → ' + _esc(item.name) + '</b>' +
                (Number(item.qty) < Number(item.contract_qty) ? '<small>По этому счёту будет учтено ' +
                  fmt(item.qty) + ' из ' + fmt(item.contract_qty) + ' ' + unit(item.unit) + '.</small>' : '') +
                (item.catalog_id ? '' : '<small>Будет создана карточка номенклатуры.</small>') + '</div>';
            }).join('');
          changeNotice.hidden = false;
          submit.textContent = 'ОК, учесть и заменить';
        }
        var holder = box.querySelector('[data-manual-existing]'), old = holder.querySelector('[data-manual-append]'), previous = old && old.value;
        holder.innerHTML = (data.existing_orders || []).length ? '<div class="wtb-existing-order"><b>По этим позициям уже есть заказ</b><label class="wtb-field">Дополнить заказ<select data-manual-append><option value="">Выберите заказ</option>' + data.existing_orders.map(function (o) { return '<option value="' + o.id + '"' + (String(o.id) === previous ? ' selected' : '') + '>' + _esc(o.order_label || ('ORD-' + o.id)) + ' · ' + _esc(orderStatusRu(o.status)) + '</option>'; }).join('') + '</select></label><label class="wtb-paid-field"><input type="checkbox" data-manual-separate>Создать отдельный заказ</label></div>' : '';
        function ready() { submit.disabled = !data.can_create || !!(data.existing_orders || []).length && !holder.querySelector('[data-manual-append]').value && !holder.querySelector('[data-manual-separate]').checked; }
        holder.querySelectorAll('select,input').forEach(function (input) { input.onchange = function () { if (input.hasAttribute('data-manual-separate') && input.checked) holder.querySelector('[data-manual-append]').value = ''; if (input.hasAttribute('data-manual-append') && input.value) holder.querySelector('[data-manual-separate]').checked = false; ready(); }; });
        ready();
      } catch (error) { if (seq === sequence) { warning.hidden = false; warning.textContent = error.message; } }
    }
    form.addEventListener('input', function (e) { if (e.target.closest('[data-manual-existing],[data-manual-supplier-search]')) return; clearTimeout(timer); ++sequence; submit.disabled = true; timer = setTimeout(preview, 250); });
    form.addEventListener('change', function (e) {
      if (e.target.closest('[data-manual-existing],[data-manual-supplier-search]')) return;
      if (e.target.hasAttribute('data-invoice-line')) {
        box.querySelector('[data-manual-qty="' + e.target.getAttribute('data-invoice-line') + '"]').disabled = !e.target.checked;
      }
      clearTimeout(timer); preview();
    });
    form.onsubmit = async function (e) {
      e.preventDefault(); if (submitting || submit.disabled) return;
      submitting = true; submit.disabled = true;
      try {
        var result = successfulPost(await apiPost('/api/supply/what-to-buy/ordered', body(false)));
        closeWtbModal(); await refreshCurrent();
        if (typeof showToast === 'function') showToast('Учтён заказ ' + result.order.order_label + '. Количество — в пути.', 'success');
      } catch (error) {
        submitting = false;
        if (confirmation) await preview();
        else submit.disabled = false;
        warning.hidden = false;
        warning.textContent = error.message;
      }
    };
    setInvoice(null);
  }
})();
