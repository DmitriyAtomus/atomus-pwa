// «📋 Из спецификации» (v2.46.152): вставил список позиций — строки узнаются по
// артикулам/названиям и ложатся на узлы листа АГ.ЧИЛ-104. Гоняем настоящий
// разбор на спецификации чиллера 7 кВт, которую прислал Дмитрий.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const src = fs.readFileSync(path.join(__dirname, '..', 'chiller', 'project.html'), 'utf8');
function slice(from, to) {
  const i = src.indexOf(from);
  assert.ok(i >= 0, 'не найдено: ' + from);
  const j = src.indexOf(to, i);
  assert.ok(j > i, 'не найден конец: ' + to);
  return src.slice(i, j);
}
function sandbox() {
  const code = slice('const SPEC_RULES=[', 'function specFindModel(name,key)');
  return new Function('schNodeT', code + 'return {specParse, specMap, specTokens};')(k => k);
}

const SPEC = `014L0183R SGP 12S N Стекло смотровое,1/2"\t1
032F-1206R EVR 3 NC Клапан  соленоидный  1/4"\t1
Вентилятор в сборе YWF4E-450S-E5L-102/61 (220V)\t1
Штуцер сервисный с к/м трубкой, с толщиной стенки 0,6 мм и длиной трубки 50 мм BC-AV-04SH\t5
061F8492R ACB-2UB463W Реле давления картриджное\t1
061F7509R ACB-2UB509W Реле давления картриджное\t1
061F7520R ACB-2UA520W Реле давления картриджное\t1
Конденсатор (теплообменник) BS-ACV-G8 145 А13 (без вент)\t1
027B0202R1 BPHE_RD-027-20-4,5-H-Q1Q2(L1")/Q3Q4(H1"1/8) Теплообменник пластинчатый паяный\t1
015P2352 Насос Ридан RMHI 2-2R, G1-G1, PN 10\t1
023B7014R DFL 084s Фильтр-осушитель 1/2"\t1
Компрессор спиральный YH104T1-210\t1
032L1217R EVR 10 NC Клапан соленоидный, 1/2"\t1
009L7022R GBC 12S Клапан запорный, 1/2"\t2
020-1018R NRV 16S Клапан обратный прямоточный, 5/8"/16 мм\t1
020В1132 NRD 12 Клапан дифференциальный, 1/2"\t1
034L0093R KVR 12 Клапан регулирующий\t1
020-1011R NRV 10S Клапан обратный прямоточный, 3/8"\t1
159 Ресивер CS-LR - 8,0\t1
Вентиль Rotalock CS-RV-1-12\t1
114 Отделитель жидкости CS-AS - 2,5-15\t1
Нагреватель картера НК 5,4-0,5м\t1
Манометр с глицерином на низкое давление CS-NG-LRC-80, D80мм, R507, R134A, RR404A, R407C, R410A\t1
Манометр с глицерином на высокое давление CS-NG-HRC-80, D80мм, R507, R134A, R404A, R407C, R410A\t1
068Z4209R TE2  TPB R407C/R22,-40С...+10С, отбортовка 1/2"\t1
068-3053R T/TE 2 Клапанный узел№03\t1
Реле потока ДР-П-03-20, расх. 10... 1570л/мин, присоед.: К3/4", Pmax=1 МПа, Траб.:1...100С, Реле: 8А\t1`;

test('27 строк разбираются с количеством', () => {
  const { specParse } = sandbox();
  const rows = specParse(SPEC);
  assert.equal(rows.length, 27);
  assert.equal(rows.find(r => /BC-AV/.test(r.name)).qty, 5);
  assert.equal(rows.find(r => /GBC/.test(r.name)).qty, 2);
  assert.equal(rows.find(r => /YH104/.test(r.name)).qty, 1);
  assert.match(rows[0].name, /SGP 12S/);
});

test('спецификация 7 кВт раскладывается по узлам листа', () => {
  const { specParse, specMap } = sandbox();
  const rows = specMap(specParse(SPEC));
  const key = re => (rows.find(r => re.test(r.name)) || {}).key;
  assert.equal(key(/YH104T1/), 'KM1');
  assert.equal(key(/BS-ACV/), 'AVO1');
  assert.equal(key(/YWF4E/), 'M1');
  assert.equal(key(/BPHE/), 'I1');
  assert.equal(key(/CS-LR/), 'RS1');
  assert.equal(key(/CS-AS/), 'OZH1');
  assert.equal(key(/DFL 084/), 'F1');
  assert.equal(key(/SGP 12S/), 'SI1');
  assert.equal(key(/EVR 10/), 'UA1');
  assert.equal(key(/EVR 3 /), 'UA2');
  assert.equal(key(/TE2 TPB/), 'TRV1');
  assert.equal(key(/NRD 12/), 'KD1');
  assert.equal(key(/KVR 12/), 'KR1');
  assert.equal(key(/GBC 12S/), 'VN1');
  assert.equal(key(/NRV 16S/), 'KO1');
  assert.equal(key(/NRV 10S/), 'KO2');
  assert.equal(key(/RMHI/), 'N1');
  assert.equal(key(/ДР-П/), 'RP1');
  assert.equal(key(/НК 5,4/), 'EK1');
  assert.equal(key(/LRC-80/), 'MN1');
  assert.equal(key(/HRC-80/), 'MN2');
  assert.equal(key(/BC-AV/), 'KSH2');
  assert.equal(key(/2UA520W/), 'RD2');              // ручной сброс — защита ВД
  const ub = rows.filter(r => /2UB/.test(r.name)).map(r => r.key);
  assert.deepEqual(ub, ['RD1', 'RD3']);
  // вне листа — не потеряны, с пояснением
  const rot = rows.find(r => /Rotalock/.test(r.name));
  assert.equal(rot.key, null); assert.match(rot.note, /Rotalock/);
  const orif = rows.find(r => /Клапанный узел/.test(r.name));
  assert.equal(orif.key, null); assert.match(orif.note, /ТРВ1/);
  // всё узнано
  assert.equal(rows.filter(r => !r.key && !r.off).length, 0, 'неузнанные: ' +
    rows.filter(r => !r.key && !r.off).map(r => r.name).join(' | '));
});

test('токены артикула — сильные пары «код+номер», без марок фреона', () => {
  const { specTokens } = sandbox();
  const t = specTokens('015P2352 Насос Ридан RMHI 2-2R, G1-G1, PN 10');
  assert.ok(t.includes('RMHI'));
  assert.ok(t.includes('015P2352'));
  assert.ok(!t.includes('PN'));
  const g = specTokens('Манометр CS-NG-LRC-80, D80мм, R507, R134A, R407C');
  assert.ok(g.some(x => /LRC-80/.test(x)));
  assert.ok(!g.some(x => /^R407C$|^R134A$|^R507$/.test(x)), 'фреон попал в артикул: ' + g);
  const e = specTokens('032L1217R EVR 10 NC Клапан соленоидный, 1/2"');
  assert.ok(e.includes('EVR 10'), 'пара код+номер: ' + e);
});

test('кнопка на вкладке «Схема» и модалка на месте', () => {
  assert.match(src, /id="slSpec"/);
  assert.match(src, /id="slSpecGo"/);
  assert.match(src, /function specOpen\(\)/);
  assert.match(src, /Назначить найденные/);
  assert.match(src, /загрузи STEP этой позиции/);
});
