const fs=require('fs'),path=require('path'),assert=require('assert');
const src=fs.readFileSync(path.join(__dirname,'..','app-3.js'),'utf8');
const code=src.match(/const _IBX_TZ_MS[\s\S]*?\n}\n/)[0];
const f=new Function(code+';return _ibxEkbDate;')();
const hm=d=>String(d.getUTCHours()).padStart(2,'0')+':'+String(d.getUTCMinutes()).padStart(2,'0');
assert.strictEqual(hm(f('2026-10-27 02:59:00')),'02:59');
assert.strictEqual(hm(f('2026-10-27T12:20:00')),'12:20');
assert.strictEqual(hm(f('2026-10-26T21:59:00Z')),'02:59');
console.log('ok');
