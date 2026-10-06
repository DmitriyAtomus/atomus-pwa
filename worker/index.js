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

async function proxy(request, url) {
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
  }
  return r;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

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

    // Token / feedback deep links -> index.html (SPA)
    if (SPA_ROUTES.test(p)) {
      const idx = await env.ASSETS.fetch(new Request(new URL('/', url).toString(), { headers: request.headers }));
      return withRobots(idx);
    }

    return withRobots(await env.ASSETS.fetch(request));
  },
};
