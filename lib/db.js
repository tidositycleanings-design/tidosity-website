// SQLite storage using Node's built-in driver (no install needed).
// The database file lives in DATA_DIR (default ./data) so hosts with a
// persistent volume can point it there.
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const config = require("../config");

// Relative DATA_DIR paths are relative to the project folder, not wherever node was started.
const dataDir = path.resolve(__dirname, "..", process.env.DATA_DIR || "data");
fs.mkdirSync(dataDir, { recursive: true });

const dbFile = path.join(dataDir, "bookings.db");
let db;
try {
  db = new DatabaseSync(dbFile);
} catch (err) {
  console.error(`\nCouldn't open the bookings database at:\n  ${dbFile}\n` +
    "Make sure that folder is writable. On Windows, very long folder paths (over 260 characters)\n" +
    "also cause this; set DATA_DIR in .env to a short path such as C:\\cleaning-data\n");
  throw err;
}
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS bookings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    token        TEXT UNIQUE NOT NULL,
    status       TEXT NOT NULL DEFAULT 'confirmed',  -- confirmed | cancelled | completed
    date         TEXT NOT NULL,                      -- YYYY-MM-DD, business local time
    start_min    INTEGER NOT NULL,                   -- minutes after midnight
    end_min      INTEGER NOT NULL,
    service      TEXT NOT NULL,
    bedrooms     INTEGER NOT NULL,
    bathrooms    INTEGER NOT NULL,
    addons       TEXT NOT NULL DEFAULT '[]',
    frequency    TEXT NOT NULL DEFAULT 'once',
    price        INTEGER NOT NULL,
    name         TEXT NOT NULL,
    email        TEXT NOT NULL,
    phone        TEXT NOT NULL,
    address      TEXT NOT NULL,
    notes        TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    cancelled_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date, status);
  CREATE TABLE IF NOT EXISTS blocks (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    date      TEXT NOT NULL,
    start_min INTEGER NOT NULL DEFAULT 0,
    end_min   INTEGER NOT NULL DEFAULT 1440,
    reason    TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_blocks_date ON blocks(date);
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const q = {
  getSetting: db.prepare("SELECT value FROM settings WHERE key = ?"),
  putSetting: db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
  countService: db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE service = ?"),
  activeOn: db.prepare("SELECT * FROM bookings WHERE date = ? AND status != 'cancelled' ORDER BY start_min"),
  between: db.prepare("SELECT * FROM bookings WHERE date BETWEEN ? AND ? ORDER BY date, start_min"),
  byToken: db.prepare("SELECT * FROM bookings WHERE token = ?"),
  byId: db.prepare("SELECT * FROM bookings WHERE id = ?"),
  insert: db.prepare(`INSERT INTO bookings
    (token, date, start_min, end_min, service, bedrooms, bathrooms, addons, frequency, price, name, email, phone, address, notes)
    VALUES ($token, $date, $start_min, $end_min, $service, $bedrooms, $bathrooms, $addons, $frequency, $price, $name, $email, $phone, $address, $notes)`),
  setStatus: db.prepare("UPDATE bookings SET status = ?, cancelled_at = CASE WHEN ? = 'cancelled' THEN datetime('now') ELSE cancelled_at END WHERE id = ?"),
  moveBooking: db.prepare("UPDATE bookings SET date = ?, start_min = ?, end_min = ? WHERE id = ?"),
  blocksOn: db.prepare("SELECT * FROM blocks WHERE date = ?"),
  blocksFrom: db.prepare("SELECT * FROM blocks WHERE date >= ? ORDER BY date, start_min"),
  addBlock: db.prepare("INSERT INTO blocks (date, start_min, end_min, reason) VALUES (?, ?, ?, ?)"),
  deleteBlock: db.prepare("DELETE FROM blocks WHERE id = ?"),
};

function parseBooking(row) {
  return row ? { ...row, addons: JSON.parse(row.addons || "[]") } : null;
}

function readSetting(key) {
  const row = q.getSetting.get(key);
  return row ? JSON.parse(row.value) : null;
}
const writeSetting = (key, value) => q.putSetting.run(key, JSON.stringify(value));

module.exports = {
  dataDir,
  readSetting,
  writeSetting,

  // Weekly hours and booking rules (edited on the dashboard's Schedule tab).
  getSchedule: () => ({ ...config.defaultSettings, ...(readSetting("schedule") || {}) }),
  saveSchedule: (schedule) => writeSetting("schedule", schedule),
  countBookingsForService: (id) => q.countService.get(id).n,

  activeBookingsOn: (date) => q.activeOn.all(date).map(parseBooking),
  bookingsBetween: (from, to) => q.between.all(from, to).map(parseBooking),
  bookingByToken: (token) => parseBooking(q.byToken.get(token)),
  bookingById: (id) => parseBooking(q.byId.get(id)),
  setStatus: (id, status) => q.setStatus.run(status, status, id),
  moveBooking: (id, date, start, end) => q.moveBooking.run(date, start, end, id),

  insertBooking(b) {
    const info = q.insert.run({
      $token: b.token, $date: b.date, $start_min: b.start_min, $end_min: b.end_min,
      $service: b.service, $bedrooms: b.bedrooms, $bathrooms: b.bathrooms,
      $addons: JSON.stringify(b.addons || []), $frequency: b.frequency, $price: b.price,
      $name: b.name, $email: b.email, $phone: b.phone, $address: b.address, $notes: b.notes || "",
    });
    return Number(info.lastInsertRowid);
  },

  blocksOn: (date) => q.blocksOn.all(date),
  blocksFrom: (date) => q.blocksFrom.all(date),
  addBlock: (date, start, end, reason) => Number(q.addBlock.run(date, start, end, reason || "").lastInsertRowid),
  deleteBlock: (id) => q.deleteBlock.run(id),

  // Runs fn inside a write-locked transaction (used to prevent double-booking).
  transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  },
};
