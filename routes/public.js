// Public API used by the website: prices, open times, booking, and managing a booking.
const crypto = require("node:crypto");
const db = require("../lib/db");
const settings = require("../lib/settings");
const mail = require("../lib/mailer");
const Pricing = require("../public/js/pricing");
const { publicView, describe } = require("../lib/views");
const { isDate, hoursUntil, nowLocal, fmtTime, fmtDate, slotsFor, monthAvailability } = require("../lib/availability");
const { HttpError, send, readJson, clientIp, text, email, rateLimit, route } = require("../lib/http");

// Services clients can book (hidden ones are left out).
function bookableCatalog() {
  const cat = settings.catalog();
  return { ...cat, services: cat.services.filter((s) => s.visible !== false) };
}

function durationParam(url) {
  const minutes = Number(url.searchParams.get("minutes"));
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 1440) throw new HttpError(400, "Bad duration.");
  return minutes;
}

// ?exclude=<token> lets a client who is rescheduling see times next to their own booking.
function excludeOpts(url) {
  const token = url.searchParams.get("exclude");
  const b = token && db.bookingByToken(token);
  return b ? { ignoreBookingId: b.id } : {};
}

function dateAndStart(body) {
  const start = Number(body.start);
  if (!isDate(body.date) || !Number.isInteger(start) || start < 0 || start >= 1440) {
    throw new HttpError(400, "Please pick a date and time.");
  }
  return { date: body.date, start };
}

function findByToken(token) {
  const b = db.bookingByToken(token);
  if (!b) throw new HttpError(404, "Booking not found.");
  return b;
}

function assertChangeable(b) {
  const { cancelCutoffHours } = db.getSchedule();
  if (b.status !== "confirmed") throw new HttpError(400, "This booking can no longer be changed online.");
  if (hoursUntil(b.date, b.start_min) < cancelCutoffHours) {
    const phone = settings.business().phone;
    throw new HttpError(400, `Online changes need at least ${cancelCutoffHours} hours' notice.${phone ? ` Please call ${phone}.` : " Please contact us."}`);
  }
}

route("GET", /^\/api\/health$/, (req, res) => send(res, 200, { ok: true }));

route("GET", /^\/api\/config$/, (req, res) => {
  const schedule = db.getSchedule();
  const biz = settings.business();
  const cat = bookableCatalog();
  send(res, 200, {
    business: { name: biz.name, phone: biz.phone, email: biz.email },
    services: cat.services, addons: cat.addons, frequencies: cat.frequencies,
    maxBedrooms: cat.maxBedrooms, maxBathrooms: cat.maxBathrooms, pricingNote: cat.pricingNote || "",
    maxDaysAhead: schedule.maxDaysAhead, cancelCutoffHours: schedule.cancelCutoffHours, today: nowLocal().date,
    emailEnabled: Boolean(settings.email().enabled && mail.available()),
  });
});

route("GET", /^\/api\/availability$/, (req, res, _, url) => {
  const month = url.searchParams.get("month") || "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, "Bad month.");
  send(res, 200, { days: monthAvailability(month, durationParam(url), excludeOpts(url)) });
});

route("GET", /^\/api\/slots$/, (req, res, _, url) => {
  const date = url.searchParams.get("date");
  if (!isDate(date)) throw new HttpError(400, "Bad date.");
  const slots = slotsFor(date, durationParam(url), undefined, excludeOpts(url))
    .map((start) => ({ start, label: fmtTime(start) }));
  send(res, 200, { date, label: fmtDate(date), slots });
});

route("POST", /^\/api\/bookings$/, async (req, res) => {
  const body = await readJson(req);
  if (body.website) throw new HttpError(400, "Something went wrong."); // hidden field only bots fill in

  const quote = Pricing.quote(bookableCatalog(), {
    service: body.service, bedrooms: body.bedrooms, bathrooms: body.bathrooms,
    addons: Array.isArray(body.addons) ? body.addons : [], frequency: body.frequency,
  });
  if (!quote) throw new HttpError(400, "Please choose a service.");
  const { date, start } = dateAndStart(body);
  const name = text(body.name, 100, "your name");
  const clientEmail = email(body.email, "email address");
  const phone = text(body.phone, 30, "your phone number");
  const address = text(body.address, 300, "the address");
  const notes = text(body.notes, 2000, "Notes", { required: false });

  rateLimit("book:" + clientIp(req), 5, 60 * 60 * 1000);
  const booking = db.transaction(() => {
    if (!slotsFor(date, quote.minutes).includes(start)) {
      throw new HttpError(409, "Sorry, that time was just taken. Please pick another.");
    }
    const id = db.insertBooking({
      token: crypto.randomBytes(16).toString("hex"), date, start_min: start, end_min: start + quote.minutes,
      service: quote.service, bedrooms: quote.bedrooms, bathrooms: quote.bathrooms, addons: quote.addons,
      frequency: quote.frequency, price: quote.price, name, email: clientEmail, phone, address, notes,
    });
    return db.bookingById(id);
  });
  mail.bookingConfirmed(booking);
  send(res, 201, publicView(booking));
});

route("GET", /^\/api\/bookings\/([a-f0-9]{32})$/, (req, res, [token]) => {
  send(res, 200, publicView(findByToken(token)));
});

route("POST", /^\/api\/bookings\/([a-f0-9]{32})\/cancel$/, (req, res, [token]) => {
  const b = findByToken(token);
  assertChangeable(b);
  db.setStatus(b.id, "cancelled");
  const updated = db.bookingById(b.id);
  mail.bookingCancelled(updated, true);
  send(res, 200, publicView(updated));
});

route("POST", /^\/api\/bookings\/([a-f0-9]{32})\/reschedule$/, async (req, res, [token]) => {
  const b = findByToken(token);
  assertChangeable(b);
  const { date, start } = dateAndStart(await readJson(req));
  const minutes = b.end_min - b.start_min;
  db.transaction(() => {
    if (!slotsFor(date, minutes, undefined, { ignoreBookingId: b.id }).includes(start)) {
      throw new HttpError(409, "Sorry, that time isn't available. Please pick another.");
    }
    db.moveBooking(b.id, date, start, start + minutes);
  });
  const updated = db.bookingById(b.id);
  mail.bookingRescheduled(updated, b.date, b.start_min);
  send(res, 200, publicView(updated));
});

// "Add to calendar" file for the client.
route("GET", /^\/api\/bookings\/([a-f0-9]{32})\/ics$/, (req, res, [token]) => {
  const b = findByToken(token);
  const biz = settings.business();
  const pad = (n) => String(n).padStart(2, "0");
  const local = (min) => `${b.date.replace(/-/g, "")}T${pad(Math.floor(min / 60))}${pad(min % 60)}00`;
  const esc = (s) => String(s).replace(/[\\;,]/g, (m) => "\\" + m).replace(/\r?\n/g, "\\n");
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Booking//EN", "BEGIN:VEVENT",
    `UID:${b.token}@booking`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
    `DTSTART;TZID=${biz.timezone}:${local(b.start_min)}`,
    `DTEND;TZID=${biz.timezone}:${local(b.end_min)}`,
    `SUMMARY:${esc(`${describe(b).serviceName} - ${biz.name}`)}`,
    `LOCATION:${esc(b.address)}`,
    `DESCRIPTION:${esc(`Manage your booking: ${biz.siteUrl}/manage?t=${b.token}`)}`,
    `STATUS:${b.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  send(res, 200, ics, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": 'attachment; filename="appointment.ics"',
  });
});
