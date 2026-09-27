/* v25.1: цветные плитки «Разделы CRM» */
(function () {
  // Подключаем CSS
  if (!document.querySelector('link[href*="mobile-sections-colors.css"]')) {
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = '/mobile-sections-colors.css';
    document.head.appendChild(l);
  }

  function patch() {
    if (typeof window.openMobileSections !== 'function') return false;
    if (window.openMobileSections.__colored) return true;
    var orig = window.openMobileSections;
    window.openMobileSections = function () {
      var overlay = document.getElementById('mobile-sections-overlay');
      var grid = document.getElementById('mobile-sections-grid');
      if (!overlay || !grid) return;
      if (typeof showMobileContent === 'function') showMobileContent();
      var sections = (typeof _mobileAvailableSections === 'function') ? _mobileAvailableSections() : [];
      grid.innerHTML = sections.map(function (s) {
        var active = (state && state.currentSection === s.code);
        return '<button type="button" class="mobile-section-tile s-' + s.code +
          (active ? ' active' : '') + '" onclick="mobileGoSection(\'' + s.code + '\')"' +
          (active ? ' aria-current="page"' : '') + '>' +
          '<i class="ti ' + s.icon + '"></i><span>' +
          (typeof escapeHtml === 'function' ? escapeHtml(s.full || s.label) : (s.full || s.label)) +
          '</span>' + (active ? '<b>Открыт</b>' : '') + '</button>';
      }).join('');
      overlay.classList.add('visible');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    };
    window.openMobileSections.__colored = true;
    return true;
  }

  // Ждём загрузки app-*.js
  if (!patch()) {
    var n = 0;
    var t = setInterval(function () {
      if (patch() || ++n > 80) clearInterval(t);
    }, 100);
  }
})();
