/* ═══ v2.46.157: типы позиций — третий уровень рубрикатора ═══
   Пункт 4 из списка Дмитрия: подразделы базы крупные и смешанные («Вентили и
   смотровые стёкла» — 98 позиций: краны GBC, стёкла SGP, обратные NRV…).
   Индекс базы собирается снаружи, поэтому тип считаем на клиенте по артикулу
   и названию — одинаково в витрине (index.html) и в конструкторе (каталог,
   конвейер подбора). Выбрал «Смотровые стёкла» — видишь только их. */
window.ATYPES = (function () {
  /* [раздел, ключ, подпись, признак] — первый совпавший в разделе выигрывает */
  const R = [
    ['valves', 'filt',   'Фильтры-осушители',      /\b(DML|DCL|DFL|DGL|DAS|DSF|DCR|DMB|DCB)\b|фильтр/i],
    ['valves', 'sight',  'Смотровые стёкла',       /\bSG[PNI]\b|стекл|смотров|индикатор влаг/i],
    ['valves', 'gbc',    'Запорные краны',         /\bGBC\b|\bBML\b|шаров|запорн/i],
    ['valves', 'nrv',    'Обратные клапаны',       /\bNRV\b|обратн/i],
    ['valves', 'reg',    'Регуляторы давления',    /\b(KVR|NRD|KVP|KVL|KVC|KVD|ORIT|CPCE|LG)\b|регулятор|дифференциальн|байпас/i],
    ['valves', 'sol',    'Соленоидные клапаны',    /\bEVR\b|соленоид|электромагнит/i],
    ['valves', 'trv',    'ТРВ',                    /\b(TE\s?\d|TGE|TUB|TUA|TN\s?2|TS\s?2|TX\s?\d)\b|\bТРВ\b|терморегулир/i],
    ['valves', 'erv',    'ЭРВ',                    /\b(ETS|EEV|AKV)\b|ЭРВ|электронн\w* расширит/i],
    ['valves', 'safety', 'Предохранительные',      /\bSFA\b|\bSFV\b|предохранит/i],
    ['valves', 'svc',    'Сервисные штуцеры и вентили', /rotalock|ротолок|шрадер|schrader|\bBC-AV\b|штуцер|сервисн/i],
    ['vessels', 'recv',  'Ресиверы',               /ресивер|\bCS-LR\b|\bFS\b/i],
    ['vessels', 'sep',   'Отделители жидкости',    /отделител|\bCS-AS\b/i],
    ['vessels', 'oil',   'Маслоотделители',        /маслоотдел|\bOUB\b/i],
    ['vessels', 'tank',  'Баки',                   /\bбак\b|буферн|аккумулирующ/i],
    ['vessels', 'filt',  'Фильтры-осушители',      /\b(DML|DCL|DFL|DGL|DAS|DCR)\b|фильтр/i],
    ['automation', 'gauge', 'Манометры',           /маноме|\bCS-NG\b/i],
    ['automation', 'psw',   'Реле давления',       /реле давл|\b(ACB|KP\s?\d|CS-PC|CAS)\b/i],
    ['automation', 'flow',  'Реле потока',         /реле поток|\bДР-П\b|flow switch/i],
    ['automation', 'thermo','Термостаты',          /термостат|\bKP\s?6/i],
    ['automation', 'ctrl',  'Контроллеры',         /контроллер|\b(EKC|EPK|ERC|ETC)\b/i],
    ['automation', 'sens',  'Датчики',             /датчик|\b(AKS|MBS)\b/i],
    ['hx', 'cond',   'Конденсаторы',               /конденсатор|\bBS-ACV\b/i],
    ['hx', 'plate',  'Пластинчатые (ПТО)',         /пластинчат|\bBPHE\b|\bПТО\b/i],
    ['hx', 'fan',    'Вентиляторы',                /вентилятор|\bYWF\b/i],
    ['hx', 'evap',   'Воздухоохладители',          /воздухоохладител|испарител/i],
    ['hx', 'shell',  'Кожухотрубные',              /кожухотруб/i],
    ['compressors', 'scroll', 'Спиральные',        /спиральн|scroll|\bYH\d|\bZB\d|\bZR\d|\bZP\d/i],
    ['compressors', 'piston', 'Поршневые',         /поршнев|\b(NTZ|MTZ|MT|SC|LTZ)\s?\d/i],
    ['compressors', 'screw',  'Винтовые',          /винтов/i],
    ['pumps', '2cp',  'Центробежные двухколёсные', /\b2CPm?\b|двумя рабочими|двухколёс/i],
    ['pumps', 'cp',   'Центробежные одноколёсные', /\bCPm?\s?\d|центробежн|одним рабочим/i],
    ['pumps', 'rmhi', 'Многоступенчатые',          /\bRMHI\b|\bCR\s?\d|многоступ/i],
    ['pumps', 'circ', 'Циркуляционные',            /циркуляц|\bUPS\b|\bWilo\b/i],
    ['pipe', 'tube',    'Трубы',                   /труба/i],
    ['pipe', 'elbow',   'Отводы и угольники',      /отвод|угольник|колено/i],
    ['pipe', 'tee',     'Тройники',                /тройник|крестовин/i],
    ['pipe', 'adapter', 'Переходы, муфты, штуцеры',/переход|муфт|ниппел|штуцер|американк/i],
    ['heat', 'crank', 'Нагреватели картера',       /картер/i],
    ['heat', 'ten',   'ТЭНы и термостаты',         /тэн|термостат|блок нагрев/i],
  ];
  const hay = d => [d.id, d.brand, d.name, d.kind, (d.tags || []).join(' ')].filter(Boolean).join(' ');
  function of(d) {
    const h = hay(d);
    const r = R.find(r => r[0] === d.section && r[3].test(h));
    return r ? r[1] : 'other';
  }
  function label(sec, key) {
    if (key === 'other') return 'Прочее';
    const r = R.find(r => r[0] === sec && r[1] === key);
    return r ? r[2] : key;
  }
  /* типы в выборке с количеством, по убыванию */
  function types(list) {
    const m = new Map(), sec = list[0] && list[0].section;
    list.forEach(d => { const k = of(d); m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].map(([k, n]) => ({ key: k, label: label(sec, k), n: n }))
      .sort((a, b) => (a.key === 'other') - (b.key === 'other') || b.n - a.n);
  }
  /* узел листа АГ.ЧИЛ-104 → тип: конвейер подбора открывает сразу нужный тип */
  const NODE = {
    F1: 'filt', SI1: 'sight', VN1: 'gbc', KO1: 'nrv', KO2: 'nrv', KD1: 'reg', KR1: 'reg',
    UA1: 'sol', UA2: 'sol', TRV1: 'trv', RS1: 'recv', OZH1: 'sep', AB1: 'tank',
    MN1: 'gauge', MN2: 'gauge', RD1: 'psw', RD2: 'psw', RD3: 'psw', RP1: 'flow',
    KSH1: 'svc', KSH2: 'svc', AVO1: 'cond', I1: 'plate', M1: 'fan', KM1: 'scroll', EK1: 'crank',
  };
  /* серии фильтров-осушителей (пункт 3): что это и куда ставится */
  const FILTER_SERIES = {
    DML: { line: 'liq', txt: '100 % молекулярное сито · жидкостная линия · HFC (R134a, R404A, R407C, R410A) — стандарт для новой системы' },
    DFL: { line: 'liq', txt: 'Ридан · жидкостная линия · стандартный осушитель (аналог DML) — ставится в 90 % машин' },
    DCL: { line: 'liq', txt: '80 % сито + 20 % активированный глинозём · влага и кислота — после сгорания компрессора, на HCFC и минеральном масле' },
    DGL: { line: 'liq', txt: 'Ридан · сито + глинозём: влага и кислота (аналог DCL) — после сгорания компрессора' },
    DAS: { line: 'suc', txt: 'Линия всасывания · после сгорания компрессора: кислота, грязь — ставится временно на промывку' },
    DSF: { line: 'suc', txt: 'Всасывающая линия · войлочный/сетчатый фильтр грязи' },
    DCR: { line: 'liq', txt: 'Разборный корпус со сменными вставками 48-DM/DC/DA · большие машины — замена без пайки' },
    DMB: { line: 'bi',  txt: 'Двунаправленный (сито) · тепловые насосы и реверсивные системы' },
    DCB: { line: 'bi',  txt: 'Двунаправленный (сито + глинозём) · реверсивные системы после сгорания' },
  };
  const LINE_NAME = { liq: 'жидкостная линия', suc: 'всасывание', bi: 'двунаправленный' };
  function series(d) {
    const m = /\b(DML|DCL|DFL|DGL|DAS|DSF|DCR|DMB|DCB)\b/i.exec((d.id || '') + ' ' + (d.name || '') + ' ' + ((d.pick && d.pick.ser) || ''));
    return m ? m[1].toUpperCase() : null;
  }
  return { rules: R, of: of, label: label, types: types, NODE: NODE, FILTER_SERIES: FILTER_SERIES, LINE_NAME: LINE_NAME, series: series, hay: hay };
})();
