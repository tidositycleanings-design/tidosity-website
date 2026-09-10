// Owner login. The password is stored as a salted scrypt hash in the database.
// It's created on the first-run setup screen, or comes from the ADMIN_PASSWORD
// setting on a hosting platform (changing that value there resets the password).
const crypto = require("node:crypto");
const settings = require("./settings");

const COOKIE = "admin_session";
const MAX_AGE = 30 * 24 * 3600; // stay signed in for 30 days
const MAX_FAILS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const attempts = new Map(); // ip -> { count, until }

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 32).toString("hex") };
}

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Sessions are tied to the current password, so changing it signs everyone out.
function sign(expires) {
  const pw = settings.password();
  return crypto.createHmac("sha256", settings.secret()).update(`${expires}:${pw ? pw.hash : ""}`).digest("hex");
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

module.exports = {
  hasPassword: () => Boolean(settings.password()),

  setPassword(password) {
    settings.savePassword(hashPassword(password));
  },

  // Use ADMIN_PASSWORD from the environment when it's new or has been changed.
  applyEnvPassword() {
    const env = process.env.ADMIN_PASSWORD;
    if (!env) return false;
    const fingerprint = crypto.createHash("sha256").update("env:" + env).digest("hex");
    if (settings.readRaw("envPasswordFingerprint") === fingerprint) return false;
    settings.savePassword(hashPassword(env));
    settings.writeRaw("envPasswordFingerprint", fingerprint);
    return true;
  },

  verify(password) {
    const pw = settings.password();
    if (!pw || typeof password !== "string") return false;
    return safeEqual(hashPassword(password, pw.salt).hash, pw.hash);
  },

  loginAllowed(ip) {
    const a = attempts.get(ip);
    return !a || a.until < Date.now() || a.count < MAX_FAILS;
  },

  checkPassword(ip, password) {
    const ok = this.verify(password);
    if (ok) {
      attempts.delete(ip);
    } else {
      const a = attempts.get(ip) || { count: 0, until: 0 };
      if (a.until < Date.now()) a.count = 0;
      a.count += 1;
      a.until = Date.now() + LOCKOUT_MS;
      attempts.set(ip, a);
    }
    return ok;
  },

  sessionCookie(secure) {
    const expires = String(Date.now() + MAX_AGE * 1000);
    return `${COOKIE}=${expires}.${sign(expires)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE}${secure ? "; Secure" : ""}`;
  },

  clearCookie: () => `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,

  isAdmin(req) {
    if (!settings.password()) return false;
    const raw = parseCookies(req)[COOKIE];
    if (!raw) return false;
    const [expires, sig] = raw.split(".");
    if (!expires || !sig || Number(expires) < Date.now()) return false;
    return safeEqual(sig, sign(expires));
  },
};
