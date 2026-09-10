// Owner dashboard API. Everything except first-run setup and sign-in requires being signed in.
const db = require("../lib/db");
const settings = require("../lib/settings");
const auth = require("../lib/auth");
const mail = require("../lib/mailer");
const site = require("../lib/site");
const { adminView } = require("../lib/views");
const { isDate, isTimezone, addDays, toMin, nowLocal, fmtTime, fmtDate } = require("../lib/availability");
const { HttpError, send, readJson, clientIp, isHttps, originOf, text, int, num, email, rateLimit, route } = require("../lib/http");

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function requireAdmin(req) {
  if (!auth.isAdmin(req)) throw new HttpError(401, "Please sign in.");
}

// Remember the site's public address the first time the owner signs in (used for links in emails).
function rememberSiteUrl(req) {
  const biz = settings.business();
  if (!biz.siteUrl && req.headers.host) settings.saveBusiness({ ...biz, siteUrl: originOf(req) });
}

function checkNewPassword(password, confirm) {
  if (typeof password !== "string" || password.length < 8) throw new HttpError(400, "Please choose a password with at least 8 characters.");
  if (password.length > 200) throw new HttpError(400, "That password is too long.");
  if (confirm !== undefined && password !== confirm) throw new HttpError(400, "The two passwords don't match.");
}

// ---------------------------------------------------------------- sign in & first-run setup
route("GET", /^\/api\/admin\/me$/, (req, res) => {
  const biz = settings.business();
  send(res, 200, { needsSetup: !auth.hasPassword(), authed: auth.isAdmin(req), business: biz.name, timezone: biz.timezone });
});

route("POST", /^\/api\/admin\/setup$/, async (req, res) => {
  if (auth.hasPassword()) throw new HttpError(409, "This website is already set up. Please sign in.");
  const body = await readJson(req);
  checkNewPassword(body.password, body.confirm);
  const biz = settings.business();
  const next = {
    ...biz,
    name: text(body.name, 120, "your business name"),
    phone: text(body.phone, 30, "Phone", { required: false }),
    email: email(body.email, "email address", { required: false }),
    timezone: isTimezone(body.timezone) ? body.timezone : biz.timezone,
    siteUrl: biz.siteUrl || originOf(req),
  };
  if (auth.hasPassword()) throw new HttpError(409, "This website is already set up. Please sign in.");
  settings.saveBusiness(next);
  auth.setPassword(body.password);
  send(res, 200, { ok: true }, { "Set-Cookie": auth.sessionCookie(isHttps(req)) });
});

route("POST", /^\/api\/admin\/login$/, async (req, res) => {
  const ip = clientIp(req);
  if (!auth.hasPassword()) throw new HttpError(409, "Let's create your password first.");
  if (!auth.loginAllowed(ip)) throw new HttpError(429, "Too many attempts. Please wait 15 minutes and try again.");
  const { password } = await readJson(req);
  if (!auth.checkPassword(ip, password)) throw new HttpError(401, "That password isn't right.");
  rememberSiteUrl(req);
  send(res, 200, { ok: true }, { "Set-Cookie": auth.sessionCookie(isHttps(req)) });
});

route("POST", /^\/api\/admin\/logout$/, (req, res) => {
  send(res, 200, { ok: true }, { "Set-Cookie": auth.clearCookie() });
});

// What's left to set up, shown as a checklist on the dashboard.
route("GET", /^\/api\/admin\/overview$/, (req, res) => {
  requireAdmin(req);
  rememberSiteUrl(req);
  const biz = settings.business();
  const progress = settings.progress();
  const emailCfg = settings.email();
  send(res, 200, {
    siteUrl: biz.siteUrl || originOf(req),
    checklist: [
      { id: "business", label: "Add your phone number and email", done: Boolean(biz.phone && biz.email), tab: "business" },
      { id: "hours", label: "Set your working hours", done: Boolean(progress.hoursSaved), tab: "schedule" },
      { id: "services", label: "Check your services and prices", done: Boolean(progress.servicesSaved), tab: "services" },
      { id: "email", label: "Turn on email notifications", done: Boolean(emailCfg.enabled && emailCfg.tested), tab: "email" },
    ],
  });
});

