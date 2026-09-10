// Booking emails, sent through the owner's own email account (set up on the
// dashboard's Email tab). Until email is turned on, messages are printed to the
// server log instead, so bookings still work.
const settings = require("./settings");
const { fmtDate, fmtTime } = require("./availability");
const { formatDuration } = require("../public/js/pricing");

let nodemailer = null;
try { nodemailer = require("nodemailer"); } catch { /* installed automatically by the host / Start file */ }

const PROVIDERS = {
  gmail:  { label: "Gmail",       host: "smtp.gmail.com",      port: 465 },
  yahoo:  { label: "Yahoo Mail",  host: "smtp.mail.yahoo.com", port: 465 },
  icloud: { label: "iCloud Mail", host: "smtp.mail.me.com",    port: 587 },
  other:  { label: "Other",       host: "",                    port: 587 },
};

function serverFor(cfg) {
  const p = PROVIDERS[cfg.provider] || PROVIDERS.other;
  return cfg.provider === "other" || !PROVIDERS[cfg.provider]
    ? { host: cfg.host, port: Number(cfg.port) || 587 }
    : { host: p.host, port: p.port };
}

let cached = { key: null, transport: null };
function transportFor(cfg) {
  const { host, port } = serverFor(cfg);
  const key = JSON.stringify([host, port, cfg.user, cfg.pass]);
  if (cached.key !== key) {
    cached = {
      key,
      transport: nodemailer.createTransport({
        host, port, secure: port === 465, auth: { user: cfg.user, pass: cfg.pass },
        connectionTimeout: 15000, greetingTimeout: 15000,
      }),
    };
  }
  return cached.transport;
}

async function deliver(cfg, to, subject, text) {
  if (!nodemailer) throw new Error("Email support isn't installed on this server yet.");
  const biz = settings.business();
  await transportFor(cfg).sendMail({
    from: `"${biz.name.replace(/["\r\n]/g, "")}" <${cfg.user}>`,
    replyTo: biz.email || cfg.user,
    to, subject, text,
  });
}

// Turns technical email errors into something the owner can act on.
function friendlyError(err) {
  const code = err && (err.code || err.responseCode);
  if (code === "EAUTH" || code === 535 || code === 534) {
    return "Your email address or app password wasn't accepted. Make sure you pasted an App Password (not your normal password).";
  }
  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ENOTFOUND"].includes(code)) {
    return "Couldn't connect to the email server. Check the server name and port, or try again in a minute.";
  }
  return (err && err.message) || "The test email couldn't be sent.";
}

function send(to, subject, text) {
  const cfg = settings.email();
  if (!cfg.enabled || !nodemailer || !to) {
    console.log(`\n[mail] (email not turned on, so not sent)\nTo: ${to || "(no address)"}\nSubject: ${subject}\n\n${text}\n`);
    return;
  }
  deliver(cfg, to, subject, text).catch((err) => console.error("[mail] send failed:", friendlyError(err)));
}

const ownerEmail = () => {
  const biz = settings.business();
  return biz.notifyEmail || biz.email || settings.email().user;
};
const siteUrl = () => settings.business().siteUrl || "";
const manageUrl = (b) => `${siteUrl()}/manage?t=${b.token}`;

function describe(b) {
  const cat = settings.catalog();
  const service = cat.services.find((s) => s.id === b.service);
  const freq = cat.frequencies.find((f) => f.id === b.frequency);
  const addons = cat.addons.filter((a) => b.addons.includes(a.id)).map((a) => a.name);
  const consult = Boolean(service && service.consultation);
  return [
    `Service:  ${service ? service.name : b.service}${consult ? " (free consultation)" : ""}${freq && freq.id !== "once" ? ` (${freq.name})` : ""}`,
    `When:     ${fmtDate(b.date)} at ${fmtTime(b.start_min)}`,
    `Length:   about ${formatDuration(b.end_min - b.start_min)}`,
    consult ? null : `Home:     ${b.bedrooms} bed / ${b.bathrooms} bath`,
    addons.length ? `Add-ons:  ${addons.join(", ")}` : null,
    `Address:  ${b.address}`,
    consult ? "Price:    Free consultation; we'll send a custom quote" : `Price:    $${b.price} (estimate)`,
    consult || !cat.pricingNote ? null : `          ${cat.pricingNote}`,
  ].filter(Boolean).join("\n");
}

const contact = (b) =>
  `Client:   ${b.name}\nEmail:    ${b.email}\nPhone:    ${b.phone}${b.notes ? `\nNotes:    ${b.notes}` : ""}`;

function sign() {
  const biz = settings.business();
  return `\n\n${biz.name}${biz.phone ? `\n${biz.phone}` : ""}`;
}

const first = (b) => b.name.split(" ")[0];

module.exports = {
  PROVIDERS,
  available: () => Boolean(nodemailer),
  friendlyError,

  // Sends a test using settings that may not be saved yet; throws a friendly error.
  async sendTest(cfg, to) {
    try {
      await deliver(cfg, to, `Test email from ${settings.business().name}`,
        "It works! Your booking website can send emails.\n\nYou'll get a message like this whenever someone books, reschedules, or cancels.");
    } catch (err) {
      throw new Error(friendlyError(err));
    }
  },

  bookingConfirmed(b) {
    const biz = settings.business();
    send(b.email, `You're booked! ${fmtDate(b.date)} at ${fmtTime(b.start_min)}`,
      `Hi ${first(b)},\n\nThanks for booking with ${biz.name}. Here are your details:\n\n${describe(b)}\n\n` +
      `Need to reschedule or cancel? Use this link:\n${manageUrl(b)}${sign()}`);
    send(ownerEmail(), `New booking: ${b.name}, ${fmtDate(b.date)} ${fmtTime(b.start_min)}`,
      `${describe(b)}\n\n${contact(b)}\n\nSee all bookings: ${siteUrl()}/admin`);
  },

  bookingRescheduled(b, oldDate, oldStart) {
    const was = `${fmtDate(oldDate)} at ${fmtTime(oldStart)}`;
    send(b.email, `Rescheduled: ${fmtDate(b.date)} at ${fmtTime(b.start_min)}`,
      `Hi ${first(b)},\n\nYour appointment has moved (it was ${was}). New details:\n\n${describe(b)}\n\n` +
      `Manage your booking: ${manageUrl(b)}${sign()}`);
    send(ownerEmail(), `Rescheduled: ${b.name} is now ${fmtDate(b.date)} ${fmtTime(b.start_min)}`,
      `Was: ${was}\n\n${describe(b)}\n\n${contact(b)}`);
  },

  bookingCancelled(b, byClient) {
    send(b.email, `Cancelled: your appointment on ${fmtDate(b.date)}`,
      `Hi ${first(b)},\n\nYour appointment on ${fmtDate(b.date)} at ${fmtTime(b.start_min)} has been cancelled.\n` +
      `Want to pick a new time? Book again at ${siteUrl()}/#book${sign()}`);
    send(ownerEmail(), `Cancelled${byClient ? " by client" : ""}: ${b.name}, ${fmtDate(b.date)} ${fmtTime(b.start_min)}`,
      `${describe(b)}\n\n${contact(b)}`);
  },
};
