// Builds the Workers static-assets manifest for the direct-upload API flow
// (used when deploying via the Cloudflare API/MCP instead of `wrangler deploy`).
// Usage: node worker/assets-manifest.mjs <outDir>
// Writes <outDir>/manifest.json ({"/path": {hash,size}}) and <outDir>/files.json ({hash: {path, mime}}).
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';

const out = process.argv[2] || '/tmp/atomus-assets';
mkdirSync(out, { recursive: true });
const ignore = readFileSync('.assetsignore', 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
ignore.push('_headers', '_redirects'); // passed as assets.config, not as files
const MIME = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  ico: 'image/x-icon', pdf: 'application/pdf', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
  xml: 'application/xml', mp3: 'audio/mpeg', mp4: 'video/mp4', wasm: 'application/wasm', glb: 'model/gltf-binary',
  gltf: 'model/gltf+json', csv: 'text/csv; charset=utf-8', zip: 'application/zip',
};
const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean)
  .filter(f => !ignore.some(i => f === i || f.startsWith(i.replace(/\/$/, '') + '/')));
const manifest = {}, map = {};
for (const f of files) {
  const buf = readFileSync(f);
  const ext = extname(f).substring(1).toLowerCase();
  const hash = createHash('sha256').update(buf.toString('base64') + ext).digest('hex').slice(0, 32);
  manifest['/' + f] = { hash, size: buf.length };
  map[hash] = { path: f, mime: MIME[ext] || 'application/octet-stream' };
}
writeFileSync(out + '/manifest.json', JSON.stringify(manifest));
writeFileSync(out + '/files.json', JSON.stringify(map));
console.log(Object.keys(manifest).length + ' files; unknown mime: ' +
  [...new Set(Object.values(map).filter(m => m.mime === 'application/octet-stream').map(m => extname(m.path)))].join(' '));