// ---------------------------------------------------------------- bookings
route("GET", /^\/api\/admin\/bookings$/, (req, res, _, url) => {
  requireAdmin(req);
  const today = nowLocal().date;
  const from = isDate(url.searchParams.get("from")) ? url.searchParams.get("from") : today;
  const to = isDate(url.searchParams.get("to")) ? url.searchParams.get("to") : addDays(from, 60);
  send(res, 200, { from, to, today, bookings: db.bookingsBetween(from, to).map(adminView) });
});

route("POST", /^\/api\/admin\/bookings\/(\d+)\/status$/, async (req, res, [id]) => {
  requireAdmin(req);
  const { status, notify } = await readJson(req);
  if (!["confirmed", "cancelled", "completed"].includes(status)) throw new HttpError(400, "Bad status.");
  const b = db.bookingById(Number(id));
  if (!b) throw new HttpError(404, "Booking not found.");
  if (status === "confirmed" && b.status === "cancelled") {
    const overlapping = db.activeBookingsOn(b.date).filter((o) => o.start_min < b.end_min && o.end_min > b.start_min);
    if (overlapping.length >= db.getSchedule().capacity) throw new HttpError(409, "Another booking now overlaps this time.");
  }
  db.setStatus(b.id, status);
  const updated = db.bookingById(b.id);
  if (status === "cancelled" && notify) mail.bookingCancelled(updated, false);
  send(res, 200, adminView(updated));
});

