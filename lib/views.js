// How a booking is presented to clients (publicView) and to the owner (adminView).
const db = require("./db");
const settings = require("./settings");
const { fmtTime, fmtDate, hoursUntil } = require("./availability");

function describe(b) {
  const cat = settings.catalog();
  const service = cat.services.find((s) => s.id === b.service);
  const freq = cat.frequencies.find((f) => f.id === b.frequency);
  return {
    serviceName: service ? service.name : b.service,
    consultation: Boolean(service && service.consultation),
    frequencyName: freq ? freq.name : b.frequency,
    addonNames: cat.addons.filter((a) => b.addons.includes(a.id)).map((a) => a.name),
    dateLabel: fmtDate(b.date),
    timeLabel: `${fmtTime(b.start_min)} – ${fmtTime(b.end_min)}`,
  };
}

// What a client sees about their own booking (never includes internal ids).
function publicView(b) {
  const { cancelCutoffHours } = db.getSchedule();
  return {
    token: b.token, status: b.status, date: b.date, start: b.start_min, minutes: b.end_min - b.start_min,
    bedrooms: b.bedrooms, bathrooms: b.bathrooms, price: b.price, name: b.name, address: b.address,
    ...describe(b),
    cancelCutoffHours,
    canChange: b.status === "confirmed" && hoursUntil(b.date, b.start_min) >= cancelCutoffHours,
  };
}

const adminView = (b) => ({ ...b, ...describe(b), minutes: b.end_min - b.start_min });

module.exports = { describe, publicView, adminView };
