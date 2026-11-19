// A tiny router and request helpers on top of node:http, so the app has zero dependencies.

const MAX_BODY = 256 * 1024;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function parseBody(raw, contentType = '') {
  if (!raw) return {};
  if (contentType.includes('application/json')) {
    try { return JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON'); }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; form-action 'self' https://accounts.google.com; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

export function makeResponder(res) {
  const cookies = [];
  const send = (status, body, type) => {
    if (res.headersSent) return;
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, 'Set-Cookie': cookies, 'Cache-Control': 'no-store' });
    res.end(body);
  };
  return {
    cookie: (c) => cookies.push(c),
    html: (body, status = 200) => send(status, body, 'text/html; charset=utf-8'),
    json: (obj, status = 200) => send(status, JSON.stringify(obj), 'application/json; charset=utf-8'),
    text: (body, status = 200) => send(status, body, 'text/plain; charset=utf-8'),
    xml: (body, status = 200) => send(status, body, 'text/xml; charset=utf-8'),
    calendar: (body) => send(200, body, 'text/calendar; charset=utf-8'),
    script: (body) => send(200, body, 'text/javascript; charset=utf-8'),
    redirect: (location, status = 303) => {
      if (res.headersSent) return;
      res.writeHead(status, { ...SECURITY_HEADERS, Location: location, 'Set-Cookie': cookies });
      res.end();
    },
  };
}

/** Routes like "/incidents/:id/ack". Handlers get (ctx) and return nothing. */
export function makeRouter() {
  const routes = [];
  const add = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler });
  };
  const match = (method, path) => {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (m) return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  };
  return { get: (p, h) => add('GET', p, h), post: (p, h) => add('POST', p, h), match };
}
