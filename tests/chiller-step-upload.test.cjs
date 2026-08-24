const fs = require('fs');
const assert = require('assert');

const src = fs.readFileSync('chiller/project.html', 'utf8');

assert(src.includes('id="bStep"'), 'есть явная кнопка загрузки STEP');
assert(src.includes('id="stepFile"') && src.includes('.step,.stp'), 'file input ограничен STEP/STP');
assert(src.includes('id="stepDrop"') && src.includes("addEventListener('drop'"), 'есть drag/drop на сцену');
assert(src.includes("fd.append('file',file,file.name)"), 'STEP уходит multipart на защищённый API');
assert(src.includes("fetch(U.users(),{method:'POST',headers:AUTH,body:fd})"), 'загрузка несёт Bearer auth');
assert(src.includes("section:'frames',sub:'user'"), 'загруженная модель получает роль корпуса');
assert(src.includes('await loadUserModels();'), 'сохранённые модели поднимаются после перезагрузки');
assert(src.includes('s:p.d&&p.d._user&&p.obj.scale&&Math.abs(p.obj.scale.x-1)'), 'коррекция единиц сохраняется в проекте');
assert(src.includes('if(it&&d._user&&s.s){it.obj.scale.setScalar'), 'масштаб восстанавливается из проекта');
assert(src.includes("up==='y'?{x:Math.PI/2,y:0}"), 'есть выбор вертикальной оси');
assert(src.includes("G.url||U.mesh(G.f)"), 'пользовательский меш использует существующий декодер сцены');

const version = JSON.parse(fs.readFileSync('version.json', 'utf8'));
assert(version && typeof version === 'object', 'version.json не повреждён');

console.log('chiller-step-upload: ok');
