# Tidosity Premium Cleaning Services website

**Business owner?** Open **`START HERE.html`**. It walks you through putting the site online in about
10 minutes with no technical steps. Everything else is changed from your dashboard at `/admin`.

This file is for developers.

---

## What it is

A small Node.js app that serves the website, a built-in booking system (an Acuity-style replacement),
and an owner dashboard:

- **Booking:** instant price estimates, live availability (hours, travel buffers, notice period, days off,
  capacity), free-consultation services, reschedule/cancel links, `.ics` calendar files, and email notifications.
- **Dashboard:** first-run setup, a setup checklist, bookings (mark done, cancel, CSV export), schedule and time
  off, services and prices (with photo upload), business info, reviews, FAQ, email (SMTP with a test send),
  and password change.
- The homepage is rendered from the saved settings on every request, so edits show up immediately.

## Run it locally

Requires **Node.js 22.13+**. The only dependency is `nodemailer`.

```bash
npm install
```
```bash
npm start
```

Open <http://localhost:3000/admin>. A fresh install shows the setup screen, which creates the owner password.
Non-technical users can double-click `Start Website (Windows).bat` or `Start Website (Mac).command` instead.

## Configuration

Everything the owner changes is stored in the database. `config.js` only seeds the first run.
Environment variables are all optional:

| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on (default 3000). |
| `DATA_DIR` | Folder for `bookings.db` and uploaded photos (default `./data`). Put it on a persistent disk. |
| `ADMIN_PASSWORD` | Sets the owner password when it's new or changed. This doubles as the password reset. |
| `TRUST_PROXY` | Set to `true` behind a reverse proxy. It's detected automatically on Render. |
| `OPEN_BROWSER` | `1` opens the dashboard on start (the Start files set this). |

## Deploy

- **Render (one click):** `render.yaml` is a Blueprint. It sets up a Starter web service with a 1 GB disk at
  `/var/data` and asks for `ADMIN_PASSWORD`. The deploy link is
  `https://render.com/deploy?repo=<this repo's GitHub URL>`, and the same link is used in `START HERE.html`.
- **Docker:** the `Dockerfile` stores data in `/data`, so mount a volume there.
- **Any VPS:** run `npm install --omit=dev && npm start` under a process manager like pm2 or systemd.

Hosts without a persistent disk lose the database on every restart.

## Code map

| Path | What |
|---|---|
| `server.js` | Startup: Node version check, security headers, request dispatch |
| `routes/public.js` | Site API: config, availability, slots, bookings, manage, `.ics` |
| `routes/admin.js` | Dashboard API: setup/login, bookings, schedule, catalog, content, email, password, uploads |
| `lib/settings.js` | Owner settings stored in SQLite (seeded from `config.js`) |
| `lib/site.js` | Static files, uploads, and the homepage renderer (`{{token}}` and `<!--@block-->` placeholders) |
| `lib/availability.js` | Slot engine; times are business-local date + minutes in the saved timezone |
| `lib/db.js`, `lib/auth.js`, `lib/mailer.js`, `lib/http.js`, `lib/views.js` | Storage, login, email, HTTP helpers, booking views |
| `public/js/pricing.js` | Price/duration calculator shared by the browser and the server |
| `public/js/*.js` | Booking widget, manage page, and dashboard |

## Security notes

- The owner password is hashed with scrypt, and sessions use an HMAC-signed, HTTP-only, SameSite=Strict cookie
  tied to the password hash. Login is rate-limited.
- First-run setup only works while no password exists (on Render, the password is set during deploy).
- Bookings are rate-limited per IP and include a hidden spam field. Client links are random 128-bit tokens.
  Prices are recalculated on the server.
- Uploads are limited to JPG/PNG/WebP, checked by file signature, and given random names.
- A strict Content-Security-Policy is sent on every page, and owner-entered text is HTML-escaped.
