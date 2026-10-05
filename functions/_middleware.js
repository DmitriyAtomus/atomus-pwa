// Cloudflare Pages equivalent of vercel.json rewrites/headers.
// Runs only for paths listed in /_routes.json (keeps static assets free of Functions quota).
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
  const req = new Request(target.toString(), request);
  req.headers.set('X-Forwarded-Host', url.host);
  req.headers.set('X-Forwarded-Proto', 'https');
  return withRobots(await fetch(req));
}

export async function onRequest(ctx) {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const p = url.pathname;

  // /api/*, /static/* -> API (no such dirs in the repo)
  if (p === '/api' || p.startsWith('/api/') || p.startsWith('/static/')) {
    return proxy(request, url);
  }

  // /kp/*: static file from repo first (like Vercel filesystem precedence), else API (KP share links /kp/<token>)
  if (p.startsWith('/kp/')) {
    if (request.method === 'GET' || request.method === 'HEAD') {
      const asset = await ctx.next();
      if (asset.status !== 404) return withRobots(asset);
    }
    return proxy(request, url);
  }

  // Token / feedback deep links -> index.html (SPA)
  if (SPA_ROUTES.test(p)) {
    const idx = await env.ASSETS.fetch(new Request(new URL('/', url).toString(), { headers: request.headers }));
    return withRobots(idx);
  }

  return withRobots(await ctx.next());
}
