# Runs the site anywhere Docker runs (Railway, Fly.io, Render, any VPS).
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# Bookings live in /data. Mount a persistent volume there so they survive redeploys.
ENV PORT=3000 DATA_DIR=/data TRUST_PROXY=true
VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
