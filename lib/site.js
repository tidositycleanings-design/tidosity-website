// Serves the website's files, and fills the homepage with the owner's current
// settings (phone, email, hours, towns, services, prices) on every request.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const db = require("./db");
const settings = require("./settings");
const { HttpError, send } = require("./http");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const UPLOAD_DIR = path.join(db.dataDir, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".pdf": "application/pdf",
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n) => "$" + Number(n).toLocaleString("en-US");
const telHref = (phone) => "tel:" + String(phone || "").replace(/[^\d+]/g, "");

// "08:00" -> "8am", "17:30" -> "5:30pm"
function shortTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""}${h >= 12 ? "pm" : "am"}`;
}

// Groups days with the same hours, e.g. ["Monday to Friday", "8am to 5pm"].
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function hoursRows(hours) {
  const value = (d) => (hours[d] ? `${shortTime(hours[d].start)} to ${shortTime(hours[d].end)}` : "Closed");
  const groups = [];
  for (const d of [1, 2, 3, 4, 5, 6, 0]) {
    const last = groups[groups.length - 1];
    if (last && last.value === value(d)) last.days.push(d);
    else groups.push({ days: [d], value: value(d) });
  }
  return groups.map(({ days, value: v }) => {
    const a = DAYS[days[0]];
    const b = DAYS[days[days.length - 1]];
    return [days.length === 1 ? a : `${a} ${days.length === 2 ? "and" : "to"} ${b}`, v];
  });
}

function serviceCards(cat) {
  const cards = cat.services.filter((s) => s.visible !== false).map((s) => `
        <article class="service-card has-photo" data-reveal>
          ${s.photo ? `<img class="service-photo" src="${esc(s.photo)}" alt="" loading="lazy">` : ""}
          <div class="service-body">
            <h3>${esc(s.name)}</h3>
            ${s.description ? `<p>${esc(s.description)}</p>` : ""}
            <p class="service-price" data-price-for="${esc(s.id)}">${s.consultation ? "Free consultation" : `Starting at <strong>${money(s.base)}</strong>`}</p>
            <a class="service-link" href="#book" data-book-service="${esc(s.id)}">${s.consultation ? "Book a consultation" : "Book this clean"}</a>
          </div>
        </article>`);
  if (cat.pricingNote) {
    cards.push(`
        <article class="service-card service-card--accent" data-reveal>
          <div class="service-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M14.8 9.2c-.5-.8-1.5-1.2-2.8-1.2-1.7 0-2.8.8-2.8 2s1 1.7 2.8 2 2.8.9 2.8 2.1-1.2 2-2.8 2c-1.4 0-2.4-.5-2.9-1.3"/></svg></div>
          <h3>How pricing works</h3>
          <p>${esc(cat.pricingNote)}</p>
          <p>Pick your service and home size below to see your estimate instantly.</p>
          <a class="btn btn-primary service-cta" href="#book">See my price</a>
        </article>`);
  }
  return cards.join("");
}

let template = { mtime: 0, html: "" };
function homeTemplate() {
  const file = path.join(PUBLIC_DIR, "index.html");
  const { mtimeMs } = fs.statSync(file);
  if (mtimeMs !== template.mtime) template = { mtime: mtimeMs, html: fs.readFileSync(file, "utf8") };
  return template.html;
}

function renderHome() {
  const biz = settings.business();
  const cat = settings.catalog();
  const area = biz.area || [];
  const reviews = settings.content().reviews || [];
  const faq = settings.content().faq || [];
  const text = {
    name: esc(biz.name),
    phone: esc(biz.phone),
    phoneHref: esc(telHref(biz.phone)),
    email: esc(biz.email),
    emailHref: esc("mailto:" + biz.email),
    year: String(new Date().getFullYear()),
    bodyClass: [!biz.phone && "no-phone", !biz.email && "no-email", !area.length && "no-area",
      !reviews.length && "no-reviews", !faq.length && "no-faq"].filter(Boolean).join(" "),
  };
  const blocks = {
    services: serviceCards(cat),
    faq: faq.map((item) => `
        <details class="faq-item">
          <summary>${esc(item.q)}</summary>
          <p>${esc(item.a)}</p>
        </details>`).join(""),
    reviews: reviews.map((r) => `
        <figure class="review" data-reveal>
          <blockquote>&ldquo;${esc(r.text)}&rdquo;</blockquote>
          <figcaption><strong>${esc(r.name)}</strong>${r.label ? `<span>${esc(r.label)}</span>` : ""}</figcaption>
        </figure>`).join(""),
    hours: hoursRows(db.getSchedule().hours).map(([d, v]) => `<div><dt>${esc(d)}</dt><dd>${esc(v)}</dd></div>`).join(""),
    area: area.map((a) => `<li>${esc(a)}</li>`).join(""),
    jsonLd: JSON.stringify({
      "@context": "https://schema.org", "@type": "HouseCleaning", name: biz.name,
      telephone: biz.phone || undefined, email: biz.email || undefined, url: biz.siteUrl || undefined,
      areaServed: area.length ? area : undefined, priceRange: "$$",
    }).replace(/</g, "\\u003c"),
  };
  // Plain tokens first, then blocks, so text typed by the owner is never re-processed.
  return homeTemplate()
    .replace(/\{\{(\w+)\}\}/g, (m, k) => (k in text ? text[k] : m))
    .replace(/<!--@(\w+)-->/g, (m, k) => (k in blocks ? blocks[k] : m));
}

// Saves a photo uploaded from the dashboard (sent as a data: URL) and returns its web path.
function saveUpload(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === "string" ? dataUrl : "");
  if (!m) throw new HttpError(400, "Please choose a JPG, PNG, or WebP photo.");
  const buf = Buffer.from(m[2], "base64");
  const magic = { jpeg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47], webp: [0x52, 0x49, 0x46, 0x46] }[m[1]];
  if (!magic.every((byte, i) => buf[i] === byte)) throw new HttpError(400, "That file doesn't look like a photo.");
  const name = crypto.randomBytes(12).toString("hex") + (m[1] === "jpeg" ? ".jpg" : "." + m[1]);
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return "/uploads/" + name;
}

function sendFile(req, res, file, cache) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, "Page not found");
    const lastModified = stat.mtime.toUTCString();
    if (req.headers["if-modified-since"] === lastModified) {
      res.writeHead(304, { "Cache-Control": cache, "Last-Modified": lastModified });
      return res.end();
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": cache,
      "Last-Modified": lastModified,
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function serveStatic(req, res, url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return send(res, 400, "Bad request"); }

  if (pathname === "/" || pathname === "/index.html") {
    const html = renderHome();
    res.writeHead(200, { "Content-Type": TYPES[".html"], "Cache-Control": "no-cache" });
    return res.end(req.method === "HEAD" ? undefined : html);
  }

  const upload = /^\/uploads\/([a-f0-9]{24}\.(?:jpg|png|webp))$/.exec(pathname);
  if (upload) return sendFile(req, res, path.join(UPLOAD_DIR, upload[1]), "public, max-age=31536000, immutable");

  if (pathname.endsWith("/")) pathname += "index.html";
  let file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, "Forbidden");
  if (!path.extname(file) && fs.existsSync(file + ".html")) file += ".html"; // /admin -> admin.html
  // Pages, styles, and scripts are re-checked on every visit so updates show up right away.
  const cache = [".html", ".css", ".js"].includes(path.extname(file).toLowerCase()) ? "no-cache" : "public, max-age=86400";
  sendFile(req, res, file, cache);
}

module.exports = { serveStatic, saveUpload, hoursRows };
