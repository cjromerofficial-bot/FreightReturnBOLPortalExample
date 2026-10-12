// Shared request plumbing: auth gate, rate limit, JSON helpers, safe logging.
import crypto from 'node:crypto';

const mode = (k) => (process.env[k] || process.env.APP_MODE || 'mock').toLowerCase();
/** True if EITHER system is mocked (data is not fully real): watermark, banner, open local access. */
export const isMock = () => mode('NETSUITE_MODE') !== 'live' || mode('RL_MODE') !== 'live';
export const nsLive = () => mode('NETSUITE_MODE') === 'live';
export const rlLive = () => mode('RL_MODE') === 'live';
export const rlSandbox = () => /apisandbox.rlc.com/.test(process.env.RL_BASE_URL || '');

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** Error a rep can act on. `detail` is logged server-side only. */
export class RepError extends Error {
  constructor(message, status = 400, detail, extra = {}) {
    super(message);
    this.status = status;
    this.detail = detail;
    this.extra = extra;
  }
}

const SECRET_KEYS = /key|secret|token|password|authorization|signature/i;
function redact(v) {
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEYS.test(k) ? '[redacted]' : redact(x)]));
}
export const logTech = (where, err, ctx = {}) =>
  console.error(JSON.stringify({ where, error: String(err?.stack || err), detail: redact(err?.detail), ...redact(ctx) }));

// ---- sign-in
// AUTH_MODE=hub (default): Acme's hub (hub.example.com) signs users in and proxies/frames this app.
//   The container must then only be reachable through the hub.
// AUTH_MODE=password: the portal's own shared-password gate (signed cookie).
export const authMode = () => ((process.env.AUTH_MODE || 'hub').toLowerCase() === 'password' ? 'password' : 'hub');

/** Signed-in user's name forwarded by the hub, if TRUSTED_USER_HEADER is configured. */
export function trustedUser(req) {
  const h = process.env.TRUSTED_USER_HEADER;
  return h && authMode() === 'hub' ? String(req.headers.get(h) || '').trim().slice(0, 60) : '';
}
const COOKIE = 'rep_session';
const sign = (v) => crypto.createHmac('sha256', process.env.SESSION_SECRET || 'mock-only-secret').update(v).digest('hex');

export function sessionCookie() {
  const exp = String(Date.now() + 12 * 3600 * 1000);
  return `${COOKIE}=${exp}.${sign(exp)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=43200`; // None: works inside the hub's frame
}

export function checkPassword(given) {
  const want = process.env.SITE_PASSWORD || '';
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(want);
  return want.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authorized(req) {
  if (authMode() === 'hub') return true;
  if (!process.env.SITE_PASSWORD) {
    // Mock mode may run open for local testing; live mode never does.
    return isMock();
  }
  const m = (req.headers.get('cookie') || '').match(new RegExp(`${COOKIE}=(\\d+)\\.([a-f0-9]+)`));
  if (!m) return false;
  const [, exp, sig] = m;
  const good = Buffer.from(sign(exp));
  return Number(exp) > Date.now() && sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), good);
}

// ---- basic per-client rate limit (per function instance; enough to stop runaway loops)
const hits = new Map();
function rateLimited(req, limit = 60) {
  const ip = String(req.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > limit;
}

/** Wrap a handler with auth, rate limit and plain-English error handling. */
export function handler(fn, { limit = 60, auth = true } = {}) {
  return async (req, context) => {
    try {
      if (rateLimited(req, limit)) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429);
      if (auth && !authorized(req)) return json({ error: 'Please sign in.', needsLogin: true }, 401);
      return await fn(req, context);
    } catch (err) {
      if (err instanceof RepError) {
        if (err.detail) logTech(new URL(req.url).pathname, err);
        return json({ error: err.message, ...err.extra }, err.status);
      }
      logTech(new URL(req.url).pathname, err);
      return json({ error: 'Something went wrong on our side. Try again, and if it keeps happening tell the portal admin.' }, 500);
    }
  };
}

export async function readJson(req) {
  try { return await req.json(); } catch { throw new RepError('The request was not readable. Refresh the page and try again.'); }
}

export function repNameFrom(body, req) {
  const name = (req && trustedUser(req)) || String(body?.repName || '').trim().slice(0, 60);
  if (!name) throw new RepError('Type your name at the top of the page first. It goes on the documents.');
  return name;
}
