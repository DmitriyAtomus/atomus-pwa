/* Что закупить v2 (этап 1). Отключение: localStorage.supplyWhatV1 = "0" */
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
    open: {}
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
      ['in_transit', 'В пути']
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
          '<div class="m"><b>' + (c.items_count || 0) + '</b>позиций</div>' +
        '</div></button>';
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

  function childRow(ch) {
    var stt = ch.status || '';
    var buyCls = (ch.to_buy > 0) ? 'wtb-num-buy' : (ch.in_transit_allocated > 0 ? 'wtb-num-wait' : 'wtb-num-ok');
    var mark = ch.in_stock_not_reserved
      ? '<span class="wtb-pill mark">на складе, не зарезервировано</span>' : '';
    var inact = ch.inactive ? '<span class="wtb-pill err">неактивный BOM</span>' : '';
    return '<tr>' +
      '<td></td>' +
      '<td class="nm">' + _esc(ch.name || '—') +
        (ch.sku ? '<small>' + _esc(ch.sku) + '</small>' : '') +
        mark + inact + shareChips(ch) + '</td>' +
      '<td>' + fmt(ch.need) + '</td>' +
      '<td>' + fmt(ch.stock_allocated) + '</td>' +
      '<td class="wtb-num-wait">' + fmt(ch.in_transit_allocated) + '</td>' +
      '<td class="' + buyCls + '">' + fmt(ch.to_buy) + '</td>' +
      '<td>' + _esc(statusLabel(stt)) + '</td>' +
      '</tr>';
  }

  function productCard(row, withContract) {
    var id = row.id || ('ci:' + row.contract_item_id);
    var open = !!st.open[id] || (row.data_errors || []).length > 0 || (row.to_buy_qty > 0);
    var pills = '<span class="wtb-pill kind">' + _esc(row.supply_kind_label || row.supply_kind || '') + '</span>';
    if (row.to_buy_qty > 0) pills += '<span class="wtb-pill buy">докупить ' + fmt(row.to_buy_qty) + '</span>';
    if (row.in_transit_qty > 0) pills += '<span class="wtb-pill wait">в пути ' + fmt(row.in_transit_qty) + '</span>';
    if ((row.data_errors || []).length) pills += '<span class="wtb-pill err">ошибок данных: ' + row.data_errors.length + '</span>';
    if ((row.children || []).some(function (c) { return c.in_stock_not_reserved; }))
      pills += '<span class="wtb-pill mark">есть на складе, не зарезервировано</span>';
    var body = '';
    if ((row.children || []).length) {
      body = '<table class="wtb-comp"><thead><tr>' +
        '<th></th><th>Комплектующее</th><th>Нужно</th><th>Склад</th><th>В пути</th><th>Докупить</th><th>Статус</th>' +
        '</tr></thead><tbody>' + row.children.map(childRow).join('') + '</tbody></table>';
    } else if ((row.data_errors || []).indexOf('empty_bom') >= 0) {
      body = '<div class="wtb-hint">Пустой состав — ошибка данных. Развёрнутые предупреждения появятся на этапе 2.</div>';
    }
    return '<div class="wtb-card ' + statusClass(row.status) + (open ? ' open' : '') + '" data-wtb-open="' + _esc(id) + '">' +
      '<div class="wtb-ch">' +
        '<div class="wtb-pos">' + _esc(row.position_no != null ? row.position_no : '') + '</div>' +
        '<div class="wtb-cinfo"><div class="name">' + _esc(row.name || '—') + '</div>' +
          '<div class="meta2">' + fmt(row.qty) + ' ' + unit(row.unit) +
          (withContract && row.contract_number ? ' · договор ' + _esc(row.contract_number) : '') +
          (row.model_article ? ' · ' + _esc(row.model_article) : '') + '</div>' +
          '<div class="wtb-pills">' + pills + '</div>' + readinessBar(row) +
        '</div>' +
        '<div class="wtb-cstat"><span class="wtb-pill ' +
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
        '</div>';
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
    html += '</div></div>';
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

  function renderTransit() {
    var rows = ((st.landing && st.landing.in_transit) || []).filter(function (o) {
      return matchQ([o.order_label, o.item_name, o.supplier_name, o.dest_contract_number].join(' '));
    });
    setCounter(rows.length);
    setSub('Заказы, отправленные поставщику или оплаченные, но ещё не полностью принятые. Черновики скрыты.');
    var html = '<div class="wtb-root">' + toolbar('in_transit') +
      '<label class="wtb-hint" style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">' +
      '<input type="checkbox" data-wtb-drafts' + (st.includeDrafts ? ' checked' : '') + '> Показать черновики</label>';
    if (!rows.length) html += '<div class="wtb-empty">Нет заказов в пути</div>';
    rows.forEach(function (o) {
      var dest = o.dest_contract_number || ((o.destinations || []).map(function (d) { return d.contract_number; }).filter(Boolean).join(', ')) || '—';
      html += '<div class="wtb-tr' + (o.overdue ? ' overdue' : '') + '">' +
        '<div><div class="lbl">' + _esc(o.order_label || ('ORD-' + o.order_id)) + '</div>' +
          '<div class="meta">' + _esc(o.supplier_name || 'Без поставщика') + '</div></div>' +
        '<div><div class="lbl">' + _esc(o.item_name) + '</div>' +
          '<div class="meta">договор ' + _esc(dest) + '</div></div>' +
        '<div>' + _esc(orderStatusRu(o.status)) + (o.paid ? ' · оплачен' : '') + '</div>' +
        '<div>принято ' + fmt(o.received_qty) + ' / ' + fmt(o.qty) + '<div class="meta">осталось ' + fmt(o.remaining_qty) + '</div></div>' +
        '<div>' + (o.expected_date ? _esc(String(o.expected_date).slice(0, 10)) : 'без даты') +
          (o.overdue ? '<div class="over">просрочен</div>' : '') + '</div></div>';
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
    else html = renderContractOrProducts(st.view === 'contract' ? 'contract' : 'products');
    st.container.innerHTML = html;
    bind();
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
      var open = e.target.closest('[data-wtb-open]');
      if (open && e.target.closest('.wtb-ch')) {
        var id = open.getAttribute('data-wtb-open');
        st.open[id] = !st.open[id];
        open.classList.toggle('open');
      }
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
