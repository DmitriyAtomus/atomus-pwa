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
    inactive: null
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
      covered: 'Покрыто'
    })[s] || s || '';
  }
  function orderStatusRu(s) {
    return ({
      draft: 'Черновик',
      invoice_requested: 'Счёт запрошен',
      sent: 'Отправлен поставщику',
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

  async function openContract(id) {
    st.contractId = id;
    st.view = 'contract';
    st.container.innerHTML = '<div class="loading-block">Загружаем договор…</div>';
    st.tree = await wtbGet({ contract_id: id });
    render();
  }
  async function setView(view) {
    st.view = view;
    if (view === 'landing') {
      st.contractId = null;
      if (!st.landing) st.landing = await wtbGet();
      render();
      return;
    }
    if (view === 'in_transit') {
      st.landing = await wtbGet({ view: 'in_transit', include_drafts: st.includeDrafts ? '1' : '' });
      render();
      return;
    }
    if (view === 'inactive_bom') {
      st.inactive = await wtbGet({ view: 'inactive_bom' });
      render();
      return;
    }
    if (st.contractId) {
      if (!st.tree || !st.tree.items) st.tree = await wtbGet({ contract_id: st.contractId });
      render();
      return;
    }
    st.tree = await wtbGet({ view: view === 'contract' ? 'products' : view });
    render();
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
    var btns = [
      ['landing', 'По договорам'],
      ['products', 'По изделиям'],
      ['suppliers', 'По поставщикам'],
      ['list', 'Общим списком'],
      ['in_transit', 'В пути'],
      ['inactive_bom', 'Неактивные в BOM']
    ];
    return '<div class="wtb-toolbar"><div class="wtb-seg">' +
      btns.map(function (b) {
        return '<button type="button" class="' + (active === b[0] || (active === 'contract' && b[0] === 'products') ? 'on' : '') +
          '" data-wtb-view="' + b[0] + '">' + b[1] + '</button>';
      }).join('') +
      '</div><input class="wtb-search" type="search" placeholder="Поиск…" value="' + _esc(st.q) + '" data-wtb-search></div>';
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
    var d = st.landing || { contracts: [], min_stock: { items: [] }, in_transit: [] };
    var cards = (d.contracts || []).filter(function (c) {
      return matchQ([c.number, c.contractor_name].join(' '));
    });
    var buy = cards.reduce(function (s, c) { return s + (c.to_buy_lines || 0); }, 0);
    setCounter(buy);
    setSub('Сначала договор, потом изделие, потом комплектующие. Склад и «в пути» распределяются по дате работы.');
    var html = '<div class="wtb-root">' + toolbar('landing') +
      '<div class="wtb-h2">Договоры в производстве · ' + cards.length + '</div>' +
      '<div class="wtb-lcards">';
    cards.forEach(function (c) {
      html += '<button type="button" class="wtb-lcard ' + cardTone(c) + '" data-wtb-contract="' + c.contract_id + '">' +
        '<div class="num">' + _esc(c.number || ('#' + c.contract_id)) + '</div>' +
        '<div class="who">' + _esc(c.contractor_name || 'Без заказчика') + '</div>' +
        '<div class="rowm">' +
          '<div class="m ok"><b>' + (c.readiness_pct || 0) + '%</b>готовность</div>' +
          '<div class="m buy"><b>' + fmt(c.to_buy_qty) + '</b>докупить' + (c.to_buy_lines ? ' · ' + c.to_buy_lines : '') + '</div>' +
          '<div class="m wait"><b>' + fmt(c.in_transit_qty) + '</b>в пути</div>' +
        '</div>' +
        '<div class="rowm" style="grid-template-columns:1fr 1fr;margin-top:8px;">' +
          '<div class="m err"><b>' + (c.data_errors || 0) + '</b>ошибки данных</div>' +
          '<div class="m"><b>' + (c.warnings_count || 0) + '</b>предупреждений</div>' +
        '</div>' +
        ((c.inventory_summary && c.inventory_summary.count)
          ? '<div class="invline">Инвентаризация: ' + c.inventory_summary.count +
            ' позиций без инвентаризации &gt;' + (c.inventory_summary.stale_days || 60) + ' дн.</div>'
          : '') +
        '</button>';
    });
    if (!cards.length) html += '<div class="wtb-empty">Нет договоров в производстве</div>';
    html += '</div>';
    var mins = (d.min_stock && d.min_stock.items) || [];
    html += '<div class="wtb-minbox"><h3>Без договора / мин. остатки</h3>' +
      '<div class="lead">Позиции, у которых свободный остаток ниже минимума после распределения по договорам.</div>';
    if (!mins.length) html += '<div class="wtb-empty">Все минимумы закрыты</div>';
    mins.filter(function (m) { return matchQ(m.name); }).forEach(function (m) {
      html += '<div class="wtb-min-row"><div><b>' + _esc(m.name) + '</b>' +
        (m.sku ? '<div class="s">' + _esc(m.sku) + '</div>' : '') + '</div>' +
        '<div class="s">остаток ' + fmt(m.leftover) + ' ' + unit(m.unit) +
        ' · мин. ' + fmt(m.min_stock) + ' · нехватка <b>' + fmt(m.gap) + '</b></div></div>';
    });
    html += '</div>';
    html += linkSuggestionsBlock(d);
    html += '<button type="button" class="wtb-legacy" data-wtb-legacy>Вернуться к старому списку</button></div>';
    return html;
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
        supplier_id: ch.supplier_id || row.supplier_id || null,
        supplier_name: ch.supplier_name || row.supplier_name || '',
        contract_number: row.contract_number,
        drafts: ch.drafts || []
      };
    }
    return {
      key: lineKey(row, null),
      contract_id: row.contract_id,
      contract_item_id: row.contract_item_id,
      component_id: null,
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
  function linePayload(l, supplierOverride) {
    var o = {
      key: l.key,
      contract_id: l.contract_id,
      contract_item_id: l.contract_item_id,
      component_id: l.component_id,
      qty: l.qty
    };
    if (supplierOverride || l.supplier_id) o.supplier_id = supplierOverride || l.supplier_id;
    return o;
  }

  function childRow(row, ch) {
    var stt = ch.status || '';
    var buyCls = (ch.to_buy > 0) ? 'wtb-num-buy' : (ch.in_transit_allocated > 0 ? 'wtb-num-wait' : 'wtb-num-ok');
    var mark = ch.in_stock_not_reserved
      ? '<span class="wtb-pill mark">на складе, не зарезервировано</span>' : '';
    var inact = ch.inactive ? '<span class="wtb-pill err">неактивный BOM</span>' : '';
    var line = orderableLine(row, ch);
    var can = toOrder(ch) > 0;
    var checked = can && st.selected[line.key] ? ' checked' : '';
    var box = can
      ? '<label class="wtb-check" onclick="event.stopPropagation()"><input type="checkbox" data-wtb-line="' +
        _esc(line.key) + '" ' + checked + '></label>'
      : '';
    var orderBtn = can
      ? '<button type="button" class="wtb-order-btn" data-wtb-order-one="' + _esc(line.key) +
        '" onclick="event.stopPropagation()">Заказать</button>'
      : draftChips(ch.drafts);
    return '<tr>' +
      '<td class="wtb-td-check">' + box + '</td>' +
      '<td class="nm">' + _esc(ch.name || '—') +
        (ch.sku ? '<small>' + _esc(ch.sku) + '</small>' : '') +
        mark + inact + draftChips(ch.drafts) + shareChips(ch) + renderWarns(withoutInventory(ch.warnings)) + '</td>' +
      '<td>' + fmt(ch.need) + '</td>' +
      '<td>' + fmt(ch.stock_allocated) + '</td>' +
      '<td class="wtb-num-wait">' + fmt(ch.in_transit_allocated) + '</td>' +
      '<td class="' + buyCls + '">' + fmt(ch.to_buy) + '</td>' +
      '<td>' + _esc(statusLabel(stt)) + orderBtn + '</td>' +
      '</tr>';
  }

  function productCard(row, withContract) {
    var id = row.id || ('ci:' + row.contract_item_id);
    var open = !!st.open[id] || (row.data_errors || []).length > 0 || (row.to_buy_qty > 0) || (row.warnings || []).length > 0;
    var pills = '<span class="wtb-pill kind">' + _esc(row.supply_kind_label || row.supply_kind || '') + '</span>';
    if (row.to_buy_qty > 0) pills += '<span class="wtb-pill buy">докупить ' + fmt(row.to_buy_qty) + '</span>';
    if (toOrder(row) > 0 && toOrder(row) !== Number(row.to_buy_qty)) pills += '<span class="wtb-pill buy">заказать ' + fmt(toOrder(row)) + '</span>';
    if ((row.drafts || []).length) pills += draftChips(row.drafts);
    if (row.in_transit_qty > 0) pills += '<span class="wtb-pill wait">в пути ' + fmt(row.in_transit_qty) + '</span>';
    if ((row.data_errors || []).length) pills += '<span class="wtb-pill err">ошибок данных: ' + row.data_errors.length + '</span>';
    if ((row.children || []).some(function (c) { return c.in_stock_not_reserved; }))
      pills += '<span class="wtb-pill mark">есть на складе, не зарезервировано</span>';
    var body = '';
    if ((row.children || []).length) {
      body = '<table class="wtb-comp"><thead><tr>' +
        '<th></th><th>Комплектующее</th><th>Нужно</th><th>Склад</th><th>В пути</th><th>Докупить</th><th>Статус</th>' +
        '</tr></thead><tbody>' + row.children.map(function (ch) { return childRow(row, ch); }).join('') + '</tbody></table>';
    } else if ((row.data_errors || []).indexOf('empty_bom') >= 0) {
      body = renderWarns(withoutInventory(row.warnings));
    }
    if ((row.children || []).length && (row.warnings || []).length) {
      body = renderWarns(withoutInventory(row.warnings)) + body;
    }
    var prodLines = collectOrderable([row]);
    var allSel = prodLines.length && prodLines.every(function (l) { return st.selected[l.key]; });
    var someSel = prodLines.some(function (l) { return st.selected[l.key]; });
    var prodBox = prodLines.length
      ? '<label class="wtb-check wtb-check-prod" onclick="event.stopPropagation()"><input type="checkbox" data-wtb-line-group="' +
        _esc(id) + '"' + (allSel ? ' checked' : '') + (someSel && !allSel ? ' data-indeterminate="1"' : '') + '></label>'
      : '';
    var prodOrder = prodLines.length
      ? '<button type="button" class="wtb-order-btn" data-wtb-order-group="' + _esc(id) +
        '" onclick="event.stopPropagation()">Заказать</button>'
      : '';
    return '<div class="wtb-card ' + statusClass(row.status) + (open ? ' open' : '') + '" data-wtb-open="' + _esc(id) + '">' +
      '<div class="wtb-ch">' +
        '<div class="wtb-pos">' + prodBox + _esc(row.position_no != null ? row.position_no : '') + '</div>' +
        '<div class="wtb-cinfo"><div class="name">' + _esc(row.name || '—') + '</div>' +
          '<div class="meta2">' + fmt(row.qty) + ' ' + unit(row.unit) +
          (withContract && row.contract_number ? ' · договор ' + _esc(row.contract_number) : '') +
          (row.model_article ? ' · ' + _esc(row.model_article) : '') + '</div>' +
          '<div class="wtb-pills">' + pills + '</div>' + readinessBar(row) +
        '</div>' +
        '<div class="wtb-cstat">' + prodOrder + '<span class="wtb-pill ' +
          (row.status === 'to_buy' ? 'buy' : row.status === 'in_transit' ? 'wait' : (row.status === 'data_error' || row.status === 'in_stock_not_reserved') ? (row.status === 'in_stock_not_reserved' ? 'mark' : 'err') : 'ok') +
          '">' + _esc(statusLabel(row.status)) + '</span>' +
          '<span class="wtb-tog">▾</span></div>' +
      '</div>' +
      '<div class="wtb-bodyc">' + body + '</div></div>';
  }

  function filterItems(items) {
    return (items || []).filter(function (row) {
      if (matchQ([row.name, row.contract_number, row.model_article].join(' '))) return true;
      return (row.children || []).some(function (c) { return matchQ(c.name + ' ' + (c.sku || '')); });
    });
  }

  function renderContractOrProducts(view) {
    var payload = st.contractId ? st.tree : (st.tree || st.landing);
    var card = st.contractId && payload && payload.contract;
    var items = filterItems(payload && payload.items);
    var buyLines = items.filter(function (r) { return r.to_buy_qty > 0; }).length;
    setCounter(buyLines);
    var head = '';
    if (card) {
      setSub('Договор ' + (card.number || '') + ' — дерево позиций и комплектующих.');
      head = '<button type="button" class="wtb-back" data-wtb-view="landing">← Ко всем договорам</button>' +
        '<div class="wtb-chead"><h2>' + _esc(card.number || '') + '</h2>' +
        '<div class="wtb-meta">' + _esc(card.contractor_name || '') +
        (card.sign_date ? ' · ' + _esc(card.sign_date) : '') + '</div></div>' +
        '<div class="wtb-kpis">' +
          '<div class="wtb-kpi ok"><div class="n">' + (card.readiness_pct || 0) + '%</div><div class="l">Готовность</div></div>' +
          '<div class="wtb-kpi buy"><div class="n">' + fmt(card.to_buy_qty) + '</div><div class="l">Докупить</div></div>' +
          '<div class="wtb-kpi wait"><div class="n">' + fmt(card.in_transit_qty) + '</div><div class="l">В пути</div></div>' +
          '<div class="wtb-kpi err"><div class="n">' + (card.data_errors || 0) + '</div><div class="l">Ошибки данных</div></div>' +
          '<div class="wtb-kpi wait"><div class="n">' + (card.warnings_count || 0) + '</div><div class="l">Предупреждения</div></div>' +
        '</div>' + inventorySummary(card);
    } else {
      setSub('Изделия всех договоров в производстве.');
      head = '<div class="wtb-h2">Изделия · ' + items.length + '</div>';
    }
    var html = '<div class="wtb-root">' + toolbar(view) + head +
      '<div class="wtb-legend"><span><i class="wtb-lg s"></i>Склад</span><span><i class="wtb-lg o"></i>В пути</span>' +
      '<span><i class="wtb-lg e"></i>Ошибка / пустой состав</span></div>' +
      '<div class="wtb-tree">';
    if (view === 'products' && !st.contractId) {
      var byC = {};
      items.forEach(function (r) {
        var k = r.contract_id;
        (byC[k] = byC[k] || { number: r.contract_number, items: [] }).items.push(r);
      });
      Object.keys(byC).forEach(function (k) {
        html += '<div class="wtb-h2">' + _esc(byC[k].number || ('#' + k)) + '</div>';
        byC[k].items.forEach(function (r) { html += productCard(r, false); });
      });
    } else {
      items.forEach(function (r) { html += productCard(r, !st.contractId); });
    }
    if (!items.length) html += '<div class="wtb-empty">Нет позиций</div>';
    html += '</div>' + orderBar(items) + '</div>';
    return html;
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
    var payload = st.contractId ? st.tree : (st.tree || st.landing);
    var lines = collectLines(payload && payload.items);
    setCounter(lines.filter(function (l) { return l.to_buy > 0; }).length);
    setSub('Общий список комплектующих с колонкой изделия.');
    var html = '<div class="wtb-root">' + toolbar('list') +
      '<table class="wtb-flat"><thead><tr><th>Комплектующее</th><th>Изделие</th><th>Договор</th><th>Нужно</th><th>Склад</th><th>В пути</th><th>Докупить</th><th>Статус</th></tr></thead><tbody>';
    lines.forEach(function (l) {
      html += '<tr><td>' + _esc(l.name) +
        (l.in_stock_not_reserved ? ' <span class="wtb-pill mark">на складе, не зарезервировано</span>' : '') +
        '</td><td>' + _esc(l.product || '') + '</td><td>' + _esc(l.contract || '') +
        '</td><td>' + fmt(l.need) + '</td><td>' + fmt(l.stock) + '</td><td>' + fmt(l.in_transit) +
        '</td><td class="' + (l.to_buy > 0 ? 'wtb-num-buy' : '') + '">' + fmt(l.to_buy) +
        '</td><td>' + _esc(statusLabel(l.status)) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    return html;
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
          html += '<div class="wtb-oline"><div><b>' + _esc(it.name) + '</b> ×' + fmt(it.qty) +
            (it.unit ? ' ' + _esc(it.unit) : '') +
            '<div class="s">изделие: ' + (it.position_no != null ? 'поз. ' + _esc(it.position_no) + ' ' : '') +
            _esc(it.product_name || '') + '</div></div><div class="wtb-oline-r"><span class="wtb-num-buy">докупить ' + fmt(it.qty) + '</span>' +
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
            if (st.contractId) await openContract(st.contractId);
            else render();
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
            '<span class="wtb-supopt-name">' + _esc(s.name || '—') + '</span>' +
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
        (targetItems || []).forEach(function (it) { overrides[it.key] = choice; });
        lines.forEach(function (l) {
          if ((targetItems || []).some(function (it) { return it.key === l.key; })) {
            l.supplier_id = choice;
            l.supplier_name = name;
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
      var viewBtn = e.target.closest('[data-wtb-view]');
      if (viewBtn) { e.preventDefault(); setView(viewBtn.getAttribute('data-wtb-view')); return; }
      var cbtn = e.target.closest('[data-wtb-contract]');
      if (cbtn) { e.preventDefault(); openContract(Number(cbtn.getAttribute('data-wtb-contract'))); return; }
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
        st.open[id] = !st.open[id];
        open.classList.toggle('open');
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
        setView('in_transit');
      });
    }
  }
})();
