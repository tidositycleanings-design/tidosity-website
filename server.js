// Website + booking system + owner dashboard in one small Node.js server.
// To run it: double-click "Start Website" (or `npm start`), then open /admin.
const path = require("node:path");
const http = require("node:http");

// Optional .env file (hosting platforms set these values in their dashboard instead).
try { process.loadEnvFile(path.join(__dirname, ".env")); } catch { /* none: that's fine */ }

// A friendly message instead of a crash when Node.js is too old.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\n  This website needs Node.js 22.13 or newer (this computer has ${process.versions.node}).` +
    "\n  Download the LTS version from https://nodejs.org, install it, and try again.\n");
  process.exit(1);
}

const { HttpError, send, match } = require("./lib/http");
const auth = require("./lib/auth");
const site = require("./lib/site");
require("./routes/public");
require("./routes/admin");

if (auth.applyEnvPassword()) console.log("  Owner password set from ADMIN_PASSWORD.");

const PORT = Number(process.env.PORT || 3000);

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) {
      const found = match(req.method, url.pathname);
      if (!found) throw new HttpError(404, "Not found.");
      return await found.handler(req, res, found.params, url);
    }
    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed.");
    site.serveStatic(req, res, url);
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    if (!res.headersSent) {
      send(res, err.status || 500, { error: err instanceof HttpError ? err.message : "Something went wrong on our end." });
    }
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  Port ${PORT} is already in use. The website may already be running; check your browser at http://localhost:${PORT}\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  const local = `http://localhost:${PORT}`;
  console.log(`\n  Your website is running at ${local}`);
  console.log(`  Owner dashboard:           ${local}/admin`);
  if (!auth.hasPassword()) console.log("  First time? Open the dashboard to create your password.");
  console.log("\n  Keep this window open while you use the website. Close it to stop.\n");

  // The "Start Website" files set OPEN_BROWSER so the dashboard opens by itself.
  if (/^(1|true|yes)$/i.test(process.env.OPEN_BROWSER || "")) {
    const { exec } = require("node:child_process");
    const target = `${local}/admin`;
    const cmd = process.platform === "win32" ? `start "" "${target}"` : process.platform === "darwin" ? `open "${target}"` : `xdg-open "${target}"`;
    exec(cmd, () => {});
  }
});
