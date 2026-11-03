# Static file server (see server.js) — no build step, but question-sets
# storage now needs the `pg` runtime dependency.
# Node 24 LTS: 20.x is EOL and unpatched for CVE-2026-111497 (Brotli RCE).
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
