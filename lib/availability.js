// Works out which start times are open. All times are "business local":
// a date string (YYYY-MM-DD) plus minutes after midnight, in the business's timezone
// (set on the dashboard), so it behaves the same no matter where the server is hosted.
const db = require("./db");
const settings = require("./settings");

function isTimezone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return typeof tz === "string" && tz.length > 0;
  } catch {
    return false;
  }
}

function nowLocal() {
  const tz = settings.business().timezone;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: isTimezone(tz) ? tz : "UTC", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

// Plain-date helpers (UTC math on purpose, so daylight saving never shifts a day).
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
const weekday = (date) => new Date(date + "T00:00:00Z").getUTCDay();
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
function addDays(date, n) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
function fmtTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
function fmtDate(date) {
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

// Hours from now until a local date + minute (negative if it's in the past).
function hoursUntil(date, minutes) {
  const now = nowLocal();
  return (daysBetween(now.date, date) * 1440 + minutes - now.minutes) / 60;
}

// Highest number of intervals overlapping at any moment within [s, e).
function maxConcurrent(intervals, s, e) {
  const points = [s, ...intervals.map(([bs]) => bs).filter((t) => t > s && t < e)];
  return Math.max(0, ...points.map((t) => intervals.filter(([bs, be]) => bs <= t && t < be).length));
}

// Every start time (minutes) where a job lasting `duration` fits on `date`.
function slotsFor(date, duration, schedule = db.getSchedule(), opts = {}) {
  const hours = schedule.hours[weekday(date)];
  if (!hours) return [];

  const now = nowLocal();
  const ahead = daysBetween(now.date, date);
  if (ahead < 0 || ahead > schedule.maxDaysAhead) return [];

  const earliestTotal = now.minutes + schedule.minNoticeHours * 60;
  const earliestDate = addDays(now.date, Math.floor(earliestTotal / 1440));
  if (date < earliestDate) return [];
  const minStart = date === earliestDate ? earliestTotal % 1440 : 0;

  const buffer = schedule.bufferMinutes;
  const busy = db.activeBookingsOn(date)
    .filter((b) => b.id !== opts.ignoreBookingId)
    .map((b) => [b.start_min - buffer, b.end_min + buffer]);
  const blocked = db.blocksOn(date).map((b) => [b.start_min, b.end_min]);

  const open = toMin(hours.start);
  const close = toMin(hours.end);
  const slots = [];
  for (let s = open; s + duration <= close; s += schedule.slotInterval) {
    const e = s + duration;
    if (s < minStart) continue;
    if (blocked.some(([bs, be]) => s < be && e > bs)) continue;
    if (maxConcurrent(busy, s, e) >= schedule.capacity) continue;
    slots.push(s);
  }
  return slots;
}

// { "2026-09-01": 3, "2026-09-02": 0, ... } number of open slots per day.
function monthAvailability(month, duration, opts = {}) {
  const schedule = db.getSchedule();
  const result = {};
  for (let d = month + "-01"; d.startsWith(month); d = addDays(d, 1)) {
    result[d] = slotsFor(d, duration, schedule, opts).length;
  }
  return result;
}

module.exports = {
  isTimezone, nowLocal, isDate, addDays, toMin, fmtTime, fmtDate, hoursUntil,
  slotsFor, monthAvailability,
};
