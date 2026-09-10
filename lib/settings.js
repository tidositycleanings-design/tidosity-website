// Everything the owner can change from the dashboard is stored in the database.
// config.js only supplies the starting values the very first time the site runs.
const crypto = require("node:crypto");
const config = require("../config");
const db = require("./db");

const clone = (value) => JSON.parse(JSON.stringify(value));

const DEFAULTS = {
  business: {
    name: config.business.name,
    phone: config.business.phone || "",
    email: config.business.email || "",
    notifyEmail: "",                     // where new-booking alerts go (blank = business email)
    area: config.business.area || [],
    timezone: config.business.timezone || "America/Chicago",
    siteUrl: "",                         // filled in automatically the first time the owner signs in
  },
  catalog: {
    services: config.services,
    addons: config.addons,
    frequencies: config.frequencies,
    pricingNote: config.pricingNote || "",
    maxBedrooms: config.maxBedrooms,
    maxBathrooms: config.maxBathrooms,
  },
  content: { reviews: config.reviews || [], faq: config.faq || [] },
  email: { enabled: false, provider: "gmail", host: "", port: 587, user: "", pass: "", tested: false },
  progress: { hoursSaved: false, servicesSaved: false },
};

const cache = new Map();

function get(key) {
  if (!cache.has(key)) cache.set(key, { ...clone(DEFAULTS[key]), ...(db.readSetting(key) || {}) });
  return cache.get(key);
}

function set(key, value) {
  db.writeSetting(key, value);
  cache.set(key, value);
}

let secret = null;

module.exports = {
  business: () => get("business"),
  catalog: () => get("catalog"),
  content: () => get("content"),
  email: () => get("email"),
  progress: () => get("progress"),

  saveBusiness: (value) => set("business", value),
  saveCatalog: (value) => set("catalog", value),
  saveContent: (value) => set("content", value),
  saveEmail: (value) => set("email", value),
  markProgress: (flag) => set("progress", { ...get("progress"), [flag]: true }),

  // Random key that signs owner logins. Created once, then kept in the database.
  secret() {
    if (!secret) {
      secret = db.readSetting("secret");
      if (!secret) {
        secret = crypto.randomBytes(32).toString("hex");
        db.writeSetting("secret", secret);
      }
    }
    return secret;
  },

  password: () => db.readSetting("password"),            // { salt, hash } or null
  savePassword: (value) => db.writeSetting("password", value),
  readRaw: (key) => db.readSetting(key),
  writeRaw: (key, value) => db.writeSetting(key, value),
};
