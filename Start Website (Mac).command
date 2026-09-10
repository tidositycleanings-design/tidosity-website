#!/bin/bash
# Double-click to run the website on this Mac (first time: right-click > Open).
cd "$(dirname "$0")"
echo ""
echo "  Starting your website..."
echo ""
if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js isn't installed on this Mac yet."
  echo "  Opening the download page. Install the LTS version, then open this file again."
  open "https://nodejs.org/en/download"
  read -n 1 -s -r -p "  Press any key to close."
  exit 1
fi
if [ ! -d node_modules/nodemailer ]; then
  echo "  First-time setup: getting things ready. This takes about a minute..."
  npm install --omit=dev --no-audit --no-fund
fi
OPEN_BROWSER="${OPEN_BROWSER:-1}" node --disable-warning=ExperimentalWarning server.js
