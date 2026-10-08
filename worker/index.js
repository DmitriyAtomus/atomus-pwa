// Atomus CRM frontend on Cloudflare Workers (static assets + API proxy).
// Port of functions/_middleware.js (Cloudflare Pages) / vercel.json rewrites.
// Only paths listed in assets.run_worker_first (wrangler.jsonc) reach this code;
// everything else is served directly from static assets (with _headers applied).
const API_ORIGIN = 'https://api.atomuscrm.ru';
const SPA_ROUTES = /^\/(a|b|c|d|u|dev)\/[^/]+\/?$|^\/feedback\/?$/;
const ROBOTS = 'noindex, nofollow, noarchive';

function withRobots(resp) {
  const r = new Response(resp.body, resp);
  r.headers.set('X-Robots-Tag', ROBOTS);
  return r;
}

const CORS_ALLOW_HEADERS = 'Content-Type, Authorization, X-Requested-With, X-Guest-Token, X-Atomus-Section';

function applyApiCors(r) {
  // Backend Allow-Headers omits X-Atomus-Section; rewrite so browser/proxy clients are fine.
  r.headers.set('Access-Control-Allow-Origin', '*');
  r.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
  r.headers.set('Access-Control-Max-Age', '86400');
  return r;
}

async function proxy(request, url) {
  // Short-circuit preflight so X-Atomus-Section is always allowed on /api.
  if (request.method === 'OPTIONS' && (url.pathname === '/api' || url.pathname.startsWith('/api/'))) {
    return applyApiCors(withRobots(new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })));
  }
  const target = new URL(url.pathname + url.search, API_ORIGIN);
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('X-Forwarded-Host', url.host);
  headers.set('X-Forwarded-Proto', 'https');
  const hasBody = !['GET', 'HEAD'].includes(request.method);
  const resp = await fetch(target.toString(), {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: 'manual',
  });
  const r = withRobots(resp);
  // API data must never be cached by browsers/CDN.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    if (!r.headers.has('Cache-Control')) r.headers.set('Cache-Control', 'no-store');
    applyApiCors(r);
  }
  return r;
}

// Sentry tunnel (v2.46.244): the browser SDK posts envelopes to /sentry-tunnel,
// we forward them to Sentry ingest. Only our org/projects are accepted.
const SENTRY_HOST = 'o4512209219616768.ingest.de.sentry.io';
const SENTRY_PROJECTS = new Set(['4512209395843152']); // atomus-crm-frontend

async function sentryTunnel(request) {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const body = await request.arrayBuffer();
  if (body.byteLength > 1024 * 1024) return new Response('Payload Too Large', { status: 413 });
  const head = new TextDecoder().decode(body.slice(0, Math.min(body.byteLength, 4096))).split('\n')[0];
  let dsn;
  try { dsn = new URL(JSON.parse(head).dsn); } catch (e) { return new Response('Bad envelope', { status: 400 }); }
  const projectId = dsn.pathname.replace(/^\/+|\/+$/g, '');
  if (dsn.hostname !== SENTRY_HOST || !SENTRY_PROJECTS.has(projectId)) {
    return new Response('Forbidden', { status: 403 });
  }
  const resp = await fetch(`https://${SENTRY_HOST}/api/${projectId}/envelope/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-sentry-envelope' },
    body,
  });
  return new Response(resp.body, {
    status: resp.status,
    headers: { 'Content-Type': resp.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': ROBOTS },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

    if (p === '/sentry-tunnel') return sentryTunnel(request);

    // /api/*, /static/* -> API (no such dirs in the repo)
    if (p === '/api' || p.startsWith('/api/') || p.startsWith('/static/')) {
      return proxy(request, url);
    }

    // /kp/*: static file from repo first, else API (KP share links /kp/<token>)
    if (p.startsWith('/kp/')) {
      if (request.method === 'GET' || request.method === 'HEAD') {
        const asset = await env.ASSETS.fetch(request);
        if (asset.status !== 404) return withRobots(asset);
      }
      return proxy(request, url);
    }

    // /index.html: serve the root document directly (no 307 to "/"), like Vercel did.
    // sw.js precaches '/index.html' and uses it as the offline navigation fallback;
    // a redirected cached response would be rejected for navigations.
    if (p === '/index.html') {
      const idx = await env.ASSETS.fetch(new Request(new URL('/', url).toString(), { method: request.method, headers: request.headers }));
      return withRobots(idx);
    }

    // Token / feedback deep links -> index.html (SPA)
    if (SPA_ROUTES.test(p)) {
      const idx = await env.ASSETS.fetch(new Request(new URL('/', url).toString(), { headers: request.headers }));
      return withRobots(idx);
    }

    return withRobots(await env.ASSETS.fetch(request));
  },
};
