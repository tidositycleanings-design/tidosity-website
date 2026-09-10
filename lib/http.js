// Small HTTP helpers shared by the routes: responses, JSON bodies, validation, routing.
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || "") || Boolean(process.env.RENDER);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body, headers = {}) {
  const json = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, {
    "Content-Type": json ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(json ? JSON.stringify(body) : body);
}

function readJson(req, limit = 20_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, "That's too large to upload.")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch { reject(new HttpError(400, "Invalid request.")); }
    });
    req.on("error", reject);
  });
}

const clientIp = (req) =>
  (TRUST_PROXY && req.headers["x-forwarded-for"]?.split(",")[0].trim()) || req.socket.remoteAddress || "";
const isHttps = (req) =>
  (TRUST_PROXY && req.headers["x-forwarded-proto"] === "https") || Boolean(req.socket.encrypted);
const originOf = (req) => `${isHttps(req) ? "https" : "http"}://${req.headers.host}`;

// ---- validation
function text(value, max, label, { required = true } = {}) {
  const s = typeof value === "string" ? value.trim() : "";
  if (required && !s) throw new HttpError(400, `Please fill in ${label}.`);
  if (s.length > max) throw new HttpError(400, `${label} is too long.`);
  return s;
}

function int(value, min, max, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} must be a whole number between ${min} and ${max}.`);
  return n;
}

function num(value, min, max, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label} must be between ${min} and ${max}.`);
  return n;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function email(value, label, { required = true } = {}) {
  const s = text(value, 200, label, { required });
  if (s && !EMAIL_RE.test(s)) throw new HttpError(400, `Please enter a valid ${label}.`);
  return s;
}

// ---- rate limiting (in memory): at most `limit` hits per `windowMs` for each key
const hits = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) return void hits.set(key, { count: 1, reset: now + windowMs });
  if (++h.count > limit) throw new HttpError(429, "Too many requests. Please try again later.");
}
setInterval(() => {
  for (const [k, v] of hits) if (v.reset < Date.now()) hits.delete(k);
}, 10 * 60 * 1000).unref();

// ---- routing
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });
function match(method, pathname) {
  for (const r of routes) {
    const m = r.method === method && pathname.match(r.pattern);
    if (m) return { handler: r.handler, params: m.slice(1) };
  }
  return null;
}

module.exports = {
  HttpError, send, readJson, clientIp, isHttps, originOf,
  text, int, num, email, rateLimit, route, match,
};