// Every booking ever, as a spreadsheet (opens in Excel / Google Sheets).
route("GET", /^\/api\/admin\/export\.csv$/, (req, res) => {
  requireAdmin(req);
  const cols = ["id", "status", "date", "timeLabel", "serviceName", "frequencyName", "bedrooms", "bathrooms",
    "addonNames", "price", "name", "email", "phone", "address", "notes", "created_at"];
  const cell = (v) => {
    let s = String(Array.isArray(v) ? v.join("; ") : v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = db.bookingsBetween("0000-01-01", "9999-12-31").map(adminView);
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
  send(res, 200, "\uFEFF" + csv, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="bookings.csv"',
  });
});

// ---------------------------------------------------------------- schedule: hours, rules, time off
route("GET", /^\/api\/admin\/settings$/, (req, res) => {
  requireAdmin(req);
  send(res, 200, db.getSchedule());
});

route("PUT", /^\/api\/admin\/settings$/, async (req, res) => {
  requireAdmin(req);
  const body = await readJson(req);
  const hours = {};
  for (let d = 0; d <= 6; d++) {
    const h = body.hours && body.hours[d];
    if (!h) { hours[d] = null; continue; }
    if (!TIME_RE.test(h.start) || !TIME_RE.test(h.end) || toMin(h.start) >= toMin(h.end)) {
      throw new HttpError(400, "Each open day needs a start time before its end time.");
    }
    hours[d] = { start: h.start, end: h.end };
  }
  const schedule = {
    hours,
    slotInterval: int(body.slotInterval, 15, 120, "Start-time spacing"),
    bufferMinutes: int(body.bufferMinutes, 0, 240, "Travel time"),
    minNoticeHours: int(body.minNoticeHours, 0, 720, "Minimum notice"),
    maxDaysAhead: int(body.maxDaysAhead, 1, 365, "Booking window"),
    cancelCutoffHours: int(body.cancelCutoffHours, 0, 720, "Cancellation cutoff"),
    capacity: int(body.capacity, 1, 20, "Jobs at the same time"),
  };
  db.saveSchedule(schedule);
  settings.markProgress("hoursSaved");
  send(res, 200, schedule);
});

route("GET", /^\/api\/admin\/blocks$/, (req, res) => {
  requireAdmin(req);
  const blocks = db.blocksFrom(nowLocal().date).map((b) => ({
    ...b,
    dateLabel: fmtDate(b.date),
    timeLabel: b.start_min === 0 && b.end_min === 1440 ? "All day" : `${fmtTime(b.start_min)} – ${fmtTime(b.end_min)}`,
  }));
  send(res, 200, { blocks });
});

// Block off time: one day or a range of days (vacation), all day or part of the day.
route("POST", /^\/api\/admin\/blocks$/, async (req, res) => {
  requireAdmin(req);
  const body = await readJson(req);
  if (!isDate(body.date)) throw new HttpError(400, "Pick a date.");
  const endDate = isDate(body.endDate) ? body.endDate : body.date;
  if (endDate < body.date) throw new HttpError(400, "The end date is before the start date.");
  let start = 0;
  let end = 1440;
  if (!body.allDay) {
    if (!TIME_RE.test(body.start) || !TIME_RE.test(body.end)) throw new HttpError(400, "Pick a start and end time.");
    start = toMin(body.start);
    end = toMin(body.end);
    if (start >= end) throw new HttpError(400, "The start time must be before the end time.");
  }
  const reason = text(body.reason, 200, "Note", { required: false });
  let count = 0;
  for (let d = body.date; d <= endDate; d = addDays(d, 1)) {
    if (++count > 366) throw new HttpError(400, "Please block at most a year at a time.");
    db.addBlock(d, start, end, reason);
  }
  send(res, 201, { ok: true, days: count });
});

route("DELETE", /^\/api\/admin\/blocks\/(\d+)$/, (req, res, [id]) => {
  requireAdmin(req);
  db.deleteBlock(Number(id));
  send(res, 200, { ok: true });
});

// ---------------------------------------------------------------- business info
route("GET", /^\/api\/admin\/business$/, (req, res) => {
  requireAdmin(req);
  send(res, 200, settings.business());
});

route("PUT", /^\/api\/admin\/business$/, async (req, res) => {
  requireAdmin(req);
  const body = await readJson(req);
  if (!isTimezone(body.timezone)) throw new HttpError(400, "Please choose your timezone.");
  const area = (Array.isArray(body.area) ? body.area : String(body.area || "").split(","))
    .map((a) => String(a).trim()).filter(Boolean);
  if (area.length > 40 || area.some((a) => a.length > 60)) throw new HttpError(400, "The list of towns is too long.");
  const siteUrl = text(body.siteUrl, 200, "Website address", { required: false }).replace(/\/+$/, "");
  if (siteUrl && !/^https?:\/\/[^\s/]+$/.test(siteUrl)) throw new HttpError(400, "The website address should look like https://yourwebsite.com");
  const next = {
    ...settings.business(),
    name: text(body.name, 120, "your business name"),
    phone: text(body.phone, 30, "Phone", { required: false }),
    email: email(body.email, "email address", { required: false }),
    notifyEmail: email(body.notifyEmail, "booking alert email", { required: false }),
    area,
    timezone: body.timezone,
    siteUrl,
  };
  settings.saveBusiness(next);
  send(res, 200, next);
});

// ---------------------------------------------------------------- services & prices
const ID_RE = /^[a-z0-9-]{1,40}$/;
const PHOTO_RE = /^\/(images|uploads)\/[\w.-]+\.(jpg|jpeg|png|webp)$/;
const slug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "item";

function uniqueId(wanted, name, taken) {
  let id = typeof wanted === "string" && ID_RE.test(wanted) ? wanted : slug(name);
  while (taken.has(id)) id = `${slug(name)}-${Math.random().toString(36).slice(2, 6)}`;
  taken.add(id);
  return id;
}

route("GET", /^\/api\/admin\/catalog$/, (req, res) => {
  requireAdmin(req);
  const cat = settings.catalog();
  const bookingCounts = Object.fromEntries(cat.services.map((s) => [s.id, db.countBookingsForService(s.id)]));
  send(res, 200, { ...cat, bookingCounts });
});

route("PUT", /^\/api\/admin\/catalog$/, async (req, res) => {
  requireAdmin(req);
  const body = await readJson(req, 200_000);
  const current = settings.catalog();
  if (!Array.isArray(body.services) || !body.services.length) throw new HttpError(400, "Please keep at least one service.");
  if (body.services.length > 30) throw new HttpError(400, "That's too many services.");

  const serviceIds = new Set();
  const services = body.services.map((s, i) => {
    const name = text(s.name, 80, `the name of service ${i + 1}`);
    const consultation = Boolean(s.consultation);
    const photo = typeof s.photo === "string" && PHOTO_RE.test(s.photo) ? s.photo : "";
    return {
      id: uniqueId(s.id, name, serviceIds),
      name,
      visible: s.visible !== false,
      recurring: !consultation && Boolean(s.recurring),
      consultation,
      description: text(s.description, 400, `${name}'s description`, { required: false }),
      photo,
      base: int(s.base ?? 0, 0, 100000, `${name}'s starting price`),
      perBed: int(s.perBed ?? 0, 0, 10000, `${name}'s price per extra bedroom`),
      perBath: int(s.perBath ?? 0, 0, 10000, `${name}'s price per extra bathroom`),
      baseMinutes: int(s.baseMinutes, 15, 1440, `${name}'s time (minutes)`),
      perBedMinutes: int(s.perBedMinutes ?? 0, 0, 600, `${name}'s extra time per bedroom`),
      perBathMinutes: int(s.perBathMinutes ?? 0, 0, 600, `${name}'s extra time per bathroom`),
    };
  });

  const removed = current.services.filter((s) => !serviceIds.has(s.id) && db.countBookingsForService(s.id) > 0);
  if (removed.length) {
    throw new HttpError(409, `"${removed[0].name}" already has bookings, so it can't be deleted. Turn off "Show on website" instead.`);
  }

  const addonIds = new Set();
  const addons = (Array.isArray(body.addons) ? body.addons : []).slice(0, 30).map((a, i) => {
    const name = text(a.name, 60, `the name of add-on ${i + 1}`);
    return {
      id: uniqueId(a.id, name, addonIds),
      name,
      price: int(a.price ?? 0, 0, 10000, `${name}'s price`),
      minutes: int(a.minutes ?? 0, 0, 600, `${name}'s extra time`),
    };
  });

  const discounts = Object.fromEntries((Array.isArray(body.frequencies) ? body.frequencies : []).map((f) => [f.id, f.discount]));
  const frequencies = current.frequencies.map((f) => ({
    ...f,
    discount: f.id === "once" ? 0 : num(discounts[f.id] ?? f.discount, 0, 0.9, `The ${f.name.toLowerCase()} discount`),
  }));

  const next = {
    ...current,
    services, addons, frequencies,
    pricingNote: text(body.pricingNote, 300, "Pricing note", { required: false }),
    maxBedrooms: int(body.maxBedrooms ?? current.maxBedrooms, 1, 20, "Most bedrooms"),
    maxBathrooms: int(body.maxBathrooms ?? current.maxBathrooms, 1, 20, "Most bathrooms"),
  };
  settings.saveCatalog(next);
  settings.markProgress("servicesSaved");
  send(res, 200, next);
});

route("POST", /^\/api\/admin\/upload$/, async (req, res) => {
  requireAdmin(req);
  const { dataUrl } = await readJson(req, 8 * 1024 * 1024);
  send(res, 201, { url: site.saveUpload(dataUrl) });
});

// ---------------------------------------------------------------- website content (reviews)
route("GET", /^\/api\/admin\/content$/, (req, res) => {
  requireAdmin(req);
  send(res, 200, settings.content());
});

route("PUT", /^\/api\/admin\/content$/, async (req, res) => {
  requireAdmin(req);
  const body = await readJson(req, 100_000);
  const current = settings.content();
  const next = { ...current };
  if (Array.isArray(body.reviews)) {
    next.reviews = body.reviews.slice(0, 50).map((r, i) => ({
      name: text(r.name, 80, `the name on review ${i + 1}`),
      label: text(r.label, 80, "Label", { required: false }),
      text: text(r.text, 1000, `the words of review ${i + 1}`),
    }));
  }
  if (Array.isArray(body.faq)) {
    next.faq = body.faq.slice(0, 40).map((item, i) => ({
      q: text(item.q, 200, `question ${i + 1}`),
      a: text(item.a, 1500, `the answer to question ${i + 1}`),
    }));
  }
  settings.saveContent(next);
  send(res, 200, next);
});

// ---------------------------------------------------------------- email notifications
function emailView() {
  const e = settings.email();
  const biz = settings.business();
  return {
    enabled: Boolean(e.enabled), tested: Boolean(e.tested), provider: e.provider, host: e.host, port: e.port,
    user: e.user, hasPassword: Boolean(e.pass), available: mail.available(),
    alertsGoTo: biz.notifyEmail || biz.email || e.user || "",
    providers: Object.fromEntries(Object.entries(mail.PROVIDERS).map(([id, p]) => [id, p.label])),
  };
}

function emailFromBody(body) {
  const current = settings.email();
  const provider = mail.PROVIDERS[body.provider] ? body.provider : "other";
  const user = email(body.user, "email address");
  let pass = typeof body.pass === "string" ? body.pass.trim() : "";
  if (pass && provider !== "other") pass = pass.replace(/\s+/g, ""); // app passwords are shown with spaces
  if (!pass && current.user === user) pass = current.pass;            // keep the saved one
  if (!pass) throw new HttpError(400, "Please paste your app password.");
  const cfg = { enabled: true, tested: false, provider, user, pass, host: "", port: 587 };
  if (provider === "other") {
    cfg.host = text(body.host, 200, "the email server name");
    cfg.port = int(body.port, 1, 65535, "Port");
  }
  return cfg;
}

route("GET", /^\/api\/admin\/email$/, (req, res) => {
  requireAdmin(req);
  send(res, 200, emailView());
});

// Sends a test email with the details entered; saves them only if it works.
route("POST", /^\/api\/admin\/email\/test$/, async (req, res) => {
  requireAdmin(req);
  rateLimit("emailtest:" + clientIp(req), 10, 10 * 60 * 1000);
  if (!mail.available()) throw new HttpError(503, "Email support isn't installed on this server. Restart the website and try again.");
  const cfg = emailFromBody(await readJson(req));
  const biz = settings.business();
  const to = biz.notifyEmail || biz.email || cfg.user;
  try {
    await mail.sendTest(cfg, to);
  } catch (err) {
    throw new HttpError(400, err.message);
  }
  settings.saveEmail({ ...cfg, tested: true });
  send(res, 200, { ...emailView(), sentTo: to });
});

route("POST", /^\/api\/admin\/email\/disable$/, (req, res) => {
  requireAdmin(req);
  settings.saveEmail({ ...settings.email(), enabled: false });
  send(res, 200, emailView());
});

// ---------------------------------------------------------------- password
route("PUT", /^\/api\/admin\/password$/, async (req, res) => {
  requireAdmin(req);
  const body = await readJson(req);
  if (!auth.verify(body.current)) throw new HttpError(400, "Your current password isn't right.");
  checkNewPassword(body.next, body.confirm);
  auth.setPassword(body.next);
  // Changing the password signs out every other device; give this one a fresh session.
  send(res, 200, { ok: true }, { "Set-Cookie": auth.sessionCookie(isHttps(req)) });
});
